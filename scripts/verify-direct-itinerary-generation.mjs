import assert from "node:assert/strict";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import {
  parsePendingOptionSelection,
  pendingQuestionForPlanningNextStep,
} from "../src/lib/ai/destination-pending-question.ts";
import { parseItineraryPlanModeIntent } from "../src/lib/ai/itinerary-planning.ts";
import {
  isGenericPlaceLabel,
  isValidItineraryStopPlace,
} from "../src/lib/ai/generic-place-label.ts";

const ctx = {
  interests: [],
  destination: "台北",
  destinationCountry: "台灣",
  days: 3,
  conversationState: "ready_for_itinerary",
};

const pending = pendingQuestionForPlanningNextStep("台北", "台灣");
assert.deepEqual(pending.options, ["must_visit_places", "full_itinerary"]);

assert.equal(parseItineraryPlanModeIntent("直接排"), "full_itinerary");
assert.equal(parseItineraryPlanModeIntent("幫我排完整行程"), "full_itinerary");
assert.equal(parsePendingOptionSelection("直接排", pending), "full_itinerary");
assert.equal(parsePendingOptionSelection("先列必去點", pending), "must_visit_places");

const sessionWithPending = {
  travelContext: ctx,
  pendingQuestion: pending,
  conversationMode: "destination_planning",
};

const advice = resolveDestinationAdvice(ctx, sessionWithPending, "直接排");
assert.equal(advice.triggerItineraryGeneration, true);
assert.match(advice.reply ?? "", /實際景點/);
assert.doesNotMatch(advice.reply ?? "", /經典地標|熱門景點|特色街區/);

assert.equal(isGenericPlaceLabel("台北經典地標", "台北"), true);
assert.equal(isGenericPlaceLabel("台北在地市集或商圈", "台北"), true);
assert.equal(
  isValidItineraryStopPlace(
    {
      name: "國立故宮博物院",
      placeId: "ChIJxxx",
      address: "台北市士林區至善路二段221號",
      lat: 25.102,
      lng: 121.548,
    },
    "台北",
  ),
  true,
);
assert.equal(
  isValidItineraryStopPlace(
    {
      name: "台北熱門景點",
      placeId: "fake",
      address: "台北市",
      lat: 25.0,
      lng: 121.5,
    },
    "台北",
  ),
  false,
);

console.log("verify-direct-itinerary-generation: ok");
