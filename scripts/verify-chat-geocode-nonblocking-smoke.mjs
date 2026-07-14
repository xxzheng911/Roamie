/**
 * Smoke checks for chat submit / geocode / intent / date fixes.
 */
import { parseTravelDateRangeFromText } from "../src/lib/ai/parse-travel-date-range.ts";
import { resolveChatContextIntent } from "../src/lib/ai/chat-context-intent.ts";
import { isGeographicPlaceTypes } from "../src/lib/location/geographic-only.ts";
import {
  clearDestinationGeocodeCache,
  geocodeDestinationWithFallback,
} from "../src/lib/ai/destination-geocode.ts";
import {
  clearResolvedDestinationScope,
  getResolvedDestinationScope,
} from "../src/lib/ai/resolved-destination-scope.ts";
import { listTripDates } from "../src/lib/outfit/group-by-date.ts";
import { isRecommendablePlace } from "../src/lib/is-recommendable-place.ts";

const date = parseTravelDateRangeFromText("9/1～9/4 要去新竹", new Date("2026-07-14T10:00:00"));
if (date.startDate !== "2026-09-01" || date.endDate !== "2026-09-04" || date.days !== 4) {
  console.error("FAIL date range", date);
  process.exit(1);
}
console.log("OK date range", date);

const intent = resolveChatContextIntent("9/1～9/4 要去新竹");
if (intent !== "trip_planning") {
  console.error("FAIL intent", intent);
  process.exit(1);
}
console.log("OK intent", intent);

if (!isGeographicPlaceTypes(["locality", "political", "geocode"])) {
  console.error("FAIL locality+geocode should pass");
  process.exit(1);
}
if (!isGeographicPlaceTypes(["geocode"])) {
  console.error("FAIL geocode-only should pass");
  process.exit(1);
}
if (isGeographicPlaceTypes(["restaurant", "geocode"])) {
  console.error("FAIL restaurant+geocode should reject");
  process.exit(1);
}
console.log("OK geographic type gate");

clearDestinationGeocodeCache();
clearResolvedDestinationScope();
let calls = 0;
const loc = await geocodeDestinationWithFallback({
  destination: "新竹",
  locale: "zh-TW",
  geocodeFn: async () => {
    calls += 1;
    return { location: null, error: "should_not_call" };
  },
});
if (!loc || loc.lat !== 24.8138 || loc.lng !== 120.9675 || calls !== 0) {
  console.error("FAIL approx should short-circuit geocode", loc, calls);
  process.exit(1);
}
const scope = getResolvedDestinationScope("新竹");
if (!scope || scope.source !== "approx_center") {
  console.error("FAIL scope not locked", scope);
  process.exit(1);
}
console.log("OK approx short-circuit + scope lock", scope.source);

const days = listTripDates([], "2026-09-01", 4);
if (JSON.stringify(days) !== JSON.stringify(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"])) {
  console.error("FAIL listTripDates timezone", days);
  process.exit(1);
}
console.log("OK listTripDates", days);

const street = isRecommendablePlace(
  {
    name: "新竹第一街（暗街仔）",
    types: ["point_of_interest", "establishment"],
    rating: 4.3,
    userRatingCount: 120,
  },
  "chat_destination_recommend",
);
if (!street) {
  console.error("FAIL poi+establishment tourist street should not drop as geographic_marker");
  process.exit(1);
}
console.log("OK geographic_marker no longer drops bare PoI");

console.log("\nAll chat/geocode smoke checks passed.");
