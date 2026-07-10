import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { isPlacesRateLimited } from "@/lib/places-api-guard";
import {
  buildLocalClassicLandmarkPool,
  buildSyntheticClassicLandmarkPlace,
  consumePlacesRateLimitEncountered,
  isPlacesRateLimitError,
  logPlacesRateLimitFallback,
  markPlacesRateLimitEncountered,
  mergeClassicLandmarkCaches,
  persistClassicLandmarkCaches,
} from "@/lib/places-classic-landmark-cache";
import { minCandidatePoolSize } from "@/lib/ai/ai-multi-day-planner";
import {
  buildClassicLandmarkRegionalAttempts,
  buildClassicLandmarkSearchAttempts,
  CLASSIC_LANDMARK_MIN_PER_DAY,
  countClassicLandmarkScenicPlaces,
  filterPlacesForClassicLandmarkWithLogging,
  getClassicLandmarkWhitelist,
  logClassicFallbackResolveSuccess,
  logClassicFallbackWhitelistStart,
  logClassicFinalValidCount,
  logClassicRenderReady,
  logClassicSearchQueryResult,
  logClassicSearchQueryStart,
} from "@/lib/ai/ai-classic-landmark-rules";
import { filterExcludedRetailPlaces } from "@/lib/ai/ai-day-plan-slot-rules";

const CLASSIC_LANDMARK_STYLE = "classic_landmarks";

export function classicLandmarkMinPlaceCount(days: number): number {
  return Math.max(1, days) * CLASSIC_LANDMARK_MIN_PER_DAY;
}

function dedupePlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const place of places) {
    const id = (place.id ?? "").trim();
    const nameKey = normalizePlaceName(place.name ?? "");
    const key = id && !id.startsWith("synthetic:") && !id.startsWith("landmark-cache:")
      ? id
      : nameKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

export async function resolveClassicLandmarkWhitelistPlace(params: {
  destination: string;
  placeName: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  index?: number;
}): Promise<PlaceResult | null> {
  const { destination, placeName, lat, lng, locale, searchPlaces, index = 0 } = params;

  if (isPlacesRateLimited()) {
    markPlacesRateLimitEncountered();
    return buildSyntheticClassicLandmarkPlace({
      name: placeName,
      destination,
      lat,
      lng,
      index,
    });
  }

  try {
    const result = await searchPlaces({
      data: {
        query: `${destination} ${placeName}`,
        lat,
        lng,
        mode: "text",
        includedTypes: ["tourist_attraction", "point_of_interest", "park", "museum"],
        locale,
        placesCaller: "classic_landmark_whitelist",
        placesScreen: "chat",
        destinationName: destination,
        searchMode: "destination",
      },
    });

    if (isPlacesRateLimitError(result.error)) {
      markPlacesRateLimitEncountered();
      return buildSyntheticClassicLandmarkPlace({
        name: placeName,
        destination,
        lat,
        lng,
        index,
      });
    }

    const places = result.places ?? [];
    const exact =
      places.find((p) => normalizePlaceName(p.name) === normalizePlaceName(placeName)) ??
      places[0];
    if (!exact?.name?.trim()) {
      return buildSyntheticClassicLandmarkPlace({
        name: placeName,
        destination,
        lat,
        lng,
        index,
      });
    }
    if (!exact.id?.trim() && exact.lat == null && exact.lng == null && !exact.address?.trim()) {
      return buildSyntheticClassicLandmarkPlace({
        name: placeName,
        destination,
        lat,
        lng,
        index,
      });
    }
    logClassicFallbackResolveSuccess(exact.name, exact.id ?? "");
    return exact;
  } catch {
    return buildSyntheticClassicLandmarkPlace({
      name: placeName,
      destination,
      lat,
      lng,
      index,
    });
  }
}

export async function resolveClassicLandmarkWhitelistPlaces(params: {
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  existingPlaces: PlaceResult[];
  days: number;
}): Promise<PlaceResult[]> {
  const minRequired = classicLandmarkMinPlaceCount(params.days);
  const scenicCount = countClassicLandmarkScenicPlaces(params.existingPlaces);
  if (scenicCount >= minRequired) return [];

  logClassicFallbackWhitelistStart(params.destination, scenicCount, minRequired);
  const whitelist = getClassicLandmarkWhitelist(params.destination);
  const existingNames = new Set(
    params.existingPlaces.map((p) => normalizePlaceName(p.name ?? "")).filter(Boolean),
  );
  const existingIds = new Set(
    params.existingPlaces.map((p) => p.id?.trim()).filter(Boolean) as string[],
  );

  const resolved: PlaceResult[] = [];
  for (let i = 0; i < whitelist.length; i += 1) {
    const name = whitelist[i]!;
    if (scenicCount + resolved.length >= minRequired) break;
    const nameKey = normalizePlaceName(name);
    if (existingNames.has(nameKey)) continue;

    const place = await resolveClassicLandmarkWhitelistPlace({
      destination: params.destination,
      placeName: name,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      index: i,
    });
    if (!place) continue;
    const id = place.id?.trim();
    if (id && existingIds.has(id)) continue;
    if (id) existingIds.add(id);
    existingNames.add(normalizePlaceName(place.name));
    resolved.push(place);

    if (consumePlacesRateLimitEncountered()) {
      logPlacesRateLimitFallback("whitelist_resolve_stopped");
      break;
    }
  }
  return resolved;
}

export type ClassicLandmarkSearchBatchFn = (attempts: {
  query: string;
  mode: "text";
  includedTypes?: string[];
}[]) => Promise<PlaceResult[]>;

/** 多組查詢合併去重，並在不足時補 whitelist；rate limit 時走本地地標快取 */
export async function ensureClassicLandmarkPlacePool(params: {
  destination: string;
  days: number;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  searchBatch: ClassicLandmarkSearchBatchFn;
  initialPlaces?: PlaceResult[];
}): Promise<PlaceResult[]> {
  const poolTarget = minCandidatePoolSize(params.days);
  const scenicMin = classicLandmarkMinPlaceCount(params.days);
  let rateLimitHit = false;

  const cached = mergeClassicLandmarkCaches(params.destination, CLASSIC_LANDMARK_STYLE);
  if (cached?.length) {
    const cachedFiltered = filterPlacesForClassicLandmarkWithLogging(cached, params.days);
    if (cached.length >= poolTarget && countClassicLandmarkScenicPlaces(cachedFiltered) >= scenicMin) {
      logPlacesRateLimitFallback(`session_cache count=${cached.length}`);
      return filterExcludedRetailPlaces(cached);
    }
  }

  let collected = dedupePlaces(params.initialPlaces ?? []);

  if (!isPlacesRateLimited()) {
    const allAttempts = [
      ...buildClassicLandmarkSearchAttempts(params.destination),
      ...Array.from({ length: params.days }, (_, dayIndex) =>
        buildClassicLandmarkRegionalAttempts(params.destination, dayIndex),
      ).flat(),
    ];

    const seenQueries = new Set<string>();
    for (const attempt of allAttempts) {
      if (isPlacesRateLimited()) {
        markPlacesRateLimitEncountered();
        rateLimitHit = true;
        break;
      }
      if (seenQueries.has(attempt.query)) continue;
      seenQueries.add(attempt.query);
      logClassicSearchQueryStart(attempt.query);
      const batch = await params.searchBatch([attempt]);
      logClassicSearchQueryResult(attempt.query, batch.length);
      collected = dedupePlaces([...collected, ...batch]);
      if (consumePlacesRateLimitEncountered()) {
        rateLimitHit = true;
        break;
      }
      if (collected.length >= poolTarget) break;
    }
  } else {
    rateLimitHit = true;
    markPlacesRateLimitEncountered();
  }

  let planningPool = filterExcludedRetailPlaces(dedupePlaces(collected));
  const scenicFiltered = filterPlacesForClassicLandmarkWithLogging(planningPool, params.days);

  if (rateLimitHit || planningPool.length < poolTarget) {
    logPlacesRateLimitFallback(
      `google_fail pool=${planningPool.length} scenic=${countClassicLandmarkScenicPlaces(scenicFiltered)}`,
    );
    const localPool = buildLocalClassicLandmarkPool({
      destination: params.destination,
      days: params.days,
      lat: params.lat,
      lng: params.lng,
      minCount: poolTarget,
    });
    planningPool = filterExcludedRetailPlaces(dedupePlaces([...planningPool, ...localPool]));
  }

  if (countClassicLandmarkScenicPlaces(scenicFiltered) < scenicMin) {
    const whitelistResolved = await resolveClassicLandmarkWhitelistPlaces({
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      existingPlaces: planningPool,
      days: params.days,
    });
    planningPool = filterExcludedRetailPlaces(dedupePlaces([...planningPool, ...whitelistResolved]));
  }

  if (planningPool.length < poolTarget) {
    const localTopUp = buildLocalClassicLandmarkPool({
      destination: params.destination,
      days: params.days,
      lat: params.lat,
      lng: params.lng,
      minCount: poolTarget,
    });
    planningPool = filterExcludedRetailPlaces(dedupePlaces([...planningPool, ...localTopUp]));
  }

  if (planningPool.length) {
    persistClassicLandmarkCaches(params.destination, CLASSIC_LANDMARK_STYLE, planningPool);
  }

  const finalScenic = countClassicLandmarkScenicPlaces(
    filterPlacesForClassicLandmarkWithLogging(planningPool, params.days),
  );
  logClassicFinalValidCount(finalScenic, scenicMin);
  logClassicRenderReady(planningPool.length, params.days);
  return planningPool;
}
