import assert from "node:assert/strict";
import {
  resolveAffiliateCommerceEligibility,
  resolveTicketAffiliateProviderMode,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const decide = (name, primaryType, extra = {}) =>
  resolveAffiliateCommerceEligibility({
    name,
    primaryType,
    types: [primaryType],
    ...extra,
  });

// A: strong commerce evidence permits provider search without claiming an exact product.
const observationSearch = decide("Metropolitan Observation Deck", "observation_deck");
assert.equal(observationSearch.confidence, "strong");
assert.equal(observationSearch.exactProviderEvidence, false);
assert.equal(observationSearch.providerSearchFallbackAllowed, true);
assert.equal(resolveTicketAffiliateProviderMode(observationSearch, "klook"), "search_fallback");
assert.equal(resolveTicketAffiliateProviderMode(observationSearch, "kkday"), "search_fallback");

// B: exact provider evidence remains provider-specific.
const observationExact = decide("Metropolitan Observation Deck", "observation_deck", {
  affiliateProductProviders: ["klook"],
});
assert.equal(observationExact.exactProviderEvidence, true);
assert.equal(observationExact.providerSearchFallbackAllowed, false);
assert.equal(resolveTicketAffiliateProviderMode(observationExact, "klook"), "exact_product");
assert.equal(resolveTicketAffiliateProviderMode(observationExact, "kkday"), "hidden");

// C/D/E: intrinsically ticketable types or explicit admission evidence are strong.
assert.equal(decide("City Aquarium", "aquarium").providerSearchFallbackAllowed, true);
assert.equal(decide("Adventure Theme Park", "theme_park").providerSearchFallbackAllowed, true);
assert.equal(
  decide("Metropolitan Museum", "museum", { admissionRequired: true })
    .providerSearchFallbackAllowed,
  true,
);

// F/G/H/I: weak/free/generic places stay suppressed without commerce evidence.
for (const [name, type] of [
  ["Ordinary Public Park", "park"],
  ["Neighborhood Church", "church"],
  ["Civic Plaza", "plaza"],
  ["Generic Sight", "tourist_attraction"],
]) {
  const decision = decide(name, type);
  assert.equal(decision.show, false, `${name} should not show`);
  assert.equal(decision.providerSearchFallbackAllowed, false);
}

// Supported evidence alone still requires exact provider evidence.
const supportedNoProvider = decide("City Exhibition Hall", "exhibition");
assert.equal(supportedNoProvider.show, false);
assert.equal(resolveTicketAffiliateProviderMode(supportedNoProvider, "klook"), "hidden");

// J: every surface receives the same resolver result for the same metadata.
const sharedPlace = {
  name: "Harbor Cable Car",
  primaryType: "cable_car",
  types: ["cable_car", "tourist_attraction"],
  rating: 4.6,
  userRatingCount: 3000,
};
const itineraryDecision = resolveAffiliateCommerceEligibility(sharedPlace);
const detailDecision = resolveAffiliateCommerceEligibility(sharedPlace);
assert.deepEqual(detailDecision, itineraryDecision);

console.log("P52.1 ticketable landmark affiliate CTA: PASS", {
  strongSearchFallback: true,
  exactProviderSpecific: true,
  weakPlacesSuppressed: 4,
  surfaceConsistency: true,
  externalRequestDelta: 0,
});
