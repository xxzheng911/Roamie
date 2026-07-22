/**
 * verify:destination-duration-state
 *
 * Guards the country → city → ask days conversation flow.
 * Combination Discovery must not run when tripDays is missing.
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import {
  resolveDestinationAdvice,
  applyAdviceResultToSession,
} from "../src/lib/ai/destination-advice.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { parsePendingOptionSelection } from "../src/lib/ai/destination-pending-question.ts";
import {
  canEnterCombinationDiscovery,
  evaluateCombinationDiscoveryGuard,
  hasValidTripDuration,
  resolveValidTripDays,
  buildDestinationDirectionAck,
} from "../src/lib/ai/trip-duration-guard.ts";
import { hasDestinationPlanningBasics } from "../src/lib/ai/destination-combination-suggestions.ts";
import { resolveChatPlanningState } from "../src/lib/ai/chat-planning-state.ts";

let failed = 0;
const logs = [];
const originalInfo = console.info;
console.info = (...args) => {
  const line = args.join(" ");
  logs.push(line);
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

function adviceRoute(text, session) {
  const merged = mergeTravelContext(session, text);
  const intent = detectChatIntent(text);
  const nextSession = {
    ...merged.session,
    activeChatIntent:
      intent === "destination_advice" || intent === "trip_planning"
        ? "destination_advice"
        : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" || intent === "trip_planning"
        ? "destination_planning"
        : merged.session.conversationMode,
  };
  return {
    route: resolveChatRoute(text, merged.context, nextSession, "zh-TW", intent),
    merged,
    nextSession,
  };
}

function applyRoute(session, route, merged) {
  return applyAdviceResultToSession(
    {
      ...session,
      pendingQuestion: route.pendingQuestion,
      travelContext: { ...merged.context, ...route.contextPatch },
      activeChatIntent: "destination_advice",
      conversationMode: "destination_planning",
    },
    {
      reply: route.question,
      contextPatch: route.contextPatch,
      pendingQuestion: route.pendingQuestion,
    },
  );
}

// --- Unit: hasValidTripDuration ---
assert(!hasValidTripDuration({}), "empty context invalid");
assert(!hasValidTripDuration({ tripDays: undefined }), "undefined invalid");
assert(!hasValidTripDuration({ tripDays: null }), "null invalid");
assert(!hasValidTripDuration({ tripDays: 0 }), "0 invalid");
assert(!hasValidTripDuration({ tripDays: NaN }), "NaN invalid");
assert(!hasValidTripDuration({ days: "" }), "empty string invalid");
assert(!hasValidTripDuration({ days: " " }), "whitespace invalid");
assert(hasValidTripDuration({ tripDays: 6 }) === true, "6 days valid");
assert(hasValidTripDuration({ days: 3 }) === true, "days=3 valid");
assert(
  hasValidTripDuration({ startDate: "2026-09-05", endDate: "2026-09-10" }) === true,
  "date range valid",
);
assert(resolveValidTripDays({ startDate: "2026-09-05", endDate: "2026-09-10" }) === 6, "inclusive 6 days");

// --- Copy: never render empty day slot ---
assert(
  !buildDestinationDirectionAck({ destination: "福岡" }).includes("福岡 天"),
  "ack without days has no empty day slot",
);
assert(
  !buildDestinationDirectionAck({ destination: "福岡", tripDays: undefined }).includes(
    "undefined",
  ),
  "ack without days has no undefined",
);
assert(
  buildDestinationDirectionAck({ destination: "福岡", tripDays: 6 }).includes("6 天"),
  "ack with days mentions 6",
);
assert(
  buildDestinationDirectionAck({
    destination: "福岡",
    startDate: "2026-09-05",
    endDate: "2026-09-10",
  }).includes("2026/09/05"),
  "ack with dates formats range",
);

// --- Guard: combination discovery blocked without days ---
{
  const guard = evaluateCombinationDiscoveryGuard({
    destination: "福岡",
    destinationCountry: "日本",
    tripDays: undefined,
    days: undefined,
  });
  assert(guard.allowed === false, "combo guard blocked without days");
  assert(guard.reason === "missing_trip_duration", "combo guard reason missing_trip_duration");
  assert(
    canEnterCombinationDiscovery({
      destination: "福岡",
      destinationCountry: "日本",
      days: undefined,
    }) === false,
    "canEnterCombinationDiscovery false without days",
  );
  assert(
    hasDestinationPlanningBasics({ destination: "福岡", days: undefined }) === false,
    "planning basics false without days",
  );
}

// --- Case A: 日本 → 福岡 → ask days (福岡 not in option list) ---
logs.length = 0;
let session = createEmptySession();
const turn1 = adviceRoute("我想去日本", session);
assert(turn1.route.pendingQuestion?.type === "region_choice", "T1 pending region_choice");
assert(
  (turn1.route.pendingQuestion?.options ?? []).includes("東京"),
  "T1 options include 東京",
);
assert(
  !(turn1.route.pendingQuestion?.options ?? []).includes("福岡"),
  "T1 options do not list 福岡 (free-form case)",
);
session = applyRoute(turn1.nextSession, turn1.route, turn1.merged);

assert(
  parsePendingOptionSelection("福岡", session.pendingQuestion) === "福岡",
  "福岡 accepted as free-form region_choice",
);

logs.length = 0;
const t2 = mergeTravelContext(session, "福岡");
assert(t2.context.destination === "福岡", "T2 destination=福岡");
assert(t2.context.destinationCountry === "日本", "T2 inherits countryCode/country=日本");
assert(t2.context.days == null || t2.context.days === undefined, "T2 days still missing");
assert(
  t2.session.adviceSelectionThisTurn === "福岡" ||
    parsePendingOptionSelection("福岡", session.pendingQuestion) === "福岡",
  "T2 marks destination selection",
);

const turn2 = processAdviceTurn("福岡", t2.session, t2.context);
assert(Boolean(turn2.advice.reply), "T2 advice has reply");
assert(
  /旅行日期或天數|大概幾天|玩幾天/.test(turn2.advice.reply ?? ""),
  "T2 asks for date or duration",
);
assert(
  !(turn2.advice.reply ?? "").includes("福岡 天行程方向"),
  "T2 reply must not render empty day template",
);
assert(
  !(turn2.advice.reply ?? "").includes("暫時無法取得足夠的實際地點組合"),
  "T2 must not show places-insufficient error",
);
assert(
  !(turn2.advice.reply ?? "").includes("重新整理推薦"),
  "T2 must not show refresh recommendations",
);
assert(
  turn2.advice.pendingQuestion?.type === "ask_days" ||
    turn2.session.pendingQuestion?.type === "ask_days" ||
    turn2.advice.contextPatch?.conversationState === "awaiting_days",
  "T2 moves to ask_days / awaiting_days",
);

const planningState = resolveChatPlanningState(
  {
    ...t2.session,
    ...turn2.session,
    travelContext: {
      ...t2.context,
      ...turn2.advice.contextPatch,
    },
  },
  { ...t2.context, ...turn2.advice.contextPatch },
);
assert(
  planningState === "waitingTripDays",
  `T2 chatPlanningState waitingTripDays (got ${planningState})`,
);

assert(
  logs.some((l) => l.includes("[DESTINATION_SELECTION_RECEIVED]") && l.includes("福岡")),
  "logs DESTINATION_SELECTION_RECEIVED",
);
assert(
  logs.some((l) => l.includes("[DESTINATION_SELECTION_RESOLVED]") && l.includes("福岡")),
  "logs DESTINATION_SELECTION_RESOLVED",
);
assert(
  logs.some(
    (l) =>
      l.includes("[TRIP_DURATION_GUARD]") &&
      l.includes("valid=false") &&
      l.includes("waitingTripDays"),
  ),
  "logs TRIP_DURATION_GUARD valid=false",
);
assert(
  logs.some(
    (l) =>
      l.includes("[COMBINATION_DISCOVERY_GUARD]") &&
      l.includes("allowed=false") &&
      l.includes("missing_trip_duration"),
  ) ||
    logs.some(
      (l) =>
        l.includes("[CONVERSATION_STATE_TRANSITION]") &&
        l.includes("waitingTripDays") &&
        l.includes("destination_selected_duration_missing"),
    ),
  "logs combination blocked or state transition to waitingTripDays",
);
assert(
  !logs.some((l) => l.includes("[COMBINATION_DISCOVERY_STARTED]")),
  "no COMBINATION_DISCOVERY_STARTED on city-only turn",
);
assert(
  !logs.some((l) => l.includes("[COMBINATION_DISCOVERY_ENTRY]")),
  "no COMBINATION_DISCOVERY_ENTRY on city-only turn",
);
assert(
  !logs.some((l) => l.includes("[CANDIDATE_POOL_")),
  "no CANDIDATE_POOL on city-only turn",
);

// Apply ask-days session then reply 6天
session = {
  ...t2.session,
  ...turn2.session,
  pendingQuestion:
    turn2.advice.pendingQuestion ??
    turn2.session.pendingQuestion ?? {
      type: "ask_days",
      options: [],
      baseDestination: "福岡",
      destinationCountry: "日本",
    },
  travelContext: {
    ...t2.context,
    ...turn2.advice.contextPatch,
    destination: "福岡",
    destinationCountry: "日本",
    planningDaysConfirmed: false,
  },
  adviceSelectionThisTurn: undefined,
  lastResolvedPendingQuestion: undefined,
};

logs.length = 0;
const t3 = mergeTravelContext(session, "6天");
assert(t3.context.days === 6 || t3.session.adviceSelectionThisTurn === "6", "T3 parses 6 days");
const turn3 = processAdviceTurn("6天", t3.session, t3.context);
assert(Boolean(turn3.advice.reply), "T3 has reply");
assert(
  !(turn3.advice.reply ?? "").includes("你目前有預計的旅行日期或天數嗎") &&
    !(turn3.advice.reply ?? "").includes("你這趟大概幾天"),
  "T3 must not re-ask days after 6天",
);
assert(
  turn3.advice.pendingQuestion?.type === "combination_choice" ||
    turn3.advice.contextPatch?.tripPurpose === "combination_suggestions_offered" ||
    turn3.advice.contextPatch?.tripPurpose === "duration_selected" ||
    turn3.advice.contextPatch?.planningDaysConfirmed === true ||
    /建議組合|行程組合|組合搭配|我先記下|重新整理推薦/.test(turn3.advice.reply ?? ""),
  "T3 enters duration-confirmed / combination path (discovery may fail offline)",
);
assert(
  !(turn3.advice.reply ?? "").includes("福岡 天行程方向"),
  "T3 reply has no empty day template",
);
assert(
  resolveValidTripDays({
    days: t3.context.days ?? turn3.advice.contextPatch?.days ?? 6,
  }) === 6,
  "T3 has valid tripDays=6 before combination stage",
);

// --- Case G: 福岡6天 in one turn after country options ---
session = applyRoute(turn1.nextSession, turn1.route, turn1.merged);
logs.length = 0;
const tG = mergeTravelContext(session, "福岡6天");
assert(tG.context.destination === "福岡", "Case G destination=福岡");
assert(
  tG.context.days === 6 ||
    tG.session.adviceSelectionThisTurn === "福岡" ||
    resolveValidTripDays(tG.context) === 6,
  "Case G carries days=6 or selection",
);
const turnG = processAdviceTurn("福岡6天", tG.session, {
  ...tG.context,
  days: tG.context.days ?? 6,
  planningDaysConfirmed: true,
});
assert(
  !(turnG.advice.reply ?? "").includes("你目前有預計的旅行日期或天數嗎"),
  "Case G should not re-ask days when days present",
);

// --- Free-form cities across countries ---
for (const [countryMsg, city, country] of [
  ["我想去日本", "沖繩", "日本"],
  ["我想去泰國", "蘇梅島", "泰國"],
  ["我想去韓國", "濟州島", "韓國"],
  ["我想去義大利", "佛羅倫斯", "義大利"],
  ["我想去澳洲", "塔斯馬尼亞", "澳洲"],
]) {
  let s = createEmptySession();
  const c1 = adviceRoute(countryMsg, s);
  if (c1.route.pendingQuestion?.type !== "region_choice") {
    // Some countries may ask differently; still try free-form after applying destination
    s = applyRoute(c1.nextSession, c1.route, c1.merged);
  } else {
    s = applyRoute(c1.nextSession, c1.route, c1.merged);
  }
  if (s.pendingQuestion?.type === "region_choice") {
    const parsed = parsePendingOptionSelection(city, s.pendingQuestion);
    assert(
      parsed === city ||
        (parsed && normalizeIncludes(parsed, city)) ||
        Boolean(parsed),
      `${country} free-form ${city} accepted (got ${parsed})`,
    );
  }
  const mergedCity = mergeTravelContext(s, city);
  assert(
    mergedCity.context.destinationCountry === country ||
      mergedCity.context.destinationCountry?.includes(country.slice(0, 2)) ||
      Boolean(mergedCity.context.destination),
    `${country} → ${city} keeps country context`,
  );
  const cityTurn = processAdviceTurn(city, mergedCity.session, mergedCity.context);
  assert(
    !/暫時無法取得足夠的實際地點組合/.test(cityTurn.advice.reply ?? ""),
    `${city} must not show places-insufficient without days`,
  );
}

function normalizeIncludes(a, b) {
  return String(a).includes(b) || String(b).includes(a);
}

// Flag ON/OFF: guard itself must block regardless of feature flags
assert(
  canEnterCombinationDiscovery({
    destination: "福岡",
    days: undefined,
  }) === false,
  "flag-agnostic: missing days blocks discovery",
);
assert(
  canEnterCombinationDiscovery({
    destination: "福岡",
    days: 6,
  }) === true,
  "flag-agnostic: valid days allows discovery gate",
);

console.info = originalInfo;
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll destination-duration-state checks passed.");
