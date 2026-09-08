import assert from "node:assert/strict";
import {
  applyPlanningConstraintDelta,
  filterPlanningRejectedPlaces,
  hasUnresolvedPlanningCandidateContext,
  parsePlanningConstraintDelta,
  resolvePlanningCandidateContext,
  snapshotPlanningCandidates,
} from "../src/lib/ai/planning-conversation-constraints.ts";
import {
  collectExcludePlaceIds,
  extractLatestShownCandidatesFromMsgs,
} from "../src/lib/ai/chat-recommendation-refresh.ts";
import {
  auditPlannerRequiredAnchorEligibility,
  buildPlannerRequiredAnchors,
  filterExcludedPlaceIds,
} from "../src/lib/place-planning-memory.ts";
import { createItineraryFromSession } from "../src/lib/ai/ai-itinerary-state-machine.ts";
import {
  classifyItineraryGeographicScope,
  shouldReplaceItineraryWithRebuild,
} from "../src/lib/itinerary.functions.ts";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
} from "../src/lib/trip/itinerary-guards.ts";
import { composedPlansFromItineraryItems } from "../src/lib/ai/itinerary-validator/from-payload.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import {
  clearChatSession,
  createEmptySession,
  loadChatSession,
  saveChatSession,
} from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { applyTripIntentToSession } from "../src/lib/recommendation/trip-intent.ts";
import {
  adviceToAssistantChatMsg,
  applyAdviceResultToSession,
  logPlanningSuggestionEmit,
  persistPlanningShownCandidateContext,
} from "../src/lib/ai/destination-advice.ts";
import { resolvePlanningRequiredAnchorHandoff } from "../src/lib/ai/planning-required-anchor-handoff.ts";
import {
  attachWorkspaceIdsToSession,
  upsertDraftWorkspaceFromSession,
} from "../src/lib/conversation-workspace/sync.ts";
import { loadConversationWorkspace } from "../src/lib/conversation-workspace/storage.ts";
import { setCachedDiscoveredCombinations } from "../src/lib/ai/destination-combination-discovery.ts";
import {
  parseCombinationSelectionIndices,
  resolveSelectedCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";

const place = (id, name, type = "tourist_attraction") => ({
  id,
  googlePlaceId: id,
  name,
  placeName: name,
  type,
  lat: 25,
  lng: 121,
});
const shown = [
  place("p101", "台北101"),
  place("pck", "中正紀念堂"),
  place("plh", "龍山寺"),
  place("prao", "饒河夜市", "night_market"),
  place("pxy", "信義商圈", "shopping_mall"),
];
const base = {
  phase: "followup",
  recommendedPlaces: shown,
  selectedPlaces: [],
  tripDays: 2,
  tripDestination: { displayLabel: "台北", city: "台北" },
  travelContext: { destination: "台北", days: 2, interests: [], selectedCombinationIds: [1, 2] },
  updatedAt: new Date(0).toISOString(),
};

function makeStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

globalThis.window = globalThis;
globalThis.sessionStorage = makeStorage();
globalThis.localStorage = makeStorage();
Object.defineProperty(globalThis.navigator, "language", {
  configurable: true,
  value: "zh-TW",
});

const groundedIdByName = {
  台北101: "ChIJTaipei101PlanningCandidate",
  中正紀念堂: "ChIJChiangKaiShekPlanningCandidate",
  龍山寺: "ChIJLongshanPlanningCandidate",
  饒河夜市: "ChIJRaohePlanningCandidate",
  信義商圈: "ChIJXinyiPlanningCandidate",
};
const groundedTaipeiCombinations = [
  {
    combinationId: "taipei-landmarks",
    title: "經典地標組合",
    theme: "landmark",
    placeCandidates: [
      place("p101", "台北101"),
      place("pck", "中正紀念堂"),
      place("plh", "龍山寺"),
    ].map((candidate) => ({
      name: candidate.name,
      localizedDisplayName: candidate.name,
      googlePlaceId: groundedIdByName[candidate.name],
      searchCandidateId: groundedIdByName[candidate.name],
      coordinates: { lat: candidate.lat, lng: candidate.lng },
      address: `台北 ${candidate.name}`,
      types:
        candidate.name === "台北101" ? [candidate.type, "landmark"] : [candidate.type],
      primaryType: candidate.type,
      rating: candidate.name === "台北101" ? 4.6 : 4.4,
      userRatingCount: candidate.name === "台北101" ? 30_000 : 1_000,
    })),
  },
  {
    combinationId: "taipei-night-market",
    title: "夜市商圈組合",
    theme: "market",
    placeCandidates: [
      place("prao", "饒河夜市", "night_market"),
      place("pxy", "信義商圈", "shopping_mall"),
    ].map((candidate) => ({
      name: candidate.name,
      localizedDisplayName: candidate.name,
      googlePlaceId: groundedIdByName[candidate.name],
      searchCandidateId: groundedIdByName[candidate.name],
      coordinates: { lat: candidate.lat, lng: candidate.lng },
      address: `台北 ${candidate.name}`,
      types: [candidate.type],
      primaryType: candidate.type,
    })),
  },
];
setCachedDiscoveredCombinations("台北", groundedTaipeiCombinations);

const firstTurnText = "我要去台北2天";
const firstMerge = mergeTravelContext(createEmptySession(), firstTurnText);
const firstTurnSession = {
  ...firstMerge.session,
  activeChatIntent: "destination_advice",
  conversationMode: "destination_planning",
};
const firstTurn = processAdviceTurn(firstTurnText, firstTurnSession, firstMerge.context);
for (const candidate of shown) {
  assert.match(
    firstTurn.advice.reply ?? "",
    new RegExp(candidate.name),
    `real suggestion output contains ${candidate.name}`,
  );
}
const firstAssistantMessage = adviceToAssistantChatMsg(firstTurn.advice);
assert.equal(firstAssistantMessage.roamie?.recommendations?.length ?? 0, 0);
assert.equal(firstAssistantMessage.planningCandidateContext?.candidates.length, 5);
const generatedRound1Session = applyAdviceResultToSession(firstTurn.session, firstTurn.advice);
assert.equal(generatedRound1Session.activeShownCandidates?.length, 5);
assert.equal(generatedRound1Session.activeShownCandidates?.[0].source, "planning_suggestion");
assert.equal(
  generatedRound1Session.travelContext?.conversationState,
  "awaiting_combination_selection",
);

const firstTurnMessages = [
  { role: "user", content: firstTurnText },
  firstAssistantMessage,
];
assert.equal(extractLatestShownCandidatesFromMsgs(firstTurnMessages).length, 5);
saveChatSession(generatedRound1Session);
const storedRound1 = sessionStorage.getItem("roamie:chat-planning");
assert(storedRound1, "round-one planning session persisted");
clearChatSession();
sessionStorage.setItem("roamie:chat-planning", storedRound1);
const hydratedRound1 = loadChatSession();
assert.equal(hydratedRound1.activeShownCandidates?.length, 5);
const realCandidateContext = resolvePlanningCandidateContext(
  hydratedRound1,
  extractLatestShownCandidatesFromMsgs(firstTurnMessages),
);
assert.equal(realCandidateContext.source, "planning_suggestion");
assert.equal(realCandidateContext.persistedCandidateCount, 5);
assert.equal(realCandidateContext.candidates.length, 5);

function runPlanningTurn(session, text) {
  const merged = mergeTravelContext(applyTripIntentToSession(text, session), text);
  const preparedSession = {
    ...merged.session,
    activeChatIntent: "destination_advice",
    conversationMode: "destination_planning",
  };
  const turn = processAdviceTurn(text, preparedSession, merged.context);
  const assistantMessage = adviceToAssistantChatMsg(turn.advice);
  const nextSession = applyAdviceResultToSession(
    {
      ...turn.session,
      pendingQuestion: turn.route?.pendingQuestion,
      lastResolvedPendingQuestion: undefined,
      adviceSelectionThisTurn: undefined,
      lastAssistantReply: turn.advice.reply ?? session.lastAssistantReply,
    },
    turn.advice,
  );
  return { turn, assistantMessage, session: nextSession, context: merged.context };
}

// P24.5 real three-turn route: destination -> pending days -> structured suggestions.
const resumedTurn1 = runPlanningTurn(createEmptySession(), "我要去台北");
assert.equal(resumedTurn1.session.travelContext?.destination, "台北");
assert.equal(resumedTurn1.session.pendingQuestion?.type, "ask_days");
const resumedTurn2 = runPlanningTurn(resumedTurn1.session, "2天");
assert.match(resumedTurn2.turn.advice.reply ?? "", /台北101/);
assert.equal(resumedTurn2.turn.advice.planningSuggestionEntryPoint, "pending_resume");
assert.equal(resumedTurn2.turn.advice.contextPatch?.offeredCombinations?.length, 2);
assert.equal(resumedTurn2.turn.advice.planningShownCandidates?.length, 5);
assert.equal(resumedTurn2.assistantMessage.planningCandidateContext?.candidates.length, 5);
assert.equal(resumedTurn2.session.activeShownCandidates?.length, 5);
assert.equal(
  resumedTurn2.session.travelContext?.conversationState,
  "awaiting_combination_selection",
);

const resumedMessages = [
  { role: "user", content: "我要去台北" },
  resumedTurn1.assistantMessage,
  { role: "user", content: "2天" },
  resumedTurn2.assistantMessage,
];
saveChatSession(resumedTurn2.session);
const resumedStored = sessionStorage.getItem("roamie:chat-planning");
assert(resumedStored, "pending-resume planning session persisted");
clearChatSession();
sessionStorage.setItem("roamie:chat-planning", resumedStored);
const resumedHydrated = loadChatSession();
const resumedCandidateContext = resolvePlanningCandidateContext(
  resumedHydrated,
  extractLatestShownCandidatesFromMsgs(resumedMessages),
);
assert.equal(resumedCandidateContext.source, "planning_suggestion");
assert.equal(resumedCandidateContext.persistedCandidateCount, 5);
assert.equal(resumedCandidateContext.candidates.length, 5);

const emitLogs = [];
const originalConsoleInfo = console.info;
console.info = (...args) => emitLogs.push(args);
logPlanningSuggestionEmit(resumedTurn2.turn.advice, true);
console.info = originalConsoleInfo;
const pendingResumeEmit = emitLogs.find(([tag]) => tag === "[PLANNING_SUGGESTION_EMIT]");
assert(pendingResumeEmit, "pending resume suggestion emission logged");
assert.deepEqual(pendingResumeEmit[1], {
  entryPoint: "pending_resume",
  combinationCount: 2,
  candidateCount: 5,
  contextPersisted: true,
});
assert.equal(
  persistPlanningShownCandidateContext(firstTurn.advice, {
    ...firstTurn.session,
    workspaceId: "ws-restored",
  }).planningSuggestionEntryPoint,
  "restored_session",
);
assert.equal(
  persistPlanningShownCandidateContext(firstTurn.advice, {
    ...firstTurn.session,
    travelContext: {
      ...(firstTurn.session.travelContext ?? { interests: [] }),
      generationRequestId: "refresh_taipei_test",
    },
  }).planningSuggestionEntryPoint,
  "regenerate",
);
assert.equal(
  persistPlanningShownCandidateContext(firstTurn.advice, {
    ...firstTurn.session,
    pendingQuestion: {
      type: "ask_preference",
      options: ["重新整理推薦"],
      baseDestination: "台北",
    },
  }).planningSuggestionEntryPoint,
  "clarification_resume",
);

const resumedTurn3Delta = parsePlanningConstraintDelta({
  text: "不要101其他都可以",
  shownCandidates: resumedCandidateContext.candidates,
});
const resumedTurn3Session = applyPlanningConstraintDelta(
  resumedHydrated,
  resumedTurn3Delta,
  resumedCandidateContext.candidates,
);
assert.equal(resumedTurn3Delta.entityMatches?.[0]?.candidateIndex, 0);
assert.equal(resumedTurn3Session.planningConstraints.excludedPlaces.length, 1);
assert.equal(resumedTurn3Session.planningConstraints.acceptedCandidateIds.length, 4);
assert.deepEqual(
  resumedTurn3Session.selectedPlaces.map((candidate) => candidate.placeName ?? candidate.name),
  ["中正紀念堂", "龍山寺", "饒河夜市", "信義商圈"],
);

// Route B: duration first, destination second.
const reversedTurn1 = runPlanningTurn(createEmptySession(), "我要去2天");
assert.equal(reversedTurn1.session.tripDays ?? reversedTurn1.session.travelContext?.days, 2);
const reversedTurn2 = runPlanningTurn(reversedTurn1.session, "台北");
assert.equal(reversedTurn2.turn.advice.planningShownCandidates?.length, 5);
assert.equal(reversedTurn2.assistantMessage.planningCandidateContext?.candidates.length, 5);
const reversedContext = resolvePlanningCandidateContext(reversedTurn2.session);
const reversedDelta = parsePlanningConstraintDelta({
  text: "不要101其他都可以",
  shownCandidates: reversedContext.candidates,
});
const reversedSession = applyPlanningConstraintDelta(
  reversedTurn2.session,
  reversedDelta,
  reversedContext.candidates,
);
assert.equal(reversedSession.planningConstraints.rejectedCandidateIds.length, 1);
assert.equal(reversedSession.planningConstraints.acceptedCandidateIds.length, 4);

// Route C/D: duration wording and group references remain grounded after resume.
const overnightTurn1 = runPlanningTurn(createEmptySession(), "台北");
const overnightTurn2 = runPlanningTurn(overnightTurn1.session, "兩天一夜");
assert.equal(overnightTurn2.turn.advice.planningShownCandidates?.length, 5);
assert.deepEqual(parseCombinationSelectionIndices("第二組", 2), [1]);
const secondGroupTurn = runPlanningTurn(overnightTurn2.session, "第二組");
assert.deepEqual(secondGroupTurn.session.travelContext?.selectedCombinationIds, [2]);
const firstGroupRejected = parsePlanningConstraintDelta({
  text: "第一組不要",
  shownCandidates: resumedTurn2.session.activeShownCandidates,
});
assert.deepEqual(
  firstGroupRejected.excludedPlaces.map((candidate) => candidate.placeId),
  [
    groundedIdByName["台北101"],
    groundedIdByName["中正紀念堂"],
    groundedIdByName["龍山寺"],
  ],
);

// Route E/F: persisted workspace and cold session hydrate retain structured authority.
const resumedWorkspace = upsertDraftWorkspaceFromSession({
  session: resumedTurn2.session,
  messages: resumedMessages,
  hasPlusAccess: true,
});
assert(resumedWorkspace, "resume suggestion workspace persisted");
const workspaceBoundSession = attachWorkspaceIdsToSession(
  resumedTurn2.session,
  resumedWorkspace,
);
const foregroundWorkspace = loadConversationWorkspace(resumedWorkspace.workspaceId);
assert.equal(
  foregroundWorkspace?.planningSession?.activeShownCandidates?.length,
  5,
  "background/foreground retains candidate authority",
);
saveChatSession(workspaceBoundSession);
const coldSessionJson = sessionStorage.getItem("roamie:chat-planning");
assert(coldSessionJson);
clearChatSession();
sessionStorage.setItem("roamie:chat-planning", coldSessionJson);
const reopenedSession = loadChatSession();
assert.equal(reopenedSession.activeShownCandidates?.length, 5);
const reopenedWorkspace = loadConversationWorkspace(resumedWorkspace.workspaceId);
assert.equal(reopenedWorkspace?.planningSession?.activeShownCandidates?.length, 5);
const reopenedDelta = parsePlanningConstraintDelta({
  text: "不要101其他都可以",
  shownCandidates: resolvePlanningCandidateContext(reopenedSession).candidates,
});
assert.equal(reopenedDelta.excludedPlaces.length, 1);
assert.equal(reopenedDelta.acceptRemainingCandidates, true);

const realSecondTurnDelta = parsePlanningConstraintDelta({
  text: "不要101跟龍山寺，其他都可以",
  shownCandidates: realCandidateContext.candidates,
});
const realSecondTurnSession = applyPlanningConstraintDelta(
  hydratedRound1,
  realSecondTurnDelta,
  realCandidateContext.candidates,
);
assert.equal(realSecondTurnDelta.excludedPlaces.length, 2);
assert.deepEqual(realSecondTurnSession.planningConstraints.rejectedCandidateIds, [
  groundedIdByName["台北101"],
  groundedIdByName["龍山寺"],
]);
assert.deepEqual(realSecondTurnSession.planningConstraints.acceptedCandidateIds, [
  groundedIdByName["中正紀念堂"],
  groundedIdByName["饒河夜市"],
  groundedIdByName["信義商圈"],
]);
assert.equal(realSecondTurnSession.selectedPlaces.length, 3);
assert.deepEqual(
  parsePlanningConstraintDelta({
    text: "第一組不要",
    shownCandidates: realCandidateContext.candidates,
  }).excludedPlaces.map((candidate) => candidate.placeId),
  [
    groundedIdByName["台北101"],
    groundedIdByName["中正紀念堂"],
    groundedIdByName["龍山寺"],
  ],
);
assert.deepEqual(
  parsePlanningConstraintDelta({
    text: "夜市那組不要",
    shownCandidates: realCandidateContext.candidates,
  }).excludedPlaces.map((candidate) => candidate.placeId),
  [groundedIdByName["饒河夜市"], groundedIdByName["信義商圈"]],
);
assert.deepEqual(parseCombinationSelectionIndices("第一組", 2), [0]);
assert.deepEqual(parseCombinationSelectionIndices("我要第二組", 2), [1]);
assert.deepEqual(resolveSelectedCombinations("台北", "夜市那組")?.indexes, [1]);
assert.deepEqual(resolveSelectedCombinations("台北", "經典地標那組")?.indexes, [0]);

const parse = (text, extra = {}) =>
  parsePlanningConstraintDelta({ text, shownCandidates: shown, ...extra });
const apply = (text, session = base) => {
  const delta = parse(text);
  return { delta, session: applyPlanningConstraintDelta(session, delta, shown) };
};

for (const text of [
  "不要101其他都可以",
  "101不要其他都行",
  "除了101其他都可以",
  "台北101不用",
  "101我去過了",
  "第一個不要其他都可以",
  "不要第一個",
]) {
  const result = apply(text);
  assert.deepEqual(result.session.planningConstraints.rejectedCandidateIds, ["p101"], text);
  if (/都可以|都行/.test(text))
    assert.equal(result.session.selectedPlaces.length, 4, `${text}: keep remaining`);
}
assert.equal(
  parsePlanningConstraintDelta({
    text: "這個不要",
    shownCandidates: [shown[0]],
  }).excludedPlaces[0].placeId,
  "p101",
);
const mixedDelta = parse("不要101，但華山也幫我加進去");
assert.equal(mixedDelta.excludedPlaces[0].placeId, "p101");
assert.deepEqual(mixedDelta.unresolvedEntities, ["華山"]);
assert.deepEqual(
  mixedDelta.mustIncludePlaces.filter((place) => !place.resolved).map((place) => place.rawMention),
  ["華山"],
);

for (const text of [
  "不要101跟龍山寺其他都可以",
  "不要101和龍山寺其他都可以",
  "不要101、龍山寺，其他都可以",
  "101跟龍山寺都不要",
  "101、龍山寺不要",
  "除了101跟龍山寺其他都行",
]) {
  const result = apply(text);
  assert.deepEqual(
    result.delta.excludedPlaces.map((candidate) => candidate.placeId),
    ["p101", "plh"],
    `${text}: excludes both named candidates`,
  );
  if (/其他都|其他的都|其餘都|其余都/.test(text)) {
    assert.deepEqual(
      result.session.planningConstraints.acceptedCandidateIds,
      ["pck", "prao", "pxy"],
      `${text}: accepts only the remaining candidates`,
    );
  }
}
assert.deepEqual(
  parse("不要第一個跟第三個").excludedPlaces.map((candidate) => candidate.placeId),
  ["p101", "plh"],
  "multiple ordinal references are processed iteratively",
);
const mixedMultiDelta = parse("不要101跟龍山寺，但華山幫我加進去");
assert.deepEqual(
  mixedMultiDelta.excludedPlaces.map((candidate) => candidate.placeId),
  ["p101", "plh"],
);
assert.deepEqual(mixedMultiDelta.unresolvedEntities, ["華山"]);
assert.deepEqual(
  mixedMultiDelta.mustIncludePlaces.filter((place) => !place.resolved).map((place) => place.rawMention),
  ["華山"],
);

// Runtime-shaped two-round flow: shown set is persisted independently of active loading state.
const persistedRound1 = JSON.parse(
  JSON.stringify({
    ...base,
    phase: "followup",
    recommendedPlaces: [],
    activeShownCandidates: shown,
    chatPlanningState: "idle",
    activeRecommendationContext: undefined,
  }),
);
const candidateContext = resolvePlanningCandidateContext(persistedRound1, []);
assert.equal(candidateContext.source, "active_shown_candidates");
assert.equal(candidateContext.candidates.length, 5);
const circularCandidate = { ...shown[0] };
circularCandidate.runtime = { candidates: [circularCandidate] };
const candidateSnapshot = snapshotPlanningCandidates([circularCandidate]);
assert.doesNotThrow(() => JSON.stringify(candidateSnapshot));
assert.equal("runtime" in candidateSnapshot[0], false);
const runtimeDelta = parsePlanningConstraintDelta({
  text: "不要101跟龍山寺其他都可以",
  shownCandidates: candidateContext.candidates,
});
const persistedRound2 = applyPlanningConstraintDelta(
  persistedRound1,
  runtimeDelta,
  candidateContext.candidates,
);
assert.equal(runtimeDelta.excludedPlaces.length, 2);
assert.deepEqual(persistedRound2.planningConstraints.rejectedCandidateIds, ["p101", "plh"]);
assert.deepEqual(persistedRound2.planningConstraints.acceptedCandidateIds, ["pck", "prao", "pxy"]);
const plannerAnchors = filterPlanningRejectedPlaces(
  persistedRound2.selectedPlaces,
  persistedRound2,
);
assert.equal(plannerAnchors.length, 3);
assert(!plannerAnchors.some((candidate) => candidate.googlePlaceId === "p101"));
assert(!plannerAnchors.some((candidate) => candidate.googlePlaceId === "plh"));
const discoveryPool = filterExcludedPlaceIds(
  [place("p101", "台北101"), place("pnew", "華山1914文化創意產業園區")],
  collectExcludePlaceIds(persistedRound2),
);
assert(!discoveryPool.some((candidate) => candidate.googlePlaceId === "p101"));
const huashan = parse("還要去華山幫我安排在一起");
assert.deepEqual(huashan.unresolvedEntities, ["華山"]);
assert.equal(huashan.intent, "modify_trip");
const twoAnchors = parse("想去華山跟松菸");
assert.deepEqual(twoAnchors.unresolvedEntities, ["華山", "松菸"]);
assert.equal(twoAnchors.clarificationRequired, true);

const oneAnchorSession = applyPlanningConstraintDelta(base, parse("只想去台北101"), shown);
assert.equal(oneAnchorSession.selectedPlaces.length, 1, "one must-include remains a valid anchor");
const oneAccepted = applyPlanningConstraintDelta(
  base,
  {
    intent: "modify_trip",
    confidence: "high",
    changedFields: ["mustIncludePlaces"],
    acceptRemainingCandidates: false,
    mustIncludePlaces: [
      { rawMention: "台北101", placeId: "p101", canonicalName: "台北101", resolved: true },
    ],
  },
  shown,
);
assert.equal(
  oneAccepted.selectedPlaces.length,
  1,
  "one accepted candidate persists for planner supplement",
);

for (const [text, expected] of [
  ["晚上想吃燒肉", "燒肉"],
  ["想找壽司", "壽司"],
  ["拉麵也幫我安排", "拉麵"],
])
  assert(parse(text).cuisinePreferences.includes(expected), text);
assert(parse("第一次去台北有什麼必去").attractionPreferences.includes("必去"));
assert(parse("想看夜景").attractionPreferences.includes("夜景"));
assert(parse("不要夜市").excludedPlaceTypes.includes("market_category"));
assert(parse("不要寺廟").excludedPlaceTypes.includes("shrine_temple_category"));
assert(parse("不要太觀光").excludedPlaceTypes.includes("touristy"));
assert.equal(parse("不要排太趕").pace, "relaxed");
assert.equal(parse("不是兩天，是三天").correctedDays, 3);
assert.equal(parse("第一個不要").excludedPlaces[0].placeId, "p101");
assert.equal(
  parsePlanningConstraintDelta({ text: "這個不要", activePlace: shown[1] }).excludedPlaces[0]
    .placeId,
  "pck",
);
assert.notEqual(parse("想吃好吃的").intent, "not_planning");
assert.equal(parse("想去那個很有名的塔").unresolvedEntities.length, 1);
assert.notEqual(parse("幫我排得有鬆有緊").intent, "not_planning");

const accumulated1 = apply("不要101").session;
const accumulated2 = applyPlanningConstraintDelta(accumulated1, parse("晚上想吃居酒屋"), shown);
assert(
  accumulated2.planningConstraints.excludedPlaces.length === 1 &&
    accumulated2.planningConstraints.cuisinePreferences.includes("居酒屋"),
  "constraints accumulate and persist in session JSON",
);
assert(
  JSON.parse(JSON.stringify(accumulated2)).planningConstraints.cuisinePreferences.includes(
    "居酒屋",
  ),
);
assert.equal(
  "planningConstraints" in (accumulated2.userProfile ?? {}),
  false,
  "trip constraints do not mutate Plus profile",
);

const source = await import("node:fs").then((fs) =>
  fs.readFileSync("src/routes/_app.chat.tsx", "utf8"),
);
assert.match(source, /beginItineraryGenerationCredits/);
assert.match(source, /PLANNING_RECOVERY/);
assert.match(source, /logPlanningParseFailure/);
assert.match(source, /\[CHAT_SEND_ERROR\]/);
assert.match(source, /setStreaming\(false\)[\s\S]{0,160}setGenerating\(false\)/);
assert.match(source, /settled:\s*true/);
assert.doesNotMatch(source, /planning-conversation-constraints[\s\S]{0,200}useServerFn/);
assert.match(
  source,
  /selectedCombinationIds:\s*\[\]/,
  "conversational anchors do not inherit Selection Mode allowlist",
);
assert.match(source, /excludedPlaceIds:\s*rejectedCandidateIds/);
assert.match(source, /candidate_context_missing/);
assert.match(source, /generationContinued:\s*false/);
assert.match(source, /PLANNING_CANDIDATE_CONTEXT_WRITE/);
assert.match(source, /planningSuggestionEntryPoint/);

const missingContextDelta = parsePlanningConstraintDelta({
  text: "不要101其他都可以",
  shownCandidates: [],
});
const missingContextSession = applyPlanningConstraintDelta(
  {
    ...base,
    recommendedPlaces: [],
    activeShownCandidates: [],
    selectedPlaces: [shown[0]],
  },
  missingContextDelta,
  [],
);
assert.equal(missingContextDelta.acceptRemainingCandidates, true);
assert.equal(missingContextSession.planningConstraints.acceptedCandidateIds.length, 0);
assert.equal(hasUnresolvedPlanningCandidateContext(missingContextDelta, 0), true);
const blockedLegacyHandoff = resolvePlanningRequiredAnchorHandoff({
  session: {
    ...missingContextSession,
    planningConstraints: {
      ...missingContextSession.planningConstraints,
      clarificationRequired: true,
    },
  },
  candidateRequiredPlaces: [shown[0]],
  selectionMode: false,
});
assert.equal(blockedLegacyHandoff.legacyFallbackBlocked, true);
assert.equal(blockedLegacyHandoff.finalRequiredCount, 0);
assert.equal(blockedLegacyHandoff.supplementalPlaces.length, 1);

const invariantCandidates = shown.map((candidate, index) => ({
  ...candidate,
  id: `ChIJRuntimeCandidate${index + 1}`,
  placeId: `ChIJRuntimeCandidate${index + 1}`,
  googlePlaceId: `ChIJRuntimeCandidate${index + 1}`,
  address: `台北市測試地址 ${index + 1}`,
  lat: 25.03 + index / 1000,
  lng: 121.53 + index / 1000,
}));
invariantCandidates.push({
  ...place("pnew", "華山1914文化創意產業園區"),
  id: "ChIJRuntimeCandidate6",
  placeId: "ChIJRuntimeCandidate6",
  googlePlaceId: "ChIJRuntimeCandidate6",
  address: "台北市測試地址 6",
  lat: 25.036,
  lng: 121.536,
});
const excludedInvariantIds = [
  invariantCandidates[0].googlePlaceId,
  invariantCandidates[2].googlePlaceId,
];
const legalInvariantCandidates = invariantCandidates.filter(
  (candidate) => !excludedInvariantIds.includes(candidate.googlePlaceId),
);
const invariantSession = {
  ...persistedRound2,
  selectedPlaces: legalInvariantCandidates,
  plannedStops: legalInvariantCandidates,
  travelContext: {
    ...persistedRound2.travelContext,
    selectedCombinationIds: [],
  },
  planningConstraints: {
    ...persistedRound2.planningConstraints,
    acceptedCandidateIds: legalInvariantCandidates.map((candidate) => candidate.googlePlaceId),
    rejectedCandidateIds: excludedInvariantIds,
    excludedPlaces: excludedInvariantIds.map((placeId, index) => ({
      rawMention: index === 0 ? "台北101" : "龍山寺",
      canonicalName: index === 0 ? "台北101" : "龍山寺",
      placeId,
      resolved: true,
    })),
  },
};
const finalInvariantResult = await createItineraryFromSession({
  session: invariantSession,
  generateInput: {
    destination: "台北",
    days: 2,
    budget: "medium",
    style: "",
    mood: "",
    interests: "",
    conversationSummary: "",
    startDate: "2026-09-06",
    endDate: "2026-09-07",
    origin: "",
    transport: "",
    selectedPlaces: invariantCandidates,
    selectedCombinationIds: [],
    nearbyExtensions: [],
    excludedCategories: [],
    excludedPlaceIds: excludedInvariantIds,
    fashionStyle: "",
  },
  generateItineraryFn: async () => ({
    success: true,
    trip: {
      payload: {
        version: 2,
        title: "台北 2 天",
        summary: "",
        moodTag: "",
        destination: "台北",
        days: 2,
        recommendations: invariantCandidates,
        itinerary: invariantCandidates.map((candidate, index) => ({
          title: candidate.name,
          placeName: candidate.name,
          googlePlaceId: candidate.googlePlaceId,
          date: index < 3 ? "2026-09-06" : "2026-09-07",
          dayIndex: index < 3 ? 0 : 1,
          time: "10:00",
          duration: "1 小時",
          address: candidate.address,
          lat: candidate.lat,
          lng: candidate.lng,
        })),
        generatedAt: new Date(0).toISOString(),
      },
      destination: "台北",
      days: 2,
      itinerary: [],
    },
  }),
});
assert.equal(finalInvariantResult.ok, true);
assert(
  !coalesceItineraryItems(finalInvariantResult.payload.itinerary).some(
    (stop) => excludedInvariantIds.includes(stop.googlePlaceId),
  ),
  "final itinerary multi-exclusion invariant",
);
const realPlannerExcludedIds =
  realSecondTurnSession.planningConstraints.rejectedCandidateIds;
const realPlannerCandidates = [
  ...realCandidateContext.candidates,
  {
    ...place("ChIJHuashanPlanningSupplement", "華山1914文化創意產業園區"),
    placeId: "ChIJHuashanPlanningSupplement",
    address: "台北市中正區八德路一段1號",
    description: "",
    reason: "",
    estimatedTime: "1 小時",
    googleMapsUrl: "",
    placeName: "華山1914文化創意產業園區",
    reasonSource: "template",
  },
];
const realPlannerResult = await createItineraryFromSession({
  session: {
    ...realSecondTurnSession,
    selectedPlaces: realPlannerCandidates.filter(
      (candidate) => !realPlannerExcludedIds.includes(candidate.googlePlaceId),
    ),
    plannedStops: realPlannerCandidates.filter(
      (candidate) => !realPlannerExcludedIds.includes(candidate.googlePlaceId),
    ),
  },
  generateInput: {
    destination: "台北",
    days: 2,
    budget: "medium",
    style: "",
    mood: "",
    interests: "",
    conversationSummary: "",
    startDate: "2026-09-06",
    endDate: "2026-09-07",
    origin: "",
    transport: "",
    selectedPlaces: realPlannerCandidates,
    selectedCombinationIds: [],
    nearbyExtensions: [],
    excludedCategories: [],
    excludedPlaceIds: realPlannerExcludedIds,
    fashionStyle: "",
  },
  generateItineraryFn: async () => ({
    success: true,
    trip: {
      payload: {
        version: 2,
        title: "台北 2 天",
        summary: "",
        moodTag: "",
        destination: "台北",
        days: 2,
        recommendations: realPlannerCandidates,
        itinerary: realPlannerCandidates.map((candidate, index) => ({
          title: candidate.name,
          description: "",
          placeName: candidate.name,
          googlePlaceId: candidate.googlePlaceId,
          date: index < 3 ? "2026-09-06" : "2026-09-07",
          dayIndex: index < 3 ? 0 : 1,
          time: "10:00",
          duration: "1 小時",
          address: candidate.address,
          lat: candidate.lat,
          lng: candidate.lng,
        })),
        generatedAt: new Date(0).toISOString(),
      },
      destination: "台北",
      days: 2,
      itinerary: [],
    },
  }),
});
assert.equal(realPlannerResult.ok, true);
assert.equal(realPlannerExcludedIds.length, 2);
assert(
  !coalesceItineraryItems(realPlannerResult.payload.itinerary).some((stop) =>
    realPlannerExcludedIds.includes(stop.googlePlaceId),
  ),
  "P24.3 real two-turn final itinerary excludes 101 and 龍山寺",
);

// P24.4 real two-turn authority handoff: discovery/stale selected places may
// supplement planning, but only accepted candidates become required anchors.
const p244Delta = parsePlanningConstraintDelta({
  text: "不要101其他都可以",
  shownCandidates: resumedCandidateContext.candidates,
});
const p244Session = applyPlanningConstraintDelta(
  resumedHydrated,
  p244Delta,
  resumedCandidateContext.candidates,
);
const p244ExpectedRequired = ["中正紀念堂", "龍山寺", "饒河夜市", "信義商圈"];
const p244ForbiddenRequired = [
  "台北101",
  "幾米月亮公車",
  "象山公園",
  "四四南村",
  "臺北眷村文物館",
];
assert.equal(p244Session.planningConstraints.acceptedCandidateIds.length, 4);
assert.equal(p244Session.planningConstraints.excludedPlaces.length, 1);
assert.deepEqual(
  p244Session.planningConstraints.acceptedCandidateIds,
  p244ExpectedRequired.map((name) => groundedIdByName[name]),
);

const stalePlannerSelected = [
  {
    ...resumedCandidateContext.candidates[1],
    name: "國立中正紀念堂",
    placeName: "國立中正紀念堂",
  },
  {
    ...resumedCandidateContext.candidates[0],
    name: "台北101",
    placeName: "台北101",
  },
  place("ChIJJimmyMoonBusStale", "幾米月亮公車"),
  place("ChIJELEPHANTMountainStale", "象山公園"),
  place("ChIJFortyFourSouthVillageStale", "四四南村"),
  place("ChIJTaipeiMilitaryVillageStale", "臺北眷村文物館"),
];
let p244PlannerInput;
const p244Result = await createItineraryFromSession({
  session: {
    ...p244Session,
    selectedPlaces: stalePlannerSelected,
    plannedStops: stalePlannerSelected,
    recommendedPlaces: stalePlannerSelected,
  },
  generateInput: {
    destination: "台北",
    days: 2,
    budget: "medium",
    style: "",
    mood: "",
    interests: "",
    conversationSummary: "",
    startDate: "2026-09-06",
    endDate: "2026-09-07",
    origin: "",
    transport: "",
    selectedPlaces: stalePlannerSelected,
    selectedCombinationIds: [],
    nearbyExtensions: [],
    excludedCategories: [],
    excludedPlaceIds: p244Session.planningConstraints.rejectedCandidateIds,
    fashionStyle: "",
  },
  generateItineraryFn: async ({ data }) => {
    p244PlannerInput = data;
    return {
      success: true,
      trip: {
        payload: {
          version: 2,
          title: "台北 2 天",
          summary: "",
          moodTag: "",
          destination: "台北",
          days: 2,
          recommendations: data.selectedPlaces,
          itinerary: data.selectedPlaces.map((candidate, index) => ({
            title: candidate.name,
            description: "",
            placeName: candidate.name,
            googlePlaceId: candidate.googlePlaceId,
            date: index < 2 ? "2026-09-06" : "2026-09-07",
            dayIndex: index < 2 ? 0 : 1,
            time: index % 2 ? "14:00" : "10:00",
            duration: "1 小時",
            address: candidate.address,
            lat: candidate.lat,
            lng: candidate.lng,
          })),
          generatedAt: new Date(0).toISOString(),
        },
        destination: "台北",
        days: 2,
        itinerary: [],
      },
    };
  },
});
assert(p244PlannerInput, "P24.4 planner input captured");
const p244RequiredPlannerPlaces = p244PlannerInput.selectedPlaces.filter(
  (candidate) => candidate.isRequiredBySelection !== false,
);
const p244SupplementalPlannerPlaces = p244PlannerInput.selectedPlaces.filter(
  (candidate) => candidate.isRequiredBySelection === false,
);
assert.equal(p244RequiredPlannerPlaces.length, 4);
assert(p244SupplementalPlannerPlaces.length > 0, "P27 conversational planner receives supplements");
assert.deepEqual(
  p244RequiredPlannerPlaces.map((candidate) => candidate.placeName ?? candidate.name),
  p244ExpectedRequired,
);
assert.equal(p244PlannerInput.excludedPlaceIds.length, 1);
assert(
  !p244RequiredPlannerPlaces.some((candidate) =>
    p244PlannerInput.excludedPlaceIds.includes(candidate.googlePlaceId),
  ),
  "P24.4 requiredPlaceIds and excludedPlaceIds are disjoint",
);
assert(
  !p244RequiredPlannerPlaces.some((candidate) =>
    p244ForbiddenRequired.includes(candidate.placeName ?? candidate.name),
  ),
  "P24.4 discovery/stale candidates are not promoted to required anchors",
);
assert.equal(p244Result.ok, true);
const p244FinalNames = coalesceItineraryItems(p244Result.payload.itinerary).map(
  (stop) => stop.placeName ?? stop.title,
);
for (const required of p244ExpectedRequired)
  assert(p244FinalNames.includes(required), `P24.4 final itinerary keeps ${required}`);

for (const acceptedCount of [1, 2, 4]) {
  const acceptedCandidateIds = p244Session.planningConstraints.acceptedCandidateIds.slice(
    0,
    acceptedCount,
  );
  const handoff = resolvePlanningRequiredAnchorHandoff({
    session: {
      ...p244Session,
      planningConstraints: {
        ...p244Session.planningConstraints,
        acceptedCandidateIds,
      },
    },
    candidateRequiredPlaces: stalePlannerSelected,
    selectionMode: false,
    additionalExcludedPlaceIds: p244Session.planningConstraints.rejectedCandidateIds,
  });
  assert.equal(handoff.finalRequiredCount, acceptedCount);
  assert(handoff.supplementalPlaces.length > 0);
  assert.equal(handoff.overlapCount, 0);
}
assert.equal(
  classifyItineraryGeographicScope({ address: "台北市中正區" }, "台北"),
  "in_scope",
);
assert.equal(
  classifyItineraryGeographicScope({ address: "基隆市仁愛區" }, "台北"),
  "out_of_scope",
);
assert.equal(
  classifyItineraryGeographicScope({ address: "仁愛路" }, "台北"),
  "unknown",
);
for (const locality of ["台北市", "臺北市", "信義區", "中正區", "萬華區"]) {
  assert.equal(
    classifyItineraryGeographicScope({ sourceRegionCandidate: locality }, "台北"),
    "unknown",
    `${locality} search provenance is not treated as place locality`,
  );
}
assert.equal(
  classifyItineraryGeographicScope({ sourceRegionCandidate: "基隆市" }, "台北市"),
  "unknown",
);
assert.equal(
  shouldReplaceItineraryWithRebuild(
    { populatedDayCount: 2, requiredCoverageCount: 2, blockingFailedRuleCount: 2, totalValidEntryCount: 2 },
    { populatedDayCount: 0, requiredCoverageCount: 0, blockingFailedRuleCount: 3, totalValidEntryCount: 0 },
  ),
  false,
);
assert.equal(
  shouldReplaceItineraryWithRebuild(
    { populatedDayCount: 1, requiredCoverageCount: 1, blockingFailedRuleCount: 2, totalValidEntryCount: 2 },
    { populatedDayCount: 2, requiredCoverageCount: 2, blockingFailedRuleCount: 0, totalValidEntryCount: 4 },
  ),
  true,
);
const p31Required = [
  { ...place("ChIJP31LongshanRequired", "龍山寺"), isRequiredBySelection: true, sourceRegionCandidate: "萬華區" },
  { ...place("ChIJP31RaoheRequired", "饒河夜市", "night_market"), isRequiredBySelection: true, sourceRegionCandidate: "松山區" },
  { ...place("ChIJP31XinyiRequired", "信義商圈", "shopping_mall"), isRequiredBySelection: true, sourceRegionCandidate: "信義區" },
];
const p31SupplementalNames = [
  "台北當代藝術館", "象山步道", "剝皮寮歷史街區", "松山文創園區", "大安森林公園", "國立故宮博物院",
];
const p31Supplemental = ["中正區", "信義區", "萬華區", "松山區", "大安區", "士林區"].map(
  (locality, index) => ({
    ...place(`ChIJP31Supplement${index}`, p31SupplementalNames[index]),
    lat: 25.01 + index * 0.01,
    lng: 121.51 + index * 0.01,
    isRequiredBySelection: false,
    sourceRegionCandidate: locality,
  }),
);
const p31EligibleSupplemental = p31Supplemental.filter(
  (candidate) => classifyItineraryGeographicScope(candidate, "台北") !== "out_of_scope",
);
assert.equal(p31EligibleSupplemental.length, 6);
const p31ServerRequired = buildPlannerRequiredAnchors(p31Required, "台北", true);
assert.equal(p31ServerRequired.length, 3);
const p31Stops = buildFallbackItineraryFromPlaces(
  [...p31ServerRequired, ...p31EligibleSupplemental],
  2,
  "2026-09-07",
  "台北",
);
const p31Plans = composedPlansFromItineraryItems(p31Stops, 2, "2026-09-07");
assert.equal(p31Plans.length, 2);
assert.equal(p31Plans.filter((plan) => plan.entries.length >= 2).length, 2);
const p31StopIds = new Set(p31Stops.map((stop) => stop.googlePlaceId));
assert.equal(p31ServerRequired.filter((candidate) => p31StopIds.has(candidate.googlePlaceId)).length, 3);
const p31FinalValidation = validateItineraryPlan({
  plans: p31Plans,
  requestedDays: 2,
  destination: "台北",
  creationPath: "direct",
});
assert.deepEqual(p31FinalValidation.failedRules.map((rule) => rule.code), []);
const eligibilityUnknown = auditPlannerRequiredAnchorEligibility(
  [{ ...shown[1], businessStatus: undefined }],
  "台北",
);
assert.equal(eligibilityUnknown.eligibleRequiredCount, 1);
assert.equal(eligibilityUnknown.rejectedRequiredCount, 0);
const eligibilityDuplicate = auditPlannerRequiredAnchorEligibility(
  [shown[1], { ...shown[1] }],
  "台北",
);
assert.equal(eligibilityDuplicate.eligibleRequiredCount, 1);
assert.equal(eligibilityDuplicate.rejectionReasonCounts.duplicate, 1);
const explicitAcceptedAnchors = buildPlannerRequiredAnchors(shown.slice(1), "台北", true);
assert.equal(explicitAcceptedAnchors.length, 4);
assert(explicitAcceptedAnchors.some((candidate) => candidate.name === "信義商圈"));
for (const forbidden of p244ForbiddenRequired)
  assert(!p244FinalNames.includes(forbidden), `P24.4 final itinerary excludes ${forbidden}`);

console.info("[verify:p24-conversational-planning] OK (P24-P24.5)");
console.info("[verify:p24.1-runtime-exclusion] OK");
console.info("[verify:p24.2-multi-exclusion] OK");
console.info("[verify:p24.3-planning-candidate-authority] OK");
console.info("[verify:p24.4-required-anchor-handoff] OK");
console.info("[verify:p24.5-multi-turn-candidate-persistence] OK");
