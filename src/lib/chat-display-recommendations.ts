import { devVerboseInfo } from "@/lib/dev-verbose-log";
import {
  mergeBoundsForStage,
  resolveConversationStage,
  stageAllowsPlaceCards,
} from "@/lib/ai/conversation-stage";
import { isNearbyPlaceIntent } from "@/lib/ai/chat-intent";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { filterRecommendationItemsForDisplay } from "@/lib/recommend-place-ranking";
import { refineRecommendationItemsForBudget } from "@/lib/ai/budget-refinement";
import { filterRecommendationsByExclusion } from "@/lib/ai/recommendation-exclusion";
import { parseTripIntentFromSession } from "@/lib/recommendation/trip-intent";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { isPlaceDetailChatActive, parsePlaceDetailFollowUp, resolvePlaceDetailNearbyIntent } from "@/lib/ai/place-detail-chat";
import {
  detectMustVisitIntent,
  detectPlaceRecommendationIntent,
} from "@/lib/ai/must-visit-places";
import {
  filterRecommendationsByDestinationRenderGuard,
  isExplicitNearbyQuery,
} from "@/lib/ai/chat-place-search-context";
import { filterRecommendationsForCategoryRender } from "@/lib/ai/chat-category-place-guard";
import { isFoodIntentText } from "@/lib/ai/chat-food-filter";
import {
  hasCategoryPlaceQuery,
  type ChatPlaceCategoryIntent,
} from "@/lib/ai/chat-place-category-types";
import { parseChatPlaceIntents } from "@/lib/ai/chat-place-intent";
import { resolveDestinationFromText } from "@/lib/ai/trip-planning-context";
import {
  logChatCardsOverwriteBlocked,
  logChatCardsPreserved,
  logChatFinalCardsCount,
  logChatFinalMessageBeforeRender,
  logChatNoResultAllowed,
  logChatPlaceCardRender,
  logChatRenderModeLocked,
} from "@/lib/ai/chat-place-flow-log";
import { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";
import { shouldSuppressChatPlaceCards } from "@/lib/ai/chat-suppress-place-cards";
import { isPlaceEligibleForShortcutScene } from "@/lib/ai/shortcut-category-fidelity";

function applyShortcutSceneFidelity(
  items: RoamieRecommendationItem[],
  session: ChatPlanningSession,
): RoamieRecommendationItem[] {
  return items.filter((item) =>
    isPlaceEligibleForShortcutScene(item, session.shortcutContext?.scene),
  );
}

/** 將摘要中的地點數量改為與實際渲染張數一致 */
export function alignChatRecommendationCount(summary: string, count: number): string {
  if (!summary.trim() || count < 0) return summary;

  let result = summary.replace(
    /(我(?:在[^，。\n]{0,32})?幫你找了|幫你找了|找到|共有)\s*(\d+)\s*個/g,
    (_, prefix: string) => `${prefix}${count} 個`,
  );

  result = result.replace(
    /(我(?:在[^，。\n]{0,32})?幫你找了|幫你找了|找到)\s*幾個/g,
    (_, prefix: string) => `${prefix}${count} 個`,
  );

  return result;
}

function isDestinationCategoryPlaceDisplay(
  session: ChatPlanningSession,
  userText: string,
): boolean {
  const dest =
    session.travelContext?.destination?.trim() ||
    resolveDestinationFromText(userText);
  if (!dest) return false;
  if (hasCategoryPlaceQuery(userText)) return true;
  // Continue phrases inherit active category Recommendation Session.
  if (session.activeCategoryIntent || session.recommendationSession?.topic) {
    return true;
  }
  return false;
}

function shouldSkipDestinationRenderGuard(
  session: ChatPlanningSession,
  userText: string,
): boolean {
  return (
    isExplicitNearbyQuery(userText) ||
    isPlaceDetailChatActive(session) ||
    Boolean(resolvePlaceDetailNearbyIntent(userText))
  );
}

function nearbyCategoryRecommendations(
  items: RoamieRecommendationItem[],
  intent: ChatPlaceCategoryIntent,
  userText = "",
): RoamieRecommendationItem[] {
  logChatRenderModeLocked("PLACE_CARDS_ONLY");
  const working = filterRecommendationsForCategoryRender(items, intent, userText);
  const cards = working.slice(0, 6);
  logChatPlaceCardRender(cards.length, intent);
  devVerboseInfo("[CHAT_PLACE_CARDS_RENDER_COUNT]", { count: cards.length });
  devVerboseInfo("[CHAT_PLACE_CARD_LIMIT]", { limit: 6 });
  return cards;
}

function resolveCategoryDisplayIntent(
  session: ChatPlanningSession,
  userText: string,
): ChatPlaceCategoryIntent | null {
  const intents = parseChatPlaceIntents(userText);
  if (intents.length === 1) return intents[0]!;
  // Prefer Recommendation Session topic so「還有嗎」keeps shopping/cafe.
  if (session.recommendationSession?.topic) return session.recommendationSession.topic;
  if (session.activeCategoryIntent) return session.activeCategoryIntent;
  if (session.activeChatIntent === "cafe") return "cafe";
  if (session.activeChatIntent === "restaurant") return "restaurant";
  if (session.activeChatIntent === "attraction") return "attraction";
  return intents[0] ?? null;
}

/** 目的地類別推薦 — 跳過營業時間／stage 二次過濾，保留已驗證 place cards */
function recommendationsForCategoryPlaceDisplay(
  session: ChatPlanningSession,
  userText: string,
  items: RoamieRecommendationItem[],
): RoamieRecommendationItem[] {
  const intent = resolveCategoryDisplayIntent(session, userText);
  if (!intent) return [];

  logChatRenderModeLocked("PLACE_CARDS_ONLY");
  const working = filterRecommendationsForCategoryRender(items, intent, userText);
  const cards = working.slice(0, 6);
  logChatPlaceCardRender(cards.length, intent);
  logChatCardsPreserved(cards.length, "category_place_display");
  return cards;
}

export function finalizeChatRecommendationDisplay(
  session: ChatPlanningSession,
  userText: string,
  summary: string,
  items: RoamieRecommendationItem[] | undefined,
): { summary: string; recommendations: RoamieRecommendationItem[] } {
  const originalItems = items ?? [];
  const originalCount = originalItems.length;

  let recommendations = recommendationsForChatDisplay(session, userText, items);

  if (
    recommendations.length === 0 &&
    originalCount > 0 &&
    isTripAddPlaceSession(session)
  ) {
    recommendations = originalItems.slice(0, 5);
    logChatCardsOverwriteBlocked(`trip_add_place_preserved=${recommendations.length}`);
    logChatCardsPreserved(recommendations.length, "trip_add_place_display");
  }

  if (
    recommendations.length === 0 &&
    originalCount > 0 &&
    isDestinationCategoryPlaceDisplay(session, userText)
  ) {
    recommendations = recommendationsForCategoryPlaceDisplay(session, userText, originalItems);
    if (recommendations.length > 0) {
      logChatCardsOverwriteBlocked(`preserved=${recommendations.length}`);
    }
  }

  const finalCount = recommendations.length;
  logChatFinalMessageBeforeRender(finalCount, summary.slice(0, 60));
  logChatFinalCardsCount(finalCount);

  if (finalCount === 0 && originalCount > 0) {
    logChatNoResultAllowed(false, "had_cards_filtered_to_zero");
  } else if (finalCount > 0) {
    logChatNoResultAllowed(false, "cards_present");
  }

  const alignedSummary =
    finalCount > 0
      ? alignChatRecommendationCount(summary, finalCount)
      : summary;

  if (alignedSummary !== summary && finalCount > 0) {
    devVerboseInfo(
      `[CHAT_REC_COUNT_SYNC] cards=${finalCount} summary_adjusted=true`,
    );
  }

  return { summary: alignedSummary, recommendations };
}

/** 依對話階段決定是否顯示地點卡，避免情緒開場就硬推清單 */
export function recommendationsForChatDisplay(
  session: ChatPlanningSession,
  userText: string,
  items: RoamieRecommendationItem[] | undefined,
): RoamieRecommendationItem[] {
  const list = items ?? [];
  if (!list.length) return [];

  if (isTripAddPlaceSession(session)) {
    const cards = list.slice(0, 5);
    logChatRenderModeLocked("PLACE_CARDS_ONLY");
    logChatPlaceCardRender(cards.length, "trip_add_place");
    logChatCardsPreserved(cards.length, "trip_add_place");
    devVerboseInfo("[CHAT_PLACE_CARDS_RENDER_COUNT]", { count: cards.length, tripAddPlace: true });
    return cards;
  }

  // Destination itinerary pipeline: combination → generate → redirect. No place cards.
  if (shouldSuppressChatPlaceCards(session)) {
    logChatRenderModeLocked("TEXT_ONLY_ITINERARY_PLANNING");
    return [];
  }

  if (session.fromMoodFlow || session.fromMoodCard || session.homeMoodShortcutEntry) {
    let working = applyShortcutSceneFidelity(list, session);
    if (
      session.travelContext?.budgetPreference === "low" ||
      session.travelContext?.tripPurpose === "refine_recommendations"
    ) {
      working = refineRecommendationItemsForBudget(working, "low");
    }
    const excluded =
      session.excludedCategories ?? session.travelContext?.excludedCategories ?? [];
    working = filterRecommendationsByExclusion(working, excluded);

    if (session.activeChatIntent === "cafe") {
      return nearbyCategoryRecommendations(working, "cafe", userText);
    }
    if (session.activeChatIntent === "restaurant" || isFoodIntentText(userText)) {
      return nearbyCategoryRecommendations(working, "restaurant", userText);
    }

    const categoryIntents = parseChatPlaceIntents(userText);
    if (categoryIntents.length === 1) {
      return nearbyCategoryRecommendations(working, categoryIntents[0]!, userText);
    }
    if (isFoodIntentText(userText)) {
      return nearbyCategoryRecommendations(working, "restaurant", userText);
    }

    const filtered = filterRecommendationItemsForDisplay(working);
    const count = Math.min(filtered.length, 5);
    logChatPlaceCardRender(count, session.activeChatIntent ?? "mood");
    devVerboseInfo("[CHAT_PLACE_CARDS_RENDER_COUNT]", { count });
    devVerboseInfo("[CHAT_PLACE_CARD_LIMIT]", { limit: 5 });
    return filtered.slice(0, 5);
  }

  if (isPlaceDetailChatActive(session)) {
    const nearbyIntent =
      resolvePlaceDetailNearbyIntent(userText) ??
      (session.activeChatIntent === "cafe"
        ? "cafe"
        : session.activeChatIntent === "restaurant"
          ? "restaurant"
          : session.activeChatIntent === "attraction"
            ? "attraction"
            : null);
    if (nearbyIntent === "cafe") {
      return nearbyCategoryRecommendations(list, "cafe", userText);
    }
    if (nearbyIntent === "restaurant") {
      return nearbyCategoryRecommendations(list, "restaurant", userText);
    }
    if (nearbyIntent === "attraction") {
      return list.slice(0, 6);
    }
    const followUp = parsePlaceDetailFollowUp(userText);
    if (followUp !== "nearby_cafe" && followUp !== "nearby_late_snack") {
      return [];
    }
  }

  if (isDestinationCategoryPlaceDisplay(session, userText)) {
    return recommendationsForCategoryPlaceDisplay(session, userText, list);
  }

  const mustVisitFlow =
    !hasCategoryPlaceQuery(userText) &&
    (session.travelContext?.tripPurpose === "must_visit_places" ||
      session.travelContext?.tripPurpose === "more_place_recommendations" ||
      session.travelContext?.tripPurpose === "refresh_recommendations" ||
      session.travelContext?.mustVisitGenerated ||
      detectMustVisitIntent(userText) ||
      detectPlaceRecommendationIntent(userText));

  if (mustVisitFlow) {
    const cards = list.slice(0, 6);
    devVerboseInfo(`[CHAT_PLACE_CARD_RENDER] count=${cards.length} must_visit=true`);
    if (
      session.travelContext?.tripPurpose === "more_place_recommendations" ||
      session.travelContext?.tripPurpose === "refresh_recommendations"
    ) {
      devVerboseInfo(`[CHAT_MORE_PLACES_RENDERED] count=${cards.length}`);
    }
    return cards;
  }

  if (session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent)) {
    let working = applyShortcutSceneFidelity(list, session);
    if (
      session.travelContext?.budgetPreference === "low" ||
      session.travelContext?.tripPurpose === "refine_recommendations"
    ) {
      working = refineRecommendationItemsForBudget(working, "low");
    }
    const excluded =
      session.excludedCategories ?? session.travelContext?.excludedCategories ?? [];
    working = filterRecommendationsByExclusion(working, excluded);
    const categoryIntents = parseChatPlaceIntents(userText);
    if (categoryIntents.length === 1) {
      return nearbyCategoryRecommendations(working, categoryIntents[0]!, userText);
    }
    if (session.activeChatIntent === "cafe") {
      return nearbyCategoryRecommendations(working, "cafe", userText);
    }
    if (session.activeChatIntent === "restaurant" || isFoodIntentText(userText)) {
      return nearbyCategoryRecommendations(working, "restaurant", userText);
    }
    const filtered = filterRecommendationItemsForDisplay(working);
    let nearbyFiltered = filtered;
    if (!shouldSkipDestinationRenderGuard(session, userText)) {
      const destination = session.travelContext?.destination?.trim();
      if (destination) {
        nearbyFiltered = filterRecommendationsByDestinationRenderGuard(filtered, destination);
      }
    }
    const count = Math.min(nearbyFiltered.length, 5);
    devVerboseInfo(`[CHAT_PLACE_CARD_RENDER] count=${count}`);
    devVerboseInfo("[CHAT_PLACE_CARDS_RENDER_COUNT]", { count });
    devVerboseInfo("[CHAT_PLACE_CARD_LIMIT]", { limit: 5 });
    return nearbyFiltered.slice(0, 5);
  }

  const stage = resolveConversationStage(
    session,
    userText,
    parseTripIntentFromSession(session),
  );
  if (!stageAllowsPlaceCards(stage)) return [];

  let working = list;
  if (
    session.travelContext?.budgetPreference === "low" ||
    session.travelContext?.tripPurpose === "refine_recommendations"
  ) {
    working = refineRecommendationItemsForBudget(working, "low");
  }

  const { maxCount } = mergeBoundsForStage(stage);
  let filtered = filterRecommendationItemsForDisplay(working).slice(0, maxCount);
  const destination = session.travelContext?.destination?.trim();
  const categoryIntents = parseChatPlaceIntents(userText);
  if (categoryIntents.length === 1) {
    filtered = filterRecommendationsForCategoryRender(filtered, categoryIntents[0]!);
    logChatRenderModeLocked("PLACE_CARDS_ONLY");
  } else if (
    destination &&
    !shouldSkipDestinationRenderGuard(session, userText)
  ) {
    filtered = filterRecommendationsByDestinationRenderGuard(filtered, destination);
  }
  devVerboseInfo(`[CHAT_PLACE_CARD_RENDER] count=${filtered.length}`);
  return filtered;
}

/** 合併 assistant 訊息時保留既有 cards，禁止空陣列覆蓋 */
export function mergeAssistantRecommendationMessage(params: {
  content: string;
  roamie?: {
    summary?: string;
    recommendations?: RoamieRecommendationItem[];
    [key: string]: unknown;
  };
  existingRecommendations?: RoamieRecommendationItem[];
}): {
  content: string;
  roamie: {
    summary: string;
    recommendations: RoamieRecommendationItem[];
    [key: string]: unknown;
  };
} {
  const { content, roamie, existingRecommendations = [] } = params;
  const incoming = roamie?.recommendations ?? [];
  const preserved =
    incoming.length > 0
      ? incoming
      : existingRecommendations.length > 0
        ? existingRecommendations
        : incoming;

  if (existingRecommendations.length > 0 && incoming.length === 0) {
    logChatCardsOverwriteBlocked(`kept=${existingRecommendations.length}`);
    logChatCardsPreserved(existingRecommendations.length, "merge_message");
  }

  logChatFinalCardsCount(preserved.length);

  return {
    content,
    roamie: {
      title: "Roamie 推薦",
      itinerary: [],
      ...roamie,
      summary: roamie?.summary ?? content,
      recommendations: preserved,
    },
  };
}
