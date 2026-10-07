/**
 * 看板网格工具：列数自适应 + 列式布局常量。
 * v2 布局模型：卡片只属于某一列（无自由坐标），云端 layout = { v: 2, cols: [[卡id], [卡id], ...] }，
 * 槽位固定 5 个（参考列数），不同设备按自己的列数取前 N 列、溢出列并入末列。
 */

export const REF_SLOTS = 5; /* 云端布局槽位数（各设备列数 ≤ 此值） */

/** 自动列数：≥1200→5、≥980→4、≥760→3、≥640→2、其余→1（手机单列，拖拽停用） */
export function colsForWidth(w) {
  if (w >= 1200) return 5;
  if (w >= 980) return 4;
  if (w >= 760) return 3;
  if (w >= 640) return 2;
  return 1;
}
