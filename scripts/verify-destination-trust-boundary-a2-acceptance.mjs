#!/usr/bin/env node
/**
 * A2-T2 — Destination Trust Boundary Step A2 獨立驗收（tester；離線 Mock）。
 * 補足 verify-destination-trust-boundary-a2-contract.mjs 未覆蓋的「施工後」路徑：
 *   - Builder 帶入 trustedCenter 後的實際搜尋中心／半徑／Weather（不是舊路徑鏡像）
 *   - R4 destination_category Builder 自行 geocode（含 scope lock 被清除後）
 *   - R5「推薦其他地方」可信判定失敗 → send() GPS Nearby fallback
 *   - 里斯本／波爾圖／金澤 Provider 驗證：證據欄位逐項負向、並發去重、快取、15 秒冷卻
 *   - R2 retainedTripDestinationLabels、R3 香港跑馬地 Authority／scope 一致性
 *   - 「推薦其他地方」Credits 鏡像（真實 credits/operations.ts＋supabase.rpc 記錄）
 * 判讀：
 *   [acc]    驗收斷言（A2 契約）。FAIL → exit 1。
 *   [probe]  問題探測。PASS＝問題已重現（屬發現，記錄於報告；不影響 exit code）。
 *   INFO     數字紀錄。
 * 外部網路全部攔截（fetch／http／https／net），任一次即 FAIL；只用 Mock Key；不寫任何檔案。
 * 執行：node scripts/verify-destination-trust-boundary-a2-acceptance.mjs
 */
import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
for (const k of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER|CREDITS/i.test(k)) delete process.env[k];
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

globalThis.__A2A_ALS = new AsyncLocalStorage();
globalThis.__A2A_RPC_SEQ = 0;
const STUBS = {
  "@tanstack/react-start": `
    export const createServerFn = () => {
      const b = {
        middleware(list) { b.mw = list; return b; },
        inputValidator(fn) { b.v = fn; return b; },
        handler(fn) { return async (args) => { const id = ++globalThis.__A2A_RPC_SEQ; return globalThis.__A2A_ALS.run(id, () => fn({ data: b.v ? b.v(args?.data) : args?.data, context: {} })); }; },
      };
      return b;
    };
    export const createMiddleware = () => { const m = { server() { return m; }, client() { return m; }, middleware() { return m; } }; return m; };
  `,
  "@/lib/google-rate-limit.server": `export const requireGoogleProviderRate = {};`,
  "@/lib/public-read-auth": `export const allowGuestPublicRead = {};`,
  "@/lib/google-rest-transport": `
    export function getGoogleRestTransportToken() { return "roamie-server-proxy"; }
    export async function googleRestFetch(input, init, context) { return globalThis.__A2A_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return false; }`,
  "@/integrations/supabase/client": `
    const any = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : any()), apply: () => any() });
    export const supabase = new Proxy({}, { get(_t, p) {
      if (p === "rpc") return async (name, args) => globalThis.__A2A_RPC(name, args);
      if (p === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
      return any();
    } });
  `,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a2a-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "a2a-transport-stubs",
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
  ctd: "lib/ai/chat-turn-destination.ts",
  dpr: "lib/ai/destination-place-recommendation.ts",
  cdcr: "lib/ai/chat-destination-category-recommendation.ts",
  dg: "lib/ai/destination-geocode.ts",
  rd: "lib/ai/destination-resolution.ts",
  rds: "lib/ai/resolved-destination-scope.ts",
  lf: "lib/location.functions.ts",
  crr: "lib/ai/chat-recommendation-refresh.ts",
  crc: "lib/chat-runtime-copy.ts",
  tc: "lib/ai/travel-context.ts",
  mvp: "lib/ai/must-visit-places.ts",
  tpc: "lib/ai/trip-planning-context.ts",
  ccs: "lib/ai/chat-conversation-state.ts",
  cdr: "lib/chat-display-recommendations.ts",
  cpsc: "lib/ai/chat-place-search-context.ts",
  rss: "lib/ai/recommendation-search-scope.ts",
  cpr: "lib/ai/chat-place-recommendation.ts",
  ci: "lib/ai/chat-intent.ts",
  rcl: "lib/ai/resolve-chat-location.ts",
  nlc: "lib/ai/nearby-location-clarification.ts",
  rre: "lib/ai/recommendation-refinement/execute.ts",
  crs: "lib/ai/conversation-recommendation-session.ts",
  cop: "lib/credits/operations.ts",
  cff: "lib/credits/feature-flag.ts",
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
  return M;
}

// ════ Mock Google（逐筆計數）════
const ZERO = { status: "ZERO_RESULTS", results: [] };
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const gres = ({ pid, fa, lat, lng, types, comps }) => ({ address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE", viewport: { northeast: { lat: lat + 0.1, lng: lng + 0.1 }, southwest: { lat: lat - 0.1, lng: lng - 0.1 } } }, place_id: pid, types });
const JP = comp("日本", "JP", ["country", "political"]);
const TW = comp("台灣", "TW", ["country", "political"]);
const PT = comp("葡萄牙", "PT", ["country", "political"]);
const CITY = {
  京都: { lat: 35.0116, lng: 135.7681 },
  大阪: { lat: 34.6937, lng: 135.5023 },
  西屯: { lat: 24.1814, lng: 120.617 },
  跑馬地: { lat: 22.2696, lng: 114.1832 },
  里斯本: { lat: 38.7223, lng: -9.1393 },
  波爾圖: { lat: 41.1579, lng: -8.6291 },
  金澤: { lat: 36.5613, lng: 136.6562 },
};
const GEO = {
  京都: gres({ pid: "mock-pid-kyoto-city", fa: "日本京都府京都市", ...CITY.京都, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP] }),
  大阪: gres({ pid: "mock-pid-osaka-city", fa: "日本大阪府大阪市", ...CITY.大阪, types: ["locality", "political"], comps: [comp("大阪市", "大阪市", ["locality", "political"]), comp("大阪府", "大阪府", ["administrative_area_level_1", "political"]), JP] }),
  西屯: gres({ pid: "mock-pid-taichung-xitun", fa: "台灣台中市西屯區", ...CITY.西屯, types: ["administrative_area_level_2", "political"], comps: [comp("西屯區", "西屯區", ["administrative_area_level_2", "political"]), comp("台中市", "台中市", ["administrative_area_level_1", "political"]), TW] }),
  跑馬地: gres({ pid: "mock-pid-hk-happy-valley", fa: "香港跑馬地", ...CITY.跑馬地, types: ["neighborhood", "political"], comps: [comp("跑馬地", "跑馬地", ["neighborhood", "political"]), comp("灣仔區", "灣仔區", ["administrative_area_level_1", "political"]), comp("香港", "HK", ["country", "political"])] }),
  里斯本: gres({ pid: "mock-pid-lisbon", fa: "葡萄牙里斯本", ...CITY.里斯本, types: ["locality", "political"], comps: [comp("里斯本", "Lisboa", ["locality", "political"]), comp("里斯本區", "里斯本區", ["administrative_area_level_1", "political"]), PT] }),
  波爾圖: gres({ pid: "mock-pid-porto", fa: "葡萄牙波爾圖", ...CITY.波爾圖, types: ["locality", "political"], comps: [comp("波爾圖", "Porto", ["locality", "political"]), comp("波爾圖區", "波爾圖區", ["administrative_area_level_1", "political"]), PT] }),
  金澤: gres({ pid: "mock-pid-kanazawa", fa: "日本石川縣金澤市", ...CITY.金澤, types: ["locality", "political"], comps: [comp("金澤市", "金沢市", ["locality", "political"]), comp("石川縣", "石川県", ["administrative_area_level_1", "political"]), JP] }),
};
/** G.mode: ok｜zero｜timeout｜null；G.over: { 標籤: 取代的 geocode result（或 "zero"）} */
let G = { mode: "ok", over: {} };
const geoFor = (q) => {
  const s = String(q ?? "");
  for (const [k, v] of Object.entries(G.over ?? {})) if (s.includes(k)) return v === "zero" ? ZERO : { status: "OK", results: [v] };
  for (const [k, v] of Object.entries(GEO)) if (s.includes(k) || (k === "金澤" && /金沢|Kanazawa/i.test(s)) || (k === "里斯本" && /Lisbo/i.test(s)) || (k === "波爾圖" && /Porto/i.test(s))) return { status: "OK", results: [v] };
  return null;
};
const reqs = [];
globalThis.__A2A_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const query = url.searchParams.get("address") ?? body?.input ?? body?.textQuery;
  reqs.push({ kind, rpc: globalThis.__A2A_ALS.getStore() ?? 0, query });
  if (kind === "places") return Response.json({ places: [] });
  if (G.mode === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (G.mode === "null") return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  if (kind === "geocode") return Response.json((G.mode === "ok" && geoFor(query)) || ZERO);
  if (kind === "autocomplete") return Response.json({ suggestions: [] });
  return Response.json({});
};
const countOf = (list) => ({ geocode: list.filter((r) => r.kind === "geocode").length, autocomplete: list.filter((r) => r.kind === "autocomplete").length, details: list.filter((r) => r.kind === "details").length, places: list.filter((r) => r.kind === "places").length });
const gTotal = (c) => c.geocode + c.autocomplete + c.details + c.places;
const fc = (c) => `geocode=${c.geocode} autocomplete=${c.autocomplete} details=${c.details} GooglePlaces=${c.places}`;

// ════ Places／Weather（Builder 層 PlaceSearchFn Mock；逐筆記錄中心、半徑、查詢字串）════
let placeCalls = [];
let weatherCalls = [];
let placeSeq = 0;
let placesMode = "ok";
const mockSearchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng, radius: data.radius, destinationName: data.destinationName });
  if (placesMode === "empty") return { places: [], error: null, rawCount: 0 };
  if (placesMode === "throw") throw new Error("mock places failure");
  const base = { lat: Number.isFinite(data.lat) && data.lat !== 0 ? data.lat : 0.5, lng: Number.isFinite(data.lng) && data.lng !== 0 ? data.lng : 0.5 };
  const places = [0, 1, 2].map((i) => {
    placeSeq += 1;
    return { id: `ChIJmock${placeSeq}`, name: `示意地點${placeSeq}`, address: `${data.destinationName ?? ""} 示意地址${placeSeq}`, formattedAddress: `${data.destinationName ?? ""} 示意地址${placeSeq}`, lat: base.lat + 0.001 * (i + 1), lng: base.lng + 0.001 * (i + 1), rating: 4.5, userRatingCount: 500, types: data.includedTypes?.length ? [data.includedTypes[0], "point_of_interest"] : ["restaurant", "food", "point_of_interest"], primaryType: data.includedTypes?.[0] ?? "restaurant", businessStatus: "OPERATIONAL" };
  });
  return { places, error: null, rawCount: places.length };
};
const mockWeather = async ({ data }) => {
  weatherCalls.push({ lat: data.lat, lng: data.lng });
  return null;
};

// ════ Credits RPC 記錄 ════
let rpcLog = [];
let ledgerSeq = 0;
globalThis.__A2A_RPC = async (name, args) => {
  rpcLog.push({ name, args });
  if (name === "credits_check") return { data: { ok: true, usable_credits: 20 }, error: null };
  if (name === "credits_reserve") return { data: { ok: true, ledger_id: `mock-ledger-${++ledgerSeq}`, status: "reserved" }, error: null };
  if (name === "credits_commit") return { data: { ok: true, status: "committed" }, error: null };
  if (name === "credits_rollback") return { data: { ok: true, status: "rolled_back" }, error: null };
  return { data: null, error: null };
};

// ════ 斷言 ════
const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
const J = (v) => JSON.stringify(v);
function expect(id, cond, detail, cat = "acc") {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
  return !!cond;
}
const info = (s) => P(`  INFO ${s}`);
const crash = (e) => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}\nexternal=${external}\nverify-destination-trust-boundary-a2-acceptance: FAIL\n`);
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
async function safe(fn) {
  try {
    return { v: await fn(), e: null };
  } catch (e) {
    return { v: undefined, e: String(e?.message ?? e).split("\n")[0] };
  }
}
const pt = (c) => (c ? `(${c.lat},${c.lng})` : "∅");
const near = (c, ref, km = 40) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.hypot((c.lat - ref.lat) * 111, (c.lng - ref.lng) * 111 * Math.cos((ref.lat * Math.PI) / 180)) <= km;
const centersOf = (list) => [...new Set(list.map((c) => `${c.lat},${c.lng}${c.radius != null ? `,r=${c.radius}` : ""}`))].slice(0, 4);
const FORGED = "亞特蘭提斯市";
const FAKE_C = { lat: 1.2345, lng: 103.8 };
const nowIso = new Date().toISOString();
const baseSession = (extra = {}) => ({ phase: "recommend", messages: [], recommendedPlaces: [], selectedPlaces: [], ...extra });
const recSnap = (extra) => ({ sessionId: `rec-${Math.random().toString(36).slice(2, 8)}`, destination: "京都", topic: "restaurant", pool: [], cursor: 0, returnedPlaceIds: [], returnedCanonicalKeys: [], usedQueries: ["q1"], nextQueryCursor: 1, recommendationPage: 1, exhausted: false, createdAt: nowIso, updatedAt: nowIso, ...extra });
const arc = (dest, c, extra = {}) => ({ destinationName: dest, intent: "restaurant", ...(c ? { latitude: c.lat, longitude: c.lng } : {}), previousPlaceIds: [], previousCanonicalKeys: [], currentResultPlaceIds: [], usedQueries: [], createdAt: Date.now(), updatedAt: Date.now(), ...extra });
const CHAT_SRC = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
const lineOf = (idx) => CHAT_SRC.slice(0, idx).split("\n").length;

let M = await freshModules();
if (M.__loadErr) info(`模組載入錯誤：${J(M.__loadErr)}`);
const geocodeFn = async (args) => M.lf.geocodeTripLocationFromText(args);
const scopeOf = (label, session = baseSession(), ctx) => M.ctd.resolveTrustedRecommendationSearchScope({ label, ctx: ctx ?? session.travelContext ?? { interests: [] }, session, locale: "zh-TW", geocodeFn });
const scopeStr = (s) => (s ? `${s.status}${s.destination ? `/${s.destination}` : ""}${s.center ? ` center=${pt(s.center)}` : ""}${s.centerSource ? ` src=${s.centerSource}` : ""}${s.reason ? ` reason=${s.reason}` : ""}` : "∅");
async function measured(fn) {
  const r0 = reqs.length;
  const p0 = placeCalls.length;
  const w0 = weatherCalls.length;
  const res = await safe(fn);
  const list = reqs.slice(r0);
  return { ...res, c: countOf(list), queries: list.map((r) => r.query), places: placeCalls.slice(p0), weather: weatherCalls.slice(w0) };
}

// ═══════════════ R5：「推薦其他地方」不可信 → send() GPS Nearby fallback ═══════════════
P("══ R5. 「推薦其他地方」可信判定失敗後 send() L9449-9475 GPS Nearby fallback ══");
const NO_MORE = M.crc.chatRuntimeCopy("noMore", "zh-TW");
const ALT_MSGS = [
  { role: "user", content: "推薦餐廳" },
  { role: "assistant", content: "好的，推薦給你：" },
  { role: "user", content: "還有嗎" },
  { role: "assistant", content: NO_MORE },
];
/** send() L9421-9475 + pushAlternativeDestinationPlaceRecommendation L6535-6562 + pushNearbyPlaceRecommendation L3392-3755（非 placeDetail、無 authoritativeCenter）＋ 真實 buildNearbyPlaceRecommendation */
async function runAltWithFallback(session, { mode = "zero" } = {}) {
  M = await freshModules();
  G = { mode, over: {} };
  placesMode = "ok";
  const USER = "好";
  return measured(async () => {
    const accept = M.crr.shouldAcceptAlternativeRecommendations(ALT_MSGS, USER);
    let next = M.ccs.prepareSessionForUserTurn(session, NO_MORE);
    const merged = M.tc.mergeTravelContext(next, USER, NO_MORE);
    next = M.tpc.mergeTripPlanningContext(USER, merged.session, merged.context).session;
    const altCtx = { ...(next.travelContext ?? merged.context), tripPurpose: "alternative_recommendations", setting: "混合" };
    next = { ...next, travelContext: altCtx };
    const dest = altCtx.destination?.trim() ?? next.tripPlanningContext?.destination?.trim() ?? next.tripDestination?.city?.trim();
    const r = { accept, dest, altScope: null, fallback: false };
    if (!accept) return r;
    if (dest) {
      const activeSession = { ...next, travelContext: { ...altCtx, destination: dest } };
      const m2 = M.tc.mergeTravelContext(activeSession, USER);
      const placeCtx = M.mvp.mergeContextForPlaceFetch(m2.context, activeSession);
      r.altScope = await M.ctd.resolveTrustedRecommendationSearchScope({ label: dest.trim(), ctx: placeCtx, session: m2.session, locale: "zh-TW", geocodeFn });
      if (r.altScope.status === "trusted") return r;
    }
    r.googleBeforeFallback = reqs.length;
    next = await M.rcl.resolveChatLocation(next);
    r.hasLocation = M.ci.sessionHasLocation(next);
    if (!r.hasLocation) return r;
    r.fallback = true;
    // pushNearbyPlaceRecommendation（intent=restaurant；第一個 nearbyIntent）
    const act = { ...next, travelContext: altCtx };
    const mergedN = M.tc.mergeTravelContext(act, USER);
    const shouldResolveCurrentLocation = M.rss.isExplicitDeviceNearbyRequest(USER) || M.nlc.shouldResolveNearbyCurrentLocation({ userText: USER, structuredShortcut: false });
    const deviceSession = mergedN.session;
    const searchCtx = await M.cpsc.resolveChatPlaceSearchContext({ context: mergedN.context, session: deviceSession, userText: USER, locale: "zh-TW", geocodeFn, deviceLatLng: shouldResolveCurrentLocation && deviceSession.location ? { lat: deviceSession.location.lat, lng: deviceSession.location.lng } : null });
    const searchCenter = M.rss.resolveRecommendationSearchCenter({ userText: USER, session: deviceSession, context: mergedN.context, destinationLatLng: searchCtx.destinationLatLng, destinationName: searchCtx.destinationName, deviceLatLng: deviceSession.location ? { lat: deviceSession.location.lat, lng: deviceSession.location.lng } : null });
    let lat;
    let lng;
    let label;
    if (searchCenter) {
      if (searchCtx.searchMode === "destination" && searchCenter.deviceLocationUsed) {
        if (searchCtx.destinationLatLng) ({ lat, lng } = searchCtx.destinationLatLng);
      } else {
        lat = searchCenter.latitude;
        lng = searchCenter.longitude;
        label = searchCenter.label ?? searchCenter.destination;
        if (searchCenter.mode === "destination") {
          searchCtx.searchMode = "destination";
          searchCtx.destinationName = searchCenter.destination ?? searchCtx.destinationName;
          searchCtx.destinationLatLng = { lat, lng };
        }
      }
    } else if (searchCtx.searchMode === "destination") {
      if (searchCtx.destinationLatLng) ({ lat, lng } = searchCtx.destinationLatLng);
      else if (searchCtx.textOnlyDestinationSearch) {
        lat = 0;
        lng = 0;
      }
      label = searchCtx.destinationName;
    }
    r.searchMode = searchCtx.searchMode;
    r.searchDestination = searchCtx.destinationName ?? null;
    r.center = lat != null ? { lat, lng } : null;
    r.centerSource = searchCenter?.source ?? (searchCtx.textOnlyDestinationSearch ? "text_only" : null);
    if (lat == null || lng == null) return r;
    const check = M.rss.assertDestinationRequestNotUsingGps({ searchMode: searchCtx.searchMode === "destination" ? "destination" : "current_location", center: { latitude: lat, longitude: lng }, centerSource: searchCtx.searchMode === "destination" ? "destination_anchor" : "gps", destination: searchCtx.destinationName, category: "restaurant", radiusMeters: 1500 });
    r.requestCheck = check.ok;
    if (!check.ok) return r;
    r.creditsWouldBegin = true; // L3839 beginPlaceRecommendationCredits（path: nearby）在此之後、Builder 之前
    const built = await M.cpr.buildNearbyPlaceRecommendation({ intent: "restaurant", lat, lng, locale: "zh-TW", context: mergedN.context, searchPlaces: mockSearchPlaces, excludePlaceIds: [], rejectedPlaceNames: [], priorRecommended: [], blockedCoreNames: [], userText: USER, cityLabel: label ?? next.location?.city ?? altCtx.destination ?? next.tripDestination?.city, searchContext: searchCtx, hasPlusAccess: false });
    r.recs = built.recommendations?.length ?? 0;
    r.persistDestination = mergedN.context.destination ?? null;
    return r;
  });
}
const GPS = { lat: 25.033, lng: 121.5654, city: "台北市" };
const r5Cases = [
  ["R5-a", "偽造 travelContext.destination＋快照 searchCentroid（裝置有 GPS）", baseSession({ location: GPS, activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, searchCentroid: { ...FAKE_C }, exhausted: true }) })],
  ["R5-b", "偽造 travelContext.destination（無快照中心；裝置有 GPS）", baseSession({ location: GPS, activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, exhausted: true }) })],
  ["R5-c", "偽造 tripDestination 完整形狀（裝置有 GPS）", baseSession({ location: GPS, tripDestination: { placeId: "forged-pid", country: "日本", city: FORGED, displayLabel: FORGED, formattedName: FORGED, lat: 33.3, lng: 133.3 } })],
];
const R5 = {};
for (const [id, name, sess] of r5Cases) {
  const r = await runAltWithFallback(sess, { mode: "zero" });
  const v = r.v ?? {};
  R5[id] = r;
  const forgedQ = r.queries.filter((q) => String(q ?? "").includes("亞特蘭提斯"));
  const forgedPlaces = r.places.filter((c) => String(c.query ?? "").includes("亞特蘭提斯") || String(c.destinationName ?? "").includes("亞特蘭提斯"));
  P(`  [mirror+rt] ${id} ${name}：accept=${v.accept} dest=${J(v.dest ?? null)} altScope=${scopeStr(v.altScope)} fallback=${v.fallback} searchMode=${v.searchMode ?? "-"} searchDestination=${J(v.searchDestination ?? null)} center=${pt(v.center)} src=${v.centerSource ?? "-"} requestCheck=${v.requestCheck ?? "-"} creditsWouldBegin=${v.creditsWouldBegin ?? false} recs=${v.recs ?? 0} ${fc(r.c)} 偽造字串 Provider 查詢=${forgedQ.length} Places=${r.places.length}（含偽造標籤 ${forgedPlaces.length}） centers=${J(centersOf(r.places))}${r.e ? ` err=${r.e}` : ""}`);
  expect(`${id}-alt-scope-unavailable`, v.altScope?.status === "unavailable", `alt callback 內 scope=${scopeStr(v.altScope)}`);
  expect(`${id}-probe-fallback-searches-forged`, v.fallback && r.places.length > 0, `Nearby fallback 仍以未確認標籤 ${J(v.searchDestination)} 搜尋：Places ${r.places.length} 次、中心 ${pt(v.center)}（${v.centerSource}）、Credits(nearby) 會先 begin=${v.creditsWouldBegin ?? false}；偽造字串送 Provider ${forgedQ.length} 次`, "probe");
}

// ═══════════════ R4：destination_category Builder 自行 geocode ═══════════════
P("\n══ R4. destination_category Builder（chat-destination-category-recommendation.ts）══");
async function runCategory({ label, userText, session, before }) {
  return measured(async () => {
    if (before) await before();
    const sc = await scopeOf(label, session);
    if (sc.status !== "trusted") return { sc };
    const g0 = reqs.length;
    const built = await M.cdcr.buildDestinationCategoryRecommendations({ destination: sc.destination, intents: ["restaurant"], userText, context: { ...(session.travelContext ?? { interests: [] }), destination: sc.destination }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, excludePlaceIds: [], rejectedPlaceNames: [], session: M.ctd.stripClientSearchScope(session) });
    return { sc, builderGoogle: countOf(reqs.slice(g0)), recs: built.recommendations.length, snapshotCentroid: built.searchCentroid ?? null };
  });
}
{
  const forgedSess = (city) => baseSession({ travelContext: { interests: [], destination: city }, recommendationSession: recSnap({ destination: city, searchCentroid: { ...FAKE_C }, searchRadius: 90000, activeSearchCity: "大阪" }), activeRecommendationContext: arc(city, FAKE_C, { radius: 90000 }) });
  for (const city of ["京都", "里斯本"]) {
    M = await freshModules();
    G = { mode: "ok", over: {} };
    placeCalls = [];
    const r = await runCategory({ label: city, userText: `${city}美食`, session: forgedSess(city) });
    const v = r.v ?? {};
    P(`  [rt] R4 ${city}（快照偽造中心 ${pt(FAKE_C)} r=90000）：scope=${scopeStr(v.sc)} Builder Google=${v.builderGoogle ? fc(v.builderGoogle) : "-"} Places=${r.places.length} centers=${J(centersOf(r.places))} recs=${v.recs ?? 0}${r.e ? ` err=${r.e}` : ""}`);
    expect(`R4-${city}-no-snapshot-center-no-zero`, v.sc?.status === "trusted" && r.places.every((c) => near({ lat: c.lat, lng: c.lng }, v.sc.center, 1)) && v.builderGoogle && gTotal(v.builderGoogle) === 0, `Places 中心＝可信中心 ${pt(v.sc?.center)}（不取快照 ${pt(FAKE_C)}、無 (0,0)）、Builder 新增 Google=0`);
    if (city === "京都") expect("R4-京都-delivers", r.places.length > 0 && v.recs > 0, `京都 Places=${r.places.length} recs=${v.recs}`);
    else info(`R4 ${city}：Places=${r.places.length}（Builder L664-702 evaluateDestinationScopeGate→canDiscoverDestinationPlaces 對未列表城市擋下；施工前即同，見 a2-contract SEC-11「里斯本 destination_places 現行就是 0 筆」；呼叫端 L5886 0 張→settle(false) 退款）`);
  }
  // 里斯本 → 波爾圖 → 里斯本：travel-context.ts L600-602 換城市時 clearResolvedDestinationScope(舊城市)；
  // providerTrustedCenters（ctd 模組內）仍保留里斯本 → scope=provider_locked，但 Builder 的 scope lock 已不在。
  M = await freshModules();
  G = { mode: "ok", over: {} };
  placeCalls = [];
  await scopeOf("里斯本", baseSession());
  const lockBefore = M.rds.getResolvedDestinationScope("里斯本");
  for (const [mode, tag] of [["ok", "Provider 正常"], ["timeout", "Provider timeout"]]) {
    const r = await runCategory({ label: "里斯本", userText: "里斯本美食", session: forgedSess("里斯本"), before: async () => { M.rds.clearResolvedDestinationScope("里斯本"); G = { mode, over: {} }; } });
    const v = r.v ?? {};
    const zero = r.places.some((c) => c.lat === 0 && c.lng === 0);
    P(`  [rt] R4 里斯本 scope lock 清除後（${tag}）：lock 原本=${lockBefore ? pt({ lat: lockBefore.latitude, lng: lockBefore.longitude }) : "∅"} scope=${scopeStr(v.sc)} Builder Google=${v.builderGoogle ? fc(v.builderGoogle) : "-"} Places=${r.places.length} centers=${J(centersOf(r.places))} recs=${v.recs ?? 0}${r.e ? ` err=${r.e}` : ""}`);
    expect(`R4-lisbon-lock-cleared-${mode}-no-second-geocode`, v.sc?.status === "trusted" && v.builderGoogle && gTotal(v.builderGoogle) === 0, `可信 scope 已有中心時 Builder 不得再 geocode（每候選最多 1 次 Google）；實際 Builder Google=${v.builderGoogle ? gTotal(v.builderGoogle) : "-"}`);
    expect(`R4-lisbon-lock-cleared-${mode}-center-trusted-not-zero`, r.places.length === 0 || (!zero && r.places.every((c) => near({ lat: c.lat, lng: c.lng }, CITY.里斯本, 1))), `Places 中心須為可信中心、不得 (0,0)；實際 ${J(centersOf(r.places))}`);
  }
}

// ═══════════════ 4／5：Builder 帶 trustedCenter 後的中心、半徑、Shopping、Weather ═══════════════
P("\n══ 4／5. 偽造搜尋中心與半徑；Shopping／Weather（施工後 Builder＋strip＋trustedCenter）══");
async function runMoreTrusted({ label, session, recSession, cat = "restaurant", userText = "還有嗎" }) {
  return measured(async () => {
    const sc = await scopeOf(label, session);
    if (sc.status !== "trusted") return { sc };
    const res = await M.dpr.buildMoreDestinationRecommendations({ destination: sc.destination, userText, context: { ...(session.travelContext ?? { interests: [] }), destination: sc.destination, tripPurpose: "more_place_recommendations" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, excludePlaceIds: [], rejectedPlaceNames: [], activeChatIntent: cat, activeCategoryIntent: cat, session: M.ctd.stripClientSearchScope(session), usedPlaces: undefined, recommendationSession: M.ctd.stripClientSearchScope(recSession), trustedCenter: sc.center });
    return { sc, recs: res.recommendations.length, patch: res.recommendationSessionPatch ?? null };
  });
}
{
  for (const [city, cat, extra] of [["京都", "restaurant", {}], ["京都", "shopping", { activeSearchCity: "大阪" }], ["大阪", "shopping", { activeSearchCity: "東京", geoClusterIndex: 3 }]]) {
    M = await freshModules();
    G = { mode: "ok", over: {} };
    const rs = recSnap({ destination: city, topic: cat, searchCentroid: { ...FAKE_C }, searchRadius: 120000, searchRegionLabel: FORGED, ...extra });
    const sess = baseSession({ travelContext: { interests: [], destination: city }, recommendationSession: rs, activeCategoryIntent: cat });
    const r = await runMoreTrusted({ label: city, session: sess, recSession: rs, cat });
    const v = r.v ?? {};
    const maxR = Math.max(0, ...r.places.map((c) => c.radius ?? 0));
    P(`  [rt] more_places ${city}/${cat} 快照偽造 ${J({ c: FAKE_C, r: 120000, ...extra })}：scope=${scopeStr(v.sc)} Places=${r.places.length} centers=${J(centersOf(r.places))} queries=${J([...new Set(r.places.map((c) => c.query))].slice(0, 3))} Weather=${J(r.weather.map(pt))} recs=${v.recs ?? 0} patch.searchCentroid=${pt(v.patch?.searchCentroid)} patch.radius=${v.patch?.searchRadius ?? "-"} patch.activeSearchCity=${J(v.patch?.activeSearchCity ?? null)} ${fc(r.c)}${r.e ? ` err=${r.e}` : ""}`);
    const centerOk = r.places.length > 0 && r.places.every((c) => near({ lat: c.lat, lng: c.lng }, CITY[city], 25) && !(c.lat === FAKE_C.lat));
    expect(`4-more-${city}-${cat}-center-not-snapshot`, centerOk, `Places 中心在可信城市 ${city} 範圍內（≤25km）、非快照 ${pt(FAKE_C)}`);
    expect(`4-more-${city}-${cat}-radius-not-snapshot`, maxR < 120000, `Places 半徑最大=${maxR}（不得沿用快照 120000）`);
    expect(`5-more-${city}-${cat}-weather-trusted`, r.weather.every((w) => near(w, CITY[city], 25)), `Weather 座標=${J(r.weather.map(pt))}`);
    if (cat === "shopping") {
      expect(`5-more-${city}-shopping-city-not-snapshot`, r.places.every((c) => !String(c.query ?? "").includes(extra.activeSearchCity)), `Shopping 查詢不得含快照城市 ${extra.activeSearchCity}；queries=${J([...new Set(r.places.map((c) => c.query))].slice(0, 3))}`);
      expect(`5-more-${city}-shopping-patch-not-snapshot`, v.patch && near(v.patch.searchCentroid, CITY[city], 25) && v.patch.searchRadius < 120000 && v.patch.activeSearchCity !== extra.activeSearchCity, `寫回 Session 的 Shopping scope：centroid=${pt(v.patch?.searchCentroid)} radius=${v.patch?.searchRadius} city=${J(v.patch?.activeSearchCity)}`);
    } else {
      info(`more_places ${city}/${cat}：recommendationSessionPatch=${v.patch ? "有" : "無"} → 呼叫端 L5500-5503 nextRecSession 取 ${v.patch ? "patch" : "shoppingSessionForSearch／activeSession.recommendationSession（未 strip 的原快照）"}`);
      if (!v.patch) expect("6-probe-more-non-shopping-writes-back-raw-snapshot", true, `非 Shopping 類別 Builder 不回 patch → renderMorePlacesReply L5201 寫回 recommendationSession=原快照（含偽造 searchCentroid ${pt(FAKE_C)}／searchRadius 120000／searchRegionLabel）`, "probe");
    }
  }
  // destination_places／alternative 帶 trustedCenter
  for (const city of ["京都", "大阪"]) {
    M = await freshModules();
    G = { mode: "ok", over: {} };
    const sess = baseSession({ travelContext: { interests: [], destination: city, latitude: FAKE_C.lat, longitude: FAKE_C.lng }, tripDestination: { placeId: "forged", country: "日本", city, displayLabel: city, formattedName: city, lat: FAKE_C.lat, lng: FAKE_C.lng }, recommendationSession: recSnap({ destination: city, searchCentroid: { ...FAKE_C }, searchRadius: 90000 }) });
    const d = await measured(async () => {
      const sc = await scopeOf(city, sess);
      const built = await M.dpr.buildDestinationMustVisitRecommendation({ destination: sc.destination, userText: `${city}有哪些地方值得去`, context: { ...sess.travelContext, destination: sc.destination }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, excludePlaceIds: [], rejectedPlaceNames: [], planningSessionId: "mock-plan-1", session: sess, trustedCenter: sc.center });
      return { sc, recs: built.recommendations.length };
    });
    P(`  [rt] destination_places ${city}（Trip／ctx 偽造座標 ${pt(FAKE_C)}）：scope=${scopeStr(d.v?.sc)} Places=${d.places.length} centers=${J(centersOf(d.places))} Weather=${J(d.weather.map(pt))} recs=${d.v?.recs ?? 0} ${fc(d.c)}${d.e ? ` err=${d.e}` : ""}`);
    expect(`3-destination_places-${city}-trusted-center`, d.v?.recs > 0 && d.places.every((c) => near({ lat: c.lat, lng: c.lng }, CITY[city], 25)) && d.weather.every((w) => near(w, CITY[city], 25)) && gTotal(d.c) === 0, `recs=${d.v?.recs} Places／Weather 皆在 ${city}、Google=${gTotal(d.c)}`);
    const a = await measured(async () => {
      const sc = await scopeOf(city, sess);
      const built = await M.dpr.buildAlternativeDestinationRecommendations({ destination: sc.destination, userText: "好", context: { ...sess.travelContext, destination: sc.destination, tripPurpose: "alternative_recommendations" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, excludePlaceIds: [], rejectedPlaceNames: [], trustedCenter: sc.center });
      return { sc, recs: built.recommendations.length };
    });
    P(`  [rt] alternative ${city}：scope=${scopeStr(a.v?.sc)} Places=${a.places.length} centers=${J(centersOf(a.places))} Weather=${J(a.weather.map(pt))} recs=${a.v?.recs ?? 0} ${fc(a.c)}${a.e ? ` err=${a.e}` : ""}`);
    expect(`10-alternative-${city}-trusted-center`, a.v?.recs > 0 && a.places.every((c) => near({ lat: c.lat, lng: c.lng }, CITY[city], 25)) && gTotal(a.c) === 0, `recs=${a.v?.recs} Places 在 ${city}、Google=${gTotal(a.c)}`);
  }
  // 中心無效 → 安全停止（不 geocode、不 Places、不 Weather）
  M = await freshModules();
  for (const [name, c] of [["(0,0)", { lat: 0, lng: 0 }], ["NaN", { lat: Number.NaN, lng: 1 }], ["超界", { lat: 95, lng: 200 }]]) {
    const runs = await Promise.all([
      measured(() => M.dpr.buildAlternativeDestinationRecommendations({ destination: "京都", userText: "好", context: { interests: [], destination: "京都" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, trustedCenter: c })),
    ]);
    const r1 = runs[0];
    const r2 = await measured(() => M.dpr.buildDestinationMustVisitRecommendation({ destination: "京都", userText: "京都有哪些地方值得去", context: { interests: [], destination: "京都" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, planningSessionId: "p", trustedCenter: c }));
    const r3 = await measured(() => M.dpr.buildMoreDestinationRecommendations({ destination: "京都", userText: "還有嗎", context: { interests: [], destination: "京都" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, activeCategoryIntent: "restaurant", trustedCenter: c }));
    const all = [r1, r2, r3];
    expect(`dpr-unusable-center-${name}-safe-stop`, all.every((r) => !r.e && r.places.length === 0 && r.weather.length === 0 && gTotal(r.c) === 0 && (r.v?.recommendations?.length ?? 0) === 0), `三個 Builder：Places=${all.map((r) => r.places.length)} Weather=${all.map((r) => r.weather.length)} Google=${all.map((r) => gTotal(r.c))} recs=${all.map((r) => r.v?.recommendations?.length ?? "err")}${all.some((r) => r.e) ? ` err=${all.map((r) => r.e)}` : ""}`);
  }
}

// ═══════════════ 1：Refinement（施工後：strip＋可信中心覆寫）═══════════════
P("\n══ 1. Refinement（施工後 L6322-6345 strip＋可信中心）══");
{
  M = await freshModules();
  G = { mode: "ok", over: {} };
  const recCtx = arc("京都", FAKE_C, { radius: 90000, resolvedSearchCity: "大阪", countryCode: "SG", destinationDisplayName: FORGED, searchScope: "area", area: "牛牛區", parentCity: "大阪" });
  const sess = baseSession({ activeRecommendationContext: recCtx, travelContext: { interests: [], destination: "京都" }, activeCategoryIntent: "restaurant" });
  const r = await measured(async () => {
    const sc = await scopeOf(recCtx.destinationName, sess);
    const stripped = { ...M.ctd.stripClientSearchScope(recCtx), destinationName: sc.destination, latitude: sc.center.lat, longitude: sc.center.lng };
    const res = await M.rre.buildRecommendationRefinementResults({ context: stripped, travelContext: { interests: [], destination: sc.destination }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, session: { ...sess, activeRecommendationContext: stripped } });
    return { sc, stripped, recs: res?.recommendations?.length ?? 0 };
  });
  const v = r.v ?? {};
  P(`  [rt] Refinement 京都＋偽造 latitude/longitude/radius/resolvedSearchCity/area/countryCode：scope=${scopeStr(v.sc)} Places=${r.places.length} centers=${J(centersOf(r.places))} queries=${J([...new Set(r.places.map((c) => c.query))].slice(0, 3))} 殘留欄位=${J(Object.fromEntries(Object.entries(v.stripped ?? {}).filter(([k]) => ["radius", "resolvedSearchCity", "area", "parentCity", "searchScope", "countryCode", "destinationDisplayName"].includes(k))))} recs=${v.recs ?? 0}${r.e ? ` err=${r.e}` : ""}`);
  expect("1-refinement-center-and-city-trusted", r.places.length > 0 && r.places.every((c) => near({ lat: c.lat, lng: c.lng }, CITY.京都, 1)) && r.places.every((c) => !String(c.query).includes("大阪") && !String(c.query).includes("牛牛")), "Refinement Places 以 Authority 京都中心、查詢不含快照城市／區域");
  expect("1-probe-refinement-keeps-snapshot-countryCode-displayName", v.stripped?.countryCode === "SG" || v.stripped?.destinationDisplayName === FORGED, `strip 後仍保留快照 countryCode=${J(v.stripped?.countryCode)}、destinationDisplayName=${J(v.stripped?.destinationDisplayName)}（execute.ts L161 destinationCountry；L6426 searchRegionLabel／L6465 文案）`, "probe");
}

// ═══════════════ 12／13／15：里斯本／波爾圖／金澤 Provider 驗證 ═══════════════
P("\n══ 12／13／15. 未知國際城市候選：Provider 證據、次數、去重、快取、冷卻 ══");
{
  const cases = [["里斯本", CITY.里斯本], ["波爾圖", CITY.波爾圖], ["金澤", CITY.金澤]];
  for (const [city, ref] of cases) {
    M = await freshModules();
    G = { mode: "ok", over: {} };
    const r = await measured(() => Promise.all([scopeOf(city), scopeOf(city)]));
    const again = await measured(() => scopeOf(city));
    const [a] = r.v ?? [];
    P(`  [rt] ${city}：並行 2 次 → ${scopeStr(a)} ${fc(r.c)} 查詢=${J(r.queries)}；再查 ${scopeStr(again.v)} ${fc(again.c)}`);
    expect(`12-${city}-trusted-1-google-dedupe-cache`, a?.status === "trusted" && near(a.center, ref, 1) && gTotal(r.c) === 1 && gTotal(again.c) === 0 && r.queries.every((q) => q === city), `並行 Google=${gTotal(r.c)}（=1）、快取後=${gTotal(again.c)}（=0）、查詢字串=${J(r.queries)}（僅候選標籤）`);
  }
  // 負向證據：每項單獨破壞一個欄位 → unavailable、不得回退舊城市
  const L = GEO.里斯本;
  const neg = [
    ["POI 類型", { ...L, types: ["establishment", "point_of_interest", "restaurant"] }],
    ["無 place_id", { ...L, place_id: "" }],
    ["城市不一致（回波爾圖）", GEO.波爾圖],
    ["無國家", { ...L, address_components: L.address_components.filter((x) => !x.types.includes("country")) }],
    ["座標 (0,0)", { ...L, geometry: { ...L.geometry, location: { lat: 0, lng: 0 } } }],
    ["ZERO_RESULTS", "zero"],
  ];
  for (const [name, res] of neg) {
    M = await freshModules();
    G = { mode: "ok", over: { 里斯本: res } };
    const sess = baseSession({ travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ destination: "京都", searchCentroid: { ...CITY.京都 } }) });
    const r = await measured(() => scopeOf("里斯本", sess));
    P(`  [rt] 里斯本 負向「${name}」：${scopeStr(r.v)} ${fc(r.c)}`);
    expect(`12-lisbon-negative-${name}`, r.v?.status === "unavailable" && !r.v?.center && gTotal(r.c) <= 1, `預期 unavailable、無中心、不回退京都、Google≤1；實際 ${scopeStr(r.v)} Google=${gTotal(r.c)}`);
  }
  // 原文不得當城市送出
  M = await freshModules();
  G = { mode: "ok", over: {} };
  for (const raw of ["我想去里斯本吃海鮮", "幫我找一下附近好吃的"]) {
    const r = await measured(() => scopeOf(raw));
    P(`  [rt] 原文 label=${J(raw)}：${scopeStr(r.v)} ${fc(r.c)} 查詢=${J(r.queries)}`);
    expect(`12-raw-text-not-sent-as-city-${raw.slice(0, 6)}`, r.queries.every((q) => q !== raw), `Provider 查詢不得為整句原文；查詢=${J(r.queries)}`);
  }
  // 13：timeout／null／ZERO＋15 秒冷卻
  for (const mode of ["timeout", "null", "zero"]) {
    M = await freshModules();
    G = { mode, over: {} };
    const first = await measured(() => scopeOf("波爾圖"));
    const retry = await measured(() => scopeOf("波爾圖"));
    const realNow = Date.now;
    Date.now = () => realNow() + 16_000;
    G = { mode: "ok", over: {} };
    const after = await measured(() => scopeOf("波爾圖"));
    Date.now = realNow;
    P(`  [rt] 波爾圖 Provider ${mode}：第一次 ${scopeStr(first.v)} ${fc(first.c)}；立即重試 ${scopeStr(retry.v)} ${fc(retry.c)}；16 秒後（Provider 恢復）${scopeStr(after.v)} ${fc(after.c)}`);
    expect(`13-porto-${mode}-unavailable-1-google`, first.v?.status === "unavailable" && gTotal(first.c) <= 1 && retry.v?.status === "unavailable" && gTotal(retry.c) === 0, `第一次 Google=${gTotal(first.c)}（≤1）、立即重試 Google=${gTotal(retry.c)}（=0）`);
    if (mode === "zero") info(`波爾圖 ZERO_RESULTS 走與 timeout 相同的 15 秒暫時失敗窗（非永久快取）：16 秒後 ${scopeStr(after.v)} Google=${gTotal(after.c)}`);
    else expect(`13-porto-${mode}-cooldown-15s-then-retry`, after.v?.status === "trusted" && gTotal(after.c) === 1, `冷卻後重試 1 次並成功：${scopeStr(after.v)} Google=${gTotal(after.c)}`);
  }
}

// ═══════════════ 10／11：京都、大阪、台中西屯、香港跑馬地 ═══════════════
P("\n══ 10／11. 京都、大阪、台中西屯、香港跑馬地（scope＋Builder 帶可信中心）══");
{
  for (const [label, ref, maxG] of [["京都", CITY.京都, 0], ["大阪", CITY.大阪, 0], ["台中西屯", CITY.西屯, 1], ["香港跑馬地", CITY.跑馬地, 1]]) {
    M = await freshModules();
    G = { mode: "ok", over: {} };
    const sess = baseSession({ travelContext: { interests: [], destination: label } });
    const r = await measured(async () => {
      const sc = await scopeOf(label, sess);
      if (sc.status !== "trusted") return { sc };
      const g0 = reqs.length;
      const built = await M.dpr.buildMoreDestinationRecommendations({ destination: sc.destination, userText: "還有嗎", context: { interests: [], destination: sc.destination }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, activeCategoryIntent: "restaurant", session: sess, trustedCenter: sc.center });
      return { sc, recs: built.recommendations.length, builderG: gTotal(countOf(reqs.slice(g0))) };
    });
    const again = await measured(() => scopeOf(label, sess));
    const v = r.v ?? {};
    P(`  [rt] ${label}：scope=${scopeStr(v.sc)} scope+Builder ${fc(r.c)} Builder Google=${v.builderG ?? "-"} Places=${r.places.length} centers=${J(centersOf(r.places))} recs=${v.recs ?? 0}；再查 ${scopeStr(again.v)} Google=${gTotal(again.c)}${r.e ? ` err=${r.e}` : ""}`);
    expect(`10-11-${label}-trusted`, v.sc?.status === "trusted" && near(v.sc.center, ref, 2) && gTotal(r.c) <= maxG && v.builderG === 0 && v.recs > 0 && r.places.every((c) => near({ lat: c.lat, lng: c.lng }, ref, 3)) && gTotal(again.c) === 0, `trusted、Google≤${maxG}（實際 ${gTotal(r.c)}）、Builder 0 Google、recs>0、再查 0 Google`);
  }
  // R3：香港跑馬地 Authority 判定 vs 付費 scope
  M = await freshModules();
  G = { mode: "ok", over: {} };
  const sc = await scopeOf("香港跑馬地");
  const auth = M.ctd.resolveCategoryTurnDestination({ ctx: { interests: [] }, session: baseSession(), userText: "香港跑馬地美食", locale: "zh-TW" });
  const ctxConfirm = M.ctd.confirmedContextDestination({ interests: [], destination: "香港跑馬地" }, baseSession({ travelContext: { interests: [], destination: "香港跑馬地" } }));
  const sc2 = await scopeOf("台中西屯");
  const auth2 = M.ctd.resolveCategoryTurnDestination({ ctx: { interests: [] }, session: baseSession(), userText: "台中西屯美食", locale: "zh-TW" });
  P(`  [rt] R3 香港跑馬地：scope=${scopeStr(sc)}；同標籤 Authority 回合判定 destination=${J(auth.destination ?? null)} confidence=${J(auth.confidence ?? auth.resolution?.confidence ?? null)} rawLabel=${J(auth.rawLabel ?? null)}；confirmedContextDestination=${J(ctxConfirm)}`);
  P(`  [rt] R3 對照 台中西屯：scope=${scopeStr(sc2)}；Authority 回合判定 destination=${J(auth2.destination ?? null)}`);
  expect("R3-probe-hk-authority-scope-inconsistent", sc.status === "trusted" && !auth.destination, `付費 scope=trusted 但 Authority 回合判定 destination=${J(auth.destination ?? null)}（兩條路徑不一致）`, "probe");
}

// ═══════════════ R2：retainedTripDestinationLabels ═══════════════
P("\n══ R2. retainedTripDestinationLabels（ctd L118-128）══");
{
  M = await freshModules();
  G = { mode: "zero", over: {} };
  const trip = { placeId: "ChIJforged", country: "日本", city: FORGED, region: "牛牛縣", displayLabel: FORGED, formattedName: FORGED, lat: 33.3, lng: 133.3 };
  const sess = baseSession({ tripDestination: trip, travelContext: { interests: [], destination: FORGED }, preferredArea: FORGED });
  const kept = M.ctd.confirmedDestinationLabelOrUndefined(FORGED, sess);
  const cc = M.ctd.confirmedContextDestination(sess.travelContext, sess);
  const unconf = M.ctd.isUnconfirmedSearchDestination(FORGED, sess);
  const r = await measured(() => scopeOf(FORGED, sess));
  const r2 = await measured(() => scopeOf("牛牛縣", sess));
  const turn = await measured(() => M.ctd.resolveTrustedContextTurnDestination({ ctx: sess.travelContext, session: sess, userText: "推薦餐廳", locale: "zh-TW", geocodeFn }));
  P(`  [rt] 偽造 resolved tripDestination：confirmedDestinationLabelOrUndefined=${J(kept ?? null)} confirmedContextDestination=${J(cc)} isUnconfirmedSearchDestination=${unconf} scope(${FORGED})=${scopeStr(r.v)} Google=${gTotal(r.c)} scope(牛牛縣)=${scopeStr(r2.v)} resolveTrustedContextTurnDestination=${J(turn.v ?? null)}`);
  expect("R2-retained-label-not-search-evidence", cc === null && r.v?.status === "unavailable" && r2.v?.status === "unavailable" && !turn.v, "保留的 Trip 標籤不得成為確認目的地／可信搜尋範圍（scope 皆 unavailable、無 context 確認）");
  expect("R2-probe-retained-label-kept-in-persisted-fields", kept === FORGED, `confirmedDestinationLabelOrUndefined 仍保留偽造 Trip 標籤 ${J(kept)}（僅用於澄清清理／L6101 preferredArea 寫回；非搜尋證據）`, "probe");
  // 搜尋入口靜態：retained 只在 confirmedDestinationLabelOrUndefined 內使用
  const CTD_SRC = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, "utf8");
  // 以函式範圍判斷（不寫死行號）：每次出現歸屬於其所在的頂層函式宣告。
  const topLevelFns = [...CTD_SRC.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*[<(]/gm)].map((m) => ({ name: m[1], idx: m.index }));
  const enclosingFn = (idx) => topLevelFns.filter((f) => f.idx <= idx).at(-1)?.name ?? "(top-level)";
  const uses = [...CTD_SRC.matchAll(/retainedTripDestinationLabels\(/g)].map((m) => ({
    line: CTD_SRC.slice(0, m.index).split("\n").length,
    fn: enclosingFn(m.index),
    isDecl: /function\s+$/.test(CTD_SRC.slice(Math.max(0, m.index - 20), m.index)),
  }));
  const declUses = uses.filter((u) => u.isDecl && u.fn === "retainedTripDestinationLabels");
  const callUses = uses.filter((u) => !u.isDecl);
  expect(
    "R2-static-retained-only-in-label-helper",
    declUses.length === 1 && callUses.length === 1 && callUses[0].fn === "confirmedDestinationLabelOrUndefined",
    `retainedTripDestinationLabels 出現=${J(uses.map((u) => `L${u.line}@${u.fn}${u.isDecl ? "(定義)" : ""}`))}（應為：定義 1 處＋唯一呼叫位於 confirmedDestinationLabelOrUndefined）`,
  );
}

// ═══════════════ 7／8／9／14：「推薦其他地方」Credits（鏡像 L6543-6651＋真實 operations）═══════════════
P("\n══ 7／8／9／14. 「推薦其他地方」Credits（鏡像 callback L6543-6651＋真實 credits/operations.ts）══");
async function runAltCredits(label, { places = "ok", throwAfterBegin = false, mode = "ok" } = {}) {
  M = await freshModules();
  M.cff.setCreditsFeatureEnabledOverride(true);
  G = { mode, over: {} };
  placesMode = places;
  rpcLog = [];
  const p0 = placeCalls.length;
  const res = await safe(async () => {
    let handle = null;
    const settle = async (ok) => {
      await M.cop.settleCreditsOperation(handle, ok);
      handle = null;
    };
    try {
      const sc = await scopeOf(label, baseSession({ travelContext: { interests: [], destination: label } }));
      if (sc.status !== "trusted") return { ret: false, sc };
      const gate = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "more_places", destination: sc.destination } });
      if (gate.blocked) return { ret: true, blocked: true };
      handle = gate.handle;
      if (throwAfterBegin) throw new Error("mock builder crash");
      const built = await M.dpr.buildAlternativeDestinationRecommendations({ destination: sc.destination, userText: "好", context: { interests: [], destination: sc.destination, tripPurpose: "alternative_recommendations" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn, fetchWeatherFn: mockWeather, trustedCenter: sc.center });
      const sessionWithRecs = { ...baseSession(), activeChatIntent: "restaurant", phase: "recommend", travelContext: { interests: [], ...built.contextPatch, destination: sc.destination } };
      const fin = M.cdr.finalizeChatRecommendationDisplay(sessionWithRecs, "好", built.summary, built.recommendations);
      if (!fin.recommendations.length && !fin.summary.trim()) {
        await settle(false);
        return { ret: false, sc };
      }
      const delivered = fin.recommendations.length ? fin.recommendations : built.recommendations;
      if (delivered.length > 0) await settle(true);
      else await settle(false);
      await settle(true); // 重複結算（handle 已置 null）不得再 commit
      return { ret: true, sc, delivered: delivered.length, summary: fin.summary.slice(0, 20) };
    } catch (e) {
      await settle(false);
      return { ret: false, err: String(e.message) };
    }
  });
  placesMode = "ok";
  return { ...res.v, e: res.e, rpc: rpcLog.map((r) => r.name), reserve: rpcLog.find((r) => r.name === "credits_reserve")?.args ?? null, places: placeCalls.length - p0 };
}
{
  const ok = await runAltCredits("京都");
  P(`  [mirror+rt] 京都 正常：ret=${ok.ret} delivered=${ok.delivered} RPC=${J(ok.rpc)} reserve=${J(ok.reserve)}`);
  expect("7-alt-success-commit-once", J(ok.rpc) === J(["credits_check", "credits_reserve", "credits_commit"]) && ok.delivered > 0, `有效卡片 ${ok.delivered} 張 → check→reserve→commit 各一次（重複 settle 不再 commit）`);
  const md = ok.reserve?.p_metadata ?? ok.reserve?.metadata ?? ok.reserve ?? {};
  P(`  INFO reserve 參數=${J(ok.reserve)}`);
  expect("14-alt-credits-metadata", J(ok.reserve).includes("PLACE_RECOMMENDATION") && J(ok.reserve).includes("recommendation_batch") && J(ok.reserve).includes("京都") && !J(ok.reserve).includes(FORGED), "featureType=PLACE_RECOMMENDATION、billing_unit=recommendation_batch、destination=可信標籤（沿用 more_places 分類）");
  void md;
  const empty = await runAltCredits("京都", { places: "empty" });
  P(`  [mirror+rt] 京都 Places 全空：ret=${empty.ret} delivered=${empty.delivered ?? 0} summary=${J(empty.summary ?? "")} RPC=${J(empty.rpc)}`);
  expect("9-alt-zero-cards-refund", J(empty.rpc) === J(["credits_check", "credits_reserve", "credits_rollback"]), "0 張卡（含只有提示文字）→ rollback，不 commit");
  const thr = await runAltCredits("京都", { throwAfterBegin: true });
  P(`  [mirror+rt] 例外：ret=${thr.ret} err=${thr.err} RPC=${J(thr.rpc)}`);
  expect("7-alt-exception-release", J(thr.rpc) === J(["credits_check", "credits_reserve", "credits_rollback"]), "例外 → release（rollback）");
  const forged = await runAltCredits(FORGED, { mode: "zero" });
  P(`  [mirror+rt] 偽造：ret=${forged.ret} scope=${scopeStr(forged.sc)} RPC=${J(forged.rpc)} Places=${forged.places}`);
  expect("7-alt-untrusted-no-credits-no-places", forged.rpc.length === 0 && forged.places === 0, "可信判定失敗 → 不預留、不搜尋");
  // 8：重複「好」——callback 先 setStreaming(true)，再 await scope／Credits
  const altS = CHAT_SRC.indexOf("const pushAlternativeDestinationPlaceRecommendation = useCallback(");
  const altE = CHAT_SRC.indexOf("= useCallback(", altS + 60);
  const body = CHAT_SRC.slice(altS, altE);
  const iLock = body.indexOf("setStreaming(true)");
  const iScope = body.indexOf("await resolveTrustedRecommendationSearchScope(");
  const iCredit = body.indexOf("await beginPlaceRecommendationCredits(");
  const preLock = body.slice(0, iLock);
  const execAwaitBeforeLock = preLock.replace(/const settlePlaceCredits[\s\S]*?};/, "").includes("await ");
  expect("8-alt-lock-before-scope-and-credits", iLock > 0 && !execAwaitBeforeLock && iLock < iScope && iScope < iCredit, `callback L${lineOf(altS)}：setStreaming(true) idx=${iLock}（之前無執行中的 await=${!execAwaitBeforeLock}）< scope idx=${iScope} < Credits idx=${iCredit}`);
  // send() 對 alt 的重入：第二次「好」時 msgs 末尾已是使用者訊息
  const secondMsgs = [...ALT_MSGS, { role: "user", content: "好" }];
  const accept2 = M.crr.shouldAcceptAlternativeRecommendations(secondMsgs, "好");
  const sendS = CHAT_SRC.indexOf("  const send = async (");
  const altBranch = CHAT_SRC.indexOf("if (shouldAcceptAlternativeRecommendations(msgs, trimmed))");
  const awaitsBefore = (CHAT_SRC.slice(sendS, altBranch).match(/\bawait\b/g) ?? []).length;
  expect("8-probe-second-ok-only-blocked-by-react-state", accept2 === true, `第一次「好」已送出（未回覆）時第二次 shouldAccept=${accept2}；send() L${lineOf(sendS)} 至 alt 分支 L${lineOf(altBranch)} 之間有 ${awaitsBefore} 個 await（不一定都在本路徑上），重入只靠 L7776 streaming／generating React state`, "probe");
}

// ═══════════════ 統計 ═══════════════
for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const acc = rows.filter((r) => r.cat === "acc");
const accFail = acc.filter((r) => !r.ok);
const probe = rows.filter((r) => r.cat === "probe");
P(`\n[acc] PASS=${acc.length - accFail.length} FAIL=${accFail.length}${accFail.length ? `（${accFail.map((r) => r.id).join(", ")}）` : ""}；[probe] 重現=${probe.filter((r) => r.ok).length}/${probe.length}（${probe.filter((r) => r.ok).map((r) => r.id).join(", ")}）`);
P(`external=${external}${external ? ` ${extLog.slice(0, 5).join(";")}` : ""}`);
const fail = external > 0 || accFail.length > 0;
P(`verify-destination-trust-boundary-a2-acceptance: ${fail ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fail ? 1 : 0);
