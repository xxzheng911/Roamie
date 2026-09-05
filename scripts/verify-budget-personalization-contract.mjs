import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  budgetModeToPlannerTier,
  parseExplicitBudgetConstraint,
  resolveBudgetContext,
} from "../src/lib/budget-context.ts";
import {
  buildBudgetRefinementSummary,
  refineRecommendationItemsForBudget,
} from "../src/lib/ai/budget-refinement.ts";
import { buildContextBlock, classifyPersonalizationRelevance } from "../src/lib/ai/context.ts";
import {
  buildPersonalizationContextV1,
  profilePreferenceLayer,
} from "../src/lib/personalization/resolve-effective-preference.ts";

const tripWins = resolveBudgetContext({ spendingPreference: "luxury", tripMode: "budget" });
assert.equal(tripWins.effectiveMode, "budget");
assert.equal(tripWins.source, "trip");

const mealUnlimited = parseExplicitBudgetConstraint("晚餐預算不限");
assert.deepEqual(mealUnlimited, { unrestricted: true, scope: "meal" });
assert.equal(
  resolveBudgetContext({
    spendingPreference: "luxury",
    tripMode: "budget",
    explicit: mealUnlimited,
    requestScope: "meal",
  }).unrestricted,
  true,
);
assert.equal(
  resolveBudgetContext({
    spendingPreference: "luxury",
    tripMode: "budget",
    explicit: mealUnlimited,
    requestScope: "trip",
  }).effectiveMode,
  "budget",
);

assert.equal(budgetModeToPlannerTier("budget"), "low");
assert.equal(budgetModeToPlannerTier("standard"), "medium");
assert.equal(budgetModeToPlannerTier("quality"), "medium");
assert.equal(budgetModeToPlannerTier("luxury"), "high");

const candidates = [
  { name: "Fine Dining Restaurant", type: "restaurant" },
  { name: "Neighborhood Park", type: "park" },
];
const reranked = refineRecommendationItemsForBudget(candidates, "low");
assert.equal(
  reranked.length,
  candidates.length,
  "category heuristic must not hard-exclude candidates",
);
assert.equal(reranked[0].name, "Neighborhood Park");

const budgetSummary = buildBudgetRefinementSummary({ interests: [] }, candidates);
for (const unsupported of ["免費景點", "平價咖啡", "價格合理", "高 CP", "NT$"]) {
  assert.equal(
    budgetSummary.includes(unsupported),
    false,
    `unsupported price wording: ${unsupported}`,
  );
}

const partialProfile = {
  profileTier: "plus",
  onboarded: false,
  pace: "slow",
};
assert.deepEqual(profilePreferenceLayer(partialProfile), {
  interests: undefined,
  pace: "slow",
  vibe: undefined,
  avoid: undefined,
  travelStyle: undefined,
  budgetMode: undefined,
});
const lively = buildPersonalizationContextV1({
  surface: "chatNearby",
  profile: { ...partialProfile, vibe: "quiet" },
  explicitCurrentRequest: { vibe: "lively", categoryInclude: ["bar"] },
});
assert.equal(lively.resolvedPreference.vibe, "lively");
assert.equal(lively.resolvedPreference.sources.vibe, "explicit");

const prefs = { onboarded: true, pace: "slow", vibe: "quiet", budgetMode: "luxury" };
const factual = {
  mode: "chat",
  chatInput: "東京鐵塔幾點關門",
  preferences: prefs,
  planTier: "plus",
};
assert.equal(classifyPersonalizationRelevance(factual), "factual");
assert.equal(buildContextBlock(factual).includes("步調："), false);
assert.equal(buildContextBlock(factual).includes("長期記憶（Plus）"), false);
const recommend = { ...factual, chatInput: "附近有什麼咖啡廳推薦" };
assert.equal(classifyPersonalizationRelevance(recommend), "recommendation");
assert.equal(buildContextBlock(recommend).includes("步調："), true);

const planSource = await readFile(new URL("../src/routes/_app.plan.tsx", import.meta.url), "utf8");
assert.equal(
  /savePreferences\(\{\s*\.\.\.prefs,\s*budgetMode/.test(planSource),
  false,
  "Plan submit must not persist trip budget into long-term preferences",
);
assert.equal(
  /source:\s*["']planning_selection_handoff["']/.test(planSource),
  false,
  "Plan handoff must not sync trip budget into the Plus profile",
);

console.log("budget/personalization contract verification passed");
