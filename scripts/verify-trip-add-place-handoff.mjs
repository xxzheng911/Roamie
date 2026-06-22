import { buildTripAddPlaceContext, buildTripAddPlaceOpening, writeTripAddPlaceHandoff, consumeTripAddPlaceHandoff, prepareTripAddPlaceSession } from "../src/lib/trip/trip-add-place-handoff.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const stored = {
  id: "trip-123",
  payload: {
    version: 2,
    title: "日本之旅",
    summary: "",
    moodTag: "慢旅行",
    destination: "日本",
    recommendations: [],
    itinerary: [
      {
        date: "2026-07-01",
        time: "10:00",
        title: "仲見世商店街",
        placeName: "仲見世商店街",
        description: "",
        address: "東京",
        lat: 35.71,
        lng: 139.79,
      },
      {
        date: "2026-07-01",
        time: "11:20",
        title: "Stellar Garden",
        placeName: "Stellar Garden",
        description: "",
        address: "東京",
        lat: 35.72,
        lng: 139.8,
      },
    ],
    tripSettings: {
      tripStartDate: "2026-07-01",
      tripEndDate: "2026-07-03",
      transport: "transit",
      startTime: "10:00",
    },
  },
};

const ctx = buildTripAddPlaceContext({
  stored,
  payload: stored.payload,
  settings: stored.payload.tripSettings,
  dayIndex: 0,
  selectedDay: 1,
  dateKey: "2026-07-01",
  dayItems: stored.payload.itinerary,
  dayCount: 3,
});

assert(ctx.mode === "trip_add_place", "mode is trip_add_place");
assert(ctx.tripId === "trip-123", "tripId preserved");
assert(ctx.selectedDay === 1, "selectedDay is 1");
assert(ctx.existingPlaceNames.length === 2, "existing places captured");
assert(ctx.lastPlace?.name === "Stellar Garden", "last place is Stellar Garden");

const opening = buildTripAddPlaceOpening(ctx);
assert(opening.includes("仲見世商店街"), "opening mentions existing place");
assert(opening.includes("Stellar Garden"), "opening mentions second place");
assert(opening.includes("咖啡休息"), "opening asks preference");

writeTripAddPlaceHandoff(ctx);
const consumed = consumeTripAddPlaceHandoff();
assert(consumed?.tripId === "trip-123", "handoff roundtrip works");
assert(consumeTripAddPlaceHandoff() === null, "handoff consumed once");

const session = prepareTripAddPlaceSession(ctx, {
  preferences: {},
  location: { lat: 35.71, lng: 139.79, city: "東京" },
  weather: null,
  time: "12:00",
  usedFallbackLocation: false,
});
assert(session.fromTripAddPlace === true, "session marks trip add place");
assert(session.conversationMode === "trip_add_place", "conversation mode set");
assert(session.rejectedPlaceNames?.includes("仲見世商店街"), "rejects existing places");

if (failed > 0) process.exit(1);
console.log("\nAll trip add place handoff checks passed.");
