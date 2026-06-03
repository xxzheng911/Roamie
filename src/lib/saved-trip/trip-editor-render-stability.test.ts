import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  buildEditorPayloadFingerprint,
  computeEditorPayloadFingerprint,
  TRIP_EDITOR_AUTO_SAVE_DISABLED,
} from "@/lib/saved-trip/trip-editor-stable-payload";
import { hashStableOutfitExtrasFromPayload } from "@/lib/saved-trip/trip-editor-outfit-extras";
import { logDebouncedSaveDepChanged } from "@/lib/trip/trip-detail-log";

const samplePayload = (): RoamiePayloadV2 => ({
  version: 2,
  title: "東京的小旅行",
  summary: "",
  moodTag: "慢旅行",
  recommendations: [],
  itinerary: [
    {
      date: "2026-12-01",
      time: "10:00",
      title: "淺草寺",
      placeName: "淺草寺",
      lat: 35.71,
      lng: 139.79,
    },
  ],
  tripSettings: {
    startTime: "10:00",
    transport: "walk",
    legMinutes: {},
    legTransport: {},
  },
});

describe("trip editor render stability", () => {
  it("auto save is disabled for isolation", () => {
    expect(TRIP_EDITOR_AUTO_SAVE_DISABLED).toBe(true);
  });

  it("fingerprint stable across new object references (100 renders)", () => {
    const base = samplePayload();
    const first = computeEditorPayloadFingerprint(base);
    for (let i = 0; i < 100; i++) {
      const clone: RoamiePayloadV2 = {
        ...base,
        itinerary: [...base.itinerary],
        tripSettings: { ...base.tripSettings! },
        recommendations: [],
      };
      expect(computeEditorPayloadFingerprint(clone)).toBe(first);
    }
  });

  it("buildEditorPayloadFingerprint stable when only refs change", () => {
    const base = samplePayload();
    const parts = {
      tripTitle: base.title,
      items: base.itinerary,
      settings: base.tripSettings!,
      outfitExtras: null as Record<string, unknown> | null,
      moodTag: base.moodTag,
    };
    const first = buildEditorPayloadFingerprint(parts);
    for (let i = 0; i < 50; i++) {
      expect(
        buildEditorPayloadFingerprint({
          ...parts,
          items: [...parts.items],
          settings: { ...parts.settings },
        }),
      ).toBe(first);
    }
  });

  it("outfitExtrasHash equivalent stable for 1000 simulated renders", () => {
    const payload = samplePayload();
    payload.outfitSuggestion = "保暖外套";
    payload.weatherSummary = "12°C 多雲";
    const destination = "東京";
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const clone = {
        ...payload,
        outfitSuggestionUpdatedAt: `2026-06-03T16:${i}:00Z`,
        outfitTags: i % 2 === 0 ? ["a"] : ["a"],
        weatherTempC: i % 2 === 0 ? 12 : 12,
      };
      hashes.add(hashStableOutfitExtrasFromPayload(clone, destination).slice(0, 24));
    }
    expect(hashes.size).toBe(1);
  });

  it("editor hash parts do not include volatile keys", () => {
    const a = buildEditorPayloadFingerprint({
      tripTitle: "東京",
      items: samplePayload().itinerary,
      settings: samplePayload().tripSettings!,
      outfitAdvice: undefined,
      outfitAdviceInputKey: "key-a",
      outfitExtras: { outfitSuggestionUpdatedAt: "2026-01-01T00:00:00Z" },
      moodTag: "慢旅行",
    });
    const b = buildEditorPayloadFingerprint({
      tripTitle: "東京",
      items: samplePayload().itinerary,
      settings: samplePayload().tripSettings!,
      outfitAdvice: undefined,
      outfitAdviceInputKey: "key-b",
      outfitExtras: { outfitSuggestionUpdatedAt: "2026-06-01T12:00:00Z" },
      moodTag: "慢旅行",
    });
    expect(a).toBe(b);
  });
});

describe("debounced save logging contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dep changed log has required fields", () => {
    logDebouncedSaveDepChanged({
      tripId: "trip-1",
      changedKeys: ["payloadFingerprint"],
      previousFingerprint: "prev",
      nextFingerprint: "next",
    });
    expect(console.info).toHaveBeenCalledWith(
      "[DEBOUNCED_SAVE_DEP_CHANGED]",
      expect.objectContaining({
        changedKeys: ["payloadFingerprint"],
        previousFingerprint: "prev",
        nextFingerprint: "next",
      }),
    );
  });
});
