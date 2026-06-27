import assert from "node:assert/strict";

const CAFE_NAME_RE =
  /(?:咖啡|珈琲|カフェ|café|cafe|coffee|espresso|roaster|roastery|焙茶)/i;

const COMBO_ITINERARY_NAME_RE =
  /(?:＋|\+|一日遊|半日遊|二日遊|三日遊|day\s*trip|itinerary)/i;

function isCafePlace(place) {
  const types = [(place.primaryType ?? "").toLowerCase(), ...(place.types ?? [])].filter(Boolean);
  if (types.some((t) => t === "cafe" || t === "coffee_shop")) return true;
  return CAFE_NAME_RE.test(place.name ?? "") || CAFE_NAME_RE.test(place.address ?? "");
}

function isComboItineraryRecommendation(item) {
  const name = (item.placeName ?? item.name ?? "").trim();
  if (COMBO_ITINERARY_NAME_RE.test(name)) return true;
  if (!item.googlePlaceId?.trim() && item.type === "景點") return true;
  return false;
}

function passesCafeRenderGuard(item) {
  if (isComboItineraryRecommendation(item)) return false;
  if (!item.googlePlaceId?.trim()) return false;
  const blob = `${item.name ?? ""} ${item.type ?? ""} ${item.address ?? ""}`;
  return CAFE_NAME_RE.test(blob) || item.type === "cafe" || item.type === "coffee_shop";
}

function shouldUseNamedMustVisitFallback(intent) {
  return intent === "attraction" || intent === "indoor";
}

function parseIntents(text) {
  const found = [];
  if (/(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(text)) found.push("cafe");
  if (/(景點|必去)/.test(text)) found.push("attraction");
  return found;
}

const tokyoCombo = {
  name: "淺草寺＋晴空塔",
  placeName: "淺草寺＋晴空塔",
  type: "景點",
  description: "傳統與現代地標一次看完",
  reason: "傳統與現代地標一次看完",
  reasonSource: "template",
  estimatedTime: "1-2 小時",
  address: "東京",
  lat: null,
  lng: null,
  googleMapsUrl: "",
};

const realCafe = {
  name: "Blue Bottle Coffee",
  placeName: "Blue Bottle Coffee",
  type: "cafe",
  description: "東京都渋谷区",
  reason: "評分高、適合慢慢坐",
  reasonSource: "template",
  estimatedTime: "1-2 小時",
  address: "東京都渋谷区",
  lat: 35.66,
  lng: 139.7,
  googleMapsUrl: "https://maps.google.com",
  googlePlaceId: "place-123",
  rating: 4.5,
  userRatingCount: 800,
};

assert.equal(isComboItineraryRecommendation(tokyoCombo), true);
assert.equal(passesCafeRenderGuard(tokyoCombo), false);
assert.equal(passesCafeRenderGuard(realCafe), true);
assert.equal(shouldUseNamedMustVisitFallback("cafe"), false);
assert.equal(shouldUseNamedMustVisitFallback("attraction"), true);

const intents = parseIntents("東京有推薦的咖啡廳嗎");
assert.deepEqual(intents, ["cafe"]);

assert.equal(isCafePlace({ name: "Starbucks Reserve", primaryType: "cafe", types: ["cafe"] }), true);
assert.equal(isCafePlace({ name: "淺草寺", primaryType: "tourist_attraction", types: ["tourist_attraction"] }), false);

console.log("[verify-chat-cafe-category] ok");
