import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ConversationWorkspace } from "@/lib/conversation-workspace/types";
import { CONVERSATION_WORKSPACE_SCHEMA_VERSION } from "@/lib/conversation-workspace/types";
import {
  loadConversationWorkspace,
  saveConversationWorkspace,
  saveEphemeralWorkspace,
  setActiveWorkspaceId,
} from "@/lib/conversation-workspace/storage";
import { buildWorkspaceTitle } from "@/lib/conversation-workspace/title";
import { resolveActiveCategoryIntent } from "@/lib/ai/conversation-recommendation-session";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

function sameDestination(a: string, b: string): boolean {
  const left = normalizeDestinationLabel(a).toLowerCase();
  const right = normalizeDestinationLabel(b).toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function resolveDestination(session: ChatPlanningSession): string {
  return (
    session.travelContext?.destination?.trim() ||
    session.tripPlanningContext?.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim() ||
    session.recommendationSession?.destination?.trim() ||
    ""
  );
}

function resolveTripDays(session: ChatPlanningSession): number | undefined {
  return session.tripDays ?? session.travelContext?.days ?? undefined;
}

function resolveTravelDates(session: ChatPlanningSession): ConversationWorkspace["travelDates"] {
  const start =
    session.tripStartDate ??
    session.travelContext?.startDate ??
    session.travelContext?.suggestedStartDate;
  const end = session.tripEndDate ?? session.travelContext?.endDate;
  if (!start && !end) return undefined;
  return { start, end };
}

function resolveStatus(
  session: ChatPlanningSession,
  existing?: ConversationWorkspace | null,
): ConversationWorkspace["status"] {
  if (existing?.itineraryId || session.draftTrip) {
    if (session.phase === "done" || existing?.status === "itinerary_created") {
      return "itinerary_created";
    }
  }
  if (session.phase === "done") return "ready";
  return "planning";
}

/** Enough planning signals to open / update a Draft Workspace. */
export function shouldUpsertDraftWorkspace(session: ChatPlanningSession): boolean {
  const destination = resolveDestination(session);
  if (!destination) return false;
  const days = resolveTripDays(session);
  const dates = resolveTravelDates(session);
  const hasPreference = Boolean(
    session.travelContext?.interests?.length ||
      session.travelContext?.mood?.trim() ||
      session.travelContext?.selectedTripStyle?.trim() ||
      session.travelIntents?.length ||
      session.activeCategoryIntent ||
      session.recommendationSession ||
      session.activeRecommendationContext ||
      session.phase === "recommend" ||
      session.phase === "ready" ||
      session.phase === "generating" ||
      session.phase === "done",
  );
  return Boolean(days || dates?.start || hasPreference);
}

function newIds(): { workspaceId: string; conversationId: string } {
  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    workspaceId: `ws_${stamp}`,
    conversationId: `conv_${stamp}`,
  };
}

function workspaceContentFingerprint(params: {
  destination: string;
  tripDays?: number;
  travelDates?: ConversationWorkspace["travelDates"];
  currentStage?: string;
  currentIntent?: string | null;
  status: ConversationWorkspace["status"];
  messageCount: number;
  lastMessageId?: string;
  draftItineraryId?: string | null;
  recommendationCursor?: number;
  placeCount: number;
}): string {
  return [
    params.destination,
    params.tripDays ?? "",
    params.travelDates?.start ?? "",
    params.travelDates?.end ?? "",
    params.currentStage ?? "",
    params.currentIntent ?? "",
    params.status,
    params.messageCount,
    params.lastMessageId ?? "",
    params.draftItineraryId ?? "",
    params.recommendationCursor ?? "",
    params.placeCount,
  ].join("|");
}

/**
 * Upsert Draft Workspace from chat session.
 * Plus → durable localStorage (cross-session). Free → ephemeral session only (no profile entry).
 *
 * Sort key (`updatedAt`) only bumps when workspace *content* changes —
 * open/restore with identical content must not reorder the drafts list.
 */
export function upsertDraftWorkspaceFromSession(params: {
  session: ChatPlanningSession;
  messages?: ChatMsg[];
  hasPlusAccess: boolean;
  userId?: string | null;
}): ConversationWorkspace | null {
  const { session, messages, hasPlusAccess, userId } = params;
  if (!shouldUpsertDraftWorkspace(session)) return null;

  const destination = resolveDestination(session);
  const tripDays = resolveTripDays(session);
  const travelDates = resolveTravelDates(session);
  const currentIntent = resolveActiveCategoryIntent(session);
  const now = new Date().toISOString();

  // Only bind when this live session already carries workspaceId (explicit restore
  // or prior upsert in the same chat). Never inherit getActiveWorkspaceId() — that
  // leaked previous Conversation Stage into new chats after app reopen.
  const existingId = session.workspaceId?.trim() || undefined;
  const existing =
    hasPlusAccess && existingId ? loadConversationWorkspace(existingId, userId) : null;

  // Different destination → new Draft Workspace (北海道 / 東京 / 名古屋 each listed).
  const reuseExisting =
    Boolean(existing) && sameDestination(existing!.destination, destination);

  const ids = reuseExisting
    ? { workspaceId: existing!.workspaceId, conversationId: existing!.conversationId }
    : newIds();

  const titleCustom = Boolean(reuseExisting && existing?.titleCustom);
  const title = buildWorkspaceTitle({
    destination,
    tripDays,
    themeIntent: currentIntent,
    customTitle: existing?.title,
    titleCustom,
  });

  const nextMessages = messages?.length
    ? messages
    : reuseExisting
      ? existing?.messages
      : undefined;
  const status = resolveStatus(session, reuseExisting ? existing : null);
  const recommendationCursor = session.recommendationSession?.cursor;
  const placeCount =
    (session.recommendedPlaces?.length ?? 0) + (session.selectedPlaces?.length ?? 0);
  const lastMessageId = nextMessages?.length
    ? String(nextMessages[nextMessages.length - 1]?.id ?? nextMessages.length)
    : "";

  const nextFingerprint = workspaceContentFingerprint({
    destination,
    tripDays,
    travelDates,
    currentStage: session.phase,
    currentIntent,
    status,
    messageCount: nextMessages?.length ?? 0,
    lastMessageId,
    draftItineraryId: session.draftTrip ? "draft" : (existing?.itineraryId ?? null),
    recommendationCursor,
    placeCount,
  });
  const prevFingerprint = reuseExisting
    ? workspaceContentFingerprint({
        destination: existing!.destination,
        tripDays: existing!.tripDays,
        travelDates: existing!.travelDates,
        currentStage: existing!.currentStage,
        currentIntent: existing!.currentIntent,
        status: existing!.status,
        messageCount: existing!.messages?.length ?? 0,
        lastMessageId: existing!.messages?.length
          ? String(
              existing!.messages![existing!.messages!.length - 1]?.id ??
                existing!.messages!.length,
            )
          : "",
        draftItineraryId: existing!.draftItinerary
          ? "draft"
          : (existing!.itineraryId ?? null),
        recommendationCursor: existing!.recommendationCursor,
        placeCount:
          (existing!.planningSession?.recommendedPlaces?.length ?? 0) +
          (existing!.planningSession?.selectedPlaces?.length ?? 0),
      })
    : "";
  const contentChanged = !reuseExisting || nextFingerprint !== prevFingerprint;

  const workspace: ConversationWorkspace = {
    schemaVersion: CONVERSATION_WORKSPACE_SCHEMA_VERSION,
    workspaceId: ids.workspaceId,
    conversationId: ids.conversationId,
    title,
    titleCustom,
    destination,
    tripDays,
    travelDates,
    currentStage: session.phase,
    currentIntent,
    travelIntents: session.travelIntents,
    currentRecommendationPool: session.recommendationSession,
    recommendationCursor: session.recommendationSession?.cursor,
    activeRecommendationContext: session.activeRecommendationContext,
    draftItinerary:
      session.draftTrip ?? (reuseExisting ? existing?.draftItinerary : null) ?? null,
    itineraryId: reuseExisting ? existing?.itineraryId : undefined,
    planningSession: {
      ...session,
      workspaceId: ids.workspaceId,
      conversationId: ids.conversationId,
    },
    messages: nextMessages,
    status,
    createdAt: reuseExisting ? (existing?.createdAt ?? now) : now,
    updatedAt: contentChanged ? now : (existing?.updatedAt ?? now),
  };

  if (hasPlusAccess) {
    saveConversationWorkspace(workspace, userId, { bumpUpdatedAt: contentChanged });
    // Best-effort cloud backup (never block chat on network)
    if (userId && contentChanged) {
      void import("@/lib/conversation-workspace/remote-sync").then((m) =>
        m.pushConversationWorkspacesRemote(userId),
      );
    }
  } else {
    // Free: ephemeral only — do NOT delete Plus durable drafts
    saveEphemeralWorkspace(workspace);
    setActiveWorkspaceId(null);
  }

  return workspace;
}

export function attachWorkspaceIdsToSession(
  session: ChatPlanningSession,
  workspace: ConversationWorkspace | null,
): ChatPlanningSession {
  if (!workspace) return session;
  if (
    session.workspaceId === workspace.workspaceId &&
    session.conversationId === workspace.conversationId
  ) {
    return session;
  }
  return {
    ...session,
    workspaceId: workspace.workspaceId,
    conversationId: workspace.conversationId,
  };
}

export function renameConversationWorkspace(params: {
  workspaceId: string;
  title: string;
  userId?: string | null;
}): ConversationWorkspace | null {
  const existing = loadConversationWorkspace(params.workspaceId, params.userId);
  if (!existing) return null;
  const title = params.title.trim();
  if (!title) return existing;
  const next: ConversationWorkspace = {
    ...existing,
    title,
    titleCustom: true,
    updatedAt: new Date().toISOString(),
  };
  saveConversationWorkspace(next, params.userId);
  return next;
}
