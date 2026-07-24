/**
 * verify:destination-state-desync-p0
 *
 * P0: After travel_date_changed reset, city-states (新加坡) must keep a complete
 * ResolvedTripDestination and Combination Discovery Guard must allow discovery.
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import {
  evaluateCombinationDiscoveryGuard,
  hasResolvedDestination,
} from "../src/lib/ai/trip-duration-guard.ts";
import {
  isNewTripPlanning,
  maybeResetForNewTripPlanning,
  resetForDateChange,
  resetForDestinationChange,
} from "../src/lib/ai/trip-planning-session-reset.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import {
  resolveDestinationScopeFields,
  isCountryLevelDestination,
  canDiscoverDestinationPlaces,
} from "../src/lib/ai/destination-scope.ts";
import {
  assertDestinationConsistency,
  resolvePlanningDestination,
} from "../src/lib/ai/resolved-trip-destination.ts";
import {
  setResolvedDestinationScope,
  clearResolvedDestinationScope,
} from "../src/lib/ai/resolved-destination-scope.ts";

let failed = 0;
const logs = [];
const originalInfo = console.info;
console.info = (...args) => {
  const line = args.join(" ");
  logs.push(line);
  originalInfo(...args);
};

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function assertLog(re, message) {
  assert(logs.some((l) => re.test(l)), message);
}

// --- Entity type: city_state (not hardcode-only) ---
for (const label of ["新加坡", "香港", "澳門", "摩納哥", "梵蒂岡"]) {
  const entity = resolveDestinationEntity(label);
  assert(entity.type === "city_state", `${label} entity type=city_state`);
  assert(!isCountryLevelDestination(label), `${label} not country-level`);
  assert(canDiscoverDestinationPlaces(label), `${label} can discover places`);
  const scope = resolveDestinationScopeFields(label);
  assert(scope.destinationType === "city_state", `${label} scope type=city_state`);
  assert(scope.destinationCity === label, `${label} scope city set`);
  assert(scope.destinationCountry === label, `${label} scope country set`);
}

// --- Guard: Singapore with type city_state + coords ---
clearResolvedDestinationScope("新加坡");
setResolvedDestinationScope({
  displayName: "新加坡",
  normalizedName: "新加坡",
  country: "新加坡",
  countryCode: "SG",
  type: "city_state",
  latitude: 1.3521,
  longitude: 103.8198,
  source: "approx_center",
  resolvedAt: Date.now(),
});

const resolvedSg = resolvePlanningDestination({
  destination: "新加坡",
  destinationType: "city_state",
  destinationCity: "新加坡",
  destinationCountry: "新加坡",
});
assert(resolvedSg?.label === "新加坡", "resolved label");
assert(resolvedSg?.type === "city_state", "resolved type city_state");
assert(resolvedSg?.countryCode === "SG", "resolved countryCode SG");
assert(resolvedSg?.scopeLocked === true, "scope locked");
assert(assertDestinationConsistency(resolvedSg).ok, "assertDestinationConsistency ok");

const guardOk = evaluateCombinationDiscoveryGuard({
  destination: "新加坡",
  destinationType: "city_state",
  destinationCity: "新加坡",
  destinationCountry: "新加坡",
  destinationCountryCode: "SG",
  tripDays: 6,
  startDate: "2026-09-05",
  endDate: "2026-09-10",
});
assert(guardOk.hasDestination === true, "guard hasDestination=true");
assert(guardOk.hasValidTripDuration === true, "guard duration ok");
assert(guardOk.allowed === true, "guard allowed");
assert(guardOk.reason === "ok", "guard reason=ok");
assertLog(/\[PLANNING_DESTINATION_SUMMARY\].*countryCode=SG/, "summary log has SG");
assertLog(/\[PLANNING_DESTINATION_SUMMARY\].*hasDestination=true/, "summary hasDestination");

// Legacy bug: destinationType=country must not defeat city_state entity
const legacyTypeCountry = evaluateCombinationDiscoveryGuard({
  destination: "新加坡",
  destinationType: "country", // stale field after old reset
  tripDays: 6,
});
assert(
  hasResolvedDestination({
    destination: "新加坡",
    destinationType: "country",
    tripDays: 6,
  }) === true,
  "stale destinationType=country still resolves via entity/scope SoT",
);
assert(legacyTypeCountry.allowed === true, "stale country type still allowed for city_state");

// Bare country (日本) still blocked
const japan = evaluateCombinationDiscoveryGuard({
  destination: "日本",
  destinationType: "country",
  tripDays: 6,
});
assert(japan.allowed === false, "日本 blocked");
assert(
  japan.reason === "country_level_destination" || japan.reason === "missing_destination",
  "日本 reason is country/missing",
);

// --- Date change reset preserves destination ---
let session = createEmptySession();
session = mergeTravelContext(session, "我9月要去新加坡").session;
assert(
  session.travelContext?.destinationType === "city_state",
  "initial merge sets city_state",
);
assert(session.travelContext?.travelMonth === "9月", "initial merge sets travelMonth");

const dateDetect = isNewTripPlanning(session, "9/5-9/10");
assert(dateDetect.isNew === true, "date change detected as new window");
assert(dateDetect.reason === "travel_date_changed", "reason=travel_date_changed");

// Lock scope like production DESTINATION_SCOPE_LOCKED before date answer.
setResolvedDestinationScope({
  displayName: "新加坡",
  normalizedName: "新加坡",
  country: "新加坡",
  countryCode: "SG",
  type: "city_state",
  latitude: 1.3521,
  longitude: 103.8198,
  source: "approx_center",
  resolvedAt: Date.now(),
});
session = {
  ...session,
  travelContext: {
    ...session.travelContext,
    destination: "新加坡",
    destinationCity: "新加坡",
    destinationCountry: "新加坡",
    destinationType: "city_state",
    destinationCountryCode: "SG",
    destinationCoordinates: { lat: 1.3521, lng: 103.8198 },
    interests: session.travelContext?.interests ?? [],
  },
  tripDestination: {
    placeId: "",
    country: "新加坡",
    city: "新加坡",
    lat: 1.3521,
    lng: 103.8198,
    formattedName: "新加坡",
    displayLabel: "新加坡",
  },
};

const afterDate = resetForDateChange(session, {
  reason: "travel_date_changed",
  incomingDestination: "新加坡",
  userText: "9/5-9/10",
});
assert(afterDate.travelContext?.destination === "新加坡", "date reset keeps destination");
assert(afterDate.travelContext?.destinationCity === "新加坡", "date reset keeps city");
assert(afterDate.travelContext?.destinationCountry === "新加坡", "date reset keeps country");
assert(
  afterDate.travelContext?.destinationType === "city_state",
  "date reset keeps city_state type",
);
assert(
  afterDate.travelContext?.destinationCountryCode === "SG" ||
    resolvePlanningDestination(afterDate.travelContext, afterDate)?.countryCode === "SG",
  "date reset keeps/resolves countryCode",
);
assert(
  !DATE_CLEARED_DEST(afterDate),
  "date reset must not clear destination fields",
);
assert(
  afterDate.travelContext?.conversationState !== "awaiting_days" ||
    afterDate.tripDays == null,
  "with days, conversationState must leave awaiting_days",
);
assert(
  afterDate.travelContext?.days === 6 || afterDate.tripDays === 6,
  "date reset parses 6 days",
);

const guardAfterDate = evaluateCombinationDiscoveryGuard({
  destination: afterDate.travelContext?.destination,
  destinationType: afterDate.travelContext?.destinationType,
  destinationCity: afterDate.travelContext?.destinationCity,
  destinationCountry: afterDate.travelContext?.destinationCountry,
  destinationCountryCode: afterDate.travelContext?.destinationCountryCode,
  destinationCoordinates: afterDate.travelContext?.destinationCoordinates,
  tripDays: afterDate.tripDays,
  days: afterDate.travelContext?.days,
  startDate: afterDate.travelContext?.startDate,
  endDate: afterDate.travelContext?.endDate,
  session: afterDate,
});
assert(guardAfterDate.hasDestination === true, "after date reset hasDestination=true");
assert(guardAfterDate.allowed === true, "after date reset guard allowed");
assertLog(/mode=resetForDateChange/, "resetForDateChange mode logged");
assertLog(
  /\[TRIP_CONTEXT_AFTER_RESET\].*destinationType=city_state/,
  "after reset logs destinationType",
);

// Destination change clears previous destination
const afterDest = resetForDestinationChange(afterDate, {
  reason: "destination_changed",
  incomingDestination: "東京",
  userText: "改去東京",
});
assert(afterDest.travelContext?.destination === "東京", "dest change → 東京");
assertLog(/mode=resetForDestinationChange/, "resetForDestinationChange mode logged");

// Full flow merge: 新加坡 → dates
session = createEmptySession();
session = mergeTravelContext(session, "我9月要去新加坡").session;
const resetBundle = maybeResetForNewTripPlanning(session, "9/5-9/10");
assert(resetBundle.didReset === true, "maybeReset date change");
assert(resetBundle.reason === "travel_date_changed", "maybeReset reason date");
const afterMerge = mergeTravelContext(resetBundle.session, "9/5-9/10");
const finalGuard = evaluateCombinationDiscoveryGuard({
  ...afterMerge.context,
  tripDays: afterMerge.session.tripDays,
  days: afterMerge.context.days,
  session: afterMerge.session,
});
assert(finalGuard.hasDestination === true, "full flow hasDestination");
assert(finalGuard.allowed === true, "full flow allowed");
assert(
  afterMerge.session.travelContext?.conversationState !== "awaiting_days",
  "full flow not stuck awaiting_days",
);

// Tokyo / Seoul still work
for (const city of ["東京", "首爾", "香港"]) {
  const g = evaluateCombinationDiscoveryGuard({
    destination: city,
    tripDays: 4,
  });
  assert(g.hasDestination === true, `${city} hasDestination`);
  assert(g.allowed === true, `${city} allowed`);
}

function DATE_CLEARED_DEST(s) {
  const clearedLog = logs.find(
    (l) => l.includes("[TRIP_CONTEXT_RESET]") && l.includes("resetForDateChange"),
  );
  if (!clearedLog) return true;
  return (
    /cleared=\[[^\]]*destination,/.test(clearedLog) ||
    /cleared=\[[^\]]*destinationCity/.test(clearedLog) ||
    /cleared=\[[^\]]*destinationCountry/.test(clearedLog)
  );
}

console.info = originalInfo;
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nverify-destination-state-desync-p0: all passed");
