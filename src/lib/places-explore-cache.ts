import type { PlaceResult } from "@/lib/place-result";
import { shouldSkipPlacesClientRetry } from "@/lib/places-api-errors";
import {
  PLACES_CACHE_TTL_MS,
  PLACES_COORD_GRID_DECIMALS,
} from "@/lib/places-cache-config";
import { DEFAULT_SEARCH_RADIUS_M } from "@/lib/places-search-config";
import type { SearchPlacesInput } from "@/lib/explore-category-search";
import { createRequestCache } from "@/services/requestCache";

export type ExploreSearchResult = { places: PlaceResult[]; error: string | null };

const exploreSearchCache = createRequestCache({
  prefix: "places-explore",
  ttlMs: PLACES_CACHE_TTL_MS.explore,
});

function snapCoord(value: number): string {
  return value.toFixed(PLACES_COORD_GRID_DECIMALS);
}

/** 同座標網格 + 相同搜尋參數共用一筆 cache / in-flight request */
export function buildExploreSearchCacheKey(data: SearchPlacesInput): string {
  const types = data.includedTypes?.slice().sort().join(",") ?? "";
  const groups =
    data.nearbyGroups
      ?.map((group) => group.slice().sort().join("+"))
      .sort()
      .join("|") ?? "";
  return [
    snapCoord(data.lat),
    snapCoord(data.lng),
    String(data.radius ?? DEFAULT_SEARCH_RADIUS_M),
    data.mode,
    data.query.trim().toLowerCase(),
    types,
    groups,
    data.locale ?? "zh-TW",
    data.availabilityContext ?? "now",
  ].join("§");
}

function shouldPersistExploreResult(result: ExploreSearchResult): boolean {
  if (result.error && shouldSkipPlacesClientRetry(result.error)) return false;
  return true;
}

/**
 * 探索搜尋：記憶體 cache + 並發 dedupe。
 * 首頁 / 地圖 / Chat fallback 經 unified search 共用。
 */
export async function getCachedExploreSearch(
  data: SearchPlacesInput,
  fetcher: () => Promise<ExploreSearchResult>,
): Promise<ExploreSearchResult> {
  const key = buildExploreSearchCacheKey(data);
  const cached = exploreSearchCache.getCached<ExploreSearchResult>(key);
  if (cached !== null) {
    console.info("[PLACES_CACHE] explore hit", { key: key.slice(0, 48) });
    return cached;
  }

  return exploreSearchCache.getOrFetch(key, fetcher, shouldPersistExploreResult);
}
