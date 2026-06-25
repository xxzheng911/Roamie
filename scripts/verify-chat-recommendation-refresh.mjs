import assert from "node:assert/strict";
import {
  isRefreshRecommendationsRequest,
  shouldRefetchPlaces,
  collectExcludePlaceIds,
} from "../src/lib/ai/chat-recommendation-refresh.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { appendRecommendedPlaceIds } from "../src/lib/place-planning-memory.ts";

assert(isRefreshRecommendationsRequest("提供其他推薦"), "refresh: 提供其他推薦");
assert(isRefreshRecommendationsRequest("還有嗎"), "refresh: 還有嗎");
assert(isRefreshRecommendationsRequest("換一批"), "refresh: 換一批");
assert(!isRefreshRecommendationsRequest("你好"), "refresh: not generic");

const session = {
  ...createEmptySession(),
  recommendedPlaces: [
    { name: "咖啡廳A", placeId: "id-a" },
    { name: "咖啡廳B", placeId: "id-b" },
  ],
  activeChatIntent: "cafe",
  location: { lat: 25.03, lng: 121.56, city: "台北" },
};

assert(
  shouldRefetchPlaces("提供其他推薦", session, { interests: [] }),
  "should refetch with prior recs",
);
assert(
  shouldRefetchPlaces("想室內", session, { interests: [], setting: "室內" }),
  "should refetch on indoor preference",
);

const ids = appendRecommendedPlaceIds(session, [{ name: "咖啡廳C", placeId: "id-c" }]);
assert(ids.includes("id:a"), "accumulate id-a");
assert(ids.includes("id:c"), "accumulate id-c");

const collected = collectExcludePlaceIds(session);
assert(collected.length >= 2, "collect exclude ids");

console.log("verify-chat-recommendation-refresh: ok");
