import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isResolvedDestination,resolveDestinationAuthority} from '../src/lib/location/destination-authority.ts';
import {applyPlanTripDetails} from '../src/lib/plan-form-trip-payload.ts';
import {tripWeatherMode,selectTripForecast,tripCalendarDates} from '../src/lib/outfit/trip-weather-policy.ts';
const cities=[['曼谷','TH',13.7563,100.5018],['東京','JP',35.6764,139.65],['首爾','KR',37.5665,126.978],['Bali','ID',-8.34,115.09]];
for(const [city,country,lat,lng] of cities){
 let calls=0;const canonical={placeId:'fixture-'+country,country,city,lat,lng,formattedName:city,displayLabel:city,utcOffsetMinutes:420};
 const resolved=await resolveDestinationAuthority(undefined,city,async()=>{calls++;return canonical});
 assert.deepEqual(resolved,canonical);assert.equal(calls,1);assert.ok(isResolvedDestination(resolved));
 assert.equal(await resolveDestinationAuthority(canonical,city,async()=>{throw Error('must not query')}),canonical);
 const payload=applyPlanTripDetails({destination:city,itinerary:[],tripSettings:{tripStartDate:'2026-12-15',tripEndDate:'2026-12-18'}},{locale:'zh-TW',destinationLocation:resolved});
 assert.deepEqual(payload.destinationLocation,canonical);
}
const old={placeId:'',country:'',city:'曼谷',lat:0,lng:0,formattedName:'曼谷',displayLabel:'曼谷'};
assert.equal(isResolvedDestination(old),false);
assert.equal(await resolveDestinationAuthority(old,'曼谷',async()=>null),undefined);
assert.equal(await resolveDestinationAuthority(old,'曼谷',async()=>{throw Error('offline')}),undefined);
assert.equal(applyPlanTripDetails({destination:'曼谷',destinationLocation:old,itinerary:[],tripSettings:{}},{locale:'zh-TW'}).destinationLocation,undefined);
assert.equal(isResolvedDestination({...old,placeId:'verified-zero',country:'verified'}),true,'0,0 is not intrinsically invalid');
const start='2026-12-15',end='2026-12-18';assert.equal(tripWeatherMode({startDate:start,endDate:end,utcOffsetMinutes:420},Date.parse('2026-10-11T00:00:00Z')),'climate');
assert.deepEqual(selectTripForecast([{date:'2026-10-10',tempLowC:25,tempHighC:30}],tripCalendarDates(start,end)),[]);
const day={date:start,tempLowC:25,tempHighC:30,precipProbability:null};assert.equal(selectTripForecast([day],[start]).length,1);
const server=fs.readFileSync('src/lib/itinerary.functions.ts','utf8');assert.ok(!server.includes('openWeatherGetForecast('));assert.match(server,/openWeatherGetTripForecast\(\{/);assert.match(server,/if \(forecast.length\) outfitAdvice/);assert.match(server,/isResolvedDestination\(data.destinationLocation\)/);
const hook=fs.readFileSync('src/hooks/use-trip-outfit-suggestion.ts','utf8');assert.match(hook,/isResolvedDestination\(suppliedDestinationLocation\)/);
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');assert.match(chat,/placesFallback: false/);assert.match(chat,/throw new Error\("destination_unresolved"\)/);assert.match(chat,/destinationLocation: workingSession.tripDestination/);
console.log('PASS AI Bangkok/Tokyo/Seoul/Bali canonical fixtures; manual no extra resolver calls; unresolved/legacy sentinel, valid 0,0 authority, exact forecast dates, no live provider or AI calls.');
