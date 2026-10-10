import { useState, useCallback, Suspense, lazy } from "react";
import { IoSettingsOutline as SettingsIcon } from "react-icons/io5";

const SettingsModal = lazy(() => import("./SettingsModal"));

/**
 * 设置入口（齿轮按钮常驻主包）：点开后才按需加载设置弹窗主体（SettingsModal，含词库管理等重内容），
 * 压缩新标签页主包体积、加快首帧。
 */
export default function SettingsPanel({ col }) {
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <div className="settings-container">
      <button className="settings-trigger" onClick={() => setIsOpen(true)} type="button" title="设置">
        <SettingsIcon className="w-6 h-6" />
      </button>

      {isOpen && (
        <Suspense fallback={null}>
          <SettingsModal col={col} onClose={close} />
        </Suspense>
      )}
    </div>
  );
}
