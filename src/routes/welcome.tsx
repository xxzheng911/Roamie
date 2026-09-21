import { useI18n } from "@/hooks/use-i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Crown, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { useAccessOptional } from "@/hooks/use-access";
import { usePlusUpgrade } from "@/hooks/use-plus-upgrade";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { markIntroCompleted } from "@/lib/plan-tier";
import { applyLocalMockPlanTier, syncMockPlanTierToProfile } from "@/lib/plan-tier/sync-mock-tier";
import {
  loadOnboardingState,
  isOnboardingCompletedSync,
  logShowOnboardingFirstLaunch,
  logSkipOnboarding,
} from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import { guardStartupTarget, logStartupNavigationContext } from "@/lib/startup-navigation";
import { logNavSkipSameRoute, shouldSkipStartupNavigation } from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";
import { resetOnboardingState } from "@/lib/onboarding-storage";
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
    // 已完成 onboarding 時勿 throw redirect — 會在 router bootstrap 階段 reject YR()（REACT_UNCAUGHT）。
    // 改由 OnboardingGate → AppBootRouteSync 在 router 就緒後 navigate(replace)。
  },
  component: Welcome,
});

function Welcome() {
  const { t, tList } = useI18n();
  const INTRO_STEPS = [1, 2, 3].map((index) => ({
    title: t(`plusPurchase.intro${index}Title`),
    body: t(`plusPurchase.intro${index}Body`),
    cta: t(index === 1 ? "plusPurchase.start" : "plusPurchase.continue"),
  }));
  const navigate = useNavigate();
  useIosInteractiveRoute("welcome");
  const access = useAccessOptional();
  const { openRevenueCatPaywall } = usePlusUpgrade();
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const isTierStep = step >= INTRO_STEPS.length;

  const goNextAfterOnboarding = async () => {
    const next = guardStartupTarget(
      await resolveStartupPath({ skipLog: true, source: "welcome-complete" }),
      "welcome-complete",
    );
    const current = readBrowserPathname();
    if (shouldSkipStartupNavigation(current, next)) {
      logNavSkipSameRoute({ source: "welcome-complete", current, target: next });
      return;
    }
    await logStartupNavigationContext("welcome-complete", next);
    navigate({ to: next, replace: true });
  };

  const completeSelection = async (tier: "free" | "plus") => {
    if (finishing) return;
    setFinishing(true);

    try {
      if (tier === "plus") {
        await markIntroCompleted(tier);
        trackEvent(AnalyticsEvents.INTRO_COMPLETED, { tier_choice: tier });
        openRevenueCatPaywall();
        setFinishing(false);
        return;
      } else if (access) {
        access.disablePlusTestMode();
      } else {
        applyLocalMockPlanTier("free");
        void syncMockPlanTierToProfile("free");
      }

      await markIntroCompleted(tier);
      trackEvent(AnalyticsEvents.INTRO_COMPLETED, { tier_choice: tier });
      await goNextAfterOnboarding();
    } catch (e) {
      console.error("[welcome] companion mode selection failed", e);
      toast.error(t("plusPurchase.setupError"));
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
            {t("plusPurchase.resetIntro")}
          </button>
        ) : null}
        {!isTierStep ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-[max(2rem,var(--safe-area-bottom))] pt-[max(1.5rem,var(--safe-area-top))]">
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
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  {t("plusPurchase.tierLabel")}
                </p>
                <h1 className="mt-3 font-display text-[26px] leading-snug">
                  {t("plusPurchase.tierHeading")}
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                  {t("plusPurchase.tierBody")}
                </p>

                <div className="mt-8 space-y-4">
                  <div className="rounded-3xl border border-border bg-card/80 p-5 shadow-soft">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-clay" />
                      <p className="font-display text-lg">{t("plusPurchase.freeName")}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("plusPurchase.freeTagline")}
                    </p>
                    <ul className="mt-4 space-y-2 text-sm text-foreground/90">
                      {tList("plusPurchase.freeFeatures").map((item) => (
                        <li key={item}>· {item}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={finishing}
                      onClick={() => void completeSelection("free")}
                      className="relative z-10 mt-5 w-full whitespace-normal break-words px-4 touch-manipulation rounded-full border border-foreground bg-foreground py-3.5 text-sm font-medium text-background disabled:opacity-50"
                    >
                      {finishing ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          {t("plusPurchase.settingUp")}
                        </span>
                      ) : (
                        t("plusPurchase.tryFree")
                      )}
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-clay/25 bg-gradient-to-br from-accent/50 via-card to-secondary/40 p-5 shadow-soft">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay/12 ring-1 ring-clay/20">
                        <Crown className="h-4 w-4 text-clay" strokeWidth={1.75} />
                      </span>
                      <p className="font-display text-lg leading-tight">
                        {t("plusPurchase.title")}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("plusPurchase.plusTagline")}
                    </p>
                    <ul className="mt-4 space-y-2 text-sm text-foreground/90">
                      {tList("plusPurchase.plusFeatures").map((item) => (
                        <li key={item}>· {item}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={finishing}
                      onClick={() => void completeSelection("plus")}
                      className="relative z-10 mt-5 w-full whitespace-normal break-words px-4 touch-manipulation rounded-full border border-clay/40 bg-card/95 py-3.5 text-sm font-semibold text-foreground shadow-soft ring-1 ring-clay/10 transition active:scale-[0.99] disabled:opacity-50"
                    >
                      {finishing ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          {t("plusPurchase.settingUp")}
                        </span>
                      ) : (
                        t("plusPurchase.upgrade")
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
