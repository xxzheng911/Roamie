import assert from "node:assert/strict";
import {
  AI_ITINERARY_FAILED_OFFER_MESSAGE,
  logAiState,
} from "../src/lib/ai/ai-itinerary-state-machine.ts";
import { ITINERARY_PARTIAL_FAILURE_MESSAGE } from "../src/lib/trip/itinerary-guards.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";

assert(
  AI_ITINERARY_FAILED_OFFER_MESSAGE.includes("是否改成列出必去景點"),
  "failed offer message matches spec",
);
assert(
  ITINERARY_PARTIAL_FAILURE_MESSAGE === AI_ITINERARY_FAILED_OFFER_MESSAGE,
  "partial failure message aligned with state machine",
);

const places = [
  { name: "國立臺東美術館", placeName: "國立臺東美術館", googlePlaceId: "p1", lat: 22.76, lng: 121.14 },
  { name: "小野柳", placeName: "小野柳", googlePlaceId: "p2", lat: 22.77, lng: 121.15 },
  { name: "初鹿牧場", placeName: "初鹿牧場", googlePlaceId: "p3", lat: 22.78, lng: 121.16 },
  { name: "台東觀光夜市", placeName: "台東觀光夜市", googlePlaceId: "p4", lat: 22.75, lng: 121.13 },
  { name: "鯉魚山", placeName: "鯉魚山", googlePlaceId: "p5", lat: 22.74, lng: 121.12 },
];

const built = buildFallbackItineraryFromPlaces(places, 2, "2026-07-01");
assert(built.length === 5, "builds itinerary from 5 places without geocode");

const session = createEmptySession();
assert(session.aiItineraryState == null, "empty session has no ai itinerary state");

logAiState("COLLECTING");
logAiState("SUCCESS", "test");

console.log("verify-ai-itinerary-state-machine: ok");
