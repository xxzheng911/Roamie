/**
 * RAOS Candidate Pool — public API
 *
 * Places Search → Quality Gate → Category → Query → Geo Clustering →
 * Temporal → Travel Flow → Experience Optimizer → Candidate Pool
 */

export {
  isCandidatePoolEnabled,
  setCandidatePoolEnabledOverride,
  setCandidatePoolStorageFlag,
  resolveCandidatePoolFlag,
  CANDIDATE_POOL_STORAGE_KEY,
} from "@/lib/ai/candidate-pool/feature-flag";

export {
  buildCandidatePool,
  shapeCandidatePoolPlaces,
  poolMeetsDiversityFloor,
  type BuildCandidatePoolParams,
} from "@/lib/ai/candidate-pool/pipeline";

export {
  CANDIDATE_POOL_VERSION,
  type AnnotatedPoolPlace,
  type CandidatePoolDemand,
  type CandidatePoolResult,
  type CandidatePoolSearchFn,
  type CandidatePoolStats,
  type ExperienceFamily,
  type PoolCategory,
  type PoolGeoCluster,
  type TemporalSlot,
  type TravelIntent,
} from "@/lib/ai/candidate-pool/types";

export {
  classifyExperienceFamily,
  classifyPoolCategory,
  classifyTemporalSlots,
  classifyTravelIntent,
} from "@/lib/ai/candidate-pool/classify";

export { applyQualityGate, qualityRejectReason } from "@/lib/ai/candidate-pool/stages/quality";
export { buildGeoClustersFromPlaces } from "@/lib/ai/candidate-pool/stages/geo";
export { buildCandidatePoolDemand } from "@/lib/ai/candidate-pool/demand";
