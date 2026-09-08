import assert from "node:assert/strict";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";

const place = (id, family) => ({
  id,
  googlePlaceId: id,
  name: id,
  address: "fixture",
  lat: 25,
  lng: 121,
  rating: 4.5,
  userRatingCount: 100,
  primaryType: family,
  types: [family],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
});
const entry = (candidate, index) => ({
  time: `${9 + index * 2}:00`,
  label: "景點",
  name: candidate.name,
  place: candidate,
});
const inputFor = (days, lockedPlaceIds = [], extra = {}) => ({
  plans: days.map((places, index) => ({
    day: index + 1,
    entries: places.map(entry),
  })),
  requestedDays: days.length,
  generationId: "p48-regression",
  validationStage: "final",
  lockedPlaceIds,
  ...extra,
});
const validate = (days, lockedPlaceIds = [], extra = {}) =>
  validateItineraryPlan(inputFor(days, lockedPlaceIds, extra));
const failures = (result) => result.failedRules.filter(
  (rule) => rule.code === "daily_category_diversity",
);

const required = Array.from({ length: 7 }, (_, index) =>
  place(`required-${index}`, index < 4 ? "museum" : "tourist_attraction"),
);
const requiredConflict = validate(
  [[required[0], required[1], required[4]], [required[2], required[3], required[5], required[6]]],
  required.map((candidate) => candidate.id),
);
assert.equal(failures(requiredConflict).length, 0);
assert.equal(
  requiredConflict.warnings.filter((warning) =>
    warning.message.startsWith("daily_category_diversity_required_override:"),
  ).length,
  2,
);
assert.equal(requiredConflict.failedRules.some((rule) => rule.code === "persistence_mismatch"), false);

const supplementalMuseum = place("supplemental-museum", "museum");
const supplementalConflict = validate([
  [place("required-museum", "museum"), supplementalMuseum, place("attraction-a", "tourist_attraction")],
], ["required-museum"]);
assert.equal(failures(supplementalConflict).length, 1);

const replan = (days, lockedPlaceIds, pool) => {
  const validatorInput = inputFor(days, lockedPlaceIds);
  const initial = validateItineraryPlan(validatorInput);
  return replanUntilItineraryValid({
    generationId: "p48-regression",
    plans: validatorInput.plans,
    pool,
    days: days.length,
    style: "mixed",
    validatorInput: {
      requestedDays: days.length,
      lockedPlaceIds,
      generationId: "p48-regression",
    },
    requiredPlaces: pool.filter((candidate) => lockedPlaceIds.includes(candidate.id)),
  }, initial);
};

const moveRequired = place("ChIJP48RequiredMuseum", "museum");
const moveSupplemental = place("ChIJP48SupplementalMuseum", "museum");
const moveA = place("ChIJP48AttractionA", "tourist_attraction");
const moveB = place("ChIJP48AttractionB", "tourist_attraction");
const moveC = place("ChIJP48AttractionC", "tourist_attraction");
const repairedByMove = replan(
  [[moveRequired, moveSupplemental, moveA], [moveB, moveC]],
  [moveRequired.id],
  [moveRequired, moveSupplemental, moveA, moveB, moveC],
);
assert.equal(failures(repairedByMove.validation).length, 0);
assert.equal(repairedByMove.plans.flatMap((plan) => plan.entries).some(
  (item) => item.place.id === moveRequired.id,
), true);

const dropRequired = place("ChIJP48DropRequired", "museum");
const dropSupplemental = place("ChIJP48DropSupplemental", "museum");
const dropA = place("ChIJP48DropAttractionA", "tourist_attraction");
const dropB = place("ChIJP48DropAttractionB", "tourist_attraction");
const repairedByDrop = replan(
  [[dropRequired, dropSupplemental, dropA, dropB]],
  [dropRequired.id],
  [dropRequired, dropSupplemental, dropA, dropB],
);
assert.equal(failures(repairedByDrop.validation).length, 0);
assert.equal(repairedByDrop.plans[0].entries.some(
  (item) => item.place.id === dropSupplemental.id,
), false);

const mixedRequiredA = place("ChIJP48MixedRequiredA", "museum");
const mixedRequiredB = place("ChIJP48MixedRequiredB", "museum");
const mixedSupplemental = place("ChIJP48MixedSupplemental", "museum");
const mixedAttraction = place("ChIJP48MixedAttraction", "tourist_attraction");
const repairedMixed = replan(
  [[mixedRequiredA, mixedRequiredB, mixedSupplemental, mixedAttraction]],
  [mixedRequiredA.id, mixedRequiredB.id],
  [mixedRequiredA, mixedRequiredB, mixedSupplemental, mixedAttraction],
);
assert.equal(failures(repairedMixed.validation).length, 0);
assert.equal(repairedMixed.plans[0].entries.filter(
  (item) => [mixedRequiredA.id, mixedRequiredB.id].includes(item.place.id),
).length, 2);

const redistributed = validate([
  [place("museum-a", "museum"), place("attraction-b", "tourist_attraction")],
  [place("museum-b", "museum"), place("attraction-c", "tourist_attraction")],
]);
assert.equal(failures(redistributed).length, 0);

const selectedOnly = validate([
  [place("selected-museum-a", "museum"), place("selected-museum-b", "museum")],
], ["selected-museum-a", "selected-museum-b"]);
assert.equal(failures(selectedOnly).length, 0);
assert.equal(selectedOnly.pass, true);
assert.equal(selectedOnly.failedRules.some((rule) => rule.code === "persistence_mismatch"), false);

const generated = validate([
  [place("generated-museum-a", "museum"), place("generated-museum-b", "museum")],
]);
assert.equal(failures(generated).length, 1);

assert.equal(failures(validate([[place("cafe-1", "cafe"), place("cafe-2", "cafe"), place("cafe-3", "cafe")]], [], {
  userText: "咖啡巡",
})).length, 0);
assert.equal(failures(validate([[place("museum-1", "museum"), place("museum-2", "museum")]], [], {
  userText: "博物館巡",
})).length, 0);
assert.equal(failures(validate([[place("shrine-1", "hindu_temple"), place("shrine-2", "hindu_temple"), place("shrine-3", "hindu_temple"), place("shrine-4", "hindu_temple")]], [], {
  userText: "宗教文化",
})).length, 0);

console.log("P48 required anchors vs daily diversity: PASS", {
  requiredConflictWarns: true,
  supplementalConflictRepaired: true,
  supplementalDropSafe: true,
  mixedConflictRepaired: true,
  redistributionCanResolve: true,
  selectedItemsPreserved: true,
  autoGeneratedRuleStillActive: true,
  externalRequestDelta: 0,
});
