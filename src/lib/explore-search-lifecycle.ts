/** 探索地圖手動關鍵字搜尋 — request lifecycle（與 nearby / 定位分離） */
export const EXPLORE_TEXT_SEARCH_TIMEOUT_MS = 10_000;

export type ExploreSearchFlightSnapshot = {
  searchInFlight: boolean;
  nearbyInFlight: boolean;
  locationUpdating: boolean;
};

export function logExploreSearchInflightSet(params: {
  requestId: number;
  query: string;
  mode: "text" | "nearby";
}): void {
  console.info("[EXPLORE_SEARCH_INFLIGHT_SET]", params);
}

export function logExploreSearchRequestStart(params: {
  requestId: number;
  rawQuery: string;
  finalQuery: string;
  lat: number;
  lng: number;
  timeoutMs: number;
}): void {
  console.info("[EXPLORE_SEARCH_REQUEST_START]", params);
}

export function logExploreSearchRequestTimeout(params: {
  requestId: number;
  query: string;
  timeoutMs: number;
  message: string;
}): void {
  console.info("[EXPLORE_SEARCH_REQUEST_TIMEOUT]", params);
}

export function logExploreSearchInflightCleared(params: {
  requestId: number;
  query: string;
  reason: string;
}): void {
  console.info("[EXPLORE_SEARCH_INFLIGHT_CLEARED]", params);
}

export function logExploreSearchBlocked(
  reason: string,
  snapshot: ExploreSearchFlightSnapshot & { extra?: Record<string, unknown> },
): void {
  console.info("[EXPLORE_SEARCH_BLOCKED]", {
    reason,
    searchInFlight: snapshot.searchInFlight,
    nearbyInFlight: snapshot.nearbyInFlight,
    locationUpdating: snapshot.locationUpdating,
    ...snapshot.extra,
  });
}
