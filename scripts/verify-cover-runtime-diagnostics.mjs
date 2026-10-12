import assert from 'node:assert/strict';
import {isDevVerboseLog} from '../src/lib/dev-verbose-log.ts';
import {coverRuntimeRecord,coverSourceType,traceCover} from '../src/lib/saved-trip/cover-runtime-diagnostics.ts';
const context={correlationId:'fixture-render-1',sourceType:'remote'};
for(const url of ['https://user:SECRET@images.unsplash.com/private/path?token=SECRET#PRIVATE','/assets/PRIVATE.png','data:image/png;base64,SECRET','blob:PRIVATE','malformed PRIVATE',null]) {
 const r=coverRuntimeRecord(context,url,'failed','stale_callback',false);
 const text=JSON.stringify(r);assert.ok(!/SECRET|PRIVATE|\/private|token=|user:/.test(text));
 assert.equal(r.isCurrentVersion,false);assert.equal(r.hasUrl,Boolean(url));
 assert.equal(r.hostname,url?.startsWith('https:')?'images.unsplash.com':null);
}
assert.equal(coverSourceType(null),'none');assert.equal(coverSourceType('/default.png'),'bundled');assert.equal(coverSourceType('https://images.unsplash.com/a'),'remote');
const logs=[];const old=console.info;console.info=(...args)=>logs.push(args);
traceCover(undefined,'COVER_IMAGE_LOAD_START','https://images.unsplash.com/a','loading');assert.equal(logs.length,0);
if(!isDevVerboseLog()){traceCover(context,'COVER_SOURCE_SELECTED','https://images.unsplash.com/private?token=SECRET','loading');assert.equal(logs.length,0);}
console.info=old;
console.log('PASS safe record allowlist, hostname only, missing URLs, stale observation, opt-in cover callers; no network');
