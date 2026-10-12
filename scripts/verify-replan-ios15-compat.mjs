import assert from "node:assert/strict";
// iOS 15.0–15.3 JavaScriptCore has no Array.prototype.findLastIndex (added in 15.4);
// the app's deployment target is iOS 15.0 and no polyfill ships with the client.
delete Array.prototype.findLastIndex;
delete Array.prototype.findLast;
globalThis.fetch = async () => { throw Error("NETWORK_DISABLED"); };
const { validateItineraryPlan } = await import("../src/lib/ai/itinerary-validator/validate.ts");
const { replanUntilItineraryValid } = await import("../src/lib/ai/itinerary-validator/replan.ts");

const place = (id, family) => ({
  id, googlePlaceId: id, name: id, address: "fixture", lat: 25, lng: 121,
  rating: 4.5, userRatingCount: 100, primaryType: family, types: [family],
  businessStatus: "OPERATIONAL", openStatus: "unknown",
});
const entry = (candidate, index) => ({ time: `${9 + index * 2}:00`, label: "景點", name: candidate.name, place: candidate });
const day = ["a", "b", "c", "d"].map((id) => place(`museum-${id}`, "museum"));
const pool = [...day, place("park-spare", "park"), place("attraction-spare", "tourist_attraction")];
const validatorInput = {
  plans: [{ day: 1, entries: day.map(entry) }],
  requestedDays: 1, generationId: "ios15-compat", validationStage: "final", lockedPlaceIds: [],
};
const initial = validateItineraryPlan(validatorInput);
assert.ok(initial.failedRules.some((rule) => rule.code === "daily_category_diversity"), "fixture violates diversity");
let outcome;
assert.doesNotThrow(() => {
  outcome = replanUntilItineraryValid({
    generationId: "ios15-compat", plans: validatorInput.plans, pool, days: 1, style: "mixed",
    plannedDate: "2026-12-10",
    validatorInput: { requestedDays: 1, lockedPlaceIds: [], generationId: "ios15-compat", validationStage: "final" },
  }, initial);
}, "diversity repair runs without ES2023 array methods");
// Equivalent to findLastIndex: the LAST unlocked over-limit museum is the one replaced.
const names = outcome.plans[0].entries.map((e) => e.place.id);
assert.ok(names.includes("museum-a"), "earliest museum kept");
assert.ok(!names.includes("museum-d"), "last over-limit museum replaced first");
console.log("PASS replan diversity repair on iOS 15.0 JavaScriptCore surface", JSON.stringify(names));
