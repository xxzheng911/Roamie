import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";

function userExplicitlyWantsPlaces(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(推薦|去哪|哪裡|什麼地方|有沒有|幫我找|咖啡廳|餐廳|景點|酒吧|宵夜|夜景|散步|走走|逛逛|附近|這一帶|想去|帶我去)/.test(
    t,
  );
}

/** 聊聊使用者意圖（優先於通用旅遊模板） */
export type ChatIntent =
  | "restaurant"
  | "cafe"
  | "attraction"
  | "trip_planning"
  | "mood_chat"
  | "weather"
  | "outfit"
  | "transit"
  | "general";

export type NearbyPlaceIntent = Extract<ChatIntent, "restaurant" | "cafe" | "attraction">;

export function detectChatIntent(text: string): ChatIntent {
  const t = text.trim();
  if (!t) return "general";

  if (
    /(幫我規劃|規劃.*行程|安排.*行程|行程規劃|兩天一夜|三天兩夜|四天三夜)/.test(t) ||
    /\d+\s*天\s*\d*\s*夜/.test(t) ||
    /(?:我想?去|要去|想去).*\d+\s*天/.test(t) ||
    /\d+\s*天.*(?:去|玩|逛)/.test(t) ||
    (/(?:我想?去|要去|想去)/.test(t) && /[\u4e00-\u9fff]{2,8}/.test(t) && /\d+\s*天/.test(t)) ||
    (/\d+\s*月/.test(t) && /(?:去|玩|旅行|旅遊)/.test(t))
  ) {
    return "trip_planning";
  }
  if (/(我想?去|要去|想去)([\u4e00-\u9fff]{2,8})(?:走走|逛逛|玩|旅行|旅遊|$)/.test(t)) {
    return "trip_planning";
  }

  if (/(天氣|會下雨|氣溫|溫度|下雨嗎)/.test(t)) return "weather";
  if (/(穿搭|穿什麼|服裝|搭配)/.test(t)) return "outfit";
  if (/(怎麼去|交通|搭車|捷運路線|公車路線)/.test(t) && !/(餐廳|吃飯|聚餐)/.test(t)) {
    return "transit";
  }

  if (
    /(餐廳|吃飯|用餐|聚餐|午餐|晚餐|宵夜|吃什麼|美食推薦|推薦餐廳|燒肉|火鍋|義式|日式|牛排|拉麵|壽司)/.test(
      t,
    )
  ) {
    return "restaurant";
  }

  if (/(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(t) && /(安靜|推薦|找|有沒有|想去)/.test(t)) {
    return "cafe";
  }
  if (/(咖啡廳|咖啡店)/.test(t)) return "cafe";

  if (
    /(下雨天|雨天).*(去哪|哪裡|推薦|可以)/.test(t) ||
    /下雨天可以去哪/.test(t)
  ) {
    return "attraction";
  }

  if (
    /(景點|去哪玩|好玩的|推薦.*地方|附近.*逛|散步路線|夜景|博物館|展覽)/.test(t) &&
    /(推薦|有沒有|建議|找|想去)/.test(t)
  ) {
    return "attraction";
  }

  if (
    /(放鬆|走走|散步|逛逛)/.test(t) &&
    !/(規劃|行程|天\s*夜)/.test(t)
  ) {
    return "attraction";
  }

  if (
    /(累|疲|心情|感覺|有點|放空|難過|開心|無聊|壓力)/.test(t) &&
    !/(推薦|餐廳|咖啡|景點|去哪)/.test(t)
  ) {
    return "mood_chat";
  }

  return "general";
}

export function isNearbyPlaceIntent(intent: ChatIntent): intent is NearbyPlaceIntent {
  return intent === "restaurant" || intent === "cafe" || intent === "attraction";
}

export function placeSearchTypeForIntent(intent: NearbyPlaceIntent): string {
  if (intent === "restaurant") return "restaurant";
  if (intent === "cafe") return "cafe";
  return "tourist_attraction";
}

export function chatResponseModeForIntent(intent: ChatIntent): string {
  if (intent === "restaurant") return "restaurant_recommendation";
  if (intent === "cafe") return "cafe_recommendation";
  if (intent === "attraction") return "attraction_recommendation";
  if (intent === "trip_planning") return "trip_planning";
  if (intent === "weather") return "weather";
  if (intent === "outfit") return "outfit";
  if (intent === "mood_chat") return "mood_chat";
  if (intent === "transit") return "transit";
  return "general_chat";
}

const QUICK_CHIP_PRESETS: Record<
  string,
  { mood: string; activeChatIntent?: NearbyPlaceIntent; fromMoodFlow?: boolean }
> = {
  我今天有點累: { mood: "放鬆", activeChatIntent: "attraction", fromMoodFlow: true },
  "想找安靜的咖啡廳": { mood: "找咖啡", activeChatIntent: "cafe", fromMoodFlow: true },
  "下雨天可以去哪": { mood: "下雨天", activeChatIntent: "attraction", fromMoodFlow: true },
  今天想放鬆走走: { mood: "放鬆", activeChatIntent: "attraction", fromMoodFlow: true },
  想探索新地方: { mood: "探索", activeChatIntent: "attraction", fromMoodFlow: true },
  主要是想拍照: { mood: "拍照", activeChatIntent: "attraction", fromMoodFlow: true },
};

export function applyQuickChipContext(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  const preset = QUICK_CHIP_PRESETS[text.trim()];
  if (!preset) return session;
  return {
    ...session,
    mood: preset.mood,
    activeChatIntent: preset.activeChatIntent ?? session.activeChatIntent,
    fromMoodFlow: preset.fromMoodFlow ?? session.fromMoodFlow,
    selectedMood: preset.mood,
  };
}

/** 依心情／語境推斷附近地點搜尋意圖（快捷按鈕與自由輸入共用） */
export function inferNearbyIntentFromContext(
  ctx: CanonicalTravelContext,
  text: string,
  session: ChatPlanningSession,
): NearbyPlaceIntent | null {
  if (session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent)) {
    return session.activeChatIntent;
  }

  const t = text.trim();
  const detected = detectChatIntent(t);
  if (isNearbyPlaceIntent(detected)) return detected;

  const mood = ctx.mood ?? session.mood ?? "";
  const blob = `${t} ${mood} ${ctx.interests.join(" ")} ${ctx.tripPurpose ?? ""} ${ctx.vibe ?? ""} ${ctx.setting ?? ""}`;

  if (/(咖啡|café|cafe|甜點)/i.test(blob)) return "cafe";
  if (/(餐廳|吃飯|聚餐|美食|燒肉|火鍋)/.test(blob)) return "restaurant";
  if (/(下雨|雨天|室內)/.test(blob)) return "cafe";
  if (/(累|疲|放鬆|放空|走走|散步|探索|拍照)/.test(blob)) return "attraction";
  if (userExplicitlyWantsPlaces(t)) return "attraction";
  if (mood || ctx.vibe || ctx.interests.length > 0) return "attraction";

  return null;
}

export function sessionHasLocation(session: ChatPlanningSession): boolean {
  const lat = session.location?.lat;
  const lng = session.location?.lng;
  return (
    lat != null &&
    lng != null &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
  );
}
