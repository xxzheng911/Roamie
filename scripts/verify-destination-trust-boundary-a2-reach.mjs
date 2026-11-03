#!/usr/bin/env node
/**
 * A2-T1b — Destination Trust Boundary：付費搜尋入口可達性／搜尋範圍污染／Provider 請求展開（離線，現行程式）。
 *
 * 分節（對應任務單）：
 *   A  P1-1 入口盤點：isUnconfirmedSearchDestination 直接呼叫者（掃描 src＋scripts）、7 個 Credits gate 靜態判定，
 *      以及 confirmedContextDestination／resolveMorePlacesTurnDestination／validateCategoryTurnDestination 對偽造快照的執行期判定。
 *   B  P1-2：pushDestinationPlaceRecommendation 10 情境。callback 本體（React useCallback）無法在離線環境合法執行，
 *      因此：上游條件與 callback 內 Credits 前的純函式鏈「鏡像」以真實模組執行（[rt]）；
 *      Credits 前是否有確認、Credits 開始／結算、persistSession 時點為原始碼順序（[static]）；
 *      Places 是否執行＝以真實 buildDestinationMustVisitRecommendation 搭配 Mock searchPlaces／geocodeFn／fetchWeatherFn 執行（[rt]）。
 *   E/F 搜尋範圍污染：Refinement（真實 arbitration→isUnconfirmed→ensureActiveRecommendationContext→buildRecommendationRefinementResults）、
 *      more_places（真實 buildMoreDestinationRecommendations）、Shopping（真實 resolveShoppingSearchScope 與 more_places shopping 分支）、Weather。
 *   G  Provider 請求展開：Google 請求以 Mock googleRestFetch 逐筆計數（geocode／autocomplete／details），非以「驗證流程次數」計。
 *
 * 標記：[vuln] PASS＝漏洞已重現（不是功能通過）；[base] 一般流程基準（必須 PASS）；[count] 請求數斷言（依原始碼推導的預期值）；
 *       [static] 原始碼順序檢查（非執行期）；UNVERIFIED＝無法合法執行，只列不判。
 * 外部網路全部攔截（fetch／http／https／net），任一次即 FAIL；只用 Mock Key；不寫任何檔案。
 * 執行：node scripts/verify-destination-trust-boundary-a2-reach.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";

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

// ── 傳輸／框架 stub（虛擬模組，不寫檔；同 verify-provider-trust-contract-a1.mjs）──
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
    export async function googleRestFetch(input, init, context) { return globalThis.__A2R_GOOGLE(input, init, context); }
  `,
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A2R_NATIVE === true; }`,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.a2r-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "a2r-transport-stubs",
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
  lf: "lib/location.functions.ts",
  dg: "lib/ai/destination-geocode.ts",
  dgc: "lib/ai/destination-geocode-client.ts",
  dpr: "lib/ai/destination-place-recommendation.ts",
  mvp: "lib/ai/must-visit-places.ts",
  acs: "lib/ai/ai-chat-conversation-state.ts",
  tc: "lib/ai/travel-context.ts",
  sss: "lib/ai/shopping-search-scope.ts",
  rre: "lib/ai/recommendation-refinement/execute.ts",
  rrs: "lib/ai/recommendation-refinement/session.ts",
  rra: "lib/ai/recommendation-refinement/arbitrate.ts",
  crs: "lib/ai/conversation-recommendation-session.ts",
  aps: "lib/ai/ai-planning-session.ts",
  cim: "lib/ai/chat-itinerary-mode.ts",
  ds: "lib/ai/destination-scope.ts",
};
/** 新 runner＝新模組實例（模組層快取／scope lock／in-flight 全部清空；等同 Reload） */
async function freshModules() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const M = {};
  for (const [k, p] of Object.entries(MODS)) M[k] = await runner.executeFile(`${WORK_ROOT}/src/${p}`);
  return M;
}

// ════ Mock Google（逐筆計數）════
const TIMEOUT = Symbol("timeout");
const NULLBODY = Symbol("null-body");
const ZERO = { status: "ZERO_RESULTS", results: [] };
let G = {};
let curTag = "-";
const reqs = [];
globalThis.__A2R_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const kind = url.pathname.includes("/geocode/json") ? "geocode" : url.pathname.endsWith("places:autocomplete") ? "autocomplete" : url.pathname.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const rec = { kind, tag: curTag, typed: Boolean(body?.includedPrimaryTypes?.length), query: url.searchParams.get("address") ?? body?.input ?? decodeURIComponent(url.pathname.split("/").pop() ?? "") };
  reqs.push(rec);
  const h = G[kind];
  let r = typeof h === "function" ? h(rec) : h;
  if (r === undefined) r = kind === "geocode" ? ZERO : {};
  if (r === TIMEOUT) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (r === NULLBODY) return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  return Response.json(r);
};
const countOf = (list) => ({ g: list.filter((r) => r.kind === "geocode").length, a: list.filter((r) => r.kind === "autocomplete").length, d: list.filter((r) => r.kind === "details").length, o: list.filter((r) => r.kind === "other").length });
const total = (c) => c.g + c.a + c.d + c.o;
const fc = (c) => `geocode=${c.g} autocomplete=${c.a} details=${c.d}${c.o ? ` other=${c.o}` : ""}（Google 合計 ${total(c)}）`;

// Geocoding API 樣本（示意值，mock-pid-*）
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const gres = ({ pid, fa, lat, lng, types, comps }) => ({ address_components: comps, formatted_address: fa, geometry: { location: { lat, lng }, location_type: "APPROXIMATE", viewport: { northeast: { lat: lat + 0.1, lng: lng + 0.1 }, southwest: { lat: lat - 0.1, lng: lng - 0.1 } } }, place_id: pid, types });
const JP = comp("日本", "JP", ["country", "political"]);
const TW = comp("台灣", "TW", ["country", "political"]);
const GEO = {
  京都市: gres({ pid: "mock-pid-kyoto-city", fa: "日本京都府京都市", lat: 35.0116, lng: 135.7681, types: ["locality", "political"], comps: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), JP] }),
  里斯本: gres({ pid: "mock-pid-lisbon", fa: "葡萄牙里斯本", lat: 38.7223, lng: -9.1393, types: ["locality", "political"], comps: [comp("里斯本", "里斯本", ["locality", "political"]), comp("葡萄牙", "PT", ["country", "political"])] }),
  西屯區: gres({ pid: "mock-pid-taichung-xitun", fa: "台灣台中市西屯區", lat: 24.1814, lng: 120.617, types: ["administrative_area_level_2", "political"], comps: [comp("西屯區", "西屯區", ["administrative_area_level_2", "political"]), comp("台中市", "台中市", ["administrative_area_level_1", "political"]), TW] }),
  非地理: gres({ pid: "mock-pid-poi-shop", fa: "台灣台中市西屯區某商店", lat: 24.18, lng: 120.62, types: ["establishment", "point_of_interest", "store"], comps: [comp("台中市", "台中市", ["administrative_area_level_1", "political"]), TW] }),
};
const OK = (...results) => ({ status: "OK", results });

// ════ Mock searchPlaces／fetchWeatherFn（記錄中心、半徑、query）════
let placeCalls = [];
let weatherCalls = [];
let placeSeq = 0;
const searchPlaces = async ({ data }) => {
  placeCalls.push({ query: data.query, lat: data.lat, lng: data.lng, radius: data.radius, mode: data.mode, destinationName: data.destinationName, caller: data.placesCaller });
  const base = { lat: Number.isFinite(data.lat) && data.lat !== 0 ? data.lat : 0.5, lng: Number.isFinite(data.lng) && data.lng !== 0 ? data.lng : 0.5 };
  const places = [0, 1, 2].map((i) => {
    placeSeq += 1;
    return { id: `mock-place-${placeSeq}`, name: `示意地點${placeSeq}`, address: `${data.destinationName ?? data.query ?? ""} 示意地址${placeSeq}`, formattedAddress: `${data.destinationName ?? ""} 示意地址${placeSeq}`, lat: base.lat + 0.001 * (i + 1), lng: base.lng + 0.001 * (i + 1), rating: 4.5, userRatingCount: 500, types: data.includedTypes?.length ? [data.includedTypes[0], "point_of_interest"] : ["tourist_attraction", "point_of_interest"], primaryType: data.includedTypes?.[0] ?? "tourist_attraction", businessStatus: "OPERATIONAL" };
  });
  return { places, error: null, rawCount: places.length };
};
const fetchWeatherFn = async ({ data }) => {
  weatherCalls.push({ lat: data.lat, lng: data.lng });
  return null;
};

// ════ 斷言紀錄 ════
const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
const crash = (e) => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}\nexternal=${external}\nverify-destination-trust-boundary-a2-reach: FAIL\n`);
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
function expect(id, cond, detail, cat) {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
}
const unverified = [];
function UNVERIFIED(id, detail) {
  unverified.push(id);
  P(`  UNVERIFIED ${id}：${detail}`);
}
const info = (s) => P(`  INFO ${s}`);
const J = (v) => JSON.stringify(v);
const pt = (c) => (c ? `(${c.lat},${c.lng}${c.radius != null ? ` r=${c.radius}` : ""})` : "∅");
async function safe(fn) {
  try {
    return { v: await fn(), e: null };
  } catch (e) {
    return { v: undefined, e: String(e?.message ?? e).split("\n")[0] };
  }
}
const baseSession = (extra = {}) => ({ phase: "collect", messages: [], recommendedPlaces: [], selectedPlaces: [], ...extra });
const FORGED = "亞特蘭提斯市";
/** normalizeDestinationLabel 會去掉「市」；比對時用前綴 */
const isForged = (v) => typeof v === "string" && v.startsWith("亞特蘭提斯");
/** 已知父城市＋虛構區名（Authority：pending_provider，需 Provider 驗證）；可通過 destination scope gate */
const FORGED_TAIL = "台中牛牛區";
const FORGED_TRIP = { placeId: "forged-pid-atlantis", country: "日本", city: FORGED, displayLabel: FORGED, formattedName: FORGED, lat: 33.3, lng: 133.3 };
const CHAT_SRC = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
const lineOf = (idx) => CHAT_SRC.slice(0, idx).split("\n").length;

let M = await freshModules();

// ═══════════════════ A. P1-1 可達入口 ═══════════════════
P("══ A. P1-1 可達入口 ══");
{
  // A-1 isUnconfirmedSearchDestination 直接呼叫者（src 與 scripts 全掃描）
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = `${dir}/${name}`;
      if (statSync(p).isDirectory()) {
        if (name !== "node_modules" && !name.startsWith(".")) walk(p);
      } else if (/\.(ts|tsx|mjs|js)$/.test(name)) {
        const lines = readFileSync(p, "utf8").split("\n");
        lines.forEach((l, i) => {
          if (/isUnconfirmedSearchDestination\s*\(/.test(l) && !/export function isUnconfirmedSearchDestination/.test(l) && !/^\s*(\*|\/\/)/.test(l) && !/^\s*["'`]/.test(l.trim()) && !/"if \(/.test(l)) hits.push(`${p.replace(`${WORK_ROOT}/`, "")}:${i + 1}`);
        });
      }
    }
  };
  walk(`${WORK_ROOT}/src`);
  walk(`${WORK_ROOT}/scripts`);
  const srcHits = hits.filter((h) => h.startsWith("src/"));
  info(`isUnconfirmedSearchDestination 程式呼叫點（排除註解／字串常數）：src=${J(srcHits)}；scripts=${hits.filter((h) => h.startsWith("scripts/")).length} 處（${[...new Set(hits.filter((h) => h.startsWith("scripts/")).map((h) => h.split(":")[0]))].join("、")}）`);
  // REL-1：原本寫死 L6213；_app.chat.tsx 後續改動（Planner 選點模式等）讓行號漂移。改驗「唯一呼叫者位於 pushRecommendationRefinement」。
  const enclosingCallback = (hit) => {
    const [file, lineNo] = [hit.slice(0, hit.lastIndexOf(":")), Number(hit.slice(hit.lastIndexOf(":") + 1))];
    if (file !== "src/routes/_app.chat.tsx") return null;
    const before = CHAT_SRC.split("\n").slice(0, lineNo).join("\n");
    return [...before.matchAll(/const (\w+) = useCallback\(/g)].at(-1)?.[1] ?? null;
  };
  expect("A1-only-src-caller-is-refinement", srcHits.length === 1 && enclosingCallback(srcHits[0]) === "pushRecommendationRefinement", `src 唯一呼叫者=${srcHits.join(",")}（所在 callback=${srcHits.map(enclosingCallback).join(",")}）`, "static");

  // A-2 7 個 Credits gate：所在 callback、gate 前是否有確認呼叫
  // REL-1：A2 修正新增的權威範圍確認 resolveTrustedRecommendationSearchScope 也列為 gate 前確認呼叫。
  const GUARDS = ["isUnconfirmedSearchDestination", "confirmedContextDestination", "resolveCategoryTurnDestination", "validateCategoryTurnDestination", "resolveMorePlacesTurnDestination", "resolveDestination(", "planCategoryTurnClarification", "resolveTrustedRecommendationSearchScope"];
  const re = /beginPlaceRecommendationCredits\(\{/g;
  let m;
  const gates = [];
  while ((m = re.exec(CHAT_SRC))) {
    const before = CHAT_SRC.slice(0, m.index);
    const cbStart = Math.max(before.lastIndexOf("= useCallback("), before.lastIndexOf("useCallback(\n"));
    const nameM = [...before.matchAll(/const (\w+) = useCallback\(/g)].at(-1);
    const pre = CHAT_SRC.slice(cbStart, m.index);
    const meta = CHAT_SRC.slice(m.index, m.index + 200).match(/path:\s*"(\w+)"/)?.[1];
    gates.push({ line: lineOf(m.index), cb: nameM?.[1] ?? "?", path: meta, guards: GUARDS.filter((g) => pre.includes(g)) });
  }
  for (const g of gates) info(`Credits gate L${g.line} path=${g.path} callback=${g.cb} gate 前確認呼叫=${J(g.guards)}`);
  // 同一 path 可能有多個 gate（A2 修正替 pushAlternativeDestinationPlaceRecommendation 補上 more_places gate），
  // byPath 取「第一個」（原本的主要入口），額外的 gate 另外檢查。
  const byPath = {};
  for (const g of gates) byPath[g.path] ??= g;
  // REL-1：原本固定 7 個。A2 修正（A3 漏洞：替代地點無 Credits gate）在替代地點 callback 新增 1 個 more_places gate → 8 個。
  const altGates = gates.filter((g) => g.cb === "pushAlternativeDestinationPlaceRecommendation");
  expect("A2-gate-count", gates.length === 8 && altGates.length === 1 && altGates[0].path === "more_places", `beginPlaceRecommendationCredits 呼叫數=${gates.length}（L${gates.map((g) => g.line).join(",L")}）；替代地點 callback gate=${J(altGates.map((g) => `L${g.line}:${g.path}`))}`, "static");
  expect("A2-alternative-more_places-guarded", altGates.length === 1 && altGates[0].guards.includes("resolveTrustedRecommendationSearchScope"), `替代地點 more_places gate（L${altGates[0]?.line}）前有 resolveTrustedRecommendationSearchScope；gate 前確認呼叫=${J(altGates[0]?.guards)}`, "static");
  expect("A2-destination_places-no-guard", byPath.destination_places?.guards.length === 0, `destination_places（L${byPath.destination_places?.line}）gate 前無任何 Authority／Provider 確認`, "vuln-static");
  expect("A2-refinement-only-isUnconfirmed", J(byPath.refinement?.guards) === J(["isUnconfirmedSearchDestination"]), `refinement（L${byPath.refinement?.line}）gate 前只有 isUnconfirmedSearchDestination（且只在無 activeRecommendationContext 的分支）`, "vuln-static");
  expect("A2-planning_selection-no-guard", byPath.planning_selection_initial?.guards.length === 0 && byPath.planning_selection_continuation?.guards.length === 0, `planning_selection_initial（L${byPath.planning_selection_initial?.line}）／continuation（L${byPath.planning_selection_continuation?.line}）無確認；搜尋範圍＝session.planningSelection.destinationScope（name／lat／lng／radius）`, "vuln-static");
  expect("A2-nearby-no-destination-guard", byPath.nearby?.guards.length === 0, `nearby（L${byPath.nearby?.line}）無 Destination 確認；中心可來自 session.nearbyLocationAuthority（快照）`, "vuln-static");
  expect("A2-more_places-guarded", byPath.more_places?.guards.includes("resolveMorePlacesTurnDestination"), `more_places（L${byPath.more_places?.line}）gate 前有 resolveMorePlacesTurnDestination`, "static");
  expect("A2-destination_category-guarded", byPath.destination_category?.guards.includes("validateCategoryTurnDestination"), `destination_category（L${byPath.destination_category?.line}）gate 前有 validateCategoryTurnDestination`, "static");

  // A-3 無 Credits gate 的 Places 入口（靜態）：searchPlaces: searchNearbyPlaces 出現於不含 beginPlaceRecommendationCredits 的 callback
  const reS = /searchPlaces: searchNearbyPlaces|await searchNearbyPlaces\(\{/g;
  const noGate = [];
  while ((m = reS.exec(CHAT_SRC))) {
    const before = CHAT_SRC.slice(0, m.index);
    const cbStart = before.lastIndexOf("useCallback(");
    const after = CHAT_SRC.indexOf("useCallback(", m.index);
    const cbBody = CHAT_SRC.slice(cbStart, after < 0 ? undefined : after);
    const name = before.slice(Math.max(0, cbStart - 120), cbStart).match(/const (\w+)\s*=\s*$/)?.[1] ?? "(send/inline)";
    if (!cbBody.includes("beginPlaceRecommendationCredits(")) noGate.push(`L${lineOf(m.index)}:${name}`);
  }
  info(`同一 useCallback 內未見 beginPlaceRecommendationCredits 的 Places 呼叫點（靜態、粗略）：${noGate.join("；")}`);
  expect("A3-alternative-places-without-credits", noGate.some((s) => s.includes("pushAlternativeDestinationPlaceRecommendation")), "pushAlternativeDestinationPlaceRecommendation（L6442）以 travelContext／tripPlanningContext／tripDestination.city 標籤直接 Places，無 Credits gate、無 Authority", "vuln-static");

  // A-4 執行期：confirmedContextDestination 的「Provider 已確認」來源是 Client 快照
  const ctxEmpty = { interests: [] };
  const fullTrip = baseSession({ tripDestination: FORGED_TRIP });
  const cand = baseSession({ travelContext: { interests: [], destination: FORGED, destinationCandidate: { status: "resolved" } } });
  const r1 = M.ctd.confirmedContextDestination(ctxEmpty, fullTrip);
  const r2 = M.ctd.confirmedContextDestination(cand.travelContext, cand);
  const r0 = M.ctd.confirmedContextDestination({ interests: [], destination: FORGED }, baseSession({ travelContext: { interests: [], destination: FORGED } }));
  expect("A4-base-forged-label-not-confirmed", r0 === null, `只偽造 travelContext.destination → ${J(r0)}（基準：null）`, "base");
  expect("A4-forged-full-tripDestination-confirmed", isForged(r1?.destination), `偽造完整 tripDestination（placeId／country／lat／lng 皆假）→ ${J(r1)}（isResolvedDestination 只檢查欄位形狀）`, "vuln");
  expect("A4-forged-destinationCandidate-resolved-confirmed", isForged(r2?.destination), `偽造 travelContext.destinationCandidate.status="resolved" → ${J(r2)}`, "vuln");

  // A-5 執行期：more_places／destination_category 的確認函式被偽造完整 tripDestination 通過（且不呼叫 Provider）
  G = { geocode: ZERO };
  let geoFnCalls = 0;
  const geocodeFn = async (args) => {
    geoFnCalls += 1;
    return M.lf.geocodeTripLocationFromText(args);
  };
  const r0g = reqs.length;
  const more = await safe(() => M.ctd.resolveMorePlacesTurnDestination({ ctx: { interests: [] }, session: fullTrip, userText: "還有嗎", locale: "zh-TW", geocodeFn }));
  const cat = await safe(async () => (await M.ctd.validateCategoryTurnDestination(M.ctd.resolveCategoryTurnDestination({ ctx: { interests: [] }, session: fullTrip, userText: "推薦餐廳", locale: "zh-TW" }), { locale: "zh-TW", geocodeFn })).destination);
  const g5 = countOf(reqs.slice(r0g));
  expect("A5-more_places-forged-full-trip-passes", isForged(more.v) && geoFnCalls === 0, `resolveMorePlacesTurnDestination("還有嗎", 偽造完整 tripDestination) → ${J(more.v ?? more.e)}；geocodeFn=${geoFnCalls}`, "vuln");
  expect("A5-category-forged-full-trip-passes", isForged(cat.v), `validateCategoryTurnDestination(resolveCategoryTurnDestination("推薦餐廳", 偽造完整 tripDestination)).destination → ${J(cat.v ?? cat.e)}；Google ${fc(g5)}`, "vuln");
  const moreBase = await safe(() => M.ctd.resolveMorePlacesTurnDestination({ ctx: { interests: [], destination: FORGED }, session: baseSession({ travelContext: { interests: [], destination: FORGED } }), userText: "還有嗎", locale: "zh-TW", geocodeFn }));
  expect("A5-base-more_places-forged-label-blocked", moreBase.v === undefined, `只偽造 travelContext.destination（未知標籤）→ ${J(moreBase.v ?? moreBase.e ?? null)}（基準：undefined＝停在 Credits 前）`, "base");
}

// ═══════════════════ B. P1-2 pushDestinationPlaceRecommendation 10 情境 ═══════════════════
P("\n══ B. P1-2 pushDestinationPlaceRecommendation（[rt]＝真實模組執行；[static]＝原始碼順序）══");
const cbStart = CHAT_SRC.indexOf("const pushDestinationPlaceRecommendation = useCallback(");
const cbEnd = CHAT_SRC.indexOf("pushDestinationPlaceRecommendationRef.current = pushDestinationPlaceRecommendation;");
const CB = CHAT_SRC.slice(cbStart, cbEnd);
const iDest = CB.indexOf("if (!destination) return false;");
const iPersist = CB.indexOf("persistSession({ ...sessionForPlan, planningSessionId: flowSessionId });");
const iCredit = CB.indexOf("beginPlaceRecommendationCredits(");
const iBuild = CB.indexOf("await buildDestinationMustVisitRecommendation(");
const preCredit = CB.slice(iDest, iCredit);
const staticGuards = ["isUnconfirmedSearchDestination", "confirmedContextDestination", "resolveCategoryTurnDestination", "validateCategoryTurnDestination", "resolveDestination(", "geocode"].filter((g) => preCredit.includes(g));
const staticOrderOk = cbStart > 0 && iDest > 0 && iDest < iCredit && iCredit < iPersist && iPersist < iBuild;
expect("B0-static-order", staticOrderOk && staticGuards.length === 0, `L${lineOf(cbStart + iDest)} destination 非空 → L${lineOf(cbStart + iCredit)} Credits begin → L${lineOf(cbStart + iPersist)} persistSession(travelContext.destination=destination) → L${lineOf(cbStart + iBuild)} Places；兩者之間確認呼叫=${J(staticGuards)}`, "vuln-static");
const settleSites = [...CB.matchAll(/settlePlaceCredits\((true|false|recs\.length > 0)\)/g)].map((x) => `L${lineOf(cbStart + x.index)}:${x[1]}`);
info(`[static] Credits 結算點：${settleSites.join("、")}（空結果且 summary 空→false；有卡→true；例外→false 後再 renderDestinationReply（handle 已 null，不重複））`);

// 觸發文字：第一個能讓「京都」通過 shouldFetchDestinationPlaces 且本身不含目的地的句子（執行期挑選，避免硬猜 regex）
const B_TEXT_CANDIDATES = ["有哪些地方值得去", "有什麼必去的", "幫我列出必去點", "推薦必去景點"];
const B_TEXT = B_TEXT_CANDIDATES.find((t) => M.mvp.shouldFetchDestinationPlaces(t, { interests: [], destination: "京都" }) && !M.mvp.resolveMustVisitDestination({ interests: [] }, t)) ?? B_TEXT_CANDIDATES[0];
info(`B 觸發文字＝「${B_TEXT}」（候選 ${J(B_TEXT_CANDIDATES.map((t) => [t, M.mvp.shouldFetchDestinationPlaces(t, { interests: [], destination: "京都" })]))}）`);
const tripOf = (label) => ({ placeId: `forged-pid-${label}`, country: "台灣", city: label, displayLabel: label, formattedName: label, lat: 24.15, lng: 120.66 });
const SC = [
  { id: "1-空白Session", s: () => baseSession(), G: { geocode: ZERO } },
  { id: "2-偽造travelContext.destination", s: (L) => baseSession({ travelContext: { interests: [], destination: L } }), G: { geocode: ZERO }, forged: true },
  { id: "3-偽造tripPlanningContext.destination", s: (L) => baseSession({ tripPlanningContext: { destination: L } }), G: { geocode: ZERO }, forged: true },
  { id: "4-偽造tripDestination.city", s: (L) => baseSession({ tripDestination: { city: L } }), G: { geocode: ZERO }, forged: true },
  { id: "5-偽造完整tripDestination", s: (L) => baseSession({ tripDestination: tripOf(L) }), G: { geocode: ZERO }, forged: true },
  { id: "6-已知合法城市(京都)", s: () => baseSession({ travelContext: { interests: [], destination: "京都" } }), G: { geocode: OK(GEO.京都市) } },
  { id: "7-正常Trip→Chat(京都)", s: () => baseSession({ tripDestination: { placeId: "mock-pid-kyoto-city", country: "日本", city: "京都", displayLabel: "京都", lat: 35.0116, lng: 135.7681 }, tripPlanningContext: { destination: "京都" }, travelContext: { interests: [], destination: "京都" } }), G: { geocode: OK(GEO.京都市) } },
  { id: "8-Provider timeout", s: (L) => baseSession({ travelContext: { interests: [], destination: L } }), G: { geocode: TIMEOUT, autocomplete: TIMEOUT, details: TIMEOUT }, forged: true },
  { id: "9-Provider null", s: (L) => baseSession({ travelContext: { interests: [], destination: L } }), G: { geocode: NULLBODY, autocomplete: NULLBODY, details: NULLBODY }, forged: true },
  { id: "10-ZERO_RESULTS", s: (L) => baseSession({ travelContext: { interests: [], destination: L } }), G: { geocode: ZERO, autocomplete: { suggestions: [] } }, forged: true },
];
const BT = [];
// 第三種偽造標籤：可通過 scope gate、且無 approx center（才會真的走 live geocode → 8/9/10 的 Provider 結果才有意義）
const LIVE_CANDIDATES = ["大阪牛牛區", "京都牛牛町", "首爾牛牛洞", "里斯本牛牛區", "曼谷牛牛區"];
const LIVE_PROBE = LIVE_CANDIDATES.map((l) => {
  const n = M.mvp.resolveMustVisitDestination({ interests: [], destination: l }) ?? l;
  return { l, gateBlocked: M.ds.evaluateDestinationScopeGate({ destination: n, requestedIntent: "must_visit_places" }).placesCallBlocked, approx: M.dg.resolveDestinationApproxCenter(n), auth: M.ctd.resolveCategoryTurnDestination({ ctx: { interests: [] }, session: baseSession(), userText: l, locale: "zh-TW" }).confidence };
});
info(`B live-geocode 候選：${J(LIVE_PROBE)}`);
const FORGED_LIVE = LIVE_PROBE.find((p) => !p.gateBlocked && !p.approx)?.l;
info(`B 選用 live-geocode 偽造標籤＝${J(FORGED_LIVE ?? null)}`);
const B_LABELS = [FORGED_TAIL, FORGED, ...(FORGED_LIVE ? [FORGED_LIVE] : [])];
const B_RUNS = SC.flatMap((S) => (S.forged ? B_LABELS : [null]).flatMap((L) => [false, true].map((force) => ({ S, L, force }))));
for (const { S: S0, L, force } of B_RUNS) {
  {
    const S = { ...S0, id: L ? `${S0.id}[${L}]` : S0.id };
    M = await freshModules();
    G = S.G;
    curTag = `B-${S.id}-${force}`;
    placeCalls = [];
    weatherCalls = [];
    const session = S.s(L);
    // ── [rt] 鏡像：callback L4591-4607（真實 mergeTravelContext／mergeContextForPlaceFetch／shouldFetchDestinationPlaces／resolveMustVisitDestination／resolveConversationDestination）
    const mirror = await safe(() => {
      const merged = M.tc.mergeTravelContext(session, B_TEXT);
      const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, session);
      const upstream = M.mvp.shouldFetchDestinationPlaces(B_TEXT, M.mvp.mergeContextForPlaceFetch(merged.context, session));
      const canFetch = force || M.mvp.shouldFetchDestinationPlaces(B_TEXT, placeCtx);
      const destination = canFetch ? (M.mvp.resolveMustVisitDestination(placeCtx, B_TEXT) ?? M.acs.resolveConversationDestination(placeCtx, session) ?? placeCtx.destination?.trim() ?? session.tripPlanningContext?.destination?.trim()) : undefined;
      return { merged, placeCtx, upstream, canFetch, destination };
    });
    if (mirror.e) {
      expect(`B-${S.id}-force=${force}-mirror`, false, `鏡像執行失敗：${mirror.e}`, "base");
      continue;
    }
    const { placeCtx, upstream, destination } = mirror.v;
    // 若當作 Authority 檢查（僅資訊：callback 並未呼叫）
    const auth = destination ? M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session, userText: B_TEXT, locale: "zh-TW" }).destination : undefined;
    const isUnc = destination ? M.ctd.isUnconfirmedSearchDestination(destination, session) : undefined;
    const confirmed = M.ctd.confirmedContextDestination(placeCtx, session)?.destination;
    let built = null;
    let gFnCalls = 0;
    const r0 = reqs.length;
    if (destination) {
      const geocodeFn = async (args) => {
        gFnCalls += 1;
        return M.lf.geocodeTripLocationFromText(args);
      };
      const ctxForBuild = force ? M.cim.enrichContextForItineraryMode(B_TEXT, { ...placeCtx, destination, mustVisitGenerated: false }, session) : M.cim.enrichContextForItineraryMode(B_TEXT, { ...placeCtx, destination }, session);
      built = await safe(() => M.dpr.buildDestinationMustVisitRecommendation({ destination, userText: B_TEXT, context: ctxForBuild, locale: "zh-TW", searchPlaces, geocodeFn, fetchWeatherFn, excludePlaceIds: [], rejectedPlaceNames: [], planningSessionId: "mock-plan-1", session: { ...session, travelContext: { ...placeCtx, destination } } }));
    }
    const g = countOf(reqs.slice(r0));
    const recs = built?.v?.recommendations?.length ?? 0;
    const row = {
      id: S.id,
      force,
      upstream,
      enter: Boolean(destination),
      destination,
      authorityWouldConfirm: auth ?? null,
      confirmedContext: confirmed ?? null,
      isUnconfirmed: isUnc,
      credits: Boolean(destination),
      places: placeCalls.length,
      centers: [...new Set(placeCalls.map((c) => `${c.lat},${c.lng}`))].slice(0, 3),
      queries: placeCalls.slice(0, 2).map((c) => c.query),
      weather: weatherCalls.map(pt),
      geocodeFn: gFnCalls,
      google: g,
      recs,
      settle: destination ? (recs > 0 ? "true(扣)" : "false(退)") : "-",
      persistForged: Boolean(destination),
      err: built?.e ?? null,
    };
    BT.push(row);
    P(`  [rt] ${S.id} force=${force}：上游 shouldFetch=${upstream} 進入=${row.enter} destination=${J(destination ?? null)} | Authority(若檢查)=${J(row.authorityWouldConfirm)} confirmedContext=${J(row.confirmedContext)} isUnconfirmed=${J(isUnc)} | Places 呼叫=${row.places} centers=${J(row.centers)} q=${J(row.queries)} | weather=${J(row.weather)} | geocodeFn=${gFnCalls} Google ${fc(g)} | recs=${recs}${row.err ? ` err=${row.err}` : ""}`);
    row.contextPatch = built?.v?.contextPatch ?? null;
    if (S.forged && destination && L !== FORGED) {
      expect(`B-${S.id}-force=${force}-forged-reaches-Places`, row.places > 0 && !row.authorityWouldConfirm, `Authority 未確認（pending_provider）的「${destination}」→ Places ${row.places} 次、中心=${J(row.centers)}（Credits 依原始碼順序已開始）`, "vuln");
    }
    if (S.forged && destination && L === FORGED) {
      expect(`B-${S.id}-force=${force}-unknown-credits-before-scopegate`, row.places === 0, `未知標籤「${destination}」：Credits 已 begin（static），之後才由 evaluateDestinationScopeGate 擋下 Places（${row.places} 次）→ settle(false)；contextPatch=${J(row.contextPatch)} 仍寫回 Session`, "vuln");
    }
    if (S.forged && !destination) info(`B ${S.id} force=${force}：未進入（上游 shouldFetch=${upstream}；destination 只取 ctx.destination／文字，force=false 時不讀 tripPlanningContext／tripDestination）`);
    if (S.id.startsWith("1-")) expect(`B-${S.id}-force=${force}-no-entry`, !destination && row.places === 0, `空白 Session → 不進入（destination=${J(destination ?? null)}）`, "base");
    if (S.id.startsWith("6-") || S.id.startsWith("7-")) expect(`B-${S.id}-force=${force}-baseline-places`, destination === "京都" && row.places > 0, `合法城市 → Places ${row.places} 次`, "base");
  }
}
// 只偽造 tripPlanningContext／tripDestination.city 時，force=false 是否進入（L6701／L9727 上游）
info("B 欄位說明：進入＝callback 內 destination 非空（L4607 之後必達 Credits，除非另一 planning render 進行中或 subscription 未 hydrate）；Credits 開始＝[static] 順序推導；Places＝[rt]；結算＝依 recs 推導 settle(recs.length>0)（finalizeChatRecommendationDisplay 過濾未執行 → 推導）；污染 Session＝[static] L4708 在 Places 前 persist travelContext.destination=destination。");
UNVERIFIED("B-callback-body", "React useCallback 本體（restorePendingPlanAiOwner／pauseForTripDates／setPlanningRenderInProgress／beginPlaceRecommendationCredits／persistSession／renderDestinationReply）未在離線環境執行；Credits 開始／結算／persist 為原始碼順序推導");
UNVERIFIED("B-upstream-L1793-L9173", "L1793（turn.advice.triggerPlaceRecommendations）與 L9173（isStyleReselectTurn）的上游判定未執行；以 force=true 代表其 forceRegenerate:true 呼叫");

// ═══════════════════ C. 四個呼叫者（靜態＋執行期上游）═══════════════════
P("\n══ C. 四個呼叫者 Authority 狀態 ══");
{
  const sites = [...CHAT_SRC.matchAll(/await pushDestinationPlaceRecommendation(Ref\.current)?\(/g)].map((x) => ({ line: lineOf(x.index), pre: CHAT_SRC.slice(Math.max(0, x.index - 4000), x.index), ref: Boolean(x[1]) }));
  for (const s of sites) {
    const g = ["isUnconfirmedSearchDestination", "confirmedContextDestination", "validateCategoryTurnDestination", "turnDestination.destination", "resolveCategoryTurnDestination", "shouldBlockCrossScopeRecommendationFallback", "shouldFetchDestinationPlaces", "forceRegenerate: true"].filter((k) => s.pre.includes(k));
    info(`L${s.line}${s.ref ? "（Ref）" : ""} 前 4000 字元出現：${J(g)}`);
  }
  // REL-1：原本寫死 L1793／6701／9173／9727（行號漂移）。改驗仍是 4 個呼叫點，且 Ref／直接呼叫的順序不變。
  expect("C-four-call-sites", sites.length === 4 && J(sites.map((s) => s.ref)) === J([true, false, true, false]), `呼叫點=${sites.map((s) => `${s.line}${s.ref ? "(Ref)" : ""}`).join(",")}`, "static");
  // L9727：turnDestination 已算出但不參與進入判定（[rt]）
  const sess = baseSession({ travelContext: { interests: [], destination: FORGED_TAIL } });
  const merged = M.tc.mergeTravelContext(sess, B_TEXT);
  const ctx = M.mvp.mergeContextForPlaceFetch(merged.context, sess);
  const td = M.ctd.resolveCategoryTurnDestination({ ctx, session: sess, userText: B_TEXT, locale: "zh-TW" });
  const enter = M.mvp.shouldFetchDestinationPlaces(B_TEXT, ctx);
  const seg = CHAT_SRC.slice(CHAT_SRC.indexOf("const turnDestination = resolveCategoryTurnDestination({\n        ctx: placeFetchContext"), CHAT_SRC.indexOf("const applied = await pushDestinationPlaceRecommendation(\n          { ...nextSession, travelContext: refreshedPlaceCtx }"));
  const gateUsesTd = /if \(shouldFetchDestinationPlaces\([^)]*\)\s*&&[^{]*turnDestination/.test(seg);
  expect("C-L9727-turnDestination-not-gating", td.destination === undefined && enter === true && !gateUsesTd, `turnDestination.destination=${J(td.destination ?? null)}（confidence=${td.confidence}）但 shouldFetchDestinationPlaces=${enter} → 仍呼叫 pushDestinationPlaceRecommendation（turnDestination 只用於 Weather）`, "vuln");
}

// ═══════════════════ E. Refinement／more_places 搜尋範圍 ═══════════════════
P("\n══ E. Refinement／more_places 搜尋範圍（Mock searchPlaces／fetchWeatherFn 收到的中心與半徑）══");
const now = Date.now();
const FAKE_C = { lat: 1.2345, lng: 103.8 }; // 偽造座標（新加坡附近），與京都無關
const OSAKA_C = { lat: 34.6937, lng: 135.5023 };
async function runRefinement(label, session, text, locale = "zh-TW") {
  M = await freshModules();
  G = { geocode: OK(GEO.京都市) };
  curTag = `E-ref-${label}`;
  placeCalls = [];
  const r0 = reqs.length;
  let gFn = 0;
  const geocodeFn = async (args) => {
    gFn += 1;
    return M.lf.geocodeTripLocationFromText(args);
  };
  // [rt] 鏡像 pushRecommendationRefinement L6194-6233（真實函式）
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
  let wb = null;
  if (!blockedBy) {
    res = await safe(() => M.rre.buildRecommendationRefinementResults({ context: recCtx, travelContext: { ...(sfs.travelContext ?? { interests: [] }), destination: recCtx.destinationName }, locale, searchPlaces, geocodeFn, session: sfs }));
    // [rt] L6331-6347 寫回 recommendationSession
    if (res.v?.recommendations?.length) {
      wb = M.crs.createRecommendationSession({ destination: recCtx.destinationName, topic: "restaurant", pool: res.v.recommendations, searchCentroid: recCtx.latitude != null && recCtx.longitude != null ? { lat: recCtx.latitude, lng: recCtx.longitude } : undefined, searchRadius: recCtx.radius }).session;
    }
  }
  const g = countOf(reqs.slice(r0));
  return { route: arbitration.route, blockedBy, recCtx, places: placeCalls.slice(), gFn, g, res, wb };
}
{
  // E-1 偽造 activeRecommendationContext（任意標籤＋座標＋半徑）：L6205 分支被跳過，isUnconfirmed 不執行
  const forgedArc = { destinationName: FORGED, intent: "restaurant", latitude: FAKE_C.lat, longitude: FAKE_C.lng, radius: 80000, previousPlaceIds: [], previousCanonicalKeys: [], currentResultPlaceIds: [], usedQueries: [], createdAt: now, updatedAt: now };
  const e1 = await runRefinement("forgedARC", baseSession({ activeRecommendationContext: forgedArc, activeCategoryIntent: "restaurant" }), "想吃便宜一點的");
  info(`E-1 route=${e1.route} blockedBy=${e1.blockedBy} Places=${e1.places.length} centers=${J([...new Set(e1.places.map((c) => `${c.lat},${c.lng},r=${c.radius}`))])} q=${J(e1.places.slice(0, 2).map((c) => c.query))} geocodeFn=${e1.gFn} Google ${fc(e1.g)} 寫回 searchCentroid=${J(e1.wb?.searchCentroid ?? null)} searchRadius=${J(e1.wb?.searchRadius ?? null)}`);
  expect("E1-refinement-forged-activeRecommendationContext", !e1.blockedBy && e1.places.length > 0 && e1.places.every((c) => c.lat === FAKE_C.lat && c.lng === FAKE_C.lng) && e1.gFn === 0, `偽造 activeRecommendationContext{${FORGED}, ${pt(FAKE_C)}} → Places 全部以偽造中心搜尋、geocode 0 次、未經 isUnconfirmed`, "vuln");
  expect("E1-refinement-writeback-forged-radius", e1.wb?.searchRadius === 80000 && e1.wb?.searchCentroid?.lat === FAKE_C.lat, `結果寫回 recommendationSession.searchCentroid=${J(e1.wb?.searchCentroid)} searchRadius=${e1.wb?.searchRadius}（L6342-6346）`, "vuln");
  const radii = [...new Set(e1.places.map((c) => c.radius))];
  info(`E-1 Refinement 送出的 radius=${J(radii)}（execute.ts 不讀 recCtx.radius；寫回時沿用）`);

  // E-2 recommendationSession 快照（destination=京都 confirmed via travelContext）但 searchCentroid 偽造，無 activeRecommendationContext → L6213 放行
  const recS = { sessionId: "rec-forged", destination: "京都", topic: "restaurant", pool: [], cursor: 0, returnedPlaceIds: [], returnedCanonicalKeys: [], usedQueries: [], nextQueryCursor: 0, recommendationPage: 0, exhausted: false, searchCentroid: { ...FAKE_C }, searchRadius: 50000, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
  const e2 = await runRefinement("forgedCentroid", baseSession({ travelContext: { interests: [], destination: "京都" }, recommendationSession: recS, activeCategoryIntent: "restaurant" }), "想吃便宜一點的");
  info(`E-2 route=${e2.route} blockedBy=${e2.blockedBy} recCtx.lat/lng=${J([e2.recCtx?.latitude, e2.recCtx?.longitude])} Places=${e2.places.length} centers=${J([...new Set(e2.places.map((c) => `${c.lat},${c.lng}`))])} geocodeFn=${e2.gFn}`);
  if (e2.blockedBy) UNVERIFIED("E2-refinement-snapshot-centroid", `測試語句路由為 ${e2.route}／${e2.blockedBy}，未進入搜尋（不代表安全）`);
  else expect("E2-refinement-snapshot-centroid-京都", e2.places.length > 0 && e2.places.every((c) => c.lat === FAKE_C.lat), `確認目的地＝京都，但快照 searchCentroid=${pt(FAKE_C)} → Places 中心=${J([...new Set(e2.places.map((c) => `${c.lat},${c.lng}`))])}`, "vuln");

  // E-3 快照 destination 與確認目的地不同：travelContext=京都，activeRecommendationContext=大阪＋大阪座標
  const e3 = await runRefinement("mismatch", baseSession({ travelContext: { interests: [], destination: "京都" }, tripDestination: { placeId: "mock-pid-kyoto-city", country: "日本", city: "京都", lat: 35.0116, lng: 135.7681 }, activeRecommendationContext: { destinationName: "大阪", intent: "restaurant", latitude: OSAKA_C.lat, longitude: OSAKA_C.lng, previousPlaceIds: [], previousCanonicalKeys: [], currentResultPlaceIds: [], usedQueries: [], createdAt: now, updatedAt: now }, activeCategoryIntent: "restaurant" }), "想吃便宜一點的");
  expect("E3-refinement-snapshot-dest-differs", !e3.blockedBy && e3.places.length > 0 && e3.places.every((c) => c.lat === OSAKA_C.lat) && e3.places.some((c) => /大阪/.test(c.query ?? "")), `確認目的地＝京都（Trip），快照＝大阪 → Places q=${J(e3.places.slice(0, 1).map((c) => c.query))} 中心=${J([...new Set(e3.places.map((c) => `${c.lat},${c.lng}`))])}（無一致性檢查）`, "vuln");

  // E-4 Refinement 請求數：記憶體已鎖定座標 vs Reload 後無座標
  for (const city of ["京都", "里斯本"]) {
    const arc = (withC) => ({ destinationName: city, intent: "restaurant", ...(withC ? { latitude: 10.5, longitude: 10.5 } : {}), previousPlaceIds: [], previousCanonicalKeys: [], currentResultPlaceIds: [], usedQueries: [], createdAt: now, updatedAt: now });
    const locked = await runRefinement(`locked-${city}`, baseSession({ activeRecommendationContext: arc(true), activeCategoryIntent: "restaurant" }), "想吃便宜一點的");
    G = { geocode: OK(city === "京都" ? GEO.京都市 : GEO.里斯本) };
    const reload = await (async () => {
      const r = await runRefinement(`reload-${city}`, baseSession({ activeRecommendationContext: arc(false), activeCategoryIntent: "restaurant" }), "想吃便宜一點的");
      return r;
    })();
    info(`E-4 Refinement ${city}：已鎖定座標 → geocodeFn=${locked.gFn} Google ${fc(locked.g)} Places=${locked.places.length}；Reload 無座標 → geocodeFn=${reload.gFn} Google ${fc(reload.g)} Places=${reload.places.length}`);
    expect(`E4-refinement-${city}-locked-0-geocode`, locked.gFn === 0 && total(locked.g) === 0, `已鎖定座標：geocode 0`, "count");
  }
}

// more_places
async function runMore(label, { destination, recSession, session, G: g = { geocode: OK(GEO.京都市) }, userText = "還有嗎", activeCategoryIntent, fresh = true }) {
  if (fresh) M = await freshModules();
  G = g;
  curTag = `E-more-${label}`;
  placeCalls = [];
  weatherCalls = [];
  const r0 = reqs.length;
  let gFn = 0;
  const geocodeFn = async (args) => {
    gFn += 1;
    return M.lf.geocodeTripLocationFromText(args);
  };
  const sess = session ?? baseSession({ travelContext: { interests: [], destination }, recommendationSession: recSession, activeCategoryIntent });
  const res = await safe(() => M.dpr.buildMoreDestinationRecommendations({ destination, userText, context: { interests: [], destination, tripPurpose: "more_place_recommendations" }, locale: "zh-TW", searchPlaces, geocodeFn, fetchWeatherFn, excludePlaceIds: [], rejectedPlaceNames: [], activeChatIntent: activeCategoryIntent, activeCategoryIntent, session: sess, usedPlaces: undefined, recommendationSession: recSession }));
  return { places: placeCalls.slice(), weather: weatherCalls.slice(), gFn, g: countOf(reqs.slice(r0)), res };
}
const recSnap = (extra) => ({ sessionId: `rec-${Math.random().toString(36).slice(2, 8)}`, destination: "京都", topic: "restaurant", pool: [], cursor: 0, returnedPlaceIds: [], returnedCanonicalKeys: [], usedQueries: [], nextQueryCursor: 0, recommendationPage: 0, exhausted: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), ...extra });
{
  const m1 = await runMore("forgedCentroid", { destination: "京都", recSession: recSnap({ searchCentroid: { ...FAKE_C }, searchRadius: 90000 }), activeCategoryIntent: "restaurant" });
  info(`E-5 more_places 京都＋快照 searchCentroid=${pt(FAKE_C)}：Places=${m1.places.length} centers=${J([...new Set(m1.places.map((c) => `${c.lat},${c.lng},r=${c.radius}`))])} weather=${J(m1.weather.map(pt))} geocodeFn=${m1.gFn} Google ${fc(m1.g)}${m1.res.e ? ` err=${m1.res.e}` : ""}`);
  expect("E5-more_places-forged-centroid", m1.places.length > 0 && m1.places.every((c) => c.lat === FAKE_C.lat && c.lng === FAKE_C.lng) && m1.gFn === 0, `Places 全以快照 searchCentroid 搜尋（L1602-1605 不檢查 destination 一致），geocode 0`, "vuln");
  expect("E5-more_places-weather-forged-centroid", m1.weather.length === 1 && m1.weather[0].lat === FAKE_C.lat, `fetchWeatherFn 收到 ${J(m1.weather.map(pt))}（L1650）`, "vuln");
  const m2 = await runMore("mismatch", { destination: "京都", recSession: recSnap({ destination: "大阪", searchCentroid: { ...OSAKA_C } }), activeCategoryIntent: "restaurant" });
  expect("E6-more_places-snapshot-dest-differs", m2.places.length > 0 && m2.places.every((c) => c.lat === OSAKA_C.lat), `確認目的地＝京都，快照 destination＝大阪＋大阪座標 → Places 中心=${J([...new Set(m2.places.map((c) => `${c.lat},${c.lng}`))])} q=${J(m2.places.slice(0, 1).map((c) => c.query))}`, "vuln");
  // 請求數：記憶體已鎖定 vs Reload 無座標
  for (const [city, geo] of [["京都", GEO.京都市], ["里斯本", GEO.里斯本]]) {
    const locked = await runMore(`locked-${city}`, { destination: city, recSession: recSnap({ destination: city, searchCentroid: { lat: 11.5, lng: 11.5 } }), activeCategoryIntent: "restaurant", G: { geocode: OK(geo) } });
    const reload = await runMore(`reload-${city}`, { destination: city, recSession: recSnap({ destination: city }), activeCategoryIntent: "restaurant", G: { geocode: OK(geo) } });
    info(`E-7 more_places ${city}：已鎖定座標 → geocodeFn=${locked.gFn} Google ${fc(locked.g)} Places=${locked.places.length} weather=${locked.weather.length}；Reload 無座標 → geocodeFn=${reload.gFn} Google ${fc(reload.g)} Places=${reload.places.length} weather=${reload.weather.length}`);
    expect(`E7-more_places-${city}-locked-0-geocode`, locked.gFn === 0 && total(locked.g) === 0, "已鎖定座標：geocode 0", "count");
  }
}

// ═══════════════════ F. Shopping／Weather ═══════════════════
P("\n══ F. Shopping Search Scope／Weather ══");
{
  M = await freshModules();
  const s1 = M.sss.resolveShoppingSearchScope({ destination: "京都", existingScope: { primaryDestination: "京都", activeSearchCity: "大阪", searchCentroid: { ...FAKE_C }, searchRadius: 120000 } });
  info(`F-1 resolveShoppingSearchScope(京都, existingScope{activeSearchCity:大阪, centroid:${pt(FAKE_C)}, r:120000}) → activeSearchCity=${s1.activeSearchCity} centroid=${pt(s1.searchCentroid)} radius=${s1.searchRadius}`);
  expect("F1-shopping-scope-adopts-forged", s1.activeSearchCity === "大阪" && s1.searchCentroid.lat === FAKE_C.lat && s1.searchRadius === 120000, "activeSearchCity／searchCentroid／searchRadius 全部沿用快照（L161-162、L232-236、L252-255）", "vuln");
  const s2 = M.sss.resolveShoppingSearchScope({ destination: "京都", existingScope: { activeSearchCity: "大阪", searchCentroid: { ...FAKE_C } }, shownPlaces: [{ name: "x", address: "日本京都府京都市中京區", lat: 35.0, lng: 135.76 }] });
  info(`F-2 同上但 shownPlaces 位於京都 → activeSearchCity=${s2.activeSearchCity} centroid=${pt(s2.searchCentroid)}（shownPlaces 亦來自快照 pool）`);
  const sh = await runMore("shopping", { destination: "京都", recSession: recSnap({ topic: "shopping", activeSearchCity: "大阪", searchCentroid: { ...FAKE_C }, searchRadius: 120000 }), activeCategoryIntent: "shopping", userText: "還有其他購物的地方嗎" });
  info(`F-3 more_places shopping：Places=${sh.places.length} centers=${J([...new Set(sh.places.map((c) => `${c.lat},${c.lng},r=${c.radius}`))])} q=${J(sh.places.slice(0, 3).map((c) => c.query))} weather=${J(sh.weather.map(pt))}${sh.res.e ? ` err=${sh.res.e}` : ""}`);
  expect("F3-shopping-followup-forged-scope", sh.places.length > 0 && sh.places.every((c) => c.lat === FAKE_C.lat && c.lng === FAKE_C.lng) && sh.places.some((c) => /大阪/.test(c.query ?? "")), `Shopping 追問：確認目的地＝京都，Places 以快照 activeSearchCity＝大阪、中心 ${pt(FAKE_C)} 搜尋`, "vuln");
  const radii = [...new Set(sh.places.map((c) => c.radius))];
  expect("F3-shopping-followup-forged-radius", radii.includes(120000), `Shopping 送出 radius=${J(radii)}（快照 searchRadius=120000）`, "vuln");
  // Weather（destination_places）：只在 geocode 成功時，以 geocode 座標呼叫（非快照）
  const wForged = BT.filter((r) => r.id.startsWith("2-") || r.id.startsWith("8-") || r.id.startsWith("9-") || r.id.startsWith("10-"));
  info(`F-4 destination_places Weather：偽造標籤＋geocode 失敗 → weather 呼叫=${J(wForged.map((r) => `${r.id}/${r.force}:${r.weather.length}`))}；京都 → ${J(BT.filter((r) => r.id.startsWith("6-")).map((r) => r.weather))}`);
  UNVERIFIED("F-weather-prefetch-L9700", "send() 內 prefetchDestinationWeather（只對 turnDestination.destination）未執行；靜態：以 Authority 確認的 destination 為準");
}

// ═══════════════════ G. Provider 請求上限 ═══════════════════
P("\n══ G. Provider 請求展開（逐筆計數 Mock googleRestFetch）══");
const GT = [];
{
  // G-1 ctd runAreaProviderValidation（placesFallback:false）→ Web server handler
  const G1 = [
    ["success(西屯區)", { geocode: OK(GEO.西屯區) }],
    ["ZERO_RESULTS", { geocode: ZERO }],
    ["null body", { geocode: NULLBODY }],
    ["timeout", { geocode: TIMEOUT }],
    ["非地理類型", { geocode: OK(GEO.非地理) }],
  ];
  for (const [name, g] of G1) {
    M = await freshModules();
    G = g;
    curTag = `G1-${name}`;
    let gFn = 0;
    const geocodeFn = async (args) => {
      gFn += 1;
      return M.lf.geocodeTripLocationFromText(args);
    };
    const res = M.ctd.resolveCategoryTurnDestination({ ctx: { interests: [] }, session: baseSession(), userText: "台中西屯美食", locale: "zh-TW" });
    const r0 = reqs.length;
    const v1 = await safe(() => M.ctd.validateCategoryTurnDestination(res, { locale: "zh-TW", geocodeFn }));
    const c1 = countOf(reqs.slice(r0));
    const r1 = reqs.length;
    const v2 = await safe(() => M.ctd.validateCategoryTurnDestination(res, { locale: "zh-TW", geocodeFn }));
    const c2 = countOf(reqs.slice(r1));
    // 同時兩個（in-flight 去重）— 新模組
    M = await freshModules();
    G = g;
    const res2 = M.ctd.resolveCategoryTurnDestination({ ctx: { interests: [] }, session: baseSession(), userText: "台中西屯美食", locale: "zh-TW" });
    const r2 = reqs.length;
    let gFn2 = 0;
    const geocodeFn2 = async (args) => {
      gFn2 += 1;
      return M.lf.geocodeTripLocationFromText(args);
    };
    await Promise.all([M.ctd.validateCategoryTurnDestination(res2, { locale: "zh-TW", geocodeFn: geocodeFn2 }), M.ctd.validateCategoryTurnDestination(res2, { locale: "zh-TW", geocodeFn: geocodeFn2 })]);
    const c3 = countOf(reqs.slice(r2));
    GT.push({ path: "ctd 驗證（Web server）", scen: name, first: total(c1), second: total(c2), concurrent: total(c3) });
    info(`G-1 ctd ${name}：pending=${res.confidence} 第 1 次 geocodeFn=1? ${gFn >= 1} → Google ${fc(c1)} verdict=${v1.v?.confidence ?? v1.e}；立即第 2 次 → Google ${fc(c2)}；並行 2 次 → geocodeFn=${gFn2} Google ${fc(c3)}`);
    expect(`G1-ctd-${name}-1-google-request`, c1.g === 1 && total(c1) === 1 && res.confidence === "pending_provider", `每次驗證＝1 個 Google Geocoding 請求（placesFallback:false 不展開 Autocomplete／Details）`, "count");
    expect(`G1-ctd-${name}-repeat-0`, total(c2) === 0 && total(c3) === 1, `重複（快取／冷卻）=${total(c2)}、並行去重=${total(c3)}`, "count");
  }
  info("G-1 註：ctd 不經 isCapacitorNativeShell，iOS 也呼叫同一 geocodeFn（serverFn）；serverFn 若在 iOS 回空 envelope，ctd 不改走 Client（classify 以 envelope 判定）");

  // G-2 geocodeDestinationWithFallback：Web／iOS 最壞請求數（失敗情境用會展開 3 個查詢的標籤）
  const LIVE3 = FORGED_LIVE ?? "大阪牛牛區";
  const G2 = [
    ["success 首查詢", { geocode: OK(GEO.里斯本) }, "里斯本"],
    ["全 ZERO＋Autocomplete 空（1 查詢）", { geocode: ZERO, autocomplete: { suggestions: [] } }, FORGED],
    ["全 ZERO＋Autocomplete 空（1 查詢）", { geocode: ZERO, autocomplete: { suggestions: [] } }, "里斯本"],
    ["全 ZERO＋Autocomplete 空", { geocode: ZERO, autocomplete: { suggestions: [] } }, LIVE3],
    ["ZERO＋Autocomplete 有 placeId＋Details 空", { geocode: ZERO, autocomplete: { suggestions: [{ placePrediction: { placeId: "mock-pid-x", text: { text: LIVE3 } } }] }, details: {} }, LIVE3],
    ["ZERO＋regions 空／無限制有 placeId＋Details 空", { geocode: ZERO, autocomplete: (rec) => (rec.typed ? { suggestions: [] } : { suggestions: [{ placePrediction: { placeId: "mock-pid-y", text: { text: LIVE3 } } }] }), details: {} }, LIVE3],
    ["timeout（全部）", { geocode: TIMEOUT, autocomplete: TIMEOUT, details: TIMEOUT }, LIVE3],
    ["null body（全部）", { geocode: NULLBODY, autocomplete: NULLBODY, details: NULLBODY }, LIVE3],
  ];
  info(`G-2 查詢展開：buildDestinationGeocodeQueries(${LIVE3})=${J(M.dg.buildDestinationGeocodeQueries(LIVE3, "zh-TW"))}；(里斯本)=${J(M.dg.buildDestinationGeocodeQueries("里斯本", "zh-TW"))}；(${FORGED})=${J(M.dg.buildDestinationGeocodeQueries(FORGED, "zh-TW"))}`);
  for (const [name, g, dest] of G2) {
    for (const platform of ["web", "ios", "web-rpc-null", "web-rpc-throw"]) {
      M = await freshModules();
      G = g;
      globalThis.__A2R_NATIVE = platform === "ios";
      curTag = `G2-${name}-${platform}`;
      let sfn = 0;
      const geocodeFn = async (args) => {
        sfn += 1;
        if (platform === "web-rpc-null") return null;
        if (platform === "web-rpc-throw") throw new Error("rpc failed");
        return M.lf.geocodeTripLocationFromText(args);
      };
      const r0 = reqs.length;
      const v1 = await safe(() => M.dg.geocodeDestinationWithFallback({ destination: dest, locale: "zh-TW", geocodeFn }));
      const c1 = countOf(reqs.slice(r0));
      const sfn1 = sfn;
      const r1 = reqs.length;
      await safe(() => M.dg.geocodeDestinationWithFallback({ destination: dest, locale: "zh-TW", geocodeFn }));
      const c2 = countOf(reqs.slice(r1));
      // in-flight 去重（新模組，並行兩次）
      M = await freshModules();
      G = g;
      const r2 = reqs.length;
      await Promise.all([0, 1].map(() => safe(() => M.dg.geocodeDestinationWithFallback({ destination: dest, locale: "zh-TW", geocodeFn: async (a) => (platform === "web-rpc-null" ? null : platform === "web-rpc-throw" ? Promise.reject(new Error("rpc")) : M.lf.geocodeTripLocationFromText(a)) }))));
      const c3 = countOf(reqs.slice(r2));
      globalThis.__A2R_NATIVE = false;
      GT.push({ path: `geocodeDestinationWithFallback ${platform}`, scen: name, first: total(c1), detail: fc(c1), serverFn: sfn1, second: total(c2), concurrent: total(c3) });
      info(`G-2 ${platform.padEnd(13)} ${name}（${dest}）：第 1 次 serverFn=${sfn1} ${fc(c1)} loc=${v1.v ? "有" : "null"}；第 2 次 ${fc(c2)}；並行 2 次 ${fc(c3)}`);
    }
  }
  const worstWeb = Math.max(...GT.filter((r) => r.path === "geocodeDestinationWithFallback web").map((r) => r.first));
  const worstIos = Math.max(...GT.filter((r) => r.path === "geocodeDestinationWithFallback ios").map((r) => r.first));
  const worstWebRpc = Math.max(...GT.filter((r) => r.path.startsWith("geocodeDestinationWithFallback web-rpc")).map((r) => r.first));
  info(`G-2 最壞（實測）：Web server 路徑=${worstWeb}、Web RPC 失敗改走 Client=${worstWebRpc}、iOS=${worstIos}（MAX_GEOCODE=3／MAX_AUTOCOMPLETE=2／MAX_PLACE_DETAILS=1 是「invokeProvider 次數」上限，非 Google 請求上限）`);
  // 原始碼推導：Web Phase 1＝3 次 serverFn(placesFallback:false)×1 geocode；Phase 2 第 1 次 serverFn(placesFallback:true) 內部 geocode 1＋Autocomplete(regions)1＋Autocomplete(無限制)1＋Details 1，
  // 之後 placeDetailsCallCount=1 → 第 2 個 autocomplete 查詢被 break → 3+4=7。iOS：Phase 1 Client geocode×3；Phase 2 Autocomplete 1（有 placeId→Details 1 後 break，或空→再 1）→ 5。
  expect("G2-web-worst-7", worstWeb === 7, `Web server 路徑最壞 Google 請求=${worstWeb}（預期 7 > MAX 加總 3+2+1=6）`, "count");
  expect("G2-ios-worst-5", worstIos === 5, `iOS 最壞 Google 請求=${worstIos}（預期 5）`, "count");
}

// ═══════════════════ 統計 ═══════════════════
for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
P("\n══ B 表（10 情境 × force）══");
for (const r of BT) P(`  ${r.id.padEnd(34)} force=${String(r.force).padEnd(5)} 進入=${r.enter ? "是" : "否"} Authority先確認=否(static) Credits=${r.credits ? "開始" : "-"} Places=${r.places} 結算=${r.settle} 污染Session=${r.persistForged ? `是(${r.destination})` : "-"} geocodeFn=${r.geocodeFn} Google=${total(r.google)}`);
P("\n══ G 表 ══");
for (const r of GT) P(`  ${r.path.padEnd(42)} ${String(r.scen).padEnd(40)} 第1次=${r.first}${r.serverFn != null ? `(serverFn=${r.serverFn})` : ""} 第2次=${r.second} 並行2次=${r.concurrent}`);
const cnt = (pred) => rows.filter(pred).length;
const vulnRows = rows.filter((r) => r.cat.startsWith("vuln"));
const hardFail = rows.filter((r) => !r.ok && !r.cat.startsWith("vuln"));
P(`\n[vuln] 重現成立=${vulnRows.filter((r) => r.ok).length}/${vulnRows.length}；[base/count/static] PASS=${cnt((r) => r.ok && !r.cat.startsWith("vuln"))} FAIL=${hardFail.length}${hardFail.length ? `（${hardFail.map((r) => r.id).join(",")}）` : ""}；UNVERIFIED=${unverified.length}`);
P(`external=${external}${external ? ` ${extLog.slice(0, 5).join(";")}` : ""}`);
const fail = external > 0 || hardFail.length > 0;
P(`verify-destination-trust-boundary-a2-reach: ${fail ? "FAIL" : "DONE"}`);
// REL-1：stdout 是 pipe 時，write 後立刻 process.exit 會截斷輸出（統計列看不到）；等寫完再結束。
process.stdout.write(`${out.join("\n")}\n`, () => process.exit(fail ? 1 : 0));
