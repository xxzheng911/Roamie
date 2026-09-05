export type HomeNearbyRenderState = "cached" | "loading" | "fresh" | "empty" | "error";

export function logHomeNearbyCacheHit(count: number, ageMs: number): void {
  console.info(`[HOME_NEARBY_CACHE_HIT] count=${count} ageMs=${ageMs}`);
}

export function logHomeNearbyCacheMiss(reason: string): void {
  console.info(`[HOME_NEARBY_CACHE_MISS] reason=${reason}`);
}

export function logHomeNearbyRequestStart(args: {
  location: string;
  source: string;
  forceRefresh: boolean;
  bucket?: string;
}): void {
  const bucket = args.bucket ? ` bucket=${args.bucket}` : "";
  console.info(
    `[HOME_NEARBY_REQUEST_START] location=${args.location} source=${args.source} forceRefresh=${args.forceRefresh}${bucket}`,
  );
}

export function logHomeNearbyRequestSuccess(rawCount: number, filteredCount: number): void {
  console.info(
    `[HOME_NEARBY_REQUEST_SUCCESS] rawCount=${rawCount} filteredCount=${filteredCount}`,
  );
}

export function logHomeNearbyRequestError(code: string, message: string): void {
  console.info(`[HOME_NEARBY_REQUEST_ERROR] code=${code} message=${message}`);
}

export function logHomeNearbyFilterDrop(placeName: string, types: string, reason: string): void {
  console.info(
    `[HOME_NEARBY_FILTER_DROP] placeName=${placeName} types=${types} reason=${reason}`,
  );
}

export function logHomeNearbyOperationalDiagnostic(args: {
  canonicalPlaceId: string;
  businessStatus: string;
  openStatus: string;
  statusSource: string;
  cacheCapability: string;
  cacheAgeBucket: string;
  operationalEligible: boolean;
  currentOpenEligible: boolean;
  factualSource: "search" | "runtime_cache" | "persisted_home" | "detail_refresh";
}): void {
  console.info("[HOME_NEARBY_OPERATIONAL_DIAGNOSTIC]", args);
}

export function logHomeNearbyRender(state: HomeNearbyRenderState): void {
  console.info(`[HOME_NEARBY_RENDER] state=${state}`);
}
