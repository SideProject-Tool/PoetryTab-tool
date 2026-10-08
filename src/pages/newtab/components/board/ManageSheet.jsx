/**
 * 卡片管理工作台（⋯ 打开）：
 * - 桌面端宽屏分栏：左侧分组树（子分组增删改 + 拖拽排序）、右侧工具栏 + 列表；手机自动全屏、树变横向 chips
 * - 列表交互：点行展开行内编辑；低频操作（打开/删除）收进行尾 ⋯ 菜单；按住行首把手拖拽排序
 * - 树交互：点行切换当前分组；把手拖拽调整子分组顺序（即卡片标签页顺序）；⋯ 菜单编辑/删除
 * - 菜单状态树/列表相互独立（根层级下同一子分组同时出现在树与列表，共用状态会串扰）
 * - 收录：右上「＋收录」在列表顶部插入编辑行（与编辑同一表单）；标题留空自动取网页标题
 * - 批量：工具栏「批量」展开多行录入层（一行一条），不遮挡列表
 * - 搜索：按标题/网址过滤当前列表（过滤时暂停拖拽）
 * - 删除：书签即删（底部撤销 toast 兜底）；含内容的子分组需在菜单内二次确认
 *
 * target: {type:"folder", id} | {type:"quicksites"}
 */
import { useState, useEffect, useRef, useMemo } from "react";
import {
  IoTrashOutline as TrashIcon,
  IoCloseOutline as CloseIcon,
  IoCheckmarkOutline as CheckIcon,
  IoCreateOutline as EditIcon,
  IoEllipsisHorizontalOutline as MoreIcon,
  IoReorderTwoOutline as ReorderIcon,
  IoAddOutline as AddIcon,
  IoSearchOutline as SearchIcon,
  IoOpenOutline as OpenIcon,
  IoFolderOutline as FolderIcon,
} from "react-icons/io5";
import { openUrl } from "../../../../platform";
import { findNode, safeUrl } from "../../services/collection";
import { fetchPageTitle } from "../../services/meta";
import FolderBrowser from "./FolderBrowser";

const H_INTRO = "点「＋ 收录」添加；标题留空自动取网页名";
const DRAG_THRESHOLD = 6;

/** 批量文本解析：一行一条，支持「标题 网址」「纯网址」「[标题](网址)」；无效行跳过 */
function parseBatch(text) {
  const out = [];
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let title = "";
    let url = "";
    const md = line.match(/^\[(.+?)\]\((\S+?)\)$/);
    if (md) {
      title = md[1];
      url = md[2];
    } else {
      const parts = line.split(/\s+/);
      const last = parts[parts.length - 1];
      if (parts.length >= 2 && /^([\w-]+\.)[\w.-]+/.test(last)) {
        title = parts.slice(0, -1).join(" ");
        url = last;
      } else {
        url = parts[0];
      }
    }
    const href = safeUrl(url);
    if (!href) continue;
    out.push({ title: title.trim(), url: href });
  }
  return out;
}

/** 未填名称的条目：后台逐个取标题并回填（失败保持网址名） */
function fillTitles(items, ids, apply) {
  (async () => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].title) continue;
      const t = await fetchPageTitle(items[i].url);
      if (t) apply(ids[i], { title: t });
    }
  })();
}

/* ---------- 行内编辑器（新增/编辑共用） ---------- */

function RowEditor({ initial, onSave, onCancel }) {
  const [title, setTitle] = useState(initial.title || "");
  const [url, setUrl] = useState(initial.url || "");
  const [err, setErr] = useState("");
  const urlRef = useRef(null);
  const save = () => {
    if (initial.children) {
      if (!title.trim()) { setErr("名称不能为空"); return; }
      onSave({ title: title.trim() });
      return;
    }
    const href = safeUrl(url);
    if (!href) { setErr("网址无效（示例 example.com）"); return; }
    onSave({ title: title.trim(), url: href });
  };
  return (
    <div className="ms-editor">
      <input
        className="ms-editor-input"
        autoFocus
        placeholder={initial.children ? "子分组名称" : "标题（留空自动取网页名）"}
        value={title}
        onChange={(e) => { setTitle(e.target.value); setErr(""); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (initial.children ? save() : urlRef.current?.focus());
          if (e.key === "Escape") onCancel();
        }}
      />
      {!initial.children && (
        <input
          ref={urlRef}
          className="ms-editor-input mono"
          placeholder="网址 example.com"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setErr(""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
        />
      )}
      <div className="ms-editor-ops">
        <button type="button" className="ms-btn primary" onClick={save}>保存</button>
        <button type="button" className="ms-btn" onClick={onCancel}>取消</button>
        {err && <span className="ms-err">{err}</span>}
      </div>
    </div>
  );
}

/* ---------- 行 ⋯ 菜单 ---------- */

function RowMenu({ row, onClose, onEdit, onOpen, onDelete }) {
  const ref = useRef(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  const hasChildren = !!row.children;
  return (
    <div className="ms-row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => { onEdit(); onClose(); }}>
        <EditIcon className="w-4 h-4" /> 编辑
      </button>
      {!hasChildren && (
        <button type="button" onClick={() => { onOpen(); onClose(); }}>
          <OpenIcon className="w-4 h-4" /> 打开网址
        </button>
      )}
      {confirmDel && hasChildren ? (
        <button
          type="button"
          className="danger confirm"
          onClick={() => { onDelete(); onClose(); }}
        >
          <TrashIcon className="w-4 h-4" /> 确认删除（含 {row.children.length} 条内容）
        </button>
      ) : (
        <button
          type="button"
          className="danger"
          onClick={() => (hasChildren ? setConfirmDel(true) : onDelete())}
        >
          <TrashIcon className="w-4 h-4" /> 删除{hasChildren ? "…" : ""}
        </button>
      )}
    </div>
  );
}

/* ---------- 主组件 ---------- */

export default function ManageSheet({ col, target, onClose }) {
  const isQs = target.type === "quicksites";
  const rootNode = !isQs && col.data ? findNode(col.data, target.id)?.node : null;

  /* 当前所在节点：根分组 或 子分组 */
  const [currentId, setCurrentId] = useState(isQs ? null : target.id);
  const node = isQs ? null : findNode(col.data, currentId)?.node;
  const currentNode = isQs ? null : node;

  const items = isQs ? col.data?.quickSites || [] : currentNode?.children || [];

  const [q, setQ] = useState("");
  /* 列表拖拽预览 */
  const [order, setOrder] = useState(null);
  const [dragId, setDragId] = useState(null);
  const dragRef = useRef(null);
  const listRef = useRef(null);
  const orderRef = useRef(null); // up 时读最新预览（不依赖闭包 flush 时序）
  useEffect(() => { orderRef.current = order; }, [order]);
  /* 树（子分组）拖拽预览 */
  const [treeOrder, setTreeOrder] = useState(null);
  const [treeDragId, setTreeDragId] = useState(null);
  const treeDragRef = useRef(null);
  const treeRef = useRef(null);
  const treeOrderRef = useRef(null);
  useEffect(() => { treeOrderRef.current = treeOrder; }, [treeOrder]);

  /* 菜单：列表与树/chips 相互独立（根层级下同一子分组同时出现在两侧，共用会串扰） */
  const [menuId, setMenuId] = useState(null); // 列表行
  const [treeMenuId, setTreeMenuId] = useState(null); // 树行 + 手机 chips
  const closeMenus = () => { setMenuId(null); setTreeMenuId(null); };

  const [editingId, setEditingId] = useState(null); // "new"=新增 | 条目 id
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [treeRenamingId, setTreeRenamingId] = useState(null); // 树行/chips 行内重命名
  const [treeDraft, setTreeDraft] = useState("");
  const [headerEditing, setHeaderEditing] = useState(false); // 头部当前节点重命名
  const [headerDraft, setHeaderDraft] = useState("");
  const [subAdding, setSubAdding] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  const [confirmRootDel, setConfirmRootDel] = useState(false);
  const [hint, setHint] = useState("");
  const [browsing, setBrowsing] = useState(null); // 更深层文件夹的浏览浮层

  const subfolders = isQs ? [] : (rootNode?.children || []).filter((c) => c.children);
  const subById = useMemo(() => new Map(subfolders.map((s) => [s.id, s])), [subfolders]);
  const atRoot = isQs || currentId === target.id;

  /* 数据变化时重置拖拽预览（拖拽中不重置） */
  useEffect(() => {
    if (!dragId) setOrder(null);
  }, [items, dragId]);
  useEffect(() => {
    if (!treeDragId) setTreeOrder(null);
  }, [subfolders, treeDragId]);

  /* Esc：先退编辑/菜单/批量，再关面板 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (editingId || menuId || treeMenuId || treeRenamingId || headerEditing) {
        setEditingId(null); setMenuId(null); setTreeMenuId(null); setTreeRenamingId(null); setHeaderEditing(false);
        return;
      }
      if (batchOpen) { setBatchOpen(false); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, menuId, treeMenuId, treeRenamingId, headerEditing, batchOpen, onClose]);

  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  /* 展示列表：本地拖拽顺序（若有）→ 过滤 */
  const displayItems = useMemo(() => {
    const ids = order || items.map((it) => it.id);
    let list = ids.map((id) => byId.get(id)).filter(Boolean);
    const kw = q.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (it) =>
          (it.title || "").toLowerCase().includes(kw) ||
          (it.url || "").toLowerCase().includes(kw)
      );
    }
    return list;
  }, [order, items, byId, q]);

  /* 展示子分组：树/chips 拖拽预览顺序（若有） */
  const displaySubs = useMemo(() => {
    const ids = treeOrder || subfolders.map((s) => s.id);
    return ids.map((id) => subById.get(id)).filter(Boolean);
  }, [treeOrder, subfolders, subById]);

  /* ---------- 增删改 ---------- */

  const applyPatch = (id, patch) => (isQs ? col.updateQuickSite(id, patch) : col.updateNode(id, patch));

  const saveNew = ({ title, url }) => {
    const fallback = url ? url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "";
    const item = { title: title || fallback, ...(url ? { url } : {}) };
    const id = isQs ? col.addQuickSite(item) : col.addItem(currentId, item);
    setEditingId(null);
    if (!title && url) {
      setHint("已收录，正在获取网页标题…");
      fetchPageTitle(url).then((t) => {
        if (t) applyPatch(id, { title: t });
        setHint("");
      });
    }
  };

  const saveEdit = (id, original, { title, url }) => {
    if (original.children) {
      applyPatch(id, { title });
    } else {
      applyPatch(id, { title: title || url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url });
    }
    setEditingId(null);
  };

  const deleteRow = (row) => {
    if (isQs) col.removeQuickSite(row.id);
    else {
      col.removeNode(row.id);
      if (row.children && currentId === row.id) setCurrentId(target.id); // 删除的是当前所在子分组：回根
    }
    if (editingId === row.id) setEditingId(null);
  };

  const submitBatch = () => {
    const parsed = parseBatch(batchText);
    if (!parsed.length) return;
    const ids = isQs ? col.addQuickSites(parsed) : col.addItems(currentId, parsed);
    const pending = parsed.filter((it) => !it.title).length;
    setBatchText("");
    setBatchOpen(false);
    if (pending) {
      setHint(`已收录 ${parsed.length} 条，正在为 ${pending} 条获取标题…`);
      fillTitles(parsed, ids, applyPatch);
      setTimeout(() => setHint(""), 6000);
    }
  };

  const submitSub = () => {
    if (!subDraft.trim()) return;
    // 子分组仅一级：无论当前在根还是子分组视图，都创建为根分组下的同级子分组
    col.addFolder(target.id, subDraft.trim());
    setSubDraft("");
    setSubAdding(false);
  };

  const commitHeaderRename = () => {
    setHeaderEditing((prev) => {
      if (prev && headerDraft.trim() && headerDraft.trim() !== (currentNode?.title || "")) {
        col.renameNode(currentId, headerDraft.trim());
      }
      return false;
    });
  };

  /* ---------- 列表拖拽排序（行首把手；搜索过滤时停用） ---------- */

  const commitPreview = (id, targetIdx) => {
    const base = (order || items.map((it) => it.id)).filter((x) => x !== id);
    const next = [...base];
    next.splice(Math.max(0, Math.min(base.length, targetIdx)), 0, id);
    setOrder(next);
  };

  const onListHandleDown = (e, id) => {
    if (q.trim()) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成指针无 capture，不影响本元素上的事件流 */ }
    dragRef.current = { id, startY: e.clientY, moved: false };
  };
  const onListHandleMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
    if (!d.moved) { d.moved = true; setDragId(d.id); }
    const rows = [...listRef.current.querySelectorAll(".ms-row:not(.dragging-src)")];
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { idx = i; break; }
    }
    commitPreview(d.id, idx);
  };
  const onListHandleUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.moved) {
      const finalOrder = orderRef.current || items.map((it) => it.id);
      const to = finalOrder.indexOf(d.id);
      if (to >= 0) col.reorderNode(d.id, to);
    }
    setDragId(null);
    setOrder(null);
  };

  /* ---------- 树拖拽排序（子分组把手；把手 click 阻断冒泡防误触切换） ---------- */

  const commitTreePreview = (id, targetIdx) => {
    const base = (treeOrder || subfolders.map((s) => s.id)).filter((x) => x !== id);
    const next = [...base];
    next.splice(Math.max(0, Math.min(base.length, targetIdx)), 0, id);
    setTreeOrder(next);
  };

  const onTreeHandleDown = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 同上 */ }
    treeDragRef.current = { id, startY: e.clientY, moved: false };
  };
  const onTreeHandleMove = (e) => {
    const d = treeDragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
    if (!d.moved) { d.moved = true; setTreeDragId(d.id); }
    const rows = [...treeRef.current.querySelectorAll(".ms-tree-row.sub:not(.dragging-src)")];
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { idx = i; break; }
    }
    commitTreePreview(d.id, idx);
  };
  const onTreeHandleUp = () => {
    const d = treeDragRef.current;
    if (!d) return;
    treeDragRef.current = null;
    if (d.moved) {
      // reorderNode 的目标索引是「完整兄弟列表」（含书签）中的位置：
      // 以预览顺序中拖拽项之后紧跟的子分组为锚，插到它前面（无则排到最后）
      const previewSubs = treeOrderRef.current || subfolders.map((s) => s.id);
      const nextSub = previewSubs[previewSubs.indexOf(d.id) + 1] || null;
      const full = rootNode?.children || [];
      const shortened = full.filter((c) => c.id !== d.id);
      const to = nextSub ? shortened.findIndex((c) => c.id === nextSub) : shortened.length;
      if (to >= 0) col.reorderNode(d.id, to);
    }
    setTreeDragId(null);
    setTreeOrder(null);
  };

  /* ---------- 渲染 ---------- */

  const renderRow = (row) => {
    const isFolder = !!row.children;
    const editing = editingId === row.id;
    if (editing) {
      return (
        <div key={row.id} className="ms-row editing">
          <RowEditor
            initial={row}
            onSave={(draft) => saveEdit(row.id, row, draft)}
            onCancel={() => setEditingId(null)}
          />
        </div>
      );
    }
    const menuOpen = menuId === row.id;
    return (
      <div
        key={row.id}
        data-id={row.id}
        className={`ms-row${dragId === row.id ? " dragging-src" : ""}`}
        onClick={() => {
          if (isFolder) {
            if (atRoot) { setQ(""); setCurrentId(row.id); } // 根下的文件夹 = 子分组：树内导航
            else setBrowsing(row.id); // 更深层级交由文件夹浏览浮层
          } else {
            setEditingId(row.id);
          }
        }}
      >
        <span
          className={`ms-row-handle${q.trim() ? " disabled" : ""}`}
          title="拖动排序"
          onPointerDown={(e) => onListHandleDown(e, row.id)}
          onPointerMove={onListHandleMove}
          onPointerUp={onListHandleUp}
          onPointerCancel={onListHandleUp}
          onClick={(e) => e.stopPropagation()} // 拖拽结束合成的 click 不应触发行的点击（编辑/进入）
        >
          <ReorderIcon />
        </span>
        <div className="ms-row-main">
          <span className="ms-row-title">
            {isFolder && <FolderIcon className="ms-row-folder-ico" />}
            {row.title || row.url || "未命名"}
          </span>
          {!isFolder && row.url && <span className="ms-row-sub">{row.url}</span>}
        </div>
        {!isFolder && (
          <button
            type="button"
            className="ms-row-open"
            title="打开网址"
            onClick={(e) => {
              e.stopPropagation();
              const u = safeUrl(row.url);
              if (u) openUrl(u);
            }}
          >
            <OpenIcon className="w-4 h-4" />
          </button>
        )}
        <div className="ms-row-menu-anchor">
          <button
            type="button"
            className="ms-row-more"
            title="更多操作"
            onClick={(e) => { e.stopPropagation(); setMenuId(menuOpen ? null : row.id); }}
          >
            <MoreIcon className="w-4 h-4" />
          </button>
          {menuOpen && (
            <RowMenu
              row={row}
              onClose={closeMenus}
              onEdit={() => setEditingId(row.id)}
              onOpen={() => { const u = safeUrl(row.url); if (u) openUrl(u); }}
              onDelete={() => deleteRow(row)}
            />
          )}
        </div>
      </div>
    );
  };

  /* 树行（子分组）：拖拽把手 + 行内重命名 + ⋯ 菜单 */
  const renderTreeSub = (s) => {
    const renaming = treeRenamingId === s.id;
    if (renaming) {
      return (
        <div key={s.id} className="ms-tree-row sub renaming">
          <input
            className="ms-tree-rename"
            autoFocus
            value={treeDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTreeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && treeDraft.trim()) { col.renameNode(s.id, treeDraft.trim()); setTreeRenamingId(null); }
              if (e.key === "Escape") setTreeRenamingId(null);
            }}
            onBlur={() => { if (treeDraft.trim() && treeRenamingId === s.id) col.renameNode(s.id, treeDraft.trim()); setTreeRenamingId(null); }}
          />
        </div>
      );
    }
    const menuOpen = treeMenuId === s.id;
    return (
      <div
        key={s.id}
        className={`ms-tree-row sub${currentId === s.id ? " active" : ""}${treeDragId === s.id ? " dragging-src" : ""}`}
        onClick={() => { setQ(""); setCurrentId(s.id); }}
      >
        <span
          className="ms-row-handle"
          title="拖动排序"
          onPointerDown={(e) => onTreeHandleDown(e, s.id)}
          onPointerMove={onTreeHandleMove}
          onPointerUp={onTreeHandleUp}
          onPointerCancel={onTreeHandleUp}
          onClick={(e) => e.stopPropagation()}
        >
          <ReorderIcon />
        </span>
        <span className="ms-tree-name">{s.title || "未命名"}</span>
        <span className="ms-tree-count">{s.children.length}</span>
        <button
          type="button"
          className="ms-tree-more"
          title="子分组操作"
          onClick={(e) => { e.stopPropagation(); setTreeMenuId(menuOpen ? null : s.id); }}
        >
          <MoreIcon className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <RowMenu
            row={s}
            onClose={closeMenus}
            onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
            onOpen={() => {}}
            onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
          />
        )}
      </div>
    );
  };

  /* 手机端顶部 chips（桌面隐藏；菜单状态与树共用，与列表独立） */
  const chips = (
    <div className="ms-chips">
      {!isQs && (
        <div
          className={`ms-chip${atRoot ? " active" : ""}`}
          onClick={() => { setQ(""); setCurrentId(target.id); }}
        >
          <span className="ms-chip-name">{rootNode?.title || "分组"}</span>
        </div>
      )}
      {displaySubs.map((s) => (
        <div
          key={s.id}
          className={`ms-chip${currentId === s.id ? " active" : ""}`}
          onClick={() => { setQ(""); setCurrentId(s.id); }}
        >
          <span className="ms-chip-name">{s.title || "未命名"}</span>
          {currentId === s.id && (
            <span
              className="ms-chip-more"
              onClick={(e) => { e.stopPropagation(); setTreeMenuId(treeMenuId === s.id ? null : s.id); }}
            >
              <MoreIcon className="w-3.5 h-3.5" />
            </span>
          )}
          {treeMenuId === s.id && (
            <RowMenu
              row={s}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}
        </div>
      ))}
      <button type="button" className="ms-chip add" onClick={() => { setSubAdding(true); setSubDraft(""); }}>
        <AddIcon className="w-4 h-4" />
      </button>
      {subAdding && (
        <input
          className="ms-chip-input"
          autoFocus
          placeholder="子分组名称"
          value={subDraft}
          onChange={(e) => setSubDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSub();
            if (e.key === "Escape") { setSubAdding(false); setSubDraft(""); }
          }}
          onBlur={submitSub}
        />
      )}
    </div>
  );

  return (
    <div className="bf-overlay ms-overlay" onClick={onClose}>
      <div className="ms-panel" onClick={(e) => e.stopPropagation()}>
        {/* 头部：当前节点名 + 重命名 + 关闭 */}
        <div className="ms-header">
          {headerEditing ? (
            <input
              className="ms-rename"
              autoFocus
              value={headerDraft}
              onChange={(e) => setHeaderDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHeaderRename();
                if (e.key === "Escape") setHeaderEditing(false);
              }}
              onBlur={commitHeaderRename}
            />
          ) : (
            <h3 className="ms-title">
              {isQs ? "常用网站" : currentNode?.title || "未命名"}
              {!isQs && (
                <button
                  type="button"
                  className="ms-title-edit"
                  title="重命名"
                  onClick={() => { setHeaderEditing(true); setHeaderDraft(currentNode?.title || ""); }}
                >
                  <EditIcon className="w-4 h-4" />
                </button>
              )}
            </h3>
          )}
          <button type="button" className="ms-close" onClick={onClose} title="关闭 (Esc)">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="ms-body">
          {/* 左侧分组树（桌面；手机用顶部 chips） */}
          {!isQs && (
            <div className="ms-side" ref={treeRef}>
              <div
                className={`ms-tree-row${atRoot ? " active" : ""}`}
                onClick={() => { setQ(""); setCurrentId(target.id); }}
              >
                <FolderIcon className="w-4 h-4" />
                <span className="ms-tree-name">{rootNode?.title || "全部"}</span>
                <span className="ms-tree-count">{(rootNode?.children || []).length}</span>
              </div>
              {displaySubs.map(renderTreeSub)}
              <button type="button" className="ms-tree-add" onClick={() => { setSubAdding(true); setSubDraft(""); }}>
                <AddIcon className="w-4 h-4" /> 新建子分组
              </button>
              {subAdding && (
                <input
                  className="ms-tree-rename"
                  autoFocus
                  placeholder="子分组名称，回车创建（分组顶层）"
                  value={subDraft}
                  onChange={(e) => setSubDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitSub();
                    if (e.key === "Escape") { setSubAdding(false); setSubDraft(""); }
                  }}
                  onBlur={submitSub}
                />
              )}
            </div>
          )}

          {/* 右侧主区 */}
          <div className="ms-main">
            {/* 手机 chips */}
            {chips}

            {/* 工具栏 */}
            <div className="ms-toolbar">
              <div className="ms-search">
                <SearchIcon className="w-4 h-4" />
                <input
                  placeholder="搜索当前列表…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQ("")}
                />
                {q && (
                  <button type="button" className="ms-search-clear" onClick={() => setQ("")}>✕</button>
                )}
              </div>
              <button
                type="button"
                className="ms-btn primary"
                onClick={() => { setEditingId("new"); setBatchOpen(false); }}
              >
                ＋ 收录
              </button>
              <button
                type="button"
                className={`ms-btn${batchOpen ? " active" : ""}`}
                onClick={() => { setBatchOpen((o) => !o); setEditingId(null); }}
              >
                批量
              </button>
            </div>

            {/* 批量录入层 */}
            {batchOpen && (
              <div className="ms-batch">
                <textarea
                  className="ms-batch-textarea"
                  placeholder={"一行一条，回车分隔：\nGitHub  github.com\n哔哩哔哩 bilibili.com\n[知乎](zhihu.com)\n（标题可省略，自动取网页名）"}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  rows={5}
                />
                <div className="ms-batch-ops">
                  <span className="ms-batch-count">
                    {batchText.trim() ? `已识别 ${parseBatch(batchText).length} 条` : "支持「标题 网址」/ 纯网址 / [标题](网址)"}
                  </span>
                  <button type="button" className="ms-btn" onClick={() => setBatchOpen(false)}>取消</button>
                  <button
                    type="button"
                    className="ms-btn primary"
                    disabled={!parseBatch(batchText).length}
                    onClick={submitBatch}
                  >
                    收录 {parseBatch(batchText).length || ""} 条
                  </button>
                </div>
              </div>
            )}

            {hint && <div className="ms-hint">{hint}</div>}

            {/* 列表 */}
            <div className="ms-list" ref={listRef}>
              {editingId === "new" && (
                <div className="ms-row editing">
                  <RowEditor initial={{}} onSave={saveNew} onCancel={() => setEditingId(null)} />
                </div>
              )}
              {displayItems.map((row) => renderRow(row))}
              {displayItems.length === 0 && editingId !== "new" && (
                <div className="ms-empty">
                  {q.trim() ? "没有匹配的结果" : H_INTRO}
                </div>
              )}
            </div>

            {/* 根分组删除（两次确认；仅根层级显示） */}
            {!isQs && atRoot && (
              <div className="ms-footer">
                {confirmRootDel ? (
                  <button
                    type="button"
                    id="ms-del-folder-confirm"
                    className="ms-del-folder confirming"
                    onClick={() => { col.removeNode(target.id); onClose(); }}
                  >
                    再点一次，确认删除整个分组
                  </button>
                ) : (
                  <button type="button" className="ms-del-folder" onClick={() => setConfirmRootDel(true)}>
                    删除这个分组
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 更深层文件夹浏览（子分组内的子文件夹） */}
        {browsing && <FolderBrowser folderId={browsing} data={col.data} onClose={() => setBrowsing(null)} />}
      </div>
    </div>
  );
}
