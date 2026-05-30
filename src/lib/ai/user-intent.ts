import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripIntent } from "@/lib/recommendation/trip-intent";
import { userWantsPlanningFinalize } from "@/lib/chat-planning-flow";
import { isUserConfirmingItinerary } from "@/lib/chat-session";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";

function isEmotionalOrVagueTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (matchesTravelTimeAdvicePatterns(t) || matchesExplicitPlaceListPatterns(t)) return false;
  return /(累|疲|倦|煩|悶|孤單|孤獨|無聊|壓力|焦慮|難過|開心|興奮|想放空|想走走|不知道|隨便|都可以|沒想法|有點)/.test(
    t,
  );
}

export type AiUserIntentType =
  | "travel_time_advice"
  | "place_recommendation"
  | "itinerary_planning"
  | "mood_nearby"
  | "place_discussion";

export type AiUserIntent = {
  type: AiUserIntentType;
  destination?: string;
  travelMonth?: string;
  companion?: string;
};

export type AiResponseMode = "text_only" | "place_cards" | "itinerary";

function matchesTravelTimeAdvicePatterns(t: string): boolean {
  return (
    /(旅行時間|行程時間|什麼時候去|何時去|適合去嗎|適不適合去|適合嗎|去幾天|玩幾天|待幾天|安排幾天|幾天夠|幾天比較|待多久|要待多久)/.test(
      t,
    ) ||
    /(天氣|氣候|溫度|冷不冷|熱不熱|會冷|會熱|穿什麼).{0,12}(怎麼樣|如何|好不好)/.test(t) ||
    /(推薦|建議).{0,8}(時間|幾天|天數|什麼時候)/.test(t) ||
    /(時間|幾天|天數|什麼時候).{0,8}(推薦|建議)/.test(t) ||
    (/\d{1,2}\s*月/.test(t) &&
      /(去|玩|旅行|旅遊|行程|天氣|氣候)/.test(t) &&
      /(推薦|建議|適合|時間|幾天|天數|嗎|怎麼樣|如何|安排|規劃)/.test(t))
  );
}

function matchesExplicitPlaceListPatterns(t: string): boolean {
  return (
    /(推薦.{0,8}(地點|景點|店|咖啡|餐廳|酒吧|宵夜|夜景|散步)|去哪|哪裡|什麼地方|附近有|這一帶|幫我找|帶我去|想找.{0,6}(咖啡|餐廳|酒吧|地方|景點)|景點|攻略|必去)/.test(
      t,
    ) ||
    (/推薦/.test(t) && !/時間|幾天|天數|什麼時候/.test(t))
  );
}

/** 詢問旅行時間、天數、何時去 — 優先於「推薦」關鍵字 */
export function userAsksTravelTimeAdvice(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (matchesExplicitPlaceListPatterns(t) && !matchesTravelTimeAdvicePatterns(t)) return false;
  if (userWantsItineraryPlanning(t)) return false;
  return matchesTravelTimeAdvicePatterns(t);
}

/** 明確要地點、景點、店名（不含「推薦旅行時間」） */
export function userExplicitlyWantsPlaceList(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (matchesTravelTimeAdvicePatterns(t)) return false;
  if (userWantsItineraryPlanning(t)) return false;

  return matchesExplicitPlaceListPatterns(t);
}

export function userWantsItineraryPlanning(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isUserConfirmingItinerary(t) || userWantsPlanningFinalize(t)) return true;
  return /(排行程|排成行程|幫我排|規劃行程|行程安排|幾日遊|行程表)/.test(t) && /\d+\s*天/.test(t);
}

function extractTravelMonth(text: string, tripIntent?: TripIntent): string | undefined {
  const m = text.match(/(\d{1,2})\s*月/);
  if (m) return `${m[1]}月`;
  const fromIntent = tripIntent?.travelDate?.match(/-\d{2}$/);
  if (fromIntent) return `${parseInt(fromIntent[0].slice(1), 10)}月`;
  return undefined;
}

function companionLabel(text: string, tripIntent?: TripIntent, session?: ChatPlanningSession): string | undefined {
  if (/(女友|女朋友)/.test(text)) return "情侶（女友）";
  if (/(男友|男朋友)/.test(text)) return "情侶（男友）";
  if (/(老婆|妻子|老公|丈夫)/.test(text)) return "伴侶";
  if (/(一個人|獨旅|solo)/i.test(text)) return "獨旅";
  if (/(朋友|閨蜜)/.test(text)) return "朋友";
  if (/(家人|爸媽|父母)/.test(text)) return "家人";
  if (tripIntent?.travelers === 2) return "兩人";
  const c = session?.travelContext?.companion ?? session?.discovery?.companionship;
  return c?.trim() || undefined;
}

export function resolveAiUserIntent(
  session: ChatPlanningSession,
  userText: string,
  tripIntent?: TripIntent,
  options?: { chatPhaseOverride?: string },
): AiUserIntent {
  const t = userText.trim();
  const parsed = parseTravelContextFromText(t, session);
  const destination =
    tripIntent?.destinationCity?.trim() ||
    tripIntent?.destinationArea?.trim() ||
    parsed.destination?.trim() ||
    session.tripDestination?.city?.trim() ||
    session.tripDestination?.displayLabel?.trim();
  const travelMonth = extractTravelMonth(t, tripIntent) ?? parsed.travelMonth;
  const companion = companionLabel(t, tripIntent, session);

  let type: AiUserIntentType;

  if (options?.chatPhaseOverride === "place_discussion") {
    type = "place_discussion";
  } else if (userWantsItineraryPlanning(t) || session.phase === "ready") {
    type = "itinerary_planning";
  } else if (userAsksTravelTimeAdvice(t)) {
    type = "travel_time_advice";
  } else if (userExplicitlyWantsPlaceList(t)) {
    type = "place_recommendation";
  } else if (session.fromMoodFlow || session.fromMoodCard) {
    type =
      userExplicitlyWantsPlaceList(t) || session.selectedPlaces.length > 0
        ? "place_recommendation"
        : "mood_nearby";
  } else {
    type = "mood_nearby";
  }

  const intent: AiUserIntent = { type, destination, travelMonth, companion };
  console.info("[AI_INTENT] type=", intent.type);
  console.info(
    "[AI_CONTEXT] destination=",
    intent.destination ?? "unknown",
    "travelMonth=",
    intent.travelMonth ?? "unknown",
    "companion=",
    intent.companion ?? "unknown",
  );
  return intent;
}

export function shouldRenderPlaceCards(intent: AiUserIntent, log = true): boolean {
  const render = intent.type === "place_recommendation";
  if (log) console.info("[AI_CARDS] shouldRender=", render);
  return render;
}

export function responseModeForIntent(intent: AiUserIntent): AiResponseMode {
  let mode: AiResponseMode;
  if (intent.type === "itinerary_planning") mode = "itinerary";
  else if (shouldRenderPlaceCards(intent)) mode = "place_cards";
  else mode = "text_only";
  console.info("[AI_RESPONSE_MODE]", mode);
  return mode;
}
