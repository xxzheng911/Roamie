#!/usr/bin/env node
/**
 * T13 審查發現 — Recommendation Intent & Quantity Hotfix 的已知風險（預期在目前實作 FAIL）。
 *
 * 執行：npx vite-node scripts/verify-recommendation-intent-quantity-hotfix-risks.mjs --config scripts/vite.verify.config.mjs
 *
 * R1 路由分裂：isPlaceRecommendationAskWithoutItinerary 命中（地方／小吃…），但
 *    hasExplicitPlaceRecommendationIntent 不成立 → arbitration 落到 GENERAL_CHAT，
 *    同時 isTravelPlanningText／resolveChatIntent／resolveConversationMode 仍判為規劃。
 *    基準 aa2db59 這些輸入一致為 NEW_TRIP_PLANNING。
 * R2 數量誤判：時間（「2個多小時」「2個週末」）被當成數量；「推薦5個人氣景點」被漏判。
 */
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("[fetch-trap] provider call blocked");
};
console.info = () => {};

const { resolveChatIntentArbitration } = await import("../src/lib/ai/recommendation-refinement/index.ts");
const { isTravelPlanningText } = await import("../src/lib/ai/chat-intent-router.ts");
const { resolveChatIntent } = await import("../src/lib/ai/chat-dining-flow.ts");
const { parseRequestedRecommendationCount } = await import("../src/lib/ai/requested-recommendation-count.ts");

const session = () => ({ recommendedPlaces: [], selectedPlaces: [], phase: "discover", discovery: {}, updatedAt: "x" });
const results = [];
const check = (id, label, ok, actual) => results.push({ id, label, ok, actual });

// R1：arbitration 與其他分類器必須一致 — 不得一邊 GENERAL_CHAT、一邊仍判規劃。
for (const t of [
  "我想去台南，有什麼小吃推薦",
  "我想去日本，推薦一些地方",
  "我想去日本，有哪些地方推薦",
  "下個月想去日本，有什麼地方推薦",
  "我想去京都，推薦住哪個地方",
]) {
  const routeName = resolveChatIntentArbitration(t, session()).route;
  const tpt = isTravelPlanningText(t);
  const rci = resolveChatIntent(t, session());
  check(
    "R1",
    `${t}：arbitration 不得為 GENERAL_CHAT（基準 NEW_TRIP_PLANNING）`,
    routeName !== "GENERAL_CHAT",
    `route=${routeName} isTravelPlanningText=${tpt} resolveChatIntent=${rci}`,
  );
}

// R2：數量契約 — 時間不得誤判；「N個人氣景點」是數量。
for (const [t, exp] of [
  ["2個多小時能逛完的景點推薦", null],
  ["2個週末推薦景點", null],
  ["推薦5個人氣景點", 5],
]) {
  const actual = parseRequestedRecommendationCount(t);
  check("R2", `parseRequestedRecommendationCount(${t}) === ${exp}`, actual === exp, `actual=${actual}`);
}

// PRE（既有，非本次 regression）：verify-destination-area-tail-authority.mjs 第 14 行的斷言
// 「香港想去哪裡」應為 香港；該腳本在主工作區與基準都逾時，故從未真正跑到此斷言。基準同樣得到「哪裡」。
{
  const { resolveDestinationAreaScope } = await import("../src/lib/ai/destination-travel-profile.ts");
  const { resolveDestinationFromText } = await import("../src/lib/ai/trip-planning-context.ts");
  const t = "香港想去哪裡";
  const actual = resolveDestinationAreaScope(t)?.displayLabel ?? resolveDestinationFromText(t);
  check("PRE", `${t} → 香港（基準亦失敗）`, actual === "香港", `actual=${actual}`);
}

check("FETCH", "provider fetch 呼叫次數 = 0", fetchCalls === 0, `fetchCalls=${fetchCalls}`);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}\t${r.id}\t${r.label}\t${r.actual}`);
console.log(`\nverify-recommendation-intent-quantity-hotfix-risks: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
console.log("verify-recommendation-intent-quantity-hotfix-risks: ok");
