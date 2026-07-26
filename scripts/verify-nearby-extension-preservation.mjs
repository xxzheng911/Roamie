import assert from "node:assert/strict";
import { enforceGlobalFamilyFeasibility } from "../src/lib/ai/global-family-feasibility.ts";
import {
  matchesNearbyExtension,
  selectBoundedCandidatesWithNearbyMinimum,
} from "../src/lib/ai/nearby-extension-preservation.ts";

function place(id, name, overrides = {}) {
  return {
    id,
    googlePlaceId: id,
    name,
    placeName: name,
    address: `${name} address`,
    lat: 35.4,
    lng: 139.6,
    rating: 4.5,
    userRatingCount: 1000,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    type: "attraction",
    description: name,
    reason: name,
    estimatedTime: "1 hour",
    ...overrides,
  };
}

const primary = Array.from({ length: 24 }, (_, index) =>
  place(`ChIJTokyo${String(index).padStart(2, "0")}`, `Tokyo ${index + 1}`, {
    sourceCombinationId: index < 6 ? 1 : index < 12 ? 3 : undefined,
    matchedSelectedCombinationIds: index < 6 ? [1] : index < 12 ? [3] : [],
    destinationScope: "primary",
  }),
);
const yokohama = Array.from({ length: 8 }, (_, index) =>
  place(`ChIJYokohama${index}`, `Yokohama ${index + 1}`, {
    destinationScope: "nearby_extension",
    extensionDestination: "橫濱",
    sourceRegionCandidate: "橫濱",
  }),
);

const runtime = selectBoundedCandidatesWithNearbyMinimum({
  candidates: [...primary, ...yokohama],
  targetCount: 24,
  selectedCombinationIds: [1, 3],
  nearbyExtensions: ["橫濱"],
});
assert.equal(runtime.selected.length, 24, "bounded count remains 24");
assert.ok(
  runtime.selected.filter((candidate) => matchesNearbyExtension(candidate, "橫濱")).length >= 2,
  "tail-positioned Yokohama candidates meet the formal minimum",
);
assert.ok(
  runtime.selected.filter((candidate) => candidate.matchedSelectedCombinationIds?.includes(1))
    .length >= 6,
  "combination 1 minimum remains represented",
);
assert.ok(
  runtime.selected.filter((candidate) => candidate.matchedSelectedCombinationIds?.includes(3))
    .length >= 6,
  "combination 3 minimum remains represented",
);

const oneNearby = selectBoundedCandidatesWithNearbyMinimum({
  candidates: [...primary, yokohama[0]],
  targetCount: 24,
  selectedCombinationIds: [1, 3],
  nearbyExtensions: ["橫濱"],
});
assert.equal(oneNearby.decisions[0].preservedCount, 1);
assert.equal(oneNearby.decisions[0].sufficient, false);
assert.equal(oneNearby.decisions[0].reason, "insufficient_verified_candidates");

const noneNearby = selectBoundedCandidatesWithNearbyMinimum({
  candidates: primary,
  targetCount: 24,
  selectedCombinationIds: [1, 3],
  nearbyExtensions: ["橫濱"],
});
assert.equal(noneNearby.decisions[0].preservedCount, 0);
assert.equal(noneNearby.decisions[0].reason, "no_verified_candidates");

const kawasaki = Array.from({ length: 4 }, (_, index) =>
  place(`ChIJKawasaki${index}`, `Kawasaki ${index + 1}`, {
    sourceRegionCandidate: "川崎",
  }),
);
const multiple = selectBoundedCandidatesWithNearbyMinimum({
  candidates: [...primary, ...yokohama.slice(0, 4), ...kawasaki],
  targetCount: 24,
  selectedCombinationIds: [1, 3],
  nearbyExtensions: ["橫濱", "川崎"],
});
assert.equal(
  multiple.selected.filter((candidate) => matchesNearbyExtension(candidate, "橫濱")).length,
  2,
);
assert.equal(
  multiple.selected.filter((candidate) => matchesNearbyExtension(candidate, "川崎")).length,
  2,
);

const expandedMinimum = selectBoundedCandidatesWithNearbyMinimum({
  candidates: [...yokohama.slice(0, 2), ...kawasaki.slice(0, 2)],
  targetCount: 2,
  selectedCombinationIds: [],
  nearbyExtensions: ["橫濱", "川崎"],
});
assert.equal(expandedMinimum.hardPreservedCount, 4);
assert.equal(expandedMinimum.finalBoundedCount, 4);
assert.equal(expandedMinimum.selected.length, 4, "cap expands only to the hard minimum total");

const misleadingPrimary = place("ChIJPrimaryYokohama", "Yokohama-named Tokyo place", {
  destinationScope: "primary",
  extensionDestination: "橫濱",
  sourceRegionCandidate: "橫濱",
});
assert.equal(matchesNearbyExtension(misleadingPrimary, "橫濱"), false);

const syntheticNearby = selectBoundedCandidatesWithNearbyMinimum({
  candidates: [
    place("local:synthetic-yokohama", "Synthetic Yokohama", {
      destinationScope: "nearby_extension",
      extensionDestination: "橫濱",
    }),
  ],
  targetCount: 1,
  selectedCombinationIds: [],
  nearbyExtensions: ["橫濱"],
});
assert.equal(syntheticNearby.decisions[0].verifiedCount, 0);
assert.equal(syntheticNearby.decisions[0].preservedCount, 0);

const familySelection = enforceGlobalFamilyFeasibility({
  candidates: [
    place("ChIJNearbyParkOne", "Nearby Park One", {
      primaryType: "park",
      types: ["park", "tourist_attraction"],
      destinationScope: "nearby_extension",
      extensionDestination: "橫濱",
    }),
    place("ChIJNearbyParkTwo", "Nearby Park Two", {
      primaryType: "park",
      types: ["park", "tourist_attraction"],
      destinationScope: "nearby_extension",
      extensionDestination: "橫濱",
    }),
    place("ChIJNearbyMuseum", "Nearby Museum", {
      primaryType: "museum",
      types: ["museum", "tourist_attraction"],
      destinationScope: "nearby_extension",
      extensionDestination: "橫濱",
    }),
  ],
  dayCount: 1,
  targetCount: 2,
  selectedCombinationIds: [],
  minimumPerCombination: 0,
  nearbyExtensions: ["橫濱"],
  style: "mixed",
});
assert.equal(familySelection.selected.length, 2);
assert.equal(
  familySelection.selected.filter((candidate) => matchesNearbyExtension(candidate, "橫濱")).length,
  2,
);
assert.equal(
  familySelection.selected.filter((candidate) => candidate.primaryType === "park").length,
  1,
  "same-extension museum replaces the second park under family capacity",
);

console.log("verify-nearby-extension-preservation: OK");
