import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";
import { resolveConversationDestination } from "@/lib/ai/ai-chat-conversation-state";
import {
  hasConfirmedTripDays,
  resolveTripStyleFromContext,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { devVerboseInfo } from "@/lib/dev-verbose-log";

export type ChatRenderMode = "itinerary" | "place_list";

const ITINERARY_KEYWORD_RE =
  /(?:行程|安排|推薦|推荐|規劃|规划|排行程|生成行程|安排一下|幾天幾夜|day\s*\d+|第\s*[一二三四五六七八九十\d]+\s*天)/i;

const TRIP_DAYS_RE = /\d+\s*(?:天|日|晚|夜)/;

const TRIP_INTENT_RE =
  /(?:我要去|要去|去(?:玩|旅)|幫我(?:安排|規劃|规划|排)|安排|規劃|规划|推薦|推荐)/;

export function logChatMode(mode: ChatRenderMode, reason: string): void {
  devVerboseInfo("[CHAT_MODE]", `mode=${mode}`, `reason=${reason}`);
}

export function logChatItineraryMode(reason: string): void {
  devVerboseInfo("[CHAT_ITINERARY_MODE]", `reason=${reason}`);
}

export function logChatPlaceListMode(reason: string): void {
  devVerboseInfo("[CHAT_PLACE_LIST_MODE]", `reason=${reason}`);
}

export function logChatPlannerStart(destination: string, days: number, style: TripStyleKey): void {
  devVerboseInfo(
    "[CHAT_PLANNER_START]",
    `destination=${destination}`,
    `days=${days}`,
    `style=${style}`,
  );
}

export function logChatPlannerFinish(
  destination: string,
  days: number,
  itemCount: number,
  plannerDays: number,
): void {
  devVerboseInfo(
    "[CHAT_PLANNER_FINISH]",
    `destination=${destination}`,
    `requestedDays=${days}`,
    `plannerDays=${plannerDays}`,
    `items=${itemCount}`,
  );
}

export function logChatRenderItinerary(days: number, itemCount: number): void {
  devVerboseInfo("[CHAT_RENDER_ITINERARY]", `days=${days}`, `items=${itemCount}`);
}

export function logChatRenderPlaceList(count: number, reason: string): void {
  devVerboseInfo("[CHAT_RENDER_PLACE_LIST]", `count=${count}`, `reason=${reason}`);
}

export function parseItineraryDaysFromText(text: string): number | undefined {
  const range = parseTravelDateRangeFromText(text);
  if (range.days && range.days > 0) return range.days;
  const parsed = parseDayCountFromText(text.trim());
  return parsed && parsed > 0 ? parsed : undefined;
}

export function isItineraryPlanningSignal(
  userText: string,
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  const t = userText.trim();
  if (!t && !context.days) return false;

  if (isCreateItineraryIntent(t)) return true;

  const parsedDays = parseItineraryDaysFromText(t);
  if (parsedDays && (TRIP_INTENT_RE.test(t) || ITINERARY_KEYWORD_RE.test(t))) return true;
  if (parsedDays && resolveConversationDestination(context, session)) return true;

  if (parseTravelDateRangeFromText(t).days) return true;

  if (TRIP_DAYS_RE.test(t) && TRIP_INTENT_RE.test(t)) return true;
  if (ITINERARY_KEYWORD_RE.test(t) && (context.days ?? parsedDays)) return true;

  if (hasConfirmedTripDays(context, session) && resolveConversationDestination(context, session)) {
    return true;
  }

  return false;
}

export function resolveItineraryStyle(
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): TripStyleKey {
  return resolveTripStyleFromContext(context, session) ?? "mixed";
}

export function resolveItineraryDays(
  userText: string,
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): number | undefined {
  const fromText = parseItineraryDaysFromText(userText);
  if (fromText && fromText > 0) return fromText;
  if (context.days != null && context.days > 0) return context.days;
  if (session?.tripDays && session.tripDays > 0) return session.tripDays;
  return undefined;
}

/** 使用者詢問旅遊行程時必須走 Itinerary Planner，而非 Place List。 */
export function shouldUseItineraryMode(
  userText: string,
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  return isItineraryPlanningSignal(userText, context, session);
}

export function enrichContextForItineraryMode(
  userText: string,
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): CanonicalTravelContext {
  const days = resolveItineraryDays(userText, context, session);
  const style = resolveItineraryStyle(context, session);
  return {
    ...context,
    ...(days ? { days, planningDaysConfirmed: true } : {}),
    planningTripStyle: style,
    selectedTripStyle: context.selectedTripStyle ?? style,
    tripPurpose: context.tripPurpose ?? "trip_style_selected",
  };
}

export function resolveChatRenderMode(
  useItineraryMode: boolean,
  dayPlanItemCount: number,
  composedPlanDays: number,
  requestedDays?: number,
): ChatRenderMode {
  if (!useItineraryMode) return "place_list";
  if (dayPlanItemCount > 0) return "itinerary";
  if (requestedDays && composedPlanDays >= requestedDays) return "itinerary";
  return "itinerary";
}

export function plannerDaysMatchRequested(
  composedPlanDays: number,
  requestedDays: number,
): boolean {
  return composedPlanDays === requestedDays;
}
