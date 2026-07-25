import assert from "node:assert/strict";
import {
  evaluateIncompletePayloadDegradation,
  recoverInMemoryCandidatePool,
} from "../src/lib/ai/itinerary-candidate-recovery.ts";
import { refillMissingDaySlots } from "../src/lib/ai/ai-multi-day-planner.ts";
import { classifyDailyDiversityCategory } from "../src/lib/ai/daily-category-diversity.ts";

function place(id, name, primaryType) {
  return {
    id,
    name,
    address: `${name} address`,
    lat: 25.04,
    lng: 121.53,
    rating: 4.5,
    userRatingCount: 100,
    photoName: null,
    primaryType,
    types: [primaryType],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    coordinateSource: "google_places",
  };
}

const scenicA = place("ChIJRecoveryScenicA", "Scenic A", "tourist_attraction");
const scenicB = place("ChIJRecoveryScenicB", "Scenic B", "museum");
const lunchA = place("ChIJRecoveryLunchA", "Lunch A", "restaurant");
const lunchB = place("ChIJRecoveryLunchB", "Lunch B", "restaurant");
const required = place("ChIJRecoveryRequired", "Required", "tourist_attraction");

const context = {
  selectedCombinationIds: [1],
  offeredCombinations: [{
    id: 1,
    title: "Verified",
    places: [{
      name: required.name,
      searchQuery: required.name,
      sourceCombinationId: 1,
      isRequiredBySelection: true,
      googlePlaceId: required.id,
      latitude: required.lat,
      longitude: required.lng,
      primaryType: required.primaryType,
      types: required.types,
      resolutionStatus: "resolved",
    }],
  }],
};

const recovered = recoverInMemoryCandidatePool({
  context,
  scenicPlaces: [scenicA, scenicA, scenicB],
  plannerPlaces: [lunchA],
  existingPlaces: [lunchB, required],
});
assert.deepEqual(
  recovered.places.map((candidate) => candidate.id).sort(),
  [required.id, scenicA.id, scenicB.id, lunchA.id, lunchB.id].sort(),
  "recovery must merge in-memory sources and preserve global Google-ID dedupe",
);
assert.equal(recovered.places.every((candidate) => candidate.id.startsWith("ChIJ")), true);
assert.equal(recovered.recoveredBySource.combination_pool, 1);
assert.equal(recovered.recoveredBySource.scenic_pool, 2);

const plans = [
  {
    day: 1,
    entries: [
      { time: "09:30", label: "景點", name: required.name, place: required },
      { time: "12:30", label: "午餐", name: lunchA.name, place: lunchA },
      { time: "15:00", label: "景點", name: scenicA.name, place: scenicA },
    ],
  },
  {
    day: 2,
    entries: [
      { time: "09:30", label: "景點", name: scenicB.name, place: scenicB },
      { time: "12:30", label: "午餐", name: lunchB.name, place: lunchB },
      { time: "15:00", label: "景點", name: "Scenic C", place: place("ChIJRecoveryScenicC", "Scenic C", "park") },
    ],
  },
];
const degraded = evaluateIncompletePayloadDegradation({
  plans,
  days: 2,
  requiredPlaceIds: [required.id],
});
assert.equal(degraded.deliveryAllowed, true, "real partial days with scenic and meal coverage may degrade");
assert.equal(degraded.degraded, true);
assert.equal(degraded.missingRequired.length, 0);
assert.equal(plans[0].entries[1].label, "午餐", "meal ordering must remain unchanged");

const duplicate = evaluateIncompletePayloadDegradation({
  plans: [plans[0], { day: 2, entries: plans[0].entries }],
  days: 2,
  requiredPlaceIds: [required.id],
});
assert.equal(duplicate.deliveryAllowed, false, "duplicate identities remain a hard block");

const missingRequired = evaluateIncompletePayloadDegradation({
  plans,
  days: 2,
  requiredPlaceIds: ["ChIJMissingRequired"],
});
assert.equal(missingRequired.deliveryAllowed, false, "required places must remain present");

const noMeal = evaluateIncompletePayloadDegradation({
  plans: [{ day: 1, entries: [
    { time: "09:00", label: "景點", name: required.name, place: required },
    { time: "12:00", label: "景點", name: scenicA.name, place: scenicA },
    { time: "15:00", label: "景點", name: scenicB.name, place: scenicB },
  ] }],
  days: 1,
});
assert.equal(noMeal.deliveryAllowed, false, "meal contract remains required for graceful delivery");

const parkA = place("ChIJRecoveryParkA", "Park A", "park");
const parkB = place("ChIJRecoveryParkB", "Park B", "park");
const guardedRefill = refillMissingDaySlots({
  plans: [{ day: 1, entries: [
    { time: "09:30", label: "景點", name: parkA.name, place: parkA },
    { time: "12:30", label: "午餐", name: lunchA.name, place: lunchA },
    { time: "18:30", label: "晚餐", name: lunchB.name, place: lunchB },
  ] }],
  pool: [parkA, parkB, lunchA, lunchB],
  days: 1,
  style: "mixed",
  preservePartialDays: true,
  respectDiversityCaps: true,
});
const parkCount = guardedRefill[0].entries.filter(
  (entry) => classifyDailyDiversityCategory(entry.place) === "park_family",
).length;
assert.equal(parkCount, 1, "rate-limit refill must preserve all existing diversity caps");
assert.equal(guardedRefill[0].entries.length >= 3, true, "partial real stops are retained when recovery is exhausted");

console.log("verify-itinerary-rate-limit-recovery: OK");
