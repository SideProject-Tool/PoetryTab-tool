/** 登录门：未登录时的全屏引导（登录 / 注册）。登录失败统一「ID 或密码不匹配」，不区分账号是否存在（防枚举） */
import { useState } from "react";
import {
  IoGridOutline as GridIcon,
  IoBookOutline as PoemIcon,
  IoCloudOutline as CloudSyncIcon,
} from "react-icons/io5";

export default function GateScreen({ col, containerRef }) {
  const [gateMsg, setGateMsg] = useState(""); // 引导门提示（自动生成 ID 等）

  let gatePrefill = "";
  try { gatePrefill = sessionStorage.getItem("gatePrefillUid") || ""; } catch {}
  const clearPrefill = () => { try { sessionStorage.removeItem("gatePrefillUid"); } catch {} };
  const readForm = () => ({
    id: (document.getElementById("gate-uid")?.value || "").trim(),
    pw: document.getElementById("gate-pw")?.value || "",
  });
  const doLogin = async () => {
    const { id, pw } = readForm();
    if (!id || !pw) { setGateMsg("请输入用户 ID 和密码"); return; }
    clearPrefill();
    setGateMsg("正在登录…");
    const r = await col.login(id, pw);
    if (!r.ok) {
      setGateMsg(
        r.code === "bad-id"
          ? "ID 需 2-32 位（字母/数字/汉字/_/-）"
          : r.code === "bad-login"
            ? "ID 或密码不匹配（新 ID 请点「新建用户」创建）"
            : "网络异常，请稍后重试"
      );
    }
  };
  const doRegister = async () => {
    const { id, pw } = readForm();
    if (!id || !pw) { setGateMsg("请输入用户 ID 和密码"); return; }
    if (pw.length < 6) { setGateMsg("密码至少 6 位"); return; }
    clearPrefill();
    setGateMsg("正在创建…");
    const r = await col.register(id, pw);
    if (!r.ok) {
      setGateMsg(
        r.code === "exists"
          ? "该 ID 已被注册，请直接登录"
          : r.code === "bad-id"
            ? "ID 需 2-32 位（字母/数字/汉字/_/-）"
            : "网络异常，请稍后重试"
      );
    }
  };
  return (
    <div className="gate-screen" ref={containerRef}>
      <div className="gate-deco" aria-hidden="true">
        詩
      </div>
      <div className="gate-card">
        <img src={`${import.meta.env.BASE_URL}icon/128.png`} alt="Poetry-Tab" className="gate-logo" />
        <h1 className="gate-title">Poetry-Tab</h1>
        <p className="gate-tagline">把古诗词和你的收藏，装进每一个新标签页</p>
        <div className="gate-features">
          <div className="gate-feature">
            <PoemIcon className="gf-ico" />
            <b>每日诗词</b>
            <i>打开即见一首古诗词</i>
          </div>
          <div className="gate-feature">
            <GridIcon className="gf-ico" />
            <b>收藏看板</b>
            <i>网站与小组件自由排布</i>
          </div>
          <div className="gate-feature">
            <CloudSyncIcon className="gf-ico" />
            <b>云同步</b>
            <i>一个 ID 多端互通</i>
          </div>
        </div>
        <div className="gate-form">
          <input
            id="gate-uid"
            className="gate-input"
            type="text"
            placeholder="输入用户 ID"
            spellCheck="false"
            autoCapitalize="off"
            autoComplete="off"
            defaultValue={gatePrefill || undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") document.getElementById("gate-pw")?.focus();
            }}
          />
          <input
            id="gate-pw"
            className="gate-input"
            type="password"
            placeholder="密码（登录或设置，至少 6 位）"
            autoComplete="new-password"
            onKeyDown={(e) => {
              if (e.key === "Enter") doLogin();
            }}
          />
          <button type="button" className="gate-btn primary" onClick={doLogin}>
            登录
          </button>
          <button type="button" className="gate-btn ghost" onClick={doRegister}>
            新建用户
          </button>
        </div>
        {gateMsg && <div className="gate-msg">{gateMsg}</div>}
        <p className="gate-hint">ID + 密码即账号，无需邮箱注册；同一账号在扩展与网页端共享</p>
      </div>
    </div>
  );
}
