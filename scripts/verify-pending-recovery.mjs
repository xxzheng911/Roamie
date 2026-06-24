/**
 * 驗證 pendingQuestion 遺失時，可從上一輪助理回覆恢復並正確解析「景點」。
 */
import assert from "node:assert/strict";
import { prepareSessionForUserTurn } from "../src/lib/ai/chat-conversation-state.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";

const preferenceReply = [
  "好，我先記下：",
  "",
  "目的地：雪梨",
  "天數：6天",
  "",
  "雪梨 6 天其實很舒服。",
  "",
  "你比較偏：",
  "A. 經典景點",
  "B. 美食咖啡",
  "C. 海灘放鬆",
  "D. 都可以",
].join("\n");

const sessionWithoutPending = {
  recommendedPlaces: [],
  selectedPlaces: [],
  phase: "discover",
  discovery: {},
  updatedAt: new Date().toISOString(),
  conversationMode: "destination_planning",
  activeChatIntent: "destination_advice",
  lastAssistantReply: preferenceReply,
  travelContext: {
    interests: [],
    destination: "雪梨",
    destinationCountry: "澳洲",
    days: 6,
  },
};

const prepared = prepareSessionForUserTurn(sessionWithoutPending, preferenceReply);
assert.equal(prepared.pendingQuestion?.type, "ask_preference");
assert.equal(prepared.pendingQuestion?.expectedAnswerType, "preference");

const merged = mergeTravelContext(prepared, "景點", preferenceReply);
assert.equal(merged.context.travelStyle, "sightseeing");
assert.equal(merged.context.vibe, "經典景點");
assert.ok(merged.session.adviceSelectionThisTurn);

const advice = resolveDestinationAdvice(merged.context, merged.session, "景點");
assert.ok(advice.reply);
assert.doesNotMatch(advice.reply, /我先用目前掌握的需求/);
assert.equal(advice.pendingQuestion?.type, "activity_choice");

console.log("verify-pending-recovery: ok");
