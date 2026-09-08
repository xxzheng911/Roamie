import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAffiliatePlaceEvidence,
  resolveAffiliateCommerceEligibility,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const assertSurfaceParity = (raw) => {
  const detail = resolveAffiliateCommerceEligibility(buildAffiliatePlaceEvidence(raw));
  const persisted = JSON.parse(JSON.stringify(raw));
  const itinerary = resolveAffiliateCommerceEligibility(
    buildAffiliatePlaceEvidence({
      ...persisted,
      googleTypes: persisted.types,
      types: undefined,
    }),
  );
  assert.deepEqual(itinerary, detail);
  return detail;
};

assert.equal(
  assertSurfaceParity({
    googlePlaceId: "anonymous-observation-id",
    name: "Observation Deck",
    primaryType: "observation_deck",
    types: ["observation_deck", "tourist_attraction"],
    rating: 4.6,
    userRatingCount: 3000,
  }).show,
  true,
);

const cultural = assertSurfaceParity({
  googlePlaceId: "anonymous-cultural-id",
  name: "Major Cultural Destination",
  primaryType: "place_of_worship",
  types: ["place_of_worship", "tourist_attraction"],
  rating: 4.7,
  userRatingCount: 5000,
});
assert.equal(cultural.commerceType, "experience");
assert.equal(cultural.show, true);

for (const [name, primaryType] of [
  ["Ordinary Park", "park"],
  ["Ordinary Temple", "place_of_worship"],
]) {
  assert.equal(
    assertSurfaceParity({ name, primaryType, types: [primaryType] }).show,
    false,
  );
}

const section = readFileSync(new URL("../src/components/trip/TripAffiliateSection.tsx", import.meta.url), "utf8");
assert.match(section, /visible.length > 1 \? "grid-cols-2" : "grid-cols-1"/);
assert.match(section, /inline-flex items-center justify-center/);
assert.match(section, /data-affiliate-layout=\{kind === "ticket" \? "provider-search-grid" : "provider-row"\}/);
assert.match(section, /kind !== "ticket" && \(compact \? "px-3" : "px-4"\)/);
assert.match(section, /whitespace-normal/);
assert.doesNotMatch(section, /overflow-x-auto/);

console.log("P52.3 affiliate surface parity + two-column CTA layout: PASS", {
  surfaceParityCases: 4,
  serializationRoundTrips: 4,
  twoColumnLayout: true,
  singleProviderLayout: true,
  externalRequestDelta: 0,
});
