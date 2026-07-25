import assert from "node:assert/strict";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
} from "../src/lib/ai/daily-category-diversity.ts";
import { repairDailyDiversityByMove } from "../src/lib/ai/itinerary-day-coverage.ts";
import { buildSelectedPlaceLock } from "../src/lib/ai/required-anchor-runtime.ts";

function place(id, name, primaryType, types = [primaryType]) {
  return {
    id,
    name,
    localizedDisplayName: name,
    address: "Generic destination",
    lat: 25,
    lng: 121,
    rating: 4.5,
    userRatingCount: 500,
    photoName: null,
    primaryType,
    types,
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    coordinateSource: "google_places",
  };
}

function entry(candidate, time = "10:00", label = "景點") {
  return { time, label, name: candidate.name, place: candidate };
}

function allIds(plans) {
  return plans.flatMap((plan) => plan.entries.map((item) => item.place.id)).sort();
}

function familyCount(plan, family) {
  return plan.entries.filter((item) => classifyDailyDiversityCategory(item.place) === family)
    .length;
}

function assertWithinFormalCaps(plans) {
  const limits = resolveDailyDiversityLimits();
  for (const plan of plans) {
    for (const [family, cap] of Object.entries(limits)) {
      assert.ok(familyCount(plan, family) <= cap, `day ${plan.day} ${family} exceeds ${cap}`);
    }
  }
}

function verifyRequiredMove(primaryType, expectedFamily) {
  const requiredA = place(`ChIJ_${primaryType}_a`, `${primaryType} A`, primaryType);
  const requiredB = place(`ChIJ_${primaryType}_b`, `${primaryType} B`, primaryType);
  const restaurant = place("ChIJ_restaurant", "Restaurant", "restaurant");
  const attraction = place("ChIJ_attraction", "Attraction", "tourist_attraction");
  const plans = [
    { day: 1, entries: [entry(requiredA), entry(requiredB, "14:00")] },
    { day: 2, entries: [entry(restaurant, "12:00", "午餐")] },
    { day: 3, entries: [entry(attraction)] },
  ];
  const beforeIds = allIds(plans);
  const repaired = repairDailyDiversityByMove({
    plans,
    tripDays: 3,
    lock: buildSelectedPlaceLock({ placeIds: [requiredA.id, requiredB.id] }),
  });

  assert.equal(repaired.moved, 1);
  assert.deepEqual(allIds(repaired.plans), beforeIds, "required place identity set is unchanged");
  assertWithinFormalCaps(repaired.plans);
  assert.equal(repaired.plans.filter((plan) => familyCount(plan, expectedFamily) === 1).length, 2);
  const meal = repaired.plans
    .flatMap((plan) => plan.entries)
    .find((item) => item.place.id === restaurant.id);
  assert.deepEqual(
    {
      time: meal?.time,
      label: meal?.label,
      day: repaired.plans.find((plan) => plan.entries.includes(meal))?.day,
    },
    { time: "12:00", label: "午餐", day: 2 },
    "meal allocation remains unchanged",
  );
}

verifyRequiredMove("park", "park_family");
verifyRequiredMove("museum", "museum_family");
verifyRequiredMove("monument", "monument");

// A recipient containing the same canonical place is rejected; no duplicate is added there.
const duplicateA = place("ChIJ_duplicate_a", "Park A", "park");
const duplicateB = place("ChIJ_duplicate_b", "Park B", "park");
const duplicatePlans = [
  { day: 1, entries: [entry(duplicateA), entry(duplicateB)] },
  { day: 2, entries: [entry(duplicateB)] },
];
const duplicateResult = repairDailyDiversityByMove({
  plans: duplicatePlans,
  tripDays: 2,
  lock: buildSelectedPlaceLock({ placeIds: [duplicateA.id, duplicateB.id] }),
});
assert.equal(duplicateResult.moved, 0);
assert.equal(
  duplicateResult.plans[1].entries.filter((item) => item.place.id === duplicateB.id).length,
  1,
);
assert.deepEqual(allIds(duplicateResult.plans), allIds(duplicatePlans));

// No legal recipient preserves the original required stops and reports no move.
const noRecipientA = place("ChIJ_no_recipient_a", "Museum A", "museum");
const noRecipientB = place("ChIJ_no_recipient_b", "Museum B", "museum");
const noRecipientC = place("ChIJ_no_recipient_c", "Museum C", "museum");
const noRecipientPlans = [
  { day: 1, entries: [entry(noRecipientA), entry(noRecipientB)] },
  { day: 2, entries: [entry(noRecipientC)] },
];
const noRecipientResult = repairDailyDiversityByMove({
  plans: noRecipientPlans,
  tripDays: 2,
  lock: buildSelectedPlaceLock({ placeIds: [noRecipientA.id, noRecipientB.id] }),
});
assert.equal(noRecipientResult.moved, 0);
assert.deepEqual(allIds(noRecipientResult.plans), allIds(noRecipientPlans));

// Existing non-required overflow behavior remains movable.
const optionalA = place("ChIJ_optional_a", "Optional Park A", "park");
const optionalB = place("ChIJ_optional_b", "Optional Park B", "park");
const optionalResult = repairDailyDiversityByMove({
  plans: [
    { day: 1, entries: [entry(optionalA), entry(optionalB)] },
    { day: 2, entries: [] },
  ],
  tripDays: 2,
});
assert.equal(optionalResult.moved, 1);
assertWithinFormalCaps(optionalResult.plans);

// This project currently has no assignedDate/fixedDate contract on required anchors.
const lockShape = buildSelectedPlaceLock({ placeIds: [optionalA.id] });
assert.equal("fixedDate" in lockShape, false);
assert.equal("assignedDate" in lockShape, false);

const limits = resolveDailyDiversityLimits();
assert.equal(limits.park_family, 1);
assert.equal(limits.museum_family, 1);
assert.equal(limits.monument, 1);

console.log("verify-required-place-cross-day-move: ok");
