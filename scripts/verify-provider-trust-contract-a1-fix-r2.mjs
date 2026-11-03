#!/usr/bin/env node
/**
 * A1-T4 — Step A1 最小修正第 2 輪（L1 修法調整）獨立驗收（離線）。
 *
 * 與 verify-provider-trust-contract-a1-fix.mjs 的差異：該腳本 #8「fin.countryCode 必須等於 A1 之前（空）」
 * 把第 1 輪過寬的 L1 行為當成需求，與 A1 契約（帶出 Provider countryCode 證據）衝突。本腳本改以需求本身驗證：
 *   L1：任何形狀下 TripLocation.country 都不得因 countryCode 改變（與 A1 之前逐欄一致）；
 *       location 自身 countryCode 不得被 providerResult 覆蓋；countryCode 為證據欄位，可於 country 已存在時補上。
 *   L2：空／空白／缺 Place ID 不得當作相同地點；無可靠配對 → {}。
 *   L3：null body → geocode_empty_response，錯誤碼聯集與對應表不變。
 *
 * 模式（Vite load hook 換檔，唯讀 scratchpad 快照，不寫任何檔案）：
 *   preA1  ＝ *.pre-A1；preFix ＝ *.pre-A1fix；r1 ＝ destination-provider-result.ts.fix-r1（第 1 輪）；post ＝ 工作區現行檔
 * 外部網路全部攔截，任何一次即 FAIL；只用 Mock Key。
 * 執行：node scripts/verify-provider-trust-contract-a1-fix-r2.mjs
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
  r1: { [F_DPR]: `${SNAP}/destination-provider-result.ts.fix-r1` },
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
    export async function googleRestFetch(input, init, context) { return globalThis.__A1R2_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A1R2_NATIVE === true; }`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a1r2-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
let MODE = "post";
const plugin = {
  name: "a1r2-stubs",
  enforce: "pre",
  resolveId(id) {
    return Object.hasOwn(STUBS, id) ? STUB_PATH(id) : null;
  },
  load(id) {
    const k = STUB_BY_PATH[id];
    if (k) return STUBS[k];
    const swap = SWAP[MODE][id.split("?")[0]];
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

// ── Mock Google（計數＋Field Mask 記錄）──
const NULLBODY = Symbol("null-body");
const ZERO = { status: "ZERO_RESULTS", results: [] };
let G = {};
const reqs = [];
globalThis.__A1R2_GOOGLE = async (input, init = {}) => {
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
/** cat: fix＝計分；repro＝修正前重現（預期失敗，不計分）；info＝記錄 */
function expect(item, id, cond, detail, cat = "fix") {
  rows.push({ item, id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : cat === "info" ? "INFO" : "FAIL"} [${cat}] #${item} ${id}：${detail}`);
}
const info = (item, id, detail) => {
  rows.push({ item, id, ok: true, cat: "info" });
  P(`  INFO [info] #${item} ${id}：${detail}`);
};
const strip = (o, keys) => (o == null ? o : Object.fromEntries(Object.entries(o).filter(([k, v]) => !keys.includes(k) && v !== undefined)));
const EVIDENCE = ["types", "primaryType", "viewport", "countryCode"];

async function runFlow(M, platform, S) {
  G = S.G;
  globalThis.__A1R2_NATIVE = platform === "ios";
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
  globalThis.__A1R2_NATIVE = false;
  const finProvider = S.phase === "places" ? "places_autocomplete" : platform === "web" ? "geocode_fn" : "geocode";
  let fin = null;
  let trip = null;
  let finErr = null;
  try {
    // 與 destination-geocode.ts finalizeInvoke 相同的兩步
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
  { id: "geo-city-京都-multi", item: [4, 5], dest: "京都", phase: "geo", G: { geocode: OK(KYOTO_CITY, KIYOMIZU) }, want: { countryCode: "JP" } },
  { id: "geo-noViewport", item: [9], dest: "大阪", phase: "geo", G: { geocode: OK((() => { const c = clone(OSAKA_CITY); delete c.geometry.viewport; return c; })()) }, want: { viewport: undefined, countryCode: "JP" } },
  { id: "geo-noTypes", item: [7], dest: "大阪", phase: "geo", G: { geocode: OK((() => { const c = clone(OSAKA_CITY); delete c.types; return c; })()) }, want: { types: undefined, countryCode: "JP" } },
  { id: "poi-清水寺", item: [10], dest: "清水寺", phase: "geo", G: { geocode: OK(KIYOMIZU) }, want: { types: KIYOMIZU.types, countryCode: "JP" } },
  { id: "emptyPlaceId-two", item: [2], dest: "京都", phase: "geo", G: { geocode: OK({ ...clone(KIYOMIZU), place_id: "" }, { ...clone(KYOTO_CITY), place_id: "" }) } },
  { id: "details-金澤", item: [6, 7, 8], dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: DET_KANAZAWA }, want: { types: ["locality", "political"], primaryType: "locality", countryCode: "JP", viewport: undefined } },
  { id: "details-noTypes", item: [7], dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: (() => { const c = clone(DET_KANAZAWA); delete c.types; delete c.primaryType; return c; })() }, want: { types: undefined, primaryType: undefined, countryCode: "JP" } },
  { id: "zero-京都", item: [11], dest: "京都", phase: "geo", G: { geocode: ZERO }, fail: true },
  { id: "zero-京都-places", item: [11], dest: "京都", phase: "geo", placesFallback: true, G: { geocode: ZERO, autocomplete: { suggestions: [] } }, fail: true },
  { id: "nullGeocode-places", item: [3, 11], dest: "京都", phase: "geo", placesFallback: true, G: { geocode: NULLBODY, autocomplete: { suggestions: [] } }, fail: true },
  { id: "emptyObjGeocode-places", item: [3, 11], dest: "京都", phase: "geo", placesFallback: true, G: { geocode: {}, autocomplete: { suggestions: [] } }, fail: true },
  { id: "nullDetails", item: [11], dest: "金澤", phase: "places", G: { geocode: ZERO, autocomplete: AUTO, details: NULLBODY }, fail: true },
];

const R = {};
for (const mode of ["preA1", "preFix", "r1", "post"]) {
  for (const S of FLOWS) {
    for (const platform of ["web", "ios"]) {
      R[`${mode}|${S.id}|${platform}`] = await runFlow(await freshModules(mode), platform, S);
    }
  }
}

P("\n══ A. 主流程（Server／Client envelope → finalizeInvoke 兩步）══");
for (const S of FLOWS) {
  for (const platform of ["web", "ios"]) {
    const a1 = R[`preA1|${S.id}|${platform}`];
    const pre = R[`preFix|${S.id}|${platform}`];
    const r1 = R[`r1|${S.id}|${platform}`];
    const post = R[`post|${S.id}|${platform}`];
    const tag = `${S.id}-${platform}`;
    const it = S.item.includes(2) ? 2 : S.item.includes(3) ? 3 : S.item.includes(10) ? 10 : S.fail ? 11 : S.phase === "places" ? 6 : platform === "web" ? 4 : 5;
    expect(it, `${tag}-noThrow`, !post.err && !post.finErr, `post 不崩潰 ${post.err ?? ""}${post.finErr ?? ""}`);
    expect(it, `${tag}-env=preFix`, eq(post.env, pre.env), eq(post.env, pre.env) ? "envelope 與修正前完全相同" : `差異 pre=${J(pre.env)} post=${J(post.env)}`);
    // 主流程 location 皆帶 country → 第 2 輪應與 A1 原實作（preFix）的 finalize 結果完全相同（含 countryCode 證據）
    expect(it, `${tag}-fin=preFix`, eq(post.fin, pre.fin), eq(post.fin, pre.fin) ? "finalize 與修正前完全相同（含 countryCode 證據）" : `差異 pre=${J(pre.fin)} post=${J(post.fin)}`);
    if (!a1.err && !a1.finErr) {
      // 非證據欄位不得改變外部語意
      expect(it, `${tag}-fin-nonEvidence=preA1`, eq(strip(post.fin, EVIDENCE), strip(a1.fin, EVIDENCE)), eq(strip(post.fin, EVIDENCE), strip(a1.fin, EVIDENCE)) ? "finalize 非證據欄位與 A1 之前相同" : `差異 preA1=${J(strip(a1.fin, EVIDENCE))} post=${J(strip(post.fin, EVIDENCE))}`);
      expect(1, `${tag}-trip=preA1`, eq(post.trip, a1.trip), `TripLocation 全欄位與 A1 之前相同（country preA1=${J(a1.trip?.country)} post=${J(post.trip?.country)}）`);
    }
    if (post.trip) {
      expect(1, `${tag}-trip.country=env.location.country`, post.trip.country === (post.env?.location?.country || "unknown"), `trip.country=${J(post.trip.country)} env.location.country=${J(post.env?.location?.country)}`);
      expect(1, `${tag}-trip.country-notCode`, !/^[A-Z]{2}$/.test(post.trip.country) || post.env?.location?.country === post.trip.country, `trip.country=${J(post.trip.country)}`);
    }
    if (!S.fail) {
      // countryCode 證據：finalize 必須帶出 envelope providerResult 的 countryCode（P2 已修復）
      const want = post.env?.providerResult?.countryCode;
      expect(8, `${tag}-fin.countryCode=env.providerResult.countryCode`, Boolean(want) && post.fin?.countryCode === want, `fin.countryCode=${J(post.fin?.countryCode)} env.providerResult.countryCode=${J(want)}`);
      expect(8, `${tag}-r1-lost-countryCode`, !r1.fin?.countryCode, `第 1 輪 fin.countryCode=${J(r1.fin?.countryCode)}（第 1 輪應已遺失，證明本輪修復 P2）`, "repro");
    }
    expect(12, `${tag}-calls=preFix`, eq(post.n, pre.n), `呼叫數 preFix=${J(pre.n)} post=${J(post.n)}`);
    expect(12, `${tag}-fieldMask=preFix`, eq(post.masks, pre.masks), `Field Mask preFix=${J(pre.masks)} post=${J(post.masks)}`);
    if (!a1.err) {
      expect(12, `${tag}-calls=preA1`, eq(post.n, a1.n), `呼叫數 preA1=${J(a1.n)} post=${J(post.n)}`);
      expect(12, `${tag}-fieldMask=preA1`, eq(post.masks, a1.masks), `Field Mask preA1=${J(a1.masks)} post=${J(post.masks)}`);
    }
    if (S.want) {
      for (const [k, v] of Object.entries(S.want)) {
        const item = k === "viewport" ? 9 : k === "countryCode" ? 8 : k === "types" || k === "primaryType" ? 7 : it;
        expect(item, `${tag}-env.providerResult.${k}`, eq(post.env?.providerResult?.[k], v), `env.providerResult.${k}=${J(post.env?.providerResult?.[k])}（預期 ${J(v)}）`);
        expect(item, `${tag}-fin.${k}`, eq(post.fin?.[k], v), `fin.${k}=${J(post.fin?.[k])}（預期 ${J(v)}）`);
      }
    }
    if (S.fail) expect(11, `${tag}-failNoEvidence`, post.fin?.ok !== true && post.trip === null && !post.fin?.types && !post.fin?.viewport && !post.fin?.countryCode && !post.env?.providerResult?.types, `失敗 ok=${post.fin?.ok} trip=${J(post.trip)}`);
  }
}
for (const platform of ["web", "ios"]) {
  const post = R[`post|emptyPlaceId-two|${platform}`];
  const pr = post.env?.providerResult;
  const src = [KIYOMIZU, KYOTO_CITY].find((x) => x.geometry.location.lat === pr?.latitude && x.geometry.location.lng === pr?.longitude);
  expect(2, `emptyPlaceId-two-${platform}-evidenceFromPicked`, src && eq(pr?.types, src.types) && eq(post.fin?.types, src.types), `picked lat=${pr?.latitude} types=${J(pr?.types)} fin.types=${J(post.fin?.types)}（應為座標相同那筆 ${J(src?.types)}）`);
}

const M = { preA1: await freshModules("preA1"), preFix: await freshModules("preFix"), r1: await freshModules("r1"), post: await freshModules("post") };

P("\n══ B. L1 窮舉：envelope 形狀 × country × location.countryCode × providerResult ══");
{
  const lat = 34.6937;
  const lng = 135.5023;
  const pid = "mock-pid-osaka-city";
  const COUNTRY = [["∅", undefined], ["空字串", ""], ["空白", "   "], ["tab", "\t"], ["日本", "日本"], ["unknown", "unknown"], ["韓國", "韓國"]];
  const LOC_CC = [["∅", undefined], ["空字串", ""], ["jp", "jp"], ["KR", "KR"]];
  const PRS = [
    ["noPR", undefined],
    ["PR-JP", { ok: true, status: "OK", latitude: lat, longitude: lng, placeId: pid, countryCode: "JP", types: ["locality", "political"] }],
    ["PR-kr-lower", { ok: true, status: "OK", latitude: lat, longitude: lng, placeId: pid, countryCode: "kr" }],
    ["PR-JPN-nonISO", { ok: true, status: "OK", latitude: lat, longitude: lng, placeId: pid, countryCode: "JPN" }],
    ["PR-noPid-JP", { ok: true, status: "OK", latitude: lat, longitude: lng, countryCode: "JP" }],
    ["PR-otherPid-JP", { ok: true, status: "OK", latitude: lat, longitude: lng, placeId: "other", countryCode: "JP" }],
    ["PR-otherCoord-JP", { ok: true, status: "OK", latitude: lat + 0.001, longitude: lng, placeId: pid, countryCode: "JP" }],
    ["PR-notOk-JP", { ok: false, status: "ZERO_RESULTS", latitude: lat, longitude: lng, placeId: pid, countryCode: "JP" }],
    ["PR-latlng-JP", { ok: true, status: "OK", lat, lng, placeId: pid, countryCode: "JP" }],
  ];
  const SHAPES = [
    ["legacy", (c, cc) => ({ placeId: pid, city: "大阪市", lat, lng, formattedName: "日本・大阪市", ...(c !== undefined ? { country: c } : {}), ...(cc !== undefined ? { countryCode: cc } : {}) })],
    ["new", (c, cc) => ({ placeId: pid, city: "大阪市", latitude: lat, longitude: lng, ...(c !== undefined ? { country: c } : {}), ...(cc !== undefined ? { countryCode: cc } : {}) })],
  ];
  const norm = (mode, x) => M[mode].dpr.normalizeDestinationProviderResponse(x, { provider: "geocode_fn", query: "大阪" });
  const toTrip = (mode, x) => M[mode].dpr.providerResultToTripLocation(norm(mode, x), "大阪");
  const isoOk = (v) => (typeof v === "string" && /^[A-Z]{2}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : undefined);
  let total = 0;
  let tripFail = 0;
  let ccFail = 0;
  let legacyOverride = 0;
  const legacyOverrideCases = [];
  const mismatch = [];
  for (const [sname, mk] of SHAPES) {
    for (const [cname, c] of COUNTRY) {
      for (const [ccname, cc] of LOC_CC) {
        for (const [pname, pr] of PRS) {
          total += 1;
          const payload = { location: mk(c, cc), error: null, ...(pr ? { providerResult: pr } : {}) };
          const id = `${sname}|country=${cname}|loc.cc=${ccname}|${pname}`;
          let po;
          let a1;
          let tPo;
          let tA1;
          try {
            po = norm("post", payload);
            a1 = norm("preA1", payload);
            tPo = toTrip("post", payload);
            tA1 = toTrip("preA1", payload);
          } catch (e) {
            expect(1, `${id}-noThrow`, false, String(e?.message ?? e));
            continue;
          }
          // L1 核心：TripLocation 逐欄與 A1 之前相同（country 不因 countryCode 改變）
          if (!eq(tPo, tA1)) {
            tripFail += 1;
            expect(1, `${id}-trip=preA1`, false, `preA1=${J(tA1)} post=${J(tPo)}`);
          }
          // 非證據欄位與 A1 之前相同
          if (!eq(strip(po, EVIDENCE), strip(a1, EVIDENCE))) expect(1, `${id}-nonEvidence=preA1`, false, `preA1=${J(strip(a1, EVIDENCE))} post=${J(strip(po, EVIDENCE))}`);
          // countryCode 規則
          const locCode = sname === "new" && typeof cc === "string" && cc.trim() ? cc.trim().toUpperCase() : undefined;
          const hasCountry = typeof c === "string" && Boolean(c.trim());
          const prEligible = pr && pr.ok === true && (pr.latitude ?? pr.lat) === lat && (pr.longitude ?? pr.lng) === lng && (!pr.placeId || pr.placeId === pid);
          const expectCode = locCode ?? (hasCountry && prEligible ? isoOk(pr.countryCode) : undefined);
          if (po.countryCode !== expectCode) {
            ccFail += 1;
            expect(8, `${id}-countryCode`, false, `post.countryCode=${J(po.countryCode)}（預期 ${J(expectCode)}）`);
          }
          // location 自身 countryCode 不得被 providerResult 覆蓋（new 形狀＝parser 讀取 location.countryCode）
          if (locCode && pr?.countryCode && po.countryCode !== locCode) expect(1, `${id}-locCode-notOverridden`, false, `location.countryCode=${locCode} → ${J(po.countryCode)}`);
          // legacy 形狀：parser 本來就不讀 location.countryCode（TripLocation 型別也無此欄）；記錄 PR 補值是否與型別外輸入不同
          if (sname === "legacy" && typeof cc === "string" && cc.trim() && po.countryCode && po.countryCode !== cc.trim().toUpperCase()) {
            legacyOverride += 1;
            if (legacyOverrideCases.length < 3) legacyOverrideCases.push(`${id}→${po.countryCode}`);
          }
          if (hasCountry && !["日本", "unknown"].includes(c) && po.countryCode) mismatch.push(`${id}: country=${c} countryCode=${po.countryCode} trip.country=${tPo?.country}`);
          // country 名稱不得被代碼取代
          // 唯一允許的代碼來源＝location 自身 countryCode（A1 之前即有的 fallback）；providerResult 代碼永不進 country
          const expectTripCountry = hasCountry ? c.trim() : locCode ?? "unknown";
          if (tPo) expect(1, `${id}-trip.country`, tPo.country === expectTripCountry, `trip.country=${J(tPo.country)}（預期 ${J(expectTripCountry)}）`);
        }
      }
    }
  }
  expect(1, "L1-matrix-trip=preA1", tripFail === 0, `${total} 組形狀中 TripLocation 與 A1 之前不同=${tripFail}`);
  expect(8, "L1-matrix-countryCode-rule", ccFail === 0, `${total} 組形狀中 countryCode 不符規則=${ccFail}`);
  info(1, "legacy-offType-location.countryCode", `legacy 形狀（location.lat/lng）parser 自 A1 之前即不讀 location.countryCode（TripLocation 型別無此欄、現行無產生者）；其中 ${legacyOverride} 組因 country 存在而由 providerResult 補入不同代碼，例：${legacyOverrideCases.join("；")}`);
  info(8, "country-vs-countryCode-mismatch", `location.country 與 providerResult.countryCode 指向不同國家時照補（身分一致性屬 A2），共 ${mismatch.length} 組，例：${mismatch.slice(0, 2).join("；")}`);

  // 明示的需求案例
  const base = { placeId: pid, city: "大阪市", region: "大阪府", lat, lng, formattedName: "日本・大阪市", displayLabel: "日本・大阪市" };
  const pr = { ok: true, status: "OK", latitude: lat, longitude: lng, placeId: pid, types: ["locality", "political"], countryCode: "JP", viewport: { north: 34.77, south: 34.57, east: 135.61, west: 135.34 } };
  for (const [name, country] of [["empty", ""], ["blank", "   "], ["missing", undefined]]) {
    const payload = { location: { ...base, ...(country !== undefined ? { country } : {}) }, error: null, providerResult: pr };
    const n = norm("post", payload);
    const t = toTrip("post", payload);
    expect(1, `explicit-country-${name}-trip.country`, t.country === "unknown" && t.country === toTrip("preA1", payload).country, `location.country=${J(country)} → trip.country=${J(t.country)}（preA1=${J(toTrip("preA1", payload).country)}；preFix=${J(toTrip("preFix", payload).country)}）`);
    expect(8, `explicit-country-${name}-noCodeFill`, n.countryCode === undefined, `countryCode=${J(n.countryCode)}`);
    expect(7, `explicit-country-${name}-otherEvidenceMerged`, eq(n.types, pr.types) && eq(n.viewport, pr.viewport), `types=${J(n.types)} viewport=${J(n.viewport)}`);
  }
  {
    const payload = { location: { ...base, country: "日本" }, error: null, providerResult: pr };
    const n = norm("post", payload);
    expect(8, "explicit-country-present-codeFilled", n.countryCode === "JP" && n.country === "日本" && toTrip("post", payload).country === "日本", `country=${J(n.country)} countryCode=${J(n.countryCode)} trip.country=${J(toTrip("post", payload).country)}`);
    expect(8, "explicit-country-present-r1-lost", norm("r1", payload).countryCode === undefined, `第 1 輪 countryCode=${J(norm("r1", payload).countryCode)}`, "repro");
  }
  {
    const payload = { location: { placeId: pid, latitude: lat, longitude: lng, city: "大阪市", country: "日本", countryCode: "jp" }, error: null, providerResult: { ...pr, countryCode: "KR" } };
    expect(1, "explicit-locCode-notOverridden", norm("post", payload).countryCode === "JP", `location.countryCode=jp、providerResult=KR → ${J(norm("post", payload).countryCode)}`);
  }
  {
    const legacy = { location: { ...base }, error: null, providerResult: pr };
    expect(1, "preFix-reproduces-L1", toTrip("preFix", legacy)?.country === "JP" && toTrip("preA1", legacy)?.country === "unknown", `修正前：preA1=${J(toTrip("preA1", legacy)?.country)} preFix=${J(toTrip("preFix", legacy)?.country)} post=${J(toTrip("post", legacy)?.country)}`, "repro");
  }
  // 舊版回應（無 providerResult、DPR 形狀、root 形狀）＝與 A1 之前完全一致
  for (const [id, payload] of [
    ["legacy-noPR", { location: { ...base, country: "日本" }, error: null }],
    ["root-latlng-countryCode", { latitude: lat, longitude: lng, countryCode: "jp", locality: "大阪市" }],
    ["root-lat/lng-countryCode", { lat, lng, countryCode: "JP" }],
    ["dpr-countryCode", { ok: true, status: "OK", latitude: lat, longitude: lng, countryCode: "jp", provider: "geocode" }],
    ["envelope-locNull-PR", { location: null, error: null, providerResult: { ...pr } }],
    ["envelope-locNull-noPR", { location: null, error: "geocode_zero_results" }],
  ]) {
    expect(1, `oldShape-${id}-normalized=preA1`, eq(strip(norm("post", payload), ["types", "primaryType", "viewport"]), strip(norm("preA1", payload), ["types", "primaryType", "viewport"])), `post=${J(norm("post", payload))}`);
    expect(1, `oldShape-${id}-trip=preA1`, eq(toTrip("post", payload), toTrip("preA1", payload)), `trip.country=${J(toTrip("post", payload)?.country)}`);
  }
}

P("\n══ C. L2 providerEvidenceForGeocodeLocation：空 Place ID ══");
{
  const A = gres({ pid: "", fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] });
  const B = gres({ pid: "", fa: "B", lat: 20, lng: 20, types: ["locality", "political"], comps: [JP] });
  const Aundef = gres({ pid: undefined, fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] });
  const Aws = gres({ pid: "  ", fa: "A", lat: 10, lng: 10, types: ["establishment"], comps: [JP] });
  const ev = M.post.dpr.providerEvidenceForGeocodeLocation;
  for (const [first, fname] of [[A, "pid空字串"], [Aundef, "pid缺"], [Aws, "pid空白"]]) {
    for (const [lpid, lname] of [["", "空字串"], [undefined, "undefined"], ["   ", "空白"], [null, "null"]]) {
      expect(2, `loc${lname}-res${fname}-coordMatch`, eq(ev(OK(first, B), { placeId: lpid, lat: 20, lng: 20 }).types, B.types), `以座標取第 2 筆`);
      expect(2, `loc${lname}-res${fname}-noMatch`, eq(ev(OK(first, B), { placeId: lpid, lat: 30, lng: 30 }), {}), `座標都不符 → ${J(ev(OK(first, B), { placeId: lpid, lat: 30, lng: 30 }))}`);
    }
  }
  const C = gres({ pid: "pid-c", fa: "C", lat: 30, lng: 30, types: ["route"], comps: [JP] });
  expect(2, "realPlaceId-match", eq(ev(OK(A, B, C), { placeId: "pid-c", lat: 0, lng: 0 }).types, C.types), "非空 placeId 優先配對");
  expect(2, "nearCoord-noMatch", eq(ev(OK(A, B), { placeId: "", lat: 20 + 1e-9, lng: 20 }), {}), "座標差 1e-9 → {}");
  expect(2, "preFix-reproduces-L2", !eq(M.preFix.dpr.providerEvidenceForGeocodeLocation(OK(A, B), { placeId: undefined, lat: 30, lng: 30 }), {}), "修正前 undefined placeId 誤配空 place_id", "repro");
}

P("\n══ D. L3 null body：錯誤碼與註解 ══");
{
  for (const mode of ["preFix", "post"]) {
    G = { geocode: NULLBODY };
    const r0 = reqs.length;
    const env = await M[mode].lf.geocodeTripLocationFromText({ data: { query: "京都", destinationName: "京都", locale: "zh-TW", language: "zh-TW", disableLocaleRegionBias: true, placesFallback: false } });
    expect(3, `nullBody-noFallback-${mode}-code`, env?.error === "geocode_empty_response" && env?.providerResult?.failureReason === "geocode_empty_response" && reqs.length - r0 === 1, `error=${J(env?.error)} failureReason=${J(env?.providerResult?.failureReason)} 呼叫=${reqs.length - r0}`);
  }
  const n = R["post|nullGeocode-places|web"];
  const o = R["post|emptyObjGeocode-places|web"];
  expect(3, "nullBody-equals-emptyObj", eq(n.env, o.env) && eq(n.n, o.n), `null=${J({ e: n.env?.error, n: n.n })} {}=${J({ e: o.env?.error, n: o.n })}`);
  const src = readFileSync(F_LF, "utf8");
  const pre = readFileSync(SWAP.preA1[F_LF], "utf8");
  const union = (s) => s.match(/type GeocodeFailureCode =[\s\S]*?;/)?.[0];
  expect(3, "errorCodeUnion=preA1", union(src) && union(src) === union(pre), "GeocodeFailureCode 聯集與 A1 之前相同");
  const mapFn = (s) => s.match(/function mapGeocodeApiStatus[\s\S]*?\n}\n/)?.[0];
  expect(3, "mapGeocodeApiStatus=preA1", mapFn(src) && mapFn(src) === mapFn(pre) && /case "":\s*return "geocode_empty_response"/.test(mapFn(src)), "mapGeocodeApiStatus 未改且 \"\"→geocode_empty_response");
  const cm = src.match(/\/\/ Google \/ proxy may return a JSON `null` body[^\n]*\n[^\n]*\n\s*if \(!json \|\| typeof json !== "object"\) json = \{\};/);
  expect(3, "comment-accurate", cm && /geocode_empty_response/.test(cm[0]) && /Places fallback/.test(cm[0]), `註解：${J(cm?.[0]?.replace(/\s+/g, " "))}`);
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();

P("\n══ 呼叫次數（preA1 → preFix → r1 → post）══");
for (const S of FLOWS) {
  const f = (x) => `g=${x.n.g}/a=${x.n.a}/d=${x.n.d}`;
  P(`  ${S.id.padEnd(24)} Web ${["preA1", "preFix", "r1", "post"].map((m) => f(R[`${m}|${S.id}|web`])).join(" → ")} │ iOS ${["preA1", "preFix", "r1", "post"].map((m) => f(R[`${m}|${S.id}|ios`])).join(" → ")}`);
}
const graded = rows.filter((r) => r.cat === "fix");
const fails = graded.filter((r) => !r.ok);
const repro = rows.filter((r) => r.cat === "repro");
P("\n══ 12 項彙總（[fix] 計分；[repro]＝斷言「修正前／第 1 輪的缺陷存在」，PASS＝已重現，不計分；[info]＝記錄）══");
for (let i = 1; i <= 12; i += 1) {
  const g = graded.filter((r) => r.item === i);
  P(`  #${String(i).padStart(2)} ${g.length ? (g.every((r) => r.ok) ? "PASS" : "FAIL") : "—"}（${g.filter((r) => r.ok).length}/${g.length}）`);
}
P(`\n[repro] 修正前／第 1 輪缺陷重現成立=${repro.filter((r) => r.ok).length}/${repro.length}`);
P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-provider-trust-contract-a1-fix-r2: PASS=${graded.filter((r) => r.ok).length} FAIL=${fails.length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
