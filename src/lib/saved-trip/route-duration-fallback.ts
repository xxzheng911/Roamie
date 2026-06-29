import { distanceMeters } from "@/lib/geo-distance";
import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { logRouteOnce } from "@/lib/route-duration-log";
import type { RouteLegDurationResult, RouteLegScope } from "@/lib/saved-trip/route-duration-types";
import { fetchRouteResult, type FetchRouteQueryOptions, type RoutesFnResult } from "@/services/routesService";

/** 超過此直線距離不查 walking，改走 transit / driving */
export const MAX_WALK_DIRECTIONS_METERS = 15_000;
/** 超過此直線距離不查 bicycling，改走 driving / transit */
export const MAX_BICYCLE_DIRECTIONS_METERS = 25_000;

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

export function routesModeFromAvailableToken(token: string): RoutesTravelMode | null {
  const t = token.trim().toUpperCase();
  if (t === "WALKING" || t === "WALK") return "WALK";
  if (t === "DRIVING" || t === "DRIVE") return "DRIVE";
  if (t === "BICYCLING" || t === "BICYCLE") return "BICYCLE";
  if (t === "TRANSIT") return "TRANSIT";
  return null;
}

export function availableModesToRoutesModes(
  modes: string[] | undefined,
  exclude?: RoutesTravelMode,
): RoutesTravelMode[] {
  const out: RoutesTravelMode[] = [];
  const seen = new Set<RoutesTravelMode>();
  for (const raw of modes ?? []) {
    const mode = routesModeFromAvailableToken(raw);
    if (!mode || mode === exclude || seen.has(mode)) continue;
    seen.add(mode);
    out.push(mode);
  }
  return out;
}

function modeAllowedForDistance(mode: RoutesTravelMode, straightM: number): boolean {
  if (mode === "WALK" && straightM > MAX_WALK_DIRECTIONS_METERS) return false;
  if (mode === "BICYCLE" && straightM > MAX_BICYCLE_DIRECTIONS_METERS) return false;
  return true;
}

function defaultFallbackModes(preferredMode: RoutesTravelMode): RoutesTravelMode[] {
  if (preferredMode === "BICYCLE") return ["DRIVE", "TRANSIT", "WALK"];
  if (preferredMode === "WALK") return ["TRANSIT", "DRIVE"];
  if (preferredMode === "DRIVE" || preferredMode === "TWO_WHEELER") return ["TRANSIT"];
  return [];
}

/** Google 建議模式優先，再接預設 fallback 鏈 */
export function buildFallbackModeChain(
  preferredMode: RoutesTravelMode,
  straightM: number,
  availableModes?: string[],
): RoutesTravelMode[] {
  const fromGoogle = availableModesToRoutesModes(availableModes, preferredMode);
  const merged: RoutesTravelMode[] = [];
  const seen = new Set<RoutesTravelMode>([preferredMode]);

  const add = (mode: RoutesTravelMode) => {
    if (seen.has(mode) || !modeAllowedForDistance(mode, straightM)) return;
    seen.add(mode);
    merged.push(mode);
  };

  for (const mode of fromGoogle) add(mode);
  for (const mode of defaultFallbackModes(preferredMode)) add(mode);
  return merged;
}

function estimatesForMode(minutes: number, mode: RoutesTravelMode, distanceMetersValue: number) {
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
  estimateMode: RoutesTravelMode,
  usedEstimatedFallback: boolean,
): RouteLegDurationResult {
  return {
    ok: true,
    durationMinutes: result.data.durationMinutes,
    distanceMeters: result.data.distanceMeters,
    mode: preferredMode,
    usedWalkFallback: false,
    usedEstimatedFallback,
    fallbackEstimateMode: usedEstimatedFallback ? estimateMode : undefined,
    transitUnavailable: false,
    transitUnavailableProvider: null,
    estimates: estimatesForMode(
      result.data.durationMinutes,
      estimateMode,
      result.data.distanceMeters,
    ),
  };
}

function toFailureResult(
  preferredMode: RoutesTravelMode,
  lastResult: RoutesFnResult | null,
): RouteLegDurationResult {
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

/**
 * 依 preferredMode 查詢 Directions，失敗時依 available_travel_modes 與距離 fallback。
 */
export async function fetchRouteWithDirectionFallbacks(
  ctx: RouteFetchContext,
  preferredMode: RoutesTravelMode,
): Promise<RouteLegDurationResult> {
  const straightM = Math.round(distanceMeters(ctx.origin, ctx.destination));
  const skipPrimary =
    (preferredMode === "WALK" && straightM > MAX_WALK_DIRECTIONS_METERS) ||
    (preferredMode === "BICYCLE" && straightM > MAX_BICYCLE_DIRECTIONS_METERS);

  let lastResult: RoutesFnResult | null = null;

  if (skipPrimary) {
    logRouteOnce(
      `skip_primary|${ctx.cacheKey}|${preferredMode}`,
      `[ROUTE_DURATION_FALLBACK] leg=${ctx.scope.legKey} mode=${preferredMode} straightM=${straightM} action=skip_primary`,
    );
  } else {
    const primary = await tryFetchMode(ctx, preferredMode);
    if (primary.ok) {
      return toSuccessResult(primary, preferredMode, preferredMode, false);
    }

    lastResult = primary;
    const status = googleStatus(primary);
    logRouteOnce(
      `primary_err|${ctx.cacheKey}|${preferredMode}|${status}`,
      `[ROUTE_DURATION_ERROR] leg=${ctx.scope.legKey} mode=${preferredMode} status=${status} available=${primary.availableTravelModes?.join(",") ?? "n/a"} action=fallback`,
    );
  }

  const initialAvailable = lastResult?.availableTravelModes;
  const queue = buildFallbackModeChain(preferredMode, straightM, initialAvailable);
  const tried = new Set<RoutesTravelMode>(skipPrimary ? [] : [preferredMode]);

  while (queue.length > 0) {
    const mode = queue.shift()!;
    if (tried.has(mode)) continue;
    tried.add(mode);

    const result = await tryFetchMode(ctx, mode);
    if (result.ok) {
      logRouteOnce(
        `fallback_ok|${ctx.cacheKey}|${preferredMode}|${mode}`,
        `[ROUTE_DURATION_FALLBACK] leg=${ctx.scope.legKey} preferred=${preferredMode} used=${mode} straightM=${straightM} estimated=true`,
      );
      return toSuccessResult(result, preferredMode, mode, true);
    }

    lastResult = result;
    const status = googleStatus(result);
    logRouteOnce(
      `fallback_err|${ctx.cacheKey}|${mode}|${status}`,
      `[ROUTE_DURATION_ERROR] leg=${ctx.scope.legKey} mode=${mode} status=${status} available=${result.availableTravelModes?.join(",") ?? "n/a"}`,
    );

    for (const suggested of availableModesToRoutesModes(result.availableTravelModes, preferredMode)) {
      if (!tried.has(suggested) && !queue.includes(suggested)) {
        queue.unshift(suggested);
      }
    }
  }

  logRouteOnce(
    `fallback_exhausted|${ctx.cacheKey}|${preferredMode}`,
    `[ROUTE_DURATION_ERROR] leg=${ctx.scope.legKey} preferred=${preferredMode} status=${googleStatus(lastResult ?? { ok: false, statusCode: 0, message: "no_result" })} action=failed`,
  );
  return toFailureResult(preferredMode, lastResult);
}

export function transportFallbackModeFromResult(
  route: RouteLegDurationResult,
): "walk" | "drive" | "transit" | null {
  if (!route.usedEstimatedFallback) return null;
  const estimateMode = route.fallbackEstimateMode;
  if (estimateMode === "TRANSIT") return "transit";
  if (estimateMode === "DRIVE" || estimateMode === "TWO_WHEELER") return "drive";
  if (estimateMode === "WALK" || estimateMode === "BICYCLE") return "walk";
  if (route.estimates.transit != null) return "transit";
  if (route.estimates.drive != null) return "drive";
  if (route.estimates.walk != null) return "walk";
  return null;
}

export function estimatedDisplaySuffix(
  transportLabel: string,
  route: RouteLegDurationResult,
): string {
  if (!route.usedEstimatedFallback && !transportFallbackModeFromResult(route)) return "";
  return "（估算）";
}
