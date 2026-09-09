import type { SubscriptionStatus } from "@/services/subscription/types";

export function isRevenueCatPlusActive(status: SubscriptionStatus | null): boolean {
  return status?.source === "revenuecat" && status.isActive && status.tier === "plus";
}

export function resolveCanonicalPlusAccess(
  serverHasPlus: boolean,
  status: SubscriptionStatus | null,
): boolean {
  return serverHasPlus || isRevenueCatPlusActive(status);
}
