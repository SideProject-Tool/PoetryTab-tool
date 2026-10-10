/**
 * 看板卡片部件：瓷贴（书签/文件夹）+ 三种卡片（分组 / iframe 小部件 / 待办清单）。
 * 纯展示 + 回调，布局与拖拽由 BookmarkBoard 编排。
 */
import { useState, useEffect, useRef, memo } from "react";
import {
  IoOpenOutline as OpenIcon,
  IoTrashOutline as TrashIcon,
  IoReloadOutline as ReloadIcon,
  IoFolderOutline as FolderIcon,
  IoEllipsisHorizontalOutline as MoreIcon,
  IoReorderTwoOutline as ReorderIcon,
  IoCheckmark as CheckIcon,
  IoCheckmarkDoneOutline as ClearDoneIcon,
  IoCloseOutline as CloseIcon,
  IoAddOutline as AddIcon,
  IoCreateOutline as RenameIcon,
  IoSearchOutline as SearchIcon,
} from "react-icons/io5";
import { openUrl, openHistoryPage, IS_EXT, getHistory } from "../../../../platform";
import Popover from "./Popover";
import { safeUrl, genId } from "../../services/collection";
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

/** 卡片标题行内编辑（双击标题或 ⋯ 菜单「重命名」进入）：回车/失焦保存、Esc 取消、清空视为取消 */
function TitleEdit({ initial, onCommit, onCancel }) {
  const [draft, setDraft] = useState(initial);
  const commit = () => {
    const t = draft.trim();
    if (t) onCommit(t);
    else onCancel();
  };
  return (
    <input
      className="board-widget-title-edit"
      value={draft}
      maxLength={60}
      autoFocus
      onPointerDown={(e) => e.stopPropagation()} // 输入框内点击/选字不触发卡片拖拽
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
    />
  );
}

/* iframe 挂载错峰：多个部件同时滚入视口时排入队列逐个拉起（约 60ms 间隔），
   避免同帧并发加载多个跨域 iframe 挤占主线程与网络。已卸载卡片的队列项静默跳过 */
const iframeMountQueue = [];
let iframeQueueRunning = false;
function enqueueIframeMount(mount) {
  iframeMountQueue.push(mount);
  if (iframeQueueRunning) return;
  iframeQueueRunning = true;
  const step = () => {
    const mount = iframeMountQueue.shift();
    if (!mount) {
      iframeQueueRunning = false;
      return;
    }
    mount();
    setTimeout(step, 60);
  };
  (window.requestIdleCallback || ((f) => setTimeout(f, 0)))(step);
}

/** iframe 小部件卡片：操作收进 ⋯ 菜单；iframe 视口内才挂载（挂载后本页会话内不重载） */
const IframeWidgetBase = ({ widget, onRemove, onUpdate, dragHandle }) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [menu, setMenu] = useState(null); // {anchor} ⋯ 菜单（Popover 到 body，脱离卡片裁剪）
  const [mounted, setMounted] = useState(false); // 首次滚入视口后保持 true，避免来回滚动反复重载
  const [hDraft, setHDraft] = useState(null); // 自定义高度草稿（字符串，Enter/失焦提交）
  const [renaming, setRenaming] = useState(false); // 标题行内编辑中
  const bodyRef = useRef(null);
  const aliveRef = useRef(true); // 卸载后作废错峰队列里残留的挂载回调
  const queuedRef = useRef(false); // 已入队待挂载，防止重复排队
  useEffect(() => () => { aliveRef.current = false; }, []);

  const commitTitle = (t) => {
    setRenaming(false);
    if (t !== widget.title) onUpdate(widget.id, { title: t });
  };

  /* 提交自定义高度：钳位 200-2000，非法输入回退当前值 */
  const commitH = () => {
    setHDraft((draft) => {
      if (draft === null) return null;
      const n = Math.round(Number(draft));
      if (Number.isFinite(n) && n >= 200 && n <= 2000) onUpdate(widget.id, { h: n });
      return null;
    });
  };

  /* 懒挂载：几何检测 + 滚动/缩放监听；入错峰队列逐个挂载 */
  useEffect(() => {
    if (mounted) return;
    const el = bodyRef.current;
    if (!el) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight + 300 && r.bottom > -300 && !queuedRef.current) {
        queuedRef.current = true;
        enqueueIframeMount(() => {
          queuedRef.current = false;
          if (aliveRef.current) setMounted(true);
        });
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [mounted]);

  const openInNewTab = () => {
    const u = safeUrl(widget.url);
    if (u) openUrl(u);
  };

  return (
    <div className="board-widget board-widget-iframe">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        {renaming ? (
          <TitleEdit initial={widget.title || ""} onCommit={commitTitle} onCancel={() => setRenaming(false)} />
        ) : (
          <h3 className="board-widget-title" title="按住拖动排序 · 双击重命名" onDoubleClick={() => setRenaming(true)}>{widget.title}</h3>
        )}
        <div className="board-widget-actions">
          <div className="widget-menu-anchor">
            <button
              type="button"
              className="board-widget-action"
              title="小部件操作"
              onPointerDown={(e) => e.stopPropagation()} // ⋯ 与拖拽状态机隔离
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(menu ? null : { anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
              }}
            >
              <MoreIcon className="w-4 h-4" />
            </button>
            {menu && (
              <Popover anchor={menu.anchor} onClose={() => setMenu(null)} minWidth={176}>
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
                <button type="button" id="iw-rename" onClick={() => { setMenu(null); setRenaming(true); }}>
                  <RenameIcon className="w-4 h-4" /> 重命名
                </button>
                <button type="button" id="iw-reload" onClick={() => { setReloadKey((k) => k + 1); setMenu(null); }}>
                  <ReloadIcon className="w-4 h-4" /> 重新加载
                </button>
                <button type="button" id="iw-open" onClick={() => { openInNewTab(); setMenu(null); }}>
                  <OpenIcon className="w-4 h-4" /> 新窗口打开
                </button>
                <button type="button" className="danger" id="iw-remove" onClick={() => { setMenu(null); onRemove(widget.id); }}>
                  <TrashIcon className="w-4 h-4" /> 删除小部件
                </button>
              </div>
            </Popover>
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

/** 待办清单卡片：底部输入添加、勾选沉底、双击行内编辑、把手卡内拖拽（仅未完成区）。
 *  显示顺序 = 未完成（存储序）→ 已完成（存储序）；落库时把存储顺序规范为同样的两段式 */
const TodoWidgetBase = ({ widget, onRemove, onUpdate, dragHandle }) => {
  const [menu, setMenu] = useState(null); // {anchor} ⋯ 菜单（Popover 到 body，脱离卡片裁剪）
  const [draft, setDraft] = useState(""); // 底部添加输入（本地态，提交才落库）
  const [editId, setEditId] = useState(null); // 行内编辑中的条目 id
  const [editText, setEditText] = useState("");
  const [dragState, setDragState] = useState(null); // {id, idx} 卡内拖拽实时让位（idx = 未完成区内目标位）
  const [renaming, setRenaming] = useState(false); // 标题行内编辑中
  const listRef = useRef(null);
  const dragRef = useRef(null); // {id, fromIdx, curIdx, listEl}

  const commitTitle = (t) => {
    setRenaming(false);
    if (t && t !== widget.title) onUpdate(widget.id, { title: t }); // 空文本视为取消（保住默认名）
  };

  const items = Array.isArray(widget.items) ? widget.items : [];
  const undone = items.filter((it) => !it.done);
  const done = items.filter((it) => it.done);
  /* 拖拽中按本地让位序渲染未完成组，否则按存储序 */
  const undoneView = (() => {
    if (!dragState) return undone;
    const rest = undone.filter((it) => it.id !== dragState.id);
    const dragged = undone.find((it) => it.id === dragState.id);
    if (!dragged) return undone;
    return [...rest.slice(0, dragState.idx), dragged, ...rest.slice(dragState.idx)];
  })();

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onUpdate(widget.id, { items: [...items, { id: genId("ti"), text, done: false, createdAt: Date.now() }] });
    setDraft("");
  };
  const toggle = (id) => onUpdate(widget.id, { items: items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)) }, { lazy: true }); // 勾选走慢通道：5 分钟兜底/捎带/关页落库
  const removeItem = (id) => onUpdate(widget.id, { items: items.filter((it) => it.id !== id) });
  const clearDone = () => onUpdate(widget.id, { items: undone });
  const commitEdit = () => {
    if (!editId) return;
    const text = editText.trim();
    if (text) onUpdate(widget.id, { items: items.map((it) => (it.id === editId ? { ...it, text } : it)) }); // 空文本视为取消
    setEditId(null);
    setEditText("");
  };

  /* ---------- 卡内条目拖拽（仅未完成区）：指针几何 + 实时让位，松手一次落库。
     看板拖拽只认 .board-widget-header，与这里互不相干；把手 touch-action:none 让触屏拖动不被滚动接管 ---------- */
  const onHandleDown = (e, item, idx) => {
    if (e.button > 0) return;
    e.stopPropagation(); // 与看板拖拽状态机彻底隔离
    e.preventDefault(); // 防止拖动时选中文字
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成指针无 capture */ }
    dragRef.current = { id: item.id, fromIdx: idx, curIdx: idx, listEl: listRef.current };
    setDragState({ id: item.id, idx });
  };

  const onHandleMove = (e) => {
    const d = dragRef.current;
    if (!d || !d.listEl) return;
    const y = e.clientY;
    /* 目标插入位 = 指针以下（按行中点划分）的未完成行数，钳位到合法槽；行几何每次现取，滚动/换行行高都自洽 */
    const rows = [...d.listEl.querySelectorAll(".board-todo-item:not(.done)")];
    let idx = 0;
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) idx += 1;
    }
    idx = Math.max(0, Math.min(rows.length - 1, idx));
    d.curIdx = idx;
    setDragState((s) => (s && s.id === d.id && s.idx === idx ? s : { id: d.id, idx })); // 相等性守卫，避免渲染风暴
    /* 列表上/下边缘自动滚动（列表限高内滚动，不牵动页面） */
    const listRect = d.listEl.getBoundingClientRect();
    const edge = 28;
    if (y < listRect.top + edge) d.listEl.scrollTop -= (edge - (y - listRect.top)) * 0.35;
    else if (y > listRect.bottom - edge) d.listEl.scrollTop += (edge - (listRect.bottom - y)) * 0.35;
  };

  const onHandleUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragState(null);
    if (!d || d.curIdx === d.fromIdx) return;
    const dragged = undone.find((it) => it.id === d.id);
    if (!dragged) return;
    const rest = undone.filter((it) => it.id !== d.id);
    onUpdate(widget.id, { items: [...rest.slice(0, d.curIdx), dragged, ...rest.slice(d.curIdx), ...done] });
  };

  const renderRow = (it, i, draggable) => (
    <div
      key={it.id}
      className={`board-todo-item${it.done ? " done" : ""}${dragState?.id === it.id ? " dragging" : ""}`}
    >
      {draggable ? (
        <button
          type="button"
          className="board-todo-handle"
          title="拖动排序"
          onPointerDown={(e) => onHandleDown(e, it, i)}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <ReorderIcon className="w-4 h-4" />
        </button>
      ) : (
        <span className="board-todo-handle-ph" />
      )}
      <button type="button" className="board-todo-check" title={it.done ? "标记为未完成" : "标记完成"} onClick={() => toggle(it.id)}>
        {it.done && <CheckIcon className="w-3 h-3" />}
      </button>
      {editId === it.id ? (
        <input
          className="board-todo-edit"
          value={editText}
          maxLength={200}
          autoFocus
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditId(null);
          }}
          onBlur={commitEdit}
        />
      ) : (
        <span className="board-todo-text" title="双击编辑" onDoubleClick={() => { setEditId(it.id); setEditText(it.text); }}>
          {it.text}
        </span>
      )}
      <button type="button" className="board-todo-del" title="删除条目" onClick={() => removeItem(it.id)}>
        <CloseIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="board-widget board-widget-todo">
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        {renaming ? (
          <TitleEdit initial={widget.title || ""} onCommit={commitTitle} onCancel={() => setRenaming(false)} />
        ) : (
          <h3 className="board-widget-title" title="按住拖动排序 · 双击重命名" onDoubleClick={() => setRenaming(true)}>{widget.title || "待办清单"}</h3>
        )}
        <div className="board-widget-actions">
          <span className="board-widget-count">{done.length}/{items.length}</span>
          <div className="widget-menu-anchor">
            <button
              type="button"
              className="board-widget-action"
              title="待办操作"
              onPointerDown={(e) => e.stopPropagation()} // ⋯ 与拖拽状态机隔离
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(menu ? null : { anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
              }}
            >
              <MoreIcon className="w-4 h-4" />
            </button>
            {menu && (
              <Popover anchor={menu.anchor} onClose={() => setMenu(null)} minWidth={176}>
                <div className="widget-menu">
                  <button type="button" id="td-rename" onClick={() => { setMenu(null); setRenaming(true); }}>
                    <RenameIcon className="w-4 h-4" /> 重命名
                  </button>
                  <button type="button" id="td-clear-done" disabled={!done.length} onClick={() => { clearDone(); setMenu(null); }}>
                    <ClearDoneIcon className="w-4 h-4" /> 清空已完成
                  </button>
                  <div className="widget-menu-divider" />
                  <button type="button" className="danger" id="td-remove" onClick={() => { setMenu(null); onRemove(widget.id); }}>
                    <TrashIcon className="w-4 h-4" /> 删除小部件
                  </button>
                </div>
              </Popover>
            )}
          </div>
        </div>
      </div>
      <div className="board-widget-body board-todo-body">
        <div className={`board-todo-list${dragState ? " dragging" : ""}`} ref={listRef}>
          {items.length === 0 && <div className="board-todo-empty">还没有待办，在下方输入添加</div>}
          {undoneView.map((it, i) => renderRow(it, i, true))}
          {done.map((it) => renderRow(it, -1, false))}
        </div>
        <div className="board-todo-add">
          <input
            className="board-todo-input"
            type="text"
            placeholder="添加待办，回车确认"
            maxLength={200}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button type="button" className="board-todo-add-btn" title="添加" disabled={!draft.trim()} onClick={add}>
            <AddIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 浏览历史时间标注：今天=时分，昨天=「昨天」，更早=M/D */
function histTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 浏览历史卡片（仅扩展版）：最近 20 条 + 搜索全部历史；chrome.history 仅本机读取，不上传。
 *  高度可配置（widget.h，参考 iframe 卡），设定后列表填满剩余空间内滚 */
const HistoryWidgetBase = ({ widget, onRemove, onUpdate, dragHandle }) => {
  const [menu, setMenu] = useState(null); // {anchor} ⋯ 菜单
  const [renaming, setRenaming] = useState(false); // 标题行内编辑中
  const [query, setQuery] = useState(""); // 搜索输入（本地态）
  const [items, setItems] = useState(null); // null = 查询中
  const [reloadKey, setReloadKey] = useState(0); // ⋯ 刷新
  const [hDraft, setHDraft] = useState(null); // 自定义高度草稿（字符串，Enter/失焦提交）
  const commitTitle = (t) => {
    setRenaming(false);
    if (t && t !== widget.title) onUpdate(widget.id, { title: t });
  };

  /* 提交自定义高度：钳位 200-2000，非法输入回退当前值（同 iframe 卡） */
  const commitH = () => {
    setHDraft((draft) => {
      if (draft === null) return null;
      const n = Math.round(Number(draft));
      if (Number.isFinite(n) && n >= 200 && n <= 2000) onUpdate(widget.id, { h: n });
      return null;
    });
  };

  /* 查询防抖 300ms：空关键词 = 最近 20 条；有关键词 = 搜全部历史前 50 条 */
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const q = query.trim();
      try {
        const rows = await getHistory(q, q ? 50 : 20);
        if (alive) setItems(rows || []);
      } catch {
        if (alive) setItems([]);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, reloadKey]);

  const has = Array.isArray(items);
  const h = Number(widget.h) || 0;
  return (
    <div className={`board-widget board-widget-history${h ? " sized" : ""}`} style={h ? { height: h } : undefined}>
      <div className="board-widget-header" title="按住拖动排序" ref={dragHandle?.ref} {...(dragHandle?.props || {})}>
        {renaming ? (
          <TitleEdit initial={widget.title || ""} onCommit={commitTitle} onCancel={() => setRenaming(false)} />
        ) : (
          <h3 className="board-widget-title" title="按住拖动排序 · 双击重命名" onDoubleClick={() => setRenaming(true)}>
            {widget.title || "浏览历史"}
          </h3>
        )}
        <div className="board-widget-actions">
          <span className="board-widget-count">{has ? `${items.length} 条` : "…"}</span>
          <div className="widget-menu-anchor">
            <button
              type="button"
              className="board-widget-action"
              title="历史操作"
              onPointerDown={(e) => e.stopPropagation()} // ⋯ 与拖拽状态机隔离
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(menu ? null : { anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
              }}
            >
              <MoreIcon className="w-4 h-4" />
            </button>
            {menu && (
              <Popover anchor={menu.anchor} onClose={() => setMenu(null)} minWidth={176}>
                <div className="widget-menu">
                  <button type="button" id="wh-rename" onClick={() => { setMenu(null); setRenaming(true); }}>
                    <RenameIcon className="w-4 h-4" /> 重命名
                  </button>
                  <div className="widget-menu-label">高度（像素，200-2000）</div>
                  <div className="widget-menu-heights">
                    {[240, 420, 600, 800].map((px) => (
                      <button
                        key={px}
                        type="button"
                        className={`widget-h-chip${h === px ? " on" : ""}`}
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
                  <button type="button" id="wh-reload" onClick={() => { setReloadKey((k) => k + 1); setMenu(null); }}>
                    <ReloadIcon className="w-4 h-4" /> 刷新
                  </button>
                  <div className="widget-menu-divider" />
                  <button type="button" className="danger" id="wh-remove" onClick={() => { setMenu(null); onRemove(widget.id); }}>
                    <TrashIcon className="w-4 h-4" /> 删除小部件
                  </button>
                </div>
              </Popover>
            )}
          </div>
        </div>
      </div>
      {!IS_EXT ? (
        <div className="board-widget-body">
          <div className="bt-empty">浏览历史仅在浏览器扩展版可用（网页版无此权限）</div>
        </div>
      ) : (
        <>
          <div className="board-history-search">
            <SearchIcon className="w-3.5 h-3.5" />
            <input
              className="board-history-input"
              type="text"
              placeholder="搜索全部历史…"
              maxLength={100}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="board-history-list">
            {has && items.length === 0 && (
              <div className="bt-empty">{query.trim() ? "没有匹配的历史记录" : "暂无浏览记录"}</div>
            )}
            {(items || []).map((row, i) => {
              const url = safeUrl(row.url);
              if (!url) return null; // 非 http(s) 已在 platform 层滤除，此处兜底
              return (
                <a
                  key={url + String(row.lastVisitTime) + i}
                  className="bh-row"
                  href={url}
                  title={row.title || row.url}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.button === 1) return;
                    e.preventDefault();
                    openUrl(url);
                  }}
                >
                  <TileIcon item={row} />
                  <span className="bh-title">{row.title || row.url}</span>
                  <span className="bh-time">{histTime(row.lastVisitTime)}</span>
                </a>
              );
            })}
          </div>
          <button
            type="button"
            className="board-history-all"
            title="打开浏览器的历史记录页"
            onClick={() => openHistoryPage()}
          >
            <OpenIcon className="w-3.5 h-3.5" /> 查看全部历史
          </button>
        </>
      )}
    </div>
  );
}

/* memo 比较器忽略 dragHandle：dnd 的 attributes/listeners 每渲染都是新对象，
   但监听器按卡片 id 闭包稳定，忽略其引用变化不影响功能，可避免拖拽期全树重渲染 */
export const GroupWidget = memo(GroupWidgetBase, (a, b) => a.folder === b.folder && a.onOpenFolder === b.onOpenFolder && a.onManage === b.onManage);
export const IframeWidget = memo(IframeWidgetBase, (a, b) => a.widget === b.widget && a.onRemove === b.onRemove && a.onUpdate === b.onUpdate);
export const TodoWidget = memo(TodoWidgetBase, (a, b) => a.widget === b.widget && a.onRemove === b.onRemove && a.onUpdate === b.onUpdate);
export const HistoryWidget = memo(HistoryWidgetBase, (a, b) => a.widget === b.widget && a.onRemove === b.onRemove && a.onUpdate === b.onUpdate);
export { TileGrid };
