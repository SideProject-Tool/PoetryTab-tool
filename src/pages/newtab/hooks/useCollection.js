import { useState, useEffect, useCallback, useRef } from "react";
import { CLOUD_SYNC } from "../services/constants";
import {
  addChildToFolder,
  updateItem,
  removeItem,
  moveItem,
  moveNodesTo as moveToFolderSvc,
  reorderItem,
  genId,
  SETTINGS_DEFAULTS,
} from "../services/collection";
import { countLinks, mergeImportedTree } from "../services/bookmarks";

/*
 * 用户体系与云同步
 *
 * 认证流程（密码永不明文传输/存储）：
 *   注册  客户端生成随机盐 → PBKDF2-SHA256(密码, 盐, 600k) → authKey 提交
 *   登录  /api/challenge 拿一次性挑战 + 盐 → 重派生 authKey → HMAC(authKey, challenge) 应答
 *   会话  登录后持无状态令牌（30 天），此后数据读写仅凭令牌
 *
 * 多设备/多标签页并发策略：
 *   写入为整份覆盖 + 乐观锁（X-Base-SavedAt）；409 冲突时本地有未同步修改 → 强制仲裁
 *   （saveState=conflict，自动保存暂停，须在设置面板「上传到云端=本地为准 / 从云端恢复=云端为准」二选一），
 *   仲裁前不存在静默覆盖云端的路径。
 *   同浏览器多标签页经 BroadcastChannel 广播保存结果：未编辑的标签页即时采纳最新数据，
 *   编辑中的标签页保持本地，由下一次保存的 409 进入仲裁。
 *
 * 状态机 status：
 *   idle   未登录（显示引导门）
 *   boot   持会话启动恢复中
 *   loading 手动加载中
 *   ready  已就绪
 *   error  网络异常（error 必有可读信息）
 *
 * localStorage：pt.uid / pt.session / pt.cache（{uid, savedAt, dirty, data}，账号隔离）
 */

const UID_KEY = "pt.uid";
const SESSION_KEY = "pt.session";
const CACHE_KEY = "pt.cache";
const SAVE_DEBOUNCE = 700;
const ITER_DEFAULT = 600000;
const FETCH_TIMEOUT = 15000; // 网络请求超时：避免挂死在 saving/boot

/* ---------- WebCrypto 工具 ---------- */
const enc = new TextEncoder();
function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hexStr) {
  const a = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  return a;
}
function randomHex(byteLen) {
  const a = new Uint8Array(byteLen);
  crypto.getRandomValues(a);
  return bytesToHex(a);
}
async function hmacHex(keyHex, msg) {
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function deriveAuthKey(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
    key,
    256
  );
  return bytesToHex(bits);
}

/* ---------- API（统一 15s 超时） ---------- */
async function fetchJson(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null }; // 网络不可达/超时
  }
}
async function apiPost(path, body) {
  return fetchJson(CLOUD_SYNC.url + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
/** GET 数据；携带 If-None-Match（上次云端版本）命中时返回 {status:304}，调用方沿用本地数据 */
async function apiGetData(session, etag) {
  const headers = { Authorization: `Bearer ${session}` };
  if (etag) headers["If-None-Match"] = `"${etag}"`;
  return fetchJson(CLOUD_SYNC.url + "/api/data", { headers });
}
async function apiPutData(session, data, baseSavedAt) {
  return fetchJson(CLOUD_SYNC.url + "/api/data", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session}`,
      "Content-Type": "application/json",
      "X-Base-SavedAt": baseSavedAt || "",
    },
    body: JSON.stringify(data),
  });
}
async function apiListSnaps(session) {
  return fetchJson(CLOUD_SYNC.url + "/api/snaps", { headers: { Authorization: `Bearer ${session}` } });
}
async function apiRestoreSnap(session, key) {
  return fetchJson(CLOUD_SYNC.url + "/api/snap/restore", {
    method: "POST",
    headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
}

/* ---------- 本地缓存（账号隔离 + 版本号 + dirty 持久化） ---------- */
/** 读取当前账号的缓存；缓存属其他账号（切换登录后的残留）时弃用，避免闪现他人收藏 */
function readCache(uid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.uid !== uid || !parsed.data || !Array.isArray(parsed.data.folders)) return null;
    return { savedAt: parsed.savedAt || "", dirty: !!parsed.dirty, data: ensureShape(parsed.data) };
  } catch {
    return null;
  }
}
function writeCache(uid, data, savedAt, dirty) {
  if (!uid) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, savedAt: savedAt || "", dirty: !!dirty, data }));
  } catch { /* 容量不足时放弃缓存 */ }
}
function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* 无痕模式等 */ }
}
function defaultData() {
  return {
    v: 1,
    folders: [{ id: genId("f"), title: "我的收藏", children: [] }],
    quickSites: [],
    iframeWidgets: [],
    settings: { ...SETTINGS_DEFAULTS },
    layout: { v: 2, cols: [[], [], [], [], []] },
  };
}
/** 云端数据兜底：数组字段缺失/损坏时补默认值。
 *  深度归一：folder 补 children、剔除 null/非对象项、settings.cats 非数组回退默认，避免畸形数据渲染崩溃。
 *  layout 保持原样透传：新格式为对象 {v:2,cols}（旧客户端按缺失处理自动装箱），旧格式为坐标数组。
 *  老数据「常用网站」（quickSites）已下线：读取时直接丢弃（v1.5.0） */
function ensureShape(d) {
  if (!d || typeof d !== "object") return defaultData();
  const normList = (list) =>
    Array.isArray(list) ? list.filter((x) => x && typeof x === "object") : [];
  const folders = normList(d.folders).map((f) => ({ ...f, children: normList(f.children) }));
  const settings = {
    ...SETTINGS_DEFAULTS,
    ...(d.settings && typeof d.settings === "object" ? d.settings : {}),
  };
  if (!Array.isArray(settings.cats)) settings.cats = [...SETTINGS_DEFAULTS.cats];
  if (!Array.isArray(settings.hiddenCards)) settings.hiddenCards = [];
  return {
    ...d,
    v: d.v || 1,
    folders,
    quickSites: [],
    iframeWidgets: normList(d.iframeWidgets),
    layout: d.layout ?? { v: 2, cols: [[], [], [], [], []] },
    settings,
  };
}

/* ---------- 保存队列：单飞 + 最新优先（并发修改只落一次盘） ---------- */
let saveChain = Promise.resolve();
let pendingSnapshot = null;
let persistFn = null; // 由 hook 注入
function enqueueSave(snapshot) {
  pendingSnapshot = snapshot;
  saveChain = saveChain.then(async () => {
    const snap = pendingSnapshot;
    pendingSnapshot = null;
    if (snap && persistFn) await persistFn(snap);
  }).catch(() => { /* 失败状态已在 persistFn 中标记 */ });
}

/* ---------- 跨标签页广播：同一账号保存成功后通知其他标签页 ---------- */
const SYNC_CHANNEL = "poetry-tab-sync";
function broadcastSync(msg) {
  try {
    if (typeof BroadcastChannel !== "undefined") new BroadcastChannel(SYNC_CHANNEL).postMessage(msg);
  } catch { /* 广播失败不影响主流程 */ }
}

/* ---------- Hook ---------- */
export function useCollection() {
  const [uid, setUid] = useState(() => localStorage.getItem(UID_KEY) || "");
  const [session, setSession] = useState(() => localStorage.getItem(SESSION_KEY) || "");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const hasUid = Boolean(uid && session);

  const cachedBoot = useRef(null); // 启动时读一次缓存（含 savedAt/dirty），供 boot 流程判定
  if (cachedBoot.current === null) {
    cachedBoot.current = uid ? readCache(uid) : null;
  }
  const [data, setData] = useState(() => cachedBoot.current?.data || null);
  const [status, setStatus] = useState(() => (session ? "boot" : "idle"));
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("saved"); // saved | saving | error | conflict
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const [savedAt, setSavedAt] = useState(() => cachedBoot.current?.savedAt || "");
  const dataRef = useRef(data);
  const saveTimer = useRef(null);
  const baseSavedAtRef = useRef(cachedBoot.current?.savedAt || ""); // 乐观锁：客户端持有的云端版本
  const dirtyRef = useRef(!!cachedBoot.current?.dirty); // 有未落库的本地改动
  const conflictCloudSavedAtRef = useRef(""); // 冲突时云端的版本号：强制「以本地为准」上传时使用
  useEffect(() => { dataRef.current = data; }, [data]);

  const applyAuth = useCallback((id, token) => {
    sessionRef.current = token; // 同步更新：登录/注册后立即入队的保存必须拿到新会话
    uidRef.current = id;
    setUid(id);
    setSession(token);
    localStorage.setItem(UID_KEY, id);
    localStorage.setItem(SESSION_KEY, token);
  }, []);
  const clearAuth = useCallback(() => {
    sessionRef.current = ""; // 同步失效：防止在途请求继续携带过期会话
    setUid("");
    setSession("");
    localStorage.removeItem(UID_KEY);
    localStorage.removeItem(SESSION_KEY);
  }, []);

  const resetToIdle = useCallback(() => {
    // 不清 pt.cache：缓存按 uid 隔离，保留未同步改动，同账号重新登录后进入仲裁（不丢数据）
    conflictCloudSavedAtRef.current = "";
    baseSavedAtRef.current = "";
    dirtyRef.current = false;
    cachedBoot.current = null;
    setUid("");
    setSession("");
    uidRef.current = "";
    sessionRef.current = "";
    setData(null);
    setStatus("idle");
    setError("");
    setSaveState("saved");
    setSavedAt("");
  }, [clearAuth]);

  /** 冲突仲裁之一：放弃本地，以云端为准（拉取并采纳；云端为空则回到默认数据） */
  const adoptCloud = useCallback(async () => {
    const latest = await apiGetData(sessionRef.current);
    if (latest.status !== 200 || !latest.json) return false;
    const d = latest.json.data ? ensureShape(latest.json.data) : defaultData();
    dataRef.current = d;
    setData(d);
    writeCache(uidRef.current, d, latest.json.savedAt || "", false);
    baseSavedAtRef.current = latest.json.savedAt || "";
    setSavedAt(baseSavedAtRef.current);
    dirtyRef.current = false;
    conflictCloudSavedAtRef.current = "";
    setSaveState("saved");
    setError("");
    return true;
  }, []);

  /* 落库（队列消费端）：携带版本号乐观锁；401 会话过期自动登出；409 冲突进入强制仲裁 */
  const persistNow = useCallback(async (snapshot) => {
    setSaveState("saving");
    // 冲突仲裁「以本地为准」：借用云端当前版本号通过乐观锁，覆盖云端
    const inConflict = saveStateRef.current === "conflict" && conflictCloudSavedAtRef.current;
    const base = inConflict ? conflictCloudSavedAtRef.current : baseSavedAtRef.current;
    const r = await apiPutData(sessionRef.current, snapshot, base);
    if (r.status === 200) {
      baseSavedAtRef.current = (r.json && r.json.savedAt) || "";
      conflictCloudSavedAtRef.current = "";
      if (snapshot === dataRef.current) dirtyRef.current = false; // 快照入队后又有新编辑则保持 dirty
      writeCache(uidRef.current, snapshot, baseSavedAtRef.current, dirtyRef.current);
      setSavedAt(baseSavedAtRef.current);
      setSaveState("saved");
      broadcastSync({ type: "sync", uid: uidRef.current, savedAt: baseSavedAtRef.current, data: snapshot });
      return;
    }
    if (r.status === 401) {
      // 会话过期：回登录门；未同步改动保留在本地缓存（uid 隔离），重新登录后进入仲裁，不丢数据
      resetToIdle();
      return;
    }
    if (r.status === 409) {
      // 其他设备已先保存：本地有未同步修改 → 强制仲裁（暂停自动保存，等用户在设置面板
      // 选「上传到云端」=本地为准 / 「从云端恢复」=云端为准）；无未同步修改才自动载入云端。
      // 注意：不 rebase 本地乐观锁版本，保证仲裁前不存在任何静默覆盖云端的路径
      const cloudSavedAt = (r.json && r.json.savedAt) || "";
      conflictCloudSavedAtRef.current = cloudSavedAt;
      if (dirtyRef.current) {
        setSaveState("conflict");
        setError("云端有其他设备的修改，请在设置中选择以本地或云端为准");
        return;
      }
      const adopted = await adoptCloud();
      if (!adopted) {
        setSaveState("error");
        setError("检测到其他设备的修改，但拉取云端失败，请稍后重试");
      }
      return;
    }
    setSaveState("error");
    setError(r.status === 0 ? "网络异常，保存未完成" : `保存失败 (HTTP ${r.status})`);
  }, [adoptCloud, resetToIdle]);
  useEffect(() => {
    persistFn = persistNow;
    return () => { persistFn = null; };
  }, [persistNow]);

  /* 跨标签页：其他标签页保存成功 → 未编辑的本标签页即时采纳（编辑中的等 409 仲裁，绝不静默覆盖） */
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    ch.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type !== "sync" || msg.uid !== uidRef.current) return;
      if (dirtyRef.current || saveStateRef.current === "conflict") return;
      const d = msg.data && Array.isArray(msg.data.folders) ? ensureShape(msg.data) : null;
      if (!d) return;
      dataRef.current = d;
      setData(d);
      writeCache(msg.uid, d, msg.savedAt || "", false);
      baseSavedAtRef.current = msg.savedAt || baseSavedAtRef.current;
      setSavedAt(baseSavedAtRef.current);
    };
    return () => ch.close();
  }, []);

  /* 启动恢复：持会话则带 If-None-Match 条件拉取（命中 304 直接用本地缓存，开标签页零流量） */
  useEffect(() => {
    if (!sessionRef.current) return;
    let alive = true;
    (async () => {
      const cached = cachedBoot.current;
      const r = await apiGetData(sessionRef.current, cached?.savedAt);
      if (!alive) return;
      if (r.status === 304) {
        // 云端仍是缓存版本：沿用缓存数据（含本地未同步的 dirty 改动，正常防抖续传）
        if (cached) {
          dirtyRef.current = !!cached.dirty;
          setData(cached.data);
          baseSavedAtRef.current = cached.savedAt;
          setSavedAt(cached.savedAt);
        }
        setStatus("ready");
        return;
      }
      if (r.status === 200) {
        const d = r.json && r.json.data;
        const cloudSavedAt = (r.json && r.json.savedAt) || "";
        if (cached && cached.dirty && d && cloudSavedAt !== cached.savedAt &&
            JSON.stringify(ensureShape(d)) !== JSON.stringify(cached.data)) {
          // 关页前有未同步修改，且云端已被推进、且内容确实不同：进入强制仲裁，保住本地改动
          //（内容一致 = 用户自己的关页上传已生效，静默采纳云端即可）
          conflictCloudSavedAtRef.current = cloudSavedAt;
          baseSavedAtRef.current = cached.savedAt;
          dirtyRef.current = true;
          setSaveState("conflict");
          setError("云端有其他设备的修改，请在设置中选择以本地或云端为准");
          setStatus("ready");
          return;
        }
        if (d) {
          const shaped = ensureShape(d);
          dataRef.current = shaped;
          setData(shaped);
          writeCache(uidRef.current, shaped, cloudSavedAt, false);
          baseSavedAtRef.current = cloudSavedAt;
          dirtyRef.current = false;
          setSavedAt(cloudSavedAt);
          setStatus("ready");
        } else {
          const fresh = defaultData();
          dirtyRef.current = true;
          setData(fresh);
          writeCache(uidRef.current, fresh, "", true);
          setStatus("ready");
          enqueueSave(fresh); // 有会话但云端无数据（注册后未落库过）：补一份默认数据
        }
        return;
      }
      if (r.status === 401) {
        resetToIdle();
        return;
      }
      setError(r.status === 0 ? "无法连接云端，请检查网络后点击重试" : `云端异常 (HTTP ${r.status})，请稍后重试`);
      setStatus("error");
    })();
    return () => { alive = false; };
  }, [resetToIdle]);

  /* 保存调度 */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      enqueueSave(dataRef.current);
    }, SAVE_DEBOUNCE);
  }, []);
  const saveNow = useCallback(async () => {
    if (!sessionRef.current || !dataRef.current) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    enqueueSave(dataRef.current);
    await saveChain;
  }, []);

  /* 保存失败自动重试：每 30s 重发直到成功（conflict 需用户手动抉择，不自动重试） */
  useEffect(() => {
    if (saveState !== "error") return;
    const t = setInterval(() => {
      if (sessionRef.current && dataRef.current) enqueueSave(dataRef.current);
    }, 30000);
    return () => clearInterval(t);
  }, [saveState]);

  /** 所有修改经此入口：变更 → 防抖自动保存。冲突待仲裁期间只改本地、暂停自动保存 */
  const mutate = useCallback((fn) => {
    if (!sessionRef.current) return;
    dirtyRef.current = true;
    setData((prev) => {
      const next = fn(prev);
      dataRef.current = next;
      writeCache(uidRef.current, next, baseSavedAtRef.current, true);
      return next;
    });
    if (saveStateRef.current !== "conflict") scheduleSave();
  }, [scheduleSave]);

  /* 关页/切走前的兜底落库：防抖窗口内关闭标签页也不丢改动（keepalive 尽力而为） */
  useEffect(() => {
    const flushOnHide = () => {
      if (!dirtyRef.current || !sessionRef.current || !dataRef.current) return;
      if (saveStateRef.current === "conflict") return; // 冲突待用户抉择，不自动以本地覆盖云端
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      try {
        const body = JSON.stringify(dataRef.current);
        // keepalive 请求体字节上限约 64KB：超限退回普通 fetch（尽力而为）
        const keepalive = new Blob([body]).size <= 60000;
        fetch(CLOUD_SYNC.url + "/api/data", {
          method: "PUT",
          keepalive,
          headers: {
            Authorization: `Bearer ${sessionRef.current}`,
            "Content-Type": "application/json",
            "X-Base-SavedAt": baseSavedAtRef.current,
          },
          body,
        })
          .then(async (r) => {
            // 消费响应：同步本地乐观锁版本，否则下次保存会被假 409 回滚
            if (!r.ok) return;
            let j = null;
            try { j = await r.json(); } catch { /* 非 JSON 响应 */ }
            if (j && j.savedAt) {
              baseSavedAtRef.current = j.savedAt;
              setSavedAt(j.savedAt);
              dirtyRef.current = false; // 仅成功后清 dirty；失败保持 dirty 以便下次 hide 重试
              writeCache(uidRef.current, dataRef.current, j.savedAt, false);
              broadcastSync({ type: "sync", uid: uidRef.current, savedAt: j.savedAt, data: dataRef.current });
            }
          })
          .catch(() => { /* 卸载期尽力而为 */ });
      } catch { /* 卸载期尽力而为 */ }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flushOnHide(); };
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* 登录：挑战应答式 */
  const login = useCallback(async (id, password) => {
    const c = await apiPost("/api/challenge", { uid: id });
    if (c.status === 400) return { ok: false, code: "bad-id" }; // uid 格式非法（服务端白名单校验）
    if (c.status !== 200 || !c.json || !c.json.challenge) return { ok: false, code: "network" };
    const authKey = await deriveAuthKey(password, c.json.salt, c.json.iter || ITER_DEFAULT);
    const proof = await hmacHex(authKey, c.json.challenge);
    const r = await apiPost("/api/login", { uid: id, challenge: c.json.challenge, proof });
    if (r.status === 401) return { ok: false, code: "bad-login" }; // ID 不存在与密码错误统一提示，防枚举
    if (r.status !== 200 || !r.json || !r.json.session) return { ok: false, code: "network" };
    applyAuth(id, r.json.session);
    // 重登录仲裁：本账号缓存里有未同步改动、且云端已被推进、且内容确实不同 → 强制仲裁（不丢本地改动）
    const cached = readCache(id);
    const d = r.json.data;
    const cloudSavedAt = r.json.savedAt || "";
    if (cached?.dirty && d && cloudSavedAt !== cached.savedAt &&
        JSON.stringify(ensureShape(d)) !== JSON.stringify(cached.data)) {
      conflictCloudSavedAtRef.current = cloudSavedAt;
      baseSavedAtRef.current = cached.savedAt;
      dirtyRef.current = true;
      setData(cached.data);
      setSaveState("conflict");
      setError("云端有其他设备的修改，请在设置中选择以本地或云端为准");
      setStatus("ready");
      return { ok: true };
    }
    if (d) {
      const shaped = ensureShape(d);
      setData(shaped);
      writeCache(id, shaped, r.json.savedAt || "", false);
      baseSavedAtRef.current = r.json.savedAt || "";
      setSavedAt(baseSavedAtRef.current);
      dirtyRef.current = false;
    } else {
      const fresh = defaultData();
      dirtyRef.current = true;
      setData(fresh);
      writeCache(id, fresh, "", true);
      baseSavedAtRef.current = "";
      enqueueSave(fresh);
    }
    setError("");
    setStatus("ready");
    setSaveState("saved");
    return { ok: true };
  }, [applyAuth]);

  /* 注册：派生 authKey 提交，随后立即落一份默认数据 */
  const register = useCallback(async (id, password) => {
    const salt = randomHex(16);
    const authKey = await deriveAuthKey(password, salt, ITER_DEFAULT);
    const r = await apiPost("/api/register", { uid: id, salt, authKey, iter: ITER_DEFAULT });
    if (r.status === 409) return { ok: false, code: "exists" };
    if (r.status !== 200 || !r.json || !r.json.session) {
      return { ok: false, code: r.status === 400 && r.json && r.json.error ? "bad-id" : "network" };
    }
    applyAuth(id, r.json.session);
    const fresh = defaultData();
    setData(fresh);
    writeCache(id, fresh, "", true);
    baseSavedAtRef.current = "";
    dirtyRef.current = true;
    setError("");
    setStatus("ready");
    setSaveState("saved");
    enqueueSave(fresh);
    return { ok: true };
  }, [applyAuth]);

  /* 手动从云端重新拉取（冲突仲裁「以云端为准」；返回 {ok, error} 供调用方判定成败） */
  const reload = useCallback(async () => {
    if (!sessionRef.current) return { ok: false, error: "尚未登录" };
    setStatus("loading");
    setError("");
    const ok = await adoptCloud();
    if (ok) {
      setStatus("ready");
      return { ok: true };
    }
    const msg = "网络异常，请稍后重试";
    setError(msg);
    setStatus("ready");
    return { ok: false, error: msg };
  }, [adoptCloud]);

  const logout = useCallback(() => {
    clearAuth();
    resetToIdle();
    try { sessionStorage.removeItem("gatePrefillUid"); } catch { /* 无痕模式等 */ }
  }, [clearAuth, resetToIdle]);

  /* 历史快照：列表 + 恢复（恢复动作在服务端也留快照，可再次撤销） */
  const listSnaps = useCallback(async () => {
    if (!sessionRef.current) return { ok: false, error: "尚未登录" };
    const r = await apiListSnaps(sessionRef.current);
    if (r.status === 200 && r.json && Array.isArray(r.json.snaps)) return { ok: true, snaps: r.json.snaps };
    if (r.status === 401) { resetToIdle(); return { ok: false, error: "登录已过期，请重新登录" }; }
    return { ok: false, error: r.status === 0 ? "网络异常" : `云端异常 (HTTP ${r.status})` };
  }, [resetToIdle]);
  const restoreSnap = useCallback(async (key) => {
    if (!sessionRef.current) return { ok: false, error: "尚未登录" };
    const r = await apiRestoreSnap(sessionRef.current, key);
    if (r.status === 200 && r.json && r.json.data) {
      const d = ensureShape(r.json.data);
      dataRef.current = d;
      setData(d);
      baseSavedAtRef.current = r.json.savedAt || "";
      dirtyRef.current = false;
      conflictCloudSavedAtRef.current = "";
      writeCache(uidRef.current, d, baseSavedAtRef.current, false);
      setSavedAt(baseSavedAtRef.current);
      setSaveState("saved");
      setError("");
      broadcastSync({ type: "sync", uid: uidRef.current, savedAt: baseSavedAtRef.current, data: d });
      return { ok: true };
    }
    if (r.status === 401) { resetToIdle(); return { ok: false, error: "登录已过期，请重新登录" }; }
    return { ok: false, error: r.status === 0 ? "网络异常" : `恢复失败 (HTTP ${r.status})` };
  }, [resetToIdle]);

  /** 整份替换（导入备份/书签）：立即以本地为准上传；冲突状态下借用云端版本号完成覆盖 */
  const replaceAll = useCallback(async (imported) => {
    if (!sessionRef.current) return { ok: false, error: "尚未登录" };
    const d = ensureShape(typeof imported === "string" ? safeParse(imported) : imported);
    if (!d) return { ok: false, error: "数据格式无法识别" };
    dirtyRef.current = true;
    dataRef.current = d;
    setData(d);
    writeCache(uidRef.current, d, baseSavedAtRef.current, true);
    await saveNow();
    return { ok: true };
  }, [saveNow]);

  /** 导入浏览器书签/HTML 书签树：追加为新分组并立即上传（重复 URL 自动跳过），返回导入统计 */
  const importBookmarks = useCallback(async (tree) => {
    if (!sessionRef.current) return { ok: false, error: "尚未登录" };
    const total = countLinks(tree);
    if (!total) return { ok: false, error: "没有可导入的书签" };
    const sink = { skipped: 0 };
    mutate(mergeImportedTree(tree, sink));
    await saveNow();
    return { ok: true, count: total - sink.skipped, skipped: sink.skipped };
  }, [mutate, saveNow]);

  /* ---------- 删除撤销：删除前快照整份数据，6s 内可一键恢复 ---------- */
  const [undoInfo, setUndoInfo] = useState(null); // {label, snapshot, until}
  const undoTimer = useRef(null);
  const removeWithUndo = useCallback((label, doRemove) => {
    const snapshot = dataRef.current;
    doRemove();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const info = { label, snapshot, until: Date.now() + 6000 };
    setUndoInfo(info);
    undoTimer.current = setTimeout(() => setUndoInfo(null), 6000);
  }, []);
  const undoRemove = useCallback(() => {
    setUndoInfo((info) => {
      if (info && info.until > Date.now() && info.snapshot) mutate(() => info.snapshot);
      return null;
    });
  }, [mutate]);
  const dismissUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoInfo(null);
  }, []);

  /* ---------- CRUD ---------- */
  const addItem = useCallback((folderId, item) => {
    const id = item.id || genId("b");
    mutate((d) => addChildToFolder(d, folderId, { id, dateAdded: Date.now(), ...item }));
    return id;
  }, [mutate]);
  /** 批量收录：一次 mutate 只触发一次保存；返回与 items 对应的 id 数组（无标题的条目可稍后补名） */
  const addItems = useCallback((folderId, items) => {
    const ids = [];
    mutate((d) => items.reduce((acc, it) => {
      const id = it.id || genId("b");
      ids.push(id);
      return addChildToFolder(acc, folderId, { id, dateAdded: Date.now(), ...it });
    }, d));
    return ids;
  }, [mutate]);
  const addFolder = useCallback((parentOrTitle, maybeTitle) => {
    if (maybeTitle !== undefined) return mutate((d) => addChildToFolder(d, parentOrTitle, { id: genId("f"), title: maybeTitle, children: [] }));
    return mutate((d) => ({ ...d, folders: [...d.folders, { id: genId("f"), title: parentOrTitle, children: [] }] }));
  }, [mutate]);
  const renameNode = useCallback((id, title) => mutate((d) => updateItem(d, id, { title })), [mutate]);
  const updateNode = useCallback((id, patch) => mutate((d) => updateItem(d, id, patch)), [mutate]);
  const removeNode = useCallback((id) => removeWithUndo("已删除分组或书签", () => mutate((d) => removeItem(d, id))), [mutate, removeWithUndo]);
  const moveNode = useCallback((id, dir) => mutate((d) => moveItem(d, id, dir)), [mutate]);
  const reorderNode = useCallback((id, newIndex) => mutate((d) => reorderItem(d, id, newIndex)), [mutate]);
  /** 批量移动条目到目标分组/子分组（跨层级、防成环） */
  const moveNodesTo = useCallback((ids, folderId) => mutate((d) => moveToFolderSvc(d, ids, folderId)), [mutate]);
  const addIframe = useCallback((widget) => mutate((d) => ({ ...d, iframeWidgets: [...(d.iframeWidgets || []), { id: genId("iw"), ...widget }] })), [mutate]);
  const removeIframe = useCallback((id) => removeWithUndo("已删除小部件", () => mutate((d) => ({ ...d, iframeWidgets: (d.iframeWidgets || []).filter((w) => w.id !== id) }))), [mutate, removeWithUndo]);
  const updateIframe = useCallback((id, patch) => mutate((d) => ({ ...d, iframeWidgets: (d.iframeWidgets || []).map((w) => (w.id === id ? { ...w, ...patch } : w)) })), [mutate]);
  const setLayout = useCallback((layout) => mutate((d) => ({ ...d, layout })), [mutate]);
  const setSettings = useCallback((patch) => mutate((d) => ({ ...d, settings: { ...SETTINGS_DEFAULTS, ...d.settings, ...patch } })), [mutate]);

  return {
    uid, hasUid, data, status, error, saveState, savedAt,
    login, register, reload, saveNow, logout,
    listSnaps, restoreSnap, replaceAll, importBookmarks,
    addItem, addItems, addFolder, renameNode, updateNode, removeNode, moveNode, reorderNode, moveNodesTo,

    addIframe, removeIframe, updateIframe,
    setLayout, setSettings,
    undoInfo, undoRemove, dismissUndo,
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
