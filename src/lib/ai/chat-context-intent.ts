import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { isMoodNearbyRelaxationRequest } from "@/lib/mood-nearby-intent";
import { parseItineraryPlanModeIntent } from "@/lib/ai/itinerary-planning";
import { isBestTravelTimeIntent } from "@/lib/ai/best-travel-time-intent";
import { hasChatPlaceCategoryQuery } from "@/lib/ai/chat-place-intent";
import { isCreateItineraryRequest } from "@/lib/ai/itinerary-entity-extraction";

export type ChatContextIntent =
  | "create_itinerary"
  | "place_recommendation"
  | "best_travel_time"
  | "general_chat";

const CREATE_ITINERARY_SIGNALS =
  /(?:幫我安排|帮我安排|幫我規劃|帮我规划|幫我排|帮我排|幫我生成|帮我生成|幫我建立|帮我建立|直接生成|排行程|安排.{0,8}行程|規劃.{0,8}行程|规划.{0,8}行程|生成.{0,6}天.{0,6}行程|生成行程|建立行程|创建行程|完整.{0,4}行程|itinerary|你可以幫我安排|可以幫我安排)/i;

/** 使用者要求建立 / 安排完整行程 — 優先於 BEST_TRAVEL_TIME */
export function isCreateItineraryIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isMoodNearbyRelaxationRequest(t)) return false;
  if (isCreateItineraryRequest(t)) return true;
  if (parseItineraryPlanModeIntent(t) === "full_itinerary") return true;

  if (CREATE_ITINERARY_SIGNALS.test(t) && /\d+\s*天/.test(t)) return true;
  if (CREATE_ITINERARY_SIGNALS.test(t) && /行程/.test(t)) return true;
  if (/(幫我生成|帮我生成|幫我建立|直接生成)/.test(t) && (/\d+\s*天/.test(t) || /行程/.test(t))) {
    return true;
  }
  if (/(都不錯|都可以|就這些|很好).{0,20}(生成|排成|建立|安排).{0,12}(行程|\d+\s*天)/.test(t)) {
    return true;
  }
  if (/\d+\s*天\s*\d*\s*夜/.test(t) && /(安排|規劃|规划|排|行程)/.test(t)) return true;

  if (
    /(?:可以|能不能|要不要).{0,12}(?:幫我|帮我).{0,12}(?:安排|規劃|规划|排)/.test(t) &&
    /\d+\s*天/.test(t)
  ) {
    return true;
  }

  return false;
}

export function isPlaceRecommendationIntent(text: string): boolean {
  return hasChatPlaceCategoryQuery(text);
}

/**
 * Intent 優先級：
 * CREATE_ITINERARY > PLACE_RECOMMENDATION > BEST_TRAVEL_TIME > GENERAL_CHAT
 */
export function resolveChatContextIntent(
  text: string,
  previousIntent?: string,
): ChatContextIntent {
  void previousIntent;
  const t = text.trim();
  if (!t) return "general_chat";

  if (isCreateItineraryIntent(t)) return "create_itinerary";
  if (isPlaceRecommendationIntent(t)) return "place_recommendation";
  if (isBestTravelTimeIntent(t)) return "best_travel_time";

  return "general_chat";
}

export function chatContextIntentToTripPurpose(intent: ChatContextIntent): string | undefined {
  switch (intent) {
    case "create_itinerary":
      return "create_itinerary";
    case "best_travel_time":
      return "best_time_to_visit";
    case "place_recommendation":
      return "recommend_places";
    default:
      return undefined;
  }
}

export function parseActivityPreferencesFromText(text: string): string[] {
  const t = text.trim();
  const prefs: string[] = [];
  if (/極光|极光|看極光|看极光/.test(t)) prefs.push("極光");
  if (/滑雪/.test(t)) prefs.push("滑雪");
  if (/櫻花|赏樱|賞櫻/.test(t)) prefs.push("櫻花");
  if (/楓葉|赏枫|賞楓|紅葉/.test(t)) prefs.push("楓葉");
  if (/自然風光|自然风景|自然/.test(t)) prefs.push("自然風光");
  if (/城市/.test(t)) prefs.push("城市");
  if (/海島|海岛|海邊|海边/.test(t)) prefs.push("海島");
  return prefs;
}

export function buildCreateItineraryAckReply(params: {
  destination: string;
  days: number;
  preferences?: string[];
}): string {
  const { destination, days, preferences = [] } = params;
  const prefLabel = preferences.length ? preferences.join("＋") : "你的偏好";
  const wantsWinter =
    preferences.some((p) => /極光|滑雪/.test(p)) ||
    /極光|滑雪/.test(prefLabel);
  const seasonHint = wantsWinter ? "建議時間會以冬季 12～2 月為主，" : "";

  return `可以，我幫你用${destination} ${days} 天安排${prefLabel}主題行程。${seasonHint}接下來我會先抓實際地點並安排路線。`;
}

export function logChatContextBefore(context: Record<string, unknown>): void {
  devVerboseInfo("[CHAT_CONTEXT_BEFORE]", JSON.stringify(context));
}

export function logChatContextMerge(patch: Record<string, unknown>): void {
  devVerboseInfo("[CHAT_CONTEXT_MERGE]", JSON.stringify(patch));
}

export function logChatIntentPrevious(intent?: string): void {
  devVerboseInfo("[CHAT_INTENT_PREVIOUS]", intent ?? "—");
}

export function logChatIntentCurrent(intent: string): void {
  devVerboseInfo("[CHAT_INTENT_CURRENT]", intent);
}

export function logChatContextResolved(context: Record<string, unknown>): void {
  devVerboseInfo("[CHAT_CONTEXT_RESOLVED]", JSON.stringify(context));
}

export function logChatCreateItineraryTriggered(destination: string, days: number): void {
  devVerboseInfo(
    "[CHAT_CREATE_ITINERARY_TRIGGERED]",
    `destination=${destination}`,
    `days=${days}`,
  );
}

export function resolveTripPurposeFromText(
  text: string,
  previousPurpose?: string,
): string | undefined {
  const intent = resolveChatContextIntent(text, previousPurpose);
  const mapped = chatContextIntentToTripPurpose(intent);
  if (mapped) return mapped;

  if (previousPurpose && intent === "general_chat") {
    return previousPurpose;
  }

  return undefined;
}
