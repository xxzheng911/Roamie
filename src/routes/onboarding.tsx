import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { RoamieMascotFigure } from "@/components/onboarding/RoamieMascotFigure";
import { requirePreferenceQuizRouteAccess } from "@/lib/require-auth";
import { readGuestFlag } from "@/lib/auth-session";
import { isIntroCompleted } from "@/lib/plan-tier";
import {
  savePreferences,
  type BudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import { savePersonalityToProfile } from "@/lib/profile-storage";
import { QUIZ_STEP_POSE, type QuizStepKey } from "@/lib/mascot-assets";
import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";

type OnboardingSearch = { from?: string };

export const Route = createFileRoute("/onboarding")({
  validateSearch: (s: Record<string, unknown>): OnboardingSearch => ({
    from: typeof s.from === "string" ? s.from : undefined,
  }),
  beforeLoad: async ({ search }) => {
    await requirePreferenceQuizRouteAccess(search.from);
  },
  component: Onboarding,
});

type StepKey = "pace" | "avoid" | "vibe" | "budget";
type StepOption = { t: string; d: string; value: string };

const steps: { key: StepKey; q: string; sub: string; options: StepOption[] }[] = [
  {
    key: "pace",
    q: "你喜歡慢旅行嗎？",
    sub: "了解你的步調，幫你安排剛剛好的份量。",
    options: [
      { t: "超慢", d: "一天去一個地方就夠了", value: "slow" },
      { t: "中等", d: "想看一些，也想留時間發呆", value: "medium" },
      { t: "想多看", d: "希望一天有滿滿的回憶", value: "active" },
    ],
  },
  {
    key: "avoid",
    q: "哪一種旅行會讓你很累？",
    sub: "Roamie 會避開讓你不舒服的安排。",
    options: [
      { t: "人潮太多", d: "排隊、擠來擠去最累", value: "crowds" },
      { t: "行程太滿", d: "一直趕場很疲憊", value: "packed" },
      { t: "資訊太多", d: "選擇障礙會發作", value: "overload" },
    ],
  },
  {
    key: "vibe",
    q: "你喜歡安靜還是熱鬧？",
    sub: "決定你的城市探索基調。",
    options: [
      { t: "安靜為主", d: "巷弄、書店、海邊", value: "quiet" },
      { t: "都可以", d: "看當天心情", value: "either" },
      { t: "喜歡熱鬧", d: "市集、夜市、街頭", value: "lively" },
    ],
  },
  {
    key: "budget",
    q: "這趟想花多少？",
    sub: "Roamie 會依預算推薦餐廳、咖啡、景點與住宿。",
    options: [
      { t: "小資", d: "平價、在地、不踩雷", value: "budget" },
      { t: "一般", d: "舒服自在、剛剛好", value: "standard" },
      { t: "品質感", d: "有質感但不浮誇", value: "quality" },
      { t: "奢華", d: "好好享受、少計較", value: "luxury" },
    ],
  },
];

function Onboarding() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const quizOrigin = search.from;
  const fromProfile = quizOrigin === "profile";
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const current = steps[step];
  const choice = picked[step];

  const exitQuiz = () => {
    if (quizOrigin === "profile") {
      navigate({ to: "/profile" });
      return;
    }
    if (quizOrigin === "chat") {
      navigate({ to: "/chat" });
      return;
    }
    navigate({ to: "/" });
  };

  const next = async () => {
    if (choice === undefined) return;
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    try {
      const prefs: TravelPreferences = { onboarded: true };
      steps.forEach((s, i) => {
        const val = s.options[picked[i]]?.value;
        if (val === undefined) return;
        if (s.key === "avoid") prefs.avoid = [val];
        else if (s.key === "pace") prefs.pace = val as TravelPreferences["pace"];
        else if (s.key === "vibe") prefs.vibe = val as TravelPreferences["vibe"];
        else if (s.key === "budget") prefs.budgetMode = val as BudgetMode;
      });
      await savePersonalityToProfile(prefs);
      trackEvent(AnalyticsEvents.ONBOARDING_COMPLETED, {
        pace: prefs.pace,
        vibe: prefs.vibe,
        budget_mode: prefs.budgetMode,
      });
      if (fromProfile) {
        navigate({ to: "/profile", search: { quiz: "done" } });
      } else if (quizOrigin === "chat") {
        navigate({ to: "/chat", replace: true });
      } else {
        const guest = readGuestFlag();
        const next = guest ? "/" : (await isIntroCompleted()) ? "/" : "/welcome";
        navigate({ to: next, replace: true });
      }
    } catch (e) {
      console.error("[Roamie] onboarding save failed", e);
      toast.error(e instanceof Error ? e.message : "儲存失敗");
      setSaving(false);
    }
  };

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-[max(2rem,var(--safe-area-bottom))] pt-[max(1rem,var(--safe-area-top))]">
        <div className="relative flex items-center justify-center pb-2">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1 w-6 rounded-full transition ${i <= step ? "bg-foreground" : "bg-border"}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={exitQuiz}
            disabled={saving}
            className="absolute right-0 top-0 text-sm text-muted-foreground disabled:opacity-40"
          >
            取消
          </button>
        </div>

        <div className="quiz-mascot" aria-hidden>
          <RoamieMascotFigure
            key={current.key}
            pose={QUIZ_STEP_POSE[current.key as QuizStepKey]}
            variant="quiz"
            motion="fade-in"
          />
        </div>

        <div className="mt-5 animate-rise" key={step}>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
            第 {step + 1} 題 / 共 {steps.length} 題
          </p>
          <h1 className="mt-3 font-display text-[28px] leading-snug text-balance">{current.q}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{current.sub}</p>
        </div>

        <div className="mt-8 space-y-3">
          {current.options.map((o, i) => {
            const active = choice === i;
            return (
              <button
                key={o.t}
                onClick={() => !saving && setPicked({ ...picked, [step]: i })}
                disabled={saving}
                className={`flex w-full items-center justify-between rounded-3xl border p-5 text-left transition ${
                  active
                    ? "border-foreground bg-card shadow-lift"
                    : "border-border bg-card/70 hover:bg-card"
                }`}
              >
                <div>
                  <p className="text-[17px] font-medium">{o.t}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{o.d}</p>
                </div>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                    active ? "border-foreground bg-foreground text-background" : "border-border"
                  }`}
                >
                  {active && <Check className="h-4 w-4" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-auto pt-8">
          <button
            onClick={next}
            disabled={choice === undefined || saving}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-[15px] font-medium text-primary-foreground shadow-lift disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                儲存中…
              </>
            ) : (
              <>
                {step === steps.length - 1 ? "完成測驗" : "下一題"}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </MobileFrame>
  );
}
