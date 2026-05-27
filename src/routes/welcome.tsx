import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { useAccessOptional } from "@/hooks/use-access";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { getClientAuthSession } from "@/lib/auth-session";
import { forceFreeMode, forcePlusMode, applyMockSubscription } from "@/lib/access/dev-actions";
import { markIntroCompleted } from "@/lib/plan-tier";
import {
  loadOnboardingState,
  isOnboardingCompletedSync,
  logShowOnboardingFirstLaunch,
  logSkipOnboarding,
} from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import {
  guardStartupTarget,
  logStartupNavigationContext,
} from "@/lib/startup-navigation";
import { openSubscriptionManagement } from "@/lib/open-subscription-settings";
import { resetOnboardingState } from "@/lib/onboarding-storage";
import { clientEnv } from "@/constants/env";
import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";

export const Route = createFileRoute("/welcome")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    await loadOnboardingState();
    if (!isOnboardingCompletedSync()) {
      logShowOnboardingFirstLaunch();
      return;
    }

    logSkipOnboarding("welcome-beforeLoad");
    const session = await getClientAuthSession();
    const hasSession = Boolean(session?.user);
    const next = guardStartupTarget(hasSession ? "/" : "/login", "welcome-beforeLoad");
    await logStartupNavigationContext("welcome-beforeLoad", next);
    throw redirect({ to: next });
  },
  component: Welcome,
});

const INTRO_STEPS = [
  {
    title: "不是規劃旅行，\n而是有人開始理解你想怎麼旅行。",
    body: "Roamie 會依照你的心情、節奏與旅行習慣，\n陪你慢慢找到適合現在的目的地。",
    cta: "開始旅程",
  },
  {
    title: "有時候，\n你只是想有人幫你少想一點。",
    body: "不論是突然想散心、\n不知道吃什麼、\n還是只想放空一下。\n\nRoamie 都會陪你一起找到答案。",
    cta: "繼續",
  },
  {
    title: "每個人的旅行方式，\n其實都不太一樣。",
    body: "有人喜歡慢慢散步，\n有人喜歡塞滿行程。\n\n有人想逃離人群，\n有人喜歡熱鬧與新鮮感。\n\nRoamie 會慢慢認識你。",
    cta: "繼續",
  },
] as const;

function Welcome() {
  const navigate = useNavigate();
  useIosInteractiveRoute("welcome");
  const access = useAccessOptional();
  const canShowDeveloperTools = access?.canShowDeveloperTools ?? import.meta.env.DEV;
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const isTierStep = step >= INTRO_STEPS.length;

  const goNextAfterOnboarding = async () => {
    const next = guardStartupTarget(
      await resolveStartupPath({ skipLog: true, source: "welcome-complete" }),
      "welcome-complete",
    );
    await logStartupNavigationContext("welcome-complete", next);
    navigate({ to: next, replace: true });
  };

  const completeSelection = async (tier: "free" | "plus") => {
    if (finishing) return;
    setFinishing(true);

    try {
      if (tier === "plus") {
        const billingConfigured = Boolean(clientEnv.revenueCatAppleKey || clientEnv.revenueCatGoogleKey);
        const shouldBypassBilling =
          import.meta.env.DEV || canShowDeveloperTools || !clientEnv.billingEnabled || !billingConfigured;
        if (shouldBypassBilling) {
          if (access) {
            access.enablePlusTestMode();
          } else {
            applyMockSubscription("plus");
            forcePlusMode();
          }
        } else {
          void openSubscriptionManagement();
        }
      } else if (access) {
        access.disablePlusTestMode();
      } else {
        applyMockSubscription("free");
        forceFreeMode();
      }

      await markIntroCompleted(tier);
      trackEvent(AnalyticsEvents.INTRO_COMPLETED, { tier_choice: tier });
      await goNextAfterOnboarding();
    } catch (e) {
      console.error("[welcome] companion mode selection failed", e);
      toast.error(e instanceof Error ? e.message : "無法完成設定，請再試一次");
      setFinishing(false);
    }
  };

  const next = () => {
    if (step === 0) {
      trackEvent(AnalyticsEvents.ONBOARDING_STARTED, { flow: "welcome_intro" });
    }
    if (step < INTRO_STEPS.length) {
      setStep(step + 1);
    }
  };

  const isDev = import.meta.env.DEV;

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isDev ? (
          <button
            type="button"
            className="absolute right-3 top-[max(0.5rem,var(--safe-area-top))] z-20 rounded-full border border-dashed border-border px-2 py-1 text-[10px] text-muted-foreground"
            onClick={() => {
              void resetOnboardingState().then(() => window.location.reload());
            }}
          >
            [Dev] 重置教學
          </button>
        ) : null}
        {!isTierStep ? (
          <div className="flex min-h-0 flex-1 flex-col px-8 pb-[max(2rem,var(--safe-area-bottom))] pt-[max(1.5rem,var(--safe-area-top))]">
            <div className="flex justify-center gap-1.5 pb-2">
              {INTRO_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 w-8 rounded-full transition duration-500 ${i <= step ? "bg-foreground" : "bg-border"}`}
                />
              ))}
            </div>
            <div className="flex flex-1 flex-col justify-center animate-rise" key={step}>
              <h1 className="whitespace-pre-line font-display text-[26px] leading-snug text-balance">
                {INTRO_STEPS[step].title}
              </h1>
              <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground">
                {INTRO_STEPS[step].body}
              </p>
            </div>

            <div className="pb-2 pt-10">
              <button
                type="button"
                onClick={next}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-[15px] font-medium text-primary-foreground shadow-lift transition active:scale-[0.99]"
              >
                {INTRO_STEPS[step].cta}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="welcome-tier-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain no-scrollbar">
              <div className="animate-rise px-8 pb-[max(2rem,env(safe-area-inset-bottom,0px))] pt-[max(1.5rem,var(--safe-area-top))]">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">陪伴方式</p>
                <h1 className="mt-3 font-display text-[26px] leading-snug">
                  選擇適合你的旅行陪伴方式
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                  你可以自由使用 Roamie，
                  <br />
                  也可以讓 AI 更深入認識你。
                </p>

                <div className="mt-8 space-y-4">
                  <div className="rounded-3xl border border-border bg-card/80 p-5 shadow-soft">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-clay" />
                      <p className="font-display text-lg">Roamie Free</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">輕量旅遊陪伴</p>
                    <ul className="mt-4 space-y-2 text-sm text-foreground/90">
                      <li>· 基本 AI 旅遊對話</li>
                      <li>· 行程與地點推薦</li>
                      <li>· 地圖導航</li>
                      <li>· 收藏地點</li>
                      <li>· 即時探索附近靈感</li>
                    </ul>
                    <button
                      type="button"
                      disabled={finishing}
                      onClick={() => void completeSelection("free")}
                      className="relative z-10 mt-5 w-full touch-manipulation rounded-full border border-foreground bg-foreground py-3.5 text-sm font-medium text-background disabled:opacity-50"
                    >
                      {finishing ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          設定中…
                        </span>
                      ) : (
                        "先體驗使用 Free"
                      )}
                    </button>
                  </div>

                  <div className="rounded-3xl border border-dashed border-border bg-card/50 p-5">
                    <p className="font-display text-lg">Roamie Plus</p>
                    <p className="mt-1 text-xs text-muted-foreground">更懂你的 AI 旅伴</p>
                    <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <li>· AI 長期記住你的旅行偏好</li>
                      <li>· 更深度的個人化推薦</li>
                      <li>· 旅行人格與心情分析</li>
                      <li>· 情境式旅程安排</li>
                      <li>· 回憶整理與旅行紀錄</li>
                      <li>· 更貼近你的對話體驗</li>
                    </ul>
                    <button
                      type="button"
                      disabled={finishing}
                      onClick={() => void completeSelection("plus")}
                      className="relative z-10 mt-5 w-full touch-manipulation rounded-full border border-border bg-card py-3.5 text-sm font-medium text-foreground disabled:opacity-50"
                    >
                      {finishing ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          設定中…
                        </span>
                      ) : (
                        "立即升級 Plus"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div
              aria-hidden
              className="pointer-events-none h-[max(1.25rem,env(safe-area-inset-bottom,0px))] shrink-0"
            />
          </>
        )}
      </div>
    </MobileFrame>
  );
}
