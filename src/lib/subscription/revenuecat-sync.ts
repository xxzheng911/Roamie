import { supabase } from "@/lib/supabase";
import { isApiUrlError, resolveApiUrl } from "@/lib/api-url";

type SubscriptionSyncFailureDiagnostic = {
  event: "server_sync_failed";
  errorCode: "subscription_sync_failed" | string;
};

export async function syncRevenueCatEntitlementWithServer(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const response = await fetch(resolveApiUrl("/api/subscription/sync"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
}

/** CustomerInfo listeners must not leak a background sync rejection globally. */
export function syncRevenueCatEntitlementInBackground(options?: {
  sync?: () => Promise<boolean>;
  report?: (diagnostic: SubscriptionSyncFailureDiagnostic) => void;
}): void {
  const sync = options?.sync ?? syncRevenueCatEntitlementWithServer;
  void sync().catch((cause) => {
    const diagnostic: SubscriptionSyncFailureDiagnostic = {
      event: "server_sync_failed",
      errorCode: isApiUrlError(cause) ? cause.code : "subscription_sync_failed",
    };
    if (options?.report) options.report(diagnostic);
    else console.warn("[REVENUECAT_STATE]", diagnostic);
  });
}
