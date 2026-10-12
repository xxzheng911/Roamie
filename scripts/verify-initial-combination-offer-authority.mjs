import assert from 'node:assert/strict';
import {clearCandidatePoolCache} from '../src/lib/ai/places-cost-cache/candidate-pool-cache.ts';
import {ensureDestinationCombinationsReady,clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {bindSelectionOwner,rejectNumericSelection} from '../src/lib/ai/numeric-selection-authority.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};

// Initial offer authority: a duration reply that leaves a stale region_choice
// selection must still carry the helper's offeredCombinations with the menu.
const names=['清水寺','伏見稲荷大社','金閣寺','銀閣寺','二条城','八坂神社','京都国立博物館','京都市京セラ美術館','京都鉄道博物館','京都国際マンガミュージアム','細見美術館','京都文化博物館','円山公園','京都御苑','京都府立植物園','嵐山公園','梅小路公園','岡崎公園','錦市場','先斗町','祇園','三年坂','花見小路','哲学の道'];
const type=i=>i<6||i>=18?'tourist_attraction':i<12?'museum':'park';
const pool=names.map((name,i)=>({id:`ChIJKyotoOfferFixture${i}`,name,lat:35+i*.0003,lng:135.76,types:[type(i)],primaryType:type(i),rating:4.6,userRatingCount:10000,address:'京都府京都市',businessStatus:'OPERATIONAL'}));
const scope={label:'京都',city:'京都',country:'JP',countryCode:'JP',type:'city',latitude:35.01,longitude:135.76,placeId:'ChIJKyotoOfferFixtureCity',source:'trip_destination',scopeLocked:false};
const traces=[];const log=console.log;
for(const k of ['log','info','warn'])console[k]=(...a)=>{if(a[0]==='[COMBINATION_ADVICE_RETURN_TRACE]')traces.push(a[1]);};
const out=(...a)=>log(...a);

const L='ja';
function turn(text,session){const merged=mergeTravelContext(session,text);const r=processAdviceTurn(text,merged.session,merged.context,undefined,L);return {...r,session:{...r.session,pendingQuestion:r.route?.pendingQuestion}};}

clearDiscoveredCombinationsCache();clearCandidatePoolCache();
let calls=0;
let s={...createEmptySession(),workspaceId:'initial-offer-authority',travelContext:{interests:[]}};
s=turn('12月に日本へ旅行に行きたいです。',s).session;
assert.equal(s.pendingQuestion?.type,'region_choice');
s=mergeTravelContext(s,'京都に行きたいです。').session;
s=await resolveGlobalPlanningCandidate(s,L,async()=>({rawResultCount:1,location:{placeId:scope.placeId,country:'JP',city:'京都',region:'京都府',lat:scope.latitude,lng:scope.longitude,formattedName:'京都',displayLabel:'京都'}}));
let r=processAdviceTurn('京都に行きたいです。',s,s.travelContext,undefined,L);
s={...r.session,pendingQuestion:r.route?.pendingQuestion};
assert.equal(s.pendingQuestion?.type,'ask_days');
const res=await ensureDestinationCombinationsReady({destination:'京都',destinationCountry:'JP',resolvedDestination:scope,locale:L,days:4,generationRequestId:'initial-offer-authority',searchPlaces:async()=>{calls++;return {places:pool,error:null};}});
assert.equal(res.ok,true);
const callsBeforeHandoff=calls;

traces.length=0;
r=turn('4日間です。',s);s=r.session;
const shown=(r.advice.reply?.match(/^\d+\./gm)??[]).length;
const offers=r.advice.contextPatch?.offeredCombinations;
out('initial turn',JSON.stringify({branch:traces[0]?.branchCode,pending:s.pendingQuestion?.type,shown,adviceOffers:offers?.length??null,sessionOffers:s.travelContext.offeredCombinations?.length??null}));
assert.equal(s.pendingQuestion?.type,'combination_choice');
assert.ok(shown>=2,'menu rendered');
assert.equal(offers?.length,shown,'advice contextPatch carries every rendered offer');
assert.equal(s.travelContext.offeredCombinations?.length,shown,'session persists every rendered offer');
assert.equal(s.travelContext.tripPurpose,'combination_suggestions_offered');
assert.equal(s.travelContext.days,4);
assert.equal(s.travelContext.destination,'京都');
assert.notEqual(traces[0]?.branchCode,'other_advice_return','initial branch is precisely observed');
assert.equal(traces[0]?.nextContextPatchOfferedCount,shown);

// Workspace persistence binds the menu owner over the persisted offers (sync.ts).
const restored=JSON.parse(JSON.stringify(bindSelectionOwner(s)));
for(const text of ['1','2']){
  assert.equal(rejectNumericSelection(restored,text),false,`numeric guard admits ${text}`);
  const chosen=turn(text,restored);
  assert.equal(chosen.advice.triggerItineraryGeneration,true,`choice ${text} generates`);
  assert.deepEqual(chosen.advice.contextPatch.selectedCombinationIds,[offers[Number(text)-1].id]);
  assert.equal(chosen.session.travelContext.days,4);
}
assert.equal(rejectNumericSelection(restored,'99'),true,'out-of-range stays rejected');
// The guard stays strict: the pre-fix shape (menu without offers) is still refused.
assert.equal(rejectNumericSelection(bindSelectionOwner({...s,pendingQuestion:{...s.pendingQuestion,selectionOwner:undefined},travelContext:{...s.travelContext,offeredCombinations:[]}}),'1'),true,'offer_missing still rejected');
assert.equal(calls,callsBeforeHandoff,'handoff/choice path dispatches no provider work');
out('PASS initial combination offer authority: duration → offers → session → restore → choice 1/2, invalid 99 rejected');
