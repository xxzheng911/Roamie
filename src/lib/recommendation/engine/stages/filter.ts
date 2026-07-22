import type { RecommendationCandidate } from "@/lib/recommendation/engine/types";

/**
 * filter — 營業時間、黑名單、類別排除等。
 * R0：pass-through（現況 Explore sort 不做額外 filter）。
 */
export function filterCandidates(
  candidates: readonly RecommendationCandidate[],
): RecommendationCandidate[] {
  return [...candidates];
}
