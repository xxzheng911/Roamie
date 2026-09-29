import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build, stop } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-hero-browser-"));
// Real components and signing cache, controlled auth/API fixtures; no Google traffic.
const mocks = {
  "@/integrations/supabase/client": `export const isSupabaseConfigured=false;export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}}`,
  "@/lib/api-url": `export const resolveApiUrl=p=>location.origin+p`,
  "@/services/placeImageService": `export const getRoamieDefaultImage=()=>"/fallback.png"`,
  "@/hooks/use-i18n": `export const useI18n=()=>({locale:'en',t:k=>k})`,
  "@/components/PlaceRecommendationReason": `export const PlaceRecommendationReason=()=>null`,
  "@/components/trip/TripAffiliateSection": `export const TripAffiliateSection=()=>null`,
  "@/components/TabelogExternalLink": `export const TabelogExternalLink=()=>null`,
  "@/lib/maps-navigation": `export const openExternal=()=>{}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {PlaceDetailSheet} from '${root}/src/components/map/PlaceDetailSheet';
import {SafeImage} from '${root}/src/components/media/SafeImage';
import {clearImageLoadFailure} from '${root}/src/lib/image-url-failure-cache';
const root=createRoot(document.getElementById('root'));const noop=()=>{};
window.imageLoads=0;document.addEventListener('load',e=>{if(e.target.tagName==='IMG')window.imageLoads++;},true);
window.mount=(id,photo=id,resolution='pending')=>flushSync(()=>root.render(<PlaceDetailSheet
place={{id,name:'Snapshot '+id,placeName:'Snapshot '+id,localizedDisplayName:'Snapshot '+id,rating:4.5,address:'Snapshot address',reason:'',openStatus:'unknown'}}
imageUrls={photo ? [photo.startsWith('/')?photo:'places/'+photo+'/photos/fixture'] : []}
photoResolution={resolution} distanceLabel={null} isSaved={false} isBusy={false} transportModes={[]}
transportLoading={false} transportTip='' selectedTransportMode={null} onSelectTransportMode={noop}
onNavigate={noop} onToggleSave={noop} onAddToTrip={noop} onOpenChat={noop}/>));
window.mountSafe=src=>flushSync(()=>root.render(<SafeImage src={src} loading='eager'/>));
window.clearFailure=clearImageLoadFailure;
window.captureOld=()=>{const img=document.querySelector('img');const p=img[Object.keys(img).find(k=>k.startsWith('__reactProps'))];window.fireOld=()=>{p.onLoad({currentTarget:img});p.onError({currentTarget:img});}};
window.state=()=>{const img=document.querySelector('img');const hero=document.querySelector('[data-place-detail-hero]');return {
mode:hero?.dataset.placeDetailHero,visual:img?.dataset.safeImageState,src:img?.getAttribute('src'),
opacity:img&&getComputedStyle(img).opacity,transition:img&&getComputedStyle(img).transitionDuration,
skeleton:!!document.querySelector('[data-place-detail-hero-skeleton]'),text:document.body.textContent,
height:hero?.getBoundingClientRect().height};};`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  logLevel: "error",
  outfile: path.join(dir, "app.js"),
  format: "iife",
  loader: { ".png": "dataurl", ".jpg": "dataurl" },
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixtures",
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
const css = fs
  .readdirSync(path.join(root, "dist/client/assets"))
  .filter((f) => /^styles-.*\.css$/.test(f))
  .map((f) => fs.readFileSync(path.join(root, "dist/client/assets", f), "utf8"))
  .join("\n");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=",
  "base64",
);
const counts = { sign: 0, media: 0, fallback: 0 };
const gates = new Map();
const release = (key) => {
  assert.ok(gates.has(key), "Missing gate " + key);
  gates.get(key)();
  gates.delete(key);
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname === "/api/place-photo/sign") {
    counts.sign++;
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const photo = body.photo;
    const id = photo.split("/")[1];
    const respond = () => {
      res.setHeader("Content-Type", "application/json");
      if (id === "sign-fail") {
        res.statusCode = 403;
        res.end("{}");
        return;
      }
      res.end(
        JSON.stringify({
          url:
            "/api/place-photo?" +
            new URLSearchParams({
              photo,
              w: "600",
              expires: String(Math.floor(Date.now() / 1000) + 3600),
              signature: "fixture",
            }),
        }),
      );
    };
    if (id === "cold" || id === "old-sign") gates.set("sign:" + id, respond);
    else respond();
    return;
  }
  if (url.pathname === "/api/place-photo" || url.pathname === "/direct.png") {
    counts.media++;
    const id =
      url.pathname === "/direct.png" ? "direct" : url.searchParams.get("photo").split("/")[1];
    gates.set("media:" + id, () => {
      res.setHeader("Cache-Control", "no-store");
      if (id === "media-fail") {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "image/png");
      res.end(png);
    });
    return;
  }
  if (url.pathname === "/fallback.png") {
    counts.fallback++;
    res.setHeader("Content-Type", "image/png");
    res.end(png);
    return;
  }
  if (url.pathname === "/app.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(fs.readFileSync(path.join(dir, "app.js")));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end("<style>" + css + '</style><div id="root"></div><script src="/app.js"></script>');
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
  let pageLoads = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const r = JSON.parse(e.data);
    if (r.method === "Page.loadEventFired") pageLoads++;
    if (r.method === "Runtime.exceptionThrown")
      console.error(
        "BROWSER_EXCEPTION",
        r.params.exceptionDetails.exception?.description || r.params.exceptionDetails.text,
      );
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

  const call = (method, params = {}) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const tick = () => new Promise((r) => setTimeout(r, 100));
  const until = async (fn, msg) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await tick();
    }
    throw Error(
      msg +
        ": " +
        (await evaluate(
          "location.href + ' ' + document.body.innerText.slice(0,1200) + ' HTML: ' + document.body.innerHTML.slice(0,900)",
        )),
    );
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port });
  await until(() => evaluate("!!window.mount"), "fixture ready");
  const state = () => evaluate("window.state()");
  const mount = (...args) =>
    evaluate("window.mount(" + args.map((v) => JSON.stringify(v)).join(",") + ")");
  const gate = (key) => until(() => gates.has(key), "request " + key);
  const ready = () => until(async () => (await state()).mode === "provider-photo", "image ready");
  const loading = async () => {
    const s = await state();
    assert.equal(s.mode, "loading");
    assert.equal(s.skeleton, true);
    assert.notEqual(s.src, "/fallback.png");
    return s;
  };
  await mount("cold");
  await gate("sign:cold");
  const first = await loading();
  assert.match(first.text, /Snapshot cold/);
  assert.match(first.text, /Snapshot address/);
  assert.match(first.text, /4.5/);
  assert.ok(first.height > 0);
  assert.equal(counts.media, 0);
  assert.equal(counts.fallback, 0);
  release("sign:cold");
  await gate("media:cold");
  assert.equal((await loading()).opacity, "0");
  release("media:cold");
  await ready();
  assert.equal((await state()).height, first.height);
  assert.equal((await state()).transition, "0.3s");
  assert.equal(counts.sign, 1);
  assert.equal(counts.media, 1);
  console.log(
    "PASS A: cold sign -> media onLoad -> 300ms reveal; shell immediate; 1 sign + 1 media",
  );
  const loadsBefore = await evaluate("window.imageLoads");
  const warmInitial = await evaluate("window.mount('warm','cold');window.state()");
  assert.equal(warmInitial.mode, "loading");
  await until(
    async () => gates.has("media:cold") || (await state()).mode === "provider-photo",
    "warm image",
  );
  if (gates.has("media:cold")) {
    await loading();
    release("media:cold");
  }
  await ready();
  assert.equal(counts.sign, 1);
  assert.ok(counts.media <= 2);
  assert.ok((await evaluate("window.imageLoads")) > loadsBefore);
  console.log(
    "PASS B: warm signing cache still waits for onLoad; zero extra sign; browser may reuse decoded media",
  );
  const fallbackBefore = counts.fallback;
  await mount("hydration", null);
  await loading();
  assert.equal(counts.fallback, fallbackBefore);
  await mount("hydration", "hydrated", "settled");
  await gate("media:hydrated");
  await loading();
  release("media:hydrated");
  await ready();
  console.log("PASS E: missing photo remains skeleton through hydration");
  await mount("none", null, "settled");
  await until(async () => (await state()).mode === "fallback-visual", "no photo fallback");
  assert.equal((await state()).src, "/fallback.png");
  console.log("PASS F: completed empty Details shows fallback");
  await mount("placeholder", "/fallback.png", "pending");
  await loading();
  console.log("PASS: snapshot default cover excluded while pending");
  await mount("old");
  await gate("media:old");
  await evaluate("window.captureOld()");
  await mount("old", "new", "settled");
  await gate("media:new");
  await evaluate("window.fireOld()");
  await loading();
  release("media:old");
  await loading();
  release("media:new");
  await ready();
  console.log("PASS G: old load/error cannot mark hydrated source ready");
  await mount("old-sign");
  await gate("sign:old-sign");
  await mount("next-route");
  await gate("media:next-route");
  release("sign:old-sign");
  await tick();
  await loading();
  assert.equal(gates.has("media:old-sign"), false);
  release("media:next-route");
  await ready();
  await mount("other-route", null);
  const switched = await loading();
  assert.equal(switched.src, undefined);
  assert.doesNotMatch(switched.text, /Snapshot next-route/);
  console.log("PASS H: place switch drops previous image and late signature");
  await evaluate("window.mountSafe('/direct.png')");
  await gate("media:direct");
  assert.equal((await state()).visual, "loading");
  release("media:direct");
  await until(async () => (await state()).visual === "ready", "direct image load");
  await evaluate("window.mountSafe('places/direct-change/photos/fixture')");
  assert.equal((await state()).visual, "loading");
  assert.equal((await state()).opacity, "0");
  await gate("media:direct-change");
  release("media:direct-change");
  await until(async () => (await state()).visual === "ready", "SafeImage source reset");
  console.log("PASS SafeImage: non-Google onLoad authority and source reset before paint");
  await mount("sign-fail");
  await until(async () => (await state()).mode === "fallback-visual", "sign failure");
  assert.equal((await state()).src, "/fallback.png");
  console.log("PASS C: signing failure fallback (existing retry policy)");
  await mount("media-fail");
  await gate("media:media-fail");
  await loading();
  release("media:media-fail");
  await until(async () => (await state()).mode === "fallback-visual", "media failure");
  assert.equal((await state()).src, "/fallback.png");
  console.log("PASS D: media failure fallback");
  // Route wiring is also checked: initial pending, existing completion, keyed route boundary.
  const route = fs.readFileSync("src/routes/_app.place.tsx", "utf8");
  assert.match(route, /useState<"pending" \| "settled">\("pending"\)/);
  assert.match(route, /const applyFetched[\s\S]*setPhotoResolution\("settled"\)/);
  assert.doesNotMatch(
    route.slice(route.indexOf("const finishLoading"), route.indexOf("const applyFetched")),
    /setPhotoResolution/,
  );
  assert.match(route, /photoResolution=\{photoResolution\}/);
  assert.match(
    route,
    /<PlaceDetailPageContent\s+key=\{JSON.stringify\(\[search.placeId, search.lat, search.lng, search.returnTo\]\)/,
  );
  console.log("Place Detail Hero / SafeImage browser regression: PASS");
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  server.closeAllConnections();
  stop();
}
