import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { canBypassSubscriptionBilling } from "@/lib/access/subscription-dev-mode";

export type PlusUpgradeResult = "upgraded" | "coming_soon";

/**
 * Plus 升級入口：billing 略過環境直接寫入 canonical + Supabase；正式 IAP 顯示即將推出。
 */
export function usePlusUpgrade() {
  const { user } = useAuth();
  const { enablePlusTestMode } = useAccess();
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  const canInstantUpgrade = canBypassSubscriptionBilling(user?.email ?? null);

  const upgradeToPlus = useCallback((): PlusUpgradeResult => {
    console.info("[PLUS_UPGRADE_TAP]", { canInstantUpgrade });

    if (!canInstantUpgrade) {
      setComingSoonOpen(true);
      return "coming_soon";
    }

    enablePlusTestMode();
    toast.success("已啟用 Roamie Plus");
    return "upgraded";
  }, [canInstantUpgrade, enablePlusTestMode]);

  return {
    upgradeToPlus,
    canInstantUpgrade,
    comingSoonOpen,
    setComingSoonOpen,
  };
}
