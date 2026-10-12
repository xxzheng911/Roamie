import assert from 'node:assert/strict';
import data from '../src/lib/ai/destination-localization-data.ts';
import {resolveCandidateDisplay as display} from '../src/lib/ai/destination-localization.ts';
import {buildCountryCitySelectionReply} from '../src/lib/ai/destination-advice.ts';
import {clearCountryCityOptionsCache,buildCountryCityOptions} from '../src/lib/ai/country-city-options.ts';
globalThis.fetch=async()=>{throw Error('NO_RUNTIME_NETWORK')};
let checks=0;
for(const [bindingId,r] of Object.entries(data)) {
 const c={...r.expected,summary:'fixture',placeId:'unchanged',lat:1,lng:2,localizationIdentity:{bindingId}};
 const before=JSON.stringify(c);
 // Production review statuses are asserted independently of the injected fixtures.
 assert.equal(display(c,'en').source === 'offline', (r.status === 'approved' || r.officialTravelRegion?.status === 'approved' || r.officialDestination?.status === 'approved'));checks++;
 const registry={[bindingId]:{...r,officialTravelRegion:undefined,officialDestination:undefined,status:'approved',review:{method:'external_identity_crosswalk',evidenceUrls:['https://example.org/test-only-crosswalk'],reviewedAt:'2026-10-12'}}};
 for(const locale of ['zh-TW','en','ja','ko']) {
  const out=display(c,locale,registry);
  if(r.labels[locale]) {assert.equal(out.name,r.labels[locale]);assert.equal(out.source,'offline');}
  else assert.notEqual(out.source,'offline');
  assert.equal(JSON.stringify(c),before);checks++;
 }
 for(const patch of [{country:'different-country'},{type:'different-level'},{localizationIdentity:{bindingId,qid:'Q999'}},{localizationIdentity:{bindingId,administrativeId:'other-admin'}},{localizationIdentity:{bindingId,countryCode:'XX'}}]) {
  assert.notEqual(display({...c,...patch},'en',registry).source,'offline');checks++;
 }
 assert.notEqual(display({...c,localizationIdentity:undefined},'en',registry).source,'offline');
 assert.notEqual(display(c,'en',{[bindingId]:{...registry[bindingId],qid:''}}).source,'offline');
 assert.notEqual(display(c,'en',{[bindingId]:{...registry[bindingId],review:undefined}}).source,'offline');
 assert.equal(display({...c,localizedNames:{en:'Verified provider label'}},'en',registry).name,'Verified provider label');checks+=4;
}
for(const locale of ['zh-TW','en','ja','ko']) {
 for(const country of ['葡萄牙','冰島','日本','越南']) {
  clearCountryCityOptionsCache();
  const result=buildCountryCitySelectionReply({country,month:12,locale,cityOptions:[]});
  assert.ok(result.reply);assert.ok(result.cityOptions.length>=3);
  assert.ok(result.cityOptions.every(x=>x.country===country));checks++;
 }
}
clearCountryCityOptionsCache();
const options=buildCountryCityOptions({country:'葡萄牙',language:'en'}).options;
assert.equal(options[0].localizationIdentity.bindingId,'editorial-pt-city-001');
assert.equal(options[0].name,'里斯本');
assert.equal(display(options[2],'en').name,'Algarve');
assert.equal(data['editorial-pt-region-001'].status,'pending');
assert.equal(display({name:'Unindexed valley',country:'Unindexed country',type:'region'},'ja').name,'Unindexed valley');
console.log(`PASS ${checks+4} assertions: production pending, fixture approval, conflicts, missing labels, immutable authority, actual renderer, zero network. Production bindings separately reviewed.`);

assert.deepEqual(Object.values(data).filter(r=>r.status==='approved').map(r=>r.qid).sort(),['Q1764','Q36433','Q597']);
for(const r of Object.values(data).filter(r=>r.status==='approved')) {
 assert.equal(r.review.scope,'display_name_only');assert.ok(r.review.basis);assert.ok(r.review.evidenceUrls.length>=2);
}
for(const locale of ['zh-TW','en','ja','ko']) {
 clearCountryCityOptionsCache();
 const r=buildCountryCitySelectionReply({country:'葡萄牙',month:12,locale,cityOptions:[]});
 for(const key of ['editorial-pt-city-001','editorial-pt-city-002']) assert.ok(r.reply.includes(data[key].labels[locale]));
 assert.ok(r.reply.includes(({ 'zh-TW':'阿爾加維',en:'Algarve',ja:'アルガルヴェ',ko:'Algarve' })[locale]));
 assert.deepEqual(r.cityOptions.map(o=>o.name),['里斯本','波爾圖','阿爾加維']);
 assert.deepEqual(JSON.parse(JSON.stringify(r.cityOptions)).map(o=>[o.name,o.country]),r.cityOptions.map(o=>[o.name,o.country]));
}
// Exercise real free-text dispatch, with no injected candidate names/labels.
const {createEmptySession}=await import('../src/lib/chat-session.ts');
const {mergeTravelContext}=await import('../src/lib/ai/travel-context.ts');
const {processAdviceTurn}=await import('../src/lib/ai/chat-state-machine.ts');
clearCountryCityOptionsCache();
const text="I'm going to Portugal in December.";
const merged=mergeTravelContext(createEmptySession(),text);
const actual=processAdviceTurn(text,merged.session,merged.context,undefined,'en');
assert.match(actual.advice.reply,/Lisbon/);assert.match(actual.advice.reply,/Porto/);assert.match(actual.advice.reply,/Algarve/);
assert.equal(actual.session.travelContext.destinationCountry,'葡萄牙');
assert.equal(actual.session.travelContext.travelMonth,'12月');
console.log('PASS actual Portugal free-text dispatch:',actual.advice.reply);
// Display approval must retain scope/evidence; status alone is insufficient.
const key='editorial-pt-city-001', approved=data[key];
const candidate={...approved.expected,localizationIdentity:{bindingId:key}};
for(const review of [
 {...approved.review,scope:'geographic_authority'},
 {...approved.review,basis:''},
 {...approved.review,evidenceUrls:[]},
 {...approved.review,method:'name_match'},
]) assert.notEqual(display(candidate,'en',{[key]:{...approved,review}}).source,'offline');
assert.notEqual(display(candidate,'en',{[key]:{...approved,status:'rejected'}}).source,'offline');
assert.notEqual(display(candidate,'en',{[key]:{...approved,labels:{}}}).source,'offline');
assert.equal(display({...candidate,localizedNames:{en:'Existing verified label'}},'en').name,'Existing verified label');
console.log('PASS seven additional approval provenance, rejected/missing-label and precedence checks.');
