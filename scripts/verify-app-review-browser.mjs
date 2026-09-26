import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build, stop } from "esbuild";
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
const noop=()=>{};
const places=Array.from({length:4},(_,i)=>({id:'fixture-'+i,name:'推薦地點 '+i,primaryType:'cafe',types:['cafe'],rating:4.5,userRatingCount:100,openStatus:'unknown',reason:'',address:'測試地址',lat:null,lng:null,photoName:null}));
window.mountPaywall=()=>root.render(<RoamiePlusIntroDialog open={true} onOpenChange={noop}/>);
window.mount=mode=>{document.documentElement.className='native-shell platform-ios';root.render(<div className="map-page" style={{height:'100dvh',position:'relative'}}><div style={{position:'absolute',bottom:0,width:'100%'}}><MapExploreSheet key={mode} ref={ref} sheetMode={mode} header={<div style={{height:110}}>推薦地點與分類</div>}>
{mode==='list'?<MapExplorePlaceCards places={places} loading={false} highlightIndex={null} busyId={null} savedNames={new Set()} userLocation={null} formatDistance={()=>''} distanceMeters={()=>0} imageUrl={()=>null} categoryKey="all" onSelect={noop} onToggleSave={noop} onAddToTrip={noop}/>:<PlaceDetailSheet place={places[0]} imageUrls={[]} distanceLabel={null} isSaved={false} isBusy={false} transportModes={[]} transportLoading={false} transportTip="" selectedTransportMode={null} onSelectTransportMode={noop} onNavigate={noop} onToggleSave={noop} onAddToTrip={noop} onOpenChat={noop}/>}
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
const css = fs
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
  if (process.env.REVIEW_URL) {
    for (const url of [
      "/support",
      "/privacy",
      "/terms",
      "/login/legal?doc=privacy",
      "/login/legal?doc=terms",
    ]) {
      if (!process.env.REVIEW_OBSERVE_ONLY) {
        const response = await fetch(process.env.REVIEW_URL + url);
        assert.equal(response.status, 200, "production HTTP " + url);
        await response.text();
      }
      const loadBefore = pageLoads;
      await call("Page.navigate", { url: process.env.REVIEW_URL + url });
      await until(async () => pageLoads > loadBefore, "document load " + url);
      await until(
        async () =>
          await evaluate(
            '!!document.querySelector("h1") && (document.body.innerText.length>500 || /App Error|無法啟動|useI18n/.test(document.body.innerText))',
          ),
        "route did not render " + url,
      );
      await new Promise((r) => setTimeout(r, process.env.REVIEW_OBSERVE_ONLY ? 8000 : 800));
      const result = await evaluate(
        '({path:location.pathname,title:document.querySelector("h1")?.textContent,text:document.body.innerText.slice(0,900),links:[...document.querySelectorAll("a")].map(a=>a.getAttribute("href"))})',
      );
      console.log("PUBLIC_ROUTE", url, JSON.stringify(result));
      if (!process.env.REVIEW_OBSERVE_ONLY) {
        assert.ok(result.title, url + " title");
        assert.doesNotMatch(
          result.text,
          /useI18n|App Error|無法啟動|Something went wrong|Page not found/,
        );
        assert.ok(result.text.length > 150);
        const expectedPath = url.startsWith("/login/legal")
          ? url.includes("privacy")
            ? "/privacy"
            : "/terms"
          : url;
        assert.equal(result.path, expectedPath);
        const reloadBefore = pageLoads;
        await call("Page.reload");
        await until(async () => pageLoads > reloadBefore, "reload load event " + url);
        await until(
          async () =>
            await evaluate(
              `location.pathname===${JSON.stringify(expectedPath)} && document.body.innerText.length>500 && !!document.querySelector('h1')`,
            ),
          "public route reload " + url,
        );
        assert.doesNotMatch(
          await evaluate("document.body.innerText"),
          /useI18n|App Error|無法啟動|Page not found/,
        );
      }
    }
    if (!process.env.REVIEW_OBSERVE_ONLY) {
      await call("Page.addScriptToEvaluateOnNewDocument", {
        source:
          "localStorage.setItem('onboarding_completed','true');Object.defineProperty(navigator,'language',{get:()=>'zh-TW'})",
      });
      await evaluate("localStorage.setItem('onboarding_completed','true')");
      for (const label of ["服務條款", "隱私權政策"]) {
        await call("Page.navigate", { url: process.env.REVIEW_URL + "/login" });
        await until(
          async () =>
            await evaluate(
              `([...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)}))`,
            ),
          "login legal button " + label,
        );
        await evaluate(
          `([...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})).click()`,
        );
        await until(
          async () =>
            await evaluate(`document.querySelector('[role="dialog"]')?.textContent.length>500`),
          "login legal content " + label,
        );
        console.log("PASS anonymous Login legal button", label);
      }
    }
  } else {
    await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port });
    await until(async () => await evaluate('typeof window.mount==="function"'), "harness ready");
    for (const [width, height] of [
      [820, 1180],
      [1180, 820],
      [414, 736],
      [390, 844],
    ]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      });
      for (const mode of ["list", "detail"]) {
        await evaluate("window.mount(" + JSON.stringify(mode) + ")");
        await tick();
        await tick();
        await new Promise((r) => setTimeout(r, 600));
        const before = await evaluate("window.metrics()");
        if (mode === "list") {
          await call("Input.synthesizeScrollGesture", {
            x: Math.min(width - 60, 240),
            y: before.y,
            xDistance: -220,
            gestureSourceType: "touch",
            preventFling: true,
            speed: 400,
          });
          // Wait for scroll-snap to settle before starting the other-axis gesture.
          await new Promise((r) => setTimeout(r, 700));
          assert.ok(
            (await evaluate("window.metrics()")).horizontal > 0,
            "horizontal card swipe preserved",
          );
        }
        await call("Input.synthesizeScrollGesture", {
          x: before.x,
          y: before.y,
          yDistance: -450,
          gestureSourceType: "touch",
          speed: 400,
        });
        await tick();
        const after = await evaluate("window.metrics()");
        console.log("SHEET_SCROLL", JSON.stringify({ width, height, mode, before, after }));
        assert.equal(after.overflow, "auto");
        assert.ok(
          after.scrollHeight <= after.clientHeight || after.scrollTop > 0,
          "touch swipe must scroll " + width + mode,
        );
        await evaluate(
          'document.querySelector("[data-map-explore-sheet]").lastElementChild.scrollTop=10000',
        );
        const end = await evaluate("window.metrics()");
        assert.ok(
          end.end <= end.bottom + 1 && end.bottom <= height + 1,
          "last content reachable inside viewport",
        );
        if (mode === "list") {
          await call("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: width / 2, y: after.handleY }],
          });
          for (let step = 1; step <= 5; step++) {
            await call("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: width / 2, y: after.handleY - step * 45 }],
            });
            await tick();
          }
          await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await new Promise((r) => setTimeout(r, 600));
          const expanded = await evaluate("window.metrics()");
          assert.ok(expanded.height > after.height, "handle expands");
        }
      }
    }
    await evaluate("window.mountPaywall()");
    await tick();
    await tick();
    for (const [label, heading] of [
      ["隱私權政策", "【Roamie 隱私權政策】"],
      ["服務條款／EULA", "【Roamie 服務條款】"],
    ]) {
      await evaluate(
        `([...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})).click()`,
      );
      await until(
        async () =>
          await evaluate(
            `([...document.querySelectorAll('[role="dialog"]')].some(d=>d.textContent.includes(${JSON.stringify(heading)})))`,
          ),
        "subscription legal content",
      );
      await evaluate(
        `([...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='關閉')).click()`,
      );
      await tick();
      console.log("PASS subscription legal", label);
    }
    console.log(
      "PASS recommendation sheet: 4 viewports, collapsed/detail scrolling, content reachability, handle drag",
    );
  }
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  server.closeAllConnections();
  stop();
}
