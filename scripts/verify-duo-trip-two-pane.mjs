// verify-duo-trip-two-pane.mjs — iPhone Duo 完全展開＋行程詳情：地圖固定在右欄（任務單 #T2P-T）
//
// 背景：_app 在雙欄＋行程詳情時以 inline style 把內容外層設為 flex-direction: row，
//   但 html.trip-detail-route-active main.app-scroll > div { flex-direction: column !important } 會蓋掉 inline，
//   地圖被排到行程內容下方。修正：html.duo-rail.duo-two-pane.trip-detail-route-active main.app-scroll > div
//   { flex-direction: row !important }。
//
// Part A（靜態）：
//   A1 新規則存在、selector 以 html.duo-rail.duo-two-pane 開頭、位於 @layer 外、只設 flex-direction: row !important
//   A2 新規則位於「筆電半開」區塊之前；styles.css 最後一條規則仍屬 .place-duo-root 區塊
//   A3 既有 html.trip-detail-route-active main.app-scroll > div 規則（column !important）未被改動
//   A4 _app／TripDetailScreen 合約：row inline style 只在 duoPane && 行程詳情；duo-two-pane class 只在 duoPane；
//      TripDetailScreen rail 時 Fragment 順序＝scrollPane｜gutter｜地圖右欄
// Part B（headless Chrome＋實際編譯的 styles.css；DOM 為最小 fixture，class 字串取自 source）：
//   B0 對照：移除新規則時，雙欄 wrapper 為 column、地圖在行程下方（證明本檢查能抓到原 bug）
//   B1 雙欄（多組 viewport／safe-area；pane 以 resolveDuoLayout 計算）：wrapper computed flex-direction＝row；
//      scrollPane 寬＝leftWidth、右緣＝摺痕左緣；地圖右欄 [摺痕右緣, 直欄左緣]、與 scrollPane 頂端／底端對齊
//   B2 非雙欄（手機、Duo 合起、duo-laptop、雙欄其他路由、缺 duo-rail 的異常組合）：wrapper 為 column，
//      且所有量測與「移除新規則」的 CSS 逐項相同
//   B3 無外部請求、無瀏覽器例外
//
// 不讀 .env、不連網。執行：node scripts/verify-duo-trip-two-pane.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const styles = read("src/styles.css");
const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").join("\n     "));
  }
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
const braceDepth = (s) => {
  let d = 0;
  for (const ch of stripComments(s)) d += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  return d;
};

// ───────────────────────── Part A：靜態 ─────────────────────────
const NEW_SEL = "html.duo-rail.duo-two-pane.trip-detail-route-active main.app-scroll > div";
const OLD_SEL = "html.trip-detail-route-active main.app-scroll > div";
const stylesNc = stripComments(styles); // 保留長度，index 與原文一致
const allRules = [...stylesNc.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sels: m[1].split(",").map((s) => s.trim()),
  body: m[2],
  index: m.index + m[0].indexOf(m[1].trim()),
  end: m.index + m[0].length,
}));
const newRules = allRules.filter((r) => r.sels.includes(NEW_SEL));
let newRuleText = null;

check("A1 新規則存在、以 html.duo-rail.duo-two-pane 開頭、位於 @layer 外、只設 flex-direction: row !important", () => {
  assert.equal(newRules.length, 1, "新規則數量：" + newRules.length);
  const r = newRules[0];
  assert.deepEqual(r.sels, [NEW_SEL], "新規則不應與其他 selector 合併");
  assert.ok(NEW_SEL.startsWith("html.duo-rail.duo-two-pane"));
  assert.equal(braceDepth(styles.slice(0, r.index)), 0, "新規則位於某個區塊（@layer?）內");
  const decls = r.body.split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean);
  assert.deepEqual(decls, ["flex-direction: row !important"]);
  newRuleText = styles.slice(r.index, styles.indexOf("}", r.index) + 1);
  // 所有改成 row 的 main.app-scroll > div 規則都必須只在雙欄命中
  const rowRules = allRules.filter((x) => x.sels.some((s) => /main\.app-scroll\s*>\s*div$/.test(s)) && /flex-direction:\s*row/.test(x.body));
  for (const x of rowRules) for (const s of x.sels) assert.ok(s.startsWith("html.duo-rail.duo-two-pane"), "未限制在雙欄：" + s);
});

check("A2 新規則在「筆電半開」區塊之前；styles.css 最後一條規則仍屬 .place-duo-root 區塊", () => {
  const laptop = styles.indexOf(" * iPhone Duo 筆電半開（橫向摺痕）");
  assert.ok(laptop > 0, "找不到筆電區塊註解");
  assert.ok(newRules[0] && newRules[0].index < laptop, "新規則不在筆電區塊之前");
  const last = allRules[allRules.length - 1];
  assert.ok(last.sels[0].startsWith("html.duo-rail.duo-two-pane .place-duo-root"), "最後一條：" + last.sels[0]);
  assert.equal(stylesNc.slice(last.end).trim(), "", "最後一條規則之後還有內容");
});

check("A3 既有 trip-detail 規則（column !important）原樣保留", () => {
  const old = allRules.filter((r) => r.sels.includes(OLD_SEL));
  assert.equal(old.length, 1);
  const decls = old[0].body.split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean);
  assert.deepEqual(decls, [
    "flex: 1 1 auto !important",
    "min-height: 0 !important",
    "display: flex !important",
    "flex-direction: column !important",
    "overflow: hidden !important",
  ]);
  assert.ok(old[0].index < newRules[0].index, "新規則應在既有規則之後");
});

const appSrc = read("src/routes/_app.tsx");
const tripSrc = read("src/components/trip/TripDetailScreen.tsx");
const SCROLL_CLS = (tripSrc.match(/className="(trip-detail-route [^"]+)"/) || [])[1];
const MAP_CLS = (tripSrc.match(/ref=\{setMapPaneEl\}[\s\S]*?className="([^"]+)"/) || [])[1];
const MAIN_CLS =
  "app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)] pb-[var(--app-nav-total-height)] min-h-0 flex-1 overflow-hidden";
const RAIL_MIN = Number((read("src/components/BottomNav.tsx").match(/RIGHT_RAIL_MIN_WIDTH_PX = (\d+)/) || [])[1]);

check("A4 _app／TripDetailScreen 合約（row 只在 duoPane＋行程詳情；Fragment 順序 scrollPane｜gutter｜地圖）", () => {
  assert.ok(SCROLL_CLS && MAP_CLS, "抓不到 scrollPane／地圖右欄 className");
  assert.match(appSrc, /RIGHT_RAIL_TWO_PANE_TRIP_CONTENT_STYLE = \{\s*\.\.\.RIGHT_RAIL_CONTENT_STYLE,\s*flexDirection: "row",\s*paddingLeft: "var\(--safe-area-left\)",\s*\}/);
  assert.match(appSrc, /const contentStyle = !rightRail\s*\? undefined\s*: duoPane && isTripDetailPath\(pathname\)\s*\? RIGHT_RAIL_TWO_PANE_TRIP_CONTENT_STYLE\s*: RIGHT_RAIL_CONTENT_STYLE;/);
  assert.match(appSrc, /const foldLeftEdge = duoPane \?/);
  assert.match(appSrc, /if \(foldLeftEdge == null \|\| foldRightEdge == null\) return;[\s\S]{0,300}root\.classList\.add\("duo-two-pane"\)/);
  assert.match(appSrc, /"trip-detail-route-active",\s*isTripDetailPath\(pathname\)/);
  assert.match(appSrc, /<div className=\{appContentWrapperClass\(mainScrollLocked\)\} style=\{contentStyle\}>\s*<Outlet \/>/);
  assert.match(appSrc, /<main\s+className=\{cn\(\s*"app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-\[var\(--safe-area-top\)\]"/);
  assert.match(appSrc, /<AppErrorBoundary routeLabel="_app">\s*<div className=\{appContentWrapperClass/);
  assert.match(
    tripSrc,
    /return \(\s*<>\s*\{scrollPane\}\s*\{duoPane \? \(\s*<div aria-hidden className="shrink-0" style=\{\{ width: `\$\{duoPane\.gutter\}px` \}\} \/>\s*\) : null\}\s*\{duoPane \? \(\s*<div\s+ref=\{setMapPaneEl\}/,
  );
  assert.match(tripSrc, /duoPane\s*\? \{ flex: `0 0 \$\{duoPane\.leftWidth\}px`, width: `\$\{duoPane\.leftWidth\}px` \}/);
  assert.match(read("src/routes/_app.saved.$tripId.tsx"), /return \(\s*<TripDetailScreen/, "行程路由不得在 TripDetailScreen 外多包節點");
  assert.equal(RAIL_MIN, 56);
});

// ───────────────────────── Part B：瀏覽器 ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(
    os.homedir(),
    "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ),
].find((p) => p && fs.existsSync(p));

if (!chromeBin) {
  failures.push("B 無可用 Chrome");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器量測");
} else if (!SCROLL_CLS || !MAP_CLS || !newRuleText) {
  failures.push("B 前置條件不足（A 檢查失敗）");
  console.log("FAIL B 前置條件不足，未執行瀏覽器量測");
} else {
  await runBrowser();
}

async function loadTs(rel) {
  const { transform } = await import("esbuild");
  const { code } = await transform(read(rel), { loader: "ts", format: "esm" });
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

async function runBrowser() {
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const { resolveDuoLayout } = await loadTs("src/lib/layout/duo-layout.ts");
  const { appContentWrapperClass } = await loadTs("src/lib/app-scroll-contract.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-trip-"));
  const LOCKED = appContentWrapperClass(true);
  const UNLOCKED = appContentWrapperClass(false);
  fs.writeFileSync(path.join(dir, "fixture.html"), [MAIN_CLS, SCROLL_CLS, MAP_CLS, LOCKED, UNLOCKED, "shrink-0"].join(" "));

  const buildCss = async (src) => {
    const compiler = await compile(src.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    const scanner = new Scanner({ sources: [...compiler.sources, { base: dir, pattern: "**/*", negated: false }] });
    return compiler.build(scanner.scan());
  };
  const cssCur = await buildCss(styles);
  assert.ok(styles.includes(newRuleText));
  const cssBase = await buildCss(styles.replace(newRuleText, ""));
  assert.ok(cssCur.includes("duo-two-pane.trip-detail-route-active"), "編譯後 CSS 缺少新規則");
  assert.ok(!cssBase.includes("duo-two-pane.trip-detail-route-active"), "對照 CSS 未移除新規則");

  const PAGE_JS = `
window.CSS_SRC={cur:${JSON.stringify(cssCur)},base:${JSON.stringify(cssBase)}};
window.setup=(o)=>{
  document.getElementById('appcss').textContent=window.CSS_SRC[o.css];
  const h=document.documentElement;
  h.className=o.htmlClass;h.removeAttribute('style');
  h.style.setProperty('--safe-area-top','0px');h.style.setProperty('--safe-area-bottom','0px');
  h.style.setProperty('--safe-area-left',(o.safeLeft||0)+'px');h.style.setProperty('--safe-area-right',(o.safeRight||0)+'px');
  if(o.rail){h.style.setProperty('--bottom-nav-height','0.01px');h.style.setProperty('--app-rail-width','max(${RAIL_MIN}px, var(--safe-area-right))');}
  if(o.pane){h.style.setProperty('--duo-fold-left-edge',(o.pane.foldX-o.pane.gutter/2)+'px');h.style.setProperty('--duo-fold-right-edge',(o.pane.foldX+o.pane.gutter/2)+'px');}
  const frameInner=o.rail?'mobile-frame-inner relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background':'mobile-frame-inner relative flex h-[100dvh] w-full max-w-[440px] flex-col overflow-hidden bg-background';
  const kids=o.kids.map(k=>k==='scroll'
    ? '<div id="scroll" class=${JSON.stringify(SCROLL_CLS)}'+(o.pane?' style="flex:0 0 '+o.pane.leftWidth+'px;width:'+o.pane.leftWidth+'px"':'')+'><div style="height:2400px">trip</div></div>'
    : k==='gutter' ? '<div id="gutter" aria-hidden class="shrink-0" style="width:'+o.pane.gutter+'px"></div>'
    : k==='map' ? '<div id="mapPane" role="region" data-no-page-swipe class=${JSON.stringify(MAP_CLS)}><div style="height:320px;background:#9cf">map</div></div>'
    : '<div id="other" class="flex min-h-0 flex-1 flex-col"><div style="height:600px">page</div></div>').join('');
  document.getElementById('root').innerHTML='<div class="mobile-frame-outer flex min-h-[100dvh] w-full justify-center"><div class="'+frameInner+'"><div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">'
   +'<main id="main" class="'+o.mainClass+'"'+(o.rail?' style="padding-right:var(--app-rail-width, max(${RAIL_MIN}px, var(--safe-area-right)))"':'')+'>'
   +'<div id="wrap" class="'+o.wrapClass+'"'+(o.wrapStyle?' style="'+o.wrapStyle+'"':'')+'>'+kids+'</div></main></div></div></div>';
  if(o.locked){const m=document.getElementById('main');m.style.overflow='hidden';m.style.minHeight='0';}
  return true;
};
const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
window.measure=()=>{const q=s=>document.getElementById(s);const w=q('wrap');const cs=getComputedStyle(w);
  return {vw:innerWidth,vh:innerHeight,dir:cs.flexDirection,display:cs.display,wrap:R(w),main:R(q('main')),scroll:R(q('scroll')),gutter:R(q('gutter')),map:R(q('mapPane')),other:R(q('other')),
   scrollOverflowY:q('scroll')?getComputedStyle(q('scroll')).overflowY:null,mapOverflowY:q('mapPane')?getComputedStyle(q('mapPane')).overflowY:null};};
window.__ready=true;`;

  const externalRequests = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(PAGE_JS);
      return;
    }
    if (req.url !== "/" && req.url !== "/favicon.ico") externalRequests.push(req.url);
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style id="appcss"></style></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const browserErrors = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      chrome.stderr.on("data", (b) => {
        output += b;
        const m = output.match(/DevTools listening on (ws:\/\/\S+)/);
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
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    const viewport = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await viewport(951, 720);
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await evaluate("!!window.__ready"), "fixture 未載入");

    const run = async (o, css) => {
      await viewport(o.vw, o.vh);
      await evaluate("window.setup(" + JSON.stringify({ ...o, css }) + ")");
      return evaluate("window.measure()");
    };
    const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.6, `${msg}: ${a} vs ${b}`);
    const TWO_PANE_WRAP_STYLE = "--safe-area-right:0px;flex-direction:row;padding-left:var(--safe-area-left)";
    const RAIL_WRAP_STYLE = "--safe-area-right:0px";

    // ─── B0／B1 雙欄 ───
    const DUO = [
      { name: "951×720 safeL0 safeR72", vw: 951, vh: 720, safeLeft: 0, safeRight: 72 },
      { name: "900×700 safeL12 safeR44（直欄寬取 56）", vw: 900, vh: 700, safeLeft: 12, safeRight: 44 },
      { name: "1114×832 safeL0 safeR56", vw: 1114, vh: 832, safeLeft: 0, safeRight: 56 },
    ];
    for (const d of DUO) {
      const layout = resolveDuoLayout({ viewportWidth: d.vw, viewportHeight: d.vh, safeTop: 0, safeRight: d.safeRight, safeBottom: 0, safeLeft: d.safeLeft });
      const pane = layout.pane;
      const o = {
        ...d,
        rail: true,
        pane,
        locked: true,
        htmlClass: "native-shell trip-detail-route-active duo-rail duo-two-pane",
        mainClass: MAIN_CLS,
        wrapClass: LOCKED,
        wrapStyle: TWO_PANE_WRAP_STYLE,
        kids: ["scroll", "gutter", "map"],
      };
      const rail = Math.max(RAIL_MIN, d.safeRight);
      const foldL = pane ? pane.foldX - pane.gutter / 2 : NaN;
      const foldR = pane ? pane.foldX + pane.gutter / 2 : NaN;
      const base = await run(o, "base");
      const m = await run(o, "cur");
      check(`B0 對照（${d.name}）：移除新規則時 wrapper 為 column、地圖排在行程下方（重現原 bug）`, () => {
        assert.equal(layout.navPlacement, "right-rail");
        assert.equal(layout.tripLayout, "two-pane");
        assert.equal(base.dir, "column");
        assert.ok(base.map.t >= base.scroll.b - 0.6 || base.map.h < 1, `地圖未在下方 map.t=${base.map.t} scroll.b=${base.scroll.b}`);
      });
      check(`B1 雙欄（${d.name}）：flex-direction row；scrollPane [safeL, 摺痕左緣]；地圖 [摺痕右緣, 直欄左緣] 與 scrollPane 頂底對齊`, () => {
        assert.equal(m.dir, "row");
        assert.equal(m.display, "flex");
        near(m.scroll.l, d.safeLeft, "scroll left");
        near(m.scroll.w, pane.leftWidth, "scroll width");
        near(m.scroll.r, foldL, "scroll right = 摺痕左緣");
        near(m.gutter.l, foldL, "gutter left");
        near(m.gutter.w, pane.gutter, "gutter width");
        near(m.map.l, foldR, "map left = 摺痕右緣");
        near(m.map.r, d.vw - rail, "map right = 直欄左緣");
        near(m.map.t, m.scroll.t, "map top = scroll top");
        near(m.map.b, m.scroll.b, "map bottom = scroll bottom");
        near(m.scroll.t, 14, "scroll top = --duo-app-top");
        near(m.scroll.b, d.vh, "scroll bottom（直欄模式無底部導覽）");
        assert.ok(m.map.w > 300, "地圖寬度 " + m.map.w);
        assert.equal(m.scrollOverflowY, "auto");
        assert.equal(m.mapOverflowY, "auto");
      });
    }

    // ─── B2 非雙欄：規則不命中，量測與無新規則時完全相同 ───
    const NON = [
      { name: "一般手機（無 rail）", vw: 402, vh: 874, safeRight: 0, rail: false, htmlClass: "native-shell trip-detail-route-active", wrapClass: LOCKED, locked: true, kids: ["scroll"] },
      { name: "Duo 合起（rail、單欄）", vw: 540, vh: 720, safeRight: 72, rail: true, htmlClass: "native-shell trip-detail-route-active duo-rail", wrapClass: LOCKED, wrapStyle: RAIL_WRAP_STYLE, locked: true, kids: ["scroll"] },
      { name: "Duo 筆電半開（duo-laptop）", vw: 669, vh: 951, safeRight: 72, rail: true, htmlClass: "native-shell trip-detail-route-active duo-rail duo-laptop", wrapClass: LOCKED, wrapStyle: RAIL_WRAP_STYLE, locked: true, kids: ["scroll"] },
      { name: "雙欄＋收藏頁（非 locked）", vw: 951, vh: 720, safeRight: 72, rail: true, two: true, htmlClass: "native-shell duo-rail duo-two-pane", wrapClass: UNLOCKED, wrapStyle: RAIL_WRAP_STYLE, kids: ["other"] },
      { name: "雙欄＋我的頁（locked）", vw: 951, vh: 720, safeRight: 72, rail: true, two: true, htmlClass: "native-shell duo-rail duo-two-pane", wrapClass: LOCKED, wrapStyle: RAIL_WRAP_STYLE, locked: true, kids: ["other"] },
      { name: "雙欄＋地點詳情（place-route-active）", vw: 951, vh: 720, safeRight: 72, rail: true, two: true, htmlClass: "native-shell duo-rail duo-two-pane place-route-active", wrapClass: LOCKED, wrapStyle: RAIL_WRAP_STYLE, locked: true, kids: ["other"] },
      { name: "異常：duo-two-pane 但缺 duo-rail", vw: 951, vh: 720, safeRight: 72, rail: false, htmlClass: "native-shell trip-detail-route-active duo-two-pane", wrapClass: LOCKED, locked: true, kids: ["scroll"] },
      { name: "異常：duo-rail＋trip 但缺 duo-two-pane", vw: 951, vh: 720, safeRight: 72, rail: true, htmlClass: "native-shell trip-detail-route-active duo-rail", wrapClass: LOCKED, wrapStyle: RAIL_WRAP_STYLE, locked: true, kids: ["scroll"] },
    ];
    for (const n of NON) {
      const o = { ...n, mainClass: MAIN_CLS };
      if (n.two) o.pane = resolveDuoLayout({ viewportWidth: n.vw, viewportHeight: n.vh, safeRight: n.safeRight }).pane;
      const base = await run(o, "base");
      const m = await run(o, "cur");
      check(`B2 非雙欄（${n.name}）：wrapper 為 column、量測與移除新規則時逐項相同`, () => {
        assert.equal(m.dir, "column");
        assert.deepEqual(m, base);
      });
    }

    check("B3 無外部請求、無瀏覽器例外", () => {
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
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

console.log(failures.length ? `\nverify-duo-trip-two-pane: FAIL (${failures.length})\n- ` + failures.join("\n- ") : "\nverify-duo-trip-two-pane: PASS");
process.exit(failures.length ? 1 : 0);
