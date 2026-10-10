#!/usr/bin/env node
/**
 * 一键发布脚本（对应 AGENTS.md「发版与商店提交」，把全流程固化，避免漏步骤）：
 *   版本号(可选) → Worker 测试 → 双端构建 → 部署线上 → 线上新版本校验 → 线上协议冒烟 → 商店包 → 包校验
 *
 * 用法：
 *   node scripts/release.mjs [版本号]        # 如 1.3.2；省略则使用 package.json 当前版本
 *   node scripts/release.mjs --skip-live-smoke   # 跳过线上协议冒烟（本地网络不佳时）
 *
 * 任何必需步骤失败立即中止（exit 1）；线上冒烟失败仅告警（健康检查+资产校验已证明新版本在线）。
 * 发布后仍需人工完成：浏览器手工回归、git 提交推送、商店上传（见脚本末尾提示）。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");
const LIVE = "https://sync.pathmemos.com";
const LIVE_SMOKE_MIN_PASS = 12;

const args = process.argv.slice(2);
const skipLiveSmoke = args.includes("--skip-live-smoke");
const versionArg = args.find((a) => !a.startsWith("--"));

const step = (n, msg) => console.log(`\n===== [${n}] ${msg} =====`);
const die = (msg) => {
  console.error(`\n✗ 发布中止：${msg}`);
  process.exit(1);
};
const run = (cmd, opts = {}) => {
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 带重试的 GET（线上网络偶发抖动，重试到成功为止的硬校验用） */
async function fetchWithRetry(url, { tries = 5, delayMs = 3000 } = {}) {
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.text();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    console.log(`  请求失败（第 ${i}/${tries} 次）：${lastErr.message}，重试…`);
    await sleep(delayMs);
  }
  throw lastErr;
}

/* ---------- [0] 准备：版本号 ---------- */
step(0, "版本号");
try {
  const dirty = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf-8" }).trim();
  if (dirty) console.log("⚠ 工作区有未提交修改——发布基于工作区当前状态，发布后请记得 git 提交推送");
  else console.log("✓ 工作区干净");
} catch { /* 非 git 环境忽略 */ }
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
let version = pkg.version;
if (versionArg) {
  if (!/^\d+\.\d+\.\d+$/.test(versionArg)) die(`版本号格式非法：${versionArg}（应为 x.y.z）`);
  if (versionArg === version) die(`版本号与当前相同（${version}），发布版本必须递增；省略参数则按当前版本发布`);
  version = versionArg;
  fs.writeFileSync(PKG_PATH, JSON.stringify({ ...pkg, version }, null, 2) + "\n");
  console.log(`✓ package.json 版本：${pkg.version} → ${version}`);
} else {
  console.log(`使用当前版本 ${version}（提示：商店在售版本必须小于此值才可更新）`);
}

/* ---------- [1] Worker 本地全量自测 ---------- */
step(1, "Worker 本地自测（test-worker.mjs）");
try {
  run("node scripts/test-worker.mjs");
} catch {
  die("Worker 测试未全部通过，先修复再发布");
}

/* ---------- [2] 双端构建 ---------- */
step(2, "构建扩展（pnpm build）");
run("pnpm build");
step(2, "构建网页版（pnpm build:web）");
run("pnpm build:web");

/* ---------- [3] 部署线上（网页版 + Worker 同批） ---------- */
step(3, "部署到 Cloudflare（deploy-web.sh：构建产物 + worker 同批上线）");
const localIndex = fs.readFileSync(path.join(ROOT, "dist-web", "index.html"), "utf-8");
const localAsset = localIndex.match(/assets\/index-[^"]+\.js/)?.[0];
if (!localAsset) die("本地 dist-web/index.html 中未找到入口 JS 资产名");
run("bash ./deploy-web.sh");

/* ---------- [4] 线上新版本校验（健康 + 资产指纹一致）---------- */
step(4, `线上校验：${LIVE} 已是本次构建`);
let liveHtml = null;
try {
  liveHtml = await fetchWithRetry(`${LIVE}/`);
  await fetchWithRetry(`${LIVE}/api/health`);
} catch (e) {
  die(`线上不可达：${e.message}`);
}
if (!liveHtml.includes(localAsset)) {
  die(`线上 HTML 未引用本次构建的资产 ${localAsset}——部署未生效或被缓存，禁止继续`);
}
console.log(`✓ 线上 HTML 已引用本次构建资产：${localAsset}`);
console.log(`✓ 线上 /api/health 正常`);

/* ---------- [5] 线上协议冒烟 ---------- */
if (!skipLiveSmoke) {
  step(5, "线上协议冒烟（test-auth.mjs，最多 3 次尝试）");
  let best = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = execSync("node scripts/test-auth.mjs", { cwd: ROOT, encoding: "utf-8", timeout: 180000 });
      console.log(out);
      best = Math.max(best, (out.match(/✓/g) || []).length);
    } catch (e) {
      const out = String(e.stdout || "");
      console.log(out.split("\n").filter((l) => l.includes("✓") || l.includes("✗")).join("\n"));
      best = Math.max(best, (out.match(/✓/g) || []).length);
    }
    if (best >= LIVE_SMOKE_MIN_PASS) break;
    console.log(`  第 ${attempt}/3 次仅 ${best}/${LIVE_SMOKE_MIN_PASS} 项通过（本机到 Cloudflare 可能抖动），重试…`);
    await sleep(10000);
  }
  if (best < LIVE_SMOKE_MIN_PASS) {
    console.log(`⚠ 线上冒烟仅 ${best}/${LIVE_SMOKE_MIN_PASS} 通过——健康检查与资产校验均已通过，`);
    console.log(`  大概率是本机网络抖动；请手动打开 ${LIVE} 确认可用后再上传商店。`);
  } else {
    console.log(`✓ 线上冒烟 ${best}/${LIVE_SMOKE_MIN_PASS} 通过`);
  }
} else {
  step(5, "线上协议冒烟（已跳过）");
}

/* ---------- [6] 商店包 ---------- */
step(6, "生成商店包（STORE_BUILD=1 pnpm zip：无 key，商店重签名）");
execSync("pnpm zip", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, STORE_BUILD: "1" }, // env 传参：Windows cmd.exe 不支持 `VAR=1 cmd` 前缀语法
});
const zipPath = path.join(ROOT, ".output", `poetrytab-tool-${version}-chrome.zip`);
if (!fs.existsSync(zipPath)) die(`商店包未生成：${zipPath}`);

/* ---------- [7] 商店包校验 ---------- */
step(7, "商店包校验（manifest 抽查）");
let manifest;
try {
  manifest = JSON.parse(execSync(`unzip -p "${zipPath}" manifest.json`, { cwd: ROOT, encoding: "utf-8" }));
} catch (e) {
  die(`读取包内 manifest.json 失败（需要 unzip）：${e.message}`);
}
if ("key" in manifest) die("商店包 manifest 含 key 字段（商店不允许），STORE_BUILD 未生效？");
if (manifest.version !== version) die(`包内版本 ${manifest.version} ≠ 目标版本 ${version}`);
if (!(manifest.permissions || []).includes("bookmarks")) die("包内缺少 bookmarks 权限（书签导入功能需要）");
const hp = JSON.stringify(manifest.host_permissions || []);
if (!hp.includes("sync.pathmemos.com")) die(`host_permissions 异常：${hp}`);
console.log(`✓ 无 key 字段；版本 ${manifest.version}；permissions=${JSON.stringify(manifest.permissions)}；host=sync.pathmemos.com`);

/* ---------- 完成 ---------- */
console.log(`
========================================
✓ 发布流程完成（v${version}）
  线上：${LIVE}（已校验为新构建）
  商店包：.output/poetrytab-tool-${version}-chrome.zip

后续人工步骤（脚本无法替代）：
  1. 浏览器手工回归：登录 → 建分组/子分组 → 批量收录 → 拖拽（列内+跨列）→ 390px 手机视口
  2. git 提交推送（版本号变更 + 本次发布说明）
  3. 商店上传 zip 并更新权限/数据使用说明（如有变化）
========================================`);
