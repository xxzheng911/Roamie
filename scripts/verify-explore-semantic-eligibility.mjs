import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeGooglePlace } from '../src/lib/ai/normalize-google-place.ts';
import { resolveExploreSemanticEligibility as admission } from '../src/lib/place-category.ts';
import { filterAndSelectExploreMapPlaces, pickRelaxedExploreCategoryPlaces } from '../src/lib/explore-map-places-filter.ts';
import { filterExplorePlaces } from '../src/lib/filter-explore-places.ts';
import { searchExploreCategoryPlaces } from '../src/lib/explore-category-search.ts';
import { getExploreCategoryById } from '../src/lib/places-search-config.ts';
import { writeMapPlacesCache, readMapPlacesCache } from '../src/lib/map-places-cache.ts';
import { passesHomeNearbyHardExclusions } from '../src/lib/home-nearby-eligibility.ts';
import { mergeExploreAllCategoryResults } from '../src/lib/explore-all-places-merge.ts';
import { exploreSearchPresentation } from '../src/lib/explore-search-presentation.ts';
const evidence=JSON.parse(fs.readFileSync('scripts/fixtures/explore-provider-evidence.json','utf8'));
const [gallery,building]=evidence.map(raw=>normalizeGooglePlace(raw,{locale:'en'}));
const origin={lat:35.703,lng:139.777};
const select=(places,cat='all',cityMode=false)=>filterAndSelectExploreMapPlaces(places,{cat,origin,cityMode}).places;
assert.equal(admission(gallery).eligible,true,'Live art_gallery evidence: must not hard-exclude Playacolores');
assert.deepEqual(admission(building),{eligible:false,reason:'structural_identity_conflict'});
for(const cityMode of [false,true]) for(const cat of ['all','sight','district','food','coffee','night','park']) {
 assert.equal(select([building],cat,cityMode).length,0);
 assert.equal(pickRelaxedExploreCategoryPlaces([building],{cat,origin,cityMode}).length,0);
}
assert.equal(select([gallery],'sight').length,1);
assert.equal(filterExplorePlaces([building],{exploreMapTier:'fallback',logDrop:false}).length,0);
const fixture=(type,extra={})=>({...gallery,id:`fixture-${type}`,name:`Venue ${type}`,originalName:`Venue ${type}`,
 primaryType:type,types:[type,'point_of_interest','establishment'],photoName:null,rating:null,userRatingCount:0,
 regularOpeningHours:undefined,currentOpeningHours:undefined,websiteUri:undefined,nationalPhoneNumber:undefined,internationalPhoneNumber:undefined,
 ...(type==='shopping_mall'?{websiteUri:'https://mall.example.test',nationalPhoneNumber:'03-1234-5678'}:{}),...extra});
const positives=['cafe','restaurant','bakery','museum','art_gallery','tourist_attraction','park',
 'shopping_mall','church','buddhist_temple','shinto_shrine','mosque','synagogue','historical_landmark','spa','hiking_area'];
for(const type of positives){
 const p=fixture(type);
 assert.equal(admission(p).eligible,true,type);
 assert.equal(select([p]).length,1,`${type}: zero photos/reviews/hours must remain eligible`);
 if(['museum','park','church','buddhist_temple','shinto_shrine'].includes(type)) assert.equal(select([p],'sight').length,1,type);
 assert.equal(filterExplorePlaces([p],{exploreMapTier:'display',logDrop:false}).length,1,type);
}
for(const type of ['building','premise','apartment_building','street_address','route','intersection','locality','administrative_area_level_2','corporate_office','point_of_interest','establishment','future_unknown_type']){
 const p=fixture(type,{rating:5,userRatingCount:1000});
 assert.equal(admission(p).eligible,false,`${type}: high rating cannot create destination purpose`);
 assert.equal(select([p]).length,0);
}
const ambiguous=fixture('future_unknown_type',{name:'Neighborhood Cafe',originalName:'Neighborhood Cafe',regularOpeningHours:{weekdayDescriptions:['Monday: 10:00–18:00']}});
assert.equal(admission(ambiguous).eligible,true,'Unknown type + clear name + operation/hours evidence');
assert.equal(select([ambiguous],'coffee').length,1,'Unknown type not blanket denied');
const noSupport={...ambiguous,regularOpeningHours:undefined};
assert.equal(admission(noSupport).eligible,false,'A name hint alone is not enough');
const structuralControls=[
 fixture('shopping_mall',{name:'Example Building III',originalName:'Example Building III',rating:5,userRatingCount:1,websiteUri:undefined,nationalPhoneNumber:undefined}),
 fixture('point_of_interest',{name:'研究ビル',originalName:'研究ビル'}),
];
for(const p of structuralControls)assert.equal(admission(p).eligible,false);
for(const p of [
 fixture('cafe',{name:'Building Cafe',originalName:'Building Cafe'}),
 fixture('tourist_attraction',{name:'Historic Building',originalName:'Historic Building'}),
 fixture('shopping_mall',{name:'Shopping Building',originalName:'Shopping Building'}),
 fixture('shopping_mall',{name:'Example Building III',originalName:'Example Building III',regularOpeningHours:{weekdayDescriptions:['Monday: 10:00–18:00']}}),
])assert.equal(admission(p).eligible,true,'Do not blacklist the word building');
assert.equal(admission(fixture('cafe',{pureServiceAreaBusiness:true})).eligible,false);
assert.equal(passesHomeNearbyHardExclusions(gallery),true);
assert.equal(passesHomeNearbyHardExclusions(building),false,'Home shares semantic admission');
for(const type of ['cafe','restaurant','museum','park','shopping_mall']) assert.equal(passesHomeNearbyHardExclusions(fixture(type)),true,`Home ${type}`);
writeMapPlacesCache('semantic-old-cache',[building],null);
assert.equal(readMapPlacesCache('semantic-old-cache'),null,'Old cache cannot bypass admission and suppress expansion');
const diverse=mergeExploreAllCategoryResults({coffee:[fixture('cafe')],food:[fixture('restaurant')],sight:[fixture('museum'),fixture('park')],district:[fixture('shopping_mall')]},{origin,timeBucket:'day'});
assert.equal(new Set(diverse.map(p=>p.primaryType)).size,5,'Diverse eligible families survive merge');
assert.equal(exploreSearchPresentation({primary:building,recommendations:[],primarySearchLoading:false,backgroundRecommendationLoading:false}).places[0],building,'Explicit search selection remains accessible');
assert.equal(exploreSearchPresentation({primary:null,recommendations:[],primarySearchLoading:false,backgroundRecommendationLoading:false}).showEmpty,true);
// Exercise the actual asynchronous search pipeline: junk primary candidates must
// trigger existing fallback queries, which are re-filtered before card creation.
for(const replenish of [true,false]){
 const center={lat:35.703+(replenish?0.02:0.04),lng:139.777};
 const junk={...building,id:`expansion-${replenish}`,lat:center.lat,lng:center.lng};
 let calls=0;
 const result=await searchExploreCategoryPlaces(getExploreCategoryById('district'),{
  userLocation:center,weather:null,locale:'en',reasonProfile:null,saved:[],recommendMode:'nearby',
  searchPlacesFn:async()=>{calls++;return {places:calls>1&&replenish?[fixture('shopping_mall',{id:'replacement-mall',lat:center.lat,lng:center.lng})]:[junk],error:null};},
 });
 assert.ok(calls>1,'Semantic insufficiency must trigger existing expansion/search fallback');
 assert.ok(calls<15,'Fallback stays bounded');
 assert.ok(result.every(p=>p.id!==junk.id),'Never reintroduce junk to fill minimum count');
 assert.equal(result.length,replenish?1:0);
 console.info('Expansion',JSON.stringify({replenish,calls,resultCount:result.length}));
}
console.info('PASS live evidence, structural conflict, all categories/relaxed tiers, positive controls, sparse metadata, unknown evidence, Home, cache, search, diversity and bounded expansion');
