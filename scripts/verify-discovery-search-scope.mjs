import assert from 'node:assert/strict';
import {createDiscoverySearchScope,generationDiscoverySearchScope,discoveryRequestSignature,classifyDiscoverySearch,DISCOVERY_REQUEST_BUDGET} from '../src/lib/ai/discovery-search-scope.ts';
const request=(query='fixture',extra={})=>({data:{query,lat:1,lng:2,mode:'text',radius:40000,includedTypes:['park','museum'],locale:'zh-TW',destinationName:'fixture',...extra}});
let calls=0;
const scope=createDiscoverySearchScope(async()=>{calls++;return {places:[]};},{deadlineAt:45000,now:()=>0});
await scope.search(request());await scope.search(request('next'));assert.equal(calls,2);
await Promise.all([scope.search(request('same')),scope.search(request('same'))]);assert.equal(calls,3);
await scope.search(request('same',{placesCaller:'combination_fallback_high_rating',includedTypes:['museum','park']}));assert.equal(calls,3);
await scope.search(request('nearby',{mode:'nearby'}));await scope.search(request('nearby',{mode:'nearby'}));assert.equal(calls,4);
assert.equal(scope.stats.deduped,3);
assert.notEqual(discoveryRequestSignature(request().data),discoveryRequestSignature(request('fixture',{radius:45000}).data));
assert.notEqual(discoveryRequestSignature(request().data),discoveryRequestSignature(request('fixture',{locale:'en'}).data));
for(const error of ['places_rate_limited','cooldown_skipped','stale_generation','places_http_503','places_http_400','places_http_401','network error','timeout']) {
 let attempts=0;const failed=createDiscoverySearchScope(async()=>{attempts++;return {places:[],error}},{deadlineAt:45000,now:()=>0});
 for(let i=0;i<87;i++) await assert.rejects(failed.search(request(String(i))));
 assert.equal(attempts,1);assert.equal(failed.stats.failed,1);assert.ok(failed.stats.failFastReason);
}
const deadline=createDiscoverySearchScope(async()=>{throw Error('must not call')},{deadlineAt:4000,now:()=>0});await assert.rejects(deadline.search(request('x',{placesCaller:'combination_theme_topup'})),/deadline_exceeded/);
const cap=createDiscoverySearchScope(async()=>({places:[]}),{deadlineAt:45000,now:()=>0});for(let i=0;i<DISCOVERY_REQUEST_BUDGET;i++) await cap.search(request(String(i)));await assert.rejects(cap.search(request('overflow')),/budget_exhausted/);
// Synthetic Osaka-like two-day pool: reuse broad result rather than expand repeated lanes.
let successful=0;const healthy=createDiscoverySearchScope(async()=>{successful++;return {places:Array.from({length:18},(_,i)=>({id:String(i)}))};},{deadlineAt:45000,now:()=>0});
const result=await healthy.search(request());assert.equal(result.places.length,18);await healthy.search(request());assert.equal(successful,1);
assert.equal(classifyDiscoverySearch({places:[],error:'invalid_google_request'}),'invalid_request');
assert.equal(classifyDiscoverySearch({places:[]}), 'success_empty');
console.log('PASS empty continuation, fail-fast 87 attempts -> 1 search, concurrent dedupe, nearby reuse, popular/high_rating reuse, filters isolation, deadline, budget, healthy pool 18 candidates / 1 call.');

let across=0;const lookup=async()=>{across++;return {places:[]}};
const one=generationDiscoverySearchScope('same-generation',lookup,{deadlineAt:Date.now()+45000});
const two=generationDiscoverySearchScope('same-generation',lookup,{deadlineAt:Date.now()+45000});
assert.equal(one,two);await Promise.all([one.search(request()),two.search(request())]);assert.equal(across,1);
await generationDiscoverySearchScope('other-generation',lookup,{deadlineAt:Date.now()+45000}).search(request());assert.equal(across,2);
console.log('PASS reentrant same-generation scope reuse and cross-generation isolation.');
