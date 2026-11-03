#!/usr/bin/env node
/**
 * A1-T3 — Step A1 最小修正（L1／L2／L3）獨立驗收（離線）。
 *
 * 三種模式以 Vite load hook 換檔（唯讀 scratchpad 快照，不寫任何檔案）：
 *   preA1  ＝ *.pre-A1（A1 之前）
 *   preFix ＝ *.pre-A1fix（A1 已上、L1/L2/L3 修正前；geocode-client 無修正，用現行檔）
 *   post   ＝ 工作區現行檔
 * 載入方式同 verify-provider-trust-contract-a1-edges.mjs（程序內 vite-node API；只 stub 傳輸／框架模組）。
 * 外部網路全部攔截，任何一次即 FAIL；只用 Mock Key。
 * 執行：node scripts/verify-provider-trust-contract-a1-fix.mjs
 */
import { readFileSync } from "node:fs";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const SNAP = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const F_LF = `${WORK_ROOT}/src/lib/location.functions.ts`;
const F_DGC = `${WORK_ROOT}/src/lib/ai/destination-geocode-client.ts`;
const F_DPR = `${WORK_ROOT}/src/lib/ai/destination-provider-result.ts`;
const SWAP = {
  preA1: { [F_LF]: `${SNAP}/location.functions.ts.pre-A1`, [F_DGC]: `${SNAP}/destination-geocode-client.ts.pre-A1`, [F_DPR]: `${SNAP}/destination-provider-result.ts.pre-A1` },
  preFix: { [F_LF]: `${SNAP}/location.functions.ts.pre-A1fix`, [F_DPR]: `${SNAP}/destination-provider-result.ts.pre-A1fix` },
  post: {},
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
    export async function googleRestFetch(input, init, context) { return globalThis.__A1F_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A1F_NATIVE === true; }`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a1f-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
let MODE = "post";
const plugin = {
  name: "a1f-stubs",
  enforce: "pre",
  resolveId(id) {
    return Object.hasOwn(STUBS, id) ? STUB_PATH(id) : null;
  },
  load(id) {
    const k = STUB_BY_PATH[id];
    if (k) return STUBS[k];
    const clean = id.split("?")[0];
    const swap = SWAP[MODE][clean];
    return swap ? readFileSync(swap, "utf8") : null;
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

// ── Mock Google ──
const NULLBODY = Symbol("null-body");
const ZERO = { status: "ZERO_RESULTS", results: [] };
let G = {};
const reqs = [];
globalThis.__A1F_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const fieldMask = new Headers(init.headers).get("X-Goog-FieldMask") ?? "";
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
const KYOTO_CITY = gres({ pid: "mock-pid-kyoto-city", fa: "日本京都府京都市", lat: 35.0116, lng: 135.7681, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(35.3212, 34.8743, 135.8796, 135.559) });
const KIYOMIZU = gres({ pid: "mock-pid-kiyomizu", fa: "日本京都府京都市東山區清水1丁目294", lat: 34.9949, lng: 135.785, types: ["establishment", "point_of_interest", "tourist_attraction"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP], viewport: vpG(34.9963, 34.9936, 135.7864, 135.7837) });
const clone = (x) => structuredClone(x);
const OK = (...results) => ({ status: "OK", results });
const pc = (long, short, types) => ({ longText: long, shortText: short, types, languageCode: "zh-TW" });
const DET_KANAZAWA = { id: "mock-pid-kanazawa", displayName: { text: "金澤市", languageCode: "zh-TW" }, formattedAddress: "日本石川縣金澤市", location: { latitude: 36.5613, longitude: 136.6562 }, addressComponents: [pc("金澤市", "金澤市", ["locality", "political"]), pc("石川縣", "石川縣", ["administrative_area_level_1", "political"]), pc("日本", "JP", ["country", "political"])], types: ["locality", "political"], primaryType: "locality", viewport: { low: { latitude: 36.4, longitude: 136.48 }, high: { latitude: 36.71, longitude: 136.83 } } };
const AUTO = { suggestions: [{ placePrediction: { placeId: "mock-pid-kanazawa", text: { text: "日本石川縣金澤市" }, types: ["locality", "political"] } }] };

// ── 斷言 ──
const out = [];
const rows = [];
const P = (s) => out.push(s);
const J = (v) => JSON.stringify(v, (k, x) => (x === undefined ? "∅" : x));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function expect(item, id, cond, detail, cat = "fix") {
  rows.push({ item, id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : cat === "info" ? "DIFF" : "FAIL"} [${cat}] #${item} ${id}：${detail}`);
}
const strip = (o, keys) => (o == null ? o : Object.fromEntries(Object.entries(o).filter(([k, v]) => !keys.includes(k) && v !== undefined)));
const EVIDENCE = ["types", "primaryType", "viewport"];

async function runFlow(M, platform, S) {
  G = S.G;
  globalThis.__A1F_NATIVE = platform === "ios";
  const r0 = reqs.length;
  let env = null;
  let err = null;
  try {
    if (platform === "web") {
      env = await M.lf.geocodeTripLocationFromText({ data: { query: S.dest, destinationName: S.dest, locale: "zh-TW", language: "zh-TW", disableLocaleRegionBias: true, placesFallback: S.phase === "places" || S.placesFallback === true } });
    } else {
      env = await M.dgc.geocodeDestinationViaClient(S.phase === "places" ? { query: S.dest, destinationName: S.dest, locale: "zh-TW", placesFallback: true, autocompleteOnly: true, placeDetailsBudget: 1 } : { query: S.dest, destinationName: S.dest, locale: "zh-TW", placesFallback: false });
    }
  } catch (e) {
    err = String(e?.message ?? e);
  }
  globalThis.__A1F_NATIVE = false;
  const finProvider = S.phase === "places" ? "places_autocomplete" : platform === "web" ? "geocode_fn" : "geocode";
  let fin = null;
  let trip = null;
  let finErr = null;
  try {
    fin = M.dpr.normalizeDestinationProviderResponse(env, { provider: finProvider, query: S.dest });
    trip = M.dpr.providerResultToTripLocation(fin, S.dest);
  } catch (e) {
    finErr = String(e?.message ?? e);
  }
  const used = reqs.slice(r0);
  return { env, err, fin, trip, finErr, n: { g: used.filter((r) => r.kind === "geocode").length, a: used.filter((r) => r.kind === "autocomplete").length, d: used.filter((r) => r.kind === "details").length }, masks: [...new Set(used.map((r) => `${r.kind}:${r.fieldMask}`))].sort() };
}

const FLOWS = [
  { id: "geo-city-大阪", item: [4, 5, 7, 8, 9], dest: "大阪", phase: "geo", G: { geocode: OK(OSAKA_CITY) }, want: { types: OSAKA_CITY.types, countryCode: "JP", viewport: { north: 34.7712, south: 34.5715, east: 135.6111, west: 135.3478 } } },
  { id: "geo-city-京都-multi", item: [4, 5], dest: "京都", phase: "geo", G: { geocode: OK(KYOTO_CITY, KIYOMIZU) } },
  { id: "geo-noViewport", item: [9], dest: "大阪", phase: "geo", G: { geocode: OK((() => { const c = clone(OSAKA_CITY); delete c.geometry.viewport; return c; })()) }, want: { viewport: undefined, countryCode: "JP" } },
  { id: "poi-清水寺", item: [10], dest: "清水寺", phase: "geo", G: { geocode: OK(KIYOMIZU) }, want: { types: KIYOMIZU.types, countryCode: "JP" } },
  // L2 flow：Google 回兩筆 place_id 皆為空字串；證據必須來自（座標）被選中的那筆
  { id: "emptyPlaceId-two", item: [2], dest: "京都", phase: "geo", G: { geocode: OK({ ...clone(KIYOMIZU), place_id: "" }, { ...clone(KYOTO_CITY), place_id: "" }) } },
  { id: "details-金澤", item: [6, 7, 8], dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: DET_KANAZAWA }, want: { types: ["locality", "political"], primaryType: "locality", countryCode: "JP", viewport: undefined } },
  { id: "details-noTypes", item: [7], dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: (() => { const c = clone(DET_KANAZAWA); delete c.types; delete c.primaryType; return c; })() }, want: { types: undefined, primaryType: undefined } },
  { id: "zero-京都", item: [11], dest: "京都", phase: "geo", G: { geocode: ZERO }, fail: true },
  { id: "zero-京都-places", item: [11], dest: "京都", phase: "geo", placesFallback: true, G: { geocode: ZERO, autocomplete: { suggestions: [] } }, fail: true },
  { id: "nullGeocode-places", item: [3, 11], dest: "京都", phase: "geo", placesFallback: true, G: { geocode: NULLBODY, autocomplete: { suggestions: [] } }, fail: true },
  { id: "emptyObjGeocode-places", item: [3, 11], dest: "京都", phase: "geo", placesFallback: true, G: { geocode: {}, autocomplete: { suggestions: [] } }, fail: true },
  { id: "nullDetails", item: [11], dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: NULLBODY }, fail: true },
];

const R = {};
for (const mode of ["preA1", "preFix", "post"]) {
  for (const S of FLOWS) {
    for (const platform of ["web", "ios"]) {
      R[`${mode}|${S.id}|${platform}`] = await runFlow(await freshModules(mode), platform, S);
    }
  }
}

P("\n══ A. Flow：post vs preFix（L1 修正的唯一預期外部差異＝finalize.countryCode）＋證據值＋成本 ══");
for (const S of FLOWS) {
  for (const platform of ["web", "ios"]) {
    const pre = R[`preFix|${S.id}|${platform}`];
    const post = R[`post|${S.id}|${platform}`];
    const a1 = R[`preA1|${S.id}|${platform}`];
    const tag = `${S.id}-${platform}`;
    const items = S.item;
    // 歸屬項目：L2/L3/POI 情境優先；其餘依平台／階段分到 #4 Web、#5 iOS、#6 Details、#11 失敗
    const it = items.includes(2) ? 2 : items.includes(3) ? 3 : items.includes(10) ? 10 : S.fail ? 11 : S.phase === "places" ? 6 : platform === "web" ? 4 : 5;
    expect(it, `${tag}-noThrow`, !post.err && !post.finErr, `post 不崩潰 ${post.err ?? ""}${post.finErr ?? ""}`);
    expect(it, `${tag}-env-unchanged-vs-preFix`, eq(post.env, pre.env), eq(post.env, pre.env) ? "envelope（location／error／providerResult）與修正前完全相同" : `差異 pre=${J(pre.env)} post=${J(post.env)}`);
    expect(it, `${tag}-fin-unchanged-except-countryCode`, eq(strip(post.fin, ["countryCode"]), strip(pre.fin, ["countryCode"])), `finalize 除 countryCode 外與修正前相同`);
    // finalize.countryCode：A1 之前就沒有（location.lat/lng 分支不讀 countryCode）；修正後回到 A1 之前
    expect(8, `${tag}-fin-countryCode-equals-preA1`, post.fin?.countryCode === a1.fin?.countryCode, `fin.countryCode preA1=${J(a1.fin?.countryCode)} preFix=${J(pre.fin?.countryCode)} post=${J(post.fin?.countryCode)}`);
    if (!S.fail && pre.fin?.countryCode && !post.fin?.countryCode) {
      expect(8, `${tag}-fin-countryCode-evidence-retained`, false, `A1 原本在 finalize 帶出的 countryCode=${J(pre.fin?.countryCode)} 經 L1 修正後消失（env.providerResult.countryCode=${J(post.env?.providerResult?.countryCode)} 仍在）`, "info");
    }
    // TripLocation 必須與 A1 之前一致（country 名稱語意）
    expect(1, `${tag}-trip-equals-preA1`, eq(post.trip, a1.trip) || Boolean(a1.err || a1.finErr), `TripLocation preA1=${J(a1.trip?.country)} post=${J(post.trip?.country)}${a1.err ? "（preA1 崩潰，略）" : ""}`);
    expect(12, `${tag}-calls`, eq(post.n, pre.n), `呼叫數 preFix=${J(pre.n)} post=${J(post.n)}`);
    expect(12, `${tag}-fieldMask`, eq(post.masks, pre.masks), `Field Mask preFix=${J(pre.masks)} post=${J(post.masks)}`);
    if (S.want) {
      for (const [k, v] of Object.entries(S.want)) {
        const item = k === "viewport" ? 9 : k === "countryCode" ? 8 : k === "types" || k === "primaryType" ? 7 : it;
        expect(item, `${tag}-env.providerResult.${k}`, eq(post.env?.providerResult?.[k], v), `env.providerResult.${k}=${J(post.env?.providerResult?.[k])}（預期 ${J(v)}）`);
        if (k !== "countryCode") expect(item, `${tag}-fin.${k}`, eq(post.fin?.[k], v), `fin.${k}=${J(post.fin?.[k])}（預期 ${J(v)}）`);
      }
    }
    if (S.fail) expect(11, `${tag}-failNoEvidence`, post.fin?.ok !== true && !post.fin?.types && !post.fin?.viewport && !post.env?.providerResult?.types, `失敗 ok=${post.fin?.ok}`);
  }
}

// emptyPlaceId-two：證據必須與被選中結果（座標）一致
for (const platform of ["web", "ios"]) {
  const post = R[`post|emptyPlaceId-two|${platform}`];
  const pr = post.env?.providerResult;
  const src = [KIYOMIZU, KYOTO_CITY].find((x) => x.geometry.location.lat === pr?.latitude && x.geometry.location.lng === pr?.longitude);
  expect(2, `emptyPlaceId-two-${platform}-evidenceFromPicked`, src && eq(pr?.types, src.types), `picked lat=${pr?.latitude} types=${J(pr?.types)}（應為座標相同那筆 ${J(src?.types)}）`);
}

// L3：null body 實際錯誤碼與 fallback
P("\n══ B. L3 null body：錯誤碼與 Places fallback ══");
{
  const n = R["post|nullGeocode-places|web"];
  const o = R["post|emptyObjGeocode-places|web"];
  const p = R["preFix|nullGeocode-places|web"];
  expect(3, "nullBody-web-errorCode", n.env?.providerResult?.failureReason === "geocode_empty_response" || n.env?.error === "places_autocomplete_empty", `env.error=${J(n.env?.error)} providerResult.failureReason=${J(n.env?.providerResult?.failureReason)}`, "info");
  expect(3, "nullBody-web-placesFallback", n.n.a >= 1, `null body 後仍走 Places Autocomplete（a=${n.n.a}）`);
  expect(3, "nullBody-web-equals-emptyObj", eq(n.env, o.env) && eq(n.n, o.n), `null 與 {} 結果/呼叫數相同 null=${J({ e: n.env?.error, n: n.n })} {}=${J({ e: o.env?.error, n: o.n })}`);
  expect(3, "nullBody-web-equals-preFix", eq(n.env, p.env) && eq(n.n, p.n), "與修正前完全相同（註解修改不影響行為）");
}
const M = { preA1: await freshModules("preA1"), preFix: await freshModules("preFix"), post: await freshModules("post") };
{
  // 不開 placesFallback：直接看 Geocoding 階段錯誤碼
  for (const mode of ["preFix", "post"]) {
    G = { geocode: NULLBODY };
    const r0 = reqs.length;
    const env = await M[mode].lf.geocodeTripLocationFromText({ data: { query: "京都", destinationName: "京都", locale: "zh-TW", language: "zh-TW", disableLocaleRegionBias: true, placesFallback: false } });
    expect(3, `nullBody-noFallback-${mode}-code`, env?.error === "geocode_empty_response" && env?.providerResult?.failureReason === "geocode_empty_response", `error=${J(env?.error)} failureReason=${J(env?.providerResult?.failureReason)} 呼叫=${reqs.length - r0}`);
  }
  const src = readFileSync(F_LF, "utf8");
  const pre = readFileSync(SWAP.preFix[F_LF], "utf8");
  const union = (s) => s.match(/type GeocodeFailureCode =[\s\S]*?;/)?.[0];
  expect(3, "errorCodeUnion-unchanged", union(src) && union(src) === union(pre), "GeocodeFailureCode 聯集與修正前相同");
  const mapFn = (s) => s.match(/function mapGeocodeApiStatus[\s\S]*?\n}\n/)?.[0];
  expect(3, "mapGeocodeApiStatus-unchanged", mapFn(src) && mapFn(src) === mapFn(pre) && /case "":\s*return "geocode_empty_response"/.test(mapFn(src)), "mapGeocodeApiStatus 未改且 \"\"→geocode_empty_response");
  const cm = src.match(/\/\/ Google \/ proxy may return a JSON `null` body[^\n]*\n[^\n]*\n\s*if \(!json \|\| typeof json !== "object"\) json = \{\};/);
  expect(3, "comment-accurate", cm && /geocode_empty_response/.test(cm[0]) && /Places fallback/.test(cm[0]) && !/no new failure code/.test(cm[0]), `註解：${J(cm?.[0]?.replace(/\s+/g, " "))}`);
}

// ════ C. L1 函式層：舊版信封與既有 countryCode 形狀 ════
P("\n══ C. L1 函式層：舊版 envelope 與既有 countryCode 形狀（post vs preA1／preFix）══");
{
  const norm = (mode, x) => M[mode].dpr.normalizeDestinationProviderResponse(x, { provider: "geocode_fn", query: "大阪" });
  const trip = (mode, x) => M[mode].dpr.providerResultToTripLocation(norm(mode, x), "大阪");
  const pr = { ok: true, status: "OK", latitude: 34.6937, longitude: 135.5023, provider: "geocode", rawResultCount: 1, parsedResultCount: 1, placeId: "mock-pid-osaka-city", types: ["locality", "political"], countryCode: "JP", viewport: { north: 34.77, south: 34.57, east: 135.61, west: 135.34 } };
  const base = { placeId: "mock-pid-osaka-city", city: "大阪市", region: "大阪府", lat: 34.6937, lng: 135.5023, formattedName: "日本・大阪市", displayLabel: "日本・大阪市" };
  const CASES = [
    // [id, payload, 期待 post.country（TripLocation）]
    ["legacy-latlng-noCountry", { location: { ...base }, error: null, providerResult: pr }],
    ["legacy-latlng-emptyCountry", { location: { ...base, country: "" }, error: null, providerResult: pr }],
    ["legacy-latlng-country", { location: { ...base, country: "日本" }, error: null, providerResult: pr }],
    ["legacy-latlng-noPR", { location: { ...base }, error: null }],
    ["new-latlng-noCountry", { location: { placeId: base.placeId, latitude: base.lat, longitude: base.lng, city: "大阪市" }, error: null, providerResult: pr }],
    ["new-latlng-locCountryCode", { location: { placeId: base.placeId, latitude: base.lat, longitude: base.lng, city: "大阪市", countryCode: "jp" }, error: null, providerResult: { ...pr, countryCode: "KR" } }],
    ["new-latlng-country+code", { location: { placeId: base.placeId, latitude: base.lat, longitude: base.lng, city: "大阪市", country: "日本", countryCode: "JP" }, error: null, providerResult: pr }],
    ["root-latlng-countryCode", { latitude: 34.6937, longitude: 135.5023, countryCode: "jp", locality: "大阪市" }],
    ["root-lat/lng-countryCode", { lat: 34.6937, lng: 135.5023, countryCode: "JP" }],
    ["dpr-countryCode", { ok: true, status: "OK", latitude: 34.6937, longitude: 135.5023, countryCode: "jp", provider: "geocode" }],
    ["dpr-country+code", { ok: true, status: "OK", latitude: 34.6937, longitude: 135.5023, country: "日本", countryCode: "JP", provider: "geocode" }],
    ["envelope-locNull-PR", { location: null, error: null, providerResult: { ...pr, country: undefined } }],
  ];
  for (const [id, payload] of CASES) {
    const a1 = norm("preA1", payload);
    const fx = norm("preFix", payload);
    const po = norm("post", payload);
    const tA1 = trip("preA1", payload);
    const tFx = trip("preFix", payload);
    const tPo = trip("post", payload);
    expect(1, `${id}-trip.country=preA1`, tPo?.country === tA1?.country, `TripLocation.country preA1=${J(tA1?.country)} preFix=${J(tFx?.country)} post=${J(tPo?.country)}`);
    expect(1, `${id}-trip=preA1`, eq(tPo, tA1), `TripLocation 全欄位與 A1 之前相同`);
    expect(1, `${id}-normalized-nonEvidence=preA1`, eq(strip(po, EVIDENCE), strip(a1, EVIDENCE)), eq(strip(po, EVIDENCE), strip(a1, EVIDENCE)) ? "正規化結果（扣除 A1 新證據欄位）與 A1 之前相同" : `pre=${J(strip(a1, EVIDENCE))} post=${J(strip(po, EVIDENCE))}`);
    if (po?.country && po?.countryCode) expect(1, `${id}-countryNotCode`, po.country !== po.countryCode || payload?.location?.country === po.countryCode || payload?.country === po.countryCode, `country=${J(po.country)} countryCode=${J(po.countryCode)}`);
    void fx;
  }
  // 修正前重現：舊版信封 location 無 country → preFix 讓 country 由 "unknown" 變 "JP"
  const legacy = { location: { ...base }, error: null, providerResult: pr };
  expect(1, "legacy-preFix-reproduces-L1", trip("preFix", legacy)?.country === "JP" && trip("preA1", legacy)?.country === "unknown", `重現 L1（修正前）：preA1=${J(trip("preA1", legacy)?.country)} preFix=${J(trip("preFix", legacy)?.country)} post=${J(trip("post", legacy)?.country)}`, "repro");
  // location 已有 countryCode 時不得被 providerResult.countryCode 覆蓋
  const ov = norm("post", { location: { placeId: base.placeId, latitude: base.lat, longitude: base.lng, countryCode: "JP" }, error: null, providerResult: { ...pr, countryCode: "KR" } });
  expect(1, "noOverride-countryCode", ov.countryCode === "JP", `location.countryCode=JP、providerResult.countryCode=KR → ${J(ov.countryCode)}`);
  // 其他證據（types／viewport）仍照常合併
  const ev = norm("post", legacy);
  expect(7, "envelope-types-still-merged", eq(ev.types, pr.types) && eq(ev.viewport, pr.viewport) && ev.countryCode === undefined, `types=${J(ev.types)} viewport=${J(ev.viewport)} countryCode=${J(ev.countryCode)}`);
}

// ════ D. L2 函式層：空 Place ID ════
P("\n══ D. L2 providerEvidenceForGeocodeLocation：空 Place ID ══");
{
  const A = gres({ pid: "", fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] });
  const B = gres({ pid: "", fa: "B", lat: 20, lng: 20, types: ["locality", "political"], comps: [JP] });
  const Aundef = gres({ pid: undefined, fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] });
  const Aws = gres({ pid: "  ", fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] });
  for (const mode of ["preFix", "post"]) {
    const ev = M[mode].dpr.providerEvidenceForGeocodeLocation;
    const cat = mode === "post" ? "fix" : "repro";
    for (const [first, fname] of [[A, "pid空字串"], [Aundef, "pid缺"], [Aws, "pid空白"]]) {
      for (const [lpid, lname] of [["", "空字串"], [undefined, "undefined"], ["   ", "空白"], [null, "null"]]) {
        const r = ev(OK(first, B), { placeId: lpid, lat: 20, lng: 20 });
        expect(2, `${mode}-loc${lname}-res${fname}-coordMatch`, eq(r.types, B.types), `${mode}：location.placeId=${J(lpid)}、results[0].place_id=${fname} → types=${J(r.types)}（應以座標取第 2 筆）`, cat);
        const z = ev(OK(first, B), { placeId: lpid, lat: 30, lng: 30 });
        expect(2, `${mode}-loc${lname}-res${fname}-noMatch`, eq(z, {}), `${mode}：座標都不符 → ${J(z)}（應為 {}）`, cat);
      }
    }
  }
  const ev = M.post.dpr.providerEvidenceForGeocodeLocation;
  const C = gres({ pid: "pid-c", fa: "C", lat: 30, lng: 30, types: ["route"], comps: [JP] });
  expect(2, "post-realPlaceId-match", eq(ev(OK(A, B, C), { placeId: "pid-c", lat: 0, lng: 0 }).types, C.types), "非空 placeId 仍優先以 placeId 配對（即使座標不同）");
  expect(2, "post-realPlaceId-trim", eq(ev(OK(A, B, C), { placeId: " pid-c ", lat: 0, lng: 0 }).types, C.types), "placeId 前後空白 trim 後配對");
  expect(2, "post-nearCoord-noMatch", eq(ev(OK(A, B), { placeId: "", lat: 20 + 1e-9, lng: 20 }), {}), "座標差 1e-9 → 不配對（{}）");
  expect(2, "post-unknownPid-noCoord", eq(ev(OK(A, B), { placeId: "pid-x", lat: 1, lng: 1 }), {}), "placeId 對不到且座標不符 → {}");
  expect(2, "post-unknownPid-coordFallback", eq(ev(OK(A, B), { placeId: "pid-x", lat: 20, lng: 20 }).types, B.types), "placeId 對不到 → 座標精確一致回退");
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();

P("\n══ 呼叫次數（preA1 → preFix → post）══");
for (const S of FLOWS) {
  const f = (x) => `g=${x.n.g}/a=${x.n.a}/d=${x.n.d}`;
  P(`  ${S.id.padEnd(24)} Web ${f(R[`preA1|${S.id}|web`])} → ${f(R[`preFix|${S.id}|web`])} → ${f(R[`post|${S.id}|web`])} │ iOS ${f(R[`preA1|${S.id}|ios`])} → ${f(R[`preFix|${S.id}|ios`])} → ${f(R[`post|${S.id}|ios`])}`);
}
const graded = rows.filter((r) => r.cat === "fix");
const fails = graded.filter((r) => !r.ok);
const repro = rows.filter((r) => r.cat === "repro");
P("\n══ 12 項彙總（僅 [fix] 斷言計分；[repro]＝修正前重現；[info]＝記錄差異）══");
for (let i = 1; i <= 12; i += 1) {
  const g = graded.filter((r) => r.item === i);
  const inf = rows.filter((r) => r.item === i && r.cat === "info" && !r.ok);
  P(`  #${String(i).padStart(2)} ${g.length ? (g.every((r) => r.ok) ? "PASS" : "FAIL") : "—"}（${g.filter((r) => r.ok).length}/${g.length}）${inf.length ? ` INFO差異=${inf.length}` : ""}`);
}
P(`\n[repro] 修正前重現失敗數（preFix 應失敗）=${repro.filter((r) => !r.ok).length}/${repro.length}`);
P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-provider-trust-contract-a1-fix: PASS=${graded.filter((r) => r.ok).length} FAIL=${fails.length} INFO差異=${rows.filter((r) => r.cat === "info" && !r.ok).length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
