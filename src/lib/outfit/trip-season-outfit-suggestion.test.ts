import { describe, expect, it } from "vitest";
import { buildSeasonTripOutfitSuggestion } from "@/lib/outfit/trip-season-outfit-suggestion";

describe("buildSeasonTripOutfitSuggestion", () => {
  it("returns Tokyo December copy with Fuji outdoor note", () => {
    const { outfitSuggestion } = buildSeasonTripOutfitSuggestion({
      destination: "東京",
      startDate: "2026-12-10",
      dayCount: 6,
      itinerary: [
        {
          date: "2026-12-12",
          time: "08:00",
          title: "富士山",
          placeName: "富士山（河口湖・五合目）",
        } as never,
      ],
    });
    expect(outfitSuggestion).toContain("12 月東京");
    expect(outfitSuggestion).toContain("洋蔥式");
    expect(outfitSuggestion).toContain("富士山");
  });
});
