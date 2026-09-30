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

const HOME = { lat: 22.1987, lng: 113.5439 };
const AWAY = { lat: 22.4, lng: 113.7 };
const SEOUL = { lat: 37.5665, lng: 126.978 };
const SEOUL_AWAY = { lat: 37.48, lng: 127.05 };

function at(id, origin, index, time, label = "景點", extra = {}) {
  return stop(place(id, origin, index, extra), time, label);
}

function restaurant(id, origin, index, time, label) {
  return at(id, origin, index, time, label, {
    primaryType: "restaurant",
    types: ["restaurant"],
  });
}

function idsOf(plans) {
  return plans.flatMap((plan) => plan.entries.map((entry) => entry.place.id)).sort();
}

function assertSamePlaces(before, after, label) {
  assert.deepEqual(idsOf(after), idsOf(before), `${label} place multiset`);
  assert.equal(new Set(idsOf(after)).size, idsOf(after).length, `${label} duplicate place`);
}

function assertPolicyClocks(plan, label) {
  const clocks = plan.entries.map((entry) => entry.time);
  assert.equal(new Set(clocks).size, clocks.length, `${label} duplicate clock ${clocks.join(",")}`);
  const sorted = [...plan.entries].sort((left, right) => minutes(left.time) - minutes(right.time));
  const again = normalizeSameDayClockConflicts(sorted, "2026-10-01");
  assert.equal(again.safe, true, `${label} existing policy rejected ${clocks.join(",")}`);
  assert.deepEqual(
    again.entries.map((entry) => entry.time),
    sorted.map((entry) => entry.time),
    `${label} clocks moved by existing policy`,
  );
}

function observe(plans, pace = "medium") {
  const outcome = { status: "not_called" };
  const first = repairCrossDayGeographicCohesion(plans, {
    generationId: "timeline-cohesion",
    stage: "final_pre_persistence",
    plannedDate: "2026-10-01",
    pace,
    logDiagnostics: false,
    normalizationOutcome: outcome,
  });
  const second = run(plans, pace);
  const third = run(plans, pace);
  assert.deepEqual(
    first.map((plan) => plan.entries.map((entry) => [entry.place.id, entry.time])),
    second.map((plan) => plan.entries.map((entry) => [entry.place.id, entry.time])),
  );
  assert.deepEqual(
    second.map((plan) => plan.entries.map((entry) => [entry.place.id, entry.time])),
    third.map((plan) => plan.entries.map((entry) => [entry.place.id, entry.time])),
  );
  return { plans: first, outcome };
}

function clusterDay(dayNumber, home, away, slots) {
  return {
    day: dayNumber,
    entries: slots.map((slot, index) => {
      if (slot.meal) return restaurant(slot.id, slot.origin, slot.index, slot.time, slot.meal);
      return at(slot.id, slot.origin, slot.index, slot.time, slot.label ?? "景點", slot.extra ?? {});
    }),
  };
}

function macauPlans() {
  return [
    clusterDay(1, HOME, AWAY, [
      { id: "PeninsulaMorning", origin: HOME, index: 0, time: "09:30" },
      { id: "HarbourLunch", origin: HOME, index: 1, time: "12:00", meal: "午餐" },
      { id: "FortressDinner", origin: HOME, index: 2, time: "18:30", meal: "晚餐" },
      { id: "Umpton", origin: AWAY, index: 0, time: "16:00" },
      { id: "NightDinner", origin: HOME, index: 3, time: "18:30", meal: "晚餐" },
    ]),
    clusterDay(2, HOME, AWAY, [
      { id: "Paxley", origin: AWAY, index: 1, time: "09:30" },
      { id: "Crowe", origin: AWAY, index: 2, time: "11:00" },
      { id: "MovedLunch", origin: HOME, index: 5, time: "12:00", meal: "午餐" },
      { id: "Vesper", origin: AWAY, index: 3, time: "14:00" },
      { id: "Dobson", origin: AWAY, index: 4, time: "17:00" },
    ]),
    clusterDay(3, HOME, AWAY, [
      { id: "Quinzel", origin: AWAY, index: 5, time: "09:30" },
      { id: "Harlow", origin: AWAY, index: 6, time: "11:00" },
      { id: "Fenton", origin: AWAY, index: 7, time: "14:00" },
      { id: "Marlow", origin: AWAY, index: 8, time: "16:00" },
      { id: "Nestor", origin: AWAY, index: 9, time: "19:00" },
    ]),
  ];
}

const macauInput = macauPlans();
const macauSwapped = [
  macauInput[0].entries[0],
  macauInput[0].entries[1],
  macauInput[0].entries[2],
  macauInput[1].entries[2],
  macauInput[0].entries[4],
];
const macauBaselineFailures = [];
const macauBaseline = normalizeSameDayClockConflicts(
  macauSwapped,
  "2026-10-01",
  1,
  (failure) => macauBaselineFailures.push(failure),
);
assert.equal(macauBaseline.safe, false, "array-order baseline must be unsafe");
assert.equal(macauBaselineFailures.length, 1);
assert.equal(macauBaselineFailures[0].failedTime, "12:00");
assert.equal(macauBaselineFailures[0].evaluated, 14);
assert.equal(macauBaselineFailures[0].order, 11);
assert.equal(macauBaselineFailures[0].used, 0);
assert.equal(macauBaselineFailures[0].closed, 0);
assert.equal(macauBaselineFailures[0].window, 3);
const macauBaselineVerdict = validationOf([
  { day: 1, entries: macauSwapped },
  macauInput[1],
  macauInput[2],
]);
assert.equal(macauBaselineVerdict.fails.includes("timeline_conflict"), true, macauBaselineVerdict.fails.join(","));
assert.equal(macauBaselineVerdict.result.pass, false);

const macau = observe(macauInput);
assert.equal(macau.outcome.status, "safe");
assert.equal(macau.outcome.failures, undefined);
assert.deepEqual(macau.outcome.affectedDays, [1, 2]);
assert.deepEqual(ids(macau.plans, 1), [
  "PeninsulaMorning",
  "HarbourLunch",
  "FortressDinner",
  "MovedLunch",
  "NightDinner",
]);
assert.deepEqual(ids(macau.plans, 2), [
  "Paxley",
  "Crowe",
  "Umpton",
  "Vesper",
  "Dobson",
]);
assert.deepEqual(ids(macau.plans, 3), [
  "Quinzel",
  "Harlow",
  "Fenton",
  "Marlow",
  "Nestor",
]);
assert.deepEqual(macau.plans.map((plan) => plan.entries.length), [5, 5, 5]);
assertSamePlaces(macauInput, macau.plans, "macau");
for (const plan of macau.plans) assertPolicyClocks(plan, `macau day ${plan.day}`);
const macauVerdict = validationOf(macau.plans);
assert.equal(macauVerdict.fails.includes("timeline_conflict"), false, macauVerdict.fails.join(","));
assert.equal(macauVerdict.result.pass, true, macauVerdict.fails.join(","));
assert.equal(macauVerdict.blocked, false);

function seoulShape(homeSlots, incoming) {
  const awayFill = [
    { id: "SeoulAwayA", origin: SEOUL_AWAY, index: 1, time: "09:30" },
    { id: "SeoulAwayB", origin: SEOUL_AWAY, index: 2, time: "11:00" },
    incoming,
    { id: "SeoulAwayC", origin: SEOUL_AWAY, index: 3, time: "14:00" },
    { id: "SeoulAwayD", origin: SEOUL_AWAY, index: 4, time: "17:00" },
  ];
  return [
    clusterDay(1, SEOUL, SEOUL_AWAY, homeSlots),
    clusterDay(2, SEOUL, SEOUL_AWAY, awayFill),
    clusterDay(3, SEOUL, SEOUL_AWAY, [
      { id: "SeoulAwayE", origin: SEOUL_AWAY, index: 5, time: "09:30" },
      { id: "SeoulAwayF", origin: SEOUL_AWAY, index: 6, time: "11:00" },
      { id: "SeoulAwayG", origin: SEOUL_AWAY, index: 7, time: "14:00" },
      { id: "SeoulAwayH", origin: SEOUL_AWAY, index: 8, time: "16:00" },
      { id: "SeoulAwayI", origin: SEOUL_AWAY, index: 9, time: "19:00" },
    ]),
  ];
}

function assertSeoulCommitted(name, plans, movedId) {
  const observed = observe(plans);
  assert.equal(observed.outcome.status, "safe", name);
  assert.equal(observed.outcome.failures, undefined, name);
  assert.equal(ids(observed.plans, 1).includes(movedId), true, `${name} did not commit the feasible move`);
  assertSamePlaces(plans, observed.plans, name);
  assert.deepEqual(observed.plans.map((plan) => plan.entries.length), [5, 5, 5], name);
  for (const plan of observed.plans) assertPolicyClocks(plan, `${name} day ${plan.day}`);
  const verdict = validationOf(observed.plans);
  assert.equal(verdict.fails.includes("timeline_conflict"), false, `${name} ${verdict.fails.join(",")}`);
  assert.equal(verdict.result.pass, true, `${name} ${verdict.fails.join(",")}`);
}

assertSeoulCommitted("seoul lunch duplicate", seoulShape([
  { id: "SeoulMorning", origin: SEOUL, index: 0, time: "09:30" },
  { id: "SeoulLunch", origin: SEOUL, index: 1, time: "12:00", meal: "午餐" },
  { id: "SeoulAfternoon", origin: SEOUL, index: 2, time: "15:30" },
  { id: "SeoulDinner", origin: SEOUL, index: 3, time: "18:30", meal: "晚餐" },
  { id: "SeoulOutLunch", origin: SEOUL_AWAY, index: 0, time: "16:00" },
], { id: "SeoulMovedLunch", origin: SEOUL, index: 5, time: "12:00", meal: "午餐" }), "SeoulMovedLunch");

assertSeoulCommitted("seoul dinner duplicate", seoulShape([
  { id: "SeoulMorningD", origin: SEOUL, index: 0, time: "09:30" },
  { id: "SeoulLunchD", origin: SEOUL, index: 1, time: "12:00", meal: "午餐" },
  { id: "SeoulDinnerD", origin: SEOUL, index: 2, time: "18:30", meal: "晚餐" },
  { id: "SeoulLateD", origin: SEOUL, index: 3, time: "20:30" },
  { id: "SeoulOutDinner", origin: SEOUL_AWAY, index: 0, time: "16:00" },
], { id: "SeoulMovedDinner", origin: SEOUL, index: 5, time: "18:30", meal: "晚餐" }), "SeoulMovedDinner");

assertSeoulCommitted("seoul lunch and dinner duplicate", seoulShape([
  { id: "SeoulMorningB", origin: SEOUL, index: 0, time: "09:30" },
  { id: "SeoulLunchB", origin: SEOUL, index: 1, time: "12:00", meal: "午餐" },
  { id: "SeoulDinnerB", origin: SEOUL, index: 2, time: "18:30", meal: "晚餐" },
  { id: "SeoulOutBoth", origin: SEOUL_AWAY, index: 0, time: "16:00" },
  { id: "IvySupper", origin: SEOUL, index: 3, time: "18:30", meal: "晚餐" },
], { id: "SeoulMovedBoth", origin: SEOUL, index: 5, time: "12:00", meal: "午餐" }), "SeoulMovedBoth");

assertSeoulCommitted("seoul meal after later meal", seoulShape([
  { id: "SeoulEarly", origin: SEOUL, index: 0, time: "09:30" },
  { id: "SeoulLateDinner", origin: SEOUL, index: 1, time: "18:30", meal: "晚餐" },
  { id: "SeoulOutAfter", origin: SEOUL_AWAY, index: 0, time: "16:00" },
  { id: "SeoulMid", origin: SEOUL, index: 2, time: "15:30" },
  { id: "SeoulNight", origin: SEOUL, index: 3, time: "19:00" },
], { id: "SeoulMovedAfter", origin: SEOUL, index: 5, time: "12:00", meal: "午餐" }), "SeoulMovedAfter");

function assertRolledBack(name, plans) {
  const before = plans.map((plan) => plan.entries.map((entry) => ({
    id: entry.place.id,
    time: entry.time,
  })));
  const observed = observe(plans);
  assert.equal(observed.outcome.status, "not_called", name);
  assert.equal(observed.outcome.failures, undefined, name);
  assert.deepEqual(observed.plans.map((plan) => plan.entries.map((entry) => ({
    id: entry.place.id,
    time: entry.time,
  }))), before, name);
  assertSamePlaces(plans, observed.plans, name);
}

assertRolledBack("impossible third lunch", [
  clusterDay(1, HOME, AWAY, [
    { id: "RollMorning", origin: HOME, index: 0, time: "09:30" },
    { id: "RollLunchA", origin: HOME, index: 1, time: "12:00", meal: "午餐" },
    { id: "RollLunchB", origin: HOME, index: 2, time: "12:30", meal: "午餐" },
    { id: "RollAway", origin: AWAY, index: 0, time: "16:00" },
    { id: "RollDinner", origin: HOME, index: 3, time: "18:30", meal: "晚餐" },
  ]),
  clusterDay(2, HOME, AWAY, [
    { id: "RollAwayA", origin: AWAY, index: 1, time: "09:30" },
    { id: "RollAwayB", origin: AWAY, index: 2, time: "11:00" },
    { id: "RollThirdLunch", origin: HOME, index: 5, time: "12:00", meal: "午餐" },
    { id: "RollAwayC", origin: AWAY, index: 3, time: "14:00" },
    { id: "RollAwayD", origin: AWAY, index: 4, time: "17:00" },
  ]),
  clusterDay(3, HOME, AWAY, [
    { id: "RollAwayE", origin: AWAY, index: 5, time: "09:30" },
    { id: "RollAwayF", origin: AWAY, index: 6, time: "11:00" },
    { id: "RollAwayG", origin: AWAY, index: 7, time: "14:00" },
    { id: "RollAwayH", origin: AWAY, index: 8, time: "16:00" },
    { id: "RollAwayI", origin: AWAY, index: 9, time: "19:00" },
  ]),
]);

assertRolledBack("impossible fifth night market", [
  clusterDay(1, HOME, AWAY, [
    { id: "NightA", origin: HOME, index: 0, time: "18:00", label: "夜間", extra: { primaryType: "night_market", types: ["night_market"] } },
    { id: "NightB", origin: HOME, index: 1, time: "19:00", label: "夜間", extra: { primaryType: "night_market", types: ["night_market"] } },
    { id: "NightC", origin: HOME, index: 2, time: "20:00", label: "夜間", extra: { primaryType: "night_market", types: ["night_market"] } },
    { id: "NightD", origin: HOME, index: 3, time: "20:30", label: "夜間", extra: { primaryType: "night_market", types: ["night_market"] } },
    { id: "NightAway", origin: AWAY, index: 0, time: "10:00" },
  ]),
  clusterDay(2, HOME, AWAY, [
    { id: "NightAwayA", origin: AWAY, index: 1, time: "09:30" },
    { id: "NightAwayB", origin: AWAY, index: 2, time: "11:00" },
    { id: "NightFifth", origin: HOME, index: 5, time: "19:00", label: "夜間", extra: { primaryType: "night_market", types: ["night_market"] } },
    { id: "NightAwayC", origin: AWAY, index: 3, time: "14:00" },
    { id: "NightAwayD", origin: AWAY, index: 4, time: "17:00" },
  ]),
  clusterDay(3, HOME, AWAY, [
    { id: "NightAwayE", origin: AWAY, index: 5, time: "09:30" },
    { id: "NightAwayF", origin: AWAY, index: 6, time: "11:00" },
    { id: "NightAwayG", origin: AWAY, index: 7, time: "14:00" },
    { id: "NightAwayH", origin: AWAY, index: 8, time: "16:00" },
    { id: "NightAwayI", origin: AWAY, index: 9, time: "19:00" },
  ]),
]);

const orderingPressure = observe([
  clusterDay(1, HOME, AWAY, [
    { id: "OrderAway", origin: AWAY, index: 0, time: "11:00" },
    { id: "OrderB", origin: HOME, index: 1, time: "12:00" },
    { id: "OrderC", origin: HOME, index: 2, time: "14:00" },
    { id: "OrderD", origin: HOME, index: 3, time: "16:00" },
    { id: "OrderE", origin: HOME, index: 4, time: "18:00" },
  ]),
  clusterDay(2, HOME, AWAY, [
    { id: "OrderAwayA", origin: AWAY, index: 1, time: "09:30" },
    { id: "OrderAwayB", origin: AWAY, index: 2, time: "11:00" },
    { id: "OrderIncoming", origin: HOME, index: 6, time: "17:00" },
    { id: "OrderAwayC", origin: AWAY, index: 3, time: "15:30" },
    { id: "OrderAwayD", origin: AWAY, index: 4, time: "19:00" },
  ]),
  clusterDay(3, HOME, AWAY, [
    { id: "OrderAwayE", origin: AWAY, index: 5, time: "09:30" },
    { id: "OrderAwayF", origin: AWAY, index: 6, time: "11:00" },
    { id: "OrderAwayG", origin: AWAY, index: 7, time: "14:00" },
    { id: "OrderAwayH", origin: AWAY, index: 8, time: "16:00" },
    { id: "OrderAwayI", origin: AWAY, index: 9, time: "20:00" },
  ]),
]);
assert.equal(orderingPressure.outcome.status, "safe");
assert.equal(ids(orderingPressure.plans, 1).includes("OrderIncoming"), true);
assertUniqueIncreasing(day(orderingPressure.plans, 1), "ordering pressure");
assertPolicyClocks(day(orderingPressure.plans, 1), "ordering pressure");

const closedMuseumPlace = {
  primaryType: "museum",
  types: ["museum"],
  name: "ClosedSlotMuseum",
  todayHoursLabel: "10:00-18:00",
};
const closedPressure = observe([
  clusterDay(1, HOME, AWAY, [
    { id: "MuseumAway", origin: AWAY, index: 0, time: "11:00" },
    { id: "MuseumB", origin: HOME, index: 1, time: "09:30" },
    { id: "MuseumC", origin: HOME, index: 2, time: "11:00" },
    { id: "MuseumD", origin: HOME, index: 3, time: "14:00" },
    { id: "MuseumE", origin: HOME, index: 4, time: "16:00" },
  ]),
  clusterDay(2, HOME, AWAY, [
    { id: "MuseumAwayA", origin: AWAY, index: 1, time: "09:30" },
    { id: "MuseumAwayB", origin: AWAY, index: 2, time: "12:00" },
    { id: "ClosedSlotMuseum", origin: HOME, index: 6, time: "18:00", extra: closedMuseumPlace },
    { id: "MuseumAwayC", origin: AWAY, index: 3, time: "15:30" },
    { id: "MuseumAwayD", origin: AWAY, index: 4, time: "17:00" },
  ]),
  clusterDay(3, HOME, AWAY, [
    { id: "MuseumAwayE", origin: AWAY, index: 5, time: "09:30" },
    { id: "MuseumAwayF", origin: AWAY, index: 6, time: "11:00" },
    { id: "MuseumAwayG", origin: AWAY, index: 7, time: "14:00" },
    { id: "MuseumAwayH", origin: AWAY, index: 8, time: "16:00" },
    { id: "MuseumAwayI", origin: AWAY, index: 9, time: "18:00" },
  ]),
]);
assert.equal(ids(closedPressure.plans, 1).includes("ClosedSlotMuseum"), true);
const museumTime = day(closedPressure.plans, 1).entries.find((entry) => entry.place.id === "ClosedSlotMuseum").time;
assert.ok(minutes(museumTime) < 19 * 60, museumTime);
assertPolicyClocks(day(closedPressure.plans, 1), "closed slot pressure");

const anchored = place("AnchoredReservation", HOME, 8);
const anchorPlans = macauPlans();
anchorPlans[1].entries[2] = stop(anchored, "12:00", "午餐 reservation");
const anchorBefore = ids(anchorPlans, 2);
const anchorRepaired = run(anchorPlans);
assert.deepEqual(ids(anchorRepaired, 2), anchorBefore, "fixed-day meal stays on its day");

const dedicated = place("DedicatedNearby", HOME, 9, { destinationScope: "nearby_extension" });
const dedicatedPlans = macauPlans();
dedicatedPlans[1].entries[2] = stop(dedicated, "12:00", "午餐");
const dedicatedBefore = ids(dedicatedPlans, 2);
assert.deepEqual(ids(run(dedicatedPlans), 2), dedicatedBefore, "nearby dedicated stop stays on its day");

const duplicateTimeline = validationOf([{
  day: 1,
  entries: macauSwapped,
}]);
assert.equal(duplicateTimeline.result.pass, false);
assert.equal(duplicateTimeline.fails.includes("timeline_conflict"), true);
assert.equal(duplicateTimeline.blocked, true);

const cohesionSource = read("src/lib/ai/cross-day-geographic-cohesion.ts");
assert.doesNotMatch(cohesionSource, /dedupeEntryTimes|fetch\(|openai|googleapis|unsplash|revenuecat/i);
assert.match(cohesionSource, /resolveRecipientDayTimeline/);
assert.match(cohesionSource, /outcome\.status = "no_safe_slot"/);

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
  macauClockAwareCommitted: true,
  seoulShapesCommitted: true,
  impossibleMoveRolledBack: true,
});
