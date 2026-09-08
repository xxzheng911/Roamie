import assert from "node:assert/strict";
import {
  evaluateRequiredPlaceCoverage,
  repairRequiredPlaceCoverage,
  replanUntilItineraryValid,
} from "../src/lib/ai/itinerary-validator/replan.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";

const place = (id, name, type = "tourist_attraction") => ({
  id,
  googlePlaceId: id ? `ChIJP33${id.replace(/[^a-z0-9]/gi, "")}` : null,
  plannerProvenanceKey: id ? `fixture:${id}` : undefined,
  name,
  address: "台北市中正區測試路 1 號",
  lat: 25.04,
  lng: 121.52,
  rating: 4.5,
  userRatingCount: 100,
  primaryType: type,
  types: [type],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
});
const entry = (candidate, time) => ({
  time,
  label: candidate.primaryType,
  name: candidate.name,
  place: candidate,
});

const required = [
  place("required-0", "龍山寺"),
  place("required-1", "饒河街觀光夜市", "night_market"),
  place("required-2", "台北當代藝術館", "museum"),
];
const supplemental = Array.from({ length: 5 }, (_, index) =>
  place(`supplemental-${index}`, `補充景點 ${index + 1}`),
);
const initialPlans = [
  { day: 1, entries: [entry(supplemental[0], "09:30"), entry(supplemental[1], "13:30")] },
  { day: 2, entries: [entry(supplemental[2], "09:30"), entry(supplemental[3], "13:30"), entry(supplemental[4], "16:30")] },
];

assert.equal(evaluateRequiredPlaceCoverage(initialPlans, required).requiredSatisfiedCount, 0);
const repaired = repairRequiredPlaceCoverage({ plans: initialPlans, requiredPlaces: required, days: 2 });
assert.equal(repaired.insertedCount, 3);
assert.equal(repaired.replacedSupplementalCount, 3);
assert.deepEqual(repaired.plans.map((plan) => plan.entries.length), [2, 3]);
assert.equal(evaluateRequiredPlaceCoverage(repaired.plans, required).requiredSatisfiedCount, 3);

const validatorInput = {
  requestedDays: 2,
  style: "mixed",
  destination: "台北",
  creationPath: "direct",
  lockedPlaceIds: required.map((candidate) => candidate.id),
  lockedPlaceNames: required.map((candidate) => candidate.name),
};
const initialValidation = validateItineraryPlan({ plans: initialPlans, ...validatorInput });
const outcome = replanUntilItineraryValid(
  {
    plans: initialPlans,
    pool: [...required, ...supplemental],
    requiredPlaces: required,
    days: 2,
    style: "mixed",
    validatorInput,
  },
  initialValidation,
);
assert(outcome.attempts >= 1, "coverage mismatch must enter replan even when generic rules clear");
assert.equal(outcome.requiredCoverageComplete, true);
assert.equal(outcome.requiredSatisfiedCount, 3);
assert.equal(outcome.stopReason, "success");

const lockedAgain = repairRequiredPlaceCoverage({
  plans: outcome.plans,
  requiredPlaces: required,
  days: 2,
});
assert.equal(lockedAgain.insertedCount, 0);
assert.equal(evaluateRequiredPlaceCoverage(lockedAgain.plans, required).requiredSatisfiedCount, 3);

const impossibleRequired = [{ ...place("", ""), name: "" }];
const maxed = replanUntilItineraryValid(
  {
    plans: repaired.plans,
    pool: [...required, ...supplemental],
    requiredPlaces: impossibleRequired,
    days: 2,
    style: "mixed",
    validatorInput,
  },
  validateItineraryPlan({ plans: repaired.plans, ...validatorInput }),
);
assert.equal(maxed.attempts, 3);
assert.equal(maxed.requiredCoverageComplete, false);
assert.equal(maxed.stopReason, "max_rounds");

assert.deepEqual(outcome.validation.failedRules, []);
assert.equal(outcome.requiredSatisfiedCount, 3);

console.log("verify-p33-required-coverage-replan: ok");
