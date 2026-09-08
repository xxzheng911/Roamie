import assert from "node:assert/strict";
import {
  buildAffiliatePlaceEvidence,
  resolveAffiliateCommerceEligibility,
  resolveTicketAffiliateProviderMode,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const majorCultural = (primaryType, types, userRatingCount) =>
  resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence({
    name: "Anonymous Cultural Destination",
    primaryType,
    types,
    rating: 4.7,
    userRatingCount,
    businessStatus: "OPERATIONAL",
  }));

for (const decision of [
  majorCultural("place_of_worship", ["place_of_worship", "tourist_attraction"], undefined),
  majorCultural("hindu_temple", ["hindu_temple", "tourist_attraction"], undefined),
  majorCultural("church", ["church", "tourist_attraction", "historical_landmark"], undefined),
]) {
  assert.equal(decision.show, true);
  assert.equal(decision.commerceType, "experience");
  assert.equal(decision.confidence, "supported");
  assert.equal(decision.experienceFallbackAllowed, true);
  assert.equal(decision.culturalFallbackDecisionReason, "supported_multi_evidence");
  assert.equal(resolveTicketAffiliateProviderMode(decision, "klook"), "search_fallback");
}

for (const primaryType of ["place_of_worship", "church"]) {
  const ordinary = majorCultural(primaryType, [primaryType], undefined);
  assert.equal(ordinary.show, false);
  assert.equal(ordinary.culturalFallbackDecisionReason, "insufficient_tourism_authority");
}

const withReviews = majorCultural(
  "place_of_worship",
  ["place_of_worship", "tourist_attraction"],
  5000,
);
assert.equal(withReviews.show, true);
assert.ok(withReviews.majorLandmarkEvidenceSources.includes("review_count"));

const lightweight = majorCultural(
  "place_of_worship",
  ["place_of_worship", "tourist_attraction"],
  undefined,
);
const enriched = majorCultural(
  "place_of_worship",
  ["place_of_worship", "tourist_attraction"],
  5000,
);
assert.equal(lightweight.commerceType, enriched.commerceType);
assert.equal(lightweight.show, enriched.show);

const ticket = resolveAffiliateCommerceEligibility({
  name: "Observation Deck",
  primaryType: "observation_deck",
  types: ["observation_deck", "tourist_attraction"],
});
assert.equal(ticket.commerceType, "ticket");
assert.equal(ticket.confidence, "strong");

console.log("P52.8 cultural landmark multi-evidence authority: PASS", {
  missingReviewCountIsUnknown: true,
  majorCulturalCases: 3,
  ordinaryReligiousSuppressed: 2,
  detailItineraryProductParity: true,
  externalRequestDelta: 0,
});
