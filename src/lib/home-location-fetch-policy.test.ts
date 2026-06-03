import { describe, expect, it } from "vitest";
import {
  coordsMovedMeters,
  shouldSkipLocationPublish,
  shouldSkipNearbyRefetch,
} from "@/lib/home-location-fetch-policy";

describe("home-location-fetch-policy", () => {
  it("skips publish when moved under 100m", () => {
    const prev = { lat: 25.033, lng: 121.565 };
    const next = { lat: 25.0334, lng: 121.5654 };
    expect(coordsMovedMeters(prev, next)).toBeLessThan(100);
    const gate = shouldSkipLocationPublish({
      prev,
      next,
      lastPublishAt: Date.now() - 60_000,
    });
    expect(gate.skip).toBe(true);
    expect(gate.reason).toBe("distance_under_threshold");
  });

  it("skips nearby refetch for same cache key within interval", () => {
    const gate = shouldSkipNearbyRefetch({
      prevCoords: { lat: 25.033, lng: 121.565 },
      nextCoords: { lat: 25.033, lng: 121.565 },
      lastFetchAt: Date.now() - 10_000,
      cacheKey: "v4§25.033§121.565§food§",
      lastCacheKey: "v4§25.033§121.565§food§",
    });
    expect(gate.skip).toBe(true);
    expect(gate.reason).toBe("interval_same_cache_key");
  });
});
