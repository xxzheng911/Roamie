import type { PlaceResult } from "@/lib/place-result";
import { FOOD_MERCHANT_DENY_RE } from "@/lib/place-category";

type PlaceLike = Pick<PlaceResult, "primaryType" | "name"> & {
  address?: string | null;
};

/** Google Places 類型：探索頁一律排除 */
export const EXPLORE_EXCLUDED_TYPES = [
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
  "guest_house",
  "resort_hotel",
  "bed_and_breakfast",
  "extended_stay_hotel",
  "private_guest_room",
  "doctor",
  "dentist",
  "hospital",
  "pharmacy",
  "veterinary_care",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "church",
  "hindu_temple",
  "mosque",
  "synagogue",
  "local_government_office",
  "city_hall",
  "real_estate_agency",
  "insurance_agency",
  "lawyer",
  "accounting",
  "bank",
  "atm",
  "post_office",
  "corporate_office",
  "consultant",
  "electrician",
  "plumber",
  "roofing_contractor",
  "moving_company",
  "storage",
  "warehouse_store",
  "wholesaler",
  "supermarket",
  "grocery_store",
  "convenience_store",
  "gas_station",
  "parking",
  "car_wash",
  "car_rental",
  "locksmith",
  "laundry",
  "dry_cleaning",
  "beauty_salon",
  "hair_salon",
  "hair_care",
  "nail_salon",
  "spa",
  "gym",
  "fitness_center",
  "physiotherapist",
  "dental_clinic",
  "medical_lab",
  "funeral_home",
  "cemetery",
  "child_care_agency",
  "tutoring",
] as const;

/** 明確適合旅遊探索的類型 */
export const TRAVEL_FRIENDLY_TYPES = [
  "cafe",
  "coffee_shop",
  "bakery",
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "food_store",
  "fast_food_restaurant",
  "ice_cream_shop",
  "dessert_shop",
  "confectionery",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "cultural_center",
  "historical_landmark",
  "monument",
  "park",
  "national_park",
  "botanical_garden",
  "zoo",
  "aquarium",
  "amusement_park",
  "shopping_mall",
  "department_store",
  "book_store",
  "bookstore",
  "library",
  "bar",
  "wine_bar",
  "night_club",
  "pub",
  "performing_arts_theater",
  "movie_theater",
  "market",
  "flea_market",
  "gift_shop",
  "jewelry_store",
  "clothing_store",
  "shoe_store",
  "home_decor",
  "furniture_store",
  "antique_store",
  "art_studio",
  "craft_store",
  "tourist_information_center",
  "visitor_center",
  "hiking_area",
  "marina",
  "beach",
  "plaza",
  "town_square",
] as const;

const EXCLUDED_NAME_RE =
  /汽車|機車|摩托|濾網|零件|專賣|維修|保修|五金|工具行|工具店|補習|診所|醫院|牙科|牙醫|汽配|輪胎|電瓶|vespa|機油|改裝|補胎|鋁圈|排氣管|煞車|制動|離合器|變速箱|傳動|電單車|重機|autoparts|auto\s*parts|motor\s*cycle|motorcycle|filter|汽配|機車行|汽車美容|洗車|停車場|加油站|有限公司|股份有限|企業社|工廠|倉儲|物流|貨運|補習班|幼兒園|托育|教堂|寺廟|宮廟|靈骨|殯葬|墓園|當鋪|典當|銀樓回收/i;

const LODGING_NAME_RE =
  /飯店|旅館|民宿|住宿|宾馆|hotel|motel|hostel|lodging|inn\b|resort/i;

function normalizeType(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase();
}

function typeMatches(type: string, candidates: readonly string[]): boolean {
  return candidates.some((t) => type === t || type.includes(t));
}

export function isExcludedExploreType(primaryType: string | null | undefined): boolean {
  const t = normalizeType(primaryType);
  if (!t) return false;
  return typeMatches(t, EXPLORE_EXCLUDED_TYPES);
}

export function isTravelFriendlyType(primaryType: string | null | undefined): boolean {
  const t = normalizeType(primaryType);
  if (!t) return false;
  return typeMatches(t, TRAVEL_FRIENDLY_TYPES);
}

/** @deprecated 請改用 isTravelFriendlyPlace；保留給舊呼叫端 */
export function isExploreLodgingPlace(
  primaryType: string | null | undefined,
  name?: string | null,
): boolean {
  return isExcludedExploreType(primaryType) || LODGING_NAME_RE.test(name ?? "");
}

/**
 * 探索地圖／推薦列表：是否適合一般旅遊探索。
 * 排除汽配、機車行、醫療、住宿、學校、政府等；僅保留餐飲、景點、商圈等。
 */
export function isTravelFriendlyPlace(place: PlaceLike): boolean {
  const name = (place.name ?? "").trim();
  const type = normalizeType(place.primaryType);

  if (name && EXCLUDED_NAME_RE.test(name)) return false;
  if (name && FOOD_MERCHANT_DENY_RE.test(name)) return false;
  if (name && LODGING_NAME_RE.test(name)) return false;
  if (isExcludedExploreType(type)) return false;

  if (isTravelFriendlyType(type)) return true;

  /** 泛用 store / point_of_interest：名稱需像可逛的店，否則排除 */
  if (type === "store" || type === "point_of_interest" || type === "establishment") {
    return /咖啡|餐廳|餐館|食堂|小吃|甜點|蛋糕|烘焙|書店|書局|文創|藝廊|展覽|酒吧|居酒|拉麵|壽司|火鍋|燒肉|早午餐|brunch|cafe|bistro|gallery|museum|park/i.test(
      name,
    );
  }

  return false;
}

export function filterExplorePlaces<T extends PlaceLike>(places: T[] | null | undefined): T[] {
  if (!Array.isArray(places)) {
    console.warn("[explore] filterExplorePlaces: expected array, got", places);
    return [];
  }
  return places.filter(isTravelFriendlyPlace);
}
