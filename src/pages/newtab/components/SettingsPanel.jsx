import { useState, useCallback, useRef, useEffect } from "react";
import {
  IoSettingsOutline as SettingsIcon,
  IoMoonOutline as MoonIcon,
  IoSunnyOutline as SunIcon,
  IoBookmarksOutline as BookmarkIcon,
  IoChevronDownOutline as ChevronDownIcon,
  IoChevronUpOutline as ChevronUpIcon,
  IoSearchOutline as SearchIcon,
  IoCloudUploadOutline as UploadIcon,
  IoCloudDownloadOutline as DownloadIcon,
  IoCloudOutline as CloudIcon,
} from "react-icons/io5";
import { MdTimelapse as SyncIcon } from "react-icons/md";
import { SEARCH_ENGINES } from "../services/constants";

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

/**
 * 设置面板（云同步版）：主题 / 搜索引擎 / 书签显隐 / 用户 ID / 保存 / 展示类别
 * 全部读写云端收藏的 settings 字段，随看板自动保存
 */
export default function SettingsPanel({ col }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCatsExpanded, setIsCatsExpanded] = useState(false);
  const [uidDraft, setUidDraft] = useState(null);
  const [msg, setMsg] = useState("");
  const panelRef = useRef(null);

  const settings = {
    theme: "sync",
    engine: "baidu",
    cats: ["i"],
    showBookmarks: true,
    ...(col.data?.settings || {}),
  };

  const togglePanel = useCallback(() => setIsOpen((prev) => !prev), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

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

  const handleUidKey = async (e) => {
    if (e.key !== "Enter") return;
    const v = e.currentTarget.value.trim();
    if (!v || v === col.uid) { setUidDraft(null); return; }
    setMsg("正在加载…");
    const r = await col.enter(v);
    if (r === "notfound") {
      if (confirm(`ID「${v}」不存在，新建空收藏夹？`)) {
        await col.create(v);
        setMsg("");
      } else {
        setMsg("✗ 已取消");
      }
    } else {
      setMsg(r === "ok" ? "✓ 已打开" : "✗ " + (col.error || "加载失败"));
    }
    setUidDraft(null);
  };

  const handlePull = useCallback(async () => {
    if (!col.uid) { setMsg("✗ 先在上方填写用户 ID"); return; }
    setMsg("正在从云端拉取…");
    try {
      await col.load(col.uid);
      setMsg("✓ 已从云端重新拉取");
    } catch (e) {
      setMsg("✗ " + e.message);
    }
  }, [col]);

  const saveLabel =
    col.saveState === "saving" ? "保存中…" : col.saveState === "error" ? "保存失败，点按重试" : col.savedAt ? `已保存 ${col.savedAt.replace("T", " ").slice(11, 16)}` : "自动同步";

  const themeLabel = THEME_LABELS[settings.theme] || "跟随系统";
  const engineLabel = SEARCH_ENGINES[settings.engine]?.label || "百度";

  return (
    <div ref={panelRef} className="settings-container">
      <button className="settings-trigger" onClick={togglePanel} type="button" title="设置">
        <SettingsIcon className="w-6 h-6" />
      </button>

      {isOpen && (
        <div className="settings-popover">
          {/* 外观 */}
          <div className="settings-group-title">外观</div>

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

          {/* 云同步 */}
          <div className="settings-divider" />
          <div className="settings-group-title">云同步</div>

          <div className="settings-sync-field" title="同一 ID 在任何设备的扩展或网页登录，都是同一份收藏夹">
            <span className="settings-sync-label">
              <CloudIcon className="w-4 h-4" />
              <span>用户 ID</span>
            </span>
            <input
              className="settings-sync-input"
              type="text"
              placeholder="如 xiaoming（回车加载，新 ID 自动创建）"
              value={uidDraft !== null ? uidDraft : col.uid}
              onChange={(e) => setUidDraft(e.target.value)}
              onKeyDown={handleUidKey}
              spellCheck="false"
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

          {msg && (
            <div className={`settings-sync-msg ${msg.startsWith("✗") ? "error" : ""}`}>{msg}</div>
          )}
          <div className="settings-sync-hint">所有修改自动保存到云端；同一 ID 在网页版登录即可看到同一份收藏夹</div>

          {/* 展示类别 */}
          <div className="settings-divider" />

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
            <div className="px-3 pb-3 grid grid-cols-2 gap-x-1 gap-y-2 mt-2 max-h-[160px] overflow-y-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(85px, 1fr))" }}>
              {CATS.map((cat) => {
                const isSelected = settings.cats.includes(cat.key);
                const isDisabled = isSelected && settings.cats.length <= 1;
                return (
                  <label
                    key={cat.key}
                    className={`flex items-center space-x-2 text-sm select-none p-1.5 rounded-md transition-colors ${
                      isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-base-200/50"
                    }`}
                    title={isDisabled ? "请至少保留一个类别" : undefined}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={isSelected}
                      onChange={() => toggleCat(cat.key)}
                      disabled={isDisabled}
                      style={{ borderRadius: "0.25rem" }}
                    />
                    <span className="whitespace-nowrap">{cat.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
