import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import http from "node:http";import {spawn,execFileSync} from "node:child_process";
import {build} from "esbuild";
const root=process.cwd();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roamie-home-photo-'));
const baseline=process.argv.includes('--baseline');
const mocks={
 '@/integrations/supabase/client':`export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}};`,
 '@/lib/api-url':`export const resolveApiUrl=url=>new URL(url,window.location.origin).href;`,
 '@/services/placeImageService':`export const getRoamieDefaultImage=()=>'/pixel.svg?fallback=1';`,
 '@/lib/google-maps-client':`export const buildPlacePhotoUrl=(photo,w)=>'/api/place-photo?photo='+encodeURIComponent(photo)+'&w='+w;`,
 '@/lib/safe-image-url':`export const resolvePlaceImageUrl=url=>url||null;export const extractGooglePlacePhotoName=url=>new URL(url,window.location.origin).searchParams.get('photo');export const preferJpegPngImageUrl=url=>url;`,
 '@/lib/app-perf':`export const logPerfImageLoad=()=>{};`,
 '@/hooks/use-in-viewport':`export const useInViewport=()=>true;`,
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {PlaceCoverImage} from './src/components/media/PlaceCoverImage';
let mode='transient',calls=0;const errors=[],events=[];const originalInfo=console.info;console.info=(tag,data)=>{events.push({tag,...data});originalInfo(tag,data)};
window.addEventListener('unhandledrejection',e=>{errors.push(e.reason?.message);e.preventDefault()});
window.fetch=async(url,init)=>{if(!url.includes('/api/place-photo/sign'))throw Error('Unexpected Detail fetch');calls++;if(mode==='offline'||(mode==='transient'&&calls===1))throw Error('fixture network rejection');return {ok:true,status:200,json:async()=>({url:'/api/place-photo?photo='+encodeURIComponent(JSON.parse(init.body).photo)+'&w=480&expires=9999999999&signature=fixture'+(mode==='binary'?'&binaryfail=1':'')})}};
const root=createRoot(document.getElementById('root'));const photo='places/fixture/photos/first';
const render=(name=photo,locale='zh-TW')=>root.render(<div data-locale={locale}><PlaceCoverImage photoName={name} placeId='fixture' name='Cafe' priority/></div>);
const wait=ms=>new Promise(r=>setTimeout(r,ms));const check=(v,msg)=>{if(!v)throw Error(msg)};
window.run=async()=>{render();await wait(900);
 if(${baseline}){check(errors.length>0&&!document.querySelector('img'),'HEAD rejection leaves blank loading');return {result:'PASS',baselineBlankReproduced:true};}
 check(errors.length===0,'no unhandled rejection');let img=document.querySelector('img');check(img?.src.includes('expires='),'transient signing failure retried');check(!img.className.includes('opacity-0'),'real image onLoad settles loading');check(calls===2,'bounded retry');
 const before=calls;render(photo,'ko');await wait(80);check(calls===before,'same photo/locale-only rerender does not reload');
 mode='binary';render('places/fixture/photos/binary');await wait(900);check(document.querySelector('img')?.src.includes('fallback=1'),'binary failure fallback');check(events.some(e=>e.imageLoadFailed===true),'binary failure diagnostic');
 mode='offline';render('places/fixture/photos/offline');await wait(900);img=document.querySelector('img');check(img?.src.includes('fallback=1'),'permanent rejection settles fallback');check(!img.className.includes('opacity-0'),'fallback visible');check(errors.length===0,'offline no unhandled rejection');
 root.unmount();return {result:'PASS',transientRetry:true,permanentFailureSettles:true,stablePhotoRerender:true,imageLoadFailure:true};};`;
await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(dir,'app.js'),format:'iife',define:{'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[{name:'controlled-network',setup(b){
 if(baseline)b.onLoad({filter:/[/\\]signed-place-photo\.ts$/},()=>({contents:execFileSync('git',['show','62fb6901c59ae16d7d01ec85a5571548fbeba4c9:src/services/signed-place-photo.ts'],{encoding:'utf8'}),loader:'ts',resolveDir:path.join(root,'src/services')}));
 b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));}}]});
const server = http.createServer((req, res) => {
  if(req.url.includes("binaryfail=1")){res.writeHead(502);res.end("fixture binary failure");return;}
  res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : (req.url.startsWith("/pixel.svg") || req.url.startsWith("/api/place-photo?")) ? "image/svg+xml" : "text/html");
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(dir, "app.js"))
      : (req.url.startsWith('/pixel.svg') || req.url.startsWith('/api/place-photo?')) ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' : '<div id="root"></div><script src="/app.js"></script>',
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
  console.log("Home image runtime regression:", JSON.stringify(result.result.value));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
