import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { isLodgingPlace } from "@/lib/lodging-place-filter";
import { distanceMeters } from "@/lib/map-explore";
import type { PlaceResult } from "@/lib/place-result";
import { touristQualityDecision } from "@/lib/tourist-quality-gate";

/**
 * 城市探索：排除墓地、住宿與非觀光名稱；歷史標記／舊址／說明牌的低體驗價值判定
 * 改由共用 Tourist Quality Gate（依證據，不依名稱關鍵字或評分）。
 */

/** 非觀光名稱（設施附屬物、行政／商業設施、墓葬）；不含碑／跡／史跡等舊址標記關鍵字 */
const CITY_JUNK_NAME_RE =
  /戒壇石|墓所|古墳|地籍|界標|橋脚|水塔|倉庫|有限公司|公司行號|公寓|宿舍|醫院|學校|行政|停車場|石幢|燈籠(?!祭)|手水舎|塚$|之塚|墓$/i;

const CITY_JUNK_NAME_EN_RE =
  /\b(boundary\s*stone|mile\s*marker|wayside\s*shrine|kaidan)\b/i;

const CITY_JUNK_NAME_JA_RE = /(墓所|古墳)$/;

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

export type CityExplorePlace = Pick<
  PlaceResult,
  | "name"
  | "address"
  | "rating"
  | "userRatingCount"
  | "primaryType"
  | "types"
  | "photoName"
  | "regularOpeningHours"
  | "currentOpeningHours"
  | "reviewEvidence"
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

  // Shared Tourist Quality Gate (general sightseeing): only LOW_EXPERIENCE_VALUE is excluded.
  return !touristQualityDecision(
    {
      name,
      primaryType: place.primaryType,
      types: place.types,
      regularOpeningHours: place.regularOpeningHours,
      currentOpeningHours: place.currentOpeningHours,
      reviewEvidence: place.reviewEvidence,
    },
    { intent: "general_sightseeing" },
  ).admit;
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
