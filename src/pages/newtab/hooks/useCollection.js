import { useState, useEffect, useCallback, useRef } from "react";
import { CLOUD_SYNC } from "../services/constants";
import {
  fetchCollection,
  saveCollection,
  migrate,
  updateTree,
  addChildToFolder,
  updateItem,
  removeItem,
  genId,
  SETTINGS_DEFAULTS,
} from "../services/collection";

const UID_KEY = "protonCollectUid";
const CACHE_KEY = "protonCollectionCache";
const SAVE_DEBOUNCE = 700;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.v === 2 ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* 容量不足时放弃缓存 */ }
}

/**
 * 云端收藏（独立于浏览器书签）的唯一数据层。
 * 记住用户 ID 后打开即自动加载（本地缓存先行渲染），任何修改防抖自动保存回 R2。
 */
export function useCollection() {
  const [uid, setUid] = useState(() => localStorage.getItem(UID_KEY) || "");
  const [data, setData] = useState(() => readCache());
  const [status, setStatus] = useState("idle"); // idle | loading | ready | notfound | error
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("saved"); // saved | saving | error
  const [savedAt, setSavedAt] = useState("");
  const dataRef = useRef(data);
  const saveTimer = useRef(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(async (id) => {
    setStatus("loading");
    setError("");
    try {
      const result = await fetchCollection(id, CLOUD_SYNC.token);
      if (result === null) {
        setStatus("notfound");
        return "notfound";
      }
      setData(result);
      writeCache(result);
      setStatus("ready");
      return "ok";
    } catch (e) {
      setError(e.message);
      setStatus("error");
      return "error";
    }
  }, []);

  const persist = useCallback(
    async (snapshot) => {
      setSaveState("saving");
      try {
        const res = await saveCollection(uid, CLOUD_SYNC.token, snapshot);
        setSavedAt(res.savedAt || "");
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setError(e.message);
      }
    },
    [uid]
  );

  const flush = useCallback(async () => {
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    await persist(dataRef.current);
    savingRef.current = false;
    if (pendingRef.current) {
      pendingRef.current = false;
      await persist(dataRef.current);
    }
  }, [persist]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(), SAVE_DEBOUNCE);
  }, [flush]);

  /** 所有修改经此入口：变更 → 防抖自动保存 */
  const mutate = useCallback(
    (fn) => {
      if (!uid) return;
      setData((prev) => {
        const next = fn(prev);
        dataRef.current = next;
        writeCache(next);
        return next;
      });
      scheduleSave();
    },
    [uid, scheduleSave]
  );

  const create = useCallback(
    async (id) => {
      setUid(id);
      localStorage.setItem(UID_KEY, id);
      const fresh = {
        v: 2,
        folders: [{ id: genId("f"), title: "我的收藏", children: [] }],
        quickSites: [],
        iframeWidgets: [],
        settings: { ...SETTINGS_DEFAULTS },
      };
      setData(fresh);
      writeCache(fresh);
      setStatus("ready");
      await persist(fresh);
      return "ok";
    },
    [persist]
  );

  /** 打开/切换用户；notfound 时由调用方决定是否 create */
  const enter = useCallback(
    async (id, opts) => {
      opts = opts || {};
      setUid(id);
      localStorage.setItem(UID_KEY, id);
      setStatus("loading");
      const cached = readCache();
      if (cached) setData(cached);
      const r = await load(id);
      if (r === "notfound" && opts.createIfMissing) return create(id);
      return r;
    },
    [load, create]
  );

  const saveNow = useCallback(() => {
    if (!uid || !dataRef.current) return Promise.resolve();
    return flush();
  }, [flush]);

  /* ---------- CRUD ---------- */
  const addItem = useCallback(
    (folderId, item) => mutate((d) => addChildToFolder(d, folderId, { id: genId("b"), dateAdded: Date.now(), ...item })),
    [mutate]
  );
  const addFolder = useCallback(
    (parentOrTitle, maybeTitle) => {
      if (maybeTitle !== undefined) {
        return mutate((d) => addChildToFolder(d, parentOrTitle, { id: genId("f"), title: maybeTitle, children: [] }));
      }
      return mutate((d) => ({ ...d, folders: [...d.folders, { id: genId("f"), title: parentOrTitle, children: [] }] }));
    },
    [mutate]
  );
  const renameNode = useCallback((id, title) => mutate((d) => updateItem(d, id, { title })), [mutate]);
  const updateNode = useCallback((id, patch) => mutate((d) => updateItem(d, id, patch)), [mutate]);
  const removeNode = useCallback((id) => mutate((d) => removeItem(d, id)), [mutate]);

  const addQuickSite = useCallback(
    (site) => mutate((d) => ({ ...d, quickSites: [{ id: genId("qs"), favicon: "", ...site }, ...d.quickSites] })),
    [mutate]
  );
  const updateQuickSite = useCallback(
    (id, patch) => mutate((d) => ({ ...d, quickSites: d.quickSites.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    [mutate]
  );
  const removeQuickSite = useCallback(
    (id) => mutate((d) => ({ ...d, quickSites: d.quickSites.filter((s) => s.id !== id) })),
    [mutate]
  );

  const setLayout = useCallback(
    (layout) => mutate((d) => ({ ...d, layout })),
    [mutate]
  );

  const addIframe = useCallback(
    (widget) => mutate((d) => ({ ...d, iframeWidgets: [...d.iframeWidgets, { id: genId("iw"), ...widget }] })),
    [mutate]
  );
  const removeIframe = useCallback(
    (id) => mutate((d) => ({ ...d, iframeWidgets: d.iframeWidgets.filter((w) => w.id !== id) })),
    [mutate]
  );

  const setSettings = useCallback(
    (patch) => mutate((d) => ({ ...d, settings: { ...SETTINGS_DEFAULTS, ...d.settings, ...patch } })),
    [mutate]
  );

  return {
    uid,
    hasUid: Boolean(uid),
    data,
    status,
    error,
    saveState,
    savedAt,
    load,
    enter,
    create,
    saveNow,
    addItem,
    addFolder,
    renameNode,
    updateNode,
    removeNode,
    addQuickSite,
    updateQuickSite,
    removeQuickSite,
    addIframe,
    removeIframe,
    setLayout,
    setSettings,
  };
}
