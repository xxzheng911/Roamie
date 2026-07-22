import { deduplicateCandidates } from "@/lib/recommendation/engine/stages/deduplicate";
import { diversifyCandidates } from "@/lib/recommendation/engine/stages/diversify";
import { explainCandidates } from "@/lib/recommendation/engine/stages/explain";
import { filterCandidates } from "@/lib/recommendation/engine/stages/filter";
import { normalizeCandidates, type NormalizeInput } from "@/lib/recommendation/engine/stages/normalize";
import { rankScoredCandidates } from "@/lib/recommendation/engine/stages/rank";
import { scoreCandidates, type ExploreScoreFn } from "@/lib/recommendation/engine/stages/score";
import { validateRecommendations } from "@/lib/recommendation/engine/stages/validate";
import type {
  PipelineStageName,
  RecommendationCandidateSource,
  RecommendationContext,
  RecommendationResult,
} from "@/lib/recommendation/engine/types";
import { RECOMMENDATION_PIPELINE_STAGES } from "@/lib/recommendation/engine/types";

export type RunRecommendationPipelineInput = {
  ctx: RecommendationContext;
  inputs: readonly NormalizeInput[];
  source?: RecommendationCandidateSource;
  /** Explore：注入 score 策略（R0 legacy 或 R1.1 加權） */
  scoreFn?: ExploreScoreFn;
  /** 測試用：記錄實際執行的 stage 順序 */
  onStage?: (stage: PipelineStageName) => void;
};

/**
 * Recommendation Pipeline（正式）
 * normalize → filter → deduplicate → score → rank → diversify → explain → validate
 */
export function runRecommendationPipeline(
  input: RunRecommendationPipelineInput,
): RecommendationResult[] {
  const { ctx, inputs, source = "explore", scoreFn, onStage } = input;

  const runStage = <T>(stage: PipelineStageName, fn: () => T): T => {
    onStage?.(stage);
    return fn();
  };

  const normalized = runStage("normalize", () => normalizeCandidates(inputs, source));
  const filtered = runStage("filter", () => filterCandidates(normalized));
  const deduped = runStage("deduplicate", () => deduplicateCandidates(filtered));
  const scored = runStage("score", () => scoreCandidates(deduped, ctx, scoreFn));
  const ranked = runStage("rank", () => rankScoredCandidates(scored));
  const diversified = runStage("diversify", () => diversifyCandidates(ranked));
  const explained = runStage("explain", () => explainCandidates(diversified));
  return runStage("validate", () => validateRecommendations(explained, ctx));
}

export function getRecommendationPipelineStages(): readonly PipelineStageName[] {
  return RECOMMENDATION_PIPELINE_STAGES;
}
