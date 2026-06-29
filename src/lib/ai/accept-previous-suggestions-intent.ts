import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { isFlexiblePreferenceReply } from "@/lib/ai/destination-pending-question";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";
import {
  normalizeDestinationLabel,
  parseDestinationFromText,
} from "@/lib/ai/trip-planning-context";

const EXPLICIT_ACCEPT_RE =
  /^(都可以|都行|都行吧|都不錯|這些都可以|這些都不錯|就這些|就這樣|沒問題|好呀|好喔|好的|好)$/;

const ACCEPT_WITH_ACTION_RE =
  /^(幫我排|直接排|直接生成|幫我生成|幫我安排|幫我排行程|排吧|生成吧)$/;

const ACCEPT_COMPOUND_RE =
  /(都不錯|都可以|就這些|這些都可以).{0,24}(幫我|直接|排|生成|安排)/;

/**
 * 使用者接受上一輪 assistant 提供的該目的地建議組合 — 不是新目的地 intent。
 */
export function isAcceptPreviousSuggestionsIntent(
  text: string,
  ctx: CanonicalTravelContext = { interests: [] },
  session?: ChatPlanningSession,
): boolean {
  const t = text.trim();
  if (!t) return false;

  if (isCreateItineraryIntent(t)) return false;

  const explicitAccept =
    EXPLICIT_ACCEPT_RE.test(t) ||
    ACCEPT_WITH_ACTION_RE.test(t) ||
    ACCEPT_COMPOUND_RE.test(t) ||
    t === "可以";

  const contextDestination =
    ctx.destination?.trim() ||
    session?.tripPlanningContext?.destination?.trim() ||
    session?.tripDestination?.city?.trim();
  const contextDays = ctx.days ?? session?.tripDays;

  if (!contextDestination || !contextDays) return false;

  const parsedDest = parseDestinationFromText(t);
  if (parsedDest) {
    const normalizedParsed = normalizeDestinationLabel(parsedDest);
    const normalizedCtx = normalizeDestinationLabel(contextDestination);
    if (normalizedParsed !== normalizedCtx && !explicitAccept) return false;
  }

  if (explicitAccept) return true;

  if (
    ctx.tripPurpose === "combination_suggestions_offered" &&
    isFlexiblePreferenceReply(t)
  ) {
    return true;
  }

  if (contextDays && contextDestination && isFlexiblePreferenceReply(t)) {
    return true;
  }

  return false;
}

export function logChatAcceptPreviousSuggestions(
  destination: string,
  days: number,
  text: string,
): void {
  console.info("[CHAT_ACCEPT_PREVIOUS_SUGGESTIONS]", {
    destination,
    days,
    text: text.slice(0, 60),
  });
}

export function logChatPreviousSuggestionsUsed(placeCount: number, source: string): void {
  console.info("[CHAT_PREVIOUS_SUGGESTIONS_USED]", `places=${placeCount}`, `source=${source}`);
}

export function logItineraryCreateFromAcceptedSuggestions(
  destination: string,
  days: number,
): void {
  console.info("[ITINERARY_CREATE_FROM_ACCEPTED_SUGGESTIONS]", {
    destination,
    days,
  });
}
