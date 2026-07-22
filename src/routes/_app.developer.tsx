import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { runOpenWeatherDevTest, runRoutesDevTest, type ApiDevTestResult } from "@/services/apiDevTools";
import {
  clearSavedCollections,
  forceOnboarding,
  resetTravelPreference,
  resetUserMemory,
} from "@/lib/access/dev-actions";
import { lockDeveloperMode } from "@/lib/access/developer";
import { broadcastAccessChange } from "@/lib/access/events";
import { clearBootstrapSplashForDev } from "@/lib/bootstrap-splash";
import {
  creditsDebugStatusLine,
  DEBUG_CREDIT_PRESETS,
  debugClearCreditsOverride,
  debugClearOverride,
  debugDeductOneCredit,
  debugForceFree,
  debugForcePlus,
  debugResetCredits,
  debugSetCredits,
  debugSubscriptionAuto,
  fetchCreditAccount,
  getCachedCreditAccount,
  isCreditsFeatureEnabled,
  resolveCreditsFeatureFlag,
  usableCredits,
} from "@/lib/credits";

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

function ApiTestResultCard({ result }: { result: ApiDevTestResult | null }) {
  if (!result) return null;
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        result.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <p className="font-medium">{result.ok ? "✅ API connected" : "❌ API failed"}</p>
      <p className="mt-1 text-xs text-muted-foreground">{result.label}</p>
      {result.ok ? (
        <p className="mt-2 text-xs">{result.detail}</p>
      ) : (
        <>
          <p className="mt-2 text-xs">status: {result.statusCode ?? "—"}</p>
          <p className="mt-1 text-xs">{result.message}</p>
          {result.hint ? <pre className="mt-2 whitespace-pre-wrap text-[10px] opacity-80">{result.hint}</pre> : null}
        </>
      )}
    </div>
  );
}

function DeveloperSettingsPage() {
  const navigate = useNavigate();
  const [weatherTestResult, setWeatherTestResult] = useState<ApiDevTestResult | null>(null);
  const [routesTestResult, setRoutesTestResult] = useState<ApiDevTestResult | null>(null);
  const [creditsAvailable, setCreditsAvailable] = useState<number | null>(null);
  const [formalAvailable, setFormalAvailable] = useState<number | null>(null);
  const [overrideActive, setOverrideActive] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const account = (await fetchCreditAccount()) ?? getCachedCreditAccount();
      if (!cancelled) {
        setCreditsAvailable(account ? usableCredits(account) : null);
        setFormalAvailable(account?.formal_available_credits ?? null);
        setOverrideActive(Boolean(account?.override_active));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPlusAccess, testModeOverride]);

  const reloadCredits = async () => {
    const account = (await fetchCreditAccount()) ?? getCachedCreditAccount();
    setCreditsAvailable(account ? usableCredits(account) : null);
    setFormalAvailable(account?.formal_available_credits ?? null);
    setOverrideActive(Boolean(account?.override_active));
  };

  const subscriptionDebugMode =
    testModeOverride === "force-free"
      ? "force-free"
      : testModeOverride === "force-plus"
        ? "force-plus"
        : "auto";


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
    navigate({ to: "/welcome", replace: true });
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
          API 連線測試
        </p>
        <DevActionButton
          label="Test OpenWeather（高雄）"
          desc="temperature · description · rain probability"
          onClick={async () => {
            const result = await runOpenWeatherDevTest();
            setWeatherTestResult(result);
            if (result.ok) toast.success("OpenWeather 連線成功");
            else toast.error(result.message);
          }}
        />
        <ApiTestResultCard result={weatherTestResult} />
        <DevActionButton
          label="Test Routes API（高雄車站 → 駁二 · WALK）"
          desc="Google Routes computeRoutes"
          onClick={async () => {
            const result = await runRoutesDevTest();
            setRoutesTestResult(result);
            if (result.ok) toast.success("Routes API 連線成功");
            else toast.error(result.message);
          }}
        />
        <ApiTestResultCard result={routesTestResult} />
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
          Subscription Debug
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              debugSubscriptionAuto();
              refresh();
              toast.message("Subscription Auto（讀取真實訂閱）");
            }}
            className={`rounded-full border px-4 py-2 text-xs ${
              subscriptionDebugMode === "auto"
                ? "border-foreground bg-foreground text-background"
                : "border-border"
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => {
              debugForceFree();
              refresh();
              toast.message("Force Free");
            }}
            className={`rounded-full border px-4 py-2 text-xs ${
              subscriptionDebugMode === "force-free"
                ? "border-foreground bg-foreground text-background"
                : "border-border"
            }`}
          >
            Force Free
          </button>
          <button
            type="button"
            onClick={() => {
              debugForcePlus();
              refresh();
              toast.message("Force Plus");
            }}
            className={`rounded-full border px-4 py-2 text-xs ${
              subscriptionDebugMode === "force-plus"
                ? "border-foreground bg-foreground text-background"
                : "border-border"
            }`}
          >
            Force Plus
          </button>
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          Auto = 真實 Apple／Supabase 訂閱。Force 僅覆寫本機測試狀態，不模擬訂閱週期。目前 Plus：
          {hasPlusAccess ? "是" : "否"} · mode={subscriptionDebugMode}
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Credits Debug Override
        </p>
        <p className="px-1 text-[11px] text-muted-foreground">
          {creditsDebugStatusLine({
            available: creditsAvailable,
            formalAvailable,
            overrideActive,
            hasPlusAccess,
            subscriptionMode: subscriptionDebugMode,
          })}{" "}
          · source={resolveCreditsFeatureFlag().source}
        </p>
        <p className="rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          Set／Deduct／Reset 只寫入 <strong>credit_debug_overrides</strong>，不改正式{" "}
          <strong>available_credits</strong>。Runtime 優先讀 Override；Clear Override 後恢復正式資料。
        </p>
        {!isCreditsFeatureEnabled() ? (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800">
            VITE_FEATURE_CREDITS_ENABLED 目前為 OFF。Debug Override 可設定，但 Runtime 不會 Gate／扣點。
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {DEBUG_CREDIT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={async () => {
                const result = await debugSetCredits(n);
                await reloadCredits();
                refresh();
                if (result.ok) toast.success(`Override Credits = ${n}（Force Free）`);
                else toast.error(result.message ?? "Set Override 失敗");
              }}
              className={`rounded-full border px-3 py-2 text-xs ${
                overrideActive && creditsAvailable === n
                  ? "border-foreground bg-foreground text-background"
                  : "border-border"
              }`}
            >
              Set {n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              const result = await debugResetCredits();
              await reloadCredits();
              refresh();
              if (result.ok) toast.success("Override Reset → 20 + Force Free");
              else toast.error(result.message ?? "Reset 失敗");
            }}
            className="rounded-full border border-border px-4 py-2 text-xs"
          >
            Reset Override
          </button>
          <button
            type="button"
            onClick={async () => {
              const result = await debugDeductOneCredit();
              await reloadCredits();
              if (result.ok) toast.message(`Override Deduct 1 → ${result.available_credits}`);
              else toast.error(result.message ?? "Deduct 失敗");
            }}
            className="rounded-full border border-border px-4 py-2 text-xs"
          >
            Deduct 1 Credit
          </button>
          <button
            type="button"
            onClick={async () => {
              const result = await debugClearCreditsOverride();
              await reloadCredits();
              if (result.ok) toast.success("已清除 Credits Override（讀正式 Credits）");
              else toast.error(result.message ?? "Clear Override 失敗");
            }}
            className="rounded-full border border-border px-4 py-2 text-xs"
          >
            Clear Credits Override
          </button>
          <button
            type="button"
            onClick={async () => {
              await debugClearOverride();
              await reloadCredits();
              refresh();
              toast.message("Clear All Debug（Subscription Auto + Credits Override）");
            }}
            className="rounded-full border border-border px-4 py-2 text-xs"
          >
            Clear All Debug
          </button>
        </div>
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
