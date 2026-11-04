// verify-duo-laptop-saved-home-profile.mjs — iPhone Duo 筆電半開：收藏／首頁／我的 上下分區（任務單 #H2b-3-T）
//
// 受測（真實檔案，esbuild 打包、React development build＋<StrictMode>）：
//   src/routes/_app.saved.index.tsx、src/routes/_app.index.tsx、src/routes/_app.profile.tsx（頁面元件本體）
//   ＋ 其子元件（SavedTripCard、SavedPlaceCoverThumb、TripDeleteConfirmDialog、HomeNearbyPlaceCards、HomeTripCard、
//     HomeWeatherCard、HomeOutfitCard、HomePersonalizationCard、ProfileCover、ImageSourceSheet、SharedImageCropEditor、ui/*）
//   ＋ MobileFrame、BottomNav、appContentWrapperClass（真實檔案；_app 的 main class 與 html class／變數邏輯由 harness 依原始碼重現，
//     A4 檢查原始碼字串仍相符）＋ 實際編譯的 styles.css（Tailwind v4 compile）。
// Mock：router（createFileRoute／Link／useNavigate…）、@tanstack/react-start（createServerFn 計數）、supabase client（計數）、
//   use-auth／use-access／SubscriptionProvider／use-avatar／use-cover／use-add-to-trip／use-plus-upgrade、use-duo-layout／use-duo-laptop
//   （可控 store）、資料層函式（listCoreTrips／getLatestCoreTrip／listPlaces／getPreferences／getUserProfile／ensureUserProfile／
//   loadHomeNearbyPicks／home-weather-bootstrap／effective-location／hydrateConversationWorkspaces，皆計數）、window.fetch（計數；
//   /api/place-photo/sign 回傳簽名 URL，圖片由本機 server 提供並計數）。圖片 hook（usePlaceCoverImage／usePlaceImage／
//   signed-place-photo／image-cache）與推薦理由（PlaceRecommendationReason）為真實模組。
//
//   A1 _app.chat.tsx 差異只落在 #L1 生成鎖與 #PL-FIX Planner 授權段落（移除後＝95e7866a0e96f036；不寫死目前 sha）
//   A2 新規則 selector 逐字列舉、位於筆電區塊內（聊聊／探索段落之後、地點詳情雙頁之前）、@layer 外；最後規則屬 .place-duo-root；只新增
//   A4 harness 重現的 _app main class／html class 邏輯與原始碼相符
//   A6 （#H2b-5）首頁／我的筆電版面規則已移除：styles.css 不得有 home-laptop-root／-bottom、profile-laptop-root／-card／-plus；
//      頁面原始碼不得輸出這些 class、不得 createPortal；home-/profile-laptop-active 只用於浮層 selector
//   S* 收藏（筆電：底部導覽 safe-bottom 0／20、右側直欄）：標題＋行程區 [頂端, 摺痕上緣]、地點區 [摺痕下緣, 導覽上緣]、
//      兩區各自捲動到底且最後按鈕可點、main 無捲動量、捲動區內無 fixed 子孫、摺痕帶無可點元素
//   H*／P* （#H2b-5：首頁、我的在筆電改回與手機相同的一頁式捲動）筆電（safe-bottom 0／20、直欄）× Free／Plus（首頁另 × 有／無最近行程）：
//      DOM（#content）與 React fiber 樹＝同導覽型態的非筆電姿勢（手機／Duo 合起）；html 只多 *-laptop-active；
//      body 子節點相同（無 portal）；唯一的垂直捲動容器（首頁 main.app-scroll、我的 .profile-page）；
//      fixed 元素集合與非筆電相同、祖先鏈無 transform／filter／contain／will-change／捲動容器（iOS WebKit 裁切 fixed 的結構斷言）；
//      所有元素位置＝非筆電、＝移除新規則（OLD CSS）時（沒有任何版面規則作用）；每個可點元素捲入後可點、不被導覽遮住；
//      捲到底最後元素下緣 ≤ 導覽上緣
//   X* 姿勢切換（手機→筆電→雙欄→筆電直欄→Duo 合起→筆電→手機）：資料抓取次數不增加、頁面節點不 remount、
//      開啟中的 Sheet／Dialog 不 remount；首頁附近推薦節點不 remount（無 portal）；簽名 API 次數（簽名失敗情境為資訊）
//   E* 浮層：我的頁裁切編輯器維持全高（E1）、頭像來源 Sheet 在下半部（E3）、收藏刪除確認框（E2）；
//      E4 三頁浮層規則（置中／底部／頂部／側邊 Sheet、vaul drawer、裁切例外只限我的頁）在筆電生效、非筆電不生效
//   N* 非筆電（一般 iPhone、Duo 合起、Duo 雙欄、iPad、web）：DOM 與 HEAD 版頁面相同（HEAD 以 git show 取得並同樣打包）；
//      所有元素位置／關鍵 computed style 與移除新規則時相同；雙欄＋筆電＝雙欄（雙欄優先）；N3 雙欄 DOM＝HEAD（只差 *-duo-* class）
//   B0 對照：移除新規則（OLD CSS）時收藏 S1、E4 浮層斷言必須失敗；B0b 只移除第 2 輪規則（收藏框線／空白卡、裁切例外）時對應斷言失敗；
//      B0c 一頁式斷言自我檢查：注入內層捲動容器／body 層 fixed 容器／底部遮擋時必須失敗
//   #H2b-4-T 第 2 輪（設計決定，收藏與裁切仍適用）：收藏下半部下緣＝導覽實際上緣（含 1px border-t，直欄＝視窗下緣）；
//      收藏空白提示卡整張在下半部（S3）；裁切編輯器維持手機全高（E1 與非筆電幾何相同）；X3 簽名失敗為資訊
//   R  無外部請求、無瀏覽器例外／console.error
//
// 限制：headless Chrome 不會重現 iOS WebKit「捲動容器裁切 fixed 子孫」，以祖先鏈結構斷言代替；
//   資料層與 auth／訂閱為 mock（計數），網路以 window.fetch／CDP Network 事件計數。
// 執行：node scripts/verify-duo-laptop-saved-home-profile.mjs（不讀 .env、不連網）

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
// #TS-BASE：功能 commit（943a047…）之前的基準 commit。功能已 commit 進 HEAD 後，A2「相對 HEAD 只新增」會因 diff 為空而失效，
//   改以此基準比對（日後基準前移時只改這一行）。
const PRE_FEATURE_BASE = "aa2db59";
const styles = read("src/styles.css");
const failures = [];
const infos = [];
// #P1-T2：逾時保護。單一 CDP 呼叫（含 Runtime.evaluate awaitPromise）預設 30 秒、整支預設 10 分鐘（實測完整通過約 455 秒）；
// 逾時時印出卡住的步驟（最近的 check／mount 情境／CDP 指令）並以非 0 結束。可用環境變數調整（不放寬任何斷言）。
// 參數：--step-ms=<毫秒>、--total-ms=<毫秒>、--trace（列出超過 1 秒的 CDP 指令）；環境變數 DUO_VERIFY_STEP_MS／DUO_VERIFY_TOTAL_MS／DUO_VERIFY_TRACE 同義。
const argOf = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const STEP_TIMEOUT_MS = Number(argOf("step-ms") ?? process.env.DUO_VERIFY_STEP_MS) || 30_000;
const TOTAL_TIMEOUT_MS = Number(argOf("total-ms") ?? process.env.DUO_VERIFY_TOTAL_MS) || 600_000;
const TRACE = process.argv.includes("--trace") || !!process.env.DUO_VERIFY_TRACE;
const startedAt = Date.now();
const progress = { check: "(尚未進入 check)", scenario: "(尚未掛載)", cdp: "(尚無 CDP 指令)" };
const progressText = () =>
  `最近 check：${progress.check}\n     情境：${progress.scenario}\n     CDP：${progress.cdp}\n     已執行 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
let onFatalTimeout = () => {};
const traceStats = {};
const printTraceStats = () => {
  if (!TRACE) return;
  const rows = Object.entries(traceStats).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12);
  console.log("     （trace）CDP 累計耗時前 12：\n" + rows.map(([k, s]) => `       ${(s.ms / 1000).toFixed(1)}s ×${s.n} ${k}`).join("\n"));
};
const totalTimer = setTimeout(() => {
  printTraceStats();
  console.log(`FAIL 整支逾時（${TOTAL_TIMEOUT_MS / 1000}s）：\n     ${progressText()}`);
  try {
    onFatalTimeout();
  } catch {}
  process.exit(2);
}, TOTAL_TIMEOUT_MS);
async function check(name, fn) {
  progress.check = name;
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 30).join("\n     "));
  }
}
const info = (s) => {
  infos.push(s);
  console.log("     （資訊）" + s);
};

// ───────────────────────── Part A：靜態 ─────────────────────────
// #L1-T2：_app.chat.tsx 經 #L1（行程生成全域鎖）授權修改，sha256 前 16 碼 95e7866a0e96f036 作廢 → bb3a7f395ea8d58e。
// #L1-T3：第 2 輪授權修改（清除聊聊上鎖、離開原對話時的失敗提示、提示取目前語系）→ 1f9f6c91787031f6（bb3a7f395ea8d58e 作廢）。
// #L1-T4：第 3 輪授權修改（不在原對話時失敗只一則提示、具體原因、保存後失效改發完成提示、finally 通知 try／catch）→ 8e2dd996d9c89771（1f9f6c91787031f6 作廢）。
//   「聊聊頁除生成鎖外未修改」改由 verify-chat-generation-lock-authorized-diff.mjs 逐字移除授權段落後與改動前版本比對。
// #PL-FIX-T3：不再寫死 _app.chat.tsx 的 sha（#PL-FIX 授權變更後 sha 隨 Planner 段落改變）。改為逐字移除 #L1 生成鎖與
//   #PL-FIX Planner 選擇入口的授權段落（長段落以 sha16 釘死）後必須＝改動前版本 95e7866a0e96f036：
//   聊聊頁差異只能落在授權段落，Duo 工作若改到聊聊頁任何其他地方都會失敗。
await check("A1 src/routes/_app.chat.tsx 差異只落在授權的 #L1 生成鎖與 #PL-FIX Planner 段落（移除後＝95e7866a0e96f036）", async () => {
  const { assertChatTsxOnlyLockChanges } = await import("./verify-chat-generation-lock-authorized-diff.mjs");
  const h = assertChatTsxOnlyLockChanges();
  assert.equal(typeof h, "string");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "src/routes/_app.chat.tsx"))).digest("hex"), h);
});

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const selectorsOf = (s) =>
  [...stripComments(s).matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
const blockStart = styles.indexOf(" * iPhone Duo 筆電半開（橫向摺痕）");
const chatStart = styles.indexOf(" * 筆電半開＋聊聊（/chat");
const shpStart = styles.indexOf(" * 筆電半開＋收藏（/saved");
const placeStart = styles.indexOf(" * 地點詳情頁雙頁");
const shpRegionStart = styles.lastIndexOf("/*", shpStart);
const shpRegionEnd = styles.lastIndexOf("/*", placeStart);
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
const SHP_EXACT = [
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
  // #H2b-5：首頁／我的改回一頁式捲動，版面規則（home-laptop-root／-bottom、profile-laptop-root／-card／-plus）已移除（A6 檢查不得存在）
  ...[[0, 2], [2, 4], [4, 6], [6, 8]].flatMap(([a, b]) =>
    ["saved", "home", "profile"].flatMap((p) => SHP_OVERLAY_TAILS.slice(a, b).map((t) => `html.duo-laptop.${p}-laptop-active${t}`)),
  ),
  // #H2b-4 第 2 輪：我的頁裁切編輯器（唯一 h-[92dvh] 底部 Sheet）維持手機全高
  'html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]',
];
// 第 2 輪規則（B0b 以「只移除第 2 輪」的 CSS 對照）：每段以註解標記起頭、到下一個空行為止
// #H2b-5：首頁／我的的第 2 輪版面規則已隨版面規則一併移除，只剩收藏第 2 輪與裁切例外
const R2_MARKERS = [" * 收藏筆電第 2 輪：", " * 我的頁裁切編輯器（SharedImageCropEditor"];
const R2_RANGES = R2_MARKERS.map((mk) => {
  const i = styles.indexOf(mk);
  return [styles.lastIndexOf("/*", i), styles.indexOf("\n\n", i)];
});
const stylesR1 = R2_RANGES.reduceRight((s, [a, b]) => s.slice(0, a) + s.slice(b), styles);
const R2_EXPECTED = [
  "html.duo-laptop .saved-laptop-root",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes",
  "html.duo-laptop .saved-laptop-root > .saved-duo-panes > section:last-child > .border-dashed",
  'html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]',
];
await check("A3 第 2 輪規則切分（B0b 用）：兩段（收藏第 2 輪、裁切例外）各自有標記、切出的 selector＝第 2 輪清單、其餘＝第 1 輪清單", () => {
  for (const [a, b] of R2_RANGES) assert.ok(a > shpRegionStart && b > a && b < shpRegionEnd, "第 2 輪段落位置：" + [a, b]);
  assert.deepEqual(R2_RANGES.flatMap(([a, b]) => selectorsOf(styles.slice(a, b))), R2_EXPECTED);
  const r1 = selectorsOf(stylesR1.slice(stylesR1.lastIndexOf("/*", stylesR1.indexOf(" * 筆電半開＋收藏（/saved")), stylesR1.lastIndexOf("/*", stylesR1.indexOf(" * 地點詳情頁雙頁"))));
  const expectR1 = SHP_EXACT.slice();
  for (const s of R2_EXPECTED) expectR1.splice(expectR1.lastIndexOf(s), 1);
  assert.deepEqual(r1, expectR1);
});
// #DT1-T 改寫 A5：原斷言「src 內含子字串 h-[92dvh] 的檔案只有 SharedImageCropEditor」是為了保護
//   html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]
// （我的頁裁切編輯器在筆電姿勢維持全高的例外）不誤中其他底部 Sheet。第 4／5 階段新增的 ExpenseSheet、
// PackingItemSheet、PackingCategoriesSheet 使用 max-h-[92dvh]，子字串同樣命中 [class*="h-[92dvh]"]，
// 因此改為精確檢查：(1) 以 class token 使用 h-[92dvh] 的只有裁切編輯器；(2) 子字串命中者逐一列舉；
// (3) 除裁切編輯器外，命中者都不在 /profile 路由的 import 圖內（該規則只在 profile-laptop-active 下生效）；
// (4) [class*="h-[92dvh]"] 只出現在這一條、且限定 html.duo-laptop.profile-laptop-active；
// (5) profile-laptop-active 只由 _app.profile.tsx 加上並在 cleanup 移除。
await check('A5 裁切例外 [class*="h-[92dvh]"] 不誤中：token h-[92dvh] 只有 SharedImageCropEditor；子字串命中者（max-h-[92dvh] 的記帳／行李 Sheet）不在 /profile import 圖內；規則限定 profile-laptop-active', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(d, e.name)] : []));
  const files = walk(path.join(root, "src"));
  const rel = (f) => path.relative(root, f);
  const tokenHits = files.filter((f) => /(?<![\w\-[:])h-\[92dvh\]/.test(fs.readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(tokenHits, ["src/components/media/SharedImageCropEditor.tsx"], "以 class token 使用 h-[92dvh] 的檔案");
  const substrHits = files.filter((f) => fs.readFileSync(f, "utf8").includes("h-[92dvh]")).map(rel).sort();
  assert.deepEqual(substrHits, [
    "src/components/media/SharedImageCropEditor.tsx",
    "src/components/trip/expenses/ExpenseSheet.tsx",
    "src/components/trip/packing/PackingCategoriesSheet.tsx",
    "src/components/trip/packing/PackingItemSheet.tsx",
  ], "子字串 h-[92dvh] 命中清單改變：新增者須確認不會在 /profile 筆電姿勢開啟");
  // /profile 路由的靜態＋動態 import 圖（@/ 與相對路徑）
  const resolveImp = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    for (const c of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")])
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    return null;
  };
  const seen = new Set();
  const stack = [path.join(root, "src/routes/_app.profile.tsx")];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.tsx?$/.test(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
      const r = resolveImp(f, m[1]);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  assert.ok(seen.has(path.join(root, "src/components/media/SharedImageCropEditor.tsx")), "import 圖檢查失效：/profile 應可達裁切編輯器");
  const reachable = substrHits.filter((f) => f !== "src/components/media/SharedImageCropEditor.tsx" && seen.has(path.join(root, f)));
  assert.deepEqual(reachable, [], "max-h-[92dvh] 的 Sheet 可從 /profile 到達，會被裁切例外誤中");
  const cssSels = selectorsOf(styles).filter((s) => s.includes('[class*="h-[92dvh]"]'));
  assert.deepEqual(cssSels, ['html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]']);
  const adders = files.filter((f) => /classList\.(add|toggle)\(\s*["']profile-laptop-active["']/.test(fs.readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(adders, ["src/routes/_app.profile.tsx"]);
  assert.match(read("src/routes/_app.profile.tsx"), /return \(\) => \{\s*root\.classList\.remove\("profile-laptop-active"\);/, "離開 /profile 須移除 profile-laptop-active");
});
const REMOVED_LAYOUT = /home-laptop-root|home-laptop-bottom|profile-laptop-root|profile-laptop-card|profile-laptop-plus/;
await check("A6 （#H2b-5）首頁／我的筆電版面規則不得存在；頁面不輸出其 class、不 createPortal；home-/profile-laptop-active 只用於浮層", () => {
  assert.doesNotMatch(stripComments(styles), REMOVED_LAYOUT, "styles.css 殘留首頁／我的筆電版面規則");
  const sels = selectorsOf(styles);
  const hp = sels.filter((s) => /\b(home|profile)-laptop-active\b/.test(s));
  const tails = new Set(SHP_OVERLAY_TAILS);
  const CROP = 'html.duo-laptop.profile-laptop-active [role="dialog"][class*="slide-in-from-bottom"][class*="h-[92dvh]"]';
  assert.deepEqual(hp.filter((s) => s !== CROP && !tails.has(s.replace(/^html\.duo-laptop\.(home|profile)-laptop-active/, ""))), [], "home-/profile-laptop-active 用於浮層以外");
  assert.equal(hp.length, 17, "home／profile 浮層 selector 數（各 8＋裁切例外 1）");
  for (const f of ["src/routes/_app.index.tsx", "src/routes/_app.profile.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, REMOVED_LAYOUT, f + " 仍輸出已移除的版面 class");
    assert.doesNotMatch(src, /createPortal|react-dom/, f + " 仍有 portal");
  }
  assert.match(read("src/routes/_app.index.tsx"), /root\.classList\.add\("home-laptop-active"\)/);
  assert.match(read("src/routes/_app.profile.tsx"), /root\.classList\.add\("profile-laptop-active"\)/);
});
await check("A2 新規則：逐字列舉、筆電區塊內（聊聊／探索之後、地點詳情雙頁之前）、@layer 外；最後規則屬 .place-duo-root；只新增", () => {
  assert.ok(blockStart > 0 && chatStart > blockStart && shpStart > chatStart && placeStart > shpStart, "段落順序");
  assert.deepEqual(selectorsOf(styles.slice(shpRegionStart, shpRegionEnd)), SHP_EXACT);
  assert.doesNotMatch(stripComments(styles.slice(0, shpRegionStart) + styles.slice(shpRegionEnd)), /saved-laptop|home-laptop|profile-laptop/);
  const nc = styles.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  let depth = 0;
  const depthAt = new Int32Array(nc.length);
  for (let i = 0; i < nc.length; i++) {
    depthAt[i] = depth;
    if (nc[i] === "{") depth++;
    else if (nc[i] === "}") depth--;
  }
  for (const m of nc.slice(shpRegionStart, shpRegionEnd).matchAll(/([^{}]+)\{[^{}]*\}/g))
    assert.equal(depthAt[shpRegionStart + m.index + m[0].indexOf("{")], 0, "規則在 @layer 內：" + m[1].trim().slice(0, 80));
  const rules = [...nc.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  assert.match(rules[rules.length - 1][1], /\.place-duo-root/);
  // #TS-BASE：「只新增」對功能 commit 前基準比對（工作區 vs PRE_FEATURE_BASE）；numstat 為空時 [1] 為 undefined → 失敗
  const numstat = execFileSync("git", ["diff", "--numstat", PRE_FEATURE_BASE, "--", "src/styles.css"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(numstat.split(/\s+/)[1], "0", `styles.css 相對 ${PRE_FEATURE_BASE} 有刪除行：` + numstat);
});

const appSrc = read("src/routes/_app.tsx");
await check("A4 harness 重現的 _app main class／html class 邏輯與原始碼相符", () => {
  for (const s of [
    '"app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)]"',
    'pathname === "/chat" ? "pb-0" : "pb-[var(--app-nav-total-height)]"',
    '"min-h-0 flex-1 overflow-hidden"',
    '"overflow-x-hidden overflow-y-auto"',
    'root.style.setProperty("--bottom-nav-height", "0.01px")',
    'root.style.setProperty("--app-rail-width", RIGHT_RAIL_WIDTH_VALUE)',
    'root.classList.add("duo-rail")',
    'root.classList.add("duo-two-pane")',
    // #H3-3：筆電／直向攤平合為單一 effect（stackedClass），harness 第 379 行起以相同邏輯重現
    'const stackedClass = duoPane\n    ? null\n    : duoLaptop.laptop\n      ? "duo-laptop"\n      : duoFlatPortrait.flat\n        ? "duo-flat-portrait"\n        : null;',
    "const stackedFold = duoLaptop.laptop ? duoLaptop : duoFlatPortrait.flat ? duoFlatPortrait : null;",
    "const hingeTop = stackedClass && stackedFold ? stackedFold.foldTop : null;",
    "const hingeBottom = stackedClass && stackedFold ? stackedFold.foldBottom : null;",
    "if (stackedClass == null || hingeTop == null || hingeBottom == null) return;",
    "root.classList.add(stackedClass);",
    "root.classList.remove(stackedClass);",
    "}, [stackedClass, hingeTop, hingeBottom]);",
    "<MobileFrame fullBleed={rightRail}>",
    'placement={rightRail ? "right-rail" : "bottom"}',
    'const RIGHT_RAIL_CONTENT_STYLE = { "--safe-area-right": "0px" } as CSSProperties;',
    "const RIGHT_RAIL_MAIN_STYLE: CSSProperties = { paddingRight: RIGHT_RAIL_WIDTH_VAR };",
  ])
    assert.ok(appSrc.includes(s), "_app.tsx 缺少：" + s);
  assert.match(read("src/lib/app-scroll-contract.ts"), /path === "\/profile"/);
  assert.match(read("src/components/BottomNav.tsx"), /export const RIGHT_RAIL_MIN_WIDTH_PX = 56;/);
});

// ───────────────────────── fixture／mock ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

const W = 669;
const H = 951;
const TOP = 455.5;
const BOTTOM = 495.5;
// 直欄寬＝max(RIGHT_RAIL_MIN_WIDTH_PX, safe-right)；本 harness safe-right＝0（A4 檢查常數仍為 56）
const RAIL = 56;
// #TS-P1：P1 Free fixture 用的長顯示名稱（在 669 寬的個人卡內換成兩行）
const LONG_DISPLAY_NAME = "旅人小安・京都大阪奈良神戶和歌山滋賀慢遊散步紀錄本";
const abs = (p) => path.join(root, p).replace(/\\/g, "/");

const cnt = `const C=(k)=>{const c=(window.__counts||(window.__counts={}));c[k]=(c[k]||0)+1;};const CFG=()=>window.__cfg||{};`;
const mocks = {
  "@/hooks/use-duo-layout": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur={navPlacement:'bottom',tripLayout:'single',usableWidth:${W}};
export function setDuoLayout(v){cur=v;subs.forEach(f=>f());}
export function useDuoLayout(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}`,
  "@/hooks/use-duo-laptop": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur={laptop:false};
export function setDuoLaptop(v){cur=v;subs.forEach(f=>f());}
export function useDuoLaptop(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}
const FLAT={flat:false};export function useDuoFlatPortrait(){return FLAT;}
export function useDuoDevice(){return true;}`,
  "@/hooks/use-i18n": `import {translate,translateList} from '${abs("src/lib/i18n/translate.ts")}';
const V={locale:'zh-TW',localePreference:'zh-TW',t:(k,v)=>translate('zh-TW',k,v),tList:(k)=>translateList('zh-TW',k),setLocalePreference:async()=>{},setLocale:async()=>{}};
export const ROAMIE_LOCALE_CHANGED='roamie:locale-changed';
export function useI18n(){return V;}
export function I18nProvider({children}){return children;}`,
  "@tanstack/react-router": `import React from 'react';
const NAV=(o)=>{(window.__nav||(window.__nav=[])).push(o);return Promise.resolve();};
const ROUTER={subscribe:()=>()=>{},invalidate:async()=>{},navigate:NAV,history:{back(){},go(){}},state:{location:{pathname:'/'}},preloadRoute:async()=>{}};
export const useNavigate=()=>NAV;
export const useRouter=()=>ROUTER;
export const useLocation=()=>({pathname:window.__path||'/',search:{},hash:''});
export const useRouterState=(o)=>{const s={location:{pathname:window.__path||'/',search:{}},status:'idle'};return o&&o.select?o.select(s):s;};
export const Outlet=()=>null;
export const Link=React.forwardRef(function Link({to,search,params,replace,preload,activeProps,inactiveProps,activeOptions,children,onClick,...rest},ref){
 return <a ref={ref} href={typeof to==='string'?to:'#'} onClick={(e)=>{e.preventDefault();onClick&&onClick(e);NAV({to,search});}} {...rest}>{typeof children==='function'?children({isActive:false}):children}</a>;});
export function createFileRoute(p){return (opts)=>({options:opts,path:p,useSearch:()=>(window.__search&&window.__search[p])||{},useParams:()=>({}),useLoaderData:()=>undefined});}
export function getRouteApi(p){return {useSearch:()=>(window.__search&&window.__search[p])||{},useParams:()=>({})};}
export function redirect(o){return o;}`,
  "@tanstack/react-start": `${cnt}
export function createServerFn(opts){const b={middleware(){return b},validator(){return b},inputValidator(){return b},
 handler(h){const name=(h&&h.toString().slice(0,80))||'fn';const f=async()=>{C('serverFn');(window.__serverFnNames||(window.__serverFnNames=[])).push(name);return null;};return f;}};return b;}
export const useServerFn=(f)=>f;
export function createMiddleware(){const m={server(){return m},client(){return m},middleware(){return m},validator(){return m},inputValidator(){return m}};return m;}
export function createStart(){return {};}`,
  "@tanstack/react-start/server": `export const getRequest=()=>null;export const getRequestHeader=()=>null;export const setResponseHeader=()=>{};`,
  "@/integrations/supabase/client": `${cnt}
const USER={id:'u1',email:'tester@example.com'};const SESSION={access_token:'tok',user:USER,expires_at:9999999999};
const rec=(k)=>{C('supabase');(window.__sbCalls||(window.__sbCalls=[])).push(k);};
function chain(p){const fn=function(){};return new Proxy(fn,{get(t,k){if(k==='then'){return (res,rej)=>Promise.resolve({data:[],error:null,count:0}).then(res,rej);}
 if(k==='catch'||k==='finally'){const pr=Promise.resolve({data:[],error:null});return pr[k].bind(pr);}return chain(p+'.'+String(k));},apply(){return chain(p+'()');}});}
const auth={getSession:async()=>{C('authGetSession');return {data:{session:SESSION},error:null};},getUser:async()=>({data:{user:USER},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),refreshSession:async()=>({data:{session:SESSION},error:null})};
const base={auth,from:(t)=>{rec('from:'+t);return chain('from:'+t);},rpc:(n)=>{rec('rpc:'+n);return chain('rpc:'+n);},
 storage:{from:(b)=>{rec('storage:'+b);return chain('storage:'+b);}},functions:{invoke:async(n)=>{rec('fn:'+n);return {data:null,error:null};}},
 channel:()=>chain('channel'),removeChannel:()=>{}};
export const supabase=new Proxy(base,{get(t,k){return k in t?t[k]:chain(String(k));}});
export function isSupabaseConfigured(){return true;}export function getSupabaseClient(){return supabase;}`,
  "@/hooks/use-auth": `const USER={id:'u1',email:'tester@example.com'};const SESSION={access_token:'tok',user:USER};
const V={user:USER,session:SESSION,loading:false,signOut:async()=>{},refreshSession:async()=>{}};
export const useAuth=()=>V;export function AuthProvider({children}){return children;}`,
  "@/hooks/use-access": `import {useSyncExternalStore} from 'react';
const subs=new Set();let plus=false;const mk=()=>({hasPlusAccess:plus,subscriptionSource:'verify',entitlementDisplayStable:true,subscriptionHydrated:true,isPlus:plus,plan:plus?'plus':'free',loading:false});
let cur=mk();export function setPlus(v){plus=!!v;cur=mk();subs.forEach(f=>f());}
const sub=cb=>{subs.add(cb);return()=>subs.delete(cb)};
export function useAccess(){return useSyncExternalStore(sub,()=>cur,()=>cur);}
export function useAccessOptional(){return useSyncExternalStore(sub,()=>cur,()=>cur);}
export function AccessProvider({children}){return children;}`,
  "@/providers/SubscriptionProvider": `const V={loading:false,isPlus:false,refresh:async()=>{}};export function useSubscription(){return V;}export function SubscriptionProvider({children}){return children;}`,
  "@/hooks/use-avatar": `const V={hasCustomAvatar:false,avatarUrl:null,displaySrc:null,setPreview(){},syncFromProfile(){},pending:false};
export function useAvatar(){return V;}export function useAvatarDisplaySrc(){return null;}export function AvatarProvider({children}){return children;}export const avatarRevisionFromUpdatedAt=()=>0;`,
  "@/hooks/use-cover": `const V={coverUrl:null,coverDisplaySrc:null,coverPending:false,setPreview(){},syncFromProfile(){}};
export function useCover(){return V;}export function CoverProvider({children}){return children;}`,
  "@/hooks/use-add-to-trip": `const V={openAddToTrip(){(window.__addToTrip=(window.__addToTrip||0)+1);}};export function useAddToTrip(){return V;}export function useAddToTripOptional(){return V;}export function AddToTripProvider({children}){return children;}`,
  "@/hooks/use-plus-upgrade": `const V={upgradeToPlus:async()=>({}),openRevenueCatPaywall:()=>{}};export function usePlusUpgrade(){return V;}`,
  "@/hooks/use-pending-auth-action": `export function usePendingAuthActionResume(){}`,
  "@/hooks/use-preference-quiz-status": `import {getTravelPrefStatusSync} from '@/lib/travel-pref-status';
export function useTravelPrefStatus(){return getTravelPrefStatusSync('u1');}export function usePreferenceQuizCompleted(){return getTravelPrefStatusSync('u1').preferenceQuizCompleted;}`,
  "@/lib/travel-pref-status": `export * from '${abs("src/lib/travel-pref-status.ts")}';
const ST={on:null,off:null};
export function getTravelPrefStatusSync(){const on=!!(window.__cfg&&window.__cfg.onboarded);
 if(on){return ST.on||(ST.on={preferenceQuizCompleted:true,travelStyleName:'城市慢遊探索家',personalityType:'城市慢遊探索家',personalitySummary:'喜歡在巷弄裡慢慢發現小店與咖啡館。',tags:['慢行','安靜','咖啡','文青','平衡'],
  prefs:{onboarded:true,pace:'slow',vibe:'quiet',budgetMode:'balanced',interests:['咖啡','文青']},snapshot:null,pace:'slow',vibe:'quiet',budget:'balanced'});}
 return ST.off||(ST.off={preferenceQuizCompleted:false,travelStyleName:'',personalityType:'',personalitySummary:'',tags:[],prefs:{onboarded:false},snapshot:null});}
export function mergePreferencesWithTravelPrefStatus(p){return p;}`,
  "@/lib/trip/core-trip": `export * from '${abs("src/lib/trip/core-trip.ts")}';
${cnt}
const mkTrip=(i)=>({id:'trip-'+i,title:'京都 '+(i+1)+' 日慢旅',customTitle:null,isTitleCustomized:false,coverImageUrl:null,mood:null,customCoverImageUrl:null,aiGeneratedCoverImageUrl:null,isCoverCustomized:false,
 destinationPlace:{name:'京都',country:'日本'},originPlace:null,startDate:'2026-11-0'+((i%8)+1),endDate:'2026-11-1'+((i%8)+1),days:3,transportMode:'transit',places:[],weatherSummary:'',outfitSuggestion:'',
 createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',isOwner:true,generatedLocale:'zh-TW',localeContract:null});
export async function listCoreTrips(){C('listCoreTrips');const n=(window.__cfg&&window.__cfg.trips)||0;return Array.from({length:n},(_,i)=>mkTrip(i));}
export async function getLatestCoreTrip(){C('getLatestCoreTrip');return window.__cfg&&window.__cfg.latestTrip?mkTrip(0):null;}`,
  "@/lib/places-storage": `export * from '${abs("src/lib/places-storage.ts")}';
${cnt}
const mkPlace=(i)=>({id:'sp-'+i,name:'收藏地點 '+(i+1),address:'京都市東山區 '+(i+1)+' 番地',lat:35.0+i*0.001,lng:135.7,category:'cafe',note:'',createdAt:'2026-10-01T00:00:00Z',googlePlaceId:'ChIJsaved'+i,photoName:(window.__cfg&&window.__cfg.savedPhotos)?'places/ChIJsaved'+i+'/photos/S'+i:null});
export async function listPlaces(){C('listPlaces');const n=(window.__cfg&&window.__cfg.places)||0;return Array.from({length:n},(_,i)=>mkPlace(i));}
export function peekListPlacesCache(){return null;}
export function readPlacesLocalCacheSync(){return [];}
export async function toggleSavePlace(){C('toggleSavePlace');return true;}
export async function deletePlace(){C('deletePlace');}`,
  "@/lib/saved-list-snapshot": `export * from '${abs("src/lib/saved-list-snapshot.ts")}';
export function readSavedPlacesSnapshot(){return [];}export function readSavedTripsSnapshot(){return [];}
export async function hydrateSavedListSnapshot(){return {trips:[],places:[],source:'none'};}export function writeSavedPlacesSnapshot(){}export function writeSavedTripsSnapshot(){}`,
  "@/lib/preferences-storage": `export * from '${abs("src/lib/preferences-storage.ts")}';
${cnt}
export async function getPreferences(){C('getPreferences');return window.__cfg&&window.__cfg.onboarded?{onboarded:true,pace:'slow',vibe:'quiet',budgetMode:'balanced'}:{onboarded:false};}`,
  "@/lib/profile-storage": `export * from '${abs("src/lib/profile-storage.ts")}';
${cnt}
export async function getUserProfile(){C('getUserProfile');const on=!!(window.__cfg&&window.__cfg.onboarded);
 return {displayName:(window.__cfg&&window.__cfg.displayName)||'旅人小安',bio:'',avatarUrl:null,coverImageUrl:null,travelStyle:on?'城市慢遊探索家':'',language:'zh-TW',notificationsEnabled:true,authProvider:null,
  prefs:on?{onboarded:true,pace:'slow',vibe:'quiet',budgetMode:'balanced',interests:['咖啡']}:{onboarded:false},personalityType:on?'城市慢遊探索家':'',personalitySummary:'',personalityImpression:on?'你偏好步調緩慢、有質感的城市散步。':''};}
export async function saveUserProfile(){C('saveUserProfile');}
export async function syncTravelPreferenceProfileFields(){C('syncTravelPreferenceProfileFields');}`,
  "@/lib/ensure-user-profile": `export * from '${abs("src/lib/ensure-user-profile.ts")}';
${cnt}export async function ensureUserProfile(){C('ensureUserProfile');return true;}export async function syncProfileAppFields(){C('syncProfileAppFields');}`,
  "@/lib/conversation-workspace": `export * from '${abs("src/lib/conversation-workspace/index.ts")}';
${cnt}export async function hydrateConversationWorkspaces(){C('hydrateConversationWorkspaces');}export function listConversationWorkspaces(){return [];}`,
  "@/lib/home-nearby-search": `export * from '${abs("src/lib/home-nearby-search.ts")}';
${cnt}
const mkPick=(i)=>({id:'ChIJnear'+i,placeId:'ChIJnear'+i,name:'附近咖啡 '+(i+1),lat:35.01+i*0.001,lng:135.76,rating:4.5,userRatingCount:320,businessStatus:'OPERATIONAL',
 primaryType:'cafe',types:['cafe','food'],categoryId:'cafe',category:'cafe',photoName:'places/ChIJnear'+i+'/photos/P'+i,address:'京都市',openStatus:'open',reason:'安靜、適合坐一下'});
export async function loadHomeNearbyPicks(){C('loadHomeNearbyPicks');return Array.from({length:6},(_,i)=>mkPick(i));}`,
  "@/lib/effective-location": `export * from '${abs("src/lib/effective-location.ts")}';
${cnt}
const SNAP={lat:35.01,lng:135.76,city:'京都',locationKey:'35.01,135.76',source:'gps',permission:'granted',isFallback:false,isReadyForPlaces:true,status:'ready',accuracy:20};
export function getEffectiveLocationSnapshot(){return SNAP;}export function subscribeEffectiveLocation(){return ()=>{};}
export async function ensureEffectiveLocationBootstrap(){C('ensureEffectiveLocationBootstrap');return SNAP;}`,
  "@/lib/home-weather-bootstrap": `${cnt}
const ST={weather:{available:true,city:'京都',temp:18,tempMin:12,tempMax:21,condition:'晴',summary:'晴朗',icon:'clear-day',precipProb:10,humidity:50,windSpeed:2,uvIndex:3,feelsLike:18,updatedAt:'2026-10-31T00:00:00Z'},
 status:'ready',error:null,userLocation:{lat:35.01,lng:135.76,city:'京都'},usedFallbackLocation:false,locationPermission:'granted'};
export function subscribeHomeWeatherBootstrap(){return ()=>{};}export function getHomeWeatherBootstrapState(){return ST;}
export function ensureHomeWeatherBootstrap(){C('ensureHomeWeatherBootstrap');}export function refreshHomeWeatherInBackground(){C('refreshHomeWeather');}
export function ensureHomeWeatherLocationWatch(){return ()=>{};}export function subscribeHomeWeatherLocationWatch(){return ()=>{};}
export function reloadHomeWeatherBootstrap(){C('reloadHomeWeather');}`,
  sonner: `export const toast=Object.assign(()=>{},{success(){},error(){},info(){},warning(){},message(){},dismiss(){}});export const Toaster=()=>null;`,
};

const entry = (variant) => `import React,{StrictMode,useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Route as SavedRoute} from '@/routes/_app.saved.index';
import {Route as HomeRoute} from '@/routes/_app.index';
import {Route as ProfileRoute} from '@/routes/_app.profile';
import {MobileFrame} from '@/components/MobileFrame';
import {BottomNav,RIGHT_RAIL_WIDTH_VALUE,RIGHT_RAIL_WIDTH_VAR} from '@/components/BottomNav';
import {appContentWrapperClass} from '@/lib/app-scroll-contract';
import {SharedImageCropEditor} from '@/components/media/SharedImageCropEditor';
import {cn} from '@/lib/utils';
import {setDuoLayout,useDuoLayout} from '@/hooks/use-duo-layout';
import {setDuoLaptop,useDuoLaptop,useDuoFlatPortrait} from '@/hooks/use-duo-laptop';
import {setPlus} from '@/hooks/use-access';
import {setHomeRouteVisible} from '@/lib/home-route-active';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
window.__variant=${JSON.stringify(variant)};
const PAGES={saved:{C:SavedRoute.options.component,path:'/saved',locked:false},home:{C:HomeRoute.options.component,path:'/',locked:false},profile:{C:ProfileRoute.options.component,path:'/profile',locked:true}};
function Shell({page,crop}){
 const L=useDuoLayout();const rightRail=L.navPlacement==='right-rail';const duoPane=rightRail&&L.tripLayout==='two-pane'?(L.pane??null):null;
 const duoLaptop=useDuoLaptop();
 const P=PAGES[page];const locked=P.locked;
 useLayoutEffect(()=>{const main=document.querySelector('main.app-scroll');if(!main)return;
  if(!locked){main.style.removeProperty('overflow');main.style.removeProperty('overflow-y');main.style.removeProperty('overflow-x');main.style.removeProperty('height');main.style.removeProperty('min-height');}
  else{main.style.overflow='hidden';main.style.overflowY='hidden';main.style.overflowX='hidden';main.style.minHeight='0';main.style.removeProperty('height');}},[locked]);
 useLayoutEffect(()=>{if(!rightRail)return;const root=document.documentElement;root.style.setProperty('--bottom-nav-height','0.01px');root.style.setProperty('--app-rail-width',RIGHT_RAIL_WIDTH_VALUE);root.classList.add('duo-rail');
  return()=>{root.style.removeProperty('--bottom-nav-height');root.style.removeProperty('--app-rail-width');root.classList.remove('duo-rail');};},[rightRail]);
 const fl=duoPane?duoPane.foldX-duoPane.gutter/2:null;const fr=duoPane?duoPane.foldX+duoPane.gutter/2:null;
 useLayoutEffect(()=>{if(fl==null||fr==null)return;const root=document.documentElement;root.style.setProperty('--duo-fold-left-edge',fl+'px');root.style.setProperty('--duo-fold-right-edge',fr+'px');root.classList.add('duo-two-pane');
  return()=>{root.style.removeProperty('--duo-fold-left-edge');root.style.removeProperty('--duo-fold-right-edge');root.classList.remove('duo-two-pane');};},[fl,fr]);
 const duoFlatPortrait=useDuoFlatPortrait();
 const stackedClass=duoPane?null:duoLaptop.laptop?'duo-laptop':duoFlatPortrait.flat?'duo-flat-portrait':null;
 const stackedFold=duoLaptop.laptop?duoLaptop:duoFlatPortrait.flat?duoFlatPortrait:null;
 const hingeTop=stackedClass&&stackedFold?stackedFold.foldTop:null;const hingeBottom=stackedClass&&stackedFold?stackedFold.foldBottom:null;
 useLayoutEffect(()=>{if(stackedClass==null||hingeTop==null||hingeBottom==null)return;const root=document.documentElement;root.style.setProperty('--duo-hinge-top',hingeTop+'px');root.style.setProperty('--duo-hinge-bottom',hingeBottom+'px');root.classList.add(stackedClass);
  return()=>{root.style.removeProperty('--duo-hinge-top');root.style.removeProperty('--duo-hinge-bottom');root.classList.remove(stackedClass);};},[stackedClass,hingeTop,hingeBottom]);
 const Page=P.C;
 return <MobileFrame fullBleed={rightRail}><div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <main className={cn("app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)]","pb-[var(--app-nav-total-height)]",locked?"min-h-0 flex-1 overflow-hidden":"overflow-x-hidden overflow-y-auto")} style={rightRail?{paddingRight:RIGHT_RAIL_WIDTH_VAR}:undefined}>
   <div id="content" className={appContentWrapperClass(locked)} style={rightRail?{'--safe-area-right':'0px'}:undefined}><Page/></div>
  </main>
  <BottomNav hiddenOnKeyboard={false} placement={rightRail?'right-rail':'bottom'}/>
  {crop?<CropHost variant={crop}/>:null}
 </div></MobileFrame>;
}
function CropHost({variant}){const [file]=React.useState(()=>window.__cropFile);return <SharedImageCropEditor open file={file} variant={variant} onOpenChange={()=>{}} onConfirm={()=>{}} cancelLabel="取消" doneLabel="完成"/>;}
const LAP={laptop:true,foldTop:${TOP},foldBottom:${BOTTOM}};
const PANE={leftWidth:300,rightWidth:297,gutter:8,foldX:304};
const POSTURES={
 phone:{layout:{navPlacement:'bottom',tripLayout:'single',usableWidth:${W}},laptop:{laptop:false}},
 duoFolded:{layout:{navPlacement:'right-rail',tripLayout:'single',usableWidth:605},laptop:{laptop:false}},
 laptopBottom:{layout:{navPlacement:'bottom',tripLayout:'single',usableWidth:${W}},laptop:LAP},
 laptopRail:{layout:{navPlacement:'right-rail',tripLayout:'single',usableWidth:605},laptop:LAP},
 twoPane:{layout:{navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:605,pane:PANE},laptop:{laptop:false}},
 twoPaneAndLaptop:{layout:{navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:605,pane:PANE},laptop:LAP},
 laptopLow:{layout:{navPlacement:'bottom',tripLayout:'single',usableWidth:${W}},laptop:{laptop:true,foldTop:820,foldBottom:860}},
};
let rootEl=null;
function baseHtml(o){const h=document.documentElement;h.className=o.web?'':'native-shell';h.removeAttribute('style');
 h.style.setProperty('--safe-area-top',(o.safeTop||0)+'px');h.style.setProperty('--safe-area-bottom',(o.safeBottom||0)+'px');h.style.setProperty('--safe-area-left','0px');h.style.setProperty('--safe-area-right','0px');
 if(o.staleHinge){h.style.setProperty('--duo-hinge-top','${TOP}px');h.style.setProperty('--duo-hinge-bottom','${BOTTOM}px');}}
window.mount=async(o)=>{
 if(rootEl){flushSync(()=>rootEl.render(null));rootEl.unmount();rootEl=null;}
 baseHtml(o);window.__cfg=o.cfg||{};window.__path=PAGES[o.page].path;window.__counts={};window.__sbCalls=[];window.__serverFnNames=[];window.__fetches=[];window.__nav=[];
 setPlus(!!(o.cfg&&o.cfg.plus));setHomeRouteVisible(o.page==='home');
 const p=POSTURES[o.posture];setDuoLayout(p.layout);setDuoLaptop(p.laptop);
 sessionStorage.clear();localStorage.clear();
 if(o.crop){window.__cropFile=await makePng();}
 document.getElementById('root').innerHTML='';
 rootEl=createRoot(document.getElementById('root'));
 const shell=<Shell page={o.page} crop={o.crop||null}/>;
 flushSync(()=>rootEl.render(o.noStrict?shell:<StrictMode>{shell}</StrictMode>));
 return true;};
async function makePng(){const c=document.createElement('canvas');c.width=800;c.height=600;const g=c.getContext('2d');g.fillStyle='#c96';g.fillRect(0,0,800,600);
 const b=await new Promise(r=>c.toBlob(r,'image/png'));return new File([b],'p.png',{type:'image/png'});}
window.setPosture=(name)=>{const p=POSTURES[name];flushSync(()=>{setDuoLayout(p.layout);setDuoLaptop(p.laptop);});return true;};
window.unmountApp=()=>{flushSync(()=>rootEl.render(null));return {html:document.documentElement.className,bottoms:document.querySelectorAll('.home-laptop-bottom').length};};
window.settle=async()=>{for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,30));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
 document.getAnimations().forEach(a=>{try{a.finish()}catch{}});await new Promise(r=>requestAnimationFrame(r));return true;};
window.__ready=true;`;

const helpers = String.raw`
(()=>{
const q=(s,r=document)=>r.querySelector(s);const qa=(s,r=document)=>[...r.querySelectorAll(s)];
const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
const CLICK='a[href],button,input,select,textarea,label,[role=button],[role=tab],[role=link],[tabindex]:not([tabindex="-1"])';
window.H={q,qa,R,
 appTop(){return parseFloat(getComputedStyle(q('main.app-scroll')).paddingTop);},
 navTop(){const nav=q('nav.bottom-nav');if(!nav)return innerHeight;return nav.getBoundingClientRect().top;},
 navTotal(){const v=getComputedStyle(document.documentElement).getPropertyValue('--app-nav-total-height');const d=document.createElement('div');d.style.cssText='position:fixed;height:var(--app-nav-total-height);';document.body.appendChild(d);const h=d.getBoundingClientRect().height;d.remove();return h;},
 band(top,bottom,excludeRight){const hits=[];const xMax=innerWidth-(excludeRight||0);
  for(let y=Math.ceil(top+0.5);y<bottom-0.5;y+=3)for(let x=1;x<xMax;x+=6){const e=document.elementFromPoint(x,y);if(!e)continue;const c=e.closest(CLICK);
   if(c&&!c.closest('.app-right-rail'))hits.push({x,y,el:c.tagName+'.'+String(c.className).slice(0,60)+(c.getAttribute('aria-label')?'['+c.getAttribute('aria-label')+']':'')});}
  const seen=new Set();return hits.filter(h=>{if(seen.has(h.el))return false;seen.add(h.el);return true;});},
 ancestors(el){const out=[];for(let a=el.parentElement;a;a=a.parentElement){const cs=getComputedStyle(a);const name=a.tagName.toLowerCase()+(a.id?'#'+a.id:'')+(a.classList.length?'.'+[...a.classList].slice(0,2).join('.'):'');const bad=[];
  if(cs.transform!=='none')bad.push('transform:'+cs.transform);for(const k of ['translate','rotate','scale'])if(cs[k]&&cs[k]!=='none')bad.push(k+':'+cs[k]);
  if(cs.filter!=='none')bad.push('filter');if(cs.backdropFilter&&cs.backdropFilter!=='none')bad.push('backdrop-filter');if(cs.perspective!=='none')bad.push('perspective');
  if(cs.contain!=='none')bad.push('contain:'+cs.contain);if(cs.willChange!=='auto')bad.push('will-change:'+cs.willChange);
  if(cs.containerType&&cs.containerType!=='normal')bad.push('container-type');if(cs.contentVisibility&&cs.contentVisibility!=='visible')bad.push('content-visibility');
  if(/auto|scroll|overlay/.test(cs.overflowX)||/auto|scroll|overlay/.test(cs.overflowY))bad.push('overflow:'+cs.overflowX+'/'+cs.overflowY);
  if(bad.length)out.push(name+' → '+bad.join(', '));}return out;},
 fixedInside(rootEl){return qa('*',rootEl).filter(e=>getComputedStyle(e).position==='fixed').map(e=>e.tagName+'.'+String(e.className).slice(0,60));},
 hit(el){if(!el)return false;const b=el.getBoundingClientRect();if(b.width<1||b.height<1)return false;const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return !!e&&(e===el||el.contains(e));},
 scrollEnd(el){el.scrollTop=el.scrollHeight;return {top:el.scrollTop,max:el.scrollHeight-el.clientHeight,sh:el.scrollHeight,ch:el.clientHeight};},
 lastClickable(el){const all=qa('a[href],button',el).filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(e).visibility!=='hidden';});return all[all.length-1]||null;},
 snapshotDom(){const c=q('#content');const clone=c.cloneNode(true);
  const walk=(n)=>{if(n.nodeType!==1)return;for(const a of [...n.attributes]){if(/^(id|aria-controls|aria-labelledby|aria-describedby|data-token|style)$/.test(a.name)&&/«|:r|radix/.test(a.value))n.removeAttribute(a.name);}[...n.children].forEach(walk);};walk(clone);
  return clone.innerHTML.replace(/«[^»]*»/g,'«id»').replace(/:r[0-9a-z]+:/g,':rid:').replace(/expires=\d+/g,'expires=N');},
 geometry(){const els=qa('body *').filter(e=>!e.closest('script,style'));
  return els.map((e,i)=>{const b=e.getBoundingClientRect();const cs=getComputedStyle(e);
   return [e.tagName,String(e.className).slice(0,80),Math.round(b.left*10)/10,Math.round(b.top*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10,
    cs.position,cs.display,cs.overflowX,cs.overflowY,cs.gridTemplateRows,cs.marginBottom,cs.paddingBottom,cs.zIndex,cs.visibility,cs.maxHeight,cs.top,cs.bottom,cs.transform].join('|');});},
 htmlClass(){return document.documentElement.className;},
 name(e){return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.classList.length?'.'+[...e.classList].slice(0,3).join('.'):'');},
 // React fiber 樹（元件型別＋key，依深度），用來證明筆電與手機的 React 樹相同（不含 props）
 fiber(){const c=q('#root');const k=Object.keys(c).find(k=>k.startsWith('__reactContainer$'));if(!k)return 'no-root';const out=[];
  const nm=(t,tag)=>{if(t==null)return 'tag'+tag;if(typeof t==='string')return t;if(typeof t==='symbol')return t.toString();if(typeof t==='function')return t.displayName||t.name||'anon';
   return t.displayName||(t.render&&(t.render.displayName||t.render.name))||(t.type&&(t.type.displayName||t.type.name))||(t._context?'ctx':'obj');};
  const walk=(f,d)=>{for(;f;f=f.sibling){out.push(d+':'+nm(f.type,f.tag)+(f.key!=null?'#'+f.key:''));walk(f.child,d+1);}};
  // container 上的 fiber 是建立時的 HostRoot，commit 後會與 alternate 輪替；以 FiberRoot.current 取目前樹
  walk(c[k].stateNode.current.child,0);return out.join('\n');},
};
})();`;

// ───────────────────────── Part B：瀏覽器 ─────────────────────────
if (!chromeBin) {
  failures.push("無可用 Chrome");
  console.log("FAIL 無可用 Chrome，未執行");
} else {
  await run();
}

async function run() {
  const { build } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-laptop-shp-"));
  const compileCss = async (src) => {
    const compiler = await compile(src.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    const scanner = new Scanner({ sources: compiler.sources });
    return compiler.build(scanner.scan());
  };
  const cssNew = await compileCss(styles);
  const cssOld = await compileCss(styles.slice(0, shpRegionStart) + styles.slice(shpRegionEnd));
  const cssR1 = await compileCss(stylesR1);
  // #H2b-5：編譯後的 CSS 也不得有首頁／我的版面規則；cssR1 只少第 2 輪（收藏框線／空白卡、裁切例外），cssOld 不含任何收藏／首頁／我的規則
  assert.doesNotMatch(cssNew, REMOVED_LAYOUT, "編譯後 CSS 殘留首頁／我的版面規則");
  assert.match(cssR1, /saved-laptop-root/);
  assert.match(cssR1, /home-laptop-active/);
  for (const s of ['[class*="h-[92dvh]"]', "section:last-child > .border-dashed"]) assert.ok(cssNew.includes(s) && !cssR1.includes(s), "cssR1 切分：" + s);
  assert.match(cssNew, /home-laptop-active/);
  assert.doesNotMatch(cssOld, /saved-laptop|home-laptop|profile-laptop/);

  // HEAD 版三個頁面：git show 取得，放在 src 同層的暫存路徑無法（不得寫入 src），改以 esbuild onLoad 依路徑替換內容
  const ROUTES = ["src/routes/_app.saved.index.tsx", "src/routes/_app.index.tsx", "src/routes/_app.profile.tsx"];
  let headSources = null;
  try {
    headSources = Object.fromEntries(
      ROUTES.map((r) => [path.join(root, r), execFileSync("git", ["show", "HEAD:" + r], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 })]),
    );
  } catch (e) {
    info("無法取得 HEAD 版頁面（" + String(e.message).slice(0, 80) + "），N1 改用結構斷言");
  }
  // #TS-PE2 預期差異：使用者要求移除「我的」底部版本號（<p …font-mono…>{ROAMIE_BUILD_DEBUG}</p> 與其 import）。
  //   比對基準＝HEAD 版去掉「恰好這一段」；其餘 DOM 仍逐字比對。HEAD 若已無此段或出現多次即 FAIL（基準需重新檢視），
  //   工作區若仍引用版本號亦 FAIL（需求未達成）。
  if (headSources) {
    const profileKey = path.join(root, "src/routes/_app.profile.tsx");
    const VERSION_P = /\n[ \t]*<p className="mt-2 text-center font-mono text-\[10px\] text-muted-foreground\/70">\s*\{ROAMIE_BUILD_DEBUG\}\s*<\/p>/g;
    const VERSION_IMPORT = /\nimport \{ ROAMIE_BUILD_DEBUG \} from "@\/lib\/app-bundle-version";/g;
    await check("V0 預期差異基準：HEAD 版「我的」恰有 1 段版本號＋1 個 import；工作區已移除（不再引用 ROAMIE_BUILD_DEBUG）", () => {
      const headProfile = headSources[profileKey];
      assert.equal(headProfile.match(VERSION_P)?.length ?? 0, 1, "HEAD 版本號段落數");
      assert.equal(headProfile.match(VERSION_IMPORT)?.length ?? 0, 1, "HEAD 版本號 import 數");
      assert.doesNotMatch(read("src/routes/_app.profile.tsx"), /ROAMIE_BUILD_DEBUG/, "工作區仍引用版本號");
      headSources[profileKey] = headProfile.replace(VERSION_P, "").replace(VERSION_IMPORT, "");
    });
  }

  const bundle = async (variant) => {
    const outfile = path.join(dir, `app-${variant}.js`);
    await build({
      stdin: { contents: entry(variant), resolveDir: root, loader: "tsx" },
      bundle: true,
      logLevel: "error",
      outfile,
      format: "iife",
      jsx: "automatic",
      jsxDev: true,
      platform: "browser",
      alias: { "@": path.join(root, "src") },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".woff2": "empty", ".woff": "empty" },
      define: {
        "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development","SSR":false}',
        "process.env.NODE_ENV": '"development"',
      },
      plugins: [
        {
          name: "mocks",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
            b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
            if (variant === "head" && headSources)
              b.onLoad({ filter: /src[\\/]routes[\\/]_app\.(saved\.index|index|profile)\.tsx$/ }, (a) =>
                headSources[a.path] != null ? { contents: headSources[a.path], loader: "tsx", resolveDir: path.dirname(a.path) } : null,
              );
          },
        },
      ],
    });
    return outfile;
  };
  const jsNew = await bundle("new");
  const jsHead = headSources ? await bundle("head") : null;

  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const serverHits = [];
  const fetchStub = String.raw`<script>(function(){const real=window.fetch.bind(window);
window.fetch=async function(input,init){const url=typeof input==='string'?input:(input&&input.url)||String(input);(window.__fetches||(window.__fetches=[])).push(url);
 if(url.includes('/api/place-photo/sign')){if(window.__cfg&&window.__cfg.signFail)return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
  let body={};try{body=JSON.parse(init&&init.body||'{}')}catch{}const exp=Math.floor(Date.now()/1000)+3600;
  return new Response(JSON.stringify({url:'/api/place-photo?photo='+encodeURIComponent(body.photo||'x')+'&width='+(body.width||480)+'&expires='+exp+'&signature=sig'}),{status:200,headers:{'content-type':'application/json'}});}
 return new Response('{}',{status:404,headers:{'content-type':'application/json'}});};})();</script>`;
  const server = http.createServer((req, res) => {
    const u = req.url || "/";
    if (u.startsWith("/app-")) {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, u.slice(1).split("?")[0])));
      return;
    }
    if (u.startsWith("/api/") || u.startsWith("/img")) {
      serverHits.push(u);
      res.setHeader("Content-Type", "image/png");
      // 與 src/routes/api/place-photo.ts 相同的快取標頭（public, max-age=300）
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=540");
      res.end(PNG);
      return;
    }
    const params = new URL(u, "http://x").searchParams;
    const css = params.get("css") === "old" ? cssOld : params.get("css") === "r1" ? cssR1 : cssNew;
    const js = params.get("js") === "head" ? "/app-head.js" : "/app-new.js";
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' +
        css +
        "</style>" +
        fetchStub +
        '</head><body style="margin:0"><div id="root"></div><script src="' +
        js +
        '"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const chrome = spawn(
    chromeBin,
    // #P1-T2：--disable-frame-rate-limit／--disable-gpu-vsync 讓 requestAnimationFrame 不鎖 60Hz（settle 的雙 rAF 不再各等一個 vsync），
    //   只縮短等待、不改變 settle 的步驟順序與次數；整支原本約 11 分鐘。
    ["--headless", "--disable-gpu", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const externalRequests = [];
  const browserErrors = [];
  const netLog = [];
  let mountLabel = "load";
  let preexistingCropLoop = false;
  onFatalTimeout = () => chrome.kill("SIGKILL");
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
    await new Promise((r, reject) => {
      ws.addEventListener("open", r, { once: true });
      setTimeout(() => reject(Error("DevTools WebSocket 連線逾時")), 15000).unref();
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const r = JSON.parse(e.data);
      if (r.method === "Runtime.exceptionThrown") browserErrors.push(r.params.exceptionDetails.exception?.description ?? r.params.exceptionDetails.text);
      if (r.method === "Runtime.consoleAPICalled" && r.params.type === "error")
        browserErrors.push(`[${mountLabel}] console.error: ` + r.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 1500));
      if (r.method === "Network.requestWillBeSent") {
        const u = r.params.request.url;
        netLog.push(u);
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
        const label = method + (params.expression ? " " + String(params.expression).replace(/\s+/g, " ").slice(0, 160) : params.url ? " " + params.url : "");
        progress.cdp = label;
        const timer = setTimeout(() => {
          pending.delete(next);
          const err = Error(`CDP 單步逾時（${STEP_TIMEOUT_MS / 1000}s）：\n     ${progressText()}`);
          err.cdpTimeout = true;
          // 逾時視為致命：頁面主執行緒可能卡住，後續步驟不可信 → 印出步驟後直接非 0 結束
          console.log("FAIL " + err.message);
          try {
            onFatalTimeout();
          } catch {}
          process.exit(3);
        }, STEP_TIMEOUT_MS);
        const t0 = Date.now();
        pending.set(next, {
          resolve: (v) => {
            clearTimeout(timer);
            // DUO_VERIFY_TRACE=1：列出超過 1 秒的 CDP 指令（定位慢步驟用）
            if (TRACE && Date.now() - t0 > 1000) console.log(`     （trace）${Date.now() - t0}ms ${label.slice(0, 120)}`);
            if (TRACE) {
              const k = label.slice(0, 48);
              const s = (traceStats[k] ||= { n: 0, ms: 0 });
              s.n++;
              s.ms += Date.now() - t0;
            }
            resolve(v);
          },
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
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
    let loaded = null;
    const viewport = async (w, h) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    const load = async (js = "new", css = "new") => {
      const key = js + "/" + css;
      // 每次掛載都重新載入頁面：模組層快取（profile-session-cache、signed-place-photo…）不跨情境殘留
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/?js=${js}&css=${css}` });
      for (let i = 0; i < 150 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.join("\n"));
      await evaluate(helpers);
      loaded = key;
    };
    await viewport(W, H);
    await load();

    const near = (a, b, msg, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
    const mount = async (o, js = "new", css = "new") => {
      await load(js, css);
      // 舊頁面已卸載；等殘留的 CDP 事件送達後才切換標籤，避免錯誤被歸到下一個情境
      await new Promise((r) => setTimeout(r, 150));
      mountLabel = `${o.page}/${o.posture}/${js}/${css}${o.crop ? "/crop:" + o.crop : ""}/${JSON.stringify(o.cfg || {})}`;
      progress.scenario = mountLabel + (o.noStrict ? "/noStrict" : "") + (o.safeBottom ? "/safeBottom=" + o.safeBottom : "");
      await evaluate(`window.mount(${JSON.stringify(o)})`);
      for (let i = 0; i < 8; i++) await evaluate("window.settle()");
    };
    const ev = (fn) => evaluate(`(${fn})()`);
    const counts = () => evaluate("JSON.parse(JSON.stringify({c:window.__counts||{},sb:window.__sbCalls||[],sf:(window.__serverFnNames||[]).length,f:window.__fetches||[]}))");

    const LAPTOPS = [
      { name: "laptopBottom safe-bottom=0", posture: "laptopBottom", safeBottom: 0, rail: false },
      { name: "laptopBottom safe-bottom=20", posture: "laptopBottom", safeBottom: 20, rail: false },
      { name: "laptopRail", posture: "laptopRail", safeBottom: 0, rail: true },
    ];

    // ─────────── S：收藏 ───────────
    const inspectSaved = () =>
      ev(`()=>{const {q,qa,R}=H;const root=q('.saved-laptop-root')||q('#content > div');const header=q('.saved-duo-header');const panes=q('.saved-duo-panes');
       const secs=panes?[...panes.children]:[];const main=q('main.app-scroll');
       const r={rootCls:root&&root.className,root:R(root),header:R(header),trips:R(secs[0]),places:R(secs[1]),appTop:H.appTop(),navTop:H.navTop(),navTotal:H.navTotal(),
        mainScroll:{sh:main.scrollHeight,ch:main.clientHeight},htmlClass:H.htmlClass(),fixed:root?H.fixedInside(root):[],tabBar:!!q('#content .rounded-full.border.p-1'),
        secOverflow:secs.map(s=>getComputedStyle(s).overflowY),secScroll:secs.map(s=>({sh:s.scrollHeight,ch:s.clientHeight})),anc:secs[0]?H.ancestors(secs[0]):[]};
       return r;}`);
    const scrollSavedSection = (i) =>
      ev(`()=>{const s=[...H.q('.saved-duo-panes').children][${i}];const st=H.scrollEnd(s);const last=H.lastClickable(s);const r=H.R(last);const sr=H.R(s);
       return {st,last:r,label:last&&(last.getAttribute('aria-label')||last.textContent.slice(0,20)),hit:H.hit(last),inside:!!r&&r.t>=sr.t-0.5&&r.b<=sr.b+0.5};}`);
    const assertSaved = (m, L) => {
      assert.match(m.rootCls || "", /saved-laptop-root/, "缺 saved-laptop-root");
      assert.ok(m.htmlClass.includes("saved-laptop-active"), "html 缺 saved-laptop-active");
      assert.equal(m.tabBar, false, "筆電不得顯示分頁列");
      near(m.root.t, m.appTop, "根節點上緣＝main 上內距");
      // #H2b-4 決定 4：下緣＝底部導覽實際上緣（含 1px border-t）；直欄時＝視窗下緣
      near(m.navTop, L.rail ? H : H - m.navTotal - 1, "導覽上緣（含 1px 上框線）");
      near(m.root.b, m.navTop, "根節點下緣＝底部導覽上緣（含框線）");
      assert.ok(m.header.t >= m.appTop - 0.5 && m.header.b <= m.trips.t + 0.5, "標題在行程區之上：" + JSON.stringify([m.header, m.trips]));
      near(m.trips.b, TOP, "行程區下緣＝摺痕上緣");
      near(m.places.t, BOTTOM, "地點區上緣＝摺痕下緣");
      near(m.places.b, m.navTop, "地點區下緣＝底部導覽上緣（含框線）");
      near(m.places.l, 0, "地點區左緣");
      near(m.places.r, L.rail ? W - RAIL : W, "地點區右緣");
      assert.ok(m.mainScroll.sh <= m.mainScroll.ch + 1, "main 不得有捲動量：" + JSON.stringify(m.mainScroll));
      assert.deepEqual(m.fixed, [], "收藏根節點內不得有 fixed 子孫");
      assert.deepEqual(m.secOverflow, ["auto", "auto"], "兩區各自捲動");
    };
    for (const L of LAPTOPS) {
      await viewport(W, H);
      await mount({ page: "saved", posture: L.posture, safeBottom: L.safeBottom, cfg: { trips: 9, places: 10 } });
      const m = await inspectSaved();
      const band = await evaluate(`H.band(${TOP},${BOTTOM},${L.rail ? RAIL : 0})`);
      const s0 = await scrollSavedSection(0);
      const s1 = await scrollSavedSection(1);
      await check(`S1 收藏筆電（${L.name}）：標題＋行程 [頂端, 摺痕上緣]、地點 [摺痕下緣, 導覽上緣]、各自捲動到底最後按鈕可點、摺痕帶無可點元素`, () => {
        assertSaved(m, L);
        assert.ok(m.secScroll[0].sh > m.secScroll[0].ch && m.secScroll[1].sh > m.secScroll[1].ch, "9 行程／10 地點應可捲動：" + JSON.stringify(m.secScroll));
        assert.ok(s0.st.top > 0 && Math.abs(s0.st.top - s0.st.max) <= 1 && s0.inside && s0.hit, "行程區捲到底最後按鈕可點：" + JSON.stringify(s0));
        assert.ok(s1.st.top > 0 && Math.abs(s1.st.top - s1.st.max) <= 1 && s1.inside && s1.hit, "地點區捲到底最後按鈕可點：" + JSON.stringify(s1));
        assert.ok(s1.last.b <= m.navTop + 0.5 && s0.last.b <= TOP + 0.5, "最後按鈕在各自區域內");
        assert.deepEqual(band, [], "摺痕帶有可點元素");
        info(`導覽上緣 ${m.navTop}（--app-nav-total-height ${m.navTotal}）；行程區 [${m.trips.t}, ${m.trips.b}]；地點區 [${m.places.t}, ${m.places.b}] 寬 ${m.places.w}；main 祖先鏈：${m.anc.join(" ; ")}`);
      });
    }
    // #H2b-4 決定 3：下半部「還沒有收藏地點」提示卡整張位於 [摺痕下緣, 導覽上緣]（不捲動）、按鈕可點；
    //   規則 section:last-child > .border-dashed 只命中地點區空白卡（行程區空白卡、有地點時的列表不受影響）
    const inspectSavedEmpty = () =>
      ev(`()=>{const secs=[...H.q('.saved-duo-panes').children];secs.forEach(s=>s.scrollTop=0);
       const card=H.q(':scope > .border-dashed',secs[1]);const tcard=H.q(':scope > .border-dashed',secs[0]);const btns=card?H.qa('a[href],button',card):[];
       return {card:H.R(card),tcard:H.R(tcard),tPad:tcard&&getComputedStyle(tcard).paddingTop,pPad:card&&getComputedStyle(card).paddingTop,
        btns:btns.map(b=>({r:H.R(b),hit:H.hit(b),txt:b.textContent.trim().slice(0,12)})),sec:H.R(secs[1]),secScroll:{sh:secs[1].scrollHeight,ch:secs[1].clientHeight},
        navTop:H.navTop(),dashedAll:H.qa('.saved-laptop-root .border-dashed').length};}`);
    for (const L of LAPTOPS) {
      await viewport(W, H);
      await mount({ page: "saved", posture: L.posture, safeBottom: L.safeBottom, cfg: { trips: 0, places: 0 } });
      const e = await inspectSavedEmpty();
      await check(`S3 收藏筆電空白提示卡（${L.name}）：整張在 [摺痕下緣, 導覽上緣]、不需捲動、按鈕可點；行程區空白卡不受影響`, () => {
        info(`[收藏空白 ${L.name}] 地點提示卡 [${e.card?.t.toFixed(1)}, ${e.card?.b.toFixed(1)}]（padding-top ${e.pPad}）；導覽上緣 ${e.navTop}；地點區 [${e.sec.t}, ${e.sec.b}] scroll ${JSON.stringify(e.secScroll)}；按鈕 ${JSON.stringify(e.btns)}；行程區空白卡 [${e.tcard?.t.toFixed(1)}, ${e.tcard?.b.toFixed(1)}] padding-top ${e.tPad}`);
        assert.ok(e.card, "找不到地點區空白提示卡");
        assert.ok(e.card.t >= BOTTOM - 0.5 && e.card.b <= e.navTop + 0.5, `提示卡 [${e.card.t}, ${e.card.b}] 超出 [${BOTTOM}, ${e.navTop}]`);
        assert.ok(e.btns.length >= 1 && e.btns.every((b) => b.hit && b.r.b <= e.navTop + 0.5), "按鈕不可點／被導覽遮住：" + JSON.stringify(e.btns));
        assert.equal(e.tPad, "48px", "行程區空白卡 padding（py-12）被改動");
        assert.equal(e.dashedAll, 2);
      });
    }
    await mount({ page: "saved", posture: "laptopBottom", cfg: { trips: 0, places: 3 } });
    {
      const n = await ev(`()=>{const s=[...H.q('.saved-duo-panes').children][1];return H.qa(':scope > .border-dashed',s).length;}`);
      await check("S4 收藏筆電有地點時：地點區沒有 .border-dashed 直接子節點（空白卡規則不誤中列表）", () => assert.equal(n, 0));
    }
    // 空狀態
    await mount({ page: "saved", posture: "laptopBottom", cfg: { trips: 0, places: 0 } });
    {
      const m = await inspectSaved();
      const band = await evaluate(`H.band(${TOP},${BOTTOM},0)`);
      const r = await ev(`()=>{const s=[...H.q('.saved-duo-panes').children];return s.map(x=>{const l=H.qa('a[href]',x);H.scrollEnd(x);return l.map(a=>({hit:H.hit(a),r:H.R(a),sr:H.R(x)}));});}`);
      await check("S2 收藏筆電空狀態：兩區空狀態 CTA 捲入後可點、摺痕帶無可點元素", () => {
        near(m.trips.b, TOP, "行程區下緣");
        near(m.places.t, BOTTOM, "地點區上緣");
        assert.deepEqual(band, []);
        for (const sec of r) for (const a of sec) assert.ok(a.hit || a.r.b > a.sr.b, "CTA 不可點：" + JSON.stringify(a));
        assert.ok(r[0].length >= 1 && r[1].length >= 1);
      });
    }

    // ─────────── H／P：首頁、我的（#H2b-5：筆電與手機相同，一頁式捲動） ───────────
    // 對照姿勢：底部導覽筆電 ↔ 手機（同 viewport、同 safe-area）；直欄筆電 ↔ Duo 合起（同為右側直欄）
    const ONE = {
      home: { scroller: "main.app-scroll", root: "#content > div", cls: "home-laptop-active" },
      profile: { scroller: ".profile-page", root: ".profile-page", cls: "profile-laptop-active" },
    };
    const HIDDEN_INPUT = /^input\.pointer-events-none\.fixed\.left-0$/;
    const waitImages = async () => {
      const t0 = Date.now();
      let i = 0;
      // #P1-T2：只等「IntersectionObserver 看得到」的圖片骨架：元素矩形先被各個 overflow 非 visible 的祖先裁切（例如首頁附近推薦的
      //   橫向捲動列），再與 viewport（外擴 120px，≥ 元件 rootMargin 80px）相交。看不到的 lazy 封面（useInViewport，root=null）
      //   在未捲動前永遠不會開始載入，等待只會白耗 20 次 settle（每次 inspectOne 約 6.5 秒，整支因此超過 10 分鐘）。
      //   筆電與對照姿勢量測時同樣停在未捲動狀態，比對結果不受影響；不放寬任何斷言。
      const pendingInView = `[...document.querySelectorAll('#content .animate-pulse.bg-secondary\\\\/80')].some(e=>{const b=e.getBoundingClientRect();
        let l=b.left,t=b.top,r=b.right,bt=b.bottom;
        for(let a=e.parentElement;a&&a!==document.body;a=a.parentElement){const cs=getComputedStyle(a);if(cs.overflowX==='visible'&&cs.overflowY==='visible')continue;
          const c=a.getBoundingClientRect();l=Math.max(l,c.left);t=Math.max(t,c.top);r=Math.min(r,c.right);bt=Math.min(bt,c.bottom);}
        l=Math.max(l,-120);t=Math.max(t,-120);r=Math.min(r,innerWidth+120);bt=Math.min(bt,innerHeight+120);return r>l&&bt>t;})`;
      for (; i < 20 && (await evaluate(pendingInView)); i++) await evaluate("window.settle()");
      if (TRACE && i > 0)
        console.log(
          `     （trace）waitImages ${i} 次 settle、${Date.now() - t0}ms［${progress.scenario}］殘留骨架：` +
            (await evaluate(
              "JSON.stringify([...document.querySelectorAll('#content .animate-pulse.bg-secondary\\\\/80')].slice(0,3).map(e=>{const b=e.getBoundingClientRect();const chain=[];for(let a=e.parentElement;a&&a.id!=='content'&&chain.length<7;a=a.parentElement)chain.push(H.name(a));return {rect:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)],chain,imgs:e.parentElement.querySelectorAll('img').length};}))",
            )) +
            `；fetches=${JSON.stringify(await evaluate("(window.__fetches||[]).map(u=>u.replace(/signature=[^&]*/,'signature=…')).slice(0,6)"))}`,
        );
    };
    const inspectOne = async (page) =>
      (await waitImages(),
      ev(`()=>{const {q,qa,R}=H;const P=${JSON.stringify(ONE[page])};const sc=q(P.scroller);sc.scrollTop=0;
       const vScrollers=qa('body *').filter(e=>{const cs=getComputedStyle(e);return /auto|scroll|overlay/.test(cs.overflowY)&&e.scrollHeight>e.clientHeight+1;}).map(H.name);
       const fixed=qa('body *').filter(e=>getComputedStyle(e).position==='fixed').map(e=>({n:H.name(e),anc:H.ancestors(e),inScroller:!!e.parentElement&&!!e.parentElement.closest(P.scroller)}));
       return {html:H.htmlClass(),dom:H.snapshotDom(),fiber:H.fiber(),geo:H.geometry(),bodyKids:[...document.body.children].filter(e=>e.tagName!=='SCRIPT').map(H.name),
        leftover:qa('body [class*="home-laptop"],body [class*="profile-laptop"]').map(H.name),vScrollers,fixed,sc:{sh:sc.scrollHeight,ch:sc.clientHeight},
        cards:qa('article.home-nearby-card-item').length,appTop:H.appTop(),navTop:H.navTop(),navTotal:H.navTotal()};}`));
    // 每個可點元素捲入（block center）後可點、不被導覽遮住；再捲到底量最後元素下緣
    const reachOne = (page) =>
      ev(`()=>{const {q,qa,R}=H;const P=${JSON.stringify(ONE[page])};const sc=q(P.scroller);const root=q(P.root);const navTop=H.navTop();const appTop=H.appTop();
       const vis=e=>{const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return false;for(let a=e;a;a=a.parentElement){const cs=getComputedStyle(a);
        if(cs.visibility==='hidden'||cs.display==='none'||cs.opacity==='0'||a.getAttribute('aria-hidden')==='true')return false;}return true;};
       const items=qa('a[href],button,[role=button]',root).filter(vis);const bad=[];
       for(const e of items){e.scrollIntoView({block:'center',inline:'nearest'});const r=R(e);const hit=H.hit(e);
        if(!(hit&&r.b<=navTop+0.5&&r.t>=appTop-0.5))bad.push({n:(e.getAttribute('aria-label')||e.textContent.trim()).slice(0,24),r,hit});}
       qa('*',root).forEach(e=>{if(e!==sc&&e.scrollLeft)e.scrollLeft=0;});
       const st=H.scrollEnd(sc);const kids=[...root.children].filter(e=>e.getBoundingClientRect().height>0&&e.getAttribute('aria-hidden')!=='true');const last=kids[kids.length-1];
       const lc=H.lastClickable(root);const res={count:items.length,bad,st,last:R(last),lastTag:last&&H.name(last),lc:R(lc),lcHit:H.hit(lc),lcTxt:lc&&(lc.getAttribute('aria-label')||lc.textContent.trim()).slice(0,24),navTop,appTop};
       sc.scrollTop=0;return res;}`);
    const fixedNames = (m) => m.fixed.map((f) => f.n);
    const assertOnePage = (page, m, ref, s, L) => {
      const P = ONE[page];
      assert.ok(m.html.split(/\s+/).includes(P.cls), "html 缺 " + P.cls + "：" + m.html);
      assert.doesNotMatch(ref.html, /laptop/, "對照姿勢 html 不應有 laptop：" + ref.html);
      // html 只多 duo-laptop／*-laptop-active
      const extra = m.html.split(/\s+/).filter((c) => c && !ref.html.split(/\s+/).includes(c));
      assert.deepEqual(extra.sort(), ["duo-laptop", P.cls].sort(), "html class 差異");
      assert.deepEqual(m.leftover, [], "DOM 殘留 home-laptop／profile-laptop class");
      if (m.dom !== ref.dom) {
        let i = 0;
        while (i < m.dom.length && m.dom[i] === ref.dom[i]) i++;
        assert.fail(`#content DOM 與對照姿勢不同（第 ${i} 字元）：\n  筆電：${m.dom.slice(Math.max(0, i - 120), i + 160)}\n  對照：${ref.dom.slice(Math.max(0, i - 120), i + 160)}`);
      }
      assert.equal(m.fiber, ref.fiber, "React fiber 樹與對照姿勢不同");
      assert.deepEqual(m.bodyKids, ref.bodyKids, "body 子節點不同（不得有 portal 容器）");
      assert.deepEqual(m.vScrollers, ref.vScrollers, "垂直捲動容器與對照姿勢不同");
      assert.equal(
        m.vScrollers.length,
        1,
        "垂直捲動容器數：" + m.vScrollers.join(" | ") + `（捲動容器 scrollHeight/clientHeight：筆電 ${m.sc.sh}/${m.sc.ch}、對照 ${ref.sc.sh}/${ref.sc.ch}）`,
      );
      assert.ok(m.vScrollers[0].includes("." + P.scroller.split(".").pop()), "捲動容器應為 " + P.scroller + "：" + m.vScrollers[0]);
      assert.ok(m.sc.sh > m.sc.ch, "內容應超過一屏而可捲動：" + JSON.stringify(m.sc));
      assert.deepEqual(fixedNames(m), fixedNames(ref), "fixed 元素集合與對照姿勢不同");
      // iOS WebKit 會裁切捲動容器內的 fixed：除 ImageSourceSheet 的隱藏 file input（1px、透明、不可點，既有結構）外，fixed 元素不得在捲動容器內、祖先鏈不得有 fixed 包含塊／捲動容器
      const badFixed = m.fixed.filter((f) => !HIDDEN_INPUT.test(f.n) && (f.inScroller || f.anc.length));
      assert.deepEqual(badFixed, [], "fixed 元素祖先鏈不乾淨");
      near(m.navTop, L.rail ? H : H - m.navTotal - 1, "導覽上緣（含 1px 上框線）");
      assert.ok(s.st.top > 0 && Math.abs(s.st.top - s.st.max) <= 1, "未捲到底：" + JSON.stringify(s.st));
      assert.ok(s.last && s.last.b <= s.navTop + 0.5, `捲到底最後元素 ${s.lastTag} 下緣 ${s.last?.b} 被導覽（上緣 ${s.navTop}）遮住`);
      assert.ok(s.lcHit && s.lc.b <= s.navTop + 0.5, "捲到底最後可點元素：" + JSON.stringify({ lc: s.lc, hit: s.lcHit, t: s.lcTxt }));
      assert.deepEqual(s.bad, [], `可點元素捲入後不可點或被導覽遮住（共 ${s.count} 個）`);
      assert.ok(s.count >= 5, "可點元素數：" + s.count);
      // 位置／樣式比對放最後（B0c 用以確認前面各項斷言各自有效）
      const diff = m.geo.map((g, i) => (g !== ref.geo[i] ? `#${i}\n  筆電：${g}\n  對照：${ref.geo[i]}` : null)).filter(Boolean);
      assert.equal(m.geo.length, ref.geo.length, "元素數量不同");
      assert.deepEqual(diff.slice(0, 5), [], "元素位置／樣式與對照姿勢不同");
    };
    const onePageResults = [];
    const runOnePage = async (page, L, cfg, tag, noStrict) => {
      const refPosture = L.rail ? "duoFolded" : "phone";
      await viewport(W, H);
      await mount({ page, posture: refPosture, safeBottom: L.safeBottom, noStrict, cfg });
      const ref = await inspectOne(page);
      const sref = await reachOne(page);
      await mount({ page, posture: L.posture, safeBottom: L.safeBottom, noStrict, cfg }, "new", "old");
      const old = await inspectOne(page);
      await mount({ page, posture: L.posture, safeBottom: L.safeBottom, noStrict, cfg });
      const m = await inspectOne(page);
      const band = await evaluate(`H.band(${TOP},${BOTTOM},${L.rail ? RAIL : 0})`);
      const s = await reachOne(page);
      onePageResults.push({ page, L, tag, m, s });
      await check(`${page === "home" ? "H1 首頁" : "P1 我的"}筆電（${L.name}，${tag}）：與 ${refPosture} 相同的一頁式捲動（DOM／fiber／位置／捲動容器／fixed 祖先鏈）、無版面規則作用、全部可點元素可達、最後元素不被導覽遮住`, () => {
        info(
          `[${page} ${L.name}，${tag}] 導覽上緣 ${s.navTop}（--app-nav-total-height ${m.navTotal}）；捲到底 scroll ${JSON.stringify(s.st)}；最後元素 ${s.lastTag} 下緣 ${s.last?.b.toFixed(1)}（距導覽上緣 ${(s.navTop - s.last?.b).toFixed(1)}px）；` +
            `最後可點「${s.lcTxt}」下緣 ${s.lc?.b.toFixed(1)}（距 ${(s.navTop - s.lc?.b).toFixed(1)}px）；對照 ${refPosture}：最後元素下緣 ${sref.last?.b.toFixed(1)}、導覽上緣 ${sref.navTop}；` +
            `可點元素 ${s.count} 個、不可達 ${s.bad.length}；捲動容器 ${m.vScrollers.join(",")}；fixed ${fixedNames(m).join(",")}；摺痕帶（未捲動）可點元素 ${band.length}（一頁式，允許）`,
        );
        assertOnePage(page, m, ref, s, L);
        assert.deepEqual(s.bad, sref.bad);
        near(s.last.b, sref.last.b, "最後元素下緣與對照姿勢");
        const od = m.geo.map((g, i) => (g !== old.geo[i] ? `#${i}\n  目前 CSS：${g}\n  移除新規則：${old.geo[i]}` : null)).filter(Boolean);
        assert.equal(m.geo.length, old.geo.length);
        assert.deepEqual(od.slice(0, 5), [], "筆電時目前 CSS 與移除收藏／首頁／我的規則時位置不同（仍有版面規則作用）");
        if (page === "home" && noStrict) assert.equal(m.cards, 6, "附近卡片數");
      });
    };
    {
      const out = [];
      for (const noStrict of [false, true])
        for (const posture of ["phone", "laptopBottom"]) {
          await viewport(W, H);
          await mount({ page: "home", posture, noStrict, cfg: { latestTrip: true, places: 2 } });
          out.push(`${noStrict ? "無" : ""}StrictMode/${posture}: 卡片 ${await evaluate("H.qa('article.home-nearby-card-item').length")}、骨架 ${await evaluate("H.qa('.home-nearby-cards--loading').length")}、loadHomeNearbyPicks ${await evaluate("(window.__counts||{}).loadHomeNearbyPicks||0")}`);
        }
      if (jsHead) {
        await mount({ page: "home", posture: "phone", cfg: { latestTrip: true, places: 2 } }, "head", "old");
        out.push(`HEAD 版 StrictMode/phone: 卡片 ${await evaluate("H.qa('article.home-nearby-card-item').length")}、骨架 ${await evaluate("H.qa('.home-nearby-cards--loading').length")}`);
      }
      info("首頁附近推薦渲染（StrictMode 開發模式下停在骨架為既有行為，與本任務無關；H／X 以無 StrictMode 量測卡片，StrictMode 另測資料抓取）：" + out.join("；"));
    }
    for (const L of LAPTOPS)
      for (const plus of [false, true])
        for (const withTrip of [true, false])
          await runOnePage("home", L, { plus, latestTrip: withTrip, places: 2 }, `${plus ? "Plus" : "Free"}，${withTrip ? "有" : "無"}最近行程`, true);
    // StrictMode（開發模式）：骨架停留為既有行為，仍需 DOM／fiber／捲動結構與手機相同
    await runOnePage("home", LAPTOPS[0], { latestTrip: true, places: 2 }, "StrictMode，有最近行程", false);
    for (const L of LAPTOPS)
      // #TS-P1：移除個人頁底部版本號後，Free 版內容（919px）已不超過 laptopRail 一屏（937px），P1「必須有 1 個可捲動容器、
      //   全部元素可達」的前提失效。斷言不放寬，改加長 Free fixture：旅行風格／同伴摘要／步調卡皆限 Plus（onboarded 對 Free 高度無影響），
      //   Free 唯一由資料決定高度的是顯示名稱，故用會換成兩行的長顯示名稱，讓內容仍超過一屏。
      for (const plus of [false, true])
        await runOnePage("profile", L, plus ? { plus, onboarded: true } : { plus, onboarded: false, displayName: LONG_DISPLAY_NAME }, plus ? "Plus＋步調/氛圍/預算" : "Free＋長顯示名稱（兩行）", false);
    await viewport(W, H);

    // ─────────── E：浮層 ───────────
    {
      const loopErr = () => browserErrors.filter((e) => /Maximum update depth/.test(e)).length;
      const res = [];
      for (const crop of ["avatar", "cover"])
        for (const [posture, css] of [["phone", "new"], ["duoFolded", "new"], ["laptopBottom", "old"], ["laptopBottom", "new"], ["laptopRail", "new"]]) {
          await viewport(W, H);
          await mount({ page: "profile", posture, cfg: { plus: false }, crop }, "new", css);
          const before = loopErr();
          for (let i = 0; i < 4; i++) await evaluate("window.settle()");
          await new Promise((r) => setTimeout(r, 300));
          res.push({ crop, posture, css, loops: loopErr() - before });
          // 換頁前先卸載，避免下一個情境被殘留錯誤污染
          await evaluate("window.mount && true");
        }
      info("裁切編輯器 Maximum update depth 錯誤（掛載穩定後 300ms 內新增）：" + res.map((r) => `${r.crop}/${r.posture}/${r.css === "old" ? "移除新規則" : "目前 CSS"}=${r.loops}`).join("、"));
      // 判定：筆電＋目前 CSS 出現無限更新，且同一裁切類型在「手機」與「筆電＋移除新規則」都沒有 → 由新規則造成
      const base = (crop, posture, css) => res.find((r) => r.crop === crop && r.posture === posture && r.css === css)?.loops ?? 0;
      preexistingCropLoop = res.some((r) => r.crop === "cover" && r.posture === "phone" && r.loops > 0);
      await check("E0 我的頁裁切編輯器：新規則不得引發 React 無限更新（Maximum update depth exceeded）；既有問題另列", () => {
        const caused = res.filter((r) => r.css === "new" && r.posture.startsWith("laptop") && r.loops > 0 && base(r.crop, "phone", "new") === 0 && base(r.crop, "laptopBottom", "old") === 0);
        assert.deepEqual(caused.map((r) => `${r.crop}/${r.posture}: ${r.loops} 次`), []);
      });
    }
    // #H2b-4 決定 5：筆電時裁切編輯器維持手機原本的全高呈現（允許跨摺痕）＝與同導覽型態的非筆電姿勢幾何相同
    const cropBase = {};
    for (const L of [
      { name: "一般手機版型（對照，非筆電）", posture: "phone", baseline: true },
      { name: "Duo 合起（對照，非筆電）", posture: "duoFolded", baseline: true },
      { ...LAPTOPS[0], basePosture: "phone" },
      { ...LAPTOPS[2], basePosture: "duoFolded" },
    ]) {
      for (const variant of ["avatar", "cover"]) {
        await viewport(W, H);
        await mount({ page: "profile", posture: L.posture, cfg: { plus: false }, crop: variant });
        if (L.baseline) {
          const b = await ev(`()=>{const {q,qa,R}=H;const sheet=qa('[role=dialog]').find(d=>/92dvh/.test(d.className));const area=sheet&&[...sheet.children].find(e=>/min-h-\\[min\\(52dvh/.test(e.className));
            const mask=area&&area.querySelector('.pointer-events-none.absolute.inset-0.z-10 > div');return {sheet:R(sheet),area:R(area),mask:R(mask),sh:sheet&&sheet.scrollHeight,ch:sheet&&sheet.clientHeight,maxH:sheet&&getComputedStyle(sheet).maxHeight,ovY:sheet&&getComputedStyle(sheet).overflowY};}`);
          cropBase[L.posture + "/" + variant] = b;
          info(`裁切編輯器（${variant}，${L.name}）：Sheet [${b.sheet?.t.toFixed(1)}, ${b.sheet?.b.toFixed(1)}] max-height ${b.maxH} overflow-y ${b.ovY}；裁切區 [${b.area?.t.toFixed(1)}, ${b.area?.b.toFixed(1)}]（高 ${b.area?.h.toFixed(1)}）；遮罩 ${JSON.stringify(b.mask)}；scrollHeight ${b.sh}／clientHeight ${b.ch}`);
          continue;
        }
        await evaluate("window.settle()");
        const m = await ev(`()=>{const {q,qa,R}=H;const sheet=qa('[role=dialog]').find(d=>/92dvh/.test(d.className));if(!sheet)return null;const cs=getComputedStyle(sheet);
          const header=q('header',sheet);const area=[...sheet.children].find(e=>/min-h-\\[min\\(52dvh/.test(e.className));const btns=qa('header button',sheet);const hint=area&&area.querySelector('p');
          const mask=area&&area.querySelector('.pointer-events-none.absolute.inset-0.z-10 > div');
          return {sheet:R(sheet),maxH:cs.maxHeight,ovY:cs.overflowY,sh:sheet.scrollHeight,ch:sheet.clientHeight,header:R(header),area:R(area),hint:R(hint),mask:R(mask),btnHit:btns.map(b=>H.hit(b))};}`);
        await check(`E1 我的頁裁切編輯器（${variant}，${L.name}）：維持手機全高（幾何＝${L.basePosture} 對照）、標頭按鈕可點；裁切區與遮罩完整可見不需內捲`, () => {
          assert.ok(m, "找不到裁切編輯器 Sheet");
          info(
            `裁切編輯器（${variant}，${L.name}）：Sheet [${m.sheet.t.toFixed(1)}, ${m.sheet.b.toFixed(1)}] max-height ${m.maxH} overflow-y ${m.ovY} scrollHeight ${m.sh}／clientHeight ${m.ch}；` +
              `裁切區 [${m.area.t.toFixed(1)}, ${m.area.b.toFixed(1)}]（高 ${m.area.h.toFixed(1)}）；遮罩 ${JSON.stringify(m.mask)}；提示文字 [${m.hint?.t.toFixed(1)}, ${m.hint?.b.toFixed(1)}]`,
          );
          const b = cropBase[L.basePosture + "/" + variant];
          assert.ok(b && b.sheet, "缺對照量測");
          assert.equal(m.maxH, b.maxH, "max-height 與非筆電不同");
          assert.equal(m.ovY, b.ovY, "overflow-y 與非筆電不同");
          for (const k of ["sheet", "area", "mask"])
            for (const e of ["l", "r", "t", "b"]) near(m[k][e], b[k][e], `${k}.${e} 與非筆電對照不同`);
          assert.ok(m.sheet.b <= H + 0.5 && m.sheet.t >= 0, "Sheet 超出視窗");
          assert.deepEqual(m.btnHit, [true, true], "取消／完成不可點");
          assert.ok(m.sh <= m.ch + 1, `裁切編輯器內容（${m.sh}px）超過可用高度（${m.ch}px），需在 Sheet 內捲動才看得到裁切區下緣／提示文字`);
          assert.ok(m.area.b <= m.sheet.b + 0.5, "裁切區下緣被裁切：" + m.area.b + " > " + m.sheet.b);
          if (m.mask) assert.ok(m.mask.b <= Math.min(m.sheet.b, m.area.b) + 0.5 && m.mask.t >= m.area.t - 0.5, `裁切遮罩框 [${m.mask.t}, ${m.mask.b}] 超出裁切區／可見區 [${m.area.t}, ${Math.min(m.sheet.b, m.area.b)}]`);
        });
      }
    }
    // 收藏刪除確認框
    await mount({ page: "saved", posture: "laptopBottom", cfg: { trips: 3, places: 2 } });
    await ev(`()=>{const b=H.qa('button[aria-label]').find(b=>b.getAttribute('aria-label')===${JSON.stringify("__DEL__")}||/刪除/.test(b.getAttribute('aria-label')));b&&b.click();return !!b;}`);
    await evaluate("window.settle()");
    {
      const m = await ev(`()=>{const d=H.q('[role=alertdialog]');if(!d)return null;const btns=H.qa('button',d);return {r:H.R(d),hit:btns.map(b=>H.hit(b))};}`);
      for (const L of [LAPTOPS[0], LAPTOPS[2]]) {
        await mount({ page: "profile", posture: L.posture, cfg: { plus: false } });
        await ev(`()=>{const b=H.qa('button[aria-label]').find(b=>/頭像/.test(b.getAttribute('aria-label')||''));b.click();return true;}`);
        await evaluate("window.settle()");
        const s = await ev(`()=>{const d=H.q('[role=dialog]');if(!d)return null;const btns=H.qa('button',d).filter(b=>b.getBoundingClientRect().height>0);return {r:H.R(d),sh:d.scrollHeight,ch:d.clientHeight,hit:btns.map(b=>H.hit(b)),labels:btns.map(b=>b.textContent.trim().slice(0,8))};}`);
        await check(`E3 我的頁頭像來源 Sheet（${L.name}）：在下半部、不需內捲、所有按鈕可點`, () => {
          assert.ok(s, "Sheet 未開啟");
          info(`頭像來源 Sheet [${s.r.t.toFixed(1)}, ${s.r.b.toFixed(1)}]、scrollHeight ${s.sh}／clientHeight ${s.ch}、按鈕 ${s.labels.join("/")}`);
          assert.ok(s.r.t >= BOTTOM - 0.5, "跨入摺痕：" + s.r.t);
          assert.ok(s.sh <= s.ch + 1, "需內捲");
          assert.ok(s.hit.every(Boolean), JSON.stringify(s));
        });
      }
      await check("E2 收藏筆電：刪除確認框置中於下半部、按鈕可點", () => {
        assert.ok(m, "找不到確認框");
        assert.ok(m.r.t >= BOTTOM - 0.5 && m.r.b <= H + 0.5, JSON.stringify(m.r));
        assert.ok(m.hit.length >= 2 && m.hit.every(Boolean), JSON.stringify(m.hit));
      });
    }

    // E4（#H2b-5）三頁浮層「不跨摺痕」規則：在 body 注入與 Radix／vaul 相同屬性的測試節點，量 computed style。
    //   筆電：置中 dialog top＝(摺痕下緣＋100dvh−safe-bottom)/2、max-height＝100dvh−摺痕下緣−safe-bottom−1rem；底部 Sheet／drawer max-height＝100dvh−摺痕下緣；
    //   頂部 max-height＝摺痕上緣；側邊 top＝摺痕下緣；h-[92dvh] 底部 Sheet 只在我的頁維持 92dvh。非筆電：全部維持測試節點自身的值。
    const probeOverlays = () =>
      ev(`()=>{const mk=(attrs,style)=>{const d=document.createElement('div');for(const [k,v] of Object.entries(attrs))d.setAttribute(k,v);d.style.cssText='position:fixed;left:0;width:100px;height:2000px;max-height:none;'+style;document.body.appendChild(d);return d;};
       const P={center:mk({role:'dialog',class:'probe translate-y-[-50%]'},'top:50%;'),alert:mk({role:'alertdialog',class:'probe translate-y-[-50%]'},'top:50%;'),
        bottom:mk({role:'dialog',class:'probe slide-in-from-bottom'},'bottom:0;'),vaulBottom:mk({'data-vaul-drawer':'','data-vaul-drawer-direction':'bottom'},'bottom:0;'),
        top:mk({role:'dialog',class:'probe slide-in-from-top'},'top:0;'),vaulTop:mk({'data-vaul-drawer':'','data-vaul-drawer-direction':'top'},'top:0;'),
        right:mk({role:'dialog',class:'probe slide-in-from-right'},'top:0;height:auto;bottom:auto;'),left:mk({role:'dialog',class:'probe slide-in-from-left'},'top:0;height:auto;bottom:auto;'),
        crop:mk({role:'dialog',class:'probe slide-in-from-bottom h-[92dvh]'},'bottom:0;')};
       const out={};for(const [k,d] of Object.entries(P)){const cs=getComputedStyle(d);out[k]={top:cs.top,maxH:cs.maxHeight,ovY:cs.overflowY,bottom:cs.bottom};d.remove();}return out;}`);
    const px = (v) => Math.round(v * 100) / 100 + "px";
    const expectOverlay = (page, laptop, safeBottom) => {
      if (!laptop)
        return { center: { top: px(H / 2), maxH: "none" }, alert: { top: px(H / 2), maxH: "none" }, bottom: { maxH: "none" }, vaulBottom: { maxH: "none" }, top: { maxH: "none" }, vaulTop: { maxH: "none" }, right: { top: "0px" }, left: { top: "0px" }, crop: { maxH: "none" } };
      const ctr = { top: px((BOTTOM + H - safeBottom) / 2), maxH: px(H - BOTTOM - safeBottom - 16), ovY: "auto" };
      return {
        center: ctr, alert: ctr, bottom: { maxH: px(H - BOTTOM), ovY: "auto" }, vaulBottom: { maxH: px(H - BOTTOM), ovY: "auto" },
        top: { maxH: px(TOP), ovY: "auto" }, vaulTop: { maxH: px(TOP), ovY: "auto" }, right: { top: px(BOTTOM), bottom: "0px", ovY: "auto" }, left: { top: px(BOTTOM), bottom: "0px", ovY: "auto" },
        crop: page === "profile" ? { maxH: px(H * 0.92), ovY: "visible" } : { maxH: px(H - BOTTOM), ovY: "auto" },
      };
    };
    const overlayMismatch = (got, exp) => {
      const bad = [];
      for (const [k, e] of Object.entries(exp)) for (const [f, v] of Object.entries(e)) if (got[k][f] !== v) bad.push(`${k}.${f}=${got[k][f]}（預期 ${v}）`);
      return bad;
    };
    const PAGES_CFG_E = { saved: { trips: 3, places: 3 }, home: { latestTrip: true, places: 2 }, profile: { plus: true, onboarded: true } };
    // 每個情境另以 OLD CSS（移除收藏／首頁／我的段落）量一次：非筆電必須與 OLD 完全相同；筆電時 OLD 必須不符合預期（B0 對照，見下方 B0）
    const overlayB0 = [];
    for (const page of ["saved", "home", "profile"])
      for (const [posture, safeBottom, laptop] of [["laptopBottom", 0, true], ["laptopBottom", 20, true], ["laptopRail", 0, true], ["phone", 0, false], ["duoFolded", 0, false], ["twoPaneAndLaptop", 0, false]]) {
        await viewport(W, H);
        await mount({ page, posture, safeBottom, noStrict: page === "home", cfg: PAGES_CFG_E[page] });
        const got = await probeOverlays();
        await mount({ page, posture, safeBottom, noStrict: page === "home", cfg: PAGES_CFG_E[page] }, "new", "old");
        const old = await probeOverlays();
        if (laptop) overlayB0.push({ page, posture, safeBottom, bad: overlayMismatch(old, expectOverlay(page, true, safeBottom)) });
        await check(`E4 ${page} 浮層規則（${posture}${safeBottom ? " safe-bottom=" + safeBottom : ""}）：${laptop ? "筆電時不跨摺痕（我的頁裁切例外維持 92dvh）" : "非筆電＝移除新規則時（不生效）"}`, () => {
          if (laptop) assert.deepEqual(overlayMismatch(got, expectOverlay(page, true, safeBottom)), []);
          else assert.deepEqual(got, old);
          if (page === "profile" && laptop) info(`[E4 ${posture} sb=${safeBottom}] 置中 top ${got.center.top} max-height ${got.center.maxH}；底部 ${got.bottom.maxH}；頂部 ${got.top.maxH}；側邊 top ${got.right.top}；裁切例外 ${got.crop.maxH}/${got.crop.ovY}`);
        });
      }

    // ─────────── X：姿勢切換 ───────────
    const SEQ = ["laptopBottom", "twoPane", "laptopRail", "duoFolded", "laptopBottom", "twoPaneAndLaptop", "phone"];
    const runSeq = async (markExpr, checkExpr) => {
      await evaluate(`(()=>{${markExpr}})()`);
      const out = [];
      for (const p of SEQ) {
        await evaluate(`window.setPosture(${JSON.stringify(p)})`);
        for (let i = 0; i < 4; i++) await evaluate("window.settle()");
        out.push([p, await evaluate(`(()=>{${checkExpr}})()`), await counts()]);
      }
      return out;
    };
    const PAGES_CFG_X = { saved: { trips: 3, places: 3 }, home: { latestTrip: true, places: 2 }, profile: { plus: true, onboarded: true } };
    const DATA_KEYS = [
      "listCoreTrips", "listPlaces", "getLatestCoreTrip", "getPreferences", "getUserProfile", "ensureUserProfile", "loadHomeNearbyPicks",
      "ensureHomeWeatherBootstrap", "reloadHomeWeather", "refreshHomeWeather", "ensureEffectiveLocationBootstrap", "hydrateConversationWorkspaces", "supabase", "serverFn",
    ];
    const pickData = (c) => Object.fromEntries(DATA_KEYS.map((k) => [k, c.c[k] || 0]));

    // 收藏：手機選「地點」分頁 → 筆電 → 手機，分頁 state 保留
    await viewport(W, H);
    await mount({ page: "saved", posture: "phone", cfg: { trips: 3, places: 3 } });
    {
      await ev(`()=>{const b=H.qa('#content button').find(b=>/地點/.test(b.textContent)&&/rounded-full/.test(b.className));b.click();return true;}`);
      await evaluate("window.settle()");
      const sel = () => evaluate(`(()=>{const b=H.qa('#content button').find(b=>/bg-foreground/.test(b.className)&&/flex-1 rounded-full/.test(b.className));return b?b.textContent:null;})()`);
      const t0 = await sel();
      await evaluate(`window.setPosture('laptopBottom')`);
      await evaluate("window.settle()");
      await evaluate(`window.setPosture('phone')`);
      await evaluate("window.settle()");
      const t1 = await sel();
      await check("X0 收藏：手機選「地點」分頁後經筆電切回手機，分頁仍為地點（tab state 不受影響）", () => {
        assert.match(t0 || "", /地點/);
        assert.equal(t1, t0);
      });
    }
    // 離開頁面（卸載）時 html 的 *-laptop-active 與首頁下半部容器一併移除
    {
      const out = [];
      for (const page of ["saved", "home", "profile"]) {
        await mount({ page, posture: "laptopBottom", noStrict: page === "home", cfg: PAGES_CFG_X[page] });
        const before = await evaluate("H.htmlClass()");
        const after = await evaluate("window.unmountApp()");
        out.push({ page, before, after });
      }
      await check("X5 筆電中離開收藏／首頁／我的：卸載後 html 不殘留 *-laptop-active、首頁下半部容器移除", () => {
        for (const r of out) {
          assert.ok(r.before.includes(r.page + "-laptop-active"), r.page + "：掛載時應有 class");
          assert.doesNotMatch(r.after.html, /(saved|home|profile)-laptop-active/, r.page + "：卸載後殘留 " + r.after.html);
          assert.equal(r.after.bottoms, 0);
        }
      });
    }
    // 收藏：開啟刪除確認框後切換
    await viewport(W, H);
    await mount({ page: "saved", posture: "phone", cfg: { trips: 3, places: 3, savedPhotos: true } });
    {
      const c0 = await counts();
      const net0 = netLog.length;
      await ev(`()=>{const b=H.qa('button[aria-label]').find(b=>/刪除/.test(b.getAttribute('aria-label')||''));b.click();return true;}`);
      await evaluate("window.settle()");
      const seq = await runSeq(
        "window.__dlg=H.q('[role=alertdialog]');window.__hdr=H.q('#content h1');",
        "const d=H.q('[role=alertdialog]');return {dlgSame:!!d&&d===window.__dlg&&d.isConnected,hdrSame:H.q('#content h1')===window.__hdr,dlgOpen:d&&d.getAttribute('data-state'),html:H.htmlClass()};",
      );
      await check("X1 收藏：姿勢切換（含開啟中的刪除確認框）資料抓取次數不增加、確認框與標題節點不 remount", () => {
        for (const [p, r, c] of seq) {
          assert.equal(r.dlgSame, true, p + "：確認框 remount／關閉");
          assert.equal(r.dlgOpen, "open", p);
          assert.equal(r.hdrSame, true, p + "：標題節點 remount");
          assert.deepEqual(pickData(c), pickData(c0), p + "：資料抓取次數增加");
          assert.equal(/saved-laptop-active/.test(r.html), p.startsWith("laptop"), p + "：saved-laptop-active");
        }
        const f = seq[seq.length - 1][2].f.length - c0.f.length;
        const fl = seq[seq.length - 1][2].f.slice(c0.f.length);
        const perStep = seq.map(([p, , c], i) => `${p}:+${c.f.length - (i ? seq[i - 1][2].f.length : c0.f.length)}`).join(" ");
        info(`收藏姿勢切換期間 fetch ${f} 次（${perStep}；${[...new Set(fl.map((u) => u.replace(/^http:\/\/127\.0\.0\.1:\d+/, "").split("?")[0]))].join(", ")}）、非 data: Network 請求 ${netLog.slice(net0).filter((u) => !u.startsWith("data:")).length} 次`);
      });
    }

    // 首頁：頁面節點（含附近推薦）不 remount、資料不重抓；姿勢切換期間的網路／簽名／圖片請求（簽名失敗情境照實記錄）
    for (const [strict, signFail] of [[true, false], [false, false], [false, true]]) {
      const mode = `${strict ? "StrictMode" : "無 StrictMode"}，簽名${signFail ? "失敗" : "成功"}`;
      await viewport(W, H);
      await mount({ page: "home", posture: "phone", noStrict: !strict, cfg: { latestTrip: true, places: 2, signFail } });
      const c0 = await counts();
      const net0 = netLog.length;
      const hits0 = serverHits.length;
      const seq = await runSeq(
        "window.__h1=H.q('#content h1');window.__chat=H.q('#content a[href=\"/chat\"]');window.__root=H.q('#content > div');window.__near=H.q('.home-nearby-cards');",
        "return {h1:H.q('#content h1')===window.__h1,chat:H.q('#content a[href=\"/chat\"]')===window.__chat,root:H.q('#content > div')===window.__root,nearSame:!!window.__near&&H.q('.home-nearby-cards')===window.__near,html:H.htmlClass(),bottom:!!H.q('.home-laptop-bottom'),cards:H.qa('article.home-nearby-card-item').length,imgs:H.qa('article.home-nearby-card-item img').map(i=>i.getAttribute('src')).filter(Boolean).length};",
      );
      const signs = (c) => c.f.filter((u) => u.includes("/api/place-photo/sign")).length;
      await check(`X2 首頁（${mode}）：姿勢切換頁面節點（含附近推薦）不 remount、無下半部 portal、資料抓取（天氣／附近推薦／收藏／偏好／行程）次數不增加`, () => {
        for (const [p, r, c] of seq) {
          assert.ok(r.h1 && r.chat && r.root, p + "：頁面節點 remount " + JSON.stringify(r));
          // #H2b-5：一頁式，附近推薦不再 portal，所有姿勢下都是同一個節點
          if (!strict) assert.equal(r.nearSame, true, p + "：附近推薦節點 remount（不應再有 portal）");
          assert.deepEqual(pickData(c), pickData(c0), p + "：資料抓取次數增加");
          if (!strict) assert.equal(r.cards, 6, p + "：附近卡片數");
          assert.equal(r.bottom, false, p + "：不得出現下半部容器");
          assert.equal(/home-laptop-active/.test(r.html), p.startsWith("laptop"), p + "：home-laptop-active");
        }
      });
      const perStep = seq.map(([p, r, c], i) => `${p}:near${r.nearSame ? "同" : "換"}/簽名+${signs(c) - (i ? signs(seq[i - 1][2]) : signs(c0))}`).join(" ");
      const totalSign = signs(seq[seq.length - 1][2]) - signs(c0);
      const imgHits = serverHits.slice(hits0).filter((u) => u.startsWith("/api/place-photo?")).length;
      const ext = netLog.slice(net0).filter((u) => !/^http:\/\/127\.0\.0\.1:/.test(u) && !/^(data|blob):/.test(u));
      const imgNet = netLog.slice(net0).filter((u) => /\/api\/place-photo\?/.test(u)).length;
      if (strict) continue;
      if (signFail) {
        // #H2b-4 決定 6／#H2b-5：簽名失敗時切換姿勢重打 /api/place-photo/sign 照實記錄次數（INFO；首頁已無 portal remount）；外部請求仍須為 0
        await check(`X3 首頁（${mode}）：外部（Google）請求為 0；簽名 API 次數記為資訊（另案處理）`, () => {
          info(`[X3 INFO，${mode}] 掛載時簽名 ${signs(c0)} 次；姿勢序列 ${perStep}；切換期間簽名 API 共 ${totalSign} 次；圖片 HTTP 請求（server）${imgHits} 次、CDP requestWillBeSent ${imgNet} 次；外部請求 ${ext.length}`);
          assert.deepEqual(ext, [], "外部請求");
        });
        continue;
      }
      await check(`X3 首頁（${mode}）：姿勢切換不觸發簽名 API／外部（Google）請求`, () => {
        info(`[${mode}] 掛載時簽名 ${signs(c0)} 次；姿勢序列 ${perStep}；切換期間簽名 API 共 ${totalSign} 次；圖片 HTTP 請求（server）${imgHits} 次、CDP requestWillBeSent ${imgNet} 次；外部請求 ${ext.length}`);
        assert.deepEqual(ext, [], "外部請求");
        assert.equal(totalSign, 0, `下半部 remount 觸發 /api/place-photo/sign ${totalSign} 次（${perStep}）`);
      });
    }

    // 我的：開啟中的 ImageSourceSheet 不 remount；資料不重抓
    await viewport(W, H);
    await mount({ page: "profile", posture: "phone", cfg: { plus: true, onboarded: true } });
    {
      const c0 = await counts();
      await ev(`()=>{const b=H.qa('button[aria-label]').find(b=>b.getAttribute('aria-label')===${JSON.stringify("編輯頭像")}||/頭像/.test(b.getAttribute('aria-label')||''));b.click();return true;}`);
      await evaluate("window.settle()");
      const opened = await ev(`()=>!!H.q('[role=dialog]')`);
      const seq = await runSeq(
        "window.__dlg=H.q('[role=dialog]');window.__page=H.q('.profile-page');window.__card=H.q('.profile-page > div');",
        "const d=H.q('[role=dialog]');return {dlgSame:!!d&&d===window.__dlg&&d.isConnected,page:H.q('.profile-page')===window.__page,card:H.q('.profile-page > div')===window.__card,html:H.htmlClass()};",
      );
      await check("X4 我的：姿勢切換（含開啟中的頭像來源 Sheet）資料抓取次數不增加、頁面／個人卡／Sheet 不 remount", () => {
        assert.ok(opened, "Sheet 未開啟");
        for (const [p, r, c] of seq) {
          assert.ok(r.dlgSame && r.page && r.card, p + "：" + JSON.stringify(r));
          assert.deepEqual(pickData(c), pickData(c0), p + "：資料抓取次數增加");
          assert.equal(/profile-laptop-active/.test(r.html), p.startsWith("laptop"), p);
        }
      });
    }

    // ─────────── N：非筆電 ───────────
    const NON = [
      { name: "一般 iPhone", posture: "phone", w: 390, h: 844, safeTop: 47, safeBottom: 34 },
      { name: "Duo 合起（直欄）", posture: "duoFolded", w: W, h: H },
      { name: "Duo 雙欄", posture: "twoPane", w: W, h: H },
      { name: "iPad", posture: "phone", w: 820, h: 1180, safeTop: 24, safeBottom: 20 },
      { name: "web", posture: "phone", w: 1280, h: 800, web: true },
      { name: "殘留 --duo-hinge-* 變數", posture: "phone", w: W, h: H, staleHinge: true },
    ];
    const PAGES_CFG = {
      saved: { trips: 4, places: 4 },
      home: { latestTrip: true, places: 2 },
      profile: { plus: true, onboarded: true },
    };
    for (const N of NON) {
      await viewport(N.w, N.h);
      for (const page of ["saved", "home", "profile"]) {
        const o = { page, posture: N.posture, safeTop: N.safeTop, safeBottom: N.safeBottom, web: N.web, staleHinge: N.staleHinge, noStrict: page === "home", cfg: PAGES_CFG[page] };
        await mount(o, "new", "new");
        const a = { dom: await evaluate("H.snapshotDom()"), geo: await evaluate("H.geometry()"), html: await evaluate("H.htmlClass()") };
        await mount(o, "new", "old");
        const b = { geo: await evaluate("H.geometry()") };
        let hd = null;
        if (jsHead && N.posture !== "twoPane") {
          await mount(o, "head", "old");
          hd = { dom: await evaluate("H.snapshotDom()") };
        }
        // N3：雙欄時 HEAD 沒有 *-duo-* class（雙欄版型為本分支既有的未提交修改）；去掉 *-duo-* class token 後 DOM 必須與 HEAD 相同（首頁／我的）
        if (jsHead && N.posture === "twoPane") {
          // 圖片載入（骨架 animate-pulse → <img>）為非同步；兩邊都等到沒有骨架（最多 20 次 settle）再取 DOM，避免載入時序造成假差異
          const stableDom = async () => {
            let d = await evaluate("H.snapshotDom()");
            for (let i = 0; i < 5 && d.includes("animate-pulse bg-secondary/80"); i++) {
              await evaluate("window.settle()");
              d = await evaluate("H.snapshotDom()");
            }
            return d;
          };
          await mount(o, "new", "new");
          const newDom = await stableDom();
          await mount(o, "head", "old");
          const headDom = await stableDom();
          // PlaceCoverImage／PlaceImage 以 useInViewport 延遲載入：雙欄時卡片位置與 HEAD（無雙欄版型）不同，同一張圖可能一邊已載入、一邊仍是骨架；
          //   N3 只比結構，故把「<img>」與「骨架 div」正規化為同一 token（其餘 className／屬性／順序仍逐字比對）
          const strip = (s) =>
            s
              .replace(/<img [^>]*>/g, "<IMG>")
              .replace(/<div class="absolute inset-0 animate-pulse bg-secondary\/80" aria-hidden="true"><\/div>/g, "<IMG>")
              .replace(/ class="([^"]*)"/g, (_, c) => ` class="${c.split(/\s+/).filter((t) => t && !/^(home|profile|saved)-duo-/.test(t)).join(" ")}"`);
          const same = strip(newDom) === strip(headDom);
          if (page === "saved") info(`N3 雙欄／收藏：去掉 *-duo-* 後 DOM ${same ? "＝" : "≠"} HEAD（收藏雙欄結構屬既有修改，只記錄）`);
          else
            await check(`N3 Duo 雙欄／${page}：去掉 *-duo-* class 後 DOM＝HEAD 版（區塊順序、其他 className、屬性相同）`, () => {
              if (!same) {
                const x = strip(newDom), y = strip(headDom);
                let i = 0;
                while (i < x.length && x[i] === y[i]) i++;
                assert.fail(`第 ${i} 字元：\n  新：${x.slice(Math.max(0, i - 120), i + 160)}\n  HEAD：${y.slice(Math.max(0, i - 120), i + 160)}`);
              }
            });
        }
        await check(`N ${N.name}／${page}：無 *-laptop-* class、所有元素位置與樣式＝移除新規則時${hd ? "、DOM＝HEAD 版" : ""}（${a.geo.length} 個元素）`, () => {
          assert.doesNotMatch(a.html, /laptop/, "html class：" + a.html);
          assert.doesNotMatch(a.dom, /saved-laptop|home-laptop|profile-laptop/);
          const diff = a.geo.map((g, i) => (g !== b.geo[i] ? `#${i}\n  新：${g}\n  舊：${b.geo[i]}` : null)).filter(Boolean);
          assert.equal(a.geo.length, b.geo.length, "元素數量不同");
          assert.deepEqual(diff.slice(0, 5), [], "與移除新規則時不同");
          if (hd) {
            if (a.dom !== hd.dom) {
              let i = 0;
              while (i < a.dom.length && a.dom[i] === hd.dom[i]) i++;
              assert.fail(`DOM 與 HEAD 版不同（第 ${i} 字元）：\n  新：${a.dom.slice(Math.max(0, i - 120), i + 160)}\n  HEAD：${hd.dom.slice(Math.max(0, i - 120), i + 160)}`);
            }
          }
        });
      }
    }
    // 雙欄＋筆電＝雙欄
    await viewport(W, H);
    for (const page of ["saved", "home", "profile"]) {
      await mount({ page, posture: "twoPane", noStrict: page === "home", cfg: PAGES_CFG[page] });
      const a = { dom: await evaluate("H.snapshotDom()"), geo: await evaluate("H.geometry()") };
      await mount({ page, posture: "twoPaneAndLaptop", noStrict: page === "home", cfg: PAGES_CFG[page] });
      const b = { dom: await evaluate("H.snapshotDom()"), geo: await evaluate("H.geometry()"), html: await evaluate("H.htmlClass()") };
      await check(`N2 雙欄＋筆電同時成立／${page}：雙欄優先（DOM、位置與雙欄相同，無 duo-laptop／*-laptop-active）`, () => {
        assert.doesNotMatch(b.html, /laptop/);
        assert.equal(a.dom, b.dom);
        assert.deepEqual(a.geo, b.geo);
      });
    }

    // ─────────── B0：對照 ───────────
    await viewport(W, H);
    {
      await mount({ page: "saved", posture: "laptopBottom", cfg: { trips: 9, places: 10 } }, "new", "old");
      const ms = await inspectSaved();
      await check("B0 對照：移除新規則時，收藏 S1 主要斷言、三頁 E4 浮層斷言（每個筆電情境）都會失敗（斷言有效）", () => {
        const fails = (fn) => {
          try {
            fn();
            return false;
          } catch {
            return true;
          }
        };
        assert.ok(fails(() => assertSaved(ms, LAPTOPS[0])), "收藏：舊 CSS 下 assertSaved 竟通過");
        assert.ok(fails(() => near(ms.trips.b, TOP, "")), "收藏：舊 CSS 下行程區下緣竟＝摺痕上緣");
        assert.equal(overlayB0.length, 9, "E4 筆電情境數");
        for (const r of overlayB0) {
          assert.ok(r.bad.length > 0, `${r.page}/${r.posture}/sb=${r.safeBottom}：舊 CSS 下浮層竟符合不跨摺痕預期`);
          // 每一種浮層都要各自失敗（裁切例外在我的頁之外期望＝底部 Sheet 規則，同樣須失敗）
          for (const k of ["center", "alert", "bottom", "vaulBottom", "top", "vaulTop", "right", "left", "crop"])
            assert.ok(r.bad.some((b) => b.startsWith(k + ".")), `${r.page}/${r.posture}：舊 CSS 下 ${k} 竟符合預期`);
        }
      });
    }
    // B0c 一頁式斷言自我檢查（首頁、我的；筆電 safe-bottom 0）：分別注入「內層捲動容器」「body 層 fixed 下半部容器」「最後元素被導覽遮住」，
    //   assertOnePage 必須各自失敗；未注入時必須通過
    {
      const fails = (fn) => {
        try {
          fn();
          return null;
        } catch (e) {
          return String(e.message).split("\n")[0];
        }
      };
      // 注入方式不改 #content DOM（樣式放 <head>；body 層容器放在 #root 之外），讓失敗落在目標斷言上；expect＝預期的失敗訊息開頭
      const css = (rule) => `()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(rule)};document.head.appendChild(s);return true;}`;
      const MUT = {
        innerScroller: { js: (P) => css(`${P.root} > :nth-child(3){max-height:40px!important;overflow-y:auto!important}`), expect: "垂直捲動容器" },
        bodyFixed: {
          js: () => `()=>{const d=document.createElement('div');d.className='lower-probe';d.style.cssText='position:fixed;left:0;right:0;top:${BOTTOM}px;bottom:0;overflow-y:auto;';d.innerHTML='<div style="height:2000px"></div>';document.body.appendChild(d);return true;}`,
          expect: "body 子節點不同",
        },
        coveredLast: { js: () => css("main.app-scroll{padding-bottom:0!important}"), expect: "捲到底最後元素" },
      };
      const out = [];
      for (const page of ["home", "profile"]) {
        const cfg = page === "home" ? { latestTrip: true, places: 2 } : { plus: true, onboarded: true };
        await viewport(W, H);
        await mount({ page, posture: "phone", noStrict: page === "home", cfg });
        const ref = await inspectOne(page);
        await mount({ page, posture: "laptopBottom", noStrict: page === "home", cfg });
        const m0 = await inspectOne(page);
        const s0 = await reachOne(page);
        out.push({ page, mut: "none", err: fails(() => assertOnePage(page, m0, ref, s0, LAPTOPS[0])) });
        for (const [k, mu] of Object.entries(MUT)) {
          await mount({ page, posture: "laptopBottom", noStrict: page === "home", cfg });
          await evaluate(`(${mu.js(ONE[page])})()`);
          await evaluate("window.settle()");
          const m = await inspectOne(page);
          const s = await reachOne(page);
          out.push({ page, mut: k, expect: mu.expect, err: fails(() => assertOnePage(page, m, ref, s, LAPTOPS[0])) });
        }
      }
      await check("B0c 對照：一頁式斷言在未注入時通過；注入內層捲動容器／body 層 fixed 容器／最後元素被導覽遮住時各自在目標斷言失敗", () => {
        info("B0c " + out.map((r) => `${r.page}/${r.mut}：${r.err ?? "通過"}`).join("；"));
        for (const r of out) {
          if (r.mut === "none") assert.equal(r.err, null, `${r.page}：未注入卻失敗`);
          else assert.ok(r.err && r.err.startsWith(r.expect), `${r.page}/${r.mut}：預期失敗於「${r.expect}」，實際：${r.err ?? "通過"}`);
        }
      });
    }
    // B0b：只移除第 2 輪規則（保留第 1 輪），第 2 輪新增的斷言必須各自失敗
    {
      const fails = (fn) => {
        try {
          fn();
          return false;
        } catch {
          return true;
        }
      };
      const out = {};
      await mount({ page: "saved", posture: "laptopBottom", cfg: { trips: 9, places: 10 } }, "new", "r1");
      out.saved = await inspectSaved();
      await mount({ page: "saved", posture: "laptopBottom", cfg: { trips: 0, places: 0 } }, "new", "r1");
      out.savedEmpty = await inspectSavedEmpty();
      await mount({ page: "profile", posture: "laptopBottom", cfg: { plus: false }, crop: "avatar" }, "new", "r1");
      out.crop = await ev(`()=>{const sheet=H.qa('[role=dialog]').find(d=>/92dvh/.test(d.className));return sheet?{sheet:H.R(sheet),maxH:getComputedStyle(sheet).maxHeight}:null;}`);
      // 我的頁裁切例外移除時，E4 的 crop 探針必須回到底部 Sheet 規則（不再是 92dvh）
      await mount({ page: "profile", posture: "laptopBottom", cfg: { plus: true, onboarded: true } }, "new", "r1");
      out.probe = await probeOverlays();
      const cb = cropBase["phone/avatar"];
      info(
        `[B0b 只保留第 1 輪] 收藏地點區下緣 ${out.saved.places.b}／導覽上緣 ${out.saved.navTop}；收藏空白卡 [${out.savedEmpty.card?.t.toFixed(1)}, ${out.savedEmpty.card?.b.toFixed(1)}]；` +
          `裁切 Sheet ${JSON.stringify(out.crop)}（手機對照 max-height ${cb?.maxH}、上緣 ${cb?.sheet?.t}）；E4 crop 探針 ${JSON.stringify(out.probe.crop)}`,
      );
      await check("B0b 對照：只移除第 2 輪規則（收藏框線／空白卡、裁切例外）時，S1（導覽框線）、S3（空白卡）、E1（裁切全高）、E4（裁切例外）斷言各自失敗", () => {
        assert.ok(fails(() => assertSaved(out.saved, LAPTOPS[0])), "收藏：assertSaved 在第 1 輪 CSS 下竟通過");
        assert.ok(fails(() => near(out.saved.places.b, out.saved.navTop, "")), "收藏：導覽框線斷言在第 1 輪 CSS 下竟通過");
        assert.ok(fails(() => assert.ok(out.savedEmpty.card.b <= out.savedEmpty.navTop + 0.5 && out.savedEmpty.card.t >= BOTTOM - 0.5)), "收藏：空白卡斷言在第 1 輪 CSS 下竟通過");
        assert.ok(out.crop && cb, "裁切 Sheet 量測");
        assert.ok(fails(() => (assert.equal(out.crop.maxH, cb.maxH), near(out.crop.sheet.t, cb.sheet.t, ""))), "裁切：全高斷言在第 1 輪 CSS 下竟通過");
        assert.ok(overlayMismatch(out.probe, expectOverlay("profile", true, 0)).some((b) => b.startsWith("crop.")), "E4 裁切例外斷言在第 1 輪 CSS 下竟通過");
      });
    }

    await check("R 無外部請求、無瀏覽器例外／console.error", () => {
      assert.deepEqual(externalRequests, []);
      const grouped = {};
      // 封面裁切編輯器的 Maximum update depth 在手機＋移除新規則時同樣發生（E0 已記錄為既有問題），此處不重複計入
      const known = (e) => preexistingCropLoop && /Maximum update depth exceeded/.test(e) && /\/crop:cover\//.test(e);
      const knownCount = browserErrors.filter(known).length;
      if (knownCount) info(`R 排除既有封面裁切無限更新錯誤 ${knownCount} 筆（見 E0）`);
      for (const e of browserErrors.filter((x) => !known(x))) {
        const k = e.slice(0, 220);
        grouped[k] = (grouped[k] || 0) + 1;
      }
      assert.deepEqual(Object.entries(grouped).map(([k, n]) => `${n}× ${k}`), []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    await new Promise((r) => {
      if (chrome.exitCode != null || chrome.signalCode != null) return r();
      chrome.once("exit", r);
      // Chrome 未在 5 秒內結束 → SIGKILL，避免收尾卡住
      setTimeout(() => {
        chrome.kill("SIGKILL");
        r();
      }, 5000).unref();
    });
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

clearTimeout(totalTimer);
printTraceStats();
console.log(`（耗時 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）`);
console.log(failures.length ? `\nverify-duo-laptop-saved-home-profile: FAIL (${failures.length})` : "\nverify-duo-laptop-saved-home-profile: PASS");
process.exit(failures.length ? 1 : 0);
