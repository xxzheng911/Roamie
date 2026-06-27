import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { resolveDestinationForCategorySearch } from "@/lib/ai/chat-category-destination";
import { isBestTravelTimeIntent } from "@/lib/ai/best-travel-time-intent";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveDestinationFromText } from "@/lib/ai/trip-planning-context";

/** Intent Router 優先序：行程規劃 > 日期詢問 > 地點詢問 > 心情推薦 > 附近推薦 */
export type IntentRouteCategory =
  | "travel_planning"
  | "date_inquiry"
  | "destination_inquiry"
  | "mood_recommendation"
  | "nearby_recommendation"
  | "general";

const TRAVEL_PLANNING_SIGNALS =
  /(?:去|旅行|旅遊|旅游|安排|規劃|规划|行程|幾天|天数|日期|月份|下個月|下个月|這個月|这个月|下月|本月|旅伴|住宿|交通)/;

const DATE_INQUIRY_SIGNALS =
  /(?:幾號|几号|哪一天|哪一天去|什麼時候|什么时候|何时|何時|哪時候|哪时候|最佳.{0,4}(?:時間|时间|日期|季)|花季|適合.{0,4}去|适合.{0,4}去|你覺得.{0,8}(?:好|適合|适合)|比較好|比较好|哪天|哪日)/;

const DESTINATION_INQUIRY_SIGNALS =
  /(?:值得去嗎|值得去吗|值得去|什麼季節|什么季节|最美|好玩嗎|好玩吗|推薦去|推荐去|適合去|适合去)/;

const MOOD_ONLY_SIGNALS =
  /(?:累|疲|心情|放空|散散心|不知道去哪|有點累|有点累|有點闷|有点闷|無聊|无聊|壓力|压力|想散心)/;

const NEARBY_EXPLICIT =
  /(?:附近|這一帶|这一带|現在|今天|當下|当下|離我|我這邊|我这边|我附近|離這裡|离这里)/;

/** 常見城市／國家／景點 — 用於意圖判斷（完整解析在 trip-planning-context） */
const NAMED_DESTINATION_IN_TEXT =
  /(?:阿里山|日月潭|太魯閣|清境|墾丁|九份|玉山|武陵|合歡山|溪頭|杉林溪|野柳|十分|平溪|貓空|陽明山|象山|龜山島|蘭嶼|綠島|北投|淡水|礁溪|知本|池上|高美濕地|福壽山|富士山|河口湖|箱根|鎌倉|輕井澤|白川鄉|台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|花蓮|台東|臺東|宜蘭|澎湖|京都|大阪|東京|首爾|釜山|曼谷|清邁|芭達雅|普吉島|新加坡|香港|澳門|泰國|日本|韓國|越南|義大利|法國|蒙古)/;

const REMOTE_DESTINATION_GO =
  /(?:我)?(?:想)?去([\u4e00-\u9fffA-Za-z]{2,12})(?:走走|逛逛|玩|旅行|旅遊|，|。|$|\s)/;

const GENERIC_DESTINATION_PREFIX =
  /^([\u4e00-\u9fff]{2,8}?|[A-Za-z]{2,12})(?:的)?(?:(?:什麼|什么)時候|(?:何时|何時)|(?:幾|几)月|適合|适合|最好|比較好|花季|雨季|旺季|淡季)/;

export function hasNamedDestinationInText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (NAMED_DESTINATION_IN_TEXT.test(t)) return true;
  if (REMOTE_DESTINATION_GO.test(t)) return true;
  if (GENERIC_DESTINATION_PREFIX.test(t)) return true;
  if (resolveDestinationFromText(t)) return true;
  return false;
}

export function isDateInquiryText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!DATE_INQUIRY_SIGNALS.test(t)) return false;
  return (
    hasNamedDestinationInText(t) ||
    /(?:下個月|下个月|這個月|这个月|\d{1,2}\s*月)/.test(t)
  );
}

export function isDestinationInquiryText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return DESTINATION_INQUIRY_SIGNALS.test(t) && hasNamedDestinationInText(t);
}

export function isTravelPlanningAdviceText(text: string): boolean {
  const t = text.trim();
  if (!t || NEARBY_EXPLICIT.test(t)) return false;

  if (
    /(?:幾月|几月|哪個月|什么時候|什麼時候|何时|何時|幾號|几号|哪一天|哪天|哪日|下個月|下个月|這個月|这个月|下月|本月|花季|最佳.{0,4}季)/.test(
      t,
    ) &&
    /(?:比較好|比较好|適合|适合|去|旅遊|旅游|好玩|好|你覺得|觉得|走走|逛逛)/.test(t)
  ) {
    return true;
  }

  if (/(?:幾號|几号|哪一天|哪天|你覺得.{0,8}好)/.test(t) && hasNamedDestinationInText(t)) {
    return true;
  }

  return false;
}

export function isTravelPlanningText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (isBestTravelTimeIntent(t)) return false;

  if (isTravelPlanningAdviceText(t)) return true;
  if (isDateInquiryText(t)) return true;
  if (isDestinationInquiryText(t)) return true;

  if (hasNamedDestinationInText(t) && TRAVEL_PLANNING_SIGNALS.test(t)) return true;
  if (/(?:我想?去|要去|想去)/.test(t) && hasNamedDestinationInText(t)) return true;
  if (REMOTE_DESTINATION_GO.test(t) && hasNamedDestinationInText(t)) return true;

  if (
    /(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/.test(t) &&
    hasNamedDestinationInText(t)
  ) {
    return true;
  }

  if (
    /(?:下個月|下个月|這個月|这个月|\d{1,2}\s*月)/.test(t) &&
    (hasNamedDestinationInText(t) || /(?:去|旅行|旅遊|旅游|玩)/.test(t))
  ) {
    return true;
  }

  return false;
}

export function isMoodOnlyText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isTravelPlanningText(t)) return false;
  if (hasNamedDestinationInText(t)) return false;
  if (/(?:\d{1,2}\s*月|下個月|下个月|幾天|几号|幾號)/.test(t)) return false;
  return MOOD_ONLY_SIGNALS.test(t) && !/(?:推薦|推荐|餐廳|咖啡|景點)/.test(t);
}

export function shouldBlockNearbyRecommendation(text: string, session?: ChatPlanningSession): boolean {
  const t = text.trim();
  if (!t) return false;

  if (isBestTravelTimeIntent(t)) return false;

  if (isTravelPlanningText(t)) return true;
  if (isDateInquiryText(t)) return true;
  if (isDestinationInquiryText(t)) return true;
  if (hasNamedDestinationInText(t) && !NEARBY_EXPLICIT.test(t)) return true;
  if (/(?:\d{1,2}\s*月|下個月|下个月|幾天|几号|幾號|日期)/.test(t) && !NEARBY_EXPLICIT.test(t)) {
    return true;
  }

  if (session) {
    const destination = resolveDestinationForCategorySearch(
      session.travelContext ?? { interests: [] },
      session,
      t,
    );
    if (destination && hasCategoryPlaceQuery(t)) {
      return false;
    }
    if (
      session.conversationMode === "destination_planning" ||
      session.tripPlanningContext?.intent === "destination_planning"
    ) {
      return !NEARBY_EXPLICIT.test(t);
    }
  }

  return false;
}

export function routeUserIntent(
  text: string,
  session?: ChatPlanningSession,
): IntentRouteCategory {
  const t = text.trim();
  if (!t) return "general";

  if (isTravelPlanningText(t) || isDateInquiryText(t)) return "travel_planning";
  if (isDestinationInquiryText(t)) return "destination_inquiry";

  if (session?.conversationMode === "destination_planning") return "travel_planning";

  if (isMoodOnlyText(t) && !NEARBY_EXPLICIT.test(t)) return "mood_recommendation";
  if (NEARBY_EXPLICIT.test(t)) return "nearby_recommendation";

  return "general";
}
