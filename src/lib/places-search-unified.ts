import { canReachBundledAppApiOrigin } from "@/lib/api-base-url";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { executeExploreSearch } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import {
  isGooglePlacesIosAppBlockedError,
  shouldSkipPlacesClientRetry,
} from "@/lib/places-api-errors";
import { getCachedExploreSearch } from "@/lib/places-explore-cache";
import { searchPlacesViaBundledApi } from "@/lib/places-search-api";
import { detectPlatform } from "@/services/platform";

let placesSearchBlockedError: string | null = null;

function rememberPlacesSearchBlock(error: string | null | undefined): void {
  if (!error || !shouldSkipPlacesClientRetry(error)) return;
  if (!placesSearchBlockedError) {
    placesSearchBlockedError = error;
    if (isGooglePlacesIosAppBlockedError(error)) {
      console.warn(
        "[PLACES_API] ios_key_blocked=true — 請經 /api/places-search 使用 GOOGLE_PLACES_SERVER_API_KEY",
      );
    }
  }
}

function shouldUseBundledPlacesHttp(): boolean {
  if (typeof window === "undefined") return false;
  if (!canReachBundledAppApiOrigin()) return false;
  const platform = detectPlatform();
  return (
    platform.isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

/**
 * Web：TanStack serverFn → 必要時 client Places。
 * TestFlight / Capacitor：僅 POST https://roamie.tw/api/places-search（server 金鑰），
 * 不再用 VITE_GOOGLE_MAPS_API_KEY 從 WebView 直連 Google（會 403 iOS client empty）。
 */
export function createUnifiedSearchPlacesFn(serverFn: SearchPlacesFn): SearchPlacesFn {
  const useBundledHttp = shouldUseBundledPlacesHttp();

  const fetchUncached = async (data: Parameters<SearchPlacesFn>[0]["data"]) => {
    if (placesSearchBlockedError) {
      return { places: [], error: placesSearchBlockedError };
    }

    if (useBundledHttp) {
      const httpResult = await searchPlacesViaBundledApi(data);
      if (httpResult.error) rememberPlacesSearchBlock(httpResult.error);
      console.info("[PLACES_API] bundled_http", {
        count: httpResult.places.length,
        error: httpResult.error,
      });
      return httpResult;
    }

    const skipServerOnNative = typeof window !== "undefined" && !canReachBundledAppApiOrigin();

    if (skipServerOnNative) {
      const key = getGoogleMapsBrowserKey();
      if (!key) {
        return {
          places: [],
          error:
            "無法取得附近推薦。請在 .env 設定 VITE_APP_ORIGIN（HTTPS 正式網域）與 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY 後重新 build。",
        };
      }
      const clientResult = await executeExploreSearch(data, { apiKey: key });
      if (clientResult.error) rememberPlacesSearchBlock(clientResult.error);
      return clientResult;
    }

    try {
      const result = await serverFn({ data });
      if (result.places.length > 0) return result;
      if (result.error) {
        rememberPlacesSearchBlock(result.error);
        if (shouldSkipPlacesClientRetry(result.error)) {
          return result;
        }
        console.warn("[Roamie Places] server search empty", {
          error: result.error,
          mode: data.mode,
          query: data.query,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rememberPlacesSearchBlock(msg);
      if (shouldSkipPlacesClientRetry(msg)) {
        return { places: [], error: msg };
      }
      console.warn("[Roamie Places] server search failed, trying client API", e);
    }

    const key = getGoogleMapsBrowserKey();
    if (!key) {
      return {
        places: [],
        error: "無法取得附近推薦。請確認已設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY。",
      };
    }

    const clientResult = await executeExploreSearch(data, { apiKey: key });
    if (clientResult.error) {
      rememberPlacesSearchBlock(clientResult.error);
    }
    return clientResult;
  };

  return async (args) => {
    if (placesSearchBlockedError) {
      return { places: [], error: placesSearchBlockedError };
    }

    return getCachedExploreSearch(args.data, () => fetchUncached(args.data));
  };
}
