export type SubscriptionTierId = "free" | "plus" | "premium";

export type SubscriptionFeature =
  | "ai_chat"
  | "basic_recommendations"
  | "itinerary_generate"
  | "unlimited_ai"
  | "smart_itinerary"
  | "weather_planning"
  | "hidden_locals"
  | "ai_memory"
  | "advanced_travel_modes";

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
