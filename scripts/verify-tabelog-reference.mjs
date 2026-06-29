import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTabelogFoodCategorySearchUrl,
  buildTabelogPlaceSearchQuery,
  buildTabelogPlaceSearchUrl,
  buildTabelogSearchUrl,
  compareJapanFoodPlaces,
  inferTabelogCuisineFromPlace,
  isExploreJapanFoodContext,
  isTabelogEligiblePlace,
  isValidTabelogSearchUrl,
  loadAuthorizedTabelogRankingCache,
  resolveExploreJapanContext,
  resolveTabelogFoodListExternalUrl,
  resolveTabelogPlaceExternalUrl,
  sortJapanFoodPlaces,
} from "../src/lib/tabelog-reference.ts";

console.info("[verify:tabelog] Tabelog 參考邏輯驗證\n");

test("不抓取 Tabelog：cache loader 預設為 null", () => {
  assert.equal(loadAuthorizedTabelogRankingCache("東京"), null);
});

test("日本目的地判斷", () => {
  assert.equal(resolveExploreJapanContext({ country: "日本" }), true);
  assert.equal(resolveExploreJapanContext({ cityLabel: "東京" }), true);
  assert.equal(resolveExploreJapanContext({ cityLabel: "台北" }), false);
  assert.equal(
    isExploreJapanFoodContext({ cityLabel: "大阪", categoryId: "food" }),
    true,
  );
  assert.equal(
    isExploreJapanFoodContext({ cityLabel: "大阪", categoryId: "sight" }),
    false,
  );
});

test("Tabelog 外部搜尋 URL", () => {
  const url = buildTabelogSearchUrl("東京 拉麵", "東京");
  assert.match(url, /^https:\/\/s\.tabelog\.com\/en\/tokyo\/rstLst\/\?sk=/);
  assert.equal(url.includes(encodeURIComponent("東京 拉麵")), true);
  assert.equal(isValidTabelogSearchUrl(url), true);

  const generic = buildTabelogSearchUrl("東京 拉麵");
  assert.match(generic, /^https:\/\/s\.tabelog\.com\/en\/rstLst\/\?sk=/);

  assert.equal(buildTabelogSearchUrl(""), null);
  assert.equal(buildTabelogSearchUrl("   "), null);

  const foodList = buildTabelogFoodCategorySearchUrl("東京");
  assert.ok(foodList?.includes("/en/tokyo/rstLst/"));
  assert.ok(foodList?.includes(encodeURIComponent("東京 美食")));

  const placeUrl = buildTabelogPlaceSearchUrl({
    cityLabel: "東京",
    placeName: "鳥貴族 渋谷道玄坂店",
    address: "日本、〒150-0043 東京都渋谷区道玄坂2丁目",
    place: { name: "鳥貴族 渋谷道玄坂店", types: ["restaurant"] },
  });
  assert.ok(placeUrl?.includes("s.tabelog.com"));
  const sk = decodeURIComponent(placeUrl.split("sk=")[1] ?? "");
  assert.ok(sk.includes("鳥貴族"));
  assert.ok(sk.includes("東京"));
  assert.ok(sk.includes("渋谷") || sk.includes("道玄坂"));
  assert.equal(isValidTabelogSearchUrl(placeUrl ?? ""), true);

  const query = buildTabelogPlaceSearchQuery({
    placeName: "Sushi Dai",
    cityLabel: "東京",
    address: "東京都中央区築地5丁目",
    place: { name: "Sushi Dai", types: ["restaurant"] },
  });
  assert.ok(query?.includes("Sushi Dai"));
  assert.ok(query?.includes("東京"));
});

test("料理關鍵字推斷", () => {
  assert.equal(
    inferTabelogCuisineFromPlace({ name: "一蘭拉麵", types: ["restaurant"] }),
    "拉麵",
  );
  assert.equal(
    inferTabelogCuisineFromPlace({ name: "Sushi Dai", types: ["restaurant"] }),
    "壽司",
  );
});

test("Tabelog 入口顯示條件", () => {
  assert.equal(
    isTabelogEligiblePlace({ primaryType: "restaurant", types: ["restaurant"] }),
    true,
  );
  assert.equal(
    isTabelogEligiblePlace({ name: "Golden Gai Bar", types: ["bar"] }),
    true,
  );
  assert.equal(
    isTabelogEligiblePlace({ primaryType: "museum", types: ["museum"] }),
    false,
  );

  assert.equal(
    resolveTabelogFoodListExternalUrl({ cityLabel: "東京", categoryId: "food" }),
    buildTabelogFoodCategorySearchUrl("東京"),
  );
  assert.equal(
    resolveTabelogFoodListExternalUrl({ cityLabel: "台北", categoryId: "food" }),
    null,
  );

  const detailUrl = resolveTabelogPlaceExternalUrl({
    cityLabel: "東京",
    address: "東京都渋谷区道玄坂2丁目",
    place: { name: "鳥貴族", primaryType: "restaurant", types: ["restaurant"] },
  });
  assert.ok(detailUrl?.includes(encodeURIComponent("鳥貴族")));

  const sushiUrl = resolveTabelogPlaceExternalUrl({
    cityLabel: "東京",
    address: "東京都中央区築地5丁目",
    place: { name: "Sushi Dai", primaryType: "restaurant", types: ["restaurant"] },
  });
  assert.ok(sushiUrl?.includes(encodeURIComponent("Sushi Dai")));

  assert.equal(
    resolveTabelogPlaceExternalUrl({
      cityLabel: "台北",
      address: "台北市信義區",
      place: { name: "鼎泰豐", primaryType: "restaurant", types: ["restaurant"] },
    }),
    null,
  );

  assert.equal(
    resolveTabelogPlaceExternalUrl({
      cityLabel: "東京",
      place: { name: "X", primaryType: "restaurant", types: ["restaurant"] },
    }),
    null,
  );
});

test("日本美食排序：Google 評分優先，可選 cache 加權", () => {
  const base = {
    lat: 35.68,
    lng: 139.76,
    openStatus: "open",
    photoName: "photo",
    primaryType: "restaurant",
    types: ["restaurant"],
  };
  const highRating = { ...base, id: "a", name: "A", rating: 4.5, userRatingCount: 200 };
  const lowRating = { ...base, id: "b", name: "B", rating: 4.0, userRatingCount: 5000 };
  assert.ok(compareJapanFoodPlaces(highRating, lowRating) < 0);

  const withPhoto = { ...lowRating, id: "c", photoName: "p" };
  const noPhoto = { ...lowRating, id: "d", photoName: null };
  assert.ok(compareJapanFoodPlaces(withPhoto, noPhoto) < 0);

  const sorted = sortJapanFoodPlaces([lowRating, highRating], { lat: 35.68, lng: 139.76 });
  assert.equal(sorted[0]?.id, "a");
});

console.info("\n[verify:tabelog] 全部通過\n");
