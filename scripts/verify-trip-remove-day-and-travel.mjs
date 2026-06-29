import assert from "node:assert/strict";
import {
  applyRemoveScheduledDay,
  scheduledDateKeysFromSettings,
} from "../src/lib/saved-trip/apply-trip-date-range.ts";
import type { RoamieItineraryItem, TripPlanSettings } from "../src/lib/ai/types.ts";
import { travelMinutesForMode } from "../src/lib/saved-trip/travel-time.ts";
import type { TransitLegAdvice } from "../src/lib/transit/types.ts";
import {
  availableModesToRoutesModes,
  buildFallbackModeChain,
  transportFallbackModeFromResult,
} from "../src/lib/saved-trip/route-duration-fallback.ts";
import type { RouteLegDurationResult } from "../src/lib/saved-trip/route-duration-types.ts";

function stop(date: string, name: string): RoamieItineraryItem {
  return {
    date,
    title: name,
    placeName: name,
    time: "10:00",
    lat: 35.71,
    lng: 139.8,
  };
}

const baseSettings: TripPlanSettings = {
  tripStartDate: "2026-06-01",
  tripEndDate: "2026-06-04",
  startTime: "10:00",
  transport: "walk",
};

const fourDayItems: RoamieItineraryItem[] = [
  stop("2026-06-01", "A"),
  stop("2026-06-01", "B"),
  stop("2026-06-02", "C"),
  stop("2026-06-03", "D"),
  stop("2026-06-04", "E"),
];

{
  const result = applyRemoveScheduledDay(fourDayItems, baseSettings, "2026-06-02");
  assert.equal(result.removedStopCount, 1);
  assert.equal(result.removedDayIndex, 1);
  assert.deepEqual(scheduledDateKeysFromSettings(result.settings), [
    "2026-06-01",
    "2026-06-02",
    "2026-06-03",
  ]);
  assert.equal(result.items.some((i) => i.placeName === "C"), false);
  assert.equal(result.items.find((i) => i.placeName === "D")?.date, "2026-06-02");
  assert.equal(result.items.find((i) => i.placeName === "E")?.date, "2026-06-03");
}

{
  const emptyDaySettings = { ...baseSettings };
  const emptyDayItems: RoamieItineraryItem[] = [stop("2026-06-01", "Only")];
  const result = applyRemoveScheduledDay(emptyDayItems, emptyDaySettings, "2026-06-02");
  assert.equal(result.removedStopCount, 0);
  assert.equal(result.removedDayIndex, 1);
  assert.deepEqual(scheduledDateKeysFromSettings(result.settings), [
    "2026-06-01",
    "2026-06-02",
    "2026-06-03",
  ]);
}

{
  const blocked = applyRemoveScheduledDay([stop("2026-06-01", "Only")], {
    ...baseSettings,
    tripEndDate: "2026-06-01",
  }, "2026-06-01");
  assert.equal(blocked.removedDayIndex, -1);
}

{
  const leg: TransitLegAdvice = {
    legKey: "a>b",
    fromName: "a",
    toName: "b",
    recommendedMode: "walk",
    headline: "單車",
    durationMinutes: 12,
    distanceMeters: 1000,
    reason: "",
    complexity: "low",
    estimates: { drive: 12 },
    source: "rules",
    transportFallbackMode: "drive",
  };
  assert.equal(travelMinutesForMode(leg, "單車"), 12);
}

{
  assert.deepEqual(availableModesToRoutesModes(["TRANSIT"], "WALK"), ["TRANSIT"]);
  assert.deepEqual(buildFallbackModeChain("WALK", 50_000, ["TRANSIT"]), ["TRANSIT", "DRIVE"]);
  assert.deepEqual(buildFallbackModeChain("BICYCLE", 10_000, ["TRANSIT"]), [
    "TRANSIT",
    "DRIVE",
    "WALK",
  ]);

  const route: RouteLegDurationResult = {
    ok: true,
    durationMinutes: 45,
    distanceMeters: 40_000,
    mode: "WALK",
    usedWalkFallback: false,
    usedEstimatedFallback: true,
    fallbackEstimateMode: "TRANSIT",
    transitUnavailable: false,
    transitUnavailableProvider: null,
    estimates: { distanceMeters: 40_000, transit: 45 },
  };
  assert.equal(transportFallbackModeFromResult(route), "transit");

  const walkLeg: TransitLegAdvice = {
    legKey: "a>b",
    fromName: "a",
    toName: "b",
    recommendedMode: "walk",
    headline: "步行",
    durationMinutes: 45,
    distanceMeters: 40_000,
    reason: "",
    complexity: "low",
    estimates: { transit: 45 },
    source: "rules",
    transportFallbackMode: "transit",
  };
  assert.equal(travelMinutesForMode(walkLeg, "步行"), 45);
}

console.log("verify-trip-remove-day-and-travel: ok");
