import assert from "node:assert/strict";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "../src/lib/build-place-recommendation-reason";
import { PlaceReviewEvidenceSchema } from "../src/lib/place-review-evidence";

const base = resolveRecommendationReasonPlace({
  id: "wording-fixture",
  name: "測試",
  primaryType: "cafe",
  types: ["cafe"],
  todayHoursLabel: "今日 07:00–23:00",
});
const signal = (topic, supportCount = 1, strength = "single") => ({
  topic,
  supportCount,
  strength,
  sentiment: "positive",
  confidence: strength === "strong" ? "high" : strength === "multiple" ? "medium" : "low",
});
const place = (signals) => ({
  ...base,
  reviewEvidence: PlaceReviewEvidenceSchema.parse({
    version: 1,
    placeId: base.id,
    source: "google_review_sample",
    sampleSize: 5,
    signals,
  }),
});
const reason = (p, surface = "explore", locale = "zh-TW") =>
  buildPlaceRecommendationReason(
    p,
    null,
    null,
    new Date("2026-09-23T04:00:00Z"),
    { surface },
    locale,
  );
let count = 0;
const test = (name, fn) => {
  fn();
  count++;
  console.log("PASS", name);
};
let requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  requests++;
  throw new Error("Formatter must not request API or LLM");
};
try {
  test("single stays single", () => {
    const r = reason(place([signal("service")]));
    assert.match(r, /有評論提到服務親切/);
    assert.doesNotMatch(r, /不少|多則|普遍|大家|廣受/);
  });
  test("multiple stays multiple", () =>
    assert.match(reason(place([signal("service", 2, "multiple")])), /多則評論提到服務親切/));
  test("strong retains scoped agreement", () =>
    assert.match(
      reason(place([signal("service", 3, "strong")])),
      /可取得的多則評論一致提到服務親切/,
    ));
  test("single clauses merge without changing claims", () =>
    assert.match(
      reason(place([signal("quiet"), signal("service")])),
      /有評論提到環境安靜，服務親切。/,
    ));
  test("mixed strengths stay explicit", () =>
    assert.match(
      reason(place([signal("quiet", 3, "strong"), signal("service")])),
      /可取得的多則評論一致提到環境安靜，有評論提到服務親切/,
    ));
  test("multiple clauses merge", () =>
    assert.match(
      reason(place([signal("quiet", 2, "multiple"), signal("service", 2, "multiple")])),
      /多則評論提到環境安靜，服務親切/,
    ));
  test("outlets do not imply work", () => {
    const r = reason(place([signal("outlets")]));
    assert.match(r, /有插座可用/);
    assert.doesNotMatch(r, /工作|久坐|長時間/);
  });
  test("service is not exaggerated", () => {
    const r = reason(place([signal("service")]));
    assert.match(r, /服務親切/);
    assert.doesNotMatch(r, /優秀|非常|極佳/);
  });
  test("value is not exaggerated", () => {
    const r = reason(place([signal("value")]));
    assert.match(r, /價格與內容相稱/);
    assert.doesNotMatch(r, /CP|便宜|餐點|超值/);
  });
  test("no review keeps factual fallback", () =>
    assert.equal(reason(base), "這是一間咖啡廳。今天 07:00–23:00 營業。"));
  test("identity and hours retain order", () =>
    assert.equal(
      reason(place([signal("outlets"), signal("value")])),
      "這是一間咖啡廳，有評論提到有插座可用，價格與內容相稱。今天 07:00–23:00 營業。",
    ));
  test("same evidence deterministic", () => {
    const p = place([signal("quiet"), signal("service")]);
    assert.equal(reason(p), reason(p));
  });
  test("same place across surfaces", () => {
    const p = place([signal("quiet"), signal("service")]);
    for (const surface of ["home", "favorites", "details", "planner", "itinerary", "chat"])
      assert.equal(reason(p, surface), reason(p));
  });
  test("evidence remains unchanged", () => {
    const p = place([signal("quiet"), signal("service")]);
    const before = JSON.stringify(p);
    reason(p);
    assert.equal(JSON.stringify(p), before);
  });
  test("English presentation unchanged", () =>
    assert.match(
      reason(place([signal("quiet"), signal("service")]), "explore", "en"),
      /In the available review sample, one mentions a quiet atmosphere; one mentions friendly service/,
    ));
  test("API and LLM requests remain zero", () => assert.equal(requests, 0));
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`PASS ${count} presentation scenarios`);
