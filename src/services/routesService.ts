/**
 * Google Routes API — 統一服務層（Capacitor 走 client API，web 走 serverFn）
 */
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { computeRouteFromClient } from "@/lib/google-routes-client";
import { logGoogleMapsKeyLoadedOnce } from "@/lib/google-maps-key-resolve";
import type { LegDurationEstimate, RouteResult, RoutesTravelMode } from "@/lib/routes/types";
import type { DirectionsQueryOptions } from "@/lib/google-directions-fetch";
import {
  getCachedRouteDuration,
  getRouteDurationInFlight,
  logRouteDurationOnce,
  registerRouteDurationInFlight,
  routeDurationCacheKey,
  setCachedRouteDuration,
  type RouteDurationCacheEntry,
} from "@/lib/route-duration-cache";
import { logRouteOnce, warnRouteOnce } from "@/lib/route-duration-log";
import { routesCache, routesCacheKey, tripLegsCacheKey } from "@/services/routesCache";

export type LatLng = { lat: number; lng: number };

export type FetchRouteQueryOptions = DirectionsQueryOptions & {
  departureTime?: string;
  logLegKey?: string;
  /** 大眾運輸 cache key：無 departureTime 時以行程日期區分 */
  tripDate?: string;
};

export type RoutesTestResult =
  | { ok: true; durationMinutes: number; distanceMeters: number }
  | { ok: false; statusCode?: number; message: string; hint?: string };

export type RoutesFnResult =
  | { ok: true; data: RouteResult }
  | { ok: false; statusCode: number; message: string; hint?: string; googleStatus?: string; availableTravelModes?: string[] };

type DurationFn = (args: {
  data: {
    origin: LatLng;
    destination: LatLng;
    travelMode: RoutesTravelMode;
    departureTime?: string;
  };
}) => Promise<unknown>;

type DistanceFn = (args: {
  data: { origin: LatLng; destination: LatLng; travelMode: RoutesTravelMode };
}) => Promise<{
  ok: boolean;
  data?: { distanceMeters: number };
  statusCode?: number;
  message?: string;
}>;

type TripLegsFn = (args: { data: { places: LatLng[]; travelMode: RoutesTravelMode } }) => Promise<{
  ok: boolean;
  data?: Array<{ durationMinutes: number; distanceMeters: number }>;
  statusCode?: number;
  message?: string;
}>;

type LegEstimatesFn = (args: { data: { origin: LatLng; destination: LatLng } }) => Promise<{
  ok: boolean;
  data?: LegDurationEstimate;
  statusCode?: number;
  message?: string;
}>;

type TestFn = () => Promise<RoutesFnResult>;

let boundDuration: DurationFn | null = null;
let boundDistance: DistanceFn | null = null;
let boundTripLegs: TripLegsFn | null = null;
let boundLegEstimates: LegEstimatesFn | null = null;
let boundTest: TestFn | null = null;

export function bindRoutesServerFns(fns: {
  computeDuration: DurationFn;
  computeDistance: DistanceFn;
  computeTripLegs: TripLegsFn;
  computeLegEstimates: LegEstimatesFn;
  testConnection: TestFn;
}): void {
  boundDuration = fns.computeDuration;
  boundDistance = fns.computeDistance;
  boundTripLegs = fns.computeTripLegs;
  boundLegEstimates = fns.computeLegEstimates;
  boundTest = fns.testConnection;
}

function requireDistanceFn(): DistanceFn {
  if (!boundDistance) {
    throw new Error("routesService: call bindRoutesServerFns() before using Routes API");
  }
  return boundDistance;
}

function requireTripLegsFn(): TripLegsFn {
  if (!boundTripLegs) {
    throw new Error("routesService: call bindRoutesServerFns() before using Routes API");
  }
  return boundTripLegs;
}

function requireLegEstimatesFn(): LegEstimatesFn {
  if (!boundLegEstimates) {
    throw new Error("routesService: call bindRoutesServerFns() before using Routes API");
  }
  return boundLegEstimates;
}

function requireTestFn(): TestFn {
  if (!boundTest) {
    throw new Error("routesService: call bindRoutesServerFns() before using Routes API");
  }
  return boundTest;
}

function unwrapRoute(result: RoutesFnResult): RouteResult | null {
  if (result.ok) return result.data;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize TanStack serverFn / server response into RoutesFnResult */
function normalizeDurationResponse(raw: unknown): RoutesFnResult {
  if (!isRecord(raw)) {
    return { ok: false, statusCode: 0, message: "invalid_response" };
  }

  if (raw.ok === true) {
    const data = raw.data;
    if (isRecord(data) && typeof data.durationMinutes === "number") {
      return {
        ok: true,
        data: {
          durationSeconds: typeof data.durationSeconds === "number" ? data.durationSeconds : data.durationMinutes * 60,
          durationMinutes: data.durationMinutes,
          distanceMeters: typeof data.distanceMeters === "number" ? data.distanceMeters : 0,
          travelMode: (data.travelMode as RoutesTravelMode) ?? "TRANSIT",
        },
      };
    }
    if (typeof raw.durationMinutes === "number") {
      return {
        ok: true,
        data: {
          durationSeconds: typeof raw.durationSeconds === "number" ? raw.durationSeconds : raw.durationMinutes * 60,
          durationMinutes: raw.durationMinutes,
          distanceMeters: typeof raw.distanceMeters === "number" ? raw.distanceMeters : 0,
          travelMode: (raw.travelMode as RoutesTravelMode) ?? "TRANSIT",
        },
      };
    }
    return { ok: false, statusCode: 0, message: "missing_duration_minutes" };
  }

  if (raw.ok === false) {
    return {
      ok: false,
      statusCode: typeof raw.statusCode === "number" ? raw.statusCode : 0,
      message: typeof raw.message === "string" ? raw.message : "route_failed",
      googleStatus: typeof raw.googleStatus === "string" ? raw.googleStatus : undefined,
      availableTravelModes: Array.isArray(raw.availableTravelModes)
        ? (raw.availableTravelModes as string[])
        : undefined,
    };
  }

  return { ok: false, statusCode: 0, message: "unrecognized_response" };
}

function cacheEntryToFnResult(entry: RouteDurationCacheEntry): RoutesFnResult {
  if (entry.ok && entry.durationMinutes != null) {
    return {
      ok: true,
      data: {
        durationSeconds: entry.durationMinutes * 60,
        durationMinutes: entry.durationMinutes,
        distanceMeters: entry.distanceMeters,
        travelMode: entry.travelMode,
      },
    };
  }
  return {
    ok: false,
    statusCode: 0,
    message: entry.errorMessage ?? entry.status,
    googleStatus: entry.status,
    availableTravelModes: entry.availableTravelModes,
  };
}

function fnResultToCacheEntry(
  result: RoutesFnResult,
  travelMode: RoutesTravelMode,
): RouteDurationCacheEntry {
  if (result.ok) {
    return {
      ok: true,
      durationMinutes: result.data.durationMinutes,
      distanceMeters: result.data.distanceMeters,
      status: "OK",
      travelMode: result.data.travelMode ?? travelMode,
    };
  }
  return {
    ok: false,
    durationMinutes: null,
    distanceMeters: 0,
    status: result.googleStatus ?? result.message,
    travelMode,
    errorMessage: result.message,
    availableTravelModes: result.availableTravelModes,
  };
}

async function fetchRouteDurationUncached(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  queryOptions?: FetchRouteQueryOptions,
  cacheKey?: string,
): Promise<RoutesFnResult> {
  const departureTime = queryOptions?.departureTime;
  const originStr = `${origin.lat},${origin.lng}`;
  const destStr = `${destination.lat},${destination.lng}`;

  logRouteDurationOnce(
    "ROUTE_DURATION_FETCH",
    cacheKey ?? `${originStr}>${destStr}`,
    `origin=${originStr} destination=${destStr} mode=${travelMode} departure_time=${departureTime ?? "n/a"}`,
  );

  const directionsQuery: DirectionsQueryOptions | undefined = queryOptions
    ? {
        region: queryOptions.region,
        locationContext: queryOptions.locationContext,
        originPlaceId: queryOptions.originPlaceId,
        destinationPlaceId: queryOptions.destinationPlaceId,
        logLegKey: queryOptions.logLegKey,
      }
    : undefined;

  // Bundled Capacitor has no SSR — client Directions API only
  if (!isCapacitorNativeShell() && boundDuration) {
    try {
      const raw = await boundDuration({
        data: { origin, destination, travelMode, departureTime },
      });
      const api = normalizeDurationResponse(raw);
      if (api.ok) {
        logRouteOnce(
          `${cacheKey ?? originStr}|server_ok`,
          `[ROUTE_DURATION_FETCH] transport=server_fn mode=${travelMode} ok=true duration=${api.data.durationMinutes}`,
        );
        return api;
      }
      warnRouteOnce(
        `${cacheKey ?? originStr}|server_fail`,
        `[ROUTE_DURATION_FETCH] transport=server_fn mode=${travelMode} ok=false message=${api.message}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnRouteOnce(
        `${cacheKey ?? originStr}|server_exc`,
        `[ROUTE_DURATION_FETCH] transport=server_fn mode=${travelMode} exception=${msg}`,
      );
    }
  }

  logRouteOnce(`${cacheKey ?? originStr}|client`, `[ROUTE_DURATION_FETCH] transport=client mode=${travelMode}`);
  const client = await computeRouteFromClient(
    origin,
    destination,
    travelMode,
    departureTime,
    directionsQuery,
  );
  if (client.ok) return client;
  return {
    ok: false,
    statusCode: client.statusCode,
    message: client.message,
    googleStatus: client.googleStatus,
    availableTravelModes: client.availableTravelModes,
  };
}

async function fetchRouteDurationResult(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  queryOptions?: FetchRouteQueryOptions,
): Promise<RoutesFnResult> {
  const departureTime = queryOptions?.departureTime;
  const cacheKey = routeDurationCacheKey(origin, destination, travelMode, departureTime, {
    originPlaceId: queryOptions?.originPlaceId,
    destinationPlaceId: queryOptions?.destinationPlaceId,
    tripDate: queryOptions?.tripDate,
  });

  const cached = getCachedRouteDuration(cacheKey);
  if (cached && cached.travelMode === travelMode) {
    logRouteDurationOnce("ROUTE_DURATION_CACHE_HIT", cacheKey, `status=${cached.status}`);
    return cacheEntryToFnResult(cached);
  }

  const inFlight = getRouteDurationInFlight(cacheKey);
  if (inFlight) {
    logRouteDurationOnce("ROUTE_DURATION_INFLIGHT", cacheKey, "awaiting");
    const entry = await inFlight;
    return cacheEntryToFnResult(entry);
  }

  const promise = fetchRouteDurationUncached(origin, destination, travelMode, queryOptions, cacheKey).then(
    (result) => {
      setCachedRouteDuration(cacheKey, fnResultToCacheEntry(result, travelMode));
      return fnResultToCacheEntry(result, travelMode);
    },
  );

  return cacheEntryToFnResult(await registerRouteDurationInFlight(cacheKey, promise));
}

/** 取得完整 Routes API 結果（含 status，供 sync-route-legs 記錄與 fallback） */
export async function fetchRouteResult(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
  options?: FetchRouteQueryOptions,
): Promise<RoutesFnResult> {
  return fetchRouteDurationResult(origin, destination, travelMode, options);
}

async function fetchRouteDistanceResult(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<{ ok: boolean; data?: { distanceMeters: number }; statusCode?: number; message?: string }> {
  if (isCapacitorNativeShell()) {
    const result = await computeRouteFromClient(origin, destination, travelMode);
    if (!result.ok) return result;
    return { ok: true, data: { distanceMeters: result.data.distanceMeters } };
  }

  try {
    const result = await requireDistanceFn()({ data: { origin, destination, travelMode } });
    if (result.ok) return result;
    const client = await computeRouteFromClient(origin, destination, travelMode);
    if (client.ok) return { ok: true, data: { distanceMeters: client.data.distanceMeters } };
    return result;
  } catch {
    const client = await computeRouteFromClient(origin, destination, travelMode);
    if (client.ok) return { ok: true, data: { distanceMeters: client.data.distanceMeters } };
    return client;
  }
}

/** 取得兩點間路程時間（分鐘） */
export async function getRouteDuration(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<number | null> {
  const key = routesCacheKey(origin, destination, travelMode);
  return routesCache.getOrFetch(
    key,
    async () => {
      const api = await fetchRouteDurationResult(origin, destination, travelMode);
      const route = unwrapRoute(api);
      if (route?.durationMinutes != null) return route.durationMinutes;
      if (!api.ok) {
        const status =
          api.googleStatus ??
          api.message?.match(/PERMISSION_DENIED|REQUEST_DENIED|INVALID_REQUEST|ZERO_RESULTS/i)?.[0] ??
          String(api.statusCode ?? "failed");
        warnRouteOnce(`${key}|err`, `[ROUTE_DURATION_ERROR] status=${status} message=${api.message ?? "duration_failed"}`);
      }
      return null;
    },
    { shouldCache: (value) => value != null },
  );
}

/** 取得兩點間距離（公尺） */
export async function getRouteDistance(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<number | null> {
  const key = `dist:${routesCacheKey(origin, destination, travelMode)}`;
  return routesCache.getOrFetch(key, async () => {
    const result = await fetchRouteDistanceResult(origin, destination, travelMode);
    if (!result.ok || !result.data) return null;
    return result.data.distanceMeters;
  });
}

/** 取得 walk / drive / transit 三種模式估算（分鐘） */
export async function getRouteLegEstimates(
  origin: LatLng,
  destination: LatLng,
): Promise<LegDurationEstimate | null> {
  const key = `est:${routesCacheKey(origin, destination, "WALK")}`;
  return routesCache.getOrFetch(
    key,
    async () => {
      const result = await requireLegEstimatesFn()({ data: { origin, destination } });
      if (!result.ok || !result.data) {
        warnRouteOnce(`${key}|fail`, `[ROUTE_DURATION_ERROR] status=${result.statusCode ?? "failed"} message=${result.message ?? "leg_estimates_failed"}`);
        return null;
      }
      const { walk, drive, transit } = result.data;
      if (walk == null && drive == null && transit == null) {
        warnRouteOnce(`${key}|empty`, `[ROUTE_DURATION_ERROR] status=empty_estimates message=all_modes_failed`);
        return null;
      }
      return result.data;
    },
    { shouldCache: (value) => value != null },
  );
}

/** 依序計算行程中相鄰地點的路段時間 */
export async function getTripLegsWithDurations(
  places: LatLng[],
  travelMode: RoutesTravelMode,
): Promise<Array<{ durationMinutes: number; distanceMeters: number }>> {
  if (places.length < 2) return [];

  const key = tripLegsCacheKey(places, travelMode);
  try {
    return await routesCache.getOrFetch(key, async () => {
      try {
        const result = await requireTripLegsFn()({ data: { places, travelMode } });
        if (!result.ok || !result.data) {
          warnRouteOnce(
            `${key}|trip_legs`,
            `[ROUTE_DURATION_ERROR] status=${result.statusCode ?? "failed"} message=${result.message ?? "trip_legs_failed"} soft=empty_legs`,
          );
          return [];
        }
        return result.data.map((leg) => ({
          durationMinutes: leg.durationMinutes,
          distanceMeters: leg.distanceMeters,
        }));
      } catch (e) {
        warnRouteOnce(
          `${key}|trip_legs_ex`,
          `[ROUTE_DURATION_ERROR] status=exception message=${e instanceof Error ? e.message : String(e)} soft=empty_legs`,
        );
        return [];
      }
    });
  } catch (e) {
    warnRouteOnce(
      `${key}|cache_ex`,
      `[ROUTE_DURATION_ERROR] status=cache_exception message=${e instanceof Error ? e.message : String(e)} soft=empty_legs`,
    );
    return [];
  }
}

/** 將 UI 交通標籤對應為 Routes travelMode */
export function travelLabelToRoutesMode(label: string): RoutesTravelMode {
  const t = label.trim();
  if (/步行|走路|walk/i.test(t)) return "WALK";
  if (/計程車|共乘|taxi|uber/i.test(t)) return "DRIVE";
  if (/開車|drive|自駕|租車/i.test(t)) return "DRIVE";
  if (/大眾|地鐵|捷運|公車|火車|transit|mrt/i.test(t)) return "TRANSIT";
  if (/機車|scooter|摩托/i.test(t)) return "TWO_WHEELER";
  if (/單車|自行車|bike|bicycle/i.test(t)) return "BICYCLE";
  return "WALK";
}

/** dev：高雄車站 → 駁二，步行 */
export async function testRoutesApiConnection(options?: {
  silent?: boolean;
}): Promise<RoutesTestResult> {
  logGoogleMapsKeyLoadedOnce();

  const result = await requireTestFn()();

  if (!options?.silent) {
    if (result.ok) {
      console.info("✅ API connected");
      console.info(
        "duration:",
        `${result.data.durationMinutes} min (${result.data.durationSeconds}s)`,
      );
      console.info("distanceMeters:", result.data.distanceMeters);
    } else {
      console.error("❌ API failed");
      console.error("status code:", result.statusCode ?? "—");
      console.error("error message:", result.message ?? "unknown");
      if (result.hint) console.error(result.hint);
    }
  }

  if (result.ok) {
    return {
      ok: true,
      durationMinutes: result.data.durationMinutes,
      distanceMeters: result.data.distanceMeters,
    };
  }

  return {
    ok: false,
    statusCode: result.statusCode,
    message: result.message,
    hint: result.hint,
  };
}

/** @deprecated 使用 runApiBootstrap */
export function runDevRoutesAndMapsBootstrap(fns: Parameters<typeof bindRoutesServerFns>[0]): void {
  bindRoutesServerFns(fns);
  logGoogleMapsKeyLoadedOnce();
  if (import.meta.env.DEV) void testRoutesApiConnection();
}

export type { RoutesTravelMode, RouteResult, LegDurationEstimate };
