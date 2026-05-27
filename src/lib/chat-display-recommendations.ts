import {
  mergeBoundsForStage,
  resolveConversationStage,
  stageAllowsPlaceCards,
} from "@/lib/ai/conversation-stage";
import {
  resolveAiUserIntent,
  responseModeForIntent,
  shouldRenderPlaceCards,
} from "@/lib/ai/user-intent";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { filterRecommendationItemsForDisplay } from "@/lib/recommend-place-ranking";
import { parseTripIntentFromSession } from "@/lib/recommendation/trip-intent";
import type { ChatPlanningSession } from "@/lib/chat-session";

/** 依 AI intent 與對話階段決定是否顯示地點卡 */
export function recommendationsForChatDisplay(
  session: ChatPlanningSession,
  userText: string,
  items: RoamieRecommendationItem[] | undefined,
): RoamieRecommendationItem[] {
  const list = items ?? [];
  if (!list.length) return [];

  const tripIntent = parseTripIntentFromSession(session);
  const aiIntent = resolveAiUserIntent(session, userText, tripIntent);
  responseModeForIntent(aiIntent);
  if (!shouldRenderPlaceCards(aiIntent, false)) return [];

  const stage = resolveConversationStage(session, userText, tripIntent, aiIntent.type);
  if (!stageAllowsPlaceCards(stage)) return [];

  const { maxCount } = mergeBoundsForStage(stage);
  return filterRecommendationItemsForDisplay(list).slice(0, maxCount);
}
