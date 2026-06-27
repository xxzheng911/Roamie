/** 聊聊類別地點 intent — 獨立型別檔，避免 circular import */

export type ChatPlaceCategoryIntent =
  | "cafe"
  | "restaurant"
  | "shopping"
  | "attraction"
  | "night_market"
  | "bar"
  | "indoor";

const CATEGORY_PLACE_QUERY_RE =
  /(?:咖啡廳|咖啡店|咖啡|café|cafe|餐廳|美食|吃飯|用餐|商圈|shopping|百貨|市集|購物|商場|mall|夜市|酒吧|居酒屋|宵夜|室內景點|雨天|美術館|博物館|museum|必去景點|必去|景點|有推薦的(?:餐廳|咖啡|店|地方|景點)|推薦(?:餐廳|咖啡|景點|商圈|百貨|夜市|酒吧|店|地方)|有什麼(?:商圈|景點|店|地方)|附近有什麼|有推薦的店)/i;

/** 使用者詢問特定類別地點（餐廳、咖啡、商圈等） */
export function hasCategoryPlaceQuery(text: string): boolean {
  return CATEGORY_PLACE_QUERY_RE.test(text.trim());
}

/** 明確的地點推薦請求（含「有推薦的 XX 嗎」句式） */
export function isPlaceRecommendationQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!hasCategoryPlaceQuery(t)) return false;
  return /(?:推薦|有沒有|有什麼|哪些|附近|必去|找|想去)/.test(t);
}
