import type { RecommendationCandidate } from "@/lib/recommendation/engine/types";

/**
 * deduplicate — 移除重複地點（中英文名稱、同 Place ID、同地標異名等）。
 * R0：pass-through（避免改變現況 Explore 列表）。
 */
export function deduplicateCandidates(
  candidates: readonly RecommendationCandidate[],
): RecommendationCandidate[] {
  return [...candidates];
}
