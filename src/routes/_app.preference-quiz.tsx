import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { SurveyResultScreen } from "@/components/survey/SurveyResultScreen";
import { useAccess } from "@/hooks/use-access";
import { useTravelPreferenceSurvey } from "@/hooks/use-travel-preference-survey";
import { getPlanBudgetOptions } from "@/lib/i18n/plan-form-options";
import { useI18n } from "@/hooks/use-i18n";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { type BudgetMode } from "@/lib/preferences-storage";
import { loadTravelPreferenceSurveyForUser } from "@/lib/travel-preference-survey-save";
import { requirePreferenceQuizRouteAccess } from "@/lib/require-auth";
import type { SurveyCompanionship } from "@/lib/travel-preference-survey-types";
import {
  openSurveyResultView,
  setSurveyReturnTo,
  startTravelPreferenceSurvey,
} from "@/lib/travel-preference-survey-store";

type QuizSearch = { returnTo?: string; retake?: string };

const INTEREST_OPTIONS = [
  "在地美食",
  "咖啡甜點",
  "拍照打卡",
  "逛街購物",
  "自然戶外",
  "藝文展覽",
  "夜景散步",
  "慢旅行",
] as const;

const COMPANION_OPTIONS: { value: SurveyCompanionship; label: string }[] = [
  { value: "solo", label: "一個人" },
  { value: "couple", label: "兩人" },
  { value: "friends", label: "朋友" },
  { value: "family", label: "家人" },
  { value: "flexible", label: "不一定" },
];

export const Route = createFileRoute("/_app/preference-quiz")({
  validateSearch: (s: Record<string, unknown>): QuizSearch => ({
    returnTo: typeof s.returnTo === "string" ? s.returnTo : "/profile",
    retake: typeof s.retake === "string" ? s.retake : undefined,
  }),
  beforeLoad: async () => {
    await requirePreferenceQuizRouteAccess();
  },
  pendingComponent: QuizRoutePending,
  component: PreferenceQuizPage,
});

function QuizRoutePending() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16">
      <p className="text-sm text-muted-foreground">載入旅行偏好測驗…</p>
    </div>
  );
}

function PreferenceQuizPage() {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { hasPlusAccess } = useAccess();
  const survey = useTravelPreferenceSurvey();
  const startedRef = useRef(false);
  const budgetOptions = getPlanBudgetOptions(locale);

  const returnTo = search.returnTo ?? "/profile";
  const safeReturnTo = returnTo === "/" ? "/profile" : returnTo;

  useEffect(() => {
    console.info("[TRAVEL_PREF_TEST] mounted");
    console.info("[TRAVEL_PREF_TEST] route=/preference-quiz");
  }, []);

  useEffect(() => {
    if (!hasPlusAccess) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const boot = async () => {
      try {
        if (search.retake === "1") {
          startTravelPreferenceSurvey({ returnTo: safeReturnTo, retake: true });
          return;
        }
        if (survey.sessionActive) {
          setSurveyReturnTo(safeReturnTo);
          return;
        }
        const userId = await getAuthenticatedUserId();
        if (userId) {
          try {
            const snapshot = await loadTravelPreferenceSurveyForUser(userId);
            if (snapshot?.resultProfile && snapshot.surveyCompleted) {
              openSurveyResultView(snapshot.resultProfile, safeReturnTo);
              return;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const stack = e instanceof Error ? e.stack : undefined;
            console.error("[SURVEY_ERROR] message=", msg);
            console.error("[SURVEY_ERROR] stack=", stack ?? "(none)");
          }
        }
        startTravelPreferenceSurvey({ returnTo: safeReturnTo });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? e.stack : undefined;
        console.error("[SURVEY_ERROR] message=", msg);
        console.error("[SURVEY_ERROR] stack=", stack ?? "(none)");
        startTravelPreferenceSurvey({ returnTo: safeReturnTo });
      }
    };

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, [hasPlusAccess]);

  useEffect(() => {
    setSurveyReturnTo(safeReturnTo);
  }, [safeReturnTo]);

  const stepValid = useMemo(() => {
    const a = survey.answers;
    switch (survey.currentStep) {
      case 0:
        return Boolean(a.pace);
      case 1:
        return Boolean(a.vibe);
      case 2:
        return Boolean(a.budgetMode);
      case 3:
        return (a.interests?.length ?? 0) > 0;
      case 4:
        return Boolean(a.companionship);
      default:
        return false;
    }
  }, [survey.currentStep, survey.answers]);

  const handleNext = () => {
    if (!stepValid) {
      toast.message("請先選擇一個選項");
      return;
    }
    if (survey.currentStep < survey.totalSteps - 1) {
      survey.nextStep();
      return;
    }
    console.info("[SURVEY] finalStep");
    survey.showPreviewFromAnswers(survey.answers);
  };

  const handleBack = () => {
    if (survey.phase === "result") return;
    if (survey.canGoBack) {
      survey.prevStep();
      return;
    }
    if (survey.isBlockingExit) {
      toast.message("請先完成測驗，或持續回答後再離開");
      return;
    }
    void navigate({ to: safeReturnTo });
  };

  const handleFinish = async () => {
    console.info("[SURVEY_COMPLETE_BUTTON] clicked");
    if (survey.pendingSave) {
      try {
        await survey.commitSave(survey.answers);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "儲存失敗");
        return;
      }
    }
    survey.finishSession();
    void navigate({ to: "/profile", search: { quiz: "done" }, replace: true });
  };

  if (!hasPlusAccess) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="font-display text-lg">旅行偏好測驗為 Plus 專屬</p>
        <button
          type="button"
          className="rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground"
          onClick={() => void navigate({ to: "/profile" })}
        >
          返回個人頁
        </button>
      </div>
    );
  }

  if (survey.phase === "result" && survey.resultProfile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {survey.error ? (
          <p className="mx-5 mt-3 shrink-0 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {survey.error}
          </p>
        ) : null}
        <SurveyResultScreen
          result={survey.resultProfile}
          pendingSave={survey.pendingSave}
          saving={survey.loading}
          onFinish={() => void handleFinish()}
        />
      </div>
    );
  }

  const progress = ((survey.currentStep + 1) / survey.totalSteps) * 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pb-8 pt-3">
      <div className="flex items-center gap-2">
        <BackButton
          fallback={{ to: safeReturnTo }}
          preferFallback={survey.currentStep === 0}
          onBack={handleBack}
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl">旅行偏好測驗</h1>
          <p className="text-xs text-muted-foreground">
            第 {survey.currentStep + 1} / {survey.totalSteps} 題
          </p>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-clay transition-all" style={{ width: `${progress}%` }} />
      </div>

      {survey.error ? (
        <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{survey.error}</p>
      ) : null}

      {survey.currentStep === 0 ? (
        <StepPace
          value={survey.answers.pace}
          onChange={(v) => survey.setAnswer("pace", v)}
        />
      ) : null}
      {survey.currentStep === 1 ? (
        <StepVibe value={survey.answers.vibe} onChange={(v) => survey.setAnswer("vibe", v)} />
      ) : null}
      {survey.currentStep === 2 ? (
        <StepBudget
          value={survey.answers.budgetMode ?? "standard"}
          options={budgetOptions}
          onChange={(v) => survey.setAnswer("budgetMode", v)}
        />
      ) : null}
      {survey.currentStep === 3 ? (
        <StepInterests
          selected={survey.answers.interests ?? []}
          onToggle={(tag) => {
            const prev = survey.answers.interests ?? [];
            const next = prev.includes(tag)
              ? prev.filter((t) => t !== tag)
              : [...prev, tag].slice(0, 6);
            survey.setAnswer("interests", next);
          }}
        />
      ) : null}
      {survey.currentStep === 4 ? (
        <StepCompanionship
          value={survey.answers.companionship}
          onChange={(v) => {
            console.info("[SURVEY_COMPANION] value=", v === "flexible" ? "不一定" : v);
            survey.setAnswer("companionship", v);
          }}
        />
      ) : null}

      <button
        type="button"
        disabled={survey.loading || !stepValid}
        onClick={() => void handleNext()}
        className="mt-8 w-full rounded-full bg-primary py-3.5 text-sm text-primary-foreground disabled:opacity-50"
      >
        {survey.currentStep === survey.totalSteps - 1 ? "查看結果" : "下一題"}
      </button>
    </div>
  );
}

function StepPace({
  value,
  onChange,
}: {
  value?: "slow" | "medium" | "active";
  onChange: (v: "slow" | "medium" | "active") => void;
}) {
  return (
    <section className="mt-6 space-y-2">
      <p className="text-sm font-medium">你的旅行步調？</p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["slow", "慢步"],
            ["medium", "適中"],
            ["active", "緊湊"],
          ] as const
        ).map(([v, label]) => (
          <ChoiceChip key={v} active={value === v} onClick={() => onChange(v)} label={label} />
        ))}
      </div>
    </section>
  );
}

function StepVibe({
  value,
  onChange,
}: {
  value?: "quiet" | "either" | "lively";
  onChange: (v: "quiet" | "either" | "lively") => void;
}) {
  return (
    <section className="mt-6 space-y-2">
      <p className="text-sm font-medium">你偏好的氛圍？</p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["quiet", "安靜"],
            ["either", "都可以"],
            ["lively", "熱鬧"],
          ] as const
        ).map(([v, label]) => (
          <ChoiceChip key={v} active={value === v} onClick={() => onChange(v)} label={label} />
        ))}
      </div>
    </section>
  );
}

function StepBudget({
  value,
  options,
  onChange,
}: {
  value: BudgetMode;
  options: { value: BudgetMode; label: string; hint: string }[];
  onChange: (v: BudgetMode) => void;
}) {
  return (
    <section className="mt-6 space-y-2">
      <p className="text-sm font-medium">預算取向</p>
      <div className="grid gap-2">
        {options.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => onChange(b.value)}
            className={`rounded-2xl border px-4 py-3 text-left ${value === b.value ? "border-foreground bg-secondary" : "border-border"}`}
          >
            <p className="text-sm font-medium">{b.label}</p>
            <p className="text-xs text-muted-foreground">{b.hint}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function StepInterests({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  return (
    <section className="mt-6 space-y-2">
      <p className="text-sm font-medium">興趣偏好（可複選，至少 1 項）</p>
      <div className="flex flex-wrap gap-2">
        {INTEREST_OPTIONS.map((tag) => (
          <ChoiceChip
            key={tag}
            active={selected.includes(tag)}
            onClick={() => onToggle(tag)}
            label={tag}
          />
        ))}
      </div>
    </section>
  );
}

function StepCompanionship({
  value,
  onChange,
}: {
  value?: SurveyCompanionship;
  onChange: (v: SurveyCompanionship) => void;
}) {
  return (
    <section className="mt-6 space-y-2">
      <p className="text-sm font-medium">通常和誰一起旅行？</p>
      <div className="grid grid-cols-2 gap-2">
        {COMPANION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium ${value === opt.value ? "border-foreground bg-secondary" : "border-border"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ChoiceChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm ${active ? "bg-foreground text-background" : "bg-secondary"}`}
    >
      {label}
    </button>
  );
}
