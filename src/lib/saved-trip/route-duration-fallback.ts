import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { distanceMeters } from "@/lib/geo-distance";
import { logRouteOnce, warnRouteOnce } from "@/lib/route-duration-log";
import type { RouteLegDurationResult, RouteLegScope } from "@/lib/saved-trip/route-duration-types";
import {
  resolveRouteRegionProfile,
  type RouteRegionProfile,
} from "@/lib/saved-trip/stop-navigation";
import {
  fetchRouteResult,
  type FetchRouteQueryOptions,
  type RoutesFnResult,
} from "@/services/routesService";
import { displayTransportLabel } from "@/lib/saved-trip/leg-transport-sot";
import {
  directionsLocationType,
  formatDirectionsLocation,
} from "@/lib/directions-endpoint";
import {
  maskRoutePlaceId,
  sanitizeRouteTelemetryText,
  type RouteApiFailureTelemetry,
} from "@/lib/route-failure-telemetry";

/**
 * Shared Directions distance thresholds (single source of truth).
 * Do not scatter walk/drive cutoffs across UI components.
 */

/** Soft: default「步行」preference auto-upgrades above this (city block scale). */
export const AUTO_WALK_MAX_METERS = 1_500;

/** Hard: never request walking Directions above this. */
export const MAX_WALK_DIRECTIONS_METERS = 15_000;

/** Hard: never request bicycling Directions above this. */
export const MAX_BICYCLE_DIRECTIONS_METERS = 25_000;

/** Prefer drive when straight-line exceeds this even if user left default walk. */
export const CROSS_AREA_DRIVE_MIN_METERS = 3_000;

export type RouteFetchContext = {
  scope: RouteLegScope;
  origin: LatLng;
  destination: LatLng;
  query: FetchRouteQueryOptions;
  cacheKey: string;
};

function googleStatus(result: RoutesFnResult): string {
  if (result.ok) return "OK";
  return result.googleStatus ?? result.message ?? "UNKNOWN";
}

function fallbackFailureTelemetry(result: RoutesFnResult): RouteApiFailureTelemetry {
  if (!result.ok && result.failureTelemetry) return result.failureTelemetry;
  const status = googleStatus(result);
  return {
    endpoint: "unknown",
    httpStatus: result.ok ? 200 : result.statusCode,
    httpOk: result.ok,
    googleStatus: status,
    googleErrorMessage: result.ok ? "" : sanitizeRouteTelemetryText(result.message),
    routesCount: 0,
    legsCount: 0,
    parserResult: "parsed",
    failureKind: "unknown",
    exceptionName: "",
    exceptionMessage: "",
  };
}

function logFailedRouteAttempt(params: {
  ctx: RouteFetchContext;
  requestedMode: RoutesTravelMode;
  attemptedMode: RoutesTravelMode;
  allowModeFallback: boolean;
  originName?: string;
  destinationName?: string;
  telemetry: RouteApiFailureTelemetry;
}): void {
  const originFormatted = formatDirectionsLocation({
    coords: params.ctx.origin,
    placeId: params.ctx.query.originPlaceId,
  });
  const destinationFormatted = formatDirectionsLocation({
    coords: params.ctx.destination,
    placeId: params.ctx.query.destinationPlaceId,
  });
  const attemptKey = `${params.ctx.cacheKey}|${params.attemptedMode}`;
  warnRouteOnce(
    `request_detail|${attemptKey}`,
    [
      "[ROUTE_REQUEST_DETAIL]",
      `legKey=${params.ctx.scope.legKey}`,
      `originName=${params.originName ?? "n/a"}`,
      `destinationName=${params.destinationName ?? "n/a"}`,
      `requestedMode=${params.requestedMode}`,
      `attemptedMode=${params.attemptedMode}`,
      `allowFallback=${params.allowModeFallback}`,
      `endpoint=${params.telemetry.endpoint}`,
      `originKind=${directionsLocationType(originFormatted) === "latlng" ? "coordinates" : directionsLocationType(originFormatted)}`,
      `destinationKind=${directionsLocationType(destinationFormatted) === "latlng" ? "coordinates" : directionsLocationType(destinationFormatted)}`,
      `originPlaceIdMasked=${maskRoutePlaceId(params.ctx.query.originPlaceId)}`,
      `destinationPlaceIdMasked=${maskRoutePlaceId(params.ctx.query.destinationPlaceId)}`,
      `originLat=${params.ctx.origin.lat}`,
      `originLng=${params.ctx.origin.lng}`,
      `destinationLat=${params.ctx.destination.lat}`,
      `destinationLng=${params.ctx.destination.lng}`,
      `coordinateSource=${params.ctx.query.coordinateSource ?? "unknown"}`,
      `region=${params.ctx.query.region ?? "auto"}`,
      "language=zh-TW",
    ].join(" "),
  );
  warnRouteOnce(
    `raw_status|${attemptKey}`,
    [
      "[ROUTE_API_RAW_STATUS]",
      `legKey=${params.ctx.scope.legKey}`,
      `attemptedMode=${params.attemptedMode}`,
      `httpStatus=${params.telemetry.httpStatus}`,
      `httpOk=${params.telemetry.httpOk}`,
      `googleStatus=${params.telemetry.googleStatus}`,
      `googleErrorMessage=${params.telemetry.googleErrorMessage || "none"}`,
      `routesCount=${params.telemetry.routesCount}`,
      `legsCount=${params.telemetry.legsCount}`,
      `parserResult=${params.telemetry.parserResult}`,
      `failureKind=${params.telemetry.failureKind}`,
      `exceptionName=${params.telemetry.exceptionName || "none"}`,
      `exceptionMessage=${params.telemetry.exceptionMessage || "none"}`,
    ].join(" "),
  );
}

function estimatesForMode(
  minutes: number,
  mode: RoutesTravelMode,
  distanceMetersValue: number,
) {
  return {
    distanceMeters: distanceMetersValue,
    walk: mode === "WALK" || mode === "BICYCLE" ? minutes : undefined,
    drive: mode === "DRIVE" || mode === "TWO_WHEELER" ? minutes : undefined,
    transit: mode === "TRANSIT" ? minutes : undefined,
  };
}

function fallbackReasonFor(
  preferredMode: RoutesTravelMode,
  resolvedMode: RoutesTravelMode,
): string | null {
  if (preferredMode === resolvedMode) return null;
  if (preferredMode === "WALK" && resolvedMode === "DRIVE") {
    return "walking_distance_or_zero_results_fallback";
  }
  if (preferredMode === "WALK" && resolvedMode === "TRANSIT") {
    return "walking_zero_results_fallback_transit";
  }
  if (preferredMode === "DRIVE" && resolvedMode === "TRANSIT") {
    return "driving_zero_results_fallback_transit";
  }
  return `${String(preferredMode).toLowerCase()}_fallback_${String(resolvedMode).toLowerCase()}`;
}

function toSuccessResult(
  result: RoutesFnResult & { ok: true },
  preferredMode: RoutesTravelMode,
  resolvedMode: RoutesTravelMode,
  reasonOverride?: string | null,
): RouteLegDurationResult {
  const usedEstimatedFallback = resolvedMode !== preferredMode;
  const fallbackReason =
    reasonOverride !== undefined
      ? reasonOverride
      : fallbackReasonFor(preferredMode, resolvedMode);
  return {
    ok: true,
    durationMinutes: result.data.durationMinutes,
    distanceMeters: result.data.distanceMeters,
    mode: resolvedMode,
    requestedMode: preferredMode,
    resolvedMode,
    fallbackReason,
    durationSource: "directions",
    routeStatus: "ok",
    usedWalkFallback: false,
    usedEstimatedFallback,
    fallbackEstimateMode: usedEstimatedFallback ? resolvedMode : undefined,
    transitUnavailable: false,
    transitUnavailableProvider: null,
    estimates: estimatesForMode(
      result.data.durationMinutes,
      resolvedMode,
      result.data.distanceMeters,
    ),
  };
}

function toFailureResult(
  preferredMode: RoutesTravelMode,
  reason = "zero_results",
): RouteLegDurationResult {
  return {
    ok: false,
    durationMinutes: 0,
    distanceMeters: 0,
    mode: preferredMode,
    requestedMode: preferredMode,
    resolvedMode: preferredMode,
    fallbackReason: reason,
    durationSource: "none",
    routeStatus: reason === "mode_unavailable" ? "mode_unavailable" : "failed",
    usedWalkFallback: false,
    transitUnavailable: false,
    transitUnavailableProvider: null,
    estimates: { distanceMeters: 0 },
  };
}

async function tryFetchMode(
  ctx: RouteFetchContext,
  mode: RoutesTravelMode,
): Promise<RoutesFnResult> {
  return fetchRouteResult(ctx.origin, ctx.destination, mode, ctx.query);
}

/** Map Google `available_travel_modes` strings → RoutesTravelMode. */
export function availableModesToRoutesModes(
  available: string[] | null | undefined,
  _preferred: RoutesTravelMode,
): RoutesTravelMode[] {
  if (!available?.length) return [];
  const out: RoutesTravelMode[] = [];
  const add = (m: RoutesTravelMode) => {
    if (!out.includes(m)) out.push(m);
  };
  for (const raw of available) {
    const u = String(raw).toUpperCase();
    if (/TRANSIT|BUS|TRAIN|SUBWAY|RAIL|TRAM|FERRY/.test(u)) add("TRANSIT");
    else if (/DRIV|CAR|TAXI/.test(u)) add("DRIVE");
    else if (/WALK/.test(u)) add("WALK");
    else if (/BICYCL|BIKE|CYCLE/.test(u)) add("BICYCLE");
    else if (/TWO_WHEEL|MOTORCYCLE|SCOOTER/.test(u)) add("TWO_WHEELER");
  }
  return out;
}

export type BuildFallbackModeChainOptions = {
  locationContext?: string | null;
  regionCode?: string | null;
  regionProfile?: RouteRegionProfile;
};

/**
 * Build ordered Directions modes for one leg.
 * Region + distance aware; each mode is attempted at most once by the fetcher.
 */
export function buildFallbackModeChain(
  preferred: RoutesTravelMode,
  straightLineMeters: number,
  availableTravelModes?: string[] | null,
  options?: BuildFallbackModeChainOptions,
): RoutesTravelMode[] {
  const distance = Number.isFinite(straightLineMeters)
    ? Math.max(0, straightLineMeters)
    : 0;
  const walkOk = distance <= MAX_WALK_DIRECTIONS_METERS;
  const bikeOk = distance <= MAX_BICYCLE_DIRECTIONS_METERS;
  const available = availableModesToRoutesModes(availableTravelModes, preferred);
  const profile =
    options?.regionProfile ??
    resolveRouteRegionProfile(options?.locationContext, distance, options?.regionCode);
  const chain: RoutesTravelMode[] = [];
  const add = (m: RoutesTravelMode) => {
    if (m === "WALK" && !walkOk) return;
    if (m === "BICYCLE" && !bikeOk) return;
    if (!chain.includes(m)) chain.push(m);
  };

  // When API reported available modes (e.g. after ZERO_RESULTS), prefer those.
  if (available.length > 0) {
    for (const m of available) add(m);
    if (profile === "island_rural" || distance > 800) add("DRIVE");
    if (preferred === "BICYCLE" || preferred === "WALK") {
      if (walkOk) add("WALK");
    }
    return chain.length ? chain : ["DRIVE"];
  }

  if (preferred === "TRANSIT") {
    add("TRANSIT");
    return chain;
  }

  if (preferred === "BICYCLE") {
    if (bikeOk) add("BICYCLE");
    add("DRIVE");
    if (walkOk) add("WALK");
    return chain.length ? chain : ["DRIVE"];
  }

  if (preferred === "TWO_WHEELER") {
    add("TWO_WHEELER");
    add("DRIVE");
    return chain;
  }

  // Region-aware chains for WALK / DRIVE preferences.
  if (profile === "island_rural") {
    // Islands / suburbs / mountains: driving first, then transit.
    if (preferred === "DRIVE" || preferred === "WALK") {
      add("DRIVE");
      add("TRANSIT");
      if (walkOk && distance <= AUTO_WALK_MAX_METERS) add("WALK");
    } else {
      add(preferred);
      add("DRIVE");
    }
    return chain.length ? chain : ["DRIVE"];
  }

  if (profile === "transit_dense") {
    if (preferred === "WALK" && distance <= AUTO_WALK_MAX_METERS && walkOk) {
      add("WALK");
      add("TRANSIT");
      add("DRIVE");
    } else if (preferred === "WALK") {
      add("TRANSIT");
      add("DRIVE");
      if (walkOk) add("WALK");
    } else if (preferred === "DRIVE") {
      add("DRIVE");
      add("TRANSIT");
    } else {
      add(preferred);
      add("TRANSIT");
      add("DRIVE");
    }
    return chain.length ? chain : ["TRANSIT"];
  }

  if (profile === "short_urban" || (preferred === "WALK" && distance <= AUTO_WALK_MAX_METERS)) {
    // Short urban: walking → transit → driving
    if (preferred === "WALK" && walkOk) {
      add("WALK");
      add("TRANSIT");
      if (distance > 800) add("DRIVE");
    } else if (preferred === "DRIVE") {
      add("DRIVE");
      add("TRANSIT");
      if (walkOk) add("WALK");
    } else {
      add(preferred);
      add("WALK");
      add("TRANSIT");
      add("DRIVE");
    }
    return chain.length ? chain : ["WALK"];
  }

  // Mid / long distance: driving → transit
  if (preferred === "WALK") {
    add("DRIVE");
    add("TRANSIT");
    if (walkOk) add("WALK");
  } else if (preferred === "DRIVE") {
    add("DRIVE");
    add("TRANSIT");
  } else {
    add(preferred);
    add("DRIVE");
    add("TRANSIT");
  }
  return chain.length ? chain : ["DRIVE"];
}

/** First mode to request given preference + straight-line distance. */
export function resolveInitialDirectionsMode(
  preferred: RoutesTravelMode,
  straightLineMeters: number,
  options?: BuildFallbackModeChainOptions,
): RoutesTravelMode {
  const chain = buildFallbackModeChain(preferred, straightLineMeters, null, options);
  return chain[0] ?? (preferred === "WALK" ? "DRIVE" : preferred);
}

export function straightLineDistanceMeters(
  origin: LatLng,
  destination: LatLng,
): number {
  return distanceMeters(origin, destination);
}

export type FetchRouteFallbackOptions = {
  /**
   * When false (manual mode switch): only attempt preferredMode.
   * Do not return another mode's duration — caller must show unavailable UI.
   */
  allowModeFallback?: boolean;
};

function formatRouteSummary(params: {
  legKey: string;
  originName?: string;
  destinationName?: string;
  originPlaceId?: string;
  destinationPlaceId?: string;
  coordinateSource?: string;
  requestedMode: RoutesTravelMode;
  attemptedModes: RoutesTravelMode[];
  resolvedMode: RoutesTravelMode | null;
  durationMinutes: number | null;
  routeStatus: string;
  reason: string;
  allowModeFallback: boolean;
  distanceM: number;
  origin: LatLng;
  destination: LatLng;
}): string {
  return [
    "[ROUTE_SUMMARY]",
    `leg=${params.legKey}`,
    `originName=${params.originName ?? "n/a"}`,
    `destinationName=${params.destinationName ?? "n/a"}`,
    `originPlaceId=${params.originPlaceId ?? "none"}`,
    `destinationPlaceId=${params.destinationPlaceId ?? "none"}`,
    `coordinateSource=${params.coordinateSource ?? "unknown"}`,
    `requestedMode=${params.requestedMode}`,
    `attemptedModes=${params.attemptedModes.join(",")}`,
    `resolvedMode=${params.resolvedMode ?? "none"}`,
    `durationMinutes=${params.durationMinutes ?? "n/a"}`,
    `routeStatus=${params.routeStatus}`,
    `reason=${params.reason}`,
    `distanceM=${Math.round(params.distanceM)}`,
    `allowFallback=${params.allowModeFallback}`,
    `origin=${params.origin.lat.toFixed(4)},${params.origin.lng.toFixed(4)}`,
    `destination=${params.destination.lat.toFixed(4)},${params.destination.lng.toFixed(4)}`,
  ].join(" ");
}

/**
 * Try each mode in the distance-aware chain at most once.
 */
export async function fetchRouteWithDirectionFallbacks(
  ctx: RouteFetchContext,
  preferredMode: RoutesTravelMode,
  options?: FetchRouteFallbackOptions,
): Promise<RouteLegDurationResult> {
  const allowModeFallback = options?.allowModeFallback !== false;
  const straightM = straightLineDistanceMeters(ctx.origin, ctx.destination);
  const chainOpts: BuildFallbackModeChainOptions = {
    locationContext: ctx.query.locationContext,
    regionCode: ctx.query.region,
  };
  const chain = allowModeFallback
    ? buildFallbackModeChain(preferredMode, straightM, null, chainOpts)
    : [preferredMode];
  const attempted: RoutesTravelMode[] = [];
  const rawFailures: RouteApiFailureTelemetry[] = [];
  let lastAvailable: string[] | undefined;
  const originName = ctx.query.logLegKey?.split("→")[0]?.split("§").pop();
  const destinationName = ctx.query.logLegKey?.split("→")[1];

  for (let i = 0; i < chain.length; i++) {
    const mode = chain[i]!;
    attempted.push(mode);
    const result = await tryFetchMode(ctx, mode);

    if (result.ok) {
      // Manual strict mode: success only counts if it matches the requested mode.
      if (!allowModeFallback && mode !== preferredMode) {
        continue;
      }
      const reason =
        mode === preferredMode
          ? "preferred"
          : fallbackReasonFor(preferredMode, mode) ?? "fallback";
      if (rawFailures.length > 0) {
        logRouteOnce(
          `fallback_result|${ctx.cacheKey}|${attempted.join(",")}`,
          `[ROUTE_FALLBACK_RESULT] legKey=${ctx.scope.legKey} requestedMode=${preferredMode} attemptedModes=${attempted.join(",")} allowFallback=${allowModeFallback} resolvedMode=${mode} success=true finalLocalReason=${reason} rawFailureKinds=${rawFailures.map((failure) => failure.failureKind).join(",")} rawGoogleStatuses=${rawFailures.map((failure) => failure.googleStatus).join(",")} durationMinutes=${result.data.durationMinutes}`,
        );
      }
      logRouteOnce(
        `summary_ok|${ctx.cacheKey}|${mode}`,
        formatRouteSummary({
          legKey: ctx.scope.legKey,
          originName,
          destinationName,
          originPlaceId: ctx.query.originPlaceId,
          destinationPlaceId: ctx.query.destinationPlaceId,
          coordinateSource: ctx.query.coordinateSource,
          requestedMode: preferredMode,
          attemptedModes: attempted,
          resolvedMode: mode,
          durationMinutes: result.data.durationMinutes,
          routeStatus: "ok",
          reason,
          allowModeFallback,
          distanceM: straightM,
          origin: ctx.origin,
          destination: ctx.destination,
        }),
      );
      return toSuccessResult(result, preferredMode, mode, reason === "preferred" ? null : reason);
    }

    const status = googleStatus(result);
    const failureTelemetry = fallbackFailureTelemetry(result);
    rawFailures.push(failureTelemetry);
    logFailedRouteAttempt({
      ctx,
      requestedMode: preferredMode,
      attemptedMode: mode,
      allowModeFallback,
      originName,
      destinationName,
      telemetry: failureTelemetry,
    });
    if (result.availableTravelModes?.length) {
      lastAvailable = result.availableTravelModes;
    }

    if (
      allowModeFallback &&
      i === 0 &&
      /ZERO_RESULTS|NOT_FOUND|ZERO/i.test(status) &&
      lastAvailable?.length
    ) {
      const expanded = buildFallbackModeChain(
        preferredMode,
        straightM,
        lastAvailable,
        chainOpts,
      );
      for (const m of expanded) {
        if (!chain.includes(m)) chain.push(m);
      }
    }
  }

  const failReason = allowModeFallback ? "zero_results" : "mode_unavailable";
  warnRouteOnce(
    `fallback_result|${ctx.cacheKey}|${attempted.join(",")}`,
    `[ROUTE_FALLBACK_RESULT] legKey=${ctx.scope.legKey} requestedMode=${preferredMode} attemptedModes=${attempted.join(",")} allowFallback=${allowModeFallback} resolvedMode=none success=false finalLocalReason=${failReason} rawFailureKinds=${rawFailures.map((failure) => failure.failureKind).join(",")} rawGoogleStatuses=${rawFailures.map((failure) => failure.googleStatus).join(",")} durationMinutes=n/a`,
  );
  warnRouteOnce(
    `summary_fail|${ctx.cacheKey}|${attempted.join(",")}`,
    formatRouteSummary({
      legKey: ctx.scope.legKey,
      originName,
      destinationName,
      originPlaceId: ctx.query.originPlaceId,
      destinationPlaceId: ctx.query.destinationPlaceId,
      coordinateSource: ctx.query.coordinateSource,
      requestedMode: preferredMode,
      attemptedModes: attempted,
      resolvedMode: null,
      durationMinutes: null,
      routeStatus: failReason === "mode_unavailable" ? "mode_unavailable" : "failed",
      reason: failReason,
      allowModeFallback,
      distanceM: straightM,
      origin: ctx.origin,
      destination: ctx.destination,
    }),
  );

  // Keep legacy tag for grepping during migration.
  warnRouteOnce(
    `unavailable|${ctx.cacheKey}|${attempted.join(",")}`,
    [
      "[ROUTE_UNAVAILABLE]",
      `leg=${ctx.scope.legKey}`,
      `attemptedModes=${attempted.join(",")}`,
      `distanceM=${Math.round(straightM)}`,
      `reason=${failReason}`,
      `allowFallback=${allowModeFallback}`,
    ].join(" "),
  );

  return toFailureResult(preferredMode, failReason);
}

export function transportFallbackModeFromResult(
  route: RouteLegDurationResult,
): "walk" | "drive" | "transit" | null {
  if (!route.usedEstimatedFallback) return null;
  const estimateMode = route.fallbackEstimateMode ?? route.mode;
  if (estimateMode === "TRANSIT") return "transit";
  if (estimateMode === "DRIVE" || estimateMode === "TWO_WHEELER") return "drive";
  if (estimateMode === "WALK" || estimateMode === "BICYCLE") return "walk";
  return null;
}

/** UI label that matches the duration source. Always via displayTransportLabel. */
export function resolvedTransportDisplayLabel(
  transportLabel: string,
  route: RouteLegDurationResult,
): string {
  const fallback = transportFallbackModeFromResult(route);
  if (fallback === "drive") return displayTransportLabel("drive");
  if (fallback === "transit") return displayTransportLabel("transit");
  if (fallback === "walk") return displayTransportLabel("walk");
  if (route.ok) {
    if (route.mode === "DRIVE" || route.mode === "TWO_WHEELER") {
      if (/步行|走路|walk|單車|bike/i.test(transportLabel)) {
        return displayTransportLabel("drive");
      }
      if (/計程車|共乘|taxi|uber/i.test(transportLabel)) {
        return displayTransportLabel("taxi");
      }
      return displayTransportLabel("drive");
    }
    if (route.mode === "TRANSIT" && /步行|走路|walk/i.test(transportLabel)) {
      return displayTransportLabel("transit");
    }
    if (route.mode) return displayTransportLabel(route.mode);
  }
  return displayTransportLabel(transportLabel) || "移動";
}

export function estimatedDisplaySuffix(
  _transportLabel: string,
  route: RouteLegDurationResult,
): string {
  if (!route.usedEstimatedFallback && !transportFallbackModeFromResult(route)) {
    return "";
  }
  return "（估算）";
}
