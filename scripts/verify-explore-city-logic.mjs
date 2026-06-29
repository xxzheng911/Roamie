#!/usr/bin/env node
/**
 * 探索頁城市推薦邏輯回歸（無需啟動 App）。
 * 執行：npx vite-node scripts/verify-explore-city-logic.mjs
 */
import assert from "node:assert/strict";
import { normalizeDestinationLabel } from "../src/lib/ai/trip-planning-context.ts";
import { isBurialOrFuneralPlace } from "../src/lib/burial-place-filter.ts";
import { mergeExploreAllCategoryResults } from "../src/lib/explore-all-places-merge.ts";
import {
  inferExploreCityLabel,
  cityRecommendMaxDistanceMeters,
  cityCategoryTextQueries,
} from "../src/lib/explore-recommend-mode.ts";
import {
  isPlaceInExploreCity,
  isCitySightExploreCategory,
  isExploreCityPoliticalEntity,
} from "../src/lib/explore-city-popular-places.ts";
import {
  classifyExploreMapQualityTier,
  filterCityExploreCategoryPlaces,
  passesCityFoodRating,
  passesCityRelaxedRating,
  isBarPrimaryFoodPlace,
  EXPLORE_CITY_CATEGORY_MIN_DISPLAY,
} from "../src/lib/explore-places-eligibility.ts";
import { buildCityCategoryFetchQueries } from "../src/lib/explore-city-category-queries.ts";
import { exploreTimeBucket } from "../src/lib/explore-time-bucket.ts";

const TOKYO_CENTER = { lat: 35.6764, lng: 139.65 };

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function mockPlace(name, categoryId, lat, lng, extra = {}) {
  return {
    id: `mock-${categoryId}-${name}`,
    name,
    address: `東京都 ${name}`,
    lat,
    lng,
    rating: 4.5,
    userRatingCount: 120,
    photoName: null,
    primaryType: categoryId === "coffee" ? "cafe" : "tourist_attraction",
    types: [categoryId === "coffee" ? "cafe" : "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    categoryId,
    ...extra,
  };
}

console.info("[verify:explore-city] 探索城市推薦邏輯驗證\n");

test("東京都正規化為東京", () => {
  assert.equal(normalizeDestinationLabel("東京都"), "東京");
});

test("東京座標推斷城市名", () => {
  assert.equal(
    inferExploreCityLabel(TOKYO_CENTER.lat, TOKYO_CENTER.lng, "東京都"),
    "東京",
  );
  assert.equal(inferExploreCityLabel(TOKYO_CENTER.lat, TOKYO_CENTER.lng, null), "東京");
});

test("東京 mega city 距離上限 30km", () => {
  assert.equal(cityRecommendMaxDistanceMeters("東京都"), 30_000);
  assert.equal(cityRecommendMaxDistanceMeters("東京"), 30_000);
});

test("東京熱門地點在 city 半徑內", () => {
  const skytree = { name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, address: "Sumida, Tokyo" };
  assert.equal(isPlaceInExploreCity(skytree, "東京", TOKYO_CENTER), true);
});

test("全部 tab 合併至少 8 個、至多 20 個", () => {
  const origin = TOKYO_CENTER;
  const cardsByCategory = {
    coffee: [mockPlace("Blue Bottle", "coffee", 35.66, 139.7)],
    sight: [
      mockPlace("Skytree", "sight", 35.7101, 139.8107),
      mockPlace("Senso-ji", "sight", 35.7148, 139.7967),
      mockPlace("Meiji", "sight", 35.6764, 139.6993),
    ],
    district: [mockPlace("Shibuya", "district", 35.659, 139.7006)],
    food: [
      mockPlace("Ichiran", "food", 35.6938, 139.7034),
      mockPlace("Tsukiji", "food", 35.6654, 139.7707),
    ],
    night: [mockPlace("Golden Gai", "night", 35.6938, 139.7034)],
  };
  for (let i = 0; i < 6; i += 1) {
    cardsByCategory.sight.push(
      mockPlace(`Sight ${i}`, "sight", 35.68 + i * 0.01, 139.65 + i * 0.01),
    );
  }

  const merged = mergeExploreAllCategoryResults(cardsByCategory, {
    origin,
    timeBucket: exploreTimeBucket(),
    cityMode: true,
  });
  assert.ok(merged.length >= 8, `expected >= 8, got ${merged.length}`);
  assert.ok(merged.length <= 20, `expected <= 20, got ${merged.length}`);
});

test("排除石碑、橋跡、靈場等低價值城市標記", async () => {
  const { isLowValueCityExplorePlace } = await import("../src/lib/explore-city-tourist-filter.ts");
  assert.equal(
    isLowValueCityExplorePlace({
      name: "某某橋跡",
      types: ["historical_landmark", "point_of_interest"],
      rating: 3.5,
      userRatingCount: 2,
    }),
    true,
  );
  assert.equal(
    isLowValueCityExplorePlace({
      name: "戒壇石",
      types: ["monument"],
      rating: null,
      userRatingCount: 0,
    }),
    true,
  );
  assert.equal(
    isLowValueCityExplorePlace({
      name: "Shibuya Scramble Crossing",
      types: ["tourist_attraction", "point_of_interest"],
      rating: 4.5,
      userRatingCount: 12000,
    }),
    false,
  );
  assert.equal(
    isLowValueCityExplorePlace({
      name: "Tokyo Skytree",
      types: ["tourist_attraction"],
      rating: 4.6,
      userRatingCount: 80000,
    }),
    false,
  );
});

test("排除墓地／靈園／殯葬", () => {
  assert.equal(
    isBurialOrFuneralPlace({
      name: "青山霊園",
      types: ["cemetery"],
      primaryType: "cemetery",
    }),
    true,
  );
  assert.equal(
    isBurialOrFuneralPlace({
      name: "靖國神社",
      types: ["place_of_worship", "tourist_attraction"],
      primaryType: "tourist_attraction",
    }),
    false,
  );
});

test("城市分類 query 各自獨立", () => {
  const coffee = cityCategoryTextQueries("coffee", "東京");
  assert.ok(coffee.some((q) => /specialty coffee/i.test(q)));
  assert.ok(coffee.some((q) => /^東京 cafe$/i.test(q)));

  const district = cityCategoryTextQueries("district", "東京");
  assert.ok(district.some((q) => /shopping street/i.test(q)));

  const food = cityCategoryTextQueries("food", "東京");
  assert.ok(food.some((q) => /レストラン/.test(q)));
  assert.ok(food.some((q) => /グルメ/.test(q)));
  assert.ok(food.some((q) => /restaurant/i.test(q)));

  const tokyoFoodPlan = buildCityCategoryFetchQueries("food", "東京");
  assert.ok(tokyoFoodPlan.some((q) => /Tokyo/i.test(q)));

  const parisFood = buildCityCategoryFetchQueries("food", "巴黎");
  assert.ok(parisFood.some((q) => /Paris/i.test(q)));

  const night = cityCategoryTextQueries("night", "東京");
  assert.ok(night.some((q) => /izakaya/i.test(q)));
  assert.ok(night.some((q) => /night market/i.test(q)));
});

test("城市模式各分類 tier 放寬門檻", () => {
  const base = {
    id: "ChIJtest",
    address: "City",
    lat: 35.68,
    lng: 139.76,
    photoName: "photo",
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
  const sight = {
    ...base,
    name: "City Museum",
    rating: 3.9,
    userRatingCount: 120,
    primaryType: "museum",
    types: ["museum", "tourist_attraction"],
  };
  assert.equal(classifyExploreMapQualityTier(sight, "sight", { cityMode: true }), 2);

  const district = {
    ...base,
    name: "Shopping Mall",
    rating: 4.0,
    userRatingCount: 800,
    primaryType: "shopping_mall",
    types: ["shopping_mall"],
  };
  assert.equal(classifyExploreMapQualityTier(district, "district", { cityMode: true }), 2);
  assert.equal(EXPLORE_CITY_CATEGORY_MIN_DISPLAY, 5);
});

test("僅全部/景點走 sight bootstrap", () => {
  assert.equal(isCitySightExploreCategory("all"), true);
  assert.equal(isCitySightExploreCategory("sight"), true);
  assert.equal(isCitySightExploreCategory("coffee"), false);
  assert.equal(isCitySightExploreCategory("food"), false);
});

test("著名商圈名稱不被當行政區排除", () => {
  assert.equal(
    isExploreCityPoliticalEntity({
      name: "Shibuya",
      types: ["sublocality", "political"],
      primaryType: "sublocality",
    }),
    false,
  );
});

test("城市模式景點 relaxed filter", () => {
  const tokyoTower = {
    id: "ChIJtest-tower",
    name: "Tokyo Tower",
    address: "Minato, Tokyo",
    lat: 35.6586,
    lng: 139.7454,
    rating: 4.5,
    userRatingCount: 80000,
    photoName: "photo",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
  const sight = filterCityExploreCategoryPlaces([tokyoTower], "sight");
  assert.ok(sight.length >= 1, "Tokyo Tower should match sight");
});

test("東京美食 relaxed rating 門檻", () => {
  const ichiran = {
    id: "ChIJichiran",
    name: "一蘭 新宿店",
    address: "東京都新宿区",
    lat: 35.6938,
    lng: 139.7034,
    rating: 3.9,
    userRatingCount: 1200,
    photoName: "photo",
    primaryType: "restaurant",
    types: ["restaurant", "food", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
  assert.equal(passesCityRelaxedRating(ichiran), true);
  assert.equal(
    classifyExploreMapQualityTier(ichiran, "food", { cityMode: true }),
    2,
  );
  const filtered = filterCityExploreCategoryPlaces([ichiran], "food");
  assert.ok(filtered.length >= 1, "Ichiran should pass food relaxed filter");
  assert.equal(
    passesCityRelaxedRating({ ...ichiran, userRatingCount: 0 }),
    false,
    "0 reviews excluded",
  );
});

test("bar-only 不作為美食主結果", () => {
  const barOnly = {
    id: "ChIJbar",
    name: "Some Bar",
    types: ["bar", "point_of_interest"],
    primaryType: "bar",
    rating: 4.5,
    userRatingCount: 200,
  };
  assert.equal(isBarPrimaryFoodPlace(barOnly), true);
  const restaurantBar = {
    id: "ChIJrest",
    name: "Izakaya Dining",
    types: ["restaurant", "bar"],
    primaryType: "restaurant",
    rating: 4.2,
    userRatingCount: 300,
  };
  assert.equal(isBarPrimaryFoodPlace(restaurantBar), false);
});

console.info("\n[verify:explore-city] 全部通過\n");
