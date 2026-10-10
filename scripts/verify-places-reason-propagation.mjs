import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePlacesSearchResult} from '../src/lib/places-search-normalize.ts';
import {fixedPlacesFailureReason} from '../src/lib/places-failure-reason.ts';
import {createDiscoverySearchScope} from '../src/lib/ai/discovery-search-scope.ts';
import {createCombinationDiscoveryTrace} from '../src/lib/ai/combination-discovery-trace.ts';
import {authorizeGoogleBilling} from '../src/lib/abuse-guard.server.ts';
import {createUnifiedSearchPlacesFn} from '../src/lib/places-search-unified.ts';
import {notePlacesRateLimited, resetPlacesProviderLimiterForTests} from '../src/lib/places-api-guard.ts';
const codes=['ip_rate_limited','user_rate_limited','guest_rate_limited','cooldown_skipped','stale_generation','deadline_exceeded','provider_rate_limited','provider_error','global_budget_limited'];
const original=console.info, logs=[];console.info=(...args)=>logs.push(args);
try {
 for(const code of codes) {
  // Real normalization used by both native and server search wrappers.
  const normalized=normalizePlacesSearchResult({places:[],error:'rate_limited',reason:code,secret:'SECRET',query:'PRIVATE'});
  assert.equal(normalized.reason,code);
  const trace=createCombinationDiscoveryTrace();
  const scope=createDiscoverySearchScope(()=>trace.request(async()=>normalized),{deadlineAt:45000,now:()=>0});
  await assert.rejects(scope.search({data:{query:'PRIVATE'}}));
  trace.work(scope.stats);trace.finish(false);
  assert.equal(JSON.parse(logs.at(-3)[1]).failFastReason,code);
  assert.equal(JSON.parse(logs.at(-1)[1]).failureReason,code);
  // Without scope.work, the direct trace path must preserve the same reason too.
  const direct=createCombinationDiscoveryTrace();await direct.request(async()=>normalized);direct.finish(false);
  assert.equal(JSON.parse(logs.at(-1)[1]).failureReason,code);
  assert.equal(JSON.parse(logs.at(-3)[1]).failFastReason,code);
 }
 // Exercise the real wrapper's already-limited branch: no fallback/provider call.
 const originalFetch=globalThis.fetch;let providerCalls=0;
 globalThis.fetch=async()=>{providerCalls++;throw Error('unexpected provider');};
 try {
  for (const code of codes) {
   resetPlacesProviderLimiterForTests();
   const search=createUnifiedSearchPlacesFn(async()=>{
    notePlacesRateLimited({retryAfterMs:60000});
    return {places:[],error:'rate_limited',reason:code};
   });
   const result=await search({data:{query:code,lat:1,lng:2,radius:1000,mode:'text',placesScreen:'chat'}});
   assert.equal(result.error,code);
  }
  assert.equal(providerCalls,0);
 } finally {globalThis.fetch=originalFetch;resetPlacesProviderLimiterForTests();}
 // Google DO billing denial is a real source of the formerly generic response.
 for(const [bucket,reason] of [['user','user_rate_limited'],['ip','ip_rate_limited'],['global','global_budget_limited']]) {
  const env={ABUSE_GUARD:{idFromName:n=>n,get:name=>({fetch:async request=>{
   const command=await request.json(); const denied=command.action==='charge'&&name.startsWith(bucket+':');
   return Response.json({ok:!denied,replay:false,retryAt:denied?Date.now()+60000:0,reason:denied?command.buckets[0].reason:command.action==='release'?'released':'allowed'});
  }})}};
  const response=await authorizeGoogleBilling({env,family:'places_text',operationId:'fixture',userId:'fixture',ip:'203.0.113.1',chargeUser:true,chargeIp:true,includeGlobalBudget:true});
  assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>0);
  assert.deepEqual(await response.json(),{error:'rate_limited',reason});
 }
 assert.equal(fixedPlacesFailureReason({reason:'SECRET',error:'rate_limited'}),undefined);
 assert.equal(fixedPlacesFailureReason({error:'places_http_429:RESOURCE_EXHAUSTED'}),'provider_rate_limited');
 assert.doesNotMatch(JSON.stringify(logs),/SECRET|PRIVATE|203\.0\.113|https?:/);
 // Prevent the wrapper's cooldown branch from overwriting a classified failure again.
 assert.match(readFileSync('src/lib/places-search-unified.ts','utf8'),/fixedPlacesFailureReason\(serverResult\) \?\? "cooldown_skipped"/);
} finally {console.info=original;}
console.log('PASS structured reason -> normalization -> scope -> trace; direct trace; user/IP/global billing denial; redaction; cooldown preservation.');
