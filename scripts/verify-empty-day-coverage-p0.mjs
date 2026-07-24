/**
 * P0: 6-day itinerary must not leave Day 6 empty when stops are sufficient.
 * Fukuoka-shaped: 16 stops → must cover all days (e.g. 3,3,3,3,2,2).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPlannerRouteAndCapacityAssembly,
} from "../src/lib/ai/planner-day-route-assembly.ts";
import {
  ensureAllDaysCovered,
  evaluateDayCoverageGate,
  normalizeCompleteDayMap,
  repairDailyDiversityByMove,
} from "../src/lib/ai/itinerary-day-coverage.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
import {
  validateItineraryPlan,
  dayCountsOfPlans,
  setItineraryValidatorEnabledOverride,
} from "../src/lib/ai/itinerary-validator/index.ts";
import { ensureEveryDayPopulated } from "../src/lib/ai/ai-multi-day-planner.ts";

function place(i, opts = {}) {
  const lat0 = 33.59;
  const lng0 = 130.4;
  return {
    id: opts.id ?? `ChIJ_fukuoka_${i}`,
    name: opts.name ?? `福岡景點${i}`,
    lat: opts.lat ?? lat0 + (i % 5) * 0.01,
    lng: opts.lng ?? lng0 + Math.floor(i / 5) * 0.01,
    address: opts.address ?? "福岡市",
    primaryType: opts.primaryType ?? "tourist_attraction",
    types: opts.types ?? ["tourist_attraction"],
    rating: 4.4,
    userRatingCount: 200,
  };
}

function entry(p, time = "10:00") {
  return { time, label: "景點", name: p.name, place: p };
}

test("ensureAllDaysCovered: 4,3,3,3,3,0 with 16 stops → no empty day", () => {
  const pool = Array.from({ length: 16 }, (_, i) => place(i + 1));
  const plans = [
    { day: 1, entries: pool.slice(0, 4).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 2, entries: pool.slice(4, 7).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 3, entries: pool.slice(7, 10).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 4, entries: pool.slice(10, 13).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 5, entries: pool.slice(13, 16).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 6, entries: [] },
  ];
  const { plans: covered, emptyDaysRemaining } = ensureAllDaysCovered({
    plans,
    tripDays: 6,
    source: "test",
  });
  const counts = covered.map((p) => p.entries.length);
  assert.equal(emptyDaysRemaining.length, 0, `empty remaining=${emptyDaysRemaining}`);
  assert.ok(counts.every((c) => c >= 2), `each day ≥2, got ${counts.join(",")}`);
  assert.equal(counts.reduce((a, b) => a + b, 0), 16);
  assert.notDeepEqual(counts, [4, 3, 3, 3, 3, 0]);
});

test("assembly: packed early days must not leave Day 6 empty", () => {
  const pool = Array.from({ length: 16 }, (_, i) =>
    place(i + 1, {
      primaryType: i % 5 === 0 ? "museum" : "tourist_attraction",
      types: i % 5 === 0 ? ["museum"] : ["tourist_attraction"],
    }),
  );
  const seeded = [
    { day: 1, entries: pool.slice(0, 4).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 2, entries: pool.slice(4, 7).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 3, entries: pool.slice(7, 10).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 4, entries: pool.slice(10, 13).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 5, entries: pool.slice(13, 16).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 6, entries: [] },
  ];
  const assembled = applyPlannerRouteAndCapacityAssembly({
    plans: seeded,
    pool,
    days: 6,
    style: "classic_landmarks",
    pace: "medium",
  });
  const counts = assembled.diagnostics.map((d) => d.finalPlaceCount);
  assert.ok(
    counts.every((c) => c > 0),
    `assembly must cover all days, got ${counts.join(",")}`,
  );
  assert.notEqual(counts[5], 0, "Day 6 must not be empty");
});

test("Auto Repair: missing_days 4,3,3,3,3,0 must change dayCounts", () => {
  setItineraryValidatorEnabledOverride(true);
  const pool = Array.from({ length: 16 }, (_, i) => place(i + 1));
  const plans = [
    { day: 1, entries: pool.slice(0, 4).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 2, entries: pool.slice(4, 7).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 3, entries: pool.slice(7, 10).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 4, entries: pool.slice(10, 13).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 5, entries: pool.slice(13, 16).map((p, i) => entry(p, `${10 + i}:00`)) },
    { day: 6, entries: [] },
  ];
  const initial = validateItineraryPlan({
    plans,
    requestedDays: 6,
    style: "classic_landmarks",
    plannedDate: "2026-08-01",
    destination: "福岡",
  });
  assert.equal(initial.pass, false);
  assert.ok(initial.failedRules.some((r) => r.code === "missing_days"));

  const outcome = replanUntilItineraryValid(
    {
      plans,
      pool,
      days: 6,
      style: "classic_landmarks",
      plannedDate: "2026-08-01",
      validatorInput: {
        requestedDays: 6,
        style: "classic_landmarks",
        plannedDate: "2026-08-01",
        destination: "福岡",
      },
    },
    initial,
  );
  const counts = dayCountsOfPlans(outcome.plans);
  assert.notDeepEqual(
    counts,
    [4, 3, 3, 3, 3, 0],
    "replan must not reuse failed day map",
  );
  assert.ok(counts.every((c) => c > 0), `no empty days after repair: ${counts.join(",")}`);
  assert.ok(
    !outcome.validation.failedRules.some((r) => r.code === "missing_days"),
    `missing_days must be repaired, failed=${outcome.validation.failedRules.map((r) => r.code)}`,
  );
  setItineraryValidatorEnabledOverride(null);
});

test("daily diversity repair moves second museum off the day", () => {
  const museumA = place(1, {
    name: "福岡市博物館",
    primaryType: "museum",
    types: ["museum"],
  });
  const museumB = place(2, {
    name: "九州國立博物館",
    primaryType: "museum",
    types: ["museum"],
  });
  const shrine = place(3, {
    name: "櫛田神社",
    primaryType: "shinto_shrine",
    types: ["place_of_worship", "shinto_shrine"],
  });
  const park = place(4, {
    name: "大濠公園",
    primaryType: "park",
    types: ["park", "tourist_attraction"],
    lat: 33.586,
    lng: 130.376,
  });
  const plans = [
    { day: 1, entries: [entry(shrine), entry(museumA), entry(museumB)] },
    { day: 2, entries: [entry(park)] },
    { day: 3, entries: [entry(place(5))] },
    { day: 4, entries: [entry(place(6))] },
    { day: 5, entries: [entry(place(7))] },
    { day: 6, entries: [entry(place(8))] },
  ];
  const { plans: fixed, moved } = repairDailyDiversityByMove({
    plans,
    tripDays: 6,
    style: "classic_landmarks",
  });
  assert.ok(moved >= 1, "must move at least one museum");
  const day1Museums = fixed[0].entries.filter((e) =>
    (e.place.types ?? []).includes("museum"),
  ).length;
  assert.ok(day1Museums <= 1, `day1 museums=${day1Museums}`);
});

test("coverage gate blocks empty days", () => {
  const plans = normalizeCompleteDayMap(
    [
      { day: 1, entries: [entry(place(1)), entry(place(2))] },
      { day: 2, entries: [] },
    ],
    2,
  );
  const gate = evaluateDayCoverageGate({ plans, tripDays: 2 });
  assert.equal(gate.allDaysCovered, false);
  assert.deepEqual(gate.emptyDays, [2]);
});

test("ensureEveryDayPopulated redistributes 16 stops across 6 days", () => {
  const pool = Array.from({ length: 16 }, (_, i) => place(i + 1));
  const seeded = [
    { day: 1, entries: pool.slice(0, 4).map((p) => entry(p)) },
    { day: 2, entries: pool.slice(4, 7).map((p) => entry(p)) },
    { day: 3, entries: pool.slice(7, 10).map((p) => entry(p)) },
    { day: 4, entries: pool.slice(10, 13).map((p) => entry(p)) },
    { day: 5, entries: pool.slice(13, 16).map((p) => entry(p)) },
    { day: 6, entries: [] },
  ];
  const ensured = ensureEveryDayPopulated({
    plans: seeded,
    pool,
    days: 6,
    style: "classic_landmarks",
    plannedDate: "2026-08-01",
  });
  const counts = ensured.map((p) => p.entries.length);
  assert.ok(counts.every((c) => c > 0), `got ${counts.join(",")}`);
  assert.equal(counts.length, 6);
});
