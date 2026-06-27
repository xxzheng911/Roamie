import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { isBudgetRefinementText } from "@/lib/ai/budget-refinement";
import {
  isDestinationAdviceActive,
  isDestinationAdviceText,
  isDestinationSelectionText,
  isNearbyExploreText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import { detectPlaceRecommendationIntent } from "@/lib/ai/must-visit-places";
import {
  isDateInquiryText,
  isDestinationInquiryText,
  isMoodOnlyText,
  isTravelPlanningText,
  shouldBlockNearbyRecommendation,
} from "@/lib/ai/chat-intent-router";
import { isComboItineraryQuery } from "@/lib/ai/chat-category-place-guard";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import {
  hasChatPlaceCategoryQuery,
  mapCategoryIntentToNearbyIntent,
  parseChatPlaceIntents,
  resolveDestinationForCategorySearch,
} from "@/lib/ai/chat-place-intent";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import { isBestTravelTimeIntent } from "@/lib/ai/best-travel-time-intent";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";

function isTripAddPlaceChat(session: ChatPlanningSession): boolean {
  return Boolean(session.fromTripAddPlace && session.tripAddPlaceContext);
}

function isTripMealRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(三餐|早餐|午餐|晚餐|宵夜|早午餐|吃飯|用餐|找餐廳|找美食|想吃|安排.{0,4}餐|餐廳|美食|吃什麼)/.test(
    t,
  );
}

function userExplicitlyWantsNearbyPlaces(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(附近|這一帶|这一带|現在|今天|當下|我這邊|我附近|離我|離這裡|离这里)/.test(t);
}

/** 聊聊使用者意圖（優先於通用旅遊模板） */
export type ChatIntent =
  | "restaurant"
  | "cafe"
  | "attraction"
  | "camping"
  | "create_itinerary"
  | "best_travel_time"
  | "trip_planning"
  | "destination_advice"
  | "mood_chat"
  | "weather"
  | "outfit"
  | "transit"
  | "refine_recommendations"
  | "general";

export type NearbyPlaceIntent = Extract<ChatIntent, "restaurant" | "cafe" | "attraction" | "camping">;

/**
 * Intent Router — 優先序：
 * 1. 最佳旅行時間（BEST_TRAVEL_TIME_INTENT）
 * 2. 行程規劃 / 日期詢問 / 地點詢問
 * 3. 明確附近探索
 * 4. 餐飲 / 露營等具體類別
 * 5. 心情推薦
 * 6. 一般
 */
export function detectChatIntent(text: string): ChatIntent {
  const t = text.trim();
  if (!t) return "general";

  if (isCreateItineraryIntent(t)) return "create_itinerary";
  if (isBestTravelTimeIntent(t)) return "best_travel_time";

  // PLACE_RECOMMENDATION 優先：目的地 + 類別 → 直接搜尋地點卡片
  const categoryIntents = parseChatPlaceIntents(t);
  if (categoryIntents.length > 0 && hasCategoryPlaceQuery(t)) {
    const dest = resolveDestinationFromText(t);
    const isItineraryCombo =
      isComboItineraryQuery(t) ||
      (/\d+\s*天/.test(t) && /(?:安排|規劃|规划|行程|幫我排|帮我排|怎麼排|怎麼玩)/.test(t));
    if (dest && !isItineraryCombo) {
      return mapCategoryIntentToNearbyIntent(categoryIntents[0]!);
    }
  }

  if (isTripMealRequest(t) && (isNearbyExploreText(t) || !resolveDestinationFromText(t))) {
    return "restaurant";
  }

  // 必去景點 + 已含目的地 → 走 must-visit 推薦（非類別鎖定時）
  if (
    detectPlaceRecommendationIntent(t) &&
    resolveDestinationFromText(t) &&
    !/\d+\s*天/.test(t) &&
    !hasCategoryPlaceQuery(t)
  ) {
    return "destination_advice";
  }

  // ── 1. 旅遊規劃（含日期／目的地詢問）── 優先於附近推薦
  if (isDestinationAdviceText(t)) return "destination_advice";
  if (isDestinationSelectionText(t)) return "destination_advice";
  if (isDateInquiryText(t)) return "destination_advice";
  if (isDestinationInquiryText(t)) return "destination_advice";
  if (isTravelPlanningText(t)) return "trip_planning";

  if (isBudgetRefinementText(t)) return "refine_recommendations";

  if (
    /(還有嗎|還有沒有|再推薦|換其他|換一批|提供其他|其他推薦|不喜歡|不要這些|有別的嗎|別的景點)/.test(
      t,
    )
  ) {
    return "refine_recommendations";
  }

  if (/(露營|營區|營地|campground|campsite|camping|glamping|豪華露營|野營|車宿)/i.test(t)) {
    return "camping";
  }

  if (
    /(幫我規劃|規劃.*行程|安排.*行程|行程規劃|兩天一夜|三天兩夜|四天三夜)/.test(t) ||
    /\d+\s*天\s*\d*\s*夜/.test(t) ||
    /(?:我想?去|要去|想去).*\d+\s*天/.test(t) ||
    /\d+\s*天.*(?:去|玩|逛|排|規劃|规划)/.test(t) ||
    /[\u4e00-\u9fff]{2,8}\s*\d+\s*天.*(怎麼排|行程|規劃|规划|安排)/.test(t) ||
    (/(?:我想?去|要去|想去)/.test(t) && /[\u4e00-\u9fff]{2,8}/.test(t) && /\d+\s*天/.test(t)) ||
    (/(?:下個月|下个月|\d+\s*月)/.test(t) && /(?:去|玩|旅行|旅遊|旅游)/.test(t))
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

  // ── 2. 明確附近探索 ──
  if (isNearbyExploreText(t)) {
    if (/(餐廳|吃飯|用餐|聚餐|午餐|晚餐|宵夜|吃什麼|美食)/.test(t)) return "restaurant";
    if (/(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(t)) return "cafe";
    return "attraction";
  }

  // ── 3. 具體類別（無遠程目的地時）──
  if (
    /(餐廳|吃飯|用餐|聚餐|午餐|晚餐|宵夜|吃什麼|美食推薦|推薦餐廳|燒肉|火鍋|義式|日式|牛排|拉麵|壽司)/.test(
      t,
    ) &&
    !resolveDestinationFromText(t)
  ) {
    return "restaurant";
  }

  if (/(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(t) && /(安靜|推薦|找|有沒有|想去)/.test(t)) {
    return "cafe";
  }
  if (/(咖啡廳|咖啡店)/.test(t) && !resolveDestinationFromText(t)) return "cafe";

  if (
    /(下雨天|雨天).*(去哪|哪裡|推薦|可以)/.test(t) ||
    /下雨天可以去哪/.test(t)
  ) {
    return "attraction";
  }

  if (
    /(景點|去哪玩|好玩的|推薦.*地方|附近.*逛|散步路線|夜景|博物館|展覽)/.test(t) &&
    /(推薦|有沒有|建議|找|想去)/.test(t) &&
    userExplicitlyWantsNearbyPlaces(t)
  ) {
    return "attraction";
  }

  // ── 4. 心情推薦（無目的地／日期／規劃訊號）──
  if (isMoodOnlyText(t)) return "mood_chat";

  if (
    /(放鬆|走走|散步|逛逛)/.test(t) &&
    !/(規劃|行程|天\s*夜)/.test(t) &&
    !resolveDestinationFromText(t) &&
    !/(下個月|下个月|\d+\s*月|幾號|几号)/.test(t)
  ) {
    return "attraction";
  }

  if (
    /(累|疲|心情|感覺|有點|放空|難過|開心|無聊|壓力)/.test(t) &&
    !/(推薦|餐廳|咖啡|景點|去哪)/.test(t) &&
    !isBudgetRefinementText(t) &&
    !resolveDestinationFromText(t)
  ) {
    return "mood_chat";
  }

  return "general";
}

export function isNearbyPlaceIntent(intent: ChatIntent): intent is NearbyPlaceIntent {
  return intent === "restaurant" || intent === "cafe" || intent === "attraction" || intent === "camping";
}

export function placeSearchTypeForIntent(intent: NearbyPlaceIntent): string {
  if (intent === "restaurant") return "restaurant";
  if (intent === "cafe") return "cafe";
  if (intent === "camping") return "campground";
  return "tourist_attraction";
}

export function chatResponseModeForIntent(intent: ChatIntent): string {
  if (intent === "restaurant") return "restaurant_recommendation";
  if (intent === "cafe") return "cafe_recommendation";
  if (intent === "camping") return "activity_recommendation";
  if (intent === "attraction") return "attraction_recommendation";
  if (intent === "create_itinerary") return "trip_planning";
  if (intent === "best_travel_time") return "destination_advice";
  if (intent === "trip_planning") return "trip_planning";
  if (intent === "destination_advice") return "destination_advice";
  if (intent === "refine_recommendations") return "refine_recommendations";
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
  const destination = resolveDestinationForCategorySearch(ctx, session, text);
  const categoryIntents = parseChatPlaceIntents(text);
  if (destination && categoryIntents.length > 0) {
    return mapCategoryIntentToNearbyIntent(categoryIntents[0]!);
  }

  if (shouldBlockNearbyRecommendation(text, session)) return null;
  if (isDestinationAdviceActive(session, ctx) && !destination) return null;
  if (isDestinationAdviceText(text)) return null;
  if (isPlaceDetailChatActive(session)) return null;

  if (isTripAddPlaceChat(session)) {
    if (isTripMealRequest(text)) return "restaurant";
    if (/(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(text)) return "cafe";
    if (/(散步|景點|走走|逛逛|參觀|景觀|下午茶)/.test(text)) return "attraction";
    return null;
  }

  if (session.activeChatIntent && isNearbyPlaceIntent(session.activeChatIntent)) {
    if (shouldBlockNearbyRecommendation(text, session)) return null;
    return session.activeChatIntent;
  }

  const t = text.trim();
  const detected = detectChatIntent(t);
  if (isNearbyPlaceIntent(detected)) {
    if (shouldBlockNearbyRecommendation(text, session)) return null;
    return detected;
  }

  const mood = ctx.mood ?? session.mood ?? "";
  const blob = `${t} ${mood} ${ctx.interests.join(" ")} ${ctx.tripPurpose ?? ""} ${ctx.vibe ?? ""} ${ctx.setting ?? ""}`;

  if (/(咖啡|café|cafe|甜點)/i.test(blob) && userExplicitlyWantsNearbyPlaces(t)) return "cafe";
  if (/(餐廳|吃飯|聚餐|美食|燒肉|火鍋)/.test(blob) && userExplicitlyWantsNearbyPlaces(t)) {
    return "restaurant";
  }
  if (/(露營|營區|營地|camping|campground|glamping)/i.test(blob)) return "camping";
  if (/(下雨|雨天|室內)/.test(blob) && userExplicitlyWantsNearbyPlaces(t)) return "cafe";

  if (
    /(累|疲|放鬆|放空|走走|散步|探索|拍照)/.test(blob) &&
    userExplicitlyWantsNearbyPlaces(t) &&
    !resolveDestinationFromText(t)
  ) {
    return "attraction";
  }

  if (mood || ctx.vibe || ctx.interests.length > 0) {
    if (!userExplicitlyWantsNearbyPlaces(t) && !session.fromMoodFlow) return null;
    if (ctx.activity === "camping" || ctx.interests.includes("露營")) return "camping";
    if (userExplicitlyWantsNearbyPlaces(t)) return "attraction";
  }

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
