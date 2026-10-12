import assert from 'node:assert/strict';
import {normalizeGooglePlace} from '../src/lib/ai/normalize-google-place.ts';
import {normalizeCountryCityOptions,buildCountryCityOptions,clearCountryCityOptionsCache} from '../src/lib/ai/country-city-options.ts';
import {resolveCandidateDisplay as display} from '../src/lib/ai/destination-localization.ts';
import data from '../src/lib/ai/destination-localization-data.ts';
globalThis.fetch=async()=>{throw Error('NO_NETWORK')};
const cases=[['Portugal','Porto'],['Iceland','Reykjavík'],['Italy','Florence'],['France','Lyon'],['Japan','Sapporo'],['Vietnam','Da Nang'],['Thailand','Chiang Mai'],['New Zealand','Queenstown'],['Morocco','Marrakech'],['Canada','Banff'],['Argentina','Mendoza'],['Portugal','Algarve','region'],['Italy','Tuscany','region'],['France','Provence','region'],['Japan','Hokkaido','region']];
for(const [i,[country,name,type='city']] of cases.entries()) {
 const id=`ChIJMockTrustedIdentity${i}`,raw={id,displayName:{text:name,languageCode:'en'},location:{latitude:40+i/100,longitude:10+i/100},types:['locality']};
 const normalized=normalizeGooglePlace(raw,{locale:'en'});
 assert.equal(normalized.englishName,name);assert.equal(normalized.sourceLocale,'en');assert.equal(normalized.id,id);
 assert.equal(normalized.lat,raw.location.latitude);assert.equal(normalized.lng,raw.location.longitude);
 const [candidate]=normalizeCountryCityOptions([{name,type,summary:'Provider fixture',country,originalName:normalized.originalName,englishName:normalized.englishName,localizedNames:normalized.localizedNames,sourceLocale:normalized.sourceLocale}],country);
 const restored=JSON.parse(JSON.stringify(candidate)),before=JSON.stringify(restored);
 for(const locale of ['en','ja','ko','zh-TW']) { const shown=display(restored,locale);assert.ok(shown.name);if(locale==='en')assert.equal(shown.name,name); }
 assert.equal(restored.englishName,name);assert.equal(restored.sourceLocale,'en');assert.equal(JSON.stringify(restored),before);
 console.log('MOCK PASS provider English preservation:',country,name);
}
const id='ChIJTrustedSameIdentity';
const en=normalizeGooglePlace({id,displayName:{text:'Verified English',languageCode:'en'},types:['locality']},{locale:'en'});
const ja=normalizeGooglePlace({id,displayName:{text:'現地名',languageCode:'ja'},types:['locality']},{locale:'ja',existing:en});
assert.equal(ja.localizedNames.en,'Verified English');assert.equal(ja.localizedNames.ja,'現地名');assert.equal(ja.englishName,'Verified English');
assert.equal(display({name:'原名',country:'X',type:'region',englishName:ja.englishName},'ko').reason,'english_fallback');
const unknown=normalizeGooglePlace({id:'ChIJOther',displayName:{text:'原名'},types:['locality']},{locale:'en',existing:en});
assert.equal(unknown.englishName,undefined);assert.equal(unknown.localizedNames.en,undefined);assert.equal(unknown.sourceLocale,undefined);
assert.equal(display({name:'Unreviewed original',country:'X',type:'region'},'ko').reason,'original_fallback');
// Real production data is evaluated separately, never filled with mock translations.
for(const country of ['葡萄牙','冰島','日本','越南']) {
 clearCountryCityOptionsCache();
 const options=buildCountryCityOptions({country,language:'en'}).options;
 console.log('REAL DATA',country,options.map(c=>({canonical:c.name,en:display(c,'en').name,source:display(c,'en').source,reason:display(c,'en').reason})));
 assert.ok(options.length);
}
for(const qid of ['Q25282','Q37951','Q26831']) assert.equal(Object.values(data).find(r=>r.qid===qid).status,'pending');
console.log('PASS metadata-only preservation; unknown source locale never inferred from app locale; identity isolation; pending bindings unchanged; real data and mock coverage separated.');

assert.equal(display({name:'Original',country:'X',type:'region',englishName:'One',localizedNames:{en:'Another'}},'ko').reason,'identity_conflict');
