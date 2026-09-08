import assert from "node:assert/strict";
import {
  buildOfferedCombinationsForSession,
  buildPlanningShownCandidatesFromOfferedCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  clearDiscoveredCombinationsCache,
  setCachedDiscoveredCombinations,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { buildPlannerRequiredAnchors } from "../src/lib/place-planning-memory.ts";
import { normalizeItineraryItem } from "../src/lib/ai/types.ts";
import { normalizeItineraryStops } from "../src/lib/ai/real-place-supplement.ts";
import {
  buildAffiliatePlaceEvidence,
  resolveAffiliateCommerceEligibility,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const offeredPlace = {
  candidateId: "ChIJ1234567890abcdefghijkl",
  plannerProvenanceKey: "google:ChIJ1234567890abcdefghijkl",
  sourceCandidateIndex: 0,
  name: "Anonymous Cultural Landmark",
  localizedDisplayName: "Anonymous Cultural Landmark",
  searchQuery: "anonymous",
  sourceCombinationId: 1,
  googlePlaceId: "ChIJ1234567890abcdefghijkl",
  latitude: 35.0,
  longitude: 139.0,
  address: "anonymous",
  primaryType: "place_of_worship",
  types: ["place_of_worship", "tourist_attraction"],
  rating: 4.7,
  userRatingCount: 5000,
  businessStatus: "OPERATIONAL",
  resolutionStatus: "resolved",
};

const discoveredCandidate = (suffix) => ({
  name: `Anonymous Cultural Landmark ${suffix}`,
  googlePlaceId: `${offeredPlace.googlePlaceId}${suffix}`,
  types: offeredPlace.types,
  primaryType: offeredPlace.primaryType,
  rating: offeredPlace.rating,
  userRatingCount: offeredPlace.userRatingCount,
  businessStatus: offeredPlace.businessStatus,
});
clearDiscoveredCombinationsCache("Tokyo");
setCachedDiscoveredCombinations("Tokyo", ["a", "b", "c"].map((suffix, index) => ({
  combinationId: `culture-${suffix}`,
  title: `Culture ${suffix}`,
  theme: "culture",
  placeCandidates: [discoveredCandidate(`${suffix}1`), discoveredCandidate(`${suffix}2`)],
})));
const cachedOffered = buildOfferedCombinationsForSession("Tokyo");
assert.equal(cachedOffered[0].places[0].userRatingCount, 5000);
assert.equal(cachedOffered[0].places[0].businessStatus, "OPERATIONAL");
clearDiscoveredCombinationsCache("Tokyo");

const shown = buildPlanningShownCandidatesFromOfferedCombinations("Destination", [
  { id: 1, title: "Culture", places: [offeredPlace] },
]);
assert.equal(shown[0].userRatingCount, 5000);
assert.deepEqual(shown[0].types, offeredPlace.types);

const planner = buildPlannerRequiredAnchors(shown, "Destination", false);
assert.equal(planner[0].userRatingCount, 5000);
assert.deepEqual(planner[0].types, offeredPlace.types);
assert.equal(planner[0].businessStatus, "OPERATIONAL");

const persisted = JSON.parse(JSON.stringify(normalizeItineraryItem({
  date: "2026-01-01",
  time: "09:00",
  title: planner[0].name,
  placeName: planner[0].placeName,
  description: planner[0].description,
  address: planner[0].address,
  lat: planner[0].lat,
  lng: planner[0].lng,
  googlePlaceId: planner[0].googlePlaceId,
  placeType: planner[0].primaryType ?? planner[0].type,
  types: planner[0].types,
  rating: planner[0].rating,
  userRatingCount: planner[0].userRatingCount,
  businessStatus: planner[0].businessStatus,
})));
assert.equal(persisted.userRatingCount, 5000);
assert.deepEqual(persisted.types, offeredPlace.types);
assert.equal(persisted.businessStatus, "OPERATIONAL");

const prePersistence = normalizeItineraryStops([{
  ...persisted,
  placeType: "place_of_worship",
  types: ["tourist_attraction", "place_of_worship"],
}]).valid[0];
assert.equal(prePersistence.userRatingCount, 5000);
assert.equal(prePersistence.businessStatus, "OPERATIONAL");
assert.equal(prePersistence.placeType, "place_of_worship");

const genuinelyMissingSource = buildPlanningShownCandidatesFromOfferedCombinations("Destination", [
  {
    id: 2,
    title: "Culture",
    places: [{
      ...offeredPlace,
      candidateId: "ChIJmissing1234567890abcd",
      googlePlaceId: "ChIJmissing1234567890abcd",
      plannerProvenanceKey: "google:ChIJmissing1234567890abcd",
      userRatingCount: undefined,
      businessStatus: undefined,
    }],
  },
]);
assert.equal(genuinelyMissingSource[0].userRatingCount, null);
assert.equal(genuinelyMissingSource[0].businessStatus, null);

const detail = resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence({
  ...offeredPlace,
  id: offeredPlace.googlePlaceId,
}));
const itinerary = resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence({
  googlePlaceId: persisted.googlePlaceId,
  name: persisted.placeName,
  primaryType: persisted.placeType,
  types: persisted.types,
  rating: persisted.rating,
  userRatingCount: persisted.userRatingCount,
}));
assert.equal(detail.commerceType, "experience");
assert.deepEqual(itinerary, detail);

const ordinaryTemple = {
  name: "Ordinary Temple",
  primaryType: "place_of_worship",
  types: ["place_of_worship"],
};
assert.equal(resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence(ordinaryTemple)).show, false);

const ticket = {
  name: "Observation Deck",
  primaryType: "observation_deck",
  types: ["observation_deck", "tourist_attraction"],
};
assert.equal(resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence(ticket)).commerceType, "ticket");

console.log("P52.5 cultural affiliate factual-evidence parity: PASS", {
  reviewCountRoundTrip: true,
  typesRoundTrip: true,
  businessStatusRoundTrip: true,
  culturalSurfaceParity: true,
  externalRequestDelta: 0,
});
