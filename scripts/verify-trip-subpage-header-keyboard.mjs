// verify-trip-subpage-header-keyboard.mjs — 任務單 #TS-UX3：「新增花費」Sheet 鍵盤處理＋備註自動長高（獨立審查）
//
// 以 headless Chrome（390×844 mobile 模擬）＋React development build＋<StrictMode> 真實 render ExpenseSheet，
// 套用真實 Tailwind 產出（dist/client/assets/styles-*.css），量測幾何：
//   K1 網頁版、無 Capacitor、無鍵盤：不加 paddingBottom、不裝 Keyboard listener、focus 不亂捲、無例外
//   K2 網頁版 visualViewport（假 vv）：鍵盤高度 → SheetContent paddingBottom；<=50 視為無鍵盤；上限 55% innerHeight；
//      關閉 Sheet 解除 resize／scroll listener、重開歸零
//   K3 原生（window.Capacitor.isNativePlatform）：真實 capacitor-keyboard-bridge＋mock @capacitor/keyboard 事件 →
//      paddingBottom；忽略 vv；keyboardWillHide 歸零；關閉後 subscriber 解除（之後的事件不影響）、重開歸零
//   K4 鍵盤升起後正在輸入的欄位（備註、名稱、金額）位於鍵盤上緣之上且在 Sheet 捲動區可視範圍內；底部按鈕也在鍵盤上方
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
// scrollIntoView 呼叫紀錄（保留原行為）
const realSIV=Element.prototype.scrollIntoView;window.__siv=[];
Element.prototype.scrollIntoView=function(o){window.__siv.push({tag:this.tagName,ph:this.getAttribute('placeholder'),opt:o});return realSIV.call(this,o);};
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
  window.__siv=[];rootEl=createRoot(document.getElementById('root'));flushSync(function(){rootEl.render(React.createElement(StrictMode,null,React.createElement(Host)));});return true;};
window.unmount=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}return true;};
window.setOpen=function(v){flushSync(function(){setOpenRef(v);});return true;};
const dlg=function(){return document.querySelector('[role=dialog]');};
function field(kind){const d=dlg();if(!d)return null;if(kind==='note')return d.querySelector('textarea');if(kind==='amount')return d.querySelector('input[inputmode=decimal]');
  if(kind==='title')return Array.prototype.slice.call(d.querySelectorAll('input')).find(function(i){return i.placeholder===COPY.titlePlaceholder;});if(kind==='date')return d.querySelector('input[type=date]');return null;}
window.focusField=function(kind){const el=field(kind);if(!el)return 'missing';el.focus();return document.activeElement===el?'focused':'not-focused';};
window.blurAll=function(){if(document.activeElement)document.activeElement.blur();return true;};
function setVal(el,v){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}
window.setNote=function(v){const el=field('note');if(!el)return 'missing';flushSync(function(){setVal(el,v);});return 'set';};
function scroller(){const d=dlg();return d?d.querySelector('.overflow-y-auto'):null;}
window.geo=function(kind){const d=dlg();if(!d)return {open:false};const el=kind?field(kind):null;const sc=scroller();const r=el?el.getBoundingClientRect():null;const scr=sc?sc.getBoundingClientRect():null;
  const btn=Array.prototype.slice.call(d.querySelectorAll('button')).find(function(b){return b.textContent.trim()===COPY.save;});const br=btn?btn.getBoundingClientRect():null;const dr=d.getBoundingClientRect();
  return {open:true,inlinePb:d.style.paddingBottom,computedPb:getComputedStyle(d).paddingBottom,innerH:window.innerHeight,
    dialog:{top:dr.top,bottom:dr.bottom,height:dr.height},scroller:scr?{top:scr.top,bottom:scr.bottom,scrollTop:sc.scrollTop,scrollH:sc.scrollHeight,clientH:sc.clientHeight}:null,
    el:r?{top:r.top,bottom:r.bottom}:null,save:br?{top:br.top,bottom:br.bottom}:null,active:document.activeElement?document.activeElement.tagName:null,winScrollY:window.scrollY};};
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

    // ═══ K1 網頁版、無 Capacitor、無鍵盤 ═══
    await load();
    {
      await mount();
      const g0 = await ev("geo", "note");
      const siv0 = await evaluate("window.__siv.length");
      const sc0 = g0.scroller?.scrollTop;
      // 已在可視範圍內的欄位（名稱）focus：不應捲動
      await ev("focusField", "title");
      await frames();
      const g1 = await ev("geo", "title");
      const sivTitle = await evaluate("window.__siv.slice()");
      await check("K1 網頁版（無 Capacitor、無鍵盤）：SheetContent 無 inline paddingBottom；未安裝 Keyboard listener；focus 可視欄位不捲動 Sheet／視窗；無例外", () => {
        assert.ok(g0.open, "Sheet 未開啟");
        assert.equal(g0.inlinePb, "", "無鍵盤時不應有 inline paddingBottom：" + g0.inlinePb);
        assert.ok(g0.scroller, "找不到 Sheet 捲動區（.overflow-y-auto）");
        assert.equal(g1.scroller.scrollTop, sc0, "focus 可視欄位後 Sheet 捲動區位置改變：" + sc0 + " → " + g1.scroller.scrollTop);
        assert.equal(g1.winScrollY, 0, "視窗被捲動");
        assert.ok(sivTitle.every((c) => c.opt && c.opt.block === "nearest"), "scrollIntoView 參數應為 block:nearest：" + JSON.stringify(sivTitle));
        assert.ok(sivTitle.length - siv0 <= 1, "單次 focus 觸發多次 scrollIntoView：" + (sivTitle.length - siv0));
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
      await ev("focusField", "note");
      await frames();
      const sivBefore = await evaluate("window.__siv.length");
      await ev("vvSet", H - 300);
      await frames();
      const gKb = await ev("geo", "note");
      const sivAfter = await evaluate("window.__siv.slice(" + sivBefore + ")");
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
      await check("K2 網頁版 visualViewport：鍵盤 300px → paddingBottom 300px；40px（<=50）視為無鍵盤；超高上限 round(innerHeight×0.55)；vv scroll 事件也更新；收起歸零（移除 inline）", () => {
        assert.ok(vv0.live.resize >= 1 && vv0.live.scroll >= 1, "未訂閱 vv resize／scroll：" + JSON.stringify(vv0));
        assert.equal(vv0.live.resize, 1, "StrictMode 後 resize listener 應只剩 1 個：" + JSON.stringify(vv0));
        assert.equal(vv0.live.scroll, 1, "StrictMode 後 scroll listener 應只剩 1 個：" + JSON.stringify(vv0));
        assert.equal(gKb.inlinePb, "300px");
        assert.equal(gSmall.inlinePb, "", "40px 不應視為鍵盤：" + gSmall.inlinePb);
        assert.equal(gHuge.inlinePb, Math.round(H * 0.55) + "px");
        assert.equal(gScrollEv.inlinePb, "280px");
        assert.equal(gHide.inlinePb, "");
        assert.ok(sivAfter.some((c) => c.tag === "TEXTAREA"), "鍵盤高度生效後未對正在輸入的備註 scrollIntoView：" + JSON.stringify(sivAfter));
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
      await check("K2b 鍵盤開著時關閉 Sheet：解除 vv resize／scroll listener（live＝0）；重開時（鍵盤已收）paddingBottom 歸零", () => {
        assert.equal(vvClosed.live.resize, 0, JSON.stringify(vvClosed));
        assert.equal(vvClosed.live.scroll, 0, JSON.stringify(vvClosed));
        assert.equal(gReopen.open, true);
        assert.equal(gReopen.inlinePb, "", "重開後殘留 paddingBottom：" + gReopen.inlinePb);
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
      await check("K3 原生：Keyboard listener 安裝 4 個（will/did show/hide）；keyboardWillShow 336 → paddingBottom 336px；原生時忽略 vv；keyboardWillHide 歸零", () => {
        assert.equal(capAdds, 4, "addListener 次數 " + capAdds);
        assert.ok(nShow >= 1);
        assert.equal(gShow.inlinePb, "336px");
        assert.equal(gVv.inlinePb, "336px", "原生時 vv 事件改變了 paddingBottom：" + gVv.inlinePb);
        assert.equal(gHide.inlinePb, "");
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
      await check("K3b 鍵盤開著時關閉 Sheet：subscriber 解除（最後一次 remove 後 count＝0）；重開 paddingBottom 歸零；StrictMode 未遺留重複 subscriber", () => {
        const removes = logClosed.filter((l) => l.action === "remove");
        assert.ok(removes.length >= 1, JSON.stringify(logClosed));
        assert.equal(removes.at(-1).count, 0, "關閉後仍有 subscriber：" + JSON.stringify(logClosed));
        assert.equal(gReopen.inlinePb, "", "重開後殘留：" + gReopen.inlinePb);
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
        assert.equal(gAgain.inlinePb, "336px");
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
        const pre = await ev("geo", kind);
        await ev("focusField", kind);
        await ev("capFire", "keyboardWillShow", 336);
        await frames();
        await sleep(80);
        const g = await ev("geo", kind);
        info(`K4 ${kind}：鍵盤前 ${JSON.stringify({ el: pre.el, scroller: pre.scroller })}；鍵盤後 ${JSON.stringify({ pb: g.inlinePb, dialog: g.dialog, el: g.el, scroller: g.scroller, save: g.save })}`);
        await check(`K4 ${kind}：鍵盤 336px 升起後，欄位位於鍵盤上緣（innerHeight−336）之上，且在 Sheet 捲動區可視範圍內；「儲存」按鈕也在鍵盤上方`, () => {
          assert.deepEqual(missingCss, [], "缺少真實 CSS，無法量測");
          const kbTop = g.innerH - 336;
          assert.equal(g.inlinePb, "336px");
          assert.ok(g.el.bottom <= kbTop + 0.5, `欄位底 ${g.el.bottom} 被鍵盤（上緣 ${kbTop}）蓋住`);
          assert.ok(g.el.top >= g.scroller.top - 0.5 && g.el.bottom <= g.scroller.bottom + 0.5, `欄位 ${JSON.stringify(g.el)} 不在捲動區可視範圍 ${JSON.stringify(g.scroller)}`);
          assert.ok(g.save.bottom <= kbTop + 0.5, `儲存按鈕底 ${g.save.bottom} 被鍵盤蓋住`);
          assert.ok(g.dialog.top >= -0.5, "Sheet 頂端超出視窗：" + g.dialog.top);
        });
      }
      await ev("capFire", "keyboardWillHide", 0);
      await ev("unmount");
      await ev("setNative", false);
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
