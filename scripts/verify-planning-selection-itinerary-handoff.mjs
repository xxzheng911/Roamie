import assert from "node:assert/strict";
import { createItineraryFromSession } from "../src/lib/ai/ai-itinerary-state-machine.ts";
import { buildPlannerRequiredAnchors } from "../src/lib/place-planning-memory.ts";
import {
  applyPlanningSelectionDateAuthority,
  resolvePlanningSelectionDateAuthority,
} from "../src/lib/planning-selection-date-authority.ts";

const card = (index) => ({
  name: `地點 ${index}`,
  placeName: `地點 ${index}`,
  placeId: `ChIJSelectionPlace${String(index).padStart(3, "0")}`,
  googlePlaceId: `ChIJSelectionPlace${String(index).padStart(3, "0")}`,
  type: "tourist_attraction",
  types: index === 1 ? null : ["tourist_attraction"],
  description: "正式地點",
  reason: "使用者已選",
  estimatedTime: "1-2 小時",
  address: `台北市地址 ${index}`,
  lat: 25.03 + index / 1000,
  lng: 121.53 + index / 1000,
  googleMapsUrl: "",
  reasonSource: "evidence",
});

const buildPayload = (anchors, days) => {
  const scheduledPlaces = [...anchors];
  return {
    version: 2,
    title: `台北 ${days} 天`,
    summary: "Selection itinerary",
    moodTag: "",
    recommendations: anchors,
    itinerary: scheduledPlaces.map((place, index) => ({
      date: `2026-09-${String(10 + Math.min(index, days - 1)).padStart(2, "0")}`,
      time: index % 2 ? "14:00" : "10:00",
      title: place.name,
      placeName: place.name,
      description: place.description,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      googlePlaceId: place.googlePlaceId,
    })),
    destination: "台北",
    days,
    generatedAt: new Date().toISOString(),
  };
};

async function run(days, selectedCount) {
  const anchors = buildPlannerRequiredAnchors(
    Array.from({ length: selectedCount }, (_, index) => card(index + 1)),
    "台北",
    true,
  );
  const payload = buildPayload(anchors, days);
  const result = await createItineraryFromSession({
    session: {
      phase: "ready",
      recommendedPlaces: [],
      selectedPlaces: anchors,
      tripDays: days,
      updatedAt: new Date().toISOString(),
    },
    generateInput: {
      destination: "台北",
      days,
      budget: "medium",
      style: "balanced",
      mood: "",
      interests: "",
      conversationSummary: "",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      origin: "",
      transport: "transit",
      placeAuthority: "selected_only",
      selectedPlaces: anchors.map((anchor) => ({ ...anchor, types: anchor.types })),
      selectedCombinationIds: [],
      nearbyExtensions: [],
      excludedCategories: [],
      fashionStyle: "",
    },
    generateItineraryFn: async () => ({
      success: true,
      trip: {
        id: "trip-selection",
        title: payload.title,
        destination: "台北",
        days,
        itinerary: [{ day: 1, date: "2026-09-10", stops: payload.itinerary }],
        payload,
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.itinerary.length, selectedCount);
  const outputIds = new Set(result.payload.itinerary.map((stop) => stop.googlePlaceId));
  assert.equal(
    anchors.every((place) => outputIds.has(place.googlePlaceId)),
    true,
    "every authoritative selected anchor survives normalized output",
  );
  assert.deepEqual(
    [...outputIds].sort(),
    anchors.map((place) => place.googlePlaceId).sort(),
    "selected-only output cannot add or replace an attraction",
  );
}

await run(1, 1);
await run(2, 3);
await run(2, 4);
await run(3, 6);

for (const [startDate, endDate, expected] of [
  ["2026-10-10", "2026-10-12", ["2026-10-10", "2026-10-11", "2026-10-12"]],
  ["2026-10-10", "2026-10-10", ["2026-10-10"]],
  ["2026-10-31", "2026-11-02", ["2026-10-31", "2026-11-01", "2026-11-02"]],
  ["2026-12-31", "2027-01-02", ["2026-12-31", "2027-01-01", "2027-01-02"]],
]) {
  const authority = resolvePlanningSelectionDateAuthority({
    phase: "ready",
    recommendedPlaces: [],
    selectedPlaces: [],
    tripStartDate: "2099-01-01",
    tripEndDate: "2099-01-01",
    tripDays: 99,
    planningSelection: {
      id: "selection-date-test",
      mode: "planning_selection",
      styles: [],
      selectedPlaceIds: [],
      selectedPlaces: [],
      shownPlaceIds: [],
      shownFamilyCounts: {},
      lanes: [],
      destinationScope: { name: "台北", lat: 25, lng: 121, radius: 50_000 },
      dateAuthority: { startDate, endDate, tripDays: 99 },
      createdAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  });
  assert(authority);
  assert.equal(authority.tripDays, expected.length, "inclusive range repairs stale tripDays");
  assert.deepEqual(authority.dayDates, expected);
  const wrongPayload = buildPayload(
    Array.from({ length: expected.length }, (_, i) => card(i + 1)),
    expected.length,
  );
  wrongPayload.itinerary = wrongPayload.itinerary.map((item, dayIndex) => ({
    ...item,
    date: `2030-01-${String(dayIndex + 1).padStart(2, "0")}`,
    dayIndex,
  }));
  const repaired = applyPlanningSelectionDateAuthority(wrongPayload, authority);
  assert.equal(repaired.tripSettings.tripStartDate, startDate);
  assert.equal(repaired.tripSettings.tripEndDate, endDate);
  assert.deepEqual([...new Set(repaired.itinerary.map((item) => item.date))], expected);
}
console.log("verify-planning-selection-itinerary-handoff: ok");
