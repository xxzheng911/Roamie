import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";
import {
  homeNearbyHardExclusionReason,
  passesHomeNearbyHardExclusions,
  passesHomeNearbyLevel4,
} from "../src/lib/home-nearby-eligibility.ts";
import { logHomeNearbyOperationalDiagnostic } from "../src/lib/home-nearby-log.ts";

const restaurant = (id = "ChIJ-restaurant") => ({
  name: "測試餐廳",
  type: "restaurant",
  primaryType: "restaurant",
  types: ["restaurant", "food"],
  description: "",
  reason: "",
  estimatedTime: "",
  address: "",
  lat: 22.6,
  lng: 120.3,
  googleMapsUrl: "",
  placeName: "測試餐廳",
  googlePlaceId: id,
  reasonSource: "template",
});

const place = (overrides = {}) => ({
  id: "ChIJ-home",
  name: "測試餐廳",
  businessStatus: "OPERATIONAL",
  openStatus: "closed_now",
  rating: 4.3,
  userRatingCount: 30,
  primaryType: "restaurant",
  types: ["restaurant"],
  lat: 22.6,
  lng: 120.3,
  ...overrides,
});

test("place-focus restaurant authority wins over stale quiet_cafe mood state", () => {
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args);
  try {
    const cards = recommendationsForChatDisplay({
      conversationMode: "place_focus",
      placeDetailFocus: { googlePlaceId: "ChIJ-anchor", name: "中心" },
      placeFocusRecommendationScope: {
        scopeId: "scope",
        anchorPlaceId: "ChIJ-anchor",
        requestedCategory: "restaurant",
        shownPlaceIds: [],
      },
      fromMoodFlow: true,
      homeMoodShortcutEntry: "quiet_cafe",
      shortcutContext: { scene: "quiet_cafe" },
      activeChatIntent: "restaurant",
      selectedPlaces: [],
      plannedStops: [],
      recommendedPlaces: [],
      updatedAt: new Date().toISOString(),
    }, "找附近餐廳", [restaurant()]);
    assert.equal(cards.length, 1);
    assert.ok(logs.some(([tag, payload]) =>
      tag === "[PLACE_FOCUS_DISPLAY_FILTER_STAGE]" &&
      payload.appliedPolicy === "place_focus_category_authority" &&
      payload.outputCount === 1));
  } finally {
    console.info = original;
  }
});

test("ordinary Home quiet_cafe fidelity remains active", () => {
  const cards = recommendationsForChatDisplay({
    fromMoodFlow: true,
    homeMoodShortcutEntry: "quiet_cafe",
    activeChatIntent: "cafe",
    selectedPlaces: [],
    plannedStops: [],
    recommendedPlaces: [],
    updatedAt: new Date().toISOString(),
  }, "想找安靜咖啡廳", [restaurant()]);
  assert.equal(cards.length, 0);
});

test("permanent/temporary close are hard exclusions, closed_now and unknown are not", () => {
  assert.equal(homeNearbyHardExclusionReason(place({ businessStatus: "CLOSED_PERMANENTLY" })), "permanently_closed");
  assert.equal(homeNearbyHardExclusionReason(place({ businessStatus: "CLOSED_TEMPORARILY" })), "temporarily_closed");
  assert.equal(passesHomeNearbyHardExclusions(place()), true);
  assert.equal(passesHomeNearbyLevel4(place(), "late_night"), true);
  assert.equal(passesHomeNearbyHardExclusions(place({ businessStatus: null, openStatus: "unknown" })), true);
});

test("Home operational diagnostic exposes status authority without address or coordinates", () => {
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args);
  try {
    logHomeNearbyOperationalDiagnostic({
      canonicalPlaceId: "ChIJ-home",
      businessStatus: "OPERATIONAL",
      openStatus: "closed_now",
      statusSource: "businessStatus",
      cacheCapability: "search_v1",
      cacheAgeBucket: "current_home_load",
      operationalEligible: true,
      currentOpenEligible: false,
      factualSource: "search",
    });
    const payload = logs[0][1];
    assert.equal(logs[0][0], "[HOME_NEARBY_OPERATIONAL_DIAGNOSTIC]");
    assert.equal(payload.currentOpenEligible, false);
    assert.equal("address" in payload, false);
    assert.equal("lat" in payload, false);
  } finally {
    console.info = original;
  }
});

test("place-focus suppresses stale shortcut and limiter policy remains 20/min concurrent 2", () => {
  const recommendationSource = readFileSync(new URL("../src/lib/ai/chat-place-recommendation.ts", import.meta.url), "utf8");
  const limiterSource = readFileSync(new URL("../src/lib/places-api-guard.ts", import.meta.url), "utf8");
  assert.match(recommendationSource, /const shortcutScene = opts\?\.placeDetailNearby\s*\? null/);
  assert.match(recommendationSource, /const shortcut = params\.placeDetailNearby \|\| params\.searchProfile/);
  assert.match(limiterSource, /const RATE_MAX_CALLS = 20/);
  assert.match(limiterSource, /const MAX_CONCURRENT = 2/);
  assert.match(limiterSource, /const MAX_RETRIES = 2/);
  assert.match(limiterSource, /\[PLACES_REQUEST_OWNER\]/);
  assert.match(limiterSource, /\[PLACES_RATE_LIMIT_STATE\]/);
});
