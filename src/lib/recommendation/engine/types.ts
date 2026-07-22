/**
 * Recommendation Engine — core contracts
 * Design: docs/raos/recommendation-engine-design.md
 * Planner: docs/raos/planner-recommendation-integration.md
 */

import type {
  ProfileWeights,
  RecommendationProfileId,
  WeightFactorKey,
} from "@/lib/recommendation/engine/profiles";
import type { RecommendationReason } from "@/lib/recommendation/engine/reasons";
import type { PersonalizationBundle } from "@/lib/recommendation/engine/signals/types";

export type RecommendationSurface =
  | "explore"
  | "home"
  | "chat"
  | "planner"
  | "nearby"
  | "insights";

export type RecommendationCandidateSource =
  | "places"
  | "favorites"
  | "ai"
  | "planner"
  | "cache"
  | "explore";

export type RecommendationContext = {
  surface: RecommendationSurface;
  locale?: string;
  location?: { lat: number; lng: number; city?: string };
  timeISO?: string;
  weather?: unknown;
  categoryHint?: string;
  exclusions?: {
    placeIds: string[];
    names: string[];
    rejectedNames: string[];
  };
  surfaceOptions?: Record<string, unknown>;
  personalization?: PersonalizationBundle | null;
};

export type RecommendationCandidate = {
  placeId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  rating?: number | null;
  userRatingCount?: number | null;
  primaryType?: string | null;
  types?: string[] | null;
  openNow?: boolean | null;
  openStatus?: string | null;
  source: RecommendationCandidateSource;
  raw?: unknown;
};

export type RecommendationResult = {
  placeId: string;
  score: number;
  /** 結構化原因；UI/AI 決定呈現，非完整句子 */
  reasons: RecommendationReason[];
  /**
   * 各因子分數明細（Explain / Debug / A/B / AI 理由共用）。
   * Planner P1：對齊 trip-place-scoring 分項。
   */
  scoreBreakdown: Record<string, number>;
  /**
   * @deprecated 使用 scoreBreakdown（同內容，過渡相容）
   */
  breakdown: Record<string, number>;
  candidate: RecommendationCandidate;
  profileId?: RecommendationProfileId;
};

export type PipelineStageName =
  | "normalize"
  | "filter"
  | "deduplicate"
  | "score"
  | "rank"
  | "diversify"
  | "explain"
  | "validate";

export const RECOMMENDATION_PIPELINE_STAGES: readonly PipelineStageName[] = [
  "normalize",
  "filter",
  "deduplicate",
  "score",
  "rank",
  "diversify",
  "explain",
  "validate",
] as const;

export type ScoredCandidate = {
  candidate: RecommendationCandidate;
  score: number;
  reasons: RecommendationReason[];
  scoreBreakdown: Record<string, number>;
  /** @deprecated 使用 scoreBreakdown */
  breakdown: Record<string, number>;
  profileId?: RecommendationProfileId;
  factorScores?: Partial<Record<WeightFactorKey, number>>;
  effectiveWeights?: ProfileWeights;
};

/** 同時寫入 scoreBreakdown 與相容欄位 breakdown */
export function attachScoreBreakdown(
  scoreBreakdown: Record<string, number>,
): Pick<ScoredCandidate, "scoreBreakdown" | "breakdown"> {
  return { scoreBreakdown, breakdown: scoreBreakdown };
}

export type PlannerCandidatePool = {
  surface: "planner";
  results: RecommendationResult[];
};

export type { RecommendationReason, RecommendationReasonCode } from "@/lib/recommendation/engine/reasons";
export type { RecommendationProfileId, WeightFactorKey, ProfileWeights } from "@/lib/recommendation/engine/profiles";
