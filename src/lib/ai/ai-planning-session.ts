import type { ChatPlanningSession } from "@/lib/chat-session";
import type { AiDayPlan } from "@/lib/ai/ai-day-plan-source";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { logAiStyleReselectSessionReset } from "@/lib/ai/planning-style-reselect-log";
import { resetPlannerSession } from "@/lib/ai/planner-session-guard";

let planningRenderInProgress = false;
let planningRenderSessionId: string | undefined;

/** 本輪已凍結的有效 dayPlan，避免空 Planner / stale async 覆寫 */
let frozenDayPlanBySession = new Map<string, AiDayPlan>();

export function freezePlanningDayPlan(sessionId: string, dayPlan: AiDayPlan): void {
  const id = sessionId.trim();
  if (!id || !dayPlan.items.length) return;
  frozenDayPlanBySession.set(id, dayPlan);
  logAiPipeline(
    "[AI_PLANNING_DAY_PLAN_FROZEN]",
    `sessionId=${id}`,
    `items=${dayPlan.items.length}`,
  );
}

export function getFrozenPlanningDayPlan(sessionId?: string): AiDayPlan | undefined {
  const id = sessionId?.trim();
  if (!id) return undefined;
  return frozenDayPlanBySession.get(id);
}

export function clearFrozenPlanningDayPlan(sessionId?: string): void {
  const id = sessionId?.trim();
  if (!id) {
    frozenDayPlanBySession.clear();
    return;
  }
  frozenDayPlanBySession.delete(id);
}

export function setPlanningRenderInProgress(value: boolean, sessionId?: string): void {
  planningRenderInProgress = value;
  planningRenderSessionId = value ? sessionId?.trim() || planningRenderSessionId : undefined;
}

export function isPlanningRenderInProgress(forSessionId?: string): boolean {
  if (!planningRenderInProgress) return false;
  const expected = forSessionId?.trim() || planningRenderSessionId?.trim();
  if (!expected || !planningRenderSessionId?.trim()) return true;
  return planningRenderSessionId === expected;
}

export function getPlanningRenderSessionId(): string | undefined {
  return planningRenderSessionId;
}

export function createPlanningSessionId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function logAiPlanningSessionStart(sessionId: string): void {
  logAiPipeline("[AI_PLANNING_SESSION_START]", `sessionId=${sessionId}`);
}

export function logAiSessionCreate(reason: string, sessionId: string): void {
  logAiPipeline("[AI_SESSION_CREATE]", `reason=${reason}`, `sessionId=${sessionId}`);
}

export function logAiSessionReuse(sessionId: string, state: string): void {
  logAiPipeline("[AI_SESSION_REUSE]", `sessionId=${sessionId}`, `state=${state}`);
}

export function logAiSessionResetBlocked(reason: string): void {
  logAiPipeline("[AI_SESSION_RESET_BLOCKED]", `reason=${reason}`);
}

export function logAiPushPlaceCardsSession(sessionId: string, current: string): void {
  logAiPipeline("[AI_PUSH_PLACE_CARDS_SESSION]", `sessionId=${sessionId}`, `current=${current}`);
}

export function logAiPlanningSessionClear(sessionId: string | undefined, reason: string): void {
  logAiPipeline(
    "[AI_PLANNING_SESSION_CLEAR]",
    `sessionId=${sessionId ?? "none"}`,
    `reason=${reason}`,
  );
}

export function logAiPlaceCardsSkipStale(oldSessionId: string, currentSessionId: string): void {
  logAiPipeline(
    "[AI_PLACE_CARDS_SKIP_STALE]",
    `oldSessionId=${oldSessionId}`,
    `currentSessionId=${currentSessionId}`,
  );
}

export function logAiCreateTripSessionValidate(sessionId: string | undefined): void {
  logAiPipeline("[AI_CREATE_TRIP_SESSION_VALIDATE]", `sessionId=${sessionId ?? "none"}`);
}

export function logAiStaleRecommendationsBlocked(): void {
  logAiPipeline("[AI_STALE_RECOMMENDATIONS_BLOCKED]");
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
  clearFrozenPlanningDayPlan(session.planningSessionId);
  resetPlannerSession(session.planningSessionId);
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

/** 切換行程風格：保留目的地／天數等上下文，清空上一版規劃與錯誤狀態 */
export function resetPlanningSessionForStyleReselect(
  session: ChatPlanningSession,
  style: TripStyleKey,
): ChatPlanningSession {
  const planVersion = (session.planVersion ?? 0) + 1;
  clearFrozenPlanningDayPlan(session.planningSessionId);
  resetPlannerSession(session.planningSessionId);
  const planningSessionId = createPlanningSessionId();
  logAiStyleReselectSessionReset(planVersion, planningSessionId);
  logAiSessionCreate("style_reselect", planningSessionId);
  logAiPlanningSessionStart(planningSessionId);

  return {
    ...session,
    planningSessionId,
    planVersion,
    chatPlanningState: "generatingPlan",
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
    usedPlaceIds: undefined,
    usedPlaceNames: undefined,
    usedAreaKeys: undefined,
    travelContext: session.travelContext
      ? {
          ...session.travelContext,
          mustVisitGenerated: false,
          planningStage: undefined,
          planningTripStyle: style,
        }
      : session.travelContext,
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
