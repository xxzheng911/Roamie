#!/usr/bin/env node
/**
 * PL-FIX-T — Planner 選擇入口 A2 信任閘門：真實路徑驗證（離線、唯讀，不寫任何檔案）。
 *
 * 與 verify-planner-selection-probe.mjs 的差別：這裡不手寫鏡像。直接從 src/routes/_app.chat.tsx 取出
 * 「實際的程式碼區塊」（E1 runPlanFormHandoff 的 selection 分支、send() 的換城市回答區塊與 E2 selection
 * 補充推薦分支、isEquivalentSwitchDestination、E4 onAddToTrip），以 esbuild 去除 TS 型別後執行；
 * 區塊內呼叫的模組函式全部是真實模組（A2 閘門、planning-selection、Credits operations、chat-runtime-copy、
 * destination-geographic-clarification、chat-generation-lock、location.functions 的 geocode）。
 * 只有 React state／ref／persistSession／pushMorePlaceRecommendations 以紀錄器替代（React callback 本體
 * 無法離線 render：專案沒有 jsdom／@testing-library）。
 *
 * 外部請求：Google（geocode／Places）、Supabase RPC 全部 mock 並逐筆計數；任何真實 fetch／http／net
 * 呼叫都會使整體 FAIL。不讀 .env。
 *
 * 標記：[acc] 驗收（必須 PASS）；[risk] 審查發現（以斷言寫出「應成立」的條件，FAIL＝問題存在，
 *       不影響結束碼，於報告列出）；INFO 只陳述事實。
 * 執行：node scripts/verify-planner-selection-gate-realpath.mjs
 */
import { readFileSync } from "node:fs";

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
    export async function googleRestFetch(input, init, context) { return globalThis.__PLG_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return false; }`,
  "@/integrations/supabase/client": `
    const any = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : any()), apply: () => any() });
    export const supabase = new Proxy({}, { get(_t, p) {
      if (p === "rpc") return async (name, args) => globalThis.__PLG_RPC(name, args);
      if (p === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
      return any();
    } });
  `,
  sonner: `export const toast = new Proxy(function () {}, { get: () => (...a) => { (globalThis.__PLG_TOAST ??= []).push(a); }, apply: (_t, _s, a) => { (globalThis.__PLG_TOAST ??= []).push(a); } });`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.plg-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "plg-transport-stubs",
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
const MODS = {
  ps: "lib/planning-selection.ts",
  ctd: "lib/ai/chat-turn-destination.ts",
  tpc: "lib/ai/trip-planning-context.ts",
  tc: "lib/ai/travel-context.ts",
  cs: "lib/chat-session.ts",
  credits: "lib/credits/index.ts",
  cff: "lib/credits/feature-flag.ts",
  pth: "lib/plan-trip-handoff.ts",
  crc: "lib/chat-runtime-copy.ts",
  dgc: "lib/ai/destination-geographic-clarification.ts",
  lock: "lib/ai/chat-generation-lock.ts",
  lf: "lib/location.functions.ts",
  bpr: "lib/build-place-recommendation-reason.ts",
  tpf: "lib/ai/trip-planning-follow-up.ts",
  da: "lib/location/destination-authority.ts",
};
async function freshModules() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const M = {};
  for (const [k, p] of Object.entries(MODS)) {
    try {
      M[k] = await runner.executeFile(`${WORK_ROOT}/src/${p}`);
    } catch (e) {
      M[k] = null;
      M.__loadErr = { ...(M.__loadErr ?? {}), [k]: String(e?.message ?? e).split("\n")[0] };
    }
  }
  M.cff?.setCreditsFeatureEnabledOverride?.(true);
  return M;
}

// ════ Mock Google（geocode：Legacy Geocoding 格式；逐筆計數）════
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const gres = ({ pid, fa, lat, lng, types, comps }) => ({ address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE", viewport: { northeast: { lat: lat + 0.1, lng: lng + 0.1 }, southwest: { lat: lat - 0.1, lng: lng - 0.1 } } }, place_id: pid, types });
const C = {
  TW: comp("台灣", "TW", ["country", "political"]),
  JP: comp("日本", "JP", ["country", "political"]),
  AT: comp("奧地利", "AT", ["country", "political"]),
  KR: comp("南韓", "KR", ["country", "political"]),
};
/**
 * Plan form 目的地（規劃頁 LocationSearchField searchMode="geographic" → resolveTripLocation →
 * rawToTripLocation）。details＝Place Details 原始回應；geo＝同地點的 Geocoding 回應（閘門的 provider check 用）。
 */
const PLACES = {
  台南: { lat: 22.9997, lng: 120.227, details: { displayName: "台南市", types: ["administrative_area_level_1", "political"], comps: [["台南市", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["台南"], types: ["administrative_area_level_1", "political"], fa: "台灣台南市", comps: [comp("台南市", "台南市", ["administrative_area_level_1", "political"]), C.TW] } },
  京都: { lat: 35.0116, lng: 135.7681, details: { displayName: "京都市", types: ["locality", "political"], comps: [["京都市", ["locality", "political"]], ["京都府", ["administrative_area_level_1", "political"]], ["日本", ["country", "political"], "JP"]] }, geo: { keys: ["京都"], types: ["locality", "political"], fa: "日本京都府京都市", comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), C.JP] } },
  新北: { lat: 25.012, lng: 121.4657, details: { displayName: "新北市", types: ["administrative_area_level_1", "political"], comps: [["新北市", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["新北"], types: ["administrative_area_level_1", "political"], fa: "台灣新北市", comps: [comp("新北市", "新北市", ["administrative_area_level_1", "political"]), C.TW] } },
  "九份(neighborhood)": { lat: 25.1094, lng: 121.8446, details: { displayName: "九份", types: ["neighborhood", "political"], comps: [["九份", ["neighborhood", "political"]], ["瑞芳區", ["administrative_area_level_2", "political"]], ["新北市", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["九份", "瑞芳"], types: ["neighborhood", "political"], fa: "台灣新北市瑞芳區九份", comps: [comp("九份", "九份", ["neighborhood", "political"]), comp("瑞芳區", "瑞芳區", ["administrative_area_level_2", "political"]), comp("新北市", "新北市", ["administrative_area_level_1", "political"]), C.TW] } },
  "九份(locality)": { lat: 25.1094, lng: 121.8446, details: { displayName: "九份", types: ["locality", "political"], comps: [["九份", ["locality", "political"]], ["瑞芳區", ["administrative_area_level_2", "political"]], ["新北市", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: null },
  合歡山: { lat: 24.1431, lng: 121.2731, details: { displayName: "合歡山", types: ["natural_feature"], comps: [["仁愛鄉", ["administrative_area_level_2", "political"]], ["南投縣", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["合歡山", "仁愛"], types: ["administrative_area_level_2", "political"], fa: "台灣南投縣仁愛鄉", comps: [comp("仁愛鄉", "仁愛鄉", ["administrative_area_level_2", "political"]), comp("南投縣", "南投縣", ["administrative_area_level_1", "political"]), C.TW] } },
  "東山區(清水寺)": { lat: 34.9948, lng: 135.785, details: { displayName: "東山區", types: ["sublocality_level_1", "sublocality", "political"], comps: [["東山區", ["sublocality_level_1", "sublocality", "political"]], ["京都市", ["locality", "political"]], ["京都府", ["administrative_area_level_1", "political"]], ["日本", ["country", "political"], "JP"]] }, geo: null },
  墾丁: { lat: 21.9483, lng: 120.7798, details: { displayName: "墾丁", types: ["neighborhood", "political"], comps: [["墾丁", ["neighborhood", "political"]], ["恆春鎮", ["administrative_area_level_2", "political"]], ["屏東縣", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["墾丁", "恆春"], types: ["administrative_area_level_2", "political"], fa: "台灣屏東縣恆春鎮", comps: [comp("恆春鎮", "恆春鎮", ["administrative_area_level_2", "political"]), comp("屏東縣", "屏東縣", ["administrative_area_level_1", "political"]), C.TW] } },
  宜蘭: { lat: 24.7021, lng: 121.7378, details: { displayName: "宜蘭縣", types: ["administrative_area_level_1", "political"], comps: [["宜蘭縣", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["宜蘭"], types: ["administrative_area_level_1", "political"], fa: "台灣宜蘭縣", comps: [comp("宜蘭縣", "宜蘭縣", ["administrative_area_level_1", "political"]), C.TW] } },
  北海道: { lat: 43.2203, lng: 142.8635, details: { displayName: "北海道", types: ["administrative_area_level_1", "political"], comps: [["北海道", ["administrative_area_level_1", "political"]], ["日本", ["country", "political"], "JP"]] }, geo: { keys: ["北海道"], types: ["administrative_area_level_1", "political"], fa: "日本北海道", comps: [comp("北海道", "北海道", ["administrative_area_level_1", "political"]), C.JP] } },
  白川村: { lat: 36.2578, lng: 136.9061, details: { displayName: "白川村", types: ["locality", "political"], comps: [["白川村", ["locality", "political"]], ["大野郡", ["administrative_area_level_2", "political"]], ["岐阜縣", ["administrative_area_level_1", "political"]], ["日本", ["country", "political"], "JP"]] }, geo: { keys: ["白川"], types: ["locality", "political"], fa: "日本岐阜縣大野郡白川村", comps: [comp("白川村", "白川村", ["locality", "political"]), comp("大野郡", "大野郡", ["administrative_area_level_2", "political"]), comp("岐阜縣", "岐阜県", ["administrative_area_level_1", "political"]), C.JP] } },
  哈修塔特: { lat: 47.5622, lng: 13.6493, details: { displayName: "哈修塔特", types: ["locality", "political"], comps: [["哈修塔特", ["locality", "political"]], ["格蒙登", ["administrative_area_level_2", "political"]], ["上奧地利邦", ["administrative_area_level_1", "political"]], ["奧地利", ["country", "political"], "AT"]] }, geo: { keys: ["哈修塔特", "Hallstatt"], types: ["locality", "political"], fa: "奧地利哈修塔特", comps: [comp("哈修塔特", "Hallstatt", ["locality", "political"]), comp("格蒙登", "Gmunden", ["administrative_area_level_2", "political"]), comp("上奧地利邦", "Upper Austria", ["administrative_area_level_1", "political"]), C.AT] } },
  // #PL-FIX-T2：同名行政區（基隆市信義區）。geocode 只有帶「基隆」的查詢才回基隆；單獨「信義區」回台北市信義區
  // （Google 對同名區的預設解析；本 fixture 必須排在台北信義區之前，否則「基隆市信義區」會先命中「信義」）。
  "信義區(基隆)": { lat: 25.1293, lng: 121.7725, details: { displayName: "信義區", types: ["administrative_area_level_2", "political"], comps: [["信義區", ["administrative_area_level_2", "political"]], ["基隆市", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["基隆"], types: ["administrative_area_level_2", "political"], fa: "台灣基隆市信義區", comps: [comp("信義區", "信義區", ["administrative_area_level_2", "political"]), comp("基隆市", "基隆市", ["administrative_area_level_1", "political"]), C.TW] } },
  信義區: { lat: 25.033, lng: 121.5654, details: { displayName: "信義區", types: ["administrative_area_level_2", "political"], comps: [["信義區", ["administrative_area_level_2", "political"]], ["台北市", ["administrative_area_level_1", "political"]], ["台灣", ["country", "political"], "TW"]] }, geo: { keys: ["信義"], types: ["administrative_area_level_2", "political"], fa: "台灣台北市信義區", comps: [comp("信義區", "信義區", ["administrative_area_level_2", "political"]), comp("台北市", "台北市", ["administrative_area_level_1", "political"]), C.TW] } },
  首爾: { lat: 37.5665, lng: 126.978, details: { displayName: "首爾", types: ["locality", "political"], comps: [["首爾", ["locality", "political"]], ["首爾特別市", ["administrative_area_level_1", "political"]], ["南韓", ["country", "political"], "KR"]] }, geo: { keys: ["首爾"], types: ["locality", "political"], fa: "南韓首爾", comps: [comp("首爾", "首爾", ["locality", "political"]), comp("首爾特別市", "首爾特別市", ["administrative_area_level_1", "political"]), C.KR] } },
};
const GEO_FIXTURES = [
  ...Object.entries(PLACES)
    .filter(([, p]) => p.geo)
    .map(([name, p]) => ({ name, keys: p.geo.keys, result: gres({ pid: `mock-pid-${name}`, fa: p.geo.fa, lat: p.lat, lng: p.lng, types: p.geo.types, comps: p.geo.comps }) })),
  // 只作為 context 子區域（非 Plan form 目的地）
  { name: "淡水", keys: ["淡水"], result: gres({ pid: "mock-pid-tamsui", fa: "台灣新北市淡水區", lat: 25.1696, lng: 121.4407, types: ["administrative_area_level_2", "political"], comps: [comp("淡水區", "淡水區", ["administrative_area_level_2", "political"]), comp("新北市", "新北市", ["administrative_area_level_1", "political"]), C.TW] }) },
  { name: "礁溪", keys: ["礁溪"], result: gres({ pid: "mock-pid-jiaoxi", fa: "台灣宜蘭縣礁溪鄉", lat: 24.8268, lng: 121.7707, types: ["administrative_area_level_2", "political"], comps: [comp("礁溪鄉", "礁溪鄉", ["administrative_area_level_2", "political"]), comp("宜蘭縣", "宜蘭縣", ["administrative_area_level_1", "political"]), C.TW] }) },
];
let googleReqs = [];
globalThis.__PLG_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const query = url.searchParams.get("address") ?? body?.input ?? body?.textQuery;
  googleReqs.push({ kind, query });
  if (kind === "geocode") {
    const q = String(query ?? "");
    const hit = GEO_FIXTURES.find((f) => f.keys.some((k) => q.includes(k)));
    return Response.json(hit ? { status: "OK", results: [hit.result] } : { status: "ZERO_RESULTS", results: [] });
  }
  if (kind === "autocomplete") return Response.json({ suggestions: [] });
  return Response.json({});
};

// ════ Mock searchPlaces（Places 付費呼叫；記錄 query／中心／半徑）════
let placeCalls = [];
let placeSeq = 0;
const mockSearchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng, radius: data.radius, destinationName: data.destinationName });
  const base = { lat: Number.isFinite(data.lat) ? data.lat : 0.5, lng: Number.isFinite(data.lng) ? data.lng : 0.5 };
  const places = [0, 1, 2].map((i) => {
    placeSeq += 1;
    return { id: `ChIJplg${placeSeq}`, name: `示意地點${placeSeq}`, address: `${data.destinationName ?? ""} 示意地址${placeSeq}`, formattedAddress: `${data.destinationName ?? ""} 示意地址${placeSeq}`, lat: base.lat + 0.001 * (i + 1), lng: base.lng + 0.001 * (i + 1), rating: 4.5, userRatingCount: 500, types: data.includedTypes?.length ? [data.includedTypes[0], "point_of_interest"] : ["tourist_attraction"], primaryType: data.includedTypes?.[0] ?? "tourist_attraction", businessStatus: "OPERATIONAL" };
  });
  return { places, error: null, rawCount: places.length };
};

// ════ Credits RPC（Supabase mock）════
let rpcLog = [];
let ledgerSeq = 0;
globalThis.__PLG_RPC = async (name, args) => {
  rpcLog.push({ name, args });
  if (name === "credits_check") return { data: { ok: true, usable_credits: 20 }, error: null };
  if (name === "credits_reserve") return { data: { ok: true, ledger_id: `mock-ledger-${++ledgerSeq}`, status: "reserved" }, error: null };
  if (name === "credits_commit") return { data: { ok: true, status: "committed" }, error: null };
  if (name === "credits_rollback") return { data: { ok: true, status: "rolled_back" }, error: null };
  return { data: null, error: null };
};

// ════ 輸出／斷言 ════
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
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 6).join(" | ")}\nexternal=${external}\nverify-planner-selection-gate-realpath: FAIL\n`);
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
const distKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// ═════════════════════════ 從 _app.chat.tsx 取出真實區塊 ═════════════════════════
// --src <path>：改以另一份 _app.chat.tsx（例如修正前的備份）取出區塊，用來確認本測試在修正前會失敗。
const srcArg = process.argv.indexOf("--src");
const SRC_PATH = srcArg > 0 ? process.argv[srcArg + 1] : `${WORK_ROOT}/src/routes/_app.chat.tsx`;
const SRC = readFileSync(SRC_PATH, "utf8");
const lineOf = (idx) => SRC.slice(0, idx).split("\n").length;
function cut(startNeedle, endNeedle, { includeEnd = false, from = 0 } = {}) {
  const s = SRC.indexOf(startNeedle, from);
  if (s < 0 && srcArg > 0) return { s: -1, e: -1, code: "", missing: true };
  if (s < 0) throw new Error(`找不到區塊起點：${startNeedle.slice(0, 60)}`);
  const e = SRC.indexOf(endNeedle, s + startNeedle.length);
  if (e < 0) throw new Error(`找不到區塊終點：${endNeedle.slice(0, 60)}`);
  return { s, e: includeEnd ? e + endNeedle.length : e, code: SRC.slice(s, includeEnd ? e + endNeedle.length : e) };
}
const BLOCKS = {
  equivalence: cut("function sameNormalizedSwitchDestination(", "\n/**\n * 7.1 checkPersisted"),
  e1: cut("        if (isPlanningSelectionMode(syncedHandoff)) {\n", "\n        const req = toRoamieRequest(\"chat\", bundle"),
  answer: cut("    const selectionSwitchAsked = selectionSwitchPendingRef.current;\n", "      // Any other answer: the question is dropped; this turn continues on the existing flow.\n    }\n", { includeEnd: true }),
  e2: cut("    if (\n      !turnSwitchVerified &&\n      isPlanningSelectionMode(session) &&\n      isPlanningSelectionContinuation(trimmed)\n    ) {\n", "\n    const legacyNearbyClarification ="),
  e4: cut("            onAddToTrip={(rec) => {\n", "\n            onOpenPlaceDetail={handleOpenPlaceDetail}"),
};
P(`══ 0. 取出的真實區塊（${SRC_PATH}）══`);
for (const [k, b] of Object.entries(BLOCKS)) INFO(b.missing ? `${k}: （此版本沒有此區塊）` : `${k}: L${lineOf(b.s)}-L${lineOf(b.e)}`);

/** 把區塊包成 async 函式；deps 的每個 key 成為區塊內可見的同名變數（let，可被區塊重新指派）。 */
async function compileBlock(code, depNames, { tail = 'return "__FALLTHROUGH__";' } = {}) {
  const src = `(async (__d) => {\n let { ${depNames.join(", ")} } = __d;\n${code}\n${tail}\n})`;
  const js = (await transform(src, { loader: "ts", format: "esm", target: "es2022" })).code;
  return (0, eval)(js.trim().replace(/;$/, ""));
}
async function compileExpression(code, depNames) {
  const src = `((__d) => { let { ${depNames.join(", ")} } = __d; return ${code}; })`;
  const js = (await transform(src, { loader: "ts", format: "esm", target: "es2022" })).code;
  return (0, eval)(js.trim().replace(/;$/, ""));
}

// ═════════════════════════ 執行環境（React state／ref 以紀錄器替代）═════════════════════════
function makeEnv(M, initialSession, { locale = "zh-TW" } = {}) {
  const env = {
    msgs: [],
    persisted: [],
    pending: null,
    pushCalls: [],
    toast: [],
    streaming: [],
  };
  const sessionRef = { current: initialSession };
  const msgsRef = { current: [] };
  const selectionSwitchPendingRef = { current: null };
  const selectionRecommendationInFlightRef = { current: false };
  const setMsgs = (next) => {
    env.msgs = typeof next === "function" ? next(env.msgs) : next;
    msgsRef.current = env.msgs;
  };
  const persistSession = (next) => {
    env.persisted.push(next);
    sessionRef.current = next;
    return next;
  };
  const geocodeLocationFn = async (args) => M.lf.geocodeTripLocationFromText(args);
  let equivalence = null;
  const deps = {
    // 真實模組
    isPlanningSelectionMode: M.ps.isPlanningSelectionMode,
    isPlanningSelectionContinuation: M.ps.isPlanningSelectionContinuation,
    planningSelectionDestinationLabel: M.ps.planningSelectionDestinationLabel,
    fetchPlanningSelectionRecommendations: M.ps.fetchPlanningSelectionRecommendations,
    leavePlanningSelection: M.ps.leavePlanningSelection,
    isPlanningSelectionPlaceInScope: M.ps.isPlanningSelectionPlaceInScope,
    togglePlanningSelectionPlace: M.ps.togglePlanningSelectionPlace,
    resolveTrustedRecommendationSearchScope: M.ctd.resolveTrustedRecommendationSearchScope,
    resolvePlanningSelectionTurnDestination: M.ctd.resolvePlanningSelectionTurnDestination,
    resolveCategoryTurnDestination: M.ctd.resolveCategoryTurnDestination,
    stripClientSearchScope: M.ctd.stripClientSearchScope,
    normalizeDestinationLabel: M.tpc.normalizeDestinationLabel,
    classifyDestinationUpdateAnswer: M.dgc.classifyDestinationUpdateAnswer,
    beginPlaceRecommendationCredits: M.credits.beginPlaceRecommendationCredits,
    settleCreditsOperation: M.credits.settleCreditsOperation,
    chatRuntimeCopy: M.crc.chatRuntimeCopy,
    markPlanHandoffComplete: M.pth.markPlanHandoffComplete,
    roamieRecToChatItem: M.cs.roamieRecToChatItem,
    userProfileForReasonFrom: M.bpr?.userProfileForReasonFrom ?? (() => null),
    blockIfChatGenerationLocked: M.lock.blockIfChatGenerationLocked,
    geocodeLocationFn,
    searchNearbyPlaces: mockSearchPlaces,
    // React state／ref／callback 紀錄器
    locale,
    hasPlusAccess: false,
    sessionRef,
    msgsRef,
    selectionSwitchPendingRef,
    selectionRecommendationInFlightRef,
    setSelectionSwitchPending: (next) => {
      selectionSwitchPendingRef.current = next;
      env.pending = next;
    },
    setMsgs,
    setText: () => {},
    setStreaming: (v) => env.streaming.push(v),
    persistSession,
    ensureSubscriptionHydratedForCredits: () => true,
    captureSessionAuthority: () => ({ token: 1 }),
    isSessionAuthorityCurrent: () => env.authorityCurrent !== false,
    getAiPreferences: async () => ({}),
    getUserProfile: async () => ({}),
    uiT: (k) => k,
    t: (k) => k,
    toast: { info: (...a) => env.toast.push(a), error: (...a) => env.toast.push(a) },
    pushMorePlaceRecommendations: async (session, text, conversation) => {
      env.pushCalls.push({ session, text, conversation });
      return true;
    },
    handleAddToTripFromChat: async (rec) => env.toast.push(["handleAddToTripFromChat", rec?.name]),
    logPlanningSelectionHandoffStage: () => {},
    logPlanningSelectionHandoffLoading: () => {},
    selectionTrace: undefined,
    selectionLoadingCleared: false,
    turnSwitchVerified: false,
    get isEquivalentSwitchDestination() {
      return equivalence;
    },
  };
  env.deps = deps;
  env.sessionRef = sessionRef;
  env.msgsRef = msgsRef;
  env.selectionSwitchPendingRef = selectionSwitchPendingRef;
  env.setEquivalence = (fn) => {
    equivalence = fn;
  };
  return env;
}
const DEP_NAMES = (env, extra = []) => [...Object.keys(env.deps), ...extra];

async function equivalenceFn(env) {
  // 真實的 sameNormalizedSwitchDestination + isEquivalentSwitchDestination（取自 _app.chat.tsx）
  const names = ["normalizeDestinationLabel", "resolveCategoryTurnDestination"];
  const fn = await compileBlock(`${BLOCKS.equivalence.code}\nreturn isEquivalentSwitchDestination;`, names, { tail: "" });
  return fn(env.deps);
}

/** E1：runPlanFormHandoff 的 selection 分支（真實區塊）。 */
async function runE1(M, handoff) {
  const env = makeEnv(M, handoff);
  env.setEquivalence(await equivalenceFn(env));
  const names = DEP_NAMES(env, ["syncedHandoff", "handoffSession", "prefs"]);
  const fn = await compileBlock(BLOCKS.e1.code, names);
  const r0 = rpcLog.length;
  const p0 = placeCalls.length;
  const g0 = googleReqs.length;
  const c0 = consoleLog.length;
  const ret = await fn({ ...env.deps, syncedHandoff: handoff, handoffSession: handoff, prefs: {} });
  const gateLog = consoleLog.slice(c0).find((l) => l[1] === "[PLANNING_SELECTION_SCOPE_GATE]");
  return {
    env,
    ret,
    gateReason: gateLog?.[2]?.reason,
    rpc: rpcLog.slice(r0),
    rpcNames: rpcLog.slice(r0).map((r) => r.name),
    places: placeCalls.slice(p0),
    google: googleReqs.slice(g0),
    lastMsg: env.msgs.at(-1)?.content ?? "",
    finalSession: env.sessionRef.current,
  };
}

/** send() 的 selection 子流程：換城市回答區塊 → （未處理時）E2 selection 補充推薦分支。皆為真實區塊。 */
async function runSend(env, text) {
  const names = DEP_NAMES(env, ["trimmed", "displayMessage", "session", "msgs"]);
  const answer = await compileBlock(BLOCKS.answer.code, names);
  const e2 = await compileBlock(BLOCKS.e2.code, names);
  const r0 = rpcLog.length;
  const p0 = placeCalls.length;
  const g0 = googleReqs.length;
  const push0 = env.pushCalls.length;
  const c0 = consoleLog.length;
  const base = () => ({ ...env.deps, trimmed: text, displayMessage: text, session: env.sessionRef.current, msgs: env.msgs });
  let stage = "answer";
  let ret = await answer(base());
  if (ret === "__FALLTHROUGH__") {
    stage = "e2";
    ret = await e2(base());
    if (ret === "__FALLTHROUGH__") stage = "not_selection_branch";
  }
  return {
    stage,
    rpc: rpcLog.slice(r0),
    rpcNames: rpcLog.slice(r0).map((r) => r.name),
    places: placeCalls.slice(p0),
    google: googleReqs.slice(g0),
    pushCalls: env.pushCalls.slice(push0),
    lastMsg: env.msgs.at(-1)?.content ?? "",
    pending: env.selectionSwitchPendingRef.current,
    gateReason: consoleLog.slice(c0).find((l) => l[1] === "[PLANNING_SELECTION_SCOPE_GATE]")?.[2]?.reason,
  };
}

/** E4：onAddToTrip（真實 arrow 函式本體）。 */
async function runE4(env, rec) {
  if (!rec) return { changed: false, toast: [], session: env.sessionRef.current, noCard: true };
  const arrowStart = BLOCKS.e4.code.indexOf("(rec) => {");
  const arrow = BLOCKS.e4.code.slice(arrowStart).replace(/\}\s*$/, "");
  const names = DEP_NAMES(env, ["selectionMode"]);
  const make = await compileExpression(arrow, names);
  const fn = make({ ...env.deps, selectionMode: env.deps.isPlanningSelectionMode(env.sessionRef.current) });
  const before = env.sessionRef.current;
  const t0 = env.toast.length;
  fn(rec);
  return { changed: env.sessionRef.current !== before, toast: env.toast.slice(t0), session: env.sessionRef.current };
}

// ═════════════════════════ Plan form session（真實 rawToTripLocation → preparePlanTripSession）═════════════════════════
function rawDetails(name, p) {
  return {
    id: `mock-details-${name}`,
    displayName: { text: p.details.displayName, languageCode: "zh-TW" },
    formattedAddress: p.geo?.fa ?? `${p.details.comps.at(-1)[0]}${p.details.displayName}`,
    location: { latitude: p.lat, longitude: p.lng },
    addressComponents: p.details.comps.map(([text, types, short]) => ({ longText: text, shortText: short ?? text, types })),
    types: p.details.types,
    primaryType: p.details.types[0],
  };
}
function planFormSession(M, name, { styles = ["美食探索", "城市漫遊"] } = {}) {
  const p = PLACES[name];
  const destination = M.lf.rawToTripLocation(rawDetails(name, p), `mock-details-${name}`);
  if (!destination) throw new Error(`rawToTripLocation 拒絕 ${name}`);
  const form = { destination, origin: null, days: 2, mood: "", styles, normalizedStyles: styles, startDate: "2026-12-01", endDate: "2026-12-02", departureTime: "09:00", transport: "步行" };
  const s = M.pth.preparePlanTripSession(form, { location: { lat: p.lat, lng: p.lng, city: destination.city }, weather: null, time: new Date().toISOString(), preferences: {} }, undefined, { planAiMode: true, localeStyleOptions: styles });
  return { session: s, destination, planCenter: { lat: p.lat, lng: p.lng } };
}
const creditsIds = (rpc) => rpc.map((r) => r.name);
const reserveMeta = (rpc) => rpc.find((r) => r.name === "credits_reserve")?.args?.p_metadata ?? null;

let M = await freshModules();
if (M.__loadErr) {
  P(`載入失敗：${J(M.__loadErr)}`);
}
for (const need of ["ps", "ctd", "credits", "pth", "crc", "dgc", "lock", "lf", "tpc", "cs"]) {
  if (!M[need]) crash(new Error(`必要模組載入失敗：${need} ${J(M.__loadErr)}`));
}

// ═════════════════════════ 1. E1 初始推薦（真實區塊）═════════════════════════
P("\n══ 1. E1 初始推薦：Plan form 目的地 → A2 閘門 → Credits → Places（真實區塊）══");
const e1Table = [];
for (const name of Object.keys(PLACES)) {
  M = await freshModules();
  googleReqs = [];
  const { session, destination, planCenter } = planFormSession(M, name);
  const label = M.ps.planningSelectionDestinationLabel(session);
  const r = await runE1(M, session);
  const center = r.places[0] ? { lat: r.places[0].lat, lng: r.places[0].lng } : null;
  const row = {
    name,
    label,
    tripCity: destination.city,
    trusted: r.places.length > 0 || r.rpcNames.length > 0,
    rpc: r.rpcNames,
    places: r.places.length,
    geocode: r.google.filter((g) => g.kind === "geocode").length,
    centerKm: center ? Math.round(distKm(center, planCenter)) : null,
    queries: [...new Set(r.places.map((c) => c.query.split(" ")[0]))],
    unconfirmedMsg: r.lastMsg.includes("目前無法確認目的地"),
    meta: reserveMeta(r.rpc),
  };
  e1Table.push(row);
  P(`  [rt] ${name}：Plan form 標籤=${J(label)}（tripDestination.city=${J(destination.city)}）→ RPC=${J(row.rpc)} Places=${row.places} geocode=${row.geocode}${row.geocode ? `(${J(r.google.filter((g) => g.kind === "geocode").map((g) => g.query))})` : ""} 搜尋中心距 Plan form 座標=${row.centerKm ?? "-"}km queryPrefix=${J(row.queries)} ${row.unconfirmedMsg ? `→ 回覆「目前無法確認目的地」gate.reason=${r.gateReason}` : ""}`);
  if (row.places === 0) {
    // 同一地點若以「不帶國家前綴的名稱」送閘門（對照，獨立模組狀態）
    const M2 = await freshModules();
    const bare = destination.city;
    const g1 = googleReqs.length;
    const s2 = await M2.ctd.resolveTrustedRecommendationSearchScope({ label: bare, ctx: { interests: [] }, session: {}, locale: "zh-TW", geocodeFn: async (a) => M2.lf.geocodeTripLocationFromText(a) });
    INFO(`  對照：同地點以 ${J(bare)} 送閘門 → ${s2.status === "trusted" ? `trusted/${s2.destination}` : `unavailable/${s2.reason}`}（geocode ${googleReqs.length - g1} 次）`);
  }
  // 每一列都必須滿足：不可信 → 不扣點不搜尋；可信 → Credits 在 Places 之前、metadata 帶 destination
  if (row.places === 0) {
    expect(`E1-${name}-untrusted-no-credits`, row.rpc.length === 0, `閘門未通過時 Credits RPC=${J(row.rpc)}（應為 []）、Places=${row.places}`);
  } else {
    expect(`E1-${name}-trusted-credits-once`, J(row.rpc) === J(["credits_check", "credits_reserve", "credits_commit"]), `Credits=${J(row.rpc)}；Places=${row.places}`);
    expect(`E1-${name}-metadata-destination`, typeof row.meta?.destination === "string" && row.meta.destination.length > 0 && row.meta.path === "planning_selection_initial", `reserve.p_metadata=${J(row.meta)}`);
  }
}
const blocked = e1Table.filter((r) => r.places === 0);
INFO(`E1 受影響範圍：${blocked.length}/${e1Table.length} 個 Plan form 目的地被閘門擋下：${J(blocked.map((r) => `${r.name}→${r.label}`))}`);
const moved = e1Table.filter((r) => r.centerKm != null && r.centerKm > 15);
INFO(`可信但搜尋中心離 Plan form 選點 >15km：${J(moved.map((r) => `${r.name}(${r.centerKm}km, 搜尋「${r.queries[0]}」)`))}`);
expect("E1-risk-legit-planform-destinations-not-blocked", blocked.length === 0, `合法 Plan form 目的地（皆為 Google 地理區域）被擋下 ${blocked.length} 個：${J(blocked.map((r) => r.name))}`, "risk");
expect("E1-risk-search-stays-near-planform-place", moved.length === 0, `可信但改以上層行政區中心搜尋（與使用者選的地點相距 >15km）：${J(moved.map((r) => `${r.name}:${r.centerKm}km`))}`, "risk");
// #PL-FIX-T2：同名行政區消歧（不帶國家前綴後，閘門只收到「信義區」，上一層「基隆市」只在不可信時才退回）
{
  const kl = e1Table.find((r) => r.name === "信義區(基隆)");
  INFO(`基隆市信義區 Plan form：閘門標籤=${J(kl?.label)} 搜尋中心距使用者選點=${kl?.centerKm}km queryPrefix=${J(kl?.queries)} metadata.destination=${J(kl?.meta?.destination)}`);
  expect("E1-risk-same-name-district-keeps-parent-city", kl && kl.centerKm != null && kl.centerKm <= 15, `基隆市信義區被解析成 ${kl?.centerKm}km 外的同名區（台北市信義區）並扣點搜尋；閘門標籤只有 ${J(kl?.label)}，tripDestination.region「基隆市」只在名稱不可信時才使用`, "risk");
}

// ═════════════════════════ 2. E2 補充推薦（真實區塊；以 Plan form 台南為基準）═════════════════════════
P("\n══ 2. E2 補充推薦（send() 真實區塊）══");
async function tainanAfterInitial(name = "台南") {
  M = await freshModules();
  const { session } = planFormSession(M, name);
  const r = await runE1(M, session);
  const after = { ...r.finalSession, pendingHandoff: false, planHandoffDone: true };
  const env = makeEnv(M, after);
  env.setEquivalence(await equivalenceFn(env));
  env.msgs = r.env.msgs;
  env.msgsRef.current = env.msgs;
  return { env, initial: r, session: after };
}
let base = await tainanAfterInitial();
const tainanTrusted = base.initial.places.length > 0;
INFO(`基準 Plan form 台南：E1 Places=${base.initial.places.length} Credits=${J(base.initial.rpcNames)} trustedDestination=${J(base.session.planningSelection?.trustedDestination)}`);
expect("E2-precondition-tainan-initial-trusted", tainanTrusted, "Plan form「台南」初始推薦可通過閘門（後續 E2 情境的前提）");

// 2a 同目的地：「再推薦一些」→ 只扣 1 次、搜尋次數＝直接以同一可信範圍呼叫 fetch 的次數
{
  const { env, session } = base;
  const expectedCalls = [];
  const scope = await M.ctd.resolveTrustedRecommendationSearchScope({ label: M.ps.planningSelectionDestinationLabel(session), ctx: session.travelContext ?? { interests: [] }, session: M.ctd.stripClientSearchScope(session), locale: "zh-TW", geocodeFn: env.deps.geocodeLocationFn });
  await M.ps.fetchPlanningSelectionRecommendations({ session, searchPlaces: async (a) => { expectedCalls.push(a.data.query); return { places: [], error: null }; }, locale: "zh-TW", trustedScope: scope });
  const r = await runSend(env, "再推薦一些");
  P(`  [rt] 「再推薦一些」：stage=${r.stage} RPC=${J(r.rpcNames)} Places=${r.places.length}（同 session 直接 fetch=${expectedCalls.length}）geocode=${r.google.filter((g) => g.kind === "geocode").length} pending=${J(r.pending)}`);
  expect("E2-same-destination-one-credit", J(r.rpcNames) === J(["credits_check", "credits_reserve", "credits_commit"]), `Credits=${J(r.rpcNames)}`);
  expect("E2-same-destination-search-count-unchanged", r.places.length === expectedCalls.length && r.places.length > 0, `Places 呼叫=${r.places.length}，與直接以同一可信範圍呼叫 fetchPlanningSelectionRecommendations 的 ${expectedCalls.length} 次相同`);
  expect("E2-same-destination-metadata", reserveMeta(r.rpc)?.destination && reserveMeta(r.rpc)?.path === "planning_selection_continuation", `reserve.p_metadata=${J(reserveMeta(r.rpc))}`);
  expect("E2-same-destination-no-geocode", r.google.length === 0, `Google 請求=${J(r.google)}（台南為 Authority 已知城市，不應再 geocode）`);
}
// 2b 指名同一城市
{
  base = await tainanAfterInitial();
  const r = await runSend(base.env, "台南還有其他的嗎");
  P(`  [rt] 「台南還有其他的嗎」：stage=${r.stage} RPC=${J(r.rpcNames)} Places=${r.places.length} pending=${J(r.pending?.destination ?? null)}`);
  expect("E2-named-same-city-no-question", !r.pending && J(r.rpcNames) === J(["credits_check", "credits_reserve", "credits_commit"]), `指名同一城市不詢問、照常扣 1 次：RPC=${J(r.rpcNames)} pending=${J(r.pending)}`);
}
// 2c 指名另一可信城市 → 詢問（不扣點、不搜尋）→ 確認
{
  base = await tainanAfterInitial();
  const { env } = base;
  const selectedCard = base.initial.env.msgs.at(-1)?.roamie?.recommendations?.[0];
  if (selectedCard) await runE4(env, selectedCard);
  const selectedBefore = env.sessionRef.current.planningSelection?.selectedPlaceIds.length ?? 0;
  const ask = await runSend(env, "京都還有其他的嗎");
  P(`  [rt] 「京都還有其他的嗎」：stage=${ask.stage} RPC=${J(ask.rpcNames)} Places=${ask.places.length} pending=${J(ask.pending && { destination: ask.pending.destination, previous: ask.pending.previous })} 回覆=${J(ask.lastMsg.slice(0, 40))}`);
  expect("E2-other-city-asks-before-credits", ask.pending?.destination && ask.rpcNames.length === 0 && ask.places.length === 0, `詢問換城市：Credits=${J(ask.rpcNames)} Places=${ask.places.length} pending.destination=${J(ask.pending?.destination)}`);
  const chip = M.crc.chatRuntimeCopy("planningSelectionSwitchConfirmChip", "zh-TW", { destination: ask.pending?.destination ?? "" });
  const confirm = await runSend(env, chip);
  const left = env.sessionRef.current;
  const push = confirm.pushCalls[0];
  P(`  [rt] 確認「${chip}」：stage=${confirm.stage} RPC(區塊內)=${J(confirm.rpcNames)} Places=${confirm.places.length} push=${confirm.pushCalls.length} push.text=${J(push?.text)} planningSelection=${J(left.planningSelection ?? null)} selectedPlaces ${selectedBefore}→${left.selectedPlaces?.length ?? 0}`);
  expect("E2-confirm-leaves-selection", !left.planningSelection && !push?.session.planningSelection, "確認後 planningSelection（含 destinationScope）已清除，交給一般 more_places 的 session 也沒有");
  expect("E2-confirm-drops-selection-places", (left.selectedPlaces ?? []).length === 0 && (left.plannedStops ?? []).length === 0, `從舊 selection 帶入的已選地點已清除（selectedPlaces=${left.selectedPlaces?.length ?? 0}, plannedStops=${left.plannedStops?.length ?? 0}；確認前已選 ${selectedBefore}）`);
  expect("E2-confirm-routes-to-more-places-with-original-text", confirm.pushCalls.length === 1 && push.text === "京都還有其他的嗎" && push.session.travelContext?.tripPurpose === "more_place_recommendations", `pushMorePlaceRecommendations 以原句呼叫 1 次（A2 more_places 由它負責 Credits／閘門）`);
  expect("E2-confirm-block-itself-no-credits", confirm.rpcNames.length === 0 && confirm.places.length === 0, `回答區塊本身不扣點不搜尋（Credits 交由 more_places 一次）：RPC=${J(confirm.rpcNames)}`);
  // 確認後一般 A2 more_places 實際判定的目的地（真實 resolveMorePlacesTurnDestination，與 pushMorePlaceRecommendations 同參數順序）
  if (push) {
  const merged = M.tc.mergeTravelContext(push.session, push.text);
  const requested = await M.ctd.resolveMorePlacesTurnDestination({ ctx: merged.context, session: merged.session, userText: push.text, locale: "zh-TW", geocodeFn: env.deps.geocodeLocationFn });
  INFO(`確認後 A2 more_places 判定目的地=${J(requested)}；mergeTravelContext 後 tripDestination=${J(merged.session.tripDestination?.displayLabel ?? merged.session.tripDestination?.city)} tripPlanningContext.destination=${J(merged.session.tripPlanningContext?.destination ?? null)} planAiMode=${merged.session.planAiMode} fromPlanForm=${merged.session.fromPlanForm}`);
  expect("E2-confirm-more-places-targets-new-city", requested === "京都", `一般 more_places 對原句判定=${J(requested)}`);
  // E3 風險：pushMorePlaceRecommendations 成功後寫回的 session＝{ ...merged.session, ...mergeTripSessionUsedPlacesFromMessages(activeSession) , travelContext:{destination:新城市} }
  // （_app.chat.tsx renderMorePlacesReply：sessionWithRecs 的展開順序），activeSession 的 tripDestination 會蓋回去。
  const renderIdx = SRC.indexOf("const sessionWithRecs: ChatPlanningSession = {\n          ...merged.session,\n          ...sessionWithUsed,");
  const withUsed = M.tpf.mergeTripSessionUsedPlacesFromMessages(push.session, push.conversation);
  const persistedAfterMore = { ...merged.session, ...withUsed, travelContext: { ...merged.context, destination: "京都" } };
  const tripDestAfter = persistedAfterMore.tripDestination;
  const stillOld = Boolean(tripDestAfter && /台南/.test(`${tripDestAfter.city}${tripDestAfter.displayLabel}`));
  INFO(`more_places 寫回（L${lineOf(renderIdx)} 展開順序 ...merged.session, ...sessionWithUsed）後：tripDestination=${J(tripDestAfter?.displayLabel)} travelContext.destination=${J(persistedAfterMore.travelContext.destination)} planAiMode=${persistedAfterMore.planAiMode}`);
  // #PL-FIX-T2 裁定 3：確認後 leavePlanningSelection 的結果（more_places 寫回之前；more_places 失敗時就是持久化狀態）
  const td = left.tripDestination ?? {};
  INFO(`確認後（more_places 寫回前）session：tripDestination=${J({ placeId: td.placeId, country: td.country, city: td.city, displayLabel: td.displayLabel, lat: td.lat, lng: td.lng })} travelContext.destination=${J(left.travelContext?.destination ?? null)} tripPlanningContext.destination=${J(left.tripPlanningContext?.destination ?? null)} preferredArea=${J(left.preferredArea ?? null)} location.city=${J(left.location?.city ?? null)} planAiMode=${left.planAiMode} fromPlanForm=${left.fromPlanForm}`);
  expect("E2-confirm-trip-destination-is-gate-result", td.city === ask.pending?.destination && td.placeId === "" && left.planAiMode === false && left.fromPlanForm === false && Math.abs(td.lat - ask.pending.center.lat) < 1e-9 && Math.abs(td.lng - ask.pending.center.lng) < 1e-9, `tripDestination=閘門結果（city=${J(td.city)}、placeId 空、中心=閘門中心），planAiMode／fromPlanForm=false`);
  const oldFields = Object.entries({ "travelContext.destination": left.travelContext?.destination, "tripPlanningContext.destination": left.tripPlanningContext?.destination, preferredArea: left.preferredArea, "location.city": left.location?.city }).filter(([, v]) => typeof v === "string" && /台南/.test(v));
  expect("E2-risk-confirm-no-old-city-field-left", oldFields.length === 0, `確認換城市後仍指向舊城市的欄位：${J(Object.fromEntries(oldFields))}（more_places 失敗時這就是持久化狀態；handleGenerateItinerary 的 label 退路、shouldStartNewPlanningSession 的 prevDest 依序讀 travelContext.destination）`, "risk");
  // 生成行程：真實 resolveDestinationAuthority（handleGenerateItinerary L13206 同參數順序）
  const { resolveDestinationAuthority } = M.da;
  const genLabel = left.tripDestination?.formattedName || left.travelContext?.destination || left.tripPlanningContext?.destination || left.preferredArea || "";
  const g0 = googleReqs.length;
  const genDest = await resolveDestinationAuthority(left.tripDestination, genLabel, async (q) => (await env.deps.geocodeLocationFn({ data: { query: q, destinationName: q, locale: "zh-TW", disableLocaleRegionBias: true, placesFallback: false } })).location);
  const genGeocode = googleReqs.slice(g0).filter((g) => g.kind === "geocode").map((g) => g.query);
  INFO(`生成行程目的地解析：label=${J(genLabel)} geocode=${J(genGeocode)} → ${J(genDest ? { city: genDest.city, country: genDest.country, placeId: genDest.placeId } : null)}`);
  expect("E2-confirm-generation-uses-new-city", genDest && /京都/.test(`${genDest.city}${genDest.formattedName}`) && genGeocode.length === 1, `生成行程以新城市解析（多 1 次 geocode 補 placeId／country）`);
  const failDest = await resolveDestinationAuthority(left.tripDestination, genLabel, async () => null);
  expect("E2-confirm-generation-geocode-fail-no-old-city", failDest === undefined, `geocode 失敗時生成行程得到 ${J(failDest?.city ?? null)}（應為 undefined → destination_unresolved，不得退回舊城市）`);
  expect("E2-risk-confirm-switch-resets-trip-destination", renderIdx > 0 && !stillOld,`確認「改成規劃京都」後 tripDestination 仍為 ${J(tripDestAfter?.displayLabel)}（leavePlanningSelection 只清 planningSelection 與已選地點）；handleGenerateItinerary（L${lineOf(SRC.indexOf("const resolvedTripDestination = await resolveDestinationAuthority("))}）以 activeSession.tripDestination 為 resolveDestinationAuthority 第一參數 → 之後生成行程會以台南為目的地、京都推薦為候選`, "risk");
  }
}
// 2d 取消
{
  base = await tainanAfterInitial();
  const { env } = base;
  const before = env.sessionRef.current;
  const ask = await runSend(env, "京都還有其他的嗎");
  const chip = M.crc.chatRuntimeCopy("planningSelectionSwitchCancelChip", "zh-TW", { previous: ask.pending?.previous ?? "" });
  const cancel = await runSend(env, chip);
  const after = env.sessionRef.current;
  P(`  [rt] 取消「${chip}」：stage=${cancel.stage} RPC=${J(cancel.rpcNames)} Places=${cancel.places.length} push=${cancel.pushCalls.length} pending=${J(cancel.pending)} 回覆=${J(cancel.lastMsg.slice(0, 30))}`);
  expect("E2-cancel-keeps-selection-no-credits", cancel.rpcNames.length === 0 && cancel.places.length === 0 && cancel.pushCalls.length === 0 && after.planningSelection?.id === before.planningSelection?.id && J(after.planningSelection) === J(before.planningSelection), "取消：不扣點、不搜尋、selection 原樣保留");
  const lexCancel = await (async () => {
    const b2 = await tainanAfterInitial();
    await runSend(b2.env, "京都還有其他的嗎");
    return runSend(b2.env, "取消");
  })();
  expect("E2-cancel-by-text", lexCancel.stage === "answer" && lexCancel.rpcNames.length === 0 && lexCancel.pushCalls.length === 0, `文字「取消」：stage=${lexCancel.stage} RPC=${J(lexCancel.rpcNames)}`);
  const more = await runSend(env, "再推薦一些");
  expect("E2-after-cancel-continuation-normal", J(more.rpcNames) === J(["credits_check", "credits_reserve", "credits_commit"]) && more.places.length > 0, `取消後「再推薦一些」照常（RPC=${J(more.rpcNames)} Places=${more.places.length}）`);
}
// 2e 詢問後回答其他內容：詢問作廢，本句照一般流程（不殘留）
{
  base = await tainanAfterInitial();
  const { env } = base;
  await runSend(env, "京都還有其他的嗎");
  const other = await runSend(env, "再推薦一些");
  P(`  [rt] 詢問後改說「再推薦一些」：stage=${other.stage} RPC=${J(other.rpcNames)} Places=${other.places.length} pending=${J(other.pending)}`);
  expect("E2-other-answer-drops-question", other.stage === "e2" && !other.pending && J(other.rpcNames) === J(["credits_check", "credits_reserve", "credits_commit"]), "其他回答：詢問作廢（pending=null），本句走原 selection 流程且只扣 1 次");
  // 重新整理：元件 state／ref 重建（pending 只在記憶體）→ 「好」不得被當成確認
  base = await tainanAfterInitial();
  await runSend(base.env, "京都還有其他的嗎");
  const reloaded = makeEnv(M, base.env.sessionRef.current);
  reloaded.setEquivalence(await equivalenceFn(reloaded));
  const ok = await runSend(reloaded, "好");
  P(`  [rt] 詢問後重新整理再回「好」：stage=${ok.stage} RPC=${J(ok.rpcNames)} Places=${ok.places.length} push=${ok.pushCalls.length}`);
  expect("E2-reload-no-residual-charge", ok.rpcNames.length === 0 && ok.places.length === 0 && ok.pushCalls.length === 0 && reloaded.sessionRef.current.planningSelection, "重新整理後詢問消失：「好」不觸發換城市、不扣點、不搜尋，selection 保留");
  expect("E2-question-not-persisted", !J(base.env.persisted).includes("selectionSwitch") && !J(base.env.sessionRef.current).includes("originalUserText"), "換城市詢問未寫入 session（只在記憶體）");
}
// 2f 不可信：句中城市不可信／selection 標籤不可信
{
  for (const [text, cat] of [
    ["亞特蘭提斯市還有其他的嗎", "acc"],
    ["牛牛縣再推薦一些", "acc"],
    ["亞特蘭提斯還有其他的嗎", "risk"],
    ["那霍格華茲再推薦一些", "risk"],
  ]) {
    base = await tainanAfterInitial();
    const sess = base.env.sessionRef.current;
    const a2 = await M.ctd.resolveMorePlacesTurnDestination({ ctx: sess.travelContext ?? { interests: [] }, session: sess, userText: text, locale: "zh-TW", geocodeFn: base.env.deps.geocodeLocationFn });
    base = await tainanAfterInitial();
    const r = await runSend(base.env, text);
    P(`  [rt] 「${text}」：stage=${r.stage} RPC=${J(r.rpcNames)} Places=${r.places.length} queryPrefix=${J([...new Set(r.places.map((c) => c.query.split(" ")[0]))])} pending=${J(r.pending?.destination ?? null)} geocode=${r.google.filter((g) => g.kind === "geocode").length} 回覆=${J(r.lastMsg.slice(0, 24))}；一般 A2 more_places 對同句判定=${J(a2 ?? null)}`);
    expect(`E2-untrusted-named-no-credits-${text}`, r.rpcNames.length === 0 && r.places.length === 0 && !r.pending, `句中指名不可信目的地：不扣點、不搜尋、不詢問（實際 RPC=${J(r.rpcNames)}，搜尋 ${r.places.length} 次舊目的地；A2 more_places 對同句也判定為 ${J(a2 ?? null)}）`, cat);
  }
  M = await freshModules();
  const { session } = planFormSession(M, "台南");
  const forged = { ...session, pendingHandoff: false, planningSelection: { ...session.planningSelection, destinationScope: { name: "亞特蘭提斯市", lat: 10.5, lng: -40.25, radius: 50000, administrativeNames: [] } }, tripDestination: { ...session.tripDestination, city: "亞特蘭提斯市", displayLabel: "亞特蘭提斯市", formattedName: "亞特蘭提斯市", region: undefined } };
  const env = makeEnv(M, forged);
  env.setEquivalence(await equivalenceFn(env));
  const f = await runSend(env, "再推薦一些");
  P(`  [rt] 偽造 selection 標籤「亞特蘭提斯市」＋「再推薦一些」：stage=${f.stage} RPC=${J(f.rpcNames)} Places=${f.places.length}`);
  expect("E2-forged-selection-no-credits", f.rpcNames.length === 0 && f.places.length === 0, "selection 標籤不可信：不扣點、不搜尋");
  const fi = await runE1(M, { ...forged, pendingHandoff: true });
  expect("E1-forged-selection-no-credits", fi.rpcNames.length === 0 && fi.places.length === 0 && fi.lastMsg.includes("亞特蘭提斯市"), `E1 偽造標籤：Credits=${J(fi.rpcNames)} Places=${fi.places.length}`);
}
// 2g Session authority 在閘門期間變更 → 不扣點
{
  base = await tainanAfterInitial();
  base.env.authorityCurrent = false;
  const r = await runSend(base.env, "再推薦一些");
  expect("E2-stale-authority-no-credits", r.rpcNames.length === 0 && r.places.length === 0, `閘門期間 Session 已變更：RPC=${J(r.rpcNames)} Places=${r.places.length}`);
}

// ═════════════════════════ 3. 區域型 Plan form 與上層城市 ═════════════════════════
P("\n══ 3. 區域型 Plan form（context 為上層城市）══");
async function regionCase(name, { ctxDestination, text }) {
  M = await freshModules();
  const { session } = planFormSession(M, name);
  const r1 = await runE1(M, session);
  let s = { ...r1.finalSession, pendingHandoff: false, planHandoffDone: true };
  if (ctxDestination) s = { ...s, travelContext: { ...(s.travelContext ?? { interests: [] }), destination: ctxDestination } };
  const env = makeEnv(M, s);
  env.setEquivalence(await equivalenceFn(env));
  const r = await runSend(env, text);
  return { e1: r1, r, label: M.ps.planningSelectionDestinationLabel(s) };
}
for (const [name, ctxDestination, text] of [
  ["九份(neighborhood)", undefined, "再推薦一些"],
  ["九份(neighborhood)", "新北", "再推薦一些"],
  ["九份(neighborhood)", "台北", "再推薦一些"],
  ["東山區(清水寺)", undefined, "再推薦一些"],
  ["哈修塔特", undefined, "再推薦一些"],
  ["白川村", undefined, "再推薦一些"],
  ["墾丁", undefined, "再推薦一些"],
  ["墾丁", "屏東", "再推薦一些"],
  ["新北", "淡水", "再推薦一些"],
  ["宜蘭", "礁溪", "再推薦一些"],
  ["東山區(清水寺)", "京都府", "再推薦一些"],
  ["信義區", "台北", "再推薦一些"],
  ["信義區(基隆)", undefined, "再推薦一些"],
]) {
  const { e1, r, label } = await regionCase(name, { ctxDestination, text });
  const e1Ok = e1.places.length > 0;
  P(`  [rt] ${name}（標籤 ${J(label)}；context=${J(ctxDestination ?? null)}）E1 Places=${e1.places.length} → 「${text}」stage=${r.stage} RPC=${J(r.rpcNames)} Places=${r.places.length} 詢問=${J(r.pending?.destination ?? null)} gate=${r.gateReason ?? "-"} geocode=${J(r.google.filter((g) => g.kind === "geocode").map((g) => g.query))} 回覆=${J(r.lastMsg.slice(0, 20))}`);
  if (e1Ok) {
    expect(`E2-region-${name}-${ctxDestination ?? "none"}-no-false-switch-question`, !r.pending, `「${text}」不應被誤問換城市（詢問=${J(r.pending?.destination ?? null)}；RPC=${J(r.rpcNames)}）`, ctxDestination ? "risk" : "acc");
  } else {
    INFO(`${name}：E1 已被閘門擋下，E2 結果=${J(r.rpcNames)}／${r.places.length}（無法進一步判定）`);
  }
}
// 上層縣市名稱：說出上層名稱被當同一目的地時，搜尋仍只用 selection 範圍
{
  const { e1, r, label } = await regionCase("九份(neighborhood)", { text: "新北還有其他的嗎" });
  const prefixes = [...new Set(r.places.map((c) => c.query.split(" ")[0]))];
  P(`  [rt] 九份 selection（標籤 ${J(label)}）說「新北還有其他的嗎」：E1 Places=${e1.places.length} stage=${r.stage} RPC=${J(r.rpcNames)} 詢問=${J(r.pending?.destination ?? null)} Places=${r.places.length} queryPrefix=${J(prefixes)}`);
  INFO(`上層縣市「新北」被視為與 selection 同一目的地＝${!r.pending}；實際搜尋前綴=${J(prefixes)}（使用者若想換到新北其他區，不會被詢問）`);
  for (const [name, said] of [["東山區(清水寺)", "京都府還有其他的嗎"], ["宜蘭", "宜蘭縣還有其他的嗎"], ["新北", "台北還有其他的嗎"]]) {
    const c = await regionCase(name, { text: said });
    const pf = [...new Set(c.r.places.map((x) => x.query.split(" ")[0]))];
    P(`  [rt] ${name} selection（標籤 ${J(c.label)}）說「${said}」：stage=${c.r.stage} RPC=${J(c.r.rpcNames)} 詢問=${J(c.r.pending?.destination ?? null)} Places=${c.r.places.length} queryPrefix=${J(pf)}`);
  }
  // #PL-FIX-T2：句中指名 selection 城市內的子區域（同城市，不是另一城市）→ 不應問「換城市」
  for (const [name, said] of [["台南", "安平還有其他的嗎"], ["新北", "淡水還有其他的嗎"], ["宜蘭", "礁溪還有其他的嗎"], ["信義區(基隆)", "基隆還有其他的嗎"]]) {
    const c = await regionCase(name, { text: said });
    const pf = [...new Set(c.r.places.map((x) => x.query.split(" ")[0]))];
    P(`  [rt] ${name} selection（標籤 ${J(c.label)}）說「${said}」：stage=${c.r.stage} RPC=${J(c.r.rpcNames)} 詢問=${J(c.r.pending?.destination ?? null)} gate=${c.r.gateReason ?? "-"} Places=${c.r.places.length} queryPrefix=${J(pf)} 回覆=${J(c.r.lastMsg.slice(0, 24))}`);
    expect(`E2-risk-subarea-${name}-${said}-no-switch-question`, !c.r.pending, `同城市子區域／上層城市被問「換城市」：詢問=${J(c.r.pending?.destination ?? null)}`, "risk");
  }
}

// ═════════════════════════ 4. E4 加入地點（真實 onAddToTrip）═════════════════════════
P("\n══ 4. E4 加入地點（真實 onAddToTrip 本體）══");
{
  base = await tainanAfterInitial();
  const { env } = base;
  const shown = base.initial.env.msgs.at(-1)?.roamie?.recommendations ?? [];
  const add = await runE4(env, shown[0]);
  expect("E4-shown-card-accepted", add.changed && env.sessionRef.current.planningSelection.selectedPlaceIds.length === 1, `本次 selection 推薦過的卡片可加入（selected=${env.sessionRef.current.planningSelection.selectedPlaceIds.length}）`);
  const kyotoCard = { id: "ChIJkyoto-card", googlePlaceId: "ChIJkyoto-card", placeId: "ChIJkyoto-card", name: "京都示意寺", address: "日本京都府京都市", lat: 35.01, lng: 135.77, rating: 4.6, reason: "x" };
  const rej = await runE4(env, kyotoCard);
  const prepared = M.ps.preparePlanningSelectionForGenerate(env.sessionRef.current);
  P(`  [rt] 京都卡片：changed=${rej.changed} toast=${J(rej.toast.map((t) => t[0]))} requiredPlaces=${J(prepared.requiredPlaces.map((p) => p.name))}`);
  expect("E4-cross-city-card-rejected", !rej.changed && rej.toast.length === 1 && String(rej.toast[0][0]).includes("不屬於這次的規劃選點") && !prepared.requiredPlaces.some((p) => p.name === "京都示意寺"), "其他城市卡片被拒並提示，不成為生成行程的必去錨點");
  const remove = await runE4(env, shown[0]);
  expect("E4-selected-card-removable", remove.changed && env.sessionRef.current.planningSelection.selectedPlaceIds.length === 0, "已選卡片可取消");
  // 同 id 但不同欄位（只有 placeId）
  const viaPlaceId = await runE4(env, shown[1] && { ...shown[1], id: undefined, googlePlaceId: undefined, placeId: shown[1].googlePlaceId ?? shown[1].id });
  INFO(`只帶 placeId 的同一張卡：changed=${viaPlaceId.changed}`);
  // 直接呼叫 lib（第二道檢查）
  const direct = M.ps.togglePlanningSelectionPlace(env.sessionRef.current, M.cs.roamieRecToChatItem(kyotoCard));
  expect("E4-lib-second-gate", direct === env.sessionRef.current, "togglePlanningSelectionPlace 本身也拒絕不在範圍內的卡片");
  // 生成鎖期間：E4 被鎖擋下（真實 chat-generation-lock）
  M.lock.beginChatGenerationLock("plg-test");
  const locked = await runE4(env, shown[2]);
  M.lock.endChatGenerationLock("plg-test");
  expect("E4-generation-lock-blocks", !locked.changed, `生成鎖期間加入地點被擋下（changed=${locked.changed}）`);
}

// ═════════════════════════ 5. 靜態：生成鎖、入口順序、不新增其他付費呼叫 ═════════════════════════
P("\n══ 5. 靜態：生成鎖／順序／付費呼叫種類 ══");
{
  const sendS = SRC.indexOf("  const send = async (");
  const lockIdx = SRC.indexOf("if (isChatGenerationLocked()) return;", sendS);
  expect("S-send-lock-before-answer-and-e2", lockIdx > sendS && lockIdx < BLOCKS.answer.s && BLOCKS.answer.s < BLOCKS.e2.s, `send() 的生成鎖 return（L${lineOf(lockIdx)}）在換城市回答（L${lineOf(BLOCKS.answer.s)}）與 E2（L${lineOf(BLOCKS.e2.s)}）之前`);
  const hydrate = SRC.indexOf("const generationLocked = isChatGenerationLocked();");
  const planHandoff = SRC.indexOf("await runPlanFormHandoff(current);");
  expect("S-e1-skipped-when-locked", hydrate > 0 && /!planHandoffStartedRef\.current &&\s*!generationLocked/.test(SRC.slice(hydrate, planHandoff)), "E1 只在未上鎖時由 hydrate 觸發（既有條件未變）");
  const forbidden = /fetchRoamieAI|streamRoamieAI|generateItinerary|computeRoutes|realtime|openai/i;
  for (const k of ["e1", "answer", "e2"]) {
    const body = k === "e1" ? BLOCKS.e1.code : BLOCKS[k].code;
    expect(`S-${k}-no-new-ai-routes-realtime`, !forbidden.test(body), `${k} 區塊不含 OpenAI／Routes／Realtime 呼叫`);
  }
  const e2 = BLOCKS.e2.code;
  const iGate = e2.indexOf("await resolveTrustedRecommendationSearchScope(");
  const iAsk = e2.indexOf("setSelectionSwitchPending(");
  const iCredit = e2.indexOf("await beginPlaceRecommendationCredits(");
  const iFetch = e2.indexOf("await fetchPlanningSelectionRecommendations(");
  expect("S-e2-order", iGate > 0 && iGate < iAsk && iAsk < iCredit && iCredit < iFetch, "E2：閘門 → 換城市詢問 → Credits → Places");
  const e1 = BLOCKS.e1.code;
  expect("S-e1-order", e1.indexOf("await resolveTrustedRecommendationSearchScope(") > 0 && e1.indexOf("await resolveTrustedRecommendationSearchScope(") < e1.indexOf("await beginPlaceRecommendationCredits(") && e1.indexOf("await beginPlaceRecommendationCredits(") < e1.indexOf("await fetchPlanningSelectionRecommendations("), "E1：閘門 → Credits → Places");
  const e1NoHints = !/placeId|lat:|lng:/.test(e1.slice(e1.indexOf("await resolveTrustedRecommendationSearchScope("), e1.indexOf("await beginPlaceRecommendationCredits(")));
  INFO(`E1 閘門呼叫是否只傳標籤（無 placeId／座標提示）=${e1NoHints}`);
  const answer = BLOCKS.answer.code;
  expect("S-answer-confirm-no-own-credits", !answer.includes("beginPlaceRecommendationCredits") && !answer.includes("fetchPlanningSelectionRecommendations"), "換城市回答區塊本身不預扣、不呼叫 selection 搜尋（確認後只由 more_places 扣 1 次）");
  const inflight = e2.indexOf("selectionRecommendationInFlightRef.current = true");
  expect("S-e2-inflight-before-gate", inflight > 0 && inflight < iGate, "E2 重入保護在閘門（第一個 await）之前設定");
  const confirmStreaming = answer.indexOf("setStreaming(true)");
  const confirmPush = answer.indexOf("await pushMorePlaceRecommendations(");
  INFO(`確認分支：setStreaming(true) idx=${confirmStreaming} < pushMorePlaceRecommendations idx=${confirmPush}；確認分支本身沒有 selectionRecommendationInFlightRef／streaming 早退檢查（重入只靠 React streaming state 與 send() 開頭的既有檢查）`);
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const acc = rows.filter((r) => r.cat === "acc");
const risk = rows.filter((r) => r.cat === "risk");
P(`\n[acc] PASS=${acc.filter((r) => r.ok).length}/${acc.length}${acc.some((r) => !r.ok) ? `（FAIL：${acc.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}；[risk] 問題存在（FAIL）=${risk.filter((r) => !r.ok).length}/${risk.length}${risk.some((r) => !r.ok) ? `（${risk.filter((r) => !r.ok).map((r) => r.id).join(", ")}）` : ""}`);
P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
const bad = external > 0 || acc.some((r) => !r.ok);
P(`verify-planner-selection-gate-realpath: ${bad ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(bad ? 1 : 0);
