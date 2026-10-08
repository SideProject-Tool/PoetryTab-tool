# 同步与数据完整规格（业务逻辑）

> 面向接手者：账号、同步、冲突、快照、缓存、API、数据结构的全部行为规则。
> 用户可感知的行为描述见 `product-guide.md`；服务端实现在 `worker/src/worker.js`。

---

## 一、账号与认证

### 注册

1. 客户端生成随机 16 字节盐 → PBKDF2-SHA256(密码, 盐, 600,000 迭代) 派生 **authKey**
2. 提交 `{uid, salt, authKey, iter}`；明文密码永不出本机
3. 服务端以 **R2 条件写（仅当不存在时创建）** 落账号记录——并发同名注册只有一个成功，另一个收 409
4. 注册成功即发会话令牌，并自动落一份默认数据（含「我的收藏」空分组）

### 登录（挑战应答）

1. `POST /api/challenge {uid}` → 返回一次性挑战（带签名、10 分钟有效）+ 该账号的盐与迭代数
2. 客户端重派生 authKey，以 `HMAC-SHA256(authKey, challenge)` 应答
3. `POST /api/login` 校验通过 → 发会话令牌 + 当前云端数据

**防枚举**：不存在的 ID 也返回 HMAC 确定性伪盐（响应形状与存在时完全一致），登录失败一律 401 统一文案；外部无法探测某 ID 是否注册过。

### 会话令牌

- 形态：`uid|exp|HMAC(SYNC_TOKEN, uid|exp)`，**无状态**，30 天有效
- 之后所有数据读写凭 `Authorization: Bearer <令牌>`，uid 从令牌解析（无法越权读写他人数据）
- 限制：无法吊销（无改密码功能；若未来增加，需为 SYNC_TOKEN 引入版本号使旧令牌失效）

### 账号自救

- 无邮箱、无找回。**密码丢失 = 账号失联**（云端数据仍在但无法登录）
- 唯一自救：平时通过「导出备份」保存 JSON；「恢复备份」可在任意账号整份导入

## 二、保存管线（客户端）

```
用户任意修改 → mutate（改本地状态 + 写缓存 + 置 dirty）
            → 700ms 防抖
            → 单飞保存队列（并发修改只落最新一份）
            → PUT /api/data（携带 X-Base-SavedAt 乐观锁，≤8MB）
```

- 保存失败（网络）：状态条显示「未同步 · 自动重试中」，每 30 秒重发直到成功
- 关页/切走标签页瞬间：`pagehide/visibilitychange` 兜底立即发送（keepalive，≤64KB 时 guaranteed）
- 全部请求 15 秒超时，不会挂死在「保存中」

## 三、版本、冲突与仲裁（核心业务规则）

**版本号 = savedAt**（服务端签发的 ISO 时间戳，单调递增），同时作为 HTTP ETag。

PUT 必须携带客户端所知的版本（`X-Base-SavedAt`）；服务端用 **R2 条件写原子校验**——同版本并发只有一个成功。

### 冲突场景与处理规则

| 场景 | 行为 |
|---|---|
| 收到 409，本地**无**未同步修改 | 自动拉取云端最新版并采纳，提示「已载入云端最新版本」 |
| 收到 409，本地**有**未同步修改 | 进入**强制仲裁**：暂停自动保存，右上角徽标 + 设置面板提示，必须二选一 |
| 仲裁选「上传到云端」 | 以本地为准：借用云端当前版本号通过乐观锁，整份覆盖云端 |
| 仲裁选「从云端恢复」 | 以云端为准：丢弃本地修改，拉取采纳 |
| 关页时有未同步修改 | dirty 标记持久化在缓存；重开时若云端已被推进 → 直接恢复仲裁现场（本地修改不丢） |
| 同浏览器多标签页 | 保存成功经 BroadcastChannel 广播；**未编辑**的标签页即时采纳，**编辑中**的标签页保持本地、由下一次保存的 409 进入仲裁 |

设计原则：**仲裁完成前不存在任何静默覆盖云端的路径**。

## 四、快照（历史版本）

- 每次成功 PUT 自动留一份快照，服务端保留**最近 5 份**，轮转删除
- `GET /api/snaps` 列表；`POST /api/snap/restore {key}` 恢复
- 恢复的安全约束：key 必须属于本人快照集合（服务端先列后验），快照损坏返回明确错误
- **恢复动作本身也写一份新快照**——恢复错了可以再恢复回来

## 五、本地缓存与离线

- `localStorage.pt.cache` 结构：`{uid, savedAt, dirty, data}`
  - **uid 隔离**：切换账号后旧缓存直接弃用（不闪现他人收藏）
  - **savedAt + dirty 持久化**：重启后能恢复乐观锁版本与「有未同步修改」的仲裁现场
- 启动拉取带 `If-None-Match`（上次 savedAt）：云端未变 → **304 零流量**，直接用缓存渲染
- 断网：缓存先行渲染，保存进入自动重试

## 六、API 一览（全部需 CORS 白名单内自定义头）

| 端点 | 鉴权 | 限流（每分/IP） | 说明 |
|---|---|---|---|
| `POST /api/register` | 无 | 10 | 条件写防抢注；返回会话 |
| `POST /api/challenge` | 无 | 30（与 login 合计） | 一次性挑战 + 盐；伪盐防枚举 |
| `POST /api/login` | 无 | 同上 | 挑战应答；返回会话 + 全量数据 |
| `GET /api/data` | 会话 | — | 支持 `If-None-Match` → 304 |
| `PUT /api/data` | 会话 | — | ≤8MB；`X-Base-SavedAt` 乐观锁（R2 CAS 原子）；成功轮转快照 |
| `GET /api/snaps` | 会话 | — | 最近 5 份快照列表 |
| `POST /api/snap/restore` | 会话 | — | 恢复指定快照（key 归属校验） |
| `GET /api/favicon?domain=` | 无 | 600 | 图标代理：Google s2 → DDG 兜底，R2 缓存 30 天 |
| `GET /api/title?url=` | 无 | 120 | 网页标题代理：读前 256KB、10s 超时、R2 缓存 30 天 |
| `GET /api/health` | 无 | — | 存活探测 |

## 七、数据结构（云端 `pt/data/<uid>.json` 的 `data` 字段）

```jsonc
{
  "v": 1,                          // schema 版本号（结构迁移用）
  "folders": [                     // 分组树（顶层卡片）
    {
      "id": "f_xxx", "title": "AI 工具",
      "children": [                // 书签；子分组则再嵌 children（卡片内变标签页，最多常用两层）
        { "id": "b_xxx", "title": "ChatGPT", "url": "https://…", "favicon": "", "dateAdded": 0 }
      ]
    }
  ],
  "quickSites": [                  // 常用网站卡
    { "id": "qs_xxx", "title": "GitHub", "url": "https://github.com", "favicon": "" }
  ],
  "iframeWidgets": [               // iframe 小部件卡（h = 卡片高度像素值，⋯ 菜单可调，200-2000）
    { "id": "iw_xxx", "title": "监控", "url": "https://…", "h": 420 }
  ],
  "settings": {                    // 随账号同步的偏好
    "theme": "sync",               // sync | light | dark
    "engine": "baidu",             // baidu | google | bing | duckduckgo
    "cats": ["i"],                 // 启用的诗词分类（至少一个）
    "cols": "auto",                // 看板列数：auto 或 2-5（<640px 恒单列）
    "poemSpace": 0,                // 诗词区最小高度 px（0=自然高度，诗词区内居中）
    "pageBg": "",                  // 页面底色 #RGB/#RRGGBB（空=跟随主题）
    "showSearch": false,           // 搜索栏常驻
    "hiddenCards": []              // 隐藏的卡片 id（"qs:quicksites" / "f:xxx" / "w:xxx"）
  },
  "layout": {                      // 布局（v2 列式）
    "v": 2,
    "cols": [["qs:quicksites"], ["f_xxx"], [], [], []]   // 固定 5 槽位，每槽为卡片 id 有序数组
  }
}
```

### 布局语义

- **5 槽位为存储上限**：设备按自身列数 N 取前 N 列，第 N 槽之后的溢出内容并入末列显示
- 列内顺序即卡片顺序；手机单列按「槽位序 × 列内序」排列
- **v1 兼容**：旧版显式坐标数组（`[{i,x,y,w,h}]`）加载时自动按阅读顺序迁移为列式，首次布局变更时回写 v2；旧客户端读到 v2 会优雅降级为自动排列

### 修改数据结构的三处同步（改字段必读）

`services/collection.js` + `hooks/useCollection.js`（前端契约，注意 `ensureShape` 归一）→ `worker/src/worker.js`（服务端）→ `README.md` 数据契约段落 + 本文档。并考虑旧数据兼容（`ensureShape` 会补默认值）。

## 八、已知边界（设计取舍）

- 同步为**整份覆盖**模型（无字段级合并）——多设备冲突只能整份二选一，由强制仲裁兜底
- 会话令牌不可吊销、无改密码
- 单份数据 ≤8MB（超千条书签场景足够）
- favicon/title 代理对任意公网站点抓取（仅读 title 标签 / 图标，不执行内容）；私有网络地址经 Cloudflare 边缘不可达
- 书签磁贴的图标经代理缓存 30 天，源站换图标最长一个月后刷新
