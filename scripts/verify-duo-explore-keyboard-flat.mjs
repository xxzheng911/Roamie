// verify-duo-explore-keyboard-flat.mjs — iPhone Duo 探索頁（/map）筆電／直向攤平：鍵盤整塊上滑、直向攤平判斷、地點詳情一頁式
// （任務單 #H3-1-T，tester 獨立審查）
//
// 真實 React render（development build、StrictMode）：真實 src/routes/_app.tsx（AppLayout）＋真實 src/routes/_app.map.tsx（MapView）＋
//   真實 MapSearchBarOverlay／MapExploreSearchResults／MapExploreSheet／MapExplorePlaceCards／PlaceDetailSheet／NavigationPreviewSheet／
//   GoogleMapBackground／map-search-keyboard／map-visible-padding／use-duo-laptop／duo-laptop。
//   CSS＝以目前 src/styles.css 實際編譯的 Tailwind CSS。
// Mock（只替換外部邊界）：
//   - @/lib/layout/duo-hinge：可控的原生摺疊狀態 store（use-duo-laptop 用真實檔案）
//   - @/hooks/use-duo-layout：可控 store（headless 無法模擬 env(safe-area-inset-right)）
//   - @/components/GoogleMap：計數 mount／unmount、記錄 mapPadding prop；畫出假的 Google logo（左下角 66×26）
//   - @/lib/google-maps-loader：triggerMapResize 計數
//   - 所有 *.functions.ts 與 @/lib/pie/places-gateway 的匯出：記錄呼叫（檔案#名稱）後回應（__stubResponses）或拒絕
//   - window.fetch／XMLHttpRequest／sendBeacon：記錄（/api/google 另記錄內層 Google URL：Places／Routes／Geocoding）後
//     回應假 Places 資料（__fakeGoogle，只在需要搜尋建議時開啟）或拒絕；CDP Network 記錄並封鎖所有非 127.0.0.1 請求
//
// 量測：K0 計數控制組｜K1 ①｜K2 ③′／③／收起＋動畫＋請求 0｜K3 詳情一頁式｜K4 導航預覽｜K5／K5b 鍵盤開著進入詳情｜
//   K6 姿勢切換｜K7 進出詳情請求＝一般 iPhone｜K8 reduced-motion｜B0 對照｜F1 直向攤平判斷｜S1 優先序｜S2 150ms 穩定化｜
//   N 非 Duo／其他姿勢與修改前完全相同｜K9 無外部請求／例外；INFO：動畫期間 ResizeObserver→padding 同步次數
//   L1G（#L1-T2）地圖詳情「聊這個地點」在行程生成鎖住時不帶入聊聊（附未鎖對照）
//   - @tanstack/react-router／@tanstack/react-start、supabase、use-i18n（真實 translate）、use-access／use-avatar／use-add-to-trip
//
// 「修改前」對照（非 Duo 回歸）：BEFORE build＝HEAD 版 _app.map.tsx 與 map-search-keyboard.ts（git show，整檔差異皆屬本任務）、
//   map-visible-padding.ts 移除 duo-flat-portrait 判斷；CSS 移除含 duo-flat-portrait／duo-map-kb-anim／duo-map-detail-page 的規則。
//
// 執行：node scripts/verify-duo-explore-keyboard-flat.mjs（不讀 .env、不連網；瀏覽器只連 127.0.0.1）
//      --dump 只輸出開機後 DOM 摘要（除錯用）

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
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const failures = [];
const infos = [];
async function check(name, fn) {
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
  console.log("INFO " + s);
};

const styles = read("src/styles.css");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
const nc = stripComments(styles);
/** 頂層規則（含所在深度） */
function rulesOf(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0 || true) out.push({ selStart: start, open: i, depth, sel: text.slice(start, i).trim() });
      depth++;
      start = i + 1;
    } else if (c === "}") {
      depth--;
      start = i + 1;
    } else if (c === ";" && depth >= 0) {
      // @import 等
    }
  }
  // 補上 body
  for (const r of out) {
    let d = 0;
    for (let j = r.open; j < text.length; j++) {
      if (text[j] === "{") d++;
      else if (text[j] === "}") {
        d--;
        if (d === 0) {
          r.close = j;
          r.body = text.slice(r.open + 1, j);
          break;
        }
      }
    }
  }
  return out;
}
const allRules = rulesOf(nc);
const leafRules = allRules.filter((r) => !/[{]/.test(r.body ?? "") && !r.sel.startsWith("@"));
const selsOf = (r) => r.sel.split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

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

await check("A2 _app.tsx 不直接 import hinge（duo-hinge／use-duo-hinge），直向攤平經 use-duo-laptop 取得", () => {
  const app = read("src/routes/_app.tsx");
  assert.doesNotMatch(app, /from\s+["']@\/lib\/layout\/duo-hinge["']|use-duo-hinge/);
  assert.match(app, /import \{[^}]*useDuoFlatPortrait[^}]*\} from "@\/hooks\/use-duo-laptop"/);
  const map = read("src/routes/_app.map.tsx");
  assert.doesNotMatch(map, /duo-hinge/);
});

const H31 = styles.indexOf(" * #H3-1 更新");
const exploreStart = styles.lastIndexOf("/*", styles.indexOf(" * 筆電半開＋探索（/map）"));
const overlayStart = styles.lastIndexOf("/*", styles.indexOf(" * 筆電半開＋聊聊／探索的浮層"));
const placeStart = styles.lastIndexOf("/*", styles.indexOf(" * 地點詳情頁雙頁"));
const NEW_CLASS_RE = /duo-flat-portrait|duo-map-kb-anim|duo-map-detail-page/;
// #DT1-T：行程頁一頁式＋封面延伸（任務單 #DT1）在「行程詳情筆電」段落後新增 #DT1 區塊，其中含 duo-flat-portrait。
// 放寬：duo-flat-portrait 可出現在「探索段落」或「#DT1 區塊」；#DT1 區塊另由 A3b 限定範圍（只限行程詳情）。
// 其餘限制（@layer 外、在地點詳情雙頁區塊之前、最後一條規則屬 .place-duo-root、c1 只增不刪）不變。
const dt1Start = styles.lastIndexOf("/*", styles.indexOf(" * #DT1："));
const dt1End = styles.indexOf("/*", styles.indexOf("*/", styles.indexOf(" * #DT1：")) + 2);
const inDt1 = (r) => dt1Start > 0 && r.open > dt1Start && r.open < dt1End;
await check("A3 新規則位置：@layer 外（深度 0）、在探索段落或 #DT1 行程頁區塊內、在地點詳情雙頁區塊之前；最後一條規則屬 .place-duo-root", () => {
  assert.ok(H31 > 0 && exploreStart > 0 && overlayStart > exploreStart && placeStart > overlayStart, "段落順序");
  assert.ok(dt1Start > 0 && dt1End > dt1Start && dt1End < placeStart, "#DT1 區塊位置");
  const newRules = allRules.filter((r) => NEW_CLASS_RE.test(r.sel));
  assert.ok(newRules.length >= 20, "新規則數量 " + newRules.length);
  const bad = newRules.filter((r) => r.depth !== 0 || ((r.open < exploreStart || r.open > overlayStart) && !inDt1(r)));
  assert.deepEqual(bad.map((r) => r.sel.slice(0, 100) + " depth=" + r.depth), [], "新規則在 @layer 內或探索段落外");
  const top = allRules.filter((r) => r.depth === 0);
  assert.match(top[top.length - 1].sel, /\.place-duo-root/, "最後一條規則");
  assert.ok(top.filter((r) => r.open > placeStart).every((r) => /place-duo/.test(r.sel)), "地點詳情雙頁區塊後有其他規則");
});

const SNAP = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/c1-styles-before.css";
await check("A4 原始快照 c1-styles-before.css 的既有行只增不刪（快照行序列為目前檔案的子序列）", () => {
  assert.ok(fs.existsSync(SNAP), "快照不存在：" + SNAP);
  const before = fs.readFileSync(SNAP, "utf8").split("\n");
  const cur = styles.split("\n");
  let j = 0;
  const missing = [];
  for (let i = 0; i < before.length; i++) {
    let k = j;
    while (k < cur.length && cur[k] !== before[i]) k++;
    if (k === cur.length) missing.push(i + 1 + ": " + before[i]);
    else j = k + 1;
  }
  assert.deepEqual(missing.slice(0, 5), [], "快照行被刪除或改動（共 " + missing.length + " 行）");
});

await check("A5 .map-stage 取消 isolation／translateZ 只在 html.duo-laptop／html.duo-flat-portrait＋map-route-active 下生效", () => {
  const hits = leafRules.filter((r) => /\.map-stage(?![-\w])/.test(r.sel) && /isolation\s*:\s*auto|transform\s*:\s*none|z-index\s*:\s*auto/.test(r.body));
  assert.ok(hits.length >= 1, "找不到取消規則");
  const sels = hits.flatMap(selsOf);
  const bad = sels.filter((s) => !/^html\.(duo-laptop|duo-flat-portrait)\.map-route-active \.map-page > \.map-stage$/.test(s));
  assert.deepEqual(bad, [], "取消 isolation／transform 的 selector 範圍過寬");
  // 基底 .map-stage 規則仍保留 isolation／translateZ(0)
  const base = leafRules.find((r) => r.sel === ".map-stage");
  assert.ok(base && /isolation:\s*isolate/.test(base.body) && /transform:\s*translateZ\(0\)/.test(base.body), "基底 .map-stage 規則被改動");
});

await check("A6 :has() 只用於新探索規則（鍵盤展開＋筆電／直向攤平限定），且有搜尋建議時才命中", () => {
  const has = leafRules.filter((r) => /:has\(/.test(r.sel));
  const sels = has.flatMap(selsOf);
  const bad = sels.filter((s) => !/^html\.(duo-laptop|duo-flat-portrait)\.map-route-active\.map-keyboard-open \.map-page:has\(> \.map-stage > \.z-10 > div > div:nth-child\(2\)\) > \.map-sheet-layer \[data-map-explore-sheet="true"\]$/.test(s));
  assert.deepEqual(bad, [], ":has() 出現在預期外的 selector");
  assert.equal(sels.length, 2);
  // 搜尋列外層第 2 個子元素只能是 resultsPanel（MapExploreSearchResults）
  const bar = read("src/components/map/MapSearchBarOverlay.tsx");
  assert.match(bar, /<\/div>\n\s*\{resultsPanel\}\n\s*<\/div>\n\s*\);/, "MapSearchBarOverlay 結構：搜尋列 row 之後只有 resultsPanel");
});

await check("A7 探索段落每條新 selector 都有筆電／直向攤平成對版本（逐字對應），且皆限定 map-route-active", () => {
  const region = allRules.filter((r) => r.depth === 0 && r.open > exploreStart && r.open < overlayStart);
  const sels = region.flatMap(selsOf);
  const lap = sels.filter((s) => s.startsWith("html.duo-laptop."));
  const flat = sels.filter((s) => s.startsWith("html.duo-flat-portrait."));
  assert.equal(lap.length + flat.length, sels.length, "有非 duo-laptop／duo-flat-portrait 開頭的 selector：" + sels.filter((s) => !/^html\.duo-(laptop|flat-portrait)\./.test(s)).join(" | "));
  assert.deepEqual(sels.filter((s) => !/^html\.duo-(laptop|flat-portrait)\.map-route-active[.\s]/.test(s)), [], "未限定 map-route-active");
  const flatSet = new Set(flat);
  const lapSet = new Set(lap);
  assert.deepEqual(lap.filter((s) => !flatSet.has(s.replace("html.duo-laptop.", "html.duo-flat-portrait."))), [], "筆電有、直向攤平沒有");
  assert.deepEqual(flat.filter((s) => !lapSet.has(s.replace("html.duo-flat-portrait.", "html.duo-laptop."))), [], "直向攤平有、筆電沒有");
  // 同一條規則內兩者並列（宣告完全相同）
  for (const r of region) {
    const ss = selsOf(r);
    for (const s of ss.filter((x) => x.startsWith("html.duo-laptop.")))
      assert.ok(ss.includes(s.replace("html.duo-laptop.", "html.duo-flat-portrait.")), "不在同一規則：" + s);
  }
  // 新 class 只出現在探索段落（#DT1 行程頁區塊另由 A3b 檢查）
  const outside = allRules.filter((r) => NEW_CLASS_RE.test(r.sel) && (r.open < exploreStart || r.open > overlayStart) && !inDt1(r));
  assert.deepEqual(outside.map((r) => r.sel.slice(0, 80)), []);
});

await check("A3b #DT1 區塊：@layer 外、每條 selector 限定 html.duo-laptop／duo-flat-portrait＋trip-detail-route-active（唯一例外為 .trip-duo-status-backdrop 基底 display:none）；直向攤平規則皆與筆電同一規則並列；不含 duo-map-kb-anim／duo-map-detail-page", () => {
  const region = allRules.filter((r) => inDt1(r));
  assert.ok(region.length >= 6, "#DT1 規則數 " + region.length);
  assert.deepEqual(region.filter((r) => r.depth !== 0).map((r) => r.sel.slice(0, 80)), [], "#DT1 規則在 @layer 內");
  const sels = region.flatMap(selsOf);
  const bad = sels.filter((s) => !/^html\.duo-(laptop|flat-portrait)\.trip-detail-route-active(?=$|[\s.])/.test(s) && s !== ".trip-duo-status-backdrop");
  assert.deepEqual(bad, [], "#DT1 selector 範圍過寬");
  const base = region.filter((r) => selsOf(r).includes(".trip-duo-status-backdrop"));
  assert.equal(base.length, 1);
  assert.deepEqual(selsOf(base[0]), [".trip-duo-status-backdrop"]);
  assert.match(base[0].body.replace(/\s+/g, " ").trim(), /^display: none;?$/, "底板基底規則只能是 display:none");
  for (const r of region) {
    const ss = selsOf(r);
    for (const s of ss.filter((x) => x.startsWith("html.duo-flat-portrait.")))
      assert.ok(ss.includes(s.replace("html.duo-flat-portrait.", "html.duo-laptop.")), "直向攤平規則未與筆電並列：" + s);
  }
  assert.deepEqual(region.filter((r) => /duo-map-kb-anim|duo-map-detail-page/.test(r.sel)).map((r) => r.sel.slice(0, 80)), []);
  // 唯一 .trip-duo-status-backdrop 規則以外，duo-flat-portrait＋trip-detail-route-active 不得出現在 #DT1 以外
  const tripFlatOutside = allRules.filter((r) => /duo-flat-portrait[^,{]*trip-detail-route-active|trip-duo-status-backdrop/.test(r.sel) && !inDt1(r));
  assert.deepEqual(tripFlatOutside.map((r) => r.sel.slice(0, 80)), []);
});

await check("A8 #H3-2：--duo-map-keyboard-top／--duo-map-kb-edge 只出現在探索段落的筆電／直向攤平規則；基底 .map-stage 的 padding-top 未改；padding-top: 0 只在 Duo 範圍", () => {
  const uses = allRules.filter((r) => r.body && /--duo-map-keyboard-top|--duo-map-kb-edge/.test(r.body) && !/[{]/.test(r.body));
  assert.ok(uses.length >= 3, "使用規則數 " + uses.length);
  const bad = uses.filter((r) => r.depth !== 0 || r.open < exploreStart || r.open > overlayStart || !selsOf(r).every((s) => /^html\.(duo-laptop|duo-flat-portrait)\.map-route-active[.\s]/.test(s)));
  assert.deepEqual(bad.map((r) => r.sel.slice(0, 100)), []);
  const def = leafRules.filter((r) => /--duo-map-kb-edge\s*:/.test(r.body));
  assert.equal(def.length, 1);
  assert.match(def[0].body, /--duo-map-kb-edge:\s*var\(--duo-map-keyboard-top,\s*var\(--duo-hinge-top\)\)/, "fallback 應為 --duo-hinge-top");
  const base = leafRules.find((r) => r.sel === ".map-stage");
  assert.match(base.body, /padding-top:\s*calc\(var\(--safe-area-top\) \+ 3\.25rem\)/, "基底 .map-stage padding-top 被改");
  const zeroPad = leafRules.filter((r) => /\.map-stage(?![-\w])/.test(r.sel) && /padding-top\s*:\s*0\b/.test(r.body)).flatMap(selsOf);
  assert.deepEqual(zeroPad.filter((s) => !/^html\.(duo-laptop|duo-flat-portrait)\.map-route-active \.map-page > \.map-stage$/.test(s)), [], "padding-top: 0 範圍過寬");
  assert.equal(zeroPad.length, 2);
});

// #H3-3-T：筆電鍵盤展開時下緣改為鍵盤上緣（與直向攤平相同），--duo-map-kb-cap（#H3-2-T2 的筆電上限）整個移除：
//   不得再宣告或使用；面板層 bottom 與建議 max-height 只依 --duo-map-kb-edge（筆電／直向攤平成對，A7 已檢查）。
await check("A8b #H3-3 --duo-map-kb-cap 已移除（無宣告、無使用）；面板層 bottom 與建議 max-height 直接使用 --duo-map-kb-edge", () => {
  assert.doesNotMatch(nc, /--duo-map-kb-cap/, "styles.css（去註解）仍有 --duo-map-kb-cap");
  const bottomRules = leafRules.filter((r) => /bottom\s*:[^;]*var\(--duo-map-kb-edge\)/.test(r.body));
  assert.equal(bottomRules.length, 1, "面板層 bottom 使用 kb-edge 的規則數");
  assert.deepEqual(selsOf(bottomRules[0]), [
    "html.duo-laptop.map-route-active.map-keyboard-open .map-page > .map-sheet-layer",
    "html.duo-flat-portrait.map-route-active.map-keyboard-open .map-page > .map-sheet-layer",
  ]);
  const mh = leafRules.filter((r) => /max-height\s*:[^;]*var\(--duo-map-kb-edge\)/.test(r.body));
  assert.equal(mh.length, 1, "建議 max-height 使用 kb-edge 的規則數");
  assert.ok(selsOf(mh[0]).every((s) => /^html\.(duo-laptop|duo-flat-portrait)\.map-route-active\.map-keyboard-open /.test(s)));
});

// #H3-2-T2：內容外層 overflow visible（K1 頂端不露底）只在筆電／直向攤平＋/map；宣告只有 overflow: visible
await check("A8c main.app-scroll > div 的 overflow visible 只有一條規則：筆電＋直向攤平成對、限定 map-route-active、只宣告 overflow: visible、在探索段落內；其他 main.app-scroll > div 規則維持既有三條", () => {
  const rs = leafRules.filter((r) => /main\.app-scroll > div(?![\w-])/.test(r.sel) && r.depth === 0);
  const vis = rs.filter((r) => /overflow\s*:\s*visible/.test(r.body));
  assert.equal(vis.length, 1, "overflow visible 規則數");
  assert.deepEqual(selsOf(vis[0]), [
    "html.duo-laptop.map-route-active main.app-scroll > div",
    "html.duo-flat-portrait.map-route-active main.app-scroll > div",
  ]);
  assert.equal(vis[0].body.replace(/\s+/g, " ").trim(), "overflow: visible;");
  assert.ok(vis[0].open > exploreStart && vis[0].open < overlayStart, "不在探索段落");
  assert.doesNotMatch(vis[0].body, /!important/);
  const others = rs.filter((r) => r !== vis[0]).flatMap(selsOf);
  assert.deepEqual(others, [
    "html.trip-detail-route-active main.app-scroll > div",
    "html.place-route-active main.app-scroll > div",
    "html.duo-rail.duo-two-pane.trip-detail-route-active main.app-scroll > div",
  ], "其他 main.app-scroll > div 規則");
  // map-route-active 只由 _app（pathname === "/map"）與 MapView 掛載／卸載設定；/place、/profile 進入時移除
  const app = read("src/routes/_app.tsx");
  assert.match(app, /classList\.toggle\("map-route-active", pathname === "\/map"\)/);
  const hook = read("src/hooks/use-app-main-scroll.ts");
  assert.match(hook, /classList\.remove\("map-route-active"\)/);
});

// #H3-3-T2：[data-sheet-body-scroll] 的 min-height: 0 只在「筆電／直向攤平＋/map＋鍵盤展開」與既有詳情一頁式；
//   不得影響非鍵盤展開（min-height 8rem 規則不變）、一般 iPhone／iPad／雙欄（無 duo-laptop／duo-flat-portrait class）
await check("A9 #H3-3 [data-sheet-body-scroll] min-height: 0 規則範圍：只有鍵盤展開（成對、map-route-active）與既有詳情一頁式；8rem 規則不變；在探索段落、@layer 外、詳情規則之前", () => {
  const rs = leafRules.filter((r) => /\[data-sheet-body-scroll\]/.test(r.sel) && /min-height\s*:/.test(r.body));
  const kb = rs.filter((r) => /map-keyboard-open/.test(r.sel));
  assert.equal(kb.length, 1, "鍵盤展開 min-height 規則數");
  assert.deepEqual(selsOf(kb[0]), [
    'html.duo-laptop.map-route-active.map-keyboard-open .map-page [data-map-explore-sheet="true"] [data-sheet-body-scroll]',
    'html.duo-flat-portrait.map-route-active.map-keyboard-open .map-page [data-map-explore-sheet="true"] [data-sheet-body-scroll]',
  ]);
  assert.equal(kb[0].body.replace(/\s+/g, " ").trim(), "min-height: 0;", "只宣告 min-height: 0");
  assert.equal(kb[0].depth, 0);
  assert.ok(kb[0].open > exploreStart && kb[0].open < overlayStart, "不在探索段落");
  const base = rs.find((r) => /min-height:\s*8rem/.test(r.body));
  assert.ok(base, "min-height 8rem 規則不存在");
  assert.deepEqual(selsOf(base), [
    'html.duo-laptop.map-route-active .map-page [data-map-explore-sheet="true"] [data-sheet-body-scroll]',
    'html.duo-flat-portrait.map-route-active .map-page [data-map-explore-sheet="true"] [data-sheet-body-scroll]',
  ]);
  assert.ok(kb[0].open > base.open, "鍵盤規則須在 8rem 規則之後（同 specificity 以順序覆蓋）");
  const det = rs.filter((r) => /duo-map-detail-page/.test(r.sel));
  assert.equal(det.length, 1);
  assert.ok(det[0].open > kb[0].open, "詳情一頁式規則須在鍵盤規則之後");
  assert.deepEqual(rs.filter((r) => r !== kb[0] && r !== base && r !== det[0]).flatMap(selsOf), [], "其他含 min-height 的 [data-sheet-body-scroll] 規則");
  assert.ok(rs.flatMap(selsOf).every((s) => /^html\.(duo-laptop|duo-flat-portrait)\.map-route-active[.\s]/.test(s)), "範圍超出 Duo 上下版型＋/map");
});

// ───────────────────────── Part B：瀏覽器 ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));


function exportNamesOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*["'][^"']+["'])?/gm)) {
    if (/^export\s+type\s*\{/.test(m[0])) continue;
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  return [...names];
}

async function runBrowser() {
  const { build } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-duo-explore-kb-"));

  // ── CSS：NEW＝目前；BEFORE＝移除新 class 的規則 ──
  const compileCss = async (text) => {
    const compiler = await compile(text.replace(/^@import url\([^\n]*\n/m, ""), { base: path.join(root, "src"), onDependency() {} });
    const scanner = new Scanner({ sources: [...compiler.sources] });
    return compiler.build(scanner.scan());
  };
  const stylesBefore = (() => {
    // 移除 selector 含新 class 的規則（以原始字元位置切除整條規則；並列 selector 中只移除新 class 的那幾個）
    let out = "";
    let last = 0;
    const top = rulesOf(stripComments(styles)).filter((r) => r.depth === 0 && NEW_CLASS_RE.test(r.sel));
    for (const r of top) {
      const ss = r.sel.split(",").map((s) => s.trim());
      const keep = ss.filter((s) => !NEW_CLASS_RE.test(s));
      out += styles.slice(last, r.selStart);
      if (keep.length) out += "\n" + keep.join(",\n") + " " + styles.slice(r.open, r.close + 1);
      last = r.close + 1;
    }
    return out + styles.slice(last);
  })();
  const cssNew = await compileCss(styles);
  const cssBefore = await compileCss(stylesBefore);
  assert.match(cssNew, /duo-flat-portrait/);
  assert.doesNotMatch(cssBefore, /duo-flat-portrait|duo-map-kb-anim|duo-map-detail-page/);

  // ── 模組 mock ──
  const fnFiles = new Map(); // abs path → generated stub
  const stubFor = (abs, label) => {
    const src = fs.readFileSync(abs, "utf8");
    const names = exportNamesOf(src);
    return `const R=(n)=>{const f=(...a)=>window.__serverFn(${JSON.stringify(label)}+'#'+n,a);f.__stub=n;return f;};\n` + names.map((n) => `export const ${n}=R(${JSON.stringify(n)});`).join("\n");
  };
  const mocks = {
    "@tanstack/react-router": `import React from 'react';
const loc=()=>({pathname:'/map',search:{},searchStr:'',hash:'',href:'/map',state:{}});
const state={location:loc(),status:'idle',resolvedLocation:loc(),matches:[]};
export const createFileRoute=()=>(opts)=>({options:opts,useParams:()=>({}),useSearch:()=>({}),useLoaderData:()=>undefined});
export const createRoute=(opts)=>({options:opts});
export const Outlet=()=>{const C=window.__outlet;return C?React.createElement(C):null;};
export const useRouter=()=>({state,subscribe:()=>()=>{},navigate:(o)=>{(window.__nav||(window.__nav=[])).push(o);},history:{back(){}}});
export const useNavigate=()=>(o)=>{(window.__nav||(window.__nav=[])).push(o);return Promise.resolve();};
export const useRouterState=(o)=>o&&o.select?o.select(state):state;
export const useLocation=(o)=>o&&o.select?o.select(state.location):state.location;
export const useParams=()=>({});export const useSearch=()=>({});export const useMatch=()=>undefined;export const useBlocker=()=>{};
export const redirect=(o)=>o;export const notFound=()=>({});export const isRedirect=()=>false;export const isNotFound=()=>false;
export const useCanGoBack=()=>false;export const useRouteContext=()=>({});export const useLoaderData=()=>undefined;export const ScrollRestoration=()=>null;
export const Link=React.forwardRef(function Link({to,children,activeProps,inactiveProps,activeOptions,preload,params,search,replace,...rest},ref){return React.createElement('a',{ref,href:typeof to==='string'?to:'#',...rest},typeof children==='function'?children({isActive:false}):children);});`,
    "@tanstack/react-start": `export const createServerFn=()=>{const b={validator:()=>b,inputValidator:()=>b,middleware:()=>b,handler:()=>{const f=(...a)=>window.__serverFn('createServerFn',a);return f;}};return b;};
export const useServerFn=(f)=>f;export const createMiddleware=()=>{const m={server:()=>m,client:()=>m,middleware:()=>m};return m;};
export const createIsomorphicFn=()=>{const b={client:(f)=>{const g=(...a)=>f(...a);g.client=b.client;g.server=()=>g;return g;},server:()=>b};return b;};
export const getWebRequest=()=>null;`,
    "@/integrations/supabase/client": `const q=new Proxy(function(){},{get:(t,k)=>k==='then'?undefined:q,apply:()=>q});
export function isSupabaseConfigured(){return false;}
export function getSupabaseClient(){return supabase;}
export const supabase={auth:{getSession:async()=>({data:{session:null},error:null}),getUser:async()=>({data:{user:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>q,storage:{from:()=>q},channel:()=>q,removeChannel(){},functions:{invoke:async()=>({data:null,error:new Error('stub')})}};`,
    "@/hooks/use-i18n": `import {translate,translateList} from '@/lib/i18n/translate';
const ctx={locale:'zh-TW',localePreference:'zh-TW',t:(k,v)=>translate('zh-TW',k,v),tList:(k)=>translateList('zh-TW',k),setLocalePreference:async()=>{},setLocale:async()=>{}};
export function useI18n(){return ctx;} export function I18nProvider({children}){return children;}`,
    "@/hooks/use-access": `const a={hasPlusAccess:false,isPlus:false,tier:'free',loading:false,ready:true,refresh(){},setSubscriptionState(){},setTestOverride(){},clearTestOverride(){},enablePlusTestMode(){},disablePlusTestMode(){}};
export function useAccess(){return a;} export function useAccessOptional(){return a;} export function AccessProvider({children}){return children;}`,
    "@/hooks/use-avatar": `const a={avatarUrl:null,hasCustomAvatar:false,displayName:'T',profileMediaLoaded:true,avatarDisplaySrc:null,avatarDisplaySource:'none',hasCachedCustomEvidence:false,avatarPending:false,showAvatarDefault:true,avatarSrc:null,firstRenderSnapshot:{userIdentityKnown:true,avatarStatus:'none',hasMemoryCustom:false}};
export function useAvatar(){return a;} export function useAvatarDisplaySrc(){return null;} export function AvatarProvider({children}){return children;} export const avatarRevisionFromUpdatedAt=()=>0;`,
    "@/hooks/use-add-to-trip": `const v={openAddToTrip:(p,s)=>{(window.__calls||(window.__calls=[])).push(['openAddToTrip',s]);}};
export function useAddToTrip(){return v;} export function useAddToTripOptional(){return v;} export function AddToTripProvider({children}){return children;}`,
    "@/hooks/use-duo-layout": `import {useSyncExternalStore} from 'react';
const subs=new Set();let cur={navPlacement:'bottom',tripLayout:'single',usableWidth:0};
export function __setDuoLayout(v){cur=v;subs.forEach(f=>f());}
export function useDuoLayout(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>cur,()=>cur);}`,
    "@/lib/layout/duo-hinge": `const U=Object.freeze({supported:false,status:'unknown',angle:null,divisions:Object.freeze([]),occlusions:Object.freeze([])});
let cur=U;const subs=new Set();
export const UNSUPPORTED_DUO_HINGE_STATE=U;
export function normalizeDuoHingeState(x){return x;}
export function sameDuoHingeState(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function __setHinge(s){cur=s?Object.freeze({angle:null,occlusions:[],...s}):U;window.__hingeSubs=subs.size;subs.forEach(f=>f());}
export function __hingeSubCount(){return subs.size;}
export function subscribeDuoHinge(l){subs.add(l);return()=>subs.delete(l);}
export function getDuoHingeSnapshot(){return cur;}
export function getDuoHingeServerSnapshot(){return U;}`,
    "@/components/GoogleMap": `import React,{useEffect,useRef} from 'react';
export function GoogleMap({mapPadding,className,onMapReady}){
 const id=useRef(null);
 useEffect(()=>{const s=window.__map;s.mounts++;id.current=s.mounts;const base={__fake:id.current,getCenter:()=>({lat:()=>25.0478,lng:()=>121.5170}),getZoom:()=>15,getBounds:()=>null,getProjection:()=>null,getDiv:()=>null,setOptions:(o)=>{if(o&&o.padding)window.__map.setPadding++;}};
 const fake=new Proxy(base,{get:(t,k)=>k==='then'?undefined:(k in t?t[k]:()=>undefined)});onMapReady&&onMapReady(fake);return()=>{s.unmounts++;};},[]);
 useEffect(()=>{const s=window.__map;s.paddings.push(JSON.stringify(mapPadding));},[mapPadding]);
 return React.createElement('div',{className,'data-fake-google-map':'',style:{position:'relative',background:'#9cf'}},
  React.createElement('div',{'data-fake-google-logo':'',style:{position:'absolute',left:'6px',bottom:'2px',width:'66px',height:'26px',background:'#333',zIndex:1000000}}));
}`,
    // #H3-2-T：Capacitor Keyboard 事件邊界。與真實 capacitor-keyboard-bridge 相同的 subscribe／unsubscribe 語意
    //   （headless 沒有 window.Capacitor，真實檔案也不會安裝原生 listener），另外計數訂閱／退訂並可手動送出 keyboardWillShow／DidShow／Hide。
    "@/lib/capacitor-keyboard-bridge": `const subs=new Map();let nid=1;const st={subs:0,unsubs:0,dupUnsubs:0};
window.__kbBridge={show(hh){for(const s of [...subs.values()])s.onShow(hh);return true;},hide(){for(const s of [...subs.values()])s.onHide();return true;},stats(){return {active:subs.size,subs:st.subs,unsubs:st.unsubs,dupUnsubs:st.dupUnsubs};}};
export function bootstrapCapacitorKeyboardBridge(){}
export function subscribeCapacitorKeyboard(handlers){const k=nid++;subs.set(k,handlers);st.subs++;let done=false;return()=>{if(done)st.dupUnsubs++;else{done=true;st.unsubs++;}subs.delete(k);};}`,
    "@/lib/google-maps-loader": `export class GoogleMapsNetworkError extends Error{}
export function isGoogleMapsNetworkError(){return false;}
export function googleMapsScriptSrc(){return 'about:blank';}
export async function loadGoogleMapsApi(){throw new Error('stub');}
export function triggerMapResize(){window.__map.resizes++;}`,
  };
  const mockDir = {};

  // HEAD 版（BEFORE build）
  const headMap = git("show", "HEAD:src/routes/_app.map.tsx");
  const headKb = git("show", "HEAD:src/lib/map-search-keyboard.ts");
  const padCur = read("src/lib/map-visible-padding.ts");
  const padBefore = padCur.replace(/\(cl\.contains\("duo-laptop"\) \|\| cl\.contains\("duo-flat-portrait"\)\)/, 'cl.contains("duo-laptop")');
  assert.notEqual(padBefore, padCur, "BEFORE padding 改寫失敗");

  const SERVER_FN_RE = /\.functions\.tsx?$|[\\/]lib[\\/]pie[\\/]places-gateway\.ts$/;
  const makePlugin = (variant) => ({
    name: "fixtures",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.path in mocks) return { path: a.path, namespace: "mock" };
        if (variant === "before") {
          if (a.path === "@/routes/_app.map" ) return { path: "before:map", namespace: "mock" };
          if (a.path === "@/lib/map-search-keyboard") return { path: "before:kb", namespace: "mock" };
          if (a.path === "@/lib/map-visible-padding") return { path: "before:pad", namespace: "mock" };
        }
        return null;
      });
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => {
        if (a.path === "before:map") return { contents: headMap, loader: "tsx", resolveDir: path.join(root, "src/routes") };
        if (a.path === "before:kb") return { contents: headKb, loader: "ts", resolveDir: path.join(root, "src/lib") };
        if (a.path === "before:pad") return { contents: padBefore, loader: "ts", resolveDir: path.join(root, "src/lib") };
        return { contents: mocks[a.path], loader: "tsx", resolveDir: mockDir[a.path] ?? root };
      });
      b.onLoad({ filter: SERVER_FN_RE }, (a) => {
        const label = path.relative(root, a.path);
        return { contents: stubFor(a.path, label), loader: "ts", resolveDir: path.dirname(a.path) };
      });
    },
  });

  const entry = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n/*__ENTRY__\n")[1].split("\n__ENTRY__*/\n")[0];
  const doBuild = (variant) =>
    build({
      stdin: { contents: entry, resolveDir: root, loader: "tsx" },
      bundle: true,
      logLevel: "error",
      outfile: path.join(dir, variant + ".js"),
      format: "iife",
      jsx: "automatic",
      alias: { "@": path.join(root, "src") },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".css": "empty" },
      define: {
        "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development","SSR":false}',
        "process.env.NODE_ENV": '"development"',
        "process.env": "{}",
        global: "window",
      },
      plugins: [makePlugin(variant)],
    });
  await doBuild("cur");
  await doBuild("before");
  // 頁面中再掃一次 Tailwind class（真實元件的 class 由 compiler.sources 掃 src 取得）

  const cssJs = (w) => "window.__CSS=" + JSON.stringify(w === "before" ? cssBefore : cssNew) + ";";
  const server = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    const m = u.match(/^\/(cur|before)\.js$/);
    if (m) {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, m[1] + ".js")));
      return;
    }
    const v = u === "/before" ? "before" : "cur";
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style id="css">' +
        (v === "before" ? cssBefore : cssNew) +
        '</style><script>' + prelude() + '</script></head><body><div id="root"></div><script src="/' + v + '.js"></script></body></html>',
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
      if (r.method === "Runtime.exceptionThrown") browserErrors.push(r.params.exceptionDetails.exception?.description ?? r.params.exceptionDetails.text);
      if (r.method === "Runtime.consoleAPICalled" && r.params.type === "error") browserErrors.push("console.error: " + r.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
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
      if (r.exceptionDetails) throw new Error(String(r.exceptionDetails?.exception?.description ?? JSON.stringify(r.exceptionDetails)).slice(0, 1500));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await call("Network.setBlockedURLs", { urls: ["*googleapis.com*", "*gstatic.com*", "*google.com*", "*supabase*"] });
    const port = server.address().port;
    const viewport = (w, h, mobile = true) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    const reducedMotion = (on) => call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }] });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    let bootSeq = 0;
    /** 開新頁：variant cur／before；env＝{vw,vh,safeTop,safeBottom,layout,hinge} */
    async function boot(variant, env) {
      await viewport(env.vw, env.vh, env.mobile ?? true);
      await reducedMotion(!!env.reducedMotion);
      bootSeq++;
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/${variant === "before" ? "before" : ""}?n=${bootSeq}#` + encodeURIComponent(JSON.stringify(env)) });
      await wait(150);
      for (let i = 0; i < 150; i++) {
        const ok = await evaluate("!!window.__ready").catch(() => false);
        if (ok) break;
        await wait(100);
      }
      if (!(await evaluate("!!window.__ready").catch(() => false)))
        assert.fail("頁面未載入：" + (await evaluate("JSON.stringify({u:location.href,errs:window.__errs,rs:document.readyState})").catch((e) => String(e))) + "\n" + browserErrors.slice(-3).join("\n"));
      // 等到推薦清單（demo fallback）出現
      for (let i = 0; i < (env.noCards ? 0 : 100); i++) {
        const n = await evaluate("document.querySelectorAll('.map-page [data-place-card]').length");
        if (n >= 3) break;
        await wait(100);
      }
      await evaluate("window.__settle()");
    }
    const st = () => evaluate("window.__state()");

    if (process.argv.includes("--dump")) {
      await boot("cur", { vw: 669, vh: 951, safeTop: 0, safeBottom: 0, layout: "bottom", hinge: "laptop" });
      console.log(JSON.stringify(await st(), null, 1).slice(0, 6000));
      console.log(await evaluate("document.querySelector('.map-page')?.outerHTML.slice(0,4000)"));
      console.log(browserErrors.slice(0, 10).join("\n"));
      return;
    }

    await runScenarios({ boot, st, evaluate, call, wait, viewport, reducedMotion, externalRequests, browserErrors });
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

// 頁面最早執行：攔截網路（fetch／XHR／beacon）、計數器
function prelude() {
  return PRELUDE_SRC;
}
var PRELUDE_SRC = `
window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message||e)+' @'+(e.filename||'')+':'+(e.lineno||'')));addEventListener('unhandledrejection',e=>window.__errs.push('UR '+String(e.reason&&e.reason.message||e.reason).slice(0,200)));
window.__net=[];window.__serverCalls=[];window.__map={mounts:0,unmounts:0,resizes:0,setPadding:0,paddings:[]};
const _rec=(k,u)=>{window.__net.push(k+' '+String(u).slice(0,200));};
window.__fetchResponder=null;
window.__fakeGoogle=(u,b)=>{const url=b&&b.url||'';
 if(/places:autocomplete/.test(url))return {suggestions:Array.from({length:24},(_,i)=>({placePrediction:{placeId:'ChIJfake'+i,text:{text:'咖啡館 '+i},structuredFormat:{mainText:{text:'咖啡館 '+i},secondaryText:{text:'台北市 第 '+i+' 號'}},types:['cafe','food']}}))};
 const m=url.match(/places\\/(ChIJfake\\d+)/);if(m)return {id:m[1],displayName:{text:'咖啡館'},formattedAddress:'台北市中正區',location:{latitude:25.05,longitude:121.52},types:['cafe'],primaryType:'cafe',rating:4.2,userRatingCount:10,businessStatus:'OPERATIONAL'};
 return null;};
window.fetch=function(u,init){let inner='';try{const b=init&&typeof init.body==='string'?JSON.parse(init.body):null;inner=b&&b.url?' → '+b.url.replace(/[?].*$/,''):'';var body=b;}catch{}
 _rec('fetch',String(u&&u.url||u)+inner);const r=window.__fetchResponder&&window.__fetchResponder(String(u&&u.url||u),body);
 if(r)return Promise.resolve(new Response(JSON.stringify(r),{status:200,headers:{'Content-Type':'application/json'}}));
 return Promise.reject(new TypeError('Failed to fetch (stub)'));};
const XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){_rec('xhr',u);return XO.apply(this,arguments);};
XMLHttpRequest.prototype.send=function(){const x=this;setTimeout(()=>{x.dispatchEvent(new Event('error'));},0);};
navigator.sendBeacon=function(u){_rec('beacon',u);return true;};
window.__stubResponses={};
window.__serverFn=function(name,args){window.__serverCalls.push(name);const short=name.split('#')[1];const r=window.__stubResponses[short];
 if(r)return Promise.resolve(typeof r==='function'?r(...args):r);return Promise.reject(new Error('stub-offline:'+short));};
/* #H3-2-T3：MutationObserver 計數（建立／observe html／disconnect／同時存活的 html observer／html observer 的 callback 次數），
   以及 --duo-map-keyboard-top 的 setProperty／removeProperty 呼叫次數（只計 html style） */
(()=>{const N=window.MutationObserver;const st={created:0,htmlObserve:0,htmlDisconnect:0,htmlCb:0,maxActive:0,active:new Set()};let nid=0;
 class MO extends N{constructor(cb){let me=0;super((r,o)=>{if(st.active.has(me))st.htmlCb++;return cb(r,o);});me=++nid;this.__moId=me;st.created++;}
  observe(t,o){if(t===document.documentElement&&!st.active.has(this.__moId)){st.htmlObserve++;st.active.add(this.__moId);st.maxActive=Math.max(st.maxActive,st.active.size);}return super.observe(t,o);}
  disconnect(){if(st.active.has(this.__moId)){st.htmlDisconnect++;st.active.delete(this.__moId);}return super.disconnect();}}
 window.MutationObserver=MO;
 window.__moStats=()=>({created:st.created,htmlObserve:st.htmlObserve,htmlDisconnect:st.htmlDisconnect,htmlActive:st.active.size,maxActive:st.maxActive,htmlCb:st.htmlCb});
 const P=CSSStyleDeclaration.prototype,SP=P.setProperty,RP=P.removeProperty;const vw={set:0,rm:0};
 P.setProperty=function(n){if(n==='--duo-map-keyboard-top'&&this===document.documentElement.style)vw.set++;return SP.apply(this,arguments);};
 P.removeProperty=function(n){if(n==='--duo-map-keyboard-top'&&this===document.documentElement.style)vw.rm++;return RP.apply(this,arguments);};
 window.__varWrites=()=>({set:vw.set,rm:vw.rm});})();
`;

async function runScenarios({ boot, st, evaluate, call, wait, viewport, reducedMotion, externalRequests, browserErrors }) {
  const VW = 669;
  const VH = 951;
  const near = (a, b, msg, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const within = (r, t, b, msg) => {
    assert.ok(r, msg + "：元素不存在");
    assert.ok(r.h > 0, msg + "：高度 0");
    assert.ok(r.t >= t - 0.5 && r.b <= b + 0.5, `${msg}：[${r.t}, ${r.b}] 不在 [${t}, ${b}]`);
  };
  const geo = () => evaluate("window.__geo()");
  // #H3-2-T2：內容外層（main.app-scroll > div）改為 overflow visible 的副作用量測：
  //   外層／main／.map-page 範圍、各自 scrollTop、以及「面板層下緣～main 下緣」帶內的可點元素（原本被外層裁掉的區域）
  const wrapInfo = (xMax) =>
    evaluate(`(()=>{const m=document.querySelector('main.app-scroll');const w=m&&m.firstElementChild;const p=document.querySelector('.map-page');const ly=document.querySelector('.map-page > .map-sheet-layer');
 const R=e=>{const b=e.getBoundingClientRect();return {t:+b.top.toFixed(2),b:+b.bottom.toFixed(2)};};const mb=m.getBoundingClientRect().bottom;const lb=ly.getBoundingClientRect().bottom;
 const hits=[];for(let y=Math.ceil(lb)+1;y<mb;y+=6)for(let x=4;x<${xMax}-4;x+=24){const el=document.elementFromPoint(x,y);const hit=el&&el.closest('button,a[href],input,textarea,select,[role=button],[data-place-card],[data-roamie-map-background],[data-sheet-drag-handle]');if(hit)hits.push(x+','+y+':'+hit.tagName+'.'+String(hit.className).slice(0,24));}
 const cw=getComputedStyle(w),cm=getComputedStyle(m);
 return {wOv:cw.overflowX+'/'+cw.overflowY,mOv:cm.overflowX+'/'+cm.overflowY,w:R(w),m:R(m),p:R(p),layerB:+lb.toFixed(2),mst:m.scrollTop,wst:w.scrollTop,dst:document.scrollingElement.scrollTop,nHits:hits.length,hits:hits.slice(0,5)};})()`);
  const counts = () => evaluate("window.__counts()");
  const delta = (a, b) => ({ server: b.server - a.server, net: b.net - a.net, mounts: b.mounts - a.mounts, unmounts: b.unmounts - a.unmounts, names: b.serverNames.slice(a.server) });
  const setStub = (name, val) => evaluate(`window.__stubResponses[${JSON.stringify(name)}]=${val};true`);
  const sub = (errs) => (name, fn) => {
    try {
      fn();
    } catch (e) {
      errs.push(name + "：" + e.message);
    }
  };

  // 控制組：開機穩定後 2 秒內，閒置時不得有任何請求（否則下方計數不可信）
  const POSTURES = [
    { name: "筆電（底部導覽）", env: { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "bottom", hinge: "laptop", fold: [455.5, 495.5] }, cls: "duo-laptop" },
    { name: "筆電（右側直欄）", env: { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "rail", hinge: "laptop", fold: [455.5, 495.5] }, cls: "duo-laptop" },
    { name: "筆電（safe-top 47、safe-bottom 20）", env: { vw: VW, vh: VH, safeTop: 47, safeBottom: 20, layout: "bottom", hinge: "laptop", fold: [455.5, 495.5] }, cls: "duo-laptop" },
    { name: "直向攤平（原生 division）", env: { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "bottom", hinge: "flatDiv", fold: [455.5, 495.5] }, cls: "duo-flat-portrait" },
    { name: "直向攤平（無 division→中線）", env: { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "bottom", hinge: "flatMid", fold: [475.5, 475.5] }, cls: "duo-flat-portrait" },
    { name: "直向攤平（右側直欄＋中線）", env: { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "rail", hinge: "flatMid", fold: [475.5, 475.5] }, cls: "duo-flat-portrait" },
  ];
  const roInfo = [];
  for (const P of POSTURES) {
    const [TOP, BOTTOM] = P.env.fold;
    await boot("cur", P.env);
    const c0 = await counts();
    await wait(1500);
    const cIdle = await counts();
    await check(`K0 ${P.name}：開機後閒置 1.5 秒無請求（計數控制組）`, () => assert.deepEqual(delta(c0, cIdle), { server: 0, net: 0, mounts: 0, unmounts: 0, names: [] }));
    const g1 = await geo();
    const navTop = P.env.layout === "rail" ? VH : g1.nav.t;
    const xMax = P.env.layout === "rail" ? VW - 64 : VW;
    const logoHit = await evaluate("window.__hit('[data-fake-google-logo]')");
    const fold1 = await evaluate(`window.__foldHits(${TOP},${BOTTOM},${xMax})`);
    const errs = [];
    const s = sub(errs);
    s("class", () => {
      assert.ok(g1.html.split(" ").includes(P.cls), "html class：" + g1.html);
      assert.ok(!/duo-map-kb-anim|duo-map-detail-page/.test(g1.html), "初始不應有動畫／詳情 class：" + g1.html);
    });
    s("① 地圖上半部", () => {
      near(g1.canvas.t, 0, "畫布 top");
      near(g1.canvas.b, TOP, "畫布 bottom＝摺痕上緣");
    });
    s("① 搜尋列＋面板在下半部", () => {
      within(g1.form, BOTTOM, navTop, "搜尋框");
      within(g1.layer, BOTTOM, navTop + 1.01, "面板層");
      near(g1.layer.b, navTop, "面板層下緣＝底部導覽上緣", 1.01);
      within(g1.sheet, BOTTOM, navTop + 1.01, "面板");
      assert.ok(g1.form.b <= g1.layer.t + 0.5, "搜尋列與面板重疊");
      assert.ok(g1.layer.t - g1.beforeH >= BOTTOM - 0.5, `搜尋列底板上緣 ${g1.layer.t - g1.beforeH} 進入摺痕帶`);
      within(g1.title, BOTTOM, navTop, "推薦地點標題");
      within(g1.chips, BOTTOM, navTop, "分類膠囊");
      assert.ok(g1.firstCard && g1.firstCard.t >= BOTTOM - 0.5 && g1.firstCard.t < navTop, "第一張卡片在下半部：" + JSON.stringify(g1.firstCard));
      assert.equal(g1.sheetVis, "visible");
    });
    s("① Google logo 可見未被遮", () => {
      assert.ok(logoHit.ok, "logo 被遮：" + JSON.stringify(logoHit));
      within(g1.logo, 0, TOP, "logo");
    });
    s("① 摺痕帶無可點元素", () => assert.deepEqual(fold1.slice(0, 5), []));
    const fc1 = await evaluate("window.__fixedChains()");
    s("① fixed 元素祖先鏈乾淨（iOS WebKit 裁切）、.map-page 內無 fixed", () => assert.deepEqual(fc1, []));
    const lastPad = (await st()).map.lastPadding;
    // #H3-2：地圖延伸到螢幕頂端 → top＝頂部安全區（main 的 padding-top；右側直欄 html.duo-rail＝max(safe-top, 14px)）＋16；其餘 16/56/16
    const mainPadTop = await evaluate("parseFloat(getComputedStyle(document.querySelector('main.app-scroll')).paddingTop)");
    const expectSafeTop = P.env.layout === "rail" ? Math.max(P.env.safeTop || 0, 14) : P.env.safeTop || 0;
    s("① map padding（真實 measureMapExplorePadding）＝(頂部安全區+16)/16/56/16", () => {
      assert.equal(mainPadTop, expectSafeTop, "main padding-top");
      assert.deepEqual(JSON.parse(lastPad), { top: expectSafeTop + 16, right: 16, bottom: 56, left: 16 });
    });
    const strip = await evaluate(`window.__topStrip(${xMax})`);
    const w1 = await wrapInfo(xMax);
    // 實際像素（CDP 截圖 1×1，解 PNG）：頂端 y=2 與安全區中段，假地圖底色 #9cf＝(153,204,255)
    const pixelAt = async (x, y) => {
      const { data } = await call("Page.captureScreenshot", { format: "png", clip: { x, y, width: 1, height: 1, scale: 1 } });
      const buf = Buffer.from(data, "base64");
      let off = 8;
      const idat = [];
      let ihdr = null;
      while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString("ascii", off + 4, off + 8);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === "IHDR") ihdr = { w: body.readUInt32BE(0), ct: body[9] };
        if (type === "IDAT") idat.push(body);
        off += 12 + len;
      }
      const raw = (await import("node:zlib")).inflateSync(Buffer.concat(idat));
      return [raw[1], raw[2], raw[3]].join(",") + (ihdr && ihdr.w !== 1 ? " w=" + ihdr.w : "");
    };
    const px = [await pixelAt(120, 2), await pixelAt(120, Math.max(2, Math.floor(strip.safeInPage / 2))), await pixelAt(120, Math.max(2, strip.safeInPage + 4))];
    s("① #H3-2 截圖像素：頂端 y=2、安全區中段、安全區下方 4px 皆為地圖色（153,204,255）", () => assert.deepEqual(px, ["153,204,255", "153,204,255", "153,204,255"], "safeInPage=" + strip.safeInPage + " 實測 " + JSON.stringify(px)));
    s("① #H3-2 地圖延伸到螢幕頂端：.map-stage padding-top 0、頂端安全區帶全部落在地圖畫布（無米白底）", () => {
      assert.equal(strip.stagePadTop, "0px", "地圖層 padding-top");
      near(g1.stage.t, 0, "地圖層 top");
      assert.deepEqual(strip.miss.slice(0, 2), [], "頂端帶有非地圖元素（共 " + strip.miss.length + "／" + strip.n + " 點；y 範圍 " + [...new Set(strip.miss.map((m) => m.y))].join(",") + "）診斷：" + JSON.stringify(strip.diag));
    });
    await check(`K1 ${P.name} ①：地圖上半部、搜尋列＋標題＋膠囊＋卡片在下半部、Google logo 可見、摺痕帶無可點`, () => {
      assert.deepEqual(errs, []);
      console.log(`     （資訊）搜尋框 [${g1.form.t}, ${g1.form.b}]；面板層 [${g1.layer.t}, ${g1.layer.b}]；底板高 ${g1.beforeH}；logo [${g1.logo.t}, ${g1.logo.b}]`);
    });

    // ── ③′ 點搜尋列（未輸入）──
    await evaluate("window.__nodes()");
    const cBefore = await counts();
    const clsAtFocus = await evaluate("window.__focus()");
    const trAtFocus = await evaluate("window.__trans()");
    const frames = await evaluate("window.__sample(520)");
    const g3 = await geo();
    const errs3 = [];
    const s3 = sub(errs3);
    s3("動畫 class", () => {
      assert.ok(/\bduo-map-kb-anim\b/.test(clsAtFocus) && /\bmap-keyboard-open\b/.test(clsAtFocus), "聚焦當下 class：" + clsAtFocus);
      assert.match(trAtFocus.layer, /top.*bottom\|0\.25s, 0\.25s/, "面板層 transition：" + trAtFocus.layer);
      assert.match(trAtFocus.ov, /^top\|0\.25s$/, "搜尋列 transition：" + trAtFocus.ov);
      assert.match(trAtFocus.before, /height.*box-shadow\|0\.25s/, "底板 transition：" + trAtFocus.before);
      const lastAnim = frames.filter((f) => f.anim).pop();
      const firstOff = frames.find((f) => !f.anim);
      // tm＝自 focus() 呼叫起算（頁面內計時，不含 CDP 往返）
      assert.ok(lastAnim && firstOff && lastAnim.tm >= 380 && firstOff.tm >= 400 && firstOff.tm <= 480, `duo-map-kb-anim 約 400ms 後移除：最後 ${lastAnim?.tm}ms 有、${firstOff?.tm}ms 沒有`);
    });
    s3("整塊滑動（中間幀）", () => {
      const mids = frames.filter((f) => f.layerT < g1.layer.t - 2 && f.layerT > g3.layer.t + 2);
      assert.ok(mids.length >= 3, "沒有中間位置（未動畫）：" + frames.slice(0, 6).map((f) => f.t + ":" + f.layerT).join(","));
      for (const f of frames) near(f.rowT - g1.row.t, f.layerT - g1.layer.t, `第 ${f.t}ms 搜尋列與面板位移量不同`, 1.01);
      const settled = frames.find((f) => Math.abs(f.layerT - g3.layer.t) < 0.5);
      assert.ok(settled && settled.tm <= 320, "未在約 0.25s 內到位：" + settled?.tm);
    });
    s3("③′ 整塊在〔頂端, 摺痕上緣〕", () => {
      within(g3.form, 0, TOP, "搜尋框");
      within(g3.layer, 0, TOP, "面板層");
      near(g3.layer.b, TOP, "面板層下緣＝摺痕上緣", 1.01);
      near(g3.layer.t - g3.beforeH, 0, "底板上緣＝頂端", 1.01);
      near(g3.row.t - g1.row.t, g3.layer.t - g1.layer.t, "搜尋列與面板位移量相同", 0.6);
      assert.equal(g3.sheetVis, "visible", "未輸入時面板顯示推薦清單");
      assert.ok(g3.firstCard && g3.firstCard.t < TOP, "推薦卡片在上半部：" + JSON.stringify(g3.firstCard));
    });
    const same3 = await evaluate("window.__sameNodes()");
    const hits3 = await evaluate("[window.__hit('.map-page form input'),window.__hit('.map-page [data-place-card]'),window.__hit('.map-explore-chips button')]");
    s3("地圖節點仍掛載、同一節點", () => assert.deepEqual(same3, [true, true, true, true]));
    s3("③′ 可點", () => assert.deepEqual(hits3.filter((x) => !x.ok), []));
    const w3 = await wrapInfo(xMax);
    const cAfterOpen = await counts();
    roInfo.push(`${P.name} 開：padding 同步 ${frames[frames.length - 1].pad - frames[0].pad} 次、triggerMapResize ${frames[frames.length - 1].resizes - frames[0].resizes} 次`);
    // 第一輪：未輸入直接收起（請求計數只看這一輪）
    const cBeforeClose = await counts();
    await evaluate("window.__blurWait()");
    const frames2 = await evaluate("window.__sample(520)");
    const g6 = await geo();
    const cAfterClose = await counts();
    s3("收起動畫", () => {
      assert.ok(frames2[0].anim, "收起時沒有 duo-map-kb-anim");
      const mids = frames2.filter((f) => f.layerT > g3.layer.t + 2 && f.layerT < g1.layer.t - 2);
      assert.ok(mids.length >= 3, "收起沒有中間位置");
      for (const f of frames2) near(f.rowT - g1.row.t, f.layerT - g1.layer.t, `收起第 ${f.t}ms 搜尋列與面板位移量不同`, 1.01);
      assert.ok(!frames2[frames2.length - 1].anim, "收起後 class 未移除");
    });
    s3("收起後回到 ①（位置完全相同）", () => {
      for (const k of ["row", "form", "layer", "sheet", "chips", "canvas", "title"]) assert.deepEqual(g6[k], g1[k], k + " 與 ① 不同");
      assert.equal(g6.beforeH, g1.beforeH);
      assert.ok(!/map-keyboard-open|duo-map-kb-anim/.test(g6.html), g6.html);
    });
    const dOpen = delta(cBefore, cAfterOpen);
    const dClose = delta(cBeforeClose, cAfterClose);
    s3("開合鍵盤：Places／Routes／Geocoding 請求 0、地圖不 remount", () => {
      assert.deepEqual(dOpen, { server: 0, net: 0, mounts: 0, unmounts: 0, names: [] }, "開");
      assert.deepEqual(dClose, { server: 0, net: 0, mounts: 0, unmounts: 0, names: [] }, "合");
    });
    roInfo.push(`${P.name} 合：padding 同步 ${frames2[frames2.length - 1].pad - frames2[0].pad} 次、triggerMapResize ${frames2[frames2.length - 1].resizes - frames2[0].resizes} 次`);

    // ── 第二輪：③ 有輸入：建議清單 ──
    await evaluate("window.__focus()");
    await wait(450);
    await evaluate("window.__fetchResponder=window.__fakeGoogle;true");
    const cType = await counts();
    await evaluate("window.__type('咖啡')");
    for (let i = 0; i < 40; i++) {
      const n = await evaluate("document.querySelectorAll('.map-page .z-10 li').length");
      if (n >= 20) break;
      await wait(100);
    }
    await evaluate("window.__settle()");
    const g4 = await geo();
    const w4 = await wrapInfo(xMax);
    await check(`K14 ${P.name} 內容外層 overflow visible 副作用（其他姿勢不變由 N 快照證明）：由 main 裁切、.map-page 不超出外層下緣（①）、無額外捲動、裁切後露出區無可點元素`, () => {
      console.log(`     （資訊）① 外層 ${w1.wOv} [${w1.w.t}, ${w1.w.b}] main ${w1.mOv} [${w1.m.t}, ${w1.m.b}] 頁 [${w1.p.t}, ${w1.p.b}]；③′ 外層 [${w3.w.t}, ${w3.w.b}] main [${w3.m.t}, ${w3.m.b}] 頁 [${w3.p.t}, ${w3.p.b}] 面板層下緣 ${w3.layerB} 露出區可點 ${w3.nHits}；③ 可點 ${w4.nHits}`);
      for (const [k, w] of [["①", w1], ["③′", w3], ["③", w4]]) {
        assert.equal(w.wOv, "visible/visible", k + " 外層 overflow");
        assert.equal(w.mOv, "hidden/hidden", k + " main overflow（由 main 裁切）");
        assert.deepEqual([w.mst, w.wst, w.dst], [0, 0, 0], k + " main／外層／document scrollTop");
        assert.ok(w.p.t >= w.m.t - 0.5, `${k} .map-page 上緣 ${w.p.t} 超出 main 上緣 ${w.m.t}`);
      }
      // ①：.map-page 下緣＝外層下緣（只有頂端 -mt 溢出外層，下緣不溢出到底部導覽區）
      near(w1.p.b, w1.w.b, "① .map-page 下緣＝外層下緣");
      near(w1.p.t, w1.w.t - strip.safeInPage, "① .map-page 上緣＝外層上緣 − 頁內安全區");
      // ③′／③：鍵盤展開時 .map-page 高度鎖定（map-keyboard-open），超出外層的部分原本被外層裁掉，現在由 main 裁切 → 該區不得有可點元素
      assert.deepEqual(w3.hits, [], "③′ 面板層下緣～main 下緣有可點元素");
      assert.deepEqual(w4.hits, [], "③ 面板層下緣～main 下緣有可點元素");
    });
    const cTyped = await counts();
    const resultsText = await evaluate("(document.querySelector('.map-page .z-10')||{}).textContent+' | net:'+JSON.stringify(window.__net.slice(-3))+' | errs:'+JSON.stringify(window.__errs.slice(-3))");
    const lastSug = await evaluate("(()=>{const li=[...document.querySelectorAll('.map-page .z-10 li button')].pop();if(!li)return {missing:true,html:(document.querySelector('.map-page .z-10')||{}).innerHTML?.slice(-600),calls:window.__serverCalls.slice(-6)};li.scrollIntoView({block:'nearest'});return window.__hitEl(li);})()");
    s3("③ 建議清單在上半部、可內捲；面板 hidden", () => {
      assert.ok(g4.results, "沒有建議清單");
      within(g4.results, 0, TOP, "建議清單");
      assert.ok(g4.resultsUl.items >= 20, "建議筆數 " + g4.resultsUl.items + "；輸入後呼叫 " + JSON.stringify(cTyped.serverNames.slice(cType.server)) + " net+" + (cTyped.net - cType.net) + " " + resultsText);
      assert.ok(g4.resultsUl.sh > g4.resultsUl.ch && /auto|scroll/.test(g4.resultsUl.oy), "建議清單不可內捲：" + JSON.stringify(g4.resultsUl));
      assert.equal(g4.sheetVis, "hidden", "有建議時面板應 hidden");
      assert.ok(lastSug.ok && lastSug.rect.b <= TOP + 0.5, "捲到最後一筆建議不可點或超出上半部：" + JSON.stringify(lastSug));
      within(g4.form, 0, TOP, "搜尋框");
    });
    await evaluate("window.__type('')");
    await evaluate("window.__settle()");
    const g5 = await geo();
    s3("清除輸入後回到 ③′（面板顯示推薦清單）", () => {
      assert.equal(g5.results, null, "清除後仍有建議");
      assert.equal(g5.sheetVis, "visible");
      near(g5.layer.t, g3.layer.t, "面板層位置");
    });
    await evaluate("window.__blurWait()");
    await wait(1500);
    await evaluate("window.__settle()");
    const g7 = await geo();
    s3("第二輪收起後回到 ①", () => {
      for (const k of ["row", "form", "layer", "sheet", "canvas"]) assert.deepEqual(g7[k], g1[k], k + " 與 ① 不同");
    });
    await check(`K2 ${P.name} ③′／③／收起：整塊約 0.25s 上滑到〔頂端, 摺痕上緣〕、位移量相同、地圖不卸載；建議清單上半部內捲、面板 hidden；收起回到 ①；請求 0`, () => {
      assert.deepEqual(errs3, []);
      console.log(`     （資訊）③′ 面板層 [${g3.layer.t}, ${g3.layer.b}]、位移 ${(g3.layer.t - g1.layer.t).toFixed(1)}；③ 建議 [${g4.results?.t}, ${g4.results?.b}]（ul ${g4.resultsUl?.ch}/${g4.resultsUl?.sh}）`);
    });

    // ── 詳情一頁式 ──
    const cD0 = await counts();
    await evaluate("window.__clickCard(1)");
    const framesD = await evaluate("window.__sample(160)");
    await wait(300);
    await evaluate("window.__settle()");
    const gD = await geo();
    const scrollers = await evaluate("window.__vScrollers()");
    const fixedIn = await evaluate("window.__fixedInPage()");
    const fixedChainsD = await evaluate("window.__fixedChains()");
    const hdr = await evaluate("window.__headerScroll(100000)");
    const clickables = await evaluate("window.__detailClickables()");
    const errsD = [];
    const sD = sub(errsD);
    sD("class 與無動畫", () => {
      assert.ok(/\bduo-map-detail-page\b/.test(gD.html), gD.html);
      assert.ok(framesD.every((f) => !f.anim), "進入詳情時出現 duo-map-kb-anim");
      near(framesD[0].layerT, gD.layer.t, "進入詳情第一幀即到位（無滑動）", 0.6);
      assert.ok(framesD.every((f) => f.running === 0), "進入詳情時有 CSS 動畫／transition：" + JSON.stringify(framesD.map((f) => f.running)));
    });
    sD("面板佔滿整頁", () => {
      near(gD.layer.t, 0, "面板層 top");
      near(gD.layer.b, gD.page.b, "面板層 bottom＝頁面底（底部導覽上緣）");
      near(gD.sheet.t, 0, "面板 top");
      near(gD.sheet.h, gD.page.b, "面板高");
      assert.equal(gD.ovVis, "hidden", "搜尋列應隱藏");
    });
    sD("單一捲動、標頭跟著捲走", () => {
      assert.deepEqual(scrollers.map((x) => x.split(" ")[0]), ["SHEET"], "可垂直捲動容器：" + JSON.stringify(scrollers));
      // 直欄（頁高 951）時 demo 詳情內容只比整頁多幾 px：只要求可捲動，捲動量照實際最大值
      assert.ok(hdr.scrollTop >= 1, "面板無法捲動：" + hdr.scrollTop);
      near(hdr.after.t, hdr.before.t - hdr.scrollTop, "標頭未跟著捲走", 1.01);
      near(hdr.layer.t, 0, "捲動時面板層不動");
      assert.deepEqual(fixedIn, [], ".map-page 內有 fixed 元素（iOS 會被捲動容器裁切）");
      assert.deepEqual(fixedChainsD, [], "fixed 元素祖先鏈有 transform／捲動容器（iOS 裁切）");
    });
    sD("所有可點元素捲入後可點", () => {
      assert.ok(clickables.length >= 4, "可點元素數量 " + clickables.length);
      assert.deepEqual(clickables.filter((c) => !c.ok || c.pageScroll !== 0), []);
    });
    const cD1 = await counts();
    // 返回
    await evaluate("window.__clickBack()");
    const framesB = await evaluate("window.__sample(160)");
    await wait(300);
    await evaluate("window.__settle()");
    const gB = await geo();
    sD("返回後回到 ①、無動畫", () => {
      assert.ok(!/duo-map-detail-page|duo-map-kb-anim/.test(gB.html), gB.html);
      assert.ok(framesB.every((f) => !f.anim && f.running === 0), "返回時有動畫");
      for (const k of ["row", "form", "layer", "sheet", "canvas"]) assert.deepEqual(gB[k], g1[k], k + " 與 ① 不同");
      assert.equal(gB.ovVis, "visible");
      assert.equal(gB.sheetScroll.st, 0, "面板捲動未歸零");
    });
    const cD2 = await counts();
    const dDetail = delta(cD0, cD1);
    const dBack = delta(cD1, cD2);
    sD("進出詳情地圖不 remount", () => assert.deepEqual([dDetail.mounts, dDetail.unmounts, dBack.mounts, dBack.unmounts], [0, 0, 0, 0]));
    P.detailRequests = { enter: dDetail.names, back: dBack.names, netEnter: dDetail.net, netBack: dBack.net };
    await check(`K3 ${P.name} 詳情一頁式：佔滿整頁、單一捲動、標頭捲走、可點元素皆可點、無動畫；返回回到 ①`, () => {
      assert.deepEqual(errsD, []);
      console.log(`     （資訊）詳情面板 [${gD.sheet.t}, ${gD.sheet.b}]、可捲 ${gD.sheetScroll.ch}/${gD.sheetScroll.sh}；可點元素 ${clickables.length} 個`);
    });

    // ── 導航預覽：上地圖、下面板 ──
    await evaluate("window.__clickCard(1)");
    await evaluate("window.__settle()");
    const navBtn = await evaluate("window.__forceSheetMode('detail','navigation')");
    await wait(300);
    await evaluate("window.__settle()");
    const gN = await geo();
    const navHeader = await evaluate("!!document.querySelector('.map-page [data-map-explore-sheet]')&&document.querySelector('.map-page [data-map-explore-sheet]').textContent.length");
    await check(`K4 ${P.name} 導航預覽（sheetMode=navigation，fiber dispatch）：維持上地圖、下面板（無詳情一頁式 class）`, () => {
      assert.equal(navBtn, "ok", "無法切到導航預覽：" + navBtn);
      assert.ok(navHeader > 0);
      assert.ok(!/duo-map-detail-page/.test(gN.html), gN.html);
      near(gN.canvas.b, TOP, "畫布在上半部");
      assert.ok(gN.layer.t >= BOTTOM - 0.5, "面板層在下半部：" + gN.layer.t);
      assert.equal(gN.ovVis, "visible");
    });
    // 回到清單
    await evaluate("window.__clickBack()");
    await evaluate("window.__settle()");
    await evaluate("window.__clickBack()");
    await evaluate("window.__settle()");

    // ── 搜尋建議 → 詳情（鍵盤開著時點建議）──
    if (P === POSTURES[0] || P === POSTURES[3]) {
      await setStub(
        "fetchPlaceDetailsForScreenWithKeyViaGateway",
        JSON.stringify({ id: "ChIJfake3", name: "咖啡館 3", address: "台北市中正區", lat: 25.05, lng: 121.52, rating: 4.2, userRatingCount: 10, photoName: null, primaryType: "cafe", types: ["cafe"], businessStatus: "OPERATIONAL", openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "" }),
      );
      await evaluate("window.__focus()");
      await wait(450);
      await evaluate("window.__type('咖啡')");
      for (let i = 0; i < 40; i++) {
        if ((await evaluate("document.querySelectorAll('.map-page .z-10 li').length")) >= 20) break;
        await wait(100);
      }
      // 真機點建議：輸入框先失焦（150ms 後收鍵盤）、再觸發 click
      const fr = await evaluate(`(async()=>{const b=document.querySelectorAll('.map-page .z-10 li button')[3];document.querySelector('.map-page form input').blur();b.click();return window.__sample(900);})()`);
      const firstDetail = fr.find((f) => f.detail);
      if (!firstDetail) {
        await wait(2500);
        console.log("     （除錯）" + JSON.stringify({ html: (await geo()).html, net: (await st()).net.slice(-6), server: (await st()).server.slice(-6), errs: await evaluate("window.__errs.slice(-4)"), toast: await evaluate("(document.querySelector('[data-sonner-toaster]')||{}).textContent") }));
      }
      await check(`K5 ${P.name} 鍵盤開著時點搜尋建議進入詳情：進入詳情一頁式時不得有動畫（任務單：進出詳情沒有動畫）`, () => {
        assert.ok(firstDetail, "未進入詳情一頁式：" + JSON.stringify(fr.slice(-1)));
        const overlap = fr.filter((f) => f.detail && f.anim);
        const moving = fr.filter((f) => f.detail && f.running > 0);
        console.log(`     （資訊）詳情 class 於 ${firstDetail.t}ms 出現；同時帶 duo-map-kb-anim 的幀 ${overlap.length}、有 transition 執行中的幀 ${moving.length}；面板層 top 序列 ${fr.filter((f) => f.detail).slice(0, 8).map((f) => f.layerT).join(",")}`);
        assert.equal(moving.length, 0, `進入詳情時面板層仍在 transition（${moving.length} 幀），面板從鍵盤位置滑到整頁`);
      });
      if (/duo-map-detail-page/.test((await geo()).html)) await evaluate("window.__clickBack()");
      await evaluate("window.__blurWait()");
      await evaluate("window.__settle()");
      await evaluate("window.__type('')");
      await wait(1500);
      await evaluate("window.__settle()");
      // ③′（鍵盤開、未輸入）直接點推薦卡片進入詳情：輸入框先失焦（150ms 後收鍵盤）、再 click
      await evaluate("window.__focus()");
      await wait(450);
      const fr2 = await evaluate(`(async()=>{document.querySelector('.map-page form input').blur();document.querySelectorAll('.map-page [data-place-card]')[1].click();return window.__sample(700);})()`);
      const det2 = fr2.filter((f) => f.detail);
      await check(`K5b ${P.name} 鍵盤開著（未輸入）時點推薦卡片進入詳情：詳情面板不滑動`, () => {
        assert.ok(det2.length > 0, "未進入詳情");
        const ts = [...new Set(det2.map((f) => f.layerT))];
        console.log(`     （資訊）詳情幀面板層 top：${ts.slice(0, 6).join(",")}；帶 duo-map-kb-anim 的詳情幀 ${det2.filter((f) => f.anim).length}；transition 執行中 ${det2.filter((f) => f.running > 0).length}`);
        assert.deepEqual(ts, [0], "詳情面板位置在變動");
        // 搜尋列外層（.z-10）在詳情一頁式為 visibility hidden，其 top transition 不可見，不計
        const visibleMoving = det2.filter((f) => f.names && f.names.split(",").some((n) => !n.startsWith("top@pointer-events-none")));
        assert.equal(visibleMoving.length, 0, "可見元素有 transition 執行中：" + [...new Set(visibleMoving.map((f) => f.names))].join(" "));
      });
      if (/duo-map-detail-page/.test((await geo()).html)) await evaluate("window.__clickBack()");
      await evaluate("window.__settle()");
      await setStub("fetchPlaceDetailsForScreenWithKeyViaGateway", "undefined");
    }

    // ── 姿勢切換：無動畫、無請求、不 remount ──
    {
      const c = await counts();
      const seq = P.cls === "duo-laptop" ? ["closed", "laptop", "flatDiv", "laptop"] : ["closed", P.env.hinge, "laptop", P.env.hinge];
      const out = [];
      for (const hg of seq) {
        await evaluate(`window.__setPostureAsync(${JSON.stringify(hg === "closed" ? "rail" : P.env.layout)},${JSON.stringify(hg)})`);
        const fr = await evaluate("window.__sample(450)");
        out.push({ hg, anim: fr.some((f) => f.anim), running: Math.max(...fr.map((f) => f.running)), names: [...new Set(fr.map((f) => f.names).filter(Boolean))].join(" "), html: (await geo()).html });
      }
      const c2 = await counts();
      const d = delta(c, c2);
      await check(`K6 ${P.name} 姿勢切換 ${seq.join("→")}：沒有 duo-map-kb-anim／transition、請求 0、地圖不 remount`, () => {
        assert.deepEqual(out.filter((o) => o.anim || o.running > 0), []);
        assert.deepEqual(d, { server: 0, net: 0, mounts: 0, unmounts: 0, names: [] });
        assert.ok(out[out.length - 1].html.includes(P.cls), "最後回到原姿勢：" + out[out.length - 1].html);
      });
    }
  }
  for (const r of roInfo) info("ResizeObserver（動畫期間）" + r);

  // ── 進出詳情的請求：Duo 與一般 iPhone 相同（詳情本身的既有請求不因版型增加）──
  {
    await boot("cur", { vw: 390, vh: 844, safeTop: 47, safeBottom: 34, layout: "bottom", hinge: "none" });
    const c0 = await counts();
    await evaluate("window.__clickCard(1)");
    await wait(300);
    await evaluate("window.__settle()");
    const c1 = await counts();
    await evaluate("window.__clickBack()");
    await wait(300);
    await evaluate("window.__settle()");
    const c2 = await counts();
    const phone = { enter: delta(c0, c1).names, back: delta(c1, c2).names, netEnter: c1.net - c0.net, netBack: c2.net - c1.net };
    await check("K7 進出詳情的 server fn／網路請求：所有 Duo 姿勢與一般 iPhone 完全相同", () => {
      for (const P of POSTURES) assert.deepEqual(P.detailRequests, phone, P.name);
      console.log("     （資訊）一般 iPhone 進入詳情請求：" + JSON.stringify(phone));
    });
  }

  // ── reduced motion ──
  for (const P of [POSTURES[0], POSTURES[3]]) {
    await boot("cur", { ...P.env, reducedMotion: true });
    const g1 = await geo();
    const cls = await evaluate("window.__focus()");
    const tr = await evaluate("window.__trans()");
    const fr = await evaluate("window.__sample(200)");
    const g3 = await geo();
    await evaluate("window.__blurWait()");
    const fr2 = await evaluate("window.__sample(200)");
    await check(`K8 ${P.name} prefers-reduced-motion：沒有 duo-map-kb-anim、沒有 transition、直接切換`, () => {
      assert.doesNotMatch(cls, /duo-map-kb-anim/);
      assert.match(tr.layer, /\|0s$/, tr.layer);
      assert.ok(fr.every((f) => !f.anim && f.running === 0) && fr2.every((f) => !f.anim && f.running === 0), "有動畫");
      near(fr[0].layerT, g3.layer.t, "第一幀即到位");
      assert.ok(g3.layer.b <= P.env.fold[0] + 1.01 && g1.layer.t >= P.env.fold[1] - 0.5);
    });
  }

  // ───────── K11（#H3-2-T）：模擬鍵盤高度（mock capacitor-keyboard-bridge，送出 keyboardWillShow＋DidShow 的 keyboardHeight）─────────
  //   直向攤平：整塊下緣＝鍵盤上緣（innerHeight − h）；筆電：min(摺痕上緣, 鍵盤上緣)；沒有鍵盤事件時退回摺痕（中線）。
  //   SHORT＝350（矮於下半部 951−455.5＝495.5）；TALL＝600（高於下半部，也高於半屏 475.5）。
  {
    const SHORT = 350;
    const TALL = 600;
    const kbStats = () => evaluate("window.__kbBridge.stats()");
    const kbShow = (hgt) => evaluate(`window.__kbBridge.show(${hgt});window.__kbBridge.show(${hgt})`);
    const settleKb = async () => {
      await wait(450);
      await evaluate("window.__settle()");
    };
    for (const P of [POSTURES[0], POSTURES[1], POSTURES[2], POSTURES[3], POSTURES[4], POSTURES[5]]) {
      const [TOP] = P.env.fold;
      const lap = P.cls === "duo-laptop";
      await boot("cur", P.env);
      await evaluate("window.__fetchResponder=window.__fakeGoogle;true");
      await wait(1000);
      await evaluate("window.__settle()");
      const g1 = await geo();
      const k0 = await kbStats();
      await evaluate("window.__focus()");
      await settleKb();
      const kF = await kbStats();
      const gF = await geo();
      const vF = await evaluate("window.__kbVar()");
      await kbShow(SHORT);
      await settleKb();
      const gS = await geo();
      const vS = await evaluate("window.__kbVar()");
      const cS = await evaluate(`window.__cardsScroll(${VH - SHORT})`);
      const dS = await evaluate(`window.__dualScroll(${VH - SHORT})`);
      await kbShow(TALL);
      await settleKb();
      const gT = await geo();
      const vT = await evaluate("window.__kbVar()");
      const cT = await evaluate(`window.__cardsScroll(${VH - TALL})`);
      const dT = await evaluate(`window.__dualScroll(${VH - TALL})`);
      // 鍵盤高（TALL）時的搜尋建議
      await evaluate("window.__type('咖啡')");
      for (let i = 0; i < 40; i++) {
        if ((await evaluate("document.querySelectorAll('.map-page .z-10 li').length")) >= 20) break;
        await wait(100);
      }
      await evaluate("window.__settle()");
      const gR = await geo();
      const safeIn = await evaluate("window.__safeInPage()");
      const lastSug = await evaluate("(()=>{const li=[...document.querySelectorAll('.map-page .z-10 li button')].pop();if(!li)return {missing:true};li.scrollIntoView({block:'nearest'});return window.__hitEl(li);})()");
      await evaluate("window.__type('')");
      await evaluate("window.__settle()");
      // 鍵盤收起（仍聚焦）
      await evaluate("window.__kbBridge.hide();window.__kbBridge.hide()");
      await settleKb();
      const gH = await geo();
      const vH = await evaluate("window.__kbVar()");
      // 再開一次後直接失焦（不送 hide）
      await kbShow(SHORT);
      await settleKb();
      const vS2 = await evaluate("window.__kbVar()");
      await evaluate("window.__blurWait()");
      await wait(1200);
      await evaluate("window.__settle()");
      const gB = await geo();
      const vB = await evaluate("window.__kbVar()");
      const kB = await kbStats();
      // 退訂後殘留事件不得寫入
      await kbShow(SHORT);
      await evaluate("window.__settle()");
      const vStray = await evaluate("window.__kbVar()");
      // 第二輪聚焦／失焦（StrictMode）：每輪恰好一次訂閱與退訂
      await evaluate("window.__focus()");
      await settleKb();
      const k2 = await kbStats();
      await evaluate("window.__blurWait()");
      await wait(600);
      const k3 = await kbStats();

      // #H3-3：筆電與直向攤平相同，下緣＝鍵盤上緣（不再上限於摺痕上緣）
      const expS = VH - SHORT;
      const expT = VH - TALL;
      const errs = [];
      const s = sub(errs);
      s("聚焦：恰好新增 1 個訂閱、尚無鍵盤事件時不寫變數、下緣退回摺痕上緣（中線）", () => {
        assert.deepEqual([kF.active - k0.active, kF.subs - k0.subs, kF.unsubs - k0.unsubs], [1, 1, 0], JSON.stringify([k0, kF]));
        assert.equal(vF, "", "聚焦當下 --duo-map-keyboard-top");
        near(gF.layer.b, TOP, "面板層下緣（fallback）", 1.01);
      });
      s(`keyboardHeight ${SHORT}：面板層下緣＝鍵盤上緣 innerHeight−${SHORT}`, () => {
        near(gS.layer.b, expS, "面板層下緣", 1.01);
        assert.ok(gS.form.b <= gS.layer.t + 0.5 && gS.form.t >= -0.5, "搜尋列不在面板層上方：" + JSON.stringify([gS.form, gS.layer]));
        assert.ok(gS.layer.t - gS.beforeH <= 0.5, "底板上緣應在頂端：" + (gS.layer.t - gS.beforeH));
      });
      s(`keyboardHeight ${TALL}：面板層下緣＝鍵盤上緣 ${VH - TALL}`, () => {
        near(gT.layer.b, expT, "面板層下緣", 1.01);
        assert.ok(gT.layer.h > 0 && gT.sheet.h > 0, "面板層高度");
      });
      // #H3-3：鍵盤矮於下半部時，面板層蓋過鉸鏈區（下緣在摺痕下緣之下），鉸鏈帶內不得露出地圖畫布
      s(`#H3-3 keyboardHeight ${SHORT}：面板層蓋過鉸鏈區（下緣 > 摺痕下緣 ${P.env.fold[1]}），鉸鏈帶無地圖露出`, () => {
        assert.ok(gS.layer.b > P.env.fold[1], `面板層下緣 ${gS.layer.b} 未蓋過摺痕下緣 ${P.env.fold[1]}`);
        assert.ok(gS.layer.t <= TOP, `面板層上緣 ${gS.layer.t} 在摺痕上緣 ${TOP} 之下`);
        assert.deepEqual(cS.foldMapHits, [], "鉸鏈帶露出地圖畫布");
      });
      // #H3-3：卡片維持原尺寸 276×364（照片 170）；面板（唯一垂直捲動容器）捲到底時最後一張卡片下緣不超過鍵盤上緣
      for (const [kb, c] of [[SHORT, cS], [TALL, cT]]) {
        s(`#H3-3 keyboardHeight ${kb}：卡片 276×364（照片 170）、面板可捲動、捲到底最後一張卡片下緣 ≤ 鍵盤上緣 ${VH - kb}`, () => {
          assert.ok(c && !c.missing, "找不到面板／卡片：" + JSON.stringify(c));
          assert.ok(c.n >= 3, "卡片數 " + c.n);
          assert.deepEqual(c.sizes, [[276, 364, 170]], "卡片尺寸（寬／高／照片高）：" + JSON.stringify(c.sizes));
          if (c.cardBottomAt0 > VH - kb + 0.5) {
            // 卡片在未捲動時被鍵盤蓋住 → 面板（或其內層 body）必須能捲動
            assert.ok(c.canScroll, `卡片下緣 ${c.cardBottomAt0} 被鍵盤蓋住但面板無法捲動：` + JSON.stringify(c.scrollers));
          }
          assert.ok(c.lastBottomAtEnd <= VH - kb + 0.5, `捲到底後最後一張卡片下緣 ${c.lastBottomAtEnd} 超過鍵盤上緣 ${VH - kb}（捲動容器 ${JSON.stringify(c.scrollers)}）`);
          assert.ok(c.hitAtEnd, "捲到底後卡片下緣附近不可點：" + JSON.stringify(c.hitBy));
          assert.equal(c.stAfter, 0, "量測後應還原 scrollTop");
        });
      }
      s(`keyboardHeight ${TALL}＋搜尋建議：建議清單高度上限跟著新下緣、最後一筆可點、面板 hidden`, () => {
        assert.ok(gR.results && gR.resultsUl && gR.resultsUl.items >= 20, "沒有建議清單：" + JSON.stringify(gR.resultsUl));
        assert.ok(gR.results.b <= expT + 0.5, `建議清單下緣 ${gR.results.b} 超過鍵盤上緣 ${expT}`);
        assert.equal(gR.resultsUl.mh, Math.max(96, expT - safeIn - 64) + "px", "ul max-height");
        assert.ok(lastSug.ok && lastSug.rect.b <= expT + 0.5, "最後一筆建議：" + JSON.stringify(lastSug));
        assert.equal(gR.sheetVis, "hidden");
      });
      s("鍵盤收起（仍聚焦）：變數移除、下緣退回摺痕上緣（中線）", () => {
        assert.equal(vH, "");
        near(gH.layer.b, TOP, "面板層下緣", 1.01);
      });
      s("失焦：變數移除、訂閱退回、回到 ①（位置完全相同）；退訂後的殘留事件不寫入", () => {
        assert.notEqual(vS2, "", "第二次 show 應寫入變數");
        assert.equal(vB, "");
        assert.deepEqual([kB.active, kB.subs - k0.subs, kB.unsubs - k0.unsubs, kB.dupUnsubs], [k0.active, 1, 1, 0], JSON.stringify([k0, kB]));
        for (const k of ["row", "form", "layer", "sheet", "canvas"]) assert.deepEqual(gB[k], g1[k], k + " 與 ① 不同");
        assert.ok(!/map-keyboard-open/.test(gB.html), gB.html);
        assert.equal(vStray, "", "退訂後 show 仍寫入變數");
      });
      s("第二輪聚焦／失焦（StrictMode）：再新增恰好 1 個訂閱並退訂，無重複訂閱", () => {
        assert.deepEqual([k2.active - k0.active, k2.subs - kB.subs], [1, 1], JSON.stringify([kB, k2]));
        assert.deepEqual([k3.active, k3.unsubs - kB.unsubs, k3.dupUnsubs], [k0.active, 1, 0], JSON.stringify(k3));
      });
      await check(`K11 ${P.name} 模擬鍵盤：${SHORT}→下緣 ${expS}、${TALL}→下緣 ${expT}、收起退回摺痕、失焦回到 ①、訂閱成對`, () => {
        console.log(`     （資訊）--duo-map-keyboard-top：${SHORT}→${vS}、${TALL}→${vT}；面板層下緣 ${gS.layer.b}／${gT.layer.b}；建議 [${gR.results?.t}, ${gR.results?.b}] ul max-height ${gR.resultsUl?.mh}`);
        console.log(`     （資訊）#H3-3 卡片：${SHORT} 尺寸 ${JSON.stringify(cS.sizes)} 捲動容器 ${JSON.stringify(cS.scrollers)} 未捲動卡片下緣 ${cS.cardBottomAt0} 捲到底 ${cS.lastBottomAtEnd}；${TALL} 尺寸 ${JSON.stringify(cT.sizes)} 捲動容器 ${JSON.stringify(cT.scrollers)} 未捲動 ${cT.cardBottomAt0} 捲到底 ${cT.lastBottomAtEnd}`);
        assert.deepEqual(errs, []);
      });
      // #H3-3-T2：鍵盤展開時只剩內層一層捲動：外層 SHEET 無多餘可捲距離；內層 BODY 捲到底時最後一張卡片完整露出（不被鍵盤蓋、不被 BODY 裁）
      for (const [kb, d] of [[SHORT, dS], [TALL, dT]]) {
        const room = d && !d.missing ? d.body.ch - d.padT - d.padB : 0; // BODY 內容區可視高
        await check(`K17 ${P.name} 鍵盤 ${kb}：外層 SHEET scrollHeight===clientHeight（可捲 0）、唯一捲動容器為 BODY（min-height 0）、BODY 捲到底最後一張卡片下緣露出（不被鍵盤／BODY 裁，下方只剩卡片列內距）、水平在畫面內且可點`, () => {
          console.log(`     （資訊）SHEET ${d.sheet?.sh}/${d.sheet?.ch} max=${d.sheet?.max}；BODY ${d.body?.sh}/${d.body?.ch}（padding ${d.padT}/${d.padB}，內容可視 ${room}）max=${d.body?.max} min-height=${d.body?.mh} [${d.body?.t}, ${d.body?.b}]；最後卡片 [${d.last?.t}, ${d.last?.b}] l=${d.last?.l} r=${d.last?.r}；捲動容器 ${JSON.stringify(d.vsc)}；卡片列 overflow ${d.cardsOx}/${d.cardsOy}`);
          assert.ok(d && !d.missing, "找不到面板／BODY／卡片：" + JSON.stringify(d));
          assert.equal(d.sheet.sh, d.sheet.ch, "外層 SHEET scrollHeight 應等於 clientHeight");
          assert.equal(d.sheet.max, 0, "外層 SHEET 不得可捲");
          assert.equal(d.body.mh, "0px", "鍵盤展開時 BODY min-height");
          assert.ok(/auto|scroll/.test(d.body.oy), "BODY 應可垂直捲動：" + d.body.oy);
          assert.deepEqual(d.vsc.filter((x) => x !== "BODY"), [], "BODY 以外仍有可垂直捲動容器");
          assert.ok(d.body.b <= VH - kb + 0.5, `BODY 下緣 ${d.body.b} 超過鍵盤上緣 ${VH - kb}`);
          assert.ok(d.last.b <= d.body.b + 0.5 && d.last.b <= VH - kb + 0.5, `捲到底後最後一張卡片下緣 ${d.last.b} 被 BODY（${d.body.b}）或鍵盤（${VH - kb}）裁切`);
          // 捲到底後卡片下緣與 BODY 下緣之間只剩卡片列自身的底部內距（BODY scrollHeight＝卡片 364＋上下內距約 24）
          if (d.body.sh > d.body.ch) assert.ok(d.body.b - d.last.b <= 24, `捲到底後最後一張卡片下緣 ${d.last.b} 距 BODY 下緣 ${d.body.b} 超過 24px（BODY 未捲到卡片底）`);
          assert.equal(d.body.max, d.body.sh - d.body.ch, "BODY 應可捲到底");
          assert.ok(d.last.l >= -0.5 && d.last.r <= d.vw + 0.5, `卡片列捲到最後一張後卡片水平超出畫面：[${d.last.l}, ${d.last.r}]`);
          assert.ok(d.lastHit, "最後一張卡片下緣附近不可點：" + d.lastHitBy);
          assert.ok(d.restored, "量測後未還原 scrollTop／scrollLeft");
        });
        // 「完整露出」：BODY 內容可視高 ≥ 卡片高才可能；不可能時列為規格衝突（卡片 364 固定＋面板下緣＝鍵盤上緣），交指派者裁定
        if (d && !d.missing && room >= d.last.h + (d.body.b - d.last.b) - 0.5) {
          await check(`K17b ${P.name} 鍵盤 ${kb}：BODY 捲到底最後一張卡片完整在 BODY 可視區內`, () => {
            assert.ok(d.last.t >= d.body.t - 0.5 && d.last.b <= d.body.b + 0.5, `最後一張卡片 [${d.last.t}, ${d.last.b}] 不在 BODY [${d.body.t}, ${d.body.b}]`);
          });
        } else if (d && !d.missing) {
          info(`K17b ${P.name} 鍵盤 ${kb}：BODY 可視高 ${room}px < 內容高 ${d.body.sh}px（卡片 ${d.last.h}＋內距），最後一張卡片無法完整露出（捲到底可見 ${(Math.min(d.last.b, d.body.b) - Math.max(d.last.t, d.body.t)).toFixed(1)}px）— 與「卡片 276×364 不變、面板下緣＝鍵盤上緣」幾何衝突`);
        }
      }
    }

    // 鍵盤開著時切換姿勢（真實 _app 150ms 穩定化後）
    const postureSwitch = async (fromEnv, toLayout, toHinge) => {
      await boot("cur", fromEnv);
      await evaluate("window.__focus()");
      await settleKb();
      await kbShow(SHORT);
      await settleKb();
      const v0 = await evaluate("window.__kbVar()");
      const g0 = await geo();
      await evaluate(`window.__setPostureAsync(${JSON.stringify(toLayout)},${JSON.stringify(toHinge)})`);
      await wait(500);
      await evaluate("window.__settle()");
      const g = await geo();
      const v = await evaluate("window.__kbVar()");
      const k = await kbStats();
      await evaluate("window.__blurWait()");
      await wait(600);
      const kAfter = await kbStats();
      const vAfter = await evaluate("window.__kbVar()");
      return { v0, g0, g, v, k, kAfter, vAfter };
    };
    const [TOP] = POSTURES[0].env.fold;
    const f2l = await postureSwitch(POSTURES[3].env, "bottom", "laptop");
    // #H3-3：筆電與直向攤平相同（下緣＝鍵盤上緣），切到筆電後下緣不變、不退回摺痕上緣
    await check(`K12a 鍵盤開著（${SHORT}）直向攤平→筆電：面板層下緣維持鍵盤上緣 ${VH - SHORT}（#H3-3 不再上限於摺痕上緣 ${TOP}）`, () => {
      console.log(`     （資訊）切換前 var=${f2l.v0}、下緣 ${f2l.g0.layer.b}；切換後 class ${/duo-laptop/.test(f2l.g.html) ? "duo-laptop" : f2l.g.html}、var=${f2l.v}、下緣 ${f2l.g.layer.b}`);
      assert.ok(/\bduo-laptop\b/.test(f2l.g.html), "未切到筆電：" + f2l.g.html);
      assert.ok(!/\bduo-flat-portrait\b/.test(f2l.g.html), "兩個 class 並存：" + f2l.g.html);
      near(f2l.g0.layer.b, VH - SHORT, "切換前面板層下緣", 1.01);
      near(f2l.g.layer.b, VH - SHORT, `切換後面板層下緣（--duo-map-keyboard-top=${f2l.v}）`, 1.01);
    });
    const l2f = await postureSwitch(POSTURES[0].env, "bottom", "flatDiv");
    await check(`K12b 鍵盤開著（${SHORT}）筆電→直向攤平：面板層下緣＝鍵盤上緣 ${VH - SHORT}`, () => {
      console.log(`     （資訊）切換前 var=${l2f.v0}、下緣 ${l2f.g0.layer.b}；切換後 var=${l2f.v}、下緣 ${l2f.g.layer.b}`);
      assert.ok(/\bduo-flat-portrait\b/.test(l2f.g.html), "未切到直向攤平：" + l2f.g.html);
      near(l2f.g.layer.b, VH - SHORT, "面板層下緣", 1.01);
    });
    const l2c = await postureSwitch(POSTURES[0].env, "rail", "closed");
    await check(`K12c 鍵盤開著筆電→合起：失焦後訂閱退回、變數移除（切換期間殘留只記錄）`, () => {
      console.log(`     （資訊）合起後失焦前 var=${JSON.stringify(l2c.v)}、active ${l2c.k.active}`);
      assert.equal(l2c.vAfter, "");
      assert.equal(l2c.kAfter.dupUnsubs, 0);
      assert.equal(l2c.kAfter.unsubs, l2c.kAfter.subs, "訂閱未全部退回：" + JSON.stringify(l2c.kAfter));
    });

    // #H3-2-T2 K12d／K12e：在「合起」聚焦（鍵盤開著）後攤平到直向攤平／筆電。
    //   切換後再送一次 keyboardWillShow／DidShow（模擬 iOS 鍵盤 frame 改變時重送；不要求 bridge 快取切換前的高度）。
    const closedSwitch = async (toHinge) => {
      await boot("cur", { vw: VW, vh: VH, layout: "rail", hinge: "closed" });
      await evaluate("window.__focus()");
      await settleKb();
      await kbShow(TALL);
      await settleKb();
      await evaluate(`window.__setPostureAsync("bottom",${JSON.stringify(toHinge)})`);
      await wait(500);
      await evaluate("window.__settle()");
      const gNoEv = await geo();
      const vNoEv = await evaluate("window.__kbVar()");
      await kbShow(TALL);
      await settleKb();
      const g = await geo();
      const v = await evaluate("window.__kbVar()");
      const k = await kbStats();
      await evaluate("window.__blurWait()");
      await wait(600);
      const kAfter = await kbStats();
      const vAfter = await evaluate("window.__kbVar()");
      return { gNoEv, vNoEv, g, v, k, kAfter, vAfter };
    };
    const c2f = await closedSwitch("flatDiv");
    await check(`K12d 合起時聚焦（鍵盤 ${TALL}）→直向攤平、切換後鍵盤事件重送：面板層下緣＝鍵盤上緣 ${VH - TALL}（不得停在中線／摺痕而被鍵盤蓋住）`, () => {
      console.log(`     （資訊）切換後未重送：var=${JSON.stringify(c2f.vNoEv)}、下緣 ${c2f.gNoEv.layer.b}；重送後：var=${JSON.stringify(c2f.v)}、下緣 ${c2f.g.layer.b}、active ${c2f.k.active}；失焦後 var=${JSON.stringify(c2f.vAfter)} active ${c2f.kAfter.active}`);
      assert.ok(/\bduo-flat-portrait\b/.test(c2f.g.html), "未切到直向攤平：" + c2f.g.html);
      near(c2f.g.layer.b, VH - TALL, `面板層下緣（--duo-map-keyboard-top=${JSON.stringify(c2f.v)}）`, 1.01);
      assert.equal(c2f.vAfter, "", "失焦後殘留變數");
      assert.equal(c2f.kAfter.unsubs, c2f.kAfter.subs, "訂閱未全部退回：" + JSON.stringify(c2f.kAfter));
    });
    const c2l = await closedSwitch("laptop");
    // #H3-3：筆電下緣＝鍵盤上緣（不再取 min(摺痕上緣, 鍵盤上緣)）
    await check(`K12e 合起時聚焦（鍵盤 ${TALL}）→筆電、切換後鍵盤事件重送：面板層下緣＝鍵盤上緣 ${VH - TALL}`, () => {
      console.log(`     （資訊）切換後未重送：var=${JSON.stringify(c2l.vNoEv)}、下緣 ${c2l.gNoEv.layer.b}；重送後：var=${JSON.stringify(c2l.v)}、下緣 ${c2l.g.layer.b}`);
      assert.ok(/\bduo-laptop\b/.test(c2l.g.html), "未切到筆電：" + c2l.g.html);
      near(c2l.g.layer.b, VH - TALL, `面板層下緣（--duo-map-keyboard-top=${JSON.stringify(c2l.v)}）`, 1.01);
      assert.equal(c2l.vAfter, "", "失焦後殘留變數");
    });

    // 一般 iPhone／Duo 合起／雙欄：不訂閱鍵盤、送出鍵盤事件後 html style 與修改前（BEFORE build）相同、沒有 --duo-map-keyboard-top
    const NOKB = [
      { name: "一般 iPhone", env: { vw: 390, vh: 844, safeTop: 47, safeBottom: 34, layout: "bottom", hinge: "none" } },
      { name: "Duo 合起（直欄單頁）", env: { vw: VW, vh: VH, layout: "rail", hinge: "closed" } },
      { name: "Duo 雙欄（書本半開）", env: { vw: 951, vh: 669, layout: "twoPane", hinge: "book" } },
    ];
    const noKbFlow = async (variant, env) => {
      await boot(variant, env);
      const k0 = await kbStats();
      const s0 = await evaluate("document.documentElement.getAttribute('style')");
      await evaluate("window.__focus()");
      await settleKb();
      const kF = await kbStats();
      await kbShow(SHORT);
      await settleKb();
      const sS = await evaluate("document.documentElement.getAttribute('style')");
      const pad = (await st()).map.lastPadding;
      await evaluate("window.__blurWait()");
      await wait(600);
      const sB = await evaluate("document.documentElement.getAttribute('style')");
      const kB = await kbStats();
      return { k0, kF, kB, s0, sS, sB, pad };
    };
    for (const N of NOKB) {
      const cur = await noKbFlow("cur", N.env);
      const before = await noKbFlow("before", N.env);
      await check(`K13 ${N.name}：聚焦＋keyboardHeight ${SHORT} 不訂閱、不寫入 --duo-map-keyboard-top，html style／padding 與修改前相同`, () => {
        assert.deepEqual([cur.kF.subs - cur.k0.subs, cur.kB.subs - cur.k0.subs], [before.kF.subs - before.k0.subs, before.kB.subs - before.k0.subs], "訂閱數與修改前不同");
        assert.deepEqual([cur.kF.subs - cur.k0.subs], [0], "map-search-keyboard 不應訂閱");
        for (const k of ["s0", "sS", "sB"]) {
          assert.doesNotMatch(String(cur[k]), /--duo-map-keyboard-top/, k);
          assert.equal(cur[k], before[k], k + " html style 與修改前不同");
        }
        assert.equal(cur.pad, before.pad, "map padding 與修改前不同");
      });
    }

    // ───────── K15（#H3-2-T3）：html class MutationObserver 的掛載範圍與生命週期 ─────────
    //   prelude 包裝 window.MutationObserver（計數建立／observe html／disconnect／html observer callback）與
    //   html style 的 --duo-map-keyboard-top setProperty／removeProperty。所有情境皆為 StrictMode（entry 預設）。
    const mo = () => evaluate("window.__moStats()");
    const vwr = () => evaluate("window.__varWrites()");
    const probe = () => evaluate("document.documentElement.classList.add('k15-probe');document.documentElement.classList.remove('k15-probe');window.__settle()");
    const dMo = (a, b) => ({ created: b.created - a.created, observe: b.htmlObserve - a.htmlObserve, disconnect: b.htmlDisconnect - a.htmlDisconnect, active: b.htmlActive, cb: b.htmlCb - a.htmlCb });

    // K15a 一般 iPhone／iPad／web：聚焦→鍵盤事件→class 變化→失焦（兩輪）：MutationObserver 建立 0、鍵盤訂閱 0、變數寫入 0
    const NOOBS = [
      { name: "一般 iPhone", env: { vw: 390, vh: 844, safeTop: 47, safeBottom: 34, layout: "bottom", hinge: "none" } },
      { name: "iPad", env: { vw: 820, vh: 1180, safeTop: 24, safeBottom: 20, layout: "bottom", hinge: "none" } },
      { name: "web 桌機", env: { vw: 1280, vh: 800, layout: "bottom", hinge: "none", mobile: false } },
    ];
    for (const N of NOOBS) {
      await boot("cur", N.env);
      const m0 = await mo();
      const k0 = await kbStats();
      const w0 = await vwr();
      const s0 = await evaluate("document.documentElement.getAttribute('style')");
      for (let i = 0; i < 2; i++) {
        await evaluate("window.__focus()");
        await settleKb();
        await kbShow(SHORT);
        await probe();
        await evaluate("window.__blurWait()");
        await wait(300);
      }
      const m1 = await mo();
      const k1 = await kbStats();
      const w1 = await vwr();
      const s1 = await evaluate("document.documentElement.getAttribute('style')");
      const html = await evaluate("document.documentElement.className");
      await check(`K15a ${N.name}：兩輪聚焦／鍵盤事件／class 變化／失焦，MutationObserver 建立次數 0、html observer 0、鍵盤訂閱 0、--duo-map-keyboard-top 寫入 0`, () => {
        console.log(`     （資訊）MO ${JSON.stringify(dMo(m0, m1))}；訂閱 +${k1.subs - k0.subs}；變數 set +${w1.set - w0.set} rm +${w1.rm - w0.rm}；html=${html}`);
        assert.ok(!/\bduo-device\b/.test(html), "不應有 duo-device：" + html);
        assert.equal(m1.created - m0.created, 0, "MutationObserver 建立次數");
        assert.deepEqual([m1.htmlObserve - m0.htmlObserve, m1.htmlActive, m1.htmlCb - m0.htmlCb], [0, 0, 0], "html observer");
        assert.equal(k1.subs - k0.subs, 0, "鍵盤訂閱");
        assert.deepEqual([w1.set - w0.set, w1.rm - w0.rm], [0, 0], "--duo-map-keyboard-top 寫入");
        assert.equal(s1, s0, "html style");
      });
    }

    // K15b Duo 合起／雙欄（書本半開）／雙欄（橫向攤平）：只監看（恰 1 個 html observer、callback 有觸發），不訂閱、不寫入；失焦後 disconnect
    const WATCH = [
      { name: "Duo 合起（直欄單頁）", env: { vw: VW, vh: VH, layout: "rail", hinge: "closed" } },
      { name: "Duo 雙欄（書本半開）", env: { vw: 951, vh: 669, layout: "twoPane", hinge: "book" } },
      { name: "Duo 雙欄（橫向攤平）", env: { vw: 951, vh: 669, layout: "twoPane", hinge: "flatVertical" } },
    ];
    for (const W of WATCH) {
      await boot("cur", W.env);
      const m0 = await mo();
      const k0 = await kbStats();
      const w0 = await vwr();
      const s0 = await evaluate("document.documentElement.getAttribute('style')");
      await evaluate("window.__focus()");
      await settleKb();
      const mF = await mo();
      await kbShow(SHORT);
      await probe();
      await kbShow(TALL);
      await evaluate("window.__kbBridge.hide()");
      await probe();
      const mP = await mo();
      const kP = await kbStats();
      const sP = await evaluate("document.documentElement.getAttribute('style')");
      await evaluate("window.__blurWait()");
      await wait(300);
      const m1 = await mo();
      const k1 = await kbStats();
      const w1 = await vwr();
      const s1 = await evaluate("document.documentElement.getAttribute('style')");
      const html = await evaluate("document.documentElement.className");
      await check(`K15b ${W.name}：聚焦期間只有 1 個 html observer（只監看）、鍵盤訂閱 0、--duo-map-keyboard-top 寫入 0、html style 不變；失焦後 disconnect`, () => {
        console.log(`     （資訊）聚焦 MO ${JSON.stringify(dMo(m0, mF))}；事件後 ${JSON.stringify(dMo(m0, mP))}；失焦後 ${JSON.stringify(dMo(m0, m1))}；訂閱 +${k1.subs - k0.subs}；變數 set +${w1.set - w0.set} rm +${w1.rm - w0.rm}`);
        assert.ok(/\bduo-device\b/.test(html), "應有 duo-device：" + html);
        assert.ok(!/\bduo-laptop\b|\bduo-flat-portrait\b/.test(html), html);
        assert.deepEqual([mF.created - m0.created, mF.htmlObserve - m0.htmlObserve, mF.htmlActive], [1, 1, 1], "聚焦：html observer");
        assert.ok(mP.htmlCb - m0.htmlCb >= 2, "observer callback 未觸發（監看無效）：" + (mP.htmlCb - m0.htmlCb));
        assert.equal(mP.maxActive <= 1, true, "同時存在多個 html observer：" + mP.maxActive);
        assert.deepEqual([kP.subs - k0.subs, kP.active - k0.active], [0, 0], "合起／雙欄不得訂閱鍵盤");
        assert.deepEqual([w1.set - w0.set, w1.rm - w0.rm], [0, 0], "--duo-map-keyboard-top 寫入");
        assert.equal(sP, s0, "聚焦期間 html style");
        assert.equal(s1, s0, "失焦後 html style");
        assert.deepEqual([m1.htmlDisconnect - m0.htmlDisconnect, m1.htmlActive], [1, 0], "失焦：disconnect");
        const cbAfter = m1.htmlCb;
        void cbAfter;
      });
      // 失焦後 class 變化：callback 不得再觸發
      const mA = await mo();
      await probe();
      const mB = await mo();
      await check(`K15b' ${W.name}：失焦後 class 變化不再觸發 observer callback`, () => {
        assert.equal(mB.htmlCb - mA.htmlCb, 0);
      });
    }

    // K15c 生命週期（直向攤平與合起）：失焦／reset／release／卸載後 observer 與訂閱都停止；StrictMode 下無重複、無洩漏
    for (const L of [
      { name: "直向攤平", env: POSTURES[3].env, stacked: true },
      { name: "Duo 合起", env: { vw: VW, vh: VH, layout: "rail", hinge: "closed" }, stacked: false },
    ]) {
      await boot("cur", L.env);
      const m0 = await mo();
      const k0 = await kbStats();
      const cyc = [];
      // 三輪聚焦／失焦
      for (let i = 0; i < 3; i++) {
        await evaluate("window.__focus()");
        await settleKb();
        const a = await mo();
        const ka = await kbStats();
        await kbShow(SHORT);
        await evaluate("window.__blurWait()");
        await wait(300);
        const b = await mo();
        const kb = await kbStats();
        cyc.push({ fActive: a.htmlActive, fKb: ka.active - k0.active, bActive: b.htmlActive, bKb: kb.active - k0.active });
      }
      const m3 = await mo();
      const k3 = await kbStats();
      // reset（聚焦中呼叫 resetMapSearchKeyboardMode，之後才真正失焦）
      await evaluate("window.__focus()");
      await settleKb();
      await kbShow(SHORT);
      await evaluate("window.__mkb.resetMapSearchKeyboardMode()");
      const mR = await mo();
      const kR = await kbStats();
      const vR = await evaluate("window.__kbVar()");
      await kbShow(SHORT);
      await probe();
      const vR2 = await evaluate("window.__kbVar()");
      await evaluate("window.__blurWait()");
      await wait(300);
      const mR2 = await mo();
      const kR2 = await kbStats();
      // release（prepare→聚焦→release）
      await evaluate("window.__mkb.prepareMapPageKeyboard()");
      await evaluate("window.__focus()");
      await settleKb();
      await kbShow(SHORT);
      const vPre = await evaluate("window.__kbVar()");
      await evaluate("window.__mkb.releaseMapPageKeyboard()");
      const mL = await mo();
      const kL = await kbStats();
      const vL = await evaluate("window.__kbVar()");
      await evaluate("window.__blurWait()");
      await wait(300);
      // 卸載（聚焦中卸載整個 App：MapView cleanup → resetMapSearchKeyboardMode）
      await evaluate("window.__focus()");
      await settleKb();
      await kbShow(SHORT);
      const mU0 = await mo();
      await evaluate("window.__unmount()");
      await wait(300);
      const mU = await mo();
      const kU = await kbStats();
      const wU = await vwr();
      await kbShow(TALL);
      await probe();
      const mU2 = await mo();
      const wU2 = await vwr();
      const vU = await evaluate("window.__kbVar()");
      await check(`K15c ${L.name}：三輪聚焦／失焦、reset、release、卸載後 html observer 與鍵盤訂閱皆歸零，無重複 disconnect／退訂、無殘留變數`, () => {
        console.log(`     （資訊）三輪 ${JSON.stringify(cyc)}；MO 累計 ${JSON.stringify(dMo(m0, mU2))} maxActive ${mU2.maxActive}；reset 後 active ${mR.htmlActive}/kb ${kR.active - k0.active}；release 前 var=${JSON.stringify(vPre)} 後 active ${mL.htmlActive}/kb ${kL.active - k0.active}；卸載前 active ${mU0.htmlActive} 後 ${mU.htmlActive}/kb ${kU.active - k0.active}`);
        const kbOn = L.stacked ? 1 : 0;
        assert.deepEqual(cyc, Array.from({ length: 3 }, () => ({ fActive: 1, fKb: kbOn, bActive: 0, bKb: 0 })), "聚焦／失焦週期");
        assert.deepEqual([m3.created - m0.created, m3.htmlObserve - m0.htmlObserve, m3.htmlDisconnect - m0.htmlDisconnect], [3, 3, 3], "三輪各恰 1 個 observer");
        assert.deepEqual([k3.subs - k0.subs, k3.unsubs - k0.unsubs, k3.dupUnsubs], [3 * kbOn, 3 * kbOn, 0], "三輪鍵盤訂閱");
        assert.deepEqual([mR.htmlActive, kR.active - k0.active, vR, vR2], [0, 0, "", ""], "reset 後");
        assert.deepEqual([mR2.htmlActive, kR2.active - k0.active, kR2.dupUnsubs], [0, 0, 0], "reset 後再失焦");
        if (L.stacked) assert.notEqual(vPre, "", "release 前應已寫入變數（證明有訂閱）");
        assert.deepEqual([mL.htmlActive, kL.active - k0.active, vL], [0, 0, ""], "release 後");
        assert.equal(mU0.htmlActive, 1, "卸載前應有 observer");
        assert.deepEqual([mU.htmlActive, kU.active - k0.active, kU.dupUnsubs], [0, 0, 0], "卸載後");
        assert.equal(mU2.htmlCb, mU.htmlCb, "卸載後 class 變化仍觸發 observer");
        assert.deepEqual([wU2.set - wU.set, vU], [0, ""], "卸載後鍵盤事件仍寫入");
        assert.equal(mU2.maxActive, 1, "同時存在多個 html observer");
        assert.equal(mU2.htmlObserve - m0.htmlObserve, mU2.htmlDisconnect - m0.htmlDisconnect, "observe／disconnect 不成對");
        assert.equal(kU.subs - k0.subs, kU.unsubs - k0.unsubs, "訂閱／退訂不成對");
      });
    }

    // K15d duo-device 晚於聚焦設定（hinge 初值未到時聚焦，之後才變成直向攤平）：記錄退回行為
    {
      await boot("cur", { vw: VW, vh: VH, layout: "bottom", hinge: "none" });
      const m0 = await mo();
      const k0 = await kbStats();
      await evaluate("window.__focus()");
      await settleKb();
      const mF = await mo();
      await kbShow(TALL);
      await evaluate(`window.__setPostureAsync("bottom","flatDiv")`);
      await wait(500);
      await evaluate("window.__settle()");
      await kbShow(TALL);
      await settleKb();
      const gLate = await geo();
      const vLate = await evaluate("window.__kbVar()");
      const kLate = await kbStats();
      const mLate = await mo();
      await evaluate("window.__blurWait()");
      await wait(300);
      // 重新聚焦：此時已有 duo-device＋duo-flat-portrait
      await evaluate("window.__focus()");
      await settleKb();
      await kbShow(TALL);
      await settleKb();
      const gRe = await geo();
      const vRe = await evaluate("window.__kbVar()");
      const kRe = await kbStats();
      await evaluate("window.__blurWait()");
      await wait(300);
      const m1 = await mo();
      const k1 = await kbStats();
      const [TOPF] = POSTURES[3].env.fold;
      await check(`K15d duo-device 晚於聚焦：該次聚焦不掛 observer、不訂閱，退回摺痕上緣 ${TOPF}（記錄）；重新聚焦後恢復＝鍵盤上緣 ${VH - TALL}；無洩漏`, () => {
        console.log(`     （資訊）聚焦時 MO +${mF.created - m0.created}；切到直向攤平後 html=${gLate.html.match(/duo-[\w-]+/g)?.join(",")}、var=${JSON.stringify(vLate)}、面板層下緣 ${gLate.layer.b}、訂閱 +${kLate.subs - k0.subs}、observer active ${mLate.htmlActive}；重新聚焦 var=${JSON.stringify(vRe)}、下緣 ${gRe.layer.b}`);
        assert.ok(/\bduo-device\b/.test(gLate.html) && /\bduo-flat-portrait\b/.test(gLate.html), gLate.html);
        assert.equal(mF.created - m0.created, 0, "聚焦時無 duo-device 不應掛 observer");
        assert.deepEqual([vLate, kLate.subs - k0.subs], ["", 0], "該次聚焦不訂閱（退回行為）");
        near(gLate.layer.b, TOPF, "退回：面板層下緣＝摺痕上緣", 1.01);
        assert.equal(vRe, `${VH - TALL}px`);
        near(gRe.layer.b, VH - TALL, "重新聚焦後面板層下緣", 1.01);
        assert.deepEqual([m1.htmlActive, k1.active - k0.active, k1.dupUnsubs], [0, 0, 0], "洩漏");
      });
    }
  }

  // ───────── B0 對照：BEFORE build（HEAD 版 _app.map／map-search-keyboard、移除新 CSS）＋筆電時，K1–K3 主要斷言必須失敗 ─────────
  {
    const env = POSTURES[0].env;
    await boot("before", env);
    const cls = await evaluate("window.__focus()");
    await wait(450);
    const g = await geo();
    await evaluate("window.__blurWait()");
    await wait(300);
    await evaluate("window.__clickCard(1)");
    await wait(400);
    const gd = await geo();
    await boot("before", POSTURES[3].env);
    const gf = await geo();
    // 註：BEFORE CSS 只移除含新 class 的 selector；筆電鍵盤規則是就地改寫（與直向攤平並列），無法還原舊版，故不比對聚焦位置
    //   （舊行為「聚焦時面板留在下半部」由 verify-duo-laptop-chat-explore 舊版 M6 記錄）。
    await check("B0 對照：修改前（BEFORE build）筆電聚焦無 duo-map-kb-anim、詳情不是一頁式、直向攤平沒有上下版型（證明 K2／K3／K1 斷言有效）", () => {
      assert.doesNotMatch(cls, /duo-map-kb-anim/);
      void g;
      assert.ok(!/duo-map-detail-page/.test(gd.html) && gd.layer.t > 1, "修改前詳情不應佔滿整頁：" + gd.layer.t);
      assert.ok(Math.abs(gf.canvas.b - POSTURES[3].env.fold[0]) > 1, "修改前直向攤平地圖不應只佔上半部：" + gf.canvas.b);
    });
  }

  // ───────── F：直向攤平判斷（真實 duo-laptop.ts 純函式）─────────
  {
    await boot("cur", { vw: VW, vh: VH, layout: "bottom", hinge: "none" });
    const cases = await evaluate(`(()=>{const r=window.__resolveFlat;const H=(status,d,sup=true)=>({supported:sup,status,divisions:d});
      const P={width:669,height:951},L={width:951,height:669};const hz={x:0,y:455.5,width:669,height:40,active:true};
      return {
        div:r(H('fullyOpen',[hz]),P), mid:r(H('fullyOpen',[]),P), inactiveOnly:r(H('fullyOpen',[{...hz,active:false}]),P),
        vertical:r(H('fullyOpen',[{x:314.5,y:0,width:40,height:951,active:true}]),P), nearTop:r(H('fullyOpen',[{...hz,y:150}]),P),
        narrow:r(H('fullyOpen',[{...hz,width:300}]),P), outOfView:r(H('fullyOpen',[{...hz,y:940}]),P), nan:r(H('fullyOpen',[{...hz,y:NaN}]),P),
        landscape:r(H('fullyOpen',[]),L), square:r(H('fullyOpen',[]),{width:700,height:700}), partially:r(H('partiallyOpen',[hz]),P), closed:r(H('closed',[]),P),
        unsupported:r(H('fullyOpen',[],false),P), unknown:r(H('unknown',[]),P), tiny:r(H('fullyOpen',[]),{width:300,height:390}), badVp:r(H('fullyOpen',[]),{width:NaN,height:951}),
        noDivArr:r({supported:true,status:'fullyOpen'},P), mixed:r(H('fullyOpen',[{...hz,y:150},hz]),P), nullH:r(null,P),
        lapOfFlat:window.__resolveLaptop(H('fullyOpen',[hz]),P), lapOfLap:window.__resolveLaptop(H('partiallyOpen',[hz]),P)};})()`);
    await check("F1 resolveDuoFlatPortrait：fullyOpen＋直向＋合格橫向 division→用 division；無 division→中線；有不合格 active division→非直向攤平；其他非法輸入→非直向攤平", () => {
      assert.deepEqual(cases.div, { flat: true, foldTop: 455.5, foldBottom: 495.5 });
      assert.deepEqual(cases.mid, { flat: true, foldTop: 475.5, foldBottom: 475.5 });
      assert.deepEqual(cases.inactiveOnly, { flat: true, foldTop: 475.5, foldBottom: 475.5 }, "只有 inactive division 視為沒有 division");
      for (const k of ["vertical", "nearTop", "narrow", "outOfView", "nan", "landscape", "square", "partially", "closed", "unsupported", "unknown", "tiny", "badVp", "noDivArr", "nullH"])
        assert.deepEqual(cases[k], { flat: false }, k);
      assert.deepEqual(cases.mixed, { flat: true, foldTop: 455.5, foldBottom: 495.5 }, "多個 division 時取第一個合格的");
      assert.deepEqual(cases.lapOfFlat, { laptop: false }, "fullyOpen 不是筆電");
      assert.deepEqual(cases.lapOfLap, { laptop: true, foldTop: 455.5, foldBottom: 495.5 });
    });
  }
  // ───────── S：_app 優先序（真實 AppLayout＋真實 use-duo-laptop；hinge／duo-layout 可控）─────────
  {
    const html = async (env) => {
      await boot("cur", { ...env, noCards: true });
      return evaluate("({c:document.documentElement.className,t:document.documentElement.style.getPropertyValue('--duo-hinge-top'),b:document.documentElement.style.getPropertyValue('--duo-hinge-bottom')})");
    };
    const r = {
      lap: await html({ vw: VW, vh: VH, layout: "bottom", hinge: "laptop" }),
      flatDiv: await html({ vw: VW, vh: VH, layout: "bottom", hinge: "flatDiv" }),
      flatMid: await html({ vw: VW, vh: VH, layout: "rail", hinge: "flatMid" }),
      flatVertical: await html({ vw: VW, vh: VH, layout: "bottom", hinge: "flatVertical" }),
      twoPaneFlat: await html({ vw: VW, vh: VH, layout: "twoPane", hinge: "flatDiv" }),
      twoPaneLap: await html({ vw: VW, vh: VH, layout: "twoPane", hinge: "laptop" }),
      landscapeFlat: await html({ vw: 951, vh: 669, layout: "twoPane", hinge: "flatMid" }),
      landscapeFlatSingle: await html({ vw: 951, vh: 669, layout: "rail", hinge: "flatMid" }),
      closed: await html({ vw: VW, vh: VH, layout: "rail", hinge: "closed" }),
      phone: await html({ vw: 390, vh: 844, layout: "bottom", hinge: "none" }),
    };
    const has = (x, c) => x.c.split(/\s+/).includes(c);
    await check("S1 _app 優先序：雙欄 > 筆電 > 直向攤平；--duo-hinge-* 只在筆電／直向攤平時設定", () => {
      assert.ok(has(r.lap, "duo-laptop") && !has(r.lap, "duo-flat-portrait"), JSON.stringify(r.lap));
      assert.deepEqual([r.lap.t, r.lap.b], ["455.5px", "495.5px"]);
      assert.ok(has(r.flatDiv, "duo-flat-portrait") && !has(r.flatDiv, "duo-laptop"), JSON.stringify(r.flatDiv));
      assert.deepEqual([r.flatDiv.t, r.flatDiv.b], ["455.5px", "495.5px"]);
      assert.ok(has(r.flatMid, "duo-flat-portrait"), JSON.stringify(r.flatMid));
      assert.deepEqual([r.flatMid.t, r.flatMid.b], ["475.5px", "475.5px"], "無 division→中線");
      for (const k of ["flatVertical", "twoPaneFlat", "twoPaneLap", "landscapeFlat", "landscapeFlatSingle", "closed", "phone"]) {
        assert.ok(!has(r[k], "duo-flat-portrait") && !has(r[k], "duo-laptop"), k + "：" + r[k].c);
        assert.deepEqual([r[k].t, r[k].b], ["", ""], k + " 不應設定 --duo-hinge-*");
      }
      assert.ok(has(r.twoPaneFlat, "duo-two-pane") && has(r.twoPaneLap, "duo-two-pane") && has(r.landscapeFlat, "duo-two-pane"), "雙欄優先");
      assert.ok(!/duo-device/.test(r.phone.c), "一般 iPhone 不應有 duo-device");
    });
    // 穩定化 150ms（真實計時）：筆電→直向攤平；抖動
    await boot("cur", { vw: VW, vh: VH, layout: "bottom", hinge: "laptop", noCards: true });
    const tr = await evaluate(`(async()=>{const h=document.documentElement;const t0=performance.now();window.__setPosture('bottom','flatDiv');const out=[];
      while(performance.now()-t0<400){await new Promise(r=>requestAnimationFrame(r));out.push({t:performance.now()-t0,lap:h.classList.contains('duo-laptop'),flat:h.classList.contains('duo-flat-portrait')});}return out;})()`);
    const flap = await evaluate(`(async()=>{const h=document.documentElement;const w=ms=>new Promise(r=>setTimeout(r,ms));window.__setPosture('bottom','laptop');await w(400);
      const t0=performance.now();window.__setPosture('bottom','flatDiv');await w(100);window.__setPosture('bottom','laptop');await w(100);window.__setPosture('bottom','flatDiv');const t2=performance.now()-t0;
      const out=[];while(performance.now()-t0<700){await new Promise(r=>requestAnimationFrame(r));out.push({t:performance.now()-t0,lap:h.classList.contains('duo-laptop'),flat:h.classList.contains('duo-flat-portrait')});}return {t2,out};})()`);
    await check("S2 穩定化：筆電→直向攤平需穩定 150ms 才切換、不會同時有兩個 class；抖動期間不切換，最後一次變化後 150ms 才切換", () => {
      const firstFlat = tr.find((f) => f.flat);
      assert.ok(firstFlat && firstFlat.t >= 145 && firstFlat.t <= 260, "切換時間 " + firstFlat?.t);
      assert.ok(tr.filter((f) => f.t < 140).every((f) => f.lap && !f.flat), "150ms 內提前切換");
      assert.ok(tr.every((f) => !(f.lap && f.flat)), "同時有 duo-laptop 與 duo-flat-portrait");
      assert.ok(tr[tr.length - 1].flat && !tr[tr.length - 1].lap);
      const ff = flap.out.find((f) => f.flat);
      assert.ok(flap.out.filter((f) => f.t < flap.t2 + 140).every((f) => f.lap && !f.flat), "抖動期間切換了");
      assert.ok(ff && ff.t >= flap.t2 + 145, `最後一次變化 ${flap.t2}ms，切換於 ${ff?.t}ms`);
    });
  }

  // ───────── K10（#H3-1-T2）：K5 的 document.getAnimations().cancel() 範圍 ─────────
  //   進入詳情（真實 MapView、flushSync click → useLayoutEffect）當下，在下列元素上各有一個 1.5s transition 執行中：
  //   範圍外（不得被取消）：body 下的 toast 替身、底部導覽、地圖畫布；範圍內對照（應被取消）：面板層 .map-sheet-layer。
  //   一般 iPhone：進入詳情時面板 inline height transition（拖曳／snap 同一條 SPRING_TRANSITION）必須照常執行，且與修改前相同。
  {
    const probe = `(async()=>{const h=document.documentElement;const q=s=>document.querySelector(s);
      const mk=document.createElement('div');mk.id='__k9toast';mk.style.cssText='position:fixed;left:0;top:0;width:10px;height:10px;opacity:0.2;transition:opacity 1.5s linear';document.body.appendChild(mk);
      const els={toast:mk,nav:q('nav'),canvas:q('.map-page .map-stage-canvas'),layer:q('.map-page > .map-sheet-layer')};
      for(const k of Object.keys(els)){if(!els[k])return {missing:k};if(k!=='toast')els[k].style.transition='opacity 1.5s linear';}
      await window.__raf();for(const e of Object.values(els))e.style.opacity=e===mk?'1':'0.98';await window.__raf();
      const st=()=>{const o={};for(const [k,e] of Object.entries(els))o[k]=document.getAnimations().filter(a=>a.effect&&a.effect.target===e).map(a=>a.playState).join(',')||'none';return o;};
      const before=st();
      window.__clickCard(1);
      const after=st();
      const sheet=q('.map-page [data-map-explore-sheet]');
      const sheetAnims=document.getAnimations().filter(a=>a.effect&&a.effect.target===sheet).map(a=>a.transitionProperty+':'+a.playState);
      await window.__raf();
      const later=st();
      for(const e of Object.values(els)){e.style.transition='';e.style.opacity='';}mk.remove();
      return {detail:h.classList.contains('duo-map-detail-page'),before,after,later,sheetAnims};})()`;
    const run = async (variant, env) => {
      await boot(variant, env);
      await evaluate("window.__fetchResponder=window.__fakeGoogle;true");
      await wait(1000);
      await evaluate("window.__settle()");
      return evaluate(probe);
    };
    const lap = await run("cur", { vw: VW, vh: VH, layout: "bottom", hinge: "laptop" });
    const flat = await run("cur", { vw: VW, vh: VH, layout: "bottom", hinge: "flatDiv" });
    await check("K10 K5 取消範圍（筆電／直向攤平）：進入詳情時只取消面板層／搜尋列的 transition，toast、底部導覽、地圖畫布上的 transition 照常執行", () => {
      for (const [name, r] of [["筆電", lap], ["直向攤平", flat]]) {
        assert.ok(!r.missing, name + " 找不到元素：" + r.missing);
        assert.equal(r.detail, true, name + " 未進入詳情一頁式");
        assert.deepEqual(r.before, { toast: "running", nav: "running", canvas: "running", layer: "running" }, name + " 前置 transition 未啟動：" + JSON.stringify(r.before));
        assert.deepEqual({ toast: r.after.toast, nav: r.after.nav, canvas: r.after.canvas }, { toast: "running", nav: "running", canvas: "running" }, name + " 範圍外 transition 被取消：" + JSON.stringify(r.after));
        assert.deepEqual({ toast: r.later.toast, nav: r.later.nav, canvas: r.later.canvas }, { toast: "running", nav: "running", canvas: "running" }, name + " 下一幀範圍外 transition 不在執行：" + JSON.stringify(r.later));
        assert.equal(r.after.layer, "none", name + " 對照：面板層 transition 應被取消（證明 probe 有效）：" + JSON.stringify(r.after));
      }
    });
    const phoneEnv = { vw: 390, vh: 844, safeTop: 47, safeBottom: 34, layout: "bottom", hinge: "none" };
    const phoneCur = await run("cur", phoneEnv);
    const phoneBefore = await run("before", phoneEnv);
    await check("K10b 一般 iPhone：進入詳情時面板 height snap transition 照常執行、範圍外 transition 不受影響，與修改前相同", () => {
      assert.equal(phoneCur.detail, false, "一般 iPhone 不應加 duo-map-detail-page");
      assert.ok(phoneCur.sheetAnims.some((a) => a === "height:running"), "面板 height transition 未執行：" + JSON.stringify(phoneCur.sheetAnims));
      assert.deepEqual(phoneCur.sheetAnims, phoneBefore.sheetAnims, "面板動畫與修改前不同");
      assert.deepEqual(phoneCur.after, phoneBefore.after, "transition 狀態與修改前不同");
      assert.deepEqual(phoneCur.after, { toast: "running", nav: "running", canvas: "running", layer: "running" }, JSON.stringify(phoneCur.after));
    });
  }

  // ───────── N：非 Duo 與其他姿勢：與修改前（BEFORE build）完全相同 ─────────
  const NON = [
    { name: "一般 iPhone", env: { vw: 390, vh: 844, safeTop: 47, safeBottom: 34, layout: "bottom", hinge: "none" } },
    { name: "Duo 合起（直欄單頁）", env: { vw: VW, vh: VH, layout: "rail", hinge: "closed" } },
    { name: "Duo 雙欄（書本半開）", env: { vw: 951, vh: 669, layout: "twoPane", hinge: "book" } },
    { name: "Duo 雙欄（橫向攤平）", env: { vw: 951, vh: 669, layout: "twoPane", hinge: "flatVertical" } },
    { name: "iPad", env: { vw: 820, vh: 1180, safeTop: 24, safeBottom: 20, layout: "bottom", hinge: "none" } },
    { name: "web 桌機", env: { vw: 1280, vh: 800, layout: "bottom", hinge: "none", mobile: false } },
  ];
  const flow = async (variant, env) => {
    await boot(variant, env);
    await evaluate("window.__fetchResponder=window.__fakeGoogle;true");
    const snaps = {};
    const anims = [];
    await wait(1000); // 面板 inline height transition（0.48s）結束
    await evaluate("window.__settle()");
    snaps.boot = await evaluate("window.__snapshot()");
    await evaluate("window.__focus()");
    anims.push(...(await evaluate("window.__sample(450)")).filter((f) => f.anim));
    await wait(300);
    await evaluate("window.__settle()");
    snaps.focus = await evaluate("window.__snapshot()");
    await evaluate("window.__type('咖啡')");
    for (let i = 0; i < 40; i++) {
      if ((await evaluate("document.querySelectorAll('.map-page .z-10 li').length")) >= 20) break;
      await wait(100);
    }
    await wait(300);
    await evaluate("window.__settle()");
    snaps.typed = await evaluate("window.__snapshot()");
    await evaluate("window.__type('')");
    await evaluate("window.__blurWait()");
    anims.push(...(await evaluate("window.__sample(450)")).filter((f) => f.anim));
    await wait(1200);
    await evaluate("window.__settle()");
    snaps.blur = await evaluate("window.__snapshot()");
    await evaluate("window.__clickCard(1)");
    await wait(700);
    await evaluate("window.__settle()");
    snaps.detail = await evaluate("window.__snapshot()");
    await evaluate("window.__clickBack()");
    await wait(700);
    await evaluate("window.__settle()");
    snaps.back = await evaluate("window.__snapshot()");
    return { snaps, anims };
  };
  for (const N of NON) {
    const cur = await flow("cur", N.env);
    const before = await flow("before", N.env);
    await check(`N ${N.name}：開機／聚焦／輸入／收起／詳情／返回 六個時點的 DOM、幾何、computed style、html class、map padding 與修改前完全相同；無 duo-map-kb-anim`, () => {
      assert.deepEqual(cur.anims, [], "出現 duo-map-kb-anim");
      for (const k of Object.keys(cur.snaps)) {
        const a = cur.snaps[k];
        const b = before.snaps[k];
        assert.equal(a.html, b.html, k + " html class");
        assert.equal(a.htmlStyle, b.htmlStyle, k + " html style");
        assert.equal(a.padding, b.padding, k + " map padding");
        assert.ok(a.domHash === b.domHash, k + " DOM 不同");
        assert.equal(a.els.length, b.els.length, k + " 元素數");
        const diff = a.els.map((x, i) => [x, b.els[i]]).filter(([x, y]) => x !== y);
        assert.deepEqual(diff.slice(0, 2), [], k + " 幾何／樣式不同（共 " + diff.length + "）");
        assert.ok(!/duo-map-kb-anim|duo-map-detail-page|duo-flat-portrait/.test(a.html), k + "：" + a.html);
      }
      console.log(`     （資訊）元素數：${Object.entries(cur.snaps).map(([k, v]) => k + " " + v.els.length).join("、")}`);
    });
  }

  // ───────── L1G（#L1-T2）：真實 MapView 詳情「聊這個地點」（openInChat）在行程生成鎖住時不帶入聊聊；未鎖對照照常帶入 ─────────
  {
    const k11 = async (locked) => {
      await boot("cur", { vw: 402, vh: 874, safeTop: 0, safeBottom: 0, layout: "bottom", hinge: "none" });
      await evaluate("localStorage.setItem('roamie-auth',JSON.stringify({user:{id:'u1'}}));true");
      if (locked) await evaluate("window.__lockGen('k11')");
      await evaluate("window.__clickCard(1)");
      await wait(700);
      await evaluate("window.__settle()");
      const label = await evaluate("window.__tr('zh-TW','uiCoverage.chatPlace')");
      const notice = await evaluate("window.__tr('zh-TW','uiCoverage.chatGenerationLockedNotice')");
      const s0 = await evaluate("sessionStorage.getItem('roamie:chat-planning')");
      const n0 = await evaluate("(window.__nav||[]).length");
      const t0 = await evaluate("window.__toastLog.length");
      const c0 = await counts();
      const clicked = await evaluate(`window.__clickText(${JSON.stringify(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))})`);
      await wait(300);
      await evaluate("window.__settle()");
      const out = {
        clicked,
        sessionChanged: (await evaluate("sessionStorage.getItem('roamie:chat-planning')")) !== s0,
        chatNavs: (await evaluate("(window.__nav||[]).slice(" + n0 + ")")).filter((n) => n && n.to === "/chat"),
        notices: (await evaluate("window.__toastLog.slice(" + t0 + ")")).filter((m) => m === notice).length,
        d: delta(c0, await counts()),
        buttons: clicked ? null : await evaluate("window.__buttons()"),
      };
      if (locked) await evaluate("window.__unlockGen('k11')");
      await evaluate("localStorage.removeItem('roamie-auth');true");
      return out;
    };
    const ctrl = await k11(false);
    const lk = await k11(true);
    console.log("     （資訊）L1G 未鎖：" + JSON.stringify(ctrl) + "｜鎖住：" + JSON.stringify(lk));
    await check("L1Gc 對照（未鎖）：地圖詳情「聊這個地點」寫入聊聊 Session 並導向 /chat（from=map）、無鎖定提示", () => {
      assert.ok(ctrl.clicked, "找不到按鈕：" + JSON.stringify(ctrl.buttons));
      assert.ok(ctrl.sessionChanged, "未寫入聊聊 Session（對照無效）");
      assert.equal(ctrl.chatNavs.length, 1, JSON.stringify(ctrl.chatNavs));
      assert.equal(ctrl.notices, 0);
    });
    await check("L1G [#L1 1][2] 行程生成鎖住時：地圖詳情「聊這個地點」不寫入聊聊 Session、不導向 /chat、無請求，並顯示鎖定提示恰 1 次", () => {
      assert.ok(lk.clicked, "找不到按鈕：" + JSON.stringify(lk.buttons));
      assert.equal(lk.sessionChanged, false, "鎖住時寫入了聊聊 Session");
      assert.deepEqual(lk.chatNavs, [], "鎖住時導向了 /chat");
      assert.deepEqual({ server: lk.d.server, net: lk.d.net }, { server: 0, net: 0 }, "鎖住時送出請求：" + JSON.stringify(lk.d.names));
      assert.equal(lk.notices, 1, "鎖定提示次數");
    });
  }

  // ───────── K16（#H3-3-T）：真實 _app（StrictMode）姿勢互換：class 與 --duo-hinge-* 同批次切換、過渡不退回手機版型、雙欄立即移除 ─────────
  {
    const HD = { x: 0, y: 455.5, width: VW, height: 40, active: true };
    const UNKNOWN = { supported: true, status: "unknown", divisions: [HD] };
    const CONTRA = { supported: true, status: "partiallyOpen", divisions: [{ x: VW / 2 - 20, y: 0, width: 40, height: VH, active: true }] };
    const GONE = { supported: true, status: "partiallyOpen", divisions: [] };
    const VARS = { lap: ["455.5px", "495.5px"], flat: ["475.5px", "475.5px"] };
    const stackedOk = (s) => s.lap !== s.flat && (s.lap ? s.top === VARS.lap[0] && s.bot === VARS.lap[1] : s.top === VARS.flat[0] && s.bot === VARS.flat[1]);
    const fmt = (s) => (s.lap ? "L" : "") + (s.flat ? "F" : "") + (!s.lap && !s.flat ? "N" : "") + `(${s.top || "-"}/${s.bot || "-"})@${s.t}`;
    for (const layout of ["bottom", "rail"]) {
      await boot("cur", { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout, hinge: "laptop", fold: [455.5, 495.5] });
      const rec = await evaluate(`window.__postureRun(${JSON.stringify([
        { label: "unknown", hinge: UNKNOWN, wait: 40 },
        { label: "矛盾", hinge: CONTRA, wait: 40 },
        { label: "division 消失", hinge: GONE, wait: 40 },
        { label: "→直向攤平", hinge: "flatMid", wait: 450 },
        { label: "unknown", hinge: UNKNOWN, wait: 40 },
        { label: "矛盾", hinge: CONTRA, wait: 40 },
        { label: "→筆電", hinge: "laptop", wait: 450 },
      ])})`);
      await check(`K16a ${layout}：筆電→不確定×3→直向攤平→不確定×2→筆電：每個 mutation 批次與每一幀恰有一個上下 class 且 --duo-hinge-* 與 class 一致（無 none、無並存）`, () => {
        const badB = rec.batches.filter((b) => !stackedOk(b));
        const badF = rec.frames.filter((f) => !stackedOk(f));
        console.log(`     （資訊）批次 ${rec.batches.length}：${rec.batches.map((b) => fmt(b) + `[c${b.cls}s${b.sty}]`).join(" ")}；幀 ${rec.frames.length}`);
        assert.ok(rec.frames.length >= 30, "幀數過少：" + rec.frames.length);
        assert.deepEqual(badB.map(fmt), [], "有批次退回手機版型／並存／變數不一致");
        assert.deepEqual(badF.slice(0, 5).map(fmt), [], "有幀退回手機版型／並存／變數不一致（共 " + badF.length + "）");
      });
      await check(`K16b ${layout}：切換批次同時含 class 與 style 變更；明確狀態後 ≥150ms 才切換；不確定期間不切換；最終為筆電`, () => {
        const ev = rec.events;
        const first = rec.batches.find((b) => b.flat);
        const back = first && rec.batches.find((b) => b.lap && b.t > first.t);
        assert.ok(first && back, "沒有切換：" + rec.batches.map(fmt).join(" "));
        assert.equal(rec.batches.filter((b, i) => i === 0 ? b.flat : b.flat !== rec.batches[i - 1].flat).length, 2, "class 切換次數應恰 2 次");
        for (const b of [first, back]) assert.ok(b.cls > 0 && b.sty > 0, "切換批次未同時含 class 與 style：" + JSON.stringify(b));
        const dFlat = first.t - ev[3].t;
        const dLap = back.t - ev[6].t;
        assert.ok(dFlat >= 145 && dFlat < 400, `直向攤平於明確事件後 ${dFlat}ms 切換`);
        assert.ok(dLap >= 145 && dLap < 400, `筆電於明確事件後 ${dLap}ms 切換`);
        for (const i of [0, 1, 2]) assert.ok(ev[i].after.lap && !ev[i].after.flat, `不確定事件 ${ev[i].label} 後應維持筆電`);
        for (const i of [4, 5]) assert.ok(ev[i].after.flat && !ev[i].after.lap, `不確定事件 ${ev[i].label} 後應維持直向攤平`);
        assert.ok(rec.final.lap && !rec.final.flat && rec.final.top === "455.5px");
        console.log(`     （資訊）切換延遲：→直向攤平 ${dFlat.toFixed(1)}ms、→筆電 ${dLap.toFixed(1)}ms`);
      });
    }
    // 雙欄優先：筆電／直向攤平 → 雙欄（書本 hinge 在直向 viewport＝不確定，store 仍為上下）時，同一次 flushSync 內立即移除
    for (const from of ["laptop", "flatMid"]) {
      await boot("cur", { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "rail", hinge: from, fold: [455.5, 495.5] });
      const rec = await evaluate(`window.__postureRun(${JSON.stringify([{ label: "雙欄", layout: "twoPane", hinge: "book", wait: 400 }])})`);
      await check(`K16c ${from}→雙欄：同一次 commit 立即移除 duo-laptop／duo-flat-portrait 與 --duo-hinge-*（不等 150ms），之後不再出現`, () => {
        const a = rec.events[0].after;
        console.log(`     （資訊）事件後 ${fmt(a)} two=${a.two}；批次 ${rec.batches.map((b) => fmt(b) + (b.two ? "+2P" : "")).join(" ")}`);
        assert.deepEqual([a.lap, a.flat, a.top, a.bot, a.two], [false, false, "", "", true], "flushSync 後立即狀態");
        assert.deepEqual(rec.frames.filter((f) => f.lap || f.flat || f.top).map(fmt), [], "雙欄後仍有幀帶上下 class／變數");
        assert.ok(!rec.final.lap && !rec.final.flat && rec.final.two);
      });
    }
    // 筆電 → 合起：明確 none，150ms 後一次移除 class 與變數
    await boot("cur", { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "rail", hinge: "laptop", fold: [455.5, 495.5] });
    const rc = await evaluate(`window.__postureRun(${JSON.stringify([{ label: "合起", hinge: "closed", wait: 450 }])})`);
    await check("K16d 筆電→合起：≥150ms 後同一批次移除 duo-laptop 與 --duo-hinge-*，中間無半套狀態", () => {
      const sw = rc.batches.find((b) => !b.lap);
      assert.ok(sw, "未離開筆電");
      const d = sw.t - rc.events[0].t;
      console.log(`     （資訊）合起後 ${d.toFixed(1)}ms 移除；批次 ${rc.batches.map(fmt).join(" ")}`);
      assert.ok(rc.events[0].after.lap, "合起當下不得立即移除");
      assert.ok(d >= 145 && d < 400, "延遲 " + d);
      assert.deepEqual([sw.lap, sw.flat, sw.top, sw.bot], [false, false, "", ""]);
      assert.deepEqual(rc.frames.filter((f) => f.lap !== !!f.top).map(fmt), [], "class 與變數不同步的幀");
    });

    // #H3-3-T2 K16e：旋轉抖動（明確 100ms／矛盾 40–60ms 反覆 12 輪，約 1.8 秒）：期間每一批次、每一幀都維持起始上下版型，不得閃出 none
    for (const [from, to, toCls] of [["flatMid", "laptop", "lap"], ["laptop", "flatMid", "flat"]]) {
      await boot("cur", { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout: "bottom", hinge: from, fold: [455.5, 495.5] });
      const steps = [];
      for (let i = 0; i < 12; i++) {
        steps.push({ label: "明確", hinge: to, wait: 100 });
        steps.push({ label: "矛盾", hinge: [CONTRA, UNKNOWN, GONE][i % 3], wait: 40 + ((i * 7) % 21) });
      }
      steps.push({ label: "穩定", hinge: to, wait: 450 });
      const rj = await evaluate(`window.__postureRun(${JSON.stringify(steps)})`);
      await check(`K16e ${from}→${to} 旋轉抖動（明確 100ms／矛盾 40–60ms ×12）：抖動期間不切換、每一批次／幀皆無 none、--duo-hinge-* 與 class 一致；穩定後切到 ${to}`, () => {
        const settleT = rj.events[rj.events.length - 1].t;
        const during = rj.frames.filter((f) => f.t < settleT);
        const fromCls = toCls === "lap" ? "flat" : "lap";
        console.log(`     （資訊）抖動期幀 ${during.length}、批次 ${rj.batches.map(fmt).join(" ")}`);
        assert.ok(during.length >= 40, "幀數過少：" + during.length);
        assert.deepEqual(rj.batches.filter((b) => !stackedOk(b)).map(fmt), [], "有批次退回 none／並存／變數不一致");
        assert.deepEqual(rj.frames.filter((f) => !stackedOk(f)).slice(0, 5).map(fmt), [], "有幀退回 none／並存／變數不一致");
        assert.deepEqual(during.filter((f) => !f[fromCls]).slice(0, 3).map(fmt), [], "抖動期間已切換");
        assert.ok(rj.events.slice(0, -1).every((e) => e.after[fromCls]), "抖動事件後應維持起始版型");
        assert.ok(rj.final[toCls] && stackedOk(rj.final), "穩定後未切換：" + fmt(rj.final));
      });
    }

    // #H3-3-T2 K16f：筆電 → closed(t=0) → unknown(t≈50) 之後不再送明確狀態：約 1 秒（fallback 1000ms，自進入不確定起算）內回到 none，
    //   class 與 --duo-hinge-* 同一批次移除，之前每一幀維持完整筆電狀態
    for (const layout of ["bottom", "rail"]) {
      await boot("cur", { vw: VW, vh: VH, safeTop: 0, safeBottom: 0, layout, hinge: "laptop", fold: [455.5, 495.5] });
      const rf = await evaluate(`window.__postureRun(${JSON.stringify([
        { label: "合起", hinge: "closed", wait: 50 },
        { label: "unknown", hinge: { supported: true, status: "unknown", divisions: [] }, wait: 1400 },
      ])})`);
      await check(`K16f ${layout} 筆電→closed→unknown(50ms) 持續：約 1 秒內回到 none（同一批次移除 duo-laptop 與 --duo-hinge-*），之前維持完整筆電`, () => {
        const tUnknown = rf.events[1].t;
        const sw = rf.batches.find((b) => !b.lap);
        console.log(`     （資訊）unknown 後 ${sw ? (sw.t - tUnknown).toFixed(1) : "-"}ms 回到 none（合起後 ${sw ? (sw.t - rf.events[0].t).toFixed(1) : "-"}ms）；批次 ${rf.batches.map(fmt).join(" ")}`);
        assert.ok(sw, "1.4 秒內未回到 none：" + fmt(rf.final));
        const d = sw.t - tUnknown;
        assert.ok(d >= 990 && d < 1300, `回到 none 的時間 ${d}ms（應為進入不確定後約 1000ms）`);
        assert.deepEqual([sw.lap, sw.flat, sw.top, sw.bot], [false, false, "", ""], "切換批次為半套狀態");
        assert.ok(sw.cls > 0 && sw.sty > 0, "class 與 style 不在同一批次：" + JSON.stringify(sw));
        assert.deepEqual(rf.frames.filter((f) => f.t < sw.t && !(f.lap && f.top === VARS.lap[0] && f.bot === VARS.lap[1])).slice(0, 3).map(fmt), [], "回到 none 前有幀不是完整筆電");
        assert.deepEqual(rf.frames.filter((f) => f.t > sw.t + 1 && (f.lap || f.flat || f.top || f.bot)).slice(0, 3).map(fmt), [], "回到 none 後又出現上下版型／變數");
        assert.deepEqual([rf.final.lap, rf.final.flat, rf.final.top, rf.final.bot], [false, false, "", ""]);
      });
    }
  }

  await check("K9 無外部請求、無瀏覽器例外／console.error", () => {
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(browserErrors.filter((e) => !/stub-offline|Failed to fetch \(stub\)/.test(e)).slice(0, 5), []);
  });
}

/*__ENTRY__
import React,{StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Route as AppRoute} from '@/routes/_app';
import {Route as MapRoute} from '@/routes/_app.map';
import {__setDuoLayout} from '@/hooks/use-duo-layout';
import {__setHinge,__hingeSubCount} from '@/lib/layout/duo-hinge';
import {resolveDuoFlatPortrait,resolveDuoLaptop} from '@/lib/layout/duo-laptop';
import * as __mkb from '@/lib/map-search-keyboard';
// #L1-T2：行程生成全域鎖（L1G 地圖「聊這個地點」入口）。toast.message 記錄器只附加記錄、照常呼叫原函式。
import {beginChatGenerationLock,endChatGenerationLock} from '@/lib/ai/chat-generation-lock';
import {toast as __toast} from 'sonner';
import {translate as __tr} from '@/lib/i18n/translate';
window.__lockGen=(o)=>{beginChatGenerationLock(o);return true;};window.__unlockGen=(o)=>{endChatGenerationLock(o);return true;};
window.__tr=__tr;window.__toastLog=[];{const m=__toast.message;__toast.message=(...a)=>{window.__toastLog.push(String(a[0]));return m.apply(__toast,a);};}
window.__resolveFlat=resolveDuoFlatPortrait;window.__resolveLaptop=resolveDuoLaptop;
window.__mkb=__mkb;
window.__hingeSubCount=__hingeSubCount;
const env=JSON.parse(decodeURIComponent(location.hash.slice(1)||'{}'));
const h=document.documentElement;
h.classList.add('native-shell');
h.style.setProperty('--safe-area-top',(env.safeTop||0)+'px');
h.style.setProperty('--safe-area-bottom',(env.safeBottom||0)+'px');
h.style.setProperty('--safe-area-left','0px');h.style.setProperty('--safe-area-right','0px');
const LAYOUTS={
 bottom:{navPlacement:'bottom',tripLayout:'single',usableWidth:env.vw||669},
 rail:{navPlacement:'right-rail',tripLayout:'single',usableWidth:(env.vw||669)-64},
 twoPane:{navPlacement:'right-rail',tripLayout:'two-pane',usableWidth:(env.vw||1300)-64,pane:{leftWidth:(env.vw||1300)/2-12,rightWidth:(env.vw||1300)-64-((env.vw||1300)/2-12)-24,gutter:24,foldX:(env.vw||1300)/2}},
};
const HINGES={
 none:null,
 laptop:(vw,vh,f)=>({supported:true,status:'partiallyOpen',divisions:[{x:0,y:f[0],width:vw,height:f[1]-f[0],active:true}]}),
 flatDiv:(vw,vh,f)=>({supported:true,status:'fullyOpen',divisions:[{x:0,y:f[0],width:vw,height:f[1]-f[0],active:true}]}),
 flatMid:()=>({supported:true,status:'fullyOpen',divisions:[]}),
 flatVertical:(vw,vh)=>({supported:true,status:'fullyOpen',divisions:[{x:vw/2-20,y:0,width:40,height:vh,active:true}]}),
 closed:()=>({supported:true,status:'closed',divisions:[]}),
 book:(vw,vh)=>({supported:true,status:'partiallyOpen',divisions:[{x:vw/2-12,y:0,width:24,height:vh,active:true}]}),
};
window.__FOLD=env.fold||[455.5,495.5];
window.__setPosture=(layout,hinge,fold)=>{if(fold)window.__FOLD=fold;const f=window.__FOLD;const hf=HINGES[hinge];
 flushSync(()=>{__setDuoLayout(LAYOUTS[layout]);__setHinge(hf?hf(innerWidth,innerHeight,f):null);});};
window.__setPosture(env.layout||'bottom',env.hinge||'none');
window.__outlet=MapRoute.options.component;
const App=AppRoute.options.component;
const rootEl=createRoot(document.getElementById('root'));
flushSync(()=>rootEl.render(env.noStrict?<App/>:<StrictMode><App/></StrictMode>));
window.__unmount=()=>{flushSync(()=>rootEl.unmount());return true;};
const q=s=>document.querySelector(s);const qa=s=>[...document.querySelectorAll(s)];
const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:+b.left.toFixed(2),r:+b.right.toFixed(2),t:+b.top.toFixed(2),b:+b.bottom.toFixed(2),w:+b.width.toFixed(2),h:+b.height.toFixed(2)};};
window.__raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
window.__settle=async()=>{for(let i=0;i<3;i++){await window.__raf();await new Promise(r=>setTimeout(r,60));}};
window.__els=()=>{const page=q('.map-page');const stage=page&&page.querySelector(':scope > .map-stage');const ov=stage&&stage.querySelector(':scope > .z-10');const outer=ov&&ov.firstElementChild;
 return {page,stage,ov,outer,row:outer&&outer.firstElementChild,form:outer&&outer.querySelector('form'),input:outer&&outer.querySelector('input'),results:outer&&outer.children[1]||null,
  layer:page&&page.querySelector(':scope > .map-sheet-layer'),sheet:page&&page.querySelector('[data-map-explore-sheet]'),canvas:page&&page.querySelector('.map-stage-canvas'),
  logo:page&&page.querySelector('[data-fake-google-logo]'),chips:page&&page.querySelector('.map-explore-chips'),cards:page&&page.querySelector('[data-sheet-cards-scroll]'),
  body:page&&page.querySelector('[data-sheet-body-scroll]'),nav:q('nav'),main:q('main.app-scroll')};};
window.__state=()=>{const e=window.__els();const o={html:h.className,vw:innerWidth,vh:innerHeight};for(const k of Object.keys(e))if(e[k]&&e[k].getBoundingClientRect)o[k]=R(e[k]);
 o.cards=qa('.map-page [data-place-card]').length;o.map={...window.__map,paddings:window.__map.paddings.length,lastPadding:window.__map.paddings[window.__map.paddings.length-1]};
 o.server=window.__serverCalls.slice();o.net=window.__net.slice();return o;};
window.__counts=()=>({server:window.__serverCalls.length,net:window.__net.length,mounts:window.__map.mounts,unmounts:window.__map.unmounts,resizes:window.__map.resizes,setPadding:window.__map.setPadding,paddings:window.__map.paddings.length,serverNames:window.__serverCalls.slice()});
window.__focus=()=>{window.__tMark=performance.now();__els().input.focus();return h.className;};
window.__blurWait=async()=>{__els().input.blur();await new Promise(r=>setTimeout(r,200));return h.className;};
window.__type=async(v)=>{const i=__els().input;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;flushSync(()=>{set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));});};
const pseudoH=(el)=>el?parseFloat(getComputedStyle(el,'::before').height)||0:0;
window.__geo=()=>{const e=__els();return {html:h.className,ov:R(e.ov),row:R(e.row),form:R(e.form),results:R(e.results),layer:R(e.layer),sheet:R(e.sheet),canvas:R(e.canvas),stage:R(e.stage),logo:R(e.logo),chips:R(e.chips),body:R(e.body),nav:R(e.nav),page:R(e.page),
 title:R(e.sheet&&e.sheet.querySelector(':scope > div:first-child > div:last-child > div.px-5.pb-2 > p')),beforeH:pseudoH(e.layer),
 sheetVis:e.sheet&&getComputedStyle(e.sheet).visibility,ovVis:e.ov&&getComputedStyle(e.ov).visibility,firstCard:R(q('.map-page [data-place-card]')),
 resultsUl:e.results&&e.results.querySelector('ul')?{sh:e.results.querySelector('ul').scrollHeight,ch:e.results.querySelector('ul').clientHeight,oy:getComputedStyle(e.results.querySelector('ul')).overflowY,mh:getComputedStyle(e.results.querySelector('ul')).maxHeight,items:e.results.querySelectorAll('li').length}:null,
 sheetScroll:e.sheet?{sh:e.sheet.scrollHeight,ch:e.sheet.clientHeight,st:e.sheet.scrollTop,oy:getComputedStyle(e.sheet).overflowY}:null,
 bodyScroll:e.body?{sh:e.body.scrollHeight,ch:e.body.clientHeight,oy:getComputedStyle(e.body).overflowY}:null};};
window.__trans=()=>{const e=__els();const t=(el,p)=>{const cs=getComputedStyle(el,p);return cs.transitionProperty+'|'+cs.transitionDuration;};return {layer:t(e.layer),ov:t(e.ov),before:t(e.layer,'::before'),sheet:t(e.sheet)};};
window.__anims=()=>{const e=__els();return document.getAnimations().filter(a=>{const t=a.effect&&a.effect.target;return t&&(t===e.layer||t===e.ov||t===e.sheet||t===e.stage);}).map(a=>(a.transitionProperty||a.animationName||'?')+'@'+(a.effect.target.className||'').toString().slice(0,20)+(a.effect.pseudoElement||''));};
// 逐幀取樣 ms 毫秒：class、位置、動畫
window.__sample=(ms)=>new Promise(res=>{const out=[];const t0=performance.now();const tick=()=>{const e=__els();const now=performance.now()-t0;
 out.push({t:+now.toFixed(1),tm:+(performance.now()-(window.__tMark||t0)).toFixed(1),anim:h.classList.contains('duo-map-kb-anim'),kb:h.classList.contains('map-keyboard-open'),detail:h.classList.contains('duo-map-detail-page'),lap:h.classList.contains('duo-laptop'),flat:h.classList.contains('duo-flat-portrait'),
  layerT:R(e.layer).t,layerB:R(e.layer).b,rowT:R(e.row).t,beforeH:pseudoH(e.layer),sheetH:R(e.sheet).h,running:window.__anims().length,names:window.__anims().join(','),pad:window.__map.paddings.length,resizes:window.__map.resizes});
 if(now<ms)requestAnimationFrame(tick);else res(out);};requestAnimationFrame(tick);});
window.__hitEl=(el)=>{if(!el)return {missing:true};const b=el.getBoundingClientRect();const x=b.left+Math.min(b.width/2,12),y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);return {ok:!!hit&&(el===hit||el.contains(hit)),by:hit?(hit.tagName+'.'+String(hit.className).slice(0,40)):null,rect:R(el)};};
window.__hit=(sel)=>window.__hitEl(q(sel));
const INTERACTIVE='button,a[href],input,textarea,select,[role=button],[tabindex],[data-place-card],[data-roamie-map-background],[data-sheet-drag-handle]';
window.__foldHits=(top,bottom,xMax)=>{const out=[];for(let y=Math.ceil(top)+0.5;y<bottom;y+=2)for(let x=1;x<(xMax??innerWidth);x+=8){const el=document.elementFromPoint(x,y);const hit=el&&el.closest(INTERACTIVE);if(hit)out.push({x,y,hit:hit.tagName+'.'+String(hit.className).slice(0,30)});}return out;};
window.__clickCard=(i)=>{const a=qa('.map-page [data-place-card]')[i];flushSync(()=>a.click());return !!a;};
window.__clickBack=()=>{const b=q('.map-page [data-map-explore-sheet] > div:first-child > div:last-child button');if(!b)throw new Error('no back button: '+(q('.map-page [data-map-explore-sheet] > div:first-child')||{}).innerHTML?.slice(0,300));flushSync(()=>b.click());return true;};
window.__clickText=(re)=>{const r=new RegExp(re);const b=qa('.map-page [data-map-explore-sheet] button').find(x=>r.test(x.textContent||'')||r.test(x.getAttribute('aria-label')||''));if(b)flushSync(()=>b.click());return b?(b.textContent||b.getAttribute('aria-label')).trim().slice(0,30):null;};
// 導航預覽（sheetMode="navigation"）目前沒有 UI 入口（startNavigation 直接開外部地圖）：以 React fiber 對 MapView 的 sheetMode state 直接 dispatch
window.__forceSheetMode=(from,to)=>{const page=q('.map-page');const key=Object.keys(page).find(k=>k.startsWith('__reactFiber$'));let f=page[key];
 while(f&&!(typeof f.type==='function'&&f.type.name==='MapView'))f=f.return;if(!f)return 'no-fiber';let hk=f.memoizedState;const hits=[];
 while(hk){if(hk.queue&&typeof hk.queue.dispatch==='function'&&hk.memoizedState===from)hits.push(hk);hk=hk.next;}
 if(hits.length!==1)return 'hooks='+hits.length;flushSync(()=>hits[0].queue.dispatch(to));return 'ok';};
window.__clickSel=(sel)=>{const b=q(sel);if(b)flushSync(()=>b.click());return !!b;};
window.__buttons=()=>qa('.map-page [data-map-explore-sheet] button').map(b=>(b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,24));
// 詳情：所有可點元素（button／a[href]）捲入面板後 elementFromPoint 可點
window.__detailClickables=()=>{const sheet=__els().sheet;const els=[...sheet.querySelectorAll('button,a[href],[role=button]')].filter(el=>{const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'&&el.getClientRects().length;});
 const out=[];for(const el of els){el.scrollIntoView({block:'center',inline:'nearest'});const r=window.__hitEl(el);out.push({label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,20),ok:r.ok,by:r.by,top:r.rect&&r.rect.t,pageScroll:document.scrollingElement.scrollTop});}
 sheet.scrollTop=0;return out;};
// .map-page 內所有可垂直捲動的容器
window.__vScrollers=()=>qa('.map-page *').filter(el=>{const cs=getComputedStyle(el);return /(auto|scroll)/.test(cs.overflowY)&&el.scrollHeight>el.clientHeight+1;}).map(el=>(el.getAttribute('data-map-explore-sheet')!=null?'SHEET':el.tagName+'.'+String(el.className).slice(0,40))+' sh='+el.scrollHeight+' ch='+el.clientHeight);
// iOS WebKit：捲動容器／transform 祖先會裁切或改變 fixed 子孫 → 所有 fixed 元素的祖先鏈結構斷言
window.__fixedChains=()=>qa('body *').filter(el=>getComputedStyle(el).position==='fixed').map(el=>{const bad=[];for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){const cs=getComputedStyle(a);
 if(cs.transform!=='none')bad.push('transform');if(cs.filter!=='none')bad.push('filter');if(cs.backdropFilter&&cs.backdropFilter!=='none')bad.push('backdrop');if(cs.contain!=='none')bad.push('contain');if(cs.willChange!=='auto')bad.push('will-change');
 if(/auto|scroll/.test(cs.overflowX+cs.overflowY)&&a.scrollHeight>a.clientHeight)bad.push('scroller:'+a.tagName+'.'+String(a.className).slice(0,30));}
 return {el:el.tagName+'.'+String(el.className).slice(0,40),inMapPage:!!el.closest('.map-page'),bad};}).filter(x=>x.bad.length||x.inMapPage);
window.__fixedInPage=()=>qa('.map-page *').filter(el=>getComputedStyle(el).position==='fixed').map(el=>el.tagName+'.'+String(el.className).slice(0,40));
window.__headerScroll=(dy)=>{const e=__els();const hd=e.sheet.querySelector('[data-no-sheet-drag]');const a=R(hd);e.sheet.scrollTop=dy;const b=R(hd);const st=e.sheet.scrollTop;const layerAfter=R(e.layer);e.sheet.scrollTop=0;return {before:a,after:b,scrollTop:st,layer:layerAfter};};
window.__nodes=()=>{const e=__els();window.__savedNodes=[e.canvas,e.sheet,e.input,q('[data-fake-google-map]')];return true;};
window.__sameNodes=()=>{const e=__els();const now=[e.canvas,e.sheet,e.input,q('[data-fake-google-map]')];return now.map((n,i)=>n===window.__savedNodes[i]&&!!n&&n.isConnected);};
// 非 Duo 回歸用：#root 下所有元素的幾何與關鍵 computed style
window.__snapshot=()=>{const props=['position','top','bottom','left','right','height','maxHeight','zIndex','overflowX','overflowY','pointerEvents','visibility','transform','display','isolation','transitionProperty','transitionDuration','paddingTop'];
 const out=[];for(const el of qa('#root *')){const cs=getComputedStyle(el);const b=el.getBoundingClientRect();out.push([el.tagName,+b.left.toFixed(2),+b.top.toFixed(2),+b.width.toFixed(2),+b.height.toFixed(2),...props.map(p=>cs[p])].join('|'));}
 const lb=__els().layer;return {html:h.className,htmlStyle:h.getAttribute('style'),els:out,dom:q('#root').innerHTML.length,domHash:q('#root').innerHTML,before:lb?getComputedStyle(lb,'::before').content:null,padding:window.__map.paddings[window.__map.paddings.length-1]};};
window.__setPostureAsync=(layout,hinge,fold)=>{window.__setPosture(layout,hinge,fold);return h.className;};
// #H3-2-T：頂端帶（y＝1～max(頁內安全區,12)）逐點 hit test，必須落在地圖畫布（假 Google 地圖）內
window.__topStrip=(xMax)=>{const e=__els();const p=document.createElement('div');p.style.cssText='position:absolute;visibility:hidden;padding-top:var(--safe-area-top)';e.page.appendChild(p);const sa=parseFloat(getComputedStyle(p).paddingTop)||0;p.remove();
 const miss=[];let n=0;for(let y=1;y<=Math.max(sa,12);y+=4)for(let x=4;x<(xMax??innerWidth)-4;x+=24){n++;const el=document.elementFromPoint(x,y);if(!el||!el.closest('[data-fake-google-map]'))miss.push({x,y,by:el?el.tagName+'.'+String(el.className).slice(0,40):null});}
 const m0=miss[0];const diag=m0?{stack:document.elementsFromPoint(m0.x,m0.y).slice(0,8).map(el=>el.tagName+'.'+String(el.className).slice(0,30)+' pe='+getComputedStyle(el).pointerEvents),page:R(e.page),stage:R(e.stage),canvas:R(e.canvas),main:R(e.main),map:R(q('[data-fake-google-map]')),mainOv:getComputedStyle(e.main).overflow,anc:(()=>{const o=[];for(let a=e.page.parentElement;a&&a!==document.body;a=a.parentElement){const cs=getComputedStyle(a);o.push(a.tagName+'.'+String(a.className).slice(0,50)+' rect='+JSON.stringify(R(a))+' ov='+cs.overflowX+'/'+cs.overflowY+' pt='+cs.paddingTop+' clip='+cs.clipPath+' contain='+cs.contain+' st='+a.scrollTop);}return o;})(),stageOv:getComputedStyle(e.stage).overflow,canvasOv:getComputedStyle(e.canvas).overflow}:null;
 return {stagePadTop:getComputedStyle(e.stage).paddingTop,safeInPage:sa,n,miss,diag};};
window.__safeInPage=()=>{const p=document.createElement('div');p.style.cssText='position:absolute;visibility:hidden;padding-top:var(--safe-area-top)';__els().page.appendChild(p);const v=parseFloat(getComputedStyle(p).paddingTop)||0;p.remove();return v;};
window.__kbVar=()=>h.style.getPropertyValue('--duo-map-keyboard-top');
// #H3-3-T：卡片尺寸／面板捲到底後最後一張卡片下緣／鉸鏈帶是否露出地圖（量測後還原 scrollTop）
window.__cardsScroll=(kbTop)=>{const e=__els();const sheet=e.sheet;const cards=qa('.map-page [data-place-card]');if(!sheet||!cards.length)return {missing:true,n:cards.length};
 const sizes=[...new Set(cards.map(c=>{const b=c.getBoundingClientRect();const ph=c.firstElementChild?c.firstElementChild.getBoundingClientRect().height:0;return JSON.stringify([Math.round(b.width*10)/10,Math.round(b.height*10)/10,Math.round(ph*10)/10]);}))].map(s=>JSON.parse(s));
 const last=cards[cards.length-1];
 // 卡片到面板（含）之間所有垂直捲動容器（探索清單模式下實際捲動的是內層 [data-sheet-body-scroll]）
 const scs=[];for(let a=last.parentElement;a&&a!==sheet.parentElement;a=a.parentElement){const cs=getComputedStyle(a);if(/(auto|scroll)/.test(cs.overflowY))scs.push(a);}
 const st0=scs.map(a=>a.scrollTop);scs.forEach(a=>{a.scrollTop=0;});const cardBottomAt0=R(last).b;
 const f=window.__FOLD;const foldMapHits=[];for(let y=Math.ceil(f[0])+1;y<f[1];y+=4)for(let x=4;x<innerWidth-70;x+=24){const el=document.elementFromPoint(x,y);if(el&&el.closest('[data-fake-google-map]'))foldMapHits.push(x+','+y);}
 scs.forEach(a=>{a.scrollTop=a.scrollHeight;});const lastBottomAtEnd=R(last).b;
 const scrollers=scs.map(a=>({el:a===sheet?'SHEET':a.hasAttribute('data-sheet-body-scroll')?'BODY':a.tagName+'.'+String(a.className).slice(0,24),sh:a.scrollHeight,ch:a.clientHeight,st:a.scrollTop,b:R(a).b}));
 const fc=cards[0].getBoundingClientRect();const hy=Math.min(fc.bottom-6,kbTop-2);const hit=document.elementFromPoint(fc.left+Math.min(fc.width/2,40),hy);
 const out={n:cards.length,sizes,oy:getComputedStyle(sheet).overflowY,scrollers,canScroll:scrollers.some(s=>s.sh>s.ch+0.5),sh:sheet.scrollHeight,ch:sheet.clientHeight,cardBottomAt0,stEnd:scrollers.map(s=>s.el+':'+s.st).join(','),lastBottomAtEnd,hitAtEnd:!!hit&&cards[0].contains(hit),hitBy:hit?hit.tagName+'.'+String(hit.className).slice(0,30):null,foldMapHits:foldMapHits.slice(0,5)};
 scs.forEach((a,i)=>{a.scrollTop=st0[i];});out.stAfter=scs.reduce((s,a,i)=>s+Math.abs(a.scrollTop-st0[i]),0);return out;};
// #H3-3-T2：雙層捲動量測：外層 SHEET 與內層 BODY 的 scrollHeight／clientHeight、SHEET 可捲距離、面板內所有可垂直捲動容器；
//   BODY 捲到底（SHEET 維持 0）後最後一張卡片相對 BODY 可視區與鍵盤上緣的位置（量測後還原 scrollTop）
window.__dualScroll=(kbTop)=>{const e=__els();const sheet=e.sheet,body=e.body;const cards=qa('.map-page [data-place-card]');if(!sheet||!body||!cards.length)return {missing:true,sheet:!!sheet,body:!!body,n:cards.length};
 const st0=[sheet.scrollTop,body.scrollTop];const last=cards[cards.length-1];const cs=e.cards;const sl0=cs?cs.scrollLeft:0;
 if(cs)cs.scrollLeft=cs.scrollWidth;const bcs=getComputedStyle(body);const padT=parseFloat(bcs.paddingTop)||0,padB=parseFloat(bcs.paddingBottom)||0;
 const vsc=[sheet,...sheet.querySelectorAll('*')].filter(el=>{const c=getComputedStyle(el);return /(auto|scroll)/.test(c.overflowY)&&el.scrollHeight>el.clientHeight;}).map(el=>el===sheet?'SHEET':el===body?'BODY':el.tagName+'.'+String(el.className).slice(0,30)+' sh='+el.scrollHeight+' ch='+el.clientHeight);
 sheet.scrollTop=100000;const sheetMax=sheet.scrollTop;sheet.scrollTop=0;
 body.scrollTop=body.scrollHeight;const bodyMax=body.scrollTop;const lb=R(last),bb=R(body),sb=R(sheet);
 const hx=lb.l+Math.min(lb.w/2,40),hy=Math.min(lb.b,kbTop)-4;const hit=document.elementFromPoint(hx,hy);
 const out={sheet:{sh:sheet.scrollHeight,ch:sheet.clientHeight,oy:getComputedStyle(sheet).overflowY,max:sheetMax,b:sb.b},body:{sh:body.scrollHeight,ch:body.clientHeight,oy:getComputedStyle(body).overflowY,mh:getComputedStyle(body).minHeight,max:bodyMax,t:bb.t,b:bb.b},
  cardsOx:cs?getComputedStyle(cs).overflowX:null,cardsOy:cs?getComputedStyle(cs).overflowY:null,vsc,last:lb,lastHit:!!hit&&last.contains(hit),lastHitBy:hit?hit.tagName+'.'+String(hit.className).slice(0,30):null,n:cards.length,padT,padB,vw:innerWidth};
 sheet.scrollTop=st0[0];body.scrollTop=st0[1];if(cs)cs.scrollLeft=sl0;out.restored=sheet.scrollTop===st0[0]&&body.scrollTop===st0[1]&&(!cs||cs.scrollLeft===sl0);return out;};
// #H3-3-T：姿勢序列＋MutationObserver（每個 callback＝一個 mutation 批次，記錄批次結束時的 class／--duo-hinge-*）＋逐幀取樣
window.__postureRun=async(steps)=>{const rec={batches:[],frames:[],events:[]};
 const snap=()=>({lap:h.classList.contains('duo-laptop'),flat:h.classList.contains('duo-flat-portrait'),two:h.classList.contains('duo-two-pane'),top:h.style.getPropertyValue('--duo-hinge-top'),bot:h.style.getPropertyValue('--duo-hinge-bottom'),t:+performance.now().toFixed(1)});
 const mo=new MutationObserver(rs=>{rec.batches.push({cls:rs.filter(r=>r.attributeName==='class').length,sty:rs.filter(r=>r.attributeName==='style').length,...snap()});});
 mo.observe(h,{attributes:true,attributeFilter:['class','style']});
 let on=true;const tick=()=>{if(!on)return;rec.frames.push(snap());requestAnimationFrame(tick);};requestAnimationFrame(tick);
 for(const s of steps){const hs=typeof s.hinge==='string'?HINGES[s.hinge](innerWidth,innerHeight,window.__FOLD):s.hinge;
  flushSync(()=>{if(s.layout)__setDuoLayout(LAYOUTS[s.layout]);__setHinge(hs);});rec.events.push({label:s.label,t:+performance.now().toFixed(1),after:snap()});
  await new Promise(r=>setTimeout(r,s.wait));}
 on=false;await new Promise(r=>setTimeout(r,0));mo.disconnect();rec.final=snap();return rec;};
window.__ready=true;
__ENTRY__*/

if (!chromeBin) {
  failures.push("B 無可用 Chrome");
  console.log("FAIL B 無可用 Chrome，未執行瀏覽器量測");
} else {
  await runBrowser();
}

console.log(failures.length ? `\nverify-duo-explore-keyboard-flat: FAIL (${failures.length})` : "\nverify-duo-explore-keyboard-flat: PASS");
process.exit(failures.length ? 1 : 0);
