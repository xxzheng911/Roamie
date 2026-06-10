import type { SearchPlacesInput } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";
import { searchRadiusMeters } from "@/lib/search-radius";

export type PlacesSearchResult = { places: PlaceResult[]; error: string | null };

const PLACES_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const PLACES_SEARCH_FAILED_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { data: PlacesSearchResult; expiresAt: number };

const cacheMap = new Map<string, CacheEntry>();
const inFlightMap = new Map<string, Promise<PlacesSearchResult>>();
const failedKeyUntil = new Map<string, number>();
const clientFallbackAttempted = new Set<string>();

export function buildPlacesSearchKey(data: SearchPlacesInput): string {
  const rounded = `${data.lat.toFixed(3)}:${data.lng.toFixed(3)}`;
  const radius = data.radius ?? searchRadiusMeters();
  const types = data.includedTypes?.join(",") ?? "";
  const groups = data.nearbyGroups?.map((g) => g.join("|")).join(";") ?? "";
  return `${rounded}:${radius}:${data.mode}:${data.query}:${types}:${groups}:${data.locale ?? ""}`;
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
    console.info("[PLACES_SEARCH_SKIP_FAILED_TTL]", { key });
    return Promise.resolve(cached ?? { places: [], error: "places_search_cached_failure" });
  }

  const cached = readCached(key, now);
  if (cached) {
    console.info("[PLACES_SEARCH_SKIP_CACHE]", { key });
    return Promise.resolve(cached);
  }

  const inflight = inFlightMap.get(key);
  if (inflight) {
    console.info("[PLACES_SEARCH_SKIP_IN_FLIGHT]", { key });
    return inflight;
  }

  const promise = runner()
    .then((result) => {
      const ttl =
        result.places.length > 0 ? PLACES_SEARCH_CACHE_TTL_MS : PLACES_SEARCH_FAILED_TTL_MS;
      writeCached(key, result, ttl);
      if (result.places.length === 0) {
        markPlacesSearchFailed(key);
      }
      return result;
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
