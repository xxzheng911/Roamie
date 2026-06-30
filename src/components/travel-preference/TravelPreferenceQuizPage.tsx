import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { RoamieMascotFigure } from "@/components/onboarding/RoamieMascotFigure";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { useI18n } from "@/hooks/use-i18n";
import { QUIZ_STEP_POSE, type QuizStepKey } from "@/lib/mascot-assets";
import { getPlanBudgetOptions } from "@/lib/i18n/plan-form-options";
import { derivePersonality } from "@/lib/personality";
import {
  ensureIosLoginLiveInteraction,
  scheduleIosSnapshotRefreshBurst,
} from "@/lib/ios-snapshot-bridge";
import {
  logTravelQuizSaveError,
  saveTravelQuizResultLocally,
  syncTravelQuizResultInBackground,
} from "@/lib/travel-quiz-save";
import { readProfileSessionCache, writeProfileSessionCache } from "@/lib/profile-session-cache";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { buildUserProfileFromTravelPrefCache, buildTravelPrefResultSnapshot } from "@/lib/travel-pref-result-cache";
import { detectDeviceLocale } from "@/lib/i18n/detect-locale";
import type { BudgetMode, TravelPreferences } from "@/lib/preferences-storage";

const SAVE_TIMEOUT_MS = 8000;

function navigateAfterQuiz(
  navigate: ReturnType<typeof useNavigate>,
  origin: TravelPreferenceQuizOrigin,
  moodToast: () => void,
) {
  if (origin === "profile") {
    void navigate({ to: "/profile", search: { quiz: "done" }, replace: true });
    return;
  }
  if (origin === "chat") {
    moodToast();
    void navigate({ to: "/chat", replace: true });
    return;
  }
  moodToast();
  void navigate({ to: "/", replace: true });
}

export type TravelPreferenceQuizOrigin = "home" | "profile" | "chat";

type Props = {
  origin?: TravelPreferenceQuizOrigin;
};

type QuizDraft = {
  pace?: TravelPreferences["pace"];
  avoid?: string[];
  vibe?: TravelPreferences["vibe"];
  budgetMode?: BudgetMode;
};

const STEPS: QuizStepKey[] = ["pace", "avoid", "vibe", "budget"];

const STEP_LABELS: Record<QuizStepKey, string> = {
  pace: "旅行步調",
  avoid: "想避開的項目",
  vibe: "偏好氛圍",
  budget: "預算取向",
};

function describeMissingQuizFields(draft: QuizDraft): string[] {
  const missing: string[] = [];
  if (!draft.pace) missing.push(STEP_LABELS.pace);
  if (!draft.avoid?.length) missing.push(STEP_LABELS.avoid);
  if (!draft.vibe) missing.push(STEP_LABELS.vibe);
  if (!draft.budgetMode) missing.push(STEP_LABELS.budget);
  return missing;
}

function buildPreferencePayload(
  draft: QuizDraft,
): { prefs: TravelPreferences; personality: ReturnType<typeof derivePersonality> } {
  const prefs: TravelPreferences = {
    pace: draft.pace,
    avoid: draft.avoid,
    vibe: draft.vibe,
    budgetMode: draft.budgetMode,
    onboarded: true,
  };
  const personality = derivePersonality(prefs);
  return {
    prefs: {
      ...prefs,
      personalityType: personality.type,
      personalitySummary: personality.summary,
    },
    personality,
  };
}

function logFinishQuizError(error: unknown): void {
  logTravelQuizSaveError(error);
  const err = error instanceof Error ? error : null;
  console.error("[TRAVEL_PREF_TEST] finishQuiz error", {
    message: err?.message ?? (typeof error === "string" ? error : undefined),
    stack: err?.stack,
    name: err?.name,
    raw: String(error),
  });
}

export function TravelPreferenceQuizPage({ origin = "profile" }: Props) {
  useIosInteractiveRoute("travel-preference-test");
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<QuizDraft>({});
  const [finishing, setFinishing] = useState(false);

  useLayoutEffect(() => {
    document.documentElement.classList.add("travel-pref-quiz-active");
    return () => {
      document.documentElement.classList.remove("travel-pref-quiz-active");
    };
  }, []);

  useEffect(() => {
    ensureIosLoginLiveInteraction();
    scheduleIosSnapshotRefreshBurst("travel-preference-test");
  }, []);

  const step = STEPS[stepIndex] ?? "pace";
  const isLastStep = stepIndex >= STEPS.length - 1;
  const budgetOptions = useMemo(() => getPlanBudgetOptions(locale), [locale]);

  const paceOptions = [
    { id: "slow" as const, label: t("profile.paceSlow"), hint: "慢慢走、留空白" },
    { id: "medium" as const, label: t("profile.paceMedium"), hint: "不趕也不拖" },
    { id: "active" as const, label: t("profile.paceActive"), hint: "多看看、多走走" },
  ];

  const vibeOptions = [
    { id: "quiet" as const, label: t("profile.vibeQuiet"), hint: "安靜、好待" },
    { id: "either" as const, label: t("profile.vibeEither"), hint: "都可以" },
    { id: "lively" as const, label: t("profile.vibeLively"), hint: "有生活感" },
  ];

  const avoidOptions = [
    { id: "crowds", label: t("profile.avoid.crowds") },
    { id: "packed", label: t("profile.avoid.packed") },
    { id: "overload", label: t("profile.avoid.overload") },
  ];

  const canContinue =
    step === "pace"
      ? Boolean(draft.pace)
      : step === "avoid"
        ? Boolean(draft.avoid?.length)
        : step === "vibe"
          ? Boolean(draft.vibe)
          : Boolean(draft.budgetMode);

  const stepTitle =
    step === "pace"
      ? "你的旅行步調？"
      : step === "avoid"
        ? "想避開什麼？"
        : step === "vibe"
          ? "偏好的氛圍？"
          : "預算取向？";

  const stepBody =
    step === "pace"
      ? "Roamie 會依你的節奏安排推薦與行程留白。"
      : step === "avoid"
        ? "選一項最想避開的，之後推薦會幫你過濾。"
        : step === "vibe"
          ? "安靜角落或熱鬧街區，告訴我你現在的偏好。"
          : "不是要你省錢，而是幫你找到剛剛好的體驗。";

  const handleBack = () => {
    if (finishing) return;
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      return;
    }
    if (origin === "chat") {
      void navigate({ to: "/chat" });
      return;
    }
    if (origin === "home") {
      void navigate({ to: "/" });
      return;
    }
    void navigate({ to: "/profile" });
  };

  const finishQuiz = () => {
    console.info("[TRAVEL_PREF_TEST] finishQuiz start", { draft, finishing });

    const missing = describeMissingQuizFields(draft);
    if (missing.length) {
      toast.message(`請完成測驗：${missing.join("、")}`);
      return;
    }
    if (finishing) {
      console.info("[TRAVEL_PREF_TEST] finishQuiz ignored: already finishing");
      return;
    }

    console.info("[TRAVEL_PREF_TEST] validation ok");
    setFinishing(true);

    let savedPrefs: TravelPreferences | null = null;
    let travelStyle: string | null = null;

    try {
      const { prefs: preferencePayload, personality } = buildPreferencePayload(draft);

      console.info("[TRAVEL_PREF_TEST] save start");

      savedPrefs = saveTravelQuizResultLocally({
        prefs: preferencePayload,
        resultName: personality.type,
        answers: draft,
      });
      travelStyle = personality.type;

      const cachedUserId = readCachedAuthenticatedUserIdSync();
      if (cachedUserId) {
        const travelPrefProfile = buildUserProfileFromTravelPrefCache(
          buildTravelPrefResultSnapshot(savedPrefs, {
            travelStyle: personality.type,
            userId: cachedUserId,
          }),
          detectDeviceLocale(),
        );
        const existingProfile = readProfileSessionCache(cachedUserId);
        writeProfileSessionCache(
          existingProfile
            ? {
                ...existingProfile,
                ...travelPrefProfile,
                displayName: existingProfile.displayName,
                avatarUrl: existingProfile.avatarUrl,
                coverImageUrl: existingProfile.coverImageUrl,
                bio: existingProfile.bio,
              }
            : travelPrefProfile,
          cachedUserId,
        );
      }

      console.info("[TRAVEL_PREF_TEST] navigate back");
      navigateAfterQuiz(navigate, origin, () => toast.success(t("profile.quizDone")));
    } catch (error) {
      logFinishQuizError(error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "儲存失敗，請稍後再試";
      toast.error(message);
      return;
    } finally {
      setFinishing(false);
    }

    if (savedPrefs && travelStyle) {
      syncTravelQuizResultInBackground(
        { prefs: savedPrefs, resultName: travelStyle },
        { timeoutMs: SAVE_TIMEOUT_MS },
      );
    }
  };

  const handlePrimaryPress = () => {
    console.info("[TRAVEL_PREF_TEST] submit press", {
      step,
      stepIndex,
      isLastStep,
      canContinue,
      finishing,
      draft,
    });

    if (finishing) return;

    if (!canContinue) {
      toast.message(describeMissingStepField(step));
      return;
    }

    if (!isLastStep) {
      setStepIndex((prev) => prev + 1);
      return;
    }

    const missing = describeMissingQuizFields(draft);
    if (missing.length) {
      toast.message(`請完成測驗：${missing.join("、")}`);
      return;
    }

    finishQuiz();
  };

  return (
    <MobileFrame>
      <div className="travel-pref-quiz-page flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="travel-pref-quiz-chrome relative z-30 flex shrink-0 items-center gap-3 px-5 pb-2 pt-[max(0.75rem,var(--safe-area-top))]">
          <button
            type="button"
            onClick={handleBack}
            disabled={finishing}
            className="touch-manipulation flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary"
            aria-label={t("profile.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Plus 旅行偏好</p>
            <p className="truncate text-sm font-medium">
              {stepIndex + 1} / {STEPS.length}
            </p>
          </div>
        </header>

        <div className="travel-pref-quiz-scroll relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-8 pb-6">
          <div className="pointer-events-none flex justify-center">
            <div className="quiz-mascot relative">
              <RoamieMascotFigure pose={QUIZ_STEP_POSE[step]} variant="quiz" motion="float" />
            </div>
          </div>

          <div className="flex justify-center gap-1.5 pb-4 pt-1">
            {STEPS.map((key, i) => (
              <span
                key={key}
                className={`h-1 w-8 rounded-full transition ${i <= stepIndex ? "bg-foreground" : "bg-border"}`}
              />
            ))}
          </div>
          <h1 className="font-display text-[24px] leading-snug">{stepTitle}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{stepBody}</p>

          <div className="mt-6 space-y-2.5 pb-4">
            {step === "pace"
              ? paceOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, pace: opt.id }))}
                    className={`touch-manipulation w-full rounded-2xl border px-4 py-3.5 text-left transition ${
                      draft.pace === opt.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card"
                    }`}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="mt-0.5 text-xs opacity-80">{opt.hint}</p>
                  </button>
                ))
              : null}

            {step === "avoid"
              ? avoidOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, avoid: [opt.id] }))}
                    className={`touch-manipulation w-full rounded-2xl border px-4 py-3.5 text-left text-sm font-medium transition ${
                      draft.avoid?.[0] === opt.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))
              : null}

            {step === "vibe"
              ? vibeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, vibe: opt.id }))}
                    className={`touch-manipulation w-full rounded-2xl border px-4 py-3.5 text-left transition ${
                      draft.vibe === opt.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card"
                    }`}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="mt-0.5 text-xs opacity-80">{opt.hint}</p>
                  </button>
                ))
              : null}

            {step === "budget" ? (
              <div className="grid grid-cols-2 gap-2">
                {budgetOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, budgetMode: opt.value }))}
                    className={`touch-manipulation flex min-h-[4.5rem] flex-col items-center justify-center rounded-2xl border px-2 py-3 text-center transition ${
                      draft.budgetMode === opt.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card"
                    }`}
                  >
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="mt-1 text-[10px] opacity-80">{opt.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="travel-pref-quiz-footer travel-pref-quiz-chrome relative z-50 shrink-0 border-t border-border/70 bg-background px-8 pb-[max(1.5rem,var(--safe-area-bottom))] pt-3">
          <button
            type="button"
            onClick={handlePrimaryPress}
            className={`relative z-50 flex w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-primary py-4 text-[15px] font-medium text-primary-foreground ${
              !canContinue || finishing ? "opacity-50" : "active:scale-[0.99]"
            }`}
          >
            {finishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                儲存中…
              </>
            ) : isLastStep ? (
              "完成測驗"
            ) : (
              <>
                繼續
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </MobileFrame>
  );
}
