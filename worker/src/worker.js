// Poetry-Tab — 云端同步 + 网页版托管 Worker
// 存储：R2 桶（绑定名 BUCKET）
//   bookmarks/<uid>/latest.json      最新快照
//   bookmarks/<uid>/snap-<ts>.json   历史快照（保留最近 5 份）
// 鉴权：Authorization: Bearer <SYNC_TOKEN>（Worker Secret）+ X-Auth: <用户密码令牌>
// 网页：/ 与静态资源来自 ./public（网页版构建产物），HTML 注入访问令牌

const MAX_BODY = 8 * 1024 * 1024; // 8MB
const KEEP_SNAPS = 5;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Auth",
    },
  });
}

/* ===== 云端同步 API ===== */
async function handleApi(request, env, url) {
  if (url.pathname === "/api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  const auth = request.headers.get("Authorization") || "";
  if (!env.SYNC_TOKEN || auth !== `Bearer ${env.SYNC_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const m = url.pathname.match(/^\/api\/sync\/([^/]+)$/);
  if (!m) return json({ error: "not found" }, 404);

  let uid;
  try {
    uid = decodeURIComponent(m[1]);
  } catch {
    return json({ error: "bad uid" }, 400);
  }
  uid = uid.trim();
  if (!uid || uid.length > 64 || /[\\/]/.test(uid)) {
    return json({ error: "invalid uid（1-64 字符，不含斜杠）" }, 400);
  }
  const base = `bookmarks/${encodeURIComponent(uid)}`;

  // 读取现有数据的 auth 令牌
  const existingObj = await env.BUCKET.get(`${base}/latest.json`);
  let existingAuth = null;
  if (existingObj) {
    try {
      const existing = await existingObj.json();
      existingAuth = existing.data?.auth || existing.auth || null;
    } catch {}
  }

  // 用户密码令牌（客户端 SHA-256(password + ":" + uid)）
  const userAuth = request.headers.get("X-Auth") || null;

  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > MAX_BODY) return json({ error: "payload too large (8MB max)" }, 413);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const newAuth = data.data?.auth || data.auth || null;

    // 已有数据 → 必须验证令牌
    if (existingAuth) {
      if (!userAuth || userAuth !== existingAuth) {
        return json({ error: "auth mismatch" }, 403);
      }
    }
    // 新建数据 → 必须提供 auth
    if (!newAuth && !existingAuth) {
      return json({ error: "auth required" }, 400);
    }

    const savedAt = new Date().toISOString();
    const payload = JSON.stringify({ savedAt, data });
    await env.BUCKET.put(`${base}/latest.json`, payload);
    await env.BUCKET.put(`${base}/snap-${Date.now()}.json`, payload);
    const snaps = await env.BUCKET.list({ prefix: `${base}/snap-` });
    const sorted = (snaps.objects || []).sort(
      (a, b) => (b.uploaded ? b.uploaded.getTime() : 0) - (a.uploaded ? a.uploaded.getTime() : 0)
    );
    for (const old of sorted.slice(KEEP_SNAPS)) {
      await env.BUCKET.delete(old.key);
    }
    return json({ ok: true, uid, savedAt });
  }

  if (request.method === "GET") {
    const obj = await env.BUCKET.get(`${base}/latest.json`);
    if (!obj) return json({ error: "not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return json({ error: "method not allowed" }, 405);
}

/* ===== CORS 预检 ===== */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Auth",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    const asset = await env.ASSETS.fetch(new Request("https://assets.local" + url.pathname, request));
    let res = asset.status === 404
      ? await env.ASSETS.fetch("https://assets.local/index.html")
      : asset;

    const type = res.headers.get("Content-Type") || "";
    if (type.includes("text/html")) {
      let html = await res.text();
      html = html.replaceAll("__SYNC_TOKEN__", env.SYNC_TOKEN || "");
      res = new Response(html, { status: res.status, headers: res.headers });
      res.headers.set("Cache-Control", "no-store");
    }

    return res;
  },
};
