import assert from "node:assert/strict";
import {
  ensureAllDaysCovered,
  repairDailyDiversityByMove,
} from "../src/lib/ai/itinerary-day-coverage.ts";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
} from "../src/lib/ai/daily-category-diversity.ts";
import { buildSelectedPlaceLock } from "../src/lib/ai/required-anchor-runtime.ts";
import { shouldRepairDayCoverage } from "../src/lib/ai/itinerary-validator/replan.ts";

function place(id, primaryType) {
  return {
    id,
    name: `Place ${id}`,
    address: "Test destination",
    lat: 25 + Number(id.replace(/\D/g, "")) * 0.001,
    lng: 121,
    primaryType,
    types: [primaryType, "tourist_attraction"],
    rating: 4.5,
    userRatingCount: 500,
  };
}

function entry(candidate) {
  return { time: "10:00", label: "景點", name: candidate.name, place: candidate };
}

function stopCount(plans) {
  return plans.reduce((count, plan) => count + plan.entries.length, 0);
}

function assertWithinCaps(plans) {
  const limits = resolveDailyDiversityLimits();
  for (const plan of plans) {
    const counts = new Map();
    for (const item of plan.entries) {
      const family = classifyDailyDiversityCategory(item.place);
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    for (const [family, count] of counts) {
      const cap = limits[family];
      if (typeof cap === "number") {
        assert.ok(count <= cap, `day ${plan.day} ${family}: ${count}>${cap}`);
      }
    }
  }
}

// A conflicting park move is rejected and another eligible donor is selected.
const parkA = place("p1", "park");
const parkB = place("p2", "park");
const museumA = place("m1", "museum");
const attractionA = place("a1", "tourist_attraction");
const attractionB = place("a2", "tourist_attraction");
const attractionC = place("a3", "tourist_attraction");
const initial = [
  { day: 1, entries: [parkA, attractionA].map(entry) },
  { day: 2, entries: [parkB, attractionB, museumA, attractionC].map(entry) },
  { day: 3, entries: [] },
];
const initialCount = stopCount(initial);
const covered = ensureAllDaysCovered({ plans: initial, tripDays: 3, source: "verification" });
assert.equal(stopCount(covered.plans), initialCount);
assertWithinCaps(covered.plans);
assert.ok(covered.plans[2].entries.length > 0, "empty recipient is covered");

// The same guard applies to non-park capped families.
const museumPlans = [
  { day: 1, entries: [place("m2", "museum"), attractionA].map(entry) },
  {
    day: 2,
    entries: [place("m3", "museum"), attractionB, attractionC, place("a4", "tourist_attraction")].map(entry),
  },
  { day: 3, entries: [] },
];
const museumCount = stopCount(museumPlans);
const museumCovered = ensureAllDaysCovered({
  plans: museumPlans,
  tripDays: 3,
  source: "verification_museum",
});
assert.equal(stopCount(museumCovered.plans), museumCount);
assertWithinCaps(museumCovered.plans);

// Heavy-to-light balancing rejects a capped family and chooses another donor entry.
const balancePlans = [
  { day: 1, entries: [place("p10", "park"), place("a10", "tourist_attraction")].map(entry) },
  {
    day: 2,
    entries: [
      place("a11", "tourist_attraction"),
      place("a12", "tourist_attraction"),
      place("p11", "park"),
      place("a13", "tourist_attraction"),
    ].map(entry),
  },
];
const balanced = ensureAllDaysCovered({ plans: balancePlans, tripDays: 2 });
assert.equal(stopCount(balanced.plans), stopCount(balancePlans));
assertWithinCaps(balanced.plans);
assert.ok(
  balanced.plans[1].entries.some((item) => item.place.id === "p11"),
  "park donor remains because recipient already reached park cap",
);

// Locked entries are never selected as donors and no stop is dropped.
const lockedPlace = place("locked1", "tourist_attraction");
const lockedPlans = [
  { day: 1, entries: [attractionA].map(entry) },
  { day: 2, entries: [attractionB, lockedPlace, attractionC].map(entry) },
  { day: 3, entries: [] },
];
const lockedResult = ensureAllDaysCovered({
  plans: lockedPlans,
  tripDays: 3,
  lock: buildSelectedPlaceLock({ placeIds: [lockedPlace.id] }),
});
assert.equal(stopCount(lockedResult.plans), stopCount(lockedPlans));
assert.ok(
  lockedResult.plans[1].entries.some((item) => item.place.id === lockedPlace.id),
  "locked entry stays on donor day",
);

// An empty recipient skips a cap-zero donor and accepts the next legal entry.
const monument = {
  ...place("monument1", "monument"),
  types: ["monument"],
  rating: 3,
  userRatingCount: 1,
};
const emptyRecipientPlans = [
  { day: 1, entries: [attractionA].map(entry) },
  { day: 2, entries: [attractionB, monument, attractionC].map(entry) },
  { day: 3, entries: [] },
];
const emptyRecipientResult = ensureAllDaysCovered({
  plans: emptyRecipientPlans,
  tripDays: 3,
});
assert.equal(stopCount(emptyRecipientResult.plans), stopCount(emptyRecipientPlans));
assert.ok(
  emptyRecipientResult.plans[1].entries.some((item) => item.place.id === monument.id),
  "cap-zero donor is not moved even when recipient is empty",
);

// No eligible donor leaves the plan unchanged and never drops a stop.
const noDonor = [
  { day: 1, entries: [parkA].map(entry) },
  { day: 2, entries: [parkB].map(entry) },
  { day: 3, entries: [] },
];
const noDonorSignature = JSON.stringify(noDonor);
const noDonorResult = ensureAllDaysCovered({ plans: noDonor, tripDays: 3 });
assert.equal(stopCount(noDonorResult.plans), stopCount(noDonor));
assert.equal(JSON.stringify(noDonorResult.plans), noDonorSignature);

// A repaired diversity plan stays within caps after coverage balancing.
const repaired = repairDailyDiversityByMove({
  plans: [
    { day: 1, entries: [parkA, parkB, attractionA].map(entry) },
    { day: 2, entries: [museumA, attractionB].map(entry) },
    { day: 3, entries: [attractionC].map(entry) },
  ],
  tripDays: 3,
});
const repairedCount = stopCount(repaired.plans);
let stabilized = repaired.plans;
for (let attempt = 0; attempt < 3; attempt += 1) {
  stabilized = ensureAllDaysCovered({ plans: stabilized, tripDays: 3 }).plans;
  assert.equal(stopCount(stabilized), repairedCount);
  assertWithinCaps(stabilized);
}

assert.equal(
  shouldRepairDayCoverage(["replan_daily_category_diversity"], [3, 4, 4]),
  false,
  "diversity affected days alone do not trigger coverage routing",
);
assert.equal(
  shouldRepairDayCoverage(["replan_for_full_day_coverage"], [3, 4, 4]),
  true,
);
assert.equal(shouldRepairDayCoverage([], [3, 0, 4]), true);

console.log("verify-day-coverage-diversity-stability: ok");
