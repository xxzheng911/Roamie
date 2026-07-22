export type {
  ActiveRecommendationContext,
  RecommendationIntent,
  RecommendationBudget,
  RecommendationBudgetLevel,
  RecommendationMealSlot,
  RecommendationRefinementPatch,
  ChatIntentArbitrationRoute,
  ChatIntentArbitrationResult,
} from "@/lib/ai/recommendation-refinement/types";

export {
  categoryIntentToRecommendationIntent,
  recommendationIntentToCategoryIntent,
  isRecommendationIntent,
} from "@/lib/ai/recommendation-refinement/types";

export {
  parseRecommendationRefinement,
  isRecommendationRefinementText,
  isMoreRecommendationResultsText,
  cuisineSearchTokens,
  shoppingTypeSearchTokens,
  attractionTypeSearchTokens,
} from "@/lib/ai/recommendation-refinement/parser";

export {
  createActiveRecommendationContext,
  mergeRecommendationRefinement,
  appendRecommendationResults,
  logRecommendationContextMerged,
} from "@/lib/ai/recommendation-refinement/merge";

export {
  resolveChatIntentArbitration,
  shouldSkipTripPlanningForRefinement,
  hasActiveRecommendationContext,
  isExplicitNewTripPlanningText,
  isExplicitDestinationChangeText,
} from "@/lib/ai/recommendation-refinement/arbitrate";

export {
  buildRefinementSearchAttempts,
  filterPlacesByRecommendationContext,
  filterRecommendationsByExcludedKeywords,
  placeMatchesCuisineRelevance,
  matchesFoodIntent,
  isAcceptableRestaurantPlace,
  logRefinementSearchStart,
  logRefinementSearchResult,
} from "@/lib/ai/recommendation-refinement/search";

export {
  ensureActiveRecommendationContext,
  applyRefinementPatchToSession,
  syncActiveRecommendationContextAfterResults,
  restoreActiveRecommendationContextFromWorkspace,
} from "@/lib/ai/recommendation-refinement/session";

export { buildRecommendationRefinementResults } from "@/lib/ai/recommendation-refinement/execute";
