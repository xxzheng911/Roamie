import type { ExploreCategory } from "@/lib/places-search-config";
import { classifyWeatherScene, type WeatherScene } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";
import type { RecommendationCategoryId } from "@/lib/recommendation/types";

/** 推薦分類定義（擴充探索分類） */
export const RECOMMENDATION_CATEGORY_DEFS: ExploreCategory[] = [
  {
    id: "coffee",
    label: "咖啡",
    query: "咖啡店",
    mode: "nearby",
    includedTypes: ["cafe"],
  },
  {
    id: "food",
    label: "美食",
    query: "美食 餐廳",
    mode: "nearby",
    includedTypes: ["restaurant", "meal_takeaway", "food_store"],
  },
  {
    id: "sight",
    label: "景點",
    query: "景點 觀光景點",
    mode: "nearby",
    includedTypes: ["tourist_attraction", "museum", "art_gallery", "historical_landmark"],
  },
  {
    id: "district",
    label: "商圈",
    query: "商圈 夜市 購物",
    mode: "multi",
    nearbyGroups: [
      ["shopping_mall", "department_store"],
      ["market", "flea_market"],
    ],
  },
  {
    id: "park",
    label: "公園",
    query: "公園",
    mode: "nearby",
    includedTypes: ["park", "national_park", "botanical_garden"],
  },
  {
    id: "indoor",
    label: "室內備案",
    query: "室內 百貨 書店 展覽",
    mode: "multi",
    nearbyGroups: [
      ["shopping_mall", "department_store"],
      ["museum", "art_gallery", "library"],
      ["book_store", "cafe"],
    ],
  },
  {
    id: "rainy",
    label: "雨天適合",
    query: "室內 咖啡 書店 百貨 展覽",
    mode: "multi",
    nearbyGroups: [
      ["cafe", "book_store"],
      ["shopping_mall", "department_store"],
      ["museum", "art_gallery"],
    ],
  },
  {
    id: "night",
    label: "夜晚適合",
    query: "夜景 夜市 酒吧",
    mode: "multi",
    nearbyGroups: [
      ["bar", "night_club"],
      ["tourist_attraction"],
      ["restaurant", "cafe"],
    ],
  },
  {
    id: "photo",
    label: "拍照適合",
    query: "拍照 打卡 網美 景觀",
    mode: "multi",
    nearbyGroups: [
      ["tourist_attraction", "historical_landmark"],
      ["art_gallery", "museum"],
      ["park"],
    ],
  },
  {
    id: "walking",
    label: "放空散步",
    query: "散步 河濱 步道 老街",
    mode: "multi",
    nearbyGroups: [
      ["park", "national_park"],
      ["tourist_attraction"],
      ["cafe"],
    ],
  },
];

const MOOD_CATEGORY_BOOST: Record<string, RecommendationCategoryId[]> = {
  想放空: ["walking", "park", "coffee"],
  一個人: ["coffee", "walking", "sight"],
  下雨天: ["rainy", "indoor", "coffee"],
  深夜散步: ["night", "walking"],
  找咖啡: ["coffee"],
  看海: ["sight", "walking"],
};

const SCENE_DEFAULTS: Record<WeatherScene, RecommendationCategoryId[]> = {
  rainy: ["rainy", "indoor", "coffee", "district"],
  hot: ["indoor", "coffee", "district", "food"],
  cold: ["indoor", "coffee", "food", "sight"],
  night: ["night", "food", "district"],
  cloudy: ["walking", "park", "coffee", "sight"],
  sunny: ["park", "walking", "sight", "photo"],
  fair: ["coffee", "food", "sight", "park"],
};

export function getCategoryDef(id: string): ExploreCategory | undefined {
  return RECOMMENDATION_CATEGORY_DEFS.find((c) => c.id === id);
}

export function pickCategoriesForContext(input: {
  weather: WeatherSummary | null;
  mood?: string;
  max?: number;
  constraints?: string[];
  settingPreference?: "indoor" | "outdoor" | "either";
  needsRainBackup?: boolean;
}): ExploreCategory[] {
  const max = input.max ?? 6;
  const scene = classifyWeatherScene({
    tempC: input.weather?.tempC,
    precipProbability: input.weather?.precipProbability,
    condition: input.weather?.condition,
    isDaytime: input.weather?.isDaytime,
  });

  const ids = new Set<RecommendationCategoryId>();

  for (const id of SCENE_DEFAULTS[scene]) ids.add(id);

  const moodKey = Object.keys(MOOD_CATEGORY_BOOST).find((k) => input.mood?.includes(k));
  if (moodKey) {
    for (const id of MOOD_CATEGORY_BOOST[moodKey]) ids.add(id);
  }

  if (/雨|rain/i.test(input.mood ?? "")) {
    ids.add("rainy");
    ids.add("indoor");
  }
  if (/深夜|夜|night/i.test(input.mood ?? "")) ids.add("night");
  if (/咖啡|coffee/i.test(input.mood ?? "")) ids.add("coffee");

  const avoidWalk = input.constraints?.some((c) => /少走路|walk/i.test(c));
  if (avoidWalk) {
    ids.delete("walking");
    ids.delete("park");
    ids.add("coffee");
    ids.add("food");
    ids.add("indoor");
  }
  if (input.settingPreference === "indoor" || input.needsRainBackup) {
    ids.add("indoor");
    ids.add("rainy");
  }
  if (input.settingPreference === "outdoor") {
    ids.add("park");
    ids.add("walking");
  }

  const ordered = [...ids].slice(0, max);
  const defs = ordered
    .map((id) => getCategoryDef(id))
    .filter((c): c is ExploreCategory => Boolean(c));

  if (defs.length > 0) return defs;

  return RECOMMENDATION_CATEGORY_DEFS.filter((c) =>
    ["coffee", "food", "sight", "park"].includes(c.id),
  ).slice(0, 4);
}

/** 首頁附近推薦：依天氣調整分類優先順序 */
export function pickCategoriesForHome(weather: WeatherSummary | null): ExploreCategory[] {
  return pickCategoriesForContext({ weather, max: 6 });
}
