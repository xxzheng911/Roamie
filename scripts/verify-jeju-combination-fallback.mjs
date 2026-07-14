/**
 * Verify Jeju / island combination discovery does not hard-fail without Places.
 */
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import {
  buildDestinationGeocodeQueries,
  resolveDestinationApproxCenter,
} from "../src/lib/ai/destination-geocode.ts";
import {
  getDestinationCombinations,
  hasDestinationCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  canDiscoverDestinationPlaces,
  resolveDestinationScopeFields,
} from "../src/lib/ai/destination-scope.ts";
import { resolveDestinationSearchAreas } from "../src/lib/ai/destination-combination-discovery.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

assert(resolveDestinationEntity("濟州").type === "island", "濟州 entity type=island");
assert(resolveDestinationEntity("濟州島").type === "island", "濟州島 entity type=island");
assert(canDiscoverDestinationPlaces("濟州"), "can discover Places for 濟州");
assert(Boolean(resolveDestinationApproxCenter("濟州")), "濟州 has approx center");

const queries = buildDestinationGeocodeQueries("濟州");
assert(queries.some((q) => /Jeju/i.test(q)), "geocode queries include Jeju");
assert(queries.some((q) => /濟州島/.test(q)), "geocode queries include 濟州島");
assert(queries.length >= 5, `geocode expansion has ≥5 queries (got ${queries.length})`);

const areas = resolveDestinationSearchAreas("濟州");
assert(areas.some((a) => /濟州島|Jeju/i.test(a)), "search areas expand beyond 濟州市/縣");

assert(hasDestinationCombinations("濟州"), "濟州 has combinations available");
const combos = getDestinationCombinations("濟州");
assert(combos.length >= 3, `濟州 local/curated combos ≥3 (got ${combos.length})`);

const scope = resolveDestinationScopeFields("濟州", "韓國");
assert(scope.destinationType === "island", "scope type=island");
assert(scope.destinationCountry === "韓國", "scope country=韓國");

// Full flow: month→country→island→days should offer combinations (not places failure)
{
  let session = createEmptySession();
  session = {
    ...session,
    conversationMode: "destination_planning",
    activeChatIntent: "destination_advice",
    travelContext: {
      interests: [],
      destination: "濟州",
      destinationCountry: "韓國",
      destinationType: "island",
      destinationRegion: "濟州",
      travelMonth: "10",
      suggestedStartDate: "2026-10-15",
    },
    pendingQuestion: {
      type: "ask_days",
      options: [],
      baseDestination: "濟州",
      destinationCountry: "韓國",
    },
  };
  const merged = mergeTravelContext(session, "6天");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "6天");
  assert(Boolean(advice.reply), "Jeju+6d has reply");
  assert(!/無法取得濟州的景點/.test(advice.reply ?? ""), "no Jeju places failure message");
  assert(/組合/.test(advice.reply ?? ""), "Jeju+6d shows combinations");
  assert(advice.pendingQuestion?.type === "combination_choice", "pending=combination_choice");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nJeju combination discovery checks passed");
