import assert from 'node:assert/strict';
import {runPlacesApiDeduped,beginPlacesGenerationSession} from '../src/lib/places-api-guard.ts';
import {consumeGoogleBurst,consumeGuestGoogleBurst} from '../src/lib/google-burst.server.ts';
import {runWithWorkerRequest,runWithGuardTestContext} from '../src/lib/worker-request-scope.ts';
import fs from 'node:fs';
let calls=0,reason;
beginPlacesGenerationSession('current-fixture');
assert.equal(await runPlacesApiDeduped('fixture','text',async()=>{calls++;return []},{requestId:'fixture',surface:'chat',priority:'foreground',requestType:'searchText',generationRequestId:'stale-fixture',onSkipped:r=>reason=r}),null);
assert.equal(reason,'stale_generation');assert.equal(calls,0);
const req=new Request('https://fixture.invalid/api/google',{headers:{'cf-connecting-ip':'203.0.113.1'}});
for(const bucket of ['ip','user','guest']) {
 const keys=[];const env={ABUSE_GUARD_ENFORCEMENT:'true',GOOGLE_API_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:!key.startsWith(`google:${bucket}:`)}}}};
 const res=await runWithWorkerRequest({env,request:req},()=>runWithGuardTestContext({userId:'fixture',ip:'203.0.113.1'},()=>bucket==='guest'?consumeGuestGoogleBurst(env,req):consumeGoogleBurst(env,'fixture',req)));
 assert.equal(res.status,429);assert.equal(res.headers.get('retry-after'),'60');assert.deepEqual(await res.json(),{error:'rate_limited',reason:`${bucket}_rate_limited`});assert.ok(keys.length<=2);
}
const config=fs.readFileSync('wrangler.jsonc','utf8');assert.match(config,/"limit": 120, "period": 60/);
console.log('PASS stale guard skip remains distinct; IP/user/guest safe enums, same status/retry-after and limiter calls.');

// Fixed reasons survive the actual discovery scope without emitting payloads.
const {createDiscoverySearchScope} = await import('../src/lib/ai/discovery-search-scope.ts');
const {createCombinationDiscoveryTrace} = await import('../src/lib/ai/combination-discovery-trace.ts');
const safeLogs=[]; const originalInfo=console.info;
try {
 console.info=(...args)=>safeLogs.push(args);
 for (const [error,expected] of [
  ['places_http_429:ip_rate_limited','ip_rate_limited'],
  ['places_http_429:user_rate_limited','user_rate_limited'],
  ['places_http_429:guest_rate_limited','guest_rate_limited'],
  ['places_http_429:RESOURCE_EXHAUSTED','provider_rate_limited'],
  ['cooldown_skipped','cooldown_skipped'],
  ['stale_generation','stale_generation'],
  ['deadline_exceeded','deadline_exceeded'],
  ['places_http_503','provider_error'],
 ]) {
  const scope=createDiscoverySearchScope(async()=>({places:[],error:error+' SECRET_TEST https://private.invalid/?key=SECRET_TEST'}),{deadlineAt:45000,now:()=>0});
  await assert.rejects(scope.search({data:{query:'PRIVATE_QUERY'}}));
  assert.equal(scope.stats.failFastReason,expected);
  assert.equal(scope.stats.rateLimited,expected.endsWith('rate_limited')?1:0);
  const trace=createCombinationDiscoveryTrace();trace.work(scope.stats);trace.finish(false);
  assert.equal(JSON.parse(safeLogs.at(-1)[1]).failureReason,expected);
 }
 assert.doesNotMatch(JSON.stringify(safeLogs),/SECRET_TEST|private.invalid|PRIVATE_QUERY/);
} finally {console.info=originalInfo;}
assert.match(fs.readFileSync('src/lib/places-api-guard.ts','utf8'),/RATE_MAX_CALLS = 20/);
assert.match(fs.readFileSync('src/lib/places-api-guard.ts','utf8'),/RATE_WINDOW_MS = 60_000/);
console.log('PASS eight fixed reasons reach trace, deadlines preserved, metadata redacted, memory limiter unchanged.');
