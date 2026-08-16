#!/usr/bin/env node
/**
 * Cafe / place-recommendation must beat trip-duration / combination flow.
 * Acceptance cases 1–10 + trip-planning still works for explicit itinerary asks.
 */
import assert from "node:assert/strict";
import {
  parsePlaceRecommendationIntent,
  hasExplicitPlaceRecommendationIntent,
} from "../src/lib/ai/place-recommendation-intent/parse.ts";
import { hasCategoryPlaceQuery } from "../src/lib/ai/chat-place-category-types.ts";
import {
  shouldFetchDestinationCategoryPlaces,
  parseChatPlaceIntents,
} from "../src/lib/ai/chat-place-intent.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import { resolveChatContextIntent, isCreateItineraryIntent } from "../src/lib/ai/chat-context-intent.ts";
import { isTravelPlanningText, routeUserIntent } from "../src/lib/ai/chat-intent-router.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { buildPlanningOfflineReply } from "../src/lib/ai/chat-turn-engine.ts";
import { shouldAskTripDuration } from "../src/lib/ai/ai-trip-style.ts";
import {
  mergeTripPlanningContext,
  resolveConversationMode,
} from "../src/lib/ai/trip-planning-context.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { isComboItineraryQuery } from "../src/lib/ai/chat-category-place-guard.ts";
import { extractProvisionalDestinationAreaCandidate } from "../src/lib/ai/destination-travel-profile.ts";
import { resolveDestinationForCategorySearch } from "../src/lib/ai/chat-category-destination.ts";

function baseSession(overrides = {}) {
  return {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
    travelContext: { interests: [] },
    ...overrides,
  };
}

const CAFE_CASES = [
  { text: "台南有什麼咖啡廳推薦嗎", dest: "台南", features: [] },
  { text: "高雄有安靜咖啡廳嗎", dest: "高雄", features: ["quiet"] },
  { text: "台北有插座咖啡廳嗎", dest: "台北", features: ["power_outlet"] },
  { text: "東京有不限時咖啡廳嗎", dest: "東京", features: ["no_time_limit"] },
  { text: "首爾有景觀咖啡廳嗎", dest: "首爾", features: ["view"] },
  { text: "大阪有甜點咖啡廳嗎", dest: "大阪", features: ["dessert"] },
  { text: "巴黎有咖啡廳推薦嗎", dest: "巴黎", features: [] },
  { text: "曼谷有適合工作的咖啡廳嗎", dest: "曼谷", features: ["work"] },
  { text: "新加坡有深夜咖啡廳嗎", dest: "新加坡", features: ["late"] },
  { text: "墨爾本有早午餐咖啡廳嗎", dest: "墨爾本", features: ["brunch"] },
];

console.log("=== cafe place recommendation vs trip planning ===\n");

for (const [i, c] of CAFE_CASES.entries()) {
  const n = i + 1;
  const msg = c.text;
  let session = baseSession();
  const merged = mergeTravelContext(session, msg);
  session = mergeTripPlanningContext(msg, merged.session, merged.context).session;
  const mode = resolveConversationMode(msg, session);
  session = { ...session, conversationMode: mode };

  assert.equal(hasCategoryPlaceQuery(msg), true, `c${n} hasCategoryPlaceQuery`);
  assert.equal(hasExplicitPlaceRecommendationIntent(msg), true, `c${n} explicit`);
  assert.equal(isTravelPlanningText(msg), false, `c${n} not travel planning`);
  assert.equal(isComboItineraryQuery(msg), false, `c${n} not combo itinerary`);
  assert.equal(resolveChatContextIntent(msg), "place_recommendation", `c${n} context intent`);
  assert.equal(resolveChatIntent(msg, session), "cafe", `c${n} chat intent`);
  assert.deepEqual(parseChatPlaceIntents(msg), ["cafe"], `c${n} intents`);
  assert.equal(
    shouldFetchDestinationCategoryPlaces(msg, merged.context, session),
    true,
    `c${n} shouldFetch`,
  );
  assert.equal(shouldAskTripDuration(merged.context, session, msg), false, `c${n} no ask days`);
  assert.notEqual(mode, "destination_planning", `c${n} mode=${mode}`);

  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed, `c${n} parsed`);
  assert.equal(parsed.primaryType, "cafe", `c${n} primary cafe`);
  assert.equal(parsed.destinationName, c.dest, `c${n} dest`);
  for (const f of c.features) {
    assert.ok(
      parsed.preferredFeatures.includes(f) || (parsed.atmosphere ?? []).includes(f),
      `c${n} feature ${f} got features=${parsed.preferredFeatures.join(",")} atm=${(parsed.atmosphere ?? []).join(",")}`,
    );
  }

  const advice = resolveDestinationAdvice(merged.context, session, msg);
  assert.equal(advice.reply, null, `c${n} advice must be null`);
  assert.equal(advice.pendingQuestion, undefined, `c${n} no pending ask_days`);

  const offline = buildPlanningOfflineReply(merged.context, session, msg);
  assert.equal(offline, null, `c${n} offline must not ask days`);

  const sticky = baseSession({
    conversationMode: "destination_planning",
    tripPlanningContext: {
      selectedPlaces: [],
      destination: c.dest,
      intent: "destination_planning",
    },
    travelContext: { destination: c.dest, interests: ["美食"], vibe: "美食咖啡" },
  });
  const stickyMode = resolveConversationMode(msg, sticky);
  assert.equal(stickyMode, "nearby_explore", `c${n} sticky mode broken → ${stickyMode}`);
  assert.equal(resolveChatIntent(msg, sticky), "cafe", `c${n} sticky intent`);
  assert.equal(
    routeUserIntent(msg, sticky),
    "nearby_recommendation",
    `c${n} routeUserIntent`,
  );

  console.log(`  ✓ Case ${n}: ${msg}`);
}

// Explicit trip planning must still work
{
  const tripCases = [
    "幫我規劃台南 3 天行程",
    "台南一日遊怎麼排",
    "我想去台南玩 4 天",
    "幫我安排台南咖啡廳主題一日遊",
  ];
  for (const msg of tripCases) {
    assert.ok(
      isCreateItineraryIntent(msg) ||
        isTravelPlanningText(msg) ||
        isComboItineraryQuery(msg) ||
        resolveChatContextIntent(msg) === "create_itinerary" ||
        resolveChatContextIntent(msg) === "trip_planning",
      `trip still routes: ${msg} → ${resolveChatContextIntent(msg)}`,
    );
    assert.notEqual(
      resolveChatContextIntent(msg),
      "place_recommendation",
      `trip must not be place_rec: ${msg}`,
    );
    console.log(`  ✓ trip planning preserved: ${msg}`);
  }
}

{
  const emptyCtx = { interests: [] };
  const emptySession = baseSession();
  const puli = "埔里有什麼咖啡廳推薦嗎";
  assert.equal(extractProvisionalDestinationAreaCandidate(puli)?.rawLabel, "埔里");
  assert.equal(resolveDestinationForCategorySearch(emptyCtx, emptySession, puli), undefined);
  assert.equal(
    shouldFetchDestinationCategoryPlaces(puli, emptyCtx, emptySession),
    true,
    "unresolved geographic + cafe intent must enter destination category search",
  );
  assert.equal(
    shouldFetchDestinationCategoryPlaces("板橋有什麼咖啡廳", emptyCtx, emptySession),
    true,
  );
  assert.equal(
    shouldFetchDestinationCategoryPlaces("西屯有什麼咖啡廳", emptyCtx, emptySession),
    true,
  );
  assert.equal(
    shouldFetchDestinationCategoryPlaces("澀谷有什麼咖啡廳", emptyCtx, emptySession),
    true,
  );
  assert.equal(
    shouldFetchDestinationCategoryPlaces("有什麼咖啡廳推薦", emptyCtx, emptySession),
    false,
    "category-only asks without geography keep the current-location / session contract",
  );

  const stale = baseSession({
    travelContext: { destination: "台南東區", interests: [] },
    activeRecommendationContext: {
      intent: "cafe",
      destinationName: "台南東區",
      destinationDisplayName: "台南東區",
      places: [],
    },
  });
  assert.equal(
    resolveDestinationForCategorySearch(stale.travelContext, stale, puli),
    undefined,
    "埔里 must not inherit 台南東區",
  );
  assert.equal(shouldFetchDestinationCategoryPlaces(puli, stale.travelContext, stale), true);
  console.log("  ✓ generic geographic labels enter cafe place search without city whitelist");
}

console.log("\nverify-cafe-place-recommendation-route: ok");
