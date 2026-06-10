import type { SearchPlacesFn } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";
import { executeExploreSearch } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import {
  buildPlacesSearchKey,
  getPlacesSearchCachedOrRun,
  hasPlacesClientFallbackAttempted,
  markPlacesClientFallbackAttempted,
  markPlacesSearchFailed,
} from "@/lib/places-search-dedupe";
import { logPlacesRequest, logPlacesResponse } from "@/lib/places-diagnostics";

/**
 * TestFlight / 本機 bundle 沒有 TanStack server 時，改以瀏覽器 Google Places API 搜尋。
 * 首頁與 Explore 共用 dedupe / cache / failed TTL。
 */
export function createUnifiedSearchPlacesFn(serverFn: SearchPlacesFn): SearchPlacesFn {
  return async (args) => {
    const key = buildPlacesSearchKey(args.data);

    return getPlacesSearchCachedOrRun(key, async () => {
      let serverResult: { places: PlaceResult[]; error: string | null } = {
        places: [],
        error: null,
      };

      logPlacesRequest("server", args.data, { key });

      try {
        serverResult = await serverFn(args);
        logPlacesResponse("server", args.data, serverResult, { key });
        if (serverResult.places.length > 0) return serverResult;
        if (serverResult.error) {
          console.warn("[Roamie Places] server search empty", {
            error: serverResult.error,
            mode: args.data.mode,
            query: args.data.query,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logPlacesResponse("server", args.data, { places: [], error: msg }, { key, threw: true });
        console.warn("[Roamie Places] server search failed, trying client API", e);
      }

      if (hasPlacesClientFallbackAttempted(key)) {
        console.info("[PLACES_SEARCH_SKIP_CLIENT_FALLBACK]", { key });
        return {
          places: [],
          error: serverResult.error ?? "places_client_fallback_already_attempted",
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
        const empty = {
          places: [],
          error: "無法取得附近推薦。請確認已設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY。",
        };
        logPlacesResponse("client", args.data, empty, { key, reason: "missing_browser_key" });
        return empty;
      }

      try {
        const clientResult = await executeExploreSearch(args.data, { apiKey: mapsKey });
        logPlacesResponse("client", args.data, clientResult, { key });
        return clientResult;
      } catch (e) {
        markPlacesSearchFailed(key);
        const empty = {
          places: [],
          error: e instanceof Error ? e.message : String(e),
        };
        logPlacesResponse("client", args.data, empty, { key, threw: true });
        return empty;
      }
    });
  };
}
