import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
// The actual public handler is byte-for-byte unchanged; it never routes to ClimateHealth.
assert.equal(readFileSync('src/server.ts','utf8').split('export default')[1],execFileSync('git',['show','HEAD:src/server.ts'],{encoding:'utf8'}).split('export default')[1]);
const entry=`
export {ClimateHealth} from './src/lib/weather/climate-health-entrypoint';
import {VisualCrossingClimate as Real} from './src/lib/weather/visual-crossing-do';
export class VisualCrossingClimate extends Real {
 constructor(ctx,env){super(ctx,env);this.fixture=ctx.storage;this.mode='normal';this.healthCalls=0;}
 async fetch(request){const url=new URL(request.url);
  if(url.pathname==='/fixture-state') return Response.json(await this.fixture.get('state')??null);
  if(url.pathname==='/fixture-seed'){await this.fixture.put('state',await request.json());return Response.json(true);}
  if(url.pathname==='/fixture-mode'){this.mode=await request.text();return Response.json(true);}
  if(url.pathname==='/fixture-calls')return Response.json(this.healthCalls);
  if(url.pathname==='/__health'){
   this.healthCalls++;
   if(url.href!=='https://climate.internal/__health'||request.method!=='GET'||request.headers.has('authorization')||request.headers.has('x-do-id'))throw Error('forwarded user request');
   if(this.mode==='throw')throw Error('SENSITIVE_STACK_SECRET');
   if(this.mode==='invalid')return Response.json({secret:'SENSITIVE_STACK_SECRET'});
   if(this.mode==='extra')return Response.json({kind:'visual-crossing-health-v1',sqlite:'readable',limit:900,windowHours:24,budget:'uninitialized',usedRecords:null,secret:'SENSITIVE_STACK_SECRET'},{headers:{'x-secret':'SENSITIVE_STACK_SECRET'}});
  }
  return super.fetch(request);
 }
}
export default {fetch(){return new Response(null,{status:404});}};`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
let outbound=0;
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'operator',modules:true,compatibilityDate:'2025-09-24',script:'export default {fetch(r,e){return e.HEALTH.fetch(r)}}',serviceBindings:{HEALTH:{name:'target',entrypoint:'ClimateHealth'}}},
 {name:'target',modules:true,compatibilityDate:'2025-09-24',script:bundle.outputFiles[0].text,bindings:{VISUAL_CROSSING_API_KEY:'SENSITIVE_STACK_SECRET'},durableObjects:{VISUAL_CROSSING_CLIMATE:{className:'VisualCrossingClimate',useSQLite:true}},outboundService:()=>{outbound++;throw Error('No upstream allowed');}},
 {name:'operator-missing',modules:true,compatibilityDate:'2025-09-24',script:'export default {fetch(r,e){return e.HEALTH.fetch(r)}}',serviceBindings:{HEALTH:{name:'missing',entrypoint:'ClimateHealth'}}},
 {name:'missing',modules:true,compatibilityDate:'2025-09-24',script:bundle.outputFiles[0].text},
]}));
try {
 const ns=await mf.getDurableObjectNamespace('VISUAL_CROSSING_CLIMATE','target');const stub=ns.get(ns.idFromName('global-v1'));
 const state=async()=>(await stub.fetch('https://internal/fixture-state')).json();
 const invoke=(url='https://climate-health.internal/__health',options)=>mf.dispatchFetch(url,options);
 let r=await invoke();assert.equal(r.status,200);assert.equal((await r.json()).budget,'uninitialized');assert.equal(await state(),null);
 const calls=await (await stub.fetch('https://internal/fixture-calls')).json();
 for(const path of ['/query','/__health?id=another','/__health/other','/'])assert.equal((await invoke('https://climate-health.internal'+path)).status,404);
 assert.equal((await invoke('https://roamie.tw/__health')).status,404);
 for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal((await invoke(undefined,{method})).status,405);
 assert.equal(await (await stub.fetch('https://internal/fixture-calls')).json(),calls);
 const publicWorker=await mf.getWorker('target');assert.equal((await publicWorker.fetch('https://roamie.tw/__health')).status,404);
 const seeded={charges:[{at:Date.now(),records:17}],leaseUntil:0,blocked:false,cache:{}};
 await stub.fetch('https://internal/fixture-seed',{method:'POST',body:JSON.stringify(seeded)});
 r=await invoke(undefined,{headers:{authorization:'SENSITIVE_STACK_SECRET','x-do-id':'other'}});
 assert.equal((await r.json()).usedRecords,17);assert.deepEqual(await state(),seeded);
 const other=ns.get(ns.idFromName('other'));assert.equal(await (await other.fetch('https://internal/fixture-state')).json(),null);
 for(const mode of ['extra','invalid','throw']){
  await stub.fetch('https://internal/fixture-mode',{method:'POST',body:mode});r=await invoke();assert.equal(r.status,mode==='extra'?200:503);assert.ok(!(await r.text()).includes('SECRET'));assert.equal(r.headers.get('x-secret'),null);assert.deepEqual(await state(),seeded);
 }
 await stub.fetch('https://internal/fixture-mode',{method:'POST',body:'normal'});
 await stub.fetch('https://internal/fixture-seed',{method:'POST',body:'{"charges":null}'});
 assert.equal((await invoke()).status,503);assert.deepEqual(await state(),{charges:null});
 const missing=await mf.getWorker('operator-missing');assert.equal((await missing.fetch('https://climate-health.internal/__health')).status,503);
 assert.equal(outbound,0);
 console.log('PASS named service-binding bridge: fixed canonical DO, no public route, invalid path/method/query denied, headers not forwarded, empty/populated/corrupt/failing/missing binding handled, responses allowlisted, no upstream or ledger changes.');
} finally {await mf.dispose();}

// Operator tool: mock Cloudflare metadata and remote SERVICE binding, never create a remote session.
const {default:vm}=await import('node:vm');
const {resolve,join}=await import('node:path');
const probeSource=readFileSync('scripts/check-climate-health.mjs','utf8').replace(/^#!.*\n/,'').replace(/^import .*;$/gm,'').replaceAll('import.meta.dirname','"/repo/scripts"').replace("import('wrangler')",'Promise.resolve({getPlatformProxy:mockPlatformProxy})');
const id='c26d2177-1c32-4dc9-b32b-f104725c8f81';
async function probe({flag='false',data={kind:'visual-crossing-health-v1',sqlite:'readable',budget:'uninitialized',usedRecords:null,limit:900,windowHours:24},transportError=false,hang}={}) {
 const logs=[];let calls=0,disposed=0,probeConfig;
 const process={argv:['node','probe','--remote','--expected-active',id],env:{},exitCode:0,exit(code){this.exitCode=code;}};
 await vm.runInNewContext(`(async()=>{${probeSource.replace('ms=15000','ms=5').replace("platform?.dispose(),5000","platform?.dispose(),5")}})()`,{
  process,assert,resolve,join,setTimeout,clearTimeout,tmpdir:()=>'/tmp',mkdtempSync:()=>'/tmp/probe-fixture',writeFileSync:(_p,text)=>{probeConfig=JSON.parse(text);},rmSync:()=>{},
  console:{log:x=>logs.push(x),error:x=>logs.push(x)},
  spawnSync:(_bin,args,options)=>({status:0,stdout:options.env.WRANGLER_LOG==='error'?'':JSON.stringify(args[0]==='deployments'?[{created_on:'today',versions:[{version_id:id,percentage:100}]}]:{resources:{script_runtime:{migration_tag:'v2-visual-crossing-climate'},script:{named_handlers:[{name:'ClimateHealth'}]},bindings:[{name:'VISUAL_CROSSING_ENABLED',type:'plain_text',text:flag},{name:'ABUSE_GUARD_ENFORCEMENT',type:'plain_text',text:'true'},{name:'GOOGLE_GLOBAL_DAILY_UNITS',type:'plain_text',text:'100000'},{name:'VISUAL_CROSSING_CLIMATE',type:'durable_object_namespace',class_name:'VisualCrossingClimate',namespace_id:'fixture'}]}})}),
  mockPlatformProxy:async options=>{if(hang==='init')return new Promise(()=>{});assert.equal(options.remoteBindings,true);assert.equal(options.envFiles.length,0);return {env:{CLIMATE_HEALTH:{fetch:async(url,init)=>{calls++;if(hang==='fetch')return new Promise(()=>{});assert.equal(url,'https://climate-health.internal/__health');assert.equal(init.method,'GET');if(transportError)throw Error('SENSITIVE_SECRET');return hang==='parse'?{status:200,json:()=>new Promise(()=>{})}:Response.json(data);}}},dispose:async()=>{disposed++;if(hang==='cleanup')return new Promise(()=>{});}};},
 });
 return {logs,calls,disposed,probeConfig,code:process.exitCode};
}
let p=await probe();assert.equal(p.code,0);assert.equal(p.calls,1);assert.equal(p.disposed,1);assert.deepEqual(p.probeConfig.services,[{binding:'CLIMATE_HEALTH',service:'roamie',entrypoint:'ClimateHealth',remote:true}]);
p=await probe({flag:'true'});assert.equal(p.code,0);assert.equal(p.calls,1);
for(const flag of [undefined,'invalid','']){p=await probe({flag:flag??'missing'});assert.equal(p.code,1);assert.equal(p.calls,0);}
for(const options of [{transportError:true},{data:{kind:'visual-crossing-health-v1',sqlite:'readable',budget:'readable',usedRecords:{secret:'SENSITIVE_SECRET'},limit:900,windowHours:24,blocked:false}}]){p=await probe(options);assert.equal(p.code,1);assert.equal(p.disposed,1);assert.ok(!p.logs.join().includes('SENSITIVE_SECRET'));}
console.log('PASS operator probe: post-migration/active/boolean flag gates, remote service entrypoint only, fixed GET, sanitized errors, cleanup; all remote calls mocked.');

for(const hang of ['init','fetch','parse','cleanup']){p=await probe({hang});assert.equal(p.code,1);assert.ok(!p.logs.join().includes('SECRET'));}
console.log('PASS operator phase timeouts: init/fetch/parse/cleanup settle without provider calls.');
