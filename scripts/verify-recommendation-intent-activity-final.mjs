#!/usr/bin/env node
/**
 * T16 — Recommendation Intent & Destination／Activity Parsing 最終獨立驗收（lib 層）。
 *
 * 執行：
 *   npx vite-node scripts/verify-recommendation-intent-activity-final.mjs --config scripts/vite.verify.config.mjs
 *
 * 基準比對：本腳本會以子行程（cwd = 基準目錄、該目錄自己的 vite.verify.config）再跑一次自己，
 * 以 VERIFY_ROOT 指向基準 aa2db59 archive，讓基準模組的 "@/..." 解析到基準的 src，
 * 不會混用工作區模組。基準路徑可用環境變數 VERIFY_ACTIVITY_BASE_ROOT 覆寫；
 * 基準不存在或子行程失敗時，所有需基準的檢查記為 FAIL（BASE-UNAVAILABLE），不會默默略過。
 *
 * 成本：全程 globalThis.fetch 為 trap，任何呼叫都會被計數並拋錯；最後斷言次數為 0（工作區與基準子行程各自計數）。
 *
 * 輸出：逐條 PASS/FAIL，依 10 個驗收項目分組，最後印出每組結論；有任何 FAIL 時 exit code 1。
 */
let fetchCalls = 0;
const fetchLog = [];
const fetchTrap = async (...args) => {
  fetchCalls += 1;
  fetchLog.push(String(args[0]).slice(0, 160));
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};
globalThis.fetch = fetchTrap;

const origInfo = console.info;
const origLog = console.log;
const origWarn = console.warn;
const origDebug = console.debug;
const silence = () => {
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  console.log = () => {};
};
const restore = () => {
  console.info = origInfo;
  console.warn = origWarn;
  console.debug = origDebug;
  console.log = origLog;
};
silence();

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DEFAULT_BASE_ROOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const ROLE = process.env.VERIFY_ACTIVITY_ROLE ?? "main";
const ROOT = ROLE === "collect" ? process.env.VERIFY_ROOT : WORK_ROOT;
const BASE_ROOT = process.env.VERIFY_ACTIVITY_BASE_ROOT || DEFAULT_BASE_ROOT;

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
    refSession: await import(`${root}/src/lib/ai/recommendation-refinement/session.ts`),
    intent: await import(`${root}/src/lib/ai/place-recommendation-intent/index.ts`),
    dtp: await import(`${root}/src/lib/ai/destination-travel-profile.ts`),
    tpc: await import(`${root}/src/lib/ai/trip-planning-context.ts`),
    router: await import(`${root}/src/lib/ai/chat-intent-router.ts`),
    dining: await import(`${root}/src/lib/ai/chat-dining-flow.ts`),
    scope: await import(`${root}/src/lib/ai/recommendation-search-scope.ts`),
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

/** 單一句子在某個 root 下的完整觀測值（純本地函式，無 provider）。 */
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
  return {
    route: safe(() => M.arb.resolveChatIntentArbitration(text, s).route),
    tpt: safe(() => M.router.isTravelPlanningText(text)),
    rci: safe(() => M.dining.resolveChatIntent(text, s)),
    mode: safe(() => M.tpc.resolveConversationMode(text, s)),
    parsed: pObj ? true : typeof p === "string" ? p : false,
    dest: pObj?.destinationName ?? null,
    area: pObj?.destinationArea ?? null,
    type: pObj?.primaryType ?? null,
    cont: pObj?.continuation ?? null,
    act: pObj?.activityPreference ?? null,
    cnt: pObj?.requestedCount ?? null,
    local: pObj?.localPreference ?? null,
    pf: pObj?.preferredFeatures ?? null,
    scope: scObj ? `${scObj.displayLabel}|${scObj.parentCity}|${scObj.area}|${scObj.searchScope}` : String(sc),
    from: safe(() => M.tpc.resolveDestinationFromText(text)),
    searchScopeDest: ss && typeof ss === "object" ? (ss.destinationName ?? null) : String(ss),
  };
}

// ── 子行程：在基準 root 收集觀測值後輸出 JSON ──
if (ROLE === "collect") {
  const M = await loadModules(ROOT);
  const probes = JSON.parse(process.env.VERIFY_ACTIVITY_PROBES ?? "[]");
  const out = {};
  for (const [text, kind] of probes) out[`${kind}\u0000${text}`] = observe(M, text, kind);
  restore();
  console.log(`@@BASE_JSON@@${JSON.stringify({ out, fetchCalls, fetchLog })}`);
  process.exit(0);
}

// ════════════════════════ main（工作區） ════════════════════════
const { readFileSync, readdirSync, statSync, existsSync } = await import("node:fs");
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
  "8-TouristQualityGate",
  "9-RecommendationReasonV2",
  "10-CreditsCompatibility",
  "X-ProviderCalls",
  "X-Generalization",
];
function check(group, id, label, ok, actual) {
  results.push({ group, id, label, ok: Boolean(ok), actual: String(actual ?? "") });
}
const RECO = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS"]);
const PLAN = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
const fmt = (o) =>
  `route=${o.route} tpt=${o.tpt} rci=${o.rci} mode=${o.mode} dest=${o.dest} act=${o.act} cnt=${o.cnt} scope=${o.scope} from=${o.from} searchScope=${o.searchScopeDest}`;
const obs = (t, kind = "fresh") => observe(W, t, kind);

// 需要基準值的句子（先登記，最後一次子行程收集）
const baseProbes = new Map();
const needBase = (t, kind = "fresh") => {
  baseProbes.set(`${kind}\u0000${t}`, [t, kind]);
  return `${kind}\u0000${t}`;
};
const deferred = [];

/** 推薦路由必須在各分類器間一致：不得 tpt=true 或 rci=trip_planning 或 mode=destination_planning。 */
function checkRecoConsistent(group, id, t, o) {
  check(group, id, `${t} → 推薦路由（route∈RECO）`, RECO.has(o.route), fmt(o));
  check(
    group,
    `${id}-consistent`,
    `${t} → 其他分類器不得判為規劃（tpt=false、rci≠trip_planning、mode≠destination_planning）`,
    o.tpt === false && o.rci !== "trip_planning" && o.mode !== "destination_planning",
    fmt(o),
  );
}

/** 目的地與活動分離的共用斷言。 */
function checkSeparated(group, id, t, o, city, act, { count, type } = {}) {
  const actWord = act.replace(/^在地/, "");
  check(group, `${id}-dest`, `${t} → destinationName === ${city}`, o.dest === city, `actual=${o.dest}`);
  for (const [k, v] of [
    ["scope", o.scope],
    ["from", o.from],
    ["searchScope", o.searchScopeDest],
  ]) {
    check(
      group,
      `${id}-no-merge-${k}`,
      `${t} → ${k} 不得併入活動（不含「${actWord}」或活動動詞片段）`,
      !String(v).includes(actWord) && !/看楓|滑雪|潛水|吃美食|吃小吃|泡湯|逛街|看海|爬山|騎單車|騎腳踏車/.test(String(v)),
      `${k}=${v}`,
    );
  }
  check(group, `${id}-act`, `${t} → activityPreference === ${act}`, o.act === act, `actual=${o.act}`);
  check(
    group,
    `${id}-pf`,
    `${t} → activityPreference 不得出現在 preferredFeatures`,
    Array.isArray(o.pf) && !o.pf.some((f) => String(f).includes(actWord) || f === o.act),
    `pf=${JSON.stringify(o.pf)}`,
  );
  if (count !== undefined)
    check(group, `${id}-cnt`, `${t} → requestedCount === ${count}`, o.cnt === count, `actual=${o.cnt}`);
  if (type)
    check(group, `${id}-type`, `${t} → primaryType === ${type}`, o.type === type, `actual=${o.type}`);
}

// ═══ 1. Recommendation Intent ═══
{
  const G = "1-RecommendationIntent";
  const a = obs("推薦京都 10 個景點");
  checkRecoConsistent(G, "INT-A", "推薦京都 10 個景點", a);
  check(G, "INT-A-dest", "推薦京都 10 個景點 → 京都", a.dest === "京都", fmt(a));
  const b = obs("我想去京都，推薦一些景點");
  checkRecoConsistent(G, "INT-B", "我想去京都，推薦一些景點", b);
  check(G, "INT-B-dest", "我想去京都，推薦一些景點 → 京都", b.dest === "京都", fmt(b));
  check(G, "INT-B-cnt", "我想去京都，推薦一些景點 → requestedCount 未指定", b.cnt === null, fmt(b));
  for (const t of [
    "我想去京都看楓葉，推薦景點",
    "我想去北海道滑雪，推薦景點",
    "我想去沖繩潛水，推薦景點",
    "我想去大阪吃美食，推薦 5 家",
    "我想去台南吃小吃，推薦 5 家",
  ]) {
    checkRecoConsistent(G, "INT-ACT", t, obs(t));
  }
  // 不得只靠調整 router 優先順序：純推薦句、以及基準本來就是推薦的句子，路由與基準一致。
  for (const t of ["推薦京都景點", "京都有什麼好吃的推薦", "京都嵐山推薦景點", "台南有什麼小吃"]) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      check(G, "INT-base-same", `${t} → 路由與基準一致`, o.route === B[k]?.route, `work=${o.route} base=${B[k]?.route}`);
    });
  }
}

// ═══ 2. Planning Intent（含 G 澄清、H 續推）═══
{
  const G = "2-PlanningIntent";
  for (const [id, t] of [
    ["PLAN-C", "我想去京都玩三天"],
    ["PLAN-D", "幫我規劃京都三天行程"],
    ["PLAN-E", "推薦京都景點並幫我安排參觀路線"],
    ["PLAN-F", "幫我排一下京都景點的路線"],
    // 泛化：其他城市、其他句型
    ["PLAN-E-gen", "推薦首爾景點並幫我安排參觀路線"],
    ["PLAN-F-gen", "幫我排一下台南景點的路線"],
    ["PLAN-F-gen2", "可以幫我排一條札幌觀光路線嗎"],
    ["PLAN-C-gen", "我想去福岡玩兩天"],
  ]) {
    const o = obs(t);
    check(G, id, `${t} → Planning（route∈PLAN）`, PLAN.has(o.route), fmt(o));
  }
  // E/F 在基準的路由（記錄改變來源，不影響結論）
  for (const t of ["推薦京都景點並幫我安排參觀路線", "幫我排一下京都景點的路線"]) needBase(t);
  // G：只有旅行意向 → 不得判為明確推薦，且所有分類器與基準完全一致
  for (const t of [
    "我想去京都看楓葉",
    "我想去北海道滑雪",
    "我想去札幌泡湯",
    "我想去首爾逛街",
    "我想去京都",
  ]) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      const b = B[k];
      check(G, "PLAN-G-not-reco", `${t} → 不得為 NEW_RECOMMENDATION`, o.route !== "NEW_RECOMMENDATION", fmt(o));
      check(
        G,
        "PLAN-G-base",
        `${t} → route/tpt/rci/mode 與基準一致（既有 Clarification 契約）`,
        b && o.route === b.route && o.tpt === b.tpt && o.rci === b.rci && o.mode === b.mode,
        `work: ${fmt(o)} | base: ${b ? fmt(b) : "N/A"}`,
      );
    });
  }
  // H：進行中推薦 + 還有嗎 → Continuation
  for (const t of ["還有嗎", "還有其他的嗎", "再推薦一些"]) {
    const o = obs(t, "osaka");
    check(G, "PLAN-H", `[大阪推薦中] ${t} → MORE_RECOMMENDATIONS`, o.route === "MORE_RECOMMENDATIONS", fmt(o));
  }
}

// ═══ 3. Activity Parsing ═══
{
  const G = "3-ActivityParsing";
  const CASES = [
    ["ACT-A", "我想去京都看楓葉，推薦景點", "京都", "賞楓", { type: "attraction" }],
    ["ACT-B", "我想去北海道滑雪，推薦景點", "北海道", "滑雪", { type: "attraction" }],
    ["ACT-C", "我想去沖繩潛水，推薦景點", "沖繩", "潛水", { type: "attraction" }],
    ["ACT-D", "我想去大阪吃美食，推薦 5 家", "大阪", "美食", { count: 5, type: "restaurant" }],
    ["ACT-E", "我想去台南吃小吃，推薦 5 家", "台南", "在地小吃", { count: 5, type: "restaurant" }],
  ];
  for (const [id, t, city, act, extra] of CASES) {
    const o = obs(t);
    checkSeparated(G, id, t, o, city, act, extra);
  }
  // 「不影響搜尋 query」：同一 intent 有無 activityPreference，query 必須完全相同。
  for (const [, t] of CASES) {
    const p = W.intent.parsePlaceRecommendationIntent(t);
    if (!p) {
      check(G, "ACT-query", `${t} → 可解析出 intent`, false, "intent=null");
      continue;
    }
    const withAct = JSON.stringify(safe(() => W.intent.buildPlaceRecommendationQueries(p)));
    const { activityPreference: _drop, ...rest } = p;
    const withoutAct = JSON.stringify(safe(() => W.intent.buildPlaceRecommendationQueries(rest)));
    check(G, "ACT-query", `${t} → buildPlaceRecommendationQueries 不受 activityPreference 影響`, withAct === withoutAct, withAct === withoutAct ? "" : `with=${withAct} without=${withoutAct}`);
    check(G, "ACT-query-city", `${t} → query 不含活動片段`, !/看楓|滑雪|潛水|吃美食|吃小吃/.test(withAct), withAct.slice(0, 200));
  }
  // 無活動的句子不得產生 activityPreference
  for (const t of ["我想去京都，推薦景點", "推薦京都 10 個景點", "京都嵐山推薦景點", "推薦大阪美食", "台南安平有什麼景點"]) {
    const o = obs(t);
    check(G, "ACT-none", `${t} → 不得產生 activityPreference`, o.act === null, `actual=${o.act}`);
  }
  // 不得刪除使用者需求：活動句的 primaryType 與「無活動版本」的偏好欄位不得少
  {
    const o = obs("我想去大阪探索在地美食，推薦 5 家");
    check(G, "ACT-local", "我想去大阪探索在地美食，推薦 5 家 → localPreference 保留", o.local === true, fmt(o));
  }
  // 「只記錄、不影響 query／排序／Gate」：production 程式碼（非 parse/types）不得讀取 activityPreference。
  {
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const f = path.join(dir, name);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
          const src = readFileSync(f, "utf8");
          if (src.includes("activityPreference")) hits.push(path.relative(WORK_ROOT, f));
        }
      }
    };
    walk(path.join(WORK_ROOT, "src"));
    const allowed = new Set([
      "src/lib/ai/place-recommendation-intent/parse.ts",
      "src/lib/ai/place-recommendation-intent/types.ts",
      // 既有、不同欄位（activityPreferences 陣列，規劃限制用），非本次新增
      "src/lib/ai/planning-conversation-constraints.ts",
    ]);
    const extra = hits.filter((h) => !allowed.has(h));
    check(G, "ACT-static-readonly", "activityPreference 只在 parse/types 出現（不進 query／排序／Gate）", extra.length === 0, `hits=${hits.join(",")}`);
  }
}

// ═══ X. 泛化：需求清單外的城市與活動 ═══
{
  const G = "X-Generalization";
  // [句子, 城市, 預期活動片段]；活動片段為原文（詞表外保留原片段）
  const GEN = [
    ["我想去札幌泡湯，推薦景點", "札幌", "泡湯"],
    ["我想去箱根泡湯，推薦景點", "箱根", "泡湯"],
    ["我想去首爾逛街，推薦景點", "首爾", "逛街"],
    ["我想去釜山看海，推薦景點", "釜山", "看海"],
    ["我想去高雄看海，推薦景點", "高雄", "看海"],
    ["我想去花蓮騎單車，推薦景點", "花蓮", "騎單車"],
    ["我想去台中爬山，推薦景點", "台中", "爬山"],
    ["我想去福岡吃拉麵，推薦 5 家", "福岡", "吃拉麵"],
    ["我想去福岡吃拉麵，推薦 5 家拉麵店", "福岡", "吃拉麵"],
    ["我想去名古屋逛街，推薦景點", "名古屋", "逛街"],
    ["我想去東京看夜景，推薦景點", "東京", "看夜景"],
    ["我想去奈良看鹿，推薦景點", "奈良", "看鹿"],
    ["我想去宜蘭泡湯，推薦景點", "宜蘭", "泡湯"],
    // 封閉動詞表外的活動（散步／露營／健行／購物／穿和服）：活動仍不得併入目的地
    ["我想去京都散步，推薦景點", "京都", "散步"],
    ["我想去宜蘭露營，推薦景點", "宜蘭", "露營"],
    ["我想去北海道健行，推薦景點", "北海道", "健行"],
    ["我想去首爾購物，推薦景點", "首爾", "購物"],
    ["我想去京都穿和服，推薦景點", "京都", "穿和服"],
  ];
  for (const [t, city, act] of GEN) {
    const o = obs(t);
    const k = needBase(t);
    check(G, "GEN-route", `${t} → 推薦路由`, RECO.has(o.route), fmt(o));
    check(G, "GEN-dest", `${t} → destinationName === ${city}（活動不得併入）`, o.dest === city, fmt(o));
    for (const [kk, v] of [
      ["scope", o.scope],
      ["from", o.from],
      ["searchScope", o.searchScopeDest],
    ]) {
      check(G, `GEN-no-merge-${kk}`, `${t} → ${kk} 不含「${act}」`, !String(v).includes(act), `${kk}=${v}`);
    }
    check(G, "GEN-act", `${t} → activityPreference 保留「${act}」`, o.act === act, `actual=${o.act}`);
    deferred.push((B) => {
      const b = B[k];
      if (!b) return;
      // 記錄基準狀態（PRE/NEW 判讀用），不計分
      results.push({ group: G, id: "GEN-base-info", label: `${t} 基準`, ok: true, actual: `INFO base: ${fmt(b)}` });
    });
  }
}

// ═══ 4. Destination Parsing（合法複合地名與基準比對）═══
{
  const G = "4-DestinationParsing";
  const COMPOUND = [
    ["京都嵐山推薦景點", "京都嵐山"],
    ["東京澀谷有什麼景點推薦", "東京澀谷"],
    ["台南安平有什麼景點", "台南安平"],
    ["大阪難波有什麼好吃的推薦", "大阪難波"],
    ["北海道推薦景點", "北海道"],
  ];
  for (const [t, exp] of COMPOUND) {
    const o = obs(t);
    check(G, "DST-compound", `${t} → ${exp}`, o.dest === exp, fmt(o));
  }
  {
    const o = obs("台中逢甲夜市推薦");
    check(G, "DST-fengjia", "台中逢甲夜市推薦 → scope 台中逢甲（area=逢甲）", o.scope.startsWith("台中逢甲|台中|逢甲|"), fmt(o));
  }
  // 複合地名＋活動
  for (const [t, city, act, extra] of [
    ["我想去京都嵐山看楓葉，推薦景點", "京都嵐山", "賞楓", {}],
    ["我想去東京澀谷逛街，推薦景點", "東京澀谷", "逛街", {}],
    ["我想去台南安平吃小吃，推薦 5 家", "台南安平", "在地小吃", { count: 5 }],
    ["我想去大阪難波吃美食，推薦 5 家", "大阪難波", "美食", { count: 5 }],
    ["我想去台中逢甲吃小吃，推薦 5 家", "台中逢甲", "在地小吃", { count: 5 }],
  ]) {
    const o = obs(t);
    check(G, "DST-cmp-act-dest", `${t} → destinationName === ${city}`, o.dest === city, fmt(o));
    check(G, "DST-cmp-act-act", `${t} → activityPreference === ${act}`, o.act === act, fmt(o));
    if (extra.count) check(G, "DST-cmp-act-cnt", `${t} → requestedCount === ${extra.count}`, o.cnt === extra.count, fmt(o));
  }
  {
    const t = "我想去大阪探索在地美食，推薦 5 家";
    const o = obs(t);
    check(G, "DST-osaka-explore", `${t} → 大阪`, o.dest === "大阪", fmt(o));
    check(G, "DST-osaka-explore-scope", `${t} → scope／from／searchScope 不含「探索」「在地」`, ![o.scope, o.from, o.searchScopeDest].some((v) => /探索|在地/.test(String(v))), fmt(o));
    check(G, "DST-osaka-explore-cnt", `${t} → 5`, o.cnt === 5, fmt(o));
    checkRecoConsistent(G, "DST-osaka-explore-route", t, o);
  }
  // 不得影響既有 Destination Scope：不含活動／描述詞的句子，scope／from／dest 與基準完全一致。
  for (const t of [
    "京都嵐山推薦景點",
    "京都祇園推薦景點",
    "東京澀谷推薦景點",
    "東京淺草推薦景點",
    "東京新宿推薦餐廳",
    "大阪難波推薦餐廳",
    "大阪梅田推薦餐廳",
    "台南安平推薦景點",
    "台中逢甲夜市推薦",
    "台北信義推薦咖啡廳",
    "台北北投推薦景點",
    "高雄旗津推薦景點",
    "新北淡水推薦景點",
    "宜蘭礁溪推薦景點",
    "首爾弘大推薦咖啡廳",
    "首爾明洞推薦餐廳",
    "福岡天神推薦餐廳",
    "北海道推薦景點",
    "北海道有什麼美食推薦",
    "台中逢甲有什麼好吃的",
    "京都嵐山",
    "東京澀谷",
    "台南安平",
    // 地名首字恰為活動動詞字（看／買）：不得被活動規則切掉
    "台南看西街推薦景點",
    "旭川買物公園推薦",
  ]) {
    const k = needBase(t);
    deferred.push((B) => {
      const o = obs(t);
      const b = B[k];
      check(
        G,
        "DST-base-parity",
        `${t} → scope／resolveDestinationFromText／dest 與基準一致`,
        b && o.scope === b.scope && o.from === b.from && o.dest === b.dest,
        `work: scope=${o.scope} from=${o.from} dest=${o.dest} | base: ${b ? `scope=${b.scope} from=${b.from} dest=${b.dest}` : "N/A"}`,
      );
    });
  }
}

// ═══ 5. Requested Count ═══
{
  const G = "5-RequestedCount";
  const parse = (t) =>
    W.count?.parseRequestedRecommendationCount ? safe(() => W.count.parseRequestedRecommendationCount(t)) : "MODULE_MISSING";
  const shown = (t, topic = "attraction") =>
    typeof W.recSession.resolveRequestedDisplayBatchSize === "function"
      ? W.recSession.resolveRequestedDisplayBatchSize(W.count?.parseRequestedRecommendationCount?.(t) ?? null, topic)
      : "MISSING";
  // [text, parse 預期, 顯示預期]
  const POS = [
    // 需求清單
    ["推薦十個景點", 10, 10],
    ["推薦十二個景點", 12, 10],
    ["推薦一百個景點", 100, 10],
    ["推薦兩個景點", 2, 2],
    ["推薦三到五個景點", 5, 5],
    ["推薦 100 個景點", 100, 10],
    ["推薦 3 到 5 個景點", 5, 5],
    // 動詞在前
    ["幫我推薦 7 家咖啡廳", 7, 7],
    ["給我 4 間餐廳", 4, 4],
    ["列出六處景點", 6, 6],
    ["介紹八個京都景點", 8, 8],
    ["推薦我 6 個景點", 6, 6],
    // 動詞在後
    ["5個京都景點推薦", 5, 5],
    ["三家台南小吃推薦", 3, 3],
    ["台南景點推薦 5 個", 5, 5],
    ["台南小吃推薦五家", 5, 5],
    ["4 處札幌景點推薦一下", 4, 4],
    // 目的地夾在中間
    ["推薦京都 10 個景點", 10, 10],
    ["推薦台北五家咖啡廳", 5, 5],
    ["幫我推薦大阪難波 4 家燒肉", 4, 4],
    ["推薦首爾弘大附近 5 間咖啡廳", 5, 5],
    ["我想去京都，推薦 10 個景點", 10, 10],
    ["可以推薦 3 個台南景點嗎", 3, 3],
    ["推薦北海道札幌市區 5 處景點", 5, 5],
    // 全形／阿拉伯／中文
    ["推薦５家拉麵店", 5, 5],
    ["推薦１０個景點", 10, 10],
    ["推薦１２個景點", 12, 10],
    ["推薦九間咖啡廳", 9, 9],
    ["推薦二十個景點", 20, 10],
    ["推薦 3-5 個景點", 5, 5],
    ["推薦３～５個景點", 5, 5],
  ];
  for (const [t, ep, es] of POS) {
    check(G, "CNT-pos", `parse(${t}) === ${ep}`, parse(t) === ep, `actual=${parse(t)}`);
    check(G, "CNT-shown", `顯示張數(${t}) === ${es}`, shown(t) === es, `actual=${shown(t)}`);
  }
  // 反例：日期、天數、夜數、房間、價格、人數、年份、已去過／序數／指示詞
  const NEG = [
    "京都 3 天推薦景點",
    "京都三天兩夜，推薦景點",
    "住 2 晚推薦飯店",
    "住兩晚，推薦 飯店",
    "訂 2 間房推薦飯店",
    "幫我推薦兩間房的飯店",
    "推薦 5000 元以下的餐廳",
    "預算 3000 元推薦餐廳",
    "推薦適合 4 個人的餐廳",
    "我們 4 個人，推薦餐廳",
    "推薦適合 2 個大人 1 個小孩的景點",
    "2026 年推薦京都景點",
    "推薦 2026 年的京都景點",
    "12 月推薦景點",
    "3 月 5 號推薦景點",
    "推薦 10 月的景點",
    "推薦 2 個小時可以逛完的景點",
    "其中 3 個去過了，推薦其他景點",
    "其中3個去過了，推薦其他景點",
    "我去過3個京都景點推薦別的",
    "我去過 3 個京都景點推薦別的",
    "第3個推薦的景點不錯",
    "第 3 個推薦的景點不錯",
    "這3個景點推薦嗎",
    "這 3 個景點推薦嗎",
    "上次推薦的 3 個都去過了",
    "推薦幾個京都景點",
    "五星級飯店推薦",
  ];
  for (const t of NEG) {
    check(G, "CNT-neg", `parse(${t}) === null（非推薦數量）`, parse(t) === null, `actual=${parse(t)}`);
    check(G, "CNT-neg-shown", `顯示張數(${t}) === 3（未指定）`, shown(t) === 3, `actual=${shown(t)}`);
  }
  check(G, "CNT-default", "未指定 → 3（attraction）", W.recSession.resolveRequestedDisplayBatchSize?.(null, "attraction") === 3, "");
  check(G, "CNT-cap", "上限 MAX_REQUESTED_DISPLAY_BATCH_SIZE === 10", W.count?.MAX_REQUESTED_DISPLAY_BATCH_SIZE === 10, `actual=${W.count?.MAX_REQUESTED_DISPLAY_BATCH_SIZE}`);
  // 端到端：intent.requestedCount 必須真的被 production 顯示路徑使用，否則使用者永遠看到 3 張。
  {
    const consumers = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const f = path.join(dir, name);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
          const src = readFileSync(f, "utf8");
          const rel = path.relative(WORK_ROOT, f);
          if (rel === "src/lib/ai/conversation-recommendation-session.ts" || rel === "src/lib/ai/requested-recommendation-count.ts") continue;
          if (/resolveRequestedDisplayBatchSize\s*\(|\.requestedCount\b(?!\s*[:=]\s*number)/.test(src) && !/nearby-geographic-scope|chat-place-recommendation\.ts/.test(rel)) consumers.push(rel);
          else if (/resolveRequestedDisplayBatchSize/.test(src)) consumers.push(rel);
        }
      }
    };
    walk(path.join(WORK_ROOT, "src"));
    const realConsumers = consumers.filter((c) => c !== "src/lib/ai/place-recommendation-intent/parse.ts");
    check(
      G,
      "CNT-wired",
      "requestedCount／resolveRequestedDisplayBatchSize 被 production 顯示路徑（_app.chat.tsx 等）使用",
      realConsumers.length > 0,
      `consumers=${realConsumers.join(",") || "無"}；_app.chat.tsx displayBatchSize 仍為 DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE`,
    );
  }
}

// ═══ 6. Cross-Destination ═══
{
  const G = "6-CrossDestination";
  for (const [t, city, act] of [
    ["我想去京都看楓葉，推薦景點", "京都", "賞楓"],
    ["我想去札幌泡湯，推薦景點", "札幌", "泡湯"],
    ["我想去台南吃小吃，推薦 5 家", "台南", "在地小吃"],
  ]) {
    const o = obs(t, "osaka");
    check(G, "XD-route", `[大阪推薦中] ${t} → NEW_RECOMMENDATION（不得沿用大阪續推／精煉）`, o.route === "NEW_RECOMMENDATION", fmt(o));
    check(G, "XD-dest", `[大阪推薦中] ${t} → destinationName === ${city}`, o.dest === city, fmt(o));
    check(G, "XD-act", `[大阪推薦中] ${t} → activityPreference === ${act}`, o.act === act, fmt(o));
    check(G, "XD-no-osaka", `[大阪推薦中] ${t} → 不含大阪`, ![o.dest, o.scope, o.searchScopeDest].some((v) => String(v).includes("大阪")), fmt(o));
  }
  for (const t of ["我想去京都看楓葉", "我想去京都"]) {
    const k = needBase(t, "osaka");
    deferred.push((B) => {
      const o = obs(t, "osaka");
      const b = B[k];
      check(G, "XD-intent-only-base", `[大阪推薦中] ${t} → 路由與基準一致`, b && o.route === b.route, `work=${o.route} base=${b?.route}`);
    });
  }
}

// ═══ 7. Continuation（含 activityPreference 在 session 中的保留）═══
{
  const G = "7-Continuation";
  const first = W.intent.parsePlaceRecommendationIntent("我想去京都看楓葉，推薦景點");
  check(G, "CONT-t1", "第一輪解析出 activityPreference=賞楓", first?.activityPreference === "賞楓", `actual=${first?.activityPreference}`);
  const places = [
    { googlePlaceId: "k1", name: "永觀堂" },
    { googlePlaceId: "k2", name: "東福寺" },
    { googlePlaceId: "k3", name: "清水寺" },
  ];
  // (a) ActiveRecommendationContext — ensureActiveRecommendationContext（production 建立點）
  const ctx = W.refSession.ensureActiveRecommendationContext(baseSession(), {
    destination: first?.destinationName ?? "京都",
    intent: "attraction",
    places,
  });
  check(
    G,
    "CONT-ctx-activity",
    "ActiveRecommendationContext 保留 activityPreference（ensureActiveRecommendationContext）",
    ctx?.activityPreference === "賞楓" || JSON.stringify(ctx).includes("賞楓"),
    `ctx keys=${Object.keys(ctx ?? {}).join(",")}；types.ts ActiveRecommendationContext 無此欄位、session.ts ensureActiveRecommendationContext params 無此參數`,
  );
  // (b) ConversationRecommendationSession — createRecommendationSession
  const { session: recSession } = W.recSession.createRecommendationSession({
    destination: "京都",
    topic: "attraction",
    pool: places,
  });
  check(
    G,
    "CONT-recsession-activity",
    "ConversationRecommendationSession 保留 activityPreference（createRecommendationSession）",
    JSON.stringify(recSession).includes("賞楓"),
    `session keys=${Object.keys(recSession).join(",")}`,
  );
  // (c) 續推當輪：「還有嗎」在京都推薦 context 下解析，activityPreference 應仍可取得
  const kyotoSess = { ...baseSession(), activeRecommendationContext: ctx, activeCategoryIntent: "attraction", recommendationSession: recSession };
  const more = W.intent.parsePlaceRecommendationIntent("還有嗎", { hasActiveRecommendationContext: true, activePrimaryType: "attraction" });
  const route = W.arb.resolveChatIntentArbitration("還有嗎", kyotoSess).route;
  check(G, "CONT-route", "[京都賞楓推薦中] 還有嗎 → MORE_RECOMMENDATIONS", route === "MORE_RECOMMENDATIONS", `route=${route}`);
  check(G, "CONT-cont", "[京都賞楓推薦中] 還有嗎 → continuation=more_results", more?.continuation === "more_results", `actual=${more?.continuation}`);
  const ctxAfter = kyotoSess.activeRecommendationContext;
  check(
    G,
    "CONT-more-activity",
    "續推時仍可取得 activityPreference（解析結果或 context 任一保留）",
    more?.activityPreference === "賞楓" || ctxAfter?.activityPreference === "賞楓",
    `parse(還有嗎).activityPreference=${more?.activityPreference} ctx.activityPreference=${ctxAfter?.activityPreference}`,
  );
  // (d) 從 recommendationSession 重建（workspace restore）
  const restored = W.refSession.restoreActiveRecommendationContextFromWorkspace({
    session: { ...baseSession(), recommendationSession: recSession },
    workspaceContext: null,
  });
  check(
    G,
    "CONT-restore-activity",
    "restoreActiveRecommendationContextFromWorkspace 重建後保留 activityPreference",
    JSON.stringify(restored.activeRecommendationContext ?? {}).includes("賞楓"),
    `restored keys=${Object.keys(restored.activeRecommendationContext ?? {}).join(",")}`,
  );
  // (e) 續推不得改變目的地
  {
    const o = obs("還有嗎", "kyoto");
    check(G, "CONT-kyoto-route", "[京都推薦中] 還有嗎 → MORE_RECOMMENDATIONS", o.route === "MORE_RECOMMENDATIONS", fmt(o));
    check(G, "CONT-kyoto-no-dest", "[京都推薦中] 還有嗎 → 不得解析出新目的地", o.dest === null, fmt(o));
  }
}

// ═══ X. Provider calls（本腳本工作區側；基準側於 deferred 檢查）═══
{
  const G = "X-ProviderCalls";
  const read = (rel) => safe(() => readFileSync(path.join(WORK_ROOT, rel), "utf8"));
  for (const rel of [
    "src/lib/ai/requested-recommendation-count.ts",
    "src/lib/ai/travel-language-signals.ts",
    "src/lib/ai/destination-travel-profile.ts",
    "src/lib/ai/place-recommendation-intent/parse.ts",
    "src/lib/ai/recommendation-refinement/arbitrate.ts",
  ]) {
    const s = String(read(rel));
    check(G, "STATIC-no-network", `${rel} 無 fetch／supabase／invoke／googleapis／AI client 呼叫`, !s.startsWith("THROW:") && !/\bfetch\s*\(|supabase|\.invoke\s*\(|googleapis|openai|anthropic|gemini/i.test(s), "");
  }
}

// ═══ 基準子行程 ═══
let B = null;
let baseFetchCalls = null;
let baseErr = "";
if (existsSync(path.join(BASE_ROOT, "src/lib/ai/recommendation-refinement/index.ts"))) {
  const res = spawnSync(
    "npx",
    ["vite-node", path.join(WORK_ROOT, "scripts/verify-recommendation-intent-activity-final.mjs"), "--config", path.join(BASE_ROOT, "scripts/vite.verify.config.mjs")],
    {
      cwd: BASE_ROOT,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        VERIFY_ACTIVITY_ROLE: "collect",
        VERIFY_ROOT: BASE_ROOT,
        VERIFY_ACTIVITY_PROBES: JSON.stringify([...baseProbes.values()]),
      },
    },
  );
  const line = String(res.stdout ?? "").split("\n").find((l) => l.startsWith("@@BASE_JSON@@"));
  if (line) {
    const parsed = JSON.parse(line.slice("@@BASE_JSON@@".length));
    B = parsed.out;
    baseFetchCalls = parsed.fetchCalls;
  } else {
    baseErr = `status=${res.status} signal=${res.signal} err=${String(res.stderr ?? "").slice(-400)}`;
  }
} else {
  baseErr = `base root missing: ${BASE_ROOT}`;
}
check("X-ProviderCalls", "BASE-available", "基準子行程可執行（用於 PRE/NEW 比對）", B != null, baseErr);
// 基準模組必須是真的基準（新增模組不存在）：防止 alias 混用工作區
if (B) {
  const k = [...baseProbes.keys()].find((x) => x.endsWith("我想去京都看楓葉"));
  check("X-ProviderCalls", "BASE-isolated", "基準子行程的模組未混入工作區（基準無 activityPreference）", k && B[k] && B[k].act === null, k ? `base act=${B[k]?.act}` : "");
  check("X-ProviderCalls", "BASE-fetch", "基準子行程 fetch 呼叫次數 = 0", baseFetchCalls === 0, `baseFetchCalls=${baseFetchCalls}`);
}
for (const fn of deferred) {
  if (B) fn(B);
}
if (!B) {
  check("X-ProviderCalls", "BASE-UNAVAILABLE", `需基準的 ${deferred.length} 組檢查無法執行`, false, baseErr);
}
// 計分前的資訊行：E/F 的基準路由
if (B) {
  for (const t of ["推薦京都景點並幫我安排參觀路線", "幫我排一下京都景點的路線"]) {
    const b = B[`fresh\u0000${t}`];
    results.push({ group: "2-PlanningIntent", id: "PLAN-base-info", label: `${t} 基準`, ok: true, actual: `INFO base route=${b?.route}` });
  }
}

check("X-ProviderCalls", "FETCH", "工作區 provider fetch 呼叫次數 = 0（fetch trap 實際計數）", fetchCalls === 0, `fetchCalls=${fetchCalls} ${fetchLog.join(" ; ")}`);
check("X-ProviderCalls", "FETCH-intact", "globalThis.fetch 仍為 trap（未被模組替換）", globalThis.fetch === fetchTrap, "");

// ═══ 8–10：由既有 verify 腳本負責（本腳本不重複實作），在此只記錄應執行的腳本 ═══
const EXTERNAL = {
  "8-TouristQualityGate": "scripts/verify-tourist-quality-gate-v2*.mjs",
  "9-RecommendationReasonV2": "scripts/verify-recommendation-reason-v2.mjs",
  "10-CreditsCompatibility": "scripts/verify-credits*.mjs、verify-itinerary-*credit*.mjs",
};

restore();
const extraTexts = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith(".mjs"));
for (const t of extraTexts) {
  silence();
  const o = obs(t);
  restore();
  console.log(`DUMP\t${t}\t${fmt(o)}`);
}
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}\t[${r.group}]\t${r.id}\t${r.label}\t${r.actual}`);
console.log("\n── 分組結論 ──");
for (const g of GROUPS) {
  if (EXTERNAL[g]) {
    console.log(`${g}: 由既有腳本驗證（${EXTERNAL[g]}）`);
    continue;
  }
  const rs = results.filter((r) => r.group === g && !r.actual.startsWith("INFO"));
  const f = rs.filter((r) => !r.ok).length;
  console.log(`${g}: ${f === 0 ? "PASS" : "FAIL"} (${rs.length - f}/${rs.length})`);
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\nverify-recommendation-intent-activity-final: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`,
);
process.exit(failed.length ? 1 : 0);
