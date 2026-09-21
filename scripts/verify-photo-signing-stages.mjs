import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'roamie-photo-stages-'));
async function load(baseline){
 const outfile=path.join(dir,baseline?'old.mjs':'new.mjs');
 await build({entryPoints:['src/services/signed-place-photo.ts'],bundle:true,platform:'node',format:'esm',outfile,loader:{'.png':'dataurl','.jpg':'dataurl'},define:{'import.meta.env.VITE_APP_ORIGIN':'"https://roamie.tw"','import.meta.env.DEV':'false'},plugins:[{name:'controlled-auth',setup(b){
 b.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:'auth',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase={auth:{getSession:async()=>({data:{session:globalThis.photoSession}})}};',loader:'js'}));
 if(baseline)b.onLoad({filter:/[/\\]signed-place-photo\.ts$/},()=>({contents:execFileSync('git',['show','62fb6901:src/services/signed-place-photo.ts'],{encoding:'utf8'}),loader:'ts',resolveDir:path.join(root,'src/services')}));
 }}]});return import(pathToFileURL(outfile));
}
const old=await load(true),current=await load(false);
globalThis.window={location:{origin:'null',href:'capacitor://localhost/index.html'},Capacitor:{isNativePlatform:()=>true}};
globalThis.photoSession={access_token:'fixture-auth-token'};
const nativeFetch=globalThis.fetch;const originalInfo=console.info;const logs=[],allLogs=[];let attempts=[];let behavior='success';
console.info=(tag,record)=>{if(tag==='[PLACE_PHOTO_SIGNING]'){logs.push(record);allLogs.push(record)}};
globalThis.fetch=async(url,init)=>{
 assert.equal(url,'https://roamie.tw/api/place-photo/sign');assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer fixture-auth-token');assert.equal(init.headers['Content-Type'],'application/json');
 const body=JSON.parse(init.body);assert.equal(body.width,480);assert.ok(body.photo.startsWith('places/'));attempts.push(body.photo);
 if(behavior==='network')throw new TypeError('fixture network');
 if(behavior==='timeout')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 if(behavior==='retry'&&attempts.length===1)throw new TypeError('first attempt');
 if(typeof behavior==='number')return new Response('{}',{status:behavior});
 if(behavior==='json')return new Response('{bad',{status:200});
 if(behavior==='shape')return Response.json({unexpected:true});
 if(behavior==='foreign')return Response.json({url:'https://untrusted.example/api/place-photo?photo=fixture&expires=9999999999&signature=fixture'});
 if(behavior==='wrongpath')return Response.json({url:'/api/subscription/sync?photo=fixture&expires=9999999999&signature=fixture'});
 const params=new URLSearchParams({photo:body.photo,w:String(body.width),expires:'9999999999',signature:'fixture-signature'});
 return Response.json({url:'/api/place-photo?'+params});
};
try{
 await assert.rejects(()=>old.getSignedPlacePhotoUrl('places/fixture/photos/old',480),TypeError);
 const resolved=await current.getSignedPlacePhotoUrl('places/fixture/photos/new',480);
 assert.ok(resolved?.startsWith('https://roamie.tw/api/place-photo?'));
 assert.equal(logs.at(-1).httpStatus,200);assert.equal(logs.at(-1).responseShapeValid,true);assert.equal(logs.at(-1).signedUrlReturned,true);assert.equal(logs.at(-1).pageOriginKind,'opaque');assert.equal(logs.at(-1).endpointScheme,'https');assert.equal(logs.at(-1).endpointHost,'roamie.tw');
 const count=attempts.length;await current.getSignedPlacePhotoUrl('places/fixture/photos/new',480);assert.equal(attempts.length,count,'signed cache retains locale-neutral identity');
 for(const mode of [401,403,404,503,'network','json','shape','foreign','wrongpath','retry']){
  behavior=mode;attempts=[];logs.length=0;
  const result=await current.getSignedPlacePhotoUrl('places/fixture/photos/'+mode,480);
  assert.equal(attempts.length,2);
  const last=logs.at(-1);
  if(mode==='retry'){assert.ok(result);assert.equal(last.signedUrlReturned,true)}
  else {assert.equal(result,null);assert.equal(last.fallbackReason,typeof mode==='number'?'http_'+mode:mode==='network'?'fetch_network_rejected':mode==='json'?'response_parse_exception':'invalid_signed_response')}
 }
 behavior='timeout';logs.length=0;assert.equal(await current.getSignedPlacePhotoUrl('places/fixture/photos/timeout',480),null);assert.equal(logs.at(-1).timeout,true);assert.equal(logs.at(-1).abort,true);assert.equal(logs.at(-1).networkReject,false);
 globalThis.photoSession=null;logs.length=0;attempts=[];assert.equal(await current.getSignedPlacePhotoUrl('places/fixture/photos/auth',480),null);assert.equal(attempts.length,0);assert.equal(logs.at(-1).fallbackReason,'auth_session_missing');
 assert.equal(await current.getSignedPlacePhotoUrl('invalid',480),null);assert.equal(logs.at(-1).fallbackReason,'invalid_photo_metadata');
 for(const row of allLogs){const text=JSON.stringify(row);assert.ok(!text.includes('fixture-auth-token')&&!text.includes('fixture-signature')&&!text.includes('/api/place-photo?'))}
 originalInfo('PASS HEAD opaque-origin parser failure reproduced; production endpoint/method/body/bearer contract, parse, retry, HTTP 401/403/404/503, network, timeout/abort, malformed response, missing auth/metadata and safe diagnostics');
}finally{globalThis.fetch=nativeFetch;console.info=originalInfo;delete globalThis.window;delete globalThis.photoSession;}
