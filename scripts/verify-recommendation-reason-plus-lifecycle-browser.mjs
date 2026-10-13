// Real React render/effect regression for the V2 Plus reason profile lifecycle.
// Offline: auth/access/preferences are mocked with controllable deferred promises.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-reason-lifecycle-"));
const mocks = {
  "@/hooks/use-i18n": `export const useI18n=()=>({locale:"zh-TW"});`,
  "@/hooks/use-access": `import {createContext,useContext} from "react";
export const AccessCtx=createContext(null);export const useAccessOptional=()=>useContext(AccessCtx);`,
  "@/hooks/use-auth": `import {createContext,useContext} from "react";
export const AuthCtx=createContext({user:null});export const useAuth=()=>useContext(AuthCtx);`,
  "@/lib/auth-session": `export const readCachedAuthenticatedUserIdSync=()=>window.__cachedUid??null;`,
  "@/lib/preferences-storage": `export const resolveBudgetMode=(p)=>p?.budgetMode;
export const getPreferences=()=>{window.__prefCalls++;const uid=window.__cachedUid;
return new Promise((res,rej)=>window.__prefQueue.push({uid,res,rej}));};`,
};
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PlaceRecommendationReason} from './src/components/PlaceRecommendationReason';
import {AccessCtx} from '@/hooks/use-access';import {AuthCtx} from '@/hooks/use-auth';
import {PREFS_UPDATED_EVENT} from './src/lib/preference-events';
let calls=0;window.fetch=async()=>{calls++;throw Error('renderer must not fetch')};
window.__prefCalls=0;window.__prefQueue=[];window.__cachedUid=null;
const museum={id:'ChIJ_ReasonLifecycle',name:'Synthetic Museum',primaryType:'museum',types:['museum']};
const FALLBACK='可以排進這趟的探索路線，作為其中一站。';
const A_TEXT='想放慢步調的話，可以把這站排得寬鬆一些。';
const B_TEXT='和你偏好的文化藝術主題相符。';
const A_PREFS={onboarded:true,pace:'slow'};
const B_PREFS={onboarded:true,pace:'active',interests:['文化藝術']};
let setViewer;
function App(){const [v,set]=useState({uid:null,plus:false});setViewer=set;
 return <AuthCtx.Provider value={{user:v.uid?{id:v.uid}:null}}><AccessCtx.Provider value={{hasPlusAccess:v.plus}}>
 {[1,2,3].map(k=><article key={k}><PlaceRecommendationReason place={museum}/></article>)}
 </AccessCtx.Provider></AuthCtx.Provider>;}
const tick=()=>new Promise(r=>setTimeout(r,20));
const texts=()=>[...document.querySelectorAll('article')].map(e=>e.textContent);
const all=(t)=>texts().length===3&&texts().every(x=>x===t);
const until=async(t,msg)=>{for(let i=0;i<100;i++){if(all(t))return;await tick();}throw Error(msg+': '+JSON.stringify(texts()))};
const viewer=async(uid,plus)=>{window.__cachedUid=uid;setViewer({uid,plus});await tick();};
const settle=async(uid,prefs)=>{const i=window.__prefQueue.findIndex(q=>q.uid===uid);if(i<0)throw Error('no pending load for '+uid);
 const [q]=window.__prefQueue.splice(i,1);q.res(prefs);await tick();await tick();};
const steps=[];const step=(s)=>steps.push(s);
window.run=async()=>{
 const root=createRoot(document.getElementById('root'));
 root.render(<React.StrictMode><App/></React.StrictMode>);
 await until(FALLBACK,'guest mount');step('guest:fallback');
 // 1. Plus async load re-renders every mounted card; StrictMode + 3 cards share one load.
 await viewer('user-a',true);
 if(!all(FALLBACK))throw Error('profile shown before load');
 if(window.__prefCalls!==1)throw Error('expected 1 deduped prefs load, got '+window.__prefCalls);
 await settle('user-a',A_PREFS);await until(A_TEXT,'plus async load');step('plusLoad:rerender');
 // 2. Sign-out hides the previous profile immediately.
 await viewer(null,false);await until(FALLBACK,'logout');step('logout:hidden');
 // 3. Free never loads or shows a profile; Free->Plus loads; Plus->Free hides.
 const before=window.__prefCalls;await viewer('user-b',false);await until(FALLBACK,'free');
 if(window.__prefCalls!==before)throw Error('free loaded prefs');
 await viewer('user-b',true);await settle('user-b',B_PREFS);await until(B_TEXT,'free->plus');
 await viewer('user-b',false);await until(FALLBACK,'plus->free');step('entitlement:switch');
 // 4. Direct Plus A -> Plus B switch never shows A's preference to B.
 await viewer('user-a',true);await settle('user-a',A_PREFS);await until(A_TEXT,'a reload');
 await viewer('user-b',true);if(texts().some(t=>t===A_TEXT))throw Error('A profile visible to B');
 await until(FALLBACK,'b pending');await settle('user-b',B_PREFS);await until(B_TEXT,'b loaded');step('account:isolated');
 // 5. Preference update drops the old snapshot and reloads.
 window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));await until(FALLBACK,'prefs update clears');
 await settle('user-b',{onboarded:true,pace:'slow'});await until(A_TEXT,'prefs update reload');step('prefsUpdate:reloaded');
 // 6. Stale async: A's late result must not overwrite B, in either resolution order.
 await viewer('user-a',true);await viewer('user-b',true);
 await settle('user-b',B_PREFS);await until(B_TEXT,'b first');
 await settle('user-a',A_PREFS);for(let i=0;i<5;i++)await tick();
 if(!all(B_TEXT))throw Error('stale A overwrote B: '+JSON.stringify(texts()));
 await viewer(null,false);await viewer('user-a',true);await viewer('user-b',true);
 await settle('user-a',A_PREFS);for(let i=0;i<5;i++)await tick();
 if(texts().some(t=>t===A_TEXT))throw Error('stale A shown while B pending');
 await settle('user-b',B_PREFS);await until(B_TEXT,'b after stale a');step('staleAsync:discarded');
 if(calls!==0)throw Error('renderer fetched');
 root.unmount();
 return {result:'PASS',steps,prefsLoads:window.__prefCalls,providerRequests:calls,strictMode:true};};`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  outfile: path.join(dir, "app.js"),
  format: "iife",
  loader: { ".png": "dataurl", ".jpg": "dataurl" },
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "controlled-network",
      setup(b) {
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
const server = http.createServer((req, res) => {
  if (req.url.includes("binaryfail=1")) {
    res.writeHead(502);
    res.end("fixture binary failure");
    return;
  }
  res.setHeader(
    "Content-Type",
    req.url === "/app.js"
      ? "application/javascript; charset=utf-8"
      : req.url.startsWith("/pixel.svg") || req.url.startsWith("/api/place-photo?")
        ? "image/svg+xml"
        : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(dir, "app.js"))
      : req.url.startsWith("/pixel.svg") || req.url.startsWith("/api/place-photo?")
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        : '<div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" + path.join(dir, "chrome"),
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    chrome.stderr.on("data", (b) => {
      output += b;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    chrome.on("error", reject);
    chrome.on("exit", (code) => reject(Error("Chrome exit " + code)));
    setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const r = JSON.parse(e.data);
    if (r.id) {
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
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: targetInfos.find((t) => t.type === "page").targetId,
    flatten: true,
  });
  await send(
    "Page.navigate",
    { url: "http://127.0.0.1:" + server.address().port + "/welcome" },
    sessionId,
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const r = await send(
      "Runtime.evaluate",
      { expression: 'typeof window.run === "function"', returnByValue: true },
      sessionId,
    );
    if (r.result.value) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, "browser harness loaded");
  const result = await send(
    "Runtime.evaluate",
    { expression: "window.run()", awaitPromise: true, returnByValue: true },
    sessionId,
  );
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  const value = result.result.value;
  assert.equal(value?.result, "PASS", JSON.stringify(value));
  console.log("Recommendation reason Plus lifecycle (React StrictMode):", JSON.stringify(value));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
