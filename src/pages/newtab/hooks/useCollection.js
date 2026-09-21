import { useState, useEffect, useCallback, useRef } from "react";
import { CLOUD_SYNC } from "../services/constants";
import {
  addChildToFolder,
  updateItem,
  removeItem,
  genId,
  SETTINGS_DEFAULTS,
} from "../services/collection";

/*
 * 用户体系与云同步（v4 全新方案，与旧版协议不兼容）
 *
 * 认证流程（密码永不明文传输/存储）：
 *   注册  客户端生成随机盐 → PBKDF2-SHA256(密码, 盐, 600k) → authKey 提交
 *   登录  /api/challenge 拿一次性挑战 + 盐 → 重派生 authKey → HMAC(authKey, challenge) 应答
 *   会话  登录后持无状态令牌（30 天），此后数据读写仅凭令牌
 *
 * 状态机 status：
 *   idle   未登录（显示引导门）
 *   boot   持会话启动恢复中
 *   loading 手动加载中
 *   ready  已就绪
 *   error  网络异常（error 必有可读信息）
 *
 * localStorage：pt.uid / pt.session / pt.cache
 */

const UID_KEY = "pt.uid";
const SESSION_KEY = "pt.session";
const CACHE_KEY = "pt.cache";
const SAVE_DEBOUNCE = 700;
const ITER_DEFAULT = 600000;

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

/* ---------- API ---------- */
async function apiPost(path, body) {
  try {
    const res = await fetch(CLOUD_SYNC.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null }; // 网络不可达
  }
}
async function apiGetData(session) {
  try {
    const res = await fetch(CLOUD_SYNC.url + "/api/data", {
      headers: { Authorization: `Bearer ${session}` },
    });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}
async function apiPutData(session, data, baseSavedAt) {
  try {
    const res = await fetch(CLOUD_SYNC.url + "/api/data", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "application/json",
        "X-Base-SavedAt": baseSavedAt || "",
      },
      body: JSON.stringify(data),
    });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

/* ---------- 本地缓存 ---------- */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.folders) ? parsed : null;
  } catch {
    return null;
  }
}
function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* 容量不足时放弃缓存 */ }
}
function defaultData() {
  return {
    folders: [{ id: genId("f"), title: "我的收藏", children: [] }],
    quickSites: [],
    iframeWidgets: [],
    settings: { ...SETTINGS_DEFAULTS },
    layout: [],
  };
}
/** 云端数据兜底：数组字段缺失/损坏时补默认值 */
function ensureShape(d) {
  if (!d || typeof d !== "object") return defaultData();
  return {
    ...d,
    folders: Array.isArray(d.folders) ? d.folders : [],
    quickSites: Array.isArray(d.quickSites) ? d.quickSites : [],
    iframeWidgets: Array.isArray(d.iframeWidgets) ? d.iframeWidgets : [],
    layout: Array.isArray(d.layout) ? d.layout : [],
    settings: { ...SETTINGS_DEFAULTS, ...(d.settings || {}) },
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

/* ---------- Hook ---------- */
export function useCollection() {
  const [uid, setUid] = useState(() => localStorage.getItem(UID_KEY) || "");
  const [session, setSession] = useState(() => localStorage.getItem(SESSION_KEY) || "");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const hasUid = Boolean(uid && session);

  const [data, setData] = useState(() => readCache());
  const [status, setStatus] = useState(() => (session ? "boot" : "idle"));
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("saved"); // saved | saving | error
  const [savedAt, setSavedAt] = useState("");
  const dataRef = useRef(data);
  const saveTimer = useRef(null);
  const baseSavedAtRef = useRef(""); // 乐观锁：客户端持有的云端版本（savedAt），冲突时服务端拒绝
  const dirtyRef = useRef(false); // 有未落库的本地改动
  useEffect(() => { dataRef.current = data; }, [data]);

  const applyAuth = useCallback((id, token) => {
    sessionRef.current = token; // 同步更新：登录/注册后立即入队的保存必须拿到新会话
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

  /* 落库（队列消费端）：携带版本号乐观锁；401 会话过期自动登出；409 冲突让位于云端 */
  const persistNow = useCallback(async (snapshot) => {
    setSaveState("saving");
    const r = await apiPutData(sessionRef.current, snapshot, baseSavedAtRef.current);
    if (r.status === 200) {
      baseSavedAtRef.current = (r.json && r.json.savedAt) || "";
      dirtyRef.current = false;
      setSavedAt(baseSavedAtRef.current);
      setSaveState("saved");
      return;
    }
    if (r.status === 401) {
      // 会话过期：本地未同步的改动无法上云，回到登录门（下次登录以云端为准）
      clearAuth();
      localStorage.removeItem(CACHE_KEY);
      setUid("");
      setSession("");
      setData(null);
      setStatus("idle");
      setSaveState("saved");
      setSavedAt("");
      setError("");
      return;
    }
    if (r.status === 409) {
      // 其他设备已先保存：载入云端最新版，本地未同步的改动让位
      baseSavedAtRef.current = (r.json && r.json.savedAt) || "";
      const latest = await apiGetData(sessionRef.current);
      if (latest.status === 200 && latest.json && latest.json.data) {
        const d = ensureShape(latest.json.data);
        dataRef.current = d;
        setData(d);
        writeCache(d);
        baseSavedAtRef.current = latest.json.savedAt || "";
        dirtyRef.current = false;
      }
      setSaveState("error");
      setError("检测到其他设备的修改，已载入云端最新版本");
      return;
    }
    setSaveState("error");
    setError(r.status === 0 ? "网络异常，保存未完成" : `保存失败 (HTTP ${r.status})`);
  }, [clearAuth]);
  useEffect(() => {
    persistFn = persistNow;
    return () => { persistFn = null; };
  }, [persistNow]);

  /* 启动恢复：持会话则静默拉取；令牌失效回门禁 */
  useEffect(() => {
    if (!sessionRef.current) return;
    let alive = true;
    (async () => {
      const r = await apiGetData(sessionRef.current);
      if (!alive) return;
      if (r.status === 200) {
        const d = r.json && r.json.data;
        if (d) {
          const shaped = ensureShape(d);
          setData(shaped);
          writeCache(shaped);
          baseSavedAtRef.current = (r.json && r.json.savedAt) || "";
          setSavedAt(baseSavedAtRef.current);
          setStatus("ready");
        } else {
          const fresh = defaultData();
          setData(fresh);
          setStatus("ready");
          enqueueSave(fresh); // 有会话但云端无数据（注册后未落库过）：补一份默认数据
        }
        return;
      }
      if (r.status === 401) {
        clearAuth();
        setData(null);
        setStatus("idle");
        return;
      }
      setError(r.status === 0 ? "无法连接云端，请检查网络后点击重试" : `云端异常 (HTTP ${r.status})，请稍后重试`);
      setStatus("error");
    })();
    return () => { alive = false; };
  }, [clearAuth]);

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

  /** 所有修改经此入口：变更 → 防抖自动保存 */
  const mutate = useCallback((fn) => {
    if (!sessionRef.current) return;
    dirtyRef.current = true;
    setData((prev) => {
      const next = fn(prev);
      dataRef.current = next;
      writeCache(next);
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  /* 关页/切走前的兑底落库：防抖窗口内关闭标签页不再丢改动（keepalive 尽力而为） */
  useEffect(() => {
    const flushOnHide = () => {
      if (!dirtyRef.current || !sessionRef.current || !dataRef.current) return;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      dirtyRef.current = false;
      try {
        fetch(CLOUD_SYNC.url + "/api/data", {
          method: "PUT",
          keepalive: true,
          headers: {
            Authorization: `Bearer ${sessionRef.current}`,
            "Content-Type": "application/json",
            "X-Base-SavedAt": baseSavedAtRef.current,
          },
          body: JSON.stringify(dataRef.current),
        }).catch(() => { /* 卸载期尽力而为 */ });
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
    if (c.status === 404) return { ok: false, code: "bad-id" };
    if (c.status !== 200 || !c.json || !c.json.challenge) return { ok: false, code: "network" };
    const authKey = await deriveAuthKey(password, c.json.salt, c.json.iter || ITER_DEFAULT);
    const proof = await hmacHex(authKey, c.json.challenge);
    const r = await apiPost("/api/login", { uid: id, challenge: c.json.challenge, proof });
    if (r.status === 401) return { ok: false, code: "bad-password" };
    if (r.status === 404) return { ok: false, code: "bad-id" };
    if (r.status !== 200 || !r.json || !r.json.session) return { ok: false, code: "network" };
    applyAuth(id, r.json.session);
    const d = r.json.data;
    if (d) {
      const shaped = ensureShape(d);
      setData(shaped);
      writeCache(shaped);
      baseSavedAtRef.current = r.json.savedAt || "";
      setSavedAt(baseSavedAtRef.current);
    } else {
      const fresh = defaultData();
      setData(fresh);
      writeCache(fresh);
      baseSavedAtRef.current = "";
      enqueueSave(fresh);
    }
    setError("");
    setStatus("ready");
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
    writeCache(fresh);
    baseSavedAtRef.current = "";
    dirtyRef.current = true;
    setError("");
    setStatus("ready");
    enqueueSave(fresh);
    return { ok: true };
  }, [applyAuth]);

  /* 手动从云端重新拉取 */
  const reload = useCallback(async () => {
    if (!sessionRef.current) return;
    setStatus("loading");
    setError("");
    const r = await apiGetData(sessionRef.current);
    if (r.status === 200 && r.json && r.json.data) {
      const shaped = ensureShape(r.json.data);
      setData(shaped);
      writeCache(shaped);
      baseSavedAtRef.current = r.json.savedAt || "";
      setSavedAt(baseSavedAtRef.current);
      dirtyRef.current = false;
      setStatus("ready");
    } else if (r.status === 401) {
      clearAuth();
      localStorage.removeItem(CACHE_KEY);
      setData(null);
      setStatus("idle");
    } else {
      setError(r.status === 0 ? "网络异常，请稍后重试" : `云端异常 (HTTP ${r.status})`);
      setStatus("error");
    }
  }, [clearAuth]);

  const logout = useCallback(() => {
    clearAuth();
    localStorage.removeItem(CACHE_KEY);
    try { sessionStorage.removeItem("gatePrefillUid"); } catch { /* 无痕模式等 */ }
    baseSavedAtRef.current = "";
    dirtyRef.current = false;
    setUid("");
    setSession("");
    setData(null);
    setStatus("idle");
    setError("");
    setSaveState("saved");
    setSavedAt("");
  }, [clearAuth]);

  /* ---------- CRUD ---------- */
  const addItem = useCallback((folderId, item) => mutate((d) => addChildToFolder(d, folderId, { id: genId("b"), dateAdded: Date.now(), ...item })), [mutate]);
  const addFolder = useCallback((parentOrTitle, maybeTitle) => {
    if (maybeTitle !== undefined) return mutate((d) => addChildToFolder(d, parentOrTitle, { id: genId("f"), title: maybeTitle, children: [] }));
    return mutate((d) => ({ ...d, folders: [...d.folders, { id: genId("f"), title: parentOrTitle, children: [] }] }));
  }, [mutate]);
  const renameNode = useCallback((id, title) => mutate((d) => updateItem(d, id, { title })), [mutate]);
  const updateNode = useCallback((id, patch) => mutate((d) => updateItem(d, id, patch)), [mutate]);
  const removeNode = useCallback((id) => mutate((d) => removeItem(d, id)), [mutate]);
  const addQuickSite = useCallback((site) => mutate((d) => ({ ...d, quickSites: [{ id: genId("qs"), favicon: "", ...site }, ...d.quickSites] })), [mutate]);
  const updateQuickSite = useCallback((id, patch) => mutate((d) => ({ ...d, quickSites: d.quickSites.map((s) => (s.id === id ? { ...s, ...patch } : s)) })), [mutate]);
  const removeQuickSite = useCallback((id) => mutate((d) => ({ ...d, quickSites: d.quickSites.filter((s) => s.id !== id) })), [mutate]);
  const addIframe = useCallback((widget) => mutate((d) => ({ ...d, iframeWidgets: [...(d.iframeWidgets || []), { id: genId("iw"), ...widget }] })), [mutate]);
  const removeIframe = useCallback((id) => mutate((d) => ({ ...d, iframeWidgets: (d.iframeWidgets || []).filter((w) => w.id !== id) })), [mutate]);
  const setLayout = useCallback((layout) => mutate((d) => ({ ...d, layout })), [mutate]);
  const setSettings = useCallback((patch) => mutate((d) => ({ ...d, settings: { ...SETTINGS_DEFAULTS, ...d.settings, ...patch } })), [mutate]);

  return {
    uid, hasUid, data, status, error, saveState, savedAt,
    login, register, reload, saveNow, logout,
    addItem, addFolder, renameNode, updateNode, removeNode,
    addQuickSite, updateQuickSite, removeQuickSite,
    addIframe, removeIframe,
    setLayout, setSettings,
  };
}
