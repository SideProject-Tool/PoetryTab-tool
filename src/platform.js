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
