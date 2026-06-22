import type { PlaceResult } from "@/lib/place-result";
import { normalizedLocationKey } from "@/lib/location-key";
import { PLACES_NEARBY_CACHE_TTL_MS } from "@/lib/places-api-guard";
import { logPlacesCacheHit } from "@/lib/places-diagnostics";
import { exploreTimeBucket, type ExploreTimeBucket } from "@/lib/explore-time-bucket";

export type { ExploreTimeBucket } from "@/lib/explore-time-bucket";
export { exploreTimeBucket, buildExploreSessionKey } from "@/lib/explore-time-bucket";

export type MapPlacesCacheEntry = {
  places: PlaceResult[];
  error: string | null;
  at: number;
};

const CACHE = new Map<string, MapPlacesCacheEntry>();
const IN_FLIGHT = new Map<string, Promise<MapPlacesCacheEntry>>();
const TTL_MS = PLACES_NEARBY_CACHE_TTL_MS;
const MAX_ENTRIES = 48;

/** locationKey + categoryId + locale + timeBucket — 探索地圖分類結果快取 */
export function buildMapPlacesCacheKey(parts: {
  lat: number;
  lng: number;
  categoryId: string;
  locale: string;
  mode?: "city" | "nearby";
  timeBucket?: ExploreTimeBucket;
}): string {
  const locationKey = normalizedLocationKey(parts.lat, parts.lng);
  const bucket = parts.timeBucket ?? exploreTimeBucket();
  const modeSuffix = parts.mode === "city" ? ":city" : "";
  return `${locationKey}:${parts.categoryId}:${parts.locale}:${bucket}${modeSuffix}`;
}

export function readMapPlacesCache(key: string): MapPlacesCacheEntry | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit;
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
  CACHE.set(key, {
    places,
    error: places.length > 0 ? null : error,
    at: Date.now(),
  });
}

export function getMapPlacesCachedOrRun(
  key: string,
  runner: () => Promise<{ places: PlaceResult[]; error: string | null }>,
  options?: { silent?: boolean },
): Promise<MapPlacesCacheEntry> {
  const cached = readMapPlacesCache(key);
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
