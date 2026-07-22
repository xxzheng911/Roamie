/**
 * Shopping Place Cards + Recommendation Session continuation guards.
 */
import assert from "node:assert/strict";
import { shouldSuppressChatPlaceCards } from "../src/lib/ai/chat-suppress-place-cards.ts";
import {
  isShoppingPlace,
  passesShoppingRenderGuard,
  filterRecommendationsForCategoryRender,
  resolveShoppingTypeAlias,
  SHOPPING_TYPE_ALIAS_LIST,
} from "../src/lib/ai/chat-category-place-guard.ts";
import {
  buildPlaceRecommendationReason,
  resolveIdentityForReason,
} from "../src/lib/build-place-recommendation-reason.ts";
import {
  createRecommendationSession,
  continueRecommendation,
  isContinueRecommendationRequest,
  detectTopicSwitchIntent,
  RECOMMENDATION_BATCH_SIZE,
} from "../src/lib/ai/conversation-recommendation-session.ts";
import { hasPriorPlaceRecommendations } from "../src/lib/ai/chat-recommendation-refresh.ts";
import { shouldUpsertDraftWorkspace } from "../src/lib/conversation-workspace/sync.ts";

// ── Place cards not suppressed during shopping recommend ──
assert.equal(
  shouldSuppressChatPlaceCards({
    conversationMode: "destination_planning",
    phase: "recommend",
    activeCategoryIntent: "shopping",
    pendingQuestion: { type: "combination_choice" },
    travelContext: { tripPurpose: "recommend_places", interests: [] },
    recommendedPlaces: [],
    selectedPlaces: [],
    plannedStops: [],
  }),
  false,
  "shopping recommend_places must show cards even with stale combination_choice",
);

assert.equal(
  shouldSuppressChatPlaceCards({
    conversationMode: "destination_planning",
    phase: "discover",
    pendingQuestion: { type: "combination_choice" },
    travelContext: { tripPurpose: "combination_suggestions_offered", interests: [] },
    recommendedPlaces: [],
    selectedPlaces: [],
    plannedStops: [],
  }),
  true,
  "combination flow still suppresses cards",
);

// ── Shopping guard accepts typed malls; rejects deck / park ──
assert.equal(
  isShoppingPlace({
    name: "大丸札幌店",
    primaryType: "department_store",
    types: ["department_store", "shopping_mall"],
  }),
  true,
);
assert.equal(
  passesShoppingRenderGuard({
    name: "PARCO",
    placeName: "PARCO",
    type: "shopping_mall",
    types: ["shopping_mall"],
    description: "",
    reason: "",
    estimatedTime: "",
    address: "札幌",
    lat: 43,
    lng: 141,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: "gp_parco",
  }),
  true,
);
assert.equal(
  passesShoppingRenderGuard({
    name: "JR塔展望室",
    placeName: "JR塔展望室",
    type: "observation_deck",
    types: ["observation_deck"],
    description: "",
    reason: "",
    estimatedTime: "",
    address: "",
    lat: null,
    lng: null,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: "gp_deck",
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "Marunouchi Street Park",
    primaryType: "park",
    types: ["park"],
  }),
  false,
  "Marunouchi Street Park must not pass shopping gate",
);

// Shopping type aliases
for (const alias of [
  "shopping_mall",
  "department_store",
  "store",
  "shopping_center",
  "outlet_store",
  "outlet_mall",
  "commercial_complex",
  "retail",
  "shopping_street",
  "underground_mall",
  "fashion_building",
  "gift_shop",
  "home_goods_store",
]) {
  assert.ok(
    resolveShoppingTypeAlias(alias) || SHOPPING_TYPE_ALIAS_LIST.includes(alias),
    `alias mapping missing for ${alias}`,
  );
}
assert.equal(resolveShoppingTypeAlias("home_goods_store"), "home_goods_store");
assert.equal(resolveShoppingTypeAlias("auto_parts_store"), null);

// Intent-locked shopping reason must never use restaurant template
const coins = {
  name: "3COINS SAPPORO APIA",
  primaryType: "home_goods_store",
  types: ["home_goods_store", "store", "food", "point_of_interest"],
};
assert.equal(
  resolveIdentityForReason(coins, { categoryIntent: "shopping" }),
  "shopping_mall",
);
const coinsReason = buildPlaceRecommendationReason(coins, null, null, undefined, {
  categoryIntent: "shopping",
  categoryLabel: "購物／商圈",
});
assert.equal(/餐廳|正餐|肚子/.test(coinsReason), false, coinsReason);
assert.equal(/逛街|伴手禮|品牌|購物|雨天/.test(coinsReason), true, coinsReason);

const batch = filterRecommendationsForCategoryRender(
  [
    {
      name: "狸小路商店街",
      placeName: "狸小路商店街",
      type: "shopping_mall",
      types: ["shopping_mall"],
      description: "",
      reason: "",
      estimatedTime: "",
      address: "",
      lat: null,
      lng: null,
      googleMapsUrl: "",
      reasonSource: "template",
      googlePlaceId: "a",
    },
    {
      name: "大通公園",
      placeName: "大通公園",
      type: "park",
      types: ["park"],
      description: "",
      reason: "",
      estimatedTime: "",
      address: "",
      lat: null,
      lng: null,
      googleMapsUrl: "",
      reasonSource: "template",
      googlePlaceId: "b",
    },
    {
      name: "三井Outlet",
      placeName: "三井Outlet",
      type: "shopping_mall",
      types: ["shopping_mall"],
      description: "",
      reason: "",
      estimatedTime: "",
      address: "",
      lat: null,
      lng: null,
      googleMapsUrl: "",
      reasonSource: "template",
      googlePlaceId: "c",
    },
  ],
  "shopping",
  "有購物行程推薦嗎",
);
assert.deepEqual(
  batch.map((p) => p.name),
  ["狸小路商店街", "三井Outlet"],
);

// ── 「還有嗎」continues same shopping session ──
const pool = ["a", "b", "c", "d", "e"].map((id, i) => ({
  name: `Shop ${i + 1}`,
  placeName: `Shop ${i + 1}`,
  type: "shopping_mall",
  description: "",
  reason: "",
  estimatedTime: "",
  address: "",
  lat: null,
  lng: null,
  googleMapsUrl: "",
  reasonSource: "template",
  googlePlaceId: id,
}));
const { session: rec } = createRecommendationSession({
  destination: "北海道",
  topic: "shopping",
  pool,
  batchSize: 2,
});
const cont = continueRecommendation(rec, 2);
assert.deepEqual(
  cont.batch.map((p) => p.googlePlaceId),
  ["c", "d"],
);

const planning = {
  recommendationSession: cont.session,
  activeCategoryIntent: "shopping",
  travelContext: { destination: "北海道", tripPurpose: "recommend_places", interests: [] },
  recommendedPlaces: cont.batch,
  selectedPlaces: [],
  plannedStops: [],
};
assert.equal(isContinueRecommendationRequest("還有嗎", planning), true);
assert.equal(detectTopicSwitchIntent("還有嗎", "shopping"), null);
assert.equal(detectTopicSwitchIntent("推薦咖啡廳", "shopping"), "cafe");
assert.equal(hasPriorPlaceRecommendations(planning), true);
assert.equal(
  shouldUpsertDraftWorkspace({
    travelContext: { destination: "北海道", days: 6, interests: [] },
    tripDays: 6,
    recommendedPlaces: [],
    selectedPlaces: [],
    plannedStops: [],
  }),
  true,
);

console.log("verify-shopping-place-cards-session: ok");
