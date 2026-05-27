import type { PlaceResult } from "@/lib/place-result";
import { shouldSkipPlacesClientRetry } from "@/lib/places-api-errors";

type CacheEntry = {
  places: PlaceResult[];
  error: string | null;
  at: number;
};

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 48;

function cacheKey(parts: {
  lat: number;
  lng: number;
  query: string;
  categoryId: string;
  locale: string;
}): string {
  const lat = parts.lat.toFixed(3);
  const lng = parts.lng.toFixed(3);
  return `${lat}|${lng}|${parts.categoryId}|${parts.query.trim().toLowerCase()}|${parts.locale}`;
}

export function readMapPlacesCache(key: string): CacheEntry | null {
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
  if (error && shouldSkipPlacesClientRetry(error)) {
    return;
  }
  if (CACHE.size >= MAX_ENTRIES) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, { places, error, at: Date.now() });
}

export function buildMapPlacesCacheKey(parts: {
  lat: number;
  lng: number;
  query: string;
  categoryId: string;
  locale: string;
}): string {
  return cacheKey(parts);
}
