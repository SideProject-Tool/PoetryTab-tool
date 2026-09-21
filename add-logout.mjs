import fs from "node:fs";

// 1) useCollection: add logout
let uc = fs.readFileSync("src/pages/newtab/hooks/useCollection.js", "utf8");
if (!uc.includes("const logout")) {
  const anchor = `  const saveNow = useCallback(async () => {
    if (!uid || !dataRef.current) return;
    await flush();
  }, [uid, flush]);`;
  if (!uc.includes(anchor)) { console.error("saveNow anchor not found"); process.exit(1); }
  uc = uc.replace(anchor, anchor + `

  const logout = useCallback(() => {
    localStorage.removeItem(UID_KEY);
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(AUTH_KEY);
    setUid("");
    setAuthToken("");
    setData(null);
    setStatus("idle");
    setError("");
    setSaveState("saved");
    setSavedAt("");
  }, []);`);
}
if (!uc.includes("logout,")) {
  uc = uc.replace(
    "    load, enter, create, saveNow,",
    "    load, enter, create, saveNow, logout,"
  );
}
fs.writeFileSync("src/pages/newtab/hooks/useCollection.js", uc);
console.log("logout fn:", uc.includes("logout,"));

// 2) SettingsPanel: add logout button + import
let sp = fs.readFileSync("src/pages/newtab/components/SettingsPanel.jsx", "utf8");
if (!sp.includes("LogoutIcon")) {
  sp = sp.replace(
    "  IoGlobeOutline as GlobeIcon,",
    "  IoGlobeOutline as GlobeIcon,\n  IoLogOutOutline as LogoutIcon,"
  );
}
if (!sp.includes("from \"../../../platform\"")) {
  sp = sp.replace(
    'import { SEARCH_ENGINES } from "../services/constants";',
    'import { SEARCH_ENGINES } from "../services/constants";\nimport { openUrl } from "../../../platform";'
  );
}
// 在「网页版」按钮后面加退出登录
const webRowEnd = `            <span className="settings-row-label">网页版</span>
            <span className="settings-row-value">打开 ↗</span>
          </button>`;
if (!sp.includes(webRowEnd)) { console.error("web row not found"); process.exit(1); }
sp = sp.replace(webRowEnd, webRowEnd + `

          <button className="settings-row" onClick={() => col.logout()} type="button" title="退出登录，返回引导页">
            <span className="settings-row-icon">
              <LogoutIcon className="w-5 h-5" />
            </span>
            <span className="settings-row-label">退出登录</span>
            <span className="settings-row-value">退出</span>
          </button>`);
fs.writeFileSync("src/pages/newtab/components/SettingsPanel.jsx", sp);
console.log("logout btn:", sp.includes("退出登录"));
