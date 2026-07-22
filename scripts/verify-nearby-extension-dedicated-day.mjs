#!/usr/bin/env node
/**
 * Nearby extension dedicated-day + requirements contract.
 * 東京 6 天 + 箱根／橫濱 → last day dedicated, no Tokyo mix.
 */
import assert from "node:assert/strict";
import {
  allocateNearbyExtensionDays,
  buildNearbyExtensionRequirements,
  evaluateNearbyExtensionPoolStatus,
  resolveNearbyExtensionDedicatedDay,
  NEARBY_EXTENSION_MIN_STOPS,
} from "../src/lib/ai/nearby-extension-requirements.ts";
import {
  applyPlannerRouteAndCapacityAssembly,
  buildDayPreferredPools,
  placeMatchesNearbyExtension,
  resolveNearbyExtensionDay,
} from "../src/lib/ai/planner-day-route-assembly.ts";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";

function place(partial) {
  const id = String(partial.id ?? Math.random())
    .replace(/[^A-Za-z0-9_-]/g, "")
    .padEnd(16, "x")
    .slice(0, 16);
  return {
    id: id.startsWith("ChIJ") ? id : `ChIJ${id}`,
    name: partial.name,
    address: partial.address ?? null,
    lat: partial.lat ?? null,
    lng: partial.lng ?? null,
    rating: 4.5,
    userRatingCount: 1000,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    destinationScope: partial.destinationScope,
    extensionDestination: partial.extensionDestination,
  };
}

const tokyo = [
  place({ id: "t1", name: "淺草寺", lat: 35.7148, lng: 139.7967, address: "東京都台東区" }),
  place({ id: "t2", name: "東京晴空塔", lat: 35.7101, lng: 139.8107, address: "東京都墨田区" }),
  place({ id: "t3", name: "明治神宮", lat: 35.6764, lng: 139.6993, address: "東京都渋谷区" }),
  place({ id: "t4", name: "新宿御苑", lat: 35.6852, lng: 139.7101, address: "東京都新宿区" }),
  place({ id: "t5", name: "上野公園", lat: 35.7142, lng: 139.7731, address: "東京都台東区" }),
  place({ id: "t6", name: "皇居外苑", lat: 35.6804, lng: 139.7531, address: "東京都千代田区" }),
  place({ id: "t7", name: "六本木之丘", lat: 35.6605, lng: 139.7292, address: "東京都港区" }),
  place({ id: "t8", name: "東京車站", lat: 35.6812, lng: 139.7671, address: "東京都千代田区" }),
  place({ id: "t9", name: "銀座", lat: 35.6717, lng: 139.7649, address: "東京都中央区" }),
  place({ id: "t10", name: "秋葉原", lat: 35.6984, lng: 139.7731, address: "東京都千代田区" }),
  place({ id: "t11", name: "豐洲市場", lat: 35.645, lng: 139.782, address: "東京都江東区" }),
  place({ id: "t12", name: "台場", lat: 35.629, lng: 139.775, address: "東京都港区" }),
];

const hakone = [
  place({
    id: "h1",
    name: "箱根神社",
    lat: 35.2065,
    lng: 139.0253,
    address: "神奈川県足柄下郡箱根町",
    destinationScope: "nearby_extension",
    extensionDestination: "箱根",
  }),
  place({
    id: "h2",
    name: "箱根海賊船",
    lat: 35.207,
    lng: 139.026,
    address: "箱根町元箱根",
    destinationScope: "nearby_extension",
    extensionDestination: "箱根",
  }),
  place({
    id: "h3",
    name: "箱根空中纜車",
    lat: 35.236,
    lng: 139.05,
    address: "箱根町強羅",
    destinationScope: "nearby_extension",
    extensionDestination: "箱根",
  }),
];

const yokohama = [
  place({
    id: "y1",
    name: "橫濱未來港",
    lat: 35.455,
    lng: 139.632,
    address: "横浜市西区",
    destinationScope: "nearby_extension",
    extensionDestination: "橫濱",
  }),
  place({
    id: "y2",
    name: "橫濱中華街",
    lat: 35.4427,
    lng: 139.646,
    address: "横浜市中区",
    destinationScope: "nearby_extension",
    extensionDestination: "橫濱",
  }),
  place({
    id: "y3",
    name: "橫濱紅磚倉庫",
    lat: 35.4525,
    lng: 139.6435,
    address: "横浜市中区",
    destinationScope: "nearby_extension",
    extensionDestination: "橫濱",
  }),
];

console.log("=== nearby extension dedicated day ===\n");

{
  const reqs = buildNearbyExtensionRequirements(["箱根", "箱根"]);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].normalizedDestination, "箱根");
  assert.equal(reqs[0].dedicatedDay, true);
  assert.equal(reqs[0].minimumStops, NEARBY_EXTENSION_MIN_STOPS);
}

{
  assert.equal(resolveNearbyExtensionDay(6), 6);
  assert.equal(resolveNearbyExtensionDedicatedDay(6), 6);
  const days = allocateNearbyExtensionDays(6, ["箱根", "橫濱"]);
  assert.equal(days.get("箱根"), 6);
  assert.equal(days.get("橫濱"), 5);
}

{
  const center = resolveDestinationApproxCenter("箱根");
  assert.ok(center, "箱根 approx center required");
  assert.ok(Math.abs(center.lat - 35.2324) < 0.05);
}

{
  assert.equal(
    placeMatchesNearbyExtension(hakone[0], ["箱根"]),
    "箱根",
  );
  assert.equal(placeMatchesNearbyExtension(tokyo[0], ["箱根"]), null);
}

// Case A: 箱根 dedicated Day 6, no Tokyo mix
{
  const pool = [...tokyo, ...hakone];
  const preferred = buildDayPreferredPools(pool, 6, ["箱根"]);
  const nearbyDay = resolveNearbyExtensionDay(6);
  assert.equal(nearbyDay, 6);
  const day6 = preferred.get(6) ?? [];
  assert.ok(
    day6.every((p) => placeMatchesNearbyExtension(p, ["箱根"])),
    "Day 6 preferred pool must be Hakone-only",
  );
  assert.ok(day6.length >= 2);

  const plans = [];
  for (let d = 1; d <= 6; d += 1) {
    const entries = (preferred.get(d) ?? []).slice(0, 3).map((p) => ({
      time: "10:00",
      label: "景點",
      name: p.name,
      place: p,
    }));
    // Pollute day 2 with Hakone
    if (d === 2) {
      entries.push({
        time: "15:00",
        label: "景點",
        name: hakone[0].name,
        place: hakone[0],
      });
    }
    plans.push({ day: d, entries });
  }

  const result = applyPlannerRouteAndCapacityAssembly({
    plans,
    pool,
    days: 6,
    style: "mixed",
    nearbyExtensions: ["箱根"],
    pace: "medium",
  });

  const day6Plan = result.plans.find((p) => p.day === 6);
  assert.ok(day6Plan);
  assert.ok(day6Plan.entries.length >= 2, `Hakone day stops=${day6Plan.entries.length}`);
  for (const e of day6Plan.entries) {
    assert.ok(
      placeMatchesNearbyExtension(e.place, ["箱根"]),
      `Day 6 must not mix Tokyo: ${e.name}`,
    );
  }
  for (const plan of result.plans) {
    if (plan.day === 6) continue;
    for (const e of plan.entries) {
      assert.equal(
        placeMatchesNearbyExtension(e.place, ["箱根"]),
        null,
        `Tokyo day ${plan.day} must not keep Hakone: ${e.name}`,
      );
    }
  }
  console.log("  ✓ Case A: 東京 6 天 + 箱根 dedicated Day 6");
}

// Case B: 橫濱 dedicated Day 6
{
  const pool = [...tokyo, ...yokohama];
  const result = applyPlannerRouteAndCapacityAssembly({
    plans: Array.from({ length: 6 }, (_, i) => ({
      day: i + 1,
      entries: tokyo.slice(i * 2, i * 2 + 2).map((p) => ({
        time: "10:00",
        label: "景點",
        name: p.name,
        place: p,
      })),
    })),
    pool,
    days: 6,
    style: "mixed",
    nearbyExtensions: ["橫濱"],
  });
  const day6 = result.plans.find((p) => p.day === 6);
  assert.ok(day6.entries.length >= 2);
  assert.ok(day6.entries.every((e) => placeMatchesNearbyExtension(e.place, ["橫濱"])));
  console.log("  ✓ Case B: 東京 6 天 + 橫濱 dedicated Day 6");
}

{
  const status = evaluateNearbyExtensionPoolStatus({
    extension: "箱根",
    candidateCount: 1,
  });
  assert.equal(status.enough, false);
  assert.equal(status.requiredStops, 2);
  console.log("  ✓ insufficient pool status when < 2 stops");
}

console.log("\nverify-nearby-extension-dedicated-day: ok");
