/**
 * Chat Intent Arbitration — priority order for recommendation vs trip planning.
 *
 * 1. Explicit destination change
 * 2. Explicit create / generate itinerary
 * 3. Explicit place recommendation intent
 * 4. Active recommendation refinement
 * 5. More recommendations
 * 6. Explicit combination selection (grammar only)
 * 7. Pending question answers (days / dates)
 * 8. General chat
 *
 * planningState is advisory only — never overrides explicit place intent.
 */
import type { ChatPlanningSession } from "@/lib/chat-session";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { parseChatPlaceIntents } from "@/lib/ai/chat-place-intent";
import { resolveActiveCategoryIntent } from "@/lib/ai/conversation-recommendation-session";
import {
  isMoreRecommendationResultsText,
  parseRecommendationRefinement,
} from "@/lib/ai/recommendation-refinement/parser";
import {
  categoryIntentToRecommendationIntent,
  type ActiveRecommendationContext,
  type ChatIntentArbitrationResult,
  type ChatIntentArbitrationRoute,
  type RecommendationIntent,
} from "@/lib/ai/recommendation-refinement/types";
import {
  hasExplicitPlaceRecommendationIntent,
  isCombinationSelectionGrammar,
  logPlaceRequirementParsed,
  parsePlaceRecommendationIntent,
} from "@/lib/ai/place-recommendation-intent";

const EXPLICIT_NEW_TRIP_RE =
  /(?:幫我排成|帮我排成|幫我規劃|帮我规划|幫我安排|帮我安排|建立新行程|创建新行程|重新規劃行程|重新规划行程|排成\s*\d+\s*天|規劃\s*\d+\s*天|规划\s*\d+\s*天|幫我排成行程|帮我排成行程|幫我規劃三天|帮我规划三天|排成三天行程|把.*排進.*行程|排進六天|排进六天|加進.*行程|加入行程)/i;

/** Month/season + destination travel narrative — beats sticky place_recommendation. */
const FUTURE_TRIP_PLANNING_RE =
  /(?:\d{1,2}\s*月|明年|後年|暑假|寒假|春節|連假).{0,16}(?:要去|想去|去|安排|旅行|旅遊|旅游)|(?:要去|想去|去|安排).{0,12}(?:\d{1,2}\s*月|明年|後年|暑假|寒假)|(?:安排|規劃|规划).{0,12}[\u4e00-\u9fff]{2,8}.{0,8}(?:\d+|[一二三四五六七八九十兩两]+)\s*天/;

const EXPLICIT_DESTINATION_CHANGE_RE =
  /(?:我要改去|改去|改成[\u4e00-\u9fff]{2,8}行程|換成[\u4e00-\u9fff]{2,8}行程|换成[\u4e00-\u9fff]{2,8}行程|目的地改成|改目的地|下一個目的地|下一个目的地)/i;

const ADD_TO_ITINERARY_RE =
  /(?:加進(?:行程|行程裡|去)|加进(?:行程|行程里|去)|加入行程|排進去|排进去|放進行程|放进行程|想先排|把.*加進|把前.*排進|排進.*行程)/i;

function getActiveRecommendationContext(
  session: ChatPlanningSession,
): ActiveRecommendationContext | undefined {
  return session.activeRecommendationContext;
}

function resolveActiveIntent(session: ChatPlanningSession): RecommendationIntent | undefined {
  const ctx = getActiveRecommendationContext(session);
  if (ctx?.intent) return ctx.intent;
  const category = resolveActiveCategoryIntent(session);
  if (category) return categoryIntentToRecommendationIntent(category);
  return undefined;
}

export function hasActiveRecommendationContext(session: ChatPlanningSession): boolean {
  if (session.activeRecommendationContext) return true;
  if (session.recommendationSession?.topic) return true;
  if (session.activeCategoryIntent && (session.recommendedPlaces?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

export function isExplicitNewTripPlanningText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isCreateItineraryIntent(t)) return true;
  if (EXPLICIT_NEW_TRIP_RE.test(t)) return true;
  // Future travel narrative must beat sticky place_recommendation context.
  if (
    FUTURE_TRIP_PLANNING_RE.test(t) &&
    !/(?:推薦|有沒有|有什麼|哪些).{0,10}(?:餐廳|咖啡|景點|美食|夜市|酒吧|店)/.test(t)
  ) {
    return true;
  }
  return false;
}

export function isExplicitDestinationChangeText(text: string): boolean {
  return EXPLICIT_DESTINATION_CHANGE_RE.test(text.trim());
}

export function resolveChatIntentArbitration(
  text: string,
  session: ChatPlanningSession,
  opts?: { tripPlanningState?: string },
): ChatIntentArbitrationResult {
  const t = text.trim();
  const activeCtx = getActiveRecommendationContext(session);
  const activeIntent = resolveActiveIntent(session);
  const tripPlanningState =
    opts?.tripPlanningState ??
    session.chatPlanningState ??
    session.conversationMode ??
    "";
  const pendingType = session.pendingQuestion?.type ?? "";
  const planningState =
    pendingType === "combination_choice"
      ? "awaiting_combination_selection"
      : tripPlanningState;

  const log = (
    route: ChatIntentArbitrationRoute,
    reason: string,
    extra?: {
      refinement?: ChatIntentArbitrationResult["refinement"];
      detectedPrimaryType?: string;
      detectedSubtypes?: string;
    },
  ) => {
    console.info(
      "[CHAT_INTENT_ARBITRATION]",
      `message=${t.slice(0, 80)}`,
      `planningState=${planningState}`,
      `activeRecommendationIntent=${activeIntent ?? activeCtx?.intent ?? ""}`,
      `tripPlanningState=${tripPlanningState}`,
      `detectedPrimaryType=${extra?.detectedPrimaryType ?? ""}`,
      `detectedSubtypes=${extra?.detectedSubtypes ?? ""}`,
      `resolvedRoute=${route}`,
      `reason=${reason}`,
    );
    return { route, reason, refinement: extra?.refinement };
  };

  if (!t) return log("GENERAL_CHAT", "empty");

  // 1. Explicit destination change
  if (isExplicitDestinationChangeText(t)) {
    return log("NEW_DESTINATION", "explicit_destination_change");
  }

  // Destination switch embedded in place ask:「東京有壽喜燒推薦嗎」
  const placeIntentEarly = parsePlaceRecommendationIntent(t, {
    activePrimaryType: activeIntent,
    hasActiveRecommendationContext: hasActiveRecommendationContext(session),
  });
  if (
    placeIntentEarly?.destinationName &&
    activeCtx?.destinationName &&
    placeIntentEarly.destinationName !== activeCtx.destinationName &&
    placeIntentEarly.destinationName !== activeCtx.destinationDisplayName
  ) {
    // Still route to place recommendation with new destination — not sticky old city
    logPlaceRequirementParsed(placeIntentEarly);
    return log("NEW_RECOMMENDATION", "explicit_place_intent_destination_switch", {
      detectedPrimaryType: placeIntentEarly.primaryType,
      detectedSubtypes: placeIntentEarly.subtypes.join(","),
    });
  }

  // 2. Explicit create / generate itinerary (or add selected places into trip)
  if (isExplicitNewTripPlanningText(t) || ADD_TO_ITINERARY_RE.test(t)) {
    if (ADD_TO_ITINERARY_RE.test(t) && !isExplicitNewTripPlanningText(t)) {
      return log("ADD_TO_ITINERARY", "add_to_itinerary");
    }
    return log("NEW_TRIP_PLANNING", "explicit_new_trip_planning");
  }

  // 3. Explicit place recommendation intent — overrides combination pending
  if (
    hasExplicitPlaceRecommendationIntent(t, {
      activePrimaryType: activeIntent,
      hasActiveRecommendationContext: hasActiveRecommendationContext(session),
    })
  ) {
    const parsed =
      placeIntentEarly ??
      parsePlaceRecommendationIntent(t, {
        activePrimaryType: activeIntent,
        hasActiveRecommendationContext: hasActiveRecommendationContext(session),
      });
    if (parsed) logPlaceRequirementParsed(parsed);

    if (activeCtx || activeIntent) {
      const refinement = parseRecommendationRefinement(t, activeIntent ?? activeCtx?.intent);
      if (refinement && !refinement.isMoreResults && parsed?.continuation === "refinement") {
        return log(
          "RECOMMENDATION_REFINEMENT",
          "explicit_place_intent_overrides_pending_state",
          {
            refinement,
            detectedPrimaryType: parsed.primaryType,
            detectedSubtypes: parsed.subtypes.join(","),
          },
        );
      }
      if (
        (refinement?.isMoreResults ||
          isMoreRecommendationResultsText(t) ||
          parsed?.continuation === "more_results") &&
        (activeCtx || session.recommendationSession || session.recommendedPlaces?.length)
      ) {
        return log("MORE_RECOMMENDATIONS", "more_results_with_active_context", {
          refinement: refinement ?? undefined,
          detectedPrimaryType: parsed?.primaryType,
          detectedSubtypes: parsed?.subtypes.join(","),
        });
      }
    }

    return log("NEW_RECOMMENDATION", "explicit_place_intent_overrides_pending_state", {
      detectedPrimaryType: parsed?.primaryType,
      detectedSubtypes: parsed?.subtypes.join(","),
    });
  }

  // 4–5. Active recommendation refinement / more
  if (activeCtx || activeIntent) {
    const refinement = parseRecommendationRefinement(t, activeIntent ?? activeCtx?.intent);

    if (refinement && !refinement.isMoreResults) {
      console.info(
        "[RECOMMENDATION_REFINEMENT_PARSED]",
        `intent=${refinement.intentSwitch ?? activeIntent ?? ""}`,
        `destination=${activeCtx?.destinationDisplayName ?? activeCtx?.destinationName ?? ""}`,
        `resolvedCity=${activeCtx?.resolvedSearchCity ?? ""}`,
        `category=${refinement.category ?? ""}`,
        `subcategory=${refinement.subcategory ?? ""}`,
        `cuisine=${(refinement.cuisine ?? []).join(",")}`,
        `budget=${refinement.budget?.level ?? ""}`,
        `atmosphere=${(refinement.atmosphere ?? []).join(",")}`,
        `mealSlot=${refinement.mealSlot ?? ""}`,
        `exclusions=${(refinement.excludedKeywords ?? []).join(",")}`,
        `confidence=${refinement.confidence}`,
      );
      return log("RECOMMENDATION_REFINEMENT", "active_recommendation_refinement", {
        refinement,
      });
    }

    if (
      (refinement?.isMoreResults || isMoreRecommendationResultsText(t)) &&
      (activeCtx || session.recommendationSession || session.recommendedPlaces?.length)
    ) {
      return log("MORE_RECOMMENDATIONS", "more_results_with_active_context", {
        refinement: refinement ?? undefined,
      });
    }

    if (refinement) {
      return log("RECOMMENDATION_REFINEMENT", "active_recommendation_refinement_soft", {
        refinement,
      });
    }
  }

  // 6. Explicit combination selection grammar only
  if (
    (pendingType === "combination_choice" ||
      session.travelContext?.tripPurpose === "combination_suggestions_offered") &&
    isCombinationSelectionGrammar(t, {
      destination:
        session.pendingQuestion?.baseDestination ??
        session.travelContext?.destination ??
        session.tripPlanningContext?.destination,
    })
  ) {
    return log("TRIP_PLANNING_FLOW", "combination_selection_grammar");
  }

  // Legacy category query (before sticky trip)
  if (hasCategoryPlaceQuery(t) && parseChatPlaceIntents(t).length > 0) {
    return log("NEW_RECOMMENDATION", "new_category_place_query");
  }

  // 7. Pending question / sticky trip planning (days, style) — not combination lock
  if (
    session.conversationMode === "destination_planning" ||
    session.pendingQuestion ||
    session.chatPlanningState === "waitingTripDays" ||
    session.chatPlanningState === "waitingStyleSelection"
  ) {
    // Combination pending without grammar → do not force combination reply
    if (pendingType === "combination_choice") {
      return log("GENERAL_CHAT", "combination_pending_without_selection_grammar");
    }
    return log("TRIP_PLANNING_FLOW", "sticky_trip_planning");
  }

  // 8. General chat
  return log("GENERAL_CHAT", "fallback");
}

/** Whether trip-planning / combination routes must be skipped. */
export function shouldSkipTripPlanningForRefinement(
  text: string,
  session: ChatPlanningSession,
): boolean {
  if (isExplicitNewTripPlanningText(text) || isExplicitDestinationChangeText(text)) {
    return false;
  }
  const result = resolveChatIntentArbitration(text, session);
  if (
    result.route === "RECOMMENDATION_REFINEMENT" ||
    result.route === "MORE_RECOMMENDATIONS" ||
    result.route === "NEW_RECOMMENDATION"
  ) {
    console.info(
      "[TRIP_PLANNING_ROUTE_SKIPPED]",
      `reason=${result.reason || "place_recommendation_overrides_planning"}`,
    );
    return true;
  }
  return false;
}
