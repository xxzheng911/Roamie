import assert from "node:assert/strict";
import {
  degradeDiversityFailureToWarning,
  evaluateDiversityDegradationEvidence,
} from "../src/lib/ai/itinerary-validator/diversity-degradation.ts";
import { buildSelectedPlaceLock } from "../src/lib/ai/required-anchor-runtime.ts";

function place(index, primaryType = "tourist_attraction") {
  return {
    id: `ChIJ_evidence_${index}`,
    name: `Generic Place ${index}`,
    address: "Generic destination",
    lat: 25 + index * 0.001,
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
    coordinateSource: "google_places",
  };
}

function entry(candidate, time) {
  return { time, label: "景點", name: candidate.name, place: candidate };
}

const places = Array.from({ length: 23 }, (_, index) =>
  place(index + 1, index < 2 ? "park" : "tourist_attraction"),
);
const counts = [4, 4, 4, 4, 4, 3];
let cursor = 0;
const plans = counts.map((count, dayIndex) => {
  const dayPlaces = places.slice(cursor, cursor + count);
  cursor += count;
  return {
    day: dayIndex + 1,
    entries: dayPlaces.map((candidate, index) =>
      entry(candidate, `${String(9 + index * 2).padStart(2, "0")}:00`),
    ),
  };
});

function validation(rules, warnings = []) {
  return {
    pass: false,
    score: 90,
    failedRules: rules,
    warnings,
    affectedDays: [...new Set(rules.map((rule) => rule.day).filter(Boolean))],
    affectedPlaceIds: [...new Set(rules.flatMap((rule) => rule.placeIds ?? []))],
    validatorVersion: "test",
    replanReasons: ["replan_daily_category_diversity"],
    path: "validator",
  };
}

const diversityRule = {
  code: "daily_category_diversity",
  message: "park_family:2>1",
  day: 1,
  placeIds: plans[0].entries.map((item) => item.place.id),
  severity: "fail",
};
const diversityValidation = validation([diversityRule]);
const lock = buildSelectedPlaceLock({ placeIds: [places[0].id, places[1].id] });

const exhausted = evaluateDiversityDegradationEvidence({
  plans,
  validation: diversityValidation,
  pool: places,
  days: 6,
  repairStalled: true,
  cycleDetected: false,
  lock,
});
assert.equal(exhausted.eligible, true);
assert.equal(exhausted.candidatePoolExhausted, true);
assert.equal(exhausted.noLegalDonor, true);
assert.equal(exhausted.stopCount, 23);

const degraded = degradeDiversityFailureToWarning(diversityValidation);
assert.equal(degraded.pass, true);
assert.equal(degraded.failedRules.length, 0);
assert.equal(
  degraded.warnings.some((warning) => warning.code === "daily_category_diversity"),
  true,
);
assert.equal(
  degraded.warnings.find((warning) => warning.code === "daily_category_diversity")?.message,
  "部分天數景點類型較接近。",
);

const withExtraFailure = (code, message) =>
  evaluateDiversityDegradationEvidence({
    plans,
    validation: validation([
      diversityRule,
      { code, message, day: 1, placeIds: [], severity: "fail" },
    ]),
    pool: places,
    days: 6,
    repairStalled: true,
    cycleDetected: false,
    lock,
  });
assert.equal(withExtraFailure("unsuitable_place", "closed place").eligible, false);
assert.equal(withExtraFailure("place_duplicate", "duplicate place").eligible, false);
assert.equal(withExtraFailure("timeline_conflict", "hard timeline").eligible, false);
assert.equal(withExtraFailure("route_travel_time", "route structure").eligible, false);

const replacement = place(99, "tourist_attraction");
const replacementAvailable = evaluateDiversityDegradationEvidence({
  plans,
  validation: diversityValidation,
  pool: [...places, replacement],
  days: 6,
  repairStalled: true,
  cycleDetected: false,
  lock,
});
assert.equal(replacementAvailable.eligible, false);
assert.equal(replacementAvailable.candidatePoolExhausted, false);
assert.equal(replacementAvailable.replacementCandidateId, replacement.id);

const largerOverflow = evaluateDiversityDegradationEvidence({
  plans,
  validation: validation([{ ...diversityRule, message: "park_family:3>1" }]),
  pool: places,
  days: 6,
  repairStalled: true,
  cycleDetected: false,
  lock,
});
assert.equal(largerOverflow.eligible, false);

const closedPlans = plans.map((plan) => ({ ...plan, entries: [...plan.entries] }));
closedPlans[1].entries[0] = {
  ...closedPlans[1].entries[0],
  place: { ...closedPlans[1].entries[0].place, businessStatus: "CLOSED_PERMANENTLY" },
};
assert.equal(
  evaluateDiversityDegradationEvidence({
    plans: closedPlans,
    validation: diversityValidation,
    pool: places,
    days: 6,
    repairStalled: true,
    cycleDetected: false,
    lock,
  }).eligible,
  false,
);

const unroutablePlans = plans.map((plan) => ({ ...plan, entries: [...plan.entries] }));
unroutablePlans[2].entries[0] = {
  ...unroutablePlans[2].entries[0],
  place: {
    ...unroutablePlans[2].entries[0].place,
    id: "invalid",
    lat: null,
    lng: null,
  },
};
assert.equal(
  evaluateDiversityDegradationEvidence({
    plans: unroutablePlans,
    validation: diversityValidation,
    pool: places,
    days: 6,
    repairStalled: true,
    cycleDetected: false,
    lock,
  }).eligible,
  false,
);

console.log("verify-diversity-evidence-degradation: ok");
