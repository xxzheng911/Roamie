import type { TravelPreferences } from "@/lib/preferences-storage";
import type { ProfileSurveyRow } from "@/lib/travel-preference-survey-save";

export type TravelPersonalityFacet = {
  type?: string;
  summary?: string;
  impression?: string;
};

export type TravelProfileFields = {
  travelStyle: string;
  travelPreferences: string[];
  travelPersonality: TravelPersonalityFacet;
  travelTags: string[];
  surveyCompleted: boolean;
  surveyCompletedAt: string | null;
};

export function buildTravelProfileFields(
  row: ProfileSurveyRow | null,
  prefs: TravelPreferences,
): TravelProfileFields {
  const extras = (row?.ai_preferences ?? {}) as {
    travelPersonality?: TravelPersonalityFacet;
    travelStyle?: string;
    travelTags?: string[];
  };
  const snapshot = prefs.resultProfile;
  const travelPersonality: TravelPersonalityFacet = extras.travelPersonality ?? {
    type: snapshot?.personalityType ?? prefs.personalityType,
    summary: snapshot?.personalitySummary ?? prefs.personalitySummary,
    impression: snapshot?.personalityImpression,
  };

  return {
    travelStyle:
      row?.travel_style?.trim() ||
      extras.travelStyle ||
      snapshot?.travelStyle ||
      prefs.personalityType ||
      "",
    travelPreferences: Array.isArray(row?.travel_preferences)
      ? (row.travel_preferences as string[])
      : (prefs.interests ?? []),
    travelPersonality,
    travelTags: Array.isArray(row?.travel_tags)
      ? (row.travel_tags as string[])
      : snapshot?.travelTags ?? extras.travelTags ?? [],
    surveyCompleted: Boolean(row?.survey_completed ?? prefs.surveyCompleted),
    surveyCompletedAt: row?.survey_completed_at ?? prefs.surveyCompletedAt ?? null,
  };
}

/** Plus 才帶入測驗人格名稱；Free 僅基本自介 */
export function formatTravelProfileForAi(
  fields: TravelProfileFields,
  prefs?: TravelPreferences,
  options?: { includePersonalityType?: boolean },
): string {
  if (!fields.surveyCompleted) {
    return "（尚未完成旅行偏好測驗）";
  }
  const includePersonality = options?.includePersonalityType !== false;
  const parts: string[] = [];
  if (fields.travelStyle) parts.push(`旅行風格：${fields.travelStyle}`);
  if (includePersonality && fields.travelPersonality.type) {
    parts.push(`旅行人格：${fields.travelPersonality.type}`);
  }
  if (fields.travelPersonality.impression) {
    parts.push(`印象：${fields.travelPersonality.impression}`);
  }
  if (prefs?.pace) parts.push(`步調：${prefs.pace}`);
  if (prefs?.vibe) parts.push(`氛圍：${prefs.vibe}`);
  if (prefs?.companionship) {
    const companionLabel =
      prefs.companionship === "flexible" ? "不一定（彈性安排）" : prefs.companionship;
    parts.push(`同行：${companionLabel}`);
  }
  if (fields.travelPreferences.length) {
    parts.push(`偏好：${fields.travelPreferences.join("、")}`);
  }
  if (fields.travelTags.length) {
    parts.push(`標籤：${fields.travelTags.join("、")}`);
  }
  if (snapshotSummary(prefs)) parts.push(`摘要：${snapshotSummary(prefs)}`);
  console.info("[AI_CONTEXT] travelProfileApplied=true");
  return parts.join("；");
}

function snapshotSummary(prefs?: TravelPreferences): string | null {
  const s = prefs?.personalitySummary?.trim();
  return s || null;
}
