/**
 * Recommendation Engine — public API
 *
 * Pipeline: normalize → filter → deduplicate → score → rank → diversify → explain → validate
 * (validate = Recommendation Validator)
 *
 * Design: docs/raos/recommendation-engine-design.md
 * Planner: docs/raos/planner-recommendation-integration.md
 */

export {
  isRecEngineEnabled,
  REC_ENGINE_STORAGE_KEY,
  setRecEngineEnabledOverride,
  setRecEngineStorageFlag,
} from "@/lib/recommendation/engine/feature-flag";

export {
  isRecEngineR11Enabled,
  REC_ENGINE_R1_1_STORAGE_KEY,
  setRecEngineR11EnabledOverride,
  setRecEngineR11StorageFlag,
} from "@/lib/recommendation/engine/feature-flag-r1-1";

export {
  isRecEngineR12Enabled,
  REC_ENGINE_R1_2_STORAGE_KEY,
  setRecEngineR12EnabledOverride,
  setRecEngineR12StorageFlag,
} from "@/lib/recommendation/engine/feature-flag-r1-2";

export {
  isRecEnginePlannerEnabled,
  REC_ENGINE_PLANNER_STORAGE_KEY,
  setRecEnginePlannerEnabledOverride,
  setRecEnginePlannerStorageFlag,
} from "@/lib/recommendation/engine/feature-flag-planner";

export {
  isRecEngineValidatorEnabled,
  REC_ENGINE_VALIDATOR_STORAGE_KEY,
  setRecEngineValidatorEnabledOverride,
  setRecEngineValidatorStorageFlag,
} from "@/lib/recommendation/engine/feature-flag-validator";

export {
  getRecEngineMetrics,
  recordRecEngineMetric,
  resetRecEngineMetrics,
  type RecEngineMetricEvent,
  type RecEnginePath,
} from "@/lib/recommendation/engine/metrics";

export {
  getRecommendationPipelineStages,
  runRecommendationPipeline,
  type RunRecommendationPipelineInput,
} from "@/lib/recommendation/engine/pipeline";

export { sortExplorePlacesViaRecEngine } from "@/lib/recommendation/engine/adapters/explore";
export {
  rankPlannerPlacesViaRecEngine,
  buildPlannerCandidatePool,
  applyPlannerHardConstraints,
  mapTripStyleToProfileHint,
} from "@/lib/recommendation/engine/adapters/planner";

export {
  RECOMMENDATION_PROFILES,
  getRecommendationProfile,
  resolveRecommendationProfileId,
  normalizeProfileWeights,
  type RecommendationProfile,
  type RecommendationProfileId,
  type ProfileWeights,
  type WeightFactorKey,
} from "@/lib/recommendation/engine/profiles";

export {
  buildRecommendationReasons,
  type RecommendationReason,
  type RecommendationReasonCode,
} from "@/lib/recommendation/engine/reasons";

export {
  scoreCandidatesWithProfile,
  scoreCandidatesR11,
} from "@/lib/recommendation/engine/score-with-profile";

export {
  R1_1_WEIGHTS_DEFAULT,
  R1_1_WEIGHTS_FOOD_NIGHT,
  resolveR11Weights,
} from "@/lib/recommendation/engine/weights-r1-1";

export { buildMemoryPersonalization } from "@/lib/recommendation/engine/signals/from-memory";
export { buildDnaPersonalization } from "@/lib/recommendation/engine/signals/from-dna";
export {
  mergeWeightsWithSuggestions,
  preferenceFactorScores,
} from "@/lib/recommendation/engine/signals/merge";
export type {
  PersonalizationBundle,
  PreferenceSignal,
  WeightSuggestion,
} from "@/lib/recommendation/engine/signals/types";

export {
  validateRecommendations,
  validateRecommendationsDetailed,
  validateCandidates,
  getLastRecommendationValidationStats,
  getLastRecommendationValidationSummary,
  resetRecommendationValidationStats,
  type RecommendationValidationRejectReason,
  type RecommendationValidationResult,
  type RecommendationValidationSummary,
  type RecommendationValidationStats,
} from "@/lib/recommendation/engine/stages/validate";

export {
  RECOMMENDATION_PIPELINE_STAGES,
  attachScoreBreakdown,
  type PipelineStageName,
  type PlannerCandidatePool,
  type RecommendationCandidate,
  type RecommendationContext,
  type RecommendationResult,
  type RecommendationSurface,
  type ScoredCandidate,
} from "@/lib/recommendation/engine/types";
