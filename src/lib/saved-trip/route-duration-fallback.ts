import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { logRouteOnce } from "@/lib/route-duration-log";
import type { RouteLegDurationResult, RouteLegScope } from "@/lib/saved-trip/route-duration-types";
import { fetchRouteResult, type FetchRouteQueryOptions, type RoutesFnResult } from "@/services/routesService";

/** 超過此直線距離不查 walking */
export const MAX_WALK_DIRECTIONS_METERS = 15_000;
/** 超過此直線距離不查 bicycling */
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

/**
 * 僅查詢 preferredMode；不將 walking 結果寫入 driving（或反向）。
 * 單車在 bicycling 不支援時可 fallback 到 driving。
 */
export async function fetchRouteWithDirectionFallbacks(
  ctx: RouteFetchContext,
  preferredMode: RoutesTravelMode,
): Promise<RouteLegDurationResult> {
  const primary = await tryFetchMode(ctx, preferredMode);
  if (primary.ok) {
    return toSuccessResult(primary, preferredMode, preferredMode, false);
  }

  logRouteOnce(
    `primary_err|${ctx.cacheKey}|${preferredMode}|${googleStatus(primary)}`,
    `[ROUTE_DURATION_ERROR] leg=${ctx.scope.legKey} mode=${preferredMode} status=${googleStatus(primary)}`,
  );

  if (preferredMode === "BICYCLE") {
    const drive = await tryFetchMode(ctx, "DRIVE");
    if (drive.ok) {
      return toSuccessResult(drive, preferredMode, "DRIVE", true);
    }
  }

  return toFailureResult(preferredMode);
}

export function transportFallbackModeFromResult(
  route: RouteLegDurationResult,
): "walk" | "drive" | "transit" | null {
  if (!route.usedEstimatedFallback) return null;
  const estimateMode = route.fallbackEstimateMode;
  if (estimateMode === "TRANSIT") return "transit";
  if (estimateMode === "DRIVE" || estimateMode === "TWO_WHEELER") return "drive";
  if (estimateMode === "WALK" || estimateMode === "BICYCLE") return "walk";
  return null;
}

export function estimatedDisplaySuffix(
  transportLabel: string,
  route: RouteLegDurationResult,
): string {
  if (!route.usedEstimatedFallback && !transportFallbackModeFromResult(route)) return "";
  return "（估算）";
}
