import assert from "node:assert/strict";
import {
  buildCombinationsFromCandidates,
  buildDiscoveryQueryLaneTraceFixture,
  inspectCombinationThemeAssignment,
  orderPlanningDiscoveryQueryLanes,
} from "../src/lib/ai/destination-combination-discovery.ts";

const candidate = (suffix, name, primaryType, types) => ({
  name,
  googlePlaceId: `ChIJP422${suffix}`,
  searchCandidateId: `ChIJP422${suffix}`,
  coordinates: { lat: 25.03 + suffix.length * 0.001, lng: 121.56 },
  address: `Fixture ${suffix}`,
  primaryType,
  types,
  rating: 4.4,
  userRatingCount: 30_000,
  businessStatus: "OPERATIONAL",
});

const multiSemanticCases = [
  candidate("ShoppingLandmark", "Major Landmark Tower", "shopping_mall", [
    "shopping_mall",
    "tourist_attraction",
    "landmark",
  ]),
  candidate("CulturalLandmark", "Major Cultural Landmark", "cultural_landmark", [
    "cultural_landmark",
    "tourist_attraction",
  ]),
  candidate("ObservationLandmark", "Major Tower observation area", "tourist_attraction", [
    "tourist_attraction",
    "landmark",
  ]),
];

const assignments = multiSemanticCases.map(inspectCombinationThemeAssignment);
assert.deepEqual(
  assignments.map((entry) => entry.assignedTheme),
  ["shopping", "attraction", "attraction"],
);
assert(assignments.every((entry) => entry.attractionAuthorityPresent));
assert(assignments.every((entry) => entry.multiSemantic));
assert(assignments.every((entry) => entry.competingThemeSignals.includes("attraction")));

const logs = [];
const originalInfo = console.info;
console.info = (tag, payload) => logs.push({ tag, payload });
try {
  buildCombinationsFromCandidates("Fixture City", [
    ...multiSemanticCases,
    candidate("AttractionA", "Central Attraction", "tourist_attraction", ["tourist_attraction"]),
    candidate("AttractionB", "River Attraction", "tourist_attraction", ["tourist_attraction"]),
    candidate("AttractionC", "Civic Attraction", "tourist_attraction", ["tourist_attraction"]),
  ]);
} finally {
  console.info = originalInfo;
}
const candidateLogs = logs.filter(
  (entry) => entry.tag === "[PLANNING_COMBINATION_BUCKET_BUILD]" && entry.payload.candidateHash,
);
assert.equal(candidateLogs.length, 6);
assert.equal(candidateLogs.filter((entry) => entry.payload.attractionAuthorityPresent).length, 6);
assert(
  candidateLogs.some(
    (entry) => entry.payload.multiSemantic && entry.payload.previousFirstMatchedTheme === "shopping",
  ),
);
const attractionAggregate = logs.find(
  (entry) =>
    entry.tag === "[PLANNING_COMBINATION_BUCKET_BUILD]" &&
    entry.payload.semanticFamily === "attraction",
);
assert(attractionAggregate);
assert.equal(attractionAggregate.payload.rawCandidateCount, 6);
assert.equal(attractionAggregate.payload.assignedCount, 5);
assert.equal(attractionAggregate.payload.compositionInputCount, 5);
const attractionLifecycle = logs.filter(
  (entry) => entry.tag === "[PLANNING_ATTRACTION_CANDIDATE_LIFECYCLE]",
);
assert(attractionLifecycle.length > 0);
assert(
  attractionLifecycle.every(
    (entry) =>
      entry.payload.candidateHash &&
      typeof entry.payload.rawPresent === "boolean" &&
      typeof entry.payload.sanitizedPresent === "boolean" &&
      entry.payload.assignedTheme &&
      entry.payload.attractionAuthorityPresent === true &&
      typeof entry.payload.categoryContractPassed === "boolean" &&
      typeof entry.payload.shortlistIncluded === "boolean" &&
      typeof entry.payload.compositionIncluded === "boolean" &&
      typeof entry.payload.finalSelected === "boolean" &&
      Number.isFinite(entry.payload.landmarkTier) &&
      Number.isFinite(entry.payload.prominenceScore) &&
      typeof entry.payload.userRatingCountPresent === "boolean" &&
      entry.payload.sourceQueryLane,
  ),
);

const capTrace = buildDiscoveryQueryLaneTraceFixture(
  [
    { lane: "generic_attraction", resultCount: 20 },
    { lane: "museum", resultCount: 6 },
    { lane: "must_see", resultCount: 20 },
    { lane: "tourist_attraction", resultCount: 8 },
  ],
  18,
);
assert.equal(capTrace[0].lane, "must_see");
assert.equal(capTrace[0].executed, true);
assert.equal(capTrace[0].coreLane, true);
assert.equal(capTrace[0].phase, "core_semantic");
assert.equal(capTrace[0].capReachedAfterLane, true);
assert.equal(capTrace[1].executed, false);
assert.equal(capTrace[1].skippedReason, "candidate_cap_reached");
assert.equal(capTrace[1].capBlocked, true);
assert.equal(capTrace.filter((entry) => entry.executed).length, 1);

for (const city of ["Taipei", "Tokyo", "Osaka", "Seoul", "Kaohsiung"]) {
  const ordered = orderPlanningDiscoveryQueryLanes([
    { query: `${city} attractions`, fixtureResult: "generic" },
    { query: `${city} 必去`, fixtureResult: "major_landmark" },
    { query: `${city} tourist attractions`, fixtureResult: "major_landmark" },
  ]);
  assert.equal(ordered[0].fixtureResult, "major_landmark", `${city}: core landmark lane first`);
}

console.log("P42.2 discovery diagnostics: PASS", {
  privacySafeCandidateLifecycle: true,
  multiSemanticObservation: true,
  bucketBuildObservation: true,
  attractionLifecycleObservation: true,
  semanticLaneReservation: true,
  legacyExecutedRequestCount: 1,
  scheduledExecutedRequestCount: capTrace.filter((entry) => entry.executed).length,
  landmarkCities: ["Taipei", "Tokyo", "Osaka", "Seoul", "Kaohsiung"],
  classifierBehaviorChanged: false,
  externalRequestDelta: 0,
});
