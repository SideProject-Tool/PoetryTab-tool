<p align="center">
  <img src="public/icon/256.png" alt="Poetry-Tab 图标" width="112" height="112" />
</p>

<h1 align="center">Poetry-Tab</h1>

<p align="center"><b>古诗词 · 收藏看板 · 云同步 —— 你的新标签页，一屏装下诗与远方</b></p>

<p align="center">
  <a href="#-功能特性">功能</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-使用指南">使用指南</a> ·
  <a href="#-架构">架构</a> ·
  <a href="#-云端数据契约">数据契约</a> ·
  <a href="#-开发">开发</a> ·
  <a href="#-部署">部署</a>
</p>

<p align="center">
  <img src="preview/home.png" alt="新标签页总览" width="720" />
</p>

<p align="center"><sub>截图为早期版本界面，仅作示意；功能以文字描述为准</sub></p>

---

## ✨ 功能特性

### 📜 古诗词
- 每次打开新标签页展示一首诗词，**点击即可换一首**；一轮内不重复，读完一轮自动重新洗牌
- 内置 **12 个分类**（诗词、文学、哲学、动画、影视、网易云等），在设置中自由勾选启用
- 诗词支持「🔍 查出处」，一键跳转搜索引擎查询出处与全文
- 超长诗句单行展示，超出自动省略号截断，页面高度恒定不跳动

### 🔍 智能搜索框
- **搜索自己的收藏**：输入即匹配书签标题、网址与所在分组路径
- **拼音与首字母**：`weibo` 命中「新浪微博」、`blbl` 命中「哔哩哔哩」（pinyin-pro 按需加载）
- **搜索引擎可配置**：百度 / Google / Bing / DuckDuckGo，用于诗词「🔍 查出处」跳转；收藏无命中时回车直达网页搜索
- 默认隐藏给诗词留白：`S` 呼出、`Esc` 收起、右上角 🔍 开关

### 🗂 收藏看板（核心）
<p align="center">
  <img src="preview/board.png" alt="收藏看板" width="640" />
</p>

- **分组书签**：自建分组，卡片内书签磁贴铺开完整可见；**支持一级子分组**（卡片内标签页展示，管理工作台可创建/进入）；**批量收录**（多行文本一行一条）；**名称留空自动取网页标题**（服务端代理）
- **iframe 小部件**：把任意网站直接内嵌进新标签页（监控面板、文档站、日历……）；视口内才加载、会话内不重载，操作收进 ⋯ 菜单（高度预设档位或自定义像素值，随账号同步）
- **一键导入浏览器书签**：扩展端直接读浏览器书签树；网页版导入导出的书签 HTML（重复网址自动跳过）
- **误删无忧**：删除书签/分组/小部件后 6 秒内可一键撤销
- **列式看板，顺滑流畅**：
  - 卡片按列排布、每列等宽；列数可设（自动 5/4/3/2 或固定 2-5，随账号同步），手机自动单列满宽
  - 按住卡片标题**拖动**——列内上下排序、跨列移动，其余卡片实时让位（纯 CSS 流式布局，无逐卡测量，天然流畅）
  - 视口外的卡片自动跳过渲染（content-visibility），上百卡片也流畅
- **右下角悬浮按钮（FAB）**：新建分组 / 添加 iframe 小部件，不占网格

### ☁️ 云同步
- 一套**用户 ID** 走天下：同一 ID 在浏览器扩展、任何设备的网页上打开，都是同一份收藏
- 修改 **700ms 防抖自动保存**；同浏览器多标签页经 BroadcastChannel 即时互通
- **多设备冲突强制仲裁**：云端被他设备更新且本地有未同步修改时，暂停自动保存，由你在「上传到云端（本地为准）/ 从云端恢复（云端为准）」中明确选择，绝不静默覆盖
- 服务端保留 **5 个历史版本快照**，设置面板可查看并一键恢复（恢复动作本身也留快照，可再撤销）
- 支持**导出 / 恢复 JSON 备份**；本地缓存离线渲染，弱网/断网先看缓存再同步，GET 带 ETag 未变化零流量

### ⚙️ 设置
设置面板为居中弹窗，分三个标签页：
| 标签页 | 内容 |
|---|---|
| 外观 | 主题、搜索引擎、看板列数、**诗词区留白**、展示类别、**页面底色**（浅色/深色两套预设+自定义色号）、**卡片显隐** —— 全部直选直显 |
| 云同步 | 用户 ID（输入新 ID 回车切换登录）、上传到云端、从云端恢复、打开网页版、退出登录 |
| 导入与备份 | 导入浏览器书签 / 书签 HTML、导出 / 恢复 JSON 备份、历史版本快照恢复 |

---

## 🚀 快速开始

### 方式一：浏览器扩展
1. 上架后从 Chrome Web Store / Edge Add-ons 安装（商店链接待上架后补充）
2. 也可自行构建加载：`pnpm build` → 打开 `chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3`

### 方式二：网页版（免安装）
直接访问 **https://sync.pathmemos.com**，与扩展共用同一套云数据。

> 扩展与网页版功能完全一致（同一套 React 代码双端构建），数据实时互通。

---

## 📖 使用指南

### 首次使用
打开新标签页会看到登录门：
- **新建用户**：输入一个你记得住的 ID（如 `my-poetry`）和密码（至少 6 位），点「新建用户」即创建账号
- **登录**：在别的设备上已用过？同一 ID + 密码登录即可接续

> ID + 密码即账号，无需邮箱注册。密码只在本地经 PBKDF2 派生后以挑战应答方式登录，明文永不上传、服务端只存派生结果。

### 看板操作
| 操作 | 方式 |
|---|---|
| 新建分组 / 添加小部件 | 右下角 **＋** 悬浮按钮 |
| 管理书签 / 子分组 | 卡片右上角 **⋯** 打开管理工作台：左栏分组树、右栏列表（搜索 / 拖拽排序 / 点行编辑 / ⋯ 菜单） |
| 批量移动书签 | 工作台勾选多条 → 「移动到…」选择目标分组/子分组，一次跨层级移动 |
| 收录书签 | 工作台右上「**＋ 收录**」；标题留空自动取网页名；「批量」支持多行粘贴 |
| 删除 | 行尾 ⋯ 菜单 → 删除（书签即删可撤销；含内容的子分组二次确认） |
| 拖动排序 | 按住**卡片标题栏**拖动（列内/跨列）；工作台列表内按行首把手拖动 |
| 查看 iframe 内容 | 部分网站禁止内嵌时，点卡片右上角 **⋯ → 新窗口打开** |

### 诗词
- 点击诗词区域 → 换一首
- 点「🔍 查出处」→ 搜索该句出处

---

## 🏗 架构

```
┌───────────────────────────────────────────────┐
│              一套 React 代码（src/pages/newtab）              │
├──────────────────────┬──────────────────────────┤
│   Chrome 扩展（WXT）    │     网页版（Vite → dist-web）   │
│   newtab 覆盖新标签页     │   任意浏览器访问，免安装          │
└──────────┬───────────┴──────────┬───────────┘
           │      读写同一份云数据（700ms 防抖）      │
           ▼                      ▼
┌───────────────────────────────────────────────┐
│      Cloudflare Worker（sync.pathmemos.com）        │
│  静态资源（ASSETS）+ 同步 API + R2 五版本快照          │
└───────────────────────────────────────────────┘
```

**技术栈**：WXT 0.20 · React 19 · Vite 7 · Tailwind CSS 4 · daisyUI 5 · Cloudflare Workers + R2

---

## ☁️ 云端数据契约（摘要）

**完整规格以 [docs/sync-and-data.md](docs/sync-and-data.md) 为唯一权威**（账号认证、同步状态机、快照、缓存、字段/默认值/枚举全表），此处仅保留公开摘要。

- 存储（Cloudflare R2，Worker 绑定名 `BUCKET`）：`pt/accounts/<uid>.json` 账号派生凭据 · `pt/data/<uid>.json` 最新数据（`{savedAt, data}`）· `pt/data/<uid>/snap-*.json` 历史快照（保留最近 5 份）
- 账号 = 自设 ID + 密码：密码只在本地经 PBKDF2（600k 迭代）派生，以挑战应答方式登录，**明文永不上传**；会话为 30 天无状态令牌（`Authorization: Bearer`），uid 从令牌解析，杜绝越权
- API：`POST /api/register` / `/api/challenge` / `/api/login`（免令牌、per-IP 限流）· `GET/PUT /api/data`（`X-Base-SavedAt` 乐观锁，8MB 上限超限 413，GET 支持 ETag → 304）· `GET /api/snaps`、`POST /api/snap/restore`（快照）· `GET /api/favicon?domain=`、`GET /api/title?url=`（代理）· `GET /api/health`
- 数据为**整份覆盖**模型：并发 PUT 由服务端 R2 条件写原子仲裁，后到者 409 进入客户端强制仲裁（完整规则见 sync-and-data「同步状态机」）

---

## 💻 开发

```bash
pnpm install        # 安装依赖

pnpm dev            # 扩展开发模式（热更新，浏览器加载 .output/chrome-mv3）
pnpm build          # 构建扩展 → .output/chrome-mv3
pnpm build:web      # 构建网页版 → dist-web
pnpm zip            # 打包扩展 zip
```

**目录结构**（逐文件职责见 docs/architecture.md「模块职责」）：
```
├── entrypoints/newtab/     # 扩展新标签页入口（WXT）
├── src/pages/newtab/       # 双端共享的 React 应用（App / components+board / hooks / services / grid.js）
├── src/platform.js         # 平台适配层（扩展 vs 网页宿主差异）
├── worker/src/worker.js    # 同步 API（部署源）
├── web/                    # 网页版入口（vite.web.config.mjs 构建配置）
├── assets/fonts/           # 江西拙楷字体
├── docs/                   # 业务文档（产品手册 / 同步与数据 / 架构 / 商店上架）
└── preview/                # README 截图
```

**测试**：
- Worker 本地自测（无需部署，R2 内存模拟）：`node scripts/test-worker.mjs` —— 注册/防枚举/ETag/CAS/快照恢复/favicon/title/CORS 全量断言
- 线上协议冒烟：`node scripts/test-auth.mjs`
- 浏览器手工回归要点见 AGENTS.md「改动后验证」

---

## 🚢 部署

- **网页版 + 同步服务**：`./deploy-web.sh` 一条命令完成（构建 dist-web → 同步构建机 → 服务器 wrangler deploy）
- **一键发布**（测试 → 构建 → 部署 → 线上校验 → 冒烟 → 商店包，任一步失败即中止）：`node scripts/release.mjs [版本号]`；完整流程与失败处置见 `AGENTS.md`「发版与商店提交」
- `SYNC_TOKEN` 为服务端 HMAC 密钥（会话令牌与登录挑战签名），配置于部署机，绝不下发前端

### 扩展分发
- `pnpm build` 后加载 `.output/chrome-mv3`，或 `pnpm zip` 出分发包
- 云同步端点 URL 内置于构建产物（`src/pages/newtab/services/constants.js` 的 `CLOUD_SYNC.url`）；会话令牌为登录后运行时下发（PBKDF2 派生 → 服务器会话令牌，存 localStorage），构建产物不含任何静态 token

---

## 🔒 隐私

- 收藏数据存在**你自己的** Cloudflare R2 中，不经手任何第三方
- 无埋点、无追踪、无广告；密码只在本地 PBKDF2 派生后以挑战应答方式登录，明文永不上传
- 账号凭 ID + 密码登录，请妥善保管

## 📄 License

[MIT](LICENSE)。诗词数据来自开源项目 [sentences-bundle](https://github.com/hitokoto-osc/sentences-bundle)（Hitokoto），字体为[江西拙楷](https://chinese-font.netlify.app/)（中文网字计划）。
