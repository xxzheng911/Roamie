import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";
import { pendingQuestionForCombinationChoice } from "@/lib/ai/destination-pending-question";
import { buildWeatherAwarePlanningReply } from "@/lib/ai/weather-planning-reply";
import { buildDestinationCombinationSuggestionsReply } from "@/lib/ai/destination-combination-suggestions";
import { buildScenicMonthPlanningResult } from "@/lib/ai/scenic-month-reply";
import { parseMonthNumber } from "@/lib/ai/season-response-guardrail";
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

/**
 * After a city is confirmed but date/days are still missing:
 * optional month climate note → always ask date or duration.
 * Never asks travel style / lists fixed attractions.
 */
export function buildDateAndDurationQuestionReply(
  destination: string,
  destinationCountry?: string,
  options?: {
    context?: CanonicalTravelContext;
    userText?: string;
    weather?: WeatherSummary | null;
    /** Legacy template that was blocked (for logging). */
    blockedLegacyTemplate?: string;
    previousPendingType?: string;
  },
): { reply: string; pendingQuestion: PendingQuestion } {
  const label = normalizeDestinationLabel(destination);
  const monthNum = parseMonthNumber(options?.context?.travelMonth);
  const hasMonth = monthNum != null;

  if (options?.blockedLegacyTemplate) {
    logAiPipeline(
      "[LEGACY_CITY_FOLLOWUP_BLOCKED]",
      `destination=${label}`,
      "stage=COLLECTING_DATE_AND_DURATION",
      `template=${options.blockedLegacyTemplate}`,
      "reason=date_and_duration_required",
    );
  }

  logAiPipeline(
    "[DATE_DURATION_REPLY_BUILDER_USED]",
    `destination=${label}`,
    `month=${hasMonth ? monthNum : "none"}`,
  );
  if (hasMonth) {
    logAiPipeline("[MONTH_CONTEXT_PRESERVED]", `month=${monthNum}`);
  }
  logAiPipeline(
    "[PENDING_QUESTION_UPDATED]",
    `from=${options?.previousPendingType ?? "none"}`,
    "to=ask_date_or_days",
  );

  let reply: string;
  if (options?.context && hasMonth) {
    reply = buildScenicMonthPlanningResult({
      destination: label,
      context: { ...options.context, destination: label },
      userText: options.userText ?? "",
      weather: options.weather ?? options.context.weather ?? null,
    }).reply;
  } else {
    reply = [
      `好，我們以${label}為主往下規劃。`,
      "",
      "你目前有預計的旅行日期或天數嗎？",
    ].join("\n");
  }

  return {
    reply,
    pendingQuestion: pendingQuestionForAskDays(label, destinationCountry),
  };
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
