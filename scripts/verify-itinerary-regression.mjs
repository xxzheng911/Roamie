/**
 * City/style regressions: 台中 dedupe, 台南 pool, parent landmark, chat style flow.
 */
import assert from "node:assert/strict";
import { dedupeParentLandmarkPlaces } from "../src/lib/ai/ai-parent-landmark-dedup.ts";
import { buildLocalLifeDayPlans, validateTripNoDuplicate } from "../src/lib/ai/ai-local-life-scheduler.ts";
import {
  canEvenlyMeetMinPerDay,
  isPlannerPoolReady,
  minCandidatePoolSize,
  redistributePlacesEvenly,
} from "../src/lib/ai/ai-multi-day-planner.ts";
import { isItineraryRenderable, plannerTotalPlaces } from "../src/lib/ai/ai-day-plan-source.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";
import {
  buildRealCityPool,
  chijPlaceId,
  INTEGRATION_CITIES,
  mockRealPlace,
  finishVerifyScript,
} from "./lib/itinerary-verify-helpers.mjs";

let failures = 0;

function ok(message) {
  console.log(`OK ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function check(name, fn) {
  try {
    fn();
    ok(name);
  } catch (error) {
    fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
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
  const turn = processAdviceTurn(text, nextSession, merged.context);
  return {
    turn,
    merged,
    session: applyAdviceResultToSession(
      {
        ...turn.session,
        pendingQuestion: turn.route?.pendingQuestion ?? turn.advice.pendingQuestion,
        lastResolvedPendingQuestion: undefined,
        adviceSelectionThisTurn: undefined,
      },
      turn.advice,
    ),
  };
}

console.log("=== verify-itinerary-regression ===\n");

check("parent landmark dedupe collapses same complex landmark group", () => {
  const primary = mockRealPlace({
    name: "十鼓文創園區",
    city: "台南",
    lat: 22.99,
    lng: 120.22,
    kind: "attraction",
    index: 0,
    cityCode: "TN",
  });
  primary.rating = 4.2;
  const duplicate = mockRealPlace({
    name: "十鼓文創園區",
    city: "台南",
    lat: 22.992,
    lng: 120.223,
    kind: "attraction",
    index: 1,
    cityCode: "TN",
  });
  duplicate.id = chijPlaceId("TN", "attraction", 99);
  duplicate.rating = 4.9;
  const deduped = dedupeParentLandmarkPlaces([primary, duplicate]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].name, "十鼓文創園區");
});

check("台南 12-place pool cannot render 4d full itinerary", () => {
  const city = INTEGRATION_CITIES.find((c) => c.name === "台南");
  const pool = Array.from({ length: 12 }, (_, i) =>
    mockRealPlace({
      name: `台南景點${i + 1}`,
      city: city.name,
      lat: city.lat,
      lng: city.lng,
      kind: "attraction",
      index: i,
      cityCode: city.code,
    }),
  );
  assert.equal(minCandidatePoolSize(4), 24);
  assert.equal(canEvenlyMeetMinPerDay(12, 4), false);
  const distributed = redistributePlacesEvenly({ places: pool, days: 4, style: "classic_landmarks" });
  assert.equal(plannerTotalPlaces(distributed), 12);
  assert.equal(isItineraryRenderable(distributed, 4, "classic_landmarks"), false);
});

check("台中 local life no cross-day duplicate hotspots", () => {
  const city = INTEGRATION_CITIES.find((c) => c.name === "台中");
  const pool = buildRealCityPool(city, 3);
  const days = 3;
  const plans = buildLocalLifeDayPlans({
    places: pool,
    days,
    destination: city.name,
    lat: city.lat,
    lng: city.lng,
  });
  assert.equal(plans.length, days);
  const validation = validateTripNoDuplicate(plans, city.name, days);
  assert.equal(validation.ok, true, validation.reasons.join(";"));
  for (const plan of plans) {
    assert.ok(plan.entries.length >= 7, `day ${plan.day} too sparse (got ${plan.entries.length})`);
  }
  const allIds = plans.flatMap((p) => p.entries.map((e) => e.place.id ?? e.name));
  assert.equal(new Set(allIds).size, allIds.length);
});

check("台南 chat flow: destination → days → style option 1", () => {
  let session = createEmptySession();
  const t1 = planningTurn("我想去台南", session);
  assert.match(t1.turn.advice.reply ?? "", /幾天/);
  assert.equal(t1.session.pendingQuestion?.type, "ask_days");
  assert.doesNotMatch(t1.turn.advice.reply ?? "", /經典地標/);

  const t2 = planningTurn("4天", t1.session);
  assert.equal(t2.merged.context.days, 4);
  assert.match(t2.turn.advice.reply ?? "", /台南 4 天 3 夜/);
  assert.match(t2.turn.advice.reply ?? "", /經典地標/);
  assert.equal(t2.session.pendingQuestion?.type, "ask_trip_style");
  assert.notEqual(t2.turn.advice.triggerPlaceRecommendations, true);

  const t3 = planningTurn("1", t2.session);
  assert.equal(t3.turn.advice.triggerPlaceRecommendations, true);
  assert.equal(t3.turn.advice.contextPatch?.planningTripStyle, "classic_landmarks");
});

for (const city of INTEGRATION_CITIES) {
  check(`${city.name} 4d real pool passes gate`, () => {
    const pool = buildRealCityPool(city, 4);
    assert.equal(isPlannerPoolReady(pool, 4), true);
  });
}

finishVerifyScript(failures, "verify-itinerary-regression");
