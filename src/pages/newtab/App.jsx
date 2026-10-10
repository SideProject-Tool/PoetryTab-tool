import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy, Component } from "react";
import "./App.css";
import BookmarkBoard from "./components/BookmarkBoard";
import SettingsPanel from "./components/SettingsPanel";
import { useCollection } from "./hooks/useCollection";
import { FONTNAME_LIST, THEME_NAMES, SEARCH_ENGINES } from "./services/constants";
import { useContentEngine } from "./hooks/useContentEngine";
import { flattenForSearch, safeUrl } from "./services/collection";
import { openUrl } from "../../platform";
import { IoSearchOutline as SearchIcon, IoCloseOutline as CloseIcon } from "react-icons/io5";

// 搜索浮层只在呼出时才用到：按需懒加载，不占新标签页主包
const BookmarkSearch = lazy(() => import("./components/BookmarkSearch"));

/* 渲染异常兜底：数据损坏时给出可操作的恢复入口，避免整页白屏 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    window.__lastBoundaryErr = (err && (err.stack || err.message)) || String(err);
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

  /* 页面底色：按解析后的主题取浅色/深色各自的底色（空 = 主题默认），合法色号覆盖画布背景 */
  useEffect(() => {
    const dark = settings.theme === "dark" || (settings.theme === "sync" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const bg = ((dark ? settings.pageBgDark : settings.pageBgLight) || "").trim();
    const valid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(bg);
    const apply = () => {
      document.documentElement.style.background = valid ? bg : "";
      document.body.style.background = valid ? bg : "";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme, settings.pageBgLight, settings.pageBgDark]);

  useEffect(() => {
    document.title = "Poetry-Tab";
  }, []);

  /* 快捷键：S 呼出搜索（焦点在输入框时忽略） */
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

  const toggleSearch = useCallback(() => setSearchOpen((o) => !o), []);

  /* 诗词：按展示类别随机抽取（套用词库管理的自定义/隐藏/覆盖），点击换一首 */
  const { getRandomContent, currentContent } = useContentEngine(settings.cats, col.data ? col.data.poemLib : null);
  const [poem, setPoem] = useState(null);
  const [poemFading, setPoemFading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); // 默认隐藏（诗词区留白）；S 呼出 / 云端设置常驻
  const poemTimerRef = useRef(null);

  useEffect(() => {
    getRandomContent();
  }, [getRandomContent]);
  useEffect(() => {
    if (currentContent) setPoem(currentContent);
  }, [currentContent]);

  const rotatePoem = useCallback(() => {
    if (poemTimerRef.current) return; // 上一次切换的淡出还没结束，忽略连点
    setPoemFading(true);
    poemTimerRef.current = setTimeout(() => {
      poemTimerRef.current = null;
      getRandomContent();
      setPoemFading(false);
    }, 250);
  }, [getRandomContent]);
  useEffect(() => () => { if (poemTimerRef.current) clearTimeout(poemTimerRef.current); }, []);

  const engine = SEARCH_ENGINES[settings.engine] || SEARCH_ENGINES.baidu;
  const poemQuery = poem ? [poem.title, poem.from, poem.who].filter(Boolean).join(" ") : "";
  const poemSearchHref = poemQuery ? engine.url + encodeURIComponent(poemQuery.trim()) : undefined;
  const poemAttribution = poem ? poem.displayAttribution || "" : "";

  /* 全局搜索数据源：分组内全部书签（含所在分组路径） */
  const searchItems = useMemo(() => {
    if (!col.data) return [];
    return flattenForSearch(col.data.folders || []);
  }, [col.data]);

  return (
    <ErrorBoundary>
      <div id="app" className="custom-font" style={{ "--custom-font-name": FONTNAME_LIST[0] }}>
      {/* 诗词（点击换一首）；poemSpace 为区域最小高度，诗词上下居中，下方内容随之整体下移 */}
      <div
        className="pc-poem-wrap"
        onClick={rotatePoem}
        title="点一下换一首"
        style={
          settings.poemSpace > 0
            ? { minHeight: `${Math.min(600, Math.max(0, Math.round(settings.poemSpace)))}px`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }
            : undefined
        }
      >
        <div id="pc-poem" className={poemFading ? "fading" : ""}>
          {poem ? poem.title : ""}
        </div>
        <div className="pc-poem-hint">
          {poemAttribution && <span className="pc-poem-author">{poemAttribution}</span>}
          {poemSearchHref && (
            <>
              {poemAttribution && <span> · </span>}
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
        onClick={toggleSearch}
        title={searchOpen ? "关闭搜索 (Esc)" : "搜索收藏 (S)"}
        type="button"
      >
        {searchOpen ? <CloseIcon className="w-5 h-5" /> : <SearchIcon className="w-5 h-5" />}
      </button>

      {searchOpen && (
        <div className="pc-search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="pc-toolbar" onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }} onClick={(e) => e.stopPropagation()}>
            <Suspense fallback={null}>
              <BookmarkSearch items={searchItems} engine={engine} />
            </Suspense>
          </div>
        </div>
      )}

      {/* 收藏看板 */}
      <div className="board-region">
        <BookmarkBoard col={col} />
      </div>

      {/* 设置面板（右上角 ⚙，与搜索按钮并排） */}
      <SettingsPanel col={col} />

      {/* 保存状态徽标：失败/冲突时轻提示（conflict 需在设置面板手动选择上传/恢复；413 超限如实提示不再重试） */}
      {(col.saveState === "error" || col.saveState === "conflict") && (
        <div
          className={`sync-badge${col.saveState === "conflict" ? " conflict" : ""}`}
          title={col.error || ""}
        >
          {col.saveState === "conflict"
            ? "云端有更新 · 本地未同步"
            : col.oversize
              ? "数据过大 · 请导出备份并精简"
              : "未同步 · 自动重试中"}
        </div>
      )}

      {/* 删除撤销 toast：6 秒内可一键恢复 */}
      {col.undoInfo && (
        <div className="undo-toast">
          <span>{col.undoInfo.label}</span>
          <button type="button" onClick={col.undoRemove}>撤销</button>
          <button type="button" className="undo-dismiss" onClick={col.dismissUndo} title="关闭">✕</button>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
