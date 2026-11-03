#!/usr/bin/env node
/**
 * A2-T1d — A2 施工前離線契約測試：「推薦其他地方」15 項（ALT-1..15）＋原 A2 安全 15 項（SEC-1..15）。
 *
 * 判讀：
 *   [contract]  A2 契約預期。現行程式應 FAIL（施工後必須 PASS）。任一 FAIL → exit 1。
 *   [vuln]      現行漏洞重現。PASS＝漏洞已重現（施工後應轉為 FAIL，屬預期；不影響 exit code）。
 *   [base]      現行行為基準（施工後必須仍 PASS，不退步）。任一 FAIL → exit 1。
 *   INFO        數字紀錄（Google／Places／Weather 呼叫數），供施工後比對。
 *   UNVERIFIED  無法合法離線執行。
 * 執行層級：
 *   [rt]     真實模組（vite-node 程序內 API）；Google 以 Mock googleRestFetch 逐筆計數；searchPlaces／geocodeTripLocationFromText
 *            為真實 server handler（createServerFn stub 只保留 inputValidator＋handler，並以 AsyncLocalStorage 歸屬每次 RPC 的 Google 請求數）。
 *   [mirror] React callback（useCallback）本體不可離線執行：以真實純函式依原始碼同參數鏡像其上游條件。
 *   [static] 原始碼結構檢查（呼叫順序、結算點）。
 * Credits：以 stub 的 supabase.rpc 記錄 credits_check／reserve／commit／rollback 序列（真實 credits/operations.ts＋runtime.ts）。
 * 預定介面（A2 施工新增；目前不存在 → [contract] FAIL）：
 *   ctd.resolveTrustedRecommendationSearchScope({label, ctx, session, locale, geocodeFn})
 *     → {status:"trusted", destination, center:{lat,lng}, centerSource:"authority"|"provider_locked"|"provider_this_turn", area?}
 *     | {status:"unavailable", reason}
 *   ctd.stripClientSearchScope(snapshot)
 * 外部網路全部攔截（fetch／http／https／net），任一次即 FAIL；只用 Mock Key；不寫任何檔案；不斷言 metadata.path 字串。
 * 執行：node scripts/verify-destination-trust-boundary-a2-contract.mjs
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

// 每次 server function 呼叫一個 RPC id；Mock Google 依 ALS 歸屬（量測「一次 RPC 內部展開幾個 Google 請求」）
globalThis.__A2C_ALS = new AsyncLocalStorage();
globalThis.__A2C_RPC_SEQ = 0;
const STUBS = {
  "@tanstack/react-start": `
    export const createServerFn = () => {
      const b = {
        middleware(list) { b.mw = list; return b; },
        inputValidator(fn) { b.v = fn; return b; },
        handler(fn) { return async (args) => { const id = ++globalThis.__A2C_RPC_SEQ; return globalThis.__A2C_ALS.run(id, () => fn({ data: b.v ? b.v(args?.data) : args?.data, context: {} })); }; },
      };
      return b;
    };
    export const createMiddleware = () => { const m = { server() { return m; }, client() { return m; }, middleware() { return m; } }; return m; };
  `,
  "@/lib/google-rate-limit.server": `export const requireGoogleProviderRate = {};`,
  "@/lib/public-read-auth": `export const allowGuestPublicRead = {};`,
  "@/lib/google-rest-transport": `
    export function getGoogleRestTransportToken() { return "roamie-server-proxy"; }
    export async function googleRestFetch(input, init, context) { return globalThis.__A2C_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A2C_NATIVE === true; }`,
  "@/integrations/supabase/client": `
    const any = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : any()), apply: () => any() });
    export const supabase = new Proxy({}, { get(_t, p) {
      if (p === "rpc") return async (name, args) => globalThis.__A2C_RPC(name, args);
      if (p === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
      return any();
    } });
  `,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a2c-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "a2c-transport-stubs",
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
  dg: "lib/ai/destination-geocode.ts",
  rd: "lib/ai/destination-resolution.ts",
  lf: "lib/location.functions.ts",
  pf: "lib/places.functions.ts",
  psu: "lib/places-search-unified.ts",
  crr: "lib/ai/chat-recommendation-refresh.ts",
  crc: "lib/chat-runtime-copy.ts",
  tc: "lib/ai/travel-context.ts",
  mvp: "lib/ai/must-visit-places.ts",
  tpc: "lib/ai/trip-planning-context.ts",
  ccs: "lib/ai/chat-conversation-state.ts",
  acs: "lib/ai/ai-chat-conversation-state.ts",
  cim: "lib/ai/chat-itinerary-mode.ts",
  cdr: "lib/chat-display-recommendations.ts",
  sss: "lib/ai/shopping-search-scope.ts",
  rre: "lib/ai/recommendation-refinement/execute.ts",
  rrs: "lib/ai/recommendation-refinement/session.ts",
  rra: "lib/ai/recommendation-refinement/arbitrate.ts",
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

// ════ Mock Google（逐筆計數；依查詢文字回應）════
const TIMEOUT = Symbol("timeout");
const NULLBODY = Symbol("null-body");
const ZERO = { status: "ZERO_RESULTS", results: [] };
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const gres = ({ pid, fa, lat, lng, types, comps }) => ({ address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE", viewport: { northeast: { lat: lat + 0.1, lng: lng + 0.1 }, southwest: { lat: lat - 0.1, lng: lng - 0.1 } } }, place_id: pid, types });
const JP = comp("日本", "JP", ["country", "political"]);
const TW = comp("台灣", "TW", ["country", "political"]);
const CITY = {
  京都: { lat: 35.0116, lng: 135.7681 },
  大阪: { lat: 34.6937, lng: 135.5023 },
  西屯: { lat: 24.1814, lng: 120.617 },
  跑馬地: { lat: 22.2696, lng: 114.1832 },
  里斯本: { lat: 38.7223, lng: -9.1393 },
  金澤: { lat: 36.5613, lng: 136.6562 },
};
const GEO = {
  京都: gres({ pid: "mock-pid-kyoto-city", fa: "日本京都府京都市", ...CITY.京都, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP] }),
  大阪: gres({ pid: "mock-pid-osaka-city", fa: "日本大阪府大阪市", ...CITY.大阪, types: ["locality", "political"], comps: [comp("大阪市", "大阪市", ["locality", "political"]), comp("大阪府", "大阪府", ["administrative_area_level_1", "political"]), JP] }),
  西屯: gres({ pid: "mock-pid-taichung-xitun", fa: "台灣台中市西屯區", ...CITY.西屯, types: ["administrative_area_level_2", "political"], comps: [comp("西屯區", "西屯區", ["administrative_area_level_2", "political"]), comp("台中市", "台中市", ["administrative_area_level_1", "political"]), TW] }),
  跑馬地: gres({ pid: "mock-pid-hk-happy-valley", fa: "香港跑馬地", ...CITY.跑馬地, types: ["neighborhood", "political"], comps: [comp("跑馬地", "跑馬地", ["neighborhood", "political"]), comp("灣仔區", "灣仔區", ["administrative_area_level_1", "political"]), comp("香港", "HK", ["country", "political"])] }),
  里斯本: gres({ pid: "mock-pid-lisbon", fa: "葡萄牙里斯本", ...CITY.里斯本, types: ["locality", "political"], comps: [comp("里斯本", "Lisboa", ["locality", "political"]), comp("里斯本區", "里斯本區", ["administrative_area_level_1", "political"]), comp("葡萄牙", "PT", ["country", "political"])] }),
  金澤: gres({ pid: "mock-pid-kanazawa", fa: "日本石川縣金澤市", ...CITY.金澤, types: ["locality", "political"], comps: [comp("金澤市", "金沢市", ["locality", "political"]), comp("石川縣", "石川県", ["administrative_area_level_1", "political"]), JP] }),
};
const geoFor = (q) => {
  const s = String(q ?? "");
  for (const [k, v] of Object.entries(GEO)) if (s.includes(k) || (k === "金澤" && /金沢|Kanazawa/i.test(s)) || (k === "里斯本" && /Lisbo/i.test(s)) || (k === "西屯" && /Xitun/i.test(s))) return { status: "OK", results: [v] };
  return null;
};
/** G.mode: "ok"（已知查詢回結果，其他 ZERO）／"zero"／"timeout"／"null"；G.places: "ok"|"empty"|"429" */
let G = { mode: "ok", places: "ok" };
const reqs = [];
let pseq = 0;
globalThis.__A2C_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const circle = body?.locationBias?.circle ?? body?.locationRestriction?.circle;
  const rpc = globalThis.__A2C_ALS.getStore() ?? 0;
  const query = url.searchParams.get("address") ?? body?.input ?? body?.textQuery;
  reqs.push({ kind, rpc, query, center: circle?.center ? { lat: circle.center.latitude, lng: circle.center.longitude } : null, radius: circle?.radius ?? null });
  if (kind === "places") {
    if (G.places === "429") return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "mock" } }), { status: 429 });
    if (G.places === "empty") return Response.json({});
    const c = circle?.center ?? { latitude: 0.5, longitude: 0.5 };
    // 地址含查詢第一個詞（目的地標籤），才能通過 filterPlacesByDestinationGuard（模擬真實 Places 回傳該地的地址）
    const area = String(body?.textQuery ?? "").split(/\s+/)[0] ?? "";
    const places = [0, 1, 2, 3].map((i) => {
      pseq += 1;
      return { id: `mock-gplace-${pseq}`, displayName: { text: `示意地點${pseq}` }, formattedAddress: `${area}示意地址${pseq}`, shortFormattedAddress: `${area}示意地址${pseq}`, location: { latitude: c.latitude + 0.001 * (i + 1), longitude: c.longitude + 0.001 * (i + 1) }, rating: 4.5, userRatingCount: 800, types: ["restaurant", "food", "point_of_interest", "establishment"], primaryType: "restaurant", businessStatus: "OPERATIONAL" };
    });
    return Response.json({ places });
  }
  if (G.mode === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (G.mode === "null") return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  if (kind === "geocode") return Response.json((G.mode === "ok" && geoFor(query)) || ZERO);
  if (kind === "autocomplete") return Response.json({ suggestions: [] });
  return Response.json({});
};
const countOf = (list) => ({ geocode: list.filter((r) => r.kind === "geocode").length, autocomplete: list.filter((r) => r.kind === "autocomplete").length, details: list.filter((r) => r.kind === "details").length, places: list.filter((r) => r.kind === "places").length });
const gTotal = (c) => c.geocode + c.autocomplete + c.details + c.places;
const fc = (c) => `geocode=${c.geocode} autocomplete=${c.autocomplete} details=${c.details} Places=${c.places}`;
const perRpcMax = (list) => {
  const by = {};
  for (const r of list) if (r.rpc) by[r.rpc] = (by[r.rpc] ?? 0) + 1;
  const v = Object.values(by);
  return { rpcs: v.length, max: v.length ? Math.max(...v) : 0, direct: list.filter((r) => !r.rpc).length };
};

// ════ Credits RPC 記錄 ════
let rpcLog = [];
let ledgerSeq = 0;
globalThis.__A2C_RPC = async (name, args) => {
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
const unverified = [];
const table = [];
const J = (v) => JSON.stringify(v);
function expect(id, cond, detail, cat) {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
  return !!cond;
}
const info = (s) => P(`  INFO ${s}`);
function UNVERIFIED(id, detail) {
  unverified.push(id);
  P(`  UNVERIFIED ${id}：${detail}`);
}
const crash = (e) => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}\nexternal=${external}\nverify-destination-trust-boundary-a2-contract: FAIL\n`);
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
const FORGED = "亞特蘭提斯市";
const FORGED_TAIL = "台中牛牛區";
const FAKE_C = { lat: 1.2345, lng: 103.8 };
const isForged = (v) => typeof v === "string" && (v.startsWith("亞特蘭提斯") || v.includes("牛牛"));
const nowIso = new Date().toISOString();
const baseSession = (extra = {}) => ({ phase: "recommend", messages: [], recommendedPlaces: [], selectedPlaces: [], ...extra });
const recSnap = (extra) => ({ sessionId: `rec-${Math.random().toString(36).slice(2, 8)}`, destination: "京都", topic: "restaurant", pool: [], cursor: 0, returnedPlaceIds: [], returnedCanonicalKeys: [], usedQueries: ["q1"], nextQueryCursor: 1, recommendationPage: 1, exhausted: false, createdAt: nowIso, updatedAt: nowIso, ...extra });
const FORGED_TRIP = (city) => ({ placeId: `forged-pid-${city}`, country: "日本", city, displayLabel: city, formattedName: city, lat: 33.3, lng: 133.3 });
const KYOTO_TRIP = { placeId: "mock-pid-kyoto-city", country: "日本", city: "京都", displayLabel: "京都", formattedName: "京都", lat: 35.0116, lng: 135.7681 };

const CHAT_SRC = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
const lineOf = (idx) => CHAT_SRC.slice(0, idx).split("\n").length;
function callbackBody(name) {
  const head = `const ${name} = useCallback(`;
  const s = CHAT_SRC.indexOf(head);
  if (s < 0) return { s: -1, body: "" };
  const e = CHAT_SRC.indexOf("= useCallback(", s + head.length);
  return { s, body: CHAT_SRC.slice(s, e < 0 ? undefined : e) };
}
/** 取得 `token(` 起的呼叫參數全文（括號配對） */
function callArgs(body, token) {
  const i = body.indexOf(token);
  if (i < 0) return "";
  let depth = 0;
  for (let j = i + token.length - 1; j < body.length; j += 1) {
    if (body[j] === "(") depth += 1;
    else if (body[j] === ")") {
      depth -= 1;
      if (depth === 0) return body.slice(i, j + 1);
    }
  }
  return body.slice(i);
}

let M = await freshModules();
if (M.__loadErr) info(`模組載入錯誤：${J(M.__loadErr)}`);
const geocodeFnOf = (counter) => async (args) => {
  counter.n += 1;
  return M.lf.geocodeTripLocationFromText(args);
};

// ════ 預定介面：resolveTrustedRecommendationSearchScope ════
const HAS_SCOPE = typeof M.ctd?.resolveTrustedRecommendationSearchScope === "function";
const HAS_STRIP = typeof M.ctd?.stripClientSearchScope === "function";
P("══ 0. 預定介面 ══");
expect("IF-1 resolveTrustedRecommendationSearchScope 存在", HAS_SCOPE, `typeof=${typeof M.ctd?.resolveTrustedRecommendationSearchScope}`, "contract");
expect("IF-2 stripClientSearchScope 存在", HAS_STRIP, `typeof=${typeof M.ctd?.stripClientSearchScope}`, "contract");
/** 以新模組執行一次 scope 判定，回傳結果與 Google 請求數 */
async function scopeRun({ label, ctx, session, mode = "ok", fresh = true, locale = "zh-TW" }) {
  if (fresh) M = await freshModules();
  G = { mode, places: "ok" };
  const r0 = reqs.length;
  const counter = { n: 0 };
  if (typeof M.ctd?.resolveTrustedRecommendationSearchScope !== "function") return { missing: true, c: countOf([]), geocodeFn: 0 };
  const res = await safe(() => M.ctd.resolveTrustedRecommendationSearchScope({ label, ctx: ctx ?? session?.travelContext ?? { interests: [] }, session, locale, geocodeFn: geocodeFnOf(counter) }));
  return { v: res.v, e: res.e, c: countOf(reqs.slice(r0)), geocodeFn: counter.n };
}
const scopeStr = (r) => (r.missing ? "介面不存在" : r.e ? `throw:${r.e}` : `${r.v?.status}${r.v?.destination ? `/${r.v.destination}` : ""}${r.v?.center ? ` center=${pt(r.v.center)}` : ""}${r.v?.centerSource ? ` src=${r.v.centerSource}` : ""}${r.v?.reason ? ` reason=${r.v.reason}` : ""} Google=${gTotal(r.c)}`);
function expectUnavailable(id, r, maxGoogle = 1) {
  const ok = !r.missing && !r.e && r.v?.status === "unavailable" && !r.v?.center && gTotal(r.c) <= maxGoogle && r.c.places === 0;
  return expect(id, ok, `預期 unavailable、無 center、Google≤${maxGoogle}、Places 0；實際 ${scopeStr(r)}`, "contract");
}
function expectTrusted(id, r, { dest, ref, src, maxGoogle = 0, exact }) {
  const v = r.v;
  const ok = !r.missing && !r.e && v?.status === "trusted" && (!dest || String(v.destination ?? "").includes(dest)) && (exact ? v.center?.lat === exact.lat && v.center?.lng === exact.lng : near(v?.center, ref)) && !(v?.center?.lat === 0 && v?.center?.lng === 0) && (!src || [].concat(src).includes(v.centerSource)) && gTotal(r.c) <= maxGoogle && r.c.places === 0;
  return expect(id, ok, `預期 trusted/${dest} center≈${pt(exact ?? ref)} src∈${J([].concat(src ?? "any"))} Google≤${maxGoogle}；實際 ${scopeStr(r)}`, "contract");
}

// ════ 現行：「推薦其他地方」鏡像（send() L9288-9314 + callback L6450-6525）＋真實 Builder ════
const NO_MORE = M.crc.chatRuntimeCopy("noMore", "zh-TW");
const ALT_MSGS = [
  { role: "user", content: "推薦餐廳" },
  { role: "assistant", content: "好的，推薦給你：" },
  { role: "user", content: "還有嗎" },
  { role: "assistant", content: NO_MORE },
];
async function runAlt(session, { mode = "ok", places = "ok", native = false, fresh = true } = {}) {
  if (fresh) M = await freshModules();
  G = { mode, places };
  globalThis.__A2C_NATIVE = native;
  const USER = "好";
  const r0 = reqs.length;
  const counter = { n: 0 };
  let weather = 0;
  const res = await safe(async () => {
    const accept = M.crr.shouldAcceptAlternativeRecommendations(ALT_MSGS, USER);
    let next = M.ccs.prepareSessionForUserTurn(session, NO_MORE);
    const merged = M.tc.mergeTravelContext(next, USER, NO_MORE);
    next = M.tpc.mergeTripPlanningContext(USER, merged.session, merged.context).session;
    const altCtx = { ...(next.travelContext ?? merged.context), tripPurpose: "alternative_recommendations", setting: "混合" };
    next = { ...next, travelContext: altCtx };
    const dest = altCtx.destination?.trim() ?? next.tripPlanningContext?.destination?.trim() ?? next.tripDestination?.city?.trim();
    if (!accept || !dest) return { accept, dest, entered: false };
    const activeSession = { ...next, travelContext: { ...altCtx, destination: dest } };
    const m2 = M.tc.mergeTravelContext(activeSession, USER);
    const placeCtx = M.mvp.mergeContextForPlaceFetch(m2.context, activeSession);
    const label = dest.trim();
    const built = await M.dpr.buildAlternativeDestinationRecommendations({ destination: label, userText: USER, context: { ...placeCtx, destination: label, tripPurpose: "alternative_recommendations" }, locale: "zh-TW", searchPlaces: M.psu.createUnifiedSearchPlacesFn(M.pf.searchPlaces), geocodeFn: geocodeFnOf(counter), fetchWeatherFn: async () => { weather += 1; return null; }, excludePlaceIds: M.crr.collectExcludePlaceIds(activeSession), rejectedPlaceNames: activeSession.rejectedPlaceNames });
    const sessionWithRecs = { ...m2.session, activeChatIntent: "restaurant", phase: "recommend", travelContext: { ...placeCtx, ...built.contextPatch, destination: label } };
    const fin = M.cdr.finalizeChatRecommendationDisplay(sessionWithRecs, USER, built.summary, built.recommendations);
    const applied = !(!fin.recommendations.length && !fin.summary.trim());
    return { accept, dest, entered: true, recs: built.recommendations.length, shown: fin.recommendations.length, summary: fin.summary.slice(0, 24), applied, persistedDestination: applied ? sessionWithRecs.travelContext.destination : null };
  });
  globalThis.__A2C_NATIVE = false;
  const list = reqs.slice(r0);
  const placesReq = list.filter((r) => r.kind === "places");
  return { ...(res.v ?? {}), err: res.e, c: countOf(list), rpc: perRpcMax(list), geocodeFn: counter.n, weather, centers: [...new Set(placesReq.map((r) => (r.center ? `${r.center.lat.toFixed(3)},${r.center.lng.toFixed(3)}` : "none")))].slice(0, 3), zeroCenter: placesReq.some((r) => !r.center || (r.center.lat === 0 && r.center.lng === 0)) };
}
const altStr = (a) => `dest=${J(a.dest ?? null)} 進入=${a.entered ?? false} ${fc(a.c)} (RPC=${a.rpc.rpcs} 每RPC最多 Google=${a.rpc.max} 非RPC=${a.rpc.direct}) geocodeFn=${a.geocodeFn} weather=${a.weather} recs=${a.recs ?? 0} shown=${a.shown ?? 0} applied=${a.applied ?? false} 寫回 destination=${J(a.persistedDestination ?? null)} centers=${J(a.centers)}${a.zeroCenter ? " 含(0,0)/無中心" : ""}${a.err ? ` err=${a.err}` : ""}`;

// ════ [static] callback 結構 ════
const ALT = callbackBody("pushAlternativeDestinationPlaceRecommendation");
const idx = (body, t) => body.indexOf(t);
function trustedScopeStatic(name, builderToken) {
  const { body } = callbackBody(name);
  const iScope = idx(body, "resolveTrustedRecommendationSearchScope(");
  const iCredit = idx(body, "beginPlaceRecommendationCredits(");
  const iBuild = idx(body, builderToken);
  const scopeVar = body.match(/const\s+(\w+)\s*=\s*await\s+resolveTrustedRecommendationSearchScope\(/)?.[1];
  const meta = callArgs(body, "beginPlaceRecommendationCredits(");
  const metaDest = meta.match(/destination:\s*([\w.?]+)/)?.[1] ?? (/[{,]\s*destination\s*[,}]/.test(meta) ? "destination" : null);
  const trustedAlias = scopeVar && metaDest ? metaDest === `${scopeVar}.destination` || new RegExp(`const\\s+${metaDest.replace(/[.?]/g, "\\$&")}\\s*=\\s*${scopeVar}\\.destination`).test(body) || new RegExp(`const\\s*\\{[^}]*\\bdestination(?:\\s*:\\s*${metaDest})?\\b[^}]*\\}\\s*=\\s*${scopeVar}\\b`).test(body) : false;
  const builderArgs = callArgs(body, builderToken);
  return { body, iScope, iCredit, iBuild, scopeVar, metaDest, trustedAlias, builderArgs, centerPassed: scopeVar ? new RegExp(`${scopeVar}\\.center|\\bcenter\\b`).test(builderArgs) : false };
}

// ═══════════════════ ALT：「推薦其他地方」15 項 ═══════════════════
P("\n══ ALT. 「推薦其他地方」（pushAlternativeDestinationPlaceRecommendation L6442；呼叫點 send() L9306）══");
const altStatic = trustedScopeStatic("pushAlternativeDestinationPlaceRecommendation", "await buildAlternativeDestinationRecommendations(");
info(`[static] callback L${lineOf(ALT.s)}：scope 呼叫 idx=${altStatic.iScope} Credits begin idx=${altStatic.iCredit} Builder idx=${altStatic.iBuild}`);
const T = (id, expectTxt, actual, calls, verdict) => table.push({ id, expectTxt, actual, calls, verdict });

// ALT-1..3 偽造來源
const ALT_FORGED = [
  ["ALT-1", "偽造 travelContext.destination", baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, exhausted: true }) })],
  ["ALT-2", "偽造 tripPlanningContext.destination", baseSession({ tripPlanningContext: { destination: FORGED, selectedPlaces: [] } })],
  ["ALT-3", "偽造 tripDestination（完整形狀）", baseSession({ tripDestination: FORGED_TRIP(FORGED) })],
];
for (const [id, name, sess] of ALT_FORGED) {
  const cur = await runAlt(sess, { mode: "zero" });
  P(`  [mirror+rt] ${id} ${name} 現行：${altStr(cur)}`);
  const v = cur.entered ? expect(`${id}-vuln-places-without-trust`, cur.c.places > 0 && isForged(cur.dest), `偽造標籤直接 Google Places ${cur.c.places} 次、無 Credits、Provider 失敗後${cur.zeroCenter ? "以 (0,0)／無中心" : ""}搜尋；applied=${cur.applied} 寫回=${J(cur.persistedDestination)}`, "vuln") : (info(`${id} 現行未進入 callback（dest=${J(cur.dest ?? null)}；L9301 ?? 鏈不往下取）`), false);
  const sc = await scopeRun({ label: cur.dest ?? FORGED, session: sess, mode: "zero" });
  const ok = expectUnavailable(`${id}-contract-scope-unavailable`, sc, 1);
  T(id, "不搜尋、不扣點、不寫回；scope=unavailable、Google≤1", cur.entered ? `Places=${cur.c.places} geocode=${cur.c.geocode} auto=${cur.c.autocomplete} 寫回=${J(cur.persistedDestination)}` : `未進入（dest=${J(cur.dest ?? null)}）`, `G=${gTotal(cur.c)}/Places=${cur.c.places}/Weather=${cur.weather}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
expect("ALT-1..3-static-scope-before-credits-and-builder", altStatic.iScope > 0 && altStatic.iCredit > altStatic.iScope && altStatic.iBuild > altStatic.iCredit, `callback 內 scope→Credits→Builder 順序；現行 scope=${altStatic.iScope} credits=${altStatic.iCredit} builder=${altStatic.iBuild}`, "contract");
expect("ALT-1..3-static-unavailable-returns-before-credits", altStatic.iScope > 0 && /status\s*!==\s*["']trusted["']|status\s*===\s*["']unavailable["']/.test(altStatic.body.slice(altStatic.iScope, altStatic.iCredit > 0 ? altStatic.iCredit : undefined)), "scope 非 trusted 時在 Credits 前返回", "contract");

// ALT-4/5 正常京都／大阪
const ALT_BASE = {};
for (const [id, city] of [["ALT-4", "京都"], ["ALT-5", "大阪"]]) {
  const sess = baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: city }, recommendationSession: recSnap({ destination: city, exhausted: true }) });
  const cur = await runAlt(sess);
  ALT_BASE[city] = cur;
  P(`  [mirror+rt] ${id} ${city} 現行基準：${altStr(cur)}`);
  expect(`${id}-base-${city}-batch-delivered`, cur.entered && cur.dest === city && cur.recs > 0 && cur.applied && !cur.zeroCenter, `現行可推薦 ${cur.recs} 張、寫回 ${J(cur.persistedDestination)}（施工後不得退步）`, "base");
  const sc = await scopeRun({ label: city, session: sess });
  const ok = expectTrusted(`${id}-contract-scope-trusted-0-google`, sc, { dest: city, ref: CITY[city], src: ["authority", "provider_locked"], maxGoogle: 0 });
  T(id, `trusted/${city}，新增驗證 Google=0；Credits begin→settle(true)`, `recs=${cur.recs} Places=${cur.c.places} geocode=${cur.c.geocode}（Builder 內 geocode）`, `G=${gTotal(cur.c)}/Places=${cur.c.places}/Weather=${cur.weather}`, ok ? "PASS" : "FAIL");
}

// ALT-6..8 Provider timeout／null／ZERO（需要 Provider 驗證的標籤）
// 需要真的打到 Provider 的待驗證標籤：Authority pending_provider 且無 approx center（台灣前綴標籤會直接取全台中心、不呼叫 Provider）
const LIVE = ["香港牛牛區", "大阪牛牛區", "首爾牛牛洞", "曼谷牛牛區", "京都牛牛町"].find((l) => M.rd.resolveDestination({ text: l }).confidence === "pending_provider" && !M.dg.resolveDestinationApproxCenter(l)) ?? "香港牛牛區";
info(`Provider 驗證用偽造標籤＝${LIVE}（pending_provider、無 approx center）；${FORGED_TAIL} approx=${J(M.dg.resolveDestinationApproxCenter(FORGED_TAIL))}（台灣前綴 → 全台預設中心，Provider 不會被呼叫）`);
for (const [id, mode] of [["ALT-6", "timeout"], ["ALT-7", "null"], ["ALT-8", "zero"]]) {
  const mk = (L) => baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: L }, recommendationSession: recSnap({ destination: L, exhausted: true }) });
  const sess = mk(LIVE);
  const cur = await runAlt(mk(FORGED), { mode });
  const curTail = await runAlt(mk(FORGED_TAIL), { mode });
  P(`  [mirror+rt] ${id} Provider ${mode}（${FORGED}）現行：${altStr(cur)}`);
  P(`  [mirror+rt] ${id} Provider ${mode}（${FORGED_TAIL}）現行：${altStr(curTail)}`);
  const v = expect(`${id}-vuln-provider-${mode}-still-searches`, cur.entered && cur.c.places > 0 && curTail.c.places > 0, `Provider ${mode} 後仍 Places ${cur.c.places} 次（${cur.zeroCenter ? "(0,0)／無中心" : `中心=${J(cur.centers)}`}）；${FORGED_TAIL} 不呼叫 Provider 直接以全台中心 ${J(curTail.centers)} Places ${curTail.c.places} 次`, "vuln");
  const sc = await scopeRun({ label: LIVE, session: sess, mode });
  const ok = expectUnavailable(`${id}-contract-${mode}-unavailable`, sc, 1);
  T(id, `Provider ${mode} → unavailable；Places 0、不扣點、無 (0,0)`, `Places=${cur.c.places}${cur.zeroCenter ? " 含(0,0)" : ""} geocode=${cur.c.geocode} auto=${cur.c.autocomplete}`, `G=${gTotal(cur.c)}/Places=${cur.c.places}/Weather=${cur.weather}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}

// ALT-9 顯示已有推薦清單：alt 路徑沒有「只展示既有 pool」分支；每次都是新的 Places 搜尋
{
  const pool = [1, 2, 3].map((i) => ({ placeId: `pool-${i}`, googlePlaceId: `pool-${i}`, name: `既有地點${i}`, lat: 35.01, lng: 135.76 }));
  const sess = baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: "京都" }, recommendedPlaces: pool, recommendationSession: recSnap({ destination: "京都", pool, exhausted: false }) });
  const cur = await runAlt(sess);
  P(`  [mirror+rt] ALT-9 Session 已有 pool 3 筆：${altStr(cur)}`);
  const noPoolBranch = !/recommendationSession\?*\.pool|loadSessionPool|takeFromPool|consumeRecommendationPool/.test(ALT.body);
  expect("ALT-9-base-alt-is-new-search", cur.c.places > 0 && noPoolBranch, `[rt] 已有 pool 時仍 Places ${cur.c.places} 次；[static] callback 無 pool 展示分支=${noPoolBranch} → 屬新的付費推薦操作`, "base");
  const ok = expect("ALT-9-contract-credits-before-any-places", altStatic.iCredit > 0 && altStatic.iCredit < altStatic.iBuild, "任何 Places 前已開始 Credits（若施工新增只展示 pool 分支，依 more_places L5262 前例 settle(true)）", "contract");
  T("ALT-9", "新搜尋：Credits 先於 Places；（若新增 pool 展示分支：settle(true)，Places 0）", `pool 存在仍 Places=${cur.c.places}；無 Credits`, `G=${gTotal(cur.c)}/Places=${cur.c.places}`, ok ? "PASS" : "FAIL");
}

// ALT-10..12 Credits（真實 operations／runtime；RPC 序列）＋ callback 結構
P("\n  ── Credits（真實 credits/operations.ts＋runtime.ts；supabase.rpc 記錄）──");
M = await freshModules();
M.cff.setCreditsFeatureEnabledOverride(true);
rpcLog = [];
const g1 = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "x", destination: "京都" } });
let h1 = g1.handle;
const settle1 = async (ok) => {
  await M.cop.settleCreditsOperation(h1, ok);
  h1 = null;
};
await settle1(true);
await settle1(true);
const seqSuccess = rpcLog.map((r) => r.name);
const reserve1 = rpcLog.find((r) => r.name === "credits_reserve")?.args;
rpcLog = [];
const g2 = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "x", destination: "京都" } });
await M.cop.settleCreditsOperation(g2.handle, false);
const seqFail = rpcLog.map((r) => r.name);
rpcLog = [];
const g3 = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: true, metadata: { destination: "京都" } });
await M.cop.settleCreditsOperation(g3.handle, true);
const seqPlus = rpcLog.map((r) => r.name);
rpcLog = [];
const g4 = await M.cop.beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { billing_unit: "overridden" } });
const reserve4 = rpcLog.find((r) => r.name === "credits_reserve")?.args;
await M.cop.settleCreditsOperation(g4.handle, false);
M.cff.setCreditsFeatureEnabledOverride(null);
info(`成功序列=${J(seqSuccess)}；失敗序列=${J(seqFail)}；Plus 序列=${J(seqPlus)}；requestId 1=${g1.handle?.requestId?.replace(/_[a-z0-9]+$/, "_…")} 2 不同=${g1.handle?.requestId !== g2.handle?.requestId}`);
expect("CR-1-base-success-reserve-commit-once", J(seqSuccess) === J(["credits_check", "credits_reserve", "credits_commit"]), "begin→settle(true)：check→reserve→commit；settle helper 置 null 後第二次 settle 不再 commit", "base");
expect("CR-2-base-failure-rollback", J(seqFail) === J(["credits_check", "credits_reserve", "credits_rollback"]), "begin→settle(false)：rollback（退還）", "base");
expect("CR-3-base-metadata-family", reserve1?.p_feature_type === "PLACE_RECOMMENDATION" && reserve1?.p_amount === 1 && reserve1?.p_metadata?.billing_unit === "recommendation_batch" && reserve1?.p_metadata?.feature_type === "PLACE_RECOMMENDATION" && reserve1?.p_metadata?.destination === "京都", `reserve p_feature_type=${reserve1?.p_feature_type} amount=${reserve1?.p_amount} billing_unit=${reserve1?.p_metadata?.billing_unit} destination=${reserve1?.p_metadata?.destination}`, "base");
expect("CR-4-base-requestId-fresh", g1.handle?.requestId && g1.handle.requestId !== g2.handle?.requestId && reserve1?.p_idempotency_key === g1.handle.requestId, "每次 begin 新 requestId（= idempotency_key）；同一 handle 重複 commit 由 SQL credits_commit 冪等（status committed → idempotent）", "base");
expect("CR-5-base-plus-no-ledger", seqPlus.length === 0, `Plus：不 check／reserve／commit（${J(seqPlus)}）`, "base");
info(`CR-6 metadata 覆寫：呼叫端 metadata.billing_unit 會覆蓋（operations.ts L23-26 spread 在後）→ reserve billing_unit=${J(reserve4?.p_metadata?.billing_unit)}（低：目前呼叫端都沒有傳 billing_unit）`);

const emptyBranch = ALT.body.slice(ALT.body.indexOf("if (!filteredRecs.length"), ALT.body.indexOf("setMsgs(", ALT.body.indexOf("if (!filteredRecs.length")));
const catchBranch = ALT.body.slice(ALT.body.indexOf("} catch ("), ALT.body.indexOf("} finally"));
const iSuccessSettle = ALT.body.search(/settle\w*\(\s*true\s*\)/);
const iSetMsgs = ALT.body.indexOf("setMsgs(");
const iStreaming = ALT.body.indexOf("setStreaming(true)");
{
  const curEmpty = await runAlt(baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ destination: "京都", exhausted: true }) }), { places: "empty" });
  P(`  [mirror+rt] ALT-11 京都 Places 全空：${altStr(curEmpty)} summary=${J(curEmpty.summary)}`);
  expect("ALT-11-vuln-empty-is-applied", curEmpty.shown === 0 && curEmpty.applied === true, `0 張卡時 buildAlternativeRecommendationSummary 回非空提示 → L6492 不 return false → callback 回 true 並 persist（施工若以 applied 結算會在 0 張時扣點）`, "vuln");
  const ok10 = expect("ALT-10-contract-success-settle-true", altStatic.iCredit > 0 && iSuccessSettle > iSetMsgs && iSetMsgs > 0, "成功送出卡片後 settle(true)（在 setMsgs 之後）", "contract");
  const ok11 = expect("ALT-11-contract-empty-settle-false", /settle\w*\(\s*false\s*\)/.test(emptyBranch) || /settle\w*\(\s*(filteredRecs|recs|\w+)\.length\s*>\s*0\s*\)/.test(ALT.body), "0 張卡（含只有提示文字）→ settle(false)", "contract");
  const ok12 = expect("ALT-12-contract-catch-settle-false", /settle\w*\(\s*false\s*\)/.test(catchBranch), "例外 → settle(false)（釋放）", "contract");
  T("ALT-10", "begin→Places→settle(true)；featureType PLACE_RECOMMENDATION", "無 Credits（[static] callback 無 begin）", `Credits RPC=0`, ok10 ? "PASS" : "FAIL");
  T("ALT-11", "0 張 → settle(false) 退還", `Places 空仍 applied=${curEmpty.applied}（提示文字）；無 Credits`, `G=${gTotal(curEmpty.c)}/Places=${curEmpty.c.places}`, `${ok11 ? "PASS" : "FAIL"}+vuln`);
  T("ALT-12", "例外 → settle(false) 釋放（5 分鐘 stale 自動 rollback 為最後保險）", "catch 只 console.warn＋return false；無 Credits", "-", ok12 ? "PASS" : "FAIL");
}

// ALT-13 重複按「好」
{
  const afterFirst = [...ALT_MSGS, { role: "user", content: "好" }];
  const stillAccept = M.crr.shouldAcceptAlternativeRecommendations(afterFirst, "好");
  const afterSuccess = [...afterFirst, { role: "assistant", content: "好的，我幫你找美食、咖啡廳和室內景點：\n\n1. 示意" }];
  const acceptAfterSuccess = M.crr.shouldAcceptAlternativeRecommendations(afterSuccess, "好");
  const sendGuard = /if \(!trimmed \|\| streaming \|\| generating\) return;/.test(CHAT_SRC);
  info(`[rt] 第一次「好」送出後（assistant 尚未回覆）shouldAccept=${stillAccept}；成功回覆後=${acceptAfterSuccess}；[static] send() L7643 只以 React state streaming／generating 擋重入=${sendGuard}；callback 內 setStreaming(true) idx=${iStreaming} < Credits begin idx=${altStatic.iCredit}?`);
  expect("ALT-13-base-accept-closes-after-success", acceptAfterSuccess === false, "成功回覆後再按「好」不再進入 alt（只有 in-flight 期間可能重入）", "base");
  const ok = expect("ALT-13-contract-streaming-before-credits-await", altStatic.iCredit > 0 && iStreaming > 0 && iStreaming < altStatic.iCredit, "setStreaming(true)（或同等鎖）必須在 await beginPlaceRecommendationCredits 之前，避免 in-flight 期間第二次「好」再 reserve 一筆（每次 begin 新 requestId → 不同 ledger）", "contract");
  T("ALT-13", "in-flight 期間第二次「好」不得產生第二筆 reserve；同一 handle 只結算一次", `第一次送出後 shouldAccept 仍=${stillAccept}；重入只靠 streaming state`, "-", ok ? "PASS" : "FAIL");
}

// ALT-14 不同 Session 的隔離（同一模組實例：A 驗證西屯成功 → B 偽造中心／標籤不得沿用）
{
  M = await freshModules();
  const sA = baseSession({ travelContext: { interests: [], destination: "台中西屯" } });
  const a = await scopeRun({ label: "台中西屯", session: sA, fresh: false });
  const sB = baseSession({ travelContext: { interests: [], destination: "台中西屯" }, recommendationSession: recSnap({ destination: "台中西屯", searchCentroid: { ...FAKE_C }, searchRadius: 90000 }) });
  const b = await scopeRun({ label: "台中西屯", session: sB, fresh: false });
  const sC = baseSession({ travelContext: { interests: [], destination: FORGED }, tripDestination: FORGED_TRIP(FORGED) });
  const c = await scopeRun({ label: FORGED, session: sC, fresh: false, mode: "zero" });
  P(`  [rt] ALT-14 A=${scopeStr(a)}；B（同標籤＋偽造 searchCentroid）=${scopeStr(b)}；C（另一 Session 偽造）=${scopeStr(c)}`);
  const ok = expect("ALT-14-contract-session-isolation", !a.missing && a.v?.status === "trusted" && b.v?.status === "trusted" && near(b.v.center, CITY.西屯, 10) && !(b.v.center.lat === FAKE_C.lat) && gTotal(b.c) === 0 && c.v?.status === "unavailable", "B 沿用 A 的 Provider 判定（0 Google）但中心不取 B 的快照座標；C 不受 A 影響", "contract");
  const curB = await runAlt({ ...sB, activeCategoryIntent: "restaurant" });
  info(`ALT-14 現行 B：${altStr(curB)}（alt Builder 不讀快照 centroid；中心來自 geocodeDestinationWithFallback）`);
  T("ALT-14", "Provider 判定可跨 Session 共用；座標不得取自 Client 快照；偽造 Session 不受影響", `alt 現行不讀快照中心；無 scope`, `B G=${gTotal(curB.c)}`, ok ? "PASS" : "FAIL");
}

// ALT-15 Provider 請求次數
{
  const k = ALT_BASE.京都;
  const kNative = await runAlt(baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ destination: "京都", exhausted: true }) }), { native: true });
  const fWeb = await runAlt(ALT_FORGED[0][2], { mode: "zero" });
  const fNative = await runAlt(ALT_FORGED[0][2], { mode: "zero", native: true });
  const k429 = await runAlt(baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ destination: "京都", exhausted: true }) }), { places: "429" });
  const kEmpty = await runAlt(baseSession({ activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ destination: "京都", exhausted: true }) }), { places: "empty" });
  for (const [n, r] of [["京都 Web", k], ["京都 iOS", kNative], ["京都 Web Places 全空", kEmpty], ["京都 Web Places 429", k429], ["偽造 Web ZERO", fWeb], ["偽造 iOS ZERO", fNative]]) info(`ALT-15 ${n}：${fc(r.c)} Google 合計=${gTotal(r.c)}；RPC=${r.rpc.rpcs} 每RPC最多 Google=${r.rpc.max} 非RPC（Client 直連 /api/google）=${r.rpc.direct}`);
  globalThis.__A2C_ALT_COST = { k, kNative, kEmpty, k429, fWeb, fNative };
  // contract：scope 本身的成本（Kyoto 0；未知 ≤1；並行去重 1；立即重試 0）
  const sk = await scopeRun({ label: "京都", session: baseSession({ travelContext: { interests: [], destination: "京都" } }) });
  M = await freshModules();
  G = { mode: "zero", places: "ok" };
  const r0 = reqs.length;
  let par = null;
  if (HAS_SCOPE) {
    const s = baseSession({ travelContext: { interests: [], destination: LIVE } });
    const cnt = { n: 0 };
    await Promise.all([0, 1].map(() => safe(() => M.ctd.resolveTrustedRecommendationSearchScope({ label: LIVE, ctx: s.travelContext, session: s, locale: "zh-TW", geocodeFn: geocodeFnOf(cnt) }))));
    const afterPar = gTotal(countOf(reqs.slice(r0)));
    await safe(() => M.ctd.resolveTrustedRecommendationSearchScope({ label: LIVE, ctx: s.travelContext, session: s, locale: "zh-TW", geocodeFn: geocodeFnOf(cnt) }));
    par = { parallel: afterPar, repeat: gTotal(countOf(reqs.slice(r0))) - afterPar };
  }
  const ok = expect("ALT-15-contract-scope-cost", HAS_SCOPE && gTotal(sk.c) === 0 && par && par.parallel <= 1 && par.repeat === 0, `京都 scope Google=${gTotal(sk.c)}（預期 0）；${LIVE} 並行 2 次 Google=${par?.parallel ?? "-"}（≤1）、立即重試=${par?.repeat ?? "-"}（0）`, "contract");
  expect("ALT-15-contract-builder-no-geocode-after-trust", altStatic.centerPassed, `Builder 呼叫參數必須帶入可信 center（不得再由 geocodeDestinationWithFallback 解析）；現行參數無 center（京都現行 Builder 內 geocode=${k.c.geocode}）`, "contract");
  T("ALT-15", "京都新增驗證=0；未知≤1 Google；並行去重；Builder 不再 geocode", `京都 Web G=${gTotal(k.c)}(Places ${k.c.places})；偽造 Web G=${gTotal(fWeb.c)}(Places ${fWeb.c.places})`, `iOS 京都 G=${gTotal(kNative.c)}／偽造 iOS G=${gTotal(fNative.c)}`, ok ? "PASS" : "FAIL");
}

// ═══════════════════ SEC：原 A2 安全 15 項 ═══════════════════
P("\n══ SEC. 原 A2 安全 15 項 ══");
let placeCalls = [];
let weatherCalls = [];
let placeSeq = 0;
const mockSearchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng, radius: data.radius });
  const base = { lat: Number.isFinite(data.lat) && data.lat !== 0 ? data.lat : 0.5, lng: Number.isFinite(data.lng) && data.lng !== 0 ? data.lng : 0.5 };
  const places = [0, 1, 2].map((i) => {
    placeSeq += 1;
    return { id: `mock-place-${placeSeq}`, name: `示意地點${placeSeq}`, address: `${data.destinationName ?? ""} 示意地址${placeSeq}`, formattedAddress: `${data.destinationName ?? ""} 示意地址${placeSeq}`, lat: base.lat + 0.001 * (i + 1), lng: base.lng + 0.001 * (i + 1), rating: 4.5, userRatingCount: 500, types: data.includedTypes?.length ? [data.includedTypes[0], "point_of_interest"] : ["tourist_attraction", "point_of_interest"], primaryType: data.includedTypes?.[0] ?? "tourist_attraction", businessStatus: "OPERATIONAL" };
  });
  return { places, error: null, rawCount: places.length };
};
const mockWeather = async ({ data }) => {
  weatherCalls.push({ lat: data.lat, lng: data.lng });
  return null;
};
const centersOf = (list) => [...new Set(list.map((c) => `${c.lat},${c.lng}${c.radius != null ? `,r=${c.radius}` : ""}`))].slice(0, 3);
async function runRefinement(session, text, mode = "ok") {
  M = await freshModules();
  G = { mode, places: "ok" };
  placeCalls = [];
  const r0 = reqs.length;
  const cnt = { n: 0 };
  const arbitration = M.rra.resolveChatIntentArbitration(text, session);
  let sfs = session;
  let blockedBy = null;
  if (arbitration.route !== "RECOMMENDATION_REFINEMENT" && arbitration.route !== "MORE_RECOMMENDATIONS") blockedBy = `route=${arbitration.route}`;
  else if (arbitration.refinement && arbitration.route === "RECOMMENDATION_REFINEMENT") sfs = M.rrs.applyRefinementPatchToSession(session, arbitration.refinement);
  else if (!sfs.activeRecommendationContext) {
    const dest = sfs.recommendationSession?.destination || sfs.travelContext?.destination || sfs.tripPlanningContext?.destination || sfs.tripDestination?.city || "";
    const topic = M.crs.resolveActiveCategoryIntent(sfs);
    if (!dest || !topic || M.ctd.isUnconfirmedSearchDestination(dest, sfs)) blockedBy = "L6213";
    else sfs = { ...sfs, activeRecommendationContext: M.rrs.ensureActiveRecommendationContext(sfs, { destination: dest, intent: topic, places: sfs.recommendedPlaces, usedQueries: sfs.recommendationSession?.usedQueries, resolvedSearchCity: sfs.recommendationSession?.activeSearchCity, parentCity: sfs.recommendationSession?.parentCity, area: sfs.recommendationSession?.area, searchScope: sfs.recommendationSession?.searchScope, latitude: sfs.recommendationSession?.searchCentroid?.lat, longitude: sfs.recommendationSession?.searchCentroid?.lng, radius: sfs.recommendationSession?.searchRadius }) };
  }
  const recCtx = sfs.activeRecommendationContext;
  if (!blockedBy && !recCtx) blockedBy = "no recCtx";
  if (!blockedBy && arbitration.route === "MORE_RECOMMENDATIONS") blockedBy = "MORE_RECOMMENDATIONS→return false";
  let res = null;
  if (!blockedBy) res = await safe(() => M.rre.buildRecommendationRefinementResults({ context: recCtx, travelContext: { ...(sfs.travelContext ?? { interests: [] }), destination: recCtx.destinationName }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn: geocodeFnOf(cnt), session: sfs }));
  return { route: arbitration.route, blockedBy, metaDest: recCtx?.destinationName ?? null, places: placeCalls.slice(), recs: res?.v?.recommendations?.length ?? 0, g: countOf(reqs.slice(r0)), err: res?.e ?? null };
}
async function runMust(session, text, force, mode = "ok") {
  M = await freshModules();
  G = { mode, places: "ok" };
  placeCalls = [];
  weatherCalls = [];
  const r0 = reqs.length;
  const cnt = { n: 0 };
  const merged = M.tc.mergeTravelContext(session, text);
  const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, session);
  const canFetch = force || M.mvp.shouldFetchDestinationPlaces(text, placeCtx);
  const destination = canFetch ? (M.mvp.resolveMustVisitDestination(placeCtx, text) ?? M.acs.resolveConversationDestination(placeCtx, session) ?? placeCtx.destination?.trim() ?? session.tripPlanningContext?.destination?.trim()) : undefined;
  let built = null;
  if (destination) {
    const ctxForBuild = M.cim.enrichContextForItineraryMode(text, { ...placeCtx, destination, ...(force ? { mustVisitGenerated: false } : {}) }, session);
    built = await safe(() => M.dpr.buildDestinationMustVisitRecommendation({ destination, userText: text, context: ctxForBuild, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn: geocodeFnOf(cnt), fetchWeatherFn: mockWeather, excludePlaceIds: [], rejectedPlaceNames: [], planningSessionId: "mock-plan-1", session: { ...session, travelContext: { ...placeCtx, destination } } }));
  }
  return { destination, places: placeCalls.slice(), weather: weatherCalls.slice(), recs: built?.v?.recommendations?.length ?? 0, g: countOf(reqs.slice(r0)), err: built?.e ?? null, contextPatch: built?.v?.contextPatch ?? null };
}
async function runMore({ destination, recSession, session, userText = "還有嗎", cat = "restaurant", mode = "ok" }) {
  M = await freshModules();
  G = { mode, places: "ok" };
  placeCalls = [];
  weatherCalls = [];
  const r0 = reqs.length;
  const cnt = { n: 0 };
  const sess = session ?? baseSession({ travelContext: { interests: [], destination }, recommendationSession: recSession, activeCategoryIntent: cat });
  const res = await safe(() => M.dpr.buildMoreDestinationRecommendations({ destination, userText, context: { interests: [], destination, tripPurpose: "more_place_recommendations" }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn: geocodeFnOf(cnt), fetchWeatherFn: mockWeather, excludePlaceIds: [], rejectedPlaceNames: [], activeChatIntent: cat, activeCategoryIntent: cat, session: sess, usedPlaces: undefined, recommendationSession: recSession }));
  return { places: placeCalls.slice(), weather: weatherCalls.slice(), recs: res.v?.recommendations?.length ?? 0, g: countOf(reqs.slice(r0)), err: res.e };
}
const B_TEXT = "有哪些地方值得去";
const now = Date.now();
const arc = (dest, c, extra = {}) => ({ destinationName: dest, intent: "restaurant", ...(c ? { latitude: c.lat, longitude: c.lng } : {}), previousPlaceIds: [], previousCanonicalKeys: [], currentResultPlaceIds: [], usedQueries: [], createdAt: now, updatedAt: now, ...extra });

// SEC-1 Refinement 偽造未知地名
{
  const sess = baseSession({ activeRecommendationContext: arc(FORGED, FAKE_C, { radius: 80000 }), activeCategoryIntent: "restaurant" });
  const cur = await runRefinement(sess, "想吃便宜一點的");
  P(`  [mirror+rt] SEC-1 現行：route=${cur.route} blocked=${cur.blockedBy} Places=${cur.places.length} centers=${J(centersOf(cur.places))} Credits metadata.destination=${J(cur.metaDest)} ${fc(cur.g)}`);
  const v = expect("SEC-1-vuln-refinement-forged", !cur.blockedBy && cur.places.length > 0 && cur.places.every((c) => c.lat === FAKE_C.lat), `偽造 activeRecommendationContext → Places 以偽造中心、Credits metadata.destination=偽造`, "vuln");
  const sc = await scopeRun({ label: FORGED, session: sess, mode: "zero" });
  const st = trustedScopeStatic("pushRecommendationRefinement", "await buildRecommendationRefinementResults(");
  const ok = expectUnavailable("SEC-1-contract-scope-unavailable", sc, 1) & expect("SEC-1-contract-static-refinement-scope-before-credits", st.iScope > 0 && st.iScope < st.iCredit, `pushRecommendationRefinement：scope idx=${st.iScope} < Credits idx=${st.iCredit}`, "contract");
  T("SEC-1", "unavailable；不扣點、不搜尋", `Places=${cur.places.length} 以偽造中心`, `G=${gTotal(cur.g)}/Places=${cur.places.length}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-2 偽造完整 tripDestination
{
  M = await freshModules();
  const sess = baseSession({ tripDestination: FORGED_TRIP(FORGED) });
  const cc = M.ctd.confirmedContextDestination({ interests: [] }, sess);
  const cand = M.ctd.confirmedContextDestination({ interests: [], destination: FORGED, destinationCandidate: { status: "resolved" } }, baseSession({ travelContext: { interests: [], destination: FORGED, destinationCandidate: { status: "resolved" } } }));
  const v = expect("SEC-2-vuln-providerConfirmedLabels-trusts-shape", isForged(cc?.destination) && isForged(cand?.destination), `confirmedContextDestination：偽造完整 tripDestination→${J(cc)}；偽造 destinationCandidate.status=resolved→${J(cand)}（ctd L76-92）`, "vuln");
  const ok1 = expect("SEC-2-contract-confirmedContext-not-trust-snapshot", cc === null && cand === null, "providerConfirmedLabels 不得自動信任 destinationCandidate.status 與形狀完整的 tripDestination", "contract");
  const sc = await scopeRun({ label: FORGED, session: sess, mode: "zero" });
  const ok2 = expectUnavailable("SEC-2-contract-scope-unavailable", sc, 1);
  T("SEC-2", "confirmedContext=null；scope unavailable", `confirmed=${J(cc?.destination ?? null)}`, `G=${gTotal(sc.c)}`, `${ok1 && ok2 ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-3／4 一般推薦（destination_places）偽造 travelContext／tripPlanningContext
for (const [id, name, mk, force] of [["SEC-3", "travelContext", (L) => baseSession({ travelContext: { interests: [], destination: L } }), false], ["SEC-4", "tripPlanningContext", (L) => baseSession({ tripPlanningContext: { destination: L } }), true]]) {
  const sess = mk(FORGED_TAIL);
  const cur = await runMust(sess, B_TEXT, force, "zero");
  P(`  [mirror+rt] ${id} 偽造 ${name}=${FORGED_TAIL} force=${force} 現行：destination=${J(cur.destination ?? null)} Places=${cur.places.length} centers=${J(centersOf(cur.places))} weather=${cur.weather.length} ${fc(cur.g)} recs=${cur.recs} contextPatch.destination=${J(cur.contextPatch?.destination ?? null)}`);
  const v = expect(`${id}-vuln-destination_places-forged`, cur.destination && cur.places.length > 0, `pushDestinationPlaceRecommendation（Credits begin L4670 前無確認）→ Places ${cur.places.length}`, "vuln");
  const sc = await scopeRun({ label: FORGED_TAIL, session: sess, mode: "zero" });
  const st = trustedScopeStatic("pushDestinationPlaceRecommendation", "await buildDestinationMustVisitRecommendation(");
  const ok = expectUnavailable(`${id}-contract-scope-unavailable`, sc, 1) & expect(`${id}-contract-static-destination_places-scope-before-credits`, st.iScope > 0 && st.iScope < st.iCredit, `scope idx=${st.iScope} < Credits idx=${st.iCredit}`, "contract");
  T(id, "unavailable；不扣點、不 persist", `Places=${cur.places.length} geocode=${cur.g.geocode}`, `G=${gTotal(cur.g)}/Places=${cur.places.length}/Weather=${cur.weather.length}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-5 偽造搜尋中心及半徑（more_places）
{
  const cur = await runMore({ destination: "京都", recSession: recSnap({ searchCentroid: { ...FAKE_C }, searchRadius: 90000, exhausted: false }) });
  P(`  [rt] SEC-5 more_places 京都＋快照 searchCentroid=${pt(FAKE_C)} r=90000：Places=${cur.places.length} centers=${J(centersOf(cur.places))} ${fc(cur.g)}`);
  const v = expect("SEC-5-vuln-more_places-forged-centroid", cur.places.length > 0 && cur.places.every((c) => c.lat === FAKE_C.lat), "Places 全以快照中心（destination-place-recommendation.ts L1602-1605）", "vuln");
  let stripped = null;
  if (HAS_STRIP) stripped = (await safe(() => M.ctd.stripClientSearchScope({ ...baseSession({ travelContext: { interests: [], destination: "京都" } }), recommendationSession: recSnap({ searchCentroid: { ...FAKE_C }, searchRadius: 90000, activeSearchCity: "大阪" }), activeRecommendationContext: arc("京都", FAKE_C, { radius: 90000 }), planningSelection: { destinationScope: { name: "京都", lat: FAKE_C.lat, lng: FAKE_C.lng, radius: 90000 } } }))).v;
  const leak = stripped ? J(stripped).match(/1\.2345|90000/g) : ["(介面不存在)"];
  const ok1 = expect("SEC-5-contract-strip-removes-center-radius", HAS_STRIP && stripped && !leak, `stripClientSearchScope 後不得殘留快照座標／半徑；殘留=${J(leak)}`, "contract");
  const sc = await scopeRun({ label: "京都", session: baseSession({ travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ searchCentroid: { ...FAKE_C }, searchRadius: 90000 }) }) });
  const ok2 = expectTrusted("SEC-5-contract-scope-ignores-client-center", sc, { dest: "京都", ref: CITY.京都, maxGoogle: 0 });
  T("SEC-5", "中心＝Authority 京都，不取快照中心／半徑；strip 清除", `Places 以 ${pt(FAKE_C)}`, `G=${gTotal(cur.g)}/Places=${cur.places.length}`, `${ok1 && ok2 ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-6 Shopping 搜尋中心污染
{
  M = await freshModules();
  const s1 = M.sss.resolveShoppingSearchScope({ destination: "京都", existingScope: { primaryDestination: "京都", activeSearchCity: "大阪", searchCentroid: { ...FAKE_C }, searchRadius: 120000 } });
  const v = expect("SEC-6-vuln-shopping-scope-adopts-snapshot", s1.activeSearchCity === "大阪" && s1.searchCentroid?.lat === FAKE_C.lat && s1.searchRadius === 120000, `resolveShoppingSearchScope 沿用快照 activeSearchCity=大阪 centroid=${pt(s1.searchCentroid)} r=${s1.searchRadius}（shopping-search-scope.ts L161-162／L232-255）`, "vuln");
  const cur = await runMore({ destination: "京都", recSession: recSnap({ topic: "shopping", activeSearchCity: "大阪", searchCentroid: { ...FAKE_C }, searchRadius: 120000 }), cat: "shopping", userText: "還有其他購物的地方嗎" });
  info(`SEC-6 more_places shopping 現行：Places=${cur.places.length} centers=${J(centersOf(cur.places))} q=${J(cur.places.slice(0, 2).map((c) => c.query))}`);
  let ok = false;
  if (HAS_STRIP) {
    const st = (await safe(() => M.ctd.stripClientSearchScope({ recommendationSession: recSnap({ topic: "shopping", activeSearchCity: "大阪", searchCentroid: { ...FAKE_C }, searchRadius: 120000 }) }))).v;
    const s2 = M.sss.resolveShoppingSearchScope({ destination: "京都", existingScope: st?.recommendationSession ?? {} });
    ok = s2.activeSearchCity !== "大阪" && s2.searchCentroid?.lat !== FAKE_C.lat && s2.searchRadius !== 120000;
  }
  expect("SEC-6-contract-shopping-scope-after-strip", ok, "strip 後 Shopping scope 不得沿用快照城市／中心／半徑", "contract");
  T("SEC-6", "Shopping 以可信目的地為準", `Places=${cur.places.length} 以 大阪／${pt(FAKE_C)}`, `Places=${cur.places.length}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-7 Weather 座標污染
{
  const cur = await runMore({ destination: "京都", recSession: recSnap({ searchCentroid: { ...FAKE_C }, exhausted: false }) });
  const v = expect("SEC-7-vuln-weather-forged-centroid", cur.weather.length > 0 && cur.weather.every((w) => w.lat === FAKE_C.lat), `fetchWeatherFn 收到 ${J(cur.weather.map(pt))}（L1650）`, "vuln");
  const ok = expect("SEC-7-contract-weather-trusted-center", false || (HAS_SCOPE && HAS_STRIP && altStatic.centerPassed), "Weather 座標必須來自可信 center（需 scope＋strip＋Builder 帶 center；現行皆無）", "contract");
  T("SEC-7", "Weather 用可信 center", `Weather=${J(cur.weather.map(pt))}`, `Weather=${cur.weather.length}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-8 Provider timeout／null／ZERO（一般推薦）
{
  const res = [];
  for (const mode of ["timeout", "null", "zero"]) {
    const sess = baseSession({ travelContext: { interests: [], destination: LIVE } });
    const cur = await runMust(sess, B_TEXT, true, mode);
    const sc = await scopeRun({ label: LIVE, session: sess, mode });
    res.push({ mode, cur, ok: expectUnavailable(`SEC-8-contract-${mode}`, sc, 1) });
    info(`SEC-8 ${mode} 現行 destination_places：Places=${cur.places.length} centers=${J(centersOf(cur.places))} ${fc(cur.g)} weather=${cur.weather.length}`);
  }
  T("SEC-8", "timeout／null／ZERO → unavailable；Places 0；無 (0,0)", res.map((r) => `${r.mode}:Places=${r.cur.places.length}`).join(" "), res.map((r) => `${r.mode}:G=${gTotal(r.cur.g)}`).join(" "), res.every((r) => r.ok) ? "PASS" : "FAIL");
}
// SEC-9..12 正常情境（scope 契約＋現行基準）
const NORMAL = [
  ["SEC-9", "京都", "京都", CITY.京都, 0],
  ["SEC-9", "大阪", "大阪", CITY.大阪, 0],
  ["SEC-10", "台中西屯", "西屯", CITY.西屯, 1],
  ["SEC-10", "香港跑馬地", "跑馬地", CITY.跑馬地, 1],
  ["SEC-11", "里斯本", "里斯本", CITY.里斯本, 1],
  ["SEC-11", "金澤", "金澤", CITY.金澤, 1],
];
M = await freshModules();
for (const [, label] of NORMAL) {
  const r = M.rd?.resolveDestination ? M.rd.resolveDestination({ text: label }) : null;
  info(`Authority ${label}：confidence=${r?.confidence ?? "?"} source=${r?.source ?? "?"} destination=${J(r?.destination ?? null)} areaCandidate=${J(r?.areaCandidate?.displayLabel ?? null)} approx=${J(M.dg.resolveDestinationApproxCenter(label))}`);
}
const SECN = {};
for (const [id, label, key, ref, maxG] of NORMAL) {
  const sess = baseSession({ travelContext: { interests: [], destination: label } });
  const cur = await runMust(sess, B_TEXT, true);
  const curMore = await runMore({ destination: label, recSession: recSnap({ destination: label, exhausted: false }) });
  P(`  [rt] ${id} ${label} 現行基準：destination_places Places=${cur.places.length} recs=${cur.recs} ${fc(cur.g)} weather=${cur.weather.length}；more_places Places=${curMore.places.length} recs=${curMore.recs} ${fc(curMore.g)}`);
  if (label === "里斯本" && cur.recs === 0) {
    info(`${id} 里斯本 destination_places 現行就是 0 筆（Authority=provisional_fragment；destination=${J(cur.destination ?? null)}${cur.err ? ` err=${cur.err}` : ""}）→ 不列為 base；more_places 基準如下`);
    expect(`${id}-base-${label}-more_places-delivers`, curMore.recs > 0, `現行 more_places recs=${curMore.recs}`, "base");
  } else expect(`${id}-base-${label}-destination_places-delivers`, cur.places.length > 0 && cur.recs > 0, `現行 recs=${cur.recs}`, "base");
  const sc = await scopeRun({ label, session: sess });
  const ok = expectTrusted(`${id}-contract-${label}-trusted`, sc, { dest: key === "金澤" ? "金" : key, ref, maxGoogle: maxG });
  SECN[label] = { cur, curMore, sc, ok };
}
T("SEC-9", "京都／大阪 trusted，新增 Google=0", `京都 G=${gTotal(SECN.京都.cur.g)} 大阪 G=${gTotal(SECN.大阪.cur.g)}`, `Places 京都=${SECN.京都.cur.places.length} 大阪=${SECN.大阪.cur.places.length}`, SECN.京都.ok && SECN.大阪.ok ? "PASS" : "FAIL");
T("SEC-10", "台中西屯／跑馬地 trusted（Authority 或 Provider≤1）", `西屯 G=${gTotal(SECN.台中西屯.cur.g)} 跑馬地 G=${gTotal(SECN.香港跑馬地.cur.g)}`, `Places 西屯=${SECN.台中西屯.cur.places.length} 跑馬地=${SECN.香港跑馬地.cur.places.length}`, SECN.台中西屯.ok && SECN.香港跑馬地.ok ? "PASS" : "FAIL");
T("SEC-11", "里斯本／金澤 trusted（Authority 或 Provider≤1）", `里斯本 G=${gTotal(SECN.里斯本.cur.g)} 金澤 G=${gTotal(SECN.金澤.cur.g)}`, `Places 里斯本=${SECN.里斯本.cur.places.length} 金澤=${SECN.金澤.cur.places.length}`, SECN.里斯本.ok && SECN.金澤.ok ? "PASS" : "FAIL");
// SEC-12 正常 Trip → Chat
{
  const sess = baseSession({ tripDestination: KYOTO_TRIP, tripPlanningContext: { destination: "京都" }, travelContext: { interests: [], destination: "京都" } });
  const cur = await runMust(sess, B_TEXT, false);
  expect("SEC-12-base-trip-chat-kyoto-delivers", cur.places.length > 0 && cur.recs > 0, `現行 Trip→Chat 京都 recs=${cur.recs} ${fc(cur.g)}`, "base");
  const sc = await scopeRun({ label: "京都", session: sess });
  const ok1 = expectTrusted("SEC-12-contract-trip-chat-kyoto", sc, { dest: "京都", ref: CITY.京都, maxGoogle: 0, src: ["authority", "provider_locked"] });
  // 非 Authority 城市的 Trip（形狀完整）只能是待驗證候選：Provider ZERO → unavailable
  const tripX = baseSession({ tripDestination: { ...FORGED_TRIP("牛牛鎮"), country: "台灣" }, travelContext: { interests: [], destination: "牛牛鎮" } });
  const sx = await scopeRun({ label: "牛牛鎮", session: tripX, mode: "zero" });
  const ok2 = expectUnavailable("SEC-12-contract-trip-shape-is-candidate-only", sx, 1);
  T("SEC-12", "Trip 京都 trusted（0 Google）；形狀完整的未知 Trip 只是候選", `Trip 京都 recs=${cur.recs}`, `G=${gTotal(cur.g)}/Places=${cur.places.length}`, ok1 && ok2 ? "PASS" : "FAIL");
}
// SEC-13 跨城市切換（新目的地優先於舊 Session）
{
  const sess = baseSession({ travelContext: { interests: [], destination: "京都" }, tripDestination: KYOTO_TRIP, recommendationSession: recSnap({ destination: "京都", searchCentroid: { ...CITY.京都 } }), activeRecommendationContext: arc("京都", CITY.京都), activeCategoryIntent: "restaurant" });
  M = await freshModules();
  const turn = M.ctd.resolveCategoryTurnDestination({ ctx: sess.travelContext, session: sess, userText: "大阪美食", locale: "zh-TW" });
  expect("SEC-13-base-turn-destination-osaka", turn.destination === "大阪", `resolveCategoryTurnDestination("大阪美食", 京都 Session)=${J(turn.destination ?? null)}`, "base");
  const cur = await runMore({ destination: "大阪", recSession: recSnap({ destination: "京都", searchCentroid: { ...CITY.京都 } }), userText: "大阪還有嗎" });
  const v = expect("SEC-13-vuln-more_places-old-city-center", cur.places.length > 0 && cur.places.every((c) => c.lat === CITY.京都.lat), `destination=大阪 但 Places 中心=${J(centersOf(cur.places))}（沿用京都快照）`, "vuln");
  const sc = await scopeRun({ label: "大阪", session: sess });
  const ok = expectTrusted("SEC-13-contract-new-destination-wins", sc, { dest: "大阪", ref: CITY.大阪, maxGoogle: 0 });
  T("SEC-13", "scope=大阪、中心大阪；不沿用京都快照", `more_places 中心=${J(centersOf(cur.places))}`, `G=${gTotal(cur.g)}/Places=${cur.places.length}`, `${ok ? "PASS" : "FAIL"}${v ? "+vuln" : ""}`);
}
// SEC-14 more_places 續推（正常京都）
{
  const locked = await runMore({ destination: "京都", recSession: recSnap({ destination: "京都", searchCentroid: { ...CITY.京都 }, exhausted: false }) });
  const reload = await runMore({ destination: "京都", recSession: recSnap({ destination: "京都", exhausted: false }) });
  info(`SEC-14 more_places 京都 現行：快照有中心 ${fc(locked.g)} Places=${locked.places.length} recs=${locked.recs}；Reload 無中心 ${fc(reload.g)} Places=${reload.places.length} recs=${reload.recs}`);
  expect("SEC-14-base-more_places-kyoto-delivers", locked.recs > 0 && reload.recs > 0, `現行 recs locked=${locked.recs} reload=${reload.recs}`, "base");
  const st = trustedScopeStatic("pushMorePlaceRecommendations", "await buildMoreDestinationRecommendations(");
  const ok = expect("SEC-14-contract-more_places-scope-and-center", st.iScope > 0 && st.iScope < st.iCredit && st.centerPassed, `more_places：scope idx=${st.iScope} < Credits idx=${st.iCredit}，Builder 帶 center=${st.centerPassed}（清除快照座標後不得改走 geocodeDestinationWithFallback；現行 Reload geocode=${reload.g.geocode}）`, "contract");
  const stc = trustedScopeStatic("pushDestinationCategoryPlaceRecommendation", "await buildDestinationCategoryRecommendations(");
  expect("SEC-14b-contract-destination_category-scope-before-credits", stc.iScope > 0 && stc.iScope < stc.iCredit, `destination_category：scope idx=${stc.iScope} < Credits idx=${stc.iCredit}`, "contract");
  T("SEC-14", "續推 Google 新增=0；Builder 帶可信 center", `locked G=${gTotal(locked.g)} reload G=${gTotal(reload.g)}`, `Places=${locked.places.length}/${reload.places.length} Weather=${locked.weather.length}`, ok ? "PASS" : "FAIL");
}
// SEC-15 Credits Metadata（featureType／billing_unit／destination 可信；不斷言 path 字串）
{
  const paths = [["pushRecommendationRefinement", "await buildRecommendationRefinementResults("], ["pushDestinationPlaceRecommendation", "await buildDestinationMustVisitRecommendation("], ["pushMorePlaceRecommendations", "await buildMoreDestinationRecommendations("], ["pushDestinationCategoryPlaceRecommendation", "await buildDestinationCategoryRecommendations("], ["pushAlternativeDestinationPlaceRecommendation", "await buildAlternativeDestinationRecommendations("]];
  const res = paths.map(([n, b]) => ({ n, ...trustedScopeStatic(n, b) }));
  for (const r of res) info(`SEC-15 ${r.n}：metadata.destination=${J(r.metaDest)} scope 變數=${J(r.scopeVar ?? null)} 來自可信 scope=${r.trustedAlias}`);
  const ok = expect("SEC-15-contract-metadata-destination-trusted", res.every((r) => r.iCredit > 0 && r.trustedAlias), "五條路徑 beginPlaceRecommendationCredits 的 metadata.destination 皆取自 resolveTrustedRecommendationSearchScope 結果（featureType／billing_unit 由 operations.ts 固定，見 CR-3）", "contract");
  T("SEC-15", "featureType PLACE_RECOMMENDATION、billing_unit recommendation_batch、destination=可信標籤", res.map((r) => `${r.n.replace("push", "").replace("Recommendation", "")}:${r.metaDest ?? "無"}`).join(" "), "-", ok ? "PASS" : "FAIL");
}

// ═══════════════════ 正常推薦修正基準 ═══════════════════
P("\n══ BASE. 正常推薦修正（京都已確認 Session）現行基準 ══");
for (const text of ["便宜一點的", "安靜一點的", "換其他類型"]) {
  const sess = baseSession({ travelContext: { interests: [], destination: "京都" }, tripDestination: KYOTO_TRIP, activeRecommendationContext: arc("京都", CITY.京都), activeCategoryIntent: "restaurant", recommendedPlaces: [{ placeId: "p1", name: "示意", lat: 35.01, lng: 135.76 }] });
  const cur = await runRefinement(sess, text);
  P(`  [mirror+rt] 「${text}」：route=${cur.route} blocked=${cur.blockedBy} Places=${cur.places.length} recs=${cur.recs} centers=${J(centersOf(cur.places))} ${fc(cur.g)}${cur.err ? ` err=${cur.err}` : ""}`);
  if (!cur.blockedBy) expect(`BASE-refine-${text}`, cur.places.length > 0 && cur.places.every((c) => c.lat === CITY.京都.lat), `Refinement 以京都中心搜尋 Places=${cur.places.length}`, "base");
  else info(`「${text}」現行路由 ${cur.blockedBy}（不進 Refinement；記錄為基準）`);
}
UNVERIFIED("CB-body", "React useCallback 本體（setStreaming／setMsgs／persistSession／Credits 實際結算順序）未執行；Credits 結算以 [static] 結構＋真實 operations RPC 序列判定");
UNVERIFIED("send-reentrancy", "同一幀兩次 send() 的 React state 競態無法離線重現（無 jsdom／@testing-library/react）；以 [rt] shouldAccept＋[static] setStreaming 位置判定");

// ═══════════════════ 統計 ═══════════════════
for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
P("\n══ 30 項總表（契約預期｜現行實際｜呼叫數｜判定）══");
for (const r of table) P(`  ${r.id.padEnd(7)}｜${r.expectTxt}｜${r.actual}｜${r.calls}｜${r.verdict}`);
const by = (c) => rows.filter((r) => r.cat === c);
const contractFail = by("contract").filter((r) => !r.ok);
const baseFail = by("base").filter((r) => !r.ok);
P(`\n[contract] PASS=${by("contract").length - contractFail.length} FAIL=${contractFail.length}；[vuln] 重現=${by("vuln").filter((r) => r.ok).length}/${by("vuln").length}；[base] PASS=${by("base").length - baseFail.length} FAIL=${baseFail.length}${baseFail.length ? `（${baseFail.map((r) => r.id).join(",")}）` : ""}；UNVERIFIED=${unverified.length}`);
P(`external=${external}${external ? ` ${extLog.slice(0, 5).join(";")}` : ""}`);
const fail = external > 0 || baseFail.length > 0 || contractFail.length > 0;
P(`verify-destination-trust-boundary-a2-contract: ${fail ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fail ? 1 : 0);
