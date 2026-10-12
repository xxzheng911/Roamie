import assert from 'node:assert/strict';
import {createCombinationDiscoveryTrace,discoveryFailure} from '../src/lib/ai/combination-discovery-trace.ts';
const logs=[];const original=console.info;console.info=(prefix,json)=>logs.push({prefix,...JSON.parse(json)});
try {
 for(const reason of ['destination_unresolved','destination_state_mismatch','cooldown_blocked','deadline_exceeded','insufficient_candidates','insufficient_combinations']) {
  const t=createCombinationDiscoveryTrace('12345678');t.started(true,false);t.guard(false,reason,false,0);t.finish(false,reason);assert.equal(logs.at(-1).failureReason,reason);
 }
 const ok=createCombinationDiscoveryTrace('12345678');ok.started(true,false);let calls=0;const response={places:[{name:'SECRET'}]};assert.equal(await ok.request(async()=>{calls++;return response}),response);ok.candidates(3,2,2);ok.finish(true,undefined,3);ok.finish(false,'unknown');assert.equal(calls,1);assert.equal(logs.at(-1).success,true);assert.equal(logs.at(-3).succeeded,1);
 const cached=createCombinationDiscoveryTrace();cached.started(true,true);cached.finish(true,undefined,3);assert.equal(logs.at(-3).attempted,0);
 for(const [error,code] of [[{error:'places_rate_limited SECRET'},'rate_limited'],[{error:'timeout SECRET'},'deadline_exceeded'],[{error:'failed SECRET'},'provider_error']]) {
  const t=createCombinationDiscoveryTrace();assert.equal(await t.request(async()=>error),error);t.finish(false,'unknown');assert.equal(logs.at(-1).failureReason,code);
 }
 const t=createCombinationDiscoveryTrace('SECRET');const error=Object.assign(new Error('SECRET'),{status:429});await assert.rejects(t.request(async()=>{throw error}),e=>e===error);t.guard(true,'SECRET',false,NaN);t.finish(false,'SECRET');assert.equal(logs.at(-1).failureReason,'rate_limited');assert.equal(logs.at(-3).rateLimited,1);assert.ok(!JSON.stringify(logs).includes('SECRET'));
 console.info=()=>{throw Error('logger')};assert.doesNotThrow(()=>createCombinationDiscoveryTrace().finish(false,'unknown'));
} finally {console.info=original;}
console.log('PASS discovery/cache/guards/429/timeout/insufficiency/mismatch/redaction, same result/error, no extra requests, final emitted once.');

assert.equal(discoveryFailure('combination_candidates_insufficient'),'insufficient_combinations');
assert.equal(discoveryFailure('place_discovery_failed'),'provider_error');

// Provider failures are not successful empty results; retain distinct diagnostic outcomes.
assert.equal(discoveryFailure("empty_candidates"), "empty_candidates");
assert.equal(discoveryFailure("filtered_candidates"), "filtered_candidates");
assert.equal(discoveryFailure("blocked_country"), "blocked_country");
