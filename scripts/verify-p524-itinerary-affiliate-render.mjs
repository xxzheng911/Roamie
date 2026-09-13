import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripAffiliateSection } from "../src/components/trip/TripAffiliateSection.tsx";
import {
  normalizeTripPlaceInput,
  tripPlaceToItineraryItem,
} from "../src/lib/trip/trip-place-input.ts";
import { buildPlaceTicketOffers } from "../src/lib/affiliate/affiliate-links.ts";
import fs from "node:fs";

const offer = (provider, label) => ({
  provider,
  kind: "activity_ticket",
  label,
  url: `https://example.test/${provider}`,
  enabled: true,
});

const render = (offers, mode) =>
  renderToStaticMarkup(
    createElement(TripAffiliateSection, {
      kind: "ticket",
      offers,
      compact: true,
      surface: "itinerary",
      placeHash: "anonymous",
      eligible: offers.length > 0,
      renderedCtaMode: mode,
    }),
  );

const ticketSearch = render(
  [offer("klook", "在 Klook 搜尋票券"), offer("kkday", "在 KKday 搜尋票券")],
  "ticket_search",
);
assert.match(ticketSearch, /在 Klook 搜尋票券/);
assert.match(ticketSearch, /在 KKday 搜尋票券/);

const experienceSearch = render(
  [offer("klook", "在 Klook 搜尋體驗"), offer("kkday", "在 KKday 搜尋體驗")],
  "experience_search",
);
assert.match(experienceSearch, /在 Klook 搜尋體驗/);
assert.match(experienceSearch, /在 KKday 搜尋體驗/);

assert.equal(render([], "hidden"), "");
assert.match(render([offer("klook", "Klook")], "exact_product"), />Klook</);

// Search fallback deliberately has no exact provider evidence field or product URL.
assert.match(ticketSearch, /grid-cols-2/);
assert.doesNotMatch(ticketSearch, /overflow-x-auto/);

const editor = fs.readFileSync(
  new URL("../src/components/saved/SavedTripItineraryEditor.tsx", import.meta.url),
  "utf8",
);
assert.match(editor, /new Map<string, AffiliateLinkOffer\[\]>/);
assert.match(
  editor,
  /map\.set\(placeAffiliateKey\(item\), buildPlaceTicketOffers\(item, ticketCtx\)\)/,
);
assert.match(editor, /placeTicketOffersByKey\.get\(placeAffiliateKey\(item\)\)/);
assert.match(editor, /return `google:\$\{googlePlaceId\}`/);

const eligiblePlace = normalizeTripPlaceInput({
  id: "ChIJRuntimeAffiliateParity",
  name: "Harbor Observation Deck",
  primaryType: "observation_deck",
  types: ["observation_deck", "tourist_attraction"],
  rating: 4.6,
  userRatingCount: 3000,
  businessStatus: "OPERATIONAL",
  address: "Harbor Road",
  lat: 25.03,
  lng: 121.56,
});
const normalizedItem = tripPlaceToItineraryItem(eligiblePlace, {
  date: "2026-09-14",
  time: "10:00",
});
const hydratedItem = JSON.parse(JSON.stringify(normalizedItem));
assert.equal(hydratedItem.googlePlaceId, "ChIJRuntimeAffiliateParity");
assert.deepEqual(hydratedItem.types, ["observation_deck", "tourist_attraction"]);
assert.equal(hydratedItem.userRatingCount, 3000);
assert.equal(hydratedItem.businessStatus, "OPERATIONAL");
const hydratedOffers = buildPlaceTicketOffers(hydratedItem, {
  destinationLabel: "Harbor City",
});
assert.deepEqual(
  hydratedOffers.map((item) => item.provider),
  ["klook", "kkday"],
);
const hydratedMarkup = render(hydratedOffers, "ticket_search");
assert.match(hydratedMarkup, /Klook/);
assert.match(hydratedMarkup, /KKday/);
assert.doesNotMatch(hydratedMarkup, /合作佣金|不影響你的價格/);

const bookingOffer = (provider, kind, label) => ({
  provider,
  kind,
  label,
  url: `https://example.test/${provider}/${kind}`,
  enabled: true,
});
const flight = renderToStaticMarkup(
  createElement(TripAffiliateSection, {
    kind: "flight",
    offers: [bookingOffer("trip", "flight", "Trip.com 機票")],
    surface: "itinerary",
  }),
);
assert.match(flight, /機票推薦/);
assert.match(flight, /Trip\.com 機票/);
assert.doesNotMatch(flight, /到 Trip\.com 搜尋合適航班|合作佣金|不影響你的價格/);

const hotel = renderToStaticMarkup(
  createElement(TripAffiliateSection, {
    kind: "hotel",
    offers: [bookingOffer("agoda", "hotel", "Agoda"), bookingOffer("trip", "hotel", "Trip.com")],
    surface: "itinerary",
  }),
);
assert.match(hotel, /住宿推薦/);
assert.match(hotel, />Agoda</);
assert.match(hotel, />Trip\.com</);
assert.doesNotMatch(hotel, /到第三方平台自行選擇住宿|合作佣金|不影響你的價格/);

console.log("P52.4 itinerary affiliate renderer: PASS", {
  ticketSearchRendered: true,
  experienceSearchRendered: true,
  emptyHidden: true,
  exactProductRendered: true,
  providerEvidenceRequired: false,
  externalRequestDelta: 0,
  normalizedHydratedOfferProviders: hydratedOffers.map((item) => item.provider),
});
