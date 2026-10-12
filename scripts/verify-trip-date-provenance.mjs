import {beginTripCreation} from '../src/lib/ai/generated-plan-handoff.ts';
import {matchesDateGenerationAction,traceDateGenerationContinuation} from '../src/lib/ai/date-generation-continuation.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createEmptySession,saveChatSession,loadChatSession} from '../src/lib/chat-session.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {resolveSuggestedTripDates} from '../src/lib/ai/resolve-suggested-trip-dates.ts';
import {resolveTripCreateDates} from '../src/lib/ai/resolve-trip-create-dates.ts';
import {prepareTripDateConfirmation,isRepeatedTripDateConfirmation,isCurrentTripDateSnapshot,consumeTripDateConfirmation,tripDateConfirmationCopy} from '../src/lib/ai/trip-date-confirmation.ts';
import {enrichTripDatesInContext} from '../src/lib/ai/ai-trip-style.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const base={...createEmptySession(),workspaceId:'date-fixture',conversationId:'date-conversation',planningSessionId:'date-plan',tripDays:4,
 travelContext:{interests:['museums'],destination:'Porto',destinationCountry:'Portugal',travelMonth:'12月',days:4,selectedCombinationIds:['selected-second']},
 selectedPlaces:[{name:'fixture',placeId:'ChIJDateFixture',lat:41,lng:-8}]};
const resolve=s=>resolveTripCreateDates({context:s.travelContext,session:s,days:s.tripDays??4});
const month=resolve(base);assert.equal(month.source,'month_default');assert.equal(month.hasExplicitDates,false);assert.equal(month.datesConfirmed,false);
const proposed={source:month.source,confirmed:false,startDate:month.startDate,endDate:month.endDate};
const written={...base,travelContext:{...base.travelContext,startDate:month.startDate,endDate:month.endDate,suggestedStartDate:month.startDate,dateProvenance:proposed}};
assert.equal(resolve(written).source,'month_default');
assert.equal(resolve({...written,travelContext:{...written.travelContext,dateProvenance:undefined}}).source,'unknown');
const explicitPatch=enrichTripDatesInContext('2026/12/20',written.travelContext,written);
assert.equal(explicitPatch.dateProvenance.source,'user_date');assert.equal(explicitPatch.dateProvenance.confirmed,true);
assert.equal(explicitPatch.startDate,'2026-12-20');assert.equal(explicitPatch.endDate,'2026-12-23');
const explicit={...written,travelContext:{...written.travelContext,...explicitPatch}};
assert.equal(prepareTripDateConfirmation(explicit,{entry:'direct'}),null);
const pending=prepareTripDateConfirmation(written,{entry:'direct'});
assert.equal(pending.pendingQuestion.type,'date_confirmation');
for(const [locale,accept] of [['en','use suggested dates'],['zh-TW','使用建議日期'],['ja','提案された日程を使う'],['ko','추천 날짜 사용']]) {
 const restored=JSON.parse(JSON.stringify(pending));
 const prompt=tripDateConfirmationCopy(restored,locale);assert.ok(prompt.includes(month.startDate));assert.ok(!prompt.includes('nativeQa.'));
 const accepted=consumeTripDateConfirmation(restored,accept);assert.equal(accepted.status,'confirmed');
 assert.equal(resolve(accepted.session).source,'month_default');assert.equal(resolve(accepted.session).hasExplicitDates,false);assert.equal(resolve(accepted.session).datesConfirmed,true);
 assert.equal(prepareTripDateConfirmation(accepted.session,{entry:'direct'}),null);
 assert.deepEqual(accepted.session.selectedPlaces,base.selectedPlaces);assert.deepEqual(accepted.session.travelContext.selectedCombinationIds,base.travelContext.selectedCombinationIds);
 assert.equal(accepted.session.travelContext.travelMonth,'12月');assert.equal(accepted.session.workspaceId,base.workspaceId);
 assert.equal(consumeTripDateConfirmation(accepted.session,accept).status,'stale');
 assert.equal(isRepeatedTripDateConfirmation(accepted.session,accept),true);
 assert.equal(isRepeatedTripDateConfirmation({...accepted.session,conversationId:'other'},accept),false);
}
assert.equal(consumeTripDateConfirmation(pending,'2').status,'pending');
assert.equal(consumeTripDateConfirmation(pending,'no').status,'pending');
assert.deepEqual(consumeTripDateConfirmation(pending,'cancel').session.selectedPlaces,base.selectedPlaces);
assert.equal(consumeTripDateConfirmation({...pending,workspaceId:'other'},'use suggested dates').status,'stale');
const modified=consumeTripDateConfirmation(pending,'2026/12/30');assert.equal(modified.status,'confirmed');assert.equal(resolve(modified.session).endDate,'2027-01-02');assert.equal(resolve(modified.session).hasExplicitDates,true);
assert.equal(isCurrentTripDateSnapshot(pending,modified.session),false);
assert.equal(isCurrentTripDateSnapshot(modified.session,modified.session),true);
const oldTZ=process.env.TZ;
for(const tz of ['Asia/Tokyo','America/New_York','Pacific/Auckland']) {process.env.TZ=tz;assert.equal(resolve(modified.session).endDate,'2027-01-02');}
if(oldTZ===undefined) delete process.env.TZ; else process.env.TZ=oldTZ;
// Execute the actual Chat pending branch, not an imitation of its continuation dispatch.
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
const start=chat.indexOf('    if (session.pendingQuestion?.type === "date_confirmation") {',chat.indexOf('  const send = async'));
const end=chat.indexOf('    // Entry snapshot:',start);assert.ok(start>0&&end>start);
const js=ts.transpile(chat.slice(start,end),{target:ts.ScriptTarget.ES2022});
const run=new (Object.getPrototypeOf(async function(){}).constructor)('d',`with(d){${js}}`);
for(const entry of ['direct','selection','persist','recommendation']) {
 let calls=0, saved, resumed;
 const current=prepareTripDateConfirmation(beginTripCreation(written,'advice_create','fixture-generation'),{entry,generationId:'fixture-generation',userText:'2'});
 const resume=async s=>{calls++;resumed=s;assert.equal(resolve(s).datesConfirmed,true)};
 await run({matchesDateGenerationAction,traceDateGenerationContinuation,session:current,trimmed:'use suggested dates',isCurrentTripDateSnapshot,consumeTripDateConfirmation,tripDateConfirmationCopy,locale:'en',msgsRef:{current:[]},setText:()=>{},setMsgs:()=>{},persistSession:s=>{saved=s;return s},pushDestinationPlaceRecommendationRef:{current:resume},persistGeneratedPlanRef:{current:resume},handleGenerateItinerary:resume,runDirectItineraryRef:{current:resume}});
 assert.equal(calls,1);assert.equal(saved.pendingQuestion,undefined);assert.deepEqual(resumed.selectedPlaces,base.selectedPlaces);
}
// Real session serializer/restore retains provenance and pending continuation.
const storage=new Map();const fake={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
globalThis.window={localStorage:fake,sessionStorage:fake};globalThis.localStorage=fake;globalThis.sessionStorage=fake;
saveChatSession(pending);const restored=loadChatSession();assert.equal(restored.pendingQuestion?.type,'date_confirmation');assert.deepEqual(restored.pendingQuestion.dateConfirmation,pending.pendingQuestion.dateConfirmation);
assert.deepEqual(restored.travelContext.dateProvenance,proposed);
// Every formal entry must gate before its expensive/ownership boundary.
for(const [entry,boundary] of [['  persistGeneratedPlanRef.current = async','    await generatedPlanHandoffRef.current'],['  runDirectItineraryRef.current = async','    activeSession = beginTripCreation'],['  const handleGenerateItinerary = async','    const selectionStartedAt']]) {
 const i=chat.indexOf(entry);const stop=chat.indexOf(boundary,i);assert.ok(chat.slice(i,stop).includes('pauseForTripDates('));
}
const reco=chat.indexOf('if (sessionForPlan.tripCreationAuthority?.explicitCreate && pauseForTripDates');assert.ok(reco>0&&reco<chat.indexOf('const placeCreditsGate = await beginPlaceRecommendationCredits',reco));
assert.ok(chat.includes('tripStartDate: tripDates.datesConfirmed ? startDate : undefined'));
console.log('PASS date provenance, real Chat confirmation continuation, four locales, restore, cross-year, timezone, unknown legacy, all entry guards; no provider calls');

const unknown={...base,travelContext:{interests:[],days:4}};
assert.ok(!tripDateConfirmationCopy(prepareTripDateConfirmation(unknown,{entry:'direct'}),'en').includes('use suggested dates'));
const legacy={...written,travelContext:{...written.travelContext,dateProvenance:undefined}};
const legacyBefore=JSON.stringify(legacy);assert.ok(prepareTripDateConfirmation(legacy,{entry:'direct'}));assert.equal(JSON.stringify(legacy),legacyBefore);
const serialized=[...storage.values()].map(s=>{try{return JSON.parse(s)}catch{return null}}).find(s=>s?.pendingQuestion?.dateConfirmation);
assert.ok(serialized);assert.equal(consumeTripDateConfirmation(serialized,'use suggested dates').status,'confirmed');
import {tripWeatherMode} from '../src/lib/outfit/trip-weather-policy.ts';
const accepted=consumeTripDateConfirmation(pending,'use suggested dates').session;
const confirmed=resolve(accepted);
assert.equal(tripWeatherMode({startDate:confirmed.startDate,endDate:confirmed.endDate,timezone:'Europe/Lisbon'},Date.parse('2026-10-12T12:00:00Z')),'climate');
assert.equal(tripWeatherMode({startDate:confirmed.startDate,endDate:confirmed.endDate,timezone:'Europe/Lisbon'},Date.parse(confirmed.startDate+'T00:00:00Z')),'forecast');
console.log('PASS legacy nonmutation, serialized pending consumption, stale date snapshot, and existing weather policy');

for(const text of ['2026-12-20','2026年12月20日','2026/12/20']) {
 const result=consumeTripDateConfirmation(pending,text);assert.equal(result.status,'confirmed');assert.equal(result.session.tripStartDate,'2026-12-20');
}
for(const text of ['2026/02/31','December','4 days']) assert.equal(consumeTripDateConfirmation(pending,text).status,'pending');
