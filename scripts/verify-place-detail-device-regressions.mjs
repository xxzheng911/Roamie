import assert from "node:assert/strict";
import { recommendationToPlaceSnapshot } from "../src/lib/recommendation-place-handoff.ts";
import {
  handoffToPlaceDetailData,
  resolvePlaceDetailReasonWithSource,
} from "../src/lib/place-detail-resolve.ts";
import { pickToPlaceDetailHandoff } from "../src/lib/place-detail-handoff.ts";
import { resolvePlaceDetailTransportOrigin } from "../src/lib/place-detail-transport-origin.ts";
import { estimateTravelModesLocal } from "../src/lib/estimate-travel-mode.ts";
import { INITIAL_PLACE_TRANSPORT_MODE } from "../src/hooks/use-place-navigation.ts";
import { buildPlaceMapsUrl } from "../src/lib/maps-navigation.ts";
import {
  buildTabelogPlaceSearchQuery,
  resolveTabelogPlaceExternalUrl,
} from "../src/lib/tabelog-reference.ts";
import {
  preparePlaceDetailNearbySession,
  resolvePlaceDetailNearbyIntent,
} from "../src/lib/ai/place-detail-chat.ts";
import {
  buildHomePlusInsight,
  resolveHomePlusCopySource,
} from "../src/lib/home-personalization-insight.ts";
import { HOME_MOOD_MORE_ROUTE } from "../src/lib/home-mood.ts";

function test(name, fn) {
  fn();
  console.info(`✓ ${name}`);
}

const recommendation = {
  name: "測試咖啡店",
  placeName: "測試咖啡店",
  googlePlaceId: "ChIJTestPlace123",
  lat: 25.04,
  lng: 121.56,
  type: "咖啡廳",
  description: "描述",
  reason: "因為你想找安靜的地方，這次推薦保留原始理由。",
  address: "台北市信義區測試路 1 號",
};

test("Explore / Chat recommendation handoff keeps one reason", () => {
  const snapshot = recommendationToPlaceSnapshot(recommendation);
  assert.ok(snapshot);
  const detail = handoffToPlaceDetailData(pickToPlaceDetailHandoff(snapshot));
  assert.equal(snapshot.reason, recommendation.reason);
  assert.equal(detail.reason, recommendation.reason);
  assert.equal(
    resolvePlaceDetailReasonWithSource(pickToPlaceDetailHandoff(snapshot), snapshot).source,
    "recommendation_session",
  );
});

test("metadata fallback contains no fabricated review claim", () => {
  const handoff = {
    placeId: "ChIJMetadata123",
    name: "只有 metadata 的地點",
    address: null,
    lat: 25,
    lng: 121,
    rating: 4.5,
    userRatingCount: 20,
  };
  const resolved = resolvePlaceDetailReasonWithSource(handoff);
  assert.equal(resolved.source, "place_metadata_fallback");
  assert.match(resolved.reason, /Google 評分 4\.5/);
  assert.doesNotMatch(resolved.reason, /服務好|價格合理|氣氛好|不少高分評論|這地點離你很近|先依地點資料/);
});

test("transport origin is live GPS, cached valid location, or unavailable", () => {
  assert.deepEqual(
    resolvePlaceDetailTransportOrigin({
      live: { lat: 22.62, lng: 120.31, usedFallback: false },
      cached: { lat: 25.03, lng: 121.56 },
    }),
    { origin: { lat: 22.62, lng: 120.31 }, source: "live_user_location" },
  );
  assert.equal(
    resolvePlaceDetailTransportOrigin({
      live: { lat: 25.04, lng: 121.56, usedFallback: true },
      cached: { lat: 24.15, lng: 120.67 },
    }).source,
    "cached_user_location",
  );
  assert.deepEqual(resolvePlaceDetailTransportOrigin({}), {
    origin: null,
    source: "unavailable",
  });
});

test("transport starts neutral and taxi has no fabricated exact fare", () => {
  assert.equal(INITIAL_PLACE_TRANSPORT_MODE, null);
  const modes = estimateTravelModesLocal(1700);
  assert.equal(modes.find((mode) => mode.id === "drive")?.label, "開車");
  assert.equal(modes.find((mode) => mode.id === "taxi")?.costLabel, undefined);
});

test("Google Maps CTA prefers Google Place ID", () => {
  const url = new URL(buildPlaceMapsUrl(35.68, 139.76, "Sushi Dai", "ChIJGoogle123"));
  assert.equal(url.searchParams.get("query"), "Sushi Dai");
  assert.equal(url.searchParams.get("query_place_id"), "ChIJGoogle123");
});

test("Tabelog fallback query contains restaurant identity and locality", () => {
  const options = {
    cityLabel: "東京",
    address: "日本、〒104-0045 東京都中央区築地5丁目2-1",
    place: { name: "Sushi Dai", primaryType: "restaurant", types: ["restaurant"] },
  };
  const query = buildTabelogPlaceSearchQuery({ ...options, placeName: options.place.name });
  assert.match(query, /Sushi Dai/);
  assert.match(query, /東京|中央区/);
  const url = resolveTabelogPlaceExternalUrl(options);
  assert.ok(url);
  assert.notEqual(new URL(url).searchParams.get("sk"), "東京");
});

test("place-context nearby request retains anchor and executes nearby intent contract", () => {
  const focus = {
    name: "凹子底森林公園",
    displayName: "凹子底森林公園",
    placeName: "凹子底森林公園",
    googlePlaceId: "ChIJAnchor123",
    lat: 22.657,
    lng: 120.299,
  };
  const session = {
    placeDetailFocus: focus,
    recommendedPlaces: [],
    phase: "followup",
    conversationMode: "place_focus",
  };
  const intent = resolvePlaceDetailNearbyIntent("找附近咖啡");
  assert.equal(intent, "cafe");
  const next = preparePlaceDetailNearbySession(session, intent);
  assert.equal(next.placeDetailFocus.googlePlaceId, focus.googlePlaceId);
  assert.deepEqual(next.location, { lat: focus.lat, lng: focus.lng, city: undefined });
  assert.equal(next.activeChatIntent, "cafe");
  assert.equal(next.phase, "recommend");
});

test("Plus copy uses only supplied profile and recent intent evidence", () => {
  const input = {
    savedPlaces: [],
    prefs: { pace: "slow", vibe: "quiet", interests: ["咖啡廳", "散步"], avoid: ["排太滿"] },
    chatSession: { lastUserIntent: "今天想放鬆走走" },
  };
  const copy = buildHomePlusInsight(input);
  assert.equal(resolveHomePlusCopySource(input), "combined");
  assert.match(copy, /今天想放鬆走走/);
  assert.match(copy, /咖啡廳|散步/);
  assert.match(copy, /排太滿/);
  assert.doesNotMatch(copy, /價格合理|服務很好/);
});

test("Home mood more route targets Explore", () => {
  assert.equal(HOME_MOOD_MORE_ROUTE, "/map");
});

console.info("\nPlace detail device regressions passed.");
