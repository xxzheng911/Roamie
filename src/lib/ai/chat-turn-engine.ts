import { observeCombinationHelper } from './combination-selection-diagnostics';
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
import { applyKoParticles, displayDestinationForCopy } from "@/lib/ai/destination-locale-aliases";
import { styleOptionDisplay } from "@/lib/ai/destination-style-guide";
import { chatRuntimeCopy } from "@/lib/chat-runtime-copy";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";

export { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";

export type PlanningSlot =
  | "destination"
  | "dates"
  | "days"
  | "preference"
  | "trip_style"
  | "region"
  | "planning_action"
  | "itinerary_action"
  | "exclusion"
  | "flexible_style";

const PENDING_SLOT_MAP: Record<PendingQuestion["type"], PlanningSlot> = {
  date_confirmation: "dates",
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
  locale?: import("@/lib/i18n/types").Locale,
): {
  reply: string;
  pendingQuestion?: PendingQuestion;
  contextPatch?: Partial<CanonicalTravelContext>;
} {
  const next = buildNextStepAfterAdviceSelection(selected, pending, ctx, locale);
  if (next.pendingQuestion) {
    logChatNextStep(pendingSlot(next.pendingQuestion) ?? next.pendingQuestion.type);
  }
  return next;
}

export function buildPlanningContextSummary(
  ctx: CanonicalTravelContext,
  locale?: import("@/lib/i18n/types").Locale,
): string {
  const parts: string[] = [];
  const destination = coerceTravelDestination(ctx.destination);
  if (destination) {
    parts.push(chatRuntimeCopy("summaryDestination", locale, {
      destination: displayDestinationForCopy(destination, undefined, locale ?? effectiveAppLocale()),
    }));
  }
  if (ctx.days) parts.push(chatRuntimeCopy("summaryDays", locale, { days: ctx.days }));
  const shownLocale = locale ?? effectiveAppLocale();
  if (ctx.vibe || ctx.travelStyle) {
    const value = ctx.vibe ?? ctx.travelStyle ?? "";
    parts.push(chatRuntimeCopy("summaryPreference", locale, {
      value: shownLocale === "zh-TW" ? value : styleOptionDisplay(value, shownLocale),
    }));
  }
  if (ctx.selectedInterests?.length) {
    parts.push(chatRuntimeCopy("summaryInterests", locale, {
      interests: ctx.selectedInterests.join(shownLocale === "en" || shownLocale === "ko" ? ", " : "、"),
    }));
  }
  if (ctx.budgetLevel) {
    parts.push(chatRuntimeCopy("summaryBudget", locale, {
      budget: summaryValueDisplay(ctx.budgetLevel, SUMMARY_BUDGET_DISPLAY, shownLocale),
    }));
  }
  if (ctx.companion) {
    parts.push(chatRuntimeCopy("summaryCompanion", locale, {
      companion: summaryValueDisplay(ctx.companion, SUMMARY_COMPANION_DISPLAY, shownLocale),
    }));
  }
  if (ctx.excludedCategories?.length) {
    parts.push(chatRuntimeCopy("summaryExcluded", locale, {
      excluded:
        shownLocale === "zh-TW"
          ? ctx.excludedCategories.join("、")
          : ctx.excludedCategories
              .map((value) => summaryValueDisplay(value, SUMMARY_EXCLUDED_DISPLAY, shownLocale))
              .join(shownLocale === "ja" ? "、" : ", "),
    }));
  }
  return parts.join("\n");
}

type SummaryDisplayTable = Record<string, Record<"en" | "ja" | "ko", string>>;

/** Fixed parser values (travel-context parseBudget) → display label; internal value unchanged. */
const SUMMARY_BUDGET_DISPLAY: SummaryDisplayTable = {
  budget: { en: "Budget-friendly", ja: "節約", ko: "알뜰하게" },
  luxury: { en: "Luxury", ja: "ラグジュアリー", ko: "럭셔리" },
  quality: { en: "Quality-focused", ja: "品質重視", ko: "퀄리티 중시" },
};

/** Fixed parser values (parseCompanion / discovery.companionship) → display label. */
const SUMMARY_COMPANION_DISPLAY: SummaryDisplayTable = {
  一個人: { en: "Solo", ja: "ひとり", ko: "혼자" },
  女友: { en: "Partner", ja: "パートナー", ko: "연인" },
  情侶: { en: "Couple", ja: "カップル", ko: "연인" },
  朋友: { en: "Friends", ja: "友人", ko: "친구" },
  家人: { en: "Family", ja: "家族", ko: "가족" },
};

/** Fixed weather-constraint values (travel-context excludedCategories) → display label. */
const SUMMARY_EXCLUDED_DISPLAY: SummaryDisplayTable = {
  戶外曝曬: { en: "Long sun exposure outdoors", ja: "屋外での日差し", ko: "야외 햇볕 노출" },
  中午戶外: { en: "Outdoor activities at midday", ja: "昼の屋外", ko: "한낮 야외 활동" },
  戶外長時間: { en: "Long stretches outdoors", ja: "長時間の屋外", ko: "장시간 야외 활동" },
  戶外: { en: "Outdoor", ja: "屋外", ko: "야외" },
  長距離步行: { en: "Long walks", ja: "長距離の徒歩", ko: "장거리 도보" },
};

/** Known option → locale label; free text the user typed is kept as-is. */
function summaryValueDisplay(
  value: string,
  table: SummaryDisplayTable,
  locale: import("@/lib/i18n/types").Locale,
): string {
  if (locale === "zh-TW") return value;
  return table[value]?.[locale] ?? value;
}

/** Last-resort planning reply when remote AI is unavailable. */
export function buildPlanningOfflineReply(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText?: string,
  locale?: import("@/lib/i18n/types").Locale,
): string | null {
  observeCombinationHelper(session, null);
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

  const summary = buildPlanningContextSummary(ctx, locale);
  const inferredDays = resolveInferredTripDays(ctx, session);
  if (session.pendingQuestion?.type === "ask_days" || (!inferredDays && !session.pendingQuestion)) {
    if (inferredDays) {
      logAiPipeline(
        "[ASK_DAYS_TEMPLATE_BLOCKED]",
        "reason=trip_days_already_resolved",
        `tripDays=${inferredDays}`,
      );
    } else {
      const resolvedLocale = locale ?? effectiveAppLocale();
      const shown = displayDestinationForCopy(dest, userText, resolvedLocale);
      return [applyKoParticles(chatRuntimeCopy("destNoted", resolvedLocale, { destination: shown }), [shown], resolvedLocale), summary, "", chatRuntimeCopy("offlineDaysAsk", resolvedLocale)].filter(Boolean).join("\n");
    }
  }
  const constraintAck = buildWeatherConstraintAcknowledgement(ctx, ctx.weather, locale ?? effectiveAppLocale());
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
      locale,
      days: ctx.days ?? inferredDays ?? 1,
      weather: ctx.weather,
      context: ctx,
    });
    observeCombinationHelper(session, planned.contextPatch?.offeredCombinations?.length ?? 0);
    return planned.reply;
  }

  const planned = buildWeatherAwarePlanningReply({
    destination: dest,
    locale,
    days: ctx.days ?? inferredDays ?? 1,
    weather: ctx.weather,
    context: ctx,
  });
  observeCombinationHelper(session, planned.contextPatch?.offeredCombinations?.length ?? 0);
  return planned.reply;
}
