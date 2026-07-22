#!/usr/bin/env node
/**
 * Recommendation Engine R0 契約驗證（不打真實 Places API）。
 * 執行：npm run verify:rec-engine-r0
 */
import assert from "node:assert/strict";
import {
  getRecommendationPipelineStages,
  getRecEngineMetrics,
  isRecEngineEnabled,
  RECOMMENDATION_PIPELINE_STAGES,
  resetRecEngineMetrics,
  runRecommendationPipeline,
  setRecEngineEnabledOverride,
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

/** 一般探索：距離優先於評價（非 food/night） */
const GENERAL_FIXTURE = [
  {
    id: "far-high",
    name: "遠方高分景點",
    lat: 25.05,
    lng: 121.58,
    rating: 4.9,
    userRatingCount: 2000,
    openStatus: "open",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
  },
  {
    id: "near-mid",
    name: "近處中分景點",
    lat: 25.034,
    lng: 121.566,
    rating: 4.2,
    userRatingCount: 100,
    openStatus: "open",
    primaryType: "park",
    types: ["park"],
  },
  {
    id: "near-closed",
    name: "近處已打烊",
    lat: 25.0335,
    lng: 121.5655,
    rating: 4.8,
    userRatingCount: 500,
    openStatus: "closed_now",
    primaryType: "museum",
    types: ["museum"],
  },
];

/** food：評價優先於距離 */
const FOOD_FIXTURE = [
  {
    id: "food-near-low",
    name: "近處普通餐廳",
    lat: 25.0331,
    lng: 121.5651,
    rating: 3.8,
    userRatingCount: 20,
    openStatus: "open",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
  {
    id: "food-far-high",
    name: "遠方高分餐廳",
    lat: 25.05,
    lng: 121.58,
    rating: 4.7,
    userRatingCount: 800,
    openStatus: "open",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
  {
    id: "food-mid",
    name: "中距中分餐廳",
    lat: 25.04,
    lng: 121.57,
    rating: 4.3,
    userRatingCount: 200,
    openStatus: "closing_soon",
    primaryType: "restaurant",
    types: ["restaurant"],
  },
];

/** night：與 food 相同比較鍵 */
const NIGHT_FIXTURE = [
  {
    id: "night-a",
    name: "夜店 A",
    lat: 25.04,
    lng: 121.57,
    rating: 4.1,
    userRatingCount: 50,
    openStatus: "open",
    primaryType: "night_club",
    types: ["night_club"],
  },
  {
    id: "night-b",
    name: "酒吧 B",
    lat: 25.0332,
    lng: 121.5652,
    rating: 4.6,
    userRatingCount: 300,
    openStatus: "open",
    primaryType: "bar",
    types: ["bar"],
  },
];

console.info("[verify:rec-engine-r0] Recommendation Engine R0\n");

test("default feature flag is OFF", () => {
  setRecEngineEnabledOverride(null);
  assert.equal(isRecEngineEnabled(), false);
});

test("override can enable / disable flag", () => {
  setRecEngineEnabledOverride(true);
  assert.equal(isRecEngineEnabled(), true);
  setRecEngineEnabledOverride(false);
  assert.equal(isRecEngineEnabled(), false);
  setRecEngineEnabledOverride(null);
});

test("pipeline stages match formal contract order (includes explain reserved)", () => {
  const stages = getRecommendationPipelineStages();
  assert.deepEqual([...stages], [
    "normalize",
    "filter",
    "deduplicate",
    "score",
    "rank",
    "diversify",
    "explain",
    "validate",
  ]);
  assert.deepEqual([...RECOMMENDATION_PIPELINE_STAGES], [...stages]);
});

test("pipeline executes all eight stages in order", () => {
  const seen = [];
  runRecommendationPipeline({
    ctx: { surface: "explore", location: ORIGIN },
    inputs: GENERAL_FIXTURE,
    source: "explore",
    onStage: (stage) => seen.push(stage),
  });
  assert.deepEqual(seen, [
    "normalize",
    "filter",
    "deduplicate",
    "score",
    "rank",
    "diversify",
    "explain",
    "validate",
  ]);
});

function assertEngineMatchesLegacy(label, places, categoryId, sortContext) {
  const legacy = sortExplorePlaces(
    places,
    ORIGIN,
    null,
    null,
    categoryId,
    sortContext,
  );

  setRecEngineEnabledOverride(false);
  resetRecEngineMetrics();
  const viaFlagOff = sortExplorePlacesViaRecEngine(
    places,
    ORIGIN,
    null,
    null,
    categoryId,
    sortContext,
  );
  assert.deepEqual(placeIds(viaFlagOff), placeIds(legacy), `${label}: flag OFF`);
  assert.equal(getRecEngineMetrics().lastPath, "legacy");

  setRecEngineEnabledOverride(true);
  resetRecEngineMetrics();
  const viaFlagOn = sortExplorePlacesViaRecEngine(
    places,
    ORIGIN,
    null,
    null,
    categoryId,
    sortContext,
  );
  assert.deepEqual(placeIds(viaFlagOn), placeIds(legacy), `${label}: flag ON`);
  assert.equal(getRecEngineMetrics().lastPath, "engine");
  assert.equal(getRecEngineMetrics().lastSurface, "explore");

  setRecEngineEnabledOverride(null);
}

test("Explore general: flag ON/OFF === sortExplorePlaces", () => {
  assertEngineMatchesLegacy("general", GENERAL_FIXTURE, "attraction");
});

test("Explore food: flag ON/OFF === sortExplorePlaces", () => {
  assertEngineMatchesLegacy("food", FOOD_FIXTURE, "food");
});

test("Explore night: flag ON/OFF === sortExplorePlaces", () => {
  assertEngineMatchesLegacy("night", NIGHT_FIXTURE, "night");
});

test("Explore Japan food branch: flag ON/OFF === sortExplorePlaces", () => {
  const japanFood = [
    {
      id: "jp-a",
      name: "一蘭",
      lat: 35.69,
      lng: 139.7,
      rating: 4.2,
      userRatingCount: 1000,
      openStatus: "open",
      primaryType: "ramen_restaurant",
      types: ["ramen_restaurant", "restaurant"],
    },
    {
      id: "jp-b",
      name: "すき家",
      lat: 35.691,
      lng: 139.701,
      rating: 3.9,
      userRatingCount: 500,
      openStatus: "open",
      primaryType: "restaurant",
      types: ["restaurant"],
    },
  ];
  assertEngineMatchesLegacy("japan-food", japanFood, "food", {
    country: "JP",
    cityLabel: "Tokyo",
    tabelogCache: null,
  });
});

test("engine path does not drop candidates (R0 pass-through stages)", () => {
  setRecEngineEnabledOverride(true);
  const out = sortExplorePlacesViaRecEngine(GENERAL_FIXTURE, ORIGIN, null, null, "attraction");
  assert.equal(out.length, GENERAL_FIXTURE.length);
  setRecEngineEnabledOverride(null);
});

console.info("\n[verify:rec-engine-r0] All checks passed — R0 ready for review.\n");
console.info("PIE Gateway Phase 1 remains closed. Stop before R1 (RAOS weights).");
