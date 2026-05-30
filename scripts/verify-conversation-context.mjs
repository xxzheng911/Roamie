/**
 * Quick checks for conversation memory + season logic.
 * Run: npx vite-node scripts/verify-conversation-context.mjs
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import {
  rehydrateSessionFromMessages,
  updateConversationContext,
  formatConversationContextForAi,
} from "../src/lib/ai/conversation-context.ts";
import { inferTravelSeason, parseMonthNumber } from "../src/lib/ai/travel-season.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ref = new Date("2026-05-30T12:00:00+08:00");

let session = createEmptySession();
const msgs = [
  { role: "user", content: "我下個月想去京都" },
  { role: "assistant", content: "好的", roamie: { summary: "京都 spring", recommendations: [{ name: "清水寺" }] } },
  { role: "user", content: "我想看楓葉" },
];

session = rehydrateSessionFromMessages(session, msgs);
assert(session.travelContext?.destination === "京都", "destination=京都");
assert(
  session.conversationContext?.interests?.includes("楓葉") ||
    session.travelContext?.interests?.includes("楓葉"),
  "楓葉 interest captured",
);

session = updateConversationContext(session, "12月去大阪", [
  ...msgs,
  { role: "user", content: "12月去大阪" },
]);
assert(session.conversationContext?.destination === "京都" || session.conversationContext?.destination === "大阪", "destination sticky/update");
const dec = parseMonthNumber({ userText: "12月去大阪" });
assert(dec === 12, "month=12");
const season = inferTravelSeason({ destination: "大阪", month: 12 });
assert(season?.seasonLabel === "冬季", "winter season");
assert(season?.outfitSuggestion?.includes("大衣") || season?.outfitSuggestion?.includes("羽絨"), "winter outfit");

session = updateConversationContext(session, "那附近呢？", [
  { role: "user", content: "我想去大阪城" },
  { role: "assistant", content: "推薦", roamie: { summary: "大阪城", recommendations: [{ name: "大阪城" }] } },
  { role: "user", content: "那附近呢？" },
]);
assert(
  session.preferredArea?.includes("大阪城") || session.conversationContext?.nearbyAnchor?.includes("大阪城"),
  "anaphora 那附近 → 大阪城",
);

session = updateConversationContext(session, "這次自駕", [{ role: "user", content: "這次自駕" }]);
assert(session.conversationContext?.transportation === "自駕", "自駕 transport");

session = updateConversationContext(session, "和家人旅行", [{ role: "user", content: "和家人旅行" }]);
assert(session.conversationContext?.companions === "家人", "companions=家人");

const block = formatConversationContextForAi(session.conversationContext);
assert(block.includes("Conversation Memory"), "AI block present");

console.info("[verify-conversation-context] OK");
