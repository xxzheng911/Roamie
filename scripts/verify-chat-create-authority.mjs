import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEmptySession } from '../src/lib/chat-session.ts';
import { resolveChatIntentArbitration } from '../src/lib/ai/recommendation-refinement/arbitrate.ts';
import { applyChatCreateAuthority } from '../src/lib/ai/chat-create-authority.ts';
import { applyStyleReselectToSession } from '../src/lib/ai/chat-planning-state.ts';
import { shouldPersistGeneratedPlan, createGeneratedPlanHandoff } from '../src/lib/ai/generated-plan-handoff.ts';
const base={...createEmptySession(),tripActionDiagnostic:{actionSource:'unknown',actionToken:'8a8b229d'}};
for(const text of ['我12月要去大阪2天','幫我規劃東京5天']) {
 const route=resolveChatIntentArbitration(text,base);assert.equal(route.route,'NEW_TRIP_PLANNING');
 const next=applyChatCreateAuthority(base,route);assert.equal(next.tripActionDiagnostic.actionSource,'chat_generate_trip');assert.equal(next.tripActionDiagnostic.actionToken,'8a8b229d');assert.equal(next.tripCreationAuthority.explicitCreate,true);
 const again=applyChatCreateAuthority(next,route);assert.equal(again.tripCreationAuthority.generationId,next.tripCreationAuthority.generationId);
 const styled=applyStyleReselectToSession(next,{interests:[],destination:'fixture',days:2},'mixed');assert.deepEqual(styled.tripCreationAuthority,next.tripCreationAuthority);assert.deepEqual(styled.tripActionDiagnostic,next.tripActionDiagnostic);
 assert.equal(shouldPersistGeneratedPlan({authority:styled.tripCreationAuthority,generationId:styled.tripCreationAuthority.generationId,styleReselect:true}),true);
}
for(const text of ['推薦東京景點','再推薦幾個','換個風格','附近咖啡廳']) {
 const route=resolveChatIntentArbitration(text,base);assert.notEqual(route.route,'NEW_TRIP_PLANNING');assert.equal(applyChatCreateAuthority(base,route),base);assert.equal(base.tripCreationAuthority,undefined);
}
const source=fs.readFileSync('src/routes/_app.chat.tsx','utf8');const send=source.slice(source.indexOf('const send = async'));
assert.ok(send.indexOf('applyChatCreateAuthority(nextSession, createArbitration,')<send.indexOf('const styleReselect ='));
assert.ok(send.includes('resolveChatIntentArbitration(trimmed, nextSession)'));
console.log('PASS actual arbitration Osaka/Tokyo, same action token and generation upgrade, recommendation isolation, style retention, handoff persist=true, pre-dispatch wiring.');

assert.equal(applyChatCreateAuthority(base,{route:'NEW_TRIP_PLANNING',reason:'explicit_new_trip_planning'},true),base);
const created=applyChatCreateAuthority(base,{route:'NEW_TRIP_PLANNING',reason:'explicit_new_trip_planning'});
const persist=createGeneratedPlanHandoff();let saves=0;
await Promise.all([persist(created.tripCreationAuthority.generationId,async()=>{saves++}),persist(created.tripCreationAuthority.generationId,async()=>{saves++})]);
assert.equal(saves,1);
console.log('PASS explicit preview exclusion and same-generation single persistence.');
