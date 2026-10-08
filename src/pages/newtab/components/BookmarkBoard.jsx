import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  IoAddOutline as AddIcon,
  IoCloseOutline as CloseIcon,
  IoFolderOutline as FolderIcon,
  IoGridOutline as GridIcon,
} from "react-icons/io5";
import { safeUrl } from "../services/collection";
import { colsForWidth, REF_SLOTS } from "../grid";
import { GAP, defaultCardH, normalizeLayout, migrateV1Layout, visibleColumns, columnsToLayout } from "./board/layoutEngine";
import { GroupWidget, QuickSitesWidget, IframeWidget } from "./board/widgets";
import ManageSheet from "./board/ManageSheet";
import FolderBrowser from "./board/FolderBrowser";
import GateScreen from "./board/GateScreen";

/*
 * 云端收藏看板（插件版与网页版共用这一个组件）—— v2 列式布局。
 * - 卡片按列排布、每列等宽（CSS 流式：无绝对定位、无逐卡高度测量，渲染/拖拽天然流畅）
 * - 列数：设置（2-5）或按宽度自适应；<640px 单列（拖拽停用，与移动端流式合一）
 * - 拖拽：自研指针拖拽（纯几何：悬停列 = x 区间、插入位 = 卡片中点比较），
 *   列内上下排序 + 跨列移动实时让位，松手一次回写云端 5 槽布局
 * - 兼容旧格式布局（显式坐标数组），加载时自动迁移为列式
 * - 登录门 / 管理面板 / 文件夹浏览在同目录 board/ 下；本文件只做列编排
 */

const DRAG_THRESHOLD = 6; // 按住标题栏移动超过该距离才进入拖拽（避免误伤点击）

/* ---------- 看板入口 ---------- */

export default function BookmarkBoard({ col }) {
  const { data, status, hasUid } = col;
  /* 回调 ref 持有容器元素：登录门/加载态与看板主渲染是不同 DOM 元素，元素替换时重挂观察器 */
  const [boardEl, setBoardEl] = useState(null);
  const [width, setWidth] = useState(0);
  const [manage, setManage] = useState(null); // {type:"folder",id} | {type:"quicksites"}
  const [browsing, setBrowsing] = useState(null); // folderId
  const [fabOpen, setFabOpen] = useState(false);
  const [modal, setModal] = useState(null); // "group" | "widget"
  const [newGroup, setNewGroup] = useState("");
  const [wTitle, setWTitle] = useState("");
  const [wUrl, setWUrl] = useState("");

  useLayoutEffect(() => {
    if (!boardEl) return;
    const measure = () => setWidth(boardEl.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) setWidth(en.contentRect.width);
    });
    ro.observe(boardEl);
    measure();
    // 兜底：个别内嵌 webview 会停发 RO 回调甚至 window resize，matchMedia 断点事件独立派发
    window.addEventListener("resize", measure);
    const mqs = [640, 760, 980, 1200].map((px) => {
      const mq = window.matchMedia(`(min-width: ${px}px)`);
      const handler = () => measure();
      mq.addEventListener?.("change", handler);
      return { mq, handler };
    });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      for (const { mq, handler } of mqs) mq.removeEventListener?.("change", handler);
    };
  }, [boardEl]);

  const folders = useMemo(() => (data ? data.folders || [] : []), [data]);
  const quickSites = useMemo(() => (data ? data.quickSites || [] : []), [data]);
  const iframeWidgets = useMemo(() => (data ? data.iframeWidgets || [] : []), [data]);

  /* 卡片显隐（云端 settings.hiddenCards） */
  const hiddenCards = useMemo(() => {
    const list = Array.isArray(data?.settings?.hiddenCards) ? data.settings.hiddenCards : [];
    return new Set(list.filter((x) => typeof x === "string"));
  }, [data?.settings?.hiddenCards]);

  /* 网格内的卡片清单：常用网站 + 各分组 + iframe 小部件（按设置隐藏） */
  const widgetDefs = useMemo(() => {
    const list = hiddenCards.has("qs:quicksites") ? [] : [{ id: "qs:quicksites", kind: "qs", title: "常用网站" }];
    for (const f of folders) {
      if (!hiddenCards.has("f:" + f.id)) list.push({ id: "f:" + f.id, kind: "folder", folder: f, title: f.title || "未命名" });
    }
    for (const w of iframeWidgets) {
      if (!hiddenCards.has("w:" + w.id)) list.push({ id: "w:" + w.id, kind: "iframe", widget: w, title: w.title || "小部件" });
    }
    return list;
  }, [folders, iframeWidgets, hiddenCards]);
  const defMap = useMemo(() => new Map(widgetDefs.map((d) => [d.id, d])), [widgetDefs]);

  /* 列数：设置优先（2-5），否则按宽度自适应；手机（<640px）一律单列 */
  const colsSetting = Number(data?.settings?.cols);
  const colCount = width > 0 && width < 640 ? 1 : colsSetting >= 2 && colsSetting <= 5 ? colsSetting : colsForWidth(width || 1280);
  const dndEnabled = colCount > 1;

  /* 云端布局 → 5 槽（旧格式坐标自动迁移） */
  const layoutRaw = data?.layout;
  const slots = useMemo(() => {
    const known = new Set(widgetDefs.map((d) => d.id));
    if (Array.isArray(layoutRaw) && layoutRaw.length && layoutRaw[0] && typeof layoutRaw[0].i === "string") {
      return migrateV1Layout(layoutRaw, known);
    }
    return normalizeLayout(layoutRaw, known);
  }, [layoutRaw, widgetDefs]);

  /* 旧格式布局一次性迁移落库（按 5 列视图生成完整槽位） */
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!data || !hasUid || migratedRef.current) return;
    if (Array.isArray(data.layout) && data.layout.length) {
      migratedRef.current = true;
      col.setLayout(columnsToLayout(visibleColumns(slots, REF_SLOTS)));
    }
  }, [data, hasUid, slots, col]);

  /* 拖拽：dropHint = {col, index}（实时让位），dragId = 正在拖的卡片 */
  const [dropHint, setDropHint] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dragW, setDragW] = useState(0);
  useEffect(() => { setDropHint(null); setDragId(null); }, [slots, colCount]);
  const baseCols = useMemo(() => visibleColumns(slots, colCount), [slots, colCount]);

  /* 悬停位 → 实时列（拖动卡搬到 hint 位置，其余卡自然让位） */
  const activeCols = useMemo(() => {
    if (!dropHint || !dragId) return baseCols;
    const cols = baseCols.map((c) => c.filter((id) => id !== dragId));
    const target = [...cols[dropHint.col]];
    target.splice(Math.min(dropHint.index, target.length), 0, dragId);
    cols[dropHint.col] = target;
    return cols;
  }, [baseCols, dropHint, dragId]);

  /* ---------- 自研指针拖拽（纯几何，无命中检测库） ---------- */
  const colsRef = useRef(null); // .board-cols 容器（几何基准）
  const ghostRef = useRef(null); // 跟手浮层（直接改样式，零重渲染）
  const dragRef = useRef(null); // {pending, id, def, startX, startY, grabDX, grabDY, cardW, raf, curX, curY}

  const onBoardPointerDown = useCallback(
    (e) => {
      if (!dndEnabled || e.button > 0 || dragRef.current) return;
      const header = e.target.closest(".board-widget-header");
      if (!header) return;
      const card = header.closest(".board-card");
      const container = colsRef.current;
      if (!card || !container || !card.dataset.id) return;
      const cardRect = card.getBoundingClientRect();
      dragRef.current = {
        pending: true,
        id: card.dataset.id,
        startX: e.clientX,
        startY: e.clientY,
        grabDX: e.clientX - cardRect.left,
        grabDY: e.clientY - cardRect.top,
        cardW: cardRect.width,
        curX: e.clientX,
        curY: e.clientY,
      };
    },
    [dndEnabled]
  );

  /* 悬停列与插入位：列 = x 落入的等宽区间；插入位 = 指针越过该列各卡中点的位置 */
  const computeHint = useCallback((clientX, clientY) => {
    const container = colsRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const pitch = rect.width / colCount;
    const c = Math.max(0, Math.min(colCount - 1, Math.floor((clientX - rect.left) / pitch)));
    const cards = container.querySelectorAll(`.board-col[data-col="${c}"] .board-card:not(.dragging-src)`);
    let index = cards.length;
    cards.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        index = Math.min(index, i);
      }
    });
    return { col: c, index };
  }, [colCount]);

  const onBoardPointerMove = useCallback(
    (e) => {
      const d = dragRef.current;
      if (!d) return;
      d.curX = e.clientX;
      d.curY = e.clientY;
      if (d.pending) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
        d.pending = false;
        setDragW(d.cardW);
        setDragId(d.id);
      }
      // 直接同步处理（不用 rAF：个别内嵌 webview 会停发 rAF 帧回调，拖拽会卡死在起始位）。
      // 单次开销 = 一次样式写入 + 少量 getBoundingClientRect，且 hint 有相等性守卫，不会渲染风暴。
      const g = ghostRef.current;
      if (g) {
        g.style.transform = `translate(${d.curX - d.grabDX}px, ${d.curY - d.grabDY}px)`;
        g.style.visibility = "visible"; // 首帧定位后再显示，避免左上角闪现
      }
      const hint = computeHint(d.curX, d.curY);
      if (hint) setDropHint((prev) => (prev && prev.col === hint.col && prev.index === hint.index ? prev : hint));
    },
    [computeHint]
  );

  const onBoardPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const drop = dropRef.current; // 读最新预览（不依赖闭包 flush 时序）
    if (drop) {
      const cols = baseCols.map((c) => c.filter((id) => id !== drop.dragId));
      const target = [...cols[drop.dropHint.col]];
      target.splice(Math.min(drop.dropHint.index, target.length), 0, drop.dragId);
      cols[drop.dropHint.col] = target;
      col.setLayout(columnsToLayout(cols));
    }
    setDragId(null);
    setDropHint(null);
  }, [baseCols, col]);
  const onBoardPointerCancel = onBoardPointerUp;
  const dropRef = useRef(null); // up 时读最新预览（不依赖闭包 flush 时序）
  useEffect(() => {
    dropRef.current = dragId && dropHint ? { dragId, dropHint } : null;
  }, [dragId, dropHint]);

  const openQsManage = useCallback(() => setManage({ type: "quicksites" }), []);
  const openFolderManage = useCallback((id) => setManage({ type: "folder", id }), []);
  const openFolderBrowser = useCallback((id) => setBrowsing(id), []);

  const submitNewGroup = () => {
    if (!newGroup.trim()) return;
    col.addFolder(newGroup.trim());
    setNewGroup("");
    setModal(null);
  };
  const submitWidget = () => {
    const url = safeUrl(wUrl);
    if (!url) return;
    col.addIframe({ title: wTitle.trim() || url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url });
    setWTitle("");
    setWUrl("");
    setModal(null);
  };

  /* 未登录：全屏引导门（登录 / 注册） */
  if (!hasUid) return <GateScreen col={col} containerRef={setBoardEl} />;

  if (!data) {
    if (status === "boot" || status === "loading") {
      return (
        <div className="bookmark-board" ref={setBoardEl}>
          <div className="board-widget" style={{ maxWidth: "420px", margin: "0 auto" }}>
            <div className="bf-header">
              <h3 className="bf-title">正在从云端加载…</h3>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="bookmark-board" ref={setBoardEl}>
        <div className="board-widget" style={{ maxWidth: "420px", margin: "0 auto" }}>
          <div className="bf-header">
            <h3 className="bf-title">加载失败</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0 0.8rem 0.8rem" }}>
            <div className="bt-empty">{col.error || "未知错误"}</div>
            <button type="button" className="bm-add-btn" onClick={() => col.reload()}>
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderWidgetBody = (def, handle) => {
    if (def.kind === "qs")
      return <QuickSitesWidget sites={quickSites} onManage={openQsManage} dragHandle={handle} />;
    if (def.kind === "folder")
      return (
        <GroupWidget
          folder={def.folder}
          onOpenFolder={openFolderBrowser}
          onManage={openFolderManage}
          dragHandle={handle}
        />
      );
    return <IframeWidget widget={def.widget} onRemove={col.removeIframe} onUpdate={col.updateIframe} dragHandle={handle} />;
  };

  /* 空看板引导：区分「真的没内容」与「内容被全部隐藏」两种空态 */
  const isEmptyBoard = widgetDefs.length === 0;
  const hasAnyContent =
    !quickSites.length && !iframeWidgets.length && (folders || []).every((f) => !(f.children || []).length);

  return (
    <div className={`bookmark-board board-rgl cols-${colCount}${dragId ? " dragging" : ""}`} ref={setBoardEl}>
      {isEmptyBoard && (
        <div className="board-onboarding">
          {hasAnyContent ? (
            <>
              <div className="board-onboarding-title">所有卡片均已隐藏</div>
              <div className="board-onboarding-text">可在 <b>设置 → 外观 → 卡片显隐</b> 中恢复显示</div>
            </>
          ) : (
            <>
              <div className="board-onboarding-title">从收藏开始你的快捷开始页</div>
              <div className="board-onboarding-text">
                点右下角 <b>＋</b> 新建分组或添加小部件；已有浏览器书签可在 <b>设置 → 导入与备份</b> 一键导入
              </div>
            </>
          )}
        </div>
      )}

      <div
        ref={colsRef}
        className="board-cols"
        style={{ gap: GAP }}
        onPointerDown={dndEnabled ? onBoardPointerDown : undefined}
        onPointerMove={dndEnabled ? onBoardPointerMove : undefined}
        onPointerUp={dndEnabled ? onBoardPointerUp : undefined}
        onPointerCancel={dndEnabled ? onBoardPointerCancel : undefined}
      >
        {activeCols.map((ids, ci) => (
          <div className={`board-col${ids.length === 0 ? " empty" : ""}`} key={ci} data-col={ci}>
            {ids.map((id) => {
              const def = defMap.get(id);
              if (!def) return null;
              return (
                <div
                  key={id}
                  data-id={id}
                  className={`board-card${id === dragId ? " dragging-src" : ""}`}
                >
                  <div
                    className="board-card-inner"
                    style={def.kind === "iframe" ? { minHeight: def.widget?.h || defaultCardH(id) } : undefined}
                  >
                    {renderWidgetBody(def, null)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 拖拽跟手浮层（占位卡在原网格中以虚线呈现） */}
      {dragId && (
        <div ref={ghostRef} className="board-drag-ghost" style={{ width: dragW || undefined, visibility: "hidden" }}>
          <div className="board-widget-header">
            <h3 className="board-widget-title">{defMap.get(dragId)?.title || ""}</h3>
            <span className="board-widget-count">拖动中…</span>
          </div>
        </div>
      )}

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
              新分组卡片出现在末列，可列内排序、跨列拖动
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
              添加后出现在末列；部分网站禁止内嵌会显示空白，可用卡片右上角 ⋯ 打开
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
