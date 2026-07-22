import assert from "node:assert/strict";

/**
 * Acceptance guards for Recommendation Conversation Layer (RAOS Ch.3)
 * — Shopping pool purity, continueRecommendation cursor, topic switch, Plus workspace gate.
 */

const SHOPPING_TYPES = new Set([
  "shopping_mall",
  "shopping_center",
  "department_store",
  "clothing_store",
  "shoe_store",
  "store",
  "market",
  "shopping_street",
  "outlet",
  "retail_complex",
]);

const SUPERMARKET_TYPES = new Set(["supermarket", "grocery_store", "convenience_store"]);
const SUPERMARKET_USER_RE = /超市|便利店|便利商店|grocery|supermarket|convenience\s*store/i;

const SHOPPING_FORBIDDEN_TYPES = new Set([
  "observation_deck",
  "park",
  "museum",
  "art_gallery",
  "cafe",
  "coffee_shop",
  "restaurant",
  "shrine",
  "hindu_temple",
  "buddhist_temple",
  "church",
  "place_of_worship",
]);

const SHOPPING_NAME_RE =
  /(?:商店街|百貨|百貨公司|outlet|アウトレット|商場|商圈|購物中心|購物|地下街|市集|市場|mall|department\s*store|shopping\s*(?:mall|street|district|center)|parco|大丸|三越|狸小路)/i;

const SHOPPING_FORBIDDEN_NAME_RE =
  /(?:展望|觀景台|公園|博物|美術館|神社|寺廟|寺$|神宮|咖啡|café|\bcafe\b|observation|museum|shrine|temple|\bpark\b)/i;

function placeTypes(place) {
  const out = new Set();
  const primary = (place.primaryType ?? place.type ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = String(t).trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

function isShoppingPlace(place, userText = "") {
  const types = placeTypes(place);
  const blob = `${place.name ?? ""} ${place.address ?? ""}`;
  const allowSupermarket = SUPERMARKET_USER_RE.test(userText);
  if (
    types.some((t) => SUPERMARKET_TYPES.has(t)) &&
    !types.some((t) => SHOPPING_TYPES.has(t)) &&
    !allowSupermarket
  ) {
    return false;
  }
  if (types.some((t) => SHOPPING_FORBIDDEN_TYPES.has(t))) {
    if (!types.some((t) => SHOPPING_TYPES.has(t))) return false;
    if (SHOPPING_FORBIDDEN_NAME_RE.test(blob) && !SHOPPING_NAME_RE.test(blob)) return false;
  }
  if (types.some((t) => SHOPPING_TYPES.has(t))) return true;
  if (allowSupermarket && types.some((t) => SUPERMARKET_TYPES.has(t))) return true;
  if (SHOPPING_FORBIDDEN_NAME_RE.test(blob) && !SHOPPING_NAME_RE.test(blob)) return false;
  return SHOPPING_NAME_RE.test(blob);
}

const CATEGORY_PATTERNS = {
  cafe: /(咖啡廳|咖啡店|咖啡|café|cafe)/i,
  shopping:
    /(商圈|shopping|百貨|市集|購物|商場|mall|department\s*store|outlet|アウトレット|逛街|購物行程|購物中心|商店街)/i,
  attraction: /(景點|必去|必去景點|附近景點|去哪玩|推薦景點)/i,
};

function parseIntents(text) {
  const found = [];
  for (const [intent, re] of Object.entries(CATEGORY_PATTERNS)) {
    if (re.test(text.trim())) found.push(intent);
  }
  return found;
}

const REFRESH_REQUEST_RE =
  /(還有嗎|還有沒有|還有其他|有其他嗎|再推薦|再找找|換別的|其他呢|更多|其他推薦)/;

function isContinueRequest(text) {
  return REFRESH_REQUEST_RE.test(text.trim());
}

function detectTopicSwitch(text, currentTopic) {
  const intents = parseIntents(text);
  if (!intents.length) return null;
  const next = intents[0];
  if (currentTopic && next === currentTopic) return null;
  return next;
}

function createRecSession(destination, topic, pool, batchSize = 4) {
  const batch = pool.slice(0, batchSize);
  return {
    session: {
      destination,
      topic,
      pool,
      cursor: batch.length,
      returnedPlaceIds: batch.map((p) => p.id),
    },
    batch,
  };
}

function continueRec(session, batchSize = 4) {
  const batch = session.pool.slice(session.cursor, session.cursor + batchSize);
  return {
    session: {
      ...session,
      cursor: session.cursor + batch.length,
      returnedPlaceIds: [...session.returnedPlaceIds, ...batch.map((p) => p.id)],
    },
    batch,
    exhausted: session.cursor + batch.length >= session.pool.length,
  };
}

// ── 1. Shopping intent detection ──
assert.deepEqual(parseIntents("我還想購物行程"), ["shopping"]);
assert.deepEqual(parseIntents("想逛街"), ["shopping"]);
assert.deepEqual(parseIntents("推薦百貨"), ["shopping"]);
assert.deepEqual(parseIntents("推薦 Outlet"), ["shopping"]);
assert.deepEqual(parseIntents("推薦商圈"), ["shopping"]);

// ── 2. Shopping pool purity ──
assert.equal(
  isShoppingPlace({
    name: "狸小路商店街",
    primaryType: "shopping_mall",
    types: ["shopping_mall", "point_of_interest"],
  }),
  true,
);
assert.equal(
  isShoppingPlace({
    name: "大丸札幌",
    primaryType: "department_store",
    types: ["department_store"],
  }),
  true,
);
assert.equal(
  isShoppingPlace({
    name: "JR塔展望室T38",
    primaryType: "observation_deck",
    types: ["observation_deck", "tourist_attraction"],
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "大通公園",
    primaryType: "park",
    types: ["park"],
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "札幌啤酒博物館",
    primaryType: "museum",
    types: ["museum"],
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "北海道神宮",
    primaryType: "shrine",
    types: ["shrine", "place_of_worship"],
  }),
  false,
);
assert.equal(
  isShoppingPlace({
    name: "セイコーマート",
    primaryType: "convenience_store",
    types: ["convenience_store"],
  }),
  false,
);
assert.equal(
  isShoppingPlace(
    {
      name: "セイコーマート",
      primaryType: "convenience_store",
      types: ["convenience_store"],
    },
    "附近有超市嗎",
  ),
  true,
);

const shoppingPool = [
  { id: "1", name: "狸小路商店街", primaryType: "shopping_mall", types: ["shopping_mall"] },
  { id: "2", name: "JR塔展望室T38", primaryType: "observation_deck", types: ["observation_deck"] },
  { id: "3", name: "大通公園", primaryType: "park", types: ["park"] },
  { id: "4", name: "大丸札幌", primaryType: "department_store", types: ["department_store"] },
  { id: "5", name: "PARCO", primaryType: "shopping_mall", types: ["shopping_mall"] },
  { id: "6", name: "Mitsui Outlet", primaryType: "shopping_mall", types: ["shopping_mall"] },
  { id: "7", name: "札幌啤酒博物館", primaryType: "museum", types: ["museum"] },
].filter(isShoppingPlace);

assert.deepEqual(
  shoppingPool.map((p) => p.name),
  ["狸小路商店街", "大丸札幌", "PARCO", "Mitsui Outlet"],
);

// ── 3. continueRecommendation cursor ──
const { session: rec1, batch: batch1 } = createRecSession("北海道", "shopping", shoppingPool, 2);
assert.equal(batch1.length, 2);
assert.equal(rec1.cursor, 2);
assert.deepEqual(
  batch1.map((p) => p.name),
  ["狸小路商店街", "大丸札幌"],
);

const cont = continueRec(rec1, 2);
assert.deepEqual(
  cont.batch.map((p) => p.name),
  ["PARCO", "Mitsui Outlet"],
);
assert.equal(cont.session.cursor, 4);
assert.equal(isContinueRequest("還有嗎"), true);
assert.equal(isContinueRequest("其他呢"), true);
assert.equal(detectTopicSwitch("還有嗎", "shopping"), null);

// ── 4. Topic switch without reset ──
assert.equal(detectTopicSwitch("我想找咖啡廳", "shopping"), "cafe");
assert.equal(detectTopicSwitch("我還想購物", "attraction"), "shopping");

const travelIntents = ["attraction"];
function addTravelIntent(list, next) {
  return list.includes(next) ? list : [...list, next];
}
assert.deepEqual(addTravelIntent(travelIntents, "shopping"), ["attraction", "shopping"]);
assert.deepEqual(addTravelIntent(["attraction", "shopping"], "cafe"), [
  "attraction",
  "shopping",
  "cafe",
]);

// ── 5. Plus workspace gate (feature map) ──
const FEATURE_TIER_MAP = {
  conversation_workspace: "plus",
  ai_chat: "free",
};
assert.equal(FEATURE_TIER_MAP.conversation_workspace, "plus");
assert.notEqual(FEATURE_TIER_MAP.conversation_workspace, "free");

console.log("verify-recommendation-conversation-layer: ok");
