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
  logPlacesRequest,
  logPlacesResponse,
} from "@/lib/places-diagnostics";
import { normalizePlacesSearchResult } from "@/lib/places-search-normalize";

async function runClientSearch(
  args: Parameters<SearchPlacesFn>[0],
  key: string,
): Promise<ReturnType<SearchPlacesFn>> {
  if (hasPlacesClientFallbackAttempted(key)) {
    logPlacesApiSkipDuplicate("client_fallback", { key });
    return {
      places: [],
      error: "places_client_fallback_already_attempted",
    };
  }

  markPlacesClientFallbackAttempted(key);

  const mapsKey = getGoogleMapsBrowserKey();
  logPlacesRequest("client", args.data, {
    key,
    hasBrowserKey: Boolean(mapsKey),
    keyPrefix: mapsKey ? mapsKey.slice(0, 8) : null,
  });

  if (!mapsKey) {
    markPlacesSearchFailed(key);
    const empty = normalizePlacesSearchResult({
      places: [],
      error: "無法取得附近推薦。請確認已設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY。",
    });
    logPlacesResponse("client", args.data, empty, { key, reason: "missing_browser_key" });
    return empty;
  }

  try {
    const clientResult = normalizePlacesSearchResult(
      await executeExploreSearch(args.data, { apiKey: mapsKey }),
    );
    logPlacesResponse("client", args.data, clientResult, { key });
    return clientResult;
  } catch (e) {
    markPlacesSearchFailed(key);
    const empty = normalizePlacesSearchResult({
      places: [],
      error: e instanceof Error ? e.message : String(e),
    });
    logPlacesResponse("client", args.data, empty, { key, threw: true });
    return empty;
  }
}

/**
 * TestFlight / 本機 bundle 沒有 TanStack server 時，改以瀏覽器 Google Places API 搜尋。
 * 首頁與 Explore 共用 dedupe / cache / failed TTL。
 */
export function createUnifiedSearchPlacesFn(serverFn: SearchPlacesFn): SearchPlacesFn {
  const preferClientOnly = isCapacitorNativeShell();

  return async (args) => {
    const key = buildPlacesSearchKey(args.data);

    return getPlacesSearchCachedOrRun(key, async () => {
      if (preferClientOnly) {
        return runClientSearch(args, key);
      }

      logPlacesRequest("server", args.data, { key });

      let serverResult = normalizePlacesSearchResult(undefined);

      try {
        serverResult = normalizePlacesSearchResult(await serverFn(args));
        logPlacesResponse("server", args.data, serverResult, { key });
        if (serverResult.places.length > 0) return serverResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        serverResult = { places: [], error: msg };
        logPlacesResponse("server", args.data, serverResult, { key, threw: true });
      }

      return runClientSearch(args, key);
    });
  };
}
