import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { prepareDirectItinerarySession } from "../src/lib/ai/itinerary-place-fetch.ts";
import { buildDestinationGeocodeQueries } from "../src/lib/ai/destination-geocode.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
  groupItineraryItemsByDay,
  hasValidItineraryStops,
  normalizeTripPayload,
  unwrapGeneratedTripPayload,
} from "../src/lib/trip/itinerary-guards.ts";
import { assertItineraryStopsHavePlaceIds } from "../src/lib/ai/itinerary-place-fetch.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

// 1. coalesceItineraryItems guards undefined
assert(coalesceItineraryItems(undefined).length === 0, "undefined itinerary → []");
assert(coalesceItineraryItems(null).length === 0, "null itinerary → []");

// 2. unwrapGeneratedTripPayload formats
const wrapped = unwrapGeneratedTripPayload({
  itinerary: { title: "阿里山", summary: "test", moodTag: "", recommendations: [], itinerary: [{ placeName: "x" }] },
});
assert(wrapped?.title === "阿里山", "unwrap nested { itinerary }");
assert(Array.isArray(wrapped?.itinerary), "unwrap ensures itinerary array");

const direct = unwrapGeneratedTripPayload({
  title: "直接",
  summary: "",
  moodTag: "",
  recommendations: [],
});
assert(direct?.itinerary?.length === 0, "direct payload gets empty itinerary array");

// 3. normalizeTripPayload never leaves itinerary undefined
const normalized = normalizeTripPayload({ title: "t", summary: "s" });
assert(Array.isArray(normalized.itinerary), "normalize always has itinerary array");

// 4. 阿里山 geocode queries include forest recreation area
const geoQueries = buildDestinationGeocodeQueries("阿里山");
assert(
  geoQueries.some((q) => q.includes("阿里山國家森林遊樂區")),
  "阿里山 geocode includes 國家森林遊樂區",
);
assert(
  geoQueries.some((q) => q.includes("嘉義縣")),
  "阿里山 geocode includes 嘉義縣",
);

// 5. advice turn triggers itinerary generation for 直接排2天
const session = createEmptySession();
const monthCtx = mergeTravelContext(session, "下個月想去阿里山");
const daysCtx = mergeTravelContext(monthCtx.session, "直接排2天行程");
const advice = resolveDestinationAdvice(daysCtx.context, daysCtx.session, "直接排2天行程");
assert(advice.triggerItineraryGeneration === true, "直接排 triggers generation");
assert(advice.contextPatch?.days === 2, "parses 2 days");

// 6. mock places session has valid placeIds shape
const mockPlaces = [
  {
    name: "阿里山森林遊樂區",
    placeName: "阿里山森林遊樂區",
    placeId: "ChIJ_test1",
    googlePlaceId: "ChIJ_test1",
    address: "嘉義縣阿里山鄉中正村59號",
    lat: 23.508,
    lng: 120.801,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "2小時",
    googleMapsUrl: "",
    reasonSource: "template",
  },
  {
    name: "阿里山車站",
    placeName: "阿里山車站",
    placeId: "ChIJ_test2",
    googlePlaceId: "ChIJ_test2",
    address: "嘉義縣阿里山鄉",
    lat: 23.51,
    lng: 120.802,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1小時",
    googleMapsUrl: "",
    reasonSource: "template",
  },
  {
    name: "祝山觀日平台",
    placeName: "祝山觀日平台",
    placeId: "ChIJ_test3",
    googlePlaceId: "ChIJ_test3",
    address: "嘉義縣阿里山鄉",
    lat: 23.512,
    lng: 120.805,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1小時",
    googleMapsUrl: "",
    reasonSource: "template",
  },
];

assert(
  assertItineraryStopsHavePlaceIds(mockPlaces, "阿里山"),
  "mock places pass placeId validation",
);

const validPayload = normalizeTripPayload({
  title: "阿里山 2 天",
  summary: "test",
  moodTag: "",
  recommendations: [],
  itinerary: mockPlaces.map((p) => ({
    date: "2026-07-01",
    time: "10:00",
    title: p.name,
    placeName: p.placeName,
    description: "",
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    googlePlaceId: p.googlePlaceId,
  })),
});
assert(hasValidItineraryStops(validPayload, 3), "valid payload passes stop check");

// 7. fallback builder from selected places
const taipeiPlaces = [
  { name: "國立故宮博物院", placeName: "國立故宮博物院", googlePlaceId: "p1", lat: 25.1, lng: 121.5 },
  { name: "士林官邸", placeName: "士林官邸", googlePlaceId: "p2", lat: 25.09, lng: 121.52 },
  { name: "象山", placeName: "象山", googlePlaceId: "p3", lat: 25.03, lng: 121.57 },
  { name: "松山文創園區", placeName: "松山文創園區", googlePlaceId: "p4", lat: 25.04, lng: 121.56 },
];
const fallbackItems = buildFallbackItineraryFromPlaces(taipeiPlaces, 2, "2026-07-01");
assert(fallbackItems.length === 4, "fallback builds 4 stops");
assert(fallbackItems[0]?.time === "09:30", "first stop at 09:30");
assert(hasValidItineraryStops({ itinerary: fallbackItems }, 1), "fallback stops are valid");

const grouped = groupItineraryItemsByDay(fallbackItems, "2026-07-01");
assert(grouped.length >= 1, "grouped itinerary has days");
assert(grouped[0]?.stops.length >= 1, "day 1 has stops");

const wrappedSuccess = unwrapGeneratedTripPayload({
  success: true,
  trip: {
    id: "trip-1",
    title: "台北 2 天",
    destination: "台北",
    days: 2,
    itinerary: grouped,
    payload: normalizeTripPayload({
      title: "台北 2 天",
      summary: "test",
      moodTag: "",
      recommendations: [],
      itinerary: fallbackItems,
    }),
  },
});
assert(wrappedSuccess?.title === "台北 2 天", "unwrap success/trip payload");

const wrappedFailure = unwrapGeneratedTripPayload({
  success: false,
  errorCode: "insufficient_places",
  message: "no places",
});
assert(wrappedFailure === null, "failure result unwraps to null");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll itinerary guard checks passed");
