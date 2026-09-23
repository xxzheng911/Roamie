import assert from "node:assert/strict";
import fs from "node:fs";
import {
  recommendationPlaceType,
  classifyPlaceIdentity,
  buildPlaceIdentityTrace,
} from "../src/lib/place-identity";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "../src/lib/build-place-recommendation-reason";
import { writePlaceRuntimeCache } from "../src/lib/place-runtime-cache";
import { extractPlaceReviewEvidence } from "../src/lib/place-review-evidence";
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  throw new Error("Identity must not fetch");
};
let count = 0;
const test = (name, run) => {
  run();
  count++;
  console.log("PASS", name);
};
const place = (types, extra = {}) => ({
  id: "fixture-multi",
  name: "Example",
  address: null,
  primaryType: null,
  types,
  ...extra,
});
const label = (p) => recommendationPlaceType(p)[0];
const reason = (p) =>
  buildPlaceRecommendationReason(
    resolveRecommendationReasonPlace(p),
    null,
    null,
    undefined,
    undefined,
    "zh-TW",
  );
const matrix = [
  [
    "name cannot displace specific hostel",
    ["hostel", "lodging"],
    { name: "Example Hotel" },
    "青年旅館",
  ],
  [
    "name cannot invent cuisine beside specific bar",
    ["bar", "restaurant"],
    { name: "Pasta Example" },
    "酒吧",
  ],
  [
    "resort primary beats Hotel name",
    ["resort_hotel", "hotel"],
    { primaryType: "resort_hotel", name: "Example Hotel" },
    "度假飯店",
  ],
  ["primary bar", ["bar", "breakfast_restaurant"], { primaryType: "bar" }, "酒吧"],
  ["compatible bar name", ["bar", "breakfast_restaurant"], { name: "Example Sky Bar" }, "酒吧"],
  ["primary cafe", ["cafe", "breakfast_restaurant"], { primaryType: "cafe" }, "咖啡廳"],
  ["primary bakery", ["bakery", "cafe"], { primaryType: "bakery" }, "烘焙店"],
  ["hotpot", ["hot_pot_restaurant", "restaurant"], {}, "火鍋店"],
  ["Italian", ["italian_restaurant", "restaurant"], {}, "義大利料理餐廳"],
  ["barbecue", ["barbecue_restaurant", "restaurant"], {}, "燒肉餐廳"],
  ["breakfast only", ["breakfast_restaurant"], {}, "早餐店"],
  ["bar only", ["bar"], {}, "酒吧"],
  ["restaurant only", ["restaurant"], {}, "餐廳"],
  [
    "meal cannot override primary",
    ["bar", "brunch_restaurant", "breakfast_restaurant"],
    { primaryType: "bar" },
    "酒吧",
  ],
  ["generic cannot override", ["food", "establishment", "bar"], { primaryType: "food" }, "酒吧"],
  ["incompatible Bar name", ["bakery"], { name: "Bar Example" }, "烘焙店"],
  ["hours cannot invent bar", ["restaurant"], { todayHoursLabel: "07:00–01:00" }, "餐廳"],
  ["hours cannot invent breakfast", [], { todayHoursLabel: "07:00–10:30" }, "地點"],
  ["hotel", ["hotel", "establishment", "point_of_interest"], {}, "飯店"],
  ["resort refines hotel", ["resort_hotel", "hotel"], { primaryType: "hotel" }, "度假飯店"],
  ["hostel", ["hostel", "lodging"], {}, "青年旅館"],
  [
    "hotel over generic primary",
    ["hotel", "establishment"],
    { primaryType: "establishment" },
    "飯店",
  ],
  ["compatible Hotel name", ["lodging"], { name: "Example Hotel" }, "飯店"],
  ["incompatible Hotel name", ["park"], { name: "Hotel Park" }, "公園"],
  ["lodging fallback", ["lodging"], {}, "旅館"],
  ["motel", ["motel", "lodging"], {}, "汽車旅館"],
  ["B&B", ["bed_and_breakfast", "lodging"], {}, "民宿"],
  ["guest house", ["guest_house", "lodging"], {}, "旅館"],
  ["extended stay", ["extended_stay_hotel", "hotel"], {}, "長住型飯店"],
  [
    "display authority",
    ["bar", "breakfast_restaurant"],
    { primaryTypeDisplayName: { text: "酒吧" } },
    "酒吧",
  ],
  ["provider category authority", ["bar", "cafe"], { sourceCategory: "bar" }, "酒吧"],
  ["trusted category authority", ["bar", "cafe"], { semanticCategory: "cafe" }, "咖啡廳"],
  ["primary beats name", ["bar", "cafe"], { primaryType: "cafe", name: "Sky Bar" }, "咖啡廳"],
  [
    "breakfast independently primary",
    ["bar", "breakfast_restaurant"],
    { primaryType: "breakfast_restaurant" },
    "早餐店",
  ],
  [
    "primary restaurant may refine cuisine",
    ["restaurant", "italian_restaurant"],
    { primaryType: "restaurant" },
    "義大利料理餐廳",
  ],
  [
    "primary restaurant survives meal attribute",
    ["restaurant", "breakfast_restaurant"],
    { primaryType: "restaurant" },
    "餐廳",
  ],
];
for (const [name, types, extra, expected] of matrix)
  test(name, () => {
    assert.equal(label(place(types, extra)), expected);
    assert.equal(label(place([...types].reverse(), extra)), expected, "type order must not matter");
  });
const stellar = place(["bar", "restaurant", "breakfast_restaurant"], {
  name: "Stellar Garden",
  subtitle: "Sky Bar & Dining Stellar Garden",
  todayHoursLabel: "07:00–10:30、12:00–16:30、17:00–01:00",
});
test("Stellar synthetic scenario, not captured runtime", () => {
  assert.equal(label(stellar), "酒吧");
  assert.match(reason(stellar), /^這是一間酒吧/);
  assert.match(reason(stellar), /07:00–10:30、12:00–16:30、17:00–01:00/);
  assert.doesNotMatch(reason(stellar), /早餐店|夜景|浪漫|約會/);
});
const karaksa = place(["hotel", "lodging", "point_of_interest", "establishment"], {
  id: "fixture-karaksa",
  name: "karaksa hotel premier 東京銀座",
});
test("karaksa synthetic scenario, not captured runtime", () =>
  assert.match(reason(karaksa), /^這是一間飯店/));
const cold = place(["point_of_interest"], { id: "fixture-hotel-upgrade", name: "Example" });
const evidence = extractPlaceReviewEvidence(cold.id, [
  { text: { text: "環境安靜，服務親切，有插座" } },
]);
const initial = { ...cold, reviewEvidence: evidence, todayHoursLabel: "07:00–23:00" };
const before = reason(initial);
writePlaceRuntimeCache(cold.id, {
  reasonPlace: resolveRecommendationReasonPlace({
    ...initial,
    primaryType: "hotel",
    types: ["hotel", "lodging"],
  }),
});
test("detail enrichment recomputes generic hotel", () => {
  assert.match(before, /^這是一個地點/);
  assert.match(reason(initial), /^這是一間飯店/);
});
test("hotel upgrade retains review evidence", () => {
  assert.match(reason(initial), /安靜|親切|插座/);
  assert.equal(reason(initial).replace("一間飯店", "一個地點"), before);
});
test("hotel upgrade retains hours", () => assert.match(reason(initial), /07:00–23:00/));
const fixtures = JSON.parse(fs.readFileSync("scripts/fixtures/place-identity-live.json", "utf8"));
for (const [i, fixture] of fixtures.entries())
  test(`captured prior case ${fixture.query}`, () =>
    assert.equal(
      label({ ...fixture.details, name: fixture.details.displayName.text }),
      ["咖啡廳", "蛋糕店", "蛋糕店"][i],
    ));
test("trace explains role and evidence", () => {
  const d = classifyPlaceIdentity(stellar);
  assert.equal(
    d.candidates.find((c) => c.semanticType === "breakfast_restaurant").role,
    "meal_service_attribute",
  );
  assert.equal(d.candidates.find((c) => c.semanticType === "bar").confidence, "supporting");
  assert.equal(d.selectionSource, "compatible_name_hint");
});
for (const p of [stellar, karaksa])
  console.log(
    "PLACE_IDENTITY_TRACE",
    JSON.stringify({
      provenance: "synthetic_user_report_scenario_NOT_runtime_capture",
      ...buildPlaceIdentityTrace(p),
      finalReason: reason(p),
    }),
  );
assert.equal(requests, 0);
globalThis.fetch = originalFetch;
console.log(`PASS ${count} multi-specific scenarios; zero network requests`);
