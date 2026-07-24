import { createEmptySession } from "../src/lib/chat-session.ts";
import {
  ensureSessionPendingQuestion,
  recoverPendingFromAssistantReply,
} from "../src/lib/ai/chat-conversation-state.ts";
import {
  applyDestinationPendingSelection,
  pendingQuestionForCountryRegionChoice,
} from "../src/lib/ai/destination-pending-question.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const countryContext = {
  interests: [],
  destination: "法國",
  destinationCountry: "法國",
  destinationType: "country",
  tripPurpose: "destination_selection",
};
const options = ["巴黎", "普羅旺斯", "蔚藍海岸"];
const bulletReply = `可以先從這幾個城市／地區考慮：

• 巴黎：博物館、經典地標與城市散策
• 普羅旺斯：小鎮、花季與田園氣氛
• 蔚藍海岸：海岸、度假與陽光節奏

你比較想去哪個城市或地區？`;

function sessionWithPending() {
  return {
    ...createEmptySession(),
    travelContext: countryContext,
    pendingQuestion: pendingQuestionForCountryRegionChoice("法國", options),
  };
}

function assertSelection(userText, expected, message) {
  const applied = applyDestinationPendingSelection(userText, sessionWithPending());
  assert(applied.selectedOption === expected, `${message}: selected=${expected}`);
  assert(applied.contextPatch.destination === expected, `${message}: destination=${expected}`);
  assert(applied.contextPatch.tripPurpose === "region_selected", `${message}: purpose=region_selected`);
  assert(applied.session.pendingQuestion == null, `${message}: pending cleared`);
}

assertSelection("普羅旺斯", "普羅旺斯", "structured pending exact selection");
assertSelection("2", "普羅旺斯", "numeric selection");
assertSelection("我想去普羅旺斯", "普羅旺斯", "natural destination sentence");
assertSelection("普羅旺斯那個", "普羅旺斯", "natural option suffix");
assertSelection("就第二個吧", "普羅旺斯", "natural ordinal sentence");

const recovered = recoverPendingFromAssistantReply(bulletReply, countryContext);
assert(recovered?.type === "region_choice", "bullet reply recovers region_choice");
assert(
  JSON.stringify(recovered?.options) === JSON.stringify(options),
  "bullet descriptions are stripped from recovered options",
);

const numberedReply = `以下城市／地區你比較有興趣哪一個？
1. 巴黎
2. 普羅旺斯
3. 蔚藍海岸`;
assert(
  JSON.stringify(recoverPendingFromAssistantReply(numberedReply, countryContext)?.options) ===
    JSON.stringify(options),
  "numbered options are recovered",
);

const plainReply = `可以先從這幾個城市／地區考慮：
巴黎
普羅旺斯
蔚藍海岸`;
assert(
  JSON.stringify(recoverPendingFromAssistantReply(plainReply, countryContext)?.options) ===
    JSON.stringify(options),
  "plain-line options are recovered",
);

const missingPendingSession = {
  ...createEmptySession(),
  travelContext: countryContext,
  lastAssistantReply: bulletReply,
};
const merged = mergeTravelContext(missingPendingSession, "普羅旺斯", bulletReply);
assert(merged.context.destination === "普羅旺斯", "recovered flow updates destination");
assert(merged.context.tripPurpose === "region_selected", "recovered flow preserves region purpose");
assert(merged.session.pendingQuestion == null, "recovered flow clears pending after selection");
const nextAdvice = resolveDestinationAdvice(merged.context, merged.session, "普羅旺斯");
assert(
  !/巴黎[\s\S]*普羅旺斯[\s\S]*蔚藍海岸/u.test(nextAdvice.reply ?? ""),
  "recovered flow does not repeat country region choices",
);
assert(
  nextAdvice.pendingQuestion?.type !== "region_choice",
  "decision engine advances beyond region selection",
);

const article = "巴黎、里昂與尼斯各有不同旅行節奏，春天都很適合造訪。";
assert(
  recoverPendingFromAssistantReply(article, countryContext) == null,
  "city article without a selection question is ignored",
);

const combinationReply = `1. 經典地標組合
2. 博物館藝術組合
3. 左岸漫步組合`;
assert(
  recoverPendingFromAssistantReply(combinationReply, countryContext) == null,
  "combination list is not recovered as region_choice",
);

const existingPending = sessionWithPending();
const ensured = ensureSessionPendingQuestion(existingPending, "你這趟大概幾天？");
assert(ensured.pendingQuestion?.type === "region_choice", "structured pending wins over text recovery");
assert(
  JSON.stringify(ensured.pendingQuestion?.options) === JSON.stringify(options),
  "structured pending survives session reload",
);

if (failed > 0) {
  console.error(`\n${failed} region-choice recovery checks failed.`);
  process.exit(1);
}

console.log("\nAll region-choice pending recovery checks passed.");
