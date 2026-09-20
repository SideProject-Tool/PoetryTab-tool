import { useState, useRef, useEffect, useMemo } from "react";


/**
 * 全局收藏搜索：实时过滤全部书签与常用网站
 * Enter 打开选中项，↑↓ 切换，Esc 清空；Ctrl+点击 新标签打开
 */
import { openUrl } from "../../../platform";

const PALETTE = ["#c96f5e", "#7b9e56", "#5e89c9", "#b0785e", "#8a6fc9", "#c95e8a", "#5eb0a5", "#c9a35e"];
function paletteColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export default function BookmarkSearch({ items = [] }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter(
        (item) =>
          (item.title || "").toLowerCase().includes(q) ||
          (item.url || "").toLowerCase().includes(q) ||
          (item.path || "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [query, items]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openItem = (item, newTab) => {
    if (!item?.url) return;
    openUrl(item.url, { newTab });
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openItem(results[activeIndex] || results[0], e.ctrlKey || e.metaKey);
    } else if (e.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const showDropdown = query.trim() !== "" && results.length > 0;

  return (
    <div className="bookmark-search-wrapper">
      <div className="bookmark-search-box">
        <input
          ref={inputRef}
          type="text"
          className="bookmark-search-input"
          placeholder="🔍 搜索收藏…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck="false"
        />
        {query && (
          <button
            className="bookmark-search-clear"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            type="button"
            title="清空"
          >
            ✕
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="bookmark-search-dropdown" ref={listRef}>
          {results.map((item, index) => {
            const letter = (item.title || "?").trim().charAt(0).toUpperCase();
            const tint = paletteColor(item.title || "");
            return (
              <button
                key={item.id}
                type="button"
                className={`bookmark-search-row ${index === activeIndex ? "active" : ""}`}
                onClick={(e) => openItem(item, e.ctrlKey || e.metaKey)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="bt-icon" style={{ width: "1.15rem", height: "1.15rem", fontSize: "0.6rem", color: tint, background: tint + "1c" }}>
                  {letter}
                </span>
                <span className="bt-label" style={{ maxWidth: "13rem" }}>{item.title}</span>
                {item.path && <span className="bookmark-search-path">{item.path}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
