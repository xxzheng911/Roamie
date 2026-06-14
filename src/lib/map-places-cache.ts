import type { PlaceResult } from "@/lib/place-result";
import { normalizedLocationKey } from "@/lib/location-key";
import { logPlacesCacheHit } from "@/lib/places-diagnostics";

export type MapPlacesCacheEntry = {
  places: PlaceResult[];
  error: string | null;
  at: number;
};

const CACHE = new Map<string, MapPlacesCacheEntry>();
const IN_FLIGHT = new Map<string, Promise<MapPlacesCacheEntry>>();
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 48;

/** locationKey + categoryId + locale — 首頁與探索地圖共用分類結果快取 */
export function buildMapPlacesCacheKey(parts: {
  lat: number;
  lng: number;
  categoryId: string;
  locale: string;
}): string {
  const locationKey = normalizedLocationKey(parts.lat, parts.lng);
  return `${locationKey}:${parts.categoryId}:${parts.locale}`;
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
): Promise<MapPlacesCacheEntry> {
  const cached = readMapPlacesCache(key);
  if (cached) {
    logPlacesCacheHit(key, cached.places.length, "map_category");
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
