/**
 * Directions distance-aware mode chain + fallback (no live API).
 */
import assert from "node:assert/strict";
import {
  availableModesToRoutesModes,
  buildFallbackModeChain,
  resolveInitialDirectionsMode,
  transportFallbackModeFromResult,
  resolvedTransportDisplayLabel,
  AUTO_WALK_MAX_METERS,
  MAX_WALK_DIRECTIONS_METERS,
} from "../src/lib/saved-trip/route-duration-fallback.ts";

console.log("=== directions fallback ===\n");

assert.deepEqual(availableModesToRoutesModes(["TRANSIT"], "WALK"), ["TRANSIT"]);
assert.deepEqual(buildFallbackModeChain("WALK", 50_000, ["TRANSIT"]), [
  "TRANSIT",
  "DRIVE",
]);
assert.deepEqual(buildFallbackModeChain("BICYCLE", 10_000, ["TRANSIT"]), [
  "TRANSIT",
  "DRIVE",
  "WALK",
]);

assert.equal(resolveInitialDirectionsMode("WALK", 800), "WALK");
assert.equal(resolveInitialDirectionsMode("WALK", 20_000), "DRIVE");
assert.equal(resolveInitialDirectionsMode("WALK", 50_000), "DRIVE");
assert.ok(AUTO_WALK_MAX_METERS < MAX_WALK_DIRECTIONS_METERS);

// Mid-distance default walk → drive first (no walking API call).
assert.equal(resolveInitialDirectionsMode("WALK", 5_000), "DRIVE");

const longWalkFallback = {
  ok: true,
  durationMinutes: 18,
  distanceMeters: 12_000,
  mode: "DRIVE",
  usedWalkFallback: false,
  usedEstimatedFallback: true,
  fallbackEstimateMode: "DRIVE",
  transitUnavailable: false,
  transitUnavailableProvider: null,
  estimates: { distanceMeters: 12_000, drive: 18 },
};
assert.equal(transportFallbackModeFromResult(longWalkFallback), "drive");
assert.equal(
  resolvedTransportDisplayLabel("步行", longWalkFallback),
  "開車",
);

console.log("verify-directions-fallback: ok");
