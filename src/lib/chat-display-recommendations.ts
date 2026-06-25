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
import { isPlaceDetailChatActive, parsePlaceDetailFollowUp } from "@/lib/ai/place-detail-chat";
import {
  detectMustVisitIntent,
  detectPlaceRecommendationIntent,
} from "@/lib/ai/must-visit-places";

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

export function finalizeChatRecommendationDisplay(
  session: ChatPlanningSession,
  userText: string,
  summary: string,
  items: RoamieRecommendationItem[] | undefined,
): { summary: string; recommendations: RoamieRecommendationItem[] } {
  const recommendations = recommendationsForChatDisplay(session, userText, items);
  const alignedSummary = alignChatRecommendationCount(summary, recommendations.length);
  if (alignedSummary !== summary) {
    console.info(
      `[CHAT_REC_COUNT_SYNC] cards=${recommendations.length} summary_adjusted=true`,
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

  if (isPlaceDetailChatActive(session)) {
    const followUp = parsePlaceDetailFollowUp(userText);
    if (followUp !== "nearby_cafe" && followUp !== "nearby_late_snack") {
      return [];
    }
  }

  const mustVisitFlow =
    session.travelContext?.tripPurpose === "must_visit_places" ||
    session.travelContext?.mustVisitGenerated ||
    detectMustVisitIntent(userText) ||
    detectPlaceRecommendationIntent(userText);

  if (mustVisitFlow) {
    const cards = list.slice(0, 6);
    console.info(`[CHAT_PLACE_CARD_RENDER] count=${cards.length} must_visit=true`);
    return cards;
  }

  if (session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent)) {
    let working = list;
    if (
      session.travelContext?.budgetPreference === "low" ||
      session.travelContext?.tripPurpose === "refine_recommendations"
    ) {
      working = refineRecommendationItemsForBudget(working, "low");
    }
    const excluded =
      session.excludedCategories ?? session.travelContext?.excludedCategories ?? [];
    working = filterRecommendationsByExclusion(working, excluded);
    const filtered = filterRecommendationItemsForDisplay(working);
    const count = Math.min(filtered.length, 5);
    console.info(`[CHAT_PLACE_CARD_RENDER] count=${count}`);
    return filtered.slice(0, 5);
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
  const filtered = filterRecommendationItemsForDisplay(working).slice(0, maxCount);
  console.info(`[CHAT_PLACE_CARD_RENDER] count=${filtered.length}`);
  return filtered;
}
