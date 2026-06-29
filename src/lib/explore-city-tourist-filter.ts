import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { isLodgingPlace } from "@/lib/lodging-place-filter";
import { distanceMeters } from "@/lib/map-explore";
import type { PlaceResult } from "@/lib/place-result";

/** 城市探索：排除無遊玩價值的小型歷史標記、石碑、橋跡等 */

const CITY_JUNK_NAME_RE =
  /碑(?!場|店|林)|碑文|石碑|橋跡|戒壇石|靈場|霊場|墓所|古墳|史跡碑|標柱|銘柱|地籍|界標|橋脚|廢址|遺構|遺址|紀念碑|水塔|倉庫|有限公司|公司行號|公寓|宿舍|醫院|學校|行政|停車場|石幢|燈籠(?!祭)|手水舎|塚$|之塚|墓$/i;

const CITY_JUNK_NAME_EN_RE =
  /\b(plaque|historic\s*marker|stone\s*marker|memorial\s*stone|bridge\s*remains?|bridge\s*ruins?|ruins?\s*of|remains\s*of|boundary\s*stone|mile\s*marker|wayside\s*shrine|kaidan|steles?|historic\s*site\s*marker)\b/i;

const CITY_JUNK_NAME_JA_RE =
  /(石碑|之碑|記念碑|橋跡|戒壇|遺跡|史跡|霊場|墓所|古墳|銘板|標識)$/;

const TRAVEL_FRIENDLY_NAME_RE =
  /咖啡|餐廳|餐館|食堂|小吃|甜點|百貨|商場|mall|market|市集|夜市|商圈|寺|神社|神宮|城|塔|park|museum|美術|gallery|attraction|shopping|department|cafe|restaurant|bar|night/i;

const LOW_VALUE_LANDMARK_TYPES = new Set([
  "monument",
  "memorial",
  "historical_landmark",
  "cultural_landmark",
  "historical_place",
  "sculpture",
]);

const CITY_PRIORITIZED_TYPES = new Set([
  "tourist_attraction",
  "shopping_mall",
  "department_store",
  "market",
  "flea_market",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "pub",
  "night_club",
  "museum",
  "art_gallery",
  "amusement_park",
  "zoo",
  "aquarium",
  "performing_arts_theater",
  "shopping_center",
  "food",
  "meal_takeaway",
]);

const FAMOUS_LANDMARK_MIN_REVIEWS = 80;
const FAMOUS_LANDMARK_MIN_RATING = 4.0;
const MONUMENT_MIN_REVIEWS = 40;
const MONUMENT_MIN_RATING = 4.1;

export type CityExplorePlace = Pick<
  PlaceResult,
  "name" | "address" | "rating" | "userRatingCount" | "primaryType" | "types" | "photoName"
>;

function allTypes(place: CityExplorePlace): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

function isFamousCityLandmark(place: CityExplorePlace): boolean {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return reviews >= FAMOUS_LANDMARK_MIN_REVIEWS && rating >= FAMOUS_LANDMARK_MIN_RATING;
}

function isAcceptableMonument(place: CityExplorePlace): boolean {
  if (isFamousCityLandmark(place)) return true;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return reviews >= MONUMENT_MIN_REVIEWS && rating >= MONUMENT_MIN_RATING;
}

/** true = 應排除（低旅遊價值） */
export function isLowValueCityExplorePlace(place: CityExplorePlace): boolean {
  if (isBurialOrFuneralPlace(place)) return true;
  if (isLodgingPlace(place)) return true;

  const name = (place.name ?? "").trim();
  const address = (place.address ?? "").trim();
  const blob = `${name} ${address}`;

  if (!name || name === "Unknown") return true;

  if (CITY_JUNK_NAME_RE.test(blob)) return true;
  if (CITY_JUNK_NAME_EN_RE.test(blob)) return true;
  if (CITY_JUNK_NAME_JA_RE.test(name)) return true;

  if (name.length <= 14 && /(石碑|碑文|橋跡|戒壇|遺跡|史跡|霊場)/.test(name)) {
    return true;
  }

  const types = allTypes(place);
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  const hasPrioritizedType = types.some((t) => CITY_PRIORITIZED_TYPES.has(t));
  const isMonumentLike = types.some((t) => LOW_VALUE_LANDMARK_TYPES.has(t));

  if (isMonumentLike && !hasPrioritizedType && !isAcceptableMonument(place)) {
    return true;
  }

  const onlyGenericPoi =
    types.length > 0 &&
    types.every((t) => t === "point_of_interest" || t === "establishment" || t === "landmark");

  if (onlyGenericPoi && reviews < 25 && rating < 4.0 && !TRAVEL_FRIENDLY_NAME_RE.test(name)) {
    return true;
  }

  if (
    types.includes("landmark") &&
    !hasPrioritizedType &&
    reviews < 30 &&
    !TRAVEL_FRIENDLY_NAME_RE.test(name)
  ) {
    return true;
  }

  return false;
}

export function passesCityExploreTouristValue(place: CityExplorePlace): boolean {
  return !isLowValueCityExplorePlace(place);
}

/** 城市探索排序：評分、評論數、旅遊類型、照片優先；距離僅輔助 */
export function exploreCityTouristQualityScore(
  place: CityExplorePlace,
  origin: { lat: number; lng: number },
): number {
  let score = 0;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;

  score += rating * 200;
  score += Math.min(reviews, 2000) * 2;

  const types = allTypes(place);
  if (types.some((t) => CITY_PRIORITIZED_TYPES.has(t))) score += 400;
  if (types.includes("tourist_attraction")) score += 200;
  if (types.includes("shopping_mall") || types.includes("department_store")) score += 180;
  if (place.photoName) score += 120;

  if (isLowValueCityExplorePlace(place)) score -= 10_000;

  if (place.lat != null && place.lng != null) {
    const dist = distanceMeters(origin, { lat: place.lat, lng: place.lng });
    score += Math.max(0, 40 - (dist / 30_000) * 40);
  }

  return score;
}
