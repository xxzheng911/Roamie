import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripAffiliateSection } from "../src/components/trip/TripAffiliateSection.tsx";
import {
  buildPlaceDetailTicketOffers,
  buildPlaceTicketOffers,
} from "../src/lib/affiliate/affiliate-links.ts";
import { resolveAffiliateCommerceEligibility } from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";
import {
  normalizeTripPlaceInput,
  tripPlaceToItineraryItem,
} from "../src/lib/trip/trip-place-input.ts";

const majorMountain = {
  id: "ChIJMajorNaturalDestination",
  googlePlaceId: "ChIJMajorNaturalDestination",
  name: "Representative Alpine Summit",
  primaryType: "mountain_peak",
  // Google may classify a major mountain without also returning tourist_attraction.
  types: ["mountain_peak", "natural_feature", "establishment"],
  rating: 4.8,
  userRatingCount: 12000,
  businessStatus: "OPERATIONAL",
};

const decision = resolveAffiliateCommerceEligibility(majorMountain);
assert.equal(decision.show, true);
assert.equal(decision.reason, "major_natural_destination_experience_discovery");
assert.equal(decision.commerceType, "experience");
assert.equal(decision.tourismAuthorityPresent, false);
assert.equal(decision.providerSearchFallbackAllowed, true);

const detailOffers = buildPlaceDetailTicketOffers(majorMountain);
assert.deepEqual(
  detailOffers.map((offer) => offer.provider),
  ["klook", "kkday"],
);

const tripPlace = normalizeTripPlaceInput({
  ...majorMountain,
  address: "Alpine region",
  lat: 35.36,
  lng: 138.73,
});
const hydratedItem = JSON.parse(
  JSON.stringify(tripPlaceToItineraryItem(tripPlace, { date: "2026-09-14" })),
);
const itineraryOffers = buildPlaceTicketOffers(hydratedItem);
assert.deepEqual(
  itineraryOffers.map((offer) => offer.provider),
  detailOffers.map((offer) => offer.provider),
);

const detailMarkup = renderToStaticMarkup(
  createElement(TripAffiliateSection, {
    kind: "ticket",
    offers: detailOffers,
    surface: "detail",
  }),
);
const itineraryMarkup = renderToStaticMarkup(
  createElement(TripAffiliateSection, {
    kind: "ticket",
    offers: itineraryOffers,
    surface: "itinerary",
    compact: true,
  }),
);
assert.match(detailMarkup, /Klook/);
assert.match(detailMarkup, /KKday/);
assert.match(itineraryMarkup, /Klook/);
assert.match(itineraryMarkup, /KKday/);

for (const ordinaryNaturalPlace of [
  {
    name: "Ordinary Hill",
    primaryType: "mountain_peak",
    types: ["mountain_peak", "natural_feature"],
    rating: 4.1,
    userRatingCount: 42,
  },
  {
    name: "Neighborhood Nature Point",
    primaryType: "natural_feature",
    types: ["natural_feature", "point_of_interest"],
    rating: 4.5,
    userRatingCount: 1500,
  },
]) {
  assert.equal(resolveAffiliateCommerceEligibility(ordinaryNaturalPlace).show, false);
}

for (const excluded of [
  ["Local Supermarket", "supermarket"],
  ["Railway Station", "train_station"],
  ["Business Hotel", "lodging"],
  ["Book Store", "book_store"],
  ["Memorial Cemetery", "cemetery"],
]) {
  assert.equal(
    resolveAffiliateCommerceEligibility({
      name: excluded[0],
      primaryType: excluded[1],
      types: [excluded[1]],
    }).show,
    false,
  );
}

console.log("P52.9 natural landmark affiliate parity: PASS", {
  eligibilityRuleUsesNamedFixture: false,
  detailProviders: detailOffers.map((offer) => offer.provider),
  itineraryProviders: itineraryOffers.map((offer) => offer.provider),
  ordinaryNaturalSuppressed: 2,
  hardExcludedSuppressed: 5,
});
