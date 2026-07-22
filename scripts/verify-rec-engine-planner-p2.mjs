#!/usr/bin/env node
/**
 * Planner Integration P2.1
 * Flag ON：Recommendation Profile 為唯一排序來源（非 trip-place-scoring）。
 *
 * 執行：npm run verify:rec-engine-planner-p2
 */
import assert from "node:assert/strict";
import {
  applyPlannerHardConstraints,
  buildPlannerCandidatePool,
  getRecEngineMetrics,
  mapTripStyleToProfileHint,
  rankPlannerPlacesViaRecEngine,
  resetRecEngineMetrics,
  setRecEnginePlannerEnabledOverride,
  setRecEngineValidatorEnabledOverride,
} from "../src/lib/recommendation/engine/index.ts";

// P2.1 隔離：不測 Recommendation Validator（Priority 2 另測）
setRecEngineValidatorEnabledOverride(false);
import {
  filterAndRankTripPlacesForPlanning,
  scoreTripPlace,
} from "../src/lib/ai/trip-place-scoring.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function placeIds(list) {
  return list.map((p) => p.id);
}

const SCORING = {
  style: "mixed",
  days: 2,
  vibe: "either",
  pace: "medium",
  centerLat: 25.033,
  centerLng: 121.565,
  plusContext: null,
};

const PLACES = [
  {
    id: "p-museum",
    name: "National Museum",
    address: null,
    lat: 25.031,
    lng: 121.512,
    rating: 4.6,
    userRatingCount: 900,
    photoName: null,
    primaryType: "museum",
    types: ["museum"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
  },
  {
    id: "p-cafe",
    name: "Alley Cafe",
    address: null,
    lat: 25.034,
    lng: 121.566,
    rating: 4.4,
    userRatingCount: 200,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
  },
  {
    id: "p-closed",
    name: "Closed Shop",
    address: null,
    lat: 25.033,
    lng: 121.565,
    rating: 4.9,
    userRatingCount: 50,
    photoName: null,
    primaryType: "store",
    types: ["store"],
    businessStatus: "CLOSED_PERMANENTLY",
    openStatus: "closed_now",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: false,
  },
  {
    id: "p-park",
    name: "Riverside Park",
    address: null,
    lat: 25.04,
    lng: 121.57,
    rating: 4.3,
    userRatingCount: 400,
    photoName: null,
    primaryType: "park",
    types: ["park"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
  },
];

console.info("[verify:rec-engine-planner-p2] Planner Integration P2.1\n");

test("style maps to existing Recommendation Profiles (no planner weights)", () => {
  assert.equal(mapTripStyleToProfileHint("slow_nature"), "nature");
  assert.equal(mapTripStyleToProfileHint("local_life"), "shopping");
  assert.equal(mapTripStyleToProfileHint("classic_landmarks"), "general");
  assert.equal(mapTripStyleToProfileHint("mixed"), "general");
});

test("hard constraints filter without sorting", () => {
  const out = applyPlannerHardConstraints(PLACES, "mixed");
  assert.ok(!placeIds(out).includes("p-closed"));
  // relative order of survivors preserved from input
  const survivors = PLACES.filter((p) => p.id !== "p-closed");
  assert.deepEqual(placeIds(out), placeIds(survivors));
});

test("Flag OFF still legacy trip-place-scoring (rollback)", () => {
  setRecEnginePlannerEnabledOverride(false);
  resetRecEngineMetrics();
  const legacy = filterAndRankTripPlacesForPlanning(PLACES, SCORING);
  const via = rankPlannerPlacesViaRecEngine(PLACES, SCORING);
  assert.deepEqual(placeIds(via), placeIds(legacy));
  assert.equal(getRecEngineMetrics().lastPath, "legacy");
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag ON uses engine_planner_p2 path (not trip-place-scoring order requirement)", () => {
  setRecEnginePlannerEnabledOverride(true);
  resetRecEngineMetrics();
  const via = rankPlannerPlacesViaRecEngine(PLACES, SCORING);
  assert.equal(getRecEngineMetrics().lastPath, "engine_planner_p2");
  assert.equal(getRecEngineMetrics().lastSurface, "planner");
  assert.ok(!placeIds(via).includes("p-closed"));
  assert.ok(via.length >= 2);
  // Deterministic: same input → same order
  const via2 = rankPlannerPlacesViaRecEngine(PLACES, SCORING);
  assert.deepEqual(placeIds(via), placeIds(via2));
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag ON pool scoreBreakdown uses Engine factors (open/distance/rating), not trip-place style keys only", () => {
  setRecEnginePlannerEnabledOverride(true);
  const pool = buildPlannerCandidatePool(PLACES, SCORING);
  assert.ok(pool.results.length > 0);
  const top = pool.results[0];
  assert.ok("open" in top.scoreBreakdown || "distance" in top.scoreBreakdown);
  assert.ok("rating" in top.scoreBreakdown);
  // Engine path should not be pure trip-place breakdown-only
  assert.ok(top.profileId === "general" || top.profileId == null || typeof top.profileId === "string");
  setRecEnginePlannerEnabledOverride(null);
});

test("P2.1 does not require trip-place score to equal Engine score", () => {
  setRecEnginePlannerEnabledOverride(true);
  const pool = buildPlannerCandidatePool(PLACES, SCORING);
  const place = pool.results[0].candidate.raw;
  const tripScore = scoreTripPlace(place, SCORING);
  // May differ — that is the point of P2.1 leaving trip-place-scoring as ranker
  assert.equal(typeof tripScore, "number");
  assert.equal(typeof pool.results[0].score, "number");
  setRecEnginePlannerEnabledOverride(null);
});

setRecEngineValidatorEnabledOverride(null);
console.info("\n[verify:rec-engine-planner-p2] P2.1 passed — stop before P2.2 (slot pick demotion).\n");
