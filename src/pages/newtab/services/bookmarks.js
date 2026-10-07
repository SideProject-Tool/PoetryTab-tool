/**
 * 书签导入：Netscape HTML（Chrome/Firefox/Edge 导出格式）解析 + 树归一。
 * 输出与 getBrowserBookmarks 相同的形状：[{title, children:[{title,url}|子文件夹]}]
 */
import { safeUrl } from "./collection";

/** 解析 Netscape 书签 HTML（容错：DL/DT/H3/A 结构_walk，忽略注释与非法链接） */
export function parseNetscapeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const mapDl = (dl) => {
    const out = [];
    if (!dl) return out;
    for (const dt of dl.children) {
      if (dt.tagName !== "DT") continue;
      const h3 = dt.querySelector(":scope > H3");
      const a = dt.querySelector(":scope > A");
      const sub = dt.querySelector(":scope > DL");
      if (h3 && sub) {
        const children = mapDl(sub);
        if (children.length) out.push({ title: h3.textContent.trim() || "未命名文件夹", children });
      } else if (a) {
        const url = safeUrl(a.getAttribute("href") || "");
        if (url) out.push({ title: (a.textContent || "").trim() || url, url });
      }
    }
    return out;
  };
  // 根 <DL>：兼容导出文件里最外层 DL 或直接挂在 body 下
  const rootDl = doc.querySelector("dl") || doc.body;
  return mapDl(rootDl.tagName === "DL" ? rootDl : rootDl.querySelector("dl"));
}

/** 统计树里的链接数（导入前预检） */
export function countLinks(nodes) {
  let n = 0;
  for (const node of nodes || []) {
    if (node.url) n += 1;
    else n += countLinks(node.children);
  }
  return n;
}

/**
 * 把导入树并入现有数据（不覆盖，追加为新分组；已存在的相同 URL 自动跳过去重）：
 * - 顶层文件夹 → 新的顶层分组
 * - 顶层散链 → 收进「导入书签」分组
 * 返回 mutate 用的变换函数；去重结果写入 sink（{skipped}）
 */
export function mergeImportedTree(tree, sink) {
  const norm = (u) => {
    try {
      const p = new URL(u);
      return (p.hostname + p.pathname).toLowerCase().replace(/\/+$/, "");
    } catch {
      return String(u).toLowerCase();
    }
  };
  const collectExisting = (d) => {
    const seen = new Set();
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.url) seen.add(norm(n.url));
        else walk(n.children);
      }
    };
    walk(d.folders);
    for (const s of d.quickSites || []) if (s.url) seen.add(norm(s.url));
    return seen;
  };
  return (d) => {
    const existing = collectExisting(d);
    let skipped = 0;
    const dedupe = (nodes) =>
      (nodes || []).filter((n) => {
        if (!n.url) return true;
        const k = norm(n.url);
        if (existing.has(k)) {
          skipped += 1;
          return false;
        }
        existing.add(k);
        return true;
      });
    const clean = (nodes) =>
      dedupe(nodes).map((n) => (n.url ? { title: n.title || n.url, url: n.url } : { title: n.title || "未命名", children: clean(n.children) })).filter((n) => n.url || (n.children && n.children.length));
    const nodes = clean(tree);
    if (!nodes.length) {
      if (sink) sink.skipped = skipped;
      return d;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const folders = [...(d.folders || [])];
    const loose = nodes.filter((n) => n.url);
    const grouped = nodes.filter((n) => !n.url);
    for (const g of grouped) folders.push({ id: "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: g.title, children: g.children.map((c) => ({ ...c, id: "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), dateAdded: Date.now() })) });
    if (loose.length) {
      folders.push({
        id: "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: "导入书签 " + stamp,
        children: loose.map((c) => ({ ...c, id: "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), dateAdded: Date.now() })),
      });
    }
    if (sink) sink.skipped = skipped;
    return { ...d, folders };
  };
}
