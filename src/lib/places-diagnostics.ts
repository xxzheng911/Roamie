import type { SearchPlacesInput } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";
import { normalizePlacesSearchResult } from "@/lib/places-search-normalize";

const placesHomeDiagnostics = {
  apiCallCount: 0,
  apiResultCount: 0,
  filterRunCount: 0,
  homeRenderCount: 0,
};

export function incrementPlacesApiCallCount(): void {
  placesHomeDiagnostics.apiCallCount += 1;
}

export function incrementPlacesApiResultCount(): void {
  placesHomeDiagnostics.apiResultCount += 1;
}

export function incrementFilterRunCount(): void {
  placesHomeDiagnostics.filterRunCount += 1;
}

export function incrementHomeRenderCount(): void {
  placesHomeDiagnostics.homeRenderCount += 1;
}

/** 輸出首頁 Places 診斷計數（比對 API 是否重複呼叫 vs filter log 洗版） */
export function logPlacesHomeDiagnosticCounts(context?: string): void {
  console.info("[PLACES_API_CALL_COUNT]", placesHomeDiagnostics.apiCallCount);
  console.info("[PLACES_API_RESULT_COUNT]", placesHomeDiagnostics.apiResultCount);
  console.info("[HOME_RENDER_COUNT]", placesHomeDiagnostics.homeRenderCount);
  console.info("[FILTER_RUN_COUNT]", placesHomeDiagnostics.filterRunCount);
  if (context) {
    console.info("[PLACES_HOME_DIAGNOSTICS]", { context, ...placesHomeDiagnostics });
  }
}

export function logPlacesRequest(
  source: "server" | "client",
  data: SearchPlacesInput,
  extra?: Record<string, unknown>,
): void {
  incrementPlacesApiCallCount();
  console.info("[PLACES_API_CALL]", {
    source,
    lat: data.lat,
    lng: data.lng,
    radius: data.radius,
    mode: data.mode,
    query: data.query,
    includedTypes: data.includedTypes ?? [],
    locale: data.locale ?? null,
    ...extra,
  });
}

export function logPlacesResponse(
  source: "server" | "client" | "cache",
  data: SearchPlacesInput,
  result: { places?: PlaceResult[] | null; error?: string | null } | null | undefined,
  extra?: Record<string, unknown>,
): void {
  if (source === "cache") return;
  const normalized = normalizePlacesSearchResult(result);
  incrementPlacesApiResultCount();
  console.info("[PLACES_API_RESULT]", {
    source,
    lat: data.lat,
    lng: data.lng,
    mode: data.mode,
    query: data.query,
    status: normalized.error ? "error" : "ok",
    count: normalized.places.length,
    error: normalized.error,
    sample: normalized.places.slice(0, 2).map((p) => p.name),
    ...extra,
  });
  if (source === "client") {
    console.info("[PLACES_FALLBACK_RESPONSE]", {
      lat: data.lat,
      lng: data.lng,
      mode: data.mode,
      query: data.query,
      count: normalized.places.length,
      ...extra,
    });
  }
}

export function logPlacesApiSkipDuplicate(
  reason: "cache" | "in_flight" | "failed_ttl" | "client_fallback" | "nearby_ttl" | "nearby_in_flight",
  detail: Record<string, unknown>,
): void {
  console.info("[PLACES_API_SKIP_DUPLICATE]", { reason, ...detail });
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
}): void {
  console.info("[HOME_NEARBY_READY]", detail);
}

export function logHomeNearbyLoadOnce(detail: {
  locationKey: string;
  loadKey: string;
  caller?: string;
  categories: string[];
}): void {
  console.info("[HOME_NEARBY_LOAD_ONCE]", detail);
}

export function logMapNearbyReady(detail: {
  count: number;
  locationKey: string;
  categoryId: string;
  query: string;
  fromCache?: boolean;
}): void {
  console.info("[MAP_NEARBY_READY]", detail);
}
