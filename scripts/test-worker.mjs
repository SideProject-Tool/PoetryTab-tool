/* Worker 本地自测：内存 R2 mock 跑全接口（注册/登录/防枚举/ETag/CAS/快照清零/favicon/CORS）。
   用法：node scripts/test-worker.mjs  （不碰线上，R2/fetch 均为本地模拟） */
import worker from "../worker/src/worker.js";

/* ---------- 内存 R2 mock（含 etag + onlyIf 条件写语义） ---------- */
class R2ObjectMock {
  constructor(key, body, customMetadata, uploaded, etag) {
    this.key = key;
    this._body = body;
    this.body = body instanceof ArrayBuffer ? body : undefined; // favicon 分支直接 new Response(cached.body)
    this.customMetadata = customMetadata || undefined;
    this.uploaded = uploaded;
    this.size = body.byteLength ?? body.length;
    this.etag = etag;
  }
  text() {
    return Promise.resolve(typeof this._body === "string" ? this._body : new TextDecoder().decode(this._body));
  }
  json() {
    return this.text().then(JSON.parse);
  }
}
class R2Mock {
  constructor() {
    this.map = new Map();
    this.seq = 0;
  }
  static etagOf(body) {
    let h = 5381;
    const s = typeof body === "string" ? body : new TextDecoder().decode(body);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return "etag" + (h >>> 0) + "-" + s.length;
  }
  async get(key) {
    const e = this.map.get(key);
    return e ? new R2ObjectMock(e.key, e.body, e.customMetadata, e.uploaded, e.etag) : null;
  }
  async put(key, value, options = {}) {
    const existing = this.map.get(key);
    const onlyIf = options.onlyIf;
    if (onlyIf) {
      if (onlyIf.etagDoesNotMatch === "*" && existing) return null; // 仅当不存在时创建
      if (onlyIf.etagEquals !== undefined) {
        if (!existing) return null;
        if (existing.etag !== onlyIf.etagEquals) return null;
      }
    }
    this.seq += 1;
    this.map.set(key, { key, body: value, customMetadata: options.customMetadata, uploaded: new Date(), etag: R2Mock.etagOf(value) + "." + this.seq });
    return new R2ObjectMock(key, value, options.customMetadata, new Date());
  }
  async delete(key) {
    this.map.delete(key);
  }
  async list({ prefix }) {
    const objects = [...this.map.values()]
      .filter((e) => e.key.startsWith(prefix))
      .map((e) => ({ key: e.key, uploaded: e.uploaded }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return { objects };
  }
}

/* ---------- 环境 ---------- */
const env = {
  BUCKET: new R2Mock(),
  ASSETS: {
    fetch: (reqOrUrl) => {
      const path = new URL(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url).pathname;
      const type = path.endsWith(".js") ? "application/javascript" : path.includes(".") ? "text/plain" : "text/html";
      return Promise.resolve(new Response("asset:" + path, { status: path === "/missing.js" ? 404 : 200, headers: { "Content-Type": type } }));
    },
  },
  SYNC_TOKEN: "local-test-token",
};
const realFetch = globalThis.fetch;
const call = (path, init = {}) => worker.fetch(new Request("https://w.local" + path, init), env);
const callApi = (path, init = {}) => call("/api" + path, init);

/* ---------- crypto 辅助 ---------- */
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: iter }, key, 256));
}
async function hmac(keyHex, msg) {
  const key = await crypto.subtle.importKey("raw", unhex(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const isHex = (s) => /^[0-9a-f]+$/.test(s);

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log((cond ? "  ✓" : "  ✗ FAIL") + " " + name + (cond ? "" : "  <<< " + extra));
};

/* ---------- 用例 ---------- */
console.log("— 注册 —");
const uid = "t-worker-" + Math.random().toString(36).slice(2, 6);
const pw = "pass-123456";
const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
const authKey = await pbkdf2(pw, salt, 600000);
let r = await callApi("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, salt, authKey, iter: 600000 }) });
check("注册成功发会话", r.status === 200 && (await r.json()).session, r.status);
r = await callApi("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, salt, authKey, iter: 600000 }) });
check("重复注册 409", r.status === 409, r.status);

console.log("— 防枚举：challenge 形状一致 —");
r = await callApi("/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid }) });
const real = await r.json();
r = await callApi("/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: uid + "-nope" }) });
const fake = await r.json();
check("不存在 ID 的 challenge 仍 200", r.status === 200, r.status);
check("伪盐为 64 位 hex（形状一致）", isHex(fake.salt || "") && fake.salt.length === 64, JSON.stringify(fake).slice(0, 80));
check("伪盐确定性（同 ID 两次相同）", (await (await callApi("/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: uid + "-nope" }) })).json()).salt === fake.salt);
check("真盐与伪盐不同", real.salt !== fake.salt);

console.log("— 登录 —");
async function loginAttempt(id, password) {
  const c = await (await callApi("/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: id }) })).json();
  const ak = await pbkdf2(password, c.salt, c.iter);
  const proof = await hmac(ak, c.challenge);
  return callApi("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: id, challenge: c.challenge, proof }) });
}
r = await loginAttempt(uid, pw);
const loginBody = await r.json();
check("正确密码登录 200", r.status === 200 && loginBody.session, r.status);
const session = loginBody.session;
r = await loginAttempt(uid, "wrong-password");
check("错误密码 401", r.status === 401, r.status);
r = await loginAttempt(uid + "-nope", pw);
check("不存在 ID 登录同样 401（不泄露存在性）", r.status === 401, r.status);

console.log("— 数据读写 + ETag —");
const H = { Authorization: "Bearer " + session, "Content-Type": "application/json" };
const dataOf = (n) => ({ v: 1, folders: [{ id: "f" + n, title: "组" + n, children: [{ id: "b" + n, title: "站" + n, url: "https://e" + n + ".com" }] }], quickSites: [], iframeWidgets: [], settings: {}, layout: [] });

r = await callApi("/data", { method: "PUT", headers: H, body: JSON.stringify(dataOf(1)) });
const put1 = await r.json();
check("首次 PUT 成功", r.status === 200 && put1.savedAt, r.status + JSON.stringify(put1));

r = await callApi("/data", { headers: H });
const etag = r.headers.get("ETag");
check("GET 返回 ETag=savedAt", r.status === 200 && etag === `"${put1.savedAt}"`, etag);
r = await callApi("/data", { headers: { ...H, "If-None-Match": etag } });
check("If-None-Match 命中 304", r.status === 304, r.status);
r = await callApi("/data", { headers: { ...H, "If-None-Match": '"stale"' } });
check("过期版本返回 200 全量", r.status === 200 && (await r.json()).data.folders[0].id === "f1", r.status);

console.log("— 乐观锁（409）与 CAS —");
r = await callApi("/data", { method: "PUT", headers: { ...H, "X-Base-SavedAt": "stale-version" }, body: JSON.stringify(dataOf(2)) });
check("过期 base PUT 409 且带当前 savedAt", r.status === 409 && (await r.json()).savedAt === put1.savedAt, r.status);
r = await callApi("/data", { method: "PUT", headers: { ...H, "X-Base-SavedAt": put1.savedAt }, body: JSON.stringify(dataOf(2)) });
const put2 = await r.json();
check("正确版本 PUT 成功且版本推进", r.status === 200 && put2.savedAt !== put1.savedAt, r.status);
// 同 base 连发两次：第二个在头部校验即 409（等价于并发竞态的外在表现）
r = await callApi("/data", { method: "PUT", headers: { ...H, "X-Base-SavedAt": put2.savedAt }, body: JSON.stringify(dataOf(3)) });
const put3 = await r.json();
check("base 推进后可继续写", r.status === 200, r.status);
r = await callApi("/data", { method: "PUT", headers: { ...H, "X-Base-SavedAt": put2.savedAt }, body: JSON.stringify(dataOf(4)) });
check("重放旧 base 被拒 409", r.status === 409, r.status);
r = await callApi("/data", { method: "PUT", headers: { Authorization: "Bearer bad|1|xx" }, body: JSON.stringify(dataOf(9)) });
check("无效会话 401", r.status === 401, r.status);

console.log("— 8MB 上限与 uid 白名单 —");
r = await callApi("/data", { method: "PUT", headers: H, body: JSON.stringify({ folders: [{ id: "fbig", title: "big", children: [] }], filler: "x".repeat(8 * 1024 * 1024) }) });
check("超 8MB PUT 413", r.status === 413, r.status);
r = await callApi("/data", { headers: H });
check("413 后云端数据未被改动", ((await r.json()).data.folders || [])[0]?.id === "f3", "");
r = await callApi("/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: "a" }) });
check("challenge 非法 uid 400", r.status === 400, r.status);
r = await callApi("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: "a", challenge: "x", proof: "y" }) });
check("login 非法 uid 400", r.status === 400, r.status);

console.log("— 历史快照已下线 —");
r = await callApi("/snaps", { headers: H });
check("快照列表接口已移除 404", r.status === 404, r.status);
r = await callApi("/snap/restore", { method: "POST", headers: H, body: JSON.stringify({ key: "pt/data/x/snap-1.json" }) });
check("快照恢复接口已移除 404", r.status === 404, r.status);
// 模拟存量快照键（老用户残留）：下一次保存应被顺手清空
env.BUCKET.map.set(`pt/data/${uid}/snap-legacy.json`, { key: `pt/data/${uid}/snap-legacy.json`, body: "{}" });
r = await callApi("/data", { method: "PUT", headers: { ...H, "X-Base-SavedAt": put3.savedAt }, body: JSON.stringify(dataOf(3)) });
check("带存量快照仍可正常保存", r.status === 200, r.status);
const snapKeys = [...env.BUCKET.map.keys()].filter((k) => k.includes("/snap-"));
check("存量快照随保存清零", snapKeys.length === 0, JSON.stringify(snapKeys));

console.log("— favicon 代理 —");
globalThis.fetch = async (up) => {
  if (String(up).includes("google.com")) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png" } });
  return new Response(null, { status: 404 });
};
r = await call("/api/favicon?domain=example.com");
check("favicon 回源成功", r.status === 200 && (r.headers.get("Content-Type") || "").startsWith("image/"), r.status);
const firstBody = await r.clone().arrayBuffer();
r = await call("/api/favicon?domain=example.com");
check("favicon 二次走缓存", r.status === 200 && (await r.arrayBuffer()).byteLength === firstBody.byteLength, r.status);
globalThis.fetch = realFetch;
const badDomain = "evil.com/../../x";
r = await call("/api/favicon?domain=" + encodeURIComponent(badDomain));
check("非法 domain 400", r.status === 400, r.status);

console.log("— 标题代理 —");
globalThis.fetch = async (up) => {
  if (String(up).includes("example.com")) {
    return new Response('<html><head><title>示例站点 &amp; 测试 — Poetry&#45;Tab</title></head><body>x</body></html>', {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new Response(null, { status: 404 });
};
r = await call("/api/title?url=" + encodeURIComponent("https://example.com/page?a=1"));
let titleBody = await r.json();
check("标题解析并解码实体", r.status === 200 && titleBody.title === "示例站点 & 测试 — Poetry-Tab", JSON.stringify(titleBody));
r = await call("/api/title?url=" + encodeURIComponent("https://example.com/page?a=1"));
check("标题二次走缓存", r.status === 200 && (await r.json()).title === titleBody.title, r.status);
globalThis.fetch = realFetch;
r = await call("/api/title?url=" + encodeURIComponent("javascript:alert(1)"));
check("非法协议 400", r.status === 400, r.status);
r = await call("/api/title?url=not-a-url");
check("坏 URL 400", r.status === 400, r.status);

console.log("— CORS 与静态资源 —");
r = await call("/api/data", { method: "OPTIONS" });
check("预检含 X-Base-SavedAt/If-None-Match 白名单", r.status === 204 && /X-Base-SavedAt/.test(r.headers.get("Access-Control-Allow-Headers")) && /If-None-Match/.test(r.headers.get("Access-Control-Allow-Headers")), r.headers.get("Access-Control-Allow-Headers"));
r = await call("/assets/app.js");
check("hash 资产 immutable 长缓存", (r.headers.get("Cache-Control") || "").includes("immutable"), r.headers.get("Cache-Control"));
r = await call("/");
check("HTML no-store", r.headers.get("Cache-Control") === "no-store", r.headers.get("Cache-Control"));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
