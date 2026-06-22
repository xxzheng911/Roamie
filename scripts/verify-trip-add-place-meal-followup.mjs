import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { buildDestinationAdviceReply } from "../src/lib/ai/destination-advice.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { mergeTripPlanningContext } from "../src/lib/ai/trip-planning-context.ts";
import { resolveConversationMode } from "../src/lib/ai/trip-planning-context.ts";
import {
  buildTripAddPlaceMealSummary,
  isTripMealRequestText,
  parseTripAddPlaceFollowUpIntent,
  reinforceTripAddPlaceSession,
} from "../src/lib/trip/trip-add-place-session.ts";
import {
  buildTripAddPlaceContext,
  prepareTripAddPlaceSession,
} from "../src/lib/trip/trip-add-place-handoff.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const fujiPayload = {
  version: 2,
  title: "日本富士山",
  summary: "",
  moodTag: "慢旅行",
  destination: "日本",
  destinationLocation: {
    placeId: "tokyo",
    country: "日本",
    city: "東京",
    lat: 35.68,
    lng: 139.76,
    formattedName: "東京",
    displayLabel: "東京",
  },
  recommendations: [],
  itinerary: [
    {
      date: "2026-07-04",
      time: "09:00",
      title: "富士山",
      placeName: "富士山",
      description: "",
      address: "山梨",
      lat: 35.36,
      lng: 138.73,
    },
    {
      date: "2026-07-04",
      time: "14:00",
      title: "河口湖",
      placeName: "河口湖湖畔",
      description: "",
      address: "山梨",
      lat: 35.51,
      lng: 138.76,
    },
  ],
  tripSettings: {
    tripStartDate: "2026-07-01",
    tripEndDate: "2026-07-05",
    transport: "transit",
    startTime: "09:00",
  },
};

const ctx = buildTripAddPlaceContext({
  stored: { id: "trip-fuji", payload: fujiPayload },
  payload: fujiPayload,
  settings: fujiPayload.tripSettings,
  dayIndex: 3,
  selectedDay: 4,
  dateKey: "2026-07-04",
  dayItems: fujiPayload.itinerary,
  dayCount: 5,
});

const session = prepareTripAddPlaceSession(ctx, {
  preferences: {},
  location: { lat: 35.51, lng: 138.76, city: "河口湖" },
  weather: null,
  time: "12:00",
  usedFallbackLocation: false,
});

const userText = "想再安排三餐";

assert(isTripMealRequestText(userText), "meal text detected");
assert(parseTripAddPlaceFollowUpIntent(userText) === "restaurant", "follow-up intent is restaurant");
assert(detectChatIntent(userText) === "restaurant", "detectChatIntent is restaurant");
assert(resolveChatIntent(userText, session) === "restaurant", "resolveChatIntent stays restaurant in trip add place");

const reinforced = reinforceTripAddPlaceSession(session, userText);
assert(reinforced.conversationMode === "trip_add_place", "conversation mode preserved");
assert(reinforced.fromTripAddPlace === true, "fromTripAddPlace preserved");
assert(reinforced.travelContext?.tripPurpose === "trip_add_place", "tripPurpose preserved");
assert(reinforced.travelContext?.destination === ctx.destination, "destination from trip context not Tokyo-only");

const mergedTravel = mergeTravelContext(reinforced, userText);
assert(mergedTravel.session.conversationMode === "trip_add_place", "mergeTravelContext keeps trip_add_place");
assert(mergedTravel.context.tripPurpose === "trip_add_place", "mergeTravelContext keeps trip purpose");

const planning = mergeTripPlanningContext(userText, mergedTravel.session, mergedTravel.context);
assert(planning.session.conversationMode === "trip_add_place", "mergeTripPlanningContext keeps trip_add_place");
assert(resolveConversationMode(userText, planning.session) === "trip_add_place", "resolveConversationMode is trip_add_place");

const route = resolveChatRoute(userText, mergedTravel.context, planning.session, "zh-TW", "restaurant");
assert(route.mode === "recommend", "route is recommend not advice");

const tokyoAdvice = buildDestinationAdviceReply(mergedTravel.context, planning.session, userText);
assert(tokyoAdvice === null, "destination advice suppressed in trip add place");

const mealSummary = buildTripAddPlaceMealSummary(ctx, [
  { name: "ほうとう不動 河口湖北本店", reason: "山梨名物餺飥麵" },
  { name: "Fuji Tempura Idaten", reason: "炸物、天婦羅" },
]);
assert(mealSummary.includes("第 4 天"), "meal summary mentions day");
assert(mealSummary.includes("富士山"), "meal summary mentions existing places");
assert(mealSummary.includes("河口湖"), "meal summary mentions kawaguchi");
assert(!mealSummary.includes("東京很適合城市美食"), "meal summary is not generic Tokyo");

if (failed > 0) process.exit(1);
console.log("\nAll trip add place meal follow-up checks passed.");
