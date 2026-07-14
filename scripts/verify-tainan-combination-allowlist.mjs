/**
 * Acceptance: 台南 3 天 → 組合 → 選 1、2、4 → allowlist 排除安平港區
 * No chat place cards during generation; no session: place ids in mapped output.
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  buildCombinationSelectionAllowlist,
  isPlaceNameInCombinationAllowlist,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { isResolvedGooglePlace } from "../src/lib/ai/planning-real-place.ts";
import { isGooglePlaceId } from "../src/lib/place-detail-handoff.ts";

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
  return { route, turn, merged, session: persisted, advice: turn.advice };
}

console.log("=== 台南 3 天 選 1、2、4 ===\n");

let session = createEmptySession();
let t1 = planningTurn("台南3天", session);
assert(/古蹟文化|巷弄美食|安平港區|文創近郊/.test(t1.advice.reply ?? ""), "shows combinations");
assert(t1.session.pendingQuestion?.type === "combination_choice", "pending combination_choice");

session = t1.session;
let t2 = planningTurn("1、2、4", session);
assert(t2.advice.triggerItineraryGeneration === true, "triggers itinerary generation");
assert(!(t2.advice.recommendations?.length > 0), "no place cards during generation advice");
assert(!/第\s*1\s*天|Day\s*1/i.test(t2.advice.reply ?? ""), "no Day1 draft in chat reply");
assert(/正在整理並規劃中/.test(t2.advice.reply ?? ""), "generating status copy");

const allowlist = buildCombinationSelectionAllowlist("台南", "1、2、4");
assert(Boolean(allowlist), "allowlist built");
assert(
  JSON.stringify(allowlist?.selectedCombinationIds) === JSON.stringify([1, 2, 4]),
  `selectedCombinationIds=${JSON.stringify(allowlist?.selectedCombinationIds)}`,
);
assert(
  allowlist?.allowedPlaceNames.includes("赤崁樓") === true,
  "allows 赤崁樓 from combo 1",
);
assert(
  allowlist?.exclusiveExcludedPlaceNames.includes("安平古堡") === true,
  "excludes 安平古堡 exclusive to combo 3",
);
assert(
  allowlist?.exclusiveExcludedPlaceNames.includes("億載金城") === true,
  "excludes 億載金城 exclusive to combo 3",
);
assert(
  allowlist?.exclusiveExcludedPlaceNames.includes("安平老街") === true,
  "excludes 安平老街 exclusive to combo 3",
);
assert(
  isPlaceNameInCombinationAllowlist("安平古堡", allowlist) === false,
  "安平古堡 not in allowlist",
);
assert(
  isPlaceNameInCombinationAllowlist("赤崁樓", allowlist) === true,
  "赤崁樓 in allowlist",
);

const patch = t2.advice.contextPatch;
assert(
  Array.isArray(patch?.selectedCombinationIds) &&
    patch.selectedCombinationIds.join(",") === "1,2,4",
  `contextPatch selectedCombinationIds=${JSON.stringify(patch?.selectedCombinationIds)}`,
);
assert(
  Array.isArray(patch?.selectedCombinationPlaceNames) &&
    patch.selectedCombinationPlaceNames.includes("赤崁樓") &&
    !patch.selectedCombinationPlaceNames.includes("安平古堡"),
  "contextPatch place names exclude Anping-only",
);

assert(
  isResolvedGooglePlace({
    googlePlaceId: "session:foo",
    name: "赤崁樓",
    lat: 23,
    lng: 120,
  }) === false,
  "rejects session: placeId",
);
assert(
  isResolvedGooglePlace({
    googlePlaceId: "ChIJbYl7d2F2BjQRnFdvyMBuZfI",
    name: "赤崁樓",
    lat: 22.997,
    lng: 120.202,
  }) === true,
  "accepts real Google placeId",
);
assert(isGooglePlaceId("session:abc") === false, "isGooglePlaceId rejects session:");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Tainan 1,2,4 acceptance checks passed.");
