# Poetry-Tab 商店发布材料与操作指南

本文档包含上架 Chrome Web Store 与 Edge Add-ons 所需的全部材料与步骤。

> 发版完整流程（版本号 → 验证 → 部署 → 打商店包）见根目录 `AGENTS.md`「发版与商店提交」。

---

## 发布包

| 文件 | 用途 |
|---|---|
| `.output/poetrytab-tool-<版本>-chrome.zip`（由 `STORE_BUILD=1 pnpm zip` 生成，约 3.3MB） | Chrome Web Store 与 Edge Add-ons 共用上传包（MV3，无 key） |
| `store/screenshot-chrome-1280x800.png` | Chrome 商店截图（1280×800）⚠️ 现存 chrome/edge 两张截图均为旧版界面，**需重截** |
| `store/screenshot-edge-1080x680.png` | Edge 商店截图（1080×680）⚠️ 同上 |
| `store/logo-edge-300x300.png` | Edge 商店 Logo（300×300） |

Chrome Web Store 扩展 ID：本地开发构建经 manifest `key` 固定 ID 用于开发调试；**商店包剔除 key，由商店签名分配 ID（与本地不同，以上传后分配为准）**。

提交前抽查 zip 内 manifest：**无 `key` 字段**、版本正确、`permissions: ["bookmarks"]`、host 权限仅 `https://sync.pathmemos.com/*`。

隐私政策页面（两家商店都必填）：**https://sync.pathmemos.com/privacy.html**

---

## 一、Chrome Web Store（谷歌商店）

### 1. 注册开发者账号（需要你操作）
- 访问 https://chrome.google.com/webstore/devconsole
- 用 Google 账号登录，缴纳 **一次性 5 美元** 注册费（需 Visa/Master 信用卡）
- 建议同时完成「账号验证」（邮箱 + 电话），可增加可发布项数量上限

### 2. 上传与填写
1. 开发者中心 →「新增项」→ 上传 zip 包
2. 「商店呈现」页填写（文案见下方）：
   - **名称**：`Poetry-Tab`（自动读自 manifest）
   - **类别**：生产工具（Productivity）；**语言**：中文（简体）
   - **图标**：`public/icon/128.png`；**截图**：1280×800
3. 「隐私权」页（必填；扩展含 bookmarks 权限，说明必须对应）：
   - 单一用途说明：`在新标签页展示古诗词，并提供用户自主创建的收藏看板与云同步`
   - **权限用途**：`bookmarks 权限仅用于「导入浏览器书签」功能——在用户主动点击导入时读取浏览器书签树并导入用户的收藏看板，不做任何其他访问；host 权限仅用于访问自身的云同步服务 sync.pathmemos.com`
   - 「此项目处理用户数据」→ 是 → 勾选：提供用户数据的服务器端处理；数据不转移、不用于广告、不出售
   - 隐私政策网址：`https://sync.pathmemos.com/privacy.html`
4. 「分发」页：公开 / 按区域自行选择；免费
5. 提交审核（首次 1-3 个工作日；**新增权限会触发更严格审核**，可能更久）

### 简短说明（≤132 字符，复制用）
```
新标签页上的古诗词与收藏看板：每日诗词、拼音搜索、书签一键导入、iframe 小部件、多端云同步。
```

### 详细说明（复制用）
```
Poetry-Tab 把古诗词和你的收藏，装进每一个新标签页。

📜 每日诗词
打开新标签页默认呈现中国古诗词；可在设置中启用文学、哲学、影视、网易云等共 12 类内容，点击换一首，一键查询出处。

🗂 收藏看板
列式看板：卡片拖动即可列内排序、跨列移动；分组支持一级子分组（标签页展示）；iframe 小部件把任意网站嵌入新标签页（高度可调）。

📥 一键导入与批量收录
导入浏览器书签（自动去重）；管理面板多行批量录入；标题留空自动获取网页名称。

🔍 搜索
搜索自己的收藏，支持拼音与首字母（weibo → 新浪微博）；没有收藏结果时回车直接网页搜索。

☁️ 云同步
一个用户 ID 走天下：浏览器扩展与网页版（sync.pathmemos.com）共享同一份收藏，自动保存、5 份历史快照可恢复、JSON 备份导出。误删 6 秒内可撤销。

✨ 其他
深色 / 浅色 / 跟随系统主题；百度 / Google / Bing / DuckDuckGo；无广告、无追踪，数据仅存于本服务运营的 Cloudflare 存储，不与第三方共享。

官网与网页版：https://sync.pathmemos.com
```

---

## 二、Edge Add-ons（微软商店）

1. 访问 https://partner.microsoft.com/dashboard/microsoftedge，用 Microsoft 账号完成 Partner Center 注册（免费）
2. Edge 计划 →「创建新扩展」→ 上传同一个 zip（Edge 兼容 Chrome MV3 包）
3. 填写：显示名称 `Poetry-Tab`；简短说明/描述同 Chrome 文案；类别生产工具；Logo 用 `store/logo-edge-300x300.png`；截图 1080×680；隐私政策 URL 与网站 URL 均填 sync.pathmemos.com
4. 提交审核（通常 1-7 个工作日）

---

## 三、发布前自查清单

- [ ] `package.json` 版本已提升且大于商店在售版本
- [ ] `node scripts/test-worker.mjs` 全绿；`pnpm build && pnpm build:web` 通过；双端手工回归
- [ ] `STORE_BUILD=1 pnpm zip` 生成的包解包抽查：无 key、版本正确、permissions 符合预期
- [ ] 隐私权页权限说明与实际权限一致（bookmarks / host）
- [ ] 截图为当前版本界面（现存 `store/` 截图为旧版界面，上传前需重截 1280×800 / 1080×680）
- [ ] 隐私政策页已上线且内容与当前数据处理一致；数据删除渠道已在页内载明（邮件申请，见 `public/privacy.html`）

## 四、需要你完成的认证/操作

1. **Chrome**：Google 账号 + 5 美元注册费（信用卡）；网页上传即可
2. **Edge**：Microsoft 账号注册 Partner Center；网页上传即可
3. 代上传（Chrome Web Store API / Edge API）需要另行配置 OAuth，手动网页上传更简单，不推荐
