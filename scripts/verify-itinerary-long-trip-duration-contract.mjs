/**
 * Long-trip duration contract + combination generation + error classification.
 * Covers 16-day Tokyo combination 2+3, 30/31-day boundaries, and selected_only compatibility.
 */
import assert from "node:assert/strict";
import {
  MAX_ITINERARY_DAYS,
  MAX_ITINERARY_SELECTED_PLACES,
  MIN_ITINERARY_DAYS,
  computeInclusiveItineraryDays,
  isValidItineraryDayCount,
} from "../src/lib/ai/itinerary-days.ts";
import { parseTravelDateRangeFromText } from "../src/lib/ai/parse-travel-date-range.ts";
import { InputSchema } from "../src/lib/itinerary.functions.ts";
import { RequestSchema } from "../src/lib/ai/service.server.ts";
import { parseCombinationSelectionReply } from "../src/lib/ai/combination-selection-reply.ts";
import {
  resolveItineraryCandidateCapacityTarget,
  resolveItineraryCandidateExpansionDecision,
  validateItineraryPreSave,
} from "../src/lib/ai/real-place-supplement.ts";
import {
  computeFirstRoundPlaceMapCap,
  computeItineraryResolvedTarget,
} from "../src/lib/ai/place-map-queue.ts";
import { generateItineraryViaNativeApi } from "../src/lib/ai/itinerary-transport.ts";
import {
  COMBINATION_CANDIDATE_SHORTAGE_MESSAGE,
  ITINERARY_GENERATION_FAILED_MESSAGE,
  INVALID_TRIP_DURATION_ERROR_CODE,
  INVALID_TRIP_DURATION_MESSAGE,
  classifyItineraryGenerationFailure,
  invalidItineraryDurationFailure,
} from "../src/lib/trip/itinerary-guards.ts";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "../src/lib/ai/generic-place-label.ts";
import { ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE } from "../src/lib/ai/itinerary-validator/types.ts";
import { createItineraryFromSession } from "../src/lib/ai/ai-itinerary-state-machine.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { isPlanningSelectionMode } from "../src/lib/planning-selection.ts";
import { assessDeterministicRebuildCapacity } from "../src/lib/ai/itinerary-deliverable-candidate.ts";

const tokyoPlace = (index, name) => ({
  name,
  placeName: name,
  googlePlaceId: `ChIJTokyoLongTrip${String(index).padStart(2, "0")}P25`,
  address: "東京都",
  lat: 35.68 + index * 0.001,
  lng: 139.76 + index * 0.001,
  type: "景點",
});

let failed = 0;

function parseItineraryRequestDays(days) {
  return RequestSchema.safeParse({
    mode: "itinerary",
    itineraryRequest: { destination: "東京", days, budget: "medium" },
  });
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("=== itinerary long-trip duration / capacity / errors ===\n");

await check("authority MIN=1 MAX=30", () => {
  assert.equal(MIN_ITINERARY_DAYS, 1);
  assert.equal(MAX_ITINERARY_DAYS, 30);
  assert.equal(isValidItineraryDayCount(16), true);
  assert.equal(isValidItineraryDayCount(30), true);
  assert.equal(isValidItineraryDayCount(31), false);
});

await check("Test 1 — parse 2026/12/15～2026/12/30 → 16 days", () => {
  const parsed = parseTravelDateRangeFromText("2026/12/15～2026/12/30");
  assert.equal(parsed.startDate, "2026-12-15");
  assert.equal(parsed.endDate, "2026-12-30");
  assert.equal(parsed.days, 16);
  assert.equal(computeInclusiveItineraryDays("2026-12-15", "2026-12-30"), 16);
});

await check("Test 2 — itinerary InputSchema days=16", () => {
  const parsed = InputSchema.safeParse({ destination: "東京", days: 16 });
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

await check("Test 3 — server request schema days=16", () => {
  const parsed = parseItineraryRequestDays(16);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

await check("Test 4 — combination reply 2、3 → [2, 3]", () => {
  const reply = parseCombinationSelectionReply("2、3", { combinationCount: 4 });
  assert.deepEqual(reply.selectedCombinationIds, [2, 3]);
  assert.equal(reply.isCombinationContinuation, true);
});

await check("Test 5 — combination_choice stays selectedOnly=false", () => {
  const session = {
    ...createEmptySession(),
    pendingQuestion: {
      type: "combination_choice",
      options: ["經典景點", "舊城文化", "美食商圈", "近郊自然"],
    },
  };
  assert.equal(session.pendingQuestion.type, "combination_choice");
  assert.equal(isPlanningSelectionMode(session), false);
  const expansion = resolveItineraryCandidateExpansionDecision({
    deliverableCandidateCount: 10,
    capacityTarget: resolveItineraryCandidateCapacityTarget(16),
    selectedOnly: isPlanningSelectionMode(session),
    hasDayPlan: false,
    destinationResolved: true,
  });
  assert.equal(expansion.skippedReason, "none");
  assert.equal(expansion.attempted, true);
});

await check("Test 6 — 16-day capacity authority", () => {
  const target = resolveItineraryCandidateCapacityTarget(16);
  assert.equal(target.hardMinimum, 32);
  assert.equal(target.preferredTarget, 48);
});

await check("Test 7 — resolved target invariant + expansion can reach hardMinimum", () => {
  const target = resolveItineraryCandidateCapacityTarget(16);
  const firstRound = computeFirstRoundPlaceMapCap(16);
  const resolved = computeItineraryResolvedTarget(16);
  assert.ok(resolved >= 32, `resolvedTarget=${resolved} must be >= 32`);
  assert.ok(resolved >= target.hardMinimum);
  assert.equal(firstRound, 24);
  const expansion = resolveItineraryCandidateExpansionDecision({
    deliverableCandidateCount: firstRound,
    capacityTarget: target,
    selectedOnly: false,
    hasDayPlan: false,
    destinationResolved: true,
  });
  assert.equal(expansion.needed, true);
  assert.equal(expansion.attempted, true);
  assert.ok(
    firstRound + (resolved - firstRound) >= target.hardMinimum,
    "expansion remaining quota can reach hardMinimum",
  );
});

await check("Test 8 — native API days=16 is not Zod generation_unavailable", async () => {
  assert.equal(invalidItineraryDurationFailure(16), null);
  const schema = InputSchema.safeParse({ destination: "東京", days: 16 });
  assert.equal(schema.success, true);
  let requestedDays = null;
  const result = await generateItineraryViaNativeApi(
    { destination: "東京", days: 16, generationId: "long-trip-16" },
    {
      token: "test-token",
      origin: "https://roamie.example",
      fetchImpl: async (_url, init) => {
        requestedDays = JSON.parse(init.body).days;
        assert.equal(requestedDays, 16);
        return new Response(
          JSON.stringify({ success: true, trip: { destination: "東京", days: 16 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );
  assert.equal(result.success, true);
  assert.notEqual(result.errorCode, "generation_unavailable");
});

await check("oversample schema capacity covers 16–30 day resolvedTarget", () => {
  assert.equal(MAX_ITINERARY_SELECTED_PLACES, MAX_ITINERARY_DAYS * 4);
  const expected = { 16: 64, 18: 72, 20: 80, 24: 96, 30: 120 };
  for (const [days, target] of Object.entries(expected)) {
    const dayCount = Number(days);
    const resolved = computeItineraryResolvedTarget(dayCount);
    assert.equal(resolved, target);
    const parsed = InputSchema.safeParse({
      destination: "東京",
      days: dayCount,
      selectedPlaces: Array.from({ length: resolved }, (_, i) => tokyoPlace(i + 1, `景點${i + 1}`)),
    });
    assert.equal(
      parsed.success,
      true,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    );
  }
  for (let days = MIN_ITINERARY_DAYS; days <= MAX_ITINERARY_DAYS; days += 1) {
    assert.ok(
      computeItineraryResolvedTarget(days) <= MAX_ITINERARY_SELECTED_PLACES,
      `days=${days} resolvedTarget exceeds selectedPlaces schema max`,
    );
  }
});

await check("Test 13 — 30-day duration schema is legal", () => {
  assert.equal(isValidItineraryDayCount(30), true);
  assert.equal(InputSchema.safeParse({ destination: "東京", days: 30 }).success, true);
  assert.equal(parseItineraryRequestDays(30).success, true);
  assert.equal(invalidItineraryDurationFailure(30), null);
});

await check("Test 14 — 31-day duration is rejected before planner", async () => {
  assert.equal(isValidItineraryDayCount(31), false);
  assert.equal(InputSchema.safeParse({ destination: "東京", days: 31 }).success, false);
  const thirtyOne = parseItineraryRequestDays(31);
  assert.equal(thirtyOne.success, false);
  assert.ok(
    thirtyOne.error.issues.some((issue) => issue.path.includes("days")),
    "server schema must reject days=31",
  );
  const failure = invalidItineraryDurationFailure(31);
  assert.equal(failure?.errorCode, INVALID_TRIP_DURATION_ERROR_CODE);
  assert.equal(failure?.message, INVALID_TRIP_DURATION_MESSAGE);
  let plannerEntered = false;
  const result = await createItineraryFromSession({
    session: createEmptySession(),
    generateInput: { destination: "東京", days: 31, selectedPlaces: [] },
    generateItineraryFn: async () => {
      plannerEntered = true;
      throw new Error("planner should not run");
    },
  });
  assert.equal(plannerEntered, false);
  assert.equal(result.ok, false);
  assert.equal(result.message, INVALID_TRIP_DURATION_MESSAGE);
  assert.notEqual(result.message, ITINERARY_GENERATION_FAILED_MESSAGE);
});

await check("error classification separates duration / places / validator / generic", () => {
  assert.equal(
    classifyItineraryGenerationFailure({ errorCode: INVALID_TRIP_DURATION_ERROR_CODE })
      .classification,
    "invalid_trip_duration",
  );
  assert.equal(
    classifyItineraryGenerationFailure({ errorCode: "insufficient_places" }).userMessage,
    INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
  );
  assert.equal(
    classifyItineraryGenerationFailure({
      errorCode: "combination_coverage_insufficient",
    }).userMessage,
    COMBINATION_CANDIDATE_SHORTAGE_MESSAGE,
  );
  assert.equal(
    classifyItineraryGenerationFailure({
      errorCode: "itinerary_integrity_failed",
      failureReason: "insufficient_deliverable_capacity",
    }).classification,
    "insufficient_candidate_capacity",
  );
  assert.equal(
    classifyItineraryGenerationFailure({ errorCode: "itinerary_validator_failed" }).userMessage,
    ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
  );
  assert.equal(
    classifyItineraryGenerationFailure({ errorCode: "generation_unavailable" }).userMessage,
    ITINERARY_GENERATION_FAILED_MESSAGE,
  );
});

await check("Test 10 — filter-after-shortage is classified, not generic", () => {
  const preSave = validateItineraryPreSave({
    tripDays: 16,
    startDate: "2026-12-15",
    stops: Array.from({ length: 8 }, (_, i) => ({
      title: `重複地點`,
      googlePlaceId: "ChIJSamePlacexxxxxxxxxxxxxxxx",
      lat: 35.68,
      lng: 139.76,
      dayIndex: 0,
    })),
  });
  assert.equal(preSave.ok, false);
  const reason = preSave.reasons.find((item) =>
    /insufficient_real_places|empty_non_free_day/.test(item),
  );
  assert.ok(reason, `expected classified pre-save reason, got ${preSave.reasons.join("|")}`);
  const classified = classifyItineraryGenerationFailure({
    errorCode: "insufficient_real_places",
    failureReason: reason,
    message: reason,
  });
  assert.notEqual(classified.userMessage, ITINERARY_GENERATION_FAILED_MESSAGE);
  assert.ok(
    classified.classification === "insufficient_real_places" ||
      classified.classification === "insufficient_candidate_capacity",
  );
  assert.equal(assessDeterministicRebuildCapacity(20, 16).sufficient, false);
  assert.equal(
    classifyItineraryGenerationFailure({
      errorCode: "insufficient_candidate_capacity",
      failureReason: "insufficient_deliverable_capacity",
    }).classification,
    "insufficient_candidate_capacity",
  );
});

await check("Test 11 — short trip 3–5 day contracts still pass", () => {
  for (const days of [3, 4, 5]) {
    assert.equal(InputSchema.safeParse({ destination: "台北", days }).success, true);
    const target = resolveItineraryCandidateCapacityTarget(days);
    assert.ok(computeItineraryResolvedTarget(days) >= target.hardMinimum);
    assert.equal(target.hardMinimum, days * 2);
    assert.equal(target.preferredTarget, days * 3);
  }
});

await check("Test 12 — medium trip 8–14 day contracts still pass", () => {
  for (const days of [8, 10, 14]) {
    assert.equal(InputSchema.safeParse({ destination: "台北", days }).success, true);
    const target = resolveItineraryCandidateCapacityTarget(days);
    assert.ok(computeItineraryResolvedTarget(days) >= target.hardMinimum);
    assert.equal(target.hardMinimum, days * 2);
    assert.equal(target.preferredTarget, days * 3);
  }
});

await check("Test 15 — selected_only still skips expansion", () => {
  const decision = resolveItineraryCandidateExpansionDecision({
    deliverableCandidateCount: 3,
    capacityTarget: resolveItineraryCandidateCapacityTarget(16),
    selectedOnly: true,
    hasDayPlan: false,
    destinationResolved: true,
  });
  assert.equal(decision.skippedReason, "selected_only");
  assert.equal(decision.attempted, false);
});

const tokyoPlaces = [
  tokyoPlace(1, "淺草寺"),
  tokyoPlace(2, "東京晴空塔"),
  tokyoPlace(3, "明治神宮"),
  tokyoPlace(4, "淺草文化觀光中心"),
  tokyoPlace(5, "上野公園"),
  tokyoPlace(6, "東京國立博物館"),
  tokyoPlace(7, "皇居東御苑"),
  tokyoPlace(8, "神樂坂"),
];

await check("Test 9 — Tokyo combination 2+3, 16 days does not generic-fail", async () => {
  const reply = parseCombinationSelectionReply("2、3", { combinationCount: 4 });
  assert.deepEqual(reply.selectedCombinationIds, [2, 3]);
  let invokedDays = null;
  let invokedAuthority = "missing";
  const result = await createItineraryFromSession({
    session: {
      ...createEmptySession(),
      pendingQuestion: { type: "combination_choice", options: ["A", "經典景點", "舊城文化", "D"] },
      selectedPlaces: tokyoPlaces,
      travelContext: {
        interests: [],
        destination: "東京",
        days: 16,
        startDate: "2026-12-15",
        endDate: "2026-12-30",
        selectedCombinationIds: [2, 3],
      },
    },
    generateInput: {
      destination: "東京",
      days: 16,
      startDate: "2026-12-15",
      endDate: "2026-12-30",
      selectedPlaces: tokyoPlaces,
      selectedCombinationIds: [2, 3],
    },
    generateItineraryFn: async ({ data }) => {
      invokedDays = data.days;
      invokedAuthority = data.placeAuthority ?? "none";
      return {
        success: false,
        errorCode: "insufficient_places",
        message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      };
    },
  });
  assert.equal(invokedDays, 16);
  assert.equal(invokedAuthority, "none");
  assert.equal(result.ok, false);
  assert.notEqual(result.message, ITINERARY_GENERATION_FAILED_MESSAGE);
  assert.ok(
    result.message === INSUFFICIENT_ITINERARY_PLACES_MESSAGE ||
      result.message === COMBINATION_CANDIDATE_SHORTAGE_MESSAGE,
    `unexpected message=${result.message}`,
  );
});

await check("P6 — classified server reason survives failed local fallback", async () => {
  const result = await createItineraryFromSession({
    session: {
      ...createEmptySession(),
      selectedPlaces: tokyoPlaces.slice(0, 2),
      travelContext: { interests: [], selectedCombinationIds: [2, 3] },
    },
    generateInput: {
      destination: "東京",
      days: 16,
      selectedPlaces: tokyoPlaces.slice(0, 2),
      selectedCombinationIds: [2, 3],
    },
    generateItineraryFn: async () => ({
      success: false,
      errorCode: "insufficient_places",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, INSUFFICIENT_ITINERARY_PLACES_MESSAGE);
});

if (failed) {
  console.error(`\nlong-trip duration/capacity/error contract: FAIL (${failed})`);
  process.exit(1);
}
console.log("\nlong-trip duration/capacity/error contract: PASS");
