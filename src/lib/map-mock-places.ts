import type { PlaceResult } from "@/lib/place-result";
import { matchesCategory } from "@/lib/place-category";
import type { ExploreCategory } from "@/lib/places-search-config";
import { EXPLORE_CATEGORIES } from "@/lib/places-search-config";

export type MockMapPlace = PlaceResult & { reason: string };

const TYPE_LABELS: Record<string, string> = {
  cafe: "咖啡廳",
  bakery: "烘焙",
  restaurant: "餐廳",
  tourist_attraction: "景點",
  museum: "博物館",
  park: "公園",
  bookstore: "書店",
  bar: "酒吧",
  shopping_mall: "商圈",
};

/** Google primaryType → 中文類型 */
export function formatPlaceTypeLabel(
  primaryType: string | null | undefined,
  fallback = "地點",
): string {
  if (!primaryType) return fallback;
  const key = primaryType.toLowerCase();
  for (const [k, label] of Object.entries(TYPE_LABELS)) {
    if (key.includes(k)) return label;
  }
  return fallback;
}

type MockSeed = Omit<MockMapPlace, "lat" | "lng"> & {
  dLat: number;
  dLng: number;
};

const MOCK_SEEDS: MockSeed[] = [
  {
    id: "mock-coffee-1",
    name: "巷弄咖啡",
    address: "附近",
    dLat: 0.0038,
    dLng: -0.0026,
    rating: 4.6,
    userRatingCount: 420,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "氣氛安靜，適合坐下來發呆一陣子",
  },
  {
    id: "mock-coffee-2",
    name: "小日子珈琲",
    address: "附近",
    dLat: 0.0018,
    dLng: -0.004,
    rating: 4.5,
    userRatingCount: 318,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe", "bakery"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "手沖與甜點都不趕時間，適合慢慢坐",
  },
  {
    id: "mock-sight-1",
    name: "城市展望台",
    address: "附近",
    dLat: -0.0045,
    dLng: 0.002,
    rating: 4.4,
    userRatingCount: 2100,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "視野開闊，適合傍晚來看城市光",
  },
  {
    id: "mock-sight-2",
    name: "歷史文化館",
    address: "附近",
    dLat: -0.002,
    dLng: -0.0035,
    rating: 4.3,
    userRatingCount: 890,
    photoName: null,
    primaryType: "museum",
    types: ["museum", "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "步調慢、資訊剛好，適合認識這座城",
  },
  {
    id: "mock-district-1",
    name: "文創小街",
    address: "附近",
    dLat: 0.0025,
    dLng: 0.004,
    rating: 4.5,
    userRatingCount: 1500,
    photoName: null,
    primaryType: "shopping_mall",
    types: ["shopping_mall", "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "小店與伴手禮集中，適合邊走邊逛",
  },
  {
    id: "mock-district-2",
    name: "週末市集",
    address: "附近",
    dLat: -0.003,
    dLng: 0.0032,
    rating: 4.2,
    userRatingCount: 640,
    photoName: null,
    primaryType: "market",
    types: ["market", "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "在地攤位多，適合隨興挖寶",
  },
  {
    id: "mock-food-1",
    name: "在地小餐館",
    address: "附近",
    dLat: 0.0021,
    dLng: 0.0034,
    rating: 4.5,
    userRatingCount: 890,
    photoName: null,
    primaryType: "restaurant",
    types: ["restaurant"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "適合慢慢吃一餐再繼續走",
  },
  {
    id: "mock-food-2",
    name: "街角定食屋",
    address: "附近",
    dLat: 0.004,
    dLng: 0.001,
    rating: 4.4,
    userRatingCount: 520,
    photoName: null,
    primaryType: "restaurant",
    types: ["restaurant", "meal_takeaway"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "份量剛好，一個人來也自在",
  },
  {
    id: "mock-park-1",
    name: "城市公園",
    address: "附近",
    dLat: -0.0042,
    dLng: -0.0018,
    rating: 4.4,
    userRatingCount: 2100,
    photoName: null,
    primaryType: "park",
    types: ["park"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "綠意多、步調慢，適合傍晚散步",
  },
  {
    id: "mock-park-2",
    name: "河濱步道",
    address: "附近",
    dLat: -0.005,
    dLng: 0.001,
    rating: 4.6,
    userRatingCount: 3200,
    photoName: null,
    primaryType: "park",
    types: ["park", "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "風大、視野開，適合把節奏放慢",
  },
  {
    id: "mock-book-1",
    name: "獨立書店",
    address: "附近",
    dLat: -0.0015,
    dLng: 0.0041,
    rating: 4.3,
    userRatingCount: 1500,
    photoName: null,
    primaryType: "bookstore",
    types: ["bookstore"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: "適合慢慢翻書、不趕時間的午後",
  },
];

/** API 無結果或失敗時的示範推薦（座標偏移，不綁定特定城市名稱） */
export function getMockMapPlaces(center: { lat: number; lng: number }): MockMapPlace[] {
  return MOCK_SEEDS.map(({ dLat, dLng, ...rest }) => ({
    ...rest,
    lat: center.lat + dLat,
    lng: center.lng + dLng,
  }));
}

export function getMockPlacesForCategory(
  center: { lat: number; lng: number },
  cat: ExploreCategory,
): MockMapPlace[] {
  return getMockMapPlaces(center).filter((p) =>
    matchesCategory(
      { primaryType: p.primaryType, name: p.name, types: p.types },
      cat,
    ),
  );
}

export function getMockHomeNearbyPicks(
  center: { lat: number; lng: number },
  categories: ExploreCategory[],
  perCategory = 2,
): Array<MockMapPlace & { categoryId: string }> {
  const picks: Array<MockMapPlace & { categoryId: string }> = [];
  const seen = new Set<string>();

  for (const cat of categories) {
    const pool = getMockPlacesForCategory(center, cat).slice(0, perCategory);
    for (const p of pool) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      picks.push({ ...p, categoryId: cat.id });
    }
  }

  if (picks.length > 0) return picks;

  return getMockMapPlaces(center)
    .slice(0, 6)
    .map((p) => ({ ...p, categoryId: categories[0]?.id ?? "all" }));
}

export function resolveExploreCategory(id: string): ExploreCategory {
  return EXPLORE_CATEGORIES.find((c) => c.id === id) ?? EXPLORE_CATEGORIES[0];
}
