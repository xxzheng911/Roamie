import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";
import { pendingQuestionForCombinationChoice } from "@/lib/ai/destination-pending-question";
import { buildWeatherAwarePlanningReply } from "@/lib/ai/weather-planning-reply";
import { buildDestinationCombinationSuggestionsReply } from "@/lib/ai/destination-combination-suggestions";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export function pendingQuestionForCityPreference(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_preference",
    options: ["經典景點", "美食咖啡", "海灘放鬆", "都可以"],
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForAskDays(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_days",
    options: [],
    baseDestination,
    destinationCountry,
  });
}

export function buildCityDaysConfirmedReply(
  destination: string,
  days: number,
  destinationCountry?: string,
  options?: {
    weather?: WeatherSummary | null;
    context?: CanonicalTravelContext;
  },
): { reply: string; pendingQuestion: PendingQuestion } {
  const label = normalizeDestinationLabel(destination);
  const startDate = options?.context?.startDate;
  const endDate = options?.context?.endDate;
  const hasExactDate =
    Boolean(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate!.trim()) &&
    Boolean(endDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate!.trim());

  if (hasExactDate) {
    logAiPipeline(
      "[TRIP_DATE_RANGE_PARSED]",
      `startDate=${startDate}`,
      `endDate=${endDate}`,
      `tripDays=${days}`,
    );
    logAiPipeline(
      "[CONVERSATION_STAGE_TRANSITION]",
      "from=COLLECTING_DATE_AND_DURATION",
      "to=AWAITING_COMBINATION_SELECTION",
    );
  }

  const comboReply = buildDestinationCombinationSuggestionsReply(label, days, {
    startDate: hasExactDate ? startDate : undefined,
    endDate: hasExactDate ? endDate : undefined,
    weatherLine: `好，我先記下 ${label} ${days} 天行程方向。`,
  });
  if (comboReply) {
    return {
      reply: comboReply,
      pendingQuestion: pendingQuestionForCombinationChoice(label, destinationCountry),
    };
  }

  return buildWeatherAwarePlanningReply({
    destination: label,
    days,
    weather: options?.weather,
    context: options?.context,
    destinationCountry,
  });
}
