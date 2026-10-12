import { devVerboseInfo } from "@/lib/dev-verbose-log";

export type CoverSurface = "trip_detail" | "saved_card" | "home_card" | "other";
export type CoverTraceContext = {
  correlationId: string;
  sourceType: "custom" | "remote" | "bundled" | "none";
  /** Which screen renders the cover; never a trip/user identifier. */
  surface?: CoverSurface;
};
export type CoverTraceEvent = "COVER_SOURCE_SELECTED" | "COVER_IMAGE_LOAD_START" |
  "COVER_IMAGE_LOAD_SUCCESS" | "COVER_IMAGE_LOAD_FAILURE" | "COVER_FALLBACK_APPLIED" | "COVER_ASYNC_UPDATE";
export type CoverTraceReason = "none" | "missing_url" | "invalid_url" | "failed_url_cache" |
  "image_error" | "fallback_exhausted" | "stale_callback" | "source_changed" | "loading_state_changed";

export function coverSourceType(url?: string | null): CoverTraceContext["sourceType"] {
  if (!url) return "none";
  return /^https?:\/\//i.test(url) ? "remote" : "bundled";
}
/** Never emit paths, query strings, URL credentials, trip IDs, or payloads. */
export function coverRuntimeRecord(context: CoverTraceContext, url: string | null | undefined,
  status: "pending" | "loading" | "loaded" | "failed" | "fallback",
  reason: CoverTraceReason = "none", isCurrentVersion = true) {
  let hostname: string | null = null;
  try {
    const parsed = new URL(url ?? "");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") hostname = parsed.hostname;
  } catch { /* Bundled and missing sources have no remote hostname. */ }
  return { correlationId: context.correlationId, surface: context.surface ?? "other", sourceType: context.sourceType,
    hasUrl: Boolean(url), hostname, loadingStatus: status, fallbackReason: reason, isCurrentVersion };
}
export function traceCover(context: CoverTraceContext | undefined, event: CoverTraceEvent,
  url: string | null | undefined, status: Parameters<typeof coverRuntimeRecord>[2],
  reason: CoverTraceReason = "none", isCurrentVersion = true): void {
  if (!context) return;
  try { devVerboseInfo(`[${event}]`, coverRuntimeRecord(context, url, status, reason, isCurrentVersion)); }
  catch { /* Observability must never affect rendering. */ }
}

export type CoverLiveDecision = {
  surface: CoverSurface;
  liveCoverStatus: "none" | "pending" | "resolved" | "fallback";
  currentSourceType: CoverTraceContext["sourceType"];
  incomingSourceType: CoverTraceContext["sourceType"];
  versionComparison: "no_live" | "stored_newer" | "same" | "live_newer";
  updateAccepted: boolean;
  decisionReason:
    | "no_live_update"
    | "adopted_newer_row_cover"
    | "no_image_in_update"
    | "pending_resolution"
    | "same_as_current"
    | "applied";
};

/**
 * Pure mirror of the Trip Detail live-cover handling (SavedTripItineraryEditor). It only
 * describes the decision; the caller's state handling stays the single authority.
 */
export function coverLiveDecision(input: {
  surface: CoverSurface;
  live: { resolution: "pending" | "resolved" | "fallback"; updatedAt: string } | null | undefined;
  storedRevision: number;
  liveRevision: number;
  currentUrl: string | null | undefined;
  incomingUrl: string | null | undefined;
  incomingCustomized: boolean;
}): CoverLiveDecision {
  const sourceOf = (url: string | null | undefined, custom: boolean) =>
    custom && url ? "custom" as const : coverSourceType(url);
  const base = {
    surface: input.surface,
    liveCoverStatus: input.live?.resolution ?? "none",
    currentSourceType: coverSourceType(input.currentUrl),
    incomingSourceType: sourceOf(input.incomingUrl, input.incomingCustomized),
  } as const;
  if (!input.live) {
    return { ...base, versionComparison: "no_live", updateAccepted: false, decisionReason: "no_live_update" };
  }
  if (input.storedRevision > input.liveRevision) {
    // The older live patch is not applied; the newer row's own persisted cover is shown.
    return { ...base, versionComparison: "stored_newer", updateAccepted: true, decisionReason: "adopted_newer_row_cover" };
  }
  const versionComparison = input.storedRevision === input.liveRevision ? "same" : "live_newer";
  const decisionReason = !input.incomingUrl
    ? "no_image_in_update"
    : input.live.resolution === "pending"
      ? "pending_resolution"
      : input.incomingUrl === input.currentUrl
        ? "same_as_current"
        : "applied";
  return { ...base, versionComparison, updateAccepted: true, decisionReason };
}

/** Debug-only (devVerboseInfo); records enumerated fields, never URLs or identifiers. */
export function traceCoverLiveDecision(decision: CoverLiveDecision): void {
  try { devVerboseInfo("[COVER_LIVE_STATE_DECISION]", decision); }
  catch { /* Observability must never affect rendering. */ }
}
