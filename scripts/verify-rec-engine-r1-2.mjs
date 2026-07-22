#!/usr/bin/env node
/**
 * Recommendation Engine R1.2 契約驗證。
 * Memory / DNA → Weight Suggestion / Preference Signal only；Engine 統一計分。
 *
 * 執行：npm run verify:rec-engine-r1-2
 */
import assert from "node:assert/strict";
import {
  buildDnaPersonalization,
  buildMemoryPersonalization,
  getRecEngineMetrics,
  isRecEngineR12Enabled,
  mergeWeightsWithSuggestions,
  getRecommendationProfile,
  preferenceFactorScores,
  resetRecEngineMetrics,
  runRecommendationPipeline,
  scoreCandidatesWithProfile,
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

const PLACES = [
  {
    id: "cafe-a",
    name: "Slow Cafe",
    lat: 25.034,
    lng: 121.566,
    rating: 4.4,
    userRatingCount: 120,
    openStatus: "open",
    primaryType: "cafe",
    types: ["cafe", "coffee_shop"],
  },
  {
    id: "museum-b",
    name: "City Museum",
    lat: 25.0335,
    lng: 121.5655,
    rating: 4.6,
    userRatingCount: 800,
    openStatus: "open",
    primaryType: "museum",
    types: ["museum"],
  },
  {
    id: "park-c",
    name: "Riverside Park",
    lat: 25.035,
    lng: 121.567,
    rating: 4.3,
    userRatingCount: 200,
    openStatus: "open",
    primaryType: "park",
    types: ["park"],
  },
];

console.info("[verify:rec-engine-r1-2] Recommendation Engine R1.2\n");

test("R1.2 flag defaults OFF", () => {
  setRecEngineR12EnabledOverride(null);
  assert.equal(isRecEngineR12Enabled(), false);
});

test("Memory builds suggestions + preference signals (does not sort)", () => {
  const { suggestions, signals } = buildMemoryPersonalization({
    interests: ["咖啡", "自然"],
  });
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every((s) => s.source === "memory"));
  assert.ok(signals.length > 0);
  assert.ok(signals[0].typeBoosts?.cafe || signals[0].labelBoosts);
});

test("DNA builds suggestions + preference signals (does not sort)", () => {
  const { suggestions, signals } = buildDnaPersonalization({
    personalityType: "Cafe Lover",
    travelStyle: "Cafe Lover",
  });
  assert.ok(suggestions.some((s) => s.source === "dna" && (s.weightDeltas?.dna ?? 0) > 0));
  assert.ok(signals.some((s) => s.typeBoosts?.cafe));
});

test("Weight suggestions merge into profile; Engine still computes score", () => {
  const base = getRecommendationProfile("general").weights;
  const merged = mergeWeightsWithSuggestions(base, [
    { source: "dna", weightDeltas: { dna: 0.1, distance: -0.05, open: -0.05 } },
  ]);
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(merged.dna > base.dna);
});

test("Preference signal raises cafe affinity without reordering by itself", () => {
  const cafe = {
    placeId: "cafe-a",
    name: "Slow Cafe",
    lat: 25.034,
    lng: 121.566,
    primaryType: "cafe",
    types: ["cafe"],
    source: "explore",
  };
  const museum = {
    placeId: "museum-b",
    name: "City Museum",
    lat: 25.0335,
    lng: 121.5655,
    primaryType: "museum",
    types: ["museum"],
    source: "explore",
  };
  const signals = buildDnaPersonalization({ personalityType: "Cafe Lover" }).signals;
  const cafePref = preferenceFactorScores(cafe, signals);
  const museumPref = preferenceFactorScores(museum, signals);
  assert.ok(cafePref.dna > museumPref.dna);
});

test("R1.2 ON boosts DNA-matching place vs R1.1-only path", () => {
  const candidates = PLACES.map((p) => ({
    placeId: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    openStatus: p.openStatus,
    primaryType: p.primaryType,
    types: p.types,
    source: "explore",
    raw: p,
  }));

  const profile = {
    personalityType: "Cafe Lover",
    interests: ["咖啡"],
  };
  const memory = buildMemoryPersonalization(profile);
  const dna = buildDnaPersonalization(profile);
  const personalization = {
    weightSuggestions: [...memory.suggestions, ...dna.suggestions],
    preferenceSignals: [...memory.signals, ...dna.signals],
  };

  const without = scoreCandidatesWithProfile(candidates, {
    surface: "explore",
    location: ORIGIN,
    categoryHint: "general",
  });
  const withPers = scoreCandidatesWithProfile(
    candidates,
    { surface: "explore", location: ORIGIN, categoryHint: "general" },
    { personalization },
  );

  without.sort((a, b) => b.score - a.score);
  withPers.sort((a, b) => b.score - a.score);

  const cafeWithout = without.find((s) => s.candidate.placeId === "cafe-a");
  const cafeWith = withPers.find((s) => s.candidate.placeId === "cafe-a");
  const museumWithout = without.find((s) => s.candidate.placeId === "museum-b");
  const museumWith = withPers.find((s) => s.candidate.placeId === "museum-b");
  assert.ok(cafeWith && cafeWithout && museumWith && museumWithout);

  // DNA/Memory 只透過 weight + preference signal 影響 Engine 計分
  assert.ok((cafeWith.effectiveWeights?.dna ?? 0) > 0);
  assert.ok((cafeWith.scoreBreakdown.dna ?? 0) > 0);

  // 相對 museum：Cafe Lover 應提升 cafe 相對優勢（非 Memory/DNA 直接排序）
  const relWithout = cafeWithout.score - museumWithout.score;
  const relWith = cafeWith.score - museumWith.score;
  assert.ok(relWith > relWithout);
});

test("Explore adapter: R1.2 path = engine_r1_2; Memory/DNA not direct sort API", () => {
  setRecEngineEnabledOverride(true);
  setRecEngineR11EnabledOverride(false);
  setRecEngineR12EnabledOverride(true);
  resetRecEngineMetrics();

  const via = sortExplorePlacesViaRecEngine(
    PLACES,
    ORIGIN,
    { personalityType: "Cafe Lover", interests: ["咖啡"] },
    null,
    "general",
  );
  assert.equal(getRecEngineMetrics().lastPath, "engine_r1_2");
  assert.equal(via.length, PLACES.length);

  setRecEngineEnabledOverride(null);
  setRecEngineR11EnabledOverride(null);
  setRecEngineR12EnabledOverride(null);
});

test("R1.2 OFF keeps R1.1/R0 behavior for same flags", () => {
  setRecEngineEnabledOverride(true);
  setRecEngineR11EnabledOverride(true);
  setRecEngineR12EnabledOverride(false);
  resetRecEngineMetrics();

  const a = sortExplorePlacesViaRecEngine(PLACES, ORIGIN, { personalityType: "Cafe Lover" }, null, "general");
  assert.equal(getRecEngineMetrics().lastPath, "engine_r1_1");

  setRecEngineR11EnabledOverride(false);
  resetRecEngineMetrics();
  const legacy = sortExplorePlaces(PLACES, ORIGIN, null, null, "general");
  const b = sortExplorePlacesViaRecEngine(PLACES, ORIGIN, { personalityType: "Cafe Lover" }, null, "general");
  assert.deepEqual(placeIds(b), placeIds(legacy));
  assert.equal(getRecEngineMetrics().lastPath, "engine");

  setRecEngineEnabledOverride(null);
  setRecEngineR11EnabledOverride(null);
  setRecEngineR12EnabledOverride(null);
});

test("explain under R1.2 may emit memory_match / dna_match codes", () => {
  const profile = { personalityType: "Cafe Lover", interests: ["咖啡"] };
  const memory = buildMemoryPersonalization(profile);
  const dna = buildDnaPersonalization(profile);
  const results = runRecommendationPipeline({
    ctx: {
      surface: "explore",
      location: ORIGIN,
      categoryHint: "cafe",
      personalization: {
        weightSuggestions: [...memory.suggestions, ...dna.suggestions],
        preferenceSignals: [...memory.signals, ...dna.signals],
      },
    },
    inputs: PLACES,
    source: "explore",
    scoreFn: (cands, ctx) =>
      scoreCandidatesWithProfile(cands, ctx, { personalization: ctx.personalization }),
  });

  const cafe = results.find((r) => r.placeId === "cafe-a");
  assert.ok(cafe);
  const codes = cafe.reasons.map((r) => r.code);
  assert.ok(
    codes.some((c) => c === "dna_match" || c === "memory_match" || c === "open_now" || c === "high_rating"),
  );
  for (const r of cafe.reasons) {
    assert.ok(!/[\u4e00-\u9fff]/.test(r.code), "reason codes must be machine keys");
  }
});

console.info("\n[verify:rec-engine-r1-2] All checks passed — stop for review before R1.3.\n");
