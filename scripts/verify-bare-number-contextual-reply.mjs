/**
 * Bare-number contextual resolution under pendingQuestion.
 * Cases: ask_date_or_duration / ask_days / combination / people / ask_date.
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  applyAdviceResultToSession,
  resolveDestinationAdvice,
} from "../src/lib/ai/destination-advice.ts";
import {
  parseAskDaysFromText,
  parseAskDaysClarification,
  parsePendingOptionSelection,
  pendingQuestionForCombinationChoice,
} from "../src/lib/ai/destination-pending-question.ts";
import { pendingQuestionForAskDays } from "../src/lib/ai/city-days-planning.ts";
import {
  resolveBareNumberByPendingQuestion,
  parseBareIntegerFromText,
  parseTripDaysFromPendingReply,
} from "../src/lib/ai/bare-number-reply.ts";
import { parseDayCountFromText } from "../src/lib/parse-chinese-duration.ts";

let failed = 0;
const logs = [];
const originalInfo = console.info;
console.info = (...args) => {
  logs.push(args.join(" "));
  originalInfo(...args);
};

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

// --- Unit: duration unit parser (no bare number) ---
for (const [input, expected] of [
  ["3天", 3],
  ["三天", 3],
  ["3日", 3],
  ["三日", 3],
  ["大概3天", 3],
  ["差不多3天", 3],
  ["三天左右", 3],
  ["3天吧", 3],
  ["５天", 5],
  ["5天4夜", 5],
  ["4晚", 4],
]) {
  assert(parseDayCountFromText(input) === expected, `unit parse ${input} -> ${expected}`);
}
assert(parseDayCountFromText("3") === undefined, "bare 3 is NOT unit-parsed");
assert(parseDayCountFromText("3號") === undefined, "3號 is NOT duration");

// --- Unit: bare integer ---
assert(parseBareIntegerFromText("3") === 3, "bare 3");
assert(parseBareIntegerFromText("３") === 3, "fullwidth 3");
assert(parseBareIntegerFromText("三") === 3, "cn 三");
assert(parseBareIntegerFromText("大概3") === 3, "大概3");

// --- resolveBareNumberByPendingQuestion ---
{
  const r = resolveBareNumberByPendingQuestion(3, {
    pendingQuestion: { type: "ask_days", expectedAnswerType: "days" },
    pendingQuestionAlias: "ask_date_or_duration",
    conversationStage: "COLLECTING_DATE_AND_DURATION",
  });
  assert(r.resolvedAs === "tripDays" && r.tripDays === 3, "ask_date_or_duration → tripDays");
}
{
  const r = resolveBareNumberByPendingQuestion(6, {
    pendingQuestion: { type: "ask_days" },
  });
  assert(r.resolvedAs === "tripDays" && r.tripDays === 6, "ask_days → tripDays");
}
{
  const r = resolveBareNumberByPendingQuestion(3, {
    pendingQuestion: { type: "combination_choice" },
  });
  assert(r.resolvedAs === "combinationId" && r.combinationId === 3, "combination → id");
}
{
  const r = resolveBareNumberByPendingQuestion(3, {
    pendingQuestion: { type: "ask_people", expectedAnswerType: "companion" },
  });
  assert(r.resolvedAs === "companionCount" && r.companionCount === 3, "ask_people → companion");
}
{
  const r = resolveBareNumberByPendingQuestion(3, {
    pendingQuestion: { type: "ask_date" },
  });
  assert(
    r.resolvedAs === "needs_date_or_days_clarification",
    "ask_date bare → clarification",
  );
  assert(Boolean(r.clarificationReply?.includes("3 號") || r.clarificationReply?.includes("3 天")), "ask_date clarify text");
}

// --- parseAskDaysFromText / clarification ---
assert(parseAskDaysFromText("3") === 3, "parseAskDaysFromText bare 3");
assert(parseAskDaysFromText("６") === 6, "parseAskDaysFromText fullwidth 6");
assert(parseAskDaysFromText("三") === 3, "parseAskDaysFromText 三");
assert(parseAskDaysFromText("3天") === 3, "parseAskDaysFromText 3天");
assert(parseAskDaysFromText("3號") === undefined, "3號 not days");
assert(Boolean(parseAskDaysClarification("3號")), "3號 asks clarification");

{
  const pending = pendingQuestionForAskDays("花蓮", "台灣");
  assert(parsePendingOptionSelection("3", pending) === "3", "pending ask_days selects 3");
}
{
  const pending = pendingQuestionForCombinationChoice("花蓮", "台灣");
  const selected = parsePendingOptionSelection("3", pending);
  // Combination index 3 may or may not exist; must NOT become tripDays via ask_days path.
  assert(selected !== "3" || Boolean(selected?.includes("|") || selected), "combination keeps own parser");
  const bare = resolveBareNumberByPendingQuestion(3, { pendingQuestion: pending });
  assert(bare.resolvedAs === "combinationId", "combo pending bare stays combinationId");
}

// --- Integration: Hualien month → ask date/days → bare "3" ---
logs.length = 0;
let session = createEmptySession();

function runAdvice(text, sess) {
  const merged = mergeTravelContext(sess, text);
  const intent = detectChatIntent(text);
  const nextSession = {
    ...merged.session,
    activeChatIntent:
      intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
  };
  const advice = resolveDestinationAdvice(merged.context, nextSession, text);
  return { advice, merged, nextSession };
}

// Turn 1: 我下個月要去花蓮
{
  const t1 = runAdvice("我下個月要去花蓮", session);
  assert(Boolean(t1.advice?.reply), "turn1 has reply");
  const asksDays =
    /旅行日期或天數|大概幾天|想排幾天/.test(t1.advice.reply ?? "") ||
    t1.advice.pendingQuestion?.type === "ask_days";
  assert(asksDays, "turn1 asks date or days");
  session = applyAdviceResultToSession(
    {
      ...t1.nextSession,
      activeChatIntent: "destination_advice",
      conversationMode: "destination_planning",
      pendingQuestion: t1.advice.pendingQuestion ?? pendingQuestionForAskDays("花蓮", "台灣"),
      travelContext: {
        ...t1.merged.context,
        destination: t1.merged.context.destination ?? "花蓮",
        destinationCountry: t1.merged.context.destinationCountry ?? "台灣",
        travelMonth: t1.merged.context.travelMonth ?? "8月",
      },
    },
    {
      reply: t1.advice.reply,
      pendingQuestion: t1.advice.pendingQuestion ?? pendingQuestionForAskDays("花蓮", "台灣"),
      contextPatch: t1.advice.contextPatch,
    },
  );
  assert(session.pendingQuestion?.type === "ask_days", "turn1 pending=ask_days");
}

// Turn 2: bare "3"
logs.length = 0;
{
  const t2 = runAdvice("3", session);
  assert(Boolean(t2.advice?.reply), "turn2 has reply");
  assert(
    !/你這趟大概幾天|例如\s*5\s*天/.test(t2.advice.reply ?? ""),
    "turn2 does NOT re-ask days",
  );
  assert(
    t2.advice.contextPatch?.days === 3 ||
      t2.merged.context.days === 3 ||
      parseAskDaysFromText("3", session.pendingQuestion) === 3,
    "turn2 tripDays=3",
  );
  // Prefer combination offer, days acknowledgement, or discovery failure — never re-ask days.
  const movedOn =
    t2.advice.pendingQuestion?.type === "combination_choice" ||
    t2.advice.pendingQuestion?.type !== "ask_days" ||
    /組合|天行程|我先記下|暫時找不到|推薦/.test(t2.advice.reply ?? "") ||
    t2.advice.contextPatch?.days === 3;
  assert(movedOn, "turn2 advances past ask_days");
  assert(t2.advice.pendingQuestion?.type !== "ask_days", "turn2 pending cleared from ask_days");
  assert(
    !/travelStyle=3/.test(logs.join("\n")) ||
      !logs.some((l) => l.includes("travelStyle=3")),
    "turn2 does not set travelStyle=3",
  );
  assert(
    logs.some((l) => l.includes("[BARE_NUMBER_REPLY_RECEIVED]") && l.includes("value=3")),
    "logs BARE_NUMBER_REPLY_RECEIVED",
  );
  assert(
    logs.some(
      (l) =>
        l.includes("[BARE_NUMBER_CONTEXT_RESOLUTION]") &&
        l.includes("resolvedAs=tripDays"),
    ),
    "logs BARE_NUMBER_CONTEXT_RESOLUTION tripDays",
  );
  assert(
    logs.some(
      (l) =>
        l.includes("[TRIP_DURATION_PARSED]") &&
        l.includes("tripDays=3") &&
        l.includes("bare_number_contextual"),
    ),
    "logs TRIP_DURATION_PARSED",
  );
}

// Case 2: ask_days + "6"
{
  const pending = pendingQuestionForAskDays("東京", "日本");
  assert(parseAskDaysFromText("6", pending) === 6, "tokyo bare 6 → 6 days");
  assert(parsePendingOptionSelection("6", pending) === "6", "tokyo pending selects 6");
}

// Case 3: combination + "3" must not be tripDays
{
  const r = resolveBareNumberByPendingQuestion(3, {
    pendingQuestion: { type: "combination_choice" },
  });
  assert(r.resolvedAs !== "tripDays", "combo 3 is not tripDays");
}

// Case 4: ask_people
{
  const r = resolveBareNumberByPendingQuestion(3, {
    pendingQuestion: { type: "ask_people", expectedAnswerType: "companion" },
  });
  assert(r.companionCount === 3 && r.resolvedAs !== "tripDays", "people 3 not days");
}

// Case 5: ask_date
{
  const parsed = parseTripDaysFromPendingReply("3", {
    pendingQuestion: { type: "ask_date" },
    pendingQuestionAlias: "ask_date",
  });
  assert(!parsed.days, "ask_date bare 3 has no days");
  assert(Boolean(parsed.clarificationReply), "ask_date asks clarification");
}

// Multi-city bare numbers
for (const [city, n] of [
  ["東京", 5],
  ["首爾", 4],
  ["巴黎", 7],
  ["台東", 3],
]) {
  assert(
    parseAskDaysFromText(String(n), pendingQuestionForAskDays(city)) === n,
    `${city} bare ${n} → tripDays`,
  );
}

console.info = originalInfo;
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll bare-number contextual reply checks passed.");
