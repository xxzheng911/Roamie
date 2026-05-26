import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import {
  clearSavedCollections,
  forceFreeMode,
  forceOnboarding,
  forcePlusMode,
  clearTestModeOverride,
  resetTravelPreference,
  resetUserMemory,
} from "@/lib/access/dev-actions";
import { lockDeveloperMode } from "@/lib/access/developer";
import { broadcastAccessChange } from "@/lib/access/events";
import { clearBootstrapSplashForDev } from "@/lib/bootstrap-splash";

export const Route = createFileRoute("/_app/developer")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      // Never expose developer tools in production/TestFlight builds.
      throw new Error("Developer tools are disabled");
    }
  },
  component: DeveloperSettingsPage,
});

function DevActionButton({
  label,
  desc,
  onClick,
  destructive,
}: {
  label: string;
  desc: string;
  onClick: () => void | Promise<void>;
  destructive?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void Promise.resolve(onClick())
          .catch((e) => toast.error(e instanceof Error ? e.message : "操作失敗"))
          .finally(() => setBusy(false));
      }}
      className={`w-full rounded-2xl border px-4 py-3.5 text-left disabled:opacity-50 ${
        destructive ? "border-destructive/30 bg-destructive/5" : "border-border bg-background"
      }`}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

function DeveloperSettingsPage() {
  const navigate = useNavigate();
  const {
    canShowDeveloperTools,
    subscriptionState,
    effectiveTier,
    testModeOverride,
    hasPlusAccess,
    userRole,
    setSubscriptionState,
    refresh,
  } = useAccess();

  if (!canShowDeveloperTools) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-16">
        <p className="text-sm text-muted-foreground">開發者模式未啟用</p>
        <Link to="/settings" className="mt-4 text-sm text-foreground underline">
          返回設定
        </Link>
      </div>
    );
  }

  const runOnboardingReset = async () => {
    await forceOnboarding();
    clearBootstrapSplashForDev();
    toast.success("已重置 onboarding");
    navigate({ to: "/login", replace: true });
  };

  return (
    <div className="px-5 pb-10 pt-3">
      <div className="flex items-center gap-2">
        <Link
          to="/settings"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          aria-label="返回"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-xl">Developer Settings</h1>
      </div>

      <section className="mt-6 rounded-3xl border border-dashed border-amber-500/40 bg-amber-500/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Debug only</p>
        <p className="mt-2 text-sm text-muted-foreground">
          角色：<strong>{userRole}</strong> · 有效方案：<strong>{effectiveTier === "plus" ? "Plus" : "Free"}</strong>
          {testModeOverride !== "none" ? ` · 覆寫：${testModeOverride}` : ""}
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Mock Subscription
        </p>
        <div className="flex gap-2">
          {(["free", "plus"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => {
                setSubscriptionState(tier);
                toast.message(`Mock 方案：${tier}`);
              }}
              className={`flex-1 rounded-full border py-2.5 text-sm capitalize ${
                subscriptionState === tier && testModeOverride === "none"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border"
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-5 space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Force test mode
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              forceFreeMode();
              refresh();
              toast.message("強制 Free 模式");
            }}
            className={`rounded-full border px-4 py-2 text-xs ${
              testModeOverride === "force-free" ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
          >
            Force Free
          </button>
          <button
            type="button"
            onClick={() => {
              forcePlusMode();
              refresh();
              toast.message("強制 Plus 模式");
            }}
            className={`rounded-full border px-4 py-2 text-xs ${
              testModeOverride === "force-plus" ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
          >
            Force Plus
          </button>
          <button
            type="button"
            onClick={() => {
              clearTestModeOverride();
              refresh();
              toast.message("已清除覆寫");
            }}
            className="rounded-full border border-border px-4 py-2 text-xs"
          >
            清除覆寫
          </button>
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          Developer 預設擁有 Plus；Force Free 可模擬一般免費使用者體驗。目前 Plus 存取：{hasPlusAccess ? "是" : "否"}
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Reset &amp; test flows
        </p>
        <DevActionButton
          label="Reset User Memory"
          desc="清除 AI 聊天紀錄與 session"
          onClick={async () => {
            await resetUserMemory();
            toast.success("已清除 AI 記憶");
          }}
        />
        <DevActionButton
          label="Reset Travel Preference"
          desc="清除測驗結果與旅行偏好"
          onClick={async () => {
            await resetTravelPreference();
            toast.success("已重置旅行偏好");
          }}
        />
        <DevActionButton
          label="Clear Saved Collections"
          desc="清除所有收藏地點與收藏行程"
          destructive
          onClick={async () => {
            await clearSavedCollections();
            toast.success("已清除收藏");
          }}
        />
        <DevActionButton
          label="Force Onboarding"
          desc="重新進入 intro / 首次使用流程"
          onClick={runOnboardingReset}
        />
      </section>

      <button
        type="button"
        onClick={() => {
          lockDeveloperMode();
          broadcastAccessChange();
          toast.message("已鎖定開發者模式");
          navigate({ to: "/settings" });
        }}
        className="mt-8 w-full rounded-full border border-border py-3 text-sm text-muted-foreground"
      >
        鎖定 Developer Mode
      </button>
    </div>
  );
}
