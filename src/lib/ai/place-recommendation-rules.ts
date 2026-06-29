import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import {
  buildCityAttractionSearchAttempts,
  buildLandmarkCompanionSearchAttempts,
  filterPlacesForLandmarkCompanionRecommendation,
  isExcludedInternalFacilityType,
  isInternalSubPlaceOfLandmark,
  type DestinationPlaceSearchProfile,
} from "@/lib/ai/landmark-place-strategy";

type PlaceLike = {
  name: string;
  placeName?: string;
  placeId?: string;
  types?: string[] | null;
  primaryType?: string | null;
};

const PARK_EXCLUDED_TYPES = new Set([
  "park",
  "playground",
  "dog_park",
  "campground",
]);

const DEPRIORITIZED_TYPES = new Set([
  "park",
  "parking",
  "parking_lot",
  "plaza",
  "town_square",
  "transit_station",
  "train_station",
  "subway_station",
  "bus_station",
  "administrative_area",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "neighborhood",
  "sublocality",
  "route",
  "intersection",
]);

const PRIORITY_TYPES = new Set([
  "landmark",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "cultural_landmark",
  "shopping_mall",
  "night_market",
  "temple",
  "hindu_temple",
  "buddhist_temple",
  "church",
  "historical_landmark",
  "historical_place",
  "monument",
  "observation_deck",
  "aquarium",
  "theme_park",
  "amusement_park",
  "zoo",
  "performing_arts_theater",
  "stadium",
]);

const PARK_INTENT_RE =
  /(公園|散步|野餐|親子|草地|戶外放鬆|踏青|慢跑|騎車|帶小孩|遛娃|野餐墊|放鬆|放空|走走|河岸|河濱|展覽|藝術)/;

const FAMOUS_PARK_EXCEPTION_RE =
  /(國家|森林|主題|遊樂|動物|海洋|濕地|自然|生態|文化|歷史|紀念)/;

export const NO_MORE_RECOMMENDATIONS_MESSAGE =
  "我目前找不到更多符合條件的地點，要不要換成美食、咖啡廳或室內景點？";

export { normalizePlaceName as normalizeCorePlaceName } from "@/lib/place-planning-memory";

export function userWantsParkRecommendations(
  text: string,
  context?: CanonicalTravelContext,
): boolean {
  const blob = [
    text,
    context?.mood ?? "",
    context?.vibe ?? "",
    context?.setting ?? "",
    ...(context?.interests ?? []),
  ].join(" ");
  return PARK_INTENT_RE.test(blob);
}

function placeTypes(place: PlaceLike & { types?: string[] | null; primaryType?: string | null }): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

export function isGenericParkPlace(
  place: PlaceLike & { types?: string[] | null; primaryType?: string | null },
  allowParks: boolean,
): boolean {
  if (allowParks) return false;

  const name = (place.placeName ?? place.name ?? "").trim();
  if (!name) return false;

  if (/公園/.test(name) && !FAMOUS_PARK_EXCEPTION_RE.test(name)) {
    return true;
  }

  const types = placeTypes(place);
  if (!types.some((t) => PARK_EXCLUDED_TYPES.has(t))) return false;

  if (types.some((t) => PRIORITY_TYPES.has(t))) return false;
  if (FAMOUS_PARK_EXCEPTION_RE.test(name)) return false;

  return true;
}

export function attractionTypeRankScore(
  place: PlaceResult,
): number {
  const types = [
    ...(place.types ?? []),
    place.primaryType ?? "",
  ]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  let score = 0;
  for (const t of types) {
    if (PRIORITY_TYPES.has(t)) score += 3;
    if (DEPRIORITIZED_TYPES.has(t)) score -= 4;
    if (PARK_EXCLUDED_TYPES.has(t)) score -= 5;
  }
  if (/觀景|地標|博物|美術|夜市|商圈|寺|廟|紀念|古蹟|展覽/.test(place.name ?? "")) {
    score += 2;
  }
  if (/公園$/.test(place.name ?? "") && !FAMOUS_PARK_EXCEPTION_RE.test(place.name ?? "")) {
    score -= 6;
  }
  return score;
}

export function dedupePlacesByCoreName<T extends PlaceLike>(places: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const place of places) {
    const core = normalizePlaceName(place.placeName ?? place.name);
    if (!core || seen.has(core)) continue;
    seen.add(core);
    out.push(place);
  }
  return out;
}

export function filterPlacesForAttractionRecommendation<T extends PlaceLike>(
  places: T[],
  opts: {
    allowParks?: boolean;
    blockedCoreNames?: string[];
    blockedPlaceIds?: string[];
    parentLandmark?: string;
    profile?: DestinationPlaceSearchProfile;
  } = {},
): T[] {
  const parent = opts.parentLandmark ?? opts.profile?.parentLandmark;
  if (parent || opts.profile?.kind === "landmark") {
    const landmarkFiltered = filterPlacesForLandmarkCompanionRecommendation(places, {
      profile: opts.profile,
      parentLandmark: parent,
      blockedCoreNames: opts.blockedCoreNames,
      blockedPlaceIds: opts.blockedPlaceIds,
    });
    return landmarkFiltered.filter(
      (place) => !isGenericParkPlace(place, opts.allowParks ?? false),
    );
  }

  const blockedCores = new Set(
    (opts.blockedCoreNames ?? []).map((n) => normalizePlaceName(n)).filter(Boolean),
  );
  const blockedIds = new Set(opts.blockedPlaceIds ?? []);

  return dedupePlacesByCoreName(places).filter((place) => {
    const id = (place.placeId ?? "").trim();
    if (id && blockedIds.has(id)) return false;

    const name = (place.placeName ?? place.name ?? "").trim();
    if (name && isExcludedInternalFacilityType(place)) return false;
    if (parent && isInternalSubPlaceOfLandmark(name, parent)) return false;

    const core = normalizePlaceName(name);
    if (core && blockedCores.has(core)) return false;

    return !isGenericParkPlace(place, opts.allowParks ?? false);
  });
}

export function buildAttractionRefreshSearchAttempts(
  city?: string,
  profile?: DestinationPlaceSearchProfile,
): SearchAttempt[] {
  if (profile?.kind === "landmark") {
    return buildLandmarkCompanionSearchAttempts(profile);
  }
  return buildCityAttractionSearchAttempts(city?.trim() || "附近");
}
