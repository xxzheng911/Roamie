import assert from "node:assert/strict";
import fs from "node:fs";
import { extractPlaceReviewEvidence } from "../src/lib/place-review-evidence";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "../src/lib/build-place-recommendation-reason";
import { buildRecommendationReasonTrace } from "../src/lib/recommendation-reason-trace";
import {
  fetchPlaceDetailsForScreenWithKey,
  fetchPlaceDetailsForIntro,
} from "../src/lib/places.functions";
import { fetchGooglePlaceDetailsForHandoff } from "../src/lib/place-detail-resolve";
import {
  buildUnifiedPlaceDetailsCacheKey,
  readUnifiedPlaceDetailsCache,
} from "../src/lib/unified-place-cache";
import { buildUnifiedPlaceCard } from "../src/lib/unified-place-card";
import { normalizeItineraryItem } from "../src/lib/ai/types";
import { placeReasonHours } from "../src/lib/normalized-opening-status";
const makeReviews = (texts) =>
  texts.map((text, i) => ({
    name: `review/${i}`,
    authorAttribution: { uri: `author/${i}` },
    rating: 5,
    text: { text, languageCode: "zh-TW" },
  }));
const base = resolveRecommendationReasonPlace({
  id: "ChIJ_ReviewUpgrade",
  name: "測試咖啡",
  primaryType: "cafe",
  lat: 25,
  lng: 121,
});
const reason = (p) =>
  buildPlaceRecommendationReason(
    p,
    null,
    null,
    undefined,
    { surface: "runtime_regression" },
    "zh-TW",
  );
let cases = 0;
const test = (name, fn) => {
  fn();
  cases++;
  console.log("PASS", name);
};
const evidence = extractPlaceReviewEvidence(
  base.id,
  makeReviews(["插座很多", "有提供插座", "座位旁有插座"]),
);
test("1 raw reviews enter normalization", () => assert.equal(evidence.trace.rawReviewsCount, 3));
test("2 Google LocalizedText.text read", () =>
  assert.equal(evidence.trace.reviewsWithTextCount, 3));
test("3 normalization retains distinct reviews", () =>
  assert.equal(evidence.trace.normalizedReviewsCount, 3));
const single = extractPlaceReviewEvidence(base.id, makeReviews(["有提供插座"]));
test("4 single is weak evidence", () => assert.equal(single.signals[0].strength, "single"));
test("5 single is not majority", () => {
  assert.match(reason({ ...base, reviewEvidence: single }), /有評論提到/);
  assert.doesNotMatch(reason({ ...base, reviewEvidence: single }), /多數|多則/);
});
test("6 semantic dish equivalence", () =>
  assert.equal(
    extractPlaceReviewEvidence(
      base.id,
      makeReviews(["焗烤很好吃", "起司焗烤推薦", "最喜歡他們的焗烤"]),
    ).signals.find((s) => s.topic === "gratin").supportCount,
    3,
  ));
test("7 independent support promotes strength", () =>
  assert.equal(evidence.signals[0].strength, "strong"));
test("8 evidence reaches final reason", () =>
  assert.match(reason({ ...base, reviewEvidence: evidence }), /插座/));
const days = Array.from({ length: 7 }, (_, i) => `weekday ${i}: 上午10:00 – 下午6:00`);
test("9 localized current hours survive", () =>
  assert.match(
    reason({ ...base, currentOpeningHours: { weekdayDescriptions: days } }),
    /10:00–18:00/,
  ));
test("10 cold identity", () => assert.equal(reason(base), "這是一間咖啡廳。"));
// Simulate a persisted pre-upgrade payload without clearing unrelated storage.
const stored = new Map();
globalThis.localStorage = {
  get length() {
    return stored.size;
  },
  key: (i) => [...stored.keys()][i] ?? null,
  getItem: (k) => stored.get(k) ?? null,
  setItem: (k, v) => stored.set(k, v),
  removeItem: (k) => stored.delete(k),
};
const oldKey = buildUnifiedPlaceDetailsCacheKey(base.id, "zh-TW", {}, "screen_v1");
localStorage.setItem(
  `roamie:unified-place:v1:${oldKey}`,
  JSON.stringify({
    at: Date.now(),
    data: { place: { ...base, website: null, phone: null }, error: null },
  }),
);
test("11 old cache cannot satisfy new capability", () =>
  assert.equal(
    readUnifiedPlaceDetailsCache(buildUnifiedPlaceDetailsCacheKey(base.id, "zh-TW")),
    null,
  ));
let requests = 0,
  serverCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  requests++;
  assert.ok(init.headers["X-Goog-FieldMask"].includes("reviews"));
  return Response.json({
    id: base.id,
    displayName: { text: base.name },
    location: { latitude: 25, longitude: 121 },
    primaryType: "cafe",
    reviews: makeReviews(["插座很多", "有提供插座", "座位旁有插座"]),
    currentOpeningHours: { weekdayDescriptions: days },
    utcOffsetMinutes: 480,
  });
};
try {
  const server = async () => {
    serverCalls++;
    return {
      place: await fetchPlaceDetailsForScreenWithKey(base.id, "fixture", "zh-TW"),
      error: null,
    };
  };
  const upgrading = Promise.all(
    ["Explore", "Search", "Favorites", "Itinerary"].map(() =>
      fetchGooglePlaceDetailsForHandoff(base.id, "zh-TW", server),
    ),
  );
  const concurrentIntro = fetchPlaceDetailsForIntro(base.id, "zh-TW");
  const upgraded = await upgrading;
  assert.ok(await concurrentIntro);
  test("12 cross-surface one upgrade request", () => {
    assert.equal(requests, 1);
    assert.equal(serverCalls, 1);
  });
  const expected = reason(upgraded[0].place);
  test("13 cold stale reason recomputes from enrichment", () => {
    assert.match(reason({ ...base, reason: "這是一間咖啡廳。" }), /插座/);
    assert.match(expected, /10:00–18:00/);
  });
  await fetchGooglePlaceDetailsForHandoff(base.id, "zh-TW", server);
  await fetchPlaceDetailsForIntro(base.id, "zh-TW");
  test("14 capability reused including empty photo/rating", () => {
    assert.equal(requests, 1);
    assert.equal(serverCalls, 1);
  });
  test("15 cross-surface evidence parity", () => {
    assert.equal(buildUnifiedPlaceCard({ place: base, locale: "zh-TW" }).reason, expected);
    assert.equal(
      normalizeItineraryItem(
        { googlePlaceId: base.id, title: base.name, placeName: base.name },
        "zh-TW",
      ).recommendationReason,
      expected,
    );
  });
  for (let i = 0; i < 20; i++) reason(base);
  test("16 recompute zero provider requests", () => assert.equal(requests, 1));
  test("17 no global cache purge", () => assert.ok(readUnifiedPlaceDetailsCache(oldKey)));
  test("18 originalText fallback", () =>
    assert.equal(
      extractPlaceReviewEvidence("original", [{ originalText: { text: "有提供插座" } }]).signals[0]
        .topic,
      "outlets",
    ));
  test("19 negated equivalent is not positive", () =>
    assert.equal(
      extractPlaceReviewEvidence(
        "neg",
        makeReviews(["沒有提供插座", "不推薦起司焗烤"]),
      ).signals.filter((s) => s.sentiment === "positive").length,
      0,
    ));
  test("20 trace contains counts, not raw texts", () => {
    const t = buildRecommendationReasonTrace(
      upgraded[0].place,
      "detail",
      expected,
      evidence.signals,
      "hours",
    );
    assert.equal(t.rawReviewsCount, 3);
    assert.ok(!JSON.stringify(t).includes("座位旁有插座"));
  });
  test("21 English AM PM hours", () =>
    assert.match(
      placeReasonHours({ todayHoursLabel: "10:00 AM–6:00 PM" }, "zh-TW"),
      /10:00–18:00/,
    ));
  test("22 period-only hours", () =>
    assert.match(
      placeReasonHours(
        {
          currentOpeningHours: {
            periods: [{ open: { day: 3, hour: 11, minute: 30 }, close: { day: 3, hour: 21 } }],
          },
          utcOffsetMinutes: 480,
        },
        "zh-TW",
        new Date("2026-09-23T04:00:00Z"),
      ),
      /11:30–21:00/,
    ));
} finally {
  globalThis.fetch = originalFetch;
}
// A valid zero-review response still fulfils the capability; don't retry for more reviews.
let emptyCalls = 0;
globalThis.fetch = async () => {
  emptyCalls++;
  return Response.json({
    id: "ChIJ_EmptyReviews",
    displayName: { text: "Empty" },
    location: { latitude: 25, longitude: 121 },
    primaryType: "cafe",
  });
};
try {
  const p = await fetchPlaceDetailsForScreenWithKey(
    "ChIJ_EmptyReviews",
    "fixture",
    "zh-TW",
    undefined,
    { requestPath: "capacitor_client" },
  );
  await fetchPlaceDetailsForScreenWithKey("ChIJ_EmptyReviews", "fixture", "zh-TW");
  await fetchPlaceDetailsForIntro("ChIJ_EmptyReviews", "zh-TW");
  test("23 empty review sample is reusable capability", () => {
    assert.equal(p.reviewEvidence.sampleSize, 0);
    assert.equal(emptyCalls, 1);
  });
} finally {
  globalThis.fetch = originalFetch;
}
// Optional captured live provider response; never commit/log raw reviews or credentials.
const responsePath = process.argv.find((a) => a.startsWith("--response="))?.slice(11);
if (responsePath) {
  const raw = JSON.parse(fs.readFileSync(responsePath, "utf8"));
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(raw);
  };
  try {
    const p = await fetchPlaceDetailsForScreenWithKey(raw.id, "captured-live-response", "zh-TW");
    const finalReason = reason(p);
    const trace = buildRecommendationReasonTrace(
      p,
      "controlled_live_response_replay",
      finalReason,
      p.reviewEvidence.signals,
      placeReasonHours(p, "zh-TW"),
    );
    console.log("RECOMMENDATION_REASON_TRACE", JSON.stringify(trace));
    assert.ok(trace.rawReviewsCount > 0);
    assert.ok(trace.acceptedSignals.length > 0);
    assert.ok(trace.openingHoursRendered);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
console.log(`PASS ${cases} runtime review evidence scenarios`);
