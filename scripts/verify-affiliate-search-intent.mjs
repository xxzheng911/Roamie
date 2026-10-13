import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/hooks/use-i18n.tsx';
import { TripAffiliateSection } from '../src/components/trip/TripAffiliateSection.tsx';
import { buildPlaceTicketOffers, buildPlaceDetailTicketOffers, isAffiliateProductPageUrl, resolveRenderedCtaMode } from '../src/lib/affiliate/affiliate-links.ts';
import { affiliateDisplayLabel } from '../src/lib/native-qa-display.ts';
import { shouldShowTicketAffiliate, resolveAffiliateCommerceEligibility } from '../src/lib/affiliate/ticket-affiliate-eligibility.ts';

globalThis.React = React;
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error('No network allowed'); };
const base = { googlePlaceId: 'ChIJ_intent_fixture', placeName: 'Fixture', title: 'Fixture', rating: 4.5, userRatingCount: 2000 };
function offers(extra) { return buildPlaceTicketOffers({ ...base, ...extra }); }
try {
  const ticket = offers({ types: ['tourist_attraction'], ticketingAvailable: true });
  assert.equal(ticket.length, 2, 'A ticket');
  assert(ticket.every(o => !o.searchIntent && /票券/.test(o.label)));
  for (const evidence of ['guidedTourAvailable', 'activityAvailable']) {
    const tour = offers({ types: ['park'], [evidence]: true });
    assert.equal(tour.length, 2, 'B explicit experience');
    assert(tour.every(o => !o.searchIntent && /搜尋體驗/.test(o.label)));
  }
  const majorPark = Object.freeze({ ...base, placeName: 'Representative Heritage Park', types: ['park', 'tourist_attraction'] });
  assert.equal(resolveAffiliateCommerceEligibility(majorPark).eligible, false, 'search intent must not grant commerce eligibility');
  const snapshot = JSON.stringify(majorPark);
  const decision = shouldShowTicketAffiliate(majorPark);
  assert.equal(decision.searchIntent, 'related_experiences');
  assert.equal(decision.commerceType, 'unknown');
  assert.equal(decision.exactProviderEvidence, false);
  assert.deepEqual(decision.evidenceTypes, []);
  const related = buildPlaceTicketOffers(majorPark);
  assert.equal(related.length, 2, 'C major park search intent');
  for (const offer of related) {
    assert.equal(offer.searchIntent, 'related_experiences');
    assert.match(offer.label, /搜尋相關體驗/);
    assert.match(affiliateDisplayLabel(offer, 'zh-TW'), /搜尋相關體驗/);
    assert.doesNotMatch(offer.label, /門票|票券/);
  }
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(TripAffiliateSection, { kind: 'ticket', offers: related, compact: true })));
  assert.match(html, /搜尋相關體驗|Search related experiences/);
  assert.match(html, /grid-cols-2/);
  assert.doesNotMatch(html, /查看票券優惠|購買門票|Ticket deals/);
  assert.equal(JSON.stringify(majorPark), snapshot, 'never manufacture source evidence');
  const landmark = offers({ types: ['historical_landmark', 'tourist_attraction'] });
  assert.equal(landmark.length, 2);
  assert(landmark.every(o => o.searchIntent === 'related_experiences'));
  assert.equal(offers({ types: ['park'] }).length, 0, 'D ordinary park');
  assert.equal(offers({ ...majorPark, userRatingCount: 25 }).length, 0, 'ordinary park with weak prominence');
  for (const type of ['bridge', 'road', 'train_station', 'neighborhood', 'convenience_store']) {
    assert.equal(offers({ types: [type, 'park', 'tourist_attraction'] }).length, 0, `E/F exclude ${type}`);
  }
  assert.equal(offers({ types: ['point_of_interest'] }).length, 0);
  for (const metadata of [
    { primaryType: 'tourist_attraction', types: [] },
    { types: ['tourist_attraction'] },
    { primaryType: 'tourist_attraction', types: ['tourist_attraction', 'transit_station', 'transportation_service', 'point_of_interest', 'establishment'], category: 'transit_station' },
  ]) {
    const place = Object.freeze({ ...base, ...metadata });
    const before = JSON.stringify(place);
    const intent = shouldShowTicketAffiliate(place);
    assert.equal(intent.eligible, true, 'high-confidence tourist attraction');
    assert.equal(intent.searchIntent, 'related_experiences');
    assert.equal(intent.commerceType, 'unknown');
    assert.deepEqual(intent.evidenceTypes, []);
    assert.equal(resolveAffiliateCommerceEligibility(place).eligible, false);
    assert.equal(JSON.stringify(place), before);
  }
  const touristOffers = offers({ types: ['tourist_attraction', 'transit_station'], category: 'transit_station' });
  assert.equal(touristOffers.length, 2);
  assert(touristOffers.every(o => o.searchIntent === 'related_experiences' && /搜尋相關體驗/.test(o.label)));
  for (const types of [['transit_station'], ['point_of_interest', 'establishment'], ['park'], ['bridge'], ['road']]) {
    assert.equal(offers({ types }).length, 0, `no tourist authority: ${types}`);
  }
  for (const confidence of [{ rating: 4.1 }, { userRatingCount: 999 }, { rating: null }, { userRatingCount: null }]) {
    assert.equal(offers({ types: ['tourist_attraction'], ...confidence }).length, 0, 'insufficient confidence');
  }
  const wheel = offers({ placeName: '天保山大摩天輪', placeType: '摩天輪', types: ['ferris_wheel', 'tourist_attraction'] });
  assert.equal(wheel.length, 2, 'G wheel regression');
  assert(wheel.every(o => !o.searchIntent));
  // R5 search keyword: phonetic canonical_zh names fall back to the provider name; verified names stay.
  const heritage = { ...base, types: ['place_of_worship', 'tourist_attraction'], rating: 4.6, userRatingCount: 30000 };
  const phonetic = offers({ ...heritage, placeName: '哈庫薩納希里內佛塔', originalName: 'Hakusan Shrine', localizationSource: 'canonical_zh' });
  assert.equal(phonetic.length, 2);
  assert(phonetic.every(o => o.keyword === 'Hakusan Shrine' && !/哈庫薩納/.test(decodeURIComponent(o.url))), 'phonetic name must not be searched');
  const verified = offers({ ...heritage, placeName: '布雷迪佛塔', originalName: 'Bulethi', localizationSource: 'verified_zh' });
  assert(verified.every(o => o.keyword === '布雷迪佛塔'), 'verified translation stays the keyword');
  const detail = buildPlaceDetailTicketOffers({ ...heritage, name: '哈庫薩納希里內佛塔', originalName: 'Hakusan Shrine', localizationSource: 'canonical_zh' });
  assert.deepEqual(detail.map(o => o.keyword), phonetic.map(o => o.keyword), 'R5 itinerary/detail keyword parity');
  // R6/R7 search URLs are never products, even with mocked provider flags (no real product source exists).
  const mockedProvider = offers({ ...heritage, affiliateProductProviders: ['klook', 'kkday'] });
  assert(mockedProvider.length > 0 && mockedProvider.every(o => !isAffiliateProductPageUrl(o.url)), 'mock flag still yields search URLs');
  assert.notEqual(resolveRenderedCtaMode(mockedProvider), 'exact_product', 'R13 mocked flag must not be telemetry exact_product');
  for (const url of ['https://www.kkday.com/zh-tw/product/productlist?keyword=x', 'https://www.klook.com/zh-TW/search/?query=x', 'not a url']) {
    assert.equal(isAffiliateProductPageUrl(url), false, url);
  }
  assert.equal(isAffiliateProductPageUrl('https://www.kkday.com/zh-tw/product/12345'), true);
  assert.equal(isAffiliateProductPageUrl('https://www.klook.com/zh-TW/activity/678-x/'), true);
  // R13 telemetry: related search → experience_search, ticket search → ticket_search, none → hidden.
  assert.equal(resolveRenderedCtaMode(related), 'experience_search');
  assert.equal(resolveRenderedCtaMode(ticket), 'ticket_search');
  assert.equal(resolveRenderedCtaMode([]), 'hidden');
  // R9 low-prominence heritage (device shapes) has no search entry; R8 prominent heritage keeps it.
  assert.equal(offers({ types: ['historical_landmark', 'tourist_attraction', 'park'], rating: 3.9, userRatingCount: 124 }).length, 0);
  assert.equal(offers({ types: ['place_of_worship', 'tourist_attraction'], rating: 4.0, userRatingCount: 300 }).length, 0);
  assert.equal(offers({ types: ['museum', 'tourist_attraction'], rating: null, userRatingCount: null }).length, 2, 'admission venues keep search');
  // P1 product identity contract: provider flags / URL shape alone never make a verified product.
  for (const o of mockedProvider) {
    assert.equal(o.searchIntent, 'related_experiences', `flag-only ${o.provider} must stay a search entry`);
    assert.match(affiliateDisplayLabel(o, 'zh-TW'), /搜尋相關體驗/, 'flag-only button must use search copy');
    assert.equal(o.productId, undefined, 'no product identity without a product source');
  }
  assert.deepEqual(
    buildPlaceDetailTicketOffers({ ...heritage, name: 'Fixture', affiliateProductProviders: ['klook', 'kkday'] }).map(o => [o.provider, o.searchIntent, o.label]),
    mockedProvider.map(o => [o.provider, o.searchIntent, o.label]),
    'itinerary/detail/map share the flag-only downgrade',
  );
  const productShaped = (provider, url, productId) => ({ provider, kind: 'activity_ticket', label: provider, url, enabled: true, productId });
  const kkProduct = 'https://www.kkday.com/zh-tw/product/12345';
  assert.notEqual(resolveRenderedCtaMode([productShaped('kkday', kkProduct)]), 'exact_product', 'URL shape alone is not product identity');
  assert.notEqual(resolveRenderedCtaMode([productShaped('kkday', kkProduct, '99999')]), 'exact_product', 'product id must match the URL');
  assert.notEqual(resolveRenderedCtaMode([productShaped('kkday', 'https://www.kkday.com/zh-tw/product/productlist?keyword=12345', '12345')]), 'exact_product', 'search URL with an id is still search');
  assert.equal(resolveRenderedCtaMode([productShaped('kkday', kkProduct, '12345')]), 'exact_product', 'matching identity + product URL');
  assert.notEqual(resolveRenderedCtaMode([productShaped('kkday', kkProduct, '12345'), ...mockedProvider]), 'exact_product', 'mixed offers are not all products');
  assert.equal(requests, 0);
  console.log('PASS P1 product identity: flag-only → search copy, exact_product needs matching id + product URL');
  console.log('PASS R5-R9/R13: trusted keyword, search≠product, prominence-gated heritage, telemetry');
  console.log('PASS A-J: high-confidence tourism, station precedence, exclusions, unchanged commerce/wheel, related-experience copy, zero requests');
} finally { globalThis.fetch = originalFetch; }
