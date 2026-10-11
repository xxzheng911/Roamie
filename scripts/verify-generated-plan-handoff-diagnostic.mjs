import { applyStyleReselectToSession } from "../src/lib/ai/chat-planning-state.ts";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preparePlanTripSession } from '../src/lib/plan-trip-handoff.ts';
import { beginTripCreation, generatedPlanIdentity, shouldPersistGeneratedPlan } from '../src/lib/ai/generated-plan-handoff.ts';
import { logGeneratedPlanHandoff } from '../src/lib/ai/generated-plan-handoff-diagnostic.ts';
const logs=[];const warn=console.warn;const info=console.info;
console.warn=(...args)=>logs.push(args);console.info=()=>{};
try {
 const session=preparePlanTripSession({destination:{placeId:'ChIJFixture',city:'Fixture',country:'JP',displayLabel:'Fixture',lat:35,lng:139},origin:null,days:2,mood:'',styles:[],startDate:'2026-12-15',endDate:'2026-12-16',departureTime:'',transport:''},{weather:null,location:{lat:35,lng:139},time:'12:00'},undefined,{planAiMode:true});
 assert.equal(session.fromPlanForm,true);assert.equal(session.fromPlanAi,true);
 const authority=session.tripCreationAuthority;
 assert.equal(authority.intentSource,'plan_ai_create');
 assert.equal(shouldPersistGeneratedPlan({authority,generationId:authority.generationId,styleReselect:true}),true);
 const styled=applyStyleReselectToSession(session,{interests:[],destination:'Fixture',days:2,planningTripStyle:'mixed'},'mixed');
 assert.deepEqual(styled.tripCreationAuthority,authority);
 assert.equal(shouldPersistGeneratedPlan({authority:styled.tripCreationAuthority,generationId:generatedPlanIdentity(styled,'unused'),styleReselect:true}),true);
 const restored=JSON.parse(JSON.stringify(styled));
 assert.deepEqual(restored.tripCreationAuthority,authority);
 assert.equal(beginTripCreation(restored,'confirmed_create').tripCreationAuthority.generationId,authority.generationId);
 assert.equal(generatedPlanIdentity({...restored,planVersion:99},'other'),authority.generationId);
 assert.equal(shouldPersistGeneratedPlan({styleReselect:true}),false);
 for(const stage of ['received','decision','ownership','handoff_started','handoff_skipped','handed_to_persistence']) {
  logGeneratedPlanHandoff(stage,{reason:'preview_only',entryType:'advice',shouldPersist:false,prompt:'SECRET',generationId:'SECRET',token:'SECRET',placeId:'SECRET',lat:35});
  assert.ok(!JSON.stringify(logs.at(-1)).includes('SECRET'));
 }
 logGeneratedPlanHandoff('decision',{reason:'SECRET',entryType:'SECRET',shouldPersist:'SECRET'});assert.equal(logs.at(-1)[1],'{}');
 const count=logs.length;logGeneratedPlanHandoff('SECRET');assert.equal(logs.length,count);
 console.warn=()=>{throw Error('logger')};assert.doesNotThrow(()=>logGeneratedPlanHandoff('received'));
 const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
 const renderer=chat.slice(chat.indexOf('const renderDestinationReply ='),chat.indexOf('setStreaming(true);',chat.indexOf('const renderDestinationReply =')));
 assert.ok(renderer.indexOf('shouldPersistGeneratedPlan(')<renderer.indexOf('setMsgs('));
 assert.ok(renderer.indexOf('await persistGeneratedPlanRef.current(')<renderer.indexOf('setMsgs('));
 assert.match(chat,/diagnosticTriggerItineraryGeneration: Boolean\(turn.advice.triggerItineraryGeneration\)/);
 assert.match(fs.readFileSync('src/routes/_app.plan.tsx','utf8'),/await startPlanChat\(true, action, authority\)/);
}finally{console.warn=warn;console.info=info}
console.log('PASS actual Plan AI session flags, explicit build, generation authority survives serialization/style flags, renderer order, diagnostic allowlists/redaction/logger isolation. No network.');
