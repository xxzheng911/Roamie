// Recommendation Reason V2 — Evidence-Based Personalization. Offline: synthetic fixtures only.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPlaceRecommendationReason,
  resolvePlaceReasonEnvelope,
  resolveRecommendationReasonPlace,
  userProfileForReasonFrom,
  PLACE_REASON_CONTEXT_VERSION,
} from "../src/lib/build-place-recommendation-reason";
import { extractPlaceReviewEvidence } from "../src/lib/place-review-evidence";
import {
  mergeAiWithVerifiedCandidates,
  validateAiPersonalityClaims,
} from "../src/lib/recommendation/merge-verified.server";
import { mapPlaceResultToChatItem, mapPlaceResultsToChatItems } from "../src/lib/chat-session";
import { buildUnifiedPlaceCard, buildUnifiedPlaceCards } from "../src/lib/unified-place-card";
import {
  handoffToPlaceDetailData,
  mergeFetchedPlace,
  resolvePlaceDetailReasonWithSource,
} from "../src/lib/place-detail-resolve";
import { recommendationToPlaceSnapshot } from "../src/lib/recommendation-place-handoff";
import { pickToPlaceDetailHandoff } from "../src/lib/place-detail-handoff";
import {
  normalizeAiGeneratedResponse,
  normalizeItineraryItem,
  normalizeRecommendationItem,
} from "../src/lib/ai/types";
import { itineraryItemToPlaceHandoff } from "../src/lib/trip/trip-itinerary-place-handoff";
import {
  tripPlaceFromPlaceResult,
  tripPlaceToItineraryItem,
} from "../src/lib/trip/trip-place-input";
import { assignDiversePlaceReasons } from "../src/lib/place-reason-diversity";
import {
  __setReasonProfileSnapshotForTest,
  ensureReasonProfile,
  readReasonProfileSync,
  resetReasonProfileStore,
} from "../src/lib/reason-personalization-store";
import { createEmptySessionPreference } from "../src/lib/personalization/types";

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("reason V2 must not call providers");
};

let cases = 0;
const test = (name, fn) => {
  fn();
  cases++;
  console.log("PASS", name);
};

const place = (id, extra = {}) =>
  resolveRecommendationReasonPlace({
    id,
    name: `Synthetic ${id}`,
    primaryType: "cafe",
    types: ["cafe"],
    lat: 25,
    lng: 121,
    address: "Synthetic Rd",
    ...extra,
  });
const withReviews = (id, texts, extra = {}) => {
  const p = place(id, extra);
  return {
    ...p,
    reviewEvidence: extractPlaceReviewEvidence(
      p.id,
      texts.map((text, i) => ({ name: `r/${id}/${i}`, text: { text } })),
    ),
  };
};
const env = (p, profile = null, ctx = undefined, locale = "zh-TW") =>
  resolvePlaceReasonEnvelope(p, profile, null, "2026-10-14T10:00:00", ctx, locale);
const text = (p, profile = null, ctx = undefined, locale = "zh-TW") =>
  buildPlaceRecommendationReason(p, profile, null, "2026-10-14T10:00:00", ctx, locale);

const plusSlow = userProfileForReasonFrom(
  { onboarded: true, pace: "slow", interests: ["文化藝術"] },
  { hasPlusAccess: true },
);
const freeSlow = userProfileForReasonFrom(
  { onboarded: true, pace: "slow", interests: ["文化藝術"] },
  { hasPlusAccess: false },
);
const evidenced = withReviews("ChIJ_V2_Evidence", ["有插座", "插座很多"]);
const sparseCafe = place("ChIJ_V2_Sparse");
const museum = place("ChIJ_V2_Museum", { primaryType: "museum", types: ["museum"] });
const BANNED =
  /這是一|This is a|ここは.*です。$|이곳은|非常值得|一定不能錯過|獨特魅力|must-see|unmissable|熱門|評分/;

test("R1 verified reason retained", () => {
  const e = env(evidenced);
  assert.equal(e.reasonSource, "verified_evidence");
  assert.equal(e.evidenceLevel, "verified");
  assert.ok(e.evidenceRefs.includes("review:outlets"));
  assert.equal(e.placeId, evidenced.id);
  assert.equal(e.contextVersion, PLACE_REASON_CONTEXT_VERSION);
  assert.match(e.reasonText, /插座/);
});

const aiResponse = (p, reason) =>
  normalizeAiGeneratedResponse({
    generatedLocale: "zh-TW",
    recommendations: [{ ...p, googlePlaceId: p.id, reason }],
  });
const candidate = (p, ai, reason) => ({
  ...ai.recommendations[0],
  googlePlaceId: p.id,
  reason,
  sourcePlace: p,
  categoryId: "coffee",
});

test("R2 unverified AI reason not adopted", () => {
  const claim = "這裡很安靜，非常值得一去，景觀超棒";
  const ai = aiResponse(sparseCafe, claim);
  const merged = mergeAiWithVerifiedCandidates(ai, [candidate(sparseCafe, ai, claim)], {
    minCount: 1,
  });
  assert.equal(merged.recommendations[0].reason, text(sparseCafe));
  assert.doesNotMatch(merged.recommendations[0].reason, /安靜|值得|景觀/);
});

test("R3 renderer derives from the same authority and never reads stored text", () => {
  const src = fs.readFileSync("src/components/PlaceRecommendationReason.tsx", "utf8");
  assert.match(src, /buildPlaceRecommendationReason\(/);
  assert.match(src, /\.\.\.place\.reasonContext/);
  assert.doesNotMatch(src, /place\.reason\b(?!Context)/);
  // A card carrying explicit-request context re-derives the same text the card stored.
  const item = mapPlaceResultToChatItem(museum, {
    locale: "zh-TW",
    categoryIntent: "attraction",
    preferenceEvidenceSource: "USER_MESSAGE",
    currentTime: "2026-10-14T10:00:00",
  });
  assert.equal(text(museum, null, { ...item.reasonContext }), item.reason);
});

test("R4 normalizer does not lower reason authority", () => {
  const n = normalizeRecommendationItem(
    { ...evidenced, googlePlaceId: evidenced.id, reason: "x" },
    "zh-TW",
  );
  assert.equal(n.reason, text(evidenced));
  const trip = tripPlaceToItineraryItem(tripPlaceFromPlaceResult(evidenced), {
    date: "2026-10-14",
  });
  const restored = normalizeItineraryItem(JSON.parse(JSON.stringify(trip)), "zh-TW");
  assert.equal(env(resolveRecommendationReasonPlace(restored)).reasonSource, "verified_evidence");
});

test("R5 no evidence -> safe neutral fallback", () => {
  const e = env(sparseCafe);
  assert.equal(e.reasonSource, "generic_fallback");
  assert.equal(e.evidenceLevel, "neutral");
  assert.deepEqual(e.evidenceRefs, []);
  assert.ok(e.reasonText.length >= 10);
});

test("R6 rating/review count never becomes a quality claim", () => {
  const r = text(place("ChIJ_V2_Rated", { rating: 4.9, userRatingCount: 9999 }));
  assert.doesNotMatch(r, /4\.9|9999|評分|熱門|好評|人氣/);
});

test("R7 types never become experience claims", () => {
  for (const t of ["museum", "park", "tourist_attraction", "restaurant", "bar"]) {
    const r = text(place(`ChIJ_V2_${t}`, { primaryType: t, types: [t] }));
    assert.doesNotMatch(r, /安靜|景觀|美味|好吃|必去|熱門|人少|拍照/, `${t}: ${r}`);
  }
});

test("R8 Plus effective preference applied as fit, not fact", () => {
  const e = env(museum, plusSlow);
  assert.equal(e.reasonSource, "personalization_match");
  assert.equal(e.personalizationSource, "plus_profile");
  assert.match(e.reasonText, /步調|主題/);
  assert.doesNotMatch(e.reasonText, /安靜|人少/);
});

test("R9 Free never uses Plus profile", () => {
  assert.equal(env(museum, freeSlow).personalizationSource, null);
  assert.equal(env(museum, { ...plusSlow, profileTier: "free" }).personalizationSource, null);
  assert.equal(env(museum, { ...plusSlow, onboarded: false }).personalizationSource, null);
});

test("R10 Guest never reads private preferences", () => {
  resetReasonProfileStore();
  __setReasonProfileSnapshotForTest("user-a", plusSlow);
  assert.equal(readReasonProfileSync(true, null), null);
  assert.equal(readReasonProfileSync(false, "user-a"), null);
  assert.equal(env(museum, null).personalizationSource, null);
});

const session = (pace) => ({ ...createEmptySessionPreference(), temporaryPace: pace, revision: 1 });

test("R11 session preference outranks Plus profile", () => {
  const active = env(museum, plusSlow, { sessionPreference: session("active") });
  assert.doesNotMatch(active.reasonText, /步調/);
  const slow = env(museum, plusSlow, { sessionPreference: session("slow") });
  assert.equal(slow.personalizationSource, "session");
});

test("R12 explicit current request outranks session", () => {
  const e = env(museum, plusSlow, {
    sessionPreference: session("active"),
    explicitPreference: { pace: "slow" },
  });
  assert.equal(e.personalizationSource, "explicit");
  const cat = env(sparseCafe, plusSlow, {
    categoryIntent: "cafe",
    preferenceEvidenceSource: "USER_MESSAGE",
  });
  assert.match(cat.reasonText, /^符合你這次想找咖啡廳的需求/);
  // A system-derived category is not the user's explicit request.
  const derived = env(sparseCafe, null, {
    categoryIntent: "cafe",
    preferenceEvidenceSource: "CATEGORY_DERIVED",
  });
  assert.equal(derived.reasonSource, "generic_fallback");
});

test("R13 account switch cannot cross-contaminate", () => {
  resetReasonProfileStore();
  __setReasonProfileSnapshotForTest("user-a", plusSlow);
  assert.equal(readReasonProfileSync(true, "user-b"), null);
  assert.equal(readReasonProfileSync(true, "user-a"), plusSlow);
  resetReasonProfileStore();
  assert.equal(readReasonProfileSync(true, "user-a"), null);
});

const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯]/;
const CJK = /[぀-ヿ一-鿿가-힯]/;
test("R14 locales isolated and unmixed", () => {
  for (const p of [evidenced, sparseCafe, museum]) {
    for (const [locale, profile] of [
      ["zh-TW", plusSlow],
      ["en", plusSlow],
      ["ja", plusSlow],
      ["ko", plusSlow],
    ]) {
      const e = env(p, profile, undefined, locale);
      assert.equal(e.locale, locale);
      const r = e.reasonText;
      if (locale === "en") assert.doesNotMatch(r, CJK, r);
      if (locale === "zh-TW")
        assert.doesNotMatch(r, new RegExp(`${KANA.source}|${HANGUL.source}`), r);
      if (locale === "ja") assert.doesNotMatch(r, HANGUL, r);
      if (locale === "ko") assert.doesNotMatch(r, KANA, r);
    }
  }
});

test("R15 chat reason shown with explicit-request context", () => {
  const item = mapPlaceResultToChatItem(sparseCafe, {
    locale: "zh-TW",
    categoryIntent: "cafe",
    preferenceEvidenceSource: "USER_MESSAGE",
  });
  assert.match(item.reason, /符合你這次想找咖啡廳/);
  assert.deepEqual(item.reasonContext, {
    categoryIntent: "cafe",
    preferenceEvidenceSource: "USER_MESSAGE",
  });
});

test("R16 Home Nearby compact keeps the primary reason", () => {
  const compact = text(evidenced, plusSlow, { presentation: "compact" });
  assert.equal(compact, env(evidenced, plusSlow, { presentation: "compact" }).reasonText);
  assert.match(compact, /插座/);
  assert.doesNotMatch(compact, /今天/);
});

test("R17 Explore card matches authority", () =>
  assert.equal(
    buildUnifiedPlaceCard({ place: evidenced, locale: "zh-TW" }).reason,
    text(evidenced),
  ));

test("R18 Place Detail matches authority", () =>
  assert.equal(
    resolvePlaceDetailReasonWithSource(
      {
        placeId: evidenced.id,
        name: evidenced.name,
        lat: null,
        lng: null,
        snapshot: { ...evidenced, reason: "stale" },
      },
      undefined,
      "zh-TW",
    ).reason,
    text(evidenced, null, undefined),
  ));

test("R19 Selected Combination batch keeps every reason", () => {
  const entries = [evidenced, museum, sparseCafe].map((p) => ({
    place: p,
    ctx: {
      locale: "zh-TW",
      categoryIntent: "attraction",
      preferenceEvidenceSource: "USER_MESSAGE",
    },
  }));
  const batch = mapPlaceResultsToChatItems(entries);
  assert.deepEqual(
    batch.map((i) => i.placeId),
    entries.map((e) => e.place.id),
  );
  batch.forEach((item, i) => {
    assert.ok(item.reason.trim());
    assert.equal(item.reason, mapPlaceResultToChatItem(entries[i].place, entries[i].ctx).reason);
  });
});

test("R20 Trip normalizer keeps canonical reason", () => {
  const trip = tripPlaceToItineraryItem(tripPlaceFromPlaceResult(evidenced), {
    date: "2026-10-14",
  });
  // Same locale round-trips unchanged; a locale switch re-derives from the same evidence.
  const sameLocale = normalizeItineraryItem(JSON.parse(JSON.stringify(trip)), "en");
  assert.equal(sameLocale.recommendationReason, trip.recommendationReason);
  const normalized = normalizeItineraryItem(JSON.parse(JSON.stringify(trip)), "zh-TW");
  assert.equal(normalized.recommendationReason, text(evidenced));
  assert.match(normalized.recommendationReason, /插座/);
});

test("R21 handoff/restore never downgrades", () => {
  const item = mapPlaceResultToChatItem(museum, {
    locale: "zh-TW",
    categoryIntent: "attraction",
    preferenceEvidenceSource: "USER_MESSAGE",
  });
  const restored = JSON.parse(JSON.stringify(item));
  assert.equal(text(museum, null, restored.reasonContext), item.reason);
  const trip = tripPlaceToItineraryItem(tripPlaceFromPlaceResult(evidenced), {
    date: "2026-10-14",
  });
  const handoff = itineraryItemToPlaceHandoff({ ...trip, time: "14:30" }, "zh-TW");
  assert.ok(handoff.reason.startsWith(text(evidenced, null, { presentation: "compact" })));
  assert.match(handoff.reason, /14:30/);
  const sparseTrip = tripPlaceToItineraryItem(tripPlaceFromPlaceResult(sparseCafe), {
    date: "2026-10-14",
  });
  const sparseHandoff = itineraryItemToPlaceHandoff({ ...sparseTrip, time: "14:30" }, "zh-TW");
  assert.equal(
    env(
      resolveRecommendationReasonPlace(sparseHandoff),
      null,
      sparseHandoff.reasonContext ?? { itinerary: { scheduledTime: "14:30" } },
    ).reasonSource,
    "itinerary_context",
  );
});

test("R22 compact/standard/detail never contradict", () => {
  const ctxs = [
    undefined,
    { itinerary: { stayMinutes: 120 } },
    { categoryIntent: "attraction", preferenceEvidenceSource: "USER_MESSAGE" },
  ];
  for (const p of [evidenced, museum, sparseCafe])
    for (const ctx of ctxs)
      for (const locale of ["zh-TW", "en", "ja", "ko"]) {
        const compact = text(p, plusSlow, { ...ctx, presentation: "compact" }, locale);
        const standard = text(p, plusSlow, { ...ctx, presentation: "standard" }, locale);
        assert.ok(standard.startsWith(compact), `${standard} / ${compact}`);
        assert.equal(standard, text(p, plusSlow, { ...ctx, presentation: "detail" }, locale));
      }
});

test("R23 insufficient place data degrades safely", () => {
  const bare = resolveRecommendationReasonPlace({ id: "ChIJ_V2_Bare" });
  assert.equal(env(bare).reasonSource, "generic_fallback");
  const malformed = { ...sparseCafe, reviewEvidence: { placeId: "other", signals: "x" } };
  assert.equal(env(malformed).reasonSource, "generic_fallback");
  assert.equal(
    env({ ...sparseCafe, itinerary: null }, null, { itinerary: { scheduledTime: "25:99" } })
      .reasonSource,
    "generic_fallback",
  );
});

test("R24 AI copy with unsupported claims rejected", () => {
  for (const claim of ["這裡很安靜", "人少不擁擠", "價格親民", "It is quiet and affordable"]) {
    assert.equal(validateAiPersonalityClaims(claim, sparseCafe).valid, false, claim);
    const ai = aiResponse(sparseCafe, claim);
    const merged = mergeAiWithVerifiedCandidates(ai, [candidate(sparseCafe, ai, claim)], {
      minCount: 1,
    });
    assert.doesNotMatch(merged.recommendations[0].reason, /安靜|人少|親民|quiet|affordable/);
  }
});

test("R25/R26 no OpenAI or Google provider calls", () => {
  ensureReasonProfile(true); // no window in node: must no-op
  for (let i = 0; i < 20; i++) {
    text(evidenced, plusSlow);
    buildUnifiedPlaceCards([{ place: museum }]);
  }
  assert.equal(fetchCalls, 0);
});

test("R27 reason path does not touch credits/billing", () => {
  for (const f of [
    "src/lib/build-place-recommendation-reason.ts",
    "src/lib/reason-personalization-store.ts",
    "src/components/PlaceRecommendationReason.tsx",
  ])
    assert.doesNotMatch(
      fs.readFileSync(f, "utf8"),
      /credit|revenuecat|billing|entitlement\.server/i,
      f,
    );
});

test("R28/R29/R30 eligibility, ranking and selected-only unchanged by personalization", () => {
  const ps = [evidenced, museum, sparseCafe];
  const ai = normalizeAiGeneratedResponse({
    generatedLocale: "zh-TW",
    recommendations: [...ps].reverse().map((p) => ({ ...p, googlePlaceId: p.id, reason: "x" })),
  });
  const cands = ps.map((p, i) => ({
    ...ai.recommendations[2 - i],
    googlePlaceId: p.id,
    sourcePlace: p,
    categoryId: "coffee",
  }));
  const free = mergeAiWithVerifiedCandidates(ai, cands, { minCount: 1, profileTier: "free" });
  const plus = mergeAiWithVerifiedCandidates(ai, cands, {
    minCount: 1,
    profileTier: "plus",
    profileOnboarded: true,
  });
  assert.deepEqual(
    plus.recommendations.map((r) => r.googlePlaceId),
    free.recommendations.map((r) => r.googlePlaceId),
  );
  const items = ps.map((p) => ({ place: p }));
  assert.deepEqual(
    assignDiversePlaceReasons(items, { userProfile: plusSlow }).map((r) => r.placeId),
    ps.map((p) => p.id),
  );
  const env1 = env(evidenced, plusSlow);
  assert.equal(env1.placeId, evidenced.id);
  assert.ok(!("lat" in env1) && !("rank" in env1) && !("score" in env1));
});

test("R31 four-locale copy avoids empty templates", () => {
  for (const p of [
    evidenced,
    museum,
    sparseCafe,
    place("ChIJ_V2_Food", { primaryType: "restaurant", types: ["restaurant"] }),
  ])
    for (const locale of ["zh-TW", "en", "ja", "ko"])
      for (const profile of [null, plusSlow]) {
        const r = text(p, profile, undefined, locale);
        assert.doesNotMatch(r, BANNED, r);
        assert.ok(!r.includes(p.name), "reason must not repeat the place name");
        if (locale === "zh-TW") assert.ok(r.length >= 10 && r.length <= 80, r);
      }
});

test("R32 provider/enrichment failure never blocks the card", () => {
  const broken = { ...evidenced, todayHoursLabel: "??", regularOpeningHours: { periods: "bad" } };
  assert.ok(text(broken).length > 0);
  assert.ok(text({ id: "" }).length > 0);
});

test("R33 Chat -> Place Detail -> Hydration -> Renderer keeps reasonContext", () => {
  const item = mapPlaceResultToChatItem(museum, {
    locale: "zh-TW",
    categoryIntent: "attraction",
    preferenceEvidenceSource: "USER_MESSAGE",
  });
  const rec = {
    ...item,
    googlePlaceId: museum.id,
    // Anything outside the allow-list must never cross the handoff.
    reasonContext: { ...item.reasonContext, plusProfile: { pace: "slow" } },
  };
  const snapshot = recommendationToPlaceSnapshot(rec);
  assert.deepEqual(snapshot.reasonContext, item.reasonContext);
  // sessionStorage round-trip, as setPlaceDetailHandoff/readers do.
  const handoff = JSON.parse(JSON.stringify(pickToPlaceDetailHandoff(snapshot)));
  const base = handoffToPlaceDetailData(handoff, "zh-TW");
  assert.deepEqual(base.reasonContext, item.reasonContext);
  const hydrated = mergeFetchedPlace(
    base,
    { ...museum, website: null, phone: null, photoNames: [] },
    "zh-TW",
  );
  assert.deepEqual(hydrated.reasonContext, item.reasonContext);
  const rendered = text(hydrated, null, { ...hydrated.reasonContext, presentation: "detail" });
  assert.match(rendered, /符合你這次想找景點的需求/);
  assert.equal(hydrated.reason, rendered);
  assert.equal(base.reason, rendered);
  // A card without context still hydrates to the same neutral reason (no invented context).
  const plain = handoffToPlaceDetailData(
    JSON.parse(
      JSON.stringify(
        pickToPlaceDetailHandoff(
          recommendationToPlaceSnapshot({ ...rec, reasonContext: undefined }),
        ),
      ),
    ),
    "zh-TW",
  );
  assert.equal(plain.reasonContext, undefined);
  assert.equal(plain.reason, text(museum, null, { presentation: "detail" }));
});

globalThis.fetch = originalFetch;
console.log(`PASS recommendation reason V2: ${cases} scenarios, provider calls ${fetchCalls}`);
