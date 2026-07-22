/**
 * Places Cost Cache — public API
 *
 * Layer 1 Destination (geocode) · Layer 2 Candidate Pool · Layer 3 Combination
 * + Session reuse · Query cooldown · Rate protection · Filter-from-pool
 */

export {
  PLACES_COST_CACHE_TTL_MS,
  PLACES_QUERY_COOLDOWN_MS,
  CANDIDATE_POOL_SEED_CATEGORIES,
} from "@/lib/ai/places-cost-cache/constants";

export {
  readCandidatePoolCache,
  writeCandidatePoolCache,
  clearCandidatePoolCache,
  candidatePoolCacheKey,
  peekCandidatePoolCacheSize,
  type CachedCandidatePool,
} from "@/lib/ai/places-cost-cache/candidate-pool-cache";

export {
  readCombinationCache,
  writeCombinationCache,
  clearCombinationCache,
  combinationCacheKey,
} from "@/lib/ai/places-cost-cache/combination-cache";

export {
  bindSessionCandidatePool,
  readSessionCandidatePool,
  clearSessionCandidatePool,
  ensureSessionDestination,
  type SessionCandidatePool,
} from "@/lib/ai/places-cost-cache/session-pool";

export {
  placesQueryCooldownKey,
  isPlacesQueryOnCooldown,
  notePlacesQueryCooldown,
  shouldSkipPlacesForQueryCooldown,
  clearPlacesQueryCooldown,
} from "@/lib/ai/places-cost-cache/query-cooldown";

export {
  activatePlacesRateProtection,
  clearPlacesRateProtection,
  isPlacesRateProtectionActive,
  shouldBlockNewPlacesCalls,
  getPlacesRateProtectionState,
} from "@/lib/ai/places-cost-cache/rate-protection";

export {
  filterCandidatePoolPlaces,
  filterPoolByCategoryIntent,
  filterPoolByCuisineKeyword,
  extractCuisineKeywordFromText,
} from "@/lib/ai/places-cost-cache/filter-from-pool";

export { runCappedCategorySearch } from "@/lib/ai/places-cost-cache/category-search";

export {
  ingestResolvedPlacesIntoCandidatePool,
  matchNamedPlaceFromCandidatePool,
  chatPlaceItemToPlaceResult,
} from "@/lib/ai/places-cost-cache/ingest";

export {
  logCandidatePoolCreated,
  logCandidatePoolCacheHit,
  logCandidatePoolCacheMiss,
  logCandidatePoolIngest,
  logDestinationCacheHit,
  logDestinationCacheMiss,
  logCombinationCacheHit,
  logCombinationCacheMiss,
  logPlacesSearchSkipped,
  logPlacesRateProtection,
  logSessionPoolReused,
} from "@/lib/ai/places-cost-cache/log";
