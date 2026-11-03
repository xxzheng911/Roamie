#!/usr/bin/env node
/**
 * A2-T3 — A2-F2 限定安全修正獨立驗收（tester；離線 Mock）。
 *
 * 為何另開本腳本：verify-destination-trust-boundary-a2-acceptance.mjs L305-376 的 runAltWithFallback
 * 是手抄「修改前」send()（dest 用 ??、沒有 safe stop），不載入新版 send()，所以 R5 probe 不會反映 source 修改。
 *
 * 本腳本執行的是 _app.chat.tsx 的「實際原始碼」：
 *   - 以 TypeScript AST 擷取 send() 內 `if (shouldAcceptAlternativeRecommendations(msgs, trimmed)) {…}` 整段、
 *     pushAlternativeDestinationPlaceRecommendation 與 pushNearbyPlaceRecommendation 的 useCallback 函式本體，
 *     ts.transpileModule 轉 JS 後執行（不是手抄）。
 *   - 這幾段引用的 import 名稱，依 _app.chat.tsx 檔頭 import 對應到真實模組（vite-node 載入）；
 *     元件閉包（setMsgs／persistSession／searchNearbyPlaces…）由本腳本注入記錄器；
 *     未知名稱一律丟 ReferenceError（不默默補 stub）。
 *   - 同一 Harness 也執行 scratchpad/pre-A2-F2/_app.chat.tsx（修改前）同樣三段，證明測試在修正前會失敗。
 *   - send() 進入 alt 分支前的 nextSession 準備（prepareSessionForUserTurn → mergeTravelContext →
 *     mergeTripPlanningContext）不在 A2-F2 diff 內，沿用 acceptance L312-316 的作法（[mirror-pre]）。
 * Places／Weather：Builder 層 PlaceSearchFn Mock 逐筆記錄中心／半徑；Google：Mock googleRestFetch 逐筆計數。
 * Credits：真實 credits/operations.ts＋stub supabase.rpc 記錄 check／reserve／commit／rollback。
 * 外部網路全部攔截（fetch／http／https／net），任一次即 FAIL；只用 Mock Key；不寫任何檔案。
 * 判讀：[acc] 驗收斷言，FAIL → exit 1；[pre] 修改前程式碼的對照（PASS＝修改前確實有此問題，不影響 exit code）；INFO 數字。
 * 執行：node scripts/verify-destination-trust-boundary-a2-f2-acceptance.mjs
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_F2_CHAT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/pre-A2-F2/_app.chat.tsx";
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
const warnLog = [];
for (const k of ["info", "log", "debug", "error"]) console[k] = () => {};
console.warn = (...a) => warnLog.push(a.map(String).join(" "));

globalThis.__A2F_ALS = new AsyncLocalStorage();
globalThis.__A2F_RPC_SEQ = 0;
const STUBS = {
  "@tanstack/react-start": `
    export const createServerFn = () => {
      const b = {
        middleware(list) { b.mw = list; return b; },
        inputValidator(fn) { b.v = fn; return b; },
        handler(fn) { return async (args) => { const id = ++globalThis.__A2F_RPC_SEQ; return globalThis.__A2F_ALS.run(id, () => fn({ data: b.v ? b.v(args?.data) : args?.data, context: {} })); }; },
      };
      return b;
    };
    export const createMiddleware = () => { const m = { server() { return m; }, client() { return m; }, middleware() { return m; } }; return m; };
  `,
  "@/lib/google-rate-limit.server": `export const requireGoogleProviderRate = {};`,
  "@/lib/public-read-auth": `export const allowGuestPublicRead = {};`,
  "@/lib/google-rest-transport": `
    export function getGoogleRestTransportToken() { return "roamie-server-proxy"; }
    export async function googleRestFetch(input, init, context) { return globalThis.__A2F_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return false; }`,
  "@/integrations/supabase/client": `
    const any = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : any()), apply: () => any() });
    export const supabase = new Proxy({}, { get(_t, p) {
      if (p === "rpc") return async (name, args) => globalThis.__A2F_RPC(name, args);
      if (p === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
      return any();
    } });
  `,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a2f-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "a2f-transport-stubs",
  enforce: "pre",
  resolveId(id) {
    return Object.hasOwn(STUBS, id) ? STUB_PATH(id) : null;
  },
  load(id) {
    const ov = globalThis.__A2F_OVERLAY;
    if (ov && Object.hasOwn(ov, id)) return ov[id];
    const k = STUB_BY_PATH[id];
    return k ? STUBS[k] : null;
  },
};

const ts = (await import("typescript")).default;
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
  rds: "lib/ai/resolved-destination-scope.ts",
  lf: "lib/location.functions.ts",
  crr: "lib/ai/chat-recommendation-refresh.ts",
  tc: "lib/ai/travel-context.ts",
  tpc: "lib/ai/trip-planning-context.ts",
  ccs: "lib/ai/chat-conversation-state.ts",
  lps: "lib/ai/landmark-place-strategy.ts",
  cop: "lib/credits/operations.ts",
  cff: "lib/credits/feature-flag.ts",
  crc: "lib/chat-runtime-copy.ts",
  crs: "lib/ai/conversation-recommendation-session.ts",
  mvp: "lib/ai/must-visit-places.ts",
};
let runner = null;
async function freshModules() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const M = {};
  for (const [k, p] of Object.entries(MODS)) M[k] = await runner.executeFile(`${WORK_ROOT}/src/${p}`);
  M.cff.setCreditsFeatureEnabledOverride(true);
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
let G = { mode: "ok" };
const geoFor = (q) => {
  const s = String(q ?? "");
  for (const [k, v] of Object.entries(GEO)) if (s.includes(k) || (k === "金澤" && /金沢|Kanazawa/i.test(s)) || (k === "里斯本" && /Lisbo/i.test(s)) || (k === "波爾圖" && /Porto/i.test(s))) return { status: "OK", results: [v] };
  return null;
};
const reqs = [];
globalThis.__A2F_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const query = url.searchParams.get("address") ?? body?.input ?? body?.textQuery;
  reqs.push({ kind, query });
  if (kind === "places") return Response.json({ places: [] });
  if (G.mode === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (G.mode === "null") return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  if (kind === "geocode") return Response.json((G.mode === "ok" && geoFor(query)) || ZERO);
  if (kind === "autocomplete") return Response.json({ suggestions: [] });
  return Response.json({});
};
const countOf = (list) => ({ geocode: list.filter((r) => r.kind === "geocode").length, autocomplete: list.filter((r) => r.kind === "autocomplete").length, details: list.filter((r) => r.kind === "details").length, places: list.filter((r) => r.kind === "places").length, other: list.filter((r) => r.kind === "other").length });
const gTotal = (c) => c.geocode + c.autocomplete + c.details + c.places + c.other;
const fc = (c) => `geocode=${c.geocode} autocomplete=${c.autocomplete} details=${c.details} GooglePlaces=${c.places} other=${c.other}`;

// ════ Places／Weather（Builder 層 PlaceSearchFn Mock）════
let placeCalls = [];
let weatherCalls = [];
let placeSeq = 0;
let placesMode = "ok";
const mockSearchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng, radius: data.radius, destinationName: data.destinationName, includedTypes: data.includedTypes });
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
globalThis.__A2F_RPC = async (name, args) => {
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
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 6).join(" | ")}\nexternal=${external}\nverify-destination-trust-boundary-a2-f2-acceptance: FAIL\n`);
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
const pt = (c) => (c ? `(${c.lat},${c.lng})` : "∅");
const near = (c, ref, km = 40) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.hypot((c.lat - ref.lat) * 111, (c.lng - ref.lng) * 111 * Math.cos((ref.lat * Math.PI) / 180)) <= km;
const centersOf = (list) => [...new Set(list.map((c) => `${c.lat},${c.lng}${c.radius != null ? `,r=${c.radius}` : ""}`))].slice(0, 4);
const FORGED = "亞特蘭提斯市";
const FAKE_C = { lat: 1.2345, lng: 103.8 };
const GPS = { lat: 25.033, lng: 121.5654, city: "台北市" };
const nowIso = new Date().toISOString();
const baseSession = (extra = {}) => ({ phase: "recommend", messages: [], recommendedPlaces: [], selectedPlaces: [], ...extra });
const recSnap = (extra) => ({ sessionId: `rec-${Math.random().toString(36).slice(2, 8)}`, destination: "京都", topic: "restaurant", pool: [], cursor: 0, returnedPlaceIds: [], returnedCanonicalKeys: [], usedQueries: ["q1"], nextQueryCursor: 1, recommendationPage: 1, exhausted: false, createdAt: nowIso, updatedAt: nowIso, ...extra });
const arc = (dest, c, extra = {}) => ({ destinationName: dest, intent: "restaurant", ...(c ? { latitude: c.lat, longitude: c.lng } : {}), previousPlaceIds: [], previousCanonicalKeys: [], currentResultPlaceIds: [], usedQueries: [], createdAt: Date.now(), updatedAt: Date.now(), ...extra });

// ════ 原始碼擷取（TypeScript AST；修改後＋修改前）════
function extractFromChat(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = {};
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if ((name === "pushAlternativeDestinationPlaceRecommendation" || name === "pushNearbyPlaceRecommendation") && node.initializer && ts.isCallExpression(node.initializer)) {
        found[name] = node.initializer.arguments[0];
      }
      if (name === "send" && node.initializer && ts.isArrowFunction(node.initializer)) found.send = node.initializer;
    }
    if (ts.isIfStatement(node) && node.expression.getText(sf) === "shouldAcceptAlternativeRecommendations(msgs, trimmed)") found.altBranch = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const imports = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const spec = st.moduleSpecifier.text;
    const cl = st.importClause;
    if (cl.name) imports.set(cl.name.text, { spec, imported: "default" });
    if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) imports.set(cl.namedBindings.name.text, { spec, imported: "*" });
    if (cl.namedBindings && ts.isNamedImports(cl.namedBindings))
      for (const el of cl.namedBindings.elements) if (!el.isTypeOnly) imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
  }
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const toJs = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.Preserve, removeComments: true } }).outputText.trim().replace(/;$/, "");
  const code = {
    alt: toJs(`(${found.pushAlternativeDestinationPlaceRecommendation.getText(sf)})`),
    nearby: toJs(`(${found.pushNearbyPlaceRecommendation.getText(sf)})`),
    branch: toJs(`(async () => { ${found.altBranch.getText(sf)}\n return "__branch_not_taken"; })`),
  };
  return {
    file,
    imports,
    code,
    lines: { alt: lineOf(found.pushAlternativeDestinationPlaceRecommendation), nearby: lineOf(found.pushNearbyPlaceRecommendation), branch: lineOf(found.altBranch), branchEnd: sf.getLineAndCharacterOfPosition(found.altBranch.getEnd()).line + 1 },
    branchInsideSend: !!found.send && found.altBranch.getStart(sf) > found.send.getStart(sf) && found.altBranch.getEnd() < found.send.getEnd(),
  };
}
const SRC = { post: extractFromChat(`${WORK_ROOT}/src/routes/_app.chat.tsx`), pre: existsSync(PRE_F2_CHAT) ? extractFromChat(PRE_F2_CHAT) : null };

function resolveSpecPath(spec) {
  if (!spec.startsWith("@/")) return null;
  const base = `${WORK_ROOT}/src/${spec.slice(2)}`;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}
/** 依擷取碼中出現的識別字，載入 _app.chat.tsx 檔頭對應的真實模組匯出。 */
async function loadImportsFor(variant, codes) {
  const words = new Set(codes.join("\n").match(/[A-Za-z_$][\w$]*/g));
  const env = {};
  const skipped = [];
  for (const [local, { spec, imported }] of variant.imports) {
    if (!words.has(local)) continue;
    const path = resolveSpecPath(spec);
    if (!path) {
      skipped.push(`${local}<-${spec}`);
      continue;
    }
    const mod = await runner.executeFile(path);
    env[local] = imported === "*" ? mod : mod[imported];
  }
  return { env, skipped };
}
const missingNames = new Set();
function makeScope(env, locals) {
  return new Proxy(locals, {
    has: () => true,
    get(t, k) {
      if (k === Symbol.unscopables) return undefined;
      if (Object.hasOwn(t, k)) return t[k];
      if (Object.hasOwn(env, k)) return env[k];
      if (k in globalThis) return globalThis[k];
      missingNames.add(String(k));
      throw new ReferenceError(`[harness] ${String(k)} is not provided`);
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}
const compile = (js, scope) => new Function("__scope", `with (__scope) { return ${js}; }`)(scope);

/**
 * 以「實際原始碼」執行 send() 的 alt 分支（含真實 alt callback 與真實 pushNearbyPlaceRecommendation）。
 * session：send() 進入本回合前的 activeSession；USER＝「好」。
 */
async function runSendAlt(variant, session, { mode = "zero", places = "ok", userText = "好", ensureHydrated = true } = {}) {
  const M = await freshModules();
  G = { mode };
  placesMode = places;
  rpcLog = [];
  warnLog.length = 0;
  const r0 = reqs.length;
  const p0 = placeCalls.length;
  const w0 = weatherCalls.length;
  const { env, skipped } = await loadImportsFor(variant, [variant.code.branch, variant.code.alt, variant.code.nearby]);
  const geocodeLocationFn = async (args) => M.lf.geocodeTripLocationFromText(args);
  const rec = { setMsgs: [], persist: [], nearbyCalls: [], altCalls: [], altResults: [], streaming: [] };
  let msgsState = [];
  const NO_MORE = M.crc.chatRuntimeCopy("noMore", "zh-TW");
  const msgs = [
    { role: "user", content: "推薦餐廳" },
    { role: "assistant", content: "好的，推薦給你：" },
    { role: "user", content: "還有嗎" },
    { role: "assistant", content: NO_MORE },
  ];
  msgsState = msgs;
  // [mirror-pre] send() 進入 alt 分支前（不在 A2-F2 diff 內；同 acceptance L312-314）
  let nextSession = M.ccs.prepareSessionForUserTurn(session, NO_MORE);
  const merged = M.tc.mergeTravelContext(nextSession, userText, NO_MORE);
  nextSession = M.tpc.mergeTripPlanningContext(userText, merged.session, merged.context).session;
  const locals = {
    msgs,
    trimmed: userText,
    displayMessage: userText,
    nextSession,
    merged,
    locale: "zh-TW",
    hasPlusAccess: false,
    setText: () => {},
    setPartial: () => {},
    setStreaming: (v) => rec.streaming.push(v),
    setMsgs: (v) => {
      msgsState = typeof v === "function" ? v(msgsState) : v;
      rec.setMsgs.push(msgsState);
    },
    persistSession: (s) => rec.persist.push(s),
    ensureSubscriptionHydratedForCredits: () => ensureHydrated,
    geocodeLocationFn,
    searchNearbyPlaces: mockSearchPlaces,
    fetchWeather: mockWeather,
    // 元件內純記錄用閉包（logging／scroll）：不影響路由與搜尋參數
    logRtNearbyPush: () => {},
    logRtNoMoreReason: () => {},
    scrollToRecommendationOnce: () => {},
    markShortcutEngaged: () => {},
    // 元件 ref／state（pushNearby 成功後寫入用）
    toast: { message() {}, error() {}, success() {} },
  };
  const scope = makeScope(env, locals);
  const realAlt = compile(variant.code.alt, scope);
  const realNearby = compile(variant.code.nearby, scope);
  locals.pushAlternativeDestinationPlaceRecommendation = async (...args) => {
    rec.altCalls.push({ destination: args[3], travelDestination: args[0]?.travelContext?.destination });
    const v = await realAlt(...args);
    rec.altResults.push(v);
    return v;
  };
  locals.pushNearbyPlaceRecommendation = async (...args) => {
    const [s, , , intent, opts] = args;
    const pBefore = placeCalls.length;
    const rpcBefore = rpcLog.length;
    let v;
    let err = null;
    try {
      v = await realNearby(...args);
    } catch (e) {
      err = String(e?.message ?? e).split("\n")[0];
    }
    rec.nearbyCalls.push({
      intent,
      cityLabel: opts?.cityLabel,
      ctxDestination: s?.travelContext?.destination ?? null,
      hasRecSession: !!s?.recommendationSession,
      hasArc: !!s?.activeRecommendationContext,
      location: s?.location ?? null,
      places: placeCalls.slice(pBefore),
      rpc: rpcLog.slice(rpcBefore).map((x) => x.name),
      returned: v,
      err,
    });
    return v;
  };
  const branch = compile(variant.code.branch, scope);
  let taken;
  let err = null;
  try {
    taken = await branch();
  } catch (e) {
    err = String(e?.message ?? e).split("\n")[0];
  }
  placesMode = "ok";
  const last = rec.setMsgs.at(-1);
  const lastAssistant = last?.at(-1);
  return {
    taken: taken !== "__branch_not_taken",
    err,
    skipped,
    rec,
    c: countOf(reqs.slice(r0)),
    queries: reqs.slice(r0).map((r) => r.query),
    places: placeCalls.slice(p0),
    weather: weatherCalls.slice(w0),
    rpc: rpcLog.map((x) => x.name),
    reserve: rpcLog.filter((x) => x.name === "credits_reserve").map((x) => x.args),
    finalAssistant: lastAssistant?.role === "assistant" ? { content: String(lastAssistant.content).slice(0, 40), cards: lastAssistant.roamie?.recommendations?.length ?? 0 } : null,
    recovery: M.crc.chatRuntimeCopy("recovery", "zh-TW"),
    warns: warnLog.filter((w) => /CHAT_ALTERNATIVE/.test(w)),
  };
}
const forgedTouch = (r) => r.places.filter((c) => /亞特蘭提斯/.test(String(c.query ?? "")) || /亞特蘭提斯/.test(String(c.destinationName ?? ""))).length;
const describe = (r) =>
  `taken=${r.taken} alt=${J(r.rec.altCalls.map((a) => a.destination))}→${J(r.rec.altResults)} nearby=${r.rec.nearbyCalls.length}${r.rec.nearbyCalls.length ? J(r.rec.nearbyCalls.map((n) => ({ i: n.intent, ret: n.returned, ctxDest: n.ctxDestination, rs: n.hasRecSession, arc: n.hasArc, city: n.cityLabel, P: n.places.length, c: centersOf(n.places), rpc: n.rpc, err: n.err }))) : ""} Places=${r.places.length} centers=${J(centersOf(r.places))} Weather=${r.weather.length} RPC=${J(r.rpc)} persist=${r.rec.persist.length} final=${J(r.finalAssistant)} ${fc(r.c)} queries=${J(r.queries)}${r.err ? ` err=${r.err}` : ""}${r.warns.length ? ` warns=${J(r.warns)}` : ""}`;

P(`══ 0. 擷取 ══`);
P(`  修改後 ${SRC.post.file}：alt 分支 L${SRC.post.lines.branch}-${SRC.post.lines.branchEnd}（位於 send() 內=${SRC.post.branchInsideSend}）、alt callback L${SRC.post.lines.alt}、pushNearby L${SRC.post.lines.nearby}`);
if (SRC.pre) P(`  修改前 ${SRC.pre.file}：alt 分支 L${SRC.pre.lines.branch}-${SRC.pre.lines.branchEnd}、alt callback L${SRC.pre.lines.alt}、pushNearby L${SRC.pre.lines.nearby}`);
expect("0-extracted-real-send-alt-branch", SRC.post.branchInsideSend && /CHAT_ALTERNATIVE_SAFE_STOP/.test(SRC.post.code.branch) && /stripClientSearchScope/.test(SRC.post.code.branch), "擷取到的是 send() 內新版 alt 分支（含 SAFE_STOP 與 stripClientSearchScope）");

// ═══════════════ A. 有 dest、可信判定失敗 → 不得轉 Nearby ═══════════════
P("\n══ A. 偽造目的地後回覆「好」：實際 send() alt 分支（修改後 vs 修改前）══");
const casesA = [
  ["A1", "偽造 travelContext.destination＋快照 searchCentroid＋activeRecommendationContext 座標（GPS 可用）", () => baseSession({ location: GPS, activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, searchCentroid: { ...FAKE_C }, searchRadius: 90000, exhausted: true }), activeRecommendationContext: arc(FORGED, FAKE_C, { radius: 90000 }) })],
  ["A2", "偽造 travelContext.destination（無快照中心；GPS 可用）", () => baseSession({ location: GPS, activeCategoryIntent: "restaurant", travelContext: { interests: [], destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, exhausted: true }) })],
  ["A3", "偽造 tripDestination 完整形狀含座標（GPS 可用）", () => baseSession({ location: GPS, tripDestination: { placeId: "forged-pid", country: "日本", city: FORGED, displayLabel: FORGED, formattedName: FORGED, lat: 33.3, lng: 133.3 } })],
  ["A4", "travelContext.destination 為空字串＋偽造 tripDestination.city＋快照中心（|| 修正）", () => baseSession({ location: GPS, travelContext: { interests: [], destination: "" }, tripDestination: { placeId: "forged-pid", country: "日本", city: FORGED, displayLabel: FORGED, formattedName: FORGED, lat: 33.3, lng: 133.3 }, recommendationSession: recSnap({ destination: FORGED, searchCentroid: { ...FAKE_C }, exhausted: true }) })],
  ["A5", "偽造 tripPlanningContext.destination（GPS 可用、快照中心）", () => baseSession({ location: GPS, tripPlanningContext: { destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, searchCentroid: { ...FAKE_C }, exhausted: true }) })],
];
const A = {};
for (const [id, name, mk] of casesA) {
  const r = await runSendAlt(SRC.post, mk(), { mode: "zero" });
  A[id] = r;
  P(`  [real] ${id} ${name}：${describe(r)}`);
  if (r.skipped.length) info(`${id} 未載入的非 @/ import（被引用到）：${J(r.skipped)}`);
  const recoveryOk = r.finalAssistant?.content === r.recovery.slice(0, 40) && r.finalAssistant.cards === 0;
  expect(`${id}-safe-stop`, r.taken && !r.err && r.rec.altCalls.length === 1 && r.rec.altResults[0] === "untrusted" && r.rec.nearbyCalls.length === 0 && recoveryOk, `alt=untrusted → recovery 文案結束、不呼叫 pushNearby（實際 nearby=${r.rec.nearbyCalls.length}、final=${J(r.finalAssistant)}）`);
  expect(`${id}-no-places-no-credits-no-session`, r.places.length === 0 && r.weather.length === 0 && r.rpc.length === 0 && r.rec.persist.length === 0 && r.c.places === 0, `Places=${r.places.length} Weather=${r.weather.length} RPC=${J(r.rpc)} persist=${r.rec.persist.length}`);
  expect(`${id}-provider-cost`, gTotal(r.c) <= 1 && r.c.places === 0, `Google 合計=${gTotal(r.c)}（≤1：只有可信判定本身的 geocode；${fc(r.c)}）`);
  if (SRC.pre) {
    const pre = await runSendAlt(SRC.pre, mk(), { mode: "zero" });
    P(`  [pre ] ${id}：${describe(pre)}`);
    expect(`${id}-pre-F2-reached-nearby`, pre.rec.nearbyCalls.length > 0 || pre.places.length > 0, `修改前：不可信後轉 Nearby=${pre.rec.nearbyCalls.length} 次、Places=${pre.places.length}、centers=${J(centersOf(pre.places))}、RPC=${J(pre.rpc)}`, "pre");
  }
}

// ═══════════════ B. 有 dest、可信：applied／empty／throw／quota ═══════════════
P("\n══ B. 可信目的地「推薦其他地方」：實際 send() alt 分支 ══");
for (const city of ["京都", "大阪"]) {
  const sess = baseSession({ location: GPS, travelContext: { interests: [], destination: city }, recommendationSession: recSnap({ destination: city, searchCentroid: { ...FAKE_C }, searchRadius: 120000, exhausted: true }), activeRecommendationContext: arc(city, FAKE_C, { radius: 120000 }) });
  const r = await runSendAlt(SRC.post, sess, { mode: "ok" });
  P(`  [real] B ${city} 正常（快照偽造中心 ${pt(FAKE_C)} r=120000）：${describe(r)} reserve=${J(r.reserve)}`);
  const persisted = r.rec.persist.at(-1);
  expect(`B-${city}-applied`, r.rec.altResults[0] === "applied" && r.finalAssistant?.cards > 0 && r.rec.nearbyCalls.length === 0, `alt=applied、卡片 ${r.finalAssistant?.cards} 張、nearby=${r.rec.nearbyCalls.length}`);
  expect(`B-${city}-trusted-center`, r.places.length > 0 && r.places.every((c) => near(c, CITY[city], 25)) && r.places.every((c) => (c.radius ?? 0) < 120000) && r.weather.every((w) => near(w, CITY[city], 25)), `Places 中心皆在 ${city} 25km 內、半徑 < 120000；centers=${J(centersOf(r.places))}`);
  expect(`B-${city}-credits-commit-once`, J(r.rpc) === J(["credits_check", "credits_reserve", "credits_commit"]), `RPC=${J(r.rpc)}`);
  expect(`B-${city}-credits-metadata`, J(r.reserve).includes("PLACE_RECOMMENDATION") && J(r.reserve).includes("recommendation_batch") && J(r.reserve).includes(city), `reserve=${J(r.reserve)}`);
  expect(`B-${city}-session-destination-trusted`, r.rec.persist.length === 1 && persisted?.travelContext?.destination === city, `persistSession=${r.rec.persist.length} 次、destination=${J(persisted?.travelContext?.destination)}`);
  expect(`B-${city}-provider-cost`, gTotal(r.c) === 0, `Google=${gTotal(r.c)}（Authority 已知城市不需 Provider）`);
}
{
  const sess = () => baseSession({ location: GPS, travelContext: { interests: [], destination: "京都" }, recommendationSession: recSnap({ destination: "京都", searchCentroid: { ...FAKE_C }, exhausted: true }) });
  const e = await runSendAlt(SRC.post, sess(), { mode: "ok", places: "empty" });
  P(`  [real] B 京都 可信但 0 張：${describe(e)}`);
  // 真實 Builder 0 張時會回提示文字（summary 非空）→ callback 走「提示-only」分支：applied＋settle(false)；
  // 沒有 summary 的 empty 分支由下方例外案例覆蓋（catch → "empty"）。
  const ePersist = e.rec.persist.at(-1);
  expect("B-trusted-zero-cards-refund-no-nearby", e.rec.nearbyCalls.length === 0 && J(e.rpc) === J(["credits_check", "credits_reserve", "credits_rollback"]) && e.finalAssistant?.cards === 0 && e.places.every((c) => near(c, CITY.京都, 25)), `0 張 → rollback、不 commit、不轉 Nearby；alt=${J(e.rec.altResults)} RPC=${J(e.rpc)} nearby=${e.rec.nearbyCalls.length} final=${J(e.finalAssistant)}`);
  expect("B-trusted-zero-cards-session-trusted-only", e.rec.persist.length <= 1 && (!ePersist || (ePersist.travelContext?.destination === "京都" && (ePersist.recommendedPlaces?.length ?? 0) === 0)), `提示-only 回覆寫回 Session：destination=${J(ePersist?.travelContext?.destination)}（可信標籤）recommendedPlaces=${ePersist?.recommendedPlaces?.length ?? "-"}`);
  expect("B-probe-alt-persist-keeps-incoming-snapshot-centroid", near(ePersist?.recommendationSession?.searchCentroid, FAKE_C, 1), `alt callback L6602 sessionWithRecs＝{...merged.session}：寫回的 recommendationSession 仍是進來的快照（searchCentroid=${pt(ePersist?.recommendationSession?.searchCentroid)}）；不是新寫入的偽造值，讀取端皆先 stripClientSearchScope`, "probe");
  info(`可信但 0 張 Provider 成本：Places（Builder 層）=${e.places.length} 次（全部空結果時 Builder 的查詢輪替；與修改前比較見下行）`);
  const t = await runSendAlt(SRC.post, sess(), { mode: "ok", places: "throw" });
  P(`  [real] B 京都 Places 例外：${describe(t)}`);
  expect("B-trusted-exception-release", ["empty", "applied"].includes(t.rec.altResults[0]) && t.rec.nearbyCalls.length === 0 && !t.rpc.includes("credits_commit") && t.rpc.at(-1) === "credits_rollback", `例外 → 釋放（rollback）、不轉 Nearby；alt=${J(t.rec.altResults)} RPC=${J(t.rpc)}`);
  const h = await runSendAlt(SRC.post, sess(), { mode: "ok", ensureHydrated: false });
  P(`  [real] B 京都 訂閱未載入（ensureSubscriptionHydratedForCredits=false）：${describe(h)}`);
  expect("B-not-hydrated-no-places-no-credits", h.places.length === 0 && h.rpc.length === 0 && h.rec.nearbyCalls.length === 0, `Places=${h.places.length} RPC=${J(h.rpc)}`);
  if (SRC.pre) {
    const pe = await runSendAlt(SRC.pre, sess(), { mode: "ok", places: "empty" });
    P(`  [pre ] B 京都 可信但 0 張：${describe(pe)}`);
    info(`修改前 提示-only 寫回 recommendationSession.searchCentroid=${pt(pe.rec.persist.at(-1)?.recommendationSession?.searchCentroid)}（與修改後比較）`);
    info(`修改前 可信但 0 張 → Nearby=${pe.rec.nearbyCalls.length} 次、Places=${pe.places.length}、RPC=${J(pe.rpc)}、centers=${J(centersOf(pe.places))}`);
  }
}
// Provider timeout／null／ZERO（未知國際城市）
for (const mode of ["timeout", "null", "zero"]) {
  const r = await runSendAlt(SRC.post, baseSession({ location: GPS, travelContext: { interests: [], destination: "波爾圖" }, recommendationSession: recSnap({ destination: "波爾圖", searchCentroid: { ...FAKE_C }, exhausted: true }) }), { mode });
  P(`  [real] B 波爾圖 Provider ${mode}：${describe(r)}`);
  expect(`B-porto-${mode}-safe-stop`, r.rec.altResults[0] === "untrusted" && r.rec.nearbyCalls.length === 0 && r.places.length === 0 && r.rpc.length === 0 && r.rec.persist.length === 0 && gTotal(r.c) <= 1, `alt=${J(r.rec.altResults)} Places=${r.places.length} RPC=${J(r.rpc)} Google=${gTotal(r.c)}`);
}
for (const city of ["里斯本", "波爾圖", "金澤"]) {
  const r = await runSendAlt(SRC.post, baseSession({ location: GPS, travelContext: { interests: [], destination: city } }), { mode: "ok" });
  P(`  [real] B ${city} Provider 正常：${describe(r)}`);
  expect(`B-${city}-trusted-or-safe`, r.rec.nearbyCalls.length === 0 && r.places.every((c) => near(c, CITY[city], 25)) && gTotal(r.c) <= 1 && (r.rec.altResults[0] === "applied" ? J(r.rpc) === J(["credits_check", "credits_reserve", "credits_commit"]) : !r.rpc.includes("credits_commit")), `alt=${J(r.rec.altResults)} Places=${r.places.length} centers=${J(centersOf(r.places))} RPC=${J(r.rpc)} Google=${gTotal(r.c)}`);
}

// ═══════════════ C. 完全沒有 dest（純 GPS）═══════════════
P("\n══ C. 純 GPS 對話「推薦其他地方」：實際 send() alt 分支＋實際 pushNearbyPlaceRecommendation ══");
{
  const gpsSnap = () => baseSession({ location: GPS, activeCategoryIntent: "restaurant", recommendationSession: recSnap({ destination: undefined, searchCentroid: { ...FAKE_C }, searchRadius: 90000, exhausted: true }), activeRecommendationContext: arc(undefined, FAKE_C, { radius: 90000 }) });
  const c1 = await runSendAlt(SRC.post, gpsSnap(), { mode: "ok" });
  P(`  [real] C1 純 GPS＋快照中心 ${pt(FAKE_C)}：${describe(c1)}`);
  const n1 = c1.rec.nearbyCalls;
  expect("C1-nearby-device-gps-center", n1.length > 0 && n1.every((n) => !n.hasRecSession && !n.hasArc && n.ctxDestination == null) && c1.places.length > 0 && c1.places.every((c) => near(c, GPS, 5)), `pushNearby 收到的 session 無 recommendationSession／activeRecommendationContext／destination；Places 中心皆在裝置 GPS 5km 內；centers=${J(centersOf(c1.places))}`);
  expect("C1-nearby-delivers-and-commits", c1.finalAssistant?.cards > 0 && c1.rpc.filter((x) => x === "credits_commit").length === 1 && c1.rpc.filter((x) => x === "credits_reserve").length === 1 && J(c1.reserve).includes("nearby"), `卡片=${c1.finalAssistant?.cards} RPC=${J(c1.rpc)} reserve=${J(c1.reserve)}`);
  expect("C1-provider-cost", c1.c.places === 0 && gTotal(c1.c) <= 1, `Google=${gTotal(c1.c)}（${fc(c1.c)}）`);
  if (SRC.pre) {
    const p1 = await runSendAlt(SRC.pre, gpsSnap(), { mode: "ok" });
    P(`  [pre ] C1：${describe(p1)}`);
    info(`C1 修改前 Nearby 中心=${J(centersOf(p1.places))}（快照無 destination 時 resolveRecommendationSearchCenter 不採用快照中心，修改前後相同）`);
  }
  // C1b：快照帶 destination（但 ctx／trip 都沒有）→ 修改前會用快照中心
  const gpsSnapDest = () => baseSession({ location: GPS, activeCategoryIntent: "restaurant", recommendationSession: recSnap({ destination: FORGED, searchCentroid: { ...FAKE_C }, searchRadius: 90000, exhausted: true }), activeRecommendationContext: arc(FORGED, FAKE_C, { radius: 90000 }) });
  const c1b = await runSendAlt(SRC.post, gpsSnapDest(), { mode: "zero" });
  P(`  [real] C1b 快照帶偽造 destination＋中心（ctx／trip 無 destination）：${describe(c1b)}`);
  expect("C1b-no-snapshot-center-no-forged-label", c1b.places.every((c) => near(c, GPS, 5)) && forgedTouch(c1b) === 0 && !c1b.queries.some((q) => /亞特蘭提斯/.test(String(q))), `Places 中心皆為裝置 GPS、不含偽造標籤；centers=${J(centersOf(c1b.places))} alt=${J(c1b.rec.altResults)} nearby=${c1b.rec.nearbyCalls.length}`);
  if (SRC.pre) {
    const p1b = await runSendAlt(SRC.pre, gpsSnapDest(), { mode: "zero" });
    P(`  [pre ] C1b：${describe(p1b)}`);
    expect("C1b-pre-F2-used-snapshot-center", p1b.places.some((c) => near(c, FAKE_C, 5)) || forgedTouch(p1b) > 0, `修改前 Nearby 中心=${J(centersOf(p1b.places))}、含偽造標籤=${forgedTouch(p1b)}`, "pre");
  }
  // C3b／C4b：行為變更量化——只有 preferredArea／只有 destinationCity 為 Authority 已知城市（京都）時，修改前後的使用者可見結果
  for (const [id, name, mk] of [
    ["C3b", "只有 preferredArea=京都（無 ctx／trip destination）", () => baseSession({ location: GPS, preferredArea: "京都" })],
    ["C4b", "只有 travelContext.destinationCity=京都", () => baseSession({ location: GPS, travelContext: { interests: [], destinationCity: "京都" } })],
    ["C4c", "只有 tripDestination（city=京都 但 ctx 無 destination）", () => baseSession({ location: GPS, tripDestination: { placeId: "mock-pid-kyoto-city", country: "日本", city: "京都", displayLabel: "京都", formattedName: "京都", lat: CITY.京都.lat, lng: CITY.京都.lng } })],
  ]) {
    const r = await runSendAlt(SRC.post, mk(), { mode: "ok" });
    P(`  [real] ${id} ${name}：${describe(r)}`);
    expect(`${id}-no-untrusted-center`, r.places.every((c) => near(c, CITY.京都, 25) || near(c, GPS, 5)) && !r.places.some((c) => near(c, FAKE_C, 5)), `Places 中心只可能是 Authority 京都或裝置 GPS：centers=${J(centersOf(r.places))}`);
    if (SRC.pre) {
      const p = await runSendAlt(SRC.pre, mk(), { mode: "ok" });
      P(`  [pre ] ${id}：${describe(p)}`);
      info(`${id} 使用者可見：修改後 卡片=${r.finalAssistant?.cards ?? 0} centers=${J(centersOf(r.places))} RPC=${J(r.rpc)}｜修改前 卡片=${p.finalAssistant?.cards ?? 0} centers=${J(centersOf(p.places))} RPC=${J(p.rpc)}`);
    }
  }
  // C6：pure GPS＋Session 內既有 nearbyLocationAuthority（非 F2 範圍；記錄行為）
  const c6 = await runSendAlt(SRC.post, baseSession({ location: GPS, nearbyLocationAuthority: { displayLabel: "信義區", lat: 25.0330, lng: 121.5654, source: "clarification" } }), { mode: "ok" });
  info(`C6 pure GPS＋nearbyLocationAuthority(clarification)：centers=${J(centersOf(c6.places))} 卡片=${c6.finalAssistant?.cards ?? 0}（pushNearby L3474 採 persistedNearbyAuthority；send() 未清除此欄，A2-F2 未改動）`);
  const plain = await runSendAlt(SRC.post, baseSession({ location: GPS }), { mode: "ok" });
  P(`  [real] C2 純 GPS 無快照：${describe(plain)}`);
  expect("C2-plain-gps-nearby-works", plain.finalAssistant?.cards > 0 && plain.places.every((c) => near(c, GPS, 5)) && plain.rpc.filter((x) => x === "credits_commit").length === 1, `卡片=${plain.finalAssistant?.cards} centers=${J(centersOf(plain.places))} RPC=${J(plain.rpc)}`);
  if (SRC.pre) {
    const pp = await runSendAlt(SRC.pre, baseSession({ location: GPS }), { mode: "ok" });
    P(`  [pre ] C2：${describe(pp)}`);
    expect("C2-same-as-pre-F2", pp.finalAssistant?.cards === plain.finalAssistant?.cards && J(centersOf(pp.places)) === J(centersOf(plain.places)) && J(pp.rpc) === J(plain.rpc), `修改前 卡片=${pp.finalAssistant?.cards} centers=${J(centersOf(pp.places))} RPC=${J(pp.rpc)}（應與修改後相同）`);
  }
  for (const [id, name, sess] of [
    ["C3", "只有 preferredArea（無 city／destination）", baseSession({ location: GPS, preferredArea: FORGED })],
    ["C4", "只有 tripDestination.displayLabel（無 city）", baseSession({ location: GPS, tripDestination: { placeId: "forged-pid", country: "日本", displayLabel: FORGED, formattedName: FORGED, lat: 33.3, lng: 133.3 } })],
    ["C5", "只有 travelContext.destinationCandidate（Frontend 刪除的 14 欄之一）", baseSession({ location: GPS, travelContext: { interests: [], destinationCandidate: FORGED } })],
  ]) {
    const r = await runSendAlt(SRC.post, sess, { mode: "zero" });
    P(`  [real] ${id} ${name}：${describe(r)}`);
    if (id === "C5") expect(`${id}-candidate-dropped-gps-only`, forgedTouch(r) === 0 && !r.queries.some((q) => /亞特蘭提斯/.test(String(q))) && r.places.every((c) => near(c, GPS, 5)), `destinationCandidate 被刪除、不成為搜尋：Places 中心皆為裝置 GPS、不含偽造標籤；centers=${J(centersOf(r.places))} 卡片=${r.finalAssistant?.cards ?? 0}`);
    else expect(`${id}-safe-stop-no-search`, r.rec.nearbyCalls.length === 0 && r.places.length === 0 && r.rpc.length === 0 && r.rec.persist.length === 0 && r.finalAssistant?.content === r.recovery.slice(0, 40) && forgedTouch(r) === 0, `nearby=${r.rec.nearbyCalls.length} Places=${r.places.length} RPC=${J(r.rpc)} final=${J(r.finalAssistant)}`);
    if (SRC.pre) {
      const p = await runSendAlt(SRC.pre, sess, { mode: "zero" });
      P(`  [pre ] ${id}：${describe(p)}`);
      info(`${id} 修改前：nearby=${p.rec.nearbyCalls.length} Places=${p.places.length} 含偽造標籤=${forgedTouch(p)} centers=${J(centersOf(p.places))} RPC=${J(p.rpc)} 卡片=${p.finalAssistant?.cards ?? 0}`);
    }
  }
}

// ═══════════════ D. 明確 Nearby 意圖（實際 pushNearbyPlaceRecommendation，不經 alt 分支）═══════════════
P("\n══ D. 明確 Nearby 意圖仍正常（實際 pushNearbyPlaceRecommendation）══");
for (const [tag, sess] of [
  ["純 GPS", baseSession({ location: GPS, nearbyLocationAuthority: { displayLabel: "台北市", lat: GPS.lat, lng: GPS.lng, source: "device" } })],
  ["另有偽造 destination＋快照中心", baseSession({ location: GPS, nearbyLocationAuthority: { displayLabel: "台北市", lat: GPS.lat, lng: GPS.lng, source: "device" }, travelContext: { interests: [], destination: FORGED }, recommendationSession: recSnap({ destination: FORGED, searchCentroid: { ...FAKE_C } }) })],
]) {
  // 以同 Harness 只呼叫 pushNearby（userText＝明確附近；裝置 authority＝send() 明確附近路徑先取得的定位）
  const runNearbyDirect = async (variant) => {
    const M = await freshModules();
    G = { mode: "ok" };
    rpcLog = [];
    const p0 = placeCalls.length;
    const { env } = await loadImportsFor(variant, [variant.code.nearby]);
    let state = [];
    const locals = { locale: "zh-TW", hasPlusAccess: false, setStreaming() {}, setPartial() {}, setText() {}, setMsgs: (v) => (state = typeof v === "function" ? v(state) : v), persistSession() {}, ensureSubscriptionHydratedForCredits: () => true, geocodeLocationFn: async (a) => M.lf.geocodeTripLocationFromText(a), searchNearbyPlaces: mockSearchPlaces, fetchWeather: mockWeather, logRtNearbyPush() {}, logRtNoMoreReason() {}, scrollToRecommendationOnce() {}, markShortcutEngaged() {}, toast: { message() {}, error() {}, success() {} } };
    const nearbyFn = compile(variant.code.nearby, makeScope(env, locals));
    let ret;
    let err = null;
    try {
      ret = await nearbyFn(sess, "附近有什麼好吃的", [{ role: "user", content: "附近有什麼好吃的" }], "restaurant", { userText: "附近有什麼好吃的" });
    } catch (e) {
      err = String(e?.message ?? e).split("\n")[0];
    }
    const pl = placeCalls.slice(p0);
    return { ret, err, pl, cards: state.at(-1)?.roamie?.recommendations?.length ?? 0, rpc: rpcLog.map((x) => x.name) };
  };
  const d = await runNearbyDirect(SRC.post);
  P(`  [real] D 明確附近（${tag}）：ret=${d.ret} Places=${d.pl.length} centers=${J(centersOf(d.pl))} cards=${d.cards} RPC=${J(d.rpc)}${d.err ? ` err=${d.err}` : ""}`);
  if (tag === "純 GPS") expect(`D-explicit-nearby-gps-${tag}`, d.ret === true && d.pl.length > 0 && d.pl.every((c) => near(c, GPS, 5)) && d.cards > 0 && J(d.rpc) === J(["credits_check", "credits_reserve", "credits_commit"]), `明確附近 → 裝置 GPS 搜尋、有卡片、check→reserve→commit`);
  else expect(`D-explicit-nearby-no-forged-center-${tag}`, d.pl.every((c) => near(c, GPS, 5)) && !d.pl.some((c) => near(c, FAKE_C, 5)), `不得用快照中心：centers=${J(centersOf(d.pl))}`);
  if (SRC.pre) {
    const dp = await runNearbyDirect(SRC.pre);
    P(`  [pre ] D 明確附近（${tag}）：ret=${dp.ret} Places=${dp.pl.length} centers=${J(centersOf(dp.pl))} cards=${dp.cards} RPC=${J(dp.rpc)}${dp.err ? ` err=${dp.err}` : ""}`);
    expect(`D-explicit-nearby-same-as-pre-F2-${tag}`, dp.ret === d.ret && dp.pl.length === d.pl.length && dp.cards === d.cards && J(dp.rpc) === J(d.rpc), `pushNearby 未被 A2-F2 修改：修改前後 ret／Places／卡片／RPC 一致`);
  }
}

// ═══════════════ E. 類別 Builder trustedCenter ═══════════════
P("\n══ E. 類別推薦 Builder（buildDestinationCategoryRecommendations）trustedCenter ══");
async function runCat(M, { label, trustedCenter, session, userText }) {
  const r0 = reqs.length;
  const p0 = placeCalls.length;
  let v;
  let err = null;
  try {
    v = await M.cdcr.buildDestinationCategoryRecommendations({ destination: label, intents: ["restaurant"], userText: userText ?? `${label}美食`, context: { interests: [], destination: label }, locale: "zh-TW", searchPlaces: mockSearchPlaces, geocodeFn: async (a) => M.lf.geocodeTripLocationFromText(a), excludePlaceIds: [], rejectedPlaceNames: [], session: session ?? baseSession(), ...(trustedCenter !== undefined ? { trustedCenter } : {}) });
  } catch (e) {
    err = String(e?.message ?? e).split("\n")[0];
  }
  return { v, err, c: countOf(reqs.slice(r0)), places: placeCalls.slice(p0) };
}
{
  for (const [name, c] of [["(0,0)", { lat: 0, lng: 0 }], ["(95,200)", { lat: 95, lng: 200 }], ["NaN", { lat: Number.NaN, lng: 135 }], ["Infinity", { lat: 35, lng: Infinity }], ["字串", { lat: "35", lng: "135" }], ["(-91,0)", { lat: -91, lng: 10 }], ["(0,181)", { lat: 10, lng: 181 }]]) {
    const M = await freshModules();
    G = { mode: "ok" };
    const r = await runCat(M, { label: "京都", trustedCenter: c });
    P(`  [rt] 類別 京都 trustedCenter=${name}：Places=${r.places.length} recs=${r.v?.recommendations?.length ?? "-"} ${fc(r.c)}${r.err ? ` err=${r.err}` : ""}`);
    expect(`E-cat-invalid-center-${name}-safe-stop`, !r.err && r.places.length === 0 && gTotal(r.c) === 0 && r.v?.recommendations?.length === 0, `中心無效 → Places 前停止：Places=${r.places.length} Google=${gTotal(r.c)}`);
  }
  for (const [label, ref] of [["京都", CITY.京都], ["大阪", CITY.大阪], ["台中西屯", CITY.西屯], ["香港跑馬地", CITY.跑馬地], ["里斯本", CITY.里斯本], ["波爾圖", CITY.波爾圖], ["金澤", CITY.金澤]]) {
    const M = await freshModules();
    G = { mode: "ok" };
    const sc = await M.ctd.resolveTrustedRecommendationSearchScope({ label, ctx: { interests: [] }, session: baseSession(), locale: "zh-TW", geocodeFn: async (a) => M.lf.geocodeTripLocationFromText(a) });
    if (sc.status !== "trusted") {
      P(`  [rt] 類別 ${label}：scope=${sc.status}/${sc.reason}`);
      expect(`E-cat-${label}-scope-trusted`, false, `scope=${sc.status}/${sc.reason}`);
      continue;
    }
    const sessForged = baseSession({ recommendationSession: recSnap({ destination: sc.destination, searchCentroid: { ...FAKE_C }, searchRadius: 90000 }), activeRecommendationContext: arc(sc.destination, FAKE_C) });
    const withTc = await runCat(M, { label: sc.destination, trustedCenter: sc.center, session: M.ctd.stripClientSearchScope(sessForged) });
    P(`  [rt] 類別 ${label} trustedCenter=${pt(sc.center)}：Places=${withTc.places.length} centers=${J(centersOf(withTc.places))} recs=${withTc.v?.recommendations?.length ?? "-"} Builder ${fc(withTc.c)}${withTc.err ? ` err=${withTc.err}` : ""}`);
    expect(`E-cat-${label}-trusted-center-only`, !withTc.err && withTc.places.every((c) => near(c, ref, 3)) && !withTc.places.some((c) => c.lat === 0 && c.lng === 0) && gTotal(withTc.c) === 0, `Places 皆在可信中心 3km 內、無 (0,0)、Builder 不再 geocode（Google=${gTotal(withTc.c)}）`);
    // 未進入可信範圍模式：既有契約（相同 Builder，不帶 trustedCenter）
    const M2 = await freshModules();
    G = { mode: "ok" };
    await M2.ctd.resolveTrustedRecommendationSearchScope({ label, ctx: { interests: [] }, session: baseSession(), locale: "zh-TW", geocodeFn: async (a) => M2.lf.geocodeTripLocationFromText(a) });
    const noTc = await runCat(M2, { label: sc.destination });
    const qa = J([...new Set(withTc.places.map((c) => `${c.query}|${(c.includedTypes ?? []).join(",")}`))]);
    const qb = J([...new Set(noTc.places.map((c) => `${c.query}|${(c.includedTypes ?? []).join(",")}`))]);
    P(`  [rt] 類別 ${label} 不帶 trustedCenter（既有契約）：Places=${noTc.places.length} centers=${J(centersOf(noTc.places))} recs=${noTc.v?.recommendations?.length ?? "-"} Builder ${fc(noTc.c)}；查詢＋類型 與 trustedCenter 相同=${qa === qb}`);
    if (withTc.places.length || noTc.places.length) expect(`E-cat-${label}-queries-types-unchanged`, qa === qb && (withTc.v?.recommendations?.length ?? 0) === (noTc.v?.recommendations?.length ?? 0), `trustedCenter 與既有路徑的查詢字串／includedTypes／卡片數一致（${qa}）`);
    else info(`類別 ${label}：兩條路徑 Places 皆 0（scope gate 擋下，施工前即同）`);
    // profile 等價性：label-only 形狀 vs 真實 geocode 結果
    const live = await M2.lf.geocodeTripLocationFromText({ data: { query: sc.destination, locale: "zh-TW" } }).catch(() => null);
    const labelOnly = { placeId: `scope:${sc.destination}`, country: "unknown", city: sc.destination, lat: sc.center.lat, lng: sc.center.lng, formattedName: sc.destination, displayLabel: sc.destination, address: sc.destination };
    const pa = J(M2.lps.classifyDestinationForPlaceSearch(sc.destination, labelOnly));
    const pn = J(M2.lps.classifyDestinationForPlaceSearch(sc.destination, null));
    const pl = J(M2.lps.classifyDestinationForPlaceSearch(sc.destination, live?.location ?? live ?? null));
    info(`類別 ${label} profile：trustedCenter(label-only)=${pa}｜approx(null)=${pn}｜live geocode=${pl}`);
    expect(`E-cat-${label}-profile-equals-approx-shape`, pa === pn, `label-only 形狀與 approx／scope-lock（null）profile 相同`);
  }
}

// ═══════════════ G. Continuation 新增 FAIL 分類用：同情境改用擬真 Provider（真實 server handler＋含證據的 Google Mock）═══════════════
// continuation 腳本的 geocodeFn Mock 只回 { location, providerResult:{ok,status,query} }（沒有 place_id／types／countryCode 證據），
// A1 Provider 證據契約下會被判為不可信。這裡用同樣的 Session 形狀、同樣的續推句，但走真實 geocodeTripLocationFromText → Mock Google（含證據），
// 並依 _app.chat.tsx L5128-5145（pushMorePlaceRecommendations）resolveMorePlacesTurnDestination → resolveTrustedRecommendationSearchScope 判定。
P("\n══ G. Continuation 情境 × 擬真 Provider（分類用；pushMorePlaceRecommendations L5128-5145 鏡像）══");
{
  const PURE = ["再推薦幾個", "還有嗎", "換一批", "還有其他咖啡廳嗎", "好，再推薦幾個", "請再推薦幾個"];
  const S0 = { recommendedPlaces: [], selectedPlaces: [], phase: "recommend", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z", activeCategoryIntent: "restaurant", conversationMode: "destination_planning" };
  const poolOf = (d) => [1, 2, 3, 4].map((j) => ({ name: `${d}-p${j}`, placeName: `${d}-p${j}`, placeId: `p-${d}-${j}`, googlePlaceId: `p-${d}-${j}`, lat: 24, lng: 120, rating: 4.5, category: "restaurant" }));
  const recOf = (M, d, scope) => M.crs.createRecommendationSession({ destination: d, topic: "restaurant", pool: poolOf(d), batchSize: 3, usedQueries: [], recommendationPage: 0, parentCity: scope?.parentCity, area: scope?.area, searchScope: scope ? "area" : "city", searchRegionLabel: d }).session;
  const sessOf = (M, d, scope) => ({ ...S0, recommendationSession: recOf(M, d, scope), travelContext: { interests: [], destination: d }, recommendedPlaces: poolOf(d) });
  const tripOf = (M, d, country, lat, lng) => ({ ...sessOf(M, d), tripDestination: { placeId: `mock-${d}`, city: d, displayLabel: d, country, lat, lng } });
  // continuation 腳本同款 Mock（只有名稱／座標，沒有 Provider 證據欄位）
  const LOC = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city ?? "", region: o.region, district: o.district, sublocality: o.sublocality, lat: o.lat ?? 35, lng: o.lng ?? 135, formattedName: o.formattedName, displayLabel: o.formattedName });
  const REAL = {
    台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
    香港跑馬地: LOC({ country: "香港", city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "跑馬地", lat: 22.27, lng: 114.18 }),
    里斯本: LOC({ country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 }),
    波爾圖: LOC({ country: "葡萄牙", city: "波爾圖", region: "波爾圖", formattedName: "波爾圖", lat: 41.15, lng: -8.61 }),
  };
  let contMockCalls = 0;
  const contMockGeocode = async (req) => {
    contMockCalls += 1;
    const q = String(req?.data?.query ?? "");
    const key = q.split(",")[0].replace(/\s+/g, "").trim();
    if (REAL[key]) return { location: REAL[key], error: null, providerResult: { ok: true, status: "OK", query: q } };
    return { location: LOC({ city: key, region: key, formattedName: key }), error: null, providerResult: { ok: true, status: "OK", query: q } };
  };
  const moreTurn = async (M, session, text, geocodeFn) => {
    const destForMore = session.activeRecommendationContext?.destinationName || session.recommendationSession?.destination || session.travelContext?.destination || session.tripPlanningContext?.destination || session.tripDestination?.city;
    const active = { ...session, travelContext: { ...(session.travelContext ?? { interests: [] }), destination: destForMore, tripPurpose: "more_place_recommendations" } };
    const merged = M.tc.mergeTravelContext(active, text);
    const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, active);
    const requested = await M.ctd.resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText: text, locale: "zh-TW", geocodeFn });
    // 修改前（pre-A2）沒有 resolveTrustedRecommendationSearchScope：requestedDestination 為真即搜尋＋扣點
    const sc = M.ctd.resolveTrustedRecommendationSearchScope ? await M.ctd.resolveTrustedRecommendationSearchScope({ label: requested, ctx: placeCtx, session: merged.session, locale: "zh-TW", geocodeFn }) : requested ? { status: "trusted(pre-A2: dest truthy)", destination: requested } : { status: "unavailable", reason: "no_destination" };
    return { requested, sc };
  };
  const CTD_PATH = `${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`;
  const PRE_A2_CTD = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/chat-turn-destination.pre-A2.ts";
  const trees = [["post", null], ...(existsSync(PRE_A2_CTD) ? [["preA2-ctd", { [CTD_PATH]: readFileSync(PRE_A2_CTD, "utf8") }]] : [])];
  for (const [tree, overlay] of trees) {
    for (const mockKind of ["continuation-mock", "faithful"]) {
      for (const [label, mk, ref] of [
        ["台中西屯(area)", (M) => sessOf(M, "台中西屯", { parentCity: "台中", area: "西屯" }), CITY.西屯],
        ["香港跑馬地(area)", (M) => sessOf(M, "香港跑馬地", { parentCity: "香港", area: "跑馬地" }), CITY.跑馬地],
        ["里斯本(trip)", (M) => tripOf(M, "里斯本", "葡萄牙", 38.72, -9.14), CITY.里斯本],
        ["波爾圖(trip)", (M) => tripOf(M, "波爾圖", "葡萄牙", 41.15, -8.61), CITY.波爾圖],
        ["香港跑馬地(area；Google 另帶 locality=香港)", (M) => sessOf(M, "香港跑馬地", { parentCity: "香港", area: "跑馬地" }), CITY.跑馬地, true],
      ]) {
        const hkSaved = GEO.跑馬地;
        if (label.includes("locality=香港")) {
          if (mockKind !== "faithful") continue;
          GEO.跑馬地 = gres({ pid: "mock-pid-hk-happy-valley", fa: "香港跑馬地", ...CITY.跑馬地, types: ["neighborhood", "political"], comps: [comp("跑馬地", "跑馬地", ["neighborhood", "political"]), comp("香港", "香港", ["locality", "political"]), comp("灣仔區", "灣仔區", ["administrative_area_level_1", "political"]), comp("香港", "HK", ["country", "political"])] });
        }
        globalThis.__A2F_OVERLAY = overlay;
        const M = await freshModules();
        G = { mode: "ok" };
        const geocodeFn = mockKind === "faithful" ? async (a) => M.lf.geocodeTripLocationFromText(a) : contMockGeocode;
        const s = mk(M);
        const res = [];
        for (const t of PURE) {
          const r0 = reqs.length;
          const c0 = contMockCalls;
          const v = await moreTurn(M, s, t, geocodeFn).catch((e) => ({ err: String(e?.message ?? e).split("\n")[0] }));
          res.push({ t, requested: v.requested ?? null, sc: v.sc ? `${v.sc.status}${v.sc.destination ? `/${v.sc.destination}` : ""}${v.sc.reason ? `/${v.sc.reason}` : ""}` : v.err, near: v.sc?.center ? near(v.sc.center, ref, 3) : null, g: gTotal(countOf(reqs.slice(r0))) + (contMockCalls - c0) });
        }
        globalThis.__A2F_OVERLAY = null;
        GEO.跑馬地 = hkSaved;
        const totalG = res.reduce((a, r) => a + r.g, 0);
        const ok = res.filter((r) => /^trusted/.test(r.sc)).length;
        P(`  [rt] G ${tree}/${mockKind} ${label}：${res.map((r) => `${r.t}→req=${J(r.requested)} scope=${r.sc}${r.near === false ? " 中心錯" : ""} geo=${r.g}`).join("；")}`);
        info(`G ${tree}/${mockKind} ${label}：可搜尋 ${ok}/${res.length}、geocode 合計=${totalG}`);
      }
    }
  }
}

// G2：已確認京都 × 點名行政區／國際城市（continuation 腳本 §1／§3／A／B／D 的句子），post 樹 × 兩種 Mock
{
  const S0 = { recommendedPlaces: [], selectedPlaces: [], phase: "recommend", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z", activeCategoryIntent: "restaurant", conversationMode: "destination_planning" };
  const poolOf = (d) => [1, 2, 3, 4].map((j) => ({ name: `${d}-p${j}`, placeName: `${d}-p${j}`, placeId: `p-${d}-${j}`, googlePlaceId: `p-${d}-${j}`, lat: 24, lng: 120, rating: 4.5, category: "restaurant" }));
  const kyoto = (M) => ({ ...S0, recommendationSession: M.crs.createRecommendationSession({ destination: "京都", topic: "restaurant", pool: poolOf("京都"), batchSize: 3, usedQueries: [], recommendationPage: 0, searchScope: "city", searchRegionLabel: "京都" }).session, travelContext: { interests: [], destination: "京都" }, recommendedPlaces: poolOf("京都") });
  const contMock = async (req) => {
    const q = String(req?.data?.query ?? "");
    const key = q.split(",")[0].replace(/\s+/g, "").trim();
    const T = { 台中西屯: { country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }, 里斯本: { country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 } };
    const o = T[key] ?? { country: "日本", city: key, region: key, formattedName: key };
    return { location: { placeId: `mock-${o.formattedName}`, lat: 35, lng: 135, displayLabel: o.formattedName, ...o }, error: null, providerResult: { ok: true, status: "OK", query: q } };
  };
  for (const mockKind of ["continuation-mock", "faithful"]) {
    const rowsG2 = [];
    for (const t of ["台中西屯再推薦3個", "台中西屯再推薦幾個", "台中西屯還有嗎", "好，台中西屯再推薦幾個", "換里斯本，再推薦幾個"]) {
      for (const path of ["more", "cat"]) {
        const M = await freshModules();
        G = { mode: "ok" };
        const geocodeFn = mockKind === "faithful" ? async (a) => M.lf.geocodeTripLocationFromText(a) : contMock;
        const s = kyoto(M);
        const r0 = reqs.length;
        let dest = null;
        try {
          if (path === "more") {
            const active = { ...s, travelContext: { ...s.travelContext, destination: "京都", tripPurpose: "more_place_recommendations" } };
            const merged = M.tc.mergeTravelContext(active, t);
            const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, active);
            dest = (await M.ctd.resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText: t, locale: "zh-TW", geocodeFn })) ?? null;
          } else {
            const merged = M.tc.mergeTravelContext(s, t);
            const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, s);
            const r = M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText: t, locale: "zh-TW" });
            dest = (await M.ctd.validateCategoryTurnDestination(r, { locale: "zh-TW", geocodeFn })).destination ?? null;
          }
        } catch (e) {
          dest = `ERR ${String(e?.message ?? e).split("\n")[0]}`;
        }
        rowsG2.push(`${t}[${path}]→${dest ?? "-"}(G=${gTotal(countOf(reqs.slice(r0)))})`);
      }
    }
    info(`G2 post/${mockKind} 已確認京都×點名：${rowsG2.join("；")}`);
  }
}

// ═══════════════ F. 循環 import（新增 dpr／cdcr → destination-provider-result）═══════════════
P("\n══ F. 新增 import 的循環檢查 ══");
{
  const resolveImport = (spec, from) => {
    let base;
    if (spec.startsWith("@/")) base = `${WORK_ROOT}/src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = new URL(spec, `file://${from}`).pathname;
    else return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
    return null;
  };
  const importsOf = (f) => [...readFileSync(f, "utf8").matchAll(/(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => resolveImport(m[1] ?? m[2], f)).filter(Boolean);
  const target = `${WORK_ROOT}/src/lib/ai/destination-provider-result.ts`;
  const seen = new Set([target]);
  const queue = [target];
  let reachesBack = [];
  while (queue.length) {
    const f = queue.shift();
    for (const d of importsOf(f)) {
      if (/destination-place-recommendation\.ts$|chat-destination-category-recommendation\.ts$/.test(d)) reachesBack.push(d);
      if (!seen.has(d)) {
        seen.add(d);
        queue.push(d);
      }
    }
  }
  expect("F-no-cycle-provider-result", reachesBack.length === 0, `destination-provider-result.ts 的傳遞依賴（${seen.size} 檔）不含 dpr／cdcr`);
  // continuation 四支腳本載入的模組是否（傳遞）依賴 A2-F2 修改的 3 檔
  const contEntries = ["lib/ai/chat-turn-destination.ts", "lib/ai/conversation-recommendation-session.ts", "lib/ai/recommendation-refinement/index.ts", "lib/ai/continue-recommendation-intent.ts", "lib/ai/travel-context.ts", "lib/ai/must-visit-places.ts", "lib/ai/destination-resolution.ts"].map((p) => `${WORK_ROOT}/src/${p}`);
  const seen2 = new Set(contEntries);
  const q2 = [...contEntries];
  const hitF2 = new Set();
  while (q2.length) {
    const f = q2.shift();
    for (const d of importsOf(f)) {
      if (/destination-place-recommendation\.ts$|chat-destination-category-recommendation\.ts$|routes\/_app\.chat\.tsx$/.test(d)) hitF2.add(d.replace(`${WORK_ROOT}/`, ""));
      if (!seen2.has(d)) {
        seen2.add(d);
        q2.push(d);
      }
    }
  }
  info(`continuation 腳本載入模組的傳遞依賴 ${seen2.size} 檔；含 A2-F2 修改檔：${J([...hitF2])}`);
}

// ═══════════════ 統計 ═══════════════
for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
if (missingNames.size) P(`\n  INFO Harness 未提供的名稱：${J([...missingNames])}`);
const acc = rows.filter((r) => r.cat === "acc");
const accFail = acc.filter((r) => !r.ok);
const pre = rows.filter((r) => r.cat === "pre");
P(`\n[acc] PASS=${acc.length - accFail.length} FAIL=${accFail.length}${accFail.length ? `（${accFail.map((r) => r.id).join(", ")}）` : ""}；[pre] 修改前問題重現=${pre.filter((r) => r.ok).length}/${pre.length}`);
P(`external=${external}${external ? ` ${extLog.slice(0, 5).join(";")}` : ""}`);
const fail = external > 0 || accFail.length > 0;
P(`verify-destination-trust-boundary-a2-f2-acceptance: ${fail ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fail ? 1 : 0);
