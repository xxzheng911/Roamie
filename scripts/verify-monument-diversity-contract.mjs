import assert from "node:assert/strict";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
  summarizeDailyCategoryDiversity,
  validateDailyDiversityLimitContract,
  wouldViolateDailyDiversity,
} from "../src/lib/ai/daily-category-diversity.ts";
import { repairDailyDiversityByMove } from "../src/lib/ai/itinerary-day-coverage.ts";

function place(id, name, primaryType, types = [primaryType]) {
  return {
    id,
    name,
    localizedDisplayName: name,
    address: "Generic destination",
    lat: 48.86,
    lng: 2.35,
    rating: 3,
    userRatingCount: 1,
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

function entry(candidate, time = "10:00") {
  return { time, label: "景點", name: candidate.name, place: candidate };
}

const arc = place("ChIJ_arc", "巴黎凱旋門", "monument", ["monument", "historical_landmark"]);
const pantheon = place("ChIJ_pantheon", "先賢祠", "historical_landmark", ["historical_landmark"]);
const memorial = place("ChIJ_memorial", "Generic Memorial", "monument");
const museumA = place("ChIJ_museum_a", "Museum A", "museum", ["museum"]);
const museumB = place("ChIJ_museum_b", "Museum B", "museum", ["museum"]);
const parkA = place("ChIJ_park_a", "Park A", "park", ["park"]);
const parkB = place("ChIJ_park_b", "Park B", "park", ["park"]);

const limits = resolveDailyDiversityLimits();
assert.equal(limits.monument, 1);
assert.deepEqual(validateDailyDiversityLimitContract(limits), {
  valid: true,
  invalidCategories: [],
});
assert.equal(validateDailyDiversityLimitContract({ ...limits, monument: 0 }).valid, false);

assert.equal(classifyDailyDiversityCategory(arc), "monument");
assert.equal(classifyDailyDiversityCategory(pantheon), "monument");
assert.equal(summarizeDailyCategoryDiversity(1, [arc]).gatePass, true);
assert.equal(summarizeDailyCategoryDiversity(1, [pantheon]).gatePass, true);
assert.equal(wouldViolateDailyDiversity([], arc, limits).ok, true);
assert.equal(wouldViolateDailyDiversity([arc], pantheon, limits).ok, false);

const atCap = summarizeDailyCategoryDiversity(1, [arc]);
assert.equal(atCap.gatePass, true);
const overCap = summarizeDailyCategoryDiversity(1, [arc, pantheon]);
assert.equal(overCap.gatePass, false);
assert.deepEqual(overCap.violations, ["monument:2>1"]);
assert.equal(overCap.categoryCounts.monument, 2);

const repaired = repairDailyDiversityByMove({
  plans: [
    { day: 1, entries: [entry(arc), entry(pantheon)] },
    { day: 2, entries: [entry(museumA)] },
  ],
  tripDays: 2,
});
assert.equal(repaired.moved, 1);
assert.equal(repaired.plans[0].entries.length, 1);
assert.equal(repaired.plans[1].entries.length, 2);
assert.equal(
  repaired.plans.every((plan) =>
    summarizeDailyCategoryDiversity(plan.day, plan.entries.map((item) => item.place)).gatePass,
  ),
  true,
);

const fullRecipients = repairDailyDiversityByMove({
  plans: [
    { day: 1, entries: [entry(arc), entry(pantheon)] },
    { day: 2, entries: [entry(memorial)] },
  ],
  tripDays: 2,
});
assert.equal(fullRecipients.moved, 0);
assert.equal(fullRecipients.plans.reduce((sum, plan) => sum + plan.entries.length, 0), 3);

assert.deepEqual(summarizeDailyCategoryDiversity(1, [museumA, museumB]).violations, [
  "museum_family:2>1",
]);
assert.deepEqual(summarizeDailyCategoryDiversity(1, [parkA, parkB]).violations, [
  "park_family:2>1",
]);

const unknown = place("ChIJ_unknown", "Unknown Attraction", "unknown_type", ["unknown_type"]);
const unknownCheck = wouldViolateDailyDiversity([], unknown, limits);
assert.equal(unknownCheck.category, "other");
assert.equal(unknownCheck.limit, Number.POSITIVE_INFINITY);
assert.equal(unknownCheck.ok, true);

console.log("verify-monument-diversity-contract: ok");
