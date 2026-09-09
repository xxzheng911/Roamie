import { Link } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAccess } from "@/hooks/use-access";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";
import { useSubscription } from "@/providers/SubscriptionProvider";
import { openSubscriptionManagement } from "@/lib/open-subscription-settings";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: "quiz" | "memory" | "personalized" | "general";
  /** 成功啟用 Plus 後（開發模式或正式訂閱） */
  onUpgraded?: () => void;
};

/**
 * Plus 功能介紹 + TestFlight 測試模式切換（不接真實付款）。
 */
export function RoamiePlusIntroDialog({ open, onOpenChange, onUpgraded }: Props) {
  const {
    isPlusUser,
    devPlusMode,
    canShowDeveloperTools,
    enablePlusTestMode,
    disablePlusTestMode,
  } = useAccess();
  const { packages, offeringsLoading, error, loadOfferings, purchase, restore } = useSubscription();
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const showTestControls = isDeveloperBuildEnabled() || canShowDeveloperTools;

  useEffect(() => {
    if (open && !isPlusUser) void loadOfferings();
  }, [open, isPlusUser, loadOfferings]);

  const handlePurchase = async (packageId: string) => {
    setBusyPackage(packageId);
    try {
      const result = await purchase(packageId);
      if (result.outcome === "cancelled") return;
      if (result.outcome === "pending") {
        toast.message("購買仍在等待 Apple 確認");
        return;
      }
      if (!result.status.isActive) {
        toast.error("購買完成，但 Plus entitlement 尚未生效");
        return;
      }
      toast.success("Roamie Plus 已啟用");
      onUpgraded?.();
      onOpenChange(false);
    } catch {
      toast.error("目前無法完成購買，請稍後再試");
    } finally {
      setBusyPackage(null);
    }
  };

  const handleRestore = async () => {
    setBusyPackage("restore");
    try {
      const result = await restore();
      if (result.status.isActive) {
        toast.success("已恢復 Roamie Plus");
        onUpgraded?.();
        onOpenChange(false);
      } else toast.message("找不到可恢復的 Plus 訂閱");
    } catch {
      toast.error("恢復購買失敗，請稍後再試");
    } finally {
      setBusyPackage(null);
    }
  };

  const handleEnableTest = () => {
    enablePlusTestMode();
    toast.success("已開啟 Plus 測試模式");
    onUpgraded?.();
    onOpenChange(false);
  };

  const handleDisableTest = () => {
    disablePlusTestMode();
    toast.message("已切換回 Free（收藏與行程資料仍保留）");
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[min(100%,22rem)] rounded-3xl border-border">
        <AlertDialogCancel
          aria-label="關閉"
          className="absolute right-4 top-4 mt-0 h-8 w-8 rounded-full border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-secondary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">關閉</span>
        </AlertDialogCancel>
        <AlertDialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
            <Sparkles className="h-6 w-6 text-clay" />
          </div>
          <AlertDialogTitle className="text-center font-display text-xl leading-snug">
            {isPlusUser ? "Roamie Plus 已啟用" : "升級 Roamie Plus"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-sm leading-relaxed text-muted-foreground">
              {isPlusUser ? (
                <>
                  {devPlusMode ? (
                    <p className="rounded-2xl bg-secondary/80 px-3 py-2 text-xs text-foreground/85">
                      目前為 <span className="font-medium">Plus 測試模式</span>
                      。關閉後會立即恢復 Free
                      體驗（長期記憶與深層個人化關閉；收藏、偏好與行程仍保留）。
                    </p>
                  ) : (
                    <p>已啟用 Roamie Plus：旅行偏好、收藏記憶與個人化推薦。</p>
                  )}
                  <Link
                    to="/travel-preference-test"
                    search={{ from: "home" }}
                    onClick={() => onOpenChange(false)}
                    className="block w-full rounded-full bg-primary py-3 text-center text-sm font-medium text-primary-foreground"
                  >
                    管理我的旅行偏好
                  </Link>
                  <button
                    type="button"
                    className="w-full text-center text-xs underline"
                    onClick={() => void openSubscriptionManagement()}
                  >
                    管理訂閱
                  </button>
                </>
              ) : (
                <p>讓 Roamie 記住你的旅行偏好，提供更貼近你的推薦與行程。</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {isPlusUser ? (
            <>
              {showTestControls ? (
                <AlertDialogAction
                  className="w-full rounded-full border border-border bg-card py-3 text-sm font-medium text-foreground hover:bg-secondary"
                  onClick={handleDisableTest}
                >
                  {devPlusMode ? "取消 Plus 測試模式" : "切換回 Free"}
                </AlertDialogAction>
              ) : null}
              {showTestControls && !devPlusMode ? (
                <AlertDialogCancel
                  className="mt-0 w-full rounded-full border-clay/40 bg-accent py-3 text-sm font-medium text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    handleEnableTest();
                  }}
                >
                  開啟 Plus 測試模式
                </AlertDialogCancel>
              ) : null}
              <AlertDialogCancel className="mt-0 w-full rounded-full py-3 text-sm">
                關閉
              </AlertDialogCancel>
            </>
          ) : (
            <>
              {offeringsLoading ? (
                <p className="py-2 text-center text-sm text-muted-foreground">正在載入方案…</p>
              ) : null}
              {packages.map((pkg) => (
                <AlertDialogAction
                  key={pkg.identifier}
                  className="w-full rounded-full bg-primary py-3 text-sm font-medium"
                  disabled={busyPackage !== null}
                  onClick={(e) => {
                    e.preventDefault();
                    void handlePurchase(pkg.identifier);
                  }}
                >
                  {busyPackage === pkg.identifier
                    ? "正在連接 App Store…"
                    : `${pkg.period === "yearly" ? "年繳" : pkg.period === "monthly" ? "月繳" : pkg.title} · ${pkg.priceString}`}
                </AlertDialogAction>
              ))}
              {error ? (
                <div className="space-y-2 text-center">
                  <p className="text-xs text-destructive">目前無法載入訂閱方案</p>
                  <button
                    type="button"
                    className="text-sm font-medium underline"
                    disabled={offeringsLoading || busyPackage !== null}
                    onClick={() => void loadOfferings()}
                  >
                    重新載入方案
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="w-full py-2 text-center text-sm underline"
                disabled={busyPackage !== null}
                onClick={() => void handleRestore()}
              >
                恢復購買
              </button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
