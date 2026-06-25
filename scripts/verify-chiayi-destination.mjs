import { parseDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";
import {
  detectPlaceRecommendationIntent,
  shouldFetchDestinationPlaces,
  resolveMustVisitDestination,
} from "../src/lib/ai/must-visit-places.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-intent.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";

const text = "我明天要去嘉義 你有推薦地點嗎";
console.log("text:", text);
console.log("parseDestinationFromText:", parseDestinationFromText(text));
console.log("detectPlaceRecommendationIntent:", detectPlaceRecommendationIntent(text));
console.log("resolveMustVisitDestination:", resolveMustVisitDestination({ interests: [] }, text));
console.log("shouldFetchDestinationPlaces:", shouldFetchDestinationPlaces(text, { interests: [] }));

const merged = mergeTravelContext(createEmptySession(), text);
const intent = resolveChatIntent(text);
const route = resolveChatRoute(text, merged.context, merged.session, "zh-TW", intent);
console.log("intent:", intent);
console.log("route.mode:", route.mode);
console.log("route.question:", route.question);
console.log("merged.context.destination:", merged.context.destination);
