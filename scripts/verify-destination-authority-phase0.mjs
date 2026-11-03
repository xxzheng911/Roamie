#!/usr/bin/env node
/**
 * T19 — Destination Resolution Authority Phase 0「安全收斂」驗收：工作區 vs aa2db59 逐句比對。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-authority-phase0.mjs --config scripts/vite.verify.config.mjs
 *
 * 機制（由 verify-recommendation-intent-activity-r3.mjs 複製 simulateChatDispatch 與基準子行程比對）：
 * - 主行程不載入任何 src 模組，只負責產生句子清單、啟動 4 個 collect 子行程並比對：
 *     work×geoNull、base×geoNull、work×geoOk、base×geoOk
 *   work 子行程 cwd=工作樹、工作樹 vite.verify.config；base 子行程 cwd=基準 archive、基準 config
 *   （避免 @/ 解析到工作樹）。兩邊句子順序完全相同，模組層級快取（geocode cache、validatedAreaScopes）
 *   的影響對稱。
 * - geoNull：geocodeFn 回 location=null（provider 無法驗證）→ 不會呼叫天氣。
 *   geoOk：geocodeFn 回「接受任何字串」的假 location（最壞情境：provider 對活動字串也給結果），
 *   用來觀察 Weather Destination 與 weather 呼叫數、area 驗證是否讓活動字串進入搜尋。
 * - globalThis.fetch 為 trap（計數並拋錯）；不使用任何 API Key、不產生 Google 費用。
 *
 * 判定：
 *   P1（自動）= work 比 base 差：geocode／weather 次數高於基準、非餐飲新變 restaurant/cafe、
 *     規劃↔推薦路由退步、續推／跨城市路由退步、搜尋／Credits／Weather／Session 目的地被截斷或新含活動字串、
 *     合法地名 intent dest 被截斷。
 *   DIFF = 其他 work≠base 的欄位差異（逐條列出供人工判讀）。
 *   PRE-EXISTING = work 與 base 在理想述詞上同樣不通過。
 */
let fetchCalls = 0;
const fetchLog = [];
const fetchTrap = async (...args) => {
  fetchCalls += 1;
  fetchLog.push(String(args[0]).slice(0, 160));
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};
globalThis.fetch = fetchTrap;

const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug, error: console.error };
const silence = () => {
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  console.log = () => {};
  console.error = () => {};
};
const restore = () => Object.assign(console, orig);

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DEFAULT_BASE_ROOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const ROLE = process.env.VERIFY_P0_ROLE ?? "main";
const BASE_ROOT = process.env.VERIFY_P0_BASE_ROOT || DEFAULT_BASE_ROOT;
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase0.mjs`;

// ════════════════════════ collect（子行程）════════════════════════
if (ROLE === "collect") {
  silence();
  const ROOT = process.env.VERIFY_ROOT;
  const GEO_MODE = process.env.VERIFY_P0_GEO ?? "null";
  const M = {
    arb: await import(`${ROOT}/src/lib/ai/recommendation-refinement/index.ts`),
    merge: await import(`${ROOT}/src/lib/ai/recommendation-refinement/merge.ts`),
    intent: await import(`${ROOT}/src/lib/ai/place-recommendation-intent/index.ts`),
    dtp: await import(`${ROOT}/src/lib/ai/destination-travel-profile.ts`),
    tpc: await import(`${ROOT}/src/lib/ai/trip-planning-context.ts`),
    router: await import(`${ROOT}/src/lib/ai/chat-intent-router.ts`),
    chatIntent: await import(`${ROOT}/src/lib/ai/chat-intent.ts`),
    catDest: await import(`${ROOT}/src/lib/ai/chat-category-destination.ts`),
    placeIntent: await import(`${ROOT}/src/lib/ai/chat-place-intent.ts`),
    travelCtx: await import(`${ROOT}/src/lib/ai/travel-context.ts`),
    gpc: await import(`${ROOT}/src/lib/ai/global-planning-context.ts`),
    mvp: await import(`${ROOT}/src/lib/ai/must-visit-places.ts`),
    weather: await import(`${ROOT}/src/lib/ai/destination-weather-prefetch.ts`),
    nearbyClar: await import(`${ROOT}/src/lib/ai/nearby-location-clarification.ts`),
    convState: await import(`${ROOT}/src/lib/ai/chat-conversation-state.ts`),
    chatSession: await import(`${ROOT}/src/lib/chat-session.ts`),
    planFlow: await import(`${ROOT}/src/lib/chat-planning-flow.ts`),
    tls: await import(`${ROOT}/src/lib/ai/travel-language-signals.ts`),
  };
  let countMod = null;
  try {
    countMod = await import(`${ROOT}/src/lib/ai/requested-recommendation-count.ts`);
  } catch {
    countMod = null;
  }

  const safe = (fn) => {
    try {
      const v = fn();
      return v === undefined ? null : v;
    } catch (e) {
      return `THROW:${e?.message ?? e}`;
    }
  };
  const baseSession = (o = {}) => ({
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...o,
  });
  function makeSession(kind) {
    if (kind === "fresh") return baseSession();
    const city = kind === "osaka" ? "大阪" : "京都";
    return baseSession({
      activeRecommendationContext: M.merge.createActiveRecommendationContext({
        destinationName: city,
        intent: "attraction",
        category: "attraction",
        placeIds: ["p1", "p2", "p3"],
      }),
      activeCategoryIntent: "attraction",
      recommendationSession: { topic: "attraction", destination: city },
      travelContext: { destination: city, interests: [] },
    });
  }
  let seq = 0;
  const fakeLocation = (q) => {
    seq += 1;
    return {
      placeId: `mock-place-${seq}`,
      country: "Japan",
      city: q,
      region: q,
      district: q,
      sublocality: q,
      lat: 35 + seq / 1000,
      lng: 135 + seq / 1000,
      formattedName: q,
      displayLabel: q,
      address: q,
    };
  };

  async function simulateChatDispatch(text, kind) {
    const geocodes = [];
    const weatherCalls = [];
    const geocodeFn = async (req) => {
      const q = String(req?.data?.query ?? req?.data?.destinationName ?? "");
      geocodes.push(q);
      if (GEO_MODE === "ok") return { location: fakeLocation(q), providerResult: { rawResultCount: 1 } };
      return { location: null, providerResult: { rawResultCount: 0 } };
    };
    const fetchWeatherFn = async (req) => {
      weatherCalls.push(JSON.stringify(req?.data ?? {}));
      return null;
    };
    const out = {
      path: "",
      geocodes,
      weatherCalls,
      weatherDest: null,
      searchDest: null,
      creditsDest: null,
      mergedDest: null,
      ctxDest: null,
      route: null,
      step: [],
    };
    try {
      const trimmed = text.trim();
      let nextSession = makeSession(kind);
      nextSession = M.convState.prepareSessionForUserTurn(nextSession, undefined);
      const merged = M.travelCtx.mergeTravelContext(nextSession, trimmed, undefined);
      nextSession = merged.session;
      out.mergedDest = merged.context.destination ?? null;
      if (merged.context.destinationCandidate?.status === "pending") {
        out.step.push(`global_candidate:${merged.context.destinationCandidate.raw}`);
        nextSession = await M.gpc.resolveGlobalPlanningCandidate(nextSession, "zh-TW", async (query) => {
          const r = await geocodeFn({ data: { query, destinationName: query } });
          return { location: r.location, rawResultCount: r.providerResult.rawResultCount };
        });
        merged.session = nextSession;
        merged.context = nextSession.travelContext ?? merged.context;
      }
      if (
        merged.context.destinationClarification ||
        (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")
      ) {
        out.path = "advice_clarification";
        return out;
      }
      nextSession = M.tpc.mergeTripPlanningContext(trimmed, nextSession, merged.context).session;
      out.route = M.arb.resolveChatIntentArbitration(trimmed, nextSession).route;
      nextSession = M.chatSession.extractPlanningHintsFromText(trimmed, nextSession);
      nextSession = M.chatSession.extractDiscoveryFromText(trimmed, nextSession);
      nextSession = M.planFlow.extractChatPlanningContextFromText(trimmed, nextSession);

      const placeFetchContext = M.mvp.mergeContextForPlaceFetch(merged.context, nextSession);
      if (placeFetchContext.destination?.trim() && !placeFetchContext.weather) {
        out.weatherDest = placeFetchContext.destination;
        await M.weather.prefetchDestinationWeather({
          destination: placeFetchContext.destination,
          locale: "zh-TW",
          geocodeFn,
          fetchWeatherFn,
        });
      }
      const refreshedPlaceCtx = M.mvp.mergeContextForPlaceFetch(nextSession.travelContext ?? merged.context, nextSession);
      out.ctxDest = refreshedPlaceCtx.destination ?? null;
      if (M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
        out.path = "destination_places";
        out.searchDest = refreshedPlaceCtx.destination ?? null;
        return out;
      }
      const earlyCategoryPlaceQuery = M.placeIntent.shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession);
      const earlyNearbyIntent = M.chatIntent.inferNearbyIntentFromContext(refreshedPlaceCtx, trimmed, nextSession);
      const authority = M.nearbyClar.resolveChatRouteAuthority({
        structuredShortcut: false,
        explicitNearbyRequest: M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed),
        pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
        resolvedNearbyIntent: earlyNearbyIntent,
        categoryPlaceQuery: earlyCategoryPlaceQuery,
      });
      if (authority !== "destination_category") {
        out.path = `later:${authority}`;
        return out;
      }
      const activeSession = { ...nextSession, travelContext: refreshedPlaceCtx };
      if (M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed)) {
        out.path = "dc_nearby_bail";
        return out;
      }
      const merged2 = M.travelCtx.mergeTravelContext(activeSession, trimmed);
      const placeCtx = M.mvp.mergeContextForPlaceFetch(merged2.context, activeSession);
      const intents = M.placeIntent.parseChatPlaceIntents(trimmed);
      if (!intents.length) {
        out.path = "dc_no_intents";
        return out;
      }
      const provisionalArea = M.dtp.extractProvisionalDestinationAreaCandidate(trimmed);
      const validatedAreaScope = await M.dtp.resolveValidatedDestinationAreaScope({ input: trimmed, locale: "zh-TW", geocodeFn });
      if (provisionalArea && !validatedAreaScope) {
        out.path = `dc_geo_clarification:${provisionalArea.areaCandidate}`;
        return out;
      }
      const baseDestination = M.catDest.resolveDestinationForCategorySearch(placeCtx, merged2.session, trimmed);
      if (!baseDestination && !validatedAreaScope) {
        out.path = "dc_no_destination";
        return out;
      }
      const destination = validatedAreaScope?.displayLabel ?? baseDestination;
      out.path = "destination_category_search";
      out.searchDest = destination ?? null;
      out.creditsDest = destination ?? null; // _app.chat.tsx metadata: { path, destination, intents }
      return out;
    } catch (e) {
      out.path = `THROW:${e?.message ?? e}`;
      return out;
    }
  }

  function observe(text, kind) {
    const s = makeSession(kind);
    const opts = kind === "fresh" ? undefined : { hasActiveRecommendationContext: true, activePrimaryType: "attraction" };
    const p = safe(() => M.intent.parsePlaceRecommendationIntent(text, opts));
    const pObj = p && typeof p === "object" ? p : null;
    const sc = safe(() => M.dtp.resolveDestinationAreaScope(text));
    const scObj = sc && typeof sc === "object" ? sc : null;
    const tc = safe(() => M.travelCtx.parseTravelContextFromText(text, s));
    return {
      route: safe(() => M.arb.resolveChatIntentArbitration(text, s).route),
      reason: safe(() => M.arb.resolveChatIntentArbitration(text, s).reason),
      plan: safe(() => M.arb.isExplicitNewTripPlanningText?.(text) ?? null),
      tpt: safe(() => M.router.isTravelPlanningText(text)),
      mti: safe(() => M.tls.multilingualTravelIntent(text)),
      // arbitrate 新分支條件成立且第 2 步沒接住（= 分支實際可達）；基準無此函式 → false
      bwgReach: safe(
        () => Boolean(M.tls.isBareWantToGoPlaceRecommendationAsk?.(text)) && !M.arb.isExplicitNewTripPlanningText?.(text),
      ),
      dest: pObj?.destinationName ?? null,
      type: pObj?.primaryType ?? null,
      cont: pObj?.continuation ?? null,
      act: pObj?.activityPreference ?? null,
      cnt: pObj?.requestedCount ?? null,
      scope: scObj ? `${scObj.displayLabel}|${scObj.area}` : String(sc),
      catDest: safe(() => M.catDest.resolveDestinationForCategorySearch({}, s, text)),
      tcDest: tc && typeof tc === "object" ? (tc.destination ?? null) : String(tc),
      cats: safe(() => M.placeIntent.parseChatPlaceIntents(text)),
    };
  }

  const probes = JSON.parse(process.env.VERIFY_P0_PROBES ?? "[]");
  const out = {};
  for (const [text, kind] of probes) {
    out[`${kind}\u0000${text}`] = { ...observe(text, kind), sim: await simulateChatDispatch(text, kind) };
  }
  restore();
  await new Promise((resolve) =>
    process.stdout.write(
      `\n@@P0_JSON@@${JSON.stringify({ out, fetchCalls, fetchLog, hasCountModule: Boolean(countMod) })}\n`,
      resolve,
    ),
  );
  process.exit(0);
}

// ════════════════════════ main ════════════════════════
const { existsSync } = await import("node:fs");
const { spawnSync } = await import("node:child_process");

/** probe: { text, kind, group, act?: 活動核心字, full?: 完整合法地名, city?: 期望城市 } */
const PROBES = [];
const seen = new Set();
const add = (p) => {
  const key = `${p.kind ?? "fresh"}\u0000${p.text}\u0000${p.group}`;
  if (seen.has(key)) return;
  seen.add(key);
  PROBES.push({ kind: "fresh", ...p });
};

// A–F 活動句（兩種句型）
for (const [city, frag, core] of [
  ["京都", "看楓葉", "楓葉"],
  ["北海道", "滑雪", "滑雪"],
  ["沖繩", "潛水", "潛水"],
  ["奈良", "看鹿", "鹿"],
  ["金澤", "看兼六園", "兼六園"],
  ["花蓮", "泛舟", "泛舟"],
]) {
  add({ text: `我想去${city}${frag}，推薦景點`, group: "ACT", act: core, city });
  add({ text: `${city}${frag}推薦景點`, group: "ACT", act: core, city });
}
// 合法地名（兩種句型）
for (const [place, city] of [
  ["香港跑馬地", "香港"],
  ["台南看西街教會", "台南"],
  ["新竹潛園", "新竹"],
  ["千葉釣崎海岸", "千葉"],
  ["東京玩具美術館", "東京"],
  ["台北士林夜市", "台北"],
]) {
  add({ text: `我想去${place}，推薦景點`, group: "LEGIT", full: place, city });
  add({ text: `${place}推薦景點`, group: "LEGIT", full: place, city });
}
// M／N 非餐飲
for (const t of [
  "吃藥推薦藥局",
  "吃藥，推薦 3 家藥局",
  "吃藥，推薦 3 家眼科",
  "吃藥，推薦 3 家便利店",
  "吃藥，推薦 3 家診療所",
  "我想去東京，吃藥，推薦 3 家眼科",
  "我想去台北，吃藥，推薦 3 家便利店",
  "我想去福岡，吃壞肚子，推薦 3 家診療所",
  "喝醉推薦飯店",
  "喝醉了，推薦 3 家飯店",
  "我想去京都，喝醉了，推薦 3 家飯店",
]) {
  add({ text: t, group: "NOTFOOD" });
}
// O 規劃
for (const t of ["京都三天行程規劃", "幫我排一下京都景點的路線", "幫我規劃京都三天行程", "我想去京都玩三天"]) {
  add({ text: t, group: "PLAN" });
}
// 推薦中要求把景點排成路線（明確排路線 = 規劃）
add({ text: "這些景點幫我排一下路線", kind: "kyoto", group: "PLAN" });
// P 數量
for (const t of ["大阪推薦 10 個景點", "大阪推薦10個景點", "推薦大阪十個景點", "推薦大阪 10 個景點"]) {
  add({ text: t, group: "QTY", city: "大阪" });
}
// Q 跨城市（京都推薦中）
for (const [t, city] of [
  ["大阪推薦景點", "大阪"],
  ["推薦大阪景點", "大阪"],
  ["奈良推薦景點", "奈良"],
  ["我想去奈良，推薦景點", "奈良"],
  ["札幌推薦景點", "札幌"],
  ["推薦札幌 5 個景點", "札幌"],
  ["台南推薦景點", "台南"],
  ["我想去台南，推薦一些景點", "台南"],
]) {
  add({ text: t, kind: "kyoto", group: "XCITY", city });
}
// R 續推（京都推薦中）
for (const t of ["還有嗎", "再給我 5 個", "再推薦三個", "還有其他推薦嗎"]) {
  add({ text: t, kind: "kyoto", group: "CONT" });
}
// parse.ts 描述詞剝除 / arbitrate 新分支風險探針
for (const [t, kind] of [
  ["京都冷門歷史文化景點推薦", "fresh"],
  ["京都冷門景點推薦", "fresh"],
  ["京都的景點推薦", "fresh"],
  ["京都嵐山的景點推薦", "fresh"],
  ["京都嵐山冷門景點推薦", "fresh"],
  ["花蓮太魯閣自然景點推薦", "fresh"],
  ["高雄駁二藝術景點推薦", "fresh"],
  ["京都冷門景點推薦", "kyoto"],
  ["京都的景點推薦", "kyoto"],
  ["大阪的景點推薦", "kyoto"],
  ["京都在地美食推薦", "fresh"],
  ["我想去京都，推薦 10 個景點", "fresh"],
  ["我想去京都，推薦景點", "fresh"],
  ["我想去京都，推薦景點，天氣如何", "fresh"],
  ["我想去京都，推薦景點", "kyoto"],
  ["推薦京都景點，之後再幫我規劃路線", "fresh"],
  ["推薦京都景點，不用幫我規劃路線", "fresh"],
  ["推薦適合安排觀光路線的京都景點", "fresh"],
  ["京都有哪些適合規劃路線的景點推薦", "fresh"],
  ["推薦京都景點，不用安排路線", "fresh"],
  ["幫我推薦京都景點，不要排路線", "fresh"],
  ["推薦京都好安排路線的景點", "fresh"],
  ["京都景點推薦，參觀路線怎麼安排比較順", "fresh"],
  ["京都幫我推薦景點", "fresh"],
  ["京都，幫我推薦 10 個景點", "fresh"],
  ["京都請推薦景點", "fresh"],
  ["台北大安，請推薦咖啡廳", "fresh"],
  ["我想去京都，請推薦景點", "fresh"],
  ["下個月要去大阪，推薦一些景點", "fresh"],
  ["我想去大阪探索在地美食，推薦 5 家", "fresh"],
  ["大阪探索在地美食，推薦 5 家", "fresh"],
  ["我想去京都探索冷門歷史文化景點，幫我推薦 10 個", "fresh"],
  ["我想去京都，推薦 10 個景點", "osaka"],
  ["我想去東京澀谷，推薦咖啡廳", "fresh"],
  ["我想去京都嵐山，推薦景點", "fresh"],
  // arbitrate 第 3 步後 isBareWantToGoPlaceRecommendationAsk 分支可達性探針（multilingualTravelIntent 早退條件）
  ["我想去京都，有什麼景點推薦，天氣如何", "fresh"],
  ["我想去京都，有什麼景點推薦，天氣如何", "kyoto"],
  ["我想去京都但不想旅行，推薦景點", "fresh"],
  ["我想去京都但不想旅行，推薦景點", "kyoto"],
  ["what is 我想去京都 推薦景點", "kyoto"],
  ["我想去附近，推薦景點", "kyoto"],
]) {
  add({ text: t, kind, group: "RISK" });
}
// r3 全部既有句子
const R3_LEGIT = [
  "香港跑馬地", "台南看西街教會", "新竹潛園", "千葉釣崎海岸", "台北遊藝場", "台中玩具博物館",
  "高雄看守所", "京都賞花小徑", "東京吃茶店", "東京玩具美術館", "香港跑馬地馬場", "大阪游泳池",
];
for (const place of R3_LEGIT) {
  for (const t of [`我想去${place}，推薦景點`, `${place}推薦景點`, `我想去${place}`, `${place}有什麼好吃的`]) {
    add({ text: t, group: "R3-LEGIT", full: place });
  }
}
const R3_CHAT = [
  ["我想去奈良看鹿，推薦景點", "看鹿"], ["奈良看鹿推薦景點", "看鹿"], ["我想去金澤看兼六園，推薦景點", "看兼六園"],
  ["金澤看兼六園推薦景點", "看兼六園"], ["我想去京都看楓葉，推薦景點", "看楓葉"], ["我想去北海道滑雪，推薦景點", "滑雪"],
  ["我想去沖繩潛水，推薦景點", "潛水"], ["我想去大阪吃美食，推薦 5 家", "吃美食"], ["我想去台南吃小吃，推薦 5 家", "吃小吃"],
  ["我想去花蓮泛舟，推薦景點", "泛舟"], ["我想去曼谷按摩，推薦景點", "按摩"], ["我想去台南拜拜，推薦景點", "拜拜"],
  ["我想去北海道溜冰，推薦景點", "溜冰"], ["我想去合歡山登山，推薦景點", "登山"], ["我想去冰島追極光，推薦景點", "極光"],
  ["我想去威尼斯坐船，推薦景點", "坐船"], ["我想去宜蘭泡溫泉，推薦景點", "泡溫泉"], ["我想去墾丁衝浪，推薦景點", "衝浪"],
  ["我想去濟州島潛水，推薦景點", "潛水"], ["我想去東京購物，推薦景點", "購物"], ["我想去大阪看夜景，推薦景點", "看夜景"],
  ["我想去京都賞楓，推薦景點", "賞楓"],
];
for (const [t, frag] of R3_CHAT) add({ text: t, group: "R3-CHAT", act: frag.replace(/^(?:看|吃|賞|追)/, "") });
for (const t of ["我想去京都，推薦一些景點", "推薦京都 10 個景點", "京都 10 個景點推薦", "我想去大阪，推薦 5 家拉麵店"]) {
  add({ text: t, group: "R3-RECO" });
}
for (const t of ["幫我排一下京都景點的路線", "我想去京都玩三天", "幫我規劃京都三天行程", "我想去京都玩三天，推薦 5 個景點"]) {
  add({ text: t, group: "R3-PLAN" });
}
for (const t of ["我想去京都看楓葉", "我想去奈良看鹿", "我想去花蓮泛舟"]) add({ text: t, group: "R3-G" });
for (const t of [
  "吃藥，推薦 3 家藥局", "喝醉了，推薦 3 家飯店", "我想去東京，吃藥，推薦 3 家藥局", "我想去京都，喝醉了，推薦 3 家飯店",
  "我想去東京，吃藥，推薦 3 家眼科", "我想去大阪，喝醉了，推薦 3 家按摩店", "我想去台北，吃藥，推薦 3 家便利店",
  "我想去京都，喝醉了，推薦 3 家 KTV", "我想去首爾，吃胖了，推薦 3 家健身房", "我想去福岡，吃壞肚子，推薦 3 家診療所",
]) {
  add({ text: t, group: "R3-NOTFOOD" });
}
for (const t of ["我想去東京吃拉麵，推薦 3 家", "我想去福岡喝咖啡，推薦 3 家", "吃拉麵，推薦 3 家", "喝咖啡，推薦 3 家", "京都拉麵推薦 3 家"]) {
  add({ text: t, group: "R3-FOOD" });
}
for (const t of [
  "我想去中正，推薦景點", "信義區推薦咖啡廳", "西屯推薦景點", "我想去中山看展，推薦景點", "中山看展推薦景點",
  "中山推薦景點", "我想去中山，推薦景點", "台中西屯推薦景點", "我想去台中西屯，推薦景點",
]) {
  add({ text: t, group: "R3-SCOPE" });
}
for (const [t, city] of [
  ["我想去大阪吃美食，推薦 5 家", "大阪"], ["我想去奈良看鹿，推薦景點", "奈良"], ["推薦札幌 5 個景點", "札幌"], ["我想去台南，推薦一些景點", "台南"],
]) {
  add({ text: t, kind: "kyoto", group: "R3-XCITY", city });
}
for (const t of ["還有嗎", "再給我 5 個", "再推薦三個", "還有其他推薦嗎"]) add({ text: t, kind: "kyoto", group: "R3-CONT" });

// 唯一（kind,text）清單，維持相同順序給 4 個子行程
const uniq = [];
const uniqSeen = new Set();
for (const p of PROBES) {
  const k = `${p.kind}\u0000${p.text}`;
  if (!uniqSeen.has(k)) {
    uniqSeen.add(k);
    uniq.push([p.text, p.kind]);
  }
}

function collect(root, geo) {
  const res = spawnSync(
    "npx",
    ["vite-node", SCRIPT, "--config", `${root}/scripts/vite.verify.config.mjs`],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 500000,
      maxBuffer: 128 * 1024 * 1024,
      env: {
        ...process.env,
        VERIFY_P0_ROLE: "collect",
        VERIFY_ROOT: root,
        VERIFY_P0_GEO: geo,
        VERIFY_P0_PROBES: JSON.stringify(uniq),
      },
    },
  );
  const line = String(res.stdout ?? "").split("\n").find((l) => l.startsWith("@@P0_JSON@@"));
  if (!line) return { err: `status=${res.status} signal=${res.signal} stderr=${String(res.stderr ?? "").slice(-800)}` };
  return JSON.parse(line.slice("@@P0_JSON@@".length));
}

if (!existsSync(`${BASE_ROOT}/src/lib/ai/recommendation-refinement/index.ts`)) {
  console.log(`FAIL base root missing: ${BASE_ROOT}`);
  process.exit(1);
}
const RUNS = {
  workNull: collect(WORK_ROOT, "null"),
  baseNull: collect(BASE_ROOT, "null"),
  workOk: collect(WORK_ROOT, "ok"),
  baseOk: collect(BASE_ROOT, "ok"),
};
const lines = [];
let infra = 0;
for (const [name, r] of Object.entries(RUNS)) {
  if (r.err) {
    lines.push(`INFRA-FAIL\t${name}\t${r.err}`);
    infra += 1;
  } else if (r.fetchCalls !== 0) {
    lines.push(`INFRA-FAIL\t${name}\tfetchCalls=${r.fetchCalls} ${r.fetchLog.join(";")}`);
    infra += 1;
  }
}
if (!RUNS.baseNull.err && RUNS.baseNull.hasCountModule) {
  lines.push("INFRA-FAIL\tbaseNull\t基準子行程載入了 requested-recommendation-count（疑似混入工作樹模組）");
  infra += 1;
}
if (infra) {
  console.log(lines.join("\n"));
  process.exit(1);
}

const RECO = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS"]);
const PLAN = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
const FOODY = (o) => o.type === "restaurant" || o.type === "cafe" || (Array.isArray(o.cats) && o.cats.some((c) => c === "restaurant" || c === "cafe"));
const isTrunc = (w, b) => typeof w === "string" && typeof b === "string" && w !== b && b.startsWith(w);
const has = (v, s) => typeof v === "string" && Boolean(s) && v.includes(s);

/** 每組「理想」述詞（用來判 PRE-EXISTING）。 */
function ideal(p, o) {
  const s = o.sim;
  switch (p.group) {
    case "ACT":
    case "R3-CHAT":
      return ![s.searchDest, s.creditsDest, s.weatherDest, ...s.geocodes].some((v) => has(v, p.act));
    case "LEGIT":
    case "R3-LEGIT":
      return !(o.dest && o.dest !== p.full && p.full.startsWith(o.dest)) &&
        !(s.searchDest && s.searchDest !== p.full && p.full.startsWith(s.searchDest));
    case "NOTFOOD":
    case "R3-NOTFOOD":
      return !FOODY(o);
    case "PLAN":
    case "R3-PLAN":
      return PLAN.has(o.route);
    case "QTY":
    case "R3-RECO":
      return RECO.has(o.route);
    case "XCITY":
    case "R3-XCITY":
      return o.route === "NEW_RECOMMENDATION" && o.dest === p.city && !has(s.searchDest, "京都");
    case "CONT":
    case "R3-CONT":
      return o.route === "MORE_RECOMMENDATIONS";
    default:
      return true;
  }
}

const SIM_FIELDS = ["path", "searchDest", "creditsDest", "weatherDest", "ctxDest", "mergedDest"];
const OBS_FIELDS = ["route", "reason", "bwgReach", "plan", "tpt", "mti", "dest", "type", "cont", "scope", "catDest", "tcDest", "cats"];
const p1 = [];
const diffs = [];
const pre = [];
const table = [];
const totals = { workNull: { g: 0, w: 0 }, baseNull: { g: 0, w: 0 }, workOk: { g: 0, w: 0 }, baseOk: { g: 0, w: 0 } };
for (const [k] of uniq.map(([t, kind]) => [`${kind}\u0000${t}`])) {
  for (const name of Object.keys(totals)) {
    totals[name].g += RUNS[name].out[k].sim.geocodes.length;
    totals[name].w += RUNS[name].out[k].sim.weatherCalls.length;
  }
}

for (const p of PROBES) {
  const k = `${p.kind}\u0000${p.text}`;
  const tag = `[${p.group}]${p.kind === "fresh" ? "" : `[${p.kind}]`} ${p.text}`;
  for (const mode of ["Null", "Ok"]) {
    const w = RUNS[`work${mode}`].out[k];
    const b = RUNS[`base${mode}`].out[k];
    const ws = w.sim;
    const bs = b.sim;
    const where = `${tag} (geo${mode})`;
    // ── 自動 P1 ──
    if (ws.geocodes.length > bs.geocodes.length) p1.push(`${where} geocode work=${ws.geocodes.length}[${ws.geocodes}] > base=${bs.geocodes.length}[${bs.geocodes}]`);
    if (ws.weatherCalls.length > bs.weatherCalls.length) p1.push(`${where} weather work=${ws.weatherCalls.length} > base=${bs.weatherCalls.length}`);
    if (FOODY(w) && !FOODY(b)) p1.push(`${where} 非餐飲新變餐飲 type ${b.type}→${w.type} cats ${JSON.stringify(b.cats)}→${JSON.stringify(w.cats)}`);
    if (PLAN.has(b.route) && RECO.has(w.route)) p1.push(`${where} 規劃→推薦 route ${b.route}→${w.route}`);
    // 明確規劃句（PLAN 組，理想述詞要求規劃路由）由推薦改走規劃屬保留的 arbitrate 排路線判定，不算推薦契約退步；
    // 其他句子推薦→非推薦一律 P1。
    const planGroup = p.group === "PLAN" || p.group === "R3-PLAN";
    if (RECO.has(b.route) && !RECO.has(w.route) && !(planGroup && PLAN.has(w.route))) p1.push(`${where} 推薦契約退步 route ${b.route}→${w.route}`);
    if ((p.group === "CONT" || p.group === "R3-CONT") && b.route === "MORE_RECOMMENDATIONS" && w.route !== b.route) p1.push(`${where} 續推失效 ${b.route}→${w.route}`);
    for (const f of SIM_FIELDS.slice(1)) {
      if (isTrunc(ws[f], bs[f])) p1.push(`${where} ${f} 被截斷 base=${bs[f]} work=${ws[f]}`);
      if (p.act && has(ws[f], p.act) && !has(bs[f], p.act)) p1.push(`${where} ${f} 新含活動「${p.act}」 work=${ws[f]} base=${bs[f]}`);
      if ((p.group === "XCITY" || p.group === "R3-XCITY") && f !== "ctxDest" && f !== "mergedDest" && has(ws[f], "京都") && !has(bs[f], "京都")) p1.push(`${where} ${f} 殘留舊城市 work=${ws[f]} base=${bs[f]}`);
    }
    if (p.act && ws.geocodes.some((q) => has(q, p.act)) && !bs.geocodes.some((q) => has(q, p.act))) p1.push(`${where} geocode 新含活動「${p.act}」 [${ws.geocodes}]`);
    if (p.full && isTrunc(w.dest, b.dest) && p.full.startsWith(w.dest)) p1.push(`${where} 合法地名 intent dest 被截斷 base=${b.dest} work=${w.dest}`);
    // ── DIFF（人工判讀）──
    const d = [];
    for (const f of SIM_FIELDS) if (JSON.stringify(ws[f]) !== JSON.stringify(bs[f])) d.push(`sim.${f}: ${bs[f]} → ${ws[f]}`);
    if (JSON.stringify(ws.geocodes) !== JSON.stringify(bs.geocodes)) d.push(`geocodes: [${bs.geocodes}] → [${ws.geocodes}]`);
    if (mode === "Null") for (const f of OBS_FIELDS) if (JSON.stringify(w[f]) !== JSON.stringify(b[f])) d.push(`${f}: ${JSON.stringify(b[f])} → ${JSON.stringify(w[f])}`);
    if (d.length) diffs.push(`${where} ${d.join(" ; ")}`);
    // ── PRE-EXISTING ──
    if (!ideal(p, w) && !ideal(p, b)) pre.push(`${where} work/base 同樣不理想`);
    else if (!ideal(p, w) && ideal(p, b)) p1.push(`${where} 理想述詞：基準通過、工作區不通過`);
    if (mode === "Null") {
      const wo = RUNS.workOk.out[k].sim;
      const bo = RUNS.baseOk.out[k].sim;
      table.push(
        `${tag}\n    work: route=${w.route} dest=${w.dest} type=${w.type} path=${ws.path} search=${ws.searchDest} credits=${ws.creditsDest} weatherDest=${ws.weatherDest} ctx=${ws.ctxDest} geo(null/ok)=${ws.geocodes.length}/${wo.geocodes.length} wx(ok)=${wo.weatherCalls.length} okSearch=${wo.searchDest}` +
          `\n    base: route=${b.route} dest=${b.dest} type=${b.type} path=${bs.path} search=${bs.searchDest} credits=${bs.creditsDest} weatherDest=${bs.weatherDest} ctx=${bs.ctxDest} geo(null/ok)=${bs.geocodes.length}/${bo.geocodes.length} wx(ok)=${bo.weatherCalls.length} okSearch=${bo.searchDest}`,
      );
    }
  }
}

const out = [];
out.push("══ 每句 work/base 對照表 ══");
out.push(...table);
out.push("\n══ DIFF（work≠base，需人工判讀）══");
out.push(...(diffs.length ? diffs : ["(none)"]));
out.push("\n══ PRE-EXISTING（work 與 base 同樣不理想，不算新增）══");
out.push(...(pre.length ? pre : ["(none)"]));
out.push("\n══ 新增 P1 ══");
const p1u = [...new Set(p1)];
out.push(...(p1u.length ? p1u : ["(none)"]));
out.push("\n══ Provider 呼叫總數 ══");
out.push(`句子數（唯一 kind+text）=${uniq.length}；probe 條目=${PROBES.length}`);
out.push(`geoNull: geocode work=${totals.workNull.g} base=${totals.baseNull.g} ; weather work=${totals.workNull.w} base=${totals.baseNull.w}`);
out.push(`geoOk:   geocode work=${totals.workOk.g} base=${totals.baseOk.g} ; weather work=${totals.workOk.w} base=${totals.baseOk.w}`);
out.push(`fetch trap: work=${RUNS.workNull.fetchCalls + RUNS.workOk.fetchCalls} base=${RUNS.baseNull.fetchCalls + RUNS.baseOk.fetchCalls}`);
const totalBad = totals.workNull.g > totals.baseNull.g || totals.workOk.g > totals.baseOk.g || totals.workNull.w > totals.baseNull.w || totals.workOk.w > totals.baseOk.w;
if (totalBad) p1u.push("TOTAL geocode/weather work > base");
out.push(`\nverify-destination-authority-phase0: P1=${p1u.length} DIFF=${diffs.length} PRE=${pre.length} → ${p1u.length ? "FAIL" : "PASS"}`);
await new Promise((resolve) => process.stdout.write(`${out.join("\n")}\n`, resolve));
process.exit(p1u.length ? 1 : 0);
