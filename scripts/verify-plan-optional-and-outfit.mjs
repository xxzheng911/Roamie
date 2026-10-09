import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { preparePlanTripSession, buildPlanTripInitialContext } from '../src/lib/plan-trip-handoff.ts';
import { buildPlanFormTripPayload, applyPlanTripDetails } from '../src/lib/plan-form-trip-payload.ts';
import { resolveLocalTripOutfit } from '../src/lib/outfit/local-trip-outfit-fallback.ts';
import { buildSystemPrompt } from '../src/lib/ai/prompts.ts';
import { translate } from '../src/lib/i18n/translate.ts';

const destination={placeId:'tokyo',country:'日本',city:'東京都',formattedName:'東京都',displayLabel:'東京都',lat:35.68,lng:139.69,timezone:'Asia/Tokyo'};
const form={destination,origin:null,days:6,mood:'',styles:[],startDate:'2026-11-25',endDate:'2026-11-30',departureTime:'',transport:'walk'};
const now=Date.parse('2026-10-10T00:00Z');
// Execute actual schema field expressions, without loading network/auth server dependencies.
function schemaFields(file, fieldNames) {
 const source=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const fields={};
 const visit=n=>{
  if(ts.isPropertyAssignment(n)&&fieldNames.includes(n.name.getText(ast))) {
   const text=n.initializer.getText(ast);
   if(text.startsWith('z.')) fields[n.name.getText(ast)]=vm.runInNewContext(text,{z});
  }
  ts.forEachChild(n,visit);
 };
 visit(ast);return z.object(fields);
}
const schema=schemaFields('src/lib/itinerary.functions.ts',['budget','travelers']);
const aiSchema=schemaFields('src/lib/ai/service.server.ts',['budget','travelers']);
for(const travelers of [undefined,3]) for(const budgetMode of [undefined,'budget']) {
 const input={...form,travelers,budgetMode};
 const payload=buildPlanFormTripPayload(input);
 const persisted=JSON.parse(JSON.stringify(payload));
 assert.equal(persisted.travelers,travelers);
 assert.ok(!/undefined|null|0 人/.test(payload.summary));
 assert.equal(persisted.tripSettings.tripStartDate,form.startDate);
 assert.deepEqual(persisted.destinationLocation,destination);
 for(const planAiMode of [false,true]) {
  const session=preparePlanTripSession(input,{weather:null},undefined,{planAiMode});
  assert.equal(session.tripCompanionCount,travelers);assert.equal(session.budget,budgetMode);
  const context=buildPlanTripInitialContext(input,{weather:null});
  if(travelers==null) assert.ok(context.includes('不得假設人數'));
  if(!budgetMode) assert.ok(context.includes('不設定預算上限'));
  assert.ok(!/undefined|null/.test(context));
  for(const tier of ['free','plus']) {
   const request={travelers,budget:budgetMode?'low':undefined,planTier:tier};
   assert.equal(schema.parse(request).travelers,travelers);
   assert.equal(schema.parse(request).budget,request.budget);
   assert.equal(aiSchema.parse(request).budget,request.budget);
   const prompt=buildSystemPrompt({mode:'itinerary',planTier:tier,itineraryRequest:{destination:'東京',days:6,...request}});
   if(!budgetMode) assert.ok(prompt.includes('不設定預算上限或固定金額'));
   if(travelers==null) assert.ok(prompt.includes('不得假設人數或計算團體總費用'));
   assert.ok(!prompt.includes('undefined'));
  }
 }
 const final=applyPlanTripDetails({...payload,outfitSuggestion:'stale generic',weatherSummary:'18–31°C'}, {locale:'zh-TW',destinationLocation:destination,travelers},now);
 assert.equal(final.travelers,travelers);assert.deepEqual(final.destinationLocation,destination);
 assert.equal(final.weatherSummary,'');assert.ok(final.outfitSuggestion.includes('保暖外套'));
 assert.ok(final.outfitSuggestion.includes('並非實際天氣預報'));
 assert.equal(JSON.parse(JSON.stringify(final)).outfitSuggestion,final.outfitSuggestion);
}
assert.equal(schema.safeParse({travelers:-1}).success,false);
assert.equal(schema.safeParse({budget:'bad'}).success,false);
const route=fs.readFileSync('src/routes/_app.plan.tsx','utf8');
assert.ok(!route.includes('if (!budgetMode)'));
assert.ok(route.includes('travelers !== 0 && !isValidTravelers(travelers)'));
assert.ok(route.includes('if (!validateTripPlaces(resolvedDestination, resolvedOrigin)) return null;'));
assert.ok(route.includes('endDate < startDate'));
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
assert.ok(!chat.includes('tripCompanionCount ?? 1'));
assert.ok(!chat.includes('normalizeWeather(bundle.weather)'));
assert.ok(chat.includes('workingSession.fromPlanForm && !workingSession.budget'));
const hook=fs.readFileSync('src/hooks/use-trip-outfit-suggestion.ts','utf8');
assert.ok(hook.includes('isCached ? outfitFields : localOutfit ??'));
assert.ok(!hook.includes('Boolean(localOutfit) ||'),'seasonal placeholder must allow a historical climate request');
for(const locale of ['zh-TW','en','ja','ko']) {
 const params={locale,destination:'東京都',startDate:form.startDate,endDate:form.endDate,lat:35.68,lng:139.69,timezone:'Asia/Tokyo',items:[],inputKey:'stale'};
 const local=resolveLocalTripOutfit(params,now);
 assert.equal(local.weatherSource,'unavailable');assert.equal(local.outfitSuggestion.split('\n\n').length,3);
 assert.equal(local.weatherSummary,'');
 const fresh=applyPlanTripDetails(buildPlanFormTripPayload(form),{locale,destinationLocation:destination},now);
 assert.equal(fresh.outfitSuggestion,local.outfitSuggestion,'new/saved trip use identical fallback');
 assert.equal(resolveLocalTripOutfit({...params,startDate:'2026-10-11',endDate:'2026-10-13'},now),null);
 assert.match(translate(locale,'plan.travelers'),/選填|optional|任意|선택/);
 assert.match(translate(locale,'plan.budget'),/選填|optional|任意|선택/);
}
console.log('PASS optional A–F: forms, schema, Free/Plus request shapes, handoff and JSON persistence; new/saved far-trip fallback, locale labels, stale-copy precedence. No live APIs or DB writes.');
