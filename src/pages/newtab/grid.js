/**
 * 看板网格工具：列数自适应 + 参考列数坐标系。
 * 卡片按「顺序 + 列跨度」存云端；w 以参考列数 `10` 计，渲染时按实际列数换算。
 */

export const REF_COLS = 10;

/** 按容器宽度决定列数：≥1200→10、≥900→6、≥640→4、其余→2（自适应减列） */
export function colsForWidth(w) {
  if (w >= 1200) return 10;
  if (w >= 900) return 6;
  if (w >= 640) return 4;
  return 2;
}
