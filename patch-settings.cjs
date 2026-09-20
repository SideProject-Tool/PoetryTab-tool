const fs = require("fs");
const p = "src/pages/newtab/components/SettingsPanel.jsx";
let s = fs.readFileSync(p, "utf8");

const anchor =
  '          {showBookmarks && (\n            <button className="settings-row" onClick={onRowsCycle} type="button">';

const syncUi = [
  '          {/* 分隔线 */}',
  '          <div className="settings-divider" />',
  '',
  '          {/* 云同步 */}',
  '          <div className="settings-group-title">云同步</div>',
  '',
  '          <label className="settings-row" title="同步身份：同一 ID 在任何浏览器都能取回这份收藏夹">',
  '            <span className="settings-row-icon">',
  '              <CloudIcon className="w-5 h-5" />',
  '            </span>',
  '            <span className="settings-row-label">用户 ID</span>',
  '            <input',
  '              className="settings-text-input"',
  '              type="text"',
  '              placeholder="如 xiaoming"',
  '              value={syncUid}',
  '              onChange={(event) => handleSyncUidChange(event.target.value)}',
  '              spellCheck="false"',
  '            />',
  '          </label>',
  '',
  '          <button',
  '            className={`settings-row ${!syncUid.trim() || syncBusy ? "opacity-50 cursor-not-allowed" : ""}`}',
  '            onClick={handleSyncUpload}',
  '            disabled={!!syncBusy || !syncUid.trim()}',
  '            type="button"',
  '          >',
  '            <span className="settings-row-icon">',
  '              <UploadIcon className="w-5 h-5" />',
  '            </span>',
  '            <span className="settings-row-label">上传到云端</span>',
  '            <span className="settings-row-value">{syncBusy === "upload" ? "上传中…" : "整份备份"}</span>',
  '          </button>',
  '',
  '          <button',
  '            className={`settings-row ${!syncUid.trim() || syncBusy ? "opacity-50 cursor-not-allowed" : ""}`}',
  '            onClick={handleSyncRestore}',
  '            disabled={!!syncBusy || !syncUid.trim()}',
  '            type="button"',
  '          >',
  '            <span className="settings-row-icon">',
  '              <DownloadIcon className="w-5 h-5" />',
  '            </span>',
  '            <span className="settings-row-label">从云端恢复</span>',
  '            <span className="settings-row-value">{syncBusy === "restore" ? "恢复中…" : "合并去重"}</span>',
  '          </button>',
  '',
  '          {syncMsg && (',
  '            <div className={`settings-sync-msg ${syncMsg.startsWith("✗") ? "error" : ""}`}>{syncMsg}</div>',
  '          )}',
  '          <div className="settings-sync-hint">同一 ID 在任何 Chrome 登录即可取回收藏夹；恢复为合并去重，不删除本地书签</div>',
  '',
  anchor,
].join("\n");

if (!s.includes(anchor)) {
  console.error("锚点未找到");
  process.exit(1);
}
s = s.replace(anchor, syncUi);
fs.writeFileSync(p, s);
console.log("UI 区块已插入");
