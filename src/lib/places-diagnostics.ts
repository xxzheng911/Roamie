import type { SearchPlacesInput } from "@/lib/explore-category-search";

let sessionApiCallCount = 0;

const loggedSkipKeys = new Set<string>();
const loggedLocationSkipKeys = new Set<string>();
const loggedCacheHitKeys = new Set<string>();

export function incrementPlacesSessionCallCount(): number {
  sessionApiCallCount += 1;
  return sessionApiCallCount;
}

export function getPlacesSessionCallCount(): number {
  return sessionApiCallCount;
}

export function logPlacesCallCount(): void {
  console.info(`[PLACES_CALL_COUNT] sessionTotal=${sessionApiCallCount}`);
}

export function logPlacesApiCall(
  source: "server" | "client",
  data: SearchPlacesInput,
  extra?: { categoryId?: string },
): void {
  const total = incrementPlacesSessionCallCount();
  const category = extra?.categoryId ?? data.categoryId ?? "";
  const queryLabel =
    data.query?.trim() ||
    (data.mode === "multi" ? "multi_nearby" : data.mode === "nearby" ? "nearby" : "");
  console.info("[PLACES_API_CALL]");
  console.info(`source=${source}`);
  console.info(`category=${category}`);
  console.info(`query=${queryLabel}`);
  console.info("cache=false");
  console.info(`[PLACES_CALL_COUNT] sessionTotal=${total}`);
}

export function logPlacesCacheHitSimple(
  source: "server" | "client" | "api",
  data: Pick<SearchPlacesInput, "query" | "categoryId" | "mode">,
): void {
  const category = data.categoryId ?? "";
  const query =
    data.query?.trim() ||
    (data.mode === "multi" ? "multi_nearby" : data.mode === "nearby" ? "nearby" : "");
  console.info("[PLACES_CACHE_HIT]");
  console.info(`source=${source}`);
  console.info(`category=${category}`);
  console.info(`query=${query}`);
}

/** @deprecated 使用 logPlacesApiCall */
export function incrementPlacesApiCallCount(): void {
  incrementPlacesSessionCallCount();
}

/** @deprecated */
export function incrementPlacesApiResultCount(): void {}

export function incrementFilterRunCount(): void {}

export function incrementHomeRenderCount(): void {}

export function logPlacesHomeDiagnosticCounts(context?: string): void {
  console.info(`[PLACES_CALL_COUNT] sessionTotal=${getPlacesSessionCallCount()}`);
  if (context) console.info("[PLACES_HOME_DIAGNOSTICS]", { context });
}

/** @deprecated 使用 logPlacesApiCall */
export function logPlacesRequest(
  source: "server" | "client",
  data: SearchPlacesInput,
  extra?: Record<string, unknown>,
): void {
  logPlacesApiCall(source, data, {
    categoryId: typeof extra?.categoryId === "string" ? extra.categoryId : data.categoryId,
  });
}

/** @deprecated */
export function logPlacesResponse(
  _source: "server" | "client" | "cache",
  _data: SearchPlacesInput,
  result: { places?: unknown[] | null; error?: string | null } | null | undefined,
): void {
  if (result && Array.isArray(result.places) && result.places.length === 0 && result.error) {
    console.info(`[PLACES_API_EMPTY] error=${result.error}`);
  }
}

function skipLogKey(reason: string, detail: Record<string, unknown>): string {
  const id = detail.key ?? detail.locationKey ?? detail.loadKey;
  return `${reason}:${String(id ?? "")}`;
}

export function logPlacesCacheHit(
  key: string,
  _count: number,
  layer: "api" | "map_category" | "category",
  meta?: Pick<SearchPlacesInput, "query" | "categoryId" | "mode">,
): void {
  if (layer === "map_category") return;
  const dedupeKey = `${layer}:${key}`;
  if (loggedCacheHitKeys.has(dedupeKey)) return;
  loggedCacheHitKeys.add(dedupeKey);
  if (meta) {
    logPlacesCacheHitSimple(layer === "api" ? "api" : "client", meta);
    return;
  }
  console.info("[PLACES_CACHE_HIT]");
  console.info(`source=${layer}`);
  console.info(`category=`);
  console.info(`query=${key}`);
}

export function logPlacesApiSkipDuplicate(
  reason: "cache" | "in_flight" | "failed_ttl" | "client_fallback" | "nearby_ttl" | "nearby_in_flight",
  detail: Record<string, unknown>,
): void {
  const dedupeKey = skipLogKey(reason, detail);
  if (loggedSkipKeys.has(dedupeKey)) return;
  loggedSkipKeys.add(dedupeKey);
  console.info("[PLACES_API_SKIP]", { reason, ...detail });
}

export function logLocationUpdateSkipOnce(locationKey: string): void {
  if (loggedLocationSkipKeys.has(locationKey)) return;
  loggedLocationSkipKeys.add(locationKey);
  console.info("[LOCATION_UPDATE_SKIP_SAME_BUCKET]", { locationKey });
}

export function logHomeNearbyDataReady(detail: {
  count: number;
  lat: number;
  lng: number;
  locationKey?: string;
  sample?: string[];
  categories: string[];
  fromMock?: boolean;
  error?: string | null;
  cacheKey?: string;
  fromCache?: boolean;
}): void {
  if (detail.fromCache) return;
  const dedupeKey = detail.cacheKey ?? `${detail.lat.toFixed(3)}:${detail.lng.toFixed(3)}:${detail.count}`;
  if (loggedHomeNearbyReadyKeys.has(dedupeKey)) return;
  loggedHomeNearbyReadyKeys.add(dedupeKey);
  console.info("[HOME_NEARBY_READY]", detail);
}

const loggedHomeNearbyLoadKeys = new Set<string>();
const loggedHomeNearbyReadyKeys = new Set<string>();

export function logHomeNearbyLoadOnce(detail: {
  locationKey: string;
  loadKey: string;
  caller?: string;
  categories: string[];
}): void {
  if (loggedHomeNearbyLoadKeys.has(detail.loadKey)) return;
  loggedHomeNearbyLoadKeys.add(detail.loadKey);
  console.info("[HOME_NEARBY_LOAD_ONCE]", detail);
}

export function logMapNearbyReady(detail: {
  count: number;
  locationKey: string;
  categoryId: string;
  query: string;
  fromCache?: boolean;
}): void {
  if (detail.fromCache) return;
  console.info("[MAP_NEARBY_READY]", detail);
}
