#!/usr/bin/env node
/**
 * 任務單 #T125／#T128b（tester）— A2 1b 定點修正：tripDays 地名誤判（parse-chinese-duration.ts 兩處正則）函式層驗收。
 *
 * 執行方式（由使用者以既有離線 Guard Runner 執行；tester 不執行）：
 *   vite-node --config <scratchpad>/planner-reset-vite.config.mjs scripts/verify-a2-1bfix-tripdays.mjs
 *   （offline-guard 以 --import 預載）
 *
 * 只 import 正式 src 模組（絕對路徑，同 scripts/verify-negated-switch-s1s4.mjs）與施工前副本：
 *   - src/lib/parse-chinese-duration.ts（新）
 *   - <scratchpad>/A2-BUILD/copies/pre-1b-fix/parse-chinese-duration.ts（舊；基準）
 *   - src/lib/recommendation/trip-intent.ts applyTripIntentToSession、src/lib/ai/travel-context.ts mergeTravelContext（端到端）
 *   不 import 網路／Provider／Supabase／Credits 模組；不讀 .env；process.env 只讀 OFFLINE_GUARD_LOG 一個變數（Guard 記錄檔路徑）。
 *   fetch／worker_threads.Worker／child_process 一律包裝計數，只轉交覆寫前（Guard）的版本；Guard 不存在時直接丟錯。
 *
 * 基準副本載入（#T128b；不使用 esbuild、Worker、子程序，也不依賴 vite alias 解析 scratchpad 檔案）：
 *   1. node:fs 讀副本原始位元組，node:crypto sha256 必須等於 BASELINE_SHA256，不符 → FAIL，不載入。
 *   2. 副本必須恰好一行 import，且為第 1 行 `import { MIN_ITINERARY_DAYS } from "@/lib/ai/itinerary-days";`；
 *      不得出現其他 import(...)／require(...)。
 *   3. node:module stripTypeScriptTypes（mode "strip"，只把型別換成空白，不改寫邏輯）去型別。
 *   4. 該 import 行換成從「已 import 的正式 src/lib/ai/itinerary-days.ts」取 MIN_ITINERARY_DAYS；
 *      `export function X` 改為 `function X` 並收集名稱到回傳物件；其餘 export 殘留 → 載入失敗。
 *   5. 以 new Function（"use strict"，與 ESM 同為嚴格模式）求值；只注入 itinerary-days 一個依賴。
 *   載入失敗 → SELF FAIL，且所有新舊比對案例都不計 PASS（G3／G4 各記一筆 FAIL，CMP 標 UNVERIFIED）。
 *   自我檢查：舊版對「到四日市」必須回 4（確認基準確實是修正前程式碼），否則 FAIL。
 *
 * 群組：
 *   G1 必須案例（任務單六項）
 *   G2 地名語料：新結果 undefined，並列出舊結果
 *   G3 非地名語料：新舊結果完全一致（parseDayCountFromText），且必須案例的期望值成立
 *   G4 normalizeDestinationAndDuration：非地名語料新舊完全一致；地名新 tripDays undefined、label 不變
 *   G5 trip-intent applyTripIntentToSession：到二日市／到四日市／到十日町 tripDays 不得為 2／4／10；正向控制組
 *   G6 端到端 mergeTravelContext（travel-context 主路徑）：同上（含 normalizeDestinationLabel 去「市」的既有行為；只斷言天數）
 *   CMP 新舊比較分類：既有行為（old=new）／本輪修正（old 錯、new 對，限地名語料）／本輪新增退步（非地名 old≠new → 已計入 G3／G4 FAIL）／UNVERIFIED（old 不可得）
 *   OPEN 待判定語料（「京都3日町家巡禮」「3日市立美術館」「八日市場」）：只記錄 old/new 實際值，不計 PASS/FAIL
 *   INFO 邊界探測（不計 FAIL；old 可得時才標差異）
 *   NET fetch 計數＝0、Worker 計數＝0、Guard 記錄（OFFLINE_GUARD_LOG）本測試期間新增行數＝0；記錄不可觀察 → FAIL
 * 任一 FAIL → process.exitCode = 1。
 */
const oi = console.info, ow = console.warn;
console.info = () => {};
console.warn = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");

const fs = (await import("node:fs")).default;
const crypto = (await import("node:crypto")).default;

// ── Guard 記錄（只讀 OFFLINE_GUARD_LOG 這一個 env；多支測試共用同一檔 → 只計本測試開始後新增的行）──
const GUARD_LOG = process.env.OFFLINE_GUARD_LOG;
function readGuardLogLines() {
  if (!GUARD_LOG) return null;
  try { return fs.readFileSync(GUARD_LOG, "utf8").split("\n").filter((l) => l.length > 0); } catch { return null; }
}
const guardLogStart = readGuardLogLines();

// offline guard：計數後轉呼叫覆寫前的 fetch（guard 記錄並丟錯）；guard 不存在時直接丟錯，絕不轉呼叫真實 fetch。
const priorFetch = globalThis.fetch;
const guardActive = globalThis.__OFFLINE_GUARD__ === true;
let externalCalls = 0;
globalThis.fetch = async (...args) => {
  externalCalls += 1;
  if (guardActive && typeof priorFetch === "function") return priorFetch(...args);
  throw new Error("[a2-1bfix-tripdays] 禁止外部請求（offline-guard 未預載，不轉呼叫真實 fetch）");
};

// Worker／child_process：只包裝計數，轉交覆寫前（Guard 已替換）的版本；Guard 不存在 → 直接丟錯，不轉呼叫真實版本。
// 註：只攔截模組物件屬性（require / default import 於呼叫時取值的路徑）；具名 ESM import 的綁定不經過這裡，仍由 Guard 擋並記錄。
const wtMod = (await import("node:worker_threads")).default;
const cpMod = (await import("node:child_process")).default;
const priorWorker = wtMod.Worker;
let workerCalls = 0;
wtMod.Worker = class CountedWorker {
  constructor(...args) {
    workerCalls += 1;
    if (guardActive && typeof priorWorker === "function") return new priorWorker(...args);
    throw new Error("[a2-1bfix-tripdays] 禁止 Worker（offline-guard 未預載）");
  }
};
const CP_KEYS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];
const priorCp = Object.fromEntries(CP_KEYS.map((k) => [k, cpMod[k]]));
const cpCalls = [];
for (const k of CP_KEYS) {
  cpMod[k] = function (cmd, ...rest) {
    cpCalls.push(`${k} ${String(cmd).split("/").pop()}`);
    if (guardActive && typeof priorCp[k] === "function") return priorCp[k].call(this, cmd, ...rest);
    throw new Error(`[a2-1bfix-tripdays] 禁止 child_process.${k}（offline-guard 未預載）`);
  };
}

const R = "/Users/shuo/Roamie-clean/src";
const COPY = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/A2-BUILD/copies/pre-1b-fix/parse-chinese-duration.ts";
const BASELINE_SHA256 = "f12b4c423ac4b8dedb04dacff725ad5a9b478c692572cab165d4c403a32ba923";
const BASELINE_IMPORT_LINE = 'import { MIN_ITINERARY_DAYS } from "@/lib/ai/itinerary-days";';
const BASELINE_EXPORTS = ["parseDayCountFromText", "normalizeDestinationAndDuration"];

let anyFail = false;
let pass = 0, fail = 0;
const OLD_UNAVAILABLE = Symbol("old-unavailable");
const fmt = (v) => (v === OLD_UNAVAILABLE ? "UNAVAILABLE" : v === undefined ? "undefined" : JSON.stringify(v));
function check(group, id, ok, detail) {
  if (ok) pass += 1; else { fail += 1; anyFail = true; }
  out(`${ok ? "PASS" : "FAIL"} [${group}] ${id}${detail ? " — " + detail : ""}`);
}

/** 施工前副本載入（只用 node:fs／node:crypto／node:module 同步 API 與 new Function；見檔頭說明）。 */
async function loadBaselineCopy(itineraryDays) {
  const bytes = fs.readFileSync(COPY);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== BASELINE_SHA256) throw new Error(`副本 sha256 不符：${sha}（預期 ${BASELINE_SHA256}），不載入`);
  const src = bytes.toString("utf8");
  const lines = src.split("\n");
  const importLines = lines.filter((l) => /^\s*import\b/.test(l));
  if (importLines.length !== 1 || lines[0] !== BASELINE_IMPORT_LINE) {
    throw new Error(`副本 import 與預期不符：${JSON.stringify(importLines)} 第1行=${JSON.stringify(lines[0])}`);
  }
  if (/\brequire\s*\(|\bimport\s*\(/.test(src)) throw new Error("副本含動態 import(...)／require(...)，拒絕載入");
  if (typeof itineraryDays?.MIN_ITINERARY_DAYS !== "number") throw new Error("正式 itinerary-days 未提供數值 MIN_ITINERARY_DAYS");
  const { stripTypeScriptTypes } = await import("node:module");
  if (typeof stripTypeScriptTypes !== "function") throw new Error("node:module stripTypeScriptTypes 不可用（Node 版本不支援）");
  const stripped = stripTypeScriptTypes(src, { mode: "strip" });
  if (stripped.split(BASELINE_IMPORT_LINE).length !== 2) throw new Error("去型別後 import 行不是恰好出現一次");
  let body = stripped.replace(BASELINE_IMPORT_LINE, "const { MIN_ITINERARY_DAYS } = __itineraryDays__;");
  const exported = [];
  body = body.replace(/^export\s+function\s+([A-Za-z_$][\w$]*)/gm, (_m, name) => { exported.push(name); return `function ${name}`; });
  if (/^\s*export\b/m.test(body)) throw new Error("去型別後仍有非 function 的 export 殘留，拒絕載入");
  if (JSON.stringify([...exported].sort()) !== JSON.stringify([...BASELINE_EXPORTS].sort())) {
    throw new Error(`副本 export 與預期不符：${JSON.stringify(exported)}`);
  }
  const factory = new Function("__itineraryDays__", `"use strict";\n${body}\nreturn { ${exported.join(", ")} };`);
  return { mod: factory(Object.freeze({ MIN_ITINERARY_DAYS: itineraryDays.MIN_ITINERARY_DAYS })), sha };
}

try {
  const NEW = await import(R + "/lib/parse-chinese-duration.ts");
  const itineraryDays = await import(R + "/lib/ai/itinerary-days.ts");

  // ── 基準副本載入（無 esbuild 備援）──
  let OLD = null, oldLoadError = "", oldSha = "";
  try {
    const loaded = await loadBaselineCopy(itineraryDays);
    OLD = loaded.mod;
    oldSha = loaded.sha;
  } catch (e) {
    oldLoadError = String(e?.message ?? e).slice(0, 240);
  }
  out(`baseline-loader: ${OLD ? `node:module stripTypeScriptTypes + new Function（副本原文，sha256=${oldSha}）` : "none"}${oldLoadError ? `（錯誤：${oldLoadError}）` : ""}`);
  const haveOld = Boolean(OLD && typeof OLD.parseDayCountFromText === "function" && typeof OLD.normalizeDestinationAndDuration === "function");
  check("SELF", "baseline 副本載入成功（sha256 相符、無 esbuild／Worker／子程序）", haveOld, haveOld ? "" : oldLoadError);
  if (haveOld) {
    const probe = OLD.parseDayCountFromText("到四日市");
    check("SELF", "baseline 為修正前（舊版「到四日市」→ 4）", probe === 4, `old=${fmt(probe)}`);
  }
  const oldDays = (t) => (haveOld ? OLD.parseDayCountFromText(t) : OLD_UNAVAILABLE);
  const oldNorm = (t) => (haveOld ? OLD.normalizeDestinationAndDuration(t) : OLD_UNAVAILABLE);

  // ── G1 必須案例（任務單六項）──
  const MUST = [
    ["到二日市", undefined],
    ["到四日市", undefined],
    ["到十日町", undefined],
    ["到四日市玩三天", 3],
    ["去東京 3 日", 3],
    ["5 天 4 夜", 5],
  ];
  for (const [t, want] of MUST) {
    const got = NEW.parseDayCountFromText(t);
    check("G1", `parseDayCountFromText(${JSON.stringify(t)})`, got === want, `want=${fmt(want)} new=${fmt(got)} old=${fmt(oldDays(t))}`);
  }

  // ── G2 地名語料：新 undefined，列出舊結果 ──
  const PLACE = ["到二日市", "到四日市", "到十日町", "到五日市", "去八日市", "六日町", "四日市市", "十日町市", "10日市", "二十日市"];
  for (const t of PLACE) {
    const got = NEW.parseDayCountFromText(t);
    check("G2", `地名 ${JSON.stringify(t)} 不設天數`, got === undefined, `new=${fmt(got)} old=${fmt(oldDays(t))}`);
  }

  // ── G3 非地名語料：新舊完全一致；有期望值者另斷言 ──
  // 任務單列舉（含期望值）
  const NON_PLACE_EXPECT = [
    ["一日區域動線", 1], ["3日市區景點", 3], ["3日市場", 3], ["3日市集", 3], ["3日遊", 3], ["三日遊", 3], ["一日遊", 1],
    ["3日來回", 3], ["去日本3天", 3], ["4日間", 4], ["12月4日", undefined], ["3號", undefined], ["3", undefined],
    ["大概3天", 3], ["差不多3天", 3], ["三天左右", 3], ["3天吧", 3], ["５天", 5], ["4晚", 4], ["三天兩夜", 3],
    ["3 days", 3], ["two weeks", 14], ["2週間", 14], ["3박 4일", 4], ["我想去福岡玩兩天", 2], ["高雄2日", 2], ["台北 3 天", 3],
    ["到四日市玩三天", 3], ["去東京 3 日", 3], ["5 天 4 夜", 5],
  ];
  // 抄自既有腳本（只取字串，不改原腳本）：
  //   scripts/verify-bare-number-contextual-reply.mjs:46-56、:104、:112、:117、:230
  const FROM_BARE = ["3天", "三天", "3日", "三日", "大概3天", "差不多3天", "三天左右", "3天吧", "５天", "5天4夜", "4晚", "3號", "3", "6", "3 號", "3 天"];
  //   scripts/verify-p50-destination-duration-normalization.mjs:12-23、:40、:55-57
  const FROM_P50 = ["台北三天", "台北3天", "台北 3 天", "台北三日", "東京五天", "東京5天", "東京五日", "大阪兩天", "首爾四天", "高雄2日",
    "Taipei 3 days", "Tokyo for 5 days", "我要去台北三天"];
  //   scripts/verify-global-planning.mjs:10、:13、:19、:34、:40、:50
  const FROM_GLOBAL = ["Planning a holiday in Portugal next spring.", "Thinking of visiting Iceland for a week.", "I'd love to explore Hokkaido this winter.",
    "明年春天想去葡萄牙旅行。", "想安排一週冰島自由行。", "来年の春にポルトガルへ旅行したいです。", "冬に北海道を旅行する予定です。",
    "내년 봄에 포르투갈 여행을 계획하고 있어요.", "겨울에 홋카이도로 여행 가고 싶어요.", "Hello", "What is Portugal?", "Weather in Tokyo?",
    "今天心情很好", "4 days", "3 days", "10 days", "two weeks", "三天兩夜", "4日間", "2週間", "3박 4일", "明年3月"];
  for (const [t, want] of NON_PLACE_EXPECT) {
    const got = NEW.parseDayCountFromText(t);
    check("G3", `期望 ${JSON.stringify(t)}`, got === want, `want=${fmt(want)} new=${fmt(got)}`);
  }
  // #T130：EXPECTED FIXED BEHAVIOR — 本輪刻意修正的非地名語料（舊正則先匹配「四日」→ 4）；只列此集合，不放寬其他語料的新舊一致
  const FIXED_EXPECT = [["到四日市玩三天", 4, 3]]; // [text, 舊版預期, 新版預期]
  const FIXED_SET = new Set(FIXED_EXPECT.map(([t]) => t));
  const NON_PLACE_CORPUS = [...new Set([...NON_PLACE_EXPECT.map(([t]) => t), ...FROM_BARE, ...FROM_P50, ...FROM_GLOBAL])].filter((t) => !FIXED_SET.has(t));
  for (const [t, wantOld, wantNew] of FIXED_EXPECT) {
    const n = NEW.parseDayCountFromText(t);
    if (haveOld) {
      const o = OLD.parseDayCountFromText(t);
      check("FIXED", `${JSON.stringify(t)} 舊版=${wantOld}`, o === wantOld, `old=${fmt(o)}`);
      check("FIXED", `${JSON.stringify(t)} 新版=${wantNew}`, n === wantNew, `new=${fmt(n)}`);
      check("FIXED", `${JSON.stringify(t)} 新舊不同`, n !== o, `old=${fmt(o)} new=${fmt(n)}`);
    } else {
      check("FIXED", `${JSON.stringify(t)} 新舊比對（基準副本不可用）`, false, `無法比對 new=${fmt(n)}`);
    }
  }
  if (haveOld) {
    for (const t of NON_PLACE_CORPUS) {
      const n = NEW.parseDayCountFromText(t), o = OLD.parseDayCountFromText(t);
      check("G3", `新舊一致 ${JSON.stringify(t)}`, n === o, `new=${fmt(n)} old=${fmt(o)}`);
    }
  } else {
    check("G3", "新舊一致（基準副本不可用）", false, "無法比對");
  }

  // ── G4 normalizeDestinationAndDuration ──
  const sameNorm = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const NORM_NON_PLACE = [...FROM_P50, "東京", "京都", "台北", "Tokyo", "大阪三天", "四日市3天", "四日市三日"];
  const NORM_PLACE = ["四日市", "二日市", "十日町", "五日市", "八日市", "六日町", "四日市市", "十日町市", "10日市", "二十日市"];
  if (haveOld) {
    for (const t of NORM_NON_PLACE) {
      const n = NEW.normalizeDestinationAndDuration(t), o = OLD.normalizeDestinationAndDuration(t);
      check("G4", `normalize 新舊一致 ${JSON.stringify(t)}`, sameNorm(n, o), `new=${JSON.stringify(n)} old=${JSON.stringify(o)}`);
    }
  } else {
    check("G4", "normalize 新舊一致（基準副本不可用）", false, "無法比對");
  }
  const normPlaceOk = (t, n) => n.tripDays === undefined && n.destinationLabel === t && n.durationRemoved === false;
  for (const t of NORM_PLACE) {
    const n = NEW.normalizeDestinationAndDuration(t);
    const o = oldNorm(t);
    check("G4", `normalize 地名 ${JSON.stringify(t)}：tripDays undefined、label 不變`, normPlaceOk(t, n),
      `new=${JSON.stringify(n)} old=${o === OLD_UNAVAILABLE ? "UNAVAILABLE" : JSON.stringify(o)}`);
  }
  {
    const n = NEW.normalizeDestinationAndDuration("四日市3天");
    check("G4", "normalize 「四日市3天」→ label 四日市、tripDays 3", n.destinationLabel === "四日市" && n.tripDays === 3, JSON.stringify(n));
  }

  // ── CMP 新舊比較分類（每一案例；本段不另計 PASS/FAIL：非地名退步已在 G3／G4 計 FAIL，地名 new 錯已在 G2／G4 計 FAIL）──
  const tally = { "既有行為": 0, "本輪修正": 0, FIXED: 0, "FIXED不符預期": 0, "本輪新增退步": 0, "差異但new仍錯": 0, UNVERIFIED: 0 };
  const classify = (isPlace, same, newCorrect, oldAvailable) => {
    if (!oldAvailable) return "UNVERIFIED";
    if (same) return "既有行為";
    if (!isPlace) return "本輪新增退步";
    return newCorrect ? "本輪修正" : "差異但new仍錯";
  };
  const NOTE = { FIXED: "（EXPECTED FIXED BEHAVIOR：old/new 符合 FIXED 群組預期）", "FIXED不符預期": "（已計入 FIXED 群組 FAIL）", "本輪新增退步": "（非地名 old≠new；已計入 G3／G4 FAIL）", "差異但new仍錯": "（地名 new 仍設天數；已計入 G2／G4 FAIL）", UNVERIFIED: "（old 不可得）" };
  const MUST_PLACE = new Set(MUST.filter(([, w]) => w === undefined).map(([t]) => t));
  const dayCases = [...new Set([...MUST.map(([t]) => t), ...PLACE, ...NON_PLACE_CORPUS])];
  for (const t of dayCases) {
    const isPlace = PLACE.includes(t) || MUST_PLACE.has(t);
    const n = NEW.parseDayCountFromText(t), o = oldDays(t);
    const fx = FIXED_EXPECT.find(([ft]) => ft === t);
    const cls = fx
      ? (!haveOld ? "UNVERIFIED" : o === fx[1] && n === fx[2] ? "FIXED" : "FIXED不符預期")
      : classify(isPlace, haveOld && n === o, n === undefined, haveOld);
    tally[cls] += 1;
    out(`CMP [parseDayCount|${isPlace ? "地名" : "非地名"}] ${cls} ${JSON.stringify(t)} old=${fmt(o)} new=${fmt(n)}${NOTE[cls] ?? ""}`);
  }
  for (const t of [...NORM_NON_PLACE, ...NORM_PLACE]) {
    const isPlace = NORM_PLACE.includes(t);
    const n = NEW.normalizeDestinationAndDuration(t), o = oldNorm(t);
    const cls = classify(isPlace, haveOld && sameNorm(n, o), normPlaceOk(t, n), haveOld);
    tally[cls] += 1;
    out(`CMP [normalize|${isPlace ? "地名" : "非地名"}] ${cls} ${JSON.stringify(t)} old=${o === OLD_UNAVAILABLE ? "UNAVAILABLE" : JSON.stringify(o)} new=${JSON.stringify(n)}${NOTE[cls] ?? ""}`);
  }
  out(`CMP-TALLY ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);

  // ── G5 trip-intent（既有 export applyTripIntentToSession；src/lib/recommendation/trip-intent.ts:431、:467、:497）──
  const { createEmptySession } = await import(R + "/lib/chat-session.ts");
  const { applyTripIntentToSession } = await import(R + "/lib/recommendation/trip-intent.ts");
  for (const [t, forbidden] of [["到二日市", 2], ["到四日市", 4], ["到十日町", 10]]) {
    const s = applyTripIntentToSession(t, createEmptySession());
    check("G5", `trip-intent ${JSON.stringify(t)} tripDays≠${forbidden}`, s.tripDays !== forbidden && s.tripDays === undefined,
      `tripDays=${fmt(s.tripDays)} preferredArea=${fmt(s.preferredArea)} location.city=${fmt(s.location?.city)}`);
  }
  for (const [t, want] of [["到四日市玩三天", 3], ["去東京 3 日", 3], ["我想去福岡玩兩天", 2]]) {
    const s = applyTripIntentToSession(t, createEmptySession());
    check("G5", `trip-intent 正向控制 ${JSON.stringify(t)} tripDays=${want}`, s.tripDays === want, `tripDays=${fmt(s.tripDays)}`);
  }

  // ── G6 端到端 mergeTravelContext（主路徑；只斷言天數，目的地欄位僅列出）──
  const { mergeTravelContext } = await import(R + "/lib/ai/travel-context.ts");
  for (const [t, forbidden] of [["到二日市", 2], ["到四日市", 4], ["到十日町", 10]]) {
    const m = mergeTravelContext(createEmptySession(), t);
    const d1 = m.context?.days, d2 = m.session?.tripDays, d3 = m.session?.travelContext?.days;
    check("G6", `mergeTravelContext ${JSON.stringify(t)} 天數≠${forbidden}`, d1 !== forbidden && d2 !== forbidden && d3 !== forbidden,
      `context.days=${fmt(d1)} session.tripDays=${fmt(d2)} destination=${fmt(m.context?.destination)}（資訊）`);
  }
  {
    const m = mergeTravelContext(createEmptySession(), "到四日市玩三天");
    check("G6", "mergeTravelContext 「到四日市玩三天」context.days=3", m.context?.days === 3, `context.days=${fmt(m.context?.days)} destination=${fmt(m.context?.destination)}`);
  }

  // ── OPEN 待判定（不計 PASS/FAIL；不設預期值，交由指派者判定 Source 行為）──
  for (const t of ["京都3日町家巡禮", "3日市立美術館", "八日市場"]) {
    const n = NEW.parseDayCountFromText(t), o = oldDays(t);
    const rel = !haveOld ? "UNVERIFIED（old 不可得）" : n === o ? "old=new" : "old≠new";
    out(`OPEN [待判定] ${JSON.stringify(t)} old=${fmt(o)} new=${fmt(n)} ${rel}（不計 PASS/FAIL）`);
  }

  // ── INFO 邊界探測（不計 FAIL；old 可得時才比較並標差異）──
  const INFO = ["去八日市場", "八日市場市", "3日縣內旅遊", "3日県内", "3日村上", "三日町歩き", "3日市內觀光", "3日市中心", "二日市溫泉", "廿日市", "三日月"];
  for (const t of INFO) {
    const n = NEW.parseDayCountFromText(t), o = oldDays(t);
    const mark = !haveOld ? "  （old 不可得：UNVERIFIED，不比較）" : n !== o ? "  ← 差異" : "";
    out(`INFO [邊界] ${JSON.stringify(t)} new=${fmt(n)} old=${fmt(o)}${mark}`);
  }
} catch (e) {
  anyFail = true;
  out(`FAIL [TOP] 未預期例外：${String(e?.stack ?? e).slice(0, 600)}`);
} finally {
  globalThis.fetch = priorFetch;
  wtMod.Worker = priorWorker;
  for (const k of CP_KEYS) cpMod[k] = priorCp[k];
  console.info = oi;
  console.warn = ow;
}

check("NET", "外部請求次數 = 0", externalCalls === 0, `externalCalls=${externalCalls} offline-guard=${guardActive ? "present" : "absent"}`);
check("NET", "worker_threads.Worker 建立次數 = 0", workerCalls === 0, `workerCalls=${workerCalls}`);
out(`INFO [NET] child_process 呼叫次數=${cpCalls.length}${cpCalls.length ? `（${[...new Set(cpCalls)].join(", ")}；含 Guard 白名單 esbuild 服務，是否違規以 Guard 記錄為準）` : ""}`);
{
  const guardLogEnd = readGuardLogLines();
  if (guardLogStart === null || guardLogEnd === null) {
    check("NET", "Guard 記錄無法觀察（OFFLINE_GUARD_LOG 未設定或檔案不存在）", false,
      `env=${GUARD_LOG ? "set" : "unset"} start=${guardLogStart === null ? "unreadable" : guardLogStart.length} end=${guardLogEnd === null ? "unreadable" : guardLogEnd.length}`);
  } else {
    const added = guardLogEnd.length - guardLogStart.length;
    const kinds = guardLogEnd.slice(guardLogStart.length).map((l) => l.split(" ")[0]);
    check("NET", "Guard 記錄本測試期間新增行數 = 0", added === 0, `start=${guardLogStart.length} end=${guardLogEnd.length} added=${added}${kinds.length ? ` kinds=${kinds.join(",")}` : ""}`);
  }
}
out(`SUMMARY pass=${pass} fail=${fail}`);
out(`RESULT ${anyFail ? "FAIL" : "PASS"}`);
if (anyFail) process.exitCode = 1;
