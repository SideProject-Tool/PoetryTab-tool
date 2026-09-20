import { CLOUD_SYNC } from "./constants";

/**
 * 云端收藏 v2 数据契约（扩展与网页版共用的唯一数据源）
 *
 * data = {
 *   v: 2,
 *   folders: [ { id, title, children: [书签|子文件夹...] } ],   // 顶层文件夹 = 看板卡片
 *   quickSites: [ { id, title, url, favicon } ],
 *   iframeWidgets: [ { id, title, url, width } ],
 *   settings: { theme, engine, cats: [key] }
 * }
 * 书签 = { id, title, url, dateAdded }；文件夹 = { id, title, children: [] }
 * 服务端包装：{ savedAt, data }；历史快照保留最近 5 份
 */

export const SETTINGS_DEFAULTS = {
  theme: "sync",
  engine: "baidu",
  cats: ["i"],
};

const ROOT_FALLBACK = "f_bar";

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** v1（Chrome 书签镜像）→ v2（独立收藏夹）迁移 */
export function migrate(raw) {
  if (raw && raw.v === 2) return raw;
  const b = (raw && raw.bookmarks) || {};
  const bar = Array.isArray(b.bar) ? b.bar : [];
  const other = Array.isArray(b.other) ? b.other : [];
  const synced = Array.isArray(b.synced) ? b.synced : [];
  const folders = [];
  if (bar.length > 0) folders.push({ id: "f_bar", title: "书签栏", children: bar });
  const otherChildren = other.concat(synced);
  if (otherChildren.length > 0) folders.push({ id: "f_other", title: "其他书签", children: otherChildren });
  return {
    v: 2,
    folders,
    quickSites: Array.isArray(raw?.quickSites) ? raw.quickSites : [],
    iframeWidgets: [],
    settings: { ...SETTINGS_DEFAULTS },
  };
}

function ensureShape(data) {
  const d = migrate(data);
  d.folders = Array.isArray(d.folders) ? d.folders : [];
  d.quickSites = Array.isArray(d.quickSites) ? d.quickSites : [];
  d.iframeWidgets = Array.isArray(d.iframeWidgets) ? d.iframeWidgets : [];
  d.settings = { ...SETTINGS_DEFAULTS, ...(d.settings || {}) };
  if (d.settings.cats && !Array.isArray(d.settings.cats)) d.settings.cats = SETTINGS_DEFAULTS.cats;
  return d;
}

/** 拉取指定用户的收藏（自动迁移旧格式） */
export async function fetchCollection(uid, token) {
  const res = await fetch(`${CLOUD_SYNC.url}/api/sync/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`加载失败 (HTTP ${res.status})`);
  const json = await res.json();
  return ensureShape(json.data);
}

/** 保存整份收藏 */
export async function saveCollection(uid, token, data) {
  const res = await fetch(`${CLOUD_SYNC.url}/api/sync/${encodeURIComponent(uid)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`保存失败 (HTTP ${res.status})`);
  return res.json();
}

/* ---------- 树操作（全部返回新引用，配合 React） ---------- */

function mapChildren(children, fn) {
  return children.map((child) => fn(child) || (child.children ? { ...child, children: mapChildren(child.children, fn) } : child));
}

/** 深度遍历修改：fn 收到每个节点（含文件夹），返回修改后的节点或 undefined 表示原样 */
export function updateTree(data, fn) {
  return { ...data, folders: mapChildren(data.folders, fn) };
}

/** 按 id 找节点（返回 {node, parentChildren}） */
export function findNode(data, id) {
  let found = null;
  const walk = (children) => {
    for (const child of children) {
      if (child.id === id) {
        found = { node: child, siblings: children };
        return true;
      }
      if (child.children && walk(child.children)) return true;
    }
    return false;
  };
  walk(data.folders);
  return found;
}

export function addChildToFolder(data, folderId, item) {
  return updateTree(data, (node) => {
    if (node.id === folderId && node.children) {
      return { ...node, children: [item, ...node.children] };
    }
    return undefined;
  });
}

export function updateItem(data, itemId, patch) {
  return updateTree(data, (node) => {
    if (node.id === itemId) return { ...node, ...patch };
    if (node.children) {
      return {
        ...node,
        children: node.children.map((c) => (c.id === itemId ? { ...c, ...patch } : c)),
      };
    }
    return undefined;
  });
}

export function removeItem(data, itemId) {
  const cut = (children) =>
    children.filter((c) => c.id !== itemId).map((c) => (c.children ? { ...c, children: cut(c.children) } : c));
  return { ...data, folders: cut(data.folders) };
}

/** 展平为搜索用列表：[{item, path}] */
export function flattenForSearch(folders) {
  const out = [];
  const walk = (nodes, path) => {
    for (const node of nodes) {
      if (node.children) walk(node.children, [...path, node.title]);
      else if (node.url) out.push({ ...node, path: path.join(" / ") });
    }
  };
  walk(folders, []);
  return out;
}

export { uid as genId, ROOT_FALLBACK };

/** 瓷贴首字头像配色 */
const TILE_PALETTE = ["#c96f5e", "#7b9e56", "#5e89c9", "#b0785e", "#8a6fc9", "#c95e8a", "#5eb0a5", "#c9a35e"];
export function paletteColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return TILE_PALETTE[Math.abs(h) % TILE_PALETTE.length];
}
