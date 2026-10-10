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

// 「佚名/无名氏/无名者/原创」视为未署名，不作为作者或出处展示
const PLACEHOLDER_VALUES = new Set(["", "佚名", "无名氏", "无名者", "原创"]);

function nonPlaceholder(value) {
  const trimmed = (value || "").trim();
  return PLACEHOLDER_VALUES.has(trimmed) ? "" : trimmed;
}

/** 署名行：优先作者「— 作者 —」，无作者回退作品名「— 《作品名》 —」，两者皆缺为空 */
function buildAttribution(fromWho, from) {
  const author = nonPlaceholder(fromWho);
  if (author) return `— ${author} —`;
  const source = nonPlaceholder(from);
  if (source) return `— 《${source}》 —`;
  return "";
}

function normalizeContent(content, categoryKey) {
  return {
    ...content,
    categoryKey,
    categoryName: getCategoryInfo(categoryKey).name,
    displayTitle: content.hitokoto || "",
    displaySource: content.from || "",
    displayAuthor: content.from_who || "",
    displayAttribution: buildAttribution(content.from_who, content.from),
  };
}

export const contentEngine = {
  /**
   * 合并多个分类的诗词（按 uuid 去重），并套用用户词库 poemLib：
   * 内置列表 → 剔除 hidden → 命中 edits 的按 content/author/source 覆盖 → 追加已启用分类的自定义词条
   */
  async getContentByCategories(categories = ["i"], poemLib = null) {
    const seen = new Set();
    const hidden = new Set(poemLib?.hidden || []);
    const edits = poemLib?.edits || {};
    const customs = poemLib?.custom || [];
    const catSet = new Set(categories);
    const contents = [];
    for (const cat of categories) {
      const list = await loadCategoryData(cat);
      for (const item of list) {
        if (seen.has(item.uuid) || hidden.has(item.uuid)) continue;
        seen.add(item.uuid);
        const e = edits[item.uuid];
        contents.push(
          normalizeContent(
            e ? { ...item, hitokoto: e.content, from_who: e.author, from: e.source } : item,
            cat
          )
        );
      }
    }
    for (const c of customs) {
      if (catSet.has(c.cat) && !seen.has(c.uuid)) {
        seen.add(c.uuid);
        contents.push(
          normalizeContent({ uuid: c.uuid, hitokoto: c.content, from_who: c.author, from: c.source }, c.cat)
        );
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
