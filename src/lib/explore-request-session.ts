import { devVerboseInfo } from "@/lib/dev-verbose-log";
/** Explore work ownership. Cancellation survives route state changes and queued requests. */
export type ExploreRequestSession = {
  id: string;
  mode: "search" | "browse";
  query: string;
  controller: AbortController;
  startedAt: number;
  grantStarted: boolean;
  foregroundRequests: number;
  backgroundRequests: number;
  dedupedRequests: number;
  abortedRequests: number;
  blockedRequests: number;
  primaryResultMs: number | null;
  totalRequestsBeforePrimary: number | null;
  categoryRequests: Map<string, number>;
};
const sessions = new Map<string, ExploreRequestSession>();
let sequence = 0;
let active: ExploreRequestSession | null = null;
export const EXPLORE_BROWSE_PROVIDER_BUDGET = 10;
export const EXPLORE_CATEGORY_PROVIDER_BUDGET = 2;
export const EXPLORE_SEARCH_DEBOUNCE_MS = 320;

export function beginExploreRequestSession(mode: "search" | "browse", query = "") {
  if (active && !active.controller.signal.aborted) {
    active.controller.abort();
    if (active.foregroundRequests || active.backgroundRequests)
      reportExploreSearchSession(active, "superseded");
  }
  const session: ExploreRequestSession = {
    id: `explore_${Date.now().toString(36)}_${++sequence}`,
    mode,
    query,
    controller: new AbortController(),
    startedAt: performance.now(),
    grantStarted: false,
    foregroundRequests: 0,
    backgroundRequests: 0,
    dedupedRequests: 0,
    abortedRequests: 0,
    blockedRequests: 0,
    primaryResultMs: null,
    totalRequestsBeforePrimary: null,
    categoryRequests: new Map(),
  };
  active = session;
  sessions.set(session.id, session);
  if (sessions.size > 64) sessions.delete(sessions.keys().next().value!);
  return session;
}
export function getExploreRequestSession(id?: string) {
  return id ? sessions.get(id) : undefined;
}
export function canRunExploreBrowse(query: string, explicitSearchActive: boolean) {
  return !query.trim() && !explicitSearchActive;
}
export function exploreSessionCanRequest(session: ExploreRequestSession, category = "all") {
  return (
    !session.controller.signal.aborted &&
    (session.mode === "search" ||
      (session.backgroundRequests < EXPLORE_BROWSE_PROVIDER_BUDGET &&
        (session.categoryRequests.get(category) ?? 0) < EXPLORE_CATEGORY_PROVIDER_BUDGET))
  );
}
export function assertExploreSessionActive(session: ExploreRequestSession, category = "all") {
  if (!exploreSessionCanRequest(session, category)) {
    throw new DOMException("Explore work superseded or budget exhausted", "AbortError");
  }
}
export function markExplorePrimaryResult(session: ExploreRequestSession) {
  if (session.controller.signal.aborted || session.primaryResultMs !== null) return;
  session.primaryResultMs = Math.round(performance.now() - session.startedAt);
  session.totalRequestsBeforePrimary = session.foregroundRequests + session.backgroundRequests;
  reportExploreSearchSession(session, "primary");
}
export function reportExploreSearchSession(session: ExploreRequestSession, phase: string) {
  if (session.mode !== "search") return;
  devVerboseInfo("[EXPLORE_SEARCH_SESSION]", {
    phase,
    searchSessionId: session.id,
    query: session.query,
    foregroundRequests: session.foregroundRequests,
    backgroundRequests: session.backgroundRequests,
    dedupedRequests: session.dedupedRequests,
    abortedRequests: session.abortedRequests,
    blockedRequests: session.blockedRequests,
    primaryResultMs: session.primaryResultMs,
    totalRequestsBeforePrimary:
      session.totalRequestsBeforePrimary ?? session.foregroundRequests + session.backgroundRequests,
  });
}
/** Only dragend (not center_changed/idle/panTo) can request a browse refresh. */
export function shouldRefreshExploreFromMap(
  source: "userGesture" | "searchSelection",
  query: string,
) {
  return source === "userGesture" && !query.trim();
}
