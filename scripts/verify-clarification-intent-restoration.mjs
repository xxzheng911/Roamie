#!/usr/bin/env node
/**
 * Place/category geographic clarification must restore the original cafe intent.
 * 「東京的」is a parent-city answer, not a new Tokyo trip plan.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPendingGeographicClarification,
  isPlaceClarificationTripPlanningOverride,
  parseParentCityFromClarificationAnswer,
  restorePlaceIntentAfterGeographicClarification,
} from "../src/lib/ai/destination-geographic-clarification.ts";
import { shouldFetchDestinationCategoryPlaces } from "../src/lib/ai/chat-place-intent.ts";
import { isTravelPlanningText } from "../src/lib/ai/chat-intent-router.ts";
import { isDestinationSelectionText } from "../src/lib/ai/trip-planning-context.ts";
import { extractProvisionalDestinationAreaCandidate } from "../src/lib/ai/destination-travel-profile.ts";

function pendingFor(text, categoryIntent = "cafe") {
  const provisional = extractProvisionalDestinationAreaCandidate(text);
  assert.ok(provisional, text);
  return buildPendingGeographicClarification({
    rawGeographicLabel: provisional.areaCandidate,
    categoryIntent,
    originalUserText: text,
  });
}

{
  const pending = pendingFor("澀谷有什麼咖啡廳推薦嗎");
  assert.equal(pending.kind, "destination_area");
  assert.equal(pending.rawGeographicLabel, "澀谷");
  assert.equal(pending.parentIntent, "place_recommendation");
  assert.equal(pending.categoryIntent, "cafe");
  assert.equal(pending.originatingRoute, "destination_category");
  assert.equal(parseParentCityFromClarificationAnswer("東京的"), "東京");
  const restored = restorePlaceIntentAfterGeographicClarification(pending, "東京的");
  assert.ok(restored);
  assert.equal(restored.parentCity, "東京");
  assert.equal(restored.area, "澀谷");
  assert.equal(restored.destinationLabel, "東京澀谷");
  assert.equal(restored.categoryIntent, "cafe");
  assert.equal(restored.searchScope, "area");
  assert.equal(restored.restoredUserText, "東京澀谷有什麼咖啡廳推薦嗎");
  assert.equal(
    shouldFetchDestinationCategoryPlaces(restored.restoredUserText, { interests: [] }, {
      recommendedPlaces: [],
      selectedPlaces: [],
      phase: "discover",
      updatedAt: new Date().toISOString(),
    }),
    true,
  );
  assert.equal(isTravelPlanningText("東京的"), false);
  assert.equal(isPlaceClarificationTripPlanningOverride("東京的"), false);
  console.log("  ✓ 澀谷 cafe → 東京的 restores Tokyo Shibuya cafe");
}

{
  const pending = pendingFor("板橋有什麼咖啡廳");
  assert.equal(pending.rawGeographicLabel, "板橋");
  assert.equal(parseParentCityFromClarificationAnswer("新北的"), "新北");
  const restored = restorePlaceIntentAfterGeographicClarification(pending, "新北的");
  assert.ok(restored);
  assert.equal(restored.parentCity, "新北");
  assert.equal(restored.area, "板橋");
  assert.equal(restored.destinationLabel, "新北板橋");
  assert.equal(restored.categoryIntent, "cafe");
  assert.match(restored.restoredUserText, /^新北板橋有什麼咖啡廳/);
  console.log("  ✓ 板橋 cafe → 新北的 restores New Taipei Banqiao cafe");
}

{
  assert.equal(isDestinationSelectionText("我想去東京"), true);
  assert.equal(isTravelPlanningText("我想去東京"), true);
  assert.equal(isPlaceClarificationTripPlanningOverride("我想去東京"), true);
  const pending = pendingFor("澀谷有什麼咖啡廳推薦嗎");
  assert.equal(
    restorePlaceIntentAfterGeographicClarification(pending, "我想去東京"),
    null,
    "explicit trip planning must not be rewritten as a cafe restore",
  );
  console.log("  ✓ 我想去東京 stays trip planning");
}

{
  const pending = pendingFor("澀谷有什麼咖啡廳推薦嗎");
  assert.equal(restorePlaceIntentAfterGeographicClarification(pending, "3天"), null);
  assert.equal(isPlaceClarificationTripPlanningOverride("3天"), false);
  console.log("  ✓ Place clarification answer does not become ask dates");
}

{
  const chatSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
  assert.match(
    chatSource,
    /pendingClarification:\s*buildPendingGeographicClarification/,
    "clarification question must persist originating place intent",
  );
  assert.match(
    chatSource,
    /restorePlaceIntentAfterGeographicClarification/,
    "parent-city answers must restore the original place recommendation",
  );
  assert.match(
    chatSource,
    /isPlaceClarificationTripPlanningOverride/,
    "explicit trip planning still overrides leftover geographic clarification",
  );
  console.log("  ✓ chat route persists and restores pending geographic clarification");
}

console.info("verify-clarification-intent-restoration: ok");
