import type { LatLng, RouteApiResult } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { fetchHttp } from "@/lib/capacitor-http-fetch";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import {
  directionsLocationType,
  formatDirectionsLocation,
  resolveDirectionsRegion,
  type DirectionsLocationInput,
} from "@/lib/directions-endpoint";
import { logDirectionsDebug, shouldLogDirectionsDebug } from "@/lib/directions-debug-log";
import { logRouteOnce } from "@/lib/route-duration-log";
import {
  classifyRouteFailure,
  sanitizeRouteTelemetryText,
  type RouteApiFailureTelemetry,
} from "@/lib/route-failure-telemetry";

function debugDirectionsVerbose(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    const flag = String(import.meta.env.VITE_DEBUG_DIRECTIONS ?? import.meta.env.DEBUG_DIRECTIONS ?? "");
    if (flag === "true" || flag === "1") return true;
  }
  if (typeof process !== "undefined" && process.env?.DEBUG_DIRECTIONS === "true") return true;
  return false;
}

const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";
const FETCH_TIMEOUT_MS = 15_000;

type DirectionsLeg = {
  duration?: { text?: string; value?: number };
  distance?: { text?: string; value?: number };
};

type DirectionsResponse = {
  status?: string;
  error_message?: string;
  available_travel_modes?: string[];
  routes?: Array<{ legs?: DirectionsLeg[] }>;
};

function directionsFailureTelemetry(params: {
  httpStatus: number;
  httpOk: boolean;
  googleStatus: string;
  googleErrorMessage?: string;
  routesCount?: number;
  legsCount?: number;
  parserResult?: RouteApiFailureTelemetry["parserResult"];
  exception?: unknown;
}): RouteApiFailureTelemetry {
  const exceptionName =
    params.exception instanceof Error ? params.exception.name : params.exception ? "UnknownError" : "";
  const exceptionMessage =
    params.exception instanceof Error
      ? params.exception.message
      : params.exception
        ? String(params.exception)
        : "";
  const parserResult = params.parserResult ?? "parsed";
  return {
    endpoint: "directions_api",
    httpStatus: params.httpStatus,
    httpOk: params.httpOk,
    googleStatus: params.googleStatus,
    googleErrorMessage: sanitizeRouteTelemetryText(params.googleErrorMessage),
    routesCount: params.routesCount ?? 0,
    legsCount: params.legsCount ?? 0,
    parserResult,
    failureKind: classifyRouteFailure({
      httpStatus: params.httpStatus,
      httpOk: params.httpOk,
      googleStatus: params.googleStatus,
      routesCount: params.routesCount,
      legsCount: params.legsCount,
      parserResult,
      exceptionName,
    }),
    exceptionName,
    exceptionMessage: sanitizeRouteTelemetryText(exceptionMessage),
  };
}

export type DirectionsTravelMode = "transit" | "walking" | "driving" | "bicycling";

export type DirectionsQueryOptions = {
  region?: string;
  locationContext?: string;
  /** 送入 Directions API（place_id:…）並供 log */
  originPlaceId?: string;
  destinationPlaceId?: string;
  logLegKey?: string;
  /** approx_center / google_places / … — for [ROUTE_SUMMARY] */
  coordinateSource?: string;
};

function directionsModeForRoutesMode(mode: RoutesTravelMode): DirectionsTravelMode | null {
  if (mode === "TRANSIT") return "transit";
  if (mode === "WALK") return "walking";
  if (mode === "BICYCLE") return "bicycling";
  if (mode === "DRIVE" || mode === "TWO_WHEELER") return "driving";
  return null;
}

function sanitizeDirectionsUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]+/, "$1***");
}

function buildLocationInput(
  coords: LatLng,
  placeId?: string | null,
  placeName?: string | null,
  locationContext?: string | null,
): DirectionsLocationInput {
  return { coords, placeId, placeName, locationContext };
}

/** 過去時間改為 now，避免 Directions API 拒絕 */
export function resolveDirectionsDepartureUnixSeconds(departureTime?: string): number {
  const now = Math.floor(Date.now() / 1000);
  if (!departureTime) return now;
  const ms = Date.parse(departureTime);
  if (Number.isNaN(ms)) return now;
  const sec = Math.floor(ms / 1000);
  return sec >= now ? sec : now;
}

function sumLegDurations(legs: DirectionsLeg[]): {
  durationSeconds: number;
  durationText: string;
  distanceMeters: number;
} {
  let durationSeconds = 0;
  let distanceMeters = 0;
  const textParts: string[] = [];
  for (const leg of legs) {
    durationSeconds += leg.duration?.value ?? 0;
    distanceMeters += leg.distance?.value ?? 0;
    if (leg.duration?.text?.trim()) textParts.push(leg.duration.text.trim());
  }
  const durationText = textParts.length
    ? textParts.join(" + ")
    : `${Math.max(1, Math.round(durationSeconds / 60))} 分鐘`;
  return { durationSeconds, durationText, distanceMeters };
}

/**
 * Google Directions API（transit / walking / driving）。
 * 大眾運輸在台灣、日本等地區比 Routes API TRANSIT 更可靠。
 */
export async function fetchGoogleDirectionsRoute(
  apiKey: string,
  origin: DirectionsLocationInput,
  destination: DirectionsLocationInput,
  mode: DirectionsTravelMode,
  departureTime?: string,
  region?: string,
  logPlaceIds?: { originPlaceId?: string; destinationPlaceId?: string; logLegKey?: string },
): Promise<RouteApiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  const originStr = formatDirectionsLocation(origin);
  const destinationStr = formatDirectionsLocation(destination);
  if (!originStr || !destinationStr) {
    return {
      ok: false,
      statusCode: 0,
      message: "missing_origin_or_destination",
      googleStatus: "INVALID_REQUEST",
    };
  }

  const departureUnix = resolveDirectionsDepartureUnixSeconds(departureTime);
  const regionCode = region?.trim() || resolveDirectionsRegion(origin.locationContext ?? destination.locationContext);

  const url = new URL(DIRECTIONS_URL);
  url.searchParams.set("origin", originStr);
  url.searchParams.set("destination", destinationStr);
  url.searchParams.set("mode", mode);
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("region", regionCode);
  url.searchParams.set("key", apiKey);
  if (mode === "transit") {
    url.searchParams.set("departure_time", String(departureUnix));
  }

  const requestUrl = url.toString();
  const safeUrl = sanitizeDirectionsUrl(requestUrl);
  const logKey = `${originStr}>${destinationStr}|${mode}|${departureUnix}|${regionCode}`;
  const provider = isCapacitorNativeShell() ? "directions_api" : "directions_api";
  const originType = directionsLocationType(originStr);
  const destinationType = directionsLocationType(destinationStr);
  const verbose = debugDirectionsVerbose();

  if (verbose) {
    logDirectionsDebug("request start", {
      origin: originStr,
      destination: destinationStr,
      hasOrigin: true,
      hasDestination: true,
      mode,
      provider,
      legKey: logPlaceIds?.logLegKey,
    });
  }

  if (mode === "transit" && verbose) {
    console.info(
      `[TRANSIT_INPUT] origin=${originStr} destination=${destinationStr} originType=${originType} destinationType=${destinationType} placeId=origin:${logPlaceIds?.originPlaceId ?? origin.placeId ?? "none"} destination:${logPlaceIds?.destinationPlaceId ?? destination.placeId ?? "none"}`,
    );
  }

  if (verbose) {
    logRouteOnce(
      logKey,
      `[DIRECTIONS_API_REQUEST] url=${safeUrl} origin=${originStr} destination=${destinationStr} mode=${mode} region=${regionCode} departure_time=${mode === "transit" ? departureUnix : "n/a"} departure_iso=${departureTime ?? "now"} transport=${isCapacitorNativeShell() ? "capacitor_http" : "fetch"}`,
    );
  }

  try {
    const res = await fetchHttp(requestUrl, { signal: ctrl.signal });
    let json: DirectionsResponse;
    try {
      json = await res.json<DirectionsResponse>();
    } catch (parseError) {
      const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
      return {
        ok: false,
        statusCode: res.status,
        message: parseMessage,
        googleStatus: "UNKNOWN",
        failureTelemetry: directionsFailureTelemetry({
          httpStatus: res.status,
          httpOk: res.ok,
          googleStatus: "UNKNOWN",
          parserResult: "parse_error",
          exception: parseError,
        }),
      };
    }
    const bodyStatus = json.status ?? (res.ok ? "UNKNOWN" : String(res.status));
    const errorMessage = json.error_message ?? "";
    const routesCount = json.routes?.length ?? 0;
    const legsCount = json.routes?.[0]?.legs?.length ?? 0;

    const availableModes = json.available_travel_modes?.join(",") ?? "";

    if (verbose) {
      logRouteOnce(
        `${logKey}|resp`,
        `[DIRECTIONS_API_RESPONSE] http_status=${res.status} body_status=${bodyStatus} error_message=${errorMessage || "none"} available_travel_modes=${availableModes || "n/a"} origin=${originStr} destination=${destinationStr} mode=${mode}`,
      );
    }

    if (bodyStatus !== "OK" || !json.routes?.[0]) {
      if (mode === "transit") {
        console.info(
          `[TRANSIT_RESULT] status=${bodyStatus} durationMinutes=0 error=${errorMessage || bodyStatus}`,
        );
        if (bodyStatus === "ZERO_RESULTS" && verbose) {
          console.warn(
            `[TRANSIT_ZERO_RESULTS] leg=${logPlaceIds?.logLegKey ?? "n/a"} origin=${originStr} destination=${destinationStr} departureISO=${departureTime ?? "now"} departureUnix=${departureUnix} available_travel_modes=${availableModes || "n/a"} region=${regionCode}`,
          );
        }
      }
      // Per-mode failures are summarized at [ROUTE_SUMMARY] — avoid Xcode spam.
      if (verbose) {
        logDirectionsDebug("request failed", {
          origin: originStr,
          destination: destinationStr,
          mode,
          provider,
          error: errorMessage || bodyStatus,
          legKey: logPlaceIds?.logLegKey,
        });
      }
      if (mode === "transit") {
        logRouteOnce(
          `${logKey}|transit_err`,
          `[ROUTE_TRANSIT_ERROR] status=${bodyStatus} message=${errorMessage || bodyStatus} available_travel_modes=${availableModes || "n/a"}`,
        );
      }
      return {
        ok: false,
        statusCode: res.status,
        message: errorMessage || bodyStatus,
        googleStatus: bodyStatus,
        availableTravelModes: json.available_travel_modes,
        failureTelemetry: directionsFailureTelemetry({
          httpStatus: res.status,
          httpOk: res.ok,
          googleStatus: bodyStatus,
          googleErrorMessage: errorMessage,
          routesCount,
          legsCount,
        }),
      };
    }

    const legs = json.routes[0].legs ?? [];
    const { durationSeconds, durationText, distanceMeters } = sumLegDurations(legs);
    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const routesMode: RoutesTravelMode =
      mode === "transit"
        ? "TRANSIT"
        : mode === "driving"
          ? "DRIVE"
          : mode === "bicycling"
            ? "BICYCLE"
            : "WALK";

    if (mode === "transit") {
      console.info(
        `[TRANSIT_RESULT] status=OK durationMinutes=${durationMinutes} error=none`,
      );
      logRouteOnce(
        `${logKey}|ok`,
        `[ROUTE_TRANSIT_SUCCESS] durationText=${durationText} durationMinutes=${durationMinutes}`,
      );
    }

    if (verbose) {
      logDirectionsDebug("request success", {
        origin: originStr,
        destination: destinationStr,
        mode,
        provider,
        durationMinutes,
        legKey: logPlaceIds?.logLegKey,
      });
    }

    return {
      ok: true,
      data: {
        durationSeconds,
        durationMinutes,
        distanceMeters,
        travelMode: routesMode,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (debugDirectionsVerbose()) {
      logDirectionsDebug("request failed", {
        origin: originStr,
        destination: destinationStr,
        mode,
        provider,
        error: msg,
        legKey: logPlaceIds?.logLegKey,
      });
      logRouteOnce(
        `${logKey}|exception`,
        `[DIRECTIONS_API_RESPONSE] http_status=0 body_status=exception error_message=${msg}`,
      );
    }
    if (mode === "transit") {
      console.info(`[ROUTE_TRANSIT_ERROR] status=exception message=${msg}`);
    }
    return {
      ok: false,
      statusCode: 0,
      message: msg,
      googleStatus: "exception",
      failureTelemetry: directionsFailureTelemetry({
        httpStatus: 0,
        httpOk: false,
        googleStatus: "exception",
        exception: e,
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGoogleDirectionsForRoutesMode(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  departureTime?: string,
  options?: DirectionsQueryOptions,
): Promise<RouteApiResult | null> {
  const mode = directionsModeForRoutesMode(travelMode);
  if (!mode) return null;

  const originInput = buildLocationInput(
    origin,
    options?.originPlaceId,
    undefined,
    options?.locationContext,
  );
  const destinationInput = buildLocationInput(
    destination,
    options?.destinationPlaceId,
    undefined,
    options?.locationContext,
  );

  return fetchGoogleDirectionsRoute(
    apiKey,
    originInput,
    destinationInput,
    mode,
    departureTime,
    options?.region,
    {
      originPlaceId: options?.originPlaceId,
      destinationPlaceId: options?.destinationPlaceId,
      logLegKey: options?.logLegKey,
    },
  );
}

/** @deprecated 使用 fetchGoogleDirectionsRoute(..., "transit", ...) */
export async function fetchGoogleDirectionsTransit(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  departureTime?: string,
): Promise<RouteApiResult> {
  return fetchGoogleDirectionsRoute(
    apiKey,
    { coords: origin },
    { coords: destination },
    "transit",
    departureTime,
  );
}
