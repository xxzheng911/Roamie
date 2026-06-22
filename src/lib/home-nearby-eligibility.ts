import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import type { PlaceResult } from "@/lib/place-result";

/** 首頁只接受真實 Google place_id，排除 mock / saved 假 id */
export function isVerifiedGooglePlaceId(id: string | null | undefined): boolean {
  const value = (id ?? "").trim();
  if (!value || value === "Unknown") return false;
  if (value.startsWith("mock-") || value.startsWith("saved-")) return false;
  return true;
}

export type HomeNearbyPeriod = "day" | "late_night";

export type HomeNearbyPickPlace = Pick<
  PlaceResult,
  | "id"
  | "name"
  | "businessStatus"
  | "openStatus"
  | "rating"
  | "userRatingCount"
  | "primaryType"
  | "types"
  | "lat"
  | "lng"
>;

/** 21:00 ～ 05:00 */
export function isHomeLateNightHour(hour: number): boolean {
  return hour >= 21 || hour < 5;
}

export function homeNearbyPeriodFromHour(hour: number): HomeNearbyPeriod {
  return isHomeLateNightHour(hour) ? "late_night" : "day";
}

export function localHourInTimeZone(at: Date, timeZone = "Asia/Taipei"): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(at),
  );
}

const PERMANENT_EXCLUDED_TYPES = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "guest_house",
  "resort_hotel",
  "bed_and_breakfast",
  "extended_stay_hotel",
  "private_guest_room",
  "campground",
  "rv_park",
  "library",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "hospital",
  "pharmacy",
  "drugstore",
  "clinic",
  "dentist",
  "gas_station",
  "parking",
  "atm",
  "bank",
  "convenience_store",
  "car_repair",
  "car_wash",
  "storage",
  "insurance_agency",
  "hardware_store",
  "home_goods_store",
  "real_estate_agency",
  "local_government_office",
  "city_hall",
  "police",
  "church",
  "cemetery",
  "water_point",
  "drinking_water",
]);

/** 首頁附近推薦允許的 Google type */
const HOME_RECOMMENDED_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "restaurant",
  "meal_takeaway",
  "fast_food_restaurant",
  "bar",
  "night_club",
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
  "historical_landmark",
  "monument",
]);

const NIGHT_PREFERRED_TYPES = new Set([
  "bar",
  "night_club",
  "restaurant",
  "meal_takeaway",
  "fast_food_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
]);

const DAY_PREFERRED_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "restaurant",
  "meal_takeaway",
  "fast_food_restaurant",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "market",
  "flea_market",
  "shopping_mall",
  "department_store",
  "book_store",
  "park",
  "historical_landmark",
  "monument",
]);

const NIGHT_NAME_RE =
  /居酒|酒吧|餐酒|宵夜|深夜|拉麵|ramen|焼肉|烧肉|yakiniku|火鍋|hotpot|串燒|yakitori|izakaya|bar|pub|night|燒肉|火鍋/i;

const DAY_NAME_RE =
  /咖啡|cafe|餐廳|餐館|小吃|景點|博物|美術|百貨|商場|市集|market|mall|gallery|museum|書店|book/i;

const MERCHANT_NAME_RE =
  /咖啡|cafe|餐|bar|pub|居酒|宵夜|烘焙|甜點|蛋糕|小吃|火鍋|燒肉|拉麵|壽司|bistro|restaurant|bakery|dessert|書店|book/i;

const EXCLUDED_NAME_RE =
  /加水|加水站|加水屋|水站|water\s*point|drinking\s*water|\batm\b|提款|銀行|\bbank\b|停車|parking|修車|car\s*wash|car\s*repair|診所|clinic|dentist|藥局|pharmacy|醫院|hospital|政府|郵局|post\s*office/i;

const VAGUE_ONLY_TYPES = new Set(["establishment", "point_of_interest"]);

const GENERIC_STORE_TYPES = new Set([
  "store",
  "shopping_center",
  "home_goods_store",
  "hardware_store",
  "clothing_store",
  "supermarket",
  "grocery_store",
  "convenience_store",
]);

const LODGING_NAME_RE = /飯店|旅館|民宿|hotel|motel|hostel|lodging|inn\b|resort/i;

function normalizeTypes(place: HomeNearbyPickPlace): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

function isOpenNow(place: HomeNearbyPickPlace): boolean {
  return place.openStatus === "open" || place.openStatus === "closing_soon";
}

function isOpenUnknown(place: HomeNearbyPickPlace): boolean {
  return place.openStatus == null || place.openStatus === "unknown";
}

function isClosedNow(place: HomeNearbyPickPlace): boolean {
  return (
    place.openStatus === "closed_now" ||
    place.openStatus === "permanently_closed" ||
    place.openStatus === "temporarily_closed"
  );
}

export function hasPermanentExcludedType(place: HomeNearbyPickPlace): boolean {
  return normalizeTypes(place).some((t) => PERMANENT_EXCLUDED_TYPES.has(t));
}

export function hasHomeRecommendedType(place: HomeNearbyPickPlace): boolean {
  return normalizeTypes(place).some((t) => HOME_RECOMMENDED_TYPES.has(t));
}

export function hasZeroRatingAndReviews(place: HomeNearbyPickPlace): boolean {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating <= 0 && reviews <= 0;
}

export function hasUsableRatingSignal(place: HomeNearbyPickPlace): boolean {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating > 0 || reviews > 0;
}

export function isPurePoiEstablishmentOnly(place: HomeNearbyPickPlace): boolean {
  const types = normalizeTypes(place);
  if (types.length === 0) return true;
  return types.every((t) => VAGUE_ONLY_TYPES.has(t) || t === "food" || t === "store");
}

export function hasExcludedNameKeyword(place: HomeNearbyPickPlace): boolean {
  return EXCLUDED_NAME_RE.test(place.name ?? "");
}

export function isGenericNonTravelStore(place: HomeNearbyPickPlace): boolean {
  if (hasHomeRecommendedType(place)) return false;
  if (MERCHANT_NAME_RE.test(place.name ?? "")) return false;
  const types = normalizeTypes(place);
  if (types.length === 0) return true;
  return types.every(
    (t) =>
      GENERIC_STORE_TYPES.has(t) ||
      VAGUE_ONLY_TYPES.has(t) ||
      t === "food" ||
      t === "store",
  );
}

/** 永久硬排除：非旅遊／基礎設施／已打烊 */
export function passesHomeNearbyHardExclusions(place: HomeNearbyPickPlace): boolean {
  if (!isVerifiedGooglePlaceId(place.id)) return false;

  const name = (place.name ?? "").trim();
  if (!name || name === "Unknown") return false;
  if (LODGING_NAME_RE.test(name)) return false;
  if (hasExcludedNameKeyword(place)) return false;

  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  if (biz === "CLOSED_PERMANENTLY" || biz === "CLOSED_TEMPORARILY") return false;
  if (biz && biz !== "OPERATIONAL") return false;

  if (isClosedNow(place)) return false;
  if (hasPermanentExcludedType(place)) return false;
  if (isGenericNonTravelStore(place)) return false;

  return true;
}

/** @deprecated 請改用 passesHomeNearbyHardExclusions */
export function passesPermanentHomeNearbyRules(place: HomeNearbyPickPlace): boolean {
  return passesHomeNearbyHardExclusions(place);
}

export function matchesNightPreferredPlace(place: HomeNearbyPickPlace): boolean {
  const types = normalizeTypes(place);
  if (types.some((t) => NIGHT_PREFERRED_TYPES.has(t))) return true;
  return NIGHT_NAME_RE.test(place.name ?? "");
}

export function matchesDayPreferredPlace(place: HomeNearbyPickPlace): boolean {
  const types = normalizeTypes(place);
  if (types.some((t) => DAY_PREFERRED_TYPES.has(t))) return true;
  return DAY_NAME_RE.test(place.name ?? "");
}

export function matchesHomeTypeGroup(
  place: HomeNearbyPickPlace,
  group: readonly string[],
): boolean {
  const types = normalizeTypes(place);
  return group.some((g) => types.includes(g));
}

function matchesPeriodPreference(place: HomeNearbyPickPlace, period: HomeNearbyPeriod): boolean {
  return period === "late_night"
    ? matchesNightPreferredPlace(place)
    : matchesDayPreferredPlace(place);
}

function passesRecommendedTypeGate(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  return hasHomeRecommendedType(place) && matchesPeriodPreference(place, period);
}

function ratingAtLeast(place: HomeNearbyPickPlace, min: number): boolean {
  return (place.rating ?? 0) >= min;
}

function reviewsAtLeast(place: HomeNearbyPickPlace, min: number): boolean {
  return (place.userRatingCount ?? 0) >= min;
}

/** Level 1：營業中 + 高評分 + 足夠評論 + 類型符合 */
export function passesHomeNearbyLevel1(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  if (!passesHomeNearbyHardExclusions(place)) return false;
  if (!isOpenNow(place)) return false;
  if (!ratingAtLeast(place, 4.0) || !reviewsAtLeast(place, 10)) return false;
  return passesRecommendedTypeGate(place, period);
}

/** Level 2：營業中 + 稍低門檻（深夜可用） */
export function passesHomeNearbyLevel2(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  if (!passesHomeNearbyHardExclusions(place)) return false;
  if (!isOpenNow(place)) return false;
  if (!ratingAtLeast(place, 3.8) || !reviewsAtLeast(place, 5)) return false;
  return passesRecommendedTypeGate(place, period);
}

/** Level 3：營業時間 unknown + 高評分 */
export function passesHomeNearbyLevel3(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  if (!passesHomeNearbyHardExclusions(place)) return false;
  if (!isOpenUnknown(place)) return false;
  if (!ratingAtLeast(place, 4.0) || !reviewsAtLeast(place, 10)) return false;
  return passesRecommendedTypeGate(place, period);
}

/** Level 4：一般熱門，仍需有評分信號 + 推薦類型 */
export function passesHomeNearbyLevel4(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  if (!passesHomeNearbyHardExclusions(place)) return false;
  if (isClosedNow(place)) return false;
  if (hasZeroRatingAndReviews(place)) return false;
  if (!hasUsableRatingSignal(place)) return false;
  return passesRecommendedTypeGate(place, period);
}

/** 最後手段：僅在更高層級完全不足時使用；仍排除 0 評分 0 評論 */
export function passesHomeNearbyLastResort(place: HomeNearbyPickPlace): boolean {
  if (!passesHomeNearbyHardExclusions(place)) return false;
  if (isClosedNow(place)) return false;
  if (hasZeroRatingAndReviews(place)) return false;
  return hasHomeRecommendedType(place) || MERCHANT_NAME_RE.test(place.name ?? "");
}

/** @deprecated 使用 passesHomeNearbyLevel1 */
export function passesStrictHomeNearbyTier(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  return passesHomeNearbyLevel1(place, period);
}

/** @deprecated 使用 passesHomeNearbyLevel3 */
export function passesUnknownOpenHomeNearbyTier(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  return passesHomeNearbyLevel3(place, period);
}

/** @deprecated 使用 passesHomeNearbyLevel2 */
export function passesRelaxedHomeNearbyTier(
  place: HomeNearbyPickPlace,
  period: HomeNearbyPeriod,
): boolean {
  return passesHomeNearbyLevel2(place, period);
}

/** @deprecated 使用 passesHomeNearbyLevel4 */
export function passesOperationalHomeNearbyFallback(place: HomeNearbyPickPlace): boolean {
  return passesHomeNearbyLevel4(place, "day");
}

export function openStatusSortRank(openStatus?: PlaceOpenStatus | null): number {
  if (openStatus === "open" || openStatus === "closing_soon") return 0;
  if (openStatus === "unknown" || openStatus == null) return 1;
  return 2;
}
