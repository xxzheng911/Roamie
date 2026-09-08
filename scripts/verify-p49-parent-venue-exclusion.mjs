import assert from "node:assert/strict";
import { collapseParentLandmarkCandidates } from "../src/lib/ai/ai-parent-landmark-dedup.ts";
import { isExcludedByPlaceOrAncestor, resolveVenueHierarchyRelation } from "../src/lib/ai/venue-hierarchy-relation.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";

const place = (id, name, lat, lng, address = "1 Landmark Plaza") => ({
  id,
  googlePlaceId: id,
  name,
  address,
  lat,
  lng,
  rating: 4.5,
  userRatingCount: 1000,
  photoName: null,
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
});
const validate = (stops, excludedPlaces, lockedPlaceIds = []) => validateItineraryPlan({
  plans: [{ day: 1, entries: stops.map((candidate, index) => ({ time: `${9 + index * 2}:00`, label: "景點", name: candidate.name, place: candidate })) }],
  requestedDays: 1,
  destination: "Fixture City",
  generationId: "p49-regression",
  validationStage: "final",
  excludePlaceIds: excludedPlaces.map((candidate) => candidate.id),
  excludedPlaces,
  excludedCategories: [],
  lockedPlaceIds,
});
const exclusionCount = (result) => result.failedRules.filter((rule) => rule.code === "user_exclusions").length;

const fixtures = [
  ["Taipei Style Tower", "Taipei Style Tower風阻尼球"],
  ["Tokyo Tower", "Tokyo Tower Observation Deck"],
  ["Osaka Castle", "Osaka Castle Entrance"],
  ["N Seoul Tower", "N Seoul Tower Gift Shop"],
  ["85 Sky Tower", "85 Sky Tower Internal Exhibit"],
];

for (const [parentName, childName] of fixtures) {
  const parent = place(`parent-${parentName}`, parentName, 25, 121);
  const child = place(`child-${parentName}`, childName, 25.0001, 121.0001);
  const relation = resolveVenueHierarchyRelation(parent, child);
  assert.equal(relation.relation, "ancestor", `${parentName}: parent must resolve as ancestor`);
  assert.equal(exclusionCount(validate([child], [parent])), 1, `${parentName}: child must be excluded`);
  assert.equal(exclusionCount(validate([parent], [child])), 0, `${parentName}: child exclusion must not remove parent`);

  const collapsed = collapseParentLandmarkCandidates([parent, child]);
  assert.equal(collapsed.kept.some((candidate) => candidate.id === parent.id), true);
  assert.equal(collapsed.kept.some((candidate) => candidate.id === child.id), false);
}

const parent = place("parent-main", "Landmark Tower", 25, 121);
const child = place("child-main", "Landmark Tower Observation Deck", 25.0001, 121.0001);
const unrelated = place("other-nearby", "Independent Museum", 25.00015, 121.00015, "2 Museum Road");
assert.equal(resolveVenueHierarchyRelation(parent, unrelated).relation, "unrelated");
assert.equal(exclusionCount(validate([child, unrelated], [parent])), 1);

const requiredConflict = validate([child, unrelated], [parent], [child.id]);
assert.equal(exclusionCount(requiredConflict), 1, "exclusion must win over required lock");

const admitted = [child, unrelated].filter(
  (candidate) => !isExcludedByPlaceOrAncestor(candidate, [parent.id], [parent]).excluded,
);
assert.deepEqual(admitted.map((candidate) => candidate.id), [unrelated.id]);
assert.equal(exclusionCount(validate(admitted, [parent])), 0, "admission must prevent final violation");

console.info("P49 parent venue exclusion: PASS", {
  genericFixtureCount: fixtures.length,
  parentToChild: true,
  childToParent: false,
  nearbyUnrelatedPreserved: true,
  requiredConflictExcluded: true,
  productionLikeFinalExcludedViolationCount: 0,
  crossLayerConsistent: true,
  externalRequestDelta: 0,
});
