import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=p=>fs.readFileSync(p,'utf8');
const exports={},logs=[];
const compiled=ts.transpileModule(read('src/lib/ai/trip-runtime-diagnostic.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(compiled,{exports,console:{warn:(...args)=>logs.push(args)}});
const emit=exports.logTripRuntime;
for(const entryType of ['advice','direct_intent','regenerate']){
 emit('entry',{entryType,hasChatLoading:false,generating:false,prompt:'SECRET',placeId:'SECRET',lat:24,token:'SECRET'});
 assert.equal(JSON.parse(logs.at(-1)[1]).entryType,entryType);
}
for(const contextBundle of ['destination','device','unknown']){emit('context',{contextBundle});assert.equal(JSON.parse(logs.at(-1)[1]).contextBundle,contextBundle)}
const fetchSource=read('src/lib/ai/itinerary-place-fetch.ts');
const start=fetchSource.indexOf('  logTripRuntime("coordinates", { coordinateSource:\n');
const expression=fetchSource.slice(start,fetchSource.indexOf(' });',start)+4);
for(const [geocoded,approx,expected] of [[{lat:1,lng:2},null,'geocode'],[null,{lat:1,lng:2},'approximate'],[null,null,'fixed_fallback'],[{lat:1},null,'unresolved']]){
 vm.runInNewContext(expression,{geocoded,approx,logTripRuntime:emit});assert.equal(JSON.parse(logs.at(-1)[1]).coordinateSource,expected);
}
for(const [finalRenderable,failureCode] of [[true,'none'],[false,'candidate_insufficient']]){
 emit('final',{finalRenderable,failureCode,finalAvailable:4});assert.equal(JSON.parse(logs.at(-1)[1]).failureCode,failureCode);
}
emit('assembly',{discoveryInitial:10,afterCanonicalDedupe:10,afterGeographicFilter:null,afterEligibility:10,beforeAssembly:10,afterAssembly:4});
assert.equal(JSON.parse(logs.at(-1)[1]).afterAssembly,4);
assert.ok(!JSON.stringify(logs).includes('SECRET'));
emit('entry',{entryType:'SECRET',coordinateSource:'SECRET',beforeAssembly:NaN,afterAssembly:-1});assert.equal(logs.at(-1)[1],'{}');
const chat=read('src/routes/_app.chat.tsx');
assert.match(chat,/withReply,\s+"advice",/);assert.match(chat,/regenCtx,\s+next,\s+"regenerate",/);
assert.match(chat,/entryType: TripEntryType = "direct_intent"/);
assert.match(chat,/contextBundle: syncedForBundle.tripDestination \? "destination" : "device"/);
const planner=read('src/lib/ai/destination-trip-planning.ts');
assert.ok(planner.indexOf('beforeAssembly: ranked.length')<planner.indexOf('composedPlans = buildComposedDayPlans'));
assert.match(planner,/finalAvailable: countUniqueCanonicalLandmarks\(flattenComposedDayPlanPlaces\(composedPlans\)\)/);
for(const p of ['src/routes/_app.chat.tsx','src/lib/ai/itinerary-place-fetch.ts','src/lib/ai/destination-trip-planning.ts']){
 const r=ts.transpileModule(read(p),{fileName:p,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 assert.equal((r.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,p);
}
vm.runInNewContext(compiled,{exports,console:{warn(){throw Error('bridge')}}});assert.doesNotThrow(()=>exports.logTripRuntime('entry',{}));
console.log('PASS entry paths, bundle branches, coordinate failure/fallback, candidate/final fields, redaction, source wiring, syntax, logging isolation.');
