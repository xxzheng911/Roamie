import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createExplicitCreateLoading } from '../src/lib/ai/explicit-create-loading.ts';
const events=[];
const loading=createExplicitCreateLoading(id=>events.push(['start',id]),id=>events.push(['stop',id]));
for(const entry of ['plan_ai_button','chat_generate_trip','direct_itinerary_create','confirmed_create']) {
 const finish=loading.begin({explicitCreate:true,generationId:entry});
 assert.deepEqual(events.at(-1),['start',entry]);
 const persistenceFinish=loading.begin({explicitCreate:true,generationId:entry});
 persistenceFinish();assert.deepEqual(events.at(-1),['start',entry]);
 finish();finish();assert.deepEqual(events.at(-1),['stop',entry]);
}
let count=events.length;
for(const preview of [undefined,{}, {explicitCreate:false,generationId:'style_preview'}]) loading.begin(preview)();
assert.equal(events.length,count);
const old=loading.begin({explicitCreate:true,generationId:'old'});
const current=loading.begin({explicitCreate:true,generationId:'new'});
old();assert.deepEqual(events.at(-1),['start','new']);current();assert.deepEqual(events.at(-1),['stop','new']);
for(const outcome of ['success','failure','abort','navigation_complete']) {
 const finish=loading.begin({explicitCreate:true,generationId:outcome});
 try {if(outcome!=='success')throw Error(outcome)}catch{}finally{finish()}
 assert.deepEqual(events.at(-1),['stop',outcome]);
}
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
assert.ok(chat.includes('explicitCreateLoading.begin(creationAuthority)'));
assert.ok(chat.includes('explicitCreateLoading.begin(activeSession.tripCreationAuthority)'));
assert.ok(chat.includes('explicitCreateLoading.begin({ explicitCreate: true, generationId })'));
const branch=chat.slice(chat.indexOf('const renderDestinationReply = async'),chat.indexOf('pushDestinationPlaceRecommendationRef.current ='));
assert.ok(branch.includes('return await renderDestinationReply('));
assert.ok(!branch.includes('return renderDestinationReply('),'loading must await save/navigation');
assert.ok(chat.includes('if (expectedOwner && discoveringLoadingRequestIdRef.current !== expectedOwner) return;'));
console.log('PASS explicit create loading: all entries, nested persistence, stale completion, preview isolation, success/error/abort/navigation cleanup.');
