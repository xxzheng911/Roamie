// verify-chat-duo-laptop-rec-pane.mjs — iPhone Duo 筆電半開：聊聊下半部推薦區（ChatDuoRecommendationPane variant="laptop"）
// 真實 React render 驗證（任務單 #H2b-1-T 第 2 輪，tester 獨立審查）
//
// 真實 Chrome＋以目前 styles.css 編譯的 Tailwind CSS＋真實 ChatMessageList／ChatDuoRecommendationPane／RoamieResponseView；
// useDuoLayout／useDuoLaptop 以可控 store 取代（筆電 laptop=true）。頁面殼層 class 由 _app.chat.tsx／ChatComposer／BottomNav 原始碼抽取，
// 輸入列 inline style 依 _app.chat.tsx（position fixed、max-width 440、z-index 45、bottom＝底部導覽高度或鍵盤高度）。
//
//   L1  非筆電非雙頁（手機）：目前版 HTML 與 HEAD 逐字相同、body 無 portal；父層 re-render 與 laptop store 通知（仍為 false）
//       不讓 ChatMessageRow re-render
//   L2  筆電：訊息列無卡片、有推薦的回覆有「推薦 · N」標籤（aria-pressed）；預設最新；點標籤／泡泡切換；選取泡泡加框
//   L3  筆電：推薦區 portal 到 body、fixed；位置 [摺痕下緣, 輸入列上緣]、不進摺痕帶、左右＝safe-left～直欄左緣；
//       祖先鏈沒有 transform／filter／contain／will-change／overflow 捲動容器；摺痕帶 elementFromPoint 無可點元素
//   L4  筆電：卡片橫向排列、可橫向捲動、照片 96px、卡片可內捲；可見卡片的按鈕 elementFromPoint 可點
//   L5  筆電：每張卡片 HTML 與非筆電訊息列卡片逐字相同（內容不刪減）；每個按鈕／卡片點擊／Enter 的 handler 呼叫相同
//   L6  筆電：新推薦出現自動切到最新；只新增文字回覆時保留選擇；切換時橫向捲動回到開頭
//   L7  筆電：輸入列高度改變（快捷按鍵列出現／消失）時 ResizeObserver 更新 --chat-laptop-composer-height，推薦區下緣跟著輸入列上緣
//   L8  鍵盤開（html.chat-keyboard-open）：推薦區 visibility hidden、同一 DOM 節點、捲動位置保留；收起後恢復
//   L9  無推薦／generating／suppressPlaceCards／hydrating：推薦區不渲染、訊息列 HTML 與 HEAD 相同
//   L10 姿勢切換 筆電↔手機↔雙頁↔筆電：訊息列 DOM 節點沿用（不 remount）、不多出 [CHAT_RECOMMENDATION_MOUNT] log；
//       雙頁優先（雙頁＋laptop store true 時用右頁 variant）；回到手機時 HTML 與 HEAD 相同、portal 移除
//   L11 StrictMode（development build）：只有一個推薦區 portal、量測正常、unmount 後移除
//   L12 B0 對照：移除筆電聊聊 CSS 規則時，L3／L4 斷言必須失敗
//   L14 （任務單 #H2b-2）推薦區下緣＝輸入列上緣精準到 0.5px（底部導覽含 1px border；safe-bottom 0／20；直欄補 0）；
//       下半部只有 200px＋safe-bottom 20 時推薦區 box 不溢出輸入列（padding-top 以可用高度為上限）
//   筆電／直欄／雙頁姿勢的 <html> 皆帶 duo-device（實機一定有 hinge），驗證與 html.duo-device 聊聊規則並存不衝突；
//   輸入列 inline bottom 依 use-messenger-chat-layout 公式由底部導覽實測高度算出
//
// 突變測試：node scripts/verify-chat-duo-laptop-rec-pane.mjs --mutants（在記憶體中改寫 source／CSS 字串，不碰檔案）
// 不讀 .env、不呼叫外部服務；瀏覽器只連 127.0.0.1 fixture server。
// 執行：node scripts/verify-chat-duo-laptop-rec-pane.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n  " + String(e?.message ?? e).split("\n").slice(0, 30).join("\n  "));
  }
};
const sameHtml = (a, b, label = "HTML 不同") => {
  if (a === b) return;
  a = String(a);
  b = String(b);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert.fail(`${label}（第 ${i} 字元起）\n  實際：…${a.slice(Math.max(0, i - 80), i + 160)}\n  預期：…${b.slice(Math.max(0, i - 80), i + 160)}`);
};

// ───────────── 突變（只在記憶體中改寫字串）─────────────
// 推薦區下緣（任務單 #H2b-2）：--chat-laptop-rec-bottom＝底部導覽總高＋底部導覽 1px border（直欄時補 0）＋輸入列高度
const REC_RULE_BOTTOM =
  "  --chat-laptop-rec-bottom: calc(\n    var(--app-nav-total-height) + (1px - min(1px, var(--app-rail-width, 0px))) +\n      var(--chat-laptop-composer-height, 7.5rem)\n  );";
const REC_RULE_PADDING_TOP =
  "  padding-top: clamp(0px, calc(100dvh - var(--duo-hinge-bottom) - var(--chat-laptop-rec-bottom)), 0.75rem);";
const MUTANTS = {
  laptopIgnored: ["list", "const duoLaptop = useDuoLaptop().laptop && !duoTwoPaneLayout;", "const duoLaptop = false;"],
  laptopNotPriority: ["list", "const duoLaptop = useDuoLaptop().laptop && !duoTwoPaneLayout;", "const duoLaptop = useDuoLaptop().laptop;"],
  variantAlwaysTwoPane: ["list", 'variant={duoLaptop ? "laptop" : "two-pane"}', 'variant="two-pane"'],
  remountOnPosture: ["list", "key={stableKeys[i]}\n", 'key={stableKeys[i] + (duoTwoPane ? ":duo" : "")}\n'],
  noAutoSwitch: ["list", "duoPick && duoPick.latest === latestDuoKey", "duoPick"],
  noComposerMeasure: ["pane", "const composerHeight = useComposerHeight(laptop);", "const composerHeight = useComposerHeight(false);"],
  noResizeObserver: ["pane", "ro?.observe(el);", ""],
  noScrollLeftReset: ["pane", "if (laptop && scrollRef.current) scrollRef.current.scrollLeft = 0;", ""],
  laptopDropsHandler: ["pane", "      onDiscussPlace,\n      selectedPlaceNames", "      selectedPlaceNames"],
  laptopShowsSummary: ["pane", "      hideSummary: true,\n", ""],
  portalIntoList: ["pane", "      </aside>,\n      document.body,", '      </aside>,\n      document.querySelector(".messenger-chat-messages") ?? document.body,'],
  cssBottomIgnoresComposer: ["css", REC_RULE_BOTTOM, "  --chat-laptop-rec-bottom: calc(var(--app-nav-total-height) + (1px - min(1px, var(--app-rail-width, 0px))));"],
  // 修正前寫法（不補底部導覽 1px border）：L14a 精準相等（0.5px）必須抓到
  cssBottomNoNavBorder: ["css", REC_RULE_BOTTOM, "  --chat-laptop-rec-bottom: calc(var(--app-nav-total-height) + var(--chat-laptop-composer-height, 7.5rem));"],
  // 直欄時也補 1px：L14a 直欄情境必須抓到
  cssBottomBorderAlways: ["css", REC_RULE_BOTTOM, "  --chat-laptop-rec-bottom: calc(var(--app-nav-total-height) + 1px + var(--chat-laptop-composer-height, 7.5rem));"],
  // padding-top 不以可用高度為上限：L14b 下半部 200px＋safe-bottom 20 時 box 溢出輸入列
  cssPaddingNoClamp: ["css", REC_RULE_PADDING_TOP, "  padding-top: 0.75rem;"],
  cssTopIntoFold: ["css", "  top: var(--duo-hinge-bottom);\n  bottom: var(--chat-laptop-rec-bottom);", "  top: var(--duo-hinge-top);\n  bottom: var(--chat-laptop-rec-bottom);"],
  cssCardsVertical: ["css", "html.duo-laptop.chat-route-active .chat-laptop-rec [data-chat-place-cards] {\n  display: flex;", "html.duo-laptop.chat-route-active .chat-laptop-rec [data-chat-place-cards] {\n  display: block;"],
  cssKbDisplayNone: ["css", "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec {\n  visibility: hidden;", "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec {\n  display: none;"],
  cssNoKbRule: ["css", "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec {\n  visibility: hidden;", "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec {\n  outline: 0;"],
  cssPhotoTall: ["css", "  aspect-ratio: auto;\n  height: 96px;", "  aspect-ratio: auto;\n  height: 132px;"],
};
const activeMutant = process.env.CHAT_LAPTOP_MUTANT || process.argv.find((a) => a.startsWith("--mutant="))?.slice(9) || null;
function mutate(kind, src) {
  if (!activeMutant) return src;
  const [k, from, to] = MUTANTS[activeMutant];
  if (k !== kind) return src;
  assert.ok(src.includes(from), `突變 ${activeMutant} 找不到原始片段`);
  return src.replace(from, to);
}
if (process.argv.includes("--mutants")) {
  let survived = 0;
  for (const name of Object.keys(MUTANTS)) {
    const r = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      env: { ...process.env, CHAT_LAPTOP_MUTANT: name },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const failed = [...out.matchAll(/^FAIL (L\S*) /gm)].map((m) => m[1]);
    const crashed = /突變 .* 找不到原始片段/.test(out);
    const killed = r.status !== 0 && failed.length > 0 && !crashed;
    if (!killed) survived++;
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${name}  → FAIL: ${[...new Set(failed)].join(", ") || "(none)"}${crashed ? "（突變未套用）" : ""}`);
  }
  console.log(survived ? `\n突變測試：${survived} 個突變存活（檢查不足）` : "\n突變測試：全部突變都被抓到");
  process.exit(survived ? 1 : 0);
}

// ───────────── fixture class（由原始碼抽取）─────────────
const src = {
  chat: read("src/routes/_app.chat.tsx"),
  composer: read("src/components/chat/ChatComposer.tsx"),
  nav: read("src/components/BottomNav.tsx"),
};
function lit(key, needle) {
  const s = src[key];
  const i = s.indexOf(needle);
  if (i < 0) throw new Error(`fixture 抽取失敗：${key} 找不到 ${needle}`);
  let a = i;
  while (a > 0 && s[a - 1] !== '"' && s[a - 1] !== "`") a--;
  const q = s[a - 1];
  let b = i;
  while (b < s.length && s[b] !== q && !(q === "`" && s.startsWith("${", b))) b++;
  return s.slice(a, b).trim();
}
const C = {
  CHAT_ROOT: lit("chat", "messenger-chat-root"),
  CHAT_HEADER: lit("chat", "messenger-chat-header"),
  CHAT_BODY: lit("chat", "messenger-chat-body"),
  CHAT_MSGS: lit("chat", "messenger-chat-messages"),
  CC_ROOT: lit("composer", "chat-composer border-t"),
  CC_ROW: lit("composer", "mb-2 flex gap-2 overflow-x-auto no-scrollbar"),
  CC_CHIP: lit("composer", "shrink-0 rounded-full border border-border bg-card text-foreground/80"),
  CC_INPUT_ROW: lit("composer", "chat-input-row"),
  CC_TEXTAREA: lit("composer", "flex-1 resize-none"),
  CC_SEND: lit("composer", "flex h-10 w-10 items-center justify-center rounded-full bg-primary"),
  NAV_BOTTOM: lit("nav", "bottom-nav fixed"),
  NAV_RAIL: lit("nav", "app-right-rail fixed"),
  NAV_UL: lit("nav", "flex h-[var(--bottom-nav-height,4.25rem)]"),
};
for (const t of ['position: "fixed"', 'maxWidth: "440px"', "zIndex: 45", 'marginInline: "auto"', '"messenger-chat-composer"'])
  assert.ok(src.chat.includes(t), "_app.chat.tsx 輸入列 inline style／class 已變更：" + t);

const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

if (!chromeBin) {
  failures.push("L 無可用 Chrome");
  console.log("FAIL L 無可用 Chrome，未執行瀏覽器驗證");
} else {
  try {
    await runBrowser();
  } catch (e) {
    failures.push("L-crash 瀏覽器驗證中斷");
    console.log("FAIL L-crash 瀏覽器驗證中斷（之後的檢查未執行）\n  " + String(e?.message ?? e).split("\n").slice(0, 6).join("\n  "));
  }
}

async function runBrowser() {
  const { build, stop } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-chat-laptop-"));

  const stylesRaw = read("src/styles.css");
  const styles = mutate("css", stylesRaw);
  // OLD：移除筆電聊聊第 2 版規則（.messenger-chat-composer 全寬與 .chat-laptop-rec*），其餘不變（B0 對照）
  const stylesOld = styles
    .split(/(?=\nhtml\.)/)
    .filter((chunk) => !/^\nhtml\.duo-laptop\.chat-route-active(\.chat-keyboard-open)? \.(chat-laptop-rec|messenger-chat-composer)/.test(chunk))
    .join("");
  assert.ok(stylesOld.length < styles.length && !/chat-laptop-rec \{/.test(stylesOld), "OLD CSS 未移除推薦區規則");
  const fixtureFile = path.join(dir, "classes.html");
  fs.writeFileSync(fixtureFile, Object.values(C).join("\n") + "\n app-right-rail");
  const compileCss = async (text) => {
    const compiler = await compile(text.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    const scanner = new Scanner({ sources: [...compiler.sources, { base: dir, pattern: "**/*", negated: false }] });
    return compiler.build(scanner.scan());
  };
  const cssNew = await compileCss(styles);
  const cssOld = await compileCss(stylesOld);
  assert.match(cssNew, /chat-laptop-rec/);
  assert.doesNotMatch(cssOld, /chat-laptop-rec\s*\{/);

  const listCur = mutate("list", read("src/components/chat/ChatMessageList.tsx"));
  const paneCur = mutate("pane", read("src/components/chat/ChatDuoRecommendationPane.tsx"));
  const mocks = {
    "@/integrations/supabase/client": `export const isSupabaseConfigured=false;export const supabase={auth:{getSession:async()=>({data:{session:null}})}}`,
    "@/lib/api-url": `export const resolveApiUrl=p=>location.origin+p`,
    "@/services/placeImageService": `export const getRoamieDefaultImage=()=>"/fallback.png"`,
    "@/hooks/use-i18n": `const M={"productionUi.p042d7d5a05":"推薦"};export const useI18n=()=>({locale:'zh-TW',t:k=>M[k]??k})`,
    "@/components/PlaceRecommendationReason": `export const PlaceRecommendationReason=({place})=>"reason:"+place.name+" "+"很長的推薦理由。".repeat(12)`,
    "@/components/media/PlaceCoverImage": `export const PlaceCoverImage=({className,name})=><div className={className} data-fixture-cover={name}/>`,
    "@/lib/google-maps-client": `export const buildPlacePhotoUrl=()=>null`,
    "@/lib/maps-navigation": `export const openExternal=(u)=>{(window.__calls||[]).push(['openExternal'])};export const buildPlaceMapsUrl=()=>"https://maps.invalid/p";export const buildDirectionsUrl=()=>"https://maps.invalid/d";export const buildDirectionsUrlFromQuery=()=>"https://maps.invalid/q"`,
    "@/components/RoamieAssistantAvatar": `export function RoamieAssistantAvatar({className}){window.__avatarRenders=(window.__avatarRenders||0)+1;return <span className={className} data-fixture-avatar=""/>}`,
    "@/hooks/use-duo-layout": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur={navPlacement:'bottom',tripLayout:'single',usableWidth:402};
export function setDuoLayout(v){cur=v;subs.forEach(f=>f());}
export function useDuoLayout(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}`,
    "@/hooks/use-duo-laptop": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur=Object.freeze({laptop:false});
export function setDuoLaptop(v){cur=v;subs.forEach(f=>f());}
export function notifyDuoLaptop(){subs.forEach(f=>f());}
export function useDuoLaptop(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}`,
    "fixture:cur-list": listCur,
    "@/components/chat/ChatDuoRecommendationPane": paneCur,
    "fixture:head-list": git("show", "HEAD:src/components/chat/ChatMessageList.tsx"),
    "fixture:head-rrv": git("show", "HEAD:src/components/RoamieResponseView.tsx"),
  };
  const mockDir = {
    "fixture:cur-list": path.join(root, "src/components/chat"),
    "@/components/chat/ChatDuoRecommendationPane": path.join(root, "src/components/chat"),
    "fixture:head-list": path.join(root, "src/components/chat"),
    "fixture:head-rrv": path.join(root, "src/components"),
  };

  const entry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {ChatMessageList as CurList} from 'fixture:cur-list';
import {ChatMessageList as HeadList} from 'fixture:head-list';
import {setDuoLayout} from '@/hooks/use-duo-layout';
import {setDuoLaptop,notifyDuoLaptop} from '@/hooks/use-duo-laptop';
const C=${JSON.stringify(C)};
window.__calls=[];window.__logs=[];
console.info=(...a)=>{if(a[0]==='[CHAT_RECOMMENDATION_MOUNT]')window.__logs.push(JSON.stringify(a[1]));};
console.debug=()=>{};console.log=()=>{};
const rec=(n)=>({name:n,placeName:n,description:'Desc '+n+' '+'很長的地點說明文字。'.repeat(10),reason:'Why '+n,address:n+' street 1-2-3',lat:35.6,lng:139.7,googlePlaceId:'gp-'+n,type:'cafe',rating:4.2});
const recs=(p,c)=>Array.from({length:c},(_,i)=>rec(p+(i+1)));
const BASE=[
 {id:'u1',role:'user',content:'推薦咖啡'},
 {id:'a1',role:'assistant',content:'這裡有兩間',recommendationRequestId:'rq1',roamie:{summary:'這裡有兩間咖啡廳',moodTag:'chill',recommendations:recs('A',2)}},
 {id:'u2',role:'user',content:'謝謝'},
 {role:'assistant',content:'不客氣，還需要什麼嗎'},
 {id:'u3',role:'user',content:'再來幾間'},
 {id:'a3',role:'assistant',content:'再給你五間',recommendationRequestId:'rq3',roamie:{summary:'再給你五間',recommendations:recs('B',5)}},
];
const GROWN=[...BASE,{id:'u4',role:'user',content:'還有嗎'},{id:'a5',role:'assistant',content:'再五間',recommendationRequestId:'rq5',roamie:{summary:'最後再五間',recommendations:recs('C',5)}}];
const GROWN_TEXT=[...BASE,{id:'u4',role:'user',content:'好'},{id:'a5',role:'assistant',content:'沒問題'}];
const NO_RECS=[{id:'u1',role:'user',content:'你好'},{id:'a1',role:'assistant',content:'你好！',roamie:{summary:'你好！',recommendations:[]}}];
const H={onRecommendationEngage:()=>window.__calls.push(['engage']),onSavePlace:r=>window.__calls.push(['save',r.name]),onAddToTrip:r=>window.__calls.push(['addToTrip',r.name]),onOpenPlaceDetail:r=>window.__calls.push(['openDetail',r.name]),onDiscussPlace:r=>window.__calls.push(['discuss',r.name])};
const SEL=new Set(['B2']);const SAVED=new Set(['B3','A1']);const EMPTY=new Set();
const P=(o)=>({msgs:BASE,hydrating:false,streaming:false,generating:false,suppressPlaceCards:false,loadingIndicator:null,partial:{},selectedNames:SEL,savedNames:SAVED,savingName:null,addToTripLabel:'加入行程',discussPlaceLabel:'聊這裡',viewMapLabel:'地圖',selectionMode:false,recommendationSessionId:'sess-1',...H,...o});
const SC={
 base:P({}),
 selection:P({selectionMode:true,addToTripLabel:'選取'}),
 saving:P({savingName:'B1',selectedNames:EMPTY}),
 generating:P({generating:true}),
 suppress:P({suppressPlaceCards:true}),
 streaming:P({msgs:[...BASE,{id:'u9',role:'user',content:'更多'},{id:'a9',role:'assistant',content:''}],streaming:true,partial:{summary:'串流中的回覆',recommendations:[rec('S1')]}}),
 loading:P({loadingIndicator:{baseText:'整理推薦中',requestId:'r1',dots:2}}),
 noRecs:P({msgs:NO_RECS}),
 hydrating:P({msgs:[],hydrating:true}),
 grown:P({msgs:GROWN}),
 grownText:P({msgs:GROWN_TEXT}),
};
const FOLD_TOP=455.5,FOLD_BOTTOM=495.5;
const LAPTOP=Object.freeze({laptop:true,foldTop:FOLD_TOP,foldBottom:FOLD_BOTTOM});
const NOT=Object.freeze({laptop:false});
// device：iPhone Duo 實機一定有 hinge（_app.tsx 加 html.duo-device）；筆電／直欄／雙頁姿勢皆帶 duo-device（任務單 #H2b-2）
const POSTURES={
 phone:{layout:{navPlacement:'bottom',tripLayout:'single',usableWidth:669},laptop:NOT,html:{}},
 laptop:{layout:{navPlacement:'bottom',tripLayout:'single',usableWidth:669},laptop:LAPTOP,html:{laptop:true,device:true}},
 laptopRail:{layout:{navPlacement:'right-rail',tripLayout:'single',usableWidth:605},laptop:LAPTOP,html:{laptop:true,rail:true,device:true}},
 folded:{layout:{navPlacement:'right-rail',tripLayout:'single',usableWidth:605},laptop:NOT,html:{rail:true,device:true}},
 // 雙頁優先：laptop store 也為 true（_app.tsx 不加 duo-laptop），ChatMessageList 應使用右頁 variant
 twoPane:{layout:{navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:879,pane:{leftWidth:463.5,rightWidth:391.5,gutter:24,foldX:475.5}},laptop:LAPTOP,html:{rail:true,twoPane:true,device:true}},
};
let composerBottom=69;
// 環境（L14）：底部安全區與摺痕位置；預設 safe 0、摺痕 [455.5, 495.5]
let curSafe=0,curFold=[FOLD_TOP,FOLD_BOTTOM];
function applyHtml(h,kb){const r=document.documentElement;
 r.className=['native-shell','chat-route-active',h.device?'duo-device':'',h.rail?'duo-rail':'',h.twoPane?'duo-two-pane':'',h.laptop?'duo-laptop':'',kb?'chat-keyboard-open app-keyboard-open':''].filter(Boolean).join(' ');
 r.removeAttribute('style');
 for(const [k,v] of [['--safe-area-top','0px'],['--safe-area-bottom',curSafe+'px'],['--safe-area-left','0px'],['--safe-area-right','0px']]) r.style.setProperty(k,v);
 if(h.rail){r.style.setProperty('--bottom-nav-height','0.01px');r.style.setProperty('--app-rail-width','64px');}
 if(h.twoPane){r.style.setProperty('--duo-fold-left-edge','463.5px');r.style.setProperty('--duo-fold-right-edge','487.5px');}
 if(h.laptop){r.style.setProperty('--duo-hinge-top',curFold[0]+'px');r.style.setProperty('--duo-hinge-bottom',curFold[1]+'px');}
}
// 輸入列 inline bottom：依 use-messenger-chat-layout（鍵盤關＝round(.bottom-nav 實測高度)；無 .bottom-nav 時 round(--bottom-nav-height||68)＋safe）
function hookComposerBottom(){if(curKb>0)return curKb;const nav=document.querySelector('.bottom-nav');const m=nav?Math.round(nav.getBoundingClientRect().height):0;
 if(m>0)return m;return Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-nav-height'))||68)+curSafe;}
function syncBottom(){const next=hookComposerBottom();if(next!==composerBottom){composerBottom=next;flushSync(()=>rerender());}}
let curPosture='phone',curKb=0;
window.posture=(name,kb=0)=>{curPosture=name;curKb=kb;const p=POSTURES[name];applyHtml(p.html,kb);composerBottom=kb>0?kb:(p.html.rail?0:69);
 flushSync(()=>{setDuoLayout(p.layout);setDuoLaptop(p.laptop);});flushSync(()=>rerender());syncBottom();};
window.setEnv=(safe,foldTop,foldBottom)=>{curSafe=safe;curFold=[foldTop,foldBottom];window.posture(curPosture,curKb);return composerBottom;};
window.composerBottom=()=>composerBottom;
window.notifyLaptop=()=>flushSync(()=>notifyDuoLaptop());
function Page({version,scenario,tick,chips}){const L=version==='head'?HeadList:CurList;const rail=!!POSTURES[curPosture].html.rail;
 return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}>
  <div id="chatRoot" className={C.CHAT_ROOT}>
   <header className={C.CHAT_HEADER}><button type="button" data-btn="back">b</button></header>
   <div className={C.CHAT_BODY}>
    <div id="msgs" data-keyboard-scroll-root className={C.CHAT_MSGS} style={{flex:'1 1 0%',paddingBottom:'20px'}}>
     <div id="chat" className="space-y-4" data-tick={tick}>{scenario?<L {...SC[scenario]}/>:null}</div>
    </div>
    <div id="composer" className={'messenger-chat-composer'+(curKb?' messenger-chat-composer--keyboard-open':'')} style={{position:'fixed',left:0,right:0,marginInline:'auto',maxWidth:'440px',bottom:composerBottom+'px',zIndex:45}}>
     <div id="cc" className={C.CC_ROOT}>
      {chips?<div id="chipRow" className={C.CC_ROW}>{[0,1,2,3,4].map(i=><button key={i} type="button" data-btn={'chip-'+i} className={C.CC_CHIP+' px-3 py-1.5 text-xs'}>快捷 {i}</button>)}</div>:null}
      <div className={C.CC_INPUT_ROW}><textarea id="ta" rows={1} className={C.CC_TEXTAREA}/><button type="button" data-btn="send" className={C.CC_SEND}>s</button></div>
     </div>
    </div>
   </div>
  </div>
  {rail?<nav id="nav" className={C.NAV_RAIL} style={{width:'64px'}}/>:<nav id="nav" className={C.NAV_BOTTOM}><ul className={C.NAV_UL}><li>n</li></ul></nav>}
 </div>;}
const rootEl=createRoot(document.getElementById('root'));
let props={};let strict=false;
function rerender(){rootEl.render(strict?<StrictMode><Page {...props}/></StrictMode>:<Page {...props}/>);}
window.mount=o=>{props={chips:true,...o};flushSync(()=>rerender());};
window.setStrict=v=>{strict=v;};
window.setCss=w=>{document.getElementById('css').textContent=window.__CSS[w];return true;};
const q=s=>document.querySelector(s);const qa=s=>[...document.querySelectorAll(s)];
window.snap=()=>({html:q('#chat').innerHTML,body:[...document.body.children].map(e=>e.tagName+'#'+e.id+'.'+e.className+(e.hasAttribute('data-chat-duo-rec-pane')?'[pane]':''))});
const row=id=>q('#chat [data-chat-message-id="'+id+'"]');
window.leftCards=()=>Object.fromEntries(qa('#chat [data-chat-message-id]').map(r=>[r.getAttribute('data-chat-message-id'),[...r.querySelectorAll('[data-chat-place-cards] > article h4')].map(h=>h.textContent)]).filter(([,v])=>v.length));
window.paneCards=()=>qa('[data-chat-duo-rec-pane] [data-chat-place-cards] > article h4').map(h=>h.textContent);
window.paneInfo=()=>qa('body > [data-chat-duo-rec-pane]').map(e=>({cls:e.className,variant:e.getAttribute('data-variant'),parent:e.parentElement.tagName}));
window.tags=()=>Object.fromEntries(qa('#chat [data-chat-message-id]').map(r=>{const b=r.querySelector(':scope > div:last-child > button[aria-pressed]');return b?[r.getAttribute('data-chat-message-id'),{text:b.textContent,pressed:b.getAttribute('aria-pressed'),bubble:r.children[1].className}]:null}).filter(Boolean));
window.clickTag=id=>flushSync(()=>row(id).querySelector(':scope > div:last-child > button').click());
window.clickBubble=id=>flushSync(()=>row(id).children[1].click());
window.paneText=()=>q('[data-chat-duo-rec-pane]')?.textContent??null;
const artSel=scope=>scope==='pane'?'[data-chat-duo-rec-pane] [data-chat-place-cards] > article':'#chat [data-chat-message-id="'+scope+'"] [data-chat-place-cards] > article';
window.articleHtml=(scope,i)=>qa(artSel(scope))[i]?.outerHTML??null;
window.trace=(scope,i)=>{const art=()=>qa(artSel(scope))[i];const out=[];const n=art().querySelectorAll('button').length;
 for(let k=0;k<n;k++){window.__calls=[];const b=art().querySelectorAll('button')[k];const label=(b.getAttribute('aria-label')||b.textContent).trim();flushSync(()=>b.click());out.push({label,disabled:b.disabled,calls:window.__calls});}
 window.__calls=[];flushSync(()=>art().querySelector('p.text-muted-foreground').click());out.push({label:'article-click',calls:window.__calls});
 window.__calls=[];flushSync(()=>art().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));out.push({label:'article-enter',calls:window.__calls});
 window.__calls=[];return out;};
window.rowNodes=()=>{window.__rows=qa('#chat [data-chat-message-id]').flatMap(r=>[r,r.children[0],r.children[1]].filter(Boolean));return window.__rows.length;};
window.sameRowNodes=()=>{const now=qa('#chat [data-chat-message-id]').flatMap(r=>[r,r.children[0],r.children[1]].filter(Boolean));return now.length===window.__rows.length&&now.every((n,i)=>n===window.__rows[i]&&n.isConnected);};
window.resetLogs=()=>{window.__logs=[];};window.logs=()=>window.__logs;
window.avatar=()=>window.__avatarRenders||0;
window.raf2=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
const ancestorIssues=el=>{const out=[];for(let a=el.parentElement;a;a=a.parentElement){const cs=getComputedStyle(a);const bad=[];
 if(cs.transform!=='none')bad.push('transform');for(const k of ['translate','rotate','scale'])if(cs[k]&&cs[k]!=='none')bad.push(k);
 if(cs.filter!=='none')bad.push('filter');if(cs.backdropFilter&&cs.backdropFilter!=='none')bad.push('backdrop-filter');if(cs.perspective!=='none')bad.push('perspective');
 if(cs.contain!=='none')bad.push('contain:'+cs.contain);if(cs.willChange!=='auto')bad.push('will-change');if(cs.containerType&&cs.containerType!=='normal')bad.push('container-type');
 if(/auto|scroll|overlay/.test(cs.overflowX+' '+cs.overflowY))bad.push('overflow:'+cs.overflowX+'/'+cs.overflowY);
 if(bad.length)out.push(a.tagName+(a.id?'#'+a.id:'')+'.'+[...a.classList].slice(0,2).join('.')+' → '+bad.join(','));}return out;};
const INTERACTIVE='button,a[href],input,textarea,select,[role=button],[tabindex],[data-chat-duo-rec-pane] *';
window.geom=()=>{const p=q('body > [data-chat-duo-rec-pane]');const sc=p&&p.querySelector('.chat-laptop-rec__scroll');const cs=p&&getComputedStyle(p);
 const arts=p?[...p.querySelectorAll('[data-chat-place-cards] > article')]:[];
 return {vw:innerWidth,vh:innerHeight,pane:R(p),pos:cs&&cs.position,vis:cs&&cs.visibility,z:cs&&cs.zIndex,parent:p&&p.parentElement.tagName,chain:p?ancestorIssues(p):null,
  title:p?R(p.querySelector(':scope > p')):null,composer:R(q('#composer')),cc:R(q('#cc')),msgs:R(q('#msgs')),nav:R(q('#nav')),
  composerVar:p?p.style.getPropertyValue('--chat-laptop-composer-height'):null,
  scroll:sc?{sw:sc.scrollWidth,cw:sc.clientWidth,ox:getComputedStyle(sc).overflowX,left:sc.scrollLeft}:null,
  cards:arts.map(a=>({...R(a),oy:getComputedStyle(a).overflowY,sh:a.scrollHeight,ch:a.clientHeight})),
  photos:arts.map(a=>a.firstElementChild.getBoundingClientRect().height),
  headerP:p?[...p.querySelectorAll('[data-chat-place-cards] > p')].map(x=>getComputedStyle(x).display):null};};
window.foldHits=(top,bottom,xMax)=>{const out=[];for(let y=Math.ceil(top)+0.5;y<bottom;y+=2)for(let x=1;x<xMax;x+=8){const el=document.elementFromPoint(x,y);const hit=el&&el.closest(INTERACTIVE);if(hit)out.push({x,y,hit:hit.tagName+'.'+String(hit.className).slice(0,30)});}return out;};
// 可見卡片（橫向捲到第 i 張、卡片內捲到按鈕）後，以 elementFromPoint 點擊按鈕：回傳命中的按鈕與 handler 呼叫
window.clickVisible=(i,btnIdx)=>{const p=q('body > [data-chat-duo-rec-pane]');const sc=p.querySelector('.chat-laptop-rec__scroll');const art=p.querySelectorAll('[data-chat-place-cards] > article')[i];
 if(!art)return {ok:false,missing:'article '+i};
 sc.scrollLeft=Math.max(0,art.offsetLeft-20);const b=art.querySelectorAll('button')[btnIdx];if(!b)return {ok:false,missing:'button '+btnIdx+' of article '+i};
 art.scrollTop=Math.max(0,b.getBoundingClientRect().top-art.getBoundingClientRect().top+art.scrollTop-art.clientHeight/2);
 const r=b.getBoundingClientRect();const x=r.left+Math.min(r.width/2,12),y=r.top+r.height/2;const e=document.elementFromPoint(x,y);const pr=p.getBoundingClientRect();
 window.__calls=[];if(e&&b.contains(e))flushSync(()=>e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y})));const calls=window.__calls;window.__calls=[];
 return {ok:!!e&&b.contains(e),inPane:y>=pr.top&&y<=pr.bottom&&x>=pr.left&&x<=pr.right,calls,label:(b.getAttribute('aria-label')||b.textContent).trim(),scrollLeft:sc.scrollLeft};};
window.scrollPane=to=>{const sc=q('.chat-laptop-rec__scroll');if(to!=null)sc.scrollLeft=to;return sc.scrollLeft;};
window.paneNode=()=>{window.__pane=q('body > [data-chat-duo-rec-pane]');return !!window.__pane;};
window.samePane=()=>q('body > [data-chat-duo-rec-pane]')===window.__pane&&!!window.__pane&&window.__pane.isConnected;
window.setKb=on=>{curKb=on?320:0;applyHtml(POSTURES[curPosture].html,curKb);composerBottom=on?320:(POSTURES[curPosture].html.rail?0:69);flushSync(()=>rerender());syncBottom();};
window.ready=true;`;

  const isDev = process.env.CHAT_LAPTOP_DEV === "1";
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "app.js"),
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: {
      "import.meta.env": '{"DEV":false,"PROD":true,"MODE":"production"}',
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.importer === "fixture:head-list" && a.path === "@/components/RoamieResponseView") return { path: "fixture:head-rrv", namespace: "mock" };
            return a.path in mocks ? { path: a.path, namespace: "mock" } : null;
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: mockDir[a.path] ?? root }));
        },
      },
    ],
  });
  // StrictMode 的 double-invoke 只在 development build 生效：另打包一份 development 版本（L11）
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "app-dev.js"),
    format: "iife",
    jsx: "automatic",
    jsxDev: false,
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.importer === "fixture:head-list" && a.path === "@/components/RoamieResponseView") return { path: "fixture:head-rrv", namespace: "mock" };
            return a.path in mocks ? { path: a.path, namespace: "mock" } : null;
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: mockDir[a.path] ?? root }));
        },
      },
    ],
  });
  void isDev;

  const cssJs = "window.__CSS=" + JSON.stringify({ new: cssNew, old: cssOld }) + ";";
  const server = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    if (u === "/app.js" || u === "/app-dev.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(cssJs + "\n" + fs.readFileSync(path.join(dir, u.slice(1))));
      return;
    }
    const script = u === "/dev" ? "/app-dev.js" : "/app.js";
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="css">' +
        cssNew +
        '</style></head><body style="margin:0"><div id="root"></div><script src="' +
        script +
        '"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const externalRequests = [];
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
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    const VW = 669;
    const VH = 951;
    const TOP = 455.5;
    const BOTTOM = 495.5;
    const RAIL = 64;
    await call("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
    const load = async (p) => {
      await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + p });
      await new Promise((r) => setTimeout(r, 200));
      for (let i = 0; i < 100 && !(await evaluate("!!window.ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(await evaluate("!!window.ready"), "fixture 未載入：" + browserErrors.join("\n"));
    };
    await load("/");

    const ev = (fn, ...args) => evaluate(`window.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    const mount = (o) => ev("mount", o);
    const unmountAll = () => mount({});
    const raf = () => evaluate("window.raf2()");
    const near = (a, b, msg, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

    // ─── L1 手機（非筆電非雙頁）：與 HEAD 逐字相同、memo 不多 re-render ───
    const SCEN = ["base", "selection", "saving", "generating", "suppress", "streaming", "loading", "noRecs", "hydrating", "grown"];
    const headSnaps = {};
    await ev("posture", "phone");
    for (const s of SCEN) {
      await unmountAll();
      await mount({ version: "head", scenario: s });
      headSnaps[s] = await ev("snap");
    }
    {
      const diffs = [];
      for (const s of SCEN) {
        await unmountAll();
        await mount({ version: "cur", scenario: s });
        const c = await ev("snap");
        if (c.html !== headSnaps[s].html) diffs.push(`${s}: HTML 不同`);
        if (JSON.stringify(c.body) !== JSON.stringify(headSnaps[s].body)) diffs.push(`${s}: body 不同 ${JSON.stringify(c.body)}`);
      }
      check("L1a 手機（laptop=false、非雙頁）10 種情境：訊息列 HTML 與 HEAD 逐字相同、無 portal", () => assert.deepEqual(diffs, []));
    }
    {
      await unmountAll();
      await mount({ version: "cur", scenario: "base", tick: 0 });
      const a0 = await ev("avatar");
      await mount({ version: "cur", scenario: "base", tick: 1 });
      const a1 = await ev("avatar");
      for (let k = 0; k < 3; k++) await ev("notifyLaptop");
      await ev("posture", "folded");
      await ev("posture", "phone");
      const a2 = await ev("avatar");
      const html = (await ev("snap")).html;
      check("L1b 手機：父層 re-render、laptop store 通知（仍 false）、手機↔Duo 合起：ChatMessageRow re-render 0 次、HTML 不變", () => {
        assert.equal(a1 - a0, 0, "父層 re-render 讓訊息列 re-render " + (a1 - a0));
        assert.equal(a2 - a1, 0, "非筆電姿勢通知讓訊息列 re-render " + (a2 - a1));
        sameHtml(html, headSnaps.base.html);
      });
    }

    // 非筆電訊息列卡片（L2／L5 對照）
    const phoneCards = {};
    const phoneArt = {};
    for (const s of ["base", "selection", "saving", "streaming", "loading", "grown"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      phoneCards[s] = await ev("leftCards");
      if (["base", "selection", "saving"].includes(s)) {
        phoneArt[s] = { html: [], trace: [] };
        for (let i = 0; i < 5; i++) {
          phoneArt[s].html.push(await ev("articleHtml", "a3", i));
          phoneArt[s].trace.push(await ev("trace", "a3", i));
        }
      }
    }

    // ─── L2 筆電：訊息列文字＋標籤、預設最新、切換 ───
    for (const posture of ["laptop", "laptopRail"]) {
      await ev("posture", posture);
      for (const s of ["base", "streaming", "loading", "selection", "grown"]) {
        await unmountAll();
        await mount({ version: "cur", scenario: s });
        const left = await ev("leftCards");
        const tags = await ev("tags");
        const pane = await ev("paneCards");
        const info = await ev("paneInfo");
        const ids = Object.keys(phoneCards[s]);
        const latest = ids[ids.length - 1];
        check(`L2a 筆電（${posture}／${s}）：訊息列無卡片；「推薦 · N」標籤＋aria-pressed；預設最新；推薦區＝最新那則、laptop variant`, () => {
          assert.deepEqual(left, {}, "訊息列仍有卡片");
          assert.deepEqual(Object.keys(tags), ids);
          for (const id of ids) {
            assert.equal(tags[id].text, `推薦 · ${phoneCards[s][id].length}`);
            assert.equal(tags[id].pressed, id === latest ? "true" : "false");
            assert.equal(/\bborder-clay\b/.test(tags[id].bubble), id === latest, "選取框：" + id);
          }
          assert.deepEqual(info, [{ cls: "chat-laptop-rec", variant: "laptop", parent: "BODY" }]);
          assert.deepEqual(pane, phoneCards[s][latest]);
        });
      }
    }
    await ev("posture", "laptop");
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    const paneTextBase = await ev("paneText");
    await ev("clickTag", "a1");
    const t1 = await ev("tags");
    const p1 = await ev("paneCards");
    await ev("clickBubble", "a3");
    const t2 = await ev("tags");
    const p2 = await ev("paneCards");
    check("L2b 筆電：點標籤／點泡泡切換推薦區，aria-pressed 與選取框跟著移動；推薦區不重複 summary", () => {
      assert.equal(t1.a1.pressed, "true");
      assert.equal(t1.a3.pressed, "false");
      assert.match(t1.a1.bubble, /border-clay/);
      assert.deepEqual(p1, ["A1", "A2"]);
      assert.equal(t2.a3.pressed, "true");
      assert.deepEqual(p2, ["B1", "B2", "B3", "B4", "B5"]);
      assert.ok(!paneTextBase.includes("再給你五間"), "推薦區出現 summary");
      assert.ok(paneTextBase.includes("推薦"), "推薦區缺少「推薦」標題");
    });

    // ─── L3／L4 位置、祖先鏈、摺痕帶、卡片排列、可點 ───
    const geomChecks = async (label, xMax, opts = {}) => {
      await raf();
      const g = await ev("geom");
      const hits = await evaluate(`window.foldHits(${TOP},${BOTTOM},${xMax})`);
      const vis = [];
      for (const [i, b] of [[0, 0], [0, 1], [3, 0], [4, 3]]) vis.push(await ev("clickVisible", i, b));
      const errs = [];
      const sub = (n, fn) => {
        try {
          fn();
        } catch (e) {
          errs.push(n + "：" + e.message);
        }
      };
      sub("L3 位置", () => {
        assert.ok(g.pane, "推薦區不存在");
        assert.equal(g.pos, "fixed");
        assert.equal(g.parent, "BODY");
        assert.deepEqual(g.chain, [], "祖先鏈");
        near(g.pane.t, BOTTOM, "推薦區上緣＝摺痕下緣");
        near(g.pane.b, g.composer.t, "推薦區下緣＝輸入列上緣", 0.5);
        assert.ok(g.pane.t >= BOTTOM - 0.5 && g.pane.b <= g.composer.t + 0.5, "推薦區超出 [摺痕下緣, 輸入列上緣]");
        near(g.pane.l, 0, "推薦區左緣");
        near(g.pane.r, xMax, "推薦區右緣");
        assert.equal(g.z, "40");
        near(g.msgs.b, TOP, "訊息列表下緣＝摺痕上緣");
        near(g.composer.l, 0, "輸入列全寬（左）");
        near(g.composer.r, xMax, "輸入列全寬（右）");
        assert.equal(g.composerVar, Math.round(g.composer.h) + "px", "--chat-laptop-composer-height 未寫入量測值");
      });
      sub("L3 摺痕帶", () => assert.deepEqual(hits.slice(0, 5), [], "摺痕帶有可點元素"));
      sub("L4 卡片", () => {
        assert.equal(g.cards.length, opts.cards ?? 5);
        for (let k = 1; k < g.cards.length; k++) {
          near(g.cards[k].t, g.cards[0].t, `第 ${k + 1} 張卡片與第 1 張同一列`);
          assert.ok(g.cards[k].l >= g.cards[k - 1].r - 0.5, `卡片 ${k + 1} 未排在右側`);
        }
        assert.equal(g.scroll.ox, "auto");
        assert.ok(g.scroll.sw > g.scroll.cw + 200, "橫向可捲 " + JSON.stringify(g.scroll));
        assert.ok(g.cards[0].t >= g.pane.t - 0.5 && g.cards[0].b <= g.pane.b + 0.5, "卡片超出推薦區");
        for (const ph of g.photos) near(ph, 96, "照片高度 96px");
        assert.equal(g.cards[0].oy, "auto", "卡片可內捲");
        assert.ok(g.cards[0].sh > g.cards[0].ch, "fixture 卡片內容應超出卡片高度（驗證內捲）");
        assert.deepEqual([...new Set(g.headerP)], ["none"], "推薦區內重複的「推薦」小標應隱藏");
        assert.ok(g.title && g.title.t >= g.pane.t - 0.5 && g.title.b <= g.pane.b + 0.5, "「✦ 推薦」標題在推薦區內");
      });
      sub("L4 可點", () => {
        for (const v of vis) {
          assert.ok(v.ok && v.inPane, "按鈕被遮住或不在推薦區內：" + JSON.stringify(v));
          assert.ok(v.calls.length > 0, "點擊沒有呼叫 handler：" + JSON.stringify(v));
        }
        assert.ok(vis[2].scrollLeft > 0, "第 4 張卡片需要橫向捲動");
      });
      return { errs, g, label };
    };
    for (const [posture, xMax] of [["laptop", VW], ["laptopRail", VW - RAIL]]) {
      await ev("posture", posture);
      await unmountAll();
      await mount({ version: "cur", scenario: "base" });
      const r = await geomChecks(posture, xMax);
      check(`L3／L4 筆電（${posture}）：推薦區 fixed 在 [摺痕下緣, 輸入列上緣]、祖先鏈乾淨、摺痕帶無可點；卡片橫排可橫捲、照片 96px、可內捲、按鈕可點`, () => {
        assert.deepEqual(r.errs, []);
        console.log(`  （資訊）推薦區 [${r.g.pane.t}, ${r.g.pane.b}]、輸入列 [${r.g.composer.t}, ${r.g.composer.b}]、卡片 ${r.g.cards[0].w}×${r.g.cards[0].h}`);
      });
    }

    // ─── L5 卡片 HTML 與 handler 等價 ───
    await ev("posture", "laptop");
    for (const s of ["base", "selection", "saving"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      const html = [];
      const trace = [];
      for (let i = 0; i < 5; i++) {
        html.push(await ev("articleHtml", "pane", i));
        trace.push(await ev("trace", "pane", i));
      }
      check(`L5 筆電（${s}）：推薦區 5 張卡片 HTML 與手機訊息列逐字相同（內容不刪減）；按鈕／卡片點擊／Enter 的 handler 呼叫相同`, () => {
        assert.ok(phoneArt[s].html.every(Boolean));
        for (let i = 0; i < 5; i++) sameHtml(html[i], phoneArt[s].html[i], `第 ${i + 1} 張卡片 HTML 不同`);
        assert.deepEqual(trace, phoneArt[s].trace);
        assert.ok(trace.flat().some((t) => t.calls.length > 0), "trace 沒有任何 handler 呼叫（fixture 異常）");
        // 一般模式（非選取模式）卡片有「聊這裡」：必須呼叫 discuss handler（選取模式本來就沒有此按鈕）
        if (s === "base") assert.ok(trace.flat().some((t) => t.calls.some((c) => c[0] === "discuss")), "trace 缺少 discuss handler");
      });
    }

    // ─── L6 自動切最新／保留選擇／橫向捲回開頭 ───
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    await ev("clickTag", "a1");
    await mount({ version: "cur", scenario: "grownText" });
    const keepTags = await ev("tags");
    const keepPane = await ev("paneCards");
    await mount({ version: "cur", scenario: "base" });
    await ev("clickTag", "a3");
    await raf();
    const s0 = await ev("scrollPane", 400);
    await mount({ version: "cur", scenario: "grown" });
    await raf();
    const s1 = await ev("scrollPane");
    const autoTags = await ev("tags");
    const autoPane = await ev("paneCards");
    await ev("scrollPane", 400);
    await ev("clickTag", "a3");
    await raf();
    const s2 = await ev("scrollPane");
    check("L6a 筆電：只新增文字回覆時保留使用者選擇", () => {
      assert.equal(keepTags.a1.pressed, "true");
      assert.deepEqual(keepPane, ["A1", "A2"]);
    });
    check("L6b 筆電：新推薦出現時自動切到最新", () => {
      assert.equal(autoTags.a5.pressed, "true");
      assert.equal(autoTags.a3.pressed, "false");
      assert.deepEqual(autoPane, ["C1", "C2", "C3", "C4", "C5"]);
    });
    check("L6c 筆電：自動切換與手動切換後橫向捲動回到開頭", () => {
      assert.ok(s0 > 100, "無法橫向捲動 " + s0);
      assert.equal(s1, 0, "自動切到最新後未捲回開頭");
      assert.equal(s2, 0, "手動切換後未捲回開頭");
    });

    // ─── L7 輸入列高度改變 → ResizeObserver 更新推薦區下緣 ───
    await unmountAll();
    await mount({ version: "cur", scenario: "base", chips: true });
    await raf();
    const gA = await ev("geom");
    await mount({ version: "cur", scenario: "base", chips: false });
    await raf();
    await raf();
    const gB = await ev("geom");
    await mount({ version: "cur", scenario: "base", chips: true });
    await raf();
    await raf();
    const gC = await ev("geom");
    check("L7 筆電：快捷按鍵列消失／出現（輸入列高度改變）時推薦區下緣跟著輸入列上緣", () => {
      assert.ok(gB.composer.h < gA.composer.h - 10, "fixture：輸入列高度未改變 " + JSON.stringify([gA.composer.h, gB.composer.h]));
      for (const g of [gA, gB, gC]) near(g.pane.b, g.composer.t, "推薦區下緣＝輸入列上緣", 0.5);
      assert.equal(gB.composerVar, Math.round(gB.composer.h) + "px");
    });

    // ─── L8 鍵盤開：hidden、不卸載、捲動保留 ───
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    await raf();
    await ev("paneNode");
    await ev("scrollPane", 300);
    const before = await ev("scrollPane");
    const rowsN = await ev("rowNodes");
    await ev("setKb", true);
    await raf();
    const gK = await ev("geom");
    const kbHits = await evaluate(`(()=>{const p=document.querySelector('body > [data-chat-duo-rec-pane]').getBoundingClientRect();const e=document.elementFromPoint(p.left+p.width/2,p.top+20);return !!e&&!!e.closest('[data-chat-duo-rec-pane]')})()`);
    const samePaneKb = await ev("samePane");
    await ev("setKb", false);
    await raf();
    const gK2 = await ev("geom");
    const after = await ev("scrollPane");
    const samePaneAfter = await ev("samePane");
    const sameRows = await ev("sameRowNodes");
    check("L8 鍵盤開：推薦區 visibility hidden、不可點、同一節點；輸入列貼鍵盤且全寬；收起後恢復可見、捲動位置保留、訊息列不 remount", () => {
      assert.ok(rowsN > 0);
      assert.equal(gK.vis, "hidden");
      assert.equal(kbHits, false, "鍵盤開時推薦區仍可點");
      assert.equal(samePaneKb, true, "鍵盤開時推薦區被卸載／重建");
      near(gK.composer.b, VH - 320, "輸入列貼鍵盤");
      near(gK.composer.l, 0, "鍵盤開：輸入列左緣");
      near(gK.composer.r, VW, "鍵盤開：輸入列右緣（全寬）");
      assert.equal(gK2.vis, "visible");
      assert.equal(samePaneAfter, true);
      assert.ok(before > 100, "無法捲動 " + before);
      assert.equal(after, before, "捲動位置未保留");
      assert.equal(sameRows, true);
    });

    // ─── L9 無推薦／隱藏卡片 ───
    for (const s of ["noRecs", "generating", "suppress", "hydrating"]) {
      await unmountAll();
      await mount({ version: "cur", scenario: s });
      const c = await ev("snap");
      check(`L9 筆電（${s}）：推薦區不渲染、無標籤、訊息列 HTML 與 HEAD 相同`, () => {
        sameHtml(c.html, headSnaps[s].html);
        assert.ok(!c.body.some((b) => b.endsWith("[pane]")), "推薦區被渲染");
      });
    }

    // ─── L10 姿勢切換不 remount、雙頁優先 ───
    await ev("posture", "phone");
    await unmountAll();
    await ev("resetLogs");
    await mount({ version: "cur", scenario: "base" });
    const logsMount = await ev("logs");
    await ev("rowNodes");
    await ev("resetLogs");
    const seq = [];
    for (const p of ["laptop", "phone", "twoPane", "laptop", "laptopRail", "twoPane", "phone"]) {
      await ev("posture", p);
      seq.push({ p, same: await ev("sameRowNodes"), info: await ev("paneInfo"), tags: Object.keys(await ev("tags")) });
    }
    const logsSeq = await ev("logs");
    const finalSnap = await ev("snap");
    check("L10 姿勢切換 手機→筆電→手機→雙頁→筆電→筆電直欄→雙頁→手機：訊息列不 remount、不多出 log；雙頁優先；回手機後與 HEAD 相同", () => {
      assert.ok(logsMount.length > 0, "fixture：沒有 mount log");
      for (const s of seq) assert.equal(s.same, true, "訊息列被重建：" + s.p);
      assert.deepEqual(logsSeq, [], "姿勢切換多出 [CHAT_RECOMMENDATION_MOUNT] log");
      const expect = { laptop: "chat-laptop-rec", laptopRail: "chat-laptop-rec", twoPane: "chat-duo-rec-pane", phone: null };
      for (const s of seq) {
        if (expect[s.p] == null) {
          assert.deepEqual(s.info, [], "手機時不應有 portal");
          assert.deepEqual(s.tags, [], "手機時不應有標籤");
        } else {
          assert.equal(s.info.length, 1, s.p + " portal 數 " + s.info.length);
          assert.equal(s.info[0].cls, expect[s.p], s.p + " variant");
          assert.deepEqual(s.tags, ["a1", "a3"]);
        }
      }
      sameHtml(finalSnap.html, headSnaps.base.html);
    });

    // ─── L14 推薦區下緣精準＝輸入列上緣（底部導覽含 1px border）；下半部極矮時 box 不溢出輸入列（任務單 #H2b-2）───
    {
      const rows = [];
      for (const posture of ["laptop", "laptopRail"]) {
        await ev("posture", posture);
        for (const safe of [0, 20]) {
          await unmountAll();
          await mount({ version: "cur", scenario: "base" });
          const cb = await evaluate(`window.setEnv(${safe},${TOP},${BOTTOM})`);
          await raf();
          await raf();
          rows.push({ posture, safe, cb, g: await ev("geom") });
        }
      }
      await evaluate(`window.setEnv(0,${TOP},${BOTTOM})`);
      check("L14a 筆電（底部導覽／直欄 × safe-bottom 0／20）：推薦區下緣與輸入列上緣相差 ≤0.5px；輸入列 inline bottom 依 hook 公式＝底部導覽實測高度", () => {
        for (const { posture, safe, cb, g } of rows) {
          const tag = `${posture}/safe ${safe}`;
          near(g.pane.b, g.composer.t, `${tag} 推薦區下緣＝輸入列上緣`, 0.5);
          near(g.composer.b, VH - cb, `${tag} 輸入列 bottom`, 0.5);
          if (posture === "laptop") {
            assert.equal(cb, 69 + safe, `${tag} 底部導覽實測高度（68＋1px border＋safe）`);
            near(g.composer.b, g.nav.t, `${tag} 輸入列下緣＝底部導覽上緣`, 0.5);
          } else assert.equal(cb, safe, `${tag} 直欄時輸入列 bottom＝safe`);
        }
        console.log("  （資訊）" + rows.map((r) => `${r.posture}/safe${r.safe}: 推薦區下緣 ${r.g.pane.b}、輸入列上緣 ${r.g.composer.t}`).join("；"));
      });
    }
    {
      // 下半部（摺痕下緣～螢幕底）只有 200px、safe-bottom 20：推薦區可用高度極小（甚至為 0）
      const SHORT_BOTTOM = VH - 200;
      const SHORT_TOP = SHORT_BOTTOM - 40;
      const rows = [];
      for (const posture of ["laptop", "laptopRail"]) {
        await ev("posture", posture);
        for (const chips of [true, false]) {
          await unmountAll();
          await mount({ version: "cur", scenario: "base", chips });
          await evaluate(`window.setEnv(20,${SHORT_TOP},${SHORT_BOTTOM})`);
          await raf();
          await raf();
          const g = await ev("geom");
          // 輸入列範圍內每一點的最上層元素必須屬於輸入列（推薦區不疊在輸入列上）
          const hits = await evaluate(`(()=>{const c=document.querySelector('#composer').getBoundingClientRect();const out=[];for(let y=Math.ceil(c.top)+1;y<=Math.floor(c.bottom)-1;y+=4)for(let x=4;x<c.right;x+=24){const e=document.elementFromPoint(x,y);if(!e||!e.closest('#composer'))out.push({x,y,hit:e&&(e.tagName+'.'+String(e.className).slice(0,30))});}return out;})()`);
          const padTop = await evaluate(`parseFloat(getComputedStyle(document.querySelector('body > [data-chat-duo-rec-pane]')).paddingTop)`);
          rows.push({ posture, chips, g, hits, padTop });
        }
      }
      await evaluate(`window.setEnv(0,${TOP},${BOTTOM})`);
      check("L14b 筆電（下半部 200px、safe-bottom 20；底部導覽／直欄 × 快捷列有無）：推薦區 box 不溢出輸入列、上緣＝摺痕下緣、輸入列範圍內不被推薦區蓋住", () => {
        for (const { posture, chips, g, hits, padTop } of rows) {
          const tag = `${posture}/chips ${chips}`;
          near(g.pane.t, SHORT_BOTTOM, `${tag} 推薦區上緣＝摺痕下緣`, 0.5);
          assert.ok(g.pane.b <= g.composer.t + 0.5, `${tag} 推薦區 box 溢出輸入列：下緣 ${g.pane.b} > 輸入列上緣 ${g.composer.t}`);
          assert.ok(g.pane.h >= 0 && padTop <= Math.max(0, g.composer.t - SHORT_BOTTOM) + 0.5, `${tag} padding-top ${padTop} 超出可用高度`);
          assert.deepEqual(hits.slice(0, 5), [], `${tag} 輸入列範圍被其他元素蓋住（共 ${hits.length} 點；輸入列 ${JSON.stringify(g.composer)}、導覽 ${JSON.stringify(g.nav)}）`);
        }
        console.log("  （資訊）" + rows.map((r) => `${r.posture}/chips${r.chips}: 推薦區 [${r.g.pane.t}, ${r.g.pane.b}] padTop ${r.padTop}、輸入列上緣 ${r.g.composer.t}`).join("；"));
      });
    }

    // ─── L12 B0 對照：OLD CSS（移除推薦區與輸入列全寬規則）→ L3／L4 必須失敗 ───
    await ev("posture", "laptop");
    await unmountAll();
    await mount({ version: "cur", scenario: "base" });
    await ev("setCss", "old");
    const old = await geomChecks("old", VW);
    await ev("setCss", "new");
    check("L12 B0 對照：移除筆電聊聊第 2 版 CSS 時，L3 位置與 L4 卡片斷言會失敗（斷言有效）", () => {
      for (const k of ["L3 位置", "L4 卡片"]) assert.ok(old.errs.some((e) => e.startsWith(k)), k + " 應失敗：" + JSON.stringify(old.errs));
      console.log("  （資訊）OLD 失敗項：" + old.errs.map((e) => e.split("：")[0]).join("、"));
    });

    await unmountAll();
    // ─── L11 StrictMode（development build）───
    await load("/dev");
    await ev("posture", "laptop");
    await ev("setStrict", true);
    await mount({ version: "cur", scenario: "base" });
    await raf();
    const sInfo = await ev("paneInfo");
    const sGeom = await ev("geom");
    await ev("clickTag", "a1");
    const sPane = await ev("paneCards");
    await unmountAll();
    const sAfter = await ev("paneInfo");
    check("L11 StrictMode（development build）：只有一個推薦區 portal、輸入列高度已量測、切換正常、unmount 後移除", () => {
      assert.equal(sInfo.length, 1, "portal 數 " + sInfo.length);
      assert.equal(sGeom.composerVar, Math.round(sGeom.composer.h) + "px");
      near(sGeom.pane.b, sGeom.composer.t, "推薦區下緣＝輸入列上緣", 0.5);
      assert.deepEqual(sPane, ["A1", "A2"]);
      assert.deepEqual(sAfter, []);
    });

    check("L13 瀏覽器無例外、無外部網路請求", () => {
      assert.deepEqual(browserErrors, []);
      assert.deepEqual(externalRequests, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    server.closeAllConnections?.();
    stop();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

if (failures.length) {
  console.log(`\nverify-chat-duo-laptop-rec-pane: FAIL（${failures.length}）\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log("\nverify-chat-duo-laptop-rec-pane: PASS");
