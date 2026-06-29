import type { PlaceResult } from "@/lib/place-result";
import { PLACES_NEARBY_CACHE_TTL_MS } from "@/lib/places-api-guard";
import { logPlacesCacheHit } from "@/lib/places-diagnostics";
import type { ExploreTimeBucket } from "@/lib/explore-time-bucket";
import {
  buildExploreMapCacheScopeFromParts,
  buildExploreMapCacheScopeKey,
  clearExploreMapPersistedCache,
  exploreMapCacheTtlMs,
  readExploreMapPersistedCache,
  writeExploreMapPersistedCache,
  type ExploreMapCacheScope,
} from "@/lib/explore-map-persistent-cache";

export type { ExploreTimeBucket } from "@/lib/explore-time-bucket";
export {
  exploreTimeBucket,
  buildExploreSessionKey,
} from "@/lib/explore-time-bucket";
export {
  buildUnifiedPlaceCacheKey,
  buildUnifiedPlaceDetailsCacheKey,
  setUnifiedPlaceCacheForceRefresh,
  consumeUnifiedPlaceCacheForceRefresh,
  readCachedPlaceResultById,
  cachePlaceResultById,
  UNIFIED_PLACE_CACHE_TTL_MS,
  type UnifiedPlaceCacheScope,
} from "@/lib/unified-place-cache";
export {
  buildExploreMapCacheScopeKey,
  buildExploreMapCacheScopeFromParts,
  buildExploreMapSessionKey,
  readExploreMapSearchSession,
  writeExploreMapSearchSession,
  clearExploreMapSearchSession,
  setExploreMapForceRefreshNext,
  consumeExploreMapForceRefresh,
  normalizeExploreCityCacheKey,
  type ExploreMapCacheScope,
  type ExploreMapSearchSession,
} from "@/lib/explore-map-persistent-cache";

export type MapPlacesCacheEntry = {
  places: PlaceResult[];
  error: string | null;
  at: number;
};

const CACHE = new Map<string, MapPlacesCacheEntry>();
const IN_FLIGHT = new Map<string, Promise<MapPlacesCacheEntry>>();
const MAX_ENTRIES = 64;

/** @deprecated 使用 buildExploreMapCacheScopeKey；保留相容 nearby 座標 key */
export function buildMapPlacesCacheKey(parts: {
  lat: number;
  lng: number;
  categoryId: string;
  locale: string;
  mode?: "city" | "nearby";
  timeBucket?: ExploreTimeBucket;
  cityPlaceId?: string | null;
  cityLabel?: string | null;
}): string {
  return buildExploreMapCacheScopeKey(
    buildExploreMapCacheScopeFromParts({
      lat: parts.lat,
      lng: parts.lng,
      categoryId: parts.categoryId,
      locale: parts.locale,
      mode: parts.mode,
      cityPlaceId: parts.cityPlaceId,
      cityLabel: parts.cityLabel,
    }),
  );
}

function memoryTtlMs(scopeKey: string): number {
  return scopeKey.startsWith("city:") ? exploreMapCacheTtlMs("city") : PLACES_NEARBY_CACHE_TTL_MS;
}

function cacheMode(scopeKey: string): "city" | "nearby" {
  return scopeKey.startsWith("city:") ? "city" : "nearby";
}

export function readMapPlacesCache(
  key: string,
  options?: { ignoreCache?: boolean },
): MapPlacesCacheEntry | null {
  if (options?.ignoreCache) return null;

  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at <= memoryTtlMs(key)) {
    return hit;
  }
  if (hit) CACHE.delete(key);

  const persisted = readExploreMapPersistedCache<PlaceResult>(key, cacheMode(key));
  if (!persisted) return null;

  const entry: MapPlacesCacheEntry = {
    places: persisted.places,
    error: persisted.error,
    at: persisted.at,
  };
  CACHE.set(key, entry);
  return entry;
}

export function writeMapPlacesCache(
  key: string,
  places: PlaceResult[],
  error: string | null,
): void {
  if (places.length === 0) return;

  if (CACHE.size >= MAX_ENTRIES) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) CACHE.delete(oldest);
  }

  const entry: MapPlacesCacheEntry = {
    places,
    error: places.length > 0 ? null : error,
    at: Date.now(),
  };
  CACHE.set(key, entry);
  writeExploreMapPersistedCache(key, places, error);
}

export function invalidateMapPlacesCache(key: string): void {
  CACHE.delete(key);
  clearExploreMapPersistedCache(key);
}

export function getMapPlacesCachedOrRun(
  key: string,
  runner: () => Promise<{ places: PlaceResult[]; error: string | null }>,
  options?: { silent?: boolean; forceRefresh?: boolean },
): Promise<MapPlacesCacheEntry> {
  if (options?.forceRefresh) {
    invalidateMapPlacesCache(key);
  }

  const cached = readMapPlacesCache(key, { ignoreCache: options?.forceRefresh });
  if (cached?.places.length) {
    if (!options?.silent) {
      logPlacesCacheHit(key, cached.places.length, "map_category");
    }
    return Promise.resolve(cached);
  }

  const inflight = IN_FLIGHT.get(key);
  if (inflight) return inflight;

  const promise = runner()
    .then((result) => {
      writeMapPlacesCache(key, result.places, result.error);
      return readMapPlacesCache(key) ?? { places: result.places, error: result.error, at: Date.now() };
    })
    .finally(() => {
      IN_FLIGHT.delete(key);
    });

  IN_FLIGHT.set(key, promise);
  return promise;
}

export { invalidateMapPlacesCache as clearMapPlacesCacheEntry };
