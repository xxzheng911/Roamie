import type { PlaceResult } from "@/lib/place-result";
import { isDrinkOrSnackFoodPlace, isExploreCoffeePlace } from "@/lib/place-category";

/** Roamie 推薦文案用：地點真實身分（優先於 UI 分類 chip） */
export type PlaceIdentity =
  | "bookstore"
  | "breakfast_shop"
  | "cafe"
  | "bakery"
  | "dessert"
  | "restaurant"
  | "shopping_mall"
  | "department_store"
  | "tourist_attraction"
  | "museum"
  | "night_market"
  | "district"
  | "park"
  | "bar"
  | "food_stall"
  | "generic"
  | "unsupported";

export type PlaceIdentityInput = Pick<
  PlaceResult,
  "primaryType" | "name" | "address"
> & {
  types?: string[] | null;
};

/** 不生成文青旅遊文案，僅安全 fallback */
export const REASON_BLACKLIST_TYPES = [
  "car_repair",
  "car_dealer",
  "auto_parts_store",
  "motorcycle_dealer",
  "motorcycle_repair",
  "hardware_store",
  "home_goods_store",
  "electronics_store",
  "warehouse_store",
  "wholesaler",
  "corporate_office",
  "office",
  "consultant",
  "insurance_agency",
  "real_estate_agency",
  "finance",
  "bank",
  "atm",
  "local_government_office",
  "city_hall",
  "lawyer",
  "accounting",
  "electrician",
  "plumber",
  "moving_company",
  "storage",
  "gas_station",
  "parking",
  "hospital",
  "doctor",
  "dentist",
  "pharmacy",
  "school",
  "university",
  "church",
  "funeral_home",
  "cemetery",
] as const;

function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, "_");
}

export function collectPlaceTypes(place: PlaceIdentityInput): string[] {
  const set = new Set<string>();
  for (const t of place.types ?? []) {
    const n = normalizeType(t);
    if (n) set.add(n);
  }
  const primary = normalizeType(place.primaryType ?? "");
  if (primary) set.add(primary);
  return [...set];
}

function hasAnyType(types: string[], candidates: readonly string[]): boolean {
  return candidates.some((c) => types.includes(c) || types.some((t) => t.includes(c)));
}

function placeBlob(place: PlaceIdentityInput): string {
  return `${place.name ?? ""} ${place.address ?? ""}`;
}

function isBlacklisted(types: string[]): boolean {
  return hasAnyType(types, REASON_BLACKLIST_TYPES);
}

/**
 * 辨識地點真實類型（types → 名稱關鍵字 → 不參考 UI chip 名稱）。
 */
export function resolvePlaceIdentity(place: PlaceIdentityInput): PlaceIdentity {
  const types = collectPlaceTypes(place);
  const name = place.name ?? "";
  const blob = placeBlob(place);

  if (isBlacklisted(types)) return "unsupported";

  if (/書店|書局|誠品|金石堂|茉莉|書屋/i.test(name)) return "bookstore";
  if (/燒餅|燒餅店|豆漿|早餐|蛋餅|飯糰|肉粽|鹹酥餅|水煎包|饅頭|包子店/i.test(name)) {
    if (!/蛋糕|烘焙坊|西點|甜點屋/i.test(name)) return "breakfast_shop";
  }
  if (/夜市/i.test(blob)) return "night_market";
  if (/博物館|美術館|纪念馆|紀念館/i.test(name)) return "museum";
  if (/百貨|三越|新光|遠百|大遠百|SOGO|夢時代|漢神|大立|義享|Outlet|OUTLET/i.test(name)) {
    return "department_store";
  }
  if (/購物中心|SKM\s*Park|mall|plaza/i.test(name) && !/商務/i.test(name)) {
    return "shopping_mall";
  }
  if (/伴手禮|名產|禮品|特產|souvenir/i.test(name)) {
    return "district";
  }
  if (/商圈|商店街|駁二|老街|步行街|文創|市集|徒步|潮流/i.test(blob) && !/百貨|三越/i.test(name)) {
    return "district";
  }

  if (hasAnyType(types, ["book_store", "bookstore", "library"])) return "bookstore";
  if (hasAnyType(types, ["museum", "art_gallery", "planetarium"])) return "museum";
  if (hasAnyType(types, ["department_store"])) return "department_store";
  if (hasAnyType(types, ["shopping_mall"])) {
    if (/商務廣場|辦公/i.test(name)) return "generic";
    return "shopping_mall";
  }
  if (isDrinkOrSnackFoodPlace(place)) {
    if (/小吃|攤|麵線|滷味|鹹酥雞/i.test(name)) return "food_stall";
    return "restaurant";
  }
  if (isExploreCoffeePlace(place)) return "cafe";
  if (hasAnyType(types, ["bakery"])) {
    if (/早餐|燒餅|豆漿/i.test(name)) return "breakfast_shop";
    return "bakery";
  }
  if (hasAnyType(types, ["dessert_shop", "ice_cream_shop", "confectionery"])) return "dessert";
  if (hasAnyType(types, ["bar", "wine_bar", "night_club", "pub"])) return "bar";
  if (hasAnyType(types, ["park", "national_park", "botanical_garden", "hiking_area"])) return "park";
  if (hasAnyType(types, ["tourist_attraction", "historical_landmark", "monument", "cultural_center"])) {
    if (hasAnyType(types, ["book_store", "bookstore"])) return "bookstore";
    if (/書/i.test(name)) return "bookstore";
    return "tourist_attraction";
  }
  if (hasAnyType(types, ["market", "flea_market"])) {
    return /夜市/i.test(blob) ? "night_market" : "district";
  }
  if (
    hasAnyType(types, [
      "restaurant",
      "food",
      "meal_takeaway",
      "fast_food_restaurant",
      "food_store",
    ])
  ) {
    if (/小吃|攤|麵線|滷味|鹹酥雞/i.test(name)) return "food_stall";
    return "restaurant";
  }

  if (isExploreCoffeePlace(place)) return "cafe";
  if (/甜點|蛋糕|冰淇淋/i.test(name)) return "dessert";
  if (/餐廳|食堂|料理|火鍋|燒肉|拉麵/i.test(name)) return "restaurant";

  if (hasAnyType(types, ["store", "point_of_interest", "establishment"])) {
    return "generic";
  }

  return "generic";
}

export function identityDisplayLabel(identity: PlaceIdentity): string {
  const labels: Record<PlaceIdentity, string> = {
    bookstore: "書店",
    breakfast_shop: "早餐",
    cafe: "咖啡",
    bakery: "烘焙",
    dessert: "甜點",
    restaurant: "美食",
    shopping_mall: "購物中心",
    department_store: "商圈",
    tourist_attraction: "景點",
    museum: "博物館",
    night_market: "夜市",
    district: "商圈",
    park: "公園",
    bar: "酒吧",
    food_stall: "小吃",
    generic: "地點",
    unsupported: "地點",
  };
  return labels[identity];
}
