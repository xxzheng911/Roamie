import type { Locale } from "@/lib/i18n/types";
import {
  PLACES_CACHE_TTL_MS,
  PLACES_COORD_GRID_DECIMALS,
} from "@/lib/places-cache-config";
import type { HomeNearbyPicksResult } from "@/lib/explore-category-search";
import { createRequestCache } from "@/services/requestCache";

const homeNearbyCache = createRequestCache({
  prefix: "home-nearby",
  ttlMs: PLACES_CACHE_TTL_MS.homeNearby,
});

function snapCoord(value: number): string {
  return value.toFixed(PLACES_COORD_GRID_DECIMALS);
}

export function buildHomeNearbyCacheKey(parts: {
  lat: number;
  lng: number;
  locale: Locale;
  mood: string | null;
  categoryIds: string[];
}): string {
  return [
    snapCoord(parts.lat),
    snapCoord(parts.lng),
    parts.locale,
    parts.mood ?? "",
    parts.categoryIds.slice().sort().join(","),
  ].join("§");
}

export function readHomeNearbyCache(key: string): HomeNearbyPicksResult | null {
  return homeNearbyCache.getCached<HomeNearbyPicksResult>(key);
}

export function writeHomeNearbyCache(key: string, result: HomeNearbyPicksResult): void {
  homeNearbyCache.setCached(key, result);
}
