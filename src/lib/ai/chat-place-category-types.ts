/** 聊聊類別地點 intent — 獨立型別檔，避免 circular import */
import { hasExplicitPlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent/parse";

export type ChatPlaceCategoryIntent =
  | "cafe"
  | "restaurant"
  | "shopping"
  | "attraction"
  | "night_market"
  | "bar"
  | "indoor";

const CATEGORY_PLACE_QUERY_RE =
  /(?:咖啡廳|咖啡店|咖啡|café|cafe|餐廳|美食|吃飯|用餐|吃的地方|想吃|吃什麼|找吃的|商圈|shopping|百貨|市集|購物|商場|mall|outlet|アウトレット|逛街|購物行程|購物中心|商店街|夜市|酒吧|居酒屋|宵夜|室內景點|雨天|美術館|博物館|museum|必去景點|必去|景點|有推薦的(?:餐廳|咖啡|店|地方|景點|美食)|推薦(?:餐廳|咖啡|景點|商圈|百貨|Outlet|outlet|夜市|酒吧|店|地方|吃)|有什麼(?:商圈|景點|店|地方)|附近有什麼|有推薦的店|拉麵|拉面|ラーメン|壽司|寿司|壽喜燒|烧肉|燒肉|火鍋|牛排|義大利麵|披薩|漢堡|居酒屋店|百貨公司|地下街)/i;

/** 使用者詢問特定類別地點（餐廳、咖啡、商圈等）— 含菜系細分（拉麵等） */
export function hasCategoryPlaceQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (CATEGORY_PLACE_QUERY_RE.test(t)) return true;
  return hasExplicitPlaceRecommendationIntent(t);
}

/** 明確的地點推薦請求（含「有推薦的 XX 嗎」句式） */
export function isPlaceRecommendationQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasExplicitPlaceRecommendationIntent(t)) return true;
  if (!hasCategoryPlaceQuery(t)) return false;
  return /(?:推薦|有沒有|有什麼|哪些|附近|必去|找|想去)/.test(t);
}
