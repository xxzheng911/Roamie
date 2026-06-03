import { describe, expect, it, vi } from "vitest";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
import {
  compareDailyOutfitSuggestions,
  resolveOutfitSuggestionDisplay,
} from "./compare-daily-outfit-suggestions";

function day(n: number, narrative: string, precip = 10): DailyOutfitAdvice {
  return {
    date: `2026-12-0${n}`,
    dayIndex: n,
    weather: {
      condition: "多雲",
      tempHighC: 12,
      tempLowC: 5,
      precipProbability: precip,
      diurnalRangeC: 7,
    },
    activityTypes: ["city"],
    outfitSummary: narrative.slice(0, 20),
    narrative,
    packingReminders: ["好走的鞋"],
  };
}

describe("compareDailyOutfitSuggestions", () => {
  it("groups when daily narratives are highly similar", () => {
    const text = "12 月東京早晚偏冷，建議厚外套、圍巾與好走的鞋。";
    const result = compareDailyOutfitSuggestions([
      day(1, text),
      day(2, text),
      day(3, text),
    ]);
    expect(result.shouldGroupTripLevel).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.8);
  });

  it("stays daily_specific when narratives differ", () => {
    const result = compareDailyOutfitSuggestions([
      day(1, "海邊行程建議防曬與沙灘鞋。"),
      day(2, "山區健行需要防風外套與手套。"),
      day(3, "市區逛街輕便穿搭即可。"),
    ]);
    expect(result.shouldGroupTripLevel).toBe(false);
  });
});

describe("resolveOutfitSuggestionDisplay", () => {
  it("logs OUTFIT_SUGGESTION_GROUPED", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const text = "相同建議文字重複每一天。";
    resolveOutfitSuggestionDisplay(
      [day(1, text), day(2, text)],
      [
        { dateKey: "2026-12-01", dayNumber: 1, items: [] },
        { dateKey: "2026-12-02", dayNumber: 2, items: [] },
      ],
      "東京",
    );
    expect(info.mock.calls.some((c) => c[0] === "[OUTFIT_SUGGESTION_GROUPED]")).toBe(true);
    info.mockRestore();
  });
});
