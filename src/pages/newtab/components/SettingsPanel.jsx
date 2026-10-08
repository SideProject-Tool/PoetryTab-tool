import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  IoSettingsOutline as SettingsIcon,
  IoMoonOutline as MoonIcon,
  IoSunnyOutline as SunIcon,
  IoChevronDownOutline as ChevronDownIcon,
  IoChevronUpOutline as ChevronUpIcon,
  IoSearchOutline as SearchIcon,
  IoCloudUploadOutline as UploadIcon,
  IoCloudDownloadOutline as DownloadIcon,
  IoCloudOutline as CloudIcon,
  IoGlobeOutline as GlobeIcon,
  IoLogOutOutline as LogoutIcon,
  IoDownloadOutline as FileDownloadIcon,
  IoBookmarksOutline as BookmarksIcon,
  IoTimeOutline as TimeIcon,
  IoArrowUndoOutline as UndoIcon,
  IoCloseOutline as CloseIcon,
} from "react-icons/io5";
import { MdTimelapse as SyncIcon } from "react-icons/md";
import { SEARCH_ENGINES } from "../services/constants";
import { openUrl, getBrowserBookmarks, IS_EXT } from "../../../platform";
import { parseNetscapeHtml } from "../services/bookmarks";

const THEME_LABELS = { sync: "跟随系统", light: "浅色", dark: "深色" };
const ENGINE_KEYS = Object.keys(SEARCH_ENGINES);
const CATS = [
  { key: "a", name: "动画" },
  { key: "b", name: "漫画" },
  { key: "c", name: "游戏" },
  { key: "d", name: "文学" },
  { key: "e", name: "原创" },
  { key: "f", name: "网络" },
  { key: "g", name: "其他" },
  { key: "h", name: "影视" },
  { key: "i", name: "诗词" },
  { key: "j", name: "网易云" },
  { key: "k", name: "哲学" },
  { key: "l", name: "抖机灵" },
];
const TABS = [
  { key: "look", label: "外观" },
  { key: "sync", label: "云同步" },
  { key: "data", label: "导入与备份" },
];

/**
 * 设置弹窗（居中 + 三 tab）：外观 / 云同步 / 导入与备份。
 * 全部读写云端收藏的 settings 字段，随看板自动保存。
 */
export default function SettingsPanel({ col }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState("look");
  const [isCatsExpanded, setIsCatsExpanded] = useState(false);
  const [isCardsExpanded, setIsCardsExpanded] = useState(false);
  const [poemExpanded, setPoemExpanded] = useState(false);
  const [isSnapsExpanded, setIsSnapsExpanded] = useState(false);
  const [snaps, setSnaps] = useState(null); // null=未加载 []=空
  const [confirmSnapKey, setConfirmSnapKey] = useState("");
  const [uidDraft, setUidDraft] = useState(null);
  const [msg, setMsg] = useState("");
  const htmlInputRef = useRef(null);
  const jsonInputRef = useRef(null);

  const settings = {
    theme: "sync",
    engine: "baidu",
    cats: ["i"],
    showSearch: false,
    hiddenCards: [],
    ...(col.data?.settings || {}),
  };
  const hiddenCards = Array.isArray(settings.hiddenCards) ? settings.hiddenCards : [];

  /* 卡片显隐候选清单（与看板 widgetDefs 的 id 规则一致） */
  const cards = useMemo(() => {
    const list = [{ id: "qs:quicksites", title: "常用网站" }];
    for (const f of col.data?.folders || []) list.push({ id: "f:" + f.id, title: f.title || "未命名分组" });
    for (const w of col.data?.iframeWidgets || []) list.push({ id: "w:" + w.id, title: w.title || "小部件" });
    return list;
  }, [col.data]);

  const close = useCallback(() => setIsOpen(false), []);

  /* Esc 关闭弹窗 */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const cycleTheme = () =>
    col.setSettings({ theme: settings.theme === "sync" ? "light" : settings.theme === "light" ? "dark" : "sync" });
  const cycleEngine = () => {
    const next = ENGINE_KEYS[(ENGINE_KEYS.indexOf(settings.engine) + 1) % ENGINE_KEYS.length];
    col.setSettings({ engine: next });
  };
  const toggleCat = (key) => {
    const cats = [...settings.cats];
    const idx = cats.indexOf(key);
    if (idx >= 0) {
      if (cats.length <= 1) return;
      cats.splice(idx, 1);
    } else cats.push(key);
    col.setSettings({ cats });
  };
  const toggleHiddenCard = (id) => {
    col.setSettings({ hiddenCards: hiddenCards.includes(id) ? hiddenCards.filter((x) => x !== id) : [...hiddenCards, id] });
  };

  /* 诗词区留白：0=自动（自然高度）；自定义 1-600 钳位，非法回退 */
  const POEM_SPACE_PRESETS = [240, 360, 480];
  const poemSpace = Math.max(0, Math.round(Number(settings.poemSpace) || 0));
  const [poemDraft, setPoemDraft] = useState(null);
  const commitPoemSpace = () => {
    setPoemDraft((draft) => {
      if (draft === null || draft === "") return null;
      const n = Math.round(Number(draft));
      col.setSettings({ poemSpace: Number.isFinite(n) ? Math.min(600, Math.max(0, n)) : 0 });
      return null;
    });
  };
  const poemSpaceLabel = poemSpace === 0 ? "自动" : `${poemSpace}px`;

  const handleUidKey = (e) => {
    if (e.key !== "Enter") return;
    const v = e.currentTarget.value.trim();
    if (!v || v === col.uid) { setUidDraft(null); return; }
    // 切换 ID：退出到引导门并预填新 ID，密码在引导门输入（受保护账号必须验密码）
    try { sessionStorage.setItem("gatePrefillUid", v); } catch {}
    col.logout();
    setUidDraft(null);
    close();
  };

  const handlePull = useCallback(async () => {
    if (!col.uid) { setMsg("✗ 尚未登录"); return; }
    setMsg("正在从云端拉取…");
    const r = await col.reload(); // 用返回值判定成败，避免读到过期的 state 快照
    setMsg(r && r.ok ? "✓ 已从云端重新拉取" : "✗ " + ((r && r.error) || "拉取失败"));
  }, [col]);

  /* 导入浏览器书签（扩展端 chrome.bookmarks 树；重复 URL 自动跳过） */
  const handleImportBrowser = async () => {
    setMsg("正在读取浏览器书签…");
    try {
      const tree = await getBrowserBookmarks();
      if (!tree) { setMsg("✗ 当前环境不支持读取浏览器书签"); return; }
      const r = await col.importBookmarks(tree);
      setMsg(
        r.ok
          ? `✓ 已导入 ${r.count} 条${r.skipped ? `，跳过 ${r.skipped} 条重复` : ""}（新分组追加在最后）`
          : "✗ " + r.error
      );
    } catch (e) {
      setMsg("✗ 读取书签失败：" + (e && e.message ? e.message : "未知错误"));
    }
  };

  /* 导入书签 HTML 文件（Chrome/Firefox/Edge 导出格式） */
  const handleHtmlFile = async (file) => {
    if (!file) return;
    setMsg("正在解析书签文件…");
    try {
      const text = await file.text();
      const tree = parseNetscapeHtml(text);
      const r = await col.importBookmarks(tree);
      setMsg(r.ok ? `✓ 已从文件导入 ${r.count} 条${r.skipped ? `，跳过 ${r.skipped} 条重复` : ""}` : "✗ " + r.error);
    } catch {
      setMsg("✗ 书签文件解析失败，请确认是浏览器导出的 HTML");
    }
  };

  /* 导出备份（JSON 下载） */
  const handleExport = () => {
    if (!col.data) { setMsg("✗ 暂无可导出的数据"); return; }
    const payload = { app: "poetry-tab", version: 1, exportedAt: new Date().toISOString(), data: col.data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `poetry-tab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setMsg("✓ 备份已下载");
  };

  /* 恢复备份（整份替换 + 立即上传） */
  const handleJsonFile = async (file) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = parsed && parsed.app === "poetry-tab" ? parsed.data : parsed;
      if (!imported || !Array.isArray(imported.folders)) { setMsg("✗ 不是有效的备份文件"); return; }
      if (!window.confirm("恢复备份将整份替换当前收藏并上传云端，确定继续？")) { setMsg(""); return; }
      const r = await col.replaceAll(imported);
      setMsg(r.ok ? "✓ 备份已恢复并上传" : "✗ " + r.error);
    } catch {
      setMsg("✗ 备份文件解析失败");
    }
  };

  /* 历史版本：展开时拉列表，点恢复两步确认 */
  const toggleSnaps = async () => {
    const next = !isSnapsExpanded;
    setIsSnapsExpanded(next);
    if (next && !snaps) {
      setSnaps([]);
      const r = await col.listSnaps();
      setSnaps(r.ok ? r.snaps : null);
      if (!r.ok) setMsg("✗ 快照列表拉取失败：" + r.error);
    }
  };
  const handleRestoreSnap = async (key) => {
    setMsg("正在恢复历史版本…");
    const r = await col.restoreSnap(key);
    setConfirmSnapKey("");
    setMsg(r.ok ? "✓ 已恢复该历史版本（本次恢复也留了快照，可再撤销）" : "✗ " + r.error);
  };

  const fmtTime = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
  };

  const saveLabel =
    col.saveState === "saving"
      ? "保存中…"
      : col.saveState === "error"
        ? "保存失败，点按重试"
        : col.saveState === "conflict"
          ? "云端有更新，点此以本地为准"
          : col.savedAt
            ? `已保存 ${new Date(col.savedAt).toLocaleTimeString()}`
            : "自动同步";

  const themeLabel = THEME_LABELS[settings.theme] || "跟随系统";
  const engineLabel = SEARCH_ENGINES[settings.engine]?.label || "百度";

  return (
    <div className="settings-container">
      <button className="settings-trigger" onClick={() => setIsOpen(true)} type="button" title="设置">
        <SettingsIcon className="w-6 h-6" />
      </button>

      {isOpen && (
        <div className="bf-overlay" onClick={close}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">设置</h3>
              <button type="button" className="bf-close" onClick={close} title="关闭 (Esc)">
                <CloseIcon />
              </button>
            </div>
            <div className="settings-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`settings-tab ${tab === t.key ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="settings-modal-body">
              {/* ===== 外观 ===== */}
              {tab === "look" && (
                <>
                  <button className="settings-row" onClick={cycleTheme} type="button">
                    <span className="settings-row-icon">
                      {settings.theme === "light" && <SunIcon className="w-5 h-5" />}
                      {settings.theme === "dark" && <MoonIcon className="w-5 h-5" />}
                      {settings.theme === "sync" && <SyncIcon className="w-5 h-5" />}
                    </span>
                    <span className="settings-row-label">主题</span>
                    <span className="settings-row-value">{themeLabel}</span>
                  </button>

                  <button className="settings-row" onClick={cycleEngine} type="button">
                    <span className="settings-row-icon">
                      <SearchIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">搜索引擎</span>
                    <span className="settings-row-value">{engineLabel}</span>
                  </button>

                  <button
                    className="settings-row"
                    onClick={() => col.setSettings({ showSearch: !settings.showSearch })}
                    type="button"
                    title="开启后搜索栏常驻页面顶部；关闭时点右上角 🔍 或按 S 呼出"
                  >
                    <span className="settings-row-icon">
                      <SearchIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">搜索栏常驻</span>
                    <span className={`settings-switch ${settings.showSearch ? "on" : ""}`}>
                      <span className="settings-switch-knob" />
                    </span>
                  </button>

                  {/* 看板列数：自动（按窗口宽度 5/4/3/2）或固定 2-5；手机恒为单列 */}
                  <button
                    className="settings-row"
                    onClick={() => {
                      const order = ["auto", 2, 3, 4, 5];
                      const cur = settings.cols === "auto" || Number(settings.cols) >= 2 ? settings.cols : "auto";
                      col.setSettings({ cols: order[(order.indexOf(cur) + 1) % order.length] });
                    }}
                    type="button"
                    title="自动按窗口宽度取 5/4/3/2 列；固定列数全设备一致（手机恒为单列）"
                  >
                    <span className="settings-row-icon">
                      <BookmarksIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">看板列数</span>
                    <span className="settings-row-value">
                      {settings.cols === "auto" || !Number(settings.cols) ? "自动" : `${settings.cols} 列`}
                    </span>
                  </button>

                  {/* 诗词区留白：区域最小高度，诗词上下居中，下方内容整体下移 */}
                  <button
                    className="settings-row"
                    onClick={() => setPoemExpanded((prev) => !prev)}
                    type="button"
                    title="加大后诗词在区域内居中，下方内容整体下移"
                  >
                    <span className="settings-row-icon">
                      <BookmarksIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">诗词区留白</span>
                    <span className="settings-row-value">{poemSpaceLabel}</span>
                  </button>
                  {poemExpanded && (
                    <div className="settings-poem-space">
                      <div className="widget-menu-heights">
                        {[0, ...POEM_SPACE_PRESETS].map((px) => (
                          <button
                            key={px}
                            type="button"
                            className={`widget-h-chip${poemSpace === px ? " on" : ""}`}
                            onClick={() => { col.setSettings({ poemSpace: px }); setPoemDraft(null); }}
                          >
                            {px === 0 ? "自动" : px}
                          </button>
                        ))}
                      </div>
                      <input
                        className="widget-h-input"
                        type="number"
                        min={0}
                        max={600}
                        step={10}
                        placeholder="自定义像素（0-600）…"
                        value={poemDraft ?? ""}
                        onChange={(e) => setPoemDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitPoemSpace();
                          if (e.key === "Escape") setPoemDraft(null);
                        }}
                        onBlur={commitPoemSpace}
                      />
                    </div>
                  )}

                  <button
                    className="settings-row"
                    onClick={() => setIsCatsExpanded((prev) => !prev)}
                    type="button"
                  >
                    <span className="settings-row-icon">
                      {isCatsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                    </span>
                    <span className="settings-row-label">展示类别</span>
                    <span className="settings-row-value">{settings.cats.length} 项</span>
                  </button>
                  {isCatsExpanded && (
                    <div className="settings-cats">
                      {CATS.map((cat) => {
                        const isSelected = settings.cats.includes(cat.key);
                        const isDisabled = isSelected && settings.cats.length <= 1;
                        return (
                          <button
                            key={cat.key}
                            type="button"
                            className={`settings-cat ${isSelected ? "on" : ""}`}
                            onClick={() => toggleCat(cat.key)}
                            disabled={isDisabled}
                            style={isDisabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                            title={isDisabled ? "请至少保留一个类别" : cat.name}
                          >
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 卡片显隐 */}
                  <button
                    className="settings-row"
                    onClick={() => setIsCardsExpanded((prev) => !prev)}
                    type="button"
                  >
                    <span className="settings-row-icon">
                      {isCardsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                    </span>
                    <span className="settings-row-label">卡片显隐</span>
                    <span className="settings-row-value">{cards.length - hiddenCards.length} / {cards.length} 显示</span>
                  </button>
                  {isCardsExpanded && (
                    <div className="settings-cards">
                      {cards.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`settings-card-row ${hiddenCards.includes(c.id) ? "off" : ""}`}
                          onClick={() => toggleHiddenCard(c.id)}
                          title={hiddenCards.includes(c.id) ? "点击显示这张卡片" : "点击隐藏这张卡片"}
                        >
                          <span className="settings-card-title">{c.title}</span>
                          <span className={`settings-switch small ${hiddenCards.includes(c.id) ? "" : "on"}`}>
                            <span className="settings-switch-knob" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ===== 云同步 ===== */}
              {tab === "sync" && (
                <>
                  {col.saveState === "conflict" && (
                    <div className="settings-conflict-tip">
                      云端有其他设备的修改，且本地有未同步的改动。请选择：
                      「上传到云端」以本地为准，或「从云端恢复」以云端为准。
                    </div>
                  )}

                  <div className="settings-sync-field" title="同一 ID 在任何设备的扩展或网页登录，都是同一份收藏夹">
                    <span className="settings-sync-label">
                      <CloudIcon className="w-4 h-4" />
                      <span>用户 ID</span>
                    </span>
                    <input
                      className="settings-sync-input"
                      type="text"
                      placeholder="当前 ID；输入新 ID 回车切换登录"
                      value={uidDraft !== null ? uidDraft : col.uid}
                      onChange={(e) => setUidDraft(e.target.value)}
                      onKeyDown={handleUidKey}
                      spellCheck="false"
                      autoComplete="off"
                    />
                  </div>

                  <button
                    className={`settings-row ${col.saveState === "saving" ? "opacity-60" : ""}`}
                    onClick={() => col.saveNow()}
                    type="button"
                  >
                    <span className="settings-row-icon">
                      <UploadIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">上传到云端</span>
                    <span className="settings-row-value">{saveLabel}</span>
                  </button>

                  <button className="settings-row" onClick={handlePull} type="button">
                    <span className="settings-row-icon">
                      <DownloadIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">从云端恢复</span>
                    <span className="settings-row-value">重新拉取</span>
                  </button>

                  <button
                    className="settings-row"
                    onClick={() => openUrl("https://sync.pathmemos.com")}
                    type="button"
                    title="在浏览器中打开网页版"
                  >
                    <span className="settings-row-icon">
                      <GlobeIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">网页版</span>
                    <span className="settings-row-value">打开 ↗</span>
                  </button>

                  <button className="settings-row" onClick={() => { col.logout(); close(); }} type="button" title="退出登录，返回引导页">
                    <span className="settings-row-icon">
                      <LogoutIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">退出登录</span>
                    <span className="settings-row-value">退出</span>
                  </button>

                  <div className="settings-sync-hint">所有修改自动保存到云端；同一 ID 在网页版登录即可看到同一份收藏夹</div>
                </>
              )}

              {/* ===== 导入与备份 ===== */}
              {tab === "data" && (
                <>
                  {IS_EXT && (
                    <button className="settings-row" onClick={handleImportBrowser} type="button">
                      <span className="settings-row-icon">
                        <BookmarksIcon className="w-5 h-5" />
                      </span>
                      <span className="settings-row-label">导入浏览器书签</span>
                      <span className="settings-row-value">追加为新分组</span>
                    </button>
                  )}

                  <button className="settings-row" onClick={() => htmlInputRef.current?.click()} type="button">
                    <span className="settings-row-icon">
                      <BookmarksIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">导入书签文件</span>
                    <span className="settings-row-value">HTML</span>
                  </button>
                  <input
                    ref={htmlInputRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    hidden
                    onChange={(e) => { handleHtmlFile(e.target.files?.[0]); e.target.value = ""; }}
                  />

                  <button className="settings-row" onClick={handleExport} type="button">
                    <span className="settings-row-icon">
                      <FileDownloadIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">导出备份</span>
                    <span className="settings-row-value">JSON 下载</span>
                  </button>

                  <button className="settings-row" onClick={() => jsonInputRef.current?.click()} type="button">
                    <span className="settings-row-icon">
                      <UndoIcon className="w-5 h-5" />
                    </span>
                    <span className="settings-row-label">恢复备份</span>
                    <span className="settings-row-value">整份替换</span>
                  </button>
                  <input
                    ref={jsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(e) => { handleJsonFile(e.target.files?.[0]); e.target.value = ""; }}
                  />

                  <button className="settings-row" onClick={toggleSnaps} type="button">
                    <span className="settings-row-icon">
                      {isSnapsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                    </span>
                    <span className="settings-row-label">历史版本</span>
                    <span className="settings-row-value">
                      <TimeIcon className="w-3.5 h-3.5 inline" /> 云端快照
                    </span>
                  </button>

                  {isSnapsExpanded && (
                    <div className="settings-snaps">
                      {snaps === null && <div className="settings-snap-empty">快照加载失败，收起后重试</div>}
                      {snaps && snaps.length === 0 && <div className="settings-snap-empty">还没有快照（每次云端保存自动留存，最多 5 份）</div>}
                      {snaps &&
                        snaps.map((s) => (
                          <div key={s.key} className="settings-snap-row">
                            <span className="settings-snap-time">{fmtTime(s.at)}</span>
                            {confirmSnapKey === s.key ? (
                              <button
                                type="button"
                                id="snap-restore-confirm"
                                className="settings-snap-op confirming"
                                onClick={() => handleRestoreSnap(s.key)}
                              >
                                再点一次确认恢复
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="settings-snap-op"
                                onClick={() => setConfirmSnapKey(s.key)}
                              >
                                恢复
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {msg && (
              <div className={`settings-sync-msg ${msg.startsWith("✗") ? "error" : ""}`}>{msg}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
