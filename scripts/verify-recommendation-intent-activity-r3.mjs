#!/usr/bin/env node
/**
 * T18 — Recommendation Intent／Activity／Quantity 第 3 輪獨立驗收（補測）。
 *
 * 執行：
 *   npx vite-node scripts/verify-recommendation-intent-activity-r3.mjs --config scripts/vite.verify.config.mjs
 *   （可加句子參數：額外印出 DUMP 觀測，含正式 Chat 分派模擬）
 *
 * 與 T16／T17 不同處：本腳本以「正式 Chat send handler 的實際分派順序」模擬到搜尋目的地為止
 * （src/routes/_app.chat.tsx），全部呼叫真實 lib 函式，geocodeFn／fetchWeatherFn 為計數 mock：
 *   8671 mergeTravelContext → 8675 resolveGlobalPlanningCandidate（geocode）→ 8684 澄清分支
 *   → 8706 mergeTripPlanningContext → 8793–8797 extract* → 9460 prefetchDestinationWeather（geocode）
 *   → 9486 shouldFetchDestinationPlaces → 9506 shouldFetchDestinationCategoryPlaces
 *   → 9516 resolveChatRouteAuthority → 9563 pushDestinationCategoryPlaceRecommendation：
 *     5636 mergeTravelContext、5652 parseChatPlaceIntents、5654 extractProvisionalDestinationAreaCandidate、
 *     5655 resolveValidatedDestinationAreaScope（geocode）、5661 澄清、5692 resolveDestinationForCategorySearch、
 *     5698 destination（= 搜尋目的地 = Credits metadata.destination）
 * 未模擬 9595 之後（規劃／refinement 等）的分支；那些路徑以 arbitration route 記錄。
 *
 * 基準比對：子行程（cwd = 基準目錄、基準自己的 vite.verify.config）跑同一支腳本的 collect 角色，
 * VERIFY_ROOT 指向 aa2db59 archive。基準不可用時所有需基準的檢查記為 FAIL。
 *
 * 成本：globalThis.fetch 為 trap（計數並拋錯）；geocodeFn／fetchWeatherFn 計數，並與基準逐句比對。
 * FAIL 標註：NEW = 基準在同一述詞上通過、工作區不通過；PRE = 基準本來就不通過。
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
silence();

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DEFAULT_BASE_ROOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const ROLE = process.env.VERIFY_R3_ROLE ?? "main";
const ROOT = ROLE === "collect" ? process.env.VERIFY_ROOT : WORK_ROOT;
const BASE_ROOT = process.env.VERIFY_R3_BASE_ROOT || DEFAULT_BASE_ROOT;

async function loadModules(root) {
  const opt = async (p) => {
    try {
      return await import(`${root}/${p}`);
    } catch {
      return null;
    }
  };
  return {
    arb: await import(`${root}/src/lib/ai/recommendation-refinement/index.ts`),
    merge: await import(`${root}/src/lib/ai/recommendation-refinement/merge.ts`),
    intent: await import(`${root}/src/lib/ai/place-recommendation-intent/index.ts`),
    dtp: await import(`${root}/src/lib/ai/destination-travel-profile.ts`),
    tpc: await import(`${root}/src/lib/ai/trip-planning-context.ts`),
    router: await import(`${root}/src/lib/ai/chat-intent-router.ts`),
    chatIntent: await import(`${root}/src/lib/ai/chat-intent.ts`),
    catDest: await import(`${root}/src/lib/ai/chat-category-destination.ts`),
    placeIntent: await import(`${root}/src/lib/ai/chat-place-intent.ts`),
    travelCtx: await import(`${root}/src/lib/ai/travel-context.ts`),
    gpc: await import(`${root}/src/lib/ai/global-planning-context.ts`),
    mvp: await import(`${root}/src/lib/ai/must-visit-places.ts`),
    weather: await import(`${root}/src/lib/ai/destination-weather-prefetch.ts`),
    nearbyClar: await import(`${root}/src/lib/ai/nearby-location-clarification.ts`),
    convState: await import(`${root}/src/lib/ai/chat-conversation-state.ts`),
    chatSession: await import(`${root}/src/lib/chat-session.ts`),
    planFlow: await import(`${root}/src/lib/chat-planning-flow.ts`),
    count: await opt("src/lib/ai/requested-recommendation-count.ts"),
  };
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
function makeSession(M, kind) {
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

/**
 * 正式 Chat send handler 分派模擬（見檔頭行號）。geocode 一律回傳 location=null（provider 無法驗證）。
 * 回傳 path、所有 geocode 查詢字串、搜尋目的地、Credits metadata.destination。
 */
async function simulateChatDispatch(M, text, kind = "fresh") {
  const geocodes = [];
  const weatherCalls = [];
  const geocodeFn = async (req) => {
    geocodes.push(String(req?.data?.query ?? req?.data?.destinationName ?? ""));
    return { location: null, providerResult: { rawResultCount: 0 } };
  };
  const fetchWeatherFn = async (req) => {
    weatherCalls.push(JSON.stringify(req?.data ?? {}));
    return null;
  };
  const out = { path: "", geocodes, weatherCalls, searchDest: null, creditsDest: null, mergedDest: null, route: null, step: [] };
  try {
    const trimmed = text.trim();
    let nextSession = makeSession(M, kind);
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
      out.step.push(`weather_prefetch:${placeFetchContext.destination}`);
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
      out.path = `later:${authority}:${out.route}`;
      return out;
    }
    // pushDestinationCategoryPlaceRecommendation
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
    out.creditsDest = destination ?? null; // 5710 metadata: { path, destination, intents }
    return out;
  } catch (e) {
    out.path = `THROW:${e?.message ?? e}`;
    return out;
  }
}

function observe(M, text, kind = "fresh") {
  const s = makeSession(M, kind);
  const opts = kind === "fresh" ? undefined : { hasActiveRecommendationContext: true, activePrimaryType: "attraction" };
  const p = safe(() => M.intent.parsePlaceRecommendationIntent(text, opts));
  const pObj = p && typeof p === "object" ? p : null;
  const sc = safe(() => M.dtp.resolveDestinationAreaScope(text));
  const scObj = sc && typeof sc === "object" ? sc : null;
  const tc = safe(() => M.travelCtx.parseTravelContextFromText(text, s));
  return {
    route: safe(() => M.arb.resolveChatIntentArbitration(text, s).route),
    tpt: safe(() => M.router.isTravelPlanningText(text)),
    rci: safe(() => M.chatIntent.resolveChatIntent?.(text, s) ?? null),
    dest: pObj?.destinationName ?? null,
    type: pObj?.primaryType ?? null,
    act: pObj?.activityPreference ?? null,
    cnt: pObj?.requestedCount ?? null,
    scope: scObj ? `${scObj.displayLabel}|${scObj.parentCity}|${scObj.area}|${scObj.searchScope}` : String(sc),
    from: safe(() => M.tpc.resolveDestinationFromText(text)),
    catDest: safe(() => M.catDest.resolveDestinationForCategorySearch({}, s, text)),
    tcDest: tc && typeof tc === "object" ? (tc.destination ?? null) : String(tc),
    cats: safe(() => M.placeIntent.parseChatPlaceIntents(text)),
  };
}

async function observeAll(M, text, kind) {
  return { ...observe(M, text, kind), sim: await simulateChatDispatch(M, text, kind) };
}

if (ROLE === "collect") {
  const M = await loadModules(ROOT);
  const probes = JSON.parse(process.env.VERIFY_R3_PROBES ?? "[]");
  const out = {};
  for (const [text, kind] of probes) out[`${kind}\u0000${text}`] = await observeAll(M, text, kind);
  const cnt = {};
  for (const t of JSON.parse(process.env.VERIFY_R3_COUNT_PROBES ?? "[]")) {
    cnt[t] = M.count?.parseRequestedRecommendationCount ? safe(() => M.count.parseRequestedRecommendationCount(t)) : "MODULE_MISSING";
  }
  restore();
  await new Promise((resolve) =>
    process.stdout.write(`\n@@BASE_JSON@@${JSON.stringify({ out, cnt, fetchCalls, fetchLog })}\n`, resolve),
  );
  process.exit(0);
}

// ════════════════════════ main（工作區） ════════════════════════
const { existsSync } = await import("node:fs");
const { spawnSync } = await import("node:child_process");
const path = await import("node:path");
const W = await loadModules(WORK_ROOT);

const results = [];
const GROUPS = [
  "01-LegitPlaceIntegrity",
  "02-ChatSearchDestination",
  "03-RecommendationIntent",
  "04-PlanningIntent",
  "05-FoodIntent",
  "06-RequestedCount",
  "07-DestinationScope",
  "08-CrossDestination",
  "09-Continuation",
  "X-Activity",
  "X-ProviderCalls",
];
function check(group, id, label, ok, actual, tag = "") {
  results.push({ group, id, label, ok: Boolean(ok), actual: String(actual ?? ""), tag });
}
const info = (group, id, label, actual) => results.push({ group, id, label, ok: true, actual: `INFO ${actual}`, tag: "" });
const RECO = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS"]);
const PLAN = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
const fmtSim = (s) =>
  s ? `path=${s.path} searchDest=${s.searchDest} credits=${s.creditsDest} geocode=[${s.geocodes.join(",")}] weather=${s.weatherCalls.length} merged=${s.mergedDest} route=${s.route}` : "N/A";
const fmt = (o) =>
  o
    ? `route=${o.route} tpt=${o.tpt} dest=${o.dest} type=${o.type} act=${o.act} cnt=${o.cnt} scope=${o.scope} from=${o.from} catDest=${o.catDest} tc=${o.tcDest} cats=${JSON.stringify(o.cats)} | SIM ${fmtSim(o.sim)}`
    : "N/A";

const baseProbes = new Map();
const countProbes = new Set();
const deferred = [];
const workCache = new Map();
const need = (t, kind = "fresh") => {
  const k = `${kind}\u0000${t}`;
  baseProbes.set(k, [t, kind]);
  return k;
};
async function work(t, kind = "fresh") {
  const k = `${kind}\u0000${t}`;
  if (!workCache.has(k)) workCache.set(k, await observeAll(W, t, kind));
  return workCache.get(k);
}
/** 同一述詞判斷基準：基準也不通過 → PRE，否則 NEW。 */
function vsBase(group, id, label, t, pred, kind = "fresh") {
  const k = need(t, kind);
  deferred.push(async (B) => {
    const o = await work(t, kind);
    const b = B[k];
    const ok = pred(o, b);
    check(group, id, label, ok, `work: ${fmt(o)} || base: ${fmt(b)}`, ok ? "" : b && pred(b, b) ? "NEW" : "PRE");
  });
}
/**
 * 正式分派 path／搜尋目的地與基準一致。需求 B 路由變更（基準規劃 → 推薦）且工作區搜尋目的地
 * （或 parse destinationName）=== full（使用者指定的完整地名）時列 INFO（EXP-B）；地名被截斷或改變一律 NEW。
 */
function simParity(group, id, label, t, full, kind = "fresh") {
  const k = need(t, kind);
  deferred.push(async (B) => {
    const o = await work(t, kind);
    const b = B[k];
    const same = b && o.sim.path === b.sim.path && o.sim.searchDest === b.sim.searchDest;
    const detail = `work: ${fmt(o)} || base: ${fmt(b)}`;
    if (!same && b && PLAN.has(b.route) && RECO.has(o.route) && full && (o.sim.searchDest ?? o.dest) === full) {
      info(group, `${id}-EXP-B`, `${label}（需求 B 路由變更，目的地維持完整「${full}」）`, detail);
      return;
    }
    check(group, id, label, same, detail, same ? "" : "NEW");
  });
}
/** geocode 查詢不得超出基準（新增查詢字串或次數增加 = NEW）。 */
function noNewGeocode(group, t, kind = "fresh", verifiedCity = null) {
  const k = need(t, kind);
  deferred.push(async (B) => {
    const o = await work(t, kind);
    const b = B[k];
    const extra = o.sim.geocodes.filter((q) => !(b?.sim?.geocodes ?? []).includes(q));
    const ok = b && extra.length === 0 && o.sim.geocodes.length <= b.sim.geocodes.length;
    const detail = `work=[${o.sim.geocodes.join(",")}] base=[${(b?.sim?.geocodes ?? []).join(",")}] newQueries=[${extra.join(",")}] | work ${fmtSim(o.sim)} || base ${fmtSim(b?.sim)}`;
    // 需求 B 要求的路由變更（基準規劃 → 推薦）：若新增查詢的地名主幹 === 使用者要求的完整目的地
    // （搜尋目的地或 parse destinationName，且該目的地本身不是併入活動的整串），屬推薦流程既有的
    // area 驗證／天氣 prefetch，列 INFO（EXP-B）待指派者裁定；其餘一律 NEW。
    const stem = (q) => q.split(/[,，\s]/)[0].replace(/(?:市|県|縣)$/, "");
    const asked = o.sim.searchDest ?? o.dest;
    const expB =
      !ok &&
      b &&
      PLAN.has(b.route) &&
      RECO.has(o.route) &&
      asked &&
      // 有已驗證城市時（活動句），使用者指定目的地只能是該城市本身；併入活動的整串不屬 EXP-B。
      (!verifiedCity || asked === verifiedCity || asked === `${verifiedCity}島`) &&
      extra.every((q) => stem(q) === asked);
    if (expB) {
      info(group, "GEO-EXP-B", `${t} → 需求 B 路由變更導致的既有流程 geocode（查詢 = 使用者指定目的地「${asked}」）`, detail);
      return;
    }
    check(group, "GEO-no-new", `${t} → 不新增 geocode（work ⊆ base）`, ok, detail, ok ? "" : "NEW");
  });
}

// ═══ 01 合法地名完整性 ═══
// 使用者指定 4 個 + 自行補充同結構（動詞語素開頭的真實地名），句型含「我想去X，推薦景點」與「我想去X＋活動，推薦景點」。
const LEGIT = [
  ["香港跑馬地", "香港", "跑馬地"],
  ["台南看西街教會", "台南", "看西街教會"],
  ["新竹潛園", "新竹", "潛園"],
  ["千葉釣崎海岸", "千葉", "釣崎海岸"],
  // 自行補充：動詞語素＋地名（不在 TOPONYM_SUFFIX_RE 字尾清單）→ 測是否依賴字尾清單
  ["台北遊藝場", "台北", "遊藝場"],
  ["台中玩具博物館", "台中", "玩具博物館"],
  ["高雄看守所", "高雄", "看守所"],
  ["京都賞花小徑", "京都", "賞花小徑"],
  ["東京吃茶店", "東京", "吃茶店"],
  // 真實地名：動詞語素開頭、結尾不在 TOPONYM_SUFFIX_RE
  ["東京玩具美術館", "東京", "玩具美術館"], // 東京おもちゃ美術館（新宿四谷）
  ["香港跑馬地馬場", "香港", "跑馬地馬場"], // Happy Valley Racecourse
  ["大阪游泳池", "大阪", "游泳池"],
];
{
  const G = "01-LegitPlaceIntegrity";
  for (const [place, city, tail] of LEGIT) {
    for (const t of [`我想去${place}，推薦景點`, `${place}推薦景點`, `我想去${place}`, `${place}有什麼好吃的`]) {
      // 地名不得被切成「城市＋活動」：dest／scope／catDest／搜尋目的地不得只剩城市而活動欄位吃掉地名尾段。
      vsBase(G, "LEGIT-not-split-act", `${t} → activityPreference 不得是地名尾段「${tail}」`, t, (o) => !o.act || !tail.startsWith(String(o.act).slice(0, 2)));
      vsBase(G, "LEGIT-dest-keeps-tail", `${t} → dest（若有）不得被截成只剩「${city}」`, t, (o, b) => o.dest == null || o.dest !== city || b?.dest === city);
      simParity(G, "LEGIT-sim-parity", `${t} → 正式 Chat 分派 path／搜尋目的地與基準一致`, t, place);
      noNewGeocode(G, t);
    }
  }
}

// ═══ 02 正式 Chat 搜尋目的地 ═══
// [句子, 已驗證城市, 活動片段]：走類別搜尋時，搜尋目的地與 Credits destination 不得含活動片段，且不得新增 geocode。
const CHAT_DEST = [
  ["我想去奈良看鹿，推薦景點", "奈良", "看鹿"],
  ["奈良看鹿推薦景點", "奈良", "看鹿"],
  ["我想去金澤看兼六園，推薦景點", "金澤", "看兼六園"],
  ["金澤看兼六園推薦景點", "金澤", "看兼六園"],
  ["我想去京都看楓葉，推薦景點", "京都", "看楓葉"],
  ["我想去北海道滑雪，推薦景點", "北海道", "滑雪"],
  ["我想去沖繩潛水，推薦景點", "沖繩", "潛水"],
  ["我想去大阪吃美食，推薦 5 家", "大阪", "吃美食"],
  ["我想去台南吃小吃，推薦 5 家", "台南", "吃小吃"],
  // 「我想去＋城市＋清單外活動，推薦…」：基準走規劃，本次改走推薦
  ["我想去花蓮泛舟，推薦景點", "花蓮", "泛舟"],
  ["我想去曼谷按摩，推薦景點", "曼谷", "按摩"],
  ["我想去台南拜拜，推薦景點", "台南", "拜拜"],
  ["我想去北海道溜冰，推薦景點", "北海道", "溜冰"],
  ["我想去合歡山登山，推薦景點", "合歡山", "登山"],
  ["我想去冰島追極光，推薦景點", "冰島", "極光"],
  ["我想去威尼斯坐船，推薦景點", "威尼斯", "坐船"],
  ["我想去宜蘭泡溫泉，推薦景點", "宜蘭", "泡溫泉"],
  ["我想去墾丁衝浪，推薦景點", "墾丁", "衝浪"],
  ["我想去濟州島潛水，推薦景點", "濟州", "潛水"],
  ["我想去東京購物，推薦景點", "東京", "購物"],
  ["我想去大阪看夜景，推薦景點", "大阪", "看夜景"],
  ["我想去京都賞楓，推薦景點", "京都", "賞楓"],
];
{
  const G = "02-ChatSearchDestination";
  for (const [t, city, frag] of CHAT_DEST) {
    const core = frag.replace(/^(?:看|吃|賞|追)/, "");
    vsBase(G, "CHAT-search-no-activity", `${t} → 類別搜尋目的地不得含活動「${core}」`, t, (o) => o.sim.path !== "destination_category_search" || !String(o.sim.searchDest).includes(core));
    vsBase(G, "CHAT-credits-no-activity", `${t} → Credits metadata.destination 不得含活動「${core}」`, t, (o) => !o.sim.creditsDest || !String(o.sim.creditsDest).includes(core));
    vsBase(G, "CHAT-geocode-no-activity", `${t} → geocode 查詢不得含活動「${core}」`, t, (o) => o.sim.geocodes.every((q) => !q.includes(core)));
    vsBase(G, "CHAT-search-is-city", `${t} → 若走類別搜尋，目的地應以「${city}」開頭`, t, (o) => o.sim.path !== "destination_category_search" || String(o.sim.searchDest).startsWith(city));
    vsBase(G, "CHAT-search-exact-city", `${t} → 若走類別搜尋，目的地 === 「${city}」（或「${city}島」）`, t, (o) => o.sim.path !== "destination_category_search" || o.sim.searchDest === city || o.sim.searchDest === `${city}島`);
    noNewGeocode(G, t, "fresh", city);
    const k = need(t);
    deferred.push(async (B) => {
      const o = await work(t);
      info(G, "CHAT-trace", t, `work ${fmtSim(o.sim)} || base ${fmtSim(B[k]?.sim)}`);
    });
  }
}

// ═══ X 活動分離（需求案例一 A–E）═══
{
  const G = "X-Activity";
  const CASES = [
    ["我想去京都看楓葉，推薦景點", "京都", "賞楓"],
    ["我想去北海道滑雪，推薦景點", "北海道", "滑雪"],
    ["我想去沖繩潛水，推薦景點", "沖繩", "潛水"],
    ["我想去大阪吃美食，推薦 5 家", "大阪", "美食"],
    ["我想去台南吃小吃，推薦 5 家", "台南", "在地小吃"],
  ];
  for (const [t, city, act] of CASES) {
    vsBase(G, "ACT-dest", `${t} → dest === ${city}`, t, (o) => o.dest === city);
    vsBase(G, "ACT-pref", `${t} → activityPreference === ${act}`, t, (o) => o.act === act);
    vsBase(G, "ACT-reco", `${t} → 推薦路由`, t, (o) => RECO.has(o.route));
  }
  for (const t of ["我想去大阪吃美食，推薦 5 家", "我想去台南吃小吃，推薦 5 家"]) {
    vsBase(G, "ACT-food-type", `${t} → primaryType=restaurant、requestedCount=5`, t, (o) => o.type === "restaurant" && o.cnt === 5);
  }
  // 無法可靠解析：保留原始需求、不得產生錯誤目的地
  for (const [t, bad] of [
    ["我想去花蓮泛舟，推薦景點", "花蓮泛舟"],
    ["我想去曼谷按摩，推薦景點", "曼谷按摩"],
    ["我想去台南拜拜，推薦景點", "台南拜拜"],
    ["我想去北海道溜冰，推薦景點", "北海道溜冰"],
  ]) {
    vsBase(G, "ACT-unparsed-no-wrong-dest", `${t} → 推薦目的地不得為未驗證整串「${bad}」`, t, (o) => o.dest !== bad);
  }
}

// ═══ 03／04 意圖 ═══
{
  for (const t of ["我想去京都，推薦一些景點", "推薦京都 10 個景點", "京都 10 個景點推薦", "我想去大阪，推薦 5 家拉麵店"]) {
    vsBase("03-RecommendationIntent", "INT-reco", `${t} → Recommendation`, t, (o) => RECO.has(o.route));
  }
  for (const t of ["幫我排一下京都景點的路線", "我想去京都玩三天", "幫我規劃京都三天行程", "我想去京都玩三天，推薦 5 個景點"]) {
    vsBase("04-PlanningIntent", "INT-plan", `${t} → Planning`, t, (o) => PLAN.has(o.route));
  }
  for (const t of ["我想去京都看楓葉", "我想去奈良看鹿", "我想去花蓮泛舟"]) {
    vsBase("04-PlanningIntent", "INT-G-parity", `${t} → route／tpt／正式分派 path 與基準相同（需求 G）`, t, (o, b) => b && o.route === b.route && o.tpt === b.tpt && o.sim.path === b.sim.path && o.sim.searchDest === b.sim.searchDest);
    noNewGeocode("04-PlanningIntent", t);
  }
}

// ═══ 05 餐飲意圖 ═══
{
  const G = "05-FoodIntent";
  const NOT_FOOD = [
    "吃藥，推薦 3 家藥局",
    "喝醉了，推薦 3 家飯店",
    "我想去東京，吃藥，推薦 3 家藥局",
    "我想去京都，喝醉了，推薦 3 家飯店",
    // 非清單店型（測是否只靠店型黑名單）
    "我想去東京，吃藥，推薦 3 家眼科",
    "我想去大阪，喝醉了，推薦 3 家按摩店",
    "我想去台北，吃藥，推薦 3 家便利店",
    "我想去京都，喝醉了，推薦 3 家 KTV",
    "我想去首爾，吃胖了，推薦 3 家健身房",
    "我想去福岡，吃壞肚子，推薦 3 家診療所",
  ];
  for (const t of NOT_FOOD) {
    vsBase(G, "FOOD-not-restaurant", `${t} → primaryType 不得新變成 restaurant／cafe`, t, (o) => o.type !== "restaurant" && o.type !== "cafe");
    vsBase(G, "FOOD-not-restaurant-cats", `${t} → 類別搜尋 intents 不得含 restaurant／cafe`, t, (o) => !Array.isArray(o.cats) || !o.cats.some((c) => c === "restaurant" || c === "cafe"));
    noNewGeocode(G, t);
  }
  for (const [t, ty] of [
    ["我想去東京吃拉麵，推薦 3 家", "restaurant"],
    ["我想去福岡喝咖啡，推薦 3 家", "cafe"],
    ["吃拉麵，推薦 3 家", "restaurant"],
    ["喝咖啡，推薦 3 家", "cafe"],
    ["京都拉麵推薦 3 家", "restaurant"],
  ]) {
    vsBase(G, "FOOD-legit", `${t} → primaryType === ${ty}`, t, (o) => o.type === ty);
  }
}

// ═══ 06 Requested Count（lib）═══
{
  const G = "06-RequestedCount";
  const parse = (t) => (W.count?.parseRequestedRecommendationCount ? safe(() => W.count.parseRequestedRecommendationCount(t)) : "MODULE_MISSING");
  const POS = [
    ["推薦札幌 3~5 間拉麵店", 5],
    ["推薦札幌 3-5 間拉麵店", 5],
    ["推薦札幌三到五間拉麵店", 5],
    ["推薦 5 個京都景點", 5],
  ];
  for (const [t, n] of POS) {
    countProbes.add(t);
    check(G, "CNT-pos", `parse(${t}) === ${n}`, parse(t) === n, `actual=${parse(t)}`, "NEW");
  }
  const NEG = [
    "推薦我們 4 個人吃的餐廳",
    "推薦有 3 個小時可以逛的景點",
    "推薦有 2 間臥室的民宿",
    "推薦我們4個人吃的餐廳",
    "推薦有3個小時可以逛的景點",
    "推薦有2間臥室的民宿",
    "推薦我們四個人吃的餐廳",
    "推薦有三個小時可以逛的景點",
    "推薦有兩間臥室的民宿",
    "推薦一家 4 個人可以坐的餐廳",
    "推薦有 2 間浴室的民宿",
    "推薦有 3 間廁所的民宿",
    "推薦有 2 個停車位的民宿",
    "推薦我們 6 位吃的餐廳",
    "推薦我 3 天可以逛的景點",
    "推薦 3 個鐘頭內逛完的景點",
    "推薦 12 月 25 日的景點",
    "推薦 300 元的拉麵",
    "推薦第 3 家拉麵店",
    "推薦我去過 3 家以外的拉麵店",
    "推薦 2 間以上臥室的民宿",
    "推薦我們家 4 個人住的民宿",
    "推薦有 4 個座位的餐廳",
    "推薦可以待 3 個半小時的景點",
    "推薦有 2 間客廳的民宿",
  ];
  for (const t of NEG) {
    countProbes.add(t);
    const v = parse(t);
    // 「推薦一家…」本身是要 1 家（與 T17 相同判讀）：允許 null 或 1，但不得取到後面的人數／房間數。
    const leadOne = /推薦一(?:家|間|個)/.test(t);
    check(G, "CNT-neg", `parse(${t}) === null${leadOne ? "／1" : ""}`, v === null || (leadOne && v === 1), `actual=${v}`, "NEW");
  }
  // intent.requestedCount 與 parser 一致
  for (const t of ["推薦我們 4 個人吃的餐廳", "推薦札幌 3~5 間拉麵店"]) {
    const p = W.intent.parsePlaceRecommendationIntent(t);
    check(G, "CNT-intent-eq", `${t} → intent.requestedCount 與 parser 一致`, (p?.requestedCount ?? null) === parse(t), `intent=${p?.requestedCount} parser=${parse(t)}`, "NEW");
  }
}

// ═══ 07 Destination Scope：離線無法驗證時沿用澄清／不猜 ═══
{
  const G = "07-DestinationScope";
  for (const t of [
    "我想去中正，推薦景點",
    "信義區推薦咖啡廳",
    "西屯推薦景點",
    "我想去中山看展，推薦景點",
    "中山看展推薦景點",
    "中山推薦景點",
    "我想去中山，推薦景點",
    "台中西屯推薦景點",
    "我想去台中西屯，推薦景點",
  ]) {
    const full = t.replace(/^我想去/, "").replace(/[，,].*$/, "");
    simParity(G, "SCOPE-sim-parity", `${t} → 正式分派 path／搜尋目的地與基準一致`, t, full);
    noNewGeocode(G, t);
  }
}

// ═══ 08 跨城市 ═══
{
  const G = "08-CrossDestination";
  for (const [t, city] of [
    ["我想去大阪吃美食，推薦 5 家", "大阪"],
    ["我想去奈良看鹿，推薦景點", "奈良"],
    ["推薦札幌 5 個景點", "札幌"],
    ["我想去台南，推薦一些景點", "台南"],
  ]) {
    vsBase(G, "XD-route", `[京都推薦中] ${t} → NEW_RECOMMENDATION`, t, (o) => o.route === "NEW_RECOMMENDATION", "kyoto");
    vsBase(G, "XD-dest", `[京都推薦中] ${t} → dest=${city}，搜尋目的地不含京都`, t, (o) => o.dest === city && !String(o.sim.searchDest ?? "").includes("京都"), "kyoto");
    vsBase(G, "XD-search-city", `[京都推薦中] ${t} → 若走類別搜尋，搜尋目的地以「${city}」開頭且不含活動`, t, (o) => o.sim.path !== "destination_category_search" || (String(o.sim.searchDest).startsWith(city) && !/看鹿|吃美食/.test(String(o.sim.searchDest))), "kyoto");
  }
}

// ═══ 09 續推 ═══
{
  const G = "09-Continuation";
  for (const t of ["還有嗎", "再給我 5 個", "再推薦三個", "還有其他推薦嗎"]) {
    vsBase(G, "CONT-more", `[京都推薦中] ${t} → MORE_RECOMMENDATIONS`, t, (o) => o.route === "MORE_RECOMMENDATIONS", "kyoto");
  }
}

// ═══ 基準子行程 ═══
let B = null;
let BC = null;
let baseFetchCalls = null;
let baseErr = "";
if (existsSync(path.join(BASE_ROOT, "src/lib/ai/recommendation-refinement/index.ts"))) {
  const res = spawnSync(
    "npx",
    ["vite-node", path.join(WORK_ROOT, "scripts/verify-recommendation-intent-activity-r3.mjs"), "--config", path.join(BASE_ROOT, "scripts/vite.verify.config.mjs")],
    {
      cwd: BASE_ROOT,
      encoding: "utf8",
      timeout: 400000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        VERIFY_R3_ROLE: "collect",
        VERIFY_ROOT: BASE_ROOT,
        VERIFY_R3_PROBES: JSON.stringify([...baseProbes.values()]),
        VERIFY_R3_COUNT_PROBES: JSON.stringify([...countProbes]),
      },
    },
  );
  const line = String(res.stdout ?? "").split("\n").find((l) => l.startsWith("@@BASE_JSON@@"));
  if (line) {
    const parsed = JSON.parse(line.slice("@@BASE_JSON@@".length));
    B = parsed.out;
    BC = parsed.cnt;
    baseFetchCalls = parsed.fetchCalls;
  } else {
    baseErr = `status=${res.status} signal=${res.signal} err=${String(res.stderr ?? "").slice(-600)}`;
  }
} else {
  baseErr = `base root missing: ${BASE_ROOT}`;
}
check("X-ProviderCalls", "BASE-available", "基準子行程可執行", B != null, baseErr);
if (B) {
  const k = "fresh\u0000我想去京都看楓葉，推薦景點";
  check("X-ProviderCalls", "BASE-isolated", "基準未混入工作區模組（無 activityPreference、無 count 模組）", B[k] && B[k].act === null && Object.values(BC ?? {}).every((v) => v === "MODULE_MISSING"), `base act=${B[k]?.act}`);
  check("X-ProviderCalls", "BASE-fetch", "基準子行程 fetch 呼叫次數 = 0", baseFetchCalls === 0, `baseFetchCalls=${baseFetchCalls}`);
  for (const fn of deferred) await fn(B, BC);
  // 全體 geocode 總數比較
  let wSum = 0;
  let bSum = 0;
  for (const [k] of baseProbes) {
    wSum += workCache.get(k)?.sim?.geocodes.length ?? 0;
    bSum += B[k]?.sim?.geocodes.length ?? 0;
  }
  check("X-ProviderCalls", "GEO-total", `全部 ${baseProbes.size} 句 geocodeFn 呼叫總數 work ≤ base`, wSum <= bSum, `work=${wSum} base=${bSum}`, wSum <= bSum ? "" : "NEW");
} else {
  check("X-ProviderCalls", "BASE-UNAVAILABLE", `需基準的 ${deferred.length} 組檢查無法執行`, false, baseErr);
}
check("X-ProviderCalls", "FETCH", "工作區 fetch 呼叫次數 = 0（fetch trap 實際計數）", fetchCalls === 0, `fetchCalls=${fetchCalls} ${fetchLog.join(" ; ")}`);
check("X-ProviderCalls", "FETCH-intact", "globalThis.fetch 仍為 trap", globalThis.fetch === fetchTrap, "");

restore();
const extra = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith(".mjs"));
for (const t of extra) {
  silence();
  const o = await observeAll(W, t, "fresh");
  restore();
  console.log(`DUMP\t${t}\t${fmt(o)}`);
}
const lines = [];
for (const r of results) {
  const tag = r.ok ? "" : r.tag ? `[${r.tag}]` : "";
  lines.push(`${r.ok ? "PASS" : "FAIL"}${tag}\t[${r.group}]\t${r.id}\t${r.label}\t${r.actual}`);
}
lines.push("\n── 分組結論 ──");
for (const g of GROUPS) {
  const rs = results.filter((r) => r.group === g && !r.actual.startsWith("INFO"));
  const f = rs.filter((r) => !r.ok);
  const nNew = f.filter((r) => r.tag === "NEW").length;
  lines.push(`${g}: ${f.length === 0 ? "PASS" : "FAIL"} (${rs.length - f.length}/${rs.length}; NEW=${nNew} PRE=${f.length - nNew})`);
}
const failed = results.filter((r) => !r.ok);
const scored = results.filter((r) => !r.actual.startsWith("INFO"));
lines.push(`\nverify-recommendation-intent-activity-r3: ${scored.length - failed.length}/${scored.length} passed, ${failed.length} failed`);
// 大量輸出經 pipe 時，須等 stdout 寫完才結束行程（避免截斷）。
await new Promise((resolve) => process.stdout.write(`${lines.join("\n")}\n`, resolve));
process.exit(failed.length ? 1 : 0);
