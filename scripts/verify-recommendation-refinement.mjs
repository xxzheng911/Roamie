#!/usr/bin/env node
/**
 * Acceptance: Recommendation Refinement / ActiveRecommendationContext
 * Cases 1–7 from product spec (arbitration + merge + persistence shape).
 */
import assert from "node:assert/strict";
import {
  parseRecommendationRefinement,
  isMoreRecommendationResultsText,
  mergeRecommendationRefinement,
  createActiveRecommendationContext,
  resolveChatIntentArbitration,
  shouldSkipTripPlanningForRefinement,
  applyRefinementPatchToSession,
  restoreActiveRecommendationContextFromWorkspace,
  cuisineSearchTokens,
  buildRefinementSearchAttempts,
} from "../src/lib/ai/recommendation-refinement/index.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import { shouldUpsertDraftWorkspace } from "../src/lib/conversation-workspace/sync.ts";

function baseRestaurantSession(overrides = {}) {
  const ctx = createActiveRecommendationContext({
    destinationName: "北海道",
    destinationDisplayName: "北海道",
    resolvedSearchCity: "札幌",
    countryCode: "JP",
    latitude: 43.06,
    longitude: 141.35,
    radius: 8000,
    intent: "restaurant",
    placeIds: ["place_a", "place_b"],
    canonicalKeys: ["id:place_a", "id:place_b"],
  });
  return {
    recommendedPlaces: [
      { name: "十勝豚丼", googlePlaceId: "place_a" },
      { name: "蟹本家", googlePlaceId: "place_b" },
    ],
    selectedPlaces: [],
    phase: "recommend",
    discovery: {},
    updatedAt: new Date().toISOString(),
    activeCategoryIntent: "restaurant",
    activeChatIntent: "restaurant",
    recommendationSession: {
      sessionId: "rec_test",
      destination: "北海道",
      topic: "restaurant",
      returnedPlaceIds: ["place_a", "place_b"],
      returnedCanonicalKeys: ["id:place_a", "id:place_b"],
      pool: [],
      cursor: 2,
      activeSearchCity: "札幌",
      searchRegionLabel: "北海道",
      searchCentroid: { lat: 43.06, lng: 141.35 },
      searchRadius: 8000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activeRecommendationContext: ctx,
    conversationMode: "destination_planning",
    tripPlanningContext: { destination: "北海道", days: 6 },
    travelContext: { destination: "北海道", days: 6, interests: [] },
    chatPlanningState: "waitingTripDays",
    ...overrides,
  };
}

console.log("=== recommendation refinement acceptance ===\n");

// Case 1: 餐廳 → 壽喜燒 → RECOMMENDATION_REFINEMENT, not trip planning
{
  const session = baseRestaurantSession();
  const msg = "我想找壽喜燒";
  const parsed = parseRecommendationRefinement(msg, "restaurant");
  assert.ok(parsed, "parse sukiyaki");
  assert.ok(parsed.cuisine?.includes("sukiyaki"), "cuisine=sukiyaki");
  const arb = resolveChatIntentArbitration(msg, session);
  assert.equal(arb.route, "RECOMMENDATION_REFINEMENT");
  assert.equal(shouldSkipTripPlanningForRefinement(msg, session), true);
  const intent = resolveChatIntent(msg, session);
  assert.equal(intent, "restaurant");
  const merged = mergeRecommendationRefinement(session.activeRecommendationContext, parsed);
  assert.deepEqual(merged.cuisine, ["sukiyaki"]);
  assert.equal(merged.resolvedSearchCity, "札幌");
  assert.equal(merged.destinationDisplayName, "北海道");
  const attempts = buildRefinementSearchAttempts(merged);
  assert.ok(attempts.some((a) => /壽喜燒|すき焼き|sukiyaki/i.test(a.query)));
  assert.ok(attempts.every((a) => a.query.includes("札幌") || /Sapporo/i.test(a.query)));
  console.log("  ✓ Case 1: restaurant → sukiyaki refinement (no trip planning)");
}

// Case 2: continuous merge
{
  let ctx = createActiveRecommendationContext({
    destinationName: "北海道",
    resolvedSearchCity: "札幌",
    intent: "restaurant",
    placeIds: ["place_a"],
  });
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("我想找壽喜燒", "restaurant"));
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("便宜一點", "restaurant"));
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("不要吃到飽", "restaurant"));
  assert.deepEqual(ctx.cuisine, ["sukiyaki"]);
  assert.equal(ctx.budget?.level, "cheap");
  assert.ok(ctx.excludedKeywords?.some((k) => /吃到飽|buffet/i.test(k)));
  const more = parseRecommendationRefinement("還有嗎", "restaurant");
  assert.ok(more?.isMoreResults);
  ctx = mergeRecommendationRefinement(ctx, more);
  assert.deepEqual(ctx.cuisine, ["sukiyaki"]);
  assert.equal(ctx.budget?.level, "cheap");
  assert.ok(ctx.excludedKeywords?.length);
  console.log("  ✓ Case 2: continuous cuisine+budget+exclusion+more merge");
}

// Case 3: shopping subtypes
{
  const session = baseRestaurantSession({
    activeCategoryIntent: "shopping",
    activeChatIntent: "attraction",
    activeRecommendationContext: createActiveRecommendationContext({
      destinationName: "北海道",
      resolvedSearchCity: "札幌",
      intent: "shopping",
      placeIds: ["s1"],
    }),
    recommendationSession: {
      sessionId: "rec_shop",
      destination: "北海道",
      topic: "shopping",
      returnedPlaceIds: ["s1"],
      pool: [],
      cursor: 1,
      activeSearchCity: "札幌",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const arb = resolveChatIntentArbitration("想找百貨公司", session);
  assert.equal(arb.route, "RECOMMENDATION_REFINEMENT");
  const p2 = parseRecommendationRefinement("有地下街嗎", "shopping");
  assert.ok(p2?.shoppingTypes?.includes("underground_mall"));
  const p3 = parseRecommendationRefinement("不要 Outlet", "shopping");
  assert.ok(p3?.excludedKeywords?.some((k) => /outlet/i.test(k)));
  assert.equal(shouldSkipTripPlanningForRefinement("還有嗎", session), true);
  console.log("  ✓ Case 3: shopping subtype refinement");
}

// Case 4: cafe accumulate
{
  let ctx = createActiveRecommendationContext({
    destinationName: "札幌",
    resolvedSearchCity: "札幌",
    intent: "cafe",
  });
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("想找安靜的", "cafe"));
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("要有插座", "cafe"));
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("不要連鎖店", "cafe"));
  assert.ok(ctx.quietOnly || ctx.atmosphere?.includes("quiet"));
  assert.ok(
    ctx.atmosphere?.includes("outlet") ||
      ctx.atmosphere?.includes("power_outlet") ||
      ctx.preferredKeywords?.includes("outlet") ||
      ctx.preferredKeywords?.includes("power_outlet"),
  );
  assert.ok(ctx.excludedKeywords?.some((k) => /連鎖|chain/i.test(k)));
  console.log("  ✓ Case 4: cafe quiet+outlet+exclude chain");
}

// Case 5: intent switch clears cuisine, keeps destination/budget
{
  let ctx = createActiveRecommendationContext({
    destinationName: "北海道",
    resolvedSearchCity: "札幌",
    intent: "restaurant",
    placeIds: ["r1"],
  });
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("我想找壽喜燒", "restaurant"));
  ctx = mergeRecommendationRefinement(ctx, parseRecommendationRefinement("便宜一點", "restaurant"));
  const switchPatch = parseRecommendationRefinement("改找咖啡廳", "restaurant");
  assert.equal(switchPatch?.intentSwitch, "cafe");
  ctx = mergeRecommendationRefinement(ctx, switchPatch);
  assert.equal(ctx.intent, "cafe");
  assert.equal(ctx.cuisine, undefined);
  assert.equal(ctx.budget?.level, "cheap");
  assert.equal(ctx.resolvedSearchCity, "札幌");
  assert.equal(ctx.previousPlaceIds.length, 0);
  console.log("  ✓ Case 5: switch to cafe clears cuisine, keeps destination/budget");
}

// Case 6: explicit trip planning wins
{
  const session = baseRestaurantSession();
  const msg = "幫我排成三天行程";
  const arb = resolveChatIntentArbitration(msg, session);
  assert.equal(arb.route, "NEW_TRIP_PLANNING");
  assert.equal(shouldSkipTripPlanningForRefinement(msg, session), false);
  console.log("  ✓ Case 6: explicit trip planning beats refinement");
}

// Case 7: workspace persistence restore
{
  const session = baseRestaurantSession();
  const patch = parseRecommendationRefinement("我想找壽喜燒", "restaurant");
  const withPatch = applyRefinementPatchToSession(session, patch);
  assert.ok(withPatch.activeRecommendationContext?.cuisine?.includes("sukiyaki"));

  // Simulate app relaunch: planningSession lost context field but workspace has it
  const restored = restoreActiveRecommendationContextFromWorkspace({
    session: {
      ...withPatch,
      activeRecommendationContext: undefined,
    },
    workspaceContext: withPatch.activeRecommendationContext,
  });
  assert.ok(restored.activeRecommendationContext?.cuisine?.includes("sukiyaki"));
  assert.equal(restored.activeRecommendationContext?.resolvedSearchCity, "札幌");

  const cheapArb = resolveChatIntentArbitration("便宜一點", restored);
  assert.equal(cheapArb.route, "RECOMMENDATION_REFINEMENT");

  assert.equal(
    shouldUpsertDraftWorkspace({
      ...restored,
      travelContext: { destination: "北海道", interests: [] },
    }),
    true,
  );
  console.log("  ✓ Case 7: restore ActiveRecommendationContext after relaunch");
}

// Extra: destination change / more results helpers
{
  assert.equal(isMoreRecommendationResultsText("還有嗎"), true);
  assert.ok(cuisineSearchTokens("sukiyaki").some((t) => /壽喜|すき|sukiyaki/i.test(t)));
  console.log("  ✓ helpers: more-results + cuisine tokens");
}

  // Extra: attraction / nightlife refinements
{
  const attr = parseRecommendationRefinement("想找室內的", "attraction");
  assert.ok(attr?.indoorOnly || attr?.attractionTypes?.includes("indoor"));
  const night = parseRecommendationRefinement("想找酒吧", "nightlife");
  // nightlife switch or bar preference under active nightlife
  const nightSession = baseRestaurantSession({
    activeCategoryIntent: "bar",
    activeRecommendationContext: createActiveRecommendationContext({
      destinationName: "札幌",
      resolvedSearchCity: "札幌",
      intent: "nightlife",
    }),
  });
  assert.equal(
    resolveChatIntentArbitration("不要太吵", nightSession).route,
    "RECOMMENDATION_REFINEMENT",
  );
  assert.ok(parseRecommendationRefinement("不要公園", "attraction")?.excludedKeywords?.length);
  console.log("  ✓ attraction / nightlife refinement signals");
}

console.log("\nverify-recommendation-refinement: ok");
