import { useState, useCallback, useRef } from "react";
import { contentEngine } from "../services/contentEngine";

const STORAGE_KEY_ORDER = "poemShuffledOrder";
const STORAGE_KEY_INDEX = "poemCurrentIndex";
const STORAGE_KEY_LAST_CATEGORIES = "poemLastCategories";

function formatContentForDisplay(content) {
  // 保留诗词完整原文（含标点），仅在展示时按标点对折换行
  return {
    ...content,
    title: content.displayTitle || "",
    from: content.displaySource,
    who: content.displayAuthor,
  };
}


function shuffle(arr) {
  const a = [...arr];
  for (let idx = a.length - 1; idx > 0; idx--) {
    const j = Math.floor(Math.random() * (idx + 1));
    a[idx] = a.splice(j, 1, a[idx])[0];
  }
  return a;
}

/** 分类变化后强制重新洗牌，避免旧顺序越界 */
function ensureDataFreshness(selectedCategories) {
  const storedCatsJson = localStorage.getItem(STORAGE_KEY_LAST_CATEGORIES);
  const currentCatsJson = JSON.stringify(selectedCategories);
  if (storedCatsJson !== currentCatsJson) {
    localStorage.setItem(STORAGE_KEY_LAST_CATEGORIES, currentCatsJson);
    return true;
  }
  return false;
}

function reshuffleAndSave(contents) {
  const uuids = contents.map((p) => p.uuid);
  const shuffled = shuffle(uuids);
  localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(shuffled));
  localStorage.setItem(STORAGE_KEY_INDEX, "0");
  return shuffled;
}

/**
 * 诗词引擎：按启用分类加载诗词库，顺序洗牌轮播（一轮不重复）。
 * 只暴露「当前诗词 + 换一首」两个能力。
 */
export function useContentEngine(selectedCategories = ["i"]) {
  const [currentContent, setCurrentContent] = useState(null);
  const contentsRef = useRef([]);
  const contentsCatsRef = useRef("");
  const loadTokenRef = useRef(0);

  const getRandomContent = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const catsKey = selectedCategories.join(",");
    try {
      const isUpdated = ensureDataFreshness(selectedCategories);
      let contents = contentsCatsRef.current === catsKey ? contentsRef.current : [];
      if (!contents.length) {
        const loaded = await contentEngine.getContentByCategories(selectedCategories);
        if (token !== loadTokenRef.current) return null;
        contents = contentEngine.reduceNoise(loaded);
        contentsCatsRef.current = catsKey;
        contentsRef.current = contents;
      }

      if (!contents.length) {
        const fallback = formatContentForDisplay({
          displayTitle: "欢迎使用 Poetry-Tab",
          displaySource: "",
          displayAuthor: "",
        });
        setCurrentContent(fallback);
        return fallback;
      }

      let order;
      let index;
      const storedOrder = localStorage.getItem(STORAGE_KEY_ORDER);
      index = Number.parseInt(localStorage.getItem(STORAGE_KEY_INDEX) || "0", 10);

      if (!storedOrder || isUpdated) {
        order = reshuffleAndSave(contents);
        index = 0;
      } else {
        order = JSON.parse(storedOrder);
        if (order.length !== contents.length) {
          order = reshuffleAndSave(contents);
          index = 0;
        }
      }
      if (index >= order.length) {
        order = reshuffleAndSave(contents);
        index = 0;
      }

      let content = contents.find((p) => p.uuid === order[index]);
      if (!content) {
        order = reshuffleAndSave(contents);
        content = contents.find((p) => p.uuid === order[0]) || contents[0];
      }
      localStorage.setItem(STORAGE_KEY_INDEX, String(index + 1));

      const formatted = formatContentForDisplay(content);
      setCurrentContent(formatted);
      return formatted;
    } catch (error) {
      console.error("Failed to get random content:", error);
      return null;
    }
  }, [selectedCategories]);

  return { currentContent, getRandomContent };
}
