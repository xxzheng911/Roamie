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

/** 探索地圖「全部」分頁：聚合子分類結果 */
export const EXPLORE_ALL_SUBCATEGORY_IDS = [
  "coffee",
  "sight",
  "district",
  "food",
  "night",
] as const;

export function getExploreCategoryById(id: string): ExploreCategory | undefined {
  return EXPLORE_CATEGORIES.find((c) => c.id === id);
}

export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  {
    id: "all",
    label: "全部",
    query: "附近推薦",
    mode: "multi",
    nearbyGroups: [
      ["cafe", "bakery"],
      ["tourist_attraction", "museum", "art_gallery"],
      ["restaurant", "meal_takeaway", "food_store"],
      ["shopping_mall", "department_store", "market"],
    ],
  },
  {
    id: "coffee",
    label: "咖啡",
    query: "咖啡廳 景觀咖啡 老宅咖啡 甜點",
    mode: "multi",
    nearbyGroups: [
      ["cafe", "coffee_shop"],
      ["bakery", "dessert_shop", "ice_cream_shop"],
    ],
  },
  {
    id: "sight",
    label: "景點",
    query: "觀光景點 展望台 博物館 美術館 地標",
    mode: "nearby",
    includedTypes: [
      "tourist_attraction",
      "museum",
      "art_gallery",
      "historical_landmark",
      "monument",
      "cultural_center",
      "cultural_landmark",
      "historical_place",
      "hindu_temple",
      "buddhist_temple",
      "place_of_worship",
    ],
  },
  {
    id: "district",
    label: "商圈",
    query: "百貨 商場 市集 購物街區",
    mode: "multi",
    nearbyGroups: [
      ["shopping_mall", "department_store"],
      ["market", "flea_market"],
    ],
  },
  {
    id: "food",
    label: "美食",
    query: "餐廳 小吃 火鍋 燒肉 壽司 在地特色",
    mode: "nearby",
    includedTypes: ["restaurant", "meal_takeaway", "fast_food_restaurant", "food_store"],
  },
  {
    id: "night",
    label: "夜晚",
    query: "酒吧 居酒屋 餐酒館 宵夜 夜市 深夜餐廳 深夜咖啡",
    mode: "multi",
    nearbyGroups: [
      ["bar", "pub", "night_club", "wine_bar"],
      ["restaurant", "meal_takeaway", "food_store"],
      ["cafe", "coffee_shop", "bakery"],
      ["market", "flea_market", "tourist_attraction"],
    ],
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

/** nearby 結果經分類後少於此數時，改以 text 搜尋補齊（夜晚） */
export const NIGHT_MIN_FILTERED_RESULTS = 2;

export const NIGHT_TEXT_FALLBACK_QUERIES = [
  "宵夜",
  "夜市",
  "深夜餐廳",
  "居酒屋",
  "餐酒館",
  "酒吧",
  "深夜咖啡",
  "深夜甜點",
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

const NIGHT_FALLBACK_INTL = [
  "late night food",
  "night market",
  "izakaya",
  "bar",
  "pub",
  "late night cafe",
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
  if (categoryId === "night") {
    return inTaiwan ? NIGHT_TEXT_FALLBACK_QUERIES : NIGHT_FALLBACK_INTL;
  }
  if (categoryId === "food") {
    return inTaiwan
      ? ["美食", "餐廳", "小吃", "拉麵", "燒肉", "火鍋"]
      : ["restaurant", "food", "local food"];
  }
  if (categoryId === "sight") {
    return inTaiwan
      ? ["景點", "博物館", "展覽", "文化景點", "地標"]
      : ["tourist attraction", "museum", "landmark"];
  }
  return [];
}
