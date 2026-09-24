# AGENTS.md —— PoetryTab · AI 使用说明

古诗词 + 收藏看板 + 云同步的新标签页产品。一套 React 代码双端发布：Chrome 扩展（WXT）与网页版（Vite），云端为 Cloudflare Worker（sync.pathmemos.com）+ R2。AI 的职责主要是开发、构建、双端验证与部署。

## 常用命令（本目录，包管理器用 pnpm）

```bash
pnpm install        # 首次
pnpm dev            # 扩展开发模式（浏览器加载 .output/chrome-mv3，热更新）
pnpm build          # 构建扩展 → .output/chrome-mv3
pnpm build:web      # 构建网页版 → dist-web
pnpm zip            # 扩展分发 zip
npm run split       # 重新子集化江西拙楷字体（subset-zhuokai.mjs）
```

## 部署

- **网页版 + 同步服务**：一条 `./deploy-web.sh` 完成——构建 dist-web → 归位入口 HTML/图标 → scp 到构建机 `root@192.168.1.44:/root/proton-collect-worker` → 服务器上 `wrangler deploy`（凭据在服务器 `/root/.secrets.env`，本仓库不含密钥）。`worker/src/worker.js` 以本仓库为准，`wrangler.toml` 沿用服务器上的。
- **扩展分发**：`pnpm build` 后加载 `.output/chrome-mv3`，或 `pnpm zip` 出包。云同步 token 已内置于构建产物。

## 代码结构（改哪里）

```
src/pages/newtab/    核心共享 React 应用（扩展与网页版同一套代码）
  App.jsx            页面组装：诗词 → 搜索 → 看板 → 设置
  components/        BookmarkBoard / BookmarkSearch / SettingsPanel
  hooks/             useCollection（云数据层）/ useContentEngine（诗词引擎）
  services/          collection（数据契约）/ contentEngine（诗词源）
  grid.js            网格坐标系工具
entrypoints/newtab/  扩展新标签页入口（WXT）
web/                 网页版入口；vite.web.config.mjs 为其构建配置
worker/src/worker.js 同步 API（部署源）
assets/fonts/        江西拙楷字体
```

## 改动后验证

- E2E 回归在 `../ext-test/test-rgl.cjs`（Playwright，14 步看板全流程；云端断言直接读 `GET /api/sync/:uid` 比对）
- 改共享 UI/数据逻辑时，扩展与网页版**双端都要验**（同一套代码两个构建目标，构建配置不同）

## 云端数据契约（改数据结构必读）

- 存储：R2 桶（Worker 绑定名 `BUCKET`）：`pt/accounts/<uid>.json`（账号：PBKDF2 盐 + 派生 authKey）、`pt/data/<uid>.json`（最新数据 `{savedAt, data}`）、`pt/data/<uid>/snap-*.json`（保留最近 5 份快照）
- 账号：注册提交 PBKDF2-SHA256(密码, 盐, 600k 迭代) 派生的 authKey（明文密码永不上传）；登录为挑战应答（HMAC-SHA256(authKey, challenge)）；会话为无状态令牌 `uid|exp|HMAC(SYNC_TOKEN, uid|exp)`，30 天有效
- API：`POST /api/register` / `POST /api/challenge` / `POST /api/login`（无需令牌，per-IP 限流）；`GET/PUT /api/data`（需 `Authorization: Bearer <会话令牌>`，uid 从令牌解析；PUT ≤8MB 且携带 `X-Base-SavedAt` 乐观锁，与云端 savedAt 不一致返回 409）
- `data` 格式：`folders`（分组+书签，子分组嵌 children 变卡片标签页）/ `quickSites` / `iframeWidgets` / `settings` / `layout`（`i` 卡片标识，`x`/`w` 以参考 10 列坐标系存储、`y`/`h` 为像素；渲染按实际列数 10/6/4/2 等比换算；内容永远完整展开）
- 改字段需同步改三处：`services/collection.js` + `hooks/useCollection.js`（前端契约，注意 `ensureShape` 深度归一）、`worker/src/worker.js`（服务端）、README 数据契约段落，并考虑旧数据兼容
- 已知限制：并发 PUT 的「读版本→比对→写入」非原子（未用 R2 条件写），极端并发下可能后写覆盖先写

## 注意

- 用户以 ID + 密码登录（密码只本地派生、明文永不上传）。不要在日志、提交、示例中输出任何真实用户 ID 的收藏数据
- 版本号在 `package.json`（扩展 manifest 继承它）
- `node_modules/`、`.output/`、`dist-web/` 等构建产物不入库；隐私相关说明见 `privacy.html`
