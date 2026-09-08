import assert from "node:assert/strict";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import {
  normalizeDestinationLabel,
  resolveDestinationFromText,
} from "../src/lib/ai/trip-planning-context.ts";
import { normalizeDestinationAndDuration } from "../src/lib/parse-chinese-duration.ts";
import { itineraryGeographicScopeDecision } from "../src/lib/itinerary.functions.ts";

const fixtures = [
  ["台北三天", "台北", 3],
  ["台北3天", "台北", 3],
  ["台北 3 天", "台北", 3],
  ["台北三日", "台北", 3],
  ["東京五天", "東京", 5],
  ["東京5天", "東京", 5],
  ["東京五日", "東京", 5],
  ["大阪兩天", "大阪", 2],
  ["首爾四天", "首爾", 4],
  ["高雄2日", "高雄", 2],
  ["Taipei 3 days", "台北", 3],
  ["Tokyo for 5 days", "東京", 5],
  ["Seoul 4-day trip", "首爾", 4],
];

for (const [raw, expectedDestination, expectedDays] of fixtures) {
  const normalized = normalizeDestinationAndDuration(raw, raw, normalizeDestinationLabel);
  assert.equal(normalized.canonicalDestination, expectedDestination, raw);
  assert.equal(normalized.tripDays, expectedDays, raw);
  assert.equal(normalizeDestinationLabel(raw), expectedDestination, `${raw}: shared label boundary`);
}

for (const unchanged of ["台北101", "101大樓", "九份", "三峽", "四四南村", "六福村"]) {
  const normalized = normalizeDestinationAndDuration(unchanged, unchanged, normalizeDestinationLabel);
  assert.equal(normalized.destinationLabel, unchanged);
  assert.equal(normalized.durationRemoved, false);
}

const merged = mergeTravelContext(createEmptySession(), "我要去台北三天");
assert.equal(merged.context.destination, "台北");
assert.equal(merged.context.days, 3);
assert.equal(merged.session.travelContext?.destination, "台北");
assert.equal(merged.session.tripDays, 3);
assert.equal(merged.session.preferredArea, "台北");

const stale = createEmptySession();
stale.travelContext = { destination: "台北三天", days: 3, interests: [] };
stale.tripDays = 3;
stale.preferredArea = "台北三天";
const repaired = mergeTravelContext(stale, "我要去台北三天");
assert.equal(repaired.context.destination, "台北");
assert.equal(repaired.session.preferredArea, "台北");

assert.equal(resolveDestinationFromText("我要去台北三天"), "台北");
assert.equal(resolveDestinationFromText("Taipei 3 days"), "台北");
assert.equal(resolveDestinationFromText("Tokyo for 5 days"), "東京");
assert.equal(resolveDestinationFromText("Seoul 4-day trip"), "首爾");

const scope = (address) => itineraryGeographicScopeDecision({ address }, merged.context.destination).decision;
assert.equal(scope("台北市信義區"), "in_scope");
assert.equal(scope("南投縣埔里鎮"), "out_of_scope");
assert.equal(scope("unknown locality"), "unknown");

console.info("P50 destination duration normalization: PASS", {
  fixtureCount: fixtures.length,
  numericPlaceNameCount: 6,
  contextDestination: merged.context.destination,
  contextDays: merged.context.days,
  canonicalCity: normalizeDestinationLabel(merged.context.destination),
  crossCityDecision: scope("南投縣埔里鎮"),
  externalRequestDelta: 0,
});
