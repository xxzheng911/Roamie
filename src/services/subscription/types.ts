export type SubscriptionTierId = "free" | "plus" | "premium";

/**
 * Product features — see docs/PRODUCT_ARCHITECTURE.md
 * Free: core travel planning (all free-tier keys).
 * Plus: personalization layer only (plus-tier keys).
 */
export type SubscriptionFeature =
  // Free — complete product
  | "ai_chat"
  | "place_recommendations"
  | "itinerary_planning"
  | "map_navigation"
  | "weather"
  | "mood_recommendations"
  | "outfit_advice"
  | "save_places"
  | "save_trips"
  | "place_search"
  | "restaurant_search"
  | "nearby_explore"
  | "trip_share"
  | "google_maps_nav"
  // Plus — personalization
  | "long_term_memory"
  | "travel_profile"
  | "collection_insights"
  | "proactive_inspiration"
  | "auto_itinerary_reroute"
  | "pre_trip_reminders"
  | "travel_mode"
  | "deep_conversation"
  | "itinerary_optimization"
  | "travel_stats"
  | "preference_quiz";

export type SubscriptionStatus = {
  tier: SubscriptionTierId;
  isActive: boolean;
  expiresAt: string | null;
  productId: string | null;
  willRenew: boolean;
  source: "local" | "revenuecat" | "stripe";
};

export type UsageCounters = {
  aiChatsToday: number;
  itineraryGenerationsToday: number;
  advancedRecommendationsToday: number;
  resetAt: string;
};

export type SubscriptionAdapter = {
  id: string;
  getStatus(): Promise<SubscriptionStatus>;
  getUsage(): Promise<UsageCounters>;
  purchase(productId: string): Promise<SubscriptionStatus>;
  restore(): Promise<SubscriptionStatus>;
  sync(): Promise<void>;
};

export type FeatureGateResult =
  | { allowed: true }
  | { allowed: false; reason: "limit_reached" | "premium_required"; feature: SubscriptionFeature };
