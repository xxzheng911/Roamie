import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";

const TRIP_ATTRACTION_ALLOWED_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "hindu_temple",
  "buddhist_temple",
  "church",
  "mosque",
  "synagogue",
  "place_of_worship",
  "temple",
  "shrine",
  "observation_deck",
  "shopping_mall",
  "department_store",
  "market",
  "flea_market",
  "cafe",
  "coffee_shop",
  "bakery",
  "restaurant",
  "meal_takeaway",
  "fast_food_restaurant",
  "landmark",
  "viewpoint",
  "entertainment",
  "amusement_park",
  "aquarium",
  "zoo",
  "park",
  "national_park",
  "botanical_garden",
  "cultural_center",
  "performing_arts_theater",
  "movie_theater",
  "bar",
  "night_club",
]);

const TRIP_FOOD_ALLOWED_TYPES = new Set([
  "restaurant",
  "meal_takeaway",
  "fast_food_restaurant",
  "food",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "pub",
  "dessert_shop",
  "ice_cream_shop",
]);

const TRIP_CAFE_ALLOWED_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "dessert_shop",
  "ice_cream_shop",
  "tea_house",
]);

const TRIP_EXCLUDED_TYPES = new Set([
  "cemetery",
  "graveyard",
  "burial_site",
  "burial_ground",
  "funeral_home",
  "crematorium",
  "columbarium",
  "memorial_park",
  "mortuary",
  "archaeological_site",
  "historical_site",
  "historic_site",
  "ruins",
  "historic_ruins",
  "monument",
  "memorial",
  "historic_marker",
  "stone_marker",
  "historical_landmark",
  "natural_feature",
  "geocode",
]);

const TRIP_TOURISM_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "shopping_mall",
  "department_store",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "park",
  "national_park",
  "botanical_garden",
  "amusement_park",
  "aquarium",
  "zoo",
  "landmark",
  "observation_deck",
]);

const TRIP_HARD_REJECT_NAME_RE =
  /古墳|kofun|塚|蛇塚|\bsnake\b|\bmound\b|memorial|cemetery|grave|burial|\btomb\b|ruins|石碑|\bstone\b|\bmarker\b|monument|墓地|墓園|遺跡|gate\s*remains|gate\s*ruins|門跡|\bformer\b|historic\s*site/i;

const TRIP_LOW_VALUE_NAME_RE =
  /古墳|kofun|古墳群|塚|塚山|蛇塚|snake|mound|burial\s*mound|tumulus|ancient\s*tomb|tomb\s*mound|遺跡|ruins?|historic\s*ruins|石碑|stone\s*marker|historic\s*marker|gate\s*ruins|門跡|跡|sommon\s*gate|reibyo|霊廟|陵|墓地|墓園|墓所|納骨|火葬|unknown\b|memorial|cemetery|grave|burial|monument|marker|former\s+daitoku|historic\s*site/i;

const TRIP_GATE_RUIN_RE = /gate\s*ruins|門跡|sommon\s*gate|reibyo/i;

const QUALITY_STRICT = { rating: 4.2, reviews: 100 };
const QUALITY_RELAXED = { rating: 4.0, reviews: 50 };
const QUALITY_LAST = { rating: 3.8, reviews: 20 };

function normalizeTypes(place: {
  primaryType?: string | null;
  types?: string[] | null;
  type?: string | null;
}): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  const displayType = (place.type ?? "").trim().toLowerCase();
  if (displayType) out.add(displayType);
  return [...out];
}

function allowedTypesForIntent(intent: NearbyPlaceIntent): Set<string> {
  if (intent === "restaurant") return TRIP_FOOD_ALLOWED_TYPES;
  if (intent === "cafe") return TRIP_CAFE_ALLOWED_TYPES;
  return TRIP_ATTRACTION_ALLOWED_TYPES;
}

function isGenericPointOfInterestOnly(types: string[]): boolean {
  if (!types.includes("point_of_interest")) return false;
  return !types.some((t) => TRIP_TOURISM_TYPES.has(t) || TRIP_ATTRACTION_ALLOWED_TYPES.has(t));
}

export function isTripAddPlaceHardReject(place: {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  type?: string | null;
}): boolean {
  const name = (place.name ?? "").trim();
  if (!name) return true;
  if (TRIP_HARD_REJECT_NAME_RE.test(name)) {
    logTripAddPlaceTourismDrop(name, "hard_reject_name");
    return true;
  }

  const types = normalizeTypes(place);
  if (types.some((t) => TRIP_EXCLUDED_TYPES.has(t))) {
    logTripAddPlaceTourismDrop(name, "hard_reject_type", types);
    return true;
  }
  if (isGenericPointOfInterestOnly(types)) {
    logTripAddPlaceTourismDrop(name, "poi_without_tourism_type", types);
    return true;
  }
  if (isBurialOrFuneralPlace(place)) {
    logTripAddPlaceTourismDrop(name, "burial_or_funeral");
    return true;
  }
  return false;
}

export function isTripLowTourismValuePlace(place: {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  type?: string | null;
}): boolean {
  const name = (place.name ?? "").trim();
  const address = (place.address ?? "").trim();
  const blob = `${name} ${address}`.trim();

  if (!name || name === "Unknown" || /^unknown$/i.test(name)) return true;
  if (isTripAddPlaceHardReject(place)) return true;

  const types = normalizeTypes(place);
  if (TRIP_LOW_VALUE_NAME_RE.test(blob)) return true;
  if (TRIP_GATE_RUIN_RE.test(blob) && !types.some((t) => TRIP_ATTRACTION_ALLOWED_TYPES.has(t))) {
    return true;
  }

  return false;
}

function hasAllowedTourismType(
  place: { primaryType?: string | null; types?: string[] | null; type?: string | null },
  intent: NearbyPlaceIntent,
): boolean {
  const types = normalizeTypes(place);
  const allowed = allowedTypesForIntent(intent);
  if (types.some((t) => allowed.has(t))) return true;
  if (intent === "attraction" && /寺|神社|shrine|temple|塔|tower|公園|park|美術|博物|museum/i.test(place.name ?? "")) {
    return true;
  }
  return false;
}

function meetsQuality(
  place: { rating?: number | null; userRatingCount?: number | null },
  tier: { rating: number; reviews: number },
): boolean {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating >= tier.rating && reviews >= tier.reviews;
}

function pickByQualityTiers<T extends PlaceResult>(
  pool: T[],
  intent: NearbyPlaceIntent,
  limit: number,
): T[] {
  const eligible = pool.filter(
    (p) => !isTripLowTourismValuePlace(p) && hasAllowedTourismType(p, intent),
  );

  const tiers = [QUALITY_STRICT, QUALITY_RELAXED, QUALITY_LAST];
  const picked: T[] = [];
  const seen = new Set<string>();

  for (const tier of tiers) {
    for (const place of eligible) {
      if (picked.length >= limit) return picked;
      const id = (place.id ?? place.name ?? "").trim();
      if (!id || seen.has(id)) continue;
      if (!meetsQuality(place, tier)) continue;
      seen.add(id);
      picked.push(place);
    }
    if (picked.length >= 3) break;
  }

  if (picked.length < 3) {
    for (const place of eligible) {
      if (picked.length >= limit) break;
      const id = (place.id ?? place.name ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push(place);
    }
  }

  return picked.slice(0, limit);
}

export function filterPlacesForTripAddPlaceRecommendation(
  places: PlaceResult[],
  intent: NearbyPlaceIntent,
  limit = 30,
): PlaceResult[] {
  const filtered = places.filter((p) => !isTripLowTourismValuePlace(p));
  return pickByQualityTiers(filtered, intent, limit);
}

export function filterTripAddPlaceRecommendations(
  items: RoamieRecommendationItem[],
  intent: NearbyPlaceIntent = "attraction",
): RoamieRecommendationItem[] {
  const asPlaces = items.map((item) => ({
    id: item.googlePlaceId ?? item.placeName ?? item.name,
    name: item.name ?? item.placeName,
    address: item.address,
    primaryType: item.type,
    types: item.type ? [item.type] : [],
    rating: item.rating,
    userRatingCount: item.userRatingCount,
    type: item.type,
  }));

  const keptIds = new Set(
    pickByQualityTiers(asPlaces as PlaceResult[], intent, items.length).map(
      (p) => (p.id ?? p.name ?? "").trim(),
    ),
  );

  return items.filter((item) => {
    const key = (item.googlePlaceId ?? item.placeName ?? item.name ?? "").trim();
    if (!key || isTripLowTourismValuePlace(item)) return false;
    return keptIds.has(key);
  });
}

export function logTripAddPlaceTourismDrop(
  placeName: string,
  reason: string,
  types: string[] = [],
): void {
  console.info(
    `[TRIP_ADD_PLACE_FILTER_DROP] placeName=${placeName} types=${types.join("|") || "none"} reason=${reason}`,
  );
}
