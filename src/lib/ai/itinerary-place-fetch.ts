import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { wrapPlannerPlaceSearchViaGateway } from "@/lib/pie/planner-search";
import { isRecEnginePlannerEnabled } from "@/lib/recommendation/engine/feature-flag-planner";
import {
  chatPlaceItemToPlaceResult,
  ingestResolvedPlacesIntoCandidatePool,
} from "@/lib/ai/places-cost-cache";
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
import { filterExcludedPlaceIds, type PlaceLike } from "@/lib/place-planning-memory";
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
import { detectSubPlaceType } from "@/lib/ai/landmark-keywords";
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
  buildMultiCombinationCoverageReport,
  mergeSelectedCombinationCandidates,
  resolveSelectedCombinationPools,
  expandAllowlistNamesFromPools,
  clearCombinationPoolMemo,
  ensureCombinationProvenanceOnPlaces,
  planSelectedCombinationCapacity,
  validateSelectedCombinationIntegrity,
  type MultiCombinationCoverageReport,
} from "@/lib/ai/combination-itinerary-integrity";
import {
  themeSearchQueries,
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import { includedTypesForTheme } from "@/lib/ai/combination-category-contract";
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
import {
  calculateDynamicStopCapacity,
  buildSelectedThemeProfile,
  evaluateTotalRealPlaceValidation,
  SELECTED_COMBINATION_FILLER_POLICY,
  supplementMealsForSelectedCombinationItinerary,
  supplementRealPlacesForItinerary,
} from "@/lib/ai/real-place-supplement";
import {
  combinationIdsFromPlace,
  mergeCombinationProvenance,
  mergePlaceProvenance,
} from "@/lib/ai/combination-provenance";
import {
  classifyCombinationCandidate,
  expandRegionCandidatesForCombination,
  resolveRegionCandidate,
} from "@/lib/ai/region-candidate-expand";
import { placeMatchesNearbyExtension } from "@/lib/ai/planner-day-route-assembly";
import {
  evaluateNearbyExtensionPoolStatus,
  logNearbyExtensionContext,
  logNearbyExtensionPool,
  NEARBY_EXTENSION_MIN_STOPS,
  NEARBY_EXTENSION_SEARCH_TARGET,
} from "@/lib/ai/nearby-extension-requirements";

export { INSUFFICIENT_ITINERARY_PLACES_MESSAGE };

/**
 * nearbyExtensions（如「橫濱」「箱根」）必須有獨立搜尋，不得只存在 Context。
 * Uses region expand centered on the extension city — never primary Tokyo lat/lng alone.
 */
async function fetchNearbyExtensionPlaces(params: {
  extensions: string[];
  primaryDestination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  mood?: string;
  weather?: unknown;
  selectedCombinationIds?: number[];
  tripDays?: number;
}): Promise<{ places: ChatPlaceItem[]; insufficient: string[] }> {
  const extensions = [
    ...new Set(params.extensions.map((e) => normalizeDestinationLabel(e)).filter(Boolean)),
  ];
  if (!extensions.length) return { places: [], insufficient: [] };

  logNearbyExtensionContext({
    primary: params.primaryDestination,
    extensions,
    selectedCombinations: params.selectedCombinationIds,
    tripDays: params.tripDays,
  });

  const collected: ChatPlaceItem[] = [];
  const insufficient: string[] = [];
  for (const ext of extensions) {
    const approx = resolveDestinationApproxCenter(ext);
    const searchLat = approx?.lat ?? params.lat;
    const searchLng = approx?.lng ?? params.lng;
    const result = await resolveRegionCandidate({
      regionName: ext,
      // Nearby day is not a selected combination — keep provenance empty via 0 strip below.
      combinationId: 0,
      destination: ext,
      lat: searchLat,
      lng: searchLng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      geocodeFn: params.geocodeFn,
      mood: params.mood,
      weather: params.weather,
      maxPlaces: NEARBY_EXTENSION_SEARCH_TARGET,
      theme: "attraction",
      title: ext,
    });

    const cleaned = result.places.map((p) => {
      const {
        sourceCombinationId: _sid,
        matchedSelectedCombinationIds: _ms,
        matchedCombinationIds: _mc,
        ...rest
      } = p as ChatPlaceItem & {
        sourceCombinationId?: number;
        matchedSelectedCombinationIds?: number[];
        matchedCombinationIds?: number[];
      };
      return {
        ...rest,
        destinationScope: "nearby_extension",
        extensionDestination: ext,
      } as ChatPlaceItem;
    });

    const matched = cleaned.filter((p) =>
      placeMatchesNearbyExtension(
        {
          id: p.googlePlaceId ?? "",
          name: p.placeName ?? p.name,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          rating: p.rating,
          userRatingCount: p.userRatingCount,
          photoName: p.photoName,
          primaryType: p.type,
          types: p.types ?? (p.type ? [p.type] : []),
          businessStatus: null,
          openStatus: "unknown",
          openStatusLabel: "",
          todayHoursLabel: "",
          closingSoonNote: "",
          nextOpenHint: "",
          destinationScope: "nearby_extension",
          extensionDestination: ext,
        },
        [ext],
      ),
    );

    const poolStatus = evaluateNearbyExtensionPoolStatus({
      extension: ext,
      candidateCount: matched.length,
      requiredStops: NEARBY_EXTENSION_MIN_STOPS,
    });
    logNearbyExtensionPool(poolStatus);

    logAiPipeline(
      "[NEARBY_EXTENSION_SEARCH]",
      `extension=${ext}`,
      `primaryDestination=${params.primaryDestination}`,
      `queryCount=4`,
      `rawCount=${result.places.length}`,
      `acceptedCount=${matched.length}`,
      `canonicalCount=${matched.length}`,
      `searchLat=${searchLat}`,
      `searchLng=${searchLng}`,
      `failed=${matched.length === 0}`,
      `names=[${matched.map((p) => p.placeName ?? p.name).join("|")}]`,
    );

    if (!poolStatus.enough) {
      insufficient.push(ext);
      logAiPipeline(
        "[NEARBY_EXTENSION_EMPTY]",
        `extension=${ext}`,
        `availableStops=${matched.length}`,
        `requiredStops=${NEARBY_EXTENSION_MIN_STOPS}`,
        "replanReasons=nearby_extension_insufficient",
      );
    }

    collected.push(...matched);
  }

  return { places: dedupeChatPlaces(collected), insufficient };
}

export type ItineraryPlaceFailureCode =
  | "places_rate_limited"
  | "places_auth_error"
  | "places_invalid_request"
  | "place_details_failed"
  | "insufficient_resolved_places"
  | "insufficient_real_places"
  | "places_api_empty"
  | "no_candidate_places"
  | "combination_uncovered"
  | "combination_coverage_insufficient"
  | "total_real_place_count_insufficient"
  | "total_place_count_insufficient"
  | "region_expansion_failed"
  | "selected_place_resolution_failed"
  | "place_resolution_failed"
  | "final_allocation_insufficient";

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

export const COMBINATION_MAPPING_FAILED_MESSAGE = "部分已選組合目前無法取得足夠的真實地點。";

export const SINGLE_COMBINATION_MAPPING_FAILED_MESSAGE =
  "目前這個主題找到的可用真實地點不足，請改選其他組合或點「重新生成」再試一次。";

export const COMPACT_ITINERARY_NOTICE_MESSAGE = "目前找到的可用地點較少，我先幫你安排精簡版行程。";

export const COMBINATION_MAPPING_REGENERATE_OPTION = "重新生成";

export function combinationMappingFailureMessage(params: {
  code?: ItineraryPlaceFailureCode;
  selectedCombinationCount?: number;
}): string {
  const count = params.selectedCombinationCount ?? 0;
  if (
    params.code === "total_real_place_count_insufficient" ||
    params.code === "insufficient_real_places"
  ) {
    if (count <= 1) return SINGLE_COMBINATION_MAPPING_FAILED_MESSAGE;
    return COMBINATION_MAPPING_FAILED_MESSAGE;
  }
  if (params.code === "combination_uncovered" && count <= 1) {
    return SINGLE_COMBINATION_MAPPING_FAILED_MESSAGE;
  }
  return COMBINATION_MAPPING_FAILED_MESSAGE;
}

const PLACE_FAILURE_PRIORITY: ItineraryPlaceFailureCode[] = [
  "places_rate_limited",
  "places_auth_error",
  "places_invalid_request",
  "place_details_failed",
  "region_expansion_failed",
  "combination_uncovered",
  "combination_coverage_insufficient",
  "place_resolution_failed",
  "selected_place_resolution_failed",
  "total_real_place_count_insufficient",
  "total_place_count_insufficient",
  "final_allocation_insufficient",
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
  logAiPipeline("[ITINERARY_FAILURE_ROOT_CAUSE]", JSON.stringify(failure));
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

/** @deprecated Flag ON（P2.3）不再呼叫；僅 Flag OFF legacy。 */
function rankByQuality(places: PlaceResult[]): PlaceResult[] {
  return [...places].sort((a, b) => {
    const score = (p: PlaceResult) =>
      (p.rating ?? 0) * Math.log10((p.userRatingCount ?? 0) + 10) + (p.photoName ? 0.5 : 0);
    return score(b) - score(a);
  });
}

/**
 * 取用候選：Flag ON 保留輸入順序（Filter/slice，不重排）；
 * Flag OFF 仍用 rankByQuality。
 */
function selectPlacesForItinerary(places: PlaceResult[], limit: number): PlaceResult[] {
  if (isRecEnginePlannerEnabled()) {
    return places.slice(0, Math.max(0, limit));
  }
  return rankByQuality(places).slice(0, Math.max(0, limit));
}

function dedupeChatPlaces(places: ChatPlaceItem[]): ChatPlaceItem[] {
  const byKey = new Map<string, ChatPlaceItem>();
  for (const p of places) {
    const key =
      p.placeId?.trim() ||
      p.googlePlaceId?.trim() ||
      `${(p.name ?? p.placeName ?? "").replace(/\s+/g, "").toLowerCase()}@${p.address ?? ""}`;
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
      continue;
    }
    byKey.set(
      key,
      mergePlaceProvenance(existing, p, {
        representativeName: existing.placeName ?? existing.name,
        otherName: p.placeName ?? p.name,
      }),
    );
  }
  return [...byKey.values()];
}

type StructuredCombinationSeedCandidate = {
  name: string;
  originalName?: string;
  localizedDisplayName?: string;
  googlePlaceId?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  types?: string[];
  primaryType?: string | null;
  rating?: number | null;
};

export type CombinationGenerationSeedPlan = {
  resolvedSeeds: ChatPlaceItem[];
  resolvedByName: Map<string, ChatPlaceItem>;
  offeredResolvedSeedCount: number;
  poolResolvedSeedCount: number;
  dedupedResolvedSeedCount: number;
};

function combinationSeedNameKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

/**
 * Build immutable, resolved generation seeds from structured combination metadata.
 * Offered session metadata wins over refreshed pool metadata; invalid/name-only rows
 * are deliberately omitted so the existing name-resolution path can handle them.
 */
export function buildCombinationGenerationSeedPlan(params: {
  context: CanonicalTravelContext;
  destination: string;
  selectedCombinationIds: number[];
  pools: ReturnType<typeof resolveSelectedCombinationPools>;
  center: { lat: number; lng: number };
  locale: Locale;
}): CombinationGenerationSeedPlan {
  const selectedIds = new Set(params.selectedCombinationIds);
  const byId = new Map<string, ChatPlaceItem>();
  const resolvedByName = new Map<string, ChatPlaceItem>();
  let offeredResolvedSeedCount = 0;
  let poolResolvedSeedCount = 0;

  const addCandidate = (
    candidate: StructuredCombinationSeedCandidate,
    combinationId: number,
    combination: { title?: string; theme?: string },
    source: "offered" | "pool",
  ): void => {
    if (!selectedIds.has(combinationId)) return;
    const id = candidate.googlePlaceId?.trim() ?? "";
    const name = candidate.localizedDisplayName?.trim() || candidate.name.trim();
    const lat = candidate.latitude;
    const lng = candidate.longitude;
    if (!isMappableGooglePlaceId(id) || lat == null || lng == null) return;
    if (!candidate.address?.trim() || detectSubPlaceType(name)) return;

    const quality = validateCandidateIntent(
      {
        name,
        types: candidate.types,
        primaryType: candidate.primaryType,
        address: candidate.address,
        lat,
        lng,
        rating: candidate.rating,
        googlePlaceId: id,
      },
      combination,
      params.destination,
      {
        center: params.center,
        source: `combination_${source}_resolved_seed`,
      },
    );
    if (!quality.ok) return;

    const place: PlaceResult = {
      id,
      name,
      originalName: candidate.originalName?.trim() || candidate.name.trim(),
      localizedDisplayName: name,
      address: candidate.address,
      lat,
      lng,
      rating: candidate.rating ?? null,
      userRatingCount: null,
      photoName: null,
      primaryType: candidate.primaryType ?? null,
      types: candidate.types ?? null,
      businessStatus: null,
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
    };
    if (!isResolvedCorePlace({ ...place, googlePlaceId: id, destinationMatch: true })) {
      return;
    }

    const item = mergeCombinationProvenance(
      mapPlaceResultToChatItem(place, {
        mood: params.context.mood,
        weather: params.context.weather,
        locale: params.locale,
      }),
      [combinationId],
    );
    const existing = byId.get(id);
    const representative = existing
      ? mergePlaceProvenance(existing, item, {
          representativeName: existing.placeName ?? existing.name,
          otherName: item.placeName ?? item.name,
        })
      : item;
    byId.set(id, representative);

    for (const alias of [candidate.name, candidate.originalName, candidate.localizedDisplayName]) {
      if (!alias?.trim()) continue;
      resolvedByName.set(combinationSeedNameKey(alias), representative);
    }
    if (!existing) {
      if (source === "offered") offeredResolvedSeedCount += 1;
      else poolResolvedSeedCount += 1;
    }
  };

  for (const combination of params.context.offeredCombinations ?? []) {
    if (!selectedIds.has(combination.id)) continue;
    for (const place of combination.places) {
      addCandidate(place, combination.id, combination, "offered");
    }
  }

  for (const pool of params.pools) {
    for (const candidate of pool.all) {
      addCandidate(
        {
          name: candidate.name,
          originalName: candidate.originalName,
          localizedDisplayName: candidate.localizedDisplayName,
          googlePlaceId: candidate.googlePlaceId,
          latitude: candidate.coordinates?.lat,
          longitude: candidate.coordinates?.lng,
          address: candidate.address,
          types: candidate.types,
          primaryType: candidate.primaryType,
          rating: candidate.rating,
        },
        pool.combinationId,
        pool,
        "pool",
      );
    }
  }

  // Repoint every alias at the final provenance-merged representative.
  for (const [name, item] of resolvedByName) {
    const id = item.googlePlaceId ?? item.placeId ?? "";
    const merged = byId.get(id);
    if (merged) resolvedByName.set(name, merged);
  }

  return {
    resolvedSeeds: [...byId.values()],
    resolvedByName,
    offeredResolvedSeedCount,
    poolResolvedSeedCount,
    dedupedResolvedSeedCount: byId.size,
  };
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
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds = [],
  } = params;
  // P3：候選搜尋經 PIE Gateway（Flag OFF = legacy 注入函式）
  const searchPlaces = wrapPlannerPlaceSearchViaGateway(params.searchPlaces);

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
    {
      query: `${label} 景點`,
      mode: "nearby",
      includedTypes: ["tourist_attraction", "museum", "park"],
    },
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
  const ranked = selectPlacesForItinerary(valid, Math.max(fetchTarget, days + 2));

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
        ? context.selectedTripStyle
            .split("、")
            .map((s) => s.trim())
            .filter(Boolean)
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
  sessionId?: string | null;
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
    ? resolveSelectedCombinationPools(params.destination, allowlist.selectedCombinationIds, {
        forceRefresh: true,
      })
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

  const structuredSeedPlan = effectiveAllowlist
    ? buildCombinationGenerationSeedPlan({
        context: params.context,
        destination: params.destination,
        selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
        pools: comboPools,
        center: { lat, lng },
        locale: params.locale,
      })
    : {
        resolvedSeeds: [],
        resolvedByName: new Map<string, ChatPlaceItem>(),
        offeredResolvedSeedCount: 0,
        poolResolvedSeedCount: 0,
        dedupedResolvedSeedCount: 0,
      };

  const comboNamesRaw = effectiveAllowlist?.allowedPlaceNames?.length
    ? (() => {
        const merged = mergeSelectedCombinationCandidates(
          params.destination,
          effectiveAllowlist.selectedCombinationIds,
        );
        return merged.places.length ? merged.places : effectiveAllowlist.allowedPlaceNames;
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
  // Resolved structured metadata is the authoritative seed source.
  for (const p of structuredSeedPlan.resolvedSeeds) {
    const n = (p.placeName ?? p.name ?? "").trim();
    if (!n) continue;
    const key = combinationSeedNameKey(n);
    if (seenName.has(key)) continue;
    seenName.add(key);
    prioritizeNames.push(n);
  }
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

  const firstRoundCap = Math.max(
    computeFirstRoundPlaceMapCap(params.days),
    // Selected combinations: never cap below the full primary named pool.
    comboPools.reduce((n, p) => n + p.primary.length, 0),
    allowlist ? prioritizeNames.length : 0,
  );
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
  logAiPipeline(
    "[SELECTED_PLACE_POOL_BUILT]",
    `count=${prioritizeNames.length}`,
    `places=[${prioritizeNames.join(",")}]`,
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
    const annotated = annotatePlaceWithCombinationMetadata(item, params.destination, ids);
    if (forceComboId != null) {
      return mergeCombinationProvenance(annotated, [forceComboId]);
    }
    return annotated;
  };

  const seedFromName = (place: string): ChatPlaceItem => {
    const structured = structuredSeedPlan.resolvedByName.get(combinationSeedNameKey(place));
    if (structured) return structured;
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

  const isReusableExistingSeed = (place: ChatPlaceItem): boolean => {
    const id = place.googlePlaceId ?? place.placeId;
    return (
      isMappableGooglePlaceId(id) &&
      isResolvedCorePlace({
        id,
        googlePlaceId: id,
        name: place.placeName ?? place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        destinationMatch: true,
      })
    );
  };
  const textSearchCandidateCount = firstRoundNames.filter(
    (name) =>
      !structuredSeedPlan.resolvedByName.has(combinationSeedNameKey(name)) &&
      !priorResolved.some(
        (p) =>
          isReusableExistingSeed(p) &&
          combinationSeedNameKey(p.placeName ?? p.name ?? "") === combinationSeedNameKey(name),
      ) &&
      !scopedSessionPlaces.some(
        (p) =>
          isReusableExistingSeed(p) &&
          combinationSeedNameKey(p.placeName ?? p.name ?? "") === combinationSeedNameKey(name),
      ),
  ).length;
  logAiPipeline(
    "[COMBINATION_GENERATION_SEEDS]",
    `offeredResolvedSeedCount=${structuredSeedPlan.offeredResolvedSeedCount}`,
    `poolResolvedSeedCount=${structuredSeedPlan.poolResolvedSeedCount}`,
    `nameOnlyCandidateCount=${textSearchCandidateCount}`,
    `textSearchCandidateCount=${textSearchCandidateCount}`,
    `dedupedResolvedSeedCount=${structuredSeedPlan.dedupedResolvedSeedCount}`,
  );

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
    sessionId: params.sessionId,
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
        if (effectiveAllowlist && !isPlaceNameInCombinationAllowlist(name, effectiveAllowlist)) {
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
          sessionId: params.sessionId,
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
      ? fetchResult.places.filter((p) => isMappableGooglePlaceId(p.googlePlaceId ?? p.placeId))
      : [];
  }

  const allowOrComboAnnotated = (p: ChatPlaceItem): boolean => {
    if (!effectiveAllowlist) return true;
    if (isPlaceNameInCombinationAllowlist(p.placeName ?? p.name ?? "", effectiveAllowlist)) {
      return true;
    }
    // Theme-search / promoted fallback places carry combination provenance.
    const matched = combinationIdsFromPlace(p);
    return matched.some((id) => effectiveAllowlist.selectedCombinationIds.includes(id));
  };

  let merged = dedupeChatPlaces([
    ...priorResolved.map((p) => withComboMeta(p)),
    ...mappedSession.map((p) => withComboMeta(p)),
    ...mappedCombo,
    ...fetched.map((p) => withComboMeta(p)),
  ]).filter((p) => {
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
      if (combinationIdsFromPlace(p).includes(comboId)) return true;
      return annotatePlaceWithCombinationMetadata(
        p,
        params.destination,
        effectiveAllowlist?.selectedCombinationIds ?? [comboId],
      ).matchedSelectedCombinationIds?.includes(comboId);
    }).length;

  const mapCandidateName = async (name: string, comboId: number): Promise<ChatPlaceItem | null> => {
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
      sessionId: params.sessionId,
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

  // Per-combination: capacity plan → primary/fallback map → coverage → region/supplement.
  if (effectiveAllowlist?.selectedCombinationIds.length) {
    const capacityPlan = planSelectedCombinationCapacity({
      tripDays: params.days,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
    });
    const minPerCombo = capacityPlan.minimumRepresentativePerCombination;

    merged = ensureCombinationProvenanceOnPlaces(
      merged,
      params.destination,
      effectiveAllowlist.selectedCombinationIds,
    );

    for (const pool of comboPools) {
      mappingMeta[pool.combinationId] = {
        fallbackCandidatesUsed: 0,
        searchRequests: 0,
        searchRetries: 0,
        primaryCandidates: pool.primary.length,
      };
      const softTarget = Math.max(
        capacityPlan.targetPerCombination[pool.combinationId] ?? minPerCombo,
        Math.ceil(fetchTarget / Math.max(comboPools.length, 1)),
      );
      let resolved = countResolvedForCombo(pool.combinationId);

      // Map unused primary candidates until soft capacity target (never a hard fail gate).
      if (resolved < softTarget) {
        const needed = softTarget - resolved;
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

      // Fallback candidates — stop once soft target met.
      if (resolved < softTarget && pool.fallback.length) {
        logAiPipeline(
          "[COMBINATION_PLACE_MAPPING_RETRY]",
          `combinationId=${pool.combinationId}`,
          `phase=fallback`,
          `need=${softTarget - resolved}`,
          `fallback=${pool.fallback.map((f) => f.name).join("|")}`,
        );
        searchRetryCount += 1;
        for (const c of pool.fallback) {
          if (resolved >= softTarget) break;
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

      // Theme Places soft refill when already has ≥1 named place but under soft target.
      if (resolved < softTarget && resolved > 0) {
        const queries = themeSearchQueries(pool.theme, params.destination);
        logAiPipeline(
          "[COMBINATION_PLACE_MAPPING_RETRY]",
          `combinationId=${pool.combinationId}`,
          `phase=theme_search_supplement`,
          `queries=${queries.slice(0, 4).join("|")}`,
          `reason=named_quota_underfilled`,
        );
        searchRetryCount += 1;
        candidateRegenerationCount += 1;
        for (const query of queries) {
          if (resolved >= softTarget) break;
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
                includedTypes: includedTypesForTheme(pool.theme),
              },
            });
            for (const place of result.places ?? []) {
              if (resolved >= softTarget) break;
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
              if (merged.some((p) => (p.googlePlaceId ?? p.placeId) === place.id)) {
                continue;
              }
              if (detectSubPlaceType(place.name ?? "")) {
                logAiPipeline(
                  "[THEME_REFILL_SKIPPED_SUBPLACE]",
                  `name=${place.name}`,
                  `combinationId=${pool.combinationId}`,
                );
                continue;
              }
              fallbackCandidateCount += 1;
              attemptedCandidates += 1;
              const item = withComboMeta(
                mapPlaceResultToChatItem(place, {
                  mood: params.context.mood,
                  weather: params.context.weather,
                  locale: params.locale,
                }),
                pool.combinationId,
              );
              logAiPipeline(
                "[FALLBACK_PLACE_ADDED]",
                `name=${place.name}`,
                `combinationId=${pool.combinationId}`,
                `reason=theme_search_supplement`,
                `source=places_theme_query`,
              );
              merged.push(item);
              merged = dedupeChatPlaces(merged);
              resolved = countResolvedForCombo(pool.combinationId);
            }
          } catch (e) {
            console.warn("[combination_theme_refill] search failed", e);
          }
        }
      }
    }

    merged = ensureCombinationProvenanceOnPlaces(
      dedupeChatPlaces(merged),
      params.destination,
      effectiveAllowlist.selectedCombinationIds,
    );

    let mappingStats = buildCombinationPlaceMappingStats({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      mappingMeta,
    });

    const regionExpansion: Record<
      number,
      {
        regions: string[];
        expandedPlaces: number;
        selectedRegion?: string;
        failedRegions?: string[];
      }
    > = {};
    let supplementAttempted = false;
    const addedByCombination: Record<number, number> = {};

    const coverageBefore = buildMultiCombinationCoverageReport({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      regionExpansion,
      supplementAttempted: false,
      tripDays: params.days,
      capacityPlan,
    });
    logAiPipeline(
      "[COMBINATION_COVERAGE_BEFORE_SUPPLEMENT]",
      `report=${JSON.stringify(coverageBefore)}`,
    );

    // Region expand for uncovered combos whose candidates are regions/districts.
    for (const comboId of coverageBefore.uncoveredIds) {
      const pool = comboPools.find((p) => p.combinationId === comboId);
      if (!pool) continue;

      const regionNames = pool.all
        .map((c) => c.name)
        .filter(
          (name) =>
            classifyCombinationCandidate(name, params.destination, {
              types: pool.all.find((c) => c.name === name)?.types,
              primaryType: pool.all.find((c) => c.name === name)?.primaryType,
            }) === "city_or_region",
        );

      if (!regionNames.length) continue;

      const expanded = await expandRegionCandidatesForCombination({
        combinationId: pool.combinationId,
        regionNames,
        destination: params.destination,
        lat,
        lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        geocodeFn: params.geocodeFn,
        generationRequestId: params.generationRequestId,
        theme: pool.theme,
        title: pool.title,
        mood: params.context.mood,
        weather: params.context.weather,
      });
      regionExpansion[pool.combinationId] = {
        regions: expanded.regions,
        expandedPlaces: expanded.expandedPlaces.length,
        selectedRegion: expanded.expandedPlaces[0]
          ? (expanded.expandedPlaces[0] as ChatPlaceItem & { sourceRegionCandidate?: string })
              .sourceRegionCandidate
          : expanded.regions[0],
        failedRegions: expanded.failedRegions,
      };
      if (expanded.expandedPlaces.length) {
        for (const item of expanded.expandedPlaces) {
          merged.push(mergeCombinationProvenance(item, [pool.combinationId]));
        }
        merged = dedupeChatPlaces(merged);
        fallbackCandidateCount += expanded.expandedPlaces.length;
        candidateRegenerationCount += 1;
        addedByCombination[pool.combinationId] =
          (addedByCombination[pool.combinationId] ?? 0) + expanded.expandedPlaces.length;
      }
    }

    merged = ensureCombinationProvenanceOnPlaces(
      merged,
      params.destination,
      effectiveAllowlist.selectedCombinationIds,
    );

    const coverageAfterRegion = buildMultiCombinationCoverageReport({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      regionExpansion,
      supplementAttempted: false,
      tripDays: params.days,
      capacityPlan,
    });

    const stillUncovered = coverageAfterRegion.uncoveredIds;
    if (stillUncovered.length) {
      logAiPipeline(
        "[COMBINATION_SUPPLEMENT_STARTED]",
        `uncoveredIds=[${stillUncovered.join(",")}]`,
      );
    }

    // Real-place theme supplement for still-uncovered combos (must run before fail).
    for (const comboId of stillUncovered) {
      const pool = comboPools.find((p) => p.combinationId === comboId);
      if (!pool) continue;
      if (regionExpansion[pool.combinationId]?.expandedPlaces) continue;

      const needed = 1;
      logAiPipeline(
        "[COMBINATION_REAL_PLACE_SUPPLEMENT_STARTED]",
        `combinationId=${pool.combinationId}`,
        `needed=${needed}`,
        `theme=${pool.theme}`,
      );
      supplementAttempted = true;
      candidateRegenerationCount += 1;
      searchRetryCount += 1;

      const queries = themeSearchQueries(pool.theme, params.destination).slice(0, 2);
      let added = 0;
      let failed = 0;
      for (const query of queries) {
        if (added >= needed) break;
        try {
          const result = await params.searchPlaces({
            data: {
              query,
              lat,
              lng,
              radius: 30_000,
              mode: "text",
              placesScreen: "chat",
              placesCaller: "combination_real_place_supplement",
              destinationName: params.destination,
              searchMode: "destination",
              includedTypes: includedTypesForTheme(pool.theme),
            },
          });
          for (const place of result.places ?? []) {
            if (added >= needed) break;
            if (!isMappableGooglePlaceId(place.id)) continue;
            if (!isResolvedCorePlace({ ...place, destinationMatch: true })) continue;
            if (detectSubPlaceType(place.name ?? "")) continue;
            if (merged.some((p) => (p.googlePlaceId ?? p.placeId) === place.id)) continue;
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
              failed += 1;
              continue;
            }
            const item = withComboMeta(
              mapPlaceResultToChatItem(place, {
                mood: params.context.mood,
                weather: params.context.weather,
                locale: params.locale,
              }),
              pool.combinationId,
            );
            merged.push(item);
            added += 1;
            fallbackCandidateCount += 1;
          }
        } catch {
          failed += 1;
        }
      }
      merged = dedupeChatPlaces(merged);
      addedByCombination[pool.combinationId] =
        (addedByCombination[pool.combinationId] ?? 0) + added;
      logAiPipeline(
        "[COMBINATION_REAL_PLACE_SUPPLEMENT_RESULT]",
        `combinationId=${pool.combinationId}`,
        `added=${added}`,
        `failed=${failed}`,
      );
      logAiPipeline(
        "[COMBINATION_SUPPLEMENT_COMPLETED]",
        `combinationId=${pool.combinationId}`,
        `added=${added}`,
      );
    }

    // If any combo was uncovered before this stage, mark supplement attempted
    // even when region expand alone covered them — regenerate must not re-query blindly.
    if (coverageBefore.uncoveredIds.length) {
      supplementAttempted = true;
    }

    if (stillUncovered.length || Object.keys(addedByCombination).length) {
      logAiPipeline(
        "[COMBINATION_SUPPLEMENT_COMPLETED]",
        `addedByCombination=${JSON.stringify(addedByCombination)}`,
      );
    }

    merged = ensureCombinationProvenanceOnPlaces(
      dedupeChatPlaces(merged),
      params.destination,
      effectiveAllowlist.selectedCombinationIds,
    );

    // Capacity-based same-theme supplement MUST run before total-count validation.
    const themeProfile = buildSelectedThemeProfile({
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      pools: comboPools,
    });
    const mode = effectiveAllowlist.selectedCombinationIds.length <= 1 ? "single" : "multiple";
    logAiPipeline(
      "[SELECTED_COMBINATION_MODE]",
      `mode=${mode}`,
      `selectedIds=[${effectiveAllowlist.selectedCombinationIds.join(",")}]`,
    );
    if (mode === "single") {
      logAiPipeline(
        "[SINGLE_COMBINATION_MODE]",
        `selectedCombinationId=${effectiveAllowlist.selectedCombinationIds[0]}`,
        `tripDays=${params.days}`,
      );
    }

    logAiPipeline(
      "[REAL_PLACE_COUNT_BEFORE_SUPPLEMENT]",
      `count=${merged.length}`,
      `uniqueMajorLandmarks=${merged.length}`,
    );

    const preferredStops = Math.max(capacityPlan.preferredStops, fetchTarget);
    if (
      merged.length < preferredStops &&
      SELECTED_COMBINATION_FILLER_POLICY.allowResolvedRealPlaceSupplement
    ) {
      supplementAttempted = true;
      const capacitySupplement = await supplementRealPlacesForItinerary({
        destination: params.destination,
        tripDays: params.days,
        existingPlaces: merged,
        selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
        themes: themeProfile.primaryThemes,
        themeProfile,
        lat,
        lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        needed: preferredStops - merged.length,
        mood: params.context.mood,
        weather: params.context.weather,
        uniqueMajorLandmarksBefore: merged.length,
      });
      if (capacitySupplement.added.length) {
        merged = dedupeChatPlaces([...merged, ...capacitySupplement.added]);
        fallbackCandidateCount += capacitySupplement.added.length;
      }
      logAiPipeline("[REAL_PLACE_COUNT_AFTER_SUPPLEMENT]", `count=${merged.length}`);
    } else {
      logAiPipeline("[REAL_PLACE_COUNT_AFTER_SUPPLEMENT]", `count=${merged.length}`);
    }

    merged = ensureCombinationProvenanceOnPlaces(
      dedupeChatPlaces(merged),
      params.destination,
      effectiveAllowlist.selectedCombinationIds,
    );

    const coverageAfter = buildMultiCombinationCoverageReport({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      regionExpansion,
      supplementAttempted,
      tripDays: params.days,
      capacityPlan,
    });
    logAiPipeline(
      "[COMBINATION_COVERAGE_AFTER_SUPPLEMENT]",
      `report=${JSON.stringify(coverageAfter)}`,
    );

    mappingStats = buildCombinationPlaceMappingStats({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      mappingMeta,
    });
    void mappingStats;

    const placeValidation = evaluateTotalRealPlaceValidation(
      merged.length,
      capacityPlan.dynamicCapacity,
    );

    const integrity = validateSelectedCombinationIntegrity({
      destination: params.destination,
      selectedCombinationIds: effectiveAllowlist.selectedCombinationIds,
      resolvedPlaces: merged,
      regionExpansion,
      supplementAttempted,
      tripDays: params.days,
      capacityPlan,
    });

    if (!integrity.ok) {
      const uncovered = integrity.coverage.uncoveredIds;
      logAiPipeline(
        "[COMBINATION_PLACE_MAPPING_INCOMPLETE]",
        `uncovered=${uncovered.join(",") || "none"}`,
        `reasons=${integrity.reasons.join("|")}`,
        `resolvedTotal=${merged.length}`,
        `minTotal=${capacityPlan.minimumViableStops}`,
        `preferred=${capacityPlan.preferredStops}`,
        `validation=${placeValidation.result}`,
        `supplementAttempted=${supplementAttempted}`,
      );
      const apiStats = getPlacesApiCallStats();
      const mappedCode =
        integrity.failureCode === "supplement_required"
          ? "combination_uncovered"
          : integrity.failureCode === "total_real_place_count_insufficient"
            ? "total_real_place_count_insufficient"
            : integrity.failureCode === "place_resolution_failed"
              ? "place_resolution_failed"
              : integrity.failureCode === "combination_uncovered"
                ? "combination_uncovered"
                : ((integrity.failureCode as ItineraryPlaceFailureCode | undefined) ??
                  "combination_uncovered");
      const failure: ItineraryPlaceFailure = {
        code: mappedCode,
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
        message: combinationMappingFailureMessage({
          code: mappedCode,
          selectedCombinationCount: effectiveAllowlist.selectedCombinationIds.length,
        }),
        apiEmpty: false,
        failure,
      };
    }

    // Soft: under soft capacity target is OK when every combo has a representative.
    const underQuota = mappingStats.filter((s) => {
      const target = capacityPlan.targetPerCombination[s.combinationId] ?? minPerCombo;
      return s.resolvedCount < target;
    });
    if (underQuota.length) {
      logAiPipeline(
        "[COMBINATION_PLACE_MAPPING_SOFT_PASS]",
        `underQuota=${underQuota.map((s) => `${s.combinationId}:${s.resolvedCount}`).join(",")}`,
        `resolvedTotal=${merged.length}`,
        `coverage=ok`,
      );
    }

    void (integrity.coverage as MultiCombinationCoverageReport);
  }

  // nearbyExtensions（橫濱／箱根等）獨立搜尋 — 不得只存在 Context／assembly
  const nearbyExtensions = (params.context.nearbyExtensions ?? [])
    .map((e) => normalizeDestinationLabel(e))
    .filter(Boolean);
  if (nearbyExtensions.length) {
    const nearbyResult = await fetchNearbyExtensionPlaces({
      extensions: nearbyExtensions,
      primaryDestination: params.destination,
      lat,
      lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      geocodeFn: params.geocodeFn,
      mood: params.context.mood,
      weather: params.context.weather,
      selectedCombinationIds: params.context.selectedCombinationIds,
      tripDays: params.days,
    });
    if (nearbyResult.places.length) {
      merged = dedupeChatPlaces([...merged, ...nearbyResult.places]);
      fallbackCandidateCount += nearbyResult.places.length;
    }
    if (nearbyResult.insufficient.length) {
      // Keep unresolved so UI / advice can surface — never silently drop the requirement.
      params.context.unresolvedNearbyExtensions = [
        ...new Set([
          ...(params.context.unresolvedNearbyExtensions ?? []),
          ...nearbyResult.insufficient,
        ]),
      ];
    } else if (params.context.unresolvedNearbyExtensions?.length) {
      params.context.unresolvedNearbyExtensions = params.context.unresolvedNearbyExtensions.filter(
        (e) => !nearbyExtensions.includes(normalizeDestinationLabel(e)),
      );
    }
    logAiPipeline(
      "[NEARBY_EXTENSION_MERGE]",
      `extensions=[${nearbyExtensions.join(",")}]`,
      `added=${nearbyResult.places.length}`,
      `insufficient=[${nearbyResult.insufficient.join(",")}]`,
      `merged=${merged.length}`,
      `fetchTarget=${fetchTarget}`,
    );
  }

  // 保留足夠 unique 候選供每日最低容量（不得截成 ≈ days 筆導致單點日）
  merged = merged.slice(
    0,
    Math.max(fetchTarget, mappedSession.length || 1, params.days * 4, params.days * 3),
  );

  // Never truncate away places that represent a selected combination after coverage passed.
  if (effectiveAllowlist?.selectedCombinationIds.length) {
    const keptKeys = new Set(
      merged.map(
        (p) =>
          p.googlePlaceId?.trim() || `${(p.placeName ?? p.name).replace(/\s+/g, "").toLowerCase()}`,
      ),
    );
    for (const place of [...mappedSession, ...mappedCombo]) {
      const key =
        place.googlePlaceId?.trim() ||
        `${(place.placeName ?? place.name).replace(/\s+/g, "").toLowerCase()}`;
      if (!key || keptKeys.has(key)) continue;
      const ids = combinationIdsFromPlace(place);
      if (ids.some((id) => effectiveAllowlist.selectedCombinationIds.includes(id))) {
        merged.push(place);
        keptKeys.add(key);
      }
    }
  }

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

  const selectedCount = effectiveAllowlist?.selectedCombinationIds.length ?? 0;
  const dynamicCapacity = calculateDynamicStopCapacity({
    tripDays: params.days,
    selectedCombinationCount: Math.max(selectedCount, 1),
  });
  const minPlaces = dynamicCapacity.minimumViableStops;

  // Non-allowlist path: capacity supplement still runs here.
  // Allowlist path already supplemented before integrity validation.
  if (
    !effectiveAllowlist?.selectedCombinationIds.length &&
    merged.length > 0 &&
    merged.length < dynamicCapacity.preferredStops &&
    SELECTED_COMBINATION_FILLER_POLICY.allowResolvedRealPlaceSupplement
  ) {
    logAiPipeline(
      "[INSUFFICIENT_REAL_PLACES_DETECTED]",
      `tripDays=${params.days}`,
      `resolvedPlaces=${merged.length}`,
      `minimumRequired=${minPlaces}`,
      `preferred=${dynamicCapacity.preferredStops}`,
    );
    const supplement = await supplementRealPlacesForItinerary({
      destination: params.destination,
      tripDays: params.days,
      existingPlaces: merged,
      selectedCombinationIds: effectiveAllowlist?.selectedCombinationIds,
      themes: comboPools.map((p) => p.theme).filter(Boolean),
      lat,
      lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      mood: params.context.mood,
      weather: params.context.weather,
    });
    if (supplement.added.length) {
      merged = dedupeChatPlaces([...merged, ...supplement.added]);
      fallbackCandidateCount += supplement.added.length;
    }
    logAiPipeline(
      "[REAL_PLACE_SUPPLEMENT_STATS]",
      `needed=${supplement.needed}`,
      `resolved=${supplement.added.length}`,
      `failed=${supplement.failed}`,
      `afterMerge=${merged.length}`,
    );
  }

  const finalValidation = evaluateTotalRealPlaceValidation(merged.length, dynamicCapacity);

  if (merged.length > 0 && finalValidation.result === "fail") {
    logAiPipeline(
      "[INSUFFICIENT_REAL_PLACES_DETECTED]",
      `tripDays=${params.days}`,
      `resolvedPlaces=${merged.length}`,
      `minimumRequired=${minPlaces}`,
      `preferred=${dynamicCapacity.preferredStops}`,
      "stage=after_supplement",
    );
    const failure: ItineraryPlaceFailure = {
      code: "insufficient_real_places",
      stage: "real_place_supplement",
      attemptedCandidates,
      resolvedCandidates: merged.length,
      retryCount: stats.retryCount,
      searchRetryCount,
      candidateRegenerationCount,
      fallbackCandidateCount,
      generationRequestId: params.generationRequestId,
      partialResolvedPlaces: merged,
    };
    logItineraryRootCause(failure);
    return {
      ok: false,
      message: combinationMappingFailureMessage({
        code: "insufficient_real_places",
        selectedCombinationCount: selectedCount,
      }),
      apiEmpty: false,
      failure,
    };
  }

  if (merged.length > 0 && effectiveAllowlist?.selectedCombinationIds.length) {
    const mealPlaces = await supplementMealsForSelectedCombinationItinerary({
      destination: params.destination,
      tripDays: params.days,
      existingPlaces: merged,
      lat,
      lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      mood: params.context.mood,
      weather: params.context.weather,
    });
    if (mealPlaces.length) merged = dedupeChatPlaces([...merged, ...mealPlaces]);
  }

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
    message: `${combinationMappingFailureMessage({
      code: failure.code,
      selectedCombinationCount: selectedCount,
    })}\n\n點選「${COMBINATION_MAPPING_REGENERATE_OPTION}」可沿用目前目的地與選擇再試一次。`,
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
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds,
    msgs,
    fetchPlaceDetails,
  } = params;
  // P3：候選搜尋經 PIE Gateway（Flag OFF = legacy 注入函式）
  const searchPlaces = wrapPlannerPlaceSearchViaGateway(params.searchPlaces);

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

  const label = sanitizeDestinationForGeocode(normalizeDestinationLabel(destination));
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

  // Recommendation → Planner: seed Candidate Pool from chat cards before Places mapping
  {
    const poolSessionId =
      syncedSession.planningSessionId?.trim() ||
      syncedSession.conversationId?.trim() ||
      generationRequestId;
    const fromCards = sessionPlaces
      .map(chatPlaceItemToPlaceResult)
      .filter((p): p is PlaceResult => p != null);
    if (fromCards.length) {
      ingestResolvedPlacesIntoCandidatePool({
        sessionId: poolSessionId,
        destination: label,
        places: fromCards,
        source: "itinerary_session_recommended",
      });
    }
  }

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
            selectionSource: context.selectionSource ?? allowlist.selectionSource,
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
    sessionId:
      syncedSession.planningSessionId?.trim() ||
      syncedSession.conversationId?.trim() ||
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
        ? annotatePlaceWithCombinationMetadata(p, label, allowlist.selectedCombinationIds)
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
    userText: msgs
      ?.slice()
      .reverse()
      .find((m) => m.role === "user")?.content,
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
            selectionSource: context.selectionSource ?? allowlist.selectionSource,
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
