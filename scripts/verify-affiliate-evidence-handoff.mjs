import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { I18nProvider } from '../src/hooks/use-i18n.tsx';
globalThis.React = React;
import { renderToStaticMarkup } from 'react-dom/server';
import { TripAffiliateSection } from '../src/components/trip/TripAffiliateSection.tsx';
import { normalizeTripPlaceInput, tripPlaceToItineraryItem, tripPlaceFromPlaceResult, tripPlaceFromRecommendation } from '../src/lib/trip/trip-place-input.ts';
import { RoamieItineraryItemSchema, normalizeItineraryItem } from '../src/lib/ai/types.ts';
function persisted(input) {
  const item = tripPlaceToItineraryItem(normalizeTripPlaceInput(input), { date: '2026-10-07' });
  return normalizeItineraryItem(RoamieItineraryItemSchema.parse(JSON.parse(JSON.stringify(item))));
}

import { buildPlaceTicketOffers, buildPlaceDetailTicketOffers } from '../src/lib/affiliate/affiliate-links.ts';
import { shouldShowTicketAffiliate } from '../src/lib/affiliate/ticket-affiliate-eligibility.ts';
const park = {
  googlePlaceId: 'ChIJ_fixture_park', title: 'Fixture Park', placeName: 'Fixture Park',
  types: ['park'], placeType: 'park', rating: 4.7, userRatingCount: 20000,
};
assert.equal(shouldShowTicketAffiliate(park).reason, 'excluded_generic_park');
assert.equal(buildPlaceTicketOffers(park).length, 0, 'popularity is not product evidence');
for (const field of ['guidedTourAvailable', 'activityAvailable']) {
  const saved = persisted({ ...park, [field]: true });
  const offers = buildPlaceTicketOffers(saved);
  const detail = buildPlaceDetailTicketOffers({ ...saved, name: saved.placeName });
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map(o => o.provider), detail.map(o => o.provider));
  for (const offer of offers) {
    assert.match(offer.label, /體驗/);
    assert.doesNotMatch(offer.label, /票券/);
    assert.equal(offer.placeName, park.placeName);
    assert(offer.keyword.includes(park.placeName));
  }
}
assert.equal(buildPlaceTicketOffers({ ...park, placeName: 'Other Park' }).length, 0, 'no nearby/parent product inheritance');
assert.equal(buildPlaceTicketOffers({ ...park, placeName: 'Fixture Bridge', types: ['historical_landmark', 'tourist_attraction'] }).length, 0);
console.log('PASS park evidence mapping, JSON reopen, related experience labels, identity-bound keyword, no evidence remains hidden');

for (const evidence of [
  { types: ['ferris_wheel', 'tourist_attraction'] },
  { placeType: '摩天輪' },
  { types: ['tourist_attraction'], ticketingAvailable: true },
]) {
  const saved = persisted({ ...park, placeName: 'Fixture Wheel', title: 'Fixture Wheel', ...evidence });
  const offers = buildPlaceTicketOffers(saved);
  assert.equal(offers.length, 2, 'ticketed attraction must survive mapping and create CTA');
  assert.equal(saved.googlePlaceId, park.googlePlaceId);
  const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(TripAffiliateSection, { kind: 'ticket', offers, compact: true })));
  assert.match(html, /Klook/);
  assert.match(html, /KKday/);
}
for (const name of ['Fixture Bridge', 'Fixture Road']) {
  assert.equal(buildPlaceTicketOffers(persisted({ ...park, placeName: name, types: ['tourist_attraction'] })).length, 0);
}
assert.equal(buildPlaceTicketOffers(persisted(park)).length, 0);
assert.equal(persisted({ ...park, guidedTourAvailable: 'true' }).guidedTourAvailable, undefined);
const source = { ...park, id: park.googlePlaceId, name: park.placeName, type: 'park', primaryType: 'park', guidedTourAvailable: true, lat: 34.7, lng: 135.5 };
for (const input of [tripPlaceFromPlaceResult(source), tripPlaceFromRecommendation(source)]) {
  const saved = persisted(input);
  assert.equal(saved.guidedTourAvailable, true);
  assert.equal(buildPlaceTicketOffers(saved).length, 2);
}
console.log('PASS full affiliate normalization/schema/persistence/render: ticket YES, tour/activity YES, generic park NO, bridge/road NO');
