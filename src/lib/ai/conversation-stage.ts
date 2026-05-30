import type { ChatPhase } from "@/lib/ai/context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripIntent } from "@/lib/recommendation/trip-intent";
import {
  userAsksTravelTimeAdvice,
  userExplicitlyWantsPlaceList,
  userWantsItineraryPlanning,
  type AiUserIntentType,
} from "@/lib/ai/user-intent";
import { userWantsMoreRecommendations, userWantsPlanningFinalize } from "@/lib/chat-planning-flow";
import { isDiscoveryComplete, isUserConfirmingItinerary } from "@/lib/chat-session";
import { isFlexiblePreferenceReply } from "@/lib/ai/flexible-preference";
import { isPlanningContextComplete } from "@/lib/ai/conversation-state";

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

/** @deprecated 請用 userExplicitlyWantsPlaceList */
export function userExplicitlyWantsPlaces(text: string): boolean {
  return userExplicitlyWantsPlaceList(text);
}

function conversationStageForAiIntent(
  intent: AiUserIntentType,
  session: ChatPlanningSession,
  userText: string,
): ConversationStage {
  switch (intent) {
    case "travel_time_advice":
      return session.discovery?.vibe?.trim() ? "clarify" : "infer";
    case "itinerary_planning":
      return "itinerary";
    case "place_recommendation":
      return "recommend";
    case "place_discussion":
      return "converge";
    case "mood_nearby":
      return isEmotionalOrVagueTurn(userText) ? "empathize" : "clarify";
    default:
      return "clarify";
  }
}

/** 偏情緒、狀態、猶豫，尚未明確要清單 */
export function isEmotionalOrVagueTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isFlexiblePreferenceReply(t)) return false;
  if (userExplicitlyWantsPlaces(t)) return false;
  return /(累|疲|倦|還好|有點|心情|感覺|不知道|不確定|隨便|放空|難過|開心|想一個人|想安靜|不想動|沒力|壓力|煩|無聊|還行|普通)/.test(
    t,
  );
}

export function resolveConversationStage(
  session: ChatPlanningSession,
  userText: string,
  tripIntent?: TripIntent,
  aiIntentType?: AiUserIntentType,
): ConversationStage {
  const t = userText.trim();

  if (session.phase === "ready" || isUserConfirmingItinerary(t)) return "itinerary";
  if (userWantsPlanningFinalize(t) && session.selectedPlaces.length >= 1) return "itinerary";

  if (aiIntentType) {
    const fromIntent = conversationStageForAiIntent(aiIntentType, session, userText);
    if (aiIntentType === "travel_time_advice" || aiIntentType === "mood_nearby") {
      return fromIntent;
    }
    if (aiIntentType === "place_recommendation") return "recommend";
    if (aiIntentType === "itinerary_planning") return "itinerary";
    if (aiIntentType === "place_discussion") return "converge";
  }

  if (userAsksTravelTimeAdvice(t)) {
    return conversationStageForAiIntent("travel_time_advice", session, userText);
  }

  if (
    isDiscoveryComplete(session) ||
    session.phase === "recommend"
  ) {
    if (session.selectedPlaces.length >= 2 && !userWantsMoreRecommendations(t)) {
      return "converge";
    }
    if (userExplicitlyWantsPlaceList(t) || session.fromMoodFlow || session.fromMoodCard) {
      return "recommend";
    }
  }

  if (
    userExplicitlyWantsPlaceList(t) ||
    (userWantsMoreRecommendations(t) && !userAsksTravelTimeAdvice(t)) ||
    (tripIntent?.readyForRecommendations &&
      session.selectedPlaces.length === 0 &&
      t.length > 0 &&
      userExplicitlyWantsPlaceList(t))
  ) {
    return "recommend";
  }

  if (session.selectedPlaces.length >= 2 && !isEmotionalOrVagueTurn(t)) {
    return userWantsMoreRecommendations(t) ? "recommend" : "converge";
  }

  if (session.selectedPlaces.length >= 1 && userWantsMoreRecommendations(t)) {
    return "recommend";
  }

  if (isFlexiblePreferenceReply(t) && isPlanningContextComplete(session.conversationState)) {
    return "converge";
  }

  if (isEmotionalOrVagueTurn(t)) {
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
    if (session.fromPlanForm && session.selectedPlaces.length < 3) return "expand";
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
  return stage === "recommend";
}

export function stageAllowsPlacesFirst(stage: ConversationStage): boolean {
  return stage === "recommend";
}

export function mergeBoundsForStage(stage: ConversationStage): {
  minCount: number;
  maxCount: number;
} {
  if (stage === "recommend") return { minCount: 2, maxCount: 4 };
  if (stage === "converge") return { minCount: 0, maxCount: 2 };
  return { minCount: 0, maxCount: 0 };
}
