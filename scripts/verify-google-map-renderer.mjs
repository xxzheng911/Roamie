import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build, stop } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-google-map-"));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {GoogleMap} from '${root}/src/components/GoogleMap';
window.events={maps:[],markers:[],clicks:[],ready:0};
class MockMap{constructor(el,options){this.options=options;this.el=el;el.dataset.googleMap='rendered';window.events.maps.push(this)}panTo(c){this.options.center=c}setCenter(c){this.options.center=c}setZoom(z){this.options.zoom=z}setOptions(o){Object.assign(this.options,o)}addListener(){return {remove(){}}}}
class Marker{constructor(options){this.options=options;this.listeners={};window.events.markers.push(this)}setMap(map){this.options.map=map}addListener(name,fn){this.listeners[name]=fn;return {remove(){}}}}
window.google={maps:{Map:MockMap,Marker,InfoWindow:class{},importLibrary:async()=>({Map:MockMap}),Animation:{BOUNCE:'bounce'},event:{trigger(){},removeListener(){},clearInstanceListeners(){}}}};
const app=createRoot(document.getElementById('root'));const click=i=>window.events.clicks.push(i);const ready=()=>window.events.ready++;
window.mount=(count=2)=>app.render(<GoogleMap center={{lat:35,lng:139}} zoom={14} placeMarkers={Array.from({length:count},(_,i)=>({lat:35+i,lng:139+i,title:'place-'+i,selected:i===0}))} onPlaceMarkerClick={click} onMapReady={ready}/>);
window.unmount=()=>app.unmount();
`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  logLevel: "error",
  outfile: path.join(dir, "app.js"),
  format: "iife",
  loader: { ".png": "dataurl", ".jpg": "dataurl" },
  define: {
    "import.meta.env": JSON.stringify({ VITE_GOOGLE_MAPS_API_KEY: "AIza" + "x".repeat(35) }),
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [
    {
      name: "i18n-only",
      setup(b) {
        b.onResolve({ filter: /^@\/hooks\/use-i18n$/ }, () => ({
          path: "i18n",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const useI18n=()=>({t:k=>k})",
          loader: "js",
        }));
      },
    },
  ],
});
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/app.js" ? "application/javascript" : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(dir, "app.js"))
      : '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
          "#root{width:800px;height:600px} .h-full{height:100%}" +
          '</style><div id="root"></div><script src="/app.js"></script>',
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
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await until(async () => await evaluate('typeof window.mount === "function"'), "fixture load");
  await evaluate("window.mount()");
  await until(async () => await evaluate("window.events.markers.length === 2"), "map markers");
  assert.deepEqual(
    await evaluate(
      '({ready:events.ready,maps:events.maps.length,rendered:document.querySelector("[data-google-map]")?.dataset.googleMap,markers:events.markers.map(m=>({title:m.options.title,position:m.options.position,selected:m.options.zIndex===500}))})',
    ),
    {
      ready: 1,
      maps: 1,
      rendered: "rendered",
      markers: [
        { title: "place-0", position: { lat: 35, lng: 139 }, selected: true },
        { title: "place-1", position: { lat: 36, lng: 140 }, selected: false },
      ],
    },
  );
  await evaluate("events.markers[1].listeners.click()");
  assert.deepEqual(await evaluate("events.clicks"), [1]);
  await evaluate("window.mount(1)");
  await until(async () => await evaluate("events.markers.length===3"), "marker update");
  assert.equal(await evaluate("events.markers.slice(0,2).every(m=>m.options.map===null)"), true);
  assert.equal(await evaluate("events.maps.length"), 1);
  assert.equal(
    await evaluate('[...document.scripts].filter(s=>s.src.includes("maps.googleapis.com")).length'),
    0,
  );
  console.log(
    "PASS actual GoogleMap + actual cached Maps JS loader: render, ready, marker positions, selection, click, replacement; controlled SDK, no live provider",
  );
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  server.closeAllConnections();
  stop();
}
