import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveAffiliateCommerceEligibility,
  resolveTicketAffiliateProviderMode,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";
import { resolveTicketAffiliateOfferLabel } from "../src/lib/affiliate/affiliate-links.ts";

const majorExperience = (primaryType, types) =>
  resolveAffiliateCommerceEligibility({
    name: "Anonymous Major Cultural Destination",
    primaryType,
    types,
    rating: 4.7,
    userRatingCount: 5000,
  });

for (const decision of [
  majorExperience("place_of_worship", ["place_of_worship", "tourist_attraction"]),
  majorExperience("church", ["church", "tourist_attraction"]),
  majorExperience("cultural_landmark", ["cultural_landmark", "tourist_attraction"]),
]) {
  assert.equal(decision.show, true);
  assert.equal(decision.confidence, "supported");
  assert.equal(decision.commerceType, "experience");
  assert.equal(decision.tourismAuthorityPresent, true);
  assert.equal(decision.majorLandmarkEvidence, true);
  assert.equal(decision.experienceFallbackAllowed, true);
  assert.equal(resolveTicketAffiliateProviderMode(decision, "klook"), "search_fallback");
  assert.equal(
    resolveTicketAffiliateOfferLabel("klook", "search_fallback", decision.commerceType),
    "在 Klook 搜尋體驗",
  );
}

for (const [name, type] of [
  ["Ordinary Temple", "place_of_worship"],
  ["Ordinary Church", "church"],
  ["Public Park", "park"],
]) {
  const decision = resolveAffiliateCommerceEligibility({
    name,
    primaryType: type,
    types: [type],
    rating: 4.8,
    userRatingCount: 5000,
  });
  assert.equal(decision.show, false, `${name} must remain hidden`);
}

const ticket = resolveAffiliateCommerceEligibility({
  name: "Observation Deck",
  primaryType: "observation_deck",
  types: ["observation_deck", "tourist_attraction"],
});
assert.equal(resolveTicketAffiliateOfferLabel("kkday", "search_fallback", ticket.commerceType), "在 KKday 搜尋票券");

const transport = resolveAffiliateCommerceEligibility({
  name: "Visitor Transport Pass",
  primaryType: "point_of_interest",
  transportPassAvailable: true,
});
assert.equal(resolveTicketAffiliateOfferLabel("klook", "search_fallback", transport.commerceType), "在 Klook 搜尋交通票券");

const exact = resolveAffiliateCommerceEligibility({
  name: "Observation Deck",
  primaryType: "observation_deck",
  affiliateProductProviders: ["klook"],
});
assert.equal(resolveTicketAffiliateOfferLabel("klook", "exact_product", exact.commerceType), "Klook");

const section = readFileSync(new URL("../src/components/trip/TripAffiliateSection.tsx", import.meta.url), "utf8");
assert.match(section, /visible.length > 1 \? "grid-cols-2" : "grid-cols-1"/);
assert.match(section, /kind === "ticket"\s*\? "grid w-full gap-2"\s*:\s*"flex flex-wrap gap-2"/);
assert.match(section, /kind !== "ticket" && \(compact \? "px-3" : "px-4"\)/);
assert.doesNotMatch(section, /overflow-x-auto/);

const detail = readFileSync(new URL("../src/components/map/PlaceDetailSheet.tsx", import.meta.url), "utf8");
const itinerary = readFileSync(new URL("../src/components/saved/SavedTripItineraryEditor.tsx", import.meta.url), "utf8");
assert.match(detail, /<TripAffiliateSection[\s\S]*?kind="ticket"/);
assert.match(itinerary, /<TripAffiliateSection/);

console.log("P52.2 cultural affiliate eligibility + horizontal layout: PASS", {
  supportedExperienceCases: 3,
  weakPlacesSuppressed: 3,
  sharedRenderer: true,
  externalRequestDelta: 0,
});
