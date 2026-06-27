import assert from "node:assert/strict";

const CREATE_ITINERARY_SIGNALS =
  /(?:幫我安排|帮我安排|幫我規劃|帮我规划|幫我排|帮我排|排行程|安排.{0,8}行程|規劃.{0,8}行程|规划.{0,8}行程|生成行程|建立行程|创建行程|完整.{0,4}行程|itinerary)/i;

const BEST_TRAVEL_TIME_SIGNALS =
  /(?:什麼時候去比較好|什么时候去比较好|什麼時候比較好|什么时候比较好|何時去比較好|何时去比较好|什麼時候去最好|什麼時候去|什么时候去|何時去|何时去|幾月去比較好|几月去比较好|適合什麼季節|适合什么季节|最佳季節|花季|雨季|旺季|淡季)/;

const ACTIVITY_PREFERENCE_ONLY =
  /(?:想看|想要|想去|想玩|想體驗|看).*(?:極光|极光|滑雪|櫻花|赏樱|賞櫻|楓葉|赏枫|賞楓)/;

function isCreateItineraryIntent(text) {
  const t = text.trim();
  if (!t) return false;
  if (CREATE_ITINERARY_SIGNALS.test(t) && /\d+\s*天/.test(t)) return true;
  if (
    /(?:可以|能不能|要不要).{0,12}(?:幫我|帮我).{0,12}(?:安排|規劃|规划|排)/.test(t) &&
    /\d+\s*天/.test(t)
  ) {
    return true;
  }
  return false;
}

function isBestTravelTimeIntent(text) {
  const t = text.trim();
  if (!t) return false;
  if (ACTIVITY_PREFERENCE_ONLY.test(t) && !/(?:什麼時候|什么时候|何时|何時|幾月|几月|比較好|比较好|適合|适合|最佳)/.test(t)) {
    return false;
  }
  return BEST_TRAVEL_TIME_SIGNALS.test(t);
}

function resolveIntent(text, previousIntent) {
  if (isCreateItineraryIntent(text)) return "create_itinerary";
  if (isBestTravelTimeIntent(text)) return "best_travel_time";
  return previousIntent ?? "general_chat";
}

const followUp = "我想看極光和滑雪，你可以幫我安排10天行程嗎";
assert.equal(isCreateItineraryIntent(followUp), true);
assert.equal(isBestTravelTimeIntent(followUp), false);
assert.equal(resolveIntent(followUp, "best_travel_time"), "create_itinerary");

assert.equal(isBestTravelTimeIntent("冰島什麼時候比較好"), true);
assert.equal(resolveIntent("冰島什麼時候比較好", undefined), "best_travel_time");

console.log("verify-chat-context-intent: ok");
