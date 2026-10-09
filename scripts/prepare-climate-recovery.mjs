#!/usr/bin/env node
// Offline snapshot only. Never invokes Wrangler or changes Cloudflare.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyReleaseArtifacts } from './verify-release-artifacts.mjs';
const root=resolve(import.meta.dirname,'..');
const sha=text=>createHash('sha256').update(text).digest('hex');
const receipt=verifyReleaseArtifacts(root);
const config=JSON.parse(readFileSync(join(root,'dist/server/wrangler.json'),'utf8'));
assert.equal(config.name,'roamie');
assert.deepEqual(config.migrations,[
 {tag:'v1-abuse-guard',new_sqlite_classes:['AbuseGuard']},
 {tag:'v2-visual-crossing-climate',new_sqlite_classes:['VisualCrossingClimate']},
]);
assert.deepEqual(config.durable_objects.bindings,[
 {name:'ABUSE_GUARD',class_name:'AbuseGuard'},
 {name:'VISUAL_CROSSING_CLIMATE',class_name:'VisualCrossingClimate'},
]);
assert.deepEqual(config.vars,{});assert.ok(!config.secrets);
const entry=readFileSync(join(root,'dist/server/index.js'),'utf8');
assert.match(entry,/as AbuseGuard/);assert.match(entry,/as VisualCrossingClimate/);
const hash=sha(JSON.stringify(receipt));
const output=resolve(process.argv[2]??`/tmp/roamie-climate-recovery-${hash.slice(0,12)}`);
assert.ok(!existsSync(output),'Refuse to overwrite an existing recovery snapshot');
assert.ok(!output.startsWith(root+'/'),'Recovery snapshot must be outside working tree');
mkdirSync(join(output,'scripts'),{recursive:true});
cpSync(join(root,'dist'),join(output,'dist'),{recursive:true});
for(const file of ['release-worker-upload.mjs','verify-release-artifacts.mjs']) cpSync(join(root,'scripts',file),join(output,'scripts',file));
for(const file of ['package.json','package-lock.json']) cpSync(join(root,file),join(output,file));
// Local tooling dependency only, never part of dist/assets. Recreate with npm ci when moved.
symlinkSync(join(root,'node_modules'),join(output,'node_modules'),'dir');
assert.deepEqual(verifyReleaseArtifacts(output),receipt);
const manifest={
 schema:1,kind:'compatible-forward-repair',createdAt:new Date().toISOString(),
 baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 uncommittedSourcePatchSha256:sha(execFileSync('git',['diff','--','src'],{cwd:root})),
 receiptSha256:hash,requiredProductionVars:{VISUAL_CROSSING_ENABLED:'false',ABUSE_GUARD_ENFORCEMENT:'true',GOOGLE_GLOBAL_DAILY_UNITS:'100000'},
 migrations:config.migrations,bindings:config.durable_objects.bindings,
 scripts:Object.fromEntries(['release-worker-upload.mjs','verify-release-artifacts.mjs'].map(f=>[f,sha(readFileSync(join(output,'scripts',f)))])),
};
writeFileSync(join(output,'recovery-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(output,'RECOVERY.txt'),`Compatible forward repair; not a pre-migration rollback.\nKeep both DO classes, namespaces, v1/v2 migrations, global-v1 ledger and feature OFF.\nUse the copied safe uploader from this snapshot only AFTER live v2 exists.\nRun node scripts/release-worker-upload.mjs --preflight-only first.\nOnly after explicit approval, use its normal upload flow and separately verified traffic switch.\nDo not run first-migration mode again. Never delete namespaces or reset state.\nIf moved, install the pinned package-lock dependencies (npm ci); node_modules here is a local symlink.\nManifest records uncommitted application source separately from base commit.\n`);
console.log('PASS compatible recovery snapshot:',output);
console.log('Receipt SHA256:',hash);
