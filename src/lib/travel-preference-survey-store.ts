import {
  SURVEY_TOTAL_STEPS,
  type SurveyAnswers,
  type SurveyResultProfile,
  type TravelPreferenceSurveyPhase,
  type TravelPreferenceSurveyState,
} from "@/lib/travel-preference-survey-types";

const SESSION_KEY = "roamie:travel-preference-survey";

type Persisted = Pick<
  TravelPreferenceSurveyState,
  | "currentStep"
  | "answers"
  | "isCompleted"
  | "completedAt"
  | "resultProfile"
  | "pendingSave"
  | "phase"
  | "returnTo"
  | "sessionActive"
>;

const initialState = (): TravelPreferenceSurveyState => ({
  currentStep: 0,
  totalSteps: SURVEY_TOTAL_STEPS,
  answers: {},
  isCompleted: false,
  completedAt: null,
  resultProfile: null,
  pendingSave: false,
  loading: false,
  error: null,
  phase: "quiz",
  returnTo: "/profile",
  sessionActive: false,
});

let state: TravelPreferenceSurveyState = initialState();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persistSession() {
  if (typeof window === "undefined") return;
  const payload: Persisted = {
    currentStep: state.currentStep,
    answers: state.answers,
    isCompleted: state.isCompleted,
    completedAt: state.completedAt,
    resultProfile: state.resultProfile,
    phase: state.phase,
    returnTo: state.returnTo,
    sessionActive: state.sessionActive,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

function restoreSession(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed.sessionActive) return;
    state = {
      ...initialState(),
      ...parsed,
      totalSteps: SURVEY_TOTAL_STEPS,
      loading: false,
      error: null,
    };
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

restoreSession();

export function getTravelPreferenceSurveyState(): TravelPreferenceSurveyState {
  return state;
}

export function subscribeTravelPreferenceSurvey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function patch(partial: Partial<TravelPreferenceSurveyState>) {
  state = { ...state, ...partial };
  if (state.sessionActive) persistSession();
  emit();
}

export function startTravelPreferenceSurvey(options?: { returnTo?: string; retake?: boolean }) {
  console.info("[SURVEY] start", { retake: Boolean(options?.retake) });
  const keepResult = options?.retake ? state.resultProfile : null;
  state = {
    ...initialState(),
    returnTo: options?.returnTo ?? "/profile",
    sessionActive: true,
    phase: "quiz",
    /** 重新測驗：保留已儲存結果直到新測驗成功覆寫 */
    isCompleted: options?.retake ? Boolean(keepResult) : false,
    resultProfile: options?.retake ? keepResult : null,
  };
  if (options?.retake) {
    console.info("[SURVEY] retry=true");
  }
  persistSession();
  emit();
}

export function setSurveyReturnTo(returnTo: string) {
  if (state.returnTo === returnTo) return;
  patch({ returnTo });
}

export function setSurveyAnswer<K extends keyof SurveyAnswers>(key: K, value: SurveyAnswers[K]) {
  const answers = { ...state.answers, [key]: value };
  patch({ answers });
  console.info("[SURVEY] answerSaved=", key);
}

export function nextSurveyStep() {
  const next = Math.min(state.currentStep + 1, state.totalSteps - 1);
  console.info("[SURVEY] nextStep=", next + 1);
  patch({ currentStep: next, error: null });
}

export function prevSurveyStep() {
  const prev = Math.max(state.currentStep - 1, 0);
  console.info("[SURVEY] nextStep=", prev + 1);
  patch({ currentStep: prev, error: null });
}

export function canSurveyGoBack(): boolean {
  return state.currentStep > 0;
}

export function isSurveySessionBlockingExit(): boolean {
  if (!state.sessionActive) return false;
  if (state.phase === "quiz") return true;
  return state.phase === "result" && state.pendingSave;
}

/** 最後一題後：僅預覽結果，不寫入 profiles */
export function showSurveyPreview(result: SurveyResultProfile) {
  console.info("[SURVEY] resultPreviewShown");
  patch({
    resultProfile: result,
    phase: "result",
    pendingSave: true,
    isCompleted: false,
    completedAt: null,
    error: null,
  });
}

/** 儲存成功後更新 session（即將離開測驗頁） */
export function showSurveyResult(result: SurveyResultProfile) {
  const completedAt = new Date().toISOString();
  patch({
    isCompleted: true,
    completedAt,
    resultProfile: result,
    phase: "result",
    pendingSave: false,
    error: null,
  });
}

export function setSurveyLoading(loading: boolean) {
  patch({ loading });
}

export function setSurveyError(error: string | null) {
  patch({ error, loading: false });
}

export function finishSurveySession() {
  if (typeof window !== "undefined") sessionStorage.removeItem(SESSION_KEY);
  state = initialState();
  emit();
}

/** 已完成的測驗：僅檢視結果，不重新答題 */
export function openSurveyResultView(result: SurveyResultProfile, returnTo: string) {
  state = {
    ...initialState(),
    isCompleted: true,
    completedAt: null,
    resultProfile: result,
    pendingSave: false,
    phase: "result",
    returnTo,
    sessionActive: true,
  };
  persistSession();
  emit();
}
