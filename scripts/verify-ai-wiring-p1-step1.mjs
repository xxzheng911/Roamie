#!/usr/bin/env node
/**
 * AI 接線 Priority 1 — Step 1
 * 僅驗證 Recommendation Engine（Planner Flag）。
 *
 * 本 Step 只開：
 *   VITE_REC_ENGINE_PLANNER_ENABLED=1
 *   或 localStorage: roamie:rec-engine-planner=1
 *
 * 必須保持 OFF：
 *   VITE_REC_ENGINE_VALIDATOR_ENABLED
 *   VITE_ITINERARY_VALIDATOR_ENABLED
 *   VITE_PIE_PLANNER_SEARCH_ENABLED
 *
 * 執行：npm run verify:ai-wiring-p1-step1
 *
 * 實機 Case 1–5 清單：
 *   docs/raos/ai-wiring-p1-step1-acceptance.md
 *
 * 實機全部 Pass 後才進 Step 2（Recommendation Validator）。
 */
import assert from "node:assert/strict";
import { isBurialOrFuneralPlace } from "../src/lib/burial-place-filter.ts";
import { distanceMeters } from "../src/lib/geo-distance.ts";
import {
  isPiePlannerSearchEnabled,
  setPiePlannerSearchEnabledOverride,
} from "../src/lib/pie/feature-flag-planner-search.ts";
import {
  isItineraryValidatorEnabled,
  setItineraryValidatorEnabledOverride,
} from "../src/lib/ai/itinerary-validator/feature-flag.ts";
import {
  applyPlannerHardConstraints,
  getRecEngineMetrics,
  isRecEngineValidatorEnabled,
  rankPlannerPlacesViaRecEngine,
  resetRecEngineMetrics,
  setRecEnginePlannerEnabledOverride,
  setRecEngineValidatorEnabledOverride,
} from "../src/lib/recommendation/engine/index.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function place(partial) {
  return {
    address: null,
    photoName: null,
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 120,
    rating: 4.4,
    lat: 25.033,
    lng: 121.565,
    ...partial,
  };
}

function collectTypes(p) {
  return [
    (p.primaryType ?? "").toLowerCase(),
    ...(p.types ?? []).map((t) => String(t).toLowerCase()),
  ];
}

function looksLikeSupermarket(p) {
  return collectTypes(p).some((t) =>
    ["supermarket", "hypermarket", "grocery_store", "convenience_store"].includes(t),
  );
}

const SCORING = {
  style: "mixed",
  days: 1,
  vibe: "either",
  pace: "medium",
  centerLat: 25.033,
  centerLng: 121.565,
  plusContext: null,
};

const POOL = [
  place({
    id: "ChIJcafemorning000000001",
    name: "Morning Cafe",
    primaryType: "cafe",
    types: ["cafe", "restaurant"],
    lat: 25.033,
    lng: 121.565,
    rating: 4.5,
  }),
  place({
    id: "ChIJattrmuseum0000000001",
    name: "City Museum",
    primaryType: "museum",
    types: ["museum", "tourist_attraction"],
    lat: 25.034,
    lng: 121.566,
    rating: 4.7,
    userRatingCount: 800,
  }),
  place({
    id: "ChIJrestlunch00000000001",
    name: "Lunch Bistro",
    primaryType: "restaurant",
    types: ["restaurant"],
    lat: 25.035,
    lng: 121.567,
    rating: 4.3,
  }),
  place({
    id: "ChIJattrpark000000000001",
    name: "Central Park",
    primaryType: "park",
    types: ["park"],
    lat: 25.036,
    lng: 121.568,
    rating: 4.2,
  }),
  place({
    id: "ChIJcafeafternoon0000001",
    name: "Afternoon Tea",
    primaryType: "cafe",
    types: ["cafe"],
    lat: 25.037,
    lng: 121.569,
    rating: 4.4,
  }),
  place({
    id: "ChIJrestdinner0000000001",
    name: "Dinner House",
    primaryType: "restaurant",
    types: ["restaurant"],
    lat: 25.038,
    lng: 121.57,
    rating: 4.6,
  }),
  place({
    id: "ChIJattrtemple0000000001",
    name: "Temple Walk",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    lat: 25.039,
    lng: 121.571,
    rating: 4.5,
  }),
  place({
    id: "ChIJattrriver00000000001",
    name: "River View",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    lat: 25.04,
    lng: 121.572,
    rating: 4.1,
  }),
  place({
    id: "ChIJattrmuseum0000000001",
    name: "City Museum Dup Id",
    primaryType: "museum",
    types: ["museum"],
    lat: 25.0342,
    lng: 121.5662,
  }),
  place({
    id: "ChIJcemeterycity00000001",
    name: "City Cemetery",
    primaryType: "cemetery",
    types: ["cemetery"],
    lat: 25.05,
    lng: 121.58,
  }),
  place({
    id: "ChIJsupermartbig00000001",
    name: "Big Supermarket",
    primaryType: "supermarket",
    types: ["supermarket"],
    lat: 25.0335,
    lng: 121.5655,
  }),
  place({
    id: "ChIJclosedshop0000000001",
    name: "Gone Forever Shop",
    primaryType: "store",
    types: ["store"],
    businessStatus: "CLOSED_PERMANENTLY",
    lat: 25.0332,
    lng: 121.5652,
  }),
];

console.info("[verify:ai-wiring-p1-step1] Priority 1 Step 1 — Planner Flag only\n");

setRecEnginePlannerEnabledOverride(true);
setRecEngineValidatorEnabledOverride(false);
setItineraryValidatorEnabledOverride(false);
setPiePlannerSearchEnabledOverride(false);

test("Step 1 isolation: Validator / Itinerary / PIE Search stay OFF", () => {
  assert.equal(isRecEngineValidatorEnabled(), false);
  assert.equal(isItineraryValidatorEnabled(), false);
  assert.equal(isPiePlannerSearchEnabled(), false);
});

test("hard constraints strip cemetery / retail / closed / duplicate ids", () => {
  const out = applyPlannerHardConstraints(POOL, "mixed");
  const ids = out.map((p) => p.id);
  assert.ok(!ids.includes("ChIJcemeterycity00000001"));
  assert.ok(!ids.includes("ChIJsupermartbig00000001"));
  assert.ok(!ids.includes("ChIJclosedshop0000000001"));
  assert.equal(ids.filter((id) => id === "ChIJattrmuseum0000000001").length, 1);
  assert.ok(
    ids.indexOf("ChIJcafemorning000000001") < ids.indexOf("ChIJattrmuseum0000000001"),
  );
});

test("Flag ON: rankPlannerPlacesViaRecEngine uses engine path", () => {
  resetRecEngineMetrics();
  const ranked = rankPlannerPlacesViaRecEngine(POOL, SCORING);
  assert.equal(getRecEngineMetrics().lastPath, "engine_planner_p2");
  assert.ok(ranked.length >= 5);
});

test("Flag ON ranked pool: no dup / cemetery / supermarket / closed", () => {
  const ranked = rankPlannerPlacesViaRecEngine(POOL, SCORING);
  const ids = ranked.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate place ids");
  for (const p of ranked) {
    assert.ok(!isBurialOrFuneralPlace(p), `cemetery leaked: ${p.name}`);
    assert.ok(!looksLikeSupermarket(p), `retail leaked: ${p.name}`);
    assert.notEqual(
      (p.businessStatus ?? "").toUpperCase(),
      "CLOSED_PERMANENTLY",
      `closed leaked: ${p.name}`,
    );
  }
});

test("Flag ON ranked pool keeps meal-capable categories (cafe + restaurant)", () => {
  const ranked = rankPlannerPlacesViaRecEngine(POOL, SCORING);
  const types = ranked.flatMap(collectTypes);
  assert.ok(types.some((t) => t === "cafe" || t === "coffee_shop"));
  assert.ok(types.some((t) => t === "restaurant"));
  assert.ok(
    types.some((t) => t === "museum" || t === "park" || t === "tourist_attraction"),
  );
});

test("Flag ON ranked pool is geographically clustered for same-day route", () => {
  const ranked = rankPlannerPlacesViaRecEngine(POOL, SCORING);
  let maxDist = 0;
  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      const a = ranked[i];
      const b = ranked[j];
      if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
      maxDist = Math.max(
        maxDist,
        distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }),
      );
    }
  }
  assert.ok(maxDist > 0);
  assert.ok(maxDist < 18_000, `pool span too large for same-day: ${Math.round(maxDist)}m`);
});

test("Flag OFF rollback still available (legacy path)", () => {
  setRecEnginePlannerEnabledOverride(false);
  resetRecEngineMetrics();
  rankPlannerPlacesViaRecEngine(POOL, SCORING);
  assert.equal(getRecEngineMetrics().lastPath, "legacy");
});

setRecEnginePlannerEnabledOverride(null);
setRecEngineValidatorEnabledOverride(null);
setItineraryValidatorEnabledOverride(null);
setPiePlannerSearchEnabledOverride(null);

console.info("\n[verify:ai-wiring-p1-step1] Step 1 automated checks passed.\n");
console.info("實機 Case 1–5（只開 Planner Flag）：");
console.info("  docs/raos/ai-wiring-p1-step1-acceptance.md");
console.info("  Case1 東京3天｜Case2 首爾4天｜Case3 排除條件｜Case4 Style差異｜Case5 Flag OFF回歸");
console.info("  全部 Pass 後才進 Step 2（Recommendation Validator）。\n");
