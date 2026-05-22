/** 探索頁分類：一律以使用者座標為中心，使用 nearby / multi nearby 搜尋 */

export type ExploreCategory = {
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
    label: "全部",
    query: "附近景點",
    mode: "multi",
    nearbyGroups: [
      ["tourist_attraction", "museum", "art_gallery"],
      ["cafe", "bakery"],
      ["restaurant", "food_store", "meal_takeaway"],
      ["shopping_mall", "department_store", "store"],
      ["park", "national_park"],
      ["bar", "night_club"],
    ],
  },
  { label: "咖啡", query: "咖啡", mode: "nearby", includedTypes: ["cafe", "bakery"] },
  {
    label: "景點",
    query: "景點",
    mode: "nearby",
    includedTypes: ["tourist_attraction", "museum", "art_gallery"],
  },
  {
    label: "商圈",
    query: "商圈",
    mode: "nearby",
    includedTypes: ["shopping_mall", "store", "department_store"],
  },
  {
    label: "百貨",
    query: "百貨",
    mode: "nearby",
    includedTypes: ["department_store", "shopping_mall"],
  },
  {
    label: "美食",
    query: "美食",
    mode: "nearby",
    includedTypes: ["restaurant", "food_store", "meal_takeaway"],
  },
  { label: "公園", query: "公園", mode: "nearby", includedTypes: ["park", "national_park"] },
  {
    label: "夜晚",
    query: "夜晚",
    mode: "nearby",
    includedTypes: ["bar", "night_club", "tourist_attraction"],
  },
];

export const PLACES_LANGUAGE = "zh-TW" as const;
export const PLACES_REGION = "TW" as const;
export const DEFAULT_SEARCH_RADIUS_M = 15_000;
export const MAX_PLACE_DISTANCE_M = 50_000;
