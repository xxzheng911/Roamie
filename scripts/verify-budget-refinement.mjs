import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import {
  buildBudgetRefinementSummary,
  isBudgetRefinementText,
  parseBudgetPreferenceFromText,
  refineRecommendationItemsForBudget,
} from "../src/lib/ai/budget-refinement.ts";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const budgetText = "想找便宜一點";
assert(isBudgetRefinementText(budgetText), "detect budget refinement text");
assert(parseBudgetPreferenceFromText(budgetText) === "low", "parse low budget preference");
assert(detectChatIntent(budgetText) === "refine_recommendations", "intent is refine_recommendations");
assert(detectChatIntent(budgetText) !== "mood_chat", "cheap request is not mood_chat");

const moodSession = {
  ...createEmptySession(),
  fromMoodFlow: true,
  mood: "深夜散步",
  activeChatIntent: "attraction",
  phase: "followup",
  recommendedPlaces: [
    { name: "某某酒吧", type: "酒吧", address: "台北市", estimatedTime: "1h", description: "", googlePlaceId: "a1", rating: 4.2 },
    { name: "河濱公園", type: "公園", address: "台北市", estimatedTime: "1h", description: "", googlePlaceId: "a2", rating: 4.5 },
    { name: "精品百貨", type: "shopping mall", address: "台北市", estimatedTime: "1h", description: "", googlePlaceId: "a3", rating: 4.1 },
    { name: "夜市", type: "夜市", address: "台北市", estimatedTime: "1h", description: "", googlePlaceId: "a4", rating: 4.6 },
  ],
};

assert(resolveChatIntent(budgetText, moodSession) === "refine_recommendations", "resolve refine intent in mood session");

const merged = mergeTravelContext(moodSession, budgetText);
assert(merged.context.budgetPreference === "low", "context budgetPreference is low");
assert(merged.context.priceSensitivity === true, "context priceSensitivity is true");
assert(merged.context.tripPurpose === "refine_recommendations", "tripPurpose is refine_recommendations");
assert(merged.context.mood === "深夜散步", "mood context preserved");

const refined = refineRecommendationItemsForBudget(moodSession.recommendedPlaces, "low");
assert(refined[0]?.name === "河濱公園" || refined[0]?.name === "夜市", "budget refine prioritizes low-cost places");
assert(!refined.slice(0, 2).some((p) => p.name === "某某酒吧"), "expensive bar deprioritized");

const summary = buildBudgetRefinementSummary(merged.context, refined);
assert(summary.includes("省預算"), "summary mentions budget sensitivity");
assert(summary.includes("免費"), "summary mentions free options");

const displaySession = {
  ...moodSession,
  travelContext: merged.context,
};
const displayed = recommendationsForChatDisplay(displaySession, budgetText, refined);
assert(refined.length > 0, "budget refinement still has place candidates");
assert(!refined[0]?.name.includes("酒吧"), "refined cards avoid expensive bar first");

for (const phrase of ["省錢", "預算低", "免費", "平價", "CP值高", "不要太貴"]) {
  assert(isBudgetRefinementText(phrase), `detect budget phrase: ${phrase}`);
}

if (failed > 0) {
  process.exit(1);
}

console.log("\nAll budget refinement checks passed.");
