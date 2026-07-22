#!/usr/bin/env node
/**
 * Recommendation Engine R1.1 契約驗證（不打真實 Places API）。
 * 執行：npm run verify:rec-engine-r1-1
 *
 * R1.1 因子：Business Hours / Distance / Rating / Review Count
 */
import assert from "node:assert/strict";
import {
  getRecEngineMetrics,
  getRecommendationProfile,
  isRecEngineEnabled,
  isRecEngineR11Enabled,
  resetRecEngineMetrics,
  resolveR11Weights,
  R1_1_WEIGHTS_DEFAULT,
  R1_1_WEIGHTS_FOOD_NIGHT,
  runRecommendationPipeline,
  scoreCandidatesR11,
  setRecEngineEnabledOverride,
  setRecEngineR11EnabledOverride,
  setRecEngineR12EnabledOverride,
  sortExplorePlacesViaRecEngine,
} from "../src/lib/recommendation/engine/index.ts";
import { sortExplorePlaces } from "../src/lib/sort-explore-places.ts";

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
  return list.map((p) => p.id ?? p.name);
}

const ORIGIN = { lat: 25.033, lng: 121.565 };

const FIXTURE = [
  {
    id: "closed-near-high",
    name: "近處打烊高分",
    lat: 25.0331,
    lng: 121.5651,
    rating: 4.9,
    userRatingCount: 2000,
    openStatus: "closed_now",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
  {
    id: "open-far-mid",
    name: "遠處營業中分",
    lat: 25.06,
    lng: 121.6,
    rating: 4.0,
    userRatingCount: 80,
    openStatus: "open",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
  {
    id: "open-near-high",
    name: "近處營業高分",
    lat: 25.0332,
    lng: 121.5652,
    rating: 4.7,
    userRatingCount: 500,
    openStatus: "open",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
  {
    id: "open-near-low-reviews",
    name: "近處營業低評少評論",
    lat: 25.0333,
    lng: 121.5653,
    rating: 3.5,
    userRatingCount: 5,
    openStatus: "open",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
];

console.info("[verify:rec-engine-r1-1] Recommendation Engine R1.1\n");

test("R1.1 flag defaults OFF", () => {
  setRecEngineR11EnabledOverride(null);
  assert.equal(isRecEngineR11Enabled(), false);
});

test("Recommendation Profiles own weights (not hardcoded in Engine)", () => {
  assert.deepEqual(resolveR11Weights("attraction"), R1_1_WEIGHTS_DEFAULT);
  assert.deepEqual(resolveR11Weights("food"), R1_1_WEIGHTS_FOOD_NIGHT);
  assert.deepEqual(resolveR11Weights("night"), R1_1_WEIGHTS_FOOD_NIGHT);

  const sumDefault = Object.values(R1_1_WEIGHTS_DEFAULT).reduce((a, b) => a + b, 0);
  const sumFood = Object.values(R1_1_WEIGHTS_FOOD_NIGHT).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumDefault - 1) < 1e-9);
  assert.ok(Math.abs(sumFood - 1) < 1e-9);

  for (const id of ["general", "food", "night", "cafe", "nature", "shopping"]) {
    const p = getRecommendationProfile(id);
    assert.equal(p.id, id);
    assert.equal(p.weights.memory, 0);
    assert.equal(p.weights.dna, 0);
  }
});

test("R1.1 score prefers open + near + high rating", () => {
  const scored = scoreCandidatesR11(
    FIXTURE.map((p, i) => ({
      placeId: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      openStatus: p.openStatus,
      openNow: p.openStatus === "open",
      source: "explore",
      raw: p,
    })),
    { surface: "explore", location: ORIGIN, categoryHint: "food" },
  );
  scored.sort((a, b) => b.score - a.score);
  assert.equal(scored[0].candidate.placeId, "open-near-high");
  assert.ok(scored.every((s) => "open" in s.scoreBreakdown && "distance" in s.scoreBreakdown));
  assert.ok(scored.every((s) => "rating" in s.scoreBreakdown && "reviews" in s.scoreBreakdown));
  // closed place should rank below open-near-high
  const closedRank = scored.findIndex((s) => s.candidate.placeId === "closed-near-high");
  const openNearRank = scored.findIndex((s) => s.candidate.placeId === "open-near-high");
  assert.ok(openNearRank < closedRank);
});

test("Engine ON + R1.1 OFF === legacy sortExplorePlaces (R0 preserved)", () => {
  setRecEngineEnabledOverride(true);
  setRecEngineR11EnabledOverride(false);
  setRecEngineR12EnabledOverride(false);
  resetRecEngineMetrics();

  const legacy = sortExplorePlaces(FIXTURE, ORIGIN, null, null, "food");
  const via = sortExplorePlacesViaRecEngine(FIXTURE, ORIGIN, null, null, "food");
  assert.deepEqual(placeIds(via), placeIds(legacy));
  assert.equal(getRecEngineMetrics().lastPath, "engine");

  setRecEngineEnabledOverride(null);
  setRecEngineR11EnabledOverride(null);
  setRecEngineR12EnabledOverride(null);
});

test("Engine ON + R1.1 ON uses engine_r1_1 path and may reorder vs legacy", () => {
  setRecEngineEnabledOverride(true);
  setRecEngineR11EnabledOverride(true);
  setRecEngineR12EnabledOverride(false);
  resetRecEngineMetrics();

  const legacy = sortExplorePlaces(FIXTURE, ORIGIN, null, null, "food");
  const via = sortExplorePlacesViaRecEngine(FIXTURE, ORIGIN, null, null, "food");

  assert.equal(getRecEngineMetrics().lastPath, "engine_r1_1");
  assert.equal(via.length, legacy.length);
  assert.equal(via[0].id, "open-near-high");

  const r11Ids = placeIds(via);
  const legacyIds = placeIds(legacy);
  assert.deepEqual([...r11Ids].sort(), [...legacyIds].sort());

  setRecEngineEnabledOverride(null);
  setRecEngineR11EnabledOverride(null);
  setRecEngineR12EnabledOverride(null);
});

test("R1.1 OFF (engine off) keeps TestFlight legacy path", () => {
  setRecEngineEnabledOverride(false);
  setRecEngineR11EnabledOverride(true);
  resetRecEngineMetrics();
  assert.equal(isRecEngineEnabled(), false);

  const legacy = sortExplorePlaces(FIXTURE, ORIGIN, null, null, "attraction");
  const via = sortExplorePlacesViaRecEngine(FIXTURE, ORIGIN, null, null, "attraction");
  assert.deepEqual(placeIds(via), placeIds(legacy));
  assert.equal(getRecEngineMetrics().lastPath, "legacy");

  setRecEngineEnabledOverride(null);
  setRecEngineR11EnabledOverride(null);
});

test("explain emits structured RecommendationReason (not full sentences)", () => {
  const results = runRecommendationPipeline({
    ctx: { surface: "explore", location: ORIGIN, categoryHint: "food" },
    inputs: FIXTURE,
    source: "explore",
    scoreFn: scoreCandidatesR11,
  });
  const top = results[0];
  assert.ok(Array.isArray(top.reasons));
  assert.ok(top.reasons.length > 0);
  for (const r of top.reasons) {
    assert.equal(typeof r.code, "string");
    assert.equal(typeof r.strength, "number");
    // Must not look like a full Chinese sentence
    assert.ok(!/[\u4e00-\u9fff]{4,}/.test(r.code));
    assert.ok(!/\s/.test(r.code));
  }
  assert.ok(top.reasons.some((r) =>
    ["open_now", "nearby", "high_rating", "many_reviews", "closing_soon"].includes(r.code),
  ));
});

test("R1.1 without personalization keeps memory/dna weights at 0", () => {
  const [one] = scoreCandidatesR11(
    [
      {
        placeId: "x",
        name: "x",
        lat: 25.033,
        lng: 121.565,
        rating: 4.5,
        userRatingCount: 10,
        openStatus: "open",
        source: "explore",
      },
    ],
    { surface: "explore", location: ORIGIN },
  );
  assert.equal(one.scoreBreakdown.memory, 0);
  assert.equal(one.scoreBreakdown.dna, 0);
  assert.equal(one.effectiveWeights?.memory ?? 0, 0);
  assert.equal(one.effectiveWeights?.dna ?? 0, 0);
  assert.ok(!("weather" in one.scoreBreakdown) || one.scoreBreakdown.weather === 0);
});

console.info("\n[verify:rec-engine-r1-1] All checks passed.\n");
