import { devVerboseInfo } from "@/lib/dev-verbose-log";

export type CoverTraceContext = {
  correlationId: string;
  sourceType: "custom" | "remote" | "bundled" | "none";
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
  return { correlationId: context.correlationId, sourceType: context.sourceType,
    hasUrl: Boolean(url), hostname, loadingStatus: status, fallbackReason: reason, isCurrentVersion };
}
export function traceCover(context: CoverTraceContext | undefined, event: CoverTraceEvent,
  url: string | null | undefined, status: Parameters<typeof coverRuntimeRecord>[2],
  reason: CoverTraceReason = "none", isCurrentVersion = true): void {
  if (!context) return;
  try { devVerboseInfo(`[${event}]`, coverRuntimeRecord(context, url, status, reason, isCurrentVersion)); }
  catch { /* Observability must never affect rendering. */ }
}
