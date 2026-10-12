import assert from 'node:assert/strict';
import data from '../src/lib/ai/destination-localization-data.ts';
import {resolveCandidateDisplay as display} from '../src/lib/ai/destination-localization.ts';
import {buildCountryCityOptions,clearCountryCityOptionsCache} from '../src/lib/ai/country-city-options.ts';
import {buildCountryCitySelectionReply} from '../src/lib/ai/destination-advice.ts';
import {itineraryDestinationDisplay} from '../src/lib/native-qa-display.ts';
import {tripTitleDisplay} from '../src/lib/trip/title-display.ts';
globalThis.fetch=async()=>{throw Error('NO_RUNTIME_NETWORK')};
clearCountryCityOptionsCache();
const c=buildCountryCityOptions({country:'葡萄牙',language:'en'}).options[2];
const key=c.localizationIdentity.bindingId,r=data[key],before=JSON.stringify(c);
for(const [locale,name] of Object.entries({'zh-TW':'阿爾加維',en:'Algarve',ja:'アルガルヴェ',ko:'Algarve'})) {
 assert.equal(display(c,locale).name,name);
 assert.ok(buildCountryCitySelectionReply({country:'葡萄牙',month:12,locale,cityOptions:[]}).reply.includes(name));
 assert.ok(itineraryDestinationDisplay('葡萄牙 · 阿爾加維',locale).includes(name));
 const input={title:'old',custom:false,destination:'葡萄牙 · 阿爾加維',days:4};
 assert.ok(tripTitleDisplay(JSON.parse(JSON.stringify(input)),locale).includes(name));
 assert.equal(tripTitleDisplay({...input,title:'My own title',custom:true},locale),'My own title');
 assert.equal(JSON.stringify(c),before);
}
assert.equal(display(c,'ko').reason,'english_fallback');
assert.equal(r.status,'pending');assert.equal(r.qid,'Q26831');assert.equal(r.officialTravelRegion.labels.ko,undefined);
for(const qid of ['Q25282','Q37951']) {const record=Object.values(data).find(r=>r.qid===qid);assert.ok(record);assert.equal(record.status,'pending');}
const withOfficial=(source)=>({[key]:{...r,officialTravelRegion:source}});
for(const patch of [{bindingId:'wrong'},{countryCode:'XX'},{candidateType:'city'},{semanticType:'administrative_region'},{status:'pending'},{scope:'geographic_authority'},{boundaryEquivalence:true},{basis:''}]) {
 assert.equal(display(c,'en',withOfficial({...r.officialTravelRegion,...patch})).name,c.name);
}
for(const patch of [{country:'wrong'},{type:'city'},{localizationIdentity:{bindingId:key,countryCode:'XX'}},{localizationIdentity:{bindingId:key,qid:'Q999'}}]) assert.equal(display({...c,...patch},'en').reason,'identity_conflict');
assert.equal(display({...c,localizationIdentity:{bindingId:'wrong'}},'en').name,c.name);
for(const patch of [{status:'pending'},{sourceUrl:''},{snapshotVersion:''},{basis:''}]) {
 const source=structuredClone(r.officialTravelRegion);source.labels.en={...source.labels.en,...patch};
 assert.equal(display(c,'ko',withOfficial(source)).name,c.name);
}
// Approved source conflict fails closed; an unreviewed Wikidata label never conflicts with official evidence.
const conflicting={...r,status:'approved',review:{method:'display_identity_evidence',scope:'display_name_only',evidenceUrls:['https://example.org/a','https://example.org/b'],reviewedAt:'2026-10-12',basis:'test-only verified evidence'},labels:{en:'Different identity'}};
assert.equal(display(c,'en',{[key]:conflicting}).reason,'identity_conflict');
// Generic official-only identity: no QID, and no destination-specific code path.
const generic={...r,qid:undefined,source:undefined,sourceRevision:undefined,originalLocale:undefined,expected:{name:'Original region',country:'Example',countryCode:'XX',type:'region'},officialTravelRegion:{...r.officialTravelRegion,bindingId:'generic',countryCode:'XX',labels:{en:{...r.officialTravelRegion.labels.en,name:'Reviewed region'}}}};
const gc={...generic.expected,localizationIdentity:{bindingId:'generic'},placeId:'unchanged',lat:1,lng:2};
const gb=JSON.stringify(gc);
for(const locale of ['zh-TW','ja','ko']) {const out=display(gc,locale,{generic});assert.equal(out.name,'Reviewed region');assert.equal(out.reason,'english_fallback');}
assert.equal(JSON.stringify(gc),gb);
assert.equal(display(gc,'ko',{generic:{...generic,officialTravelRegion:{...generic.officialTravelRegion,labels:{}}}}).name,gc.name);
assert.equal(display({...gc,localizedNames:{ko:'Provider native label'}},'ko',{generic}).name,'Provider native label');
assert.equal(display({...gc,localizedNames:{en:'Provider English'}},'ko',{generic}).name,'Provider English');
assert.equal(display({name:'Unindexed',country:'Elsewhere',type:'region'},'ko').reason,'original_fallback');
console.log('PASS official tourism: real candidate/renderer/title/restore, 4 locales, pending preservation, identity and provenance conflicts, English fallback, immutable canonical fields, zero network.');
