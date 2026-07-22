/**
 * Step 1 regression: combination reply + nearby extension must not overwrite
 * primary destination / tripDays, and explicit switch must still replace.
 */
import assert from "node:assert/strict";
import {
  isCombinationSelectionContinuationReply,
  isExplicitPrimaryDestinationSwitch,
  parseCombinationSelectionReply,
  parseExplicitPrimaryDestinationSwitch,
  parseNearbyExtensionsFromText,
} from "../src/lib/ai/combination-selection-reply.ts";
import { isNewTripPlanning } from "../src/lib/ai/trip-planning-session-reset.ts";
import { normalizeDestinationLabel } from "../src/lib/ai/trip-planning-context.ts";
import { buildDestinationGeocodeQueries } from "../src/lib/ai/destination-geocode.ts";
import { resolveSelectedCombinations } from "../src/lib/ai/destination-combination-suggestions.ts";

function makeSession(overrides = {}) {
  return {
    phase: "discover",
    tripDays: 3,
    planningSessionId: "test-session",
    pendingQuestion: {
      type: "combination_choice",
      options: ["經典東京", "時尚商圈", "近郊備案"],
      baseDestination: "東京",
      destinationCountry: "日本",
    },
    travelContext: {
      destination: "東京",
      destinationCountry: "日本",
      days: 3,
      planningDaysConfirmed: true,
      offeredCombinations: [
        { id: 1, title: "經典東京", places: [] },
        { id: 2, title: "時尚商圈", places: [] },
        { id: 3, title: "近郊備案", places: [] },
        { id: 4, title: "美食探索", places: [] },
        { id: 5, title: "夜生活", places: [] },
      ],
      interests: [],
    },
    ...overrides,
  };
}

console.log("=== combination + nearby extension reply ===\n");

// 1) 「1、2跟橫濱」
{
  const parsed = parseCombinationSelectionReply("1、2跟橫濱", {
    combinationCount: 5,
    primaryDestination: "東京",
  });
  assert.deepEqual(parsed.selectedCombinationIds, [1, 2]);
  assert.deepEqual(parsed.nearbyExtensions, ["橫濱"]);
  assert.equal(parsed.isExplicitDestinationSwitch, false);
  assert.equal(parsed.isCombinationContinuation, true);

  const combo = resolveSelectedCombinations("東京", "1、2跟橫濱");
  assert.ok(combo?.indexes?.length === 2, "combo indices still resolve");

  const detected = isNewTripPlanning(makeSession(), "1、2跟橫濱");
  assert.equal(detected.isNew, false, "must not reset trip for 1、2跟橫濱");
  assert.equal(detected.incomingDestination, "東京");
}

// 2) 「選 1 和 2，再加一天橫濱」
{
  const parsed = parseCombinationSelectionReply("選 1 和 2，再加一天橫濱", {
    combinationCount: 5,
    primaryDestination: "東京",
  });
  assert.deepEqual(parsed.selectedCombinationIds, [1, 2]);
  assert.deepEqual(parsed.nearbyExtensions, ["橫濱"]);
  assert.equal(
    isNewTripPlanning(makeSession(), "選 1 和 2，再加一天橫濱").isNew,
    false,
  );
}

// 3) 「全部，也想去鎌倉」
{
  const parsed = parseCombinationSelectionReply("全部，也想去鎌倉", {
    combinationCount: 5,
    primaryDestination: "東京",
  });
  assert.ok(parsed.selectedCombinationIds.length === 5, "all selected");
  assert.deepEqual(parsed.nearbyExtensions, ["鎌倉"]);
  assert.equal(
    isNewTripPlanning(makeSession(), "全部，也想去鎌倉").isNew,
    false,
  );
}

// 4) 「選 3，順便安排箱根」
{
  const parsed = parseCombinationSelectionReply("選 3，順便安排箱根", {
    combinationCount: 5,
    primaryDestination: "東京",
  });
  assert.deepEqual(parsed.selectedCombinationIds, [3]);
  assert.deepEqual(parsed.nearbyExtensions, ["箱根"]);
  assert.equal(
    isNewTripPlanning(makeSession(), "選 3，順便安排箱根").isNew,
    false,
  );
}

// 5) 「改去橫濱」 must replace primary
{
  assert.equal(isExplicitPrimaryDestinationSwitch("改去橫濱"), true);
  assert.equal(parseExplicitPrimaryDestinationSwitch("改去橫濱"), "橫濱");
  assert.equal(
    isCombinationSelectionContinuationReply("改去橫濱", {
      pendingType: "combination_choice",
      primaryDestination: "東京",
      combinationCount: 5,
      hasOfferedCombinations: true,
    }),
    false,
  );
  const detected = isNewTripPlanning(makeSession(), "改去橫濱");
  assert.equal(detected.isNew, true, "explicit switch starts new trip");
  assert.equal(detected.incomingDestination, "橫濱");
}

// 6) Confirmed days must not be cleared by nearby extension (no reset)
{
  const before = makeSession();
  const detected = isNewTripPlanning(before, "1、2跟橫濱");
  assert.equal(detected.isNew, false);
  assert.equal(before.tripDays, 3, "session tripDays untouched when not resetting");
  assert.equal(before.travelContext.days, 3);
}

// 7) Aliases + geocode queries for Yokohama
{
  assert.equal(normalizeDestinationLabel("横浜"), "橫濱");
  assert.equal(normalizeDestinationLabel("Yokohama"), "橫濱");
  const queries = buildDestinationGeocodeQueries("橫濱");
  assert.ok(
    queries.some((q) => /Yokohama/i.test(q)),
    `geocode queries include Yokohama: ${queries.join(" | ")}`,
  );
  assert.ok(
    queries.some((q) => /Japan/i.test(q)),
    "geocode queries include Japan",
  );
  assert.deepEqual(parseNearbyExtensionsFromText("1跟横浜", "東京"), ["橫濱"]);
}

// 8) 「1、2、箱根」— comma style nearby extension
{
  const parsed = parseCombinationSelectionReply("1、2、箱根", {
    combinationCount: 5,
    primaryDestination: "東京",
  });
  assert.deepEqual(parsed.selectedCombinationIds, [1, 2]);
  assert.deepEqual(parsed.nearbyExtensions, ["箱根"]);
  assert.equal(parsed.isCombinationContinuation, true);
  assert.equal(
    isNewTripPlanning(makeSession({ tripDays: 6 }), "1、2、箱根").isNew,
    false,
  );
}

console.log("verify-combination-nearby-extension-reply: ok");
