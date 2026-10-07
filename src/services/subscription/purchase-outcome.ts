import { isRevenueCatPlusActive } from "@/lib/subscription/canonical-plus";
import { isSubscriptionOwnershipErrorCode } from "@/lib/subscription/revenuecat-identity";

/** Capacitor iOS rejects with a string code; userCancelled is not guaranteed. */
export function classifyPurchaseError(error: unknown): "cancelled" | "pending" | "failure" {
  const value = error as { code?: string | number; userCancelled?: boolean } | null;
  const code = String(value?.code ?? "").toLowerCase();
  if (value?.userCancelled === true || code === "1" || code === "purchase_cancelled_error")
    return "cancelled";
  if (code === "20" || code.includes("payment_pending")) return "pending";
  return "failure";
}

export function subscriptionOwnershipMessageKey(
  code: string | undefined,
): "ownershipMismatch" | "ownershipUnconfirmed" | null {
  if (code === "subscription_ownership_mismatch") return "ownershipMismatch";
  if (code === "subscription_ownership_ambiguous" || code === "subscription_ownership_anonymous")
    return "ownershipUnconfirmed";
  return null;
}

/** Server ownership beats a local CustomerInfo premium flag. */
export function resolveRestoreOutcome(result: import("./types").SubscriptionActionResult) {
  if (result.outcome !== "success") return "ignored";
  if (isSubscriptionOwnershipErrorCode(result.canonicalErrorCode)) {
    return result.canonicalErrorCode === "subscription_ownership_mismatch"
      ? "ownershipMismatch"
      : "ownershipUnconfirmed";
  }
  if (!isRevenueCatPlusActive(result.status)) return "nothingToRestore";
  return result.canonicalSynced ? "restored" : "restoreSyncPending";
}
