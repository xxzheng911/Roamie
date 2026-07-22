import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  buildDestinationCombinationSuggestionsReply,
  hasDestinationCombinations,
} from "@/lib/ai/destination-combination-suggestions";
import {
  buildDestinationRecommendationFailedMessage,
  REFRESH_DESTINATION_RECOMMENDATIONS_OPTION,
} from "@/lib/ai/destination-combination-discovery";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { pendingQuestionForCombinationChoice } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

function formatTempLabel(temp?: number | null): string | null {
  if (temp == null || Number.isNaN(temp)) return null;
  return `${Math.round(temp)}°C`;
}

function hasAvoidHot(context?: CanonicalTravelContext): boolean {
  return Boolean(
    context?.excludedCategories?.some((c) => /曝曬|中午|高溫/.test(c)) ||
      (context?.setting === "室內" && /避暑|怕熱/.test(context.vibe ?? "")),
  );
}

function pendingQuestionForRefreshRecommendations(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_preference",
    options: [REFRESH_DESTINATION_RECOMMENDATIONS_OPTION],
    baseDestination,
    destinationCountry,
  });
}

/**
 * After destination + days/dates are known, only offer combinations.
 * Legacy trip-summary / "直接排完整行程 vs 先推薦必去" is blocked.
 */
export function buildWeatherAwarePlanningReply(params: {
  destination: string;
  days: number;
  weather?: WeatherSummary | null;
  context?: CanonicalTravelContext;
  destinationCountry?: string;
  preferNextStepQuestion?: boolean;
}): { reply: string; pendingQuestion: PendingQuestion } {
  const label = normalizeDestinationLabel(params.destination);
  const days = params.days;
  const startDate = params.context?.startDate;
  const endDate = params.context?.endDate;
  const hasExactDate =
    Boolean(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate!.trim()) &&
    Boolean(endDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate!.trim());

  if (hasDestinationCombinations(label)) {
    const comboReply = buildDestinationCombinationSuggestionsReply(label, days, {
      weatherLine: `好，我先記下 ${label} ${days} 天的行程方向。`,
      startDate: hasExactDate ? startDate : undefined,
      endDate: hasExactDate ? endDate : undefined,
    });
    if (comboReply) {
      return {
        reply: comboReply,
        pendingQuestion: pendingQuestionForCombinationChoice(
          label,
          params.destinationCountry,
        ),
      };
    }
  }

  logAiPipeline(
    "[LEGACY_TRIP_REPLY_BLOCKED]",
    "template=trip_summary_or_direct_choice",
    `destination=${label}`,
    `days=${days}`,
  );

  return {
    reply: buildDestinationRecommendationFailedMessage(label),
    pendingQuestion: pendingQuestionForRefreshRecommendations(
      label,
      params.destinationCountry,
    ),
  };
}

export function buildWeatherConstraintAcknowledgement(
  context: CanonicalTravelContext,
  weather?: WeatherSummary | null,
): string | null {
  const dest = context.destination?.trim();
  if (!dest) return null;

  const avoidHot = hasAvoidHot(context);
  if (!avoidHot) return null;

  const temp = weather?.feelsLikeC ?? weather?.tempC;
  const tempLabel = formatTempLabel(temp);
  const label = normalizeDestinationLabel(dest);

  return [
    tempLabel ? `最近${label}白天約 ${tempLabel}，確實偏熱。` : `我會避開讓你太曬的行程。`,
    "我幫你穿插室內景點，避免中午長時間曝曬。",
    "",
    "接下來我會依你的日期與偏好，先給幾組可選行程方向。",
  ].join("\n");
}
