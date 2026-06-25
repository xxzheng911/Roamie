import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";
import { buildWeatherAwarePlanningReply } from "@/lib/ai/weather-planning-reply";

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
  return buildWeatherAwarePlanningReply({
    destination,
    days,
    weather: options?.weather,
    context: options?.context,
    destinationCountry,
    preferNextStepQuestion: true,
  });
}
