/**
 * Google Routes API — 統一服務層（透過 serverFn，不在 component 內直接 fetch）
 */
import { logGoogleMapsKeyLoadedOnce } from "@/lib/google-maps-key-resolve";
import type { LegDurationEstimate, RouteResult, RoutesTravelMode } from "@/lib/routes/types";
import { routesCache, routesCacheKey, tripLegsCacheKey } from "@/services/routesCache";

export type LatLng = { lat: number; lng: number };

export type RoutesTestResult =
  | { ok: true; durationMinutes: number; distanceMeters: number }
  | { ok: false; statusCode?: number; message: string; hint?: string };

type RoutesFnResult =
  | { ok: true; data: RouteResult }
  | { ok: false; statusCode: number; message: string; hint?: string };

type DurationFn = (args: {
  data: { origin: LatLng; destination: LatLng; travelMode: RoutesTravelMode };
}) => Promise<RoutesFnResult>;

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

type TestFn = () => Promise<RoutesFnResult>;

let boundDuration: DurationFn | null = null;
let boundDistance: DistanceFn | null = null;
let boundTripLegs: TripLegsFn | null = null;
let boundTest: TestFn | null = null;

export function bindRoutesServerFns(fns: {
  computeDuration: DurationFn;
  computeDistance: DistanceFn;
  computeTripLegs: TripLegsFn;
  testConnection: TestFn;
}): void {
  boundDuration = fns.computeDuration;
  boundDistance = fns.computeDistance;
  boundTripLegs = fns.computeTripLegs;
  boundTest = fns.testConnection;
}

function requireDurationFn(): DurationFn {
  if (!boundDuration) {
    throw new Error("routesService: call bindRoutesServerFns() before using Routes API");
  }
  return boundDuration;
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

/** 取得兩點間路程時間（分鐘） */
export async function getRouteDuration(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<number | null> {
  const key = routesCacheKey(origin, destination, travelMode);
  return routesCache.getOrFetch(key, async () => {
    const api = await requireDurationFn()({ data: { origin, destination, travelMode } });
    const route = unwrapRoute(api);
    return route?.durationMinutes ?? null;
  });
}

/** 取得兩點間距離（公尺） */
export async function getRouteDistance(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): Promise<number | null> {
  const key = `dist:${routesCacheKey(origin, destination, travelMode)}`;
  return routesCache.getOrFetch(key, async () => {
    const result = await requireDistanceFn()({ data: { origin, destination, travelMode } });
    if (!result.ok || !result.data) return null;
    return result.data.distanceMeters;
  });
}

/** 依序計算行程中相鄰地點的路段時間 */
export async function getTripLegsWithDurations(
  places: LatLng[],
  travelMode: RoutesTravelMode,
): Promise<Array<{ durationMinutes: number; distanceMeters: number }>> {
  if (places.length < 2) return [];

  const key = tripLegsCacheKey(places, travelMode);
  return routesCache.getOrFetch(key, async () => {
    const result = await requireTripLegsFn()({ data: { places, travelMode } });
    if (!result.ok || !result.data) return [];
    return result.data.map((leg) => ({
      durationMinutes: leg.durationMinutes,
      distanceMeters: leg.distanceMeters,
    }));
  });
}

/** 將 UI 交通標籤對應為 Routes travelMode */
export function travelLabelToRoutesMode(label: string): RoutesTravelMode {
  const t = label.trim();
  if (/步行|走路|walk/i.test(t)) return "WALK";
  if (/開車|drive|自駕/i.test(t)) return "DRIVE";
  if (/大眾|地鐵|捷運|公車|火車|transit|mrt/i.test(t)) return "TRANSIT";
  if (/機車|scooter|摩托/i.test(t)) return "TWO_WHEELER";
  if (/單車|自行車|bike/i.test(t)) return "BICYCLE";
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
