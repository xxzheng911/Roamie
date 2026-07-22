import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import type { ConversationRecommendationSession } from "@/lib/ai/conversation-recommendation-session";
import type { ActiveRecommendationContext } from "@/lib/ai/recommendation-refinement/types";
import type { RoamiePayloadV2 } from "@/lib/ai/types";

export const CONVERSATION_WORKSPACE_SCHEMA_VERSION = 1 as const;

export type TravelDraftStatus = "planning" | "ready" | "itinerary_created";

/** Plus Conversation Workspace / 旅行草稿 — single source of chat context */
export type ConversationWorkspace = {
  schemaVersion: typeof CONVERSATION_WORKSPACE_SCHEMA_VERSION;
  workspaceId: string;
  conversationId: string;
  title: string;
  /** When true, auto title updates must not overwrite */
  titleCustom?: boolean;
  destination: string;
  tripDays?: number;
  travelDates?: { start?: string; end?: string };
  currentStage?: string;
  currentIntent?: ChatPlaceCategoryIntent;
  travelIntents?: ChatPlaceCategoryIntent[];
  currentRecommendationPool?: ConversationRecommendationSession;
  recommendationCursor?: number;
  /** Multi-turn recommendation refinement (cuisine / budget / exclusions) */
  activeRecommendationContext?: ActiveRecommendationContext;
  draftItinerary?: RoamiePayloadV2 | null;
  /** Linked formal itinerary id (if created) — delete workspace must not delete this */
  itineraryId?: string;
  /** Planning session snapshot for explicit Workspace restore only (never auto-hydrate). */
  planningSession?: ChatPlanningSession;
  /** Chat messages for resume */
  messages?: ChatMsg[];
  status: TravelDraftStatus | "archived";
  createdAt: string;
  updatedAt: string;
};

/** List row / TravelDraftSummary */
export type ConversationWorkspaceListItem = {
  workspaceId: string;
  title: string;
  destination: string;
  tripDays?: number;
  startDate?: string;
  endDate?: string;
  status: TravelDraftStatus | "archived";
  updatedAt: string;
  createdAt?: string;
  messageCount?: number;
  itineraryId?: string;
  currentIntent?: ChatPlaceCategoryIntent;
};

export type TravelDraftSummary = ConversationWorkspaceListItem;
