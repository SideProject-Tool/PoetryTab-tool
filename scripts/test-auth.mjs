/* 新用户体系协议自测：注册 → 挑战登录 → 错误密码 → 数据读写 → 越权拒绝 */
const BASE = "https://sync.pathmemos.com";
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
const uid = "e2e-v4-" + Math.random().toString(36).slice(2, 7);
const password = "test-pass-9";
const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
const authKey = await pbkdf2(password, salt, 600000);

const post = async (p, body, headers) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? "✓" : "✗ FAIL"), name, extra || ""); };

// 1. 注册
let r = await post("/api/register", { uid, salt, authKey, iter: 600000 });
check("注册成功", r.status === 200 && r.json.session, JSON.stringify(r.json));
const session = r.json.session;

// 2. 重复注册被拒
r = await post("/api/register", { uid, salt, authKey, iter: 600000 });
check("重复注册 409", r.status === 409);

// 3. 正确密码登录
r = await post("/api/challenge", { uid });
check("挑战发放", r.status === 200 && r.json.challenge && r.json.salt === salt, "");
const proof = await hmac(authKey, r.json.challenge);
r = await post("/api/login", { uid, challenge: r.json.challenge, proof });
check("正确密码登录", r.status === 200 && r.json.session, "");
const session2 = r.json.session;

// 4. 错误密码被拒
const c2 = await post("/api/challenge", { uid });
const wrongKey = await pbkdf2("wrong-password", c2.json.salt, 600000);
const wrongProof = await hmac(wrongKey, c2.json.challenge);
r = await post("/api/login", { uid, challenge: c2.json.challenge, proof: wrongProof });
check("错误密码 401", r.status === 401);

// 5. 篡改的挑战被拒（重放旧挑战签名不匹配）
r = await post("/api/login", { uid, challenge: c2.json.challenge, proof: await hmac(authKey, c2.json.challenge + "x") });
check("篡改挑战 400", r.status === 400 || r.status === 401);

// 6. 会话写数据（首次：云端无数据，无需 base）
const putData = (savedAtBase) => fetch(BASE + "/api/data", {
  method: "PUT",
  headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json", "X-Base-SavedAt": savedAtBase || "" },
  body: JSON.stringify({ folders: [{ id: "f1", title: "T", children: [] }], quickSites: [], iframeWidgets: [], settings: {}, layout: [] }),
});
r = await putData("");
check("会话写数据", r.status === 200, JSON.stringify(await r.json()));

// 7. 会话读数据
r = await fetch(BASE + "/api/data", { headers: { Authorization: `Bearer ${session2}` } });
const dj = await r.json();
check("会话读数据", r.status === 200 && dj.data.folders[0].title === "T");

// 7b. 乐观锁：过期 base 被拒 409，正确 base 可写
r = await putData("2020-01-01T00:00:00.000Z");
const conflictBody = r.status === 409 ? await r.json() : null;
check("过期 base 409", r.status === 409 && !!(conflictBody && conflictBody.savedAt), "");
const cur = await (await fetch(BASE + "/api/data", { headers: { Authorization: `Bearer ${session}` } })).json();
r = await putData(cur.savedAt);
check("正确 base 保存", r.status === 200);

// 8. 无会话/伪造会话被拒
r = await fetch(BASE + "/api/data");
check("无会话 401", r.status === 401);
r = await fetch(BASE + "/api/data", { headers: { Authorization: `Bearer ${uid}|9999999999|deadbeef` } });
check("伪造会话 401", r.status === 401);

// 9. 不存在的 ID 挑战 404
r = await post("/api/challenge", { uid: "no-such-id-zzz" });
check("不存在 ID 404", r.status === 404);

// 10. 非法 ID 注册被拒
r = await post("/api/register", { uid: "a", salt, authKey, iter: 600000 });
check("非法 ID 400", r.status === 400);

console.log(`\n${pass} passed, ${fail} failed (${uid})`);
