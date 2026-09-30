import type { SubscriptionStatus } from "@/services/subscription/types";

export function isRevenueCatPlusActive(status: SubscriptionStatus | null): boolean {
  return status?.source === "revenuecat" && status.isActive && status.tier === "plus";
}

/**
 * Local CustomerInfo may show Plus before the server mirror hydrates only when
 * its original app user id is the signed-in Supabase user. A server ownership
 * rejection overrides that local entitlement.
 */
export function revenueCatCustomerInfoMayDisplayPlus(
  status: SubscriptionStatus | null,
  userId: string | null | undefined,
  ownershipBlocked = false,
): boolean {
  if (ownershipBlocked || !userId || !isRevenueCatPlusActive(status)) return false;
  return status?.originalAppUserId === userId;
}

export function resolveCanonicalPlusAccess(
  serverHasPlus: boolean,
  status: SubscriptionStatus | null,
  options?: { userId?: string | null; ownershipBlocked?: boolean },
): boolean {
  if (serverHasPlus) return true;
  return revenueCatCustomerInfoMayDisplayPlus(
    status,
    options?.userId,
    options?.ownershipBlocked === true,
  );
}

export function subscriptionStatusForDisplay(
  status: SubscriptionStatus | null,
  userId: string | null | undefined,
  ownershipBlocked = false,
): SubscriptionStatus | null {
  if (
    !status ||
    revenueCatCustomerInfoMayDisplayPlus(status, userId, ownershipBlocked) ||
    !isRevenueCatPlusActive(status)
  ) {
    return status;
  }
  return {
    ...status,
    tier: "free",
    isActive: false,
    productId: null,
    willRenew: false,
  };
}
