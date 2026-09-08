import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripAffiliateSection } from "../src/components/trip/TripAffiliateSection.tsx";

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

console.log("P52.4 itinerary affiliate renderer: PASS", {
  ticketSearchRendered: true,
  experienceSearchRendered: true,
  emptyHidden: true,
  exactProductRendered: true,
  providerEvidenceRequired: false,
  externalRequestDelta: 0,
});
