/**
 * Shopping follow-up: coverage state, cross-group plan, reserve, category gate.
 */
import assert from "node:assert/strict";
import {
  isShoppingPlace,
  passesShoppingRenderGuard,
} from "../src/lib/ai/chat-category-place-guard.ts";
import {
  SHOPPING_QUERY_PAGES,
  SHOPPING_QUERY_GROUPS,
  SHOPPING_FOLLOWUP_MAX_NETWORK_CALLS,
  SHOPPING_FOLLOWUP_MAX_QUERIES,
  SHOPPING_QUERIES_PER_GROUP,
  SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE,
  buildInitialShoppingSearchAttempts,
  buildShoppingFollowupCalls,
  buildShoppingCoverageState,
  planShoppingFollowupGroups,
  takeNextShoppingFollowupAttempts,
  takeShoppingReserveBatch,
  inferShoppingTypesFromPlace,
  createShoppingFollowUpBudget,
  shoppingBudgetExhausted,
  detectShoppingSubtype,
  shoppingCanonicalKey,
  shoppingBrandKey,
  resolveInitialShoppingCity,
  makeShoppingFollowupRequestId,
  splitShoppingDisplayAndReserve,
} from "../src/lib/ai/shopping-query-queue.ts";
import {
  resolveShoppingSearchScope,
  advanceShoppingSearchScope,
  preferUnderrepresentedShoppingCluster,
} from "../src/lib/ai/shopping-search-scope.ts";
import {
  createRecommendationSession,
  isContinueRecommendationRequest,
  RECOMMENDATION_BATCH_SIZE,
} from "../src/lib/ai/conversation-recommendation-session.ts";
import { buildWorkspaceTitle } from "../src/lib/conversation-workspace/title.ts";

// ── Destination scope: 北海道 → 札幌 ──
const scope = resolveShoppingSearchScope({
  destination: "北海道",
  shownPlaces: [
    {
      name: "狸小路商店街",
      address: "北海道札幌市中央区南2条西",
      lat: 43.055,
      lng: 141.353,
    },
    {
      name: "3COINS 札幌POLE TOWN店",
      address: "北海道札幌市中央区南2条西3丁目",
      lat: 43.056,
      lng: 141.352,
    },
  ],
});
assert.equal(scope.primaryDestination, "北海道");
assert.equal(scope.activeSearchCity, "札幌");
assert.ok(scope.searchCentroid.lat > 43 && scope.searchCentroid.lat < 44);
assert.equal(resolveInitialShoppingCity("北海道"), "札幌");

const initial = buildInitialShoppingSearchAttempts("北海道", "有購物點推薦嗎", "札幌", "JP");
assert.ok(
  initial.primary.length >= 1 && initial.primary.length <= 2,
  "initial primary is the first budgeted queries",
);
assert.ok(
  initial.fallback.length >= 1,
  "initial fallback continues multi-group oversample",
);
assert.ok(
  (initial.groups?.length ?? 0) >= 4,
  "initial seed must cover multiple shopping groups for reserve",
);
assert.equal(initial.activeSearchCity, "札幌");
assert.ok(
  initial.primary.every((a) => a.query.startsWith("札幌")),
  "initial shopping queries must use 札幌, not 北海道",
);
assert.ok(
  !initial.primary.some((a) => a.query.startsWith("北海道")),
  "must not prefix queries with region 北海道",
);

// ── Coverage inference for Sapporo round-1 set ──
const round1Places = [
  { name: "狸小路商店街", types: ["tourist_attraction"] },
  { name: "JR塔大樓", types: ["shopping_mall"] },
  { name: "大丸札幌店", types: ["department_store"] },
  { name: "札幌Stellar Place", types: ["shopping_mall"] },
];
const coverage = buildShoppingCoverageState({
  destination: "北海道",
  places: round1Places,
  coveredClusters: ["札幌站", "狸小路／薄野"],
  destinationCountryCode: "JP",
  destinationLanguage: "ja",
});
assert.ok(coverage.coveredShoppingTypes.includes("shopping_street"));
assert.ok(coverage.coveredShoppingTypes.includes("department_store"));
assert.ok(
  coverage.coveredShoppingTypes.includes("shopping_mall") ||
    coverage.coveredShoppingTypes.includes("station_mall"),
);

const tanukiTypes = inferShoppingTypesFromPlace({ name: "狸小路商店街" });
assert.ok(tanukiTypes.includes("shopping_street"));
const daimaruTypes = inferShoppingTypesFromPlace({
  name: "大丸札幌店",
  types: ["department_store"],
});
assert.ok(daimaruTypes.includes("department_store"));

// ── Follow-up plan must NOT lead with outlet / retail / fashion ──
const plan = planShoppingFollowupGroups({ coverage, subtype: "general", maxGroups: 3 });
assert.ok(plan.selectedGroups.length >= 3);
assert.notEqual(plan.selectedGroups[0], "outlet");
assert.notEqual(plan.selectedGroups[0], "fashion_specialty");
assert.ok(
  ["underground_mall", "shopping_mall_complex", "local_market"].includes(
    plan.selectedGroups[0],
  ),
  `expected high-hit uncovered group first, got ${plan.selectedGroups[0]}`,
);
assert.ok(
  plan.selectedGroups.includes("underground_mall") ||
    plan.selectedGroups.includes("local_market") ||
    plan.selectedGroups.includes("shopping_mall_complex"),
);

const { calls } = buildShoppingFollowupCalls({
  destination: "北海道",
  activeSearchCity: "札幌",
  coverage,
  subtype: "general",
  maxCalls: 3,
});
assert.equal(calls.length, 3);
assert.equal(SHOPPING_QUERIES_PER_GROUP, 1);
assert.equal(new Set(calls.map((c) => c.group.id)).size, 3, "must cross 3 distinct groups");
assert.ok(
  calls.every((c) => c.query.startsWith("札幌")),
  "follow-up queries must use 札幌",
);
assert.ok(
  !calls.some((c) => /outlet mall|retail complex|fashion building/i.test(c.query)),
  "must not run the old English synonym triple",
);
assert.ok(
  calls.some((c) => /地下街|underground|商業施設|市場|ショッピングモール|買い物/i.test(c.query)),
  "must include high-hit JP shopping queries",
);
// One intent per query — no mega concatenated strings
assert.ok(
  calls.every((c) => c.query.split(/\s+/).length <= 5),
  "each query must stay short / single-intent",
);

// ── Query groups exist ──
assert.ok(SHOPPING_QUERY_GROUPS.length >= 5);
assert.ok(SHOPPING_QUERY_PAGES.length >= 5);
assert.equal(SHOPPING_FOLLOWUP_MAX_NETWORK_CALLS, 3);
assert.equal(SHOPPING_FOLLOWUP_MAX_QUERIES, 3);

const pool = [
  ...round1Places.map((p, i) => ({
    name: p.name,
    placeName: p.name,
    type: "shopping_mall",
    description: "",
    reason: "",
    estimatedTime: "",
    address: "札幌",
    lat: 43.06,
    lng: 141.35,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: `gp_${i}`,
  })),
  {
    name: "札幌 Factory",
    placeName: "札幌 Factory",
    type: "shopping_mall",
    description: "",
    reason: "",
    estimatedTime: "",
    address: "札幌",
    lat: 43.066,
    lng: 141.36,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: "gp_factory",
  },
  {
    name: "PARCO",
    placeName: "PARCO",
    type: "shopping_mall",
    description: "",
    reason: "",
    estimatedTime: "",
    address: "札幌",
    lat: 43.06,
    lng: 141.35,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: "gp_parco",
  },
];

const { batch, reserve } = splitShoppingDisplayAndReserve(pool, RECOMMENDATION_BATCH_SIZE);
assert.equal(batch.length, 4);
assert.ok(reserve.length >= 2, "UI batch 4 must leave reserve candidates");

const { session } = createRecommendationSession({
  destination: "北海道",
  topic: "shopping",
  pool,
  usedQueries: initial.usedQueries,
  nextQueryCursor: initial.nextQueryCursor,
  recommendationPage: 0,
  activeSearchCity: "札幌",
  searchCentroid: scope.searchCentroid,
  searchRadius: scope.searchRadius,
  geoClusterIndex: scope.geoClusterIndex,
  shoppingCoverage: coverage,
});
assert.ok(
  (session.shoppingCandidateReserve?.length ?? 0) >= 2,
  "session must persist reserve beyond UI batch",
);

const reserved = takeShoppingReserveBatch(session, RECOMMENDATION_BATCH_SIZE);
assert.ok(reserved.taken >= 2);
assert.equal(reserved.reserveBefore, session.shoppingCandidateReserve.length);
assert.ok(reserved.reserveAfter < reserved.reserveBefore);

const page2 = takeNextShoppingFollowupAttempts({
  destination: "北海道",
  session: {
    ...session,
    shoppingCandidateReserve: [],
    shoppingCoverage: coverage,
  },
  userText: "還有嗎",
  activeSearchCity: "札幌",
});
assert.ok(page2, "follow-up must plan next shopping query");
assert.equal(page2.queries.length, 1, "one query per follow-up call");
assert.ok(page2.queries[0].startsWith("札幌"));
assert.notEqual(page2.group.id, "outlet");

assert.equal(detectShoppingSubtype("還有其他百貨公司嗎"), "department_store");
assert.equal(detectShoppingSubtype("想找地下街"), "underground_mall");

const dept = buildShoppingFollowupCalls({
  destination: "北海道",
  activeSearchCity: "札幌",
  coverage,
  subtype: "department_store",
  maxCalls: 3,
});
assert.ok(dept.calls.length >= 1);
assert.ok(dept.calls.every((c) => c.group.id === "department_store"));
assert.ok(dept.calls.some((c) => /百貨|デパート|department/i.test(c.query)));

const underground = buildShoppingFollowupCalls({
  destination: "北海道",
  activeSearchCity: "札幌",
  coverage,
  subtype: "underground_mall",
  maxCalls: 2,
});
assert.ok(underground.calls.every((c) => c.group.id === "underground_mall"));
assert.ok(underground.calls.some((c) => /地下街|underground/i.test(c.query)));

// Budget helpers
const budget = createShoppingFollowUpBudget(Date.now());
assert.equal(budget.maxNetworkCalls, 3);
assert.equal(budget.maxQueries, 3);
assert.equal(budget.targetNewResults, 4);
assert.equal(shoppingBudgetExhausted(budget), false);
budget.usedNetworkCalls = 3;
assert.equal(shoppingBudgetExhausted(budget), true);

const requestId = makeShoppingFollowupRequestId(session.sessionId);
assert.ok(requestId.startsWith("shopping_followup_"));
assert.ok(requestId.includes(session.sessionId));
assert.notEqual(requestId, session.sessionId, "requestId must differ from shoppingSessionId");

assert.ok(
  SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE.includes("購物"),
  "shopping no-more must stay on shopping intent",
);
assert.ok(
  !/美食|咖啡/.test(SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE),
  "shopping no-more must not pivot to food/cafe",
);

// Geo cluster advances / underrepresented pick
const advanced = advanceShoppingSearchScope(scope);
assert.ok(
  advanced.geoClusterIndex !== scope.geoClusterIndex ||
    advanced.searchRadius !== scope.searchRadius,
  "follow-up scope must rotate cluster or expand radius",
);
const under = preferUnderrepresentedShoppingCluster(scope, [
  { lat: 43.0686, lng: 141.3508 },
  { lat: 43.0554, lng: 141.353 },
]);
assert.ok(under.coveredClusterLabels.length >= 1);
assert.ok(under.scope.geoClusterLabel);

// ── Category gate ──
assert.equal(
  isShoppingPlace({
    name: "Marunouchi Street Park",
    primaryType: "park",
    types: ["park", "point_of_interest"],
  }),
  false,
  "Street Park must not pass shopping gate",
);
assert.equal(
  isShoppingPlace({
    name: "PRONTO Sapporo Pole Town",
    primaryType: "cafe",
    types: ["cafe", "store", "point_of_interest", "establishment"],
    address: "北海道札幌市中央区南2条西3丁目 札幌地下街ポールタウン",
  }),
  false,
  "PRONTO cafe inside underground mall must not pass shopping gate",
);
assert.equal(
  isShoppingPlace({
    name: "PRONTO",
    primaryType: "restaurant",
    types: ["restaurant", "food", "point_of_interest"],
    address: "Sapporo Station underground mall",
  }),
  false,
  "restaurant primary must be rejected even with mall address",
);
assert.equal(
  isShoppingPlace({
    name: "澀谷 SKY",
    primaryType: "observation_deck",
    types: ["observation_deck", "tourist_attraction"],
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "明治神宮",
    primaryType: "shrine",
    types: ["shrine", "place_of_worship"],
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "東京晴空塔",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction", "store"],
  }),
  false,
  "Skytree with store tag must still be rejected",
);
assert.equal(
  isShoppingPlace({
    name: "大丸東京店",
    primaryType: "department_store",
    types: ["department_store", "shopping_mall"],
  }),
  true,
);
assert.equal(
  isShoppingPlace({
    name: "3COINS 札幌POLE TOWN店",
    primaryType: "store",
    types: ["store", "point_of_interest", "establishment"],
  }),
  true,
  "bare store specialty retail must pass shopping gate",
);
assert.equal(
  isShoppingPlace({
    name: "狸小路商店街",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction", "point_of_interest"],
  }),
  true,
  "shopping street tagged tourist_attraction must pass via name alias",
);
assert.equal(
  isShoppingPlace({
    name: "Local Gift Shop",
    primaryType: "gift_shop",
    types: ["gift_shop", "store"],
  }),
  true,
  "gift_shop alias must pass",
);
assert.equal(
  isShoppingPlace({
    name: "Sapporo Factory",
    primaryType: "establishment",
    types: ["establishment", "point_of_interest", "store"],
  }),
  true,
  "mall-like establishment+store must pass shopping gate",
);
assert.equal(
  isShoppingPlace({
    name: "札幌 商業施設 Aurora",
    primaryType: "establishment",
    types: ["establishment", "point_of_interest"],
  }),
  true,
  "establishment+POI with shopping facility name must pass",
);
assert.equal(
  passesShoppingRenderGuard({
    name: "KITTE花園",
    placeName: "KITTE花園",
    type: "garden",
    types: ["garden", "park"],
    description: "",
    reason: "",
    estimatedTime: "",
    address: "",
    lat: null,
    lng: null,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: "gp_kitte_garden",
  }),
  false,
);

// Brand soft-key: different branches share brand, distinct placeIds stay distinct
assert.equal(shoppingCanonicalKey({ googlePlaceId: "abc" }), "id:abc");
assert.notEqual(
  shoppingCanonicalKey({ googlePlaceId: "apia" }),
  shoppingCanonicalKey({ googlePlaceId: "pole" }),
);
const brandApia = shoppingBrandKey({ name: "3COINS 札幌 APIA" });
const brandPole = shoppingBrandKey({ name: "3COINS 札幌POLE TOWN店" });
assert.ok(brandApia && brandPole);
assert.equal(brandApia, brandPole, "same brand different branches share brand key");

assert.equal(
  isContinueRecommendationRequest("還有嗎", {
    recommendationSession: session,
    activeCategoryIntent: "shopping",
    travelContext: { destination: "北海道", interests: [] },
    recommendedPlaces: [],
    selectedPlaces: [],
    plannedStops: [],
  }),
  true,
);

// ── Workspace title ──
assert.equal(
  buildWorkspaceTitle({ destination: "東京", tripDays: 6, themeIntent: "shopping" }),
  "東京 6 天購物行程",
);
assert.equal(
  buildWorkspaceTitle({
    destination: "東京",
    tripDays: 6,
    themeIntent: "shopping",
    customTitle: "我的東京行",
    titleCustom: true,
  }),
  "我的東京行",
);
assert.equal(buildWorkspaceTitle({}), "新的旅行規劃");

console.log("verify-shopping-followup-query-queue: ok");
