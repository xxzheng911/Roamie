import type { ChatPlanningSession } from "@/lib/chat-session";
import type { AiDayPlan } from "@/lib/ai/ai-day-plan-source";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

let planningRenderInProgress = false;

export function setPlanningRenderInProgress(value: boolean): void {
  planningRenderInProgress = value;
}

export function isPlanningRenderInProgress(): boolean {
  return planningRenderInProgress;
}

export function createPlanningSessionId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function logAiPlanningSessionStart(sessionId: string): void {
  console.info("[AI_PLANNING_SESSION_START]", `sessionId=${sessionId}`);
}

export function logAiSessionCreate(reason: string, sessionId: string): void {
  console.info("[AI_SESSION_CREATE]", `reason=${reason}`, `sessionId=${sessionId}`);
}

export function logAiSessionReuse(sessionId: string, state: string): void {
  console.info("[AI_SESSION_REUSE]", `sessionId=${sessionId}`, `state=${state}`);
}

export function logAiSessionResetBlocked(reason: string): void {
  console.info("[AI_SESSION_RESET_BLOCKED]", `reason=${reason}`);
}

export function logAiPushPlaceCardsSession(sessionId: string, current: string): void {
  console.info("[AI_PUSH_PLACE_CARDS_SESSION]", `sessionId=${sessionId}`, `current=${current}`);
}

export function logAiPlanningSessionClear(sessionId: string | undefined, reason: string): void {
  console.info(
    "[AI_PLANNING_SESSION_CLEAR]",
    `sessionId=${sessionId ?? "none"}`,
    `reason=${reason}`,
  );
}

export function logAiPlaceCardsSkipStale(oldSessionId: string, currentSessionId: string): void {
  console.info(
    "[AI_PLACE_CARDS_SKIP_STALE]",
    `oldSessionId=${oldSessionId}`,
    `currentSessionId=${currentSessionId}`,
  );
}

export function logAiCreateTripSessionValidate(sessionId: string | undefined): void {
  console.info("[AI_CREATE_TRIP_SESSION_VALIDATE]", `sessionId=${sessionId ?? "none"}`);
}

export function logAiStaleRecommendationsBlocked(): void {
  console.info("[AI_STALE_RECOMMENDATIONS_BLOCKED]");
}

export type PlanningSessionHandle = {
  session: ChatPlanningSession;
  sessionId: string;
  created: boolean;
};

/** 取得或建立本輪規劃 session；同一輪 ASK_STYLE → GENERATE → RENDER 必須重用 */
export function getOrCreatePlanningSessionId(
  session: ChatPlanningSession,
  reason: string,
): PlanningSessionHandle {
  if (session.planningSessionId?.trim()) {
    logAiSessionReuse(session.planningSessionId, reason);
    return {
      session,
      sessionId: session.planningSessionId,
      created: false,
    };
  }
  const sessionId = createPlanningSessionId();
  logAiSessionCreate(reason, sessionId);
  logAiPlanningSessionStart(sessionId);
  return {
    session: { ...session, planningSessionId: sessionId },
    sessionId,
    created: true,
  };
}

export function ensurePlanningSessionId(session: ChatPlanningSession): ChatPlanningSession {
  return getOrCreatePlanningSessionId(session, "ensure").session;
}

export function clearPlanningSessionState(
  session: ChatPlanningSession,
  reason: string,
): ChatPlanningSession {
  logAiPlanningSessionClear(session.planningSessionId, reason);
  return {
    ...session,
    currentDayPlan: undefined,
    recommendedPlaces: [],
    selectedPlaces: [],
    recommendedPlaceIds: [],
    recommendedNormalizedNames: [],
    plannedStops: [],
    draftTrip: undefined,
    travelContext: session.travelContext
      ? {
          ...session.travelContext,
          mustVisitGenerated: false,
          planningTripStyle: undefined,
          tripPurpose: undefined,
        }
      : session.travelContext,
    chatPlanningState: "idle",
  };
}

export function startNewPlanningSession(
  session: ChatPlanningSession,
  reason = "new_prompt",
): ChatPlanningSession {
  if (planningRenderInProgress) {
    logAiSessionResetBlocked(`render_in_progress:${reason}`);
    return session;
  }
  const cleared = clearPlanningSessionState(session, reason);
  const planningSessionId = createPlanningSessionId();
  logAiSessionCreate(reason, planningSessionId);
  logAiPlanningSessionStart(planningSessionId);
  return {
    ...cleared,
    planningSessionId,
    chatPlanningState: "idle",
  };
}

export function shouldStartNewPlanningSession(
  prev: ChatPlanningSession,
  nextDestination?: string,
): boolean {
  const prevDest =
    prev.travelContext?.destination?.trim() ||
    prev.tripDestination?.displayLabel?.trim() ||
    prev.tripDestination?.city?.trim();
  const normalizedNext = nextDestination?.trim()
    ? normalizeDestinationLabel(nextDestination)
    : "";
  if (!normalizedNext) return false;
  if (!prevDest?.trim()) return false;
  return normalizeDestinationLabel(prevDest) !== normalizedNext;
}

export function isDayPlanSessionValid(
  session: ChatPlanningSession,
  dayPlan?: AiDayPlan,
  flowSessionId?: string,
): boolean {
  if (!dayPlan?.items.length) return false;
  const expected = flowSessionId ?? session.planningSessionId;
  if (!expected) return false;
  return dayPlan.planningSessionId === expected;
}

/** 僅擋真正舊 session；render 進行中不誤判 */
export function isStalePlanningSession(
  session: ChatPlanningSession,
  cardSessionId?: string,
  flowSessionId?: string,
): boolean {
  if (!cardSessionId) return false;
  const currentId = flowSessionId ?? session.planningSessionId;
  if (!currentId) return false;
  if (planningRenderInProgress && cardSessionId === currentId) return false;
  return cardSessionId !== currentId;
}

export function alignDayPlanToSession(dayPlan: AiDayPlan, sessionId: string): AiDayPlan {
  if (dayPlan.planningSessionId === sessionId) return dayPlan;
  return { ...dayPlan, planningSessionId: sessionId };
}
