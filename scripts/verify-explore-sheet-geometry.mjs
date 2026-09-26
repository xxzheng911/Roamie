import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-review-browser-"));
const sourceRoot = process.env.REVIEW_SOURCE_ROOT || root;
const mocks = {
  "@/services/placeImageService": `export const getRoamieDefaultImage=()=>"/fixture-cover.png"`,
  "@/hooks/use-auth": `export const useAuth=()=>({user:{id:'fixture'}})`,
  "@/hooks/use-access": `export const useAccess=()=>({isPlusUser:false})`,
  "@/providers/SubscriptionProvider": `const loadOfferings=async()=>{};export const useSubscription=()=>({packages:[],offeringsLoading:false,offeringsState:'empty',loadOfferings,purchase:()=>{throw Error('unexpected purchase')},restore:()=>{throw Error('unexpected restore')}})`,
  "@/components/media/PlaceCoverImage": `export const PlaceCoverImage=()=>null`,
  "@/components/media/SafeImage": `export const SafeImage=()=>null`,
  "@/components/trip/TripAffiliateSection": `export const TripAffiliateSection=()=>null`,
  "@/hooks/use-i18n": `import {translate} from '${root}/src/lib/i18n/translate'; export const useI18n=()=>({locale:'zh-TW',t:(k)=>translate('zh-TW',k)});`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {MapExploreSheet} from '${sourceRoot}/src/components/MapExploreSheet';
import {MapExplorePlaceCards} from '${sourceRoot}/src/components/map/MapExplorePlaceCards';
import {RoamiePlusIntroDialog} from '${root}/src/components/RoamiePlusIntroDialog';
import {PlaceDetailSheet} from '${sourceRoot}/src/components/map/PlaceDetailSheet';
const root=createRoot(document.getElementById('root'));const ref=React.createRef();
window.sheet=ref;window.added=[];window.selected=[];const noop=()=>{};
const places=Array.from({length:4},(_,i)=>({id:'fixture-'+i,name:'推薦地點 '+i,primaryType:'cafe',types:['cafe'],rating:4.5,userRatingCount:100,openStatus:'unknown',reason:'',address:'測試地址',lat:null,lng:null,photoName:null}));
window.mountPaywall=()=>root.render(<RoamiePlusIntroDialog open={true} onOpenChange={noop}/>);
window.mount=mode=>{document.documentElement.className='native-shell platform-ios';root.render(<div className="map-page" style={{height:'100dvh',position:'relative'}}><div style={{position:'absolute',bottom:0,width:'100%'}}><MapExploreSheet key={mode} ref={ref} sheetMode={mode} header={<div style={{height:110}}>推薦地點與分類</div>}>
{mode==='list'?<MapExplorePlaceCards places={places} loading={false} highlightIndex={null} busyId={null} savedNames={new Set()} userLocation={null} formatDistance={()=>''} distanceMeters={()=>0} imageUrl={()=>null} categoryKey="all" onSelect={i=>window.selected.push(i)} onToggleSave={noop} onAddToTrip={p=>window.added.push(p.id)}/>:<PlaceDetailSheet place={places[0]} imageUrls={[]} distanceLabel={null} isSaved={false} isBusy={false} transportModes={[]} transportLoading={false} transportTip="" selectedTransportMode={null} onSelectTransportMode={noop} onNavigate={noop} onToggleSave={noop} onAddToTrip={noop} onOpenChat={noop}/>}
<div data-end-marker style={{height:44}}>END OF CONTENT</div></MapExploreSheet></div></div>)};
window.metrics=()=>{const sheet=document.querySelector('[data-map-explore-sheet]');const sc=sheet?.lastElementChild;const r=sc?.getBoundingClientRect();return {horizontal:document.querySelector('[data-sheet-cards-scroll]')?.scrollLeft,height:sheet?.getBoundingClientRect().height,scrollTop:sc?.scrollTop,scrollHeight:sc?.scrollHeight,clientHeight:sc?.clientHeight,overflow:sc&&getComputedStyle(sc).overflowY,x:r?.left+80,y:r&&Math.min(r.bottom-10,r.top+40),handleY:sheet?.getBoundingClientRect().top+12,end:document.querySelector('[data-end-marker]')?.getBoundingClientRect().bottom,bottom:r?.bottom}};`;
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
const css = process.env.EXPLORE_SHEET_CSS
  ? fs.readFileSync(process.env.EXPLORE_SHEET_CSS, "utf8")
  : fs
      .readdirSync(path.join(root, "dist/client/assets"))
      .filter((f) => /^styles-.*\.css$/.test(f))
      .map((f) => fs.readFileSync(path.join(root, "dist/client/assets", f), "utf8"))
      .join("\n");
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/app.js" ? "application/javascript" : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(dir, "app.js"))
      : '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
          css +
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
  const settle = () => new Promise((r) => setTimeout(r, 700));
  const states = [];
  const geometry = () =>
    evaluate(
      `(()=>{const sheet=document.querySelector('[data-map-explore-sheet]'),body=document.querySelector('[data-sheet-body-scroll]'),c=document.querySelector('[data-sheet-cards-scroll]');const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const style=e=>{const s=getComputedStyle(e);return Object.fromEntries(['width','minWidth','maxWidth','boxSizing','paddingLeft','paddingRight','gap','overflowX','overflowY','touchAction','scrollSnapType','scrollSnapAlign','transform','position','flexBasis'].map(k=>[k,s[k]]))};return {viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport.width},sheet:rect(sheet),body:{...rect(body),scrollLeft:body.scrollLeft,scrollTop:body.scrollTop,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,css:style(body)},carousel:{...rect(c),scrollLeft:c.scrollLeft,css:style(c)},cards:[...c.querySelectorAll('[data-place-card]')].map(e=>({...rect(e),css:style(e)}))}})()`,
    );
  async function aligned(label, expected) {
    await settle();
    const m = await geometry();
    const inset = parseFloat(m.carousel.css.paddingLeft);
    const index = m.cards.reduce(
      (best, c, i) =>
        Math.abs(c.left - m.carousel.left - inset) <
        Math.abs(m.cards[best].left - m.carousel.left - inset)
          ? i
          : best,
      0,
    );
    const card = m.cards[index];
    assert.ok(
      card.left >= m.body.left - 1 && card.right <= m.body.right + 1,
      `${label}: active card ${index} clipped: ${JSON.stringify(m)}`,
    );
    assert.equal(m.body.scrollLeft, 0, label + " no parent horizontal scroll");
    if (expected !== undefined) assert.equal(index, expected, label);
    states.push({ label, index, ...m });
    return { m, index };
  }
  async function drag(up) {
    const m = await geometry();
    const y = m.sheet.top + 12,
      x = m.sheet.width / 2;
    await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await call("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + (up ? -1 : 1) * i * 25 }],
      });
      await new Promise((r) => setTimeout(r, 25));
    }
    await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await settle();
    const after = await geometry();
    assert.ok(
      up ? after.sheet.height > m.sheet.height + 20 : after.sheet.height < m.sheet.height - 20,
      "handle " + (up ? "expand" : "collapse"),
    );
  }
  async function swipe() {
    const { m, index } = await aligned("before swipe");
    const y = Math.min(m.body.bottom - 15, Math.max(m.carousel.top + 40, m.body.top + 20));
    await call("Input.synthesizeScrollGesture", {
      x: m.body.right - 45,
      y,
      xDistance: -200,
      yDistance: 0,
      gestureSourceType: "touch",
      preventFling: true,
      speed: 400,
    });
    const after = await aligned("after swipe", index + 1);
    assert.equal(after.m.sheet.height, m.sheet.height, "horizontal gesture cannot resize sheet");
  }
  async function checkCta(index) {
    await evaluate(
      `(()=>{const b=document.querySelector('[data-sheet-body-scroll]'),c=document.querySelector('[data-place-index="${index}"]');b.scrollTop+=c.getBoundingClientRect().bottom-b.getBoundingClientRect().bottom+8})()`,
    );
    await settle();
    const point = await evaluate(
      `(()=>{const card=document.querySelector('[data-place-index="${index}"]'),b=card.querySelector('button:last-child');const buttons=[...card.querySelectorAll('button')];const c=buttons[buttons.length-1],r=c.getBoundingClientRect(),cr=card.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,inside:r.left>=cr.left&&r.right<=cr.right,hit:c.contains(document.elementFromPoint(x,y))}})()`,
    );
    assert.ok(point.inside && point.hit, "CTA visible/hittable");
    await call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: point.x, y: point.y }],
    });
    await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await settle();
    assert.equal(await evaluate("window.added.at(-1)"), `fixture-${index}`, "CTA action");
  }
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port });
  await until(async () => await evaluate('typeof window.mount==="function"'), "harness ready");
  for (const [width, height] of [
    [375, 812],
    [390, 844],
    [430, 932],
    [410, 1180],
  ]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate('window.mount("detail")');
    await tick();
    await evaluate('window.mount("list")');
    await aligned("initial " + width, 0);
    // Reproduce a settled middle-of-card position before a height transition.
    await evaluate('document.querySelector("[data-sheet-cards-scroll]").scrollLeft=120');
    await settle();
    await drag(true);
    await aligned("offset then expand " + width, 0);
    await checkCta(0);
    await drag(false);
    await aligned("collapse " + width, 0);
    await drag(true);
    await aligned("re-expand " + width, 0);
    await evaluate('document.querySelector("[data-sheet-body-scroll]").scrollTop=0');
    await swipe();
    await checkCta(1);
    await swipe();
    await checkCta(2);
    await drag(false);
    await aligned("swiped collapse " + width, 2);
    await drag(true);
    await aligned("swiped expand " + width, 2);
    for (let i = 0; i < 3; i++) {
      await drag(false);
      await aligned("repeat collapse " + width, 2);
      await drag(true);
      await aligned("repeat expand " + width, 2);
    }
    await drag(false);
    await evaluate('document.querySelector("[data-sheet-body-scroll]").scrollTop=0');
    await settle();
    const m = await geometry();
    await call("Input.synthesizeScrollGesture", {
      x: width / 2,
      y: m.body.bottom - 15,
      xDistance: 0,
      yDistance: -200,
      gestureSourceType: "touch",
      preventFling: true,
    });
    await settle();
    const v = await geometry();
    assert.ok(v.body.scrollTop > 20, "internal vertical touch scroll");
    assert.equal(v.sheet.height, m.sheet.height, "body gesture does not drag sheet");
    await aligned("vertical scroll " + width, 2);
    await evaluate('document.querySelector("[data-sheet-body-scroll]").scrollTop=0');
    await swipe();
    await drag(true);
    await aligned("collapsed swipe then expand " + width, 3);
    await checkCta(3);
    assert.deepEqual(await evaluate("window.selected"), [], "swipes/CTA must not select a place");
    console.log("PASS viewport", width, height);
  }
  // Width follows its actual parent, not the layout viewport; preserve the active card on resize.
  await evaluate('document.querySelector(".map-page").style.width="280px"');
  await aligned("narrow parent resize");
  fs.writeFileSync(
    process.env.EXPLORE_SHEET_TRACE || path.join(os.tmpdir(), "roamie-explore-sheet-geometry.json"),
    JSON.stringify(states, null, 2),
  );
  console.log("PASS Explore sheet geometry and gesture regression", states.length, "states");
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  server.closeAllConnections();
}
