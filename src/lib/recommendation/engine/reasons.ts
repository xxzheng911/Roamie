/**
 * Structured RecommendationReason — Explain 輸出機器可讀結構。
 * 禁止在此組完整句子；UI / AI 決定如何呈現。
 *
 * 語意對照（非輸出字串）：
 * - open_now → 營業中
 * - closing_soon → 即將打烊
 * - nearby → 距離近
 * - high_rating → 評分高
 * - many_reviews → 評論數多
 * - memory_match → 符合旅行記憶偏好
 * - dna_match → 符合旅行 DNA 傾向
 */

import type { WeightFactorKey } from "@/lib/recommendation/engine/profiles";

export type RecommendationReasonCode =
  | "open_now"
  | "closing_soon"
  | "nearby"
  | "high_rating"
  | "many_reviews"
  | "memory_match"
  | "dna_match"
  | "legacy_sort"
  | "reserved";

export type RecommendationReason = {
  code: RecommendationReasonCode;
  /** 0–1：此原因對該筆的相對強度 */
  strength: number;
  /** 對應的分數因子（若有） */
  factor?: WeightFactorKey;
};

const FACTOR_REASON_RULES: {
  factor: WeightFactorKey;
  code: RecommendationReasonCode;
  minPart: number;
}[] = [
  { factor: "open", code: "open_now", minPart: 0.75 },
  { factor: "distance", code: "nearby", minPart: 0.55 },
  { factor: "rating", code: "high_rating", minPart: 0.7 },
  { factor: "reviews", code: "many_reviews", minPart: 0.45 },
  { factor: "memory", code: "memory_match", minPart: 0.35 },
  { factor: "dna", code: "dna_match", minPart: 0.35 },
];

/**
 * 依 factor 分數與權重貢獻產出結構化原因（最多 maxReasons 筆）。
 * closing_soon：open 分數落在 0.5–0.8 之間時另標。
 */
export function buildRecommendationReasons(input: {
  factorScores: Partial<Record<WeightFactorKey, number>>;
  weights: Partial<Record<WeightFactorKey, number>>;
  openStatus?: string | null;
  maxReasons?: number;
}): RecommendationReason[] {
  const maxReasons = input.maxReasons ?? 4;
  const reasons: RecommendationReason[] = [];
  const status = (input.openStatus ?? "").toLowerCase();

  if (status === "closing_soon") {
    reasons.push({
      code: "closing_soon",
      strength: input.factorScores.open ?? 0.75,
      factor: "open",
    });
  }

  const contrib = FACTOR_REASON_RULES.map((rule) => {
    const part = input.factorScores[rule.factor] ?? 0;
    const w = input.weights[rule.factor] ?? 0;
    return { rule, part, contrib: part * w };
  })
    .filter((x) => x.part >= x.rule.minPart && x.contrib > 0)
    .sort((a, b) => b.contrib - a.contrib);

  for (const item of contrib) {
    if (item.rule.code === "open_now" && status === "closing_soon") continue;
    if (reasons.some((r) => r.code === item.rule.code)) continue;
    reasons.push({
      code: item.rule.code,
      strength: Math.min(1, item.part),
      factor: item.rule.factor,
    });
    if (reasons.length >= maxReasons) break;
  }

  return reasons;
}
