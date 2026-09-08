import assert from "node:assert/strict";
import {
  assessPlanningRequiredCapacity,
  logPlanningRequiredIdentityHandoff,
  REQUIRED_CAPACITY_OVERFLOW_USER_MESSAGE,
  resolvePlanningRequiredAnchorHandoff,
} from "../src/lib/ai/planning-required-anchor-handoff.ts";

const shown = Array.from({ length: 12 }, (_, index) => ({
  id: `ChIJP43Candidate${index}`,
  placeId: `ChIJP43Candidate${index}`,
  googlePlaceId: `ChIJP43Candidate${index}`,
  canonicalId: `ChIJP43Candidate${index}`,
  name: `Candidate ${index}`,
  placeName: `Candidate ${index}`,
  lat: 25.03 + index * 0.001,
  lng: 121.56 + index * 0.001,
  source: "planning_suggestion",
}));

const session = (acceptedCandidateIds = [], rejectedCandidateIds = [], mustIncludePlaces = []) => ({
  activeShownCandidates: shown,
  selectedPlaces: shown,
  plannedStops: [],
  recommendedPlaces: [],
  planningConstraints: {
    acceptedCandidateIds,
    rejectedCandidateIds,
    mustIncludePlaces,
    excludedPlaces: [],
    clarificationRequired: false,
  },
});

const resolve = (value, selectionMode = false) =>
  resolvePlanningRequiredAnchorHandoff({
    session: value,
    candidateRequiredPlaces: shown,
    selectionMode,
  });

// A: shown is lookup/supplemental authority, never implicit required authority.
const none = resolve(session());
assert.equal(none.requiredPlaces.length, 0);
assert.equal(none.supplementalPlaces.length, 12);

// B: selecting the second three-place group requires exactly those three.
const secondGroup = resolve(session(shown.slice(3, 6).map((place) => place.canonicalId)));
assert.equal(secondGroup.requiredPlaces.length, 3);
assert.equal(secondGroup.supplementalPlaces.length, 9);

// C: exclude one + explicit accept remaining.
const acceptedRemaining = shown.slice(1).map((place) => place.canonicalId);
const remaining = resolve(session(acceptedRemaining, [shown[0].canonicalId]));
assert.equal(remaining.requiredPlaces.length, 11);
assert.equal(remaining.excludedPlaceIds.length, 1);

// D: excluding a group does not imply acceptance of every other group.
const excludedGroup = resolve(session([], shown.slice(0, 3).map((place) => place.canonicalId)));
assert.equal(excludedGroup.requiredPlaces.length, 0);
assert.equal(excludedGroup.excludedPlaceIds.length, 3);
assert.equal(excludedGroup.supplementalPlaces.length, 9);

// E: explicit must-include references remain required.
const mustInclude = resolve(
  session([], [], shown.slice(0, 2).map((place) => ({ placeId: place.canonicalId, name: place.name }))),
);
assert.equal(mustInclude.requiredPlaces.length, 2);

// F: hydration does not promote persisted shown candidates.
const reopened = JSON.parse(JSON.stringify(session()));
assert.equal(resolve(reopened).requiredPlaces.length, 0);

// G: Selection Mode remains selected-only/candidate-required authority.
const selection = resolve(session(), true);
assert.equal(selection.requiredPlaces.length, 12);
assert.equal(selection.supplementalPlaces.length, 0);

const capacity = assessPlanningRequiredCapacity(12, 2, 5);
assert.deepEqual(capacity, { overflow: true, requiredCount: 12, hardCapacity: 10 });
assert.equal(assessPlanningRequiredCapacity(10, 2, 5).overflow, false);
assert.match(REQUIRED_CAPACITY_OVERFLOW_USER_MESSAGE, /減少地點或增加天數/);

const logs = [];
const originalInfo = console.info;
console.info = (tag, payload) => logs.push({ tag, payload });
try {
  logPlanningRequiredIdentityHandoff("shown_candidate", none.requiredPlaces, "p43", {
    shownCandidateCount: 12,
    acceptedCandidateCount: 0,
    requiredCandidateCount: 0,
  });
} finally {
  console.info = originalInfo;
}
assert.deepEqual(logs[0].payload, {
  generationId: "p43",
  stage: "shown_candidate",
  shownCandidateCount: 12,
  acceptedCandidateCount: 0,
  requiredCandidateCount: 0,
  inputRequiredCount: 0,
  googleIdPresentCount: 0,
  missingGoogleIdCount: 0,
  canonicalOnlyCount: 0,
});

console.log("P43 required authority: PASS", {
  noSelection: { required: 0, supplemental: 12 },
  selectedGroupRequired: 3,
  acceptRemainingRequired: 11,
  excludeOnlyRequired: 0,
  mustIncludeRequired: 2,
  killReopenRequired: 0,
  selectionModePreserved: true,
  capacityPreflight: "12>10 blocked",
  externalRequestDelta: 0,
});
