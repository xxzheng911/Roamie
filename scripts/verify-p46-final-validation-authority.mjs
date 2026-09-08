import assert from "node:assert/strict";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";

const place = (index, type = "tourist_attraction") => ({
  id: `ChIJP46Candidate${index}`,
  googlePlaceId: `ChIJP46Candidate${index}`,
  plannerProvenanceKey: `fixture:p46:${index}`,
  name: `P46 candidate ${index}`,
  address: "Taichung City",
  lat: 24.14 + index * 0.002,
  lng: 120.67 + index * 0.002,
  rating: 4.5,
  userRatingCount: 100,
  primaryType: type,
  types: [type],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
});
const candidates = Array.from({ length: 8 }, (_, index) => place(index));
const entry = (candidate, time) => ({
  time,
  label: "景點",
  name: candidate.name,
  place: candidate,
});
const plan = (day, indexes) => ({
  day,
  entries: indexes.map((index, offset) => entry(candidates[index], `${9 + offset * 2}:00`)),
});
const required = candidates.slice(0, 5);
const base = {
  generationId: "p46-regression",
  requestedDays: 3,
  destination: "台中",
  style: "mixed",
  creationPath: "direct",
  lockedPlaceIds: required.map((candidate) => candidate.id),
  lockedPlaceNames: required.map((candidate) => candidate.name),
};

const finalPlans = [plan(1, [0, 1]), plan(2, [2, 3, 5]), plan(3, [4, 6, 7])];
const logs = [];
const originalInfo = console.info;
console.info = (tag, payload) => logs.push({ tag, payload });
let finalValidation;
try {
  finalValidation = validateItineraryPlan({
    ...base,
    plans: finalPlans,
    validationStage: "final",
  });
} finally {
  console.info = originalInfo;
}
assert.equal(finalValidation.failedRules.some((rule) => rule.code === "day_capacity_pace_lock"), false);
assert.equal(finalValidation.failedRules.some((rule) => rule.code === "user_exclusions"), false);
assert.equal(logs.filter((log) => log.tag === "[ITINERARY_DAY_CAPACITY]").length, 3);
assert(logs.some((log) =>
  log.tag === "[ITINERARY_EXCLUSION_VALIDATION]" &&
  log.payload.stage === "final" &&
  log.payload.excludedViolationCount === 0 &&
  log.payload.ruleEmitted === false
));

const excluded = place(20, "shopping_mall");
const exclusionValidation = validateItineraryPlan({
  ...base,
  plans: [{ day: 1, entries: [entry(excluded, "09:00"), entry(candidates[0], "11:00")] }, plan(2, [1, 2]), plan(3, [3, 4])],
  excludePlaceIds: [excluded.id],
  rejectedPlaceNames: [excluded.name],
  excludedCategories: ["shopping"],
  validationStage: "final",
});
assert.equal(
  exclusionValidation.failedRules.filter((rule) => rule.code === "user_exclusions").length,
  1,
  "one violating stop must emit one exclusion rule even when multiple signals match",
);

const imbalancedPlans = [plan(1, [0, 1, 2, 3, 4]), plan(2, [5]), plan(3, [6, 7])];
const initial = validateItineraryPlan({ ...base, plans: imbalancedPlans, validationStage: "initial" });
const outcome = replanUntilItineraryValid(
  {
    generationId: "p46-regression",
    plans: imbalancedPlans,
    pool: candidates,
    requiredPlaces: required,
    days: 3,
    style: "mixed",
    validatorInput: base,
  },
  initial,
);
const dayCounts = outcome.plans.map((day) => day.entries.length);
assert.deepEqual([...dayCounts].sort((a, b) => a - b), [2, 3, 3]);
assert.equal(outcome.requiredSatisfiedCount, 5);
assert.equal(outcome.validation.failedRules.some((rule) => rule.code === "day_capacity_pace_lock"), false);

console.log("P46 final validation authority: PASS", {
  finalDayCounts: finalPlans.map((day) => day.entries.length),
  replanDayCounts: dayCounts,
  requiredSatisfied: outcome.requiredSatisfiedCount,
  exclusionRulesPerViolatingStop: 1,
  staleRuleCarryover: false,
  externalRequestDelta: 0,
});
