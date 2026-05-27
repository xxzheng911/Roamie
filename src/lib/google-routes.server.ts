import { requireGoogleMapsServerKey } from "@/lib/google-maps-key-resolve.server";
import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import { createServerRequestCache } from "@/lib/server-request-cache";
import type { LegDurationEstimate, RouteResult, RoutesTravelMode } from "@/lib/routes/types";

export type LatLng = { lat: number; lng: number };

export type RoutesApiError = {
  ok: false;
  statusCode: number;
  message: string;
  hint?: string;
};

export type RoutesApiSuccess<T> = { ok: true; data: T };

export type RouteApiResult = RoutesApiSuccess<RouteResult> | RoutesApiError;

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FETCH_TIMEOUT_MS = 15_000;

const REQUEST_DENIED_HINT = [
  "可能原因：",
  "· Routes API 尚未在 Google Cloud Console 啟用",
  "· Places API 尚未啟用",
  "· API key 的「API 限制」未包含 Routes API / Places API",
  "· API restriction 未允許此 app、bundle ID 或 referrer",
  "· 專案尚未開啟計費（Billing）",
  "· App 未正確讀取 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY（請 sync:env 並重啟 dev）",
].join("\n");

const routeServerCache = createServerRequestCache(API_CACHE_TTL_MS.routes);

function requireRoutesApiKey(): string {
  return requireGoogleMapsServerKey();
}

function parseDurationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
  if (!m) return null;
  return Math.round(Number(m[1]));
}

function routesDeniedHint(bodyText: string): string | undefined {
  if (/REQUEST_DENIED|PERMISSION_DENIED|API key not valid/i.test(bodyText)) {
    return REQUEST_DENIED_HINT;
  }
  return undefined;
}

function routeCacheKey(origin: LatLng, destination: LatLng, travelMode: RoutesTravelMode): string {
  return `${origin.lat.toFixed(4)}:${origin.lng.toFixed(4)}:${destination.lat.toFixed(4)}:${destination.lng.toFixed(4)}:${travelMode}`;
}

async function computeRouteRaw(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<RoutesApiSuccess<RouteResult> | RoutesApiError> {
  return routeServerCache.getOrFetch(
    routeCacheKey(origin, destination, travelMode),
    () => computeRouteRawUncached(origin, destination, travelMode),
    (result) => result.ok,
  );
}

async function computeRouteRawUncached(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<RoutesApiSuccess<RouteResult> | RoutesApiError> {
  const apiKey = requireRoutesApiKey();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.legs.staticDuration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: {
          location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
        },
        travelMode,
        languageCode: "zh-TW",
        units: "METRIC",
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        message: text.slice(0, 300) || res.statusText,
        hint: routesDeniedHint(text),
      };
    }

    const json = JSON.parse(text) as {
      routes?: Array<{
        duration?: string;
        distanceMeters?: number;
        legs?: Array<{ staticDuration?: string }>;
      }>;
    };

    const route = json.routes?.[0];
    if (!route) {
      return { ok: false, statusCode: res.status, message: "Routes API 沒有回傳路線" };
    }

    const durationSeconds =
      parseDurationSeconds(route.duration) ??
      parseDurationSeconds(route.legs?.[0]?.staticDuration) ??
      0;

    return {
      ok: true,
      data: {
        durationSeconds,
        durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
        distanceMeters: route.distanceMeters ?? 0,
        travelMode,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, statusCode: 0, message: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function getRouteDuration(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<RoutesApiSuccess<RouteResult> | RoutesApiError> {
  return computeRouteRaw(origin, destination, travelMode);
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
export async function testRoutesApiConnection(): Promise<
  RoutesApiSuccess<RouteResult> | RoutesApiError
> {
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
        console.warn("[Routes API] leg mode failed", routesMode, result.message);
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
