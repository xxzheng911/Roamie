import {
  mergeBoundsForStage,
  resolveConversationStage,
  stageAllowsPlaceCards,
} from "@/lib/ai/conversation-stage";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { filterRecommendationItemsForDisplay } from "@/lib/recommend-place-ranking";
import { parseTripIntentFromSession } from "@/lib/recommendation/trip-intent";
import type { ChatPlanningSession } from "@/lib/chat-session";

/** 依對話階段決定是否顯示地點卡，避免情緒開場就硬推清單 */
export function recommendationsForChatDisplay(
  session: ChatPlanningSession,
  userText: string,
  items: RoamieRecommendationItem[] | undefined,
): RoamieRecommendationItem[] {
  const list = items ?? [];
  if (!list.length) return [];

  const stage = resolveConversationStage(
    session,
    userText,
    parseTripIntentFromSession(session),
  );
  if (!stageAllowsPlaceCards(stage)) return [];

  const { maxCount } = mergeBoundsForStage(stage);
  return filterRecommendationItemsForDisplay(list).slice(0, maxCount);
}
