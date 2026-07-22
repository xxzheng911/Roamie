/**
 * Conversation Session lifecycle — decoupled from Workspace.
 *
 * Live flow state (pendingQuestion / stage / destination selection) exists only
 * for the current chat lifecycle. Workspace may snapshot a planningSession for
 * explicit Plus restore, but must never auto-hydrate into a new chat.
 */
import {
  clearChatSession,
  createEmptySession,
  loadChatSession,
  saveChatSession,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import { clearChatUiCache } from "@/lib/chat-ui-cache";
import {
  clearEphemeralWorkspace,
  setActiveWorkspaceId,
} from "@/lib/conversation-workspace/storage";

export type ChatSessionCreateReason =
  | "new_chat"
  | "chat_page_open"
  | "chat_reset"
  | "handoff"
  | "app_reopen";

function createConversationId(): string {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Flow / planner state that must not leak into a new chat. */
export function hasConversationFlowState(session: ChatPlanningSession): boolean {
  const pending = session.pendingQuestion?.type;
  const stage = session.chatPlanningState;
  const ctx = session.travelContext;
  return Boolean(
    pending ||
      session.lastAssistantReply?.trim() ||
      session.adviceSelectionThisTurn ||
      session.lastResolvedPendingQuestion ||
      session.tripPlanningContext ||
      session.activeChatIntent === "destination_advice" ||
      session.conversationMode === "destination_planning" ||
      session.planningSessionId ||
      session.currentDayPlan ||
      session.draftTrip ||
      session.recommendationSession ||
      session.activeRecommendationContext ||
      session.workspaceId ||
      (stage && stage !== "idle") ||
      ctx?.destination?.trim() ||
      ctx?.offeredCombinations?.length ||
      ctx?.selectedCombinationIds?.length ||
      ctx?.tripPurpose ||
      ctx?.conversationState ||
      session.tripDays ||
      session.tripDestination?.city?.trim() ||
      session.tripDestination?.displayLabel?.trim(),
  );
}

export function describeConversationStage(session: ChatPlanningSession): string {
  if (session.pendingQuestion?.type === "combination_choice") {
    return "AWAITING_COMBINATION_SELECTION";
  }
  if (session.pendingQuestion?.type === "ask_days") {
    return "COLLECTING_DATE_AND_DURATION";
  }
  if (session.pendingQuestion?.type === "ask_trip_style") {
    return "AWAITING_TRIP_STYLE";
  }
  if (session.pendingQuestion?.type) {
    return `PENDING:${session.pendingQuestion.type}`;
  }
  if (session.chatPlanningState && session.chatPlanningState !== "idle") {
    return String(session.chatPlanningState);
  }
  if (session.travelContext?.conversationState) {
    return String(session.travelContext.conversationState);
  }
  return "INITIAL";
}

function logConversationStateLeak(params: {
  oldSessionId: string;
  oldStage: string;
  newSessionId: string;
  reason: ChatSessionCreateReason;
}): void {
  console.warn(
    "[CONVERSATION_STATE_LEAK]",
    `oldSessionId=${params.oldSessionId}`,
    `oldStage=${params.oldStage}`,
    `newSessionId=${params.newSessionId}`,
    `reason=${params.reason}`,
  );
}

export function logWorkspaceRestored(workspaceId: string): void {
  // Workspace snapshot → live session only on explicit draft open.
  // Navigation return route is independent (see chat-navigation).
  console.info("[WORKSPACE_RESTORE]", `workspaceId=${workspaceId}`, "source=explicit_draft_open");
}

export function logWorkspaceNotRestored(reason = "new_chat"): void {
  console.info("[WORKSPACE_NOT_RESTORED]", `reason=${reason}`);
}

/**
 * Create a brand-new Conversation Session at INITIAL.
 * Detaches Workspace binding; does not delete durable Plus drafts.
 */
export function beginNewChatSession(opts?: {
  reason?: ChatSessionCreateReason;
  previous?: ChatPlanningSession | null;
  /** Plus: allocate conversationId only; workspaceId stays nil until draft upsert */
  hasPlusAccess?: boolean;
}): ChatPlanningSession {
  const reason = opts?.reason ?? "new_chat";
  const previous =
    opts?.previous ?? (typeof window !== "undefined" ? loadChatSession() : createEmptySession());
  const oldSessionId =
    previous.conversationId?.trim() ||
    previous.planningSessionId?.trim() ||
    previous.workspaceId?.trim() ||
    "none";
  const oldStage = describeConversationStage(previous);
  const conversationId = createConversationId();

  if (hasConversationFlowState(previous) || oldStage !== "INITIAL") {
    logConversationStateLeak({
      oldSessionId,
      oldStage,
      newSessionId: conversationId,
      reason,
    });
  }

  const session: ChatPlanningSession = {
    ...createEmptySession(),
    conversationId,
    workspaceId: undefined,
    pendingQuestion: undefined,
    lastAssistantReply: undefined,
    adviceSelectionThisTurn: undefined,
    lastResolvedPendingQuestion: undefined,
    travelContext: undefined,
    tripPlanningContext: undefined,
    chatPlanningState: "idle",
    planningSessionId: undefined,
    currentDayPlan: undefined,
    draftTrip: undefined,
    aiItineraryState: undefined,
    activeChatIntent: undefined,
    activeCategoryIntent: undefined,
    travelIntents: undefined,
    recommendationSession: undefined,
    activeRecommendationContext: undefined,
    conversationMode: undefined,
    tripDestination: undefined,
    tripOrigin: undefined,
    tripStartDate: undefined,
    tripEndDate: undefined,
    tripDays: undefined,
    tripStyles: undefined,
  };

  console.info("[CHAT_SESSION_CREATED]", `sessionId=${conversationId}`, `reason=${reason}`);
  console.info("[CHAT_SESSION_RESET]", "stage=INITIAL");
  logWorkspaceNotRestored(reason === "chat_reset" ? "chat_reset" : "new_chat");

  if (typeof window !== "undefined") {
    clearChatSession();
    clearChatUiCache();
    clearEphemeralWorkspace();
    setActiveWorkspaceId(null);
    saveChatSession(session);
  }

  return session;
}

/** Detach live chat from any Workspace without deleting drafts. */
export function detachLiveChatFromWorkspace(): void {
  if (typeof window === "undefined") return;
  clearEphemeralWorkspace();
  setActiveWorkspaceId(null);
}

/**
 * True when /chat should start at INITIAL (new Conversation Session).
 * False for explicit Workspace restore or intentional handoffs (plan / mood / map / …).
 */
export function shouldStartFreshChatSession(search: {
  from?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
  mood?: string;
  tripId?: string;
  workspaceId?: string;
}): boolean {
  if (search.workspaceId?.trim()) return false;
  if (search.from?.trim()) return false;
  if (search.recommendationId?.trim()) return false;
  if (search.fromMoodFlow === "1") return false;
  if (search.mood?.trim()) return false;
  if (search.tripId?.trim()) return false;
  return true;
}
