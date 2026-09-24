import { useState, useEffect, useCallback, useMemo, Component } from "react";
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

/* 渲染异常兜底：数据损坏时给出可操作的恢复入口，避免整页白屏（每次开新标签页都复现） */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.error("Poetry-Tab 渲染异常", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="gate-screen">
          <div className="gate-card" style={{ textAlign: "center" }}>
            <h1 className="gate-title">数据异常</h1>
            <p className="gate-tagline">数据异常，可尝试从云端恢复或重置</p>
            <button
              type="button"
              className="gate-btn primary"
              onClick={() => {
                try { localStorage.clear(); } catch { /* 无痕模式等 */ }
                location.reload();
              }}
            >
              重置本地数据
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
    document.title = "Poetry-Tab";
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
    <ErrorBoundary>
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

      {/* 保存状态徽标：失败/冲突时轻提示（conflict 需在设置面板手动选择上传/恢复） */}
      {(col.saveState === "error" || col.saveState === "conflict") && (
        <div
          className={`sync-badge${col.saveState === "conflict" ? " conflict" : ""}`}
          title={col.error || ""}
        >
          {col.saveState === "conflict" ? "云端有更新 · 本地未同步" : "未同步 · 自动重试中"}
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
