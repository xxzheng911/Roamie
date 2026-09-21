/** Capacitor iOS rejects with a string code; userCancelled is not guaranteed. */
export function classifyPurchaseError(error: unknown): "cancelled" | "pending" | "failure" {
  const value = error as { code?: string | number; userCancelled?: boolean } | null;
  const code = String(value?.code ?? "").toLowerCase();
  if (value?.userCancelled === true || code === "1" || code === "purchase_cancelled_error")
    return "cancelled";
  if (code === "20" || code.includes("payment_pending")) return "pending";
  return "failure";
}

/** Entitlement evidence takes precedence over server sync availability. */
export function resolveRestoreOutcome(result: import("./types").SubscriptionActionResult) {
  if (result.outcome !== "success") return "ignored";
  if (!result.status.isActive) return "nothingToRestore";
  return result.canonicalSynced ? "restored" : "restoreSyncPending";
}
