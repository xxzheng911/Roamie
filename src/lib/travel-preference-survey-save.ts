import { supabase } from "@/integrations/supabase/client";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { broadcastPreferencesUpdate } from "@/lib/preference-events";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { ProfileExtras } from "@/lib/profile-storage";
import { resolveBudgetMode, setCachedTravelProfileFields } from "@/lib/preferences-storage";
import { buildTravelProfileFields } from "@/lib/travel-profile-for-ai";
import {
  buildSurveyResultProfile,
  surveyAnswersToTravelPreferences,
} from "@/lib/travel-preference-survey-result";
import type { SurveyAnswers, SurveyResultProfile } from "@/lib/travel-preference-survey-types";

const LOCAL_SURVEY_KEY_PREFIX = "roamie:survey-prefs:";

export type TravelPreferenceSurveySnapshot = {
  prefs: TravelPreferences;
  resultProfile: SurveyResultProfile;
  surveyCompleted: boolean;
  surveyCompletedAt: string | null;
  travelStyle: string;
  travelPreferences: string[];
  travelTags: string[];
};

function localKey(userId: string): string {
  return `${LOCAL_SURVEY_KEY_PREFIX}${userId}`;
}

export function readLocalTravelPreferenceSurvey(
  userId: string,
): TravelPreferenceSurveySnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as TravelPreferenceSurveySnapshot;
  } catch {
    return null;
  }
}

export function writeLocalTravelPreferenceSurvey(
  userId: string,
  snapshot: TravelPreferenceSurveySnapshot,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(localKey(userId), JSON.stringify(snapshot));
}

export function clearLocalTravelPreferenceSurvey(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(localKey(userId));
}

function buildAiPreferencesExtras(
  prefs: TravelPreferences,
  result: SurveyResultProfile,
): ProfileExtras {
  return {
    travelStyle: result.travelStyle,
    travelPreferences: prefs.interests ?? [],
    travelPersonality: {
      type: result.personalityType,
      summary: result.personalitySummary,
      impression: result.personalityImpression,
    },
    travelTags: result.travelTags,
    surveyCompleted: true,
    surveyCompletedAt: prefs.surveyCompletedAt ?? new Date().toISOString(),
    companionshipPreference: prefs.companionship ?? "",
    pacePreference: prefs.pace ?? "",
    vibePreference: prefs.vibe ?? "",
    budgetPreference: resolveBudgetMode(prefs),
    personalityType: result.personalityType,
    personalitySummary: result.aiRecommendationSummary,
    updatedAt: new Date().toISOString(),
  };
}

function snapshotFromPrefs(
  prefs: TravelPreferences,
  result: SurveyResultProfile,
): TravelPreferenceSurveySnapshot {
  return {
    prefs,
    resultProfile: result,
    surveyCompleted: Boolean(prefs.surveyCompleted),
    surveyCompletedAt: prefs.surveyCompletedAt ?? null,
    travelStyle: result.travelStyle,
    travelPreferences: prefs.interests ?? [],
    travelTags: result.travelTags,
  };
}

export type SaveTravelPreferenceResultOutcome = {
  prefs: TravelPreferences;
  result: SurveyResultProfile;
  localSaved: boolean;
  supabaseSaved: boolean;
};

/**
 * 測驗完成後唯一儲存入口：local → Supabase（失敗則拋錯，不假裝成功）
 */
export async function saveTravelPreferenceResult(
  userId: string,
  answers: SurveyAnswers,
): Promise<SaveTravelPreferenceResultOutcome> {
  console.info("[SURVEY_SAVE] start userId=", userId);

  const result = buildSurveyResultProfile(answers);
  console.info("[SURVEY_RESULT] generated=", result.personalityType);

  const prefs = surveyAnswersToTravelPreferences(answers, result);
  const snapshot = snapshotFromPrefs(prefs, result);

  writeLocalTravelPreferenceSurvey(userId, snapshot);
  console.info("[SURVEY_SAVE] localSaved=true");

  await ensureUserProfile(userId);

  const aiExtras = buildAiPreferencesExtras(prefs, result);
  const completedAt = prefs.surveyCompletedAt ?? new Date().toISOString();

  const personalityPayload = {
    type: result.personalityType,
    summary: result.personalitySummary,
    impression: result.personalityImpression,
  };

  const patch = {
    travel_personality: {
      ...prefs,
      personality: personalityPayload,
      updated_at: completedAt,
    } as never,
    travel_style: result.travelStyle,
    travel_preferences: (prefs.interests ?? []) as never,
    travel_tags: result.travelTags as never,
    survey_completed: true,
    survey_completed_at: completedAt,
    ai_preferences: aiExtras as never,
  };

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id, survey_completed, survey_completed_at, travel_style")
    .maybeSingle();

  let supabaseSaved = false;

  if (updateError) {
    console.error("[SURVEY_SAVE] error=", updateError.message);
    throw new Error(updateError.message);
  }

  if (updated?.id) {
    supabaseSaved = true;
  } else {
    const { error: insertError } = await supabase.from("profiles").upsert(
      { id: userId, ...patch },
      { onConflict: "id" },
    );
    if (insertError) {
      console.error("[SURVEY_SAVE] error=", insertError.message);
      throw new Error(insertError.message);
    }
    supabaseSaved = true;
  }

  const { data: verify, error: verifyError } = await supabase
    .from("profiles")
    .select(
      "survey_completed, survey_completed_at, travel_style, travel_preferences, travel_tags, travel_personality, ai_preferences",
    )
    .eq("id", userId)
    .maybeSingle();

  if (verifyError) {
    console.error("[SURVEY_SAVE] error=", verifyError.message);
    throw new Error(verifyError.message);
  }
  if (!verify?.survey_completed) {
    const msg = "survey_completed 未成功寫入 profiles";
    console.error("[SURVEY_SAVE] error=", msg);
    throw new Error(msg);
  }
  console.info("[SURVEY_SAVE] supabaseSaved=true", {
    survey_completed_at: verify.survey_completed_at,
    travel_style: verify.travel_style,
  });
  console.info("[SURVEY_SAVE] success");
  broadcastPreferencesUpdate(prefs);
  setCachedTravelProfileFields(
    buildTravelProfileFields(
      {
        travel_personality: patch.travel_personality,
        travel_style: verify.travel_style,
        travel_preferences: prefs.interests,
        travel_tags: verify.travel_tags,
        survey_completed: verify.survey_completed,
        survey_completed_at: verify.survey_completed_at,
        ai_preferences: aiExtras,
      },
      prefs,
    ),
  );

  return { prefs, result, localSaved: true, supabaseSaved };
}

export type ProfileSurveyRow = {
  travel_personality: unknown;
  travel_style: string | null;
  travel_preferences: unknown;
  travel_tags: unknown;
  survey_completed: boolean | null;
  survey_completed_at: string | null;
  ai_preferences: unknown;
};

export function mergeTravelPreferencesFromProfileRow(
  userId: string,
  row: ProfileSurveyRow | null,
): TravelPreferences {
  const local = readLocalTravelPreferenceSurvey(userId);
  const remotePersonality = (row?.travel_personality ?? {}) as TravelPreferences;
  const remoteCompleted = Boolean(row?.survey_completed);
  const localCompleted = Boolean(local?.surveyCompleted);

  const resultFromRemote = remotePersonality.resultProfile;
  const resultFromLocal = local?.resultProfile;
  const resultProfile = resultFromRemote ?? resultFromLocal;

  const extras = (row?.ai_preferences ?? {}) as {
    pacePreference?: string;
    vibePreference?: string;
    budgetPreference?: string;
  };

  const merged: TravelPreferences = {
    ...(local?.prefs ?? {}),
    ...remotePersonality,
    pace:
      remotePersonality.pace ??
      local?.prefs.pace ??
      (extras.pacePreference === "slow" ||
      extras.pacePreference === "medium" ||
      extras.pacePreference === "active"
        ? extras.pacePreference
        : undefined),
    vibe:
      remotePersonality.vibe ??
      local?.prefs.vibe ??
      (extras.vibePreference === "quiet" ||
      extras.vibePreference === "either" ||
      extras.vibePreference === "lively"
        ? extras.vibePreference
        : undefined),
    surveyCompleted: remoteCompleted || localCompleted,
    surveyCompletedAt:
      row?.survey_completed_at ??
      remotePersonality.surveyCompletedAt ??
      local?.surveyCompletedAt ??
      undefined,
    onboarded: remoteCompleted || localCompleted || remotePersonality.onboarded,
    personalityType:
      remotePersonality.personalityType ??
      local?.prefs.personalityType ??
      (typeof row?.travel_style === "string" ? row.travel_style : undefined),
    personalitySummary:
      remotePersonality.personalitySummary ?? local?.prefs.personalitySummary,
    interests:
      (Array.isArray(row?.travel_preferences)
        ? (row.travel_preferences as string[])
        : undefined) ??
      remotePersonality.interests ??
      local?.prefs.interests,
    resultProfile: resultProfile ?? undefined,
  };

  if (remoteCompleted && local && !localCompleted) {
    console.warn("[PROFILE_SURVEY] remote completed; local stale");
  }
  if (!remoteCompleted && localCompleted) {
    console.warn("[PROFILE_SURVEY] local completed but remote missing — using local cache");
  }

  return merged;
}

export async function loadTravelPreferenceSurveyForUser(
  userId: string,
): Promise<TravelPreferenceSurveySnapshot | null> {
  console.info("[PROFILE_SURVEY] loading");

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "travel_personality, travel_style, travel_preferences, travel_tags, survey_completed, survey_completed_at, ai_preferences",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[PROFILE_SURVEY] error=", error.message);
    throw new Error(error.message);
  }

  const prefs = mergeTravelPreferencesFromProfileRow(userId, data as ProfileSurveyRow | null);
  const completed = Boolean(data?.survey_completed ?? prefs.surveyCompleted);
  const result =
    prefs.resultProfile ??
    (completed
      ? buildSurveyResultProfile({
          pace: prefs.pace,
          vibe: prefs.vibe,
          budgetMode: prefs.budgetMode,
          interests: prefs.interests,
          companionship: prefs.companionship,
        })
      : null);

  console.info("[PROFILE_SURVEY] loaded survey_completed=", completed);
  console.info("[PROFILE_SURVEY] result=", result?.personalityType ?? "none");

  if (!completed || !result) return null;

  return {
    prefs: { ...prefs, surveyCompleted: true, onboarded: true, resultProfile: result },
    resultProfile: result,
    surveyCompleted: true,
    surveyCompletedAt: data?.survey_completed_at ?? prefs.surveyCompletedAt ?? null,
    travelStyle: data?.travel_style ?? result.travelStyle,
    travelPreferences: Array.isArray(data?.travel_preferences)
      ? (data.travel_preferences as string[])
      : (prefs.interests ?? []),
    travelTags: Array.isArray(data?.travel_tags)
      ? (data.travel_tags as string[])
      : result.travelTags,
  };
}
