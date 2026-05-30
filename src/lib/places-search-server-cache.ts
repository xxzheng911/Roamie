import { PLACES_CACHE_TTL_MS } from "@/lib/places-cache-config";
import { DEFAULT_SEARCH_RADIUS_M } from "@/lib/places-search-config";
import type { z } from "zod";
import type { ExploreSearchInput } from "@/lib/places.functions";
import { createServerRequestCache } from "@/lib/server-request-cache";

const serverExploreCache = createServerRequestCache(PLACES_CACHE_TTL_MS.explore);

function snapCoord(value: number): string {
  return value.toFixed(3);
}

export function buildServerExploreSearchCacheKey(
  data: z.infer<typeof ExploreSearchInput>,
): string {
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

export function getServerCachedExploreSearch<T>(
  data: z.infer<typeof ExploreSearchInput>,
  fetcher: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
): Promise<T> {
  const key = buildServerExploreSearchCacheKey(data);
  return serverExploreCache.getOrFetch(key, fetcher, shouldCache);
}
