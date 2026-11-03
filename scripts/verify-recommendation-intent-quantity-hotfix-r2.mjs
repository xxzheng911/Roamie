#!/usr/bin/env node
/**
 * T14 — Recommendation Intent & Quantity Hotfix 第 2 輪獨立驗收（lib 層）。
 *
 * 執行：npx vite-node scripts/verify-recommendation-intent-quantity-hotfix-r2.mjs --config scripts/vite.verify.config.mjs
 *
 * 1. 數量對抗案例（訂房數／已去過／其中／範圍／人氣）。
 * 2. 不變量（全新 session）：arbitration 不得回 GENERAL_CHAT 而 isTravelPlanningText／resolveChatIntent
 *    仍判規劃；反向分裂（arbitration 規劃、isTravelPlanningText 非規劃）也檢查。≥20 句「想去／要去＋名詞／問詞」。
 * 3. 跨語言（英／日／韓）與簡體：必須與基準 aa2db59 一致或更好（基準值取自基準實跑）。
 * 4. 意圖對抗：明確行程字眼仍規劃；推薦意圖未被全面提高；推薦中切換目的地；續推。
 * 5. 解析：描述詞尾不得成為目的地。
 * 6. fetch trap = 0。
 *
 * 標 PRE 的案例在基準 aa2db59 實跑即同樣失敗（非本次 regression），斷言保留、仍計為失敗。
 * 每句會印出 MATRIX 行（route／tpt／rci／mode），供與基準逐句比對。
 */
let fetchCalls = 0;
const fetchTrap = async (...args) => {
  fetchCalls += 1;
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};
globalThis.fetch = fetchTrap;

const origInfo = console.info;
console.info = () => {};

const { resolveChatIntentArbitration } =
  await import("../src/lib/ai/recommendation-refinement/index.ts");
const { createActiveRecommendationContext } =
  await import("../src/lib/ai/recommendation-refinement/merge.ts");
const { parsePlaceRecommendationIntent } =
  await import("../src/lib/ai/place-recommendation-intent/index.ts");
const { isTravelPlanningText } = await import("../src/lib/ai/chat-intent-router.ts");
const { resolveChatIntent } = await import("../src/lib/ai/chat-dining-flow.ts");
const { resolveConversationMode } = await import("../src/lib/ai/trip-planning-context.ts");
const sessionMod = await import("../src/lib/ai/conversation-recommendation-session.ts");
let countMod = null;
try {
  countMod = await import("../src/lib/ai/requested-recommendation-count.ts");
} catch {
  countMod = null;
}

const results = [];
const matrix = [];
function check(id, label, ok, actual) {
  results.push({ id, label, ok: Boolean(ok), actual: String(actual) });
}
function pred(desc, fn) {
  return Object.assign(fn, { desc });
}
const session = (o = {}) => ({
  recommendedPlaces: [],
  selectedPlaces: [],
  phase: "discover",
  discovery: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...o,
});
const RECO = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS"]);
const PLAN = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
function classify(t, s = session()) {
  const safe = (fn) => {
    try {
      return fn();
    } catch (e) {
      return `THROW:${e?.message ?? e}`;
    }
  };
  const row = {
    t,
    route: safe(() => resolveChatIntentArbitration(t, s).route),
    tpt: safe(() => isTravelPlanningText(t)),
    rci: safe(() => resolveChatIntent(t, s)),
    mode: safe(() => resolveConversationMode(t, s)),
  };
  matrix.push(row);
  return row;
}
const fmt = (r) => `route=${r.route} tpt=${r.tpt} rci=${r.rci} mode=${r.mode}`;
const parseCount = (t) => {
  if (!countMod?.parseRequestedRecommendationCount) return "MODULE_MISSING";
  return countMod.parseRequestedRecommendationCount(t);
};

// ── 1. 數量對抗 ──
for (const [t, exp] of [
  ["訂兩間房，推薦京都飯店", null],
  ["去過3個地方了，再推薦景點", null],
  ["其中兩個不錯，再推薦景點", null],
  // T15 契約變更（使用者授權）：範圍取上限，舊 null → 新 5。
  ["推薦 3-5 個景點", 5],
  ["推薦3到5個景點", 5],
  ["推薦三到五個景點", 5],
  ["推薦 3~5 個景點", 5],
  ["3 到 5 個景點推薦", 5],
  ["3 - 5 個景點推薦", 5],
  ["推薦5個人氣景點", 5],
  ["推薦 7 個人氣景點", 7],
  ["推薦我 4 家餐廳", 4],
  ["幫我推薦十個景點", 10],
  ["推薦十二個景點", 12],
  ["推薦二十個景點", 20],
  ["5個景點推薦", 5],
  ["推薦 ８ 家咖啡廳", 8],
  ["我們兩個人，推薦餐廳", null],
  ["兩個人推薦餐廳", null],
  ["2 個小孩推薦景點", null],
  ["住 3 晚，推薦景點", null],
  ["待 5 天推薦景點", null],
  ["預算 2000 元推薦 3 間飯店", 3],
  ["3 星飯店推薦", null],
  ["4.5 星以上餐廳推薦", null],
  ["評價 4 分以上推薦餐廳", null],
  ["2 間房推薦飯店", null],
  ["要兩間房推薦飯店", null],
  ["需要兩間房，推薦飯店", null],
  ["已經去過 2 個景點，再推薦", null],
  ["上次推薦的 3 個都去過了", null],
  ["推薦 0 個景點", null],
  ["推薦一兩個景點", null],
  ["推薦幾個景點", null],
  ["推薦十幾個景點", pred("null 或 ≥10（模糊量詞）", (v) => v === null || v >= 10)],
]) {
  const actual = parseCount(t);
  const ok = typeof exp === "function" ? exp(actual) : actual === exp;
  const expLabel = typeof exp === "function" ? exp.desc : exp;
  check("CNT", `parseRequestedRecommendationCount(${t}) === ${expLabel}`, ok, `actual=${actual}`);
}
{
  const display = (t) =>
    typeof sessionMod.resolveRequestedDisplayBatchSize === "function"
      ? sessionMod.resolveRequestedDisplayBatchSize(
          countMod?.parseRequestedRecommendationCount?.(t) ?? null,
          "attraction",
        )
      : "MISSING";
  for (const [t, exp] of [
    ["推薦 10 個景點", 10],
    ["推薦 11 個景點", 10],
    ["推薦 30 個景點", 10],
    ["推薦 99 個景點", 10],
    ["推薦京都景點", 3],
    ["京都三天兩夜推薦景點", 3],
  ]) {
    const actual = display(t);
    check("DISPLAY", `顯示張數(${t}) === ${exp}`, actual === exp, `actual=${actual}`);
  }
}
{
  const n = parsePlaceRecommendationIntent("推薦5個人氣景點")?.requestedCount;
  check(
    "CNT-intent",
    "parsePlaceRecommendationIntent(推薦5個人氣景點).requestedCount === 5",
    n === 5,
    `actual=${n}`,
  );
}

// ── 2. 不變量：全新 session，「想去／要去 + 名詞／問詞」 ──
const WANT_TO_GO = [
  "我想去京都，推薦景點",
  "我想去京都，有什麼景點",
  "我想去京都，哪些景點值得去",
  "我想去京都，景點推薦",
  "我想去京都，有哪些景點？",
  "我想去京都，景點有哪些",
  "我想去大阪，推薦餐廳",
  "我要去大阪，餐廳有沒有推薦",
  "我想去東京，有沒有咖啡廳",
  "我要去首爾，有什麼美食推薦",
  "我想去台北，推薦酒吧",
  "我想去京都，推薦 5 家餐廳",
  "我想去台南，有什麼小吃推薦",
  "我想去日本，推薦一些地方",
  "我想去京都，推薦住哪個地方",
  "我想去京都，夜市推薦",
  "我想去台北，有什麼夜市",
  "我想去京都，神社推薦",
  "我想去京都，推薦寺廟",
  "我想去京都，推薦博物館",
  "我想去京都，推薦飯店",
  "我想去北海道，推薦溫泉",
  "想去沖繩，推薦海灘",
  "我想去京都，哪裡好玩",
  "我想去京都，有什麼好吃的",
  "我想去京都，推薦什麼",
  "我想去京都，推薦一下",
  "我想去京都，怎麼去",
  "我想去京都，天氣如何",
  "我要去東京，推薦購物的地方",
  "我想去日本，推薦城市",
  "我想去京都，第一次去推薦景點",
  "我想去京都看楓葉，推薦景點",
  "我想去京都玩，推薦 10 個景點",
  "下個月要去大阪玩，推薦一些景點",
  "12月要去大阪，推薦一些景點",
  "我想去京都住一週，推薦景點",
  "我想去京都，推薦景點並排一下路線",
  "我想去京都，不用排行程，推薦景點就好",
  "我要去京都，有沒有推薦的咖啡店",
  "我想去京都和大阪，推薦景點",
];
// 基準 aa2db59 實跑即同樣結果（route=GENERAL_CHAT tpt=true rci=destination_advice），非本次 regression。
const PRE_SPLIT = new Set(["我想去京都，天氣如何", "京都三天兩夜行程推薦"]);
let wantCount = 0;
for (const t of WANT_TO_GO) {
  const r = classify(t);
  wantCount += 1;
  const otherPlan = r.tpt === true || r.rci === "trip_planning";
  check(
    PRE_SPLIT.has(t) ? "PRE" : "INV",
    `${t}：不得 arbitration=GENERAL_CHAT 而其他分類器判規劃`,
    !(r.route === "GENERAL_CHAT" && otherPlan),
    fmt(r),
  );
}
check("INV-n", "不變量句數 ≥ 20", wantCount >= 20, `n=${wantCount}`);

// 反向一致性（較嚴）：arbitration 判推薦 → isTravelPlanningText 為 false；判規劃 → true。
for (const t of WANT_TO_GO) {
  const r = matrix.find((m) => m.t === t);
  const ok =
    (RECO.has(r.route) && r.tpt === false) ||
    (PLAN.has(r.route) && r.tpt === true) ||
    (!RECO.has(r.route) && !PLAN.has(r.route) && r.tpt === false);
  const pre = PRE_SPLIT.has(t);
  check(
    pre ? "PRE" : "INV-REV",
    `${t}：arbitration 與 isTravelPlanningText 方向一致${pre ? "（基準亦失敗）" : ""}`,
    ok,
    fmt(r),
  );
}

// ── 3. 跨語言／簡體：與基準一致或更好 ──
// 基準值為 aa2db59 實跑結果；給完整簽章（route|tpt|rci|mode）時要求全等，否則只比 route。
// 「更好」：推薦句進推薦路由、規劃句仍規劃。
const XLANG = [
  ["我想去京都，推荐10个景点", "reco", "NEW_TRIP_PLANNING"],
  ["下个月要去大阪，推荐一些景点", "reco", "NEW_TRIP_PLANNING"],
  ["我想去京都探索比较冷门的历史文化景点，帮我推荐10个。", "reco", "NEW_TRIP_PLANNING"],
  ["帮我安排京都三天行程", "plan", "NEW_TRIP_PLANNING"],
  ["我想去京都玩三天", "plan", "NEW_TRIP_PLANNING"],
  ["帮我规划京都三天行程，顺便推荐一些景点", "plan", "NEW_TRIP_PLANNING"],
  ["I want to go to Kyoto, recommend 10 attractions", "reco", "NEW_TRIP_PLANNING"],
  ["I'm going to Osaka next month, any sightseeing recommendations?", "reco", "NEW_TRIP_PLANNING"],
  ["Plan a 3-day trip to Kyoto", "plan", "NEW_TRIP_PLANNING"],
  ["京都に行きたい、おすすめの観光地を10個教えて", "reco", "GENERAL_CHAT|false|general|general"],
  ["京都に3日間旅行したい", "plan", "NEW_TRIP_PLANNING"],
  ["교토에 가고 싶어요, 관광지 추천해줘", "reco", "GENERAL_CHAT|false|general|general"],
];
for (const [t, kind, baseSig] of XLANG) {
  const r = classify(t);
  const [baseRoute, ...rest] = baseSig.split("|");
  const same = rest.length
    ? `${r.route}|${r.tpt}|${r.rci}|${r.mode}` === baseSig
    : r.route === baseRoute;
  const better = kind === "reco" ? RECO.has(r.route) : PLAN.has(r.route);
  check("XLANG", `${t}（${kind}）與基準 ${baseSig} 一致或更好`, same || better, fmt(r));
  check(
    "XLANG-INV",
    `${t}：不得 GENERAL_CHAT 而其他分類器判規劃`,
    !(r.route === "GENERAL_CHAT" && (r.tpt === true || r.rci === "trip_planning")),
    fmt(r),
  );
}

// ── 4. 意圖對抗：規劃字眼仍規劃；未全面提高推薦 ──
for (const t of [
  "我想去京都玩三天，推薦景點",
  "我想去京都，推薦景點，幫我排行程",
  "我想去京都，推薦景點然後幫我排",
  "我想去京都，推薦景點，大概玩幾天比較好",
  "我想去京都兩天一夜，推薦景點",
  "我想去京都，推薦一日遊景點",
  "我想去京都，推薦景點並規劃路線",
  "幫我規劃京都三天行程，順便推薦一些景點",
  "我想去京都",
  "我要去大阪",
  "我想去京都旅行",
]) {
  const r = classify(t);
  check("PLAN", `${t} → 規劃`, PLAN.has(r.route), fmt(r));
}
for (const t of ["幫我安排京都三天行程，有推薦景點嗎", "排成三天行程", "京都三天兩夜行程推薦"]) {
  const r = classify(t);
  const pre = PRE_SPLIT.has(t);
  check(
    pre ? "PRE" : "PLAN-keep",
    `${t} → 規劃（不得被推薦搶走）${pre ? "（基準亦 GENERAL_CHAT）" : ""}`,
    PLAN.has(r.route),
    fmt(r),
  );
}
{
  const osakaReco = () =>
    session({
      activeRecommendationContext: createActiveRecommendationContext({
        destinationName: "大阪",
        intent: "attraction",
        category: "attraction",
      }),
      activeCategoryIntent: "attraction",
      recommendationSession: { topic: "attraction", destination: "大阪" },
      travelContext: { destination: "大阪", interests: [] },
    });
  for (const t of ["我想去京都，推薦景點", "我要去京都，有什麼景點推薦"]) {
    const r = classify(t, osakaReco());
    const dest =
      parsePlaceRecommendationIntent(t, {
        hasActiveRecommendationContext: true,
        activePrimaryType: "attraction",
      })?.destinationName ?? null;
    check(
      "G-switch",
      `[大阪推薦中] ${t} → 推薦且目的地京都`,
      RECO.has(r.route) && String(dest).includes("京都") && !String(dest).includes("大阪"),
      `${fmt(r)} dest=${dest}`,
    );
  }
  for (const t of ["還有嗎", "再推薦一些", "再推薦 5 個"]) {
    const r = classify(t, osakaReco());
    check(
      "I-more",
      `[大阪推薦中] ${t} → MORE_RECOMMENDATIONS`,
      r.route === "MORE_RECOMMENDATIONS",
      fmt(r),
    );
  }
}

// ── 5. 解析：描述詞尾不得成為目的地，請求詞不得併入地名 ──
for (const [t, exp] of [
  ["我想去京都探索比較冷門的歷史文化景點，幫我推薦 10 個。", "京都"],
  ["我想去京都，請推薦景點", "京都"],
  ["我想去京都，麻煩推薦景點", "京都"],
  ["我想去京都，然後推薦景點", "京都"],
  ["我想去大阪探索在地美食，推薦 5 家", "大阪"],
  ["京都嵐山冷門景點推薦", "京都嵐山"],
  ["京都祇園，幫我推薦咖啡廳", "京都祇園"],
  ["我想去東京找冷門咖啡廳，推薦 5 家", "東京"],
  ["我想去京都探索冷門歷史文化的餐廳，推薦 5 家", "京都"],
  ["我想去台北探索特色美食，推薦幾家", "台北"],
  ["我想去京都探索在地咖啡廳，推薦 3 家", "京都"],
  ["大阪探索在地美食，推薦 5 家", "大阪"],
]) {
  const d = parsePlaceRecommendationIntent(t)?.destinationName ?? null;
  check("PARSE", `${t} → destinationName === ${exp}`, d === exp, `actual=${d}`);
}
// 這些句子在基準走規劃且 intent 為 null；修正後進推薦路由，目的地不得帶描述詞。
for (const t of ["我想去大阪探索在地美食，推薦 5 家", "我想去台北探索特色美食，推薦幾家"]) {
  const r = classify(t);
  const d = parsePlaceRecommendationIntent(t)?.destinationName ?? null;
  const bad = /(?:探索|在地|特色|冷門|歷史|文化|美食)/.test(String(d ?? ""));
  check(
    "PARSE-route",
    `${t}：推薦路由時目的地不得含描述詞（${d}）`,
    !(RECO.has(r.route) && bad),
    `${fmt(r)} dest=${d}`,
  );
}
{
  const p = parsePlaceRecommendationIntent(
    "我想去京都探索比較冷門的歷史文化景點，幫我推薦 10 個。",
  );
  const q = parsePlaceRecommendationIntent("推薦京都必去景點");
  const n = parsePlaceRecommendationIntent("推薦京都景點");
  check(
    "PARSE-pop",
    "冷門 → hidden_gem",
    p?.popularityPreference === "hidden_gem",
    `actual=${p?.popularityPreference}`,
  );
  check(
    "PARSE-pop2",
    "必去 → popular",
    q?.popularityPreference === "popular",
    `actual=${q?.popularityPreference}`,
  );
  check(
    "PARSE-pop3",
    "無偏好 → 未設定",
    n?.popularityPreference === undefined,
    `actual=${n?.popularityPreference}`,
  );
}

// 規格「超過 10 → 10」資訊列（不計分）：主腳本已鎖定「推薦 100 個景點」→ null 的設計，交由指派者裁定。
for (const t of ["推薦 100 個景點", "推薦一百個景點", "推薦 999 個景點"]) {
  const n = countMod?.parseRequestedRecommendationCount?.(t) ?? null;
  const shown = sessionMod.resolveRequestedDisplayBatchSize?.(n, "attraction");
  console.log(`NOTE\t${t}\tparsed=${n}\tdisplay=${shown}`);
}

// ── 6. fetch trap ──
check("FETCH", "provider fetch 呼叫次數 = 0", fetchCalls === 0, `fetchCalls=${fetchCalls}`);
check(
  "FETCH-intact",
  "globalThis.fetch 仍為 trap",
  globalThis.fetch === fetchTrap,
  String(globalThis.fetch === fetchTrap),
);

console.info = origInfo;
for (const m of matrix) console.log(`MATRIX\t${m.t}\t${fmt(m)}`);
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}\t${r.id}\t${r.label}\t${r.actual}`);
const passed = results.length - failed.length;
console.log(
  `\nverify-recommendation-intent-quantity-hotfix-r2: ${passed}/${results.length} passed, ${failed.length} failed`,
);
if (failed.length) process.exit(1);
console.log("verify-recommendation-intent-quantity-hotfix-r2: ok");
