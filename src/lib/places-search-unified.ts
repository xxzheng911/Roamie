import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { executeExploreSearch } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import {
  buildPlacesSearchKey,
  getPlacesSearchCachedOrRun,
  hasPlacesClientFallbackAttempted,
  markPlacesClientFallbackAttempted,
  markPlacesSearchFailed,
} from "@/lib/places-search-dedupe";
import {
  logPlacesApiSkipDuplicate,
  logPlacesApiCall,
} from "@/lib/places-diagnostics";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import {
  isPlacesRateLimited,
  notePlacesRateLimited,
  waitForPlacesGenerationCooldown,
} from "@/lib/places-api-guard";
import { normalizePlacesSearchResult } from "@/lib/places-search-normalize";

async function runClientSearch(
  args: Parameters<SearchPlacesFn>[0],
  key: string,
): Promise<ReturnType<SearchPlacesFn>> {
  // Never hard-fail mid-generation: wait for cooldown, then let executeExploreSearch
  // / runPlacesApiDeduped apply concurrency + Retry-After backoff.
  if (isPlacesRateLimited()) {
    notePlacesRateLimited({ attemptIndex: 0 });
    await waitForPlacesGenerationCooldown();
  }
  if (hasPlacesClientFallbackAttempted(key)) {
    logPlacesApiSkipDuplicate("client_fallback", { key });
    return {
      places: [],
      error: "places_client_fallback_already_attempted",
    };
  }

  markPlacesClientFallbackAttempted(key);

  const mapsKey = getGoogleMapsBrowserKey();
  logPlacesApiCall("client", args.data);

  if (!mapsKey) {
    markPlacesSearchFailed(key);
    const empty = normalizePlacesSearchResult({
      places: [],
      error: "無法取得附近推薦。請確認已設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY。",
    });
    return empty;
  }

  try {
    const clientResult = normalizePlacesSearchResult(
      await executeExploreSearch(args.data, { apiKey: mapsKey }),
    );
    return clientResult;
  } catch (e) {
    markPlacesSearchFailed(key);
    return normalizePlacesSearchResult({
      places: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * TestFlight / 本機 bundle 沒有 TanStack server 時，改以瀏覽器 Google Places API 搜尋。
 * 首頁與 Explore 共用 dedupe / cache / failed TTL。
 */
export function createUnifiedSearchPlacesFn(serverFn: SearchPlacesFn): SearchPlacesFn {
  const preferClientOnly = isCapacitorNativeShell();

  return async (args) => {
    const key = buildPlacesSearchKey(args.data, {
      country: args.data.cacheCountry,
      city: args.data.cacheCity,
      placeId: args.data.cachePlaceId,
      destinationName: args.data.cacheDestination,
      category: args.data.categoryId,
      language: args.data.locale,
      lat: args.data.lat,
      lng: args.data.lng,
      mode: args.data.mode,
      query: args.data.query,
    });

    return getPlacesSearchCachedOrRun(key, async () => {
      if (preferClientOnly) {
        return runClientSearch(args, key);
      }

      logPlacesApiCall("server", args.data);

      let serverResult = normalizePlacesSearchResult(undefined);

      try {
        serverResult = normalizePlacesSearchResult(await serverFn(args));
        if (serverResult.places.length > 0) return serverResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        serverResult = { places: [], error: msg };
        if (serverResult.places.length === 0 && serverResult.error) {
          devVerboseInfo(`[PLACES_API_EMPTY] error=${serverResult.error}`);
        }
      }

      if (isPlacesRateLimited()) {
        return serverResult.places.length > 0
          ? serverResult
          : { places: [], error: "places_rate_limited" };
      }

      return runClientSearch(args, key);
    }, {
      scope: {
        country: args.data.cacheCountry,
        city: args.data.cacheCity,
        placeId: args.data.cachePlaceId,
        destinationName: args.data.cacheDestination,
        category: args.data.categoryId,
        language: args.data.locale,
        lat: args.data.lat,
        lng: args.data.lng,
      },
    });
  };
}
