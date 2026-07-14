/**
 * Verify: 9/1-9/4台中 → New Trip Conversation (dynamic combinations), NOT legacy style 1~4.
 * Also assert destination-agnostic combos for 台南 / 高雄 / 巴黎.
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  buildDestinationCombinationSuggestionsReply,
  getDestinationCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { shouldAskTripStyle } from "../src/lib/ai/ai-trip-style.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function planningTurn(text, session) {
  const merged = mergeTravelContext(session, text);
  const intent = detectChatIntent(text);
  const nextSession = {
    ...merged.session,
    activeChatIntent:
      intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
  };
  const route = resolveChatRoute(text, merged.context, nextSession, "zh-TW", intent);
  const turn = processAdviceTurn(text, nextSession, merged.context);
  const persisted = applyAdviceResultToSession(
    {
      ...turn.session,
      pendingQuestion: turn.route?.pendingQuestion ?? turn.advice?.pendingQuestion ?? route.pendingQuestion,
      lastResolvedPendingQuestion: undefined,
      adviceSelectionThisTurn: undefined,
    },
    turn.advice,
  );
  return { route, turn, merged, session: persisted, advice: turn.advice };
}

console.log("=== 台中 9/1-9/4 New Flow ===\n");

let session = createEmptySession();
let t1 = planningTurn("我9/1-9/4要去台中", session);
assert(Boolean(t1.advice.reply), "has reply");
assert(
  !/經典地標（適合第一次去）|在地商圈市集走訪|慢步調散策|Roamie 幫我混搭推薦|回覆 1～4 或選項名稱/.test(
    t1.advice.reply ?? "",
  ),
  "does NOT show legacy trip style options",
);
assert(
  /審計新村|草悟道|逢甲|宮原眼科|高美濕地|文創|組合/.test(t1.advice.reply ?? ""),
  "shows Taichung-specific dynamic combinations",
);
assert(
  /回覆你比較有興趣的組合/.test(t1.advice.reply ?? ""),
  "shows new combination CTA",
);
assert(
  t1.session.pendingQuestion?.type === "combination_choice",
  `pending combination_choice (got ${t1.session.pendingQuestion?.type})`,
);
assert(
  shouldAskTripStyle(t1.merged.context, t1.session) === false,
  "shouldAskTripStyle is retired",
);

console.log("\n=== Destination-agnostic combinations ===\n");

for (const city of ["台中", "台南", "高雄", "東京", "首爾", "巴黎", "紐約"]) {
  const combos = getDestinationCombinations(city);
  assert(combos.length >= 3, `${city} has >=3 combinations (got ${combos.length})`);
  const reply = buildDestinationCombinationSuggestionsReply(city, 4);
  assert(Boolean(reply), `${city} reply built`);
  assert(!/Roamie 幫我混搭推薦/.test(reply ?? ""), `${city} not legacy mixed option`);
  // Cities must not all share the exact same first title
}

const taichung = getDestinationCombinations("台中").map((c) => c.title).join("|");
const tokyo = getDestinationCombinations("東京").map((c) => c.title).join("|");
assert(taichung !== tokyo, "台中 vs 東京 combination titles differ");
assert(/審計|草悟|逢甲|高美/.test(taichung + getDestinationCombinations("台中").flatMap((c) => c.places).join("、")), "台中 places are city-specific");
assert(/淺草|澀谷|新宿/.test(getDestinationCombinations("東京").flatMap((c) => c.places).join("、")), "東京 places are city-specific");

console.log("\n=== Summary ===");
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All Taichung / agnostic flow checks passed.");
