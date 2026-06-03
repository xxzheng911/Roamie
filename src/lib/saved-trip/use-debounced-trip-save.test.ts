import { describe, expect, it, vi } from "vitest";
import { computeEditorPayloadFingerprint } from "@/lib/saved-trip/use-debounced-trip-save";
import type { RoamiePayloadV2 } from "@/lib/ai/types";

describe("useDebouncedTripSave fingerprint", () => {
  it("same logical payload yields identical fingerprint", () => {
    const a: RoamiePayloadV2 = {
      version: 2,
      title: "東京",
      summary: "",
      moodTag: "",
      recommendations: [],
      itinerary: [{ date: "2026-12-01", time: "10:00", title: "淺草", placeName: "淺草" }],
      tripSettings: { startTime: "10:00", transport: "walk", legMinutes: {}, legTransport: {} },
    };
    const b: RoamiePayloadV2 = { ...a, recommendations: [] };
    expect(computeEditorPayloadFingerprint(a)).toBe(computeEditorPayloadFingerprint(b));
  });
});
