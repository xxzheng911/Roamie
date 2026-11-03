#!/usr/bin/env node
/**
 * T21 — Destination Resolution Authority Phase 0 第 3 輪驗收（獨立審查）：工作區 vs aa2db59 嚴格逐欄比對。
 *
 * 執行：
 *   npx vite-node scripts/verify-destination-authority-phase0-r3.mjs --config scripts/vite.verify.config.mjs
 *
 * 機制沿用 verify-destination-authority-phase0-r2.mjs（4 個 collect 子行程；base 以基準 archive 為 cwd）。
 * globalThis.fetch 為 trap；geocode／weather 全 mock；不使用 API Key、不產生 Google 費用。
 *
 * 本輪（「排路線走規劃」規則已撤回）判定：
 *  - STRICT：T20 否定／詢問句與撤回的排路線句（新對話＋京都推薦中）。
 *    route、reason、beginTrip、skip、sim.route、sim.beginTrip、sim.path、searchDest、weatherDest、
 *    geocode／weather 次數任一 ≠ base → P1（不得有任何差異）。
 *  - DESC-CTX：京都推薦中，「京都＋描述詞」但非典型推薦問句（arbitrate.ts:176 destination_switch 比對
 *    placeIntent.destinationName，描述詞剝除可能改變分支）→ 除 intent dest 外任一欄 ≠ base → P1；
 *    僅 reason 不同但 route／beginTrip／sim 全同 → DIFF（人工判讀）。
 *  - LEGIT：含描述詞 token 結尾的合法地名／常見簡稱 → sim 欄位 ≠ base → P1；intent dest 被截短 → DIFF。
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
const ROLE = process.env.VERIFY_P0R3_ROLE ?? "main";
const BASE_ROOT = process.env.VERIFY_P0R3_BASE_ROOT || DEFAULT_BASE_ROOT;
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase0-r3.mjs`;

// ════════════════════════ collect（子行程）════════════════════════
if (ROLE === "collect") {
  silence();
  const ROOT = process.env.VERIFY_ROOT;
  const GEO_MODE = process.env.VERIFY_P0R3_GEO ?? "null";
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
    refresh: await import(`${ROOT}/src/lib/ai/chat-recommendation-refresh.ts`),
    dining: await import(`${ROOT}/src/lib/ai/chat-dining-flow.ts`),
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
    const topic = kind === "kyotoFood" ? "restaurant" : "attraction";
    return baseSession({
      activeRecommendationContext: M.merge.createActiveRecommendationContext({
        destinationName: city,
        intent: topic,
        category: topic,
        placeIds: ["p1", "p2", "p3"],
      }),
      activeCategoryIntent: topic,
      recommendationSession: { topic, destination: city },
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

  // 與 r2 相同的 _app.chat.tsx 分派模擬（只到搜尋目的地決定為止）
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
      skip: safe(() => M.arb.shouldSkipTripPlanningForRefinement(text, s)),
      routeRule: typeof M.tls.isSightseeingRouteArrangementText === "function",
      dest: pObj?.destinationName ?? null,
      type: pObj?.primaryType ?? null,
      // chat-dining-flow.ts:158-182 依 arbitration.route 決定 ChatIntent（REFINEMENT 沿用 session 類別）
      chatIntent: safe(() => M.dining.resolveChatIntent(text, s)),
      // _app.chat.tsx:9130 前置閘：shouldRefetchPlaces 為 true 時，9250 依 route 分流
      // （RECOMMENDATION_REFINEMENT → pushRecommendationRefinement；否則 pushMorePlaceRecommendations）
      refetch:
        kind === "fresh"
          ? null
          : safe(() =>
              Boolean(
                M.refresh.shouldRefetchPlaces(
                  text,
                  { ...s, recommendedPlaceIds: ["p1", "p2", "p3"] },
                  { destination: kind === "osaka" ? "大阪" : "京都", interests: [] },
                  undefined,
                ),
              ),
            ),
    };
  }

  const probes = JSON.parse(process.env.VERIFY_P0R3_PROBES ?? "[]");
  const out = {};
  for (const [text, kind] of probes) {
    out[`${kind}\u0000${text}`] = { ...observe(text, kind), sim: await simulateChatDispatch(text, kind) };
  }
  restore();
  await new Promise((resolve) =>
    process.stdout.write(
      `\n@@P0R3_JSON@@${JSON.stringify({ out, fetchCalls, fetchLog, hasCountModule: Boolean(countMod) })}\n`,
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
const add = (text, group, kind = "fresh") => {
  const key = `${kind}\u0000${text}\u0000${group}`;
  if (seen.has(key)) return;
  seen.add(key);
  PROBES.push({ text, group, kind });
};

// STRICT：T20 否定／詢問句＋撤回的排路線句，新對話與京都推薦中皆須與基準逐欄相同
const STRICT = [
  "不用安排觀光路線",
  "景點不需要規劃參觀路線",
  "安排觀光路線很麻煩嗎",
  "規劃觀光路線要注意什麼",
  "先不要規劃景點路線",
  "我不想安排觀光路線，只是看看景點",
  "京都景點不用排路線",
  "幫我排一下京都景點的路線",
  "幫我安排京都觀光路線",
  "這些景點幫我排一下路線",
  "排一條京都觀光路線",
  "京都幫我推薦景點",
  "我想去京都，推薦一些景點",
  "京都三天行程規劃",
];
for (const t of STRICT) {
  add(t, "STRICT", "fresh");
  add(t, "STRICT", "kyoto");
}

// DESC-CTX：京都推薦中的「京都＋描述詞」句（arbitrate destination_switch 分支敏感）
for (const t of [
  "京都冷門的呢",
  "那京都冷門景點呢",
  "京都有什麼冷門景點",
  "京都冷門",
  "京都在地一點的",
  "京都在地美食",
  "京都比較冷門的景點",
  "京都熱門景點",
  "京都歷史文化景點",
  "京都秘境",
  "京都私房景點有嗎",
  "京都好玩的地方",
  "京都親子景點",
  "京都冷門景點推薦 5 個",
  "京都自然景點",
]) {
  add(t, "DESC-CTX", "kyoto");
  add(t, "DESC-CTX", "osaka");
}

// DESC-CTX（京都餐廳推薦中問景點；京都景點推薦中問美食）— 跨類別時 REFINEMENT 會沿用 session 類別
for (const [t, kind] of [
  ["京都親子景點", "kyotoFood"],
  ["京都自然景點", "kyotoFood"],
  ["京都歷史文化景點", "kyotoFood"],
  ["京都私房景點有嗎", "kyotoFood"],
  ["京都冷門景點推薦", "kyotoFood"],
  ["京都私房美食", "kyoto"],
  ["京都冷門咖啡廳", "kyoto"],
  ["京都在地美食推薦", "kyoto"],
  ["京都親子餐廳", "kyoto"],
]) {
  add(t, "DESC-CTX", kind);
}

// LEGIT：含描述詞 token 結尾的合法地名／常見簡稱
for (const t of [
  "高雄駁二藝術推薦景點",
  "宜蘭傳統藝術推薦景點",
  "台北華山文創推薦景點",
  "京都哲學之道推薦景點",
  "台北士林夜市推薦景點",
  "京都嵐山推薦景點",
  "北海道富良野推薦景點",
  "台南安平古堡推薦景點",
  "我想去京都嵐山，推薦景點",
]) {
  add(t, "LEGIT", "fresh");
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
      VERIFY_P0R3_ROLE: "collect",
      VERIFY_ROOT: root,
      VERIFY_P0R3_GEO: geo,
      VERIFY_P0R3_PROBES: JSON.stringify(uniq),
    },
  });
  const line = String(res.stdout ?? "").split("\n").find((l) => l.startsWith("@@P0R3_JSON@@"));
  if (!line) return { err: `status=${res.status} signal=${res.signal} stderr=${String(res.stderr ?? "").slice(-800)}` };
  return JSON.parse(line.slice("@@P0R3_JSON@@".length));
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
if (infra.length) {
  console.log(infra.join("\n"));
  process.exit(1);
}

const p1 = [];
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
const routeRuleInWork = Object.values(RUNS.workNull.out).some((o) => o.routeRule);

const simKey = (s) =>
  JSON.stringify([s.route, s.beginTrip, s.path, s.searchDest, s.weatherDest, s.geocodes.length, s.weatherCalls.length]);

for (const p of PROBES) {
  const k = `${p.kind}\u0000${p.text}`;
  const tag = `[${p.group}]${p.kind === "fresh" ? "" : `[${p.kind}]`} ${p.text}`;
  const w = RUNS.workNull.out[k];
  const b = RUNS.baseNull.out[k];
  for (const mode of ["Null", "Ok"]) {
    const ws = RUNS[`work${mode}`].out[k].sim;
    const bs = RUNS[`base${mode}`].out[k].sim;
    if (simKey(ws) !== simKey(bs)) p1.push(`${tag} (geo${mode}) sim 不同 base=${simKey(bs)} work=${simKey(ws)}`);
  }
  const coreSame = w.route === b.route && w.beginTrip === b.beginTrip && w.skip === b.skip;
  if (!coreSame) {
    p1.push(`${tag} route/beginTrip/skip base=${b.route}/${b.beginTrip}/${b.skip} work=${w.route}/${w.beginTrip}/${w.skip}`);
  }
  if (w.reason !== b.reason) {
    if (p.group === "STRICT") p1.push(`${tag} reason ${b.reason} → ${w.reason}`);
    else diffs.push(`${tag} reason ${b.reason} → ${w.reason}（route ${b.route} → ${w.route}）`);
  }
  if (w.dest !== b.dest) diffs.push(`${tag} intent dest ${b.dest} → ${w.dest}`);
  if (w.refetch !== b.refetch) p1.push(`${tag} shouldRefetchPlaces ${b.refetch} → ${w.refetch}`);
  if (w.chatIntent !== b.chatIntent) p1.push(`${tag} resolveChatIntent ${b.chatIntent} → ${w.chatIntent}`);
  table.push(
    `${tag}\n    work: route=${w.route} reason=${w.reason} beginTrip=${w.beginTrip} skip=${w.skip} refetch=${w.refetch} dest=${w.dest} path=${w.sim.path} search=${w.sim.searchDest} wx=${w.sim.weatherDest}` +
      `\n    base: route=${b.route} reason=${b.reason} beginTrip=${b.beginTrip} skip=${b.skip} refetch=${b.refetch} dest=${b.dest} path=${b.sim.path} search=${b.sim.searchDest} wx=${b.sim.weatherDest}`,
  );
}

const out = [];
out.push("══ 每句 work/base 對照表（geoNull）══", ...table);
out.push(`\nisSightseeingRouteArrangementText 存在於工作樹：${routeRuleInWork}`);
out.push("\n══ DIFF（work≠base，人工判讀）══", ...(diffs.length ? [...new Set(diffs)] : ["(none)"]));
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
out.push(`\nverify-destination-authority-phase0-r3: P1=${p1u.length} DIFF=${new Set(diffs).size} → ${p1u.length ? "FAIL" : "PASS"}`);
await new Promise((resolve) => process.stdout.write(`${out.join("\n")}\n`, resolve));
process.exit(p1u.length ? 1 : 0);
