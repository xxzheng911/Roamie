import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export function logCandidatePoolCreated(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[CANDIDATE_POOL_CREATED]", formatDetail(detail));
}

export function logCandidatePoolCacheHit(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[CANDIDATE_POOL_CACHE_HIT]", formatDetail(detail));
}

export function logCandidatePoolCacheMiss(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[CANDIDATE_POOL_CACHE_MISS]", formatDetail(detail));
}

export function logDestinationCacheHit(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[DESTINATION_CACHE_HIT]", formatDetail(detail));
}

export function logDestinationCacheMiss(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[DESTINATION_CACHE_MISS]", formatDetail(detail));
}

export function logCombinationCacheHit(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[COMBINATION_CACHE_HIT]", formatDetail(detail));
}

export function logCombinationCacheMiss(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[COMBINATION_CACHE_MISS]", formatDetail(detail));
}

export function logPlacesSearchSkipped(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[PLACES_SEARCH_SKIPPED]", formatDetail(detail));
}

export function logPlacesRateProtection(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[PLACES_RATE_PROTECTION]", formatDetail(detail));
}

export function logSessionPoolReused(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[SESSION_POOL_REUSED]", formatDetail(detail));
}

export function logCandidatePoolIngest(detail: Record<string, string | number | boolean>): void {
  logAiPipeline("[CANDIDATE_POOL_INGEST]", formatDetail(detail));
}

function formatDetail(detail: Record<string, string | number | boolean>): string {
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : String(v)}`)
    .join(" ");
}
