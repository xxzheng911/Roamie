import { isTaiwanCoordinates } from "@/lib/geo-region";

/** 探索頁分類：一律以使用者座標為中心，使用 nearby / multi nearby 搜尋 */

export type ExploreCategory = {
  /** 穩定 id（邏輯用，與 UI 語言無關） */
  id: string;
  label: string;
  /** 僅 text 模式使用；nearby / multi 以 includedTypes 為主 */
  query: string;
  mode: "nearby" | "text" | "multi";
  /** 單次 nearby 的 Table A types（最多一組） */
  includedTypes?: string[];
  /** 全部：多組 nearby 合併，避免只剩咖啡廳 */
  nearbyGroups?: string[][];
};

export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  {
    id: "all",
    label: "全部",
    query: "附近景點",
    mode: "multi",
    nearbyGroups: [
      ["tourist_attraction", "museum", "art_gallery"],
      ["cafe", "bakery"],
      ["restaurant", "food_store", "meal_takeaway"],
      ["shopping_mall", "department_store", "book_store"],
      ["park", "national_park"],
      ["bar", "night_club"],
    ],
  },
  {
    id: "coffee",
    label: "咖啡",
    query: "咖啡店",
    mode: "nearby",
    /** Google Places nearby 僅支援 Table A 合法 type；勿用 coffee_shop / coffee_store */
    includedTypes: ["cafe"],
  },
  {
    id: "sight",
    label: "景點",
    query: "景點 觀光景點",
    mode: "nearby",
    includedTypes: [
      "tourist_attraction",
      "museum",
      "art_gallery",
      "historical_landmark",
      "monument",
    ],
  },
  {
    id: "district",
    label: "商圈",
    query: "商圈 夜市 購物中心 百貨 商店街 老街 伴手禮 文創",
    mode: "multi",
    nearbyGroups: [
      ["shopping_mall", "department_store"],
      ["market", "flea_market"],
      ["tourist_attraction"],
    ],
  },
  {
    id: "food",
    label: "美食",
    query: "美食 餐廳",
    mode: "nearby",
    includedTypes: ["restaurant", "meal_takeaway", "food_store", "bar"],
  },
  {
    id: "park",
    label: "公園",
    query: "公園",
    mode: "nearby",
    includedTypes: ["park", "national_park", "botanical_garden"],
  },
  {
    id: "night",
    label: "夜晚",
    query: "夜晚",
    mode: "nearby",
    includedTypes: ["bar", "night_club", "tourist_attraction"],
  },
];

/** nearby 結果經分類後少於此數時，改以 text 搜尋補齊（咖啡） */
export const COFFEE_MIN_FILTERED_RESULTS = 3;

/** textQuery + locationBias（使用者座標）；補齊 nearby cafe 不足 */
export const COFFEE_TEXT_FALLBACK_QUERIES = ["咖啡", "咖啡店", "coffee", "cafe"] as const;

/** nearby 結果經分類後少於此數時，改以 text 搜尋補齊（商圈） */
export const DISTRICT_MIN_FILTERED_RESULTS = 3;

export const DISTRICT_TEXT_FALLBACK_QUERIES = [
  "夜市",
  "商圈",
  "購物中心",
  "百貨",
  "老街",
  "伴手禮",
  "文創市集",
  "Outlet",
] as const;

export const PLACES_LANGUAGE = "zh-TW" as const;
/** 行程規劃 autocomplete 預設；探索地圖改依 userLocation 動態決定 */
export const PLACES_REGION = "TW" as const;
export const DEFAULT_SEARCH_RADIUS_M = 15_000;
export const MAX_PLACE_DISTANCE_M = 50_000;

const COFFEE_FALLBACK_INTL = ["coffee", "cafe", "coffee shop"] as const;
const DISTRICT_FALLBACK_INTL = [
  "shopping district",
  "shopping mall",
  "market",
  "night market",
  "downtown",
  "main street",
] as const;

/** 探索頁 text 補齊查詢（依使用者所在地） */
export function getExploreTextFallbackQueries(
  categoryId: string,
  userLocation: { lat: number; lng: number },
): readonly string[] {
  const inTaiwan = isTaiwanCoordinates(userLocation.lat, userLocation.lng);
  if (categoryId === "coffee") {
    return inTaiwan ? COFFEE_TEXT_FALLBACK_QUERIES : COFFEE_FALLBACK_INTL;
  }
  if (categoryId === "district") {
    return inTaiwan ? DISTRICT_TEXT_FALLBACK_QUERIES : DISTRICT_FALLBACK_INTL;
  }
  return [];
}
