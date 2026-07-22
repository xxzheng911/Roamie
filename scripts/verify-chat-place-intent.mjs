import assert from "node:assert/strict";

const CATEGORY_PATTERNS = {
  cafe: /(咖啡廳|咖啡店|咖啡|café|cafe)/i,
  restaurant: /(餐廳|美食|吃飯|用餐|想找餐廳|推薦餐廳|找餐廳|找美食|有推薦的餐廳)/,
  shopping: /(商圈|shopping|百貨|市集|購物|商場|mall|department\s*store|outlet|アウトレット|逛街|購物行程|購物中心|商店街)/i,
  attraction: /(景點|必去|必去景點|附近景點|去哪玩|推薦景點|好玩的|附近.*逛|美術館|博物館|museum|tourist)/i,
};

const CATEGORY_PLACE_QUERY_RE =
  /(?:咖啡廳|咖啡店|咖啡|café|cafe|餐廳|美食|吃飯|用餐|商圈|shopping|百貨|市集|購物|商場|mall|夜市|酒吧|居酒屋|宵夜|室內景點|雨天|美術館|博物館|museum|必去景點|必去|景點|有推薦的(?:餐廳|咖啡|店|地方|景點)|推薦(?:餐廳|咖啡|景點|商圈|百貨|夜市|酒吧|店|地方)|有什麼(?:商圈|景點|店|地方)|附近有什麼|有推薦的店)/i;

const EMBEDDED_DESTINATIONS = [
  "東京", "大阪", "京都", "台北", "曼谷", "首爾", "墨爾本", "雪梨",
];

function parseIntents(text) {
  const found = [];
  for (const [intent, re] of Object.entries(CATEGORY_PATTERNS)) {
    if (re.test(text.trim())) found.push(intent);
  }
  return found;
}

function hasCategoryPlaceQuery(text) {
  return CATEGORY_PLACE_QUERY_RE.test(text.trim());
}

function resolveDestinationFromText(text) {
  const t = text.trim();
  for (const label of EMBEDDED_DESTINATIONS) {
    if (t.includes(label)) return label;
  }
  return undefined;
}

function shouldFetch(userText, ctx, sess) {
  if (!hasCategoryPlaceQuery(userText)) return false;
  const dest =
    ctx.destination?.trim() ||
    sess.travelContext?.destination?.trim() ||
    sess.tripPlanningContext?.destination?.trim() ||
    resolveDestinationFromText(userText);
  return Boolean(dest);
}

assert.deepEqual(parseIntents("推薦咖啡廳"), ["cafe"]);
assert.deepEqual(parseIntents("有沒有商圈"), ["shopping"]);
assert.deepEqual(parseIntents("我還想購物行程"), ["shopping"]);
assert.deepEqual(parseIntents("推薦 Outlet"), ["shopping"]);
assert.deepEqual(parseIntents("想找餐廳"), ["restaurant"]);
assert.deepEqual(parseIntents("東京有推薦的餐廳嗎"), ["restaurant"]);
assert.deepEqual(parseIntents("附近景點"), ["attraction"]);

assert.equal(hasCategoryPlaceQuery("東京有推薦的餐廳嗎"), true);
assert.equal(hasCategoryPlaceQuery("東京 3 天怎麼排"), false);

const tainanCtx = { destination: "台南", days: 3, interests: ["美食", "咖啡", "shopping"] };
const session = {
  travelContext: tainanCtx,
  conversationMode: "destination_planning",
  tripPlanningContext: { destination: "台南", days: 3 },
};

assert.equal(shouldFetch("推薦咖啡廳", tainanCtx, session), true);
assert.equal(shouldFetch("有沒有商圈", tainanCtx, session), true);
assert.equal(
  shouldFetch("東京有推薦的餐廳嗎", { interests: [] }, { travelContext: { interests: [] } }),
  true,
);
assert.equal(shouldFetch("推薦咖啡廳", { interests: [] }, { travelContext: { interests: [] } }), false);

console.log("verify-chat-place-intent: ok");
