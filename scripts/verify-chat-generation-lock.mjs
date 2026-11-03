// verify-chat-generation-lock.mjs — 行程生成中全域鎖住聊聊輸入（任務單 #L1-T，tester 先寫會失敗的測試）
//
// 背景：A2 第 6 項。大阪行程生成中離開聊聊頁、回來換金澤；大阪那次完成時跳到大阪行程頁或覆蓋金澤的 Session。
// 使用者裁決：只要有任何行程正在生成，所有能送出新聊聊請求的入口都鎖住（全域鎖，只存在記憶體，5 分鐘強制解鎖）。
//
// 受測（真實檔案，esbuild 打包、React development build＋<StrictMode>，headless Chrome 真實 render）：
//   src/routes/_app.chat.tsx（Chat 頁本體＋ChatComposer／ChatMessageList…）、src/routes/_app.index.tsx（首頁）。
//   生成流程走真實程式：日期確認待答 Session（真實 prepareTripDateConfirmation）→ 使用者輸入日期 Enter →
//   真實 send() → runDirectItinerary → handleGenerateItinerary → confirmSaveTrip → navigate。
// Mock 外部邊界（全部計數）：AI（stream-client、ai-itinerary-state-machine 的 prepareDirectItineraryFlow／
//   createItineraryFromSession，由測試以 deferred promise 控制完成時機）、Places（*.functions server fn 依模組計數、
//   itinerary-place-fetch）、Credits（@/lib/credits、supabase rpc）、supabase、router（navigate 記錄）、window.fetch、
//   confirmSaveTrip／updateTripMeta、routesService、placeImageService、首頁資料層（同 verify-duo-laptop-saved-home-profile）。
// 假時鐘：頁面載入前安裝；Date／performance.now 加位移，>=1000ms 的 setTimeout／setInterval 進虛擬佇列，由測試推進
//   （<1000ms 的計時器照常執行，不影響 React）。
//
// 「鎖住」判定（與「單純 loading」區分）：輸入框 disabled 且 placeholder 含鎖定文案（zh-TW「行程生成中…」）。
//   單純 loading（原聊聊 generating=true）只有 disabled，placeholder 仍是一般文案 → 不算鎖住（B0a 證明）。
// 「沒有送出請求」：AI／Places／Credits／fetch／supabase rpc／server fn（天氣與餘額讀取除外）計數差為 0。
//
// 斷言（[需求#]；修正前預期 FAIL，第 7 條與 B0 對照預期 PASS）：
//   S1 [3]  i18n 檔有 zh-TW「行程生成中…」「這次生成比平常久，完成後會通知你」；routes／components／hooks 不得寫死
//   S2 [2]  其他頁帶入聊聊且會寫入聊聊狀態的入口（首頁心情、地點詳情、地圖、推薦頁、規劃頁、行程加點）有引用生成鎖模組
//   A1 [1][3] 原聊聊生成中：輸入格顯示鎖定文案（非只有 loading）
//   L1 [1][5] 離開聊聊（卸載）再進新對話：仍鎖住
//   L2 [2]  鎖住時快捷按鈕全部 disabled、點擊不送出
//   L3 [2]  鎖住時輸入框／Enter／送出鈕不送出
//   L4 [2]  鎖住時聊聊自動送出的帶入入口不送出：J1 首頁心情 prompt、J2 行程加點 handoff、J3 規劃頁 handoff
//           （各附未鎖對照 J*c：同一入口未鎖時確實會送出，證明斷言有效）
//   L5 [2]  首頁：心情快捷不寫入聊聊 Session、帶入後不送出；聊聊卡帶入的聊聊是鎖住的
//   L6 [3]  90 秒內無「比平常久」提示；超過 90 秒出現；四語系文案走 i18n（非 key、非 zh-TW、語系文字正確）
//   L7 [4]  成功解鎖（原對話）、成功解鎖（新對話，live 更新不需 remount）、失敗（Planner 回 ok:false）解鎖、
//           例外（網路錯誤）解鎖、prepare 階段失敗／例外解鎖；解鎖後可再送出
//   L8 [4]  滿 5 分鐘強制解鎖（299 秒仍鎖、301 秒解鎖）；強制解鎖後新生成 G2 的鎖不被舊 G1 完成解除
//   L9 [4]  鎖只在記憶體：生成中重新載入 App 後不鎖
//   L10 [6] 使用者在重置後新對話時舊生成成功：不導向舊行程頁、不寫入新對話訊息／聊聊 store
//   L11 [6] 新對話中舊生成失敗：不寫入新對話訊息／store、不導向
//   R7 [7]  （應 PASS，維持既有行為）R7a 未生成時四語系 placeholder 為一般文案、輸入框／快捷可用；R7b Enter 會送出；
//           R7c 快捷會送出；R7e 首頁心情照常導向並寫入 Session；R7f／R7g 仍在原對話時成功照常導向行程頁；
//           R7h 新對話中舊生成成功時行程照常保存（confirmSaveTrip 恰 1 次）；
//           R7d 與改動前 baseline（scratchpad 副本，sha256 固定）逐字比對 DOM、請求序列與導向
//   H（資訊）使用者在首頁（未開聊聊）時舊生成完成是否導向——任務單未規定，只印出
//   B0 對照：B0a 真實 ChatComposer generating=true（單純 loading）不被判為鎖住；B0b 計數器能偵測送出；
//           J*c 各帶入入口未鎖時確實送出；--ref 參考修補下全部 PASS（可被滿足）；--ref --mutant=* 弄壞一處時對應斷言 FAIL
//           （--ref 是實作前的自我檢查：實作合入後錨點已改變，--ref 模式不再適用）
//
// #L1-T2（獨立審查新增）：
//   M1  使用者在首頁時舊生成成功：不跳轉、「行程已完成」toast（附「查看」）恰 1 次；同 Session 完成狀態照常寫回；點「查看」→ /saved/$tripId
//   M2  新對話中舊生成成功：提示＋查看；點「查看」導向舊行程、不改寫新對話 Session
//   M3  原對話成功、navigate 使聊聊卸載（模擬真實 router）：完成狀態仍寫回 Session（persistSession 不誤擋），與改動前 baseline 相同
//   P1  生成中開地點詳情再返回（UI 快取還原同一 Session）＝原對話：照常直接導向
//   P2  Plus 從行程草稿（workspaceId）回到同一 Session＝原對話：照常直接導向、不顯示提示
//   N   鎖住時新對話的「清除聊聊」（需求 1）
//   J*u 鎖住時略過的帶入：解鎖瞬間／解鎖後切換語系不自動送出；下次進聊聊不超過未鎖對照一次的量、再進一次不重複
//   E-* 其他頁入口真實 render＋點擊（推薦頁、規劃頁、地點詳情、行程詳情加點）：鎖住時不寫聊聊狀態／不導向／不請求、鎖定提示恰 1 次（附未鎖對照）
// #L1-T3（第 2 輪審查新增）：
//   N2  確認框在未鎖時已開、之後才上鎖：清除鈕 disabled、按「確認」confirmClearChat 不改寫 store／訊息、不呼叫 supabase（附未鎖對照 N2c）
//   FA–FE2 不在原對話（首頁／新對話）時失敗（create ok:false／例外、prepare ok:false／例外）：「行程生成失敗，請再試一次」恰 1 則、不導向；
//       F*b credits 呼叫序列與改動前 baseline 相同（baseline 無失敗提示＝對照）
//   FO1–FO4 仍在原對話時失敗：無失敗提示；聊天訊息、所有 toast、credits 序列與改動前 baseline 相同
//   FF  5 分鐘強制解鎖後才失敗：仍通知恰 1 則
//   LC1–LC5 生成中離開聊聊、切換裝置語系後成功／失敗：提示用新語系（非已卸載實例的 zh-TW t）
//   FM（#L1-T3 資訊；#L1-T4 改為斷言）不在原對話時 offerMustVisit 失敗：頂部 error toast 恰 1 則
// #L1-T4（第 3 輪審查新增）：
//   CAP1–CAP3 不在原對話容量超過：一則＝顯示當下語系 chatRuntime.capacity（zh-TW／en／ja）；CAPO 原對話與 baseline 相同
//   EB1–EB2 入口 entry_blocked（runDirect 帶 ownership）：通用失敗一則；EBO 原對話與 baseline 相同
//   SV1–SV2 已保存後 ownership 失效：「行程已完成」一則＋查看、無失敗提示、不導向；SVO 原對話與 baseline 相同
//   TT1–TT6 通知丟例外：Credits settle 序列與 baseline 相同、解鎖、無未捕捉例外
//   FM／FAE（offerMustVisit／apiEmpty）不在原對話只剩一則通用提示；FMO／FAEO 原對話與 baseline 相同
//   FE3 新對話＋prepare ok:false：通過 prepare 後的快照檢查並通知；ND（資訊）prepare 後無日期 → pauseForTripDates
//   （地圖「聊這個地點」見 verify-duo-explore-keyboard-flat.mjs K11；「查看」真實 router 見 verify-chat-generation-lock-router.mjs；
//    鎖模組計時器見 verify-chat-generation-lock-module.mjs）
//
// 不讀 .env、不連網；瀏覽器只連 127.0.0.1 fixture server。
// 執行：node scripts/verify-chat-generation-lock.mjs
//       node scripts/verify-chat-generation-lock.mjs --ref                 （自我檢查：記憶體參考修補，預期全 PASS）
//       node scripts/verify-chat-generation-lock.mjs --ref --mutant=owner  （owner／persist／noslow／noforce／nostale／nosendguard／nohome）

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const abs = (p) => path.join(root, p).replace(/\\/g, "/");
const failures = [];
const infos = [];
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    results.push(["FAIL", name]);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 16).join("\n     "));
  }
}
const info = (s) => {
  infos.push(s);
  console.log("INFO " + s);
};

// --ref：自我檢查模式。以記憶體內的參考修補（不寫入任何 source 檔）打包後跑同一組行為斷言，
// 證明斷言可被正確實作滿足（預期全部 PASS）；不跑 Part S 靜態檢查。不是建議實作。
const REF = process.argv.includes("--ref");
const LOCK_ZH = "行程生成中…";
const SLOW_ZH = "這次生成比平常久，完成後會通知你";
const LOCALES = ["zh-TW", "en", "ja", "ko"];

// ───────────────────────── Part S：靜態 ─────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const i18nFiles = walk("src/lib/i18n");
if (!REF) await staticChecks();
async function staticChecks() {
await check("S1a [3] i18n 檔含 zh-TW 鎖定文案「行程生成中…」與「這次生成比平常久，完成後會通知你」", () => {
  const all = i18nFiles.map(read).join("\n");
  assert.ok(all.includes(LOCK_ZH), "src/lib/i18n 找不到「" + LOCK_ZH + "」");
  assert.ok(all.includes(SLOW_ZH), "src/lib/i18n 找不到「" + SLOW_ZH + "」");
});
await check("S1b [3] routes／components／hooks 不得寫死鎖定文案（必須走 i18n）", () => {
  const hits = [...walk("src/routes"), ...walk("src/components"), ...walk("src/hooks")].filter((f) => {
    const s = read(f);
    return s.includes("行程生成中") || s.includes("這次生成比平常久");
  });
  assert.deepEqual(hits, []);
});
// 其他頁帶入聊聊、且會寫入聊聊 Session／handoff 或清掉聊聊的入口（grep 結果，見交接報告入口清單）
const WRITER_ENTRIES = [
  ["src/routes/_app.index.tsx", "saveChatSession(beginHomeMoodShortcutSession", "首頁心情快捷"],
  ["src/routes/_app.place.tsx", "saveChatSession(enterPlaceDetailChat", "地點詳情「聊這裡」"],
  ["src/routes/_app.map.tsx", "saveChatSession(addSelectedPlace", "地圖「聊這個地點」"],
  ["src/routes/_app.recommendations.tsx", "saveChatSession(session)", "推薦頁「在聊聊繼續」"],
  ["src/routes/_app.plan.tsx", "clearChatSession()", "規劃頁送出（清空聊聊並帶入）"],
  ["src/components/saved/SavedTripItineraryEditor.tsx", "writeTripAddPlaceHandoff(handoff)", "行程詳情「用聊聊加地點」"],
];
for (const [file, needle, label] of WRITER_ENTRIES) {
  await check(`S2 [2] ${label}（${file}）引用生成鎖模組（import 路徑含 generation-lock）`, () => {
    const s = read(file);
    assert.ok(s.includes(needle), "入口特徵字串已不存在（原始碼變動，請更新本測試）：" + needle);
    assert.match(s, /from\s+["'][^"']*generation-lock[^"']*["']/, "未 import 生成鎖模組，入口未受鎖保護");
  });
}
}

// ───────────────────────── --ref 參考修補（只在記憶體，自我檢查用） ─────────────────────────
const REF_LOCK_MODULE = String.raw`import {useSyncExternalStore} from 'react';
import {CREDITS_RESERVE_STALE_MAX_AGE_MS} from '@/lib/credits/constants';
let st={locked:false,slow:false,owner:null};const subs=new Set();let t1=null,t2=null;
const emit=(n)=>{st=n;subs.forEach(f=>f());};
export function beginChatGenerationLock(owner){clearTimeout(t1);clearTimeout(t2);emit({locked:true,slow:false,owner});
 t1=setTimeout(()=>{if(st.owner===owner)emit({...st,slow:true});},90000);
 t2=setTimeout(()=>{if(st.owner===owner)emit({locked:false,slow:false,owner:null});},CREDITS_RESERVE_STALE_MAX_AGE_MS);}
export function endChatGenerationLock(owner){if(st.owner!==owner)return;clearTimeout(t1);clearTimeout(t2);emit({locked:false,slow:false,owner:null});}
export function isChatGenerationLocked(){return st.locked;}
export function useChatGenerationLock(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>st,()=>st);}
const COPY={'zh-TW':['行程生成中…','這次生成比平常久，完成後會通知你'],en:['Building your trip…','This is taking longer than usual. We will let you know when it is ready.'],
 ja:['旅程を作成中…','いつもより時間がかかっています。完了したらお知らせします。'],ko:['일정 생성 중…','평소보다 오래 걸리고 있어요. 완료되면 알려드릴게요.']};
export function lockCopy(l){return COPY[l]||COPY['zh-TW'];}`;
const REF_PATCHES = {
  "src/routes/_app.chat.tsx": [
    [`import { useI18n } from "@/hooks/use-i18n";`, `import { useI18n } from "@/hooks/use-i18n";\nimport { useChatGenerationLock, beginChatGenerationLock, endChatGenerationLock, isChatGenerationLocked, lockCopy } from "@/lib/ai/chat-generation-lock";`],
    [`  const [generating, setGenerating] = useState(false);`, `  const [generating, setGenerating] = useState(false);\n  const genLock = useChatGenerationLock();`],
    [`if (!trimmed || streaming || generating) return;`, `if (!trimmed || streaming || generating || isChatGenerationLocked()) return;`],
    [`      const pendingOwner = restorePendingPlanAiOwner(next, loadChatSession());`, `      if (chatUnmountedRef.current) return next;\n      const pendingOwner = restorePendingPlanAiOwner(next, loadChatSession());`],
    [`      const navigation = navigate(tripDetailNavigateOptions(saved.id));`, `      const navigation = chatUnmountedRef.current ? undefined : navigate(tripDetailNavigateOptions(saved.id));`],
    [`    const finishPlanningLoading = explicitCreateLoading.begin(activeSession.tripCreationAuthority);`, `    const finishPlanningLoading = explicitCreateLoading.begin(activeSession.tripCreationAuthority);\n    beginChatGenerationLock(generationRequestId);`],
    [`      finishPlanningLoading();\n      if (activeGenerationRequestIdRef.current === generationRequestId) {`, `      finishPlanningLoading();\n      endChatGenerationLock(generationRequestId);\n      if (activeGenerationRequestIdRef.current === generationRequestId) {`],
    [`          if (shouldRunTripAddPlaceHandoff) {`, `          if (shouldRunTripAddPlaceHandoff && !isChatGenerationLocked()) {`],
    [`            !planHandoffStartedRef.current\n          ) {`, `            !planHandoffStartedRef.current &&\n            !isChatGenerationLocked()\n          ) {`],
    [`            disabled={streaming || generating}\n            showShortcutChips`, `            disabled={streaming || generating || genLock.locked}\n            showShortcutChips`],
    [`            generating={generating}\n            streaming={streaming}\n            onChipSend`, `            generating={generating || genLock.locked}\n            lockedPlaceholder={genLock.locked ? lockCopy(locale)[0] : undefined}\n            lockedHint={genLock.locked && genLock.slow ? lockCopy(locale)[1] : undefined}\n            streaming={streaming}\n            onChipSend`],
  ],
  "src/components/chat/ChatComposer.tsx": [
    [`        placeholder={t("uiCoverage.chatPlaceholder")}`, `        placeholder={(arguments[0] as any).lockedPlaceholder ?? t("uiCoverage.chatPlaceholder")}`],
    [`      <InputRow {...props} />`, `      <InputRow {...props} />\n      {(props as any).lockedHint ? <p className="px-3 pb-1 text-[11px] text-muted-foreground">{(props as any).lockedHint}</p> : null}`],
  ],
  "src/routes/_app.index.tsx": [
    [`import { useServerFn } from "@tanstack/react-start";`, `import { useServerFn } from "@tanstack/react-start";\nimport { isChatGenerationLocked } from "@/lib/ai/chat-generation-lock";`],
    [`    if (!requireAuthForAction("mood_shortcut", { moodId: next })) return;`, `    if (isChatGenerationLocked()) return;\n    if (!requireAuthForAction("mood_shortcut", { moodId: next })) return;`],
  ],
};
// --ref --mutant=<名稱>：故意弄壞參考修補，確認對應斷言會 FAIL（斷言敏感度）
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").slice(9);
const MUTANTS = {
  owner: ["舊生成結束可解除別人的鎖", () => (REF_LOCK_MODULE_USED = REF_LOCK_MODULE.replace("if(st.owner!==owner)return;", ""))],
  persist: ["鎖存進 sessionStorage（重新載入仍鎖）", () => (REF_LOCK_MODULE_USED = REF_LOCK_MODULE.replace("let st={locked:false,slow:false,owner:null};", "let st=JSON.parse(sessionStorage.getItem('ref-lock')||'null')||{locked:false,slow:false,owner:null};").replace("const emit=(n)=>{st=n;", "const emit=(n)=>{st=n;sessionStorage.setItem('ref-lock',JSON.stringify(n));"))],
  noslow: ["沒有 90 秒提示", () => (REF_LOCK_MODULE_USED = REF_LOCK_MODULE.replace("emit({...st,slow:true})", "0"))],
  noforce: ["沒有 5 分鐘強制解鎖", () => (REF_LOCK_MODULE_USED = REF_LOCK_MODULE.replace("},CREDITS_RESERVE_STALE_MAX_AGE_MS);}", "},CREDITS_RESERVE_STALE_MAX_AGE_MS*10);}"))],
  nostale: ["卸載後舊結果仍導向／寫 store", () => (REF_SKIP = new Set([3, 4]))],
  nosendguard: ["send() 不檢查鎖（只靠 UI disabled）", () => (REF_SKIP = new Set([2]))],
  nohome: ["首頁心情不檢查鎖", () => (REF_SKIP_HOME = true)],
};
let REF_LOCK_MODULE_USED = REF_LOCK_MODULE;
let REF_SKIP = new Set();
let REF_SKIP_HOME = false;
if (MUTANT) {
  if (!MUTANTS[MUTANT]) throw Error("未知 mutant：" + MUTANT + "（可用：" + Object.keys(MUTANTS).join(", ") + "）");
  MUTANTS[MUTANT][1]();
  if (REF_LOCK_MODULE_USED === REF_LOCK_MODULE && !REF_SKIP.size && !REF_SKIP_HOME) throw Error("mutant 未生效");
  console.log("MUTANT " + MUTANT + "：" + MUTANTS[MUTANT][0]);
}
function refPatched(file) {
  let s = read(file);
  for (const [i, [from, to]] of REF_PATCHES[file].entries()) {
    if (file === "src/routes/_app.chat.tsx" && REF_SKIP.has(i)) continue;
    if (file === "src/routes/_app.index.tsx" && REF_SKIP_HOME && i === 1) continue;
    const n = s.split(from).length - 1;
    if (n !== 1) throw Error(`--ref 修補錨點在 ${file} 出現 ${n} 次：${from.slice(0, 60)}`);
    s = s.replace(from, () => to);
  }
  return s;
}

// ───────────────────────── baseline（R7d 用） ─────────────────────────
const SCRATCH = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const BASE_DIR = path.join(SCRATCH, "chat-generation-lock-baseline");
const BASE_FILES = {
  "src/routes/_app.chat.tsx": "95e7866a0e96f036540d1e6402534f02ac436ce9f0a431bc48f6f6de5790a5f4",
  "src/components/chat/ChatComposer.tsx": "2739be0a2595e59153b7031795474754a06fec3f6fb7e308af1b94f4d815d35d",
  "src/routes/_app.index.tsx": "883eae52321e987bf1eb0df0478e58624987322eba29b03e94e192fa9767decc",
};
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
if (process.argv.includes("--print-sha")) {
  for (const f of Object.keys(BASE_FILES)) console.log(f, sha(fs.readFileSync(path.join(root, f))));
  process.exit(0);
}
let baseline = null;
try {
  const out = {};
  for (const [f, want] of Object.entries(BASE_FILES)) {
    const copy = path.join(BASE_DIR, f.replace(/[\\/]/g, "__"));
    if (!fs.existsSync(copy)) {
      const cur = fs.readFileSync(path.join(root, f));
      if (sha(cur) === want) {
        fs.mkdirSync(BASE_DIR, { recursive: true });
        fs.writeFileSync(copy, cur);
      }
    }
    if (!fs.existsSync(copy) || sha(fs.readFileSync(copy)) !== want) throw Error("缺少改動前副本：" + f);
    out[path.join(root, f)] = fs.readFileSync(copy, "utf8");
  }
  baseline = out;
} catch (e) {
  info("R7d 無改動前 baseline 副本（" + e.message + "），只跑行為斷言");
}

// ───────────────────────── fixture／mock ─────────────────────────
const cnt = `const C=(k)=>{const c=(window.__counts||(window.__counts={}));c[k]=(c[k]||0)+1;(window.__callLog||(window.__callLog=[])).push(k);};`;
const mocks = {
  "@/hooks/use-duo-layout": `const cur={navPlacement:'bottom',tripLayout:'single',usableWidth:402};export function useDuoLayout(){return cur;}export function setDuoLayout(){}`,
  "@/hooks/use-duo-laptop": `const L={laptop:false};export function useDuoLaptop(){return L;}export function useDuoDevice(){return false;}`,
  "@/hooks/use-i18n": `import {useSyncExternalStore} from 'react';import {translate,translateList} from '${abs("src/lib/i18n/translate.ts")}';
const subs=new Set();const cache={};const mk=(l)=>cache[l]||(cache[l]={locale:l,localePreference:l,t:(k,v)=>translate(l,k,v),tList:(k)=>translateList(l,k),setLocalePreference:async()=>{},setLocale:async()=>{}});
export function setTestLocale(l){window.__locale=l;subs.forEach(f=>f());}
export const ROAMIE_LOCALE_CHANGED='roamie:locale-changed';
export function useI18n(){return useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>mk(window.__locale||'zh-TW'),()=>mk('zh-TW'));}
export function I18nProvider({children}){return children;}`,
  "@tanstack/react-router": `import React from 'react';
const NAV=(o)=>{(window.__nav||(window.__nav=[])).push(JSON.parse(JSON.stringify(o??null)));
 if(window.__unmountOnTripNav&&o&&o.params&&o.params.tripId&&window.show)window.show('none');return Promise.resolve();};
const ROUTER={subscribe:()=>()=>{},invalidate:async()=>{},navigate:NAV,history:{back(){},go(){}},state:{location:{pathname:'/'}},preloadRoute:async()=>{}};
export const useNavigate=()=>NAV;
export const useRouter=()=>ROUTER;
export const useLocation=()=>({pathname:window.__path||'/',search:{},hash:''});
export const useRouterState=(o)=>{const s={location:{pathname:window.__path||'/',search:{}},status:'idle'};return o&&o.select?o.select(s):s;};
export const useCanGoBack=()=>false;
export const Outlet=()=>null;
export const Link=React.forwardRef(function Link({to,search,params,replace,preload,activeProps,inactiveProps,activeOptions,children,onClick,disabled,...rest},ref){
 return <a ref={ref} href={typeof to==='string'?to:'#'} onClick={(e)=>{e.preventDefault();onClick&&onClick(e);if(disabled)return;NAV({to,search});}} {...rest}>{typeof children==='function'?children({isActive:false}):children}</a>;});
export function createFileRoute(p){return (opts)=>({options:opts,path:p,useSearch:()=>(window.__search&&window.__search[p])||{},useParams:()=>({}),useLoaderData:()=>undefined,useNavigate:()=>NAV});}
export function getRouteApi(p){return {useSearch:()=>(window.__search&&window.__search[p])||{},useParams:()=>({})};}
export function redirect(o){return o;}`,
  "@tanstack/react-start": `${cnt}
const DEF={'weather.functions':()=>({weather:null,error:'verify_offline'}),'location.functions':()=>({location:null,error:'verify_offline',results:[]})};
export function createServerFn(opts){const mod=globalThis.__sfMod||'unknown';const b={middleware(){return b},validator(){return b},inputValidator(){return b},
 handler(h){const f=async(a)=>{C('sf:'+mod);const impl=(window.__sfImpl&&window.__sfImpl[mod])||DEF[mod];return impl?impl(a):null;};return f;}};return b;}
export const useServerFn=(f)=>f;
export function createMiddleware(){const m={server(){return m},client(){return m},middleware(){return m},validator(){return m},inputValidator(){return m}};return m;}
export function createStart(){return {};}`,
  "@tanstack/react-start/server": `export const getRequest=()=>null;export const getRequestHeader=()=>null;export const setResponseHeader=()=>{};`,
  "@/integrations/supabase/client": `${cnt}
const USER={id:'u1',email:'tester@example.com'};const SESSION={access_token:'tok',user:USER,expires_at:9999999999};
function chain(p){const fn=function(){};return new Proxy(fn,{get(t,k){if(k==='then'){return (res,rej)=>Promise.resolve({data:[],error:null,count:0}).then(res,rej);}
 if(k==='catch'||k==='finally'){const pr=Promise.resolve({data:[],error:null});return pr[k].bind(pr);}return chain(p+'.'+String(k));},apply(){return chain(p+'()');}});}
const auth={getSession:async()=>({data:{session:SESSION},error:null}),getUser:async()=>({data:{user:USER},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),refreshSession:async()=>({data:{session:SESSION},error:null})};
const base={auth,from:(t)=>{C('sbfrom:'+t);return chain('from:'+t);},rpc:(n)=>{C('rpc:'+n);return chain('rpc:'+n);},
 storage:{from:(b)=>{C('sbstorage:'+b);return chain('storage:'+b);}},functions:{invoke:async(n)=>{C('sbfn:'+n);return {data:null,error:null};}},
 channel:()=>chain('channel'),removeChannel:()=>{}};
export const supabase=new Proxy(base,{get(t,k){return k in t?t[k]:chain(String(k));}});
export function isSupabaseConfigured(){return true;}export function getSupabaseClient(){return supabase;}`,
  "@/hooks/use-auth": `const USER={id:'u1',email:'tester@example.com'};const SESSION={access_token:'tok',user:USER};
const V={user:USER,session:SESSION,loading:false,signOut:async()=>{},refreshSession:async()=>{}};
export const useAuth=()=>V;export function AuthProvider({children}){return children;}`,
  // #L1-T2：window.__plus＝true 時回傳 Plus（只影響之後 mount 的元件；未設定時與原本完全相同）
  "@/hooks/use-access": `const V={hasPlusAccess:false,subscriptionSource:'verify',entitlementDisplayStable:true,subscriptionHydrated:true,isPlus:false,plan:'free',loading:false};
const VP={...V,hasPlusAccess:true,isPlus:true,plan:'plus'};
export function useAccess(){return window.__plus?VP:V;}export function useAccessOptional(){return window.__plus?VP:V;}export function AccessProvider({children}){return children;}`,
  "@/providers/SubscriptionProvider": `const V={loading:false,isPlus:false,refresh:async()=>{}};export function useSubscription(){return V;}export function SubscriptionProvider({children}){return children;}`,
  "@/hooks/use-add-to-trip": `const V={openAddToTrip(){}};export function useAddToTrip(){return V;}export function useAddToTripOptional(){return V;}export function AddToTripProvider({children}){return children;}`,
  "@/hooks/use-pending-auth-action": `export function usePendingAuthActionResume(){}`,
  "@/hooks/use-avatar": `const V={hasCustomAvatar:false,avatarUrl:null,displaySrc:null,setPreview(){},syncFromProfile(){},pending:false};
export function useAvatar(){return V;}export function useAvatarDisplaySrc(){return null;}export function AvatarProvider({children}){return children;}export const avatarRevisionFromUpdatedAt=()=>0;`,
  "@/hooks/use-cover": `const V={coverUrl:null,coverDisplaySrc:null,coverPending:false,setPreview(){},syncFromProfile(){}};
export function useCover(){return V;}export function CoverProvider({children}){return children;}`,
  "@/hooks/use-plus-upgrade": `const V={upgradeToPlus:async()=>({}),openRevenueCatPaywall:()=>{}};export function usePlusUpgrade(){return V;}`,
  "@/hooks/use-preference-quiz-status": `const S={preferenceQuizCompleted:true,travelStyleName:'',personalityType:'',personalitySummary:'',tags:[],prefs:{onboarded:true},snapshot:null};
export function useTravelPrefStatus(){return S;}export function usePreferenceQuizCompleted(){return true;}`,
  "@/lib/trip/core-trip": `export * from '${abs("src/lib/trip/core-trip.ts")}';${cnt}
export async function listCoreTrips(){C('home:listCoreTrips');return [];}
export async function getLatestCoreTrip(){C('home:getLatestCoreTrip');return null;}`,
  "@/lib/places-storage": `export * from '${abs("src/lib/places-storage.ts")}';${cnt}
export async function listPlaces(){C('data:listPlaces');return [];}
export function peekListPlacesCache(){return null;}
export function readPlacesLocalCacheSync(){return [];}
export async function toggleSavePlace(){C('data:toggleSavePlace');return {saved:true};}
export async function deletePlace(){C('data:deletePlace');}`,
  "@/lib/saved-list-snapshot": `export * from '${abs("src/lib/saved-list-snapshot.ts")}';
export function readSavedPlacesSnapshot(){return [];}export function readSavedTripsSnapshot(){return [];}
export async function hydrateSavedListSnapshot(){return {trips:[],places:[],source:'none'};}export function writeSavedPlacesSnapshot(){}export function writeSavedTripsSnapshot(){}`,
  "@/lib/profile-storage": `export * from '${abs("src/lib/profile-storage.ts")}';${cnt}
export async function getUserProfile(){C('data:getUserProfile');return {displayName:'旅人',bio:'',avatarUrl:null,coverImageUrl:null,travelStyle:'',language:'zh-TW',notificationsEnabled:true,authProvider:null,prefs:{onboarded:false},personalityType:'',personalitySummary:'',personalityImpression:''};}
export async function saveUserProfile(){C('data:saveUserProfile');}
export async function syncTravelPreferenceProfileFields(){}`,
  "@/lib/ensure-user-profile": `export * from '${abs("src/lib/ensure-user-profile.ts")}';
export async function ensureUserProfile(){return true;}export async function syncProfileAppFields(){}`,
  "@/lib/conversation-workspace": `export * from '${abs("src/lib/conversation-workspace/index.ts")}';
export async function hydrateConversationWorkspaces(){}export function listConversationWorkspaces(){return [];}`,
  "@/lib/home-nearby-search": `export * from '${abs("src/lib/home-nearby-search.ts")}';${cnt}
export async function loadHomeNearbyPicks(){C('home:loadNearbyPicks');return [];}`,
  "@/lib/effective-location": `export * from '${abs("src/lib/effective-location.ts")}';
const SNAP={lat:35.01,lng:135.76,city:'京都',locationKey:'35.01,135.76',source:'gps',permission:'granted',isFallback:false,isReadyForPlaces:true,status:'ready',accuracy:20};
export function getEffectiveLocationSnapshot(){return SNAP;}export function subscribeEffectiveLocation(){return ()=>{};}
export async function ensureEffectiveLocationBootstrap(){return SNAP;}`,
  "@/lib/home-weather-bootstrap": `const ST={weather:{available:true,city:'京都',temp:18,tempMin:12,tempMax:21,condition:'晴',summary:'晴朗',icon:'clear-day',precipProb:10,humidity:50,windSpeed:2,uvIndex:3,feelsLike:18,updatedAt:'2026-10-31T00:00:00Z'},
 status:'ready',error:null,userLocation:{lat:35.01,lng:135.76,city:'京都'},usedFallbackLocation:false,locationPermission:'granted'};
export function subscribeHomeWeatherBootstrap(){return ()=>{};}export function getHomeWeatherBootstrapState(){return ST;}
export function ensureHomeWeatherBootstrap(){}export function refreshHomeWeatherInBackground(){}
export function ensureHomeWeatherLocationWatch(){return ()=>{};}export function subscribeHomeWeatherLocationWatch(){return ()=>{};}
export function reloadHomeWeatherBootstrap(){}`,
  "@/lib/ai/stream-client": `export * from '${abs("src/lib/ai/stream-client.ts")}';${cnt}
export async function streamRoamieAI(){C('ai:streamRoamieAI');throw new Error('verify: AI offline');}
export async function fetchRoamieAI(){C('ai:fetchRoamieAI');throw new Error('verify: AI offline');}`,
  "@/lib/ai/itinerary-transport": `export * from '${abs("src/lib/ai/itinerary-transport.ts")}';${cnt}
export async function generateItineraryViaNativeApi(){C('ai:generateItineraryViaNativeApi');throw new Error('verify: AI offline');}`,
  "@/lib/credits": `export * from '${abs("src/lib/credits/index.ts")}';${cnt}
export async function fetchCreditAccount(){C('credits:fetchAccount');return null;}
export async function beginPlaceRecommendationCredits(){C('credits:beginPlace');return {ok:true,handle:null};}
export async function beginItineraryGenerationCredits(){C('credits:beginItinerary');return {ok:true,handle:null};}
export async function beginCreditsOperation(){C('credits:begin');return {ok:true,handle:null};}
export async function checkCreditsAvailability(){C('credits:check');return {ok:true};}
export async function settleCreditsOperation(){C('credits:settle');}
export async function resolveCreditsGreeting(copy){return {content:copy.stage1,stage:'stage1'};}`,
  "@/lib/ai/ai-itinerary-state-machine": `export * from '${abs("src/lib/ai/ai-itinerary-state-machine.ts")}';${cnt}
export async function prepareDirectItineraryFlow(args){C('gen:prepareDirectItineraryFlow');return window.__genCtl.step('prepare',args);}
export async function createItineraryFromSession(args){C('gen:createItineraryFromSession');return window.__genCtl.step('create',args);}`,
  "@/lib/ai/itinerary-place-fetch": `export * from '${abs("src/lib/ai/itinerary-place-fetch.ts")}';${cnt}
export async function prepareDirectItinerarySession(args){C('places:prepareDirectItinerarySession');return window.__placesPrepImpl?window.__placesPrepImpl(args):{ok:true,session:args.session};}`,
  "@/lib/itinerary-storage": `export * from '${abs("src/lib/itinerary-storage.ts")}';${cnt}
export async function confirmSaveTrip(payload){C('save:confirmSaveTrip');if(window.__saveHook)await window.__saveHook();(window.__saved||(window.__saved=[])).push(payload&&payload.destination);const now=new Date().toISOString();
 return {id:'trip-'+(payload&&payload.destination),title:payload.title,payload,created_at:now,updated_at:now,cover_image:null,mood:null,is_title_customized:false,custom_title:null};}
export async function updateTripMeta(){C('save:updateTripMeta');return null;}`,
  "@/services/routesService": `export * from '${abs("src/services/routesService.ts")}';${cnt}
export async function getTripLegsWithDurations(){C('routes:getTripLegsWithDurations');return [];}`,
  // #L1-T2：推薦頁資料（window.__rec）
  "@/lib/recommendation-storage": `export * from '${abs("src/lib/recommendation-storage.ts")}';${cnt}
export async function getRecommendation(){C('data:getRecommendation');return window.__rec||null;}`,
  "@/services/placeImageService": `export * from '${abs("src/services/placeImageService.ts")}';${cnt}
export async function getTripCoverImage(){C('image:getTripCoverImage');return {url:'/img/cover.png',source:'default',query:''};}`,
  // #L1-T2：記錄 toast（含 action），供「行程已完成」提示與「查看」按鈕斷言；不產生 DOM（與原本相同）
  // #L1-T4：window.__toastThrow＝true 時 toast.error 記錄後丟出例外（驗證通知例外不阻斷 Credits settle；未設定時與原本相同）
  sonner: `const rec=(kind)=>(m,o)=>{(window.__toasts||(window.__toasts=[])).push({kind,m:String(m),o:o||null});if(kind==='error'&&window.__toastThrow){window.__toastThrown=(window.__toastThrown||0)+1;throw new Error('verify: toast.error threw');}};
export const toast=Object.assign(rec('toast'),{success:rec('success'),error:rec('error'),info:rec('info'),warning:rec('warning'),message:rec('message'),dismiss(){}});export const Toaster=()=>null;`,
};

const entry = String.raw`import React,{StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Route as ChatRoute} from '@/routes/_app.chat';
import {Route as HomeRoute} from '@/routes/_app.index';
import {ChatComposer} from '@/components/chat/ChatComposer';
import {setTestLocale} from '@/hooks/use-i18n';
import {setHomeRouteVisible} from '@/lib/home-route-active';
import {translate} from '@/lib/i18n/translate';
import {prepareTripDateConfirmation} from '@/lib/ai/trip-date-confirmation';
import {saveChatSession,createEmptySession} from '@/lib/chat-session';
import {saveChatUiCache} from '@/lib/chat-ui-cache';
import {beginHomeMoodShortcutSession} from '@/lib/home-mood-shortcut-session';
import {buildTripAddPlaceContext,writeTripAddPlaceHandoff} from '@/lib/trip/trip-add-place-handoff';
import {preparePlanTripSession} from '@/lib/plan-trip-handoff';
import {CREDITS_RESERVE_STALE_MAX_AGE_MS} from '@/lib/credits/constants';
import {saveConversationWorkspace,CONVERSATION_WORKSPACE_SCHEMA_VERSION} from '@/lib/conversation-workspace';
import {preserveChatUiForPlaceDetail} from '@/lib/chat-ui-cache';
import {Route as RecRoute} from '@/routes/_app.recommendations';
import {Route as PlanRoute} from '@/routes/_app.plan';
import {Route as PlaceRoute} from '@/routes/_app.place';
import {SavedTripItineraryEditor} from '@/components/saved/SavedTripItineraryEditor';
import {beginChatGenerationLock,endChatGenerationLock,isChatGenerationLocked} from '@/lib/ai/chat-generation-lock';
window.isGenLocked=()=>isChatGenerationLocked();
import {setPlaceDetailHandoff} from '@/lib/place-detail-handoff';
import {savePlanFormDraft} from '@/lib/plan-form-draft-storage';
// #L1-T2 helpers
window.lockGen=(o)=>{beginChatGenerationLock(o);return true;};window.unlockGen=(o)=>{endChatGenerationLock(o);return true;};
const ENTRY_PAGES={rec:()=>RecRoute.options.component,plan:()=>PlanRoute.options.component,place:()=>PlaceRoute.options.component,editor:()=>function Ed(){return <SavedTripItineraryEditor stored={window.__editorStored}/>;}};
window.ENTRY_PAGES=ENTRY_PAGES;
window.seedEntry=(kind)=>{
 if(kind==='rec'){window.__rec={id:'rec-1',title:'京都咖啡',mood:'咖啡',cover_image:null,created_at:'2026-10-01T00:00:00Z',generatedLocale:'zh-TW',
  payload:{version:2,title:'京都咖啡',summary:'s',destination:'京都',days:1,moodTag:'',itinerary:[],recommendations:[{name:'A 咖啡',type:'cafe',reason:'r',address:'京都',lat:35.0,lng:135.76,googlePlaceId:'ChIJcafeA'}]}};
  return {key:'/_app/recommendations',search:{id:'rec-1'}};}
 if(kind==='plan'){savePlanFormDraft({destination:{displayLabel:'京都',city:'京都',formattedName:'京都',placeId:'ChIJkyoto',country:'日本',countryCode:'JP',lat:35.01,lng:135.76},origin:null,budgetMode:'',styles:[],mood:'',startDate:'2026-12-01',endDate:'2026-12-03',travelers:2,travelersCustom:false,transport:''});
  return {key:'/_app/plan',search:{}};}
 if(kind==='place'){setPlaceDetailHandoff({placeId:'ChIJplace',googlePlaceId:'ChIJplace',name:'清水寺',address:'京都市東山區',lat:34.99,lng:135.78,rating:4.6,userRatingCount:100,category:'tourist_attraction',recommendationSource:'map'});
  return {key:'/_app/place',search:{placeId:'ChIJplace',lat:34.99,lng:135.78}};}
 if(kind==='editor'){const payload={version:2,title:'京都 3 日',destination:'京都',days:3,summary:'',recommendations:[],moodTag:'',
  destinationLocation:{displayLabel:'京都',city:'京都',formattedName:'京都',placeId:'ChIJkyoto',country:'日本',lat:35.01,lng:135.76},
  itinerary:[{day:1,date:'2026-12-01',time:'10:00',title:'清水寺',placeName:'清水寺',description:'',lat:34.99,lng:135.78}],tripSettings:{tripStartDate:'2026-12-01',tripEndDate:'2026-12-03'}};
  window.__editorStored={id:'7b0c4c52-1d0e-4c3f-9a51-1b7f7a2f6e11',title:'京都 3 日',payload,created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',cover_image:null,mood:null,is_title_customized:false,custom_title:null};
  return {key:'/_app/saved/$tripId',search:{}};}
 throw new Error('unknown entry '+kind);};
window.clickByText=(txt)=>{const bs=[...document.querySelectorAll('#page button')].filter(b=>b.textContent.trim()===txt||b.textContent.includes(txt));const b=bs[bs.length-1];if(!b)return 'none';if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
window.buttonTexts=()=>[...document.querySelectorAll('#page button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0,60);
window.toasts=()=>(window.__toasts||[]).map(t=>({kind:t.kind,m:t.m,action:t.o&&t.o.action?String(t.o.action.label):null,duration:t.o?t.o.duration:undefined}));
window.clickToastAction=(i)=>{const t=(window.__toasts||[])[i];if(!t||!t.o||!t.o.action)return 'none';t.o.action.onClick({preventDefault(){},stopPropagation(){}});return 'clicked';};
window.storedSession=()=>{try{const s=JSON.parse(sessionStorage.getItem('roamie:chat-planning')||'{}');return {planningSessionId:s.planningSessionId||null,phase:s.phase||null,aiItineraryState:s.aiItineraryState||null,lastGeneratedTripId:s.lastGeneratedTripId||null,dest:(s.travelContext&&s.travelContext.destination)||null,workspaceId:s.workspaceId||null};}catch{return null;}};
window.seedWorkspaceFromCurrent=(id)=>{const s=JSON.parse(sessionStorage.getItem('roamie:chat-planning')||'null');if(!s)throw new Error('no live session');const now=new Date().toISOString();
 saveConversationWorkspace({schemaVersion:CONVERSATION_WORKSPACE_SCHEMA_VERSION,workspaceId:id,conversationId:'conv-'+id,title:'大阪',destination:'大阪',planningSession:s,
  messages:[{role:'user',content:'幫我排大阪三天'},{role:'assistant',content:'行程生成中'}],status:'draft',createdAt:now,updatedAt:now},null);return s.planningSessionId;};
window.preservePlaceDetailUi=()=>{preserveChatUiForPlaceDetail([{role:'user',content:'幫我排大阪三天'},{role:'assistant',content:'請告訴我日期'}],0);return true;};
window.clearChatButton=()=>{const lbl=translate(window.__locale||'zh-TW','chat.clearAria');const b=document.querySelector('#page header button[aria-label="'+lbl+'"]');return b?{disabled:b.disabled}:null;};
window.clickClearChat=()=>{const lbl=translate(window.__locale||'zh-TW','chat.clearAria');const b=document.querySelector('#page header button[aria-label="'+lbl+'"]');if(!b)return 'none';if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
window.confirmClearChat=()=>{const d=document.querySelector('[role="alertdialog"]');if(!d)return 'no-dialog';const bs=[...d.querySelectorAll('button')];const b=bs[bs.length-1];if(!b||b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
// #L1-T3 helpers：完整 toast（含 id）、裝置語系切換（真實 App：useI18n 與 effectiveAppLocale 都跟隨 navigator.language）
window.toastsFull=()=>(window.__toasts||[]).map(t=>({kind:t.kind,m:t.m,id:t.o&&t.o.id!=null?String(t.o.id):null,action:t.o&&t.o.action?String(t.o.action.label):null}));
window.setDeviceLocale=(l)=>{const lang={'zh-TW':'zh-TW',en:'en-US',ja:'ja-JP',ko:'ko-KR'}[l];Object.defineProperty(navigator,'language',{get:()=>lang,configurable:true});flushSync(()=>setTestLocale(l));return navigator.language;};
window.callLogLen=()=>(window.__callLog||[]).length;
window.callLogFrom=(n)=>(window.__callLog||[]).slice(n);
window.__logs=[];const L=(t)=>(...a)=>{try{window.__logs.push(t+' '+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,300));if(window.__logs.length>4000)window.__logs.splice(0,2000);}catch{}};
console.info=L('info');console.debug=()=>{};console.log=L('log');console.warn=L('warn');
window.CREDITS_RESERVE_STALE_MAX_AGE_MS=CREDITS_RESERVE_STALE_MAX_AGE_MS;
window.tr=(l,k,v)=>translate(l,k,v);
let setApp=null;
function App(){const [st,setSt]=useState({page:'none',key:0,props:null});setApp=setSt;
 if(st.page==='none')return null;
 if(st.page==='composer')return <div id="page" key={st.key} className="messenger-chat-composer"><ChatComposer {...st.props}/></div>;
 if(window.ENTRY_PAGES&&window.ENTRY_PAGES[st.page]){const E=window.ENTRY_PAGES[st.page]();return <div id="page" key={st.key}><E/></div>;}
 const C=st.page==='chat'?ChatRoute.options.component:HomeRoute.options.component;return <div id="page" key={st.key}><C/></div>;}
const rootEl=createRoot(document.getElementById('root'));
flushSync(()=>rootEl.render(<StrictMode><App/></StrictMode>));
window.show=(page,search)=>{window.__search={'/_app/chat':page==='chat'?(search||{}):{},'/_app/':{}};window.__path=page==='chat'?'/chat':page==='home'?'/':'/x';
 setHomeRouteVisible(page==='home');flushSync(()=>setApp(s=>({page,key:s.key+1,props:null})));return true;};
window.showEntry=(page,key,search)=>{window.__search={[key]:search||{}};window.__path=key.replace('/_app','')||'/';setHomeRouteVisible(false);flushSync(()=>setApp(s=>({page,key:s.key+1,props:null})));return true;};
window.showComposer=(o)=>{const p={text:o.text||'',onTextChange(){},onSend(){},onKeyDown(){},onFocus(){},disabled:!!o.disabled,showShortcutChips:true,keyboardOpen:false,inputRef:{current:null},streaming:false,generating:!!o.generating,onChipSend(){},actionChips:[]};
 flushSync(()=>setApp(s=>({page:'composer',key:s.key+1,props:p})));return true;};
window.setLocale=(l)=>{flushSync(()=>setTestLocale(l));return true;};
const DAY='2026/12/01-2026/12/03';window.DATE_TEXT=DAY;
window.seedTrip=(dest)=>{const base={...createEmptySession(),phase:'ready',planningSessionId:'plan-'+dest,
 travelContext:{destination:dest,days:3,interests:[]},tripDays:3,tripDestination:{displayLabel:dest,city:dest,formattedName:dest,placeId:'ChIJ'+dest,country:'日本',countryCode:'JP',lat:34.69,lng:135.5}};
 const s=prepareTripDateConfirmation(base,{entry:'direct'});if(!s)throw new Error('seed failed');saveChatSession(s);
 saveChatUiCache({msgs:[{role:'user',content:'幫我排'+dest+'三天'},{role:'assistant',content:'請告訴我日期'}],scrollTop:0});return true;};
window.seedHomeMood=()=>{const moodId='coffee';saveChatSession(beginHomeMoodShortcutSession(createEmptySession(),translate(window.__locale||'zh-TW','home.moods.'+moodId),moodId));
 return {mood:moodId,from:'mood',prompt:translate(window.__locale||'zh-TW','home.moodPrompts.'+moodId)};};
window.seedTripAddPlace=()=>{const payload={version:2,title:'京都 3 日',destination:'京都',days:3,summary:'',recommendations:[],moodTag:'',
 destinationLocation:{displayLabel:'京都',city:'京都',formattedName:'京都',placeId:'ChIJkyoto',country:'日本',lat:35.01,lng:135.76},
 itinerary:[{day:1,date:'2026-12-01',time:'10:00',title:'清水寺',placeName:'清水寺',description:'',lat:34.99,lng:135.78}],tripSettings:{tripStartDate:'2026-12-01',tripEndDate:'2026-12-03'}};
 const stored={id:'trip-kyoto',title:'京都 3 日',payload,created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z'};
 writeTripAddPlaceHandoff(buildTripAddPlaceContext({stored,payload,settings:payload.tripSettings,dayIndex:0,selectedDay:1,dateKey:'2026-12-01',dayItems:payload.itinerary,dayCount:3}));
 return {from:'trip_add_place',tripId:'trip-kyoto',day:1};};
window.seedPlan=()=>{const dest={displayLabel:'京都',city:'京都',formattedName:'京都',placeId:'ChIJkyoto',country:'日本',countryCode:'JP',lat:35.01,lng:135.76};
 const s=preparePlanTripSession({destination:dest,origin:null,days:3,mood:'',styles:[],startDate:'2026-12-01',endDate:'2026-12-03',departureTime:'',transport:'',selectedPlaces:[]},
  {location:{lat:35.01,lng:135.76,city:'京都'},weather:null,preferences:{}},{onboarded:true},{planAiMode:false});saveChatSession(s);return {from:'plan'};};
const okPayload=(dest)=>({version:2,title:dest+' 三日遊',summary:'s',destination:dest,days:3,moodTag:'',recommendations:[],
 itinerary:[1,2,3].map(d=>({day:d,date:'2026-12-0'+d,time:'10:00',title:dest+' 景點 '+d,name:dest+' 景點 '+d,placeName:dest+' 景點 '+d,description:'d',lat:34.68+d*0.01,lng:135.5,googlePlaceId:'ChIJspot'+d})),tripSettings:{}});
window.__genCtl={deferAt:'create',pending:[],step(stage,args){if(stage==='prepare'){window.__genStartedAt=window.__clock.now();window.__lastGenId=args.context&&args.context.generationRequestId;}if(stage!==this.deferAt){return stage==='prepare'?{ok:true,session:args.session}:{ok:true,state:'SUCCESS',session:{...args.session,aiItineraryState:'SUCCESS'},payload:okPayload(args.session.travelContext.destination)};}
 return new Promise((res,rej)=>this.pending.push({stage,args,res,rej,dest:args.session.travelContext&&args.session.travelContext.destination}));}};
window.gen={pending:()=>window.__genCtl.pending.map(p=>p.dest+':'+p.stage),deferAt:(s)=>{window.__genCtl.deferAt=s;return true;},
 resolve:(kind)=>{const p=window.__genCtl.pending.shift();if(!p)throw new Error('no pending generation');const s=p.args.session;const dest=s.travelContext.destination;
 if(kind==='throw')p.rej(new TypeError('Failed to fetch'));
 else if(p.stage==='prepare')p.res(kind==='fail'?{ok:false,session:s,message:'生成失敗測試',failureReason:'verify'}:{ok:true,session:s});
 else p.res(kind==='fail'?{ok:false,state:'FAILED',session:{...s,phase:'ready',aiItineraryState:'FAILED'},message:'生成失敗測試',offerMustVisit:false}:{ok:true,state:'SUCCESS',session:{...s,aiItineraryState:'SUCCESS'},payload:okPayload(dest)});return dest;}};
// #L1-T4：prepare 停住後以特製 Session 完成（capacity＝16 個已接受的必去點、3 天上限 15；entryBlocked＝canGenerateItinerary 為 false；
//   noDates＝移除 dateProvenance，觸發 handleGenerateItinerary 開頭的 pauseForTripDates）
const CAP_NAMES=['大阪城','通天閣','海遊館','道頓堀','心齋橋','黑門市場','新世界','梅田藍天大廈','天王寺動物園','住吉大社','四天王寺','中之島公園','萬博紀念公園','大阪歷史博物館','日本環球影城','阿倍野展望台'];
window.gen.resolveCustom=(kind)=>{const p=window.__genCtl.pending.shift();if(!p)throw new Error('no pending generation');const s=p.args.session;
 if(kind==='offerMustVisit'){if(p.stage!=='create')throw new Error('offerMustVisit 需停在 create');p.res({ok:false,state:'FAILED',session:{...s,phase:'ready',aiItineraryState:'FAILED'},message:'必去景點太多測試',offerMustVisit:true});return s.travelContext.destination;}
 if(p.stage!=='prepare')throw new Error('resolveCustom 需停在 prepare：'+p.stage);
 if(kind==='capacity'){const places=CAP_NAMES.map((n,i)=>({id:'ChIJcap'+i,name:n,placeName:n,googlePlaceId:'ChIJcap'+i,placeId:'ChIJcap'+i,type:'attraction',category:'attraction',types:['tourist_attraction'],reason:'必去',address:'大阪市'+n,lat:34.66+i*0.004,lng:135.49+i*0.003}));
  p.res({ok:true,session:{...s,selectedPlaces:places,planningConstraints:{mustIncludePlaces:[],excludedPlaces:[],preferredPlaceTypes:[],excludedPlaceTypes:[],cuisinePreferences:[],activityPreferences:[],attractionPreferences:[],areaPreferences:[],acceptedCandidateIds:places.map(x=>x.googlePlaceId),rejectedCandidateIds:[],clarificationRequired:false,unresolvedEntities:[]}}});}
 else if(kind==='entryBlocked')p.res({ok:true,session:{...s,tripDays:0,selectedPlaces:[]}});
 else if(kind==='noDates'){const tc={...s.travelContext};delete tc.dateProvenance;p.res({ok:true,session:{...s,travelContext:tc}});}
 else throw new Error('unknown custom '+kind);return s.travelContext.destination;};
// #L1-T4：抓聊聊實例的 useRef 物件（React fiber hook 鏈），之後可在保存途中讓 ownership 失效（activeGenerationRequestIdRef 改成別的 id）
window.captureChatRefs=()=>{const page=document.getElementById('page');const k=page&&Object.keys(page).find(x=>x.startsWith('__reactFiber$'));if(!k)return 0;const refs=[];
 const walk=(f,d)=>{for(let c=f;c;c=c.sibling){if(typeof c.type==='function'){for(let h=c.memoizedState;h;h=h.next){const v=h.memoizedState;if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&'current' in v)refs.push(v);}}if(d<2&&c.child)walk(c.child,d+1);}};
 walk(page[k].child,0);window.__chatRefs=refs;return refs.length;};
window.invalidateOwnership=()=>{const gid=window.__lastGenId;let n=0;if(!gid)return 0;for(const r of window.__chatRefs||[]){if(r.current===gid){r.current='verify-superseded:'+gid;n++;}}window.__invalidated=(window.__invalidated||0)+n;return n;};
window.logMark=()=>{window.__logs.push('__mark__');return true;};
window.logsSinceMark=()=>{const i=window.__logs.lastIndexOf('__mark__');return i<0?window.__logs.slice():window.__logs.slice(i+1);};
const q=(s)=>document.querySelector(s);const qa=(s)=>[...document.querySelectorAll(s)];
window.ui=()=>{const comp=q('#page .messenger-chat-composer')||q('#page.messenger-chat-composer');const ta=comp&&comp.querySelector('textarea');if(!ta)return null;
 const chips=[...comp.querySelectorAll('button')].filter(b=>!b.closest('.chat-input-row')).map(b=>({label:b.textContent.trim(),disabled:b.disabled}));
 const send=comp.querySelector('.chat-input-row button');
 const attrs=[...comp.querySelectorAll('*')].flatMap(e=>['placeholder','aria-label','title','aria-description'].map(a=>e.getAttribute(a)).filter(Boolean));
 return {disabled:ta.disabled,placeholder:ta.placeholder,value:ta.value,chips,sendDisabled:send?send.disabled:null,composerText:(comp.innerText+'\n'+attrs.join('\n'))};};
window.msgs=()=>qa('#page [data-chat-message-id]').map(e=>e.innerText.trim());
window.pageText=()=>{const p=q('#page');return p?p.innerText:'';};
window.counts=()=>({...(window.__counts||{})});
window.navs=()=>(window.__nav||[]).slice();
window.typeAndEnter=(txt)=>{const ta=q('#page .messenger-chat-composer textarea');if(!ta)return 'no-textarea';if(ta.disabled)return 'disabled';
 const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
 flushSync(()=>{set.call(ta,txt);ta.dispatchEvent(new Event('input',{bubbles:true}));});
 flushSync(()=>ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true})));return 'sent';};
window.clickSendButton=()=>{const b=q('#page .chat-input-row button');if(!b)return 'none';if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
window.clickChip=(i)=>{const comp=q('#page .messenger-chat-composer');const bs=[...comp.querySelectorAll('button')].filter(b=>!b.closest('.chat-input-row'));const b=bs[i];if(!b)return 'none';
 if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
window.storage=()=>{const o={};for(const [n,s] of [['s',sessionStorage],['l',localStorage]])for(let i=0;i<s.length;i++){const k=s.key(i);o[n+':'+k]=s.getItem(k);}return o;};
window.chatSessionId=()=>{try{const s=JSON.parse(sessionStorage.getItem('roamie:chat-planning')||'{}');return {planningSessionId:s.planningSessionId||null,conversationId:s.conversationId||null,dest:(s.travelContext&&s.travelContext.destination)||null,phase:s.phase||null};}catch{return null;}};
window.homeMoodButtons=()=>qa('#page .app-h-scroll-track button').map(b=>({label:b.innerText.trim(),disabled:b.disabled}));
window.clickHomeMood=(i)=>{const b=qa('#page .app-h-scroll-track button')[i];if(!b)return 'none';if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
window.clickHomeChatCard=()=>{const a=qa('#page a').find(a=>a.getAttribute('href')==='/chat');if(!a)return 'none';if(a.getAttribute('aria-disabled')==='true'||a.hasAttribute('disabled'))return 'disabled';flushSync(()=>a.click());return 'clicked';};
window.settle=async(n=6)=>{for(let i=0;i<n;i++){await new Promise(r=>setTimeout(r,25));}return true;};
window.__ready=true;`;

// 頁面載入前：fetch 計數、假時鐘、登入狀態、storage 清空（#keep 時保留，用於重新載入情境）
const headScript = String.raw`<script>(function(){
const C=(k)=>{const c=(window.__counts||(window.__counts={}));c[k]=(c[k]||0)+1;(window.__callLog||(window.__callLog=[])).push(k);};
window.fetch=async function(i){const u=typeof i==='string'?i:(i&&i.url)||String(i);C('fetch');(window.__fetches||(window.__fetches=[])).push(u);return new Response('{}',{status:404,headers:{'content-type':'application/json'}});};
const RD=Date,rST=window.setTimeout.bind(window),rCT=window.clearTimeout.bind(window),rSI=window.setInterval.bind(window),rCI=window.clearInterval.bind(window),rPN=performance.now.bind(performance);
let off=0;const V=new Map();let seq=1e9;const TH=1000;
function FDate(...a){if(!new.target)return new RD(RD.now()+off).toString();return a.length?new RD(...a):new RD(RD.now()+off);}
FDate.prototype=RD.prototype;FDate.now=()=>RD.now()+off;FDate.parse=RD.parse;FDate.UTC=RD.UTC;Object.setPrototypeOf(FDate,RD);window.Date=FDate;
performance.now=()=>rPN()+off;
window.setTimeout=function(fn,ms,...args){ms=Number(ms)||0;if(ms<TH)return rST(fn,ms,...args);const id=++seq;V.set(id,{fn,args,due:FDate.now()+ms,iv:0});return id;};
window.setInterval=function(fn,ms,...args){ms=Number(ms)||0;if(ms<TH)return rSI(fn,ms,...args);const id=++seq;V.set(id,{fn,args,due:FDate.now()+ms,iv:ms});return id;};
window.clearTimeout=function(id){if(V.has(id))V.delete(id);else rCT(id);};
window.clearInterval=function(id){if(V.has(id))V.delete(id);else rCI(id);};
window.__clock={now:()=>FDate.now(),advance(ms){const target=FDate.now()+ms;for(let g=0;g<200000;g++){let nx=null;for(const e of V){if(e[1].due<=target&&(!nx||e[1].due<nx[1].due))nx=e;}if(!nx)break;
 const id=nx[0],t=nx[1];off+=Math.max(0,t.due-FDate.now());if(t.iv)t.due+=t.iv;else V.delete(id);try{typeof t.fn==='function'?t.fn(...t.args):0;}catch(e){(window.__clockErrors||(window.__clockErrors=[])).push(String(e));}}
 off+=Math.max(0,target-FDate.now());return FDate.now();}};
if(location.hash!=='#keep'){sessionStorage.clear();localStorage.clear();}
localStorage.setItem('roamie-auth',JSON.stringify({user:{id:'u1'}}));
})();</script>`;

const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

if (!chromeBin) {
  failures.push("無可用 Chrome");
  console.log("FAIL 無可用 Chrome，未執行 Part B");
} else {
  await run();
}

async function run() {
  const { build } = await import("esbuild");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-chat-lock-"));
  const bundle = async (variant) => {
    const outfile = path.join(dir, `app-${variant}.js`);
    await build({
      stdin: { contents: entry, resolveDir: root, loader: "tsx" },
      bundle: true,
      logLevel: "error",
      outfile,
      format: "iife",
      jsx: "automatic",
      jsxDev: true,
      platform: "browser",
      alias: { "@": path.join(root, "src") },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".woff2": "empty", ".woff": "empty", ".css": "empty" },
      define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development","SSR":false}', "process.env.NODE_ENV": '"development"' },
      plugins: [
        {
          name: "mocks",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
            b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
            if (variant === "cur" && REF) {
              b.onResolve({ filter: /^@\/lib\/ai\/chat-generation-lock$/ }, () => ({ path: "ref-lock", namespace: "reflock" }));
              b.onLoad({ filter: /.*/, namespace: "reflock" }, () => ({ contents: REF_LOCK_MODULE_USED, loader: "tsx", resolveDir: root }));
              b.onLoad({ filter: /src[\\/](routes[\\/]_app\.(chat|index)|components[\\/]chat[\\/]ChatComposer)\.tsx$/ }, (a) => ({
                contents: refPatched(path.relative(root, a.path).split(path.sep).join("/")),
                loader: "tsx",
                resolveDir: path.dirname(a.path),
              }));
            }
            if (variant === "base" && baseline)
              b.onLoad({ filter: /src[\\/](routes[\\/]_app\.(chat|index)|components[\\/]chat[\\/]ChatComposer)\.tsx$/ }, (a) =>
                baseline[a.path] != null ? { contents: baseline[a.path], loader: "tsx", resolveDir: path.dirname(a.path) } : null,
              );
            // server fn 依模組名稱計數（Places／AI／天氣分類用）
            b.onLoad({ filter: /src[\\/](lib[\\/].*\.functions|lib[\\/]ai[\\/]destination-provider-log|routes[\\/]api[\\/]generate-itinerary)\.ts$/ }, (a) => ({
              contents: `globalThis.__sfMod=${JSON.stringify(path.basename(a.path, ".ts"))};\n` + fs.readFileSync(a.path, "utf8"),
              loader: "ts",
              resolveDir: path.dirname(a.path),
            }));
          },
        },
      ],
    });
    return outfile;
  };
  await bundle("cur");
  if (baseline) await bundle("base");

  const server = http.createServer((req, res) => {
    const u = req.url || "/";
    if (u.startsWith("/app-")) {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, u.slice(1).split("?")[0])));
      return;
    }
    if (u.startsWith("/img") || u.startsWith("/api/")) {
      res.statusCode = 404;
      res.end("");
      return;
    }
    const js = new URL(u, "http://x").searchParams.get("v") === "base" ? "/app-base.js" : "/app-cur.js";
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + headScript + '</head><body style="margin:0"><div id="root"></div><script src="' + js + '"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const chrome = spawn(chromeBin, ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let ws;
  const externalRequests = [];
  const browserErrors = [];
  let label = "load";
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let out = "";
      chrome.stderr.on("data", (b) => {
        out += b;
        const m = out.match(/DevTools listening on (ws:\/\/\S+)/);
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
      if (r.method === "Runtime.exceptionThrown") browserErrors.push(`[${label}] ` + (r.params.exceptionDetails.exception?.description ?? r.params.exceptionDetails.text));
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
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });
    const { targetInfos } = await send("Target.getTargets");
    const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const ev = (fn, ...args) => evaluate(`window.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    await call("Runtime.enable");
    await call("Network.enable");

    const load = async (opts = {}) => {
      label = opts.label ?? "load";
      const url = `http://127.0.0.1:${port}/?v=${opts.variant ?? "cur"}&n=${Math.random()}${opts.keep ? "#keep" : ""}`;
      await call("Page.navigate", { url });
      for (let i = 0; i < 200; i++) {
        if (await evaluate("!!window.__ready").catch(() => false)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.slice(-3).join("\n"));
    };
    const settle = (n = 6) => ev("settle", n);
    const waitFor = async (expr, ms = 4000) => {
      const t = Date.now();
      while (Date.now() - t < ms) {
        if (await evaluate(expr).catch(() => false)) return true;
        await new Promise((r) => setTimeout(r, 40));
      }
      return false;
    };
    const waitHydrated = async () => {
      const ok = await waitFor("!!window.ui()", 4000);
      await settle(10);
      return ok;
    };
    const ui = () => ev("ui");
    const counts = () => ev("counts");
    const navs = () => ev("navs");
    const isReq = (k) =>
      /^(ai:|gen:|places:|save:|routes:|rpc:|fetch$)/.test(k) || (/^credits:/.test(k) && k !== "credits:fetchAccount") || (/^sf:/.test(k) && k !== "sf:weather.functions");
    const reqDelta = (a, b) => {
      const d = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const v = (b[k] ?? 0) - (a[k] ?? 0);
        if (v && isReq(k)) d[k] = v;
      }
      return d;
    };
    const lockedZh = (u) => !!u && u.disabled === true && String(u.placeholder).includes(LOCK_ZH);
    const descUi = (u) => (u ? JSON.stringify({ disabled: u.disabled, placeholder: u.placeholder, sendDisabled: u.sendDisabled, chips: u.chips.map((c) => (c.disabled ? "x" : "o") + c.label) }) : "null");
    const tripNavs = (list) => list.filter((n) => n && ((n.params && n.params.tripId) || /saved/.test(String(n.to))));
    const chatKeys = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => /chat|workspace|conversation/i.test(k)));
    const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

    // 原聊聊（A）：日期確認 Session → 輸入日期 Enter → 生成（停在 deferAt 階段）
    const startGeneration = async (dest = "大阪", deferAt = "create") => {
      await ev("gen.deferAt", deferAt);
      await ev("seedTrip", dest);
      await ev("show", "chat", {});
      await waitHydrated();
      const before = (await evaluate("window.gen.pending()")).length;
      const r = await ev("typeAndEnter", await evaluate("window.DATE_TEXT"));
      const ok = await waitFor(`window.gen.pending().length > ${before}`, 5000);
      assert.ok(ok, `生成未開始（typeAndEnter=${r}）；ui=${descUi(await ui())}`);
      await settle(4);
    };
    const leaveAndOpenNewChat = async (search = {}) => {
      await ev("show", "none");
      await settle(3);
      await ev("show", "chat", search);
      await waitHydrated();
    };
    // 鎖住時嘗試所有輸入框／快捷入口；回傳請求差與嘗試結果
    const tryAllComposerEntries = async () => {
      const c0 = await counts();
      const m0 = await ev("msgs");
      const u0 = await ui();
      const tried = [];
      tried.push("enter:" + (await ev("typeAndEnter", "我想去金澤玩三天")));
      await settle(8);
      tried.push("sendBtn:" + (await ev("clickSendButton")));
      await settle(8);
      for (let i = 0; i < (u0?.chips.length ?? 0); i++) {
        tried.push("chip" + i + ":" + (await ev("clickChip", i)));
        await settle(8);
      }
      await settle(20);
      return { delta: reqDelta(c0, await counts()), tried, msgsBefore: m0, msgsAfter: await ev("msgs"), ui: u0 };
    };

    // ─── B0a：真實 ChatComposer，單純 loading 不被判為鎖住 ───
    await load({ label: "B0" });
    await ev("showComposer", { generating: true, disabled: true });
    const loadingUi = await ui();
    await ev("showComposer", {});
    const idleUi = await ui();
    await check("B0a 對照：真實 ChatComposer generating=true（單純 loading）與閒置都不被判為鎖住（鎖住判定可區分 loading）", () => {
      assert.equal(loadingUi.disabled, true, "loading 時 textarea 應 disabled");
      assert.equal(lockedZh(loadingUi), false, "單純 loading 被誤判為鎖住：" + descUi(loadingUi));
      assert.equal(lockedZh(idleUi), false, "閒置被誤判為鎖住");
    });

    // ─── R7：沒有生成中（一般使用）───
    await load({ label: "R7" });
    await ev("show", "chat", {});
    await waitHydrated();
    const r7Locales = {};
    for (const l of LOCALES) {
      await ev("setLocale", l);
      await settle(2);
      r7Locales[l] = { ui: await ui(), expect: await ev("tr", l, "uiCoverage.chatPlaceholder") };
    }
    await ev("setLocale", "zh-TW");
    await settle(2);
    await check("R7a [7] 未生成：四語系 placeholder＝一般文案、輸入框與快捷可用、無鎖定文案", () => {
      for (const l of LOCALES) {
        const { ui: u, expect } = r7Locales[l];
        assert.ok(u, l + " 找不到輸入框");
        assert.equal(u.disabled, false, l + " 輸入框 disabled");
        assert.equal(u.placeholder, expect, l + " placeholder");
        assert.ok(u.chips.length >= 3 && u.chips.every((c) => !c.disabled), l + " 快捷不可用：" + descUi(u));
        assert.ok(!u.composerText.includes(LOCK_ZH) && !u.composerText.includes(SLOW_ZH), l + " 出現鎖定文案");
      }
    });
    let c0 = await counts();
    let m0 = await ev("msgs");
    const r7Enter = await ev("typeAndEnter", "你好");
    await settle(30);
    let d = reqDelta(c0, await counts());
    let m1 = await ev("msgs");
    await check("R7b [7]＋B0b 未生成：Enter 會送出（使用者訊息出現、請求計數增加；證明計數器能偵測送出）", () => {
      assert.equal(r7Enter, "sent");
      assert.ok(m1.some((t) => t.includes("你好")) && !m0.some((t) => t.includes("你好")), "使用者訊息未出現");
      assert.ok(Object.keys(d).length > 0, "送出後沒有任何請求計數");
    });
    info("R7b 一般送出「你好」的請求：" + JSON.stringify(d));
    c0 = await counts();
    const r7Chip = await ev("clickChip", 0);
    await settle(30);
    d = reqDelta(c0, await counts());
    await check("R7c [7] 未生成：點快捷按鈕會送出", () => {
      assert.equal(r7Chip, "clicked");
      assert.ok(Object.keys(d).length > 0, "點快捷後沒有任何請求");
    });

    // R7 首頁：心情快捷照常導向並寫入 Session
    await load({ label: "R7-home" });
    await ev("show", "home");
    await settle(20);
    const hm = await ev("homeMoodButtons");
    const sess0 = await ev("chatSessionId");
    const nav0 = (await navs()).length;
    const clickR = await ev("clickHomeMood", 0);
    await settle(6);
    const navR = (await navs()).slice(nav0);
    const sess1 = await ev("chatSessionId");
    await check("R7e [7] 未生成：首頁心情快捷照常導向 /chat（帶 prompt）並寫入聊聊 Session", () => {
      assert.ok(hm.length >= 3 && hm.every((b) => !b.disabled), "心情按鈕不可用：" + JSON.stringify(hm));
      assert.equal(clickR, "clicked");
      assert.ok(navR.some((n) => n.to === "/chat" && n.search && n.search.prompt), "未導向 /chat：" + JSON.stringify(navR));
      assert.notDeepEqual(sess1, sess0, "未寫入聊聊 Session");
    });

    // ─── R7d：與改動前 baseline 比對（一般使用完全相同）───
    if (baseline) {
      const scenario = async (variant) => {
        await load({ label: "R7d-" + variant, variant });
        await ev("show", "chat", {});
        await waitHydrated();
        const norm = (h) => h.replace(/«[^»]*»/g, "«id»").replace(/:r[0-9a-z]+:/g, ":rid:").replace(/_r_[0-9a-z]+_/g, "_rid_");
        const html0 = norm(await evaluate("document.getElementById('page').innerHTML"));
        const cA = await counts();
        await ev("typeAndEnter", "你好");
        await settle(30);
        const html1 = norm(await evaluate("document.getElementById('page').innerHTML"));
        const log1 = await evaluate("(window.__callLog||[]).filter(k=>!/^sbfrom:/.test(k))");
        await ev("clickChip", 1);
        await settle(30);
        const html2 = norm(await evaluate("document.getElementById('page').innerHTML"));
        await ev("show", "home");
        await settle(20);
        const home = norm(await evaluate("document.getElementById('page').innerHTML"));
        await ev("clickHomeMood", 1);
        await settle(6);
        return { html0, html1, html2, home, log1, navs: await navs(), cA };
      };
      const cur = await scenario("cur");
      const base = await scenario("base");
      await check("R7d [7] 未生成：聊聊（初始／送出後／點快捷後）與首頁 DOM、請求序列、導向與改動前 baseline 逐字相同", () => {
        for (const k of ["html0", "html1", "html2", "home"]) {
          if (cur[k] !== base[k]) {
            let i = 0;
            while (i < cur[k].length && cur[k][i] === base[k][i]) i++;
            assert.fail(`${k} 不同（第 ${i} 字元）\n 目前：…${cur[k].slice(Math.max(0, i - 80), i + 120)}\n 改動前：…${base[k].slice(Math.max(0, i - 80), i + 120)}`);
          }
        }
        assert.deepEqual(cur.log1, base.log1, "送出時請求序列不同");
        assert.deepEqual(cur.navs, base.navs, "導向不同");
      });
    }

    // 情境中途出錯（例如生成無法開始）時記為 FAIL 並繼續下一個情境
    const scenario = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        failures.push("情境 " + name + " 中斷");
        results.push(["FAIL", "情境 " + name + " 中斷（之後的斷言未執行）：" + String(e?.message ?? e).split("\n")[0]]);
        console.log("FAIL 情境 " + name + " 中斷：" + String(e?.message ?? e).split("\n").slice(0, 4).join(" | "));
      }
    };
    // ─── 情境 A：原聊聊生成中 → 離開 → 新對話 ───
    await scenario("A", async () => {
    await load({ label: "A" });
    await startGeneration("大阪");
    const aUi = await ui();
    await check("A1 [1][3] 原聊聊生成中：輸入格顯示鎖定文案「行程生成中…」（不只是 loading disabled）", () => {
      assert.equal(aUi.disabled, true, "生成中輸入框未 disabled");
      assert.ok(lockedZh(aUi), "未顯示鎖定文案：" + descUi(aUi));
    });
    await leaveAndOpenNewChat({});
    const bUi = await ui();
    await check("L1 [1][5] 離開聊聊（卸載）再開新對話：仍鎖住（輸入框 disabled＋鎖定文案）", () => {
      assert.ok(lockedZh(bUi), "新對話未鎖住：" + descUi(bUi));
    });
    await check("L2a [2] 鎖住時快捷按鈕全部 disabled、送出鈕 disabled", () => {
      assert.ok(bUi.chips.length >= 3, "找不到快捷按鈕");
      assert.deepEqual(bUi.chips.filter((c) => !c.disabled).map((c) => c.label), [], "仍可點的快捷");
      assert.equal(bUi.sendDisabled, true, "送出鈕可點");
    });
    const tryB = await tryAllComposerEntries();
    await check("L2b／L3 [2] 鎖住時 Enter、送出鈕、每個快捷按鈕都不送出（AI／Places／Credits 請求 0、無新使用者訊息）", () => {
      assert.deepEqual(tryB.delta, {}, "送出了請求（嘗試：" + tryB.tried.join(", ") + "）");
      assert.deepEqual(tryB.msgsAfter, tryB.msgsBefore, "新對話多了訊息");
    });
    // 舊生成在新對話中完成（成功）
    const bMsgs = await ev("msgs");
    const bStore = chatKeys(await ev("storage"));
    const bSess = await ev("chatSessionId");
    const nav1 = (await navs()).length;
    const save0 = (await counts())["save:confirmSaveTrip"] ?? 0;
    const lockedBeforeFinish = lockedZh(await ui());
    await ev("gen.resolve", "ok");
    await settle(40);
    const navAfter = (await navs()).slice(nav1);
    const save1 = (await counts())["save:confirmSaveTrip"] ?? 0;
    const bStoreAfter = chatKeys(await ev("storage"));
    const bMsgsAfter = await ev("msgs");
    const bUiAfter = await ui();
    await check("L10a [6] 新對話中舊生成成功：不自動導向舊（大阪）行程頁", () => {
      assert.deepEqual(tripNavs(navAfter), [], "導向了：" + JSON.stringify(navAfter));
    });
    await check("L10b [6] 新對話中舊生成成功：新對話訊息不變、聊聊 store（Session／UI 快取／Workspace）不被寫入", () => {
      assert.deepEqual(bMsgsAfter, bMsgs, "新對話訊息被改動");
      assert.deepEqual(changedKeys(bStore, bStoreAfter), [], "store 被寫入；Session 前＝" + JSON.stringify(bSess) + " 後＝" + JSON.stringify(JSON.parse(bStoreAfter["s:roamie:chat-planning"] ?? "{}").travelContext?.destination ?? null));
    });
    await check("R7h [6][7] 新對話中舊生成成功：行程照原本流程保存（confirmSaveTrip 恰 1 次，大阪；現行為，應維持 PASS）", async () => {
      assert.equal(save1 - save0, 1, "confirmSaveTrip 次數");
      assert.equal((await evaluate("window.__saved||[]")).slice(-1)[0], "大阪");
    });
    await check("L7b [4][5] 新對話中舊生成成功：新對話先鎖住、完成後即時解鎖（不需 remount）", () => {
      assert.ok(lockedBeforeFinish, "完成前未鎖住");
      assert.equal(bUiAfter.disabled, false, "完成後輸入框仍 disabled");
      assert.ok(!bUiAfter.placeholder.includes(LOCK_ZH), "完成後仍顯示鎖定文案");
    });
    c0 = await counts();
    await ev("typeAndEnter", "你好");
    await settle(30);
    d = reqDelta(c0, await counts());
    await check("L7c [4] 解鎖後新對話可正常送出", () => {
      assert.ok(lockedBeforeFinish, "完成前未鎖住（本斷言需先鎖住才有意義）");
      assert.ok(Object.keys(d).length > 0, "解鎖後送出沒有任何請求");
    });

    });
    // ─── 情境 B：新對話中舊生成失敗（Planner ok:false） ───
    await scenario("B", async () => {
    await load({ label: "B" });
    await startGeneration("大阪");
    await leaveAndOpenNewChat({});
    const bLocked = lockedZh(await ui());
    const bMsgs2 = await ev("msgs");
    const bStore2 = chatKeys(await ev("storage"));
    const nav2 = (await navs()).length;
    await ev("gen.resolve", "fail");
    await settle(40);
    const bUi2 = await ui();
    await check("L11 [6] 新對話中舊生成失敗：新對話訊息不變、聊聊 store 不被寫入、不導向", async () => {
      assert.deepEqual(await ev("msgs"), bMsgs2, "新對話訊息被改動");
      assert.deepEqual(changedKeys(bStore2, chatKeys(await ev("storage"))), [], "store 被寫入");
      assert.deepEqual(tripNavs((await navs()).slice(nav2)), []);
    });
    await check("L7d [4] 生成失敗（Planner 回 ok:false）：先鎖住、失敗後解鎖", () => {
      assert.ok(bLocked, "失敗前未鎖住");
      assert.equal(bUi2.disabled, false, "失敗後仍 disabled");
      assert.ok(!bUi2.placeholder.includes(LOCK_ZH), "失敗後仍顯示鎖定文案");
    });

    });
    // ─── 情境 C：網路錯誤（例外）→ 解鎖 ───
    await scenario("C", async () => {
    await load({ label: "C" });
    await startGeneration("大阪");
    await leaveAndOpenNewChat({});
    const cLocked = lockedZh(await ui());
    await ev("gen.resolve", "throw");
    await settle(40);
    const cUi = await ui();
    await check("L7e [4] 生成例外（網路錯誤，createItineraryFromSession reject）：先鎖住、例外後解鎖", () => {
      assert.ok(cLocked, "例外前未鎖住");
      assert.equal(cUi.disabled, false, "例外後仍 disabled");
      assert.ok(!cUi.placeholder.includes(LOCK_ZH), "例外後仍顯示鎖定文案");
    });

    });
    // ─── 情境 D／E：prepare 階段失敗、例外（原聊聊仍在） ───
    for (const [kind, name] of [["fail", "L7f [4] prepare 階段失敗（ok:false）"], ["throw", "L7g [4] prepare 階段例外（網路錯誤）"]]) await scenario("prep-" + kind, async () => {
      await load({ label: "prep-" + kind });
      await startGeneration("大阪", "prepare");
      const locked = lockedZh(await ui());
      await ev("gen.resolve", kind);
      await settle(40);
      const u = await ui();
      const m = await ev("msgs");
      await check(name + "：原聊聊先鎖住、結束後解鎖，失敗訊息照常顯示", () => {
        assert.ok(locked, "結束前未鎖住");
        assert.equal(u.disabled, false, "結束後仍 disabled");
        assert.ok(!u.placeholder.includes(LOCK_ZH), "結束後仍顯示鎖定文案");
        assert.ok(m.length > 3, "失敗訊息未顯示：" + JSON.stringify(m.slice(-2)));
      });
    });

    // ─── 情境 F：仍在原對話時成功 → 照常導向（[7] 現行行為）、且解鎖 ───
    await scenario("F", async () => {
    await load({ label: "F" });
    await startGeneration("大阪");
    const fLocked = lockedZh(await ui());
    const navF = (await navs()).length;
    await ev("gen.resolve", "ok");
    await settle(40);
    const fNav = (await navs()).slice(navF);
    const fUi = await ui();
    await check("R7f [6][7] 仍在原對話時成功：照常導向大阪行程頁（/saved/$tripId，trip-大阪）", () => {
      assert.ok(tripNavs(fNav).some((n) => n.params && n.params.tripId === "trip-大阪"), "未導向：" + JSON.stringify(fNav));
    });
    await check("L7a [4] 原對話成功：先鎖住、成功後解鎖", () => {
      assert.ok(fLocked, "成功前未鎖住");
      assert.equal(fUi.disabled, false);
      assert.ok(!fUi.placeholder.includes(LOCK_ZH));
    });

    });
    // ─── 情境 G：90 秒提示、四語系、5 分鐘強制解鎖、G2 不被 G1 解除 ───
    await scenario("G", async () => {
    await load({ label: "G" });
    await startGeneration("大阪");
    await leaveAndOpenNewChat({});
    const snapLocales = async () => {
      const o = {};
      for (const l of LOCALES) {
        await ev("setLocale", l);
        await settle(2);
        o[l] = { ui: await ui(), normal: await ev("tr", l, "uiCoverage.chatPlaceholder") };
      }
      await ev("setLocale", "zh-TW");
      await settle(2);
      return o;
    };
    // 生成開始（prepareDirectItineraryFlow 被呼叫，即 setGenerating(true) 同一輪）起算的虛擬經過時間
    const advanceTo = (elapsedMs) => evaluate(`window.__clock.advance(Math.max(0, ${elapsedMs} - (window.__clock.now() - window.__genStartedAt)))`);
    const elapsed = () => evaluate("window.__clock.now() - window.__genStartedAt");
    await advanceTo(89000);
    await settle(4);
    const at89 = await snapLocales();
    info("L6a 量測時經過 " + Math.round(await elapsed()) + "ms");
    await advanceTo(91000);
    await settle(4);
    const at91 = await snapLocales();
    await check("L6a [3] 生成 89 秒：鎖住、尚無「比平常久」提示", () => {
      const u = at89["zh-TW"].ui;
      assert.ok(lockedZh(u), "89 秒未鎖住：" + descUi(u));
      assert.ok(!u.composerText.includes(SLOW_ZH), "89 秒就出現提示");
    });
    await check("L6b [3] 生成 91 秒：仍鎖住，且輸入列出現「這次生成比平常久，完成後會通知你」", () => {
      const u = at91["zh-TW"].ui;
      assert.ok(lockedZh(u), "91 秒未鎖住：" + descUi(u));
      assert.ok(u.composerText.includes(SLOW_ZH), "91 秒無提示；輸入列文字：" + u.composerText.slice(0, 200));
    });
    await check("L6c [3] 四語系：鎖定文案與 90 秒提示走 i18n（非 key、非 zh-TW 原文、語系文字正確、不同於一般 placeholder）", () => {
      const script = { en: /^[\x20-\x7E‘-”… ]+$/, ja: /[぀-ヿ]/, ko: /[가-힯]/ };
      for (const l of ["en", "ja", "ko"]) {
        const u89 = at89[l].ui;
        const u91 = at91[l].ui;
        assert.ok(u89 && u89.disabled, l + " 未鎖住");
        const p = u89.placeholder.trim();
        assert.ok(p && p !== at89[l].normal, l + " placeholder 仍是一般文案：" + p);
        assert.ok(!p.includes(LOCK_ZH) && !/^[a-z]+(\.[A-Za-z0-9_]+)+$/.test(p), l + " placeholder 是 zh-TW 或 i18n key：" + p);
        assert.match(p, script[l], l + " placeholder 語系文字不符：" + p);
        const before = new Set(u89.composerText.split("\n").map((s) => s.trim()).filter(Boolean));
        const added = u91.composerText.split("\n").map((s) => s.trim()).filter((s) => s && !before.has(s));
        assert.ok(added.length > 0, l + " 91 秒沒有新增提示");
        for (const s of added) {
          assert.ok(!s.includes(SLOW_ZH) && !/^[a-z]+(\.[A-Za-z0-9_]+)+$/.test(s), l + " 提示是 zh-TW 或 key：" + s);
          assert.match(s, script[l], l + " 提示語系文字不符：" + s);
        }
      }
    });
    const maxMs = await evaluate("window.CREDITS_RESERVE_STALE_MAX_AGE_MS");
    await advanceTo(maxMs - 1000);
    await settle(4);
    const at299 = await ui();
    const el299 = await elapsed();
    await advanceTo(maxMs + 1000);
    await settle(6);
    const at301 = await ui();
    info(`L8a 量測時經過 ${Math.round(el299)}ms／${Math.round(await elapsed())}ms`);
    const pend301 = await evaluate("window.gen.pending()");
    await check(`L8a [4] 強制解鎖＝CREDITS_RESERVE_STALE_MAX_AGE_MS（${maxMs / 1000} 秒）：前 1 秒仍鎖、後 1 秒解鎖（生成仍未結束）`, () => {
      assert.equal(maxMs, 300000, "CREDITS_RESERVE_STALE_MAX_AGE_MS 不是 5 分鐘");
      assert.ok(lockedZh(at299), "299 秒未鎖住：" + descUi(at299));
      assert.deepEqual(pend301, ["大阪:create"], "舊生成應仍在進行");
      assert.equal(at301.disabled, false, "301 秒仍 disabled");
      assert.ok(!at301.placeholder.includes(LOCK_ZH), "301 秒仍顯示鎖定文案");
    });
    // 強制解鎖後在新對話開始 G2（金澤），再讓 G1（大阪）完成
    await ev("show", "none");
    await settle(3);
    await startGeneration("金澤");
    const g2Locked = lockedZh(await ui());
    const navG = (await navs()).length;
    const g1 = await ev("gen.resolve", "ok");
    await settle(40);
    const afterG1 = await ui();
    const navG1 = (await navs()).slice(navG);
    await check("L8b [4][6] 強制解鎖後新生成 G2（金澤）鎖住；舊 G1（大阪）完成不得解除 G2 的鎖、不得導向大阪行程頁", () => {
      assert.equal(g1, "大阪");
      assert.ok(g2Locked, "G2 生成中未鎖住");
      assert.ok(lockedZh(afterG1), "G1 完成後 G2 的鎖被解除：" + descUi(afterG1));
      assert.deepEqual(tripNavs(navG1), [], "導向了：" + JSON.stringify(navG1));
    });
    const g2 = await ev("gen.resolve", "ok");
    await settle(40);
    const navG2 = (await navs()).slice(navG);
    const afterG2 = await ui();
    await check("R7g [6][7] G2（金澤）在原對話完成：照常導向金澤行程頁（現行為，應維持 PASS）", () => {
      assert.equal(g2, "金澤");
      assert.ok(tripNavs(navG2).some((n) => n.params && n.params.tripId === "trip-金澤"), "未導向金澤：" + JSON.stringify(navG2));
    });
    await check("L8c [4] G2 完成後解鎖（G2 完成前必須仍鎖住）", () => {
      assert.ok(lockedZh(afterG1), "G2 完成前未鎖住");
      assert.equal(afterG2.disabled, false);
      assert.ok(!afterG2.placeholder.includes(LOCK_ZH));
    });

    });
    // ─── 情境 R：生成中重新載入 App → 不鎖（只在記憶體） ───
    await scenario("R", async () => {
    await load({ label: "R" });
    await startGeneration("大阪");
    const rLocked = lockedZh(await ui());
    await load({ label: "R-reload", keep: true });
    await ev("show", "chat", {});
    await waitHydrated();
    const rUi = await ui();
    c0 = await counts();
    await ev("typeAndEnter", "你好");
    await settle(30);
    d = reqDelta(c0, await counts());
    await check("L9 [4] 鎖只在記憶體：生成中鎖住；重新載入 App 後不鎖、可送出", () => {
      assert.ok(rLocked, "重新載入前未鎖住");
      assert.equal(rUi.disabled, false, "重新載入後仍鎖住");
      assert.ok(!rUi.placeholder.includes(LOCK_ZH));
      assert.ok(Object.keys(d).length > 0, "重新載入後無法送出");
    });
    });

    // ─── 情境 J：鎖住時帶入聊聊的自動送出入口（附未鎖對照） ───
    const HANDOFFS = [
      ["J1", "首頁心情 prompt（search.from=mood＋prompt）", "seedHomeMood"],
      ["J2", "行程詳情「用聊聊加地點」handoff（from=trip_add_place）", "seedTripAddPlace"],
      ["J3", "規劃頁送出 handoff（from=plan）", "seedPlan"],
    ];
    for (const [idJ, name, seeder] of HANDOFFS) await scenario(idJ, async () => {
      await load({ label: idJ + "c" });
      let s = await ev(seeder);
      let k0 = await counts();
      await ev("show", "chat", s);
      await waitHydrated();
      await settle(30);
      const ctrl = reqDelta(k0, await counts());
      await check(`${idJ}c 對照（未鎖）：${name} 會自動送出請求`, () => {
        assert.ok(Object.keys(ctrl).length > 0, "未鎖時也沒有請求，入口斷言無效");
      });
      info(`${idJ}c 未鎖時請求：${JSON.stringify(ctrl)}`);

      await load({ label: idJ });
      await startGeneration("大阪");
      await ev("show", "none");
      await settle(3);
      s = await ev(seeder);
      k0 = await counts();
      const pend0 = await evaluate("window.gen.pending()");
      await ev("show", "chat", s);
      await waitHydrated();
      await settle(30);
      const locked = reqDelta(k0, await counts());
      const ju = await ui();
      await check(`${idJ} [2] 鎖住時 ${name}：帶入後不送出（AI／Places／Credits 請求 0）且聊聊鎖住`, async () => {
        assert.deepEqual(locked, {}, "送出了請求");
        assert.deepEqual(await evaluate("window.gen.pending()"), pend0, "生成佇列改變");
        assert.ok(lockedZh(ju), "帶入後聊聊未鎖住：" + descUi(ju));
      });
    });

    // ─── 情境 K：首頁（鎖住時） ───
    await scenario("K", async () => {
    await load({ label: "K" });
    await startGeneration("大阪");
    await ev("show", "none");
    await settle(3);
    await ev("show", "home");
    await settle(20);
    const hmK = await ev("homeMoodButtons");
    const kSess0 = await ev("storage");
    const kNav0 = (await navs()).length;
    let k0 = await counts();
    const kMood = await ev("clickHomeMood", 0);
    await settle(6);
    const kNav = (await navs()).slice(kNav0);
    const kSess1 = await ev("storage");
    const chatNav = kNav.find((n) => n && n.to === "/chat");
    if (chatNav) {
      await ev("show", "chat", chatNav.search ?? {});
      await waitHydrated();
      await settle(30);
    }
    const kDelta = reqDelta(k0, await counts());
    await check("L5a [2] 鎖住時首頁心情快捷：不寫入聊聊 Session、（若導向）帶入聊聊後不送出", () => {
      assert.deepEqual(changedKeys(chatKeys(kSess0), chatKeys(kSess1)), [], `心情快捷（${kMood}）寫入了聊聊 store`);
      assert.deepEqual(kDelta, {}, "送出了請求（導向：" + JSON.stringify(kNav) + "）");
    });
    await ev("show", "home");
    await settle(20);
    const kNav1 = (await navs()).length;
    const kCard = await ev("clickHomeChatCard");
    await settle(6);
    const cardNav = (await navs()).slice(kNav1).find((n) => n && n.to === "/chat");
    let cardUi = null;
    if (cardNav) {
      await ev("show", "chat", cardNav.search ?? {});
      await waitHydrated();
      cardUi = await ui();
    }
    const homeRendered = hmK.length >= 3;
    await check("L5b [2] 鎖住時首頁聊聊卡：不可進入（disabled／無連結／點了不導向）或進入的聊聊是鎖住的", () => {
      assert.ok(homeRendered, "首頁未正常 render");
      assert.ok(kCard === "disabled" || kCard === "none" || !cardNav || lockedZh(cardUi), `聊聊卡 ${kCard}，進入後 ui=${descUi(cardUi)}`);
    });

    });
    // ─── 情境 H（資訊）：使用者在首頁（沒有開聊聊）時舊生成完成的導向行為（任務單未規定） ───
    await scenario("H", async () => {
    await load({ label: "H" });
    await startGeneration("大阪");
    await ev("show", "none");
    await settle(3);
    await ev("show", "home");
    await settle(10);
    const navH = (await navs()).length;
    await ev("gen.resolve", "ok");
    await settle(40);
    info("H 使用者在首頁時舊生成成功的導向（任務單未規定，供指派者裁決）：" + JSON.stringify(tripNavs((await navs()).slice(navH))));
    });

    // ═════════════ #L1-T2（tester 獨立審查）新增情境 ═════════════
    const DONE_ZH = await ev("tr", "zh-TW", "uiCoverage.chatGenerationDone");
    const VIEW_ZH = await ev("tr", "zh-TW", "uiCoverage.chatGenerationDoneView");
    const doneToasts = (list) => list.map((t, i) => ({ ...t, i })).filter((t) => t.m === DONE_ZH);
    const trip = (dest) => "trip-" + dest;
    const isTripNav = (n, dest) => n && n.to === "/saved/$tripId" && n.params && n.params.tripId === trip(dest);

    // ─── M1：使用者在首頁（聊聊已卸載、Session 未換）時舊生成完成 → 不跳轉、顯示「行程已完成」＋「查看」；點了才導向 ───
    await scenario("M1", async () => {
      await load({ label: "M1" });
      await startGeneration("大阪");
      await ev("show", "none");
      await settle(3);
      await ev("show", "home");
      await settle(10);
      const nav0 = (await navs()).length;
      const t0 = (await ev("toasts")).length;
      await ev("gen.resolve", "ok");
      await settle(40);
      const navAfter = (await navs()).slice(nav0);
      const newToasts = (await ev("toasts")).slice(t0);
      const done = doneToasts(newToasts);
      const stored = await ev("storedSession");
      await check("M1a [4] 使用者在首頁時舊生成成功：不自動導向、顯示「行程已完成」提示（恰 1 個）且附「查看」按鈕", () => {
        assert.deepEqual(tripNavs(navAfter), [], "自動導向了：" + JSON.stringify(navAfter));
        assert.equal(done.length, 1, "「" + DONE_ZH + "」提示次數；新 toast＝" + JSON.stringify(newToasts));
        assert.equal(done[0].action, VIEW_ZH, "按鈕文案");
        assert.ok(Number(done[0].duration) >= 5000, "提示停留時間過短：" + done[0].duration);
      });
      await check("M1b [6][7] 使用者在首頁（同一 Session）時舊生成成功：完成狀態照常寫回該 Session（persistSession 不誤擋：phase=done、lastGeneratedTripId）", () => {
        assert.equal(stored.lastGeneratedTripId, trip("大阪"), "Session 未寫入完成狀態：" + JSON.stringify(stored));
        assert.equal(stored.phase, "done", JSON.stringify(stored));
      });
      const nav1 = (await navs()).length;
      const clicked = await ev("clickToastAction", t0 + done[0].i);
      await settle(6);
      const navClick = (await navs()).slice(nav1);
      await check("M1c [4] 點「查看」（由已卸載的聊聊實例觸發）→ 導向 /saved/$tripId（trip-大阪），恰 1 次", () => {
        assert.equal(clicked, "clicked");
        assert.equal(navClick.filter((n) => isTripNav(n, "大阪")).length, 1, "導向：" + JSON.stringify(navClick));
        assert.equal(navClick.length, 1, "多餘導向：" + JSON.stringify(navClick));
      });
    });

    // ─── M2：新對話中舊生成完成 → 提示＋查看；點「查看」不改寫新對話 ───
    await scenario("M2", async () => {
      await load({ label: "M2" });
      await startGeneration("大阪");
      await leaveAndOpenNewChat({});
      const sNew = await ev("storedSession");
      const t0 = (await ev("toasts")).length;
      await ev("gen.resolve", "ok");
      await settle(40);
      const done = doneToasts((await ev("toasts")).slice(t0));
      await check("M2a [4] 新對話中舊生成成功：顯示「行程已完成」提示（恰 1 個、附「查看」）", () => {
        assert.equal(done.length, 1, "提示次數：" + JSON.stringify(done));
        assert.equal(done[0].action, VIEW_ZH);
      });
      const nav1 = (await navs()).length;
      await ev("clickToastAction", t0 + done[0].i);
      await settle(10);
      const navClick = (await navs()).slice(nav1);
      await check("M2b [4][6] 新對話中點「查看」：導向舊行程 trip-大阪；新對話 Session 不被改寫", async () => {
        assert.ok(navClick.some((n) => isTripNav(n, "大阪")), "導向：" + JSON.stringify(navClick));
        assert.deepEqual(await ev("storedSession"), sNew, "新對話 Session 被改寫");
      });
    });

    // ─── M3：原對話完成、navigate 使聊聊卸載（真實 router 行為）→ 完成狀態仍寫回 Session（與改動前相同） ───
    const runM3 = async (variant) => {
      await load({ label: "M3-" + variant, variant });
      await evaluate("window.__unmountOnTripNav=true");
      await startGeneration("大阪");
      const nav0 = (await navs()).length;
      const t0 = (await ev("toasts")).length;
      await ev("gen.resolve", "ok");
      await settle(40);
      return {
        navs: (await navs()).slice(nav0).filter((n) => n && n.params && n.params.tripId),
        stored: await ev("storedSession"),
        done: doneToasts((await ev("toasts")).slice(t0)).length,
        unmounted: await evaluate("!document.getElementById('page')"),
      };
    };
    await scenario("M3", async () => {
      const cur = await runM3("cur");
      const base = baseline ? await runM3("base") : null;
      await check("M3 [6][7] 原對話成功、導向後聊聊卸載：導向 trip-大阪 恰 1 次、無「行程已完成」提示、Session 寫入 phase=done（persistSession 不誤擋；與改動前 baseline 相同）", () => {
        assert.ok(cur.unmounted, "fixture 未在導向時卸載聊聊");
        assert.equal(cur.navs.filter((n) => isTripNav(n, "大阪")).length, 1, JSON.stringify(cur.navs));
        assert.equal(cur.done, 0, "原對話不應顯示提示");
        assert.equal(cur.stored.lastGeneratedTripId, trip("大阪"), "卸載後完成狀態被丟棄：" + JSON.stringify(cur.stored));
        assert.equal(cur.stored.phase, "done");
        if (base) {
          // workspaceId 為每次隨機產生：只比對「有無」
          const norm = (s) => ({ ...s, workspaceId: s.workspaceId ? "<ws>" : null });
          assert.deepEqual(cur.navs, base.navs, "導向與改動前不同");
          assert.deepEqual(norm(cur.stored), norm(base.stored), "Session 與改動前不同");
        }
      });
      await evaluate("window.__unmountOnTripNav=false");
    });

    // ─── P1：所有使用者 — 生成中開地點詳情再返回（UI 快取還原同一 Session）＝原對話 → 照常直接導向 ───
    await scenario("P1", async () => {
      await load({ label: "P1" });
      await startGeneration("大阪");
      const s0 = await ev("storedSession");
      await ev("preservePlaceDetailUi");
      await ev("show", "none");
      await settle(3);
      await ev("show", "chat", {});
      await waitHydrated();
      const s1 = await ev("storedSession");
      const locked = lockedZh(await ui());
      const nav0 = (await navs()).length;
      const t0 = (await ev("toasts")).length;
      await ev("gen.resolve", "ok");
      await settle(40);
      const navAfter = (await navs()).slice(nav0);
      const done = doneToasts((await ev("toasts")).slice(t0));
      await check("P1 [4][5] 地點詳情返回（UI 快取還原、Session ID 相同）：生成中仍鎖住；完成時照常直接導向 trip-大阪、不顯示提示", () => {
        assert.equal(s1.planningSessionId, s0.planningSessionId, "返回後不是同一 Session：" + JSON.stringify([s0, s1]));
        assert.ok(locked, "返回後未鎖住");
        assert.equal(navAfter.filter((n) => isTripNav(n, "大阪")).length, 1, "未直接導向：" + JSON.stringify(navAfter));
        assert.equal(done.length, 0, "原對話卻顯示提示");
      });
    });

    // ─── P2：Plus — 生成中離開，從行程草稿（workspaceId）回到同一個 Session ＝原對話 → 照常直接導向 ───
    await scenario("P2", async () => {
      await load({ label: "P2" });
      await startGeneration("大阪");
      await ev("show", "none");
      await settle(3);
      const sid = await ev("seedWorkspaceFromCurrent", "ws-osaka");
      // 使用者在別處開了新對話（live Session 換掉），再從行程草稿回到大阪工作區
      await ev("show", "chat", {});
      await waitHydrated();
      const sMid = await ev("storedSession");
      await ev("show", "none");
      await settle(3);
      await evaluate("window.__plus=true");
      await ev("show", "chat", { workspaceId: "ws-osaka", from: "travel-draft" });
      await waitHydrated();
      const sBack = await ev("storedSession");
      const locked = lockedZh(await ui());
      const nav0 = (await navs()).length;
      const t0 = (await ev("toasts")).length;
      await ev("gen.resolve", "ok");
      await settle(40);
      const navAfter = (await navs()).slice(nav0);
      const done = doneToasts((await ev("toasts")).slice(t0));
      await evaluate("window.__plus=false");
      await check("P2 [4][5] Plus 從行程草稿回到同一 Session：生成中仍鎖住；完成時照常直接導向 trip-大阪、不顯示「行程已完成」提示", () => {
        assert.notEqual(sMid.planningSessionId, sid, "對照：中途新對話應為不同 Session");
        assert.equal(sBack.planningSessionId, sid, "草稿還原後 Session ID 不同：" + JSON.stringify(sBack));
        assert.ok(locked, "回到草稿後未鎖住");
        assert.equal(navAfter.filter((n) => isTripNav(n, "大阪")).length, 1, "未直接導向：" + JSON.stringify(navAfter));
        assert.equal(done.length, 0, "原對話卻顯示提示");
      });
    });

    // ─── N：鎖住時新對話的「清除聊聊」（會清空 Session／UI 快取／歷史並開新 Session） ───
    await scenario("N", async () => {
      await load({ label: "N" });
      await startGeneration("大阪");
      await leaveAndOpenNewChat({});
      const btn = await ev("clearChatButton");
      const store0 = chatKeys(await ev("storage"));
      const k0 = await counts();
      const c1 = await ev("clickClearChat");
      await settle(6);
      const c2 = c1 === "clicked" ? await ev("confirmClearChat") : "skipped";
      await settle(20);
      const changed = changedKeys(store0, chatKeys(await ev("storage")));
      info("N 鎖住時清除聊聊：按鈕=" + JSON.stringify(btn) + " 點擊=" + c1 + " 確認=" + c2 + " 改動的 store key=" + JSON.stringify(changed) + " 請求=" + JSON.stringify(reqDelta(k0, await counts())));
      await check("N [1] 鎖住時新對話的「清除聊聊」按鈕 disabled、不改寫聊聊 store（需求 1：改寫聊聊狀態的入口都要鎖住）", () => {
        assert.ok(btn, "找不到清除聊聊按鈕");
        assert.equal(btn.disabled, true, "鎖住時清除聊聊按鈕可點（點擊=" + c1 + "，確認=" + c2 + "）");
        assert.deepEqual(changed, [], "鎖住時清除聊聊改寫了 store：" + JSON.stringify(changed));
      });
      await ev("gen.resolve", "ok");
      await settle(30);
    });

    // ═════════════ #L1-T3（tester 第 2 輪審查）新增情境 ═════════════
    // ─── N2：清除確認框在未鎖時已開啟、之後才上鎖 → 按「確認」confirmClearChat 本身必須 no-op（不只靠按鈕 disabled）；附未鎖對照 ───
    const runN2 = async (locked) => {
      await load({ label: "N2" + (locked ? "" : "c") });
      await ev("seedTrip", "大阪");
      await ev("show", "chat", {});
      await waitHydrated();
      const btn0 = await ev("clearChatButton");
      const open = await ev("clickClearChat");
      await settle(6);
      if (locked) await ev("lockGen", "n2-lock");
      await settle(4);
      const btn1 = await ev("clearChatButton");
      const s0 = chatKeys(await ev("storage"));
      const m0 = await ev("msgs");
      const k0 = await counts();
      const sb0 = Object.entries(await counts()).filter(([k]) => /^sb/.test(k));
      const conf = await ev("confirmClearChat");
      await settle(20);
      const out = {
        btn0,
        btn1,
        open,
        conf,
        changed: changedKeys(s0, chatKeys(await ev("storage"))),
        msgsChanged: JSON.stringify(await ev("msgs")) !== JSON.stringify(m0),
        req: reqDelta(k0, await counts()),
        sb: Object.entries(await counts()).filter(([k]) => /^sb/.test(k)).reduce((a, [, v]) => a + v, 0) - sb0.reduce((a, [, v]) => a + v, 0),
      };
      if (locked) await ev("unlockGen", "n2-lock");
      return out;
    };
    await scenario("N2", async () => {
      const ctrl = await runN2(false);
      const lk = await runN2(true);
      info("N2 清除確認框：未鎖＝" + JSON.stringify(ctrl) + "｜鎖住＝" + JSON.stringify(lk));
      await check("N2c 對照（未鎖）：開確認框→確認 會清除聊聊（store／訊息改變；證明量測有效）", () => {
        assert.equal(ctrl.open, "clicked");
        assert.equal(ctrl.conf, "clicked");
        assert.ok(ctrl.changed.length > 0 || ctrl.msgsChanged, "未鎖時清除也沒有改變任何東西（對照無效）");
      });
      await check("N2 [1] 確認框開著時才上鎖：清除鈕變 disabled；按「確認」不改寫 store／訊息、不送出請求、不呼叫 supabase（confirmClearChat 本身擋下）", () => {
        assert.equal(lk.btn0?.disabled, false, "上鎖前清除鈕應可點");
        assert.equal(lk.btn1?.disabled, true, "上鎖後清除鈕未 disabled");
        assert.equal(lk.conf, "clicked", "確認鈕應可按（測的是 confirmClearChat 的防護）：" + lk.conf);
        assert.deepEqual(lk.changed, [], "鎖住時確認清除改寫了 store");
        assert.equal(lk.msgsChanged, false, "鎖住時確認清除改了訊息");
        assert.deepEqual(lk.req, {}, "送出了請求");
        assert.equal(lk.sb, 0, "呼叫了 supabase（clearChatHistory）");
      });
    });

    // ─── F*：生成失敗時的頂部提示（不在原對話 → 恰 1 則；在原對話 → 0 則，維持原本失敗顯示） ───
    const FAILED_ZH = await ev("tr", "zh-TW", "uiCoverage.chatGenerationFailed");
    const runFailure = async ({ variant = "cur", deferAt = "create", kind = "fail", where = "home", forceUnlock = false, deviceLocale = null, custom = null, toastThrow = false, invalidateOnSave = false, placesPrep = null }) => {
      await load({ label: `F-${variant}-${deferAt}-${custom ?? kind}-${where}${toastThrow ? "-throw" : ""}${invalidateOnSave ? "-inv" : ""}`, variant });
      await startGeneration("大阪", deferAt);
      // #L1-T4：保存途中讓 ownership 失效（抓 refs 必須在聊聊仍掛載時）
      const refsCaptured = invalidateOnSave ? await ev("captureChatRefs") : null;
      if (invalidateOnSave) await evaluate("window.__saveHook=()=>{window.invalidateOwnership();};true");
      if (placesPrep === "apiEmpty")
        await evaluate("window.__placesPrepImpl=(a)=>({ok:false,apiEmpty:true,message:'附近找不到地點測試',session:a.session});true");
      const errs0 = browserErrors.length;
      const genLog0 = await ev("callLogLen");
      if (where === "home") {
        await ev("show", "none");
        await settle(3);
        await ev("show", "home");
        await settle(10);
      } else if (where === "new") {
        await leaveAndOpenNewChat({});
      }
      let unlockedBefore = null;
      if (forceUnlock) {
        const maxMs = await evaluate("window.CREDITS_RESERVE_STALE_MAX_AGE_MS");
        await evaluate(`window.__clock.advance(Math.max(0, ${maxMs + 1000} - (window.__clock.now() - window.__genStartedAt)))`);
        await settle(6);
        // 首頁沒有輸入框：開一個新聊聊看鎖狀態，再回首頁
        await ev("show", "chat", {});
        await waitHydrated();
        const u = await ui();
        unlockedBefore = !!u && !u.disabled && !String(u.placeholder).includes(LOCK_ZH);
        await ev("show", "home");
        await settle(10);
      }
      if (deviceLocale) {
        await ev("setDeviceLocale", deviceLocale);
        await settle(6);
      }
      const t0 = (await ev("toastsFull")).length;
      const n0 = (await navs()).length;
      const m0 = where === "orig" ? null : await ev("msgs");
      const pending = await evaluate("window.gen.pending()");
      await ev("logMark");
      if (toastThrow) await evaluate("window.__toastThrow=true");
      if (custom) await ev("gen.resolveCustom", custom);
      else await ev("gen.resolve", kind);
      await settle(40);
      await evaluate("window.__toastThrow=false;window.__saveHook=null;window.__placesPrepImpl=null;true");
      const newToasts = (await ev("toastsFull")).slice(t0);
      const logs = await ev("logsSinceMark");
      return {
        logs,
        lifecycle: logs.filter((l) => l.includes("[AI_TRIP_LIFECYCLE]")).map((l) => l.replace(/^warn \[AI_TRIP_LIFECYCLE\] /, "")),
        refsCaptured,
        invalidated: await evaluate("window.__invalidated||0"),
        toastThrown: await evaluate("window.__toastThrown||0"),
        browserErrorsDelta: browserErrors.slice(errs0),
        saves: await evaluate("(window.__saved||[]).length"),
        stored: await ev("storedSession"),
        stillLocked: await evaluate("window.isGenLocked()"),
        pending,
        unlockedBefore,
        newToasts,
        failed: newToasts.filter((t) => t.kind === "error" && t.id && t.id.startsWith("chat-generation-failed:")),
        errors: newToasts.filter((t) => t.kind === "error"),
        credits: (await ev("callLogFrom", genLog0)).filter((k) => /^credits:/.test(k)),
        calls: await ev("callLogFrom", genLog0),
        msgs: await ev("msgs"),
        msgsUnchanged: m0 ? JSON.stringify(await ev("msgs")) === JSON.stringify(m0) : null,
        tripNavs: tripNavs((await navs()).slice(n0)),
      };
    };
    const DETACHED = [
      ["FA", "home", "create", "fail", "首頁＋Planner 回 ok:false（handleGenerateItinerary finally）"],
      ["FB", "home", "create", "throw", "首頁＋create 例外（handleGenerateItinerary catch→finally）"],
      ["FC", "home", "prepare", "fail", "首頁＋prepare ok:false（runDirectItinerary !prepared.ok）"],
      ["FD", "home", "prepare", "throw", "首頁＋prepare 例外（runDirectItinerary catch）"],
      ["FE", "new", "create", "fail", "新對話＋Planner 回 ok:false"],
      ["FE2", "new", "prepare", "throw", "新對話＋prepare 例外"],
    ];
    for (const [idF, where, deferAt, kind, name] of DETACHED) await scenario(idF, async () => {
      const cur = await runFailure({ where, deferAt, kind });
      const base = baseline ? await runFailure({ variant: "base", where, deferAt, kind }) : null;
      info(`${idF} 失敗提示=${JSON.stringify(cur.failed)} 全部 error toast=${cur.errors.length} credits(cur)=${JSON.stringify(cur.credits)} credits(base)=${JSON.stringify(base?.credits ?? null)}`);
      await check(`${idF} [裁決1] 不在原對話時失敗（${name}）：頂部「${FAILED_ZH}」恰 1 則（巢狀流程也只 1 次呼叫、id 固定）、不導向`, () => {
        assert.deepEqual(cur.pending, ["大阪:" + deferAt], "生成未停在預期階段");
        assert.equal(cur.failed.length, 1, "失敗提示呼叫次數；新 toast＝" + JSON.stringify(cur.newToasts));
        assert.equal(cur.failed[0].m, FAILED_ZH, "文案");
        assert.equal(new Set(cur.failed.map((t) => t.id)).size, 1);
        assert.deepEqual(cur.tripNavs, [], "失敗卻導向");
        if (where === "new") assert.equal(cur.msgsUnchanged, true, "新對話訊息被改動");
      });
      if (base)
        await check(`${idF}b [裁決1] 失敗不改變退點／Credits 行為：credits 呼叫序列與改動前 baseline 相同`, () => {
          assert.deepEqual(cur.credits, base.credits, "credits 序列不同");
          assert.equal(base.failed.length, 0, "baseline 不應有失敗提示（對照）");
        });
    });
    const ORIGINAL = [
      ["FO1", "create", "fail"],
      ["FO2", "create", "throw"],
      ["FO3", "prepare", "fail"],
      ["FO4", "prepare", "throw"],
    ];
    for (const [idF, deferAt, kind] of ORIGINAL) await scenario(idF, async () => {
      const cur = await runFailure({ where: "orig", deferAt, kind });
      const base = baseline ? await runFailure({ variant: "base", where: "orig", deferAt, kind }) : null;
      await check(`${idF} [裁決1] 仍在原對話時失敗（${deferAt}/${kind}）：不顯示失敗提示；聊天失敗訊息、所有 toast、credits 序列與改動前 baseline 相同`, () => {
        assert.deepEqual(cur.pending, ["大阪:" + deferAt]);
        assert.equal(cur.failed.length, 0, "原對話卻顯示頂部失敗提示：" + JSON.stringify(cur.failed));
        assert.ok(cur.msgs.length > 3, "聊天失敗訊息未顯示");
        if (base) {
          assert.deepEqual(cur.msgs, base.msgs, "聊天訊息與改動前不同");
          assert.deepEqual(cur.newToasts, base.newToasts, "toast 與改動前不同");
          assert.deepEqual(cur.credits, base.credits, "credits 序列與改動前不同");
        }
      });
    });
    await scenario("FF", async () => {
      const r = await runFailure({ where: "home", deferAt: "create", kind: "fail", forceUnlock: true });
      await check("FF [裁決1] 5 分鐘強制解鎖後才失敗（使用者在首頁）：解鎖在先，失敗時仍顯示失敗提示恰 1 則", () => {
        assert.equal(r.unlockedBefore, true, "強制解鎖未生效");
        assert.equal(r.failed.length, 1, "失敗提示次數：" + JSON.stringify(r.newToasts));
        assert.equal(r.failed[0].m, FAILED_ZH);
      });
    });

    // ─── LC*：離開聊聊後切換語系，提示用新語系（不得用已卸載實例的 t） ───
    const LC = [
      ["LC1", "ok", "en"],
      ["LC2", "ok", "ja"],
      ["LC3", "fail", "ko"],
      ["LC4", "fail", "en"],
      ["LC5", "throw", "ja"],
    ];
    for (const [idL, kind, l] of LC) await scenario(idL, async () => {
      const r = await runFailure({ where: "home", deferAt: "create", kind, deviceLocale: l });
      const want = await ev("tr", l, kind === "ok" ? "uiCoverage.chatGenerationDone" : "uiCoverage.chatGenerationFailed");
      const wantView = await ev("tr", l, "uiCoverage.chatGenerationDoneView");
      const zh = await ev("tr", "zh-TW", kind === "ok" ? "uiCoverage.chatGenerationDone" : "uiCoverage.chatGenerationFailed");
      await check(`${idL} [裁決2] 生成中離開聊聊、切到 ${l} 後${kind === "ok" ? "成功" : "失敗（" + kind + "）"}：提示文案為 ${l}（非 zh-TW）`, () => {
        assert.notEqual(want, zh, "對照：兩語系文案應不同");
        const hit = r.newToasts.filter((t) => t.m === want);
        assert.equal(hit.length, 1, `${l} 提示次數；新 toast＝` + JSON.stringify(r.newToasts));
        assert.equal(r.newToasts.filter((t) => t.m === zh).length, 0, "仍用 zh-TW（已卸載實例的 t）");
        if (kind === "ok") assert.equal(hit[0].action, wantView, "「查看」語系");
        else assert.equal(hit[0].kind, "error");
      });
    });

    // ═════════════ #L1-T4（tester 第 3 輪審查）新增情境 ═════════════
    // 裁決：不在原對話時一次失敗只一則頂部提示（有 i18n 具體原因用具體原因，否則通用文案）；
    //       沒產生行程的靜默解鎖改為通知；行程已保存則發「行程已完成」；Credits settle 一定執行、序列不變；原對話不變。
    const hasLog = (r, needle) => r.logs.some((l) => l.includes(needle));
    const sameAsBase = (cur, base, label) => {
      if (!base) return;
      assert.deepEqual(cur.credits, base.credits, label + "：credits 序列與改動前不同");
    };
    const origEqualsBase = (cur, base) => {
      assert.equal(cur.failed.length, 0, "原對話卻顯示頂部失敗提示：" + JSON.stringify(cur.failed));
      if (!base) return;
      assert.deepEqual(cur.msgs, base.msgs, "聊天訊息與改動前不同");
      assert.deepEqual(cur.newToasts, base.newToasts, "toast 與改動前不同");
      assert.deepEqual(cur.credits, base.credits, "credits 序列與改動前不同");
      assert.deepEqual(cur.tripNavs, base.tripNavs, "導向與改動前不同");
      assert.deepEqual(cur.lifecycle, base.lifecycle, "生命週期紀錄與改動前不同");
    };
    const pair = async (opts) => [await runFailure(opts), baseline ? await runFailure({ ...opts, variant: "base" }) : null];
    const brief = (r) => JSON.stringify({ failed: r.failed.map((t) => t.m), errors: r.errors.length, toasts: r.newToasts.map((t) => t.kind + ":" + t.m.slice(0, 24)), credits: r.credits, lifecycle: r.lifecycle, navs: r.tripNavs.length, locked: r.stillLocked, thrown: r.toastThrown, bErr: r.browserErrorsDelta.length });

    // ─── CAP*：容量超過（16 個已接受必去點 > 3 天×5）：不在原對話 → 一則、文案＝顯示當下語系的 chatRuntime.capacity ───
    const CAPS = [
      ["CAP1", "home", null],
      ["CAP2", "new", "en"],
      ["CAP3", "home", "ja"],
    ];
    for (const [idC, where, l] of CAPS) await scenario(idC, async () => {
      const [cur, base] = await pair({ where, deferAt: "prepare", custom: "capacity", deviceLocale: l });
      const loc = l ?? "zh-TW";
      const want = await ev("tr", loc, "chatRuntime.capacity");
      const generic = await ev("tr", loc, "uiCoverage.chatGenerationFailed");
      info(`${idC} cur=${brief(cur)} base=${base ? brief(base) : null}`);
      await check(`${idC} [裁決] 不在原對話（${where}${l ? "、裝置語系切到 " + l : ""}）容量超過：頂部提示恰 1 則＝${loc} 的 chatRuntime.capacity、無通用失敗文案、不導向、解鎖`, () => {
        assert.ok(hasLog(cur, "[PLANNING_REQUIRED_CAPACITY_PREFLIGHT]"), "未走到容量檢查（fixture 無效）；lifecycle=" + JSON.stringify(cur.lifecycle));
        assert.equal(cur.errors.length, 1, "error toast 數；新 toast＝" + JSON.stringify(cur.newToasts));
        assert.equal(cur.failed.length, 1, "失敗提示數");
        assert.equal(cur.failed[0].m, want, "文案應為 " + loc + " capacity");
        assert.ok(!cur.newToasts.some((t) => t.m === generic), "同時出現通用失敗文案");
        assert.deepEqual(cur.tripNavs, []);
        assert.equal(cur.stillLocked, false, "未解鎖");
        assert.deepEqual(cur.browserErrorsDelta, []);
      });
      if (base)
        await check(`${idC}b [裁決] 容量超過（不在原對話）：credits 序列與改動前 baseline 相同；baseline 無頂部提示（對照）`, () => {
          sameAsBase(cur, base, idC);
          assert.equal(base.failed.length, 0);
          assert.ok(hasLog(base, "[PLANNING_REQUIRED_CAPACITY_PREFLIGHT]"), "baseline 未走到容量檢查");
        });
    });
    await scenario("CAPO", async () => {
      const [cur, base] = await pair({ where: "orig", deferAt: "prepare", custom: "capacity" });
      const zh = await ev("tr", "zh-TW", "chatRuntime.capacity");
      await check("CAPO [裁決] 仍在原對話容量超過：無頂部失敗提示；聊天顯示 capacity 文案；訊息、toast、credits、導向、生命週期與改動前 baseline 相同", () => {
        assert.ok(hasLog(cur, "[PLANNING_REQUIRED_CAPACITY_PREFLIGHT]"), "未走到容量檢查");
        assert.ok(cur.msgs.some((m) => m.includes(zh)), "聊天未顯示 capacity 文案");
        origEqualsBase(cur, base);
      });
    });

    // ─── EB*：handleGenerateItinerary 入口 entry_blocked（runDirect 帶 ownership、已上鎖）：不在原對話 → 通用失敗一則 ───
    for (const [idE, where] of [["EB1", "home"], ["EB2", "new"]]) await scenario(idE, async () => {
      const [cur, base] = await pair({ where, deferAt: "prepare", custom: "entryBlocked" });
      info(`${idE} cur=${brief(cur)} base=${base ? brief(base) : null}`);
      await check(`${idE} [裁決] 入口 entry_blocked（有 ownership、${where}）：頂部「${FAILED_ZH}」恰 1 則、不導向、解鎖`, () => {
        assert.ok(cur.lifecycle.includes('aborted {"failureCode":"entry_blocked"}'), "未走到入口 entry_blocked：" + JSON.stringify(cur.lifecycle));
        assert.ok(!cur.lifecycle.some((l) => l.startsWith("destination_resolution")), "走到了目的地解析（不是入口那一處）");
        assert.equal(cur.errors.length, 1, "error toast 數：" + JSON.stringify(cur.newToasts));
        assert.equal(cur.failed.length, 1);
        assert.equal(cur.failed[0].m, FAILED_ZH);
        assert.deepEqual(cur.tripNavs, []);
        assert.equal(cur.stillLocked, false);
        if (where === "new") assert.equal(cur.msgsUnchanged, true, "新對話訊息被改動");
      });
      if (base)
        await check(`${idE}b 入口 entry_blocked：credits 序列與 baseline 相同；baseline 靜默（對照）`, () => {
          sameAsBase(cur, base, idE);
          assert.equal(base.failed.length, 0);
          assert.ok(base.lifecycle.includes('aborted {"failureCode":"entry_blocked"}'));
        });
    });
    await scenario("EBO", async () => {
      const [cur, base] = await pair({ where: "orig", deferAt: "prepare", custom: "entryBlocked" });
      await check("EBO [裁決] 仍在原對話入口 entry_blocked：無頂部失敗提示；與改動前 baseline 相同", () => {
        assert.ok(cur.lifecycle.includes('aborted {"failureCode":"entry_blocked"}'));
        origEqualsBase(cur, base);
      });
    });

    // ─── SV*：行程已保存後 ownership 失效（保存途中 activeGenerationRequestIdRef 被換掉）→ entry_blocked 分支 ───
    for (const [idS, where] of [["SV1", "home"], ["SV2", "new"]]) await scenario(idS, async () => {
      const svOpts = { where, deferAt: "create", kind: "ok", invalidateOnSave: true };
      const cur = await runFailure(svOpts);
      const done = doneToasts(cur.newToasts);
      // 「查看」須在同一頁（cur）點；之後才跑 baseline
      const nav1 = (await navs()).length;
      const clicked = done.length ? await ev("clickToastAction", (await ev("toastsFull")).length - cur.newToasts.length + done[0].i) : "none";
      await settle(6);
      const navClick = (await navs()).slice(nav1);
      const base = baseline ? await runFailure({ ...svOpts, variant: "base" }) : null;
      info(`${idS} cur=${brief(cur)} invalidated=${cur.invalidated} refs=${cur.refsCaptured} base=${base ? brief(base) : null}`);
      await check(`${idS} [裁決] 已保存後 ownership 失效（${where}）：「${DONE_ZH}」恰 1 則（附「${VIEW_ZH}」）、無失敗提示、不自動導向、解鎖`, () => {
        assert.ok(cur.invalidated >= 1, "fixture 未讓 ownership 失效（找不到 activeGenerationRequestIdRef）");
        assert.equal(cur.saves, 1, "應已保存 1 次");
        const iSave = cur.lifecycle.findIndex((l) => l.startsWith("save_result"));
        const iBlocked = cur.lifecycle.lastIndexOf('aborted {"failureCode":"entry_blocked"}');
        assert.ok(iSave >= 0 && iBlocked > iSave, "未走到保存後的 entry_blocked：" + JSON.stringify(cur.lifecycle));
        assert.equal(done.length, 1, "完成提示數：" + JSON.stringify(cur.newToasts));
        assert.equal(done[0].action, VIEW_ZH);
        assert.equal(cur.failed.length, 0, "出現失敗提示");
        assert.equal(cur.errors.length, 0);
        assert.deepEqual(cur.tripNavs, [], "自動導向了");
        assert.equal(cur.stillLocked, false);
      });
      if (base)
        await check(`${idS}b 已保存後 ownership 失效：credits 序列（commit＋finally）與 baseline 相同；baseline 無任何提示（對照）`, () => {
          sameAsBase(cur, base, idS);
          assert.equal(base.saves, 1);
          assert.equal(doneToasts(base.newToasts).length, 0);
          assert.equal(base.failed.length, 0);
        });
      await check(`${idS}c 點「${VIEW_ZH}」→ 導向 trip-大阪 恰 1 次`, () => {
        assert.equal(clicked, "clicked");
        assert.equal(navClick.filter((n) => isTripNav(n, "大阪")).length, 1, JSON.stringify(navClick));
      });
    });
    await scenario("SVO", async () => {
      const [cur, base] = await pair({ where: "orig", deferAt: "create", kind: "ok", invalidateOnSave: true });
      await check("SVO [裁決] 仍在原對話、保存後 ownership 失效：無完成／失敗提示、不導向；與改動前 baseline 相同", () => {
        assert.ok(cur.invalidated >= 1);
        assert.equal(doneToasts(cur.newToasts).length, 0, "原對話卻顯示完成提示");
        origEqualsBase(cur, base);
      });
    });

    // ─── TT*：通知本身丟例外 → Credits 仍 settle（序列與 baseline 相同）、解鎖、不產生未捕捉例外 ───
    const TTS = [
      ["TT1", { where: "home", deferAt: "create", kind: "fail" }, "handleGenerateItinerary finally（create ok:false）"],
      ["TT2", { where: "home", deferAt: "prepare", custom: "capacity" }, "handleGenerateItinerary finally（容量超過、帶原因）"],
      ["TT3", { where: "home", deferAt: "create", kind: "throw" }, "handleGenerateItinerary catch→finally（create 例外）"],
      ["TT4", { where: "home", deferAt: "prepare", kind: "fail" }, "runDirectItinerary !prepared.ok（未包 try／catch）"],
      ["TT5", { where: "home", deferAt: "prepare", kind: "throw" }, "runDirectItinerary catch（未包 try／catch）"],
      ["TT6", { where: "home", deferAt: "prepare", custom: "entryBlocked" }, "handleGenerateItinerary 入口 entry_blocked（未包 try／catch）"],
    ];
    for (const [idT, opts, name] of TTS) await scenario(idT, async () => {
      const [cur, base] = await pair({ ...opts, toastThrow: true });
      info(`${idT} cur=${brief(cur)} stored=${JSON.stringify(cur.stored)} base=${base ? brief(base) : null} baseStored=${JSON.stringify(base?.stored ?? null)}`);
      await check(`${idT} [裁決] 通知丟例外（${name}）：通知有嘗試、Credits settle 序列與 baseline 相同、解鎖、無未捕捉例外`, () => {
        assert.ok(cur.toastThrown >= 1, "通知未被呼叫（測試無效）");
        if (base) assert.deepEqual(cur.credits, base.credits, "credits 序列與改動前不同（settle 被例外跳過）");
        assert.equal(cur.stillLocked, false, "未解鎖");
        assert.deepEqual(cur.browserErrorsDelta, [], "未捕捉例外");
      });
    });

    // ─── FM／FMO、FAE／FAEO：既有 toast（offerMustVisit、apiEmpty）只在原對話顯示；不在原對話只剩一則通用提示 ───
    for (const [idM, opts, label] of [
      ["FM", { deferAt: "create", custom: "offerMustVisit" }, "offerMustVisit"],
      ["FAE", { deferAt: "prepare", kind: "ok", placesPrep: "apiEmpty" }, "apiEmpty（候選擴充）"],
    ]) {
      await scenario(idM, async () => {
        const [cur, base] = await pair({ ...opts, where: "home" });
        info(`${idM} cur=${brief(cur)} base=${base ? brief(base) : null}`);
        await check(`${idM} [裁決] 不在原對話、${label} 失敗：頂部 error toast 恰 1 則＝「${FAILED_ZH}」（既有 toast.error(message) 不再出現）`, () => {
          if (idM === "FAE") assert.ok(cur.calls.includes("places:prepareDirectItinerarySession"), "未走到候選擴充（fixture 無效）");
          assert.equal(cur.errors.length, 1, "error toast：" + JSON.stringify(cur.errors));
          assert.equal(cur.failed.length, 1);
          assert.equal(cur.failed[0].m, FAILED_ZH);
          if (base) {
            assert.deepEqual(cur.credits, base.credits, "credits 序列不同");
            assert.equal(base.errors.length, 1, "baseline 應只有既有 toast.error(message)（對照）");
          }
        });
      });
      await scenario(idM + "O", async () => {
        const [cur, base] = await pair({ ...opts, where: "orig" });
        await check(`${idM}O [裁決] 仍在原對話 ${label} 失敗：既有 toast.error(message) 照常、無頂部失敗提示；與改動前 baseline 相同`, () => {
          assert.equal(cur.errors.length, 1, "原對話應保留既有 toast：" + JSON.stringify(cur.errors));
          origEqualsBase(cur, base);
        });
      });
    }

    // ─── FE3：新對話＋prepare ok:false（runDirect 的 isCurrentTripDateSnapshot 檢查在不在原對話時不會擋下） ───
    await scenario("FE3", async () => {
      const [cur, base] = await pair({ where: "new", deferAt: "prepare", kind: "fail" });
      await check(`FE3 [裁決] 新對話＋prepare ok:false：通過 prepare 後的快照檢查、頂部「${FAILED_ZH}」恰 1 則、credits 與 baseline 相同`, () => {
        assert.ok(cur.lifecycle.some((l) => l.startsWith("final_planner_gate")), "在 prepare 後的快照檢查被擋下（靜默結束）：" + JSON.stringify(cur.lifecycle));
        assert.equal(cur.failed.length, 1, JSON.stringify(cur.newToasts));
        assert.equal(cur.failed[0].m, FAILED_ZH);
        sameAsBase(cur, base, "FE3");
        assert.equal(cur.msgsUnchanged, true);
      });
    });

    // ─── ND（資訊）：prepare 回傳的 Session 沒有已確認日期 → handleGenerateItinerary 開頭 pauseForTripDates 提早 return ───
    await scenario("ND", async () => {
      const [cur, base] = await pair({ where: "home", deferAt: "prepare", custom: "noDates" });
      info(`ND 不在原對話、prepare 後 Session 無 dateProvenance（pauseForTripDates）：cur=${brief(cur)} base=${base ? brief(base) : null} stored=${JSON.stringify(cur.stored)}`);
    });

    // ─── U：鎖住時被略過的帶入，解鎖後不得「意外」自動送出；下次進聊聊恰執行一次（不重複扣點） ───
    for (const [idJ, name, seeder] of HANDOFFS) await scenario(idJ + "u", async () => {
      // 未鎖對照：同一入口第一次進入的請求數
      await load({ label: idJ + "u-c" });
      let s = await ev(seeder);
      let k0 = await counts();
      await ev("show", "chat", s);
      await waitHydrated();
      await settle(30);
      const ctrl = reqDelta(k0, await counts());

      await load({ label: idJ + "u" });
      await startGeneration("大阪");
      await ev("show", "none");
      await settle(3);
      s = await ev(seeder);
      await ev("show", "chat", s);
      await waitHydrated();
      await settle(30);
      k0 = await counts();
      await ev("gen.resolve", "ok"); // 舊生成完成 → 解鎖（同一實例 live 更新）
      await settle(40);
      const unlocked = !lockedZh(await ui());
      const kU = await counts();
      // 解鎖後的一般操作：切換語系（t 改變 → 還原 effect 重跑、hydrating 切換）
      await ev("setLocale", "en");
      await settle(20);
      await ev("setLocale", "zh-TW");
      await settle(30);
      const afterLocale = reqDelta(kU, await counts());
      const afterUnlock = reqDelta(k0, kU);
      await check(`${idJ}u1 [2][4] 鎖住時略過的 ${name}：解鎖本身與解鎖後切換語系都不得自動送出（AI／Places／Credits 0）`, () => {
        assert.ok(unlocked, "舊生成完成後未解鎖");
        // 解鎖瞬間的請求扣掉舊生成 G1 自己的收尾（保存、路線、封面、itinerary 扣點 settle）
        const strip = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !/^save:|^routes:|^image:|^credits:settle$/.test(k)));
        assert.deepEqual(afterLocale, {}, "解鎖後切換語系就自動送出了略過的帶入：" + JSON.stringify(afterLocale));
        assert.deepEqual(strip(afterUnlock), {}, "解鎖時自動送出：" + JSON.stringify(afterUnlock));
      });
      // 下次進聊聊（同一帶入參數再進一次）：恰執行一次，再進一次不重複
      await ev("show", "none");
      await settle(3);
      let k1 = await counts();
      await ev("show", "chat", s);
      await waitHydrated();
      await settle(30);
      const next1 = reqDelta(k1, await counts());
      await ev("show", "none");
      await settle(3);
      k1 = await counts();
      // 首頁心情：第一次自動送出後聊聊會以 replace 導向移除 prompt，之後的歷史紀錄不再帶 prompt
      const lastReplace = (await navs()).filter((n) => n && n.to === "/chat" && n.replace).slice(-1)[0];
      const s2 = s.prompt ? { ...(lastReplace?.search ?? s), prompt: undefined } : s;
      await ev("show", "chat", s2);
      await waitHydrated();
      await settle(30);
      const next2 = reqDelta(k1, await counts());
      info(`${idJ}u 未鎖對照=${JSON.stringify(ctrl)} 解鎖後下次進聊聊=${JSON.stringify(next1)} 再進一次=${JSON.stringify(next2)}`);
      await check(`${idJ}u2 [2][4] ${name}：解鎖後再進聊聊的請求不超過未鎖對照一次的量；再進一次不重複送出`, () => {
        for (const [k, v] of Object.entries(next1)) assert.ok(v <= (ctrl[k] ?? 0), `下次進聊聊 ${k}=${v} 超過未鎖對照 ${ctrl[k] ?? 0}`);
        const credits = (d) => Object.entries(d).filter(([k]) => /^credits:begin/.test(k)).reduce((a, [, v]) => a + v, 0);
        assert.ok(credits(next1) + credits(next2) <= credits(ctrl), `扣點 begin 次數 ${credits(next1)}+${credits(next2)} 超過未鎖對照 ${credits(ctrl)}`);
        assert.deepEqual(next2, {}, "第二次進入又送出：" + JSON.stringify(next2));
      });
    });

    // ─── E：其他頁帶入聊聊的入口（真實 render＋點擊；附未鎖對照） ───
    const NOTICE_ZH = await ev("tr", "zh-TW", "uiCoverage.chatGenerationLockedNotice");
    const entryKeys = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => /chat|workspace|conversation|trip-add-place-handoff/i.test(k)));
    const ENTRIES = [
      ["rec", "推薦頁「在聊聊繼續」（_app.recommendations.tsx）", async () => [await ev("tr", "zh-TW", "productionUi.pcb3f34e459")]],
      ["plan", "規劃頁「AI 幫我排」（_app.plan.tsx startPlanChat）", async () => [await ev("tr", "zh-TW", "plan.aiAssist")]],
      ["place", "地點詳情「聊這個地點」（_app.place.tsx handleOpenChat）", async () => [await ev("tr", "zh-TW", "uiCoverage.chatPlace")]],
      ["editor", "行程詳情「用聊聊加地點」（SavedTripItineraryEditor）", async () => [await ev("tr", "zh-TW", "productionUi.p49b9632629"), await ev("tr", "zh-TW", "productionUi.pc4dc89e225")]],
    ];
    for (const [kind, name, labels] of ENTRIES) await scenario("E-" + kind, async () => {
      const runEntry = async (locked) => {
        await load({ label: "E-" + kind + (locked ? "" : "c") });
        if (locked) await ev("lockGen", "entry-test");
        const seed = await ev("seedEntry", kind);
        await ev("showEntry", kind, seed.key, seed.search);
        await settle(30);
        const s0 = entryKeys(await ev("storage"));
        const k0 = await counts();
        const n0 = (await navs()).length;
        const t0 = (await ev("toasts")).length;
        const clicks = [];
        for (const l of await labels()) {
          clicks.push(await ev("clickByText", l));
          await settle(20);
        }
        await settle(30);
        const out = {
          clicks,
          changed: changedKeys(s0, entryKeys(await ev("storage"))),
          req: reqDelta(k0, await counts()),
          chatNavs: (await navs()).slice(n0).filter((n) => n && n.to === "/chat"),
          notices: (await ev("toasts")).slice(t0).filter((t) => t.m === NOTICE_ZH).length,
          buttons: clicks.includes("none") ? await ev("buttonTexts") : null,
        };
        if (locked) await ev("unlockGen", "entry-test");
        return out;
      };
      const ctrl = await runEntry(false);
      const lk = await runEntry(true);
      info(`E-${kind} 未鎖：${JSON.stringify({ ...ctrl, buttons: undefined })}｜鎖住：${JSON.stringify({ ...lk, buttons: undefined })}`);
      await check(`E-${kind}c 對照（未鎖）：${name} 會改寫聊聊狀態並導向 /chat、無鎖定提示`, () => {
        assert.ok(!ctrl.clicks.includes("none"), "找不到按鈕；頁面按鈕：" + JSON.stringify(ctrl.buttons));
        assert.ok(ctrl.changed.length > 0, "未鎖時沒有寫入聊聊狀態（對照無效）");
        assert.equal(ctrl.chatNavs.length, 1, "未鎖時導向 /chat 次數：" + JSON.stringify(ctrl.chatNavs));
        assert.equal(ctrl.notices, 0, "未鎖時出現鎖定提示");
      });
      await check(`E-${kind} [1][2] 鎖住時 ${name}：不寫入聊聊狀態、不導向 /chat、不送出請求，並顯示「${NOTICE_ZH}」恰 1 次`, () => {
        assert.ok(!lk.clicks.includes("none"), "找不到按鈕；頁面按鈕：" + JSON.stringify(lk.buttons));
        assert.deepEqual(lk.changed, [], "鎖住時寫入了聊聊狀態");
        assert.deepEqual(lk.chatNavs, [], "鎖住時導向了 /chat");
        assert.deepEqual(lk.req, {}, "鎖住時送出了請求");
        assert.equal(lk.notices, 1, "鎖定提示次數");
      });
    });

    await check("R0 無外部請求、無未捕捉例外", () => {
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(browserErrors, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
  }
}

console.log("\n──────── 結果 ────────");
for (const [s, n] of results) console.log(s + "  " + n);
if (infos.length) console.log("\nINFO:\n  " + infos.join("\n  "));
console.log(`\n${results.length - failures.length} PASS / ${failures.length} FAIL`);
process.exit(failures.length ? 1 : 0);
