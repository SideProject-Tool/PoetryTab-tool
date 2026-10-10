/**
 * 平台适配层：插件（Chrome 扩展）与网页共用同一套界面代码，
 * 仅在这里收敛宿主环境差异。
 */

export const IS_EXT =
  typeof globalThis.chrome !== "undefined" && !!globalThis.chrome.runtime?.id;

/** 打开书签：插件始终新开前台标签页；网页 newTab=true（默认）新窗口打开以保留当前页，false 时当前页跳转 */
export function openUrl(url, { newTab = true } = {}) {
  if (!url) return;
  if (IS_EXT) {
    globalThis.chrome.tabs.create({ url, active: true });
  } else if (newTab) {
    window.open(url, "_blank", "noopener");
  } else {
    window.location.href = url;
  }
}

/**
 * 浏览器书签树（仅扩展端，需 manifest 的 bookmarks 权限）。
 * 返回 [{title, children:[{title,url}|子文件夹]}]；网页端或不支持时返回 null。
 * chrome.bookmarks 的根节点（"root"）与"移动设备书签"空树一并剔除。
 */
export async function getBrowserBookmarks() {
  if (!IS_EXT || !globalThis.chrome?.bookmarks?.getTree) return null;
  const tree = await new Promise((resolve, reject) => {
    globalThis.chrome.bookmarks.getTree((res) =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(res)
    );
  });
  const mapChildren = (nodes) =>
    (nodes || [])
      .filter((n) => n.id !== "0") // 0 是虚拟根
      .map((n) =>
        n.url
          ? { title: n.title || n.url, url: n.url }
          : { title: n.title || "未命名文件夹", children: mapChildren(n.children) }
      )
      .filter((n) => n.url || (n.children && n.children.length));
  const roots = tree[0]?.children || [];
  return mapChildren(roots);
}

/** 打开浏览器自带的历史记录页：Edge 为 edge://history，其余 Chromium 系（Chrome/Brave/Opera）为 chrome://history */
export function openHistoryPage() {
  const url = /Edg\//.test(typeof navigator !== "undefined" ? navigator.userAgent : "")
    ? "edge://history/"
    : "chrome://history/";
  openUrl(url);
}

/**
 * 浏览历史（仅扩展端，需 manifest 的 history 权限；仅本机读取，永不上传）。
 * query 为空 = 最近访问记录；否则按标题/网址搜索全部历史。按 lastVisitTime 倒序。
 * 返回 [{title, url, lastVisitTime}]（已滤除非 http(s) 协议行）；网页端或不支持时返回 null。
 */
export async function getHistory(query = "", maxResults = 20) {
  if (!IS_EXT || !globalThis.chrome?.history?.search) return null;
  const rows = await new Promise((resolve, reject) => {
    globalThis.chrome.history.search({ text: query, maxResults, startTime: 0 }, (res) =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(res)
    );
  });
  return (rows || []).filter((r) => /^https?:\/\//i.test(r.url || ""));
}
