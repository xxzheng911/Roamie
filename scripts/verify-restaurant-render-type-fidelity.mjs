#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  passesRestaurantRenderGuard,
} from "../src/lib/ai/chat-category-place-guard.ts";

const place = (overrides = {}) => ({
  name: "測試地點",
  placeName: "測試地點",
  type: "point_of_interest",
  primaryType: "point_of_interest",
  types: ["point_of_interest"],
  description: "",
  reason: "",
  estimatedTime: "",
  address: "台北市信義區",
  lat: null,
  lng: null,
  googleMapsUrl: "",
  reasonSource: "template",
  googlePlaceId: "ChIJ-test",
  ...overrides,
});

assert.equal(
  passesRestaurantRenderGuard(
    place({ types: ["point_of_interest", "restaurant", "food"] }),
    "餐廳推薦",
  ),
  true,
  "full restaurant types must survive a generic primary type",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ types: ["point_of_interest", "food"] }),
    "餐廳推薦",
  ),
  true,
  "food type evidence must survive recommendation-item mapping",
);
assert.equal(
  passesRestaurantRenderGuard(place(), "餐廳推薦"),
  false,
  "true non-food POI remains rejected",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ primaryType: "museum", types: ["museum", "point_of_interest"] }),
    "餐廳推薦",
  ),
  false,
  "blocked non-food type remains rejected",
);
assert.equal(
  passesRestaurantRenderGuard(place({ googlePlaceId: undefined }), "餐廳推薦"),
  false,
  "canonical Place ID remains required",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ types: ["restaurant", "food"], photoName: null, businessStatus: "CLOSED_TEMPORARILY" }),
    "餐廳推薦",
  ),
  true,
  "image and opening state remain outside the category render guard",
);

console.info("verify-restaurant-render-type-fidelity: ok");
