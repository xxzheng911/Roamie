import type { RouteResult, RoutesTravelMode } from "@/lib/routes/types";
import {
  fetchGoogleDirectionsForRoutesMode,
  type DirectionsQueryOptions,
} from "@/lib/google-directions-fetch";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

export type LatLng = { lat: number; lng: number };

export type { DirectionsQueryOptions };

export type RoutesApiError = {
  ok: false;
  statusCode: number;
  message: string;
  hint?: string;
  googleStatus?: string;
  availableTravelModes?: string[];
};

export type RoutesApiSuccess<T> = { ok: true; data: T };

export type RouteApiResult = RoutesApiSuccess<RouteResult> | RoutesApiError;

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FETCH_TIMEOUT_MS = 15_000;

export const ROUTES_REQUEST_DENIED_HINT = [
  "可能原因：",
  "· Routes API 尚未在 Google Cloud Console 啟用",
  "· API key 的「API 限制」未包含 Routes API",
  "· API restriction 未允許此 app、bundle ID 或 referrer",
  "· 專案尚未開啟計費（Billing）",
  "· App 未正確讀取 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY（請 sync:env 並重啟）",
].join("\n");

function parseDurationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
  if (!m) return null;
  return Math.round(Number(m[1]));
}

function routesDeniedHint(bodyText: string): string | undefined {
  if (/REQUEST_DENIED|PERMISSION_DENIED|API key not valid/i.test(bodyText)) {
    return ROUTES_REQUEST_DENIED_HINT;
  }
  return undefined;
}

export function extractGoogleRouteStatus(
  text: string,
  json?: { error?: { status?: string; message?: string } },
): string {
  if (json?.error?.status) return json.error.status;
  try {
    const parsed = JSON.parse(text) as { error?: { status?: string } };
    if (parsed.error?.status) return parsed.error.status;
  } catch {
    /* ignore */
  }
  if (/OVER_QUERY_LIMIT/i.test(text)) return "OVER_QUERY_LIMIT";
  if (/ZERO_RESULTS/i.test(text)) return "ZERO_RESULTS";
  if (/INVALID_REQUEST/i.test(text)) return "INVALID_REQUEST";
  if (/REQUEST_DENIED|PERMISSION_DENIED/i.test(text)) return "REQUEST_DENIED";
  if (/load failed|network error|failed to fetch|aborted|timeout/i.test(text)) return "NETWORK_ERROR";
  return "UNKNOWN";
}

function formatDistanceText(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function logRouteResponse(
  googleStatus: string,
  durationMinutes: number | null,
  distanceMeters: number | null,
  travelMode: RoutesTravelMode,
): void {
  const durationText = durationMinutes != null ? `${durationMinutes}min` : "";
  const distanceText = distanceMeters != null ? formatDistanceText(distanceMeters) : "";
  console.info(
    `[ROUTE_DURATION_RESPONSE] status=${googleStatus} durationText=${durationText} distanceText=${distanceText} mode=${travelMode}`,
  );
}

/** 直接呼叫 Google Routes computeRoutes（browser 或 server 共用） */
export async function fetchGoogleRoute(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
  queryOptions?: DirectionsQueryOptions,
): Promise<RouteApiResult> {
  // Capacitor 與 TRANSIT 一律走 Directions API（單一 provider，避免重複請求）
  if (isCapacitorNativeShell() || travelMode === "TRANSIT") {
    const directions = await fetchGoogleDirectionsForRoutesMode(
      apiKey,
      origin,
      destination,
      travelMode,
      departureTime,
      queryOptions,
    );
    return (
      directions ?? {
        ok: false,
        statusCode: 0,
        message: "directions_unavailable",
        googleStatus: "UNAVAILABLE",
      }
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  const requestBody: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: {
      location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
    },
    travelMode,
    languageCode: "zh-TW",
    units: "METRIC",
  };

  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.legs.staticDuration",
      },
      body: JSON.stringify(requestBody),
    });

    const text = await res.text();
    let json: {
      routes?: Array<{
        duration?: string;
        distanceMeters?: number;
        legs?: Array<{ staticDuration?: string }>;
      }>;
      error?: { code?: number; message?: string; status?: string };
    } = {};

    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      /* non-json body */
    }

    const googleStatus = extractGoogleRouteStatus(text, json);

    if (!res.ok) {
      logRouteResponse(googleStatus, null, null, travelMode);
      console.warn(
        `[ROUTE_DURATION_ERROR] status=${googleStatus} message=${text.slice(0, 300) || res.statusText}`,
      );
      return {
        ok: false,
        statusCode: res.status,
        message: text.slice(0, 300) || res.statusText,
        hint: routesDeniedHint(text),
        googleStatus,
      };
    }

    if (json.error?.status) {
      const msg = json.error.message ?? json.error.status;
      logRouteResponse(googleStatus, null, null, travelMode);
      console.warn(`[ROUTE_DURATION_ERROR] status=${googleStatus} message=${msg}`);
      return {
        ok: false,
        statusCode: res.status,
        message: msg,
        hint: routesDeniedHint(text),
        googleStatus,
      };
    }

    const route = json.routes?.[0];
    if (!route) {
      logRouteResponse("ZERO_RESULTS", null, null, travelMode);
      // Soft: no path for this mode — caller may fall back; not a hard failure.
      console.info(
        `[ROUTE_DURATION] status=ZERO_RESULTS message=no_routes mode=${travelMode} soft=true`,
      );
      return {
        ok: false,
        statusCode: res.status,
        message: "ZERO_RESULTS",
        googleStatus: "ZERO_RESULTS",
      };
    }

    const durationSeconds =
      parseDurationSeconds(route.duration) ??
      parseDurationSeconds(route.legs?.[0]?.staticDuration) ??
      0;

    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const distanceMeters = route.distanceMeters ?? 0;

    logRouteResponse("OK", durationMinutes, distanceMeters, travelMode);

    return {
      ok: true,
      data: {
        durationSeconds,
        durationMinutes,
        distanceMeters,
        travelMode,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logRouteResponse("exception", null, null, travelMode);
    console.warn(`[ROUTE_DURATION_ERROR] status=exception message=${msg}`);
    return { ok: false, statusCode: 0, message: msg, googleStatus: "exception" };
  } finally {
    clearTimeout(timer);
  }
}
