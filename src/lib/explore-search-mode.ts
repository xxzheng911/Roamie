export type ExploreSearchMode = "global_place" | "nearby_category";

const NEARBY_CATEGORY_RE =
  /^(咖啡廳|咖啡店|咖啡|拉麵|拉麵店|公園|飯店|旅館|民宿|餐廳|美食|小吃|早餐|宵夜|酒吧|便利商店|超市|藥局|加油站|書店|健身房|超市|mall|cafe|coffee|restaurant|hotel|park|bar|ramen|food|shop|store)s?$/i;

const NEARBY_CATEGORY_SUFFIX_RE =
  /(咖啡廳|咖啡店|餐廳|飯店|旅館|民宿|公園|小吃店|拉麵店|酒吧|超商|藥局|加油站|書店)$/i;

/** 連鎖品牌：偏向附近搜尋 */
const NEARBY_BRAND_RE =
  /^(starbucks|星巴克|7-?eleven|全家|lawson|麥當勞|mcdonald|肯德基|kfc|摩斯|mos burger)$/i;

const GLOBAL_LANDMARK_HINT_RE =
  /富士山|東京鐵塔|台北101|淺草寺|清水寺|大阪城|哈利波特|stellar\s*garden|mount\s*fuji|tokyo\s*tower|taipei\s*101|sensoji|kiyomizu|osaka\s*castle/i;

export function detectExploreSearchMode(query: string): {
  mode: ExploreSearchMode;
  reason: string;
} {
  const q = query.trim();
  if (!q) {
    return { mode: "nearby_category", reason: "empty_query" };
  }

  if (NEARBY_CATEGORY_RE.test(q) || NEARBY_CATEGORY_SUFFIX_RE.test(q)) {
    return { mode: "nearby_category", reason: "category_keyword" };
  }

  if (NEARBY_BRAND_RE.test(q)) {
    return { mode: "nearby_category", reason: "chain_brand_nearby" };
  }

  if (GLOBAL_LANDMARK_HINT_RE.test(q)) {
    return { mode: "global_place", reason: "known_landmark" };
  }

  /** 含數字的地標（如 101） */
  if (/\d/.test(q) && q.length <= 24) {
    return { mode: "global_place", reason: "numbered_landmark" };
  }

  /** 拉丁專有名詞（Stellar Garden 等） */
  if (/^[a-z0-9\s'.&+-]+$/i.test(q) && /[a-z]/i.test(q) && q.length >= 4) {
    return { mode: "global_place", reason: "latin_place_name" };
  }

  /** 中日韓地名／景點（非「店」結尾） */
  if (
    /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(q) &&
    !NEARBY_CATEGORY_SUFFIX_RE.test(q) &&
    q.length >= 2 &&
    q.length <= 32
  ) {
    return { mode: "global_place", reason: "specific_place_name" };
  }

  return { mode: "nearby_category", reason: "default_nearby" };
}

export function logExploreSearchModeDetected(params: {
  query: string;
  mode: ExploreSearchMode;
  reason: string;
}): void {
  console.info("[EXPLORE_SEARCH_MODE_DETECTED]", params);
}
