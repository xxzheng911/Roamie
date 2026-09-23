import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-favorites-photo-"));
const mocks = {
  "@/integrations/supabase/client": `export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}};`,
  "@/lib/api-url": `export const resolveApiUrl=url=>new URL(url,window.location.origin).href;`,
  "@/lib/pie/places-gateway": `export const getPlaceDetailsServerFnViaGateway=async()=>{window.discoveryCalls++;throw Error('unexpected discovery')};`,
  "@/services/unsplashService": `export const searchUnsplashImage=async()=>null;export const searchUnsplashWithQueries=async()=>null;`,
  "@/lib/google-maps-client": `export const buildPlacePhotoUrl=(photo,w)=>'/api/place-photo?photo='+encodeURIComponent(photo)+'&w='+w;`,
  "@/lib/app-perf": `export const logPerfImageLoad=()=>{};`,
  "@/hooks/use-in-viewport": `export const useInViewport=()=>true;`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {SavedPlaceCoverThumb} from './src/components/saved/SavedPlaceCoverThumb';
import {writePlaceRuntimeCache} from './src/lib/place-runtime-cache';
import {getSignedPlacePhotoUrl} from './src/services/signed-place-photo';
window.discoveryCalls=0;let calls=0;const pending=new Map();const errors=[];
window.addEventListener('unhandledrejection',e=>{errors.push(e.reason);e.preventDefault()});
window.fetch=async(url,init)=>{if(!url.includes('/api/place-photo/sign'))throw Error('Unexpected request');calls++;
 const body=JSON.parse(init.body);return new Promise(resolve=>pending.set(body.photo,()=>resolve({ok:true,status:200,json:async()=>({url:'/api/place-photo?photo='+encodeURIComponent(body.photo)+'&w='+body.width+'&expires=9999999999&signature=fixture'})})));};
const root=createRoot(document.getElementById('root'));const photo=id=>'places/ChIJ_'+id+'/photos/first';
const place=(id,extra={})=>({id,name:id,category:'cafe',metadata:{googlePlaceId:'ChIJ_'+id,photoName:photo(id)},...extra});
const render=places=>root.render(<>{places.map(p=><article key={p.id} data-card={p.id}><span>{p.name}</span><div style={{height:64,width:64}}><SavedPlaceCoverThumb place={p}/></div></article>)}</>);
const tick=()=>new Promise(r=>setTimeout(r,20));
const until=async(fn,msg)=>{for(let i=0;i<150;i++){if(fn())return;await tick();}throw Error(msg);};
const check=(v,msg)=>{if(!v)throw Error(msg)};
window.run=async()=>{
 render([place('A'),place('B')]);
 await until(()=>pending.has(photo('A'))&&pending.has(photo('B')),'both cards resolve concurrently');
 check(document.querySelectorAll('article').length===2,'records render while photos pending');
 const before=document.querySelector('[data-card=A]').getBoundingClientRect().height;
 pending.get(photo('A'))();
 await until(()=>document.querySelector('[data-card=A] img')?.src.includes('signature='),'A renders independently');
 check(!document.querySelector('[data-card=B] img'),'B still pending');
 check(document.querySelector('[data-card=A]').getBoundingClientRect().height===before,'fixed image dimensions prevent layout shift');
 pending.get(photo('B'))();await until(()=>document.querySelector('[data-card=B] img')?.src.includes('signature='),'B completes');
 const count=calls;render([]);await tick();render([place('A'),place('B')]);await tick();await tick();
 check(calls===count,'remount uses signed cache without signing fetch');check(window.discoveryCalls===0,'persisted metadata skips discovery');
 render([place('saved',{metadata:{},cover_image:'/pixel.svg?saved=1'})]);
 await until(()=>document.querySelector('img')?.src.includes('saved=1'),'saved thumbnail reused');check(calls===count,'saved URL skips discovery/signing');
 writePlaceRuntimeCache('ChIJ_C',{photoName:photo('C')});
 render([place('C',{metadata:{googlePlaceId:'ChIJ_C'}})]);
 await until(()=>pending.has(photo('C')),'shared metadata used');check(window.discoveryCalls===0,'shared cache skips discovery');pending.get(photo('C'))();
 await until(()=>document.querySelector('img')?.src.includes('signature='),'shared photo completes');
 const larger=getSignedPlacePhotoUrl(photo('large'),600);await until(()=>pending.has(photo('large')),'large signing');pending.get(photo('large'))();await larger;
 const beforeLarge=calls;render([place('large')]);await tick();await tick();check(calls===beforeLarge,'thumbnail reuses larger signed cover');
 render([place('failure',{metadata:{googlePlaceId:'ChIJ_failure'}}),place('A')]);
 await until(()=>window.discoveryCalls===1,'failure exercised');await tick();await tick();
 check(document.querySelector('[data-card=A] img')?.src.includes('signature='),'failed photo does not affect another card');check(errors.length===0,'no unhandled photo rejection');
 root.unmount();return {result:'PASS',recordsBeforePhotos:true,independentResolution:true,cacheHitNoFetch:true,failureIsolation:true,noLayoutShift:true,savedThumbnail:true,sharedMetadata:true,largerSignedCache:true};};`;
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
  console.log("Favorites image runtime regression:", JSON.stringify(result.result.value));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
