import type { SurveyResultProfile } from "@/lib/travel-preference-survey-types";

/**
 * 測驗結果唯一欄位：travel_style（與 personalityType 同步）。
 * 以 personalityType（最新測驗產生）優先，避免舊的 travelStyle / DB travel_style 殘留。
 */
export function canonicalTravelStyleFromResult(
  result: Pick<SurveyResultProfile, "travelStyle" | "personalityType"> | null | undefined,
): string {
  if (!result) return "";
  return (result.personalityType || result.travelStyle || "").trim();
}

export function syncSurveyResultTravelStyle(
  result: SurveyResultProfile,
): SurveyResultProfile {
  const travel_style = canonicalTravelStyleFromResult(result);
  return {
    ...result,
    travelStyle: travel_style,
    personalityType: travel_style,
  };
}

export function travelPrefLogPayload(
  result: string,
  travel_style: string,
  source: string,
): { result: string; travel_style: string; source: string } {
  return { result, travel_style, source };
}
