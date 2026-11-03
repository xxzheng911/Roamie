#!/usr/bin/env node
/**
 * T28 — Phase 2 Recovery 第一組驗收（澄清迴圈／父城市範圍確認／循環 import）。
 * 以 T27 harness（scripts/verify-destination-authority-phase2.mjs，保留不改）為基礎，依 work 目前的
 * _app.chat.tsx 重建 send 主流程中與目的地相關的部分；T27 原有 assertion 全部保留（T27 的 52 個情境逐條沿用）。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-authority-phase2-r2.mjs --config scripts/vite.verify.config.mjs
 *
 * 安全（每個子程序都套用）：
 *  - 子程序以 process.execPath 直接執行本檔（不是 vite-node CLI；vite-node CLI 會把 .env 讀進 process.env），
 *    以程式方式建立 Vite server：configFile:false、envDir:false → 不讀任何 .env。
 *  - 子程序 env 由 main 以白名單重建（PATH/HOME/TMPDIR/LANG…），並強制設定 Mock Key：
 *    GOOGLE_MAPS_API_KEY / VITE_GOOGLE_MAPS_API_KEY / EXPO_PUBLIC_GOOGLE_MAPS_API_KEY / OPENWEATHER… = "mock-key"。
 *  - 攔截 globalThis.fetch、node:http / node:https 的 request / get、node:net / node:tls connect、
 *    undici（可載入時：request / fetch / stream / pipeline / connect / upgrade + global dispatcher）。
 *    任何外部請求 → 計數並判 FAIL。
 *  - geocode / weather / Places（searchPlaces spy，真實 builder）/ Credits 全部 mock + 計數。
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DEFAULT_BASE_ROOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const ROLE = process.env.VERIFY_P2R2_ROLE ?? "main";
const BASE_ROOT = process.env.VERIFY_P2R2_BASE_ROOT || DEFAULT_BASE_ROOT;
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r2.mjs`;
const LOCALE = "zh-TW";
const MOCK_ENV = {
  GOOGLE_MAPS_API_KEY: "mock-key",
  VITE_GOOGLE_MAPS_API_KEY: "mock-key",
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: "mock-key",
  OPENWEATHER_API_KEY: "mock-key",
  EXPO_PUBLIC_OPENWEATHER_API_KEY: "mock-key",
  OPENAI_API_KEY: "mock-key",
  VITE_SUPABASE_URL: "http://mock-supabase.invalid",
  VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key",
  SUPABASE_URL: "http://mock-supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "mock-key",
};
const SECRET_RE = /KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER|APPLE|CAPACITOR|ROAMIE_ADMIN/i;

// ════════════════════════ provider mock（兩樹共用；依 query 決定回應；與 T27 相同）════════════════════════
const LOC = (o) => ({
  placeId: `mock-${o.formattedName ?? o.city ?? o.region}`,
  country: o.country ?? "日本",
  city: o.city ?? "",
  region: o.region,
  district: o.district,
  sublocality: o.sublocality,
  lat: o.lat ?? 35,
  lng: o.lng ?? 135,
  formattedName: o.formattedName ?? o.city ?? o.region,
  displayLabel: o.formattedName ?? o.city ?? o.region,
  address: o.address,
});
const REAL = {
  香港跑馬地: LOC({ country: "香港", city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "跑馬地", lat: 22.27, lng: 114.18 }),
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  埔里: LOC({ country: "台灣", city: "埔里鎮", region: "南投縣", district: "埔里鎮", formattedName: "南投縣埔里鎮", lat: 23.96, lng: 120.96 }),
  南投埔里: LOC({ country: "台灣", city: "埔里鎮", region: "南投縣", district: "埔里鎮", formattedName: "南投縣埔里鎮", lat: 23.96, lng: 120.96 }),
  金澤看兼六園: LOC({ city: "金澤市", region: "石川縣", sublocality: "兼六町", formattedName: "兼六園", lat: 36.56, lng: 136.66 }),
  台南看西街教會: LOC({ country: "台灣", city: "台南市", region: "台南市", district: "中西區", formattedName: "西街教會", lat: 22.99, lng: 120.2 }),
  新竹潛園: LOC({ country: "台灣", city: "新竹市", region: "新竹市", district: "北區", formattedName: "潛園", lat: 24.8, lng: 120.97 }),
  台北士林夜: LOC({ country: "台灣", city: "台北市", region: "台北市", district: "士林區", formattedName: "士林夜市", lat: 25.09, lng: 121.52 }),
  東京玩具美術館: LOC({ city: "東京", region: "東京都", district: "新宿區", sublocality: "四谷", formattedName: "東京玩具美術館", lat: 35.69, lng: 139.72 }),
  千葉釣崎海岸: LOC({ city: "一宮町", region: "千葉縣", formattedName: "釣崎海岸", lat: 35.37, lng: 140.39 }),
  千葉: LOC({ city: "千葉市", region: "千葉縣", formattedName: "千葉市", lat: 35.6, lng: 140.1 }),
  奈良看鹿: LOC({ city: "奈良市", region: "奈良縣", formattedName: "奈良公園", lat: 34.68, lng: 135.84 }),
  北海道滑雪: LOC({ city: "", region: "北海道", formattedName: "北海道", lat: 43.06, lng: 141.35 }),
  沖繩潛水: LOC({ city: "", region: "沖繩縣", formattedName: "沖繩縣", lat: 26.21, lng: 127.68 }),
  花蓮泛舟: LOC({ country: "台灣", city: "", region: "花蓮縣", formattedName: "花蓮縣", lat: 23.98, lng: 121.6 }),
  里斯本: LOC({ country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 }),
  波爾圖: LOC({ country: "葡萄牙", city: "波爾圖", region: "波爾圖", formattedName: "波爾圖", lat: 41.15, lng: -8.61 }),
};
const PARENTS = ["北海道", "沖繩", "京都", "大阪", "東京", "奈良", "金澤", "花蓮", "香港", "台南", "新竹", "千葉", "台北", "台中", "南投", "里斯本", "埔里"];
function realisticLocation(rawQuery) {
  const q = String(rawQuery).split(",")[0].trim();
  if (REAL[q]) return REAL[q];
  const parent = PARENTS.filter((p) => q.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  const label = parent ?? q;
  return LOC({ country: /台|花蓮|新竹|南投|埔里/.test(label) ? "台灣" : label === "香港" ? "香港" : "日本", city: label, region: label, formattedName: label });
}

// ════════════════════════ collect（子程序）════════════════════════
if (ROLE === "collect") {
  // ── 0. env：清掉任何看起來像金鑰的變數，強制 Mock Key ──
  const envScrubbed = [];
  for (const k of Object.keys(process.env)) {
    if (SECRET_RE.test(k) && !(k in MOCK_ENV)) {
      envScrubbed.push(k);
      delete process.env[k];
    }
  }
  Object.assign(process.env, MOCK_ENV);

  // ── 1. 外部請求攔截 ──
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  const ext = { fetch: 0, http: 0, https: 0, net: 0, tls: 0, undici: 0 };
  const extLog = [];
  const describe = (a) => {
    try {
      if (typeof a === "string") return a;
      if (a instanceof URL) return a.href;
      if (a && typeof a === "object") return a.url ?? a.href ?? `${a.protocol ?? ""}//${a.hostname ?? a.host ?? ""}${a.path ?? ""}${a.port ? `:${a.port}` : ""}`;
    } catch {
      /* ignore */
    }
    return String(a);
  };
  const trap = (kind, detail) => {
    ext[kind] += 1;
    extLog.push(`${kind}:${String(detail).slice(0, 160)}`);
    const e = new Error(`[ext-trap] ${kind} blocked: ${String(detail).slice(0, 120)}`);
    e.code = "EXT_TRAP";
    throw e;
  };
  globalThis.fetch = async (input) => trap("fetch", describe(input));
  const http = require("node:http");
  const https = require("node:https");
  http.request = (...a) => trap("http", describe(a[0]));
  http.get = (...a) => trap("http", describe(a[0]));
  https.request = (...a) => trap("https", describe(a[0]));
  https.get = (...a) => trap("https", describe(a[0]));
  const net = require("node:net");
  const tls = require("node:tls");
  net.connect = (...a) => trap("net", describe(a[0]));
  net.createConnection = (...a) => trap("net", describe(a[0]));
  tls.connect = (...a) => trap("tls", describe(a[0]));
  let undiciLoaded = false;
  try {
    const undici = require("undici");
    undiciLoaded = true;
    for (const fn of ["request", "fetch", "stream", "pipeline", "connect", "upgrade"]) {
      if (typeof undici[fn] === "function") undici[fn] = (...a) => trap("undici", `${fn}:${describe(a[0])}`);
    }
    if (typeof undici.Dispatcher === "function" && typeof undici.setGlobalDispatcher === "function") {
      class TrapDispatcher extends undici.Dispatcher {
        dispatch(opts) {
          return trap("undici", `dispatch:${opts?.origin ?? ""}${opts?.path ?? ""}`);
        }
      }
      undici.setGlobalDispatcher(new TrapDispatcher());
    }
  } catch {
    undiciLoaded = false;
  }

  const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug, error: console.error };
  for (const k of Object.keys(orig)) console[k] = () => {};

  const ROOT = process.env.VERIFY_ROOT;
  const GEO_MODE = process.env.VERIFY_P2_GEO ?? "ok";
  const SEARCH_MODE = process.env.VERIFY_P2_SEARCH ?? "ok";
  const SCENARIO = JSON.parse(process.env.VERIFY_P2_SCENARIO ?? "{}");

  // ── 2. Vite（不讀 .env）＋ vite-node runner ──
  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
  const server = await createServer({
    root: ROOT,
    configFile: false,
    envDir: false,
    logLevel: "silent",
    clearScreen: false,
    plugins: [tsconfigPaths()],
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.environments.client.pluginContainer.buildStart({});
  const vnServer = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule: (id) => vnServer.fetchModule(id),
    resolveId: (id, importer) => vnServer.resolveId(id, importer),
  });
  await runner.executeId("/@vite/env");
  const { existsSync } = await import("node:fs");
  const imp = (p) => runner.executeFile(`${ROOT}/src/${p}`);
  const IS_WORK = existsSync(`${ROOT}/src/lib/ai/chat-turn-destination.ts`);
  const M = {
    tc: await imp("lib/ai/travel-context.ts"),
    gpc: await imp("lib/ai/global-planning-context.ts"),
    tpc: await imp("lib/ai/trip-planning-context.ts"),
    mvp: await imp("lib/ai/must-visit-places.ts"),
    weather: await imp("lib/ai/destination-weather-prefetch.ts"),
    geo: await imp("lib/ai/destination-geocode.ts"),
    placeIntent: await imp("lib/ai/chat-place-intent.ts"),
    catDest: await imp("lib/ai/chat-category-destination.ts"),
    dtp: await imp("lib/ai/destination-travel-profile.ts"),
    chatIntent: await imp("lib/ai/chat-intent.ts"),
    nearbyClar: await imp("lib/ai/nearby-location-clarification.ts"),
    convState: await imp("lib/ai/chat-conversation-state.ts"),
    chatSession: await imp("lib/chat-session.ts"),
    planFlow: await imp("lib/chat-planning-flow.ts"),
    tripIntent: await imp("lib/recommendation/trip-intent.ts"),
    dining: await imp("lib/ai/chat-dining-flow.ts"),
    refine: await imp("lib/ai/recommendation-refinement/index.ts"),
    cca: await imp("lib/ai/chat-create-authority.ts"),
    gph: await imp("lib/ai/generated-plan-handoff.ts"),
    geoClar: await imp("lib/ai/destination-geographic-clarification.ts"),
    fbScope: await imp("lib/ai/destination-recommendation-fallback-scope.ts"),
    aps: await imp("lib/ai/ai-planning-session.ts"),
    cps: await imp("lib/ai/chat-planning-state.ts"),
    tripStyle: await imp("lib/ai/ai-trip-style.ts"),
    numSel: await imp("lib/ai/numeric-selection-authority.ts"),
    refresh: await imp("lib/ai/chat-recommendation-refresh.ts"),
    addAll: await imp("lib/ai/parse-add-all-to-trip-intent.ts"),
    budget: await imp("lib/ai/budget-refinement.ts"),
    pcc: await imp("lib/ai/planning-conversation-constraints.ts"),
    crs: await imp("lib/ai/conversation-recommendation-session.ts"),
    ppm: await imp("lib/place-planning-memory.ts"),
    rds: await imp("lib/ai/resolved-destination-scope.ts"),
    copy: await imp("lib/chat-runtime-copy.ts"),
    builder: await imp("lib/ai/chat-destination-category-recommendation.ts"),
    ctd: IS_WORK ? await imp("lib/ai/chat-turn-destination.ts") : null,
  };
  const copyOf = (key, vars) => M.copy.chatRuntimeCopy(key, LOCALE, vars);

  // ── provider spies ──
  let phase = "init";
  const geocodes = [];
  const weatherCalls = [];
  const builderCalls = [];
  const placesReqs = [];
  const creditsBegin = [];
  const creditsSettle = [];
  const geocodeFn = async (req) => {
    const q = String(req?.data?.query ?? req?.data?.destinationName ?? "");
    geocodes.push({ phase, q });
    if (GEO_MODE === "timeout") {
      await new Promise((r) => setTimeout(r, 3));
      throw new Error("provider timeout");
    }
    if (GEO_MODE === "null") return null;
    if (GEO_MODE === "zero") {
      return { location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_zero_results", query: q } };
    }
    if (GEO_MODE === "neterr") {
      return { location: null, error: "geocode_network_error", providerResult: { ok: false, status: "geocode_network_error", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_network_error", query: q } };
    }
    const location = realisticLocation(q);
    return { location, error: null, providerResult: { ok: true, status: "OK", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, latitude: location.lat, longitude: location.lng, query: q } };
  };
  const fetchWeather = async (req) => {
    weatherCalls.push({ phase, data: req?.data ?? null });
    return null;
  };
  const mockPlace = (data, i) => ({
    id: `mock-pid-${data.destinationName ?? "x"}-${data.query}-${i}`,
    googlePlaceId: `mock-pid-${data.destinationName ?? "x"}-${data.query}-${i}`,
    name: `${data.destinationName ?? ""}地點${i}`,
    address: `${data.destinationName ?? ""}某路${i}號`,
    lat: (data.lat || 35) + i / 1000,
    lng: (data.lng || 135) + i / 1000,
    rating: 4.4,
    userRatingCount: 500,
    photoName: null,
    primaryType: data.intentCategory === "restaurant" ? "restaurant" : data.intentCategory === "cafe" ? "cafe" : "tourist_attraction",
    types: [data.intentCategory === "restaurant" ? "restaurant" : data.intentCategory === "cafe" ? "cafe" : "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  });
  // Places：searchPlaces spy（記錄每一個送往 Places 的 query）
  const searchPlaces = async ({ data }) => {
    placesReqs.push({ phase, q: String(data?.query ?? ""), dest: data?.destinationName ?? null, city: data?.cacheCity ?? null, mode: data?.mode ?? null });
    if (SEARCH_MODE !== "ok") return { places: [], error: null, rawCount: 0 };
    const places = [1, 2, 3, 4, 5, 6].map((i) => mockPlace(data ?? {}, i));
    return { places, error: null, rawCount: places.length };
  };
  // 真實 builder（兩樹的 chat-destination-category-recommendation.ts 相同）只用來觀察 geocode / Places query；
  // 本輪推薦結果沿用 T27 的確定性結果（SEARCH_MODE 決定有無），讓流程與 T27 一致。
  const buildDestinationCategoryRecommendationsSpy = async ({ destination, intents, userText, context, session }) => {
    builderCalls.push({ destination, intents, userText, ctxDestination: context?.destination ?? null });
    const prev = phase;
    phase = "builder";
    let builderError = null;
    try {
      await M.builder.buildDestinationCategoryRecommendations({
        destination,
        intents,
        userText,
        context,
        locale: LOCALE,
        searchPlaces,
        geocodeFn,
        excludePlaceIds: [],
        rejectedPlaceNames: [],
        session,
        userProfile: null,
      });
    } catch (e) {
      builderError = String(e?.message ?? e).slice(0, 160);
    }
    phase = prev;
    const recommendations =
      SEARCH_MODE === "ok"
        ? [1, 2, 3, 4].map((i) => ({
            name: `${destination}-地點${i}`,
            placeName: `${destination}-地點${i}`,
            placeId: `pid-${destination}-${i}`,
            googlePlaceId: `pid-${destination}-${i}`,
            lat: 35 + i / 100,
            lng: 135 + i / 100,
            rating: 4.5,
            reason: "mock",
            category: intents?.[0] ?? "attraction",
          }))
        : [];
    return { summary: "mock", recommendations, payload: { title: "t", summary: "mock", recommendations, itinerary: [] }, contextPatch: {}, searchCentroid: undefined, usedQueries: [], builderError };
  };
  const beginPlaceRecommendationCredits = async ({ metadata }) => {
    creditsBegin.push({ destination: metadata?.destination ?? null, path: metadata?.path ?? null });
    return { blocked: false, handle: { id: creditsBegin.length } };
  };
  const settleCreditsOperation = async (handle, delivered) => {
    if (handle) creditsSettle.push(Boolean(delivered));
  };

  const safe = (fn, fallback = null) => {
    try {
      const v = fn();
      return v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  };
  const baseSession = () => ({
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  function newTurnObs(text) {
    return {
      text,
      path: "",
      route: null,
      dcCalled: false,
      dispatchDest: null,
      turnResolution: null,
      searchDest: null,
      weatherDest: null,
      creditsDest: null,
      clarified: false,
      clarificationLabel: null,
      copyKind: null,
      copy: null,
      answerKind: null,
      noResultsLabel: null,
      continuationDest: null,
      sessionDest: null,
      sessionRecDest: null,
      sessionPendingLabel: null,
      sessionPendingKind: null,
      sessionPendingParent: null,
      sessionPendingOriginal: null,
      pendingBefore: null,
      activityPreference: null,
      builderUserText: null,
      builderIntent: null,
      builderError: null,
      geocodes: [],
      placesQueries: [],
      weatherCalls: 0,
      builderCalls: 0,
      placesRequests: 0,
      creditsBegin: 0,
      creditsSettle: [],
      error: null,
    };
  }

  let persisted = baseSession();
  let msgs = [];
  if (process.env.VERIFY_P2_INIT) {
    const init = JSON.parse(process.env.VERIFY_P2_INIT);
    persisted = init.persisted;
    msgs = init.msgs;
  }
  const TURN_OFFSET = Number(process.env.VERIFY_P2_TURN_OFFSET ?? 0);
  function persistSession(s, nextMsgs) {
    persisted = s;
    if (nextMsgs) msgs = nextMsgs;
  }

  // ── pushDestinationCategoryPlaceRecommendation（work 5632-6130 / base 5626-6073）──
  async function pushDC(obs, activeSession, userText, conversation, opts) {
    obs.dcCalled = true;
    if (M.chatIntent.userExplicitlyWantsNearbyPlaces(userText)) return false; // w5648 / b5635
    const merged = M.tc.mergeTravelContext(activeSession, userText); // w5649 / b5636
    const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, activeSession); // w5650 / b5637
    const intents = M.placeIntent.parseChatPlaceIntents(userText); // w5665 / b5652
    if (!intents.length) {
      obs.path += "|dc_no_intents";
      return false;
    }
    let destination;
    let persistedAreaScope;
    phase = "dc_validate";
    if (IS_WORK) {
      // w5669-5678
      const turnDestination = await M.ctd.validateCategoryTurnDestination(
        opts?.turnDestination ??
          M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText, locale: LOCALE }),
        { locale: LOCALE, geocodeFn },
      );
      obs.turnResolution = `${turnDestination.confidence}/${turnDestination.source}${turnDestination.providerValidation ? `/${turnDestination.providerValidation}` : ""}`;
      // w5681
      const clarificationPlan = M.ctd.planCategoryTurnClarification(turnDestination);
      // w5683-5690：回答輪不再開新澄清
      if (clarificationPlan && opts?.fromClarification) {
        phase = "post";
        obs.path += "|dc_clarification_already_asked";
        return false;
      }
      if (clarificationPlan) {
        // w5691-5750
        const clarificationLabel =
          clarificationPlan.kind === "parent_city_scope" ? clarificationPlan.confirmedParentCity : clarificationPlan.clarificationLabel;
        const copyKind = clarificationPlan.kind === "parent_city_scope" ? "parentScopeConfirm" : "whichRegion";
        const copy = copyOf(copyKind, { destination: clarificationLabel });
        obs.clarified = true;
        obs.clarificationLabel = clarificationLabel;
        obs.copyKind = copyKind;
        obs.copy = copy;
        const clarificationMsgs = [...conversation, { role: "assistant", content: copy }];
        const sessionDestinationForClarification = M.ctd.confirmedContextDestination(
          activeSession.travelContext ?? { interests: [] },
          activeSession,
        )?.destination;
        persistSession(
          {
            ...merged.session,
            travelContext: merged.session.travelContext
              ? { ...merged.session.travelContext, destination: sessionDestinationForClarification }
              : merged.session.travelContext,
            pendingClarification:
              clarificationPlan.kind === "parent_city_scope"
                ? M.geoClar.buildPendingParentScopeClarification({
                    confirmedParentCity: clarificationPlan.confirmedParentCity,
                    rawGeographicLabel: turnDestination.rawLabel ?? clarificationLabel,
                    categoryIntent: intents[0],
                    originalUserText: userText,
                  })
                : M.geoClar.buildPendingGeographicClarification({
                    rawGeographicLabel: clarificationLabel,
                    categoryIntent: intents[0],
                    originalUserText: userText,
                  }),
            activeCategoryIntent: intents[0],
            pendingQuestion: undefined,
            lastAssistantReply: copy,
          },
          clarificationMsgs,
        );
        phase = "post";
        return true;
      }
      destination = turnDestination.destination; // w5752
      if (!destination) {
        phase = "post";
        obs.path += "|dc_no_destination";
        return false;
      }
      persistedAreaScope = turnDestination.geographicScope?.searchScope === "area" ? turnDestination.geographicScope : null; // w5754-5757
    } else {
      // b5654-5702
      const provisionalArea = M.dtp.extractProvisionalDestinationAreaCandidate(userText);
      const validatedAreaScope = await M.dtp.resolveValidatedDestinationAreaScope({ input: userText, locale: LOCALE, geocodeFn });
      if (provisionalArea && !validatedAreaScope) {
        const copy = copyOf("whichRegion", { destination: provisionalArea.areaCandidate });
        obs.clarified = true;
        obs.clarificationLabel = provisionalArea.areaCandidate;
        obs.copyKind = "whichRegion";
        obs.copy = copy;
        const clarificationMsgs = [...conversation, { role: "assistant", content: copy }];
        persistSession(
          {
            ...merged.session,
            pendingClarification: M.geoClar.buildPendingGeographicClarification({
              rawGeographicLabel: provisionalArea.areaCandidate,
              categoryIntent: intents[0],
              originalUserText: userText,
            }),
            activeCategoryIntent: intents[0],
            pendingQuestion: undefined,
            lastAssistantReply: copy,
          },
          clarificationMsgs,
        );
        phase = "post";
        return true;
      }
      const baseDestination = M.catDest.resolveDestinationForCategorySearch(placeCtx, merged.session, userText);
      if (!baseDestination && !validatedAreaScope) {
        phase = "post";
        obs.path += "|dc_no_destination";
        return false;
      }
      destination = validatedAreaScope?.displayLabel ?? baseDestination;
      persistedAreaScope =
        validatedAreaScope ??
        (destination ? M.dtp.resolveDestinationAreaScope(destination) : null) ??
        M.dtp.resolveDestinationAreaScope(userText);
    }
    phase = "post";
    // w5763-5766 / b5707-5719
    const gate = await beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "destination_category", destination, intents } });
    obs.creditsDest = destination;
    let handle = gate.handle;
    try {
      // w5778-5793 / b5723-5738
      obs.searchDest = destination;
      obs.builderUserText = userText;
      obs.builderIntent = intents[0] ?? null;
      const { recommendations, contextPatch, builderError } = await buildDestinationCategoryRecommendationsSpy({
        destination,
        intents,
        userText,
        context: { ...placeCtx, destination },
        session: activeSession,
      });
      if (builderError) obs.builderError = builderError;
      if (!recommendations.length) {
        await settleCreditsOperation(handle, false); // w5796
        handle = null;
        return false;
      }
      const categoryIntent = intents[0];
      const displayBatchSize = M.crs.DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE ?? 3;
      const { session: recSession, batch } = M.crs.createRecommendationSession({
        destination,
        topic: categoryIntent,
        pool: recommendations,
        batchSize: displayBatchSize,
        usedQueries: [],
        recommendationPage: 0,
        parentCity: persistedAreaScope?.parentCity,
        area: persistedAreaScope?.area,
        searchScope: persistedAreaScope ? "area" : "city",
        searchRegionLabel: destination,
      });
      const activeRecContext = M.refine.ensureActiveRecommendationContext(
        { ...merged.session, recommendationSession: recSession, activeCategoryIntent: categoryIntent },
        {
          destination,
          intent: categoryIntent,
          places: batch.length ? batch : recommendations.slice(0, displayBatchSize),
          usedQueries: recSession.usedQueries,
          resolvedSearchCity: persistedAreaScope?.parentCity ?? destination,
          parentCity: persistedAreaScope?.parentCity,
          area: persistedAreaScope?.area,
          searchScope: persistedAreaScope ? "area" : "city",
        },
      );
      const sessionWithRecs = {
        ...merged.session,
        activeCategoryIntent: categoryIntent,
        recommendationSession: recSession,
        activeRecommendationContext: activeRecContext,
        conversationMode: "destination_planning",
        phase: "recommend",
        pendingClarification: undefined,
        pendingQuestion: undefined,
        tripPlanningContext: activeSession.tripPlanningContext
          ? { ...activeSession.tripPlanningContext, destination, intent: "destination_planning" }
          : { selectedPlaces: [], destination, intent: "destination_planning" },
        tripDays: activeSession.tripDays,
        travelContext: { ...placeCtx, ...contextPatch, destination, tripPurpose: "recommend_places" },
      };
      const recs = batch.length ? batch : recommendations.slice(0, displayBatchSize);
      const nextMsgs = [...conversation, { role: "assistant", content: `${destination}推薦`, roamie: { summary: "mock", recommendations: recs } }];
      persistSession(
        safe(() => M.ppm.syncSessionPlaceMemory({ ...sessionWithRecs, recommendedPlaces: recs, pendingClarification: undefined }), {
          ...sessionWithRecs,
          recommendedPlaces: recs,
        }),
        nextMsgs,
      );
      await settleCreditsOperation(handle, true);
      handle = null;
      return true;
    } catch (error) {
      await settleCreditsOperation(handle, false);
      obs.error = `dc_throw:${error?.message ?? error}`;
      return false;
    }
  }

  // ── send（work 7572- / base 7517-）──
  async function send(obs, text) {
    const trimmed = text.trim();
    let session = persisted;
    if (M.gph.isExplicitTripCreationTurn(trimmed) || M.chatSession.isUserConfirmingItinerary(trimmed)) {
      session = M.gph.beginTripCreation(session, M.chatSession.isUserConfirmingItinerary(trimmed) ? "confirmed_create" : "direct_itinerary_create"); // w7667-7670
    }
    if (M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed)) {
      obs.path = "explicit_nearby(未重建)";
      return;
    }
    let nextSession = M.tripIntent.applyTripIntentToSession(trimmed, session);
    nextSession = M.chatIntent.applyQuickChipContext(trimmed, nextSession);
    nextSession = M.dining.applyDiningContextFromText(trimmed, nextSession);
    const createArbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession); // w8601
    obs.route = createArbitration.route;
    nextSession = M.cca.applyChatCreateAuthority(nextSession, createArbitration, /(?:預覽|预览|preview|プレビュー|미리보기)/i.test(trimmed));
    const lastAssistantReply = [...msgs].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content;
    nextSession = M.convState.prepareSessionForUserTurn(nextSession, lastAssistantReply); // w8621

    const pendingGeographic = nextSession.pendingClarification; // w8624
    obs.pendingBefore = pendingGeographic ? `${pendingGeographic.kind}:${pendingGeographic.confirmedParentCity ?? ""}:${pendingGeographic.rawGeographicLabel}` : null;
    if (IS_WORK) {
      // w8628-8683：父城市範圍確認
      if (pendingGeographic?.kind === "parent_city_scope") {
        nextSession = { ...nextSession, pendingClarification: undefined }; // w8630
        const confirmedParentCity = pendingGeographic.confirmedParentCity?.trim();
        const answer = M.geoClar.parseParentScopeConfirmationAnswer(trimmed);
        obs.answerKind = answer;
        if (confirmedParentCity && !M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed) && answer === "confirm") {
          const next = [...msgs, { role: "user", content: trimmed }];
          obs.path = `parent_scope_confirm(${confirmedParentCity})`;
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, activeCategoryIntent: pendingGeographic.categoryIntent },
            { destination: confirmedParentCity, parentCity: confirmedParentCity, area: confirmedParentCity, searchScope: "city" },
          ); // w8640-8648
          persistSession(sessionForRec, next); // w8649
          const applied = await pushDC(
            obs,
            sessionForRec,
            M.ctd.resolveParentScopeSearchUserText(pendingGeographic, confirmedParentCity),
            next,
            { turnDestination: M.ctd.resolveConfirmedParentScopeTurnDestination(confirmedParentCity), fromClarification: true },
          ); // w8652-8660
          if (applied) return;
          obs.noResultsLabel = confirmedParentCity; // w8671-8679
          persistSession(sessionForRec, [...next, { role: "assistant", content: copyOf("noResults", { destination: confirmedParentCity }) }]);
          return;
        }
        obs.path = `parent_scope_${answer}→general|`;
      }
      // w8684-8741：未知地區確認（問一次；無法解析 → 清除後走一般流程）
      if (pendingGeographic?.kind === "destination_area") {
        const restored = M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed)
          ? null
          : M.geoClar.restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);
        nextSession = { ...nextSession, pendingClarification: undefined }; // w8689
        if (restored) {
          const next = [...msgs, { role: "user", content: trimmed }];
          obs.path = `clarification_answer(restored=${restored.restoredUserText})`;
          obs.answerKind = "restored";
          const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: restored.restoredUserText, session: nextSession, restored });
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, pendingClarification: undefined, activeCategoryIntent: restored.categoryIntent },
            explicitScope ?? { destination: restored.destinationLabel, parentCity: restored.parentCity, area: restored.area, searchScope: restored.searchScope },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDC(obs, sessionForRec, restored.restoredUserText, next, { fromClarification: true }); // w8713-8718
          if (applied) return;
          obs.noResultsLabel = restored.destinationLabel;
          persistSession(sessionForRec, [...next, { role: "assistant", content: copyOf("noResults", { destination: restored.destinationLabel }) }]);
          return;
        }
        obs.answerKind = "unresolved";
        obs.path = "destination_area_unresolved→general|";
      }
    } else if (pendingGeographic?.kind === "destination_area") {
      // base b8593-8663（T27 重建）
      if (M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed)) {
        nextSession = { ...nextSession, pendingClarification: undefined };
      } else {
        const restored = M.geoClar.restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);
        const next = [...msgs, { role: "user", content: trimmed }];
        if (restored) {
          obs.path = `clarification_answer(restored=${restored.restoredUserText})`;
          obs.answerKind = "restored";
          const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: restored.restoredUserText, session: nextSession, restored });
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, pendingClarification: undefined, activeCategoryIntent: restored.categoryIntent },
            explicitScope ?? { destination: restored.destinationLabel, parentCity: restored.parentCity, area: restored.area, searchScope: restored.searchScope },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDC(obs, sessionForRec, restored.restoredUserText, next);
          if (applied) return;
          obs.noResultsLabel = restored.destinationLabel;
          persistSession(sessionForRec, [...next, { role: "assistant", content: copyOf("noResults", { destination: restored.destinationLabel }) }]);
          return;
        }
        obs.path = "clarification_reask";
        obs.answerKind = "reask";
        obs.clarified = true;
        obs.clarificationLabel = pendingGeographic.rawGeographicLabel;
        obs.copyKind = "whichRegion";
        obs.copy = copyOf("whichRegion", { destination: pendingGeographic.rawGeographicLabel });
        persistSession(nextSession, [...next, { role: "assistant", content: obs.copy }]);
        return;
      }
    }
    if (M.cps.isReplanIntent(trimmed)) nextSession = M.cps.resetChatPlanningForReplan(nextSession, "user_replan_intent"); // w8743
    const merged = M.tc.mergeTravelContext(nextSession, trimmed, lastAssistantReply); // w8773
    nextSession = merged.session;
    let providerResolvedTurnDestination;
    if (merged.context.destinationCandidate?.status === "pending") {
      // w8779-8790
      phase = "global_candidate";
      nextSession = await M.gpc.resolveGlobalPlanningCandidate(nextSession, LOCALE, async (query) => {
        const response = await geocodeFn({ data: { query, destinationName: query, locale: LOCALE, disableLocaleRegionBias: true, placesFallback: false } });
        return { location: response.location, rawResultCount: response.providerResult.rawResultCount };
      });
      phase = "post";
      merged.session = nextSession;
      merged.context = nextSession.travelContext ?? merged.context;
      if (IS_WORK && merged.context.destinationCandidate?.status === "resolved") {
        providerResolvedTurnDestination = merged.context.destination; // w8787-8789
      }
    }
    // w8791-8797
    if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
      obs.path += "advice_clarification(destinationCandidate)";
      obs.clarified = true;
      obs.copyKind = "advice";
      persistSession(nextSession, [...msgs, { role: "user", content: trimmed }, { role: "assistant", content: "advice" }]);
      return;
    }
    if (M.budget.isBudgetRefinementText(trimmed)) {
      nextSession = M.budget.applyBudgetRefinementToSession(trimmed, { ...nextSession, travelContext: merged.context });
    }
    nextSession = M.tpc.mergeTripPlanningContext(trimmed, nextSession, merged.context).session;
    const destCandidate =
      merged.context.destination?.trim() || nextSession.tripDestination?.displayLabel?.trim() || nextSession.tripDestination?.city?.trim();
    const isTripStyleSelection =
      nextSession.pendingQuestion?.type === "ask_trip_style" ||
      (M.tripStyle.parseAskTripStyleSelection(trimmed) != null && !M.numSel.rejectNumericSelection(nextSession, trimmed));
    if (!isTripStyleSelection) {
      if (nextSession.phase === "done") nextSession = M.aps.startNewPlanningSession(nextSession, "phase_done");
      else if (M.aps.shouldStartNewPlanningSession(nextSession, destCandidate)) nextSession = M.aps.startNewPlanningSession(nextSession, "destination_change");
    }
    nextSession = M.chatSession.extractPlanningHintsFromText(trimmed, nextSession);
    nextSession = M.chatSession.extractDiscoveryFromText(trimmed, nextSession);
    nextSession = M.planFlow.extractChatPlanningContextFromText(trimmed, nextSession);
    let unresolvedPlanningCandidateContext = false;
    try {
      const renderedCandidates = M.refresh.extractLatestShownCandidatesFromMsgs(msgs);
      const candidateContext = M.pcc.resolvePlanningCandidateContext(nextSession, renderedCandidates);
      const shownCandidates = candidateContext.candidates;
      let delta = M.pcc.parsePlanningConstraintDelta({
        text: trimmed,
        shownCandidates,
        authoritativeDestination: nextSession.travelContext?.destination ?? merged.context.destination ?? destCandidate,
        activePlace: nextSession.placeDetailFocus ?? (shownCandidates.length === 1 ? shownCandidates[0] : undefined),
        onStage: () => {},
      });
      delta = M.pcc.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });
      const req = M.pcc.resolvePlanningContextRequirement({
        text: trimmed,
        delta,
        candidateCount: shownCandidates.length,
        destinationDetected: Boolean(destCandidate),
        durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate),
      });
      unresolvedPlanningCandidateContext = req.requiresCandidateContext && shownCandidates.length === 0;
      if (!unresolvedPlanningCandidateContext) nextSession = M.pcc.applyPlanningConstraintDelta(nextSession, delta, shownCandidates);
      if (unresolvedPlanningCandidateContext) {
        obs.path += "planning_candidate_context_clarification";
        return;
      }
      if (delta?.acceptRemainingCandidates === true) {
        obs.path += "accept_remaining(未重建)";
        return;
      }
    } catch (e) {
      obs.path += `planning_constraint_throw:${e?.message ?? e}`;
      return;
    }
    if (M.cps.isStyleReselectTurn(trimmed, nextSession, merged.context)) {
      obs.path += "style_reselect(未重建)";
      return;
    }
    const stylePlanTurn = M.cps.shouldTriggerTripStylePlanning(trimmed, nextSession, merged.context);
    if (stylePlanTurn && (nextSession.pendingQuestion?.type === "ask_trip_style" || nextSession.chatPlanningState === "waitingStyleSelection")) {
      obs.path += "trip_style_advice(未重建)";
      return;
    }
    if (M.addAll.isAddAllToTripIntent(trimmed)) {
      obs.path += "add_all_to_trip(未重建)";
      return;
    }
    if (M.refresh.shouldAcceptAlternativeRecommendations(msgs, trimmed)) {
      obs.path += "alternative_recommendations(未重建)";
      return;
    }
    if (M.refresh.shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)) {
      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      const destForMore =
        nextSession.activeRecommendationContext?.destinationName ||
        nextSession.recommendationSession?.destination ||
        nextSession.travelContext?.destination ||
        nextSession.tripPlanningContext?.destination ||
        nextSession.tripDestination?.city;
      obs.path += `continuation:${arbitration.route}`;
      obs.continuationDest = destForMore ?? null;
      obs.searchDest = destForMore ?? null;
      return;
    }
    // w9567-9576
    const placeFetchContext = M.mvp.mergeContextForPlaceFetch(merged.context, nextSession);
    let turnDestination;
    if (IS_WORK) {
      turnDestination = M.ctd.resolveCategoryTurnDestination({
        ctx: placeFetchContext,
        session: nextSession,
        userText: trimmed,
        locale: LOCALE,
        providerResolvedTurnDestination,
      });
      obs.turnResolution = `${turnDestination.confidence}/${turnDestination.source}`;
    }
    // weather：w9579-9600 / b9461-9479
    const weatherDest = IS_WORK
      ? placeFetchContext.destination?.trim() && !placeFetchContext.weather && turnDestination.destination
        ? turnDestination.destination
        : null
      : placeFetchContext.destination?.trim() && !placeFetchContext.weather
        ? placeFetchContext.destination
        : null;
    if (weatherDest) {
      obs.weatherDest = weatherDest;
      phase = "weather";
      const weather = await M.weather.prefetchDestinationWeather({ destination: weatherDest, locale: LOCALE, geocodeFn, fetchWeatherFn: fetchWeather });
      phase = "post";
      if (weather) nextSession = { ...nextSession, weather, travelContext: { ...(nextSession.travelContext ?? placeFetchContext), weather } };
    }
    const refreshedPlaceCtx = M.mvp.mergeContextForPlaceFetch(nextSession.travelContext ?? merged.context, nextSession); // w9602
    if (M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
      obs.path += "destination_places(未改，未重建 push)";
      obs.searchDest = refreshedPlaceCtx.destination ?? null;
      return;
    }
    // w9627-9645
    const earlyCategoryPlaceQuery = M.placeIntent.shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession);
    const earlyNearbyIntent = M.chatIntent.inferNearbyIntentFromContext(refreshedPlaceCtx, trimmed, nextSession);
    const earlyRouteAuthority = M.nearbyClar.resolveChatRouteAuthority({
      structuredShortcut: false,
      explicitNearbyRequest: M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed),
      pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
      resolvedNearbyIntent: earlyNearbyIntent,
      categoryPlaceQuery: earlyCategoryPlaceQuery,
    });
    const next = [...msgs, { role: "user", content: trimmed }];
    if (earlyRouteAuthority === "destination_category") {
      // w9657-9708 / b9536-9590
      obs.path += "destination_category";
      const dest = IS_WORK
        ? (turnDestination.destination ?? "")
        : (M.catDest.resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? "");
      obs.dispatchDest = dest;
      const applied = await pushDC(obs, { ...nextSession, travelContext: refreshedPlaceCtx }, trimmed, next, IS_WORK ? { turnDestination } : undefined);
      if (applied) return;
      const destLabel = IS_WORK
        ? dest
        : (M.catDest.resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? dest ?? "這個目的地");
      obs.noResultsLabel = destLabel;
      // w9701-9707：只 setMsgs，不 persistSession（兩樹相同）
      msgs = [...next, { role: "assistant", content: copyOf("noResults", { destination: destLabel }) }];
      return;
    }
    // w9712-9879（refinement → NEW_RECOMMENDATION → pushDC）
    if (M.refine.shouldSkipTripPlanningForRefinement(trimmed, nextSession)) {
      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      obs.path += `refinement:${arbitration.route}`;
      if (arbitration.route === "NEW_RECOMMENDATION") {
        const appliedNew = await pushDC(obs, { ...nextSession, travelContext: refreshedPlaceCtx }, trimmed, next, IS_WORK ? { turnDestination } : undefined);
        if (appliedNew) return;
      }
      if (arbitration.route === "MORE_RECOMMENDATIONS") {
        const destForMore =
          nextSession.activeRecommendationContext?.destinationName ||
          nextSession.recommendationSession?.destination ||
          nextSession.travelContext?.destination ||
          nextSession.tripPlanningContext?.destination ||
          nextSession.tripDestination?.city;
        obs.continuationDest = destForMore ?? null;
      }
      const firstTurn =
        arbitration.route === "NEW_RECOMMENDATION" && !nextSession.activeRecommendationContext && !nextSession.recommendationSession;
      if (firstTurn) {
        const destLabel = IS_WORK
          ? (turnDestination.destination ?? refreshedPlaceCtx.destination?.trim() ?? "")
          : (M.catDest.resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? refreshedPlaceCtx.destination?.trim() ?? "");
        if (destLabel) obs.noResultsLabel = destLabel;
      }
      return;
    }
    obs.path += `later:${earlyRouteAuthority}(未重建；planner/advice/nearby 下游)`;
    persistSession(nextSession, [...next, { role: "assistant", content: "later" }]);
  }

  const result = { isWork: IS_WORK, turns: [], envScrubbed, undiciLoaded, mockKey: process.env.GOOGLE_MAPS_API_KEY, viteMockKey: process.env.VITE_GOOGLE_MAPS_API_KEY };
  try {
    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {
      const t = typeof turn === "string" ? { text: turn } : turn;
      if (t.onlyIfClarified) {
        const last = result.turns.at(-1);
        if (!last || !last.clarified) continue;
      }
      const obs = newTurnObs(t.text);
      obs.turnIndex = turnIndex + TURN_OFFSET;
      const g0 = geocodes.length;
      const w0 = weatherCalls.length;
      const b0 = builderCalls.length;
      const p0 = placesReqs.length;
      const c0 = creditsBegin.length;
      const s0 = creditsSettle.length;
      msgs = [...msgs];
      try {
        await send(obs, t.text);
      } catch (e) {
        obs.error = `THROW:${e?.message ?? e}`;
      }
      phase = "post";
      obs.geocodes = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);
      obs.placesQueries = placesReqs.slice(p0).map((p) => `${p.q}@${p.dest ?? "-"}`);
      obs.weatherCalls = weatherCalls.length - w0;
      obs.builderCalls = builderCalls.length - b0;
      obs.placesRequests = placesReqs.length - p0;
      obs.creditsBegin = creditsBegin.length - c0;
      obs.creditsSettle = creditsSettle.slice(s0);
      obs.sessionDest = persisted.travelContext?.destination ?? null;
      obs.sessionRecDest = persisted.recommendationSession?.destination ?? persisted.activeRecommendationContext?.destinationName ?? null;
      obs.sessionTripPlanningDest = persisted.tripPlanningContext?.destination ?? null;
      obs.sessionPendingLabel = persisted.pendingClarification?.rawGeographicLabel ?? null;
      obs.sessionPendingKind = persisted.pendingClarification?.kind ?? null;
      obs.sessionPendingParent = persisted.pendingClarification?.confirmedParentCity ?? null;
      obs.sessionPendingOriginal = persisted.pendingClarification?.originalUserText ?? null;
      const ap = JSON.stringify(persisted).match(/"activityPreference":"([^"]*)"/);
      obs.activityPreference = ap ? ap[1] : null;
      result.turns.push(obs);
    }
  } catch (e) {
    result.error = `THROW:${e?.message ?? e}`;
  }
  for (const k of Object.keys(orig)) console[k] = orig[k];
  result.final = { persisted, msgs };
  const fetchCalls = Object.values(ext).reduce((a, b) => a + b, 0);
  await new Promise((resolve) =>
    process.stdout.write(`\n@@P2R2_JSON@@${JSON.stringify({ result, fetchCalls, ext, fetchLog: extLog })}\n`, resolve),
  );
  process.exit(0);
}

// ════════════════════════ main ════════════════════════
const fs = await import("node:fs");
const path = await import("node:path");
const { existsSync, readFileSync } = fs;
const { spawn } = await import("node:child_process");

// ── source anchors：確認重建的呼叫確實存在於各自的 _app.chat.tsx（並列出行號）──
const ANCHORS = {
  work: [
    '} from "@/lib/ai/chat-turn-destination";',
    "const turnDestination = await validateCategoryTurnDestination(",
    "opts?.turnDestination ??",
    "const clarificationPlan = planCategoryTurnClarification(turnDestination);",
    "if (clarificationPlan && opts?.fromClarification) {",
    '? chatRuntimeCopy("parentScopeConfirm", locale, { destination: clarificationLabel })',
    ': chatRuntimeCopy("whichRegion", locale, { destination: clarificationLabel });',
    "const sessionDestinationForClarification = confirmedContextDestination(",
    "? buildPendingParentScopeClarification({",
    "rawGeographicLabel: turnDestination.rawLabel ?? clarificationLabel,",
    "const destination = turnDestination.destination;",
    'metadata: { path: "destination_category", destination, intents },',
    'if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {',
    'parseParentScopeConfirmationAnswer(trimmed) === "confirm"',
    "resolveParentScopeSearchUserText(pendingGeographic, confirmedParentCity),",
    "turnDestination: resolveConfirmedParentScopeTurnDestination(confirmedParentCity),",
    'if (pendingGeographic?.kind === "destination_area" && !nearbyShortcutTurn) {',
    ": restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);",
    "{ fromClarification: true },",
    "providerResolvedTurnDestination = merged.context.destination;",
    "const turnDestination = resolveCategoryTurnDestination({",
    "destination: turnDestination.destination,\n          locale,\n          geocodeFn: geocodeLocationFn,\n          fetchWeatherFn: fetchWeather,",
    'const dest = turnDestination.destination ?? "";',
    "{ turnDestination },",
    "const destLabel = dest;\n        setMsgs((prev) => [",
    "turnDestination.destination ?? refreshedPlaceCtx.destination?.trim() ?? \"\";",
  ],
  base: [
    "const provisionalArea = extractProvisionalDestinationAreaCandidate(userText);",
    "const validatedAreaScope = await resolveValidatedDestinationAreaScope({",
    "const destination = validatedAreaScope?.displayLabel ?? baseDestination;",
    "destination: placeFetchContext.destination,\n          locale,\n          geocodeFn: geocodeLocationFn,\n          fetchWeatherFn: fetchWeather,",
    'resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? "";',
    "const restored = restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);",
    'metadata: { path: "destination_category", destination, intents },',
  ],
};
const anchorFail = [];
const anchorLines = [];
for (const [tree, root] of [["work", WORK_ROOT], ["base", BASE_ROOT]]) {
  const p = `${root}/src/routes/_app.chat.tsx`;
  if (!existsSync(p)) {
    anchorFail.push(`${tree}: missing ${p}`);
    continue;
  }
  const src = readFileSync(p, "utf8");
  for (const a of ANCHORS[tree]) {
    if (!src.includes(a)) {
      anchorFail.push(`${tree}: anchor missing → ${a.split("\n")[0]}`);
      continue;
    }
    const lines = [];
    let from = 0;
    for (;;) {
      const i = src.indexOf(a, from);
      if (i < 0) break;
      lines.push(src.slice(0, i).split("\n").length);
      from = i + 1;
    }
    anchorLines.push(`${tree} L${lines.join(",")} :: ${a.split("\n")[0].slice(0, 100)}`);
  }
}
if (anchorFail.length) {
  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\n"));
  process.exit(1);
}

// ── 模組依賴圖：循環與 chat-intent-router 依賴鏈 ──
function buildGraph(root, { runtimeOnly }) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(f);
    }
  };
  walk(path.join(root, "src"));
  const resolveImport = (spec, from) => {
    let b;
    if (spec.startsWith("@/")) b = path.join(root, "src", spec.slice(2));
    else if (spec.startsWith(".")) b = path.resolve(path.dirname(from), spec);
    else return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const f = b + ext;
      if (existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  };
  const graph = new Map();
  for (const f of files) {
    const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const deps = new Set();
    const re = /(import|export)\s+(type\s+)?([^"';]*?)from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
    for (const m of s.matchAll(re)) {
      const spec = m[4] ?? m[5] ?? m[6];
      if (runtimeOnly && m[2]) continue; // import type / export type
      if (runtimeOnly && m[3] && /^\{\s*(?:type\s+[\w$]+\s*(?:as\s+[\w$]+\s*)?,?\s*)+\}\s*$/.test(m[3].trim())) continue; // import { type A, type B }
      const r = resolveImport(spec, f);
      if (r) deps.add(r);
    }
    graph.set(f, deps);
  }
  return graph;
}
function sccs(graph) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const out = [];
  const strong = (v) => {
    // iterative Tarjan
    const work = [[v, [...(graph.get(v) ?? [])], 0]];
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    while (work.length) {
      const top = work[work.length - 1];
      const [node, deps] = top;
      if (top[2] < deps.length) {
        const w = deps[top[2]++];
        if (!graph.has(w)) continue;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index += 1;
          stack.push(w);
          on.add(w);
          work.push([w, [...(graph.get(w) ?? [])], 0]);
        } else if (on.has(w)) low.set(node, Math.min(low.get(node), idx.get(w)));
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
        if (low.get(node) === idx.get(node)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            on.delete(w);
            comp.push(w);
          } while (w !== node);
          if (comp.length > 1 || (graph.get(node) ?? new Set()).has(node)) out.push(comp);
        }
      }
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  return out;
}
function closure(graph, start) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const f = q.shift();
    for (const d of graph.get(f) ?? []) if (!seen.has(d)) (seen.add(d), q.push(d));
  }
  return seen;
}
const graphReport = [];
const graphP1 = [];
const WATCH = [
  "src/lib/ai/chat-turn-destination.ts",
  "src/lib/ai/destination-resolution.ts",
  "src/lib/ai/destination-geographic-clarification.ts",
  "src/lib/i18n/chat-runtime.ts",
  "src/lib/ai/chat-category-destination.ts",
  "src/routes/_app.chat.tsx",
];
for (const runtimeOnly of [true, false]) {
  const label = runtimeOnly ? "runtime（排除 import type）" : "all（含 import type）";
  const wg = buildGraph(WORK_ROOT, { runtimeOnly });
  const bg = buildGraph(BASE_ROOT, { runtimeOnly });
  const key = (root, comp) => comp.map((f) => path.relative(root, f)).sort().join("|");
  const ws = sccs(wg).map((c) => key(WORK_ROOT, c));
  const bs = new Set(sccs(bg).map((c) => key(BASE_ROOT, c)));
  const added = ws.filter((k) => !bs.has(k));
  const touching = ws.filter((k) => WATCH.some((w) => k.split("|").includes(w)));
  graphReport.push(`${label}: work SCC(循環)=${ws.length} base=${bs.size} 新增=${added.length} 含本次相關模組=${touching.length}`);
  for (const k of added) {
    graphReport.push(`  + 新增循環: ${k.split("|").slice(0, 8).join(" ↔ ")}${k.split("|").length > 8 ? ` …(${k.split("|").length})` : ""}`);
    if (runtimeOnly || touching.includes(k)) graphP1.push(`循環 import（${label}）: ${k.split("|").slice(0, 8).join(" ↔ ")}`);
  }
  for (const k of touching) if (!added.includes(k)) graphReport.push(`  ! 既有循環含相關模組: ${k.slice(0, 200)}`);
  const router = path.join(WORK_ROOT, "src/lib/ai/chat-intent-router.ts");
  const cl = closure(wg, router);
  for (const mod of ["src/lib/ai/chat-turn-destination.ts", "src/lib/ai/destination-resolution.ts"]) {
    const inChain = cl.has(path.join(WORK_ROOT, mod));
    graphReport.push(`  chat-intent-router 依賴鏈（${label}，${cl.size} 檔）含 ${mod}: ${inChain ? "是" : "否"}`);
    if (inChain && mod.endsWith("chat-turn-destination.ts")) graphP1.push(`chat-intent-router 依賴鏈 import 了 ${mod}（${label}）`);
  }
  const importers = [...wg.entries()].filter(([, d]) => d.has(path.join(WORK_ROOT, "src/lib/ai/chat-turn-destination.ts"))).map(([f]) => path.relative(WORK_ROOT, f));
  graphReport.push(`  chat-turn-destination.ts 的 importer（${label}）: ${importers.join(", ") || "(none)"}`);
}

// ── 情境 ──
const ANS = (text) => ({ text, onlyIfClarified: true });
// T27 的 52 個情境（原樣保留）
const T27_SCENARIOS = [
  { id: "01a", label: "京都看楓葉", turns: ["京都看楓葉", ANS("京都")] },
  { id: "01b", label: "京都看楓葉推薦景點", turns: ["京都看楓葉推薦景點", ANS("京都")] },
  { id: "02a", label: "北海道滑雪", turns: ["北海道滑雪", ANS("北海道")] },
  { id: "02b", label: "北海道滑雪推薦景點", turns: ["北海道滑雪推薦景點", ANS("北海道")] },
  { id: "03a", label: "沖繩潛水", turns: ["沖繩潛水", ANS("沖繩")] },
  { id: "03b", label: "沖繩潛水推薦景點", turns: ["沖繩潛水推薦景點", ANS("沖繩")] },
  { id: "04a", label: "奈良看鹿", turns: ["奈良看鹿", ANS("奈良")] },
  { id: "04b", label: "奈良看鹿景點推薦", turns: ["奈良看鹿景點推薦", ANS("奈良")] },
  { id: "05a", label: "金澤看兼六園", turns: ["金澤看兼六園", ANS("金澤")] },
  { id: "05b", label: "金澤看兼六園推薦景點", turns: ["金澤看兼六園推薦景點", ANS("金澤")] },
  { id: "06a", label: "花蓮泛舟", turns: ["花蓮泛舟", ANS("花蓮")] },
  { id: "06b", label: "花蓮泛舟推薦景點", turns: ["花蓮泛舟推薦景點", ANS("花蓮")] },
  { id: "07a", label: "香港跑馬地", turns: ["香港跑馬地", ANS("香港")] },
  { id: "07b", label: "香港跑馬地美食", turns: ["香港跑馬地美食", ANS("香港")] },
  { id: "08a", label: "台南看西街教會", turns: ["台南看西街教會", ANS("台南")] },
  { id: "08b", label: "台南看西街教會推薦景點", turns: ["台南看西街教會推薦景點", ANS("台南")] },
  { id: "09a", label: "新竹潛園", turns: ["新竹潛園", ANS("新竹")] },
  { id: "09b", label: "新竹潛園推薦景點", turns: ["新竹潛園推薦景點", ANS("新竹")] },
  { id: "10a", label: "千葉釣崎海岸", turns: ["千葉釣崎海岸", ANS("千葉")] },
  { id: "10b", label: "千葉釣崎海岸推薦景點", turns: ["千葉釣崎海岸推薦景點", ANS("千葉")] },
  { id: "11a", label: "東京玩具美術館", turns: ["東京玩具美術館", ANS("東京")] },
  { id: "11b", label: "東京玩具美術館推薦景點", turns: ["東京玩具美術館推薦景點", ANS("東京")] },
  { id: "12a", label: "台北士林夜市", turns: ["台北士林夜市", ANS("台北")] },
  { id: "12b", label: "台北士林夜市美食", turns: ["台北士林夜市美食", ANS("台北")] },
  { id: "13", label: "京都推薦景點", turns: ["京都推薦景點"] },
  { id: "14", label: "京都三天行程（Planner）", turns: ["京都三天行程"] },
  { id: "15a", label: "跨城市 京都→大阪", turns: ["京都推薦景點", "大阪推薦景點"] },
  { id: "15b", label: "跨城市 京都→大阪美食", turns: ["京都推薦景點", "大阪美食"] },
  { id: "15c", label: "Session 京都→新指定 台中西屯美食", turns: ["京都推薦景點", "台中西屯美食"] },
  { id: "15d", label: "Session 京都→未確認 奈良看鹿景點推薦", turns: ["京都推薦景點", "奈良看鹿景點推薦", ANS("奈良")] },
  { id: "16a", label: "Continuation 京都→再推薦幾個", turns: ["京都推薦景點", "再推薦幾個"] },
  { id: "16b", label: "Continuation 京都→再推薦幾個→還有嗎", turns: ["京都推薦景點", "再推薦幾個", "還有嗎"] },
  { id: "20a", label: "Session 保存 台中西屯美食→再推薦幾個", turns: ["台中西屯美食", "再推薦幾個"] },
  { id: "20b", label: "Session 保存 台中西屯推薦景點→再推薦幾個", turns: ["台中西屯推薦景點", "再推薦幾個"] },
  { id: "X1", label: "京都冷門景點", turns: ["京都冷門景點", ANS("京都")] },
  { id: "X2", label: "埔里咖啡廳（無父城市）", turns: ["埔里咖啡廳", ANS("南投")] },
  { id: "X3", label: "全球城市（global candidate）我想去里斯本→推薦景點", turns: ["我想去里斯本", "推薦景點"] },
  { id: "X4", label: "里斯本推薦景點（未列表城市）", turns: ["里斯本推薦景點", ANS("葡萄牙")] },
  { id: "X5", label: "京都推薦景點→京都看楓葉推薦景點（Session 內）", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("京都")] },
  { id: "X6", label: "Session 沿用 京都→推薦咖啡廳", turns: ["京都推薦景點", "推薦咖啡廳"] },
  { id: "X7", label: "Session 沿用 京都→那咖啡廳呢", turns: ["京都推薦景點", "那咖啡廳呢"] },
  { id: "X8", label: "Session 沿用 京都→再推薦幾個咖啡廳", turns: ["京都推薦景點", "再推薦幾個咖啡廳"] },
  { id: "X9", label: "Session 沿用（已驗證區）台中西屯美食→推薦咖啡廳", turns: ["台中西屯美食", "推薦咖啡廳"] },
  { id: "X10", label: "Session 沿用（已驗證區）香港跑馬地美食→推薦景點", turns: ["香港跑馬地美食", "推薦景點"] },
  { id: "R1", label: "重新載入後 台中西屯美食→推薦咖啡廳", turns: ["台中西屯美食", "推薦咖啡廳"], reloadAfter: 0 },
  { id: "R2", label: "重新載入後 香港跑馬地美食→推薦景點", turns: ["香港跑馬地美食", "推薦景點"], reloadAfter: 0 },
  { id: "R3", label: "重新載入後 京都推薦景點→推薦咖啡廳（對照）", turns: ["京都推薦景點", "推薦咖啡廳"], reloadAfter: 0 },
  { id: "R4", label: "重新載入後 台中西屯美食→再推薦幾個", turns: ["台中西屯美食", "再推薦幾個"], reloadAfter: 0 },
  { id: "R5", label: "重新載入後 我想去里斯本→推薦景點（global candidate）", turns: ["我想去里斯本", "推薦景點"], reloadAfter: 0 },
  { id: "G1", label: "全球城市同輪 我想去里斯本，推薦景點", turns: ["我想去里斯本，推薦景點"] },
  { id: "G2", label: "全球城市同輪 里斯本有什麼景點推薦", turns: ["里斯本有什麼景點推薦"] },
  { id: "G3", label: "全球城市同輪 想去波爾圖，有推薦的咖啡廳嗎", turns: ["想去波爾圖，有推薦的咖啡廳嗎"] },
];
const T27_IDS = new Set(T27_SCENARIOS.map((s) => s.id));
// T28 新增必測情境。expect：
//  parentAsk{turn,parent}：work 該輪若澄清，必須是父城市範圍確認（kind/copy/label=parent）。
//  confirm{turn,parent}：work 該輪（回答「好/是」）只用 parent 搜尋，不帶尾段／整串，不重複串接。
//  cleared{turn}：回答後 pending 必須清除、不得重新建立相同澄清、不得以舊 parent 搜尋。
//  search{turn,dest,modes?}：work 該輪搜尋目的地必須是 dest。
//  notSearch{turn,dest}：work 該輪搜尋／續推不得是 dest。
//  cont{turn,dest}：work 該輪 continuation 目的地必須是 dest。
const GIB = "嗯嗯哈哈";
const NEW_SCENARIOS = [];
for (const [code, parent, raw] of [["K", "京都", "京都看楓葉"], ["H", "北海道", "北海道滑雪"], ["N", "奈良", "奈良看鹿"], ["F", "花蓮", "花蓮泛舟"]]) {
  for (const [a, ans] of [["ok", "好"], ["yes", "是"], ["no", "不用"], ["gib", GIB]]) {
    const confirm = a === "ok" || a === "yes";
    NEW_SCENARIOS.push({
      id: `N-${code}-${a}`,
      label: `${raw}推薦景點 → 「${ans}」`,
      turns: [`${raw}推薦景點`, ANS(ans)],
      expect: { parent, raw, parentAsk: { turn: 0, parent }, ...(confirm ? { confirm: { turn: 1, parent } } : { cleared: { turn: 1, parent } }) },
    });
  }
}
NEW_SCENARIOS.push(
  { id: "N-meal-ok", label: "京都看楓葉晚餐推薦 → 好（Places query 不得含京都看楓葉）", turns: ["京都看楓葉晚餐推薦", ANS("好")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" } } },
  { id: "N-meal-yes", label: "京都看楓葉晚餐推薦 → 是", turns: ["京都看楓葉晚餐推薦", ANS("是")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" } } },
  { id: "N-meal-H", label: "北海道滑雪午餐推薦 → 好", turns: ["北海道滑雪午餐推薦", ANS("好")], expect: { parent: "北海道", raw: "北海道滑雪", parentAsk: { turn: 0, parent: "北海道" }, confirm: { turn: 1, parent: "北海道" } } },
  { id: "N-xitun", label: "西屯咖啡廳 → 台中", turns: ["西屯咖啡廳", ANS("台中")], expect: { area: { turn: 1, dest: "台中西屯" } } },
  { id: "N-puli", label: "埔里咖啡廳 → 南投", turns: ["埔里咖啡廳", ANS("南投")], expect: { area: { turn: 1, dest: "南投埔里" } } },
  { id: "N-xitun-gib", label: "西屯咖啡廳 → 不知道（無法解析）", turns: ["西屯咖啡廳", ANS("不知道")], expect: { cleared: { turn: 1 } } },
  { id: "N-puli-gib", label: `埔里咖啡廳 → ${GIB}（無法解析）`, turns: ["埔里咖啡廳", ANS(GIB)], expect: { cleared: { turn: 1 } } },
  { id: "N-xitun-cont", label: "西屯咖啡廳 → 台中 → 再推薦幾個", turns: ["西屯咖啡廳", ANS("台中"), "再推薦幾個"], expect: { area: { turn: 1, dest: "台中西屯" } } },
  { id: "N-K-cont", label: "京都看楓葉推薦景點 → 好 → 再推薦幾個 → 還有嗎", turns: ["京都看楓葉推薦景點", ANS("好"), "再推薦幾個", "還有嗎"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" }, cont: [{ turn: 2, dest: "京都" }, { turn: 3, dest: "京都" }] } },
  { id: "N-K-osaka", label: "京都看楓葉推薦景點（待確認）→ 大阪推薦景點", turns: ["京都看楓葉推薦景點", "大阪推薦景點"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, search: [{ turn: 1, dest: "大阪" }] } },
  { id: "N-K-osaka-ok", label: "京都看楓葉推薦景點（待確認）→ 大阪推薦景點 → 好（舊 pending 不得復活）", turns: ["京都看楓葉推薦景點", "大阪推薦景點", "好"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, search: [{ turn: 1, dest: "大阪" }], notSearch: [{ turn: 2, dest: "京都" }] } },
  { id: "N-K-no-ok", label: "京都看楓葉推薦景點 → 不用 → 好（舊 pending 不得復活）", turns: ["京都看楓葉推薦景點", ANS("不用"), "好"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 2, dest: "京都" }] } },
  { id: "N-K-gib-ok", label: `京都看楓葉推薦景點 → ${GIB} → 好（舊 pending 不得復活）`, turns: ["京都看楓葉推薦景點", ANS(GIB), "好"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 2, dest: "京都" }] } },
  { id: "N-K-ok-osaka", label: "京都看楓葉推薦景點 → 好 → 大阪推薦景點（確認後換城市）", turns: ["京都看楓葉推薦景點", ANS("好"), "大阪推薦景點"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" }, search: [{ turn: 2, dest: "大阪" }] } },
  { id: "N-K-city", label: "京都看楓葉推薦景點 → 京都（以城市名回答）", turns: ["京都看楓葉推薦景點", ANS("京都")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" } } },
  { id: "N-K-sess", label: "京都推薦景點 → 京都看楓葉推薦景點 → 好", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("好")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 1, parent: "京都" }, confirm: { turn: 2, parent: "京都" } } },
  { id: "N-K-more", label: "京都看楓葉推薦景點（待確認）→ 再推薦幾個", turns: ["京都看楓葉推薦景點", "再推薦幾個"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-no-more", label: "京都看楓葉推薦景點 → 不用 → 再推薦幾個", turns: ["京都看楓葉推薦景點", ANS("不用"), "再推薦幾個"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-gib-more", label: `京都看楓葉推薦景點 → ${GIB} → 再推薦幾個`, turns: ["京都看楓葉推薦景點", ANS(GIB), "再推薦幾個"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-no-cafe", label: "京都看楓葉推薦景點 → 不用 → 推薦咖啡廳", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-reload", label: "京都看楓葉推薦景點 →（重新載入）→ 好", turns: ["京都看楓葉推薦景點", ANS("好")], reloadAfter: 0, expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" } } },
);
const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS];
const MODES = [
  { id: "ok", geo: "ok", search: "ok" },
  { id: "ok-empty", geo: "ok", search: "empty" },
  { id: "timeout", geo: "timeout", search: "ok" },
  { id: "null", geo: "null", search: "ok" },
  { id: "zero", geo: "zero", search: "ok" },
  { id: "neterr", geo: "neterr", search: "ok" },
];
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) || process.env.VERIFY_P2R2_ONLY;
const ONLY = onlyArg ? new Set(onlyArg.split(",")) : null;
const scenarios = ONLY ? SCENARIOS.filter((s) => ONLY.has(s.id)) : SCENARIOS;
const rowsArg = process.argv.find((a) => a.startsWith("--rows="))?.slice("--rows=".length);
const ROWS_ALL = rowsArg === "all";
const ROWS = rowsArg && !ROWS_ALL ? new Set(rowsArg.split(",")) : null;

// 子程序 env：白名單 + Mock Key（不繼承 main 的 process.env；vite-node CLI 已把 .env 讀進 main）
const ENV_ALLOW = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "SHELL", "TERM", "TZ"];
function childEnv(extra) {
  const env = {};
  for (const k of ENV_ALLOW) if (process.env[k] != null) env[k] = process.env[k];
  return { ...env, NODE_ENV: "development", ...MOCK_ENV, ...extra };
}

async function collect(root, mode, scenario) {
  if (scenario.reloadAfter == null) return collectOnce(root, mode, scenario, {});
  const k = scenario.reloadAfter;
  const a = await collectOnce(root, mode, { ...scenario, turns: scenario.turns.slice(0, k + 1) }, {});
  if (a.err || a.result.error) return a;
  const b = await collectOnce(root, mode, { ...scenario, turns: scenario.turns.slice(k + 1) }, {
    VERIFY_P2_INIT: JSON.stringify(a.result.final),
    VERIFY_P2_TURN_OFFSET: String(k + 1),
  });
  if (b.err) return b;
  // 重新載入後的第一個回答輪：onlyIfClarified 以前段最後一輪為準
  return {
    result: { ...b.result, turns: [...a.result.turns, ...b.result.turns], error: a.result.error ?? b.result.error },
    fetchCalls: a.fetchCalls + b.fetchCalls,
    ext: Object.fromEntries(Object.keys(a.ext).map((x) => [x, a.ext[x] + b.ext[x]])),
    fetchLog: [...a.fetchLog, ...b.fetchLog],
  };
}

function collectOnce(root, mode, scenario, extraEnv) {
  // 重新載入的後段：若前段最後一輪未澄清，onlyIfClarified 的回答輪由子程序以「無前一輪」跳過；
  // 為了與 App 一致（回答輪是否送出由使用者決定），後段第一個 onlyIfClarified 回答輪改為一定送出。
  const sc = extraEnv.VERIFY_P2_INIT
    ? { ...scenario, turns: scenario.turns.map((t, i) => (i === 0 && typeof t === "object" ? { text: t.text } : t)) }
    : scenario;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: root,
      env: childEnv({
        ...extraEnv,
        VERIFY_P2R2_ROLE: "collect",
        VERIFY_ROOT: root,
        VERIFY_P2_GEO: mode.geo,
        VERIFY_P2_SEARCH: mode.search,
        VERIFY_P2_SCENARIO: JSON.stringify(sc),
      }),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith("@@P2R2_JSON@@"));
      if (!line) return resolve({ err: `status=${code} signal=${signal} stderr=${err.slice(-900)} stdout=${out.slice(-300)}` });
      resolve(JSON.parse(line.slice("@@P2R2_JSON@@".length)));
    });
  });
}

if (!existsSync(`${BASE_ROOT}/src/lib/ai/chat-category-destination.ts`)) {
  console.log(`INFRA-FAIL base root missing: ${BASE_ROOT}`);
  process.exit(1);
}
const jobs = [];
for (const s of scenarios) for (const m of MODES) for (const tree of ["work", "base"]) jobs.push({ s, m, tree });
const results = {};
const CONC = Number(process.env.VERIFY_P2R2_CONC ?? 8);
let idx = 0;
let done = 0;
async function worker() {
  while (idx < jobs.length) {
    const j = jobs[idx++];
    results[`${j.tree}|${j.m.id}|${j.s.id}`] = await collect(j.tree === "work" ? WORK_ROOT : BASE_ROOT, j.m, j.s);
    done += 1;
    if (done % 50 === 0) process.stderr.write(`[p2r2] ${done}/${jobs.length}\n`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const infra = [];
const extTotals = { fetch: 0, http: 0, https: 0, net: 0, tls: 0, undici: 0 };
const extHits = [];
let undiciLoadedAll = true;
let envScrubbedAny = new Set();
let mockKeyOk = true;
for (const [k, r] of Object.entries(results)) {
  if (r.err) {
    infra.push(`INFRA-FAIL ${k} ${r.err}`);
    continue;
  }
  for (const x of Object.keys(extTotals)) extTotals[x] += r.ext?.[x] ?? 0;
  if (r.fetchCalls !== 0) extHits.push(`EXTERNAL-REQUEST ${k} count=${r.fetchCalls} ${r.fetchLog.join(";")}`);
  if (r.result.error) infra.push(`INFRA-FAIL ${k} ${r.result.error}`);
  else if (k.startsWith("work|") !== r.result.isWork) infra.push(`INFRA-FAIL ${k} tree mismatch isWork=${r.result.isWork}`);
  if (!r.result.undiciLoaded) undiciLoadedAll = false;
  for (const e of r.result.envScrubbed ?? []) envScrubbedAny.add(e);
  if (r.result.mockKey !== "mock-key" || r.result.viteMockKey !== "mock-key") mockKeyOk = false;
}
if (infra.length) {
  console.log(infra.slice(0, 40).join("\n"));
  console.log(`INFRA-FAIL count=${infra.length}`);
  process.exit(1);
}

// ── 判定 ──
const KNOWN = new Set(["京都", "大阪", "北海道", "沖繩", "奈良", "金澤", "花蓮", "香港", "台南", "新竹", "千葉", "東京", "台北", "台中", "南投"]);
const ADMIN_OK = new Set(["香港跑馬地", "台中西屯", "南投埔里", "里斯本", "波爾圖"]);
const confirmedDest = (d, mode) => !d || KNOWN.has(d) || (mode.geo === "ok" && ADMIN_OK.has(d));
const p1 = [...graphP1];
const diffExpected = [];
const ux = [];
const notes = [];
const costNotes = [];
const rows = [];
const fmt = (t) =>
  t
    ? `path=${t.path} | ans=${t.answerKind ?? "-"} | pendBefore=${t.pendingBefore ?? "-"} | dispatch=${t.dispatchDest ?? "-"} | res=${t.turnResolution ?? "-"} | search=${t.searchDest ?? "-"} | weather=${t.weatherDest ?? "-"} | credits=${t.creditsDest ?? "-"}(settle=${JSON.stringify(t.creditsSettle)}) | session=${t.sessionDest ?? "-"}/rec=${t.sessionRecDest ?? "-"}/tpc=${t.sessionTripPlanningDest ?? "-"}/pending=${t.sessionPendingKind ?? "-"}:${t.sessionPendingParent ?? ""}:${t.sessionPendingLabel ?? "-"} | clar=${t.clarified ? `Y(${t.copyKind}:${t.clarificationLabel ?? ""})` : "N"} | noResults=${t.noResultsLabel ?? "-"} | cont=${t.continuationDest ?? "-"} | builderText=${t.builderUserText ?? "-"}/${t.builderIntent ?? "-"} | geocode=${t.geocodes.length}[${t.geocodes.join(",")}] | places=${t.placesRequests}[${t.placesQueries.slice(0, 6).join(",")}${t.placesQueries.length > 6 ? ",…" : ""}] | weatherCalls=${t.weatherCalls} builder=${t.builderCalls} credits=${t.creditsBegin} | actPref=${t.activityPreference ?? "-"}${t.builderError ? ` | builderErr=${t.builderError}` : ""}${t.error ? ` | ERR=${t.error}` : ""}`
    : "(turn skipped)";
const totals = {};
const summary = [];
const countOcc = (s, sub) => (sub ? String(s ?? "").split(sub).length - 1 : 0);
for (const s of scenarios) {
  const isT27 = T27_IDS.has(s.id);
  for (const m of MODES) {
    const align = (arr) => {
      const o = [];
      for (const t of arr) o[t.turnIndex] = t;
      return o;
    };
    const Wraw = results[`work|${m.id}|${s.id}`].result.turns;
    const Braw = results[`base|${m.id}|${s.id}`].result.turns;
    const W = align(Wraw);
    const B = align(Braw);
    const tag = `[${s.id}][${m.id}] ${s.label}`;
    totals[m.id] ??= { wg: 0, bg: 0, ww: 0, bw: 0, wb: 0, bb: 0, wp: 0, bp: 0, wc: 0, bc: 0 };
    const tt = totals[m.id];
    const n = Math.max(W.length, B.length);
    const sum = (arr, f) => arr.reduce((a, t) => a + (t ? f(t) : 0), 0);
    const sc = {
      wg: sum(Wraw, (t) => t.geocodes.length),
      bg: sum(Braw, (t) => t.geocodes.length),
      ww: sum(Wraw, (t) => t.weatherCalls),
      bw: sum(Braw, (t) => t.weatherCalls),
      wb: sum(Wraw, (t) => t.builderCalls),
      bb: sum(Braw, (t) => t.builderCalls),
      wp: sum(Wraw, (t) => t.placesRequests),
      bp: sum(Braw, (t) => t.placesRequests),
      wc: sum(Wraw, (t) => t.creditsBegin),
      bc: sum(Braw, (t) => t.creditsBegin),
    };
    for (const k of Object.keys(sc)) tt[k] += sc[k];
    const baseLooped = Braw.some((t, i) => t.clarified && i > 0 && t.path === "clarification_reask");
    const rowStart = rows.length;
    const p1Start = p1.length;
    rows.push(`\n${tag}  [geocode ${sc.wg}/${sc.bg} weather ${sc.ww}/${sc.bw} builder ${sc.wb}/${sc.bb} placesReq ${sc.wp}/${sc.bp} credits ${sc.wc}/${sc.bc}]`);
    for (let i = 0; i < n; i += 1) {
      const w = W[i];
      const b = B[i];
      if (!w && !b) continue;
      rows.push(`  T${i + 1} 「${(w ?? b).text}」`);
      if (w && b) {
        // T27：逐輪 provider 次數（T27 情境原樣）；新情境：base 迴圈且從未搜尋時另列 COST-NOTE
        const costExempt = !isT27 && b.clarified && sc.bb === 0;
        for (const [label, wv, bv] of [["geocode", w.geocodes.length, b.geocodes.length], ["weather", w.weatherCalls, b.weatherCalls], ["Places(builder)", w.builderCalls, b.builderCalls], ["Places(requests)", w.placesRequests, b.placesRequests]]) {
          if (wv > bv) {
            if (label === "Places(requests)" && isT27) {
              // T27 原本沒有此欄位；新增欄位在 T27 情境同樣判 P1（不放寬）
            }
            (costExempt ? costNotes : p1).push(`${tag} T${i + 1} ${label} 次數 work=${wv} > base=${bv}${costExempt ? "（base 本輪澄清迴圈、整個情境從未搜尋）" : ""}`);
          }
        }
      } else if (w && !b && w.geocodes.length) {
        notes.push(`${tag} T${i + 1} work 多出的回答輪 geocode=${w.geocodes.length}（${w.geocodes.join(",")}）`);
      }
      rows.push(`    work: ${fmt(w)}`);
      rows.push(`    base: ${fmt(b)}`);
      if (!w) {
        notes.push(`${tag} T${i + 1} base 有此輪、work 跳過（work 前一輪未澄清）`);
        continue;
      }
      const sameAsBase = (field) => Boolean(b) && (b[field] ?? null) === (w[field] ?? null);
      const flag = (field, msg) => (sameAsBase(field) ? notes.push(`${msg}（與 base 相同，既有行為）`) : p1.push(msg));
      for (const [field, key] of [["search", "searchDest"], ["weather", "weatherDest"], ["credits", "creditsDest"]]) {
        if (!confirmedDest(w[key], m)) flag(key, `${tag} T${i + 1} work ${field} 使用未確認目的地「${w[key]}」`);
      }
      const prevW = W[i - 1];
      if (w.sessionDest !== (prevW?.sessionDest ?? null) && !confirmedDest(w.sessionDest, m)) {
        flag("sessionDest", `${tag} T${i + 1} work Session travelContext.destination 寫入未確認「${w.sessionDest}」`);
      }
      if (w.sessionRecDest !== (prevW?.sessionRecDest ?? null) && !confirmedDest(w.sessionRecDest, m)) {
        flag("sessionRecDest", `${tag} T${i + 1} work Session recommendationSession.destination 寫入未確認「${w.sessionRecDest}」`);
      }
      for (const g of w.geocodes) {
        const [ph, q] = [g.slice(0, g.indexOf(":")), g.slice(g.indexOf(":") + 1)];
        if ((ph === "weather" || ph === "builder") && !confirmedDest(q.split(",")[0].replace(/市$/, ""), m)) {
          const inBase = b?.geocodes.includes(g);
          (inBase ? notes : p1).push(`${tag} T${i + 1} work ${ph} 以未確認字串 geocode「${q}」${inBase ? "（與 base 相同）" : ""}`);
        }
      }
      if (w.continuationDest && prevW) {
        const prevConfirmed = prevW.sessionRecDest ?? prevW.sessionDest;
        if (prevConfirmed && w.continuationDest !== prevConfirmed) p1.push(`${tag} T${i + 1} work Continuation 換城市 ${prevConfirmed} → ${w.continuationDest}`);
      }
      const isAnswer = typeof s.turns[i] === "object" && s.turns[i].onlyIfClarified;
      if (isAnswer && w.clarified) {
        if (b && b.clarified) notes.push(`${tag} T${i + 1} work 與 base 皆澄清迴圈（既有行為；work label=${w.clarificationLabel} base label=${b.clarificationLabel}）`);
        else p1.push(`${tag} T${i + 1} work 澄清迴圈：回答「${w.text}」後再次要求澄清（label=${w.clarificationLabel}）${b ? "" : "；base 首輪未澄清"}`);
      }
      if (w.activityPreference) p1.push(`${tag} T${i + 1} work Session 出現 activityPreference=${w.activityPreference}`);
      if (b) {
        const baseGood = b.searchDest && confirmedDest(b.searchDest, m) && b.builderCalls > 0;
        const workSearched = w.searchDest && w.builderCalls > 0;
        if (baseGood && !workSearched && !w.continuationDest) {
          p1.push(`${tag} T${i + 1} 退步：base 以「${b.searchDest}」搜尋，work ${w.clarified ? `改為澄清(${w.copyKind}:${w.clarificationLabel})` : `未搜尋(path=${w.path})`}`);
        }
        if (baseGood && workSearched && w.searchDest !== b.searchDest) {
          p1.push(`${tag} T${i + 1} 退步/換目的地：base「${b.searchDest}」→ work「${w.searchDest}」`);
        }
        for (const [field, bv, wv] of [["search", b.searchDest, w.searchDest], ["weather", b.weatherDest, w.weatherDest], ["credits", b.creditsDest, w.creditsDest]]) {
          if (bv && !confirmedDest(bv, m) && bv !== wv) {
            diffExpected.push(`${tag} T${i + 1} ${field}: base「${bv}」(未確認) → work「${wv ?? "-"}」${w.clarified ? `（work 澄清：${w.copyKind}:${w.clarificationLabel}）` : ""}`);
          }
        }
        if (w.path.split("|")[0] !== b.path.split("|")[0]) notes.push(`${tag} T${i + 1} path base=${b.path} work=${w.path}`);
        if (b.weatherDest && !w.weatherDest && KNOWN.has(b.weatherDest)) {
          p1.push(`${tag} T${i + 1} Weather 退步：base 以已確認「${b.weatherDest}」取天氣，work 不取`);
        } else if (b.weatherDest && !w.weatherDest && confirmedDest(b.weatherDest, m)) {
          diffExpected.push(`${tag} T${i + 1} weather: base 以 prefetch 當下未驗證的「${b.weatherDest}」取天氣（稍後驗證成功）→ work 不取`);
          ux.push(`${tag} T${i + 1} [第二組] 已驗證行政區首輪沒有天氣（work Weather 在 provider 驗證前執行）`);
        }
        if (w.noResultsLabel === "" && b.noResultsLabel !== "") {
          ux.push(`${tag} T${i + 1} [第二組] work noResults 文案目的地為空字串（base=${b.noResultsLabel ?? "-"}）`);
        }
      }
      if (w.clarified && w.clarificationLabel && /[看玩泛滑潛冷]/.test(w.clarificationLabel)) {
        ux.push(`${tag} T${i + 1} work 澄清文案「${w.copy}」`);
      }

      // ── T28 新增 assertion（所有情境）──
      // 需求 1：已有可信父城市時不得用「哪個地區的 X」
      if (w.clarified && w.copyKind === "whichRegion") {
        const label = w.clarificationLabel ?? "";
        const parent = [...KNOWN].find((p) => label.startsWith(p) && label !== p);
        // 與 base 完全相同的澄清（Authority 既有表格不認得此父城市 → provisional fragment）記為備註
        const sameClar = b && b.clarified && b.copyKind === "whichRegion" && b.clarificationLabel === label;
        if (parent) (sameClar ? notes : p1).push(`${tag} T${i + 1} 需求1：已知父城市「${parent}」仍以「哪個地區的${label}」澄清${sameClar ? "（與 base 相同；Authority 未將其視為可信父城市）" : ""}`);
      }
      if (w.sessionPendingKind === "destination_area" && w.sessionPendingLabel) {
        const parent = [...KNOWN].find((p) => w.sessionPendingLabel.startsWith(p) && w.sessionPendingLabel !== p);
        const samePending = b && b.sessionPendingKind === "destination_area" && b.sessionPendingLabel === w.sessionPendingLabel;
        if (parent) (samePending ? notes : p1).push(`${tag} T${i + 1} 需求2：已知父城市「${parent}」的尾段被存成 destination_area pending（${w.sessionPendingLabel}）${samePending ? "（與 base 相同）" : ""}`);
      }
      // 需求 2：父城市確認的 pending 必須帶 parent，copy 必須是 parentScopeConfirm
      if (w.clarified && w.copyKind === "parentScopeConfirm") {
        if (w.sessionPendingKind !== "parent_city_scope" || !w.sessionPendingParent || w.sessionPendingParent !== w.clarificationLabel) {
          p1.push(`${tag} T${i + 1} 需求2：父城市確認的 pending 不一致 kind=${w.sessionPendingKind} parent=${w.sessionPendingParent} label=${w.clarificationLabel}`);
        }
        if (!KNOWN.has(w.clarificationLabel)) p1.push(`${tag} T${i + 1} 需求1：父城市確認的城市「${w.clarificationLabel}」不是已知城市`);
      }
      // 需求 6：不得產生 rejected
      if (/rejected/.test(w.turnResolution ?? "")) p1.push(`${tag} T${i + 1} 需求6：turn resolution 出現 rejected（${w.turnResolution}）`);
      // 需求 5：回答輪後不得重新建立相同的澄清狀態
      if (w.pendingBefore && w.sessionPendingKind) {
        const after = `${w.sessionPendingKind}:${w.sessionPendingParent ?? ""}:${w.sessionPendingLabel}`;
        if (after === w.pendingBefore) {
          p1.push(`${tag} T${i + 1} 需求5：回答「${w.text}」後 Session 仍保留同一個 pending（${after}；${w.clarified ? "本輪重新建立" : "未清除"}）`);
        }
      }
      // 父城市重複串接（任何搜尋／geocode／places／Session／noResults 欄位）
      for (const p of KNOWN) {
        const fields = [
          w.searchDest,
          w.weatherDest,
          w.creditsDest,
          w.sessionDest,
          w.sessionRecDest,
          w.noResultsLabel,
          w.builderUserText,
          ...w.geocodes.map((g) => g.slice(g.indexOf(":") + 1)),
          ...w.placesQueries.flatMap((q) => [q.slice(0, q.lastIndexOf("@")), q.slice(q.lastIndexOf("@") + 1)]),
        ];
        // 串接＝父城市緊鄰重複（例：京都京都看楓葉、京都 京都）；geocode 的「奈良市, 奈良県, 日本」格式不算
        const dup = new RegExp(`${p}[\\s,，、]*${p}(?![市県縣都府])`);
        const hit = fields.find((f) => countOcc(f, p) >= 2 && dup.test(String(f ?? "")) && !/東京都/.test(String(f)));
        if (hit) p1.push(`${tag} T${i + 1} 父城市重複串接「${p}」：${String(hit).slice(0, 80)}`);
      }
    }

    // ── 情境級 expect（T28 新情境）──
    const e = s.expect;
    if (e) {
      const raw = e.raw;
      const parent = e.parent;
      const tail = raw && parent && raw.startsWith(parent) ? raw.slice(parent.length) : null;
      if (e.parentAsk) {
        const w = W[e.parentAsk.turn];
        if (w?.clarified) {
          if (w.copyKind !== "parentScopeConfirm" || w.clarificationLabel !== e.parentAsk.parent || w.sessionPendingKind !== "parent_city_scope") {
            p1.push(`${tag} T${e.parentAsk.turn + 1} 需求1/2：應為父城市範圍確認(${e.parentAsk.parent})，實際 ${w.copyKind}:${w.clarificationLabel} pending=${w.sessionPendingKind}`);
          }
        } else if (w) {
          const searchedParent = w.searchDest === e.parentAsk.parent;
          (searchedParent ? notes : p1).push(`${tag} T${e.parentAsk.turn + 1} 需求1：未詢問父城市範圍確認（search=${w.searchDest ?? "-"} path=${w.path}）${searchedParent ? "；直接以已確認父城市搜尋" : ""}`);
        }
        if (w?.searchDest && raw && w.searchDest.includes(raw)) p1.push(`${tag} T${e.parentAsk.turn + 1} 需求6：未確認整串「${raw}」被當成搜尋目的地`);
      }
      if (e.confirm) {
        const i = e.confirm.turn;
        const w = W[i];
        const askTurn = W[e.parentAsk?.turn ?? i - 1];
        if (!w) {
          if (askTurn?.clarified) p1.push(`${tag} T${i + 1} 回答輪缺失`);
        } else {
          if (w.clarified) p1.push(`${tag} T${i + 1} 需求5：確認後再次澄清（${w.copyKind}:${w.clarificationLabel}）`);
          if (w.searchDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：確認後沒有用父城市「${e.confirm.parent}」搜尋（search=${w.searchDest ?? "-"} path=${w.path}）`);
          if (w.builderCalls < 1) p1.push(`${tag} T${i + 1} 需求3：確認後沒有呼叫 Places builder（path=${w.path}）`);
          if (w.creditsDest && w.creditsDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Credits metadata.destination=${w.creditsDest}`);
          if (w.weatherDest && w.weatherDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Weather=${w.weatherDest}`);
          if (m.search === "ok" && w.sessionDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Session destination=${w.sessionDest ?? "-"}（應為 ${e.confirm.parent}）`);
          if (m.search === "ok" && w.sessionRecDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Session recommendation destination=${w.sessionRecDest ?? "-"}`);
          if (w.sessionPendingKind) p1.push(`${tag} T${i + 1} 需求5：確認後 pending 未清除（${w.sessionPendingKind}）`);
          if (w.noResultsLabel && w.noResultsLabel !== e.confirm.parent) p1.push(`${tag} T${i + 1} noResults 目的地=${w.noResultsLabel}`);
          for (const q of [...w.placesQueries, ...w.geocodes]) {
            if (raw && q.includes(raw)) p1.push(`${tag} T${i + 1} 需求3：未確認整串「${raw}」進入 Google：${q}`);
            else if (tail && q.includes(tail)) p1.push(`${tag} T${i + 1} 需求3：未確認尾段「${tail}」進入 Google：${q}`);
          }
          // 需求 4：原始需求保留（意圖與原句／餐別例外）
          const original = askTurn?.sessionPendingOriginal ?? null;
          if (askTurn?.sessionPendingKind === "parent_city_scope") {
            const origIntentTurn = askTurn;
            if (w.builderIntent == null) p1.push(`${tag} T${i + 1} 需求4：確認後 builder 沒有收到意圖`);
            if (w.builderUserText !== original && !(w.builderUserText ?? "").startsWith(e.confirm.parent)) {
              p1.push(`${tag} T${i + 1} 需求4：確認後 userText「${w.builderUserText}」既不是原句「${original}」也不是父城市需求句`);
            }
            if (w.builderUserText !== original) notes.push(`${tag} T${i + 1} 需求4：確認後 userText 改為「${w.builderUserText}」（原句「${original}」）`);
            void origIntentTurn;
          }
        }
      }
      if (e.cleared) {
        const i = e.cleared.turn;
        const w = W[i];
        if (w) {
          if (w.sessionPendingKind && `${w.sessionPendingKind}:${w.sessionPendingParent ?? ""}:${w.sessionPendingLabel}` === w.pendingBefore) {
            p1.push(`${tag} T${i + 1} 需求5：否定／無法解析後 Session 仍保留原 pending（${w.pendingBefore}）`);
          }
          if (w.clarified && w.sessionPendingKind && (w.sessionPendingLabel === raw || w.sessionPendingParent === e.cleared.parent) && !/大阪/.test(w.text)) {
            p1.push(`${tag} T${i + 1} 需求5：同一回合重新建立澄清（${w.copyKind}:${w.clarificationLabel}）`);
          }
          if (e.cleared.parent && w.searchDest === e.cleared.parent && !w.text.includes(e.cleared.parent)) {
            p1.push(`${tag} T${i + 1} 需求5：否定／無法解析仍以「${e.cleared.parent}」搜尋`);
          }
          if (w.searchDest && raw && w.searchDest.includes(raw)) p1.push(`${tag} T${i + 1} 需求6：未確認整串被搜尋`);
        }
      }
      if (e.area) {
        const w = W[e.area.turn];
        if (!w) p1.push(`${tag} T${e.area.turn + 1} 需求9：沒有出現回答輪（首輪未澄清）`);
        else {
          if (w.clarified) p1.push(`${tag} T${e.area.turn + 1} 需求9：回答後再次澄清（${w.copyKind}:${w.clarificationLabel}）`);
          if (w.sessionPendingKind) p1.push(`${tag} T${e.area.turn + 1} 需求9：回答後 pending 未清除`);
          if (m.geo === "ok" && (w.searchDest !== e.area.dest || w.builderCalls < 1)) {
            p1.push(`${tag} T${e.area.turn + 1} 需求9：ok 模式未以「${e.area.dest}」推薦（search=${w.searchDest ?? "-"} path=${w.path}）`);
          }
          if (m.geo !== "ok" && !w.searchDest) notes.push(`${tag} T${e.area.turn + 1} 需求9：provider 失敗模式回答後未搜尋（noResults=${w.noResultsLabel ?? "-"}；base search=${B[e.area.turn]?.searchDest ?? "-"}）`);
        }
      }
      for (const c of e.search ?? []) {
        const w = W[c.turn];
        if (!w || w.searchDest !== c.dest) p1.push(`${tag} T${c.turn + 1} 應搜尋「${c.dest}」，實際 search=${w?.searchDest ?? "-"} path=${w?.path ?? "(skipped)"}`);
        if (w && m.search === "ok" && w.sessionDest !== c.dest) p1.push(`${tag} T${c.turn + 1} Session 跨城市：session=${w.sessionDest ?? "-"}（應為 ${c.dest}）`);
        if (w) {
          for (const f of [w.weatherDest, w.creditsDest, w.sessionRecDest, ...w.placesQueries]) {
            if (f && parent && parent !== c.dest && String(f).includes(parent) && m.search === "ok") p1.push(`${tag} T${c.turn + 1} Session 跨城市污染：「${parent}」出現在 ${String(f).slice(0, 60)}`);
          }
        }
      }
      for (const c of e.notSearch ?? []) {
        const w = W[c.turn];
        if (w && (w.searchDest === c.dest || w.continuationDest === c.dest)) {
          p1.push(`${tag} T${c.turn + 1} 需求5/跨城市：舊 pending／舊城市復活，以「${c.dest}」搜尋（path=${w.path} pendBefore=${w.pendingBefore ?? "-"}）`);
        }
      }
      for (const c of e.cont ?? []) {
        const w = W[c.turn];
        if (!w || w.continuationDest !== c.dest) p1.push(`${tag} T${c.turn + 1} Continuation 目的地應為「${c.dest}」，實際 ${w?.continuationDest ?? "-"}（path=${w?.path ?? "(skipped)"}）`);
      }
      // noUnconfirmed：整個情境任何一輪的搜尋／續推／天氣／Credits／geocode／Places query 都不得含未確認整串（不以 base 相同豁免）
      if (e.noUnconfirmed && raw) {
        W.forEach((w, i) => {
          if (!w) return;
          const fields = [
            ["search", w.searchDest],
            ["continuation", w.continuationDest],
            ["weather", w.weatherDest],
            ["credits", w.creditsDest],
            ...w.geocodes.filter((g) => !g.startsWith("dc_validate:")).map((g) => ["geocode", g]),
            ...w.placesQueries.map((q) => ["places", q]),
          ];
          for (const [k, v] of fields) {
            if (v && String(v).includes(raw)) p1.push(`${tag} T${i + 1} 需求3/6：未確認整串「${raw}」進入 ${k}：${String(v).slice(0, 80)}（path=${w.path}）`);
          }
        });
      }
      // 需求 7（情境總數）：新情境 work 總 geocode / Places 不得多於 base（base 迴圈且從未搜尋者另列）
      for (const [label, wv, bv] of [["geocode", sc.wg, sc.bg], ["Places(builder)", sc.wb, sc.bb], ["Places(requests)", sc.wp, sc.bp]]) {
        if (wv > bv) (sc.bb === 0 ? costNotes : p1).push(`${tag} 情境總 ${label} work=${wv} > base=${bv}${sc.bb === 0 ? `（base 整個情境從未呼叫 Places${baseLooped ? "，且澄清迴圈" : ""}）` : ""}`);
      }
    }
    if (s.id === "14") {
      const w = W[0];
      const b = B[0];
      if (w.path !== b.path) p1.push(`${tag} Planner path 改變 base=${b.path} work=${w.path}`);
      if ((w.weatherDest ?? null) !== (b.weatherDest ?? null)) notes.push(`${tag} Planner weather base=${b.weatherDest ?? "-"} work=${w.weatherDest ?? "-"}`);
    }
    // 逐輪明細只輸出：有 P1 的情境模式、或 --rows= 指定的情境（其餘以摘要列呈現）
    if (p1.length === p1Start && !(ROWS_ALL || ROWS?.has(s.id))) rows.length = rowStart;
    // 摘要列
    const short = (t) => (t ? `${t.clarified ? `澄清(${t.copyKind}:${t.clarificationLabel})` : t.searchDest ? `搜尋${t.searchDest}` : t.continuationDest ? `續推${t.continuationDest}` : t.noResultsLabel != null ? `noResults(${t.noResultsLabel})` : t.path.slice(0, 30)}` : "—");
    summary.push(`${tag.padEnd(40)} W: ${W.map(short).join(" → ")} || B: ${B.map(short).join(" → ")}`);
  }
}

const out = [];
out.push("══ source anchors（重建對照行號）══", ...anchorLines);
out.push("\n══ 模組依賴圖 ══", ...graphReport);
out.push("\n══ base/work 逐情境逐輪對照（每情境 6 種 provider 模式）══", ...rows);
out.push("\n══ 情境摘要（W=work / B=base）══", ...summary);
out.push("\n══ Provider 呼叫總數（work / base）══");
for (const [mid, t] of Object.entries(totals)) {
  out.push(`${mid.padEnd(9)} geocode ${t.wg}/${t.bg}  weather ${t.ww}/${t.bw}  builder(Places) ${t.wb}/${t.bb}  placesRequests ${t.wp}/${t.bp}  credits.begin ${t.wc}/${t.bc}`);
}
out.push("\n══ 外部請求攔截 ══");
out.push(`fetch=${extTotals.fetch} http=${extTotals.http} https=${extTotals.https} net=${extTotals.net} tls=${extTotals.tls} undici=${extTotals.undici}  undici 可載入=${undiciLoadedAll}  mockKey=${mockKeyOk ? "OK" : "FAIL"}  子程序清除的金鑰類變數=${envScrubbedAny.size ? [...envScrubbedAny].join(",") : "(none)"}`);
out.push(...(extHits.length ? extHits.slice(0, 40) : ["(no external request)"]));
if (!mockKeyOk) p1.push("子程序 Mock Key 未生效");
for (const h of extHits) p1.push(h);
const uniq = (a) => [...new Set(a)];
out.push("\n══ P1 ══", ...(uniq(p1).length ? uniq(p1) : ["(none)"]));
out.push("\n══ COST-NOTE（新情境：base 澄清迴圈、從未搜尋，work 完成推薦而多出的呼叫）══", ...(uniq(costNotes).length ? uniq(costNotes) : ["(none)"]));
const BRIEF = process.argv.includes("--brief");
out.push("\n══ DIFF-expected（base 使用未確認目的地，work 不再使用）══", ...(BRIEF ? [`(brief) ${uniq(diffExpected).length} 條`] : uniq(diffExpected).length ? uniq(diffExpected) : ["(none)"]));
out.push("\n══ UX 風險 ══", ...(uniq(ux).length ? uniq(ux) : ["(none)"]));
out.push("\n══ 其他差異／備註 ══", ...(BRIEF ? uniq(notes).filter((x) => /需求|base 有此輪|迴圈/.test(x)) : uniq(notes).length ? uniq(notes) : ["(none)"]));
out.push(`\n情境=${scenarios.length}（T27=${scenarios.filter((s) => T27_IDS.has(s.id)).length} 新增=${scenarios.filter((s) => !T27_IDS.has(s.id)).length}） 模式=${MODES.length} 工作=${jobs.length}`);
out.push(`verify-destination-authority-phase2-r2: P1=${uniq(p1).length} COST-NOTE=${uniq(costNotes).length} DIFF-expected=${uniq(diffExpected).length} UX=${uniq(ux).length} external=${extHits.length} → ${uniq(p1).length ? "FAIL" : "PASS"}`);
await new Promise((resolve) => process.stdout.write(`${out.join("\n")}\n`, resolve));
process.exit(uniq(p1).length ? 1 : 0);
