#!/usr/bin/env node
/**
 * #PL-FIX-T4 — Planner 選擇模式：一般／place-detail 路徑「先查再決定」閘門的真實區塊驗證（離線、唯讀，不寫任何檔案）。
 * #PL-FIX-T5 — 依使用者裁定「縮小攔截範圍」更新：REQ1c（無法確認且非換城市措辭 → 照常走、不寫入未驗證名稱）、
 *   明確換城市措辭＋不可信 → 停止（經 send() 真實順序：A2 換城市閘門 SWH／SWV／SWA 或 G1）、PD-亞特蘭提斯照常 place_detail、
 *   RISK-c 改為重跑被擋的行為模擬（RS／RSE／RDE 真實區塊）、toast 紀錄不跨回合、RISK-a 與非 selection 對照的 Geocoding、
 *   審查 (a) pending 地理釐清回答、(b) 單字片段缺口、(c) advice 分支 contextPatch。
 * #PL-FIX-T6 — 第 6 輪（使用者裁定 R1-R5）：新增「T6」節（第 1 節之後）：
 *   R1-a 明確換城市措辭＋可信他城（含「改去京都」於台南 selection）先問、R1-b 無法確認 → 停、R1-c 同城子區域照常、
 *   R1-d R1 措辭非地名句誤判語料（60 句＋「改成兩天一夜」等）、R2 未驗證名稱不留在 session（一般／place-detail＋下兩句 Geocoding）、
 *   R3 pending 回答（含 Google 暫時失敗 OVER_QUERY_LIMIT）、R4 advice contextPatch 全部鍵、R5 窄範圍收緊（含「大阪的朋友推薦我吃拉麵」）、
 *   子區域推薦焦點對照非 selection。A2 換城市句（CONFIRMED_SWITCH）走真實 SWH／SWV／SWA，wrapper Commit 後以哨兵停止。
 *   只跑 T6：node scripts/verify-planner-selection-general-gate.mjs --t6-only
 * #PL-FIX-T7 — 第 7 輪（使用者裁定 1-8）：改寫衝突斷言（T6-R1a 的 A2 先問辨識為 ask_switch、T6-R1b／REQ1c-explicit-switch
 *   無法確認改為照常走＋ZERO_RESULTS 提示、T6-R5-ask 與 RISK-f 改為他城地標照常走並維持 selection 城市）；
 *   A2 的 selection CONFIRMED_SWITCH 句（selectionSwitchDeferred）依 send() 真實順序串接 G1（同一個 switchProbe）。
 *   新增「T7」節（T6 之後，--t6-only 也會跑）：N1 提示設定條件、N2 提示顯示時機（真實 effect 本體）、N3 四語系、
 *   I 附帶提及規則誤判／漏判語料、F 先問後確認完整流程（wrapper 不設哨兵）、A 非 selection A2 與剝除 T7 的區塊逐句比對。
 * #PL-FIX-T8 — 第 8 輪（使用者裁定 1-4）：修正 runSwitchTurn 覆寫順序（呼叫端 deps 最後展開、throughCommit 不設哨兵，
 *   T7-F 才能跑到 Commit 之後）；T7-N1「ZERO_RESULTS（一般句）」改為不顯示提示（裁定 4）。新增「T8」節（第 1 節之後、T6 之前，
 *   全量／--t6-only 都會跑；只跑 T8：--t8-only）：F 先問→確認→重跑原句的完整 send() 後段（A2 閘門到 send() 結尾，推薦分派計數）、
 *   L 確認記錄生命週期、A 非 selection A2 與剝除 T8 的程式逐句比對、NB 他城＋附近與附近錨點語料、I 附帶提及、N4 找不到提示。
 *
 * 取區塊方式比照 verify-planner-selection-gate-realpath.mjs：直接從 src/routes/_app.chat.tsx 取出實際程式碼，
 * 以 esbuild 去除 TS 型別後執行。本檔取出：
 *   G1  send() 一般／place-detail 路徑的 A2 閘門（"// Planner selection, general / place-detail turn naming a place" 起，
 *       到 place-detail 分支之前）
 *   G2  place-detail 分支（isPlaceDetailChatActive）
 *   G3  一般路徑：sessionForTurn → applyTripIntentToSession → mergeTravelContext → global candidate（geocode）→
 *       C3／processAdviceTurn 分支 → mergeTripPlanningContext → dropStalePlanningSelection → keepPlanningSelectionDestination
 *   PH  persistSession 開頭（dropStale＋「已離開…的選點」提示）
 *   ANS send() 換城市詢問的確認／取消回答區塊；RSE 確認後重跑原句的 useEffect 本體
 *   E1  runPlanFormHandoff 的 selection 分支（建立「已通過閘門的 selection」用）
 * 區塊內引用的識別字：凡是 _app.chat.tsx 以 import 取得者，一律依該 import 宣告載入真實模組（vite-node）；
 * 元件內的 React state／ref／callback（persistSession、completeAdviceTurn、setMsgs…）以紀錄器替代，
 * persistSession 則以真實 PH 區塊＋紀錄器組成。
 *
 * 外部請求：Google（geocode／Places）、Supabase RPC 全部 mock 並逐筆計數；任何真實 fetch／http／net 呼叫都使整體 FAIL。
 * 不讀 .env。
 *
 * 標記：[acc] 驗收（必須 PASS）；[risk] 審查發現（斷言寫「應成立」的條件；FAIL＝問題存在，不影響結束碼，於報告列出）；
 *       INFO 只陳述事實。
 * 執行：node scripts/verify-planner-selection-general-gate.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
for (const k of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER/i.test(k)) delete process.env[k];
Object.assign(process.env, { GOOGLE_MAPS_API_KEY: "mock-key", VITE_SUPABASE_URL: "http://mock-supabase.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key" });
let external = 0;
const extLog = [];
globalThis.fetch = async (u) => {
  external += 1;
  extLog.push(String(u?.url ?? u));
  throw new Error("[ext-trap] fetch blocked");
};
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  for (const m of ["http", "https"]) {
    const mod = require(m);
    for (const fn of ["request", "get"]) {
      mod[fn] = () => {
        external += 1;
        extLog.push(`${m}.${fn}`);
        throw new Error("[ext-trap] http blocked");
      };
    }
  }
  const net = require("net");
  net.connect = net.createConnection = () => {
    external += 1;
    extLog.push("net");
    throw new Error("[ext-trap] net blocked");
  };
}
const orig = { ...console };
const consoleLog = [];
for (const k of ["info", "log", "warn", "debug", "error"]) console[k] = (...a) => consoleLog.push([k, ...a]);

// ── 傳輸／框架 stub（虛擬模組，不寫檔）──
const STUBS = {
  "@tanstack/react-start": `
    export const createServerFn = () => {
      const b = {
        middleware() { return b; },
        inputValidator(fn) { b.v = fn; return b; },
        handler(fn) { return async (args) => fn({ data: b.v ? b.v(args?.data) : args?.data, context: {} }); },
      };
      return b;
    };
    export const createMiddleware = () => { const m = { server() { return m; }, client() { return m; }, middleware() { return m; } }; return m; };
  `,
  "@/lib/google-rate-limit.server": `export const requireGoogleProviderRate = {};`,
  "@/lib/public-read-auth": `export const allowGuestPublicRead = {};`,
  "@/lib/google-rest-transport": `
    export function getGoogleRestTransportToken() { return "roamie-server-proxy"; }
    export async function googleRestFetch(input, init, context) { return globalThis.__PLGG_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return false; }`,
  "@/integrations/supabase/client": `
    const any = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : any()), apply: () => any() });
    export const supabase = new Proxy({}, { get(_t, p) {
      if (p === "rpc") return async (name, args) => globalThis.__PLGG_RPC(name, args);
      if (p === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
      return any();
    } });
  `,
  sonner: `export const toast = new Proxy(function () {}, { get: () => (...a) => { (globalThis.__PLGG_TOAST ??= []).push(a); }, apply: (_t, _s, a) => { (globalThis.__PLGG_TOAST ??= []).push(a); } });`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.plgg-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "plgg-transport-stubs",
  enforce: "pre",
  resolveId(id) {
    return Object.hasOwn(STUBS, id) ? STUB_PATH(id) : null;
  },
  load(id) {
    const k = STUB_BY_PATH[id];
    return k ? STUBS[k] : null;
  },
};

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const { transform } = await import("esbuild");
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [stubPlugin, tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);

// ═════════════════════════ 輸出／斷言 ═════════════════════════
const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
const J = (v) => JSON.stringify(v);
function expect(id, cond, detail, cat = "acc") {
  rows.push({ id, ok: !!cond, cat, detail });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
  return !!cond;
}
const INFO = (s) => P(`  INFO ${s}`);
const crash = (e) => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 8).join(" | ")}\nexternal=${external}\nverify-planner-selection-general-gate: FAIL\n`);
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

// ═════════════════════════ 從 _app.chat.tsx 取出真實區塊 ═════════════════════════
const SRC_PATH = `${WORK_ROOT}/src/routes/_app.chat.tsx`;
const SRC = readFileSync(SRC_PATH, "utf8");
const lineOf = (idx) => SRC.slice(0, idx).split("\n").length;
function cut(startNeedle, endNeedle, { includeEnd = false } = {}) {
  const s = SRC.indexOf(startNeedle);
  if (s < 0) throw new Error(`找不到區塊起點：${startNeedle.slice(0, 70)}`);
  if (SRC.indexOf(startNeedle, s + 1) >= 0) throw new Error(`區塊起點不唯一：${startNeedle.slice(0, 70)}`);
  const e = SRC.indexOf(endNeedle, s + startNeedle.length);
  if (e < 0) throw new Error(`找不到區塊終點：${endNeedle.slice(0, 70)}`);
  const end = includeEnd ? e + endNeedle.length : e;
  return { s, e: end, code: SRC.slice(s, end), from: lineOf(s), to: lineOf(end - 1) };
}
const BLOCKS = {
  G1: cut("    // Planner selection, general / place-detail turn naming a place: the same A2 gate as the\n", "    if (!turnSwitchVerified && isPlaceDetailChatActive(session)) {\n"),
  G2: cut("    if (!turnSwitchVerified && isPlaceDetailChatActive(session)) {\n", "    // The geographic pending consumed at turn start goes to its answer handlers below.\n"),
  G3: cut("    // The geographic pending consumed at turn start goes to its answer handlers below.\n", "    const conversationMode = structuredHomeNearbyTurn"),
  PH: cut("      // Every persisted destination write: a Planner selection never stays with another city.\n", "      // L1: 已卸載的實例（例如舊生成完成）不得把自己的 Session 寫進另一個對話。\n"),
  ANS: cut("    const selectionSwitchAsked = selectionSwitchPendingRef.current;\n", "      // Any other answer: the question is dropped; this turn continues on the existing flow.\n    }\n", { includeEnd: true }),
  RSE: cut("    const resendText = selectionSwitchResendRef.current;\n", "    // eslint-disable-next-line react-hooks/exhaustive-deps\n"),
  E1: cut("        if (isPlanningSelectionMode(syncedHandoff)) {\n", "\n        const req = toRoamieRequest(\"chat\", bundle"),
  EQ: cut("function sameNormalizedSwitchDestination(", "\n/**\n * 7.1 checkPersisted"),
  // #PL-FIX-T5：重跑攔截（send() 開頭）與「被 streaming／generating 擋下時等待」effect 本體
  RS: cut("    // Planner selection switch confirmed: its original sentence is never dropped silently. Blocked\n", "    if (!trimmed || streaming || generating) return;\n"),
  RDE: cut("    if (streaming || generating || !selectionSwitchResendRef.current) return;\n", "  }, [streaming, generating]);"),
  // A2 換城市句（「改去〇〇」）在 G1 之前的既有閘門：helper、狀態宣告、閘門本體（到 rejectNumericSelection 之前）
  SWH: cut("    let switchCommitted = false;\n", "    if (turnSwitch.state !== \"NO_SWITCH\" && session.pendingQuestion?.type === \"date_confirmation\") {\n"),
  SWV: cut("    let turnSwitchVerified = false;\n", "    if (destinationUpdatePending) {\n"),
  SWA: cut("    if (switchFromPendingConfirm || turnSwitch.state !== \"NO_SWITCH\") {\n      const previousLabel", "    if (rejectNumericSelection(session, trimmed)) {\n"),
  // #PL-FIX-T7：「找不到」提示的 useEffect 本體（[msgs, streaming, generating]）
  NE: cut("    if (streaming || generating) return;\n    const notice = peekPlanningSelectionTurnNotice();\n", "  }, [msgs, streaming, generating]);"),
};
P(`══ 0. 取出的真實區塊（${SRC_PATH}）══`);
for (const [k, b] of Object.entries(BLOCKS)) INFO(`${k}: L${b.from}-L${b.to}`);

// _app.chat.tsx 的 import 宣告：識別字 → 模組
const IMPORTS = new Map();
for (const m of SRC.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";/gm)) {
  if (m[1]) continue;
  for (const part of m[2].split(",").map((x) => x.trim()).filter(Boolean)) {
    if (part.startsWith("type ")) continue;
    const [name, alias] = part.split(/\s+as\s+/).map((x) => x.trim());
    IMPORTS.set(alias ?? name, { mod: m[3], name });
  }
}
const modFile = (spec) => {
  if (!spec.startsWith("@/")) return null;
  const base = `${WORK_ROOT}/src/${spec.slice(2)}`;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (existsSync(c) && !c.endsWith("/")) { try { if (readFileSync(c)) return c; } catch {} }
  return null;
};
const IDENT_RE = /[A-Za-z_$][\w$]*/g;
const JS_GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));

let runner = null;
const modCache = new Map();
async function freshRunner() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  modCache.clear();
}
async function loadMod(file) {
  if (!modCache.has(file)) modCache.set(file, await runner.executeFile(file));
  return modCache.get(file);
}
/** 區塊內出現、且由 _app.chat.tsx import 的識別字 → 真實模組匯出。 */
async function importedDeps(code) {
  const deps = {};
  const failed = [];
  for (const id of new Set(code.match(IDENT_RE) ?? [])) {
    const imp = IMPORTS.get(id);
    if (!imp) continue;
    const file = modFile(imp.mod);
    if (!file) continue;
    try {
      const mod = await loadMod(file);
      if (imp.name in mod) deps[id] = mod[imp.name];
      else failed.push(`${id}(not exported by ${imp.mod})`);
    } catch (e) {
      failed.push(`${id}(${imp.mod}: ${String(e?.message ?? e).split("\n")[0].slice(0, 80)})`);
    }
  }
  return { deps, failed };
}
const missing = new Set();
/**
 * 把區塊包成 async 函式。識別字查找順序：區塊內宣告 → scope（明確 deps → import 的真實模組）→ JS 全域。
 * 不在 scope 也不是 JS 全域的識別字被讀取時記入 missing 並丟出（用來發現遺漏的 React 依賴，而不是默默給 undefined）。
 */
async function compile(code, tail = 'return "__FALLTHROUGH__";') {
  const js = (await transform(`(async () => {\n${code}\n${tail}\n})`, { loader: "ts", target: "es2022" })).code.trim().replace(/;$/, "");
  if (/["']use strict["']/.test(js)) throw new Error("esbuild 輸出含 use strict（with 不可用）");
  const factory = (0, eval)(`(function (__scope) { with (__scope) { return ${js}; } })`);
  return (scopeObj) => {
    const scope = new Proxy(scopeObj, {
      has: (t, k) => typeof k === "string" && (k in t || !JS_GLOBALS.has(k)),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        missing.add(String(k));
        throw new ReferenceError(`[harness] 區塊引用了未提供的識別字：${String(k)}`);
      },
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    });
    return factory(scope)();
  };
}

// ═════════════════════════ Mock Google（Legacy Geocoding；逐筆計數）═════════════════════════
const comp = (long, types, short = long) => ({ long_name: long, short_name: short, types });
const AAL1 = ["administrative_area_level_1", "political"];
const AAL2 = ["administrative_area_level_2", "political"];
const LOC = ["locality", "political"];
const SUB1 = ["sublocality_level_1", "sublocality", "political"];
const NB = ["neighborhood", "political"];
const TW = comp("台灣", ["country", "political"], "TW");
const JP = comp("日本", ["country", "political"], "JP");
const gres = (pid, fa, lat, lng, types, comps) => ({ address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE", viewport: { northeast: { lat: lat + 0.05, lng: lng + 0.05 }, southwest: { lat: lat - 0.05, lng: lng - 0.05 } } }, place_id: `mock-pid-${pid}`, types });
const GEO = {
  // 城市
  新北: gres("newtaipei", "台灣新北市", 25.0169, 121.4628, AAL1, [comp("新北市", AAL1), TW]),
  台北: gres("taipei", "台灣台北市", 25.033, 121.5654, AAL1, [comp("台北市", AAL1), TW]),
  台南: gres("tainan", "台灣台南市", 22.9997, 120.227, AAL1, [comp("台南市", AAL1), TW]),
  宜蘭: gres("yilan", "台灣宜蘭縣", 24.7021, 121.7378, AAL1, [comp("宜蘭縣", AAL1), TW]),
  台中: gres("taichung", "台灣台中市", 24.1477, 120.6736, AAL1, [comp("台中市", AAL1), TW]),
  花蓮: gres("hualien", "台灣花蓮縣", 23.9872, 121.6016, AAL1, [comp("花蓮縣", AAL1), TW]),
  京都: gres("kyoto", "日本京都府京都市", 35.0116, 135.7681, LOC, [comp("京都市", LOC), comp("京都府", AAL1), JP]),
  東京: gres("tokyo", "日本東京都", 35.6762, 139.6503, AAL1, [comp("東京都", AAL1), JP]),
  大阪: gres("osaka", "日本大阪府大阪市", 34.6937, 135.5023, LOC, [comp("大阪市", LOC), comp("大阪府", AAL1), JP]),
  輕井澤: gres("karuizawa", "日本長野縣北佐久郡輕井澤町", 36.3485, 138.597, LOC, [comp("輕井澤町", LOC), comp("北佐久郡", AAL2), comp("長野縣", AAL1), JP]),
  // #PL-FIX-T6：本機已知城市、但需要 Geocoding 才可信（用來模擬 Google 暫時失敗）
  札幌: gres("sapporo", "日本北海道札幌市", 43.0618, 141.3545, LOC, [comp("札幌市", LOC), comp("北海道", AAL1), JP]),
  // 子區域（selection 範圍內）
  淡水: gres("tamsui", "台灣新北市淡水區", 25.1696, 121.4407, AAL2, [comp("淡水區", AAL2), comp("新北市", AAL1), TW]),
  "新北市淡水區": gres("tamsui", "台灣新北市淡水區", 25.1696, 121.4407, AAL2, [comp("淡水區", AAL2), comp("新北市", AAL1), TW]),
  九份: gres("jiufen", "台灣新北市瑞芳區九份", 25.1094, 121.8446, NB, [comp("九份", NB), comp("瑞芳區", AAL2), comp("新北市", AAL1), TW]),
  板橋: gres("banqiao", "台灣新北市板橋區", 25.0116, 121.4637, AAL2, [comp("板橋區", AAL2), comp("新北市", AAL1), TW]),
  三峽: gres("sanxia", "台灣新北市三峽區", 24.9343, 121.3687, AAL2, [comp("三峽區", AAL2), comp("新北市", AAL1), TW]),
  野柳: gres("yehliu", "台灣新北市萬里區野柳", 25.2063, 121.6905, NB, [comp("野柳", NB), comp("萬里區", AAL2), comp("新北市", AAL1), TW]),
  金瓜石: gres("jinguashi", "台灣新北市瑞芳區金瓜石", 25.1077, 121.8574, NB, [comp("金瓜石", NB), comp("瑞芳區", AAL2), comp("新北市", AAL1), TW]),
  北投: gres("beitou", "台灣台北市北投區", 25.1321, 121.4987, AAL2, [comp("北投區", AAL2), comp("台北市", AAL1), TW]),
  士林: gres("shilin", "台灣台北市士林區", 25.0928, 121.5244, AAL2, [comp("士林區", AAL2), comp("台北市", AAL1), TW]),
  大稻埕: gres("dadaocheng", "台灣台北市大同區大稻埕", 25.0566, 121.5101, NB, [comp("大稻埕", NB), comp("大同區", AAL2), comp("台北市", AAL1), TW]),
  安平: gres("anping", "台灣台南市安平區", 23.0017, 120.1606, AAL2, [comp("安平區", AAL2), comp("台南市", AAL1), TW]),
  七股: gres("qigu", "台灣台南市七股區", 23.1407, 120.1407, AAL2, [comp("七股區", AAL2), comp("台南市", AAL1), TW]),
  礁溪: gres("jiaoxi", "台灣宜蘭縣礁溪鄉", 24.8268, 121.7707, AAL2, [comp("礁溪鄉", AAL2), comp("宜蘭縣", AAL1), TW]),
  羅東: gres("luodong", "台灣宜蘭縣羅東鎮", 24.6775, 121.7666, AAL2, [comp("羅東鎮", AAL2), comp("宜蘭縣", AAL1), TW]),
  嵐山: gres("arashiyama", "日本京都府京都市右京區嵐山", 35.0094, 135.6668, NB, [comp("嵐山", NB), comp("右京區", SUB1), comp("京都市", LOC), comp("京都府", AAL1), JP]),
  祇園: gres("gion", "日本京都府京都市東山區祇園", 35.0037, 135.7788, NB, [comp("祇園", NB), comp("東山區", SUB1), comp("京都市", LOC), comp("京都府", AAL1), JP]),
  伏見: gres("fushimi", "日本京都府京都市伏見區", 34.9361, 135.7613, SUB1, [comp("伏見區", SUB1), comp("京都市", LOC), comp("京都府", AAL1), JP]),
  淺草: gres("asakusa", "日本東京都台東區淺草", 35.7148, 139.7967, SUB1, [comp("淺草", SUB1), comp("台東區", LOC), comp("東京都", AAL1), JP]),
  新宿: gres("shinjuku", "日本東京都新宿區", 35.6938, 139.7034, LOC, [comp("新宿區", LOC), comp("東京都", AAL1), JP]),
  澀谷: gres("shibuya", "日本東京都澀谷區", 35.664, 139.6982, LOC, [comp("澀谷區", LOC), comp("東京都", AAL1), JP]),
  難波: gres("namba", "日本大阪府大阪市中央區難波", 34.6655, 135.5013, SUB1, [comp("難波", SUB1), comp("中央區", SUB1), comp("大阪市", LOC), comp("大阪府", AAL1), JP]),
  心齋橋: gres("shinsaibashi", "日本大阪府大阪市中央區心齋橋", 34.6748, 135.5012, SUB1, [comp("心齋橋", SUB1), comp("中央區", SUB1), comp("大阪市", LOC), comp("大阪府", AAL1), JP]),
};
const GEO_KEYS = Object.keys(GEO).sort((a, b) => b.length - a.length);
let googleReqs = [];
globalThis.__PLGG_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const query = url.searchParams.get("address") ?? body?.input ?? body?.textQuery;
  googleReqs.push({ kind, query });
  if (kind === "geocode") {
    const q = String(query ?? "");
    // #PL-FIX-T6：模擬 Google 暫時失敗（OVER_QUERY_LIMIT），只在指定關鍵字開啟
    if ((globalThis.__PLGG_GEO_FAIL ?? []).some((k) => q.includes(k))) return Response.json({ status: "OVER_QUERY_LIMIT", results: [] });
    // 敏感度探針：可暫時讓通用詞（博物館、老街…）回傳某城市的 POI（模擬真實 Google 對通用詞也有結果）
    const extra = globalThis.__PLGG_GEO_EXTRA ?? {};
    const xKey = Object.keys(extra).find((k) => q.includes(k));
    if (xKey) return Response.json({ status: "OK", results: [extra[xKey]] });
    const key = GEO_KEYS.find((k) => q.includes(k));
    return Response.json(key ? { status: "OK", results: [GEO[key]] } : { status: "ZERO_RESULTS", results: [] });
  }
  if (kind === "autocomplete") return Response.json({ suggestions: [] });
  return Response.json({});
};
let placeCalls = [];
let placeSeq = 0;
const mockSearchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng });
  const base = { lat: Number.isFinite(data.lat) ? data.lat : 0.5, lng: Number.isFinite(data.lng) ? data.lng : 0.5 };
  const places = [0, 1, 2].map((i) => {
    placeSeq += 1;
    return { id: `ChIJplgg${placeSeq}`, name: `示意地點${placeSeq}`, address: `${data.destinationName ?? ""} 示意地址${placeSeq}`, formattedAddress: `${data.destinationName ?? ""} 示意地址${placeSeq}`, lat: base.lat + 0.001 * (i + 1), lng: base.lng + 0.001 * (i + 1), rating: 4.5, userRatingCount: 500, types: ["tourist_attraction"], primaryType: "tourist_attraction", businessStatus: "OPERATIONAL" };
  });
  return { places, error: null, rawCount: places.length };
};
let rpcLog = [];
let ledgerSeq = 0;
globalThis.__PLGG_RPC = async (name, args) => {
  rpcLog.push({ name, args });
  if (name === "credits_check") return { data: { ok: true, usable_credits: 20 }, error: null };
  if (name === "credits_reserve") return { data: { ok: true, ledger_id: `mock-ledger-${++ledgerSeq}`, status: "reserved" }, error: null };
  if (name === "credits_commit") return { data: { ok: true, status: "committed" }, error: null };
  if (name === "credits_rollback") return { data: { ok: true, status: "rolled_back" }, error: null };
  return { data: null, error: null };
};

// ═════════════════════════ 執行環境 ═════════════════════════
const ALL_CODE = Object.values(BLOCKS).map((b) => b.code).join("\n");
let IMP = {};
let M = {};
async function freshWorld() {
  await freshRunner();
  // 測試自己建立 session 時另外用到的 import（與 _app.chat.tsx 同一個匯出）
  const r = await importedDeps(`${ALL_CODE}\nroamieRecToChatItem enterPlaceDetailChat markPlanHandoffComplete planningSelectionTurnNamesPlace rejectNumericSelection isRepeatedTripDateConfirmation REFRESH_DESTINATION_RECOMMENDATIONS_OPTION classifyDestinationSwitchTurn isPlanningSelectionContinuation resolveExplicitNearbyIntent buildPendingParentScopeClarification buildPendingGeographicClarification planningSelectionTurnRequestsSwitch planningSelectionTurnWrittenDestination mergeTravelContext applyTripIntentToSession mergeContextForPlaceFetch resolveCategoryTurnDestination validateCategoryTurnDestination planCategoryTurnClarification clearConfirmedPlanningSelectionSwitch rememberConfirmedPlanningSelectionSwitch takeConfirmedPlanningSelectionSwitch planningSelectionTurnNearbyAnchor planningSelectionTurnMentionsPlaceIncidentally planningSelectionTurnSwitchTarget clearPlanningSelectionTurnNotice`);
  IMP = r.deps;
  M = {
    ps: await loadMod(`${WORK_ROOT}/src/lib/planning-selection.ts`),
    pth: await loadMod(`${WORK_ROOT}/src/lib/plan-trip-handoff.ts`),
    lf: await loadMod(`${WORK_ROOT}/src/lib/location.functions.ts`),
    cff: await loadMod(`${WORK_ROOT}/src/lib/credits/feature-flag.ts`),
    crc: await loadMod(`${WORK_ROOT}/src/lib/chat-runtime-copy.ts`),
    tpc: await loadMod(`${WORK_ROOT}/src/lib/ai/trip-planning-context.ts`),
    lock: await loadMod(`${WORK_ROOT}/src/lib/ai/chat-generation-lock.ts`),
  };
  M.cff.setCreditsFeatureEnabledOverride?.(true);
  return r.failed;
}
const loadFailed = await freshWorld();
if (loadFailed.length) INFO(`無法載入的 import（若被區塊實際用到會在執行時報 missing）：${J(loadFailed.slice(0, 20))}`);

/** 一個「聊聊頁實例」：React state／ref 以紀錄器替代；persistSession＝真實 PH 區塊＋紀錄。 */
async function makeEnv(initialSession, { locale = "zh-TW" } = {}) {
  const env = { msgs: [], persisted: [], toasts: [], pending: null, streaming: [], advice: [], streamChat: [], stops: [], sends: [], resendTick: 0 };
  globalThis.__PLGG_TOAST = env.toasts;
  const sessionRef = { current: initialSession };
  const msgsRef = { current: [] };
  const selectionSwitchPendingRef = { current: null };
  const selectionSwitchResendRef = { current: null };
  const setMsgs = (next) => {
    env.msgs = typeof next === "function" ? next(env.msgs) : next;
    msgsRef.current = env.msgs;
  };
  const toast = new Proxy(function () {}, { get: (_t, kind) => (...a) => env.toasts.push([String(kind), ...a]) });
  const geocodeLocationFn = async (args) => M.lf.geocodeTripLocationFromText(args);
  const base = { ...IMP, locale, toast, sessionRef, msgsRef, setMsgs, geocodeLocationFn, searchNearbyPlaces: mockSearchPlaces, hasPlusAccess: false };
  const eqFn = await compile(`${BLOCKS.EQ.code}\nreturn isEquivalentSwitchDestination;`, "");
  const eqObj = { ...IMP };
  const isEquivalentSwitchDestination = await eqFn(eqObj);
  const sameNormalizedSwitchDestination = eqObj.sameNormalizedSwitchDestination;
  Object.assign(env, { sessionRef, msgsRef, selectionSwitchPendingRef, selectionSwitchResendRef, base, locale });
  env.deps = {
    ...base,
    isEquivalentSwitchDestination,
    sameNormalizedSwitchDestination,
    persistSession: (next) => {
      // 元件內的 persistSession 是同步 callback：以同步編譯的真實 PH 區塊處理（preparePersistHeadSync）。
      const r = persistHeadSync(next);
      env.persisted.push(r);
      sessionRef.current = r;
      return r;
    },
    setText: () => {},
    setStreaming: (v) => env.streaming.push(v),
    setSelectionSwitchPending: (next) => {
      selectionSwitchPendingRef.current = next;
      env.pending = next;
    },
    selectionSwitchPendingRef,
    selectionSwitchResendRef,
    setSelectionSwitchResendTick: (fn) => {
      env.resendTick = typeof fn === "function" ? fn(env.resendTick) : fn;
    },
    captureSessionAuthority: () => ({ token: 1 }),
    isSessionAuthorityCurrent: () => env.authorityCurrent !== false,
    markShortcutEngaged: () => {},
    scrollToUserMessage: () => {},
    stopCommittedSwitchTurn: (...a) => env.stops.push(a),
    completeAdviceTurn: async (turn, nextSession) => {
      env.advice.push({ turn, nextSession });
    },
    streamChat: async (conversation, payload, nextSession) => {
      env.streamChat.push({ payload, nextSession });
    },
    pushMorePlaceRecommendations: async (session, text) => {
      env.pushMore = (env.pushMore ?? 0) + 1;
      return true;
    },
    pushNearbyPlaceRecommendation: async () => true,
    pushDestinationCategoryPlaceRecommendation: async (s, text, conversation, o) => {
      (env.categoryPush ??= []).push({ session: s, text, opts: o });
      return true;
    },
    ensurePlaceDetailFocusCoordinates: async (s) => s,
    fetchPlaceDetailsForFocus: async () => null,
    openExternal: () => {},
    nearbyPushRuntimeRef: { current: null },
    uiT: (k) => k,
    t: (k) => k,
    globalResolutionEpochRef: { current: 0 },
    // send() 開頭已計算的本回合狀態（一般使用者輸入、非 switch 回合、無 pending）
    turnSwitchVerified: false,
    switchedSession: null,
    switchTrustedDestination: undefined,
    switchAuthorityRecord: null,
    switchAuthorityCountry: undefined,
    switchAuthorityCountryCode: undefined,
    switchSavedCountryCode: undefined,
    switchProbe: { providerCalls: 0 },
    explicitNearbyAuthority: null,
    turnPendingGeographic: undefined,
    destinationUpdatePending: false,
    opts: { source: "user" },
    rtSource: "user",
  };
  return env;
}
// PH 區塊沒有 await：以同步編譯版本供 persistSession 使用（元件內的 persistSession 是同步 callback）。
let persistHeadSync = null;
async function preparePersistHeadSync(env) {
  const js = (await transform(`(() => {\n${BLOCKS.PH.code}\nreturn next;\n})`, { loader: "ts", target: "es2022" })).code.trim().replace(/;$/, "");
  const factory = (0, eval)(`(function (__scope) { with (__scope) { return ${js}; } })`);
  persistHeadSync = (nextInput) => factory(new Proxy({ ...env.base, nextInput }, { has: (t, k) => typeof k === "string" && (k in t || !JS_GLOBALS.has(k)), get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; missing.add(String(k)); throw new ReferenceError(`[harness] PH 未提供：${String(k)}`); } }))();
}

const GENERAL = await compile(`${BLOCKS.G1.code}\n${BLOCKS.G3.code}`, 'return { reached: "after_keep", nextSession, merged, selectionTurnFocus };');
const PLACE_DETAIL = await compile(`${BLOCKS.G1.code}\n${BLOCKS.G2.code}`, 'return { reached: "not_place_detail" };');
const ANSWER = await compile(BLOCKS.ANS.code);
const RESEND = await compile(BLOCKS.RSE.code, "return;");
const RESEND_GUARD = await compile(BLOCKS.RS.code, 'return "__PROCEED__";');
const RESEND_DEFER = await compile(BLOCKS.RDE.code, "return;");
// #PL-FIX-T7：A2 區塊內 selection 的 CONFIRMED_SWITCH 句交給 selection 一般路徑（selectionSwitchDeferred）；
//   回傳本回合 A2 的 switchProbe，供串接 G1 時重用（不得多打 Geocoding）。
const SWITCH = await compile(`${BLOCKS.SWH.code}\n${BLOCKS.SWV.code}\n${BLOCKS.SWA.code}`, 'return { reached: "after_switch_gate", turnSwitchVerified, selectionSwitchDeferred: typeof selectionSwitchDeferred === "undefined" ? undefined : selectionSwitchDeferred, switchProbe };');
const E1 = await compile(BLOCKS.E1.code);

/** 換城市措辭的句子（turnSwitch≠NO_SWITCH）在 send() 內先經過既有 A2 閘門（SWH＋SWV＋SWA 真實區塊）；NO_SWITCH 的句子才走 G1。 */
// #PL-FIX-T8：修正覆寫順序——原本先展開 env.deps 再固定覆寫會丟 __A2_COMMITTED__ 的 storeDestinationSwitchCardBoundary，
//   呼叫端（T7-F 的 rerunDeps）傳入的替代函式因此被蓋掉，T7-F 結構上不可能 PASS。
//   現在：throughCommit=true 時不設哨兵（wrapper Commit 後繼續跑 D5／E3），opts.deps 最後展開（呼叫端的替代一定生效）。
async function runSwitchTurn(env, text, { throughCommit = false, deps: overrideDeps = {} } = {}) {
  const r0 = rpcLog.length;
  const p0 = placeCalls.length;
  const g0 = googleReqs.length;
  const c0 = consoleLog.length;
  const persisted0 = env.persisted.length;
  const session = env.sessionRef.current;
  const turnSwitch = IMP.classifyDestinationSwitchTurn(text);
  let ret;
  let error = null;
  try {
    ret = await SWITCH({
      ...env.deps,
      trimmed: text,
      displayMessage: text,
      session,
      msgs: env.msgs,
      turnSwitch,
      turnStartSession: { ...session, pendingClarification: undefined },
      turnResetBase: { planningSessionId: session.planningSessionId, planVersion: session.planVersion },
      turnSourceIsUser: true,
      turnPendingGeographic: undefined,
      showSwitchTurnUserMessage: () => {
        const m = [...env.msgsRef.current, { role: "user", content: text }];
        env.deps.setMsgs ? env.deps.setMsgs(m) : env.base.setMsgs(m);
        return m;
      },
      destinationSwitchSyncPendingRef: { current: null },
      destinationSwitchCardBoundaryRef: { current: null },
      // #PL-FIX-T6：A2 wrapper Commit（switchCommitted = true）之後第一個呼叫的元件內 helper。
      //   走到這裡＝本回合已重設 Planner、換城市且未先問；以哨兵例外停在此處（之後的 D5 寫入與推薦不再模擬）。
      //   #PL-FIX-T8：throughCommit=true 時不設哨兵。
      storeDestinationSwitchCardBoundary: throughCommit
        ? () => {}
        : () => {
            throw new Error("__A2_COMMITTED__");
          },
      turnPreviousSession: session,
      ...overrideDeps,
    });
  } catch (e) {
    error = String(e?.message ?? e).split("\n")[0];
  }
  const gate = consoleLog.slice(c0).filter((l) => l[1] === "[DESTINATION_SWITCH_GATE]").map((l) => l[2]);
  return {
    state: turnSwitch.state,
    target: turnSwitch.targetLabel ?? null,
    ret,
    error,
    gate,
    deferred: Boolean(ret?.selectionSwitchDeferred) && !ret?.turnSwitchVerified,
    switchProbe: ret?.switchProbe,
    lastMsg: env.msgs.at(-1)?.content ?? "",
    rpc: rpcLog.length - r0,
    places: placeCalls.length - p0,
    geocodes: googleReqs.slice(g0).filter((g) => g.kind === "geocode").map((g) => g.query),
    persisted: env.persisted.length - persisted0,
    after: env.sessionRef.current,
  };
}

/** 一次一般路徑使用者回合（G1 → G3），回傳本回合的計數與結果。 */
async function runGeneral(env, text, { placeDetail = false, extraDeps = {}, fnOverride = null } = {}) {
  const r0 = rpcLog.length;
  const p0 = placeCalls.length;
  const g0 = googleReqs.length;
  const c0 = consoleLog.length;
  const t0 = env.toasts.length;
  const a0 = env.advice.length;
  const s0 = env.streamChat.length;
  const before = env.sessionRef.current;
  env.pending = null;
  const session = env.sessionRef.current;
  const fn = fnOverride ?? (placeDetail ? PLACE_DETAIL : GENERAL);
  let ret;
  let error = null;
  try {
    // send() L9976：一般使用者輸入（非 structured shortcut）時 explicitNearbyAuthority＝resolveExplicitNearbyIntent(trimmed)
    const explicitNearbyAuthority = IMP.resolveExplicitNearbyIntent(text) ?? null;
    ret = await fn({ ...env.deps, explicitNearbyAuthority, trimmed: text, displayMessage: text, session, msgs: env.msgs, turnStartSession: session, turnPreviousSession: session, ...extraDeps });
  } catch (e) {
    error = String(e?.message ?? e).split("\n")[0];
  }
  const gateLogs = consoleLog.slice(c0).filter((l) => l[1] === "[PLANNING_SELECTION_SCOPE_GATE]").map((l) => l[2]);
  const geocodes = googleReqs.slice(g0).filter((g) => g.kind === "geocode").map((g) => g.query);
  const lastMsg = env.msgs.at(-1)?.content ?? "";
  const unconfirmedCopy = M.crc.chatRuntimeCopy("planningSelectionTurnDestinationUnconfirmed", env.locale);
  const outcome = error
    ? `error(${error})`
    : env.pending?.entry === "general"
      ? "ask_switch"
      : lastMsg === unconfirmedCopy && gateLogs.some((g) => g?.entry === "general")
        ? "unconfirmed"
        : env.advice.length > a0
          ? "advice_branch"
          : ret?.reached === "after_keep"
            ? "proceed"
            : env.streamChat.length > s0
              ? "place_detail_stream"
              : ret === undefined
                ? "returned"
                : String(ret?.reached ?? ret);
  const final = ret?.nextSession ?? (env.advice.length > a0 ? env.advice.at(-1).nextSession : env.streamChat.length > s0 ? env.streamChat.at(-1).nextSession : env.sessionRef.current);
  return {
    outcome,
    gateReason: gateLogs.find((g) => g?.entry === "general")?.reason,
    ret,
    before,
    final,
    focus: ret?.selectionTurnFocus,
    pending: env.pending,
    rpc: rpcLog.slice(r0).map((r) => r.name),
    places: placeCalls.length - p0,
    geocodes,
    gateGeocodes: null,
    toasts: env.toasts.slice(t0),
    lastMsg,
  };
}

// ═════════════════════════ Selection 建立（真實 preparePlanTripSession → 真實 E1 區塊）═════════════════════════
const D = (country, city, region, display, lat, lng) => ({ placeId: `mock-pid-${display}`, country, city, region, lat, lng, formattedName: `${country}・${display}`, displayLabel: display, address: `${country}${city}` });
const DEST = {
  新北: D("台灣", "新北市", "新北市", "新北", 25.0169, 121.4628),
  台北: D("台灣", "台北市", "台北市", "台北", 25.033, 121.5654),
  台南: D("台灣", "台南市", "台南市", "台南", 22.9997, 120.227),
  宜蘭: D("台灣", "宜蘭縣", "宜蘭縣", "宜蘭", 24.7021, 121.7378),
  京都: D("日本", "京都市", "京都府", "京都", 35.0116, 135.7681),
  東京: D("日本", "東京都", "東京都", "東京", 35.6762, 139.6503),
  大阪: D("日本", "大阪市", "大阪府", "大阪", 34.6937, 135.5023),
};
async function buildSelection(key) {
  const dest = DEST[key];
  const form = { destination: dest, origin: null, days: 2, mood: "", styles: ["美食探索", "城市漫遊"], normalizedStyles: ["美食探索", "城市漫遊"], startDate: "2026-12-01", endDate: "2026-12-02", departureTime: "09:00", transport: "步行" };
  const s = M.pth.preparePlanTripSession(form, { location: { lat: dest.lat, lng: dest.lng, city: key }, weather: null, time: new Date().toISOString(), preferences: {} }, undefined, { planAiMode: true, localeStyleOptions: form.styles });
  const env = await makeEnv(s);
  await preparePersistHeadSync(env);
  const r0 = rpcLog.length;
  const ret = await E1({ ...env.deps, syncedHandoff: s, handoffSession: s, prefs: {}, selectionTrace: undefined, selectionLoadingCleared: false, logPlanningSelectionHandoffStage: () => {}, logPlanningSelectionHandoffLoading: () => {}, markPlanHandoffComplete: IMP.markPlanHandoffComplete ?? (() => {}), userProfileForReasonFrom: () => null, getAiPreferences: async () => ({}), getUserProfile: async () => ({}), ensureSubscriptionHydratedForCredits: () => true, roamieRecToChatItem: IMP.roamieRecToChatItem });
  const sess = { ...env.sessionRef.current, pendingHandoff: false, planHandoffDone: true };
  const recs = env.msgs.at(-1)?.roamie?.recommendations ?? [];
  const picks = recs.slice(0, 2).map((r) => IMP.roamieRecToChatItem(r));
  const withSel = picks.reduce((acc, p) => M.ps.togglePlanningSelectionPlace(acc, p), sess);
  return { session: withSel, picks, e1Rpc: rpcLog.slice(r0).map((r) => r.name), e1Ret: ret };
}
const selectedFromSelection = (s, picks) => (s?.selectedPlaces ?? []).filter((p) => picks.some((q) => (q.googlePlaceId || q.id) === (p.googlePlaceId || p.id))).length;
/** 會被後續步驟當成目的地讀取的欄位中，含有 name 的欄位路徑。 */
function destFieldsWith(s, name) {
  if (!s || !name) return [];
  const fields = {
    "tripDestination": s.tripDestination,
    "location": s.location,
    "preferredArea": s.preferredArea,
    "travelContext.destination": s.travelContext?.destination,
    "travelContext.destinationCandidate": s.travelContext?.destinationCandidate,
    "travelContext.destinationInputNames": s.travelContext?.destinationInputNames,
    "tripPlanningContext.destination": s.tripPlanningContext?.destination,
    "recommendationSession.destination": s.recommendationSession?.destination,
    "activeRecommendationContext.destinationName": s.activeRecommendationContext?.destinationName,
  };
  return Object.entries(fields).filter(([, v]) => v != null && JSON.stringify(v).includes(name)).map(([k]) => k);
}
/** 與回合前不同、且含 name 的目的地欄位（排除回合前就已存在的值）。 */
function newDestFieldsWith(before, after, name) {
  const get = (s, k) => k.split(".").reduce((o, p) => o?.[p], s);
  return destFieldsWith(after, name).filter((k) => JSON.stringify(get(after, k)) !== JSON.stringify(get(before, k)));
}
const labels = (s) => ({
  trip: s?.tripDestination?.displayLabel ?? s?.tripDestination?.city ?? null,
  loc: s?.location?.city ?? s?.location?.displayLabel ?? null,
  travel: s?.travelContext?.destination ?? null,
  planning: s?.tripPlanningContext?.destination ?? null,
});

P("\n══ 1. 建立 7 個已通過閘門的 selection（真實 E1 區塊）＋各選 2 個推薦地點 ══");
const SEL = {};
for (const key of Object.keys(DEST)) {
  const b = await buildSelection(key);
  SEL[key] = b;
  const lv = ["qualified", "destination", "parent"].map((l) => M.ps.planningSelectionDestinationLabel(b.session, l));
  INFO(`${key}：E1 Credits=${J(b.e1Rpc)} 已選 ${selectedFromSelection(b.session, b.picks)} 個 trustedDestination=${J(b.session.planningSelection?.trustedDestination)} 閘門標籤（qualified/名稱/上一層）=${J(lv)}`);
  expect(`SETUP-${key}-selection-trusted`, M.ps.isPlanningSelectionMode(b.session) && b.picks.length === 2 && J(b.e1Rpc) === J(["credits_check", "credits_reserve", "credits_commit"]), `selection ${key} 建立完成（E1 扣 1 次、選 2 個地點）`);
}
if (missing.size) INFO(`E1 區塊 missing 識別字：${J([...missing])}`);

// 需求 3：qualified 標籤不得「台南市台南」這類重複
{
  const dupCases = [];
  for (const [key, b] of Object.entries(SEL)) {
    const q = M.ps.planningSelectionDestinationLabel(b.session, "qualified");
    if (q && (q.startsWith(`${key}市`) || q.startsWith(`${key}縣`) || q.startsWith(`${key}府`) || q.startsWith(`${key}都`) || q === `${key}${key}`)) dupCases.push(q);
  }
  // 區級 selection：region＝台南市、名稱＝台南（同名）以外，區名不同時才 qualified
  const tn = SEL["台南"].session;
  const forged = { ...tn, tripDestination: { ...tn.tripDestination, city: "台南", region: "台南市", district: undefined }, planningSelection: { ...tn.planningSelection, destinationScope: { ...tn.planningSelection.destinationScope, name: "台灣・台南" } } };
  const q2 = M.ps.planningSelectionDestinationLabel(forged, "qualified");
  const anping = { ...tn, tripDestination: { ...tn.tripDestination, city: "安平區", region: "台南市", district: undefined }, planningSelection: { ...tn.planningSelection, destinationScope: { ...tn.planningSelection.destinationScope, name: "台灣・安平區" } } };
  const q3 = M.ps.planningSelectionDestinationLabel(anping, "qualified");
  INFO(`qualified 標籤：7 個城市 selection=${J(Object.fromEntries(Object.entries(SEL).map(([k, b]) => [k, M.ps.planningSelectionDestinationLabel(b.session, "qualified") ?? null])))}；名稱「台南」＋region「台南市」=${J(q2 ?? null)}；名稱「安平區」＋region「台南市」=${J(q3 ?? null)}`);
  expect("REQ3-qualified-no-duplicate", dupCases.length === 0 && q2 === undefined, `不產生「台南市台南」類重複標籤（重複=${J(dupCases)}，台南＋台南市=${J(q2 ?? null)}）`);
}

// ═════════════════════════ T8. #PL-FIX-T8 第 8 輪（使用者裁定 1-4）═════════════════════════
// 放在 T6 之前（全量、--t6-only 都會跑）；只跑本節：node scripts/verify-planner-selection-general-gate.mjs --t8-only
// F  先問 → 「好」／確認 chip → 重跑原句：真實 send() 從 A2 閘門（SWH＋SWV）一路到 send() 結尾（A2REST），推薦呼叫以紀錄器計數
// L  確認記錄（模組層狀態）生命週期：改說別句／取消／換對話／重新整理／非 selection 同一句／同一句第二次
// A  非 selection 的 A2：目前程式 vs 逐字剝除 #PL-FIX-T8 行的同一段程式，完整 send() 後段逐句比對
// NB 他城＋附近（裁定 2）＋附近錨點誤判／漏判語料；沒被問的附近句與剝除 T8 的 G1 逐句比對（「恢復原處理」）
// I  附帶提及（裁定 3）；N4 「找不到」提示只在明確換城市措辭（裁定 4）
P("\n══ T8. #PL-FIX-T8：確認換城市後重跑完整流程／確認記錄生命週期／非 selection A2 不變／他城＋附近／附帶提及／找不到提示 ══");
const T8_ONLY = process.argv.includes("--t8-only");
const T8 = {};
const T8_STOPPED = new Set(["ask_switch", "unconfirmed", "a2_stopped", "switch_committed_without_ask"]);
// 逐字剝除 T8 行（與 verify-chat-generation-lock-authorized-diff.mjs 的 T8_LITERAL_HUNKS 相同內容；每段恰好一次）
const T8_STRIP = {
  take: [SRC.slice(SRC.indexOf("      // #PL-FIX-T8: the re-sent sentence of a confirmed Planner selection switch: the trip\n"), SRC.indexOf("switchBase.tripDestination = undefined; // #PL-FIX-T8\n") + "switchBase.tripDestination = undefined; // #PL-FIX-T8\n".length), ""],
  e3Open: ["        // #PL-FIX-T8: a confirmed selection switch goes on to this turn's recommendations.\n        if (!confirmedSelectionSwitchTarget) { // #PL-FIX-T8\n", ""],
  e3Close: ["        } // #PL-FIX-T8\n", ""],
  nearby: [
    SRC.slice(SRC.indexOf("    // #PL-FIX-T8: an explicit nearby turn is gated when the written name is the nearby anchor itself\n"), SRC.indexOf("      : selectionTurnWrittenRaw;\n") + "      : selectionTurnWrittenRaw;\n".length),
    "    const selectionTurnWrittenName =\n      selectionTurnKeep && !explicitNearbyAuthority\n        ? planningSelectionTurnWrittenDestination(\n            session,\n            mergeTravelContext(applyTripIntentToSession(trimmed, session), trimmed).session,\n          )\n        : undefined;\n",
  ],
  notice: ["          selectionTurnSwitchTarget && // #PL-FIX-T8: only explicit switch wording names a place\n", ""],
  restore: [SRC.slice(SRC.indexOf("    // #PL-FIX-T8: an explicit nearby turn that was not asked keeps its earlier selection handling\n"), SRC.indexOf("      selectionTurnUnverifiedName = undefined;\n    }\n", SRC.indexOf("    // #PL-FIX-T8: an explicit nearby turn that was not asked")) + "      selectionTurnUnverifiedName = undefined;\n    }\n".length), ""],
};
function stripT8(code, keys) {
  let s = code;
  for (const k of keys) {
    const [cur, orig] = T8_STRIP[k];
    const n = cur ? s.split(cur).length - 1 : 0;
    if (n !== 1) throw new Error(`[T8 strip] ${k} 出現 ${n} 次（預期 1）`);
    s = s.split(cur).join(orig);
  }
  return s;
}
const A2REST = cut("    if (switchFromPendingConfirm || turnSwitch.state !== \"NO_SWITCH\") {\n      const previousLabel", "  };\n\n  const handleGenerateItinerary = async (");
INFO(`T8 完整流程區塊：SWH L${BLOCKS.SWH.from}-L${BLOCKS.SWH.to}＋SWV L${BLOCKS.SWV.from}-L${BLOCKS.SWV.to}＋A2 閘門到 send() 結尾 L${A2REST.from}-L${A2REST.to}（中間 L${BLOCKS.SWH.to + 1}-L${BLOCKS.SWV.from - 1} date_confirmation、L${BLOCKS.SWV.to + 1}-L${A2REST.from - 1} destinationUpdatePending 兩個不相關分支未取）`);
const A2REST_T7 = stripT8(A2REST.code, ["take", "e3Open", "e3Close", "nearby", "notice", "restore"]);
const FULL_TURN = await compile(`${BLOCKS.SWH.code}\n${BLOCKS.SWV.code}\n${A2REST.code}`, 'return "__FALLTHROUGH__";');
const FULL_TURN_T7 = await compile(`${BLOCKS.SWH.code}\n${BLOCKS.SWV.code}\n${A2REST_T7}`, 'return "__FALLTHROUGH__";');
const GENERAL_T7 = await compile(`${stripT8(BLOCKS.G1.code, ["nearby", "notice", "restore"])}\n${BLOCKS.G3.code}`, 'return { reached: "after_keep", nextSession, merged, selectionTurnFocus };');
expect("T8-strip-self-check", !/#PL-FIX-T8/.test(A2REST_T7) && !/#PL-FIX-T8/.test(stripT8(BLOCKS.G1.code, ["nearby", "notice", "restore"])) && /#PL-FIX-T8/.test(A2REST.code), "剝除 T8 行後的 A2REST／G1 不再含 #PL-FIX-T8（對照組成立）");
const A2REST_IMPORTS = await (async () => { const r = await importedDeps(A2REST.code); return r; })();
if (A2REST_IMPORTS.failed.length) INFO(`A2REST 無法載入的 import：${J(A2REST_IMPORTS.failed.slice(0, 20))}`);
// _app.chat.tsx 模組層的純函式（未匯出）：取真實程式碼
const T8_MODULE_FNS = {};
{
  const cmf = cut("function candidateMessagesForSession(", "\n/**\n * A2 F2: the card boundary outlives");
  T8_MODULE_FNS.candidateMessagesForSession = await (await compile(`${cmf.code}\nreturn candidateMessagesForSession;`, ""))({ ...IMP });
  const stale = cut("function isStaleActiveRecommendationContext(", "\n// ── A2 Destination Authority Gate");
  const staleDeps = (await importedDeps(stale.code)).deps;
  T8_MODULE_FNS.isStaleActiveRecommendationContext = await (await compile(`${stale.code}\nreturn isStaleActiveRecommendationContext;`, ""))({ ...staleDeps });
  const wds = cut("function workspaceDestinationOfSession(", "\nfunction destinationSwitchPersistFailure(");
  T8_MODULE_FNS.workspaceDestinationOfSession = await (await compile(`${wds.code}\nreturn workspaceDestinationOfSession;`, ""))({});
}
{
  // 診斷：A2REST 用到、但定義在元件／模組層（非 import）的識別字
  const decl = new Set();
  for (const m of SRC.matchAll(/^ {2}const (\w+)\b/gm)) decl.add(m[1]);
  for (const m of SRC.matchAll(/^ {2}const \[(\w+), (\w+)\]/gm)) { decl.add(m[1]); decl.add(m[2]); }
  for (const m of SRC.matchAll(/^(?:async )?function (\w+)/gm)) decl.add(m[1]);
  for (const m of SRC.matchAll(/^const (\w+)\b/gm)) decl.add(m[1]);
  const used = new Set(A2REST.code.match(IDENT_RE) ?? []);
  T8.componentIdents = [...used].filter((k) => decl.has(k) && !IMPORTS.has(k));
  INFO(`A2REST 引用的元件／模組層識別字（需由 harness 提供或為區塊外宣告）：${J(T8.componentIdents)}`);
}
const T8_DISPATCH = ["pushDestinationCategoryPlaceRecommendation", "pushMorePlaceRecommendations", "pushNearbyPlaceRecommendation", "pushRecommendationRefinement", "pushDestinationPlaceRecommendation", "pushAlternativeDestinationPlaceRecommendation", "streamChat", "completeAdviceTurn", "handleGenerateItinerary", "applyLocalFallback"];
/**
 * 一次完整使用者回合（send() 真實順序）：回合開始（L8686-8691：consumeStale／clearConfirmed(trimmed)／clearNotice）→
 * SWH＋SWV＋A2 閘門 → … → G1 → G2／G3 → 推薦分派 → send() 結尾。推薦分派（push*／streamChat／completeAdviceTurn…）
 * 是元件內 callback：以紀錄器替代並計數（每一次分派＝一次推薦；Credits 在分派內部扣，不在本區塊）。
 * D5 的兩個模組層 helper（plusDurableWorkspaceSnapshot／destinationSwitchPersistFailure）以「通過」替代（同 T7-A）。
 */
async function runFullTurn(env, text, { opts = { source: "user" }, fn = FULL_TURN, extraDeps = {} } = {}) {
  const r0 = rpcLog.length;
  const p0 = placeCalls.length;
  const g0 = googleReqs.length;
  const c0 = consoleLog.length;
  const persisted0 = env.persisted.length;
  const missing0 = new Set(missing);
  missing.clear(); // 本回合自己的 missing（結束後併回）
  const session = env.sessionRef.current;
  // send() 回合開始（L8686-8691 同序）
  M.ps.consumeStalePlanningSelectionDrop?.();
  IMP.clearConfirmedPlanningSelectionSwitch(text);
  IMP.clearPlanningSelectionTurnNotice();
  const turnSwitch = IMP.classifyDestinationSwitchTurn(text);
  const dispatch = [];
  const takes = [];
  const weatherCalls = [];
  const rec = (name) => async (...a) => {
    const sess = a.find((x) => x && typeof x === "object" && !Array.isArray(x) && ("planningSessionId" in x || "travelContext" in x));
    dispatch.push({ name, travel: sess?.travelContext?.destination ?? null, trip: sess?.tripDestination?.displayLabel ?? sess?.tripDestination?.city ?? null, selection: Boolean(sess?.planningSelection) });
    return name === "pushAlternativeDestinationPlaceRecommendation" ? { applied: true } : true;
  };
  const recorders = Object.fromEntries(T8_DISPATCH.map((n) => [n, rec(n)]));
  let ret;
  let error = null;
  try {
    ret = await fn({
      ...env.deps,
      ...A2REST_IMPORTS.deps,
      ...recorders,
      trimmed: text,
      displayMessage: text,
      rawText: text,
      session,
      msgs: env.msgs,
      turnSwitch,
      turnStartSession: { ...session, pendingClarification: undefined },
      turnResetBase: { planningSessionId: session.planningSessionId, planVersion: session.planVersion },
      turnSourceIsUser: true,
      turnPendingGeographic: undefined,
      showSwitchTurnUserMessage: () => {
        const m = [...env.msgsRef.current, { role: "user", content: text }];
        env.base.setMsgs(m);
        return m;
      },
      destinationSwitchSyncPendingRef: { current: null },
      destinationSwitchCardBoundaryRef: { current: null },
      storeDestinationSwitchCardBoundary: () => {},
      plusDurableWorkspaceSnapshot: () => null,
      destinationSwitchPersistFailure: () => null,
      opts,
      text,
      streaming: false,
      generating: false,
      recordAnalyticsEvent: () => {},
      analyticsChatSessionIdRef: { current: "plgg-analytics" },
      selectionGenerateInFlightRef: { current: false },
      selectionRecommendationInFlightRef: { current: false },
      ...T8_MODULE_FNS,
      stopDiscoveringLoadingAnimation: () => {},
      startDiscoveringLoadingAnimation: () => {},
      yieldToNextPaint: async () => {},
      // L2058：只移除舊版殘留的 loading 泡泡；harness 從不加入該泡泡 → 原樣回傳
      stripDiscoveringLoadingMessage: (c) => c,
      getAiPreferences: async () => ({}),
      prepareDestinationCombinations: async () => {},
      logRtNoMoreReason: () => {},
      ensureSubscriptionHydratedForCredits: () => true,
      runDirectItineraryRef: { current: rec("runDirectItinerary") },
      pushDestinationPlaceRecommendationRef: { current: rec("pushDestinationPlaceRecommendationRef") },
      commitTripAddPlaceLocalTurn: rec("commitTripAddPlaceLocalTurn"),
      send: rec("send(nested)"),
      setGenerating: () => {},
      // L2029 元件 callback 的可觀察效果：使用者訊息加入 msgs（loading 動畫不入 msgs）
      commitUserMessageWithDiscoveringLoading: (t, existing) => {
        const next = [...existing, { role: "user", content: t }];
        env.base.setMsgs(next);
        return next;
      },
      // useServerFn(getWeather)：伺服器呼叫，mock 並計數（不回天氣）
      fetchWeather: async () => {
        weatherCalls.push(1);
        return null;
      },
      takeConfirmedPlanningSelectionSwitch: (t) => {
        const r = IMP.takeConfirmedPlanningSelectionSwitch(t);
        takes.push(r ? { ...r } : null);
        return r;
      },
      ...extraDeps,
    });
  } catch (e) {
    error = String(e?.message ?? e).split("\n")[0];
  }
  const newMissing = [...missing];
  for (const k of missing0) missing.add(k);
  const gate = consoleLog.slice(c0).filter((l) => /DESTINATION_SWITCH_GATE|PLANNING_SELECTION_SCOPE_GATE/.test(String(l[1]))).map((l) => `${l[1]}:${J(l[2])}`);
  const stateErr = consoleLog.slice(c0).filter((l) => /CHAT_STATE_MACHINE_ERROR/.test(String(l[1]))).map((l) => String(l[2]).slice(0, 120));
  return {
    state: turnSwitch.state,
    ret,
    error,
    newMissing,
    stateErr,
    gate,
    dispatch,
    takes,
    weather: weatherCalls.length,
    rpc: rpcLog.length - r0,
    places: placeCalls.length - p0,
    geocodes: googleReqs.slice(g0).filter((g) => g.kind === "geocode").map((g) => g.query),
    persisted: env.persisted.slice(persisted0),
    final: env.sessionRef.current,
    msgs: env.msgs.slice(),
  };
}
const t8Summary = (r) => J({
  // takes（取用記錄的紀錄器）只存在於目前程式，不列入比對
  ret: r.ret ?? null, error: r.error, missing: r.newMissing, stateErr: r.stateErr, msgs: r.msgs.map((m) => `${m.role}:${m.content}`), gate: r.gate, dispatch: r.dispatch, rpc: r.rpc, places: r.places, geocode: r.geocodes,
  persisted: r.persisted.map((s) => J({ trip: s.tripDestination?.displayLabel ?? s.tripDestination?.city ?? null, travel: s.travelContext?.destination ?? null, planning: s.tripPlanningContext?.destination ?? null, selection: Boolean(s.planningSelection), phase: s.phase })),
  final: { trip: r.final?.tripDestination?.displayLabel ?? r.final?.tripDestination?.city ?? null, travel: r.final?.travelContext?.destination ?? null, planning: r.final?.tripPlanningContext?.destination ?? null, selection: Boolean(r.final?.planningSelection), phase: r.final?.phase },
});
const T8_KEPT_COPY = (dest) => M.crc.chatRuntimeCopy("destinationSwitchKept", "zh-TW", { previous: dest, destination: dest });
const T8_ORIGINAL = "不去台南了，改去京都";
const t8Labels = (s) => ({ trip: s?.tripDestination?.displayLabel ?? s?.tripDestination?.city ?? null, travel: s?.travelContext?.destination ?? null, planning: s?.tripPlanningContext?.destination ?? null, selection: M.ps.isPlanningSelectionMode(s) });

// ── T8-F：先問 → 「好」／確認 chip → 重跑原句的完整流程（4 變體：有／無 travelContext.destination × 好／chip）──
P("\n  ── T8-F 完整流程：「不去台南了，改去京都」先問 → 確認 → 重跑原句 → 換到京都 → 正常推薦一次 ──");
{
  const tn = SEL["台南"].session;
  INFO(`台南 selection 建立後：travelContext.destination=${J(tn.travelContext?.destination ?? null)} destinationCity=${J(tn.travelContext?.destinationCity ?? null)} tripPlanningContext.destination=${J(tn.tripPlanningContext?.destination ?? null)} tripDestination=${J(tn.tripDestination?.displayLabel ?? tn.tripDestination?.city ?? null)}`);
  const withTravel = (s) => ({ ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: "台南", destinationCity: "台南" } });
  const noTravel = (s) => ({ ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: undefined, destinationCity: undefined, destinationRegion: undefined } });
  async function t8ConfirmFlow(label, base, answer, original = T8_ORIGINAL, fn = FULL_TURN) {
    await freshWorld();
    const env = await makeEnv(base);
    await preparePersistHeadSync(env);
    const r0 = rpcLog.length;
    // 1) 詢問回合
    const ask = await runFullTurn(env, original, { fn });
    const pending = env.pending;
    // 2) 回答回合（send() L8688 先清除其他句的記錄，再進確認／取消回答區塊）
    const ans = answer === "chip" ? M.crc.chatRuntimeCopy("planningSelectionSwitchConfirmChip", "zh-TW", { destination: pending?.destination ?? "" }) : answer;
    IMP.clearConfirmedPlanningSelectionSwitch(ans);
    const ansRet = await ANSWER({ ...env.deps, trimmed: ans, displayMessage: ans, session: env.sessionRef.current, msgs: env.msgs });
    const left = env.sessionRef.current;
    const msgsAfterAnswer = env.msgs.length;
    // 3) 重跑 effect（真實 RSE）＋ send() 開頭的重跑攔截（真實 RS；不忙、未上鎖 → 繼續）
    const sends = [];
    await RESEND({ selectionSwitchResendRef: env.selectionSwitchResendRef, send: (t, o) => sends.push([t, o]) });
    const guard = sends[0] ? await RESEND_GUARD({ ...env.deps, ...IMP, trimmed: sends[0][0].trim(), opts: sends[0][1], streaming: false, generating: false, isChatGenerationLocked: () => false, selectionSwitchResendDeferredRef: { current: null } }) : null;
    // 4) 重跑原句（完整 send() 後段）
    const re = sends[0] ? await runFullTurn(env, sends[0][0].trim(), { opts: sends[0][1], fn }) : null;
    // 5) 同一句再說一次（記錄已用掉）
    const again = await runFullTurn(env, original, { fn });
    const after = re?.final;
    const rerunMsgs = re ? re.msgs.slice(msgsAfterAnswer) : [];
    const row = {
      label,
      ask: { outcome: ask.ret === undefined && pending?.entry === "general" ? "ask_switch" : `other(${ask.error ?? ask.msgs.at(-1)?.content?.slice(0, 20)})`, rpc: ask.rpc, places: ask.places, geocode: ask.geocodes.length, dispatch: ask.dispatch.length },
      ansRet: ansRet ?? null,
      left: t8Labels(left),
      sends: sends.length,
      guard,
      takes: re?.takes ?? [],
      rerun: re && { error: re.error, newMissing: re.newMissing, stateErr: re.stateErr, dispatch: re.dispatch, rpc: re.rpc, places: re.places, geocode: re.geocodes, gate: re.gate.map((g) => g.slice(0, 90)), msgs: rerunMsgs.map((m) => `${m.role}:${String(m.content).slice(0, 40)}`), pending: env.pending },
      final: t8Labels(after),
      again: { takes: again.takes, dispatch: again.dispatch.map((d) => d.name), msgs: again.msgs.slice(re ? re.msgs.length : 0).map((m) => `${m.role}:${String(m.content).slice(0, 30)}`) },
      totalRpc: rpcLog.length - r0,
    };
    P(`  [real] ${label}：${J(row)}`);
    return row;
  }
  const tnTravel = withTravel(tn);
  const tnNo = noTravel(tn);
  const flows = [
    await t8ConfirmFlow("有 travelContext.destination（台南）＋回「好」", tnTravel, "好"),
    await t8ConfirmFlow("有 travelContext.destination（台南）＋確認 chip", tnTravel, "chip"),
    await t8ConfirmFlow("無 travelContext.destination＋回「好」", tnNo, "好"),
    await t8ConfirmFlow("無 travelContext.destination＋確認 chip", tnNo, "chip"),
    // 對照：原句本身帶明確推薦需求（turnRequestsRecommendation 成立，E3 本來就不回）
    await t8ConfirmFlow("有 travelContext.destination＋回「好」＋句子帶推薦需求", tnTravel, "好", "不去台南了，改去京都，有什麼好吃的"),
  ];
  // 修正前對照：同一流程改用剝除 T8 的 A2REST（第 7 輪程式）——預期重跑回「無法確認」（證明 T8-F 在修正前會失敗）
  {
    const pre = await t8ConfirmFlow("【修正前對照】有 travelContext.destination（台南）＋回「好」", tnTravel, "好", T8_ORIGINAL, FULL_TURN_T7);
    const pre2 = await t8ConfirmFlow("【修正前對照】無 travelContext.destination＋回「好」", tnNo, "好", T8_ORIGINAL, FULL_TURN_T7);
    const pre2Stopped = (pre2.rerun?.msgs ?? []).some((m) => /無法確認/.test(m)) && !/京都/.test(String(pre2.final.travel ?? ""));
    INFO(`修正前（剝除 T8）重跑結果：有 travel（台南）→ ${J(pre.rerun?.msgs)} 最終=${J(pre.final)}（已換到京都，回 E3「已換好」）；無 travel → ${J(pre2.rerun?.msgs)} 最終=${J(pre2.final)}`);
    expect("T8-F-pre-fix-control-reproduces-bug", pre2Stopped, `剝除 T8 後「無 travelContext.destination」變體重跑回「無法確認」且未換到京都（重現第 7 輪問題；本節 T8-F 斷言在修正前會失敗）：${pre2Stopped}`);
  }
  const keptCopy = T8_KEPT_COPY("京都");
  for (const f of flows) {
    const r = f.rerun;
    const recoMsgs = r ? r.msgs.filter((m) => /無法確認|已換|已經是|recovery|還沒有處理/.test(m) || m.includes(keptCopy.slice(0, 12))) : ["(無重跑)"];
    const ok =
      f.ask.outcome === "ask_switch" && f.ask.rpc === 0 && f.ask.places === 0 && f.ask.dispatch === 0 && f.ask.geocode <= 1 &&
      f.ansRet == null && !f.left.selection && /京都/.test(String(f.left.trip)) &&
      f.sends === 1 && f.guard === "__PROCEED__" &&
      f.takes.length === 1 && f.takes[0]?.destination === "京都" &&
      r && !r.error && r.newMissing.length === 0 && r.stateErr.length === 0 &&
      r.dispatch.length <= 1 && r.dispatch.every((d) => /京都/.test(String(d.travel)) && !d.selection) &&
      r.rpc === 0 && r.places === 0 && r.geocode.length <= 1 &&
      recoMsgs.length === 0 && !r.pending &&
      /京都/.test(String(f.final.travel)) && !/台南/.test(String(f.final.travel)) && !f.final.selection;
    expect(
      `T8-F-${f.label}`,
      ok,
      `先問（Credits=${f.ask.rpc} Places=${f.ask.places} 推薦=${f.ask.dispatch}）→ 確認後離開 selection（trip=${f.left.trip} travel=${f.left.travel}）→ 重跑 ${f.sends} 次（攔截=${f.guard}）→ 取用確認記錄=${J(f.takes)} → 換城市套用、最終=${J(f.final)}；推薦分派=${J(r?.dispatch)}（≤1，不重複扣點）、本段 Credits=${r?.rpc} Places=${r?.places} geocode=${J(r?.geocode)}、「已換好／無法確認」類回覆=${J(recoMsgs)}、重跑後訊息=${J(r?.msgs)}${r?.error ? ` error=${r.error}` : ""}${r?.newMissing?.length ? ` missing=${J(r.newMissing)}` : ""}${r?.stateErr?.length ? ` 例外=${J(r.stateErr)}` : ""}`,
    );
    // 裁定 1「接著正常推薦」：重跑回合實際送出一次推薦（push*／streamChat 分派恰 1 次、目的地京都）
    expect(
      `T8-F-recommends-once-${f.label}`,
      r && r.dispatch.length === 1 && /京都/.test(String(r.dispatch[0].travel)),
      `重跑回合推薦分派=${J(r?.dispatch?.map((d) => `${d.name}(${d.travel})`))}（預期恰 1 次、京都）；實際回覆=${J(r?.msgs?.filter((m) => m.startsWith("assistant:")))}`,
    );
    expect(`T8-F-again-not-reapplied-${f.label}`, f.again.takes.every((t) => t === null), `重跑完成後同一句再說一次：確認記錄已用掉（take=${J(f.again.takes)}），不會再拿掉 tripDestination；該回合分派=${J(f.again.dispatch)} 訊息=${J(f.again.msgs)}`);
  }
}

// ── T8-L：確認記錄（模組層）生命週期 ──
P("\n  ── T8-L 確認記錄生命週期：改說別句／取消／換對話／重新整理／非 selection 同一句 ──");
{
  const tn = SEL["台南"].session;
  // 確認後重跑被生成鎖擋下（真實 RS：提示重新送出、不重跑）→ 記錄保留在模組層
  async function confirmButBlocked(env) {
    await runFullTurn(env, T8_ORIGINAL);
    IMP.clearConfirmedPlanningSelectionSwitch("好");
    await ANSWER({ ...env.deps, trimmed: "好", displayMessage: "好", session: env.sessionRef.current, msgs: env.msgs });
    const sends = [];
    await RESEND({ selectionSwitchResendRef: env.selectionSwitchResendRef, send: (t, o) => sends.push([t, o]) });
    const g = await RESEND_GUARD({ ...env.deps, ...IMP, trimmed: sends[0][0], opts: sends[0][1], streaming: false, generating: false, isChatGenerationLocked: () => true, selectionSwitchResendDeferredRef: { current: null } });
    return { guard: g, blockedMsg: env.msgs.at(-1)?.content ?? "" };
  }
  // L1 改說別句：記錄被回合開始清除，之後再說原句不套用
  {
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    const b = await confirmButBlocked(env);
    const other = await runFullTurn(env, "有什麼好吃的");
    const back = await runFullTurn(env, T8_ORIGINAL);
    expect("T8-L1-other-sentence-clears-record", b.guard === undefined && back.takes.every((t) => t === null) && other.takes.every((t) => t === null), `確認後重跑被生成鎖擋下（提示=${J(b.blockedMsg.slice(0, 30))}）→ 改說「有什麼好吃的」→ 再說原句：取用記錄=${J(back.takes)}（預期 null）；原句回合分派=${J(back.dispatch.map((d) => d.name))} 訊息=${J(back.msgs.slice(-1).map((m) => m.content.slice(0, 40)))}`);
  }
  // L2 取消：先問 → 取消 → 再說原句（仍在 selection）→ 再問一次、記錄不存在
  {
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    await runFullTurn(env, T8_ORIGINAL);
    const pending = env.pending;
    const cancel = M.crc.chatRuntimeCopy("planningSelectionSwitchCancelChip", "zh-TW", { previous: pending?.previous ?? "" });
    IMP.clearConfirmedPlanningSelectionSwitch(cancel);
    await ANSWER({ ...env.deps, trimmed: cancel, displayMessage: cancel, session: env.sessionRef.current, msgs: env.msgs });
    const kept = M.ps.isPlanningSelectionMode(env.sessionRef.current);
    const leftover = IMP.takeConfirmedPlanningSelectionSwitch(T8_ORIGINAL) ?? null;
    env.pending = null;
    const again = await runFullTurn(env, T8_ORIGINAL);
    expect("T8-L2-cancel-no-record", kept && leftover === null && env.pending?.entry === "general" && again.dispatch.length === 0 && again.rpc === 0, `取消後 selection 保留=${kept}、記錄=${J(leftover)}（預期 null）；再說原句 → ${env.pending?.entry === "general" ? "再問一次" : `未問（訊息=${J(again.msgs.at(-1)?.content?.slice(0, 30))}）`}、分派=${again.dispatch.length}`);
  }
  // L2b 有記錄（確認後重跑被擋）→ 下一回合是取消回答 → 回合開始清除
  {
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    await confirmButBlocked(env);
    IMP.clearConfirmedPlanningSelectionSwitch("不用，維持台南"); // send() L8688（取消回答回合）
    const leftover = IMP.takeConfirmedPlanningSelectionSwitch(T8_ORIGINAL) ?? null;
    expect("T8-L2b-record-cleared-by-cancel-turn", leftover === null, `記錄存在時下一回合是「不用，維持台南」→ 記錄=${J(leftover)}（預期 null）`);
  }
  // L3 重新整理（模組重新載入）：記錄不殘留
  {
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    await confirmButBlocked(env);
    await freshWorld(); // 重新整理＝新的模組實例
    const leftover = IMP.takeConfirmedPlanningSelectionSwitch(T8_ORIGINAL) ?? null;
    expect("T8-L3-reload-no-record", leftover === null, `重新整理後記錄=${J(leftover)}（預期 null）`);
  }
  // L4 非 selection 下說同一句（無記錄）：不得取用記錄；行為與剝除 T8 的同一段程式完全相同
  {
    const rows = [];
    for (const [name, s] of [["台南(非 selection)", M.ps.leavePlanningSelection(tn)], ["京都(非 selection)", M.ps.leavePlanningSelection(SEL["京都"].session)]]) {
      await freshWorld();
      const env = await makeEnv(s);
      await preparePersistHeadSync(env);
      const cur = await runFullTurn(env, T8_ORIGINAL);
      await freshWorld();
      const env2 = await makeEnv(s);
      await preparePersistHeadSync(env2);
      const pre = await runFullTurn(env2, T8_ORIGINAL, { fn: FULL_TURN_T7 });
      rows.push({ name, takes: cur.takes, same: t8Summary(cur) === t8Summary(pre), cur: t8Summary(cur).slice(0, 400) });
    }
    for (const x of rows) INFO(`L4 [${x.name}]「${T8_ORIGINAL}」take=${J(x.takes)} 與剝除 T8 相同=${x.same}：${x.cur}`);
    expect("T8-L4-non-selection-same-sentence-no-record", rows.every((x) => x.takes.every((t) => t === null) && x.same), `非 selection 說「${T8_ORIGINAL}」：無記錄可取用、完整後段與剝除 T8 版本相同：${J(rows.map((x) => `${x.name}:take=${J(x.takes)} same=${x.same}`))}`);
  }
  // L5 換對話：確認後重跑被生成鎖擋下（記錄保留）→ 切到另一個非 selection 對話 → 說同一句（模組層記錄沒有在換對話時清除）
  {
    const rows = [];
    for (const [name, s] of [["京都(非 selection，trip 已是京都)", M.ps.leavePlanningSelection(SEL["京都"].session)], ["台南(非 selection)", M.ps.leavePlanningSelection(tn)]]) {
      await freshWorld();
      const envA = await makeEnv(tn);
      await preparePersistHeadSync(envA);
      await confirmButBlocked(envA);
      const envB = await makeEnv(s); // 另一個對話（同一個模組實例）
      await preparePersistHeadSync(envB);
      const cur = await runFullTurn(envB, T8_ORIGINAL);
      // 對照：同一個對話 B 沒有殘留記錄時
      await freshWorld();
      const envC = await makeEnv(s);
      await preparePersistHeadSync(envC);
      const base = await runFullTurn(envC, T8_ORIGINAL);
      rows.push({ name, takes: cur.takes, same: t8Summary(cur) === t8Summary(base), cur: { dispatch: cur.dispatch.map((d) => `${d.name}(${d.travel})`), last: cur.msgs.at(-1)?.content?.slice(0, 40), final: t8Labels(cur.final) }, base: { dispatch: base.dispatch.map((d) => `${d.name}(${d.travel})`), last: base.msgs.at(-1)?.content?.slice(0, 40), final: t8Labels(base.final) } });
    }
    for (const x of rows) INFO(`L5 [${x.name}] 殘留記錄時 take=${J(x.takes)}：${J(x.cur)}｜無殘留對照：${J(x.base)}｜相同=${x.same}`);
    expect("T8-L5-conversation-switch-no-leak", rows.every((x) => x.takes.every((t) => t === null) && x.same), `換對話後說同一句不得套用前一個對話的確認記錄：${J(rows.map((x) => `${x.name}:take=${J(x.takes)} 與無殘留相同=${x.same}`))}`, "risk");
  }
}

// ── T8-A：非 selection 的 A2（無確認記錄）：目前程式 vs 剝除 T8 的程式，完整後段逐句比對 ──
P("\n  ── T8-A 非 selection A2 不變（完整 send() 後段；目前 vs 剝除 #PL-FIX-T8）──");
{
  const TEXTS = ["不去台南了，改去京都", "改去京都", "換到大阪", "不要京都了，去大阪", "改去亞特蘭提斯", "我不去台南了", "改去輕井澤", "我要換到台北", "不去京都了，改去大阪", "不去京都了，改去東京", "我不去京都了", "改去京都，有什麼好吃的", "換到大阪，推薦景點"];
  const sessions = { "台南(非 selection)": M.ps.leavePlanningSelection(SEL["台南"].session), "京都(非 selection)": M.ps.leavePlanningSelection(SEL["京都"].session) };
  const diffs = [];
  let n = 0;
  for (const [sname, s] of Object.entries(sessions)) {
    for (const text of TEXTS) {
      if (IMP.classifyDestinationSwitchTurn(text).state === "NO_SWITCH") continue;
      // 另一句的殘留記錄（不同句）也不得影響
      for (const stale of [false, true]) {
        await freshWorld();
        const env = await makeEnv(s);
        await preparePersistHeadSync(env);
        if (stale) IMP.rememberConfirmedPlanningSelectionSwitch({ destination: "京都", originalUserText: "別的句子" });
        const cur = await runFullTurn(env, text);
        await freshWorld();
        const env2 = await makeEnv(s);
        await preparePersistHeadSync(env2);
        const pre = await runFullTurn(env2, text, { fn: FULL_TURN_T7 });
        n += 1;
        const same = t8Summary(cur) === t8Summary(pre);
        if (!same || cur.takes.some((t) => t !== null) || cur.newMissing.length || cur.error) diffs.push(`[${sname}]${stale ? "(另一句殘留記錄)" : ""}${text}${cur.newMissing.length ? ` missing=${J(cur.newMissing)}` : ""}${cur.error ? ` error=${cur.error}` : ""}`);
        if (!stale) INFO(`  [${sname}]「${text}」分派=${J(cur.dispatch.map((d) => `${d.name}(${d.travel})`))} 最後回覆=${J(cur.msgs.at(-1)?.content?.slice(0, 30) ?? null)} geocode=${cur.geocodes.length}｜與剝除 T8 相同=${same}`);
      }
    }
  }
  expect("T8-A-non-selection-a2-identical", n > 0 && diffs.length === 0, `非 selection A2（${n} 組，含另一句殘留記錄）：回覆、閘門記錄、寫入、推薦分派、Credits、Geocoding 與剝除 T8 版本完全相同；不同=${J(diffs)}`);
}

// ── T8-NB：他城＋附近（裁定 2）──
P("\n  ── T8-NB 他城＋附近：先問（0 扣點 0 搜尋）；同城附近／無地名附近照常走（與剝除 T8 的 G1 相同）──");
{
  const nbLine = (key, text, r) => P(`  [real] [${key}]「${text}」${r.path} → ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""} Credits=${r.rpc} Places=${r.places} geocode=${J(r.geocodes)} selection=${r.kept} trip 維持=${r.tripSame} 錨點=${J(IMP.planningSelectionTurnNearbyAnchor(text, IMP.planningSelectionTurnWrittenDestination(SEL[key].session, IMP.mergeTravelContext(IMP.applyTripIntentToSession(text, SEL[key].session), text).session)) ?? null)}`);
  const MUST = [["京都", "我想去大阪附近玩", "大阪"], ["京都", "大阪附近有什麼好吃的", "大阪"], ["台北", "台南附近有什麼好玩的", "台南"], ["東京", "京都車站附近的咖啡廳", "京都"]];
  for (const [key, text, city] of MUST) {
    const r = await t6Turn(key, text);
    nbLine(key, text, r);
    expect(`T8-NB-ask-[${key}]${text}`, r.outcome === "ask_switch" && String(r.pending?.destination ?? "").includes(city) && r.rpc === 0 && r.places === 0 && r.push.length === 0 && r.kept && r.tripSame && r.geocodes.length <= 1 && r.toasts.length === 0, `[${key}]「${text}」→ ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}；預期先問換到${city}、Credits=${r.rpc} Places=${r.places} 推薦=${r.push.length} geocode=${r.geocodes.length}`);
  }
  const SAME = [["京都", "嵐山附近有什麼好吃的"], ["京都", "京都車站附近"], ["台南", "附近有什麼好吃的"], ["京都", "附近有什麼好吃的"]];
  const cmp = (r) => J({ outcome: r.outcome, final: t8Labels(r.final), pref: r.final?.preferredArea ?? null, focus: r.focus ?? null, pending: r.pending?.destination ?? null, notice: r.notice?.message ?? null, push: r.push.length });
  for (const [key, text] of SAME) {
    const r = await t6Turn(key, text);
    nbLine(key, text, r);
    const p = await t6Turn(key, text, { generalFn: GENERAL_T7 });
    const same = cmp(r) === cmp(p);
    expect(`T8-NB-proceed-[${key}]${text}`, !T8_STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.rpc === 0 && r.places === 0 && r.kept && r.tripSame && r.geocodes.length <= 1 && same, `[${key}]「${text}」→ ${r.outcome}；照常走、selection 保留、geocode=${J(r.geocodes)}（≤1）；與剝除 T8 的 G1 相同=${same}${same ? "" : `（T8=${cmp(r)}｜T7=${cmp(p)}）`}`);
  }
  // 附近錨點語料（純函式＋真實 G1）：誤判＝不該問卻問；漏判＝他城附近卻沒問
  const SHOULD_ASK = [
    ["京都", "大阪附近有什麼好玩的"], ["京都", "大阪車站附近的飯店"], ["京都", "大阪站附近有什麼好吃的"], ["京都", "大阪駅附近的拉麵"], ["京都", "我想住大阪附近"],
    ["京都", "大阪市附近有什麼好玩的"], ["京都", "大阪的附近有什麼好吃的"], ["京都", "大阪那附近有什麼好玩的"], ["京都", "大阪火車站附近的美食"], ["台北", "台中火車站附近的美食"],
    ["台北", "台南車站附近的小吃"], ["台北", "台中附近有什麼好玩的"], ["東京", "京都駅附近的咖啡廳"], ["東京", "京都站附近的咖啡廳"], ["東京", "大阪附近的景點"],
    ["台南", "台北車站附近有什麼好吃的"], ["京都", "去大阪附近走走"], ["京都", "東京車站附近的拉麵"],
  ];
  const SHOULD_PROCEED = [
    ["京都", "京都附近有什麼好玩的"], ["京都", "京都車站附近的拉麵"], ["京都", "京都站附近"], ["京都", "祇園附近的甜點"], ["京都", "嵐山站附近"],
    ["台北", "台北車站附近的咖啡廳"], ["台北", "北投附近有什麼好吃的"], ["台北", "我家附近有什麼好吃的"], ["台北", "附近的咖啡廳"], ["東京", "東京車站附近的拉麵"],
    ["東京", "新宿站附近的居酒屋"], ["東京", "淺草附近有什麼好玩的"], ["京都", "大阪道頓堀附近有什麼好吃的"], ["京都", "我朋友住大阪附近"], ["台南", "安平附近有什麼好吃的"],
    ["京都", "飯店附近有什麼好吃的"], ["京都", "車站附近有什麼好吃的"],
  ];
  const run = async (list) => {
    const out2 = [];
    for (const [key, text] of list) {
      const r = await t6Turn(key, text);
      nbLine(key, text, r);
      out2.push({ key, text, outcome: r.outcome, pending: r.pending?.destination ?? null, rpc: r.rpc, places: r.places, geo: r.geocodes.length, kept: r.kept });
    }
    return out2;
  };
  const sa = await run(SHOULD_ASK);
  const sp = await run(SHOULD_PROCEED);
  const missedNb = sa.filter((x) => x.outcome !== "ask_switch");
  const falseNb = sp.filter((x) => T8_STOPPED.has(x.outcome) || String(x.outcome).startsWith("error"));
  INFO(`附近錨點漏判語料 ${sa.length} 句：先問 ${sa.length - missedNb.length}、沒問 ${missedNb.length}=${J(missedNb.map((x) => `[${x.key}]${x.text}→${x.outcome}`))}`);
  INFO(`附近錨點誤判語料 ${sp.length} 句：照常 ${sp.length - falseNb.length}、被問／停止 ${falseNb.length}=${J(falseNb.map((x) => `[${x.key}]${x.text}→${x.outcome}${x.pending ? `(${x.pending})` : ""}`))}`);
  expect("T8-NB-corpus-zero-cost", [...sa, ...sp].every((x) => x.rpc === 0 && x.places === 0 && x.geo <= 1 && x.kept), `附近語料 ${sa.length + sp.length} 句：閘門段 0 扣點 0 搜尋、Geocoding ≤1、selection 保留：不符=${J([...sa, ...sp].filter((x) => !(x.rpc === 0 && x.places === 0 && x.geo <= 1 && x.kept)).map((x) => `[${x.key}]${x.text}:${x.rpc}/${x.places}/${x.geo}`))}`);
  expect("T8-NB-corpus-false-positive", falseNb.length === 0, `同城／無地名／地標／附帶的附近句被問換城市：${J(falseNb.map((x) => `[${x.key}]${x.text}→${x.outcome}${x.pending ? `(${x.pending})` : ""}`))}`, "risk");
  expect("T8-NB-corpus-miss", missedNb.length === 0, `他城＋附近（車站／站／駅／市／的／那／火車站…）沒先問：${J(missedNb.map((x) => `[${x.key}]${x.text}→${x.outcome}`))}`, "risk");
  // 純函式邊界
  const pf = [
    ["大阪附近有什麼好吃的", "大阪", "大阪"], ["大阪車站附近", "大阪", "大阪"], ["大阪駅附近", "大阪", "大阪"], ["大阪道頓堀附近", "大阪", null], ["大阪道頓堀附近", "大阪道頓堀", "大阪道頓堀"],
    ["附近有什麼好吃的", undefined, null], ["大阪有什麼好吃的", "大阪", null], ["附近的大阪燒", "大阪", null], ["大阪 附近", "大阪", "大阪"], ["京都車站附近的咖啡廳", "京都車站", "京都車站"],
  ];
  const pfBad = pf.filter(([t, l, want]) => (IMP.planningSelectionTurnNearbyAnchor(t, l) ?? null) !== want);
  expect("T8-NB-pure-anchor", pfBad.length === 0, `planningSelectionTurnNearbyAnchor 邊界：不符=${J(pfBad.map(([t, l, w]) => `${t}/${l}→${IMP.planningSelectionTurnNearbyAnchor(t, l) ?? null}（預期 ${w}）`))}`);
}

// ── T8-I：附帶提及（裁定 3）──
P("\n  ── T8-I 附帶提及：「人氣／人潮／拉麵店」不算附帶（先問）；裁定接受的附帶句維持不問 ──");
{
  const ASK = [["京都", "大阪拉麵店推薦", "大阪"], ["台北", "台南人氣小吃推薦", "台南"], ["京都", "東京人氣甜點店在哪", "東京"]];
  for (const [key, text, city] of ASK) {
    const r = await t6Turn(key, text);
    P(`  [real] [${key}]「${text}」→ ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""} Credits=${r.rpc} Places=${r.places} geocode=${J(r.geocodes)}`);
    expect(`T8-I-ask-[${key}]${text}`, r.outcome === "ask_switch" && String(r.pending?.destination ?? "").includes(city) && r.rpc === 0 && r.places === 0 && r.kept && r.tripSame && r.geocodes.length <= 1, `[${key}]「${text}」→ ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}；預期先問換到${city}、0 扣點 0 搜尋`);
  }
  const NOT = [["京都", "大阪燒好吃嗎"], ["京都", "我朋友住大阪"], ["京都", "大阪的拉麵比較好吃嗎"], ["台北", "京都抹茶甜點推薦"]];
  for (const [key, text] of NOT) {
    const r = await t6Turn(key, text);
    P(`  [real] [${key}]「${text}」→ ${r.outcome} Credits=${r.rpc} Places=${r.places} geocode=${J(r.geocodes)}`);
    expect(`T8-I-not-asked-[${key}]${text}`, !T8_STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.rpc === 0 && r.places === 0 && r.kept && r.tripSame && r.geocodes.length <= 1, `[${key}]「${text}」→ ${r.outcome}；預期照常走、selection 保留`);
  }
  // 同類（裁定未列）：「人氣」後面接的詞不同時，寫入名稱是否還能抽出城市
  const SIBLING = [["京都", "大阪人氣景點有哪些"], ["京都", "大阪人氣美食推薦"], ["台北", "台中人氣餐廳"], ["台北", "台南人氣景點"], ["京都", "大阪人潮多的商店街"], ["京都", "大阪拉麵店在哪"], ["台北", "台中人氣小吃推薦"]];
  const sib = [];
  for (const [key, text] of SIBLING) {
    const r = await t6Turn(key, text);
    const written = IMP.planningSelectionTurnWrittenDestination(SEL[key].session, IMP.mergeTravelContext(IMP.applyTripIntentToSession(text, SEL[key].session), text).session) ?? null;
    sib.push({ key, text, outcome: r.outcome, written, rpc: r.rpc, places: r.places });
    P(`  [real] [${key}]「${text}」寫入名稱=${J(written)} → ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}`);
  }
  const sibNot = sib.filter((x) => x.outcome !== "ask_switch");
  expect("T8-I-sibling-consistency", sibNot.length === 0, `與裁定句同類（城市＋人氣／人潮／拉麵店＋其他詞）未先問：${J(sibNot.map((x) => `[${x.key}]${x.text}→${x.outcome}（寫入=${x.written}）`))}`, "risk");
}

// ── T8-N4：「找不到」提示只在明確換城市措辭（裁定 4）──
P("\n  ── T8-N4「找不到」提示：明確換城市措辭＋ZERO_RESULTS 才有；一般句 ZERO_RESULTS 沒有 ──");
{
  const EXPLICIT = [["台南", "改去亞特蘭提斯", "亞特蘭提斯"], ["京都", "換到霍格華茲", "霍格華茲"], ["台北", "換去納尼亞", "納尼亞"], ["京都", "改成霍格華茲", "霍格華茲"], ["台南", "不去台南了，改去亞特蘭提斯", "亞特蘭提斯"], ["台南", "我要換到亞特蘭提斯", "亞特蘭提斯"]];
  for (const [key, text, name] of EXPLICIT) {
    const r = await t6Turn(key, text);
    const want = M.crc.chatRuntimeCopy("planningSelectionTurnPlaceNotFound", "zh-TW", { name });
    expect(`T8-N4-explicit-[${key}]${text}`, r.notice?.message === want && r.geocodes.length <= 1 && r.rpc === 0 && r.places === 0, `[${key}]「${text}」（明確換城市措辭）→ ${r.outcome} 提示=${J(r.notice?.message ?? null)} geocode=${J(r.geocodes)}`);
  }
  const GENERAL_Z = [["台南", "我想去亞特蘭提斯玩"], ["台南", "亞特蘭提斯有什麼好吃的"], ["京都", "霍格華茲好玩嗎"], ["台北", "去納尼亞走走"], ["台南", "亞特蘭提斯附近有什麼好吃的"], ["京都", "我想住在霍格華茲"], ["京都", "霍格華茲有什麼好吃的"], ["台北", "納尼亞在哪裡"]];
  for (const [key, text] of GENERAL_Z) {
    const r = await t6Turn(key, text);
    expect(`T8-N4-general-no-notice-[${key}]${text}`, r.notice == null && !T8_STOPPED.has(r.outcome) && r.geocodes.length <= 1 && r.rpc === 0 && r.places === 0, `[${key}]「${text}」（一般句）→ ${r.outcome} 提示=${J(r.notice?.message ?? null)}（預期 null）geocode=${J(r.geocodes)}`);
  }
}

if (T8_ONLY) {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  await server.close();
  const acc = rows.filter((r) => r.cat === "acc");
  const risk = rows.filter((r) => r.cat === "risk");
  P(`\n（--t8-only：只跑第 1 節與 T8）missing 識別字=${J([...missing])}`);
  P(`[acc] PASS=${acc.filter((r) => r.ok).length}/${acc.length}${acc.some((r) => !r.ok) ? `（FAIL：${acc.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}；[risk] 問題存在（FAIL）=${risk.filter((r) => !r.ok).length}/${risk.length}${risk.some((r) => !r.ok) ? `（${risk.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}`);
  P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
  P(`verify-planner-selection-general-gate (--t8-only): ${external > 0 || acc.some((r) => !r.ok) ? "FAIL" : "PASS"}`);
  // REL-1：等 stdout 寫完再結束，避免 pipe 截斷摘要。
  await new Promise((done) => process.stdout.write(`${out.join("\n")}\n`, done));
  process.exit(external > 0 || acc.some((r) => !r.ok) ? 1 : 0);
}

// ═════════════════════════ T6. #PL-FIX-T6 第 6 輪（使用者裁定 R1-R5）═════════════════════════
// 每句冷啟動模組；依 send() 真實順序：classifyDestinationSwitchTurn≠NO_SWITCH → 既有 A2 換城市閘門（SWH／SWV／SWA）；
// 否則 G1 → G2（place-detail）或 G3（一般路徑）。Credits＝Supabase RPC 次數、Places＝searchNearbyPlaces 次數、
// geocode＝Google Geocoding 次數，皆由 mock 計數。
P("\n══ T6. #PL-FIX-T6：R1 明確換城市措辭／R2 未驗證名稱不留在 session／R3 pending 回答／R4 advice contextPatch／R5 窄範圍收緊 ══");
const T6_ONLY = process.argv.includes("--t6-only");
/** R2 指定欄位＋目的地欄位：含 name 的欄位路徑。 */
function r2FieldsWith(s, name) {
  if (!s || !name) return [];
  const tc = s.travelContext ?? {};
  const fields = {
    "travelContext.destinationCandidate": tc.destinationCandidate,
    "travelContext.destinationInputNames": tc.destinationInputNames,
    preferredArea: s.preferredArea,
    "travelContext.destination": tc.destination,
    "travelContext.destinationCity": tc.destinationCity,
    "travelContext.destinationRegion": tc.destinationRegion,
    "tripPlanningContext.destination": s.tripPlanningContext?.destination,
    tripDestination: s.tripDestination,
    location: s.location,
  };
  return Object.entries(fields).filter(([, v]) => v != null && JSON.stringify(v).includes(name)).map(([k]) => k);
}
async function t6Turn(key, text, { session: s0, placeDetail = false, pendingGeo, generalFn = null } = {}) {
  await freshWorld();
  const base = s0 ?? SEL[key].session;
  const env = await makeEnv(base);
  await preparePersistHeadSync(env);
  if (pendingGeo) env.deps.turnPendingGeographic = pendingGeo;
  const sw = IMP.classifyDestinationSwitchTurn(text);
  let res;
  if (sw.state !== "NO_SWITCH" && !pendingGeo) {
    const r = await runSwitchTurn(env, text);
    const committed = (r.ret?.reached === "after_switch_gate" && r.ret.turnSwitchVerified) || /__A2_COMMITTED__/.test(r.error ?? "");
    if (/__A2_COMMITTED__/.test(r.error ?? "")) r.error = null;
    if (!r.error && !committed && r.deferred && !placeDetail) {
      // #PL-FIX-T7：send() 真實順序——A2 區塊把 selection 的 CONFIRMED_SWITCH 句交給 G1（同一回合、同一個 switchProbe）。
      const g = await runGeneral(env, text, { extraDeps: { switchProbe: r.switchProbe } });
      res = {
        path: `A2(${sw.state})→G1→G3`, outcome: g.outcome, rpc: r.rpc + g.rpc.length, places: r.places + g.places, geocodes: [...r.geocodes, ...g.geocodes],
        final: g.final, lastMsg: g.lastMsg, pending: g.pending, gateReason: g.gateReason ?? null, focus: g.focus ?? null, ret: g.ret, a2Gate: r.gate,
      };
    } else {
      res = {
        path: `A2(${sw.state})`,
        // #PL-FIX-T7：A2 區塊內 selection 先問（setSelectionSwitchPending entry=general）＝ ask_switch
        outcome: r.error ? `error(${r.error})` : committed ? "switch_committed_without_ask" : r.ret === undefined ? (env.pending?.entry === "general" ? "ask_switch" : /無法確認/.test(r.lastMsg) ? "unconfirmed" : "a2_stopped") : "a2_passthrough",
        rpc: r.rpc, places: r.places, geocodes: r.geocodes, final: r.after, lastMsg: r.lastMsg, pending: env.pending, gateReason: J(r.gate.map((g) => g?.reason)),
      };
    }
  } else {
    const r = await runGeneral(env, text, { placeDetail, fnOverride: generalFn });
    res = { path: placeDetail ? "G1→G2" : "G1→G3", outcome: r.outcome, rpc: r.rpc.length, places: r.places, geocodes: r.geocodes, final: r.final, lastMsg: r.lastMsg, pending: r.pending, gateReason: r.gateReason ?? null, focus: r.focus ?? null, ret: r.ret };
  }
  res.toasts = env.toasts.map((x) => x[1]);
  // #PL-FIX-T7：本回合暫存的「找不到」提示（真實 planning-selection 模組狀態；每句冷啟動模組）
  res.notice = M.ps.peekPlanningSelectionTurnNotice?.() ?? null;
  res.env = env;
  res.persisted = env.persisted.slice();
  res.push = env.categoryPush ?? [];
  res.base = base;
  res.target = IMP.planningSelectionTurnSwitchTarget(text) ?? null;
  res.kept = M.ps.isPlanningSelectionMode(res.final);
  res.selected = SEL[key] ? selectedFromSelection(res.final, SEL[key].picks) : null;
  res.tripSame = J(res.final?.tripDestination) === J(base.tripDestination);
  return res;
}
const t6Line = (key, text, r) =>
  P(`  [real] [${key}]「${text}」${r.path} target=${J(r.target)} → ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}${r.gateReason ? ` gate=${r.gateReason}` : ""} Credits=${r.rpc} Places=${r.places} geocode=${J(r.geocodes)} persist=${r.persisted.length} push=${r.push.length} toast=${J(r.toasts)} selection=${r.kept} 已選=${r.selected} trip 維持=${r.tripSame}${r.focus !== undefined ? ` focus=${J(r.focus)}` : ""}${r.outcome === "unconfirmed" || r.outcome === "a2_stopped" ? ` 回覆=${J(r.lastMsg.slice(0, 30))}` : ""}`);
const STOPPED = new Set(["ask_switch", "unconfirmed", "a2_stopped", "switch_committed_without_ask"]);

// ── R1-a：明確換城市措辭＋可信他城 → 先問，0 扣點 0 搜尋，不寫入 ──
P("\n  ── R1-a 明確換城市措辭＋可信他城 → 先問換城市（0 扣點 0 搜尋、不寫入）──");
const R1_TRUSTED = [
  ["台南", "改去京都", "京都"], ["台南", "換到京都", "京都"], ["東京", "換去大阪", "大阪"], ["京都", "改成大阪", "大阪"],
  ["台南", "我要換到京都", "京都"], ["京都", "不要京都了，去大阪", "大阪"], ["台南", "不去台南了，改去京都", "京都"],
  ["新北", "改去台中", "台中"], ["台北", "換到花蓮", "花蓮"], ["京都", "我們改去東京吧", "東京"], ["京都", "改去輕井澤", "輕井澤"],
  ["新北", "那我改去宜蘭好了", "宜蘭"], ["京都", "我想換到札幌", "札幌"],
];
for (const [key, text, city] of R1_TRUSTED) {
  const r = await t6Turn(key, text);
  t6Line(key, text, r);
  const written = r.persisted.flatMap((s) => r2FieldsWith(s, city).filter((f) => !r2FieldsWith(r.base, city).includes(f)));
  expect(
    `T6-R1a-${key}-${text}`,
    r.outcome === "ask_switch" && r.pending?.destination?.includes(city) && r.rpc === 0 && r.places === 0 && r.kept && r.selected === 2 && r.tripSame && written.length === 0 && r.toasts.length === 0,
    `[${key}]「${text}」→ ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}（${r.path}）；預期先問換到${city}、Credits=${r.rpc} Places=${r.places}、selection 保留（已選 ${r.selected}/2）、trip 維持=${r.tripSame}、persist 寫入${city}欄位=${J(written)}、toast=${J(r.toasts)}`,
  );
}

// ── R1-b：明確換城市措辭＋無法確認 ──
// #PL-FIX-T7 裁定 1：無法確認的地名 → 不停下、照常回答、維持 selection 城市、不寫入未驗證名稱；
//   Google ZERO_RESULTS → 本回合暫存一則「找不到「{name}」…」提示（裁定 2）。
P("\n  ── R1-b 明確換城市措辭＋無法確認的地名 → 照常走（不停下）、維持 selection 城市、不寫入、ZERO_RESULTS 提示 ──");
const R1_UNVERIFIED = [
  ["台南", "改去亞特蘭提斯", "亞特蘭提斯"], ["京都", "換到霍格華茲", "霍格華茲"], ["台北", "換去納尼亞", "納尼亞"], ["京都", "改成霍格華茲", "霍格華茲"],
  ["台南", "我要換到亞特蘭提斯", "亞特蘭提斯"], ["京都", "不要京都了，去霍格華茲", "霍格華茲"], ["台南", "不去台南了，改去亞特蘭提斯", "亞特蘭提斯"], ["東京", "我想改去烏托邦", "烏托邦"],
];
for (const [key, text, name] of R1_UNVERIFIED) {
  const r = await t6Turn(key, text);
  t6Line(key, text, r);
  const leaked = [...r.persisted, r.final].flatMap((s) => r2FieldsWith(s, name));
  const unconfirmedCopy = M.crc.chatRuntimeCopy("planningSelectionTurnDestinationUnconfirmed", "zh-TW");
  const wantNotice = M.crc.chatRuntimeCopy("planningSelectionTurnPlaceNotFound", "zh-TW", { name });
  expect(
    `T6-R1b-${key}-${text}`,
    !STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.lastMsg !== unconfirmedCopy && !/無法確認/.test(r.lastMsg) && r.rpc === 0 && r.places === 0 && r.geocodes.length <= 1 && r.kept && r.selected === 2 && r.tripSame && leaked.length === 0 && r.toasts.length === 0,
    `[${key}]「${text}」→ ${r.outcome}（${r.path}）；預期照常走（不停下、不回無法確認）；Credits=${r.rpc} Places=${r.places} geocode=${r.geocodes.length}${J(r.geocodes)}、selection 保留（已選 ${r.selected}/2）、寫入「${name}」欄位=${J(leaked)}、toast=${J(r.toasts)}`,
  );
  expect(
    `T7-R1b-notice-${key}-${text}`,
    r.notice?.message === wantNotice && r.notice?.userText === text,
    `[${key}]「${text}」Google ZERO_RESULTS → 暫存提示=${J(r.notice?.message ?? null)}（預期 ${J(wantNotice)}）`,
  );
}

// ── R1-c：明確換城市措辭＋同城子區域 → 照常走（不問、不停）──
P("\n  ── R1-c 明確換城市措辭＋同城子區域 → 照常走 ──");
const R1_SUB = [
  ["台南", "改去安平"], ["京都", "換到嵐山"], ["新北", "改去淡水"], ["東京", "換去新宿"], ["新北", "改去九份"], ["台北", "換到北投"],
  ["大阪", "改去心齋橋"], ["京都", "改去祇園"], ["宜蘭", "我們改去礁溪吧"], ["台南", "不要安平了，去七股"],
];
for (const [key, text] of R1_SUB) {
  const r = await t6Turn(key, text);
  t6Line(key, text, r);
  expect(
    `T6-R1c-${key}-${text}`,
    !STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.rpc === 0 && r.places === 0 && r.kept && r.selected === 2 && r.tripSame && r.toasts.length === 0,
    `[${key}]「${text}」同城子區域：照常走（實際 ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}${r.gateReason ? `，gate=${r.gateReason}` : ""}），selection 保留、trip 維持`,
  );
}

// ── R1-d：R1 措辭的非地名句（改成三天／改成下午／換成步行…）→ 不得當成換城市（誤判語料）──
P("\n  ── R1-d R1 措辭的非地名句誤判語料（台北 selection；不得問換城市、不得回無法確認）──");
const R1_NONPLACE = [
  "改成三天", "改成下午", "換成步行", "改成兩天一夜", "改成早上出發", "改成搭捷運", "換成便宜一點的", "改成室內", "改去吃拉麵", "換去喝咖啡",
  "改去海邊", "改去看夜景", "改成吃素", "換到下一家", "改去別的地方", "改成自駕", "改成三個人", "改成明天", "改成週末", "改去逛夜市",
  "改成輕鬆一點", "改成預算五千", "我要改成兩天", "改去公園", "改去博物館", "改去老街", "換去泡溫泉", "改去咖啡廳", "換成火鍋", "改去百貨公司",
  "改成親子行程", "換到晚上", "改成住一晚", "改去吃燒肉", "換成日式料理", "改去看展", "改成早一點", "換去別間", "改去書店", "改成走路",
  "改成兩晚", "換成高鐵", "改去山上", "改去爬山", "改成有小孩", "不要拉麵了，改吃壽司", "不要海邊了，去山上", "不去夜市了，改去逛街",
  "改去附近", "換到市區", "改去市中心", "改成無障礙", "換成雙人房", "改去吃早餐", "改去夜市", "換去看電影", "改成文青路線", "改去河濱",
  "換成小吃", "改成美食之旅",
];
const r1dRows = [];
for (const text of R1_NONPLACE) {
  const r = await t6Turn("台北", text);
  r1dRows.push({ text, outcome: r.outcome, target: r.target, geocode: r.geocodes.length, rpc: r.rpc, places: r.places, pending: r.pending?.destination ?? null });
}
const r1dBad = r1dRows.filter((x) => STOPPED.has(x.outcome) || String(x.outcome).startsWith("error"));
const r1dTarget = r1dRows.filter((x) => x.target);
INFO(`R1 措辭非地名 ${R1_NONPLACE.length} 句：被抽成換城市目標 ${r1dTarget.length} 句=${J(r1dTarget.map((x) => `${x.text}→${x.target}`))}`);
INFO(`R1 措辭非地名 結果分布=${J(Object.entries(r1dRows.reduce((a, x) => ((a[x.outcome] = (a[x.outcome] ?? 0) + 1), a), {})))}；Geocoding 合計=${r1dRows.reduce((a, x) => a + x.geocode, 0)}（每句最多 ${Math.max(0, ...r1dRows.map((x) => x.geocode))}）`);
expect("T6-R1d-nonplace-never-switch-or-stop", r1dBad.length === 0, `R1 措辭非地名 ${R1_NONPLACE.length} 句被問換城市／回無法確認／停止=${r1dBad.length}：${J(r1dBad.map((x) => `${x.text}→${x.outcome}${x.pending ? `(${x.pending})` : ""}[target=${x.target}]`))}`);
expect("T6-R1d-nonplace-zero-cost", r1dRows.every((x) => x.rpc === 0 && x.places === 0 && x.geocode <= 1), `R1 措辭非地名句：閘門段 0 扣點 0 搜尋、Geocoding 每句≤1：${J(r1dRows.filter((x) => x.rpc || x.places || x.geocode > 1).map((x) => `${x.text}:${x.rpc}/${x.places}/${x.geocode}`))}`);
expect("T6-R1d-target-extraction-precision", r1dTarget.length === 0, `R1 措辭非地名句不應被 planningSelectionTurnSwitchTarget 抽成地名（純詞彙規則）：${J(r1dTarget.map((x) => `${x.text}→${x.target}（${x.outcome}）`))}`, "risk");

// ── R2：未驗證名稱不得留在 session；下一句不再 Geocoding；每句 Geocoding ≤1 ──
P("\n  ── R2 未驗證名稱不留在 session（destinationCandidate／destinationInputNames／preferredArea）──");
const R2_CASES = [
  ["台南", "我想去亞特蘭提斯玩", "亞特蘭提斯", false],
  ["台南", "亞特蘭提斯附近有什麼好吃的", "亞特蘭提斯", false],
  ["京都", "霍格華茲有什麼好吃的", "霍格華茲", false],
  ["京都", "我想住在霍格華茲", "霍格華茲", false],
  ["台北", "去納尼亞走走", "納尼亞", false],
  ["台南", "我想去亞特蘭提斯玩", "亞特蘭提斯", true],
  ["京都", "霍格華茲好玩嗎", "霍格華茲", true],
  ["台南", "亞特蘭提斯附近有什麼", "亞特蘭提斯", true],
];
for (const [key, text, name, pd] of R2_CASES) {
  const session = pd ? IMP.enterPlaceDetailChat(SEL[key].session, SEL[key].picks[0]) : SEL[key].session;
  const r = await t6Turn(key, text, { session, placeDetail: pd });
  t6Line(key, `${pd ? "（place-detail）" : ""}${text}`, r);
  const leaked = [...r.persisted, r.final].flatMap((s, i) => r2FieldsWith(s, name).map((f) => `${i < r.persisted.length ? `persist#${i}` : "final"}:${f}`));
  // 下一句（同一模組狀態，接續本回合結果；place-detail 則先離開地點詳情）
  const after = pd ? { ...r.final, placeDetailFocus: undefined, placeFocusRecommendationScope: undefined, selectedPlaceFromMood: undefined, conversationMode: r.final?.previousConversationMode ?? r.final?.conversationMode } : r.final;
  const env2 = await makeEnv(after);
  await preparePersistHeadSync(env2);
  const n = await runGeneral(env2, "有什麼好吃的");
  const n2 = await runGeneral(env2, "還有什麼好玩的");
  const geoAgain = [...n.geocodes, ...n2.geocodes].filter((q) => q.includes(name));
  expect(
    `T6-R2-${pd ? "pd-" : ""}${key}-${text}`,
    leaked.length === 0 && r.geocodes.length <= 1 && geoAgain.length === 0 && n.geocodes.length <= 1 && n2.geocodes.length <= 1 && r.rpc === 0 && r.places === 0,
    `${pd ? "place-detail" : "一般路徑"}「${text}」：未驗證「${name}」留在 session 的欄位=${J(leaked)}、本句 geocode=${J(r.geocodes)}、下兩句 geocode=${J([n.geocodes, n2.geocodes])}（含「${name}」=${geoAgain.length}）`,
  );
}

// ── R3：pending 地理釐清回答會變成他城 → 先問（不 isolate、不 dropStale、不 toast、不推薦扣點）；同城照常 ──
P("\n  ── R3 pending 地理釐清回答（parent_city_scope／destination_area）──");
{
  const kyoto = SEL["京都"];
  const pcs = (city, raw, orig) => IMP.buildPendingParentScopeClarification({ confirmedParentCity: city, rawGeographicLabel: raw, categoryIntent: "restaurant", originalUserText: orig });
  const da = (raw, orig) => IMP.buildPendingGeographicClarification({ rawGeographicLabel: raw, categoryIntent: "restaurant", originalUserText: orig });
  const R3 = [
    // [說明, pending, 回答, 預期 "ask"(他城先問)／"same"(同城照常)／"no_write"(不可寫入他城)、他城名]
    ["parent(大阪)", pcs("大阪", "道頓堀橋", "道頓堀橋有什麼好吃的"), "好", "ask", "大阪"],
    ["parent(大阪)", pcs("大阪", "道頓堀橋", "道頓堀橋有什麼好吃的"), "對", "ask", "大阪"],
    ["parent(大阪)", pcs("大阪", "道頓堀橋", "道頓堀橋有什麼好吃的"), "大阪", "ask", "大阪"],
    ["parent(札幌)", pcs("札幌", "狸小路", "狸小路有什麼好吃的"), "好", "ask", "札幌"],
    ["parent(京都)", pcs("京都", "嵐山竹林", "嵐山竹林有什麼好吃的"), "好", "same", null],
    ["area(道頓堀)", da("道頓堀", "道頓堀有什麼好吃的"), "大阪", "ask", "大阪"],
    ["area(道頓堀)", da("道頓堀", "道頓堀有什麼好吃的"), "在大阪", "ask", "大阪"],
    ["area(道頓堀)", da("道頓堀", "道頓堀有什麼好吃的"), "大阪的", "ask", "大阪"],
    ["area(狸小路)", da("狸小路", "狸小路有什麼好吃的"), "札幌", "ask", "札幌"],
    ["area(錦市場)", da("錦市場", "錦市場有什麼好吃的"), "京都", "same", null],
  ];
  for (const [pname, pending, ans, want, city] of R3) {
    const r = await t6Turn("京都", ans, { pendingGeo: pending });
    t6Line("京都", `pending ${pname} 回答 ${ans}`, r);
    const isolated = city ? r.persisted.filter((s) => r2FieldsWith(s, city).length).length : 0;
    const pushedOther = city ? r.push.filter((p) => JSON.stringify(p.session?.travelContext ?? {}).includes(city)).length : 0;
    if (want === "ask") {
      expect(
        `T6-R3-${pname}-${ans}`,
        r.outcome === "ask_switch" && r.pending?.destination?.includes(city) && r.push.length === 0 && isolated === 0 && r.toasts.length === 0 && r.rpc === 0 && r.places === 0 && r.kept,
        `京都 selection＋pending ${pname} 回答「${ans}」→ ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}；預期先問換到${city}；推薦呼叫=${r.push.length}（他城 ${pushedOther}）、isolate／寫入${city}的 persist=${isolated}、toast=${J(r.toasts)}、Credits=${r.rpc}`,
      );
    } else {
      expect(
        `T6-R3-${pname}-${ans}-same-city`,
        r.outcome !== "ask_switch" && r.outcome !== "unconfirmed" && r.kept && r.toasts.length === 0,
        `京都 selection＋pending ${pname} 回答「${ans}」（同城）→ ${r.outcome}；照常（推薦呼叫=${r.push.length}，session.travel=${J(r.push.map((p) => labels(p.session).travel))}）、selection 保留、toast=${J(r.toasts)}`,
      );
    }
  }
  // Google 暫時失敗（OVER_QUERY_LIMIT）：需要 Geocoding 才可信的他城（輕井澤；札幌／大阪本機即可信、不打 Geocoding）
  //   在閘門查不到 → 仍不得 isolate／dropStale／toast／推薦（R3）
  const FAILCITY = "輕井澤";
  globalThis.__PLGG_GEO_FAIL = [FAILCITY];
  for (const [pname, pending, ans] of [[`parent(${FAILCITY})`, pcs(FAILCITY, "舊輕井澤銀座", "舊輕井澤銀座有什麼好吃的"), "好"], [`parent(${FAILCITY})`, pcs(FAILCITY, "舊輕井澤銀座", "舊輕井澤銀座有什麼好吃的"), FAILCITY], ["area(雲場池)", da("雲場池", "雲場池有什麼好吃的"), FAILCITY]]) {
    const r = await t6Turn("京都", ans, { pendingGeo: pending });
    t6Line("京都", `[Google 失敗] pending ${pname} 回答 ${ans}`, r);
    const wrote = r.persisted.filter((s) => r2FieldsWith(s, FAILCITY).length).length;
    expect(
      `T6-R3-provider-failure-${pname}-${ans}`,
      r.push.length === 0 && wrote === 0 && r.toasts.length === 0 && r.kept && r.rpc === 0,
      `Google 暫時失敗時 京都 selection＋pending ${pname} 回答「${ans}」→ ${r.outcome}${r.gateReason ? ` gate=${r.gateReason}` : ""}：推薦呼叫=${r.push.length}（session.travel=${J(r.push.map((p) => labels(p.session).travel))}）、寫入${FAILCITY}的 persist=${wrote}（selection=${J(r.persisted.map((s) => M.ps.isPlanningSelectionMode(s)))}）、toast=${J(r.toasts)}、回合結束 selection=${r.kept}、geocode=${J(r.geocodes)}`,
    );
  }
  // 同情境的一般句：Google 暫時失敗時「我想去輕井澤玩」→ 照常走；之後下游讀到的目的地是什麼
  {
    const text = `我想去${FAILCITY}玩`;
    const r = await t6Turn("京都", text);
    t6Line("京都", `[Google 失敗] ${text}`, r);
    let down = null;
    if (r.ret?.merged && r.ret?.nextSession) {
      const ctx = IMP.mergeContextForPlaceFetch(r.ret.merged.context, r.ret.nextSession);
      const res0 = IMP.resolveCategoryTurnDestination({ ctx, session: r.ret.nextSession, userText: text, locale: "zh-TW" });
      down = { mergedContextDestination: r.ret.merged.context?.destination ?? null, placeFetchDestination: ctx.destination ?? null, categoryTurnDestination: res0?.destination ?? null, keptTravel: r.ret.nextSession.travelContext?.destination ?? null, keptCity: r.ret.nextSession.travelContext?.destinationCity ?? null };
    }
    INFO(`[Google 失敗] [京都]「${text}」→ ${r.outcome} gate=${r.gateReason}；下游（L${lineOf(SRC.indexOf("const placeFetchContext = mergeContextForPlaceFetch(merged.context, nextSession);"))} 同式 mergeContextForPlaceFetch(merged.context, nextSession)）=${J(down)}`);
    expect("T6-R3-provider-failure-general-no-other-city-downstream", !down || (![down.placeFetchDestination, down.categoryTurnDestination, down.keptTravel, down.keptCity].some((v) => String(v ?? "").includes(FAILCITY))), `Google 暫時失敗時，「${text}」照常走後，回合 session／下游推薦讀到的目的地不得是未經閘門確認的他城：${J(down)}`, "risk");
  }
  delete globalThis.__PLGG_GEO_FAIL;
}

// ── R4：advice 分支 contextPatch 不得寫入他城或未驗證名稱（全部欄位）──
P("\n  ── R4 advice 分支 contextPatch（真實 G3 advice 分支＋applyAdviceResultToSession＋真實 PH）──");
{
  const MD = await loadMod(`${WORK_ROOT}/src/lib/ai/destination-advice.ts`);
  const kyoto = SEL["京都"];
  const priorStates = {
    clarification: { destinationClarification: "multiple_destinations" },
    "candidate-pending(大阪)": { destinationCandidate: { raw: "大阪", status: "pending" } },
    "candidate-conflict(大阪)": { destinationCandidate: { raw: "大阪", status: "conflict" } },
    "candidate-pending(霍格華茲)": { destinationCandidate: { raw: "霍格華茲", status: "pending" } },
  };
  const rows = [];
  for (const [stateName, patch] of Object.entries(priorStates)) {
    for (const text of ["兩天", "有什麼好吃的", "大阪", "我想去嵐山玩", "霍格華茲", "大阪三天", "第一個", "好"]) {
      await freshWorld();
      const s0 = { ...kyoto.session, travelContext: { ...(kyoto.session.travelContext ?? { interests: [] }), ...patch } };
      const env = await makeEnv(s0);
      await preparePersistHeadSync(env);
      const r = await runGeneral(env, text);
      const adv = env.advice.at(-1);
      if (!adv) continue;
      const t0 = env.toasts.length;
      const persisted = env.deps.persistSession(MD.applyAdviceResultToSession(adv.turn.session, adv.turn.advice));
      const cp = adv.turn.advice.contextPatch ?? {};
      const newNames = ["大阪", "霍格華茲"].filter((n) => JSON.stringify(cp).includes(n) || (JSON.stringify(persisted.travelContext ?? {}).includes(n) && !JSON.stringify(s0.travelContext ?? {}).includes(n)));
      // 回合前就存在於同一鍵的值（例如回合前的 destinationCandidate＝大阪）不算本回合寫入
      const tc0 = s0.travelContext ?? {};
      const tc1 = persisted.travelContext ?? {};
      const cpKeysWithName = [...new Set([...Object.keys(cp), ...Object.keys(tc1)])].filter((k) =>
        ["大阪", "霍格華茲"].some((n) => (JSON.stringify(cp[k] ?? "").includes(n) || JSON.stringify(tc1[k] ?? "").includes(n)) && !JSON.stringify(tc0[k] ?? "").includes(n)),
      );
      rows.push({ stateName, text, kept: M.ps.isPlanningSelectionMode(persisted), tripSame: J(persisted.tripDestination) === J(kyoto.session.tripDestination), cpKeysWithName, newNames, toast: env.toasts.length - t0, rpc: r.rpc.length });
      P(`  [real] [京都＋${stateName}]「${text}」→ advice_branch contextPatch 含他城／未驗證名稱的鍵=${J(cpKeysWithName)}；寫入後 selection=${M.ps.isPlanningSelectionMode(persisted)} trip 維持=${J(persisted.tripDestination) === J(kyoto.session.tripDestination)} 新出現名稱=${J(newNames)} toast=${env.toasts.length - t0}`);
    }
  }
  INFO(`R4：實際進入 advice 分支的 selection 回合 ${rows.length} 個`);
  // RISK-c 合成情境的可達性：G3 中另外兩個 completeAdviceTurn 呼叫點（style planning L${lineOf(SRC.indexOf("const planningTurn = processAdviceTurn(trimmed, nextSession, merged.context, undefined, locale);"))}、
  //   early planning L${lineOf(SRC.indexOf("const earlyPlanningTurn = processAdviceTurn(trimmed, nextSession, planningCtx, undefined, locale);"))}）沒有 keepSelectionAdvicePatch。
  //   直接以 keep 後的京都 selection session 呼叫真實 processAdviceTurn（同參數形狀），看 contextPatch 是否會帶他城。
  {
    const reach = [];
    for (const [stateName, extra] of [["無 pending", {}], ["ask_trip_style", { pendingQuestion: { type: "ask_trip_style", options: [] }, chatPlanningState: "waitingStyleSelection" }], ["ask_days", { pendingQuestion: { type: "ask_days", options: [] } }]]) {
      for (const text of ["大阪的朋友推薦我吃拉麵", "大阪燒好吃嗎", "我想去札幌玩", "美食探索", "兩天", "大阪三天", "我朋友住大阪"]) {
        await freshWorld();
        const s = { ...kyoto.session, ...extra };
        let cp = null;
        let err = null;
        try {
          const merged = IMP.mergeTravelContext(s, text);
          const turn = IMP.processAdviceTurn(text, s, merged.context, undefined, "zh-TW");
          cp = turn?.advice?.contextPatch ?? null;
        } catch (e) {
          err = String(e?.message ?? e).slice(0, 80);
        }
        const keys = cp ? Object.entries(cp).filter(([, v]) => /大阪|札幌/.test(JSON.stringify(v ?? ""))).map(([k, v]) => `${k}=${JSON.stringify(v)}`) : [];
        reach.push({ stateName, text, keys, err });
      }
    }
    const hit = reach.filter((x) => x.keys.length);
    INFO(`processAdviceTurn 直接探測（京都 selection；${reach.length} 組）：contextPatch 帶他城的組合=${J(hit.map((x) => `${x.stateName}/${x.text}:${x.keys.join(",")}`))}${reach.some((x) => x.err) ? `；例外=${J(reach.filter((x) => x.err).map((x) => `${x.text}:${x.err}`))}` : ""}`);
    expect("T6-RISK-c-unsanitized-advice-callers-other-city", hit.length === 0, `G3 未套 keepSelectionAdvicePatch 的 processAdviceTurn 呼叫點，contextPatch 可能帶他城：${J(hit.map((x) => `${x.stateName}/${x.text}:${x.keys.join(",")}`))}`, "risk");
  }
  const bad = rows.filter((x) => !x.kept || !x.tripSame || x.cpKeysWithName.length || x.toast);
  expect("T6-R4-advice-contextPatch-no-other-or-unverified", rows.length > 0 && bad.length === 0, `advice 分支 contextPatch（所有鍵）不含他城／未驗證名稱、selection 與 trip 保留、無 toast：不符=${J(bad.map((x) => `${x.stateName}/${x.text}:${x.cpKeysWithName.join("|")}/kept=${x.kept}/toast=${x.toast}`))}`);
}

// ── R5：本回合寫入名稱以可信他城開頭（含 nearby）→ 先問；「大阪的朋友推薦我吃拉麵」不得被問 ──
P("\n  ── R5 窄範圍收緊 ──");
const R5_ASK = [
  ["京都", "大阪道頓堀有什麼好吃的", "大阪"], ["京都", "大阪道頓堀附近有什麼好吃的", "大阪"], ["京都", "大阪心齋橋附近的咖啡廳", "大阪"],
  ["東京", "京都嵐山附近有什麼好玩的", "京都"], ["台北", "台南安平附近有什麼好吃的", "台南"], ["新北", "台北北投附近有什麼好玩的", "台北"],
];
// #PL-FIX-T7 裁定 6：移除「他城地標先問」——「大阪道頓堀…」這類句照常走、維持 selection 城市（他城不留在 session）。
for (const [key, text, city] of R5_ASK) {
  const r = await t6Turn(key, text);
  t6Line(key, text, r);
  const leaked = r2FieldsWith(r.final, city).filter((f) => !r2FieldsWith(r.base, city).includes(f));
  expect(`T6-R5-ask-${key}-${text}`, !STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.rpc === 0 && r.places === 0 && r.kept && r.selected === 2 && r.tripSame && leaked.length === 0 && r.toasts.length === 0, `[${key}]「${text}」→ ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}；裁定 6：他城地標句照常走、維持 ${key}（Credits=${r.rpc} Places=${r.places}、他城「${city}」留在 session 的欄位=${J(leaked)}、toast=${J(r.toasts)}）`);
}
{
  const r = await t6Turn("京都", "大阪的朋友推薦我吃拉麵");
  t6Line("京都", "大阪的朋友推薦我吃拉麵", r);
  expect("T6-R5-not-asked-大阪的朋友推薦我吃拉麵", !STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.kept && r.tripSame && r.rpc === 0 && r.places === 0 && r.toasts.length === 0, `[京都]「大阪的朋友推薦我吃拉麵」→ ${r.outcome}；不得問換城市／停止、selection 保留、trip 維持、Credits=${r.rpc} Places=${r.places}`);
  const leak = r2FieldsWith(r.final, "大阪");
  expect("T6-R5-not-asked-no-other-city-in-context", leak.length === 0, `「大阪的朋友推薦我吃拉麵」照常走後，回合結束的 session（之後會被 persist）不帶他城「大阪」：欄位=${J(leak)}（travelContext.destinationCity=${J(r.final?.travelContext?.destinationCity ?? null)}；keepPlanningSelectionDestination 只還原 destination／destinationCandidate／destinationInputNames／preferredArea）`, "risk");
}
for (const [key, text] of [["台南", "改成兩天一夜"], ["京都", "改成兩天一夜"], ["台南", "改成三天"], ["京都", "改成下午"], ["東京", "換成步行"]]) {
  const r = await t6Turn(key, text);
  t6Line(key, text, r);
  expect(`T6-R1d-${key}-${text}`, !STOPPED.has(r.outcome) && !String(r.outcome).startsWith("error") && r.target === null && r.kept && r.tripSame && r.rpc === 0 && r.places === 0, `[${key}]「${text}」不是換城市：target=${J(r.target)} → ${r.outcome}、selection 保留`);
}
const R5_NO_ASK = [
  ["京都", "我大阪的朋友說這裡很好玩"], ["京都", "大阪人推薦的拉麵店"], ["京都", "大阪燒好吃嗎"], ["京都", "從大阪來的朋友想吃拉麵"],
  ["京都", "我朋友住大阪"], ["京都", "上次去大阪很好玩，這次想吃拉麵"], ["台北", "台南擔仔麵哪裡吃"], ["台北", "台中太陽餅哪裡買"],
  ["台北", "京都抹茶甜點推薦"], ["台北", "東京香蕉哪裡買"], ["台北", "新竹米粉炒哪家好"], ["台北", "北海道牛奶冰淇淋哪裡有"],
  ["京都", "東京來的朋友推薦什麼"], ["東京", "大阪腔好可愛"], ["台南", "高雄朋友推薦的牛肉湯"], ["京都", "大阪的拉麵比較好吃嗎"],
];
const r5Bad = [];
for (const [key, text] of R5_NO_ASK) {
  const r = await t6Turn(key, text);
  t6Line(key, text, r);
  if (STOPPED.has(r.outcome) || String(r.outcome).startsWith("error")) r5Bad.push(`[${key}]${text}→${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""}`);
}
expect("T6-R5-false-positive-corpus", r5Bad.length === 0, `「已知城市＋人／食物／比較」句（${R5_NO_ASK.length} 句）被問換城市／停止=${r5Bad.length}：${J(r5Bad)}`, "risk");

// ── 子區域推薦品質：preferredArea 還原後，下游推薦是否仍以該子區域為焦點（對照非 selection 一般路徑）──
P("\n  ── 子區域推薦焦點（selection vs 非 selection 一般路徑；下游 resolveCategoryTurnDestination 同式）──");
{
  const SUBQ = [
    ["新北", "九份有什麼好玩的", "九份"], ["新北", "淡水有什麼好吃的", "淡水"], ["新北", "野柳有什麼好玩的", "野柳"], ["台北", "我想去北投泡湯", "北投"],
    ["台北", "士林有什麼好吃的", "士林"], ["台北", "大稻埕有什麼好玩的", "大稻埕"], ["台南", "安平有什麼好吃的", "安平"], ["宜蘭", "我想去礁溪泡溫泉", "礁溪"],
    ["宜蘭", "羅東有什麼好吃的", "羅東"], ["京都", "我想去嵐山玩", "嵐山"], ["京都", "祇園有什麼好吃的", "祇園"], ["東京", "淺草有什麼好吃的", "淺草"],
    ["東京", "澀谷有什麼好玩的", "澀谷"], ["大阪", "難波有什麼好吃的", "難波"],
  ];
  const down = async (r, text) => {
    if (!r.ret?.merged || !r.ret?.nextSession) return { reached: r.outcome };
    const ctx = IMP.mergeContextForPlaceFetch(r.ret.merged.context, r.ret.nextSession);
    const res0 = IMP.resolveCategoryTurnDestination({ ctx, session: r.ret.nextSession, userText: text, locale: "zh-TW" });
    return { pref: r.ret.nextSession.preferredArea ?? null, travel: r.ret.nextSession.travelContext?.destination ?? null, ctxDest: ctx.destination ?? null, turnDest: res0?.destination ?? null, clar: res0?.clarificationLabel ?? res0?.kind ?? null };
  };
  const qRows = [];
  for (const [key, text, area] of SUBQ) {
    const rs = await t6Turn(key, text);
    const ds = await down(rs, text);
    const rb = await t6Turn(key, text, { session: M.ps.leavePlanningSelection(SEL[key].session) });
    const db = await down(rb, text);
    const has = (d) => [d.pref, d.travel, d.ctxDest, d.turnDest].some((v) => v && String(v).includes(area));
    qRows.push({ key, text, area, sel: has(ds), base: has(db), ds, db });
    P(`  [real] [${key}]「${text}」selection：${J(ds)}｜非 selection：${J(db)}｜焦點含「${area}」selection=${has(ds)} 非 selection=${has(db)}`);
  }
  const lost = qRows.filter((x) => x.base && !x.sel);
  INFO(`子區域 ${qRows.length} 句：非 selection 一般路徑以子區域為焦點 ${qRows.filter((x) => x.base).length} 句；selection 模式仍以子區域為焦點 ${qRows.filter((x) => x.sel).length} 句；失去焦點 ${lost.length} 句=${J(lost.map((x) => `[${x.key}]${x.text}`))}`);
  expect("T6-subarea-focus-not-regressed-vs-nonselection", lost.length === 0, `selection 子區域回合（preferredArea 還原）相較非 selection 一般路徑失去子區域焦點：${J(lost.map((x) => `[${x.key}]${x.text}：sel=${J(x.ds)}`))}`, "risk");
}

// ═════════════════════════ T7. #PL-FIX-T7 第 7 輪（使用者裁定 1-8）═════════════════════════
P("\n══ T7. #PL-FIX-T7：找不到提示／附帶提及規則語料／先問後確認完整流程／非 selection A2 不變 ══");
const T7_COPY = (name, locale = "zh-TW") => M.crc.chatRuntimeCopy("planningSelectionTurnPlaceNotFound", locale, { name });

// ── T7-N1：「找不到」提示的設定條件（真實 G1 區塊；mock Google 逐筆計數）──
P("\n  ── T7-N1「找不到」提示：ZERO_RESULTS 才暫存；暫時失敗／不可信結果／同城都不暫存；不新增 Google 呼叫 ──");
{
  const cases = [
    // [說明, selection, 句子, 預期提示名稱或 null, setup]
    // #PL-FIX-T8 裁定 4：「找不到」提示只在明確換城市措辭時顯示；一般句即使 ZERO_RESULTS 也不顯示（原預期「亞特蘭提斯」作廢）。
    ["ZERO_RESULTS（一般句）", "台南", "我想去亞特蘭提斯玩", null],
    ["ZERO_RESULTS（明確換城市措辭）", "京都", "換到霍格華茲", "霍格華茲"],
    ["ZERO_RESULTS（A2 CONFIRMED_SWITCH 交給 G1）", "台南", "不去台南了，改去亞特蘭提斯", "亞特蘭提斯"],
    ["暫時失敗 OVER_QUERY_LIMIT", "台南", "我想去亞特蘭提斯玩", null, () => { globalThis.__PLGG_GEO_FAIL = ["亞特蘭提斯"]; }],
    ["暫時失敗 OVER_QUERY_LIMIT（明確換城市措辭）", "京都", "換到霍格華茲", null, () => { globalThis.__PLGG_GEO_FAIL = ["霍格華茲"]; }],
    ["有結果但不可信（他國同名 POI）", "台南", "我想去亞特蘭提斯玩", null, () => { globalThis.__PLGG_GEO_EXTRA = { 亞特蘭提斯: gres("atlantis", "Paradise Island, The Bahamas", 25.0867, -77.3233, ["establishment", "point_of_interest", "lodging"], [comp("Paradise Island", LOC), comp("New Providence", AAL1), comp("The Bahamas", ["country", "political"], "BS")]) }; }],
    ["同城子區域（可信）", "台南", "改去安平", null],
    ["同城子區域（閘門無法確認但有結果）", "京都", "我想去嵐山玩", null],
    ["同城子區域（中心無法確認但有結果）", "新北", "九份有什麼好玩的", null],
    ["selection 城市本身", "京都", "京都有什麼好吃的", null],
    ["無地名", "台南", "有什麼好吃的", null],
  ];
  for (const [label, key, text, want, setup] of cases) {
    if (setup) setup();
    const r = await t6Turn(key, text);
    delete globalThis.__PLGG_GEO_FAIL;
    delete globalThis.__PLGG_GEO_EXTRA;
    t6Line(key, `${label}｜${text}`, r);
    const ok = want ? r.notice?.message === T7_COPY(want) && r.notice?.conversationLength === 0 && r.notice?.userText === text : r.notice === null;
    expect(`T7-N1-${label}-${key}-${text}`, ok && r.geocodes.length <= 1 && r.rpc === 0 && r.places === 0, `${label}：[${key}]「${text}」→ ${r.outcome} 暫存提示=${J(r.notice?.message ?? null)}（預期 ${J(want ? T7_COPY(want) : null)}）、geocode=${J(r.geocodes)}（≤1）`);
  }
  // 丟出例外的暫時失敗（網路）：geocodeLocationFn 直接 throw，不得暫存提示
  {
    await freshWorld();
    const env = await makeEnv(SEL["台南"].session);
    await preparePersistHeadSync(env);
    const r = await runGeneral(env, "我想去亞特蘭提斯玩", { extraDeps: { geocodeLocationFn: async () => { throw new Error("network down"); } } });
    const notice = M.ps.peekPlanningSelectionTurnNotice();
    expect("T7-N1-thrown-network-failure-no-notice", notice == null && r.outcome === "proceed", `geocode 丟出例外（網路暫時失敗）→ ${r.outcome}，暫存提示=${J(notice?.message ?? null)}（預期 null）`);
  }
  // 純函式邊界：isGeocodeZeroResultsEnvelope
  {
    const f = IMP.isGeocodeZeroResultsEnvelope ?? (await loadMod(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`)).isGeocodeZeroResultsEnvelope;
    // 與 chat-turn-destination.ts geocodeDestinationCandidate 相同的請求形狀（mock Google）
    const geo = (q) => M.lf.geocodeTripLocationFromText({ data: { query: q, destinationName: q, locale: "zh-TW", language: "zh-TW", disableLocaleRegionBias: true, placesFallback: false } }).catch((e) => ({ thrown: String(e?.message ?? e) }));
    const zero = await geo("亞特蘭提斯");
    globalThis.__PLGG_GEO_FAIL = ["亞特蘭提斯"];
    const quota = await geo("亞特蘭提斯");
    delete globalThis.__PLGG_GEO_FAIL;
    const okEnv = await geo("京都");
    const rows = { zero: f(zero), quota: f(quota), ok: f(okEnv), nullEnv: f(null), undef: f(undefined), errOnly: f({ error: "geocode_zero_results" }), zeroWithRaw: f({ error: "geocode_zero_results", providerResult: { failureReason: "geocode_zero_results", rawResultCount: 2 } }) };
    INFO(`isGeocodeZeroResultsEnvelope：${J(rows)}；ZERO 信封=${J({ error: zero?.error, providerResult: zero?.providerResult && { ok: zero.providerResult.ok, failureReason: zero.providerResult.failureReason, rawResultCount: zero.providerResult.rawResultCount } })}；配額信封=${J({ error: quota?.error, failureReason: quota?.providerResult?.failureReason })}`);
    expect("T7-N1-pure-zero-results-envelope", rows.zero === true && rows.quota === false && rows.ok === false && rows.nullEnv === false && rows.undef === false && rows.zeroWithRaw === false, `ZERO_RESULTS=true；OVER_QUERY_LIMIT／有結果／null／rawResultCount>0 皆 false：${J(rows)}`);
  }
}

// ── T7-N2：提示的顯示時機（真實 useEffect 本體 NE；React state 以模擬器依真實 setter 順序驅動；StrictMode 每次 commit 執行 2 次）──
P(`\n  ── T7-N2 提示顯示時機（真實 effect 本體 L${BLOCKS.NE.from}-L${BLOCKS.NE.to}）：回覆之後、每回合最多一則、下一回合清除 ──`);
{
  const NOTICE_EFFECT = await compile(BLOCKS.NE.code, "return;");
  function makeUi(initialMsgs = []) {
    const ui = { msgs: initialMsgs.slice(), streaming: false, generating: false, effectRuns: 0 };
    const setMsgs = (n) => {
      ui.msgs = typeof n === "function" ? n(ui.msgs) : n;
    };
    ui.commit = async () => {
      // 一次 commit：effect 依賴 [msgs, streaming, generating] 有變就跑；StrictMode 開發模式下 mount 時重跑一次（這裡每次都跑 2 次，較嚴格）
      for (let guard = 0; guard < 10; guard++) {
        const before = ui.msgs;
        for (let k = 0; k < 2; k++) {
          ui.effectRuns += 1;
          await NOTICE_EFFECT({ ...IMP, msgs: ui.msgs, streaming: ui.streaming, generating: ui.generating, setMsgs });
        }
        if (ui.msgs === before) break; // effect 改了 msgs → 再 render 一次
      }
    };
    ui.set = async (patch) => {
      if (patch.msgs) setMsgs(patch.msgs);
      if (patch.streaming !== undefined) ui.streaming = patch.streaming;
      if (patch.generating !== undefined) ui.generating = patch.generating;
      await ui.commit();
    };
    return ui;
  }
  const noticeCount = (msgs, name) => msgs.filter((m) => m.role === "assistant" && m.content === T7_COPY(name)).length;
  const order = (msgs) => msgs.map((m) => `${m.role[0]}:${String(m.content).slice(0, 8)}`).join("|");
  // 用真實 G1 設定提示（台南 selection、「改去亞特蘭提斯」；conversationLength＝回合前 msgs 長度）
  async function arm(prev = []) {
    await freshWorld();
    const env = await makeEnv(SEL["台南"].session);
    await preparePersistHeadSync(env);
    env.msgs = prev.slice();
    env.msgsRef.current = env.msgs;
    await runGeneral(env, "改去亞特蘭提斯");
    return M.ps.peekPlanningSelectionTurnNotice();
  }
  const name = "亞特蘭提斯";
  const prev = [{ role: "user", content: "早安" }, { role: "assistant", content: "早安！" }];
  const user = { role: "user", content: "改去亞特蘭提斯" };
  const results = [];
  // S1 streamChat 順序（L8211 setStreaming(true) → L8223 空白 assistant → onPartial 取代最後一則 → 最終取代 → finally setStreaming(false)）
  {
    const n = await arm(prev);
    const ui = makeUi(prev);
    const seen = [];
    await ui.set({ msgs: [...prev, user] }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ streaming: true }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ msgs: (p) => [...p, { role: "assistant", content: "" }] }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ msgs: (p) => [...p.slice(0, -1), { role: "assistant", content: "台南推薦（串流中）" }] }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ msgs: (p) => [...p.slice(0, -1), { role: "assistant", content: "台南推薦（完成）" }] }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ streaming: false }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ msgs: (p) => p.slice() }); // 之後任何 re-render
    const ok = n && J(seen) === J([0, 0, 0, 0, 0, 1]) && noticeCount(ui.msgs, name) === 1 && ui.msgs.at(-1).content === T7_COPY(name) && ui.msgs.at(-2).content === "台南推薦（完成）" && M.ps.peekPlanningSelectionTurnNotice() == null;
    results.push(["S1-streamChat", ok, `各階段提示數=${J(seen)} 最終=${order(ui.msgs)} effect 執行=${ui.effectRuns}`]);
  }
  // S2 completeAdviceTurn 順序（setMsgs(withReply) 與 setStreaming(false) 同批）
  {
    await arm(prev);
    const ui = makeUi(prev);
    const seen = [];
    await ui.set({ msgs: [...prev, user] }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ msgs: [...prev, user, { role: "assistant", content: "幾天？" }], streaming: false }); seen.push(noticeCount(ui.msgs, name));
    const ok = J(seen) === J([0, 1]) && ui.msgs.at(-1).content === T7_COPY(name) && ui.msgs.at(-2).content === "幾天？";
    results.push(["S2-advice", ok, `各階段提示數=${J(seen)} 最終=${order(ui.msgs)}`]);
  }
  // S3 generating 期間（行程生成）：回覆出現但 generating=true → 不顯示；結束後才顯示一則
  {
    await arm(prev);
    const ui = makeUi(prev);
    const seen = [];
    await ui.set({ msgs: [...prev, user], generating: true, streaming: true }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ msgs: (p) => [...p, { role: "assistant", content: "行程生成中…" }] }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ streaming: false }); seen.push(noticeCount(ui.msgs, name));
    await ui.set({ generating: false }); seen.push(noticeCount(ui.msgs, name));
    results.push(["S3-generating", J(seen) === J([0, 0, 0, 1]), `各階段提示數=${J(seen)} 最終=${order(ui.msgs)}`]);
  }
  // S4 回覆尚未出現（只有使用者訊息）→ 不得提早顯示
  {
    await arm(prev);
    const ui = makeUi(prev);
    await ui.set({ msgs: [...prev, user] });
    await ui.set({ streaming: true });
    await ui.set({ streaming: false });
    results.push(["S4-no-reply-yet", noticeCount(ui.msgs, name) === 0 && M.ps.peekPlanningSelectionTurnNotice() != null, `只有使用者訊息時提示數=${noticeCount(ui.msgs, name)}（仍暫存=${M.ps.peekPlanningSelectionTurnNotice() != null}）`]);
  }
  // S5 下一回合開始（send() L${lineOf(SRC.indexOf("    clearPlanningSelectionTurnNotice();\n    beginUserTurn("))} 清除）：上一回合沒出現回覆，下一回合的回覆後不得補出舊提示
  {
    await arm(prev);
    const ui = makeUi(prev);
    await ui.set({ msgs: [...prev, user] });
    // 下一回合：真實 send() 在回合開始呼叫 clearPlanningSelectionTurnNotice（以同一個真實模組函式）
    IMP.clearPlanningSelectionTurnNotice();
    await ui.set({ msgs: (p) => [...p, { role: "user", content: "有什麼好吃的" }] });
    await ui.set({ msgs: (p) => [...p, { role: "assistant", content: "台南小吃" }] });
    const withClear = noticeCount(ui.msgs, name);
    // 對照：若沒有回合開始的清除，舊提示會附在下一回合回覆之後（證明清除是必要的）
    await arm(prev);
    const ui2 = makeUi(prev);
    await ui2.set({ msgs: [...prev, user] });
    await ui2.set({ msgs: (p) => [...p, { role: "user", content: "有什麼好吃的" }] });
    await ui2.set({ msgs: (p) => [...p, { role: "assistant", content: "台南小吃" }] });
    const withoutClear = noticeCount(ui2.msgs, name);
    results.push(["S5-next-turn-clears", withClear === 0, `有回合開始清除：提示數=${withClear}；對照（無清除）=${withoutClear}（${withoutClear ? "會附在下一回合回覆後，清除為必要" : "不會"}）`]);
  }
  // S6 每回合最多一則：提示顯示後再有 re-render／新的 assistant 訊息（例如後續卡片）不得再顯示
  {
    await arm(prev);
    const ui = makeUi(prev);
    await ui.set({ msgs: [...prev, user, { role: "assistant", content: "台南推薦" }] });
    await ui.set({ msgs: (p) => [...p, { role: "assistant", content: "更多卡片" }] });
    await ui.set({ streaming: true });
    await ui.set({ streaming: false });
    results.push(["S6-at-most-one", noticeCount(ui.msgs, name) === 1, `提示數=${noticeCount(ui.msgs, name)} 最終=${order(ui.msgs)}`]);
  }
  // S7 對話被清除／換對話（同位置不是本回合的使用者訊息）→ 不顯示
  {
    await arm(prev);
    const ui = makeUi(prev);
    await ui.set({ msgs: [{ role: "assistant", content: "新對話" }] });
    await ui.set({ msgs: [{ role: "assistant", content: "新對話" }, { role: "user", content: "嗨" }, { role: "assistant", content: "你好" }] });
    results.push(["S7-other-conversation", noticeCount(ui.msgs, name) === 0, `提示數=${noticeCount(ui.msgs, name)} 最終=${order(ui.msgs)}`]);
  }
  // S8 回覆在提示之後被非函式 setMsgs 以回合 closure 覆寫（例如某些分支 setMsgs([...next, reply]) 於 streaming=false 後再寫一次）→ 提示被吃掉
  {
    await arm(prev);
    const ui = makeUi(prev);
    const next = [...prev, user];
    await ui.set({ msgs: next });
    await ui.set({ msgs: [...next, { role: "assistant", content: "第一版回覆" }] });
    const shown = noticeCount(ui.msgs, name);
    await ui.set({ msgs: [...next, { role: "assistant", content: "第二版回覆（closure 覆寫）" }] });
    INFO(`S8（行為探針，非斷言）：提示顯示後若同回合再以 closure 陣列 setMsgs 覆寫，提示數 ${shown} → ${noticeCount(ui.msgs, name)}（提示只存在於 msgs state，未持久化；裁定 8 已知限制）`);
  }
  for (const [id, ok, detail] of results) expect(`T7-N2-${id}`, ok, detail);
  // 靜態：清除在 send() 開頭（早退之後、A2／G1 閘門之前）、設定只在 G1 一處
  {
    const iSend = SRC.indexOf("    if (!trimmed || streaming || generating) return;\n");
    const iClear = SRC.indexOf("    clearPlanningSelectionTurnNotice();\n    beginUserTurn(");
    const iA2 = SRC.indexOf("    if (switchFromPendingConfirm || turnSwitch.state !== \"NO_SWITCH\") {\n      const previousLabel");
    const iG1 = SRC.indexOf("    // Planner selection, general / place-detail turn naming a place: the same A2 gate as the\n");
    const sets = SRC.split("setPlanningSelectionTurnNotice(").length - 1;
    const clears = SRC.split("clearPlanningSelectionTurnNotice()").length - 1;
    expect("T7-N2-static-clear-at-turn-start", iSend > 0 && iClear > iSend && iClear < iA2 && iClear < iG1 && sets === 1 && clears === 2, `send() 早退 L${lineOf(iSend)} < 清除 L${lineOf(iClear)} < A2 L${lineOf(iA2)} < G1 L${lineOf(iG1)}；setPlanningSelectionTurnNotice 出現 ${sets} 次、clear 出現 ${clears} 次（回合開始＋顯示後）`);
  }
}

// ── T7-N3：四語系 key（chatRuntime.planningSelectionTurnPlaceNotFound）都存在且帶 {name} ──
P("\n  ── T7-N3 四語系 planningSelectionTurnPlaceNotFound ──");
{
  const I18N = await loadMod(`${WORK_ROOT}/src/lib/i18n/chat-runtime.ts`);
  const tables = Object.values(I18N).find((v) => v && typeof v === "object" && v["zh-TW"] && v.en && v.ja && v.ko) ?? null;
  const rows = [];
  for (const loc of ["zh-TW", "en", "ja", "ko"]) {
    const raw = tables?.[loc]?.planningSelectionTurnPlaceNotFound ?? null;
    const rendered = T7_COPY("〈測試名〉", loc);
    rows.push({ loc, raw: typeof raw === "string", hasVar: typeof raw === "string" && raw.includes("{name}") && raw.split("{name}").length === 2, rendered: rendered.includes("〈測試名〉") && !rendered.includes("{name}") && !rendered.startsWith("chatRuntime.") });
  }
  const distinct = new Set(["zh-TW", "en", "ja", "ko"].map((l) => T7_COPY("X", l))).size;
  INFO(`四語系：${J(rows)}；zh-TW=${J(T7_COPY("亞特蘭提斯"))}`);
  expect("T7-N3-four-locales-with-name", tables && rows.every((r) => r.raw && r.hasVar && r.rendered) && distinct === 4 && T7_COPY("亞特蘭提斯") === "找不到「亞特蘭提斯」這個地點。如果想換到其他城市，直接告訴我城市名稱就可以。", `四語系 key 皆存在、恰含一個 {name}、代入後無殘留且四語系文案不同（distinct=${distinct}）；zh-TW 與裁定文字逐字相同`);
  // 提示以回合語系產生（en selection 回合）
  await freshWorld();
  const envEn = await makeEnv(SEL["台南"].session, { locale: "en" });
  await preparePersistHeadSync(envEn);
  await runGeneral(envEn, "改去亞特蘭提斯");
  const nEn = M.ps.peekPlanningSelectionTurnNotice();
  expect("T7-N3-notice-uses-turn-locale", nEn?.message === T7_COPY("亞特蘭提斯", "en"), `en 回合暫存提示=${J(nEn?.message ?? null)}`);
}

// ── T7-I：附帶提及規則（planningSelectionTurnMentionsPlaceIncidentally）誤判／漏判語料 ──
//   誤判＝把「一般他城句」當成附帶提及 → 該先問卻照常走；漏判＝附帶提及沒認出 → 不該問卻先問。
P("\n  ── T7-I 附帶提及規則：必須先問的一般他城句／裁定接受的附帶句／誤判語料／漏判語料 ──");
{
  const runSet = async (list) => {
    const out2 = [];
    for (const [key, text] of list) {
      const r = await t6Turn(key, text);
      const written = IMP.planningSelectionTurnWrittenDestination(SEL[key].session, IMP.mergeTravelContext(IMP.applyTripIntentToSession(text, SEL[key].session), text).session) ?? null;
      const incidental = IMP.planningSelectionTurnMentionsPlaceIncidentally(text, written);
      const city = written ? (IMP.planningSelectionWrittenLeadingCity?.(written) ?? written) : null;
      const leak = city && city !== key ? r2FieldsWith(r.final, city).filter((f) => !r2FieldsWith(SEL[key].session, city).includes(f)) : [];
      out2.push({ key, text, outcome: r.outcome, pending: r.pending?.destination ?? null, written, incidental, rpc: r.rpc, places: r.places, geo: r.geocodes.length, kept: r.kept, tripSame: r.tripSame, path: r.path, leak });
      P(`  [real] [${key}]「${text}」${r.path} 寫入名稱=${J(written)} 附帶=${incidental} → ${r.outcome}${r.pending?.destination ? `(${r.pending.destination})` : ""} Credits=${r.rpc} Places=${r.places} geocode=${r.geocodes.length} 他城殘留=${J(leak)}${r.notice ? ` 提示=${J(r.notice.message)}` : ""}`);
    }
    return out2;
  };
  // 必須先問（指派者列出＋同類）
  const MUST_ASK = [["京都", "我想去大阪玩"], ["京都", "大阪有什麼好吃的"], ["京都", "我想吃大阪的拉麵"], ["台北", "台南有什麼好吃的"], ["東京", "京都有什麼好玩的"]];
  const must = await runSet(MUST_ASK);
  for (const x of must) expect(`T7-I-must-ask-[${x.key}]${x.text}`, x.outcome === "ask_switch" && x.rpc === 0 && x.places === 0 && x.kept && x.tripSame && x.geo <= 1, `一般句提到他城 → 先問（實際 ${x.outcome}${x.pending ? `(${x.pending})` : ""}，Credits=${x.rpc} Places=${x.places} geocode=${x.geo}）`);
  // 「他城＋附近」一般句（explicitNearbyAuthority 時 G1 不取寫入名稱）：仍屬「一般句提到他城」
  const NEARBY_OTHER = [["京都", "大阪附近有什麼好吃的"], ["京都", "我想去大阪附近玩"], ["台北", "台南附近有什麼好玩的"], ["東京", "京都車站附近的咖啡廳"]];
  const nb = await runSet(NEARBY_OTHER);
  const nbNotAsked = nb.filter((x) => x.outcome !== "ask_switch");
  INFO(`「他城＋附近」句的 resolveExplicitNearbyIntent（send() 本回合 explicitNearbyAuthority；G1 只在其為空時取寫入名稱）：${J(NEARBY_OTHER.map(([, t]) => [t, IMP.resolveExplicitNearbyIntent(t) ?? null]))}`);
  expect("T7-I-nearby-other-city-should-ask", nbNotAsked.length === 0, `「他城＋附近」句未先問換城市：${J(nbNotAsked.map((x) => `[${x.key}]${x.text}→${x.outcome}（寫入=${x.written}，他城殘留=${J(x.leak)}）`))}`, "risk");
  // 裁定接受的附帶句
  const ACCEPTED =[["京都", "大阪燒好吃嗎"], ["京都", "我朋友住大阪"], ["京都", "大阪的拉麵比較好吃嗎"], ["台北", "京都抹茶甜點推薦"]];
  const acc2 = await runSet(ACCEPTED);
  for (const x of acc2) expect(`T7-I-accepted-incidental-[${x.key}]${x.text}`, !STOPPED.has(x.outcome) && !String(x.outcome).startsWith("error") && x.kept && x.tripSame && x.rpc === 0 && x.places === 0, `裁定接受的附帶提及 → 照常走（實際 ${x.outcome}）`);
  // 誤判語料（應先問；規則若判為附帶即為誤判）
  const SHOULD_ASK = [
    ["京都", "大阪人氣景點有哪些"], ["京都", "大阪人氣美食推薦"], ["京都", "大阪燒肉推薦"], ["京都", "我想吃大阪燒肉"], ["京都", "大阪拉麵店推薦"],
    ["京都", "我想吃大阪拉麵"], ["京都", "我朋友在大阪，我想去找他"], ["京都", "我男友住大阪，想去找他玩"], ["台北", "台南人氣小吃推薦"], ["台北", "台中人氣餐廳"],
    ["京都", "東京人氣甜點店在哪"], ["京都", "大阪燒烤哪家好"], ["台北", "京都抹茶聖地宇治怎麼去"], ["京都", "大阪風味美食街在哪"], ["台北", "台南擔仔麵本店在哪裡"],
    ["京都", "大阪伴手禮店推薦"], ["京都", "大阪人潮多的商店街"],
  ];
  const sa = await runSet(SHOULD_ASK);
  const misjudged = sa.filter((x) => x.outcome !== "ask_switch");
  INFO(`誤判語料 ${sa.length} 句：先問 ${sa.length - misjudged.length}、照常走（附帶規則或其他原因）${misjudged.length}=${J(misjudged.map((x) => `[${x.key}]${x.text}→${x.outcome}（寫入=${x.written}，附帶=${x.incidental}）`))}`);
  expect("T7-I-misjudge-corpus-should-ask", misjudged.length === 0, `一般他城句被當成附帶提及而未先問（附帶=true 者為規則誤判）：${J(misjudged.filter((x) => x.incidental).map((x) => `[${x.key}]${x.text}`))}；其他原因未問：${J(misjudged.filter((x) => !x.incidental).map((x) => `[${x.key}]${x.text}→${x.outcome}（寫入=${x.written}）`))}`, "risk");
  expect("T7-I-misjudge-corpus-zero-cost", sa.every((x) => x.rpc === 0 && x.places === 0 && x.geo <= 1 && x.kept), `誤判語料：閘門段 0 扣點 0 搜尋、Geocoding ≤1、selection 保留`);
  // 漏判語料（不應先問；附帶提及沒被認出即為漏判）
  const SHOULD_NOT_ASK = [
    ["京都", "我老家在大阪"], ["京都", "我是大阪出身的"], ["京都", "我從大阪來的"], ["京都", "上次去大阪很好玩"], ["京都", "大阪腔聽得懂嗎"],
    ["京都", "我同事是大阪人"], ["京都", "剛從大阪出差回來"], ["京都", "跟大阪比起來這裡怎麼樣"], ["京都", "我昨天剛從大阪過來"], ["京都", "在大阪買的周遊券這裡能用嗎"],
    ["京都", "大阪的親戚要來找我"], ["京都", "我媽媽是大阪人"], ["京都", "有沒有像大阪黑門市場那樣的地方"], ["京都", "我住在大阪的朋友推薦這裡"], ["京都", "大阪燒和文字燒哪個好吃"],
    ["台北", "我是台南人想吃家鄉味"], ["台北", "我阿嬤住台南"], ["東京", "大阪來的同事推薦什麼"],
  ];
  const sn = await runSet(SHOULD_NOT_ASK);
  const missed = sn.filter((x) => STOPPED.has(x.outcome));
  INFO(`漏判語料 ${sn.length} 句：照常走 ${sn.length - missed.length}、被先問／停止 ${missed.length}=${J(missed.map((x) => `[${x.key}]${x.text}→${x.outcome}${x.pending ? `(${x.pending})` : ""}（寫入=${x.written}，附帶=${x.incidental}）`))}`);
  expect("T7-I-miss-corpus-should-not-ask", missed.length === 0, `附帶提及（非要去該城）被先問換城市：${J(missed.map((x) => `[${x.key}]${x.text}`))}`, "risk");
  // 裁定 5：照常走的附帶提及句，他城不得留在回合 session
  const leaked = [...acc2, ...sn].filter((x) => !STOPPED.has(x.outcome) && x.leak.length);
  expect("T7-I-incidental-proceeds-no-other-city-left", leaked.length === 0, `附帶提及照常走後，他城留在 session 的句子：${J(leaked.map((x) => `[${x.key}]${x.text}:${x.leak.join("|")}`))}`);
}

// ── T7-F：「不去台南了，改去京都」先問 → 回「好」→ 重跑原句的完整流程（真實 SWA／ANS／RSE 區塊；wrapper 不設哨兵，跑到 D5）──
P("\n  ── T7-F 先問後確認完整流程：「不去台南了，改去京都」（A2 CONFIRMED_SWITCH）──");
{
  async function confirmFlow(label, sessionTweak, answer) {
    await freshWorld();
    const base = sessionTweak ? sessionTweak(SEL["台南"].session) : SEL["台南"].session;
    const env = await makeEnv(base);
    await preparePersistHeadSync(env);
    const text = "不去台南了，改去京都";
    const r0 = rpcLog.length;
    const p0 = placeCalls.length;
    const g0 = googleReqs.length;
    // 1) 詢問回合（A2 區塊內 selection 先問）
    const ask = await runSwitchTurn(env, text);
    const pending = env.pending;
    // 2) 回「好」（或確認 chip）：真實 ANS 區塊
    const ans = answer === "chip" ? M.crc.chatRuntimeCopy("planningSelectionSwitchConfirmChip", "zh-TW", { destination: pending?.destination ?? "" }) : answer;
    IMP.clearConfirmedPlanningSelectionSwitch(ans); // #PL-FIX-T8：send() L8688（回答回合開始）
    const ansRet = await ANSWER({ ...env.deps, trimmed: ans, displayMessage: ans, session: env.sessionRef.current, msgs: env.msgs });
    const left = env.sessionRef.current;
    // 3) 重跑 effect（真實 RSE）
    const sends = [];
    await RESEND({ selectionSwitchResendRef: env.selectionSwitchResendRef, send: (t, o) => sends.push([t, o]) });
    // 4) 重跑原句：send() 真實順序（非 selection → A2 一般換城市流程）；wrapper Commit 後不攔截，跑到 D5 與 E3
    // D5 的兩個元件外 helper（_app.chat.tsx 模組層函式，未抽出）以「通過」替代，讓修正後的流程能跑到 E3。
    const rerunDeps = { ...env.deps, storeDestinationSwitchCardBoundary: () => {}, plusDurableWorkspaceSnapshot: () => null, destinationSwitchPersistFailure: () => null };
    // wrapper 不套用的原因探針（同一個真實函式、同參數）
    {
      const TC = await loadMod(`${WORK_ROOT}/src/lib/ai/travel-context.ts`);
      const TR = await loadMod(`${WORK_ROOT}/src/lib/ai/trip-planning-session-reset.ts`);
      const probe = TC.applyConfirmedDestinationSwitch(left, { label: "京都", requestText: text, turnResetBase: { planningSessionId: left.planningSessionId, planVersion: left.planVersion }, resetAlreadyThisTurn: false });
      INFO(`${label}：確認後 session 的 resolveActiveDestination=${J(TR.resolveActiveDestination(left) ?? null)}；applyConfirmedDestinationSwitch(左離 selection 的 session, 京都)=${J("stop" in probe ? { stop: probe.stop } : { applied: probe.applied })}`);
    }
    const envSaved = env.deps;
    env.deps = rerunDeps;
    const c0 = consoleLog.length;
    // #PL-FIX-T8：真實 send() 回合開始（L8688）先 clearConfirmedPlanningSelectionSwitch(trimmed)；同一句保留記錄。
    IMP.clearConfirmedPlanningSelectionSwitch(sends[0]?.[0] ?? text);
    const re = await runSwitchTurn(env, sends[0]?.[0] ?? text, { throughCommit: true, deps: { plusDurableWorkspaceSnapshot: () => null, destinationSwitchPersistFailure: () => null } });
    env.deps = envSaved;
    const after = env.sessionRef.current;
    const stops = env.stops.map((s) => s.slice(0, 2).join("/"));
    const a2Logs = consoleLog.slice(c0).filter((l) => l[1] === "[DESTINATION_SWITCH_GATE]").map((l) => l[2]?.reason ?? l[2]?.stage);
    const row = {
      label,
      askOutcome: ask.ret === undefined && pending?.entry === "general" ? "ask_switch" : `other(${ask.error ?? ask.lastMsg.slice(0, 20)})`,
      askCost: { rpc: ask.rpc, places: ask.places, geocode: ask.geocodes.length },
      ansRet: ansRet ?? null,
      leftSelection: !M.ps.isPlanningSelectionMode(left),
      leftTrip: labels(left).trip,
      leftTravel: labels(left).travel,
      resendCalls: sends.length,
      rerun: re.error ? `error(${re.error})` : re.ret?.turnSwitchVerified ? "switch_applied" : re.ret === undefined ? `stopped(${re.lastMsg.slice(0, 40)})` : "passthrough_unverified",
      a2Logs,
      stops,
      final: { trip: labels(after).trip, travel: labels(after).travel, planning: labels(after).planning, selection: M.ps.isPlanningSelectionMode(after) },
      totals: { rpc: rpcLog.length - r0, places: placeCalls.length - p0, geocode: googleReqs.slice(g0).filter((g) => g.kind === "geocode").map((g) => g.query) },
      lastMsg: env.msgs.at(-1)?.content ?? "",
    };
    P(`  [real] ${label}：${J(row)}`);
    return row;
  }
  const flows = [
    await confirmFlow("selection 原樣＋回「好」", null, "好"),
    await confirmFlow("selection 原樣＋確認 chip", null, "chip"),
    await confirmFlow("selection 無 travelContext.destination＋回「好」", (s) => ({ ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: undefined, destinationCity: undefined, destinationRegion: undefined } }), "好"),
    await confirmFlow("selection 無 travelContext／tripPlanningContext.destination＋回「好」", (s) => ({ ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: undefined, destinationCity: undefined, destinationRegion: undefined }, tripPlanningContext: s.tripPlanningContext ? { ...s.tripPlanningContext, destination: undefined } : s.tripPlanningContext }), "好"),
  ];
  INFO(`selection session 建立後 travelContext.destination=${J(SEL["台南"].session.travelContext?.destination ?? null)} tripPlanningContext.destination=${J(SEL["台南"].session.tripPlanningContext?.destination ?? null)}`);
  for (const f of flows) {
    expect(
      `T7-F-${f.label}`,
      f.askOutcome === "ask_switch" && f.askCost.rpc === 0 && f.askCost.places === 0 && f.ansRet == null && f.leftSelection && f.resendCalls === 1 && f.rerun === "switch_applied" && /京都/.test(`${f.final.travel}${f.final.trip}`) && !/台南/.test(String(f.final.travel ?? "")) && !f.final.selection && f.totals.rpc === 0 && f.totals.places === 0 && !/無法確認/.test(f.lastMsg),
      `先問（Credits=${f.askCost.rpc} Places=${f.askCost.places}）→ 回答後離開 selection（trip=${f.leftTrip}）→ 重跑 ${f.resendCalls} 次 → 重跑結果=${f.rerun}（A2 記錄=${J(f.a2Logs)} stop=${J(f.stops)}）→ 最終 travel=${J(f.final.travel)} trip=${J(f.final.trip)}；全程 Credits=${f.totals.rpc} Places=${f.totals.places} geocode=${J(f.totals.geocode)}；最後回覆=${J(f.lastMsg.slice(0, 40))}`,
    );
  }
}

// ── T7-A：非 selection 的 A2 行為不變（真實 SWH＋SWV＋SWA；對照組＝同一區塊剝除 #PL-FIX-T7 段落）──
P("\n  ── T7-A 非 selection A2 不變：目前區塊 vs 剝除 #PL-FIX-T7 段落的同一區塊（逐句比對回覆／記錄／寫入／Commit）──");
{
  let swa = BLOCKS.SWA.code;
  const t7Start = "      // #PL-FIX-T7: Planner selection — a confirmed switch sentence";
  const t7End = "        selectionSwitchDeferred = true;\n        break selectionConfirmedSwitch;\n      }\n";
  const a = swa.indexOf(t7Start);
  const b = swa.indexOf(t7End, a);
  const endMark = "      } // #PL-FIX-T7: end selectionConfirmedSwitch\n";
  const gateMark = "      !turnSwitchVerified &&\n      !selectionSwitchDeferred\n";
  const stripOk = a > 0 && b > a && swa.split(endMark).length === 2 && swa.split(gateMark).length === 2;
  if (stripOk) {
    swa = swa.slice(0, a) + swa.slice(b + t7End.length);
    swa = swa.replace(endMark, "").replace(gateMark, "      !turnSwitchVerified\n").replace("    // #PL-FIX-T7: or a Planner selection sentence deferred to the selection general path above.\n", "");
  }
  expect("T7-A-strip-t7-from-swa", stripOk && !/PL-FIX-T7|selectionConfirmedSwitch|selectionSwitchDeferred/.test(swa), `SWA 區塊剝除 #PL-FIX-T7（label 區塊、結尾標記、閘門條件）後不再含 T7 識別字`);
  const SWITCH_PRE = await compile(`${BLOCKS.SWH.code}\n${BLOCKS.SWV.code}\n${swa}`, 'return { reached: "after_switch_gate", turnSwitchVerified };');
  async function runVariant(fn, session, text) {
    await freshWorld();
    const env = await makeEnv(session);
    await preparePersistHeadSync(env);
    const r0 = rpcLog.length;
    const g0 = googleReqs.length;
    const c0 = consoleLog.length;
    const turnSwitch = IMP.classifyDestinationSwitchTurn(text);
    let ret;
    let error = null;
    try {
      ret = await fn({
        ...env.deps, trimmed: text, displayMessage: text, session, msgs: env.msgs, turnSwitch,
        turnStartSession: { ...session, pendingClarification: undefined },
        turnResetBase: { planningSessionId: session.planningSessionId, planVersion: session.planVersion },
        turnSourceIsUser: true, turnPendingGeographic: undefined,
        showSwitchTurnUserMessage: () => { const m = [...env.msgsRef.current, { role: "user", content: text }]; env.base.setMsgs(m); return m; },
        destinationSwitchSyncPendingRef: { current: null }, destinationSwitchCardBoundaryRef: { current: null },
        storeDestinationSwitchCardBoundary: () => {}, turnPreviousSession: session,
        // D5 的模組層 helper（未抽出）：兩個變體使用同一替代，比對到 E3
        plusDurableWorkspaceSnapshot: () => null, destinationSwitchPersistFailure: () => null,
      });
    } catch (e) {
      error = String(e?.message ?? e).split("\n")[0];
    }
    const strip = (s) => s && J({ trip: s.tripDestination, travel: s.travelContext?.destination, planning: s.tripPlanningContext?.destination, selection: Boolean(s.planningSelection), phase: s.phase });
    return J({
      ret: ret && { reached: ret.reached, verified: ret.turnSwitchVerified }, error,
      msgs: env.msgs.map((m) => `${m.role}:${m.content}`),
      gate: consoleLog.slice(c0).filter((l) => /DESTINATION_SWITCH|PLANNING_SELECTION/.test(String(l[1]))).map((l) => `${l[1]}:${J(l[2])}`),
      persisted: env.persisted.map(strip), stops: env.stops.map((s) => s.slice(0, 2).join("/")), pending: env.pending, rpc: rpcLog.length - r0,
      geocode: googleReqs.slice(g0).filter((g) => g.kind === "geocode").length, final: strip(env.sessionRef.current),
    });
  }
  const nonSel = {
    "台南(已離開 selection)": M.ps.leavePlanningSelection(SEL["台南"].session),
    "京都(已離開 selection)": M.ps.leavePlanningSelection(SEL["京都"].session),
  };
  const TEXTS = ["不去台南了，改去京都", "改去京都", "換到大阪", "不要京都了，去大阪", "改去亞特蘭提斯", "不去台南了，改去亞特蘭提斯", "改成霍格華茲", "我不去台南了", "改去輕井澤", "我要換到台北", "不去京都了，改去大阪", "不去京都了，改去東京", "不去台南了，改去台北", "不去京都了，改去輕井澤", "我不去京都了"];
  const diffs = [];
  let n = 0;
  for (const [sname, s] of Object.entries(nonSel)) {
    for (const text of TEXTS) {
      if (IMP.classifyDestinationSwitchTurn(text).state === "NO_SWITCH") continue;
      const cur = await runVariant(SWITCH, s, text);
      const pre = await runVariant(SWITCH_PRE, s, text);
      n += 1;
      // 目前區塊的回傳多了 selectionSwitchDeferred／switchProbe 欄位；SWITCH 的 tail 不同，只比對 reached／verified
      if (cur !== pre) diffs.push(`[${sname}]${text}`);
      const c = JSON.parse(cur);
      INFO(`  [${sname}]「${text}」目前=${J(c.ret)} error=${J(c.error)} 回覆=${J(String(c.msgs.at(-1) ?? "").slice(0, 30))} persist=${c.persisted.length} geocode=${c.geocode}｜與剝除版相同=${cur === pre}`);
    }
  }
  INFO(`非 selection A2 對照：${n} 組（2 個非 selection session × CONFIRMED／NEGATED 句）`);
  expect("T7-A-non-selection-a2-identical", n > 0 && diffs.length === 0, `非 selection 的 A2：目前區塊與剝除 #PL-FIX-T7 的區塊在回覆、A2 記錄、寫入、Commit、Credits、Geocoding 完全相同；不同=${J(diffs)}`);
  // selection 模式下 switchFromPendingConfirm（E1 問「要換到 X 嗎」→「對」）不進 T7 區塊：記錄行為
  INFO("selection 模式下 E0 destination_update pending 的「對」（switchFromPendingConfirm）依 `!switchFromPendingConfirm` 條件不走 T7 先問，沿用 A2 Commit（見報告）");
}

if (T6_ONLY) {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  await server.close();
  const acc = rows.filter((r) => r.cat === "acc");
  const risk = rows.filter((r) => r.cat === "risk");
  P(`\n（--t6-only：略過第 2-8 節）missing 識別字=${J([...missing])}`);
  P(`[acc] PASS=${acc.filter((r) => r.ok).length}/${acc.length}${acc.some((r) => !r.ok) ? `（FAIL：${acc.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}；[risk] 問題存在（FAIL）=${risk.filter((r) => !r.ok).length}/${risk.length}${risk.some((r) => !r.ok) ? `（${risk.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}`);
  P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
  P(`verify-planner-selection-general-gate (--t6-only): ${external > 0 || acc.some((r) => !r.ok) ? "FAIL" : "PASS"}`);
  // REL-1：等 stdout 寫完再結束，避免 pipe 截斷摘要。
  await new Promise((done) => process.stdout.write(`${out.join("\n")}\n`, done));
  process.exit(external > 0 || acc.some((r) => !r.ok) ? 1 : 0);
}

// ═════════════════════════ 2. 一般路徑閘門：23 句子區域＋5 句他城＋不可信＋無地名 ═════════════════════════
P("\n══ 2. 一般路徑（G1 閘門 → G3 寫入 → keep）：每句冷啟動模組（等同第一次提到／重新整理後）══");
const SUB = [
  ["新北", "我想去淡水玩"], ["新北", "淡水有什麼好吃的"], ["新北", "九份有什麼好玩的"], ["新北", "去板橋走走"],
  ["新北", "三峽老街好玩嗎"], ["新北", "野柳有什麼好玩的"], ["新北", "我想去金瓜石"], ["新北", "我想去新北市淡水區玩"],
  ["台北", "我想去北投泡湯"], ["台北", "士林有什麼好吃的"], ["台北", "大稻埕有什麼好玩的"],
  ["台南", "安平有什麼好吃的"], ["台南", "我想去七股玩"],
  ["宜蘭", "我想去礁溪泡溫泉"], ["宜蘭", "羅東有什麼好吃的"],
  ["京都", "我想去嵐山玩"], ["京都", "祇園有什麼好吃的"], ["京都", "伏見有什麼好玩的"],
  ["東京", "淺草有什麼好吃的"], ["東京", "我想去新宿逛街"], ["東京", "澀谷有什麼好玩的"],
  ["大阪", "難波有什麼好吃的"], ["大阪", "我想去心齋橋"],
];
const OTHER = [["新北", "我想去台中玩"], ["東京", "我想去大阪玩"], ["台南", "我想去京都玩兩天"], ["京都", "我想去輕井澤玩"], ["台北", "那花蓮呢"]];
const UNTRUSTED = [["台南", "我想去亞特蘭提斯玩"], ["京都", "霍格華茲有什麼好吃的"]];
const NOPLACE = [["台南", "有什麼好吃的"], ["京都", "我想吃拉麵"]];
const table = [];
async function runCase(group, key, text) {
  await freshWorld();
  const { session, picks } = SEL[key];
  const env = await makeEnv(session);
  await preparePersistHeadSync(env);
  const named = IMP.planningSelectionTurnNamesPlace(text);
  const sw = M.tpc.classifyDestinationSwitchTurn(text).state;
  const cont = M.ps.isPlanningSelectionContinuation(text);
  const early = earlyExit(session, text);
  const r = await runGeneral(env, text);
  // 暖快取：同一模組狀態再說一次同一句（共用快取）
  const env2 = await makeEnv(session);
  await preparePersistHeadSync(env2);
  const r2 = await runGeneral(env2, text);
  // 閘門判定的直接對照（同一組真實函式、同參數；不經區塊）：區分「閘門真的不可信」與「harness 例外」
  let direct = null;
  if (named && r.outcome === "unconfirmed") {
    await freshWorld();
    const geocodeFn = async (args) => M.lf.geocodeTripLocationFromText(args);
    const selectionLabel = M.ps.planningSelectionDestinationLabel(session);
    const g0 = googleReqs.length;
    try {
      const requested = await IMP.resolvePlanningSelectionTurnDestination({ ctx: session.travelContext ?? { interests: [] }, session, userText: text, locale: "zh-TW", geocodeFn, selectionLabel });
      const scope = requested ? await IMP.resolveTrustedRecommendationSearchScope({ label: requested, ctx: session.travelContext ?? { interests: [] }, session: IMP.stripClientSearchScope(session), locale: "zh-TW", geocodeFn }) : null;
      direct = { requested: requested ?? null, scope: scope ? (scope.status === "trusted" ? `trusted/${scope.destination}` : `unavailable/${scope.reason}`) : null, geocode: googleReqs.length - g0 };
    } catch (e) {
      direct = { error: String(e?.message ?? e).split("\n")[0] };
    }
  }
  const row = {
    group, key, text, named, sw, cont,
    outcome: r.outcome,
    gateReason: r.gateReason ?? null,
    direct,
    kept: M.ps.isPlanningSelectionMode(r.final),
    selected: selectedFromSelection(r.final, picks),
    l: labels(r.final),
    focus: r.focus ?? null,
    rpc: r.rpc.length, places: r.places,
    geocode: r.geocodes.length, geocodeQ: r.geocodes,
    geocodeWarm: r2.geocodes.length,
    toasts: r.toasts.length,
    pending: r.pending?.destination ?? null,
    stops: env.stops.length,
    tripIsSelection: J(r.final?.tripDestination) === J(session.tripDestination),
    locIsSelection: J(r.final?.location) === J(session.location),
    final: r.final,
  };
  table.push(row);
  row.early = early;
  P(`  [real] [${key}]「${text}」(${group}) named=${named} switch=${sw} cont=${cont} 閘門前既有早退=${J(early)} →${row.outcome}${row.pending ? `(${row.pending})` : ""}${row.gateReason ? ` gate.reason=${row.gateReason}` : ""}${row.direct ? ` 直接呼叫閘門函式=${J(row.direct)}` : ""}；selection ${row.kept ? "保留" : "離開"} 已選 ${row.selected}/2；trip=${J(row.l.trip)} loc=${J(row.l.loc)} travel=${J(row.l.travel)} planning=${J(row.l.planning)} focus=${J(row.focus)}；Credits=${row.rpc} Places=${row.places} geocode=${row.geocode}${row.geocode ? J(row.geocodeQ) : ""}（暖快取 ${row.geocodeWarm}）toast=${row.toasts}`);
  return row;
}
for (const [k, t] of SUB) await runCase("sub", k, t);
for (const [k, t] of OTHER) await runCase("other", k, t);
for (const [k, t] of UNTRUSTED) await runCase("untrusted", k, t);
for (const [k, t] of NOPLACE) await runCase("noplace", k, t);
if (missing.size) INFO(`一般路徑區塊 missing 識別字：${J([...missing])}`);

const sub = table.filter((r) => r.group === "sub");
const subOk = sub.filter((r) => r.outcome === "proceed" && r.kept && r.selected === 2 && r.tripIsSelection && r.locIsSelection);
const subBad = sub.filter((r) => !subOk.includes(r));
INFO(`子區域 ${sub.length} 句：通過閘門、保留 selection＋2 個已選、tripDestination／location 維持 selection＝${subOk.length}；其餘=${J(subBad.map((r) => `[${r.key}]${r.text}→${r.outcome}/kept=${r.kept}/trip=${r.l.trip}`))}`);
expect("REQ1a-subarea-keeps-selection", subBad.length === 0, `子區域句：selection 與已選地點保留、tripDestination／location 維持 selection（不符 ${subBad.length}/${sub.length}）`);
const subFocusBad = sub.filter((r) => r.outcome === "proceed" && r.l.travel && !r.focus);
expect("REQ1a-subarea-focus-only-this-turn", sub.every((r) => r.outcome !== "proceed" || r.focus) && subFocusBad.length === 0, `子區域只作本回合查詢焦點（focus 皆有值；travel／planning 若非 selection 只帶閘門焦點）：${J(sub.map((r) => `${r.text}:${r.focus}/${r.l.travel}/${r.l.planning}`))}`);
const subGeo = sub.map((r) => r.geocode);
expect("REQ4-subarea-geocode-at-most-3", subGeo.every((n) => n <= 3), `子區域句 Geocoding 次數（冷）=${J(subGeo)}，每句最多 3 次`);
expect("REQ4-subarea-geocode-shared-cache", sub.every((r) => r.geocodeWarm <= r.geocode), `同一模組狀態第二次說同一句的 Geocoding 次數（暖）=${J(sub.map((r) => r.geocodeWarm))}`, "risk");
const other = table.filter((r) => r.group === "other");
for (const r of other) {
  expect(`REQ1b-other-${r.text}-asks`, r.outcome === "ask_switch" && r.rpc === 0 && r.places === 0 && r.kept && r.selected === 2 && r.tripIsSelection, `[${r.key}]「${r.text}」→ ${r.outcome}(${r.pending})：Credits=${r.rpc} Places=${r.places}、selection 保留、tripDestination 未寫入新目的地`);
}
// #PL-FIX-T5 裁定 1：無法確認且非明確換城市措辭 → 照常走、selection 與目的地維持、不寫入未驗證目的地、閘門 0 扣點 0 搜尋
for (const r of table.filter((x) => x.group === "untrusted")) {
  const name = r.text.includes("亞特蘭提斯") ? "亞特蘭提斯" : "霍格華茲";
  const leaked = destFieldsWith(r.final, name);
  expect(
    `REQ1c-untrusted-${r.text}`,
    r.outcome === "proceed" && r.rpc === 0 && r.places === 0 && r.kept && r.selected === 2 && r.tripIsSelection && r.locIsSelection && leaked.length === 0 && r.geocode <= 1 && r.toasts === 0,
    `「${r.text}」→ ${r.outcome}（gate.reason=${r.gateReason}）：照常走、Credits=${r.rpc} Places=${r.places}、selection 保留（已選 ${r.selected}/2）、trip／location 維持 selection、目的地欄位含「${name}」=${J(leaked)}、geocode=${r.geocode}`,
  );
}
// #PL-FIX-T5 裁定 1（後半）：明確換城市措辭＋無法確認 → 停止並回「無法確認」（不寫入、不扣點、不搜尋、selection 保留）
P("\n  ── 明確換城市措辭＋不可信（send() 真實順序：turnSwitch≠NO_SWITCH 先走既有 A2 閘門；NO_SWITCH 才到 G1）──");
// 對照：同樣措辭帶已知城市時的分類（判斷「改去〇〇」是否只認得已知地名）
for (const t of ["改去京都", "我要換到大阪", "改去亞特蘭提斯", "我要換到霍格華茲", "換去霍格華茲", "改成亞特蘭提斯", "不要京都了，去霍格華茲", "不去台南了，改去亞特蘭提斯"]) {
  const c = IMP.classifyDestinationSwitchTurn(t);
  INFO(`  分類「${t}」：classifyDestinationSwitchTurn=${c.state}${c.targetLabel ? `(${c.targetLabel})` : ""} planningSelectionTurnRequestsSwitch=${IMP.planningSelectionTurnRequestsSwitch(t)} planningSelectionTurnNamesPlace=${IMP.planningSelectionTurnNamesPlace(t)}`);
}
const EXPLICIT = [
  ["台南", "改去亞特蘭提斯", "亞特蘭提斯"],
  ["京都", "我要換到霍格華茲", "霍格華茲"],
  ["台南", "不去台南了，改去亞特蘭提斯", "亞特蘭提斯"],
  ["京都", "不要京都了，去霍格華茲", "霍格華茲"],
];
for (const [key, text, name] of EXPLICIT) {
  await freshWorld();
  const { session, picks } = SEL[key];
  const env = await makeEnv(session);
  await preparePersistHeadSync(env);
  const state = IMP.classifyDestinationSwitchTurn(text).state;
  const requestsSwitch = IMP.planningSelectionTurnRequestsSwitch(text);
  let path;
  let stopped;
  let reply;
  let rpc;
  let places;
  let geocodes;
  let after;
  let detail;
  if (state !== "NO_SWITCH") {
    const r = await runSwitchTurn(env, text);
    path = "A2-switch";
    stopped = r.ret === undefined && !r.error;
    reply = r.lastMsg;
    ({ rpc, places, geocodes, after } = r);
    detail = `turnSwitch=${state}(${r.target}) gate=${J(r.gate.map((g) => g?.reason))}${r.error ? ` error=${r.error}` : ""} persisted=${r.persisted} deferred=${r.deferred}`;
    if (!stopped && r.deferred) {
      // #PL-FIX-T7：A2 交給 selection 一般路徑（同一回合、同一個 switchProbe）
      const g = await runGeneral(env, text, { extraDeps: { switchProbe: r.switchProbe } });
      path = "A2-switch→G1";
      stopped = g.outcome === "unconfirmed" || g.outcome === "ask_switch" || g.outcome.startsWith("error");
      reply = g.lastMsg;
      rpc += g.rpc.length;
      places += g.places;
      geocodes = [...geocodes, ...g.geocodes];
      after = g.final;
      detail += ` G1→${g.outcome} gate.reason=${g.gateReason}`;
    }
  } else {
    const r = await runGeneral(env, text);
    path = "G1";
    stopped = r.outcome === "unconfirmed" || r.outcome === "ask_switch" || r.outcome.startsWith("error");
    reply = r.lastMsg;
    rpc = r.rpc.length;
    places = r.places;
    geocodes = r.geocodes;
    after = r.final;
    detail = `turnSwitch=NO_SWITCH requestsSwitch=${requestsSwitch} G1→${r.outcome} gate.reason=${r.gateReason}`;
  }
  const leaked = destFieldsWith(after, name);
  const notice = M.ps.peekPlanningSelectionTurnNotice?.() ?? null;
  P(`  [real] [${key}]「${text}」→ ${path} ${detail} 停止=${stopped} 回覆=${J(reply.slice(0, 40))} Credits=${rpc} Places=${places} geocode=${J(geocodes)} selection=${M.ps.isPlanningSelectionMode(after)} 已選=${selectedFromSelection(after, picks)} 目的地欄位含「${name}」=${J(leaked)} 提示=${J(notice?.message ?? null)}`);
  // #PL-FIX-T7 裁定 1：明確換城市措辭＋無法確認 → 不停下、照常回答、維持 selection 城市、不寫入未驗證名稱；ZERO_RESULTS 附提示
  expect(
    `REQ1c-explicit-switch-${text}`,
    !stopped && !/無法確認/.test(reply) && rpc === 0 && places === 0 && geocodes.length <= 1 && M.ps.isPlanningSelectionMode(after) && selectedFromSelection(after, picks) === 2 && J(after.tripDestination) === J(session.tripDestination) && leaked.length === 0 && notice?.message === M.crc.chatRuntimeCopy("planningSelectionTurnPlaceNotFound", "zh-TW", { name }),
    `明確換城市＋不可信：照常走（不停下、不回無法確認）、Credits=${rpc} Places=${places} geocode=${geocodes.length}、selection／已選／tripDestination 保留、不寫入「${name}」、ZERO_RESULTS 提示=${J(notice?.message ?? null)}（${path}）`,
  );
  // G1 本身對換城市措辭的分支（真實 send() 中 turnSwitch≠NO_SWITCH 的句子到不了 G1；此處直接執行 G1 確認其分支也停止）
  if (state !== "NO_SWITCH") {
    await freshWorld();
    const envG = await makeEnv(session);
    await preparePersistHeadSync(envG);
    const g = await runGeneral(envG, text);
    INFO(`  直接執行 G1（繞過 A2）「${text}」：requestsSwitch=${requestsSwitch} → ${g.outcome} gate.reason=${g.gateReason ?? null} Credits=${g.rpc.length} Places=${g.places}`);
  }
}

for (const r of table.filter((x) => x.group === "noplace")) {
  expect(`REQ1d-noplace-${r.text}`, !r.named && r.geocode === 0 && r.outcome === "proceed" && r.kept, `「${r.text}」不帶地名：不進閘門（geocode=${r.geocode}）、照舊走一般路徑（${r.outcome}）`);
}
expect("REQ2-no-toast-without-proof", table.filter((r) => r.group !== "other").every((r) => r.toasts === 0), `子區域／不可信／無地名句都不顯示「已離開…的選點」`);
INFO(`Geocoding（冷）：子區域 ${J(subGeo)}；他城 ${J(other.map((r) => r.geocode))}；不可信 ${J(table.filter((r) => r.group === "untrusted").map((r) => r.geocode))}；無地名 ${J(table.filter((r) => r.group === "noplace").map((r) => r.geocode))}`);

// ═════════════════════════ 3. 他城：詢問 → 確認（重跑原句）／取消 ═════════════════════════
P("\n══ 3. 他城詢問 → 確認後重跑一般路徑／取消保留（真實 ANS＋RSE 區塊）══");
{
  await freshWorld();
  const { session, picks } = SEL["台南"];
  const env = await makeEnv(session);
  await preparePersistHeadSync(env);
  const text = "我想去京都玩兩天";
  const ask = await runGeneral(env, text);
  const confirmChip = M.crc.chatRuntimeCopy("planningSelectionSwitchConfirmChip", "zh-TW", { destination: ask.pending?.destination ?? "" });
  P(`  [real] 詢問：${ask.outcome} pending=${J(ask.pending && { destination: ask.pending.destination, previous: ask.pending.previous, entry: ask.pending.entry })} 回覆=${J(ask.lastMsg.slice(0, 30))} chip=${J(confirmChip)}`);
  expect("FLOW-ask-zero-cost", ask.outcome === "ask_switch" && ask.rpc.length === 0 && ask.places === 0, `詢問回合：Credits=${J(ask.rpc)} Places=${ask.places}（geocode=${ask.geocodes.length}）`);
  // 確認
  const r0 = rpcLog.length;
  const p0 = placeCalls.length;
  const t0 = env.toasts.length;
  const ansRet = await ANSWER({ ...env.deps, trimmed: confirmChip, displayMessage: confirmChip, session: env.sessionRef.current, msgs: env.msgs });
  const left = env.sessionRef.current;
  P(`  [real] 確認「${confirmChip}」：ANS 回傳=${J(ansRet ?? null)} resendRef=${J(env.selectionSwitchResendRef.current)} tick=${env.resendTick} pushMore=${env.pushMore ?? 0} selection=${M.ps.isPlanningSelectionMode(left)} 已選=${selectedFromSelection(left, picks)} trip=${J(labels(left).trip)} loc=${J(labels(left).loc)} toast=${env.toasts.length - t0}`);
  expect("FLOW-confirm-leaves-and-schedules-resend", !M.ps.isPlanningSelectionMode(left) && selectedFromSelection(left, picks) === 0 && labels(left).trip === ask.pending?.destination && env.selectionSwitchResendRef.current === text && env.resendTick === 1 && !env.pushMore, `確認：離開 selection（已選 0）、tripDestination＝閘門結果、排定重跑原句 1 次、不走 more_places`);
  expect("FLOW-confirm-block-zero-cost", rpcLog.length === r0 && placeCalls.length === p0 && env.toasts.length === t0, `確認區塊本身：Credits=${rpcLog.length - r0} Places=${placeCalls.length - p0}，且不顯示「已離開…的選點」（明確確認不是過期清除）`);
  // useEffect（真實本體）：StrictMode／重複 render 下執行兩次，send 只被呼叫一次
  const sends = [];
  const effDeps = { selectionSwitchResendRef: env.selectionSwitchResendRef, send: (t, o) => sends.push([t, o]) };
  await RESEND(effDeps);
  await RESEND(effDeps);
  expect("FLOW-resend-effect-once", sends.length === 1 && sends[0][0] === text && sends[0][1]?.source === "user" && env.selectionSwitchResendRef.current === null, `重跑 effect 執行 2 次 → send 呼叫 ${sends.length} 次（${J(sends)}）`);
  // 重跑：已離開 selection → G1 不進閘門；G3 一般路徑
  const g0 = googleReqs.length;
  const rerun = await runGeneral(env, text);
  P(`  [real] 重跑原句：${rerun.outcome} selection=${M.ps.isPlanningSelectionMode(rerun.final)} trip=${J(labels(rerun.final).trip)} travel=${J(labels(rerun.final).travel)} planning=${J(labels(rerun.final).planning)} Credits(寫入段)=${rerun.rpc.length} Places=${rerun.places} geocode=${J(rerun.geocodes)} gate=${J(consoleLog.filter((l) => l[1] === "[PLANNING_SELECTION_SCOPE_GATE]").length)}`);
  expect("FLOW-rerun-general-path", rerun.outcome === "proceed" && !M.ps.isPlanningSelectionMode(rerun.final) && /京都/.test(`${labels(rerun.final).travel}${labels(rerun.final).trip}`) && rerun.rpc.length === 0, `重跑走一般路徑（非 selection、目的地京都；寫入段 Credits=${rerun.rpc.length}，之後的推薦由既有一般路徑扣點）`);
  // #PL-FIX-T5 裁定 4：重跑被 streaming／generating 擋下 → 保留並在解鎖後重跑一次；仍被擋或被生成鎖擋 → 聊天提示重新送出；不得靜默丟失。
  // 行為模擬：React state（streaming／generating）、生成鎖、兩個 ref 由測試持有；三段真實程式碼：
  //   RSE（tick effect 本體 L${BLOCKS.RSE.from}）、RDE（[streaming, generating] effect 本體 L${BLOCKS.RDE.from}）、RS（send() 開頭攔截 L${BLOCKS.RS.from}-L${BLOCKS.RS.to}）。
  //   RS 放行後依 send() 既有兩道檢查（L${lineOf(SRC.indexOf("    if (!trimmed || streaming || generating) return;\n"))}、生成鎖）判定：仍被擋＝靜默丟失；否則＝原句真的執行。
  //   effect 執行順序依宣告順序（RSE 在 RDE 之前）；同一次 render 若 tick 與 streaming 同時改變，先 RSE 後 RDE。
  P("  ── RISK-c 行為：確認換城市後的重跑被擋（真實 RS／RSE／RDE 區塊）──");
  const resendBlockedCopy = (t) => M.crc.chatRuntimeCopy("planningSelectionSwitchResendBlocked", "zh-TW", { text: t });
  async function resendScenario(name, { busyAtConfirm = {}, lockedAtConfirm = false, steps = [] }) {
    const st = { streaming: false, generating: false, locked: lockedAtConfirm, ...busyAtConfirm };
    const refs = { selectionSwitchResendRef: { current: null }, selectionSwitchResendDeferredRef: { current: null } };
    const log = { ran: [], silent: [], msgs: [], sendCalls: 0 };
    let tickPending = false;
    const setTick = (fn) => {
      tickPending = true;
    };
    const setMsgs = (next) => {
      log.msgs = typeof next === "function" ? next(log.msgs) : next;
    };
    const send = async (t, o) => {
      log.sendCalls += 1;
      const trimmedT = String(t ?? "").trim();
      const r = await RESEND_GUARD({ ...IMP, opts: o, trimmed: trimmedT, streaming: st.streaming, generating: st.generating, isChatGenerationLocked: () => st.locked, setMsgs, chatRuntimeCopy: M.crc.chatRuntimeCopy, locale: "zh-TW", ...refs });
      if (r !== "__PROCEED__") return;
      if (!trimmedT || st.streaming || st.generating || st.locked) log.silent.push(trimmedT);
      else log.ran.push(trimmedT);
    };
    const commit = async ({ busyChanged }) => {
      // 同一次 render 的 effect：先 RSE（tick 有變），再 RDE（streaming／generating 有變）
      while (tickPending || busyChanged) {
        if (tickPending) {
          tickPending = false;
          await RESEND({ selectionSwitchResendRef: refs.selectionSwitchResendRef, send });
        }
        if (busyChanged) {
          busyChanged = false;
          await RESEND_DEFER({ streaming: st.streaming, generating: st.generating, selectionSwitchResendRef: refs.selectionSwitchResendRef, setSelectionSwitchResendTick: setTick });
        }
      }
    };
    // 確認（ANS）：排定重跑
    refs.selectionSwitchResendRef.current = text;
    setTick();
    await commit({ busyChanged: false });
    const trace = [`confirm:ran=${log.ran.length},hint=${log.msgs.length},deferred=${J(refs.selectionSwitchResendRef.current)}`];
    for (const step of steps) {
      if (step.lock !== undefined) st.locked = step.lock;
      const before = `${st.streaming}/${st.generating}`;
      if (step.streaming !== undefined) st.streaming = step.streaming;
      if (step.generating !== undefined) st.generating = step.generating;
      const busyChanged = before !== `${st.streaming}/${st.generating}`;
      if (step.interleave) {
        // RDE 排定 tick 之後、下一次 render 之前，又有別的請求開始（同一批次更新）
        if (busyChanged) await RESEND_DEFER({ streaming: st.streaming, generating: st.generating, selectionSwitchResendRef: refs.selectionSwitchResendRef, setSelectionSwitchResendTick: setTick });
        Object.assign(st, step.interleave);
        await commit({ busyChanged: false });
      } else {
        await commit({ busyChanged });
      }
      trace.push(`${J(step)}:ran=${log.ran.length},hint=${log.msgs.length}`);
    }
    const hints = log.msgs.filter((m) => m.content === resendBlockedCopy(text));
    const r = { name, ran: log.ran.length, silent: log.silent.length, hints: hints.length, otherMsgs: log.msgs.length - hints.length, sendCalls: log.sendCalls, refLeft: refs.selectionSwitchResendRef.current, deferredLeft: refs.selectionSwitchResendDeferredRef.current, trace };
    P(`  [real] ${name}：原句執行=${r.ran} 提示重新送出=${r.hints} 靜默丟失=${r.silent} send 呼叫=${r.sendCalls} 殘留 ref=${J(r.refLeft)}/${J(r.deferredLeft)}｜${trace.join(" → ")}`);
    return r;
  }
  const once = (r, want) => r.silent === 0 && r.ran + r.hints === 1 && (want === "ran" ? r.ran === 1 : r.hints === 1) && r.otherMsgs === 0 && r.refLeft === null && r.deferredLeft === null;
  const scen = [
    [await resendScenario("C0 未被擋", {}), "ran"],
    [await resendScenario("C1 streaming 中確認 → streaming 結束", { busyAtConfirm: { streaming: true }, steps: [{ streaming: false }] }), "ran"],
    [await resendScenario("C2 streaming＋generating → streaming 結束（generating 仍在）→ generating 結束", { busyAtConfirm: { streaming: true, generating: true }, steps: [{ streaming: false }, { generating: false }] }), "ran"],
    [await resendScenario("C3 streaming 結束時另一請求立即開始（再次被擋）→ 結束", { busyAtConfirm: { streaming: true }, steps: [{ streaming: false, interleave: { streaming: true } }, { streaming: false }] }), "hint"],
    [await resendScenario("C4 只被生成鎖擋（無 streaming／generating）", { lockedAtConfirm: true }), "hint"],
    [await resendScenario("C5 streaming 中確認 → 結束時已上生成鎖", { busyAtConfirm: { streaming: true }, steps: [{ lock: true, streaming: false }] }), "hint"],
    [await resendScenario("C6 已重跑後又有 streaming 開關（不得重跑第二次）", { steps: [{ streaming: true }, { streaming: false }, { generating: true }, { generating: false }] }), "ran"],
    [await resendScenario("C7 streaming 中確認 → streaming 結束 → 之後再有 streaming 開關", { busyAtConfirm: { streaming: true }, steps: [{ streaming: false }, { streaming: true }, { streaming: false }] }), "ran"],
  ];
  for (const [r, want] of scen) {
    expect(`REQ4-resend-${r.name.split(" ")[0]}`, once(r, want), `${r.name}：預期${want === "ran" ? "原句執行 1 次" : "聊天提示重新送出 1 則"}；實際 執行=${r.ran} 提示=${r.hints} 靜默丟失=${r.silent} 其他訊息=${r.otherMsgs} 殘留 ref=${J(r.refLeft)}/${J(r.deferredLeft)}`);
  }
  expect("RISK-c-resend-never-dropped-silently", scen.every(([r]) => r.silent === 0 && r.ran + r.hints === 1), `所有被擋情境都不靜默丟失（每個情境恰好「執行 1 次」或「提示 1 則」）：${J(scen.map(([r]) => `${r.name.split(" ")[0]}:${r.ran}/${r.hints}/${r.silent}`))}`, "risk");
  {
    const hintPersisted = /setMsgs\(\(prev\) => \[[\s\S]*planningSelectionSwitchResendBlocked[\s\S]*\]\);/.test(BLOCKS.RS.code) && !/persistSession\(/.test(BLOCKS.RS.code);
    INFO(`重跑被擋的提示只經 setMsgs（RS 區塊不呼叫 persistSession）=${hintPersisted}：重新整理後提示訊息不在對話紀錄中（selection 已在確認時離開並持久化，原句仍需使用者重送）`);
  }
  // 取消
  await freshWorld();
  const env3 = await makeEnv(SEL["台南"].session);
  await preparePersistHeadSync(env3);
  const ask3 = await runGeneral(env3, text);
  const cancelChip = M.crc.chatRuntimeCopy("planningSelectionSwitchCancelChip", "zh-TW", { previous: ask3.pending?.previous ?? "" });
  const before3 = env3.sessionRef.current;
  const r3 = rpcLog.length;
  await ANSWER({ ...env3.deps, trimmed: cancelChip, displayMessage: cancelChip, session: env3.sessionRef.current, msgs: env3.msgs });
  const after3 = env3.sessionRef.current;
  expect("FLOW-cancel-keeps-selection", M.ps.isPlanningSelectionMode(after3) && after3.planningSelection.id === before3.planningSelection.id && selectedFromSelection(after3, SEL["台南"].picks) === 2 && rpcLog.length === r3 && env3.selectionSwitchResendRef.current === null && J(after3.tripDestination) === J(before3.tripDestination), `取消「${cancelChip}」：selection 與 2 個已選保留、不扣點、不重跑`);
  // 詢問後重新整理：pending 只在記憶體 → 回「好」不得換城市
  const env4 = await makeEnv(env3.sessionRef.current);
  await preparePersistHeadSync(env4);
  const okAns = await ANSWER({ ...env4.deps, trimmed: "好", displayMessage: "好", session: env4.sessionRef.current, msgs: [] });
  expect("FLOW-reload-no-residual-switch", okAns === "__FALLTHROUGH__" && M.ps.isPlanningSelectionMode(env4.sessionRef.current) && env4.selectionSwitchResendRef.current === null, `重新整理後回「好」：不換城市、不重跑（ANS=${J(okAns)}）`);
}

// ═════════════════════════ 4. place-detail 路徑 ═════════════════════════
P("\n══ 4. place-detail 路徑（G1 → G2 真實區塊）══");
{
  // #PL-FIX-T5：亞特蘭提斯（無法確認、非換城市措辭）→ 照常 place_detail、維持 selection、不寫入未驗證名稱
  for (const [text, want] of [["我想去京都玩兩天", "ask_switch"], ["我想去安平玩", "place_detail_stream"], ["我想去亞特蘭提斯玩", "place_detail_stream"]]) {
    await freshWorld();
    const { session, picks } = SEL["台南"];
    const focusPlace = picks[0];
    const pd = IMP.enterPlaceDetailChat ? IMP.enterPlaceDetailChat(session, focusPlace) : { ...session, placeDetailFocus: focusPlace };
    const env = await makeEnv(pd);
    await preparePersistHeadSync(env);
    const r = await runGeneral(env, text, { placeDetail: true });
    const fin = r.final;
    P(`  [real] place-detail「${text}」→ ${r.outcome}${r.pending ? `(${r.pending.destination})` : ""} selection=${M.ps.isPlanningSelectionMode(fin)} 已選=${selectedFromSelection(fin, picks)} trip=${J(labels(fin).trip)} travel=${J(labels(fin).travel)} Credits=${r.rpc.length} Places=${r.places} geocode=${r.geocodes.length}`);
    const leakedPd = text.includes("亞特蘭提斯") ? destFieldsWith(fin, "亞特蘭提斯") : [];
    const persistedPd = env.persisted.at(-1);
    const persistedLeak = text.includes("亞特蘭提斯") ? destFieldsWith(persistedPd, "亞特蘭提斯") : [];
    if (text.includes("亞特蘭提斯") && persistedPd) {
      const cand = persistedPd.travelContext?.destinationCandidate;
      INFO(`place-detail「${text}」persist 後 travelContext.destinationCandidate=${J(cand ?? null)} destinationInputNames=${J(persistedPd.travelContext?.destinationInputNames ?? null)} preferredArea=${J(persistedPd.preferredArea ?? null)}`);
      // 後續回合：離開地點詳情回到一般聊天（清 placeDetailFocus），下一句的 Geocoding 與寫入
      for (const next of ["有什麼好吃的", "我想去安平玩"]) {
        const left = { ...persistedPd, placeDetailFocus: undefined, placeFocusRecommendationScope: undefined, selectedPlaceFromMood: undefined, conversationMode: persistedPd.previousConversationMode ?? persistedPd.conversationMode };
        const envN = await makeEnv(left);
        await preparePersistHeadSync(envN);
        const g0n = googleReqs.length;
        const rn = await runGeneral(envN, next);
        const geoN = googleReqs.slice(g0n).filter((g) => g.kind === "geocode").map((g) => g.query);
        const finN = rn.final;
        P(`  [real] place-detail 亞特蘭提斯之後的下一句「${next}」（一般路徑）→ ${rn.outcome} geocode=${J(geoN)} selection=${M.ps.isPlanningSelectionMode(finN)} trip=${J(labels(finN).trip)} travel=${J(labels(finN).travel)} 目的地欄位含亞特蘭提斯=${J(destFieldsWith(finN, "亞特蘭提斯"))}`);
        expect(`PD-followup-${next}-geocode-at-most-1`, geoN.length <= 1 && !geoN.some((q) => q.includes("亞特蘭提斯")), `place-detail 寫入的未驗證候選不在下一句再被 Geocoding（下一句「${next}」geocode=${J(geoN)}）`);
      }
    }
    expect(`PD-${text}`, r.outcome === want && M.ps.isPlanningSelectionMode(fin) && selectedFromSelection(fin, picks) === 2 && J(fin.tripDestination) === J(session.tripDestination) && J(fin.location) === J(session.location) && r.rpc.length === 0 && r.places === 0 && r.geocodes.length <= 1 && leakedPd.length === 0 && persistedLeak.length === 0, `place-detail：${want}、selection／已選／tripDestination／location 保留、Credits=${r.rpc.length} Places=${r.places} geocode=${r.geocodes.length}${text.includes("亞特蘭提斯") ? `、streamChat／persist 的目的地欄位含亞特蘭提斯=${J([...leakedPd, ...persistedLeak])}` : ""}`);
  }
}

// ═════════════════════════ 5. 審查 (a)：非地名句誤判 ═════════════════════════
P("\n══ 5. (a) planningSelectionTurnNamesPlace 對非地名句的誤判（台北 selection；冷模組）══");
const NONPLACE_CORPUS = [
  "我想吃拉麵", "有什麼推薦的", "有什麼好吃的", "附近有什麼好吃的", "幫我排行程", "我想去看海", "想喝咖啡", "有適合下雨天的地方嗎",
  "想吃在地小吃", "推薦夜景", "好", "謝謝", "兩天一夜", "預算一萬", "我們有小孩", "想去博物館", "想去夜市", "適合拍照的地方",
  "我想泡溫泉", "想找咖啡廳", "晚餐吃什麼", "有沒有親子景點", "想去老街", "我想泡湯", "早餐推薦", "想放鬆一下", "有什麼必去的",
  "改成三天", "12月出發", "我想吃火鍋", "想看展覽", "我想去逛街", "想找安靜的地方", "有便宜的住宿嗎", "想去吃甜點", "下午想散步",
  "可以再便宜一點嗎", "我不吃辣", "有素食嗎", "想去公園", "想吃早午餐", "想去書店", "有什麼室內景點", "想去看夕陽", "想吃燒肉",
  "有沒有夜店", "想去寺廟", "我想去吃牛肉麵", "想找酒吧", "第一天想輕鬆一點",
];
const PLACEY = ["北投泡湯", "我想去北投泡湯"];
// send() 在 G1 之前、只依句子（不依 pending 狀態）判斷的早退：與 _app.chat.tsx 同一組真實判斷。
// 需要 pending／失敗狀態的分支（date_confirmation、geographic、destinationUpdate、pendingNearbyLocation、重新生成）在
// 「已選點、無 pending」的 selection session 中不成立。
function earlyExit(session, text) {
  const why = [];
  if (IMP.classifyDestinationSwitchTurn(text).state !== "NO_SWITCH") why.push("switch_turn");
  if (IMP.isRepeatedTripDateConfirmation(session, text)) why.push("repeated_date");
  if (IMP.rejectNumericSelection(session, text)) why.push("numeric_selection");
  if (/^(?:生成行程|生成完整行程|幫我生成)$/.test(text)) why.push("generate");
  if (IMP.isPlanningSelectionContinuation(text)) why.push("E2_continuation");
  if (text === IMP.REFRESH_DESTINATION_RECOMMENDATIONS_OPTION || /^(重新整理推薦|重新整理)$/.test(text)) why.push("refresh");
  return why;
}
{
  const tp = SEL["台北"].session;
  const reach = [...NONPLACE_CORPUS, ...PLACEY].map((t) => [t, earlyExit(tp, t)]).filter(([, w]) => w.length);
  INFO(`G1 之前會被既有分支攔下的句子：${J(reach)}`);
}
const fp = [];
for (const text of [...NONPLACE_CORPUS, ...PLACEY]) {
  const named = IMP.planningSelectionTurnNamesPlace(text);
  if (!named || earlyExit(SEL["台北"].session, text).length) continue;
  await freshWorld();
  const env = await makeEnv(SEL["台北"].session);
  await preparePersistHeadSync(env);
  const r = await runGeneral(env, text);
  fp.push({ text, outcome: r.outcome, geocode: r.geocodes.length, kept: M.ps.isPlanningSelectionMode(r.final), placey: PLACEY.includes(text) });
  P(`  [real] 「${text}」named=true → ${r.outcome} geocode=${r.geocodes.length}${r.geocodes.length ? J(r.geocodes) : ""} selection=${M.ps.isPlanningSelectionMode(r.final)}`);
}
const fpNon = fp.filter((x) => !x.placey);
const fpUnconfirmed = fpNon.filter((x) => x.outcome === "unconfirmed");
INFO(`非地名句 ${NONPLACE_CORPUS.length} 句：被判為帶地名 ${fpNon.length} 句（${(fpNon.length / NONPLACE_CORPUS.length * 100).toFixed(1)}%）＝${J(fpNon.map((x) => x.text))}；其中回「無法確認目的地」${fpUnconfirmed.length} 句（${(fpUnconfirmed.length / NONPLACE_CORPUS.length * 100).toFixed(1)}%）＝${J(fpUnconfirmed.map((x) => x.text))}；多打 geocode 合計 ${fpNon.reduce((a, x) => a + x.geocode, 0)} 次`);
INFO(`「北投泡湯」類（真地名）：${J(fp.filter((x) => x.placey).map((x) => `${x.text}→${x.outcome}`))}`);
expect("RISK-a-nonplace-not-unconfirmed", fpUnconfirmed.length === 0, `非地名句被回「目前無法確認目的地」且整回合停止（不推薦）=${fpUnconfirmed.length}/${NONPLACE_CORPUS.length}：${J(fpUnconfirmed.map((x) => x.text))}`, "risk");
// #PL-FIX-T5：這些句子的 Geocoding 是否為 selection 閘門「新增」？以同一句在非 selection（同城市、leavePlanningSelection）走一般路徑的次數對照。
const fpGeo = fpNon.filter((x) => x.geocode > 0);
for (const x of fpGeo) {
  await freshWorld();
  const plain = M.ps.leavePlanningSelection(SEL["台北"].session);
  const envP = await makeEnv(plain);
  await preparePersistHeadSync(envP);
  const r = await runGeneral(envP, x.text);
  x.baselineGeocode = r.geocodes.length;
  x.baselineQ = r.geocodes;
  x.baselineOutcome = r.outcome;
}
INFO(`非地名句 Geocoding（selection 冷 vs 非 selection 一般路徑冷）：${J(fpGeo.map((x) => `${x.text}:${x.geocode}/${x.baselineGeocode}(${x.baselineOutcome})`))}`);
expect("REQ5-nonplace-geocode-at-most-1", fpNon.every((x) => x.geocode <= 1), `selection 模式非地名句每句 Geocoding（冷）≤1：${J(fpNon.filter((x) => x.geocode).map((x) => `${x.text}:${x.geocode}`))}`);
expect("RISK-a-nonplace-no-extra-geocode-vs-nonselection", fpGeo.every((x) => x.geocode <= x.baselineGeocode), `selection 閘門相對非 selection 一般路徑多出的 Geocoding：${J(fpGeo.filter((x) => x.geocode > x.baselineGeocode).map((x) => `${x.text}:+${x.geocode - x.baselineGeocode}`))}`, "risk");
// 敏感度：真實 Google 對通用詞（博物館／老街）若回傳某城市的 POI，selection 模式會怎麼處理（mock 只在本段開啟）
{
  const poi = (pid, fa, lat, lng, comps) => ({ ...gres(pid, fa, lat, lng, ["museum", "point_of_interest", "establishment"], comps), geometry: { location: { lat, lng }, location_type: "ROOFTOP", viewport: { northeast: { lat: lat + 0.002, lng: lng + 0.002 }, southwest: { lat: lat - 0.002, lng: lng - 0.002 } } } });
  globalThis.__PLGG_GEO_EXTRA = {
    博物館: poi("museum-taichung", "台灣台中市北區館前路1號 國立自然科學博物館", 24.1572, 120.666, [comp("北區", AAL2), comp("台中市", AAL1), TW]),
    老街: poi("oldstreet-sanxia", "台灣新北市三峽區民權街 三峽老街", 24.9346, 121.3689, [comp("三峽區", AAL2), comp("新北市", AAL1), TW]),
  };
  for (const text of ["想去博物館", "想去老街"]) {
    await freshWorld();
    const env = await makeEnv(SEL["台北"].session);
    await preparePersistHeadSync(env);
    const r = await runGeneral(env, text);
    INFO(`敏感度（台北 selection；mock 讓「${text.slice(2)}」回傳他城 POI）「${text}」→ ${r.outcome}${r.pending ? `(${r.pending.destination})` : ""} gate.reason=${r.gateReason ?? null} geocode=${J(r.geocodes)} selection=${M.ps.isPlanningSelectionMode(r.final)}`);
    expect(`RISK-a-generic-word-poi-${text}`, r.outcome !== "ask_switch" && r.outcome !== "unconfirmed", `通用詞「${text}」若被 Google 解析成他城 POI，不應變成換城市詢問／停止（實際 ${r.outcome}${r.pending ? `：要改成規劃${r.pending.destination}嗎` : ""}）`, "risk");
  }
  delete globalThis.__PLGG_GEO_EXTRA;
}

// ═════════════════════════ 6. 審查 (b)：processAdviceTurn 分支 ═════════════════════════
P("\n══ 6. (b) processAdviceTurn 分支（G3 L" + lineOf(SRC.indexOf("const turn = processAdviceTurn(trimmed,nextSession,merged.context,undefined,locale);")) + "）在 keepPlanningSelectionDestination 之前 ══");
{
  const adviceRows = table.filter((r) => r.outcome === "advice_branch");
  INFO(`第 2 節所有句子中走 advice 分支的：${J(adviceRows.map((r) => `[${r.key}]${r.text}`))}`);
  const iAdvice = BLOCKS.G3.code.indexOf("const turn = processAdviceTurn(");
  const iKeep = BLOCKS.G3.code.indexOf("nextSession = keepPlanningSelectionDestination(");
  INFO(`G3 內 processAdviceTurn 分支 idx=${iAdvice} 在 keepPlanningSelectionDestination idx=${iKeep} 之前＝${iAdvice < iKeep}；advice 分支以未經 keep 的 nextSession 呼叫 completeAdviceTurn → persistPlanningAdviceTurn → persistSession（只有 dropStale）`);
  // 直接驗證：閘門判定 selection 內（focus 有值）且 mergeTravelContext 產生 pending global candidate 的句子
  const probes = [["京都", "我想去嵐山的竹林小徑走走"], ["台南", "安平樹屋附近有什麼"], ["新北", "九份老街的阿妹茶樓"], ["東京", "淺草寺附近有什麼好吃的"], ["台北", "北投溫泉博物館好玩嗎"]];
  const bRows = [];
  for (const [key, text] of probes) {
    await freshWorld();
    const env = await makeEnv(SEL[key].session);
    await preparePersistHeadSync(env);
    const r = await runGeneral(env, text);
    const adv = env.advice.at(-1);
    let persistedAdvice = null;
    if (adv) persistedAdvice = persistHeadSync(adv.turn?.session ?? adv.nextSession);
    const fin = persistedAdvice ?? r.final;
    const row = { key, text, outcome: r.outcome, kept: M.ps.isPlanningSelectionMode(fin), selected: selectedFromSelection(fin, SEL[key].picks), trip: labels(fin).trip, tripIsSel: J(fin?.tripDestination) === J(SEL[key].session.tripDestination) };
    bRows.push(row);
    P(`  [real+hook] [${key}]「${text}」→ ${r.outcome} focus=${J(r.focus ?? null)}${adv ? `；advice 寫入（persistSession 開頭處理後）selection=${row.kept} 已選=${row.selected} trip=${J(row.trip)} travel=${J(labels(fin).travel)} planning=${J(labels(fin).planning)}` : `；selection=${row.kept} trip=${J(row.trip)}`}`);
  }
  const adviceLost = bRows.filter((r) => r.outcome === "advice_branch" && (!r.kept || r.selected !== 2));
  const adviceTrip = bRows.filter((r) => r.outcome === "advice_branch" && r.kept && !r.tripIsSel);
  expect("RISK-b-advice-branch-keeps-selection", adviceLost.length === 0, `advice 分支丟失 selection／已選地點：${J(adviceLost.map((r) => r.text))}`, "risk");
  expect("RISK-b-advice-branch-keeps-trip-destination", adviceTrip.length === 0 && adviceRows.every((r) => r.tripIsSelection), `advice 分支保留 selection 但 tripDestination 被寫成句中地點（未經 keepPlanningSelectionDestination）：${J([...adviceTrip.map((r) => `${r.text}→${r.trip}`), ...adviceRows.filter((r) => !r.tripIsSelection).map((r) => `${r.text}→${r.l.trip}`)])}`, "risk");

  // ── #PL-FIX-T5 審查 (c)：advice 分支 contextPatch 寫入其他目的地時只靠 persistSession 的 dropStale ──
  const g3 = BLOCKS.G3.code;
  const iAdv = g3.indexOf("const adviceTurn = processAdviceTurn(");
  const iKeepPre = g3.lastIndexOf("nextSession = keepSelectionTurnDestination(nextSession);", iAdv);
  const iKeepPost = g3.indexOf("session: keepSelectionTurnDestination(adviceTurn.session)", iAdv);
  expect("S-advice-branch-keeps-before-and-after", iAdv > 0 && iKeepPre > 0 && iKeepPre < iAdv && iKeepPost > iAdv, `advice 分支（L${lineOf(BLOCKS.G3.s + iAdv)}）在 processAdviceTurn 前後都套 keepSelectionTurnDestination`);
  // 可達性：merge 後還原（L${lineOf(SRC.indexOf("    const selectionTurnBeforeContext = selectionTurnBefore.travelContext;\n"))}）把本回合新產生的候選／釐清換回回合前的值，
  //   所以 selection 回合只有「回合開始前 session 已帶 destinationClarification／未解析候選」才會進 advice 分支。
  const MD = await loadMod(`${WORK_ROOT}/src/lib/ai/destination-advice.ts`);
  const kyoto = SEL["京都"];
  const priorStates = {
    "clarification": { destinationClarification: "multiple_destinations" },
    "candidate-conflict(大阪)": { destinationCandidate: { raw: "大阪", status: "conflict" } },
    "candidate-pending(大阪)": { destinationCandidate: { raw: "大阪", status: "pending" } },
  };
  const cRows = [];
  for (const [stateName, patch] of Object.entries(priorStates)) {
    for (const text of ["兩天", "有什麼好吃的", "大阪", "我想去嵐山玩"]) {
      await freshWorld();
      const s0 = { ...kyoto.session, travelContext: { ...(kyoto.session.travelContext ?? { interests: [] }), ...patch } };
      const env = await makeEnv(s0);
      await preparePersistHeadSync(env);
      const r = await runGeneral(env, text);
      const adv = env.advice.at(-1);
      let persisted = null;
      let contextPatchDest = null;
      if (adv) {
        contextPatchDest = adv.turn?.advice?.contextPatch?.destination ?? null;
        // persistPlanningAdviceTurn 的寫入：applyAdviceResultToSession(turn.session, turn.advice) → persistSession（真實 PH）
        const t0 = env.toasts.length;
        persisted = env.deps.persistSession(MD.applyAdviceResultToSession(adv.turn.session, adv.turn.advice));
        persisted.__toasts = env.toasts.length - t0;
      }
      const fin = persisted ?? r.final;
      const row = { stateName, text, outcome: r.outcome, contextPatchDest, kept: M.ps.isPlanningSelectionMode(fin), tripIsSel: J(fin?.tripDestination) === J(kyoto.session.tripDestination), travel: labels(fin).travel, osaka: newDestFieldsWith(s0, fin, "大阪"), toast: persisted?.__toasts ?? 0, geocode: r.geocodes.length, rpc: r.rpc.length };
      cRows.push(row);
      P(`  [real] [京都 selection＋回合前 ${stateName}]「${text}」→ ${r.outcome}${r.pending ? `(${r.pending.destination})` : ""}${adv ? ` advice.contextPatch.destination=${J(contextPatchDest)} 寫入後 selection=${row.kept} trip 維持=${row.tripIsSel} travel=${J(row.travel)} 含大阪欄位=${J(row.osaka)} toast=${row.toast}` : ` selection=${row.kept} trip 維持=${row.tripIsSel} travel=${J(row.travel)} candidate=${J(fin?.travelContext?.destinationCandidate ?? null)} 新寫入含大阪欄位=${J(row.osaka)}`} geocode=${row.geocode}${r.geocodes.length ? J(r.geocodes) : ""} Credits=${row.rpc}`);
    }
  }
  const cBad = cRows.filter((r) => r.outcome === "advice_branch" && (!r.kept || !r.tripIsSel || r.osaka.length));
  expect("RISK-c-advice-branch-real-turns-keep-selection", cBad.length === 0, `selection 回合實際進入 advice 分支後（含 contextPatch）仍保留 selection、trip 與目的地欄位不含他城：不符=${J(cBad.map((r) => `${r.stateName}/${r.text}:kept=${r.kept},trip=${r.tripIsSel},大阪欄位=${r.osaka.join("|")},toast=${r.toast}`))}`, "risk");
  // 合成：contextPatch 直接帶他城／未驗證名稱時，persistSession 只靠 dropStale 的結果
  for (const [dest, expectKind] of [["大阪", "other_city"], ["亞特蘭提斯", "unverified"], ["嵐山", "sub_area"]]) {
    await freshWorld();
    const env = await makeEnv(kyoto.session);
    await preparePersistHeadSync(env);
    const t0 = env.toasts.length;
    const out = env.deps.persistSession(MD.applyAdviceResultToSession(kyoto.session, { reply: "x", contextPatch: { destination: dest } }));
    const shown = env.toasts.slice(t0).map((x) => x[1]);
    INFO(`合成 advice.contextPatch.destination=${dest}（${expectKind}）→ persistSession：selection=${M.ps.isPlanningSelectionMode(out)} 已選=${selectedFromSelection(out, kyoto.picks)} travel=${J(labels(out).travel)} trip=${J(labels(out).trip)} toast=${J(shown)}`);
    if (expectKind === "other_city") expect("RISK-c-synthetic-other-city-asks-first", M.ps.isPlanningSelectionMode(out), `contextPatch 寫入他城「大阪」時應先問換城市（不應直接清除 selection）；實際 selection=${M.ps.isPlanningSelectionMode(out)} toast=${J(shown)}`, "risk");
    if (expectKind === "unverified") expect("RISK-c-synthetic-unverified-not-written", !destFieldsWith(out, dest).length, `contextPatch 寫入未驗證「${dest}」時不應持久化該名稱；實際目的地欄位=${J(destFieldsWith(out, dest))}（selection=${M.ps.isPlanningSelectionMode(out)}）`, "risk");
  }
}

// ═════════════════════════ 6b. 審查 (a)：pending 地理釐清回答分支（parent_city_scope／destination_area）═════════════════════════
P("\n══ 6b. (a) pending 地理釐清回答分支（G3 L" + lineOf(SRC.indexOf('    if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {')) + "-L" + lineOf(SRC.indexOf("      // No re-ask of the same clarification: unresolved answers fall through.")) + "）在 selection 模式 ══");
{
  const kyoto = SEL["京都"];
  const pendings = {
    "parent_city_scope(大阪)": IMP.buildPendingParentScopeClarification({ confirmedParentCity: "大阪", rawGeographicLabel: "道頓堀橋", categoryIntent: "restaurant", originalUserText: "道頓堀橋有什麼好吃的" }),
    "parent_city_scope(京都)": IMP.buildPendingParentScopeClarification({ confirmedParentCity: "京都", rawGeographicLabel: "嵐山竹林", categoryIntent: "restaurant", originalUserText: "嵐山竹林有什麼好吃的" }),
    "destination_area(霍格華茲)": IMP.buildPendingGeographicClarification({ rawGeographicLabel: "霍格華茲", categoryIntent: "restaurant", originalUserText: "霍格華茲有什麼好吃的" }),
  };
  const aRows = [];
  for (const [pname, pending] of Object.entries(pendings)) {
    const answers = pname.startsWith("parent") ? ["好", "大阪", "京都"] : ["大阪", "嵐山", "亞特蘭提斯"];
    for (const ans of answers) {
      // send() 開頭把 pending 取出成 turnPendingGeographic（並寫回已消耗狀態）；G3 的 sessionForTurn 再把它放回 nextSession
      await freshWorld();
      const env2 = await makeEnv(kyoto.session);
      await preparePersistHeadSync(env2);
      env2.deps.turnPendingGeographic = pending;
      const r2 = await runGeneral(env2, ans);
      const push = env2.categoryPush?.at(-1);
      const persisted = env2.persisted.at(-1) ?? null;
      const fin = persisted ?? r2.final;
      const other = ["大阪", "亞特蘭提斯", "霍格華茲", "嵐山"].filter((n) => n !== "京都" && destFieldsWith(fin, n).length);
      const row = { pname, ans, outcome: r2.outcome, pending: r2.pending?.destination ?? null, pushed: Boolean(push), pushDest: push ? labels(push.session).travel : null, kept: M.ps.isPlanningSelectionMode(fin), tripIsSel: J(fin?.tripDestination) === J(kyoto.session.tripDestination), travel: labels(fin).travel, other, toasts: env2.toasts.map((x) => x[1]), rpcG: r2.rpc.length, geocode: r2.geocodes.length };
      aRows.push(row);
      P(`  [real] [京都 selection＋pending ${pname}] 回答「${ans}」→ ${row.outcome}${row.pending ? `(${row.pending})` : ""}；category 推薦呼叫=${row.pushed}${row.pushed ? `（session.travel=${J(row.pushDest)}）` : ""}；最後 persist：selection=${row.kept} trip 維持=${row.tripIsSel} travel=${J(row.travel)} 他城／未驗證欄位=${J(row.other)} toast=${J(row.toasts)} geocode=${row.geocode}`);
    }
  }
  // 可達性：selection 回合中，哪些句子會「通過 G1（照常走）」且之後的 category 流程會問「要以 大阪 為範圍嗎？」（產生 parent_city_scope(他城) pending）
  {
    const probes = ["道頓堀橋有什麼好吃的", "道頓堀有什麼好吃的", "梅田藍天大廈附近有什麼好吃的", "心齋橋筋商店街有什麼好吃的", "新世界通天閣有什麼好吃的", "嵐山竹林有什麼好吃的", "大阪的道頓堀橋有什麼好吃的", "大阪道頓堀橋附近有什麼好吃的"];
    const reach = [];
    for (const text of probes) {
      await freshWorld();
      const env = await makeEnv(kyoto.session);
      await preparePersistHeadSync(env);
      const r = await runGeneral(env, text);
      let plan = null;
      if (r.outcome === "proceed" && r.ret?.merged) {
        try {
          const ctx = IMP.mergeContextForPlaceFetch ? IMP.mergeContextForPlaceFetch(r.ret.merged.context, r.final) : r.ret.merged.context;
          const res0 = IMP.resolveCategoryTurnDestination({ ctx, session: r.ret.merged.session, userText: text, locale: "zh-TW" });
          const res = await IMP.validateCategoryTurnDestination(res0, { locale: "zh-TW", geocodeFn: async (a) => M.lf.geocodeTripLocationFromText(a) });
          plan = IMP.planCategoryTurnClarification(res);
        } catch (e) {
          plan = { error: String(e?.message ?? e).slice(0, 60) };
        }
      }
      const written = IMP.planningSelectionTurnWrittenDestination(kyoto.session, IMP.mergeTravelContext(IMP.applyTripIntentToSession(text, kyoto.session), text).session) ?? null;
      reach.push({ text, outcome: r.outcome, plan, written, gateReason: r.gateReason ?? null, final: r.final });
      P(`  [real] 可達性 [京都 selection]「${text}」本回合寫入名稱=${J(written)} → G1/G3 ${r.outcome}${r.pending ? `(${r.pending.destination})` : ""} gate.reason=${r.gateReason ?? null} geocode=${J(r.geocodes)} trip=${J(labels(r.final).trip)} travel=${J(labels(r.final).travel)} focus=${J(r.focus ?? null)}；之後 category 釐清計畫=${J(plan)}`);
    }
    // 同一批句子，但 mock 讓 Google 能解析這些大阪地名（貼近真實）：G1 是否先問？之後 category 流程的搜尋目的地是什麼？
    globalThis.__PLGG_GEO_EXTRA = {
      道頓堀橋: gres("dotonboribashi", "日本大阪府大阪市中央區道頓堀", 34.6687, 135.5013, NB, [comp("道頓堀", NB), comp("中央區", SUB1), comp("大阪市", LOC), comp("大阪府", AAL1), JP]),
      道頓堀: gres("dotonbori", "日本大阪府大阪市中央區道頓堀", 34.6687, 135.5013, NB, [comp("道頓堀", NB), comp("中央區", SUB1), comp("大阪市", LOC), comp("大阪府", AAL1), JP]),
      通天閣: gres("tsutenkaku", "日本大阪府大阪市浪速區惠美須東", 34.6525, 135.5063, NB, [comp("惠美須東", NB), comp("浪速區", SUB1), comp("大阪市", LOC), comp("大阪府", AAL1), JP]),
    };
    for (const text of ["道頓堀有什麼好吃的", "道頓堀橋有什麼好吃的", "新世界通天閣有什麼好吃的", "大阪的道頓堀橋有什麼好吃的"]) {
      await freshWorld();
      const env = await makeEnv(kyoto.session);
      await preparePersistHeadSync(env);
      const g0 = googleReqs.length;
      const r = await runGeneral(env, text);
      let chain = null;
      if (r.outcome === "proceed" && r.ret?.merged) {
        try {
          const ctx = IMP.mergeContextForPlaceFetch(r.ret.merged.context, r.final);
          const geocodeFn = async (a) => M.lf.geocodeTripLocationFromText(a);
          const res = await IMP.validateCategoryTurnDestination(IMP.resolveCategoryTurnDestination({ ctx, session: r.ret.merged.session, userText: text, locale: "zh-TW" }), { locale: "zh-TW", geocodeFn });
          const plan = IMP.planCategoryTurnClarification(res);
          let scope = null;
          if (!plan && res.destination) {
            const s = await IMP.resolveTrustedRecommendationSearchScope({ label: res.destination, ctx, session: r.ret.merged.session, locale: "zh-TW", geocodeFn });
            scope = s.status === "trusted" ? `trusted/${s.destination}` : `unavailable/${s.reason}`;
          }
          chain = { destination: res.destination ?? null, plan, scope };
        } catch (e) {
          chain = { error: String(e?.message ?? e).slice(0, 80) };
        }
      }
      const geos = googleReqs.slice(g0).filter((g) => g.kind === "geocode").map((g) => g.query);
      P(`  [real] Google 可解析大阪地名時 [京都 selection]「${text}」→ G1/G3 ${r.outcome}${r.pending ? `(${r.pending.destination})` : ""} gate.reason=${r.gateReason ?? null}；category 流程（真實 helper 依 pushDestinationCategoryPlaceRecommendation 順序）=${J(chain)}；Geocoding 合計=${J(geos)}`);
      const searchesOther = chain?.scope && /^trusted\//.test(chain.scope) && !/京都/.test(chain.scope);
      if (text.startsWith("大阪")) INFO(`「${text}」在 Google 可解析道頓堀時：G1=${r.outcome}${r.pending ? `(${r.pending.destination})` : ""} gate.reason=${r.gateReason ?? null}（對照 RISK-f 的 mock：查詢「大阪道頓堀」只得到大阪市層級結果）`);
      expect(`RISK-e-category-flow-other-city-${text}`, r.outcome === "ask_switch" || !searchesOther, `G1 未攔下時，之後 category 流程不得以可信他城為搜尋範圍（未先問就扣點搜尋）：G1=${r.outcome}、category=${J(chain)}`, "risk");
    }
    delete globalThis.__PLGG_GEO_EXTRA;
    // 句中明確出現已知他城（大阪）但本回合寫入名稱不可信 → 照常走並維持京都（使用者問大阪、得到京都的推薦，未詢問）
    // #PL-FIX-T7 裁定 6：移除「他城地標先問」——「大阪＋細地名」句照常走、維持京都，且「大阪」不留在回合 session。
    const namedOsaka = reach.filter((x) => x.text.startsWith("大阪"));
    const namedOsakaBad = namedOsaka.filter((x) => x.outcome !== "proceed" || !M.ps.isPlanningSelectionMode(x.final) || J(x.final?.tripDestination) !== J(kyoto.session.tripDestination) || r2FieldsWith(x.final, "大阪").length);
    expect("RISK-f-known-other-city-landmark-proceeds-keeps-selection", namedOsaka.length > 0 && namedOsakaBad.length === 0, `裁定 6：句中帶已知他城「大阪」＋細地名 → 照常走、維持京都、大阪不留在 session：不符=${J(namedOsakaBad.map((x) => `${x.text}→${x.outcome}（寫入=${x.written}，gate=${x.gateReason}，大阪欄位=${J(r2FieldsWith(x.final, "大阪"))}）`))}`, "risk");
    const reachOther = reach.filter((x) => x.plan?.kind === "parent_city_scope" && x.plan.confirmedParentCity !== "京都");
    INFO(`可達：通過 G1 後 category 流程會建立 parent_city_scope(他城) pending 的句子=${J(reachOther.map((x) => `${x.text}→${x.plan.confirmedParentCity}`))}（mock Geocoding：這些細地名查無結果＝閘門 destination_unverified；真實 Google 若能解析則 G1 先問換城市）`);
  }
  const aOther = aRows.filter((r) => r.pushed && (!r.kept || r.other.includes("大阪")));
  const aUnverified = aRows.filter((r) => r.pushed && (r.other.includes("亞特蘭提斯") || r.other.includes("霍格華茲")));
  expect("RISK-a-pending-answer-other-city-asks-first", aOther.length === 0, `pending 回答把目的地寫成他城／離開 selection 且未先問換城市：${J(aOther.map((r) => `${r.pname}/${r.ans}→selection=${r.kept},欄位=${r.other.join("|")},toast=${r.toasts.join("|")}`))}`, "risk");
  expect("RISK-a-pending-answer-no-unverified-write", aUnverified.length === 0, `pending 回答把未驗證名稱寫入 selection 回合的目的地欄位：${J(aUnverified.map((r) => `${r.pname}/${r.ans}→${r.other.join("|")}（travel=${r.travel}）`))}`, "risk");
}

// ═════════════════════════ 6c. 審查 (b)：單字片段缺口 ═════════════════════════
P("\n══ 6c. (b) 只拆出單字片段（planningSelectionTurnNamesPlace=false）但 merge 寫出他城名稱 ══");
{
  const CORPUS = [
    ["京都", "我也想去大阪"], ["京都", "我在大阪"], ["京都", "我去大阪"], ["京都", "我要去大阪"], ["京都", "我們去大阪"], ["京都", "我想在大阪吃拉麵"],
    ["京都", "我想吃大阪的拉麵"], ["京都", "我到大阪了"], ["京都", "我人在大阪"], ["京都", "我住大阪"], ["京都", "我想看大阪城"], ["京都", "大阪呢"],
    ["台北", "我去台中"], ["台北", "我在台中"], ["台北", "我也想去花蓮"], ["台北", "我想吃台南小吃"], ["台北", "我要去台南玩"], ["台北", "台中好玩嗎"],
    ["新北", "我想去台北"], ["東京", "我想去大阪吃章魚燒"], ["京都", "我想吃拉麵"], ["台南", "我想吃牛肉湯"],
  ];
  const otherCities = ["大阪", "台中", "花蓮", "台南", "台北", "京都", "東京", "新北"];
  const gap = [];
  let named0 = 0;
  for (const [key, text] of CORPUS) {
    const session = SEL[key].session;
    const named = IMP.planningSelectionTurnNamesPlace(text);
    const sw = IMP.classifyDestinationSwitchTurn(text).state;
    let written;
    try {
      written = IMP.planningSelectionTurnWrittenDestination(session, IMP.mergeTravelContext(IMP.applyTripIntentToSession(text, session), text).session) ?? null;
    } catch (e) {
      written = `error:${String(e?.message ?? e).slice(0, 40)}`;
    }
    const writtenOther = written && otherCities.some((c) => c !== key && String(written).includes(c));
    let outcome = "-";
    let fin = null;
    if (sw === "NO_SWITCH") {
      await freshWorld();
      const env = await makeEnv(session);
      await preparePersistHeadSync(env);
      const r = await runGeneral(env, text);
      outcome = `${r.outcome}${r.pending ? `(${r.pending.destination})` : ""}`;
      fin = r.final;
    } else outcome = `A2-switch(${sw})`;
    if (!named) named0 += 1;
    const silent = !named && writtenOther && sw === "NO_SWITCH" && outcome === "proceed";
    if (silent) gap.push(`[${key}]${text}→寫入「${written}」→ ${outcome}，trip=${labels(fin).trip} travel=${labels(fin).travel}`);
    P(`  [real] [${key}]「${text}」named=${named} switch=${sw} 本回合寫入名稱=${J(written)} → ${outcome}${fin ? ` selection=${M.ps.isPlanningSelectionMode(fin)} trip=${J(labels(fin).trip)} travel=${J(labels(fin).travel)} planning=${J(labels(fin).planning)}` : ""}`);
  }
  INFO(`語料 ${CORPUS.length} 句：named=false ${named0} 句；其中「寫入他城名稱但不進閘門、被換回 selection 目的地且未詢問」${gap.length} 句（${((gap.length / CORPUS.length) * 100).toFixed(1)}%）`);
  expect("RISK-b-single-char-fragment-gap", gap.length === 0, `只拆出單字片段（不進閘門）但本回合會寫出他城名稱、結果被靜默換回 selection（不詢問換城市）：${J(gap)}`, "risk");
}

// ═════════════════════════ 7. 需求 2＋審查 (d)：persistSession 的「已離開…的選點」提示 ═════════════════════════
P("\n══ 7. 需求 2／(d) persistSession 開頭（真實 PH 區塊）的過期清除提示 ══");
{
  await freshWorld();
  const tn = SEL["台南"].session;
  const kyoto = (s) => ({ ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: "京都" } });
  for (const locale of ["zh-TW", "en", "ja", "ko"]) {
    await freshWorld();
    const env = await makeEnv(tn, { locale });
    await preparePersistHeadSync(env);
    const t0 = env.toasts.length;
    const a = env.deps.persistSession(kyoto(tn));
    const b = env.deps.persistSession(kyoto(a));
    const shown = env.toasts.slice(t0);
    const copy = M.crc.chatRuntimeCopy("planningSelectionLeftNotice", locale, { previous: "台南" });
    expect(`REQ2-toast-once-${locale}`, !M.ps.isPlanningSelectionMode(a) && shown.length === 1 && shown[0][0] === "message" && shown[0][1] === copy && copy.includes("台南") && !/\{previous\}/.test(copy), `本機證明他城（travelContext＝京都）：清除 selection、提示 1 次 ${J(shown.map((x) => x[1]))}（連續第 2 次 persist 不再提示）`);
  }
  {
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    const out1 = env.deps.persistSession({ ...tn, travelContext: { ...(tn.travelContext ?? { interests: [] }), destination: "淡水" } });
    const out2 = env.deps.persistSession({ ...tn, tripDestination: { ...tn.tripDestination, city: "七股", displayLabel: "七股", formattedName: "七股", placeId: "" } });
    expect("REQ2-unprovable-kept-no-toast", M.ps.isPlanningSelectionMode(out1) && M.ps.isPlanningSelectionMode(out2) && env.toasts.length === 0, `無法證明（淡水／七股）：selection 保留、不提示（toast=${env.toasts.length}）`);
  }
  // (d) 模組層紀錄殘留：dropStalePlanningSelection 在 persistSession 之外被呼叫（G2 L${lineOf(SRC.indexOf("nextSession = dropStalePlanningSelection(merged.session);"))}、G3 L${lineOf(SRC.indexOf("nextSession = dropStalePlanningSelection(nextSession);"))}）
  //     之後若該回合沒有 persist 就 return（例如 alternative 推薦 safe stop L${lineOf(SRC.indexOf('console.warn("[CHAT_ALTERNATIVE_SAFE_STOP]"'))}），紀錄留在模組；
  //     下一次 persistSession（例如使用者明確確認換城市 leavePlanningSelection）會把它當成本次的過期清除而顯示提示。
  {
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    M.ps.dropStalePlanningSelection(kyoto(tn)); // 一般路徑 L11157 的清除（之後未 persist 就 return）
    const t0 = env.toasts.length;
    env.deps.persistSession(M.ps.leavePlanningSelection(tn, { destination: "京都", center: { lat: 35.0116, lng: 135.7681 } }));
    const wrong = env.toasts.slice(t0);
    expect("RISK-d-stale-record-leaks-into-explicit-leave", wrong.length === 0, `殘留的模組層紀錄讓「明確確認換城市」也顯示「已離開…的選點」：${J(wrong.map((x) => x[1]))}（觸發前提：G2／G3 清除後該回合未 persist 即 return）`, "risk");
    // 多 selection：殘留紀錄屬於 A，之後在 B 上 persist → 不提示
    await freshWorld();
    const envB = await makeEnv(SEL["京都"].session);
    await preparePersistHeadSync(envB);
    M.ps.dropStalePlanningSelection(kyoto(tn));
    envB.deps.persistSession(M.ps.leavePlanningSelection(SEL["京都"].session));
    expect("D-multi-selection-id-bound", envB.toasts.length === 0, `殘留紀錄屬於另一個 selection（台南）時，在京都 selection 上 persist 不提示（toast=${envB.toasts.length}）`);
    // 重新整理：模組重新載入 → 紀錄消失（只在記憶體）
    await freshWorld();
    const envR = await makeEnv(tn);
    await preparePersistHeadSync(envR);
    envR.deps.persistSession(M.ps.leavePlanningSelection(tn, { destination: "京都", center: { lat: 35.0116, lng: 135.7681 } }));
    expect("D-reload-clears-record", envR.toasts.length === 0, `重新整理（模組重新載入）後紀錄不殘留（toast=${envR.toasts.length}）`);
  }
  // #PL-FIX-T5 裁定 3：toast 紀錄不跨回合殘留。send() 回合開始呼叫 consumeStalePlanningSelectionDrop()（L${lineOf(SRC.indexOf("    consumeStalePlanningSelectionDrop();\n"))}）。
  {
    const sendS = SRC.indexOf("  const send = async (");
    const iConsume = SRC.indexOf("    consumeStalePlanningSelectionDrop();\n", sendS);
    const iLock = SRC.indexOf("    if (isChatGenerationLocked()) return;\n", sendS);
    const iAuth = SRC.indexOf("      !requireAuthForAction(action, {", sendS);
    const iFirstPersistAfter = SRC.indexOf("persistSession(", iConsume);
    const persistBetween = SRC.slice(sendS, iConsume).match(/persistSession\(/g)?.length ?? 0;
    INFO(`send() 內：生成鎖 L${lineOf(iLock)} → 登入檢查 L${lineOf(iAuth)} → consume L${lineOf(iConsume)} → 換城市回答 L${BLOCKS.ANS.from}；send() 開頭到 consume 之間的 persistSession 呼叫=${persistBetween}`);
    expect("S-turn-start-consume-before-any-persist", iConsume > sendS && iConsume < BLOCKS.ANS.s && iConsume < BLOCKS.G1.s && persistBetween === 0 && iFirstPersistAfter > iConsume, `回合開始清除殘留紀錄：在換城市回答與 G1 之前，且 send() 中在它之前沒有 persistSession`);
    // 行為：前一回合 dropStale 後未 persist（殘留紀錄）→ 本回合開始 consume → 本回合 persist 一個非 selection 的 session（例如無目的地的 leavePlanningSelection）不得提示
    const tn = SEL["台南"].session;
    const kyoto = (s) => ({ ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: "京都" } });
    for (const [label, consumeAtTurnStart] of [["有回合開始 consume（現行）", true], ["對照：無 consume", false]]) {
      await freshWorld();
      const env = await makeEnv(tn);
      await preparePersistHeadSync(env);
      M.ps.dropStalePlanningSelection(kyoto(tn)); // 前一回合：G2／G3 清除後未 persist 即 return
      if (consumeAtTurnStart) IMP.consumeStalePlanningSelectionDrop(); // 本回合開始（與 send() 同一個匯出）
      const t0 = env.toasts.length;
      env.deps.persistSession(M.ps.leavePlanningSelection(tn));
      const shown = env.toasts.slice(t0).map((x) => x[1]);
      INFO(`${label}：殘留紀錄 → 下一回合 persist（leavePlanningSelection 無目的地）toast=${J(shown)}`);
      if (consumeAtTurnStart) expect("REQ3-toast-record-not-cross-turn", shown.length === 0, `前一回合殘留的過期清除紀錄不在下一回合顯示「已離開…的選點」（toast=${J(shown)}）`);
    }
    // 同一回合內真的清除：仍提示 1 次（consume 不吃掉本回合自己的紀錄）
    await freshWorld();
    const env = await makeEnv(tn);
    await preparePersistHeadSync(env);
    IMP.consumeStalePlanningSelectionDrop();
    const out = env.deps.persistSession(kyoto(tn));
    expect("REQ3-toast-same-turn-still-once", !M.ps.isPlanningSelectionMode(out) && env.toasts.length === 1, `回合開始 consume 後，本回合 persist 本機證明他城：清除並提示 1 次（toast=${env.toasts.length}）`);
  }
  // 量化 (d) 前提：第 2 節所有句子中，G3 清除 selection（L11157）的次數
  const g3Dropped = table.filter((r) => r.outcome === "proceed" && !r.kept);
  INFO(`第 2 節走到 keep 段的句子中，被 G3 dropStale 清除 selection 的=${J(g3Dropped.map((r) => `[${r.key}]${r.text}`))}（0＝閘門已先攔下，(d) 的殘留前提在這些句子不成立）`);
}

// ═════════════════════════ 8. 靜態：生成鎖、順序、未改變的既有入口 ═════════════════════════
P("\n══ 8. 靜態 ══");
{
  const g1 = BLOCKS.G1.code;
  const iGate = g1.indexOf("await resolveTrustedRecommendationSearchScope(");
  const iAsk = g1.indexOf("setSelectionSwitchPending(");
  expect("S-g1-no-credits-no-places", !/beginPlaceRecommendationCredits|fetchPlanningSelectionRecommendations|searchNearbyPlaces|push[A-Z]\w*Recommendation/.test(g1) && iGate > 0 && iAsk > iGate, "G1 閘門區塊不含 Credits／Places／推薦呼叫；閘門在詢問之前");
  expect("S-g1-condition-selection-and-named-only", /!turnSwitchVerified &&\s*isPlanningSelectionMode\(session\) &&\s*planningSelectionTurnNamesPlace\(trimmed\)/.test(g1), "G1 只在 selection 模式且句子帶地名時進入（非 selection 的一般 A2 路徑不受影響）");
  const sendS = SRC.indexOf("  const send = async (");
  const lockIdx = SRC.indexOf("if (isChatGenerationLocked()) return;", sendS);
  expect("S-lock-before-g1", lockIdx > sendS && lockIdx < BLOCKS.G1.s, `send() 生成鎖 return（L${lineOf(lockIdx)}）在 G1（L${BLOCKS.G1.from}）之前`);
  const ansConfirm = BLOCKS.ANS.code;
  expect("S-ans-general-before-more-places", ansConfirm.indexOf('selectionSwitchAsked.entry === "general"') > 0 && ansConfirm.indexOf('selectionSwitchAsked.entry === "general"') < ansConfirm.indexOf("await pushMorePlaceRecommendations("), "確認分支：entry==='general' 先 return（重跑原句），E2 詢問的確認仍走既有 more_places");
  const userDup = SRC.indexOf("selectionSwitchResendRef.current = selectionSwitchAsked.originalUserText;");
  INFO(`重跑以 send(原句, { source: "user" }) 再走一次 send()：對話會再出現一則與原句相同的使用者訊息（L${lineOf(userDup)} → L${BLOCKS.RSE.from}）`);
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const acc = rows.filter((r) => r.cat === "acc");
const risk = rows.filter((r) => r.cat === "risk");
P(`\nmissing 識別字=${J([...missing])}`);
P(`[acc] PASS=${acc.filter((r) => r.ok).length}/${acc.length}${acc.some((r) => !r.ok) ? `（FAIL：${acc.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}；[risk] 問題存在（FAIL）=${risk.filter((r) => !r.ok).length}/${risk.length}${risk.some((r) => !r.ok) ? `（${risk.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}`);
P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
const bad = external > 0 || acc.some((r) => !r.ok);
P(`verify-planner-selection-general-gate: ${bad ? "FAIL" : "PASS"}`);
// REL-1：stdout 是 pipe 時，write 後立刻 process.exit 會截斷輸出（看不到摘要）；等寫完再結束。
process.stdout.write(`${out.join("\n")}\n`, () => process.exit(bad ? 1 : 0));
