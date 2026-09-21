import { useState, useEffect, useCallback, useRef } from "react";
import { CLOUD_SYNC } from "../services/constants";
import {
  addChildToFolder,
  updateItem,
  removeItem,
  genId,
  SETTINGS_DEFAULTS,
} from "../services/collection";

const UID_KEY = "poetryTabUid";
const CACHE_KEY = "poetryTabCache";
const AUTH_KEY = "poetryTabAuth";
const SAVE_DEBOUNCE = 700;

/** 密码 → 认证令牌（SHA-256 hex，异步 SubtleCrypto） */
async function computeAuth(password, uid) {
  const data = new TextEncoder().encode(password + ":" + uid);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.v === 3 ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

export function useCollection() {
  const [uid, setUid] = useState(() => localStorage.getItem(UID_KEY) || "");
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(AUTH_KEY) || "");
  const authTokenRef = useRef(authToken);
  authTokenRef.current = authToken;

  const [data, setData] = useState(() => readCache());
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [savedAt, setSavedAt] = useState("");
  const dataRef = useRef(data);
  const saveTimer = useRef(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => { dataRef.current = data; }, [data]);

  const fetchCollection = useCallback(async (id, token, userAuth) => {
    const res = await fetch(`${CLOUD_SYNC.url}/api/sync/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}`, "X-Auth": userAuth },
    });
    if (res.status === 401) return { error: "auth-failed" };
    if (res.status === 404) return { error: "notfound" };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  const saveCollection = useCallback(async (id, token, snapshot, userAuth) => {
    const res = await fetch(`${CLOUD_SYNC.url}/api/sync/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Auth": userAuth,
      },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  const load = useCallback(async (id, token, pwToken) => {
    setStatus("loading");
    setError("");
    try {
      const result = await fetchCollection(id, token, pwToken);
      if (result.error) {
        setStatus(result.error);
        setError(result.error);
        return result.error;
      }
      const d = result.data || result;
      setData(d);
      writeCache(d);
      setStatus("ready");
      return "ok";
    } catch (e) {
      setError(e.message);
      setStatus("error");
      return "error";
    }
  }, [fetchCollection]);

  const persist = useCallback(async (snapshot) => {
    setSaveState("saving");
    try {
      const res = await saveCollection(uid, CLOUD_SYNC.token, snapshot, authTokenRef.current);
      setSavedAt(res.savedAt || "");
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setError(e.message);
    }
  }, [uid, saveCollection]);

  const flush = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return; }
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

  const mutate = useCallback((fn) => {
    if (!uid) return;
    setData((prev) => {
      const next = fn(prev);
      dataRef.current = next;
      writeCache(next);
      return next;
    });
    scheduleSave();
  }, [uid, scheduleSave]);

  const create = useCallback(async (id, password) => {
    setUid(id);
    localStorage.setItem(UID_KEY, id);
    const pwToken = await computeAuth(password, id);
    setAuthToken(pwToken);
    localStorage.setItem(AUTH_KEY, pwToken);
    authTokenRef.current = pwToken;
    const fresh = {
      v: 3,
      auth: pwToken,
      folders: [{ id: genId("f"), title: "我的收藏", children: [] }],
      quickSites: [],
      iframeWidgets: [],
      settings: { theme: "sync", engine: "baidu", cats: ["i"] },
      layout: [],
    };
    setData(fresh);
    writeCache(fresh);
    setStatus("ready");
    await persist(fresh);
    return "ok";
  }, [persist]);

  const enter = useCallback(async (id, password) => {
    setUid(id);
    localStorage.setItem(UID_KEY, id);
    const pwToken = await computeAuth(password, id);
    setAuthToken(pwToken);
    localStorage.setItem(AUTH_KEY, pwToken);
    authTokenRef.current = pwToken;
    const cached = readCache();
    if (cached) setData(cached);
    return load(id, CLOUD_SYNC.token, pwToken);
  }, [load]);

  const saveNow = useCallback(async () => {
    if (!uid || !dataRef.current) return;
    await flush();
  }, [uid, flush]);

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
  const setLayout = useCallback((layout) => mutate((d) => ({ ...d, layout })), [mutate]);
  const setSettings = useCallback((patch) => mutate((d) => ({ ...d, settings: { theme: "sync", engine: "baidu", cats: ["i"], ...d.settings, ...patch } })), [mutate]);

  return {
    uid, hasUid: Boolean(uid), data, status, error, saveState, savedAt,
    load, enter, create, saveNow,
    addItem, addFolder, renameNode, updateNode, removeNode,
    addQuickSite, updateQuickSite, removeQuickSite,
    setLayout, setSettings,
  };
}
