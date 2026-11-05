#!/usr/bin/env node
/**
 * #TS-PHOTO3 回歸：收藏地點舊 photo name 過期（/api/place-photo 502）→ 以 placeId 呼叫一次 Place Details 換新名稱並寫回。
 * 執行：node scripts/verify-saved-place-photo-refresh.mjs
 *
 * headless Chrome 實際 render（StrictMode）SavedPlaceCoverThumb／PlaceImage／FadeInImage：
 *  - 本機 server：已簽名 /api/place-photo 若 photo 名稱含 "stale" 回 502（模擬 Google 拒絕舊 photo name）；
 *    /fixture-broken* 回 404；其他回 1x1 SVG。
 *  - mock：sign fetch、Place Details（places-gateway，可控回應／延遲並計數）、Supabase（記錄 update payload）、auth-session。
 *  - 不打任何真實 Google／Supabase／正式站。
 * 第 2 輪：收藏封面是 Roamie 預設圖（含 Vite hash 檔名）或空白 → 進入畫面才查一次 Details 並寫回；
 *   使用者上傳／Unsplash／其他真實網址 0 次；真實 IntersectionObserver 驗證畫面外 0 次；同 placeId 多筆各寫回一次；
 *   以專案 Tailwind CSS 比對 HEAD 版與工作區版縮圖版面。Chrome 以 --host-resolver-rules 把外部網域導向本機，不對外連線。
 *   加 --baseline 會把工作區版 SavedPlaceCoverThumb 換成 HEAD 版，用來確認新案例在修正前會失敗；
 *   加 --only-round2 只跑第 2 輪案例（第 1 輪相關檢查會因無資料而 FAIL，屬預期）。
 * 另含靜態檢查：新增程式碼不得出現新 endpoint／Realtime channel／Auth/Plus/Credits 相關呼叫。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log(
      "FAIL " +
        name +
        "\n     " +
        (e?.stack || e).toString().split("\n").slice(0, 4).join("\n     "),
    );
  }
};

// ---------------------------------------------------------------- S. 靜態檢查（需求 4）
const REVIEWED = [
  "src/lib/saved-place-photo-refresh.ts",
  "src/lib/places-storage.ts",
  "src/components/media/FadeInImage.tsx",
  "src/components/media/PlaceImage.tsx",
  "src/components/saved/SavedPlaceCoverThumb.tsx",
];
const addedLines = (file) => {
  const tracked = execFileSync("git", ["ls-files", "--", file], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!tracked) return fs.readFileSync(path.join(root, file), "utf8").split("\n");
  return execFileSync("git", ["diff", "HEAD", "--", file], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
};
await check("S1 新增程式碼無新 endpoint／fetch／Realtime channel／Auth 寫入／Plus／Credits", () => {
  for (const f of REVIEWED) {
    const code = addedLines(f)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(
      code,
      /\bfetch\s*\(|\.channel\s*\(|realtime|\.rpc\s*\(|functions\.invoke/i,
      f + " 出現新的網路／Realtime 呼叫",
    );
    // 注意：不可用 /signIn/i（會誤中 FadeInImage 的 "signing" 狀態）
    assert.doesNotMatch(
      code,
      /credit|\bplus\b|entitlement|subscription|auth\.update/i,
      f + " 觸及 Auth/Plus/Credits",
    );
    assert.doesNotMatch(
      code,
      /\bsignIn\w*\(|\bsignOut\(|auth\.(signIn|signOut|updateUser|setSession)/,
      f + " 觸及 Auth 寫入",
    );
    const apis = [...code.matchAll(/["'`](\/api\/[^"'`?]*)/g)].map((m) => m[1]);
    assert.ok(
      apis.every((a) => a === "/api/place-photo"),
      f + " 新 endpoint：" + apis,
    );
  }
});
await check(
  "S2 Details 走既有 getPlaceDetailsServerFnViaGateway（與 placeImageService 相同呼叫種類）；寫回只 update saved_places",
  () => {
    const refresh = fs.readFileSync(path.join(root, REVIEWED[0]), "utf8");
    assert.match(refresh, /getPlaceDetailsServerFnViaGateway\(\{\s*data:\s*\{\s*placeId:/);
    const svc = fs.readFileSync(path.join(root, "src/services/placeImageService.ts"), "utf8");
    assert.match(svc, /getPlaceDetailsServerFnViaGateway\(\{/, "既有呼叫點仍存在（非新種類）");
    const patchFn =
      fs
        .readFileSync(path.join(root, REVIEWED[1]), "utf8")
        .match(/export async function patchSavedPlaceImage[\s\S]*?\n}\n/)?.[0] ?? "";
    assert.ok(patchFn, "找不到 patchSavedPlaceImage");
    assert.deepEqual(
      [...patchFn.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]),
      ["saved_places"],
    );
    assert.match(patchFn, /\.update\(/);
    assert.doesNotMatch(
      patchFn,
      /\.insert\(|\.upsert\(|\.delete\(|SAVED_PLACES_CHANGED_EVENT|emitSavedPlacesChanged/,
    );
  },
);

// ---------------------------------------------------------------- A. headless Chrome
const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-ts-photo3-"));
const authSessionStub = `
export const isAuthSessionMissingError=()=>false;export const invalidateClientAuthSessionCache=()=>{};
export const markClientAuthSessionSettledUnauthenticated=()=>{};export const updateClientAuthSessionCache=()=>{};
export const getClientAuthSession=async()=>({user:{id:'u1'},access_token:'fixture'});
export const readCachedAuthenticatedUserIdSync=()=>'u1';export const getAuthenticatedUserId=async()=>'u1';
export const requireAuthenticatedUserId=async()=>'u1';export const requireAuthenticatedUser=async()=>({id:'u1'});
export const isDataUrl=u=>typeof u==='string'&&u.startsWith('data:');export const isHttpUrl=u=>typeof u==='string'&&/^https?:/.test(u);`;
const supabaseStub = `
const mk=(table)=>{const st={table,op:null,payload:null,eq:[]};const q={
 update(p){st.op='update';st.payload=p;return q},select(){if(!st.op)st.op='select';return q},order(){return q},
 insert(){st.op='insert';return q},upsert(){st.op='upsert';return q},delete(){st.op='delete';return q},
 eq(k,v){st.eq.push([k,v]);return q},
 then(res,rej){let out;window.dbOps.push(st.table+':'+st.op);
  if(st.op==='update'){window.updates.push(JSON.parse(JSON.stringify(st)));out={data:null,error:window.updateError?{message:window.updateError}:null}}
  else if(st.op==='select'){window.selectCalls++;out={data:JSON.parse(JSON.stringify(window.listRows||[])),error:null}}
  else out={data:null,error:{message:'unexpected '+st.op}};
  return Promise.resolve(out).then(res,rej)}};return q};
export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'u1'},access_token:'fixture'}}}),getUser:async()=>({data:{user:{id:'u1'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 from:mk,channel:()=>{window.channels++;throw Error('unexpected channel')}};
export const isSupabaseConfigured=()=>true;`;
const gatewayStub = `
export const getPlaceDetailsServerFnViaGateway=async({data})=>{window.detailsCalls.push(data.placeId);
 const plan=window.detailsPlan[data.placeId]||{kind:'throw'};
 if(plan.manual)await new Promise(r=>window.detailsPending.set(data.placeId,r));
 if(plan.kind==='throw')throw new TypeError('fixture details failure');
 if(plan.kind==='none')return {place:{id:data.placeId,photoName:null},error:null};
 return {place:{id:data.placeId,photoName:plan.name},error:null};};`;
const mocks = {
  "@/integrations/supabase/client": supabaseStub,
  "@/lib/auth-session": authSessionStub,
  "@/lib/api-url": `export const resolveApiUrl=url=>new URL(url,window.location.origin).href;`,
  "@/lib/pie/places-gateway": gatewayStub,
  "@/services/unsplashService": `export const searchUnsplashImage=async()=>null;export const searchUnsplashWithQueries=async()=>null;export const searchUnsplashCoverQueries=async()=>null;`,
  "@/lib/google-maps-client": `export const buildPlacePhotoUrl=(photo,w)=>'/api/place-photo?photo='+encodeURIComponent(photo)+'&w='+w;`,
  "@/lib/app-perf": `export const logPerfImageLoad=()=>{};export const logPerfProfileLoadSkip=()=>{};export const logPerfTravelPrefLoadSkip=()=>{};`,
  // 第 2 輪：不再 mock useInViewport，改用真實 IntersectionObserver，才能驗證「沒進入畫面 0 次」。
};
// 收藏頁列（src/routes/_app.saved.index.tsx L548-L568）實際使用的 class，供 Tailwind in-memory 編譯（版面比對用）。
const LAYOUT_CLASSES =
  "mt-6 space-y-3 flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-soft " +
  "min-w-0 flex-1 text-left h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-secondary truncate text-[15px] " +
  "font-medium mt-0.5 text-xs text-muted-foreground relative h-full w-full absolute inset-0 animate-pulse " +
  "bg-secondary/80 object-cover transition-opacity duration-300 opacity-100 opacity-0";
let tailwindCss = "";
await check("L0 以專案 src/styles.css 在記憶體中編譯 Tailwind（版面比對用，不寫檔）", async () => {
  const { compile } = await import("@tailwindcss/node");
  const compiler = await compile(fs.readFileSync(path.join(root, "src/styles.css"), "utf8"), {
    base: path.join(root, "src"),
    onDependency: () => {},
  });
  tailwindCss = compiler.build(LAYOUT_CLASSES.split(/\s+/));
  for (const c of ["h-16", "w-16", "rounded-2xl", "overflow-hidden", "h-full", "shrink-0"])
    assert.match(tailwindCss, new RegExp("\\." + c + "\\b"), "缺少 ." + c);
});
const entry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';
import {SavedPlaceCoverThumb} from './src/components/saved/SavedPlaceCoverThumb';
import {PlaceImage} from './src/components/media/PlaceImage';
import {FadeInImage} from './src/components/media/FadeInImage';
import {listPlaces} from './src/lib/places-storage';
import {getRoamieDefaultImage} from './src/services/placeImageService';
import {SavedPlaceCoverThumb as HeadSavedPlaceCoverThumb} from 'virtual:head-thumb';
Object.assign(window,{detailsCalls:[],detailsPlan:{},detailsPending:new Map(),updates:[],updateError:null,selectCalls:0,dbOps:[],channels:0,signCalls:[],warns:[]});
const errors=[];window.addEventListener('unhandledrejection',e=>{errors.push(String(e.reason));e.preventDefault()});
window.renderErrors=[];window.addEventListener('error',e=>{window.renderErrors.push(String(e.error?.stack||e.message).slice(0,400))});
const ow=console.warn;console.warn=(...a)=>{try{window.warns.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '))}catch{}return ow.apply(console,a)};
const failSign=new Set();
window.fetch=async(url,init)=>{url=String(url);if(!url.includes('/api/place-photo/sign'))throw Error('Unexpected request '+url);
 const body=JSON.parse(init.body);window.signCalls.push(body.photo+'@'+body.width);
 if(failSign.has(body.photo))return {ok:false,status:503,headers:new Headers(),json:async()=>({})};
 return {ok:true,status:200,headers:new Headers(),json:async()=>({url:'/api/place-photo?photo='+encodeURIComponent(body.photo)+'&w='+body.width+'&expires=9999999999&signature=fixture'})};};
const rootEl=createRoot(document.getElementById('root'));
const tick=()=>new Promise(r=>setTimeout(r,20));
const until=async(fn,msg)=>{for(let i=0;i<250;i++){if(fn())return;await tick();}throw Error('timeout: '+(typeof msg==='function'?msg():msg));};
const settle=async(n=10)=>{for(let i=0;i<n;i++)await tick();};
const ph=(id,v)=>'places/ChIJ_ph3_'+id+'/photos/'+v;
const unsignedUrl=(name,w=600)=>'/api/place-photo?photo='+encodeURIComponent(name)+'&w='+w;
const signedUrl=(name,w)=>unsignedUrl(name,w)+'&expires=9999999999&signature=fixture';
const imgSrc=c=>document.querySelector('[data-c="'+c+'"] img')?.getAttribute('src')??null;
const imgLoaded=c=>{const i=document.querySelector('[data-c="'+c+'"] img');return Boolean(i&&i.complete&&i.naturalWidth>0)};
const showsPhoto=(c,name)=>{const s=imgSrc(c);return Boolean(s&&s.includes(encodeURIComponent(name))&&s.includes('signature='))&&imgLoaded(c)};
const showsDefault=c=>{const s=imgSrc(c);return Boolean(s&&!s.includes('/api/place-photo'))&&imgLoaded(c)};
const det=id=>window.detailsCalls.filter(x=>x==='ChIJ_ph3_'+id).length;
let seq=0;
const mount=(items)=>rootEl.render(<StrictMode>{items.map(([c,el])=><div key={c+':'+(++seq)} data-c={c} style={{width:64,height:64}}>{el}</div>)}</StrictMode>);
const row=(id,meta,extra={})=>({id:'row_'+id,name:'Place '+id,category:'cafe',address:null,city:null,lat:null,lng:null,notes:null,mood_tag:null,cover_image:null,image_url:null,image_source:'google',created_at:'2026-11-0'+(1+(id.length%8))+'T00:00:00Z',metadata:meta,...extra});
const thumb=p=><SavedPlaceCoverThumb place={p}/>;
const readLocal=()=>{try{return JSON.parse(localStorage.getItem('roamie:places:u1')).payload}catch{return null}};
window.run=async()=>{const out={};
 if(!__ONLY_ROUND2__){
 // ---- N：一般渲染／重新掛載／重繪（捲動）不呼叫 Details
 const n=['n1','n2','n3'].map(id=>row(id,{googlePlaceId:'ChIJ_ph3_'+id,photoName:ph(id,'ok')}));
 mount(n.map(p=>[p.id,thumb(p)]));
 await until(()=>n.every(p=>showsPhoto(p.id,ph(p.id.slice(4),'ok'))),'N loaded');
 for(let k=0;k<3;k++){mount(n.map(p=>[p.id,thumb(p)]));await until(()=>n.every(p=>showsPhoto(p.id,ph(p.id.slice(4),'ok'))),'N remount');}
 rootEl.render(<StrictMode>{n.map(p=><div key={'scroll'+p.id} data-c={p.id}>{thumb({...p})}</div>)}</StrictMode>);await settle(5);
 rootEl.render(<StrictMode>{n.map(p=><div key={'scroll'+p.id} data-c={p.id}>{thumb({...p})}</div>)}</StrictMode>);await settle(5);
 out.n={details:window.detailsCalls.length,updates:window.updates.length};

 // ---- S：舊名稱 502 → Details 一次 → 新名稱顯示＋寫回（cover_image 為 Google、image_url 為使用者上傳）
 const s1=row('s1',{googlePlaceId:'ChIJ_ph3_s1',photoName:ph('s1','stale'),rating:4.5,note:'keep',nested:{a:1}},{cover_image:unsignedUrl(ph('s1','stale')),image_url:'/fixture-user-upload.png'});
 // S2：metadata 無 photoName，photo 來自 image_url（Google），cover_image 為非 Google
 const s2=row('s2',{placeId:'ChIJ_ph3_s2',source:'chat'},{cover_image:'/fixture-user-cover.png',image_url:'https://roamie.tw'+unsignedUrl(ph('s2','stale'),400)});
 const other=row('o1',{googlePlaceId:'ChIJ_ph3_o1',photoName:ph('o1','ok')});
 window.listRows=[s1,s2,other];await listPlaces();const selectBefore=window.selectCalls;
 window.detailsPlan['ChIJ_ph3_s1']={kind:'fresh',name:ph('s1','fresh')};
 window.detailsPlan['ChIJ_ph3_s2']={kind:'fresh',name:ph('s2','fresh')};
 const u0=window.updates.length;
 mount([['s1',thumb(s1)],['s2',thumb(s2)]]);
 await until(()=>showsPhoto('s1',ph('s1','fresh'))&&showsPhoto('s2',ph('s2','fresh')),'S fresh shown');
 await until(()=>window.updates.length>=u0+2,'S updates');await settle(5);
 out.s={details1:det('s1'),details2:det('s2'),updates:window.updates.slice(u0),signs:window.signCalls.filter(x=>x.includes('_s1/')||x.includes('_s2/'))};
 // 重新掛載（仍以舊的 place 物件）→ 直接新名稱、不再呼叫
 mount([['s1',thumb(s1)],['s2',thumb(s2)]]);
 await until(()=>showsPhoto('s1',ph('s1','fresh'))&&showsPhoto('s2',ph('s2','fresh')),'S remount fresh');
 await settle(5);
 out.sRemount={details1:det('s1'),details2:det('s2'),updates:window.updates.length-u0};
 const listed=await listPlaces();
 out.sList={selectDelta:window.selectCalls-selectBefore,rows:listed};
 out.sLocal=readLocal();

 // ---- C：同 placeId 兩筆同時失敗（Details 回應延遲）→ 只呼叫一次
 const c1=row('c1a',{googlePlaceId:'ChIJ_ph3_c1',photoName:ph('c1','stale')},{cover_image:unsignedUrl(ph('c1','stale'))});
 const c2=row('c1b',{googlePlaceId:'ChIJ_ph3_c1',photoName:ph('c1','stale')},{cover_image:unsignedUrl(ph('c1','stale'))});
 window.detailsPlan['ChIJ_ph3_c1']={kind:'fresh',name:ph('c1','fresh'),manual:true};
 const uc=window.updates.length;
 mount([['c1a',thumb(c1)],['c1b',thumb(c2)],['c1x',thumb(c1)]]);
 await until(()=>window.detailsPending.has('ChIJ_ph3_c1')&&showsDefault('c1a')&&showsDefault('c1b')&&showsDefault('c1x'),'C all failed, details pending');
 await settle(10);
 out.cPending={details:det('c1')};
 window.detailsPending.get('ChIJ_ph3_c1')();
 await until(()=>showsPhoto('c1a',ph('c1','fresh'))&&showsPhoto('c1b',ph('c1','fresh'))&&showsPhoto('c1x',ph('c1','fresh')),'C fresh');
 await settle(5);
 out.c={details:det('c1'),updatedIds:window.updates.slice(uc).map(u=>u.eq.find(e=>e[0]==='id')?.[1])};

 // ---- F／E／D／L：Details 失敗、無名稱、同名、新名稱也 502 → 只呼叫一次，不重試
 const mk=(id,plan)=>{window.detailsPlan['ChIJ_ph3_'+id]=plan;return row(id,{googlePlaceId:'ChIJ_ph3_'+id,photoName:ph(id,'stale')},{cover_image:unsignedUrl(ph(id,'stale'))});};
 const f=mk('f1',{kind:'throw'}),e=mk('e1',{kind:'none'}),d=mk('d1',{kind:'fresh',name:ph('d1','stale')}),l=mk('l1',{kind:'fresh',name:ph('l1','stale-again')});
 const ue=window.updates.length;const wf=window.warns.length;
 const neg=[['f1',thumb(f)],['e1',thumb(e)],['d1',thumb(d)],['l1',thumb(l)]];
 mount(neg);
 await until(()=>['f1','e1','d1'].every(c=>showsDefault(c))&&det('f1')&&det('e1')&&det('d1')&&det('l1'),'neg first round');
 await until(()=>window.signCalls.some(x=>x.startsWith(ph('l1','stale-again'))),'L signed new name');
 await until(()=>showsDefault('l1'),'L default');await settle(10);
 for(let k=0;k<3;k++){mount(neg);await settle(8);}
 out.neg={f:det('f1'),e:det('e1'),d:det('d1'),l:det('l1'),fDefault:showsDefault('f1'),eDefault:showsDefault('e1'),dDefault:showsDefault('d1'),lDefault:showsDefault('l1'),
  updatedIds:window.updates.slice(ue).map(u=>u.eq.find(x=>x[0]==='id')?.[1]),warns:window.warns.slice(wf)};

 // ---- W：寫回失敗 → 仍顯示新圖、console.warn、本機快照不變
 window.updateError='fixture write failed';
 const w=mk('w1',{kind:'fresh',name:ph('w1','fresh')});
 window.listRows=[w];localStorage.removeItem('roamie:places:u1');
 const ww=window.warns.length;
 mount([['w1',thumb(w)]]);
 await until(()=>showsPhoto('w1',ph('w1','fresh')),'W fresh');
 await until(()=>window.warns.slice(ww).some(x=>x.includes('persist failed')),'W warn');
 window.updateError=null;
 out.w={details:det('w1'),warns:window.warns.slice(ww),local:readLocal()};

 // ---- P：無 placeId；G：簽名失敗；U：非 Google 上傳圖失敗 → 皆不呼叫 Details
 const p=row('p1',{photoName:ph('p1','stale')},{cover_image:unsignedUrl(ph('p1','stale'))});
 failSign.add(ph('g1','x'));
 const g=row('g1',{googlePlaceId:'ChIJ_ph3_g1',photoName:ph('g1','x')});
 const u=row('u1',{googlePlaceId:'ChIJ_ph3_u1'},{cover_image:'/fixture-broken-upload.png'});
 const before=window.detailsCalls.length;
 mount([['p1',thumb(p)],['g1',thumb(g)],['u1',thumb(u)]]);
 await until(()=>showsDefault('p1')&&showsDefault('g1')&&showsDefault('u1'),'PGU default');await settle(10);
 out.pgu={details:window.detailsCalls.length-before,signs:window.signCalls.filter(x=>x.includes('_g1/'))};

 // ---- X：其他畫面（未傳 onImageError／onSourceError）行為不變、不呼叫 Details
 const spy=[];const before2=window.detailsCalls.length;
 mount([
  ['x1',<PlaceImage placeId="ChIJ_ph3_x1" photoName={ph('x1','stale')} name="x1" category="cafe" photoWidth={256} lazy={false}/>],
  ['x2',<FadeInImage src={signedUrl(ph('x2','stale'),600)} fallbackSrc="/fixture-default.png"/>],
  ['x3',<FadeInImage src={signedUrl(ph('x3','stale'),600)} fallbackSrc="/fixture-default.png" onSourceError={s=>spy.push(['x3',s])}/>],
  ['x4',<FadeInImage src={signedUrl(ph('x4','ok'),600)} fallbackSrc="/fixture-default.png" onSourceError={s=>spy.push(['x4',s])}/>],
  ['x5',<FadeInImage src={signedUrl(ph('x5','stale'),600)} fallbackSrc="/fixture-broken-default.png" onSourceError={s=>spy.push(['x5',s])}/>],
 ]);
 await until(()=>showsDefault('x1')&&imgSrc('x2')==='/fixture-default.png'&&imgLoaded('x2')&&imgSrc('x3')==='/fixture-default.png'&&showsPhoto('x4',ph('x4','ok'))&&imgSrc('x5')==='/fixture-broken-default.png','X settled');
 await settle(15);
 out.x={details:window.detailsCalls.length-before2,spy,x5:imgSrc('x5')};
 }

 // ===== 第 2 輪：收藏封面是 Roamie 預設圖／空白 =====
 const updFor=(from,id)=>window.updates.slice(from).filter(u=>u.eq.some(e=>e[0]==='id'&&e[1]===id));
 const fresh=id=>{window.detailsPlan['ChIJ_ph3_'+id]={kind:'fresh',name:ph(id,'fresh')};};
 const DEF_CAFE=getRoamieDefaultImage('cafe'),DEF_ANY=getRoamieDefaultImage(null);
 // ---- D：預設圖（Vite hash 檔名／開發路徑／實際 import 值）或空白 → 進入畫面查 Details 一次、顯示並寫回
 const dRows=[
  row('dc1',{googlePlaceId:'ChIJ_ph3_dc1'},{cover_image:'/assets/scene-cafe-AbC123.jpg'}),
  row('dc2',{placeId:'ChIJ_ph3_dc2',source:'chat'},{cover_image:'https://roamie.tw/assets/roamie-default-cover-x_Y-9z.png',image_url:'/src/assets/scene-tokyo.jpg'}),
  row('dc3',{googlePlaceId:'ChIJ_ph3_dc3'}),
  row('dc4',{googlePlaceId:'ChIJ_ph3_dc4'},{cover_image:DEF_CAFE,image_url:DEF_ANY}),
  {...row('dc5',{googlePlaceId:'ChIJ_ph3_dc5',source:'chat'},{cover_image:'/src/assets/scene-cafe.jpg'}),name:'Harbs 澀谷Hikarie ShinQs店'},
 ];
 dRows.forEach(p=>fresh(p.id.slice(4)));
 const ud=window.updates.length;
 mount(dRows.map(p=>[p.id,thumb(p)]));
 await until(()=>dRows.every(p=>showsPhoto(p.id,ph(p.id.slice(4),'fresh'))),()=>'D fresh shown '+JSON.stringify(dRows.map(p=>[p.id,det(p.id.slice(4)),(imgSrc(p.id)||'').slice(0,90),imgLoaded(p.id)])));
 await until(()=>window.updates.length>=ud+dRows.length,'D updates');await settle(5);
 const dFirst={details:dRows.map(p=>det(p.id.slice(4))),updates:dRows.map(p=>updFor(ud,p.id).map(u=>u.payload))};
 for(let k=0;k<3;k++){mount(dRows.map(p=>[p.id,thumb({...p})]));await settle(6);}
 rootEl.render(<StrictMode>{dRows.map(p=><div key={'dre'+p.id} data-c={p.id} style={{width:64,height:64}}>{thumb({...p})}</div>)}</StrictMode>);await settle(4);
 rootEl.render(<StrictMode>{dRows.map(p=><div key={'dre'+p.id} data-c={p.id} style={{width:64,height:64}}>{thumb({...p})}</div>)}</StrictMode>);await settle(4);
 out.d={first:dFirst,afterRemount:{details:dRows.map(p=>det(p.id.slice(4))),updates:dRows.map(p=>updFor(ud,p.id).length)},defaults:{DEF_CAFE:DEF_CAFE.slice(0,30),DEF_ANY:DEF_ANY.slice(0,30)}};

 // ---- DN：預設圖但 Details 無照片／失敗 → 每次執行只查 1 次、不寫回、維持預設圖
 window.detailsPlan['ChIJ_ph3_dn1']={kind:'none'};window.detailsPlan['ChIJ_ph3_dn2']={kind:'throw'};
 const dn=[row('dn1',{googlePlaceId:'ChIJ_ph3_dn1'},{cover_image:'/assets/scene-onsen-Q1w2E3.jpg'}),row('dn2',{googlePlaceId:'ChIJ_ph3_dn2'})];
 const udn=window.updates.length;
 mount(dn.map(p=>[p.id,thumb(p)]));
 await until(()=>det('dn1')&&det('dn2')&&dn.every(p=>showsDefault(p.id)),'DN settled');await settle(10);
 for(let k=0;k<3;k++){mount(dn.map(p=>[p.id,thumb({...p})]));await settle(8);}
 out.dn={details:[det('dn1'),det('dn2')],updates:window.updates.length-udn,defaults:dn.map(p=>showsDefault(p.id))};

 // ---- R：使用者上傳（Supabase storage）、Unsplash、其他真實網址、預設圖＋上傳混合 → 0 次 Details、0 次寫回
 const rRows=[
  row('r1',{googlePlaceId:'ChIJ_ph3_r1'},{cover_image:'https://abcd.supabase.co/storage/v1/object/public/place-images/u1/r1.jpg',image_source:'upload'}),
  row('r2',{googlePlaceId:'ChIJ_ph3_r2'},{image_url:'https://images.unsplash.com/photo-1501339847302-ac426a4a87c8?w=600',image_source:'unsplash'}),
  row('r3',{googlePlaceId:'ChIJ_ph3_r3'},{cover_image:'https://example.com/photos/r3.jpg',image_source:'web'}),
  row('r4',{googlePlaceId:'ChIJ_ph3_r4'},{cover_image:'/assets/scene-cafe-AbC123.jpg',image_url:'https://abcd.supabase.co/storage/v1/object/public/place-images/u1/r4.jpg'}),
  row('r5',{googlePlaceId:'ChIJ_ph3_r5'},{cover_image:'/fixture-user-cover.png',image_source:'upload'}),
 ];
 rRows.forEach(p=>fresh(p.id.slice(4)));
 const ur=window.updates.length,br=window.detailsCalls.length;
 mount(rRows.map(p=>[p.id,thumb(p)]));
 await until(()=>rRows.every(p=>imgSrc(p.id)&&imgLoaded(p.id)),'R settled');await settle(20);
 for(let k=0;k<2;k++){mount(rRows.map(p=>[p.id,thumb({...p})]));await settle(10);}
 out.r={details:window.detailsCalls.length-br,updates:window.updates.length-ur,srcs:rRows.map(p=>imgSrc(p.id))};
 // （資訊）第三方網址路徑剛好長得像 Roamie 資產
 fresh('r6');const r6=row('r6',{googlePlaceId:'ChIJ_ph3_r6'},{cover_image:'https://cdn.example.com/assets/scene-cafe-hero.jpg'});
 const b6=window.detailsCalls.length;mount([['r6',thumb(r6)]]);await settle(25);
 out.r6={details:window.detailsCalls.length-b6};

 // ---- V：沒進入畫面 0 次；捲進畫面才查 1 次；捲出再捲入、重繪不重查（真實 IntersectionObserver）
 fresh('v1');const v1=row('v1',{googlePlaceId:'ChIJ_ph3_v1'},{cover_image:'/assets/scene-walk-Zz9_8.jpg'});
 window.scrollTo(0,0);
 const vTree=p=><StrictMode><div style={{height:4000}}/><div key="v" data-c="v1" style={{width:64,height:64}}>{thumb(p)}</div><div style={{height:2000}}/></StrictMode>;
 rootEl.render(vTree(v1));await settle(25);
 const vBefore=det('v1');
 rootEl.render(vTree({...v1}));await settle(10);
 const vBeforeRerender=det('v1');
 document.querySelector('[data-c="v1"]').scrollIntoView({block:'center'});
 await until(()=>showsPhoto('v1',ph('v1','fresh')),'V fresh after scroll');
 window.scrollTo(0,0);await settle(5);document.querySelector('[data-c="v1"]').scrollIntoView({block:'center'});await settle(5);
 rootEl.render(vTree({...v1}));await settle(10);
 out.v={before:vBefore,beforeRerender:vBeforeRerender,after:det('v1'),updates:updFor(0,'row_v1').length};
 window.scrollTo(0,0);

 // ---- Q1：同 placeId 兩筆收藏（皆預設圖）同時進入畫面、Details 延遲 → 1 次；兩筆各寫回一次
 const q1a=row('q1a',{googlePlaceId:'ChIJ_ph3_q1'},{cover_image:'/assets/scene-cafe-AbC123.jpg'});
 const q1b=row('q1b',{googlePlaceId:'ChIJ_ph3_q1'});
 window.detailsPlan['ChIJ_ph3_q1']={kind:'fresh',name:ph('q1','fresh'),manual:true};
 const uq1=window.updates.length;
 mount([['q1a',thumb(q1a)],['q1b',thumb(q1b)],['q1x',thumb({...q1a})]]);
 await until(()=>window.detailsPending.has('ChIJ_ph3_q1'),'Q1 pending');await settle(10);
 const q1Pending=det('q1');
 window.detailsPending.get('ChIJ_ph3_q1')();
 await until(()=>['q1a','q1b','q1x'].every(c=>showsPhoto(c,ph('q1','fresh'))),'Q1 fresh');await settle(8);
 out.q1={pending:q1Pending,details:det('q1'),a:updFor(uq1,'row_q1a').length,b:updFor(uq1,'row_q1b').length};

 // ---- Q2：同 placeId 兩筆收藏（皆預設圖），第二筆在第一筆換新「之後」才進入畫面（例如捲動到下方）
 fresh('q2');
 const q2a=row('q2a',{googlePlaceId:'ChIJ_ph3_q2'},{cover_image:'/assets/scene-cafe-AbC123.jpg'});
 const q2b=row('q2b',{googlePlaceId:'ChIJ_ph3_q2'},{cover_image:'/assets/scene-cafe-AbC123.jpg'});
 const uq2=window.updates.length;
 mount([['q2a',thumb(q2a)]]);
 await until(()=>showsPhoto('q2a',ph('q2','fresh'))&&updFor(uq2,'row_q2a').length===1,'Q2a refreshed');
 mount([['q2a',thumb(q2a)],['q2b',thumb(q2b)]]);
 await until(()=>showsPhoto('q2b',ph('q2','fresh')),'Q2b shows fresh');await settle(20);
 out.q2={details:det('q2'),a:updFor(uq2,'row_q2a').length,b:updFor(uq2,'row_q2b').length};

 // ---- Q3：同上，舊名稱過期（502）路徑
 fresh('q3');
 const q3a=row('q3a',{googlePlaceId:'ChIJ_ph3_q3',photoName:ph('q3','stale')},{cover_image:unsignedUrl(ph('q3','stale'))});
 const q3b=row('q3b',{googlePlaceId:'ChIJ_ph3_q3',photoName:ph('q3','stale')},{cover_image:unsignedUrl(ph('q3','stale'))});
 const uq3=window.updates.length;
 mount([['q3a',thumb(q3a)]]);
 await until(()=>showsPhoto('q3a',ph('q3','fresh'))&&updFor(uq3,'row_q3a').length===1,'Q3a refreshed');
 mount([['q3a',thumb(q3a)],['q3b',thumb(q3b)]]);
 await until(()=>showsPhoto('q3b',ph('q3','fresh')),'Q3b shows fresh');await settle(20);
 out.q3={details:det('q3'),a:updFor(uq3,'row_q3a').length,b:updFor(uq3,'row_q3b').length};

 // ---- Z（第 3 輪，tester 補）：同 placeId 已換新後，「只寫回」effect 對各種 row 的行為
 fresh('z1');
 const z1a=row('z1a',{googlePlaceId:'ChIJ_ph3_z1'},{cover_image:'/assets/scene-cafe-AbC123.jpg'});
 const uz=window.updates.length;
 mount([['z1a',thumb(z1a)]]);
 await until(()=>showsPhoto('z1a',ph('z1','fresh'))&&updFor(uz,'row_z1a').length===1,'Z1a refreshed');
 const zRows=[
  // 已是新名稱 → 不寫
  row('z1new',{googlePlaceId:'ChIJ_ph3_z1',photoName:ph('z1','fresh')},{cover_image:unsignedUrl(ph('z1','fresh'))}),
  // 使用者上傳、無 photoName → 不寫
  row('z1up',{googlePlaceId:'ChIJ_ph3_z1'},{cover_image:'/fixture-user-cover.png',image_source:'upload'}),
  // 第三方真實網址、無 photoName → 不寫
  row('z1ext',{googlePlaceId:'ChIJ_ph3_z1'},{cover_image:'https://example.com/photos/z1.jpg',image_source:'web'}),
  // 上傳圖＋metadata 有另一個（仍有效）Google 名稱 → 寫一次，但上傳圖欄位不得被改
  row('z1upm',{googlePlaceId:'ChIJ_ph3_z1',photoName:ph('z1','other')},{cover_image:'/fixture-user-cover.png',image_url:'https://abcd.supabase.co/storage/v1/object/public/place-images/u1/z.jpg',image_source:'upload'}),
  // 工程師提出的風險：存的是另一個仍有效的 Google 名稱 → 會被改寫（記錄行為）
  row('z1oth',{googlePlaceId:'ChIJ_ph3_z1',photoName:ph('z1','other')},{cover_image:unsignedUrl(ph('z1','other'))}),
  // 預設圖（沒查過 Details 的另一筆）→ 寫一次
  row('z1def',{googlePlaceId:'ChIJ_ph3_z1'},{cover_image:'/assets/scene-onsen-Q1w2E3.jpg'}),
 ];
 const uz2=window.updates.length;
 mount(zRows.map(p=>[p.id,thumb(p)]));await settle(20);
 const zFirst=zRows.map(p=>updFor(uz2,p.id).length);
 const zUpSrc=imgSrc('z1up'),zExtSrc=imgSrc('z1ext');
 const zPayload=Object.fromEntries(zRows.map(p=>[p.id,updFor(uz2,p.id)[0]?.payload??null]));
 // 重新掛載 3 次（新物件 identity）＋同 key 重繪 2 次 → 不得重複寫回
 for(let k=0;k<3;k++){mount(zRows.map(p=>[p.id,thumb({...p,metadata:{...p.metadata}})]));await settle(8);}
 for(let k=0;k<2;k++){rootEl.render(<StrictMode>{zRows.map(p=><div key={'zre'+p.id} data-c={p.id} style={{width:64,height:64}}>{thumb({...p})}</div>)}</StrictMode>);await settle(6);}
 // 寫回後 listPlaces 回來的新 row 再掛一次 → 不得再寫
 const zPatched=zRows.map(p=>zPayload[p.id]?{...p,...zPayload[p.id]}:p);
 mount(zPatched.map(p=>[p.id,thumb(p)]));await settle(10);
 out.z={details:det('z1'),first:zFirst,after:zRows.map(p=>updFor(uz2,p.id).length),payload:zPayload,upSrc:zUpSrc,extSrc:zExtSrc,ids:zRows.map(p=>p.id)};

 // ---- Z2：Details 失敗的 placeId，另一筆存的是其他名稱 → 沒有換新名稱可沿用，不得寫回
 window.detailsPlan['ChIJ_ph3_z2']={kind:'throw'};
 const z2a=row('z2a',{googlePlaceId:'ChIJ_ph3_z2'},{cover_image:'/assets/scene-cafe-AbC123.jpg'});
 const z2b=row('z2b',{googlePlaceId:'ChIJ_ph3_z2',photoName:ph('z2','other')},{cover_image:unsignedUrl(ph('z2','other'))});
 const uz3=window.updates.length;
 mount([['z2a',thumb(z2a)]]);await until(()=>det('z2')===1&&showsDefault('z2a'),'Z2a failed');await settle(5);
 mount([['z2a',thumb(z2a)],['z2b',thumb(z2b)]]);await settle(15);
 out.z2={details:det('z2'),updates:window.updates.length-uz3};

 // ---- L：版面比對（HEAD 版 vs 工作區版，同一個收藏頁列結構＋專案 Tailwind CSS）
 const lp1=row('lay1',{googlePlaceId:'ChIJ_ph3_lay1',photoName:ph('lay1','ok')});
 const lp2=row('lay2',{googlePlaceId:'ChIJ_ph3_lay2'},{cover_image:'/fixture-broken-upload.png',image_source:'upload'});
 const LRow=({Thumb,p,c})=><li data-c={c} className="flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-soft">
  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left">
   <Thumb place={p} className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-secondary" alt={p.name}/>
   <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-medium">{p.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">Some address</p></div>
  </button><div style={{width:36,height:76,flexShrink:0}}/></li>;
 rootEl.render(<StrictMode><ul className="mt-6 space-y-3" style={{width:390}}>
  <LRow Thumb={HeadSavedPlaceCoverThumb} p={lp1} c="lo1"/><LRow Thumb={SavedPlaceCoverThumb} p={lp1} c="ln1"/>
  <LRow Thumb={HeadSavedPlaceCoverThumb} p={lp2} c="lo2"/><LRow Thumb={SavedPlaceCoverThumb} p={lp2} c="ln2"/>
 </ul></StrictMode>);
 await until(()=>['lo1','ln1','lo2','ln2'].every(c=>imgLoaded(c)),()=>'L loaded '+JSON.stringify(['lo1','ln1','lo2','ln2'].map(c=>{const li=document.querySelector('[data-c="'+c+'"]');const i=li?.querySelector('img');return [c,!!li,(i?.getAttribute('src')||'').slice(0,80),i?.complete,i?.naturalWidth,li?.getBoundingClientRect().top]}))+' errors='+JSON.stringify(window.renderErrors));await settle(20);
 const measure=c=>{const li=document.querySelector('[data-c="'+c+'"]');const L=li.getBoundingClientRect();const btn=li.querySelector('button');
  const outer=btn.firstElementChild;const img=outer.querySelector('img');const text=btn.children[1];
  const rel=r=>({x:+(r.left-L.left).toFixed(2),y:+(r.top-L.top).toFixed(2),w:+r.width.toFixed(2),h:+r.height.toFixed(2)});
  const clip=[outer,...outer.querySelectorAll('div')].find(e=>{const s=getComputedStyle(e);return s.overflow==='hidden'&&parseFloat(s.borderTopLeftRadius)>0});
  const ir=img.getBoundingClientRect();const tag=e=>e===img?'img':e===btn?'button':e===li?'li':(e?.tagName||'null');
  return {li:{w:+L.width.toFixed(2),h:+L.height.toFixed(2)},outer:rel(outer.getBoundingClientRect()),img:rel(ir),text:rel(text.getBoundingClientRect()),
   radius:clip?getComputedStyle(clip).borderTopLeftRadius:null,clip:clip?rel(clip.getBoundingClientRect()):null,outerBg:getComputedStyle(outer).backgroundColor,
   outerShrink:getComputedStyle(outer).flexShrink,corner:tag(document.elementFromPoint(ir.left+1,ir.top+1)),center:tag(document.elementFromPoint(ir.left+32,ir.top+32))};};
 out.layout={lo1:measure('lo1'),ln1:measure('ln1'),lo2:measure('lo2'),ln2:measure('ln2')};

 rootEl.render(<></>);await tick();
 out.errors=errors;out.allDetails=[...window.detailsCalls];out.dbOps=[...new Set(window.dbOps)];out.channels=window.channels;
 return out;};`;
await check("A0 bundle 建置", async () => {
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    outfile: path.join(tmp, "app.js"),
    format: "iife",
    jsx: "automatic",
    logLevel: "error",
    loader: {
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".webp": "dataurl",
      ".svg": "dataurl",
    },
    define: {
      "import.meta.env": "{}",
      "process.env.NODE_ENV": '"production"',
      // --only-round2：只跑第 2 輪（預設圖／空白封面）案例；搭配 --baseline 確認新案例在修正前會失敗
      __ONLY_ROUND2__: JSON.stringify(process.argv.includes("--only-round2")),
    },
    plugins: [
      {
        name: "controlled-network",
        setup(b) {
          // HEAD 版 SavedPlaceCoverThumb 作為對照模組（git show，不 checkout），供版面比對與修正前基準使用。
          const headThumbPath = path.join(
            root,
            "src/components/saved/__head_SavedPlaceCoverThumb.tsx",
          );
          b.onResolve({ filter: /^virtual:head-thumb$/ }, () => ({ path: headThumbPath }));
          b.onLoad({ filter: /__head_SavedPlaceCoverThumb\.tsx$/ }, () => ({
            contents: execFileSync(
              "git",
              ["show", "HEAD:src/components/saved/SavedPlaceCoverThumb.tsx"],
              { cwd: root, encoding: "utf8" },
            ),
            loader: "tsx",
            resolveDir: path.join(root, "src/components/saved"),
          }));
          // --baseline：改用 HEAD 版 SavedPlaceCoverThumb（git show，不 checkout），確認測試在修正前會失敗
          if (process.argv.includes("--baseline")) {
            const head = execFileSync(
              "git",
              ["show", "HEAD:src/components/saved/SavedPlaceCoverThumb.tsx"],
              { cwd: root, encoding: "utf8" },
            );
            b.onLoad({ filter: /src\/components\/saved\/SavedPlaceCoverThumb\.tsx$/ }, () => ({
              contents: head,
              loader: "tsx",
              resolveDir: path.join(root, "src/components/saved"),
            }));
          }
          b.onResolve({ filter: /.*/ }, (a) =>
            a.path in mocks ? { path: a.path, namespace: "mock" } : null,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "tsx",
            resolveDir: root,
          }));
        },
      },
    ],
  });
});
const getRequests = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/place-photo")) getRequests.push(req.url);
  if (req.url.startsWith("/api/place-photo?") && !/[?&]signature=/.test(req.url)) {
    res.writeHead(401);
    res.end("unsigned");
    return;
  }
  if (
    req.url.startsWith("/api/place-photo?") &&
    decodeURIComponent(req.url).includes("/photos/stale")
  ) {
    res.writeHead(502);
    res.end("upstream_status");
    return;
  }
  if (req.url.startsWith("/fixture-broken")) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  const isImg =
    req.url.startsWith("/api/place-photo?") ||
    req.url.startsWith("/fixture-") ||
    /\.(png|jpe?g|svg|webp)(\?|$)/.test(req.url);
  res.setHeader(
    "Content-Type",
    req.url === "/app.js" ? "application/javascript" : isImg ? "image/svg+xml" : "text/html",
  );
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(tmp, "app.js"))
      : isImg
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        : "<style>" + tailwindCss + '</style><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--window-size=800,600",
    // 所有外部網域（roamie.tw、supabase.co、unsplash、example.com）一律導向本機不存在的 443 → 連線失敗，不對外發請求
    "--host-resolver-rules=MAP * 127.0.0.1",
    "--user-data-dir=" + path.join(tmp, "chrome"),
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
let result = null;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    chrome.stderr.on("data", (b) => {
      output += b;
      const m = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on("error", reject);
    setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
  });
  ws = new WebSocket(endpoint);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const r = JSON.parse(e.data);
    if (r.id && pend.has(r.id)) {
      const p = pend.get(r.id);
      pend.delete(r.id);
      r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pend.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  const { targetInfos } = await send("Target.getTargets");
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: targetInfos.find((t) => t.type === "page").targetId,
    flatten: true,
  });
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/saved` }, sessionId);
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    const r = await send(
      "Runtime.evaluate",
      { expression: 'typeof window.run === "function"', returnByValue: true },
      sessionId,
    );
    ready = Boolean(r.result.value);
    if (!ready) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, "browser harness loaded");
  const r = await send(
    "Runtime.evaluate",
    { expression: "window.run()", awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (r.exceptionDetails)
    throw Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  result = r.result.value;
} catch (e) {
  failures.push("A harness");
  console.log(
    "FAIL A harness\n     " +
      String(e?.stack || e)
        .split("\n")
        .slice(0, 5)
        .join("\n     "),
  );
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}

const ph = (id, v) => `places/ChIJ_ph3_${id}/photos/${v}`;
const unsignedUrl = (name, w = 600) => `/api/place-photo?photo=${encodeURIComponent(name)}&w=${w}`;
if (result) {
  console.info(
    "[TS-PHOTO3] result:",
    JSON.stringify(result)
      .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "data:image/…")
      .slice(0, 4000),
  );
  await check("1a 一般渲染、重新掛載 3 次、重繪（捲動）：Details 0 次、寫回 0 次", () => {
    assert.equal(result.n.details, 0);
    assert.equal(result.n.updates, 0);
  });
  await check("1b 舊名稱 502：每個 placeId Details 恰 1 次；重新掛載後仍為 1 次", () => {
    assert.equal(result.s.details1, 1);
    assert.equal(result.s.details2, 1);
    assert.equal(result.sRemount.details1, 1);
    assert.equal(result.sRemount.details2, 1);
    assert.equal(result.sRemount.updates, 2, "重新掛載不得再寫回");
  });
  await check("1c 同 placeId 三個元件同時失敗（Details 延遲回應）：Details 恰 1 次", () => {
    assert.equal(result.cPending.details, 1);
    assert.equal(result.c.details, 1);
  });
  await check(
    "1d Details 失敗／無名稱／同名／新名稱也 502：各只呼叫 1 次、重掛 3 次不重試、顯示預設圖",
    () => {
      assert.deepEqual([result.neg.f, result.neg.e, result.neg.d, result.neg.l], [1, 1, 1, 1]);
      assert.ok(
        result.neg.fDefault && result.neg.eDefault && result.neg.dDefault && result.neg.lDefault,
      );
      assert.ok(
        result.neg.warns.some((w) => w.includes("[SAVED_PLACE_PHOTO_REFRESH] details failed")),
        "Details 失敗需 console.warn",
      );
    },
  );
  await check("1e Details 失敗／無名稱／同名不寫回（新名稱也 502 者照常寫回一次）", () => {
    assert.deepEqual(result.neg.updatedIds, ["row_l1"]);
  });
  await check("1f 無 placeId、簽名失敗、非 Google 上傳圖失敗：Details 0 次", () => {
    assert.equal(result.pgu.details, 0);
    assert.ok(result.pgu.signs.length >= 1, "前提：g1 確實送了簽名");
  });
  await check("2a 拿到新名稱後重新簽名並顯示新圖（s1 / s2 皆顯示 fresh 簽名 URL）", () => {
    assert.ok(result.s.signs.includes(ph("s1", "fresh") + "@256"), JSON.stringify(result.s.signs));
    assert.ok(result.s.signs.includes(ph("s2", "fresh") + "@256"), JSON.stringify(result.s.signs));
  });
  const upd = (id) => result.s.updates.find((u) => u.eq.some((e) => e[0] === "id" && e[1] === id));
  await check(
    "2b 寫回只 update saved_places 該筆（id＋user_id 條件），metadata 保留其他欄位並更新 photoName",
    () => {
      const a = upd("row_s1");
      assert.ok(a, "s1 未寫回");
      assert.equal(a.table, "saved_places");
      assert.deepEqual(a.eq, [
        ["id", "row_s1"],
        ["user_id", "u1"],
      ]);
      assert.deepEqual(a.payload.metadata, {
        googlePlaceId: "ChIJ_ph3_s1",
        photoName: ph("s1", "fresh"),
        rating: 4.5,
        note: "keep",
        nested: { a: 1 },
      });
      const b = upd("row_s2");
      assert.deepEqual(b.payload.metadata, {
        placeId: "ChIJ_ph3_s2",
        source: "chat",
        photoName: ph("s2", "fresh"),
      });
      assert.deepEqual(Object.keys(a.payload).sort(), ["cover_image", "image_url", "metadata"]);
    },
  );
  await check(
    "2c 只替換原為 Google 照片的 cover_image／image_url；寫入未簽名 URL（不持久化簽名）",
    () => {
      const a = upd("row_s1").payload;
      assert.equal(a.cover_image, unsignedUrl(ph("s1", "fresh"), 600));
      assert.equal(a.image_url, "/fixture-user-upload.png", "使用者上傳圖不得被替換");
      const b = upd("row_s2").payload;
      assert.equal(b.cover_image, "/fixture-user-cover.png");
      assert.equal(b.image_url, unsignedUrl(ph("s2", "fresh"), 600));
      for (const v of [a.cover_image, b.image_url]) assert.doesNotMatch(v, /signature=|expires=/);
    },
  );
  await check(
    "2d 本機快照（localStorage）與 listPlaces 記憶體快取同步更新；其他筆不變；未重新 select",
    () => {
      const local = result.sLocal ?? [];
      const ls1 = local.find((p) => p.id === "row_s1");
      assert.equal(ls1?.metadata?.photoName, ph("s1", "fresh"));
      assert.equal(ls1?.cover_image, unsignedUrl(ph("s1", "fresh"), 600));
      assert.equal(
        local.find((p) => p.id === "row_s2")?.image_url,
        unsignedUrl(ph("s2", "fresh"), 600),
      );
      assert.equal(local.find((p) => p.id === "row_o1")?.metadata?.photoName, ph("o1", "ok"));
      assert.equal(result.sList.selectDelta, 0);
      assert.equal(
        result.sList.rows.find((p) => p.id === "row_s1")?.metadata?.photoName,
        ph("s1", "fresh"),
      );
    },
  );
  await check(
    "2e 寫回失敗不影響顯示：仍顯示新圖、console.warn persist failed、本機快照不被改寫",
    () => {
      assert.equal(result.w.details, 1);
      assert.ok(
        result.w.warns.some((w) => w.includes("[SAVED_PLACE_PHOTO_REFRESH] persist failed")),
        JSON.stringify(result.w.warns),
      );
      assert.equal(result.w.local, null, "寫回失敗不應寫入本機快照");
    },
  );
  await check(
    "3a 未傳 onImageError／onSourceError：PlaceImage／FadeInImage 照舊退回預設圖、不呼叫 Details",
    () => {
      assert.equal(result.x.details, 0);
    },
  );
  await check(
    "3b onSourceError 只在主圖失敗時呼叫一次；成功圖 0 次；fallback 也失敗時不以 fallback URL 通知",
    () => {
      const x3 = result.x.spy.filter((s) => s[0] === "x3");
      const x4 = result.x.spy.filter((s) => s[0] === "x4");
      const x5 = result.x.spy.filter((s) => s[0] === "x5");
      assert.equal(x3.length, 1, JSON.stringify(x3));
      assert.match(x3[0][1], /x3%2Fphotos%2Fstale/);
      assert.equal(x4.length, 0);
      assert.equal(x5.length, 1, JSON.stringify(x5));
      assert.ok(x5.every((s) => !s[1].includes("fixture-broken")));
    },
  );
  await check(
    "4 全程只有 saved_places select/update、無 Realtime channel、無未簽名 /api/place-photo GET、無 unhandled rejection",
    () => {
      assert.deepEqual(result.dbOps.sort(), ["saved_places:select", "saved_places:update"]);
      assert.equal(result.channels, 0);
      assert.deepEqual(
        getRequests.filter((u) => !/[?&]signature=/.test(u)),
        [],
      );
      assert.deepEqual(result.errors, []);
      assert.ok(
        result.allDetails.every((id) =>
          /^ChIJ_ph3_(s1|s2|c1|f1|e1|d1|l1|w1|dc[1-5]|dn[12]|v1|q[1-3]|r6|z[12])$/.test(id),
        ),
        JSON.stringify(result.allDetails),
      );
    },
  );
  await check(
    "1g 同 googlePlaceId 的兩筆收藏同時失敗：兩筆 row 都各寫回一次（第三個元件與第一筆同 row 不重複寫）",
    () => {
      console.info("     （資訊）C 寫回的 row id：", JSON.stringify(result.c.updatedIds));
      assert.deepEqual([...result.c.updatedIds].sort(), ["row_c1a", "row_c1b"]);
    },
  );

  // ---------------- 第 2 輪：預設圖／空白封面
  const D_IDS = ["dc1", "dc2", "dc3", "dc4", "dc5"];
  const dPayload = (id) => result.d.first.updates[D_IDS.indexOf(id)][0];
  await check(
    "5a 預設圖（Vite hash 檔名／roamie-default-cover-hash／開發路徑 /src/assets／實際 import 值）或空白：進入畫面 Details 各恰 1 次並顯示新照片",
    () => {
      assert.deepEqual(
        result.d.first.details,
        [1, 1, 1, 1, 1],
        JSON.stringify(result.d.first.details),
      );
    },
  );
  await check(
    "5b 重新掛載 3 次、重繪 2 次（新物件 identity）：Details 仍各 1 次、寫回仍各 1 次",
    () => {
      assert.deepEqual(result.d.afterRemount.details, [1, 1, 1, 1, 1]);
      assert.deepEqual(result.d.afterRemount.updates, [1, 1, 1, 1, 1]);
    },
  );
  await check(
    "5c 寫回：metadata.photoName＝新名稱；原為預設圖的 cover_image／image_url 換成新名稱的未簽名 URL；空白欄位維持 null",
    () => {
      const fresh = (id) => unsignedUrl(ph(id, "fresh"), 600);
      for (const id of D_IDS) {
        const p = dPayload(id);
        assert.ok(p, id + " 未寫回");
        assert.equal(p.metadata.photoName, ph(id, "fresh"), id);
        for (const v of [p.cover_image, p.image_url])
          if (v) assert.doesNotMatch(v, /signature=|expires=/, id + " 不得持久化簽名");
      }
      assert.deepEqual(
        { c: dPayload("dc1").cover_image, i: dPayload("dc1").image_url },
        { c: fresh("dc1"), i: null },
      );
      assert.deepEqual(
        { c: dPayload("dc2").cover_image, i: dPayload("dc2").image_url },
        { c: fresh("dc2"), i: fresh("dc2") },
      );
      assert.deepEqual(dPayload("dc2").metadata, {
        placeId: "ChIJ_ph3_dc2",
        source: "chat",
        photoName: ph("dc2", "fresh"),
      });
      assert.deepEqual(
        { c: dPayload("dc3").cover_image, i: dPayload("dc3").image_url },
        { c: null, i: null },
      );
      assert.deepEqual(
        { c: dPayload("dc4").cover_image, i: dPayload("dc4").image_url },
        { c: fresh("dc4"), i: fresh("dc4") },
      );
      assert.equal(
        dPayload("dc5").cover_image,
        fresh("dc5"),
        "Harbs 案例（/src/assets/scene-cafe.jpg）",
      );
    },
  );
  await check(
    "5c2 預設圖／空白但 Details 回無照片或失敗：本次執行只查 1 次（重掛 3 次不重試）、不寫回、維持預設圖",
    () => {
      assert.deepEqual(result.dn.details, [1, 1]);
      assert.equal(result.dn.updates, 0);
      assert.deepEqual(result.dn.defaults, [true, true]);
    },
  );
  await check(
    "5d 使用者上傳（Supabase storage）、Unsplash、其他真實網址、預設圖＋上傳混合、本機上傳：Details 0 次、寫回 0 次、不顯示 Google 照片",
    () => {
      assert.equal(result.r.details, 0);
      assert.equal(result.r.updates, 0);
      assert.ok(
        result.r.srcs.every((s) => s && !s.includes("/api/place-photo")),
        JSON.stringify(result.r.srcs),
      );
    },
  );
  await check("（資訊）第三方網址路徑剛好是 /assets/scene-cafe-hero.jpg 時是否被當成預設圖", () => {
    console.info(
      "     （資訊）https://cdn.example.com/assets/scene-cafe-hero.jpg → Details 次數：",
      result.r6.details,
      result.r6.details ? "（regex 只看路徑不看網域，會被當成預設圖而查詢並覆寫）" : "",
    );
  });
  await check(
    "5e 沒進入畫面 0 次（含重繪）；捲進畫面才查 1 次；捲出再捲入、重繪不重查；寫回 1 次（真實 IntersectionObserver）",
    () => {
      assert.equal(result.v.before, 0, "畫面外不得查");
      assert.equal(result.v.beforeRerender, 0, "畫面外重繪不得查");
      assert.equal(result.v.after, 1);
      assert.equal(result.v.updates, 1);
    },
  );
  await check(
    "5f 同 placeId 兩筆（皆預設圖／空白）同時進入畫面、Details 延遲：1 次；兩筆各寫回 1 次",
    () => {
      assert.equal(result.q1.pending, 1);
      assert.equal(result.q1.details, 1);
      assert.deepEqual([result.q1.a, result.q1.b], [1, 1]);
    },
  );
  await check(
    "5g 同 placeId 兩筆（皆預設圖），第二筆在第一筆換新後才進入畫面：Details 1 次；第二筆也要寫回 1 次",
    () => {
      assert.equal(result.q2.details, 1);
      assert.equal(result.q2.a, 1);
      assert.equal(
        result.q2.b,
        1,
        "第二筆 row_q2b 沒有寫回 → 下次開 App 仍是預設圖、會再花一次 Details",
      );
    },
  );
  await check(
    "5h 同 placeId 兩筆（舊名稱過期），第二筆在第一筆換新後才掛載：Details 1 次；第二筆也要寫回 1 次",
    () => {
      assert.equal(result.q3.details, 1);
      assert.equal(result.q3.a, 1);
      assert.equal(
        result.q3.b,
        1,
        "第二筆 row_q3b 沒有寫回 → 下次開 App 仍是過期名稱、會再 502＋Details 一次",
      );
    },
  );
  const zCount = (arr, id) => arr[result.z.ids.indexOf(id)];
  await check(
    "7a 只寫回 effect：已是新名稱／使用者上傳（無 photoName）／第三方網址 → 0 次寫回；Details 全程 1 次",
    () => {
      assert.equal(result.z.details, 1, "只寫回不得查 Details");
      for (const id of ["row_z1new", "row_z1up", "row_z1ext"])
        assert.equal(zCount(result.z.after, id), 0, id + " 不應寫回");
    },
  );
  await check(
    "7b 只寫回 effect：每筆 row 最多 1 次（重新掛載 3 次、重繪 2 次、以寫回後 row 重掛皆不重複）",
    () => {
      for (const id of ["row_z1upm", "row_z1oth", "row_z1def"]) {
        assert.equal(zCount(result.z.first, id), 1, id + " 首次應寫回 1 次");
        assert.equal(zCount(result.z.after, id), 1, id + " 不得重複寫回");
      }
    },
  );
  await check("7c 上傳圖＋metadata 舊名稱：只更新 metadata.photoName，上傳圖欄位不變", () => {
    const p = result.z.payload.row_z1upm;
    assert.equal(p.metadata.photoName, ph("z1", "fresh"));
    assert.equal(p.cover_image, "/fixture-user-cover.png");
    assert.equal(
      p.image_url,
      "https://abcd.supabase.co/storage/v1/object/public/place-images/u1/z.jpg",
    );
  });
  await check("7d 預設圖 row 的 cover_image 換成新名稱的未簽名 URL", () => {
    assert.equal(result.z.payload.row_z1def.cover_image, unsignedUrl(ph("z1", "fresh"), 600));
  });
  await check("（資訊）工程師提出的風險：另一筆存有效但不同的 Google 名稱也會被改寫", () => {
    const p = result.z.payload.row_z1oth;
    console.info(
      "     （資訊）row_z1oth 寫回：",
      JSON.stringify({ photoName: p?.metadata?.photoName, cover: p?.cover_image }),
    );
    console.info(
      "     （資訊）同 placeId 已換新後，使用者上傳 row 的縮圖 src：",
      String(result.z.upSrc).slice(0, 90),
      "／第三方 row：",
      String(result.z.extSrc).slice(0, 90),
    );
  });
  await check("7e Details 失敗的 placeId：另一筆存其他名稱 → 不寫回、不重查", () => {
    assert.equal(result.z2.details, 1);
    assert.equal(result.z2.updates, 0);
  });
  await check(
    "6 版面：外層 div 不改變收藏頁縮圖的 bounding box、圓角裁切、背景與列內文字位置（HEAD 版 vs 工作區版）",
    () => {
      const L = result.layout;
      console.info("     （資訊）layout HEAD:", JSON.stringify(L.lo1));
      console.info("     （資訊）layout 新版:", JSON.stringify(L.ln1));
      assert.deepEqual(L.lo1.outer, { ...L.lo1.outer, w: 64, h: 64 }, "前提：HEAD 版縮圖 64x64");
      // 專案主題的 rounded-2xl 不是 Tailwind 預設 16px（實測 34px），只要求確實有圓角裁切
      assert.ok(
        parseFloat(L.lo1.radius) > 0,
        "前提：HEAD 版 rounded-2xl 裁切，實際 " + L.lo1.radius,
      );
      assert.equal(L.lo1.corner, "button", "前提：圓角外側點不到 img（確實被裁切）");
      assert.deepEqual(L.ln1, L.lo1, "Google 照片列");
      assert.deepEqual(L.ln2, L.lo2, "上傳圖失敗退回預設圖列");
    },
  );
}

console.log(
  failures.length
    ? `\nverify-saved-place-photo-refresh: FAIL (${failures.length})\n  - ${failures.join("\n  - ")}`
    : "\nverify-saved-place-photo-refresh: PASS",
);
process.exitCode = failures.length ? 1 : 0;
