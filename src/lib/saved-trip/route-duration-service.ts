import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { logDirectionsDebug } from "@/lib/directions-debug-log";
import { fetchRouteDurationFromProvider } from "@/lib/saved-trip/route-duration-providers";
import type {
  FetchLegDurationInput,
  RouteLegDurationResult,
  RouteLegScope,
} from "@/lib/saved-trip/route-duration-types";
import type { FetchRouteQueryOptions } from "@/services/routesService";

export type { RouteLegDurationResult, RouteLegScope, FetchLegDurationInput };

const SUCCESS_TTL_MS = 30 * 60 * 1000;
/** transit ZERO_RESULTS / 日本 Maps 深連結：不再重試 */
const TRANSIT_UNAVAILABLE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 5 * 60 * 1000;

const scopedCache = new Map<string, ScopedCacheEntry>();
const scopedInflight = new Map<string, Promise<RouteLegDurationResult>>();

type ScopedCacheEntry = {
  result: RouteLegDurationResult;
  expiresAt: number;
};

function coordPart(n: number): string {
  return n.toFixed(4);
}

/** dayIndex + legIndex + origin/dest lat,lng + mode + departureTime */
export function buildLegRouteFingerprint(
  dayIndex: number,
  legIndex: number,
  origin: LatLng,
  destination: LatLng,
  mode: RoutesTravelMode,
  departureTime?: string,
): string {
  const dep = mode === "TRANSIT" && departureTime ? departureTime.slice(0, 19) : "";
  const o = `${coordPart(origin.lat)},${coordPart(origin.lng)}`;
  const d = `${coordPart(destination.lat)},${coordPart(destination.lng)}`;
  return `d${dayIndex}|l${legIndex}|${o}>${d}|${mode}|${dep}`;
}

export function buildScopedRouteCacheKey(
  scope: RouteLegScope,
  origin: LatLng,
  destination: LatLng,
  mode: RoutesTravelMode,
  query?: FetchRouteQueryOptions,
): string {
  const dep =
    mode === "TRANSIT" && query?.departureTime
      ? query.departureTime.slice(0, 19)
      : undefined;
  return `${scope.tripId}|${buildLegRouteFingerprint(scope.dayIndex, scope.legIndex, origin, destination, mode, dep)}`;
}

function cacheTtl(result: RouteLegDurationResult): number {
  if (result.transitUnavailable) return TRANSIT_UNAVAILABLE_TTL_MS;
  if (result.ok) return SUCCESS_TTL_MS;
  return FAILED_TTL_MS;
}

function readScopedCache(key: string): RouteLegDurationResult | null {
  const hit = scopedCache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.result;
}

function writeScopedCache(key: string, result: RouteLegDurationResult): void {
  scopedCache.set(key, {
    result,
    expiresAt: Date.now() + cacheTtl(result),
  });
}

/** 清除單一 leg 的所有 scoped cache（交通方式切換） */
export function invalidateScopedRouteCacheForLeg(tripId: string, legKey: string): void {
  const prefix = `${tripId}|`;
  for (const key of scopedCache.keys()) {
    if (key.startsWith(prefix) && key.includes(`|${legKey}|`)) {
      scopedCache.delete(key);
    }
  }
  for (const key of scopedInflight.keys()) {
    if (key.startsWith(prefix) && key.includes(`|${legKey}|`)) {
      scopedInflight.delete(key);
    }
  }
}

export function clearScopedRouteCache(): void {
  scopedCache.clear();
  scopedInflight.clear();
}

/**
 * 單一入口：計算相鄰兩點交通時間。
 * Provider：google_directions（預設）| japan_transit（region=jp + TRANSIT，不呼叫 API）
 */
export async function fetchScopedLegDuration(
  input: FetchLegDurationInput,
): Promise<RouteLegDurationResult> {
  const { scope, origin, destination, preferredMode, query, force } = input;
  const cacheKey = buildScopedRouteCacheKey(scope, origin, destination, preferredMode, query);

  if (!force) {
    const cached = readScopedCache(cacheKey);
    if (cached) {
      logDirectionsDebug("skipped", {
        legKey: scope.legKey,
        mode: preferredMode.toLowerCase(),
        skippedReason: "scoped_cache_hit",
      });
      return cached;
    }
    const pending = scopedInflight.get(cacheKey);
    if (pending) {
      logDirectionsDebug("skipped", {
        legKey: scope.legKey,
        mode: preferredMode.toLowerCase(),
        skippedReason: "scoped_inflight",
      });
      return pending;
    }
  }

  const promise = fetchRouteDurationFromProvider({
    scope,
    origin,
    destination,
    preferredMode,
    query,
    cacheKey,
  });
  scopedInflight.set(cacheKey, promise);
  try {
    const result = await promise;
    writeScopedCache(cacheKey, result);
    return result;
  } finally {
    if (scopedInflight.get(cacheKey) === promise) {
      scopedInflight.delete(cacheKey);
    }
  }
}
