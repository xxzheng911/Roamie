import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { executeExploreSearch } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";

/**
 * TestFlight / 本機 bundle 沒有 TanStack server 時，改以瀏覽器 Google Places API 搜尋。
 */
export function createUnifiedSearchPlacesFn(serverFn: SearchPlacesFn): SearchPlacesFn {
  return async (args) => {
    try {
      const result = await serverFn(args);
      if (result.places.length > 0) return result;
      if (result.error) {
        console.warn("[Roamie Places] server search empty", {
          error: result.error,
          mode: args.data.mode,
          query: args.data.query,
        });
      }
    } catch (e) {
      console.warn("[Roamie Places] server search failed, trying client API", e);
    }

    const key = getGoogleMapsBrowserKey();
    if (!key) {
      return {
        places: [],
        error: "無法取得附近推薦。請確認已設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY。",
      };
    }

    return executeExploreSearch(args.data, { apiKey: key });
  };
}
