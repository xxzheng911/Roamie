import { beforeEach, describe, expect, it } from "vitest";
import {
  markLocationUpdateAccepted,
  resetLocationPublishGateForTests,
  shouldAcceptLocationUpdate,
} from "@/lib/location-publish-gate";

describe("location-publish-gate", () => {
  beforeEach(() => {
    resetLocationPublishGateForTests();
  });

  it("accepts first fix", () => {
    const d = shouldAcceptLocationUpdate(
      { lat: 25.033, lng: 121.565, usedFallback: false },
      12,
    );
    expect(d.accept).toBe(true);
  });

  it("skips under 100m within 45s", () => {
    markLocationUpdateAccepted({ lat: 25.033, lng: 121.565 }, 10);
    const d = shouldAcceptLocationUpdate(
      { lat: 25.0334, lng: 121.5654, usedFallback: false },
      8,
    );
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("distance_under_100m");
  });
});
