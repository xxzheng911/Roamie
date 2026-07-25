import assert from "node:assert/strict";
import { assignDiversityAwareSeedDays } from "../src/lib/ai/diversity-aware-seed-assignment.ts";
import { classifyDailyDiversityCategory } from "../src/lib/ai/daily-category-diversity.ts";
import { buildMixedItineraryWithDiagnostics } from "../src/lib/trip/mixed-itinerary-schedule.ts";

function place(id, primaryType, options = {}) {
  return {
    name: options.name ?? id,
    placeName: options.name ?? id,
    type: primaryType,
    primaryType,
    types: [primaryType, "tourist_attraction"],
    description: id,
    reason: id,
    estimatedTime: "1-2 小時",
    address: `${id} address`,
    lat: options.lat ?? 34.69,
    lng: options.lng ?? 135.5,
    googleMapsUrl: "",
    googlePlaceId: `ChIJ${id}`,
    reasonSource: "template",
    rating: 4.5,
    userRatingCount: 500,
    sourceCombinationId: options.combinationId,
    sourceCombinationIds: options.combinationId ? [options.combinationId] : undefined,
    matchedSelectedCombinationIds: options.combinationId ? [options.combinationId] : undefined,
    sourceRegionCandidate: options.sourceRegionCandidate,
    isRequiredBySelection: options.required,
  };
}

function seedCandidates(items, preferredDay = 0) {
  return items.map((item) => ({
    item,
    preferredDay,
    preferredCenter: { lat: 34.69, lng: 135.5 },
  }));
}

function family(item) {
  return classifyDailyDiversityCategory({
    id: item.googlePlaceId,
    name: item.placeName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    rating: item.rating,
    userRatingCount: item.userRatingCount,
    photoName: null,
    primaryType: item.primaryType,
    types: item.types,
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  });
}

function countsByDay(result, expectedFamily) {
  return result.dayPlaces.map(
    (items) => items.filter((item) => family(item) === expectedFamily).length,
  );
}

for (const [primaryType, expectedFamily] of [
  ["park", "park_family"],
  ["observation_deck", "viewpoint_family"],
  ["zoo", "wildlife_family"],
  ["market", "market_family"],
]) {
  const items = Array.from({ length: primaryType === "park" ? 6 : 2 }, (_, index) =>
    place(`${primaryType}${index}`, primaryType),
  );
  const result = assignDiversityAwareSeedDays({
    candidates: seedCandidates(items),
    dayCount: primaryType === "park" ? 6 : 2,
    dailyScenicCapacity: 3,
  });
  assert.ok(countsByDay(result, expectedFamily).every((count) => count <= 1));
  assert.equal(result.dayByKey.size, items.length);
}

const mixed = [
  place("Park", "park"),
  place("Museum", "museum"),
  place("Attraction", "tourist_attraction"),
];
const mixedResult = assignDiversityAwareSeedDays({
  candidates: seedCandidates(mixed, 1),
  dayCount: 3,
  dailyScenicCapacity: 3,
});
assert.deepEqual(
  mixedResult.dayPlaces[1].map((item) => item.name),
  mixed.map((item) => item.name),
);

const requiredPark = place("RequiredPark", "park", { required: true, combinationId: 1 });
const optionalPark = place("OptionalPark", "park", { combinationId: 2 });
const requiredResult = assignDiversityAwareSeedDays({
  candidates: seedCandidates([optionalPark, requiredPark]),
  dayCount: 2,
  dailyScenicCapacity: 3,
});
assert.equal(requiredResult.dayByKey.size, 2);
assert.notEqual(
  requiredResult.dayByKey.get(requiredPark.googlePlaceId),
  requiredResult.dayByKey.get(optionalPark.googlePlaceId),
);

const infeasibleRequired = Array.from({ length: 4 }, (_, index) =>
  place(`Required${index}`, "park", { required: true }),
);
const infeasibleResult = assignDiversityAwareSeedDays({
  candidates: seedCandidates(infeasibleRequired),
  dayCount: 2,
  dailyScenicCapacity: 3,
});
assert.equal(infeasibleResult.dayByKey.size, 4);
assert.ok(countsByDay(infeasibleResult, "park_family").some((count) => count > 1));

const nearby = place("NearbyPark", "park", {
  sourceRegionCandidate: "Nearby Region",
  combinationId: 3,
});
const nearbyResult = assignDiversityAwareSeedDays({
  candidates: seedCandidates([nearby]),
  dayCount: 2,
  dailyScenicCapacity: 3,
});
assert.equal(nearbyResult.dayPlaces[0][0].sourceRegionCandidate, "Nearby Region");
assert.deepEqual(nearbyResult.dayPlaces[0][0].matchedSelectedCombinationIds, [3]);

const uniqueIds = new Set(
  [...requiredResult.dayPlaces.flat(), ...nearbyResult.dayPlaces.flat()].map(
    (item) => item.googlePlaceId,
  ),
);
assert.equal(uniqueIds.size, 3);

// Active selected-scenic pipeline regression: a globally feasible pool must
// reach the first post-seed plan without recreating a daily park overflow.
const integratedPool = [
  ...Array.from({ length: 6 }, (_, index) =>
    place(`IntegratedPark${index}`, "park", {
      lat: 34.69 + index * 0.0001,
      lng: 135.5 + index * 0.0001,
    }),
  ),
  ...Array.from({ length: 12 }, (_, index) =>
    place(`IntegratedAttraction${index}`, "tourist_attraction", {
      lat: 34.69 + index * 0.0001,
      lng: 135.5 + index * 0.0001,
    }),
  ),
];
const integrated = buildMixedItineraryWithDiagnostics(
  integratedPool,
  6,
  "2027-02-01",
  "Fixture City",
  { pace: "medium" },
);
const parkCountsByDate = new Map();
for (const stop of integrated.stops) {
  if (stop.placeType !== "park") continue;
  parkCountsByDate.set(stop.date, (parkCountsByDate.get(stop.date) ?? 0) + 1);
}
assert.equal(
  [...parkCountsByDate.values()].reduce((sum, count) => sum + count, 0),
  6,
);
assert.ok([...parkCountsByDate.values()].every((count) => count <= 1));

console.log("verify-diversity-aware-seed-assignment: OK");
