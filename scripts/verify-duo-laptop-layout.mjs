// verify-duo-laptop-layout.mjs — iPhone Duo 筆電半開：行程頁 CSS 版型量測（任務單 #H2a-2）
//
// Part A（靜態）：styles.css 的 html.duo-laptop 區塊
//   - 行程頁段落每個 selector 逐一相符、以 html.duo-laptop.trip-detail-route-active 開頭（只命中行程頁筆電姿勢）；
//     聊聊／探索段落（#H2b-1）只允許列舉的前綴（見 A2；版面量測見 verify-duo-laptop-chat-explore.mjs）
//     收藏／首頁／我的段落（#H2b-3）selector 逐字列舉（見 A2 SHP_SELECTORS；量測見 verify-duo-laptop-saved-home-profile.mjs）；
//     #H2b-5：首頁／我的版面規則已移除，A2b 檢查不得殘留
//   - styles.css 相對功能 commit 前基準 aa2db59（PRE_FEATURE_BASE）只有新增、沒有刪除
//   - 區塊位置在「地點詳情頁雙頁」區塊之前
// Part B（headless Chrome）：以目前 styles.css 編譯 Tailwind，靜態 DOM fixture（class 字串取自
//   _app.tsx／MobileFrame／TripDetailScreen／SavedTripItineraryEditor／TripWorkspaceMap／ui/*），
//   viewport 669×951、--duo-hinge-top 455.5px、--duo-hinge-bottom 495.5px 量測：
//   （#DT1-T 改寫：筆電／直向攤平行程頁改一頁式；舊的上下分頁 B1／B2／B2b／B3／B3b／B7／B7b／B0 已改為下列一頁式斷言）
//   B1 一頁式捲動容器 [0, 底部導覽上緣]、main 頂部內距 0、封面頂端 0 且 3:2（筆電／直向攤平 × safe-area-bottom 0／20）
//   B1d 返回／分享 top＝狀態列＋0.75rem、更換封面右下、底板顯示；B1c 右側直欄；B1b 按鈕可點
//   B2 地圖分頁在捲動容器內（與手機相同）；B3 摺痕帶可點元素僅資訊（一頁式允許）
//   B4 浮層：筆電時置中對話框、底部 sheet 不跨摺痕（規則保留）；B4f 直向攤平置中於整個畫面
//   B5 非筆電（無 duo-laptop class）：版型與未加規則時相同；B5c 單欄地圖分頁仍在捲動容器內
//   B6 無外部請求；B0 TripDetailScreen 不輸出 .trip-duo-laptop-map
//   A5 筆電規則在 @layer 外；styles.css 最後一條規則屬 .place-duo-root
//
// 限制：不渲染真實 React 元件；React 實際 render／姿勢切換不 remount 見 verify-duo-laptop-trip-render.mjs。
// 執行：node scripts/verify-duo-laptop-layout.mjs（不讀 .env、不連網）

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// #TS-BASE：功能 commit（943a047…）之前的基準 commit。功能已 commit 進 HEAD 後，「相對 HEAD 只新增」會因 diff 為空而失效，
//   改以此基準比對（日後基準前移時只改這一行）。
const PRE_FEATURE_BASE = "aa2db59";
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
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

// ───────────────────────── Part A：靜態 ─────────────────────────
const blockStart = styles.indexOf(" * iPhone Duo 筆電半開（橫向摺痕）");
const placeStart = styles.indexOf(" * 地點詳情頁雙頁");
check("A1 筆電區塊存在且位於地點詳情雙頁區塊之前", () => {
  assert.ok(blockStart > 0, "找不到筆電區塊註解");
  assert.ok(placeStart > blockStart, "筆電區塊必須在地點詳情雙頁區塊之前");
});
const block = styles.slice(styles.lastIndexOf("/*", blockStart), styles.lastIndexOf("/*", placeStart));
const blockRules = block.replace(/\/\*[\s\S]*?\*\//g, "");
const selectors = [...blockRules.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) =>
  m[1].split(",").map((s) => s.trim()).filter(Boolean),
);
// #H2b-1-T：筆電區塊另含聊聊（/chat）與探索（/map）規則（區塊註解「筆電半開＋聊聊」之後）。
//   行程頁段落（區塊開頭～聊聊段落）：selector 必須逐一等於下列清單（前綴與內容都嚴格檢查）。
//   聊聊／探索段落：selector 只能以下列列舉的前綴開頭（不放寬成任意 html.duo-laptop）。
const TRIP_SELECTORS = [
  "html.duo-laptop.trip-detail-route-active .trip-detail-route",
  "html.duo-laptop.trip-detail-route-active .trip-detail-cover > div",
  'html.duo-laptop.trip-detail-route-active .trip-detail-cover > div > [class*="aspect-[3/2]"]',
  "html.duo-laptop.trip-detail-route-active .trip-duo-laptop-map",
  'html.duo-laptop.trip-detail-route-active .trip-duo-laptop-map [class*="min-h-[320px]"]',
  'html.duo-laptop.trip-detail-route-active [role="dialog"][class*="translate-y-[-50%]"]',
  'html.duo-laptop.trip-detail-route-active [role="alertdialog"][class*="translate-y-[-50%]"]',
  'html.duo-laptop.trip-detail-route-active [data-vaul-drawer][data-vaul-drawer-direction="bottom"]',
  'html.duo-laptop.trip-detail-route-active [role="dialog"][class*="slide-in-from-bottom"]',
  'html.duo-laptop.trip-detail-route-active [data-vaul-drawer][data-vaul-drawer-direction="top"]',
  'html.duo-laptop.trip-detail-route-active [role="dialog"][class*="slide-in-from-top"]',
  'html.duo-laptop.trip-detail-route-active [role="dialog"][class*="slide-in-from-right"]',
  'html.duo-laptop.trip-detail-route-active [role="dialog"][class*="slide-in-from-left"]',
  // #DT1-T：行程頁改一頁式＋封面延伸（筆電／直向攤平成對；舊筆電規則以同選擇器在後覆寫，見 verify-duo-laptop-trip-render.mjs）
  "html.duo-laptop.trip-detail-route-active",
  "html.duo-flat-portrait.trip-detail-route-active",
  "html.duo-laptop.trip-detail-route-active main.app-scroll",
  "html.duo-flat-portrait.trip-detail-route-active main.app-scroll",
  "html.duo-laptop.trip-detail-route-active .trip-detail-route",
  "html.duo-laptop.trip-detail-route-active .trip-detail-cover > div",
  'html.duo-laptop.trip-detail-route-active .trip-detail-cover > div > [class*="aspect-[3/2]"]',
  "html.duo-laptop.trip-detail-route-active .trip-detail-cover > div > div.top-3",
  "html.duo-flat-portrait.trip-detail-route-active .trip-detail-cover > div > div.top-3",
  "html.duo-laptop.trip-detail-route-active .trip-detail-root > .sticky.top-0",
  "html.duo-flat-portrait.trip-detail-route-active .trip-detail-root > .sticky.top-0",
  ".trip-duo-status-backdrop",
  "html.duo-laptop.trip-detail-route-active .trip-detail-root > .trip-duo-status-backdrop",
  "html.duo-flat-portrait.trip-detail-route-active .trip-detail-root > .trip-duo-status-backdrop",
];
// #H2b-1-T 第 2 輪：聊聊第 2 版（下半部推薦區 .chat-laptop-rec、輸入列全寬）與探索規則改為 map-route-active 路由限定。
//   舊的「html.duo-laptop .map-page」「html.duo-laptop:not(.map-keyboard-open) …」（未限定路由）已移除，不再允許。
const CHAT_MAP_PREFIXES = [
  "html.duo-laptop.chat-route-active:not(.chat-keyboard-open) .messenger-chat-messages",
  "html.duo-laptop.chat-route-active .messenger-chat-composer",
  "html.duo-laptop.chat-route-active .chat-laptop-rec",
  "html.duo-laptop.chat-route-active .chat-laptop-rec__scroll",
  "html.duo-laptop.chat-route-active [",
  "html.duo-laptop.map-route-active [",
  "html.duo-laptop.map-route-active .map-page",
  // #H3-1-T：探索頁鍵盤整塊上滑（map-keyboard-open）、開合動畫（duo-map-kb-anim）、地點詳情一頁式（duo-map-detail-page），
  //   以及直向攤平（duo-flat-portrait，與筆電規則逐條成對，見 verify-duo-explore-keyboard-flat.mjs A7）。
  //   舊的「:not(.map-keyboard-open) .map-page > .map-stage > .z-10」規則已改寫為無 :not 的版本＋鍵盤展開覆寫，故移除。
  "html.duo-flat-portrait.map-route-active .map-page",
  "html.duo-laptop.map-route-active.map-keyboard-open .map-page",
  "html.duo-flat-portrait.map-route-active.map-keyboard-open .map-page",
  "html.duo-laptop.map-route-active.duo-map-kb-anim .map-page",
  "html.duo-flat-portrait.map-route-active.duo-map-kb-anim .map-page",
  "html.duo-laptop.map-route-active.duo-map-detail-page .map-page",
  "html.duo-flat-portrait.map-route-active.duo-map-detail-page .map-page",
];
// 只允許逐字相同（不接受其後代 selector）
const CHAT_MAP_EXACT = [
  "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec",
  // #H3-1-T：有搜尋建議（搜尋列外層第 2 個子元素）時隱藏面板內容
  'html.duo-laptop.map-route-active.map-keyboard-open .map-page:has(> .map-stage > .z-10 > div > div:nth-child(2)) > .map-sheet-layer [data-map-explore-sheet="true"]',
  'html.duo-flat-portrait.map-route-active.map-keyboard-open .map-page:has(> .map-stage > .z-10 > div > div:nth-child(2)) > .map-sheet-layer [data-map-explore-sheet="true"]',
  // #H3-2-T2：內容外層 overflow visible（頂端不露底，由 main 裁切）；逐字列舉，理由見 verify-duo-laptop-chat-explore.mjs A3
  "html.duo-laptop.map-route-active main.app-scroll > div",
  "html.duo-flat-portrait.map-route-active main.app-scroll > div",
];
// #H2b-3-T：收藏（/saved）、首頁（/）、我的（/profile）段落（區塊註解「筆電半開＋收藏（/saved」之後到筆電區塊結尾）。
//   selector 必須逐一等於下列清單（逐字比對，不用前綴）。收藏頁版面規則以頁面 class .saved-laptop-root
//   （只在筆電時輸出）限定；浮層以三個 *-laptop-active 限定。
// #H2b-5-T：首頁／我的在筆電改回一頁式捲動，其版面規則（home-laptop-root／-bottom、profile-laptop-root／-card／-plus）已移除，
//   清單只剩收藏版面＋三頁浮層＋裁切例外；另以 A2b 檢查已移除的 selector 不得再出現。
const SHP_OVERLAY_TAILS = [
  ' [role="dialog"][class*="translate-y-[-50%]"]',
  ' [role="alertdialog"][class*="translate-y-[-50%]"]',
  ' [data-vaul-drawer][data-vaul-drawer-direction="bottom"]',
  ' [role="dialog"][class*="slide-in-from-bottom"]',
  ' [data-vaul-drawer][data-vaul-drawer-direction="top"]',
  ' [role="dialog"][class*="slide-in-from-top"]',
  ' [role="dialog"][class*="slide-in-from-right"]',
  ' [role="dialog"][class*="slide-in-from-left"]',
];
const SHP_OVERLAY_GROUPS = [
  [0, 2],
  [2, 4],
  [4, 6],
  [6, 8],
];
const SHP_SELECTORS = [
  "html.duo-laptop .saved-laptop-root",
  "html.duo-laptop .saved-laptop-root > .saved-duo-header",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:first-child",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:last-child",
  // #H2b-4 第 2 輪：收藏下半部讓出導覽 1px 上框線、空白提示卡縮小留白
  "html.duo-laptop .saved-laptop-root",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:last-child > .border-dashed",
  // 浮層：每組依 saved → home → profile 順序
  ...SHP_OVERLAY_GROUPS.flatMap(([a, b]) =>
    ["saved", "home", "profile"].flatMap((p) => SHP_OVERLAY_TAILS.slice(a, b).map((t) => `html.duo-laptop.${p}-laptop-active${t}`)),
  ),
  // #H2b-4 第 2 輪：我的頁裁切編輯器（唯一 h-[92dvh] 底部 Sheet）維持手機全高
  'html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]',
];
const chatMapStart = block.indexOf(" * 筆電半開＋聊聊（/chat");
const shpStart = block.indexOf(" * 筆電半開＋收藏（/saved");
const tripPart = chatMapStart > 0 ? block.slice(0, block.lastIndexOf("/*", chatMapStart)) : block;
const chatMapPart =
  chatMapStart > 0 ? block.slice(block.lastIndexOf("/*", chatMapStart), shpStart > 0 ? block.lastIndexOf("/*", shpStart) : undefined) : "";
const shpPart = shpStart > 0 ? block.slice(block.lastIndexOf("/*", shpStart)) : "";
const selOf = (s) =>
  [...s.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
check("A2 行程頁段落 selector 逐一相符（html.duo-laptop.trip-detail-route-active）；聊聊／探索段落只用列舉前綴", () => {
  assert.ok(selectors.length >= 10, "selector 數量異常：" + selectors.length);
  const tripSels = selOf(tripPart);
  assert.deepEqual(tripSels, TRIP_SELECTORS, "行程頁段落 selector 與預期不同");
  assert.ok(
    tripSels.every((s) => /^html\.duo-(laptop|flat-portrait)\.trip-detail-route-active($| )/.test(s) || s === ".trip-duo-status-backdrop"),
    "行程頁段落 selector 未限定筆電／直向攤平＋行程頁",
  );
  const other = selOf(chatMapPart);
  const shpSels = selOf(shpPart);
  assert.ok(chatMapStart > 0 && shpStart > chatMapStart, "收藏／首頁／我的段落必須在聊聊／探索段落之後");
  assert.deepEqual(shpSels, SHP_SELECTORS, "收藏／首頁／我的段落 selector 與預期不同（逐字比對）");
  assert.deepEqual(tripSels.length + other.length + shpSels.length, selectors.length, "筆電區塊 selector 未全部歸類");
  // 收藏／首頁／我的的規則不得出現在其他段落
  assert.ok(
    [...tripSels, ...other].every((s) => !/saved-laptop|home-laptop|profile-laptop/.test(s)),
    "收藏／首頁／我的規則出現在行程或聊聊／探索段落",
  );
  const bad = other.filter(
    (s) => !CHAT_MAP_EXACT.includes(s) && !CHAT_MAP_PREFIXES.some((p) => s === p || s.startsWith(p.endsWith("[") ? p : p + " ")),
  );
  assert.deepEqual(bad, [], "聊聊／探索段落有未列舉前綴的 selector");
  // 每個列舉項目都必須實際用到（避免白名單殘留過期項目）
  const unused = [...CHAT_MAP_PREFIXES, ...CHAT_MAP_EXACT].filter(
    (p) => !other.some((s) => s === p || (!CHAT_MAP_EXACT.includes(p) && s.startsWith(p.endsWith("[") ? p : p + " "))),
  );
  assert.deepEqual(unused, [], "白名單有未使用的項目");
  // 聊聊／探索段落的每個 selector 都必須限定路由（chat-route-active 或 map-route-active）
  // duo-flat-portrait 只用於探索頁（map-route-active）
  assert.deepEqual(other.filter((s) => !/^html\.(duo-laptop\.(chat|map)|duo-flat-portrait\.map)-route-active[\s.:[]/.test(s)), [], "未限定路由的 selector");
  // 白名單自我檢查：下列 selector 必須被判為不合法（證明白名單沒有放寬）
  const allowed = (s) => CHAT_MAP_EXACT.includes(s) || CHAT_MAP_PREFIXES.some((p) => s === p || s.startsWith(p.endsWith("[") ? p : p + " "));
  for (const s of [
    "html.duo-laptop .map-page",
    "html.duo-laptop .map-page > .map-stage",
    "html.duo-laptop:not(.map-keyboard-open) .map-page > .map-stage > .z-10",
    "html.duo-laptop .chat-laptop-rec",
    "html.duo-laptop.chat-route-active.chat-keyboard-open .chat-laptop-rec .x",
    "html.duo-laptop.chat-route-active .chat-laptop-recx",
    "html.duo-laptop.chat-route-active .messenger-chat-composerx",
    "html.duo-laptop.chat-route-active main",
    "html.duo-laptop.map-route-active main",
    "html.duo-flat-portrait .map-page",
    "html.duo-flat-portrait.chat-route-active .messenger-chat-composer",
    "html.duo-flat-portrait.map-route-active main",
    "html.duo-laptop.map-route-active.map-keyboard-open main",
    "html.duo-laptop.map-route-active.duo-map-kb-anim main",
    "html.duo-laptop.map-route-active.map-keyboard-open .map-page:has(.x)",
    'html.duo-laptop.map-route-active.map-keyboard-open .map-page:has(> .map-stage > .z-10 > div > div:nth-child(2)) > .map-sheet-layer [data-map-explore-sheet="true"] .x',
    "html.duo-laptop.map-route-active main.app-scroll",
    "html.duo-laptop.map-route-active main.app-scroll > div > div",
    "html.duo-laptop.map-route-active main.app-scroll > div .x",
    "html.duo-flat-portrait.map-route-active main.app-scroll > div *",
    "html.duo-laptop main.app-scroll > div",
    "html.duo-laptop.chat-route-active main.app-scroll > div",
    "html.duo-laptop.map-route-active.map-keyboard-open main.app-scroll > div",
  ])
    assert.equal(allowed(s), false, "白名單過寬，接受了：" + s);
  assert.ok(other.every((s) => !/trip-detail-route-active/.test(s)), "行程頁規則不得出現在聊聊／探索段落");
});
// #H2b-5-T：首頁／我的的筆電版面規則已移除（改回一頁式捲動），不得以任何形式殘留
check("A2b 首頁／我的筆電版面 selector 不得存在（home-laptop-root／-bottom、profile-laptop-root／-card／-plus）；*-laptop-active 只用於浮層", () => {
  const all = selOf(styles);
  assert.deepEqual(all.filter((s) => /\.home-laptop-(root|bottom)\b|\.profile-laptop-(root|card|plus)\b/.test(s)), [], "殘留首頁／我的版面 selector");
  assert.doesNotMatch(styles.replace(/\/\*[\s\S]*?\*\//g, ""), /home-laptop-root|home-laptop-bottom|profile-laptop-root|profile-laptop-card|profile-laptop-plus/);
  const tails = new Set(SHP_OVERLAY_TAILS);
  const homeProfile = all.filter((s) => /\b(home|profile)-laptop-active\b/.test(s));
  const nonOverlay = homeProfile.filter(
    (s) => !tails.has(s.replace(/^html\.duo-laptop\.(home|profile)-laptop-active/, "")) && s !== 'html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]',
  );
  assert.deepEqual(nonOverlay, [], "home-/profile-laptop-active 用於浮層以外的規則");
  assert.equal(homeProfile.length, 17, "home/profile 浮層 selector 數（8＋8＋裁切例外 1）");
});
check("A3 duo-laptop 與 --duo-hinge-* 只出現在筆電區塊內", () => {
  const outside = styles.slice(0, styles.lastIndexOf("/*", blockStart)) + styles.slice(styles.lastIndexOf("/*", placeStart));
  assert.doesNotMatch(outside, /duo-laptop|--duo-hinge-/);
});
check("A5 筆電區塊規則全在 @layer 外；styles.css 最後一條規則屬 .place-duo-root 區塊", () => {
  const nc = styles.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  const depthAt = (i) => {
    let d = 0;
    for (const ch of nc.slice(0, i)) d += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    return d;
  };
  const rules = [...nc.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  const laptopRules = rules.filter((m) => /html\.duo-laptop/.test(m[1]));
  assert.ok(laptopRules.length >= 5, "筆電規則數量：" + laptopRules.length);
  for (const m of laptopRules) assert.equal(depthAt(m.index), 0, "規則位於 @layer／其他區塊內：" + m[1].trim().slice(0, 80));
  const last = rules[rules.length - 1];
  assert.match(last[1], /\.place-duo-root/, "最後一條規則：" + last[1].trim().slice(0, 120));
  assert.equal(depthAt(last.index), 0);
});
check(`A4 styles.css 相對功能 commit 前基準 ${PRE_FEATURE_BASE} 只有新增、沒有刪除`, () => {
  // 比對「工作區」與基準：涵蓋已 commit 的功能與任何未 commit 修改；numstat 為空（未新增任何規則）時 removed 為 undefined → 失敗
  const numstat = execFileSync("git", ["diff", "--numstat", PRE_FEATURE_BASE, "--", "src/styles.css"], { cwd: root, encoding: "utf8" }).trim();
  const [, removed] = numstat.split(/\s+/);
  assert.equal(removed, "0", numstat);
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

const ALERT_CLS =
  "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg";
const SHEET_CLS =
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom";
const DRAWER_CLS =
  "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background z-[60] mx-auto max-w-lg rounded-t-[1.75rem] border-0 bg-cream";

const card = (i) =>
  `<div class="mt-3 rounded-2xl border border-border bg-card p-4"><p>Stop ${i}</p><button type="button" class="mt-2 rounded-full bg-secondary px-3 py-2 text-xs" data-btn="stop-${i}">edit ${i}</button></div>`;

const FIXTURE = `
<div class="mobile-frame-outer flex min-h-[100dvh] w-full justify-center bg-[oklch(0.93_0.02_75)] grain md:bg-transparent">
 <div class="mobile-frame-inner relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
   <main class="app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)] pb-[var(--app-nav-total-height)] min-h-0 flex-1 overflow-hidden">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" id="content">
     <div id="route" class="trip-detail-route flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain no-scrollbar">
      <div class="trip-detail-root w-full">
       <div class="trip-detail-cover" id="cover">
        <div class="relative aspect-[3/2] w-full overflow-hidden" id="coverBox">
         <div class="pointer-events-none aspect-[3/2] w-full select-none" style="background:#bbb"></div>
         <div class="pointer-events-auto absolute left-3 top-3"><button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 backdrop-blur" data-btn="back">b</button></div>
         <div class="pointer-events-auto absolute right-3 top-3"><button type="button" data-btn="share" class="h-9 w-9">s</button></div>
         <button type="button" data-btn="cover" class="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs backdrop-blur">cover</button>
        </div>
       </div>
       <header class="border-b border-border px-5 pb-3 pt-3" id="header">
        <div class="mt-1 flex items-start gap-2"><h1 class="min-w-0 flex-1 font-display text-[22px] leading-snug">Trip title</h1>
        <button type="button" data-btn="title" class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">e</button></div>
        <button type="button" data-btn="date" class="mt-1 text-sm text-muted-foreground">2026/11/01 - 2026/11/03</button>
       </header>
       <div aria-hidden="true" class="trip-duo-status-backdrop" id="backdrop"></div><div aria-hidden="true" class="h-0 w-full"></div><div class="sticky top-0 z-20 bg-background px-5 pb-1 pt-3" id="bar"><div role="tablist" class="flex gap-2"><button role="tab" type="button" data-btn="tab-trip">trip</button><button role="tab" type="button" data-btn="tab-overview">overview</button></div></div>
       <div class="px-5 pt-3" style="transform: var(--trip-ws-transform, none)" id="tripPane">
        ${Array.from({ length: 14 }, (_, i) => card(i)).join("")}
       </div>
       INLINEMAP
      </div>
     </div>
     HOSTMAP
    </div>
   </main>
   <nav id="nav" class="NAVCLASS"><ul class="flex h-[var(--bottom-nav-height,4.25rem)] items-center justify-between px-2"><li class="flex-1"><a href="#" data-btn="nav">n</a></li></ul></nav>
  </div>
 </div>
</div>`;

// TripWorkspaceMap（layout="pane"）的 DOM：日別 chips＋地圖框（class 字串取自 TripWorkspaceMap.tsx）
const MAP_BODY = `<div class="flex flex-1 flex-col pb-3">
         <div role="group" id="chips" class="flex gap-2 overflow-x-auto px-5 py-3 no-scrollbar"><button type="button" data-btn="chip-all" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background">all</button><button type="button" data-btn="chip-d1" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-foreground">D1</button></div>
         <div id="mapBox" data-no-page-swipe class="relative mx-3 min-h-[320px] flex-1 overflow-hidden rounded-2xl border border-border"><div style="position:absolute;inset:0;background:#9cf"></div>
          <div class="absolute inset-x-3 bottom-9 rounded-2xl border border-border bg-card p-4 shadow-lg"><button type="button" data-btn="map-card">details</button></div>
         </div>
        </div>`;
// 單欄（非筆電）：地圖分頁節點在捲動容器內（TripDetailScreen 的 tabpanel，隱藏時 className="hidden"）
const INLINE_MAP = (cls) =>
  `<div id="map" role="tabpanel" class="${cls}" style="transform: var(--trip-ws-transform, none)">${MAP_BODY}</div>`;
// 筆電：TripDetailScreen 在捲動容器之後渲染的兄弟 host（portal 目標）
const HOST_MAP = `<div id="map" role="region" aria-label="地圖" data-no-page-swipe class="trip-duo-laptop-map">${MAP_BODY}</div>`;
// 舊結構（修正前）：筆電地圖仍是捲動容器的子孫，只換 className。僅供 B0 對照。
const LEGACY_MAP = INLINE_MAP("trip-duo-laptop-map");

const NAV_BOTTOM =
  "bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl pb-[var(--safe-area-bottom)] transition-[opacity,transform] duration-200";
const NAV_RAIL = "app-right-rail fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-border bg-card/95 backdrop-blur-xl";

const PAGE_JS = `
window.FIXTURE=${JSON.stringify(FIXTURE)};
window.HOST_MAP=${JSON.stringify(HOST_MAP)};
window.LEGACY_MAP=${JSON.stringify(LEGACY_MAP)};
window.INLINE_MAP=${JSON.stringify(INLINE_MAP("__CLS__"))};
window.setup=(o)=>{
  const h=document.documentElement;
  h.className='native-shell'+(o.route?' trip-detail-route-active':'')+(o.laptop?' duo-laptop':'')+(o.flat?' duo-flat-portrait':'')+(o.rail?' duo-rail':'');
  h.removeAttribute('style');
  h.style.setProperty('--safe-area-bottom',(o.safeBottom||0)+'px');
  h.style.setProperty('--safe-area-top',(o.safeTop||0)+'px');
  if(o.laptop||o.flat){h.style.setProperty('--duo-hinge-top',o.top+'px');h.style.setProperty('--duo-hinge-bottom',o.bottom+'px');}
  if(o.rail){h.style.setProperty('--bottom-nav-height','0.01px');h.style.setProperty('--app-rail-width','64px');}
  // o.map：'host'＝筆電新結構（捲動容器的兄弟）；'legacy'＝修正前結構（捲動容器的子孫）；其餘為單欄 tabpanel 的 className
  const inline=o.map==='host'?'':o.map==='legacy'?window.LEGACY_MAP:window.INLINE_MAP.replace('__CLS__',o.map);
  let html=window.FIXTURE.replace('INLINEMAP',inline).replace('HOSTMAP',o.map==='host'?window.HOST_MAP:'').replace('NAVCLASS',o.rail?'${NAV_RAIL}':'${NAV_BOTTOM}');
  document.getElementById('root').innerHTML=html;
  if(o.rail){const n=document.getElementById('nav');n.style.width='var(--app-rail-width)';
    document.querySelector('main').style.paddingRight='var(--app-rail-width)';document.getElementById('content').style.setProperty('--safe-area-right','0px');}
  if(o.drag){document.getElementById('route').style.setProperty('--trip-ws-transform','translate3d(40px,0,0)');}
  document.getElementById('overlays').innerHTML=o.overlays||'';
  return true;
};
const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
window.measure=()=>{const q=s=>document.querySelector(s);const route=q('#route');
  return {vw:innerWidth,vh:innerHeight,route:R(route),routePos:getComputedStyle(route).position,routeScroll:{sh:route.scrollHeight,ch:route.clientHeight},
   map:R(q('#map')),mapBox:R(q('#mapBox')),chips:R(q('#chips')),cover:R(q('#coverBox')),header:R(q('#header')),bar:R(q('#bar')),nav:R(q('#nav')),
   back:R(q('[data-btn=back]')),share:R(q('[data-btn=share]')),coverBtn:R(q('[data-btn=cover]')),mainPadTop:getComputedStyle(q('main')).paddingTop,
   backdrop:{display:getComputedStyle(q('#backdrop')).display,h:q('#backdrop').offsetHeight},hostCount:document.querySelectorAll('.trip-duo-laptop-map').length,
   alert:R(q('#alert')),sheet:R(q('#sheet')),drawer:R(q('#drawer')),
   mapTransform:getComputedStyle(q('#map')).transform};};
window.foldHits=(top,bottom)=>{const out=[];const ys=[];for(let y=Math.ceil(top)+1;y<bottom;y+=3)ys.push(y);
  for(const y of ys)for(let x=2;x<innerWidth;x+=16){const el=document.elementFromPoint(x,y);const hit=el&&el.closest('button,a[href],input,textarea,select,[role=tab],[tabindex]');
   if(hit)out.push({x,y,btn:hit.getAttribute('data-btn')||hit.tagName});}
  return out;};
// 地圖節點的結構檢查：是否在捲動容器內、祖先鏈有無 fixed 包含塊（transform 等）或 overflow 捲動容器
window.mapChain=()=>{const map=document.getElementById('map');const route=document.getElementById('route');const bad=[];const hidden=[];
 for(let a=map.parentElement;a;a=a.parentElement){const cs=getComputedStyle(a);const name=a.tagName.toLowerCase()+(a.id?'#'+a.id:'');const b=[];
  if(cs.transform!=='none')b.push('transform:'+cs.transform);
  for(const k of ['translate','rotate','scale'])if(cs[k]&&cs[k]!=='none')b.push(k+':'+cs[k]);
  if(cs.filter!=='none')b.push('filter:'+cs.filter);
  if(cs.backdropFilter&&cs.backdropFilter!=='none')b.push('backdrop-filter:'+cs.backdropFilter);
  if(cs.perspective!=='none')b.push('perspective:'+cs.perspective);
  if(cs.contain!=='none')b.push('contain:'+cs.contain);
  if(cs.willChange!=='auto')b.push('will-change:'+cs.willChange);
  if(cs.containerType&&cs.containerType!=='normal')b.push('container-type:'+cs.containerType);
  if(/auto|scroll|overlay/.test(cs.overflowX+' '+cs.overflowY))b.push('overflow:'+cs.overflowX+'/'+cs.overflowY);
  if(b.length)bad.push(name+' -> '+b.join(', '));
  if(/hidden|clip/.test(cs.overflowX+' '+cs.overflowY))hidden.push(name);}
 return {inRoute:route.contains(map),siblingOfRoute:map.parentElement===route.parentElement,afterRoute:!!(route.compareDocumentPosition(map)&Node.DOCUMENT_POSITION_FOLLOWING),
  role:map.getAttribute('role'),noSwipe:map.hasAttribute('data-no-page-swipe'),pos:getComputedStyle(map).position,bad,hidden};};
window.mapHits=()=>{const map=document.getElementById('map');return [...map.querySelectorAll('[data-btn]')].map(b=>{const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {k:b.getAttribute('data-btn'),ok:!!e&&b.contains(e)};});};
window.btnRects=()=>[...document.querySelectorAll('#route [data-btn]')].map(b=>({k:b.getAttribute('data-btn'),...R(b)}));
window.hitAll=()=>{const route=document.getElementById('route');const bad=[];
 for(const el of route.querySelectorAll('#tripPane [data-btn], #header [data-btn], #cover [data-btn], #bar [data-btn]')){el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect();
  const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);if(!hit||!el.contains(hit))bad.push({k:el.getAttribute('data-btn'),t:b.top,hit:hit&&(hit.id||hit.tagName)});}
 route.scrollTop=0;return bad;};
window.__ready=true;
`;

if (!chromeBin) {
  failures.push("B 無可用 Chrome");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器量測");
} else {
  await runBrowser();
}

async function runBrowser() {
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-laptop-"));
  fs.writeFileSync(path.join(dir, "fixture.html"), FIXTURE + ALERT_CLS + SHEET_CLS + DRAWER_CLS + NAV_BOTTOM + NAV_RAIL);
  const cssSrc = styles.replace(/^@import url\([^\n]*\n/m, "");
  const compiler = await compile(cssSrc, { base: path.join(root, "src"), onDependency() {} });
  const scanner = new Scanner({
    sources: [...compiler.sources, { base: dir, pattern: "**/*", negated: false }],
  });
  const css = compiler.build(scanner.scan());
  assert.match(css, /html\.duo-laptop\.trip-detail-route-active/, "編譯後 CSS 缺少 duo-laptop 規則");

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
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
        css +
        '</style></head><body style="margin:0"><div id="root"></div><div id="overlays"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
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
    await call("Emulation.setDeviceMetricsOverride", { width: 669, height: 951, deviceScaleFactor: 1, mobile: true });
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++)
      await new Promise((r) => setTimeout(r, 100));

    const TOP = 455.5;
    const BOTTOM = 495.5;
    const NAV_H = 68; // --bottom-nav-height 4.25rem
    const overlays = `<div role="alertdialog" id="alert" class="${ALERT_CLS}"><p>Delete?</p><button type="button">ok</button></div>`;
    const setup = (o) => evaluate("window.setup(" + JSON.stringify(o) + ")");
    const measure = () => evaluate("window.measure()");
    const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.6, `${msg}: ${a} vs ${b}`);

    // #DT1-T：筆電（duo-laptop）與直向攤平（duo-flat-portrait）行程頁改為一頁式（與一般 iPhone 相同）：
    //   舊 B1（捲動容器固定在下半部）、B2／B7／B7b／B2b（上半部 host 地圖）、B3／B3b（摺痕帶無可點元素）、B0（host 對照）
    //   與新需求衝突，改寫為一頁式量測；摺痕帶可點元素改為資訊（一頁式允許，同首頁／我的）。
    //   B4／B4b（浮層不跨摺痕）規則保留，斷言不變。React 真實 render 見 verify-duo-laptop-trip-render.mjs。
    const SAFE_TOP = 24;
    for (const [kind, flag] of [["筆電", { laptop: true }], ["直向攤平", { flat: true }]]) {
      for (const safeBottom of [0, 20]) {
        const tag = `${kind} safe-bottom=${safeBottom}`;
        await setup({ route: true, ...flag, top: TOP, bottom: BOTTOM, safeBottom, safeTop: SAFE_TOP, map: "hidden", overlays });
        const m = await measure();
        check(`B1 ${tag}：一頁式捲動容器 [0, 底部導覽上緣]、main 頂部內距 0、封面頂端 0 且 3:2、無 host`, () => {
          assert.equal(m.vw, 669);
          assert.equal(m.vh, 951);
          assert.equal(m.routePos, "static");
          assert.equal(m.mainPadTop, "0px");
          near(m.route.t, 0, "route top");
          near(m.route.b, 951 - NAV_H - safeBottom, "route bottom");
          assert.ok(Math.abs(m.nav.t - m.route.b) <= 1.01, `nav top ${m.nav.t} vs route bottom ${m.route.b}`);
          near(m.route.l, 0, "route left");
          near(m.route.r, 669, "route right");
          assert.ok(m.routeScroll.sh > m.routeScroll.ch, "內容可捲動");
          near(m.cover.t, 0, "cover top");
          near(m.cover.h, (669 * 2) / 3, "cover 3:2");
          assert.equal(m.hostCount, 0);
          assert.equal(m.map.h, 0, "地圖分頁隱藏（仍在捲動容器內）");
        });
        check(`B1d ${tag}：返回／分享 top＝狀態列 ${SAFE_TOP}px＋12px、更換封面在封面右下；底板顯示、高＝狀態列`, () => {
          near(m.back.t, SAFE_TOP + 12, "back top");
          near(m.share.t, SAFE_TOP + 12, "share top");
          near(m.coverBtn.b, m.cover.b - 12, "cover button bottom");
          assert.deepEqual(m.backdrop, { display: "block", h: SAFE_TOP });
        });
        const hits = await evaluate(`window.foldHits(${TOP},${BOTTOM})`);
        check(`B3 ${tag}：摺痕區可點元素（一頁式允許，僅資訊）`, () => {
          console.log(`     （資訊）摺痕帶（未捲動）可點元素 ${hits.length}（一頁式，允許）`);
        });
        if (flag.laptop)
          check(`B4 ${tag}：置中對話框在下半部 [摺痕下緣, 底部安全區上緣]`, () => {
            assert.ok(m.alert.t >= BOTTOM - 0.5, "alert top " + m.alert.t);
            assert.ok(m.alert.b <= 951 - safeBottom + 0.5, "alert bottom " + m.alert.b);
          });
        else
          check(`B4f ${tag}：直向攤平無浮層規則，置中對話框置中於整個畫面`, () => {
            near((m.alert.t + m.alert.b) / 2, 951 / 2, "alert center");
          });
        await setup({ route: true, ...flag, top: TOP, bottom: BOTTOM, safeBottom, safeTop: SAFE_TOP, map: "hidden" });
        const bad = await evaluate("window.hitAll()");
        check(`B1b ${tag}：所有按鈕捲入視野後可被點到`, () => assert.deepEqual(bad, []));
        await setup({ route: true, ...flag, top: TOP, bottom: BOTTOM, safeBottom, safeTop: SAFE_TOP, map: "" });
        const mm = await measure();
        const chain = await evaluate("window.mapChain()");
        check(`B2 ${tag}：地圖分頁（顯示中）在捲動容器內、非 fixed、地圖框 min-h 320、chips 可見`, () => {
          assert.equal(chain.inRoute, true);
          assert.equal(chain.role, "tabpanel");
          assert.notEqual(chain.pos, "fixed");
          assert.ok(mm.mapBox.h >= 320, "地圖框高度：" + mm.mapBox.h);
          assert.ok(mm.chips.h > 0, "chips 高度");
        });
      }
    }

    // B1c 右側直欄（筆電／直向攤平）：內容右緣讓出直欄、底部無導覽、狀態列＝--duo-app-top（max(safe-area-top, 14px)）
    for (const [kind, flag] of [["筆電", { laptop: true }], ["直向攤平", { flat: true }]]) {
      await setup({ route: true, ...flag, top: TOP, bottom: BOTTOM, rail: true, safeBottom: 0, safeTop: 0, map: "hidden" });
      const m = await measure();
      check(`B1c ${kind} 右側直欄：捲動容器 [0, 951]、右緣讓出直欄 64px、封面頂端 0、按鈕 top＝14＋12`, () => {
        near(m.route.r, 669 - 64, "route right");
        near(m.route.t, 0, "route top");
        near(m.route.b, 951, "route bottom");
        near(m.cover.t, 0, "cover top");
        near(m.back.t, 26, "back top");
        assert.deepEqual(m.backdrop, { display: "block", h: 14 });
      });
    }

    // B4b 底部 sheet／drawer 不跨摺痕
    await setup({
      route: true,
      laptop: true,
      top: TOP,
      bottom: BOTTOM,
      map: "hidden",
      overlays: `<div role="dialog" id="sheet" class="${SHEET_CLS}" style="height:900px">s</div><div role="dialog" data-vaul-drawer data-vaul-drawer-direction="bottom" id="drawer" class="${DRAWER_CLS}" style="height:900px">d</div>`,
    });
    {
      const m = await measure();
      check("B4b 底部 sheet／drawer 最高只到摺痕下緣", () => {
        assert.ok(m.sheet.t >= BOTTOM - 0.5, "sheet top " + m.sheet.t);
        assert.ok(m.drawer.t >= BOTTOM - 0.5, "drawer top " + m.drawer.t);
      });
    }

    // B0（#DT1-T）：筆電上下分頁的 host 已移除；TripDetailScreen 不得再輸出 .trip-duo-laptop-map
    check("B0 TripDetailScreen 不輸出 .trip-duo-laptop-map（筆電改一頁式，舊 host 規則無節點命中）", () => {
      assert.doesNotMatch(fs.readFileSync(path.join(root, "src/components/trip/TripDetailScreen.tsx"), "utf8"), /trip-duo-laptop-map/);
    });

    // B5c 非筆電單欄：地圖分頁（顯示中）仍在捲動容器內、非 fixed
    await setup({ route: true, laptop: false, map: "" });
    {
      const m = await measure();
      const chain = await evaluate("window.mapChain()");
      const hostCount = await evaluate("document.querySelectorAll('.trip-duo-laptop-map').length");
      check("B5c 非筆電：地圖分頁節點在 .trip-detail-route 內（單欄結構不變）、非 fixed、無 .trip-duo-laptop-map", () => {
        assert.equal(hostCount, 0);
        assert.equal(chain.inRoute, true);
        assert.equal(chain.role, "tabpanel");
        assert.notEqual(chain.pos, "fixed");
        assert.notEqual(m.routePos, "fixed");
        assert.ok(m.map.h > 0 && m.mapBox.h >= 320, "單欄地圖分頁顯示時 min-h-[320px]：" + m.mapBox.h);
      });
    }

    // B5 非筆電：沒有 duo-laptop class 時，與「規則不存在」一致（地圖分頁隱藏時 className="hidden"）
    await setup({ route: true, laptop: false, map: "hidden", overlays });
    const plain = await measure();
    await setup({ route: true, laptop: false, top: TOP, bottom: BOTTOM, map: "hidden", overlays });
    const plainVars = await measure();
    check("B5 非筆電：捲動容器非 fixed、封面 3:2、對話框置中於整個畫面", () => {
      assert.notEqual(plain.routePos, "fixed");
      near(plain.route.t, 0, "route top");
      near(plain.route.b, 951 - NAV_H, "route bottom");
      near(plain.cover.h, (669 * 2) / 3, "cover 3:2");
      near((plain.alert.t + plain.alert.b) / 2, 951 / 2, "alert center");
      assert.equal(plain.map.h, 0, "map 隱藏（仍在 DOM）");
    });
    check("B5b 非筆電：即使殘留 --duo-hinge-* 變數，版型也不受影響", () => {
      assert.deepEqual(plainVars, plain);
    });

    check("B6 fixture 未發出任何外部請求", () => assert.deepEqual(externalRequests, []));
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

console.log(failures.length ? `\nverify-duo-laptop-layout: FAIL (${failures.length})` : "\nverify-duo-laptop-layout: PASS");
process.exit(failures.length ? 1 : 0);
