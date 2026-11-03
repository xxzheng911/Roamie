#!/usr/bin/env node
/**
 * T27 — Phase 2 Step 5 獨立驗收：正式 Chat 接上 Destination Resolution Authority 後的 send 主流程比較。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-authority-phase2.mjs --config scripts/vite.verify.config.mjs
 *
 * 機制：
 *  - main 角色依 (tree × provider mode × scenario) 各起一個 collect 子行程（cwd=該樹、該樹的 vite config），
 *    每個情境都是乾淨的模組狀態（模組內 cache 不跨情境洩漏）。
 *  - collect 角色以「該樹自己的 lib 函式」照該樹 _app.chat.tsx 的呼叫順序重建 send 主流程中與目的地相關的部分。
 *    work / base 的分歧只發生在 diff 位置（見 IS_WORK 分支，註解附兩邊行號）。main 會先做 source anchor 檢查，
 *    確認兩邊 _app.chat.tsx 真的含有被重建的呼叫，否則 INFRA-FAIL。
 *  - geocodeLocationFn／fetchWeather／Places（builder 以 spy 取代）／Credits 全部 mock + 計數；
 *    globalThis.fetch 為 trap，任何真實網路呼叫都會使該情境 INFRA-FAIL。不使用 API Key、不產生 Google 費用。
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DEFAULT_BASE_ROOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const ROLE = process.env.VERIFY_P2_ROLE ?? "main";
const BASE_ROOT = process.env.VERIFY_P2_BASE_ROOT || DEFAULT_BASE_ROOT;
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2.mjs`;
const LOCALE = "zh-TW";

// ════════════════════════ provider mock（兩樹共用；依 query 決定回應）════════════════════════
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
// 依 Google 實際行為建模：行政區回 district/sublocality；POI 回所在行政區＋POI 名稱；活動字串回父城市。
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
  // Google 找不到尾巴時退回父城市（城市層級，無 district）。
  const parent = PARENTS.filter((p) => q.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  const label = parent ?? q;
  return LOC({ country: /台|花蓮|新竹|南投|埔里/.test(label) ? "台灣" : label === "香港" ? "香港" : "日本", city: label, region: label, formattedName: label });
}

// ════════════════════════ collect（子行程）════════════════════════
if (ROLE === "collect") {
  let fetchCalls = 0;
  const fetchLog = [];
  globalThis.fetch = async (...args) => {
    fetchCalls += 1;
    fetchLog.push(String(args[0]).slice(0, 160));
    throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
  };
  const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug, error: console.error };
  for (const k of Object.keys(orig)) console[k] = () => {};

  const ROOT = process.env.VERIFY_ROOT;
  const GEO_MODE = process.env.VERIFY_P2_GEO ?? "ok";
  const SEARCH_MODE = process.env.VERIFY_P2_SEARCH ?? "ok";
  const SCENARIO = JSON.parse(process.env.VERIFY_P2_SCENARIO ?? "{}");
  const imp = (p) => import(`${ROOT}/src/${p}`);
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
  };
  const IS_WORK = typeof M.catDest.resolveCategoryTurnDestination === "function";

  // ── provider spies ──
  let phase = "init";
  const geocodes = [];
  const weatherCalls = [];
  const builderCalls = [];
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
  // Places builder（chat-destination-category-recommendation.ts，兩樹相同）：保留其第一步 geocodeDestinationWithFallback，
  // Places 查詢以 spy 取代（SEARCH_MODE 決定結果有無）。
  const buildDestinationCategoryRecommendationsSpy = async ({ destination, intents, context }) => {
    builderCalls.push({ destination, intents, ctxDestination: context?.destination ?? null });
    const prev = phase;
    phase = "builder_geocode";
    try {
      await M.geo.geocodeDestinationWithFallback({ destination: M.tpc.normalizeDestinationLabel(destination), locale: LOCALE, geocodeFn });
    } catch {
      /* builder 內部 */
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
    return { summary: "mock", recommendations, payload: { title: "t", summary: "mock", recommendations, itinerary: [] }, contextPatch: {}, searchCentroid: undefined, usedQueries: [] };
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
    } catch (e) {
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

  // 每一輪的觀測紀錄
  function newTurnObs(text) {
    return {
      text,
      path: "",
      route: null,
      dcCalled: false,
      dispatchDest: null, // send 內 [CHAT_INTENT_ROUTED] destination（work: turnDestination.destination；base: resolveDestinationForCategorySearch）
      turnResolution: null, // work only：confidence/source
      searchDest: null,
      weatherDest: null,
      creditsDest: null,
      clarified: false,
      clarificationLabel: null,
      noResultsLabel: null,
      continuationDest: null,
      sessionDest: null,
      sessionRecDest: null,
      sessionPendingLabel: null,
      activityPreference: null,
      geocodes: [],
      weatherCalls: 0,
      builderCalls: 0,
      creditsBegin: 0,
      creditsSettle: [],
      error: null,
    };
  }

  let persisted = baseSession();
  let msgs = [];
  // App 重新載入（sessionStorage 還原 Session、模組內 cache 清空）：由 main 傳入前一個子行程的 Session。
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

  // ── pushDestinationCategoryPlaceRecommendation（work 5627-6097 / base 5626-6073）──
  async function pushDC(obs, activeSession, userText, conversation, opts) {
    obs.dcCalled = true;
    if (M.chatIntent.userExplicitlyWantsNearbyPlaces(userText)) return false; // w5641 / b5635
    const merged = M.tc.mergeTravelContext(activeSession, userText); // w5642 / b5636
    const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, activeSession); // w5643 / b5637
    const intents = M.placeIntent.parseChatPlaceIntents(userText); // w5658 / b5652
    if (!intents.length) {
      obs.path += "|dc_no_intents";
      return false;
    }
    let destination;
    let persistedAreaScope;
    phase = "dc_validate";
    if (IS_WORK) {
      // w5662-5671
      const turnDestination = await M.catDest.validateCategoryTurnDestination(
        opts?.turnDestination ??
          M.catDest.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText, locale: LOCALE }),
        { locale: LOCALE, geocodeFn },
      );
      obs.turnResolution = `${turnDestination.confidence}/${turnDestination.source}${turnDestination.providerValidation ? `/${turnDestination.providerValidation}` : ""}`;
      // w5674-5678
      const clarificationLabel =
        !turnDestination.destination && (turnDestination.provisionalCandidate || turnDestination.areaCandidate)
          ? (turnDestination.provisionalCandidate?.areaCandidate ?? turnDestination.rawLabel)
          : undefined;
      if (clarificationLabel) {
        // w5679-5719
        obs.clarified = true;
        obs.clarificationLabel = clarificationLabel;
        const copy = `你指的是哪個地區的${clarificationLabel}？`;
        const clarificationMsgs = [...conversation, { role: "assistant", content: copy }];
        const sessionDestinationForClarification = M.catDest.confirmedContextDestination(
          activeSession.travelContext ?? { interests: [] },
          activeSession,
        )?.destination;
        persistSession(
          {
            ...merged.session,
            travelContext: merged.session.travelContext
              ? { ...merged.session.travelContext, destination: sessionDestinationForClarification }
              : merged.session.travelContext,
            pendingClarification: M.geoClar.buildPendingGeographicClarification({
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
      destination = turnDestination.destination; // w5721
      if (!destination) {
        phase = "post";
        obs.path += "|dc_no_destination";
        return false;
      }
      persistedAreaScope = turnDestination.geographicScope?.searchScope === "area" ? turnDestination.geographicScope : null; // w5723-5726
    } else {
      // b5654-5702
      const provisionalArea = M.dtp.extractProvisionalDestinationAreaCandidate(userText);
      const validatedAreaScope = await M.dtp.resolveValidatedDestinationAreaScope({ input: userText, locale: LOCALE, geocodeFn });
      if (provisionalArea && !validatedAreaScope) {
        obs.clarified = true;
        obs.clarificationLabel = provisionalArea.areaCandidate;
        const copy = `你指的是哪個地區的${provisionalArea.areaCandidate}？`;
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
    // w5731-5743 / b5707-5719
    const gate = await beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "destination_category", destination, intents } });
    obs.creditsDest = destination;
    let handle = gate.handle;
    try {
      // w5747-5762 / b5723-5738
      obs.searchDest = destination;
      const { recommendations, contextPatch } = await buildDestinationCategoryRecommendationsSpy({
        destination,
        intents,
        userText,
        context: { ...placeCtx, destination },
      });
      if (!recommendations.length) {
        await settleCreditsOperation(handle, false); // w5765
        handle = null;
        return false;
      }
      const categoryIntent = intents[0];
      const displayBatchSize = M.crs.DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE ?? 3;
      // w5822-5841（只保留目的地相關欄位）
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
      // w5895-5925
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
      // w5962-5995
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
      // w6065-6073
      persistSession(
        safe(() => M.ppm.syncSessionPlaceMemory({ ...sessionWithRecs, recommendedPlaces: recs, pendingClarification: undefined }), {
          ...sessionWithRecs,
          recommendedPlaces: recs,
        }),
        nextMsgs,
      );
      await settleCreditsOperation(handle, true); // w6087
      handle = null;
      return true;
    } catch (error) {
      await settleCreditsOperation(handle, false); // w6091
      obs.error = `dc_throw:${error?.message ?? error}`;
      return false;
    }
  }

  // ── send（work 7541- / base 7517-）──
  async function send(obs, text) {
    const trimmed = text.trim();
    let session = persisted;
    // w7636-7639
    if (M.gph.isExplicitTripCreationTurn(trimmed) || M.chatSession.isUserConfirmingItinerary(trimmed)) {
      session = M.gph.beginTripCreation(session, M.chatSession.isUserConfirmingItinerary(trimmed) ? "confirmed_create" : "direct_itinerary_create");
    }
    if (M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed)) {
      obs.path = "explicit_nearby(未重建)";
      return;
    }
    // w8442-8450
    let nextSession = M.tripIntent.applyTripIntentToSession(trimmed, session);
    nextSession = M.chatIntent.applyQuickChipContext(trimmed, nextSession); // w8471
    nextSession = M.dining.applyDiningContextFromText(trimmed, nextSession); // w8472
    // w8569-8576
    const createArbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
    obs.route = createArbitration.route;
    nextSession = M.cca.applyChatCreateAuthority(nextSession, createArbitration, /(?:預覽|预览|preview|プレビュー|미리보기)/i.test(trimmed));
    const lastAssistantReply = [...msgs].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content;
    nextSession = M.convState.prepareSessionForUserTurn(nextSession, lastAssistantReply); // w8590

    // w8593-8663：pending geographic clarification
    const pendingGeographic = nextSession.pendingClarification;
    if (pendingGeographic?.kind === "destination_area") {
      if (M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed)) {
        nextSession = { ...nextSession, pendingClarification: undefined };
      } else {
        const restored = M.geoClar.restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);
        const next = [...msgs, { role: "user", content: trimmed }];
        if (restored) {
          obs.path = `clarification_answer(restored=${restored.restoredUserText})`;
          const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: restored.restoredUserText, session: nextSession, restored });
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, pendingClarification: undefined, activeCategoryIntent: restored.categoryIntent },
            explicitScope ?? { destination: restored.destinationLabel, parentCity: restored.parentCity, area: restored.area, searchScope: restored.searchScope },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDC(obs, sessionForRec, restored.restoredUserText, next); // w8625（未傳 turnDestination）
          if (applied) return;
          obs.noResultsLabel = restored.destinationLabel;
          const emptyMsgs = [...next, { role: "assistant", content: `noResults:${restored.destinationLabel}` }];
          persistSession(sessionForRec, emptyMsgs);
          return;
        }
        obs.path = "clarification_reask";
        obs.clarified = true;
        obs.clarificationLabel = pendingGeographic.rawGeographicLabel;
        persistSession(nextSession, [...next, { role: "assistant", content: `你指的是哪個地區的${pendingGeographic.rawGeographicLabel}？` }]);
        return;
      }
    }
    if (M.cps.isReplanIntent(trimmed)) nextSession = M.cps.resetChatPlanningForReplan(nextSession, "user_replan_intent"); // w8665
    // w8687-8696
    const merged = M.tc.mergeTravelContext(nextSession, trimmed, lastAssistantReply);
    nextSession = merged.session;
    // w8699-8712（global candidate）
    let providerResolvedTurnDestination;
    if (merged.context.destinationCandidate?.status === "pending") {
      phase = "global_candidate";
      nextSession = await M.gpc.resolveGlobalPlanningCandidate(nextSession, LOCALE, async (query) => {
        const response = await geocodeFn({ data: { query, destinationName: query, locale: LOCALE, disableLocaleRegionBias: true, placesFallback: false } });
        return { location: response.location, rawResultCount: response.providerResult.rawResultCount };
      });
      phase = "post";
      merged.session = nextSession;
      merged.context = nextSession.travelContext ?? merged.context;
      if (IS_WORK && merged.context.destinationCandidate?.status === "resolved") {
        providerResolvedTurnDestination = merged.context.destination; // w8709-8711
      }
    }
    // w8713-8719
    if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
      obs.path = "advice_clarification(destinationCandidate)";
      obs.clarified = true;
      persistSession(nextSession, [...msgs, { role: "user", content: trimmed }, { role: "assistant", content: "advice" }]);
      return;
    }
    if (M.budget.isBudgetRefinementText(trimmed)) {
      nextSession = M.budget.applyBudgetRefinementToSession(trimmed, { ...nextSession, travelContext: merged.context }); // w8720
    }
    nextSession = M.tpc.mergeTripPlanningContext(trimmed, nextSession, merged.context).session; // w8726-8736
    // w8805-8819
    const destCandidate =
      merged.context.destination?.trim() || nextSession.tripDestination?.displayLabel?.trim() || nextSession.tripDestination?.city?.trim();
    const isTripStyleSelection =
      nextSession.pendingQuestion?.type === "ask_trip_style" ||
      (M.tripStyle.parseAskTripStyleSelection(trimmed) != null && !M.numSel.rejectNumericSelection(nextSession, trimmed));
    if (!isTripStyleSelection) {
      if (nextSession.phase === "done") nextSession = M.aps.startNewPlanningSession(nextSession, "phase_done");
      else if (M.aps.shouldStartNewPlanningSession(nextSession, destCandidate)) nextSession = M.aps.startNewPlanningSession(nextSession, "destination_change");
    }
    // w8821-8931
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
        obs.path = "planning_candidate_context_clarification";
        return;
      }
      if (delta?.acceptRemainingCandidates === true) {
        obs.path = "accept_remaining(未重建)";
        return;
      }
    } catch (e) {
      obs.path = `planning_constraint_throw:${e?.message ?? e}`;
      return;
    }
    // w8967-9008
    if (M.cps.isStyleReselectTurn(trimmed, nextSession, merged.context)) {
      obs.path = "style_reselect(未重建)";
      return;
    }
    const stylePlanTurn = M.cps.shouldTriggerTripStylePlanning(trimmed, nextSession, merged.context);
    if (stylePlanTurn && (nextSession.pendingQuestion?.type === "ask_trip_style" || nextSession.chatPlanningState === "waitingStyleSelection")) {
      obs.path = "trip_style_advice(未重建)";
      return;
    }
    // w9011 / w9094
    if (M.addAll.isAddAllToTripIntent(trimmed)) {
      obs.path = "add_all_to_trip(未重建)";
      return;
    }
    if (M.refresh.shouldAcceptAlternativeRecommendations(msgs, trimmed)) {
      obs.path = "alternative_recommendations(未重建)";
      return;
    }
    // w9158-9487：continuation（程式碼未改）。只記錄沿用的目的地。
    if (M.refresh.shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)) {
      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      const destForMore =
        nextSession.activeRecommendationContext?.destinationName ||
        nextSession.recommendationSession?.destination ||
        nextSession.travelContext?.destination ||
        nextSession.tripPlanningContext?.destination ||
        nextSession.tripDestination?.city;
      obs.path = `continuation:${arbitration.route}`;
      obs.continuationDest = destForMore ?? null;
      obs.searchDest = destForMore ?? null;
      return;
    }
    // w9489-9498
    const placeFetchContext = M.mvp.mergeContextForPlaceFetch(merged.context, nextSession);
    let turnDestination;
    if (IS_WORK) {
      turnDestination = M.catDest.resolveCategoryTurnDestination({
        ctx: placeFetchContext,
        session: nextSession,
        userText: trimmed,
        locale: LOCALE,
        providerResolvedTurnDestination,
      });
      obs.turnResolution = `${turnDestination.confidence}/${turnDestination.source}`;
    }
    // weather：w9501-9522 / b9461-9479
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
    // w9524-9547
    const refreshedPlaceCtx = M.mvp.mergeContextForPlaceFetch(nextSession.travelContext ?? merged.context, nextSession);
    if (M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
      obs.path = "destination_places(未改，未重建 push)";
      obs.searchDest = refreshedPlaceCtx.destination ?? null;
      return;
    }
    // w9549-9567
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
      // w9579-9631 / b9536-9590
      obs.path = "destination_category";
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
      msgs = [...next, { role: "assistant", content: `noResults:${destLabel}` }];
      return;
    }
    // w9634-9756（refinement → NEW_RECOMMENDATION → pushDC）
    if (M.refine.shouldSkipTripPlanningForRefinement(trimmed, nextSession)) {
      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      obs.path = `refinement:${arbitration.route}`;
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
      // w9782-9800 firstTurnNewRecommendation（pushRecommendationRefinement 未重建）
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
    obs.path = `later:${earlyRouteAuthority}(未重建；planner/advice/nearby 下游)`;
    // 下游（planner/advice）未重建；以「保存本輪 nextSession」近似其 persistSession（兩樹相同處理）。
    persistSession(nextSession, [...next, { role: "assistant", content: "later" }]);
  }

  const result = { isWork: IS_WORK, turns: [] };
  try {
    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {
      const t = typeof turn === "string" ? { text: turn } : turn;
      if (t.onlyIfClarified) {
        const last = result.turns.at(-1);
        if (!last || !last.clarified) continue;
      }
      // geocode cache 在同一情境的多輪之間保留（與 App 相同）；不同情境是不同子行程。
      const obs = newTurnObs(t.text);
      obs.turnIndex = turnIndex + TURN_OFFSET;
      const g0 = geocodes.length;
      const w0 = weatherCalls.length;
      const b0 = builderCalls.length;
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
      obs.weatherCalls = weatherCalls.length - w0;
      obs.builderCalls = builderCalls.length - b0;
      obs.creditsBegin = creditsBegin.length - c0;
      obs.creditsSettle = creditsSettle.slice(s0);
      obs.sessionDest = persisted.travelContext?.destination ?? null;
      obs.sessionRecDest = persisted.recommendationSession?.destination ?? persisted.activeRecommendationContext?.destinationName ?? null;
      obs.sessionTripPlanningDest = persisted.tripPlanningContext?.destination ?? null;
      obs.sessionPendingLabel = persisted.pendingClarification?.rawGeographicLabel ?? null;
      const ap = JSON.stringify(persisted).match(/"activityPreference":"([^"]*)"/);
      obs.activityPreference = ap ? ap[1] : null;
      // 若 send 沒有 persist（例如 noResults），msgs 仍需記錄使用者訊息
      if (!msgs.length || msgs.at(-1)?.content !== obs.text) {
        /* msgs 已在各分支更新 */
      }
      result.turns.push(obs);
    }
  } catch (e) {
    result.error = `THROW:${e?.message ?? e}`;
  }
  for (const k of Object.keys(orig)) console[k] = orig[k];
  result.final = { persisted, msgs };
  await new Promise((resolve) =>
    process.stdout.write(`\n@@P2_JSON@@${JSON.stringify({ result, fetchCalls, fetchLog })}\n`, resolve),
  );
  process.exit(0);
}

// ════════════════════════ main ════════════════════════
const { existsSync, readFileSync } = await import("node:fs");
const { spawn } = await import("node:child_process");

// ── source anchors：確認重建的呼叫確實存在於各自的 _app.chat.tsx ──
const ANCHORS = {
  work: [
    "const turnDestination = await validateCategoryTurnDestination(",
    "opts?.turnDestination ??",
    "(turnDestination.provisionalCandidate?.areaCandidate ?? turnDestination.rawLabel)",
    "const sessionDestinationForClarification = confirmedContextDestination(",
    "const destination = turnDestination.destination;",
    "providerResolvedTurnDestination = merged.context.destination;",
    "const turnDestination = resolveCategoryTurnDestination({",
    "destination: turnDestination.destination,\n          locale,\n          geocodeFn: geocodeLocationFn,\n          fetchWeatherFn: fetchWeather,",
    "const dest = turnDestination.destination ?? \"\";",
    "{ turnDestination },",
    "const restored = restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);",
    "metadata: { path: \"destination_category\", destination, intents },",
  ],
  base: [
    "const provisionalArea = extractProvisionalDestinationAreaCandidate(userText);",
    "const validatedAreaScope = await resolveValidatedDestinationAreaScope({",
    "const destination = validatedAreaScope?.displayLabel ?? baseDestination;",
    "destination: placeFetchContext.destination,\n          locale,\n          geocodeFn: geocodeLocationFn,\n          fetchWeatherFn: fetchWeather,",
    "resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? \"\";",
    "const restored = restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);",
    "metadata: { path: \"destination_category\", destination, intents },",
  ],
};
const anchorFail = [];
for (const [tree, root] of [["work", WORK_ROOT], ["base", BASE_ROOT]]) {
  const p = `${root}/src/routes/_app.chat.tsx`;
  if (!existsSync(p)) {
    anchorFail.push(`${tree}: missing ${p}`);
    continue;
  }
  const src = readFileSync(p, "utf8");
  for (const a of ANCHORS[tree]) if (!src.includes(a)) anchorFail.push(`${tree}: anchor missing → ${a.split("\n")[0]}`);
}
if (anchorFail.length) {
  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\n"));
  process.exit(1);
}

// ── 情境 ──
const ANS = (text) => ({ text, onlyIfClarified: true });
const SCENARIOS = [
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
  // App 重新載入後（Session 由 storage 還原；模組內驗證 cache 清空）
  { id: "R1", label: "重新載入後 台中西屯美食→推薦咖啡廳", turns: ["台中西屯美食", "推薦咖啡廳"], reloadAfter: 0 },
  { id: "R2", label: "重新載入後 香港跑馬地美食→推薦景點", turns: ["香港跑馬地美食", "推薦景點"], reloadAfter: 0 },
  { id: "R3", label: "重新載入後 京都推薦景點→推薦咖啡廳（對照）", turns: ["京都推薦景點", "推薦咖啡廳"], reloadAfter: 0 },
  { id: "R4", label: "重新載入後 台中西屯美食→再推薦幾個", turns: ["台中西屯美食", "再推薦幾個"], reloadAfter: 0 },
  { id: "R5", label: "重新載入後 我想去里斯本→推薦景點（global candidate）", turns: ["我想去里斯本", "推薦景點"], reloadAfter: 0 },
  { id: "G1", label: "全球城市同輪 我想去里斯本，推薦景點", turns: ["我想去里斯本，推薦景點"] },
  { id: "G2", label: "全球城市同輪 里斯本有什麼景點推薦", turns: ["里斯本有什麼景點推薦"] },
  { id: "G3", label: "全球城市同輪 想去波爾圖，有推薦的咖啡廳嗎", turns: ["想去波爾圖，有推薦的咖啡廳嗎"] },
];
// provider 模式：ok（Google 實際行為）×search ok/empty；timeout(17)、null(18)、zero(19)、neterr（網路錯誤）
const MODES = [
  { id: "ok", geo: "ok", search: "ok" },
  { id: "ok-empty", geo: "ok", search: "empty" },
  { id: "timeout", geo: "timeout", search: "ok" },
  { id: "null", geo: "null", search: "ok" },
  { id: "zero", geo: "zero", search: "ok" },
  { id: "neterr", geo: "neterr", search: "ok" },
];
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) || process.env.VERIFY_P2_ONLY;
const ONLY = onlyArg ? new Set(onlyArg.split(",")) : null;
const scenarios = ONLY ? SCENARIOS.filter((s) => ONLY.has(s.id)) : SCENARIOS;

async function collect(root, mode, scenario) {
  if (scenario.reloadAfter == null) return collectOnce(root, mode, scenario, {});
  // 前段 → 取得 persisted Session → 新子行程（模組 cache 清空）續跑後段
  const k = scenario.reloadAfter;
  const a = await collectOnce(root, mode, { ...scenario, turns: scenario.turns.slice(0, k + 1) }, {});
  if (a.err || a.result.error) return a;
  const b = await collectOnce(root, mode, { ...scenario, turns: scenario.turns.slice(k + 1) }, {
    VERIFY_P2_INIT: JSON.stringify(a.result.final),
    VERIFY_P2_TURN_OFFSET: String(k + 1),
  });
  if (b.err) return b;
  return {
    result: { ...b.result, turns: [...a.result.turns, ...b.result.turns], error: a.result.error ?? b.result.error },
    fetchCalls: a.fetchCalls + b.fetchCalls,
    fetchLog: [...a.fetchLog, ...b.fetchLog],
  };
}

function collectOnce(root, mode, scenario, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["vite-node", SCRIPT, "--config", `${root}/scripts/vite.verify.config.mjs`], {
      cwd: root,
      env: {
        ...process.env,
        ...extraEnv,
        VERIFY_P2_ROLE: "collect",
        VERIFY_ROOT: root,
        VERIFY_P2_GEO: mode.geo,
        VERIFY_P2_SEARCH: mode.search,
        VERIFY_P2_SCENARIO: JSON.stringify(scenario),
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith("@@P2_JSON@@"));
      if (!line) return resolve({ err: `status=${code} signal=${signal} stderr=${err.slice(-600)}` });
      resolve(JSON.parse(line.slice("@@P2_JSON@@".length)));
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
const CONC = Number(process.env.VERIFY_P2_CONC ?? 8);
let idx = 0;
async function worker() {
  while (idx < jobs.length) {
    const j = jobs[idx++];
    results[`${j.tree}|${j.m.id}|${j.s.id}`] = await collect(j.tree === "work" ? WORK_ROOT : BASE_ROOT, j.m, j.s);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const infra = [];
for (const [k, r] of Object.entries(results)) {
  if (r.err) infra.push(`INFRA-FAIL ${k} ${r.err}`);
  else if (r.fetchCalls !== 0) infra.push(`INFRA-FAIL ${k} fetchCalls=${r.fetchCalls} ${r.fetchLog.join(";")}`);
  else if (r.result.error) infra.push(`INFRA-FAIL ${k} ${r.result.error}`);
  else if (k.startsWith("work|") !== r.result.isWork) infra.push(`INFRA-FAIL ${k} tree mismatch isWork=${r.result.isWork}`);
}
if (infra.length) {
  console.log(infra.join("\n"));
  process.exit(1);
}

// ── 判定 ──
// 已確認目的地 oracle（與兩樹實作無關）：已知城市／地區、provider 以行政欄位驗證成功的區（僅 ok 模式）、global candidate 解析成功的城市（僅 ok 模式）。
const KNOWN = new Set(["京都", "大阪", "北海道", "沖繩", "奈良", "金澤", "花蓮", "香港", "台南", "新竹", "千葉", "東京", "台北", "台中", "南投"]);
const ADMIN_OK = new Set(["香港跑馬地", "台中西屯", "南投埔里", "里斯本", "波爾圖"]);
const confirmedDest = (d, mode) => !d || KNOWN.has(d) || (mode.geo === "ok" && ADMIN_OK.has(d));
const p1 = [];
const diffExpected = [];
const ux = [];
const notes = [];
const rows = [];
const fmt = (t) =>
  t
    ? `path=${t.path} | dispatch=${t.dispatchDest ?? "-"} | res=${t.turnResolution ?? "-"} | search=${t.searchDest ?? "-"} | weather=${t.weatherDest ?? "-"} | credits=${t.creditsDest ?? "-"}(settle=${JSON.stringify(t.creditsSettle)}) | session=${t.sessionDest ?? "-"}/rec=${t.sessionRecDest ?? "-"}/pending=${t.sessionPendingLabel ?? "-"} | clar=${t.clarified ? `Y(${t.clarificationLabel ?? ""})` : "N"} | noResults=${t.noResultsLabel ?? "-"} | cont=${t.continuationDest ?? "-"} | geocode=${t.geocodes.length}[${t.geocodes.join(",")}] | weatherCalls=${t.weatherCalls} builder=${t.builderCalls} credits=${t.creditsBegin} | actPref=${t.activityPreference ?? "-"}${t.error ? ` | ERR=${t.error}` : ""}`
    : "(turn skipped)";
const totals = {};
for (const s of scenarios) {
  for (const m of MODES) {
    // 依情境中的輪次索引對齊（條件式回答輪可能只在一邊出現）
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
    totals[m.id] ??= { wg: 0, bg: 0, ww: 0, bw: 0, wb: 0, bb: 0, wc: 0, bc: 0 };
    const tt = totals[m.id];
    const n = Math.max(W.length, B.length);
    const sum = (arr, f) => arr.reduce((a, t) => a + (t ? f(t) : 0), 0);
    tt.wg += sum(Wraw, (t) => t.geocodes.length);
    tt.bg += sum(Braw, (t) => t.geocodes.length);
    tt.ww += sum(Wraw, (t) => t.weatherCalls);
    tt.bw += sum(Braw, (t) => t.weatherCalls);
    tt.wb += sum(Wraw, (t) => t.builderCalls);
    tt.bb += sum(Braw, (t) => t.builderCalls);
    tt.wc += sum(Wraw, (t) => t.creditsBegin);
    tt.bc += sum(Braw, (t) => t.creditsBegin);
    rows.push(`\n${tag}`);
    for (let i = 0; i < n; i += 1) {
      const w = W[i];
      const b = B[i];
      if (!w && !b) continue;
      rows.push(`  T${i + 1} 「${(w ?? b).text}」`);
      // provider 次數：兩邊都有的輪次逐輪比較；只有 work 有的輪次（work 多出的澄清回答輪）另列
      if (w && b) {
        if (w.geocodes.length > b.geocodes.length) p1.push(`${tag} T${i + 1} geocode 次數 work=${w.geocodes.length} > base=${b.geocodes.length}`);
        if (w.weatherCalls > b.weatherCalls) p1.push(`${tag} T${i + 1} weather 次數 work=${w.weatherCalls} > base=${b.weatherCalls}`);
        if (w.builderCalls > b.builderCalls) p1.push(`${tag} T${i + 1} Places(builder) 次數 work=${w.builderCalls} > base=${b.builderCalls}`);
      } else if (w && !b && w.geocodes.length) {
        notes.push(`${tag} T${i + 1} work 多出的回答輪 geocode=${w.geocodes.length}（${w.geocodes.join(",")}）`);
      }
      rows.push(`    work: ${fmt(w)}`);
      rows.push(`    base: ${fmt(b)}`);
      if (!w) {
        notes.push(`${tag} T${i + 1} base 有此輪、work 跳過（work 前一輪未澄清）`);
        continue;
      }
      // 與 base 完全相同的既有行為記為備註，不算 work 新增的 P1
      const sameAsBase = (field) => Boolean(b) && (b[field] ?? null) === (w[field] ?? null);
      const flag = (field, msg) => (sameAsBase(field) ? notes.push(`${msg}（與 base 相同，既有行為）`) : p1.push(msg));
      // P1：未確認目的地進入正式搜尋／天氣／Credits（work）
      for (const [field, key] of [["search", "searchDest"], ["weather", "weatherDest"], ["credits", "creditsDest"]]) {
        if (!confirmedDest(w[key], m)) flag(key, `${tag} T${i + 1} work ${field} 使用未確認目的地「${w[key]}」`);
      }
      // P1：Session 寫入未確認目的地（work，只看本輪有變動的值）
      const prevW = W[i - 1];
      if (w.sessionDest !== (prevW?.sessionDest ?? null) && !confirmedDest(w.sessionDest, m)) {
        flag("sessionDest", `${tag} T${i + 1} work Session travelContext.destination 寫入未確認「${w.sessionDest}」`);
      }
      if (w.sessionRecDest !== (prevW?.sessionRecDest ?? null) && !confirmedDest(w.sessionRecDest, m)) {
        flag("sessionRecDest", `${tag} T${i + 1} work Session recommendationSession.destination 寫入未確認「${w.sessionRecDest}」`);
      }
      // P1：rawLabel geocode（weather / builder 以未確認字串 geocode；dc_validate 是既有的同一支驗證查詢）
      for (const g of w.geocodes) {
        const [ph, q] = [g.slice(0, g.indexOf(":")), g.slice(g.indexOf(":") + 1)];
        if ((ph === "weather" || ph === "builder_geocode") && !confirmedDest(q.split(",")[0].replace(/市$/, ""), m)) {
          const inBase = b?.geocodes.includes(g);
          (inBase ? notes : p1).push(`${tag} T${i + 1} work ${ph} 以未確認字串 geocode「${q}」${inBase ? "（與 base 相同）" : ""}`);
        }
      }
      // P1：Continuation 換城市
      if (w.continuationDest && prevW) {
        const prevConfirmed = prevW.sessionRecDest ?? prevW.sessionDest;
        if (prevConfirmed && w.continuationDest !== prevConfirmed) p1.push(`${tag} T${i + 1} work Continuation 換城市 ${prevConfirmed} → ${w.continuationDest}`);
      }
      // P1：澄清迴圈（使用者回答後再次進入澄清）
      const isAnswer = typeof s.turns[i] === "object" && s.turns[i].onlyIfClarified;
      if (isAnswer && w.clarified) {
        if (b && b.clarified) notes.push(`${tag} T${i + 1} work 與 base 皆澄清迴圈（既有行為；work label=${w.clarificationLabel} base label=${b.clarificationLabel}）`);
        else p1.push(`${tag} T${i + 1} work 澄清迴圈：回答「${w.text}」後再次要求澄清（label=${w.clarificationLabel}）${b ? "" : "；base 首輪未澄清"}`);
      }
      // P1：activityPreference 虛構
      if (w.activityPreference) p1.push(`${tag} T${i + 1} work Session 出現 activityPreference=${w.activityPreference}`);
      // P1：退步（base 以已確認目的地搜尋成功，work 澄清或沒有搜尋）
      if (b) {
        const baseGood = b.searchDest && confirmedDest(b.searchDest, m) && b.builderCalls > 0;
        const workSearched = w.searchDest && w.builderCalls > 0;
        if (baseGood && !workSearched && !w.continuationDest) {
          p1.push(`${tag} T${i + 1} 退步：base 以「${b.searchDest}」搜尋，work ${w.clarified ? `改為澄清(${w.clarificationLabel})` : `未搜尋(path=${w.path})`}`);
        }
        if (baseGood && workSearched && w.searchDest !== b.searchDest) {
          p1.push(`${tag} T${i + 1} 退步/換目的地：base「${b.searchDest}」→ work「${w.searchDest}」`);
        }
        // DIFF-expected：base 用未確認字串搜尋/天氣/credits，work 不再使用
        for (const [field, bv, wv] of [["search", b.searchDest, w.searchDest], ["weather", b.weatherDest, w.weatherDest], ["credits", b.creditsDest, w.creditsDest]]) {
          if (bv && !confirmedDest(bv, m) && bv !== wv) {
            diffExpected.push(`${tag} T${i + 1} ${field}: base「${bv}」(未確認) → work「${wv ?? "-"}」${w.clarified ? `（work 澄清：${w.clarificationLabel}）` : ""}`);
          }
        }
        // 其他差異
        if (w.path.split("|")[0] !== b.path.split("|")[0]) notes.push(`${tag} T${i + 1} path base=${b.path} work=${w.path}`);
        // Weather：base 在 prefetch 當下就已確認（已知城市）→ work 不取 = P1；
        // base 用的是當下尚未驗證、稍後才由 provider 驗證成功的區（香港跑馬地/台中西屯）→ DIFF-expected + UX 風險。
        if (b.weatherDest && !w.weatherDest && KNOWN.has(b.weatherDest)) {
          p1.push(`${tag} T${i + 1} Weather 退步：base 以已確認「${b.weatherDest}」取天氣，work 不取`);
        } else if (b.weatherDest && !w.weatherDest && confirmedDest(b.weatherDest, m)) {
          diffExpected.push(`${tag} T${i + 1} weather: base 以 prefetch 當下未驗證的「${b.weatherDest}」取天氣（稍後驗證成功）→ work 不取`);
          ux.push(`${tag} T${i + 1} 已驗證行政區首輪沒有天氣（work Weather 在 provider 驗證前執行）`);
        }
        if (w.noResultsLabel === "" && b.noResultsLabel !== "") {
          ux.push(`${tag} T${i + 1} work noResults 文案目的地為空字串（base=${b.noResultsLabel ?? "-"}）`);
        }
      }
      // UX：澄清文案帶整串 rawLabel
      if (w.clarified && w.clarificationLabel && /[看玩泛滑潛冷]/.test(w.clarificationLabel)) {
        ux.push(`${tag} T${i + 1} work 澄清文案「你指的是哪個地區的${w.clarificationLabel}？」`);
      }
    }
    // Planner：京都三天行程 path / weather 必須與 base 相同
    if (s.id === "14") {
      const w = W[0];
      const b = B[0];
      if (w.path !== b.path) p1.push(`${tag} Planner path 改變 base=${b.path} work=${w.path}`);
      if ((w.weatherDest ?? null) !== (b.weatherDest ?? null)) {
        notes.push(`${tag} Planner weather base=${b.weatherDest ?? "-"} work=${w.weatherDest ?? "-"}`);
      }
    }
  }
}

const out = [];
out.push("══ base/work 逐情境逐輪對照（每情境 6 種 provider 模式）══", ...rows);
out.push("\n══ Provider 呼叫總數（work / base）══");
for (const [mid, t] of Object.entries(totals)) {
  out.push(`${mid.padEnd(9)} geocode ${t.wg}/${t.bg}  weather ${t.ww}/${t.bw}  builder(Places) ${t.wb}/${t.bb}  credits.begin ${t.wc}/${t.bc}`);
}
const uniq = (a) => [...new Set(a)];
out.push("\n══ P1 ══", ...(uniq(p1).length ? uniq(p1) : ["(none)"]));
out.push("\n══ DIFF-expected（base 使用未確認目的地，work 不再使用）══", ...(uniq(diffExpected).length ? uniq(diffExpected) : ["(none)"]));
out.push("\n══ UX 風險 ══", ...(uniq(ux).length ? uniq(ux) : ["(none)"]));
out.push("\n══ 其他差異／備註 ══", ...(uniq(notes).length ? uniq(notes) : ["(none)"]));
out.push(`\n情境=${scenarios.length} 模式=${MODES.length} 子行程=${jobs.length}`);
out.push(`verify-destination-authority-phase2: P1=${uniq(p1).length} DIFF-expected=${uniq(diffExpected).length} UX=${uniq(ux).length} → ${uniq(p1).length ? "FAIL" : "PASS"}`);
await new Promise((resolve) => process.stdout.write(`${out.join("\n")}\n`, resolve));
process.exit(uniq(p1).length ? 1 : 0);
