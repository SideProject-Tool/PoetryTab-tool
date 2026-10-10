// Poetry-Tab — 用户体系 + 云同步 + 网页版托管 Worker
// 存储：R2 桶（绑定名 BUCKET）
//   pt/accounts/<uid>.json             账号记录 {v, iter, salt, authKey, createdAt}
//   pt/data/<uid>.json                 最新数据 {savedAt, data}（唯一数据副本，无历史快照）
//   pt/favicons/<domain>.bin           favicon 代理缓存（元数据存 contentType）
//   pt/titles/<hash>.json              网页标题代理缓存（30 天）
//   历史快照功能已下线：pt/data/<uid>/snap-*.json 不再写入，且每次成功保存顺手清空遗留键
// 认证（客户端全程不发送明文密码）：
//   注册：客户端 PBKDF2-SHA256(密码, 随机盐, iter) → authKey，连同盐提交，服务器只存派生结果
//   登录：/api/challenge 发放带签名的一次性挑战（含盐与迭代次数）→ 客户端 HMAC-SHA256(authKey, challenge) 应答
//     不存在的 ID 返回确定性伪盐（防账号枚举：响应形状与存在时一致）
//   会话：登录后发放无状态令牌 uid|exp|HMAC(SYNC_TOKEN, uid|exp)，30 天有效
//     GET/PUT /api/data 仅凭会话令牌，uid 从令牌解析，杜绝越权读写
// 并发：数据写入用 R2 条件写（onlyIf etagEquals）做原子 CAS，消除「读版本→比对→写入」竞态
// 缓存：GET /api/data 支持 ETag（savedAt）/ If-None-Match → 304，未变化时零传输
// 网页：/ 与静态资源来自 ./public；带 hash 的静态资产配 immutable 长缓存

const MAX_BODY = 8 * 1024 * 1024; // 8MB
const SESSION_TTL = 30 * 24 * 3600; // 30 天（秒）
const CHALLENGE_TTL = 10 * 60; // 挑战有效期（秒）
const ITER_DEFAULT = 600000; // PBKDF2 迭代次数（OWASP 推荐）
const FAVICON_TTL = 30 * 24 * 3600; // favicon 代理缓存有效期（秒）

const UID_RE = /^[\w\u4e00-\u9fa5-]{2,32}$/u; // 2-32 位：字母数字下划线连字符汉字
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const usedChallenges = new Set(); // 已消费的登录挑战（防重放；per-isolate 尽力而为，挑战本身 10 分钟过期）

/* ===== per-IP 内存限流（per-isolate 尽力而为：Worker 实例可能在节点间漂移、
   内存不共享，生产可再叠加 Cloudflare WAF / Rate Limiting 规则兜底） ===== */
const RL_WINDOW = 60 * 1000;
const RL_BUCKETS = {
  register: { limit: 10, hits: new Map() }, // 注册：10 次/分/IP（写 R2，防滥用刷量）
  auth: { limit: 30, hits: new Map() },     // challenge+login 合计：30 次/分/IP（防账号枚举/爆破）
  favicon: { limit: 600, hits: new Map() }, // favicon 代理：600 次/分/IP（R2 已缓存，命中不回源）
  title: { limit: 120, hits: new Map() },   // 标题代理：120 次/分/IP（收录书签时自动取名）
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

/* CORS：X-Base-SavedAt / If-None-Match 是自定义请求头，必须进白名单，
   否则跨源浏览器环境（本地开发、第三方页面）预检失败 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Base-SavedAt, If-None-Match",
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
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

/* ===== 数据读写（含原子 CAS 与快照） ===== */

/* R2 条件写：仅当对象 etag 仍为 expectEtag 时写入（expectEtag=null 表示仅当不存在时创建）。
   预条件不满足返回 null（对象未写入）。R2 put 的 onlyIf 语义与 S3 If-Match/If-None-Match 对齐。 */
async function casPut(env, key, value, expectEtag) {
  const onlyIf = expectEtag === null ? { etagDoesNotMatch: "*" } : { etagEquals: expectEtag };
  return env.BUCKET.put(key, value, { onlyIf });
}

async function readDataHead(env, uid) {
  // 只取 etag 与 savedAt，不解析 data 本体
  const obj = await env.BUCKET.get(`pt/data/${uid}.json`);
  if (!obj) return null;
  let savedAt = null;
  try {
    const parsed = await obj.json();
    savedAt = parsed && parsed.savedAt;
  } catch { /* 损坏按无版本处理 */ }
  return { etag: obj.etag, savedAt };
}

let lastIssuedSavedAt = ""; // 同 isolate 内保证 savedAt 严格递增（毫秒碰撞会让 ETag 误报 304）。
// 已知边界：跨 isolate 同毫秒写入理论上可能产生重复 savedAt（ETag 碰撞 → 一次陈旧 304）；
// CAS 保证数据不被覆盖，概率极低，记入文档已知边界，不做版本号复杂化
async function writeDataCAS(env, uid, data, prev) {
  // prev: null（云端无数据，仅当不存在时创建）或 readDataHead 的 {etag}
  const savedAt = new Date(Math.max(Date.now(), Date.parse(lastIssuedSavedAt || 0) + 1)).toISOString();
  lastIssuedSavedAt = savedAt;
  const payload = JSON.stringify({ savedAt, data });
  const ok = await casPut(env, `pt/data/${uid}.json`, payload, prev ? prev.etag : null);
  if (!ok) return { conflict: true };
  return { conflict: false, savedAt, payload };
}

/* 历史快照功能已下线：每次成功保存顺手清空该 uid 的遗留快照键，
   存量快照随用户下一次保存自然清零（R2 DELETE 免计费；失败仅记日志，不影响保存结果） */
async function purgeSnaps(env, uid) {
  try {
    const snaps = (await env.BUCKET.list({ prefix: `pt/data/${uid}/snap-` })).objects || [];
    for (const o of snaps) await env.BUCKET.delete(o.key);
  } catch (e) {
    console.error("snap purge failed:", uid, e && e.message);
  }
}

/* ===== API ===== */
async function handleApi(request, env, url) {
  if (url.pathname === "/api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  const p = url.pathname;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  /* 注册：{uid, salt, authKey, iter} → {session}。
     条件写仅当账号不存在时创建，关闭并发同名注册的后写覆盖竞态 */
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
    const account = JSON.stringify({ v: 1, iter, salt: b.salt, authKey: b.authKey, createdAt: new Date().toISOString() });
    const created = await casPut(env, `pt/accounts/${uid}.json`, account, null);
    if (!created) return json({ error: "exists" }, 409); // 并发窗口内被抢注
    return json({ ok: true, session: await makeSession(env, uid) });
  }

  /* 登录第一步：拿挑战（附带该账号的盐与迭代次数）。
     不存在的 ID 返回 HMAC 确定性伪盐，响应形状与存在时一致，外部无法据此枚举账号 */
  if (p === "/api/challenge" && request.method === "POST") {
    if (rateLimited("auth", ip)) return json({ error: "too many requests" }, 429);
    const b = await readBody(request);
    const uid = String((b && b.uid) || "").trim();
    if (!UID_RE.test(uid)) return json({ error: "bad uid" }, 400); // 先过白名单再进 R2 key
    const account = await readAccount(env, uid);
    const ts = Math.floor(Date.now() / 1000);
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    const nonceHex = toHex(nonce);
    const challenge = `${ts}|${nonceHex}|${await hmacHex(env.SYNC_TOKEN, `c|${uid}|${ts}|${nonceHex}`)}`;
    const salt = account ? account.salt : await hmacHex(env.SYNC_TOKEN, `fake-salt|${uid}`);
    return json({ challenge, salt, iter: account ? account.iter : ITER_DEFAULT });
  }

  /* 登录第二步：{uid, challenge, proof} → {session, data}。
     任何失败（账号不存在/盐不匹配/密码错误）一律 401，不泄露账号是否存在 */
  if (p === "/api/login" && request.method === "POST") {
    if (rateLimited("auth", ip)) return json({ error: "too many requests" }, 429);
    const b = await readBody(request);
    if (!b) return json({ error: "invalid body" }, 400);
    const uid = String(b.uid || "").trim();
    if (!UID_RE.test(uid)) return json({ error: "bad uid" }, 400); // 先过白名单再进 R2 key
    const account = await readAccount(env, uid);
    const m = String(b.challenge || "").match(/^(\d+)\|([0-9a-f]{16})\|([0-9a-f]{64})$/);
    if (!m) return json({ error: "bad challenge" }, 400);
    const ts = Number(m[1]);
    const nonce = m[2];
    if (timingSafeEq(m[3], await hmacHex(env.SYNC_TOKEN, `c|${uid}|${ts}|${nonce}`)) === false) {
      return json({ error: "bad challenge" }, 400);
    }
    if (Math.floor(Date.now() / 1000) - ts > CHALLENGE_TTL) return json({ error: "challenge expired" }, 400);
    // 挑战一次性：签发后已消费的直接拒绝（防截获重放；per-isolate 尽力而为，挑战本身 10 分钟过期）
    if (usedChallenges.has(b.challenge)) return json({ error: "bad challenge" }, 400);
    if (!account) return json({ error: "bad proof" }, 401);
    const expected = await hmacAuthKey(account.authKey, b.challenge);
    if (!timingSafeEq(String(b.proof || ""), expected)) return json({ error: "bad proof" }, 401);
    usedChallenges.add(b.challenge);
    if (usedChallenges.size > 50000) usedChallenges.clear(); // 防内存膨胀（挑战 10 分钟后本身过期）
    const obj = await env.BUCKET.get(`pt/data/${uid}.json`);
    let payload = { savedAt: null, data: null };
    if (obj) {
      try { payload = await obj.json(); } catch { /* 数据损坏按空处理，避免 500 锁死登录 */ }
    }
    return json({ ok: true, session: await makeSession(env, uid), savedAt: payload.savedAt, data: payload.data });
  }

  /* 数据读：ETag=savedAt，If-None-Match 命中返回 304（扩展高频开新标签页省全量传输） */
  if (p === "/api/data" && request.method === "GET") {
    const uid = await readSession(env, request);
    if (!uid) return json({ error: "unauthorized" }, 401);
    const head = await readDataHead(env, uid);
    if (!head || !head.savedAt) return json({ savedAt: null, data: null });
    const etag = `"${head.savedAt}"`;
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, ...CORS_HEADERS } });
    }
    const obj = await env.BUCKET.get(`pt/data/${uid}.json`);
    if (!obj) return json({ savedAt: null, data: null });
    let payload;
    try {
      payload = await obj.json();
    } catch {
      return json({ savedAt: null, data: null }); // 数据损坏按空处理，避免 500 锁死客户端
    }
    return json(payload, 200, { ETag: etag });
  }

  /* 数据写：整份覆盖 + 乐观锁。校验在 R2 条件写上原子完成（读 etag → CAS 写），
     两个并发 PUT 只有一个成功，另一个收 409 + 当前版本号 */
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
    const head = await readDataHead(env, uid);
    if (head && head.savedAt && request.headers.get("X-Base-SavedAt") !== head.savedAt) {
      return json({ error: "conflict", savedAt: head.savedAt }, 409);
    }
    const r = await writeDataCAS(env, uid, data, head);
    if (r.conflict) {
      // CAS 窗口内被并发写入：带上当前版本让客户端进入仲裁流程
      const nowHead = await readDataHead(env, uid);
      return json({ error: "conflict", savedAt: nowHead ? nowHead.savedAt : null }, 409);
    }
    await purgeSnaps(env, uid); // 快照已下线：顺手清理存量快照键
    return json({ ok: true, savedAt: r.savedAt });
  }

  /* favicon 代理：/api/favicon?domain=example.com
     R2 缓存 30 天；回源 Google s2 → DuckDuckGo 兜底；失败 404（前端降级为字母磁贴）。
     浏览器 HTTP 缓存：命中 30 天（新标签页重复打开零请求）；404 负缓存 1 天
     （拿不到图标的站点不因每次打开重复回源）。
     国内直连外网 favicon 服务不可靠，走自家 Worker 代理解决 */
  if (p === "/api/favicon" && request.method === "GET") {
    const domain = (url.searchParams.get("domain") || "").trim().toLowerCase();
    if (!DOMAIN_RE.test(domain) || domain.length > 253) return json({ error: "bad domain" }, 400);
    if (rateLimited("favicon", ip)) return json({ error: "too many requests" }, 429);
    const key = `pt/favicons/${domain}.bin`;
    const cached = await env.BUCKET.get(key);
    if (cached) {
      const fresh = !cached.customMetadata || !cached.customMetadata.fetchedAt ||
        Date.now() - Number(cached.customMetadata.fetchedAt) < FAVICON_TTL * 1000;
      if (fresh) {
        return new Response(cached.body, {
          headers: {
            "Content-Type": cached.customMetadata.contentType || "image/x-icon",
            "Cache-Control": "public, max-age=2592000",
            ...CORS_HEADERS,
          },
        });
      }
    }
    const upstreams = [
      `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    ];
    for (const up of upstreams) {
      try {
        const res = await fetch(up, { headers: { "User-Agent": "Mozilla/5.0 (favicon-proxy)" }, cf: { cacheTtl: 86400 } });
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 1 || buf.byteLength > 512 * 1024) continue;
        const contentType = res.headers.get("Content-Type") || "image/x-icon";
        await env.BUCKET.put(key, buf, {
          customMetadata: { contentType, fetchedAt: String(Date.now()) },
        }).catch(() => { /* 缓存写失败不影响本次返回 */ });
        return new Response(buf, {
          headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=604800", ...CORS_HEADERS },
        });
      } catch { /* 换下一个回源 */ }
    }
    return json({ error: "favicon not found" }, 404, { "Cache-Control": "public, max-age=86400" }); // 404 负缓存 1 天
  }

  /* 标题代理：/api/title?url=https://example.com
     收录书签未填名称时自动取网页 <title>。R2 缓存 30 天；仅读前 256KB、10s 超时，防大页面拖垮 */
  if (p === "/api/title" && request.method === "GET") {
    const raw = url.searchParams.get("url") || "";
    let target;
    try {
      target = new URL(raw);
    } catch {
      return json({ error: "bad url" }, 400);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return json({ error: "bad url" }, 400);
    if (rateLimited("title", ip)) return json({ error: "too many requests" }, 429);
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(target.href));
    const key = `pt/titles/${toHex(digest).slice(0, 32)}.json`;
    const cached = await env.BUCKET.get(key);
    if (cached) {
      try {
        const c = await cached.json();
        if (c && c.title && Date.now() - Number(c.fetchedAt || 0) < FAVICON_TTL * 1000) {
          return json({ title: c.title });
        }
      } catch { /* 缓存损坏走回源 */ }
    }
    let title = "";
    try {
      const res = await fetch(target.href, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PoetryTabBot/1.0; +https://sync.pathmemos.com)" },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        cf: { cacheTtl: 3600 },
      });
      if (res.ok && (res.headers.get("Content-Type") || "").includes("text/html")) {
        const csMatch = (res.headers.get("Content-Type") || "").match(/charset=([\w-]+)/i);
        const decoder = new TextDecoder(csMatch ? csMatch[1] : "utf-8", { fatal: false });
        const reader = res.body.getReader();
        let len = 0;
        const chunks = [];
        while (len < 262144) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          len += value.byteLength;
        }
        try { await reader.cancel(); } catch { /* 已读完 */ }
        const head = decoder.decode(concatChunks(chunks, len));
        const m = head.match(/<title[^>]*>([\s\S]{0,600}?)<\/title>/i);
        if (m) {
          title = decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 120);
        }
      }
    } catch { /* 抓取失败按无标题处理 */ }
    if (!title) return json({ error: "title not found" }, 404);
    await env.BUCKET.put(key, JSON.stringify({ title, fetchedAt: String(Date.now()) })).catch(() => {});
    return json({ title });
  }

  return json({ error: "not found" }, 404);
}

/* 工具：拼接 Uint8Array 分块 */
function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/* 工具：解 HTML 常用实体（标题里最常见的一批） */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/* ===== CORS 预检 ===== */
const corsHeaders = {
  ...CORS_HEADERS,
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
    } else if (url.pathname.startsWith("/assets/")) {
      // 带 hash 的构建产物：内容变文件名即变，可安全设为一年 immutable（新标签页冷启动提速）
      res = new Response(res.body, { status: res.status, headers: res.headers });
      res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    return res;
  },
};
