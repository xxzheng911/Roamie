/** Only bounded categories; never accept query, URL, credentials or identity. */
export type CoverDiagnostic = {
  query_stage?: "native" | "canonical" | "generic";
  attempt_index?: 1 | 2 | 3;
  cache_hit?: boolean;
  cached_source?: "unsplash" | "roamie" | "none";
  http_status_class?: "2xx" | "4xx" | "5xx" | "other" | "none";
  result_count_bucket?: "0" | "1" | "2-5" | "6+";
  candidate_accepted?: boolean;
  candidate_rejected?: boolean;
  fallback_reason?: "empty" | "unusable_url" | "malformed" | "auth" | "rate_limited" | "http_error" | "network" | "timeout" | "negative_cache";
  final_source?: "unsplash" | "roamie";
};
export function coverDiagnostic(event: CoverDiagnostic): void {
  try { console.warn("[TRIP_COVER_RESOLUTION]", event); } catch { /* Observation never changes resolution. */ }
}
