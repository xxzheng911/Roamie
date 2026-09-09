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
  | "advanced_travel_modes"
  | "conversation_workspace";

export type SubscriptionStatus = {
  tier: SubscriptionTierId;
  isActive: boolean;
  expiresAt: string | null;
  productId: string | null;
  willRenew: boolean;
  source: "local" | "revenuecat" | "stripe";
};

export type SubscriptionPackage = {
  identifier: string;
  productId: string;
  title: string;
  description: string;
  priceString: string;
  period: "monthly" | "yearly" | "other";
};

export type SubscriptionActionResult =
  | { outcome: "success"; status: SubscriptionStatus }
  | { outcome: "cancelled"; status: SubscriptionStatus }
  | { outcome: "pending"; status: SubscriptionStatus };

export type UsageCounters = {
  aiChatsToday: number;
  itineraryGenerationsToday: number;
  advancedRecommendationsToday: number;
  resetAt: string;
};

export type SubscriptionAdapter = {
  id: string;
  configure(userId: string): Promise<void>;
  logOut(): Promise<void>;
  getStatus(): Promise<SubscriptionStatus>;
  getPackages(): Promise<SubscriptionPackage[]>;
  getUsage(): Promise<UsageCounters>;
  purchase(packageId: string): Promise<SubscriptionActionResult>;
  restore(): Promise<SubscriptionActionResult>;
  addStatusListener(listener: (status: SubscriptionStatus) => void): Promise<() => void>;
  sync(): Promise<void>;
};

export type FeatureGateResult =
  | { allowed: true }
  | { allowed: false; reason: "limit_reached" | "premium_required"; feature: SubscriptionFeature };
