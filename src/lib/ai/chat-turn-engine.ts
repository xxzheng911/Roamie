import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { buildWeatherAwarePlanningReply, buildWeatherConstraintAcknowledgement } from "@/lib/ai/weather-planning-reply";
import {
  applyDestinationPendingSelection,
  buildNextStepAfterAdviceSelection,
  type PendingQuestion,
} from "@/lib/ai/destination-pending-question";
import { isDestinationAdviceActive, coerceTravelDestination } from "@/lib/ai/trip-planning-context";
import { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";

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
  console.info(
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

  const summary = buildPlanningContextSummary(ctx);
  if (session.pendingQuestion?.type === "ask_days" || (!ctx.days && !session.pendingQuestion)) {
    return [`好，我先記下：`, summary, "", `你這趟大概幾天？`].filter(Boolean).join("\n");
  }
  const constraintAck = buildWeatherConstraintAcknowledgement(ctx, ctx.weather);
  if (constraintAck && ctx.excludedCategories?.some((c) => /曝曬|中午|高溫|戶外/.test(c))) {
    return constraintAck;
  }

  if (
    session.pendingQuestion?.type === "ask_preference" ||
    (ctx.days && !ctx.vibe && !ctx.selectedInterests?.length)
  ) {
    const planned = buildWeatherAwarePlanningReply({
      destination: dest,
      days: ctx.days ?? 1,
      weather: ctx.weather,
      context: ctx,
      preferNextStepQuestion: true,
    });
    return planned.reply;
  }

  return [
    `好，我先記下：`,
    summary,
    "",
    `接下來我可以幫你抓必去點，或直接排完整 ${ctx.days ?? ""} 天行程。`,
    "你比較想先列必去點，還是直接排完整行程？",
  ].join("\n");
}
