import fs from 'node:fs';
import {normalizeGooglePlace} from '../src/lib/ai/normalize-google-place.ts';
import {resolveExploreSemanticEligibility} from '../src/lib/place-category.ts';
import {passesExploreHardExclusions,classifyExploreMapQualityTier,exploreMapQualityScore} from '../src/lib/explore-places-eligibility.ts';
const snapshot=JSON.parse(fs.readFileSync('scripts/fixtures/akihabara-candidate-audit.json','utf8'));
const unique=new Map();
for(const request of snapshot.requests)for(const raw of request.places??[]){const item=unique.get(raw.id)??{raw,sources:[]};item.sources.push(request.label);unique.set(raw.id,item);}
const rows=[...unique.values()].map(({raw,sources})=>{
 const place=normalizeGooglePlace(raw,{locale:'en'});const decision=resolveExploreSemanticEligibility(place);
 const ambiguous=!raw.primaryType||['shopping_mall','store','establishment','point_of_interest','general_store'].includes(raw.primaryType);
 const thin=ambiguous&&!raw.regularOpeningHours&&!raw.currentOpeningHours&&!raw.websiteUri&&!raw.nationalPhoneNumber&&!raw.internationalPhoneNumber;
 return {id:raw.id,name:raw.displayName.text,primaryType:raw.primaryType??null,types:raw.types,sources,accepted:decision.eligible,reason:decision.reason,hardGate:passesExploreHardExclusions(place,'all'),ambiguous,thin,photos:raw.photoCount??raw.photos?.length??0,reviews:raw.userRatingCount??0,hours:!!raw.regularOpeningHours,website:!!raw.websiteUri,phone:!!raw.nationalPhoneNumber,tier:classifyExploreMapQualityTier(place,'all'),score:exploreMapQualityScore(place,{lat:snapshot.center.latitude,lng:snapshot.center.longitude},'all',3)};
});
const summary={total:rows.length,accepted:rows.filter(x=>x.accepted).length,rejected:rows.filter(x=>!x.accepted).length,ambiguous:rows.filter(x=>x.ambiguous).length,thinAmbiguous:rows.filter(x=>x.thin).length,thinAccepted:rows.filter(x=>x.thin&&x.accepted).length};
console.info(JSON.stringify(summary));
console.info(JSON.stringify(rows.filter(x=>x.thin),null,2));
if(process.env.AUDIT_OUTPUT)fs.writeFileSync(process.env.AUDIT_OUTPUT,JSON.stringify({summary,rows},null,2)+'\n');
