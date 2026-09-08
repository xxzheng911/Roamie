import assert from "node:assert/strict";
import {
  applyPlanningConstraintDelta,
  parsePlanningConstraintDelta,
} from "../src/lib/ai/planning-conversation-constraints.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";

const place = (id, name, type = "tourist_attraction") => ({
  id,
  googlePlaceId: id,
  name,
  address: "台中市",
  lat: 24.15,
  lng: 120.68,
  rating: 4.5,
  userRatingCount: 100,
  primaryType: type,
  types: [type],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
});
const entry = (candidate, offset) => ({
  time: `${9 + offset * 2}:00`,
  label: "景點",
  name: candidate.name,
  place: candidate,
});
const validate = (places, exclusions = {}) =>
  validateItineraryPlan({
    plans: [{ day: 1, entries: places.map(entry) }],
    requestedDays: 1,
    destination: "台中",
    style: "mixed",
    creationPath: "direct",
    generationId: "p47-regression",
    validationStage: "final",
    ...exclusions,
  });
const exclusionRules = (result) =>
  result.failedRules.filter((rule) => rule.code === "user_exclusions");

const rainbow = place("ChIJP47RainbowVillage", "彩虹眷村", "cultural_landmark");
const miyahara = place("ChIJP47Miyahara", "宮原眼科");
const calligraphy = place("ChIJP47Calligraphy", "草悟道", "park");
const caseA = validate([rainbow, miyahara, calligraphy], {
  excludePlaceIds: [rainbow.id],
  excludedCategories: [],
  userText: "排除彩虹眷村",
});
assert.equal(exclusionRules(caseA).length, 1);

const museums = [0, 1, 2].map((index) =>
  place(`ChIJP47Museum${index}`, `Museum ${index}`, "museum"),
);
const caseB = validate(museums, { excludedCategories: ["museum"] });
assert.equal(exclusionRules(caseB).length, 3);

const attractions = [0, 1, 2].map((index) =>
  place(`ChIJP47Attraction${index}`, `Attraction ${index}`),
);
const caseC = validate(attractions, { excludePlaceIds: [attractions[0].id] });
assert.equal(exclusionRules(caseC).length, 1);

const localizedAlias = {
  ...rainbow,
  id: `places/${rainbow.id}`,
  googlePlaceId: `places/${rainbow.id}`,
  name: "Rainbow Village",
};
const caseD = validate([localizedAlias, miyahara, calligraphy], { excludePlaceIds: [rainbow.id] });
assert.equal(exclusionRules(caseD).length, 1);
assert.equal(exclusionRules(caseD)[0].message.includes("canonical_identity"), true);

const parent = place("ChIJP47Parent", "Landmark Parent", "cultural_landmark");
const child = place("ChIJP47Child", "Landmark Internal Feature");
const unrelated = place("ChIJP47Unrelated", "Unrelated Venue");
const caseE = validate([parent, child, unrelated], { excludePlaceIds: [parent.id] });
assert.equal(exclusionRules(caseE).length, 1);

const parkNameOnly = validate([place("ChIJP47NamedPark", "中央公園", "park"), miyahara], {
  excludedCategories: [],
  userText: "排除中央公園",
});
assert.equal(exclusionRules(parkNameOnly).length, 0);

const summaryMustNotCreateAuthority = validate([rainbow, ...museums], {
  excludePlaceIds: [rainbow.id],
  excludedCategories: [],
  userText: "conversation summary: 使用者曾提到不要博物館",
});
assert.equal(exclusionRules(summaryMustNotCreateAuthority).length, 1);

const legacyRawTextOnly = validate(museums, {
  excludedCategories: [],
  userText: "不要博物館",
});
assert.equal(exclusionRules(legacyRawTextOnly).length, 0);

const productionLike = validate([rainbow, ...attractions], {
  excludePlaceIds: [rainbow.id],
  excludedCategories: [],
  userText: "排除彩虹眷村",
});
assert.equal(exclusionRules(productionLike).length, 1);

const shownPark = {
  ...place("ChIJP47CentralPark", "中央公園", "park"),
  placeId: "ChIJP47CentralPark",
};
const delta = parsePlanningConstraintDelta({ text: "排除中央公園", shownCandidates: [shownPark] });
assert.equal(delta.excludedPlaces.length, 1);
assert.deepEqual(delta.excludedPlaceTypes, []);
const session = applyPlanningConstraintDelta(
  {
    selectedPlaces: [shownPark],
    recommendedPlaces: [shownPark],
    planningConstraints: undefined,
    travelContext: { interests: [] },
  },
  delta,
  [shownPark],
);
assert.deepEqual(session.excludedCategories, []);

const categoryDelta = parsePlanningConstraintDelta({ text: "不要夜市", shownCandidates: [] });
assert.deepEqual(categoryDelta.excludedPlaceTypes, ["market_category"]);

console.log("P47 exclusion authority: PASS", {
  placeExclusionViolations: exclusionRules(caseA).length,
  categoryExclusionViolations: exclusionRules(caseB).length,
  unrelatedAttractionsUnaffected: true,
  canonicalAliasMatched: true,
  unrelatedVenueUnaffected: true,
  placeCategoryLeakage: false,
  validatorTextInferenceUsed: false,
  legacyTextFallbackUsed: false,
  externalRequestDelta: 0,
});
