import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { distanceMeters } from "@/lib/geo-distance";
import { logRouteOnce, warnRouteOnce } from "@/lib/route-duration-log";
import type { RouteLegDurationResult, RouteLegScope } from "@/lib/saved-trip/route-duration-types";
import {
  fetchRouteResult,
  type FetchRouteQueryOptions,
  type RoutesFnResult,
} from "@/services/routesService";

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

function toSuccessResult(
  result: RoutesFnResult & { ok: true },
  preferredMode: RoutesTravelMode,
  resolvedMode: RoutesTravelMode,
): RouteLegDurationResult {
  const usedEstimatedFallback = resolvedMode !== preferredMode;
  return {
    ok: true,
    durationMinutes: result.data.durationMinutes,
    distanceMeters: result.data.distanceMeters,
    mode: resolvedMode,
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

function toFailureResult(preferredMode: RoutesTravelMode): RouteLegDurationResult {
  return {
    ok: false,
    durationMinutes: 0,
    distanceMeters: 0,
    mode: preferredMode,
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

/**
 * Build ordered Directions modes for one leg.
 * Distance gates walking/bicycling; each mode is attempted at most once by the fetcher.
 */
export function buildFallbackModeChain(
  preferred: RoutesTravelMode,
  straightLineMeters: number,
  availableTravelModes?: string[] | null,
): RoutesTravelMode[] {
  const distance = Number.isFinite(straightLineMeters)
    ? Math.max(0, straightLineMeters)
    : 0;
  const walkOk = distance <= MAX_WALK_DIRECTIONS_METERS;
  const bikeOk = distance <= MAX_BICYCLE_DIRECTIONS_METERS;
  const available = availableModesToRoutesModes(availableTravelModes, preferred);
  const chain: RoutesTravelMode[] = [];
  const add = (m: RoutesTravelMode) => {
    if (m === "WALK" && !walkOk) return;
    if (m === "BICYCLE" && !bikeOk) return;
    if (!chain.includes(m)) chain.push(m);
  };

  // When API reported available modes (e.g. after ZERO_RESULTS), prefer those.
  if (available.length > 0) {
    for (const m of available) add(m);
    if (distance > 800) add("DRIVE");
    if (preferred === "BICYCLE" || preferred === "WALK") {
      if (walkOk) add("WALK");
    }
    return chain.length ? chain : ["DRIVE"];
  }

  if (preferred === "WALK") {
    if (distance <= AUTO_WALK_MAX_METERS && walkOk) {
      add("WALK");
      if (distance > 800) add("DRIVE");
    } else if (distance <= CROSS_AREA_DRIVE_MIN_METERS && walkOk) {
      add("WALK");
      add("DRIVE");
    } else {
      add("DRIVE");
    }
    return chain.length ? chain : ["DRIVE"];
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

  if (preferred === "TRANSIT") {
    add("TRANSIT");
    return chain;
  }

  add(preferred === "DRIVE" ? "DRIVE" : preferred);
  if (!chain.length) add("DRIVE");
  return chain;
}

/** First mode to request given preference + straight-line distance. */
export function resolveInitialDirectionsMode(
  preferred: RoutesTravelMode,
  straightLineMeters: number,
): RoutesTravelMode {
  const chain = buildFallbackModeChain(preferred, straightLineMeters, null);
  return chain[0] ?? (preferred === "WALK" ? "DRIVE" : preferred);
}

export function straightLineDistanceMeters(
  origin: LatLng,
  destination: LatLng,
): number {
  return distanceMeters(origin, destination);
}

/**
 * Try each mode in the distance-aware chain at most once.
 */
export async function fetchRouteWithDirectionFallbacks(
  ctx: RouteFetchContext,
  preferredMode: RoutesTravelMode,
): Promise<RouteLegDurationResult> {
  const straightM = straightLineDistanceMeters(ctx.origin, ctx.destination);
  const chain = buildFallbackModeChain(preferredMode, straightM, null);
  const attempted: RoutesTravelMode[] = [];
  let lastAvailable: string[] | undefined;

  for (let i = 0; i < chain.length; i++) {
    const mode = chain[i]!;
    attempted.push(mode);
    const result = await tryFetchMode(ctx, mode);

    if (result.ok) {
      const reason =
        mode === preferredMode
          ? "preferred"
          : preferredMode === "WALK" && mode === "DRIVE"
            ? "walking_zero_results_fallback"
            : `${String(preferredMode).toLowerCase()}_fallback`;
      logRouteOnce(
        `summary_ok|${ctx.cacheKey}|${mode}`,
        [
          "[ROUTE_SUMMARY]",
          `leg=${ctx.scope.legKey}`,
          `origin=${ctx.origin.lat.toFixed(4)},${ctx.origin.lng.toFixed(4)}`,
          `destination=${ctx.destination.lat.toFixed(4)},${ctx.destination.lng.toFixed(4)}`,
          `requestedMode=${preferredMode}`,
          `resolvedMode=${mode}`,
          `result=success`,
          `duration=${result.data.durationMinutes}m`,
          `distanceM=${Math.round(straightM)}`,
          `reason=${reason}`,
        ].join(" "),
      );
      return toSuccessResult(result, preferredMode, mode);
    }

    const status = googleStatus(result);
    if (result.availableTravelModes?.length) {
      lastAvailable = result.availableTravelModes;
    }

    if (
      i === 0 &&
      /ZERO_RESULTS|NOT_FOUND|ZERO/i.test(status) &&
      lastAvailable?.length
    ) {
      const expanded = buildFallbackModeChain(
        preferredMode,
        straightM,
        lastAvailable,
      );
      for (const m of expanded) {
        if (!chain.includes(m)) chain.push(m);
      }
    }
  }

  warnRouteOnce(
    `summary_fail|${ctx.cacheKey}|${attempted.join(",")}`,
    [
      "[ROUTE_UNAVAILABLE]",
      `leg=${ctx.scope.legKey}`,
      `attemptedModes=${attempted.join(",")}`,
      `distanceM=${Math.round(straightM)}`,
      `reason=zero_results`,
    ].join(" "),
  );

  return toFailureResult(preferredMode);
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

/** UI label that matches the duration source. */
export function resolvedTransportDisplayLabel(
  transportLabel: string,
  route: RouteLegDurationResult,
): string {
  const fallback = transportFallbackModeFromResult(route);
  if (fallback === "drive") return "開車";
  if (fallback === "transit") return "大眾運輸";
  if (fallback === "walk") return "步行";
  if (route.ok) {
    if (route.mode === "DRIVE" || route.mode === "TWO_WHEELER") {
      if (/步行|走路|walk|單車|bike/i.test(transportLabel)) return "開車";
    }
    if (route.mode === "TRANSIT" && /步行|走路|walk/i.test(transportLabel)) {
      return "大眾運輸";
    }
  }
  return transportLabel.trim() || "移動";
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
