/** 网页元信息：经同步服务代理获取（浏览器直连会被 CORS 挡住） */
import { CLOUD_SYNC } from "./constants";

/** 取网页 <title>；失败返回空串（调用方保持原有名称即可） */
export async function fetchPageTitle(url) {
  try {
    const res = await fetch(`${CLOUD_SYNC.url}/api/title?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return "";
    const j = await res.json();
    return (j && typeof j.title === "string" ? j.title : "").trim().slice(0, 120);
  } catch {
    return "";
  }
}
