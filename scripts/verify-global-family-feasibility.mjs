import assert from "node:assert/strict";
import { enforceGlobalFamilyFeasibility } from "../src/lib/ai/global-family-feasibility.ts";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
} from "../src/lib/ai/daily-category-diversity.ts";

function candidate(id, familyType, options = {}) {
  return {
    name: options.name ?? id,
    placeName: options.name ?? id,
    type: familyType,
    primaryType: familyType,
    types: [familyType, "tourist_attraction"],
    description: id,
    reason: id,
    estimatedTime: "1-2 小時",
    address: `${id} address`,
    lat: 34.68 + Number(id.replace(/\D/g, "") || 0) * 0.0001,
    lng: 135.5,
    googleMapsUrl: "",
    googlePlaceId: `ChIJ${id}`,
    reasonSource: "template",
    rating: 4.5,
    userRatingCount: 500,
    sourceCombinationId: options.combinationId,
    sourceCombinationIds: options.combinationId ? [options.combinationId] : undefined,
    matchedSelectedCombinationIds: options.combinationId ? [options.combinationId] : undefined,
    isRequiredBySelection: options.required,
  };
}

function family(candidateValue) {
  return classifyDailyDiversityCategory({
    id: candidateValue.googlePlaceId,
    name: candidateValue.name,
    address: candidateValue.address,
    lat: candidateValue.lat,
    lng: candidateValue.lng,
    rating: candidateValue.rating,
    userRatingCount: candidateValue.userRatingCount,
    photoName: null,
    primaryType: candidateValue.primaryType,
    types: candidateValue.types,
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  });
}

const parks = Array.from({ length: 14 }, (_, index) => candidate(`Park${index}`, "park"));
const alternatives = [
  ...Array.from({ length: 5 }, (_, index) => candidate(`Museum${index}`, "museum")),
  ...Array.from({ length: 4 }, (_, index) => candidate(`Monument${index}`, "monument")),
  ...Array.from({ length: 8 }, (_, index) => candidate(`Attraction${index}`, "tourist_attraction")),
];
const case1 = enforceGlobalFamilyFeasibility({
  candidates: [...parks, ...alternatives],
  dayCount: 6,
  targetCount: 18,
  selectedCombinationIds: [],
  minimumPerCombination: 0,
  style: "mixed",
});
assert.equal(case1.selected.filter((item) => family(item) === "park_family").length, 6);
assert.equal(case1.selected.length, 18);
assert.ok(case1.replacementCount > 0);

const requiredParks = Array.from({ length: 8 }, (_, index) =>
  candidate(`RequiredPark${index}`, "park", { required: true }),
);
const case2 = enforceGlobalFamilyFeasibility({
  candidates: [...requiredParks, ...alternatives],
  dayCount: 6,
  targetCount: 18,
  selectedCombinationIds: [],
  minimumPerCombination: 0,
  style: "mixed",
});
assert.equal(case2.selected.filter((item) => item.isRequiredBySelection).length, 8);
assert.equal(case2.globallyFeasible, false);

for (const [type, expectedFamily] of [
  ["zoo", "wildlife_family"],
  ["observation_deck", "viewpoint_family"],
  ["market", "market_family"],
]) {
  const overflowing = Array.from({ length: 5 }, (_, index) => candidate(`${type}${index}`, type));
  const result = enforceGlobalFamilyFeasibility({
    candidates: [...overflowing, ...alternatives],
    dayCount: 2,
    targetCount: 6,
    selectedCombinationIds: [],
    minimumPerCombination: 0,
    style: "mixed",
  });
  assert.ok(result.selected.filter((item) => family(item) === expectedFamily).length <= 2);
}

const comboCandidates = [
  candidate("Combo1Park", "park", { combinationId: 1 }),
  candidate("Combo2Museum", "museum", { combinationId: 2 }),
  candidate("Combo3Market", "market", { combinationId: 3 }),
  ...alternatives,
];
const case7 = enforceGlobalFamilyFeasibility({
  candidates: comboCandidates,
  dayCount: 3,
  targetCount: 9,
  selectedCombinationIds: [1, 2, 3],
  minimumPerCombination: 1,
  style: "mixed",
});
for (const combinationId of [1, 2, 3]) {
  assert.ok(
    case7.selected.some((item) => item.matchedSelectedCombinationIds?.includes(combinationId)),
  );
}

const noReplacement = enforceGlobalFamilyFeasibility({
  candidates: parks,
  dayCount: 2,
  targetCount: 6,
  selectedCombinationIds: [],
  minimumPerCombination: 0,
  style: "mixed",
});
assert.equal(noReplacement.selected.length, 2);
assert.equal(noReplacement.globallyFeasible, false);

const forty = Array.from({ length: 40 }, (_, index) =>
  candidate(`LargePool${index}`, "tourist_attraction"),
);
const bounded = enforceGlobalFamilyFeasibility({
  candidates: forty,
  dayCount: 6,
  targetCount: 18,
  selectedCombinationIds: [],
  minimumPerCombination: 0,
  style: "mixed",
});
assert.equal(bounded.selected.length, 18);

const ids = bounded.selected.map((item) => item.googlePlaceId);
assert.equal(new Set(ids).size, ids.length);

const limits = resolveDailyDiversityLimits({ style: "mixed" });
assert.equal(limits.park_family, 1);
assert.equal(limits.monument, 1);
assert.equal(limits.museum_family, 1);
assert.equal(limits.wildlife_family, 1);
assert.equal(limits.viewpoint_family, 1);
assert.equal(limits.market_family, 1);

console.log("verify-global-family-feasibility: OK");
