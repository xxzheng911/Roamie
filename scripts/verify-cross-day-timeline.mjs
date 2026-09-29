/**
 * Cross-day geographic repair must not leave two stops on the same clock.
 * Place membership stays; only affected days are retimed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeSameDayClockConflicts,
  repairCrossDayGeographicCohesion,
} from "../src/lib/ai/cross-day-geographic-cohesion.ts";
import {
  setItineraryValidatorEnabledOverride,
  shouldBlockItineraryDelivery,
  validateItineraryPlan,
} from "../src/lib/ai/itinerary-validator/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const X = { lat: 35.18, lng: 129.08 };
const Y = { lat: 35.05, lng: 129.03 };
const Z = { lat: 35.3, lng: 129.2 };

function near(origin, index) {
  return {
    lat: origin.lat + index * 0.0012,
    lng: origin.lng + index * 0.0011,
  };
}

function place(id, origin, index, extra = {}) {
  const point = near(origin, index);
  return {
    id,
    googlePlaceId: id,
    name: id,
    address: `${id} street`,
    lat: point.lat,
    lng: point.lng,
    rating: 4.6,
    userRatingCount: 90,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...extra,
  };
}

function stop(p, time, label = "景點") {
  return { time, label, name: p.name, place: p };
}

function run(plans, pace = "medium") {
  return repairCrossDayGeographicCohesion(plans, {
    generationId: "cross-day-timeline",
    stage: "final_pre_persistence",
    plannedDate: "2026-10-01",
    pace,
    logDiagnostics: false,
  });
}

function day(plans, number) {
  return plans.find((plan) => plan.day === number);
}

function ids(plans, number) {
  return day(plans, number).entries.map((entry) => entry.place.id);
}

function timesOf(plans, number) {
  return day(plans, number).entries.map((entry) => entry.time);
}

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function assertUniqueIncreasing(plan, label) {
  const clocks = plan.entries.map((entry) => entry.time);
  assert.equal(new Set(clocks).size, clocks.length, `${label} duplicate ${clocks.join(",")}`);
  for (let index = 1; index < clocks.length; index += 1) {
    assert.ok(
      minutes(clocks[index]) > minutes(clocks[index - 1]),
      `${label} not increasing ${clocks.join(",")}`,
    );
  }
}

function validationOf(plans) {
  setItineraryValidatorEnabledOverride(true);
  try {
    const result = validateItineraryPlan({
      plans,
      requestedDays: Math.max(plans.length, 1),
      destination: "Busan",
      creationPath: "selected_places",
      placeAuthority: "selected_only",
      style: "mixed",
      plannedDate: "2026-10-01",
      validationStage: "final",
      partialDays: plans.filter((plan) => plan.entries.length < 3).map((plan) => plan.day),
    });
    return {
      result,
      blocked: shouldBlockItineraryDelivery(result),
      fails: result.failedRules.map((rule) => rule.code),
    };
  } finally {
    setItineraryValidatorEnabledOverride(null);
  }
}

function timelineConflicts(plans) {
  return validationOf(plans).result.failedRules.filter((rule) => rule.code === "timeline_conflict");
}

function assertBlockedWithout(plans, forbidden) {
  const verdict = validationOf(plans);
  assert.equal(verdict.fails.includes("timeline_conflict"), true, verdict.fails.join(","));
  assert.equal(verdict.blocked, true, "delivery must stay blocked");
  for (const code of forbidden) {
    assert.equal(verdict.fails.includes(code), false, `must not create ${code}: ${verdict.fails.join(",")}`);
  }
  return verdict;
}

function productionPlans() {
  const A = place("A", Y, 0);
  const B = place("B", X, 0);
  const C = place("C", X, 1);
  const D = place("D", X, 2);
  const E = place("E", X, 3);
  const F = place("F", Y, 1);
  const G = place("G", X, 4);
  const H = place("H", Y, 2);
  const I = place("I", Y, 3);
  const J = place("J", Y, 4);
  return [
    {
      day: 1,
      entries: [stop(A, "09:30"), stop(B, "11:00"), stop(C, "13:00"), stop(D, "15:30"), stop(E, "18:00")],
    },
    {
      day: 2,
      entries: [stop(F, "09:30"), stop(G, "11:00"), stop(H, "13:00"), stop(I, "15:30"), stop(J, "18:00")],
    },
  ];
}

const beforeSwap = productionPlans();
const swapped = [
  {
    day: 1,
    entries: [
      beforeSwap[1].entries[1],
      beforeSwap[0].entries[1],
      beforeSwap[0].entries[2],
      beforeSwap[0].entries[3],
      beforeSwap[0].entries[4],
    ],
  },
  {
    day: 2,
    entries: [
      beforeSwap[1].entries[0],
      beforeSwap[0].entries[0],
      beforeSwap[1].entries[2],
      beforeSwap[1].entries[3],
      beforeSwap[1].entries[4],
    ],
  },
];
assert.deepEqual(timesOf(swapped, 1).slice(0, 2), ["11:00", "11:00"]);
assert.deepEqual(timesOf(swapped, 2).slice(0, 2), ["09:30", "09:30"]);
assert.ok(timelineConflicts(swapped).length >= 2, "old swap must still fail timeline_conflict");

for (const pace of ["slow", "medium", "active"]) {
  const repaired = run(productionPlans(), pace);
  assert.deepEqual(ids(repaired, 1), ["G", "B", "C", "D", "E"], `${pace} day 1 membership`);
  assert.deepEqual(ids(repaired, 2), ["F", "A", "H", "I", "J"], `${pace} day 2 membership`);
  assert.deepEqual(repaired.map((plan) => plan.entries.length), [5, 5], `${pace} counts`);
  assertUniqueIncreasing(day(repaired, 1), `${pace} day 1`);
  assertUniqueIncreasing(day(repaired, 2), `${pace} day 2`);
  assert.equal(timelineConflicts(repaired).length, 0, `${pace} timeline_conflict`);
  const allIds = repaired.flatMap((plan) => plan.entries.map((entry) => entry.place.id)).sort();
  assert.deepEqual(allIds, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
}

const cohesive = [
  {
    day: 1,
    entries: ["A", "B", "C", "D", "E"].map((id, index) =>
      stop(place(id, X, index), ["09:30", "11:00", "13:00", "15:30", "18:00"][index]),
    ),
  },
  {
    day: 2,
    entries: ["F", "G", "H", "I", "J"].map((id, index) =>
      stop(place(id, Y, index), ["09:30", "11:00", "13:00", "15:30", "18:00"][index]),
    ),
  },
];
const cohesiveBefore = cohesive.map((plan) => ({
  ids: plan.entries.map((entry) => entry.place.id),
  times: plan.entries.map((entry) => entry.time),
  entries: plan.entries,
}));
const cohesiveRepaired = run(cohesive, "medium");
cohesiveBefore.forEach((before, index) => {
  const plan = cohesiveRepaired[index];
  assert.deepEqual(plan.entries.map((entry) => entry.place.id), before.ids);
  assert.deepEqual(plan.entries.map((entry) => entry.time), before.times);
  plan.entries.forEach((entry, entryIndex) => {
    assert.equal(entry, before.entries[entryIndex], "untouched day must keep the same stop");
    assert.equal(entry.time, before.times[entryIndex]);
  });
});

const moveSource = ["S1", "S2", "S3", "S4", "S5"].map((id, index) =>
  stop(place(id, Y, index), ["10:00", "12:00", "14:00", "16:00", "18:00"][index]),
);
const mover = stop(place("MOVE", X, 5), "09:30");
const movePlans = [
  {
    day: 1,
    entries: ["T1", "T2", "T3", "T4", "T5"].map((id, index) =>
      stop(place(id, X, index), ["09:30", "11:00", "13:00", "15:30", "18:00"][index]),
    ),
  },
  { day: 2, entries: [mover, ...moveSource] },
];
const moved = run(movePlans, "medium");
assert.equal(ids(moved, 1).includes("MOVE"), true, "single stop moves to the destination day");
assert.equal(ids(moved, 2).includes("MOVE"), false);
assert.equal(day(moved, 1).entries.length, 6);
assert.equal(day(moved, 2).entries.length, 5);
assertUniqueIncreasing(day(moved, 1), "move destination");
assertUniqueIncreasing(day(moved, 2), "move source");
assert.equal(timelineConflicts(moved).length, 0);

const nightMarket = place("NIGHT", X, 0, {
  primaryType: "night_market",
  types: ["night_market"],
});
const nightlifePlans = [
  {
    day: 1,
    entries: [
      stop(place("NB", X, 1), "09:30"),
      stop(place("NC", X, 2), "12:00"),
      stop(place("ND", X, 3), "15:30"),
      stop(nightMarket, "19:00", "夜間"),
      stop(place("NOUT", Y, 0), "10:00"),
    ],
  },
  {
    day: 2,
    entries: [
      stop(place("NF", Y, 1), "09:30"),
      stop(place("NG", X, 4), "19:00"),
      stop(place("NH", Y, 2), "13:00"),
      stop(place("NI", Y, 3), "15:30"),
      stop(place("NJ", Y, 4), "18:00"),
    ],
  },
];
const nightlife = run(nightlifePlans, "medium");
const nightlifeDay = day(nightlife, 1);
assert.equal(ids(nightlife, 1).includes("NG"), true);
assert.equal(ids(nightlife, 1).includes("NIGHT"), true);
assert.equal(nightlifeDay.entries.find((entry) => entry.place.id === "NIGHT").time, "19:00");
const nineteen = nightlife.flatMap((plan) => plan.entries.filter((entry) => entry.time === "19:00"));
assert.equal(nineteen.length, 1, "normalization must not leave two 19:00 stops");
assertUniqueIncreasing(day(nightlife, 1), "nightlife day 1");
assertUniqueIncreasing(day(nightlife, 2), "nightlife day 2");

const lunch = place("LUNCH", X, 1, { primaryType: "restaurant", types: ["restaurant"] });
const dinner = place("DINNER", X, 2, { primaryType: "restaurant", types: ["restaurant"] });
const mealPlans = [
  {
    day: 1,
    entries: [
      stop(place("MB", X, 0), "09:30"),
      stop(lunch, "12:00", "午餐"),
      stop(place("MOUT", Y, 0), "15:00"),
      stop(place("MC", X, 3), "15:30"),
      stop(dinner, "18:30", "晚餐"),
    ],
  },
  {
    day: 2,
    entries: [
      stop(place("MF", Y, 1), "09:30"),
      stop(place("MG", X, 4), "12:00"),
      stop(place("MH", Y, 2), "13:00"),
      stop(place("MI", Y, 3), "16:00"),
      stop(place("MJ", Y, 4), "18:00"),
    ],
  },
];
const meals = run(mealPlans, "medium");
const mealDay = day(meals, 1);
assert.equal(ids(meals, 1).includes("MG"), true);
assert.equal(mealDay.entries.find((entry) => entry.place.id === "LUNCH").time, "12:00");
assert.equal(mealDay.entries.find((entry) => entry.place.id === "DINNER").time, "18:30");
assertUniqueIncreasing(mealDay, "meal day");
assert.equal(timelineConflicts(meals).length, 0);

const eightTimes = ["08:30", "09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "19:00"];
function eightDay(dayNumber, origin, outlierOrigin, outlierIndex, prefix) {
  const entries = eightTimes.map((time, index) => {
    const outlier = index === outlierIndex;
    return stop(
      place(`${prefix}${index}`, outlier ? outlierOrigin : origin, index),
      time,
    );
  });
  return { day: dayNumber, entries };
}
const eight = run(
  [
    eightDay(1, X, Y, 0, "P"),
    eightDay(2, Y, X, 2, "Q"),
  ],
  "active",
);
assert.deepEqual(eight.map((plan) => plan.entries.length), [8, 8]);
assert.equal(ids(eight, 1).includes("Q2"), true, "8-stop swap keeps the moved stop");
assert.equal(ids(eight, 2).includes("P0"), true);
assertUniqueIncreasing(day(eight, 1), "eight day 1");
assertUniqueIncreasing(day(eight, 2), "eight day 2");
assert.equal(timelineConflicts(eight).length, 0);

const partial = [
  ...cohesive,
  {
    day: 3,
    entries: [
      stop(place("PARTIAL_A", Z, 0), "10:00"),
      stop(place("PARTIAL_B", Z, 1), "16:00"),
    ],
  },
];
const partialRepaired = run(partial, "medium");
assert.deepEqual(timesOf(partialRepaired, 3), ["10:00", "16:00"]);
assert.equal(partialRepaired[2].entries[0], partial[2].entries[0]);
const partialCollision = normalizeSameDayClockConflicts([
  stop(place("PA", Z, 0), "11:00"),
  stop(place("PB", Z, 1), "11:00"),
], "2026-10-01");
assert.equal(partialCollision.safe, true);
assert.deepEqual(partialCollision.entries.map((entry) => entry.place.id), ["PA", "PB"]);
assertUniqueIncreasing({ entries: partialCollision.entries }, "partial collision");

const museum = (id, time) => stop(place(id, X, 0, {
  name: `${id} Museum`,
  primaryType: "museum",
  types: ["museum"],
  todayHoursLabel: "10:00-18:00",
}), time);
const closedMuseums = [museum("M1", "16:00"), museum("M2", "16:00"), museum("M3", "16:00"), museum("M4", "16:00")];
const closedBefore = closedMuseums.map((entry) => entry.time);
const closedNormalized = normalizeSameDayClockConflicts(closedMuseums, "2026-10-01", 1);
assert.equal(closedNormalized.safe, false);
assert.deepEqual(closedNormalized.entries.map((entry) => entry.time), closedBefore);
assert.equal(closedNormalized.entries.some((entry) => ["19:00", "20:00", "20:30"].includes(entry.time)), false);
assertBlockedWithout([{ day: 1, entries: closedNormalized.entries }], ["nightlife_timing", "meal_slot_category"]);

const night = (id, time) => stop(place(id, X, 1, {
  primaryType: "night_market",
  types: ["night_market"],
}), time, "夜間");
const nightlifeExhausted = ["N1", "N2", "N3", "N4"].map((id) => night(id, "19:00"));
const nightlifeNormalized = normalizeSameDayClockConflicts(nightlifeExhausted, "2026-10-01", 1);
assert.equal(nightlifeNormalized.safe, false);
assert.deepEqual(nightlifeNormalized.entries.map((entry) => entry.time), ["19:00", "19:00", "19:00", "19:00"]);
assert.equal(nightlifeNormalized.entries.some((entry) => minutes(entry.time) < 17 * 60 + 30), false);
assertBlockedWithout([{ day: 1, entries: nightlifeNormalized.entries }], ["nightlife_timing", "meal_slot_category"]);

const mealStop = (id, time, label) => stop(place(id, X, 2, {
  primaryType: "restaurant",
  types: ["restaurant"],
}), time, label);
const mealExhausted = [mealStop("L1", "12:00", "午餐"), mealStop("L2", "12:00", "午餐"), mealStop("L3", "12:00", "午餐")];
const mealNormalized = normalizeSameDayClockConflicts(mealExhausted, "2026-10-01", 1);
assert.equal(mealNormalized.safe, false);
assert.deepEqual(mealNormalized.entries.map((entry) => entry.time), ["12:00", "12:00", "12:00"]);
assertBlockedWithout([{ day: 1, entries: mealNormalized.entries }], ["meal_slot_category", "nightlife_timing"]);

const mixed = normalizeSameDayClockConflicts([
  stop(place("MS", X, 3), "09:30"),
  mealStop("ML", "12:00", "午餐"),
  stop(place("MD", X, 4), "12:00"),
  museum("MM", "16:00"),
  mealStop("MDN", "18:30", "晚餐"),
  night("MN", "19:00"),
], "2026-10-01", 1);
assert.equal(mixed.safe, true);
assertUniqueIncreasing({ entries: mixed.entries }, "mixed");
assert.equal(mixed.entries.find((entry) => entry.place.id === "ML").time, "12:00");
assert.equal(mixed.entries.find((entry) => entry.place.id === "MDN").time, "18:30");
assert.equal(mixed.entries.find((entry) => entry.place.id === "MN").time, "19:00");
assert.ok(minutes(mixed.entries.find((entry) => entry.place.id === "MM").time) < 19 * 60);
const mixedFails = validationOf([{ day: 1, entries: mixed.entries }]).fails;
assert.equal(mixedFails.includes("timeline_conflict"), false, mixedFails.join(","));
assert.equal(mixedFails.includes("nightlife_timing"), false, mixedFails.join(","));
assert.equal(mixedFails.includes("meal_slot_category"), false, mixedFails.join(","));

const eightUnsafe = normalizeSameDayClockConflicts(
  ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"].map((id) => night(id, "19:00")),
  "2026-10-01",
  1,
);
assert.equal(eightUnsafe.safe, false);
assert.equal(eightUnsafe.entries.every((entry) => entry.time === "19:00"), true);
assert.equal(eightUnsafe.entries.some((entry) => minutes(entry.time) < 17 * 60 + 30), false);

const validatorSource = read("src/lib/ai/itinerary-validator/validate.ts");
assert.match(validatorSource, /pushFail\(\s*failedRules,\s*"timeline_conflict"/);
assert.doesNotMatch(validatorSource, /timeline_conflict[\s\S]{0,80}severity:\s*"warning"/);
const telemetrySource = read("src/lib/analytics/itinerary-failure-telemetry.ts");
assert.match(telemetrySource, /timeline_conflicts/);
assert.match(telemetrySource, /selected_input_count/);
assert.match(telemetrySource, /usable_candidate_count/);
assert.match(telemetrySource, /delivered_place_count/);
assert.match(telemetrySource, /per_day_place_counts/);

console.log("cross-day timeline: PASS", {
  productionMembership: ["G,B,C,D,E", "F,A,H,I,J"],
  paces: ["slow", "medium", "active"],
  untouchedDayPreserved: true,
  singleMoveUnique: true,
  nightlife19Unique: true,
  mealClocksPreserved: true,
  eightStopUnique: true,
  partialDayPreserved: true,
  validatorRuleUnchanged: true,
});
