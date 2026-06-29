import assert from "node:assert/strict";
import {
  buildUnifiedPlaceCacheKey,
  buildUnifiedPlaceDetailsCacheKey,
  inferPlaceCacheLocation,
  isPlaceDetailsMinimallyCacheable,
  isPlaceDetailsCacheComplete,
} from "../src/lib/unified-place-cache.ts";

const tokyoList = buildUnifiedPlaceCacheKey({
  country: "JP",
  cityLabel: "東京",
  placeId: "ChIJ51cu8IcbXWARiRtXIothAS4",
  category: "coffee",
  language: "zh-TW",
  lat: 35.6762,
  lng: 139.6503,
});
assert.match(tokyoList, /^JP\|東京\|ChIJ51cu8IcbXWARiRtXIothAS4\|coffee\|zh-TW$/);

const tokyoList2 = buildUnifiedPlaceCacheKey({
  cityLabel: "東京",
  placeId: "ChIJ51cu8IcbXWARiRtXIothAS4",
  category: "coffee",
  language: "zh-TW",
  lat: 35.68,
  lng: 139.66,
});
assert.equal(tokyoList, tokyoList2, "placeId anchor ignores coordinate drift");

const detailKey = buildUnifiedPlaceDetailsCacheKey("ChIJx123", "zh-TW", {
  cityLabel: "東京",
  country: "JP",
});
assert.match(detailKey, /\|detail\|zh-TW$/);

const { country, city } = inferPlaceCacheLocation({
  cityLabel: "首爾",
  lat: 37.5665,
  lng: 126.978,
});
assert.equal(country, "KR");
assert.equal(city, "首爾");

assert.equal(
  isPlaceDetailsMinimallyCacheable({
    id: "p1",
    name: "Test",
    lat: 1,
    lng: 2,
    address: null,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  }),
  true,
);
assert.equal(
  isPlaceDetailsCacheComplete({
    id: "p1",
    name: "Test",
    lat: 1,
    lng: 2,
    address: null,
    rating: 4.5,
    userRatingCount: 10,
    photoName: "places/x/photos/y",
    primaryType: null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  }),
  true,
);

console.log("verify-explore-map-cache: ok");
