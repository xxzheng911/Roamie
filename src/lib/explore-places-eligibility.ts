import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { isLodgingPlace } from "@/lib/lodging-place-filter";
import { passesCityExploreTouristValue, exploreCityTouristQualityScore } from "@/lib/explore-city-tourist-filter";
import {
  isExploreJapanFoodContext,
  japanFoodQualityScore,
  loadAuthorizedTabelogRankingCache,
  type TabelogRankingCache,
} from "@/lib/tabelog-reference";
import { distanceMeters } from "@/lib/map-explore";
import {
  exploreCategoryMaxDistanceMeters,
} from "@/lib/explore-search-radius";
import { isVerifiedGooglePlaceId } from "@/lib/home-nearby-eligibility";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { resolveOpenNow } from "@/lib/is-recommendable-place";
import { filterByExploreCategory, matchesCategory } from "@/lib/place-category";

export const EXPLORE_TIER12_MIN_RATING = 4.2;
export const EXPLORE_TIER12_MIN_REVIEWS = 100;
export const EXPLORE_TIER3_MIN_RATING = 4.0;
export const EXPLORE_TIER3_MIN_REVIEWS = 10;
export const EXPLORE_GLOBAL_MIN_REVIEWS = 10;
export const EXPLORE_CITY_FOOD_MIN_RATING = 3.8;
export const EXPLORE_CITY_FOOD_MIN_REVIEWS = 1;
export const EXPLORE_CITY_RELAXED_MIN_RATING = EXPLORE_CITY_FOOD_MIN_RATING;
export const EXPLORE_CITY_RELAXED_MIN_REVIEWS = EXPLORE_CITY_FOOD_MIN_REVIEWS;
export const EXPLORE_CITY_CATEGORY_MIN_DISPLAY = 5;
export const EXPLORE_FAMOUS_MIN_RATING = 4.0;
export const EXPLORE_FAMOUS_MIN_REVIEWS = 50;
export const EXPLORE_MAP_MIN_DISPLAY = 3;
export const EXPLORE_MAP_MAX_DISPLAY = 10;
export const EXPLORE_CITY_ALL_MIN_DISPLAY = 8;
export const EXPLORE_CITY_ALL_MAX_DISPLAY = 20;

export const EXPLORE_OPENING_LABEL_OPEN = "營業中";
export const EXPLORE_OPENING_LABEL_CLOSED = "休息中";
export const EXPLORE_OPENING_LABEL_UNKNOWN = "營業資訊暫缺";

/** @deprecated 使用 EXPLORE_TIER12_MIN_RATING */
export const EXPLORE_MIN_RATING = EXPLORE_TIER12_MIN_RATING;
/** @deprecated 使用 EXPLORE_TIER12_MIN_REVIEWS */
export const EXPLORE_MIN_REVIEWS = EXPLORE_TIER12_MIN_REVIEWS;
export const EXPLORE_COFFEE_MIN_RATING = EXPLORE_TIER12_MIN_RATING;
export const EXPLORE_COFFEE_MIN_REVIEWS = EXPLORE_TIER12_MIN_REVIEWS;

export type ExploreMapQualityTier = 1 | 2 | 3;

const EXPLORE_DENIED_TYPES = new Set([
  "park",
  "national_park",
  "botanical_garden",
  "water_point",
  "drinking_water",
  "atm",
  "bank",
  "gas_station",
  "parking",
  "parking_garage",
  "parking_lot",
  "car_repair",
  "car_wash",
  "hospital",
  "clinic",
  "dentist",
  "pharmacy",
  "drugstore",
  "doctor",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "local_government_office",
  "city_hall",
  "real_estate_agency",
  "storage",
  "insurance_agency",
  "convenience_store",
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "guest_house",
  "resort_hotel",
  "bed_and_breakfast",
  "extended_stay_hotel",
  "private_guest_room",
  "resort",
  "inn",
  "japanese_inn",
  "serviced_apartment",
  "apartment_hotel",
  "corporate_office",
  "townhall",
  "apartment_building",
  "housing_complex",
  "dormitory",
  "water_tower",
  "cemetery",
  "graveyard",
  "funeral_home",
  "crematorium",
  "columbarium",
  "memorial_park",
  "mortuary",
  "laundromat",
  "laundry",
]);

const EXPLORE_DENIED_NAME_RE =
  /加水|水站|飲水|water\s*point|drinking\s*water|停車場|加油站|ATM|銀行|診所|醫院|補習|幼兒園|墓園|當鋪|水塔|行政|倉庫|有限公司|公司行號|公寓|宿舍|旅館|飯店|酒店|民宿|住宿|hotel|hostel|motel|resort|lodging|洗衣/i;

const FAMOUS_PARK_NAME_RE =
  /國家公園|國家風景區|森林遊樂區|風景區|生态|生態|湿地|溼地|地質|森林公園|都會公園|寿山|壽山|澄清湖|莲池潭|蓮池潭|爱河|愛河|驳二|駁二|西子灣|旗津/i;

type ExplorePlace = Pick<
  PlaceResult,
  | "id"
  | "name"
  | "businessStatus"
  | "openStatus"
  | "openNow"
  | "rating"
  | "userRatingCount"
  | "primaryType"
  | "types"
  | "photoName"
  | "lat"
  | "lng"
  | "openStatusLabel"
  | "normalizedOpeningLabel"
> & { isSavedFavorite?: boolean };

function allTypes(place: ExplorePlace): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

function isFamousSightPark(place: ExplorePlace): boolean {
  const name = place.name ?? "";
  if (FAMOUS_PARK_NAME_RE.test(name)) return true;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating >= 4.0 && reviews >= 50;
}

const OUTDOOR_SIGHT_TYPES = new Set([
  "tourist_attraction",
  "monument",
  "historical_landmark",
  "cultural_landmark",
  "historical_place",
  "plaza",
  "town_square",
]);

function isFamousOutdoorSight(place: ExplorePlace, categoryId: string): boolean {
  if (categoryId !== "sight") return false;
  const types = allTypes(place);
  if (!types.some((t) => OUTDOOR_SIGHT_TYPES.has(t))) return false;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  if (rating >= EXPLORE_FAMOUS_MIN_RATING && reviews >= EXPLORE_FAMOUS_MIN_REVIEWS) return true;
  return FAMOUS_PARK_NAME_RE.test(place.name ?? "");
}

function hasCredibleRating(reviews: number | null | undefined): boolean {
  return reviews != null && reviews > 0;
}

function passesExploreMinimalDisplay(place: ExplorePlace): boolean {
  if (place.isSavedFavorite) {
    return (place.name ?? "").trim().length >= 2;
  }

  if (!isVerifiedGooglePlaceId(place.id)) return false;

  const name = (place.name ?? "").trim();
  if (!name || name === "Unknown") return false;

  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  if (biz === "CLOSED_PERMANENTLY" || biz === "CLOSED_TEMPORARILY") return false;

  return true;
}

function passesExploreOperationalBase(place: ExplorePlace): boolean {
  if (!passesExploreMinimalDisplay(place)) return false;

  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  if (biz && biz !== "OPERATIONAL") return false;

  const rating = place.rating;
  if (rating == null || rating <= 0) return false;
  const reviews = place.userRatingCount ?? 0;
  if (reviews < EXPLORE_GLOBAL_MIN_REVIEWS) return false;

  return true;
}

const COFFEE_RELAXED_TYPES = new Set([
  "cafe",
  "coffee",
  "coffee_shop",
  "bakery",
  "dessert_shop",
  "ice_cream_shop",
]);

const COFFEE_RELAXED_NAME_RE =
  /咖啡|café|cafe|coffee|甜點|dessert|烘焙|patisserie|boulangerie|cake shop/i;

/** 咖啡分類：strict 不足時用 types / 名稱放寬（仍排除硬排除類型） */
export function filterCoffeeExplorePlaces<T extends ExplorePlace>(
  places: T[],
): T[] {
  const strict = filterByExploreCategory(places, "coffee");
  if (strict.length > 0) return strict;
  return places.filter((place) => passesCoffeeExploreRelaxed(place));
}

const CITY_SIGHT_RELAXED_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "amusement_park",
  "zoo",
  "aquarium",
  "performing_arts_theater",
  "historical_landmark",
  "cultural_landmark",
  "monument",
  "park",
  "national_park",
  "botanical_garden",
  "point_of_interest",
]);

const CITY_SIGHT_RELAXED_NAME_RE =
  /寺|廟|神社|神宮|塔|城|museum|shrine|temple|tower|landmark|sky|observatory|view|park|ガーデン|展望|景點|觀光/i;

const CITY_DISTRICT_RELAXED_TYPES = new Set([
  "shopping_mall",
  "department_store",
  "shopping_center",
  "market",
  "flea_market",
  "town_square",
  "plaza",
  "tourist_attraction",
  "point_of_interest",
]);

const CITY_DISTRICT_RELAXED_NAME_RE =
  /商圈|購物|百貨|mall|market|shopping|district|street|老街|夜市|表參道|原宿|澀谷|渋谷|新宿|銀座|秋葉原|明洞|暹罗|宁曼|downtown|centro|old town|city center/i;

const CITY_FOOD_RELAXED_TYPES = new Set([
  "restaurant",
  "food",
  "meal_takeaway",
  "food_store",
  "fast_food_restaurant",
  "bakery",
  "cafe",
  "coffee_shop",
]);

const CITY_FOOD_RELAXED_NAME_RE =
  /餐廳|餐館|美食|拉麵|壽司|燒肉|居酒屋|小吃|restaurant|ramen|sushi|izakaya|food|dining|bistro|レストラン|ラーメン|寿司|焼肉|グルメ|食堂|料理/i;

const CITY_FOOD_BAR_ONLY_TYPES = new Set(["bar", "pub", "wine_bar", "night_club"]);

export function isBarPrimaryFoodPlace(place: ExplorePlace): boolean {
  const types = allTypes(place);
  const hasRestaurant =
    types.some((t) =>
      ["restaurant", "food", "meal_takeaway", "food_store", "fast_food_restaurant", "bakery"].includes(t),
    ) || CITY_FOOD_RELAXED_NAME_RE.test(place.name ?? "");
  if (hasRestaurant) return false;
  return types.some((t) => CITY_FOOD_BAR_ONLY_TYPES.has(t));
}

export function passesCityFoodRating(place: ExplorePlace): boolean {
  return passesCityRelaxedRating(place);
}

export function passesCityRelaxedRating(place: ExplorePlace): boolean {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  if (reviews < EXPLORE_CITY_RELAXED_MIN_REVIEWS) return false;
  return rating >= EXPLORE_CITY_RELAXED_MIN_RATING;
}

function passesCityCategoryOperational(place: ExplorePlace): boolean {
  if (!passesExploreMinimalDisplay(place)) return false;
  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  if (biz && biz !== "OPERATIONAL") return false;
  return passesCityRelaxedRating(place);
}

export function exploreCategoryMinDisplay(cityMode?: boolean): number {
  return cityMode ? EXPLORE_CITY_CATEGORY_MIN_DISPLAY : EXPLORE_MAP_MIN_DISPLAY;
}

const CITY_NIGHT_RELAXED_TYPES = new Set([
  "bar",
  "pub",
  "night_club",
  "wine_bar",
  "restaurant",
  "meal_takeaway",
  "market",
  "flea_market",
  "tourist_attraction",
]);

const CITY_NIGHT_RELAXED_NAME_RE =
  /酒吧|居酒屋|宵夜|夜市|night|bar|izakaya|pub|lounge|sky bar|rooftop|nightlife|night market/i;

function passesCitySightRelaxed(place: ExplorePlace): boolean {
  if (!passesExploreHardExclusions(place, "sight", { cityMode: true })) return false;
  if (matchesCategory(place, "sight")) return true;
  const types = allTypes(place);
  if (types.some((t) => CITY_SIGHT_RELAXED_TYPES.has(t))) return true;
  return CITY_SIGHT_RELAXED_NAME_RE.test(place.name ?? "");
}

function passesCityDistrictRelaxed(place: ExplorePlace): boolean {
  if (!passesExploreHardExclusions(place, "district", { cityMode: true })) return false;
  if (matchesCategory(place, "district")) return true;
  const types = allTypes(place);
  if (types.some((t) => CITY_DISTRICT_RELAXED_TYPES.has(t))) return true;
  return CITY_DISTRICT_RELAXED_NAME_RE.test(`${place.name ?? ""} ${place.address ?? ""}`);
}

function passesCityFoodRelaxed(place: ExplorePlace): boolean {
  if (!passesExploreHardExclusions(place, "food", { cityMode: true })) return false;
  if (isBarPrimaryFoodPlace(place)) return false;
  if (matchesCategory(place, "food")) return true;
  const types = allTypes(place);
  if (types.some((t) => CITY_FOOD_RELAXED_TYPES.has(t))) return true;
  return CITY_FOOD_RELAXED_NAME_RE.test(place.name ?? "");
}

function passesCityNightRelaxed(place: ExplorePlace): boolean {
  if (!passesExploreHardExclusions(place, "night", { cityMode: true })) return false;
  if (matchesCategory(place, "night")) return true;
  const types = allTypes(place);
  if (types.some((t) => CITY_NIGHT_RELAXED_TYPES.has(t))) return true;
  return CITY_NIGHT_RELAXED_NAME_RE.test(`${place.name ?? ""} ${place.address ?? ""}`);
}

/** 城市模式：strict 不足時依 types / 名稱放寬（仍排除硬排除類型） */
export function filterCityExploreCategoryPlaces<T extends ExplorePlace>(
  places: T[],
  categoryId: string,
): T[] {
  if (categoryId === "coffee") return filterCoffeeExplorePlaces(places);
  if (categoryId === "all") {
    const strict = filterByExploreCategory(places, "all");
    return strict.length > 0 ? strict : places.filter((p) => matchesCategory(p, "all"));
  }

  const strict = filterByExploreCategory(places, categoryId);
  if (strict.length >= EXPLORE_MAP_MIN_DISPLAY) return strict;

  switch (categoryId) {
    case "sight":
      return places.filter((p) => passesCitySightRelaxed(p));
    case "district":
      return places.filter((p) => passesCityDistrictRelaxed(p));
    case "food":
      return places.filter((p) => passesCityFoodRelaxed(p));
    case "night":
      return places.filter((p) => passesCityNightRelaxed(p));
    default:
      return strict;
  }
}

export function passesCoffeeExploreRelaxed(place: ExplorePlace): boolean {
  if (!passesExploreHardExclusions(place, "coffee")) return false;
  if (matchesCategory(place, "coffee")) return true;

  const types = allTypes(place);
  if (types.some((t) => COFFEE_RELAXED_TYPES.has(t))) return true;

  const name = place.name ?? "";
  return COFFEE_RELAXED_NAME_RE.test(name);
}

/** 咖啡分類：評分三層 fallback（不因營業時間未知排除） */
export function classifyCoffeeExploreMapQualityTier(
  place: ExplorePlace,
): ExploreMapQualityTier | null {
  if (!passesCoffeeExploreRelaxed(place)) return null;

  if ((place.userRatingCount ?? 0) < EXPLORE_CITY_RELAXED_MIN_REVIEWS) return null;

  if (place.isSavedFavorite) {
    return resolveOpenNow(place) === false ? 3 : 1;
  }

  if (!isVerifiedGooglePlaceId(place.id)) return null;

  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  if (biz && biz !== "OPERATIONAL") return null;

  const rating = place.rating ?? 0;
  if (rating >= 4.0) return 1;
  if (rating >= 3.8) return 2;
  return 3;
}

export function simplifyExploreOpeningLabel(place: ExplorePlace): string {
  const openNow = resolveOpenNow(place);
  if (openNow === true) return EXPLORE_OPENING_LABEL_OPEN;
  if (openNow === false) return EXPLORE_OPENING_LABEL_CLOSED;
  return EXPLORE_OPENING_LABEL_UNKNOWN;
}

/** 探索頁硬排除（依分類調整公園規則） */
export function passesExploreHardExclusions(
  place: ExplorePlace,
  categoryId: string,
  options?: { cityMode?: boolean },
): boolean {
  const name = (place.name ?? "").trim();
  if (!name || name === "Unknown") return false;
  if (isBurialOrFuneralPlace(place)) return false;
  if (isLodgingPlace(place)) return false;
  if (options?.cityMode && !passesCityExploreTouristValue(place)) return false;
  if (EXPLORE_DENIED_NAME_RE.test(name)) return false;

  const types = allTypes(place);
  for (const t of types) {
    if (EXPLORE_DENIED_TYPES.has(t)) {
      if (
        categoryId === "sight" &&
        (t === "park" || t === "national_park" || t === "botanical_garden") &&
        isFamousSightPark(place)
      ) {
        continue;
      }
      return false;
    }
  }
  return true;
}

/** 探索地圖分層品質：1 營業中 → 2 待確認 → 3 休息中 */
export function classifyExploreMapQualityTier(
  place: ExplorePlace,
  categoryId = "all",
  options?: { cityMode?: boolean },
): ExploreMapQualityTier | null {
  if (categoryId === "coffee") {
    return classifyCoffeeExploreMapQualityTier(place);
  }

  if (options?.cityMode && categoryId !== "all") {
    if (!passesCityCategoryOperational(place)) return null;
    const openNow = resolveOpenNow(place);
    if (openNow === false) return 3;
    if (openNow === true) return 1;
    return 2;
  }

  if (!passesExploreMinimalDisplay(place)) return null;

  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  const openNow = resolveOpenNow(place);
  const operational = passesExploreOperationalBase(place);

  if (options?.cityMode && operational) {
    if (rating >= EXPLORE_TIER12_MIN_RATING && reviews >= EXPLORE_TIER12_MIN_REVIEWS) {
      return openNow === false ? 3 : openNow === true ? 1 : 2;
    }
    if (rating >= EXPLORE_FAMOUS_MIN_RATING && reviews >= EXPLORE_FAMOUS_MIN_REVIEWS) {
      return openNow === false ? 3 : 2;
    }
    if (rating >= EXPLORE_TIER3_MIN_RATING && reviews >= EXPLORE_TIER3_MIN_REVIEWS) {
      return 3;
    }
    return null;
  }

  if (place.isSavedFavorite) {
    if (openNow === false) return 3;
    if (openNow === true) return 1;
    return 2;
  }

  if (
    operational &&
    openNow === true &&
    rating >= EXPLORE_TIER12_MIN_RATING &&
    reviews >= EXPLORE_TIER12_MIN_REVIEWS
  ) {
    return 1;
  }

  if (operational && openNow !== true && openNow !== false) {
    if (rating >= EXPLORE_TIER12_MIN_RATING && reviews >= EXPLORE_TIER12_MIN_REVIEWS) {
      return 2;
    }
    if (rating >= EXPLORE_FAMOUS_MIN_RATING && reviews >= EXPLORE_FAMOUS_MIN_REVIEWS) {
      return 2;
    }
    if (
      categoryId === "sight" &&
      isFamousOutdoorSight(place, categoryId) &&
      rating >= EXPLORE_FAMOUS_MIN_RATING &&
      reviews >= EXPLORE_FAMOUS_MIN_REVIEWS
    ) {
      return 2;
    }
  }

  if (
    operational &&
    openNow === false &&
    rating >= EXPLORE_TIER3_MIN_RATING &&
    reviews >= EXPLORE_TIER3_MIN_REVIEWS
  ) {
    return 3;
  }

  return 3;
}

export function applyExploreTierDisplayFields<T extends ExplorePlace>(
  place: T,
  tier: ExploreMapQualityTier,
  _locale: Locale = "zh-TW",
): T {
  const label = simplifyExploreOpeningLabel(place);
  return {
    ...place,
    exploreQualityTier: tier,
    openStatusLabel: label,
    normalizedOpeningLabel: label,
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

/** 探索頁品質門檻：Level 1（營業中） */
export function passesExploreMapQuality(
  place: ExplorePlace,
  categoryId = "all",
): boolean {
  return classifyExploreMapQualityTier(place, categoryId) === 1;
}

export function exploreMapQualityScore(
  place: ExplorePlace,
  origin: { lat: number; lng: number },
  categoryId: string,
  tier: ExploreMapQualityTier = 1,
  options?: { cityMode?: boolean; country?: string | null; cityLabel?: string | null; tabelogCache?: TabelogRankingCache | null },
): number {
  if (
    categoryId === "food" &&
    isExploreJapanFoodContext({
      country: options?.country,
      cityLabel: options?.cityLabel,
      categoryId: "food",
    })
  ) {
    const cache =
      options?.tabelogCache ??
      (options?.cityLabel ? loadAuthorizedTabelogRankingCache(options.cityLabel) : null);
    let score = japanFoodQualityScore(place, origin, cache) + (100 - (tier - 1) * 20);
    if (isBarPrimaryFoodPlace(place)) {
      score -= 500;
    }
    return score;
  }

  if (options?.cityMode) {
    let score = exploreCityTouristQualityScore(place, origin) + (100 - (tier - 1) * 20);
    if (categoryId === "food" && isBarPrimaryFoodPlace(place)) {
      score -= 500;
    }
    return score;
  }
  let score = 0;
  score += (100 - (tier - 1) * 30);
  score += (place.rating ?? 0) * 100;
  score += Math.min(place.userRatingCount ?? 0, 500);
  if (place.photoName) score += 40;
  if (tier === 1 && (place.openStatus === "open" || place.openStatus === "closing_soon")) {
    score += 80;
  }

  if (place.lat != null && place.lng != null) {
    const dist = distanceMeters(origin, { lat: place.lat, lng: place.lng });
    const maxM = exploreCategoryMaxDistanceMeters(categoryId);
    const distScore = Math.max(0, 120 - (dist / maxM) * 120);
    score += distScore;
  }

  return score;
}

export function withinExploreCategoryDistance(
  place: ExplorePlace,
  origin: { lat: number; lng: number },
  categoryId: string,
  maxDistanceM?: number,
): boolean {
  if (place.lat == null || place.lng == null) return false;
  const limit = maxDistanceM ?? exploreCategoryMaxDistanceMeters(categoryId);
  return distanceMeters(origin, { lat: place.lat, lng: place.lng }) <= limit;
}
