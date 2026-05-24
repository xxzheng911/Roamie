import type { SubscriptionFeature, SubscriptionTierId } from "@/services/subscription/types";

/** Product identifiers — configure matching products in App Store Connect & RevenueCat. */
export const SUBSCRIPTION_PRODUCT_IDS = {
  monthly: "roamie_premium_monthly",
  yearly: "roamie_premium_yearly",
} as const;

/** Entitlement identifier in RevenueCat */
export const PREMIUM_ENTITLEMENT_ID = "premium";

/** Free-tier daily limits (server should enforce the same limits) */
export const FREE_TIER_LIMITS = {
  aiChatsPerDay: 15,
  itineraryGenerationsPerDay: 2,
  advancedRecommendationsPerDay: 10,
} as const;

/** Feature → minimum tier required */
export const FEATURE_TIER_MAP: Record<SubscriptionFeature, SubscriptionTierId> = {
  ai_chat: "free",
  basic_recommendations: "free",
  itinerary_generate: "free",
  unlimited_ai: "plus",
  smart_itinerary: "plus",
  weather_planning: "plus",
  hidden_locals: "plus",
  ai_memory: "plus",
  advanced_travel_modes: "plus",
};
