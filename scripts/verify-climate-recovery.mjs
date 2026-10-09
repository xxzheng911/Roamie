import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { verifyReleaseArtifacts } from './verify-release-artifacts.mjs';
const snapshot=resolve(process.argv[2]);
const manifest=JSON.parse(readFileSync(join(snapshot,'recovery-manifest.json'),'utf8'));
const receipt=verifyReleaseArtifacts(snapshot);
assert.equal(createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),manifest.receiptSha256);
for(const [file,hash] of Object.entries(manifest.scripts)) assert.equal(createHash('sha256').update(readFileSync(join(snapshot,'scripts',file))).digest('hex'),hash);
const config=JSON.parse(readFileSync(join(snapshot,'dist/server/wrangler.json'),'utf8'));
assert.deepEqual(config.migrations,manifest.migrations);assert.deepEqual(config.durable_objects.bindings,manifest.bindings);
assert.equal(manifest.requiredProductionVars.VISUAL_CROSSING_ENABLED,'false');
// Compile only a local fixture around the actual built class. No source replacement.
const entry=`import {VisualCrossingClimate as ProductionClimate,AbuseGuard} from ${JSON.stringify(join(snapshot,'dist/server/index.js'))};
export {AbuseGuard};
export class VisualCrossingClimate extends ProductionClimate {
 constructor(ctx,env){super(ctx,env);this.fixtureStorage=ctx.storage;}
 async fetch(request){
  if(new URL(request.url).pathname==='/fixture-seed') {await this.fixtureStorage.put('state',await request.json());return Response.json(true);}
  if(new URL(request.url).pathname==='/fixture-read') return Response.json(await this.fixtureStorage.get('state')??null);
  return super.fetch(request);
 }
}
export default {fetch(){return new Response(null,{status:404});}};`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'esm',platform:'node',external:['cloudflare:*','node:*'],logLevel:'silent'});
const persistence=mkdtempSync(join(tmpdir(),'climate-recovery-sqlite-'));
let outbound=0,mf;
const start=()=>new Miniflare(convertV4MiniflareOptions({name:'roamie-recovery-fixture',modules:true,script:bundle.outputFiles[0].text,
 compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 bindings:{VISUAL_CROSSING_ENABLED:'false'},resourcePersistencePath:persistence,
 durableObjects:{VISUAL_CROSSING_CLIMATE:{className:'VisualCrossingClimate',useSQLite:true},ABUSE_GUARD:{className:'AbuseGuard',useSQLite:true}},
 outboundService:()=>{outbound++;throw Error('Recovery health must not call upstream');},
}));
const stub=async()=>{const ns=await mf.getDurableObjectNamespace('VISUAL_CROSSING_CLIMATE');return ns.get(ns.idFromName('global-v1'));};
try {
 mf=start();let doStub=await stub();
 assert.equal((await (await doStub.fetch('https://internal/__health')).json()).budget,'uninitialized');
 const state={charges:[{at:Date.now(),records:42}],leaseUntil:0,blocked:false,cache:{}};
 assert.equal(await (await doStub.fetch('https://internal/fixture-seed',{method:'POST',body:JSON.stringify(state)})).json(),true);
 assert.deepEqual(await (await doStub.fetch('https://internal/fixture-read')).json(),state);
 await mf.dispose();mf=start();doStub=await stub();
 const health=await (await doStub.fetch('https://internal/__health')).json();
 assert.equal(health.usedRecords,42);assert.equal(health.sqlite,'readable');
 assert.deepEqual(await (await doStub.fetch('https://internal/fixture-read')).json(),state);
 assert.equal(outbound,0);
 assert.deepEqual(verifyReleaseArtifacts(snapshot),receipt);
 console.log('PASS recovery artifact: actual compiled DO, SQLite restart retains budget, zero upstream, unchanged receipt/class bindings/migrations/tool hashes. No Cloudflare writes.');
} finally {await mf?.dispose();rmSync(persistence,{recursive:true,force:true});}
