/**
 * Chat / Places request orchestration.
 * Quiet-café shortcut budget, dedupe, stale cancellation, and provider protection.
 */
import assert from "node:assert/strict";
import {
  fetchNearbyPlacesForIntent,
  placesFailureClaimsNoPlaces,
  resetShortcutProviderOrchestrationForTests,
  SHORTCUT_PROVIDER_CALL_BUDGET,
} from "../src/lib/ai/chat-place-recommendation.ts";
import { nearbySearchAttemptsForShortcutScene } from "../src/lib/ai/nearby-shortcut-ranking.ts";
import {
  activatePlacesRateProtection,
  clearPlacesRateProtection,
} from "../src/lib/ai/places-cost-cache/rate-protection.ts";
import {
  beginForegroundPlacesRequest,
  bucketPlacesCoordinate,
  buildPlacesHttpKey,
  evaluatePlacesProviderAdmission,
  FOREGROUND_REQUEST_PROVIDER_BUDGET,
  getPlacesRateWindowCount,
  isPlacesRunawayProtectionActive,
  MAX_FOREGROUND_GRANTS_WHILE_HOT,
  notePlacesWindowCallForTests,
  resetPlacesProviderLimiterForTests,
  runPlacesApiDeduped,
} from "../src/lib/places-api-guard.ts";

const LAT = 25.033;
const LNG = 121.565;

function cafe(id) {
  return {
    id: `cafe-${id}`,
    name: `Quiet Cafe ${id}`,
    address: "Taipei",
    lat: LAT + Number(id) * 0.0004,
    lng: LNG + Number(id) * 0.0004,
    rating: 4.6,
    userRatingCount: 80,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe", "coffee_shop"],
    businessStatus: "OPERATIONAL",
  };
}

function resetAll() {
  resetPlacesProviderLimiterForTests();
  resetShortcutProviderOrchestrationForTests();
  clearPlacesRateProtection();
}

function owner(generationRequestId, priority = "foreground", surface = "chat") {
  return {
    requestId: `places_${generationRequestId}`,
    surface,
    priority,
    requestType: "searchNearby",
    generationRequestId,
    intent: "cafe",
    queryFamily: "nearby:cafe+coffee_shop",
    attempt: 0,
    lane: "nearby_1",
  };
}

async function quietCafe(searchPlaces, extra = {}) {
  return fetchNearbyPlacesForIntent(
    "cafe",
    LAT,
    LNG,
    "en",
    searchPlaces,
    undefined,
    { interests: [] },
    extra.excludePlaceIds ?? [],
    {
      userText: "Find a quiet café",
      shortcutScene: "quiet_cafe",
      diagnosticRequestId: extra.diagnosticRequestId,
      continuationRound: extra.continuationRound ?? 0,
    },
  );
}

resetAll();

const lanes = nearbySearchAttemptsForShortcutScene("quiet_cafe");
assert.equal(lanes.length, 3, "quiet café keeps three semantic lanes");
assert.equal(lanes[0].includedTypes.join(","), "cafe,coffee_shop");
assert.equal(SHORTCUT_PROVIDER_CALL_BUDGET, 4);
assert.equal(FOREGROUND_REQUEST_PROVIDER_BUDGET, 4);
assert.equal(MAX_FOREGROUND_GRANTS_WHILE_HOT, 2);

console.log("\n=== 1. fresh quiet café ===");
resetAll();
{
  let calls = 0;
  const places = await quietCafe(async () => {
    calls += 1;
    return { places: [1, 2, 3, 4, 5, 6].map((id) => cafe(id)) };
  });
  assert.ok(places.length >= 5, `fresh candidates=${places.length}`);
  assert.equal(calls, 1, `fresh provider calls=${calls}`);
}

console.log("\n=== 2. single shortcut stays inside budget ===");
resetAll();
{
  let calls = 0;
  await quietCafe(async () => {
    calls += 1;
    return { places: [cafe(calls)] };
  });
  assert.ok(calls <= SHORTCUT_PROVIDER_CALL_BUDGET, `sparse calls=${calls}`);
  assert.ok(calls >= 1, "sparse search still runs");
}

console.log("\n=== 3. duplicate query is deduped ===");
resetAll();
{
  let calls = 0;
  const search = async () => {
    calls += 1;
    return { places: [1, 2, 3, 4, 5, 6].map((id) => cafe(id)) };
  };
  const [first, second] = await Promise.all([quietCafe(search), quietCafe(search)]);
  assert.equal(calls, 1, `parallel duplicate calls=${calls}`);
  assert.ok(first.length >= 5 && second.length >= 5);
  const before = calls;
  await quietCafe(search);
  assert.equal(calls, before, "sequential duplicate reuses the cached candidate result");
}

console.log("\n=== 4. stale request stops consuming provider calls ===");
resetAll();
beginForegroundPlacesRequest("req-a");
{
  let calls = 0;
  await quietCafe(
    async () => {
      calls += 1;
      beginForegroundPlacesRequest("req-b");
      return { places: [cafe(1)] };
    },
    { diagnosticRequestId: "req-a" },
  );
  assert.equal(calls, 1, `stale follow-up calls=${calls}`);
}

console.log("\n=== 5. fallback expansion is capped ===");
resetAll();
{
  let calls = 0;
  await quietCafe(async () => {
    calls += 1;
    return { places: [cafe(90 + calls)] };
  });
  assert.ok(calls <= SHORTCUT_PROVIDER_CALL_BUDGET, `expansion calls=${calls}`);
  assert.ok(calls < 12, "expansion does not walk every radius lane");
}

console.log("\n=== 6. previous burst does not block the next shortcut ===");
resetAll();
for (let i = 0; i < 20; i += 1) notePlacesWindowCallForTests();
assert.equal(getPlacesRateWindowCount(), 20);
const firstGrant = beginForegroundPlacesRequest("hot-1");
const secondGrant = beginForegroundPlacesRequest("hot-2");
assert.equal(firstGrant.blocked, false);
assert.equal(secondGrant.blocked, false);
assert.equal(secondGrant.windowHot, true);
let admitted = 0;
const admittedResult = await runPlacesApiDeduped(
  "hot-chat-cafe",
  "searchNearby",
  async () => {
    admitted += 1;
    return ["ok"];
  },
  owner("hot-2"),
);
assert.equal(admittedResult?.[0], "ok");
assert.equal(admitted, 1, "new foreground shortcut is admitted while the window is hot");

console.log("\n=== 7. runaway protection still arms ===");
resetAll();
for (let i = 0; i < 20; i += 1) notePlacesWindowCallForTests();
assert.equal(beginForegroundPlacesRequest("run-1").blocked, false);
assert.equal(beginForegroundPlacesRequest("run-2").blocked, false);
const refused = beginForegroundPlacesRequest("run-3");
assert.equal(refused.blocked, true);
assert.equal(refused.blockedReason, "runaway");
assert.equal(isPlacesRunawayProtectionActive(), true);
const blocked = evaluatePlacesProviderAdmission(owner("run-3"));
assert.equal(blocked.admit, false);
assert.equal(blocked.providerProtectionActive, true);
let runawayCalls = 0;
const runawayResult = await runPlacesApiDeduped(
  "runaway-key",
  "searchNearby",
  async () => {
    runawayCalls += 1;
    return ["nope"];
  },
  owner("run-3"),
);
assert.equal(runawayResult, null);
assert.equal(runawayCalls, 0);

console.log("\n=== 8. rate limit does not claim that no places exist ===");
assert.equal(placesFailureClaimsNoPlaces("places_search_failed:places_rate_limited"), false);
assert.equal(placesFailureClaimsNoPlaces("provider_protection"), false);
assert.equal(placesFailureClaimsNoPlaces("places_empty"), true);

console.log("\n=== 9. continuation reuses the candidate pool ===");
resetAll();
{
  let calls = 0;
  const search = async () => {
    calls += 1;
    return { places: [1, 2, 3, 4, 5, 6].map((id) => cafe(id)) };
  };
  await quietCafe(search);
  assert.equal(calls, 1);
  const continued = await quietCafe(search, {
    continuationRound: 1,
    excludePlaceIds: ["cafe-1"],
  });
  assert.equal(calls, 1, "continuation did not refetch the existing pool");
  assert.ok(continued.length >= 5, `continuation candidates=${continued.length}`);
  assert.equal(
    continued.some((place) => place.id === "cafe-1"),
    false,
  );
}

console.log("\n=== 10. Home / Chat share one inflight authority call ===");
resetAll();
{
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runner = () => {
    calls += 1;
    return gate;
  };
  const home = runPlacesApiDeduped(
    "shared-cafe",
    "searchNearby",
    runner,
    owner("home", "background", "home_nearby"),
  );
  const chat = runPlacesApiDeduped("shared-cafe", "searchNearby", runner, owner("chat-shared"));
  release(["shared"]);
  const [homeResult, chatResult] = await Promise.all([home, chat]);
  assert.equal(calls, 1, `shared authority calls=${calls}`);
  assert.deepEqual(homeResult, ["shared"]);
  assert.deepEqual(chatResult, ["shared"]);
  assert.equal(getPlacesRateWindowCount(), 1);
}

console.log("\n=== dedupe key buckets location and keeps locale ===");
assert.equal(bucketPlacesCoordinate(25.03391), bucketPlacesCoordinate(25.03409));
const keyA = buildPlacesHttpKey("nearby", {
  lat: bucketPlacesCoordinate(25.03391),
  lng: bucketPlacesCoordinate(121.56491),
  radius: 1500,
  types: "cafe,coffee_shop",
  language: "en",
});
const keyB = buildPlacesHttpKey("nearby", {
  lat: bucketPlacesCoordinate(25.03409),
  lng: bucketPlacesCoordinate(121.56509),
  radius: 1500,
  types: "cafe,coffee_shop",
  language: "en",
});
const keyLocale = buildPlacesHttpKey("nearby", {
  lat: bucketPlacesCoordinate(25.03391),
  lng: bucketPlacesCoordinate(121.56491),
  radius: 1500,
  types: "cafe,coffee_shop",
  language: "zh-TW",
});
assert.equal(keyA, keyB);
assert.notEqual(keyA, keyLocale);

console.log("\n=== failed provider attempt counts once; deduped join does not ===");
resetAll();
await assert.rejects(
  runPlacesApiDeduped(
    "failed-once",
    "searchText",
    async () => {
      throw new Error("fetch failed");
    },
    owner("fail"),
  ),
);
assert.equal(getPlacesRateWindowCount(), 1);
{
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runner = () => {
    calls += 1;
    return gate;
  };
  const first = runPlacesApiDeduped("dedupe-count", "searchNearby", runner, owner("dedupe"));
  const second = runPlacesApiDeduped("dedupe-count", "searchNearby", runner, owner("dedupe"));
  release(["one"]);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(getPlacesRateWindowCount(), 2);
}

console.log("\n=== explicit provider protection is unchanged ===");
resetAll();
activatePlacesRateProtection({ reason: "PLACES_RATE_LIMIT_BLOCKED", ttlMs: 60_000 });
let protectedCalls = 0;
const protectedResult = await runPlacesApiDeduped(
  "protected",
  "searchNearby",
  async () => {
    protectedCalls += 1;
    return ["x"];
  },
  owner("protected"),
);
assert.equal(protectedResult, null);
assert.equal(protectedCalls, 0);
clearPlacesRateProtection();

console.log("\n[verify:places-request-orchestration] all passed");
