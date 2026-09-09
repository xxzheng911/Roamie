import { usePlusPurchase } from "@/providers/PlusPurchaseProvider";
export type { PlusUpgradeResult } from "@/providers/PlusPurchaseProvider";

/**
 * Plus 升級入口：billing 略過環境直接寫入 canonical + Supabase；正式 IAP 顯示即將推出。
 */
export function usePlusUpgrade() {
  const { openRevenueCatPaywall } = usePlusPurchase();
  return { upgradeToPlus: openRevenueCatPaywall, openRevenueCatPaywall };
}
