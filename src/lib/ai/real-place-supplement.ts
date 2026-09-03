/**
 * Real-place supplement vs synthetic filler policy.
 *
 * Selected combinations forbid invented / placeholder stops, but still allow
 * destination-scoped Google Places that pass quality gates to fill trip days.
 */
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  primaryThemesForCombinationTheme,
  themeSearchQueries,
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import { detectSubPlaceType } from "@/lib/ai/landmark-keywords";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { isMappableGooglePlaceId } from "@/lib/ai/map-named-places-to-google";
import { isResolvedCorePlace } from "@/lib/ai/planning-real-place";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { PlaceResult } from "@/lib/place-result";
import type { Locale } from "@/lib/i18n/types";
import { mapPlaceResultToChatItem, type ChatPlaceItem } from "@/lib/chat-session";
import { listTripDates } from "@/lib/outfit/group-by-date";

export type FillerPolicy = {
  allowSynthetic: boolean;
  allowResolvedRealPlaceSupplement: boolean;
};

export const SELECTED_COMBINATION_FILLER_POLICY: FillerPolicy = {
  allowSynthetic: false,
  allowResolvedRealPlaceSupplement: true,
};

export type DynamicStopCapacity = {
  tripDays: number;
  selectedCombinationCount: number;
  preferredStops: number;
  minimumViableStops: number;
  maximumStops: number;
};

export type TotalRealPlaceValidationResult = {
  resolvedCount: number;
  preferred: number;
  minimumViable: number;
  maximum: number;
  result: "pass" | "compact" | "fail";
  compactItineraryMode: boolean;
};

export type SelectedThemeProfile = {
  selectedCombinationIds: number[];
  primaryThemes: string[];
  combinationThemes: Record<number, string>;
};

/**
 * Dynamic stop capacity.
 *
 * Soft fetch target (`preferredStops`) must cover Planner requiredMinimum
 * (days×3 for medium pace) with oversampling headroom (days×4).
 * Do NOT clamp with `tripDays+6` — that starved 6-day pools at ~12 places.
 *
 * `minimumViableStops` stays a lean pre-save floor (not a fetch ceiling).
 */
export function calculateDynamicStopCapacity(params: {
  tripDays: number;
  selectedCombinationCount: number;
  pace?: "relaxed" | "moderate" | "packed";
  destinationDensity?: "sparse" | "moderate" | "dense";
}): DynamicStopCapacity {
  const tripDays = Math.max(1, params.tripDays);
  const selectedCombinationCount = Math.max(0, params.selectedCombinationCount);
  const n = Math.max(selectedCombinationCount, 1);
  const pace = params.pace ?? "moderate";
  const density = params.destinationDensity ?? "moderate";
  const paceMul = pace === "relaxed" ? 1.6 : pace === "packed" ? 2.4 : 2.0;
  const densityAdj = density === "sparse" ? -0.25 : density === "dense" ? 0.25 : 0;

  const requiredMinimum = tripDays * 3;
  const fetchOversample = tripDays * 4;
  const pacePreferred = Math.round(tripDays * (paceMul + densityAdj)) + (tripDays >= 3 ? 1 : 0);

  // Soft acquisition target: at least days×3; allow up to days×4 oversampling.
  const preferredStops = Math.max(
    n,
    requiredMinimum,
    Math.min(Math.max(pacePreferred, requiredMinimum), fetchOversample),
  );

  // Single-select: lean floor (~55% of requiredMinimum, not of oversampled preferred).
  // Multi-select: one real place per combo is enough for viability.
  const minimumViableStops =
    selectedCombinationCount <= 1
      ? Math.max(
          1,
          Math.min(
            preferredStops,
            Math.max(tripDays > 1 ? 2 : 1, Math.ceil(requiredMinimum * 0.55)),
          ),
        )
      : Math.max(selectedCombinationCount, Math.min(tripDays, selectedCombinationCount));

  const maximumStops = Math.max(
    preferredStops + 2,
    Math.min(fetchOversample + 2, preferredStops + Math.max(3, tripDays)),
  );

  const capacity: DynamicStopCapacity = {
    tripDays,
    selectedCombinationCount,
    preferredStops,
    minimumViableStops,
    maximumStops,
  };

  logAiPipeline(
    "[DYNAMIC_STOP_CAPACITY]",
    `tripDays=${tripDays}`,
    `preferredStops=${preferredStops}`,
    `minimumViableStops=${minimumViableStops}`,
    `maximumStops=${maximumStops}`,
    `selectedCombinationCount=${selectedCombinationCount}`,
  );

  return capacity;
}

export function evaluateTotalRealPlaceValidation(
  resolvedCount: number,
  capacity: DynamicStopCapacity,
): TotalRealPlaceValidationResult {
  let result: TotalRealPlaceValidationResult["result"];
  if (resolvedCount < capacity.minimumViableStops) result = "fail";
  else if (resolvedCount < capacity.preferredStops) result = "compact";
  else result = "pass";

  const out: TotalRealPlaceValidationResult = {
    resolvedCount,
    preferred: capacity.preferredStops,
    minimumViable: capacity.minimumViableStops,
    maximum: capacity.maximumStops,
    result,
    compactItineraryMode: result === "compact",
  };

  logAiPipeline(
    "[TOTAL_REAL_PLACE_VALIDATION]",
    `resolvedCount=${resolvedCount}`,
    `minimumViable=${capacity.minimumViableStops}`,
    `preferred=${capacity.preferredStops}`,
    `result=${result}`,
  );

  if (out.compactItineraryMode) {
    logAiPipeline(
      "[COMPACT_ITINERARY_MODE_ENABLED]",
      "reason=below_preferred_but_viable",
      `resolvedCount=${resolvedCount}`,
      `preferredCount=${capacity.preferredStops}`,
      `minimumViableCount=${capacity.minimumViableStops}`,
    );
  }

  return out;
}

export function buildSelectedThemeProfile(params: {
  selectedCombinationIds: number[];
  pools: Array<{ combinationId: number; theme: string; title?: string }>;
}): SelectedThemeProfile {
  const combinationThemes: Record<number, string> = {};
  const themeSet = new Set<string>();
  for (const id of params.selectedCombinationIds) {
    const pool = params.pools.find((p) => p.combinationId === id);
    const theme = (pool?.theme ?? "attraction").trim().toLowerCase() || "attraction";
    combinationThemes[id] = theme;
    for (const facet of primaryThemesForCombinationTheme(theme, pool?.title)) {
      themeSet.add(facet);
    }
  }
  const profile: SelectedThemeProfile = {
    selectedCombinationIds: [...params.selectedCombinationIds],
    primaryThemes: [...themeSet],
    combinationThemes,
  };
  logAiPipeline(
    "[SELECTED_THEME_PROFILE]",
    `selectedCombinationIds=[${profile.selectedCombinationIds.join(",")}]`,
    `primaryThemes=[${profile.primaryThemes.join(",")}]`,
  );
  return profile;
}

/** Hard floor for pre-save — uses dynamic minimumViable (not days×3). */
export function computeMinimumPlacesForTripDays(
  tripDays: number,
  selectedCombinationCount = 1,
): number {
  return calculateDynamicStopCapacity({
    tripDays,
    selectedCombinationCount,
  }).minimumViableStops;
}

/** Soft target density (geography-first packing prefers ~preferredStops). */
export function computeTargetPlacesForTripDays(
  tripDays: number,
  selectedCombinationCount = 1,
): number {
  return calculateDynamicStopCapacity({
    tripDays,
    selectedCombinationCount,
  }).preferredStops;
}

function placeKey(place: {
  googlePlaceId?: string | null;
  placeId?: string | null;
  id?: string | null;
  placeName?: string;
  name?: string;
}): string {
  const id = (place.googlePlaceId ?? place.placeId ?? place.id ?? "").trim();
  if (id) return `id:${id}`;
  const name = (place.placeName ?? place.name ?? "").replace(/\s+/g, "").toLowerCase();
  return name ? `name:${name}` : "";
}

const MEAL_INCLUDED_TYPES = ["restaurant", "food", "meal_takeaway"] as const;
const MEAL_COMPATIBLE_TYPES = new Set<string>(MEAL_INCLUDED_TYPES);
const MEAL_EXCLUDED_TYPES = new Set([
  "supermarket",
  "grocery_store",
  "grocery_or_supermarket",
  "convenience_store",
  "department_store",
  "shopping_mall",
  "store",
  "meal_delivery",
]);

export function isSelectedCombinationMealCandidate(place: {
  id?: string | null;
  googlePlaceId?: string | null;
  lat?: number | null;
  lng?: number | null;
  primaryType?: string | null;
  type?: string | null;
  types?: string[] | null;
  businessStatus?: string | null;
}): boolean {
  const id = (place.id ?? place.googlePlaceId ?? "").trim();
  if (!isMappableGooglePlaceId(id) || place.lat == null || place.lng == null) return false;
  if (place.businessStatus === "CLOSED_PERMANENTLY") return false;
  const types = new Set(
    [place.primaryType, place.type, ...(place.types ?? [])]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if ([...types].some((type) => MEAL_EXCLUDED_TYPES.has(type))) return false;
  return [...types].some((type) => MEAL_COMPATIBLE_TYPES.has(type));
}

/** Meal acquisition is independent from scenic capacity and never uses the tourism gate. */
export async function supplementMealsForSelectedCombinationItinerary(params: {
  destination: string;
  tripDays: number;
  existingPlaces: ChatPlaceItem[];
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  mood?: string;
  weather?: unknown;
}): Promise<ChatPlaceItem[]> {
  const target = Math.max(0, params.tripDays * 2);
  const scenicTarget = calculateDynamicStopCapacity({
    tripDays: params.tripDays,
    selectedCombinationCount: 1,
  }).preferredStops;
  const existingMeals = params.existingPlaces.filter(isSelectedCombinationMealCandidate);
  const used = new Set(params.existingPlaces.map(placeKey).filter(Boolean));
  const added: ChatPlaceItem[] = [];
  const needed = Math.max(0, target - existingMeals.length);
  const queries = [
    `${params.destination} 在地午餐 餐廳`,
    `${params.destination} 晚餐 餐廳`,
    `${params.destination} local restaurants`,
  ];

  for (const query of queries) {
    if (added.length >= needed) break;
    try {
      const result = await params.searchPlaces({
        data: {
          query,
          lat: params.lat,
          lng: params.lng,
          radius: 35_000,
          mode: "text",
          placesScreen: "chat",
          placesCaller: "selected_combination_meal_supplement",
          destinationName: params.destination,
          searchMode: "destination",
          includedTypes: [...MEAL_INCLUDED_TYPES],
        },
      });
      for (const place of result.places ?? []) {
        if (added.length >= needed) break;
        if (!isSelectedCombinationMealCandidate(place)) continue;
        const key = placeKey(place);
        if (!key || used.has(key)) continue;
        const item = mapPlaceResultToChatItem(place, {
          mood: params.mood,
          weather: params.weather as never,
          locale: params.locale,
          categoryIntent: "food",
        });
        used.add(key);
        added.push(item);
      }
    } catch {
      // Meal gaps remain observable and must not fail the whole itinerary.
    }
  }

  const allMeals = [...existingMeals, ...added];
  const cafeCount = allMeals.filter((place) =>
    (place.types ?? []).some((type) => type === "cafe" || type === "coffee_shop"),
  ).length;
  const bakeryCount = allMeals.filter((place) => (place.types ?? []).includes("bakery")).length;
  logAiPipeline(
    "[MEAL_CANDIDATE_POOL_SUMMARY]",
    `destination=${params.destination}`,
    `restaurantCount=${allMeals.length}`,
    `cafeCount=${cafeCount}`,
    `bakeryCount=${bakeryCount}`,
    `lunchCompatibleCount=${allMeals.length}`,
    `dinnerCompatibleCount=${allMeals.length}`,
    `unusedLunchCompatibleCount=${allMeals.length}`,
    `unusedDinnerCompatibleCount=${allMeals.length}`,
    `scenicPreferredStopsReached=${params.existingPlaces.length >= scenicTarget}`,
    `mealRequirementsReached=${allMeals.length >= target}`,
  );
  return added;
}

/**
 * Search destination-scoped real Places to fill a shortfall after selected-combination
 * resolution + dedupe. Never invents synthetic names. Theme-scoped when profile given.
 */
export async function supplementRealPlacesForItinerary(params: {
  destination: string;
  tripDays: number;
  existingPlaces: ChatPlaceItem[];
  selectedCombinationIds?: number[];
  themes?: string[];
  themeProfile?: SelectedThemeProfile;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  needed?: number;
  mood?: string;
  weather?: unknown;
  uniqueMajorLandmarksBefore?: number;
}): Promise<{
  added: ChatPlaceItem[];
  failed: number;
  needed: number;
  rejected: number;
}> {
  const capacity = calculateDynamicStopCapacity({
    tripDays: params.tripDays,
    selectedCombinationCount: params.selectedCombinationIds?.length ?? 1,
  });
  const minRequired = capacity.minimumViableStops;
  const target = capacity.preferredStops;
  const needed = params.needed ?? Math.max(0, target - params.existingPlaces.length);

  const selectedIds = params.selectedCombinationIds ?? [];
  const mode = selectedIds.length <= 1 ? "single" : "multiple";
  logAiPipeline(
    "[SELECTED_COMBINATION_MODE]",
    `mode=${mode}`,
    `selectedIds=[${selectedIds.join(",")}]`,
  );
  if (mode === "single" && selectedIds[0] != null) {
    logAiPipeline(
      "[SINGLE_COMBINATION_MODE]",
      `selectedCombinationId=${selectedIds[0]}`,
      `tripDays=${params.tripDays}`,
    );
  }

  logAiPipeline(
    "[REAL_PLACE_COUNT_BEFORE_SUPPLEMENT]",
    `count=${params.existingPlaces.length}`,
    `uniqueMajorLandmarks=${params.uniqueMajorLandmarksBefore ?? params.existingPlaces.length}`,
  );

  const themes = params.themeProfile?.primaryThemes?.length
    ? params.themeProfile.primaryThemes
    : params.themes?.length
      ? params.themes
      : ["attraction", "culture", "market", "park", "food"];

  if (mode === "single" && selectedIds[0] != null) {
    logAiPipeline(
      "[SINGLE_THEME_SUPPLEMENT_STARTED]",
      `combinationId=${selectedIds[0]}`,
      `themes=[${themes.join(",")}]`,
    );
  }

  logAiPipeline(
    "[REAL_PLACE_SUPPLEMENT_STARTED]",
    `needed=${needed}`,
    `destination=${params.destination}`,
    `existing=${params.existingPlaces.length}`,
    `tripDays=${params.tripDays}`,
    `minRequired=${minRequired}`,
    `preferred=${target}`,
  );

  if (needed <= 0) {
    logAiPipeline(
      "[REAL_PLACE_SUPPLEMENT_COMPLETED]",
      "added=0",
      "failed=0",
      "reason=already_sufficient",
    );
    if (mode === "single") {
      logAiPipeline("[SINGLE_THEME_SUPPLEMENT_COMPLETED]", "added=0", "rejected=0");
    }
    return { added: [], failed: 0, needed: 0, rejected: 0 };
  }

  const used = new Set(params.existingPlaces.map(placeKey).filter(Boolean));
  const queries = [
    ...themes.flatMap((theme) => themeSearchQueries(theme, params.destination).slice(0, 3)),
    // Generic destination queries only for multi-select — single stays theme-bound.
    ...(mode === "single"
      ? []
      : [
          `${params.destination} 景點`,
          `${params.destination} tourist attraction`,
          `${params.destination} museum`,
          `${params.destination} park`,
        ]),
  ];

  const added: ChatPlaceItem[] = [];
  let failed = 0;
  let rejected = 0;

  for (const query of queries) {
    if (added.length >= needed) break;
    try {
      const result = await params.searchPlaces({
        data: {
          query,
          lat: params.lat,
          lng: params.lng,
          radius: 35_000,
          mode: "text",
          placesScreen: "chat",
          placesCaller: "real_place_supplement",
          destinationName: params.destination,
          searchMode: "destination",
          includedTypes: [
            "tourist_attraction",
            "museum",
            "art_gallery",
            "park",
            "market",
            "shopping_mall",
            "cultural_landmark",
            "historical_landmark",
            "place_of_worship",
          ],
        },
      });
      for (const place of result.places ?? []) {
        if (added.length >= needed) break;
        const key = placeKey(place);
        if (!key || used.has(key)) continue;
        if (!isMappableGooglePlaceId(place.id)) {
          failed += 1;
          rejected += 1;
          continue;
        }
        if (detectSubPlaceType(place.name ?? "")) {
          logAiPipeline(
            "[REAL_PLACE_SUPPLEMENT_SKIPPED]",
            `name=${place.name}`,
            "reason=sub_place",
          );
          rejected += 1;
          continue;
        }
        if (
          isForbiddenTransitAttraction({
            name: place.name,
            types: place.types,
            primaryType: place.primaryType,
          })
        ) {
          rejected += 1;
          continue;
        }
        if (!isResolvedCorePlace({ ...place, destinationMatch: true })) {
          failed += 1;
          rejected += 1;
          continue;
        }
        const primaryTheme = themes[0] ?? "attraction";
        const quality = validateCandidateIntent(
          {
            name: place.name ?? "",
            types: place.types ?? undefined,
            primaryType: place.primaryType,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
            googlePlaceId: place.id,
            rating: place.rating,
          },
          { theme: primaryTheme },
          params.destination,
          { center: { lat: params.lat, lng: params.lng }, requireTourismType: true },
        );
        if (!quality.ok) {
          logRejectedCandidate(
            { name: place.name ?? "", types: place.types ?? undefined },
            selectedIds[0] ?? 0,
            quality.reason ?? "quality",
          );
          failed += 1;
          rejected += 1;
          continue;
        }

        const item = mapPlaceResultToChatItem(place as PlaceResult, {
          mood: params.mood,
          weather: params.weather as never,
          locale: params.locale,
        });
        used.add(key);
        const preferIds = params.selectedCombinationIds?.length
          ? params.selectedCombinationIds
          : undefined;
        added.push({
          ...item,
          matchedSelectedCombinationIds: preferIds?.length
            ? preferIds
            : item.matchedSelectedCombinationIds,
          sourceCombinationIds: preferIds?.length ? preferIds : item.sourceCombinationIds,
          sourceCombinationId: item.sourceCombinationId ?? preferIds?.[0],
        });
        logAiPipeline(
          "[FALLBACK_PLACE_ADDED]",
          `name=${place.name}`,
          `reason=real_place_supplement`,
          `source=places_text_search`,
          `query=${query}`,
        );
      }
    } catch (e) {
      failed += 1;
      console.warn("[real_place_supplement] search failed", e);
    }
  }

  logAiPipeline(
    "[REAL_PLACE_SUPPLEMENT_COMPLETED]",
    `added=${added.length}`,
    `failed=${failed}`,
    `needed=${needed}`,
  );
  if (mode === "single") {
    logAiPipeline(
      "[SINGLE_THEME_SUPPLEMENT_COMPLETED]",
      `added=${added.length}`,
      `rejected=${rejected}`,
    );
  }
  logAiPipeline(
    "[REAL_PLACE_COUNT_AFTER_SUPPLEMENT]",
    `count=${params.existingPlaces.length + added.length}`,
  );

  return { added, failed, needed, rejected };
}

export type NormalizedItineraryStop = {
  id: string;
  googlePlaceId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  types: string[];
  dayIndex?: number;
  arrivalTime: string;
  stayDurationMinutes?: number;
  sourceCombinationIds: number[];
  snapshot: {
    rating?: number | null;
    userRatingCount?: number | null;
    photoName?: string | null;
    openStatusLabel?: string;
    todayHoursLabel?: string;
  };
};

export type StopNormalizationIssue = {
  index: number;
  name: string;
  missingFields: string[];
  invalidFields: string[];
  reason: string;
  rawStop?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Unwrap nested stop wrappers into a flat place-like object. */
export function unwrapRawStop(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  for (const key of ["place", "stop", "data", "item", "payload"] as const) {
    const nested = asRecord(root[key]);
    if (
      nested &&
      (nested.googlePlaceId || nested.placeId || nested.placeName || nested.name || nested.title)
    ) {
      return { ...root, ...nested };
    }
  }
  return root;
}

export function normalizeItineraryStop(
  raw: unknown,
  index: number,
):
  | { ok: true; stop: NormalizedItineraryStop; item: RoamieItineraryItem }
  | { ok: false; issue: StopNormalizationIssue } {
  const unwrapped = unwrapRawStop(raw);
  if (!unwrapped) {
    const issue: StopNormalizationIssue = {
      index,
      name: "",
      missingFields: ["stop"],
      invalidFields: [],
      reason: "stop_unwrap_failed",
      rawStop: raw,
    };
    logAiPipeline(
      "[STOP_VALIDATION_FAILED]",
      `index=${index}`,
      "name=",
      "missingFields=[stop]",
      "invalidFields=[]",
      "reason=stop_unwrap_failed",
    );
    logAiPipeline(
      "[ITINERARY_STOP_NORMALIZED]",
      "day=",
      `order=${index}`,
      "placeId=",
      "placeName=",
      "valid=false",
    );
    // Internal only — never escalate single-stop unwrap to user-facing itinerary failure.
    logAiPipeline(
      "[STOP_UNWRAP_INTERNAL]",
      "reason=stop_unwrap_failed",
      `index=${index}`,
      "userVisible=false",
    );
    return { ok: false, issue };
  }

  const name = String(unwrapped.placeName ?? unwrapped.name ?? unwrapped.title ?? "").trim();
  const googlePlaceId = String(
    unwrapped.googlePlaceId ?? unwrapped.placeId ?? unwrapped.id ?? "",
  ).trim();
  const latRaw = unwrapped.lat ?? unwrapped.latitude;
  const lngRaw = unwrapped.lng ?? unwrapped.longitude;
  const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);
  const address = String(unwrapped.address ?? "").trim();
  const time = String(unwrapped.time ?? unwrapped.arrivalTime ?? "").trim();
  const date = String(unwrapped.date ?? "").trim();

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  if (!name) missingFields.push("name");
  if (!googlePlaceId) missingFields.push("googlePlaceId");
  if (!Number.isFinite(lat)) missingFields.push("latitude");
  if (!Number.isFinite(lng)) missingFields.push("longitude");
  if (!address) missingFields.push("address");
  if (!date) missingFields.push("date");
  if (!time) missingFields.push("arrivalTime");

  if (googlePlaceId && !isMappableGooglePlaceId(googlePlaceId) && !/^ChIJ/.test(googlePlaceId)) {
    invalidFields.push("googlePlaceId");
  }
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) < 0.001 &&
    Math.abs(lng) < 0.001
  ) {
    invalidFields.push("coordinates");
  }

  if (missingFields.length || invalidFields.length) {
    const issue: StopNormalizationIssue = {
      index,
      name,
      missingFields,
      invalidFields,
      reason: missingFields.length ? "stop_schema_invalid" : "stop_field_invalid",
      rawStop: unwrapped,
    };
    logAiPipeline(
      "[STOP_VALIDATION_FAILED]",
      `index=${index}`,
      `name=${name}`,
      `missingFields=[${missingFields.join(",")}]`,
      `invalidFields=[${invalidFields.join(",")}]`,
    );
    logAiPipeline(
      "[ITINERARY_STOP_NORMALIZED]",
      `day=`,
      `order=${index}`,
      `placeId=${googlePlaceId}`,
      `placeName=${name}`,
      "valid=false",
    );
    return { ok: false, issue };
  }

  const types = Array.isArray(unwrapped.types)
    ? unwrapped.types.map(String)
    : unwrapped.placeType
      ? [String(unwrapped.placeType)]
      : [];
  const sourceCombinationIds = Array.isArray(unwrapped.matchedSelectedCombinationIds)
    ? (unwrapped.matchedSelectedCombinationIds as number[])
    : unwrapped.sourceCombinationId != null
      ? [Number(unwrapped.sourceCombinationId)]
      : [];

  const item: RoamieItineraryItem = {
    date,
    time,
    title: String(unwrapped.title ?? name),
    description: String(unwrapped.description ?? ""),
    placeName: name,
    lat,
    lng,
    address,
    googlePlaceId,
    placeType: types[0],
    types,
    dayIndex: typeof unwrapped.dayIndex === "number" ? unwrapped.dayIndex : undefined,
    sourceCombinationId: sourceCombinationIds[0],
    matchedCombinationIds: Array.isArray(unwrapped.matchedCombinationIds)
      ? (unwrapped.matchedCombinationIds as number[])
      : sourceCombinationIds,
    matchedSelectedCombinationIds: sourceCombinationIds,
    photoName: (unwrapped.photoName as string | null | undefined) ?? null,
    rating: typeof unwrapped.rating === "number" ? unwrapped.rating : null,
    userRatingCount:
      typeof unwrapped.userRatingCount === "number" ? unwrapped.userRatingCount : null,
    openStatusLabel: unwrapped.openStatusLabel ? String(unwrapped.openStatusLabel) : undefined,
    todayHoursLabel: unwrapped.todayHoursLabel ? String(unwrapped.todayHoursLabel) : undefined,
    placeSnapshotSource: "selected_place",
  };

  logAiPipeline(
    "[ITINERARY_STOP_NORMALIZED]",
    `day=${item.dayIndex ?? ""}`,
    `order=${index}`,
    `placeId=${googlePlaceId}`,
    `placeName=${name}`,
    "valid=true",
  );

  return {
    ok: true,
    stop: {
      id: googlePlaceId,
      googlePlaceId,
      name,
      address,
      latitude: lat,
      longitude: lng,
      types,
      dayIndex: item.dayIndex,
      arrivalTime: time,
      sourceCombinationIds,
      snapshot: {
        rating: item.rating,
        userRatingCount: item.userRatingCount,
        photoName: item.photoName,
        openStatusLabel: item.openStatusLabel,
        todayHoursLabel: item.todayHoursLabel,
      },
    },
    item,
  };
}

export function normalizeItineraryStops(rawStops: unknown[]): {
  valid: RoamieItineraryItem[];
  invalid: StopNormalizationIssue[];
} {
  const valid: RoamieItineraryItem[] = [];
  const invalid: StopNormalizationIssue[] = [];
  rawStops.forEach((raw, index) => {
    const result = normalizeItineraryStop(raw, index);
    if (result.ok) valid.push(result.item);
    else invalid.push(result.issue);
  });
  logAiPipeline(
    "[STOP_NORMALIZATION_RESULT]",
    `inputCount=${rawStops.length}`,
    `validCount=${valid.length}`,
    `invalidCount=${invalid.length}`,
  );
  return { valid, invalid };
}

export type PreSaveValidationResult = {
  ok: boolean;
  reasons: string[];
  days: number;
  stops: number;
  emptyNonFreeDays: number[];
  invalidStops: StopNormalizationIssue[];
};

export function validateItineraryPreSave(params: {
  tripDays: number;
  startDate: string;
  stops: unknown[];
  freeDayDates?: string[];
  placeAuthority?: "selected_only";
}): PreSaveValidationResult {
  const { valid, invalid } = normalizeItineraryStops(params.stops);
  const reasons: string[] = [];
  const inputCount = params.stops.length;
  const validRatio = inputCount > 0 ? valid.length / inputCount : 0;
  // Prefer delivering when ≥80% stops normalize cleanly — drop invalids instead of total fail.
  if (invalid.length && validRatio < 0.8) {
    reasons.push(`stop_schema_invalid:count=${invalid.length}`);
  } else if (invalid.length) {
    logAiPipeline(
      "[STOP_UNWRAP_INTERNAL]",
      `droppedInvalid=${invalid.length}`,
      `validRatio=${validRatio.toFixed(2)}`,
      "userVisible=false",
      "action=continue_with_valid_stops",
    );
  }

  const freeDays = new Set(params.freeDayDates ?? []);
  const dates = listTripDates([], params.startDate, params.tripDays);

  const emptyNonFreeDays: number[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]!;
    if (freeDays.has(date)) continue;
    const dayStops = valid.filter((s) => (s.date?.trim() || dates[0]) === date);
    if (!dayStops.length && params.placeAuthority !== "selected_only") {
      emptyNonFreeDays.push(i + 1);
      logAiPipeline(
        "[EMPTY_DAY_BLOCKED]",
        `day=${i + 1}`,
        `date=${date}`,
        "reason=no_places_and_not_free_day",
      );
      reasons.push(`empty_non_free_day:${i + 1}`);
    }
  }

  if (
    params.placeAuthority !== "selected_only" &&
    valid.length < params.tripDays &&
    emptyNonFreeDays.length > 0
  ) {
    reasons.push(`insufficient_real_places:got=${valid.length},need=${params.tripDays}`);
  }

  const result: PreSaveValidationResult = {
    ok: reasons.length === 0,
    reasons,
    days: params.tripDays,
    stops: valid.length,
    emptyNonFreeDays,
    invalidStops: invalid,
  };
  logAiPipeline(
    "[ITINERARY_PRE_SAVE_VALIDATION]",
    `days=${result.days}`,
    `stops=${result.stops}`,
    `emptyNonFreeDays=[${emptyNonFreeDays.join(",")}]`,
    `invalidStops=${invalid.length}`,
    `ok=${result.ok}`,
  );
  if (result.ok) {
    logAiPipeline("[ITINERARY_PRE_SAVE_VALIDATION_PASSED]");
  }
  return result;
}

/** Keep for callers that map ChatPlaceItem → recommendation after supplement. */
export function chatSupplementToRecommendation(item: ChatPlaceItem): RoamieRecommendationItem {
  return normalizeRecommendationItem({
    name: item.name,
    placeName: item.placeName ?? item.name,
    type: item.type ?? "景點",
    description: item.description ?? "",
    reason: item.reason ?? "",
    estimatedTime: item.estimatedTime ?? "1-2 小時",
    address: item.address ?? "",
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    googleMapsUrl: item.googleMapsUrl ?? "",
    googlePlaceId: item.googlePlaceId ?? item.placeId,
    reasonSource: "template",
    photoName: item.photoName,
    rating: item.rating,
    userRatingCount: item.userRatingCount,
    businessStatus: item.businessStatus,
    openStatusLabel: item.openStatusLabel,
    todayHoursLabel: item.todayHoursLabel,
    sourceCombinationId: item.sourceCombinationId,
    matchedCombinationIds: item.matchedCombinationIds,
    matchedSelectedCombinationIds: item.matchedSelectedCombinationIds,
  } as Partial<RoamieRecommendationItem> & { name: string });
}
