#!/usr/bin/env node
/**
 * A1-T2 — Trust Boundary Step A1 Provider 契約：邊界補測（獨立驗收用，離線）。
 *
 * 補 verify-provider-trust-contract-a1.mjs 未涵蓋的邊界：
 *   viewport 不完整、placeId 對不到結果的證據回退、多筆 results 證據來源、Details 只有 primaryType、
 *   countryCode 非 ISO-2、types 為空陣列、null body、envelope 證據合併防護、DPR 分支 viewport。
 *
 * 載入方式同 verify-provider-trust-contract-a1.mjs（程序內 vite-node API；只 stub 傳輸／框架模組）。
 * 另以 Vite load hook 在「pre」模式把三個 A1 修改檔換成 scratchpad 的 *.pre-A1 內容（唯讀），
 * 以同一組 Mock 比對修改前後的外部可觀察結果與 Google 請求數。不寫任何檔案。
 * 外部網路全部攔截，任何一次即 FAIL。
 * 執行：node scripts/verify-provider-trust-contract-a1-edges.mjs
 */
import { readFileSync } from "node:fs";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const PRE_FILES = {
  [`${WORK_ROOT}/src/lib/location.functions.ts`]: `${PRE_DIR}/location.functions.ts.pre-A1`,
  [`${WORK_ROOT}/src/lib/ai/destination-geocode-client.ts`]: `${PRE_DIR}/destination-geocode-client.ts.pre-A1`,
  [`${WORK_ROOT}/src/lib/ai/destination-provider-result.ts`]: `${PRE_DIR}/destination-provider-result.ts.pre-A1`,
};

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
    export async function googleRestFetch(input, init, context) { return globalThis.__A1E_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A1E_NATIVE === true; }`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a1e-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
let MODE = "post";
const plugin = {
  name: "a1e-stubs",
  enforce: "pre",
  resolveId(id) {
    return Object.hasOwn(STUBS, id) ? STUB_PATH(id) : null;
  },
  load(id) {
    const k = STUB_BY_PATH[id];
    if (k) return STUBS[k];
    const clean = id.split("?")[0];
    if (MODE === "pre" && PRE_FILES[clean]) return readFileSync(PRE_FILES[clean], "utf8");
    return null;
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
  plugins: [plugin, tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
async function freshModules(mode) {
  MODE = mode;
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);
  return {
    dpr: await imp("lib/ai/destination-provider-result.ts"),
    lf: await imp("lib/location.functions.ts"),
    dgc: await imp("lib/ai/destination-geocode-client.ts"),
  };
}

// ── Mock Google（同 a1 probe 的格式；Details 依 Field Mask 過濾頂層欄位）──
const NULLBODY = Symbol("null-body");
const ZERO = { status: "ZERO_RESULTS", results: [] };
let G = {};
const reqs = [];
globalThis.__A1E_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  const fieldMask = headers.get("X-Goog-FieldMask") ?? "";
  const kind = url.pathname.includes("/geocode/json") ? "geocode" : url.pathname.endsWith("places:autocomplete") ? "autocomplete" : url.pathname.startsWith("/v1/places/") ? "details" : "other";
  reqs.push({ kind, fieldMask });
  const h = G[kind];
  let r = typeof h === "function" ? h() : h;
  if (r === undefined) r = kind === "geocode" ? ZERO : {};
  if (r === NULLBODY) return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  let json = r;
  if (kind === "details" && fieldMask && json && typeof json === "object") {
    const allow = new Set(fieldMask.split(","));
    json = Object.fromEntries(Object.entries(json).filter(([k]) => allow.has(k)));
  }
  return Response.json(json);
};

const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const vpG = (n, s, e, w) => ({ northeast: { lat: n, lng: e }, southwest: { lat: s, lng: w } });
function gres({ pid, fa, lat, lng, types, comps, viewport }) {
  const r = { address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE" } };
  if (pid !== undefined) r.place_id = pid;
  if (viewport) r.geometry.viewport = viewport;
  if (types !== undefined) r.types = types;
  return r;
}
const JP = comp("日本", "JP", ["country", "political"]);
const OSAKA_CITY = gres({ pid: "mock-pid-osaka-city", fa: "日本大阪府大阪市", lat: 34.6937, lng: 135.5023, types: ["locality", "political"], comps: [comp("大阪市", "大阪市", ["locality", "political"]), comp("大阪府", "大阪府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(34.7712, 34.5715, 135.6111, 135.3478) });
const OSAKA_PREF = gres({ pid: "mock-pid-osaka-pref", fa: "日本大阪府", lat: 34.6863, lng: 135.52, types: ["administrative_area_level_1", "political"], comps: [comp("大阪府", "大阪府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(35.0514, 34.2715, 135.7464, 135.0917) });
const KIYOMIZU = gres({ pid: "mock-pid-kiyomizu", fa: "日本京都府京都市東山區清水1丁目294", lat: 34.9949, lng: 135.785, types: ["establishment", "point_of_interest", "tourist_attraction"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(34.9963, 34.9936, 135.7864, 135.7837) });
const KYOTO_NOPID = gres({ pid: undefined, fa: "日本京都府京都市", lat: 35.0116, lng: 135.7681, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(35.3212, 34.8743, 135.8796, 135.559) });
const clone = (x) => structuredClone(x);
const withVp = (r, vp) => { const c = clone(r); if (vp === undefined) delete c.geometry.viewport; else c.geometry.viewport = vp; return c; };
const withTypes = (r, t) => { const c = clone(r); if (t === undefined) delete c.types; else c.types = t; return c; };
const withCountryShort = (r, short) => { const c = clone(r); c.address_components = c.address_components.map((x) => (x.types.includes("country") ? { ...x, short_name: short } : x)); return c; };
const OK = (...results) => ({ status: "OK", results });

const pc = (long, short, types) => ({ longText: long, shortText: short, types, languageCode: "zh-TW" });
const DET_KANAZAWA = { id: "mock-pid-kanazawa", displayName: { text: "金澤市", languageCode: "zh-TW" }, formattedAddress: "日本石川縣金澤市", location: { latitude: 36.5613, longitude: 136.6562 }, addressComponents: [pc("金澤市", "金澤市", ["locality", "political"]), pc("石川縣", "石川縣", ["administrative_area_level_1", "political"]), pc("日本", "JP", ["country", "political"])], types: ["locality", "political"], primaryType: "locality", viewport: { low: { latitude: 36.4, longitude: 136.48 }, high: { latitude: 36.71, longitude: 136.83 } } };
const det = (patch) => { const c = clone(DET_KANAZAWA); for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete c[k]; else c[k] = v; } return c; };
const AUTO = { suggestions: [{ placePrediction: { placeId: "mock-pid-kanazawa", text: { text: "日本石川縣金澤市" }, types: ["locality", "political"] } }] };

// ── 斷言 ──
const out = [];
const rows = [];
const P = (s) => out.push(s);
const J = (v) => JSON.stringify(v, (k, x) => (x === undefined ? "∅" : x));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function expect(id, cond, detail, cat = "edge") {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : cat === "info" ? "DIFF" : "FAIL"} [${cat}] ${id}：${detail}`);
}
function findKeys(obj, re, path = "", acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && v !== undefined && v !== null && v !== false) acc.push(`${path}${k}`);
    findKeys(v, re, `${path}${k}.`, acc);
  }
  return acc;
}
const PR_KEYS = ["ok", "status", "latitude", "longitude", "formattedAddress", "country", "administrativeArea", "locality", "provider", "rawResultCount", "parsedResultCount", "failureReason", "httpStatus", "placeId", "sourceShape", "query"];
const LOC_KEYS = ["placeId", "country", "city", "region", "district", "sublocality", "lat", "lng", "formattedName", "displayLabel", "address", "timezone", "utcOffsetMinutes"];
const pick = (o, keys) => (o == null ? null : Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])));
const vpConv = (v) => ({ north: v.northeast.lat, south: v.southwest.lat, east: v.northeast.lng, west: v.southwest.lng });

async function runFlow(M, platform, S) {
  G = (platform === "ios" && S.Gios) || S.G;
  globalThis.__A1E_NATIVE = platform === "ios";
  const r0 = reqs.length;
  let env = null;
  let err = null;
  try {
    if (platform === "web") {
      env = await M.lf.geocodeTripLocationFromText({ data: { query: S.dest, destinationName: S.dest, locale: "zh-TW", language: "zh-TW", disableLocaleRegionBias: true, placesFallback: S.phase === "places" } });
    } else {
      env = await M.dgc.geocodeDestinationViaClient(S.phase === "places" ? { query: S.dest, destinationName: S.dest, locale: "zh-TW", placesFallback: true, autocompleteOnly: true, placeDetailsBudget: 1 } : { query: S.dest, destinationName: S.dest, locale: "zh-TW", placesFallback: false });
    }
  } catch (e) {
    err = String(e?.message ?? e);
  }
  globalThis.__A1E_NATIVE = false;
  const finProvider = S.phase === "places" ? "places_autocomplete" : platform === "web" ? "geocode_fn" : "geocode";
  let fin = null;
  let finErr = null;
  try {
    fin = M.dpr.normalizeDestinationProviderResponse(env, { provider: finProvider, query: S.dest });
  } catch (e) {
    finErr = String(e?.message ?? e);
  }
  const used = reqs.slice(r0);
  const masks = [...new Set(used.map((r) => `${r.kind}:${r.fieldMask}`))].sort();
  return { env, err, fin, finErr, n: { g: used.filter((r) => r.kind === "geocode").length, a: used.filter((r) => r.kind === "autocomplete").length, d: used.filter((r) => r.kind === "details").length }, masks };
}
const extSem = (r) => ({ err: r.err, finErr: r.finErr, location: pick(r.env?.location, LOC_KEYS), error: r.env?.error ?? null, pr: pick(r.env?.providerResult, PR_KEYS), fin: pick(r.fin, PR_KEYS) });

// ════ 1. Flow 邊界（Web／iOS × pre／post）════
const FLOWS = [
  { id: "vpMissingWest", dest: "大阪", phase: "geo", G: { geocode: OK(withVp(OSAKA_CITY, { northeast: { lat: 34.7712, lng: 135.6111 }, southwest: { lat: 34.5715 } })) }, expect: { types: ["locality", "political"], viewport: undefined, countryCode: "JP", placeId: "mock-pid-osaka-city" } },
  { id: "vpMissingSouthwest", dest: "大阪", phase: "geo", G: { geocode: OK(withVp(OSAKA_CITY, { northeast: { lat: 34.7712, lng: 135.6111 } })) }, expect: { types: ["locality", "political"], viewport: undefined, countryCode: "JP", placeId: "mock-pid-osaka-city" } },
  { id: "vpNonFinite", dest: "大阪", phase: "geo", G: { geocode: OK(withVp(OSAKA_CITY, { northeast: { lat: "abc", lng: 135.6111 }, southwest: { lat: 34.5715, lng: 135.3478 } })) }, expect: { types: ["locality", "political"], viewport: undefined, countryCode: "JP", placeId: "mock-pid-osaka-city" } },
  // 多筆：Web pickBestGeocodeResult 挑 大阪市（第 2 筆）；iOS 取 candidates[0]（大阪府）→ 各自證據必須來自自己挑中的那筆
  { id: "multiPrefThenCity", dest: "大阪", phase: "geo", G: { geocode: OK(OSAKA_PREF, OSAKA_CITY) }, expectWeb: { placeId: "mock-pid-osaka-city", types: OSAKA_CITY.types, viewport: vpConv(OSAKA_CITY.geometry.viewport), countryCode: "JP" }, expectIos: { placeId: "mock-pid-osaka-pref", types: OSAKA_PREF.types, viewport: vpConv(OSAKA_PREF.geometry.viewport), countryCode: "JP" } },
  // 多筆且被挑中的那筆沒有 place_id → 只能以座標比對回退
  { id: "multiPickedNoPlaceId", dest: "京都", phase: "geo", G: { geocode: OK(KIYOMIZU, KYOTO_NOPID) }, expectWeb: { latitude: 35.0116, types: KYOTO_NOPID.types, viewport: vpConv(KYOTO_NOPID.geometry.viewport), countryCode: "JP" }, expectIos: { placeId: "mock-pid-kiyomizu", types: KIYOMIZU.types, viewport: vpConv(KIYOMIZU.geometry.viewport), countryCode: "JP" } },
  { id: "countryNonIso-日本", dest: "大阪", phase: "geo", G: { geocode: OK(withCountryShort(OSAKA_CITY, "日本")) }, expect: { types: ["locality", "political"], viewport: vpConv(OSAKA_CITY.geometry.viewport), countryCode: undefined, placeId: "mock-pid-osaka-city" } },
  { id: "countryNonIso-JPN", dest: "大阪", phase: "geo", G: { geocode: OK(withCountryShort(OSAKA_CITY, "JPN")) }, expect: { types: ["locality", "political"], viewport: vpConv(OSAKA_CITY.geometry.viewport), countryCode: undefined, placeId: "mock-pid-osaka-city" } },
  { id: "countryLower-jp", dest: "大阪", phase: "geo", G: { geocode: OK(withCountryShort(OSAKA_CITY, "jp")) }, expect: { types: ["locality", "political"], viewport: vpConv(OSAKA_CITY.geometry.viewport), countryCode: "JP", placeId: "mock-pid-osaka-city" } },
  { id: "typesEmpty-geocode", dest: "大阪", phase: "geo", G: { geocode: OK(withTypes(OSAKA_CITY, [])) }, expect: { types: undefined, viewport: vpConv(OSAKA_CITY.geometry.viewport), countryCode: "JP", placeId: "mock-pid-osaka-city" } },
  { id: "typesJunk-geocode", dest: "大阪", phase: "geo", G: { geocode: OK(withTypes(OSAKA_CITY, [1, null, " ", "locality"])) }, expect: { types: ["locality"], viewport: vpConv(OSAKA_CITY.geometry.viewport), countryCode: "JP", placeId: "mock-pid-osaka-city" } },
  { id: "detailsPrimaryOnly", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: det({ types: undefined }) }, expect: { types: undefined, primaryType: "locality", viewport: undefined, countryCode: "JP", placeId: "mock-pid-kanazawa" } },
  { id: "detailsTypesEmpty", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: det({ types: [], primaryType: undefined }) }, expect: { types: undefined, primaryType: undefined, viewport: undefined, countryCode: "JP", placeId: "mock-pid-kanazawa" } },
  { id: "detailsCountryNonIso", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: det({ addressComponents: [pc("金澤市", "金澤市", ["locality", "political"]), pc("日本", "JPN", ["country", "political"])] }) }, expect: { types: ["locality", "political"], primaryType: "locality", viewport: undefined, countryCode: undefined, placeId: "mock-pid-kanazawa" } },
  // null body：只有 Geocoding 回 null（其餘正常 ZERO）；Web 對照組＝{} body
  { id: "nullGeocodeOnly", dest: "京都", phase: "geo", G: { geocode: NULLBODY }, fail: true },
  { id: "emptyObjGeocodeOnly", dest: "京都", phase: "geo", G: { geocode: {} }, fail: true },
  { id: "nullDetailsOnly", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: NULLBODY }, fail: true },
  { id: "nullAutocompleteOnly", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: NULLBODY }, fail: true },
  { id: "emptyObjDetailsOnly", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: {} }, fail: true },
  { id: "emptyObjAutocompleteOnly", dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: {} }, fail: true },
];

const flowRes = {};
for (const mode of ["pre", "post"]) {
  for (const S of FLOWS) {
    for (const platform of ["web", "ios"]) {
      const M = await freshModules(mode);
      flowRes[`${mode}|${S.id}|${platform}`] = await runFlow(M, platform, S);
    }
  }
}

P("\n══ 1. Flow 邊界：證據值（post）＋外部語意／請求數（pre vs post）══");
for (const S of FLOWS) {
  for (const platform of ["web", "ios"]) {
    const pre = flowRes[`pre|${S.id}|${platform}`];
    const post = flowRes[`post|${S.id}|${platform}`];
    const tag = `${S.id}-${platform}`;
    expect(`${tag}-post-noThrow`, !post.err && !post.finErr, `post 不崩潰${post.err ? ` ERR=${post.err}` : ""}${post.finErr ? ` finERR=${post.finErr}` : ""}（pre：${pre.err ?? "無例外"}）`);
    const semSame = eq(extSem(pre), extSem(post));
    const crashedPre = Boolean(pre.err || pre.finErr);
    // pre 崩潰（已知缺陷）時差異記為 info（不當作必須維持的外部語意），其餘差異為 FAIL
    const cat = crashedPre ? "info" : "edge";
    expect(`${tag}-extSemantics-unchanged`, semSame, semSame ? "既有 location／error／providerResult 既有欄位／finalize 與 pre 相同" : `差異（pre 崩潰=${crashedPre}）：pre=${J(extSem(pre))} post=${J(extSem(post))}`, cat);
    const inc = ["g", "a", "d"].filter((k) => post.n[k] > pre.n[k]);
    expect(`${tag}-cost`, inc.length === 0, `請求數 pre=${J(pre.n)} post=${J(post.n)}${inc.length ? ` 增加 ${inc.join(",")}${crashedPre ? "（pre 崩潰中止）" : ""}` : ""}`, cat);
    const newMasks = post.masks.filter((m) => !pre.masks.includes(m));
    expect(`${tag}-fieldMask`, newMasks.length === 0, `Field Mask post=${J(post.masks)}${newMasks.length ? ` 新增 ${newMasks.join(",")}` : ""}`, cat);
    for (const [lvl, pr] of [["env", post.env?.providerResult], ["fin", post.fin]]) {
      const bad = findKeys(pr, /radius|validat|verified|trusted/i);
      expect(`${tag}-${lvl}-noRadiusNoValidated`, bad.length === 0, `${lvl} 無 radius／validated（${bad.join(",") || "無"}）`);
      if (S.fail) {
        expect(`${tag}-${lvl}-failNoEvidence`, pr?.ok !== true && !pr?.types && pr?.viewport === undefined && pr?.primaryType === undefined, `失敗時 ok=${pr?.ok} types=${J(pr?.types)} viewport=${J(pr?.viewport)}`);
        continue;
      }
      const want = (platform === "web" ? S.expectWeb : S.expectIos) ?? S.expect;
      for (const [k, v] of Object.entries(want)) {
        expect(`${tag}-${lvl}-${k}`, eq(pr?.[k], v), `${lvl}.${k}=${J(pr?.[k])}（預期 ${J(v)}）`);
      }
      // 證據必須來自實際被挑中的那筆：placeId／座標一致的 Google result
      if (pr?.viewport) expect(`${tag}-${lvl}-viewportShape`, Object.keys(pr.viewport).sort().join(",") === "east,north,south,west", `viewport 鍵=${Object.keys(pr.viewport).sort().join(",")}`);
    }
    const loc = post.env?.location;
    const scope = findKeys(loc, /viewport|radius|types|primaryType|validat/i);
    expect(`${tag}-locationNoEvidence`, scope.length === 0, `TripLocation 未混入證據／範圍欄位（${scope.join(",") || "無"}）`);
  }
}
// null 與 {} 對照：A1 在 Web 三處（Geocoding／Autocomplete／Details）與 iOS Autocomplete 把 null body 視為 {}，
// 結果必須與 {} body 完全相同（含請求數）。iOS Geocoding／Details 的 null 處理 A1 未修改 → 只比 pre/post（上方 extSemantics）。
for (const [nullId, objId, platforms] of [["nullGeocodeOnly", "emptyObjGeocodeOnly", ["web"]], ["nullAutocompleteOnly", "emptyObjAutocompleteOnly", ["web", "ios"]], ["nullDetailsOnly", "emptyObjDetailsOnly", ["web"]]]) {
  for (const platform of platforms) {
    const a = flowRes[`post|${nullId}|${platform}`];
    const b = flowRes[`post|${objId}|${platform}`];
    expect(`${nullId}-equals-${objId}-${platform}`, eq(extSem(a), extSem(b)) && eq(a.n, b.n), `null body 與 {} body 結果相同：null=${J({ ...extSem(a), n: a.n })} {}=${J({ ...extSem(b), n: b.n })}`);
  }
}
for (const id of ["nullGeocodeOnly", "nullDetailsOnly"]) {
  const a = flowRes[`post|${id}|ios`];
  const b = flowRes[`post|${id.replace("null", "emptyObj")}|ios`];
  P(`  INFO iOS ${id}（A1 未改）：null 與 {} 的 sourceShape／failureReason ${eq(extSem(a), extSem(b)) ? "相同" : `不同：null=${J(a.env?.providerResult?.sourceShape)}/${J(a.env?.error)} {}=${J(b.env?.providerResult?.sourceShape)}/${J(b.env?.error)}`}`);
}

// ════ 2. 函式層邊界（post only）════
P("\n══ 2. 函式層邊界（providerEvidence*／withEnvelopeEvidence／DPR 分支）══");
const M = await freshModules("post");
const Mpre = await freshModules("pre");
const Mpost = await freshModules("post");
const {
  providerEvidenceForGeocodeLocation: evLoc,
  providerEvidenceFromPlaceDetails: evDet,
  providerEvidenceFromGeocodeResult: evGeo,
} = Mpost.dpr;
void M;
{
  const resp = OK(OSAKA_PREF, OSAKA_CITY);
  expect("evLoc-byPlaceId", eq(evLoc(resp, { placeId: "mock-pid-osaka-city", lat: 0, lng: 0 }).types, OSAKA_CITY.types), "placeId 命中第 2 筆 → 證據取第 2 筆（即使座標不同）");
  expect("evLoc-noMatch-empty", eq(evLoc(resp, { placeId: "mock-pid-other", lat: 1, lng: 1 }), {}), `placeId 與座標都對不到 → ${J(evLoc(resp, { placeId: "mock-pid-other", lat: 1, lng: 1 }))}（應為 {}，不得取 results[0]）`);
  expect("evLoc-coordFallback", eq(evLoc(resp, { placeId: "geocode:34.6937,135.5023", lat: 34.6937, lng: 135.5023 }).types, OSAKA_CITY.types), "合成 placeId → 以 geometry.location 精確座標回退");
  expect("evLoc-nullResponse", eq(evLoc(null, { placeId: "x", lat: 1, lng: 1 }), {}) && eq(evLoc({ results: "x" }, { placeId: "x", lat: 1, lng: 1 }), {}) && eq(evLoc(resp, null), {}), "response null／results 非陣列／location null → {}");
  // 兩筆都沒有 place_id、location.placeId 缺失（undefined）時：不得因 undefined===undefined 誤配第一筆
  const noPid = OK(withTypes(gres({ pid: undefined, fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] }), ["establishment"]), gres({ pid: undefined, fa: "B", lat: 20, lng: 20, types: ["locality", "political"], comps: [JP] }));
  const r = evLoc(noPid, { placeId: undefined, lat: 20, lng: 20 });
  // TripLocation.placeId 型別為必填 string，現行兩個 Adapter 都一定給值 → 此輸入在型別契約外，記 INFO（防禦性建議）
  P(`  INFO evLoc-undefinedPlaceId（型別契約外輸入）：location.placeId=undefined、座標=第 2 筆 → types=${J(r.types)}${eq(r.types, ["locality", "political"]) ? "（正確取第 2 筆）" : "（undefined===undefined 誤配第 1 筆；現行呼叫端不可達）"}`);
  // 同座標兩筆不同結果、合成 placeId：取第一筆（記錄行為）
  const dup = OK(gres({ pid: "p1", fa: "A", lat: 30, lng: 30, types: ["establishment"], comps: [JP] }), gres({ pid: undefined, fa: "B", lat: 30, lng: 30, types: ["locality"], comps: [JP] }));
  P(`  INFO 同座標兩筆、合成 placeId → types=${J(evLoc(dup, { placeId: "geocode:30,30", lat: 30, lng: 30 }).types)}（座標回退取第一個同座標結果）`);
  expect("evGeo-noPrimaryType", evGeo(OSAKA_CITY).primaryType === undefined && evGeo({ ...clone(OSAKA_CITY), primaryType: "locality" }).primaryType === undefined, "Geocoding result 一律不帶 primaryType（即使回應夾帶）");
  expect("evDet-noViewport", evDet(DET_KANAZAWA).viewport === undefined && evDet({ ...DET_KANAZAWA, viewport: { north: 1, south: 0, east: 1, west: 0 } }).viewport === undefined, "Places Details 證據不帶 viewport（即使回應夾帶）");
  expect("evDet-countryLower", evDet(det({ addressComponents: [pc("日本", "jp", ["country"])] })).countryCode === "JP", "Details shortText 小寫 jp → JP");
  expect("evDet-null", eq(evDet(null), {}) && eq(evGeo(null), {}), "null → {}");
}
{
  const norm = (x, mod = Mpost) => mod.dpr.normalizeDestinationProviderResponse(x, { provider: "geocode_fn", query: "大阪" });
  const loc = { placeId: "mock-pid-osaka-city", country: "日本", city: "大阪市", region: "大阪府", lat: 34.6937, lng: 135.5023, formattedName: "日本・大阪市", displayLabel: "日本・大阪市" };
  const pr = { ok: true, status: "OK", latitude: 34.6937, longitude: 135.5023, provider: "geocode", rawResultCount: 1, parsedResultCount: 1, placeId: "mock-pid-osaka-city", types: ["locality", "political"], countryCode: "JP", viewport: { north: 34.77, south: 34.57, east: 135.61, west: 135.34 } };
  const ok = norm({ location: loc, error: null, providerResult: pr });
  expect("env-merge-match", eq(ok.types, pr.types) && eq(ok.viewport, pr.viewport) && ok.countryCode === "JP", `同地點 → 帶入證據 ${J({ types: ok.types, viewport: ok.viewport, countryCode: ok.countryCode })}`);
  for (const [k, patch] of [["prNotOk", { ok: false }], ["coordMismatch", { latitude: 34.7 }], ["placeIdMismatch", { placeId: "mock-pid-other" }]]) {
    const r = norm({ location: loc, error: null, providerResult: { ...pr, ...patch } });
    expect(`env-merge-guard-${k}`, r.types === undefined && r.viewport === undefined && r.countryCode === undefined, `${k} → 不帶入證據（types=${J(r.types)} viewport=${J(r.viewport)} countryCode=${J(r.countryCode)}）`);
  }
  const nonIso = norm({ location: loc, error: null, providerResult: { ...pr, countryCode: "JPN" } });
  expect("env-merge-countryNonIso", nonIso.countryCode === undefined, `providerResult.countryCode=JPN → ${J(nonIso.countryCode)}`);
  const partialVp = norm({ location: loc, error: null, providerResult: { ...pr, viewport: { north: 1, south: 0, east: 1 } } });
  expect("env-merge-partialViewport", partialVp.viewport === undefined, `providerResult.viewport 缺 west → ${J(partialVp.viewport)}`);
  // 舊版 envelope：location 沒有 country，providerResult 有 countryCode → TripLocation.country 是否改變（pre vs post）
  const locNoCountry = { ...loc, country: "" };
  const preT = Mpre.dpr.providerResultToTripLocation(norm({ location: locNoCountry, error: null, providerResult: pr }, Mpre), "大阪");
  const postT = Mpost.dpr.providerResultToTripLocation(norm({ location: locNoCountry, error: null, providerResult: pr }, Mpost), "大阪");
  P(`  INFO location.country 為空、providerResult.countryCode=JP → TripLocation.country pre=${J(preT?.country)} post=${J(postT?.country)}${preT?.country !== postT?.country ? "（countryCode 經 providerResultToTripLocation 流入 TripLocation.country）" : ""}`);
  expect("env-legacyNoCountry-tripCountry-unchanged", preT?.country === postT?.country, `TripLocation.country pre=${J(preT?.country)} post=${J(postT?.country)}`, "edge-semantics");
  // DPR 分支 viewport：缺邊 → pre 補 0、post undefined；northeast/southwest 形狀
  const dprBase = { ok: true, status: "OK", latitude: 34.6937, longitude: 135.5023, provider: "geocode", rawResultCount: 1, parsedResultCount: 1 };
  const prePartial = norm({ ...dprBase, viewport: { north: 1, south: 0, east: 1 } }, Mpre).viewport;
  const postPartial = norm({ ...dprBase, viewport: { north: 1, south: 0, east: 1 } }).viewport;
  P(`  INFO DPR 分支 viewport 缺 west：pre=${J(prePartial)} post=${J(postPartial)}`);
  expect("dpr-partialViewport-undefined", postPartial === undefined, `post=${J(postPartial)}（不得補 0／推測）`);
  const preFull = norm({ ...dprBase, viewport: { north: 1, south: 0, east: 1, west: 0 } }, Mpre).viewport;
  const postFull = norm({ ...dprBase, viewport: { north: 1, south: 0, east: 1, west: 0 } }).viewport;
  expect("dpr-fullViewport-unchanged", eq(preFull, postFull), `完整 viewport pre=${J(preFull)} post=${J(postFull)}`);
  const preNoVp = norm({ ...dprBase }, Mpre).viewport;
  const postNoVp = norm({ ...dprBase }).viewport;
  expect("dpr-noViewport-unchanged", preNoVp === undefined && postNoVp === undefined, `無 viewport pre=${J(preNoVp)} post=${J(postNoVp)}`);
  const nese = norm({ ...dprBase, viewport: vpG(2, 1, 4, 3) }).viewport;
  expect("dpr-neSwViewport", eq(nese, { north: 2, south: 1, east: 4, west: 3 }), `northeast/southwest → ${J(nese)}`);
  const dprTypesEmpty = norm({ ...dprBase, types: [], primaryType: " " });
  expect("dpr-typesEmpty-undefined", dprTypesEmpty.types === undefined && dprTypesEmpty.primaryType === undefined, `types=[] primaryType=" " → ${J({ t: dprTypesEmpty.types, p: dprTypesEmpty.primaryType })}`);
  const dprCountry = norm({ ...dprBase, countryCode: "jpn" }).countryCode;
  P(`  INFO DPR 分支 countryCode 未做 ISO-2 檢查（既有行為，A1 未改）：countryCode="jpn" → ${J(dprCountry)}；pre=${J(norm({ ...dprBase, countryCode: "jpn" }, Mpre).countryCode)}`);
  const selfClaim = norm({ ...dprBase, validated: true, trusted: true, verified: true });
  expect("dpr-dropsSelfValidated", findKeys(selfClaim, /validat|verified|trusted/i).length === 0, `Client 自稱 validated／trusted 欄位不被帶出（${findKeys(selfClaim, /validat|verified|trusted/i).join(",") || "無"}）`);
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();

P("\n══ 呼叫次數（pre → post）══");
for (const S of FLOWS) {
  const f = (x) => `g=${x.n.g}/a=${x.n.a}/d=${x.n.d}`;
  P(`  ${S.id.padEnd(22)} Web ${f(flowRes[`pre|${S.id}|web`])} → ${f(flowRes[`post|${S.id}|web`])} │ iOS ${f(flowRes[`pre|${S.id}|ios`])} → ${f(flowRes[`post|${S.id}|ios`])}${flowRes[`pre|${S.id}|web`].err ? `  [pre Web 崩潰：${flowRes[`pre|${S.id}|web`].err}]` : ""}${flowRes[`pre|${S.id}|ios`].err ? `  [pre iOS 崩潰：${flowRes[`pre|${S.id}|ios`].err}]` : ""}`);
}
const fails = rows.filter((r) => !r.ok && r.cat !== "info");
const infos = rows.filter((r) => !r.ok && r.cat === "info");
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-provider-trust-contract-a1-edges: PASS=${rows.filter((r) => r.ok).length} FAIL=${fails.length} INFO差異=${infos.length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
