import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  syncSessionPlaceMemory,
  computeItineraryFetchTarget,
  preparePlacesForItineraryBuild,
  resolveItineraryPlaceSources,
} from "@/lib/place-planning-memory";
import {
  fetchPlacesWithSearchAttempts,
  type PlaceSearchFn,
  type SearchAttempt,
} from "@/lib/ai/chat-place-recommendation";
import {
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import {
  buildWeatherAwareSearchAttempts,
  resolveWeatherScene,
} from "@/lib/ai/weather-place-search";
import { getMustVisitPlacesForDestination } from "@/lib/ai/must-visit-places";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  logItineraryDaysParsed,
  logItineraryGeocodeQuery,
  logItineraryBuildSource,
  logItineraryUsedRecommendedPlaces,
  logItineraryValidationResult,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import { buildDestinationTextSearchAttempts } from "@/lib/ai/destination-geocode";
import {
  filterExcludedPlaceIds,
  type PlaceLike,
} from "@/lib/place-planning-memory";
import {
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
  isGenericPlaceLabel,
  isValidItineraryStopPlace,
} from "@/lib/ai/generic-place-label";
import {
  buildCityAttractionSearchAttempts,
  buildLandmarkCompanionSearchAttempts,
  classifyDestinationForPlaceSearch,
} from "@/lib/ai/landmark-place-strategy";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { WeatherSummary } from "@/lib/weather-types";
import { ITINERARY_PARTIAL_FAILURE_MESSAGE } from "@/lib/trip/itinerary-guards";
import {
  mapChatPlacesToGooglePlaces,
  mapNamedPlaceToGoogle,
  isMappableGooglePlaceId,
} from "@/lib/ai/map-named-places-to-google";
import { resolveTripCreateDates } from "@/lib/ai/resolve-trip-create-dates";
import { filterOutTransitAttractions } from "@/lib/ai/transit-station-filter";
import {
  buildCombinationAllowlistFromTitles,
  filterPlacesByCombinationAllowlist,
  flattenDestinationCombinationPlaces,
  isPlaceNameInCombinationAllowlist,
  type CombinationSelectionAllowlist,
} from "@/lib/ai/destination-combination-suggestions";
import {
  annotatePlaceWithCombinationMetadata,
  buildCombinationPlaceMappingStats,
  mergeSelectedCombinationCandidates,
  resolveSelectedCombinationPools,
  computeMinimumResolvedPerCombination,
  computeMinimumResolvedPlaces,
  expandAllowlistNamesFromPools,
  clearCombinationPoolMemo,
} from "@/lib/ai/combination-itinerary-integrity";
import {
  themeSearchQueries,
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import { beginDestinationTravelProfileSession } from "@/lib/ai/destination-travel-profile";
import type { CombinationPlaceCandidate } from "@/lib/ai/destination-combination-discovery";
import { isResolvedCorePlace } from "@/lib/ai/planning-real-place";
import {
  beginPlacesGenerationSession,
  getPlacesApiCallStats,
  logPlacesApiCallStats,
} from "@/lib/places-api-guard";
import {
  computeFirstRoundPlaceMapCap,
  computeItineraryResolvedTarget,
  createPlaceMapDedupeScope,
  mapWithConcurrencyLimit,
  PLACE_MAP_MAX_CONCURRENCY,
} from "@/lib/ai/place-map-queue";

export { INSUFFICIENT_ITINERARY_PLACES_MESSAGE };

export type ItineraryPlaceFailureCode =
  | "places_rate_limited"
  | "places_auth_error"
  | "places_invalid_request"
  | "place_details_failed"
  | "insufficient_resolved_places"
  | "places_api_empty"
  | "no_candidate_places";

export type ItineraryPlaceFailure = {
  code: ItineraryPlaceFailureCode;
  stage: string;
  attemptedCandidates: number;
  resolvedCandidates: number;
  /** Places API rate-limit / detail retries (legacy field) */
  retryCount: number;
  /** Combination mapping theme-search / fallback retries */
  searchRetryCount?: number;
  candidateRegenerationCount?: number;
  detailRetryCount?: number;
  fallbackCandidateCount?: number;
  generationRequestId: string;
  /** Partially resolved places preserved for regenerate */
  partialResolvedPlaces?: ChatPlaceItem[];
};

export const COMBINATION_MAPPING_AUTO_RETRY_MESSAGE =
  "部分景點仍在確認中，正在重新搜尋符合你選擇的地點…";

export const COMBINATION_MAPPING_FAILED_MESSAGE =
  "部分已選組合目前無法取得足夠的真實地點。";

export const COMBINATION_MAPPING_REGENERATE_OPTION = "重新生成";

const PLACE_FAILURE_PRIORITY: ItineraryPlaceFailureCode[] = [
  "places_rate_limited",
  "places_auth_error",
  "places_invalid_request",
  "place_details_failed",
  "insufficient_resolved_places",
  "places_api_empty",
];

function pickDominantFailureCode(
  stats: ReturnType<typeof getPlacesApiCallStats>,
  resolved: number,
  attempted: number,
): ItineraryPlaceFailureCode {
  if (stats.textRateLimited > 0 || stats.blocked > 0) return "places_rate_limited";
  if (stats.detailFailed > 0 && stats.detailSuccess === 0 && resolved === 0) {
    return "place_details_failed";
  }
  if (attempted > 0 && resolved > 0 && resolved < Math.max(6, Math.ceil(attempted / 2))) {
    return "insufficient_resolved_places";
  }
  if (resolved === 0 && attempted > 0) return "places_api_empty";
  if (resolved === 0) return "places_api_empty";
  return "insufficient_resolved_places";
}

function logItineraryRootCause(failure: ItineraryPlaceFailure): void {
  logAiPipeline(
    "[ITINERARY_FAILURE_ROOT_CAUSE]",
    JSON.stringify(failure),
  );
  // Prefer root cause over generic places_api_empty in Xcode.
  const preferred = PLACE_FAILURE_PRIORITY.includes(failure.code)
    ? failure.code
    : "places_api_empty";
  logAiPipeline("[AI_ITINERARY_FAILED]", `reason=${preferred}`);
}

const ITINERARY_PLACE_TYPES = [
  "tourist_attraction",
  "restaurant",
  "cafe",
  "shopping_mall",
  "museum",
  "park",
] as const;

const TYPE_QUERY_LABEL: Record<(typeof ITINERARY_PLACE_TYPES)[number], string[]> = {
  tourist_attraction: ["必去景點", "人氣景點", "landmark", "attractions"],
  restaurant: ["美食", "餐廳", "restaurants"],
  cafe: ["咖啡廳", "café", "cafe"],
  shopping_mall: ["商圈", "購物", "shopping mall"],
  museum: ["博物館", "美術館", "museum"],
  park: ["公園", "park", "綠地"],
};

function buildMultiTypeItinerarySearchAttempts(destination: string): SearchAttempt[] {
  const label = destination.trim();
  if (!label) return [];

  const attempts: SearchAttempt[] = [];
  for (const type of ITINERARY_PLACE_TYPES) {
    for (const suffix of TYPE_QUERY_LABEL[type]) {
      attempts.push({
        query: `${label} ${suffix}`,
        mode: "text",
        includedTypes: [type],
      });
    }
    attempts.push({
      query: label,
      mode: "nearby",
      includedTypes: [type],
    });
  }
  return attempts;
}

function buildCityOrLandmarkSearchAttempts(
  destination: string,
  geocoded: { city?: string; region?: string; lat: number; lng: number } | null,
  weather: WeatherSummary | null,
  context: CanonicalTravelContext,
): SearchAttempt[] {
  const profile = classifyDestinationForPlaceSearch(destination, geocoded);
  const weatherLabel =
    profile.kind === "landmark" ? (profile.nearestCity ?? destination) : destination;
  const weatherAttempts = buildWeatherAwareSearchAttempts(weatherLabel, weather, context);
  if (profile.kind === "landmark") {
    return [...buildLandmarkCompanionSearchAttempts(profile), ...weatherAttempts];
  }
  return [...buildCityAttractionSearchAttempts(destination), ...weatherAttempts];
}

function templateNameSearchAttempts(destination: string): SearchAttempt[] {
  return getMustVisitPlacesForDestination(destination)
    .filter((p) => !isGenericPlaceLabel(p.name, destination))
    .slice(0, 8)
    .map((place) => ({
      query: `${destination} ${place.name}`,
      mode: "text" as const,
      includedTypes: ["tourist_attraction"],
    }));
}

function rankByQuality(places: PlaceResult[]): PlaceResult[] {
  return [...places].sort((a, b) => {
    const score = (p: PlaceResult) =>
      (p.rating ?? 0) * Math.log10((p.userRatingCount ?? 0) + 10) +
      (p.photoName ? 0.5 : 0);
    return score(b) - score(a);
  });
}

function dedupeChatPlaces(places: ChatPlaceItem[]): ChatPlaceItem[] {
  const seen = new Set<string>();
  const out: ChatPlaceItem[] = [];
  for (const p of places) {
    const key = p.placeId?.trim() || p.googlePlaceId?.trim() || `${p.name}@${p.address ?? ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function dedupePlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const p of places) {
    const key = p.id?.trim() || `${p.name}@${p.address ?? ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function categoryLabelForPlace(place: PlaceResult): string {
  const type = `${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase();
  if (/restaurant|food|meal/.test(type)) return "餐廳";
  if (/cafe|coffee|bakery/.test(type)) return "咖啡廳";
  if (/shopping_mall|store|market/.test(type)) return "商圈";
  if (/museum|art_gallery/.test(type)) return "博物館";
  if (/park|garden/.test(type)) return "公園";
  return "景點";
}

export function filterValidItineraryPlaces(
  places: PlaceResult[],
  destination: string,
): PlaceResult[] {
  return dedupePlaces(places).filter((p) => isValidItineraryStopPlace(p, destination));
}

export function placesToChatItems(
  places: PlaceResult[],
  context: CanonicalTravelContext,
  locale: Locale,
): ChatPlaceItem[] {
  return places.map((p) => {
    const item = mapPlaceResultToChatItem(p, {
      mood: context.mood,
      locale,
      categoryLabel: categoryLabelForPlace(p),
    });
    return {
      ...item,
      placeId: item.googlePlaceId ?? p.id,
    };
  });
}

export type FetchItineraryPlacesResult =
  | { ok: true; places: ChatPlaceItem[]; rawCount: number; validCount: number }
  | {
      ok: false;
      reason: "api_empty" | "filtered_empty";
      message: string;
      rawCount: number;
      validCount: number;
    };

export async function fetchItineraryPlaces(params: {
  destination: string;
  days: number;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
}): Promise<FetchItineraryPlacesResult> {
  const {
    destination,
    days,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds = [],
  } = params;

  const label = sanitizeDestinationForGeocode(destination);
  const fetchTarget = computeItineraryFetchTarget(days);

  logAiPipeline(
    "[ITINERARY_PLACES_FETCH]",
    `destination=${label}`,
    `days=${days}`,
    `fetchTarget=${fetchTarget}`,
  );

  logItineraryGeocodeQuery(label);

  const geocoded = await geocodeDestinationWithFallback({
    destination: label,
    locale,
    geocodeFn,
  });

  let lat: number;
  let lng: number;
  let geocodedForProfile: typeof geocoded = geocoded;

  if (geocoded?.lat != null && geocoded?.lng != null) {
    lat = geocoded.lat;
    lng = geocoded.lng;
  } else {
    const approx = resolveDestinationApproxCenter(label);
    lat = approx?.lat ?? 24.1477;
    lng = approx?.lng ?? 120.6736;
    geocodedForProfile = {
      placeId: "",
      country: "",
      city: label,
      lat,
      lng,
      formattedName: label,
      displayLabel: label,
    };
    console.warn("[ITINERARY_PLACES_FETCH] geocode_fallback", label);
  }

  let weather: WeatherSummary | null = null;
  if (fetchWeatherFn) {
    try {
      const raw = await fetchWeatherFn({ data: { lat, lng, locale } });
      const { unwrapWeatherResult } = await import("@/lib/ai/unwrap-weather-result");
      weather = unwrapWeatherResult(raw);
    } catch (e) {
      console.warn("[ITINERARY_PLACES_FETCH] weather_skipped", e);
    }
  }

  const scene = resolveWeatherScene(weather, label);
  void scene;

  const attempts: SearchAttempt[] = [
    ...buildMultiTypeItinerarySearchAttempts(label),
    ...buildCityOrLandmarkSearchAttempts(label, geocodedForProfile, weather, context),
    ...templateNameSearchAttempts(label),
    ...buildDestinationTextSearchAttempts(label),
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 景點`, mode: "nearby", includedTypes: ["tourist_attraction", "museum", "park"] },
  ];

  const searchExtras = geocoded
    ? undefined
    : {
        searchContext: {
          searchMode: "destination" as const,
          destinationName: label,
          textOnlyDestinationSearch: true,
        },
      };

  let raw: PlaceResult[] = [];
  for (const attempt of attempts) {
    const batch = await fetchPlacesWithSearchAttempts(
      searchPlaces,
      lat,
      lng,
      locale,
      [attempt],
      "itinerary.fetchPlaces",
      searchExtras,
    );
    raw = dedupePlaces([...raw, ...batch]);
    raw = filterExcludedPlaceIds(raw, excludePlaceIds);
    const valid = filterValidItineraryPlaces(raw, label);
    if (valid.length >= fetchTarget) break;
  }

  const valid = filterValidItineraryPlaces(
    filterOutTransitAttractions(filterExcludedPlaceIds(raw, excludePlaceIds)),
    label,
  );
  const ranked = rankByQuality(valid).slice(0, Math.max(fetchTarget, days + 2));

  logAiPipeline(
    "[ITINERARY_PLACES_FETCH]",
    `raw=${raw.length}`,
    `valid=${valid.length}`,
    `selected=${ranked.length}`,
  );

  if (raw.length < 1) {
    return {
      ok: false,
      reason: "api_empty",
      message: ITINERARY_PARTIAL_FAILURE_MESSAGE,
      rawCount: 0,
      validCount: 0,
    };
  }

  if (ranked.length < 1) {
    return {
      ok: false,
      reason: "filtered_empty",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      rawCount: raw.length,
      validCount: 0,
    };
  }

  const items = placesToChatItems(ranked, context, locale);
  if (!items.length) {
    return {
      ok: false,
      reason: "filtered_empty",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      rawCount: raw.length,
      validCount: valid.length,
    };
  }

  return { ok: true, places: items, rawCount: raw.length, validCount: valid.length };
}

function resolveGenerationAllowlist(
  context: CanonicalTravelContext,
  destination: string,
): CombinationSelectionAllowlist | null {
  if (context.selectedCombinationPlaceNames?.length) {
    const ids = context.selectedCombinationIds ?? [];
    return {
      selectedCombinationIds: ids,
      selectedCombinationIndexes: ids.map((id) => id - 1),
      allowedTitles: context.selectedTripStyle
        ? context.selectedTripStyle.split("、").map((s) => s.trim()).filter(Boolean)
        : [],
      allowedPlaceNames: context.selectedCombinationPlaceNames,
      excludedTitles: [],
      exclusiveExcludedPlaceNames: context.excludedCombinationPlaceNames ?? [],
    };
  }
  if (context.selectedTripStyle?.trim()) {
    const titles = context.selectedTripStyle
      .split(/[、,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return buildCombinationAllowlistFromTitles(destination, titles);
  }
  return null;
}

async function mergeSessionPlacesWithFetch(params: {
  sessionPlaces: ChatPlaceItem[];
  destination: string;
  days: number;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
  fetchPlaceDetails?: (placeId: string) => Promise<PlaceResult | null>;
  generationRequestId: string;
}): Promise<
  | { ok: true; places: ChatPlaceItem[] }
  | {
      ok: false;
      message: string;
      apiEmpty: boolean;
      failure: ItineraryPlaceFailure;
    }
> {
  const fetchTarget = computeItineraryResolvedTarget(params.days);
  const firstRoundCap = computeFirstRoundPlaceMapCap(params.days);
  const allowlist = resolveGenerationAllowlist(params.context, params.destination);
  const dedupe = createPlaceMapDedupeScope(params.generationRequestId);

  const geocoded = await geocodeDestinationWithFallback({
    destination: params.destination,
    locale: params.locale,
    geocodeFn: params.geocodeFn,
  });
  const approx = resolveDestinationApproxCenter(params.destination);
  const lat = geocoded?.lat ?? approx?.lat ?? 24.1477;
  const lng = geocoded?.lng ?? approx?.lng ?? 120.6736;

  const scopedSessionPlaces = allowlist
    ? filterPlacesByCombinationAllowlist(params.sessionPlaces, allowlist)
    : params.sessionPlaces;

  // Prefer previously resolved places from a failed run (regenerate), then combination pools.
  const priorResolved = (params.context.partiallyResolvedPlaces ?? []).filter((p) =>
    isMappableGooglePlaceId(p.googlePlaceId ?? p.placeId),
  );

  clearCombinationPoolMemo();
  beginDestinationTravelProfileSession(params.generationRequestId);

  const comboPools = allowlist?.selectedCombinationIds.length
    ? resolveSelectedCombinationPools(
        params.destination,
        allowlist.selectedCombinationIds,
        { forceRefresh: true },
      )
    : [];

  const expandedAllowNames = allowlist
    ? expandAllowlistNamesFromPools(
        params.destination,
        allowlist.selectedCombinationIds,
        allowlist.allowedPlaceNames,
      )
    : [];

  const effectiveAllowlist = allowlist
    ? { ...allowlist, allowedPlaceNames: expandedAllowNames }
    : null;

  const comboNamesRaw = effectiveAllowlist?.allowedPlaceNames?.length
    ? (() => {
        const merged = mergeSelectedCombinationCandidates(
          params.destination,
          effectiveAllowlist.selectedCombinationIds,
        );
        return merged.places.length
          ? merged.places
          : effectiveAllowlist.allowedPlaceNames;
      })()
    : !effectiveAllowlist
      ? flattenDestinationCombinationPlaces(params.destination)
      : [];

  const candidateByName = new Map<string, CombinationPlaceCandidate>();
  for (const pool of comboPools) {
    for (const c of pool.all) {
      const key = c.name.replace(/\s+/g, "").toLowerCase();
      if (!candidateByName.has(key)) candidateByName.set(key, c);
    }
  }

  const seenName = new Set<string>();
  const prioritizeNames: string[] = [];
  // Seed prior resolved first so regenerate does not re-search them blindly.
  for (const p of priorResolved) {
    const n = (p.placeName ?? p.name ?? "").trim();
    if (!n) continue;
    const key = n.replace(/\s+/g, "").toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    prioritizeNames.push(n);
  }
  for (const p of scopedSessionPlaces) {
    const n = (p.placeName ?? p.name ?? "").trim();
    if (!n) continue;
    const key = n.replace(/\s+/g, "").toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    prioritizeNames.push(n);
  }
  // Primary candidates before fallback names.
  for (const pool of comboPools) {
    for (const c of pool.primary) {
      const key = c.name.replace(/\s+/g, "").toLowerCase();
      if (seenName.has(key)) continue;
      seenName.add(key);
      prioritizeNames.push(c.name);
    }
  }
  for (const n of comboNamesRaw) {
    const key = n.replace(/\s+/g, "").toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    prioritizeNames.push(n);
  }

  const firstRoundNames = prioritizeNames.slice(0, firstRoundCap);
  const reserveNames = prioritizeNames.slice(firstRoundCap);
  logAiPipeline(
    "[PLACE_MAP_CANDIDATE_CAP]",
    `days=${params.days}`,
    `firstRound=${firstRoundNames.length}`,
    `reserve=${reserveNames.length}`,
    `cap=${firstRoundCap}`,
    `target=${fetchTarget}`,
  );

  if (firstRoundNames.length === 0) {
    const failure: ItineraryPlaceFailure = {
      code: "no_candidate_places",
      stage: "candidate_discovery",
      attemptedCandidates: 0,
      resolvedCandidates: 0,
      retryCount: 0,
      searchRetryCount: 0,
      candidateRegenerationCount: 0,
      fallbackCandidateCount: 0,
      generationRequestId: params.generationRequestId,
    };
    logAiPipeline(
      "[ITINERARY_INPUT_VALIDATION_FAILED]",
      "field=candidatePlaces",
      "value=[]",
      `generationRequestId=${params.generationRequestId}`,
      "code=no_candidate_places",
    );
    return {
      ok: false,
      message: `${INSUFFICIENT_ITINERARY_PLACES_MESSAGE}\n\n點選「重新生成」可沿用目前目的地與選擇再試一次。`,
      apiEmpty: false,
      failure,
    };
  }

  const withComboMeta = (item: ChatPlaceItem, forceComboId?: number): ChatPlaceItem => {
    const ids = effectiveAllowlist?.selectedCombinationIds ?? [];
    if (!ids.length) return item;
    const annotated = annotatePlaceWithCombinationMetadata(
      item,
      params.destination,
      ids,
    );
    if (forceComboId != null && annotated.sourceCombinationId == null) {
      return {
        ...annotated,
        sourceCombinationId: forceComboId,
        matchedSelectedCombinationIds: [forceComboId],
        matchedCombinationIds: [forceComboId],
      };
    }
    return annotated;
  };

  const seedFromName = (place: string): ChatPlaceItem => {
    const existing =
      priorResolved.find((p) => (p.placeName ?? p.name ?? "").trim() === place) ??
      scopedSessionPlaces.find((p) => (p.placeName ?? p.name ?? "").trim() === place);
    if (existing) return withComboMeta(existing);
    const cached = candidateByName.get(place.replace(/\s+/g, "").toLowerCase());
    const knownId = cached?.googlePlaceId?.trim() || "";
    return withComboMeta(
      mapPlaceResultToChatItem(
        {
          id: knownId,
          name: place,
          address: params.destination,
          lat: cached?.coordinates?.lat ?? null,
          lng: cached?.coordinates?.lng ?? null,
          rating: cached?.rating ?? null,
          userRatingCount: null,
          photoName: null,
          primaryType: cached?.primaryType ?? "tourist_attraction",
          types: cached?.types?.length ? cached.types : ["tourist_attraction"],
          businessStatus: null,
          openStatus: "unknown",
          openStatusLabel: "",
          todayHoursLabel: "",
          closingSoonNote: "",
          nextOpenHint: "",
        },
        {
          mood: params.context.mood,
          weather: params.context.weather,
          locale: params.locale,
        },
      ),
    );
  };

  const seedPlaces: ChatPlaceItem[] = firstRoundNames.map(seedFromName);

  let attemptedCandidates = firstRoundNames.length;
  let candidateRegenerationCount = 0;
  let searchRetryCount = 0;
  let fallbackCandidateCount = 0;

  const mappedSession = await mapChatPlacesToGooglePlaces({
    places: seedPlaces,
    destination: params.destination,
    lat,
    lng,
    locale: params.locale,
    searchPlaces: params.searchPlaces,
    fetchPlaceDetails: params.fetchPlaceDetails,
    context: params.context,
    generationRequestId: params.generationRequestId,
    dedupe,
  });

  // Backfill from reserve pool only when first round is short — concurrency 2.
  const mappedCombo: ChatPlaceItem[] = [];
  if (mappedSession.length < fetchTarget && reserveNames.length) {
    const need = Math.min(reserveNames.length, fetchTarget - mappedSession.length + 2);
    const backfill = reserveNames.slice(0, need);
    fallbackCandidateCount += backfill.length;
    const mappedBackfill = await mapWithConcurrencyLimit(
      backfill,
      async (name) => {
        if (
          effectiveAllowlist &&
          !isPlaceNameInCombinationAllowlist(name, effectiveAllowlist)
        ) {
          return null;
        }
        return mapNamedPlaceToGoogle({
          name,
          destination: params.destination,
          lat,
          lng,
          locale: params.locale,
          searchPlaces: params.searchPlaces,
          fetchPlaceDetails: params.fetchPlaceDetails,
          dedupe,
          generationRequestId: params.generationRequestId,
        });
      },
      { concurrency: PLACE_MAP_MAX_CONCURRENCY },
    );
    for (const found of mappedBackfill) {
      if (!found || !isResolvedCorePlace({ ...found, destinationMatch: true })) continue;
      if (!isMappableGooglePlaceId(found.id)) continue;
      mappedCombo.push(
        withComboMeta(
          mapPlaceResultToChatItem(found, {
            mood: params.context.mood,
            weather: params.context.weather,
            locale: params.locale,
          }),
        ),
      );
      if (mappedSession.length + mappedCombo.length >= fetchTarget) break;
    }
  }

  // When allowlist is locked, do not open destination-wide Nearby/Text fill.
  let fetched: ChatPlaceItem[] = [];
  if (!effectiveAllowlist && mappedSession.length + mappedCombo.length < fetchTarget) {
    const fetchResult = await fetchItineraryPlaces(params);
    fetched = fetchResult.ok
      ? fetchResult.places.filter((p) =>
          isMappableGooglePlaceId(p.googlePlaceId ?? p.placeId),
        )
      : [];
  }

  const allowOrComboAnnotated = (p: ChatPlaceItem): boolean => {
    if (!effectiveAllowlist) return true;
    if (isPlaceNameInCombinationAllowlist(p.placeName ?? p.name ?? "", effectiveAllowlist)) {
      return true;
    }
    // Theme-search / promoted fallback places carry combination provenance.
    const matched =
      p.matchedSelectedCombinationIds ??
      (p.sourceCombinationId != null ? [p.sourceCombinationId] : []);
    return matched.some((id) => effectiveAllowlist.selectedCombinationIds.includes(id));
  };

  let merged = dedupeChatPlaces([
    ...priorResolved.map((p) => withComboMeta(p)),
    ...mappedSession.map((p) => withComboMeta(p)),
    ...mappedCombo,
    ...fetched.map((p) => withComboMeta(p)),
  ])
    .filter((p) => {
      const id = p.googlePlaceId ?? p.placeId;
      if (!isMappableGooglePlaceId(id)) return false;
      if (
        !isResolvedCorePlace({
          id,
          googlePlaceId: id,
          name: p.placeName ?? p.name,
          address: p.address ?? `${p.placeName ?? p.name}, ${params.destination}`,
          lat: p.lat,
          lng: p.lng,
          destinationMatch: true,
        })
      ) {
        return false;
      }
      if (!allowOrComboAnnotated(p)) {
        logAiPipeline(
          "[COMBINATION_ALLOWLIST_FILTERED]",
          `place=${p.placeName ?? p.name}`,
          `reason=not_in_selected_combinations`,
        );
        return false;
      }
      return true;
    });

  const mappingMeta: Record<
    number,
    {
      fallbackCandidatesUsed: number;
      searchRequests: number;
      searchRetries: number;
      primaryCandidates: number;
    }
  > = {};

  const countResolvedForCombo = (comboId: number): number =>
    merged.filter((p) => {
      const ids =
        p.matchedSelectedCombinationIds ??
        (p.sourceCombinationId != null ? [p.sourceCombinationId] : []);
      if (ids.includes(comboId)) return true;
      return annotatePlaceWithCombinationMetadata(
        p,
        params.destination,
        effectiveAllowlist?.selectedCombinationIds ?? [comboId],
      ).matchedSelectedCombinationIds?.includes(comboId);
    }).length;

  const mapCandidateName = async (
    name: string,
    comboId: number,
  ): Promise<ChatPlaceItem | null> => {
    const found = await mapNamedPlaceToGoogle({
      name,
      destination: params.destination,
      lat,
      lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      fetchPlaceDetails: params.fetchPlaceDetails,
      dedupe,
      generationRequestId: params.generationRequestId,
    });
    if (!found || !isResolvedCorePlace({ ...found, destinationMatch: true })) return null;
    if (!isMappableGooglePlaceId(found.id)) return null;
    const quality = validateCandidateIntent(
      {
        name: found.name ?? name,
        types: found.types ?? undefined,
        primaryType: found.primaryType,
        address: found.address,
        lat: found.lat,
        lng: found.lng,
        googlePlaceId: found.id,
      },
      {
        theme: comboPools.find((p) => p.combinationId === comboId)?.theme,
        title: comboPools.find((p) => p.combinationId === comboId)?.title,
      },
      params.destination,
      { center: { lat, lng } },
    );
    if (!quality.ok) {
      logRejectedCandidate(
        { name: found.name ?? name, types: found.types ?? undefined },
        comboId,
        quality.reason ?? "quality",
      );
      return null;
    }
    return withComboMeta(
      mapPlaceResultToChatItem(found, {
        mood: params.context.mood,
        weather: params.context.weather,
        locale: params.locale,
      }),
      comboId,
    );
  };

  // Per-combination: primary → fallback → theme Places search until quota.
  if (effectiveAllowlist?.selectedCombinationIds.length) {
    const minPerCombo = computeMinimumResolvedPerCombination(params.days);
    const minTotal = computeMinimumResolvedPlaces({
      tripDays: params.days,
      selectedCombinationCount: effectiveAllowlist.selectedCombinationIds.length,
    });

    for (const pool of comboPools) {
      mappingMeta[pool.combinationId] = {
        fallbackCandidatesUsed: 0,
        searchRequests: 0,
        searchRetries: 0,
        primaryCandidates: pool.primary.length,
      };
      let resolved = countResolvedForCombo(pool.combinationId);

      // Map unused primary candidates that still lack a match.
      if (resolved < minPerCombo) {
        const needed = minPerCombo - resolved;
        const primaryPending = pool.primary.filter(
          (c) =>
            !merged.some((p) =>
              (p.placeName ?? p.name ?? "")
                .replace(/\s+/g, "")
                .toLowerCase()
                .includes(c.name.replace(/\s+/g, "").toLowerCase()),
            ),
        );
        const toMap = primaryPending.slice(0, needed + 1);
        attemptedCandidates += toMap.length;
        const mapped = await mapWithConcurrencyLimit(
          toMap,
          async (c) => mapCandidateName(c.name, pool.combinationId),
          { concurrency: PLACE_MAP_MAX_CONCURRENCY },
        );
        for (const item of mapped) {
          if (item) merged.push(item);
        }
        merged = dedupeChatPlaces(merged);
        resolved = countResolvedForCombo(pool.combinationId);
      }

      // Fallback candidates — stop once quota met.
      if (resolved < minPerCombo && pool.fallback.length) {
        logAiPipeline(
          "[COMBINATION_PLACE_MAPPING_RETRY]",
          `combinationId=${pool.combinationId}`,
          `phase=fallback`,
          `need=${minPerCombo - resolved}`,
          `fallback=${pool.fallback.map((f) => f.name).join("|")}`,
        );
        searchRetryCount += 1;
        for (const c of pool.fallback) {
          if (resolved >= minPerCombo) break;
          mappingMeta[pool.combinationId]!.fallbackCandidatesUsed += 1;
          fallbackCandidateCount += 1;
          attemptedCandidates += 1;
          mappingMeta[pool.combinationId]!.searchRetries += 1;
          const item = await mapCandidateName(c.name, pool.combinationId);
          if (item) {
            merged.push(item);
            merged = dedupeChatPlaces(merged);
            resolved = countResolvedForCombo(pool.combinationId);
          }
        }
      }

      // Theme Places search refill (real Places → candidates).
      if (resolved < minPerCombo) {
        const queries = themeSearchQueries(pool.theme, params.destination);
        logAiPipeline(
          "[COMBINATION_PLACE_MAPPING_RETRY]",
          `combinationId=${pool.combinationId}`,
          `phase=theme_search`,
          `queries=${queries.slice(0, 4).join("|")}`,
        );
        searchRetryCount += 1;
        candidateRegenerationCount += 1;
        for (const query of queries) {
          if (resolved >= minPerCombo) break;
          mappingMeta[pool.combinationId]!.searchRequests += 1;
          mappingMeta[pool.combinationId]!.searchRetries += 1;
          try {
            const result = await params.searchPlaces({
              data: {
                query,
                lat,
                lng,
                radius: 30_000,
                mode: "text",
                placesScreen: "chat",
                placesCaller: "combination_theme_refill",
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
                ],
              },
            });
            for (const place of result.places ?? []) {
              if (resolved >= minPerCombo) break;
              const quality = validateCandidateIntent(
                {
                  name: place.name ?? "",
                  types: place.types ?? undefined,
                  primaryType: place.primaryType,
                  address: place.address,
                  lat: place.lat,
                  lng: place.lng,
                  googlePlaceId: place.id,
                },
                { theme: pool.theme, title: pool.title },
                params.destination,
                { center: { lat, lng }, requireTourismType: true },
              );
              if (!quality.ok) {
                logRejectedCandidate(
                  { name: place.name ?? "", types: place.types ?? undefined },
                  pool.combinationId,
                  quality.reason ?? "quality",
                );
                continue;
              }
              if (!isMappableGooglePlaceId(place.id)) continue;
              if (!isResolvedCorePlace({ ...place, destinationMatch: true })) continue;
              if (
                merged.some(
                  (p) => (p.googlePlaceId ?? p.placeId) === place.id,
                )
              ) {
                continue;
              }
              attemptedCandidates += 1;
              const item = withComboMeta(
                mapPlaceResultToChatItem(place, {
                  mood: params.context.mood,
                  weather: params.context.weather,
                  locale: params.locale,
                }),
                pool.combinationId,
              );
              merged.push(item);
              merged = dedupeChatPlaces(merged);
              resolved = countResolvedForCombo(pool.combinationId);
            }
          } catch {
            // continue other queries
          }
        }
      }
    }

    let mappingStats = buildCombinationPlaceMappingStats({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      mappingMeta,
    });

    const missingCombos = mappingStats.filter((s) => s.resolvedCount === 0);
    const underQuota = mappingStats.filter((s) => s.resolvedCount < minPerCombo);
    const totalOk = merged.length >= Math.min(minTotal, minPerCombo * comboPools.length);

    if (missingCombos.length || (underQuota.length && !totalOk && merged.length < params.days)) {
      logAiPipeline(
        "[COMBINATION_PLACE_MAPPING_INCOMPLETE]",
        `missing=${missingCombos.map((s) => s.combinationId).join(",") || "none"}`,
        `underQuota=${underQuota.map((s) => s.combinationId).join(",")}`,
        `resolvedTotal=${merged.length}`,
        `minPerCombo=${minPerCombo}`,
        `minTotal=${minTotal}`,
      );
      const apiStats = getPlacesApiCallStats();
      const failure: ItineraryPlaceFailure = {
        code: "insufficient_resolved_places",
        stage: "combination_mapping",
        attemptedCandidates,
        resolvedCandidates: merged.length,
        retryCount: apiStats.retryCount,
        searchRetryCount,
        candidateRegenerationCount,
        detailRetryCount: apiStats.detailFailed,
        fallbackCandidateCount,
        generationRequestId: params.generationRequestId,
        partialResolvedPlaces: merged,
      };
      logItineraryRootCause(failure);
      return {
        ok: false,
        message: COMBINATION_MAPPING_FAILED_MESSAGE,
        apiEmpty: false,
        failure,
      };
    }

    // Soft: allow continue when every combo has ≥1 place and trip days can be filled.
    if (underQuota.length) {
      logAiPipeline(
        "[COMBINATION_PLACE_MAPPING_SOFT_PASS]",
        `underQuota=${underQuota.map((s) => `${s.combinationId}:${s.resolvedCount}`).join(",")}`,
        `resolvedTotal=${merged.length}`,
      );
    }

    mappingStats = buildCombinationPlaceMappingStats({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      mappingMeta,
    });
    void mappingStats;
  }

  merged = merged.slice(0, Math.max(fetchTarget, mappedSession.length || 1, params.days));

  const stats = getPlacesApiCallStats();
  logPlacesApiCallStats("itinerary_merge");
  logAiPipeline(
    "[ITINERARY_MERGE_STATS]",
    `mappedSession=${mappedSession.length}`,
    `mappedCombo=${mappedCombo.length}`,
    `fetched=${fetched.length}`,
    `merged=${merged.length}`,
    `allowlist=${effectiveAllowlist ? effectiveAllowlist.selectedCombinationIds.join(",") : "none"}`,
    `selectionSource=${params.context.selectionSource ?? effectiveAllowlist?.selectionSource ?? "none"}`,
    `attemptedCandidates=${attemptedCandidates}`,
    `searchRetryCount=${searchRetryCount}`,
    `fallbackCandidateCount=${fallbackCandidateCount}`,
    `apiCalls=${JSON.stringify(stats)}`,
  );

  if (merged.length > 0) {
    return { ok: true, places: merged };
  }

  const failure: ItineraryPlaceFailure = {
    code: pickDominantFailureCode(stats, 0, attemptedCandidates),
    stage: "place_mapping",
    attemptedCandidates,
    resolvedCandidates: 0,
    retryCount: stats.retryCount,
    searchRetryCount,
    candidateRegenerationCount,
    fallbackCandidateCount,
    generationRequestId: params.generationRequestId,
  };
  logItineraryRootCause(failure);

  return {
    ok: false,
    message: `${COMBINATION_MAPPING_FAILED_MESSAGE}\n\n點選「${COMBINATION_MAPPING_REGENERATE_OPTION}」可沿用目前目的地與選擇再試一次。`,
    apiEmpty: failure.code === "places_api_empty",
    failure,
  };
}

export async function prepareDirectItinerarySession(params: {
  session: ChatPlanningSession;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
  msgs?: ChatMsg[];
  fetchPlaceDetails?: (placeId: string) => Promise<PlaceResult | null>;
}): Promise<
  | { ok: true; session: ChatPlanningSession }
  | {
      ok: false;
      message: string;
      apiEmpty?: boolean;
      failure?: ItineraryPlaceFailure;
    }
> {
  const {
    session,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds,
    msgs,
    fetchPlaceDetails,
  } = params;

  const generationRequestId =
    context.generationRequestId?.trim() ||
    `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  beginPlacesGenerationSession(generationRequestId);
  beginDestinationTravelProfileSession(generationRequestId);
  clearCombinationPoolMemo();

  const destination =
    context.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim();
  const days = context.days ?? session.tripDays;

  if (!destination || !days) {
    logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", "no destination");
    return {
      ok: false,
      message: "我還需要知道目的地和天數，才能幫你排完整行程。",
    };
  }

  const label = sanitizeDestinationForGeocode(
    normalizeDestinationLabel(destination),
  );
  logItineraryDaysParsed(days);

  const allowlist = resolveGenerationAllowlist(context, label);
  if (allowlist) {
    logAiPipeline(
      "[ITINERARY_ALLOWLIST_LOCKED]",
      `ids=${allowlist.selectedCombinationIds.join(",")}`,
      `selectionSource=${context.selectionSource ?? allowlist.selectionSource ?? "none"}`,
      `places=${allowlist.allowedPlaceNames.join("|")}`,
    );
  }

  const syncedSession = syncSessionPlaceMemory(session);
  const { places: rawSessionPlaces, source } = resolveItineraryPlaceSources(syncedSession, msgs);
  let sessionPlaces = preparePlacesForItineraryBuild(rawSessionPlaces, label);

  // Seed allowlisted names when chat did not persist recommendation cards.
  // Cap is applied again inside mergeSessionPlacesWithFetch.
  if (allowlist?.allowedPlaceNames.length && sessionPlaces.length < 3) {
    const seedCap = computeFirstRoundPlaceMapCap(days);
    const seeded = allowlist.allowedPlaceNames.slice(0, seedCap).map((place) =>
      annotatePlaceWithCombinationMetadata(
        mapPlaceResultToChatItem(
          {
            id: "",
            name: place,
            address: label,
            lat: null,
            lng: null,
            rating: null,
            userRatingCount: null,
            photoName: null,
            primaryType: "tourist_attraction",
            types: ["tourist_attraction"],
            businessStatus: null,
            openStatus: "unknown",
            openStatusLabel: "",
            todayHoursLabel: "",
            closingSoonNote: "",
            nextOpenHint: "",
          },
          { mood: context.mood, weather: context.weather, locale },
        ),
        label,
        allowlist.selectedCombinationIds,
      ),
    );
    sessionPlaces = preparePlacesForItineraryBuild(
      dedupeChatPlaces([...sessionPlaces, ...seeded]),
      label,
    );
  }

  if (allowlist) {
    sessionPlaces = filterPlacesByCombinationAllowlist(sessionPlaces, allowlist);
  }

  logItineraryBuildSource(source, sessionPlaces.length);
  if (source === "recommendedPlaces" || source === "plannedStops" || source === "renderedCards") {
    logItineraryUsedRecommendedPlaces(sessionPlaces.length);
  }

  const merged = await mergeSessionPlacesWithFetch({
    sessionPlaces,
    destination: label,
    days,
    context: {
      ...context,
      generationRequestId,
      ...(allowlist
        ? {
            selectedCombinationIds: allowlist.selectedCombinationIds,
            selectedCombinationPlaceNames: allowlist.allowedPlaceNames,
            excludedCombinationPlaceNames: allowlist.exclusiveExcludedPlaceNames,
            selectionSource:
              context.selectionSource ?? allowlist.selectionSource,
          }
        : {}),
    },
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds,
    fetchPlaceDetails,
    generationRequestId,
  });

  if (!merged.ok) {
    logAiPipeline(
      "[ITINERARY_SAVE_FAILED_REASON]",
      merged.failure?.code ?? (merged.apiEmpty ? "api_empty" : "no places"),
    );
    return {
      ok: false,
      message: merged.message,
      apiEmpty: merged.apiEmpty,
      failure: merged.failure,
    };
  }

  const places = merged.places
    .filter((p) =>
      isResolvedCorePlace({
        ...p,
        id: p.googlePlaceId ?? p.placeId,
        googlePlaceId: p.googlePlaceId ?? p.placeId,
        address: p.address ?? `${p.placeName ?? p.name}, ${label}`,
        destinationMatch: true,
      }),
    )
    .map((p) =>
      allowlist?.selectedCombinationIds.length
        ? annotatePlaceWithCombinationMetadata(
            p,
            label,
            allowlist.selectedCombinationIds,
          )
        : p,
    );
  logAiPipeline(
    "[ITINERARY_PLACES_FETCH]",
    `destination=${label}`,
    `source=${source}`,
    `selected=${places.length}`,
    `generationRequestId=${generationRequestId}`,
  );
  logPlacesApiCallStats("prepare_direct_itinerary");

  if (!places.length) {
    const stats = getPlacesApiCallStats();
    const failure: ItineraryPlaceFailure = {
      code: pickDominantFailureCode(stats, 0, sessionPlaces.length),
      stage: "place_mapping",
      attemptedCandidates: sessionPlaces.length,
      resolvedCandidates: 0,
      retryCount: stats.retryCount,
      generationRequestId,
    };
    logItineraryRootCause(failure);
    logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", failure.code);
    return {
      ok: false,
      message: "目前正在取得景點資訊，請稍後重新生成。",
      apiEmpty: failure.code === "places_api_empty",
      failure,
    };
  }

  logItineraryValidationResult(true, `places=${places.length}`);

  const tripDates = resolveTripCreateDates({
    context: {
      ...(session.travelContext ?? { interests: [] }),
      ...context,
      destination: label,
      days,
    },
    session,
    days,
    userText: msgs?.slice().reverse().find((m) => m.role === "user")?.content,
  });
  const startDate = tripDates.startDate;
  const endDate = tripDates.endDate;

  const tripDestination =
    session.tripDestination?.city === label || session.tripDestination?.displayLabel === label
      ? session.tripDestination
      : {
          placeId: "",
          country: context.destinationCountry ?? "",
          city: label,
          lat: places[0]?.lat ?? 0,
          lng: places[0]?.lng ?? 0,
          formattedName: label,
          displayLabel: label,
        };

  const readySession = syncSessionPlaceMemory({
    ...session,
    phase: "ready",
    selectedPlaces: places,
    plannedStops: places,
    recommendedPlaces: places,
    tripDestination,
    tripDays: days,
    tripStartDate: startDate,
    tripEndDate: endDate,
    pendingQuestion: undefined,
    conversationMode: "destination_planning",
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      ...context,
      destination: label,
      days,
      startDate,
      endDate,
      conversationState: "ready_for_itinerary",
      tripPurpose: "direct_itinerary_generation",
      selectedPlanMode: "full_itinerary",
      generationRequestId,
      ...(allowlist
        ? {
            selectedCombinationIds: allowlist.selectedCombinationIds,
            selectedCombinationPlaceNames: allowlist.allowedPlaceNames,
            excludedCombinationPlaceNames: allowlist.exclusiveExcludedPlaceNames,
            selectionSource:
              context.selectionSource ?? allowlist.selectionSource,
          }
        : {}),
    },
  });

  return { ok: true, session: readySession };
}

export function assertItineraryStopsHavePlaceIds(
  places: PlaceLike[],
  destination?: string,
): boolean {
  if (!places.length) return false;
  return places.every((p) => isValidItineraryStopPlace(p, destination));
}
