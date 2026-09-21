/**
 * 收藏数据树的纯函数操作（全部返回新引用，配合 React）。
 * 数据形状：{ folders: [ {id, title, children: [书签|子文件夹]} ], quickSites, iframeWidgets, settings, layout }
 * 书签 = { id, title, url, dateAdded }
 */

export const SETTINGS_DEFAULTS = {
  theme: "sync",
  engine: "baidu",
  cats: ["i"],
};

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 仅接受 http/https；缺协议自动补 https://；其他协议（如 javascript:）返回 null */
export function safeUrl(input) {
  const v = String(input || "").trim();
  if (!v) return null;
  const candidate = /^https?:\/\//i.test(v) ? v : "https://" + v;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function mapChildren(children, fn) {
  return children.map((child) => fn(child) || (child.children ? { ...child, children: mapChildren(child.children, fn) } : child));
}

function updateTree(data, fn) {
  return { ...data, folders: mapChildren(data.folders, fn) };
}

/** 按 id 找节点（返回 {node, siblings}） */
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

/** 在同级列表（书签/子文件夹所在的分组，或常用网站）中上移/下移；dir: -1 上移，1 下移；不可移动时返回原引用 */
export function moveItem(data, itemId, dir) {
  const shift = (list) => {
    const idx = list.findIndex((c) => c.id === itemId);
    if (idx < 0) return null;
    const to = idx + dir;
    if (to < 0 || to >= list.length) return null;
    const next = [...list];
    next.splice(to, 0, next.splice(idx, 1)[0]);
    return next;
  };
  if (Array.isArray(data.quickSites)) {
    const q = shift(data.quickSites);
    if (q) return { ...data, quickSites: q };
  }
  const walk = (children) => {
    const moved = shift(children);
    if (moved) return moved;
    for (const c of children) {
      if (c.children) {
        const sub = walk(c.children);
        if (sub) return children.map((x) => (x.id === c.id ? { ...x, children: sub } : x));
      }
    }
    return null;
  };
  const folders = walk(data.folders || []);
  return folders ? { ...data, folders } : data;
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

export { uid as genId };
