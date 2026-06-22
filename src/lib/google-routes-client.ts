import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { logRouteOnce } from "@/lib/route-duration-log";
import {
  fetchGoogleRoute,
  type DirectionsQueryOptions,
  type LatLng,
  type RouteApiResult,
} from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";

/** Capacitor / bundled WebView：以瀏覽器 API key 直接呼叫 Routes API */
export async function computeRouteFromClient(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
  queryOptions?: DirectionsQueryOptions,
): Promise<RouteApiResult> {
  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) {
    console.warn(
      `[ROUTE_DURATION_ERROR] status=missing_api_key message=${"尚未設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"}`,
    );
    return {
      ok: false,
      statusCode: 0,
      message: "missing_browser_api_key",
      hint: "請在 .env 設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY 並執行 npm run sync:env",
    };
  }
  logRouteOnce(
    `client|${travelMode}|${apiKey.slice(0, 8)}`,
    `[ROUTE_DURATION_CLIENT] mode=${travelMode} hasApiKey=true native=${typeof window !== "undefined" && Boolean((window as Window & { Capacitor?: unknown }).Capacitor)}`,
  );
  return fetchGoogleRoute(apiKey, origin, destination, travelMode, departureTime, queryOptions);
}
