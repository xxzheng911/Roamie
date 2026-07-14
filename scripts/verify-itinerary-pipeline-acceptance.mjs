/**
 * Acceptance checks for the AI itinerary planning pipeline.
 * Cases:
 * 1) 11月東京 → season (楓葉) → ask date/days → combinations → Nov mid dates
 * 2) 9/1~9/4台東 → combinations directly with exact dates
 * 3) 東京6天 → combinations without 東京站; CTA copy; no session: ids in builders
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { buildDestinationCombinationSuggestionsReply } from "../src/lib/ai/destination-combination-suggestions.ts";
import { resolveTripCreateDates } from "../src/lib/ai/resolve-trip-create-dates.ts";
import { resolveSuggestedTripDates } from "../src/lib/ai/resolve-suggested-trip-dates.ts";
import { isGooglePlaceId } from "../src/lib/place-detail-handoff.ts";
import { isHardGooglePlaceId } from "../src/lib/ai/planning-place-id.ts";
import { preparePlacesForItineraryBuild } from "../src/lib/place-planning-memory.ts";
import { isForbiddenTransitAttraction } from "../src/lib/ai/transit-station-filter.ts";

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

console.log("=== Case 1: 11月東京 ===\n");

let session = createEmptySession();
let t1 = planningTurn("11月去東京", session);
assert(Boolean(t1.advice.reply), "c1 turn1 has reply");
assert(/楓葉|銀杏/.test(t1.advice.reply ?? ""), "c1 turn1 mentions maple/ginkgo");
assert(/日期或天數|旅行日期|天數/.test(t1.advice.reply ?? ""), "c1 turn1 asks date/days");
assert(t1.session.pendingQuestion?.type === "ask_days", "c1 turn1 pending ask_days");
assert(
  Boolean(t1.advice.contextPatch?.suggestedStartDate) ||
    Boolean(t1.session.travelContext?.suggestedStartDate),
  "c1 turn1 stores suggestedStartDate",
);

session = t1.session;
let t2 = planningTurn("大概6天", session);
assert(/經典東京|時尚商圈|文化歷史|夜景/.test(t2.advice.reply ?? ""), "c1 turn2 shows combinations");
assert(!/東京站/.test(t2.advice.reply ?? ""), "c1 turn2 does NOT recommend 東京站");
assert(
  /回覆你比較有興趣的組合，我來幫你生成行程/.test(t2.advice.reply ?? ""),
  "c1 turn2 CTA copy",
);
assert(t2.session.pendingQuestion?.type === "combination_choice", "c1 turn2 combination_choice");

session = t2.session;
let t3 = planningTurn("1、2、4", session);
assert(t3.advice.triggerItineraryGeneration === true, "c1 turn3 triggers itinerary generation");
assert(!/第\s*1\s*天|Day\s*1/i.test(t3.advice.reply ?? ""), "c1 turn3 no Day1 draft in chat reply");

const c1Dates = resolveTripCreateDates({
  context: {
    ...(session.travelContext ?? { interests: [] }),
    destination: "東京",
    days: 6,
    travelMonth: "11月",
    suggestedStartDate:
      t1.advice.contextPatch?.suggestedStartDate ??
      session.travelContext?.suggestedStartDate,
  },
  session: { ...session, tripDays: 6 },
  days: 6,
});
assert(c1Dates.startDate?.startsWith("202") && c1Dates.startDate?.includes("-11-"), "c1 trip start in November");
assert(c1Dates.hasExplicitDates, "c1 has explicit dates from AI/month default");
assert(c1Dates.source === "ai_suggested" || c1Dates.source === "month_default", `c1 date source=${c1Dates.source}`);

console.log("\n=== Case 2: 9/1~9/4台東 ===\n");

session = createEmptySession();
let s1 = planningTurn("9/1~9/4去台東", session);
assert(/海岸公路|市區文化|縱谷|建議組合/.test(s1.advice.reply ?? ""), "c2 turn1 shows combinations directly");
assert(s1.session.pendingQuestion?.type === "combination_choice", "c2 turn1 combination_choice");
assert(
  !/你這趟大概幾天|有預計的旅行日期/.test(s1.advice.reply ?? ""),
  "c2 does NOT ask days again",
);

const c2Dates = resolveTripCreateDates({
  context: {
    ...(s1.merged.context ?? { interests: [] }),
    destination: "台東",
    days: 4,
    startDate: s1.merged.context.startDate,
    endDate: s1.merged.context.endDate,
  },
  session: s1.session,
  days: 4,
  userText: "9/1~9/4去台東",
});
assert(c2Dates.startDate?.endsWith("-09-01"), `c2 startDate=${c2Dates.startDate}`);
assert(c2Dates.endDate?.endsWith("-09-04"), `c2 endDate=${c2Dates.endDate}`);
assert(c2Dates.days === 4, "c2 days=4");
assert(c2Dates.source === "user_date", `c2 source=${c2Dates.source}`);

session = s1.session;
let s2 = planningTurn("1、2、3", session);
assert(s2.advice.triggerItineraryGeneration === true, "c2 turn2 triggers generation");

console.log("\n=== Case 3: 東京6天 + place id guards ===\n");

session = createEmptySession();
let u1 = planningTurn("東京6天", session);
assert(/建議組合|經典東京/.test(u1.advice.reply ?? ""), "c3 shows combinations");
assert(!/東京站/.test(u1.advice.reply ?? ""), "c3 no 東京站");
assert(
  /回覆你比較有興趣的組合，我來幫你生成行程/.test(u1.advice.reply ?? ""),
  "c3 CTA copy",
);

const comboReply = buildDestinationCombinationSuggestionsReply("東京", 6);
assert(
  comboReply?.includes("回覆你比較有興趣的組合，我來幫你生成行程"),
  "combo CTA helper text",
);
assert(!comboReply?.includes("東京站"), "combo helper no 東京站");
assert(!comboReply?.includes("東京灣"), "combo helper no 東京灣");

assert(!isGooglePlaceId("session:皇居外苑"), "session: id rejected by isGooglePlaceId");
assert(!isGooglePlaceId("trip:foo"), "trip: id rejected");
assert(!isGooglePlaceId("memory:bar"), "memory: id rejected");
assert(!isHardGooglePlaceId("session:東京灣"), "session: rejected by isHardGooglePlaceId");
assert(isGooglePlaceId("ChIJuWwUYbWLGGARXvLwEYxgp0Q") === true, "ChIJ id accepted");

const prepared = preparePlacesForItineraryBuild(
  [{ name: "皇居外苑", placeName: "皇居外苑", address: "東京" }],
  "東京",
);
assert(
  !prepared.some((p) => String(p.placeId ?? "").startsWith("session:")),
  "preparePlacesForItineraryBuild never invents session: ids",
);

assert(
  isForbiddenTransitAttraction({ name: "東京站", types: ["train_station"] }),
  "東京站 forbidden as attraction",
);
assert(
  isForbiddenTransitAttraction({ name: "上野站", primaryType: "subway_station" }),
  "上野站 forbidden",
);
assert(
  !isForbiddenTransitAttraction({ name: "多良車站", types: ["train_station"] }),
  "多良車站 scenic allowlist",
);

const mid = resolveSuggestedTripDates({
  days: 6,
  travelMonth: "11月",
  refDate: new Date("2026-07-14T12:00:00"),
});
assert(mid?.startDate === "2026-11-15", `month default mid=${mid?.startDate}`);
assert(mid?.endDate === "2026-11-20", `month default end=${mid?.endDate}`);

console.log("\n=== Summary ===");
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All pipeline acceptance checks passed.");
