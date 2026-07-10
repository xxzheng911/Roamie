import type { PlaceResult } from "@/lib/place-result";
import type { WeatherScene } from "@/lib/weather-scene";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { filterExcludedRetailPlaces } from "@/lib/ai/ai-day-plan-slot-rules";
import {
  CHAT_DAY_PLAN_MAX_PER_DAY,
  CHAT_DAY_PLAN_MIN_PER_DAY,
  type DayPlanBucket,
  logAiDayPlanGenerated,
} from "@/lib/ai/ai-trip-style";
import { resolvePlaceIdentity, type PlaceIdentity } from "@/lib/place-identity";
import {
  buildExplicitAvoidKeywords,
  scorePlusPreferenceMatch,
  buildPlusPreferenceRankingContext,
  type PlusPreferenceRankingContext,
} from "@/lib/plus-preference-ranking";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { distanceMeters } from "@/lib/map-explore";

export type TripPlaceCategory =
  | "city_landmark"
  | "historical"
  | "popular_attraction"
  | "night_view"
  | "local_food"
  | "shopping_district"
  | "market"
  | "night_market"
  | "coffee"
  | "creative"
  | "alley"
  | "museum"
  | "art_gallery"
  | "heritage"
  | "exhibition"
  | "sea_view"
  | "mountain_view"
  | "riverside"
  | "trail"
  | "park"
  | "indoor"
  | "bar"
  | "generic";

export type TripPlaceScoringInput = {
  style: TripStyleKey;
  days: number;
  vibe?: "quiet" | "either" | "lively";
  pace?: "slow" | "medium" | "active";
  weatherScene?: WeatherScene;
  centerLat?: number;
  centerLng?: number;
  plusContext?: PlusPreferenceRankingContext | null;
  context?: CanonicalTravelContext;
};

const OUTDOOR_CATEGORIES = new Set<TripPlaceCategory>([
  "sea_view",
  "mountain_view",
  "riverside",
  "trail",
  "park",
]);

const DAYTIME_CATEGORIES = new Set<TripPlaceCategory>([
  "museum",
  "art_gallery",
  "heritage",
  "historical",
  "exhibition",
]);

const STYLE_CATEGORY_WEIGHTS: Record<
  TripStyleKey,
  Partial<Record<TripPlaceCategory, number>>
> = {
  classic_landmarks: {
    city_landmark: 35,
    popular_attraction: 35,
    historical: 20,
    local_food: 20,
    coffee: 10,
    museum: 15,
    heritage: 15,
  },
  local_life: {
    shopping_district: 35,
    alley: 30,
    local_food: 35,
    coffee: 20,
    creative: 15,
    night_market: 10,
    popular_attraction: 10,
  },
  slow_nature: {
    park: 40,
    riverside: 40,
    trail: 40,
    coffee: 20,
    art_gallery: 20,
    museum: 20,
    heritage: 20,
    creative: 20,
    local_food: 20,
    bar: -80,
  },
  mixed: {
    city_landmark: 30,
    popular_attraction: 30,
    local_food: 25,
    coffee: 10,
    shopping_district: 15,
    museum: 15,
    creative: 15,
    night_market: 10,
    bar: -40,
  },
};

const VIBE_CATEGORY_DELTA: Record<
  "quiet" | "either" | "lively",
  Partial<Record<TripPlaceCategory, number>>
> = {
  quiet: {
    riverside: 40,
    park: 40,
    mountain_view: 35,
    sea_view: 35,
    coffee: 30,
    art_gallery: 30,
    museum: 25,
    creative: 20,
    heritage: 20,
    night_market: -50,
    shopping_district: -40,
    bar: -60,
    popular_attraction: -30,
  },
  either: {
    popular_attraction: 20,
    shopping_district: 20,
    local_food: 20,
    coffee: 15,
    museum: 15,
    park: 15,
    night_view: 15,
  },
  lively: {
    shopping_district: 40,
    night_market: 40,
    bar: 35,
    city_landmark: 30,
    popular_attraction: 25,
    local_food: 20,
    night_view: 15,
    park: -20,
    riverside: -20,
    trail: -30,
  },
};

const WEATHER_CATEGORY_DELTA: Partial<
  Record<WeatherScene, Partial<Record<TripPlaceCategory, number>>>
> = {
  rainy: {
    indoor: 50,
    museum: 40,
    art_gallery: 40,
    shopping_district: 30,
    trail: -60,
    sea_view: -70,
    mountain_view: -50,
    park: -40,
  },
  hot: {
    indoor: 30,
    coffee: 20,
    night_view: 20,
    sea_view: -50,
    trail: -50,
    park: -40,
  },
  night: {
    night_view: 30,
    night_market: 40,
    bar: 30,
    museum: -80,
    heritage: -50,
    historical: -50,
  },
};

const STYLE_DAY_SLOTS: Record<TripStyleKey, TripPlaceCategory[][]> = {
  classic_landmarks: [
    ["city_landmark", "popular_attraction", "shopping_district", "night_view", "local_food"],
    ["historical", "local_food", "popular_attraction", "night_view", "city_landmark"],
  ],
  local_life: [
    ["shopping_district", "local_food", "coffee", "night_market", "creative"],
    ["alley", "creative", "coffee", "local_food", "night_market"],
  ],
  slow_nature: [
    ["coffee", "museum", "art_gallery", "riverside", "night_view"],
    ["park", "trail", "heritage", "creative", "sea_view"],
  ],
  mixed: [
    ["city_landmark", "shopping_district", "local_food", "coffee", "night_view"],
    ["museum", "popular_attraction", "creative", "night_market", "alley"],
  ],
};

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isPermanentlyClosed(place: PlaceResult): boolean {
  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  return biz === "CLOSED_PERMANENTLY";
}

export function classifyTripPlaceCategory(place: PlaceResult): TripPlaceCategory {
  const identity = resolvePlaceIdentity(place);
  const blob = placeBlob(place);
  const types = new Set(
    [place.primaryType, ...(place.types ?? [])]
      .filter(Boolean)
      .map((t) => t!.trim().toLowerCase()),
  );

  if (/夜景|觀景|觀星|塔|101|sky|night view|observatory/.test(blob)) return "night_view";
  if (/海|沙灘|漁港|碼頭|beach|coast|ocean/.test(blob)) return "sea_view";
  if (/山|步道|登山|forest|mountain|trail|hiking/.test(blob)) return /步道|trail|hiking/.test(blob) ? "trail" : "mountain_view";
  if (/河|溪|水岸|河岸|river|canal/.test(blob)) return "riverside";
  if (/夜市|night market/.test(blob)) return "night_market";
  if (/傳統市場|菜市|market/.test(blob) && !/夜市/.test(blob)) return "market";
  if (/酒吧|bar|pub|居酒屋/.test(blob)) return "bar";
  if (/巷|弄|老街|alley/.test(blob)) return "alley";
  if (/產業園區|文創園區|文化園區|文化創意|creative park|art center|art centre|creative hub|文創產業/i.test(blob)) {
    return "creative";
  }
  if (types.has("tourist_attraction") && /園區|文創|文化創意|產業|creative/i.test(blob)) return "creative";
  if (/文創|創意|hub|園區/.test(blob)) return "creative";
  if (/古蹟|遺址|寺|廟|temple|heritage|historic/.test(blob)) return "heritage";
  if (/展覽|exhibition/.test(blob)) return "exhibition";

  const identityMap: Partial<Record<PlaceIdentity, TripPlaceCategory>> = {
    tourist_attraction: /地標|landmark|代表/.test(blob) ? "city_landmark" : "popular_attraction",
    museum: "museum",
    park: "park",
    cafe: "coffee",
    night_market: "night_market",
    district: "shopping_district",
    shopping_mall: "shopping_district",
    department_store: "shopping_district",
    bar: "bar",
    food_stall: "local_food",
    restaurant: "local_food",
    bakery: "local_food",
    bookstore: "creative",
  };

  if (identity === "museum") {
    return /美術|gallery|art/.test(blob) ? "art_gallery" : "museum";
  }

  const mapped = identityMap[identity];
  if (mapped) return mapped;

  if (/博物|museum/.test(blob)) return "museum";
  if (/美術|gallery/.test(blob)) return "art_gallery";
  if (/商圈|shopping|百貨|mall/.test(blob)) return "shopping_district";
  if (
    !/產業園區|文創園區|文化園區|文化創意|creative park|art center|art centre|園區|文創|creative/i.test(blob) &&
    (/咖啡廳|咖啡店|coffee shop|\bcafe\b|coffee_shop/i.test(blob) ||
      (types.has("cafe") || types.has("coffee_shop")))
  ) {
    return "coffee";
  }
  if (/公園|park/.test(blob)) return "park";

  if (identity === "tourist_attraction") return "popular_attraction";
  return "generic";
}

export function passesTripPlaceHardRules(
  place: PlaceResult,
  weatherScene?: WeatherScene,
): boolean {
  if (!place.name?.trim() || !place.id?.trim()) return false;
  if (isPermanentlyClosed(place)) return false;

  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  if (rating < 4.0 || reviews < 100) return false;

  const category = classifyTripPlaceCategory(place);
  if (weatherScene === "rainy" && OUTDOOR_CATEGORIES.has(category)) return false;
  if (weatherScene === "night" && DAYTIME_CATEGORIES.has(category)) return false;

  return true;
}

function popularityScore(place: PlaceResult): number {
  const reviews = place.userRatingCount ?? 0;
  return Math.min(Math.log10(reviews + 10) * 20, 100);
}

function ratingScore(place: PlaceResult): number {
  const rating = place.rating ?? 0;
  return Math.max(0, Math.min(100, (rating - 3.5) * 40));
}

function routeScore(
  place: PlaceResult,
  centerLat?: number,
  centerLng?: number,
): number {
  if (centerLat == null || centerLng == null || place.lat == null || place.lng == null) {
    return 50;
  }
  const meters = distanceMeters({ lat: centerLat, lng: centerLng }, { lat: place.lat, lng: place.lng });
  if (meters <= 3000) return 100;
  if (meters <= 8000) return 80;
  if (meters <= 15_000) return 60;
  if (meters <= 30_000) return 40;
  return 20;
}

function pacePlacesPerDay(pace?: "slow" | "medium" | "active"): { min: number; max: number } {
  if (pace === "slow") return { min: 2, max: 4 };
  if (pace === "active") return { min: 5, max: 8 };
  return { min: CHAT_DAY_PLAN_MIN_PER_DAY, max: CHAT_DAY_PLAN_MAX_PER_DAY };
}

function styleCategoryScore(style: TripStyleKey, category: TripPlaceCategory): number {
  const weights = STYLE_CATEGORY_WEIGHTS[style];
  const raw = weights[category] ?? 0;
  const max = Math.max(...Object.values(weights), 1);
  return (raw / max) * 100;
}

function vibeCategoryScore(
  vibe: "quiet" | "either" | "lively" | undefined,
  category: TripPlaceCategory,
): number {
  if (!vibe) return 50;
  const delta = VIBE_CATEGORY_DELTA[vibe][category] ?? 0;
  return Math.max(0, Math.min(100, 50 + delta));
}

function weatherCategoryScore(
  scene: WeatherScene | undefined,
  category: TripPlaceCategory,
): number {
  if (!scene) return 50;
  const delta = WEATHER_CATEGORY_DELTA[scene]?.[category] ?? 0;
  return Math.max(0, Math.min(100, 50 + delta));
}

function paceCategoryScore(
  pace: "slow" | "medium" | "active" | undefined,
  category: TripPlaceCategory,
): number {
  if (pace === "slow") {
    if (["coffee", "museum", "art_gallery", "park", "riverside"].includes(category)) return 90;
    if (["night_market", "bar", "shopping_district"].includes(category)) return 30;
  }
  if (pace === "active") {
    if (["shopping_district", "night_market", "popular_attraction", "city_landmark"].includes(category)) {
      return 90;
    }
  }
  return 60;
}

function avoidScore(
  place: PlaceResult,
  plusContext?: PlusPreferenceRankingContext | null,
): number {
  if (!plusContext) return 50;
  const penalty = scorePlusPreferenceMatch(place, plusContext);
  if (penalty <= -40) return 0;
  if (penalty >= 30) return 100;
  return Math.max(0, Math.min(100, 50 + penalty));
}

function openingHoursScore(place: PlaceResult, category: TripPlaceCategory): number {
  const needsHours = category === "local_food" || category === "coffee" || category === "bar";
  const hasHours =
    !!place.regularOpeningHours?.periods?.length ||
    !!(place.todayHoursLabel?.trim() && !/待確認/.test(place.todayHoursLabel));
  if (needsHours && !hasHours) return 0;
  if (!needsHours && !hasHours) return 65;
  return 100;
}

export function scoreTripPlace(
  place: PlaceResult,
  input: TripPlaceScoringInput,
): number {
  const category = classifyTripPlaceCategory(place);
  const stylePart = styleCategoryScore(input.style, category) * 0.35;
  const vibePart = vibeCategoryScore(input.vibe, category) * 0.15;
  const weatherPart = weatherCategoryScore(input.weatherScene, category) * 0.15;
  const pacePart = paceCategoryScore(input.pace, category) * 0.1;
  const avoidPart = avoidScore(place, input.plusContext) * 0.1;
  const popularityPart = popularityScore(place) * 0.05;
  const ratingPart = ratingScore(place) * 0.05;
  const routePart = routeScore(place, input.centerLat, input.centerLng) * 0.04;
  const hoursPart = openingHoursScore(place, category) * 0.06;

  return (
    stylePart +
    vibePart +
    weatherPart +
    pacePart +
    avoidPart +
    popularityPart +
    ratingPart +
    routePart +
    hoursPart
  );
}

export function buildTripPlaceScoringContext(input: {
  style: TripStyleKey;
  days: number;
  profile?: UserProfileForReason | null;
  context?: CanonicalTravelContext;
  weatherScene?: WeatherScene;
  centerLat?: number;
  centerLng?: number;
}): TripPlaceScoringInput {
  const profile = input.profile;
  return {
    style: input.style,
    days: input.days,
    vibe: profile?.vibe,
    pace: profile?.pace,
    weatherScene: input.weatherScene,
    centerLat: input.centerLat,
    centerLng: input.centerLng,
    context: input.context,
    plusContext: profile
      ? buildPlusPreferenceRankingContext({
          profile,
          explicitAvoidKeywords: buildExplicitAvoidKeywords(input.context?.excludedCategories),
        })
      : null,
  };
}

export function filterAndRankTripPlaces(
  places: PlaceResult[],
  input: TripPlaceScoringInput,
): PlaceResult[] {
  return filterAndRankTripPlacesInternal(places, input, false);
}

/** 多日規劃：保留缺 rating / details 的地點，僅排除永久歇業 */
export function filterAndRankTripPlacesForPlanning(
  places: PlaceResult[],
  input: TripPlaceScoringInput,
): PlaceResult[] {
  return filterAndRankTripPlacesInternal(places, input, true);
}

function filterAndRankTripPlacesInternal(
  places: PlaceResult[],
  input: TripPlaceScoringInput,
  planningMode: boolean,
): PlaceResult[] {
  const retailFiltered = filterExcludedRetailPlaces(places, { style: input.style });
  if (planningMode) {
    const pool = retailFiltered.filter((place) => place.name?.trim() && !isPermanentlyClosed(place));
    const preferred = pool.filter((place) => {
      const rating = place.rating ?? 0;
      return rating >= 4.0 || rating === 0;
    });
    const rankedPool = preferred.length >= input.days * 2 ? preferred : pool;
    return [...rankedPool].sort(
      (a, b) => scoreTripPlace(b, input) - scoreTripPlace(a, input),
    );
  }

  const minRequired = input.days * CHAT_DAY_PLAN_MIN_PER_DAY;
  const strict = retailFiltered.filter((place) => passesTripPlaceHardRules(place, input.weatherScene));
  const pool =
    strict.length >= minRequired
      ? strict
      : retailFiltered.filter(
          (place) =>
            !isPermanentlyClosed(place) &&
            (place.rating ?? 0) >= 4.0 &&
            !(input.weatherScene === "rainy" && OUTDOOR_CATEGORIES.has(classifyTripPlaceCategory(place))),
        );

  return [...pool].sort(
    (a, b) => scoreTripPlace(b, input) - scoreTripPlace(a, input),
  );
}

function slotMatchesCategory(slot: TripPlaceCategory, category: TripPlaceCategory): boolean {
  if (slot === category) return true;
  if (slot === "popular_attraction" && category === "city_landmark") return true;
  if (slot === "city_landmark" && category === "popular_attraction") return true;
  if (slot === "local_food" && category === "market") return true;
  if (slot === "creative" && category === "art_gallery") return true;
  if (slot === "heritage" && category === "historical") return true;
  return false;
}

export function distributeTripPlacesAcrossDays(
  places: PlaceResult[],
  input: TripPlaceScoringInput,
): DayPlanBucket[] {
  const safeDays = Math.max(1, input.days);
  const paceRange = pacePlacesPerDay(input.pace);
  const perDay = Math.min(
    paceRange.max,
    Math.max(paceRange.min, CHAT_DAY_PLAN_MIN_PER_DAY, Math.ceil(places.length / safeDays)),
  );
  const buckets: DayPlanBucket[] = Array.from({ length: safeDays }, (_, index) => ({
    day: index + 1,
    names: [],
  }));
  const categoryCountByDay: TripPlaceCategory[][] = Array.from({ length: safeDays }, () => []);
  const usedIds = new Set<string>();

  const slotsForDay = (dayIndex: number): TripPlaceCategory[] => {
    const template = STYLE_DAY_SLOTS[input.style][dayIndex] ?? STYLE_DAY_SLOTS[input.style][0] ?? [];
    return template.length ? template : ["popular_attraction", "local_food", "coffee", "shopping_district", "night_view"];
  };

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const slots = slotsForDay(dayIndex);
    for (const slot of slots) {
      if (buckets[dayIndex]!.names.length >= perDay) break;
      const match = places.find((place) => {
        const id = place.id ?? place.name;
        if (!id || usedIds.has(id)) return false;
        const category = classifyTripPlaceCategory(place);
        const dayCategories = categoryCountByDay[dayIndex]!;
        if (dayCategories.filter((c) => c === category).length >= 2) return false;
        return slotMatchesCategory(slot, category);
      });
      if (!match?.name) continue;
      usedIds.add(match.id ?? match.name);
      buckets[dayIndex]!.names.push(match.name);
      categoryCountByDay[dayIndex]!.push(classifyTripPlaceCategory(match));
    }
  }

  for (const place of places) {
    const id = place.id ?? place.name;
    if (!id || usedIds.has(id) || !place.name?.trim()) continue;
    const category = classifyTripPlaceCategory(place);
    let assigned = false;
    for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
      if (buckets[dayIndex]!.names.length >= perDay) continue;
      const dayCategories = categoryCountByDay[dayIndex]!;
      if (dayCategories.filter((c) => c === category).length >= 2) continue;
      usedIds.add(id);
      buckets[dayIndex]!.names.push(place.name);
      dayCategories.push(category);
      assigned = true;
      break;
    }
    if (!assigned) break;
  }

  for (const bucket of buckets) {
    logAiDayPlanGenerated(bucket.day, bucket.names.length);
  }

  return buckets;
}

export function orderPlacesByDayBuckets(
  places: PlaceResult[],
  buckets: DayPlanBucket[],
): PlaceResult[] {
  const byName = new Map<string, PlaceResult>();
  for (const place of places) {
    const name = place.name?.trim();
    if (name) byName.set(name, place);
  }
  const ordered: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const name of bucket.names) {
      const place = byName.get(name);
      const id = place?.id ?? name;
      if (!place || seen.has(id)) continue;
      seen.add(id);
      ordered.push(place);
    }
  }
  for (const place of places) {
    const id = place.id ?? place.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(place);
  }
  return ordered;
}
