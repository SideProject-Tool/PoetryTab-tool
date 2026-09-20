import CATEGORIES from "sentences-bundle/categories.json";

// 各分类诗词库按需动态加载（独立 chunk），只加载启用的分类
const CATEGORY_LOADERS = {
  a: () => import("sentences-bundle/sentences/a.json"),
  b: () => import("sentences-bundle/sentences/b.json"),
  c: () => import("sentences-bundle/sentences/c.json"),
  d: () => import("sentences-bundle/sentences/d.json"),
  e: () => import("sentences-bundle/sentences/e.json"),
  f: () => import("sentences-bundle/sentences/f.json"),
  g: () => import("sentences-bundle/sentences/g.json"),
  h: () => import("sentences-bundle/sentences/h.json"),
  i: () => import("sentences-bundle/sentences/i.json"),
  j: () => import("sentences-bundle/sentences/j.json"),
  k: () => import("sentences-bundle/sentences/k.json"),
  l: () => import("sentences-bundle/sentences/l.json"),
};

const categoryDataCache = new Map();

async function loadCategoryData(categoryKey) {
  if (categoryDataCache.has(categoryKey)) {
    return categoryDataCache.get(categoryKey);
  }
  const loader = CATEGORY_LOADERS[categoryKey];
  if (!loader) return [];
  const mod = await loader();
  const list = Array.isArray(mod.default) ? mod.default : [];
  categoryDataCache.set(categoryKey, list);
  return list;
}

export function getCategoryInfo(categoryKey) {
  return CATEGORIES.find((cat) => cat.key === categoryKey) || { name: categoryKey, key: categoryKey };
}

function normalizeContent(content, categoryKey) {
  return {
    ...content,
    categoryKey,
    categoryName: getCategoryInfo(categoryKey).name,
    displayTitle: content.hitokoto || "",
    displaySource: content.from || "",
    displayAuthor: content.from_who || "",
  };
}

export const contentEngine = {
  /** 合并多个分类的诗词（按 uuid 去重） */
  async getContentByCategories(categories = ["i"]) {
    const seen = new Set();
    const contents = [];
    for (const cat of categories) {
      const list = await loadCategoryData(cat);
      for (const item of list) {
        if (!seen.has(item.uuid)) {
          seen.add(item.uuid);
          contents.push(normalizeContent(item, cat));
        }
      }
    }
    return contents;
  },

  /** 去掉空标题的噪声并按标题去重 */
  reduceNoise(contents) {
    const filtered = contents.filter((c) => c.displayTitle && c.displayTitle.trim() !== "");
    const deduped = [];
    const seenTitles = new Set();
    for (const content of filtered) {
      const normalizedTitle = content.displayTitle.trim().toLowerCase();
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        deduped.push(content);
      }
    }
    return deduped;
  },
};
