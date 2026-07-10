import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { PendingQuestion, PendingQuestionType } from "@/lib/ai/destination-pending-question";
import type { TripInterest } from "@/lib/ai/trip-preference";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

/** What the system expects the user to answer next. */
export type ExpectedAnswerType =
  | "destination"
  | "days"
  | "travel_style"
  | "preference"
  | "region"
  | "planning_action"
  | "itinerary_action"
  | "budget"
  | "companion"
  | "exclusion"
  | "affirmation";

export type ConversationState =
  | "awaiting_destination"
  | "awaiting_days"
  | "awaiting_preference"
  | "awaiting_planning_action"
  | "awaiting_itinerary_action"
  | "preference_selected"
  | "ready_for_itinerary"
  | "itinerary_draft";

const PENDING_TYPE_TO_EXPECTED: Record<PendingQuestionType, ExpectedAnswerType> = {
  ask_days: "days",
  duration_choice: "days",
  ask_preference: "preference",
  preference_choice: "preference",
  ask_trip_style: "travel_style",
  trip_style_choice: "travel_style",
  region_choice: "region",
  city_style_choice: "travel_style",
  destination_style_choice: "travel_style",
  activity_choice: "planning_action",
  itinerary_next_step: "itinerary_action",
};

const PENDING_TYPE_TO_CONVERSATION_STATE: Partial<Record<PendingQuestionType, ConversationState>> = {
  ask_days: "awaiting_days",
  duration_choice: "awaiting_days",
  ask_preference: "awaiting_preference",
  preference_choice: "awaiting_preference",
  ask_trip_style: "awaiting_preference",
  activity_choice: "awaiting_planning_action",
  itinerary_next_step: "awaiting_itinerary_action",
};

export type EnrichedPendingQuestion = PendingQuestion & {
  expectedAnswerType: ExpectedAnswerType;
  conversationState: ConversationState;
};

const AFFIRMATIVE_REPLY_RE =
  /^(好|好的|好啊|可以|行|ok|yes|嗯|對|對啊|沒問題|沒問題的|幫我排|直接排|就這樣|就這樣排|開始排)$/i;

const PREFERENCE_CANONICAL: Record<
  string,
  { travelStyle: string; vibe: string; interests: TripInterest[] }
> = {
  經典景點: { travelStyle: "sightseeing", vibe: "經典景點", interests: ["attractions"] },
  美食咖啡: { travelStyle: "food", vibe: "美食咖啡", interests: ["food"] },
  海灘放鬆: { travelStyle: "beach", vibe: "海灘放鬆", interests: ["attractions"] },
  都可以: { travelStyle: "mixed", vibe: "混合", interests: ["attractions", "food"] },
  購物: { travelStyle: "shopping", vibe: "購物", interests: ["shopping"] },
};

export function expectedAnswerTypeForPending(
  pending?: PendingQuestion,
): ExpectedAnswerType | undefined {
  if (!pending) return undefined;
  return PENDING_TYPE_TO_EXPECTED[pending.type];
}

export function enrichPendingQuestion(pending: PendingQuestion): EnrichedPendingQuestion {
  return {
    ...pending,
    expectedAnswerType: PENDING_TYPE_TO_EXPECTED[pending.type],
    conversationState:
      PENDING_TYPE_TO_CONVERSATION_STATE[pending.type] ?? "awaiting_preference",
  };
}

export function normalizePreferenceSelection(selected: string): {
  label: string;
  travelStyle: string;
  vibe: string;
  interests: TripInterest[];
} {
  const canonical = PREFERENCE_CANONICAL[selected];
  if (canonical) {
    return { label: selected, ...canonical };
  }
  if (/購物|shopping/i.test(selected)) {
    return { label: "購物", ...PREFERENCE_CANONICAL.購物 };
  }
  if (/景點|地標|sightseeing/i.test(selected)) {
    return { label: "經典景點", ...PREFERENCE_CANONICAL.經典景點 };
  }
  return {
    label: selected,
    travelStyle: selected,
    vibe: selected,
    interests: [],
  };
}

export function contextPatchForPreferenceSelection(
  selected: string,
  pending: PendingQuestion,
): Partial<CanonicalTravelContext> {
  const normalized = normalizePreferenceSelection(selected);
  return {
    destination: pending.baseDestination,
    destinationCountry: pending.destinationCountry,
    vibe: normalized.vibe,
    travelStyle: normalized.travelStyle,
    selectedTripStyle: normalized.label,
    selectedInterests: normalized.interests,
    interests: normalized.interests.map((interest) =>
      interest === "attractions"
        ? "景點"
        : interest === "food"
          ? "美食"
          : interest === "shopping"
            ? "購物"
            : interest,
    ),
    tripPurpose: "trip_style_selected",
    conversationState: "preference_selected",
  };
}

export function isAffirmativeReply(text: string): boolean {
  return AFFIRMATIVE_REPLY_RE.test(text.trim());
}

export function isGenericFallbackReply(text: string): boolean {
  return /我先用目前掌握的需求幫你整理方向/.test(text.trim());
}

export function planningFactSnapshot(ctx: CanonicalTravelContext): Record<string, string | number> {
  const facts: Record<string, string | number> = {};
  if (ctx.destination) facts.destination = ctx.destination;
  if (ctx.days) facts.days = ctx.days;
  if (ctx.travelStyle) facts.travelStyle = ctx.travelStyle;
  if (ctx.vibe) facts.vibe = ctx.vibe;
  if (ctx.budgetLevel) facts.budget = ctx.budgetLevel;
  if (ctx.budgetPreference) facts.budgetPreference = ctx.budgetPreference;
  if (ctx.companion) facts.companion = ctx.companion;
  if (ctx.selectedInterests?.length) facts.interests = ctx.selectedInterests.join(",");
  if (ctx.excludedCategories?.length) facts.exclusions = ctx.excludedCategories.join(",");
  return facts;
}

export function shouldSkipAskingDays(ctx: CanonicalTravelContext): boolean {
  return Boolean(ctx.days);
}

export function shouldSkipAskingPreference(ctx: CanonicalTravelContext): boolean {
  return Boolean(
    ctx.travelStyle ||
      ctx.selectedInterests?.length ||
      ctx.conversationState === "preference_selected" ||
      ctx.conversationState === "ready_for_itinerary",
  );
}

export function recoverPendingFromAssistantReply(
  reply: string,
  ctx: CanonicalTravelContext,
): PendingQuestion | undefined {
  if (!reply.trim()) return undefined;

  if (reply.includes("你比較偏：") && reply.includes("A. 經典景點") && ctx.destination) {
    return enrichPendingQuestion({
      type: "ask_preference",
      options: ["經典景點", "美食咖啡", "海灘放鬆", "都可以"],
      baseDestination: ctx.destination,
      destinationCountry: ctx.destinationCountry,
    });
  }

  if (reply.includes("你這趟大概幾天") && ctx.destination && !ctx.days) {
    return enrichPendingQuestion({
      type: "ask_days",
      options: [],
      baseDestination: ctx.destination,
      destinationCountry: ctx.destinationCountry,
    });
  }

  if (reply.includes("先列必去點") && reply.includes("排完整")) {
    return enrichPendingQuestion({
      type: "activity_choice",
      options: ["must_visit_places", "daily_rhythm"],
      baseDestination: ctx.destination,
      destinationCountry: ctx.destinationCountry,
    });
  }

  if (reply.includes("我直接幫你排完整") && reply.includes("我先推薦每一天")) {
    return enrichPendingQuestion({
      type: "itinerary_next_step",
      options: ["full_itinerary", "daily_recommendations"],
      baseDestination: ctx.destination,
      destinationCountry: ctx.destinationCountry,
    });
  }

  return undefined;
}

export function ensureSessionPendingQuestion(
  session: ChatPlanningSession,
  lastAssistantReply?: string,
): ChatPlanningSession {
  if (session.pendingQuestion) {
    return {
      ...session,
      pendingQuestion: enrichPendingQuestion(session.pendingQuestion),
    };
  }
  if (!lastAssistantReply) return session;
  const ctx = session.travelContext ?? { interests: [] };
  const recovered = recoverPendingFromAssistantReply(lastAssistantReply, ctx);
  if (!recovered) return session;
  logAiPipeline(
    "[CHAT_PENDING_RECOVERED]",
    `type=${recovered.type}`,
    `expected=${PENDING_TYPE_TO_EXPECTED[recovered.type]}`,
  );
  return {
    ...session,
    pendingQuestion: enrichPendingQuestion(recovered),
    conversationMode: session.conversationMode ?? "destination_planning",
    activeChatIntent: session.activeChatIntent ?? "destination_advice",
  };
}

/** Recover pending + normalize planning session before parsing user reply. */
export function prepareSessionForUserTurn(
  session: ChatPlanningSession,
  lastAssistantReply?: string,
): ChatPlanningSession {
  const reply = lastAssistantReply ?? session.lastAssistantReply;
  return ensureSessionPendingQuestion(session, reply);
}

export function logConversationStateUpdate(
  ctx: CanonicalTravelContext,
  pending?: PendingQuestion,
): void {
  const facts = planningFactSnapshot(ctx);
  const parts = Object.entries(facts)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  if (parts.length > 0) {
    devVerboseInfo("[CHAT_CONTEXT_UPDATE]", parts.join(" "));
  }
  if (pending) {
    devVerboseInfo(
      "[CHAT_NEXT_STEP]",
      PENDING_TYPE_TO_CONVERSATION_STATE[pending.type] ?? pending.type,
    );
  }
}

function isAdvicePurposeActive(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  const purpose = ctx?.tripPurpose ?? session.travelContext?.tripPurpose;
  return (
    session.activeChatIntent === "destination_advice" ||
    purpose === "best_time_to_visit" ||
    purpose === "seasonal_destination" ||
    purpose === "itinerary_planning" ||
    purpose === "region_selected" ||
    purpose === "destination_selection" ||
    purpose === "route_combination_selected" ||
    purpose === "trip_style_selected" ||
    purpose === "duration_selected" ||
    purpose === "option_selected"
  );
}

export function isDestinationPlanningSession(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  return Boolean(
    session.pendingQuestion ||
      session.conversationMode === "destination_planning" ||
      session.activeChatIntent === "destination_advice" ||
      session.tripPlanningContext?.intent === "destination_planning" ||
      isAdvicePurposeActive(session, ctx),
  );
}
