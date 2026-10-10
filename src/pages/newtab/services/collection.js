/**
 * 收藏数据树的纯函数操作（全部返回新引用，配合 React）。
 * 数据形状：{ folders: [ {id, title, children: [书签|子文件夹]} ], iframeWidgets, todoWidgets, historyWidgets, settings, poemLib, layout }
 * 书签 = { id, title, url, dateAdded }
 */

export const SETTINGS_DEFAULTS = {
  theme: "sync",
  engine: "baidu",
  cats: ["i"],
  cols: "auto", // 看板列数：auto（按宽度 5/4/3/2）或 2-5；<640px 一律单列
  hiddenCards: [],
  poemSpace: 0, // 诗词区最小高度（像素，0=自然高度）；诗词在区域内垂直居中，下方内容随之整体下移
  pageBgLight: "", // 浅色主题页面底色（#RGB/#RRGGBB，空=主题默认）
  pageBgDark: "", // 深色主题页面底色（空=主题默认）
  syncFreq: 10, // 启动校验频率（分钟）：开新标签页时超过该间隔才向云端校验一次（10/30/60）
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
  // 全层递归：条目可能在任意深度的子分组内
  const map = (children) =>
    children.map((c) => {
      if (c.id === itemId) return { ...c, ...patch };
      if (c.children) return { ...c, children: map(c.children) };
      return c;
    });
  return { ...data, folders: map(data.folders) };
}

export function removeItem(data, itemId) {
  const cut = (children) =>
    children.filter((c) => c.id !== itemId).map((c) => (c.children ? { ...c, children: cut(c.children) } : c));
  return { ...data, folders: cut(data.folders) };
}

/** 在同级列表中把条目移动到任意位置（管理面板拖拽排序用）；不可移动时返回原引用 */
export function reorderItem(data, id, newIndex) {
  const reorder = (list) => {
    const from = list.findIndex((c) => c.id === id);
    if (from < 0) return null;
    const to = Math.max(0, Math.min(list.length - 1, newIndex));
    if (from === to) return null;
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  };
  const walk = (children) => {
    const moved = reorder(children);
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

/** 批量把条目（书签/子分组）移动到目标分组的子级首位。
 *  从任意层级剪切、跨分组/子分组移动均可；移动分组进自己的后代会被跳过（防成环）。 */
export function moveNodesTo(data, ids, folderId) {
  const idSet = new Set(ids);
  const out = [];
  const cut = (list) =>
    list.reduce((acc, c) => {
      if (idSet.has(c.id)) {
        out.push(c);
        return acc;
      }
      acc.push(c.children ? { ...c, children: cut(c.children) } : c);
      return acc;
    }, []);
  const folders = cut(data.folders || []);

  let target = null;
  const find = (list) => {
    for (const n of list) {
      if (n.id === folderId) { target = n; return true; }
      if (n.children && find(n.children)) return true;
    }
    return false;
  };
  find(folders);
  if (!target) return data; // 目标分组不存在

  const containsTarget = (n) => n.id === folderId || (n.children || []).some(containsTarget);
  const moved = out.filter((n) => !containsTarget(n)); // 跳过会造成成环的项
  if (!moved.length) return data;
  target.children = [...moved, ...target.children];
  return { ...data, folders };
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

/* ---------- 词库（poemLib）：内置语料只读，删除=隐藏、修改=覆盖；自定义词条独立存放 ---------- */

export const POEM_LIB_DEFAULTS = { custom: [], hidden: [], edits: {}, rev: 0 };

/** 云端 poemLib 兜底归一：畸形字段回默认、条目字段取字符串、空内容词条丢弃（ensureShape 单点调用） */
export function normalizePoemLib(lib) {
  if (!lib || typeof lib !== "object") return { ...POEM_LIB_DEFAULTS, edits: {} };
  const str = (v) => (typeof v === "string" ? v : "");
  const custom = (Array.isArray(lib.custom) ? lib.custom : [])
    .filter((x) => x && typeof x === "object" && typeof x.uuid === "string" && str(x.content).trim())
    .map((x) => ({
      uuid: x.uuid,
      cat: typeof x.cat === "string" ? x.cat : "i",
      content: str(x.content),
      author: str(x.author),
      source: str(x.source),
    }));
  const hidden = (Array.isArray(lib.hidden) ? lib.hidden : []).filter((x) => typeof x === "string" && x);
  const edits = {};
  if (lib.edits && typeof lib.edits === "object") {
    for (const [uuid, patch] of Object.entries(lib.edits)) {
      if (typeof uuid === "string" && patch && typeof patch === "object" && str(patch.content).trim()) {
        edits[uuid] = { content: str(patch.content), author: str(patch.author), source: str(patch.source) };
      }
    }
  }
  return { custom, hidden, edits, rev: Number.isFinite(lib.rev) ? lib.rev : 0 };
}

/** 词库修改统一入口：归一现有值 → 应用变更 → rev+1（引擎据此重新洗牌） */
function bumpLib(data, fn) {
  const next = fn(normalizePoemLib(data.poemLib));
  return { ...data, poemLib: { ...next, rev: (next.rev || 0) + 1 } };
}

/** 新增自定义词条（内容必填由调用方校验；uuid 用 u_ 前缀避免与内置 UUID 冲突） */
export function addCustomPoem(data, { cat, content, author, source }) {
  const entry = {
    uuid: uid("u"),
    cat,
    content: content.trim(),
    author: (author || "").trim(),
    source: (source || "").trim(),
  };
  return bumpLib(data, (lib) => ({ ...lib, custom: [entry, ...lib.custom] }));
}

/** 修改词条：自定义条目直接改；内置条目写 edits 覆盖（归属由 custom 是否含该 uuid 决定） */
export function updatePoemEntry(data, uuid, patch) {
  const norm = {
    content: (patch.content || "").trim(),
    author: (patch.author || "").trim(),
    source: (patch.source || "").trim(),
  };
  return bumpLib(data, (lib) => {
    if (lib.custom.some((c) => c.uuid === uuid)) {
      return { ...lib, custom: lib.custom.map((c) => (c.uuid === uuid ? { ...c, ...norm } : c)) };
    }
    return { ...lib, edits: { ...lib.edits, [uuid]: norm } };
  });
}

/** 删除自定义词条（内置条目用 setPoemHidden 隐藏/恢复） */
export function removeCustomPoem(data, uuid) {
  return bumpLib(data, (lib) => ({ ...lib, custom: lib.custom.filter((c) => c.uuid !== uuid) }));
}

/** 内置词条隐藏/恢复 */
export function setPoemHidden(data, uuid, hidden) {
  return bumpLib(data, (lib) => ({
    ...lib,
    hidden: hidden
      ? lib.hidden.includes(uuid)
        ? lib.hidden
        : [...lib.hidden, uuid]
      : lib.hidden.filter((u) => u !== uuid),
  }));
}

export { uid as genId };
