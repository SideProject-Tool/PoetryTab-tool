/**
 * 卡片管理面板（⋯）：收录/编辑/删除书签、批量多行录入、自动取网页标题、
 * 二级分组（面包屑进入子分组、新建子分组）、重命名/删除分组。
 * target: {type:"folder", id} | {type:"quicksites"}
 */
import { useState, useMemo } from "react";
import {
  IoTrashOutline as TrashIcon,
  IoCloseOutline as CloseIcon,
  IoCheckmarkOutline as CheckIcon,
  IoArrowUpOutline as UpIcon,
  IoArrowDownOutline as DownIcon,
  IoCreateOutline as EditIcon,
  IoEnterOutline as EnterIcon,
} from "react-icons/io5";
import { openUrl } from "../../../../platform";
import { findNode, safeUrl } from "../../services/collection";
import { fetchPageTitle } from "../../services/meta";

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

export default function ManageSheet({ col, target, onClose }) {
  const isQs = target.type === "quicksites";

  /* 面包屑路径（仅分组模式）：进入/回退二级分组 */
  const [path, setPath] = useState(() => (isQs ? [] : [{ id: target.id }]));
  const currentId = isQs ? null : path[path.length - 1].id;
  const node = !isQs && col.data ? findNode(col.data, currentId)?.node : null;

  const [nTitle, setNTitle] = useState("");
  const [nUrl, setNUrl] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [subName, setSubName] = useState("");
  const [editId, setEditId] = useState(null);
  const [eTitle, setETitle] = useState("");
  const [eUrl, setEUrl] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node ? node.title : "");
  const [confirmDel, setConfirmDel] = useState(false);
  const [hint, setHint] = useState(""); // 收录反馈（自动取名中… 等）

  const items = isQs ? col.data?.quickSites || [] : node?.children || [];
  const rootNode = !isQs && col.data ? findNode(col.data, target.id)?.node : null;
  const title = isQs ? "常用网站" : (node || rootNode)?.title || "未命名";
  const batchItems = useMemo(() => (batchMode ? parseBatch(batchText) : []), [batchMode, batchText]);

  const applyPatch = (id, patch) => (isQs ? col.updateQuickSite(id, patch) : col.updateNode(id, patch));

  const submitAdd = () => {
    const url = safeUrl(nUrl);
    if (!url) return;
    const fallback = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const id = isQs
      ? col.addQuickSite({ title: nTitle.trim() || fallback, url })
      : col.addItem(currentId, { title: nTitle.trim() || fallback, url });
    setNTitle("");
    setNUrl("");
    if (!nTitle.trim()) {
      // 名称留空：先以网址入库，后台取回网页标题后自动替换
      setHint("已收录，正在获取网页标题…");
      fetchPageTitle(url).then((t) => {
        if (t) applyPatch(id, { title: t });
        setHint("");
      });
    }
  };

  const submitBatch = () => {
    if (!batchItems.length) return;
    const ids = isQs ? col.addQuickSites(batchItems) : col.addItems(currentId, batchItems);
    const pending = batchItems.filter((it) => !it.title).length;
    setBatchText("");
    if (pending) {
      // 标题留空的行：后台逐个取网页名回填（失败则保持显示网址）
      setHint(`已收录 ${batchItems.length} 条，正在为 ${pending} 条获取标题…`);
      fillTitles(batchItems, ids, applyPatch);
      setTimeout(() => setHint(""), 6000);
    }
  };

  const submitSubFolder = () => {
    if (!subName.trim() || isQs) return;
    col.addFolder(currentId, subName.trim());
    setSubName("");
  };

  const submitRename = () => {
    if (renameDraft.trim()) col.renameNode(currentId, renameDraft.trim());
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
                <button type="button" className="board-widget-action" title="重命名分组" onClick={() => { setRenaming(true); setRenameDraft(node ? node.title : ""); }}>
                  <EditIcon className="w-4 h-4" />
                </button>
              )
            )}
            <button type="button" className="bf-close" onClick={onClose} title="关闭">
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* 面包屑：二级分组导航（仅分组模式且已进入子分组时展示） */}
        {!isQs && path.length > 1 && (
          <div className="bm-path">
            {path.map((p, i) => (
              <span key={p.id} className="bm-path-step">
                {i > 0 && <span className="bm-path-sep">›</span>}
                <button
                  type="button"
                  className={`bm-path-btn ${i === path.length - 1 ? "active" : ""}`}
                  onClick={() => setPath(path.slice(0, i + 1))}
                >
                  {i === 0 ? (rootNode?.title || "根分组") : p.title}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 收录表单：单条 / 批量 */}
        {!batchMode ? (
          <div className="bm-add">
            <input className="bm-input" type="text" placeholder="标题（留空自动取网页名）" value={nTitle} onChange={(e) => setNTitle(e.target.value)} />
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
            <button type="button" className="bm-batch-toggle" onClick={() => setBatchMode(true)} title="多行批量录入">
              批量
            </button>
          </div>
        ) : (
          <div className="bm-add bm-add-batch">
            <textarea
              className="bm-textarea"
              placeholder={"一行一条，回车分隔：\nGitHub  github.com\n哔哩哔哩 bilibili.com\n（标题可省略，自动取网页名）"}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              rows={5}
            />
            <div className="bm-batch-ops">
              <button type="button" className="bm-batch-toggle" onClick={() => setBatchMode(false)}>
                返回单条
              </button>
              <span className="bm-batch-count">{batchText.trim() ? `已识别 ${batchItems.length} 条` : ""}</span>
              <button type="button" className="bm-add-btn" disabled={!batchItems.length} onClick={submitBatch}>
                收录 {batchItems.length || ""} 条
              </button>
            </div>
          </div>
        )}
        {hint && <div className="bm-hint">{hint}</div>}

        {/* 新建子分组（仅分组模式） */}
        {!isQs && (
          <div className="bm-add bm-subfolder-add">
            <input
              className="bm-input"
              type="text"
              placeholder="子分组名称（卡片内以标签页展示）"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSubFolder()}
            />
            <button type="button" className="bm-add-btn ghost" disabled={!subName.trim()} onClick={submitSubFolder}>
              ＋ 子分组
            </button>
          </div>
        )}

        <div className="bm-list">
          {items.map((item, idx) =>
            editId === item.id ? (
              <div key={item.id} className="bm-row bm-row-edit">
                <input className="bm-input" value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="标题" />
                {item.children ? null : (
                  <input className="bm-input" value={eUrl} onChange={(e) => setEUrl(e.target.value)} placeholder="网址" />
                )}
                <button
                  type="button"
                  className="bm-op"
                  title="保存"
                  onClick={() => {
                    if (item.children) {
                      if (eTitle.trim()) col.updateNode(item.id, { title: eTitle.trim() });
                    } else {
                      const url = safeUrl(eUrl);
                      if (!url) return;
                      applyPatch(item.id, { title: eTitle.trim() || url, url });
                    }
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
                  <button
                    type="button"
                    className="bm-row-open"
                    title="进入子分组"
                    onClick={() => setPath(path.concat({ id: item.id, title: item.title }))}
                  >
                    🗂 {item.title || "未命名"}
                    <EnterIcon className="bm-row-enter" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="bm-row-open"
                    title="打开"
                    onClick={() => { const u = safeUrl(item.url); if (u) openUrl(u); }}
                  >
                    {item.title || item.url}
                  </button>
                )}
                <div className="bm-ops">
                  <button
                    type="button"
                    className="bm-op"
                    title="上移"
                    disabled={idx === 0}
                    onClick={() => col.moveNode(item.id, -1)}
                  >
                    <UpIcon />
                  </button>
                  <button
                    type="button"
                    className="bm-op"
                    title="下移"
                    disabled={idx === items.length - 1}
                    onClick={() => col.moveNode(item.id, 1)}
                  >
                    <DownIcon />
                  </button>
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
                    title={item.children ? "删除子分组（含内容）" : "删除"}
                    onClick={() => {
                      if (isQs) col.removeQuickSite(item.id);
                      else col.removeNode(item.id);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            )
          )}
          {items.length === 0 && <div className="bt-empty">还没有内容，用上面的表单收录</div>}
        </div>

        {!isQs && path.length === 1 && (
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
