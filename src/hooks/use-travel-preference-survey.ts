import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  canSurveyGoBack,
  finishSurveySession,
  getTravelPreferenceSurveyState,
  isSurveySessionBlockingExit,
  nextSurveyStep,
  prevSurveyStep,
  setSurveyAnswer,
  setSurveyError,
  setSurveyLoading,
  setSurveyReturnTo,
  showSurveyPreview,
  showSurveyResult,
  startTravelPreferenceSurvey,
  subscribeTravelPreferenceSurvey,
} from "@/lib/travel-preference-survey-store";
import { persistTravelPreferenceSurvey } from "@/lib/travel-preference-survey-persist";
import type { SurveyAnswers } from "@/lib/travel-preference-survey-types";
import { buildSurveyResultProfile } from "@/lib/travel-preference-survey-result";

export function useTravelPreferenceSurvey() {
  const state = useSyncExternalStore(
    subscribeTravelPreferenceSurvey,
    getTravelPreferenceSurveyState,
    getTravelPreferenceSurveyState,
  );

  const start = useCallback((options?: { returnTo?: string; retake?: boolean }) => {
    startTravelPreferenceSurvey(options);
  }, []);

  const showPreviewFromAnswers = useCallback((answers: SurveyAnswers) => {
    const result = buildSurveyResultProfile(answers);
    showSurveyPreview(result);
    return result;
  }, []);

  const commitSave = useCallback(async (answers: SurveyAnswers) => {
    setSurveyLoading(true);
    setSurveyError(null);
    try {
      const { result } = await persistTravelPreferenceSurvey(answers);
      showSurveyResult(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "儲存失敗";
      setSurveyError(msg);
      throw e;
    } finally {
      setSurveyLoading(false);
    }
  }, []);

  return useMemo(
    () => ({
      ...state,
      start,
      showPreviewFromAnswers,
      commitSave,
      nextStep: nextSurveyStep,
      prevStep: prevSurveyStep,
      setAnswer: setSurveyAnswer,
      setReturnTo: setSurveyReturnTo,
      finishSession: finishSurveySession,
      canGoBack: canSurveyGoBack(),
      isBlockingExit: isSurveySessionBlockingExit(),
    }),
    [state, start, showPreviewFromAnswers, commitSave],
  );
}
