import assert from "node:assert/strict";
import {
  enforcePlanningCombinationComposition,
  filterCandidatesForProposedCombinationTheme,
} from "../src/lib/ai/destination-combination-discovery.ts";
import {
  inspectCoastAuthority,
  validatePlaceForCombination,
} from "../src/lib/ai/combination-category-contract.ts";

const make = (suffix, name, primaryType, types = [primaryType], lat = 25.03) => ({
  name,
  googlePlaceId: `ChIJP424${suffix}`,
  searchCandidateId: `ChIJP424${suffix}`,
  coordinates: { lat, lng: 121.56 + suffix.length * 0.001 },
  address: "Fixture destination",
  primaryType,
  types,
  rating: 4.5,
  userRatingCount: 500,
  businessStatus: "OPERATIONAL",
});

const waterfront = make("Waterfront", "大稻埕碼頭水岸", "pier", ["pier", "tourist_attraction"]);
const dogPark = make("DogPark", "信義區信義廣場狗活動區", "dog_park", ["dog_park", "park"]);
const plaza = make("Plaza", "Civic Plaza", "plaza", ["plaza", "point_of_interest"]);
const generic = make("Generic", "Generic POI", "point_of_interest");
const harbor = make("Harbor", "Kaohsiung Harbor", "harbor", ["harbor", "tourist_attraction"], 22.62);
const riverside = make("Riverside", "City Riverside", "riverside", ["riverside", "park"], 22.64);

assert.equal(inspectCoastAuthority(waterfront).coastAuthorityPresent, true);
assert.equal(inspectCoastAuthority(dogPark).coastAuthorityPresent, false);
assert.equal(validatePlaceForCombination(generic, "coast").valid, false);

const deliver = (places) =>
  enforcePlanningCombinationComposition([
    {
      combinationId: "fixture:coast",
      title: "海岸夕陽組合",
      theme: "coast",
      placeCandidates: places,
      primaryCandidates: places,
    },
  ]);

assert.equal(deliver([waterfront, dogPark]).length, 0, "one true coast candidate removes group");
assert.equal(deliver([harbor, riverside]).length, 1, "two coast-authority candidates show group");
assert.equal(deliver([dogPark, plaza]).length, 0, "park and plaza cannot form coast group");

const directedTopUp = filterCandidatesForProposedCombinationTheme(
  [generic],
  "coast",
  "海岸夕陽組合",
  "fixture:topup",
);
assert.equal(directedTopUp.length, 0, "coast query provenance is not semantic authority");

const leftover = filterCandidatesForProposedCombinationTheme(
  [harbor, dogPark, plaza],
  "coast",
  "海岸夕陽組合",
  "fixture:leftover",
);
assert.deepEqual(leftover.map((place) => place.name), ["Kaohsiung Harbor"]);
assert.equal(deliver(leftover).length, 0, "contaminated leftover coast group is removed");

for (const place of [
  make("Kaohsiung", "高雄港", "harbor", ["harbor"]),
  make("Tokyo", "Tokyo Bay Waterfront", "waterfront", ["waterfront"]),
  make("Busan", "Busan Seaside", "beach", ["beach"]),
]) {
  assert.equal(validatePlaceForCombination(place, "coast").valid, true, place.name);
}

const logs = [];
const originalInfo = console.info;
console.info = (tag, payload) => logs.push({ tag, payload });
try {
  deliver([waterfront, dogPark]);
} finally {
  console.info = originalInfo;
}
const dogDecision = logs.find(
  (entry) =>
    entry.tag === "[PLANNING_COMBINATION_CANDIDATE_DECISION]" &&
    entry.payload.dropReason === "coast_authority_missing",
);
assert(dogDecision);
assert.equal(dogDecision.payload.coastAuthorityPresent, false);
assert.equal(dogDecision.payload.semanticContractPassed, false);
const composition = logs.find((entry) => entry.tag === "[PLANNING_COMBINATION_COMPOSITION]");
assert.equal(composition.payload.coastAuthorityDropped, 1);

console.log("P42.4 coast admission: PASS", {
  coastStrictContract: true,
  dogParkLeakage: 0,
  genericTopUpLeakage: 0,
  leftoverContamination: 0,
  shortageGroupRemoved: true,
  generalizedFixtures: ["Kaohsiung", "Tokyo", "Busan"],
  externalRequestDelta: 0,
});
