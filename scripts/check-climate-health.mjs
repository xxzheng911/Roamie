#!/usr/bin/env node
// Explicit operator invocation only. No public endpoint, no direct remote DO binding.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const args=process.argv.slice(2);
if(args.length!==3 || args[0]!=='--remote' || args[1]!=='--expected-active' || !/^[a-f0-9-]{36}$/.test(args[2])) {
 console.error('Usage: node scripts/check-climate-health.mjs --remote --expected-active <post-migration UUID>');process.exit(1);
}
const root=resolve(import.meta.dirname,'..');
Object.assign(process.env,{CLOUDFLARE_ACCOUNT_ID:'cb1835ce26e88097148685b0b1569bc3',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',WRANGLER_LOG:'error'});
let platform,temp;
const read=args=>{
 const r=spawnSync(resolve(root,'node_modules/.bin/wrangler'),[...args,'--config',resolve(root,'dist/server/wrangler.json'),'--json'],{encoding:'utf8',env:process.env,timeout:30000});
 if(r.status!==0)throw Error('preflight_failed');return JSON.parse(r.stdout);
};
try {
 const deployments=read(['deployments','list']);const active=[...deployments].sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0];
 assert.deepEqual(active.versions,[{version_id:args[2],percentage:100}]);
 const version=read(['versions','view',args[2]]);const resources=version.resources;
 const bindings=new Map(resources.bindings.map(b=>[b.name,b]));
 for(const [name,value] of Object.entries({VISUAL_CROSSING_ENABLED:'false',ABUSE_GUARD_ENFORCEMENT:'true',GOOGLE_GLOBAL_DAILY_UNITS:'100000'})) {
  assert.equal(bindings.get(name)?.type,'plain_text');assert.equal(bindings.get(name)?.text,value);
 }
 assert.equal(resources.script_runtime.migration_tag,'v2-visual-crossing-climate');
 assert.equal(bindings.get('VISUAL_CROSSING_CLIMATE')?.class_name,'VisualCrossingClimate');
 assert.equal(bindings.get('VISUAL_CROSSING_CLIMATE')?.type,'durable_object_namespace');
 assert.ok(bindings.get('VISUAL_CROSSING_CLIMATE')?.namespace_id);
 assert.ok(resources.script.named_handlers.some(h=>h.name==='ClimateHealth'));
 temp=mkdtempSync(join(tmpdir(),'roamie-health-probe-'));
 const configPath=join(temp,'wrangler.json');
 writeFileSync(configPath,JSON.stringify({name:'roamie-climate-health-probe',account_id:process.env.CLOUDFLARE_ACCOUNT_ID,compatibility_date:'2025-09-24',workers_dev:false,preview_urls:false,services:[{binding:'CLIMATE_HEALTH',service:'roamie',entrypoint:'ClimateHealth',remote:true}]}));
 const {getPlatformProxy}=await import('wrangler');
 platform=await getPlatformProxy({configPath,envFiles:[],persist:false,remoteBindings:true});
 // Cloudflare-authorized remote SERVICE binding; the deployed named entrypoint owns the DO binding.
 const response=await platform.env.CLIMATE_HEALTH.fetch('https://climate-health.internal/__health',{method:'GET'});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.kind,'visual-crossing-health-v1');assert.equal(data.sqlite,'readable');
 assert.equal(data.limit,900);assert.equal(data.windowHours,24);
 assert.ok(data.budget==='uninitialized' ? data.usedRecords===null : data.budget==='readable' && Number.isSafeInteger(data.usedRecords) && data.usedRecords>=0 && typeof data.blocked==='boolean');
 console.log(JSON.stringify({status:'PASS',kind:data.kind,sqlite:data.sqlite,budget:data.budget,usedRecords:data.usedRecords,limit:data.limit,windowHours:data.windowHours,blocked:data.budget==='readable'?data.blocked:undefined}));
} catch {console.error('FAIL: climate health/preflight unavailable; keep feature OFF. Raw errors suppressed.');process.exitCode=1;}
finally {try {await platform?.dispose();} catch {console.error('Health proxy cleanup failed; raw error suppressed.');process.exitCode=1;} finally {if(temp)rmSync(temp,{recursive:true,force:true});}}
