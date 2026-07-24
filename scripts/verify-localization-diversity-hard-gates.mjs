import assert from "node:assert/strict";
import { applyCombinationLocalizationGate } from "../src/lib/ai/combination-localization-gate.ts";
import { resolvePlaceCategoryFamily } from "../src/lib/ai/place-category-family.ts";
import { summarizeDailyCategoryDiversity } from "../src/lib/ai/daily-category-diversity.ts";
import { evaluateTourismQuality } from "../src/lib/ai/tourism-quality-gate.ts";

function place(id, name, primaryType, types = [primaryType], rating = 4.5, reviews = 1000) {
  return {
    id, name, localizedDisplayName: name, originalName: name, address: "Kuala Lumpur",
    lat: 3.14, lng: 101.69, rating, userRatingCount: reviews, photoName: null,
    primaryType, types, businessStatus: null, openStatus: "unknown",
    openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
  };
}

const klcc = place("klcc", "吉隆坡城中城公園", "urban_park", ["park", "urban_park"]);
const titiwangsa = place("titi", "蒂蒂旺沙湖濱公園", "lake_garden", ["park", "lake_garden"]);
const bird = place("bird", "吉隆坡飛禽公園", "bird_park", ["park", "bird_park", "zoo"]);
const perdana = place("perdana", "湖濱植物公園", "botanical_garden", ["park", "botanical_garden"]);

assert.equal(resolvePlaceCategoryFamily(klcc), "park_family");
assert.equal(resolvePlaceCategoryFamily(titiwangsa), "park_family");
assert.equal(resolvePlaceCategoryFamily(perdana), "park_family");
assert.equal(resolvePlaceCategoryFamily(bird), "wildlife_family");

const dayGate = summarizeDailyCategoryDiversity(1, [klcc, titiwangsa, bird, perdana]);
assert.equal(dayGate.gatePass, false);
assert.ok(dayGate.violations.includes("park_family:3>1"));

const comboGate = applyCombinationLocalizationGate([{
  combinationId: "mixed-language",
  title: "城市探索",
  theme: "attraction",
  placeCandidates: [
    { name: "Titwangsa Lake Gardens", originalName: "Titwangsa Lake Gardens", types: ["park"] },
    { name: "Perdana Botanical Gardens", originalName: "Perdana Botanical Gardens", types: ["botanical_garden"] },
    { name: "吉隆坡飛禽公園", originalName: "吉隆坡飛禽公園", types: ["bird_park"] },
  ],
}], { locale: "zh-TW", minCombinations: 1, minPlacesPerCombo: 2 });
assert.equal(comboGate.combinations.length, 0, "English fallbacks cannot be delivered in zh-TW");

for (const [id, name, type] of [
  ["lawn", "Freedom Lawn Area KL", "park"],
  ["fountain", "Pavilion Crystal Fountain", "tourist_attraction"],
  ["drink", "Sunny Beach Beverage", "beverage_store"],
]) {
  assert.equal(evaluateTourismQuality(place(id, name, type)).ok, false, `${name} rejected`);
}

console.log("OK localization per-place hard gate");
console.log("OK category families park=3 wildlife=1 and daily hard gate rejected");
console.log("OK low-tourism-value lawn/fountain/beverage rejected");
