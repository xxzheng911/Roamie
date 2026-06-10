import type { ExploreCategory } from "@/lib/places-search-config";
import { styleCategoryBoosts, type PlanTravelStyleZh } from "@/lib/plan-travel-style";
import { classifyWeatherScene, type WeatherScene } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";
import type { RecommendationCategoryId } from "@/lib/recommendation/types";

/** 推薦分類定義（擴充探索分類） */
export const RECOMMENDATION_CATEGORY_DEFS: ExploreCategory[] = [
  {
    id: "coffee",
    label: "咖啡",
    query: "咖啡廳 景觀咖啡 老宅咖啡 甜點",
    mode: "multi",
    nearbyGroups: [
      ["cafe"],
      ["bakery", "dessert_shop", "ice_cream_shop"],
    ],
  },
  {
    id: "food",
    label: "美食",
    query: "餐廳 小吃 火鍋 燒肉 壽司 在地特色",
    mode: "nearby",
    includedTypes: ["restaurant", "meal_takeaway", "food_store"],
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
    query: "酒吧 居酒屋 宵夜 夜市 深夜咖啡",
    mode: "multi",
    nearbyGroups: [
      ["bar", "night_club", "pub"],
      ["restaurant", "meal_takeaway"],
      ["cafe", "bakery"],
      ["market", "flea_market"],
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
  travelStyles?: PlanTravelStyleZh[];
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

  if (input.travelStyles?.length) {
    for (const id of styleCategoryBoosts(input.travelStyles)) ids.add(id);
  }

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

const HOME_CATEGORY_IDS = ["coffee", "food", "sight", "district", "night"] as const;

const HOME_MOOD_CATEGORY_IDS: Record<string, (typeof HOME_CATEGORY_IDS)[number][]> = {
  想放空: ["coffee", "sight", "district"],
  一個人: ["coffee", "sight", "food"],
  下雨天: ["coffee", "district", "sight"],
  深夜散步: ["night", "coffee", "district"],
  找咖啡: ["coffee", "food", "district"],
  看海: ["sight", "food", "district"],
};

function homeTimePeriod(hour: number): "day" | "evening" | "night" {
  if (hour >= 22 || hour < 5) return "night";
  if (hour >= 17) return "evening";
  return "day";
}

function isHomeRainy(weather: WeatherSummary | null): boolean {
  const scene = classifyWeatherScene({
    tempC: weather?.tempC,
    precipProbability: weather?.precipProbability,
    condition: weather?.condition,
    isDaytime: weather?.isDaytime,
  });
  return scene === "rainy";
}

function defaultHomeCategoryIds(
  weather: WeatherSummary | null,
  hour: number,
): (typeof HOME_CATEGORY_IDS)[number][] {
  const period = homeTimePeriod(hour);
  const rainy = isHomeRainy(weather);

  if (period === "night") {
    return rainy
      ? ["coffee", "night", "district", "food"]
      : ["night", "food", "district", "coffee"];
  }
  if (period === "evening") {
    return rainy
      ? ["coffee", "sight", "district", "food"]
      : ["sight", "coffee", "district", "food"];
  }
  return rainy
    ? ["coffee", "district", "sight", "food"]
    : ["coffee", "food", "sight", "district"];
}

function resolveHomeCategoryIds(
  weather: WeatherSummary | null,
  mood?: string | null,
  at = new Date(),
): (typeof HOME_CATEGORY_IDS)[number][] {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Taipei",
    }).format(at),
  );

  const moodKey = mood?.trim()
    ? Object.keys(HOME_MOOD_CATEGORY_IDS).find((k) => mood.includes(k))
    : undefined;
  if (moodKey) {
    return HOME_MOOD_CATEGORY_IDS[moodKey].slice(0, 4);
  }

  if (/雨|rain/i.test(mood ?? "")) {
    return isHomeRainy(weather)
      ? ["coffee", "district", "sight", "food"]
      : ["coffee", "food", "district", "sight"];
  }
  if (/深夜|夜|night/i.test(mood ?? "")) {
    return ["night", "food", "coffee", "district"];
  }
  if (/咖啡|coffee/i.test(mood ?? "")) {
    return ["coffee", "food", "district", "sight"];
  }

  return defaultHomeCategoryIds(weather, hour);
}

/** 首頁附近推薦：依 GPS 時段、天氣（與可選心情）決定搜尋分類 */
export function pickCategoriesForHome(
  weather: WeatherSummary | null,
  mood?: string | null,
  options?: { at?: Date },
): ExploreCategory[] {
  const ids = resolveHomeCategoryIds(weather, mood, options?.at);
  return ids
    .map((id) => getCategoryDef(id))
    .filter((c): c is ExploreCategory => Boolean(c));
}
