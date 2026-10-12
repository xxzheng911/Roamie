import assert from 'node:assert/strict';
import {clearCandidatePoolCache} from '../src/lib/ai/places-cost-cache/candidate-pool-cache.ts';
import {ensureDestinationCombinationsReady,clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {bindSelectionOwner,rejectNumericSelection} from '../src/lib/ai/numeric-selection-authority.ts';
import {parseAskDaysFromText} from '../src/lib/ai/destination-pending-question.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const log=console.log;const adviceTraces=[];
for(const k of ['log','info','warn'])console[k]=(...a)=>{if(a[0]==='[COMBINATION_ADVICE_RETURN_TRACE]')adviceTraces.push(a[1]);};

// A. Duration parsing authority: trip days only — never nights or calendar days.
const askDays={type:'ask_days',options:[],baseDestination:'京都'};
for(const [text,days] of [['4日間です。',4],['4日間',4],['4日',4],['4泊5日',5],['四日間',4],['3泊4日です',4],
  ['3泊',undefined],['12月4日',undefined],['十二月四日',undefined],['12月4日から4日間',4],['12月10日から3日間',3],
  ['4天',4],['4 days',4],['4일',4],['4일이에요',4]])
  assert.equal(parseAskDaysFromText(text,askDays),days,`parse ${text}`);
log('PASS duration parsing authority');

// B. Country → city → duration must consume ask_days in every UI language.
const names=['清水寺','伏見稲荷大社','金閣寺','銀閣寺','二条城','八坂神社','京都国立博物館','京都市京セラ美術館','京都鉄道博物館','京都国際マンガミュージアム','細見美術館','京都文化博物館','円山公園','京都御苑','京都府立植物園','嵐山公園','梅小路公園','岡崎公園','錦市場','先斗町','祇園','三年坂','花見小路','哲学の道'];
const type=i=>i<6||i>=18?'tourist_attraction':i<12?'museum':'park';
const pool=names.map((name,i)=>({id:`ChIJDurationFixture${i}`,name,lat:35+i*.0003,lng:135.76,types:[type(i)],primaryType:type(i),rating:4.6,userRatingCount:10000,address:'Kyoto Japan',businessStatus:'OPERATIONAL'}));
const scope={label:'京都',city:'京都',country:'JP',countryCode:'JP',type:'city',latitude:35.01,longitude:135.76,placeId:'ChIJDurationFixtureCity',source:'trip_destination',scopeLocked:false};
const flows={
  'zh-TW':['我12月想去日本旅行','京都','4天'],
  en:["I'm going to Japan in December.",'Kyoto','4 days'],
  ja:['12月に日本へ旅行に行きたいです。','京都に行きたいです。','4日間です。'],
  ko:['12월에 일본 여행 가고 싶어요.','교토','4일이에요'],
};
for(const [L,[country,city,duration]] of Object.entries(flows)){
  const turn=(text,session)=>{const m=mergeTravelContext(session,text);const r=processAdviceTurn(text,m.session,m.context,undefined,L);return {...r,merged:m.session,session:{...r.session,pendingQuestion:r.route?.pendingQuestion}};};
  clearDiscoveredCombinationsCache();clearCandidatePoolCache();let calls=0;
  let s={...createEmptySession(),workspaceId:`duration-${L}`,travelContext:{interests:[]}};
  s=turn(country,s).session;
  s=mergeTravelContext(s,city).session;
  s=await resolveGlobalPlanningCandidate(s,L,async()=>({rawResultCount:1,location:{placeId:scope.placeId,country:'JP',city:'京都',region:'京都府',lat:scope.latitude,lng:scope.longitude,formattedName:'京都',displayLabel:'京都'}}));
  const r2=processAdviceTurn(city,s,s.travelContext,undefined,L);s={...r2.session,pendingQuestion:r2.route?.pendingQuestion};
  assert.equal(s.pendingQuestion?.type,'ask_days',`${L} asks days once`);
  const res=await ensureDestinationCombinationsReady({destination:s.travelContext.destination,destinationCountry:'JP',resolvedDestination:scope,locale:L,days:4,generationRequestId:`duration-${L}`,searchPlaces:async()=>{calls++;return {places:pool,error:null};}});
  assert.equal(res.ok,true,`${L} discovery`);
  const callsBefore=calls;
  adviceTraces.length=0;
  const r3=turn(duration,s);
  const m=r3.merged;
  log(L,JSON.stringify({merged:{pending:m.pendingQuestion?.type??null,selection:m.adviceSelectionThisTurn??null},adviceLastResolved:adviceTraces[0]?.lastResolvedPendingType,branch:adviceTraces[0]?.branchCode,offers:r3.advice.contextPatch?.offeredCombinations?.length??null}));
  // Chat routing keeps ask_days open through merge; the advice handler owns it (pending-duration-discovery.ts).
  assert.equal(m.pendingQuestion?.type,'ask_days',`${L} merge keeps ask_days for the advice handler`);
  // D: a stale previous-turn selection never outranks the open ask_days.
  assert.equal(adviceTraces[0]?.pendingType,'ask_days');
  assert.equal(adviceTraces[0]?.lastResolvedPendingType,'none',`${L} no stale selection authority`);
  assert.notEqual(adviceTraces[0]?.branchCode,'resolved_selection_return',`${L} not the stale selection branch`);
  assert.equal(r3.session.adviceSelectionThisTurn,undefined,`${L} stale selection not carried forward`);
  assert.notEqual(r3.session.lastResolvedPendingQuestion?.type,'region_choice',`${L} stale region_choice dropped`);
  // E/G: destination, offers and menu survive; no re-ask.
  s=r3.session;
  assert.equal(s.travelContext.days,4);
  assert.equal(s.travelContext.destination,'京都');
  assert.equal(s.pendingQuestion?.type,'combination_choice',`${L} shows combinations`);
  const offers=s.travelContext.offeredCombinations;
  assert.ok(offers?.length>=2,`${L} offers persisted`);
  assert.equal((r3.advice.reply.match(/^\d+\./gm)??[]).length,offers.length,`${L} menu == offers`);
  const restored=JSON.parse(JSON.stringify(bindSelectionOwner(s)));
  for(const text of ['1','2']){
    assert.equal(rejectNumericSelection(restored,text),false,`${L} guard admits ${text}`);
    const chosen=turn(text,restored);
    assert.equal(chosen.advice.triggerItineraryGeneration,true,`${L} choice ${text} generates`);
    assert.deepEqual(chosen.advice.contextPatch.selectedCombinationIds,[offers[Number(text)-1].id]);
    assert.equal(chosen.session.travelContext.days,4);
  }
  assert.equal(rejectNumericSelection(restored,'99'),true);
  assert.equal(calls,callsBefore,`${L} no provider work after discovery`);
  log('PASS',L,'country → city → duration → offers → restore → choice 1/2');
}
log('PASS duration pending consumption (zh-TW/en/ja/ko)');
