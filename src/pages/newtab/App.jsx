import { useState, useEffect, useCallback, useMemo } from "react";
import "./App.css";
import BookmarkSearch from "./components/BookmarkSearch";
import BookmarkBoard from "./components/BookmarkBoard";
import SettingsPanel from "./components/SettingsPanel";
import { useCollection } from "./hooks/useCollection";
import { FONTNAME_LIST } from "./services/constants";
import { useContentEngine } from "./hooks/useContentEngine";
import { flattenForSearch } from "./services/collection";
import { SEARCH_ENGINES } from "./services/constants";
import { IoSearchOutline as SearchIcon, IoCloseOutline as CloseIcon } from "react-icons/io5";


const THEME_NAMES = { light: "cupcake", dark: "halloween" };

export default function App() {
  const col = useCollection();

  const settings = useMemo(
    () => ({
      theme: "sync",
      engine: "baidu",
      cats: ["i"],
      ...(col.data?.settings || {}),
    }),
    [col.data]
  );

  /* 主题：由收藏设置驱动（跟随系统 / 浅色 / 深色） */
  const applyTheme = useCallback((t) => {
    const resolved =
      t === "sync"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : t;
    document.documentElement.setAttribute("data-theme", THEME_NAMES[resolved] || "cupcake");
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme(settings.theme);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [settings.theme, applyTheme]);

  useEffect(() => {
    document.title = navigator.languages.includes("zh") ? "新标签页" : "New Tab";
  }, []);

  /* 快捷键 S：呼出搜索（焦点在输入框时忽略） */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* 诗词：按展示类别随机抽取，点击换一首 */
  const { getRandomContent, currentContent } = useContentEngine(settings.cats);
  const [poem, setPoem] = useState(null);
  const [poemFading, setPoemFading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); // 搜索框默认隐藏，右上角按钮呼出

  useEffect(() => {
    getRandomContent();
  }, [getRandomContent]);
  useEffect(() => {
    if (currentContent) setPoem(currentContent);
  }, [currentContent]);

  const rotatePoem = useCallback(() => {
    setPoemFading(true);
    setTimeout(() => {
      getRandomContent();
      setPoemFading(false);
    }, 250);
  }, [getRandomContent]);

  const engine = SEARCH_ENGINES[settings.engine] || SEARCH_ENGINES.baidu;
  const poemQuery = poem ? [poem.title, poem.from, poem.who].filter(Boolean).join(" ") : "";
  const poemSearchHref = poemQuery ? engine.url + encodeURIComponent(poemQuery.trim()) : undefined;

  /* 全局搜索数据源：收藏夹全量 + 常用网站 */
  const searchItems = useMemo(() => {
    if (!col.data) return [];
    return [
      ...flattenForSearch(col.data.folders || []),
      ...(col.data.quickSites || []).map((s) => ({ ...s, path: "常用网站" })),
    ];
  }, [col.data]);

  return (
    <div id="app" className="custom-font" style={{ "--custom-font-name": FONTNAME_LIST[0] }}>
      {/* 诗词（点击换一首） */}
      <div className="pc-poem-wrap" onClick={rotatePoem} title="点一下换一首">
        <div id="pc-poem" className={poemFading ? "fading" : ""}>
          {poem ? poem.title : ""}
        </div>
        <div className="pc-poem-hint">
          <span>— 点一下换一首 —</span>
          {poemSearchHref && (
            <>
              <span> · </span>
              <a
                className="pc-poem-search"
                href={poemSearchHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                🔍 查出处
              </a>
            </>
          )}
        </div>
      </div>

      {/* 搜索开关（右上角，默认隐藏搜索框） */}
      <button
        className="search-toggle"
        onClick={() => setSearchOpen((o) => !o)}
        title={searchOpen ? "关闭搜索 (Esc)" : "搜索收藏 (S)"}
        type="button"
      >
        {searchOpen ? <CloseIcon className="w-5 h-5" /> : <SearchIcon className="w-5 h-5" />}
      </button>

      {searchOpen && (
        <div className="pc-toolbar" onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }}>
          <BookmarkSearch items={searchItems} />
        </div>
      )}

      {/* 收藏看板 */}
      <div className="board-region">
        <BookmarkBoard col={col} />
      </div>

      {/* 设置面板（右上角 ⚙，与搜索按钮并排） */}
      <SettingsPanel col={col} />
    </div>
  );
}
