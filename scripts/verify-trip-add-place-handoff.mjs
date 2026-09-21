import {
  buildTripAddPlaceContext,
  buildTripAddPlaceOpening,
  writeTripAddPlaceHandoff,
  consumeTripAddPlaceHandoff,
  prepareTripAddPlaceSession,
  fetchTripAddPlaceRecommendations,
  tripAddPlaceRecommendationsToSession,
} from "../src/lib/trip/trip-add-place-handoff.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

import {
  buildTripAddPlaceChatMessage,
  buildTripAddPlaceLoadingMessage,
  buildTripAddPlaceRenderFallbackMessage,
  tripAddPlaceLoadingBubbleText,
} from "../src/lib/trip/trip-add-place-render.ts";
import { tripAddPlaceEmptyHint } from "../src/lib/trip/trip-add-place-mode.ts";
import { resetShortcutProviderOrchestrationForTests } from "../src/lib/ai/chat-place-recommendation.ts";
import { chatLoadingCopy, chatMoodDisplay } from "../src/lib/chat-runtime-copy.ts";
import { placeOpeningStatusLabel } from "../src/lib/normalized-opening-status.ts";
import { openingCopyDisplay } from "../src/lib/native-qa-display.ts";
import { translate } from "../src/lib/i18n/translate.ts";
import { resolvePlannerStyleKey } from "../src/lib/ai/ai-day-plan-source.ts";
import { processTripAddPlaceUserMessage } from "../src/lib/trip/trip-add-place-recommendation-engine.ts";
import { buildTripAddPlaceBatchSummary } from "../src/lib/trip/trip-add-place-recommendation-session.ts";
import { getTripAddPlaceCopy } from "../src/lib/i18n/trip-add-place-copy.ts";
import { isTripAddPlaceMode } from "../src/lib/trip/trip-add-place-mode.ts";
import { finalizeChatRecommendationDisplay } from "../src/lib/chat-display-recommendations.ts";

// This script runs in Node; provide storage for the actual handoff roundtrip.
const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = { sessionStorage: globalThis.sessionStorage };

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

const opening = buildTripAddPlaceOpening(ctx, "zh-TW");
assert(opening === "當然可以！幫你找了幾個適合加入的地點 👇", "short first opening");

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

assert(JSON.stringify(consumed) === JSON.stringify(ctx), "handoff preserves full trip/day context");
assert(
  JSON.stringify(session.tripAddPlaceContext) === JSON.stringify(ctx),
  "session preserves full context",
);
assert(
  session.initialChatContext.includes("仲見世商店街"),
  "internal context retains existing names",
);
assert(!isTripAddPlaceMode(createEmptySession()), "general chat is not trip add place mode");

const names = [
  "東京水族館",
  "墨田美術館",
  "江戶博物館",
  "淺草展望台",
  "上野動物園",
  "隅田植物園",
  "東京科學館",
  "雷門美術館",
  "日本文化館",
  "向島水族館",
  "東京藝術館",
  "墨田展望台",
];
const fixtures = [...ctx.existingPlaceNames, ...names].map((name, index) => ({
  id: `fixture-${index}`,
  name,
  primaryType: "museum",
  types: ["museum", "tourist_attraction"],
  address: `東京都墨田區 ${index + 1} 號`,
  lat: 35.72 + index * 0.001,
  lng: 139.8,
  rating: 4.8,
  userRatingCount: 1000,
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  photoName: null,
}));
let searchCalls = 0;
const searchPlaces = async () => {
  searchCalls++;
  return { places: fixtures };
};
const first = await fetchTripAddPlaceRecommendations({ ctx, searchPlaces, locale: "zh-TW" });
assert(first.recommendations.length === 5, "first handoff produces five recommendation cards");
assert(first.summary === opening, "successful handoff has only the short opening");
const assertConcise = (summary, label) => {
  assert(
    ![...ctx.existingPlaceNames, ...names].some((name) => summary.includes(name)),
    `${label}: no existing or recommended names`,
  );
  assert(
    !/咖啡休息|景點散步|晚餐安排|你想|我看到你目前/.test(summary),
    `${label}: no old preference question or recap`,
  );
};
assertConcise(first.summary, "first");
assert(
  first.allCandidates.every((p) => !ctx.existingPlaceNames.includes(p.name)),
  "existing places excluded from candidate pool",
);
const withRecs = tripAddPlaceRecommendationsToSession(
  session,
  first.recommendations,
  first.recommendationSession,
);
const display = finalizeChatRecommendationDisplay(
  withRecs,
  "",
  first.summary,
  first.recommendations,
);
const message = buildTripAddPlaceChatMessage({ ...display, session: withRecs });
assert(
  message.structuredPlaces.length === 5 && message.roamie.recommendations.length === 5,
  "rendered message retains cards",
);
assert(
  JSON.stringify(message.roamie.recommendations) === JSON.stringify(first.recommendations),
  "card data unchanged through display",
);
assert(
  message.content === `當然可以！幫你找了${first.recommendations.length} 個適合加入的地點 👇`,
  "display preserves short opening with existing card-count alignment",
);
const callsBeforeMore = searchCalls;
const more = await processTripAddPlaceUserMessage({
  session: withRecs,
  userText: "還有嗎",
  msgs: [message],
  searchPlaces,
  locale: "zh-TW",
});
assert(more.recommendations.length > 0, "continuation returns another batch");
assert(more.summary === "再幫你找了幾個選擇 👇", "second batch uses continuation opening");
assertConcise(more.summary, "continuation");
assert(
  more.recommendations.every(
    (p) => !first.recommendations.some((prev) => prev.googlePlaceId === p.googlePlaceId),
  ),
  "shown places excluded",
);
assert(
  more.recommendations.every((p) => !ctx.existingPlaceNames.includes(p.name)),
  "continuation excludes itinerary places",
);
assert(searchCalls === callsBeforeMore, "continuation consumes existing ranked pool");
const beforeRec = withRecs.tripAddPlaceRecommendationSession;
const afterRec = more.nextSession.tripAddPlaceRecommendationSession;
for (const key of [
  "sessionId",
  "tripId",
  "dayIndex",
  "intent",
  "searchCenterLat",
  "searchCenterLng",
  "searchCenterPlaceId",
]) {
  assert(beforeRec[key] === afterRec[key], `continuation preserves ${key}`);
}
assert(
  JSON.stringify(afterRec.allCandidates) === JSON.stringify(beforeRec.allCandidates),
  "continuation preserves ranked pool",
);
assert(
  JSON.stringify(more.nextSession.tripAddPlaceContext) === JSON.stringify(ctx),
  "continuation preserves trip/day context",
);
const nextMessage = buildTripAddPlaceChatMessage({
  summary: more.summary,
  recommendations: more.recommendations,
  session: more.nextSession,
});
const again = await processTripAddPlaceUserMessage({
  session: more.nextSession,
  userText: "再推薦",
  msgs: [message, nextMessage],
  searchPlaces,
  locale: "en",
});
assert(
  again.recommendations.length > 0 && again.summary === getTripAddPlaceCopy("en").continuation,
  "再推薦 works with explicit English locale",
);
assert(
  again.recommendations.every(
    (p) =>
      ![...first.recommendations, ...more.recommendations].some(
        (prev) => prev.googlePlaceId === p.googlePlaceId,
      ),
  ),
  "later continuation excludes every shown batch",
);

resetShortcutProviderOrchestrationForTests();
for (const locale of ["zh-TW", "en", "ja", "ko"]) {
  const copy = getTripAddPlaceCopy(locale);
  const localized = await fetchTripAddPlaceRecommendations({ ctx, searchPlaces, locale });
  assert(localized.summary === copy.opening, `${locale}: handoff uses localized opening`);
  for (const intent of ["attraction", "cafe", "restaurant"]) {
    assert(
      buildTripAddPlaceBatchSummary(ctx, first.recommendations, {
        isFollowUp: true,
        intent,
        locale,
      }) === copy.continuation,
      `${locale}/${intent}: concise continuation`,
    );
  }
  resetShortcutProviderOrchestrationForTests();
  const empty = await fetchTripAddPlaceRecommendations({
    ctx,
    searchPlaces: async () => ({ places: [] }),
    locale,
  });
  assert(
    empty.recommendations.length === 0 &&
      empty.summary === copy.empty &&
      empty.summary !== copy.opening,
    `${locale}: empty result does not claim success`,
  );
  const missing = await fetchTripAddPlaceRecommendations({
    ctx: { ...ctx, lastPlace: undefined, destinationLocation: null },
    searchPlaces: async () => {
      throw new Error("must not search without anchor");
    },
    locale,
  });
  assert(
    missing.recommendations.length === 0 && missing.summary === copy.missingContext,
    `${locale}: missing context does not claim success`,
  );
}
resetShortcutProviderOrchestrationForTests();
const failedSearch = await fetchTripAddPlaceRecommendations({
  ctx,
  searchPlaces: async () => {
    throw new Error("fixture search failure");
  },
  locale: "zh-TW",
});
assert(
  failedSearch.recommendations.length === 0 &&
    failedSearch.summary === getTripAddPlaceCopy("zh-TW").empty,
  "existing search error-to-empty handling never claims success",
);

assert(ctx.travelStyle === "慢旅行", "handoff keeps slow-travel semantic, not a localized label");
assert(
  !JSON.stringify(ctx).includes("Slow travel"),
  "handoff payload does not store English badge display",
);
assert(
  !JSON.stringify(ctx).includes("Finding places that fit"),
  "handoff payload does not store loading display",
);
assert(
  resolvePlannerStyleKey("慢旅行") === "slow_nature",
  "slow-travel routing semantic unchanged",
);

const locales = ["zh-TW", "en", "ja", "ko"];
for (const locale of locales) {
  const loading = buildTripAddPlaceLoadingMessage(locale);
  assert(
    loading.loadingPhase === "itinerary_route_recommendation",
    `${locale}: loading phase is canonical`,
  );
  assert(
    tripAddPlaceLoadingBubbleText(loading, locale) ===
      chatLoadingCopy("itinerary_route_recommendation", locale),
    `${locale}: loading bubble projects from phase`,
  );
  assert(
    tripAddPlaceLoadingBubbleText(
      { loadingPhase: "itinerary_route_recommendation", content: "正在依照你的行程找順路地點…" },
      locale,
    ) === chatLoadingCopy("itinerary_route_recommendation", locale),
    `${locale}: stale Chinese loading snapshot is not the display authority`,
  );
  const tagged = buildTripAddPlaceChatMessage({
    summary: getTripAddPlaceCopy(locale).opening,
    recommendations: first.recommendations.slice(0, 1),
    moodTag: "慢旅行",
    session,
    locale,
  });
  assert(tagged.roamie.moodTag === "慢旅行", `${locale}: stored badge semantic stays 慢旅行`);
  assert(
    tagged.content === getTripAddPlaceCopy(locale).opening,
    `${locale}: intro stays localized opening`,
  );
  assert(
    chatMoodDisplay(tagged.roamie.moodTag, locale) === chatMoodDisplay("slow_travel", locale),
    `${locale}: badge projects slow travel`,
  );
  if (locale !== "zh-TW") {
    assert(!loading.content.includes("正在依照你的行程"), `${locale}: loading bubble is not zh-TW`);
    assert(
      !chatMoodDisplay(tagged.roamie.moodTag, locale).includes("慢旅行"),
      `${locale}: badge is not zh-TW`,
    );
  }
  const failedCards = buildTripAddPlaceRenderFallbackMessage(session, { locale });
  assert(
    failedCards.content === getTripAddPlaceCopy(locale).renderFailed,
    `${locale}: render failure copy`,
  );
  assert(
    tripAddPlaceEmptyHint(locale) === getTripAddPlaceCopy(locale).emptyHint,
    `${locale}: empty hint`,
  );
  assert(
    placeOpeningStatusLabel({ openStatus: "open" }, locale) === translate(locale, "place.open"),
    `${locale}: place open state`,
  );
  assert(
    openingCopyDisplay("今日營業中", locale) === translate(locale, "nativeQa.todayOpen"),
    `${locale}: today-open hours authority unchanged`,
  );
  assert(
    translate(locale, "productionUi.pff48c58ecc").trim().length > 0,
    `${locale}: add-to-itinerary action`,
  );
}
assert(
  chatMoodDisplay("慢旅行", "en") === "Slow travel",
  "zh-TW itinerary mood projects to English on a new handoff",
);
assert(
  buildTripAddPlaceLoadingMessage("en").content.startsWith("Finding places that fit naturally"),
  "en handoff loading",
);
assert(
  translate("en", "nativeQa.todayHours", { time: "Open 24 hours" }) === "Today Open 24 hours",
  "hours line authority unchanged",
);

if (failed > 0) process.exit(1);
console.log("\nAll trip add place handoff checks passed.");
