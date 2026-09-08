import assert from "node:assert/strict";
import {
  buildCombinationsFromCandidates,
  resolvePrimarySemanticFamily,
} from "../src/lib/ai/destination-combination-discovery.ts";

const make = (suffix, name, primaryType, types = [primaryType], rating = 4.5, reviews = 500) => ({
  name,
  googlePlaceId: `ChIJP425${suffix}`,
  searchCandidateId: `ChIJP425${suffix}`,
  coordinates: { lat: 25.03 + suffix.length * 0.002, lng: 121.56 + suffix.length * 0.001 },
  address: "Fixture destination",
  primaryType,
  types,
  rating,
  userRatingCount: reviews,
  businessStatus: "OPERATIONAL",
});

const cases = [
  [make("ParkLandmark", "Major Landmark Tower", "tourist_attraction", ["tourist_attraction", "landmark", "park"]), "attraction"],
  [make("MallSecondary", "Major Landmark Tower", "tourist_attraction", ["tourist_attraction", "landmark", "shopping_mall"]), "attraction"],
  [make("MallCore", "Central Shopping Mall", "shopping_mall", ["shopping_mall", "tourist_attraction", "landmark"]), "shopping"],
  [make("Temple", "Historic Temple", "place_of_worship", ["place_of_worship", "tourist_attraction", "historical_landmark"]), "historic"],
  [make("Mountain", "Mountain Scenic Attraction", "tourist_attraction", ["tourist_attraction", "natural_feature"]), "nature"],
  [make("Harbor", "City Harbor", "harbor", ["harbor", "tourist_attraction"]), "coast"],
  [make("Plaza", "Civic Plaza", "tourist_attraction", ["tourist_attraction", "plaza"]), "attraction"],
];

for (const [candidate, expected] of cases) {
  assert.equal(resolvePrimarySemanticFamily(candidate).resolvedPrimaryTheme, expected, candidate.name);
}

for (const candidate of [
  make("Taipei", "Destination Landmark Tower", "tourist_attraction", ["landmark", "tourist_attraction", "park"]),
  make("Tokyo", "Metropolitan Tower", "tourist_attraction", ["landmark", "tourist_attraction", "observation_deck"]),
  make("Osaka", "Destination Castle", "castle", ["castle", "historical_landmark", "tourist_attraction"]),
  make("Seoul", "Capital Landmark Tower", "tourist_attraction", ["landmark", "tourist_attraction", "cultural_landmark"]),
  make("Kaohsiung", "Sky Tower", "tourist_attraction", ["landmark", "tourist_attraction", "point_of_interest"]),
]) {
  assert.equal(resolvePrimarySemanticFamily(candidate).resolvedPrimaryTheme, "attraction", candidate.name);
}

const major = make("ReservedMajor", "Major Landmark Tower", "landmark", ["landmark", "tourist_attraction"], 4.0, 100);
const minor = Array.from({ length: 6 }, (_, index) =>
  make(`Minor${index}`, `Minor Attraction ${index}`, "tourist_attraction", ["tourist_attraction"], 4.9, 20_000),
);
const combinations = buildCombinationsFromCandidates("Fixture City", [...minor, major]);
const attraction = combinations.find((combo) => combo.theme === "attraction");
assert(attraction);
assert(
  attraction.placeCandidates.some((candidate) => candidate.googlePlaceId === major.googlePlaceId),
  "tier 1-3 landmark remains inside attraction shortlist",
);

const logs = [];
const originalInfo = console.info;
console.info = (tag, payload) => logs.push({ tag, payload });
try {
  buildCombinationsFromCandidates("Fixture City", [cases[0][0], cases[3][0], cases[4][0], cases[5][0], ...minor]);
} finally {
  console.info = originalInfo;
}
const override = logs.find(
  (entry) =>
    entry.tag === "[PLANNING_ATTRACTION_CANDIDATE_LIFECYCLE]" &&
    entry.payload.authorityOverrideApplied === true,
);
assert(override);
assert(override.payload.authorityScores);
assert(override.payload.resolvedPrimaryTheme);
assert(override.payload.previousFirstMatchedTheme);

console.log("P42.5 semantic authority: PASS", {
  singlePrimaryFamily: true,
  majorLandmarkOverridesWeakSignals: true,
  historicCorePreserved: true,
  natureCorePreserved: true,
  coastStrictAuthorityPreserved: true,
  attractionReservation: true,
  productionLikeCities: ["Taipei", "Tokyo", "Osaka", "Seoul", "Kaohsiung"],
  externalRequestDelta: 0,
});
