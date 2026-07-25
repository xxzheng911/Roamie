import assert from "node:assert/strict";
import {
  assessRepairProgress,
  buildItineraryFailureFingerprint,
  buildItineraryPlanSignature,
  resolveRepairRoundStopReason,
} from "../src/lib/ai/itinerary-validator/repair-progress.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
import {
  setItineraryValidatorEnabledOverride,
  validateItineraryPlan,
} from "../src/lib/ai/itinerary-validator/index.ts";

function place(id, primaryType = "tourist_attraction") {
  return {
    id,
    name: `Place ${id}`,
    address: "Generic destination",
    lat: 25,
    lng: 121,
    rating: 4.6,
    userRatingCount: 1000,
    photoName: null,
    primaryType,
    types: [primaryType, "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

function entry(candidate, time = "10:00", label = "景點") {
  return { time, label, name: candidate.name, place: candidate };
}

function validation(rules, opts = {}) {
  const affectedDays = opts.affectedDays ?? [...new Set(rules.map((rule) => rule.day).filter(Boolean))];
  const affectedPlaceIds = opts.affectedPlaceIds ?? [
    ...new Set(rules.flatMap((rule) => rule.placeIds ?? [])),
  ];
  return {
    pass: opts.pass ?? rules.length === 0,
    score: opts.score ?? (rules.length ? 70 : 100),
    failedRules: rules,
    warnings: opts.warnings ?? [],
    affectedDays,
    affectedPlaceIds,
    validatorVersion: "test",
    replanReasons: rules.length ? ["replan_daily_category_diversity"] : [],
    path: "validator",
  };
}

function rule(day = 1, placeIds = ["a", "b"], message = "park_family:2>1") {
  return {
    code: "daily_category_diversity",
    message,
    day,
    placeIds,
    severity: "fail",
  };
}

const a = place("a", "park");
const b = place("b", "park");
const c = place("c", "museum");
const planA = [
  { day: 1, entries: [entry(a, "09:30"), entry(b, "11:00")] },
  { day: 2, entries: [entry(c, "14:00")] },
];
const planAClone = planA.map((plan) => ({ ...plan, entries: [...plan.entries] }));
const failedA = validation([rule()]);

const unchanged = assessRepairProgress({
  plansBefore: planA,
  plansAfter: planAClone,
  validationBefore: failedA,
  validationAfter: { ...failedA, warnings: [...failedA.warnings].reverse() },
  seenPlanSignatures: new Set([buildItineraryPlanSignature(planA)]),
});
assert.equal(unchanged.noProgress, true);
assert.equal(unchanged.operationCount, 0);
assert.equal(unchanged.actualPlanChanged, false);
assert.equal(resolveRepairRoundStopReason(false, unchanged), "no_progress");

const planB = [
  { day: 1, entries: [entry(a, "09:30")] },
  { day: 2, entries: [entry(c, "14:00"), entry(b, "16:00")] },
];
const moved = assessRepairProgress({
  plansBefore: planA,
  plansAfter: planB,
  validationBefore: failedA,
  validationAfter: validation([rule(2)]),
  seenPlanSignatures: new Set([buildItineraryPlanSignature(planA)]),
});
assert.equal(moved.actualPlanChanged, true);
assert.equal(moved.noProgress, false);
assert.equal(resolveRepairRoundStopReason(false, moved), null);
assert.ok(moved.operationCount > 0);

const cycle = assessRepairProgress({
  plansBefore: planB,
  plansAfter: planA,
  validationBefore: validation([rule(2)]),
  validationAfter: failedA,
  seenPlanSignatures: new Set([
    buildItineraryPlanSignature(planA),
    buildItineraryPlanSignature(planB),
  ]),
});
assert.equal(cycle.cycleDetected, true);
assert.equal(cycle.noProgress, false);
assert.equal(resolveRepairRoundStopReason(false, cycle), "cycle_detected");

const twoRules = validation([
  rule(),
  { code: "missing_days", message: "missing_day:2", day: 2, placeIds: [], severity: "fail" },
]);
const fewerRules = assessRepairProgress({
  plansBefore: planA,
  plansAfter: planA,
  validationBefore: twoRules,
  validationAfter: failedA,
  seenPlanSignatures: new Set([buildItineraryPlanSignature(planA)]),
});
assert.equal(fewerRules.hardFailureImproved, true);
assert.equal(fewerRules.noProgress, false);

const warningsOne = validation([rule()], {
  warnings: [
    { code: "route_backtrack", message: "w1" },
    { code: "timeline_conflict", message: "w2" },
  ],
});
const warningsTwo = { ...warningsOne, warnings: [...warningsOne.warnings].reverse() };
assert.equal(
  buildItineraryFailureFingerprint(warningsOne),
  buildItineraryFailureFingerprint(warningsTwo),
);

const reordered = [
  { day: 1, entries: [entry(b, "09:30"), entry(a, "11:00")] },
  { day: 2, entries: [entry(c, "14:00")] },
];
assert.notEqual(buildItineraryPlanSignature(planA), buildItineraryPlanSignature(reordered));
assert.notEqual(buildItineraryPlanSignature(planA), buildItineraryPlanSignature(planB));

const worseAfterStopChange = [
  ...planA,
  { day: 3, entries: [entry(place("d"), "10:00")] },
];
const changedButWorse = assessRepairProgress({
  plansBefore: planA,
  plansAfter: worseAfterStopChange,
  validationBefore: failedA,
  validationAfter: twoRules,
  seenPlanSignatures: new Set([buildItineraryPlanSignature(planA)]),
});
assert.equal(changedButWorse.actualPlanChanged, true);
assert.equal(changedButWorse.hardFailureImproved, false);
assert.equal(changedButWorse.noProgress, false);

const success = assessRepairProgress({
  plansBefore: planA,
  plansAfter: planB,
  validationBefore: failedA,
  validationAfter: validation([], { pass: true }),
  seenPlanSignatures: new Set([buildItineraryPlanSignature(planA)]),
});
assert.equal(success.hardFailureImproved, true);
assert.equal(success.noProgress, false);
assert.equal(resolveRepairRoundStopReason(true, success), "success");

// A progressing first round may continue; an unchanged second round stops before round three.
assert.equal(resolveRepairRoundStopReason(false, moved), null);
assert.equal(resolveRepairRoundStopReason(false, unchanged), "no_progress");
// Three changing, still-failing rounds remain bounded by the existing outer max-round contract.
assert.deepEqual(
  [moved, moved, moved].map((progress) => resolveRepairRoundStopReason(false, progress)),
  [null, null, null],
);

// Integration: an immovable generic diversity conflict stops after the first unchanged round.
setItineraryValidatorEnabledOverride(true);
const stalledPlans = [
  {
    day: 1,
    entries: [entry(a, "09:30"), entry(b, "11:00"), entry(place("x"), "14:00")],
  },
];
const stalledInput = {
  plans: stalledPlans,
  requestedDays: 1,
  destination: "Generic destination",
  style: "mixed",
  lockedPlaceIds: [a.id, b.id],
};
const stalledInitial = validateItineraryPlan(stalledInput);
assert.equal(stalledInitial.failedRules.some((item) => item.code === "daily_category_diversity"), true);
const stalledOutcome = replanUntilItineraryValid(
  {
    plans: stalledPlans,
    pool: stalledPlans.flatMap((plan) => plan.entries.map((item) => item.place)),
    days: 1,
    style: "mixed",
    validatorInput: stalledInput,
  },
  stalledInitial,
);
assert.equal(stalledOutcome.attempts, 1);
assert.equal(stalledOutcome.stopReason, "no_progress");
assert.equal(stalledOutcome.noProgress, true);
setItineraryValidatorEnabledOverride(null);

console.log("verify-itinerary-repair-no-progress: ok");
