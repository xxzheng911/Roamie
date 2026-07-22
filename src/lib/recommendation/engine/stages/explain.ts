import { buildRecommendationReasons } from "@/lib/recommendation/engine/reasons";
import {
  attachScoreBreakdown,
  type ScoredCandidate,
} from "@/lib/recommendation/engine/types";

/**
 * explain — 輸出結構化 RecommendationReason。
 * 不組完整句子；UI / AI 決定如何呈現。
 * 可讀取 scoreBreakdown 供未來擴充。
 */
export function explainCandidates(
  ranked: readonly ScoredCandidate[],
): ScoredCandidate[] {
  return ranked.map((item) => {
    const scoreBreakdown = item.scoreBreakdown ?? item.breakdown ?? {};
    const base = {
      ...item,
      ...attachScoreBreakdown(scoreBreakdown),
    };

    if (item.reasons.length > 0) {
      return { ...base, reasons: [...item.reasons] };
    }

    if (item.factorScores && item.effectiveWeights) {
      return {
        ...base,
        reasons: buildRecommendationReasons({
          factorScores: item.factorScores,
          weights: item.effectiveWeights,
          openStatus: item.candidate.openStatus,
        }),
      };
    }

    if (scoreBreakdown.order != null) {
      return {
        ...base,
        reasons: [{ code: "legacy_sort", strength: 1 }],
      };
    }

    // Planner P1：trip-place-scoring 分項 → 對應 reason codes（結構化，非句子）
    if (
      scoreBreakdown.style != null ||
      scoreBreakdown.rating != null ||
      scoreBreakdown.hours != null
    ) {
      const reasons = [];
      if ((scoreBreakdown.hours ?? 0) > 0.03) {
        reasons.push({ code: "open_now" as const, strength: Math.min(1, (scoreBreakdown.hours ?? 0) / 0.06), factor: "open" as const });
      }
      if ((scoreBreakdown.route ?? 0) > 0.02) {
        reasons.push({ code: "nearby" as const, strength: Math.min(1, (scoreBreakdown.route ?? 0) / 0.04), factor: "distance" as const });
      }
      if ((scoreBreakdown.rating ?? 0) > 0.03) {
        reasons.push({ code: "high_rating" as const, strength: Math.min(1, (scoreBreakdown.rating ?? 0) / 0.05), factor: "rating" as const });
      }
      if ((scoreBreakdown.popularity ?? 0) > 0.02) {
        reasons.push({ code: "many_reviews" as const, strength: Math.min(1, (scoreBreakdown.popularity ?? 0) / 0.05), factor: "reviews" as const });
      }
      return {
        ...base,
        reasons: reasons.length > 0 ? reasons : [{ code: "reserved" as const, strength: 0 }],
      };
    }

    return {
      ...base,
      reasons: [{ code: "reserved", strength: 0 }],
    };
  });
}
