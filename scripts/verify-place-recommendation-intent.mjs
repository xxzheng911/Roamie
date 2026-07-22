#!/usr/bin/env node
/**
 * Acceptance: Place Recommendation Intent + Combination Pending Bypass
 * Cases 1–10 from product spec.
 */
import assert from "node:assert/strict";
import {
  parsePlaceRecommendationIntent,
  hasExplicitPlaceRecommendationIntent,
  buildPlaceRecommendationQueries,
  resolvePlaceRecommendationDestination,
  isCombinationSelectionGrammar,
  shouldBypassCombinationPending,
} from "../src/lib/ai/place-recommendation-intent/index.ts";
import {
  resolveChatIntentArbitration,
  shouldSkipTripPlanningForRefinement,
  mergeRecommendationRefinement,
  createActiveRecommendationContext,
  parseRecommendationRefinement,
} from "../src/lib/ai/recommendation-refinement/index.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { shouldFetchDestinationCategoryPlaces } from "../src/lib/ai/chat-place-intent.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import { hasCategoryPlaceQuery } from "../src/lib/ai/chat-place-category-types.ts";

function comboSession(overrides = {}) {
  return {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
    conversationMode: "destination_planning",
    pendingQuestion: {
      type: "combination_choice",
      options: ["1", "2", "3", "4"],
      baseDestination: "北海道",
      destinationCountry: "日本",
    },
    tripPlanningContext: {
      destination: "北海道",
      days: 6,
      startDate: "2026-09-05",
      endDate: "2026-09-10",
    },
    travelContext: {
      destination: "北海道",
      days: 6,
      startDate: "2026-09-05",
      endDate: "2026-09-10",
      interests: [],
      tripPurpose: "combination_suggestions_offered",
      planningDaysConfirmed: true,
    },
    tripDays: 6,
    ...overrides,
  };
}

console.log("=== place recommendation intent + combination bypass ===\n");

// Case 1: waiting combination + ramen ask
{
  const msg = "有拉麵店推薦嗎";
  const session = comboSession();
  assert.equal(hasCategoryPlaceQuery(msg), true, "c1 hasCategoryPlaceQuery");
  assert.equal(hasExplicitPlaceRecommendationIntent(msg), true, "c1 explicit place");
  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed, "c1 parse");
  assert.equal(parsed.primaryType, "restaurant");
  assert.ok(parsed.subtypes.includes("ramen"), "c1 subtype ramen");

  const bypass = shouldBypassCombinationPending(msg);
  assert.equal(bypass.bypass, true, "c1 bypass");

  const arb = resolveChatIntentArbitration(msg, session);
  assert.equal(arb.route, "NEW_RECOMMENDATION", `c1 route got ${arb.route}`);
  assert.match(arb.reason, /explicit_place_intent/);
  assert.equal(shouldSkipTripPlanningForRefinement(msg, session), true);

  const intent = resolveChatIntent(msg, session);
  assert.equal(intent, "restaurant", `c1 chat intent got ${intent}`);

  const ctx = session.travelContext;
  assert.equal(
    shouldFetchDestinationCategoryPlaces(msg, ctx, session),
    true,
    "c1 shouldFetch category places",
  );

  const advice = resolveDestinationAdvice(ctx, session, msg);
  assert.equal(advice.reply, null, "c1 advice must not nudge combination");
  assert.equal(session.travelContext.destination, "北海道", "c1 dest preserved");
  assert.equal(session.travelContext.days, 6, "c1 days preserved");

  const dest = resolvePlaceRecommendationDestination({
    userText: msg,
    session,
    context: ctx,
    parsed,
  });
  assert.ok(dest, "c1 dest resolved");
  assert.equal(dest.destinationDisplayName, "北海道");
  assert.equal(dest.resolvedSearchCity, "札幌");

  const queries = buildPlaceRecommendationQueries({
    destination: "北海道",
    resolvedSearchCity: "札幌",
    primaryType: "restaurant",
    subtypes: ["ramen"],
  });
  assert.ok(queries.some((q) => /拉麵|ラーメン|ramen/i.test(q.query)), "c1 queries");
  assert.ok(queries.every((q) => /札幌|Sapporo/i.test(q.query)), "c1 city in queries");
  console.log("  ✓ Case 1: combination pending + ramen → place_recommendation");
}

// Case 2: restaurant refine chain
{
  let ctx = createActiveRecommendationContext({
    destinationName: "北海道",
    resolvedSearchCity: "札幌",
    intent: "restaurant",
    placeIds: ["p1"],
  });
  const first = parsePlaceRecommendationIntent("有餐廳推薦嗎");
  assert.ok(first);
  assert.equal(first.primaryType, "restaurant");
  for (const msg of ["想吃壽司", "不要迴轉壽司", "晚餐"]) {
    const patch = parseRecommendationRefinement(msg, "restaurant");
    assert.ok(patch, `c2 patch for ${msg}`);
    ctx = mergeRecommendationRefinement(ctx, patch);
  }
  assert.ok(ctx.cuisine?.includes("sushi"), "c2 sushi");
  assert.ok(
    (ctx.excludedKeywords ?? []).some((k) => /迴轉|conveyor/i.test(k)),
    "c2 exclude conveyor",
  );
  assert.equal(ctx.mealSlot, "dinner", "c2 dinner");
  const more = parsePlaceRecommendationIntent("還有嗎", {
    hasActiveRecommendationContext: true,
    activePrimaryType: "restaurant",
  });
  assert.equal(more?.continuation, "more_results");
  console.log("  ✓ Case 2: sushi refine chain merge");
}

// Case 3: steak or pasta
{
  const parsed = parsePlaceRecommendationIntent("想找牛排或義大利麵");
  assert.ok(parsed);
  assert.equal(parsed.primaryType, "restaurant");
  assert.ok(parsed.subtypes.includes("steak"), "c3 steak");
  assert.ok(parsed.subtypes.includes("pasta"), "c3 pasta");
  console.log("  ✓ Case 3: steak + pasta subtypes");
}

// Case 4: cafe sofa + outlet
{
  const parsed = parsePlaceRecommendationIntent("想找有沙發又有插座的咖啡廳");
  assert.ok(parsed);
  assert.equal(parsed.primaryType, "cafe");
  assert.ok(parsed.preferredFeatures.includes("sofa"), "c4 sofa");
  assert.ok(
    parsed.preferredFeatures.includes("power_outlet"),
    `c4 outlet got ${parsed.preferredFeatures.join(",")}`,
  );
  console.log("  ✓ Case 4: cafe sofa + power_outlet");
}

// Case 5: cafe refine chain
{
  let ctx = createActiveRecommendationContext({
    destinationName: "北海道",
    resolvedSearchCity: "札幌",
    intent: "cafe",
    placeIds: ["c1"],
  });
  assert.ok(parsePlaceRecommendationIntent("有咖啡廳嗎")?.primaryType === "cafe");
  for (const msg of ["安靜一點", "要有插座", "不要連鎖店"]) {
    const patch = parseRecommendationRefinement(msg, "cafe");
    assert.ok(patch, `c5 ${msg}`);
    ctx = mergeRecommendationRefinement(ctx, patch);
  }
  assert.ok(ctx.atmosphere?.includes("quiet") || ctx.quietOnly, "c5 quiet");
  assert.ok(
    (ctx.preferredKeywords ?? []).some((k) => /outlet|power_outlet/i.test(k)) ||
      (ctx.atmosphere ?? []).some((k) => /outlet|power_outlet/i.test(k)),
    "c5 outlet",
  );
  assert.ok(
    (ctx.excludedKeywords ?? []).some((k) => /連鎖|chain/i.test(k)),
    "c5 no chain",
  );
  console.log("  ✓ Case 5: cafe refine merge");
}

// Case 6: shopping
{
  const parsed = parsePlaceRecommendationIntent("有百貨公司或地下街嗎");
  assert.ok(parsed);
  assert.equal(parsed.primaryType, "shopping");
  assert.ok(parsed.subtypes.includes("department_store"), "c6 dept");
  assert.ok(parsed.subtypes.includes("underground_mall"), "c6 underground");
  console.log("  ✓ Case 6: shopping subtypes");
}

// Case 7: indoor attraction
{
  const parsed = parsePlaceRecommendationIntent("下雨天想找室內景點");
  assert.ok(parsed);
  assert.ok(
    parsed.primaryType === "attraction" ||
      parsed.primaryType === "indoor" ||
      parsed.indoorOnly,
    `c7 type=${parsed.primaryType} indoor=${parsed.indoorOnly}`,
  );
  assert.equal(parsed.indoorOnly, true, "c7 indoorOnly");
  console.log("  ✓ Case 7: indoor / rainy");
}

// Case 8: after place rec, combination grammar still works; context preserved
{
  const session = comboSession({
    activeCategoryIntent: "restaurant",
    activeRecommendationContext: createActiveRecommendationContext({
      destinationName: "北海道",
      destinationDisplayName: "北海道",
      resolvedSearchCity: "札幌",
      intent: "restaurant",
      placeIds: ["r1"],
    }),
    recommendedPlaces: [{ name: "一蘭", googlePlaceId: "r1" }],
    phase: "recommend",
    travelContext: {
      destination: "北海道",
      days: 6,
      startDate: "2026-09-05",
      endDate: "2026-09-10",
      interests: [],
      tripPurpose: "recommend_places",
      planningDaysConfirmed: true,
    },
  });
  // First turn already done (ramen). Second:「1、2」
  const msg = "1、2";
  assert.equal(isCombinationSelectionGrammar(msg, { destination: "北海道" }), true);
  assert.equal(hasExplicitPlaceRecommendationIntent(msg), false);
  const arb = resolveChatIntentArbitration(msg, session);
  assert.equal(arb.route, "TRIP_PLANNING_FLOW", `c8 route=${arb.route}`);
  assert.equal(session.travelContext.destination, "北海道");
  assert.equal(session.travelContext.days, 6);
  assert.equal(session.pendingQuestion?.type, "combination_choice");
  console.log("  ✓ Case 8: return to combination selection");
}

// Case 9: add to itinerary
{
  const session = comboSession({
    activeRecommendationContext: createActiveRecommendationContext({
      destinationName: "北海道",
      resolvedSearchCity: "札幌",
      intent: "restaurant",
      placeIds: ["r1", "r2"],
    }),
    recommendedPlaces: [
      { name: "A", googlePlaceId: "r1" },
      { name: "B", googlePlaceId: "r2" },
    ],
  });
  const msg = "幫我把前兩間拉麵店排進六天行程";
  const arb = resolveChatIntentArbitration(msg, session);
  assert.ok(
    arb.route === "NEW_TRIP_PLANNING" || arb.route === "ADD_TO_ITINERARY",
    `c9 route=${arb.route}`,
  );
  assert.notEqual(arb.route, "NEW_RECOMMENDATION");
  console.log("  ✓ Case 9: trip-add / planning");
}

// Case 10: destination switch
{
  const session = comboSession({
    activeRecommendationContext: createActiveRecommendationContext({
      destinationName: "北海道",
      destinationDisplayName: "北海道",
      resolvedSearchCity: "札幌",
      intent: "restaurant",
      placeIds: ["r1"],
    }),
  });
  const msg = "東京有壽喜燒推薦嗎";
  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed);
  assert.equal(parsed.primaryType, "restaurant");
  assert.ok(parsed.subtypes.includes("sukiyaki"));
  assert.ok(parsed.destinationName === "東京" || /東京/.test(msg));

  const dest = resolvePlaceRecommendationDestination({
    userText: msg,
    session,
    context: session.travelContext,
    parsed,
  });
  assert.ok(dest);
  assert.equal(dest.destinationDisplayName, "東京", `c10 dest=${dest.destinationDisplayName}`);
  assert.notEqual(dest.resolvedSearchCity, "札幌");

  const queries = buildPlaceRecommendationQueries({
    destination: dest.destinationDisplayName,
    resolvedSearchCity: dest.resolvedSearchCity,
    primaryType: "restaurant",
    subtypes: ["sukiyaki"],
  });
  assert.ok(queries.every((q) => !/札幌|Sapporo/i.test(q.query)), "c10 no sapporo");
  assert.ok(queries.some((q) => /東京|Tokyo/i.test(q.query)), "c10 tokyo queries");
  console.log("  ✓ Case 10: destination switch to Tokyo sukiyaki");
}

// Grammar negatives
{
  for (const msg of [
    "有拉麵店推薦嗎",
    "我想吃壽喜燒",
    "有咖啡廳嗎",
    "想找有插座的咖啡廳",
    "有百貨公司嗎",
    "想找室內景點",
    "還有餐廳嗎",
    "想找便宜一點的",
    "不要火鍋",
    "晚上有居酒屋嗎",
  ]) {
    assert.equal(
      isCombinationSelectionGrammar(msg, { destination: "北海道" }),
      false,
      `not combo: ${msg}`,
    );
  }
  for (const msg of ["1", "1、2", "選 1 和 3", "全部", "都要", "可以幫我生成", "就照這些安排"]) {
    assert.equal(
      isCombinationSelectionGrammar(msg, { destination: "北海道", combinationCount: 4 }),
      true,
      `is combo: ${msg}`,
    );
  }
  console.log("  ✓ Combination grammar positives / negatives");
}

console.log("\nAll Cases 1–10 passed.");
