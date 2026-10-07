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
