import assert from 'node:assert/strict';
import { buildTicketAffiliateOffers } from '../src/lib/affiliate/affiliate-links.ts';
import { shouldShowTicketAffiliate } from '../src/lib/affiliate/ticket-affiliate-eligibility.ts';

const park = {
  googlePlaceId: 'ChIJ_free_park_fixture', placeName: 'Fixture Park',
  primaryType: 'park', types: ['park', 'tourist_attraction'], admissionRequired: false,
};
assert.equal(buildTicketAffiliateOffers(park).length, 0, 'A: free park without evidence');
for (const evidence of ['guidedTourAvailable', 'activityAvailable']) {
  const place = { ...park, [evidence]: true };
  assert.notEqual(shouldShowTicketAffiliate(place).commerceType, 'ticket');
  const offers = buildTicketAffiliateOffers(place);
  assert.deepEqual(offers.map(o => o.provider), ['klook', 'kkday']);
  for (const offer of offers) {
    assert.match(offer.label, /搜尋體驗/);
    assert.doesNotMatch(offer.label, /票券/);
  }
}
assert.equal(buildTicketAffiliateOffers({
  googlePlaceId: 'ChIJ_ticket_fixture', placeName: 'Fixture Attraction',
  types: ['tourist_attraction'], ticketingAvailable: true,
}).length, 2, 'C: ticketed attraction');
for (const type of ['bridge', 'road']) {
  assert.equal(buildTicketAffiliateOffers({
    placeName: `Fixture ${type}`, primaryType: type,
    types: [type, 'tourist_attraction'], rating: 4.8, userRatingCount: 20000,
  }).length, 0, 'D: infrastructure without commerce evidence');
}
console.log('PASS A/B/C/D affiliate discovery input contract; no network discovery invoked');
