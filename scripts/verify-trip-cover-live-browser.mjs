import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-trip-cover-"));
const mocks = {
  "@/lib/personalized-cache-envelope": `export const readOwnedPersonalizedCache=()=>null;export const wrapPersonalizedCache=x=>x;`,
  "@/lib/auth-session": `export const getAuthenticatedUserId=async()=>"fixture";export const getClientAuthSession=async()=>null;export const requireAuthenticatedUser=async()=>({id:"fixture"});export const readCachedAuthenticatedUserIdSync=()=>null;`,
  "@/integrations/supabase/client": `export const isSupabaseConfigured=false;export const supabase={from(){const chain={update(patch){window.coverWrites=(window.coverWrites||0)+1;chain.patch=patch;return chain},eq(){return chain},select(){if(!chain.patch)throw Error('extra DB read');return chain},single:async()=>({data:{...window.fixtureRow,...chain.patch},error:null})};return chain}};`,
  "@/services/placeImageService": `export const getRoamieDefaultImage=()=>'/pixel.svg?default';export const getTripCoverImage=()=>{throw Error("duplicate cover request")};export const tripCoverInputFromPayload=()=>({});`,
  "@/lib/safe-image-url": `export const resolvePlaceImageUrl=x=>x;export const preferJpegPngImageUrl=x=>x;export const getLocalPlaceImageFallback=()=>'/pixel.svg?fallback';`,
  "@/lib/places-api-stats": `export const recordPlacesPhotoUrlLoad=()=>{};`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {updateTripMeta} from './src/lib/itinerary-storage';
import {TripCoverImage} from './src/components/media/TripCoverImage';
import {useLiveTripCover} from './src/lib/saved-trip/use-live-cover';
import {publishTripCover,applyTripCover} from './src/lib/saved-trip/cover-live-state';
import {coverFieldsFromStored} from './src/lib/saved-trip/display';
const row=(id,n=0,url='/pixel.svg?default')=>({id,updated_at:'2026-10-01T00:00:0'+n+'.000Z',cover_image:url,custom_cover_image_url:null,cover_image_url:null,is_cover_customized:false,cover_source:'unsplash',cover_query:null,mood:null});
let decodeDone;HTMLImageElement.prototype.decode=function(){return new Promise(r=>decodeDone=r)};
function Card({id}){const live=useLiveTripCover(id);const current=applyTripCover(row(id));return <article data-id={id} style={{width:300,height:200}}><span>Trip contents</span><TripCoverImage {...coverFieldsFromStored(current)} resolutionPending={live?.resolution==='pending'&&!current.is_cover_customized}/></article>}
const root=createRoot(document.getElementById('root'));
const tick=()=>new Promise(r=>setTimeout(r,20));const until=async(f,m)=>{for(let i=0;i<150;i++){if(f())return;await tick()}throw Error(m)};
const check=(v,m)=>{if(!v)throw Error(m)};
window.run=async()=>{
 window.fixtureRow={...row('mutation',4,'/pixel.svg?mutation'),title:'fixture',created_at:'2026-10-01T00:00:00.000Z',payload:{version:2,title:'fixture',itinerary:[],recommendations:[]}};
 const mutation=await updateTripMeta('mutation',{cover_image:'/pixel.svg?mutation'});
 check(mutation?.cover_image==='/pixel.svg?mutation','actual storage mutation returns cover row');
 check(applyTripCover(row('mutation')).cover_image==='/pixel.svg?mutation','storage publishes returned row');
 check(window.coverWrites===1,'one mutation, no extra DB read or cover generation');
 publishTripCover(row('A'),'pending');root.render(<Card id='A'/>);
 await until(()=>document.querySelector('[aria-busy=true]'),'pending skeleton');
 check(!document.querySelector('img'),'pending does not request default');check(document.body.textContent.includes('Trip contents'),'content is immediate');
 publishTripCover(row('A',2,'/pixel.svg?resolved'),'resolved');
 await until(()=>decodeDone,'image onLoad reaches decode');
 check(document.querySelector('img').className.includes('opacity-0'),'no reveal before decode');decodeDone();
 await until(()=>document.querySelector('img').className.includes('opacity-100'),'decode reveals');
 publishTripCover(row('A',1,'/pixel.svg?stale'),'resolved');await tick();check(document.querySelector('img').src.includes('resolved'),'stale ignored');
 root.render(null);await tick();root.render(<Card id='A'/>);await until(()=>document.querySelector('img')?.src.includes('resolved'),'remount replays');
 publishTripCover(row('B'),'pending');root.render(<Card id='B'/>);await until(()=>document.querySelector('[aria-busy=true]'),'trip B pending');check(!document.querySelector('img'),'trip A image not retained');
 publishTripCover({...row('B'),cover_source:'roamie'},'fallback');await until(()=>document.querySelector('img')?.src.includes('default'),'confirmed fallback');
 publishTripCover({...row('C'),is_cover_customized:true,custom_cover_image_url:'/pixel.svg?custom'},'pending');root.render(<Card id='C'/>);await until(()=>document.querySelector('img')?.src.includes('custom'),'custom takes precedence');
 root.unmount();return {result:'PASS',pendingWithoutDefault:true,decodeBeforeReveal:true,staleIgnored:true,remountReplay:true,tripIsolation:true,confirmedFallback:true,customPriority:true};};`;
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
      ? "application/javascript"
      : req.url.startsWith("/pixel.svg") || req.url.startsWith("/api/place-photo?")
        ? "image/svg+xml"
        : "text/html",
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
  console.log("Trip cover live runtime regression:", JSON.stringify(result.result.value));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
