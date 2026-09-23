import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-review-browser-"));
const mocks = { "@/hooks/use-i18n": `export const useI18n=()=>({locale:"zh-TW"});` };
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {PlaceRecommendationReason} from './src/components/PlaceRecommendationReason';
import {writePlaceRuntimeCache} from './src/lib/place-runtime-cache';
import {extractPlaceReviewEvidence} from './src/lib/place-review-evidence';
let calls=0;window.fetch=async()=>{calls++;throw Error('renderer must not fetch')};
const p={id:'ChIJ_BrowserReview',name:'Cafe',primaryType:'point_of_interest',reason:'這是一個地點。'};
const root=createRoot(document.getElementById('root'));
const tick=()=>new Promise(r=>setTimeout(r,20));
const until=async(fn,msg)=>{for(let i=0;i<100;i++){if(fn())return;await tick();}throw Error(msg+': '+document.getElementById('root').textContent)};
window.run=async()=>{
 root.render(<>{['Explore','Search','Favorites','Itinerary'].map(surface=><article key={surface}><PlaceRecommendationReason place={p} presentation="detail"/></article>)}</>);
 await until(()=>document.querySelectorAll('article').length===4,'cold mount');
 await tick();if(document.querySelector('article').textContent!=='這是一個地點。')throw Error('cold reason');
 const enriched={...p,primaryType:'bakery',types:['bakery','food','store'],reviewEvidence:extractPlaceReviewEvidence(p.id,[{name:'a',text:{text:'有提供插座'}},{name:'b',text:{text:'座位旁有插座'}}]),todayHoursLabel:'10:00–18:00'};
 writePlaceRuntimeCache(p.id,{reasonPlace:enriched});
 await until(()=>[...document.querySelectorAll('article')].every(el=>el.textContent.startsWith('這是一間烘焙店')&&el.textContent.includes('插座')&&el.textContent.includes('18:00')),'enrichment event updates all mounted surfaces');
 const texts=[...document.querySelectorAll('article')].map(el=>el.textContent);
 if(new Set(texts).size!==1)throw Error('different core reason');
 const hotel={...p,id:'ChIJ_BrowserHotel',name:'Example'};
 root.render(<>{['Explore','Search','Favorites','Itinerary'].map(surface=><article key={surface}><PlaceRecommendationReason place={hotel} presentation="detail"/></article>)}</>);
 await until(()=>[...document.querySelectorAll('article')].every(el=>el.textContent==='這是一個地點。'),'cold hotel');
 writePlaceRuntimeCache(hotel.id,{reasonPlace:{...hotel,primaryType:'hotel',types:['hotel','lodging'],reviewEvidence:extractPlaceReviewEvidence(hotel.id,[{text:{text:'環境安靜，服務親切'}}]),todayHoursLabel:'07:00–23:00'}});
 await until(()=>[...document.querySelectorAll('article')].every(el=>el.textContent.startsWith('這是一間飯店')&&el.textContent.includes('安靜')&&el.textContent.includes('親切')&&el.textContent.includes('23:00')),'hotel enrichment retains reviews and hours');
 const hotelReason=document.querySelector('article').textContent;
 if(calls!==0)throw Error('render fetched');
 root.unmount();return {result:'PASS',hotelReason,hotelUpgrade:true,mountedColdToEnriched:true,stalePersistedReasonIgnored:true,fourSurfacesSameCore:true,providerRequests:calls,finalReason:texts[0]};};`;
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
  console.log("Recommendation review browser regression:", JSON.stringify(result.result.value));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
