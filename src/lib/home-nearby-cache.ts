import {
  PLACES_CACHE_TTL_MS,
  PLACES_COORD_GRID_DECIMALS,
} from "@/lib/places-cache-config";
import type { HomeNearbyPicksResult } from "@/lib/explore-category-search";
import { HOME_NEARBY_CACHE_VERSION } from "@/lib/home-nearby-enrich";
import { createRequestCache } from "@/services/requestCache";

const homeNearbyCache = createRequestCache({
  prefix: "home-nearby",
  ttlMs: PLACES_CACHE_TTL_MS.homeNearby,
  persist: true,
});

function snapCoord(value: number): string {
  return value.toFixed(PLACES_COORD_GRID_DECIMALS);
}

/** 固定 key：location grid + category ids + mood（不含 locale / weather 字串） */
export function buildHomeNearbyCacheKey(parts: {
  lat: number;
  lng: number;
  mood: string | null;
  categoryIds: string[];
}): string {
  return [
    HOME_NEARBY_CACHE_VERSION,
    snapCoord(parts.lat),
    snapCoord(parts.lng),
    parts.categoryIds.slice().sort().join(","),
    parts.mood ?? "",
  ].join("§");
}

export function readHomeNearbyCache(key: string): HomeNearbyPicksResult | null {
  return homeNearbyCache.getCached<HomeNearbyPicksResult>(key);
}

export function writeHomeNearbyCache(key: string, result: HomeNearbyPicksResult): void {
  homeNearbyCache.setCached(key, result);
}
