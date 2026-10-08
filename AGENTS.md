# AGENTS.md —— PoetryTab · AI 使用说明

古诗词 + 收藏看板 + 云同步的新标签页产品。一套 React 代码双端发布：Chrome 扩展（WXT）与网页版（Vite），云端为 Cloudflare Worker（sync.pathmemos.com）+ R2。AI 的职责主要是开发、构建、双端验证与部署。

**业务文档（不读代码理解产品）**：`docs/product-guide.md`（功能与行为规则）· `docs/sync-and-data.md`（账号/同步/冲突/数据结构）· `docs/architecture.md`（架构与设计决策）· `docs/store-listing.md`（商店上架材料）。

## Spec 规范驱动开发（文档即规范，必读）

本仓库以文档为单一事实来源（Single Source of Truth）：**文档描述的是产品的「应有行为」，代码是实现**。任何修改必须让两者保持一致，禁止「只改代码不留文档」的暗改。

**工作流**：

1. **Spec 先行**：涉及用户可感知的行为、交互、数据契约变更时，先在对应文档里写清目标行为（作为本次变更的验收标准），再动代码
2. **实现**：按文档实现，保证双端构建通过（浏览器验证由用户执行，见「改动后验证」）
3. **回写与自查**：完成后逐条对照下表，把变更同步回写到所有受影响的文档；同一提交应包含代码 + 文档

**变更类型 → 必须回写的文档**：

| 改了什么 | 必须同步更新 |
|---|---|
| 用户功能 / 交互 / 快捷键 / 移动端行为 | `docs/product-guide.md`（+ README 功能特性段） |
| 同步行为 / 冲突规则 / 认证 / API / 数据结构 | `docs/sync-and-data.md` + README 数据契约段；数据结构另需 `services/collection.js` + `hooks/useCollection.js` + `worker/src/worker.js` 三处代码同步（见「云端数据契约」节） |
| 架构 / 模块职责 / 技术选型 / 性能策略 | `docs/architecture.md` |
| 发版流程 / 商店材料 / 版本策略 | `docs/store-listing.md` + AGENTS「发版与商店提交」 |
| 构建 / 部署 / 测试等仓库操作流程 | AGENTS.md 对应章节 |
| 界面截图级变化（商店素材过期） | 在 `docs/store-listing.md` 标注「截图需重截」 |

**验收红线**：交付自查时逐项问「这个行为在文档里能查到吗」——查不到就是文档欠账，必须补；发现文档与代码不一致时，先确认哪个是预期行为，修齐后才能提交。

## 常用命令（本目录，包管理器用 pnpm）

```bash
pnpm install        # 首次
pnpm dev            # 扩展开发模式（浏览器加载 .output/chrome-mv3，热更新）
pnpm build          # 构建扩展 → .output/chrome-mv3（带 key 固定扩展 ID，本地加载用）
pnpm build:web      # 构建网页版 → dist-web
pnpm zip            # 扩展分发 zip（带 key）
npm run split       # 重新子集化江西拙楷字体（subset-zhuokai.mjs）
npx vite --config vite.web.config.mjs   # 网页版本地开发服务器（注意：直连生产云同步，写真实数据——开发验证一律用一次性测试账号，如 opt-chk-<随机>）
node scripts/test-worker.mjs  # Worker 本地全量自测（内存 R2，无需部署）
node scripts/test-auth.mjs    # 线上认证协议自测（注册/挑战/登录/数据读写/越权，随机测试账号）
node scripts/release.mjs [版本号]  # 一键发布：测试→构建→部署→线上校验→冒烟→商店包（详见「发版与商店提交」）
```

## 部署

- **网页版 + 同步服务**：一条 `./deploy-web.sh` 完成——构建 dist-web → 归位入口 HTML/图标 → scp 到构建机 `root@192.168.1.44:/root/proton-collect-worker` → 服务器上 `wrangler deploy`（凭据在服务器 `/root/.secrets.env`，本仓库不含密钥）。`worker/src/worker.js` 以本仓库为准，`wrangler.toml` 沿用服务器上的。
- **服务器 wrangler.toml 关键配置**：Worker 名 `proton-collect-sync`、R2 桶名 `proton-collect-sync`、`[assets] directory="./public" binding="ASSETS" run_worker_first=true`（**binding 必须显式写**，缺省不注入 `env.ASSETS`，静态分支会 500；run_worker_first 让 no-store/immutable 头生效）、路由 `sync.pathmemos.com` custom_domain、`SYNC_TOKEN` 为云端 secret。服务器 wrangler 经 `npm i -g wrangler` 安装（/usr/bin/wrangler）。
- **扩展分发**：仅通过 Chrome/Edge 商店（无自更新渠道）。crx/updates 相关文件与脚本已移除。

## 发版与商店提交

**一键发布**（把全流程固化为脚本，避免漏步骤——尤其「改完忘记部署」）：

```bash
node scripts/release.mjs [版本号]     # 版本号可省略（按当前版本发布）；--skip-live-smoke 跳过线上冒烟
```

### 使用方式

**参数与选项**：

| 用法 | 说明 |
|---|---|
| `node scripts/release.mjs 1.4.0` | 常规发版：先把 `1.4.0` 写入 package.json，再走全流程（版本必须大于商店在售版本） |
| `node scripts/release.mjs` | 不带版本号：按 package.json 当前版本发布（适合「代码已提交、只差部署」的场景） |
| `node scripts/release.mjs 1.4.0 --skip-live-smoke` | 跳过第 5 步线上冒烟（本机网络不佳时；健康检查+资产校验仍会执行） |
| 与当前版本相同的版本号会报错中止 | 防止忘改版本直接发布（商店会拒收同版本包）；确要重发同版本请先自行改 package.json |

**典型场景**：

```bash
# 场景一：功能开发完，发新版本（最常用）
node scripts/release.mjs 1.4.0

# 场景二：只改了文档/注释，无需升版本，重新部署线上
node scripts/release.mjs

# 场景三：本机到 Cloudflare 网络不稳（冒烟总失败时）
node scripts/release.mjs 1.4.1 --skip-live-smoke
```

**脚本自动执行的内容（按序，任一必需步骤失败立即中止，不会带病发布）**：

1. 版本号写入 package.json（若传参）
2. Worker 自测：`node scripts/test-worker.mjs` 全绿才继续
3. 双端构建：`pnpm build` + `pnpm build:web`
4. 部署：`./deploy-web.sh`（网页版 + Worker 同批；改了 API 协议/错误码/数据结构必须同批，新旧混搭会行为错乱）
5. **线上校验**：抓取线上 HTML，确认已引用本次构建的资产指纹 + `/api/health` 检查（防止「部署没生效还继续走」）
6. 线上冒烟：`node scripts/test-auth.mjs`（自动重试 3 次取最好结果）
7. 商店包：`STORE_BUILD=1 pnpm zip` → 解包抽查 manifest（无 `key`、版本一致、permissions 正确）

**失败处置对照**：

| 中止步骤 | 含义与处置 |
|---|---|
| 步骤 1 版本号报错 | 版本格式非法或与当前相同——改一个更大的版本号 |
| 步骤 2 Worker 测试失败 | 服务端逻辑被改坏，修复后重跑 |
| 步骤 3/4 构建或部署失败 | 看 gulp/vite/scp 报错输出修复；部署失败不涉及线上（线上保持旧版） |
| 步骤 5 线上校验失败 | 部署命令成功但线上没更新（权限/缓存/服务器问题）——**禁止继续**，排查 deploy-web.sh |
| 步骤 6 冒烟告警（不中止） | 大概率本机网络抖动；打开线上站确认可用即可继续上传商店 |
| 步骤 7 包校验失败 | STORE_BUILD 未生效或 manifest 异常——检查 wxt.config.js 与版本号 |

**脚本完成后仍需人工**（脚本无法替代）：

1. 浏览器手工回归：登录 → 建分组/子分组 → 批量收录 → 拖拽（列内+跨列）→ 390px 手机视口 → 快照列表（见「改动后验证」）
2. git 提交推送（版本号变更 + 本次发布说明）
3. 商店上传 zip 并更新权限/数据使用说明（如有变化）

### 要点

- 本地构建（`pnpm build`）带 key 固定扩展 ID；商店构建（脚本内 `STORE_BUILD=1`）剔除 key，由商店重新签名（扩展 ID 与本地不同）
- 商店审核要点：`bookmarks` 权限需填用途说明（「导入浏览器书签」功能，仅在用户主动点击导入时读取）；数据使用声明如实勾选（收藏数据同步到自有服务器 sync.pathmemos.com，不与第三方共享）；新增权限会触发更严格审核
- `store/` 目录是商店素材（截图 1280×800、图标）；提交前截图需与当前界面核对，不符则重截
- **扩展分发**：`pnpm build` 后加载 `.output/chrome-mv3`，或 `pnpm zip` 出包。云同步端点 URL 内置于构建产物（`src/pages/newtab/services/constants.js` 的 `CLOUD_SYNC.url`）；会话令牌为登录后运行时下发（PBKDF2 派生 authKey → 服务器会话令牌，存 localStorage `pt.session`），构建产物中不含任何静态 token。

## 代码结构（改哪里）

```
src/pages/newtab/    核心共享 React 应用（扩展与网页版同一套代码）
  App.jsx            页面组装：诗词 → 搜索 → 看板 → 设置
  components/        BookmarkBoard（看板编排）/ BookmarkSearch / SettingsPanel
  components/board/  看板子模块：layoutEngine（纯布局函数）/ widgets（卡片部件）/
                     ManageSheet（管理面板）/ FolderBrowser / GateScreen（登录门）
  hooks/             useCollection（云数据层）/ useContentEngine（诗词引擎）
  services/          collection（数据契约）/ contentEngine（诗词源）/ bookmarks（书签导入解析）
  grid.js            网格坐标系工具（REF_COLS / FLOW_MAX_WIDTH / colsForWidth）
src/platform.js      平台适配层：openUrl / getBrowserBookmarks（扩展端 chrome.bookmarks）
entrypoints/newtab/  扩展新标签页入口（WXT）
web/                 网页版入口；vite.web.config.mjs 为其构建配置
worker/src/worker.js 同步 API（部署源；改动后跑 node scripts/test-worker.mjs）
assets/fonts/        江西拙楷字体
```

## 改动后验证（由用户执行）

**分工约定：AI 开发完成 = 代码完成 + 双端构建通过（`pnpm build` / `pnpm build:web`）+ 相关文档已回写，到此为止。AI 不做浏览器验证/回归，直接向用户汇报改动点与建议验证步骤，验证由用户执行。**

- 汇报时建议附：改动了什么、用户应重点验证哪些交互（可参考下方手工回归要点）
- Worker 自测与发布门禁由 `node scripts/release.mjs` 自动执行（test-worker / 线上校验 / 冒烟），属发布流程而非开发验证
- 手工回归要点（供用户验证参考）：登录门 → 建分组/子分组 → 批量收录 → 拖拽（列内 + 跨列）→ 390px 手机视口单列 → 快照列表
- E2E 自动化暂缺；如需补自动化，基于列式布局编写 Playwright 断言

## 云端数据契约（改数据结构必读）

- 存储：R2 桶（Worker 绑定名 `BUCKET`）：`pt/accounts/<uid>.json`（账号：PBKDF2 盐 + 派生 authKey）、`pt/data/<uid>.json`（最新数据 `{savedAt, data}`）、`pt/data/<uid>/snap-*.json`（保留最近 5 份快照，`/api/snaps` 可列、`/api/snap/restore` 可恢复）、`pt/favicons/<domain>.bin`（favicon 代理缓存 30 天）
- 账号：注册提交 PBKDF2-SHA256(密码, 盐, 600k 迭代) 派生的 authKey（明文密码永不上传，账号创建用 R2 条件写防并发抢注）；登录为挑战应答（HMAC-SHA256(authKey, challenge)），**不存在的 ID 返回 HMAC 确定性伪盐**防枚举；会话为无状态令牌 `uid|exp|HMAC(SYNC_TOKEN, uid|exp)`，30 天有效
- API：`POST /api/register` / `POST /api/challenge` / `POST /api/login`（无需令牌，per-IP 限流）；`GET/PUT /api/data`（需 `Authorization: Bearer <会话令牌>`，GET 支持 If-None-Match→304，PUT ≤8MB 且 `X-Base-SavedAt` 乐观锁经 **R2 条件写 onlyIf etag 原子校验**，不一致 409）；`GET /api/snaps`、`POST /api/snap/restore`（快照）；`GET /api/favicon?domain=`（图标代理）；`GET /api/title?url=`（网页标题代理，收录未填名时自动取名）。CORS 白名单含 `X-Base-SavedAt`/`If-None-Match`，跨源开发环境可用
- 客户端冲突策略：409 且本地 dirty → saveState=conflict 暂停自动保存，用户在设置面板二选一（上传=本地为准，用云端版本号借道；恢复=云端为准）；同浏览器多标签页 BroadcastChannel 即时互通；`pt.cache` 为 `{uid, savedAt, dirty, data}`（账号隔离 + 版本/脏标记持久化，重启可恢复仲裁现场）
- `data` 格式：`folders`（分组+书签，子分组嵌 children 变卡片标签页）/ `quickSites` / `iframeWidgets`（item 可带 `h` 卡片高度，⋯ 菜单可调）/ `settings`（含 `cols` 看板列数）/ `layout`（**v2 列式**：`{v:2, cols:[[卡id]×5槽]}`，设备按自身列数取前 N 列、溢出并入末列；旧 v1 坐标数组加载时自动迁移；<640px 单列、拖拽停用）。卡片渲染为 CSS 流式列（无绝对定位/无逐卡高度测量），拖拽为自研指针几何（悬停列=x 区间、插入位=卡片中点），**不依赖 dnd-kit**
- 改字段需同步改三处：`services/collection.js` + `hooks/useCollection.js`（前端契约，注意 `ensureShape` 深度归一）、`worker/src/worker.js`（服务端）、README 数据契约段落，并考虑旧数据兼容
- 静态资源：`/assets/*`（带 hash）由 Worker 设 `Cache-Control: immutable` 一年缓存，HTML 保持 no-store

## 注意

- 用户以 ID + 密码登录（密码只本地派生、明文永不上传）。不要在日志、提交、示例中输出任何真实用户 ID 的收藏数据
- 版本号在 `package.json`（扩展 manifest 继承它）
- `node_modules/`、`.output/`、`dist-web/` 等构建产物不入库；隐私相关说明见 `web/public/privacy.html`（随网页版部署上线）
