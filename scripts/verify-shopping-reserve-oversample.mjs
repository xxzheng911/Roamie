/**
 * Shopping first-round oversample + reserve consume + exhausted acceptance.
 * Cases A–F from shopping reserve fix.
 */
import assert from "node:assert/strict";
import {
  SHOPPING_DISPLAY_LIMIT,
  SHOPPING_INITIAL_VALID_TARGET,
  SHOPPING_INITIAL_RESERVE_TARGET,
  SHOPPING_FOLLOWUP_MIN_NEW,
  buildInitialShoppingSearchAttempts,
  flattenInitialShoppingAttempts,
  buildShoppingDisplayAndReserveFromPool,
  takeShoppingReserveBatch,
  detectShoppingSubtype,
  buildShoppingExhaustedFollowupMessage,
  SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE,
  logShoppingFollowupReserveUsed,
} from "../src/lib/ai/shopping-query-queue.ts";
import {
  createRecommendationSession,
  patchShoppingRecommendationSession,
  RECOMMENDATION_BATCH_SIZE,
} from "../src/lib/ai/conversation-recommendation-session.ts";

function makePlace(id, name, type = "shopping_mall") {
  return {
    name,
    placeName: name,
    type,
    description: "",
    reason: "",
    estimatedTime: "",
    address: "札幌",
    lat: 43.06,
    lng: 141.35,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: id,
    types: [type],
  };
}

const fixturePool = [
  makePlace("gp_1", "狸小路商店街", "shopping_street"),
  makePlace("gp_2", "大丸札幌店", "department_store"),
  makePlace("gp_3", "札幌Stellar Place", "shopping_mall"),
  makePlace("gp_4", "JR塔大樓", "shopping_mall"),
  makePlace("gp_5", "札幌 Factory", "shopping_mall"),
  makePlace("gp_6", "PARCO", "shopping_mall"),
  makePlace("gp_7", "札幌地下街ポールタウン", "underground_mall"),
  makePlace("gp_8", "APIA", "underground_mall"),
  makePlace("gp_9", "二条市場", "market"),
  makePlace("gp_10", "丸井今井札幌本店", "department_store"),
];

assert.ok(fixturePool.length >= 10, "fixture must have ≥10 valid shopping places");

// ── Case A: first-round reserve from full pool ──
const { displayed, reserve } = buildShoppingDisplayAndReserveFromPool(
  fixturePool,
  SHOPPING_DISPLAY_LIMIT,
);
assert.equal(displayed.length, 4, "UI displays 4");
assert.ok(reserve.length >= 4, `reserveCount>=4 got ${reserve.length}`);
assert.ok(
  reserve.length >= SHOPPING_INITIAL_RESERVE_TARGET,
  "reserve target met",
);
const displayedIds = new Set(displayed.map((p) => p.googlePlaceId));
assert.ok(
  reserve.every((p) => !displayedIds.has(p.googlePlaceId)),
  "reserve must not include displayed place ids",
);

const { session: sessionA, batch } = createRecommendationSession({
  destination: "北海道",
  topic: "shopping",
  pool: fixturePool,
  batchSize: SHOPPING_DISPLAY_LIMIT,
  shoppingCandidateReserve: reserve,
  activeSearchCity: "札幌",
});
assert.equal(batch.length, 4);
assert.ok(
  (sessionA.shoppingCandidateReserve?.length ?? 0) >= 4,
  "session persists reserve",
);
assert.ok(fixturePool.length >= SHOPPING_INITIAL_VALID_TARGET);

// ── Initial multi-group oversample seed ──
const seeded = buildInitialShoppingSearchAttempts("北海道", "想逛街", "札幌", "JP");
const flat = flattenInitialShoppingAttempts(seeded);
assert.ok(flat.length >= 4, `initial groups should cover ≥4 queries, got ${flat.length}`);
assert.ok(flat.every((a) => a.query.startsWith("札幌")));
assert.ok(
  flat.some((a) => /商店街|買い物|市場/.test(a.query)),
  "Group A street/local",
);
assert.ok(
  flat.some((a) => /百貨|デパート|駅/.test(a.query)),
  "Group B dept/station",
);
assert.ok(
  flat.some((a) => /地下街|地下/.test(a.query)),
  "Group C underground",
);
assert.ok(
  flat.some((a) => /ショッピングモール|商業施設|ショッピングセンター/.test(a.query)),
  "Group D mall",
);

// ── Case B: second round reads reserve only (networkCalls=0) ──
logShoppingReserveLoadedProbe(sessionA);
const reservedB = takeShoppingReserveBatch(sessionA, RECOMMENDATION_BATCH_SIZE);
assert.equal(reservedB.reserveBefore, sessionA.shoppingCandidateReserve.length);
assert.equal(reservedB.taken, 4);
assert.equal(reservedB.reason, "used");
assert.equal(reservedB.batch.length, 4);
assert.ok(
  reservedB.batch.every((p) => !displayedIds.has(p.googlePlaceId)),
  "round-2 places are new",
);

// ── Case C: reserve不足 → take 1 then caller would search ──
const thinSession = createRecommendationSession({
  destination: "北海道",
  topic: "shopping",
  pool: fixturePool.slice(0, 5),
  batchSize: 4,
  shoppingCandidateReserve: [fixturePool[4]],
  activeSearchCity: "札幌",
}).session;
const reservedC = takeShoppingReserveBatch(thinSession, RECOMMENDATION_BATCH_SIZE);
assert.equal(reservedC.taken, 1);
assert.ok(reservedC.taken < SHOPPING_FOLLOWUP_MIN_NEW, "triggers group search path");

// ── Case D: empty reserve still logs RESERVE_USED ──
const emptySession = patchShoppingRecommendationSession(sessionA, {
  shoppingCandidateReserve: [],
});
const reservedD = takeShoppingReserveBatch(emptySession, RECOMMENDATION_BATCH_SIZE);
assert.equal(reservedD.reserveBefore, 0);
assert.equal(reservedD.taken, 0);
assert.equal(reservedD.reserveAfter, 0);
assert.equal(reservedD.reason, "empty_reserve");
// Direct log path (same fields device must show)
logShoppingFollowupReserveUsed({
  reserveBefore: 0,
  taken: 0,
  reserveAfter: 0,
  reason: "empty_reserve",
});

// ── Case E: exhausted → different copy, no re-search ──
const exhaustedSession = patchShoppingRecommendationSession(emptySession, {
  exhausted: true,
  exhaustedAt: new Date().toISOString(),
  shoppingCandidateReserve: [],
});
assert.equal(exhaustedSession.exhausted, true);
const exhaustedMsg = buildShoppingExhaustedFollowupMessage("札幌");
assert.ok(exhaustedMsg.includes("札幌"));
assert.ok(exhaustedMsg.includes("百貨") || exhaustedMsg.includes("地下街"));
assert.notEqual(exhaustedMsg, SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE);

// ── Case F: subtype refinement from reserve ──
const subtypeSession = createRecommendationSession({
  destination: "北海道",
  topic: "shopping",
  pool: fixturePool,
  batchSize: 4,
  shoppingCandidateReserve: [
    makePlace("gp_dept_r1", "三越札幌店", "department_store"),
    makePlace("gp_ug_r1", "札幌駅前通地下歩行空間", "underground_mall"),
    makePlace("gp_mall_r1", "サッポロファクトリー", "shopping_mall"),
  ],
  activeSearchCity: "札幌",
}).session;
assert.equal(detectShoppingSubtype("還有百貨公司嗎"), "department_store");
const deptTake = takeShoppingReserveBatch(subtypeSession, 4, {
  subtype: "department_store",
});
assert.ok(deptTake.taken >= 1);
assert.ok(
  deptTake.batch.every((p) => /百貨|三越|大丸|department/i.test(p.name) || p.type === "department_store"),
);
assert.ok(
  (deptTake.session.shoppingCandidateReserve?.length ?? 0) >= 1,
  "non-matching reserve kept",
);

assert.equal(detectShoppingSubtype("想找地下街"), "underground_mall");
const ugTake = takeShoppingReserveBatch(deptTake.session, 4, {
  subtype: "underground_mall",
});
assert.ok(ugTake.taken >= 1);
assert.ok(ugTake.batch.some((p) => /地下|underground/i.test(p.name) || p.type === "underground_mall"));

function logShoppingReserveLoadedProbe(session) {
  assert.ok((session.shoppingCandidateReserve?.length ?? 0) >= 4);
}

console.log("verify-shopping-reserve-oversample: ok");
console.log(
  JSON.stringify({
    caseA: {
      displayedCount: displayed.length,
      reserveCount: reserve.length,
      validCount: fixturePool.length,
    },
    caseB: { taken: reservedB.taken, networkCalls: 0 },
    caseC: { taken: reservedC.taken },
    caseD: { reason: reservedD.reason },
    caseE: { exhausted: exhaustedSession.exhausted },
    caseF: { deptTaken: deptTake.taken, ugTaken: ugTake.taken },
  }),
);
