import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {parsePlusEntitlementSnapshot} from '../src/lib/plan-tier/entitlement.ts';
const auth=Symbol('requireSupabaseAuth');
let calls=0,received;
const deps={
 '@tanstack/react-start':{createServerFn:()=>{let middleware,parse=x=>x;const chain={middleware(m){middleware=m;return chain},inputValidator(fn){parse=fn;return chain},handler(fn){return async ({data,context}={})=>{assert.deepEqual([...middleware],[auth]);if(!context?.userId)throw Error('Unauthorized');return fn({data:parse(data),context})}}};return chain}},
 zod:{z},
 '@/integrations/supabase/auth-middleware':{requireSupabaseAuth:auth},
 '@/lib/plan-tier/entitlement':{parsePlusEntitlementSnapshot},
 '@/lib/outfit/generate-trip-outfit.server':{generateOutfitSuggestion:async(data,access)=>{calls++;received={data,access};return {weatherSource:'openweather'}}},
 '@/lib/weather/visual-crossing.server':{getWeatherSourceAvailability:()=> 'climate-source-v2:on'},
};
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/outfit/outfit.functions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>{assert.ok(id in deps,id);return deps[id]}});
const data={startDate:'2026-11-25',endDate:'2026-11-30',dayCount:6,items:[],allowAi:true,hasPlus:true};
for(const [entitlement,error,allowed] of [[{has_plus:false},null,false],[{has_plus:true},null,true],[{has_plus:true},Error('unavailable'),false],[{has_plus:'true'},null,false]]) {
 const context={userId:'fixture',supabase:{rpc:async(name,args)=>{assert.equal(name,'resolve_user_plus_entitlement');assert.equal(args.p_user_id,'fixture');return {data:entitlement,error}}}};
 await exports.generateTripOutfitSuggestion({data,context});
 assert.equal(received.access.allowAi,allowed);
 assert.equal(received.data.allowAi,undefined,'client cannot set AI authority');
 assert.equal(received.data.hasPlus,undefined);
 const before=calls;assert.equal(await exports.getTripWeatherSourceAvailability({context}),'climate-source-v2:on');assert.equal(calls,before);
}
await exports.generateTripOutfitSuggestion({data,context:{userId:'fixture',supabase:{rpc:async()=>{throw Error('offline')}}}});assert.equal(received.access.allowAi,false);
for(const fn of [exports.getTripWeatherSourceAvailability,exports.generateTripOutfitSuggestion]) await assert.rejects(fn({data}),/Unauthorized/);
console.log('PASS authenticated Free weather, Plus-only server AI authority, guest rejection, forged client flags ignored, resolver fail-closed, capability zero provider/AI calls.');
