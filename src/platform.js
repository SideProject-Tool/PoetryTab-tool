/**
 * 平台适配层：插件（Chrome 扩展）与网页共用同一套界面代码，
 * 仅在这里收敛宿主环境差异。
 */

export const IS_EXT =
  typeof globalThis.chrome !== "undefined" && !!globalThis.chrome.runtime?.id;

/** 打开书签：插件开新标签页；网页新窗口打开（保留当前页面） */
export function openUrl(url, { background = false } = {}) {
  if (!url) return;
  if (IS_EXT) {
    globalThis.chrome.tabs.create({ url, active: !background });
  } else {
    window.open(url, "_blank", "noopener");
  }
}
