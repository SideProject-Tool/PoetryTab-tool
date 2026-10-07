/** 文件夹浏览浮层（子文件夹进入）：面包屑 + 瓷贴 */
import { useState } from "react";
import { IoCloseOutline as CloseIcon } from "react-icons/io5";
import { TileGrid } from "./widgets";

export default function FolderBrowser({ folderId, data, onClose }) {
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
