import {
  attachScoreBreakdown,
  type RecommendationCandidate,
  type RecommendationContext,
  type ScoredCandidate,
} from "@/lib/recommendation/engine/types";

export type ExploreScoreFn = (
  candidates: readonly RecommendationCandidate[],
  ctx: RecommendationContext,
) => ScoredCandidate[];

/**
 * score — 計算推薦分數。
 * Adapter 可注入 scoreFn（Explore / Planner P1 委派既有排序）。
 */
export function scoreCandidates(
  candidates: readonly RecommendationCandidate[],
  ctx: RecommendationContext,
  scoreFn?: ExploreScoreFn,
): ScoredCandidate[] {
  if (scoreFn) {
    return scoreFn(candidates, ctx);
  }

  const n = candidates.length;
  return candidates.map((candidate, index) => ({
    candidate,
    score: n - index,
    reasons: [],
    ...attachScoreBreakdown({ order: n - index }),
  }));
}
