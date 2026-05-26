import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";

/** @deprecated 請用個人頁 ProfilePlanSwitcher；保留給非個人頁的極簡用途 */
export function SubscriptionTestPanel() {
  const { hasPlusAccess, enablePlusTestMode, disablePlusTestMode } = useAccess();

  if (!isDeveloperBuildEnabled()) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card">
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
              className={`flex-1 rounded-full border py-3 text-sm font-medium ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground"
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
