#!/usr/bin/env node
/**
 * T13 — Recommendation Intent & Quantity Hotfix（lib 層）回歸驗收。
 *
 * 執行：npx vite-node scripts/verify-recommendation-intent-quantity-hotfix.mjs --config scripts/vite.verify.config.mjs
 *
 * 1. 意圖 A–I：明確推薦地點（無行程字眼）不得因「想去／要去」進 Planner；明確行程仍進 Planner。
 * 2. 數量契約：未指定 → 預設；1–10 → 該數；>10 → 10；天數／夜數／人數／時間／價格／星等不得誤判。
 * 3. 解析：京都＋冷門歷史文化＋10 個；不得出現「京都冷門歷史文化」「京都幫我」目的地；其他城市／區域不變。
 * 4. fetch trap：全程 provider 呼叫 = 0。
 *
 * 失敗不中斷：逐案紀錄，最後印出表格並以非 0 exit code 結束。
 */

// ── 4. fetch trap（必須在任何 import 前安裝）──
let fetchCalls = 0;
const fetchTrap = async (...args) => {
  fetchCalls += 1;
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};
globalThis.fetch = fetchTrap;

const results = [];
function check(id, label, expected, actualFn) {
  let actual;
  try {
    actual = actualFn();
  } catch (e) {
    actual = `THROW: ${e?.message ?? e}`;
  }
  const pass = typeof expected === "function" ? expected(actual) : Object.is(actual, expected);
  results.push({
    id,
    label,
    expected: typeof expected === "function" ? expected.desc ?? "(predicate)" : String(expected),
    actual: typeof actual === "string" ? actual : JSON.stringify(actual),
    pass: Boolean(pass),
  });
}
const pred = (desc, fn) => Object.assign(fn, { desc });

// Silence noisy diagnostic logs from the lib (keep warn/error).
const origInfo = console.info;
console.info = () => {};

const { resolveChatIntentArbitration } = await import(
  "../src/lib/ai/recommendation-refinement/index.ts"
);
const { createActiveRecommendationContext } = await import(
  "../src/lib/ai/recommendation-refinement/merge.ts"
);
const { parsePlaceRecommendationIntent } = await import(
  "../src/lib/ai/place-recommendation-intent/index.ts"
);
const { resolveDestinationAreaScope } = await import("../src/lib/ai/destination-travel-profile.ts");
const { isTravelPlanningText } = await import("../src/lib/ai/chat-intent-router.ts");
const { multilingualTravelIntent } = await import("../src/lib/ai/travel-language-signals.ts");
const { resolveChatIntent } = await import("../src/lib/ai/chat-dining-flow.ts");
const { resolveConversationMode } = await import("../src/lib/ai/trip-planning-context.ts");
const sessionMod = await import("../src/lib/ai/conversation-recommendation-session.ts");

// 新檔在基準（aa2db59）不存在：以動態 import 容錯，讓基準可跑並把數量案例記為 FAIL。
let countMod = null;
try {
  countMod = await import("../src/lib/ai/requested-recommendation-count.ts");
} catch {
  countMod = null;
}
const parseCount = (t) => {
  if (!countMod?.parseRequestedRecommendationCount) throw new Error("module missing (pre-fix)");
  return countMod.parseRequestedRecommendationCount(t);
};
const resolveBatch = (n, topic) => {
  if (typeof sessionMod.resolveRequestedDisplayBatchSize !== "function") {
    throw new Error("resolveRequestedDisplayBatchSize missing (pre-fix)");
  }
  return sessionMod.resolveRequestedDisplayBatchSize(n, topic);
};

function baseSession(overrides = {}) {
  return {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const RECO_ROUTES = new Set(["NEW_RECOMMENDATION", "RECOMMENDATION_REFINEMENT", "MORE_RECOMMENDATIONS"]);
const PLAN_ROUTES = new Set(["NEW_TRIP_PLANNING", "TRIP_PLANNING_FLOW"]);
const route = (t, s = baseSession()) => resolveChatIntentArbitration(t, s).route;
const isReco = pred("推薦路由 (NEW_RECOMMENDATION/REFINEMENT/MORE)", (r) => RECO_ROUTES.has(r));
const isPlan = pred("規劃路由 (NEW_TRIP_PLANNING/TRIP_PLANNING_FLOW)", (r) => PLAN_ROUTES.has(r));

// ── 1. 意圖 A–I ──
const A = "我想去京都，推薦 10 個景點";
const B = "下個月要去大阪，推薦一些景點";
const C = "我想去京都探索冷門歷史文化景點，幫我推薦 10 個";
const C2 = "我想去京都探索比較冷門的歷史文化景點，幫我推薦 10 個。";
const D = "幫我安排京都三天行程";
const E = "我想去京都玩三天";
const F = "幫我規劃京都三天行程，順便推薦一些景點";

for (const [id, t] of [["A", A], ["B", B], ["C", C], ["C2", C2]]) {
  check(`${id}-arb`, `${t} → arbitration`, isReco, () => route(t));
  check(`${id}-mti`, `${t} → multilingualTravelIntent`, false, () => multilingualTravelIntent(t));
  check(`${id}-tpt`, `${t} → isTravelPlanningText`, false, () => isTravelPlanningText(t));
  check(`${id}-rci`, `${t} → resolveChatIntent`, pred("非 trip_planning", (r) => r !== "trip_planning"), () =>
    resolveChatIntent(t, baseSession()),
  );
  check(`${id}-mode`, `${t} → resolveConversationMode`, pred("非 destination_planning", (r) => r !== "destination_planning"), () =>
    resolveConversationMode(t, baseSession()),
  );
}
for (const [id, t] of [["D", D], ["E", E], ["F", F]]) {
  check(`${id}-arb`, `${t} → arbitration`, isPlan, () => route(t));
  check(`${id}-tpt`, `${t} → isTravelPlanningText`, true, () => isTravelPlanningText(t));
}

// G：先推薦大阪（activeRecommendationContext）再要求推薦京都
const osakaRecoSession = () =>
  baseSession({
    activeRecommendationContext: createActiveRecommendationContext({
      destinationName: "大阪",
      intent: "attraction",
      category: "attraction",
    }),
    activeCategoryIntent: "attraction",
    recommendationSession: { topic: "attraction", destination: "大阪" },
    travelContext: { destination: "大阪", interests: [] },
  });
for (const [id, t] of [
  ["G1", "那推薦京都的景點"],
  ["G2", "我想去京都，推薦 10 個景點"],
  ["G3", "推薦京都 5 個景點"],
]) {
  check(`${id}-arb`, `[大阪推薦中] ${t} → arbitration`, isReco, () => route(t, osakaRecoSession()));
  check(`${id}-dest`, `[大阪推薦中] ${t} → 解析目的地`, pred("含京都、不含大阪", (d) => typeof d === "string" && d.includes("京都") && !d.includes("大阪")), () =>
    parsePlaceRecommendationIntent(t, { hasActiveRecommendationContext: true, activePrimaryType: "attraction" })?.destinationName ?? null,
  );
}

// H：大阪規劃中（pendingQuestion ask_date_or_days）要求推薦京都
const osakaPlanningSession = () =>
  baseSession({
    conversationMode: "destination_planning",
    chatPlanningState: "waitingTripDays",
    pendingQuestion: { type: "ask_date_or_days", baseDestination: "大阪" },
    travelContext: { destination: "大阪", interests: [] },
    tripPlanningContext: { destination: "大阪", intent: "destination_planning", selectedPlaces: [] },
  });
for (const [id, t] of [
  ["H1", "推薦京都的景點"],
  ["H2", "我想去京都，推薦 10 個景點"],
]) {
  check(`${id}-arb`, `[大阪規劃 ask_date_or_days] ${t} → arbitration`, isReco, () => route(t, osakaPlanningSession()));
}

// I：進行中推薦 → 續推
for (const [id, t] of [["I1", "還有嗎"], ["I2", "再推薦一些"]]) {
  check(`${id}-arb`, `[大阪推薦中] ${t} → arbitration`, "MORE_RECOMMENDATIONS", () => route(t, osakaRecoSession()));
}

// ── 2. 數量契約 ──
const countCases = [
  [A, 10],
  [C2, 10],
  ["推薦五家餐廳", 5],
  ["推薦 1 個景點", 1],
  ["推薦３個景點", 3],
  ["推薦十個景點", 10],
  ["推薦十五個景點", 15], // 原始值；顯示截斷由 resolveRequestedDisplayBatchSize 負責
  ["推薦 20 個景點", 20],
  ["推薦一些景點", null],
  ["推薦京都景點", null],
  ["京都三天兩夜推薦景點", null],
  ["京都玩3天推薦景點", null],
  ["4個人去京都推薦景點", null],
  ["2 個大人 1 個小孩推薦景點", null],
  ["2個小時能逛的景點推薦", null],
  ["預算 3000 元推薦餐廳", null],
  ["一個人 500 元以內推薦餐廳", null],
  ["五星級飯店推薦", null],
  ["4 星以上餐廳推薦", null],
  ["第3個景點不要", null],
  ["這個景點不錯", null],
  ["每個景點停 2 小時", null],
  ["推薦 2026 個景點", null],
  // T15 契約變更（使用者授權）：parse 回傳原始值 100，顯示張數由下方 CNT-display 斷言為 10。
  ["推薦 100 個景點", 100],
  ["下午3點推薦咖啡廳", null],
  ["住兩晚推薦景點", null],
  ["推薦三間咖啡廳", 3],
];
for (const [t, exp] of countCases) {
  check(`CNT`, `parseRequestedRecommendationCount(${t})`, exp, () => parseCount(t));
}
// T15 契約變更：「推薦 100 個景點」最終顯示張數 = 10。
check("CNT-display", "顯示張數(推薦 100 個景點) === 10", 10, () =>
  resolveBatch(parseCount("推薦 100 個景點"), "attraction"),
);
check("CNT-intent", `parsePlaceRecommendationIntent(${A}).requestedCount`, 10, () =>
  parsePlaceRecommendationIntent(A)?.requestedCount ?? null,
);
check("CNT-intent-none", `parsePlaceRecommendationIntent(推薦京都景點).requestedCount`, null, () =>
  parsePlaceRecommendationIntent("推薦京都景點")?.requestedCount ?? null,
);
const destDefault = sessionMod.defaultRecommendationDisplayBatchSize?.("attraction");
const shopDefault = sessionMod.defaultRecommendationDisplayBatchSize?.("shopping");
check("BATCH-default-dest", "未指定 attraction → 3", 3, () => resolveBatch(null, "attraction"));
check("BATCH-default-dest-eq", "未指定 attraction == defaultRecommendationDisplayBatchSize", destDefault, () => resolveBatch(undefined, "attraction"));
check("BATCH-default-shop", `未指定 shopping → 現狀 (${shopDefault})`, shopDefault, () => resolveBatch(null, "shopping"));
check("BATCH-1", "1 → 1", 1, () => resolveBatch(1, "attraction"));
check("BATCH-7", "7 → 7", 7, () => resolveBatch(7, "restaurant"));
check("BATCH-10", "10 → 10", 10, () => resolveBatch(10, "attraction"));
check("BATCH-11", "11 → 10", 10, () => resolveBatch(11, "attraction"));
check("BATCH-99", "99 → 10", 10, () => resolveBatch(99, "shopping"));
check("BATCH-0", "0 → 預設 3", 3, () => resolveBatch(0, "attraction"));
check("BATCH-neg", "-2 → 預設 3", 3, () => resolveBatch(-2, "attraction"));
check("BATCH-nan", "NaN → 預設 3", 3, () => resolveBatch(Number.NaN, "attraction"));
check("BATCH-inf", "Infinity → 預設 3", 3, () => resolveBatch(Number.POSITIVE_INFINITY, "attraction"));
check("BATCH-float", "3.7 → 3", 3, () => resolveBatch(3.7, "attraction"));
// 未改動既有預設常數
check("BATCH-const", "DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE 仍為 3", 3, () => sessionMod.DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE);
check("BATCH-const-shop", "RECOMMENDATION_BATCH_SIZE 仍為 4", 4, () => sessionMod.RECOMMENDATION_BATCH_SIZE);

// ── 3. 解析 ──
const parsedC2 = () => parsePlaceRecommendationIntent(C2);
check("P-dest", `${C2} → destinationName`, "京都", () => parsedC2()?.destinationName ?? null);
check("P-style", `${C2} → primaryType`, pred("attraction 或 culture 類", (v) => /attraction|culture|museum|historic/.test(String(v))), () => parsedC2()?.primaryType ?? null);
check("P-culture", `${C2} → 文化/歷史 subtypes`, pred("subtypes/style 含 culture/history", (v) => /cultur|histor|temple|shrine/i.test(String(v))), () =>
  JSON.stringify({ s: parsedC2()?.subtypes, pf: parsedC2()?.preferredFeatures, at: parsedC2()?.atmosphere }),
);
check("P-pop", `${C2} → popularityPreference`, "hidden_gem", () => parsedC2()?.popularityPreference ?? null);
check("P-count", `${C2} → requestedCount`, 10, () => parsedC2()?.requestedCount ?? null);
const BAD_DEST = /京都(?:冷門|冷门|比較|比较|探索|歷史|幫我|帮我|推薦|的)/;
for (const t of [C, C2, A, "京都冷門歷史文化景點推薦", "京都，幫我推薦 10 個景點", "京都幫我推薦景點"]) {
  check("P-noBad-intent", `${t} → intent.destinationName 無描述詞尾`, pred("不含 京都+描述/請求詞", (d) => !BAD_DEST.test(String(d ?? ""))), () =>
    parsePlaceRecommendationIntent(t)?.destinationName ?? null,
  );
  check("P-noBad-scope", `${t} → resolveDestinationAreaScope`, pred("null 或 area 不含描述/請求詞", (s) => {
    if (s === null) return true;
    const o = JSON.parse(s);
    return !BAD_DEST.test(String(o?.displayLabel ?? "")) && !/冷門|歷史|文化|幫我|推薦|比較|探索/.test(String(o?.area ?? ""));
  }), () => JSON.stringify(resolveDestinationAreaScope(t)));
}

// 其他城市／區域：intent destinationName 與 resolveDestinationAreaScope 不得改變（以固定期望值鎖定）
// 期望值取自基準 aa2db59 的實際輸出（修改前後必須一致）。
const regionCases = [
  // [text, scope displayLabel|null, intent.destinationName|null]
  ["東京澀谷有什麼景點推薦", "東京澀谷", "東京澀谷"],
  ["大阪難波有什麼好吃的推薦", "大阪難波", "大阪難波"],
  ["首爾明洞推薦景點", "首爾明洞", "首爾明洞"],
  ["台北信義推薦咖啡廳", "台北信義", "台北信義"],
  ["台南安平有什麼景點", "台南安平", "台南安平"],
  ["京都嵐山推薦景點", "京都嵐山", "京都嵐山"],
  ["北海道推薦景點", null, "北海道"],
  ["新北淡水推薦咖啡廳", "新北淡水", "新北淡水"],
  ["台南安平老街有什麼好吃", "台南安平", "台南安平"],
  ["京都嵐山冷門景點推薦", "京都嵐山", "京都嵐山"],
];
for (const [t, expScope, expDest] of regionCases) {
  check("R-scope", `resolveDestinationAreaScope(${t}).displayLabel`, expScope, () => resolveDestinationAreaScope(t)?.displayLabel ?? null);
  check("R-dest", `intent.destinationName(${t})`, expDest, () => parsePlaceRecommendationIntent(t)?.destinationName ?? null);
}
// 含描述詞字樣（文化／藝術／之…）的真實地名：區域尾段不得被剝除（基準值）。
for (const [t, expScope] of [
  ["台中審計新村推薦", "台中審計新村"],
  ["京都哲學之道推薦", "京都哲學之道"],
  ["台南孔廟文化園區推薦", "台南孔廟文化園區"],
  ["台北華山文創推薦", "台北華山文創"],
  ["首爾北村韓屋村推薦", "首爾北村韓屋村"],
  ["沖繩美麗海推薦", "沖繩美麗海"],
  ["京都伏見稻荷推薦", "京都伏見稻荷"],
  ["台東知本溫泉推薦", "台東知本溫泉"],
  ["宜蘭傳藝推薦", "宜蘭傳藝"],
  ["高雄美濃推薦", "高雄美濃"],
  ["大阪心齋橋推薦", "大阪心齋橋"],
  ["台北的大稻埕推薦", "台北大稻埕"],
  ["高雄駁二藝術特區推薦", "高雄駁二"],
  ["台中東海藝術街推薦", "台中東海"],
  ["台北士林夜市推薦", "台北士林"],
  ["北京故宮推薦", "北京故宮"],
]) {
  check("R-real", `resolveDestinationAreaScope(${t}).displayLabel`, expScope, () => resolveDestinationAreaScope(t)?.displayLabel ?? null);
}
// 修正目標：「城市＋描述詞／請求詞」不得成為區域（基準會產生 台北文化／東京親子／京都在地／台北大安請／新北板橋的）。
for (const [t, expDest] of [
  ["推薦新北板橋的餐廳", "新北板橋"],
  ["新北板橋推薦餐廳", "新北板橋"],
  ["台北文化推薦景點", "台北"],
  ["東京親子景點推薦", "東京"],
  ["京都在地美食推薦", "京都"],
  ["台北特色咖啡廳推薦", "台北"],
  ["台北大安，請推薦咖啡廳", "台北大安"],
]) {
  check("R-fix", `intent.destinationName(${t})`, expDest, () => parsePlaceRecommendationIntent(t)?.destinationName ?? null);
}

// verify-destination-area-tail-authority.mjs 在兩邊都逾時（>180s）；其第 10–19 行為純函式斷言，
// 直接覆蓋本次修改的 areaTailAfterParent，故在此逐字鏡像以免失去覆蓋。
{
  const { resolveDestinationFromText } = await import("../src/lib/ai/trip-planning-context.ts");
  const { extractGenericDestinationAreaCandidate } = await import("../src/lib/ai/destination-travel-profile.ts");
  const dest = (t) => resolveDestinationAreaScope(t)?.displayLabel ?? resolveDestinationFromText(t);
  const tailFixtures = [
    ["香港天氣怎麼樣", "香港"], ["11月香港天氣怎麼樣", "香港"], ["香港11月天氣如何", "香港"], ["香港最近會下雨嗎", "香港"],
    ["東京新宿天氣怎麼樣", "東京新宿"], ["首爾弘大11月天氣", "首爾弘大"], ["大阪梅田適合住嗎", "大阪梅田"],
    ["京都祇園想找安靜咖啡廳", "京都祇園"], ["台北信義區今天想逛街", "台北信義區"],
    ["香港天气怎么样", "香港"], ["香港会下雨吗", "香港"], ["大阪梅田天气如何", "大阪梅田"], ["屏東恆春天氣如何", "屏東恆春"],
    ["香港", "香港"], ["東京", "東京"], ["首爾", "首爾"],
  ];
  for (const [t, exp] of tailFixtures) check("TAIL", `area-tail mirror: ${t}`, exp, () => dest(t));
  for (const suffix of ["怎麼樣", "如何", "好玩嗎", "適合嗎", "值得去嗎", "有什麼推薦", "想去哪裡", "想吃什麼", "天氣", "會下雨嗎", "冷不冷", "熱不熱"]) {
    // 「香港想去哪裡」→「哪裡」在基準 aa2db59 即失敗（既有問題，非本次 regression），
    // 移至 verify-recommendation-intent-quantity-hotfix-risks.mjs 的 PRE 案例追蹤。
    if (suffix !== "想去哪裡") check("TAIL", `area-tail mirror: 香港${suffix}`, "香港", () => dest("香港" + suffix));
    check("TAIL", `area-tail mirror: extractGeneric(香港${suffix})`, null, () => extractGenericDestinationAreaCandidate("香港" + suffix));
    check("TAIL", `area-tail mirror: 大阪梅田${suffix}`, "大阪梅田", () => dest("大阪梅田" + suffix));
  }
}

// ── 4. fetch trap ──
check("FETCH", "provider fetch 呼叫次數", 0, () => fetchCalls);
check("FETCH-intact", "globalThis.fetch 仍為 trap（未被替換）", true, () => globalThis.fetch === fetchTrap);

console.info = origInfo;
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}\t${r.id}\t${r.label}\texpected=${r.expected}\tactual=${r.actual}`);
}
console.log(`\nverify-recommendation-intent-quantity-hotfix: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
console.log("verify-recommendation-intent-quantity-hotfix: ok");
