#!/usr/bin/env node
/**
 * T15 — Recommendation Intent & Quantity Hotfix 最終獨立驗收（lib 層）。
 *
 * 執行：npx vite-node scripts/verify-recommendation-intent-quantity-final.mjs --config scripts/vite.verify.config.mjs
 *
 * 1. 目的地＋偏好：「我想去大阪探索在地美食，推薦 5 家」→ 大阪／美食類／localPreference／5／推薦路由。
 * 2. 數量顯示：「推薦 12 家」「推薦 100 個」→ 顯示 10；房間數 → null；範圍取上限。
 * 3. 合法目的地（澀谷／北海道／安平／難波／嵐山）的 destinationName 與 area scope 必須與基準 aa2db59 相同。
 * 4. 「台中逢甲夜市」：記錄與基準的差異（基準「台中逢甲夜市」→ 修正後「台中逢甲」）。
 * 5. fetch trap = 0；新增模組不得 import 任何 provider／網路模組（靜態檢查）。
 *
 * 失敗不中斷：逐案紀錄，最後印出結果並以非 0 exit code 結束。
 */
let fetchCalls = 0;
const fetchTrap = async (...args) => {
  fetchCalls += 1;
  throw new Error(`[fetch-trap] provider call blocked: ${String(args[0]).slice(0, 120)}`);
};
globalThis.fetch = fetchTrap;

const origInfo = console.info;
console.info = () => {};

const { readFileSync } = await import("node:fs");
const { resolveChatIntentArbitration } =
  await import("../src/lib/ai/recommendation-refinement/index.ts");
const { createActiveRecommendationContext } =
  await import("../src/lib/ai/recommendation-refinement/merge.ts");
const { parsePlaceRecommendationIntent } =
  await import("../src/lib/ai/place-recommendation-intent/index.ts");
const { resolveDestinationAreaScope } = await import("../src/lib/ai/destination-travel-profile.ts");
const { resolveDestinationFromText, resolveConversationMode } =
  await import("../src/lib/ai/trip-planning-context.ts");
const { isTravelPlanningText } = await import("../src/lib/ai/chat-intent-router.ts");
const { resolveChatIntent } = await import("../src/lib/ai/chat-dining-flow.ts");
const sessionMod = await import("../src/lib/ai/conversation-recommendation-session.ts");
let countMod = null;
try {
  countMod = await import("../src/lib/ai/requested-recommendation-count.ts");
} catch {
  countMod = null;
}

const results = [];
function check(id, label, ok, actual) {
  results.push({ id, label, ok: Boolean(ok), actual: String(actual) });
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
const safe = (fn) => {
  try {
    return fn();
  } catch (e) {
    return `THROW:${e?.message ?? e}`;
  }
};
const classify = (t, s = session()) => ({
  route: safe(() => resolveChatIntentArbitration(t, s).route),
  tpt: safe(() => isTravelPlanningText(t)),
  rci: safe(() => resolveChatIntent(t, s)),
  mode: safe(() => resolveConversationMode(t, s)),
});
const fmt = (r) => `route=${r.route} tpt=${r.tpt} rci=${r.rci} mode=${r.mode}`;
const parseCount = (t) =>
  countMod?.parseRequestedRecommendationCount
    ? countMod.parseRequestedRecommendationCount(t)
    : "MODULE_MISSING";
const display = (t, topic = "attraction") =>
  typeof sessionMod.resolveRequestedDisplayBatchSize === "function"
    ? sessionMod.resolveRequestedDisplayBatchSize(
        countMod?.parseRequestedRecommendationCount?.(t) ?? null,
        topic,
      )
    : "MISSING";
const scopeSig = (t) => {
  const s = safe(() => resolveDestinationAreaScope(t));
  return s && typeof s === "object" ? `${s.displayLabel}|${s.parentCity}|${s.area}|${s.searchScope}` : String(s);
};
const destSig = (t) => String(safe(() => parsePlaceRecommendationIntent(t)?.destinationName ?? null));
const fromTextSig = (t) => String(safe(() => resolveDestinationFromText(t) ?? null));

// ── 1. 大阪在地美食 ──
{
  const t = "我想去大阪探索在地美食，推薦 5 家";
  const p = parsePlaceRecommendationIntent(t);
  const r = classify(t);
  check("OSAKA-dest", `${t} → destinationName === 大阪`, p?.destinationName === "大阪", `actual=${p?.destinationName}`);
  check("OSAKA-type", `${t} → primaryType === restaurant（美食）`, p?.primaryType === "restaurant", `actual=${p?.primaryType}`);
  check("OSAKA-local", `${t} → localPreference === true`, p?.localPreference === true, `actual=${p?.localPreference}`);
  check("OSAKA-count", `${t} → requestedCount === 5`, p?.requestedCount === 5, `actual=${p?.requestedCount}`);
  check("OSAKA-display", `${t} → 顯示張數 === 5`, display(t, "restaurant") === 5, `actual=${display(t, "restaurant")}`);
  check("OSAKA-route", `${t} → 推薦路由`, RECO.has(r.route), fmt(r));
  check("OSAKA-tpt", `${t} → isTravelPlanningText === false`, r.tpt === false, fmt(r));
  check("OSAKA-rci", `${t} → resolveChatIntent 非 trip_planning`, r.rci !== "trip_planning", fmt(r));
  check("OSAKA-mode", `${t} → 非 destination_planning`, r.mode !== "destination_planning", fmt(r));
}
// localPreference：無在地字眼不得設定；「當地」「道地」也算。
for (const [t, exp] of [
  ["推薦大阪美食", undefined],
  ["推薦京都景點", undefined],
  ["推薦大阪當地美食", true],
  ["大阪有什麼道地美食推薦", true],
]) {
  const v = parsePlaceRecommendationIntent(t)?.localPreference;
  check("LOCAL", `${t} → localPreference === ${exp}`, v === exp, `actual=${v}`);
}
// 京都冷門歷史文化
{
  const t = "我想去京都探索比較冷門的歷史文化景點，幫我推薦 10 個。";
  const p = parsePlaceRecommendationIntent(t);
  const r = classify(t);
  const cultureBlob = JSON.stringify({ s: p?.subtypes, pf: p?.preferredFeatures, at: p?.atmosphere });
  check("KYOTO-dest", `${t} → 京都`, p?.destinationName === "京都", `actual=${p?.destinationName}`);
  check("KYOTO-culture", `${t} → culture／history 訊號`, /cultur|histor|temple|shrine/i.test(cultureBlob), cultureBlob);
  check("KYOTO-pop", `${t} → hidden_gem`, p?.popularityPreference === "hidden_gem", `actual=${p?.popularityPreference}`);
  check("KYOTO-count", `${t} → 10`, p?.requestedCount === 10, `actual=${p?.requestedCount}`);
  check("KYOTO-display", `${t} → 顯示 10`, display(t) === 10, `actual=${display(t)}`);
  check("KYOTO-route", `${t} → 推薦路由`, RECO.has(r.route), fmt(r));
}
// 不得出現的目的地（intent／scope／resolveDestinationFromText 都檢查）
const BAD = /大阪探索|在地美食|京都冷門|京都比較|京都探索|冷門歷史|歷史文化|京都幫我|京都帮我|京都請|京都麻煩/;
for (const t of [
  "我想去大阪探索在地美食，推薦 5 家",
  "大阪探索在地美食，推薦 5 家",
  "我想去京都探索冷門歷史文化景點，幫我推薦 10 個",
  "我想去京都探索比較冷門的歷史文化景點，幫我推薦 10 個。",
  "京都冷門歷史文化景點推薦",
  "京都，幫我推薦 10 個景點",
  "京都幫我推薦景點",
  "京都請推薦景點",
]) {
  const sigs = [destSig(t), scopeSig(t), fromTextSig(t)];
  check("NO-BAD", `${t} → 不得產生描述詞／請求詞目的地`, !sigs.some((x) => BAD.test(x)), sigs.join(" ; "));
}

// ── 2. 數量 ──
for (const [t, expParse, expShown] of [
  ["推薦 12 家餐廳", 12, 10],
  ["推薦 100 個景點", 100, 10],
  ["推薦 10 個景點", 10, 10],
  ["推薦 1 個景點", 1, 1],
  ["推薦京都景點", null, 3],
  ["推薦 3-5 個景點", 5, 5],
  ["推薦三到五個景點", 5, 5],
  ["3 到 5 個景點推薦", 5, 5],
  ["推薦 3 ~ 5 個景點", 5, 5],
  ["訂兩間房", null, 3],
  ["訂兩間房，推薦飯店", null, 3],
  ["2 間房推薦飯店", null, 3],
  ["要兩間房推薦飯店", null, 3],
  ["京都三天兩夜推薦景點", null, 3],
  ["4個人去京都推薦景點", null, 3],
  ["預算 3000 元推薦餐廳", null, 3],
  ["五星級飯店推薦", null, 3],
  ["下午3點推薦咖啡廳", null, 3],
  ["12月推薦景點", null, 3],
  ["推薦 10 月的景點", null, 3],
]) {
  const n = parseCount(t);
  const shown = display(t);
  check("CNT", `parse(${t}) === ${expParse}`, n === expParse, `actual=${n}`);
  check("SHOWN", `顯示張數(${t}) === ${expShown}`, shown === expShown, `actual=${shown}`);
}
check(
  "SHOWN-shop",
  "未指定 shopping → 維持現狀 defaultRecommendationDisplayBatchSize(shopping)",
  sessionMod.resolveRequestedDisplayBatchSize?.(null, "shopping") ===
    sessionMod.defaultRecommendationDisplayBatchSize?.("shopping"),
  `actual=${sessionMod.resolveRequestedDisplayBatchSize?.(null, "shopping")}`,
);

// ── 3. 合法目的地與 area scope：與基準 aa2db59 實跑值一致 ──
// 欄位：[text, scopeSig, 基準 intent.destinationName, resolveDestinationFromText, 基準 route, 修正後預期 dest, 修正後預期 route]
// 「我想去X，推薦…」在基準走 NEW_TRIP_PLANNING 且 intent 為 null；依新契約改走推薦，dest 必須等於 scope／城市（不得多出描述詞）。
const SAME = Symbol("same-as-base");
const R = "NEW_RECOMMENDATION";
const P = "NEW_TRIP_PLANNING";
const BASELINE = [
  ["東京澀谷有什麼景點推薦", "東京澀谷|東京|澀谷|area", "東京澀谷", "東京", R, SAME, SAME],
  ["我想去東京澀谷，推薦咖啡廳", "東京澀谷|東京|澀谷|area", "null", "東京", P, "東京澀谷", R],
  ["澀谷推薦景點", "null", "null", "null", R, SAME, SAME],
  ["北海道推薦景點", "null", "北海道", "北海道", R, SAME, SAME],
  ["我想去北海道，推薦景點", "null", "null", "北海道", P, "北海道", R],
  ["北海道有什麼美食推薦", "null", "北海道", "北海道", R, SAME, SAME],
  ["台南安平有什麼景點", "台南安平|台南|安平|area", "台南安平", "台南", R, SAME, SAME],
  ["台南安平老街推薦小吃", "台南安平|台南|安平|area", "null", "台南", "GENERAL_CHAT", SAME, SAME],
  ["安平推薦景點", "null", "null", "null", R, SAME, SAME],
  ["大阪難波有什麼好吃的推薦", "大阪難波|大阪|難波|area", "大阪難波", "大阪", R, SAME, SAME],
  ["我想去大阪難波，推薦餐廳", "大阪難波|大阪|難波|area", "null", "大阪", P, "大阪難波", R],
  ["難波推薦餐廳", "null", "null", "null", R, SAME, SAME],
  ["京都嵐山推薦景點", "京都嵐山|京都|嵐山|area", "京都嵐山", "京都", R, SAME, SAME],
  ["京都嵐山冷門景點推薦", "京都嵐山|京都|嵐山|area", "京都嵐山", "京都", R, SAME, SAME],
  ["我想去京都嵐山，推薦景點", "京都嵐山|京都|嵐山|area", "null", "京都", P, "京都嵐山", R],
  ["嵐山推薦景點", "null", "null", "null", R, SAME, SAME],
  // 逢甲：backend 宣稱「逢甲夜市 → 逢甲」為行為變更；基準實跑已是「台中逢甲」，兩邊完全相同。
  ["我想去台中逢甲夜市", "台中逢甲|台中|逢甲|area", "null", "台中逢甲夜", P, SAME, SAME],
  ["台中逢甲夜市推薦", "台中逢甲|台中|逢甲|area", "null", "台中", R, SAME, SAME],
];
for (const [t, expScope, baseDest, expFrom, baseRoute, newDest, newRoute] of BASELINE) {
  const expDest = newDest === SAME ? baseDest : newDest;
  const expRoute = newRoute === SAME ? baseRoute : newRoute;
  const route = classify(t).route;
  const tag = newDest === SAME ? "與基準一致" : `基準 ${baseDest} → 新契約 ${expDest}`;
  check("BASE-scope", `scope(${t}) 與基準一致`, scopeSig(t) === expScope, `actual=${scopeSig(t)} base=${expScope}`);
  check("BASE-from", `resolveDestinationFromText(${t}) 與基準一致`, fromTextSig(t) === expFrom, `actual=${fromTextSig(t)} base=${expFrom}`);
  check("BASE-dest", `intent.destinationName(${t}) ${tag}`, destSig(t) === expDest, `actual=${destSig(t)}`);
  check("BASE-route", `route(${t}) ${newRoute === SAME ? "與基準一致" : `基準 ${baseRoute} → ${expRoute}`}`, route === expRoute, `actual=${route}`);
}

// ── 4. 審查發現（預期在目前實作 FAIL）──
// RISK-1：「我想去X＋活動，推薦…」因本次修正改走推薦路由（基準走規劃、intent 為 null），
// 但 areaTailAfterParent 只剝除描述詞，活動詞（看楓葉／賞櫻／滑雪／吃）被當成區域，
// 產生「京都看楓葉」「北海道滑雪」「大阪吃」這類目的地與 area scope — 與契約
// 「不得出現『京都冷門歷史文化』之類的目的地」同類。
for (const [t, city] of [
  ["我想去京都看楓葉，推薦景點", "京都"],
  ["我想去京都賞櫻，推薦景點", "京都"],
  ["我想去北海道滑雪，推薦景點", "北海道"],
  ["我想去大阪吃美食，推薦餐廳", "大阪"],
  ["我想去台南吃小吃，推薦餐廳", "台南"],
  ["我想去沖繩潛水，推薦景點", "沖繩"],
]) {
  const route = classify(t).route;
  const d = destSig(t);
  check(
    "RISK-1",
    `${t}：推薦路由時 destinationName 必須為 ${city}（不得併入活動詞）`,
    !RECO.has(route) || d === city,
    `route=${route} dest=${d} scope=${scopeSig(t)}`,
  );
}
// RISK-2：中文百位數「推薦一百個景點」解析為 null → 顯示 3，違反「超過 10 → 最多 10」。
check("RISK-2", "顯示張數(推薦一百個景點) === 10", display("推薦一百個景點") === 10, `parse=${parseCount("推薦一百個景點")} shown=${display("推薦一百個景點")}`);

// 命令列額外文字只做 DUMP、不計分（供與基準逐句比對）。
const extraTexts = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith(".mjs"));
for (const t of extraTexts) {
  console.log(`DUMP\t${t}\tscope=${scopeSig(t)}\tdest=${destSig(t)}\tfrom=${fromTextSig(t)}\t${fmt(classify(t))}`);
}

// ── 5. fetch trap 與靜態 import 檢查 ──
{
  const read = (f) => safe(() => readFileSync(new URL(f, import.meta.url), "utf8"));
  const src = read("../src/lib/ai/requested-recommendation-count.ts");
  check(
    "STATIC-count-imports",
    "requested-recommendation-count.ts 存在且無任何 import",
    !src.startsWith("THROW:") && !/^\s*import\s/m.test(src),
    src.startsWith("THROW:") ? src : "",
  );
  for (const f of [
    "../src/lib/ai/requested-recommendation-count.ts",
    "../src/lib/ai/travel-language-signals.ts",
  ]) {
    const s = read(f);
    check(
      "STATIC-no-network",
      `${f.replace("../", "")} 無 fetch／supabase／invoke／provider 呼叫`,
      !/\bfetch\s*\(|supabase|\.invoke\s*\(|functions\.|googleapis|places\.googleapis/i.test(s),
      "",
    );
  }
}
check("FETCH", "provider fetch 呼叫次數 = 0", fetchCalls === 0, `fetchCalls=${fetchCalls}`);
check("FETCH-intact", "globalThis.fetch 仍為 trap", globalThis.fetch === fetchTrap, "");

console.info = origInfo;
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}\t${r.id}\t${r.label}\t${r.actual}`);
console.log(
  `\nverify-recommendation-intent-quantity-final: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`,
);
if (failed.length) process.exit(1);
console.log("verify-recommendation-intent-quantity-final: ok");
