/**
 * Category-contract acceptance for combination themes (offline, no Places API).
 * Covers Yunlin regression cases + synthetic city fixtures.
 */
import assert from "node:assert/strict";
import {
  adjustCombinationTitle,
  assignSoftThemeSlot,
  hasFoodEvidence,
  normalizePlaceCategory,
  resolveCombinationThemeKey,
  validateFoodCombinationPlaces,
  validatePlaceForCombination,
} from "../src/lib/ai/combination-category-contract.ts";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(e);
  }
}

// --- Yunlin regression: parks must not enter food ---
const yunlinFoodRejects = [
  { name: "虎頭山觀景平台", types: ["tourist_attraction", "point_of_interest"], primaryType: "tourist_attraction" },
  { name: "長壽公園", types: ["park", "tourist_attraction"], primaryType: "park" },
  { name: "楓香公園", types: ["park"], primaryType: "park" },
];

for (const place of yunlinFoodRejects) {
  check(`food rejects ${place.name}`, () => {
    const r = validatePlaceForCombination(place, "food", { title: "人氣美食組合" });
    assert.equal(r.valid, false, JSON.stringify(r));
  });
}

// --- Yunlin regression: farm / flying field / culture hall not shopping ---
const yunlinShoppingRejects = [
  { name: "AS山城多肉植物農場 Succulents in Puli", types: ["tourist_attraction", "farm"], primaryType: "farm" },
  { name: "飄逸杯／雞朝文創故事館", types: ["tourist_attraction", "museum"], primaryType: "tourist_attraction" },
  { name: "埔里內埔飛場", types: ["airport", "point_of_interest"], primaryType: "airport" },
];

for (const place of yunlinShoppingRejects) {
  check(`shopping rejects ${place.name}`, () => {
    const r = validatePlaceForCombination(place, "shopping", { title: "購物散策組合" });
    assert.equal(r.valid, false, JSON.stringify(r));
  });
}

// --- Food accepts real food venues ---
const foodAccepts = [
  { name: "斗六西市場美食區", types: ["market", "food"], primaryType: "market" },
  { name: "北港朝天宮周邊小吃", types: ["restaurant"], primaryType: "restaurant" },
  { name: "雲林人文咖啡", types: ["cafe", "coffee_shop"], primaryType: "cafe" },
  { name: "士林夜市", types: ["tourist_attraction", "point_of_interest"], primaryType: "tourist_attraction" },
];

for (const place of foodAccepts) {
  check(`food accepts ${place.name}`, () => {
    const r = validatePlaceForCombination(place, "food", { title: "人氣美食組合" });
    assert.equal(r.valid, true, JSON.stringify(r));
  });
}

// --- Shopping accepts real shopping venues ---
const shoppingAccepts = [
  { name: "台北101購物中心", types: ["shopping_mall"], primaryType: "shopping_mall" },
  { name: "逢甲商圈", types: ["tourist_attraction"], primaryType: "tourist_attraction" },
  { name: "三越百貨", types: ["department_store"], primaryType: "department_store" },
  { name: "東大門市場", types: ["market"], primaryType: "market" },
];

for (const place of shoppingAccepts) {
  check(`shopping accepts ${place.name}`, () => {
    const r = validatePlaceForCombination(place, "shopping", { title: "購物散策組合" });
    assert.equal(r.valid, true, JSON.stringify(r));
  });
}

// --- Soft slot assignment never maps park→food ---
check("soft slot: park → nature", () => {
  assert.equal(
    assignSoftThemeSlot({ name: "長壽公園", types: ["park"], primaryType: "park" }),
    "nature",
  );
});

check("soft slot: restaurant → food", () => {
  assert.equal(
    assignSoftThemeSlot({ name: "人氣餐廳", types: ["restaurant"], primaryType: "restaurant" }),
    "food",
  );
});

check("soft slot: mall → shopping", () => {
  assert.equal(
    assignSoftThemeSlot({ name: "購物中心", types: ["shopping_mall"], primaryType: "shopping_mall" }),
    "shopping",
  );
});

check("soft slot: farm → null (not shopping)", () => {
  assert.equal(
    assignSoftThemeSlot({ name: "多肉植物農場", types: ["farm", "tourist_attraction"], primaryType: "farm" }),
    null,
  );
});

// --- Title adjustment ---
check("title adjusts to 咖啡甜點組合", () => {
  const title = adjustCombinationTitle("人氣美食組合", "food", ["cafe", "cafe", "bakery"]);
  assert.equal(title, "咖啡甜點組合");
});

check("title adjusts to 老街市集散策組合", () => {
  const title = adjustCombinationTitle("購物散策組合", "shopping", [
    "shopping_street",
    "market",
    "souvenir",
  ]);
  assert.equal(title, "老街市集散策組合");
});

check("resolveThemeKeyFromTitle maps soft titles", () => {
  assert.equal(resolveCombinationThemeKey("soft", "人氣美食組合"), "food");
  assert.equal(resolveCombinationThemeKey("soft", "購物散策組合"), "shopping");
  assert.equal(resolveCombinationThemeKey("soft", "咖啡散步組合"), "cafe");
  assert.equal(resolveCombinationThemeKey("soft", "自然風景組合"), "nature");
});

// --- Eight cities: count rejected wrong types against food/shopping contracts ---
const cities = ["雲林", "台中", "台北", "花蓮", "東京", "首爾", "曼谷", "巴黎"];

const wrongForFood = [
  { name: "中央公園", types: ["park"], primaryType: "park" },
  { name: "觀景平台", types: ["tourist_attraction"], primaryType: "tourist_attraction" },
  { name: "城市機場", types: ["airport"], primaryType: "airport" },
  { name: "山城農場", types: ["farm"], primaryType: "farm" },
  { name: "市立美術館", types: ["museum"], primaryType: "museum" },
];

const wrongForShopping = [
  { name: "中央公園", types: ["park"], primaryType: "park" },
  { name: "觀景平台", types: ["tourist_attraction"], primaryType: "tourist_attraction" },
  { name: "城市機場", types: ["airport"], primaryType: "airport" },
  { name: "山城農場", types: ["farm"], primaryType: "farm" },
  { name: "市立美術館", types: ["museum"], primaryType: "museum" },
  { name: "文創故事館", types: ["museum", "tourist_attraction"], primaryType: "museum" },
  { name: "人氣餐廳", types: ["restaurant"], primaryType: "restaurant" },
];

console.log("\n=== City rejection counts (synthetic wrong-type fixtures) ===");
for (const city of cities) {
  let foodRejected = 0;
  let shoppingRejected = 0;
  for (const place of wrongForFood) {
    const r = validatePlaceForCombination(
      { ...place, name: `${city}${place.name}` },
      "food",
      { title: "人氣美食組合", combinationId: `${city}:food` },
    );
    if (!r.valid) foodRejected += 1;
  }
  for (const place of wrongForShopping) {
    const r = validatePlaceForCombination(
      { ...place, name: `${city}${place.name}` },
      "shopping",
      { title: "購物散策組合", combinationId: `${city}:shopping` },
    );
    if (!r.valid) shoppingRejected += 1;
  }
  check(`${city} food rejects all ${wrongForFood.length} wrong types`, () => {
    assert.equal(foodRejected, wrongForFood.length);
  });
  check(`${city} shopping rejects all ${wrongForShopping.length} wrong types`, () => {
    assert.equal(shoppingRejected, wrongForShopping.length);
  });
  console.log(
    `  ${city}: food_rejected=${foodRejected}/${wrongForFood.length} shopping_rejected=${shoppingRejected}/${wrongForShopping.length}`,
  );
}

check("normalizePlaceCategory: park", () => {
  assert.equal(normalizePlaceCategory({ name: "長壽公園", types: ["park"] }), "park");
});

check("normalizePlaceCategory: farm", () => {
  assert.equal(
    normalizePlaceCategory({ name: "多肉農場", types: ["farm", "tourist_attraction"] }),
    "farm",
  );
});

check("resolveThemeKey: 美食探索 → food (strict food contract)", () => {
  assert.equal(resolveCombinationThemeKey("soft", "美食探索組合"), "food");
  assert.equal(resolveCombinationThemeKey("soft", "經典大阪組合"), "attraction");
  assert.equal(resolveCombinationThemeKey("soft", "親子娛樂組合"), "attraction");
  assert.equal(resolveCombinationThemeKey("soft", "人氣美食組合"), "food");
});

check("Nagoya 大須觀音 rejected from 美食探索", () => {
  const r = validatePlaceForCombination(
    {
      name: "大須觀音",
      primaryType: "place_of_worship",
      types: ["place_of_worship", "tourist_attraction", "point_of_interest"],
    },
    "soft",
    { title: "美食探索組合", combinationId: 2 },
  );
  assert.equal(r.valid, false, JSON.stringify(r));
});

check("Nagoya 大須觀音 rejected even without types (name)", () => {
  const r = validatePlaceForCombination(
    { name: "大須觀音", types: [] },
    "food",
    { title: "美食探索組合" },
  );
  assert.equal(r.valid, false, JSON.stringify(r));
});

check("Nagoya food restaurants accepted in 美食探索", () => {
  for (const name of ["矢場とん本店", "ひつまぶし名古屋備長", "今池世界の山ちゃん"]) {
    const r = validatePlaceForCombination(
      { name, types: [], primaryType: null },
      "soft",
      { title: "美食探索組合" },
    );
    assert.equal(r.valid, true, `${name} ${JSON.stringify(r)}`);
  }
});

check("Osaka 通天閣 rejected from 美食探索 (food contract)", () => {
  const r = validatePlaceForCombination(
    {
      name: "通天閣",
      primaryType: "observation_deck",
      types: ["observation_deck", "tourist_attraction", "point_of_interest"],
    },
    "soft",
    { title: "美食探索組合" },
  );
  assert.equal(r.valid, false, JSON.stringify(r));
});

check("Osaka 天保山摩天輪 allowed in 親子娛樂", () => {
  const r = validatePlaceForCombination(
    {
      name: "天保山摩天輪",
      primaryType: "ferris_wheel",
      types: ["ferris_wheel", "tourist_attraction", "point_of_interest"],
    },
    "soft",
    { title: "親子娛樂組合" },
  );
  assert.equal(r.valid, true, JSON.stringify(r));
});

check("Osaka 環球影城 amusement_park allowed", () => {
  const r = validatePlaceForCombination(
    {
      name: "日本環球影城",
      primaryType: "amusement_park",
      types: ["amusement_park", "tourist_attraction"],
    },
    "soft",
    { title: "親子娛樂組合" },
  );
  assert.equal(r.valid, true, JSON.stringify(r));
});

check("secondary type tourist_attraction alone does not reject food night market", () => {
  const r = validatePlaceForCombination(
    { name: "士林夜市", types: ["tourist_attraction", "point_of_interest"], primaryType: "tourist_attraction" },
    "food",
    { title: "人氣美食組合" },
  );
  assert.equal(r.valid, true, JSON.stringify(r));
});

// --- Multi-city food exploration contract (10 cities) ---
const FOOD_CITY_CASES = [
  { city: "名古屋", title: "美食探索組合", good: "矢場とん本店", bad: "大須觀音" },
  { city: "大阪", title: "美食探索組合", good: "一蘭道頓堀店", bad: "通天閣" },
  { city: "東京", title: "美食探索組合", good: "すきやばし次郎", bad: "淺草寺" },
  { city: "台南", title: "巷弄美食組合", good: "度小月擔仔麵", bad: "赤崁樓" },
  { city: "首爾", title: "在地美食組合", good: "廣藏市場", bad: "景福宮" },
  { city: "曼谷", title: "街頭美食組合", good: "喬德夜市", bad: "大皇宮" },
  { city: "福岡", title: "拉麵與在地料理組合", good: "一蘭總本店", bad: "福岡塔" },
  { city: "巴黎", title: "甜點咖啡組合", good: "Angelina", bad: "艾菲爾鐵塔" },
  { city: "新加坡", title: "熟食中心組合", good: "Maxwell Food Centre", bad: "魚尾獅" },
  { city: "墨爾本", title: "咖啡早午餐組合", good: "Higher Ground", bad: "聯邦廣場" },
];

for (const c of FOOD_CITY_CASES) {
  check(`${c.city} food theme rejects landmark ${c.bad}`, () => {
    assert.equal(resolveCombinationThemeKey("soft", c.title), "food");
    const r = validatePlaceForCombination(
      { name: c.bad, types: ["tourist_attraction"], primaryType: "tourist_attraction" },
      "soft",
      { title: c.title },
    );
    assert.equal(r.valid, false, JSON.stringify(r));
  });
  check(`${c.city} food theme accepts dining ${c.good}`, () => {
    const withTypes = validatePlaceForCombination(
      { name: c.good, types: ["restaurant"], primaryType: "restaurant" },
      "soft",
      { title: c.title },
    );
    assert.equal(withTypes.valid, true, JSON.stringify(withTypes));
  });
}

check("hasFoodEvidence: temple false, restaurant true", () => {
  assert.equal(
    hasFoodEvidence({
      name: "大須觀音",
      primaryType: "place_of_worship",
      types: ["place_of_worship"],
    }),
    false,
  );
  assert.equal(
    hasFoodEvidence({
      name: "矢場とん本店",
      primaryType: "restaurant",
      types: ["restaurant"],
    }),
    true,
  );
});

check("validateFoodCombinationPlaces rejects mixed restaurant+temple", () => {
  const result = validateFoodCombinationPlaces(
    [
      { name: "矢場とん本店", types: ["restaurant"], primaryType: "restaurant" },
      { name: "ひつまぶし名古屋備長", types: ["restaurant"], primaryType: "restaurant" },
      { name: "大須觀音", types: ["place_of_worship"], primaryType: "place_of_worship" },
    ],
    { combinationId: 2, requiredCount: 3 },
  );
  assert.equal(result.passed, false);
  assert.equal(result.validFoodCount, 2);
});

check("validateFoodCombinationPlaces passes all-food trio", () => {
  const result = validateFoodCombinationPlaces(
    [
      { name: "A", types: ["restaurant"], primaryType: "restaurant" },
      { name: "B", types: ["cafe"], primaryType: "cafe" },
      { name: "C", types: ["bakery"], primaryType: "bakery" },
    ],
    { combinationId: 2, requiredCount: 3 },
  );
  assert.equal(result.passed, true);
  assert.equal(result.validFoodCount, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
