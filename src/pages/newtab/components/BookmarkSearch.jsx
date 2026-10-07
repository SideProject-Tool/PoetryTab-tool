import { useState, useRef, useEffect, useMemo } from "react";


/**
 * 全局收藏搜索：实时过滤全部书签与常用网站。
 * 支持拼音全拼/首字母匹配（gh → GitHub、wb → 微博；pinyin-pro 按需加载，不进主包）。
 * Enter 打开选中项（打开后清空关键词便于连续跳转），↑↓ 切换，Esc 清空；Ctrl+点击 新标签打开
 */
import { openUrl } from "../../../platform";
import { safeUrl } from "../services/collection";

const PALETTE = ["#c96f5e", "#7b9e56", "#5e89c9", "#b0785e", "#8a6fc9", "#c95e8a", "#5eb0a5", "#c9a35e"];
function paletteColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export default function BookmarkSearch({ items = [] }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pinyinFns, setPinyinFns] = useState(null); // { pinyin } 懒加载后的模块
  const inputRef = useRef(null);
  const listRef = useRef(null);

  /* pinyin-pro 动态导入：仅搜索框挂载时才加载（独立 chunk），失败则退化为纯文本匹配 */
  useEffect(() => {
    let alive = true;
    import("pinyin-pro")
      .then((m) => { if (alive) setPinyinFns(m); })
      .catch(() => { /* 加载失败保持纯文本匹配 */ });
    return () => { alive = false; };
  }, []);

  /* 检索索引：原文 + 拼音全拼 + 首字母（仅含中文的标题才值得建拼音键） */
  const searchIndex = useMemo(() => {
    return items.map((item) => {
      const title = item.title || "";
      let fullPinyin = "";
      let initials = "";
      if (pinyinFns && /[\u4e00-\u9fa5]/.test(title)) {
        try {
          fullPinyin = pinyinFns.pinyin(title, { toneType: "none", type: "array", nonZh: "consecutive" }).join("").toLowerCase();
          initials = pinyinFns.pinyin(title, { pattern: "first", toneType: "none", type: "array" }).join("").toLowerCase();
        } catch { /* 拼音转换失败退化为原文匹配 */ }
      }
      return {
        item,
        fullPinyin,
        initials,
        hayTitle: title.toLowerCase(),
        hayUrl: (item.url || "").toLowerCase(),
        hayPath: (item.path || "").toLowerCase(),
      };
    });
  }, [items, pinyinFns]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter(
        (k) =>
          k.hayTitle.includes(q) ||
          k.hayUrl.includes(q) ||
          k.hayPath.includes(q) ||
          k.fullPinyin.includes(q) ||
          k.initials.includes(q)
      )
      .slice(0, 30)
      .map((k) => k.item);
  }, [query, searchIndex]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openItem = (item, newTab) => {
    const url = safeUrl(item.url); // 渲染/打开前复核：失效或不安全协议直接忽略
    if (!url) return;
    openUrl(url, { newTab });
    setQuery(""); // 打开后清空关键词，便于连续跳转多个结果
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
          autoFocus
          placeholder="🔍 搜索收藏（支持拼音与首字母）…"
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
