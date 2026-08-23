import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { beginHomeMoodShortcutSession } from "../src/lib/home-mood-shortcut-session.ts";
import { shouldFetchDestinationCategoryPlaces } from "../src/lib/ai/chat-place-intent.ts";
import {
  isolateHomeShortcutFromPlanning,
  isStructuredHomeNearbyShortcut,
  resolveHomeShortcutSearchProfile,
} from "../src/lib/ai/home-shortcut-handoff.ts";
import { isDestinationPlanningSession } from "../src/lib/ai/chat-conversation-state.ts";
import {
  resolveNearbyShortcutScene,
  resolveNormalizedShortcutRequestFromText,
} from "../src/lib/ai/chat-intent.ts";
import {
  buildHomeSeaRecommendationDescription,
  buildSummaryForRecommendations,
  fetchNearbyPlacesForIntent,
} from "../src/lib/ai/chat-place-recommendation.ts";
import { resolveChatIntentArbitration } from "../src/lib/ai/recommendation-refinement/arbitrate.ts";
import { ensureActiveRecommendationContext } from "../src/lib/ai/recommendation-refinement/session.ts";
import {
  filterHomeSeaCandidates,
  HOME_SEA_LOCATION_BIAS_RADIUS_M,
  homeSeaCandidateScore,
  rankHomeSeaCandidates,
} from "../src/lib/home-sea-ranking.ts";
import { homeLateNightSearchAttempts } from "../src/lib/home-nearby-search.ts";
import {
  selectHomeNearbyPicks,
} from "../src/lib/home-nearby-places-filter.ts";
import {
  homeLateNightRecommendationTier,
  sortHomeNearbyPlacesWithContext,
} from "../src/lib/home-nearby-ranking.ts";
import { normalizeHomeMoodId } from "../src/lib/home-mood-options.ts";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";

function homeSession(label, id) {
  return beginHomeMoodShortcutSession(createEmptySession(), label, id);
}

const coffeeText = "我想找安靜的咖啡廳";
const coffee = homeSession(coffeeText, "coffee");
assert.equal(isStructuredHomeNearbyShortcut(coffee), true);
assert.equal(
  shouldFetchDestinationCategoryPlaces(coffeeText, { interests: [] }, coffee),
  false,
  "Home Coffee must bypass pending destination/category interception",
);

const lateNightRankFixtures = [
  ["餐酒館 A", "restaurant", ["restaurant"]],
  ["餐酒館 B", "restaurant", ["restaurant"]],
  ["餐酒館 C", "restaurant", ["restaurant"]],
  ["夜貓深夜咖啡", "cafe", ["cafe", "coffee_shop"]],
  ["雞白湯拉麵", "restaurant", ["restaurant", "ramen_restaurant"]],
  ["港邊夜景展望台", "tourist_attraction", ["tourist_attraction"]],
].map(([name, primaryType, types], index) => ({
  id: `ChIJ-night-rank-${index}`,
  name,
  primaryType,
  types,
  openStatus: "open",
  rating: 4.4,
  userRatingCount: 100,
  lat: 22.63 + index * 0.0001,
  lng: 120.3,
}));
assert.equal(homeLateNightRecommendationTier(lateNightRankFixtures[0]), 1);
assert.equal(homeLateNightRecommendationTier(lateNightRankFixtures[4]), 2);
assert.equal(homeLateNightRecommendationTier(lateNightRankFixtures[5]), 3);
const diversifiedNight = sortHomeNearbyPlacesWithContext(
  lateNightRankFixtures,
  { lat: 22.63, lng: 120.3 },
  { period: "late_night", timeZone: "Asia/Taipei" },
);
assert.equal(
  diversifiedNight.slice(0, 5).filter((place) => /餐酒館/.test(place.name)).length <= 2,
  true,
  "Top picks must not be monopolized by one night-drinks bucket",
);
assert.equal(
  diversifiedNight.slice(0, 5).some((place) => /深夜咖啡/.test(place.name)),
  true,
);
assert.equal(
  diversifiedNight.slice(0, 5).some((place) => /拉麵/.test(place.name)),
  true,
);
assert.equal(resolveNearbyShortcutScene(coffeeText, coffee), "quiet_cafe");
assert.equal(coffee.location, undefined, "location remains runtime-resolved current location");

const lateNight = homeSession("夜晚散策", "lateNight");
assert.equal(lateNight.normalizedShortcutRequest?.mode, "late_night");
assert.equal(lateNight.normalizedShortcutRequest?.source, "home_mood");
assert.equal(lateNight.normalizedShortcutRequest?.intent, "nearby_recommendation");
assert.equal(
  resolveNormalizedShortcutRequestFromText("夜晚散策", "chat_shortcut"),
  null,
  "Visible Home label must not become a generic Chat/free-text shortcut",
);
assert.equal(resolveHomeShortcutSearchProfile(lateNight), "home_late_night");
assert.equal(resolveNearbyShortcutScene("我想夜晚散策，幫我看看附近適合去哪裡。", lateNight), null);
assert.equal(
  resolveChatIntentArbitration("我想夜晚散策，幫我看看附近適合去哪裡。", lateNight).route,
  "NEW_RECOMMENDATION",
);
const stickyPlanningSession = beginHomeMoodShortcutSession(
  {
    ...createEmptySession(),
    conversationMode: "destination_planning",
    chatPlanningState: "waitingTripDays",
    pendingQuestion: { type: "ask_days", options: [] },
    activeCategoryIntent: "restaurant",
    activeRecommendationContext: {
      intent: "restaurant",
      previousPlaceIds: [],
      previousPlaces: [],
    },
    travelContext: {
      interests: [],
      lastIntent: "create_itinerary",
      tripPurpose: "create_itinerary",
    },
  },
  "夜晚散策",
  "lateNight",
);
assert.equal(
  resolveChatIntentArbitration("我想夜晚散策，幫我看看附近適合去哪裡。", stickyPlanningSession)
    .route,
  "NEW_RECOMMENDATION",
  "Home structured authority must beat sticky trip planning before isolation",
);
const isolatedLateNight = isolateHomeShortcutFromPlanning(stickyPlanningSession);
assert.equal(isolatedLateNight.pendingQuestion, undefined);
assert.equal(isolatedLateNight.activeRecommendationContext, undefined);
assert.equal(isolatedLateNight.activeCategoryIntent, "attraction");
assert.equal(resolveHomeShortcutSearchProfile(isolatedLateNight), "home_late_night");
assert.deepEqual(
  homeLateNightSearchAttempts().map((attempt) => attempt.id),
  ["night_bar", "night_food", "night_cafe"],
);
const nightCandidates = Array.from({ length: 6 }, (_, index) => ({
  id: `ChIJ-home-night-${index}`,
  name: `深夜餐酒館 ${index}`,
  address: "高雄市",
  lat: 22.63 + index * 0.0001,
  lng: 120.3,
  rating: 4.3,
  userRatingCount: 80,
  photoName: `places/night-${index}/photos/1`,
  primaryType: "restaurant",
  types: ["restaurant", "bar"],
  businessStatus: "OPERATIONAL",
  openStatus: "open",
  openStatusLabel: "營業中",
}));
assert.equal(
  selectHomeNearbyPicks(nightCandidates, {
    origin: { lat: 22.63, lng: 120.3 },
    period: "late_night",
    minResults: 4,
    maxResults: 5,
    timeZone: "Asia/Taipei",
  }).length,
  5,
  "Home Late Night profile must reuse existing Home selection policy",
);

const seaWithPlannerState = {
  ...homeSession("想去海邊走走", "sea"),
  pendingQuestion: { type: "ask_days", options: [] },
  conversationMode: "destination_planning",
  tripPlanningContext: {
    selectedPlaces: [],
    destination: "東京",
    days: 3,
    intent: "destination_planning",
  },
  tripDestination: { city: "東京", displayLabel: "東京", country: "", lat: 0, lng: 0, placeId: "" },
  travelContext: { interests: [], destination: "東京", days: 3, tripPurpose: "coastal" },
};
const isolatedSea = isolateHomeShortcutFromPlanning(seaWithPlannerState);
assert.equal(isolatedSea.pendingQuestion, undefined);
assert.equal(isolatedSea.tripPlanningContext?.destination, undefined);
assert.equal(isolatedSea.travelContext?.destination, undefined);
assert.equal(isolatedSea.tripDestination, undefined);
assert.equal(isDestinationPlanningSession(isolatedSea), false);
assert.equal(resolveHomeShortcutSearchProfile(isolatedSea), "home_sea");
assert.equal(resolveNearbyShortcutScene("我想看海放鬆一下", isolatedSea), null);
assert.equal(isolatedSea.activeCategoryIntent, "attraction");

const seaPlace = (name, primaryType, types, overrides = {}) => ({
  id: `ChIJ-sea-${name}`,
  name,
  address: "高雄市",
  lat: 22.62,
  lng: 120.27,
  rating: 4.5,
  userRatingCount: 300,
  photoName: "places/sea/photos/1",
  primaryType,
  types,
  businessStatus: "OPERATIONAL",
  openStatus: "open",
  openStatusLabel: "營業中",
  todayHoursLabel: "營業中",
  closingSoonNote: "",
  nextOpenHint: "",
  ...overrides,
});
const beach = seaPlace("旗津海水浴場", "beach", ["beach", "tourist_attraction"]);
const waterfront = seaPlace("海濱景觀步道", "tourist_attraction", ["tourist_attraction"]);
const inlandPark = seaPlace("中央公園", "park", ["park"]);
const sizihwan = seaPlace(
  "西子灣風景區",
  "tourist_attraction",
  ["tourist_attraction", "scenic_spot"],
  {
    id: "ChIJ-sea-sizihwan",
    lat: 22.625,
    lng: 120.264,
  },
);
const inlandScenic = seaPlace(
  "山頂風景區",
  "tourist_attraction",
  ["tourist_attraction", "scenic_spot"],
  {
    id: "ChIJ-inland-scenic",
  },
);
const accidentalSeaRestaurant = seaPlace("海天下餐廳", "restaurant", ["restaurant"]);
const residentialSea = seaPlace("海景帝寶大樓", "apartment_complex", [
  "apartment_complex",
  "premise",
]);
assert.equal(homeSeaCandidateScore(beach) > homeSeaCandidateScore(waterfront), true);
assert.deepEqual(
  filterHomeSeaCandidates([
    beach,
    waterfront,
    sizihwan,
    inlandPark,
    inlandScenic,
    accidentalSeaRestaurant,
    residentialSea,
  ]).map((place) => place.name),
  ["旗津海水浴場", "海濱景觀步道", "西子灣風景區"],
);
const seaRequests = [];
const seaResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => {
    seaRequests.push(data);
    return { places: [beach, waterfront, inlandPark, accidentalSeaRestaurant], error: null };
  },
  undefined,
  { interests: ["海邊", "散步"], tripPurpose: "coastal" },
  [],
  {
    userText: "我想看海放鬆一下，幫我找幾個適合去的地方。",
    shortcutScene: null,
    searchProfile: "home_sea",
  },
);
assert.equal(seaRequests.length, 3);
assert.equal(
  seaRequests.every((request) => request.mode === "text"),
  true,
);
assert.equal(
  seaRequests.every((request) => request.radius === HOME_SEA_LOCATION_BIAS_RADIUS_M),
  true,
);
assert.deepEqual(
  seaResults.map((place) => place.name),
  ["旗津海水浴場", "海濱景觀步道"],
);

const equallyRelevantNear = seaPlace("近岸海濱步道", "tourist_attraction", ["tourist_attraction"], {
  id: "ChIJ-sea-near",
  lat: 22.6345,
  lng: 120.3,
  rating: 4.0,
  userRatingCount: 20,
});
const equallyRelevantFar = seaPlace("遠岸海濱步道", "tourist_attraction", ["tourist_attraction"], {
  id: "ChIJ-sea-far",
  lat: 22.657,
  lng: 120.3,
  rating: 4.9,
  userRatingCount: 5_000,
});
assert.deepEqual(
  rankHomeSeaCandidates([equallyRelevantFar, equallyRelevantNear], { lat: 22.63, lng: 120.3 }).map(
    (place) => place.id,
  ),
  ["ChIJ-sea-near", "ChIJ-sea-far"],
  "Equal Sea relevance must prefer the nearer candidate before rating/reviews",
);
assert.deepEqual(
  rankHomeSeaCandidates([inlandPark, equallyRelevantFar], { lat: 22.63, lng: 120.3 })[0]?.id,
  "ChIJ-sea-far",
  "A genuinely coastal farther candidate must beat a nearby non-Sea candidate",
);
const seaSummary = buildSummaryForRecommendations(
  "restaurant",
  [{ name: "蚵仔寮海邊沙灘", placeName: "蚵仔寮海邊沙灘" }],
  { interests: [] },
  [],
  "relax_walk",
  "home_sea",
);
assert.match(seaSummary, /適合看海走走/);
assert.doesNotMatch(seaSummary, /換個菜系|預算|正餐|好好吃頓飯/);
const coastalRestaurantReason = buildHomeSeaRecommendationDescription(
  seaPlace("港灣景觀餐廳", "restaurant", ["restaurant"], { address: "高雄港灣碼頭旁" }),
);
assert.match(coastalRestaurantReason, /港灣|碼頭|看海/);
assert.doesNotMatch(coastalRestaurantReason, /菜系|預算|正餐|好好吃頓飯|餐廳/);

const committedSeaContext = ensureActiveRecommendationContext(isolatedSea, {
  destination: "附近",
  intent: "attraction",
  places: [beach, waterfront],
  searchScope: "current_location",
  shortcutSource: "home_mood",
  shortcutMode: "sea",
  searchProfile: "home_sea",
});
const seaContinuationSession = {
  ...isolatedSea,
  activeRecommendationContext: committedSeaContext,
};
assert.equal(resolveHomeShortcutSearchProfile(seaContinuationSession), "home_sea");
assert.equal(seaContinuationSession.activeRecommendationContext.shortcutSource, "home_mood");
assert.equal(seaContinuationSession.activeRecommendationContext.shortcutMode, "sea");
assert.equal(seaContinuationSession.activeRecommendationContext.previousPlaceIds.length, 2);
const secondSeaResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async () => ({ places: [beach, waterfront, sizihwan], error: null }),
  undefined,
  { interests: ["海邊", "散步"], tripPurpose: "more_place_recommendations" },
  committedSeaContext.previousPlaceIds,
  { userText: "還有嗎", searchProfile: "home_sea" },
);
assert.deepEqual(
  secondSeaResults.map((place) => place.id),
  ["ChIJ-sea-sizihwan"],
);

const committedNightContext = ensureActiveRecommendationContext(isolatedLateNight, {
  destination: "附近",
  intent: "attraction",
  places: nightCandidates.slice(0, 5),
  searchScope: "current_location",
  shortcutSource: "home_mood",
  shortcutMode: "late_night",
  searchProfile: "home_late_night",
});
assert.equal(
  resolveHomeShortcutSearchProfile({
    ...isolatedLateNight,
    activeRecommendationContext: committedNightContext,
  }),
  "home_late_night",
);
assert.equal(committedNightContext.previousPlaceIds.length, 5);

const homeSelectedDisplayFixture = {
  name: "Home 已選深夜餐廳",
  type: "restaurant",
  primaryType: "restaurant",
  types: ["restaurant", "bar"],
  description: "",
  reason: "",
  estimatedTime: "",
  address: "高雄市",
  lat: 22.63,
  lng: 120.3,
  googleMapsUrl: "",
  placeName: "Home 已選深夜餐廳",
  reasonSource: "template",
  googlePlaceId: "ChIJ-home-selected-display",
  rating: 4.3,
  userRatingCount: 80,
  businessStatus: "OPERATIONAL",
  openStatusLabel: "營業中",
};
const homeDisplaySession = {
  ...isolatedLateNight,
  activeChatIntent: "attraction",
  activeRecommendationContext: committedNightContext,
  travelContext: {
    ...(isolatedLateNight.travelContext ?? { interests: [] }),
    tripPurpose: "more_place_recommendations",
  },
};
assert.equal(
  recommendationsForChatDisplay(homeDisplaySession, "還有嗎", [homeSelectedDisplayFixture]).length,
  1,
  "Home-selected cards must not be re-rejected by the ai_recommend quality contract",
);
assert.equal(
  recommendationsForChatDisplay(
    { ...createEmptySession(), activeChatIntent: "attraction" },
    "附近推薦",
    [homeSelectedDisplayFixture],
  ).length,
  0,
  "Generic Chat/AI recommendations must retain the existing ai_recommend quality gate",
);

// Late-night continuation: exact previous IDs must not remove distinct provider candidates.
const oneCardFirstTurnPool = [
  nightCandidates[0],
  ...nightCandidates.slice(1, 4).map((place, index) => ({
    ...place,
    id: `ChIJ-night-ineligible-${index}`,
    name: `一般景點 ${index}`,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    rating: 0,
    userRatingCount: 0,
    openStatus: "unknown",
  })),
];
const firstTurnNightPicks = selectHomeNearbyPicks(oneCardFirstTurnPool, {
  origin: { lat: 22.63, lng: 120.3 },
  period: "late_night",
  minResults: 4,
  maxResults: 5,
});
assert.deepEqual(
  firstTurnNightPicks.map((place) => place.id),
  [nightCandidates[0].id],
);
const firstCommittedNightContext = ensureActiveRecommendationContext(isolatedLateNight, {
  destination: "附近",
  intent: "attraction",
  places: firstTurnNightPicks,
  searchScope: "current_location",
  shortcutSource: "home_mood",
  shortcutMode: "late_night",
  searchProfile: "home_late_night",
});
assert.equal(firstCommittedNightContext.previousPlaceIds.length, 1);

const distinctEligibleNightPool = nightCandidates.slice(0, 4);
const lateNightWaveCalls = [];
const secondNightResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => {
    lateNightWaveCalls.push(data.query);
    return { places: distinctEligibleNightPool, error: null };
  },
  undefined,
  { interests: [], tripPurpose: "more_place_recommendations" },
  [distinctEligibleNightPool[0].id],
  { userText: "還有嗎", searchProfile: "home_late_night" },
);
assert.deepEqual(lateNightWaveCalls, [
  "居酒屋 酒吧 宵夜 餐酒",
  "宵夜 拉麵 燒肉 火鍋 串燒",
  "深夜咖啡 甜點",
]);
assert.deepEqual(
  secondNightResults.map((place) => place.id),
  distinctEligibleNightPool.slice(1).map((place) => place.id),
  "Only the exact first-turn Place ID may be removed from late-night continuation",
);

const zeroedSecondTurnPool = oneCardFirstTurnPool.slice(1);
assert.equal(
  selectHomeNearbyPicks(zeroedSecondTurnPool, {
    origin: { lat: 22.63, lng: 120.3 },
    period: "late_night",
    minResults: 4,
    maxResults: 5,
  }).length,
  0,
);
const firstOpenNight = { ...nightCandidates[0], id: "ChIJ-night-first-open" };
const closedNightCandidates = nightCandidates.slice(1, 4).map((place, index) => ({
  ...place,
  id: `ChIJ-night-closed-${index}`,
  openStatus: "closed_now",
  openStatusLabel: "目前未營業",
}));
const firstLateNightResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async () => ({ places: [firstOpenNight, ...closedNightCandidates], error: null }),
  undefined,
  { interests: [] },
  [],
  { userText: "夜晚散策", searchProfile: "home_late_night" },
);
assert.deepEqual(
  firstLateNightResults.map((place) => place.id),
  [firstOpenNight.id],
);
const firstLateNightMemory = ensureActiveRecommendationContext(isolatedLateNight, {
  destination: "附近",
  intent: "attraction",
  places: firstLateNightResults,
  searchScope: "current_location",
  shortcutSource: "home_mood",
  shortcutMode: "late_night",
  searchProfile: "home_late_night",
});
assert.equal(firstLateNightMemory.previousPlaceIds.length, 1);

const expandedOpenNight = {
  ...nightCandidates[4],
  id: "ChIJ-night-expanded-open",
  lat: 22.665,
  openStatus: "open",
};
const expansionRadii = [];
const expansionRequests = [];
const expandedLateNightResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => {
    expansionRadii.push(data.radius);
    expansionRequests.push(data);
    return {
      places:
        data.radius > 2_500
          ? [firstOpenNight, ...closedNightCandidates, expandedOpenNight]
          : [firstOpenNight, ...closedNightCandidates],
      error: null,
    };
  },
  undefined,
  { interests: [], tripPurpose: "more_place_recommendations" },
  [firstOpenNight.id],
  {
    userText: "還有嗎",
    searchProfile: "home_late_night",
  },
);
assert.deepEqual(
  expandedLateNightResults.map((place) => place.id),
  [expandedOpenNight.id],
);
assert.deepEqual([...new Set(expansionRadii)], [2_500, 5_000]);
assert.deepEqual(
  expansionRequests.filter((request) => request.radius === 5_000).map((request) => request.mode),
  ["text", "text", "text"],
);
assert.deepEqual(
  expansionRequests.filter((request) => request.radius === 5_000).map((request) => request.query),
  [
    "居酒屋 酒吧 餐酒館 深夜營業",
    "宵夜 深夜食堂 拉麵 燒肉 火鍋 串燒",
    "深夜咖啡 24小時咖啡 夜間甜點",
  ],
);
const exhaustedRadii = [];
const exhaustedLateNightResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => {
    exhaustedRadii.push(data.radius);
    return { places: [firstOpenNight, ...closedNightCandidates], error: null };
  },
  undefined,
  { interests: [], tripPurpose: "more_place_recommendations" },
  [firstOpenNight.id],
  {
    userText: "還有嗎",
    searchProfile: "home_late_night",
  },
);
assert.equal(exhaustedLateNightResults.length, 0);
assert.deepEqual([...new Set(exhaustedRadii)], [2_500, 5_000]);

const newClosedCandidates = closedNightCandidates.map((place, index) => ({
  ...place,
  id: `ChIJ-night-expanded-closed-${index}`,
  lat: 22.66 + index * 0.0001,
}));
const newClosedResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => ({
    places:
      data.radius > 2_500
        ? newClosedCandidates
        : closedNightCandidates,
    error: null,
  }),
  undefined,
  { interests: [], tripPurpose: "more_place_recommendations" },
  [],
  {
    userText: "還有嗎",
    searchProfile: "home_late_night",
  },
);
assert.equal(newClosedResults.length, 0);

const previousOnlyOpen = {
  ...expandedOpenNight,
  id: "ChIJ-night-previous-only-open",
};
const previousOpenResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => ({
    places:
      data.radius > 2_500
        ? [...closedNightCandidates, previousOnlyOpen]
        : closedNightCandidates,
    error: null,
  }),
  undefined,
  { interests: [], tripPurpose: "more_place_recommendations" },
  [previousOnlyOpen.id],
  {
    userText: "還有嗎",
    searchProfile: "home_late_night",
  },
);
assert.equal(previousOpenResults.length, 0);

const insufficientQualityCandidates = nightCandidates.slice(1, 4).map((place, index) => ({
  ...place,
  id: `ChIJ-night-low-quality-${index}`,
  rating: 0,
  userRatingCount: 0,
  openStatus: "unknown",
}));
const nonClosedRadii = [];
const nonClosedResults = await fetchNearbyPlacesForIntent(
  "attraction",
  22.63,
  120.3,
  "zh-TW",
  async ({ data }) => {
    nonClosedRadii.push(data.radius);
    return { places: insufficientQualityCandidates, error: null };
  },
  undefined,
  { interests: [], tripPurpose: "more_place_recommendations" },
  [],
  {
    userText: "還有嗎",
    searchProfile: "home_late_night",
  },
);
assert.equal(nonClosedResults.length, 0);
assert.deepEqual([...new Set(nonClosedRadii)], [2_500]);

const chatRelax = resolveNormalizedShortcutRequestFromText("今天想放鬆走走", "chat_shortcut");
const chatRainy = resolveNormalizedShortcutRequestFromText("下雨天去哪裡", "chat_shortcut");
const chatCoffee = resolveNormalizedShortcutRequestFromText("找間安靜咖啡廳", "chat_shortcut");
assert.equal(chatRelax?.mode, "relax");
assert.equal(chatRainy?.mode, "rainy");
assert.equal(chatCoffee?.mode, "coffee");

const chatRouteSource = await readFile(
  new URL("../src/routes/_app.chat.tsx", import.meta.url),
  "utf8",
);
const messagesSource = await readFile(
  new URL("../src/lib/i18n/messages.ts", import.meta.url),
  "utf8",
);
assert.match(messagesSource, /lateNight: "夜晚散策"/);
assert.match(messagesSource, /lateNight: "我想夜晚散策，幫我看看附近適合去哪裡。"/);
assert.equal(normalizeHomeMoodId("夜晚散策"), "lateNight");
assert.match(
  chatRouteSource,
  /if \(!structuredHomeNearbyTurn\) \{\s*nextSession = prepareSessionForUserTurn/,
  "Home structured turns must not recover Planner pending state from assistant copy",
);
assert.match(chatRouteSource, /const merged = structuredHomeNearbyTurn\s*\?/);
assert.match(
  chatRouteSource,
  /if \(!structuredHomeNearbyTurn\) \{\s*nextSession = extractPlanningHintsFromText/,
);
assert.match(chatRouteSource, /searchProfile: resolveHomeShortcutSearchProfile\(sessionForSave\)/);
assert.match(chatRouteSource, /searchProfile: resolveHomeShortcutSearchProfile\(sessionForSave\)/);

console.log("✓ Home Coffee bypasses pending destination and keeps quiet_cafe");
console.log("✓ Home Late Night uses home_late_night waves and selection policy");
console.log("✓ Home Night Walk uses tiered cuisine/scenic boosts and diversified Top Picks");
console.log("✓ Home visible copy uses 夜晚散策 while mode remains late_night");
console.log("✓ Home Sea clears Planner authority and skips pending recovery");
console.log("✓ Home Sea uses location-biased 50km text searches and coastal fidelity ranking");
console.log("✓ Chat Relax/Rainy/Coffee normalization remains unchanged");
