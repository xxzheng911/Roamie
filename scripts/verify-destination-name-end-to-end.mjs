import assert from 'node:assert/strict';
import {rawToTripLocation} from '../src/lib/location.functions.ts';
import {mapPlaceDetailsScreenRaw} from '../src/lib/places.functions.ts';
import {attachDestinationDisplay,verifiedDestinationDisplay} from '../src/lib/ai/destination-display-metadata.ts';
import {buildDestinationOptionsFromCityList} from '../src/lib/ai/destination-anchor.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {buildItineraryFromDayPlan} from '../src/lib/ai/ai-day-plan-source.ts';
import {toCoreTrip,resolveCoreTripTitle} from '../src/lib/trip/core-trip.ts';
import {tripTitleDisplay,workspaceTitleDisplay} from '../src/lib/trip/title-display.ts';
import {itineraryDestinationDisplay} from '../src/lib/native-qa-display.ts';
import {resolveCandidateDisplay} from '../src/lib/ai/destination-localization.ts';
import {buildCountryCityOptions,clearCountryCityOptionsCache} from '../src/lib/ai/country-city-options.ts';
globalThis.fetch=async()=>{throw Error('NO_PROVIDER_CALLS')};
const cases=[['Portugal','Porto'],['Iceland','Reykjavík'],['Japan','Sapporo'],['Vietnam','Da Nang'],['Italy','Florence'],['France','Lyon'],['New Zealand','Queenstown'],['Morocco','Marrakech']];
for(const [i,[country,city]] of cases.entries()) {
 const raw={id:`ChIJNamesE2E${i}`,displayName:{text:city,languageCode:'en'},types:['locality'],location:{latitude:40+i/100,longitude:10+i/100},addressComponents:[{longText:country,types:['country']},{longText:city,types:['locality']}]};
 const loc=rawToTripLocation(raw,raw.id);assert.ok(loc);assert.equal(loc.destinationDisplay.englishName,city);
 const details=mapPlaceDetailsScreenRaw(raw,'en');assert.equal(details.englishName,city);assert.equal(details.sourceLocale,'en');assert.equal(details.id,raw.id);
 const candidate={name:city,country,type:'city',summary:'Provider fixture',englishName:city,localizedNames:{en:city},sourceLocale:'en'};
 const options=buildDestinationOptionsFromCityList([candidate],country);
 assert.equal(options[0].destinationDisplay.englishName,city);
 let s={...createEmptySession(),travelContext:{destination:country,destinationCountry:country,destinationType:'country',travelMonth:'12月',interests:[],offeredDestinationOptions:options}};
 s=mergeTravelContext(s,city).session;
 let calls=0;s=await resolveGlobalPlanningCandidate(s,'en',async()=>{calls++;return {location:loc,rawResultCount:1}});
 assert.ok(s.tripDestination);assert.equal(s.tripDestination.placeId,raw.id);assert.equal(s.tripDestination.destinationDisplay.sourceLocale,'en');
 s=JSON.parse(JSON.stringify(s));const before=JSON.stringify(s);
 const item={dayIndex:1,orderIndex:0,time:'09:00',slotType:'scenic',placeId:raw.id,name:city,address:'',lat:loc.lat,lng:loc.lng,type:'locality',originalName:city,localizedDisplayName:city,englishName:details.englishName,localizedNames:details.localizedNames,sourceLocale:details.sourceLocale};
 const itinerary=buildItineraryFromDayPlan({planningSessionId:'fixture',destination:city,days:1,items:[item]},{dayDates:['2026-12-15']});
 assert.equal(itinerary[0].englishName,city);assert.equal(itinerary[0].googlePlaceId,raw.id);
 const row={id:'fixture',title:'old title',is_title_customized:false,custom_title:null,payload:{version:2,title:'old title',summary:'',moodTag:'',recommendations:[],itinerary,destinationLocation:s.tripDestination,days:1,tripSettings:{tripStartDate:'2026-12-15'}},created_at:'',updated_at:''};
 const restored=JSON.parse(JSON.stringify(row));const core=toCoreTrip(restored);
 for(const locale of ['en','ja','ko','zh-TW']) {
  assert.ok(itineraryDestinationDisplay(city,locale,loc));
  assert.ok(resolveCoreTripTitle(core,locale).includes(city));
  assert.ok(workspaceTitleDisplay({title:'old',titleCustom:false,planningSession:s,tripDays:1},'old',locale).includes(city));
  assert.equal(tripTitleDisplay({title:'Custom',custom:true,destination:city,destinationLocation:loc,days:1},locale),'Custom');
 }
 assert.equal(JSON.stringify(s),before);assert.equal(restored.payload.destinationLocation.lat,loc.lat);
 assert.equal(verifiedDestinationDisplay({...loc,placeId:'another'}),undefined);
 assert.equal(attachDestinationDisplay(loc,{...candidate,country:'different'}),loc);
 assert.equal(attachDestinationDisplay(loc,{...candidate,type:'region'}),loc);
 const noLanguage=rawToTripLocation({...raw,displayName:{text:city}},raw.id);assert.equal(noLanguage.destinationDisplay,undefined);
 console.log('MOCK PASS',country,city,'resolver calls',calls,'no complete translation fixture');
}
for(const country of ['葡萄牙','冰島']) {
 clearCountryCityOptionsCache();const options=buildCountryCityOptions({country,language:'en'}).options;
 const metadata=buildDestinationOptionsFromCityList(options,country);
 for(let i=0;i<options.length;i++)assert.deepEqual(metadata[i].destinationDisplay.localizationIdentity,options[i].localizationIdentity);
 console.log('REAL DATA PASS editorial metadata',country,options.map(o=>resolveCandidateDisplay(o,'en').name));
}
console.log('PASS end-to-end metadata projections, current locale, JSON restore, unchanged geography, custom titles, missing-language fallback, no network');
// Existing real country reply stores the same reviewed references before selection.
const {processAdviceTurn}=await import('../src/lib/ai/chat-state-machine.ts');
let real=mergeTravelContext(createEmptySession(),"I'm going to Portugal in December.");
const reply=processAdviceTurn("I'm going to Portugal in December.",real.session,real.context,undefined,'en');
const selected=mergeTravelContext(reply.session,'Porto');
assert.equal(selected.context.destinationDisplay?.localizationIdentity?.bindingId,'editorial-pt-city-002');
assert.equal(selected.context.travelMonth,'12月');
const changed=mergeTravelContext(selected.session,'Change destination to Queenstown');
assert.equal(changed.context.destinationDisplay,undefined);
// Place card renders from persisted metadata, without modifying its canonical title.
const {createElement}=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const {I18nProvider}=await import('../src/hooks/use-i18n.tsx');
const {TripPlaceCard}=await import('../src/components/saved/TripPlaceCard.tsx');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'en'}});
const stop={date:'2026-12-15',time:'09:00',title:'原標題',placeName:'原地名',description:'',googlePlaceId:'ChIJCardFixture',lat:1,lng:2,englishName:'Trusted English Place',localizedNames:{en:'Trusted English Place'},localizedDisplayName:'原地名'};
const beforeStop=JSON.stringify(stop),noop=()=>{};
const html=renderToStaticMarkup(createElement(I18nProvider,null,createElement(TripPlaceCard,{item:stop,indexInDay:0,dayCount:1,settings:{},onSetArrivalTime:noop,onSetDurationMinutes:noop,onMoveUp:noop,onMoveDown:noop,onDelete:noop})));
assert.ok(html.includes('Trusted English Place'));assert.equal(JSON.stringify(stop),beforeStop);
console.log('PASS real country selection reference, destination switch isolation, SSR persisted place card');
