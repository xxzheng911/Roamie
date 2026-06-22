import type { ChatPlanningSession } from "@/lib/chat-session";
import {
  detectChatIntent,
  inferNearbyIntentFromContext,
  isNearbyPlaceIntent,
  sessionHasLocation,
  type ChatIntent,
  type NearbyPlaceIntent,
} from "@/lib/ai/chat-intent";

/** 使用者回覆餐廳菜系 / 不限 */
export function isFoodPreferenceReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
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
  const detected = detectChatIntent(text);
  if (isNearbyPlaceIntent(detected)) return detected;

  const active = session.activeChatIntent;
  if (active && isNearbyPlaceIntent(active)) {
    if (isFoodPreferenceReply(text) || isRestaurantFollowUp(text, active)) {
      return active;
    }
  }

  if (active === "restaurant" || active === "cafe") {
    if (isFoodPreferenceReply(text)) return active;
  }

  return detected;
}

function isRestaurantFollowUp(text: string, active: NearbyPlaceIntent): boolean {
  if (active !== "restaurant") return false;
  return isFoodPreferenceReply(text);
}

export function shouldAskRestaurantCuisine(session: ChatPlanningSession): boolean {
  return session.activeChatIntent === "restaurant" && !session.foodPreference;
}

export function shouldFetchNearbyPlaces(
  intent: ChatIntent,
  session: ChatPlanningSession,
  text: string,
): boolean {
  if (intent === "restaurant") {
    return Boolean(session.foodPreference) || isFoodPreferenceReply(text);
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
  const intent = detectChatIntent(text);
  let next: ChatPlanningSession = { ...session };

  if (isNearbyPlaceIntent(intent)) {
    next.activeChatIntent = intent;
  } else if (
    session.activeChatIntent &&
    isNearbyPlaceIntent(session.activeChatIntent) &&
    isFoodPreferenceReply(text)
  ) {
    next.activeChatIntent = session.activeChatIntent;
  }

  const food = parseFoodPreference(text);
  if (food) next.foodPreference = food;

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
    console.info(`[CHAT_INTENT] ${mode}`);
    console.info(
      `[CHAT_PARSE] foodPreference=${next.foodPreference ?? "pending"} companion=${next.discovery?.companionship ?? session.discovery?.companionship ?? "pending"} time=${next.diningTimeHint ?? "pending"}`,
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
