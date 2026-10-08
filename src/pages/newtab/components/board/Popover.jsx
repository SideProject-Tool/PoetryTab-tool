import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * 锚点定位浮层（portal 渲染到 body）：
 * - 脱离父级的 overflow 裁剪与 z-index 上下文，菜单在任何卡片/树/滚动容器内都完整可见可点
 * - mousedown 在浮层外关闭；Esc 关闭；点击浮层内部不冒泡
 * - 位置按锚点矩形计算（视口固定定位），自动防止左右/底部溢出
 */
export default function Popover({ anchor, onClose, children, minWidth = 168 }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 定位：优先锚点正下方右对齐；越界时翻转/收拢到视口内
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(minWidth, 0);
  let left = anchor.right - width;
  if (left < 8) left = 8;
  if (left + width > vw - 8) left = vw - 8 - width;
  let top = anchor.bottom + 6;
  const est = 220;
  if (top + est > vh - 8) top = Math.max(8, anchor.top - est - 6);

  return createPortal(
    <div
      ref={ref}
      className="ms-popover"
      style={{ position: "fixed", top, left, minWidth: width }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
