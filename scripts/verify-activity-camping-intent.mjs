import assert from "node:assert/strict";
import {
  isCampingRequestText,
  isCampingPlace,
  filterCampingPlaces,
  buildCampingIntroReply,
  buildCampingRecommendationSummary,
  applyCampingContextFromText,
} from "../src/lib/ai/activity-camping.ts";
import { detectChatIntent, inferNearbyIntentFromContext } from "../src/lib/ai/chat-intent.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";

const campingPhrases = [
  "我想去露營你有推薦的地方嗎",
  "有推薦露營地嗎",
  "想找營區",
  "露營推薦",
];

for (const phrase of campingPhrases) {
  assert.equal(isCampingRequestText(phrase), true, `isCampingRequestText: ${phrase}`);
  assert.equal(detectChatIntent(phrase), "camping", `detectChatIntent: ${phrase}`);
}

const acceptance = "我想去露營你有推薦的地方嗎";
assert.equal(detectChatIntent(acceptance), "camping");
assert.notEqual(detectChatIntent(acceptance), "attraction");

const session = { travelContext: { interests: [] } };
const applied = applyCampingContextFromText(acceptance, session);
assert.equal(applied.activeChatIntent, "camping");
assert.equal(applied.travelContext.activity, "camping");
assert.equal(applied.travelContext.tripPurpose, "recommend_places");

const intro = buildCampingIntroReply({ interests: [], activity: "camping" }, session);
assert.match(intro, /想露營的話/);
assert.doesNotMatch(intro, /依.*今天.*的心情/);
assert.doesNotMatch(intro, /依「今天」的心情/);

const route = resolveChatRoute(acceptance, { interests: [] }, session, "zh-TW", "camping");
assert.equal(route.mode, "advice");
assert.match(route.question ?? "", /想露營的話/);
assert.doesNotMatch(route.question ?? "", /依.*今天.*的心情/);

const inferred = inferNearbyIntentFromContext(
  { interests: ["露營"], activity: "camping" },
  acceptance,
  { ...applied, activeChatIntent: "camping" },
);
assert.equal(inferred, "camping");

assert.equal(isCampingPlace({ name: "愛河", type: "河濱步道" }), false);
assert.equal(isCampingPlace({ name: "某某露營區", type: "campground" }), true);
assert.equal(isCampingPlace({ name: "Sea Glamping", types: ["campground"] }), true);

const filtered = filterCampingPlaces([
  { name: "愛河", type: "河濱步道" },
  { name: "星空露營區", type: "露營區" },
  { name: "城市公園", type: "park" },
]);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].name, "星空露營區");

const summary = buildCampingRecommendationSummary(
  [{ name: "山區露營區" }, { name: "海邊 Glamping" }],
  { interests: [], currentLocation: "高雄" },
);
assert.match(summary, /想露營的話/);
assert.doesNotMatch(summary, /依.*今天.*的心情/);

console.log("verify-activity-camping-intent: ok");
