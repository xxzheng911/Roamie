import assert from "node:assert/strict";

/**
 * Mirrors recommendationsForCategoryPlaceDisplay behavior:
 * category cards must not be zeroed by open-hours filter.
 */
const CATEGORY_PLACE_QUERY_RE =
  /(?:咖啡廳|咖啡店|咖啡|café|cafe|餐廳|美食|吃飯|用餐|商圈|百貨|景點|有推薦的(?:餐廳|咖啡|店))/i;

function hasCategoryPlaceQuery(text) {
  return CATEGORY_PLACE_QUERY_RE.test(text.trim());
}

function mockItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Restaurant ${i + 1}`,
    placeName: `Restaurant ${i + 1}`,
    googlePlaceId: `place_${i + 1}`,
    type: "餐廳",
    rating: 4.5,
    reviewCount: 100,
  }));
}

function preserveCategoryCards(userText, items, filteredToZero) {
  const originalCount = items.length;
  if (filteredToZero.length === 0 && originalCount > 0 && hasCategoryPlaceQuery(userText)) {
    return items.filter((i) => i.googlePlaceId).slice(0, 6);
  }
  return filteredToZero;
}

const userText = "東京有推薦的餐廳嗎";
const items = mockItems(5);
const afterBadFilter = [];

const preserved = preserveCategoryCards(userText, items, afterBadFilter);
assert.equal(preserved.length, 5, "category cards preserved when display filter zeroed");
assert.equal(hasCategoryPlaceQuery(userText), true);

console.log("verify-chat-display-preserve: ok");
