import type { SearchPlacesInput } from "@/lib/explore-category-search";
import { normalizedLocationKey } from "@/lib/location-key";
import {
  normalizePlacesSearchResult,
  type PlacesSearchResult,
} from "@/lib/places-search-normalize";
import {
  PLACES_SEARCH_CACHE_TTL_MS,
  PLACES_FAILED_CACHE_TTL_MS,
} from "@/lib/places-api-guard";
import { logPlacesCacheHit, logPlacesCacheMiss, logPlacesDedupePending } from "@/lib/places-api-guard";
import { logPlacesApiSkipDuplicate } from "@/lib/places-diagnostics";
import { homeNearbySearchRadiusMeters } from "@/lib/search-radius";

type CacheEntry = { data: PlacesSearchResult; expiresAt: number };

const cacheMap = new Map<string, CacheEntry>();
const inFlightMap = new Map<string, Promise<PlacesSearchResult>>();
const failedKeyUntil = new Map<string, number>();
const clientFallbackAttempted = new Set<string>();
const skipLogAt = new Map<string, number>();
const SKIP_LOG_THROTTLE_MS = 30_000;

function nearbyGroupsKey(groups?: string[][]): string {
  if (!groups?.length) return "";
  return groups.map((g) => [...g].sort().join("+")).join("|");
}

/** 同一 Places 請求 dedupe key：3 位小數座標 + radius + mode + query + types + nearbyGroups + locale */
export function buildPlacesSearchKey(data: SearchPlacesInput): string {
  const locationKey = normalizedLocationKey(data.lat, data.lng);
  const radius = data.radius ?? homeNearbySearchRadiusMeters();
  const types = [...(data.includedTypes ?? [])].sort().join(",");
  const groups = nearbyGroupsKey(data.nearbyGroups);
  const query = (data.query ?? "").trim();
  const locale = data.locale ?? "";
  const categoryId = data.categoryId ?? "";
  return `${locationKey}:${radius}:${categoryId}:${data.mode}:${query}:${types}:${groups}:${locale}`;
}

function readCached(key: string, now = Date.now()): PlacesSearchResult | null {
  const entry = cacheMap.get(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.data;
}

function writeCached(key: string, data: PlacesSearchResult, ttlMs: number, now = Date.now()): void {
  cacheMap.set(key, { data, expiresAt: now + ttlMs });
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
): Promise<PlacesSearchResult> {
  const now = Date.now();

  if (isFailedKey(key, now)) {
    const cached = readCached(key, now);
    if (cached && cached.places.length > 0) {
      return Promise.resolve(cached);
    }
    logPlacesApiSkipOnce("failed_ttl", { key, cached: Boolean(cached) });
    return Promise.resolve({ places: [], error: "places_search_cached_failure" });
  }

  const cached = readCached(key, now);
  if (cached && cached.places.length > 0) {
    logPlacesCacheHit(key);
    return Promise.resolve(cached);
  }

  logPlacesCacheMiss(key);

  const inflight = inFlightMap.get(key);
  if (inflight) {
    logPlacesDedupePending(key);
    return inflight;
  }

  const promise = runner()
    .then((result) => {
      const normalized = normalizePlacesSearchResult(result);
      if (normalized.places.length > 0) {
        writeCached(key, normalized, PLACES_SEARCH_CACHE_TTL_MS);
        return normalized;
      }
      markPlacesSearchFailed(key);
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
