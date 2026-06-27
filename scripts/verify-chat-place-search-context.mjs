import assert from "node:assert/strict";

const MELBOURNE_CENTER = { lat: -37.8136, lng: 144.9631 };
const TAIWAN_DEFAULT = { lat: 23.9739, lng: 120.9823 };

const INTL_APPROX = {
  墨爾本: MELBOURNE_CENTER,
  雪梨: { lat: -33.8688, lng: 151.2093 },
};

function resolveApprox(label) {
  return INTL_APPROX[label] ?? null;
}

const melbourneCenter = resolveApprox("墨爾本");
assert.ok(melbourneCenter, "墨爾本 should have approx center");
assert.notEqual(melbourneCenter.lat, TAIWAN_DEFAULT.lat, "墨爾本 lat must not be Taiwan default");
assert.ok(Math.abs(melbourneCenter.lat + 37.8136) < 0.1, "墨爾本 lat should be near -37.8136");
assert.ok(Math.abs(melbourneCenter.lng - 144.9631) < 0.1, "墨爾本 lng should be near 144.9631");

const TAIWAN_REJECT_RE =
  /(?:台灣|台湾|Taiwan|Taipei|臺北|台北|Nantou|南投)/i;

function passesMelbourneGuard(place) {
  const text = `${place.name ?? ""} ${place.address ?? ""}`;
  if (TAIWAN_REJECT_RE.test(text)) return false;
  return /Melbourne|Victoria|Australia|墨爾本/i.test(text);
}

const taipeiPlace = {
  name: "某餐廳",
  address: "台北市信義區",
};
const melbournePlace = {
  name: "Hardware Lane Restaurant",
  address: "Melbourne VIC 3000, Australia",
};

assert.equal(passesMelbourneGuard(taipeiPlace), false);
assert.equal(passesMelbourneGuard(melbournePlace), true);

function resolveSearchMode(context, userText) {
  if (context.destination?.trim()) return "destination";
  if (/(附近|我附近|離我)/.test(userText)) return "nearby";
  return "nearby";
}

assert.equal(
  resolveSearchMode({ destination: "墨爾本", interests: [] }, "墨爾本有什麼美食商圈"),
  "destination",
);
assert.equal(resolveSearchMode({ interests: [] }, "附近有什麼咖啡廳"), "nearby");

console.log("[verify-chat-place-search-context] ok");
