#!/usr/bin/env node
/**
 * Planner Integration P2.2
 * Flag ON：pickPlaceForSlot 依 pool 順序 + 約束；禁止 theme/rating 重排。
 *
 * 執行：npm run verify:rec-engine-planner-p2-2
 */
import assert from "node:assert/strict";
import {
  pickPlaceForSlot,
  resolveDayTheme,
} from "../src/lib/ai/ai-multi-day-planner.ts";
import { TripPlaceAllocator } from "../src/lib/ai/ai-trip-place-allocator.ts";
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
    userRatingCount: 100,
    ...partial,
  };
}

/** Engine 已排序：低評咖啡在前、高評景點在後；契約要求依序消費 */
const ORDERED_POOL = [
  place({
    id: "first-cafe",
    name: "First Cafe",
    lat: 25.034,
    lng: 121.566,
    rating: 3.9,
    primaryType: "cafe",
    types: ["cafe"],
  }),
  place({
    id: "second-museum",
    name: "Second Museum",
    lat: 25.031,
    lng: 121.512,
    rating: 4.9,
    primaryType: "museum",
    types: ["museum", "tourist_attraction"],
  }),
  place({
    id: "third-park",
    name: "Third Park",
    lat: 25.04,
    lng: 121.57,
    rating: 4.5,
    primaryType: "park",
    types: ["park"],
  }),
];

const cafeSlot = { time: "15:00", kind: "cafe", label: "咖啡" };
const attractionSlot = { time: "10:00", kind: "attraction", label: "景點" };

function emptyBudget() {
  return { cafe: 0, nightMarket: 0, mall: 0, shopping: 0 };
}

console.info("[verify:rec-engine-planner-p2-2] Planner Integration P2.2\n");

test("Flag ON: cafe slot picks first matching place in pool order (not highest rating)", () => {
  setRecEnginePlannerEnabledOverride(true);
  const allocator = new TripPlaceAllocator();
  const theme = resolveDayTheme("mixed", 0);
  const picked = pickPlaceForSlot({
    pool: ORDERED_POOL,
    slot: cafeSlot,
    theme,
    allocator,
    day: 1,
    budget: emptyBudget(),
  });
  assert.equal(picked?.id, "first-cafe");
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag ON: attraction slot skips cafe (meal/kind constraint) then takes next in order", () => {
  setRecEnginePlannerEnabledOverride(true);
  const allocator = new TripPlaceAllocator();
  const theme = resolveDayTheme("classic_landmarks", 0);
  const picked = pickPlaceForSlot({
    pool: ORDERED_POOL,
    slot: attractionSlot,
    theme,
    allocator,
    day: 1,
    budget: emptyBudget(),
  });
  // first-cafe fails attraction slot → second-museum (pool order), not re-ranked by theme/rating
  assert.equal(picked?.id, "second-museum");
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag ON: duplicate constraint skips already-used place, keeps pool order", () => {
  setRecEnginePlannerEnabledOverride(true);
  const allocator = new TripPlaceAllocator();
  const theme = resolveDayTheme("mixed", 0);
  const first = pickPlaceForSlot({
    pool: ORDERED_POOL,
    slot: cafeSlot,
    theme,
    allocator,
    day: 1,
    budget: emptyBudget(),
  });
  assert.equal(first?.id, "first-cafe");

  const secondCafeTry = pickPlaceForSlot({
    pool: ORDERED_POOL,
    slot: cafeSlot,
    theme,
    allocator,
    day: 1,
    budget: emptyBudget(),
  });
  // first-cafe used → no other cafe → undefined (does not invent reorder to museum)
  assert.equal(secondCafeTry, undefined);
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag OFF: legacy may prefer higher theme/rating fit over pool order", () => {
  setRecEnginePlannerEnabledOverride(false);
  const allocator = new TripPlaceAllocator();
  // Theme that strongly prefers museum keywords over cafe
  const theme = {
    theme: "test",
    preferKinds: ["attraction", "culture"],
    keywordRe: /Museum|博物/i,
  };
  const picked = pickPlaceForSlot({
    pool: ORDERED_POOL,
    slot: attractionSlot,
    theme,
    allocator,
    day: 1,
    budget: emptyBudget(),
  });
  // Legacy theme scoring should still prefer museum for attraction slot
  assert.equal(picked?.id, "second-museum");
  setRecEnginePlannerEnabledOverride(null);
});

test("Flag ON does not use rating to jump ahead in pool", () => {
  setRecEnginePlannerEnabledOverride(true);
  const highRatedLaterCafe = [
    place({
      id: "low-first",
      name: "Low Cafe",
      lat: 25.03,
      lng: 121.56,
      rating: 3.5,
      primaryType: "cafe",
      types: ["cafe"],
    }),
    place({
      id: "high-second",
      name: "High Cafe",
      lat: 25.031,
      lng: 121.561,
      rating: 4.9,
      primaryType: "cafe",
      types: ["cafe"],
    }),
  ];
  const allocator = new TripPlaceAllocator();
  const picked = pickPlaceForSlot({
    pool: highRatedLaterCafe,
    slot: cafeSlot,
    theme: resolveDayTheme("mixed", 0),
    allocator,
    day: 1,
    budget: emptyBudget(),
  });
  assert.equal(picked?.id, "low-first");
  setRecEnginePlannerEnabledOverride(null);
});

console.info("\n[verify:rec-engine-planner-p2-2] P2.2 passed — stop before P2.3.\n");
