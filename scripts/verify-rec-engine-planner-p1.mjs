#!/usr/bin/env node
/**
 * Planner Integration P1 — 行為對齊 trip-place-scoring。
 * 執行：npm run verify:rec-engine-planner-p1
 */
import assert from "node:assert/strict";
import {
  buildPlannerCandidatePool,
  getRecEngineMetrics,
  isRecEnginePlannerEnabled,
  rankPlannerPlacesViaRecEngine,
  resetRecEngineMetrics,
  setRecEnginePlannerEnabledOverride,
  setRecEngineValidatorEnabledOverride,
} from "../src/lib/recommendation/engine/index.ts";

// P1 隔離：不測 Recommendation Validator
setRecEngineValidatorEnabledOverride(false);
import {
  filterAndRankTripPlacesForPlanning,
  scoreTripPlace,
  scoreTripPlaceWithBreakdown,
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

console.info("[verify:rec-engine-planner-p1] Planner Integration P1\n");

test("Planner flag override OFF/ON works (env may be ON for local AI wiring)", () => {
  setRecEnginePlannerEnabledOverride(false);
  assert.equal(isRecEnginePlannerEnabled(), false);
  setRecEnginePlannerEnabledOverride(true);
  assert.equal(isRecEnginePlannerEnabled(), true);
  setRecEnginePlannerEnabledOverride(null);
});

test("scoreTripPlaceWithBreakdown matches scoreTripPlace", () => {
  for (const p of PLACES) {
    const a = scoreTripPlace(p, SCORING);
    const b = scoreTripPlaceWithBreakdown(p, SCORING);
    assert.equal(a, b.score);
    assert.ok("style" in b.scoreBreakdown);
    assert.ok("rating" in b.scoreBreakdown);
  }
});

test("Flag OFF === filterAndRankTripPlacesForPlanning", () => {
  setRecEnginePlannerEnabledOverride(false);
  resetRecEngineMetrics();
  const legacy = filterAndRankTripPlacesForPlanning(PLACES, SCORING);
  const via = rankPlannerPlacesViaRecEngine(PLACES, SCORING);
  assert.deepEqual(placeIds(via), placeIds(legacy));
  assert.equal(getRecEngineMetrics().lastPath, "legacy");
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag OFF excludes permanently closed (legacy)", () => {
  setRecEnginePlannerEnabledOverride(false);
  const via = rankPlannerPlacesViaRecEngine(PLACES, SCORING);
  assert.ok(!placeIds(via).includes("p-closed"));
  setRecEnginePlannerEnabledOverride(null);
});

test("legacy buildPlannerCandidatePool (Flag OFF) exposes trip-place scoreBreakdown", () => {
  setRecEnginePlannerEnabledOverride(false);
  const pool = buildPlannerCandidatePool(PLACES, SCORING);
  assert.equal(pool.surface, "planner");
  assert.ok(pool.results.length > 0);
  for (const r of pool.results) {
    assert.ok(r.scoreBreakdown);
    assert.equal(typeof r.scoreBreakdown.style, "number");
    assert.deepEqual(r.scoreBreakdown, r.breakdown);
  }
  setRecEnginePlannerEnabledOverride(null);
});

setRecEngineValidatorEnabledOverride(null);
console.info("\n[verify:rec-engine-planner-p1] Rollback/legacy checks passed.\n");
console.info("Note: Flag ON ranking is P2.1 (Profile) — see verify:rec-engine-planner-p2\n");
