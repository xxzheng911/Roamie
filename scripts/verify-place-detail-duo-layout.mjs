// verify-place-detail-duo-layout.mjs — 地點詳情頁（/place）iPhone Duo 雙頁排版審查（D3-2 tester）
//
// Part A（靜態）：
//   A1 styles.css 的地點詳情 Duo 區塊每個 selector 都以 html.duo-rail.duo-two-pane 開頭，且位於 @layer 外。
//   A2 styles.css diff 中與 place-duo／place-split 相關的行只有新增、沒有刪改。
//   A3 PlaceDetailSheet diff（忽略空白）只新增 SplitGroup／routeSplitLayout，其他行未改動；
//      SplitGroup 停用時只輸出 children（Fragment）。
//   A4 探索頁（_app.map.tsx）沒有傳 routeSplitLayout，_app.map.tsx 本身未改動。
//   （#TS-BASE：本檔所有「HEAD」「diff」均指相對功能 commit 前基準 aa2db59＝PRE_FEATURE_BASE）
//   A5 _app.place.tsx：單欄時 className 字串與 HEAD 完全相同；fetchError 判斷抽取後與原條件相同；
//      雙頁開合只改 className（同一 JSX 樹）。
// Part B（真實瀏覽器，真實 PlaceDetailSheet + 以目前 styles.css 編譯的 Tailwind CSS）：
//   B1 一般模式：HEAD 版 PlaceDetailSheet 與目前版（routeSplitLayout=true）所有區塊座標完全相同。
//   B2 開合不 remount：切換 place-duo-root className 前後 DOM 節點相同。
//   B3 雙頁：左右欄不跨摺痕、Hero ≤ 200、左右欄各自緊密排列（不互相撐出空白）、長內容可捲動。
//   B4 載入中／找不到（place-duo-single）不跨摺痕。
//
// 不讀 .env、不呼叫 Google／OpenAI；瀏覽器只連 127.0.0.1 fixture server（Hero 用 pending 骨架，不載圖）。
// 執行：node scripts/verify-place-detail-duo-layout.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
// #TS-BASE：功能 commit（943a047…）之前的基準 commit。功能已 commit 進 HEAD 後，「工作區 diff」為空、「HEAD 版＝改動前」不成立，
//   A2–A5 與 B1 的「改動前（下文沿用 HEAD 稱呼）」一律以此基準為準（日後基準前移時只改這一行）。
const PRE_FEATURE_BASE = "aa2db59";
// 工作區相對基準的 diff；為空表示功能不存在，各斷言另以「必須有預期的新增」防止空洞通過
const diffVsBase = (...args) => git("diff", ...args.slice(0, -1), PRE_FEATURE_BASE, "--", args[args.length - 1]);
const showBase = (p) => git("show", PRE_FEATURE_BASE + ":" + p);
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  "));
  }
};

// ───────────────────────── Part A：靜態 ─────────────────────────
const styles = read("src/styles.css");
const blockStart = styles.indexOf("地點詳情頁雙頁");
const placeBlock = styles.slice(styles.lastIndexOf("/*", blockStart));

check("A1 地點詳情 Duo CSS 全部以 html.duo-rail.duo-two-pane 為前綴、位於 @layer 外", () => {
  assert.ok(blockStart > 0, "找不到地點詳情頁雙頁 CSS 區塊");
  const noComments = placeBlock.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...noComments.matchAll(/([^{}]+)\{/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim()),
  );
  assert.ok(selectors.length >= 10, "selector 數量異常：" + selectors.length);
  for (const s of selectors) {
    assert.ok(s.startsWith("html.duo-rail.duo-two-pane "), "未加前綴：" + s);
  }
  // 區塊之前的 @layer 都已關閉（以括號深度判斷）
  const before = styles.slice(0, styles.lastIndexOf("/*", blockStart)).replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const ch of before) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  assert.equal(depth, 0, "地點詳情 Duo CSS 位於某個區塊（@layer?）內");
});

check("A6 anchor positioning 只在 duo-two-pane 的 .place-duo-root 規則內使用；selector 都限定在 route 根節點（不影響 portal）", () => {
  const all = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...all.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const anchorRules = rules.filter((r) => /anchor-name|position-anchor|anchor\(|anchor-size\(/.test(r[2]));
  assert.ok(anchorRules.length >= 2, "找不到 anchor 規則");
  for (const r of anchorRules) {
    for (const s of r[1].split(",").map((x) => x.trim())) {
      assert.ok(s.startsWith("html.duo-rail.duo-two-pane .place-duo-root "), "anchor 用在雙頁以外：" + s);
    }
  }
  const noComments = placeBlock.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/([^{}]+)\{/g)) {
    for (const s of m[1].split(",").map((x) => x.trim())) {
      assert.match(s, /^html\.duo-rail\.duo-two-pane \.place-duo-(root|single)\b/, "selector 未限定根節點：" + s);
    }
  }
});

check("A2 styles.css 中 place-duo／place-split 相關行只有新增", () => {
  const diff = diffVsBase("-U0", "src/styles.css");
  const lines = diff.split("\n");
  const removed = lines
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .filter((l) => /place-|data-place-detail-hero/.test(l));
  assert.deepEqual(removed, [], "有刪除／修改既有 place 規則");
  // #TS-BASE：diff 必須確實含有新增的 place-duo 行（避免基準＝目前時空洞通過）
  assert.ok(lines.some((l) => l.startsWith("+") && !l.startsWith("+++") && /place-duo/.test(l)), `相對 ${PRE_FEATURE_BASE} 沒有新增任何 place-duo 行`);
  const head = showBase("src/styles.css");
  assert.ok(!/place-duo|place-split/.test(head), `${PRE_FEATURE_BASE} 已有 place-duo 規則？`);
});

check("A3 PlaceDetailSheet 只新增 SplitGroup 包裹層，其他內容（忽略縮排）不變", () => {
  // #TS-BASE：工作區 vs PRE_FEATURE_BASE（下方 removed 必須恰為 import 一行、SplitGroup 開閉各 4 個，diff 為空會失敗）
  const diff = diffVsBase("-w", "-U0", "src/components/map/PlaceDetailSheet.tsx");
  const lines = diff
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const removed = lines.filter((l) => l.startsWith("-"));
  assert.deepEqual(removed, ['-import { useRef, useState } from "react";'], "非預期的刪除行");
  const added = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim());
  const allowed = [
    /^import \{ useRef, useState, type ReactNode \} from "react";$/,
    /^\/\*\*|^\*|^\*\/$/,
    /^routeSplitLayout\?: boolean;$/,
    /^routeSplitLayout = false,$/,
    /^function SplitGroup\(\{$/,
    /^(enabled|className|children)(: (boolean|string|ReactNode))?[,;]$/,
    /^\}: \{$/,
    /^\}\) \{$/,
    /^if \(!enabled\) return <>\{children\}<\/>;$/,
    /^return <div className=\{cn\("contents", className\)\}>\{children\}<\/div>;$/,
    /^\}$/,
    /^$/,
    /^<SplitGroup enabled=\{routeSplitLayout\} className="place-split-(left-top|right|left-bottom|right-bottom)">$/,
    /^<\/SplitGroup>$/,
  ];
  for (const a of added) {
    assert.ok(
      allowed.some((re) => re.test(a)),
      "非預期的新增行：" + a,
    );
  }
  const opens = added.filter((a) => a.startsWith("<SplitGroup")).length;
  const closes = added.filter((a) => a === "</SplitGroup>").length;
  assert.equal(opens, 4);
  assert.equal(closes, 4);
});

// #H3-1-T：_app.map.tsx 已授權新增「筆電／直向攤平地點詳情一頁式」（只切換 <html> 的 duo-map-detail-page，JSX 不變）。
//   放寬為：移除該段（兩行 import＋一個 useLayoutEffect 區塊）後與 HEAD 逐字相同；PlaceDetailSheet 的用法（不傳 routeSplitLayout）不變。
check("A4 探索頁未傳 routeSplitLayout，_app.map.tsx 除 #H3-1 詳情一頁式段落與 #L1 生成鎖兩行外未改動", () => {
  const map = read("src/routes/_app.map.tsx");
  assert.ok(!/routeSplitLayout|place-duo|place-split/.test(map));
  let rest = map.replace('import { useDuoFlatPortrait, useDuoLaptop } from "@/hooks/use-duo-laptop";\nimport { useDuoLayout } from "@/hooks/use-duo-layout";\n', "");
  const a = rest.indexOf("  // iPhone Duo 筆電／直向攤平（雙欄除外");
  const endMark = "  }, [duoMapDetailPage]);\n\n";
  const b = rest.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, "找不到 #H3-1 詳情一頁式段落");
  rest = rest.slice(0, a) + rest.slice(b + endMark.length);
  // #L1-T2：#L1 行程生成全域鎖授權新增兩段（import 一行、openInChat 開頭一行），各恰好一次
  const L1_IMPORT = 'import { blockIfChatGenerationLocked } from "@/lib/ai/chat-generation-lock";\n';
  const L1_GUARD = '    if (blockIfChatGenerationLocked(tt("uiCoverage.chatGenerationLockedNotice"))) return;\n';
  assert.equal(rest.split(L1_IMPORT).length, 2, "#L1 import 應恰好一次");
  assert.equal(rest.split("  const openInChat = (p: MapPlaceCard) => {\n" + L1_GUARD).length, 2, "#L1 守門行應恰好一次且位於 openInChat 開頭");
  rest = rest.replace(L1_IMPORT, "").replace(L1_GUARD, "");
  assert.equal(rest, showBase("src/routes/_app.map.tsx"), `_app.map.tsx 有 #H3-1／#L1 段落以外的變更（對 ${PRE_FEATURE_BASE}）`);
  const others = execFileSync("git", ["grep", "-l", "routeSplitLayout", "--", "src"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .sort();
  // git grep 只看 tracked 檔案的工作區內容
  assert.deepEqual(others, ["src/components/map/PlaceDetailSheet.tsx", "src/routes/_app.place.tsx"]);
});

check("A5 _app.place.tsx 單欄 className 與 HEAD 相同、fetchError 條件等價、開合同一 JSX 樹", () => {
  const cur = read("src/routes/_app.place.tsx");
  const head = showBase("src/routes/_app.place.tsx");
  const headClasses = [...head.matchAll(/className="(place-detail-route[^"]*|flex flex-1 flex-col items-center justify-center gap-4 px-8 py-20 text-center)"/g)].map(
    (m) => m[1],
  );
  const curClasses = [...cur.matchAll(/className=\{`([^`]*)\$\{duo(?:Single|Root)Class\}`\}/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(curClasses, headClasses, "單欄 className 不同");
  assert.match(cur, /const duoSingleClass = duoTwoPane \? " place-duo-single" : "";/);
  assert.match(
    cur,
    /const duoRootClass = !duoTwoPane \? "" : fetchErrorOnly \? duoSingleClass : " place-duo-root";/,
  );
  assert.match(
    cur,
    /const fetchErrorOnly = Boolean\(fetchError && usedFallback && !place\.address && place\.lat == null\);/,
  );
  assert.match(head, /\{fetchError && usedFallback && !place\.address && place\.lat == null \? \(/);
  assert.match(cur, /\{fetchErrorOnly \? \(/);
  // duoTwoPane 只出現在 className 計算，不參與任何條件渲染／key
  const uses = [...cur.replace(/\/\/[^\n]*/g, "").matchAll(/duoTwoPane/g)].length;
  assert.equal(uses, 3, "duoTwoPane 用途數非預期（宣告＋2 次 className）");
  assert.ok(!/key=\{[^}]*duo/i.test(cur), "duo 狀態被用在 key");
  // routeSplitLayout 為常數 true
  assert.match(cur, /ticketOffers=\{placeTicketOffers\}\s+routeSplitLayout\s+\/>/);
  // 除了 duo 相關，route diff 沒有其他行為改變
  const diff = diffVsBase("-w", "-U0", "src/routes/_app.place.tsx")
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const removed = diff.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim());
  // #TS-BASE：相對基準必須確實改寫了 fetchError 條件（否則表示比對對象錯誤、下方 for 迴圈會空洞通過）
  assert.ok(removed.includes("{fetchError && usedFallback && !place.address && place.lat == null ? ("), `相對 ${PRE_FEATURE_BASE} 找不到 fetchError 條件的改寫`);
  for (const r of removed) {
    assert.ok(
      /^<div className="(place-detail-route|flex flex-1 flex-col items-center)/.test(r) ||
        r === "{fetchError && usedFallback && !place.address && place.lat == null ? (",
      "非預期刪除：" + r,
    );
  }
});

// ───────────────────────── Part B：真實瀏覽器 ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(
    os.homedir(),
    "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ),
].find((p) => p && fs.existsSync(p));

if (!chromeBin) {
  failures.push("B 無可用 Chrome（未執行瀏覽器量測）");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器量測");
} else {
  await runBrowser();
}

async function runBrowser() {
  const { build, stop } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-place-duo-"));

  // 以目前 styles.css 編譯 Tailwind（移除外部字型 @import，避免連 Google Fonts）
  const cssSrc = styles.replace(/^@import url\([^\n]*\n/m, "");
  const compiler = await compile(cssSrc, { base: path.join(root, "src"), onDependency() {} });
  const scanner = new Scanner({ sources: compiler.sources });
  const css = compiler.build(scanner.scan());
  assert.match(css, /\.contents\s*\{\s*display:\s*contents/, "Tailwind 未產生 .contents");

  // #TS-BASE：改動前版本取自 PRE_FEATURE_BASE（功能 commit 後 HEAD 版＝目前版，B1 會空洞通過）
  const headSheet = showBase("src/components/map/PlaceDetailSheet.tsx");
  assert.notEqual(headSheet, read("src/components/map/PlaceDetailSheet.tsx"), `${PRE_FEATURE_BASE} 版 PlaceDetailSheet 與目前相同`);
  const mocks = {
    "@/integrations/supabase/client": `export const isSupabaseConfigured=false;export const supabase={auth:{getSession:async()=>({data:{session:null}})}}`,
    "@/lib/api-url": `export const resolveApiUrl=p=>location.origin+p`,
    "@/services/placeImageService": `export const getRoamieDefaultImage=()=>"/fallback.png"`,
    "@/hooks/use-i18n": `export const useI18n=()=>({locale:'en',t:k=>k})`,
    "@/components/PlaceRecommendationReason": `export const PlaceRecommendationReason=()=>"Because it is a well rated quiet spot with good views and easy access from the station.".repeat(window.__reasonRepeat||1)`,
    "@/components/trip/TripAffiliateSection": `export const TripAffiliateSection=({className})=><div className={className} data-fixture-ticket="" style={{height:window.__ticketH||140}}><button type="button" data-fixture-ticket-cta="">ticket</button></div>`,
    "@/components/TabelogExternalLink": `export const TabelogExternalLink=()=>null`,
    "@/lib/maps-navigation": `export const openExternal=()=>{};export const buildPlaceMapsUrl=()=>"";export const buildDirectionsUrl=()=>"";export const buildDirectionsUrlFromQuery=()=>""`,
    "fixture:head-sheet": headSheet,
  };
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {PlaceDetailSheet as CurSheet, ExploreSubpageHeader} from '${root}/src/components/map/PlaceDetailSheet';
import {PlaceDetailSheet as HeadSheet} from 'fixture:head-sheet';
const noop=()=>{};
const MODES=['walk','drive','transit','taxi','motorcycle'].map((id,i)=>({id,label:id,minutes:5+i*7,distanceMeters:1000,distanceLabel:'1.2 km',costLabel:i%2?'NT$120':undefined,hint:'Hint text for '+id+' that may wrap onto a second line in narrow columns.',recommended:i===1,available:true}));
function Page({version,split,duoClass,modes,loading,tickets,fallback,selected,width}){
  const Sheet=version==='head'?HeadSheet:CurSheet;
  const extra=version==='head'?{}:{routeSplitLayout:split};
  return <div id="wrap" style={{display:'flex',flexDirection:'column',height:'700px',width:(width||879)+'px',overflow:'hidden'}}>
    <div id="route" className={'place-detail-route flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain'+duoClass}>
      <ExploreSubpageHeader title="Place detail" onBack={noop}/>
      {fallback?<p className="mx-5 mb-1 rounded-2xl bg-secondary/80 px-3 py-2 text-xs text-muted-foreground">Fallback info shown</p>:null}
      <Sheet place={{id:'p1',name:'Fixture Place',placeName:'Fixture Place',localizedDisplayName:'Fixture Place',rating:4.4,address:'1-2-3 Fixture Street, Fixture Ward, Fixture City 100-0001',reason:'',openStatus:'unknown',phone:'+81 3 1234 5678',website:'https://example.invalid'}}
        imageUrls={[]} photoResolution="pending" distanceLabel="850 m" isSaved={false} isBusy={false}
        transportModes={MODES.slice(0,modes)} transportLoading={loading} transportTip="" selectedTransportMode={selected}
        onSelectTransportMode={noop} onNavigate={noop} onToggleSave={noop} onAddToTrip={noop} onOpenChat={noop}
        googleMapsExternalUrl="https://maps.invalid" ticketOffers={tickets?[{id:'t'}]:undefined} {...extra}/>
    </div></div>;
}
const rootEl=createRoot(document.getElementById('root'));
window.mount=o=>flushSync(()=>rootEl.render(<Page {...o}/>));
window.setHtml=on=>{const h=document.documentElement;h.classList.toggle('duo-rail',on);h.classList.toggle('duo-two-pane',on);
 h.style.setProperty('--safe-area-left','0px');h.style.setProperty('--duo-fold-left-edge','463.5px');h.style.setProperty('--duo-fold-right-edge','487.5px');};
const byText=(sel,txt)=>[...document.querySelectorAll(sel)].find(e=>e.textContent.includes(txt));
window.measure=()=>{const route=document.getElementById('route');const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top+route.scrollTop,b:b.bottom+route.scrollTop,h:b.height,w:b.width};};
 const nav=byText('button','uiCoverage.navigate');
 const transportLabel=byText('p','uiCoverage.transport');
 const transportBlock=transportLabel&&transportLabel.parentElement;
 const ticket=document.querySelector('[data-fixture-ticket]');
 return {
  header:r(route.firstElementChild), fallback:r(route.querySelector(':scope > p')),
  hero:r(document.querySelector('[data-place-detail-hero]')),
  title:r(document.querySelector('h2').parentElement), type:r(document.querySelector('h2').parentElement.nextElementSibling),
  open:r(document.querySelector('h2').parentElement.nextElementSibling.nextElementSibling),
  address:r(byText('p','Fixture Street')), links:r(document.querySelector('a[href^="tel:"]').parentElement),
  reason:r(byText('p','uiCoverage.reason').parentElement), transport:r(transportBlock), ticket:r(ticket),
  actions:r(nav.previousElementSibling), nav:r(nav), chat:r(byText('button','uiCoverage.chatPlace')),
  route:{...r(route),scrollHeight:route.scrollHeight,clientHeight:route.clientHeight},
 };};
window.nodes=()=>{window.__nodes=[...document.querySelectorAll('#route *')];return window.__nodes.length;};
window.sameNodes=()=>{const now=[...document.querySelectorAll('#route *')];return now.length===window.__nodes.length&&now.every((n,i)=>n===window.__nodes[i]);};
window.setFold=(l,r)=>{const h=document.documentElement;h.style.setProperty('--duo-fold-left-edge',l+'px');h.style.setProperty('--duo-fold-right-edge',r+'px');};
window.scrollEnd=()=>{const route=document.getElementById('route');route.scrollTop=route.scrollHeight;const rb=route.getBoundingClientRect();
 const chat=byText('button','uiCoverage.chatPlace').getBoundingClientRect();const nav=byText('button','uiCoverage.navigate').getBoundingClientRect();
 return {maxScroll:route.scrollHeight-route.clientHeight,scrollTop:route.scrollTop,viewBottom:rb.bottom,chatBottom:chat.bottom,navBottom:nav.bottom,chatSpace:rb.bottom-chat.bottom,navSpace:rb.bottom-nav.bottom};};
window.hitTest=()=>{const route=document.getElementById('route');const targets=[...route.querySelectorAll('button,a[href]')];const bad=[];
 for(const el of targets){el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();const x=b.left+b.width/2,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);
  if(!hit||!el.contains(hit))bad.push({el:(el.getAttribute('aria-label')||el.textContent).trim().slice(0,40),hit:hit?(hit.tagName+'.'+String(hit.className).slice(0,60)):null});}
 route.scrollTop=0;return {count:targets.length,bad};};
window.focusOrder=()=>[...document.getElementById('route').querySelectorAll('button,a[href]')].map(e=>{const b=e.getBoundingClientRect();return {t:(e.getAttribute('aria-label')||e.textContent).trim().slice(0,24),side:b.left>=470?'R':'L'};});
window.emulateNoAnchor=(on)=>{let s=document.getElementById('noanchor');if(on&&!s){s=document.createElement('style');s.id='noanchor';
 s.textContent='html.duo-rail.duo-two-pane .place-duo-root .place-split-right-bottom{position-anchor:auto!important;top:auto!important;left:auto!important;width:auto!important}';document.head.appendChild(s);}if(!on&&s)s.remove();};
window.ua=()=>navigator.userAgent+' anchor='+CSS.supports('top','anchor(bottom)');
window.single=(cls)=>{flushSync(()=>rootEl.render(<div style={{display:'flex',flexDirection:'column',height:'700px',width:'879px'}}><div id="single" className={'flex flex-1 flex-col items-center justify-center gap-4 px-8 py-20 text-center'+cls}><p>not found</p></div></div>));const b=document.getElementById('single').getBoundingClientRect();return {l:b.left,r:b.right};};`;

  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "app.js"),
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl" },
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
            resolveDir: a.path === "fixture:head-sheet" ? path.join(root, "src/components/map") : root,
          }));
        },
      },
    ],
  });

  const externalRequests = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, "app.js")));
      return;
    }
    if (req.url !== "/" && req.url !== "/favicon.ico") externalRequests.push(req.url);
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><style>' +
        css +
        '</style></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const chrome = spawn(
    chromeBin,
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
      if (r.method === "Runtime.exceptionThrown")
        console.error("BROWSER_EXCEPTION", r.params.exceptionDetails.exception?.description);
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
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: targetInfos.find((t) => t.type === "page").targetId,
      flatten: true,
    });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 951,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.mount").catch(() => false)); i++)
      await new Promise((r) => setTimeout(r, 100));
    const mount = (o) => evaluate("window.mount(" + JSON.stringify(o) + ")");
    const measure = () => evaluate("window.measure()");

    const scenarios = {
      short: { modes: 0, loading: true, tickets: false, fallback: false, selected: null },
      unavailable: { modes: 0, loading: false, tickets: false, fallback: false, selected: null },
      typical: { modes: 3, loading: false, tickets: false, fallback: false, selected: "drive" },
      typicalWithTicket: { modes: 3, loading: false, tickets: true, fallback: false, selected: "drive" },
      long: { modes: 5, loading: false, tickets: true, fallback: true, selected: "transit" },
    };

    // B1 一般模式：HEAD vs 目前（routeSplitLayout=true）座標相同；Duo html class 存在但 root 無 place-duo-root 時亦同
    for (const [name, s] of Object.entries(scenarios)) {
      for (const htmlDuo of [false, true]) {
        await evaluate("window.setHtml(" + htmlDuo + ")");
        await mount({ ...s, version: "head", split: false, duoClass: "" });
        const a = await measure();
        await mount({ ...s, version: "cur", split: true, duoClass: "" });
        const b = await measure();
        await mount({ ...s, version: "cur", split: false, duoClass: "" });
        const c = await measure();
        check(`B1 一般模式座標與 HEAD 相同（${name}, html duo class=${htmlDuo}）`, () => {
          assert.deepEqual(b, a, "/place（routeSplitLayout）與 HEAD 不同");
          assert.deepEqual(c, a, "探索頁用法（無 routeSplitLayout）與 HEAD 不同");
        });
      }
    }

    // B2 開合不 remount
    await evaluate("window.setHtml(false)");
    await mount({ ...scenarios.typical, version: "cur", split: true, duoClass: "" });
    await evaluate("window.nodes()");
    await evaluate("window.setHtml(true)");
    await mount({ ...scenarios.typical, version: "cur", split: true, duoClass: " place-duo-root" });
    const sameAfterOpen = await evaluate("window.sameNodes()");
    await evaluate("window.setHtml(false)");
    await mount({ ...scenarios.typical, version: "cur", split: true, duoClass: "" });
    const sameAfterClose = await evaluate("window.sameNodes()");
    check("B2 單欄↔雙頁切換 DOM 節點完全沿用（不 remount）", () => {
      assert.equal(sameAfterOpen, true, "展開後節點被重建");
      assert.equal(sameAfterClose, true, "合起後節點被重建");
    });

    // B3 雙頁量測
    await evaluate("window.setHtml(true)");
    const FOLD_L = 463.5;
    const FOLD_R = 487.5;
    const W = 879;
    const report = {};
    for (const [name, s] of Object.entries(scenarios)) {
      await mount({ ...s, version: "cur", split: true, duoClass: " place-duo-root" });
      const m = await measure();
      const leftKeys = ["header", "fallback", "hero", "title", "type", "open", "address", "links", "actions", "nav"].filter(
        (k) => m[k],
      );
      const rightKeys = ["reason", "transport", "ticket", "chat"].filter((k) => m[k]);
      const lastRight = m.ticket ?? m.transport;
      report[name] = {
        heroH: m.hero.h,
        leftBottom: m.nav.b,
        rightContentBottom: lastRight.b,
        chatTop: m.chat.t,
        gapAboveChat: +(m.chat.t - lastRight.b).toFixed(1),
        gapLinksToActions: +(m.actions.t - m.links.b).toFixed(1),
        scroll: [m.route.scrollHeight, m.route.clientHeight],
      };
      check(`B3 雙頁左右欄不跨摺痕（${name}）`, () => {
        for (const k of leftKeys) {
          assert.ok(m[k].l >= -0.5 && m[k].r <= FOLD_L + 0.5, `${k} 不在左頁：${JSON.stringify(m[k])}`);
        }
        for (const k of rightKeys) {
          assert.ok(m[k].l >= FOLD_R - 0.5 && m[k].r <= W + 0.5, `${k} 不在右頁：${JSON.stringify(m[k])}`);
        }
      });
      check(`B3 Hero 高度 ≤ 200（${name}）`, () => assert.ok(m.hero.h > 0 && m.hero.h <= 200, "hero " + m.hero.h));
      check(`B3 左欄依序緊密排列、不重疊、不被右欄撐開（${name}）`, () => {
        for (let i = 1; i < leftKeys.length; i++) {
          const gap = m[leftKeys[i]].t - m[leftKeys[i - 1]].b;
          assert.ok(gap >= -0.5 && gap <= 24, `${leftKeys[i - 1]}→${leftKeys[i]} 間距 ${gap}`);
        }
      });
      check(`B3 右欄頂端對齊標頭、依序緊密（${name}）`, () => {
        assert.ok(Math.abs(m.reason.t - m.header.t) <= 1, `reason.t=${m.reason.t} header.t=${m.header.t}`);
        const seq = ["reason", "transport", "ticket"].filter((k) => m[k]);
        for (let i = 1; i < seq.length; i++) {
          const gap = m[seq[i]].t - m[seq[i - 1]].b;
          assert.ok(gap >= -0.5 && gap <= 24, `${seq[i - 1]}→${seq[i]} 間距 ${gap}`);
        }
      });
      check(`B3 「聊這個地點」緊接右欄內容、不被左欄撐出大片空白（${name}）`, () => {
        const gap = m.chat.t - lastRight.b;
        assert.ok(gap >= -0.5, "聊這個地點與右欄內容重疊 " + gap);
        assert.ok(gap <= 48, `右欄內容底 ${lastRight.b.toFixed(1)} → 聊這個地點頂 ${m.chat.t.toFixed(1)}，空白 ${gap.toFixed(1)}px`);
      });
      check(`B3 內容未被切掉（scrollHeight 涵蓋兩欄最低點）（${name}）`, () => {
        const lowest = Math.max(m.nav.b, m.chat.b);
        assert.ok(m.route.scrollHeight + 0.5 >= lowest - m.route.t, `scrollHeight ${m.route.scrollHeight} < ${lowest}`);
        assert.ok(m.route.h <= 700.5, "根節點超出容器高度 " + m.route.h);
      });
    }
    console.log("雙頁量測：" + JSON.stringify(report));

    // ─── D3-4 第 2 輪獨立補測 ───
    console.log("瀏覽器：" + (await evaluate("window.ua()")));
    const setFixture = (o) =>
      evaluate(`window.__ticketH=${o.ticketH ?? 0};window.__reasonRepeat=${o.reasonRepeat ?? 1};`);
    const duoMount = (s, extra = {}) =>
      mount({ ...s, version: "cur", split: true, duoClass: " place-duo-root", ...extra });
    const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

    // B6 右欄比左欄長很多：可捲到底、聊這個地點完整可見、下方保留間距
    await setFixture({ ticketH: 900, reasonRepeat: 8 });
    await duoMount(scenarios.long);
    const m6 = await measure();
    const end6 = await evaluate("window.scrollEnd()");
    check("B6 右欄極長：右欄與聊這個地點緊接、捲到底後聊這個地點完整可見且下方留 ≥16px", () => {
      assert.ok(m6.chat.t - m6.ticket.b >= -0.5 && m6.chat.t - m6.ticket.b <= 48, "gap " + (m6.chat.t - m6.ticket.b));
      assert.ok(m6.route.scrollHeight > 1500, "scrollHeight 未包含右欄 " + m6.route.scrollHeight);
      assert.ok(near(end6.scrollTop, end6.maxScroll), JSON.stringify(end6));
      assert.ok(end6.chatSpace >= 16 - 0.5, "聊這個地點下方間距 " + end6.chatSpace);
      assert.ok(end6.chatSpace <= 64, "聊這個地點下方多出大片空白 " + end6.chatSpace);
    });
    await evaluate("document.getElementById('route').scrollTop=0");

    // B7 左欄比右欄長：右欄短、聊這個地點不被左欄撐開；捲到底導航下方有間距、沒有多餘捲動
    await setFixture({});
    await duoMount(scenarios.unavailable);
    const m7 = await measure();
    await evaluate("document.querySelector('#wrap').style.height='400px'");
    const end7 = await evaluate("window.scrollEnd()");
    await evaluate("document.querySelector('#wrap').style.height='700px'");
    check("B7 左欄較長：聊這個地點緊接右欄、左欄捲到底導航下方留 16–64px", () => {
      assert.ok(m7.nav.b > m7.chat.b + 100, "fixture 未讓左欄較長");
      assert.ok(m7.chat.t - m7.transport.b <= 48, "gap " + (m7.chat.t - m7.transport.b));
      assert.ok(end7.navSpace >= 15.5 && end7.navSpace <= 64, JSON.stringify(end7));
    });

    // B8 有／無 fallback 提示 × 有／無票券：右欄頂端對齊標頭、不與提示列重疊、左欄提示在標頭下方
    for (const fallback of [false, true]) {
      for (const tickets of [false, true]) {
        await duoMount({ ...scenarios.typical, fallback, tickets });
        const m = await measure();
        check(`B8 fallback=${fallback} ticket=${tickets}：右欄對齊標頭、提示列在左頁標頭下方、聊這個地點緊接`, () => {
          assert.ok(near(m.reason.t, m.header.t), `reason.t=${m.reason.t} header.t=${m.header.t}`);
          if (fallback) {
            assert.ok(m.fallback.t >= m.header.b - 0.5 && m.fallback.r <= FOLD_L + 0.5, JSON.stringify(m.fallback));
            assert.ok(m.fallback.r < m.reason.l, "提示列與右欄水平重疊");
            assert.ok(m.hero.t >= m.fallback.b - 0.5, "Hero 與提示列重疊");
          } else assert.equal(m.fallback, null);
          assert.equal(!!m.ticket, tickets);
          const last = m.ticket ?? m.transport;
          assert.ok(m.chat.t - last.b >= -0.5 && m.chat.t - last.b <= 48, "gap " + (m.chat.t - last.b));
        });
      }
    }

    // B9 交通方式載入中 → 載入完成（同一棵樹 re-render，不 remount），聊這個地點跟著移動
    await duoMount(scenarios.short);
    const m9a = await measure();
    await evaluate("window.nodes()");
    await duoMount({ ...scenarios.long, fallback: false });
    await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const m9b = await measure();
    await duoMount(scenarios.short);
    await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const m9c = await measure();
    check("B9 載入中→完成→變短：聊這個地點隨右欄高度移動、始終緊接、不重疊", () => {
      assert.ok(m9b.chat.t > m9a.chat.t + 300, `chat 未下移 ${m9a.chat.t}→${m9b.chat.t}`);
      for (const m of [m9a, m9b, m9c]) {
        const last = m.ticket ?? m.transport;
        assert.ok(m.chat.t - last.b >= -0.5 && m.chat.t - last.b <= 48, "gap " + (m.chat.t - last.b));
      }
      assert.ok(near(m9c.chat.t, m9a.chat.t), `變短後未回原位 ${m9a.chat.t} vs ${m9c.chat.t}`);
    });

    // B10 視窗寬度／摺痕變化（開合）後位置：單欄→雙頁→改摺痕→單欄→雙頁，與全新 mount 相同
    await evaluate("window.setHtml(false)");
    await mount({ ...scenarios.typicalWithTicket, version: "cur", split: true, duoClass: "", width: 402 });
    await evaluate("window.nodes()");
    await evaluate("window.setHtml(true)");
    await duoMount(scenarios.typicalWithTicket);
    const m10open = await measure();
    await evaluate("window.setFold(430, 470)");
    await duoMount(scenarios.typicalWithTicket, { width: 840 });
    const m10fold = await measure();
    await evaluate("window.setHtml(false)");
    await mount({ ...scenarios.typicalWithTicket, version: "cur", split: true, duoClass: "", width: 402 });
    await evaluate("window.setHtml(true)");
    await duoMount(scenarios.typicalWithTicket);
    const m10reopen = await measure();
    const sameNodes10 = await evaluate("window.sameNodes()");
    await mount({ ...scenarios.typicalWithTicket, version: "cur", split: true, duoClass: "", width: 402 });
    await mount({ ...scenarios.typical, version: "head", split: false, duoClass: "" });
    await duoMount(scenarios.typicalWithTicket);
    const m10fresh = await measure();
    check("B10 開合／摺痕變化後位置正確且與全新 mount 相同、不 remount", () => {
      assert.deepEqual(m10open, m10fresh, "展開後與全新 mount 不同");
      assert.deepEqual(m10reopen, m10fresh, "合起再展開後與全新 mount 不同");
      assert.equal(sameNodes10, true, "開合過程節點被重建");
      for (const k of ["reason", "transport", "ticket", "chat"]) {
        assert.ok(m10fold[k].l >= 470 - 0.5 && m10fold[k].r <= 840 + 0.5, `${k} 摺痕變化後位置錯誤 ${JSON.stringify(m10fold[k])}`);
      }
      for (const k of ["header", "hero", "address", "links", "actions", "nav"]) {
        assert.ok(m10fold[k].r <= 430 + 0.5, `${k} 摺痕變化後跨摺痕 ${JSON.stringify(m10fold[k])}`);
      }
      assert.ok(near(m10fold.chat.l, m10fold.reason.l) && near(m10fold.chat.r, m10fold.reason.r), "聊這個地點寬度未跟右欄");
    });

    // B11 點擊區域：每個按鈕／連結中心點 elementFromPoint 命中自身（雙頁各情境）
    for (const [name, s] of Object.entries({ typicalWithTicket: scenarios.typicalWithTicket, long: scenarios.long })) {
      await duoMount(s);
      const h = await evaluate("window.hitTest()");
      check(`B11 雙頁點擊區域未被其他層遮擋（${name}，${h.count} 個目標）`, () => {
        assert.ok(h.count >= 10, "目標數異常 " + h.count);
        assert.deepEqual(h.bad, []);
      });
    }

    // B12 Tab 順序＝DOM 順序（記錄）；anchor 不支援時退化行為（模擬，記錄）
    await duoMount(scenarios.typicalWithTicket);
    console.log("Tab 順序（DOM）：" + JSON.stringify(await evaluate("window.focusOrder()")));
    await evaluate("window.emulateNoAnchor(true)");
    const m12 = await measure();
    await evaluate("window.emulateNoAnchor(false)");
    console.log(
      "模擬不支援 anchor 時聊這個地點位置：" +
        JSON.stringify({ chat: m12.chat, nav: m12.nav, transport: m12.transport, scroll: m12.route.scrollHeight }),
    );
    await setFixture({});

    const singleOpen = await evaluate("window.single(' place-duo-single')");
    check("B4 找不到／載入中（place-duo-single）只在左頁", () => {
      assert.ok(singleOpen.l >= -0.5 && singleOpen.r <= FOLD_L + 0.5, JSON.stringify(singleOpen));
    });
    check("B5 fixture 未發出任何外部請求", () => assert.deepEqual(externalRequests, []));
  } finally {
    ws?.close();
    chrome.kill();
    server.close();
    server.closeAllConnections?.();
    stop();
  }
}

if (failures.length) {
  console.log(`\nverify-place-detail-duo-layout: FAIL（${failures.length}）\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log("\nverify-place-detail-duo-layout: PASS");
