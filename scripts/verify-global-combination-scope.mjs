import assert from 'node:assert/strict';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {resolvePlanningDestination} from '../src/lib/ai/resolved-trip-destination.ts';
import {evaluateCombinationDiscoveryGuard} from '../src/lib/ai/trip-duration-guard.ts';
import {resolveDestinationEntity} from '../src/lib/ai/destination-entity.ts';
import {matchedCombinationScope} from '../src/lib/ai/destination-scope.ts';
import {ensureDestinationCombinationsReady, clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {discoveryFailure} from '../src/lib/ai/combination-discovery-trace.ts';

globalThis.fetch=async()=>{throw Error('Unexpected real network request')};
const rows=[['Portugal','Porto','PT',41.15,-8.61],['Iceland','Reykjavik','IS',64.14,-21.94],['New Zealand','Queenstown','NZ',-45.03,168.66],['Morocco','Marrakech','MA',31.63,-8.0],['Japan','Sapporo','JP',43.06,141.35]];
const scopes=[];
for(const [country,city,code,lat,lng] of rows){
 let session={...createEmptySession(),workspaceId:"scope-fixture",travelContext:{interests:["museums"]}};
 session=mergeTravelContext(session,`I'm going to ${country} in December.`).session;
 session=mergeTravelContext(session,city).session;
 session=await resolveGlobalPlanningCandidate(session,'en',async()=>({rawResultCount:1,location:{placeId:'ChIJFixtureDestination'+code,country:code,city,region:city,lat,lng,formattedName:city,displayLabel:city}}));
 session=mergeTravelContext(session,'4').session;
 const response=processAdviceTurn('4',session,session.travelContext,undefined,'en');
 session={...response.session,pendingQuestion:response.route?.pendingQuestion};
 assert.equal(session.travelContext.days,4);
 assert.equal(session.travelContext.travelMonth,'12月');
 assert.equal(session.workspaceId,"scope-fixture");
 assert.ok(session.travelContext.interests.includes("museums"));
 assert.equal(session.tripDestination.country,code);
 const scope=resolvePlanningDestination(session.travelContext,session);scopes.push(scope);
 assert.equal(scope.type,'city');assert.equal(scope.countryCode,code);
 const guard=evaluateCombinationDiscoveryGuard({...session.travelContext,days:4,session});
 assert.equal(guard.allowed,true,city+': '+guard.reason);
 let calls=0,geocodes=0;clearDiscoveredCombinationsCache();
 const result=await ensureDestinationCombinationsReady({destination:scope.label,destinationCountry:code,resolvedDestination:scope,days:4,locale:'en',generationRequestId:'scope-'+code,
 geocodeFn:async()=>{geocodes++;throw Error('must reuse trusted coordinates')},
 searchPlaces:async()=>{calls++;return {places:[],error:'provider_error'}}});
 assert.equal(calls,1,city+' must reach provider boundary exactly once');assert.equal(geocodes,0);
 assert.equal(result.ok,false);assert.equal(result.failureDetail,'provider_error');
 console.log('PASS resolved scope, session, search boundary, no geocode:',city);
}
for(const destination of ['Portugal','Japan','Uncharted Destination','Abc']){
 clearDiscoveredCombinationsCache();let calls=0;
 const result=await ensureDestinationCombinationsReady({destination,days:4,locale:'en',searchPlaces:async()=>{calls++;throw Error('must not search')}});
 assert.equal(result.failureReason,['Portugal','Japan'].includes(destination)?'blocked_country':'unresolved_destination');assert.equal(calls,0);
}
assert.equal(resolveDestinationEntity('Uncharted Destination').type,'unknown');assert.equal(resolveDestinationEntity('Abc').type,'unknown');
assert.equal(matchedCombinationScope('Another destination',scopes[0]),undefined);
assert.equal(matchedCombinationScope(scopes[0].label,scopes[0],'US'),undefined);
assert.equal(matchedCombinationScope(scopes[0].label,{...scopes[0],placeId:''}),undefined);
const stale=resolvePlanningDestination({destination:'New Unknown',destinationCountry:'US'},{tripDestination:{placeId:'old',city:scopes[0].label,country:'PT',lat:41.15,lng:-8.61}});
assert.equal(stale.placeId,undefined);assert.equal(stale.latitude,undefined);assert.equal(stale.type,'unknown');
for(const reason of ['blocked_country','unresolved_destination','provider_error','network_error','timeout','rate_limited','auth_error','empty_candidates','filtered_candidates','insufficient_combinations']) assert.equal(discoveryFailure(reason),reason);
clearDiscoveredCombinationsCache();
console.log('PASS country-only, unresolved, same-name country mismatch, stale destination, missing identity, fixed failure reasons. Real providers NOT VERIFIED.');
// Exercise real validation: display labels without Google identity must never become combinations.
clearDiscoveredCombinationsCache();
let invalidCalls=0;
const invalid=await ensureDestinationCombinationsReady({destination:scopes[0].label,destinationCountry:'PT',resolvedDestination:scopes[0],days:4,locale:'en',generationRequestId:'invalid-place-identities',
 searchPlaces:async()=>{invalidCalls++;return {places:Array.from({length:18},(_,i)=>({name:`Heritage Museum ${i}`,lat:41.15+i*.0001,lng:-8.61,types:['museum'],rating:4.7,userRatingCount:1000})),error:null}}});
assert.equal(invalid.ok,false);assert.equal(invalid.combinations.length,0);assert.ok(invalidCalls<=12);
console.log('PASS ungrounded provider names cannot create combinations; bounded search budget.');
clearDiscoveredCombinationsCache();
