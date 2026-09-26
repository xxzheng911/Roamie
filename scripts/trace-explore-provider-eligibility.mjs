import fs from 'node:fs';
import { normalizeGooglePlace } from '../src/lib/ai/normalize-google-place.ts';
import { getPlaceCategory, matchesCategory } from '../src/lib/place-category.ts';
import { resolvePlaceCategoryFamily } from '../src/lib/ai/place-category-family.ts';
import { passesExploreHardExclusions, classifyExploreMapQualityTier, exploreMapQualityScore } from '../src/lib/explore-places-eligibility.ts';
import { filterAndSelectExploreMapPlaces } from '../src/lib/explore-map-places-filter.ts';
import { isRecommendablePlace } from '../src/lib/is-recommendable-place.ts';
const raw = JSON.parse(fs.readFileSync('scripts/fixtures/explore-provider-evidence.json','utf8'));
for(const r of raw){
 const p=normalizeGooglePlace(r,{locale:'en'});
 const origin={lat:p.lat,lng:p.lng}; // reproducible zero-distance control, not device GPS
 console.info(JSON.stringify({id:p.id,name:p.name,category:getPlaceCategory(p),family:resolvePlaceCategoryFamily(p),displayGate:isRecommendablePlace(p,'explore_map',{exploreMapTier:'display',logDrop:false}),categories:['all','sight','district','coffee','food','park','night'].map(cat=>({cat,matches:matchesCategory(p,cat),hard:passesExploreHardExclusions(p,cat),tier:classifyExploreMapQualityTier(p,cat),zeroDistanceScore:exploreMapQualityScore(p,origin,cat,3),selected:filterAndSelectExploreMapPlaces([p],{cat,origin}).places.length}))}));
}
