import assert from "node:assert/strict";
import { shouldShowTicketAffiliate } from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";
import {
  applyPlanningConstraintDelta,
  parsePlanningConstraintDelta,
} from "../src/lib/ai/planning-conversation-constraints.ts";
import { placeMatchesExcludedCategories } from "../src/lib/ai/recommendation-exclusion.ts";

const affiliate = (name, primaryType, extra = {}) =>
  shouldShowTicketAffiliate({ name, primaryType, types: [primaryType], ...extra });

assert.equal(affiliate("Observation Deck", "observation_deck").eligible, true);
assert.equal(affiliate("Theme Park", "theme_park").eligible, true);
assert.equal(affiliate("City Museum", "museum", { admissionRequired: true }).eligible, true);
assert.equal(affiliate("City Museum", "museum").eligible, false);
assert.equal(affiliate("Public Park", "park").eligible, false);
assert.equal(affiliate("Public Plaza", "plaza").eligible, false);
assert.equal(affiliate("Neighborhood Church", "church").eligible, false);
assert.equal(affiliate("Ordinary Trail", "hiking_area").eligible, false);
assert.equal(affiliate("Free Scenic Space", "park", { guidedTourAvailable: true }).eligible, true);

const providerDecision = affiliate("Ticketed Observatory", "observation_deck", {
  affiliateProductProviders: ["klook"],
});
assert.deepEqual(providerDecision.supportedProviders, ["klook"]);

const shown = [
  {
    name: "Pingtung Church",
    placeId: "church-1",
    googlePlaceId: "church-1",
    primaryType: "church",
    types: ["church", "place_of_worship"],
  },
  {
    name: "Central Park",
    placeId: "park-1",
    googlePlaceId: "park-1",
    primaryType: "park",
    types: ["park"],
  },
  {
    name: "City Museum",
    placeId: "museum-1",
    googlePlaceId: "museum-1",
    primaryType: "museum",
    types: ["museum"],
  },
];
const delta = parsePlanningConstraintDelta({ text: "排除教會，其他都行", shownCandidates: shown });
assert.deepEqual(delta.excludedPlaces, []);
assert.deepEqual(delta.excludedPlaceTypes, ["church_category"]);
assert.equal(delta.acceptRemainingCandidates, true);
const session = applyPlanningConstraintDelta(
  { selectedPlaces: [], recommendedPlaces: shown, travelContext: { interests: [] } },
  delta,
  shown,
);
assert.deepEqual(session.excludedCategories, ["church_category"]);
assert.deepEqual(
  session.selectedPlaces.map((place) => place.placeId),
  ["park-1", "museum-1"],
);
assert.equal(placeMatchesExcludedCategories(shown[0], session.excludedCategories), true);
assert.equal(
  placeMatchesExcludedCategories(
    { name: "Church Supply Store", primaryType: "store", types: ["store"] },
    session.excludedCategories,
  ),
  false,
);

const exact = parsePlanningConstraintDelta({
  text: "排除屏東教會",
  shownCandidates: [{ ...shown[0], name: "屏東教會" }],
});
assert.equal(exact.excludedPlaces.length, 1);
assert.deepEqual(exact.excludedPlaceTypes, []);

for (const [text, expected] of [
  ["不要教堂", "church_category"],
  ["不要寺廟", "shrine_temple_category"],
  ["不要夜市", "market_category"],
  ["不要博物館", "museum_category"],
  ["不要公園", "park_category"],
  ["不要咖啡廳", "咖啡廳"],
]) {
  assert.equal(
    parsePlanningConstraintDelta({ text, shownCandidates: [] }).excludedPlaceTypes.includes(
      expected,
    ),
    true,
    text,
  );
}

const exactLandmark = parsePlanningConstraintDelta({
  text: "排除彩虹眷村",
  shownCandidates: [
    {
      name: "彩虹眷村",
      placeId: "rainbow",
      googlePlaceId: "rainbow",
      primaryType: "cultural_landmark",
      types: ["cultural_landmark"],
    },
  ],
});
assert.equal(exactLandmark.excludedPlaces.length, 1);
assert.deepEqual(exactLandmark.excludedPlaceTypes, []);

console.log("P52 affiliate + exclusion: PASS", {
  affiliateCases: 9,
  providerSpecific: true,
  categoryTaxonomy: true,
  acceptRemaining: true,
  placeAuthorityPreserved: true,
  nameSubstringFalsePositiveBlocked: true,
  externalRequestDelta: 0,
});
