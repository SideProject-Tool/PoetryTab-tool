import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  IoAddOutline as AddIcon,
  IoOpenOutline as OpenIcon,
  IoTrashOutline as TrashIcon,
  IoReloadOutline as ReloadIcon,
  IoCloseOutline as CloseIcon,
  IoFolderOutline as FolderIcon,
  IoCreateOutline as EditIcon,
  IoEllipsisHorizontalOutline as MoreIcon,
  IoCheckmarkOutline as CheckIcon,
  IoGridOutline as GridIcon,
  IoBookOutline as PoemIcon,
  IoCloudOutline as CloudSyncIcon,
} from "react-icons/io5";
import { openUrl } from "../../../platform";
import { findNode } from "../services/collection";
import { colsForWidth, REF_COLS } from "../grid";

/**
 * 云端收藏看板（插件版与网页版共用这一个组件）。
 * - 流式网格：卡片高度随内容自适应（不在卡片内滚动），整页随内容增长、浏览器滚动条查看全部
 * - 卡片宽度 = 网格列跨度；可拖动排序、右下角把手调整宽度；列数随宽度自适应 10/6/4/2
 * - 布局（顺序 + 跨度）以参考列数 10 存到云端，跨设备一致
 * - 顶层分组 → 卡片；新建分组/添加小部件收进右下角悬浮按钮（不占网格）
 * - 每张卡片右上角 ⋯ 管理面板；所有修改防抖自动保存回云端
 */

const GAP = 14; /* 卡片四周间隙：上下与左右一致 */
const LEGACY_ROW_PX = 90; /* 旧版行单位换算（历史数据迁移用） */

const PALETTE = [
  "#c96f5e", "#7b9e56", "#5e89c9", "#b0785e", "#8a6fc9", "#c95e8a", "#5eb0a5", "#c9a35e",
];

function paletteColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/* 新卡片默认列跨度（参考列数空间）：普通 2，iframe 小部件 3 */
function defaultWidth(id) {
  return id.startsWith("w:") ? 3 : 2;
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
  if (item.favicon && !failed) {
    return (
      <span className="bt-icon">
        <img src={item.favicon} alt="" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="bt-icon" style={{ color: tint, background: tint + "1c" }}>
      {letter}
    </span>
  );
}

function BookmarkTile({ item }) {
  return (
    <a
      href={item.url}
      className="bt"
      title={item.title}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.button === 1) return;
        e.preventDefault();
        openUrl(item.url);
      }}
    >
      <TileIcon item={item} />
      <span className="bt-label">{item.title || item.url}</span>
    </a>
  );
}

function FolderTile({ folder, onOpen }) {
  return (
    <button type="button" className="bt" title={folder.title} onClick={() => onOpen(folder.id)}>
      <TileIcon item={folder} />
      <span className="bt-label">{folder.title}</span>
    </button>
  );
}

function TileGrid({ items, onOpenFolder }) {
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
}

/* ---------- 分组卡片（子文件夹 → 标签页） ---------- */

function GroupWidget({ folder, onOpenFolder, onManage, dragHandle }) {
  const subs = folder.children.filter((c) => c.children);
  const direct = folder.children.filter((c) => !c.children);
  const [active, setActive] = useState("");
  const items = active ? ((folder.children.find((c) => c.id === active) || {}).children || []) : direct;

  return (
    <div className="board-widget">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        <h3 className="board-widget-title">{folder.title || "未命名"}</h3>
        <div className="board-widget-actions">
          <span className="board-widget-count">{folder.children.length} 项</span>
          <button type="button" className="board-widget-action" title="管理分组" onClick={() => onManage(folder.id)}>
            <MoreIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      {subs.length > 0 && (
        <div className="board-widget-tabs">
          <button
            type="button"
            className={`board-widget-tab ${active === "" ? "active" : ""}`}
            onClick={() => setActive("")}
          >
            全部
          </button>
          {subs.map((sub) => (
            <button
              key={sub.id}
              type="button"
              className={`board-widget-tab ${active === sub.id ? "active" : ""}`}
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

/* ---------- 常用网站卡片 ---------- */

function QuickSitesWidget({ sites, onManage, dragHandle }) {
  return (
    <div className="board-widget">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        <h3 className="board-widget-title">常用网站</h3>
        <div className="board-widget-actions">
          <button type="button" className="board-widget-action" title="管理" onClick={onManage}>
            <MoreIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="board-widget-body">
        <div className="bt-grid">
          {sites.map((s) => (
            <BookmarkTile key={s.id} item={s} />
          ))}
        </div>
        {sites.length === 0 && <div className="bt-empty">常用网站为空，点 ⋯ 添加</div>}
      </div>
    </div>
  );
}

/* ---------- iframe 小部件 ---------- */

function IframeWidget({ widget, onRemove, dragHandle }) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="board-widget board-widget-iframe">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        <h3 className="board-widget-title">{widget.title}</h3>
        <div className="board-widget-actions">
          <button type="button" className="board-widget-action" title="重新加载" onClick={() => setReloadKey((k) => k + 1)}>
            <ReloadIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="board-widget-action"
            title="在新标签页打开"
            onClick={() => openUrl(widget.url)}
          >
            <OpenIcon className="w-4 h-4" />
          </button>
          <button type="button" className="board-widget-action board-widget-action-danger" title="删除小部件" onClick={() => onRemove(widget.id)}>
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="board-iframe-body">
        <iframe key={reloadKey} src={widget.url} className="board-iframe" title={widget.title} referrerPolicy="no-referrer" />
      </div>
      <div className="board-iframe-hint">若页面空白，说明该网站禁止内嵌，点右上角 ↗ 新窗口打开</div>
    </div>
  );
}

/* ---------- 管理面板（⋯） ---------- */

function ManageSheet({ col, target, onClose }) {
  // target: {type:"folder", id} | {type:"quicksites"}
  const isQs = target.type === "quicksites";
  const node = !isQs && col.data ? findNode(col.data, target.id)?.node : null;

  const [nTitle, setNTitle] = useState("");
  const [nUrl, setNUrl] = useState("");
  const [editId, setEditId] = useState(null);
  const [eTitle, setETitle] = useState("");
  const [eUrl, setEUrl] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node ? node.title : "");
  const [confirmDel, setConfirmDel] = useState(false);

  const items = isQs ? col.data?.quickSites || [] : node?.children || [];
  const title = isQs ? "常用网站" : node ? node.title || "未命名" : "";

  const submitAdd = () => {
    if (!nUrl.trim()) return;
    const url = /^https?:\/\//i.test(nUrl.trim()) ? nUrl.trim() : "https://" + nUrl.trim();
    const t = nTitle.trim() || url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    if (isQs) col.addQuickSite({ title: t, url });
    else col.addItem(target.id, { title: t, url });
    setNTitle("");
    setNUrl("");
  };
  const submitRename = () => {
    if (renameDraft.trim()) col.renameNode(target.id, renameDraft.trim());
    setRenaming(false);
  };

  return (
    <div className="bf-overlay" onClick={onClose}>
      <div className="bf-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bf-header">
          {renaming ? (
            <input
              className="bm-rename"
              value={renameDraft}
              autoFocus
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <h3 className="bf-title">{title}</h3>
          )}
          <div className="bf-header-right">
            {renaming ? (
              <button type="button" className="bf-close" title="确认重命名" onClick={submitRename}>
                <CheckIcon />
              </button>
            ) : (
              !isQs && (
                <button type="button" className="board-widget-action" title="重命名分组" onClick={() => setRenaming(true)}>
                  <EditIcon className="w-4 h-4" />
                </button>
              )
            )}
            <button type="button" className="bf-close" onClick={onClose} title="关闭">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="bm-add">
          <input className="bm-input" type="text" placeholder="标题（可选）" value={nTitle} onChange={(e) => setNTitle(e.target.value)} />
          <input
            className="bm-input"
            type="text"
            placeholder="网址 example.com（填了网址 + 收录 即保存）"
            value={nUrl}
            onChange={(e) => setNUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          />
          <button type="button" className="bm-add-btn" disabled={!nUrl.trim()} onClick={submitAdd}>
            ＋ 收录
          </button>
        </div>

        <div className="bm-list">
          {items.map((item) =>
            editId === item.id ? (
              <div key={item.id} className="bm-row bm-row-edit">
                <input className="bm-input" value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="标题" />
                <input className="bm-input" value={eUrl} onChange={(e) => setEUrl(e.target.value)} placeholder="网址" />
                <button
                  type="button"
                  className="bm-op"
                  title="保存"
                  onClick={() => {
                    const url = /^https?:\/\//i.test(eUrl.trim()) ? eUrl.trim() : "https://" + eUrl.trim();
                    if (isQs) col.updateQuickSite(item.id, { title: eTitle.trim() || url, url });
                    else col.updateNode(item.id, { title: eTitle.trim() || url, url });
                    setEditId(null);
                  }}
                >
                  <CheckIcon />
                </button>
                <button type="button" className="bm-op" title="取消" onClick={() => setEditId(null)}>
                  <CloseIcon />
                </button>
              </div>
            ) : (
              <div key={item.id} className="bm-row">
                {item.children ? (
                  <span className="bm-row-folder">🗂 {item.title || "未命名"}</span>
                ) : (
                  <button type="button" className="bm-row-open" title="打开" onClick={() => openUrl(item.url)}>
                    {item.title || item.url}
                  </button>
                )}
                <button
                  type="button"
                  className="bm-op"
                  title="编辑"
                  onClick={() => {
                    setEditId(item.id);
                    setETitle(item.title || "");
                    setEUrl(item.url || "");
                  }}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="bm-op bm-op-danger"
                  title={item.children ? "删除文件夹（含内容）" : "删除"}
                  onClick={() => {
                    if (isQs) col.removeQuickSite(item.id);
                    else col.removeNode(item.id);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            )
          )}
          {items.length === 0 && <div className="bt-empty">还没有内容，用上面的表单收录</div>}
        </div>

        {!isQs && (
          <div className="bm-folder-ops">
            {confirmDel ? (
              <button
                type="button"
                id="bm-del-folder-confirm"
                className="bm-del-folder confirming"
                onClick={() => {
                  col.removeNode(target.id);
                  onClose();
                }}
              >
                再点一次，确认删除整个分组
              </button>
            ) : (
              <button type="button" className="bm-del-folder" onClick={() => setConfirmDel(true)}>
                删除这个分组
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 文件夹浏览浮层（子文件夹进入） ---------- */

function FolderBrowser({ folderId, data, onClose }) {
  const [pathIds, setPathIds] = useState([folderId]);

  const nodeAt = (ids) => {
    let children = data.folders || [];
    let node = null;
    for (const id of ids) {
      node = children.find((c) => c.id === id) || null;
      if (!node) return null;
      children = node.children || [];
    }
    return node;
  };

  const current = nodeAt(pathIds);
  if (!current) return null;
  const trail = pathIds.map((id, idx) => ({ id, title: nodeAt(pathIds.slice(0, idx + 1))?.title || "未命名" }));

  return (
    <div className="bf-overlay" onClick={onClose}>
      <div className="bf-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bf-header">
          <div className="bf-crumbs">
            {trail.map((c, i) => (
              <span key={c.id} className="bf-crumb-wrap">
                {i > 0 && <span className="bf-crumb-sep">›</span>}
                <button
                  type="button"
                  className={`bf-crumb ${i === trail.length - 1 ? "active" : ""}`}
                  onClick={() => setPathIds(pathIds.slice(0, i + 1))}
                >
                  {c.title}
                </button>
              </span>
            ))}
          </div>
          <div className="bf-header-right">
            <span className="bf-count">{(current.children || []).length} 项</span>
            <button type="button" className="bf-close" onClick={onClose} title="关闭">
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="bf-body">
          {(current.children || []).length > 0 ? (
            <TileGrid
              items={current.children || []}
              onOpenFolder={(sub) => setPathIds(pathIds.concat(sub.id))}
            />
          ) : (
            <div className="bt-empty">空文件夹</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 可排序网格单元 + 拖拽浮层 ---------- */

function DraggableCell({ def, style, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: def.id });
  return (
    <div
      ref={setNodeRef}
      data-id={def.id}
      className={`board-cell ${isDragging ? "dragging-src" : ""}`}
      style={style}
    >
      {children({ ref: setActivatorNodeRef, props: { ...attributes, ...listeners } })}
      <span className="board-resize" title="拖动调整大小：横向改宽度，纵向改最小高度" />
    </div>
  );
}

/*
 * 坐标模型：每张卡存显式位置 { x: 参考列, y: 行, w: 跨度, h: 最小行 }，指哪放哪、允许留白。
 * packColumns 仅用于两处：老数据（无 x/y）迁移补位、新建卡片的初始落位。
 */

function packColumns(items, cols, obstacles = []) {
  const colBottom = new Array(cols).fill(0);
  for (const o of obstacles) {
    const ospan = Math.max(1, Math.min(cols, o.w));
    const orows = o.h > 0 ? o.h : 2;
    for (let x = o.x; x < Math.min(o.x + ospan, cols); x++) {
      colBottom[x] = Math.max(colBottom[x], o.y + orows);
    }
  }
  const placed = [];
  for (const it of items) {
    const span = Math.max(1, Math.min(cols, it.w));
    const rows = it.h > 0 ? it.h : 2;
    let bestX = 0;
    let bestY = Infinity;
    for (let x = 0; x <= cols - span; x++) {
      let b = 0;
      for (let k = x; k < x + span; k++) b = Math.max(b, colBottom[k]);
      if (b < bestY - 0.5) {
        bestY = b;
        bestX = x;
      }
    }
    for (let k = bestX; k < bestX + span; k++) colBottom[k] = bestY + rows;
    placed.push({ i: it.i, x: bestX, y: bestY, w: span, h: it.h });
  }
  return placed;
}

function viewSpan(it, cols) {
  return Math.max(1, Math.min(cols, Math.round((it.w * cols) / REF_COLS)));
}

function viewX(it, cols) {
  return Math.max(0, Math.min(cols - viewSpan(it, cols), Math.round((it.x * cols) / REF_COLS)));
}

function effHeightPx(it, heights) {
  return Math.max(heights[it.i] || 0, it.h || 0);
}

/** 重力整理：纵向重叠或间距小于 GAP 的卡片，自动下推到恰好 GAP（14px），与左右间距一致 */
function settleLayout(items, heights, cols, colW, pinnedId = null) {
  const infos = items.map((it) => {
    const span = viewSpan(it, cols);
    const vx = viewX(it, cols);
    const hPx = Math.max(effHeightPx(it, heights), it.h || 0);
    return { ...it, vx, span, hPx };
  });
  infos.sort((a, b) => a.y - b.y || a.vx - b.vx);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < infos.length; i++) {
      const a = infos[i];
      if (pinnedId && a.i === pinnedId) continue; // 被拉伸/拖动的卡片固定，由其他卡片让位
      let y = a.y;
      for (let j = 0; j < infos.length; j++) {
        if (j === i) continue;
        const o = infos[j];
        const xOverlap = a.vx < o.vx + o.span && o.vx < a.vx + a.span;
        if (!xOverlap) continue;
        // o 在 a 上方且底边侵入 a 的顶部间隙 → 下推 a
        if (o.y <= y && y < o.y + o.hPx + GAP) y = o.y + o.hPx + GAP;
      }
      if (y !== a.y) {
        a.y = y;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return infos.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
}

/** 拖放落点的防重叠：被占则逐行下移到首个空位 */
function resolveDropY(candX, candY, span, draggedH, draggedId, items, heights, cols, colW) {
  let y = Math.max(0, candY);
  for (let guard = 0; guard < 60; guard++) {
    const hit = items.find((o) => {
      if (o.i === draggedId) return false;
      const ovx = viewX(o, cols);
      const ospan = viewSpan(o, cols);
      const oh = effHeightPx(o, heights);
      const oy = o.y;
      const xOverlap = candX < ovx + ospan && ovx < candX + span;
      const yOverlap = y < oy + oh && oy < y + draggedH;
      return xOverlap && yOverlap;
    });
    if (!hit) break;
    y = hit.y + effHeightPx(hit, heights) + GAP;
  }
  return y;
}

/* ---------- 看板入口 ---------- */

export default function BookmarkBoard({ col }) {
  const { data, status, hasUid } = col;
  const boardRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [manage, setManage] = useState(null); // {type:"folder",id} | {type:"quicksites"}
  const [browsing, setBrowsing] = useState(null); // folderId
  const [fabOpen, setFabOpen] = useState(false);
  const [modal, setModal] = useState(null); // "group" | "widget"
  const [newGroup, setNewGroup] = useState("");
  const [wTitle, setWTitle] = useState("");
  const [wUrl, setWUrl] = useState("");
  const [gateMsg, setGateMsg] = useState(""); // 引导门提示（自动生成 ID 等）

  /* 容器宽度（决定列数 10/6/4/2） */
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) setWidth(en.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const folders = useMemo(() => (data ? data.folders || [] : []), [data]);
  const quickSites = useMemo(() => (data ? data.quickSites || [] : []), [data]);
  const iframeWidgets = useMemo(() => (data ? data.iframeWidgets || [] : []), [data]);

  /* 网格内的卡片清单：常用网站 + 各分组 + iframe 小部件 */
  const widgetDefs = useMemo(() => {
    const list = [{ id: "qs:quicksites", kind: "qs", title: "常用网站" }];
    for (const f of folders) list.push({ id: "f:" + f.id, kind: "folder", folder: f, title: f.title || "未命名" });
    for (const w of iframeWidgets) list.push({ id: "w:" + w.id, kind: "iframe", widget: w, title: w.title || "小部件" });
    return list;
  }, [folders, iframeWidgets]);
  const defMap = useMemo(() => new Map(widgetDefs.map((d) => [d.id, d])), [widgetDefs]);

  const cols = colsForWidth(width || 1280);
  const colW = width ? (width - (cols - 1) * GAP) / cols : 0;
  const [heights, setHeights] = useState({}); // 卡片实测内容高度（px）

  /* 布局：云端存「顺序 + 列跨度 w + 最小行数 h」；
     w 以参考列数 10 计，h 以固定行高（像素）计，跨设备一致。
     展示位置由装箱算法按顺序推算（自由堆叠，无空洞）；卡片高度 = 实测内容高度与 h 行取大 */
  const derivedLayout = useMemo(() => {
    const stored = Array.isArray(data?.layout) ? data.layout : [];
    const wanted = new Map(widgetDefs.map((w) => [w.id, true]));
    const known = [];
    const needPlace = [];
    const seen = new Set();
    for (const e of stored) {
      if (!wanted.has(e.i) || seen.has(e.i)) continue;
      const w = Math.max(1, Math.min(REF_COLS, Math.round(e.w || defaultWidth(e.i))));
      // 异常高度自愈（历史版本单位错乱可能写出超大值）
      let h = Math.max(0, Math.round(e.h || 0));
      const corrupted = h > 5000;
      if (corrupted) h = e.i.startsWith("w:") ? 480 : 0;
      if (Number.isFinite(e.x) && Number.isFinite(e.y) && !corrupted) {
        known.push({ i: e.i, x: Math.max(0, Math.min(REF_COLS - w, Math.round(e.x))), y: Math.max(0, Math.round(e.y)), w, h });
      } else {
        needPlace.push({ i: e.i, w, h }); // 坐标缺失或已损坏：重新装箱
      }
      seen.add(e.i);
    }
    for (const wd of widgetDefs) {
      if (!seen.has(wd.id)) needPlace.push({ i: wd.id, w: defaultWidth(wd.id), h: wd.id.startsWith("w:") ? 480 : 0 });
    }
    // 新卡片 / 旧格式数据：自动装箱补位
    if (needPlace.length) {
      // packColumns 的 y 以行计，这里换算为像素（行高 90px）
      for (const p of packColumns(needPlace, REF_COLS, known)) known.push({ ...p, y: Math.round(p.y * 90) });
    }
    return known;
  }, [data?.layout, widgetDefs]);

  /* 当前渲染/编辑中的布局（拖动与拉伸实时更新，结束后回写云端） */
  const [items, setItems] = useState(derivedLayout);
  const [gesturing, setGesturing] = useState(false);
  const [activeId, setActiveId] = useState(null); // dnd-kit 正在拖动的卡片
  const [overlayW, setOverlayW] = useState(280);
  const itemsRef = useRef(items);
  const gestureRef = useRef(null); // {id, it, startX, startY, cur, ...预览几何}（仅拉伸）
  const gridRef = useRef(null);
  const previewRef = useRef(null);
  const candidateRef = useRef(null); // 拖动落点候选（vx 列, y 行）
  const dragGeomRef = useRef(null); // 拖动抓取几何
  const overlayRef = useRef(null);
  const rafRef = useRef(0);
  const activeIdRef = useRef(null);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    if (!gesturing && !activeId) setItems(derivedLayout);
  }, [derivedLayout, gesturing, activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  /* 每张卡的渲染几何：显式坐标 + 实测内容高度 */
  const posMap = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      m.set(it.i, {
        x: viewX(it, cols) * (colW + GAP),
        y: it.y,
        w: viewSpan(it, cols),
        hPx: effHeightPx(it, heights),
      });
    }
    return m;
  }, [items, cols, colW, heights]);

  const containerHeight = useMemo(() => {
    let m = 0;
    for (const p of posMap.values()) m = Math.max(m, p.y + p.hPx);
    return m;
  }, [posMap]);

  /* 渲染后实测卡片内容高度；变化则更新（拖放防重叠依赖它） */
  useLayoutEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const next = {};
    let changed = false;
    gridEl.querySelectorAll(".board-cell").forEach((el) => {
      const id = el.dataset.id;
      const h = el.offsetHeight;
      next[id] = h;
      if (Math.abs((heights[id] || 0) - h) > 1) changed = true;
    });
    if (changed) setHeights(next);
  });

  /* 拉伸手势挂在网格容器上：按住右下角把手，横向调宽度、纵向调最小高度。
     拖动排序交给 dnd-kit；按下时记录抓取几何，供拖动落点推算 */
  const onGridPointerDown = useCallback(
    (e) => {
      if (gestureRef.current || e.button > 0) return;
      const cellEl = e.target.closest(".board-cell");
      if (!cellEl) return;
      const gridEl = gridRef.current;
      if (!gridEl) return;
      // 记录抓取几何（拖动排序落点推算依据：指针相对卡片左上角的偏移 + 网格原点/列宽）
      const gid = cellEl.dataset.id;
      if (gid && itemsRef.current.some((p) => p.i === gid)) {
        const gridRect = gridEl.getBoundingClientRect();
        const cardRect = cellEl.getBoundingClientRect();
        const colW2 = (gridRect.width - (cols - 1) * GAP) / cols;
        dragGeomRef.current = {
          gridLeft: gridRect.left,
          gridTop: gridRect.top,
          grabDX: e.clientX - cardRect.left,
          grabDY: e.clientY - cardRect.top,
          colW: colW2,
          pitchX: colW2 + GAP,
        };
      }
      if (!e.target.closest(".board-resize")) return;
      const id = cellEl.dataset.id;
      const it = itemsRef.current.find((p) => p.i === id);
      if (!it) return;
      e.preventDefault();
      const gridRect = gridEl.getBoundingClientRect();
      const cardRect = cellEl.getBoundingClientRect();
      const ncols = colsForWidth(gridRect.width);
      // 高度下限 = 真实内容高度（不含此前拉伸附加的最小高度），否则放大后永远缩不回去。
      // body 是 flex 拉伸的，直接量子元素测不到自然高度，须临时清零 min-height 再量
      let contentH = cardRect.height;
      const prevMin = cellEl.style.minHeight;
      cellEl.style.minHeight = "0";
      contentH = cellEl.getBoundingClientRect().height;
      cellEl.style.minHeight = prevMin;
      gestureRef.current = {
        id, it, startX: e.clientX, startY: e.clientY, cur: itemsRef.current,
        gridW: gridRect.width,
        cardLeft: cardRect.left - gridRect.left,
        cardTop: cardRect.top - gridRect.top,
        contentH,
        colW: (gridRect.width - (ncols - 1) * GAP) / ncols,
      };
      // 预览框初始 = 当前卡片尺寸
      const pv = previewRef.current;
      if (pv) {
        pv.classList.add("active");
        pv.style.left = cardRect.left - gridRect.left + "px";
        pv.style.top = cardRect.top - gridRect.top + "px";
        pv.style.width = cardRect.width + "px";
        pv.style.height = cardRect.height + "px";
        const badge = pv.querySelector(".board-resize-badge");
        const span = Math.max(1, Math.min(ncols, Math.round((it.w * ncols) / REF_COLS)));
        if (badge) badge.textContent = span + " 列";
      }
      setGesturing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [cols]
  );

  const onGridPointerMove = useCallback(
    (e) => {
      const g = gestureRef.current;
      if (!g || rafRef.current) return;
      const cx = e.clientX;
      const cy = e.clientY;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const gg = gestureRef.current;
        if (!gg) return;
        const ncols = colsForWidth(gg.gridW);
        const colW2 = (gg.gridW - (ncols - 1) * GAP) / ncols;
        const pitchX2 = colW2 + GAP;
        const vx0 = viewX(gg.it, ncols);
        const span0 = viewSpan(gg.it, ncols);
        // 拉伸可自由变宽/变高；松手时其他卡片自动下移让位
        let span = Math.max(1, Math.min(ncols, Math.round(span0 + (cx - gg.startX) / pitchX2)));
        const dw = Math.max(1, Math.round((span * REF_COLS) / ncols));
        const dh = Math.max(0, Math.round(gg.it.h + (cy - gg.startY)));
        gg.cur = gg.cur.map((p) => (p.i === gg.id ? { ...p, w: dw, h: dh } : p));
        // 虚线预览框直接改样式（零重渲染），吸附列/行
        const pv = previewRef.current;
        if (pv) {
          const w = span * gg.colW + (span - 1) * GAP;
          const h = Math.max(gg.contentH, dh);
          pv.style.width = w + "px";
          pv.style.height = h + "px";
          const badge = pv.querySelector(".board-resize-badge");
          if (badge) badge.textContent = dh > 0 ? span + " 列 × " + dh + " 行" : span + " 列";
        }
      });
    },
    [width]
  );

  const commitLayoutNow = useCallback(() => {
    col.setLayout(itemsRef.current.map((p) => ({ i: p.i, x: p.x, y: p.y, w: p.w, h: p.h })));
  }, [col]);

  const onGridPointerUp = useCallback(
    (e) => {
      const g = gestureRef.current;
      if (!g) return;
      gestureRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const pv = previewRef.current;
      if (pv) pv.classList.remove("active");
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* 指针已释放时忽略 */
      }
      setGesturing(false);
      // 一次性落位：重力整理后回写
      const settled = settleLayout(g.cur, heights, cols, colW, g.id);
      itemsRef.current = settled;
      setItems(settled);
      commitLayoutNow();
    },
    [commitLayoutNow, heights, cols, colW]
  );

  /* dnd-kit 拖动中：按「抓取偏移 + 指针位置」直接推算目标网格坐标（GridStack 模式），
     虚线预览实时跟随；纯几何计算，不做 DOM 命中查询 */
  const onDragMove = useCallback(
    ({ activatorEvent, delta }) => {
      const g = dragGeomRef.current;
      const a = activeIdRef.current;
      const dragged = itemsRef.current.find((p) => p.i === a);
      const ae = activatorEvent;
      if (!g || !a || !dragged || !ae || typeof ae.clientX !== "number") return;
      const span = viewSpan(dragged, cols);
      const draggedH = effHeightPx(dragged, heights);
      const px = ae.clientX + delta.x;
      const py = ae.clientY + delta.y;
      const col = Math.max(0, Math.min(cols - span, Math.round((px - g.grabDX - g.gridLeft) / g.pitchX)));
      const y = Math.max(0, Math.round(py - g.grabDY - g.gridTop));
      const resolvedY = resolveDropY(col, y, span, draggedH, a, itemsRef.current, heights, cols, colW);
      candidateRef.current = { vx: col, y: resolvedY };
      // 跟手浮层：左上角 = 指针位置 - 抓取偏移
      const ov = overlayRef.current;
      if (ov) {
        ov.style.left = px - g.grabDX + "px";
        ov.style.top = py - g.grabDY + "px";
      }
      // 虚线落点预览（直接改样式，零重渲染）
      const pv = previewRef.current;
      if (pv) {
        pv.classList.add("active");
        pv.style.left = col * g.pitchX + "px";
        pv.style.top = resolvedY + "px";
        pv.style.width = span * g.colW + (span - 1) * GAP + "px";
        pv.style.height = draggedH + "px";
        const badge = pv.querySelector(".board-resize-badge");
        if (badge) badge.textContent = "松开落到 " + (col + 1) + " 列";
      }
    },
    [cols, heights, colW]
  );

  const onDragEnd = useCallback(() => {
    const a = activeIdRef.current;
    const cand = candidateRef.current;
    activeIdRef.current = null;
    candidateRef.current = null;
    const pv = previewRef.current;
    if (pv) pv.classList.remove("active");
    setActiveId(null);
    if (a && cand) {
      const next = itemsRef.current.map((p) =>
        p.i === a
          ? {
              ...p,
              x: Math.max(0, Math.min(REF_COLS - p.w, Math.round((cand.vx * REF_COLS) / cols))),
              y: cand.y,
            }
          : p
      );
      const settled = settleLayout(next, heights, cols, colW, a);
      itemsRef.current = settled;
      setItems(settled);
    }
    commitLayoutNow();
  }, [cols, heights, colW, commitLayoutNow]);

  const submitNewGroup = () => {
    if (!newGroup.trim()) return;
    col.addFolder(newGroup.trim());
    setNewGroup("");
    setModal(null);
  };
  const submitWidget = () => {
    if (!wUrl.trim()) return;
    const url = /^https?:\/\//i.test(wUrl.trim()) ? wUrl.trim() : "https://" + wUrl.trim();
    col.addIframe({ title: wTitle.trim() || url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url, width: 560 });
    setWTitle("");
    setWUrl("");
    setModal(null);
  };

  /* 未登录 / ID 不存在：全屏引导门 */
  if (!hasUid || status === "notfound" || status === "auth-failed") {
    const isNotFound = status === "notfound";
    const isAuthFail = status === "auth-failed";
    let gatePrefill = "";
    try { gatePrefill = sessionStorage.getItem("gatePrefillUid") || ""; } catch {}
    const clearPrefill = () => { try { sessionStorage.removeItem("gatePrefillUid"); } catch {} };
    return (
      <div className="gate-screen" ref={boardRef}>
        <div className="gate-deco" aria-hidden="true">
          詩
        </div>
        <div className="gate-card">
          <img src="icon/128.png" alt="Poetry-Tab" className="gate-logo" />
          <h1 className="gate-title">Poetry-Tab</h1>
          <p className="gate-tagline">把古诗词和你的收藏，装进每一个新标签页</p>
          <div className="gate-features">
            <div className="gate-feature">
              <PoemIcon className="gf-ico" />
              <b>每日诗词</b>
              <i>打开即见一首古诗词</i>
            </div>
            <div className="gate-feature">
              <GridIcon className="gf-ico" />
              <b>收藏看板</b>
              <i>网站与小组件自由排布</i>
            </div>
            <div className="gate-feature">
              <CloudSyncIcon className="gf-ico" />
              <b>云同步</b>
              <i>一个 ID 多端互通</i>
            </div>
          </div>
          <div className="gate-form">
            <input
              id="gate-uid"
              className="gate-input"
              type="text"
              placeholder="输入用户 ID"
              spellCheck="false"
              autoCapitalize="off"
              autoComplete="off"
              defaultValue={gatePrefill || (isNotFound ? col.uid : undefined)}
              onKeyDown={(e) => {
                if (e.key === "Enter") document.getElementById("gate-pw")?.focus();
              }}
            />
            <input
              id="gate-pw"
              className="gate-input"
              type="password"
              placeholder="密码（至少 4 位）"
              autoComplete="new-password"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const uid = document.getElementById("gate-uid")?.value?.trim();
                const pw = e.currentTarget.value;
                if (!uid || !pw) return;
                clearPrefill();
                col.enter(uid, pw);
              }}
            />
            <button
              type="button"
              className="gate-btn primary"
              onClick={() => {
                const uid = document.getElementById("gate-uid")?.value?.trim();
                const pw = document.getElementById("gate-pw")?.value;
                if (!uid || !pw) { setGateMsg("请输入用户 ID 和密码"); return; }
                clearPrefill();
                col.enter(uid, pw);
              }}
            >
              进入我的收藏
            </button>
            <button
              type="button"
              className="gate-btn ghost"
              onClick={() => {
                const uid = document.getElementById("gate-uid")?.value?.trim();
                const pw = document.getElementById("gate-pw")?.value;
                if (!uid || !pw) { setGateMsg("请输入用户 ID 和密码"); return; }
                if (pw.length < 4) { setGateMsg("密码至少 4 位"); return; }
                clearPrefill();
                col.create(uid, pw);
              }}
            >
              新建用户
            </button>
          </div>
          {isNotFound && (
            <div className="gate-error">云端没有「{col.uid}」这个 ID，点「新建用户」即可创建</div>
          )}
          {isAuthFail && <div className="gate-error">密码错误，请重试</div>}
          {gateMsg && <div className="gate-msg">{gateMsg}</div>}
          <p className="gate-hint">用户 ID 即身份，无需注册；同一 ID 在扩展与网页端共享，请妥善保管</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bookmark-board" ref={boardRef}>
        <div className="board-widget" style={{ maxWidth: "420px", margin: "0 auto" }}>
          <div className="bf-header">
            <h3 className="bf-title">加载失败</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0 0.8rem 0.8rem" }}>
            <div className="bt-empty">{col.error || "网络异常，请重试"}</div>
            <button type="button" className="bm-add-btn" onClick={() => col.load(col.uid)}>
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderWidgetBody = (def, handle) => {
    if (def.kind === "qs")
      return <QuickSitesWidget sites={quickSites} onManage={() => setManage({ type: "quicksites" })} dragHandle={handle} />;
    if (def.kind === "folder")
      return (
        <GroupWidget
          folder={def.folder}
          onOpenFolder={(id) => setBrowsing(id)}
          onManage={(id) => setManage({ type: "folder", id })}
          dragHandle={handle}
        />
      );
    return <IframeWidget widget={def.widget} onRemove={col.removeIframe} dragHandle={handle} />;
  };

  const overlayDef = activeId ? defMap.get(activeId) : null;

  return (
    <div className={`bookmark-board board-rgl ${gesturing ? "gesturing" : ""} ${activeId ? "dnd-active" : ""}`} ref={boardRef}>
      <DndContext
        sensors={sensors}
        onDragStart={({ active, activatorEvent }) => {
          const id = String(active.id);
          activeIdRef.current = id;
          setActiveId(id);
          setOverlayW(active.rect.current.initial?.width || 280);
          const g0 = dragGeomRef.current;
          const ov = overlayRef.current;
          if (g0 && ov && activatorEvent && typeof activatorEvent.clientX === "number") {
            ov.style.left = activatorEvent.clientX - g0.grabDX + "px";
            ov.style.top = activatorEvent.clientY - g0.grabDY + "px";
          }
        }}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          activeIdRef.current = null;
          candidateRef.current = null;
          const pv = previewRef.current;
          if (pv) pv.classList.remove("active");
          setActiveId(null);
        }}
      >
        <div
          ref={gridRef}
          className="board-grid"
          style={{ height: containerHeight }}
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerUp}
          onPointerCancel={onGridPointerUp}
        >
          {items.map((it) => {
            const def = defMap.get(it.i);
            const p = posMap.get(it.i);
            if (!def || !p) return null;
            const minH = it.h > 0 ? `${it.h}px` : undefined;
            return (
              <DraggableCell
                key={it.i}
                def={def}
                style={{
                  width: p.w * colW + (p.w - 1) * GAP,
                  minHeight: minH,
                  transform: `translate(${p.x}px, ${p.y}px)`,
                }}
              >
                {({ ref, props }) => renderWidgetBody(def, { ref, props })}
              </DraggableCell>
            );
          })}
          {/* 拉伸时的吸附虚线预览框 */}
          <div ref={previewRef} className="board-resize-preview">
            <span className="board-resize-badge" />
          </div>
        </div>

      </DndContext>

      {/* 右下角悬浮按钮（不占网格） */}
      <div className="board-fab-zone">
        {fabOpen && (
          <>
            <button type="button" className="board-fab-overlay" aria-label="关闭菜单" onClick={() => setFabOpen(false)} />
            <div className="board-fab-menu">
              <button type="button" id="fab-new-group" onClick={() => { setModal("group"); setFabOpen(false); }}>
                <FolderIcon className="w-4 h-4" /> 新建分组
              </button>
              <button type="button" id="fab-new-widget" onClick={() => { setModal("widget"); setFabOpen(false); }}>
                <GridIcon className="w-4 h-4" /> 添加小部件
              </button>
            </div>
          </>
        )}
        <button
          type="button"
          id="fab-main"
          className={`board-fab ${fabOpen ? "open" : ""}`}
          title="新建分组 / 添加小部件"
          onClick={() => setFabOpen((o) => !o)}
        >
          <AddIcon className="w-7 h-7" />
        </button>
      </div>

      {/* 拖动跟手浮层 */}
      {overlayDef && (
        <div
          ref={overlayRef}
          className="board-widget board-overlay"
          style={{ width: overlayW }}
        >
          <div className="board-widget-header">
            <h3 className="board-widget-title">{overlayDef.title}</h3>
            <span className="board-widget-count">拖动中…</span>
          </div>
        </div>
      )}

      {modal === "group" && (
        <div className="bf-overlay" onClick={() => setModal(null)}>
          <div className="bf-panel bf-panel-sm" onClick={(e) => e.stopPropagation()}>
            <div className="bf-header">
              <h3 className="bf-title">新建分组</h3>
              <div className="bf-header-right">
                <button type="button" className="bf-close" onClick={() => setModal(null)} title="关闭">
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="bm-add">
              <input
                id="ng-input"
                className="bm-input"
                type="text"
                placeholder="分组名称，如 AI 工具"
                autoFocus
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitNewGroup()}
              />
              <button type="button" id="ng-create-btn" className="bm-add-btn" disabled={!newGroup.trim()} onClick={submitNewGroup}>
                创建分组
              </button>
            </div>
            <div className="bt-empty" style={{ padding: "0 0.8rem 0.8rem" }}>
              新分组卡片出现在网格底部，可拖动、可拉伸
            </div>
          </div>
        </div>
      )}

      {modal === "widget" && (
        <div className="bf-overlay" onClick={() => setModal(null)}>
          <div className="bf-panel bf-panel-sm" onClick={(e) => e.stopPropagation()}>
            <div className="bf-header">
              <h3 className="bf-title">新增 iframe 小部件</h3>
              <div className="bf-header-right">
                <button type="button" className="bf-close" onClick={() => setModal(null)} title="关闭">
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="bm-add">
              <input className="bm-input" type="text" placeholder="标题（可选）" value={wTitle} onChange={(e) => setWTitle(e.target.value)} />
              <input
                className="bm-input"
                type="text"
                placeholder="网址，如 grafana.example.com"
                value={wUrl}
                onChange={(e) => setWUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitWidget()}
              />
              <button type="button" className="bm-add-btn" disabled={!wUrl.trim()} onClick={submitWidget}>
                添加
              </button>
            </div>
            <div className="bt-empty" style={{ padding: "0 0.8rem 0.8rem" }}>
              添加后出现在网格底部；部分网站禁止内嵌会显示空白，可用卡片右上角 ↗ 打开
            </div>
          </div>
        </div>
      )}

      {manage && <ManageSheet col={col} target={manage} onClose={() => setManage(null)} />}
      {browsing && (
        <FolderBrowser folderId={browsing} data={data} onClose={() => setBrowsing(null)} />
      )}
    </div>
  );
}
