import assert from 'node:assert/strict';
import data from '../src/lib/ai/destination-localization-data.ts';
import {resolveCandidateDisplay as display} from '../src/lib/ai/destination-localization.ts';
import {buildCountryCityOptions,clearCountryCityOptionsCache} from '../src/lib/ai/country-city-options.ts';
import {buildCountryCitySelectionReply} from '../src/lib/ai/destination-advice.ts';
let calls=0;globalThis.fetch=async()=>{calls++;throw Error('NO_NETWORK')};
clearCountryCityOptionsCache();
const options=buildCountryCityOptions({country:'冰島',language:'ja'}).options;
assert.deepEqual(options.map(x=>x.name),['雷克雅未克','藍湖','南部海岸']);
const before=JSON.stringify(options);
for(const [locale,names] of Object.entries({ja:['レイキャヴィーク','ブルーラグーン','South Coast'],en:['Reykjavík','Blue Lagoon','South Coast'],ko:['레이캬비크','Blue Lagoon','South Coast'],'zh-TW':['雷克雅未克','藍湖','南部海岸']})){
 const actual=options.map(x=>display(x,locale).name);
 // Existing reviewed Reykjavik translations remain under their original authority.
 assert.deepEqual(actual.slice(1),names.slice(1));
 if(locale==='ja')assert.equal(actual[0],names[0]);
 const result=buildCountryCitySelectionReply({country:'冰島',month:12,locale,cityOptions:[]});
 for(const name of actual)assert.ok(result.reply.includes(name),`${locale}: ${name}`);
 assert.deepEqual(JSON.parse(JSON.stringify(options)).map(x=>display(x,locale).name),actual);
}
assert.equal(JSON.stringify(options),before);
const c=options[1],key=c.localizationIdentity.bindingId,r=data[key];
assert.equal(r.officialDestination.semanticType,'tourist_attraction');
assert.equal(data[options[2].localizationIdentity.bindingId].officialDestination.semanticType,'tourism_route');
for(const patch of [{status:'pending'},{countryCode:'XX'},{bindingId:'wrong'},{semanticType:'administrative_region'},{scope:'resolver'},{boundaryEquivalence:true},{candidateType:'city'}]){
 assert.equal(display(c,'ja',{[key]:{...r,officialDestination:{...r.officialDestination,...patch}}}).name,c.name);
}
assert.equal(display({...c,country:'Elsewhere'},'ja').reason,'identity_conflict');
assert.equal(display(c,'ko').reason,'english_fallback');
for(const patch of [{status:'pending'},{sourceUrl:''},{snapshotVersion:''},{basis:''}]) {
 const copy=structuredClone(r);copy.officialDestination.labels.en={...copy.officialDestination.labels.en,...patch};
 assert.equal(display(c,'ko',{[key]:copy}).name,c.name);
}
assert.equal(display({...c,localizedNames:{ja:'Trusted provider name'}},'ja').name,'Trusted provider name');
assert.equal(display({...c,localizationIdentity:{bindingId:key,countryCode:'XX'}},'ja').reason,'identity_conflict');

// Generic contract for all supported semantics, with no destination acceptance list.
for(const semantic of ['city','scenic_spot','tourist_attraction','travel_region','tourism_route']){
 const generic={...r,expected:{name:'原名',country:'Example',countryCode:'XX',type:semantic},officialDestination:{...r.officialDestination,bindingId:'generic',countryCode:'XX',candidateType:semantic,semanticType:semantic,labels:{en:{...r.officialDestination.labels.en,name:'Trusted name'}}}};
 const gc={...generic.expected,placeId:'unchanged',latitude:1,longitude:2,localizationIdentity:{bindingId:'generic'}};
 const snapshot=JSON.stringify(gc);assert.equal(display(gc,'ja',{generic}).name,'Trusted name');assert.equal(JSON.stringify(gc),snapshot);
 assert.equal(display(gc,'ja',{generic:{...generic,officialDestination:{...generic.officialDestination,labels:{}}}}).name,'原名');
}
for(const [name,country] of [['Tuscany','Italy'],['Provence','France'],['Hokkaido','Japan']]){
 // No invented binding/translation: absence of metadata never rejects the candidate.
 assert.equal(display({name,country,type:'region'},'ja').name,name);
}
assert.equal(calls,0);
console.log('PASS Japanese destination options: real index → renderer, four locales, restore, semantics, conflict/fallback, global unbound cases, zero fetch.');
const {createEmptySession}=await import('../src/lib/chat-session.ts');
const {mergeTravelContext}=await import('../src/lib/ai/travel-context.ts');
const {processAdviceTurn}=await import('../src/lib/ai/chat-state-machine.ts');
const input='12月にアイスランドへ旅行に行きたいです。';
const merged=mergeTravelContext(createEmptySession(),input);
const actual=processAdviceTurn(input,merged.session,merged.context,undefined,'ja');
for(const label of ['レイキャヴィーク','ブルーラグーン','South Coast']) assert.ok(actual.advice.reply.includes(label));
assert.equal(actual.session.travelContext.travelMonth,'12月');
assert.equal(actual.session.travelContext.destinationCountry,'冰島');
assert.equal(calls,0);
console.log('PASS actual Japanese free-text advice dispatch, country/month preserved, no network.');
