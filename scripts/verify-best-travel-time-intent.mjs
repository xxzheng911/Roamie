import assert from "node:assert/strict";

const BEST_TRAVEL_TIME_SIGNALS =
  /(?:什麼時候去比較好|什么时候去比较好|何時去比較好|何时去比较好|什麼時候去最好|什么时候去最好|何時去最好|何时去最好|什麼時候去|什么时候去|何時去|何时去|幾月去比較好|几月去比较好|適合什麼季節|适合什么季节|最佳季節|花季|雨季|旺季|淡季|避開人潮|極光|鯨魚|雪季)/;

function isBestTravelTimeIntent(text) {
  const t = text.trim();
  if (!t) return false;
  if (BEST_TRAVEL_TIME_SIGNALS.test(t)) return true;
  if (/(?:幾月|几月|什麼時候|什么时候|何时|何時|季節|季节)/.test(t) && /(?:去|旅遊|旅游|旅行|玩)/.test(t)) {
    return /(?:比較好|比较好|最好|適合|适合)/.test(t);
  }
  return false;
}

function parseLeadingDestination(text) {
  const m = text.match(
    /^([\u4e00-\u9fff]{2,8}?|[A-Za-z]{2,12})(?:的)?(?:(?:什麼|什么)時候|(?:何时|何時)|(?:幾|几)月|適合|适合|最好|比較好|比较好)(?:去|$)/,
  );
  return m?.[1]?.trim();
}

assert.equal(isBestTravelTimeIntent("澳洲什麼時候去比較好"), true);
assert.equal(isBestTravelTimeIntent("冰島什麼時候去"), true);
assert.equal(isBestTravelTimeIntent("土耳其幾月去比較好"), true);
assert.equal(isBestTravelTimeIntent("塔斯馬尼亞什麼時候去"), true);
assert.equal(parseLeadingDestination("澳洲什麼時候去比較好"), "澳洲");
assert.equal(parseLeadingDestination("北海道什麼時候去"), "北海道");

assert.equal(isBestTravelTimeIntent("台南3天怎麼排"), false);
assert.equal(isBestTravelTimeIntent("我想去東京"), false);

console.log("verify-best-travel-time-intent: ok");
