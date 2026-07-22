import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { buildWeatherAwarePlanningReply, buildWeatherConstraintAcknowledgement } from "@/lib/ai/weather-planning-reply";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  applyDestinationPendingSelection,
  buildNextStepAfterAdviceSelection,
  type PendingQuestion,
} from "@/lib/ai/destination-pending-question";
import { isDestinationAdviceActive, coerceTravelDestination } from "@/lib/ai/trip-planning-context";
import { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";
import { resolveInferredTripDays } from "@/lib/ai/ai-trip-style";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";

export { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";

export type PlanningSlot =
  | "destination"
  | "days"
  | "preference"
  | "trip_style"
  | "region"
  | "planning_action"
  | "itinerary_action"
  | "exclusion"
  | "flexible_style";

const PENDING_SLOT_MAP: Record<PendingQuestion["type"], PlanningSlot> = {
  ask_days: "days",
  duration_choice: "days",
  ask_preference: "preference",
  preference_choice: "preference",
  ask_trip_style: "trip_style",
  trip_style_choice: "trip_style",
  region_choice: "region",
  city_style_choice: "flexible_style",
  destination_style_choice: "flexible_style",
  activity_choice: "planning_action",
  itinerary_next_step: "itinerary_action",
};

export function pendingSlot(pending?: PendingQuestion): PlanningSlot | undefined {
  if (!pending) return undefined;
  return PENDING_SLOT_MAP[pending.type];
}

export function isPlanningTurnActive(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  return Boolean(
    session.pendingQuestion ||
      session.adviceSelectionThisTurn ||
      session.lastResolvedPendingQuestion ||
      session.conversationMode === "destination_planning" ||
      session.activeChatIntent === "destination_advice" ||
      session.tripPlanningContext?.intent === "destination_planning" ||
      isDestinationAdviceActive(session, ctx),
  );
}

export function logChatPendingParseFailed(
  pending: PendingQuestion,
  userText: string,
): void {
  logAiPipeline(
    "[CHAT_PENDING_PARSE_FAILED]",
    `slot=${pendingSlot(pending) ?? pending.type}`,
    `type=${pending.type}`,
    `userText=${userText.trim()}`,
  );
}

export type PendingAnswerResolution = {
  selected: string;
  contextPatch: Partial<CanonicalTravelContext>;
  session: ChatPlanningSession;
};

/** Parse a user reply against the active pending question. */
export function resolvePendingAnswer(
  userText: string,
  session: ChatPlanningSession,
  ctx: CanonicalTravelContext,
): PendingAnswerResolution | null {
  const pending = session.pendingQuestion;
  if (!pending) return null;

  const applied = applyDestinationPendingSelection(userText, session);
  if (!applied.selectedOption) {
    logChatPendingParseFailed(pending, userText);
    return null;
  }

  const slot = pendingSlot(pending);
  if (slot === "days") {
    const days =
      Number(applied.selectedOption) ||
      parseDayCountFromText(applied.selectedOption) ||
      applied.contextPatch.days;
    logChatContextUpdate({
      destination:
        applied.contextPatch.destination ?? pending.baseDestination ?? ctx.destination,
      days,
    });
  } else if (slot === "preference") {
    logChatContextUpdate({
      destination:
        applied.contextPatch.destination ?? pending.baseDestination ?? ctx.destination,
      preference: applied.selectedOption,
    });
  } else if (slot === "trip_style" || slot === "region" || slot === "flexible_style") {
    logChatContextUpdate({
      destination:
        applied.contextPatch.destination ?? pending.baseDestination ?? ctx.destination,
      selection: applied.selectedOption,
    });
  }

  return {
    selected: applied.selectedOption,
    contextPatch: applied.contextPatch,
    session: {
      ...applied.session,
      travelContext: {
        ...ctx,
        ...applied.contextPatch,
        interests: ctx.interests ?? [],
      },
    },
  };
}

export function advanceAfterPendingSelection(
  selected: string,
  pending: PendingQuestion,
  ctx: CanonicalTravelContext,
): {
  reply: string;
  pendingQuestion?: PendingQuestion;
  contextPatch?: Partial<CanonicalTravelContext>;
} {
  const next = buildNextStepAfterAdviceSelection(selected, pending, ctx);
  if (next.pendingQuestion) {
    logChatNextStep(pendingSlot(next.pendingQuestion) ?? next.pendingQuestion.type);
  }
  return next;
}

export function buildPlanningContextSummary(ctx: CanonicalTravelContext): string {
  const parts: string[] = [];
  const destination = coerceTravelDestination(ctx.destination);
  if (destination) parts.push(`目的地：${destination}`);
  if (ctx.days) parts.push(`天數：${ctx.days}天`);
  if (ctx.vibe || ctx.travelStyle) parts.push(`偏好：${ctx.vibe ?? ctx.travelStyle}`);
  if (ctx.selectedInterests?.length) parts.push(`興趣：${ctx.selectedInterests.join("、")}`);
  if (ctx.budgetLevel) parts.push(`預算：${ctx.budgetLevel}`);
  if (ctx.companion) parts.push(`同行：${ctx.companion}`);
  if (ctx.excludedCategories?.length) parts.push(`排除：${ctx.excludedCategories.join("、")}`);
  return parts.join("\n");
}

/** Last-resort planning reply when remote AI is unavailable. */
export function buildPlanningOfflineReply(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText?: string,
): string | null {
  const dest = coerceTravelDestination(
    ctx.destination ??
      session.tripPlanningContext?.destination ??
      session.tripDestination?.city ??
      session.tripDestination?.displayLabel ??
      session.preferredArea ??
      session.travelContext?.destination,
  );
  if (!dest) return null;

  // Never ask trip duration for explicit place-category recommendations
  if (
    (userText && hasCategoryPlaceQuery(userText)) ||
    ctx.tripPurpose === "recommend_places" ||
    ctx.tripPurpose === "more_place_recommendations" ||
    session.activeCategoryIntent ||
    session.recommendationSession
  ) {
    logAiPipeline(
      "[TRIP_FLOW_BYPASSED]",
      "reason=explicit_place_recommendation",
      `destination=${dest}`,
      userText ? `text=${userText.trim().slice(0, 60)}` : "",
    );
    return null;
  }

  const summary = buildPlanningContextSummary(ctx);
  const inferredDays = resolveInferredTripDays(ctx, session);
  if (session.pendingQuestion?.type === "ask_days" || (!inferredDays && !session.pendingQuestion)) {
    if (inferredDays) {
      logAiPipeline(
        "[ASK_DAYS_TEMPLATE_BLOCKED]",
        "reason=trip_days_already_resolved",
        `tripDays=${inferredDays}`,
      );
    } else {
      return [`好，目的地先記成${dest}。`, summary, "", `你這趟大概幾天？`].filter(Boolean).join("\n");
    }
  }
  const constraintAck = buildWeatherConstraintAcknowledgement(ctx, ctx.weather);
  if (constraintAck && ctx.excludedCategories?.some((c) => /曝曬|中午|高溫|戶外/.test(c))) {
    return constraintAck;
  }

  if (
    session.pendingQuestion?.type === "ask_preference" ||
    session.pendingQuestion?.type === "combination_choice" ||
    (inferredDays && !ctx.vibe && !ctx.selectedInterests?.length)
  ) {
    const planned = buildWeatherAwarePlanningReply({
      destination: dest,
      days: ctx.days ?? inferredDays ?? 1,
      weather: ctx.weather,
      context: ctx,
    });
    return planned.reply;
  }

  const planned = buildWeatherAwarePlanningReply({
    destination: dest,
    days: ctx.days ?? inferredDays ?? 1,
    weather: ctx.weather,
    context: ctx,
  });
  return planned.reply;
}
