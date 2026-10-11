import assert from 'node:assert/strict';
import { dailyCompleteness, STANDARD_ITINERARY_DAY_SLOTS } from '../src/lib/ai/daily-completeness.ts';
import { validateComposedDayPlans, isItineraryRenderable, classifyPlanPlaceKind, minItemsPerDayForTrip, minItemsPerDayForStyle } from '../src/lib/ai/ai-day-plan-source.ts';
import { validateDayPlanSlots, validateCompleteItinerary, validatePlaceOpenAtTime, validateOpenHours } from '../src/lib/ai/ai-day-plan-slot-rules.ts';
import { requiredCanonicalCandidatesForTrip, countUniqueCanonicalLandmarks } from '../src/lib/ai/canonical-landmark.ts';
import { evaluateIncompletePayloadDegradation } from '../src/lib/ai/itinerary-candidate-recovery.ts';
import { refillMissingDaySlots } from '../src/lib/ai/ai-multi-day-planner.ts';
import { plannerFailureCounts } from '../src/lib/ai/planner-validation-diagnostic.ts';
function entry(day,index){
 const slot=STANDARD_ITINERARY_DAY_SLOTS[index%7];
 const type=['restaurant','tourist_attraction','restaurant','park','cafe','restaurant','bar'][index%7];
 const place={id:`ChIJCompletenessFixture${day}Entry${index}`,googlePlaceId:`ChIJCompletenessFixture${day}Entry${index}`,name:`${['甲','乙','丙','丁','戊','己','庚','辛'][index]}${String.fromCharCode(65+day)}${type}`,lat:35+day*0.001+index*0.0001,lng:139+day*0.001+index*0.0001,address:'Fixture',types:[type],primaryType:type,businessStatus:'OPERATIONAL'};
 return {...slot,name:place.name,place};
}
const plans=counts=>counts.map((n,i)=>({day:i+1,entries:Array.from({length:n},(_,j)=>entry(i,j))}));
const silent=console.info,warn=console.warn;console.info=()=>{};console.warn=()=>{};
const matrix=[];
try {
 for(const counts of [[5,5],[6,7],[7,7],[8,8],[4,7]]){
  const p=plans(counts),cv=validateComposedDayPlans(p,2),sv=validateDayPlanSlots(p,classifyPlanPlaceKind),fv=validateCompleteItinerary(p,2,'mixed','2026-12-15',classifyPlanPlaceKind);
  const sparse=counts.some(n=>n<7),overflow=counts.some(n=>n>7);
  assert.equal(cv.sparseDays.length>0,sparse);assert.equal(cv.overflowDays.length>0,overflow);
  assert.equal(sv.reasons.some(r=>r.startsWith('too_few_items:')),sparse);
  assert.equal(sv.reasons.some(r=>r.startsWith('overflow_day:')),overflow);
  assert.equal(fv.reasons.some(r=>r.startsWith('incomplete_day:')),sparse);
  assert.equal(fv.reasons.some(r=>r.startsWith('overflow_day:')),overflow);
  const renderable=isItineraryRenderable(p,2,'mixed','2026-12-15');
  assert.equal(renderable,!sparse&&!overflow,JSON.stringify(fv.reasons));
  const canonical=countUniqueCanonicalLandmarks(p.flatMap(d=>d.entries.map(e=>e.place)));
  const insufficient=canonical<requiredCanonicalCandidatesForTrip(2)||sparse;
  assert.equal(insufficient,sparse);
  matrix.push({counts,sparse,overflow,renderable,insufficient});
 }
 for(const days of [2,3,5,7])for(const pace of ['slow','medium','active']){
  const c=dailyCompleteness(pace),p=plans(Array(days).fill(7));
  assert.equal(c.slotCount,7);assert.equal(requiredCanonicalCandidatesForTrip(days,pace),days*c.minimumPlacesPerDay);
  assert.equal(minItemsPerDayForTrip(days),7);
  for(const style of ['classic_landmarks','local_life','slow_nature','mixed'])assert.equal(minItemsPerDayForStyle(style,days),7);
  assert.equal(validateComposedDayPlans(p,days).ok,true);
  assert.equal(isItineraryRenderable(p,days,'mixed','2026-12-15'),true);
 }
 const complete=plans([7,7]);
 const refilled=refillMissingDaySlots({plans:complete,pool:complete.flatMap(d=>d.entries.map(e=>e.place)),days:2,style:'mixed',plannedDate:'2026-12-15'});
 assert.equal(validateComposedDayPlans(refilled,2).ok,true);assert.equal(isItineraryRenderable(refilled,2,'mixed','2026-12-15'),true);
 const degraded=evaluateIncompletePayloadDegradation({plans:plans([3,3]),days:2});assert.equal(degraded.deliveryAllowed,true);
 assert.equal(evaluateIncompletePayloadDegradation({plans:plans([2,2]),days:2}).deliveryAllowed,false);
 const base=entry(0,0).place;
 function hours(p,time='12:00'){const codes=[];const ok=validatePlaceOpenAtTime(p,'2026-12-15',time,c=>codes.push(c));return {ok,codes}}
 assert.equal(hours({...base,businessStatus:'CLOSED_PERMANENTLY'}).ok,false);
 assert.ok(hours({...base,businessStatus:'CLOSED_PERMANENTLY'}).codes.includes('opening_hours_known_closed'));
 assert.equal(hours(base).ok,true);assert.ok(hours(base).codes.includes('opening_hours_unknown_hours'));
 assert.ok(hours({...base,todayHoursLabel:'18:00–22:00'}).codes.includes('opening_hours_time_window_conflict'));
 assert.ok(hours({...base,name:'Museum',primaryType:'museum',types:['museum']},'20:00').codes.includes('opening_hours_heuristic_mismatch'));
 const h=validateOpenHours([{day:1,entries:[{...entry(0,0),place:{...base,businessStatus:'CLOSED_PERMANENTLY'}}]}],'2026-12-15');
 assert.equal(h.diagnostics.validateOpenHours.opening_hours_known_closed,1);
 assert.deepEqual(plannerFailureCounts(['too_few_items:PRIVATE','missing_meals:PRIVATE','route_backtrack:PRIVATE','invalid_scenic:PRIVATE','invalid_scenic:PRIVATE']),{too_few_items:1,missing_meals:1,route_backtrack:1,invalid_scenic:2});
 assert.ok(!JSON.stringify(plannerFailureCounts(['SECRET:https://private'])).includes('SECRET'));
} finally {console.info=silent;console.warn=warn}
console.log('PASS daily completeness: matrix',JSON.stringify(matrix));
console.log('PASS 2/3/5/7 days; slow/medium/active; all styles share template; refill; explicit degraded policy; opening behavior and fixed count diagnostics. No network.');
