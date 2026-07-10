import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export const FALLBACK_PLANNING_PLACE_ID_PREFIXES = [
  "local-life-fallback:",
  "slow-nature-fallback:",
  "classic-fallback:",
  "mixed-fallback:",
] as const;

export function isFallbackPlanningPlaceId(placeId: string | undefined | null): boolean {
  const id = (placeId ?? "").trim();
  if (!id) return false;
  return FALLBACK_PLANNING_PLACE_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function isHardGooglePlaceId(placeId: string | undefined | null): boolean {
  const id = (placeId ?? "").trim();
  if (!id || isFallbackPlanningPlaceId(id)) return false;
  if (
    id.startsWith("synthetic:") ||
    id.startsWith("landmark-cache:") ||
    id.startsWith("core:") ||
    id.startsWith("name:") ||
    id.startsWith("dayplan:") ||
    id.startsWith("latlng:") ||
    id.startsWith("saved-")
  ) {
    return false;
  }
  return true;
}

export function logPlaceDetailsSkipFallbackId(placeId: string): void {
  logAiPipeline("[PLACE_DETAILS_SKIP_FALLBACK_ID]", `placeId=${placeId}`);
}

export function logPlaceDetailsHttp400Ignored(placeId: string): void {
  logAiPipeline("[PLACE_DETAILS_HTTP_400_IGNORED]", `placeId=${placeId}`);
}

export function logPlaceDetailsPartialFailureIgnored(placeId: string, reason?: string): void {
  logAiPipeline(
    "[PLACE_DETAILS_PARTIAL_FAILURE_IGNORED]",
    `placeId=${placeId}`,
    reason ? `reason=${reason}` : "",
  );
}

export function logGeocodeEmptyIgnored(name: string, placeId?: string): void {
  logAiPipeline(
    "[GEOCODE_EMPTY_IGNORED]",
    `name=${name}`,
    placeId ? `placeId=${placeId}` : "",
  );
}

export function logPlannerClearPrevented(reason: string, places: number, days: number): void {
  logAiPipeline(
    "[PLANNER_CLEAR_PREVENTED]",
    `reason=${reason}`,
    `places=${places}`,
    `days=${days}`,
  );
}

export function logItineraryRenderWithPartialDetails(itemCount: number): void {
  logAiPipeline("[ITINERARY_RENDER_WITH_PARTIAL_DETAILS]", `items=${itemCount}`);
}
