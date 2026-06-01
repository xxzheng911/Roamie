import type { SubscriptionFeature, SubscriptionTierId } from "@/services/subscription/types";

/** Product identifiers — configure matching products in App Store Connect & RevenueCat. */
export const SUBSCRIPTION_PRODUCT_IDS = {
  monthly: "roamie_premium_monthly",
  yearly: "roamie_premium_yearly",
} as const;

/** Entitlement identifier in RevenueCat */
export const PREMIUM_ENTITLEMENT_ID = "premium";

/**
 * Abuse-prevention rate limits (server-side in rate-limit.server.ts).
 * NOT product tier limits — Free users have full access to core features.
 * @see docs/PRODUCT_ARCHITECTURE.md
 */
export const ABUSE_RATE_LIMITS = {
  chatPerMinute: 8,
  chatPerDay: 120,
  itineraryPerDay: 10,
} as const;

/** @deprecated Use ABUSE_RATE_LIMITS — Free has no product-tier daily caps */
export const FREE_TIER_LIMITS = {
  aiChatsPerDay: Infinity,
  itineraryGenerationsPerDay: Infinity,
  advancedRecommendationsPerDay: Infinity,
} as const;

/**
 * Feature → minimum tier.
 * Free: complete travel planning (AI, weather, mood, outfit, saves, nav, share).
 * Plus: personalization layer only — memory, profile, insights, proactive AI.
 * @see docs/PRODUCT_ARCHITECTURE.md
 */
export const FEATURE_TIER_MAP: Record<SubscriptionFeature, SubscriptionTierId> = {
  // —— Free: full core product ——
  ai_chat: "free",
  place_recommendations: "free",
  itinerary_planning: "free",
  map_navigation: "free",
  weather: "free",
  mood_recommendations: "free",
  outfit_advice: "free",
  save_places: "free",
  save_trips: "free",
  place_search: "free",
  restaurant_search: "free",
  nearby_explore: "free",
  trip_share: "free",
  google_maps_nav: "free",
  // —— Plus: personalization only ——
  long_term_memory: "plus",
  travel_profile: "plus",
  collection_insights: "plus",
  proactive_inspiration: "plus",
  auto_itinerary_reroute: "plus",
  pre_trip_reminders: "plus",
  travel_mode: "plus",
  deep_conversation: "plus",
  itinerary_optimization: "plus",
  travel_stats: "plus",
  preference_quiz: "plus",
};

/** Plus value props for marketing / intro UI */
export const PLUS_VALUE_PROPS = [
  "長期旅行記憶",
  "Travel Profile 旅行檔案",
  "收藏洞察與偏好標籤",
  "今日靈感主動推薦",
  "行程最佳化與自動重排",
  "Travel Mode 旅行中模式",
] as const;
