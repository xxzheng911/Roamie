/**
 * Acceptance: selected combinations 1,2,4 → required pool coverage + landmark merge + snapshots.
 * Destination-agnostic (uses synthetic coords; no city hardcode in logic under test).
 */
import assert from "node:assert/strict";
import { buildMixedItineraryFromPlaces } from "../src/lib/trip/mixed-itinerary-schedule.ts";
import { validateSelectedCombinationCoverage } from "../src/lib/ai/combination-itinerary-integrity.ts";
import { shouldShowTicketAffiliate } from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const required = [
  "審計新村",
  "草悟道",
  "勤美誠品綠園道",
  "宮原眼科",
  "逢甲夜市",
  "一中商圈",
  "第二市場",
  "高美濕地",
  "東海藝術街",
  "梧棲漁港",
];

const places = required.map((name, i) => {
  // Cluster into two geographic basins so allocation has meaningful day groups.
  // Keep 草悟道 + its public-art sub-place within ~900m (walking precinct).
  const downtown = i < 7;
  const lat = downtown ? 24.147 + (i % 4) * 0.004 : 24.31 + (i % 3) * 0.01;
  const lng = downtown ? 120.664 + (i % 3) * 0.004 : 120.55 + (i % 3) * 0.01;
  return {
    name,
    placeName: name,
    googlePlaceId: `ChIJ_mock_${i}`,
    address: `City ${name}`,
    lat: name === "草悟道" ? 24.1477 : lat,
    lng: name === "草悟道" ? 120.6636 : lng,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1h",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: i < 4 ? 1 : i < 7 ? 2 : 4,
    matchedSelectedCombinationIds: [i < 4 ? 1 : i < 7 ? 2 : 4],
    rating: 4.4,
    userRatingCount: 1000,
    photoName: `photos/p${i}`,
  };
});

places.push({
  name: "草悟道綠園道公共藝術",
  placeName: "草悟道綠園道公共藝術",
  googlePlaceId: "ChIJ_art",
  address: "City art",
  lat: 24.1555,
  lng: 120.6638,
  type: "景點",
  description: "",
  reason: "",
  estimatedTime: "1h",
  googleMapsUrl: "",
  reasonSource: "template",
  sourceCombinationId: 1,
  matchedSelectedCombinationIds: [1],
  rating: 3.8,
  userRatingCount: 50,
  photoName: null,
});

const stops = buildMixedItineraryFromPlaces(places, 5, "2026-08-09", "台中", {
  selectedCombinationIds: [1, 2, 4],
});

assert.ok(stops.length >= 8, `expected ≥8 scheduled, got ${stops.length}`);
assert.equal(
  stops.some((s) => (s.placeName ?? "").includes("公共藝術")),
  false,
  "public-art sub-place must not remain as its own stop",
);
assert.ok(
  stops.every((s) => s.googlePlaceId && s.address && s.lat != null && s.rating != null),
  "every stop must carry a place snapshot",
);

const byDay = new Map();
for (const s of stops) {
  const list = byDay.get(s.date) ?? [];
  list.push(s.placeName);
  byDay.set(s.date, list);
}
console.log("daily allocation:");
for (const [date, names] of byDay) {
  console.log(`  ${date}: ${names.join(", ")}`);
}

const coverage = validateSelectedCombinationCoverage({
  requiredPlaceNames: required,
  scheduledStops: stops,
  resolvedPlaces: places,
  mergedAsDuplicate: [
    {
      source: "草悟道綠園道公共藝術",
      representative: "草悟道",
      reason: "sub_place_of_same_landmark",
    },
  ],
});

console.log("coverage report:", {
  required: coverage.required,
  scheduled: coverage.scheduled,
  mergedAsDuplicate: coverage.mergedAsDuplicate,
  unresolved: coverage.unresolved,
  fallbackAdded: coverage.fallbackAdded,
});

assert.equal(coverage.required, 10);
assert.ok(coverage.scheduled + coverage.mergedAsDuplicate >= 9);
assert.equal(coverage.unresolved, 0);

for (const name of ["逢甲夜市", "大慶夜市"]) {
  const d = shouldShowTicketAffiliate({
    placeName: name,
    types: ["tourist_attraction"],
  });
  assert.equal(d.show, false, `${name} must hide night-market tickets`);
  console.log(`ticket ${name} → hide (${d.reason})`);
}

console.log("\nAll selected-combination coverage checks passed.");
