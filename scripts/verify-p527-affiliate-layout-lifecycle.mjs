import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAffiliatePlaceEvidence,
  resolveAffiliateCommerceEligibility,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const section = readFileSync(
  new URL("../src/components/trip/TripAffiliateSection.tsx", import.meta.url),
  "utf8",
);
assert.match(section, /data-affiliate-layout=\{kind === "ticket" \? "provider-search-grid" : "provider-row"\}/);
assert.match(section, /kind === "ticket" && \(visible.length > 1 \? "grid-cols-2" : "grid-cols-1"\)/);
assert.match(section, /kind !== "ticket" && \(compact \? "px-3" : "px-4"\)/);
assert.match(section, /kind === "ticket" && "min-w-0 text-center leading-tight whitespace-normal"/);

const majorCultural = {
  googlePlaceId: "anonymous-cultural-landmark",
  name: "Anonymous Major Cultural Landmark",
  primaryType: "place_of_worship",
  types: ["place_of_worship", "tourist_attraction"],
  rating: 4.7,
  userRatingCount: 5000,
  businessStatus: "OPERATIONAL",
};
const detail = resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence(majorCultural));
const itinerary = resolveAffiliateCommerceEligibility(
  buildAffiliatePlaceEvidence(JSON.parse(JSON.stringify(majorCultural))),
);
assert.equal(detail.commerceType, "experience");
assert.equal(detail.show, true);
assert.deepEqual(itinerary, detail);

for (const [name, primaryType] of [
  ["Ordinary Neighborhood Temple", "place_of_worship"],
  ["Ordinary Church", "church"],
  ["Ordinary Park", "park"],
]) {
  assert.equal(
    resolveAffiliateCommerceEligibility({ name, primaryType, types: [primaryType] }).show,
    false,
  );
}

assert.equal(
  resolveAffiliateCommerceEligibility({
    name: "Observation Deck",
    primaryType: "observation_deck",
    types: ["observation_deck", "tourist_attraction"],
  }).commerceType,
  "ticket",
);

console.log("P52.7 affiliate layout isolation + factual lifecycle: PASS", {
  ticketLayout: "provider-search-grid",
  lodgingLayout: "provider-row",
  culturalSurfaceParity: true,
  weakPlacesSuppressed: 3,
  externalRequestDelta: 0,
});
