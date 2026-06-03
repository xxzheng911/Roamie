import { describe, expect, it, vi } from "vitest";
import {
  enrichPlaceDetailWithAiContent,
  resolvePlaceDetailRecommendationText,
} from "./place-detail-ai-content";
import { PLACE_INTRO_GENERIC_FALLBACK } from "./place-intro-constants";
import type { PlaceDetailViewModel } from "@/lib/place-detail-resolve";

function stubPlace(name: string, reason = ""): PlaceDetailViewModel {
  return {
    id: "test-id",
    name,
    address: "東京都台東區",
    lat: 35.7,
    lng: 139.7,
    rating: 4.5,
    userRatingCount: 1000,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: null,
    openStatus: "open",
    openStatusLabel: "營業中",
    todayHoursLabel: "24 小時",
    closingSoonNote: "",
    nextOpenHint: "",
    reason,
  };
}

describe("enrichPlaceDetailWithAiContent", () => {
  it("replaces generic handoff reason with ai_generated content", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const enriched = enrichPlaceDetailWithAiContent(
      stubPlace("淺草寺 雷門", PLACE_INTRO_GENERIC_FALLBACK),
      { locale: "zh-TW", itineraryContext: { destination: "東京", travelMonth: 12 } },
    );
    expect(enriched.recommendationReason).not.toBe(PLACE_INTRO_GENERIC_FALLBACK);
    expect(enriched.recommendationReason).toMatch(/淺草|雷門|仲見世/);
    expect(enriched.aiIntro).toBeUndefined();
    expect(enriched.highlights).toBeUndefined();
    expect(enriched.reasonSource).toBe("ai_generated");
    expect(
      info.mock.calls.some((c) => c[0] === "[PLACE_DETAIL_REASON_SOURCE]"),
    ).toBe(true);
    expect(
      info.mock.calls.some((c) => c[0] === "[PLACE_DETAIL_REASON_RENDERED]"),
    ).toBe(true);
    info.mockRestore();
  });

  it("resolvePlaceDetailRecommendationText prefers recommendationReason", () => {
    const text = resolvePlaceDetailRecommendationText({
      reason: PLACE_INTRO_GENERIC_FALLBACK,
      recommendationReason: "雷門是淺草地標，適合與淺草寺一起逛。",
      aiIntro: "雷門是淺草地標…",
    });
    expect(text).toMatch(/雷門/);
    expect(text).not.toBe(PLACE_INTRO_GENERIC_FALLBACK);
  });
});
