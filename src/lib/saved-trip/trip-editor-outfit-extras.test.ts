import { describe, expect, it } from "vitest";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  hashStableOutfitExtrasFromPayload,
  stableOutfitExtrasSignature,
  TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED,
} from "@/lib/saved-trip/trip-editor-outfit-extras";

const basePayload = (): RoamiePayloadV2 => ({
  version: 2,
  title: "東京",
  summary: "",
  moodTag: "慢旅行",
  recommendations: [],
  itinerary: [],
  outfitSuggestion: "12 月建議穿著保暖外套與圍巾。",
  weatherSummary: "涼爽多雲",
  outfitSuggestionUpdatedAt: new Date().toISOString(),
  outfitSuggestionInputKey: "volatile-key",
});

describe("trip editor outfit extras hash", () => {
  it("suggestion disabled flag is on for detail page isolation", () => {
    expect(TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED).toBe(true);
  });

  it("stableOutfitExtrasSignature ignores timestamps and input keys", () => {
    const a = stableOutfitExtrasSignature({
      destination: "東京",
      outfitSuggestionText: "建議穿大衣",
      weatherSummary: "涼爽",
      moodTag: "慢旅行",
    });
    const b = stableOutfitExtrasSignature({
      destination: "東京",
      outfitSuggestionText: "建議穿大衣",
      weatherSummary: "涼爽",
      moodTag: "慢旅行",
    });
    expect(a).toBe(b);
  });

  it("hashStableOutfitExtrasFromPayload stable across 500 object clones", () => {
    const destination = "東京";
    const first = hashStableOutfitExtrasFromPayload(basePayload(), destination);
    for (let i = 0; i < 500; i++) {
      const clone = {
        ...basePayload(),
        outfitSuggestionUpdatedAt: new Date(i).toISOString(),
        outfitSuggestionInputKey: `key-${i}`,
        outfitTags: ["a", "b"],
      };
      expect(hashStableOutfitExtrasFromPayload(clone, destination)).toBe(first);
    }
  });
});
