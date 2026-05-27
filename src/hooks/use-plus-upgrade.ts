import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { canShowDeveloperTools, isDeveloperBuildEnabled } from "@/lib/access/developer";

export type PlusUpgradeResult = "upgraded" | "coming_soon";

/**
 * Plus 升級入口：開發／測試模式直接啟用 Plus；正式版顯示即將推出對話框。
 */
export function usePlusUpgrade() {
  const { user } = useAuth();
  const { enablePlusTestMode, testModeOverride } = useAccess();
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  const canInstantUpgrade =
    import.meta.env.DEV ||
    isDeveloperBuildEnabled() ||
    canShowDeveloperTools(user?.email ?? null) ||
    testModeOverride !== "none";

  const upgradeToPlus = useCallback((): PlusUpgradeResult => {
    if (canInstantUpgrade) {
      enablePlusTestMode();
      console.info("[DEV_SUBSCRIPTION] switched_to_plus");
      toast.success("已啟用 Roamie Plus");
      return "upgraded";
    }
    setComingSoonOpen(true);
    return "coming_soon";
  }, [canInstantUpgrade, enablePlusTestMode]);

  return {
    upgradeToPlus,
    canInstantUpgrade,
    comingSoonOpen,
    setComingSoonOpen,
  };
}
