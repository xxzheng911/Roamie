import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPlaceFocusExcludePlaceIds,
  commitPlaceFocusShownIds,
  enterPlaceDetailChat,
  preparePlaceDetailNearbySession,
  resolvePlaceDetailNearbyIntent,
  resolvePlaceFocusNearbyResult,
  buildPlaceDetailFollowUpReply,
} from "../src/lib/ai/place-detail-chat.ts";
import { isPlaceOperationalForRecommendation } from "../src/lib/place-operational-eligibility.ts";

const place = (id, name, lat = 22.6, lng = 120.3) => ({
  id,
  placeId: id,
  googlePlaceId: id,
  name,
  displayName: name,
  placeName: name,
  type: "restaurant",
  address: "測試地址",
  lat,
  lng,
  estimatedTime: "60 分鐘",
  description: "",
});

const baseSession = {
  selectedPlaces: [],
  plannedStops: [],
  recommendedPlaces: [place("old-rec", "舊推薦")],
  recommendedPlaceIds: ["old-rec"],
  usedPlaceIds: ["old-used"],
  rejectedPlaceNames: ["舊拒絕"],
  recommendationSession: { geographicScope: { entityType: "district", label: "舊行政區" } },
  activeRecommendationContext: { destinationName: "舊範圍" },
  conversationMode: "nearby_explore",
  phase: "followup",
  updatedAt: new Date().toISOString(),
};

test("new Detail handoff replaces focus and clears unrelated transient recommendation state", () => {
  const a = place("ChIJ-A", "地點 A");
  const b = place("ChIJ-B", "地點 B");
  const next = enterPlaceDetailChat({ ...baseSession, placeDetailFocus: a }, b);
  assert.equal(next.placeDetailFocus.googlePlaceId, "ChIJ-B");
  assert.equal(next.conversationMode, "place_focus");
  assert.equal(next.placeDetailFocus.lat, b.lat);
  assert.equal(next.recommendationSession, undefined);
  assert.equal(next.activeRecommendationContext, undefined);
  assert.deepEqual(next.recommendedPlaces, []);
  assert.equal(next.rejectedPlaceNames, undefined);
});

test("restaurant intent and acknowledgement retain explicit restaurant authority", () => {
  assert.equal(resolvePlaceDetailNearbyIntent("找附近餐廳"), "restaurant");
  const session = preparePlaceDetailNearbySession(
    enterPlaceDetailChat(baseSession, place("ChIJ-anchor", "中心地點")),
    "restaurant",
  );
  const reply = buildPlaceDetailFollowUpReply("nearby_late_snack", session);
  assert.match(reply, /附近餐廳/);
  assert.doesNotMatch(reply, /宵夜|小吃/);
});

test("initial exclusions are scoped and continuation only adds current shown IDs", () => {
  const anchor = place("ChIJ-anchor", "中心地點");
  const selected = place("ChIJ-selected", "已選地點");
  let session = enterPlaceDetailChat(
    { ...baseSession, selectedPlaces: [selected], plannedStops: [] },
    anchor,
  );
  session = preparePlaceDetailNearbySession(session, "restaurant");
  const initial = collectPlaceFocusExcludePlaceIds(session);
  assert.deepEqual(new Set(initial), new Set(["ChIJ-anchor", "ChIJ-selected"]));
  assert.equal(initial.includes("old-rec"), false);
  session = commitPlaceFocusShownIds(session, "restaurant", ["ChIJ-r1", "ChIJ-r2"]);
  const continuation = collectPlaceFocusExcludePlaceIds(session);
  assert.ok(continuation.includes("ChIJ-r1"));
  assert.ok(continuation.includes("ChIJ-r2"));
});

test("anchor/category changes create new scope and clear prior shown IDs", () => {
  let session = preparePlaceDetailNearbySession(
    enterPlaceDetailChat(baseSession, place("ChIJ-A", "A")),
    "restaurant",
  );
  session = commitPlaceFocusShownIds(session, "restaurant", ["ChIJ-r1"]);
  const restaurantScope = session.placeFocusRecommendationScope.scopeId;
  const cafe = preparePlaceDetailNearbySession(session, "cafe");
  assert.notEqual(cafe.placeFocusRecommendationScope.scopeId, restaurantScope);
  assert.deepEqual(cafe.placeFocusRecommendationScope.shownPlaceIds, []);
  const newAnchor = enterPlaceDetailChat(cafe, place("ChIJ-B", "B"));
  assert.notEqual(newAnchor.placeFocusRecommendationScope.scopeId, cafe.placeFocusRecommendationScope.scopeId);
});

test("P12 status contract remains intact", () => {
  assert.equal(isPlaceOperationalForRecommendation({ businessStatus: "CLOSED_TEMPORARILY" }), false);
  assert.equal(isPlaceOperationalForRecommendation({ businessStatus: "CLOSED_PERMANENTLY" }), false);
  assert.equal(isPlaceOperationalForRecommendation({}), true);
});

test("structured result distinguishes provider, raw-zero, dedupe and success", () => {
  const counts = {
    rawCount: 3,
    operationalCount: 3,
    geographicCount: 3,
    preDedupeCount: 3,
    dedupedCount: 0,
    finalCount: 0,
  };
  assert.equal(resolvePlaceFocusNearbyResult(false, { reason: "provider_zero" }).failureReason, "provider_error");
  assert.equal(resolvePlaceFocusNearbyResult(false, { reason: "no_candidates" }).failureReason, "raw_zero");
  assert.equal(resolvePlaceFocusNearbyResult(false, { reason: "no_candidates", placeFocusDiagnostics: counts }).failureReason, "deduped_exhausted");
  assert.equal(resolvePlaceFocusNearbyResult(true, { finalCount: 2, placeFocusDiagnostics: { ...counts, dedupedCount: 2, finalCount: 2 } }).applied, true);
});
