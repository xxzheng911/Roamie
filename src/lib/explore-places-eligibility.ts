import { distanceMeters } from "@/lib/map-explore";
import {
  exploreCategoryMaxDistanceMeters,
} from "@/lib/explore-search-radius";
import { isVerifiedGooglePlaceId } from "@/lib/home-nearby-eligibility";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { resolveOpenNow } from "@/lib/is-recommendable-place";
import { filterByExploreCategory, matchesCategory } from "@/lib/place-category";

export const EXPLORE_TIER12_MIN_RATING = 3.8;
export const EXPLORE_TIER12_MIN_REVIEWS = 5;
export const EXPLORE_TIER3_MIN_RATING = 4.0;
export const EXPLORE_TIER3_MIN_REVIEWS = 10;
export const EXPLORE_MAP_MIN_DISPLAY = 3;
export const EXPLORE_MAP_MAX_DISPLAY = 10;

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
]);

const EXPLORE_DENIED_NAME_RE =
  /加水|水站|飲水|water\s*point|drinking\s*water|停車場|加油站|ATM|銀行|診所|醫院|補習|幼兒園|墓園|當鋪/i;

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
  if (rating >= 4.0 && reviews >= 30) return true;
  return FAMOUS_PARK_NAME_RE.test(place.name ?? "");
}

function hasCredibleRating(reviews: number | null | undefined): boolean {
  return reviews != null && reviews > 0;
}

function passesExploreOperationalBase(place: ExplorePlace): boolean {
  if (place.isSavedFavorite) {
    return (place.name ?? "").trim().length >= 2;
  }

  if (!isVerifiedGooglePlaceId(place.id)) return false;

  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  if (biz && biz !== "OPERATIONAL") return false;

  const rating = place.rating;
  if (rating == null || rating <= 0) return false;
  if (!hasCredibleRating(place.userRatingCount)) return false;

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
): boolean {
  const name = (place.name ?? "").trim();
  if (!name || name === "Unknown") return false;
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
): ExploreMapQualityTier | null {
  if (categoryId === "coffee") {
    return classifyCoffeeExploreMapQualityTier(place);
  }

  if (!passesExploreOperationalBase(place)) return null;

  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  const openNow = resolveOpenNow(place);

  if (place.isSavedFavorite) {
    if (openNow === false) return 3;
    if (openNow === true) return 1;
    return 2;
  }

  if (openNow === true && rating >= EXPLORE_TIER12_MIN_RATING && reviews >= EXPLORE_TIER12_MIN_REVIEWS) {
    return 1;
  }

  if (openNow !== true && openNow !== false) {
    if (rating >= EXPLORE_TIER12_MIN_RATING && reviews >= EXPLORE_TIER12_MIN_REVIEWS) {
      return 2;
    }
    if (
      categoryId === "sight" &&
      isFamousOutdoorSight(place, categoryId) &&
      rating >= EXPLORE_TIER12_MIN_RATING &&
      reviews >= EXPLORE_TIER12_MIN_REVIEWS
    ) {
      return 2;
    }
  }

  if (openNow === false && rating >= EXPLORE_TIER3_MIN_RATING && reviews >= EXPLORE_TIER3_MIN_REVIEWS) {
    return 3;
  }

  return null;
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
): number {
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
