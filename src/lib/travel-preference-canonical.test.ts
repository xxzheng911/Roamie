import { describe, expect, it } from "vitest";
import {
  canonicalTravelStyleFromResult,
  syncSurveyResultTravelStyle,
} from "@/lib/travel-preference-canonical";
import type { SurveyResultProfile } from "@/lib/travel-preference-survey-types";

const baseResult = (): SurveyResultProfile => ({
  personalityType: "巷弄漫遊者",
  personalitySummary: "summary",
  personalityImpression: "impression",
  travelStyle: "悠閒生活家",
  preferenceTypes: [],
  recommendedStyle: "",
  suitableDirections: [],
  aiRecommendationSummary: "",
  travelTags: [],
});

describe("travel-preference-canonical", () => {
  it("syncSurveyResultTravelStyle unifies personalityType and travelStyle", () => {
    const synced = syncSurveyResultTravelStyle(baseResult());
    expect(synced.travelStyle).toBe("巷弄漫遊者");
    expect(synced.personalityType).toBe("巷弄漫遊者");
  });

  it("canonicalTravelStyleFromResult prefers personalityType over stale travelStyle", () => {
    expect(canonicalTravelStyleFromResult(baseResult())).toBe("巷弄漫遊者");
    expect(canonicalTravelStyleFromResult(syncSurveyResultTravelStyle(baseResult()))).toBe(
      "巷弄漫遊者",
    );
  });
});
