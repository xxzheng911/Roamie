import assert from 'node:assert/strict';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {resolveChatIntentArbitration as arbitrate} from '../src/lib/ai/recommendation-refinement/arbitrate.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {resolveGlobalPlanningCandidate as resolveGlobalPlanningCandidateActual} from '../src/lib/ai/global-planning-context.ts';
import {normalizeDestinationLabel} from '../src/lib/ai/trip-planning-context.ts';
import {planningCalendarSignals} from '../src/lib/ai/planning-calendar-signals.ts';
import {parseDayCountFromText} from '../src/lib/parse-chinese-duration.ts';
const intents=['Planning a holiday in Portugal next spring.','Thinking of visiting Iceland for a week.',"I'd love to explore Hokkaido this winter.",'明年春天想去葡萄牙旅行。','想安排一週冰島自由行。','来年の春にポルトガルへ旅行したいです。','冬に北海道を旅行する予定です。','내년 봄에 포르투갈 여행을 계획하고 있어요.','겨울에 홋카이도로 여행 가고 싶어요.'];
for(const t of intents) assert.equal(arbitrate(t,createEmptySession()).route,'NEW_TRIP_PLANNING',t);
for(const t of ['Find coffee shops near me.','台北車站附近有什麼咖啡廳？','東京駅の近くでカフェを探して。','서울역 근처 카페 추천해 줘.']) assert.equal(arbitrate(t,createEmptySession()).route,'NEW_RECOMMENDATION',t);
for(const t of ['Hello','What is Portugal?','Weather in Tokyo?','今天心情很好']) assert.notEqual(arbitrate(t,createEmptySession()).route,'NEW_TRIP_PLANNING',t);
const pairs=[['Portugal','Porto','PT'],['Iceland','Reykjavik','IS'],['Vietnam','Da Nang','VN'],['Japan','Sapporo','JP'],['New Zealand','Queenstown','NZ'],['Morocco','Marrakech','MA'],['Argentina','Mendoza','AR'],['Canada','Banff','CA'],['Mongolia','Ulaanbaatar','MN'],['Kenya','Nairobi','KE']];
let calls=0;
const fixture=(city,country)=>({placeId:'fixture-'+city,country,city,region:city,lat:1,lng:2,formattedName:city,displayLabel:city});
for(const [country,city,iso] of pairs){
 let s=createEmptySession();
 for(const text of [`I'm going to ${country} in December.`,city,'4 days']){
  s=mergeTravelContext(s,text).session;
  s=await resolveGlobalPlanningCandidate(s,'en',async()=>{calls++;return fixture(city,iso)});
  const r=processAdviceTurn(text,s,s.travelContext,undefined,'en');s={...r.session,pendingQuestion:r.route?.pendingQuestion};
  s=JSON.parse(JSON.stringify(s));
 }
 assert.equal(normalizeDestinationLabel(s.travelContext.destination),normalizeDestinationLabel(city),city);
 assert.equal(s.travelContext.travelMonth,'12月',city);
 assert.equal(s.travelContext.days,4,city);
 assert.equal(s.tripDestination.placeId,'fixture-'+city);
 assert.equal(s.tripDestination.country,iso);
 assert.equal(s.travelContext.startDate,undefined);
 console.log('PASS global fixture',country,city);
}
assert.equal(calls,10,'one resolver per city, no per-render/date calls');
for(const [t,n] of [['3 days',3],['10 days',10],['two weeks',14],['三天兩夜',3],['4日間',4],['2週間',14],['3박 4일',4]]) assert.equal(parseDayCountFromText(t),n,t);
for(const [t,m] of [['December','12月'],['February','2月'],['next March','3月'],['12月','12月'],['明年3月','3月'],['12월','12月']]) assert.equal(planningCalendarSignals(t).travelMonth,m,t);
assert.equal(planningCalendarSignals('next March',new Date('2026-12-31T15:30:00Z'),'Asia/Tokyo').travelYear,2028);
assert.equal(planningCalendarSignals('next summer').travelSeason,'summer');
let s=mergeTravelContext(createEmptySession(),"I'm going to Japan in December.").session;
s=mergeTravelContext(s,'February').session;assert.equal(s.travelContext.travelMonth,'2月');
s=mergeTravelContext(s,'明年3月').session;assert.equal(s.travelContext.destination,'日本');assert.equal(s.travelContext.travelMonth,'3月');
for(const t of ['Tokyo + Osaka','Bangkok + Chiang Mai','Paris + London','Seoul + Busan','Lisbon + Porto']){
 const m=mergeTravelContext(createEmptySession(),t);assert.equal(m.context.destinationInputNames.length,2);assert.equal(m.context.destinationClarification,'multiple_destinations');
 const r=processAdviceTurn(t,m.session,m.context,undefined,'en');assert.match(r.advice.reply,/choose one/);assert.ok(!r.advice.triggerItineraryGeneration);
}
let pending=mergeTravelContext(createEmptySession(),"I'm going to Uncharted Valley in December.").session;
assert.equal(pending.travelContext.destination,undefined);
let failed=await resolveGlobalPlanningCandidate(pending,'en',async()=>null);
assert.equal(failed.travelContext.destinationCandidate.status,'unresolved');
await resolveGlobalPlanningCandidate(failed,'en',async()=>{throw Error('must not retry')});
assert.match(processAdviceTurn('4 days',failed,failed.travelContext,undefined,'en').advice.reply,/confirm/);
let conflict=mergeTravelContext(mergeTravelContext(createEmptySession(),"I'm going to Portugal in December.").session,'Springfield').session;
conflict=await resolveGlobalPlanningCandidate(conflict,'en',async()=>fixture('Springfield','US'));
assert.equal(conflict.travelContext.destinationCandidate.status,'conflict');assert.equal(conflict.tripDestination,undefined);
console.log('PASS intent, Nearby, global mocked resolver, dates, multi-city clarification, unresolved/conflict, bounded calls. Real providers NOT VERIFIED.');
for(const t of ['I am not planning a trip.','Tell me about Portugal.','What is a holiday?']) assert.notEqual(arbitrate(t,createEmptySession()).route,'NEW_TRIP_PLANNING');
const weeksContext=mergeTravelContext(createEmptySession(),'Thinking of visiting Iceland for a week.').context;
assert.equal(weeksContext.days,7);
let corrected=mergeTravelContext(conflict,'switch to Springfield').session;
corrected=await resolveGlobalPlanningCandidate(corrected,'en',async query=>{assert.equal(query,'Springfield');return fixture('Springfield','US')});
assert.equal(corrected.travelContext.destinationCandidate.status,'resolved');
assert.equal(corrected.travelContext.travelMonth,'12月');
const oldId=corrected.tripDestination.placeId;
for(let i=0;i<20;i++) corrected=JSON.parse(JSON.stringify(corrected));
corrected=await resolveGlobalPlanningCandidate(corrected,'ja',async()=>{throw Error('must reuse')});
assert.equal(corrected.tripDestination.placeId,oldId);
console.log('PASS explicit correction, preserved month, long restore, no locale-triggered resolver, negative intent.');
// Integration: the same production validator handles provider multiplicity and failure recovery.
const responsePending=mergeTravelContext(createEmptySession(),"I'm going to Uncharted Valley in December.").session;
const ambiguous=await resolveGlobalPlanningCandidate(responsePending,'en',async()=>({location:fixture('Valley','US'),rawResultCount:2}));
assert.equal(ambiguous.travelContext.destinationCandidate.status,'unresolved');
assert.equal(ambiguous.tripDestination,undefined);
const timedOut=await resolveGlobalPlanningCandidate(responsePending,'en',()=>new Promise(()=>{}),5);
assert.equal(timedOut.travelContext.destinationCandidate.status,'unresolved');
let retryCalls=0;
const networkFailed=await resolveGlobalPlanningCandidate(responsePending,'en',async()=>{throw Error('network')});
const retried=await resolveGlobalPlanningCandidate(mergeTravelContext(networkFailed,'Uncharted Valley').session,'en',async()=>{retryCalls++;return {location:fixture('Valley','US'),rawResultCount:1}});
assert.equal(retried.travelContext.destinationCandidate.status,'resolved');assert.equal(retryCalls,1);
const {isGlobalResolutionCurrent}=await import('../src/lib/ai/global-planning-context.ts');
assert.equal(isGlobalResolutionCurrent(1,2,responsePending,responsePending),false);
assert.equal(isGlobalResolutionCurrent(1,1,responsePending,createEmptySession()),false);
assert.equal(isGlobalResolutionCurrent(1,1,responsePending,responsePending),true);
const comboSession={...retried,pendingQuestion:{type:'combination_choice',options:['first','second']},travelContext:{...retried.travelContext,days:4}};
const {globalPlanningTurn}=await import('../src/lib/ai/global-planning-context.ts');
assert.equal(globalPlanningTurn(comboSession,'2'),undefined,'combination index must stay with existing selection handler');
console.log('PASS integration: shared multiplicity validation, timeout, explicit network retry, stale/session ownership, combination index isolation.');

// Fixtures use the same provider envelope and validation boundary as the production callback.
async function resolveGlobalPlanningCandidate(session, locale, resolve, timeoutMs) {
 return resolveGlobalPlanningCandidateActual(session, locale, async query => {
  const result = await resolve(query);
  return result && 'placeId' in result ? {location:result,rawResultCount:1} : result;
 }, timeoutMs);
}
