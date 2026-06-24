import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import { resolveChatApiPhase } from "../src/lib/chat-planning-flow.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const session = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  conversationMode: "destination_planning",
  phase: "discover",
  pendingQuestion: {
    type: "ask_preference",
    options: ["經典景點", "美食咖啡", "海灘放鬆", "都可以"],
    baseDestination: "雪梨",
  },
  travelContext: {
    interests: [],
    destination: "雪梨",
    days: 6,
    tripPurpose: "duration_selected",
  },
};
const merged = mergeTravelContext(session, "景點");
const intent = resolveChatIntent("景點", merged.session);
const phase = resolveChatApiPhase(merged.session, "景點");
const route = resolveChatRoute("景點", merged.context, merged.session, "zh-TW", intent);
const turn = processAdviceTurn("景點", merged.session, merged.context);
console.log("intent", intent, "phase", phase, "route", route.mode);
console.log("advice", turn.advice.reply?.slice(0, 150));
console.log("pending", turn.advice.pendingQuestion?.type);
