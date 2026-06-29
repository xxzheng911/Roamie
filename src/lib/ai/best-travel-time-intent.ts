/** BEST_TRAVEL_TIME_INTENT — 優先於 TRIP_PLANNING_INTENT */

export const BEST_TRAVEL_TIME_INTENT = "best_travel_time" as const;

const BEST_TRAVEL_TIME_SIGNALS =
  /(?:什麼時候去比較好|什么时候去比较好|什麼時候比較好|什么时候比较好|何時去比較好|何时去比较好|何時比較好|何时比较好|什麼時候去最好|什么时候去最好|何時去最好|何时去最好|什麼去比較好|什么去比较好|什麼去最好|什么去最好|什麼時候去|什么时候去|何時去|何时去|幾月去比較好|几月去比较好|哪個月去|哪个月去|適合什麼季節|适合什么季节|什麼季節去|什么季节去|哪個季節|哪个季节|最佳季節|最佳季节|最佳旅行時間|最佳旅行时间|最佳時間|最佳时间|推薦季節|推荐季节|避開人潮|避开人潮|避開旺季|避开旺季|旺季|淡季|雨季|乾季|干季|花季|節慶|节庆|賞楓|赏枫)/;

const DESTINATION_WHEN_TO_GO_RE =
  /[\u4e00-\u9fffA-Za-z]{2,12}(?:什麼|什么|何时|何時).{0,6}去(?:比較|最)好/;

const MONTH_SEASON_SIGNALS =
  /(?:幾月|几月|哪個月|哪个月|什麼時候|什么时候|何时|何時|什麼去|什么去|適合.{0,4}去|适合.{0,4}去|比較好|比较好|最好|你覺得.{0,6}好|季節|季节|花季|雨季|旺季|淡季)/;

const ACTIVITY_PREFERENCE_ONLY =
  /(?:想看|想要|想去|想玩|想體驗|看).*(?:極光|极光|滑雪|櫻花|赏樱|賞櫻|楓葉|赏枫|賞楓)/;

/** 使用者詢問最佳旅行時間 / 季節 / 節慶 — 優先於行程規劃與偏好詢問（但低於 CREATE_ITINERARY） */
export function isBestTravelTimeIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (ACTIVITY_PREFERENCE_ONLY.test(t) && !/(?:什麼時候|什么时候|何时|何時|幾月|几月|比較好|比较好|適合|适合|最佳|什麼去|什么去)/.test(t)) {
    return false;
  }

  if (BEST_TRAVEL_TIME_SIGNALS.test(t)) return true;

  if (DESTINATION_WHEN_TO_GO_RE.test(t)) return true;

  if (MONTH_SEASON_SIGNALS.test(t) && /(?:去|旅遊|旅游|旅行|玩|走走|逛逛)/.test(t)) {
    if (
      /(?:幾月|几月|什麼時候|什么时候|何时|何時|什麼去|什么去|季節|季节|花季|雨季|乾季|干季|旺季|淡季|推薦季節|推荐季节|最佳)/.test(
        t,
      )
    ) {
      return true;
    }
  }

  return false;
}

export function logChatTimeIntent(text: string): void {
  console.info("[CHAT_TIME_INTENT]", text.slice(0, 80));
}

export function logChatBestTravelTimeTriggered(destination: string): void {
  console.info("[CHAT_BEST_TRAVEL_TIME_TRIGGERED]", destination);
}

export function logChatIntentPriority(intent: string, over?: string): void {
  console.info("[CHAT_INTENT_PRIORITY]", over ? `${intent}>${over}` : intent);
}

export function logChatDestinationContext(destination?: string): void {
  console.info("[CHAT_DESTINATION_CONTEXT]", destination?.trim() || "none");
}

export function logChatTravelDateExists(exists: boolean): void {
  console.info("[CHAT_TRAVEL_DATE_EXISTS]", exists);
}

export function isBestTravelTimePurpose(purpose?: string): boolean {
  return purpose === "best_time_to_visit" || purpose === BEST_TRAVEL_TIME_INTENT;
}
