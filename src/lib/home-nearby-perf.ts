/** 首頁附近地點單次載入效能時間點 */

export type HomeNearbyLocationSource = "memory" | "disk" | "native" | "fresh" | "unknown";

export type HomeNearbyPerfSession = {
  requestId: string;
  startedAt: number;
  hasCache: boolean;
  locationSource: HomeNearbyLocationSource;
  cacheRendered: boolean;
  firstCardRendered: boolean;
  searchReady: boolean;
  allEnriched: boolean;
  placesSearchCalls: number;
  skippedCount: number;
};

let activeSession: HomeNearbyPerfSession | null = null;
let placesSearchCallTotal = 0;
let skippedTotal = 0;

function elapsed(session: HomeNearbyPerfSession): number {
  return Math.round(Date.now() - session.startedAt);
}

function newRequestId(): string {
  return `hn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function beginHomeNearbyPerfLoad(args: {
  hasCache: boolean;
  locationSource: HomeNearbyLocationSource;
}): HomeNearbyPerfSession {
  const session: HomeNearbyPerfSession = {
    requestId: newRequestId(),
    startedAt: Date.now(),
    hasCache: args.hasCache,
    locationSource: args.locationSource,
    cacheRendered: false,
    firstCardRendered: false,
    searchReady: false,
    allEnriched: false,
    placesSearchCalls: 0,
    skippedCount: 0,
  };
  activeSession = session;
  console.info(
    `[HOME_NEARBY_LOAD_START] requestId=${session.requestId} hasCache=${args.hasCache} locationSource=${args.locationSource}`,
  );
  return session;
}

export function getActiveHomeNearbyPerfSession(): HomeNearbyPerfSession | null {
  return activeSession;
}

export function logHomeNearbyCacheRendered(count: number, session = activeSession): void {
  if (!session || session.cacheRendered) return;
  session.cacheRendered = true;
  console.info(
    `[HOME_NEARBY_CACHE_RENDERED] requestId=${session.requestId} count=${count} elapsedMs=${elapsed(session)}`,
  );
}

export function logHomeNearbyLocationReady(session = activeSession): void {
  if (!session) return;
  console.info(
    `[HOME_NEARBY_LOCATION_READY] requestId=${session.requestId} elapsedMs=${elapsed(session)} locationSource=${session.locationSource}`,
  );
}

export function logHomeNearbySearchReady(count: number, session = activeSession): void {
  if (!session || session.searchReady) return;
  session.searchReady = true;
  console.info(
    `[HOME_NEARBY_SEARCH_READY] requestId=${session.requestId} count=${count} elapsedMs=${elapsed(session)}`,
  );
}

/** 主要效能指標：第一張有效卡片出現 */
export function logHomeNearbyFirstCardRendered(count: number, session = activeSession): void {
  if (!session || session.firstCardRendered) return;
  session.firstCardRendered = true;
  console.info(
    `[HOME_NEARBY_FIRST_CARD_RENDERED] requestId=${session.requestId} count=${count} elapsedMs=${elapsed(session)}`,
  );
}

export function logHomeNearbyAllEnriched(count: number, session = activeSession): void {
  if (!session || session.allEnriched) return;
  session.allEnriched = true;
  console.info(
    `[HOME_NEARBY_ALL_ENRICHED] requestId=${session.requestId} count=${count} elapsedMs=${elapsed(session)}`,
  );
}

export function logHomeNearbyRequestSkipped(
  reason: "in_flight" | "same_key" | "fresh_cache" | "policy_skip",
  session = activeSession,
): void {
  skippedTotal += 1;
  if (session) session.skippedCount += 1;
  const requestId = session?.requestId ?? "none";
  console.info(`[HOME_NEARBY_REQUEST_SKIPPED] requestId=${requestId} reason=${reason}`);
}

export function logHomeNearbyRefreshFailed(
  reason: string,
  keptCachedResults: boolean,
  session = activeSession,
): void {
  const requestId = session?.requestId ?? "none";
  console.info(
    `[HOME_NEARBY_REFRESH_FAILED] requestId=${requestId} reason=${reason} keptCachedResults=${keptCachedResults}`,
  );
}

export function noteHomeNearbyPlacesSearchCall(session = activeSession): void {
  placesSearchCallTotal += 1;
  if (session) session.placesSearchCalls += 1;
}

export function getHomeNearbyPerfTotals(): {
  placesSearchCalls: number;
  skippedCount: number;
} {
  return { placesSearchCalls: placesSearchCallTotal, skippedCount: skippedTotal };
}
