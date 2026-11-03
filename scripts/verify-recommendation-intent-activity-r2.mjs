#!/usr/bin/env node
/**
 * T17 — Recommendation Intent／Activity／Quantity 第 2 輪獨立驗收（補測，lib 層）。
 *
 * 執行：
 *   npx vite-node scripts/verify-recommendation-intent-activity-r2.mjs --config scripts/vite.verify.config.mjs
 *   （可加上句子參數，會額外印出 DUMP 觀測值，便於人工比對）
 *
 * 基準比對：與 T16 相同做法——以子行程（cwd = 基準目錄、基準自己的 vite.verify.config）
 * 再跑本腳本，VERIFY_ROOT 指向基準 aa2db59 archive，避免 "@/..." 混用工作區模組。
 * 基準不可用時，所有需基準的檢查記為 FAIL（BASE-UNAVAILABLE），不會略過。
 *
 * 成本：globalThis.fetch 全程為 trap（計數並拋錯），工作區與基準子行程各自斷言為 0。
 *
 * 每條 FAIL 以 NEW／PRE 標註：NEW = 基準在同一觀測上符合預期、工作區不符合；
 * PRE = 基準本來就不符合預期（或基準無此功能時以基準同值判斷）。
 */
let fetchCalls = 0;
const fetchLog = [];
const fetchTrap = async (...args) => {
  fetchCalls += 1;
  fetchLog.push(String(args[0]).slice(0, 160));
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};
globalThis.fetch = fetchTrap;

const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
const silence = () => {
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  console.log = () => {};
};
const restore = () => Object.assign(console, orig);
silence();

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DEFAULT_BASE_ROOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const ROLE = process.env.VERIFY_R2_ROLE ?? "main";
const ROOT = ROLE === "collect" ? process.env.VERIFY_ROOT : WORK_ROOT;
const BASE_ROOT = process.env.VERIFY_R2_BASE_ROOT || DEFAULT_BASE_ROOT;

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
    prDest: await import(`${root}/src/lib/ai/place-recommendation-intent/destination.ts`),
    dtp: await import(`${root}/src/lib/ai/destination-travel-profile.ts`),
    tpc: await import(`${root}/src/lib/ai/trip-planning-context.ts`),
    router: await import(`${root}/src/lib/ai/chat-intent-router.ts`),
    dining: await import(`${root}/src/lib/ai/chat-dining-flow.ts`),
    scope: await import(`${root}/src/lib/ai/recommendation-search-scope.ts`),
    catDest: await import(`${root}/src/lib/ai/chat-category-destination.ts`),
    placeIntent: await import(`${root}/src/lib/ai/chat-place-intent.ts`),
    travelCtx: await import(`${root}/src/lib/ai/travel-context.ts`),
    recSession: await import(`${root}/src/lib/ai/conversation-recommendation-session.ts`),
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

/** 單一句子的完整觀測值；含 production 實際使用的目的地解析（類別搜尋、travel context、推薦目的地）。 */
function observe(M, text, kind = "fresh") {
  const s = makeSession(M, kind);
  const opts =
    kind === "fresh"
      ? undefined
      : { hasActiveRecommendationContext: true, activePrimaryType: "attraction" };
  const p = safe(() => M.intent.parsePlaceRecommendationIntent(text, opts));
  const pObj = p && typeof p === "object" ? p : null;
  const sc = safe(() => M.dtp.resolveDestinationAreaScope(text));
  const scObj = sc && typeof sc === "object" ? sc : null;
  const ss = safe(() => M.scope.resolveRecommendationSearchScope({ userText: text, session: s }));
  const prd = safe(() =>
    M.prDest.resolvePlaceRecommendationDestination({ userText: text, session: s, parsed: pObj }),
  );
  const tc = safe(() => M.travelCtx.parseTravelContextFromText(text, s));
  return {
    route: safe(() => M.arb.resolveChatIntentArbitration(text, s).route),
    tpt: safe(() => M.router.isTravelPlanningText(text)),
    rci: safe(() => M.dining.resolveChatIntent(text, s)),
    mode: safe(() => M.tpc.resolveConversationMode(text, s)),
    dest: pObj?.destinationName ?? null,
    type: pObj?.primaryType ?? null,
    act: pObj?.activityPreference ?? null,
    cnt: pObj?.requestedCount ?? null,
    pf: pObj?.preferredFeatures ?? null,
    scope: scObj
      ? `${scObj.displayLabel}|${scObj.parentCity}|${scObj.area}|${scObj.searchScope}`
      : String(sc),
    from: safe(() => M.tpc.resolveDestinationFromText(text)),
    searchScopeDest: ss && typeof ss === "object" ? (ss.destinationName ?? null) : String(ss),
    catDest: safe(() => M.catDest.resolveDestinationForCategorySearch({}, s, text)),
    prdDest:
      prd && typeof prd === "object"
        ? `${prd.destinationDisplayName}|${prd.resolvedSearchCity}|${prd.destinationArea ?? ""}|${prd.searchScope}`
        : String(prd),
    tcDest: tc && typeof tc === "object" ? (tc.destination ?? null) : String(tc),
    // _app.chat.tsx early dispatch：true → resolveChatRouteAuthority = destination_category →
    // pushDestinationCategoryPlaceRecommendation 以 resolveDestinationForCategorySearch（catDest）為搜尋目的地
    catPath: safe(() => M.placeIntent.shouldFetchDestinationCategoryPlaces(text, {}, s)),
  };
}

if (ROLE === "collect") {
  const M = await loadModules(ROOT);
  const probes = JSON.parse(process.env.VERIFY_R2_PROBES ?? "[]");
  const out = {};
  for (const [text, kind] of probes) out[`${kind}\u0000${text}`] = observe(M, text, kind);
  const cnt = {};
  for (const t of JSON.parse(process.env.VERIFY_R2_COUNT_PROBES ?? "[]")) {
    cnt[t] = M.count?.parseRequestedRecommendationCount
      ? safe(() => M.count.parseRequestedRecommendationCount(t))
      : "MODULE_MISSING";
  }
  restore();
  console.log(`@@BASE_JSON@@${JSON.stringify({ out, cnt, fetchCalls, fetchLog })}`);
  process.exit(0);
}

// ════════════════════════ main（工作區） ════════════════════════
const { existsSync } = await import("node:fs");
const { spawnSync } = await import("node:child_process");
const path = await import("node:path");
const W = await loadModules(WORK_ROOT);

const results = [];
const GROUPS = [
  "1-RecommendationIntent",
  "2-PlanningIntent",
  "3-ActivityParsing",
  "4-DestinationParsing",
  "5-RequestedCount",
  "6-CrossDestination",
  "7-Continuation",
  "X-FoodCountedAsk",
  "X-FromFieldUsage",
  "X-ProviderCalls",
];
/** tag: "NEW" | "PRE" | "" — 只在 FAIL 時有意義。 */
function check(group, id, label, ok, actual, tag = "") {
  results.push({ group, id, label, ok: Boolean(ok), actual: String(actual ?? ""), tag });
}
const info = (group, id, label, actual) =>
  results.push({ group, id, label, ok: true, actual: `INFO ${actual}`, tag: "" });
const RECO = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS"]);
const PLAN = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
const fmt = (o) =>
  o
    ? `route=${o.route} tpt=${o.tpt} rci=${o.rci} mode=${o.mode} dest=${o.dest} type=${o.type} act=${o.act} cnt=${o.cnt} scope=${o.scope} from=${o.from} searchScope=${o.searchScopeDest} catDest=${o.catDest} prd=${o.prdDest} tc=${o.tcDest}`
    : "N/A";
const obs = (t, kind = "fresh") => observe(W, t, kind);

const baseProbes = new Map();
const countProbes = new Set();
const needBase = (t, kind = "fresh") => {
  baseProbes.set(`${kind}\u0000${t}`, [t, kind]);
  return `${kind}\u0000${t}`;
};
const deferred = [];
/** 以同一個述詞判斷基準：基準也不符合 → PRE，否則 NEW。 */
function checkVsBase(group, id, label, t, pred, kind = "fresh") {
  const k = needBase(t, kind);
  deferred.push((B) => {
    const o = obs(t, kind);
    const b = B[k];
    const ok = pred(o);
    const tag = ok ? "" : b && pred(b) ? "NEW" : "PRE";
    check(group, id, label, ok, `work: ${fmt(o)} | base: ${fmt(b)}`, tag);
  });
}
/** production 會用到的目的地欄位（parse／scope／搜尋 scope／類別搜尋／推薦目的地／travel context）。 */
const DEST_FIELDS = (o) => [
  ["dest", o.dest],
  ["scope", o.scope],
  ["searchScope", o.searchScopeDest],
  ["catDest", o.catDest],
  ["prd", o.prdDest],
  ["tc", o.tcDest],
];

// ═══ A. 合法地名誤切（4-DestinationParsing）═══
// 每個地名以多種句型與基準比對 scope／dest／from／route，並加上 production 實際使用的目的地欄位。
const LEGIT_PLACES = [
  // 任務單指定
  "台南看西街",
  "宜蘭礁溪跑馬古道",
  "台中西屯",
  "東京淺草",
  "大阪天王寺",
  "京都伏見稻荷",
  "福岡天神",
  "沖繩國際通",
  "北海道小樽",
  "首爾明洞",
  "台北士林夜市",
  "高雄駁二",
  // 自行找出：以活動動詞語素開頭（或含動詞語素）的真實地名／景點
  "香港跑馬地", // 跑：Happy Valley（香港島區名）
  "旭川買物公園", // 買：平和通買物公園
  "富山滑川", // 滑：滑川市
  "台南看西街教會", // 看：台南看西街教會（市定古蹟）
  "新竹潛園", // 潛：新竹潛園（林占梅園邸）
  "千葉釣崎海岸", // 釣：釣ヶ崎海岸
  "東京表參道", // 參
  "東京品川", // 品
  "台北華山", // 無動詞對照
  "宜蘭礁溪", // 無動詞對照
  "台中逢甲夜市",
  "京都伏見稻荷大社",
  "高雄衛武營",
  "濟州島",
];
const LEGIT_TEMPLATES = [(p) => `${p}推薦景點`, (p) => `我想去${p}，推薦景點`, (p) => `${p}有什麼好吃的`];
{
  const G = "4-DestinationParsing";
  for (const place of LEGIT_PLACES) {
    LEGIT_TEMPLATES.forEach((tpl, ti) => {
      const t = tpl(place);
      const k = needBase(t);
      deferred.push((B) => {
        const o = obs(t);
        const b = B[k];
        // 地理欄位一律與基準一致（production 實際使用的 scope／from／搜尋 scope／類別搜尋／travel context）。
        const geoSame =
          b &&
          o.scope === b.scope &&
          o.from === b.from &&
          o.catDest === b.catDest &&
          o.searchScopeDest === b.searchScopeDest &&
          o.tcDest === b.tcDest;
        check(G, "LEGIT-geo-parity", `${t} → scope／from／searchScope／catDest／tc 與基準一致`, geoSame, `work: ${fmt(o)} | base: ${fmt(b)}`, geoSame ? "" : "NEW");
        // destinationName：基準有值就要相同；基準 parse 為 null 時（「我想去X，推薦景點」基準走規劃）須等於基準 scope／from 解析出的地名。
        const expDest = b?.dest ?? (String(b?.scope).includes("|") ? String(b.scope).split("|")[0] : b?.from);
        check(G, "LEGIT-dest", `${t} → destinationName === ${expDest}（與基準地名一致）`, o.dest === expDest, `work dest=${o.dest} | base dest=${b?.dest} scope=${b?.scope}`, o.dest === expDest ? "" : "NEW");
        if (ti === 1) {
          // 需求 B：「我想去X，推薦景點」→ Recommendation（基準為規劃，屬預期變化）
          check(G, "LEGIT-route-reco", `${t} → 推薦路由（需求 B）`, RECO.has(o.route), `work route=${o.route} base route=${b?.route}`, "NEW");
        } else {
          check(G, "LEGIT-route-parity", `${t} → 路由與基準一致`, b && o.route === b.route, `work route=${o.route} base route=${b?.route}`, "NEW");
        }
        check(G, "LEGIT-no-act", `${t} → 不得產生 activityPreference（地名不是活動）`, o.act === null, `act=${o.act}`, "NEW");
      });
    });
  }
}

// ═══ B. 活動被保留（3-ActivityParsing）═══
// [句子, 目的地, 活動核心字（activityPreference 必須含此字）, 是否在封閉動詞表內]
const ACT_KEEP = [
  ["我想去台南逛老街，推薦景點", "台南", "老街"],
  ["我想去京都穿和服，推薦景點", "京都", "和服"],
  ["我想去首爾購物，推薦景點", "首爾", "購物"],
  ["我想去福岡喝咖啡，推薦 3 家", "福岡", "咖啡"],
  ["我想去金澤穿和服，推薦景點", "金澤", "和服"],
  ["我想去清邁騎大象，推薦景點", "清邁", "大象"],
  ["我想去峇里島衝浪，推薦景點", "峇里島", "衝浪"],
  ["我想去墾丁衝浪，推薦景點", "墾丁", "衝浪"],
  ["我想去綠島浮潛，推薦景點", "綠島", "浮潛"],
  ["我想去日月潭騎腳踏車，推薦景點", "日月潭", "腳踏車"],
  ["我想去濟州島看海，推薦景點", "濟州島", "看海"],
  ["濟州島看海推薦景點", "濟州島", "看海"],
  ["我想去濟州島潛水，推薦景點", "濟州島", "潛水"],
  ["我想去巴黎看鐵塔，推薦景點", "巴黎", "鐵塔"],
  ["我想去倫敦看球賽，推薦景點", "倫敦", "球賽"],
  ["我想去曼谷吃泰國菜，推薦 5 家", "曼谷", "泰國菜"],
  ["我想去新加坡吃海南雞飯，推薦 3 家", "新加坡", "海南雞飯"],
  ["我想去釜山吃海鮮，推薦 4 家", "釜山", "海鮮"],
  ["我想去台中逛夜市，推薦景點", "台中", "夜市"],
  ["我想去東京看櫻花，推薦景點", "東京", "櫻花"],
  ["我想去大阪逛街，推薦景點", "大阪", "逛街"],
  ["我想去花蓮賞鯨，推薦景點", "花蓮", "鯨"],
  // 封閉動詞表外（泛化）：泛舟、登山、追極光、按摩、拜拜、溜冰、坐船
  ["我想去花蓮泛舟，推薦景點", "花蓮", "泛舟"],
  ["我想去合歡山登山，推薦景點", "合歡山", "登山"],
  ["我想去冰島追極光，推薦景點", "冰島", "極光"],
  ["我想去曼谷按摩，推薦景點", "曼谷", "按摩"],
  ["我想去台南拜拜，推薦景點", "台南", "拜拜"],
  ["我想去北海道溜冰，推薦景點", "北海道", "溜冰"],
  ["我想去威尼斯坐船，推薦景點", "威尼斯", "坐船"],
];
{
  const G = "3-ActivityParsing";
  for (const [t, city, core] of ACT_KEEP) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      const b = B[k];
      const destOk = (x) => x?.dest === city || String(x?.dest ?? "").startsWith(city);
      // 目的地：活動不得併入。PRE 判讀：基準目的地也併入（或不正確）→ PRE。
      const destExact = (x) => x?.dest === city || x?.dest === city.replace(/島$/, "");
      check(G, "KEEP-dest", `${t} → destinationName === ${city}`, destExact(o), `work: ${fmt(o)} | base dest=${b?.dest}`, destExact(o) ? "" : b && destExact(b) ? "NEW" : "PRE");
      for (const [kk, v] of DEST_FIELDS(o)) {
        if (kk === "dest") continue;
        const merged = (val) => String(val).includes(core) || /泛舟|登山|按摩|拜拜|溜冰|坐船|購物|逛|穿和服|騎|衝浪|浮潛|看海|喝咖啡/.test(String(val));
        const bv = b ? Object.fromEntries(DEST_FIELDS(b))[kk] : undefined;
        check(
          G,
          `KEEP-no-merge-${kk}`,
          `${t} → ${kk} 不得併入活動`,
          !merged(v),
          `${kk}=${v} | base ${kk}=${bv}`,
          !merged(v) ? "" : b && !merged(bv) ? "NEW" : "PRE",
        );
      }
      // 活動必須保留（不得被刪除）。基準無此欄位，屬新功能：失敗一律 NEW。
      check(G, "KEEP-act", `${t} → activityPreference 保留「${core}」`, typeof o.act === "string" && o.act.includes(core.replace(/^看/, "")), `act=${o.act}`, "NEW");
      check(
        G,
        "KEEP-act-not-pf",
        `${t} → activityPreference 不得進 preferredFeatures`,
        !Array.isArray(o.pf) || !o.pf.some((f) => o.act && String(f) === o.act),
        `pf=${JSON.stringify(o.pf)}`,
        "NEW",
      );
      check(G, "KEEP-route", `${t} → 推薦路由`, RECO.has(o.route), `work route=${o.route} base route=${b?.route}`, RECO.has(o.route) ? "" : b && RECO.has(b.route) ? "NEW" : "PRE");
      void destOk;
    });
  }
  // 「我想去福岡喝咖啡，推薦 3 家」：店型應為 cafe、數量 3
  {
    const t = "我想去福岡喝咖啡，推薦 3 家";
    const o = obs(t);
    check(G, "KEEP-cafe-type", `${t} → primaryType === cafe`, o.type === "cafe", fmt(o), "NEW");
    check(G, "KEEP-cafe-cnt", `${t} → requestedCount === 3`, o.cnt === 3, `cnt=${o.cnt}`, "NEW");
  }
  // 活動偏好不影響 query：同 intent 有無 activityPreference，query 完全相同
  for (const [t] of ACT_KEEP) {
    const p = W.intent.parsePlaceRecommendationIntent(t);
    if (!p?.activityPreference) continue;
    const a = JSON.stringify(safe(() => W.intent.buildPlaceRecommendationQueries(p)));
    const { activityPreference: _d, ...rest } = p;
    const b2 = JSON.stringify(safe(() => W.intent.buildPlaceRecommendationQueries(rest)));
    check(G, "KEEP-query-invariant", `${t} → buildPlaceRecommendationQueries 不受 activityPreference 影響`, a === b2, a === b2 ? "" : `with=${a} without=${b2}`, "NEW");
  }
}

// ═══ C. 「好吃的…推薦 N 家」與 FOOD_COUNTED_ASK_RE 擴大範圍（X-FoodCountedAsk）═══
// [句子, 預期, 說明]；預期：
//  "same"       → route 與 primaryType 必須與基準相同（不屬於本次需求，不應被改變）
//  "reco-food"  → 合理變化：推薦路由且 primaryType=restaurant/cafe（吃／喝＋食物＋推薦 N 家）
//  "not-food"   → 受詞不是餐飲（吃藥、喝醉…）：primaryType 不得被改成 restaurant
const FOOD_CASES = [
  ["京都好吃的拉麵推薦 5 家", "same"],
  // 基準為 GENERAL_CHAT（無法回應），改為餐飲推薦屬合理改善
  ["台南好吃的推薦 3 家", "reco-food"],
  ["京都有什麼好吃的，推薦 3 家", "same"],
  ["我想去台南，好吃的推薦 5 家", "reco-food"],
  ["我想去京都，好吃的拉麵推薦 3 家", "reco-food"],
  ["我想去大阪，有什麼好吃的推薦 5 家", "reco-food"],
  ["我想去首爾吃烤肉，推薦 5 家", "reco-food"],
  ["我想去東京吃到飽，推薦 3 家", "reco-food"],
  ["我想去大阪吃燒肉推薦 4 家", "reco-food"],
  ["我想去福岡吃拉麵，推薦五家", "reco-food"],
  ["我想去大阪喝酒，推薦 3 家", "reco-food"],
  ["我想去台北喝珍奶，推薦 3 家", "reco-food"],
  ["我想去東京，感冒要吃藥，推薦 3 家藥局", "not-food"],
  ["我想去京都，喝醉了推薦 3 家飯店", "not-food"],
  ["我想去沖繩，吃完晚餐想住，推薦 3 家飯店", "not-food"],
  ["我想去大阪，吃完飯想逛街，推薦 3 家百貨", "not-food"],
  ["我想去台南，吃素的朋友多，推薦 3 間民宿", "not-food"],
  ["我想去京都玩三天，吃拉麵推薦 3 家", "plan"],
  ["我想去台南三天兩夜，吃小吃推薦 5 家", "plan"],
];
{
  const G = "X-FoodCountedAsk";
  for (const [t, exp] of FOOD_CASES) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      const b = B[k];
      const changed = !b || o.route !== b.route || o.type !== b.type;
      info(G, "FOOD-diff", t, `${changed ? "CHANGED" : "same"} work route=${o.route} type=${o.type} | base route=${b?.route} type=${b?.type}`);
      if (exp === "same") {
        check(G, "FOOD-same", `${t} → route／primaryType 與基準相同`, !changed, `work route=${o.route} type=${o.type} | base route=${b?.route} type=${b?.type}`, "NEW");
      } else if (exp === "reco-food") {
        const ok = RECO.has(o.route) && (o.type === "restaurant" || o.type === "cafe" || o.type === "nightlife");
        check(G, "FOOD-reco", `${t} → 推薦路由且餐飲類`, ok, fmt(o), b && RECO.has(b.route) ? "NEW" : "PRE");
      } else if (exp === "not-food") {
        const ok = o.type !== "restaurant" || b?.type === "restaurant";
        check(G, "FOOD-not-food", `${t} → 非餐飲受詞不得新變成 restaurant`, ok, `work type=${o.type} route=${o.route} | base type=${b?.type} route=${b?.route}`, "NEW");
        // 路由由規劃改為推薦本身可接受（「推薦 3 家百貨」確實是推薦）；錯在店型被改判為 restaurant。
        info(G, "FOOD-not-food-route", `${t} 路由變化`, `work route=${o.route} | base route=${b?.route}`);
      } else if (exp === "plan") {
        check(G, "FOOD-plan", `${t} → 含天數仍為規劃`, PLAN.has(o.route), fmt(o), b && PLAN.has(b.route) ? "NEW" : "PRE");
      }
    });
  }
}

// ═══ D. 奈良看鹿：from 欄位是否實際影響 production 目的地（X-FromFieldUsage）═══
{
  const G = "X-FromFieldUsage";
  for (const [t, city, frag] of [
    ["我想去奈良看鹿，推薦景點", "奈良", "看鹿"],
    ["我想去奈良看鹿", "奈良", "看鹿"],
    ["奈良看鹿推薦景點", "奈良", "看鹿"],
    ["我想去金澤穿和服，推薦景點", "金澤", "穿和服"],
    ["我想去清邁騎大象，推薦景點", "清邁", "騎大象"],
    ["我想去墾丁衝浪，推薦景點", "墾丁", "衝浪"],
  ]) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      const b = B[k];
      info(G, "FROM-trace", t, `${fmt(o)} catPath=${o.catPath} | base catPath=${b?.catPath} catDest=${b?.catDest}`);
      // 實際影響：走 destination_category 早期分派時，搜尋目的地就是 catDest（無 validated area scope 時）。
      const hits = (x) => x?.catPath === true && String(x?.catDest).includes(frag);
      check(
        G,
        "FROM-effective-search-dest",
        `${t} → 若走 destination_category 分派，搜尋目的地（catDest）不得含活動「${frag}」`,
        !hits(o),
        `work catPath=${o.catPath} catDest=${o.catDest} | base catPath=${b?.catPath} catDest=${b?.catDest}`,
        !hits(o) ? "" : b && !hits(b) ? "NEW" : "PRE",
      );
      for (const [kk, v] of [
        ["from(resolveDestinationFromText)", o.from],
        ["catDest(resolveDestinationForCategorySearch → _app.chat.tsx 類別搜尋)", o.catDest],
        ["prd(resolvePlaceRecommendationDestination)", o.prdDest],
        ["searchScope(resolveRecommendationSearchScope)", o.searchScopeDest],
        ["tc(parseTravelContextFromText → session.travelContext.destination)", o.tcDest],
      ]) {
        const bad = (val) => val != null && String(val).includes(frag);
        const bv =
          b &&
          {
            "from(resolveDestinationFromText)": b.from,
            "catDest(resolveDestinationForCategorySearch → _app.chat.tsx 類別搜尋)": b.catDest,
            "prd(resolvePlaceRecommendationDestination)": b.prdDest,
            "searchScope(resolveRecommendationSearchScope)": b.searchScopeDest,
            "tc(parseTravelContextFromText → session.travelContext.destination)": b.tcDest,
          }[kk];
        check(G, "FROM-no-activity", `${t} → ${kk} 不含「${frag}」`, !bad(v), `work=${v} | base=${bv}`, !bad(v) ? "" : b && !bad(bv) ? "NEW" : "PRE");
      }
      void city;
    });
  }
}

// ═══ E. Requested Count（5-RequestedCount）═══
{
  const G = "5-RequestedCount";
  const parse = (t) =>
    W.count?.parseRequestedRecommendationCount
      ? safe(() => W.count.parseRequestedRecommendationCount(t))
      : "MODULE_MISSING";
  const shown = (t, topic = "attraction") =>
    typeof W.recSession.resolveRequestedDisplayBatchSize === "function"
      ? W.recSession.resolveRequestedDisplayBatchSize(parse(t), topic)
      : "MISSING";
  // 正例：多種語序
  const POS = [
    ["推薦十個景點", 10, 10],
    ["推薦十二個景點", 12, 10],
    ["推薦一百個景點", 100, 10],
    ["推薦兩個景點", 2, 2],
    ["推薦三到五個景點", 5, 5],
    ["推薦 100 個景點", 100, 10],
    ["推薦 3 到 5 個景點", 5, 5],
    ["京都景點，推薦十個", 10, 10],
    ["京都有什麼景點？推薦我十個", 10, 10],
    ["可以幫我推薦兩個京都的景點嗎", 2, 2],
    ["京都的景點我想要十二個推薦", 12, 10],
    ["請給我 8 間大阪的咖啡廳", 8, 8],
    ["大阪咖啡廳給我 8 間", 8, 8],
    ["5 家台南小吃推薦", 5, 5],
    ["台南小吃 5 家推薦", 5, 5],
    ["推薦札幌 3~5 間拉麵店", 5, 5],
    ["我想去京都，景點推薦三到五個", 5, 5],
    ["我想去京都，推薦我十個景點", 10, 10],
    ["推薦東京澀谷區 4 家咖啡廳", 4, 4],
    ["推薦大阪難波附近 6 家燒肉", 6, 6],
    ["推薦一百二十個景點", 120, 10],
    ["推薦１００個景點", 100, 10],
    ["幫我找 5 家拉麵店", 5, 5],
    ["挑三個京都景點", 3, 3],
  ];
  for (const [t, ep, es] of POS) {
    countProbes.add(t);
    check(G, "CNT-pos", `parse(${t}) === ${ep}`, parse(t) === ep, `actual=${parse(t)}`, "NEW");
    check(G, "CNT-pos-shown", `顯示張數(${t}) === ${es}`, shown(t) === es, `actual=${shown(t)}`, "NEW");
  }
  // 反例：帶空白前綴、10 字夾段、日期／天數／房間／價格／人數
  const NEG = [
    "推薦一家可以住 3 晚的飯店",
    "推薦我 2026 年的京都景點",
    "推薦適合 4 個人的餐廳",
    "推薦適合 4 個人 的餐廳",
    "推薦適合 4 位大人的餐廳",
    "推薦 4 人房的飯店",
    "推薦可以住 4 個人的民宿",
    "推薦有 2 間臥室的民宿",
    "推薦有 3 個房間的民宿",
    "推薦有 2 間房的飯店",
    "推薦距離車站 5 分鐘的飯店",
    "推薦車程 2 小時內的景點",
    "推薦車程 30 分鐘以內的 景點",
    "推薦步行 10 分鐘內的咖啡廳",
    "推薦評價 4 星以上的餐廳",
    "推薦 4.5 星以上的餐廳",
    "推薦人均 500 元的餐廳",
    "推薦 500 元以內的拉麵店",
    "推薦 1000 日圓 以下的拉麵",
    "推薦 12 月 的京都景點",
    "推薦 12/25 的京都景點",
    "推薦 3 月去的京都景點",
    "推薦京都 3 天 的景點",
    "推薦京都三天兩夜可以去的景點",
    "推薦第 2 天去的景點",
    "推薦 第 2 個 景點",
    "這 3 個景點推薦嗎",
    "那 3 間餐廳推薦嗎",
    "哪 3 個景點推薦",
    "每 2 個景點推薦一家餐廳",
    "同 1 個區域推薦景點",
    "另 2 個景點推薦嗎",
    "去過 3 個景點推薦別的",
    "訂 2 間 推薦飯店",
    "其中 2 個 推薦嗎",
    "推薦一家 3 層樓的百貨",
    "推薦一個有 3 個展區的博物館",
    "推薦帶 2 個小孩可以去的景點",
    "推薦適合 2 個大人的景點",
    "推薦 2 個大人 1 個小孩的景點",
    "推薦一間有 2 張床的飯店",
    "推薦 24 小時 營業的餐廳",
    "推薦營業到 10 點的餐廳",
    "推薦 7-11 附近的景點",
    "推薦 101 附近的景點",
    "推薦台北 101 附近的餐廳",
    "推薦 85 度 C 附近",
    "推薦京都 1 日 遊景點",
    "推薦 2 天 1 夜的景點",
    "推薦 3 晚 的住宿",
    "推薦我們 4 個 人吃的餐廳",
    "推薦 2026 年 3 月的京都景點",
    "推薦一個人可以去的景點",
    "推薦兩人份的套餐",
    "推薦 3 號出口附近的餐廳",
    "推薦 2 號線沿線景點",
    "推薦離 3 號 出口近的餐廳",
    "推薦一下 5 間房 的民宿",
    "推薦有 3 個 小時 可以逛的景點",
  ];
  for (const t of NEG) {
    countProbes.add(t);
    deferred.push((B, BC) => {
      const v = parse(t);
      const bv = BC?.[t];
      // 「推薦一家／一間／一個…」本身可能是「要 1 家」：允許 null 或 1，但不得解析出夾段後面的數字。
      const leadOne = /推薦一(?:家|間|个|個)/.test(t);
      const ok = v === null || (leadOne && v === 1);
      check(G, "CNT-neg", `parse(${t}) === null${leadOne ? "／1" : ""}（不得取到日期／天數／房間／價格／人數）`, ok, `actual=${v} base=${bv}`, "NEW");
    });
  }
  // intent.requestedCount 與 parser 一致（不會在 parse.ts 另行解析出不同值）
  for (const t of ["推薦京都 10 個景點", "我想去大阪吃美食，推薦 5 家", "推薦適合 4 個人的餐廳", "推薦一家可以住 3 晚的飯店"]) {
    const o = obs(t);
    check(G, "CNT-intent-eq", `${t} → intent.requestedCount 與 parser 一致`, (o.cnt ?? null) === parse(t), `intent=${o.cnt} parser=${parse(t)}`, "NEW");
  }
  check(G, "CNT-default", "未指定 → 3（attraction/restaurant）", W.recSession.resolveRequestedDisplayBatchSize?.(null, "attraction") === 3 && W.recSession.resolveRequestedDisplayBatchSize?.(null, "restaurant") === 3, "", "NEW");
  check(G, "CNT-cap-500", "requested=500 → 顯示 10", W.recSession.resolveRequestedDisplayBatchSize?.(500, "attraction") === 10, "", "NEW");
  check(G, "CNT-zero", "requested=0 → 預設 3", W.recSession.resolveRequestedDisplayBatchSize?.(0, "attraction") === 3, "", "NEW");
}

// ═══ F. Intent A–H 泛化語序（1/2/6/7）═══
{
  const G1 = "1-RecommendationIntent";
  for (const t of [
    "推薦大阪 10 個景點",
    "推薦台南 5 個景點",
    "我想去首爾，推薦一些景點",
    "我想去台中，推薦幾家咖啡廳",
    "京都 10 個景點推薦",
    "我要去福岡，推薦 5 家拉麵店",
  ]) {
    checkVsBase(G1, "INT-reco", `${t} → 推薦路由`, t, (o) => RECO.has(o.route));
    checkVsBase(G1, "INT-reco-consistent", `${t} → tpt=false／rci≠trip_planning／mode≠destination_planning`, t, (o) => o.tpt === false && o.rci !== "trip_planning" && o.mode !== "destination_planning");
  }
  const G2 = "2-PlanningIntent";
  for (const t of [
    "我想去大阪玩三天",
    "我要去首爾玩五天",
    "幫我規劃台南兩天行程",
    "推薦大阪景點並幫我安排參觀路線",
    "幫我排一下大阪景點的路線",
    "我想去京都，推薦景點並規劃三天行程",
    "我想去京都玩三天，推薦 5 個景點",
    "我想去京都，推薦景點，排一下路線",
  ]) {
    checkVsBase(G2, "PLAN", `${t} → Planning`, t, (o) => PLAN.has(o.route));
  }
  // G：只有旅行意向（含活動）→ 與基準完全一致
  for (const t of ["我想去大阪吃美食", "我想去台南吃小吃", "我想去奈良看鹿", "我想去福岡喝咖啡", "我想去台南逛老街"]) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      const b = B[k];
      const same = b && o.route === b.route && o.tpt === b.tpt && o.rci === b.rci && o.mode === b.mode;
      check(G2, "PLAN-G-base", `${t} → route/tpt/rci/mode 與基準一致`, same, `work: ${fmt(o)} | base: ${fmt(b)}`, "NEW");
    });
  }
  // H：續推
  const G7 = "7-Continuation";
  for (const t of ["還有嗎", "還有其他推薦嗎", "再給我 5 個", "再推薦三個"]) {
    checkVsBase(G7, "CONT-more", `[京都推薦中] ${t} → MORE_RECOMMENDATIONS`, t, (o) => o.route === "MORE_RECOMMENDATIONS", "kyoto");
  }
  // 6：跨目的地
  const G6 = "6-CrossDestination";
  for (const [t, city] of [
    ["我想去台南逛老街，推薦景點", "台南"],
    ["我想去首爾購物，推薦景點", "首爾"],
    ["我想去福岡喝咖啡，推薦 3 家", "福岡"],
    ["推薦札幌 5 個景點", "札幌"],
  ]) {
    const o = obs(t, "kyoto");
    check(G6, "XD-route", `[京都推薦中] ${t} → NEW_RECOMMENDATION`, o.route === "NEW_RECOMMENDATION", fmt(o), "NEW");
    check(G6, "XD-dest", `[京都推薦中] ${t} → ${city}，不得含京都`, o.dest === city && ![o.dest, o.scope, o.searchScopeDest, o.prdDest].some((v) => String(v).includes("京都")), fmt(o), "NEW");
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
    [
      "vite-node",
      path.join(WORK_ROOT, "scripts/verify-recommendation-intent-activity-r2.mjs"),
      "--config",
      path.join(BASE_ROOT, "scripts/vite.verify.config.mjs"),
    ],
    {
      cwd: BASE_ROOT,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        VERIFY_R2_ROLE: "collect",
        VERIFY_ROOT: BASE_ROOT,
        VERIFY_R2_PROBES: JSON.stringify([...baseProbes.values()]),
        VERIFY_R2_COUNT_PROBES: JSON.stringify([...countProbes]),
      },
    },
  );
  const line = String(res.stdout ?? "")
    .split("\n")
    .find((l) => l.startsWith("@@BASE_JSON@@"));
  if (line) {
    const parsed = JSON.parse(line.slice("@@BASE_JSON@@".length));
    B = parsed.out;
    BC = parsed.cnt;
    baseFetchCalls = parsed.fetchCalls;
  } else {
    baseErr = `status=${res.status} signal=${res.signal} err=${String(res.stderr ?? "").slice(-400)}`;
  }
} else {
  baseErr = `base root missing: ${BASE_ROOT}`;
}
check("X-ProviderCalls", "BASE-available", "基準子行程可執行", B != null, baseErr);
if (B) {
  const k = "fresh\u0000我想去奈良看鹿，推薦景點";
  check("X-ProviderCalls", "BASE-isolated", "基準子行程未混入工作區模組（基準無 activityPreference、無 count 模組）", B[k] && B[k].act === null && Object.values(BC ?? {}).every((v) => v === "MODULE_MISSING"), `base act=${B[k]?.act}`);
  check("X-ProviderCalls", "BASE-fetch", "基準子行程 fetch 呼叫次數 = 0", baseFetchCalls === 0, `baseFetchCalls=${baseFetchCalls}`);
  for (const fn of deferred) fn(B, BC);
} else {
  check("X-ProviderCalls", "BASE-UNAVAILABLE", `需基準的 ${deferred.length} 組檢查無法執行`, false, baseErr);
}
check("X-ProviderCalls", "FETCH", "工作區 fetch 呼叫次數 = 0（fetch trap 實際計數）", fetchCalls === 0, `fetchCalls=${fetchCalls} ${fetchLog.join(" ; ")}`);
check("X-ProviderCalls", "FETCH-intact", "globalThis.fetch 仍為 trap", globalThis.fetch === fetchTrap, "");

restore();
const extra = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith(".mjs"));
for (const t of extra) {
  silence();
  const o = obs(t);
  const c = W.count?.parseRequestedRecommendationCount?.(t);
  restore();
  console.log(`DUMP\t${t}\t${fmt(o)} parseCount=${c}`);
}
for (const r of results) {
  const tag = r.ok ? "" : r.tag ? `[${r.tag}]` : "";
  console.log(`${r.ok ? "PASS" : "FAIL"}${tag}\t[${r.group}]\t${r.id}\t${r.label}\t${r.actual}`);
}
console.log("\n── 分組結論 ──");
for (const g of GROUPS) {
  const rs = results.filter((r) => r.group === g && !r.actual.startsWith("INFO"));
  const f = rs.filter((r) => !r.ok);
  const nNew = f.filter((r) => r.tag === "NEW").length;
  console.log(`${g}: ${f.length === 0 ? "PASS" : "FAIL"} (${rs.length - f.length}/${rs.length}; NEW=${nNew} PRE=${f.length - nNew})`);
}
const failed = results.filter((r) => !r.ok);
const scored = results.filter((r) => !r.actual.startsWith("INFO"));
console.log(`\nverify-recommendation-intent-activity-r2: ${scored.length - failed.length}/${scored.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
