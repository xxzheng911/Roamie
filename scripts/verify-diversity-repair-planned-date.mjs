import assert from "node:assert/strict";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
globalThis.fetch = async () => { throw Error("NETWORK_DISABLED"); };

// Daily diversity repair evaluates replacement opening hours on the planned date.
// The repair must receive plannedDate from its caller (never an out-of-scope name).
const place = (id, family) => ({
  id, googlePlaceId: id, name: id, address: "fixture", lat: 25, lng: 121,
  rating: 4.5, userRatingCount: 100, primaryType: family, types: [family],
  businessStatus: "OPERATIONAL", openStatus: "unknown",
});
const entry = (candidate, index) => ({ time: `${9 + index * 2}:00`, label: "景點", name: candidate.name, place: candidate });
const day = [place("museum-a", "museum"), place("museum-b", "museum"), place("museum-c", "museum"), place("museum-d", "museum")];
const pool = [...day, place("museum-spare", "museum"), place("park-spare", "park"), place("attraction-spare", "tourist_attraction")];
const validatorInput = {
  plans: [{ day: 1, entries: day.map(entry) }],
  requestedDays: 1, generationId: "diversity-planned-date", validationStage: "final", lockedPlaceIds: [],
};
const initial = validateItineraryPlan(validatorInput);
assert.ok(initial.failedRules.some((rule) => rule.code === "daily_category_diversity"), "fixture violates diversity");
let outcome;
assert.doesNotThrow(() => {
  outcome = replanUntilItineraryValid({
    generationId: "diversity-planned-date", plans: validatorInput.plans, pool, days: 1, style: "mixed",
    plannedDate: "2026-12-10",
    validatorInput: { requestedDays: 1, lockedPlaceIds: [], generationId: "diversity-planned-date", validationStage: "final" },
  }, initial);
}, "diversity repair must not throw");
assert.ok(outcome?.plans?.length === 1, "replan returns a plan");
console.log("PASS diversity repair receives plannedDate");
