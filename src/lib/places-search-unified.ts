import { canReachBundledAppApiOrigin } from "@/lib/api-base-url";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import { executeExploreSearch } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import {
  isGooglePlacesIosAppBlockedError,
  shouldSkipPlacesClientRetry,
} from "@/lib/places-api-errors";

let placesSearchBlockedError: string | null = null;

function rememberPlacesSearchBlock(error: string | null | undefined): void {
  if (!error || !shouldSkipPlacesClientRetry(error)) return;
  if (!placesSearchBlockedError) {
    placesSearchBlockedError = error;
    if (isGooglePlacesIosAppBlockedError(error)) {
      console.warn(
        "[PLACES_API] ios_key_blocked=true — Places REST 需 GOOGLE_PLACES_SERVER_API_KEY（勿用僅 iOS 限制的金鑰）",
      );
    }
  }
}

/**
 * TestFlight / bundled：server 不可用時改 client Places；
 * 若金鑰為 iOS App 限制則不再重試（避免 403 洗版）。
 */
export function createUnifiedSearchPlacesFn(serverFn: SearchPlacesFn): SearchPlacesFn {
  const skipServerOnNative = typeof window !== "undefined" && !canReachBundledAppApiOrigin();

  return async (args) => {
    if (placesSearchBlockedError) {
      return { places: [], error: placesSearchBlockedError };
    }

    if (skipServerOnNative) {
      const key = getGoogleMapsBrowserKey();
      if (!key) {
        return {
          places: [],
          error:
            "無法取得附近推薦。請在 .env 設定 VITE_APP_ORIGIN（HTTPS 正式網域）與 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY 後重新 build。",
        };
      }
      const clientResult = await executeExploreSearch(args.data, { apiKey: key });
      if (clientResult.error) rememberPlacesSearchBlock(clientResult.error);
      return clientResult;
    }

    try {
      const result = await serverFn(args);
      if (result.places.length > 0) return result;
      if (result.error) {
        rememberPlacesSearchBlock(result.error);
        if (shouldSkipPlacesClientRetry(result.error)) {
          return result;
        }
        console.warn("[Roamie Places] server search empty", {
          error: result.error,
          mode: args.data.mode,
          query: args.data.query,
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

    const clientResult = await executeExploreSearch(args.data, { apiKey: key });
    if (clientResult.error) {
      rememberPlacesSearchBlock(clientResult.error);
    }
    return clientResult;
  };
}
