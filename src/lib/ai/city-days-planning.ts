import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";
import { pendingQuestionForPlanningNextStep } from "@/lib/ai/destination-pending-question";
import { buildWeatherAwarePlanningReply } from "@/lib/ai/weather-planning-reply";
import {
  buildDestinationCombinationSuggestionsReply,
  hasDestinationCombinations,
} from "@/lib/ai/destination-combination-suggestions";

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

  if (hasDestinationCombinations(label)) {
    const weatherLine =
      options?.weather?.available !== false && options?.weather?.tempC != null
        ? `這幾天${label}約 ${Math.round(options.weather.tempC)}°C，很適合散步。`
        : null;
    const reply =
      buildDestinationCombinationSuggestionsReply(label, days, {
        startDate: options?.context?.startDate,
        weatherLine,
      }) ??
      buildWeatherAwarePlanningReply({
        destination: label,
        days,
        weather: options?.weather,
        context: options?.context,
        destinationCountry,
        preferNextStepQuestion: true,
      }).reply;

    return {
      reply,
      pendingQuestion: pendingQuestionForPlanningNextStep(label, destinationCountry),
    };
  }

  return buildWeatherAwarePlanningReply({
    destination: label,
    days,
    weather: options?.weather,
    context: options?.context,
    destinationCountry,
    preferNextStepQuestion: true,
  });
}
