import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { resolveMustVisitDestination } from "@/lib/ai/must-visit-places";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { parseItineraryPlanModeIntent } from "@/lib/ai/itinerary-planning";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  detectMustVisitIntent,
  detectPlaceRecommendationIntent,
} from "@/lib/ai/must-visit-places";
import {
  buildDayPlanSummaryFromBuckets,
  distributeRecommendationsAcrossDays,
  hasCompleteTripPlanningContext,
  resolveTripStyleFromContext,
  shouldAskTripStyle,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";

export type AiConversationState =
  | "COLLECT_INFO"
  | "ASK_TRIP_STYLE"
  | "GENERATE_PLACE_RECOMMENDATIONS"
  | "BUILD_ITINERARY";

const FORBIDDEN_WHEN_READY_RE =
  /(要不要排行程|想先看景點|想先看必去|先推薦必去景點|直接排完整行程|你這趟大概|想排幾天|想去哪|要不要推薦|先列必去點|先定總天數節奏|你比較想先)/;

export function logAiConversationState(state: AiConversationState | string): void {
  logAiPipeline("[AI_STATE]", state);
}

export function logAiPlaceSearch(destination: string): void {
  logAiPipeline("[AI_PLACE_SEARCH]", `destination=${destination}`);
}

export function logAiPlaceResults(count: number): void {
  logAiPipeline("[AI_PLACE_RESULTS]", `count=${count}`);
}

export function logAiPushPlaceCards(count: number): void {
  logAiPipeline("[AI_PUSH_PLACE_CARDS]", `count=${count}`);
}

export function resolveConversationDestination(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): string | undefined {
  const fromCtx = ctx.destination?.trim()
    ? normalizeDestinationLabel(ctx.destination)
    : undefined;

  return (
    fromCtx ??
    resolveMustVisitDestination(ctx) ??
    (session?.travelContext?.destination?.trim()
      ? normalizeDestinationLabel(session.travelContext.destination)
      : undefined) ??
    (session?.tripPlanningContext?.destination?.trim()
      ? normalizeDestinationLabel(session.tripPlanningContext.destination)
      : undefined) ??
    (session?.tripDestination?.city?.trim()
      ? normalizeDestinationLabel(session.tripDestination.city)
      : undefined) ??
    (session?.tripDestination?.displayLabel?.trim()
      ? normalizeDestinationLabel(session.tripDestination.displayLabel)
      : undefined) ??
    (session?.preferredArea?.trim()
      ? normalizeDestinationLabel(session.preferredArea)
      : undefined)
  );
}

export function resolveConversationDays(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): number | undefined {
  return ctx.days ?? session?.tripDays ?? session?.tripPlanningContext?.days;
}

export function hasMinimumPlanningContext(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  return Boolean(resolveConversationDestination(ctx, session) && resolveConversationDays(ctx, session));
}

export { hasCompleteTripPlanningContext, shouldAskTripStyle };

export function resolveAiConversationState(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): AiConversationState {
  if (!resolveConversationDestination(ctx, session) || !resolveConversationDays(ctx, session)) {
    return "COLLECT_INFO";
  }

  if (
    (session?.selectedPlaces.length ?? 0) > 0 ||
    ctx.conversationState === "ready_for_itinerary" ||
    ctx.selectedPlanMode === "full_itinerary" ||
    ctx.tripPurpose === "create_itinerary"
  ) {
    return "BUILD_ITINERARY";
  }

  if (shouldAskTripStyle(ctx, session)) {
    return "ASK_TRIP_STYLE";
  }

  if (resolveTripStyleFromContext(ctx, session) && !ctx.mustVisitGenerated) {
    return "GENERATE_PLACE_RECOMMENDATIONS";
  }

  if (ctx.mustVisitGenerated) {
    return "BUILD_ITINERARY";
  }

  return "COLLECT_INFO";
}

function isRefreshPlaceRequest(userText?: string): boolean {
  if (!userText?.trim()) return false;
  return /(換一批|再推|其他選擇|還有嗎|更多推薦|重新推薦|不要這些|再來)/.test(userText);
}

export function shouldAutoGeneratePlaceRecommendations(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
  userText?: string,
): boolean {
  if (!hasMinimumPlanningContext(ctx, session)) return false;

  if (shouldAskTripStyle(ctx, session, userText)) return false;

  if (isRefreshPlaceRequest(userText)) return true;

  if (userText && (detectMustVisitIntent(userText) || detectPlaceRecommendationIntent(userText))) {
    return true;
  }

  if (userText && parseItineraryPlanModeIntent(userText) === "full_itinerary") return false;

  const style = resolveTripStyleFromContext(ctx, session);
  const pendingStyle =
    session?.pendingQuestion?.type === "ask_trip_style" ||
    session?.lastResolvedPendingQuestion?.type === "ask_trip_style";

  if (session?.adviceSelectionThisTurn && pendingStyle) return true;
  if (session?.adviceSelectionThisTurn && style && !ctx.mustVisitGenerated) return true;

  if (!style) return false;
  if (ctx.mustVisitGenerated) return false;

  return resolveAiConversationState(ctx, session) === "GENERATE_PLACE_RECOMMENDATIONS";
}

export function isForbiddenPlanningQuestion(text: string): boolean {
  return FORBIDDEN_WHEN_READY_RE.test(text);
}

export function buildDayGroupedPlaceSummary(
  destination: string,
  days: number,
  recommendations: RoamieRecommendationItem[],
  style?: TripStyleKey,
): string {
  const label = normalizeDestinationLabel(destination);
  const buckets = distributeRecommendationsAcrossDays(recommendations, days);

  if (!buckets.some((bucket) => bucket.names.length > 0)) {
    return `${label} ${days} 天推薦：\n\n我暫時沒連上即時地點資料，你可以稍後再試。`;
  }

  return buildDayPlanSummaryFromBuckets(label, days, style ?? "mixed", buckets);
}
