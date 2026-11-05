// verify-trip-subpage-header-keyboard.mjs — 任務單 #TS-UX3：「新增花費」Sheet 鍵盤處理＋備註自動長高（獨立審查）
//
// 以 headless Chrome（390×844 mobile 模擬）＋React development build＋<StrictMode> 真實 render ExpenseSheet，
// 套用真實 Tailwind 產出（dist/client/assets/styles-*.css），量測幾何：
//   （#TS-EXPENSE-KB 起：鍵盤開啟改用 SheetContent inline bottom＋maxHeight，不再用 paddingBottom；
//    欄位顯示改由 revealInScroller 只捲 [data-expense-scroll]，不再 scrollIntoView）
//   K0 測試環境：開啟 focus emulation，確認 focus() 會觸發 focusin（否則 onFocusCapture 測不到）
//   K1 網頁版、無 Capacitor、無鍵盤：無 inline bottom／maxHeight／paddingBottom、不裝 Keyboard listener、focus 不亂捲、無例外
//   K2 網頁版 visualViewport（假 vv，WebView 未縮）：鍵盤高度 → inline bottom＝鍵盤高＋maxHeight；<=50 視為無鍵盤；
//      上限 55% innerHeight；收起後 inline style 清除；只捲內容區、不 scrollIntoView、不捲 window；關閉解除 listener
//   K3 原生（window.Capacitor.isNativePlatform）：真實 capacitor-keyboard-bridge＋mock @capacitor/keyboard 事件 →
//      inline bottom；忽略 vv；keyboardWillHide 清除；關閉後 subscriber 解除（之後的事件不影響）、重開清除
//   K4 鍵盤升起後（備註、名稱、金額）：Sheet 底貼鍵盤上緣；欄位與 label 在內容區可視範圍；「儲存」貼鍵盤上方且
//      elementFromPoint 可點；只捲內容區；K4r 收起後 inline style 清除、高度恢復
//   K5 原生但 WebView innerHeight 也縮（以 Emulation 真的改 viewport 觸發 resize）：bottom 扣掉已縮的量，不重複墊高；
//      內容區高度 > 0 且足以顯示欄位；全縮／部分縮／再次 willShow／收起後再開／resize 早於 willShow 的競態
//   K6（INFO）網頁版 Android 型（innerHeight 與 vv 一起縮）量測
//   N1 備註：空白 40px（與名稱欄同高）、上下 padding 相等（「選填」垂直置中）、靠左；多行長高；上限 100px（4 行）後框內捲動；
//      刪回空白縮回 40px
//   N2 名稱／日期：標題在框上方（block）、兩框等高
//
// 「我的行李」「共同記帳」標題列幾何（safe-area-top／Duo）在 verify-trip-packing-stage5.mjs（R14）與
// verify-trip-expenses-ui-stage4.mjs（R21）。
//
// 不讀 .env、不連網（瀏覽器只連 127.0.0.1 fixture server）。執行：node scripts/verify-trip-subpage-header-keyboard.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let passCount = 0;
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 24).join("\n     "));
  }
}
const info = (s) => console.log("INFO " + s);

const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

// ── 真實 Tailwind CSS（沒有 dist 時無法量測幾何 → FAIL，不用假規則冒充）──
const cssDir = path.join(root, "dist/client/assets");
const distCss = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).find((f) => /^styles-.*\.css$/.test(f)) : null;
const appCss = distCss
  ? fs.readFileSync(path.join(cssDir, distCss), "utf8").replace(/@import\s*(?:url\()?\s*(?:"[^"]*"|'[^']*'|[^)"';]*)\s*\)?[^;]*;/g, "")
  : "";
const NEEDED = [".fixed{", ".bottom-0{", ".max-h-\\[92dvh\\]", ".flex-col{", ".min-h-0{", ".flex-1{", ".overflow-y-auto{", ".min-h-10{", ".leading-5{", ".py-2\\.5{", ".h-10{", ".block{", ".resize-none{", ".w-full{"];
const missingCss = NEEDED.filter((n) => !appCss.includes(n));
info("CSS：" + (distCss ? "dist/client/assets/" + distCss : "（無 dist CSS）") + (missingCss.length ? "；缺少 " + missingCss.join(" ") : ""));
info("注意：dist CSS 為上次 build 的產出；若本輪新增的 class 不在其中，量測會以缺漏列出。");

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-tsux3-"));
function mockPlugin(mocks) {
  return {
    name: "mocks",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
    },
  };
}
const mocks = {
  "@/components/profile/ProfileAvatar": `export const ProfileAvatar=()=> <span data-avatar=""/>;`,
  // 原生 Keyboard plugin：記錄 addListener，事件由測試觸發（真實 capacitor-keyboard-bridge 照常運作）
  "@capacitor/keyboard": `const L=window.__capL||(window.__capL={});
export const Keyboard={addListener:(ev,fn)=>{(L[ev]||(L[ev]=[])).push(fn);window.__capAdds=(window.__capAdds||0)+1;return Promise.resolve({remove:async()=>{}});}};`,
  "@/lib/capacitor-bridge-ready": `export const isCapacitorBridgeReady=()=>true;export const waitForDocumentLoaded=async()=>{};export const waitForCapacitorBridge=async()=>true;
export async function runWhenCapacitorBridgeReady(_n,fn){return fn();}`,
  "@/lib/app-perf": `export * from ${JSON.stringify(path.join(root, "src/lib/app-perf.ts"))};
export function logPerfKeyboardListener(action,detail){(window.__kbLog||(window.__kbLog=[])).push({action,count:detail&&detail.count,subscribers:detail&&detail.subscribers});}`,
  "@/integrations/supabase/client": `export const supabase={rpc:()=>Promise.resolve({data:null,error:{message:'no backend in verify'}}),from:()=>({select(){return this;}}),
 auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:async()=>{}};
export const isSupabaseConfigured=()=>true;`,
};

// 注意：fixture 原始碼不使用反引號與 $-大括號插值
const entry = `import React,{StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {ExpenseSheet} from '@/components/trip/expenses/ExpenseSheet';
import {getTripExpensesCopy} from '@/lib/i18n/trip-workspace-copy';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
const A='aaaaaaaa-0000-4000-8000-000000000001';const B='bbbbbbbb-0000-4000-8000-000000000002';
const COPY=getTripExpensesCopy('zh-TW');window.COPY=COPY;
const members=[A,B].map(function(u,i){return {id:'m'+i,trip_id:'t',user_id:u,is_owner:i===0,status:'accepted',invited_by:null,created_at:'2026-10-01T00:00:00Z',profiles:{id:u,display_name:i?'Ben':'Amy',avatar_url:null,updated_at:null}};});
const resolvePerson=function(u){return {userId:u,name:u===A?'Amy':'Ben',avatarUrl:null,profile:null,isMember:true,isMe:u===A,isDeleted:false};};
const noop=function(){};
// scrollIntoView 呼叫紀錄（新做法不應呼叫：iOS 上會連帶捲動 WebView／視窗）
const realSIV=Element.prototype.scrollIntoView;window.__siv=[];
Element.prototype.scrollIntoView=function(o){window.__siv.push({tag:this.tagName,ph:this.getAttribute('placeholder'),opt:o});return realSIV.call(this,o);};
// 視窗層級捲動呼叫與所有 scroll 事件目標（capture）：只允許 Sheet 內容區（data-expense-scroll）與備註框自身
window.__winScrollCalls=[];['scrollTo','scrollBy','scroll'].forEach(function(k){const f=window[k];window[k]=function(){window.__winScrollCalls.push(k);return f.apply(window,arguments);};});
window.__scrollTargets=[];document.addEventListener('scroll',function(e){const t=e.target;window.__scrollTargets.push(t===document||t===document.documentElement||t===document.body?'document':(t.hasAttribute&&t.hasAttribute('data-expense-scroll')?'expense-scroll':t.tagName));},true);
window.resetScrollLog=function(){window.__siv=[];window.__winScrollCalls=[];window.__scrollTargets=[];return true;};
window.scrollLog=function(){return {siv:window.__siv.slice(),win:window.__winScrollCalls.slice(),targets:window.__scrollTargets.slice(),winY:window.scrollY,docTop:document.documentElement.scrollTop,bodyTop:document.body.scrollTop};};
// 假 visualViewport（網頁版鍵盤模擬）：記錄 listener 增減
window.installFakeVV=function(){const t=new EventTarget();const vv={height:window.innerHeight,width:window.innerWidth,offsetTop:0,offsetLeft:0,scale:1,adds:0,removes:0,live:{}};
  vv.addEventListener=function(ty,fn,o){vv.adds+=1;vv.live[ty]=(vv.live[ty]||0)+1;return t.addEventListener(ty,fn,o);};
  vv.removeEventListener=function(ty,fn,o){vv.removes+=1;vv.live[ty]=(vv.live[ty]||0)-1;return t.removeEventListener(ty,fn,o);};
  vv.fire=function(ty){t.dispatchEvent(new Event(ty));};
  Object.defineProperty(window,'visualViewport',{configurable:true,get:function(){return vv;}});window.__vv=vv;return true;};
window.vvSet=function(h,type){window.__vv.height=h;flushSync(function(){window.__vv.fire(type||'resize');});return true;};
window.setNative=function(on){if(on)window.Capacitor={isNativePlatform:function(){return true;}};else delete window.Capacitor;return true;};
window.capFire=function(ev,h){const fns=(window.__capL||{})[ev]||[];flushSync(function(){fns.forEach(function(f){f({keyboardHeight:h});});});return fns.length;};
let rootEl=null;let setOpenRef=null;
function Host(){const s=useState(true);setOpenRef=s[1];
  return React.createElement(ExpenseSheet,{open:s[0],onOpenChange:s[1],tripId:'7e000000-0000-4000-8000-000000000001',locale:'zh-TW',copy:COPY,sessionKey:1,expense:null,formKey:'0',
    conflictNotice:false,members:members,membersLoaded:true,resolvePerson:resolvePerson,meId:A,usedCurrencies:['TWD'],defaultCurrency:'TWD',
    onSaved:noop,onConflict:noop,onGone:noop,onDelete:noop,deleting:false});}
window.mount=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}
  window.resetScrollLog();rootEl=createRoot(document.getElementById('root'));flushSync(function(){rootEl.render(React.createElement(StrictMode,null,React.createElement(Host)));});return true;};
window.unmount=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}return true;};
window.setOpen=function(v){flushSync(function(){setOpenRef(v);});return true;};
const dlg=function(){return document.querySelector('[role=dialog]');};
function field(kind){const d=dlg();if(!d)return null;if(kind==='note')return d.querySelector('textarea');if(kind==='amount')return d.querySelector('input[inputmode=decimal]');
  if(kind==='title')return Array.prototype.slice.call(d.querySelectorAll('input')).find(function(i){return i.placeholder===COPY.titlePlaceholder;});if(kind==='date')return d.querySelector('input[type=date]');return null;}
// noScroll：focus({preventScroll:true})，排除瀏覽器原生 focus 捲動，只驗證元件自己的捲動邏輯
window.__focusins=0;document.addEventListener('focusin',function(){window.__focusins+=1;},true);
window.focusField=function(kind,noScroll){const el=field(kind);if(!el)return 'missing';const n=window.__focusins;el.focus(noScroll?{preventScroll:true}:undefined);
  if(document.activeElement!==el)return 'not-focused';return window.__focusins>n?'focused':'focused-no-event';};
window.scrollSheetTo=function(top){const sc=scroller();sc.scrollTop=top;return sc.scrollTop;};
window.blurAll=function(){if(document.activeElement)document.activeElement.blur();return true;};
function setVal(el,v){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}
window.setNote=function(v){const el=field('note');if(!el)return 'missing';flushSync(function(){setVal(el,v);});return 'set';};
// 以 data-expense-scroll 為準；舊版無此屬性時退回 .overflow-y-auto（排除備註 textarea）
function scroller(){const d=dlg();if(!d)return null;return d.querySelector('[data-expense-scroll]')||Array.prototype.slice.call(d.querySelectorAll('.overflow-y-auto')).find(function(x){return x.tagName!=='TEXTAREA';})||null;}
window.geo=function(kind){const d=dlg();if(!d)return {open:false};const el=kind?field(kind):null;const sc=scroller();const r=el?el.getBoundingClientRect():null;const scr=sc?sc.getBoundingClientRect():null;
  const lab=el?el.closest('label'):null;const lr=lab?lab.getBoundingClientRect():null;
  const btn=Array.prototype.slice.call(d.querySelectorAll('button')).find(function(b){return b.textContent.trim()===COPY.save;});const br=btn?btn.getBoundingClientRect():null;const dr=d.getBoundingClientRect();
  let saveHit=null;if(br){const hx=br.left+br.width/2,hy=br.top+br.height/2;const hitEl=(hy>=0&&hy<window.innerHeight)?document.elementFromPoint(hx,hy):null;saveHit=!!(hitEl&&(hitEl===btn||btn.contains(hitEl)))&&!btn.disabled;}
  const cs=getComputedStyle(d);
  return {open:true,inlinePb:d.style.paddingBottom,inlineBottom:d.style.bottom,inlineMaxH:d.style.maxHeight,computedPb:cs.paddingBottom,computedBottom:cs.bottom,computedMaxH:cs.maxHeight,innerH:window.innerHeight,
    hasScrollAttr:!!(sc&&sc.hasAttribute('data-expense-scroll')),
    dialog:{top:dr.top,bottom:dr.bottom,height:dr.height},scroller:scr?{top:scr.top,bottom:scr.bottom,height:scr.height,scrollTop:sc.scrollTop,scrollH:sc.scrollHeight,clientH:sc.clientHeight}:null,
    el:r?{top:r.top,bottom:r.bottom,height:r.height}:null,label:lr?{top:lr.top,bottom:lr.bottom}:null,save:br?{top:br.top,bottom:br.bottom}:null,saveHit:saveHit,
    active:document.activeElement?document.activeElement.tagName:null,winScrollY:window.scrollY};};
window.noteGeo=function(){const n=field('note');const t=field('title');const dt=field('date');if(!n)return null;const cs=getComputedStyle(n);
  const lab=function(i){const s=i.closest('label').querySelector('span');return {spanDisplay:getComputedStyle(s).display,spanBottom:s.getBoundingClientRect().bottom,inputTop:i.getBoundingClientRect().top};};
  return {h:n.getBoundingClientRect().height,clientH:n.clientHeight,scrollH:n.scrollHeight,overflowY:cs.overflowY,pt:cs.paddingTop,pb:cs.paddingBottom,lh:cs.lineHeight,textAlign:cs.textAlign,rows:n.rows,
    styleH:n.style.height,maxH:cs.maxHeight,titleH:t?t.getBoundingClientRect().height:null,dateH:dt?dt.getBoundingClientRect().height:null,
    titleLab:t?lab(t):null,dateLab:dt?lab(dt):null,sameRowTop:t&&dt?Math.abs(t.getBoundingClientRect().top-dt.getBoundingClientRect().top):null};};
window.scrollNote=function(top){const n=field('note');n.scrollTop=top;return n.scrollTop;};
window.kbLog=function(){return (window.__kbLog||[]).slice();};
window.__ready=true;`;

if (!chromeBin) {
  failures.push("無可用 Chrome");
  console.log("FAIL 無可用 Chrome，未執行瀏覽器 render");
} else {
  await runBrowser();
}

async function runBrowser() {
  await build({
    bundle: true, logLevel: "error", format: "iife", jsx: "automatic", jsxDev: true,
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
    stdin: { contents: entry, resolveDir: root, loader: "tsx" }, outfile: path.join(tmp, "app.js"), plugins: [mockPlugin(mocks)],
  });
  fs.writeFileSync(path.join(tmp, "app.css"), appCss);
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(tmp, "app.js")));
      return;
    }
    if (req.url === "/app.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(fs.readFileSync(path.join(tmp, "app.css")));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(tmp, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const externalRequests = [];
  const browserErrors = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let out = "";
      chrome.stderr.on("data", (b) => {
        out += b;
        const m = out.match(/DevTools listening on (ws:\/\/\S+)/);
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
        browserErrors.push("console.error: " + r.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
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
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    // headless 分頁預設沒有焦點 → focus()／focusin 事件不觸發，元件的 onFocusCapture 永遠測不到；開啟 focus emulation
    await call("Emulation.setFocusEmulationEnabled", { enabled: true });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ev = (fn, ...args) => evaluate(`window.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    const frames = () => evaluate("new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(r,30);});});})");
    const load = async () => {
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/` });
      for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await sleep(100);
      assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.join("\n"));
    };
    const mount = async () => {
      await ev("mount");
      await sleep(650); // Radix 開啟動畫（duration-500）結束
      await frames();
    };
    const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
    const BASE_W = 390;
    const BASE_H = 844;
    // 模擬 WebView 因鍵盤縮小：真的改 viewport 尺寸（觸發 window resize、innerHeight／dvh 跟著變）
    const setViewportHeight = async (h) => {
      await call("Emulation.setDeviceMetricsOverride", { width: BASE_W, height: h, deviceScaleFactor: 1, mobile: true });
      for (let i = 0; i < 40 && (await evaluate("window.innerHeight")) !== h; i++) await sleep(25);
      assert.equal(await evaluate("window.innerHeight"), h, "viewport 未變為 " + h);
      await frames();
    };
    const px = (s) => (s === "" || s == null ? null : Number(String(s).replace(/px$/, "")));
    /** 只允許捲 Sheet 內容區（與備註框自身）；不得 scrollIntoView、不得捲 window／document */
    const assertOnlyScrollerScrolled = (log, label) => {
      assert.deepEqual(log.siv, [], label + "：不應呼叫 scrollIntoView（會連帶捲動 WebView／視窗）：" + JSON.stringify(log.siv));
      assert.deepEqual(log.win, [], label + "：呼叫了 window 捲動：" + JSON.stringify(log.win));
      assert.equal(log.winY, 0, label + "：window.scrollY 改變");
      assert.equal(log.docTop, 0, label + "：documentElement 被捲動");
      assert.equal(log.bodyTop, 0, label + "：body 被捲動");
      const bad = log.targets.filter((t) => t !== "expense-scroll" && t !== "TEXTAREA");
      assert.deepEqual(bad, [], label + "：捲動了內容區以外的元素：" + JSON.stringify(log.targets));
    };
    /**
     * 鍵盤開啟時的版型：
     *  - 不用 paddingBottom；inline bottom＝expectBottom；inline maxHeight 有設定
     *  - Sheet 底緣貼鍵盤上緣（kbTop）；頂端不超出視窗；computed max-height 不超過 kbTop
     *  - 內容區高度 > 0 且足以容納正在輸入的欄位＋label；欄位與 label 都在內容區可視範圍、在鍵盤上方
     *  - 「儲存」在鍵盤上方、貼近鍵盤（headless safe-area＝0 → footer pb 16px）、elementFromPoint 命中且未 disabled
     */
    const assertKeyboardLayout = (g, { expectBottom, kbTop, kind }) => {
      assert.deepEqual(missingCss, [], "缺少真實 CSS，無法量測");
      assert.equal(g.inlinePb, "", "不應再以 paddingBottom 墊高（會吃掉 flex-1 內容區）：" + g.inlinePb);
      assert.equal(px(g.inlineBottom), expectBottom, `inline bottom 應為 ${expectBottom}px，實際「${g.inlineBottom}」`);
      assert.ok(g.inlineMaxH && g.inlineMaxH.length > 0, "鍵盤開啟時應設定 inline maxHeight");
      const cMax = px(g.computedMaxH);
      if (Number.isFinite(cMax)) assert.ok(cMax <= kbTop + 0.5, `computed max-height ${cMax} 超過鍵盤上方可用高度 ${kbTop}`);
      assert.ok(near(g.dialog.bottom, kbTop, 1), `Sheet 底緣 ${g.dialog.bottom} 未貼齊鍵盤上緣 ${kbTop}`);
      assert.ok(g.dialog.top >= -0.5, "Sheet 頂端超出視窗：" + g.dialog.top);
      assert.ok(g.scroller && g.scroller.clientH > 0, "內容區高度被壓到 0：" + JSON.stringify(g.scroller));
      if (kind) {
        assert.ok(g.el && g.label, "找不到欄位或 label");
        const need = g.el.bottom - g.label.top;
        assert.ok(g.scroller.clientH >= need, `內容區 ${g.scroller.clientH}px 不足以顯示欄位＋label（${need}px）`);
        assert.ok(g.label.top >= g.scroller.top - 0.5, `label 頂 ${g.label.top} 被捲出內容區上緣 ${g.scroller.top}`);
        assert.ok(g.el.top >= g.scroller.top - 0.5 && g.el.bottom <= g.scroller.bottom + 0.5, `欄位 ${JSON.stringify(g.el)} 不在內容區可視範圍 ${JSON.stringify(g.scroller)}`);
        assert.ok(g.el.bottom <= kbTop + 0.5, `欄位底 ${g.el.bottom} 被鍵盤（上緣 ${kbTop}）蓋住`);
      }
      assert.ok(g.save, "找不到「儲存」");
      assert.ok(g.save.top >= -0.5 && g.save.bottom <= kbTop + 0.5, `「儲存」${JSON.stringify(g.save)} 被鍵盤（上緣 ${kbTop}）蓋住或超出視窗`);
      assert.ok(kbTop - g.save.bottom <= 17, `「儲存」未貼近鍵盤上緣：間距 ${kbTop - g.save.bottom}px`);
      assert.equal(g.saveHit, true, "「儲存」中心點 elementFromPoint 未命中按鈕（被遮住或 disabled）");
    };
    /** 收起鍵盤：inline bottom／maxHeight／paddingBottom 全清除，Sheet 回到視窗底部 */
    const assertRestored = (g, label) => {
      assert.equal(g.inlineBottom, "", label + "：殘留 inline bottom " + g.inlineBottom);
      assert.equal(g.inlineMaxH, "", label + "：殘留 inline maxHeight " + g.inlineMaxH);
      assert.equal(g.inlinePb, "", label + "：殘留 inline paddingBottom " + g.inlinePb);
      assert.ok(near(g.dialog.bottom, g.innerH, 1), `${label}：Sheet 底緣 ${g.dialog.bottom} 未回到視窗底 ${g.innerH}`);
    };

    // ═══ K1 網頁版、無 Capacitor、無鍵盤 ═══
    await load();
    {
      await mount();
      const g0 = await ev("geo", "note");
      const sc0 = g0.scroller?.scrollTop;
      // 已在可視範圍內的欄位（名稱）focus：不應捲動
      await ev("resetScrollLog");
      const focusRes = await ev("focusField", "title");
      await frames();
      const g1 = await ev("geo", "title");
      const log1 = await ev("scrollLog");
      await check("K0 測試環境：focus() 會觸發 focusin（否則元件的 onFocusCapture 等於沒測）", () => {
        assert.equal(focusRes, "focused", "focus 結果：" + focusRes);
      });
      await check("K1 網頁版（無 Capacitor、無鍵盤）：SheetContent 無 inline paddingBottom／bottom／maxHeight；內容區有 data-expense-scroll；focus 可視欄位不捲動 Sheet／視窗、不呼叫 scrollIntoView；無例外", () => {
        assert.ok(g0.open, "Sheet 未開啟");
        assertRestored(g0, "無鍵盤");
        assert.ok(g0.scroller, "找不到 Sheet 捲動區");
        assert.equal(g0.hasScrollAttr, true, "內容區缺少 data-expense-scroll（revealInScroller 找不到捲動區就不會捲）");
        assert.equal(g1.scroller.scrollTop, sc0, "focus 可視欄位後 Sheet 捲動區位置改變：" + sc0 + " → " + g1.scroller.scrollTop);
        assertOnlyScrollerScrolled(log1, "focus 名稱");
      });
      const capAdds = await evaluate("window.__capAdds||0");
      await check("K1b 網頁版不呼叫 @capacitor/keyboard addListener、無 subscriber 紀錄", async () => {
        assert.equal(capAdds, 0);
        assert.deepEqual(await ev("kbLog"), []);
      });
      await ev("unmount");
    }

    // ═══ K2 網頁版 visualViewport ═══
    {
      await ev("installFakeVV");
      await mount();
      const vv0 = await evaluate("({adds:window.__vv.adds,removes:window.__vv.removes,live:window.__vv.live})");
      const H = (await ev("geo")).innerH;
      await ev("scrollSheetTo", 0);
      await ev("focusField", "note", true);
      await frames();
      await ev("resetScrollLog");
      await ev("vvSet", H - 300);
      await frames();
      await sleep(50);
      const gKb = await ev("geo", "note");
      const logKb = await ev("scrollLog");
      info("K2 鍵盤 300：" + JSON.stringify({ bottom: gKb.inlineBottom, maxH: gKb.inlineMaxH, cMax: gKb.computedMaxH, dialog: gKb.dialog, scroller: gKb.scroller, el: gKb.el, label: gKb.label, save: gKb.save }));
      await ev("vvSet", H - 40);
      await frames();
      const gSmall = await ev("geo");
      await ev("vvSet", 100);
      await frames();
      const gHuge = await ev("geo");
      await ev("vvSet", H - 280, "scroll");
      await frames();
      const gScrollEv = await ev("geo");
      await ev("vvSet", H);
      await frames();
      const gHide = await ev("geo");
      await check("K2 網頁版 visualViewport（WebView 未縮）：鍵盤 300px → inline bottom 300px＋maxHeight、無 paddingBottom；40px（<=50）視為無鍵盤；超高上限 round(innerHeight×0.55)；vv scroll 事件也更新；收起後 inline style 清除", () => {
        assert.ok(vv0.live.resize >= 1 && vv0.live.scroll >= 1, "未訂閱 vv resize／scroll：" + JSON.stringify(vv0));
        assert.equal(vv0.live.resize, 1, "StrictMode 後 resize listener 應只剩 1 個：" + JSON.stringify(vv0));
        assert.equal(vv0.live.scroll, 1, "StrictMode 後 scroll listener 應只剩 1 個：" + JSON.stringify(vv0));
        assert.equal(gKb.innerH, H, "此情境 WebView 不應縮");
        assertKeyboardLayout(gKb, { expectBottom: 300, kbTop: H - 300, kind: "note" });
        assertRestored(gSmall, "40px 不應視為鍵盤");
        assert.equal(px(gHuge.inlineBottom), Math.round(H * 0.55), "超高鍵盤上限：" + gHuge.inlineBottom);
        assert.ok(gHuge.inlineMaxH, "超高鍵盤也要設 maxHeight");
        assert.ok(gHuge.dialog.top >= -0.5, "超高鍵盤時 Sheet 頂端超出視窗：" + gHuge.dialog.top);
        assert.equal(px(gScrollEv.inlineBottom), 280, "vv scroll 事件未更新：" + gScrollEv.inlineBottom);
        assert.equal(gScrollEv.inlinePb, "");
        assertRestored(gHide, "收起鍵盤");
      });
      await check("K2a 鍵盤升起後備註（原在下方）被捲入內容區：只捲 data-expense-scroll，不呼叫 scrollIntoView、不捲 window", () => {
        assert.ok(gKb.scroller.scrollTop > 0, "備註原本會被鍵盤擋住，內容區應往下捲：scrollTop=" + gKb.scroller.scrollTop);
        assert.ok(logKb.targets.includes("expense-scroll"), "未捲動內容區：" + JSON.stringify(logKb.targets));
        assertOnlyScrollerScrolled(logKb, "vv 鍵盤 300");
      });
      await ev("vvSet", H - 300);
      await frames();
      await ev("setOpen", false);
      await sleep(400);
      const vvClosed = await evaluate("({adds:window.__vv.adds,removes:window.__vv.removes,live:window.__vv.live})");
      // 關閉期間 vv 事件不應造成錯誤；重開時 vv 已恢復 → 0
      await ev("vvSet", H);
      await ev("setOpen", true);
      await sleep(650);
      await frames();
      const gReopen = await ev("geo");
      await check("K2b 鍵盤開著時關閉 Sheet：解除 vv resize／scroll listener（live＝0）；重開時（鍵盤已收）inline bottom／maxHeight 已清除", () => {
        assert.equal(vvClosed.live.resize, 0, JSON.stringify(vvClosed));
        assert.equal(vvClosed.live.scroll, 0, JSON.stringify(vvClosed));
        assert.equal(gReopen.open, true);
        assertRestored(gReopen, "重開");
      });
      await ev("unmount");
      const vvUnmount = await evaluate("window.__vv.live");
      await check("K2c unmount 後 vv listener 全部解除", () => {
        assert.equal(vvUnmount.resize, 0, JSON.stringify(vvUnmount));
        assert.equal(vvUnmount.scroll, 0, JSON.stringify(vvUnmount));
      });
    }

    // ═══ K3 原生 Capacitor Keyboard（resize: none）═══
    await load();
    {
      await ev("setNative", true);
      await ev("installFakeVV");
      await mount();
      const capAdds = await evaluate("window.__capAdds||0");
      const H = (await ev("geo")).innerH;
      await ev("focusField", "note");
      await frames();
      const nShow = await ev("capFire", "keyboardWillShow", 336);
      await frames();
      const gShow = await ev("geo", "note");
      await ev("capFire", "keyboardDidShow", 336);
      await ev("vvSet", H - 500); // 原生時應忽略 vv
      await frames();
      const gVv = await ev("geo");
      await ev("capFire", "keyboardWillHide", 0);
      await frames();
      const gHide = await ev("geo");
      await check("K3 原生（WebView 未縮）：Keyboard listener 安裝 4 個（will/did show/hide）；keyboardWillShow 336 → inline bottom 336px＋maxHeight；原生時忽略 vv；keyboardWillHide 清除 inline style", () => {
        assert.equal(capAdds, 4, "addListener 次數 " + capAdds);
        assert.ok(nShow >= 1);
        assert.equal(gShow.innerH, H, "此情境 WebView 不應縮");
        assertKeyboardLayout(gShow, { expectBottom: 336, kbTop: H - 336, kind: "note" });
        assert.equal(px(gVv.inlineBottom), 336, "原生時 vv 事件改變了 bottom：" + gVv.inlineBottom);
        assert.equal(gVv.inlinePb, "");
        assertRestored(gHide, "keyboardWillHide");
      });
      await ev("capFire", "keyboardWillShow", 336);
      await frames();
      await ev("setOpen", false);
      await sleep(400);
      const logClosed = await ev("kbLog");
      await ev("capFire", "keyboardWillShow", 336); // 關閉後的事件
      await ev("capFire", "keyboardWillHide", 0);
      await ev("setOpen", true);
      await sleep(650);
      await frames();
      const gReopen = await ev("geo");
      const logReopen = await ev("kbLog");
      await check("K3b 鍵盤開著時關閉 Sheet：subscriber 解除（最後一次 remove 後 count＝0）；重開 inline style 已清除；StrictMode 未遺留重複 subscriber", () => {
        const removes = logClosed.filter((l) => l.action === "remove");
        assert.ok(removes.length >= 1, JSON.stringify(logClosed));
        assert.equal(removes.at(-1).count, 0, "關閉後仍有 subscriber：" + JSON.stringify(logClosed));
        assertRestored(gReopen, "重開");
        // 重開後 subscribe 1 個（StrictMode 模擬卸載再掛載 → remove 一次後 count 回到 0，再訂閱）
        const after = logReopen.slice(logClosed.length).filter((l) => l.action === "remove");
        assert.ok(after.every((l) => l.count === 0), "重開後出現多個 subscriber：" + JSON.stringify(after));
      });
      await ev("capFire", "keyboardWillShow", 336);
      await frames();
      const gAgain = await ev("geo");
      await ev("unmount");
      const logUnmount = await ev("kbLog");
      await check("K3c 重開後鍵盤事件仍生效；unmount 後 subscriber 解除", () => {
        assert.equal(px(gAgain.inlineBottom), 336, "重開後 keyboardWillShow 未生效：" + gAgain.inlineBottom);
        assert.ok(gAgain.inlineMaxH, "重開後未設 maxHeight");
        assert.equal(gAgain.inlinePb, "");
        assert.equal(logUnmount.filter((l) => l.action === "remove").at(-1).count, 0, JSON.stringify(logUnmount.slice(-3)));
      });
    }

    // ═══ K4 鍵盤升起後輸入欄位可見（原生 336px；真實 CSS 量測）═══
    {
      await mount();
      for (const kind of ["note", "title", "amount"]) {
        await ev("capFire", "keyboardWillHide", 0);
        await frames();
        await ev("blurAll");
        await frames();
        // 先把內容區捲到「與欄位相反」的一端，鍵盤升起後必須由元件自己捲回（focus 用 preventScroll 排除瀏覽器原生捲動）
        await ev("scrollSheetTo", kind === "note" ? 0 : 100000);
        await frames();
        const pre = await ev("geo", kind);
        await ev("focusField", kind, true);
        await frames();
        await ev("resetScrollLog");
        await ev("capFire", "keyboardWillShow", 336);
        await frames();
        await sleep(80);
        const g = await ev("geo", kind);
        const log = await ev("scrollLog");
        info(`K4 ${kind}：鍵盤前 ${JSON.stringify({ el: pre.el, scroller: pre.scroller })}；鍵盤後 ${JSON.stringify({ bottom: g.inlineBottom, maxH: g.inlineMaxH, dialog: g.dialog, el: g.el, label: g.label, scroller: g.scroller, save: g.save })}`);
        await check(`K4 ${kind}：鍵盤 336px 升起後 Sheet 底貼鍵盤上緣；欄位與 label 在內容區可視範圍、在鍵盤上方；「儲存」貼鍵盤上方可點；只捲內容區`, () => {
          assertKeyboardLayout(g, { expectBottom: 336, kbTop: g.innerH - 336, kind });
          assertOnlyScrollerScrolled(log, kind);
        });
        await ev("capFire", "keyboardWillHide", 0);
        await frames();
        await sleep(80);
        const back = await ev("geo", kind);
        await check(`K4r ${kind}：收起鍵盤後 inline style 清除，Sheet 與內容區高度恢復鍵盤前`, () => {
          assertRestored(back, "收起");
          assert.ok(near(back.dialog.height, pre.dialog.height, 1), `Sheet 高度未恢復：${pre.dialog.height} → ${back.dialog.height}`);
          assert.ok(near(back.scroller.clientH, pre.scroller.clientH, 1), `內容區高度未恢復：${pre.scroller.clientH} → ${back.scroller.clientH}`);
        });
      }
      await ev("capFire", "keyboardWillHide", 0);
      await ev("unmount");
    }

    // ═══ K5 原生，但 WebView innerHeight 也因鍵盤縮小（實機 resize 非 none 的情況）：不得重複墊高 ═══
    {
      const KB = 336;
      const kbTop = BASE_H - KB; // 鍵盤上緣（以實體螢幕座標）＝縮小後的 innerHeight
      const runShrink = async (label, order, shrinkTo) => {
        await setViewportHeight(BASE_H);
        await mount();
        await ev("scrollSheetTo", 0);
        await ev("focusField", "note", true);
        await frames();
        await ev("resetScrollLog");
        if (order === "show-first") {
          await ev("capFire", "keyboardWillShow", KB);
          await frames();
          await setViewportHeight(shrinkTo);
        } else {
          await setViewportHeight(shrinkTo);
          await ev("capFire", "keyboardWillShow", KB);
          await frames();
        }
        await ev("capFire", "keyboardDidShow", KB);
        await frames();
        await sleep(80);
        const g = await ev("geo", "note");
        const log = await ev("scrollLog");
        info(`K5 ${label}：${JSON.stringify({ innerH: g.innerH, bottom: g.inlineBottom, maxH: g.inlineMaxH, cMax: g.computedMaxH, dialog: g.dialog, scroller: g.scroller, el: g.el, label: g.label, save: g.save })}`);
        // 再切到名稱欄（iOS 會再送一次 keyboardWillShow）
        await ev("focusField", "title", true);
        await frames();
        const gFocusOnly = await ev("geo", "title");
        info(`K5 ${label} 切到名稱（僅 focus，尚未再送 willShow）：${JSON.stringify({ scrollTop: gFocusOnly.scroller.scrollTop, label: gFocusOnly.label })}`);
        await ev("capFire", "keyboardWillShow", KB);
        await frames();
        await sleep(80);
        const g2 = await ev("geo", "title");
        const log2 = await ev("scrollLog");
        info(`K5 ${label} 切到名稱：${JSON.stringify({ active: g2.active, bottom: g2.inlineBottom, scroller: g2.scroller, el: g2.el, label: g2.label, scrollTargets: log2.targets.length })}`);
        // 收起：先 willHide 再 viewport 長回
        await ev("capFire", "keyboardWillHide", 0);
        await frames();
        await setViewportHeight(BASE_H);
        await sleep(50);
        const back = await ev("geo");
        // 同一個 Sheet 再開一次鍵盤（WebView 不縮）：基準高度應回到 844，bottom＝336
        await ev("focusField", "note", true);
        await ev("capFire", "keyboardWillShow", KB);
        await frames();
        await sleep(80);
        const gAgain = await ev("geo", "note");
        await ev("capFire", "keyboardWillHide", 0);
        await frames();
        await ev("unmount");
        return { g, g2, back, gAgain, log };
      };

      const full = await runShrink("show→resize 全縮 508", "show-first", kbTop);
      await check("K5 WebView 全縮（keyboardWillShow 後 innerHeight 844→508）：bottom 扣掉縮的量＝0px、不重複墊高；內容區高度 > 0 且足以顯示備註＋label；「儲存」貼鍵盤可點；只捲內容區", () => {
        assert.equal(full.g.innerH, kbTop);
        assertKeyboardLayout(full.g, { expectBottom: 0, kbTop, kind: "note" });
        assertOnlyScrollerScrolled(full.log, "全縮");
      });
      await check("K5b WebView 已縮時再次 keyboardWillShow（切到名稱）：仍為 0px，名稱與 label 可見", () => {
        assertKeyboardLayout(full.g2, { expectBottom: 0, kbTop, kind: "title" });
      });
      await check("K5c 收起後 WebView 長回 844：inline style 清除；同一 Sheet 再開鍵盤（未縮）bottom 回到 336px", () => {
        assertRestored(full.back, "收起");
        assertKeyboardLayout(full.gAgain, { expectBottom: KB, kbTop, kind: "note" });
      });

      const partial = await runShrink("show→resize 部分縮 644", "show-first", BASE_H - 200);
      await check("K5d WebView 部分縮（844→644，鍵盤 336）：bottom＝336−200＝136px，Sheet 底仍貼鍵盤上緣 508", () => {
        assertKeyboardLayout(partial.g, { expectBottom: KB - 200, kbTop, kind: "note" });
      });

      const resizeFirst = await runShrink("resize→show 全縮 508", "resize-first", kbTop);
      await check("K5e WebView 先縮（resize 早於 keyboardWillShow）再收到鍵盤 336：不得重複墊高（bottom 應為 0px），內容區不得被壓扁", () => {
        assertKeyboardLayout(resizeFirst.g, { expectBottom: 0, kbTop, kind: "note" });
      });
      await setViewportHeight(BASE_H);
      await ev("setNative", false);
    }

    // ═══ K6（INFO，非 iPhone 需求）網頁版 WebView 與 vv 一起縮（Android Chrome 型）：inset＝0，觀察備註是否仍可見 ═══
    {
      await load();
      await ev("installFakeVV");
      await mount();
      await ev("scrollSheetTo", 0);
      await ev("focusField", "note", true);
      await frames();
      await evaluate("window.__vv.height=508,true");
      await setViewportHeight(508);
      await ev("vvSet", 508);
      await frames();
      await sleep(80);
      const g = await ev("geo", "note");
      info("K6 Android 型縮放：" + JSON.stringify({ bottom: g.inlineBottom, maxH: g.inlineMaxH, dialog: g.dialog, scroller: g.scroller, el: g.el, label: g.label, save: g.save }));
      await ev("unmount");
      await setViewportHeight(BASE_H);
    }

    // ═══ N 備註自動長高、名稱／日期 ═══
    await load();
    {
      await mount();
      const n0 = await ev("noteGeo");
      await ev("setNote", "第一行\n第二行");
      await frames();
      const n2 = await ev("noteGeo");
      await ev("setNote", "1\n2\n3\n4");
      await frames();
      const n4 = await ev("noteGeo");
      await ev("setNote", "1\n2\n3\n4\n5\n6\n7\n8");
      await frames();
      const n8 = await ev("noteGeo");
      const scrolled = await ev("scrollNote", 60);
      await ev("setNote", "");
      await frames();
      const nBack = await ev("noteGeo");
      const longLine = "很長的一段備註文字".repeat(12);
      await ev("setNote", longLine);
      await frames();
      const nWrap = await ev("noteGeo");
      info("N1 量測：" + JSON.stringify({ n0, n2: n2.h, n4: n4.h, n8: { h: n8.h, scrollH: n8.scrollH, clientH: n8.clientH }, scrolled, nBack: nBack.h, nWrap: nWrap.h }));
      await check("N1 備註：rows=1；空白高 40px＝名稱欄高；上下 padding 相等、line-height 20px（「選填」垂直置中）；靠左", () => {
        assert.deepEqual(missingCss, [], "缺少真實 CSS，無法量測");
        assert.equal(n0.rows, 1);
        assert.ok(near(n0.h, 40, 0.5), "空白高度 " + n0.h);
        assert.ok(near(n0.h, n0.titleH, 0.5), `備註 ${n0.h} ≠ 名稱 ${n0.titleH}`);
        assert.equal(n0.pt, n0.pb, "上下 padding 不等");
        assert.equal(n0.lh, "20px");
        assert.ok(n0.textAlign === "start" || n0.textAlign === "left", n0.textAlign);
      });
      await check("N1b 備註多行自動長高：2 行 60px、4 行 100px；8 行維持 100px（上限）且框內可捲動；刪回空白縮回 40px；單行長文自動換行也長高", () => {
        assert.ok(near(n2.h, 60, 0.5), "2 行 " + n2.h);
        assert.ok(near(n4.h, 100, 0.5), "4 行 " + n4.h);
        assert.ok(near(n8.h, 100, 0.5), "8 行 " + n8.h);
        assert.ok(n8.scrollH > n8.clientH, "超過上限應可捲動：" + JSON.stringify(n8));
        assert.ok(n8.overflowY === "auto" || n8.overflowY === "scroll", n8.overflowY);
        assert.ok(scrolled > 0, "框內無法捲動：" + scrolled);
        assert.ok(near(nBack.h, 40, 0.5), "刪回空白 " + nBack.h);
        assert.ok(nWrap.h > 40, "自動換行未長高：" + nWrap.h);
      });
      await check("N2 名稱／日期：兩欄標題 display:block 且在輸入框上方；兩框等高（40px）且頂端對齊", () => {
        for (const [k, l] of [["名稱", n0.titleLab], ["日期", n0.dateLab]]) {
          assert.equal(l.spanDisplay, "block", k + " 標題不是 block");
          assert.ok(l.spanBottom <= l.inputTop + 0.5, k + " 標題不在框上方：" + JSON.stringify(l));
        }
        assert.ok(near(n0.titleH, n0.dateH, 0.5), `名稱 ${n0.titleH} ≠ 日期 ${n0.dateH}`);
        assert.ok(near(n0.dateH, 40, 0.5), "日期高 " + n0.dateH);
        assert.ok(n0.sameRowTop <= 0.5, "兩框頂端未對齊：" + n0.sameRowTop);
      });
      await ev("unmount");
    }

    await check("K9 無外部請求、無瀏覽器例外／console.error", () => {
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(browserErrors, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
  }
}

try {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {}
console.log(`\n總結：${passCount} PASS / ${failures.length} FAIL`);
if (failures.length) console.log("FAIL 清單：\n  " + failures.join("\n  "));
console.log(failures.length ? "verify-trip-subpage-header-keyboard: FAIL" : "verify-trip-subpage-header-keyboard: PASS");
process.exit(failures.length ? 1 : 0);
