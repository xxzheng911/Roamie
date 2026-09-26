import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeGooglePlace} from '../src/lib/ai/normalize-google-place.ts';
import {resolveExploreSemanticEligibility as gate} from '../src/lib/place-category.ts';
import {filterAndSelectExploreMapPlaces,pickRelaxedExploreCategoryPlaces} from '../src/lib/explore-map-places-filter.ts';
import {homeNearbyHardExclusionReason} from '../src/lib/home-nearby-eligibility.ts';
import {PLACES_FIELD_MASK} from '../src/lib/google-maps-api.ts';
import {writeMapPlacesCache,readMapPlacesCache} from '../src/lib/map-places-cache.ts';
import {searchExploreCategoryPlaces} from '../src/lib/explore-category-search.ts';
import {getExploreCategoryById} from '../src/lib/places-search-config.ts';
const sample=JSON.parse(fs.readFileSync('scripts/fixtures/akihabara-candidate-audit.json','utf8'));
const unique=new Map(sample.requests.flatMap(r=>(r.places??[]).map(p=>[p.id,p])));
assert.equal(unique.size,137,'Frozen reproducible candidate set');
const normalized=new Map([...unique].map(([id,raw])=>[id,normalizeGooglePlace(raw,{locale:'en'})]));
const center={lat:sample.center.latitude,lng:sample.center.longitude};
const maletas=normalized.get('ChIJ5d75LgCPGGARUd9ISdVgyT8');
const lowEvidenceIds=['ChIJ5d75LgCPGGARUd9ISdVgyT8','ChIJcR0LSwCPGGAR0TVjGDFX7hQ','ChIJjUTGOACPGGARJeA7wEjIhrQ','ChIJBdknPgCPGGARjpmSMR633qU','ChIJBSBjAACPGGARkPl4qI5ZtHU'];
for(const id of lowEvidenceIds){
 const p=normalized.get(id);assert.ok(p);assert.equal(gate(p).eligible,false,p.name);
 assert.ok(homeNearbyHardExclusionReason(p),`Home: ${p.name}`);
 for(const cityMode of [false,true])for(const cat of ['all','sight','district','coffee','food','park','night']){
  assert.equal(filterAndSelectExploreMapPlaces([p],{cat,origin:center,cityMode}).places.length,0,p.name);
  assert.equal(pickRelaxedExploreCategoryPlaces([p],{cat,origin:center,cityMode}).length,0,p.name);
 }
}
const positiveIds=[
 'ChIJrarMOaiOGGARrSdw26Nkboc', // zero-review/photo/hours gallery in a building
 'ChIJ81QNuwKMGGARAQtFm57L2YI', // sparse gallery
 'ChIJh7WDGAOMGGARDR0OeLKorgo', // gallery without all contact/hours/photo evidence
 'ChIJQzEFbwCNGGARTyu7eV0eHcU', // low-review, no-photo museum
 'ChIJS2dPOKiOGGAREfQsUq73wP0', // shrine
 'ChIJpQd7ZqiOGGARsRs2aimeHl4', // park
 'ChIJTy2rYQCPGGARJQ166eekmtI', // actual mall
 'ChIJGwUSnkWPGGAReSnxouAgdPA', // substantiated store, 7 reviews
 'ChIJl4JyeQCNGGARALwE_cYkA2E', // restaurant
];
for(const id of positiveIds){const p=normalized.get(id);assert.ok(p,id);assert.equal(gate(p).eligible,true,p.name);}
for(const request of sample.requests.filter(r=>r.label==='structural-diagnostic'))for(const raw of request.places){
 assert.equal(gate(normalized.get(raw.id)).eligible,false,`Structured non-destination: ${raw.displayName.text}`);
}
for(const p of normalized.values()){
 if(['atm','storage','health','service'].includes(p.primaryType))assert.equal(gate(p).eligible,false,`Contact metadata must not legitimize ${p.primaryType}`);
 // In every actual raw candidate, a generic commercial tag stripped of other
 // semantic/business evidence must fail regardless of its name language.
 const thin={...p,primaryType:'shopping_mall',types:['shopping_mall','establishment','point_of_interest'],
  name:'店舗候補 / متجَر / Venue',originalName:'店舗候補 / متجَر / Venue',address:'3-5 District',
  regularOpeningHours:undefined,currentOpeningHours:undefined,websiteUri:undefined,nationalPhoneNumber:undefined,internationalPhoneNumber:undefined};
 assert.equal(gate(thin).eligible,false,'Photos/ratings never independently prove ambiguous commerce');
}
const opaque={...maletas,name:'متجر',originalName:'متجر',address:'Office Building, 2-3',
 websiteUri:'https://venue.example.test',nationalPhoneNumber:'+81 3 1234 5678',photoName:null,userRatingCount:0};
assert.equal(gate(opaque).eligible,true,'Language-independent independent contact evidence, no photos/reviews/hours');
assert.equal(gate({...opaque,websiteUri:undefined}).eligible,false,'One metadata field is not proof');
const hoursOnly={...maletas,regularOpeningHours:{openNow:false},websiteUri:undefined,nationalPhoneNumber:undefined};
assert.equal(gate(hoursOnly).eligible,false,'One field is not enough for an ambiguous entity');
assert.equal(gate({...hoursOnly,userRatingCount:1}).eligible,true,'One-review venue with meaningful hours is allowed');
assert.equal(gate({...maletas,primaryType:'art_gallery',types:['art_gallery']}).eligible,true,'Structural host cannot disqualify a specific gallery tenant');
assert.equal(gate({...opaque,regularOpeningHours:{},websiteUri:undefined,nationalPhoneNumber:undefined}).eligible,false,'Empty object is not hours evidence');
// Test the same field projection as production provider search, through normalization.
const requested=PLACES_FIELD_MASK.split(',').map(x=>x.replace(/^places\./,''));
for(const field of ['websiteUri','nationalPhoneNumber','internationalPhoneNumber','pureServiceAreaBusiness'])assert.ok(requested.includes(field));
for(const id of positiveIds){
 const raw=unique.get(id);const projected=Object.fromEntries(Object.entries(raw).filter(([key])=>requested.includes(key)));
 assert.equal(gate(normalizeGooglePlace(projected,{locale:'en'})).eligible,true,`Production projection ${id}`);
}
const currentOnly=normalizeGooglePlace({...unique.get(positiveIds[6]),regularOpeningHours:undefined,currentOpeningHours:{openNow:true}}, {locale:'en'});
assert.equal(currentOnly.currentOpeningHours.openNow,true,'Current hours survive normalization');
writeMapPlacesCache('candidate-set-old-maletas',[maletas],null);
assert.equal(readMapPlacesCache('candidate-set-old-maletas'),null,'Old admission cache cannot resurrect candidate');
for(const replenish of [false,true]){
 const origin={lat:35.73+(replenish?0.02:0),lng:139.8};let calls=0;
 const result=await searchExploreCategoryPlaces(getExploreCategoryById('district'),{
 userLocation:origin,weather:null,locale:'en',reasonProfile:null,saved:[],recommendMode:'nearby',
 searchPlacesFn:async()=>({places:++calls>1&&replenish?[{...normalized.get('ChIJTy2rYQCPGGARJQ166eekmtI'),lat:origin.lat,lng:origin.lng}]:[{...maletas,lat:origin.lat,lng:origin.lng}],error:null})});
 assert.ok(calls>1&&calls<15);assert.equal(result.length,replenish?1:0);assert.ok(result.every(p=>p.id!==maletas.id));
 console.info('CANDIDATE_EXPANSION',JSON.stringify({replenish,calls,resultCount:result.length}));
}
console.info('PASS 137 actual candidates, 5 thin-commercial negatives, 9 real positives, 20 structural controls, multilingual/metamorphic evidence checks, production projection, cache and expansion');
