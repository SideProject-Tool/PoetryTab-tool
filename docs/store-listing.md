# Poetry-Tab 商店发布材料与操作指南

本文档包含上架 Chrome Web Store 与 Edge Add-ons 所需的全部材料与步骤。
发布包与素材均已就绪，见仓库 `store/` 目录。

---

## 发布包

| 文件 | 用途 |
|---|---|
| `poetrytab-tool-chrome.zip`（Downloads 目录，3.0MB） | Chrome Web Store 与 Edge Add-ons 共用的上传包（MV3，manifest v1.0.0） |
| `store/screenshot-chrome-1280x800.png` | Chrome 商店截图（至少 1 张，1280×800） |
| `store/screenshot-edge-1080x680.png` | Edge 商店截图（至少 1 张，1080×680） |
| `store/logo-edge-300x300.png` | Edge 商店 Logo（300×300） |

隐私政策页面（两家商店都必填）：**https://sync.pathmemos.com/privacy.html**

---

## 一、Chrome Web Store（谷歌商店）

### 1. 注册开发者账号（需要你操作）
- 访问 https://chrome.google.com/webstore/devconsole
- 用 Google 账号登录，缴纳 **一次性 5 美元** 注册费（需 Visa/Master 信用卡）
- 建议同时完成「账号验证」（邮箱 + 电话），可增加可发布项数量上限

### 2. 上传与填写
1. 开发者中心 →「新增项」→ 上传 `poetrytab-tool-chrome.zip`
2. 「商店呈现」页填写（可直接复制下方文案）：
   - **名称**：`Poetry-Tab`（自动读自 manifest）
   - **简短说明**（≤132 字符）：见下方「简短说明」
   - **详细说明**：见下方「详细说明」
   - **类别**：生产工具（Productivity）
   - **语言**：中文（简体）
   - **图标**：`public/icon/128.png`
   - **截图**：上传 `store/screenshot-chrome-1280x800.png`
3. 「隐私权」页（必填）：
   - 单一用途说明：`在新标签页展示古诗词，并提供用户自主创建的收藏看板与云同步`
   - 权限用途：`标签页权限仅用于打开书签网址；host 权限仅用于访问自身的云同步服务 sync.pathmemos.com`
   - 「此项目处理用户数据」→ 是 → 勾选：提供用户数据的服务器端处理；数据不转移、不用于广告、不出售
   - 隐私政策网址：`https://sync.pathmemos.com/privacy.html`
4. 「分发」页：公开 / 按区域自行选择；免费
5. 提交审核（首次审核通常 1-3 个工作日，含远程代码/权限审查可能更久）

### 简短说明（复制用）
```
新标签页上的古诗词与收藏看板：每日一首中国诗词，书签分组、iframe 小部件、多端云同步。
```

### 详细说明（复制用）
```
Poetry-Tab 把古诗词和你的收藏，装进每一个新标签页。

📜 每日诗词
打开新标签页即见一首中国古诗词，覆盖诗词、文学、哲学、影视等 12 个分类，点击即可换一首，一键查询出处。

🗂 收藏看板
类 Trello 的自由网格看板：分组管理书签与常用网站，卡片可拖动排序、自由拉伸，间距对齐，内容完整展开。支持 iframe 小部件，把任意网站直接嵌入新标签页。

☁️ 云同步
一个用户 ID 走天下：浏览器扩展与网页版（sync.pathmemos.com）共享同一份收藏，修改自动保存到云端，保留 5 个历史版本。

✨ 其他特性
- 深色 / 浅色 / 跟随系统主题
- 搜索收藏与搜索引擎直达（百度 / Google / Bing / DuckDuckGo）
- 12 个诗词分类自由组合
- 隐私优先：无广告、无追踪，数据存放在你自己的云端空间

官网与网页版：https://sync.pathmemos.com
```

---

## 二、Edge Add-ons（微软商店）

### 1. 注册账号（需要你操作）
- 访问 https://partner.microsoft.com/dashboard/microsoftedge
- 用 Microsoft 账号登录，完成 Partner Center 注册（免费）
- 选择「个人」或「公司」账户类型均可

### 2. 上传与填写
1. Partner Center → Edge 计划 →「创建新扩展」
2. 上传同一个 `poetrytab-tool-chrome.zip`（Edge 兼容 Chrome MV3 包，无需改代码）
3. 填写（复制下方内容）：
   - **显示名称**：`Poetry-Tab`
   - **简短说明** / **描述**：同 Chrome 文案
   - **类别**：生产工具
   - **商店 Logo**：`store/logo-edge-300x300.png`（300×300）
   - **截图**：上传 `store/screenshot-edge-1080x680.png`
   - **隐私政策 URL**：`https://sync.pathmemos.com/privacy.html`
   - **网站 URL**：`https://sync.pathmemos.com`
4. 提交审核（通常 1-7 个工作日）

---

## 三、发布前自查清单

- [x] ZIP 包内 manifest.json 位于根目录，版本 1.0.0
- [x] 图标 16-256px 全套（新 Logo）
- [x] 无后台脚本、权限最小化（无额外 API 权限）
- [x] 隐私政策页已上线
- [x] 截图与 Logo 素材就绪
- [x] 本地加载验证通过（E2E 14 步）

## 四、需要你完成的认证/操作

1. **Chrome**：Google 账号 + 5 美元注册费（信用卡）；上传可在网页完成，无需给我授权
2. **Edge**：Microsoft 账号注册 Partner Center；网页上传即可
3. 若希望我通过 API 直接代为上传（Chrome Web Store API），需要你在 Google Cloud 创建 OAuth 客户端并提供刷新令牌；Edge 的 API 需要 Azure AD 应用配置——两种手动网页上传都更简单，推荐手动
