import type { SearchPlacesInput } from "@/lib/explore-category-search";
import { normalizedLocationKey } from "@/lib/location-key";
import {
  normalizePlacesSearchResult,
  type PlacesSearchResult,
} from "@/lib/places-search-normalize";
import { PLACES_FAILED_CACHE_TTL_MS } from "@/lib/places-api-guard";
import { logPlacesCacheHit, logPlacesCacheMiss, logPlacesDedupePending } from "@/lib/places-api-guard";
import { logPlacesApiSkipDuplicate } from "@/lib/places-diagnostics";
import { homeNearbySearchRadiusMeters } from "@/lib/search-radius";
import {
  buildUnifiedPlaceCacheKey,
  consumeUnifiedPlaceCacheForceRefresh,
  readUnifiedPlaceSearchCache,
  writeUnifiedPlaceSearchCache,
  type UnifiedPlaceCacheScope,
} from "@/lib/unified-place-cache";

const inFlightMap = new Map<string, Promise<PlacesSearchResult>>();
const failedKeyUntil = new Map<string, number>();
const clientFallbackAttempted = new Set<string>();
const skipLogAt = new Map<string, number>();
const lastCacheStatus = new Map<string, "hit" | "miss" | "inflight">();
const SKIP_LOG_THROTTLE_MS = 30_000;

function nearbyGroupsKey(groups?: string[][]): string {
  if (!groups?.length) return "";
  return groups.map((g) => [...g].sort().join("+")).join("|");
}

export type PlacesSearchCacheScope = UnifiedPlaceCacheScope & {
  radius?: number;
  mode?: string;
  query?: string;
  includedTypes?: string[];
  nearbyGroups?: string[][];
};

/** 統一 key：country + city + placeId + category + language（含 geo fallback） */
export function buildPlacesSearchKey(
  data: SearchPlacesInput,
  scope?: Partial<PlacesSearchCacheScope>,
): string {
  const unifiedScope: UnifiedPlaceCacheScope = {
    country: scope?.country ?? data.cacheCountry,
    city: scope?.city ?? data.cacheCity,
    cityLabel: scope?.cityLabel ?? data.cacheCity,
    destinationName: scope?.destinationName ?? data.cacheDestination,
    placeId: scope?.placeId ?? data.cachePlaceId,
    category: scope?.category ?? data.categoryId ?? "all",
    language: scope?.language ?? data.locale ?? "zh-TW",
    lat: data.lat,
    lng: data.lng,
  };
  const base = buildUnifiedPlaceCacheKey(unifiedScope);
  const radius = data.radius ?? homeNearbySearchRadiusMeters();
  const types = [...(data.includedTypes ?? [])].sort().join(",");
  const groups = nearbyGroupsKey(data.nearbyGroups);
  const query = (scope?.query ?? data.query ?? "").trim();
  const mode = scope?.mode ?? data.mode;
  return `${base}|${radius}|${mode}|${query}|${types}|${groups}`;
}

export function readPlacesSearchCacheStatus(key: string): "hit" | "miss" | "inflight" | "unknown" {
  return lastCacheStatus.get(key) ?? "unknown";
}

function isFailedKey(key: string, now = Date.now()): boolean {
  const until = failedKeyUntil.get(key);
  return until !== undefined && until > now;
}

export function markPlacesSearchFailed(key: string, now = Date.now()): void {
  failedKeyUntil.set(key, now + PLACES_FAILED_CACHE_TTL_MS);
}

export function hasPlacesClientFallbackAttempted(key: string): boolean {
  return clientFallbackAttempted.has(key);
}

export function markPlacesClientFallbackAttempted(key: string): void {
  clientFallbackAttempted.add(key);
}

function logPlacesApiSkipOnce(
  reason: Parameters<typeof logPlacesApiSkipDuplicate>[0],
  detail: Parameters<typeof logPlacesApiSkipDuplicate>[1],
  now = Date.now(),
): void {
  const logKey = `${reason}:${detail.key ?? ""}`;
  const last = skipLogAt.get(logKey) ?? 0;
  if (now - last < SKIP_LOG_THROTTLE_MS) return;
  skipLogAt.set(logKey, now);
  logPlacesApiSkipDuplicate(reason, detail);
}

export function getPlacesSearchCachedOrRun(
  key: string,
  runner: () => Promise<PlacesSearchResult>,
  options?: {
    forceRefresh?: boolean;
    scope?: Partial<PlacesSearchCacheScope>;
  },
): Promise<PlacesSearchResult> {
  const now = Date.now();
  const forceRefresh = options?.forceRefresh || consumeUnifiedPlaceCacheForceRefresh();

  if (isFailedKey(key, now) && !forceRefresh) {
    const cached = readUnifiedPlaceSearchCache(key);
    if (cached && cached.places.length > 0) {
      return Promise.resolve(cached);
    }
    failedKeyUntil.delete(key);
  }

  const cached = readUnifiedPlaceSearchCache(key, { ignoreCache: forceRefresh });
  if (cached && cached.places.length > 0) {
    lastCacheStatus.set(key, "hit");
    logPlacesCacheHit(key);
    return Promise.resolve(cached);
  }

  logPlacesCacheMiss(key);
  lastCacheStatus.set(key, "miss");

  const inflight = inFlightMap.get(key);
  if (inflight) {
    lastCacheStatus.set(key, "inflight");
    logPlacesDedupePending(key);
    return inflight;
  }

  const promise = runner()
    .then((result) => {
      const normalized = normalizePlacesSearchResult(result);
      if (normalized.places.length > 0) {
        writeUnifiedPlaceSearchCache(key, normalized.places, normalized.error);
        for (const place of normalized.places) {
          if (!place.id) continue;
          writeUnifiedPlaceSearchCache(
            buildUnifiedPlaceCacheKey({
              ...options?.scope,
              placeId: place.id,
              category: "detail",
              language: options?.scope?.language ?? "zh-TW",
              lat: place.lat ?? undefined,
              lng: place.lng ?? undefined,
            }),
            [place],
            null,
          );
        }
        return normalized;
      }
      return normalized;
    })
    .catch((e) => {
      markPlacesSearchFailed(key);
      return {
        places: [],
        error: e instanceof Error ? e.message : String(e),
      };
    })
    .finally(() => {
      inFlightMap.delete(key);
    });

  inFlightMap.set(key, promise);
  return promise;
}

/** @deprecated 相容舊 geo key */
export function buildLegacyPlacesSearchKey(data: SearchPlacesInput): string {
  const locationKey = normalizedLocationKey(data.lat, data.lng);
  const radius = data.radius ?? homeNearbySearchRadiusMeters();
  const types = [...(data.includedTypes ?? [])].sort().join(",");
  const groups = nearbyGroupsKey(data.nearbyGroups);
  const query = (data.query ?? "").trim();
  const locale = data.locale ?? "";
  const categoryId = data.categoryId ?? "";
  return `${locationKey}:${radius}:${categoryId}:${data.mode}:${query}:${types}:${groups}:${locale}`;
}
