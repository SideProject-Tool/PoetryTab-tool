/**
 * 看板布局引擎（v2 列式模型）：纯函数，无 DOM 测量、无绝对定位。
 *
 * 云端 layout 形状：{ v: 2, cols: [[卡片id...], [卡片id...], ...] }，固定 REF_SLOTS 个槽位。
 * - 渲染：设备按列数 N 取前 N 列；槽位 N-1 之后的溢出列按顺序并入第 N-1 列（末列）
 * - 兼容：旧格式显式坐标数组 [{i,x,y,w,h}] 按阅读顺序聚类进列，启动检测到旧格式即回写当前格式
 * - 新卡片：追加到最短的列（视觉均衡），iframe 卡片带默认高度
 */
import { REF_SLOTS } from "../../grid";

export const GAP = 14; /* 卡片与列间距 */

/* iframe 卡默认最小高度（用户可在 ⋯ 菜单改档位，存 widget.h） */
export function defaultCardH(id) {
  return id.startsWith("w:") ? 420 : 0;
}

/** 校验/归一 v2 layout：固定 5 槽、元素必须是字符串 id、去重 */
export function normalizeLayout(layout, knownIds) {
  const slots = Array.isArray(layout?.cols) ? layout.cols : [];
  const seen = new Set();
  const cols = [];
  for (let c = 0; c < REF_SLOTS; c++) {
    const arr = Array.isArray(slots[c]) ? slots[c] : [];
    const clean = [];
    for (const id of arr) {
      if (typeof id === "string" && knownIds.has(id) && !seen.has(id)) {
        seen.add(id);
        clean.push(id);
      }
    }
    cols.push(clean);
  }
  // 数据里存在但布局中没有的卡片（新建/导入）→ 追加到最短列
  for (const id of knownIds) {
    if (!seen.has(id)) {
      let best = 0;
      for (let c = 1; c < REF_SLOTS; c++) if (cols[c].length < cols[best].length) best = c;
      cols[best].push(id);
      seen.add(id);
    }
  }
  return cols;
}

/** 旧格式显式坐标 → 列式布局（按 y→x 阅读顺序逐卡入列；x 以参考 10 列折算槽位） */
export function migrateV1Layout(stored, knownIds) {
  const entries = (Array.isArray(stored) ? stored : []).filter((e) => e && typeof e.i === "string" && knownIds.has(e.i));
  const seen = new Set(entries.map((e) => e.i));
  const sorted = [...entries].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const cols = [[], [], [], [], []];
  for (const e of sorted) {
    const slot = Math.max(0, Math.min(REF_SLOTS - 1, Math.round((e.x || 0) / 2)));
    cols[slot].push(e.i);
  }
  for (const id of knownIds) {
    if (!seen.has(id)) {
      let best = 0;
      for (let c = 1; c < REF_SLOTS; c++) if (cols[c].length < cols[best].length) best = c;
      cols[best].push(id);
    }
  }
  return cols;
}

/** 设备列数 N → 实际渲染列（溢出槽位并入末列） */
export function visibleColumns(cols, n) {
  const count = Math.max(1, Math.min(REF_SLOTS, n));
  const out = [];
  for (let c = 0; c < count - 1; c++) out.push([...cols[c]]);
  const last = [];
  for (let c = count - 1; c < REF_SLOTS; c++) last.push(...cols[c]);
  out.push(last);
  return out;
}

/** 渲染列 → 回写云端 5 槽（前 N-1 列直写，末列之后的槽位清空） */
export function columnsToLayout(visible, heights) {
  void heights; // 卡片高度不入布局：内容自适应，iframe 用 widget.h
  const cols = [];
  for (let c = 0; c < REF_SLOTS; c++) cols.push([]);
  visible.forEach((col, idx) => {
    cols[Math.min(idx, REF_SLOTS - 1)] = [...col];
  });
  return { v: 2, cols };
}
