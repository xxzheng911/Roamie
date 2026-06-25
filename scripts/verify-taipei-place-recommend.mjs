import assert from "node:assert/strict";
import {
  parseDestinationFromText,
  resolveDestinationFromText,
  extractEmbeddedDestinationFromText,
} from "../src/lib/ai/trip-planning-context.ts";
import {
  detectPlaceRecommendationIntent,
  shouldFetchDestinationPlaces,
  resolveMustVisitDestination,
} from "../src/lib/ai/must-visit-places.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { buildCityDaysConfirmedReply } from "../src/lib/ai/city-days-planning.ts";

const text = "我明天要去台北有推薦景點嗎";

assert.equal(parseDestinationFromText(text), "台北");
assert.equal(extractEmbeddedDestinationFromText(text), "台北");
assert.equal(resolveDestinationFromText(text), "台北");
assert.equal(detectPlaceRecommendationIntent(text), true);
assert.equal(shouldFetchDestinationPlaces(text, { interests: [] }), true);
assert.equal(resolveMustVisitDestination({ interests: [] }, text), "台北");

const merged = mergeTravelContext(
  { travelContext: { interests: [] }, phase: "discover" },
  text,
);
assert.equal(merged.context.destination, "台北");
assert.equal(merged.context.startDate?.length, 10);

const route = resolveChatRoute(text, merged.context, merged.session, "zh-TW", "destination_advice");
assert.notEqual(route.mode, "clarify", `expected not clarify, got ${route.mode}`);

const daysReply = buildCityDaysConfirmedReply("台北", 2, "台灣");
assert.doesNotMatch(daysReply.reply, /其實很舒服/);
assert.match(daysReply.reply, /台北/);

console.log("verify-taipei-place-recommend: ok");
