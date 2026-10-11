import assert from 'node:assert/strict';
import fs from 'node:fs';
import { logGeneratedPlanHandoff, planCorrelationToken } from '../src/lib/ai/generated-plan-handoff-diagnostic.ts';
import { shouldPersistGeneratedPlan } from '../src/lib/ai/generated-plan-handoff.ts';
const id='opaque-generation-fixture';const token=planCorrelationToken(id);
assert.match(token,/^[a-f0-9]{8}$/);assert.equal(token,planCorrelationToken(id));assert.notEqual(token,planCorrelationToken('other-generation'));
const events=[];const warn=console.warn;console.warn=(...v)=>events.push(v);
try {
 const diagnostic={correlationToken:token,entryType:'recommendation',explicitCreate:false,fromPlanAi:false,styleReselect:true};
 for (const [stage,sourceStage,dayPlanCount] of [['planner_start','planner',0],['final_planner_gate','planner',14],['result_received','recommendation_wrapper',14],['result_cleared','recommendation_wrapper',14],['result_returned','recommendation_wrapper',0],['received','chat_callback',0],['frozen_restored','chat_callback',14]]) {
  logGeneratedPlanHandoff(stage,{...diagnostic,sourceStage,dayPlanCount,hasDayPlan:dayPlanCount>0,generationId:id,prompt:'PRIVATE',placeId:'PRIVATE'});
 }
 shouldPersistGeneratedPlan({diagnostic,styleReselect:true});
 assert.ok(events.every(([,json])=>JSON.parse(json).correlationToken===token));
 assert.ok(!JSON.stringify(events).includes(id));assert.ok(!JSON.stringify(events).includes('PRIVATE'));
 logGeneratedPlanHandoff('received',{correlationToken:'PRIVATE',dayPlanCount:NaN,sourceStage:'PRIVATE'});assert.equal(events.at(-1)[1],'{}');
 const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
 assert.match(chat,/buildDestinationMustVisitRecommendation\(\{[\s\S]*?diagnostic: handoffCorrelation/);
 const wrapper=fs.readFileSync('src/lib/ai/destination-place-recommendation.ts','utf8');
 assert.match(wrapper,/generateTripPlanFromStyle\(\{\s*diagnostic: params.diagnostic/);
 assert.match(wrapper,/result_cleared[^\n]+reason: "validator_failed"/);
 assert.match(wrapper,/result_cleared[^\n]+"insufficient_candidates"/);
 const planner=fs.readFileSync('src/lib/ai/destination-trip-planning.ts','utf8');
 assert.match(planner,/logTripLifecycle\("final_planner_gate", \{ correlationToken: input.diagnostic\?\.correlationToken/);
 assert.match(chat,/handoff_started[^\n]+planCorrelationToken\(generationId\)/);
} finally {console.warn=warn}
console.log('PASS stable opaque token, different generations, 14→0→frozen14 diagnostic trace, token propagation, allowlists/redaction. Synthetic trace only; no runtime claim or provider call.');
