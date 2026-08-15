/**
 * Universal Place Recommendation Intent — shared structure for restaurant /
 * cafe / shopping / attraction / nightlife NL requirement extraction.
 */

export type PlaceRecommendationPrimaryType =
  | "restaurant"
  | "cafe"
  | "shopping"
  | "attraction"
  | "nightlife"
  | "indoor"
  | "accommodation"
  | "general_place";

export type PlaceRecommendationMealSlot =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "late_night";

export type PlaceRecommendationBudget = "cheap" | "moderate" | "premium";

export type PlaceRecommendationContinuation =
  | "new_request"
  | "refinement"
  | "more_results";

export type PlaceRecommendationIntent = {
  destinationName?: string;
  resolvedSearchCity?: string;
  destinationArea?: string;
  destinationDisplayLabel?: string;
  searchScope?: "city" | "area";
  countryCode?: string;

  primaryType: PlaceRecommendationPrimaryType;

  subtypes: string[];

  mealSlot?: PlaceRecommendationMealSlot;

  preferredFeatures: string[];
  excludedFeatures: string[];

  budget?: PlaceRecommendationBudget;

  atmosphere?: string[];
  companion?: string[];

  openNow?: boolean;
  reservationPreferred?: boolean;
  nearStation?: boolean;
  indoorOnly?: boolean;

  continuation: PlaceRecommendationContinuation;

  confidence: number;
};

export type PlaceRecommendationQueryBuildInput = {
  destination: string;
  resolvedSearchCity?: string;
  primaryType: PlaceRecommendationPrimaryType;
  subtypes?: string[];
  preferredFeatures?: string[];
  excludedFeatures?: string[];
  mealSlot?: PlaceRecommendationMealSlot;
  budget?: PlaceRecommendationBudget;
  atmosphere?: string[];
  indoorOnly?: boolean;
};
