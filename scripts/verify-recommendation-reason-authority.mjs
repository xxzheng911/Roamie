import { mergeAiWithVerifiedCandidates } from "../src/lib/recommendation/merge-verified.server";
import { createDeliverableItineraryStop } from "../src/lib/ai/itinerary-deliverable-stop";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  extractPlaceReviewEvidence,
  PlaceReviewEvidenceSchema,
} from "../src/lib/place-review-evidence";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "../src/lib/build-place-recommendation-reason";
import { buildUnifiedPlaceCard, buildUnifiedPlaceCards } from "../src/lib/unified-place-card";
import { mapPlaceResultToChatItem } from "../src/lib/chat-session";
import { buildDiversePlaceRecommendationReasons } from "../src/lib/place-reason-diversity";
import {
  resolvePlaceDetailReasonWithSource,
  mergeFetchedPlace,
} from "../src/lib/place-detail-resolve";
import {
  normalizeRecommendationItem,
  normalizeItineraryItem,
  normalizeAiGeneratedResponse,
} from "../src/lib/ai/types";
import { itineraryItemToPlaceHandoff } from "../src/lib/trip/trip-itinerary-place-handoff";
import {
  writeUnifiedPlaceDetailsCache,
  buildUnifiedPlaceDetailsCacheKey,
} from "../src/lib/unified-place-cache";
import {
  fetchPlaceDetailsForScreenWithKey,
  fetchPlaceDetailsForIntro,
} from "../src/lib/places.functions";
import {
  tripPlaceFromPlaceResult,
  tripPlaceToItineraryItem,
} from "../src/lib/trip/trip-place-input";

const base = resolveRecommendationReasonPlace({
  id: "ChIJ_ReasonAuthority",
  name: "測試咖啡",
  primaryType: "cafe",
  types: ["cafe"],
  lat: 25,
  lng: 121,
  address: "Taipei",
  rating: 4.7,
  userRatingCount: 1832,
});
const reviews = (texts) =>
  texts.map((text, i) => ({
    name: `reviews/${i}`,
    authorAttribution: { uri: `author/${i}` },
    text: { text },
  }));
const withReviews = (texts) => ({
  ...base,
  reviewEvidence: extractPlaceReviewEvidence(base.id, reviews(texts)),
});
const reason = (p, presentation = "standard") =>
  buildPlaceRecommendationReason(p, null, null, undefined, { presentation }, "zh-TW");
let cases = 0;
function test(name, fn) {
  fn();
  cases++;
  console.log("PASS", name);
}
const rich = withReviews(["有插座可以工作", "插座很多，適合带筆電工作", "有插座，適合使用筆電"]);
test("1 identity leads", () => assert.match(reason(rich), /^這是一間咖啡廳/));
test("2 multiple positive evidence", () => assert.match(reason(rich), /多則.*插座/));
test("3 single mention wording", () => {
  const r = reason(withReviews(["停車很方便"]));
  assert.match(r, /一則/);
  assert.doesNotMatch(r, /多數|普遍|多則/);
});
test("4 independent reviews and duplicates", () => {
  const ev = extractPlaceReviewEvidence(base.id, [
    { name: "same", text: { text: "停車很方便" } },
    { name: "same", text: { text: "停車位很多" } },
    { name: "other", text: { text: "停車很方便" } },
  ]);
  assert.equal(ev.sampleSize, 1);
  assert.equal(ev.signals[0].supportCount, 1);
});
for (const [n, claim] of [
  [5, "插座"],
  [6, "停車"],
  [7, "服務"],
])
  test(`${n} no inferred ${claim}`, () => assert.ok(!reason(base).includes(claim)));
test("8 unknown hours omitted", () =>
  assert.doesNotMatch(reason({ ...base, todayHoursLabel: "營業時間待確認" }), /今天|今日/));
test("9 closed today", () =>
  assert.match(reason({ ...base, todayHoursLabel: "今日休息" }), /今天公休/));
test("10 split hours", () =>
  assert.match(
    reason({ ...base, todayHoursLabel: "今日 11:30–14:30、17:30–21:00" }),
    /11:30–14:30、17:30–21:00/,
  ));
test("11 review outranks popularity", () =>
  assert.doesNotMatch(reason(rich), /1832|熱門|Google 評分/));
test("12 sparse fallback", () => assert.match(reason(base), /^這是一間咖啡廳.*Google 評分/));
test("13 cross-surface same snapshot", () => {
  const expected = reason(rich);
  assert.equal(
    buildUnifiedPlaceCard({ place: rich, reason: "unverified", locale: "zh-TW" }).reason,
    expected,
  );
  assert.equal(
    mapPlaceResultToChatItem(rich, { locale: "zh-TW", reason: "unverified" }).reason,
    expected,
  );
  assert.equal(
    buildDiversePlaceRecommendationReasons([{ place: rich }, { place: base }], {
      locale: "zh-TW",
    })[0],
    expected,
  );
  assert.equal(
    resolvePlaceDetailReasonWithSource(
      {
        placeId: rich.id,
        name: rich.name,
        lat: null,
        lng: null,
        snapshot: { ...rich, reason: "unverified" },
      },
      undefined,
      "zh-TW",
    ).reason,
    expected,
  );
  const trip = tripPlaceToItineraryItem(tripPlaceFromPlaceResult(rich), { date: "2026-09-23" });
  assert.deepEqual(trip.reviewEvidence, rich.reviewEvidence);
  assert.equal(itineraryItemToPlaceHandoff(trip).reason, expected);
});
test("14 presentation preserves core", () => {
  const p = { ...rich, todayHoursLabel: "今日 10:00–18:00" };
  assert.ok(reason(p).startsWith(reason(p, "compact")));
  assert.equal(reason(p), reason(p, "detail"));
});
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  calls++;
  throw Error("reason must not fetch");
};
test("15 shared existing persistent cache reused", () => {
  writeUnifiedPlaceDetailsCache(
    buildUnifiedPlaceDetailsCacheKey(rich.id, "zh-TW", {}, "screen_v1"),
    { ...rich, website: null, phone: null },
    null,
  );
  assert.equal(reason({ ...base, reviewEvidence: undefined }), reason(rich));
  assert.equal(calls, 0);
});
test("16 rendering/extraction no provider fanout", () => {
  for (let i = 0; i < 20; i++) {
    reason(rich);
    buildUnifiedPlaceCards([{ place: rich }]);
    extractPlaceReviewEvidence(base.id, reviews(["服務很好"]));
  }
  assert.equal(calls, 0);
});
// Distinct IDs isolate the following cases from the shared cache above.
const isolated = (texts) => {
  const p = withReviews(texts);
  p.id = "ChIJ_" + texts.join("|");
  p.reviewEvidence.placeId = p.id;
  return p;
};
test("17 one negative omitted", () =>
  assert.doesNotMatch(reason(isolated(["餐點很好吃", "排隊很久"])), /排隊/));
test("18 repeated limitation", () =>
  assert.match(reason(isolated(["餐點很好吃，排隊很久", "服務很好，等待很久"])), /不過.*排隊/));
test("19 raw types hidden", () =>
  assert.doesNotMatch(
    reason({
      ...base,
      id: "ChIJ_unknown",
      name: "",
      primaryType: "point_of_interest",
      types: ["establishment"],
    }),
    /point_of_interest|establishment/,
  ));
test("20 Traditional Chinese without duplicated template", () => {
  const r = reason(rich);
  assert.equal((r.match(/這是一間/g) || []).length, 1);
  assert.doesNotMatch(r, /。。|多數評論|所有評論|熱門選擇/);
});
test("negation, conditionals and contradiction", () => {
  for (const text of [
    "沒有插座",
    "不適合工作",
    "不推薦焗烤",
    "希望有插座",
    "如果有插座就好了",
    "服務不好",
  ])
    assert.equal(
      extractPlaceReviewEvidence("id", reviews([text])).signals.filter(
        (s) => s.sentiment === "positive",
      ).length,
      0,
      text,
    );
  assert.doesNotMatch(reason(isolated(["停車很方便", "不好停車"])), /停車方便/);
});
test("semantic types", () => {
  for (const [type, label] of [
    ["hot_pot_restaurant", "火鍋店"],
    ["barbecue_restaurant", "燒肉餐廳"],
    ["italian_restaurant", "義大利料理餐廳"],
    ["buddhist_temple", "寺廟"],
    ["observation_deck", "展望台"],
  ])
    assert.ok(reason({ ...base, id: type, primaryType: type, types: [type] }).includes(label));
});
test("closed now does not mean closed today", () =>
  assert.doesNotMatch(
    reason({
      ...base,
      id: "closedNow",
      openNow: false,
      openStatus: "closed_now",
      todayHoursLabel: "",
    }),
    /今天公休/,
  ));
test("AI text is not evidence", () =>
  assert.doesNotMatch(
    normalizeRecommendationItem({
      ...base,
      googlePlaceId: "ChIJ_unverified",
      reason: "有插座、好停車、服務很好",
    }).reason,
    /插座|停車|服務/,
  ));
test("server merge rejects unchecked AI prose and preserves locale", () => {
  const raw = { ...base, id: "ChIJ_ServerMerge", googlePlaceId: "ChIJ_ServerMerge" };
  const ai = normalizeAiGeneratedResponse({
    generatedLocale: "en",
    recommendations: [{ ...raw, reason: "Excellent sockets and free parking" }],
  });
  const candidate = {
    ...ai.recommendations[0],
    reason: "Excellent sockets and free parking",
    sourcePlace: raw,
    categoryId: "coffee",
  };
  const result = mergeAiWithVerifiedCandidates(ai, [candidate], { minCount: 1 });
  assert.match(result.recommendations[0].reason, /^This is a café/);
  assert.doesNotMatch(result.recommendations[0].reason, /sockets|parking/);
});
test("planner delivery preserves structured evidence", () => {
  const stop = createDeliverableItineraryStop(
    { ...rich, googlePlaceId: rich.id },
    "2026-09-23",
    "12:00",
  );
  assert.deepEqual(stop.reviewEvidence, rich.reviewEvidence);
  assert.match(stop.recommendationReason, /插座|power outlets/);
});
test("LLM cannot fabricate provider review evidence", () => {
  const fabricated = {
    ...rich,
    id: "ChIJ_Fabricated",
    googlePlaceId: "ChIJ_Fabricated",
    reviewEvidence: { ...rich.reviewEvidence, placeId: "ChIJ_Fabricated" },
  };
  const response = normalizeAiGeneratedResponse({
    generatedLocale: "zh-TW",
    recommendations: [fabricated],
  });
  assert.equal(response.recommendations[0].reviewEvidence, undefined);
  assert.doesNotMatch(response.recommendations[0].reason, /插座/);
});
test("malformed review strength rejected", () => {
  const evidence = extractPlaceReviewEvidence("ChIJ_Malformed", reviews(["有插座"]));
  evidence.signals[0].strength = "strong";
  assert.equal(PlaceReviewEvidenceSchema.safeParse(evidence).success, false);
  assert.doesNotMatch(reason({ ...base, id: "ChIJ_Malformed", reviewEvidence: evidence }), /插座/);
});
test("canonical prefix shares identity and evidence", () => {
  assert.equal(reason({ ...rich, id: `places/${rich.id}` }), reason(rich));
});
test("four locales preserve evidence and presentation core", () => {
  for (const locale of ["zh-TW", "en", "ja", "ko"]) {
    const compact = buildPlaceRecommendationReason(
      rich,
      null,
      null,
      undefined,
      { presentation: "compact" },
      locale,
    );
    const standard = buildPlaceRecommendationReason(
      rich,
      null,
      null,
      undefined,
      { presentation: "standard" },
      locale,
    );
    assert.ok(standard.startsWith(compact));
    assert.ok(compact.length > 10);
  }
});
globalThis.fetch = originalFetch;
// Real screen adapter: one existing Details call receives reviews; cache + intro reuse perform zero more calls.
globalThis.fetch = async () => {
  calls++;
  return Response.json({
    id: "ChIJ_ReviewTransport",
    displayName: { text: "Coffee" },
    primaryType: "cafe",
    types: ["cafe"],
    location: { latitude: 25, longitude: 121 },
    reviews: reviews(["有插座", "插座很多"]),
  });
};
try {
  const first = await fetchPlaceDetailsForScreenWithKey("ChIJ_ReviewTransport", "fixture", "zh-TW");
  const second = await fetchPlaceDetailsForScreenWithKey(
    "ChIJ_ReviewTransport",
    "fixture",
    "zh-TW",
  );
  assert.equal(calls, 1);
  assert.deepEqual(first.reviewEvidence, second.reviewEvidence);
  const intro = await fetchPlaceDetailsForIntro("ChIJ_ReviewTransport", "zh-TW");
  assert.equal(calls, 1);
  assert.deepEqual(intro.place.reviewEvidence, first.reviewEvidence);
  console.log("PASS review transport: 1 Details, repeated Details/Intro 0 extra provider calls");
} finally {
  globalThis.fetch = originalFetch;
}
const mask = fs
  .readFileSync("src/lib/google-maps-api.ts", "utf8")
  .match(/export const PLACES_FIELD_MASK =\s*"([^"]+)/)[1];
assert.ok(!mask.includes("reviews"), "no browse/search mask expansion");
console.log(`PASS ${cases} reason scenarios + actual Details/cache/intro request reuse`);
