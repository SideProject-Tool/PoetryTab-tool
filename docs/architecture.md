# 架构与设计决策

> 面向接手者：系统拓扑、模块职责、关键决策的来龙去脉。业务行为见 `product-guide.md` / `sync-and-data.md`；日常仓库操作见 `AGENTS.md`。

---

## 一、系统拓扑

```
┌────────────────────────────────────────────────┐
│        一套 React 应用（src/pages/newtab）        │
├───────────────────────┬────────────────────────┤
│  Chrome 扩展（WXT）     │   网页版（Vite）          │
│  newtab 覆盖新标签页     │   sync.pathmemos.com    │
└──────────┬────────────┴───────────┬────────────┘
           │   同一账号读写同一份云数据   │
           ▼                        ▼
┌────────────────────────────────────────────────┐
│   Cloudflare Worker（proton-collect-sync）       │
│   静态资产托管 + 同步 API + 代理（favicon/title）  │
│   存储：R2 桶 proton-collect-sync                │
└────────────────────────────────────────────────┘
```

- **一套代码双端发布**：扩展（WXT 构建，manifest 继承 package.json 版本）与网页版（Vite 构建 dist-web）共享 `src/pages/newtab` 全部界面与逻辑
- **平台差异收敛在 `src/platform.js`**：`openUrl`（扩展 chrome.tabs / 网页 window.open）、`getBrowserBookmarks`（仅扩展，读 chrome.bookmarks）
- 数据双向互通：扩展里改的收藏，网页版登录同 ID 即见

## 二、模块职责

```
src/pages/newtab/
  App.jsx                 页面组装：诗词区 → 搜索 → 看板 → 设置 → 撤销 toast
  grid.js                 列数常量与自适应函数（<640 单列）
  components/
    BookmarkBoard.jsx     看板编排：列容器、自研指针拖拽、FAB、弹窗调度
    BookmarkSearch.jsx    搜索（拼音索引按需加载 pinyin-pro）
    SettingsPanel.jsx     设置弹窗（外观 / 云同步 / 导入与备份 三 tab）
    board/
      layoutEngine.js     布局纯函数：v2 列式归一、v1→v2 迁移、槽位↔显示列换算
      widgets.jsx         卡片部件（memo 化）：分组卡 / 常用网站卡 / iframe 卡（⋯ 菜单、懒挂载）
      ManageSheet.jsx     卡片管理面板：收录 / 批量 / 子分组面包屑 / 自动取名
      FolderBrowser.jsx   子分组浏览浮层（面包屑 + 磁贴）
      GateScreen.jsx      登录门
  hooks/
    useCollection.js      云数据层（全部业务规则在此：认证、保存管线、冲突仲裁、CRUD、撤销）
    useContentEngine.js   诗词引擎（分类加载、洗牌轮播）
  services/
    collection.js         数据契约纯函数（树操作、safeUrl 白名单、搜索展平）
    bookmarks.js          书签导入（Netscape HTML 解析、去重合并）
    contentEngine.js      诗词源（12 分类按需 chunk）
    meta.js               网页标题代理客户端
    constants.js          端点 / 引擎 / 主题常量
worker/src/worker.js       同步 API 全部实现（部署源）
```

## 三、关键设计决策（为什么是现在这样）

### 1. 看板：列式布局（而非自由画布）

- 卡片按列排布、CSS 流式渲染：**零绝对定位、零高度测量、零结算算法**；云端布局为 5 个槽位的 id 有序列表
- 若采用自由画布（显式 `{x,y,w,h}` 坐标 + 绝对定位），必须配套「逐卡实测高度 → 重力整理（O(n²)）→ 全卡带过渡动画重排」的闭环才能防重叠，任何交互都会触发一遍，交互流畅度无法保证；且坐标在换设备/换列数时需换算，重叠缺陷频发
- 结论：流畅度优先，选择列式；代价是放弃自由摆放与逐卡拉伸（iframe 高度改为 ⋯ 菜单档位）

### 2. 拖拽：自研指针几何，不依赖 dnd-kit

- dnd-kit 的落点检测依赖 IntersectionObserver 测量可放置矩形；且带来额外包体
- 自研方案：悬停列 = x 落入的等宽区间；插入位 = 指针越过各卡中点。纯几何、零依赖、全平台一致
- 拖拽更新**不走 rAF**、宽度监听做 **ResizeObserver + window resize + matchMedia 断点**三层兜底——个别内嵌 webview 会停发 rAF/IO/RO 回调（真实 Chrome 无此问题，防御性处理）

### 3. 同步：整份覆盖 + 强制仲裁，而非合并

- 字段级/CRDT 合并对该产品体量是过度设计；整份覆盖 + R2 条件写 CAS + savedAt 乐观锁已把「静默丢数据」概率压到零
- 仲裁规则确保**用户永远明确知道哪份胜出**（详见 `sync-and-data.md` 第三节）

### 4. 会话与密码：无状态令牌 + 派生密钥

- 明文密码永不出本机（PBKDF2 600k + 挑战应答），服务端无密码可泄
- 无状态令牌零存储、天然水平扩展；代价是不可吊销（无改密码功能）

### 5. 代理而非直连：favicon / title

- 浏览器跨域读不了第三方页面标题/图标（CORS）；国内直连 Google/DDG 图标服务不可靠
- Worker 统一代理 + R2 缓存 30 天 + 限流，双端行为一致

## 四、性能策略清单

| 策略 | 位置 | 收益 |
|---|---|---|
| 卡片组件 memo 化 | widgets.jsx | 开菜单/弹窗不再全树重渲染 |
| `content-visibility: auto` | .board-card CSS | 视口外卡片跳过渲染 |
| iframe 懒挂载（滚入 ±300px 才加载，会话内不重载） | IframeWidget | 新标签页首屏只加载可见部件 |
| 拖拽直接改样式 + 相等性守卫 | BookmarkBoard | 拖拽零渲染风暴 |
| GET 带 ETag → 304 | useCollection + worker | 开新标签页未变化时零流量 |
| 静态资产 immutable 一年缓存 | worker | 冷启动免回源 |
| HTML no-store | worker | 发版即时生效 |
| 江西拙楷字体子集化（subset-zhuokai.mjs） | assets/fonts | 字体只含实际用字 |
| 诗词分类按需 chunk | contentEngine.js | 只加载启用的分类 |

## 五、Worker 与存储

- Worker 名 `proton-collect-sync`，自定义域 sync.pathmemos.com；兼容日期 2026-09-01
- R2 键布局：`pt/accounts/<uid>.json`（账号）、`pt/data/<uid>.json`（最新数据）、`pt/data/<uid>/snap-*.json`（快照 ×5）、`pt/favicons/<domain>.bin`、`pt/titles/<hash>.json`
- 绑定：`BUCKET`(R2)、`ASSETS`(静态资产，**必须显式 binding 且 run_worker_first=true**——缺省不注入 env.ASSETS、资产直出绕过 Worker，详见 AGENTS 部署节)、`SYNC_TOKEN`(云端 secret，会话/挑战签名)
- 静态资产：Worker 托管 dist-web；`/assets/*` 一年 immutable，HTML no-store
- 本地全量自测：`node scripts/test-worker.mjs`（内存 R2 模拟，33 项断言）；线上冒烟：`node scripts/test-auth.mjs`

## 六、部署与分发（详见 AGENTS.md）

- 网页版 + Worker：`./deploy-web.sh`（构建 → scp 构建机 192.168.1.44 → 服务器 wrangler deploy）
- 扩展本地：`pnpm build`（带 key 固定 ID）；**商店包：`STORE_BUILD=1 pnpm zip`**（无 key，商店重签名）
- 扩展分发仅通过 Chrome/Edge 商店（无自更新渠道）
- 发版次序与检查清单见 AGENTS「发版与商店提交」

## 七、测试策略

- **Worker**：mock R2（含条件写语义）跑全部端点断言，改 worker 必跑
- **线上协议**：test-auth.mjs 随机测试账号对生产冒烟
- **前端**：双端手工回归（清单在 AGENTS「改动后验证」）；E2E 自动化暂缺，回归以上述为准
- 开发注意：网页版 dev server **直连生产云**，用一次性测试账号
