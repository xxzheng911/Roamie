import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  hasConfirmedTripDays,
  parseAskTripStyleSelection,
  resolveInferredTripDays,
  resolveTripStyleFromContext,
  tripStyleLabel,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import { resolveConversationDestination } from "@/lib/ai/ai-chat-conversation-state";
import {
  isPlanningRenderInProgress,
  resetPlanningSessionForStyleReselect,
} from "@/lib/ai/ai-planning-session";
import { logAiStyleReselectDetected } from "@/lib/ai/planning-style-reselect-log";

export type ChatPlanningState =
  | "idle"
  | "waitingDestination"
  | "waitingTripDays"
  | "waitingStyleSelection"
  | "generatingPlan"
  | "planGenerated"
  | "generationFailed";

const REPLAN_INTENT_RE =
  /重排|重新規劃|換一種風格|換個風格|新行程|重新安排|重做行程|換風格|重來/;

export function logChatPlanningState(state: ChatPlanningState, reason?: string): void {
  logAiPipeline("[CHAT_PLANNING_STATE]", `state=${state}`, reason ? `reason=${reason}` : "");
}

export function logChatStyleReselected(style: TripStyleKey, previous?: TripStyleKey): void {
  logAiPipeline(
    "[CHAT_STYLE_RESELECTED]",
    `style=${style}`,
    previous ? `previous=${previous}` : "",
  );
}

export function logChatPreviousPlacesCleared(): void {
  logAiPipeline("[CHAT_PREVIOUS_PLACES_CLEARED]");
}

export function logChatRegeneratePlaceCardsStart(
  destination: string,
  style: TripStyleKey,
  days?: number,
): void {
  logAiPipeline(
    "[CHAT_REGENERATE_PLACE_CARDS_START]",
    `destination=${destination}`,
    `style=${style}`,
    days != null ? `days=${days}` : "",
  );
}

export function logChatRegeneratePlaceCardsDone(count: number): void {
  logAiPipeline("[CHAT_REGENERATE_PLACE_CARDS_DONE]", `count=${count}`);
}

export function isReplanIntent(text: string): boolean {
  return REPLAN_INTENT_RE.test(text.trim());
}

/** 使用者輸入 1~4 或選項名稱 */
export function isStyleOptionMessage(text: string): boolean {
  return parseAskTripStyleSelection(text) != null;
}

/** 風格選項已選（含首次選 1~4），應觸發行程地點生成 */
export function shouldTriggerTripStylePlanning(
  userText: string,
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  const travel = ctx ?? session.travelContext ?? { interests: [] };
  const style = parseAskTripStyleSelection(userText);
  if (!style && !resolveTripStyleFromContext(travel, session)) return false;
  if (!resolveConversationDestination(travel, session)) return false;
  if (!hasConfirmedTripDays(travel, session)) return false;

  if (session.pendingQuestion?.type === "ask_trip_style" && style) return true;
  if (session.chatPlanningState === "waitingStyleSelection" && style) return true;
  if (session.lastResolvedPendingQuestion?.type === "ask_trip_style" && style) return true;
  if (isStyleReselectTurn(userText, session, travel)) return true;

  if (isPlanGenerated(session, travel)) return false;

  return Boolean(
    style &&
      resolveTripStyleFromContext(
        { ...travel, planningTripStyle: style },
        session,
      ),
  );
}

export function parseStyleReselectMessage(text: string): TripStyleKey | null {
  return parseAskTripStyleSelection(text);
}

export function hasActiveTripPlanningSession(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  const travel = ctx ?? session.travelContext ?? { interests: [] };
  const destination = resolveConversationDestination(travel, session);
  if (!destination) return false;
  if (!hasConfirmedTripDays(travel, session)) return false;
  return Boolean(
    session.planningSessionId ||
      (session.currentDayPlan?.items.length ?? 0) > 0 ||
      travel.mustVisitGenerated ||
      (session.recommendedPlaces?.length ?? 0) > 0,
  );
}

export function isStyleReselectTurn(
  userText: string,
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): TripStyleKey | null {
  const style = parseStyleReselectMessage(userText);
  if (!style) return null;
  if (!isPlanGenerated(session, ctx) && !hasActiveTripPlanningSession(session, ctx)) return null;
  return style;
}

export function isPlanGenerated(session: ChatPlanningSession, ctx?: CanonicalTravelContext): boolean {
  const travel = ctx ?? session.travelContext;
  return Boolean(
    session.chatPlanningState === "planGenerated" ||
      (session.currentDayPlan?.items.length ?? 0) > 0 ||
      travel?.mustVisitGenerated,
  );
}

/** 阻止再次「詢問」1~4 選項；不阻止使用者主動重選 */
export function shouldBlockStyleSelection(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
  userText?: string,
): boolean {
  if (userText && isStyleReselectTurn(userText, session, ctx)) return false;
  if (isPlanningRenderInProgress()) return true;
  if (session.chatPlanningState === "generatingPlan") return true;
  if (isPlanGenerated(session, ctx)) return true;
  return false;
}

export function resolveChatPlanningState(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): ChatPlanningState {
  const travel = ctx ?? session.travelContext ?? { interests: [] };

  if (isPlanningRenderInProgress() || session.chatPlanningState === "generatingPlan") {
    return "generatingPlan";
  }

  if (
    session.chatPlanningState === "planGenerated" ||
    (session.currentDayPlan?.items.length ?? 0) > 0 ||
    travel.mustVisitGenerated
  ) {
    return "planGenerated";
  }

  const destination = resolveConversationDestination(travel, session);
  if (!destination) return "waitingDestination";

  if (!hasConfirmedTripDays(travel, session)) return "waitingTripDays";

  if (!resolveTripStyleFromContext(travel, session)) return "waitingStyleSelection";

  return session.chatPlanningState ?? "idle";
}

export function withChatPlanningState(
  session: ChatPlanningSession,
  state: ChatPlanningState,
  reason?: string,
): ChatPlanningSession {
  logChatPlanningState(state, reason);
  return { ...session, chatPlanningState: state };
}

export function clearPreviousGeneratedPlaces(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): ChatPlanningSession {
  logChatPreviousPlacesCleared();
  const travel = ctx ?? session.travelContext ?? { interests: [] };
  return {
    ...session,
    currentDayPlan: undefined,
    recommendedPlaces: [],
    selectedPlaces: [],
    recommendedPlaceIds: [],
    recommendedNormalizedNames: [],
    plannedStops: [],
    draftTrip: undefined,
    pendingQuestion: undefined,
    adviceSelectionThisTurn: undefined,
    lastResolvedPendingQuestion: undefined,
    travelContext: {
      ...travel,
      mustVisitGenerated: false,
      planningStage: undefined,
    },
  };
}

export function applyStyleReselectToSession(
  session: ChatPlanningSession,
  ctx: CanonicalTravelContext,
  style: TripStyleKey,
): ChatPlanningSession {
  const previous = resolveTripStyleFromContext(ctx, session);
  logAiStyleReselectDetected(previous ?? "unknown", style);
  logChatStyleReselected(style, previous);
  const cleared = clearPreviousGeneratedPlaces(session, ctx);
  const destination =
    resolveConversationDestination(ctx, session) ?? ctx.destination ?? cleared.travelContext?.destination;
  const resolvedDays =
    resolveInferredTripDays(ctx, session) ??
    ctx.days ??
    cleared.travelContext?.days ??
    session.tripDays;
  const reset = resetPlanningSessionForStyleReselect(
    {
      ...cleared,
      tripDays: resolvedDays,
      travelContext: {
        ...(cleared.travelContext ?? { interests: [] }),
        destination,
        days: resolvedDays,
        startDate: ctx.startDate ?? cleared.travelContext?.startDate ?? session.tripStartDate,
        endDate: ctx.endDate ?? cleared.travelContext?.endDate ?? session.tripEndDate,
        planningDaysConfirmed: true,
        planningTripStyle: style,
        selectedTripStyle: tripStyleLabel(style),
        travelStyle: tripStyleLabel(style),
        tripPurpose: "trip_style_selected",
        mustVisitGenerated: false,
        conversationState: "preference_selected",
        planningStage: undefined,
      },
    },
    style,
  );
  return withChatPlanningState(reset, "generatingPlan", "style_reselect");
}

export function resetChatPlanningForReplan(
  session: ChatPlanningSession,
  reason: string,
): ChatPlanningSession {
  logChatPlanningState("waitingStyleSelection", reason);
  return {
    ...session,
    chatPlanningState: "waitingStyleSelection",
    currentDayPlan: undefined,
    pendingQuestion: undefined,
    adviceSelectionThisTurn: undefined,
    lastResolvedPendingQuestion: undefined,
    recommendedPlaces: [],
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      mustVisitGenerated: false,
      planningTripStyle: undefined,
      selectedTripStyle: undefined,
      tripPurpose: "awaiting_trip_style",
      conversationState: "awaiting_preference",
    },
  };
}

/** 重選風格時移除上一輪地點卡助理訊息 */
export function stripPreviousPlaceCardMessages(messages: ChatMsg[]): ChatMsg[] {
  let lastCardIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (
      msg?.role === "assistant" &&
      ((msg.roamie?.recommendations?.length ?? 0) > 0 || msg.roamie?.dayPlan?.items?.length)
    ) {
      lastCardIndex = i;
      break;
    }
  }
  if (lastCardIndex < 0) return messages;
  return [...messages.slice(0, lastCardIndex), ...messages.slice(lastCardIndex + 1)];
}
