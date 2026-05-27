import { getAuthenticatedUserId } from "@/lib/auth-session";
import {
  buildSurveyResultProfile,
  surveyAnswersToTravelPreferences,
} from "@/lib/travel-preference-survey-result";
import { saveTravelPreferenceResult } from "@/lib/travel-preference-survey-save";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { SurveyAnswers } from "@/lib/travel-preference-survey-types";

export async function persistTravelPreferenceSurvey(
  answers: SurveyAnswers,
): Promise<{ prefs: TravelPreferences; result: ReturnType<typeof buildSurveyResultProfile> }> {
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  const { prefs, result } = await saveTravelPreferenceResult(userId, answers);
  return { prefs, result };
}

export function readSurveyResultFromPrefs(
  prefs: TravelPreferences,
): ReturnType<typeof buildSurveyResultProfile> | null {
  if (prefs.resultProfile) return prefs.resultProfile;
  if (!prefs.surveyCompleted && !prefs.onboarded) return null;
  if (!prefs.personalityType) return null;
  return buildSurveyResultProfile({
    pace: prefs.pace,
    vibe: prefs.vibe,
    budgetMode: prefs.budgetMode,
    interests: prefs.interests,
    companionship: prefs.companionship,
  });
}
