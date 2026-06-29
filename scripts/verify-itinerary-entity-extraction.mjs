import {
  extractItineraryEntitiesFromText,
  extractItineraryDestinationFromText,
  isCreateItineraryRequest,
  sanitizeDestinationForGeocode,
} from "../src/lib/ai/itinerary-entity-extraction.ts";
import { parseDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import { buildDestinationGeocodeQueries } from "../src/lib/ai/destination-geocode.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { isCreateItineraryIntent } from "../src/lib/ai/chat-context-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const taitungCase = "我下個月想去台東3天2夜 你可以幫我安排嗎";

assert(isCreateItineraryRequest(taitungCase), "台東案例辨識為 CREATE_ITINERARY");
assert(isCreateItineraryIntent(taitungCase), "chat intent = create_itinerary");

const entities = extractItineraryEntitiesFromText(taitungCase);
assert(entities.intent === "CREATE_ITINERARY", "intent=CREATE_ITINERARY");
assert(entities.destination === "台東", `destination=台東 (got ${entities.destination})`);
assert(entities.days === 3, `days=3 (got ${entities.days})`);
assert(entities.nights === 2, `nights=2 (got ${entities.nights})`);
assert(entities.travelMonth === "next_month", "travelMonth=next_month");

assert(
  extractItineraryDestinationFromText(taitungCase) === "台東",
  "extractItineraryDestinationFromText → 台東",
);
assert(parseDestinationFromText(taitungCase) === "台東", "parseDestinationFromText → 台東");
assert(
  sanitizeDestinationForGeocode(taitungCase) === "台東",
  "sanitizeDestinationForGeocode 整句 → 台東",
);

const entity = resolveDestinationEntity("台東");
assert(entity.type === "city", `台東 type=city (got ${entity.type})`);

const geoQueries = buildDestinationGeocodeQueries(taitungCase);
assert(
  !geoQueries.some((q) => q.includes("我下個月")),
  "geocode queries 不含整句噪音",
);
assert(geoQueries.some((q) => q.includes("台東")), "geocode queries 含台東");

const session = createEmptySession();
const merged = mergeTravelContext(session, taitungCase);
assert(merged.context.destination === "台東", "mergeTravelContext destination=台東");
assert(merged.context.days === 3, "mergeTravelContext days=3");

const advice = resolveDestinationAdvice(merged.context, merged.session, taitungCase);
assert(advice.triggerItineraryGeneration === true, "advice triggers itinerary generation");
assert(advice.contextPatch?.destination === "台東", "advice contextPatch destination=台東");
assert(advice.contextPatch?.days === 3, "advice contextPatch days=3");

const noiseRejected = sanitizeDestinationForGeocode("我下個月想去台東");
assert(noiseRejected === "台東", "噪音前綴 label 仍抽出台東");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log("\nAll itinerary entity extraction checks passed.");
