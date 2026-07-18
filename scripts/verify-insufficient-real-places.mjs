/**
 * Acceptance: insufficient real places → block empty non-free days;
 * stop normalize + pre-save validation; synthetic vs real filler policy;
 * dynamic stop capacity (not days×3).
 */
import assert from "node:assert/strict";
import {
  calculateDynamicStopCapacity,
  computeMinimumPlacesForTripDays,
  evaluateTotalRealPlaceValidation,
  normalizeItineraryStop,
  normalizeItineraryStops,
  SELECTED_COMBINATION_FILLER_POLICY,
  validateItineraryPreSave,
  unwrapRawStop,
  buildSelectedThemeProfile,
} from "../src/lib/ai/real-place-supplement.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";
import { hasCompleteItineraryPayload } from "../src/lib/trip/itinerary-guards.ts";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("=== verify-insufficient-real-places ===\n");

check("filler policy forbids synthetic, allows real supplement", () => {
  assert.equal(SELECTED_COMBINATION_FILLER_POLICY.allowSynthetic, false);
  assert.equal(SELECTED_COMBINATION_FILLER_POLICY.allowResolvedRealPlaceSupplement, true);
});

check("3-day single-select dynamic capacity: preferred≈7 minViable≈4 max≈10", () => {
  const cap = calculateDynamicStopCapacity({
    tripDays: 3,
    selectedCombinationCount: 1,
  });
  assert.equal(cap.preferredStops, 7);
  assert.equal(cap.minimumViableStops, 4);
  assert.ok(cap.maximumStops >= 10);
  assert.equal(computeMinimumPlacesForTripDays(3, 1), 4);
});

check("multi-select viability floors at combo count (not days×3)", () => {
  const cap = calculateDynamicStopCapacity({
    tripDays: 3,
    selectedCombinationCount: 3,
  });
  assert.equal(cap.minimumViableStops, 3);
  assert.ok(cap.preferredStops >= 3);
  assert.ok(cap.preferredStops < 3 * 3, "must not require days×3 / combo×3");
});

check("compact mode when between minimumViable and preferred", () => {
  const cap = calculateDynamicStopCapacity({ tripDays: 3, selectedCombinationCount: 1 });
  const compact = evaluateTotalRealPlaceValidation(5, cap);
  assert.equal(compact.result, "compact");
  assert.equal(compact.compactItineraryMode, true);
  const pass = evaluateTotalRealPlaceValidation(7, cap);
  assert.equal(pass.result, "pass");
  const fail = evaluateTotalRealPlaceValidation(2, cap);
  assert.equal(fail.result, "fail");
});

check("single theme profile expands coast facets", () => {
  const profile = buildSelectedThemeProfile({
    selectedCombinationIds: [4],
    pools: [{ combinationId: 4, theme: "coast", title: "海岸夕陽組合" }],
  });
  assert.deepEqual(profile.selectedCombinationIds, [4]);
  assert.ok(profile.primaryThemes.includes("coast"));
  assert.ok(profile.primaryThemes.includes("harbor"));
  assert.ok(profile.primaryThemes.includes("sunset"));
});

check("unwrap nested stop wrappers", () => {
  const nested = unwrapRawStop({
    place: {
      placeName: "淺草寺",
      googlePlaceId: "ChIJabc123456789012345678",
      lat: 35.71,
      lng: 139.79,
      address: "Tokyo",
    },
    time: "10:00",
    date: "2026-11-25",
  });
  assert.ok(nested);
  assert.equal(nested.placeName, "淺草寺");
  assert.equal(nested.time, "10:00");
});

check("normalizeItineraryStop accepts flat stop", () => {
  const result = normalizeItineraryStop(
    {
      date: "2026-11-25",
      time: "10:00",
      title: "淺草寺",
      placeName: "淺草寺",
      description: "",
      googlePlaceId: "ChIJabc123456789012345678",
      lat: 35.7148,
      lng: 139.7967,
      address: "東京都台東區",
    },
    0,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.stop.name, "淺草寺");
    assert.ok(result.stop.googlePlaceId.startsWith("ChIJ"));
  }
});

check("normalizeItineraryStop rejects missing place id", () => {
  const result = normalizeItineraryStop(
    {
      date: "2026-11-25",
      time: "10:00",
      title: "未知",
      placeName: "未知",
      description: "",
      lat: 35.7,
      lng: 139.7,
      address: "Tokyo",
    },
    1,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issue.missingFields.includes("googlePlaceId"));
  }
});

check("pre-save blocks empty non-free day when stops < days", () => {
  const stops = Array.from({ length: 5 }, (_, i) => ({
    date: `2026-11-${25 + i}`,
    time: "10:00",
    title: `Place ${i}`,
    placeName: `Place ${i}`,
    description: "",
    googlePlaceId: `ChIJabcdefghijklmnop${i}01234`,
    lat: 35.7 + i * 0.01,
    lng: 139.7 + i * 0.01,
    address: "Tokyo",
  }));
  const result = validateItineraryPreSave({
    tripDays: 6,
    startDate: "2026-11-25",
    stops,
  });
  assert.equal(result.ok, false);
  assert.ok(result.emptyNonFreeDays.includes(6));
  assert.ok(result.reasons.some((r) => r.includes("empty_non_free_day:6")));
  assert.ok(result.reasons.some((r) => r.includes("insufficient_real_places")));
});

check("pre-save passes when every day has a real stop", () => {
  const stops = Array.from({ length: 6 }, (_, i) => ({
    date: `2026-11-${25 + i}`,
    time: "10:00",
    title: `Place ${i}`,
    placeName: `Place ${i}`,
    description: "",
    googlePlaceId: `ChIJabcdefghijklmnop${i}01234`,
    lat: 35.7 + i * 0.01,
    lng: 139.7 + i * 0.01,
    address: "Tokyo",
  }));
  const result = validateItineraryPreSave({
    tripDays: 6,
    startDate: "2026-11-25",
    stops,
  });
  assert.equal(result.ok, true, result.reasons.join("|"));
  assert.equal(result.emptyNonFreeDays.length, 0);
});

check("local fallback with 5 places / 6 days does not invent synthetic stops", () => {
  const places = Array.from({ length: 5 }, (_, i) => ({
    name: `Place ${i}`,
    placeName: `Place ${i}`,
    googlePlaceId: `ChIJabcdefghijklmnop${i}01234`,
    address: "Tokyo",
    lat: 35.7 + i * 0.05,
    lng: 139.7 + i * 0.05,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1h",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 1,
    matchedSelectedCombinationIds: [1],
  }));
  const stops = buildFallbackItineraryFromPlaces(places, 6, "2026-11-25", "東京", {
    selectedCombinationIds: [1],
  });
  assert.equal(stops.length, 5);
  assert.ok(stops.every((s) => s.googlePlaceId?.startsWith("ChIJ")));
  const complete = hasCompleteItineraryPayload(
    { itinerary: stops },
    6,
    "2026-11-25",
  );
  assert.equal(complete, false);
});

check("normalizeItineraryStops reports counts", () => {
  const { valid, invalid } = normalizeItineraryStops([
    {
      date: "2026-11-25",
      time: "10:00",
      title: "A",
      placeName: "A",
      description: "",
      googlePlaceId: "ChIJabcdefghijklmnop001234",
      lat: 35.7,
      lng: 139.7,
      address: "Tokyo",
    },
    { place: { name: "broken" } },
  ]);
  assert.equal(valid.length, 1);
  assert.equal(invalid.length, 1);
});

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll insufficient-real-places checks passed.");
