/**
 * Chat place cards must stay hidden during combination / itinerary generation.
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import {
  adviceToAssistantChatMsg,
  applyAdviceResultToSession,
} from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { shouldSuppressChatPlaceCards } from "../src/lib/ai/chat-suppress-place-cards.ts";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";

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
      pendingQuestion:
        turn.route?.pendingQuestion ?? turn.advice?.pendingQuestion ?? route.pendingQuestion,
      lastResolvedPendingQuestion: undefined,
      adviceSelectionThisTurn: undefined,
    },
    turn.advice,
  );
  return { session: persisted, advice: turn.advice, context: merged.context };
}

console.log("=== Chat: no place cards during combination ===\n");

let session = createEmptySession();
let t1 = planningTurn("9/1-9/4 要去台中", session);
assert(/建議組合|文創|高美/.test(t1.advice.reply ?? ""), "shows combination text");
assert(!(t1.advice.recommendations?.length > 0), "advice has no recommendations array");
assert(
  t1.session.pendingQuestion?.type === "combination_choice",
  "pending combination_choice",
);
assert(
  shouldSuppressChatPlaceCards(t1.session) === true,
  "suppress place cards while waiting for combination",
);

const msg = adviceToAssistantChatMsg(t1.advice);
assert(!msg.roamie?.recommendations?.length, "assistant msg has no place cards");
assert(
  recommendationsForChatDisplay(t1.session, "9/1-9/4 要去台中", [
    { name: "審計新村", description: "文創慢逛組合推薦" },
  ]).length === 0,
  "display filter strips combo candidate cards",
);

session = t1.session;
let t2 = planningTurn("1、2", session);
assert(t2.advice.triggerItineraryGeneration === true, "triggers generation");
assert(!(t2.advice.recommendations?.length > 0), "generation advice has no place cards");
assert(/正在整理並規劃中/.test(t2.advice.reply ?? ""), "generating copy");
assert(
  shouldSuppressChatPlaceCards(t2.session, { generating: true }) === true,
  "suppress while generating",
);

const genMsg = adviceToAssistantChatMsg(t2.advice);
assert(!genMsg.roamie?.recommendations?.length, "generating msg text-only");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll chat place-card suppression checks passed.");
