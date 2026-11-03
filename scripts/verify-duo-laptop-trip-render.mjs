// verify-duo-laptop-trip-render.mjs — iPhone Duo 上下版型（筆電半開／直向攤平）：TripDetailScreen 真實 React render
//
// 歷史：#H2a-fix-T 建立（筆電上下分頁：地圖 portal 到 .trip-duo-laptop-map host）。
// #DT1-T 改寫：需求改為「html.duo-laptop／html.duo-flat-portrait 時行程頁與一般 iPhone 相同的一頁式」：
//   - 舊 R1（laptopBottom／laptopRail 的 host 斷言）、R3b（筆電 host）、R5（?view=map 在筆電時地圖在 host）
//     與新需求衝突，改寫為一頁式斷言（無 host、地圖在一般分頁、?view=map 進入地圖分頁）。
//
// 受測：src/components/trip/TripDetailScreen.tsx（真實）＋ TripWorkspaceBar／TripWorkspaceMap／GoogleMap（真實；
//   Google Maps JS API 以 Proxy 假物件取代並計算 Map 建構次數）＋ TripDeleteConfirmDialog／ui/alert-dialog／ui/sheet（真實 Radix）
//   ＋ MobileFrame／appContentWrapperClass（真實，模擬 _app 祖先鏈）＋ 實際編譯的 styles.css。
// Mock：SavedTripItineraryEditor（保留 headerRight／workspaceBar／workspaceContent(ctx) 契約；cover／header 的 class
//   與真實元件相同，F0 以原始碼比對其結構）、TripSharePanel（以真實 ui/sheet 的底部 Sheet 呈現，同 class）、
//   use-duo-layout（可控 store）、router、資料存取、i18n、realtime。
// React 以 development build＋<StrictMode> 執行。
//
//   F0 fixture 與真實元件結構一致（封面三組按鈕的 class、workspaceBar 為 .trip-detail-root 直接子節點）；
//      TripDetailScreen 不再輸出 .trip-duo-laptop-map、createPortal 只用於雙欄。
//   S1 上下版型（筆電／直向攤平 × 底部導覽／右側直欄）：單一捲動容器、無 host、main 頂部內距 0、捲動容器頂端＝0。
//   S2 封面頂端＝0、3:2、寬＝內容寬。
//   S3 返回／分享／刪除 top＝狀態列高度＋0.75rem 且可點；更換封面維持右下（封面下緣−0.75rem）。
//   S4 切換列吸頂於狀態列下緣；底板吸頂 [0, 狀態列高度]、不佔版面；截圖確認狀態列帶無內容透出（對照：隱藏底板時會透出）。
//   S5 三分頁點擊與左右滑動（touch PointerEvent）；首次切換分頁時切換列停在狀態列下方。
//   S6 地圖只在地圖分頁掛載；StrictMode 下 Map 只建構 1 次；切走只 hidden；切回不重建；無「容器尺寸過小」重試。
//   S7 分享 Sheet／刪除確認：portal 到 body（不在捲動容器內）、祖先鏈無捲動容器／transform、在視窗內可點。
//   N1 非上下版型（手機、Duo 合起、雙欄、雙欄＋筆電、iPad 寬、web 寬）：底板 display:none、高度 0；
//      移除 #DT1 區塊的 CSS 與目前 CSS 量測完全相同（含捲動後）；移除底板節點後量測也相同。
//   N2 上下版型對照：移除 #DT1 區塊時量測不同（證明 N1 的 A/B 有效）。
//   R2 非上下版型結構（沿用）；R3 姿勢切換（含直向攤平）不 remount；R4 對照；R5 ?view=map 進入上下版型。
//   R7 雙欄→上下版型（之前開過地圖分頁）：隱藏中的地圖不得反覆重試或報「地圖容器高度為 0」。
//   R6 無外部請求、無瀏覽器例外。
//
// 限制：headless Chrome 不會重現 iOS WebKit 捲動容器裁切 fixed 子孫；S7 以結構（祖先鏈）斷言代替。
// 執行：node scripts/verify-duo-laptop-trip-render.mjs（不讀 .env、不連網）

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 30).join("\n     "));
  }
}

// ───────────────────────── F0：fixture 與真實元件一致 ─────────────────────────
await check("F0 fixture 結構＝真實 SavedTripItineraryEditor（封面按鈕 class、workspaceBar 為 .trip-detail-root 直接子節點）；TripDetailScreen 無 laptop host", () => {
  const ed = read("src/components/saved/SavedTripItineraryEditor.tsx");
  const rootOpen = ed.indexOf('className="trip-detail-root w-full"');
  assert.ok(rootOpen > 0, "找不到 .trip-detail-root");
  const seq = [
    'className="trip-detail-root w-full"',
    'className="trip-detail-cover"',
    'className="relative aspect-[3/2] w-full overflow-hidden"',
    'className="pointer-events-none aspect-[3/2] w-full select-none"',
    'className="pointer-events-auto absolute left-3 top-3"',
    'className="pointer-events-auto absolute right-3 top-3"',
    "{headerRight}",
    '"pointer-events-auto absolute bottom-3 right-3 ',
    '<header className="border-b border-border px-5 pb-3 pt-3">',
    "{workspaceBar}",
  ];
  let at = 0;
  for (const s of seq) {
    const i = ed.indexOf(s, at);
    assert.ok(i >= at, "真實編輯器結構改變（找不到或順序不同）：" + s);
    at = i + s.length;
  }
  // {workspaceBar} 與 .trip-detail-root 的 div／header 巢狀深度＝1（直接子節點）
  const slice = ed.slice(ed.lastIndexOf("<div", rootOpen), ed.indexOf("{workspaceBar}", rootOpen));
  let depth = 0;
  for (const m of slice.matchAll(/<(\/?)(div|header)\b([^>]*)>/g)) {
    if (m[1]) depth--;
    else if (!/\/\s*$/.test(m[3])) depth++;
  }
  assert.equal(depth, 1, "{workspaceBar} 不是 .trip-detail-root 的直接子節點（深度 " + depth + "）");
  const bar = read("src/components/trip/TripWorkspaceBar.tsx");
  assert.match(bar, /className="sticky top-0 z-20 bg-background px-5 pb-1 pt-3"/);
  const tds = read("src/components/trip/TripDetailScreen.tsx");
  assert.doesNotMatch(tds, /trip-duo-laptop-map/, "TripDetailScreen 仍輸出 laptop host");
  assert.doesNotMatch(tds, /use-duo-laptop|useDuoLaptop|useDuoFlatPortrait/, "TripDetailScreen 不應再依筆電姿勢分支");
  assert.equal((tds.match(/createPortal\(/g) || []).length, 1, "createPortal 只用於雙欄右欄");
  assert.match(tds, /twoPane \? \(\s*\/\/[^\n]*\n\s*mapPaneEl \? \(\s*createPortal\(/, "createPortal 須在 twoPane 分支內");
  assert.match(tds, /<div ref=\{stackedBackdropRef\} aria-hidden className="trip-duo-status-backdrop" \/>\s*<TripWorkspaceBar/, "底板須緊接在切換列之前");
});

// ───────────────────────── 瀏覽器 ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(
    os.homedir(),
    "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ),
].find((p) => p && fs.existsSync(p));

const TRIP_ID = "11111111-2222-4333-8444-555555555555";
const TOP = 455.5;
const BOTTOM = 495.5;
const RAIL = 64;
const VW = 669;
const VH = 951;
const NAV_H = 68;

const mocks = {
  "@/hooks/use-duo-layout": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur={navPlacement:'bottom',tripLayout:'single',usableWidth:669};
export function setDuoLayout(v){cur=v;subs.forEach(f=>f());}
export function useDuoLayout(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}`,
  // TripDetailScreen 已不使用；保留完整匯出以防其他模組引用（呼叫即記錄，F0／R6 會發現）
  "@/hooks/use-duo-laptop": `export function useDuoLaptop(){window.__duoLaptopHookCalls=(window.__duoLaptopHookCalls||0)+1;return {laptop:false};}
export function useDuoFlatPortrait(){window.__duoLaptopHookCalls=(window.__duoLaptopHookCalls||0)+1;return {flat:false};}
export function useDuoDevice(){return false;}`,
  "@/hooks/use-i18n": `export const useI18n=()=>({locale:'zh-TW',t:k=>k})`,
  "@tanstack/react-router": `const NAV=(o)=>{(window.__nav||(window.__nav=[])).push(o);return Promise.resolve();};const ROUTER={subscribe:()=>()=>{}};
export const useNavigate=()=>NAV;
export const useRouter=()=>ROUTER;
export const useRouterState=({select})=>select({location:{pathname:'/saved/${TRIP_ID}'}});`,
  sonner: `export const toast={success(){},error(){}};`,
  // 分享面板：以真實 ui/sheet 的底部 Sheet 呈現（class 與 TripSharePanel 的 SheetContent 相同）
  "@/components/trip/TripSharePanel": `import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
export function TripSharePanel({open,onOpenChange}){return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="rounded-t-[1.75rem] border-0 bg-background px-0 pb-8"><SheetTitle>share</SheetTitle><SheetDescription>d</SheetDescription><div data-fixture-share="" style={{height:260}}><button type="button" data-btn="share-inner">invite</button></div></SheetContent></Sheet>;}`,
  "@/lib/i18n/delete-trip-dialog": `export const deleteTripDialogLabels=()=>({title:'Delete?',description:'gone',confirmLabel:'ok',cancelLabel:'no'});`,
  "@/lib/saved-trip/delete-trip": `export const deleteTrip=async()=>{};`,
  "@/lib/itinerary-storage": `export const getItinerary=async(id)=>({id,title:'T',updated_at:'2026-10-01T00:00:00Z',payload:{destinationLocation:{lat:35.68,lng:139.76}}});export const listItineraries=async()=>[];`,
  "@/lib/trip/trip-collab": `export const getTripAccess=async()=>({isOwner:true,isMember:true});export const listTripMembers=async()=>[];export const listOwnedTripIds=async()=>[];`,
  "@/lib/trip/use-trip-realtime": `export const useTripRealtimeSync=()=>{};`,
  "@/lib/trip/core-trip": `export const resolveCoreTripTitle=()=>'Trip';export const toCoreTrip=()=>({});`,
  "@/components/trip/TripWorkspaceOverview": `export const TripWorkspaceOverview=()=> <div data-fixture-overview="" style={{height:1400}}>overview</div>;`,
  // ── Google Maps：真實 GoogleMap 元件，API 以 Proxy 假物件取代 ──
  "@/lib/google-maps-client": `export const getGoogleMapsBrowserKey=()=>'test';export const getGoogleMapsBrowserKeyError=()=>null;export const requireGoogleMapsBrowserKey=()=>'test';export const buildPlacePhotoUrl=()=>null;`,
  "@/lib/google-maps-init-log": `export function logMapsOnce(){}`,
  "@/lib/google-maps-loader": `function fake(){const f=function(){};return new Proxy(f,{get(t,k){if(k==='then')return undefined;if(k===Symbol.toPrimitive)return ()=>0;if(k===Symbol.iterator)return function*(){};return fake();},apply(){return fake();},construct(){return fake();}});}
function MapCtor(el){window.__mapCtor=(window.__mapCtor||0)+1;const r=el.getBoundingClientRect();(window.__mapCtorSizes||(window.__mapCtorSizes=[])).push([r.width,r.height]);return fake();}
const maps=new Proxy({},{get(t,k){if(k==='Map')return MapCtor;if(k==='then')return undefined;return fake();}});
export class GoogleMapsNetworkError extends Error{}
export const isGoogleMapsNetworkError=()=>false;
export const googleMapsScriptSrc=()=>'';
export async function loadGoogleMapsApi(){window.__loadCalls=(window.__loadCalls||0)+1;window.google={maps};return maps;}
export function triggerMapResize(){}`,
  "@/components/map/RoamieUserLocationOverlay": `export const ROAMIE_USER_LOCATION_LABEL='me';export const createRoamieUserLocationOverlay=()=>null;`,
  "@/lib/map-user-location-marker": `export const isGoogleMapsOverlayReady=()=>false;export const resolveUserMarkerAvatarSrc=(s)=>s;`,
  "@/components/saved/SavedTripItineraryEditor": `import {useEffect,useMemo,useState} from 'react';
const item=(n,lat,lng)=>({name:n,placeName:n,time:'09:00',lat,lng});
const DG=[{dateKey:'2026-11-01',dayNumber:1,items:[item('A',35.68,139.76),item('B',35.69,139.70)]},{dateKey:'2026-11-02',dayNumber:2,items:[item('C',35.66,139.73)]}];
export function SavedTripItineraryEditor(p){
 const [token]=useState(()=>Math.random().toString(36).slice(2));
 const [n,setN]=useState(0);
 useEffect(()=>{window.__editorMounts=(window.__editorMounts||0)+1;return()=>{window.__editorUnmounts=(window.__editorUnmounts||0)+1;};},[]);
 const ctx=useMemo(()=>({dayGroups:DG,openPlaceDetail:()=>{},selectDay:()=>{}}),[]);
 const hide=p.workspaceView!=null&&p.workspaceView!=='trip';
 return <div className="trip-detail-root w-full" data-editor-root="" data-token={token} data-count={n}>
  <div className="trip-detail-cover"><div className="relative aspect-[3/2] w-full overflow-hidden">
   <div className="pointer-events-none aspect-[3/2] w-full select-none" style={{background:'#ff0000'}}/>
   <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent"/>
   <div className="pointer-events-auto absolute left-3 top-3"><button type="button" data-btn="back" aria-label="back" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 backdrop-blur">b</button></div>
   <div className="pointer-events-auto absolute right-3 top-3">{p.headerRight}</div>
   <button type="button" data-btn="cover" className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs backdrop-blur transition active:scale-[0.98] disabled:opacity-60">cover</button>
  </div></div>
  <header className="border-b border-border px-5 pb-3 pt-3"><h1>Trip</h1><button type="button" data-btn="bump" onClick={()=>setN(x=>x+1)}>bump</button></header>
  {p.workspaceBar}
  <div id="fixture-trip-pane" className={hide?'px-5 pt-3 hidden':'px-5 pt-3'} style={{background:'#ff0000'}}>{Array.from({length:14},(_,i)=><div key={i} className="mt-3 rounded-2xl border border-border p-4" style={{background:'#ff0000'}}>Stop {i}</div>)}</div>
  {typeof p.workspaceContent==='function'?p.workspaceContent(ctx):p.workspaceContent}
 </div>;
}`,
};

const entry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TripDetailScreen} from '@/components/trip/TripDetailScreen';
import {MobileFrame} from '@/components/MobileFrame';
import {appContentWrapperClass} from '@/lib/app-scroll-contract';
import {setDuoLayout,useDuoLayout} from '@/hooks/use-duo-layout';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};
const W0=console.warn;console.warn=(...a)=>{const s=a.map(String).join(' ');if(/容器尺寸過小/.test(s))window.__smallWarn=(window.__smallWarn||0)+1;};
const RAIL_CONTENT={'--safe-area-right':'0px'};
const NAV_BOTTOM="bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl pb-[var(--safe-area-bottom)] transition-[opacity,transform] duration-200";
const NAV_RAIL="app-right-rail fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-border bg-card/95 backdrop-blur-xl";
function Shell({initialView,wrap}){
 const L=useDuoLayout();const rail=L.navPlacement==='right-rail';const pane=rail&&L.tripLayout==='two-pane'?(L.pane??null):null;
 const contentStyle=!rail?undefined:pane?{...RAIL_CONTENT,flexDirection:'row',paddingLeft:'var(--safe-area-left)'}:RAIL_CONTENT;
 const screen=<TripDetailScreen tripId="${TRIP_ID}" navSource="verify" initialView={initialView}/>;
 return <MobileFrame fullBleed={rail}><div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <main className="app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)] pb-[var(--app-nav-total-height)] min-h-0 flex-1 overflow-hidden" style={rail?{paddingRight:'var(--app-rail-width)'}:undefined}>
   <div id="content" className={appContentWrapperClass(true)} style={contentStyle}>{wrap?wrap(screen):screen}</div>
  </main>
  <nav id="nav" className={rail?NAV_RAIL:NAV_BOTTOM} style={rail?{width:'var(--app-rail-width)'}:undefined}><ul className="flex h-[var(--bottom-nav-height,4.25rem)]"><li><a href="#">n</a></li></ul></nav>
 </div></MobileFrame>;
}
const LAP={foldTop:${TOP},foldBottom:${BOTTOM}};
const PANE={leftWidth:300,rightWidth:297,gutter:8,foldX:304};
const BOTTOM_L={navPlacement:'bottom',tripLayout:'single',usableWidth:669};
const RAIL_L={navPlacement:'right-rail',tripLayout:'single',usableWidth:605};
const PANE_L={navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:605,pane:PANE};
// stacked：_app 的 html class（雙欄優先：pane 時不加）
const POSTURES={
 phone:{layout:BOTTOM_L,stacked:null},
 duoFolded:{layout:RAIL_L,stacked:null},
 laptopBottom:{layout:BOTTOM_L,stacked:'duo-laptop'},
 laptopRail:{layout:RAIL_L,stacked:'duo-laptop'},
 flatBottom:{layout:BOTTOM_L,stacked:'duo-flat-portrait'},
 flatRail:{layout:RAIL_L,stacked:'duo-flat-portrait'},
 twoPane:{layout:PANE_L,stacked:null},
 twoPaneAndLaptop:{layout:PANE_L,stacked:'duo-laptop'},
 twoPaneAndFlat:{layout:PANE_L,stacked:'duo-flat-portrait'},
};
window.__safeTop=24;
function applyHtml(p){const h=document.documentElement;const rail=p.layout.navPlacement==='right-rail';const pane=rail&&p.layout.tripLayout==='two-pane'&&p.layout.pane;
 const st=pane?null:p.stacked;
 h.className='native-shell trip-detail-route-active'+(rail?' duo-rail':'')+(pane?' duo-two-pane':'')+(st?' '+st:'');
 h.removeAttribute('style');
 h.style.setProperty('--safe-area-bottom','0px');h.style.setProperty('--safe-area-top',window.__safeTop+'px');h.style.setProperty('--safe-area-left','0px');h.style.setProperty('--safe-area-right','0px');
 if(rail){h.style.setProperty('--bottom-nav-height','0.01px');h.style.setProperty('--app-rail-width','${RAIL}px');}
 if(pane){h.style.setProperty('--duo-fold-left-edge',(pane.foldX-pane.gutter/2)+'px');h.style.setProperty('--duo-fold-right-edge',(pane.foldX+pane.gutter/2)+'px');}
 if(st){h.style.setProperty('--duo-hinge-top',LAP.foldTop+'px');h.style.setProperty('--duo-hinge-bottom',LAP.foldBottom+'px');}
}
let rootEl=null;
window.mount=(o)=>{if(o.safeTop!=null)window.__safeTop=o.safeTop;else window.__safeTop=24;const p=POSTURES[o.posture];applyHtml(p);setDuoLayout(p.layout);
 if(rootEl){flushSync(()=>rootEl.render(null));rootEl.unmount();}
 window.__editorMounts=0;window.__editorUnmounts=0;window.__mapCtor=0;window.__mapCtorSizes=[];window.__loadCalls=0;window.__smallWarn=0;window.__nav=[];
 sessionStorage.clear();document.getElementById('root').innerHTML='';
 rootEl=createRoot(document.getElementById('root'));
 flushSync(()=>rootEl.render(<StrictMode><Shell initialView={o.initialView} wrap={o.keyedWrap?keyedWrap:null}/></StrictMode>));
 return true;};
function keyedWrap(screen){return <KeyedWrap>{screen}</KeyedWrap>;}
function KeyedWrap({children}){const L=useDuoLayout();return <React.Fragment key={L.navPlacement+L.tripLayout}>{children}</React.Fragment>;}
window.setPosture=(name)=>{const p=POSTURES[name];applyHtml(p);flushSync(()=>{setDuoLayout(p.layout);});return true;};
window.raf2=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
window.frames=(n)=>new Promise(r=>{let i=0;const f=()=>{if(++i>=n)r();else requestAnimationFrame(f);};requestAnimationFrame(f);});
window.useCss=(which)=>{document.getElementById('cssA').media=which==='A'?'all':'not all';document.getElementById('cssB').media=which==='B'?'all':'not all';return true;};
const q=s=>document.querySelector(s);const qa=s=>[...document.querySelectorAll(s)];
const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
window.loaded=()=>!!q('.trip-detail-route [data-editor-root]');
window.saveNodes=()=>{window.__route=q('.trip-detail-route');window.__editor=q('[data-editor-root]');return {token:window.__editor.dataset.token};};
window.bump=()=>{flushSync(()=>q('[data-btn=bump]').click());return q('[data-editor-root]').dataset.count;};
window.clickTab=(v)=>{flushSync(()=>q('#trip-workspace-tab-'+v).click());return true;};
window.scrollRoute=(y)=>{const r=q('.trip-detail-route');r.scrollTop=y;return r.scrollTop;};
window.swipe=async(dir)=>{const route=q('.trip-detail-route');const target=q('[role=tablist]');const b=target.getBoundingClientRect();const y=b.top+b.height/2;
 const x0=dir==='next'?450:200;const x1=dir==='next'?250:400;
 const ev=(type,x,el)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',isPrimary:true,clientX:x,clientY:y});
 target.dispatchEvent(ev('pointerdown',x0));
 for(const x of [x0+(x1-x0)*0.1,x0+(x1-x0)*0.5,x1]){await new Promise(r=>setTimeout(r,16));window.dispatchEvent(ev('pointermove',x));}
 flushSync(()=>{window.dispatchEvent(ev('pointerup',x1));});
 await new Promise(r=>setTimeout(r,400));return q('[role=tab][aria-selected=true]')?.id??null;};
function ancestorIssues(el){const out=[];
 for(let a=el.parentElement;a;a=a.parentElement){const cs=getComputedStyle(a);const name=a.tagName.toLowerCase()+(a.id?'#'+a.id:'')+(a.classList.length?'.'+[...a.classList].slice(0,2).join('.'):'');
  const bad=[];
  if(cs.transform!=='none')bad.push('transform:'+cs.transform);
  for(const k of ['translate','rotate','scale'])if(cs[k]&&cs[k]!=='none')bad.push(k+':'+cs[k]);
  if(cs.filter!=='none')bad.push('filter:'+cs.filter);
  if(cs.backdropFilter&&cs.backdropFilter!=='none')bad.push('backdrop-filter:'+cs.backdropFilter);
  if(cs.perspective!=='none')bad.push('perspective:'+cs.perspective);
  if(cs.contain!=='none')bad.push('contain:'+cs.contain);
  if(cs.willChange!=='auto')bad.push('will-change:'+cs.willChange);
  if(/auto|scroll|overlay/.test(cs.overflowX)||/auto|scroll|overlay/.test(cs.overflowY))bad.push('overflow:'+cs.overflowX+'/'+cs.overflowY);
  if(a.classList.contains('trip-detail-route'))bad.push('is .trip-detail-route');
  if(bad.length)out.push(name+' → '+bad.join(', '));
 }
 return out;}
const hitOk=(el)=>{if(!el)return false;const b=el.getBoundingClientRect();const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return !!e&&el.contains(e);};
window.inspect=()=>{const route=q('.trip-detail-route');const content=q('#content');const main=q('main');
 const panel=q('#trip-workspace-panel-map');const bd=q('.trip-duo-status-backdrop');const bar=q('[role=tablist]')?.parentElement;
 const paneRegion=qa('#content > [role=region]')[0]||null;
 const scrollers=qa('body *').filter(e=>{const cs=getComputedStyle(e);return /auto|scroll/.test(cs.overflowY)&&e.scrollHeight>e.clientHeight+1;}).map(e=>e.className.split(' ')[0]||e.tagName);
 const cover=q('.trip-detail-cover > div');const hdr=q('[data-editor-root] > header');const sentinel=bar?.previousElementSibling;
 const back=q('[data-btn=back]');const share=q('button[aria-label="productionUi.pd50e0839b9"]');const del=q('button[aria-label="productionUi.p045efb886f"]');const coverBtn=q('[data-btn=cover]');
 const bdcs=bd?getComputedStyle(bd):null;
 return {
  html:document.documentElement.className,
  routeCount:qa('.trip-detail-route').length,hostCount:qa('.trip-duo-laptop-map').length,
  routeParentIsContent:!!route&&route.parentElement===content,
  contentChildren:[...content.children].map(e=>e.tagName+'.'+(e.className||'')+(e.getAttribute('role')?'[role='+e.getAttribute('role')+']':'')),
  sameRoute:route===window.__route&&!!route&&route.isConnected,
  sameEditor:q('[data-editor-root]')===window.__editor&&!!window.__editor&&window.__editor.isConnected,
  token:q('[data-editor-root]')?.dataset.token??null,count:q('[data-editor-root]')?.dataset.count??null,
  editorMounts:window.__editorMounts,editorUnmounts:window.__editorUnmounts,
  mapCtor:window.__mapCtor,mapCtorSizes:window.__mapCtorSizes,loadCalls:window.__loadCalls,smallWarn:window.__smallWarn,
  tabs:qa('[role=tab]').map(t=>t.id),selectedTab:q('[role=tab][aria-selected=true]')?.id??null,
  scrollers,scrollTop:route?route.scrollTop:null,
  mainPadTop:getComputedStyle(main).paddingTop,
  routeRect:R(route),routePos:route?getComputedStyle(route).position:null,navRect:R(q('#nav')),
  cover:R(cover),header:R(hdr),sentinel:R(sentinel),bar:R(bar),barTopCss:bar?getComputedStyle(bar).top:null,barZ:bar?getComputedStyle(bar).zIndex:null,
  back:R(back),share:R(share),del:R(del),coverBtn:R(coverBtn),
  hits:{back:hitOk(back),share:hitOk(share),del:hitOk(del),cover:hitOk(coverBtn)},
  backdrop:bd?{rect:R(bd),display:bdcs.display,position:bdcs.position,top:bdcs.top,z:bdcs.zIndex,bg:bdcs.backgroundColor,pe:bdcs.pointerEvents,offsetH:bd.offsetHeight,parentIsRoot:bd.parentElement===q('[data-editor-root]'),nextIsSentinel:bd.nextElementSibling===sentinel}:null,
  panel:panel?{inRoute:!!route&&route.contains(panel),hidden:panel.classList.contains('hidden'),h:panel.getBoundingClientRect().height,gmap:!!panel.querySelector('[class*="min-h-[320px]"]')}:null,
  paneRegion:paneRegion?{noSwipe:paneRegion.hasAttribute('data-no-page-swipe'),inRoute:!!route&&route.contains(paneRegion)}:null,
  duoLaptopHookCalls:window.__duoLaptopHookCalls||0,
 };};
// A/B 量測：#root 內所有元素（排除底板）的位置與關鍵 computed style
window.snapshot=()=>{const out=[];const props=['position','top','display','paddingTop','marginTop','marginBottom','zIndex','aspectRatio','height','width','overflowY','transform'];
 for(const e of document.querySelectorAll('#root *')){if(e.classList.contains('trip-duo-status-backdrop'))continue;const cs=getComputedStyle(e);const b=e.getBoundingClientRect();
  out.push([e.tagName,(typeof e.className==='string'?e.className:'').slice(0,40),Math.round(b.left*10)/10,Math.round(b.top*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10,...props.map(p=>cs[p])].join('|'));}
 return out;};
window.removeBackdrop=()=>{const bd=q('.trip-duo-status-backdrop');window.__bdParent=bd.parentElement;window.__bdNext=bd.nextSibling;window.__bd=bd;bd.remove();return true;};
window.restoreBackdrop=()=>{window.__bdParent.insertBefore(window.__bd,window.__bdNext);return true;};
window.openOverlay=async(kind)=>{const btn=kind==='share'?q('button[aria-label="productionUi.pd50e0839b9"]'):q('button[aria-label="productionUi.p045efb886f"]');
 flushSync(()=>btn.click());await window.raf2();await new Promise(r=>setTimeout(r,50));
 const el=kind==='share'?q('[role=dialog][data-state=open]'):q('[role=alertdialog][data-state=open]');
 if(!el)return null;const route=q('.trip-detail-route');const inner=kind==='share'?el.querySelector('[data-btn=share-inner]'):el.querySelector('button');
 return {inRoute:route.contains(el),inRootTree:q('#root').contains(el),parentIsBodyChild:el.closest('body > *')!==q('#root'),anc:ancestorIssues(el),rect:R(el),pos:getComputedStyle(el).position,hitInner:hitOk(inner),vw:innerWidth,vh:innerHeight};};
window.closeOverlay=async()=>{const t=document.activeElement||document.body;t.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await window.raf2();await new Promise(r=>setTimeout(r,50));
 return !q('[role=dialog][data-state=open],[role=alertdialog][data-state=open]');};
window.__ready=true;`;

function decodePng(buf) {
  let off = 8;
  let w, h, ct, bd;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bd = data[8];
      ct = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  assert.equal(bd, 8, "PNG bit depth");
  assert.ok(ct === 6 || ct === 2, "PNG color type " + ct);
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, out, stride };
}
function countRed(png) {
  let n = 0;
  for (let y = 0; y < png.h; y++)
    for (let x = 0; x < png.w; x++) {
      const i = y * png.stride + x * png.bpp;
      if (png.out[i] > 200 && png.out[i + 1] < 70 && png.out[i + 2] < 70) n++;
    }
  return n;
}

if (!chromeBin) {
  failures.push("無可用 Chrome");
  console.log("FAIL 無可用 Chrome，未執行");
} else {
  await run();
}

async function run() {
  const { build } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-trip-render-"));
  const compileCss = async (src) => {
    const compiler = await compile(src.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    return compiler.build(new Scanner({ sources: compiler.sources }).scan());
  };
  // #DT1 區塊（註解起點～下一個區塊註解）
  const dt1Head = styles.indexOf(" * #DT1：");
  const dt1Start = styles.lastIndexOf("/*", dt1Head);
  const dt1End = styles.indexOf("/*", styles.indexOf("*/", dt1Head) + 2);
  assert.ok(dt1Head > 0 && dt1End > dt1Start, "找不到 #DT1 區塊");
  const cssA = await compileCss(styles);
  const cssB = await compileCss(styles.slice(0, dt1Start) + styles.slice(dt1End));
  assert.match(cssA, /trip-duo-status-backdrop/);
  assert.doesNotMatch(cssB, /trip-duo-status-backdrop|--trip-duo-top/);

  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "app.js"),
    format: "iife",
    jsx: "automatic",
    jsxDev: true,
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: {
      "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}',
      "process.env.NODE_ENV": '"development"',
    },
    plugins: [
      {
        name: "mocks",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
        },
      },
    ],
  });

  const NO_ANIM = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}";
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, "app.js")));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="cssA">' +
        cssA +
        '</style><style id="cssB" media="not all">' +
        cssB +
        "</style><style>" +
        NO_ANIM +
        '</style></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const externalRequests = [];
  const browserErrors = [];
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
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const r = JSON.parse(e.data);
      if (r.method === "Runtime.exceptionThrown") browserErrors.push(r.params.exceptionDetails.exception?.description);
      if (r.method === "Runtime.consoleAPICalled" && r.params.type === "error")
        browserErrors.push("console.error: " + r.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 400));
      if (r.method === "Network.requestWillBeSent") {
        const u = r.params.request.url;
        if (!/^(data:|blob:|about:|http:\/\/127\.0\.0\.1:)/.test(u)) externalRequests.push(u);
      }
      if (r.id && pending.has(r.id)) {
        const p = pending.get(r.id);
        pending.delete(r.id);
        r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const next = ++id;
        pending.set(next, { resolve, reject });
        ws.send(JSON.stringify({ id: next, method, params, sessionId }));
      });
    const { targetInfos } = await send("Target.getTargets");
    const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails));
      return r.result.value;
    };
    const setViewport = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await call("Runtime.enable");
    await call("Network.enable");
    await setViewport(VW, VH);
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.join("\n"));

    const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.6, `${msg}: ${a} vs ${b}`);
    const mount = async (o) => {
      await evaluate(`window.mount(${JSON.stringify(o)})`);
      for (let i = 0; i < 50 && !(await evaluate("window.loaded()")); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(await evaluate("window.loaded()"), "行程未載入");
      await evaluate("window.raf2()");
    };
    const posture = async (name) => {
      await evaluate(`window.setPosture(${JSON.stringify(name)})`);
      await evaluate("window.raf2()");
      return evaluate("window.inspect()");
    };
    const inspect = () => evaluate("window.inspect()");
    const clickTab = async (v) => {
      await evaluate(`window.clickTab(${JSON.stringify(v)})`);
      await evaluate("window.raf2()");
      return inspect();
    };
    const scrollTo = async (y) => {
      await evaluate(`window.scrollRoute(${y})`);
      await evaluate("window.raf2()");
      return inspect();
    };
    const shotBand = async (height, width) => {
      const r = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
      return decodePng(Buffer.from(r.data, "base64"));
    };

    // ── S：上下版型（筆電／直向攤平 × 底部導覽／右側直欄；右側直欄另測 safe-area-top 0 → Duo 頂部留白 14px）──
    const STACKED = [
      { name: "laptopBottom", rail: false, safeTop: 24, S: 24 },
      { name: "laptopRail", rail: true, safeTop: 24, S: 24 },
      { name: "flatBottom", rail: false, safeTop: 24, S: 24 },
      { name: "flatRail", rail: true, safeTop: 24, S: 24 },
      { name: "laptopRail", rail: true, safeTop: 0, S: 14 },
      { name: "flatRail", rail: true, safeTop: 0, S: 14 },
    ];
    for (const c of STACKED) {
      const tag = `${c.name} safeTop=${c.safeTop}`;
      const cw = VW - (c.rail ? RAIL : 0);
      await mount({ posture: c.name, safeTop: c.safeTop });
      const m0 = await inspect();
      await check(`S1 ${tag}：單一捲動容器、無 host、main 頂部內距 0、捲動容器 [0, ${c.rail ? "視窗底" : "導覽上緣"}]`, () => {
        assert.match(m0.html, c.name.startsWith("laptop") ? /\bduo-laptop\b/ : /\bduo-flat-portrait\b/);
        assert.deepEqual(m0.scrollers, ["trip-detail-route"], "捲動容器：" + JSON.stringify(m0.scrollers));
        assert.equal(m0.routeCount, 1);
        assert.equal(m0.hostCount, 0, "不得有 .trip-duo-laptop-map");
        assert.equal(m0.contentChildren.length, 1, JSON.stringify(m0.contentChildren));
        assert.equal(m0.paneRegion, null);
        assert.equal(m0.mainPadTop, "0px");
        assert.equal(m0.routePos, "static");
        near(m0.routeRect.t, 0, "route top");
        near(m0.routeRect.l, 0, "route left");
        near(m0.routeRect.r, cw, "route right");
        near(m0.routeRect.b, c.rail ? VH : VH - NAV_H, "route bottom");
      });
      await check(`S2 ${tag}：封面頂端＝0、3:2、寬＝內容寬 ${cw}`, () => {
        near(m0.cover.t, 0, "cover top");
        near(m0.cover.w, cw, "cover width");
        near(m0.cover.h, (cw * 2) / 3, "cover 3:2");
      });
      await check(`S3 ${tag}：返回／分享／刪除 top＝狀態列 ${c.S}px＋12px、可點；更換封面在封面右下`, () => {
        near(m0.back.t, c.S + 12, "back top");
        near(m0.share.t, c.S + 12, "share top");
        assert.ok(m0.del && m0.del.t >= m0.share.b, "刪除鈕在分享鈕下方：" + JSON.stringify(m0.del));
        assert.ok(m0.back.t >= c.S && m0.share.t >= c.S, "按鈕不得進入狀態列");
        assert.deepEqual(m0.hits, { back: true, share: true, del: true, cover: true }, "按鈕被遮擋");
        near(m0.coverBtn.b, m0.cover.b - 12, "更換封面 bottom");
        near(m0.coverBtn.r, m0.cover.r - 12, "更換封面 right");
      });
      await check(`S4a ${tag}：底板 display:block、sticky top 0、高 ${c.S}、z 10 < 切換列 z 20、不透明、不攔截點擊、不佔版面`, () => {
        const b = m0.backdrop;
        assert.ok(b, "缺底板");
        assert.equal(b.display, "block");
        assert.equal(b.position, "sticky");
        assert.equal(b.top, "0px");
        assert.equal(b.offsetH, c.S);
        assert.equal(b.z, "10");
        assert.equal(m0.barZ, "20");
        assert.equal(b.pe, "none");
        assert.ok(!/transparent|rgba\(0, 0, 0, 0\)|\/\s*(0|0?\.\d+)\s*\)/.test(b.bg), "底板背景須不透明：" + b.bg);
        assert.ok(b.parentIsRoot && b.nextIsSentinel, "底板位置");
        near(m0.sentinel.t, m0.header.b, "底板不佔版面（切換列哨兵緊接 header）");
        assert.equal(m0.barTopCss, c.S + "px");
      });
      const m1 = await scrollTo(100000);
      const band = await shotBand(c.S, cw);
      await evaluate("document.querySelector('.trip-duo-status-backdrop').style.visibility='hidden'");
      const bandNoBd = await shotBand(c.S, cw);
      await evaluate("document.querySelector('.trip-duo-status-backdrop').style.visibility=''");
      await check(`S4b ${tag}：捲動後切換列吸在 ${c.S}px、底板 [0, ${c.S}]；狀態列帶無內容透出（對照：隱藏底板時透出）`, () => {
        assert.ok(m1.scrollTop > m0.sentinel.t + 40, "未捲過切換列原位：" + m1.scrollTop + " / " + m0.sentinel.t);
        near(m1.bar.t, c.S, "bar top");
        near(m1.backdrop.rect.t, 0, "backdrop top");
        near(m1.backdrop.rect.b, c.S, "backdrop bottom");
        assert.equal(countRed(band), 0, "狀態列帶出現內容（紅色）像素");
        assert.ok(countRed(bandNoBd) > band.w * band.h * 0.5, "對照組應透出內容：" + countRed(bandNoBd));
      });

      // S5 分頁：點擊（首次進入分頁時切換列停在狀態列下方）、左右滑
      const t1 = await clickTab("overview");
      const t2 = await clickTab("map");
      const t3 = await clickTab("trip");
      const s1 = await evaluate("window.swipe('next')");
      const s2 = await evaluate("window.swipe('next')");
      const s3 = await evaluate("window.swipe('next')");
      const s4 = await evaluate("window.swipe('prev')");
      const s5 = await evaluate("window.swipe('prev')");
      const mS = await inspect();
      await check(`S5 ${tag}：三分頁點擊與左右滑（行程→總覽→地圖→（邊界）→總覽→行程）`, () => {
        assert.deepEqual(m0.tabs, ["trip-workspace-tab-trip", "trip-workspace-tab-overview", "trip-workspace-tab-map"]);
        assert.equal(t1.selectedTab, "trip-workspace-tab-overview");
        near(t1.bar.t, c.S, "切到總覽後切換列位置");
        assert.equal(t2.selectedTab, "trip-workspace-tab-map");
        assert.equal(t3.selectedTab, "trip-workspace-tab-trip");
        assert.deepEqual([s1, s2, s3, s4, s5], [
          "trip-workspace-tab-overview",
          "trip-workspace-tab-map",
          "trip-workspace-tab-map",
          "trip-workspace-tab-overview",
          "trip-workspace-tab-trip",
        ]);
        assert.equal(mS.routeCount, 1);
      });
      await check(`S6 ${tag}：地圖首次顯示才掛載、Map 建構 1 次（StrictMode）、切走 hidden 不重建、無尺寸過小重試`, () => {
        assert.equal(m0.panel, null, "地圖分頁首次顯示前不得掛載");
        assert.equal(m0.mapCtor, 0);
        assert.equal(m0.loadCalls, 0, "Maps JS 不得提前載入");
        assert.equal(t1.mapCtor, 0, "切到總覽不得載入地圖");
        assert.ok(t2.panel && t2.panel.inRoute && !t2.panel.hidden && t2.panel.h > 0 && t2.panel.gmap, "地圖分頁：" + JSON.stringify(t2.panel));
        assert.equal(t2.mapCtor, 1, "Map 建構次數");
        assert.ok(t2.mapCtorSizes.every(([w, h]) => w >= 8 && h >= 8), "建構時容器尺寸：" + JSON.stringify(t2.mapCtorSizes));
        assert.ok(t3.panel && t3.panel.hidden && t3.panel.inRoute, "切走後 hidden 仍在 DOM");
        assert.equal(mS.mapCtor, 1, "來回切換不得重建地圖");
        assert.equal(mS.smallWarn, 0, "出現「容器尺寸過小」重試");
      });

      // S7 浮層
      const ov1 = await evaluate("window.openOverlay('share')");
      const cl1 = await evaluate("window.closeOverlay()");
      const ov2 = await evaluate("window.openOverlay('delete')");
      const cl2 = await evaluate("window.closeOverlay()");
      await check(`S7 ${tag}：分享 Sheet／刪除確認 portal 到 body、祖先鏈無捲動容器／transform、在視窗內可點${c.name.startsWith("laptop") ? "、不跨摺痕（下半部）" : ""}`, () => {
        for (const [k, o] of [["share", ov1], ["delete", ov2]]) {
          assert.ok(o, k + " 未開啟");
          assert.equal(o.inRoute, false, k + " 在捲動容器內");
          assert.equal(o.inRootTree, false, k + " 未 portal 出 #root");
          assert.deepEqual(o.anc, [], k + " 祖先鏈");
          assert.equal(o.pos, "fixed");
          assert.ok(o.rect.t >= -0.5 && o.rect.b <= VH + 0.5 && o.rect.l >= -0.5 && o.rect.r <= cw + 0.5, k + " 超出可視範圍：" + JSON.stringify(o.rect));
          assert.ok(o.rect.h > 50, k + " 高度：" + o.rect.h);
          assert.equal(o.hitInner, true, k + " 內容不可點");
          if (c.name.startsWith("laptop")) assert.ok(o.rect.t >= BOTTOM - 0.5, k + " 跨摺痕：" + o.rect.t);
        }
        assert.equal(cl1, true, "分享 Sheet 未關閉");
        assert.equal(cl2, true, "刪除確認未關閉");
      });
    }

    // ── N1：非上下版型：底板隱藏、CSS A/B 相同、移除底板相同 ──
    const NON = [
      { name: "phone", vw: VW, vh: VH },
      { name: "duoFolded", vw: VW, vh: VH },
      { name: "twoPane", vw: VW, vh: VH },
      { name: "twoPaneAndLaptop", vw: VW, vh: VH },
      { name: "twoPaneAndFlat", vw: VW, vh: VH },
      { name: "phone", vw: 820, vh: 1180, label: "iPad" },
      { name: "phone", vw: 1280, vh: 800, label: "web" },
    ];
    for (const c of NON) {
      const tag = c.label ? `${c.label}（${c.vw}×${c.vh}）` : c.name;
      await setViewport(c.vw, c.vh);
      await mount({ posture: c.name });
      const m = await inspect();
      const diffs = [];
      const bdDiffs = [];
      for (const y of [0, 700]) {
        await scrollTo(y);
        await evaluate("window.useCss('A')");
        const a = await evaluate("window.snapshot()");
        await evaluate("window.useCss('B')");
        const b = await evaluate("window.snapshot()");
        await evaluate("window.useCss('A')");
        await evaluate("window.removeBackdrop()");
        const nb = await evaluate("window.snapshot()");
        await evaluate("window.restoreBackdrop()");
        a.forEach((s, i) => s !== b[i] && diffs.push(`y=${y} #${i}\n A ${s}\n B ${b[i]}`));
        if (a.length !== b.length) diffs.push("length " + a.length + " vs " + b.length);
        a.forEach((s, i) => s !== nb[i] && bdDiffs.push(`y=${y} #${i}\n 有 ${s}\n 無 ${nb[i]}`));
      }
      await check(`N1 ${tag}：底板 display:none／高 0；移除 #DT1 CSS 前後量測相同（捲動 0／700）；移除底板節點前後相同`, () => {
        assert.doesNotMatch(m.html, /duo-laptop|duo-flat-portrait/);
        assert.ok(m.backdrop, "底板節點（指派者接受：所有裝置輸出、display:none）");
        assert.equal(m.backdrop.display, "none");
        assert.equal(m.backdrop.offsetH, 0);
        assert.notEqual(m.mainPadTop, "0px");
        assert.equal(m.hostCount, 0);
        assert.deepEqual(diffs.slice(0, 3), [], "CSS A/B 差異 " + diffs.length);
        assert.deepEqual(bdDiffs.slice(0, 3), [], "移除底板差異 " + bdDiffs.length);
      });
    }
    await setViewport(VW, VH);

    // N2：對照——上下版型移除 #DT1 時量測不同（A/B 有效）
    for (const name of ["laptopBottom", "flatRail"]) {
      await mount({ posture: name });
      await evaluate("window.useCss('A')");
      const a = await evaluate("window.snapshot()");
      await evaluate("window.useCss('B')");
      const b = await evaluate("window.snapshot()");
      await evaluate("window.useCss('A')");
      await check(`N2 對照 ${name}：移除 #DT1 CSS 時量測不同（A/B 偵測有效）`, () => {
        assert.ok(a.some((s, i) => s !== b[i]), "A/B 無差異，N1 的比對無效");
      });
    }

    // ── R2：非上下版型結構（沿用 #H2a-fix）──
    for (const name of ["phone", "duoFolded"]) {
      await mount({ posture: name });
      const m0 = await inspect();
      const m1 = await clickTab("map");
      const m2 = await clickTab("trip");
      await check(`R2 ${name}：單欄地圖分頁在捲動容器內、首次顯示才掛載、切走只 hidden`, () => {
        assert.equal(m0.routeCount, 1);
        assert.equal(m0.routeParentIsContent, true);
        assert.equal(m0.contentChildren.length, 1, JSON.stringify(m0.contentChildren));
        assert.equal(m0.hostCount, 0);
        assert.equal(m0.panel, null);
        assert.equal(m0.mapCtor, 0);
        assert.deepEqual(m0.tabs, ["trip-workspace-tab-trip", "trip-workspace-tab-overview", "trip-workspace-tab-map"]);
        assert.ok(m1.panel && m1.panel.inRoute && !m1.panel.hidden && m1.panel.h > 0, JSON.stringify(m1.panel));
        assert.equal(m1.mapCtor, 1);
        assert.ok(m2.panel && m2.panel.hidden);
        assert.equal(m2.mapCtor, 1);
        assert.notEqual(m2.routePos, "fixed");
      });
    }
    for (const name of ["twoPane", "twoPaneAndLaptop", "twoPaneAndFlat"]) {
      await mount({ posture: name });
      await evaluate("window.frames(4)");
      const m = await inspect();
      await check(`R2 ${name}：地圖在右欄 region、無 host、無地圖分頁鈕、無上下版型 class`, () => {
        assert.doesNotMatch(m.html, /duo-laptop|duo-flat-portrait/);
        assert.equal(m.hostCount, 0);
        assert.ok(m.paneRegion && m.paneRegion.noSwipe && !m.paneRegion.inRoute, JSON.stringify(m.paneRegion));
        assert.equal(m.panel, null);
        assert.equal(m.mapCtor, 1);
        assert.deepEqual(m.tabs, ["trip-workspace-tab-trip", "trip-workspace-tab-overview"]);
        assert.equal(m.contentChildren.length, 3, JSON.stringify(m.contentChildren));
      });
    }

    // ── R3：姿勢切換不 remount 捲動容器／編輯器 ──
    await mount({ posture: "phone" });
    const base = await evaluate("window.saveNodes()");
    await evaluate("window.bump()");
    await evaluate("window.bump()");
    const r0 = await inspect();
    const SEQ = ["laptopBottom", "phone", "flatBottom", "laptopBottom", "duoFolded", "laptopRail", "flatRail", "twoPane", "twoPaneAndLaptop", "flatRail", "laptopRail", "laptopBottom", "phone"];
    const seen = [];
    for (const name of SEQ) seen.push([name, await posture(name)]);
    await check("R3 StrictMode：姿勢切換（含筆電↔直向攤平、單一元素 ↔ Fragment）捲動容器與編輯器不 remount、state 保留", () => {
      assert.equal(r0.count, "2");
      for (const [name, m] of seen) {
        assert.equal(m.sameRoute, true, `${name}：.trip-detail-route 被替換`);
        assert.equal(m.sameEditor, true, `${name}：編輯器根節點被替換`);
        assert.equal(m.token, base.token, `${name}：編輯器 state 被重設`);
        assert.equal(m.count, "2", `${name}：編輯器 counter 被重設`);
        assert.equal(m.editorMounts, r0.editorMounts, `${name}：編輯器 mount effect 增加`);
        assert.equal(m.editorUnmounts, r0.editorUnmounts, `${name}：編輯器 unmount effect 增加`);
        assert.equal(m.routeCount, 1, name);
      }
    });
    await check("R3b 切換途中各姿勢結構正確（上下版型＝一頁式三分頁＋底板顯示；雙欄右欄；單欄底板隱藏）", () => {
      for (const [name, m] of seen) {
        assert.equal(m.hostCount, 0, name + "：不得有 host");
        if (name.startsWith("twoPane")) {
          assert.ok(m.paneRegion, name);
          assert.equal(m.backdrop.display, "none", name);
        } else {
          assert.equal(m.contentChildren.length, 1, name + " " + JSON.stringify(m.contentChildren));
          assert.equal(m.tabs.length, 3, name);
          const stacked = /^(laptop|flat)/.test(name);
          assert.equal(m.backdrop.display, stacked ? "block" : "none", name + " 底板");
          assert.equal(m.mainPadTop === "0px", stacked, name + " main padding-top " + m.mainPadTop);
          near(m.cover.t, stacked ? 0 : 24, name + " cover top");
        }
      }
    });

    // ── R4：對照 ──
    await mount({ posture: "phone", keyedWrap: true });
    const kb = await evaluate("window.saveNodes()");
    await evaluate("window.bump()");
    const k1 = await posture("laptopRail");
    await check("R4 對照：key 改變的包裝會 remount（R3 偵測方式有效）", () => {
      assert.equal(k1.sameRoute, false);
      assert.notEqual(k1.token, kb.token);
      assert.equal(k1.count, "0");
    });

    // ── R5：?view=map 進入上下版型 ──
    await mount({ posture: "phone", initialView: "map" });
    const v0 = await inspect();
    const v1 = await posture("laptopBottom");
    const v2 = await posture("flatRail");
    const v3 = await posture("phone");
    await check("R5 ?view=map：手機→筆電→直向攤平→手機 皆停在地圖分頁、地圖在捲動容器內、不重建", () => {
      for (const [n, v] of [["phone", v0], ["laptopBottom", v1], ["flatRail", v2], ["phone(back)", v3]]) {
        assert.equal(v.selectedTab, "trip-workspace-tab-map", n);
        assert.ok(v.panel && v.panel.inRoute && !v.panel.hidden && v.panel.h > 0, n + "：" + JSON.stringify(v.panel));
        assert.equal(v.hostCount, 0, n);
        assert.equal(v.mapCtor, 1, n + "：Map 建構次數");
      }
    });
    await mount({ posture: "flatBottom", initialView: "map" });
    const v4 = await inspect();
    await check("R5b 直接以 ?view=map 掛載於直向攤平：地圖分頁選取、地圖顯示、Map 建構 1 次", () => {
      assert.equal(v4.selectedTab, "trip-workspace-tab-map");
      assert.ok(v4.panel && !v4.panel.hidden && v4.panel.h > 0, JSON.stringify(v4.panel));
      assert.equal(v4.mapCtor, 1);
      assert.equal(v4.smallWarn, 0);
    });

    // ── R7：雙欄→上下版型（之前開過地圖分頁）：隱藏中重新掛載的地圖不得反覆重試／報錯 ──
    //   第二組（Duo 合起單欄）不涉及 #DT1，用來判斷問題是否為既有行為。
    for (const single of ["flatBottom", "laptopRail", "duoFolded"]) {
      const errBefore = browserErrors.length;
      await mount({ posture: single });
      await clickTab("map");
      await clickTab("trip");
      await posture("twoPane");
      await evaluate("window.frames(4)");
      const w0 = await inspect();
      await posture(single);
      await evaluate("window.frames(60)");
      const w1 = await inspect();
      const errsR7 = browserErrors.slice(errBefore);
      const w2 = await clickTab("map");
      await evaluate("window.frames(10)");
      const w3 = await inspect();
      browserErrors.splice(errBefore); // R7 的錯誤只在 R7 報告，不重複計入 R6
      await check(`R7 雙欄→${single}（地圖分頁曾開過、目前在行程分頁）：隱藏的地圖不得「容器尺寸過小」重試或報「地圖容器高度為 0」；再切到地圖分頁時地圖可初始化`, () => {
        console.log(`     （資訊）Map 建構：雙欄 ${w0.mapCtor}、回 ${single} ${w1.mapCtor}、切到地圖 ${w3.mapCtor}；尺寸過小重試 ${w1.smallWarn}；地圖容器錯誤 ${errsR7.filter((e) => /地圖容器/.test(e)).length}；panel ${JSON.stringify(w1.panel)}`);
        const problems = [];
        if (w1.smallWarn !== 0) problems.push("隱藏中的地圖反覆重試初始化 " + w1.smallWarn + " 次");
        const errs = errsR7.filter((e) => /地圖容器/.test(e));
        if (errs.length) problems.push("console.error：" + errs[0].slice(0, 120));
        if (w2.selectedTab !== "trip-workspace-tab-map") problems.push("未切到地圖分頁");
        if (!(w3.mapCtor > w0.mapCtor)) problems.push("切到地圖分頁後地圖未初始化（Map 建構次數 " + w0.mapCtor + " → " + w3.mapCtor + "）");
        assert.deepEqual(problems, []);
      });
    }

    await check("R6 無外部請求、無瀏覽器例外／console.error；TripDetailScreen 未呼叫 use-duo-laptop", async () => {
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(browserErrors, []);
      assert.equal((await inspect()).duoLaptopHookCalls, 0);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

console.log(failures.length ? `\nverify-duo-laptop-trip-render: FAIL (${failures.length})` : "\nverify-duo-laptop-trip-render: PASS");
process.exit(failures.length ? 1 : 0);
