#!/usr/bin/env node
/**
 * A2-T1c — 「推薦其他地方」（pushAlternativeDestinationPlaceRecommendation）可達性與無扣點 Places 證據（離線，現行程式）。
 *
 * 任務單停止條件：若確認可在無扣點下呼叫 Places → 立即停止並回報。因此本腳本只做此項，A2 契約 15 項另檔。
 *
 * 執行層級：
 *   [rt]     以真實模組執行（vite-node 程序內 API）；Google 以 Mock googleRestFetch 逐筆計數（含 Places searchText／searchNearby）。
 *            Places 鏈＝真實 buildAlternativeDestinationRecommendations → 真實 createUnifiedSearchPlacesFn(真實 searchPlaces server handler)
 *            → Mock Google；geocodeFn＝真實 geocodeTripLocationFromText server handler → Mock Google。
 *   [mirror] send() 內 L9288 之前會攔截本輪的分支，以真實的純函式（與 send() 同參數）逐一評估「好」是否會被攔截；
 *            再以真實 shouldAcceptAlternativeRecommendations 與 L9300-9303 的 dest 取值鏡像決定是否進入 callback。
 *   [static] 原始碼檢查：callback 本體與 send() L9288 分支內無 Credits 呼叫；server searchPlaces middleware 無 Credits。
 *   UNVERIFIED：React send()／useCallback 本體未執行。
 * 標記：[vuln] PASS＝漏洞已重現；[base] 必須 PASS；外部網路全部攔截，任一次即 FAIL；Mock Key；不寫任何檔案。
 * 執行：node scripts/verify-destination-trust-boundary-a2-alt-reach.mjs
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
for (const k of ["info", "log", "warn", "debug", "error"]) console[k] = () => {};

const STUBS = {
  "@tanstack/react-start": `
    export const createServerFn = () => {
      const b = {
        middleware(list) { b.mw = list; return b; },
        inputValidator(fn) { b.v = fn; return b; },
        handler(fn) { return async (args) => { globalThis.__A2A_SERVERFN = (globalThis.__A2A_SERVERFN ?? 0) + 1; return fn({ data: b.v ? b.v(args?.data) : args?.data, context: {} }); }; },
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
  "@/lib/capacitor-native-shell": `export function isCapacitorNativeShell() { return globalThis.__A2A_NATIVE === true; }`,
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
  dpr: "lib/ai/destination-place-recommendation.ts",
  lf: "lib/location.functions.ts",
  pf: "lib/places.functions.ts",
  psu: "lib/places-search-unified.ts",
  crr: "lib/ai/chat-recommendation-refresh.ts",
  crc: "lib/chat-runtime-copy.ts",
  tc: "lib/ai/travel-context.ts",
  mvp: "lib/ai/must-visit-places.ts",
  tpc: "lib/ai/trip-planning-context.ts",
  ccs: "lib/ai/chat-conversation-state.ts",
  cps: "lib/ai/chat-planning-state.ts",
  pcc: "lib/ai/planning-conversation-constraints.ts",
  aat: "lib/ai/parse-add-all-to-trip-intent.ts",
  nsa: "lib/ai/numeric-selection-authority.ts",
  tdc: "lib/ai/trip-date-confirmation.ts",
  ps: "lib/planning-selection.ts",
  nlc: "lib/ai/nearby-location-clarification.ts",
  pdc: "lib/ai/place-detail-chat.ts",
  ctd: "lib/ai/chat-turn-destination.ts",
};
let runnerIds = [];
async function freshModules() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  runnerIds = [];
  const runner = new ViteNodeRunner({
    root: WORK_ROOT,
    base: "/",
    fetchModule: (id) => {
      runnerIds.push(id);
      return vn.fetchModule(id);
    },
    resolveId: (id, imp) => vn.resolveId(id, imp),
  });
  await runner.executeId("/@vite/env");
  const M = {};
  for (const [k, p] of Object.entries(MODS)) M[k] = await runner.executeFile(`${WORK_ROOT}/src/${p}`);
  return M;
}

// ════ Mock Google（逐筆計數；Places searchText／searchNearby 回示意地點）════
const ZERO = { status: "ZERO_RESULTS", results: [] };
let G = {};
const reqs = [];
let pseq = 0;
globalThis.__A2A_GOOGLE = async (input, init = {}) => {
  const url = new URL(String(input));
  const p = url.pathname;
  const kind = p.includes("/geocode/json") ? "geocode" : p.endsWith("places:autocomplete") ? "autocomplete" : /places:search(Text|Nearby)/.test(p) ? "places" : p.startsWith("/v1/places/") ? "details" : "other";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const circle = body?.locationBias?.circle ?? body?.locationRestriction?.circle;
  reqs.push({ kind, path: p, textQuery: body?.textQuery, center: circle?.center ? `${circle.center.latitude},${circle.center.longitude}` : null, radius: circle?.radius ?? null, query: url.searchParams.get("address") ?? body?.input });
  if (kind === "places") {
    const c = circle?.center ?? { latitude: 0.5, longitude: 0.5 };
    const places = [0, 1, 2, 3].map((i) => {
      pseq += 1;
      return { id: `mock-gplace-${pseq}`, displayName: { text: `示意地點${pseq}` }, formattedAddress: `示意地址${pseq}`, shortFormattedAddress: `示意地址${pseq}`, location: { latitude: c.latitude + 0.001 * (i + 1), longitude: c.longitude + 0.001 * (i + 1) }, rating: 4.5, userRatingCount: 800, types: ["restaurant", "food", "point_of_interest", "establishment"], primaryType: "restaurant", businessStatus: "OPERATIONAL" };
    });
    return Response.json({ places });
  }
  const h = G[kind];
  const r = typeof h === "function" ? h() : h;
  return Response.json(r ?? (kind === "geocode" ? ZERO : {}));
};
const countOf = (list) => ({ geocode: list.filter((r) => r.kind === "geocode").length, autocomplete: list.filter((r) => r.kind === "autocomplete").length, details: list.filter((r) => r.kind === "details").length, places: list.filter((r) => r.kind === "places").length, other: list.filter((r) => r.kind === "other").length });
const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const KYOTO = { status: "OK", results: [{ address_components: [comp("京都市", "京都市", ["locality", "political"]), comp("京都府", "京都府", ["administrative_area_level_1", "political"]), comp("日本", "JP", ["country", "political"])], formatted_address: "日本京都府京都市", geometry: { location: { lat: 35.0116, lng: 135.7681 }, location_type: "APPROXIMATE" }, place_id: "mock-pid-kyoto-city", types: ["locality", "political"] }] };

// ════ 斷言 ════
const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
const unverified = [];
const J = (v) => JSON.stringify(v);
function expect(id, cond, detail, cat) {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
}
const info = (s) => P(`  INFO ${s}`);
function UNVERIFIED(id, detail) {
  unverified.push(id);
  P(`  UNVERIFIED ${id}：${detail}`);
}
const crash = (e) => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  process.stdout.write(`${out.join("\n")}\nCRASH：${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}\nexternal=${external}\nverify-destination-trust-boundary-a2-alt-reach: FAIL\n`);
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

const CHAT_SRC = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
const PF_SRC = readFileSync(`${WORK_ROOT}/src/lib/places.functions.ts`, "utf8");
const lineOf = (idx) => CHAT_SRC.slice(0, idx).split("\n").length;

// ═══════ S. [static] Credits 位置 ═══════
P("══ S. [static] Credits 檢查 ══");
const cbStart = CHAT_SRC.indexOf("const pushAlternativeDestinationPlaceRecommendation = useCallback(");
const cbEnd = CHAT_SRC.indexOf("useCallback(", cbStart + 60);
const CB = CHAT_SRC.slice(cbStart, cbEnd);
const CREDIT_TOKENS = ["beginPlaceRecommendationCredits", "settleCreditsOperation", "ensureSubscriptionHydratedForCredits", "beginCreditsOperation", "hasPlusAccess"];
const cbCredit = CREDIT_TOKENS.filter((t) => CB.includes(t));
const cbPlaces = CB.indexOf("searchPlaces: searchNearbyPlaces");
expect("S1-callback-no-credits", cbStart > 0 && cbPlaces > 0 && cbCredit.length === 0, `pushAlternativeDestinationPlaceRecommendation（L${lineOf(cbStart)}–L${lineOf(cbEnd)}）含 searchPlaces: searchNearbyPlaces（L${lineOf(cbStart + cbPlaces)}），Credits 相關識別字=${J(cbCredit)}`, "vuln-static");
const brStart = CHAT_SRC.indexOf("if (shouldAcceptAlternativeRecommendations(msgs, trimmed)) {");
const brCall = CHAT_SRC.indexOf("await pushAlternativeDestinationPlaceRecommendation(", brStart);
const brSeg = CHAT_SRC.slice(brStart, brCall);
const brCredit = CREDIT_TOKENS.filter((t) => brSeg.includes(t));
const brGuards = ["isUnconfirmedSearchDestination", "confirmedContextDestination", "resolveCategoryTurnDestination", "validateCategoryTurnDestination", "resolveMorePlacesTurnDestination"].filter((t) => brSeg.includes(t) || CB.includes(t));
expect("S2-send-branch-no-credits-no-authority", brStart > 0 && brCall > brStart && brCredit.length === 0 && brGuards.length === 0, `send() L${lineOf(brStart)} 分支 → L${lineOf(brCall)} 呼叫之間 Credits=${J(brCredit)}；分支＋callback 內 Destination 確認=${J(brGuards)}`, "vuln-static");
const callSites = [...CHAT_SRC.matchAll(/pushAlternativeDestinationPlaceRecommendation\(/g)].map((m) => lineOf(m.index));
info(`pushAlternativeDestinationPlaceRecommendation 呼叫點（含定義以外）：L${callSites.join(",L")}`);
const spStart = PF_SRC.indexOf("export const searchPlaces = createServerFn(");
const spSeg = PF_SRC.slice(spStart, PF_SRC.indexOf("});", spStart));
expect("S3-server-searchPlaces-no-credits", spStart > 0 && !/credit/i.test(spSeg) && /middleware\(\[allowGuestPublicRead, requireGoogleProviderRate\]\)/.test(spSeg), `server searchPlaces middleware=[allowGuestPublicRead, requireGoogleProviderRate]；handler 內無 credit 字樣（Credits 僅由 Client callback 開始）`, "vuln-static");

// ═══════ R. [mirror] 使用者輸入「好」可否到達 L9288 ═══════
P("\n══ R. [mirror] noMore 之後輸入「好」→ L9288 ══");
let M = await freshModules();
const NO_MORE = M.crc.chatRuntimeCopy("noMore", "zh-TW");
const noMoreSites = [...CHAT_SRC.matchAll(/chatRuntimeCopy\("noMore", locale\)/g)].map((m) => lineOf(m.index));
info(`noMore 文案＝${J(NO_MORE)}；正式程式產生點 L${noMoreSites.join(",L")}（Refinement 用盡、more_places 用盡等正常路徑）`);
const now = new Date().toISOString();
const recExhausted = (dest) => ({ sessionId: "rec-x", destination: dest, topic: "restaurant", pool: [], cursor: 0, returnedPlaceIds: [], returnedCanonicalKeys: [], usedQueries: ["q1"], nextQueryCursor: 1, recommendationPage: 1, exhausted: true, createdAt: now, updatedAt: now });
const SESS = {
  "travelContext.destination": (L) => ({ phase: "recommend", messages: [], recommendedPlaces: [], selectedPlaces: [], activeCategoryIntent: "restaurant", activeChatIntent: "restaurant", travelContext: { interests: [], destination: L }, recommendationSession: recExhausted(L) }),
  "tripPlanningContext.destination": (L) => ({ phase: "recommend", messages: [], recommendedPlaces: [], selectedPlaces: [], tripPlanningContext: { destination: L, selectedPlaces: [] } }),
  "tripDestination.city": (L) => ({ phase: "recommend", messages: [], recommendedPlaces: [], selectedPlaces: [], tripDestination: { city: L } }),
};
const msgs = [
  { role: "user", content: "推薦餐廳" },
  { role: "assistant", content: "好的，推薦給你：" },
  { role: "user", content: "還有嗎" },
  { role: "assistant", content: NO_MORE },
];
const USER = "好";
const FORGED = "亞特蘭提斯市";
const reach = {};
for (const [src, mk] of Object.entries(SESS)) {
  for (const L of [FORGED, "京都"]) {
    const session = mk(L);
    const lastAssistantReply = NO_MORE;
    const r = await safe(() => {
      const interceptors = {
        isRepeatedTripDateConfirmation_L7658: M.tdc.isRepeatedTripDateConfirmation(session, USER),
        pendingDateConfirmation_L7661: session.pendingQuestion?.type === "date_confirmation",
        rejectNumericSelection_L7744: M.nsa.rejectNumericSelection(session, USER),
        planningSelectionContinuation_L7843: M.ps.isPlanningSelectionMode(session) && M.ps.isPlanningSelectionContinuation(USER),
        pendingNearbyLocation_L7927: Boolean(session.pendingNearbyLocationRequest),
        refresh_L8238: /^(重新整理推薦|重新整理)$/.test(USER),
        regen_L8326: /^(重新生成|再生成一次|再試一次|重試)$/.test(USER),
        placeDetailActive_L8430: M.pdc.isPlaceDetailChatActive(session),
        explicitNearby_L8206: Boolean(M.nlc.resolveExplicitNearbyIntent(USER)),
      };
      let next = M.ccs.prepareSessionForUserTurn(session, lastAssistantReply);
      const merged = M.tc.mergeTravelContext(next, USER, lastAssistantReply);
      next = merged.session;
      interceptors.destinationCandidatePending_L8895 = merged.context.destinationCandidate?.status === "pending";
      interceptors.destinationClarification_L8907 = Boolean(merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved"));
      const planningMerge = M.tpc.mergeTripPlanningContext(USER, next, merged.context);
      next = planningMerge.session;
      const delta = M.pcc.parsePlanningConstraintDelta({ text: USER, shownCandidates: [], authoritativeDestination: next.travelContext?.destination ?? merged.context.destination, activePlace: undefined, onStage: () => {} });
      const req = M.pcc.resolvePlanningContextRequirement({ text: USER, delta, candidateCount: 0, destinationDetected: Boolean(merged.context.destination), durationOrDateDetected: false });
      interceptors.unresolvedCandidateContext_L9127 = Boolean(req.requiresCandidateContext);
      interceptors.styleReselect_L9161 = Boolean(M.cps.isStyleReselectTurn(USER, next, merged.context));
      interceptors.stylePlan_L9189 = Boolean(M.cps.shouldTriggerTripStylePlanning(USER, next, merged.context) && (next.pendingQuestion?.type === "ask_trip_style" || next.chatPlanningState === "waitingStyleSelection"));
      interceptors.addAll_L9205 = M.aat.isAddAllToTripIntent(USER) || delta?.acceptRemainingCandidates === true;
      const accept = M.crr.shouldAcceptAlternativeRecommendations(msgs, USER);
      const altCtx = { ...(next.travelContext ?? merged.context), tripPurpose: "alternative_recommendations", setting: "混合" };
      const dest = altCtx.destination?.trim() ?? next.tripPlanningContext?.destination?.trim() ?? next.tripDestination?.city?.trim();
      return { interceptors, accept, dest, pending: next.pendingQuestion?.type ?? null, next: { ...next, travelContext: { ...altCtx, destination: dest } } };
    });
    const key = `${src}=${L}`;
    if (r.e) {
      expect(`R-${key}-mirror`, false, `鏡像執行失敗：${r.e}`, "base");
      continue;
    }
    const hit = Object.entries(r.v.interceptors).filter(([, v]) => v).map(([k]) => k);
    reach[key] = { ...r.v, hit };
    P(`  [mirror] ${key}：攔截分支=${J(hit)} pendingQuestion(prepare 後)=${J(r.v.pending)} shouldAccept=${r.v.accept} dest(L9300-9303)=${J(r.v.dest ?? null)}`);
  }
}
const reachable = (k) => reach[k] && reach[k].hit.length === 0 && reach[k].accept && reach[k].dest;
expect("R1-forged-travelContext-reaches-alt", reachable(`travelContext.destination=${FORGED}`) && reach[`travelContext.destination=${FORGED}`].dest.startsWith("亞特蘭提斯"), `noMore 後輸入「好」：L9288 前無分支攔截，shouldAccept=true，dest＝偽造 travelContext.destination`, "vuln");
info(`偽造 tripPlanningContext.destination 可達=${Boolean(reachable(`tripPlanningContext.destination=${FORGED}`))} dest=${J(reach[`tripPlanningContext.destination=${FORGED}`]?.dest ?? null)}；偽造 tripDestination.city 可達=${Boolean(reachable(`tripDestination.city=${FORGED}`))} dest=${J(reach[`tripDestination.city=${FORGED}`]?.dest ?? null)}（mergeTravelContext 可能改寫 travelContext.destination，以實測為準）`);
expect("R2-base-kyoto-reaches-alt", reachable("travelContext.destination=京都"), "正常京都 Session：同一路徑可達（基準）", "base");
const accNeg = M.crr.shouldAcceptAlternativeRecommendations([{ role: "assistant", content: "好的，推薦給你：" }], USER);
expect("R3-base-requires-noMore-offer", accNeg === false, `上一則 assistant 非 noMore 時 shouldAccept=${accNeg}（入口需要 noMore 提示；msgs 本身為 Client 保存的歷史）`, "base");
UNVERIFIED("R-send-body", "React send() 本體未執行；L9288 前的攔截以真實純函式鏡像評估（resolveTripAddPlaceChatSession 需 localStorage 的 trip-add 模式，正常 Chat 不成立，未評估）");

// ═══════ X. [rt] callback 內 Builder → 真實 searchPlaces server handler → Mock Google ═══════
P("\n══ X. [rt] buildAlternativeDestinationRecommendations（callback L6460-6475 參數鏡像）══");
const XT = [];
for (const [key, geo] of [[`travelContext.destination=${FORGED}`, { geocode: ZERO, autocomplete: { suggestions: [] } }], [`tripDestination.city=${FORGED}`, { geocode: ZERO, autocomplete: { suggestions: [] } }], ["travelContext.destination=京都", { geocode: KYOTO }]]) {
  const rv = reach[key];
  if (!rv?.dest) {
    info(`X ${key}：未可達，略過`);
    continue;
  }
  M = await freshModules();
  G = geo;
  globalThis.__A2A_SERVERFN = 0;
  const r0 = reqs.length;
  const ext0 = external;
  let weather = 0;
  const searchNearbyPlaces = M.psu.createUnifiedSearchPlacesFn(M.pf.searchPlaces);
  const geocodeFn = (args) => M.lf.geocodeTripLocationFromText(args);
  const activeSession = rv.next;
  const merged = M.tc.mergeTravelContext(activeSession, USER);
  const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, activeSession);
  const label = rv.dest.trim();
  const built = await safe(() => M.dpr.buildAlternativeDestinationRecommendations({ destination: label, userText: USER, context: { ...placeCtx, destination: label, tripPurpose: "alternative_recommendations" }, locale: "zh-TW", searchPlaces: searchNearbyPlaces, geocodeFn, fetchWeatherFn: async () => { weather += 1; return null; }, excludePlaceIds: M.crr.collectExcludePlaceIds(activeSession), rejectedPlaceNames: activeSession.rejectedPlaceNames }));
  const list = reqs.slice(r0);
  const c = countOf(list);
  const creditsLoaded = runnerIds.filter((id) => /\/lib\/credits\//.test(id));
  const row = { key, label, c, serverFn: globalThis.__A2A_SERVERFN, weather, recs: built.v?.recommendations?.length ?? 0, err: built.e, centers: [...new Set(list.filter((x) => x.kind === "places").map((x) => `${x.center ?? "none"} r=${x.radius ?? "-"}`))].slice(0, 4), q: list.filter((x) => x.kind === "places").slice(0, 3).map((x) => x.textQuery), creditsLoaded, ext: external - ext0, contextDest: built.v?.contextPatch?.destination ?? null };
  XT.push(row);
  P(`  [rt] ${key}：label=${J(label)} Google geocode=${c.geocode} autocomplete=${c.autocomplete} details=${c.details} Places=${c.places}${c.other ? ` other=${c.other}` : ""} serverFn=${row.serverFn} weather=${weather} recs=${row.recs} centers=${J(row.centers)} q=${J(row.q)} credits 模組載入=${J(creditsLoaded)} external=${row.ext}${row.err ? ` err=${row.err}` : ""}`);
}
const xf = XT.find((r) => r.key === `travelContext.destination=${FORGED}`);
const xk = XT.find((r) => r.key === "travelContext.destination=京都");
if (xf) expect("X1-forged-label-google-places-without-credits", xf.c.places > 0 && xf.creditsLoaded.length === 0 && xf.ext === 0, `偽造「${xf.label}」→ Google Places 請求 ${xf.c.places} 次（geocode ${xf.c.geocode}）；Credits 模組未載入；recs=${xf.recs}`, "vuln");
else UNVERIFIED("X1-forged", "偽造標籤未可達");
if (xk) expect("X2-kyoto-google-places-without-credits", xk.c.places > 0 && xk.creditsLoaded.length === 0, `正常京都 → Google Places ${xk.c.places} 次、recs=${xk.recs}；整條鏈無 Credits（正常使用者也不扣點）`, "vuln");
UNVERIFIED("X-callback-body", "useCallback 本體（setStreaming／setMsgs／persistSession）未執行；callback 在 Builder 之前沒有任何 await 或 Credits 呼叫（[static] S1）");

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const vulnRows = rows.filter((r) => r.cat.startsWith("vuln"));
const hardFail = rows.filter((r) => !r.ok && !r.cat.startsWith("vuln"));
P(`\n[vuln] 重現成立=${vulnRows.filter((r) => r.ok).length}/${vulnRows.length}；[base] PASS=${rows.filter((r) => r.ok && !r.cat.startsWith("vuln")).length} FAIL=${hardFail.length}${hardFail.length ? `（${hardFail.map((r) => r.id).join(",")}）` : ""}；UNVERIFIED=${unverified.length}`);
P(`external=${external}${external ? ` ${extLog.slice(0, 5).join(";")}` : ""}`);
const fail = external > 0 || hardFail.length > 0;
P(`verify-destination-trust-boundary-a2-alt-reach: ${fail ? "FAIL" : "DONE"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fail ? 1 : 0);
