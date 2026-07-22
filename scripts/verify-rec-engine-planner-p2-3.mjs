#!/usr/bin/env node
/**
 * Planner Integration P2.3
 * Local life / Classic / rankByQuality：Flag ON 不重排，僅約束／保留順序。
 *
 * 執行：npm run verify:rec-engine-planner-p2-3
 */
import assert from "node:assert/strict";
import { buildLocalLifeCandidatePools } from "../src/lib/ai/ai-local-life-rules.ts";
import { sortClassicLandmarkPlaces } from "../src/lib/ai/ai-classic-landmark-rules.ts";
import {
  setRecEnginePlannerEnabledOverride,
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
    userRatingCount: 50,
    lat: 25.03,
    lng: 121.56,
    ...partial,
  };
}

const MIXED = [
  place({
    id: "low-cafe",
    name: "Low Cafe",
    rating: 3.5,
    userRatingCount: 10,
    primaryType: "cafe",
    types: ["cafe"],
  }),
  place({
    id: "high-museum",
    name: "High Museum",
    rating: 4.9,
    userRatingCount: 2000,
    primaryType: "museum",
    types: ["museum", "tourist_attraction"],
  }),
  place({
    id: "mid-market",
    name: "Local Market",
    rating: 4.2,
    userRatingCount: 300,
    primaryType: "market",
    types: ["market"],
  }),
];

console.info("[verify:rec-engine-planner-p2-3] Planner Integration P2.3\n");

test("Local life Flag ON: buildLocalLifeCandidatePools preserves input order", () => {
  setRecEnginePlannerEnabledOverride(true);
  const pools = buildLocalLifeCandidatePools(MIXED);
  const ids = pools.all.map((p) => p.id);
  // filtered to local-life candidates but relative order of survivors preserved
  assert.ok(ids.includes("low-cafe"));
  assert.ok(ids.indexOf("low-cafe") < ids.indexOf("mid-market") || !ids.includes("mid-market"));
  // low-cafe before high-museum if both kept
  if (ids.includes("low-cafe") && ids.includes("high-museum")) {
    assert.ok(ids.indexOf("low-cafe") < ids.indexOf("high-museum"));
  }
  setRecEnginePlannerEnabledOverride(null);
});

test("Local life Flag OFF: may reorder by scoreLocalLifeCandidate", () => {
  setRecEnginePlannerEnabledOverride(false);
  const pools = buildLocalLifeCandidatePools(MIXED);
  assert.ok(pools.all.length >= 1);
  setRecEnginePlannerEnabledOverride(null);
});

test("Classic Flag ON: sortClassicLandmarkPlaces is identity (no priority reorder)", () => {
  setRecEnginePlannerEnabledOverride(true);
  const input = [
    place({
      id: "a-park",
      name: "Small Park",
      rating: 3.0,
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "b-landmark",
      name: "Famous Landmark Tower",
      rating: 4.8,
      userRatingCount: 5000,
      primaryType: "tourist_attraction",
      types: ["tourist_attraction", "landmark"],
    }),
  ];
  const out = sortClassicLandmarkPlaces(input);
  assert.deepEqual(
    out.map((p) => p.id),
    input.map((p) => p.id),
  );
  setRecEnginePlannerEnabledOverride(null);
});

test("Classic Flag OFF: sortClassicLandmarkPlaces may reorder by priority", () => {
  setRecEnginePlannerEnabledOverride(false);
  const input = [
    place({
      id: "a-park",
      name: "Small Park",
      rating: 3.0,
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "b-landmark",
      name: "Famous Landmark Tower",
      rating: 4.8,
      userRatingCount: 5000,
      primaryType: "tourist_attraction",
      types: ["tourist_attraction", "landmark"],
    }),
  ];
  const out = sortClassicLandmarkPlaces(input);
  assert.equal(out.length, 2);
  // landmark typically ranks above plain park under legacy scoring
  assert.equal(out[0].id, "b-landmark");
  setRecEnginePlannerEnabledOverride(null);
});

console.info("\n[verify:rec-engine-planner-p2-3] P2.3 passed.\n");
