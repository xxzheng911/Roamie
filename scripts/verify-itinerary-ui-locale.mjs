import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itineraryDestinationDisplay,itineraryTransportDisplay} from '../src/lib/native-qa-display.ts';
import {formatLegTravelTimeLabel,travelMinutesForMode} from '../src/lib/saved-trip/travel-time.ts';
import {formatDurationMinutes} from '../src/lib/picker-utils.ts';
import {translate} from '../src/lib/i18n/translate.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const locales=['zh-TW','en','ja','ko'];
const countries=['葡萄牙','Portugal','ポルトガル','포르투갈'];
for(const [i,locale] of locales.entries()) {
 assert.equal(itineraryDestinationDisplay('葡萄牙 · Porto',locale),countries[i]+' · '+['波爾圖','Porto','ポルト','포르투'][i]);
 assert.ok(!translate(locale,'nativeQa.directionsCompact').startsWith('nativeQa.'));
 for(const [mode,label] of [['WALK','步行'],['TRANSIT','大眾運輸'],['DRIVE','租車自駕'],['DRIVE','計程車/共乘'],['BICYCLE','單車']]) {
  const leg={durationMinutes:4,estimates:{walk:4,drive:4,transit:4},resolvedMode:mode,requestedMode:mode,routeStatus:'ok',transportDisplayText:'步行約 4 分鐘'};
  const snapshot=JSON.stringify(leg);
  const result=formatLegTravelTimeLabel(leg,label,{locale});
  assert.ok(result.includes('4'));assert.equal(travelMinutesForMode(leg,label),4);assert.equal(JSON.stringify(leg),snapshot);
  if(locale==='en') assert.ok(!/[\u3400-\u9fff]/.test(result));
 }
}
assert.equal(formatLegTravelTimeLabel({durationMinutes:4,estimates:{walk:4},resolvedMode:'WALK',routeStatus:'ok',transportDisplayText:'步行約4分鐘'},'步行',{locale:'en'}),'About 4 min on foot');
assert.equal(formatDurationMinutes(36,'en'),'36 min');assert.equal(formatDurationMinutes(82,'en'),'1 hr 22 min');
const read=p=>readFileSync(p,'utf8');
const card=read('src/components/saved/TripLocationCard.tsx');
assert.match(card,/flex-wrap/);assert.doesNotMatch(card,/p7b80d07823|pf317313492|p4e6e23af51/);assert.match(card,/onClick=\{\(\) => openExternal\(navUrl\)\}/);
const sheet=read('src/components/pickers/RoamiePickerSheet.tsx');assert.match(sheet,/modal = false/);assert.match(sheet,/modal=\{modal\}/);
const picker=read('src/components/saved/TripTransportPicker.tsx');assert.equal((picker.match(/<RoamiePickerSheet\s+modal/g)||[]).length,2);assert.match(picker,/onChange\(label\);\s+setOpen\(false\)/);
const affiliate=read('src/components/trip/TripAffiliateSection.tsx');assert.match(affiliate,/offer.provider === "klook" \? "Klook" : "KKday"/);assert.match(affiliate,/openAffiliateUrl/);
console.log('PASS four-locale destination, transport numeric authority, duration, card/affiliate/transport-sheet source contracts; device layout/gestures NOT VERIFIED');

const {createElement}=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const {I18nProvider}=await import('../src/hooks/use-i18n.tsx');
const {TripAffiliateSection}=await import('../src/components/trip/TripAffiliateSection.tsx');
const {TripLocationCard}=await import('../src/components/saved/TripLocationCard.tsx');
const offers=['klook','kkday'].map(provider=>({provider,kind:'activity_ticket',searchIntent:'related_experiences',label:'legacy label',url:`https://example.test/${provider}?tracking=retained`,enabled:true}));
for(const locale of locales) {
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:locale}});
 const before=JSON.stringify(offers);
 const render=element=>renderToStaticMarkup(createElement(I18nProvider,null,element));
 const affiliateMarkup=render(createElement(TripAffiliateSection,{kind:'ticket',offers}));
 assert.match(affiliateMarkup,/>Klook</);assert.match(affiliateMarkup,/>KKday</);assert.equal(JSON.stringify(offers),before);
 const cardMarkup=render(createElement(TripLocationCard,{arrivalTime:'10:00',durationMinutes:82,lat:1,lng:2,onSetArrivalTime:()=>{},onSetDurationMinutes:()=>{}}));
 assert.ok(cardMarkup.includes(translate(locale,'nativeQa.directionsCompact')));assert.ok(cardMarkup.includes('10:00'));
 assert.ok(cardMarkup.includes(translate(locale,'nativeQa.arriveCompact')));
 assert.ok(cardMarkup.includes(translate(locale,'nativeQa.stayHoursMinutesCompact',{hours:1,minutes:22})));
 for(const minutes of [0,21,60,81,600,1441]) {
  const markup=render(createElement(TripLocationCard,{arrivalTime:'23:59',durationMinutes:minutes,lat:1,lng:2,onSetArrivalTime:()=>{},onSetDurationMinutes:()=>{}}));
  const h=Math.floor(minutes/60),m=minutes%60;
  const expected=translate(locale,h<=0?'nativeQa.stayMinutesCompact':m===0?'nativeQa.stayHoursCompact':'nativeQa.stayHoursMinutesCompact',{hours:h,minutes:m});
  assert.ok(markup.includes(expected));
 }
 assert.match(cardMarkup,/min-h-11/);assert.match(cardMarkup,/max-w-full/);
}
console.log('PASS real SSR card/affiliate in four locales; immutable URLs, labels, times');
