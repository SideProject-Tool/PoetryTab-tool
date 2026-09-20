import { CLOUD_SYNC } from "./pages/newtab/services/constants";

/**
 * 平台适配层：插件（Chrome 扩展）与网页共用同一套界面代码，
 * 仅在这里收敛宿主环境差异。
 */

export const IS_EXT =
  typeof globalThis.chrome !== "undefined" && !!globalThis.chrome.runtime?.id;

/** 访问令牌：插件端构建时内置；网页端由 Worker 注入 HTML */
export const SYNC_TOKEN =
  globalThis.__CLOUD_TOKEN__ || CLOUD_SYNC.token;

/** 打开书签：插件开新标签页；网页新窗口打开（保留当前页面） */
export function openUrl(url, { background = false } = {}) {
  if (!url) return;
  if (IS_EXT) {
    globalThis.chrome.tabs.create({ url, active: !background });
  } else {
    window.open(url, "_blank", "noopener");
  }
}
