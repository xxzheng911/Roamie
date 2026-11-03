#!/usr/bin/env node
/**
 * PL-PROBE — Planner 選擇入口（planning_selection）信任邊界探測（離線，現行程式，唯讀）。
 *
 * 目的：釐清「Planner 選擇入口」是否在 A2 信任閘門（可信 Destination＋可信 Search Scope）之外，
 *       仍以不可信／過期的目的地發出付費 Places 搜尋並預扣 Credits。
 *
 * 分節：
 *   S  [static] 入口盤點：_app.chat.tsx 內各 planning_selection 入口的目前行號、Credits／Places 呼叫順序，
 *      以及 Credits 前是否出現任何 A2 閘門函式；planningSelection 被清除的位置。
 *   R  [mirror+rt] 執行期：以「鏡像」重現 _app.chat.tsx 的兩個付費分支（React callback 本體無法離線合法執行），
 *      其餘全部用真實模組：classifyDestinationSwitchTurn、isPlanningSelectionMode／Continuation、
 *      beginPlaceRecommendationCredits／settleCreditsOperation（Supabase RPC mock 記錄）、
 *      fetchPlanningSelectionRecommendations（searchPlaces mock 記錄中心／半徑／query）、
 *      resolveTrustedRecommendationSearchScope／resolveMorePlacesTurnDestination（A2 閘門，Google mock 計數）。
 *
 * 標記：
 *   [base]  一般流程基準，必須 PASS。
 *   [vuln]  斷言寫成「修正後應成立」的條件：FAIL＝漏洞仍存在。#PL-FIX 後鏡像已同步（閘門在 Credits 之前、
 *           fetch 傳 trustedScope、他城先詢問），全部應 PASS。真實區塊執行見 verify-planner-selection-gate-realpath.mjs。
 *   PROBE／INFO  只陳述事實，不判定。
 * 外部網路全部攔截（fetch／http／https／net），任一次即整體 FAIL；只用 Mock Key；不寫任何檔案。
 * 執行：node scripts/verify-planner-selection-probe.mjs
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
for (const k of ["info", "log", "warn", "debug", "error"]) console[k] = () => {};

// ── 傳輸／框架 stub（虛擬模組，不寫檔；同 A2 acceptance）──
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
    export async function googleRestFetch(input, init, context) { return globalThis.__PLP_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return false; }`,
  "@/integrations/supabase/client": `
    const any = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : any()), apply: () => any() });
    export const supabase = new Proxy({}, { get(_t, p) {
      if (p === "rpc") return async (name, args) => globalThis.__PLP_RPC(name, args);
      if (p === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
      return any();
    } });
  `,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.plp-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "plp-transport-stubs",
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
const MODS = {
  ps: "lib/planning-selection.ts",
  ctd: "lib/ai/chat-turn-destination.ts",
  tpc: "lib/ai/trip-planning-context.ts",
  cs: "lib/chat-session.ts",
  cop: "lib/credits/operations.ts",
  cff: "lib/credits/feature-flag.ts",
  pth: "lib/plan-trip-handoff.ts",
  dr: "lib/ai/destination-resolution.ts",
};
const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
await runner.executeId("/@vite/env");
const M = {};
const loadErr = {};
for (const [k, p] of Object.entries(MODS)) {
  try {
    M[k] = await runner.executeFile(`${WORK_ROOT}/src/${p}`);
  } catch (e) {
    M[k] = null;
    loadErr[k] = String(e?.message ?? e).split("\n")[0];
  }
}

// ════ Mock Google（A2 閘門的 geocode 逐筆計數）════
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const gres = ({ pid, fa, lat, lng, types, comps }) => ({ address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE", viewport: { northeast: { lat: lat + 0.1, lng: lng + 0.1 }, southwest: { lat: lat - 0.1, lng: lng - 0.1 } } }, place_id: pid, types });
const JP = comp("日本", "JP", ["country", "political"]);
const TW = comp("台灣", "TW", ["country", "political"]);
const GEO = {
  // R6：新北 selection 的初始推薦需要閘門可信（Authority 認得名稱但中心需 provider 確認）
  新北: gres({ pid: "mock-pid-new-taipei", fa: "台灣新北市", lat: 25.0169, lng: 121.4628, types: ["administrative_area_level_1", "political"], comps: [comp("新北市", "新北市", ["administrative_area_level_1", "political"]), TW] }),
  京都: gres({ pid: "mock-pid-kyoto-city", fa: "日本京都府京都市", lat: 35.0116, lng: 135.7681, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP] }),
};
const googleReqs = [];
globalThis.__PLP_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const query = url.searchParams.get("address") ?? body?.input ?? body?.textQuery;
  googleReqs.push({ kind, query });
  if (kind === "geocode") {
    for (const [k, v] of Object.entries(GEO)) if (String(query ?? "").includes(k)) return Response.json({ status: "OK", results: [v] });
    return Response.json({ status: "ZERO_RESULTS", results: [] });
  }
  if (kind === "autocomplete") return Response.json({ suggestions: [] });
  return Response.json({});
};
// geocodeFn 依 A2 harness：真實 location.functions 的 geocodeLocation 會經過 googleRestFetch；
// 這裡只需要 A2 閘門能取得 envelope，故直接以 location.functions 載入（若失敗則以 null geocodeFn 標記）。
let geocodeFn = null;
try {
  const lf = await runner.executeFile(`${WORK_ROOT}/src/lib/location.functions.ts`);
  geocodeFn = async (args) => lf.geocodeTripLocationFromText(args);
} catch (e) {
  loadErr.lf = String(e?.message ?? e).split("\n")[0];
}

// ════ Mock searchPlaces（Places 付費呼叫；記錄中心／半徑／query）════
let placeCalls = [];
let placeSeq = 0;
const mockSearchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng, radius: data.radius, destinationName: data.destinationName, caller: data.placesCaller });
  const base = { lat: Number.isFinite(data.lat) ? data.lat : 0.5, lng: Number.isFinite(data.lng) ? data.lng : 0.5 };
  const places = [0, 1, 2].map((i) => {
    placeSeq += 1;
    return { id: `ChIJplp${placeSeq}`, name: `示意地點${placeSeq}`, address: `${data.destinationName ?? ""} 示意地址${placeSeq}`, formattedAddress: `${data.destinationName ?? ""} 示意地址${placeSeq}`, lat: base.lat + 0.001 * (i + 1), lng: base.lng + 0.001 * (i + 1), rating: 4.5, userRatingCount: 500, types: data.includedTypes?.length ? [data.includedTypes[0], "point_of_interest"] : ["tourist_attraction"], primaryType: data.includedTypes?.[0] ?? "tourist_attraction", businessStatus: "OPERATIONAL" };
  });
  return { places, error: null, rawCount: places.length };
};

// ════ Credits RPC 記錄 ════
let rpcLog = [];
let ledgerSeq = 0;
globalThis.__PLP_RPC = async (name, args) => {
  rpcLog.push({ name, args });
  if (name === "credits_check") return { data: { ok: true, usable_credits: 20 }, error: null };
  if (name === "credits_reserve") return { data: { ok: true, ledger_id: `mock-ledger-${++ledgerSeq}`, status: "reserved" }, error: null };
  if (name === "credits_commit") return { data: { ok: true, status: "committed" }, error: null };
  if (name === "credits_rollback") return { data: { ok: true, status: "rolled_back" }, error: null };
  return { data: null, error: null };
};

// ════ 輸出 ════
const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
const J = (v) => JSON.stringify(v);
function expect(id, cond, detail, cat) {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
}
const INFO = (s) => P(`  INFO ${s}`);
const PROBE = (s) => P(`  PROBE ${s}`);
const distKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// ═════════════════════════ S. 靜態入口盤點 ═════════════════════════
const CHAT_PATH = `${WORK_ROOT}/src/routes/_app.chat.tsx`;
const SRC = readFileSync(CHAT_PATH, "utf8");
const lineOf = (idx) => (idx < 0 ? -1 : SRC.slice(0, idx).split("\n").length);
const sha16 = createHash("sha256").update(readFileSync(CHAT_PATH)).digest("hex").slice(0, 16);
P("══ S0. _app.chat.tsx 版本 ══");
INFO(`sha256 前 16 碼=${sha16}（#PL-FIX 第 4 輪授權版本 ce9c70275a3767cb；${sha16 === "ce9c70275a3767cb" ? "一致" : "不一致，以下行號以目前檔案為準"}）`);

const A2_GATES = ["resolveTrustedRecommendationSearchScope", "resolveMorePlacesTurnDestination", "confirmedContextDestination", "isUnconfirmedSearchDestination", "validateCategoryTurnDestination", "resolveCategoryTurnDestination", "resolveTrustedContextTurnDestination", "recommendationSessionMatchesTrustedScope"];
function sliceBetween(startNeedle, endNeedle, from = 0) {
  const s = SRC.indexOf(startNeedle, from);
  if (s < 0) return { s: -1, e: -1, body: "" };
  const e = SRC.indexOf(endNeedle, s + startNeedle.length);
  return { s, e, body: SRC.slice(s, e < 0 ? undefined : e) };
}

P("\n══ S1. 入口盤點（目前行號；Credits 前是否有 A2 閘門）══");
// E1 初始推薦：runPlanFormHandoff 的 selection 分支
const e1 = sliceBetween("const runPlanFormHandoff = useCallback(", "const req = toRoamieRequest(\"chat\", bundle");
const e1Sel = e1.body.indexOf("if (isPlanningSelectionMode(syncedHandoff))");
const e1Cred = e1.body.indexOf("beginPlaceRecommendationCredits(");
const e1Fetch = e1.body.indexOf("fetchPlanningSelectionRecommendations(");
const e1Gates = A2_GATES.filter((g) => e1.body.slice(e1Sel, e1Cred).includes(g));
const e1FetchArgs = e1.body.slice(e1Fetch, e1.body.indexOf("});", e1Fetch));
INFO(`E1 初始推薦 runPlanFormHandoff L${lineOf(e1.s)}：selection 分支 L${lineOf(e1.s + e1Sel)}、Credits L${lineOf(e1.s + e1Cred)}、Places L${lineOf(e1.s + e1Fetch)}；觸發＝規劃頁「讓 Roamie 替我安排」→ 聊聊頁 hydrate 時 pendingHandoff && fromPlanForm（L${lineOf(SRC.indexOf("await runPlanFormHandoff(current);"))}）`);
expect("S1-E1-gate-before-credits", e1.s > 0 && e1Cred > e1Sel && e1Fetch > e1Cred && e1Gates.length > 0 && /trustedScope:/.test(e1FetchArgs), `selection 分支內、Credits 之前的 A2 閘門呼叫=${J(e1Gates)}；fetch 傳入 trustedScope=${/trustedScope:/.test(e1FetchArgs)}`, "vuln");

// E2 補充推薦（還有嗎／再推薦一些 chip）
const e2Start = SRC.indexOf("isPlanningSelectionContinuation(trimmed)");
const e2 = sliceBetween("isPlanningSelectionContinuation(trimmed)", "const legacyNearbyClarification =", e2Start - 5);
const e2Cred = e2.body.indexOf("beginPlaceRecommendationCredits(");
const e2Fetch = e2.body.indexOf("fetchPlanningSelectionRecommendations(");
const e2Gates = A2_GATES.filter((g) => e2.body.slice(0, e2Cred).includes(g));
const e2FetchArgs = e2.body.slice(e2Fetch, e2.body.indexOf("});", e2Fetch));
const switchBlockStart = SRC.indexOf("const turnSwitch = classifyDestinationSwitchTurn(trimmed);");
INFO(`E2 補充推薦 send() L${lineOf(e2.s)}：Credits L${lineOf(e2.s + e2Cred)}、Places L${lineOf(e2.s + e2Fetch)}；觸發＝selection 模式下文字含「還有嗎／再推薦／其他的／更多推薦／more」（含 chip「再推薦一些」L${lineOf(SRC.indexOf('chips.push("生成行程", "再推薦一些")'))}），且本回合 turnSwitch 未驗證（NO_SWITCH）`);
expect("S1-E2-gate-before-credits", e2.s > 0 && e2Fetch > e2Cred && e2Gates.length > 0 && /trustedScope:/.test(e2FetchArgs), `Credits 之前的 A2 閘門呼叫=${J(e2Gates)}（另有 L${lineOf(switchBlockStart)} classifyDestinationSwitchTurn）；fetch 傳入 trustedScope=${/trustedScope:/.test(e2FetchArgs)}`, "vuln");
const e2UsesLocalSession = /fetchPlanningSelectionRecommendations\(\{\s*session,/.test(e2.body);
INFO(`E2 傳入的 session＝send() 開頭 restorePendingPlanAiOwner(sessionRef.current, loadChatSession())（L${lineOf(SRC.indexOf("let session = restorePendingPlanAiOwner(sessionRef.current, loadChatSession());"))}）；直接傳入=${e2UsesLocalSession}`);

// E3 生成行程（文字／chip「生成行程」）
const e3s = SRC.indexOf("/^(?:生成行程|生成完整行程|幫我生成)$/.test(trimmed)");
INFO(`E3 生成行程 send() L${lineOf(e3s)} → preparePlanningSelectionForGenerate → handleGenerateItinerary（L${lineOf(SRC.indexOf("const handleGenerateItinerary = async ("))}）；另一入口：日期確認 continuation.entry==="selection"（L${lineOf(SRC.indexOf('continuation.entry === "selection"'))}）`);
const hg = sliceBetween("const handleGenerateItinerary = async (", "createResult = await createItineraryFromSession({");
const hgGeo = hg.body.indexOf("resolveDestinationAuthority(");
const hgGates = A2_GATES.filter((g) => hg.body.includes(g));
INFO(`E3 付費呼叫：resolveDestinationAuthority＋geocodeLocationFn（L${lineOf(hg.s + hgGeo)}，目的地＝tripDestination／travelContext.destination）→ 天氣 → 伺服器 generate（Itinerary Credits 由 server 預扣，OpenAI）→ Routes（背景）；A2 閘門呼叫=${J(hgGates)}`);

// E4 選取／取消選取地點（卡片「＋ 加入這地點」）
const e4s = SRC.indexOf("togglePlanningSelectionPlace(sessionRef.current, selectionItem)");
const e4Check = SRC.lastIndexOf("isPlanningSelectionPlaceInScope(sessionRef.current, selectionItem)", e4s);
INFO(`E4 選取地點 onAddToTrip L${lineOf(e4s)}：只寫 session（persistSession），無付費呼叫、無 Credits`);
expect("S1-E4-scope-check-before-toggle", e4s > 0 && e4Check > 0 && e4s - e4Check < 400, `加入前檢查卡片屬於本次 selection（isPlanningSelectionPlaceInScope L${lineOf(e4Check)}）`, "vuln");

// planningSelection 清除位置
const clears = [...SRC.matchAll(/planningSelection: undefined/g)].map((m) => lineOf(m.index));
const switchClear = SRC.indexOf("const switchedCandidate: ChatPlanningSession = {");
INFO(`planningSelection 被清除的位置=${J(clears.map((l) => `L${l}`))}（CONFIRMED_SWITCH 區塊 L${lineOf(switchClear)}）；destinationScope 建立後不再更新（lib 內只有 createPlanningSelectionSession 寫入）`);
expect("S1-base-confirmed-switch-clears-selection", clears.length >= 1 && clears.every((l) => l > lineOf(switchClear) && l < lineOf(switchClear) + 5), "CONFIRMED_SWITCH 驗證通過後會清掉舊 planningSelection（基準）", "base");
const dropSites = [...SRC.matchAll(/dropStalePlanningSelection\(/g)].map((m) => `L${lineOf(m.index)}`);
const leaveSites = [...SRC.matchAll(/leavePlanningSelection\(/g)].map((m) => `L${lineOf(m.index)}`);
INFO(`#PL-FIX-T3：dropStalePlanningSelection 呼叫=${J(dropSites)}（persistSession 開頭、place-detail、一般路徑 mergeTripPlanningContext 之後）；leavePlanningSelection 呼叫=${J(leaveSites)}`);
// persistSession 開頭的掛點：第一個敘述就是清除過期 selection，之後所有寫入（sessionRef／setSession／saveChatSession）只用清除後的 next。
{
  const ps = SRC.indexOf("  const persistSession = useCallback(\n");
  const pe = SRC.indexOf("\n    },\n    [", ps);
  const body = ps > 0 && pe > ps ? SRC.slice(ps, pe) : "";
  const arrow = body.indexOf(") => {\n");
  const firstStmt = body.slice(arrow + 7).split("\n").find((l) => l.trim() && !l.trim().startsWith("//"))?.trim();
  const nextInputUses = (body.match(/\bnextInput\b/g) ?? []).length;
  expect(
    "S1-persist-hook-drops-stale-first",
    firstStmt === "const next = dropStalePlanningSelection(nextInput);" && nextInputUses === 2,
    `persistSession（L${lineOf(ps)}-L${lineOf(pe)}）第一個敘述=${J(firstStmt)}；nextInput 只出現 ${nextInputUses} 次（參數＋清除，之後只用 next）`,
    "vuln",
  );
}

// ═════════════════════════ R. 執行期 ═════════════════════════
const fail = Object.keys(loadErr).filter((k) => k !== "pth" && k !== "lf");
if (fail.length) {
  P(`\n載入失敗：${J(loadErr)}`);
} else {
  if (loadErr.pth) INFO(`plan-trip-handoff 載入失敗（改用 createPlanningSelectionSession 直接建）：${loadErr.pth}`);
  if (loadErr.lf) INFO(`location.functions 載入失敗（A2 閘門 geocodeFn 不可用）：${loadErr.lf}`);
  M.cff.setCreditsFeatureEnabledOverride(true);
  const TAINAN = { placeId: "mock-pid-tainan", country: "台灣", city: "台南市", region: "台南市", lat: 22.9997, lng: 120.227, formattedName: "台灣・台南", displayLabel: "台南", address: "台灣台南市" };
  const TAINAN_CENTER = { lat: TAINAN.lat, lng: TAINAN.lng };
  const KYOTO_CENTER = { lat: 35.0116, lng: 135.7681 };

  function planFormSession() {
    const form = { destination: TAINAN, origin: null, days: 2, mood: "", styles: ["美食探索", "城市漫遊"], normalizedStyles: ["美食探索", "城市漫遊"], startDate: "2026-12-01", endDate: "2026-12-02", departureTime: "09:00", transport: "步行" };
    if (M.pth?.preparePlanTripSession) {
      try {
        return { s: M.pth.preparePlanTripSession(form, { location: { lat: TAINAN.lat, lng: TAINAN.lng, city: "台南" }, weather: null, time: new Date().toISOString(), preferences: {} }, undefined, { planAiMode: true, localeStyleOptions: form.styles }), via: "preparePlanTripSession" };
      } catch (e) {
        INFO(`preparePlanTripSession 失敗：${String(e?.message ?? e)}`);
      }
    }
    return {
      s: { ...M.cs.createEmptySession(), tripDestination: TAINAN, planAiMode: true, fromPlanForm: true, planningSelection: M.ps.createPlanningSelectionSession({ styles: form.styles, destination: { name: "台南", lat: TAINAN.lat, lng: TAINAN.lng, administrativeNames: ["台南市"] } }) },
      via: "createPlanningSelectionSession",
    };
  }

  // 真實的 isEquivalentSwitchDestination（自 _app.chat.tsx 取出，esbuild 去型別；依賴皆為真實模組）
  const eqSrc = SRC.slice(SRC.indexOf("function sameNormalizedSwitchDestination("), SRC.indexOf("\n/**\n * 7.1 checkPersisted"));
  const { transform } = await import("esbuild");
  const eqJs = (await transform(`((normalizeDestinationLabel, resolveCategoryTurnDestination) => {\n${eqSrc}\nreturn isEquivalentSwitchDestination;\n})`, { loader: "ts", target: "es2022" })).code;
  const isEquivalentSwitchDestination = (0, eval)(eqJs.trim().replace(/;$/, ""))(M.tpc.normalizeDestinationLabel, M.ctd.resolveCategoryTurnDestination);
  const NO_GEOCODE = async () => {
    throw new Error("no geocodeFn in probe");
  };

  /**
   * 鏡像 _app.chat.tsx E2（send() 補充推薦分支，#PL-FIX 後）：switch 分類 → 分支條件 → 本句目的地
   * （resolvePlanningSelectionTurnDestination）→ 與 selection 比對 → A2 閘門 → 不可信停止／他城詢問 →
   * Credits（metadata.destination）→ Places（trustedScope）→ settle。逐字對照見 verify-planner-selection-gate-realpath.mjs（真實區塊）。
   */
  async function mirrorContinuation(session, text) {
    const turnSwitch = M.tpc.classifyDestinationSwitchTurn(text);
    // switch 區塊：非 NO_SWITCH 且未驗證 → 停止；驗證通過則 planningSelection 被清除、略過本分支
    if (turnSwitch.state !== "NO_SWITCH") return { branch: `switch_block(${turnSwitch.state})`, turnSwitch };
    if (!(M.ps.isPlanningSelectionMode(session) && M.ps.isPlanningSelectionContinuation(text))) return { branch: "not_selection_branch", turnSwitch };
    const r0 = rpcLog.length;
    const p0 = placeCalls.length;
    const selectionLabel = M.ps.planningSelectionDestinationLabel(session);
    const ctx = session.travelContext ?? { interests: [] };
    const identities = [session.planningSelection?.trustedDestination, selectionLabel, ...(session.planningSelection?.destinationScope?.administrativeNames ?? [])];
    const matchesSelection = (label) => Boolean(label?.trim()) && identities.some((identity) => isEquivalentSwitchDestination({ label: identity, trusted: label, ctx, session, locale: "zh-TW" }));
    let scope;
    let same = false;
    try {
      const requested = await M.ctd.resolvePlanningSelectionTurnDestination({ ctx, session, userText: text, locale: "zh-TW", geocodeFn: geocodeFn ?? NO_GEOCODE, selectionLabel });
      same = matchesSelection(requested);
      scope = await M.ctd.resolveTrustedRecommendationSearchScope({ label: same ? selectionLabel : requested, ctx, session: M.ctd.stripClientSearchScope(session), locale: "zh-TW", geocodeFn: geocodeFn ?? NO_GEOCODE });
    } catch {
      scope = { status: "unavailable", reason: "authority_error" };
    }
    if (scope.status !== "trusted") return { branch: "selection_continuation", outcome: `gate_unavailable(${scope.reason})`, turnSwitch, rpc: rpcLog.slice(r0).map((r) => r.name), places: placeCalls.slice(p0) };
    if (!same && !matchesSelection(scope.destination)) return { branch: "selection_continuation", outcome: `ask_switch(${scope.destination})`, turnSwitch, rpc: rpcLog.slice(r0).map((r) => r.name), places: placeCalls.slice(p0) };
    const gate = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "planning_selection_continuation", destination: scope.destination } });
    if (gate.blocked) return { branch: "credits_blocked", turnSwitch };
    let delivered = false;
    let result;
    try {
      result = await M.ps.fetchPlanningSelectionRecommendations({ session, searchPlaces: mockSearchPlaces, locale: "zh-TW", trustedScope: scope });
      delivered = result.places.length > 0;
    } finally {
      await M.cop.settleCreditsOperation(gate.handle, delivered);
    }
    return { branch: "selection_continuation", outcome: "searched", turnSwitch, rpc: rpcLog.slice(r0).map((r) => r.name), reserve: rpcLog.slice(r0).find((r) => r.name === "credits_reserve")?.args, places: placeCalls.slice(p0), result };
  }
  /** 鏡像 E1（runPlanFormHandoff selection 分支，#PL-FIX 後）：A2 閘門 → Credits（metadata.destination）→ Places（trustedScope）。 */
  async function mirrorInitial(session) {
    const r0 = rpcLog.length;
    const p0 = placeCalls.length;
    if (!M.ps.isPlanningSelectionMode(session)) return { branch: "not_selection" };
    let scope;
    try {
      scope = await M.ctd.resolveTrustedRecommendationSearchScope({ label: M.ps.planningSelectionDestinationLabel(session), ctx: session.travelContext ?? { interests: [] }, session: M.ctd.stripClientSearchScope(session), locale: "zh-TW", geocodeFn: geocodeFn ?? NO_GEOCODE });
    } catch {
      scope = { status: "unavailable", reason: "authority_error" };
    }
    if (scope.status !== "trusted") return { branch: "selection_initial", outcome: `gate_unavailable(${scope.reason})`, rpc: [], places: [], result: { session, places: [] } };
    const gate = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "planning_selection_initial", destination: scope.destination } });
    let delivered = false;
    let result;
    try {
      result = await M.ps.fetchPlanningSelectionRecommendations({ session, searchPlaces: mockSearchPlaces, locale: "zh-TW", trustedScope: scope });
      delivered = result.places.length > 0;
    } finally {
      await M.cop.settleCreditsOperation(gate.handle, delivered);
    }
    return { branch: "selection_initial", outcome: "searched", rpc: rpcLog.slice(r0).map((r) => r.name), places: placeCalls.slice(p0), result };
  }
  const centers = (calls) => [...new Set(calls.map((c) => `${c.lat},${c.lng}`))];
  const gScope = async (label, session) => {
    if (!geocodeFn) return { status: "unavailable", reason: "no_geocodeFn_in_probe" };
    const g0 = googleReqs.length;
    const v = await M.ctd.resolveTrustedRecommendationSearchScope({ label, ctx: session.travelContext ?? { interests: [] }, session, locale: "zh-TW", geocodeFn });
    return { ...v, google: googleReqs.length - g0 };
  };
  const scopeStr = (v) => (v.status === "trusted" ? `trusted/${v.destination} center=(${v.center.lat},${v.center.lng}) src=${v.centerSource}` : `unavailable reason=${v.reason}`) + ` Google=${v.google ?? "-"}`;

  // ── R0 基準：Plan form 台南 → 初始推薦 ──
  P("\n══ R0. 基準：Plan form（台南）→ 初始推薦（E1 鏡像）══");
  const built = planFormSession();
  const s0 = built.s;
  INFO(`session 建立方式=${built.via}；destinationScope=${J(s0.planningSelection?.destinationScope)}`);
  const r0 = await mirrorInitial(s0);
  const tnScope = await gScope("台南", s0);
  P(`  [mirror+rt] 初始推薦：RPC=${J(r0.rpc)} Places 呼叫=${r0.places.length} centers=${J(centers(r0.places))} radius=${J([...new Set(r0.places.map((c) => c.radius))])} cards=${r0.result?.places.length}`);
  INFO(`A2 閘門對同一目的地：resolveTrustedRecommendationSearchScope("台南")=${scopeStr(tnScope)}`);
  expect("R0-base-initial-delivers", r0.places.length > 0 && J(r0.rpc) === J(["credits_check", "credits_reserve", "credits_commit"]), "正常 Plan form 目的地：Credits check→reserve→commit、Places 有結果（基準）", "base");
  const r0Meta = rpcLog.filter((r) => r.name === "credits_reserve").at(-1)?.args?.p_metadata;
  expect("R0-initial-metadata-destination", r0Meta?.destination === "台南", `初始推薦 Credits metadata 帶可信目的地：reserve.p_metadata=${J(r0Meta)}`, "vuln");
  const sAfter = { ...r0.result.session, pendingHandoff: false, planHandoffDone: true };

  // ── R1 使用者在台南選擇模式中說「京都還有其他的嗎」 ──
  P("\n══ R1. 台南 selection 模式中輸入「京都還有其他的嗎」（不含否定子句的換城市）══");
  for (const text of ["京都還有其他的嗎", "京都有更多推薦嗎", "那京都再推薦一些"]) {
    const m = await mirrorContinuation(sAfter, text);
    const a2More = geocodeFn ? await M.ctd.resolveMorePlacesTurnDestination({ ctx: sAfter.travelContext ?? { interests: [] }, session: sAfter, userText: text, locale: "zh-TW", geocodeFn }) : "(no geocodeFn)";
    P(`  [mirror+rt] 「${text}」：turnSwitch=${m.turnSwitch.state} branch=${m.branch} outcome=${m.outcome ?? "-"} RPC=${J(m.rpc ?? [])} Places=${m.places?.length ?? 0} centers=${J(centers(m.places ?? []))} queries=${J((m.places ?? []).map((c) => c.query))}`);
    INFO(`同一句話走非 selection 的 A2 more_places 判定 resolveMorePlacesTurnDestination → ${J(a2More ?? null)}`);
    if (m.branch === "selection_continuation") {
      const nearKyoto = (m.places ?? []).every((c) => distKm({ lat: c.lat, lng: c.lng }, KYOTO_CENTER) < 60);
      expect(`R1-${text}-no-old-city-charge`, (m.rpc ?? []).length === 0 || nearKyoto, `使用者指名京都：outcome=${m.outcome}，Credits=${J(m.rpc)}、搜尋 ${m.places.length} 次 ${J(centers(m.places))}（不得以舊目的地台南扣點搜尋；台南距京都 ${Math.round(distKm(TAINAN_CENTER, KYOTO_CENTER))} km）`, "vuln");
    } else {
      PROBE(`「${text}」未進入 selection 分支（branch=${m.branch}）`);
    }
  }

  // ── R2 舊 session 殘留：目的地已換成京都，但 planningSelection 仍是台南 ──
  // #PL-FIX-T2 指派者裁定：純續推句一律照 selection 自己的目的地（裁定 4），因此「R2 狀態下續推要搜京都」的舊斷言
  // 作廢；改為斷言 R2 狀態在源頭「不可達」——任何把目的地改成另一城市的路徑都必須清除／重建 planningSelection。
  // R2a 以 _app.chat.tsx send() 一般路徑的「真實程式區塊」（applyTripIntentToSession → mergeTravelContext →
  //     mergeTripPlanningContext → shouldStart／startNewPlanningSession，皆為真實模組）對 selection session 執行；
  //     任何一句讓 travelContext／tripPlanningContext／tripDestination 變成京都、但 planningSelection（台南）仍在 → FAIL（可達）。
  // R2b 保留：即使處於該狀態，也絕不以不可信目的地扣點（selection 標籤不可信時 Credits=[]、Places=0）。
  P("\n══ R2. 舊 session 殘留（travelContext／tripPlanningContext 已是京都，planningSelection 仍為台南）：源頭可達性 ══");
  const cutReal = (startNeedle, endNeedle) => {
    const s = SRC.indexOf(startNeedle);
    const e = s < 0 ? -1 : SRC.indexOf(endNeedle, s + startNeedle.length);
    if (s < 0 || e < 0) throw new Error(`R2：找不到真實區塊 ${J(startNeedle.slice(0, 50))}`);
    return { code: SRC.slice(s, e + endNeedle.length), from: lineOf(s), to: lineOf(e + endNeedle.length - 1) };
  };
  let r2Blocks = null;
  let runGeneral = null;
  try {
    r2Blocks = [
      cutReal("    let nextSession = explicitNearbyAuthority\n", "      : applyTripIntentToSession(trimmed, sessionForTurn);\n"),
      cutReal("    const merged =\n      structuredHomeNearbyTurn || explicitNearbyTurn\n", "    nextSession = merged.session;\n"),
      // #PL-FIX-T3：延伸到一般路徑清除過期 selection 的那一行（mergeTripPlanningContext 之後）
      cutReal("    const planningMerge =\n", "    nextSession = dropStalePlanningSelection(nextSession);\n"),
      cutReal("    const destCandidate = explicitNearbyTurn\n", "        nextSession = startNewPlanningSession(nextSession, \"destination_change\");\n      }\n    }\n"),
    ];
  } catch (e) {
    INFO(String(e?.message ?? e));
  }
  const R2M = {};
  if (r2Blocks) {
    INFO(`send() 一般路徑真實區塊：${r2Blocks.map((b) => `L${b.from}-L${b.to}`).join("、")}（之間的 pending 候選／C3／澄清分支不改寫這幾個欄位）`);
    for (const [k, p] of Object.entries({ tc: "lib/ai/travel-context.ts", ti: "lib/recommendation/trip-intent.ts", aps: "lib/ai/ai-planning-session.ts", ats: "lib/ai/ai-trip-style.ts", nsa: "lib/ai/numeric-selection-authority.ts" })) {
      R2M[k] = await runner.executeFile(`${WORK_ROOT}/src/${p}`);
    }
    const depNames = ["explicitNearbyAuthority", "sessionForTurn", "trimmed", "structuredHomeNearbyTurn", "explicitNearbyTurn", "lastAssistantReply", "applyTripIntentToSession", "mergeTravelContext", "mergeTripPlanningContext", "shouldStartNewPlanningSession", "startNewPlanningSession", "parseAskTripStyleSelection", "rejectNumericSelection", "dropStalePlanningSelection"];
    const DROP_LINE = "    nextSession = dropStalePlanningSelection(nextSession);\n";
    const blockCode = r2Blocks.map((b) => b.code).join("\n");
    if (blockCode.split(DROP_LINE).length !== 2) throw new Error("R2：一般路徑真實區塊內 dropStalePlanningSelection 行不是恰好 1 次");
    // __pre：清除前的 session（只供 R6 替代規則評估，不影響真實區塊的語意）
    const body = `let __pre;\n${blockCode.replace(DROP_LINE, `    __pre = nextSession;\n${DROP_LINE}`)}\nreturn { nextSession, merged, pre: __pre };`;
    const js = (await transform(`(async (__d) => {\n let { ${depNames.join(", ")} } = __d;\n${body}\n})`, { loader: "ts", target: "es2022" })).code;
    const runGeneralRaw = (0, eval)(js.trim().replace(/;$/, ""));
    runGeneral = (sessionForTurn, trimmed) =>
      runGeneralRaw({
        explicitNearbyAuthority: null, sessionForTurn, trimmed, structuredHomeNearbyTurn: false, explicitNearbyTurn: false, lastAssistantReply: undefined,
        applyTripIntentToSession: R2M.ti.applyTripIntentToSession, mergeTravelContext: R2M.tc.mergeTravelContext, mergeTripPlanningContext: M.tpc.mergeTripPlanningContext,
        shouldStartNewPlanningSession: R2M.aps.shouldStartNewPlanningSession, startNewPlanningSession: R2M.aps.startNewPlanningSession,
        parseAskTripStyleSelection: R2M.ats.parseAskTripStyleSelection, rejectNumericSelection: R2M.nsa.rejectNumericSelection,
        dropStalePlanningSelection: M.ps.dropStalePlanningSelection,
      });
    const label = (s) => ({
      travelContext: s.travelContext?.destination ?? null,
      tripPlanningContext: s.tripPlanningContext?.destination ?? null,
      tripDestination: s.tripDestination?.displayLabel ?? s.tripDestination?.city ?? null,
      selection: s.planningSelection?.destinationScope?.name ?? null,
    });
    const reached = [];
    for (const text of ["我想去京都玩兩天", "幫我規劃京都三天", "京都有什麼好玩的", "改去京都", "那京都呢"]) {
      const sw = M.tpc.classifyDestinationSwitchTurn(text).state;
      const cont = M.ps.isPlanningSelectionContinuation(text);
      if (sw !== "NO_SWITCH" || cont) {
        INFO(`「${text}」：turnSwitch=${sw} continuation=${cont}（不進一般路徑，略過）`);
        continue;
      }
      let res;
      try {
        res = await runGeneral(sAfter, text);
      } catch (e) {
        INFO(`「${text}」：一般路徑區塊執行失敗 ${String(e?.message ?? e).split("\n")[0]}`);
        continue;
      }
      const l = label(res.nextSession);
      const movedToKyoto = [l.travelContext, l.tripPlanningContext, l.tripDestination].some((v) => typeof v === "string" && v.includes("京都"));
      const selectionKept = M.ps.isPlanningSelectionMode(res.nextSession) && /台南/.test(l.selection ?? "");
      const pendingCandidate = res.merged.context.destinationCandidate?.status && res.merged.context.destinationCandidate.status !== "resolved";
      P(`  [real-block] 「${text}」：turnSwitch=${sw} continuation=${cont} → ${J(l)} planningSelection 保留=${selectionKept}${pendingCandidate ? ` destinationCandidate=${res.merged.context.destinationCandidate.status}` : ""}`);
      if (movedToKyoto && selectionKept) reached.push({ text, session: res.nextSession, l });
    }
    expect("R2a-stale-selection-state-unreachable", reached.length === 0, reached.length ? `可達：${J(reached.map((r) => r.text))} 經 send() 一般路徑後目的地欄位已是京都，planningSelection（台南）未清除（只有 CONFIRMED_SWITCH 區塊會清；applyCommonSessionShell／clearPlanningSessionState 皆以 ...session 保留 planningSelection）` : "一般路徑沒有任何句子能在保留 planningSelection 的同時把目的地改成另一城市", "vuln");
    // R2b：處於該狀態時，純續推句依裁定 4 用 selection 自己的目的地；但 selection 標籤不可信時絕不扣點
    const staleState = reached[0]?.session ?? { ...sAfter, travelContext: { ...(sAfter.travelContext ?? { interests: [] }), destination: "京都", destinationCity: "京都" }, tripPlanningContext: { ...(sAfter.tripPlanningContext ?? {}), destination: "京都" } };
    for (const text of ["再推薦一些", "還有嗎"]) {
      const m = await mirrorContinuation(staleState, text);
      P(`  [mirror+rt] R2 狀態「${text}」：branch=${m.branch} outcome=${m.outcome ?? "-"} RPC=${J(m.rpc ?? [])} Places=${m.places?.length ?? 0} centers=${J(centers(m.places ?? []))}`);
      INFO(`裁定 4：純續推句照 selection 目的地（台南）搜尋＝${(m.places ?? []).every((c) => distKm({ lat: c.lat, lng: c.lng }, TAINAN_CENTER) < 60)}（這是可達性問題的後果，不另列失敗）`);
    }
    const forgedStale = { ...staleState, planningSelection: { ...staleState.planningSelection, destinationScope: { name: "亞特蘭提斯市", lat: 10.5, lng: -40.25, radius: 50000, administrativeNames: [] }, trustedDestination: undefined }, tripDestination: { ...(staleState.tripDestination ?? TAINAN), city: "亞特蘭提斯市", displayLabel: "亞特蘭提斯市", formattedName: "亞特蘭提斯市", region: undefined } };
    const mu = await mirrorContinuation(forgedStale, "再推薦一些");
    expect("R2b-stale-state-never-charges-untrusted", (mu.rpc ?? []).length === 0 && (mu.places ?? []).length === 0, `R2 狀態＋selection 標籤不可信（亞特蘭提斯市）：outcome=${mu.outcome} Credits=${J(mu.rpc ?? [])} Places=${mu.places?.length ?? 0}（必須皆 0；context 的京都不得被拿來當替代目的地）`, "vuln");
  }

  // ── R2c persistSession 開頭的掛點：其他寫入路徑（more_places／category／workspace／trip-add-place 等，皆經 persistSession）──
  // 以 _app.chat.tsx persistSession 的「真實第一行」（esbuild 去型別，依賴＝真實 dropStalePlanningSelection）處理各路徑會寫入的
  // 目的地欄位形狀；這些路徑本身（React callback）無法離線執行，故輸入為「該路徑寫入後的 session」形狀（標 [hook]）。
  P("\n══ R2c. persistSession 開頭掛點：其他寫入路徑不得留下過期 selection ══");
  {
    const hookLine = "      const next = dropStalePlanningSelection(nextInput);\n";
    const n = SRC.split(hookLine).length - 1;
    const hookJs = (await transform(`((dropStalePlanningSelection) => (nextInput) => {\n${hookLine}return next;\n})`, { loader: "ts", target: "es2022" })).code;
    const persistHead = (0, eval)(hookJs.trim().replace(/;$/, ""))(M.ps.dropStalePlanningSelection);
    const sel2 = r0.result.places.slice(0, 2).reduce((s, p) => M.ps.togglePlanningSelectionPlace(s, p), sAfter);
    const selCount = (s) => (s.selectedPlaces ?? []).filter((p) => (M.ps.resolvePlanningSelectionPlaces(sel2) ?? []).some((q) => (q.googlePlaceId || q.id) === (p.googlePlaceId || p.id))).length;
    INFO(`掛點出現次數=${n}；selection 已選 ${selCount(sel2)} 個地點（${J(sel2.selectedPlaces.map((p) => p.name))}）；location=${J(sel2.location)} planAiMode=${sel2.planAiMode} fromPlanForm=${sel2.fromPlanForm}`);
    const KYOTO_TRIP = { placeId: "mock-pid-kyoto-city", country: "日本", city: "京都市", region: "京都府", lat: 35.0116, lng: 135.7681, formattedName: "日本・京都", displayLabel: "京都", address: "日本京都府京都市" };
    const cases = [
      ["more_places（travelContext.destination＝京都）", { ...sel2, travelContext: { ...(sel2.travelContext ?? { interests: [] }), destination: "京都" } }, true],
      ["category（tripPlanningContext.destination＝京都）", { ...sel2, tripPlanningContext: { ...(sel2.tripPlanningContext ?? { selectedPlaces: [] }), destination: "京都" } }, true],
      ["workspace／place-detail（tripDestination＝京都）", { ...sel2, tripDestination: KYOTO_TRIP }, true],
      ["對照：同城市（travelContext.destination＝台南市）", { ...sel2, travelContext: { ...(sel2.travelContext ?? { interests: [] }), destination: "台南市" } }, false],
      ["對照：未改目的地", sel2, false],
    ];
    for (const [name, input, shouldDrop] of cases) {
      const out = n === 1 ? persistHead(input) : input;
      const dropped = !M.ps.isPlanningSelectionMode(out);
      const left = selCount(out);
      const ok = shouldDrop
        ? dropped && left === 0 && out.planAiMode === false && out.fromPlanForm === false && out.location === undefined
        : !dropped && out === input;
      expect(`R2c-${name}`, n === 1 && ok, `${name}：selection ${dropped ? "已清除" : "保留"}、selection 已選地點剩 ${left}、planAiMode=${out.planAiMode} fromPlanForm=${out.fromPlanForm} location=${J(out.location ?? null)}（預期 ${shouldDrop ? "清除＋已選地點 0＋Plan form location 清除" : "原物件保留"}）`, "vuln");
    }
    // 需求 4：確認換城市（leavePlanningSelection 帶閘門結果）→ location／tripDestination＝新目的地，不偽造 placeId
    const confirmSite = SRC.indexOf("leavePlanningSelection(liveSession, {");
    const conf = M.ps.leavePlanningSelection(sel2, { destination: "京都", center: KYOTO_CENTER });
    expect(
      "R2c-confirm-switch-location-new-destination",
      confirmSite > 0 && !M.ps.isPlanningSelectionMode(conf) && conf.location?.city === "京都" && conf.location.lat === KYOTO_CENTER.lat && conf.tripDestination?.placeId === "" && conf.planAiMode === false && conf.fromPlanForm === false && selCount(conf) === 0,
      `確認換城市（L${lineOf(confirmSite)}）：location=${J(conf.location)} tripDestination.placeId=${J(conf.tripDestination?.placeId)} planAiMode=${conf.planAiMode} fromPlanForm=${conf.fromPlanForm} selection 已選地點剩 ${selCount(conf)}`,
      "vuln",
    );
  }

  // ── R3 不可信 destinationScope（被改過的 localStorage／舊版資料）──
  P("\n══ R3. 不可信 destinationScope（Authority／Provider 皆無法確認的名稱＋任意座標）══");
  const forgedSel = { ...sAfter.planningSelection, destinationScope: { name: "亞特蘭提斯市", lat: 10.5, lng: -40.25, radius: 50000 } };
  const forged = { ...sAfter, planningSelection: forgedSel, travelContext: { interests: [] }, tripPlanningContext: undefined };
  const fScope = await gScope("亞特蘭提斯市", forged);
  INFO(`A2 閘門：resolveTrustedRecommendationSearchScope("亞特蘭提斯市")=${scopeStr(fScope)}`);
  const mf = await mirrorContinuation(forged, "再推薦一些");
  P(`  [mirror+rt] 「再推薦一些」：branch=${mf.branch} outcome=${mf.outcome ?? "-"} RPC=${J(mf.rpc ?? [])} Places=${mf.places?.length ?? 0} centers=${J(centers(mf.places ?? []))} queries=${J((mf.places ?? []).map((c) => c.query))}`);
  expect("R3-untrusted-scope-no-credits-no-places", fScope.status !== "trusted" ? (mf.rpc ?? []).length === 0 && (mf.places ?? []).length === 0 : true, `A2 判定 unavailable 時，selection 分支仍 Credits=${J(mf.rpc)}、Places=${mf.places?.length}（A2 對同類情境要求「不預留、不搜尋」）`, "vuln");
  const mfi = await mirrorInitial({ ...forged, pendingHandoff: true });
  expect("R3-untrusted-scope-initial-no-credits-no-places", fScope.status !== "trusted" ? mfi.rpc.length === 0 && mfi.places.length === 0 : true, `初始推薦（E1）同樣：Credits=${J(mfi.rpc)}、Places=${mfi.places.length}`, "vuln");

  // ── R4 A2 的 stripClientSearchScope 不能直接套用 ──
  P("\n══ R4. 修正可行性：stripClientSearchScope 後的 selection session ══");
  const stripped = M.ctd.stripClientSearchScope(sAfter);
  INFO(`stripClientSearchScope 後 destinationScope=${J(stripped.planningSelection?.destinationScope)}`);
  const p4 = placeCalls.length;
  const noScope = await M.ps.fetchPlanningSelectionRecommendations({ session: stripped, searchPlaces: mockSearchPlaces, locale: "zh-TW" });
  expect("R4-fetch-without-trusted-scope-no-search", noScope.places.length === 0 && placeCalls.length === p4, `fetchPlanningSelectionRecommendations 未傳 trustedScope：places=${noScope.places.length}、searchPlaces 呼叫=${placeCalls.length - p4}（必須 0）`, "vuln");
  const ms = await mirrorContinuation(stripped, "再推薦一些");
  INFO(`剝除座標後經閘門：outcome=${ms.outcome} Places=${ms.places?.length ?? 0} lat/lng=${J(centers(ms.places ?? []))} radius=${J([...new Set((ms.places ?? []).map((c) => c.radius))])}`);

  // ── R5 E4 選取：跨城市卡片 ──
  P("\n══ R5. E4 選取：非本 selection 目的地的卡片 ══");
  const kyotoCard = { id: "ChIJkyoto1", googlePlaceId: "ChIJkyoto1", name: "京都示意寺", address: "日本京都府京都市", lat: 35.01, lng: 135.77, rating: 4.6 };
  const toggled = M.ps.togglePlanningSelectionPlace(sAfter, kyotoCard);
  const prepared = M.ps.preparePlanningSelectionForGenerate(toggled);
  expect("R5-cross-city-card-not-anchor", toggled === sAfter && !prepared.requiredPlaces.some((p) => p.name === "京都示意寺"), `京都卡片加入台南 selection 被拒：requiredPlaces=${J(prepared.requiredPlaces.map((p) => p.name))} blocked=${prepared.blockedReason ?? "無"}`, "vuln");

  // ── R6 [risk] 一般路徑同步判斷（不打 Geocoding）：同城市子區域被誤判為「另一城市」而離開 selection ──
  // 每組：Plan form 目的地 → E1 鏡像初始推薦 → 選 2 個 selection 推薦地點 → 子區域句子經 send() 一般路徑真實區塊（含 dropStale）。
  // 記錄：是否離開 selection、selection 已選地點剩幾個、planAiMode。本節模組快取是「乾淨」的（未經閘門學到子區域上層），
  // 等同使用者第一次提到該子區域、或重新整理頁面後（providerTrustedParents 只在記憶體）。
  // 替代規則 ALT：「無法確定是否不同時保留 selection」：只有當不屬於 selection 的標籤在本機 Authority 是已知城市（known_city）
  //   或已知上層＋尾段（known_parent_tail）時才清除；未知／暫定片段保留（續推由 E2 閘門把關、指名他城會先詢問）。
  P("\n══ R6. [risk] 子區域句子經一般路徑：誤清除 selection 的量化（現行規則 vs 替代規則 ALT）══");
  if (!runGeneral) {
    INFO("R6 略過：一般路徑真實區塊不可用");
  } else {
    const D = (country, city, region, display, lat, lng) => ({ placeId: `mock-pid-${display}`, country, city, region, lat, lng, formattedName: `${country}・${display}`, displayLabel: display, address: `${country}${city}` });
    const DEST = {
      新北: D("台灣", "新北市", "新北市", "新北", 25.0169, 121.4628),
      台北: D("台灣", "台北市", "台北市", "台北", 25.033, 121.5654),
      台南: TAINAN,
      宜蘭: D("台灣", "宜蘭縣", "宜蘭縣", "宜蘭", 24.7021, 121.7378),
      京都: D("日本", "京都市", "京都府", "京都", 35.0116, 135.7681),
      東京: D("日本", "東京都", "東京都", "東京", 35.6762, 139.6503),
      大阪: D("日本", "大阪市", "大阪府", "大阪", 34.6937, 135.5023),
    };
    // [selection, 句子, 是否其實是同目的地（子區域）]
    const CASES = [
      ["新北", "我想去淡水玩", true], ["新北", "淡水有什麼好吃的", true], ["新北", "九份有什麼好玩的", true], ["新北", "去板橋走走", true],
      ["新北", "三峽老街好玩嗎", true], ["新北", "野柳有什麼好玩的", true], ["新北", "我想去金瓜石", true], ["新北", "我想去新北市淡水區玩", true],
      ["台北", "我想去北投泡湯", true], ["台北", "士林有什麼好吃的", true], ["台北", "大稻埕有什麼好玩的", true],
      ["台南", "安平有什麼好吃的", true], ["台南", "我想去七股玩", true],
      ["宜蘭", "我想去礁溪泡溫泉", true], ["宜蘭", "羅東有什麼好吃的", true],
      ["京都", "我想去嵐山玩", true], ["京都", "祇園有什麼好吃的", true], ["京都", "伏見有什麼好玩的", true],
      ["東京", "淺草有什麼好吃的", true], ["東京", "我想去新宿逛街", true], ["東京", "澀谷有什麼好玩的", true],
      ["大阪", "難波有什麼好吃的", true], ["大阪", "我想去心齋橋", true],
      // 對照：真的換城市（必須清除，R2a 同性質）
      ["新北", "我想去台中玩", false], ["東京", "我想去大阪玩", false], ["台南", "我想去京都玩兩天", false], ["京都", "我想去輕井澤玩", false], ["台北", "那花蓮呢", false],
    ];
    const bareLabel = (v) => v?.split("・").map((x) => x.trim()).filter(Boolean).at(-1);
    // 單一標籤是否屬於 selection：用真實 dropStalePlanningSelection 只餵這一個標籤判斷
    const belongs = (session, label) =>
      M.ps.isPlanningSelectionMode(M.ps.dropStalePlanningSelection({ ...session, travelContext: { ...(session.travelContext ?? { interests: [] }), destination: label }, tripPlanningContext: undefined, tripDestination: undefined }));
    const altDrop = (pre) => {
      if (!pre?.planningSelection) return { out: pre, why: "no_selection" };
      const cur = M.ps.dropStalePlanningSelection(pre);
      if (cur === pre) return { out: pre, why: "same" };
      const labels = [pre.travelContext?.destination, pre.tripPlanningContext?.destination, pre.tripDestination?.city, pre.tripDestination?.displayLabel].map(bareLabel).filter(Boolean);
      const other = [...new Set(labels)].filter((l) => !belongs(pre, l));
      const known = other.map((l) => {
        const r = M.dr.resolveDestination({ text: l });
        return { l, src: r.source, dest: r.destination, parent: r.areaCandidate?.parentCity ?? (r.geographicScope?.searchScope === "area" ? r.geographicScope.parentCity : undefined) };
      });
      const provable = known.filter((k) => k.src === "known_city" || k.src === "known_parent_tail");
      return { out: provable.length ? cur : pre, why: J(known) };
    };
    const selectedFromSelection = (s, sel) => (s.selectedPlaces ?? []).filter((p) => sel.some((q) => (q.googlePlaceId || q.id) === (p.googlePlaceId || p.id))).length;
    const built6 = {};
    for (const [key, dest] of Object.entries(DEST)) {
      const form = { destination: dest, origin: null, days: 2, mood: "", styles: ["美食探索", "城市漫遊"], normalizedStyles: ["美食探索", "城市漫遊"], startDate: "2026-12-01", endDate: "2026-12-02", departureTime: "09:00", transport: "步行" };
      const s = M.pth.preparePlanTripSession(form, { location: { lat: dest.lat, lng: dest.lng, city: key }, weather: null, time: new Date().toISOString(), preferences: {} }, undefined, { planAiMode: true, localeStyleOptions: form.styles });
      const init = await mirrorInitial(s);
      const base = { ...(init.result?.session ?? s), pendingHandoff: false, planHandoffDone: true };
      const picks = (init.result?.places ?? []).slice(0, 2);
      const withSel = picks.reduce((acc, p) => M.ps.togglePlanningSelectionPlace(acc, p), base);
      built6[key] = { s: withSel, picks, outcome: init.outcome };
      const lv = ["qualified", "destination", "parent"].map((l) => M.ps.planningSelectionDestinationLabel(withSel, l));
      INFO(`selection ${key}：初始推薦 ${init.outcome}、已選 ${selectedFromSelection(withSel, picks)} 個、planAiMode=${withSel.planAiMode}；閘門標籤（qualified/名稱/上一層）=${J(lv)} destinationScope.name=${J(withSel.planningSelection?.destinationScope?.name)}`);
      if (lv[0]) {
        const q = await gScope(lv[0], M.ctd.stripClientSearchScope(withSel));
        INFO(`  需求 2：qualified 標籤「${lv[0]}」（名稱「${lv[1]}」本身是城市級但無市／縣／都字尾）過閘門 → ${scopeStr(q)}`);
      }
    }
    const stats = { sub: 0, subDropped: 0, subAltDropped: 0, ctl: 0, ctlDropped: 0, ctlAltDropped: 0, notGeneral: 0 };
    for (const [key, text, isSub] of CASES) {
      const { s, picks } = built6[key];
      const sw = M.tpc.classifyDestinationSwitchTurn(text).state;
      const cont = M.ps.isPlanningSelectionContinuation(text);
      if (sw !== "NO_SWITCH" || cont) {
        stats.notGeneral += 1;
        P(`  [real-block] [${key}]「${text}」：turnSwitch=${sw} continuation=${cont} → 不走一般路徑（${sw !== "NO_SWITCH" ? "switch 區塊需驗證" : "E2 閘門"}）`);
        continue;
      }
      let res;
      try {
        res = await runGeneral(s, text);
      } catch (e) {
        P(`  [real-block] [${key}]「${text}」：一般路徑執行失敗 ${String(e?.message ?? e).split("\n")[0]}`);
        continue;
      }
      const dropped = M.ps.isPlanningSelectionMode(s) && !M.ps.isPlanningSelectionMode(res.nextSession);
      const alt = altDrop(res.pre);
      const altDropped = !M.ps.isPlanningSelectionMode(alt.out);
      const before = selectedFromSelection(s, picks);
      const after = selectedFromSelection(res.nextSession, picks);
      if (isSub) {
        stats.sub += 1;
        stats.subDropped += dropped ? 1 : 0;
        stats.subAltDropped += altDropped ? 1 : 0;
      } else {
        stats.ctl += 1;
        stats.ctlDropped += dropped ? 1 : 0;
        stats.ctlAltDropped += altDropped ? 1 : 0;
      }
      const pre = res.pre ?? {};
      P(`  [real-block] [${key}]「${text}」${isSub ? "(子區域)" : "(他城對照)"}：寫入 travelContext=${J(pre.travelContext?.destination ?? null)} tripPlanningContext=${J(pre.tripPlanningContext?.destination ?? null)} tripDestination=${J(pre.tripDestination?.displayLabel ?? pre.tripDestination?.city ?? null)} → 現行：${dropped ? "離開 selection" : "保留"}（已選 ${before}→${after}、planAiMode=${res.nextSession.planAiMode}）；ALT：${altDropped ? "離開" : "保留"} ${alt.why}`);
    }
    INFO(`統計：子區域句子走一般路徑 ${stats.sub} 句，現行規則誤清除 ${stats.subDropped} 句、ALT 誤清除 ${stats.subAltDropped} 句；他城對照 ${stats.ctl} 句，現行清除 ${stats.ctlDropped}、ALT 清除 ${stats.ctlAltDropped}；不走一般路徑 ${stats.notGeneral} 句`);
    expect("R6-risk-subarea-not-dropped-current", stats.subDropped === 0, `[risk] 現行規則下同城市子區域句子誤離開 selection（並清掉 selection 已選地點）=${stats.subDropped}/${stats.sub}（應為 0）`, "risk");
    expect("R6-risk-alt-rule-keeps-subarea", stats.subAltDropped === 0, `[risk] ALT（無法確定時保留）子區域誤清除=${stats.subAltDropped}/${stats.sub}`, "risk");
    expect("R6-risk-alt-rule-still-drops-other-city", stats.ctl > 0 && stats.ctlAltDropped === stats.ctl, `[risk] ALT 對真的換城市仍清除=${stats.ctlAltDropped}/${stats.ctl}（R2a 同性質，須全清）`, "risk");
  }
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const vuln = rows.filter((r) => r.cat === "vuln");
const base = rows.filter((r) => r.cat === "base");
const risk = rows.filter((r) => r.cat === "risk");
P(`\n[base] PASS=${base.filter((r) => r.ok).length}/${base.length}；[vuln] 漏洞重現（FAIL）=${vuln.filter((r) => !r.ok).length}/${vuln.length}${vuln.some((r) => !r.ok) ? `（${vuln.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}`);
// [risk]：新風險（#PL-FIX-T3 量化），尚未裁定 → 只回報、不影響整體結果；裁定後改為 vuln。
P(`[risk] 未通過=${risk.filter((r) => !r.ok).length}/${risk.length}${risk.some((r) => !r.ok) ? `（${risk.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}（不計入整體結果）`);
P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
const bad = external > 0 || base.some((r) => !r.ok) || vuln.some((r) => !r.ok) || Object.keys(loadErr).some((k) => k !== "pth" && k !== "lf");
P(`verify-planner-selection-probe: ${bad ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(bad ? 1 : 0);
