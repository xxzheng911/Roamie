import { useEffect } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { isDeveloperBuildEnabled, unlockDeveloperMode } from "@/lib/access/developer";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";

/**
 * 個人頁：Free / Plus 切換（測試用）
 * - 開發版：永遠顯示
 * - 尚未開啟真實付款（VITE_BILLING_ENABLED != 1）：也顯示，方便 TestFlight QA 測 Plus 功能
 * - 真實上線後（billingEnabled=true 且非開發版）：不顯示
 */
export function ProfilePlanSwitcher({ className }: { className?: string }) {
  const { hasPlusAccess, enablePlusTestMode, disablePlusTestMode, refresh } = useAccess();

  useEffect(() => {
    unlockDeveloperMode();
    window.dispatchEvent(new CustomEvent(ACCESS_CHANGED_EVENT));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = import.meta.env.DEV || isDeveloperBuildEnabled();
  if (!show) return null;

  return (
    <section className={`overflow-hidden rounded-3xl border border-border bg-card shadow-soft ${className ?? ""}`}>
      <p className="border-b border-border px-6 py-2.5 text-[15px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        訂閱方案（測試 · 雙向切換）
      </p>
      <p className="px-4 pb-1 text-xs text-muted-foreground">
        Plus 模擬訂閱；Free 模擬取消訂閱。收藏、偏好與行程不會刪除。
      </p>
      <div className="flex gap-2 px-4 py-4">
        {(
          [
            { id: "free" as const, label: "Free" },
            { id: "plus" as const, label: "Roamie Plus" },
          ] as const
        ).map((plan) => {
          const active = plan.id === "plus" ? hasPlusAccess : !hasPlusAccess;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => {
                if (plan.id === "plus") enablePlusTestMode();
                else disablePlusTestMode();
                toast.message(plan.label);
              }}
              className={`flex-1 rounded-full border py-3 text-sm font-medium transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              {plan.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
