import type { ChatPhase } from "@/lib/ai/context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { isNearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { isFoodPreferenceReply } from "@/lib/ai/chat-dining-flow";
import { isDestinationAdviceActive } from "@/lib/ai/trip-planning-context";
import { isFlexiblePreferenceReply } from "@/lib/ai/destination-advice";
import { isPlanningTurnActive } from "@/lib/ai/chat-turn-engine";
import { isBudgetRefinementText } from "@/lib/ai/budget-refinement";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import type { TripIntent } from "@/lib/recommendation/trip-intent";
import { userWantsMoreRecommendations, userWantsPlanningFinalize } from "@/lib/chat-planning-flow";
import { isDiscoveryComplete, isUserConfirmingItinerary } from "@/lib/chat-session";

/** Roamie 六段對話：理解 → 推測 → 確認 → 收斂 → 推薦 → 行程 */
export type ConversationStage =
  | "empathize"
  | "infer"
  | "clarify"
  | "converge"
  | "recommend"
  | "itinerary";

const STAGE_LABEL: Record<ConversationStage, string> = {
  empathize: "理解情緒",
  infer: "推測需求",
  clarify: "反問確認",
  converge: "收斂方向",
  recommend: "推薦地點",
  itinerary: "生成行程",
};

export function conversationStageLabel(stage: ConversationStage): string {
  return STAGE_LABEL[stage];
}

/** 使用者明確要地點、店名、推薦 */
export function userExplicitlyWantsPlaces(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(推薦|去哪|哪裡|什麼地方|有沒有|幫我找|咖啡廳|餐廳|景點|酒吧|宵夜|夜景|散步|走走|逛逛|附近|這一帶|想去|帶我去)/.test(
    t,
  );
}

/** 偏情緒、狀態、猶豫，尚未明確要清單 */
export function isEmotionalOrVagueTurn(text: string, session?: ChatPlanningSession): boolean {
  const t = text.trim();
  if (!t) return false;
  if (session && (isDestinationAdviceActive(session) || isFlexiblePreferenceReply(t))) {
    return false;
  }
  if (userExplicitlyWantsPlaces(t)) return false;
  if (
    session?.activeChatIntent &&
    isNearbyPlaceIntent(session.activeChatIntent) &&
    isFoodPreferenceReply(t)
  ) {
    return false;
  }
  return /(累|疲|倦|還好|有點|心情|感覺|不知道|不確定|隨便|都可以|放空|難過|開心|想一個人|想安靜|不想動|沒力|壓力|煩|無聊|還行|普通)/.test(
    t,
  );
}

export function resolveConversationStage(
  session: ChatPlanningSession,
  userText: string,
  tripIntent?: TripIntent,
): ConversationStage {
  const t = userText.trim();

  if (isPlanningTurnActive(session, session.travelContext)) {
    return session.pendingQuestion ? "clarify" : "infer";
  }

  if (isBudgetRefinementText(t)) return "recommend";

  if (
    session.activeChatIntent &&
    isNearbyPlaceIntent(session.activeChatIntent) &&
    (session.foodPreference || isFoodPreferenceReply(t))
  ) {
    return "recommend";
  }

  const hasGps =
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001);
  const moodSignal = Boolean(
    session.mood ||
      session.travelContext?.mood ||
      session.travelContext?.vibe ||
      session.fromMoodFlow ||
      session.fromMoodCard ||
      (!isDestinationAdviceActive(session) && /(放鬆|走走|散步|累|下雨|咖啡|都可以)/.test(t)),
  );
  if (isPlaceDetailChatActive(session)) {
    return userExplicitlyWantsPlaces(t) ? "recommend" : "converge";
  }

  if (hasGps && moodSignal && !isDestinationAdviceActive(session)) return "recommend";

  if (session.phase === "ready" || isUserConfirmingItinerary(t)) return "itinerary";
  if (userWantsPlanningFinalize(t) && session.selectedPlaces.length >= 1) return "itinerary";

  if (
    isDiscoveryComplete(session) ||
    session.phase === "recommend" ||
    tripIntent?.readyForRecommendations
  ) {
    if (session.selectedPlaces.length >= 2 && !userWantsMoreRecommendations(t)) {
      return "converge";
    }
    return "recommend";
  }

  if (
    userExplicitlyWantsPlaces(t) ||
    userWantsMoreRecommendations(t) ||
    /(餐廳|吃飯|聚餐|咖啡廳|咖啡|景點)/.test(t) ||
    (tripIntent?.readyForRecommendations && session.selectedPlaces.length === 0 && t.length > 0)
  ) {
    if (isDestinationAdviceActive(session) || session.pendingQuestion) {
      return "clarify";
    }
    return "recommend";
  }

  if (session.selectedPlaces.length >= 2 && !isEmotionalOrVagueTurn(t, session)) {
    return userWantsMoreRecommendations(t) ? "recommend" : "converge";
  }

  if (session.selectedPlaces.length >= 1 && userWantsMoreRecommendations(t)) {
    return "recommend";
  }

  if (isEmotionalOrVagueTurn(t, session)) {
    const turns = session.lastUserIntent ? 1 : 0;
    if (turns === 0 || /(累|疲|心情|感覺|有點)/.test(t)) return "empathize";
    return "clarify";
  }

  if (tripIntent && !tripIntent.readyForRecommendations && tripIntent.missingKeys.length > 0) {
    return tripIntent.missingKeys.includes("destination") ? "clarify" : "infer";
  }

  if (session.phase === "discover" || session.phase === "collect") {
    return session.selectedPlaces.length ? "converge" : "infer";
  }

  if (session.selectedPlaces.length) return "converge";
  return "clarify";
}

/** 對應既有 chatPhase（Places-first、prompt 相容） */
export function chatPhaseForStage(
  stage: ConversationStage,
  session: ChatPlanningSession,
  userText: string,
): ChatPhase {
  if (stage === "itinerary") return session.selectedPlaces.length ? "confirm" : "collect";
  if (stage === "recommend") {
    if ((session.fromPlanForm || session.fromPlanAi) && session.selectedPlaces.length < 3) return "expand";
    if (session.fromMoodFlow && session.selectedPlaces.length > 0) return "expand";
    if (session.selectedPlaces.length) return "expand";
    if (session.recommendedPlaces.length) return "recommend";
    return "recommend";
  }
  if (stage === "converge") {
    return session.selectedPlaces.length ? "followup" : "collect";
  }
  if (stage === "clarify" || stage === "infer") return "discover";
  if (stage === "empathize") return "discover";
  if (userWantsMoreRecommendations(userText)) return "expand";
  return "discover";
}

export function stageAllowsPlaceCards(stage: ConversationStage): boolean {
  return stage === "recommend" || stage === "converge";
}

export function stageAllowsPlacesFirst(stage: ConversationStage): boolean {
  return stage === "recommend";
}

export function mergeBoundsForStage(stage: ConversationStage): {
  minCount: number;
  maxCount: number;
} {
  if (stage === "recommend") return { minCount: 2, maxCount: 5 };
  if (stage === "converge") return { minCount: 0, maxCount: 2 };
  return { minCount: 0, maxCount: 0 };
}
