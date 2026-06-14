import type { SearchPlacesInput } from "@/lib/explore-category-search";
import { normalizedLocationKey } from "@/lib/location-key";
import {
  normalizePlacesSearchResult,
  type PlacesSearchResult,
} from "@/lib/places-search-normalize";
import { logPlacesApiSkipDuplicate, logPlacesCacheHit } from "@/lib/places-diagnostics";
import { homeNearbySearchRadiusMeters } from "@/lib/search-radius";

export type { PlacesSearchResult };

const PLACES_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const PLACES_SEARCH_FAILED_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { data: PlacesSearchResult; expiresAt: number };

const cacheMap = new Map<string, CacheEntry>();
const inFlightMap = new Map<string, Promise<PlacesSearchResult>>();
const failedKeyUntil = new Map<string, number>();
const clientFallbackAttempted = new Set<string>();

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
  return `${locationKey}:${radius}:${data.mode}:${query}:${types}:${groups}:${locale}`;
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
  failedKeyUntil.set(key, now + PLACES_SEARCH_FAILED_TTL_MS);
}

export function hasPlacesClientFallbackAttempted(key: string): boolean {
  return clientFallbackAttempted.has(key);
}

export function markPlacesClientFallbackAttempted(key: string): void {
  clientFallbackAttempted.add(key);
}

export function getPlacesSearchCachedOrRun(
  key: string,
  runner: () => Promise<PlacesSearchResult>,
): Promise<PlacesSearchResult> {
  const now = Date.now();

  if (isFailedKey(key, now)) {
    const cached = readCached(key, now);
    logPlacesApiSkipDuplicate("failed_ttl", { key, cached: Boolean(cached) });
    return Promise.resolve(cached ?? { places: [], error: "places_search_cached_failure" });
  }

  const cached = readCached(key, now);
  if (cached) {
    logPlacesCacheHit(key, cached.places.length, "api");
    return Promise.resolve(cached);
  }

  const inflight = inFlightMap.get(key);
  if (inflight) {
    logPlacesApiSkipDuplicate("in_flight", { key });
    return inflight;
  }

  const promise = runner()
    .then((result) => {
      const normalized = normalizePlacesSearchResult(result);
      const ttl =
        normalized.places.length > 0 ? PLACES_SEARCH_CACHE_TTL_MS : PLACES_SEARCH_FAILED_TTL_MS;
      writeCached(key, normalized, ttl);
      if (normalized.places.length === 0) {
        markPlacesSearchFailed(key);
      }
      return normalized;
    })
    .catch((e) => {
      markPlacesSearchFailed(key);
      const empty: PlacesSearchResult = {
        places: [],
        error: e instanceof Error ? e.message : String(e),
      };
      writeCached(key, empty, PLACES_SEARCH_FAILED_TTL_MS);
      return empty;
    })
    .finally(() => {
      inFlightMap.delete(key);
    });

  inFlightMap.set(key, promise);
  return promise;
}
