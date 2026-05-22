import type { ExploreCategory } from "@/lib/places-search-config";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";

export type PlaceCategory =
  | "cafe"
  | "food"
  | "shopping_mall"
  | "district"
  | "attraction"
  | "bookstore"
  | "nightlife"
  | "park"
  | "unknown";

export type PlaceLike = {
  primaryType?: string | null;
  types?: string[] | null;
  name?: string | null;
  address?: string | null;
};

/** @deprecated 嚴格模式下改為僅在 0 筆時顯示空狀態 */
export const MIN_CATEGORY_RESULTS = 4;

const GLOBAL_DENY_TYPES = [
  "car_repair",
  "car_dealer",
  "auto_parts_store",
  "motorcycle_dealer",
  "motorcycle_repair",
  "hardware_store",
  "home_goods_store",
  "electronics_store",
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "hospital",
  "doctor",
  "dentist",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "church",
  "local_government_office",
  "real_estate_agency",
  "insurance_agency",
  "corporate_office",
  "office",
  "consultant",
  "warehouse_store",
  "wholesaler",
  "gas_station",
  "parking",
] as const;

const GLOBAL_ALLOW_TYPES = [
  "cafe",
  "coffee_shop",
  "restaurant",
  "bakery",
  "dessert_shop",
  "food",
  "food_store",
  "meal_takeaway",
  "fast_food_restaurant",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "national_park",
  "botanical_garden",
  "shopping_mall",
  "department_store",
  "market",
  "flea_market",
  "book_store",
  "bookstore",
  "cultural_center",
  "historical_landmark",
  "monument",
  "bar",
  "wine_bar",
  "night_club",
  "pub",
  "zoo",
  "aquarium",
] as const;

const GLOBAL_DENY_NAME_RE =
  /汽車|機車|摩托|汽配|輪胎|維修|保修|五金|工具行|診所|醫院|牙醫|補習|托育|教堂|寺廟|墓園|殯葬|批發|物流|倉儲|有限公司(?!.*百貨)|企業社|工廠/i;

/** 名稱明確為咖啡 */
const STRICT_CAFE_ALLOW_NAME_RE =
  /咖啡廳|咖啡館|咖啡店|珈琲|咖啡|coffee|café|cafe|espresso|latte/i;

/** 咖啡分類排除（優先於一切正向條件） */
const COFFEE_EXCLUDED_NAME_RE =
  /紅茶|茶飲|手搖|果汁|冰品|豆花|燒餅|早餐|加水站|加水屋|加水|水站|水屋|飲水|RO水|桶裝水|礦泉水|純水|濾水/i;

/** 無咖啡名稱時，僅有泛用 type 不算咖啡 */
const GENERIC_TYPES_NEED_COFFEE_NAME = ["store", "food", "point_of_interest"] as const;

/** @deprecated 使用 COFFEE_EXCLUDED_NAME_RE */
const STRICT_CAFE_DENY_NAME_RE = COFFEE_EXCLUDED_NAME_RE;

/** 嚴格百貨 */
const STRICT_MALL_TYPES = ["department_store", "shopping_mall"] as const;
const STRICT_MALL_DENY_TYPES = [
  "restaurant",
  "meal_takeaway",
  "meal_delivery",
  "food_store",
  "fast_food_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "dessert_shop",
  "bar",
  "night_club",
  "market",
  "flea_market",
  "book_store",
  "bookstore",
  "clothing_store",
  "shoe_store",
  "gift_shop",
  "jewelry_store",
  "store",
  "corporate_office",
  "office",
  "real_estate_agency",
  "convenience_store",
  "supermarket",
  "grocery_store",
] as const;
const STRICT_MALL_DENY_NAME_RE =
  /餐廳|素食|蔬食|小吃|麵店|火鍋|燒肉|早餐|夜市|市場|攤|商務廣場|紅豆餅|豆漿|咖啡|烘焙|甜點/i;
const STRICT_MALL_ALLOW_NAME_RE =
  /百貨|三越|新光|遠百|大遠百|sogo|SOGO|夢時代|義享|Outlet|OUTLET|購物中心|百貨公司|SKM|大立|漢神|義享天地/i;

/** 商圈白名單（名稱 / 地址關鍵字） */
const DISTRICT_ALLOW_NAME_RE =
  /商圈|百貨|mall|department|夜市|market|老街|outlet|plaza|購物|shopping|文創|禮品|名產|souvenir|伴手禮|特產|商店街|步行街|徒步|潮流|市集|駁二|瑞豐|六合|自強|饒河|通化|堀江|新崛江|三鳳|鹽埕|旗津|夢時代|漢神|新光|遠百|大遠百|sogo|SOGO|SKM|大立|義享/i;

/** 聚集型商業區語境（單點餐飲/咖啡需有此才不排除） */
const DISTRICT_AGGREGATE_CONTEXT_RE =
  /夜市|商圈|商店街|購物中心|百貨|Outlet|OUTLET|mall|plaza|老街|市集|駁二|文創|美食街|徒步|商場|地下街/i;

/** 高權重 Google types */
const DISTRICT_PRIORITY_TYPES = [
  "shopping_mall",
  "department_store",
  "market",
  "flea_market",
  "tourist_attraction",
  "town_square",
  "plaza",
] as const;

const DISTRICT_DENY_NAME_RE =
  /診所|醫院|牙醫|五金|水電|水電行|汽車材料|汽配|輪胎|住宅|社區|辦公室|辦公大樓|商務大樓|補習|幼兒園|托育|美容材料|建材|磁磚|衛浴設備|當舖|典當/i;

const DISTRICT_STANDALONE_FOOD_TYPES = [
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "meal_takeaway",
  "fast_food_restaurant",
  "dessert_shop",
  "ice_cream_shop",
] as const;

const ATTRACTION_TYPES = [
  "tourist_attraction",
  "museum",
  "art_gallery",
  "historical_landmark",
  "monument",
  "zoo",
  "aquarium",
  "cultural_center",
] as const;

const ATTRACTION_DENY_TYPES = [
  "book_store",
  "bookstore",
  "library",
  "store",
  "shopping_mall",
  "department_store",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "meal_takeaway",
  "food_store",
] as const;

const DISTRICT_NAME_RE =
  /夜市|商圈|商店街|步行街|老街|觀光|文創|市集|商街|美食街|街區|徒步|潮流|駁二|堀江|新崛江|三鳳|六合|瑞豐|自強|饒河|通化|旗津|鹽埕|伴手禮|名產|禮品|特產|outlet|plaza|購物/i;

const FOOD_TYPES = [
  "restaurant",
  "food",
  "meal_takeaway",
  "fast_food_restaurant",
  "food_store",
] as const;

const FOOD_DENY_TYPES = ["cafe", "coffee_shop", "bakery", "dessert_shop", "shopping_mall", "department_store"] as const;

const PARK_TYPES = ["park", "national_park", "botanical_garden", "hiking_area"] as const;

const NIGHT_TYPES = ["bar", "wine_bar", "night_club", "pub"] as const;

const DISPLAY_LABELS: Record<PlaceCategory, string> = {
  cafe: "咖啡",
  food: "美食",
  shopping_mall: "商圈",
  district: "商圈",
  attraction: "景點",
  bookstore: "書店",
  nightlife: "夜晚",
  park: "公園",
  unknown: "地點",
};

function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, "_");
}

export function collectPlaceTypes(place: PlaceLike): string[] {
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

function hasBlockedType(types: string[], blocked: readonly string[]): boolean {
  return hasAnyType(types, blocked);
}

function placeBlob(place: PlaceLike): string {
  return `${place.name ?? ""} ${place.address ?? ""}`;
}

function isGloballyDenied(place: PlaceLike): boolean {
  const name = place.name ?? "";
  if (name && GLOBAL_DENY_NAME_RE.test(name)) return true;
  return hasBlockedType(collectPlaceTypes(place), GLOBAL_DENY_TYPES);
}

export function matchesAllExplore(place: PlaceLike): boolean {
  if (isGloballyDenied(place)) return false;
  const types = collectPlaceTypes(place);
  if (hasBlockedType(types, GLOBAL_DENY_TYPES)) return false;
  if (hasAnyType(types, GLOBAL_ALLOW_TYPES)) return true;
  return inferPlaceCategory(place) !== "unknown";
}

/** 茶飲、加水站、冰品等（即使 types 含 cafe 也排除） */
export function isDrinkOrSnackFoodPlace(place: PlaceLike): boolean {
  const name = place.name ?? "";
  const blob = placeBlob(place);
  return COFFEE_EXCLUDED_NAME_RE.test(name) || COFFEE_EXCLUDED_NAME_RE.test(blob);
}

function hasCoffeeName(place: PlaceLike): boolean {
  const name = place.name ?? "";
  return STRICT_CAFE_ALLOW_NAME_RE.test(name);
}

function primaryTypeIsCafe(place: PlaceLike): boolean {
  return normalizeType(place.primaryType ?? "") === "cafe";
}

function typesIncludeCafe(place: PlaceLike): boolean {
  return collectPlaceTypes(place).includes("cafe");
}

/**
 * 咖啡分類：須符合 (primaryType=cafe | types 含 cafe | 名稱含咖啡關鍵字)，
 * 且不得命中排除關鍵字；store/food/poi 無咖啡名稱一律排除。
 */
function matchesCafeStrict(place: PlaceLike): boolean {
  if (isGloballyDenied(place)) return false;
  if (isDrinkOrSnackFoodPlace(place)) return false;

  const name = place.name ?? "";
  const blob = placeBlob(place);
  if (COFFEE_EXCLUDED_NAME_RE.test(name) || COFFEE_EXCLUDED_NAME_RE.test(blob)) {
    return false;
  }

  const hasName = hasCoffeeName(place);
  const types = collectPlaceTypes(place);

  if (
    !hasName &&
    hasAnyType(types, GENERIC_TYPES_NEED_COFFEE_NAME) &&
    !primaryTypeIsCafe(place) &&
    !typesIncludeCafe(place)
  ) {
    return false;
  }

  if (primaryTypeIsCafe(place)) return true;
  if (typesIncludeCafe(place)) return true;
  if (hasName) return true;

  return false;
}

/** 供卡片 tag、文案等與探索分類一致 */
export function isExploreCoffeePlace(place: PlaceLike): boolean {
  return matchesCafeStrict(place);
}

function isStandaloneFoodOrCafeForDistrict(place: PlaceLike): boolean {
  const types = collectPlaceTypes(place);
  const blob = placeBlob(place);
  if (!hasAnyType(types, DISTRICT_STANDALONE_FOOD_TYPES)) return false;
  if (hasAnyType(types, STRICT_MALL_TYPES)) return false;
  if (DISTRICT_AGGREGATE_CONTEXT_RE.test(blob)) return false;
  if (DISTRICT_ALLOW_NAME_RE.test(place.name ?? "")) return false;
  return true;
}

function isDistrictRetailNoise(name: string): boolean {
  return /模型|皮件|玩具|專賣|材料行|修車|機車行|商行(?!街)/i.test(name);
}

/** 嚴格百貨（併入商圈邏輯，保留供相容） */
function matchesDepartmentStoreStrict(place: PlaceLike): boolean {
  if (!matchesDistrictStrict(place)) return false;
  const types = collectPlaceTypes(place);
  const name = place.name ?? "";
  return hasAnyType(types, STRICT_MALL_TYPES) || STRICT_MALL_ALLOW_NAME_RE.test(name);
}

function matchesAttractionStrict(place: PlaceLike): boolean {
  const types = collectPlaceTypes(place);
  if (isGloballyDenied(place)) return false;
  if (hasBlockedType(types, ATTRACTION_DENY_TYPES)) return false;
  if (hasAnyType(types, ["book_store", "bookstore", "library"])) return false;
  return hasAnyType(types, ATTRACTION_TYPES);
}

/**
 * 商圈：適合逛街、探索、聚集人氣的區域
 * （百貨、夜市、老街、伴手禮、文創商圈、購物街等；排除單點餐廳/咖啡/診所/五金等）
 */
function matchesDistrictStrict(place: PlaceLike): boolean {
  const types = collectPlaceTypes(place);
  const name = place.name ?? "";
  const blob = placeBlob(place);

  if (isGloballyDenied(place)) return false;
  if (DISTRICT_DENY_NAME_RE.test(name) || DISTRICT_DENY_NAME_RE.test(blob)) return false;
  if (/商務廣場|商業大樓(?!.*百貨)/i.test(blob) && !DISTRICT_ALLOW_NAME_RE.test(name)) {
    return false;
  }
  if (isStandaloneFoodOrCafeForDistrict(place)) return false;
  if (isDistrictRetailNoise(name) && !DISTRICT_ALLOW_NAME_RE.test(name)) return false;
  if (/專賣|工作室|材料行|修車|機車行|五金|水電/i.test(name) && !DISTRICT_ALLOW_NAME_RE.test(blob)) {
    return false;
  }

  if (hasAnyType(types, DISTRICT_PRIORITY_TYPES)) {
    if (hasAnyType(types, ["tourist_attraction", "town_square", "plaza"])) {
      if (DISTRICT_ALLOW_NAME_RE.test(blob) || DISTRICT_NAME_RE.test(blob)) return true;
      if (hasAnyType(types, ["shopping_mall", "department_store", "market", "flea_market"])) {
        return true;
      }
      return false;
    }
    if (hasAnyType(types, ["market", "flea_market"])) {
      return (
        DISTRICT_ALLOW_NAME_RE.test(blob) ||
        DISTRICT_NAME_RE.test(blob) ||
        /夜市|市集|老街/i.test(name)
      );
    }
    if (hasAnyType(types, STRICT_MALL_TYPES)) {
      if (STRICT_MALL_DENY_NAME_RE.test(name) && !STRICT_MALL_ALLOW_NAME_RE.test(name)) return false;
      return true;
    }
    return true;
  }

  if (DISTRICT_ALLOW_NAME_RE.test(name) || DISTRICT_NAME_RE.test(blob)) {
    if (hasBlockedType(types, [
      ...STRICT_MALL_DENY_TYPES,
      "doctor",
      "dentist",
      "hospital",
      "hardware_store",
      "corporate_office",
      "office",
    ])) {
      return DISTRICT_AGGREGATE_CONTEXT_RE.test(blob);
    }
    return true;
  }

  if (hasAnyType(types, ["gift_shop"]) && /伴手禮|名產|禮品|特產|souvenir/i.test(blob)) {
    return true;
  }

  if (DISTRICT_NAME_RE.test(blob) && !hasBlockedType(types, ["doctor", "dentist", "hospital", "hardware_store"])) {
    return true;
  }

  return false;
}

function matchesFoodStrict(place: PlaceLike): boolean {
  const types = collectPlaceTypes(place);
  const name = place.name ?? "";
  if (isGloballyDenied(place)) return false;
  if (matchesCafeStrict(place)) return false;
  /** 紅茶、手搖等：即使標為 cafe 也歸美食 */
  if (isDrinkOrSnackFoodPlace(place)) return true;
  if (hasBlockedType(types, FOOD_DENY_TYPES)) return false;
  if (COFFEE_EXCLUDED_NAME_RE.test(name) && !/餐廳|食堂|美食|料理/i.test(name)) return false;
  return hasAnyType(types, FOOD_TYPES);
}

function matchesParkStrict(place: PlaceLike): boolean {
  const types = collectPlaceTypes(place);
  if (isGloballyDenied(place)) return false;
  if (hasBlockedType(types, ["restaurant", "shopping_mall", "department_store", "cafe"])) return false;
  return hasAnyType(types, PARK_TYPES);
}

function matchesNightStrict(place: PlaceLike): boolean {
  const types = collectPlaceTypes(place);
  const blob = placeBlob(place);
  if (isGloballyDenied(place)) return false;
  if (hasAnyType(types, NIGHT_TYPES)) return true;
  if (/夜市/i.test(blob) && hasAnyType(types, ["market", "flea_market", "tourist_attraction"])) {
    return true;
  }
  return false;
}

function inferPlaceCategory(place: PlaceLike): PlaceCategory {
  if (matchesCafeStrict(place)) return "cafe";
  if (isDrinkOrSnackFoodPlace(place)) return "food";
  if (matchesDistrictStrict(place) || matchesDepartmentStoreStrict(place)) return "district";
  if (hasAnyType(collectPlaceTypes(place), ["book_store", "bookstore"])) return "bookstore";
  if (matchesNightStrict(place)) return "nightlife";
  if (matchesFoodStrict(place)) return "food";
  if (matchesParkStrict(place)) return "park";
  if (matchesAttractionStrict(place)) return "attraction";
  return "unknown";
}

export function getPlaceCategory(place: PlaceLike): PlaceCategory {
  return inferPlaceCategory(place);
}

export function getExploreCategoryDisplayLabel(place: PlaceLike): string {
  return DISPLAY_LABELS[getPlaceCategory(place)];
}

const STRICT_LABEL_MATCHERS: Record<string, (place: PlaceLike) => boolean> = {
  咖啡: matchesCafeStrict,
  景點: matchesAttractionStrict,
  商圈: matchesDistrictStrict,
  美食: matchesFoodStrict,
  公園: matchesParkStrict,
  夜晚: matchesNightStrict,
};

function getCategoryLabel(selected: ExploreCategory | string): string {
  return typeof selected === "string" ? selected : selected.label;
}

/**
 * 探索頁分類比對。
 * selectedCategory !==「全部」時為嚴格模式：僅符合 types 或白名單關鍵字，不符合就排除。
 */
export function matchesCategory(place: PlaceLike, selected: ExploreCategory | string): boolean {
  const label = getCategoryLabel(selected);
  if (label === "全部") return matchesAllExplore(place);
  const matcher = STRICT_LABEL_MATCHERS[label];
  if (!matcher) return false;
  return matcher(place);
}

export function filterByExploreCategory<T extends PlaceLike>(
  places: T[],
  selected: ExploreCategory | string,
): T[] {
  return places.filter((p) => matchesCategory(p, selected));
}

export function isCategoryResultSparse(count: number): boolean {
  return count < MIN_CATEGORY_RESULTS;
}

export function getExploreCategoryEmptyMessage(categoryId: string, locale: Locale): string {
  const key = `explore.empty.${categoryId}`;
  const msg = translate(locale, key);
  return msg === key ? translate(locale, "explore.empty.all") : msg;
}
