import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyPlaceIdentity,
  recommendationPlaceType,
  buildPlaceIdentityTrace,
  mergePlaceIdentityFields,
} from "../src/lib/place-identity";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "../src/lib/build-place-recommendation-reason";
import { normalizeGooglePlace } from "../src/lib/ai/normalize-google-place";
import { fetchPlaceDetailsForScreenWithKey } from "../src/lib/places.functions";
import { writePlaceRuntimeCache } from "../src/lib/place-runtime-cache";
import { extractPlaceReviewEvidence } from "../src/lib/place-review-evidence";
import { buildUnifiedPlaceCard } from "../src/lib/unified-place-card";
import { normalizeItineraryItem } from "../src/lib/ai/types";
const place = (types, extra = {}) =>
  resolveRecommendationReasonPlace({
    id: "ChIJ_IdentityFixture",
    name: "Example",
    primaryType: null,
    types,
    ...extra,
  });
const label = (p) => recommendationPlaceType(p)[0];
const reason = (p) => buildPlaceRecommendationReason(p, null, null, undefined, undefined, "zh-TW");
let cases = 0;
const test = (n, f) => {
  f();
  cases++;
  console.log("PASS", n);
};
const generic = ["point_of_interest", "establishment", "food"];
for (const [i, types, expected] of [
  [1, ["cafe", ...generic], "咖啡廳"],
  [2, ["bakery", "store", ...generic], "烘焙店"],
  [3, ["dessert_shop", ...generic], "甜點店"],
  [4, ["restaurant", ...generic], "餐廳"],
  [5, ["restaurant", "hot_pot_restaurant", ...generic], "火鍋店"],
  [6, ["barbecue_restaurant", "restaurant"], "燒肉餐廳"],
  [7, ["italian_restaurant", "restaurant"], "義大利料理餐廳"],
  [8, ["observation_deck", "tourist_attraction"], "展望台"],
  [9, ["museum", "tourist_attraction"], "博物館"],
  [10, ["shopping_mall", "store"], "購物中心"],
])
  test(`${i} specificity ${expected}`, () => assert.equal(label(place(types)), expected));
test("11 auxiliary wholesaler cannot veto specific", () =>
  assert.equal(label(place(["wholesaler", "manufacturer", "cafe", "store"])), "咖啡廳"));
test("12 array order independent", () => {
  const t = ["store", "cake_shop", "bakery", "wholesaler"];
  assert.equal(label(place(t)), label(place([...t].reverse())));
});
const cold = place(["point_of_interest"], {
  id: "ChIJ_IdentityUpgrade",
  name: "Example",
  primaryType: "point_of_interest",
});
const reviewEvidence = extractPlaceReviewEvidence(cold.id, [{ text: { text: "有提供插座" } }]);
assert.match(reason(cold), /^這是一個地點/);
const rich = {
  ...cold,
  primaryType: "bakery",
  types: ["bakery", "food", "store"],
  reviewEvidence,
  todayHoursLabel: "07:00–23:00",
};
writePlaceRuntimeCache(cold.id, { reasonPlace: rich });
test("13 enrichment recomputes cold persisted identity", () =>
  assert.match(reason({ ...cold, reason: "這是一個地點。" }), /^這是一間烘焙店/));
test("14 review retained", () => assert.match(reason(cold), /插座/));
test("15 hours retained", () => assert.match(reason(cold), /07:00–23:00/));
test("16 surface parity", () => {
  assert.equal(buildUnifiedPlaceCard({ place: cold, locale: "zh-TW" }).reason, reason(cold));
  assert.equal(
    normalizeItineraryItem(
      { googlePlaceId: cold.id, title: cold.name, placeName: cold.name },
      "zh-TW",
    ).recommendationReason,
    reason(cold),
  );
});
test("17 compatible Bakery Cafe names", () => {
  assert.equal(label(place(["food", "store"], { name: "Example Bakery" })), "烘焙店");
  assert.equal(label(place(["food"], { name: "Example Café" })), "咖啡廳");
});
test("18 incompatible name cannot invent category", () => {
  assert.notEqual(label(place(["park"], { name: "Bakery Café Park" })), "咖啡廳");
  assert.notEqual(label(place(["hospital"], { name: "Cafe Hospital" })), "咖啡廳");
});
test("19 truly unknown", () => assert.equal(label(place([], { name: "Unknown Object" })), "地點"));
const fixtures = JSON.parse(fs.readFileSync("scripts/fixtures/place-identity-live.json", "utf8"));
let calls = 0;
const fetchOriginal = globalThis.fetch;
for (const [index, fixture] of fixtures.entries()) {
  globalThis.fetch = async () => {
    calls++;
    return Response.json(fixture.details);
  };
  const normalized = normalizeGooglePlace(fixture.search, { locale: "zh-TW" });
  const detail = await fetchPlaceDetailsForScreenWithKey(
    fixture.details.id,
    "captured-provider-response",
    "zh-TW",
    undefined,
    { requestPath: "capacitor_client" },
  );
  const expected = ["咖啡廳", "蛋糕店", "蛋糕店"][index];
  test(`${20 + index} real provider ${fixture.query}`, () => {
    assert.equal(label(normalized), expected);
    assert.equal(label(detail), expected);
    assert.doesNotMatch(reason(detail), /這是一個地點/);
  });
  console.log(
    "PLACE_IDENTITY_TRACE",
    JSON.stringify({
      ...buildPlaceIdentityTrace(detail, "controlled_native_adapter_replay"),
      finalIdentityLabel: label(detail),
      searchTypes: fixture.search.types,
      finalReason: reason(detail),
    }),
  );
  const before = calls;
  for (let i = 0; i < 10; i++) reason(detail);
  assert.equal(calls, before);
}
globalThis.fetch = fetchOriginal;
test("23 primary resolves supported multi-type ties", () =>
  assert.equal(label(place(["cafe", "cake_shop", "bakery"], { primaryType: "cafe" })), "咖啡廳"));
test("24 generic enrichment preserves specific types", () => {
  const full = place(["cafe", "bakery"], { primaryType: "cafe" });
  assert.equal(
    label({
      ...full,
      ...mergePlaceIdentityFields(full, {
        primaryType: "point_of_interest",
        types: ["point_of_interest"],
      }),
    }),
    "咖啡廳",
  );
});
test("25 normalized category fallback", () =>
  assert.equal(label({ ...place([]), category: "烘焙店" }), "烘焙店"));
test("26 provider localized display fallback", () =>
  assert.equal(
    label({ ...place(["point_of_interest"]), primaryTypeDisplayName: { text: "蛋糕專賣店" } }),
    "蛋糕店",
  ));
test("27 category cannot override provider", () =>
  assert.equal(label({ ...place(["park"]), category: "cafe" }), "公園"));
test("28 unsupported name-only remains generic", () =>
  assert.equal(label(place(["point_of_interest"], { name: "Example Bakery" })), "地點"));
console.log(
  `PASS ${cases} identity scenarios; ${calls} fixture transport requests, zero classification requests`,
);
