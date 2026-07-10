import type { ChatPlanningSession } from "@/lib/chat-session";
import { isDestinationPlanningSession } from "@/lib/ai/chat-conversation-state";
import { isBudgetRefinementText } from "@/lib/ai/budget-refinement";
import { isDestinationAdviceActive } from "@/lib/ai/trip-planning-context";
import { isFlexiblePreferenceReply } from "@/lib/ai/destination-advice";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isTripAddPlaceSession,
  isTripMealRequestText,
  parseTripAddPlaceFollowUpIntent,
} from "@/lib/trip/trip-add-place-session";
import {
  applyCampingContextFromText,
  isCampingRequestText,
  parseCampingRegionHint,
} from "@/lib/ai/activity-camping";
import {
  applyExclusionToSession,
  isExclusionLiftReply,
  isExclusionReply,
} from "@/lib/ai/recommendation-exclusion";
import {
  detectChatIntent,
  inferNearbyIntentFromContext,
  isNearbyPlaceIntent,
  sessionHasLocation,
  type ChatIntent,
  type NearbyPlaceIntent,
} from "@/lib/ai/chat-intent";
import {
  mapCategoryIntentToNearbyIntent,
  parseChatPlaceIntents,
  resolveDestinationForCategorySearch,
} from "@/lib/ai/chat-place-intent";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";
import { isBestTravelTimeIntent } from "@/lib/ai/best-travel-time-intent";
import {
  isDateInquiryText,
  isTravelPlanningText,
  shouldBlockNearbyRecommendation,
} from "@/lib/ai/chat-intent-router";
import { isFoodIntentText } from "@/lib/ai/chat-food-filter";
import {
  isDestinationAdviceText,
  isDestinationSelectionText,
  coerceTravelDestination,
} from "@/lib/ai/trip-planning-context";

/** 使用者回覆餐廳菜系 / 不限 */
export function isFoodPreferenceReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isExclusionReply(t) || isExclusionLiftReply(t)) return false;
  if (/^(都可以|都行|不限|沒特別|沒有特別|隨意|你推|都行吧|任何|沒有偏好|沒偏好)$/.test(t)) {
    return true;
  }
  return /(日式|日料|燒肉|烤肉|火鍋|義式|義大利|韓式|泰式|素食|海鮮|牛排|拉麵|壽司|中餐|台式|法式|不限)/.test(
    t,
  );
}

export function parseFoodPreference(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (isExclusionReply(t) || isExclusionLiftReply(t)) return undefined;
  if (/^(都可以|都行|不限|沒特別|沒有特別|隨意|你推|都行吧|任何|沒有偏好|沒偏好)$/.test(t)) {
    return "any";
  }
  if (/日式|日料/.test(t)) return "japanese";
  if (/燒肉|烤肉/.test(t)) return "bbq";
  if (/火鍋/.test(t)) return "hotpot";
  if (/義式|義大利/.test(t)) return "italian";
  if (/韓式/.test(t)) return "korean";
  if (/泰式/.test(t)) return "thai";
  if (/素食/.test(t)) return "vegetarian";
  if (/海鮮/.test(t)) return "seafood";
  if (/牛排/.test(t)) return "steak";
  if (/拉麵/.test(t)) return "ramen";
  if (/壽司/.test(t)) return "sushi";
  return undefined;
}

export function parseDiningTimeHint(text: string): string | undefined {
  const t = text.trim();
  if (/明天.*(中午|午飯|午餐)/.test(t)) return "tomorrow_noon";
  if (/明天.*(晚上|晚餐|晚飯)/.test(t)) return "tomorrow_evening";
  if (/今天.*(中午|午飯|午餐)/.test(t)) return "today_noon";
  if (/今天.*(晚上|晚餐|晚飯)/.test(t)) return "today_evening";
  if (/中午|午餐|午飯/.test(t)) return "noon";
  if (/晚餐|晚飯|晚上/.test(t)) return "evening";
  return undefined;
}

export function resolveChatIntent(text: string, session: ChatPlanningSession): ChatIntent {
  const categoryIntents = parseChatPlaceIntents(text);
  const travelCtx = session.travelContext ?? { interests: [] };

  if (categoryIntents.length > 0 && hasCategoryPlaceQuery(text)) {
    const categoryDest = resolveDestinationForCategorySearch(travelCtx, session, text);
    if (coerceTravelDestination(categoryDest)) {
      return mapCategoryIntentToNearbyIntent(categoryIntents[0]!);
    }
    return mapCategoryIntentToNearbyIntent(categoryIntents[0]!);
  }

  if (isCreateItineraryIntent(text)) return "create_itinerary";

  if (session.pendingQuestion || session.adviceSelectionThisTurn) {
    if (isCreateItineraryIntent(text)) return "create_itinerary";
    return "destination_advice";
  }

  if (isDestinationPlanningSession(session, session.travelContext)) {
    if (isCreateItineraryIntent(text)) return "create_itinerary";
    if (isBestTravelTimeIntent(text)) return "best_travel_time";
    return "destination_advice";
  }

  if (isTripAddPlaceSession(session)) {
    const followUp = parseTripAddPlaceFollowUpIntent(text);
    if (followUp) return followUp;
    if (session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent)) {
      return session.activeChatIntent;
    }
    const detected = detectChatIntent(text);
    if (detected === "destination_advice" || detected === "trip_planning") {
      return "general";
    }
    return detected;
  }

  if (isDestinationAdviceActive(session)) {
    return "destination_advice";
  }

  if (isBudgetRefinementText(text)) {
    return "refine_recommendations";
  }

  const detected = detectChatIntent(text);
  if (detected === "create_itinerary") return "create_itinerary";
  if (detected === "best_travel_time") return "best_travel_time";
  if (detected === "destination_advice" || detected === "trip_planning") return detected;

  if (isTravelPlanningText(text) || isDateInquiryText(text)) {
    if (isCreateItineraryIntent(text)) return "create_itinerary";
    if (isBestTravelTimeIntent(text)) return "best_travel_time";
    return isDestinationAdviceText(text) ||
      isDestinationSelectionText(text) ||
      isDateInquiryText(text)
      ? "destination_advice"
      : "trip_planning";
  }

  if (isNearbyPlaceIntent(detected)) return detected;

  const active = session.activeChatIntent;
  if (active && isNearbyPlaceIntent(active)) {
    if (isExclusionReply(text) || isExclusionLiftReply(text)) return active;
    if (
      /(還有嗎|還有沒有|再推薦|換其他|換一批|提供其他|其他推薦|不要這些)/.test(text.trim())
    ) {
      return active;
    }
    if (isFoodPreferenceReply(text) || isRestaurantFollowUp(text, active)) {
      return active;
    }
  }

  if (active === "restaurant" || active === "cafe") {
    if (isFoodPreferenceReply(text)) return active;
  }

  if (active === "camping") {
    if (parseCampingRegionHint(text) || isCampingRequestText(text)) return "camping";
  }

  return detected;
}

function isRestaurantFollowUp(text: string, active: NearbyPlaceIntent): boolean {
  if (active !== "restaurant") return false;
  return isFoodPreferenceReply(text) || isExclusionReply(text) || isExclusionLiftReply(text);
}

export function shouldAskRestaurantCuisine(
  session: ChatPlanningSession,
  userText?: string,
): boolean {
  if (isTripAddPlaceSession(session)) return false;
  if (userText?.trim() && isFoodIntentText(userText) && !isFoodPreferenceReply(userText)) {
    return false;
  }
  if (userText?.trim() && resolveDestinationForCategorySearch(
    session.travelContext ?? { interests: [] },
    session,
    userText,
  )) {
    return false;
  }
  return session.activeChatIntent === "restaurant" && !session.foodPreference;
}

export function shouldFetchNearbyPlaces(
  intent: ChatIntent,
  session: ChatPlanningSession,
  text: string,
): boolean {
  if (isTripAddPlaceSession(session) && intent === "restaurant" && isTripMealRequestText(text)) {
    return sessionHasLocation(session);
  }
  if (intent === "refine_recommendations" || isBudgetRefinementText(text)) {
    return sessionHasLocation(session);
  }
  if (
    /(還有嗎|還有沒有|再推薦|換其他|換一批|提供其他|其他推薦|不要這些)/.test(text.trim()) &&
    session.recommendedPlaces.length > 0
  ) {
    return sessionHasLocation(session);
  }
  if (shouldBlockNearbyRecommendation(text, session)) return false;
  if (intent === "restaurant") {
    if (resolveDestinationForCategorySearch(session.travelContext ?? { interests: [] }, session, text)) {
      return true;
    }
    return (
      isFoodIntentText(text) ||
      Boolean(session.foodPreference) ||
      isFoodPreferenceReply(text) ||
      isExclusionReply(text) ||
      isExclusionLiftReply(text) ||
      (session.excludedCategories?.length ?? 0) > 0
    );
  }
  if (isNearbyPlaceIntent(intent)) return true;

  if (!sessionHasLocation(session)) return false;
  return inferNearbyIntentFromContext(
    session.travelContext ?? { interests: [] },
    text,
    session,
  ) != null;
}

export function restaurantCuisineQuestion(): string {
  return "你比較想吃日式、燒肉、火鍋、義式，還是不限呢？";
}

export function applyDiningContextFromText(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  let next: ChatPlanningSession = applyExclusionToSession(text, session);
  next = applyCampingContextFromText(text, next);
  const intent = detectChatIntent(text);

  if (shouldBlockNearbyRecommendation(text, session)) {
    if (intent === "destination_advice" || intent === "trip_planning") {
      next.activeChatIntent = "destination_advice";
      next.conversationMode = "destination_planning";
    }
  } else if (isNearbyPlaceIntent(intent)) {
    next.activeChatIntent = intent;
  } else if (isFoodIntentText(text)) {
    next.activeChatIntent = "restaurant";
  } else if (
    session.activeChatIntent &&
    isNearbyPlaceIntent(session.activeChatIntent) &&
    (isFoodPreferenceReply(text) || isExclusionReply(text) || isExclusionLiftReply(text))
  ) {
    next.activeChatIntent = session.activeChatIntent;
  }

  if (!isExclusionReply(text) && !isExclusionLiftReply(text)) {
    const food = parseFoodPreference(text);
    if (food) next.foodPreference = food;
  }

  const time = parseDiningTimeHint(text);
  if (time) next.diningTimeHint = time;

  if (/(跟朋友|和朋友|朋友聚餐)/.test(text)) {
    next.discovery = { ...next.discovery, companionship: "朋友" };
  }

  if (next.activeChatIntent) {
    const mode =
      next.activeChatIntent === "restaurant"
        ? "restaurant_recommendation"
        : next.activeChatIntent === "cafe"
          ? "cafe_recommendation"
          : "attraction_recommendation";
    logAiPipeline(`[CHAT_INTENT] ${mode}`);
    logAiPipeline(
      `[CHAT_PARSE] foodPreference=${next.foodPreference ?? "pending"} excluded=${next.excludedCategories?.join("|") ?? "none"} companion=${next.discovery?.companionship ?? session.discovery?.companionship ?? "pending"} time=${next.diningTimeHint ?? "pending"}`,
    );
  }

  return next;
}

export function foodPreferenceSearchQuery(foodPreference?: string): string | undefined {
  switch (foodPreference) {
    case "japanese":
      return "日式餐廳";
    case "bbq":
      return "燒肉餐廳";
    case "hotpot":
      return "火鍋";
    case "italian":
      return "義式餐廳";
    case "korean":
      return "韓式餐廳";
    case "thai":
      return "泰式餐廳";
    case "vegetarian":
      return "素食餐廳";
    case "seafood":
      return "海鮮餐廳";
    case "steak":
      return "牛排館";
    case "ramen":
      return "拉麵";
    case "sushi":
      return "壽司";
    default:
      return undefined;
  }
}
