#!/usr/bin/env node
/**
 * A1-T1 — Trust Boundary Step A1：Destination Provider 契約離線 Regression probe。
 *
 * 固定 Web 與 iOS 兩條 Geocode 路徑的 DestinationProviderResult 契約（types／primaryType／viewport／身分欄位），
 * 並錄製「現行一般流程的外部可觀察結果」作為基準（BASELINE，內嵌於本檔）。
 *
 * 載入方式：程序內以 vite-node API 載入真實 TypeScript 模組（同 verify-continuation-boundary-probe.mjs）。
 * 只以 Vite plugin 取代下列「傳輸／框架」模組（業務邏輯一律是真實程式碼）：
 *   - @/lib/google-rest-transport   → Mock Google（每個請求先經真實 googleRestRequest 契約驗證、計數，
 *                                      Places Details 回應依 Field Mask 過濾，模擬 Google 只回傳遮罩內欄位）
 *   - @tanstack/react-start          → createServerFn 最小 builder（inputValidator 真實執行；middleware 忽略）
 *   - @/lib/google-rate-limit.server、@/lib/public-read-auth → 空 middleware（不連 Supabase）
 *   - @/lib/capacitor-native-shell   → globalThis.__A1_NATIVE 控制（iOS = true）
 * Web 路徑：geocodeTripLocationFromText handler（location.functions.ts）＋ geocodeDestinationWithFallback(preferClient=false)
 * iOS 路徑：geocodeDestinationViaClient（destination-geocode-client.ts）＋ geocodeDestinationWithFallback(preferClient=true)
 * finalize 層：以 normalizeDestinationProviderResponse(envelope, 同 finalizeInvoke 的 provider 參數) 重現 finalizeInvoke 的正規化。
 *
 * 外部網路全部攔截（fetch / http / https / net），任何一次即 FAIL。不修改任何檔案。
 * 執行：node scripts/verify-provider-trust-contract-a1.mjs
 *       node scripts/verify-provider-trust-contract-a1.mjs --dump-baseline   （只印出目前一般流程基準 JSON）
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DUMP = process.argv.includes("--dump-baseline");

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
    export async function googleRestFetch(input, init, context) { return globalThis.__A1_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A1_NATIVE === true; }`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a1-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "a1-transport-stubs",
  enforce: "pre",
  resolveId(id) {
    if (Object.hasOwn(STUBS, id)) return STUB_PATH(id);
    return null;
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
let CONTRACT = null;
/** 新 runner＝新模組實例（模組層快取／scope lock 全部清空） */
async function freshModules() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);
  const M = {
    grc: await imp("lib/google-rest-contract.ts"),
    dpr: await imp("lib/ai/destination-provider-result.ts"),
    geo: await imp("lib/location/geographic-only.ts"),
    lf: await imp("lib/location.functions.ts"),
    dgc: await imp("lib/ai/destination-geocode-client.ts"),
    dg: await imp("lib/ai/destination-geocode.ts"),
  };
  CONTRACT = M.grc;
  return M;
}

// ════ Mock Google ════
// 構造依據（Google 官方文件格式）：
//  - Geocoding API JSON：{ status, results:[{ address_components:[{long_name,short_name,types}], formatted_address,
//      geometry:{ location:{lat,lng}, location_type, viewport:{northeast:{lat,lng},southwest:{lat,lng}} }, place_id, types }] }
//  - Places API (New) Autocomplete：{ suggestions:[{ placePrediction:{ placeId, text:{text}, types } }] }
//  - Places API (New) Place Details：{ id, displayName:{text,languageCode}, formattedAddress, location:{latitude,longitude},
//      addressComponents:[{longText,shortText,types,languageCode}], types, primaryType, viewport:{low,high} }
//    Google 只回傳 X-Goog-FieldMask 內的欄位 → 本 Mock 依真實 googleRestRequest 解析後的 fields 過濾頂層欄位。
// 座標、place_id 皆為示意值（mock-pid-*），非真實 Google 資料。
const TIMEOUT = Symbol("timeout");
const NULLBODY = Symbol("null-body");
const ZERO = { status: "ZERO_RESULTS", results: [] };
let G = {};
let curPlatform = "-";
const reqs = [];
globalThis.__A1_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  url.searchParams.delete("key");
  const headers = new Headers(init.headers);
  const fieldMask = headers.get("X-Goog-FieldMask") ?? undefined;
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const kind = url.pathname.includes("/geocode/json") ? "geocode" : url.pathname.endsWith("places:autocomplete") ? "autocomplete" : url.pathname.startsWith("/v1/places/") ? "details" : "other";
  let spec = null;
  let specErr = null;
  try {
    spec = CONTRACT.googleRestRequest({ url: url.toString(), method, ...(fieldMask ? { fieldMask } : {}), ...(body ? { body } : {}) });
  } catch (e) {
    specErr = String(e?.message ?? e);
  }
  const rec = { kind, platform: curPlatform, fieldMask: fieldMask ?? null, specErr, query: url.searchParams.get("address") ?? body?.input ?? decodeURIComponent(url.pathname.split("/").pop() ?? "") };
  reqs.push(rec);
  if (specErr) return Response.json({ error: "invalid_google_request" }, { status: 400 });
  const h = G[kind];
  let r = typeof h === "function" ? h(rec) : h;
  if (r === undefined) r = kind === "geocode" ? ZERO : kind === "autocomplete" ? {} : {};
  if (r === TIMEOUT) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (r === NULLBODY) return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  let json = r;
  if (kind === "details" && spec?.fields && json && typeof json === "object") {
    const allow = new Set(spec.fields.split(","));
    json = Object.fromEntries(Object.entries(json).filter(([k]) => allow.has(k)));
  }
  return Response.json(json);
};
const countOf = (list) => ({ geocode: list.filter((r) => r.kind === "geocode").length, autocomplete: list.filter((r) => r.kind === "autocomplete").length, details: list.filter((r) => r.kind === "details").length, other: list.filter((r) => r.kind === "other").length, rejected: list.filter((r) => r.specErr).length });

// ── Geocoding API 樣本 ──
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const vpG = (n, s, e, w) => ({ northeast: { lat: n, lng: e }, southwest: { lat: s, lng: w } });
function gres({ pid, fa, lat, lng, types, comps, viewport, locationType = "APPROXIMATE" }) {
  const r = { address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: locationType }, place_id: pid };
  if (viewport) r.geometry.viewport = viewport;
  if (types !== undefined) r.types = types;
  return r;
}
const JP = comp("日本", "JP", ["country", "political"]);
const GEO = {
  京都市: gres({ pid: "mock-pid-kyoto-city", fa: "日本京都府京都市", lat: 35.0116, lng: 135.7681, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(35.3212, 34.8743, 135.8796, 135.559) }),
  京都府: gres({ pid: "mock-pid-kyoto-pref", fa: "日本京都府", lat: 35.0212, lng: 135.7556, types: ["administrative_area_level_1", "political"], comps: [comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(35.7795, 34.7055, 136.0549, 134.8536) }),
  大阪市: gres({ pid: "mock-pid-osaka-city", fa: "日本大阪府大阪市", lat: 34.6937, lng: 135.5023, types: ["locality", "political"], comps: [comp("大阪市", "大阪市", ["locality", "political"]), comp("大阪府", "大阪府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(34.7712, 34.5715, 135.6111, 135.3478) }),
  里斯本: gres({ pid: "mock-pid-lisbon", fa: "葡萄牙里斯本", lat: 38.7223, lng: -9.1393, types: ["locality", "political"], comps: [comp("里斯本", "里斯本", ["locality", "political"]), comp("里斯本", "里斯本", ["administrative_area_level_1", "political"]), comp("葡萄牙", "PT", ["country", "political"])], viewport: vpG(38.7958, 38.6913, -9.0905, -9.2298) }),
  // 金澤：刻意不帶 viewport（情境 18「無」— 模擬舊版／部分回應）
  金澤市: gres({ pid: "mock-pid-kanazawa-geo", fa: "日本石川縣金澤市", lat: 36.5613, lng: 136.6562, types: ["locality", "political"], comps: [comp("金澤市", "金澤市", ["locality", "political"]), comp("石川縣", "石川縣", ["administrative_area_level_1", "political"]), JP] }),
  西屯區: gres({ pid: "mock-pid-taichung-xitun", fa: "台灣台中市西屯區", lat: 24.1814, lng: 120.617, types: ["administrative_area_level_2", "political"], comps: [comp("西屯區", "西屯區", ["administrative_area_level_2", "political"]), comp("台中市", "台中市", ["administrative_area_level_1", "political"]), comp("台灣", "TW", ["country", "political"])], viewport: vpG(24.2087, 24.1427, 120.6658, 120.5835) }),
  跑馬地: gres({ pid: "mock-pid-hk-happy-valley", fa: "香港跑馬地", lat: 22.269, lng: 114.183, types: ["neighborhood", "political"], comps: [comp("跑馬地", "跑馬地", ["neighborhood", "political"]), comp("香港島", "香港島", ["administrative_area_level_1", "political"]), comp("香港", "HK", ["country", "political"])], viewport: vpG(22.2771, 22.2603, 114.1911, 114.1741) }),
  清水寺: gres({ pid: "mock-pid-kiyomizu", fa: "日本京都府京都市東山區清水1丁目294", lat: 34.9949, lng: 135.785, types: ["establishment", "place_of_worship", "point_of_interest", "tourist_attraction"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(34.9963, 34.9936, 135.7864, 135.7837), locationType: "GEOMETRIC_CENTER" }),
  嵐山: gres({ pid: "mock-pid-arashiyama", fa: "日本京都府京都市右京區嵐山", lat: 35.0094, lng: 135.6668, types: ["establishment", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(35.0201, 34.9987, 135.6812, 135.6524) }),
  plus: gres({ pid: "GhIJmock-pluscode", fa: "8Q6QHMJ4+ 金澤市 日本石川縣", lat: 36.5813, lng: 136.6562, types: ["plus_code"], comps: [comp("8Q6QHMJ4+", "8Q6QHMJ4+", ["plus_code"]), comp("金澤市", "金澤市", ["locality", "political"]), comp("石川縣", "石川縣", ["administrative_area_level_1", "political"]), JP], viewport: vpG(36.5827, 36.58, 136.6576, 136.6549), locationType: "GEOMETRIC_CENTER" }),
  geocodeMeta: gres({ pid: "mock-pid-geocode-meta", fa: "日本石川縣金澤市", lat: 36.5613, lng: 136.6562, types: ["geocode"], comps: [comp("金澤市", "金澤市", ["locality", "political"]), comp("石川縣", "石川縣", ["administrative_area_level_1", "political"]), JP], viewport: vpG(36.7, 36.4, 136.8, 136.5) }),
};
const noTypes = (r) => { const c = structuredClone(r); delete c.types; delete c.geometry.viewport; return c; };
const OK = (...results) => ({ status: "OK", results });

// ── Places API (New) 樣本 ──
const pc = (long, short, types) => ({ longText: long, shortText: short, types, languageCode: "zh-TW" });
const DET = {
  金澤: { id: "mock-pid-kanazawa", displayName: { text: "金澤市", languageCode: "zh-TW" }, formattedAddress: "日本石川縣金澤市", location: { latitude: 36.5613, longitude: 136.6562 }, addressComponents: [pc("金澤市", "金澤市", ["locality", "political"]), pc("石川縣", "石川縣", ["administrative_area_level_1", "political"]), pc("日本", "JP", ["country", "political"])], types: ["locality", "political"], primaryType: "locality", viewport: { low: { latitude: 36.4, longitude: 136.48 }, high: { latitude: 36.71, longitude: 136.83 } } },
  跑馬地: { id: "mock-pid-hk-happy-valley-place", displayName: { text: "跑馬地", languageCode: "zh-TW" }, formattedAddress: "香港跑馬地", location: { latitude: 22.269, longitude: 114.183 }, addressComponents: [pc("跑馬地", "跑馬地", ["neighborhood", "political"]), pc("香港島", "香港島", ["administrative_area_level_1", "political"]), pc("香港", "HK", ["country", "political"])], types: ["neighborhood", "political"], primaryType: "neighborhood", viewport: { low: { latitude: 22.26, longitude: 114.17 }, high: { latitude: 22.28, longitude: 114.19 } } },
};
const detNoPrimary = (d) => { const c = structuredClone(d); delete c.primaryType; return c; };
const detNoTypes = (d) => { const c = structuredClone(d); delete c.primaryType; delete c.types; return c; };
const AUTO = (placeId, text, types) => ({ suggestions: [{ placePrediction: { placeId, text: { text }, types } }] });

// ── 「Google 真值」：契約要求 Provider Result 保留的值 ──
const vpConv = (v) => (v ? { north: v.northeast.lat, south: v.southwest.lat, east: v.northeast.lng, west: v.southwest.lng } : undefined);
const gComp = (r, t) => r.address_components.find((c) => c.types.includes(t));
const truthGeo = (r) => ({ placeId: r.place_id, types: r.types, primaryType: undefined, viewport: vpConv(r.geometry.viewport), lat: r.geometry.location.lat, lng: r.geometry.location.lng, countryCode: gComp(r, "country")?.short_name, admin1: gComp(r, "administrative_area_level_1")?.long_name });
// Places Details：viewport 不在 Field Mask → 真值必為 undefined（Google 不會回傳）
const truthDet = (d) => ({ placeId: d.id, types: d.types, primaryType: d.primaryType, viewport: undefined, lat: d.location.latitude, lng: d.location.longitude, countryCode: d.addressComponents.find((c) => c.types.includes("country"))?.shortText, admin1: d.addressComponents.find((c) => c.types.includes("administrative_area_level_1"))?.longText });

/**
 * 情境表。items: 必驗情境編號（web/ios 分列）。phase: geo＝Phase 1（placesFallback:false）；places＝Phase 2（Places 備援）。
 * web/ios 可覆寫 Web serverFn 回傳（webFn）以模擬舊版 Server／null。
 */
const SCEN = [
  { id: "city-京都", dest: "京都", items: { web: [1], ios: [2] }, G: { geocode: OK(GEO.京都市, GEO.京都府) }, phase: "geo", truth: truthGeo(GEO.京都市) },
  { id: "city-大阪", dest: "大阪", items: { web: [1], ios: [2] }, G: { geocode: OK(GEO.大阪市) }, phase: "geo", truth: truthGeo(GEO.大阪市) },
  { id: "city-里斯本", dest: "里斯本", items: { web: [1], ios: [2] }, G: { geocode: OK(GEO.里斯本) }, phase: "geo", truth: truthGeo(GEO.里斯本) },
  { id: "city-金澤-noViewport", dest: "金澤", items: { web: [1], ios: [2] }, G: { geocode: OK(GEO.金澤市) }, phase: "geo", truth: truthGeo(GEO.金澤市) },
  { id: "dist-台中西屯", dest: "台中西屯", items: { web: [3], ios: [4] }, G: { geocode: OK(GEO.西屯區) }, phase: "geo", truth: truthGeo(GEO.西屯區) },
  { id: "dist-香港跑馬地", dest: "香港跑馬地", items: { web: [3], ios: [4] }, G: { geocode: OK(GEO.跑馬地) }, phase: "geo", truth: truthGeo(GEO.跑馬地) },
  { id: "details-金澤", dest: "金澤", items: { web: [5], ios: [5] }, G: { geocode: ZERO, autocomplete: AUTO("mock-pid-kanazawa", "日本石川縣金澤市", ["locality", "political", "geocode"]), details: DET.金澤 }, phase: "places", truth: truthDet(DET.金澤) },
  { id: "details-香港跑馬地", dest: "香港跑馬地", items: { web: [5, 3], ios: [5, 4] }, G: { geocode: ZERO, autocomplete: AUTO("mock-pid-hk-happy-valley-place", "香港跑馬地", ["neighborhood", "political", "geocode"]), details: DET.跑馬地 }, phase: "places", truth: truthDet(DET.跑馬地) },
  { id: "typesMissing-geocode-大阪", dest: "大阪", items: { web: [6, 11], ios: [6, 11] }, G: { geocode: OK(noTypes(GEO.大阪市)) }, phase: "geo", truth: truthGeo(noTypes(GEO.大阪市)) },
  { id: "typesMissing-details-金澤", dest: "金澤", items: { web: [6, 5], ios: [6, 5] }, G: { geocode: ZERO, autocomplete: AUTO("mock-pid-kanazawa", "日本石川縣金澤市", ["locality", "political"]), details: detNoTypes(DET.金澤) }, phase: "places", truth: truthDet(detNoTypes(DET.金澤)) },
  { id: "primaryMissing-details-金澤", dest: "金澤", items: { web: [7, 5], ios: [7, 5] }, G: { geocode: ZERO, autocomplete: AUTO("mock-pid-kanazawa", "日本石川縣金澤市", ["locality", "political"]), details: detNoPrimary(DET.金澤) }, phase: "places", truth: truthDet(detNoPrimary(DET.金澤)) },
  { id: "poi-清水寺", dest: "清水寺", items: { web: [8], ios: [8] }, G: { geocode: OK(GEO.清水寺) }, phase: "geo", truth: truthGeo(GEO.清水寺) },
  // 混合：POI 排第一、城市第二（Web pickBestGeocodeResult 會挑城市，iOS 取 candidates[0]）
  { id: "poiMixed-京都", dest: "京都", items: { web: [8], ios: [8] }, G: { geocode: OK(GEO.清水寺, GEO.京都市) }, phase: "geo", truth: truthGeo(GEO.京都市), truthIos: truthGeo(GEO.清水寺) },
  { id: "politicalEstablishment-嵐山", dest: "嵐山", items: { web: [9], ios: [9] }, G: { geocode: OK(GEO.嵐山) }, phase: "geo", truth: truthGeo(GEO.嵐山) },
  { id: "plusCode-金澤", dest: "金澤", items: { web: [10], ios: [10] }, G: { geocode: OK(GEO.plus) }, phase: "geo", truth: truthGeo(GEO.plus) },
  { id: "geocodeMeta-金澤", dest: "金澤", items: { web: [10], ios: [10] }, G: { geocode: OK(GEO.geocodeMeta) }, phase: "geo", truth: truthGeo(GEO.geocodeMeta) },
  { id: "timeout-京都", dest: "京都", items: { web: [12], ios: [12] }, G: { geocode: TIMEOUT, autocomplete: TIMEOUT, details: TIMEOUT }, phase: "geo", fail: true },
  // Provider null：Web＝serverFn 回 null（之後依既有邏輯改走 Client，Google 回 ZERO）；iOS＝Google 回應 body 為 JSON null
  { id: "null-京都", dest: "京都", items: { web: [13], ios: [13] }, G: { geocode: ZERO }, Gios: { geocode: NULLBODY, autocomplete: NULLBODY, details: NULLBODY }, webFn: () => null, phase: "geo", fail: true },
  // Provider null（Google／Proxy 回應 body 為 JSON null）：Web serverFn 與 iOS Client 兩邊都吃同一份 null body
  { id: "nullBody-京都", dest: "京都", items: { web: [13], ios: [13] }, G: { geocode: NULLBODY, autocomplete: NULLBODY, details: NULLBODY }, phase: "geo", fail: true },
  { id: "zero-京都", dest: "京都", items: { web: [14], ios: [14] }, G: { geocode: ZERO, autocomplete: { suggestions: [] } }, phase: "geo", fail: true },
  // 無已知 approx center 的國際城市：失敗時 e2e 不會被 approx fallback 補上
  { id: "zero-里斯本", dest: "里斯本", items: { web: [14], ios: [14] }, G: { geocode: ZERO, autocomplete: { suggestions: [] } }, phase: "geo", fail: true },
  { id: "timeout-里斯本", dest: "里斯本", items: { web: [12], ios: [12] }, G: { geocode: TIMEOUT, autocomplete: TIMEOUT, details: TIMEOUT }, phase: "geo", fail: true },
  // 舊版 Server 回應（Web）：只有 location，沒有 providerResult／types／primaryType／viewport
  { id: "legacyServer-大阪", dest: "大阪", items: { web: [11], ios: [11] }, G: { geocode: OK(noTypes(GEO.大阪市)) }, webFn: () => ({ location: { placeId: "mock-pid-osaka-city", country: "日本", city: "大阪市", region: "大阪府", lat: 34.6937, lng: 135.5023, formattedName: "日本・大阪市", displayLabel: "日本・大阪市" }, error: null }), phase: "geo", truth: truthGeo(noTypes(GEO.大阪市)), legacy: true },
  { id: "legacyServerPR-大阪", dest: "大阪", items: { web: [11], ios: [11] }, G: { geocode: OK(noTypes(GEO.大阪市)) }, webFn: () => ({ location: { placeId: "mock-pid-osaka-city", country: "日本", city: "大阪市", region: "大阪府", lat: 34.6937, lng: 135.5023, formattedName: "日本・大阪市", displayLabel: "日本・大阪市" }, error: null, providerResult: { ok: true, status: "OK", latitude: 34.6937, longitude: 135.5023, country: "日本", administrativeArea: "大阪府", locality: "大阪市", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, placeId: "mock-pid-osaka-city", sourceShape: "trip_location" } }), phase: "geo", truth: truthGeo(noTypes(GEO.大阪市)), legacy: true },
];

// ════ 斷言紀錄 ════
const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
/** cat: contract＝契約斷言（本輪預期在缺口處 FAIL）；base＝一般流程基準（必須 PASS）；amb＝契約有歧義（仍記錄結果） */
function expect(id, cond, detail, { items = [], platform = "both", cat = "contract", contract = "" } = {}) {
  rows.push({ id, ok: !!cond, detail, items, platform, cat, contract });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}${contract ? ` <契約${contract}>` : ""}：${detail}`);
}
const info = (msg) => P(`  INFO ${msg}`);
const J = (v) => JSON.stringify(v, (k, x) => (x === undefined ? "∅" : x));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function findKeys(obj, re, path = "", acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && v !== undefined && v !== null && v !== false) acc.push(`${path}${k}`);
    findKeys(v, re, `${path}${k}.`, acc);
  }
  return acc;
}
const PR_KEYS = ["ok", "status", "latitude", "longitude", "formattedAddress", "countryCode", "country", "administrativeArea", "locality", "provider", "rawResultCount", "parsedResultCount", "failureReason", "httpStatus", "placeId", "sourceShape", "query"];
const LOC_KEYS = ["placeId", "country", "city", "region", "district", "sublocality", "lat", "lng", "formattedName", "displayLabel", "address"];
const pick = (o, keys) => (o == null ? null : Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])));

// ════ 執行器 ════
async function runDirect(M, S, platform) {
  G = platform === "ios" && S.Gios ? S.Gios : S.G;
  curPlatform = platform;
  const r0 = reqs.length;
  let env;
  let err = null;
  try {
    if (platform === "web") {
      const data = { query: S.dest, destinationName: S.dest, locale: "zh-TW", language: "zh-TW", disableLocaleRegionBias: true, placesFallback: S.phase === "places" };
      env = S.webFn ? await S.webFn({ data }) : await M.lf.geocodeTripLocationFromText({ data });
    } else {
      env = await M.dgc.geocodeDestinationViaClient(S.phase === "places" ? { query: S.dest, destinationName: S.dest, locale: "zh-TW", language: "zh-TW", placesFallback: true, autocompleteOnly: true, placeDetailsBudget: 1 } : { query: S.dest, destinationName: S.dest, locale: "zh-TW", language: "zh-TW", placesFallback: false });
    }
  } catch (e) {
    err = String(e?.message ?? e);
  }
  // finalizeInvoke 的 provider 參數：Web server→geocode_fn（Phase 2 places_autocomplete）；iOS→geocode（Phase 2 places_autocomplete）
  const finProvider = S.phase === "places" ? "places_autocomplete" : platform === "web" ? "geocode_fn" : "geocode";
  let fin = null;
  let finErr = null;
  try {
    fin = M.dpr.normalizeDestinationProviderResponse(env, { provider: finProvider, query: S.dest });
  } catch (e) {
    finErr = String(e?.message ?? e);
  }
  const used = reqs.slice(r0);
  return { env, err, fin, finErr, counts: countOf(used), masks: [...new Set(used.map((r) => `${r.kind}:${r.fieldMask ?? "-"}`))].sort(), rejected: used.filter((r) => r.specErr).map((r) => `${r.kind}:${r.specErr}`) };
}

async function runE2E(S, platform) {
  const M = await freshModules();
  M.dg.clearDestinationGeocodeCache();
  G = platform === "ios" && S.Gios ? S.Gios : S.G;
  curPlatform = platform;
  globalThis.__A1_NATIVE = platform === "ios";
  const r0 = reqs.length;
  let serverFnCalls = 0;
  const geocodeFn = async (args) => {
    serverFnCalls += 1;
    if (S.webFn) return S.webFn(args);
    return M.lf.geocodeTripLocationFromText(args);
  };
  let loc = null;
  let err = null;
  try {
    loc = await M.dg.geocodeDestinationWithFallback({ destination: S.dest, locale: "zh-TW", geocodeFn, preferCachedCoordinates: false });
  } catch (e) {
    err = String(e?.message ?? e);
  }
  globalThis.__A1_NATIVE = false;
  const used = reqs.slice(r0);
  return { loc, err, serverFnCalls, counts: countOf(used), masks: [...new Set(used.map((r) => `${r.kind}:${r.fieldMask ?? "-"}`))].sort(), rejected: used.filter((r) => r.specErr).map((r) => `${r.kind}:${r.specErr}`) };
}

// Field Mask 代碼（基準錄製時的實際字串；未知遮罩以原字串記錄，會被「不得擴大」檢查抓到）
const MASK_CODE = {
  "geocode:-": "G",
  "autocomplete:suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types": "A-web",
  "autocomplete:suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.types": "A-ios",
  "details:id,displayName,formattedAddress,location,addressComponents,types,primaryType": "D",
};
const maskCodes = (list) => list.map((m) => MASK_CODE[m] ?? m);
const cnt = (c) => ({ g: c.geocode, a: c.autocomplete, d: c.details });
const NOW_BASE = {};
const results = {};
for (const S of SCEN) {
  results[S.id] = {};
  for (const platform of ["web", "ios"]) {
    const M = await freshModules();
    globalThis.__A1_NATIVE = platform === "ios";
    const d = await runDirect(M, S, platform);
    globalThis.__A1_NATIVE = false;
    const e = await runE2E(S, platform);
    results[S.id][platform] = { d, e };
    NOW_BASE[`${S.id}|${platform}`] = {
      env: d.env == null ? null : { location: pick(d.env.location, LOC_KEYS), error: d.env.error ?? null, providerResult: pick(d.env.providerResult, PR_KEYS), usedPlaceDetails: d.env.usedPlaceDetails },
      fin: d.fin == null ? null : pick(d.fin, PR_KEYS),
      directErr: d.err,
      finErr: d.finErr,
      directCounts: cnt(d.counts),
      directMasks: maskCodes(d.masks),
      e2e: { location: pick(e.loc, LOC_KEYS), err: e.err, serverFnCalls: e.serverFnCalls },
      e2eCounts: cnt(e.counts),
      e2eMasks: maskCodes(e.masks),
    };
  }
}

// isGeographicPlaceTypes 判定（既有寬鬆篩選；本次不得改變）
const GEO_TYPE_SAMPLES = [
  ["undefined", undefined], ["[]", []], ["locality,political", ["locality", "political"]], ["administrative_area_level_2,political", ["administrative_area_level_2", "political"]],
  ["neighborhood,political", ["neighborhood", "political"]], ["plus_code", ["plus_code"]], ["geocode", ["geocode"]], ["geocode,establishment", ["geocode", "establishment"]],
  ["establishment,political", ["establishment", "political"]], ["establishment,political,point_of_interest", ["establishment", "political", "point_of_interest"]],
  ["political,establishment,restaurant", ["political", "establishment", "restaurant"]], ["establishment,place_of_worship,point_of_interest,tourist_attraction", ["establishment", "place_of_worship", "point_of_interest", "tourist_attraction"]],
  ["natural_feature,establishment", ["natural_feature", "establishment"]], ["route", ["route"]], ["street_address", ["street_address"]], ["unknown_type", ["unknown_type"]],
];
{
  const M = await freshModules();
  NOW_BASE["isGeographicPlaceTypes"] = Object.fromEntries(GEO_TYPE_SAMPLES.map(([k, t]) => [k, M.geo.isGeographicPlaceTypes(t)]));
  // 舊版 Provider 形狀（Native bridge／Proxy）經 finalize 正規化：不崩潰、成功語意不變
  const LEGACY_SHAPES = {
    "root.lat/lng": { lat: 34.6937, lng: 135.5023, placeId: "mock-pid-osaka-city", city: "大阪市" },
    "root.latitude/longitude": { latitude: 34.6937, longitude: 135.5023, placeId: "mock-pid-osaka-city" },
    "location.lat/lng": { location: { lat: 34.6937, lng: 135.5023, city: "大阪市", country: "日本" }, error: null },
    "geocode.noTypes": OK(noTypes(GEO.大阪市)),
    "empty{}": {},
    "null": null,
    "error-only": { location: null, error: "geocode_zero_results" },
  };
  const legacyNow = {};
  for (const [k, v] of Object.entries(LEGACY_SHAPES)) {
    let r;
    try {
      const n = M.dpr.normalizeDestinationProviderResponse(v, { provider: "geocode_fn", query: "大阪" });
      r = { pr: pick(n, PR_KEYS), types: n.types ?? null, primaryType: n.primaryType ?? null, viewport: n.viewport ?? null, selfValidated: findKeys(n, /validat|verified|trusted/i) };
    } catch (e) {
      r = { threw: String(e?.message ?? e) };
    }
    legacyNow[k] = r;
  }
  NOW_BASE["legacyShapes"] = Object.fromEntries(Object.entries(legacyNow).map(([k, v]) => [k, v.threw ? { threw: v.threw } : v.pr]));
  results.__legacy = legacyNow;
}

if (DUMP) {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  await server.close();
  process.stdout.write(`export const BASELINE = {\n${Object.entries(NOW_BASE).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}\n};\n`);
  process.exit(external ? 1 : 0);
}

// ════ A. 契約斷言（types／primaryType／viewport／身分欄位）════
function contractChecks(S, platform, pr, truth, level) {
  const items = S.items[platform];
  const tag = `${S.id}-${platform}-${level}`;
  const where = `${platform === "web" ? "Web" : "iOS"} ${level === "env" ? "envelope.providerResult" : "finalizeInvoke 正規化"}`;
  if (!pr) {
    expect(`A-${tag}-present`, false, `${where} 不存在`, { items, platform });
    return;
  }
  // 2/4：types
  if (truth.types?.length) {
    expect(`A-${tag}-types`, eq(pr.types, truth.types), `${where}.types=${J(pr.types)}（Google=${J(truth.types)}）${pr.types === undefined ? " — 尚未實作" : ""}`, { items, platform, contract: "2" });
  } else {
    expect(`A-${tag}-types-absent-noFabricate`, !(Array.isArray(pr.types) && pr.types.length), `${where}.types=${J(pr.types)}（Google 未提供 types → 不得自行補成可信類型）`, { items, platform, contract: "4" });
  }
  // 2/4：primaryType（Geocoding API 本身沒有 primaryType；不得以 types[0] 等推測）
  if (truth.primaryType) {
    expect(`A-${tag}-primaryType`, pr.primaryType === truth.primaryType, `${where}.primaryType=${J(pr.primaryType)}（Google=${truth.primaryType}）${pr.primaryType === undefined ? " — 尚未實作" : ""}`, { items, platform, contract: "2" });
  } else {
    expect(`A-${tag}-primaryType-absent-noFabricate`, pr.primaryType === undefined, `${where}.primaryType=${J(pr.primaryType)}（Google 未提供 → 必須缺失）`, { items, platform, contract: "4" });
  }
  // 6/18：viewport
  if (truth.viewport) {
    expect(`A-${tag}-viewport`, eq(pr.viewport, truth.viewport), `${where}.viewport=${J(pr.viewport)}（Google geometry.viewport=${J(truth.viewport)}）${pr.viewport === undefined ? " — 尚未實作" : ""}`, { items: [...items, 18], platform, contract: "6" });
  } else {
    expect(`A-${tag}-viewport-absent`, pr.viewport === undefined, `${where}.viewport=${J(pr.viewport)}（Google 未提供 viewport → 不得帶出／推測）`, { items: [...items, 18], platform, contract: "6" });
  }
  const radius = findKeys(pr, /radius/i);
  expect(`A-${tag}-noRadius`, radius.length === 0, `${where} 無 radius 類欄位（${radius.join(",") || "無"}）— 不得自行推測／硬編碼半徑`, { items, platform, contract: "6" });
  const selfV = findKeys(pr, /validat|verified|trusted/i);
  expect(`A-${tag}-noSelfValidated`, selfV.length === 0, `${where} 無 Client 自稱 validated 欄位（${selfV.join(",") || "無"}）`, { items, platform, contract: "4" });
  // 5：身分證據與範圍證據分離（座標來自 geometry.location，不是 viewport 中心；viewport 只含四邊界）
  if (pr.viewport) {
    const vk = Object.keys(pr.viewport).sort().join(",");
    expect(`A-${tag}-viewport-shape`, vk === "east,north,south,west" && Object.values(pr.viewport).every(Number.isFinite), `${where}.viewport 只含 north/south/east/west 有限數值（${vk}）`, { items, platform, contract: "5" });
  }
  // 15/16/17：身分欄位
  expect(`A-${tag}-placeId`, pr.placeId === truth.placeId, `${where}.placeId=${J(pr.placeId)}（Google=${truth.placeId}）`, { items: [...items, 15], platform, contract: "5" });
  expect(`A-${tag}-coords`, pr.latitude === truth.lat && pr.longitude === truth.lng, `${where} 座標=${pr.latitude},${pr.longitude}（Google geometry.location=${truth.lat},${truth.lng}；不得以 viewport 中心代替）`, { items: [...items, 17], platform, contract: "5" });
  expect(`A-${tag}-adminArea`, pr.administrativeArea === truth.admin1, `${where}.administrativeArea=${J(pr.administrativeArea)}（Google admin_area_level_1=${J(truth.admin1)}）`, { items: [...items, 16], platform, contract: "5" });
  expect(`A-${tag}-countryCode`, pr.countryCode === truth.countryCode, `${where}.countryCode=${J(pr.countryCode)}（Google country short=${J(truth.countryCode)}）`, { items: [...items, 16], platform, cat: "amb", contract: "5" });
}

P("\n══ A. Provider Result 契約（envelope 與 finalizeInvoke 正規化兩層）══");
for (const S of SCEN) {
  if (S.fail) continue;
  for (const platform of ["web", "ios"]) {
    const { d } = results[S.id][platform];
    const truth = platform === "ios" && S.truthIos ? S.truthIos : S.truth;
    expect(`A-${S.id}-${platform}-noThrow`, !d.err && !d.finErr, `${platform} 直接呼叫／正規化不崩潰${d.err ? ` ERR=${d.err}` : ""}${d.finErr ? ` finERR=${d.finErr}` : ""}`, { items: S.items[platform], platform, cat: "base", contract: "7" });
    if (S.legacy && platform === "web") {
      // 舊版 Server：envelope 沒有 types → 不得視為嚴格驗證成功；成功語意維持（location 仍在）
      const pr = d.fin;
      expect(`A-${S.id}-web-legacy-ok`, !!d.env?.location && pr?.ok === true, `舊版 Server 回應 → location 仍成功、finalize ok=${pr?.ok}`, { items: S.items.web, platform: "web", cat: "base", contract: "7" });
      expect(`A-${S.id}-web-legacy-notStrict`, !(pr?.types?.length) && pr?.primaryType === undefined && findKeys(pr, /validat|verified|trusted/i).length === 0, `舊版 Server 回應 → finalize types=${J(pr?.types)} primaryType=${J(pr?.primaryType)}（不得補成嚴格驗證）`, { items: S.items.web, platform: "web", contract: "4,7" });
      continue;
    }
    contractChecks(S, platform, d.env?.providerResult, truth, "env");
    contractChecks(S, platform, d.fin, truth, "fin");
    // 15：同一平台跨層 Place ID 一致（envelope.providerResult → finalize → e2e TripLocation）
    const { e } = results[S.id][platform];
    const chain = [d.env?.providerResult?.placeId, d.env?.location?.placeId, d.fin?.placeId, e.loc?.placeId];
    expect(`A-${S.id}-${platform}-placeIdChain`, chain.every((x) => x === truth.placeId), `${platform} placeId 鏈 envPR/envLoc/fin/e2e=${J(chain)}（Google=${truth.placeId}）`, { items: [...S.items[platform], 15], platform, contract: "5" });
    // 17：e2e 座標＝Provider 座標
    expect(`A-${S.id}-${platform}-e2eCoords`, e.loc?.lat === truth.lat && e.loc?.lng === truth.lng, `${platform} e2e 座標=${e.loc?.lat},${e.loc?.lng}（Google=${truth.lat},${truth.lng}）`, { items: [...S.items[platform], 17], platform, contract: "5" });
    // 5：TripLocation（身分）不得混入搜尋範圍欄位
    const scopeInLoc = [...findKeys(d.env?.location, /viewport|radius|searchScope|geographicScope/i), ...findKeys(e.loc, /viewport|radius|searchScope|geographicScope/i)];
    expect(`A-${S.id}-${platform}-locNoScope`, scopeInLoc.length === 0, `${platform} TripLocation 無範圍欄位（${scopeInLoc.join(",") || "無"}）`, { items: S.items[platform], platform, contract: "5" });
  }
}

// ════ B. 失敗情境（timeout／null／ZERO_RESULTS）════
P("\n══ B. Provider 失敗情境：不崩潰、不產生 location、不帶出 types／viewport ══");
for (const S of SCEN.filter((s) => s.fail)) {
  for (const platform of ["web", "ios"]) {
    const { d, e } = results[S.id][platform];
    const items = S.items[platform];
    expect(`B-${S.id}-${platform}-noThrow`, !d.err && !d.finErr && !e.err, `${platform} 不崩潰${d.err ? ` ERR=${d.err}` : ""}${d.finErr ? ` finERR=${d.finErr}` : ""}${e.err ? ` e2eERR=${e.err}` : ""}`, { items, platform, contract: "7" });
    expect(`B-${S.id}-${platform}-noLocation`, !d.env?.location, `${platform} envelope.location=${J(d.env?.location ?? null)}（Provider 失敗不得產生 Provider 目的地）`, { items, platform, cat: "base", contract: "7" });
    // e2e 若有 location，只能是既有 approx center fallback（placeId=approx:*），且不得帶 Provider 證據或 validated
    const approxOk = e.loc == null || (/^approx:/.test(e.loc.placeId ?? "") && findKeys(e.loc, /types|primaryType|viewport|radius|validat|verified|trusted/i).length === 0);
    expect(`B-${S.id}-${platform}-e2eNoProviderEvidence`, approxOk, `${platform} e2e=${e.loc ? `placeId=${e.loc.placeId}` : "null"}（失敗時只允許既有 approx fallback，且不得帶出 Provider 證據）`, { items, platform, contract: "4,7" });
    if (e.loc) info(`${S.id} ${platform} e2e 走既有 approx center fallback：${e.loc.placeId} ${e.loc.lat},${e.loc.lng}（Provider 失敗但仍有目的地；後續 Trust Boundary 需辨識為無 Provider 證據）`);
    expect(`B-${S.id}-${platform}-finNotOk`, d.fin?.ok === false, `${platform} finalize ok=${d.fin?.ok} failureReason=${d.fin?.failureReason}`, { items, platform, cat: "base", contract: "7" });
    const pr = d.env?.providerResult;
    expect(`B-${S.id}-${platform}-noScopeOnFail`, !pr?.types?.length && pr?.viewport === undefined && d.fin?.viewport === undefined && findKeys(d.fin, /radius|validat|verified|trusted/i).length === 0, `${platform} 失敗時不得帶出 types／viewport／radius／validated`, { items: [...items, 18], platform, contract: "4,6" });
  }
}

// ════ C. 舊版 Provider 形狀（finalize 正規化）════
P("\n══ C. 舊版 Provider 回應形狀 → normalizeDestinationProviderResponse ══");
for (const [k, v] of Object.entries(results.__legacy)) {
  expect(`C-legacyShape-${k}-noThrow`, !v.threw, `${k} 不崩潰${v.threw ? ` ERR=${v.threw}` : ""}`, { items: [11], platform: "both", cat: "base", contract: "7" });
  if (!v.threw) expect(`C-legacyShape-${k}-notStrict`, !(v.types?.length) && v.primaryType == null && v.selfValidated.length === 0, `${k} types=${J(v.types)} primaryType=${J(v.primaryType)} validated=${v.selfValidated.join(",") || "無"}（舊版不得視為嚴格驗證成功）`, { items: [11], platform: "both", contract: "4,7" });
}

// ════ D. Web／iOS 一致性 ════
P("\n══ D. Web／iOS 結果一致性（同一份 Google 回應）══");
const ID_KEYS = ["ok", "placeId", "latitude", "longitude", "country", "countryCode", "administrativeArea", "locality", "types", "primaryType", "viewport"];
const LOC_ID_KEYS = ["placeId", "country", "city", "region", "district", "sublocality", "lat", "lng"];
for (const S of SCEN) {
  if (S.legacy) continue;
  const w = results[S.id].web;
  const i = results[S.id].ios;
  const levels = [
    ["envelope.providerResult", w.d.env?.providerResult, i.d.env?.providerResult, ID_KEYS],
    ["finalize", w.d.fin, i.d.fin, ID_KEYS],
    ["envelope.location", w.d.env?.location, i.d.env?.location, LOC_ID_KEYS],
    ["e2e.location", w.e.loc, i.e.loc, LOC_ID_KEYS],
  ];
  // 失敗情境的 Web envelope 依定義可能為 null（serverFn 回 null）→ 只比 e2e
  for (const [level, a, b, keys] of S.fail ? levels.slice(3) : levels) {
    const dk = keys.filter((k) => !eq(a?.[k], b?.[k]));
    const diff = dk.map((k) => `${k}: web=${J(a?.[k])} ios=${J(b?.[k])}`);
    const extra = [];
    if (dk.includes("placeId")) extra.push(15);
    if (dk.some((k) => ["country", "countryCode", "administrativeArea", "region"].includes(k))) extra.push(16);
    if (dk.some((k) => ["latitude", "longitude", "lat", "lng"].includes(k))) extra.push(17);
    if (dk.includes("viewport")) extra.push(18);
    expect(`D-${S.id}-${level}`, diff.length === 0, `${level} 一致${diff.length ? `；差異：${diff.join("；")}` : ""}`, { items: [19, ...extra, ...new Set([...S.items.web, ...S.items.ios])], platform: "both", contract: "1" });
  }
  const fa = [w.d.env?.providerResult?.formattedAddress, i.d.env?.providerResult?.formattedAddress];
  if (fa[0] !== fa[1]) info(`${S.id} formattedAddress 不一致（未列入斷言，見歧義）：web=${J(fa[0])} ios=${J(fa[1])}`);
}

// ════ E. 一般流程基準（BASELINE）════
P("\n══ E. 一般流程基準（location／error／既有 providerResult 欄位／isGeographicPlaceTypes／呼叫次數／Field Mask）══");
// 基準錄製於 aa2db59＋工作區未提交修改（A1 實作前）；以 --dump-baseline 產生。之後驗收比對，不得改變。
const BASELINE = await import(`${WORK_ROOT}/scripts/verify-provider-trust-contract-a1.baseline.mjs`).then((m) => m.BASELINE).catch(() => null);
/** 基準比對：基準中已存在（非 undefined）的欄位不得改變；新增欄位不影響 */
function baseDiff(golden, now, path = "") {
  if (golden === null || typeof golden !== "object" || Array.isArray(golden)) return eq(golden, now) ? [] : [`${path || "."}: 基準=${J(golden)} 現在=${J(now)}`];
  if (now === null || typeof now !== "object") return [`${path || "."}: 基準=${J(golden)} 現在=${J(now)}`];
  return Object.keys(golden).flatMap((k) => baseDiff(golden[k], now[k], `${path}${k}.`));
}
if (BASELINE === null) {
  expect("E-baseline-present", false, "BASELINE 尚未錄製（以 --dump-baseline 產生後嵌入）", { cat: "base" });
} else {
  for (const [key, golden] of Object.entries(BASELINE)) {
    const now = NOW_BASE[key];
    if (key === "isGeographicPlaceTypes") {
      for (const [k, v] of Object.entries(golden)) expect(`E-isGeographicPlaceTypes-${k}`, now?.[k] === v, `isGeographicPlaceTypes(${k})=${now?.[k]}（基準=${v}）`, { items: [9, 10, 6, 8], platform: "both", cat: "base", contract: "3" });
      continue;
    }
    if (key === "legacyShapes") {
      const diff = baseDiff(golden, now);
      expect(`E-legacyShapes`, diff.length === 0, diff.length ? diff.join("；") : "舊版形狀正規化結果與基準相同", { items: [11], platform: "both", cat: "base", contract: "7" });
      continue;
    }
    const [sid, platform] = key.split("|");
    const S = SCEN.find((s) => s.id === sid);
    const items = S?.items?.[platform] ?? [];
    // 基準本身是崩潰（已知缺陷）時，不把崩潰當成必須維持的外部語意 → 記為 amb
    const crashed = golden.directErr != null || golden.finErr != null || golden.e2e?.err != null;
    for (const part of ["env", "fin", "directErr", "finErr", "e2e"]) {
      const diff = baseDiff(golden[part], now?.[part]);
      expect(`E-${sid}-${platform}-${part}`, diff.length === 0, `${diff.length ? diff.join("；") : `${part} 與基準相同`}${crashed ? "（基準含崩潰，僅供參考）" : ""}`, { items, platform, cat: crashed ? "amb" : "base", contract: "3,7" });
    }
    // 20：成本 — 每類 Google 請求數不得增加；Field Mask 不得擴大
    for (const part of ["directCounts", "e2eCounts"]) {
      const g = golden[part];
      const n = now?.[part] ?? {};
      const inc = Object.keys(g).filter((k) => (n[k] ?? 0) > g[k]).map((k) => `${k} ${g[k]}→${n[k]}`);
      expect(`E-${sid}-${platform}-${part}`, inc.length === 0,`${part}=${J(n)}（基準=${J(g)}）${inc.length ? ` 增加：${inc.join(",")}` : ""}`, { items: [...items, 20], platform, cat: crashed ? "amb" : "base", contract: "3" });
    }
    for (const part of ["directMasks", "e2eMasks"]) {
      // Field Mask 不得擴大：現在的遮罩集合必須是基準的子集合
      const extraMasks = (now?.[part] ?? []).filter((m) => !golden[part].includes(m));
      expect(`E-${sid}-${platform}-${part}`, extraMasks.length === 0, `${part}=${J(now?.[part])}（基準=${J(golden[part])}）${extraMasks.length ? ` 新增：${extraMasks.join(",")}` : ""}`, { items: [...items, 20], platform, cat: crashed ? "amb" : "base", contract: "3" });
    }
  }
  const missing = Object.keys(NOW_BASE).filter((k) => !(k in BASELINE));
  expect("E-baseline-complete", missing.length === 0, missing.length ? `基準缺少：${missing.join("、")}` : `基準涵蓋 ${Object.keys(BASELINE).length} 組`, { cat: "base" });
}
// 成本：iOS 不得呼叫 serverFn；請求皆通過真實 googleRestRequest 契約
for (const S of SCEN) {
  const i = results[S.id].ios.e;
  expect(`E-${S.id}-ios-noServerFn`, i.serverFnCalls === 0, `iOS e2e serverFn 呼叫=${i.serverFnCalls}（原生殼應只走 Client）`, { items: [...S.items.ios, 20], platform: "ios", cat: "base", contract: "1,3" });
}
{
  const rej = reqs.filter((r) => r.specErr);
  expect("E-googleRestRequest-allAccepted", rej.length === 0, `全部 ${reqs.length} 個 Mock Google 請求通過真實 googleRestRequest 契約（拒絕 ${rej.length}${rej.length ? `：${rej.slice(0, 3).map((r) => `${r.kind}:${r.specErr}`).join("；")}` : ""}）`, { items: [20], platform: "both", cat: "base", contract: "3" });
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();

// ── 呼叫次數摘要 ──
P("\n══ 呼叫次數（Mock Google；direct＝單次 envelope 呼叫；e2e＝geocodeDestinationWithFallback）══");
for (const S of SCEN) {
  const f = (x) => `g=${x.geocode}/a=${x.autocomplete}/d=${x.details}`;
  const w = results[S.id].web;
  const i = results[S.id].ios;
  P(`  ${S.id.padEnd(30)} Web direct ${f(w.d.counts)} e2e ${f(w.e.counts)} serverFn=${w.e.serverFnCalls} │ iOS direct ${f(i.d.counts)} e2e ${f(i.e.counts)}`);
}

// ── 20 項必驗情境矩陣 ──
P("\n══ 必驗情境矩陣（目前程式；contract/amb FAIL＝缺口重現；base FAIL＝一般流程改變）══");
const NAMES = { 1: "Web Geocoding 城市", 2: "iOS Geocoding 城市", 3: "Web 行政區", 4: "iOS 行政區", 5: "Places Details 備援", 6: "types 缺失", 7: "primaryType 缺失", 8: "一般 POI", 9: "political+establishment", 10: "geocode／plus_code", 11: "舊版 Provider 回應", 12: "Provider timeout", 13: "Provider null", 14: "ZERO_RESULTS", 15: "Place ID 一致性", 16: "Country／Region 一致性", 17: "Provider Coordinates", 18: "viewport 有／無", 19: "Web／iOS 一致性", 20: "成本與呼叫次數" };
const cell = (n, plat) => {
  const rs = rows.filter((r) => r.items.includes(n) && (r.platform === plat || r.platform === "both"));
  if (!rs.length) return "UNVERIFIED";
  const f = rs.filter((r) => !r.ok);
  if (!f.length) return `PASS(${rs.length})`;
  const fc = f.filter((r) => r.cat !== "base").length;
  const fb = f.filter((r) => r.cat === "base").length;
  return `FAIL(${f.length}/${rs.length}${fc ? ` 缺口${fc}` : ""}${fb ? ` 基準${fb}` : ""})`;
};
const MATRIX = {};
for (let n = 1; n <= 20; n += 1) {
  const web = n === 2 || n === 4 ? "—" : cell(n, "web");
  const ios = n === 1 || n === 3 ? "—" : cell(n, "ios");
  MATRIX[n] = { web, ios };
  P(`  ${String(n).padStart(2)} ${NAMES[n].padEnd(22)} Web=${web.padEnd(26)} iOS=${ios}`);
}

const fails = rows.filter((r) => !r.ok);
const baseFails = fails.filter((r) => r.cat === "base");
P("\n══ 摘要 ══");
for (const cat of ["contract", "amb", "base"]) {
  const rs = rows.filter((r) => r.cat === cat);
  P(`  [${cat}] PASS=${rs.filter((r) => r.ok).length} FAIL=${rs.filter((r) => !r.ok).length}`);
}
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-provider-trust-contract-a1: PASS=${rows.length - fails.length} FAIL=${fails.length}（基準 FAIL=${baseFails.length}）→ ${fails.length || external ? "FAIL" : "PASS"}`);
// REL-1：stdout 是 pipe 時，write 後立刻 process.exit 會截斷輸出（看不到摘要）；等寫完再結束。
process.stdout.write(`${out.join("\n")}\n`, () => process.exit(fails.length || external ? 1 : 0));
