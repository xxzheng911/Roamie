#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeGooglePlace } from "../src/lib/ai/normalize-google-place.ts";
import { resolvePlaceDisplayName } from "../src/lib/place-display-name.ts";
import { mapPlaceResultToChatItem } from "../src/lib/chat-session.ts";

const resolve = (name, extra = {}) =>
  resolvePlaceDisplayName(
    {
      name,
      originalName: name,
      placeId: `fidelity:${name}`,
      canonicalPlaceId: `fidelity:${name}`,
      primaryType: "cafe",
      types: ["cafe", "coffee_shop", "establishment"],
      ...extra,
    },
    "zh-TW",
  ).localizedDisplayName;

assert.equal(resolve("ONIBUS COFFEE 台中"), "ONIBUS COFFEE 台中");
assert.equal(resolve("ONIBUS COFFEE Taichung"), "ONIBUS COFFEE Taichung");
assert.equal(resolve("STARBUCKS 信義威秀店"), "STARBUCKS 信義威秀店");
assert.equal(resolve("秘氏咖啡"), "秘氏咖啡");
assert.equal(resolve("Tamp Temper Taichung Coffee"), "Tamp Temper Taichung Coffee");
assert.notEqual(resolve("ONIBUS COFFEE 台中"), "台中");

const raw = {
  id: "places/onibus-taichung",
  displayName: { text: "ONIBUS COFFEE 台中" },
  formattedAddress: "台中市西區中興街 1 號",
  location: { latitude: 24.15, longitude: 120.66 },
  primaryType: "cafe",
  types: ["cafe", "coffee_shop", "establishment"],
  rating: 4.5,
};
const place = normalizeGooglePlace(raw, { locale: "zh-TW" });
assert.ok(place);
assert.equal(place.id, "onibus-taichung");
assert.equal(place.name, "ONIBUS COFFEE 台中");
assert.equal(place.lat, 24.15);
assert.equal(place.lng, 120.66);
assert.equal(place.address, "台中市西區中興街 1 號");

const card = mapPlaceResultToChatItem(place, { locale: "zh-TW", reason: "符合這次想找咖啡廳的需求" });
assert.equal(card.name, "ONIBUS COFFEE 台中");
assert.equal(card.placeName, "ONIBUS COFFEE 台中");
assert.equal(card.googlePlaceId, "onibus-taichung");

console.log("verify-place-display-name-fidelity: ok");
