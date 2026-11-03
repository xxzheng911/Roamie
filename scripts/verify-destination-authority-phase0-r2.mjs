#!/usr/bin/env node
/**
 * T20 — Destination Resolution Authority Phase 0 第 2 輪驗收（獨立審查）：工作區 vs aa2db59 逐句比對。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-authority-phase0-r2.mjs --config scripts/vite.verify.config.mjs
 *
 * 機制沿用 verify-destination-authority-phase0.mjs：主行程不載入 src，啟動 4 個 collect 子行程
 * （work×geoNull、base×geoNull、work×geoOk、base×geoOk）；base 子行程 cwd=基準 archive、基準 config。
 * globalThis.fetch 為 trap；所有 provider（geocode／weather）皆 mock；不使用 API Key、不產生 Google 費用。
 *
 * 本輪重點：
 *  - ROUTE-RECO：含「排／安排／規劃＋路線／動線」的推薦句（語序、否定、修飾、簡體、續推）→ route 必須 = base。
 *  - ROUTE-NEG：否定排路線但沒有推薦問句 → work 若新變 NEW_TRIP_PLANNING（會 beginTripCreation）= P1。
 *  - ROUTE-PLAN：真正要求排路線的規劃句 → work 應為規劃路由（base 不同屬使用者要求的預期變更，列 DIFF）。
 *  - MIXED：推薦＋排路線混合句 → 記錄 work/base；相同即非 regression，不同列 DIFF 人工判讀。
 *  - PLAN-CONTRACT：明確規劃句 work route = base route。
 *  - LEGIT-TAIL：結尾含描述詞 token 的合法地名 → intent dest 不得比 base 更短。
 *  每句皆實際呼叫 applyChatCreateAuthority(session, arbitration) 檢查是否 beginTripCreation
 *  （tripCreationAuthority.explicitCreate 由無變有），並比對 shouldSkipTripPlanningForRefinement。
 */
let fetchCalls = 0;
const fetchLog = [];
globalThis.fetch = async (...args) => {
  fetchCalls += 1;
  fetchLog.push(String(args[0]).slice(0, 160));
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};

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
const ROLE = process.env.VERIFY_P0R2_ROLE ?? "main";
const BASE_ROOT = process.env.VERIFY_P0R2_BASE_ROOT || DEFAULT_BASE_ROOT;
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase0-r2.mjs`;

// ════════════════════════ collect（子行程）════════════════════════
if (ROLE === "collect") {
  silence();
  const ROOT = process.env.VERIFY_ROOT;
  const GEO_MODE = process.env.VERIFY_P0R2_GEO ?? "null";
  const M = {
    arb: await import(`${ROOT}/src/lib/ai/recommendation-refinement/index.ts`),
    merge: await import(`${ROOT}/src/lib/ai/recommendation-refinement/merge.ts`),
    intent: await import(`${ROOT}/src/lib/ai/place-recommendation-intent/index.ts`),
    dtp: await import(`${ROOT}/src/lib/ai/destination-travel-profile.ts`),
    tpc: await import(`${ROOT}/src/lib/ai/trip-planning-context.ts`),
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
    cca: await import(`${ROOT}/src/lib/ai/chat-create-authority.ts`),
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

  // 與 verify-destination-authority-phase0.mjs 相同的 _app.chat.tsx 分派模擬（只到搜尋目的地決定為止）
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
    const out = { path: "", geocodes, weatherCalls, weatherDest: null, searchDest: null, route: null, beginTrip: null };
    try {
      const trimmed = text.trim();
      let nextSession = makeSession(kind);
      nextSession = M.convState.prepareSessionForUserTurn(nextSession, undefined);
      const merged = M.travelCtx.mergeTravelContext(nextSession, trimmed, undefined);
      nextSession = merged.session;
      if (merged.context.destinationCandidate?.status === "pending") {
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
      // _app.chat.tsx:8546-8548 — createArbitration → applyChatCreateAuthority
      const createArbitration = M.arb.resolveChatIntentArbitration(trimmed, nextSession);
      out.route = createArbitration.route;
      const before = Boolean(nextSession.tripCreationAuthority?.explicitCreate);
      const afterCreate = M.cca.applyChatCreateAuthority(
        nextSession,
        createArbitration,
        /(?:預覽|预览|preview|プレビュー|미리보기)/i.test(trimmed),
      );
      out.beginTrip = !before && Boolean(afterCreate.tripCreationAuthority?.explicitCreate);
      nextSession = afterCreate;
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
      out.path = "destination_category_search";
      out.searchDest = validatedAreaScope?.displayLabel ?? baseDestination ?? null;
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
    const arbitration = safe(() => M.arb.resolveChatIntentArbitration(text, s));
    const aObj = arbitration && typeof arbitration === "object" ? arbitration : null;
    const beginTrip = aObj
      ? safe(() => Boolean(M.cca.applyChatCreateAuthority(s, aObj, false).tripCreationAuthority?.explicitCreate))
      : null;
    return {
      route: aObj?.route ?? String(arbitration),
      reason: aObj?.reason ?? null,
      beginTrip,
      plan: safe(() => M.arb.isExplicitNewTripPlanningText(text)),
      skip: safe(() => M.arb.shouldSkipTripPlanningForRefinement(text, s)),
      routeRule: safe(() => Boolean(M.tls.isSightseeingRouteArrangementText?.(text))),
      hasReco: safe(() => M.intent.hasExplicitPlaceRecommendationIntent(text)),
      dest: pObj?.destinationName ?? null,
      type: pObj?.primaryType ?? null,
      cont: pObj?.continuation ?? null,
    };
  }

  const probes = JSON.parse(process.env.VERIFY_P0R2_PROBES ?? "[]");
  const out = {};
  for (const [text, kind] of probes) {
    out[`${kind}\u0000${text}`] = { ...observe(text, kind), sim: await simulateChatDispatch(text, kind) };
  }
  restore();
  await new Promise((resolve) =>
    process.stdout.write(
      `\n@@P0R2_JSON@@${JSON.stringify({ out, fetchCalls, fetchLog, hasCountModule: Boolean(countMod) })}\n`,
      resolve,
    ),
  );
  process.exit(0);
}

// ════════════════════════ main ════════════════════════
const { existsSync } = await import("node:fs");
const { spawnSync } = await import("node:child_process");

const PROBES = [];
const seen = new Set();
const add = (text, group, kind = "fresh", extra = {}) => {
  const key = `${kind}\u0000${text}\u0000${group}`;
  if (seen.has(key)) return;
  seen.add(key);
  PROBES.push({ text, group, kind, ...extra });
};

// ROUTE-RECO：推薦句（含排路線字樣）— route 必須與基準相同
const ROUTE_RECO = [
  // T19 P1 原句
  "推薦京都景點，不用安排路線",
  "推薦適合安排觀光路線的京都景點",
  "京都有哪些適合規劃路線的景點推薦",
  "推薦京都好安排路線的景點",
  // 否定變體
  "推薦京都景點，不用規劃路線",
  "推薦京都景點，不需要排路線",
  "推薦京都景點，先不要安排參觀路線",
  "推薦京都 5 個景點，不用排路線",
  "京都景點推薦，不必規劃動線",
  "京都有什麼景點推薦？不用安排路線",
  "不用安排路線，推薦京都景點就好",
  "不要規劃路線，只要推薦京都景點",
  "推薦幾個京都景點，路線我之後自己安排",
  "請推薦京都景點，我自己會安排路線",
  // 修飾／語序變體
  "有沒有適合排成一條觀光路線的京都景點推薦",
  "京都哪些景點適合安排參觀路線？推薦一下",
  "推薦京都好規劃動線的景點",
  "想找京都容易安排遊覽路線的景點，推薦幾個",
  "推薦一些順路的京都景點，方便安排路線",
  "京都觀光景點推薦，要好規劃路線的",
  "推薦大阪適合安排一日觀光路線的景點",
  "東京有哪些適合規劃散步路線的景點推薦",
  // 簡體
  "推荐京都景点，不用安排路线",
  "京都有哪些适合规划路线的景点推荐",
  "推荐京都好安排路线的景点",
];
for (const t of ROUTE_RECO) add(t, "ROUTE-RECO");
// 推薦中（京都 active context）的續推／改條件句
for (const t of [
  "再推薦幾個好安排路線的景點",
  "還有其他適合安排觀光路線的景點嗎",
  "推薦更多景點，不用安排路線",
  "換成大阪景點推薦，不用規劃路線",
]) {
  add(t, "ROUTE-RECO", "kyoto");
}

// ROUTE-NEG：否定排路線但沒有推薦問句 — work 不得新變 NEW_TRIP_PLANNING
for (const [t, kind] of [
  ["不用安排觀光路線", "kyoto"],
  ["景點不需要規劃參觀路線", "kyoto"],
  ["先不要規劃景點路線", "kyoto"],
  ["我不想安排觀光路線，只是看看景點", "kyoto"],
  ["不用安排觀光路線", "fresh"],
  ["我不想規劃京都景點路線", "fresh"],
  ["京都景點不用排路線", "fresh"],
  ["安排觀光路線很麻煩嗎", "fresh"],
  ["京都景點的路線很難安排", "fresh"],
  ["規劃觀光路線要注意什麼", "fresh"],
]) {
  add(t, "ROUTE-NEG", kind);
}

// ROUTE-PLAN：真正要求排路線（work 應走規劃）
for (const [t, kind] of [
  ["幫我排一下京都景點的路線", "fresh"],
  ["幫我安排京都觀光路線", "fresh"],
  ["請幫我規劃京都景點的參觀路線", "fresh"],
  ["排一條京都觀光路線", "fresh"],
  ["規劃一下京都景點動線", "fresh"],
  ["幫我把京都這些景點排成一條參觀路線", "fresh"],
  ["帮我排一下京都景点的路线", "fresh"],
  ["這些景點幫我排一下路線", "kyoto"],
  ["幫我把這些景點安排成觀光路線", "kyoto"],
  ["這幾個景點可以排個參觀動線嗎", "kyoto"],
]) {
  add(t, "ROUTE-PLAN", kind);
}

// MIXED：推薦＋排路線
for (const [t, kind] of [
  ["推薦京都景點並幫我排觀光路線", "fresh"],
  ["推薦京都景點然後幫我安排路線", "fresh"],
  ["先推薦京都景點，再規劃參觀路線", "fresh"],
  ["京都景點推薦並排一條觀光路線", "fresh"],
  ["推薦京都景點，之後再幫我規劃路線", "fresh"],
  ["推薦 5 個京都景點，順便幫我排參觀動線", "fresh"],
  ["京都景點推薦，參觀路線怎麼安排比較順", "fresh"],
  ["再推薦幾個景點，然後幫我排觀光路線", "kyoto"],
]) {
  add(t, "MIXED", kind);
}

// PLAN-CONTRACT：明確規劃句 work = base
for (const [t, kind] of [
  ["京都三天行程規劃", "fresh"],
  ["幫我規劃京都三天行程", "fresh"],
  ["我想去京都玩三天", "fresh"],
  ["我想去大阪玩 5 天", "fresh"],
  ["12月去京都旅行", "fresh"],
  ["下個月想去北海道旅遊", "fresh"],
  ["明年暑假要去沖繩", "fresh"],
  ["幫我安排大阪兩天行程", "fresh"],
  ["幫我排京都五天四夜行程", "fresh"],
  ["規劃東京 4 天", "fresh"],
  ["建立新行程", "fresh"],
  ["幫我規劃京都行程", "fresh"],
  ["我想去京都玩三天，推薦 5 個景點", "fresh"],
  ["plan a 3 day trip to Kyoto", "fresh"],
  ["京都旅行計畫", "fresh"],
  ["幫我規劃京都三天行程", "kyoto"],
  ["我想去京都玩三天", "kyoto"],
  ["12月去大阪旅行", "kyoto"],
  ["幫我排成三天行程", "kyoto"],
]) {
  add(t, "PLAN-CONTRACT", kind);
}

// LEGIT-TAIL：合法地名（部分結尾接近描述詞 token）— intent dest 不得比基準短
for (const [t, full] of [
  ["台北士林夜市推薦景點", "台北士林夜市"],
  ["高雄駁二藝術特區推薦景點", "高雄駁二藝術特區"],
  ["花蓮太魯閣推薦景點", "花蓮太魯閣"],
  ["宜蘭傳統藝術中心推薦景點", "宜蘭傳統藝術中心"],
  ["台中審計新村推薦景點", "台中審計新村"],
  ["京都嵐山推薦景點", "京都嵐山"],
  ["台北大安推薦咖啡廳", "台北大安"],
  ["東京台場推薦景點", "東京台場"],
  ["我想去京都嵐山，推薦景點", "京都嵐山"],
  ["台南安平推薦景點", "台南安平"],
]) {
  add(t, "LEGIT-TAIL", "fresh", { full });
}

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
  const res = spawnSync("npx", ["vite-node", SCRIPT, "--config", `${root}/scripts/vite.verify.config.mjs`], {
    cwd: root,
    encoding: "utf8",
    timeout: 500000,
    maxBuffer: 128 * 1024 * 1024,
    env: {
      ...process.env,
      VERIFY_P0R2_ROLE: "collect",
      VERIFY_ROOT: root,
      VERIFY_P0R2_GEO: geo,
      VERIFY_P0R2_PROBES: JSON.stringify(uniq),
    },
  });
  const line = String(res.stdout ?? "").split("\n").find((l) => l.startsWith("@@P0R2_JSON@@"));
  if (!line) return { err: `status=${res.status} signal=${res.signal} stderr=${String(res.stderr ?? "").slice(-800)}` };
  return JSON.parse(line.slice("@@P0R2_JSON@@".length));
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
const infra = [];
for (const [name, r] of Object.entries(RUNS)) {
  if (r.err) infra.push(`INFRA-FAIL\t${name}\t${r.err}`);
  else if (r.fetchCalls !== 0) infra.push(`INFRA-FAIL\t${name}\tfetchCalls=${r.fetchCalls} ${r.fetchLog.join(";")}`);
}
if (!RUNS.baseNull.err && RUNS.baseNull.hasCountModule) infra.push("INFRA-FAIL\tbaseNull\t基準子行程載入了工作樹模組");
if (!RUNS.baseNull.err && Object.values(RUNS.baseNull.out).some((o) => o.routeRule)) {
  infra.push("INFRA-FAIL\tbaseNull\t基準子行程出現 isSightseeingRouteArrangementText（疑似混入工作樹模組）");
}
if (infra.length) {
  console.log(infra.join("\n"));
  process.exit(1);
}

const RECO = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS", "NEW_DESTINATION"]);
const PLAN = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
const p1 = [];
const p2 = [];
const diffs = [];
const table = [];
const totals = { workNull: { g: 0, w: 0 }, baseNull: { g: 0, w: 0 }, workOk: { g: 0, w: 0 }, baseOk: { g: 0, w: 0 } };
for (const [t, kind] of uniq) {
  const k = `${kind}\u0000${t}`;
  for (const name of Object.keys(totals)) {
    totals[name].g += RUNS[name].out[k].sim.geocodes.length;
    totals[name].w += RUNS[name].out[k].sim.weatherCalls.length;
  }
}

for (const p of PROBES) {
  const k = `${p.kind}\u0000${p.text}`;
  const tag = `[${p.group}]${p.kind === "fresh" ? "" : `[${p.kind}]`} ${p.text}`;
  const w = RUNS.workNull.out[k];
  const b = RUNS.baseNull.out[k];
  // ── provider 成本（兩種 geo 模式）──
  for (const mode of ["Null", "Ok"]) {
    const ws = RUNS[`work${mode}`].out[k].sim;
    const bs = RUNS[`base${mode}`].out[k].sim;
    if (ws.geocodes.length > bs.geocodes.length) p1.push(`${tag} (geo${mode}) geocode work=${ws.geocodes.length} > base=${bs.geocodes.length}`);
    if (ws.weatherCalls.length > bs.weatherCalls.length) p1.push(`${tag} (geo${mode}) weather work=${ws.weatherCalls.length} > base=${bs.weatherCalls.length}`);
    if (ws.route !== bs.route) diffs.push(`${tag} (geo${mode}) sim.route ${bs.route} → ${ws.route}`);
    if (ws.beginTrip && !bs.beginTrip && p.group !== "ROUTE-PLAN") p1.push(`${tag} (geo${mode}) 分派模擬新增 beginTripCreation（base 不會）`);
    if (JSON.stringify([ws.path, ws.searchDest, ws.weatherDest]) !== JSON.stringify([bs.path, bs.searchDest, bs.weatherDest])) {
      diffs.push(`${tag} (geo${mode}) sim path/search/weather base=${bs.path}|${bs.searchDest}|${bs.weatherDest} work=${ws.path}|${ws.searchDest}|${ws.weatherDest}`);
    }
  }
  const routeChanged = w.route !== b.route;
  const beginNew = Boolean(w.beginTrip) && !b.beginTrip;
  switch (p.group) {
    case "ROUTE-RECO":
      if (routeChanged) p1.push(`${tag} 推薦句路由與基準不同 ${b.route} → ${w.route}`);
      if (beginNew) p1.push(`${tag} 推薦句新增 beginTripCreation`);
      if (w.skip !== b.skip) p1.push(`${tag} shouldSkipTripPlanningForRefinement ${b.skip} → ${w.skip}`);
      break;
    case "ROUTE-NEG":
      if (w.route === "NEW_TRIP_PLANNING" && b.route !== "NEW_TRIP_PLANNING") {
        p1.push(`${tag} 否定排路線卻新變 NEW_TRIP_PLANNING（會 beginTripCreation）base=${b.route}`);
      } else if (routeChanged) diffs.push(`${tag} route ${b.route} → ${w.route}`);
      break;
    case "ROUTE-PLAN":
      if (!PLAN.has(w.route)) p2.push(`${tag} 明確排路線未走規劃 work=${w.route} base=${b.route}`);
      if (routeChanged) diffs.push(`${tag} route ${b.route} → ${w.route}（預期：排路線改走規劃）`);
      break;
    case "MIXED":
      if (routeChanged) diffs.push(`${tag} route ${b.route} → ${w.route} beginTrip ${b.beginTrip} → ${w.beginTrip}`);
      if (RECO.has(b.route) && PLAN.has(w.route)) p1.push(`${tag} 混合句推薦→規劃 ${b.route} → ${w.route}`);
      break;
    case "PLAN-CONTRACT":
      if (routeChanged) p1.push(`${tag} 規劃契約路由不同 ${b.route} → ${w.route}`);
      if (w.beginTrip !== b.beginTrip) p1.push(`${tag} 規劃契約 beginTrip ${b.beginTrip} → ${w.beginTrip}`);
      break;
    case "LEGIT-TAIL":
      if (typeof w.dest === "string" && typeof b.dest === "string" && w.dest !== b.dest && b.dest.startsWith(w.dest) && p.full.startsWith(b.dest)) {
        p1.push(`${tag} 合法地名 dest 被截斷 base=${b.dest} work=${w.dest}`);
      } else if (w.dest !== b.dest) diffs.push(`${tag} dest ${b.dest} → ${w.dest}`);
      if (routeChanged) p1.push(`${tag} 路由不同 ${b.route} → ${w.route}`);
      break;
    default:
      break;
  }
  table.push(
    `${tag}\n    work: route=${w.route} reason=${w.reason} beginTrip=${w.beginTrip} plan=${w.plan} rule=${w.routeRule} hasReco=${w.hasReco} skip=${w.skip} dest=${w.dest} path=${w.sim.path}` +
      `\n    base: route=${b.route} reason=${b.reason} beginTrip=${b.beginTrip} plan=${b.plan} hasReco=${b.hasReco} skip=${b.skip} dest=${b.dest} path=${b.sim.path}`,
  );
}

const out = [];
out.push("══ 每句 work/base 對照表（geoNull）══", ...table);
out.push("\n══ DIFF（work≠base，人工判讀）══", ...(diffs.length ? [...new Set(diffs)] : ["(none)"]));
out.push("\n══ P2 ══", ...(p2.length ? p2 : ["(none)"]));
const totalBad =
  totals.workNull.g > totals.baseNull.g || totals.workOk.g > totals.baseOk.g || totals.workNull.w > totals.baseNull.w || totals.workOk.w > totals.baseOk.w;
if (totalBad) p1.push("TOTAL geocode/weather work > base");
const p1u = [...new Set(p1)];
out.push("\n══ 新增 P1 ══", ...(p1u.length ? p1u : ["(none)"]));
out.push("\n══ Provider 呼叫總數 ══");
out.push(`句子數（唯一 kind+text）=${uniq.length}；probe 條目=${PROBES.length}`);
out.push(`geoNull: geocode work=${totals.workNull.g} base=${totals.baseNull.g} ; weather work=${totals.workNull.w} base=${totals.baseNull.w}`);
out.push(`geoOk:   geocode work=${totals.workOk.g} base=${totals.baseOk.g} ; weather work=${totals.workOk.w} base=${totals.baseOk.w}`);
out.push(`fetch trap: work=${RUNS.workNull.fetchCalls + RUNS.workOk.fetchCalls} base=${RUNS.baseNull.fetchCalls + RUNS.baseOk.fetchCalls}`);
out.push(`\nverify-destination-authority-phase0-r2: P1=${p1u.length} P2=${p2.length} DIFF=${new Set(diffs).size} → ${p1u.length ? "FAIL" : "PASS"}`);
await new Promise((resolve) => process.stdout.write(`${out.join("\n")}\n`, resolve));
process.exit(p1u.length ? 1 : 0);
