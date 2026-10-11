import {resolveGlobalPlanningCandidate as resolveGlobalPlanningCandidateActual} from '../src/lib/ai/global-planning-context.ts';
import assert from 'node:assert/strict';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {resolveChatIntentArbitration} from '../src/lib/ai/recommendation-refinement/arbitrate.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {applyChatCreateAuthority} from '../src/lib/ai/chat-create-authority.ts';
import {shouldPersistGeneratedPlan} from '../src/lib/ai/generated-plan-handoff.ts';
import {isTravelPlanningText} from '../src/lib/ai/chat-intent-router.ts';
import {displayDestinationForCopy} from '../src/lib/ai/destination-locale-aliases.ts';
for(const [locale,turns] of Object.entries({en:["I'm going to Thailand in December.",'Bangkok','4'],'zh-TW':['我十二月要去泰國玩。','曼谷','4天'],ja:['12月にタイへ旅行します。','バンコク','4日間'],ko:['12월에 태국으로 여행 갈 거예요.','방콕','4일']})){
 let session=createEmptySession();
 const arbitration=resolveChatIntentArbitration(turns[0],session);
 assert.equal(arbitration.route,'NEW_TRIP_PLANNING',locale);
 assert.equal(isTravelPlanningText(turns[0]),true);
 session=applyChatCreateAuthority(session,arbitration);
 const authority=session.tripCreationAuthority;
 assert.ok(authority);
 assert.equal(shouldPersistGeneratedPlan({authority,generationId:authority.generationId}),true);
 for(const text of turns){
  const merged=mergeTravelContext(session,text);session=merged.session;
  session=await resolveGlobalPlanningCandidate(session,locale,async()=>({placeId:'fixture-bangkok',city:'曼谷',country:'泰國',lat:13.7,lng:100.5,formattedName:'Bangkok',displayLabel:'Bangkok'}));
  merged.context=session.travelContext;
  const result=processAdviceTurn(text,session,merged.context,undefined,locale);session={...result.session,pendingQuestion:result.route?.pendingQuestion};
  const reply=result.advice.reply;
  assert.ok(reply,locale+' response');
  if(locale==='en') assert.doesNotMatch(reply,/[\u3400-\u9fff\uac00-\ud7a3\u3041-\u3096\u30a1-\u30fa]/);
  if(locale==='ja') {assert.match(reply,/[\u3041-\u3096\u30a1-\u30fa]/);assert.doesNotMatch(reply,/目前|請稍後|曼谷|泰國/);}
  if(locale==='ko') {assert.match(reply,/[\uac00-\ud7a3]/);assert.doesNotMatch(reply,/目前|請稍後|曼谷|泰國/);}
  if(locale==='zh-TW') assert.match(reply,/[\u3400-\u9fff]/);
  session=JSON.parse(JSON.stringify(session)); // Restore the same serializable session between turns.
 }
 assert.equal(session.travelContext?.travelMonth,'12月',locale);
 assert.equal(session.travelContext?.days,4,locale);
 assert.equal(session.travelContext?.destination,'曼谷',locale);
 assert.equal(session.travelContext?.destinationCountry,'泰國',locale);
 assert.equal(session.travelContext?.startDate,undefined,locale);
}
assert.equal(displayDestinationForCopy('曼谷','4','en'),'Bangkok');
assert.equal(resolveChatIntentArbitration('Find coffee shops near me.',createEmptySession()).route,'NEW_RECOMMENDATION');
console.log('PASS: four-language actual arbitration, session serialize/restore, month/country/city/duration, localized advice, existing create handoff, nearby isolation. No provider/AI calls.');
// General language signals: no special case for Thailand or December.
for (const [text,month] of [["We're travelling to Japan in March.",'3月'],['5月にフランスへ旅行します。','5月'],['8월에 일본으로 여행 갈 거예요.','8月']]) {
 const session=createEmptySession();
 assert.equal(resolveChatIntentArbitration(text,session).route,'NEW_TRIP_PLANNING');
 const merged=mergeTravelContext(session,text);
 assert.equal(merged.context.travelMonth,month);
 assert.ok(merged.context.destinationCountry);
 assert.equal(merged.context.startDate,undefined);
}
console.log('PASS additional countries/months; no exact-date fabrication.');

// Fixtures use the same provider envelope and validation boundary as the production callback.
async function resolveGlobalPlanningCandidate(session, locale, resolve, timeoutMs) {
 return resolveGlobalPlanningCandidateActual(session, locale, async query => {
  const result = await resolve(query);
  return result && 'placeId' in result ? {location:result,rawResultCount:1} : result;
 }, timeoutMs);
}
