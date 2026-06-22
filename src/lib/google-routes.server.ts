import { requireGoogleMapsServerKey } from "@/lib/google-maps-key-resolve.server";
import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import { createServerRequestCache } from "@/lib/server-request-cache";
import {
  fetchGoogleRoute,
  ROUTES_REQUEST_DENIED_HINT,
  type LatLng,
  type RouteApiResult,
  type RoutesApiError,
  type RoutesApiSuccess,
} from "@/lib/google-routes-fetch";
import type { LegDurationEstimate, RouteResult, RoutesTravelMode } from "@/lib/routes/types";

export type { LatLng, RoutesApiError, RoutesApiSuccess, RouteApiResult };

const routeServerCache = createServerRequestCache(API_CACHE_TTL_MS.routes);

function routeCacheKey(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
): string {
  const dep =
    travelMode === "TRANSIT" && departureTime
      ? departureTime.slice(0, 19)
      : "";
  return `${origin.lat.toFixed(4)}:${origin.lng.toFixed(4)}:${destination.lat.toFixed(4)}:${destination.lng.toFixed(4)}:${travelMode}:${dep}`;
}

async function computeRouteRaw(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
): Promise<RouteApiResult> {
  return routeServerCache.getOrFetch(
    routeCacheKey(origin, destination, travelMode, departureTime),
    () => {
      const apiKey = requireGoogleMapsServerKey();
      return fetchGoogleRoute(apiKey, origin, destination, travelMode, departureTime);
    },
    (result) => result.ok,
  );
}

export async function getRouteDuration(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
): Promise<RoutesApiSuccess<RouteResult> | RoutesApiError> {
  return computeRouteRaw(origin, destination, travelMode, departureTime);
}

export async function getRouteDistance(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<RoutesApiSuccess<{ distanceMeters: number }> | RoutesApiError> {
  const result = await computeRouteRaw(origin, destination, travelMode);
  if (!result.ok) return result;
  return { ok: true, data: { distanceMeters: result.data.distanceMeters } };
}

export type TripLegRoute = {
  from: LatLng;
  to: LatLng;
  travelMode: RoutesTravelMode;
  durationMinutes: number;
  distanceMeters: number;
};

export async function getTripLegsWithDurations(
  places: LatLng[],
  travelMode: RoutesTravelMode,
): Promise<RoutesApiSuccess<TripLegRoute[]> | RoutesApiError> {
  if (places.length < 2) {
    return { ok: true, data: [] };
  }

  const legs: TripLegRoute[] = [];
  for (let i = 0; i < places.length - 1; i++) {
    const from = places[i]!;
    const to = places[i + 1]!;
    const result = await computeRouteRaw(from, to, travelMode);
    if (!result.ok) return result;
    legs.push({
      from,
      to,
      travelMode,
      durationMinutes: result.data.durationMinutes,
      distanceMeters: result.data.distanceMeters,
    });
  }
  return { ok: true, data: legs };
}

/** 高雄車站 → 駁二藝術特區（步行）連線測試 */
export async function testRoutesApiConnection(): Promise<RouteApiResult> {
  const origin = { lat: 22.687, lng: 120.3075 };
  const destination = { lat: 22.6194, lng: 120.2826 };
  return computeRouteRaw(origin, destination, "WALK");
}

export function mapTravelModeToRoutes(mode: "walking" | "driving" | "transit"): RoutesTravelMode {
  switch (mode) {
    case "walking":
      return "WALK";
    case "driving":
      return "DRIVE";
    case "transit":
      return "TRANSIT";
    default:
      return "WALK";
  }
}

/** 單段：依 Routes API 取得 walk / drive / transit 估算（取代 Distance Matrix） */
export async function fetchLegDurationsFromRoutes(
  origin: LatLng,
  destination: LatLng,
): Promise<LegDurationEstimate> {
  const modes: Array<["walking" | "driving" | "transit", RoutesTravelMode]> = [
    ["walking", "WALK"],
    ["driving", "DRIVE"],
    ["transit", "TRANSIT"],
  ];

  const out: LegDurationEstimate = { distanceMeters: 0 };

  await Promise.all(
    modes.map(async ([matrixMode, routesMode]) => {
      const result = await computeRouteRaw(origin, destination, routesMode);
      if (!result.ok) {
        return;
      }
      const minutes = result.data.durationMinutes;
      if (matrixMode === "walking") out.walk = minutes;
      if (matrixMode === "driving") out.drive = minutes;
      if (matrixMode === "transit") out.transit = minutes;
      out.distanceMeters = Math.max(out.distanceMeters, result.data.distanceMeters);
    }),
  );

  if (out.distanceMeters === 0) {
    out.distanceMeters = haversineMeters(origin, destination);
  }

  return out;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

export { ROUTES_REQUEST_DENIED_HINT };
