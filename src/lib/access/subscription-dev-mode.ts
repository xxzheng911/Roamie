import { canShowDeveloperTools, isDeveloperBuildEnabled } from "@/lib/access/developer";

/** 開發／測試環境：可略過 App Store 訂閱流程，直接切換 Free / Plus */
export function canBypassSubscriptionBilling(email?: string | null): boolean {
  return isDeveloperBuildEnabled() && (import.meta.env.DEV || canShowDeveloperTools(email));
}
