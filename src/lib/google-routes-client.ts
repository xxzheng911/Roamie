import { getGoogleRestTransportToken } from "@/lib/google-rest-transport";
import { logRouteOnce } from "@/lib/route-duration-log";
import {
  fetchGoogleRoute,
  type DirectionsQueryOptions,
  type LatLng,
  type RouteApiResult,
} from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";

/** Capacitor / bundled WebView：經 authenticated proxy 呼叫 Routes / Directions */
export async function computeRouteFromClient(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
  queryOptions?: DirectionsQueryOptions,
): Promise<RouteApiResult> {
  const apiKey = getGoogleRestTransportToken();
  logRouteOnce(
    `client-proxy|${travelMode}`,
    `[ROUTE_DURATION_CLIENT] mode=${travelMode} transport=authenticated_proxy native=${typeof window !== "undefined" && Boolean((window as Window & { Capacitor?: unknown }).Capacitor)}`,
  );
  return fetchGoogleRoute(apiKey, origin, destination, travelMode, departureTime, queryOptions);
}
