import assert from 'node:assert/strict';
import { shouldShowTicketAffiliate } from '../src/lib/affiliate/ticket-affiliate-eligibility.ts';
import { buildPlaceTicketOffers } from '../src/lib/affiliate/affiliate-links.ts';
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error('No network allowed'); };
const base = { placeName: 'Representative venue', title: 'Representative venue', googlePlaceId: 'ChIJ_fixture_types' };
try {
  const yes = [
    { category: 'observation deck' },
    { primaryType: 'aerial_tramway' },
    { placeType: '纜車' },
    { types: ['scenic_rail', 'train_station'] },
    { types: ['tourist_railway', 'tourist_attraction'] },
    { types: ['botanical_garden', 'tourist_attraction'] },
    { types: ['garden'], ticketingAvailable: true },
    { types: ['museum', 'tourist_attraction'] },
    { types: ['historical_site', 'tourist_attraction'] },
    { types: ['monument', 'tourist_attraction'] },
    { types: ['palace', 'tourist_attraction'] },
    { types: ['temple', 'tourist_attraction'] },
    { types: ['national_park', 'tourist_attraction'] },
    { placeType: '摩天輪', placeName: '天保山大摩天輪' },
  ];
  for (const extra of yes) {
    const place = { ...base, ...extra };
    assert(shouldShowTicketAffiliate(place).show, JSON.stringify(extra));
    // Itinerary carries primary type through placeType/types, not a new API lookup.
    const offers = buildPlaceTicketOffers({ ...place, placeType: extra.placeType ?? extra.primaryType });
    assert.equal(offers.length, 2, JSON.stringify(extra));
    if (shouldShowTicketAffiliate(place).searchIntent) {
      assert(offers.every(o => /搜尋相關體驗/.test(o.label)));
      assert.equal(place.ticketingAvailable, undefined);
    }
  }
  for (const type of ['park', 'bridge', 'road', 'neighborhood', 'train_station', 'museum', 'temple', 'garden']) {
    assert.equal(shouldShowTicketAffiliate({ ...base, types: [type] }).show, false, `ordinary ${type}`);
  }
  for (const type of ['bridge', 'road', 'train_station']) {
    assert.equal(shouldShowTicketAffiliate({ ...base, types: [type, 'tourist_attraction'] }).show, false);
  }
  assert.equal(requests, 0);
  console.log('PASS affiliate A-I, tourist metadata versus ordinary venues, 0 requests');
} finally { globalThis.fetch = originalFetch; }
