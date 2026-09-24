// Poetry-Tab — 用户体系 + 云同步 + 网页版托管 Worker
// 存储：R2 桶（绑定名 BUCKET）
//   pt/accounts/<uid>.json            账号记录 {v, iter, salt, authKey, createdAt}
//   pt/data/<uid>.json                最新数据 {savedAt, data}
//   pt/data/<uid>/snap-<ts>-<seq>.json 历史快照（保留最近 5 份）
// 认证（客户端全程不发送明文密码）：
//   注册：客户端 PBKDF2-SHA256(密码, 随机盐, iter) → authKey，连同盐提交，服务器只存派生结果
//   登录：/api/challenge 发放带签名的一次性挑战（含盐与迭代次数）→ 客户端 HMAC-SHA256(authKey, challenge) 应答
//   会话：登录后发放无状态令牌 uid|exp|HMAC(SYNC_TOKEN, uid|exp)，30 天有效
//     GET/PUT /api/data 仅凭会话令牌，uid 从令牌解析，杜绝越权读写
// 网页：/ 与静态资源来自 ./public

const MAX_BODY = 8 * 1024 * 1024; // 8MB
const KEEP_SNAPS = 5;
const SESSION_TTL = 30 * 24 * 3600; // 30 天（秒）
const CHALLENGE_TTL = 10 * 60; // 挑战有效期（秒）
const ITER_DEFAULT = 600000; // PBKDF2 迭代次数（OWASP 推荐）

const UID_RE = /^[\w\u4e00-\u9fa5-]{2,32}$/u; // 2-32 位：字母数字下划线连字符汉字

/* ===== per-IP 内存限流（per-isolate 尽力而为：Worker 实例可能在节点间漂移、
   内存不共享，生产可再叠加 Cloudflare WAF / Rate Limiting 规则兜底） ===== */
const RL_WINDOW = 60 * 1000;
const RL_BUCKETS = {
  register: { limit: 10, hits: new Map() }, // 注册：10 次/分/IP（写 R2，防滥用刷量）
  auth: { limit: 30, hits: new Map() },     // challenge+login 合计：30 次/分/IP（防账号枚举/爆破）
};
function rateLimited(kind, ip) {
  const now = Date.now();
  const bucket = RL_BUCKETS[kind];
  if (bucket.hits.size > 10000) {
    for (const [k, v] of bucket.hits) if (now >= v.resetAt) bucket.hits.delete(k);
  }
  let v = bucket.hits.get(ip);
  if (!v || now >= v.resetAt) {
    v = { count: 0, resetAt: now + RL_WINDOW };
    bucket.hits.set(ip, v);
  }
  v.count += 1;
  return v.count > bucket.limit;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}

/* ===== 加密工具（Workers WebCrypto） ===== */
const enc = new TextEncoder();
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(h) {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function hmacRaw(keyBuf, msg) {
  const key = await crypto.subtle.importKey("raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function hmacHex(secretStr, msg) {
  return hmacRaw(enc.encode(secretStr), msg);
}
/* authKey 以原始字节参与 HMAC（与客户端 deriveBits 输出一致，切勿按文本编码） */
async function hmacAuthKey(authKeyHex, msg) {
  return hmacRaw(fromHex(authKeyHex), msg);
}

/* ===== 会话令牌：uid|exp|签名（无状态） ===== */
async function makeSession(env, uid) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  return `${uid}|${exp}|${await hmacHex(env.SYNC_TOKEN, `${uid}|${exp}`)}`;
}
async function readSession(env, request) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer (\S+)$/);
  if (!m) return null;
  const parts = m[1].split("|");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!timingSafeEq(sig, await hmacHex(env.SYNC_TOKEN, `${uid}|${exp}`))) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  return uid;
}

async function readBody(request) {
  // 优先按 Content-Length（字节）拦截，再按字符数兜底（UTF-16 码元数会低估 CJK 字节数）
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readAccount(env, uid) {
  const obj = await env.BUCKET.get(`pt/accounts/${uid}.json`);
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

/* ===== API ===== */
async function handleApi(request, env, url) {
  if (url.pathname === "/api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  const p = url.pathname;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  /* 注册：{uid, salt, authKey, iter} → {session} */
  if (p === "/api/register" && request.method === "POST") {
    if (rateLimited("register", ip)) return json({ error: "too many requests" }, 429);
    const b = await readBody(request);
    if (!b) return json({ error: "invalid body" }, 400);
    const uid = String(b.uid || "").trim();
    if (!UID_RE.test(uid)) return json({ error: "ID 需 2-32 位（字母/数字/汉字/_/-）" }, 400);
    if (!/^[0-9a-f]{32}$/.test(b.salt || "")) return json({ error: "bad salt" }, 400);
    if (!/^[0-9a-f]{64}$/.test(b.authKey || "")) return json({ error: "bad authKey" }, 400);
    const iter = Number(b.iter) || ITER_DEFAULT;
    if (iter < 100000 || iter > 2000000) return json({ error: "bad iter" }, 400);
    if (await readAccount(env, uid)) return json({ error: "exists" }, 409);
    const account = { v: 1, iter, salt: b.salt, authKey: b.authKey, createdAt: new Date().toISOString() };
    await env.BUCKET.put(`pt/accounts/${uid}.json`, JSON.stringify(account));
    return json({ ok: true, session: await makeSession(env, uid) });
  }

  /* 登录第一步：拿挑战（附带该账号的盐与迭代次数） */
  if (p === "/api/challenge" && request.method === "POST") {
    if (rateLimited("auth", ip)) return json({ error: "too many requests" }, 429);
    const b = await readBody(request);
    const uid = String((b && b.uid) || "").trim();
    if (!UID_RE.test(uid)) return json({ error: "bad uid" }, 400); // 先过白名单再进 R2 key
    const account = await readAccount(env, uid);
    if (!account) return json({ error: "notfound" }, 404);
    const ts = Math.floor(Date.now() / 1000);
    const challenge = `${ts}|${await hmacHex(env.SYNC_TOKEN, `c|${uid}|${ts}`)}`;
    return json({ challenge, salt: account.salt, iter: account.iter });
  }

  /* 登录第二步：{uid, challenge, proof} → {session, data} */
  if (p === "/api/login" && request.method === "POST") {
    if (rateLimited("auth", ip)) return json({ error: "too many requests" }, 429);
    const b = await readBody(request);
    if (!b) return json({ error: "invalid body" }, 400);
    const uid = String(b.uid || "").trim();
    if (!UID_RE.test(uid)) return json({ error: "bad uid" }, 400); // 先过白名单再进 R2 key
    const account = await readAccount(env, uid);
    if (!account) return json({ error: "notfound" }, 404);
    const m = String(b.challenge || "").match(/^(\d+)\|([0-9a-f]{64})$/);
    if (!m) return json({ error: "bad challenge" }, 400);
    const ts = Number(m[1]);
    if (timingSafeEq(m[2], await hmacHex(env.SYNC_TOKEN, `c|${uid}|${ts}`)) === false) {
      return json({ error: "bad challenge" }, 400);
    }
    if (Math.floor(Date.now() / 1000) - ts > CHALLENGE_TTL) return json({ error: "challenge expired" }, 400);
    const expected = await hmacAuthKey(account.authKey, b.challenge);
    if (!timingSafeEq(String(b.proof || ""), expected)) return json({ error: "bad proof" }, 401);
    const obj = await env.BUCKET.get(`pt/data/${uid}.json`);
    let payload = { savedAt: null, data: null };
    if (obj) {
      try { payload = await obj.json(); } catch { /* 数据损坏按空处理，避免 500 锁死登录 */ }
    }
    return json({ ok: true, session: await makeSession(env, uid), savedAt: payload.savedAt, data: payload.data });
  }

  /* 数据读写：仅凭会话令牌，uid 从令牌解析 */
  if (p === "/api/data" && request.method === "GET") {
    const uid = await readSession(env, request);
    if (!uid) return json({ error: "unauthorized" }, 401);
    const obj = await env.BUCKET.get(`pt/data/${uid}.json`);
    if (!obj) return json({ savedAt: null, data: null });
    try {
      return json(await obj.json());
    } catch {
      return json({ savedAt: null, data: null }); // 数据损坏按空处理，避免 500 锁死客户端
    }
  }

  if (p === "/api/data" && request.method === "PUT") {
    const uid = await readSession(env, request);
    if (!uid) return json({ error: "unauthorized" }, 401);
    // 优先按 Content-Length（字节）拦截，再按字符数兜底
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) {
      return json({ error: "payload too large (8MB max)" }, 413);
    }
    const body = await request.text();
    if (body.length > MAX_BODY) return json({ error: "payload too large (8MB max)" }, 413);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.folders)) {
      return json({ error: "invalid data shape" }, 400);
    }
    // 乐观锁：云端已有数据时，请求必须携带与其 savedAt 一致的 X-Base-SavedAt，
    // 否则 409（多设备并发保存，后到的整份写入会让先到的丢失）
    const cur = await env.BUCKET.get(`pt/data/${uid}.json`);
    if (cur) {
      let curPayload = null;
      try {
        curPayload = await cur.json();
      } catch { /* 损坏快照按无版本处理 */ }
      const curSavedAt = curPayload && curPayload.savedAt;
      if (curSavedAt && request.headers.get("X-Base-SavedAt") !== curSavedAt) {
        return json({ error: "conflict", savedAt: curSavedAt }, 409);
      }
    }
    const savedAt = new Date().toISOString();
    const payload = JSON.stringify({ savedAt, data });
    await env.BUCKET.put(`pt/data/${uid}.json`, payload);
    // 快照轮转尽力而为：主数据已写成功，快照失败仅记日志、不影响本次保存结果
    // （否则快照异常返 5xx，客户端重试会撞 409 乐观锁）
    try {
      const snapKey = `pt/data/${uid}/snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      await env.BUCKET.put(snapKey, payload);
      const snaps = await env.BUCKET.list({ prefix: `pt/data/${uid}/snap-` });
      const sorted = (snaps.objects || []).sort(
        (a, b) => (b.uploaded ? b.uploaded.getTime() : 0) - (a.uploaded ? a.uploaded.getTime() : 0)
      );
      for (const old of sorted.slice(KEEP_SNAPS)) {
        await env.BUCKET.delete(old.key);
      }
    } catch (e) {
      console.error("snapshot rotation failed:", uid, e && e.message);
    }
    return json({ ok: true, savedAt });
  }

  return json({ error: "not found" }, 404);
}

/* ===== CORS 预检 ===== */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
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

    // 网页版：按路径取静态文件；仅对无扩展名的路径回退 index.html（SPA 路由），
    // 带扩展名的缺失文件（如 .html/.js）必须返回真实 404，避免错误内容伪装成页面
    const asset = await env.ASSETS.fetch(new Request("https://assets.local" + url.pathname, request));
    const isSpaRoute = asset.status === 404 && !url.pathname.includes(".");
    let res = isSpaRoute ? await env.ASSETS.fetch("https://assets.local/index.html") : asset;
    if ((res.headers.get("Content-Type") || "").includes("text/html")) {
      res = new Response(res.body, { status: res.status, headers: res.headers });
      res.headers.set("Cache-Control", "no-store");
      // 基础安全响应头。CSP 暂未加：Vite 产物含内联脚本/样式，需 'unsafe-inline' 才能工作，
      // 收益有限，待产物改为 nonce/hash 后再启用
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("X-Content-Type-Options", "nosniff");
    }
    return res;
  },
};
