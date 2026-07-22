import type { ScoredCandidate } from "@/lib/recommendation/engine/types";

/**
 * diversify — 避免同類型連續推薦。
 * R0：pass-through。
 */
export function diversifyCandidates(
  ranked: readonly ScoredCandidate[],
): ScoredCandidate[] {
  return [...ranked];
}
