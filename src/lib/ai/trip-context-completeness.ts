import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveSessionDestination } from "@/lib/ai/conversation-state";
import { normalizeDestination } from "@/lib/ai/normalize-destination";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";
import {
  mergeMustIncludePlaces,
  parseMustIncludePlaces,
} from "@/lib/ai/must-include-places";
import { userRequestsFullItineraryPlanning } from "@/lib/ai/itinerary-trigger";

export type TripContextSlice = {
  destination?: string;
  travelMonth?: string;
  travelDate?: string;
  days?: number;
  mustIncludePlaces?: string[];
};

export function extractTripContextSlice(
  session: ChatPlanningSession,
  userText?: string,
): TripContextSlice {
  const parsed = userText?.trim() ? parseTravelContextFromText(userText.trim(), session) : {};
  const destination =
    normalizeDestination(parsed.destination) ??
    normalizeDestination(session.conversationState?.destination) ??
    normalizeDestination(session.conversationContext?.destination) ??
    normalizeDestination(session.travelContext?.destination) ??
    resolveSessionDestination(session);

  const travelMonth =
    parsed.travelMonth ??
    session.conversationContext?.travelMonth ??
    session.conversationState?.travelMonth ??
    session.travelContext?.travelMonth;

  const travelDate =
    parsed.startDate ??
    session.conversationContext?.travelDate ??
    session.conversationState?.travelDate ??
    session.travelDate ??
    session.tripStartDate;

  const days =
    parsed.days ??
    session.conversationContext?.travelDays ??
    session.conversationState?.days ??
    session.travelContext?.days ??
    session.tripDays;

  const mustIncludePlaces = mergeMustIncludePlaces(
    mergeMustIncludePlaces(
      session.travelContext?.mustIncludePlaces,
      session.conversationContext?.mustIncludePlaces,
    ),
    userText ? parseMustIncludePlaces(userText) : [],
  );

  return {
    destination: destination ?? undefined,
    travelMonth: travelMonth ?? undefined,
    travelDate: travelDate ?? undefined,
    days: days ?? undefined,
    mustIncludePlaces: mustIncludePlaces.length ? mustIncludePlaces : undefined,
  };
}

export function isTripContextComplete(ctx: TripContextSlice): boolean {
  return (
    Boolean(ctx.destination?.trim()) &&
    ctx.days != null &&
    ctx.days >= 1 &&
    Boolean(ctx.travelMonth?.trim() || ctx.travelDate?.trim())
  );
}

/** 排行程最低條件：目的地 + 天數 */
export function hasCoreTripPlanningContext(ctx: TripContextSlice): boolean {
  return Boolean(ctx.destination?.trim()) && ctx.days != null && ctx.days >= 1;
}

export function isConversationStateTripComplete(state?: {
  destination?: string;
  travelMonth?: string;
  travelDate?: string;
  days?: number;
}): boolean {
  return isTripContextComplete({
    destination: state?.destination,
    travelMonth: state?.travelMonth,
    travelDate: state?.travelDate,
    days: state?.days,
  });
}

export function logTripContextCompleteness(
  session: ChatPlanningSession,
  userText?: string,
): TripContextSlice {
  const slice = extractTripContextSlice(session, userText);
  console.info("[CHAT_CONTEXT_PARSED]", {
    source: "trip_context_slice",
    destination: slice.destination ?? null,
    travelMonth: slice.travelMonth ?? null,
    travelDate: slice.travelDate ?? null,
    days: slice.days ?? null,
    budget: session.budget ?? session.conversationContext?.budget ?? null,
    transport: session.transportation ?? session.conversationContext?.transportation ?? null,
    travelStyles: session.tripStyles ?? null,
    travelers: session.tripCompanionCount ?? null,
    fromPlanForm: Boolean(session.fromPlanForm),
    isComplete: isTripContextComplete(slice),
  });
  console.info("[TRIP_CONTEXT_COMPLETENESS]", {
    destination: slice.destination ?? null,
    travelMonth: slice.travelMonth ?? null,
    days: slice.days ?? null,
    mustIncludePlaces: slice.mustIncludePlaces ?? [],
    isComplete: isTripContextComplete(slice),
  });
  return slice;
}

export function logChatContextMerged(
  previous: TripContextSlice,
  newMessage: string,
  merged: TripContextSlice,
): void {
  console.info("[CHAT_CONTEXT_MERGED]", {
    previousContext: previous,
    newMessage: newMessage.slice(0, 120),
    mergedContext: merged,
  });
}

export type AiNextStepAction =
  | "answer_date_recommendation"
  | "ask_preference"
  | "generate_itinerary"
  | "ask_missing_field"
  | "travel_advice";

export function decideAiNextStep(
  session: ChatPlanningSession,
  userText: string,
): { action: AiNextStepAction; reason: string } {
  const slice = extractTripContextSlice(session, userText);
  const complete = isTripContextComplete(slice);

  if (userRequestsFullItineraryPlanning(userText) && hasCoreTripPlanningContext(slice)) {
    return {
      action: "generate_itinerary",
      reason: "explicit_plan_request_with_destination_and_days",
    };
  }

  if (
    complete &&
    userAsksDateRangeRecommendation(userText) &&
    !userRequestsFullItineraryPlanning(userText)
  ) {
    return { action: "answer_date_recommendation", reason: "complete_context_date_question" };
  }

  if (complete && !userRequestsFullItineraryPlanning(userText)) {
    const hasPrefs =
      (session.conversationState?.preferences.length ?? 0) > 0 ||
      Boolean(session.mood?.trim());
    if (!hasPrefs) {
      return { action: "ask_preference", reason: "complete_context_missing_preferences" };
    }
    return { action: "ask_preference", reason: "complete_context_offer_next_step" };
  }

  if (userAsksTravelTimeAdviceText(userText) && !userRequestsFullItineraryPlanning(userText)) {
    return { action: "travel_advice", reason: "incomplete_travel_time_question" };
  }

  return { action: "ask_missing_field", reason: "gathering_required_fields" };
}

/** 使用者詢問「建議哪幾天／幾號到幾號」 */
export function userAsksDateRangeRecommendation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (userRequestsFullItineraryPlanning(t)) return false;
  return (
    /(哪幾天|哪\s*\d+\s*天|建議哪|幾號到幾號|哪段時間|什麼時候去比較好|何時去比較好|會建議哪|你覺得哪|你建議哪|覺得要哪|要哪\s*\d+\s*天)/.test(
      t,
    ) ||
    /(哪個時段|哪個時間).{0,10}(比較好|好|適合)/.test(t) ||
    (/建議|覺得/.test(t) && /\d+\s*天/.test(t) && /(月初|月中|月底|\d{1,2}\s*月)/.test(t)) ||
    /(話你會建議|你會建議哪|要哪\d+天)/.test(t)
  );
}

function userAsksTravelTimeAdviceText(text: string): boolean {
  const t = text.trim();
  if (userRequestsFullItineraryPlanning(t)) return false;
  return (
    /(旅行時間|行程時間|什麼時候去|何時去|適合去嗎|適不適合去|適合嗎|去幾天|玩幾天|待幾天|安排幾天)/.test(
      t,
    ) || (/\d{1,2}\s*月/.test(t) && /(推薦|建議|適合|怎麼樣|如何|安排|規劃)/.test(t))
  );
}

/** 已有目的地＋月份＋天數時，建議具體日期區間 */
export function buildDateRangeRecommendationReply(ctx: TripContextSlice): string | null {
  if (!isTripContextComplete(ctx)) return null;
  const dest = ctx.destination!;
  const days = ctx.days!;
  const month = ctx.travelMonth ?? "這段時間";

  if (/東京/.test(dest) && /12/.test(month)) {
    if (days === 6) {
      return `如果是 12 月初東京 6 天，我會建議 12/2～12/7 或 12/3～12/8。

這段時間已經有冬季氛圍，但通常還沒進入聖誕與跨年前的人潮高峰。天氣會偏冷，適合安排市區景點、聖誕燈飾、溫暖的咖啡廳與美食路線。

如果你想避開週末，我會更推薦 12/2～12/7；如果想多一點活動氛圍，可以選 12/3～12/8。

要不要我直接幫你排一版東京 6 天行程？`;
    }
    return `如果是 12 月初東京 ${days} 天，我會建議 12/2～12/6 或 12/3～12/7。這段時間已有冬季氛圍，通常比聖誕週末人潮少一些。你比較想偏美食、景點還是放鬆散步？要不要我直接幫你排一版 ${days} 天行程？`;
  }

  if (/釜山/.test(dest) && /11/.test(month)) {
    return `11 月初釜山 ${days} 天，可考慮 11/4～11/8 或 11/6～11/10，海邊早晚偏涼、午間適合散步。想偏海景還是市場美食？或跟我說「開始安排行程」，我幫你排完整版。`;
  }

  return `${month}去${dest}安排 ${days} 天很合適。若想避開週末人潮，可選月初平日；若接受稍多人潮，週五出發連假前後也順。你比較在意人少、拍照，還是美食購物？要我直接幫你排一版 ${days} 天行程嗎？`;
}

export function buildCompleteContextFollowUpReply(ctx: TripContextSlice): string {
  const dest = ctx.destination ?? "目的地";
  const days = ctx.days ?? 3;
  const month = ctx.travelMonth ?? ctx.travelDate ?? "這段時間";
  return `我記下來了：${month}去${dest}約 ${days} 天。你比較想偏美食、景點還是放鬆散步？若要我直接排完整行程，跟我說「開始安排行程」就可以。`;
}

export function logAiNextStepDecision(session: ChatPlanningSession, userText: string): void {
  const decision = decideAiNextStep(session, userText);
  const context = extractTripContextSlice(session, userText);
  console.info("[AI_NEXT_STEP_DECISION]", {
    action: decision.action,
    reason: decision.reason,
    destination: context.destination ?? null,
    days: context.days ?? null,
    mustIncludePlaces: context.mustIncludePlaces ?? [],
  });
}
