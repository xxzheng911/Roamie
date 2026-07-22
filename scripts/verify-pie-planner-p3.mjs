#!/usr/bin/env node
/**
 * Planner Integration P3.1 — PIE Search Gateway
 *
 * - Flag 預設 OFF
 * - wrap 後 Flag OFF = legacy path；ON = pie path
 * - 行為對齊（同一注入 PlaceSearchFn）
 * - Planner 入口已接 wrap；Chat / Explore / Home 未改
 *
 * 執行：npm run verify:pie-planner-p3
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPlacesGatewayPlannerSearchStats,
  isPiePlannerSearchEnabled,
  resetPlacesGatewayPlannerSearchStats,
  resetPieMetrics,
  getPieMetricsSnapshot,
  setPiePlannerSearchEnabledOverride,
  wrapPlannerPlaceSearchViaGateway,
} from "../src/lib/pie/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

console.info("[verify:pie-planner-p3] Planner Integration P3.1 — PIE Search\n");

test("default planner-search flag is OFF", () => {
  setPiePlannerSearchEnabledOverride(null);
  assert.equal(isPiePlannerSearchEnabled(), false);
});

test("override can enable / disable planner-search flag", () => {
  setPiePlannerSearchEnabledOverride(true);
  assert.equal(isPiePlannerSearchEnabled(), true);
  setPiePlannerSearchEnabledOverride(false);
  assert.equal(isPiePlannerSearchEnabled(), false);
  setPiePlannerSearchEnabledOverride(null);
});

await testAsync("Flag OFF: wrap routes legacy; result parity with injected fn", async () => {
  setPiePlannerSearchEnabledOverride(false);
  resetPlacesGatewayPlannerSearchStats();
  resetPieMetrics();

  let calls = 0;
  const legacy = async () => {
    calls += 1;
    return { places: [{ id: "a", name: "A" }], error: null };
  };

  const wrapped = wrapPlannerPlaceSearchViaGateway(legacy);
  const result = await wrapped({ data: { lat: 1, lng: 2, locale: "zh-TW" } });

  assert.equal(calls, 1);
  assert.equal(result.places[0].id, "a");
  const stats = getPlacesGatewayPlannerSearchStats();
  assert.equal(stats.lastPlannerSearchPath, "legacy");
  assert.equal(stats.plannerSearch.legacy, 1);
  assert.equal(stats.plannerSearch.pie, 0);
  assert.equal(getPieMetricsSnapshot().byPath.legacy, 1);
});

await testAsync("Flag ON: wrap routes pie; result parity with injected fn", async () => {
  setPiePlannerSearchEnabledOverride(true);
  resetPlacesGatewayPlannerSearchStats();
  resetPieMetrics();

  let calls = 0;
  const legacy = async () => {
    calls += 1;
    return { places: [{ id: "b", name: "B" }], error: null };
  };

  const wrapped = wrapPlannerPlaceSearchViaGateway(legacy);
  const result = await wrapped({ data: { lat: 1, lng: 2, locale: "zh-TW" } });

  assert.equal(calls, 1);
  assert.equal(result.places[0].id, "b");
  const stats = getPlacesGatewayPlannerSearchStats();
  assert.equal(stats.lastPlannerSearchPath, "pie");
  assert.equal(stats.plannerSearch.pie, 1);
  assert.equal(stats.plannerSearch.legacy, 0);
  assert.equal(getPieMetricsSnapshot().byPath.pie, 1);
});

await testAsync("wrap is idempotent (no double metrics)", async () => {
  setPiePlannerSearchEnabledOverride(true);
  resetPlacesGatewayPlannerSearchStats();
  resetPieMetrics();

  const legacy = async () => ({ places: [{ id: "c" }], error: null });
  const once = wrapPlannerPlaceSearchViaGateway(legacy);
  const twice = wrapPlannerPlaceSearchViaGateway(once);
  assert.equal(once, twice);

  await twice({ data: { lat: 0, lng: 0, locale: "en" } });
  assert.equal(getPlacesGatewayPlannerSearchStats().plannerSearch.pie, 1);
});

test("planner entry points import wrapPlannerPlaceSearchViaGateway", () => {
  const itinerary = read("src/lib/ai/itinerary-place-fetch.ts");
  assert.match(itinerary, /wrapPlannerPlaceSearchViaGateway/);
  assert.match(itinerary, /from ["']@\/lib\/pie\/planner-search["']/);

  const tripPlanning = read("src/lib/ai/destination-trip-planning.ts");
  assert.match(tripPlanning, /wrapPlannerPlaceSearchViaGateway/);
  assert.match(tripPlanning, /from ["']@\/lib\/pie\/planner-search["']/);
});

test("Chat / Explore / Home search injection unchanged (no planner wrap)", () => {
  const chat = read("src/routes/_app.chat.tsx");
  assert.doesNotMatch(chat, /wrapPlannerPlaceSearchViaGateway/);

  const map = read("src/routes/_app.map.tsx");
  assert.doesNotMatch(map, /wrapPlannerPlaceSearchViaGateway/);

  const home = read("src/routes/_app.index.tsx");
  assert.doesNotMatch(home, /wrapPlannerPlaceSearchViaGateway/);
});

setPiePlannerSearchEnabledOverride(null);
console.info("\n[verify:pie-planner-p3] all checks passed");
