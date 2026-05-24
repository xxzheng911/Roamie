export type PlanTier = "free" | "plus";

export type SubscriptionStatus = "inactive" | "active" | "trialing" | "expired";

export type SubscriptionProvider = "none" | "revenuecat" | "app_store";

export type UserPlanProfile = {
  planTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionProvider: SubscriptionProvider;
  plusAvailable: boolean;
  introCompleted: boolean;
};

export const DEFAULT_USER_PLAN: UserPlanProfile = {
  planTier: "free",
  subscriptionStatus: "inactive",
  subscriptionProvider: "none",
  plusAvailable: false,
  introCompleted: false,
};
