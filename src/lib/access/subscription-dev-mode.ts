import { clientEnv } from "@/constants/env";
import { canShowDeveloperTools, isDeveloperBuildEnabled } from "@/lib/access/developer";

/** 開發／測試環境：可略過 App Store 訂閱流程，直接切換 Free / Plus */
export function canBypassSubscriptionBilling(email?: string | null): boolean {
  const billingConfigured = Boolean(
    clientEnv.revenueCatAppleKey || clientEnv.revenueCatGoogleKey,
  );
  return (
    import.meta.env.DEV ||
    isDeveloperBuildEnabled() ||
    canShowDeveloperTools(email) ||
    !clientEnv.billingEnabled ||
    !billingConfigured
  );
}
