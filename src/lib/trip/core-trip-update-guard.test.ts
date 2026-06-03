import { describe, expect, it, beforeEach } from "vitest";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  evaluateCoreTripUpdate,
  resetCoreTripUpdateGuardForTests,
  seedCoreTripPersistedFingerprint,
} from "@/lib/trip/core-trip-update-guard";
import { tripPayloadsEqual } from "@/lib/trip/trip-payload-persist";

function samplePayload(overrides?: Partial<RoamiePayloadV2>): RoamiePayloadV2 {
  return {
    version: 2,
    title: "東京",
    summary: "s",
    moodTag: "慢",
    recommendations: [],
    itinerary: [{ date: "2025-12-01", time: "10:00", title: "A", description: "", placeName: "A", lat: null, lng: null }],
    generatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("core-trip-update-guard", () => {
  beforeEach(() => {
    resetCoreTripUpdateGuardForTests();
  });

  it("skips update when payload is unchanged aside from generatedAt", () => {
    const a = samplePayload();
    const b = samplePayload({ generatedAt: "2025-06-01T12:00:00Z" });
    expect(tripPayloadsEqual(a, b)).toBe(true);

    const decision = evaluateCoreTripUpdate({
      tripId: "trip-1",
      existingPayload: a,
      nextPayload: b,
    });
    expect(decision.shouldWrite).toBe(false);
    expect(decision.skipReason).toBe("unchanged");
  });

  it("skips duplicate fingerprint after seed", () => {
    const payload = samplePayload();
    seedCoreTripPersistedFingerprint("trip-2", payload, "慢");

    const decision = evaluateCoreTripUpdate({
      tripId: "trip-2",
      existingPayload: payload,
      nextPayload: samplePayload({ generatedAt: "other" }),
    });
    expect(decision.shouldWrite).toBe(false);
    expect(["unchanged", "duplicate_fingerprint"]).toContain(decision.skipReason);
  });
});
