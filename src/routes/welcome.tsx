import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import { PlusComingSoonDialog } from "@/components/PlusComingSoonDialog";
import { requireAuthenticatedRoute } from "@/lib/require-auth";
import { isIntroCompleted, markIntroCompleted } from "@/lib/plan-tier";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";

export const Route = createFileRoute("/welcome")({
  beforeLoad: async () => {
    await requireAuthenticatedRoute();
    if (typeof window === "undefined") return;
    const next = await resolveStartupPath({ isGuest: false, hasSession: true });
    if (next !== "/welcome") {
      throw redirect({ to: next });
    }
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
  const [step, setStep] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const isTierStep = step >= INTRO_STEPS.length;

  const finishWithFree = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await markIntroCompleted();
      trackEvent(AnalyticsEvents.INTRO_COMPLETED, { tier_choice: "free" });
      navigate({ to: "/", replace: true });
    } catch (e) {
      console.error("[welcome] mark intro failed", e);
      setFinishing(false);
    }
  };

  const next = () => {
    if (step === 0) {
      trackEvent(AnalyticsEvents.ONBOARDING_STARTED, { flow: "welcome_intro" });
    }
    if (step < INTRO_STEPS.length) {
      setStep(step + 1);
      return;
    }
  };

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col px-8 pb-[max(2rem,var(--safe-area-bottom))] pt-[max(1.5rem,var(--safe-area-top))]">
        {!isTierStep ? (
          <>
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
          </>
        ) : (
          <>
            <div className="flex flex-1 flex-col justify-center animate-rise">
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
                    onClick={() => void finishWithFree()}
                    className="mt-5 w-full rounded-full border border-foreground bg-foreground py-3.5 text-sm font-medium text-background disabled:opacity-50"
                  >
                    目前使用 Free
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
                    onClick={() => setPlusOpen(true)}
                    className="mt-5 w-full rounded-full border border-border bg-card py-3.5 text-sm font-medium text-foreground"
                  >
                    了解 Roamie Plus
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <PlusComingSoonDialog open={plusOpen} onOpenChange={setPlusOpen} />
    </MobileFrame>
  );
}
