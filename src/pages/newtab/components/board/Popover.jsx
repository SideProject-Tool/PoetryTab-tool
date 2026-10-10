import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 锚点定位浮层（portal 渲染到 body）：
 * - 脱离父级的 overflow 裁剪与 z-index 上下文，菜单在任何卡片/树/滚动容器内都完整可见可点
 * - mousedown 在浮层外关闭；Esc 关闭；点击浮层内部不冒泡
 * - 位置按锚点矩形 + 实测内容尺寸计算（视口固定定位；useLayoutEffect 绘制前校正，无闪烁），
 *   左右/底部越界自动收拢/翻转。翻转必须用真实高度——矮菜单按估算翻转会被顶到上方内容上
 */
export default function Popover({ anchor, onClose, children, minWidth = 168 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null); // 实测后的 {top,left,width}；首帧先落在锚点正下方

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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* 菜单本体（.widget-menu 等）是 absolute 子元素，wrapper 自身高度为 0，尺寸必须量子元素 */
    const child = el.firstElementChild;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let w = Math.max(minWidth, (child || el).offsetWidth || 0);
    w = Math.min(w, vw - 16);
    const h = (child || el).offsetHeight || 0;
    let left = anchor.right - w;
    if (left < 8) left = 8;
    if (left + w > vw - 8) left = vw - 8 - w;
    let top = anchor.bottom + 6;
    if (top + h + 4 > vh - 8) top = Math.max(8, anchor.top - h - 10); // 下方放不下 → 整层翻到锚点上方
    setPos({ top, left, width: w });
  }, [anchor, minWidth]);

  const style = pos
    ? { position: "fixed", top: pos.top, left: pos.left, width: pos.width }
    : { position: "fixed", top: anchor.bottom + 6, left: Math.max(8, anchor.right - minWidth), minWidth };

  return createPortal(
    <div
      ref={ref}
      className="ms-popover"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
