/**
 * Active Recommendation Context — shared structure for multi-turn
 * place recommendation refinement (cuisine / budget / exclusions / more).
 */
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { RecommendationSearchScope } from "@/lib/ai/conversation-recommendation-session";
import type { ChatShortcutScene } from "@/lib/ai/chat-intent";

export type RecommendationIntent =
  | "restaurant"
  | "shopping"
  | "cafe"
  | "attraction"
  | "nightlife"
  | "indoor"
  | "general_place";

export type RecommendationBudgetLevel = "cheap" | "moderate" | "premium";

export type RecommendationMealSlot = "breakfast" | "lunch" | "dinner" | "late_night";

export type RecommendationBudget = {
  level?: RecommendationBudgetLevel;
  min?: number;
  max?: number;
  currency?: string;
};

export type ActiveRecommendationContext = {
  destinationName: string;
  /** Display label when it differs from search city (e.g. 北海道) */
  destinationDisplayName?: string;
  destinationKey?: string;
  countryCode?: string;

  resolvedSearchCity?: string;
  parentCity?: string;
  area?: string;
  searchScope?: RecommendationSearchScope;
  /** Structured Nearby scene retained across continuation turns. */
  shortcutScene?: ChatShortcutScene;
  latitude?: number;
  longitude?: number;
  radius?: number;

  intent: RecommendationIntent;

  category?: string;
  subcategory?: string;

  cuisine?: string[];
  shoppingTypes?: string[];
  attractionTypes?: string[];

  budget?: RecommendationBudget;

  atmosphere?: string[];
  companion?: string[];
  mealSlot?: RecommendationMealSlot;

  openNow?: boolean;
  indoorOnly?: boolean;
  quietOnly?: boolean;
  reservationPreferred?: boolean;
  soloFriendly?: boolean;
  familyFriendly?: boolean;
  nearStation?: boolean;
  walkable?: boolean;
  highRatingPreferred?: boolean;

  preferredKeywords?: string[];
  excludedKeywords?: string[];

  previousPlaceIds: string[];
  previousCanonicalKeys: string[];
  currentResultPlaceIds: string[];

  usedQueries: string[];
  reserveCandidates?: RoamieRecommendationItem[];
  exhausted?: boolean;

  createdAt: number;
  updatedAt: number;
};

/** Partial patch produced by the refinement parser (before merge). */
export type RecommendationRefinementPatch = {
  intentSwitch?: RecommendationIntent;
  category?: string;
  subcategory?: string;
  cuisine?: string[];
  shoppingTypes?: string[];
  attractionTypes?: string[];
  budget?: RecommendationBudget;
  atmosphere?: string[];
  companion?: string[];
  mealSlot?: RecommendationMealSlot;
  openNow?: boolean;
  indoorOnly?: boolean;
  quietOnly?: boolean;
  reservationPreferred?: boolean;
  soloFriendly?: boolean;
  familyFriendly?: boolean;
  nearStation?: boolean;
  walkable?: boolean;
  highRatingPreferred?: boolean;
  preferredKeywords?: string[];
  excludedKeywords?: string[];
  /** Explicit city/area scope change within same destination region */
  searchCityOverride?: string;
  isMoreResults?: boolean;
  confidence: number;
};

export type ChatIntentArbitrationRoute =
  | "NEW_DESTINATION"
  | "NEW_TRIP_PLANNING"
  | "RECOMMENDATION_REFINEMENT"
  | "MORE_RECOMMENDATIONS"
  | "ADD_TO_ITINERARY"
  | "TRIP_PLANNING_FLOW"
  | "NEW_RECOMMENDATION"
  | "GENERAL_CHAT";

export type ChatIntentArbitrationResult = {
  route: ChatIntentArbitrationRoute;
  reason: string;
  refinement?: RecommendationRefinementPatch;
};

/** Map category intent ↔ recommendation intent */
export function categoryIntentToRecommendationIntent(
  intent: ChatPlaceCategoryIntent,
): RecommendationIntent {
  if (intent === "bar" || intent === "night_market") return "nightlife";
  if (intent === "indoor") return "indoor";
  if (
    intent === "restaurant" ||
    intent === "cafe" ||
    intent === "shopping" ||
    intent === "attraction"
  ) {
    return intent;
  }
  return "general_place";
}

export function recommendationIntentToCategoryIntent(
  intent: RecommendationIntent,
): ChatPlaceCategoryIntent {
  if (intent === "nightlife") return "bar";
  if (intent === "indoor") return "indoor";
  if (intent === "general_place") return "attraction";
  return intent;
}

export function isRecommendationIntent(
  value: string | undefined | null,
): value is RecommendationIntent {
  return (
    value === "restaurant" ||
    value === "shopping" ||
    value === "cafe" ||
    value === "attraction" ||
    value === "nightlife" ||
    value === "indoor" ||
    value === "general_place"
  );
}
