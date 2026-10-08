/**
 * 看板卡片部件：瓷贴（书签/文件夹）+ 三种卡片（分组 / 常用网站 / iframe 小部件）。
 * 纯展示 + 回调，布局与拖拽由 BookmarkBoard 编排。
 */
import { useState, useEffect, useRef, memo } from "react";
import {
  IoOpenOutline as OpenIcon,
  IoTrashOutline as TrashIcon,
  IoReloadOutline as ReloadIcon,
  IoFolderOutline as FolderIcon,
  IoEllipsisHorizontalOutline as MoreIcon,
} from "react-icons/io5";
import { openUrl } from "../../../../platform";
import { safeUrl } from "../../services/collection";
import { CLOUD_SYNC } from "../../services/constants";

const PALETTE = [
  "#c96f5e", "#7b9e56", "#5e89c9", "#b0785e", "#8a6fc9", "#c95e8a", "#5eb0a5", "#c9a35e",
];

function paletteColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/** 磁贴图标源：显式 favicon 优先；否则走自家 Worker 代理（R2 缓存，国内可达），失败由调用方降级字母 */
function faviconSrc(item) {
  if (item.favicon) return item.favicon;
  const url = safeUrl(item.url);
  if (!url) return "";
  try {
    return `${CLOUD_SYNC.url}/api/favicon?domain=${new URL(url).hostname}`;
  } catch {
    return "";
  }
}

/* ---------- 瓷贴 ---------- */

function TileIcon({ item }) {
  const [failed, setFailed] = useState(false);
  if (item.children) {
    return (
      <span className="bt-icon bt-icon-folder">
        <FolderIcon />
      </span>
    );
  }
  const label = item.title || item.url || "?";
  const letter = label.trim().charAt(0).toUpperCase() || "?";
  const tint = paletteColor(label);
  const iconSrc = !failed ? faviconSrc(item) : "";
  if (iconSrc) {
    return (
      <span className="bt-icon">
        <img src={iconSrc} alt="" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="bt-icon" style={{ color: tint, background: tint + "1c" }}>
      {letter}
    </span>
  );
}

const BookmarkTile = memo(function BookmarkTile({ item }) {
  const url = safeUrl(item.url);
  if (!url) {
    // 云端数据中的失效/不安全 URL：降级为不可点占位，不让异常协议进入 href
    return (
      <span className="bt" style={{ opacity: 0.55, cursor: "default" }} title={item.title || ""}>
        <TileIcon item={item} />
        <span className="bt-label">{item.title || item.url || "无效链接"}</span>
      </span>
    );
  }
  return (
    <a
      href={url}
      className="bt"
      title={item.title}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.button === 1) return;
        e.preventDefault();
        openUrl(url);
      }}
    >
      <TileIcon item={item} />
      <span className="bt-label">{item.title || item.url}</span>
    </a>
  );
});

function FolderTile({ folder, onOpen }) {
  return (
    <button type="button" className="bt" title={folder.title} onClick={() => onOpen(folder.id)}>
      <TileIcon item={folder} />
      <span className="bt-label">{folder.title}</span>
    </button>
  );
}

const TileGrid = memo(function TileGrid({ items, onOpenFolder }) {
  return (
    <div className="bt-grid">
      {items.map((item) =>
        item.children ? (
          <FolderTile key={item.id} folder={item} onOpen={onOpenFolder} />
        ) : (
          <BookmarkTile key={item.id} item={item} />
        )
      )}
    </div>
  );
});

/* ---------- 三种卡片 ---------- */

/** 分组卡片（子分组 → 标签页；有子分组时隐藏「全部」，直属内容不再展示） */
const GroupWidgetBase = ({ folder, onOpenFolder, onManage, dragHandle }) => {
  const subs = folder.children.filter((c) => c.children);
  const direct = folder.children.filter((c) => !c.children);
  const [active, setActive] = useState("");
  /* 有子分组时仅展示子分组标签（active 落在子分组上）；无子分组时展示直属内容 */
  const activeSub = subs.some((s) => s.id === active) ? active : (subs[0]?.id || "");
  const items = activeSub
    ? ((folder.children.find((c) => c.id === activeSub) || {}).children || [])
    : direct;

  return (
    <div className="board-widget">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        <h3 className="board-widget-title">{folder.title || "未命名"}</h3>
        <div className="board-widget-actions">
          <span className="board-widget-count">{folder.children.length} 项</span>
          <button
            type="button"
            className="board-widget-action"
            title="管理分组"
            onPointerDown={(e) => e.stopPropagation()} // ⋯ 与拖拽状态机隔离：点击必然触发，不受任何拖拽残留影响
            onClick={() => onManage(folder.id)}
          >
            <MoreIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      {subs.length > 0 && (
        <div className="board-widget-tabs">
          {subs.map((sub) => (
            <button
              key={sub.id}
              type="button"
              className={`board-widget-tab ${activeSub === sub.id ? "active" : ""}`}
              onClick={() => setActive(sub.id)}
            >
              {sub.title || "未命名"}
            </button>
          ))}
        </div>
      )}
      <div className="board-widget-body">
        <TileGrid items={items} onOpenFolder={onOpenFolder} />
        {items.length === 0 && <div className="bt-empty">这个分组还没有书签</div>}
      </div>
    </div>
  );
}

/** iframe 小部件卡片：操作收进 ⋯ 菜单；iframe 视口内才挂载（挂载后本页会话内不重载） */
const IframeWidgetBase = ({ widget, onRemove, onUpdate, dragHandle }) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // 首次滚入视口后保持 true，避免来回滚动反复重载
  const [hDraft, setHDraft] = useState(null); // 自定义高度草稿（字符串，Enter/失焦提交）
  const bodyRef = useRef(null);
  const menuRef = useRef(null);

  /* 提交自定义高度：钳位 200-2000，非法输入回退当前值 */
  const commitH = () => {
    setHDraft((draft) => {
      if (draft === null) return null;
      const n = Math.round(Number(draft));
      if (Number.isFinite(n) && n >= 200 && n <= 2000) onUpdate(widget.id, { h: n });
      return null;
    });
  };

  /* 懒挂载：几何检测 + 滚动/缩放监听（不用 IntersectionObserver——
     个别内嵌 webview 不派发其回调，会把部件卡死在占位态） */
  useEffect(() => {
    if (mounted) return;
    const el = bodyRef.current;
    if (!el) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight + 300 && r.bottom > -300) setMounted(true);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [mounted]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const openInNewTab = () => {
    const u = safeUrl(widget.url);
    if (u) openUrl(u);
  };

  return (
    <div className="board-widget board-widget-iframe">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        <h3 className="board-widget-title">{widget.title}</h3>
        <div className="board-widget-actions">
          <div className="widget-menu-anchor" ref={menuRef}>
            <button
              type="button"
              className="board-widget-action"
              title="小部件操作"
              onPointerDown={(e) => e.stopPropagation()} // ⋯ 与拖拽状态机隔离
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreIcon className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="widget-menu">
                {onUpdate && (
                  <>
                    <div className="widget-menu-label">高度（像素，200-2000）</div>
                    <div className="widget-menu-heights">
                      {[240, 420, 600, 800].map((px) => (
                        <button
                          key={px}
                          type="button"
                          className={`widget-h-chip${(widget.h || 420) === px ? " on" : ""}`}
                          onClick={() => {
                            onUpdate(widget.id, { h: px });
                            setHDraft(null);
                          }}
                        >
                          {px}
                        </button>
                      ))}
                    </div>
                    <input
                      className="widget-h-input"
                      type="number"
                      min={200}
                      max={2000}
                      step={10}
                      placeholder="自定义…"
                      value={hDraft ?? ""}
                      onChange={(e) => setHDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitH();
                        if (e.key === "Escape") setHDraft(null);
                      }}
                      onBlur={commitH}
                    />
                    <div className="widget-menu-divider" />
                  </>
                )}
                <button type="button" id="iw-reload" onClick={() => { setReloadKey((k) => k + 1); setMenuOpen(false); }}>
                  <ReloadIcon className="w-4 h-4" /> 重新加载
                </button>
                <button type="button" id="iw-open" onClick={() => { openInNewTab(); setMenuOpen(false); }}>
                  <OpenIcon className="w-4 h-4" /> 新窗口打开
                </button>
                <button type="button" className="danger" id="iw-remove" onClick={() => { setMenuOpen(false); onRemove(widget.id); }}>
                  <TrashIcon className="w-4 h-4" /> 删除小部件
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="board-iframe-body" ref={bodyRef}>
        {mounted ? (
          <iframe
            key={reloadKey}
            src={safeUrl(widget.url) || "about:blank"}
            className="board-iframe"
            title={widget.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="board-iframe-placeholder">滚动到此处后加载内容</div>
        )}
      </div>
      <div className="board-iframe-hint">若页面空白，说明该网站禁止内嵌，点右上角 ⋯ 新窗口打开</div>
    </div>
  );
}

/* memo 比较器忽略 dragHandle：dnd 的 attributes/listeners 每渲染都是新对象，
   但监听器按卡片 id 闭包稳定，忽略其引用变化不影响功能，可避免拖拽期全树重渲染 */
export const GroupWidget = memo(GroupWidgetBase, (a, b) => a.folder === b.folder && a.onOpenFolder === b.onOpenFolder && a.onManage === b.onManage);
export const IframeWidget = memo(IframeWidgetBase, (a, b) => a.widget === b.widget && a.onRemove === b.onRemove && a.onUpdate === b.onUpdate);
export { TileGrid };
