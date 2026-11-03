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

  /** 使用者指定的推薦數量（原始解析值，未截斷；顯示張數由呼叫端決定）。 */
  requestedCount?: number;
  /** 冷門／熱門偏好（僅解析訊號，不影響既有搜尋或排序）。 */
  popularityPreference?: "hidden_gem" | "popular";
  /** 在地／當地偏好（「在地美食」）；僅解析訊號，不影響既有搜尋或排序。 */
  localPreference?: true;
  /**
   * 活動偏好（「看楓葉」→「賞楓」、「吃小吃」→「在地小吃」；詞表外保留原片段如「泡湯」）；僅解析訊號，
   * 不放進 preferredFeatures，不影響搜尋 query、排序或 Gate。
   */
  activityPreference?: string;
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
