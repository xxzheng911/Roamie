import assert from "node:assert/strict";
import fs from "node:fs";
import {
  beginExploreRequestSession,
  canRunExploreBrowse,
  shouldRefreshExploreFromMap,
  markExplorePrimaryResult,
  EXPLORE_BROWSE_PROVIDER_BUDGET,
  EXPLORE_SEARCH_DEBOUNCE_MS,
} from "../src/lib/explore-request-session";
import {
  runPlacesApiDeduped,
  resetPlacesProviderLimiterForTests,
  getPlacesCallLedger,
  getPlacesRateWindowCount,
  notePlacesWindowCallForTests,
} from "../src/lib/places-api-guard";
import {
  clearPlacesRateProtection,
  clearPlacesQueryCooldown,
} from "../src/lib/ai/places-cost-cache";
import {
  executeExploreSearch,
  fetchPlaceDetailsForScreenWithKey,
} from "../src/lib/places.functions";
import { searchExploreCategoryPlaces } from "../src/lib/explore-category-search";
import { EXPLORE_CATEGORIES } from "../src/lib/places-search-config";
import { exploreSearchPresentation } from "../src/lib/explore-search-presentation";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 5));
const until = async (fn) => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await tick();
  }
  throw Error("fixture did not settle");
};
const reset = () => {
  resetPlacesProviderLimiterForTests();
  clearPlacesRateProtection();
  clearPlacesQueryCooldown();
};
const owner = (session, category = "sight") => ({
  requestId: session.id,
  surface: "explore",
  priority: session.mode === "search" ? "foreground" : "background",
  requestType: "searchText",
  generationRequestId: session.mode === "search" ? session.id : undefined,
  exploreSession: session,
  category,
});
const raw = {
  id: "ChIJ_NSeoulTowerFixture",
  displayName: { text: "남산서울타워" },
  location: { latitude: 37.5512, longitude: 126.9882 },
  formattedAddress: "Seoul",
  types: ["tourist_attraction", "point_of_interest"],
  primaryType: "tourist_attraction",
  rating: 4.7,
  userRatingCount: 1000,
  businessStatus: "OPERATIONAL",
};
const searchData = (session, query = "首爾塔") => ({
  query,
  lat: 25.03,
  lng: 121.56,
  radius: 5000,
  mode: "text",
  locale: "zh-TW",
  placesScreen: "explore",
  placesCaller: "map.freeTextSearch",
  placesExploreSessionId: session.id,
  skipLocationBias: true,
  searchMode: "destination",
});
const originalFetch = globalThis.fetch;
try {
  // 1: actual category entry rejects explicit search before any provider callback.
  reset();
  let session = beginExploreRequestSession("search", "首爾塔");
  let hydrationCalls = 0;
  const ctx = {
    userLocation: { lat: 37.55, lng: 126.98 },
    locale: "zh-TW",
    weather: null,
    reasonProfile: null,
    saved: [],
    recommendMode: "city",
    cityLabel: "首爾",
    requestSession: session,
    searchPlacesFn: async () => {
      hydrationCalls++;
      return { places: [], error: null };
    },
  };
  assert.deepEqual(await searchExploreCategoryPlaces(EXPLORE_CATEGORIES[0], ctx), []);
  assert.equal(hydrationCalls, 0);
  assert.equal(canRunExploreBrowse("首爾塔", false), false);

  // 2, 14: a burst queued while cold must reserve foreground capacity at dispatch.
  reset();
  let actual = 0;
  let active = 0;
  let maxActive = 0;
  const bg = {
    requestId: "background",
    surface: "home_nearby",
    priority: "background",
    requestType: "searchNearby",
  };
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      runPlacesApiDeduped(
        "burst-" + i,
        "nearby",
        async () => {
          actual++;
          active++;
          maxActive = Math.max(maxActive, active);
          await tick();
          active--;
          return i;
        },
        bg,
      ),
    ),
  );
  assert.equal(actual, 16, "background cannot fill all 20 shared slots or overshoot by queuing");
  assert.equal(maxActive, 1);
  session = beginExploreRequestSession("search", "首爾塔");
  let foreground = 0;
  assert.equal(
    await runPlacesApiDeduped(
      "reserved-foreground",
      "text",
      async () => ++foreground,
      owner(session),
    ),
    1,
  );
  assert.equal(session.blockedRequests, 0);
  assert.equal(getPlacesRateWindowCount(), 17);

  // Existing hot-window grant remains bounded and available to explicit Explore.
  reset();
  for (let i = 0; i < 25; i++) notePlacesWindowCallForTests();
  session = beginExploreRequestSession("search", "首爾塔");
  assert.equal(
    await runPlacesApiDeduped("hot-explore", "text", async () => true, owner(session)),
    true,
  );
  assert.equal(session.blockedRequests, 0);

  // 3, 4: programmatic center changes never authorize browse refresh.
  assert.equal(shouldRefreshExploreFromMap("searchSelection", ""), false);
  assert.equal(shouldRefreshExploreFromMap("userGesture", ""), true);
  assert.equal(shouldRefreshExploreFromMap("userGesture", "首爾塔"), false);

  // 5: identical pending provider requests share one runner.
  reset();
  session = beginExploreRequestSession("search", "dedupe");
  const held = deferred();
  let duplicateCalls = 0;
  const first = runPlacesApiDeduped(
    "identical",
    "text",
    async () => {
      duplicateCalls++;
      return held.promise;
    },
    owner(session),
  );
  const second = runPlacesApiDeduped(
    "identical",
    "text",
    async () => {
      duplicateCalls++;
      return held.promise;
    },
    owner(session),
  );
  await until(() => duplicateCalls === 1);
  held.resolve("same");
  assert.deepEqual(await Promise.all([first, second]), ["same", "same"]);
  assert.equal(duplicateCalls, 1);
  assert.equal(session.dedupedRequests, 1);

  // 6: new session aborts a running request and all stale queued background work.
  reset();
  const old = beginExploreRequestSession("browse");
  let started = 0;
  const slow = runPlacesApiDeduped(
    "slow-background",
    "text",
    (signal) =>
      new Promise((_, reject) => {
        started++;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      }),
    owner(old),
  );
  const queued = runPlacesApiDeduped(
    "queued-background",
    "text",
    async () => {
      started++;
      return true;
    },
    owner(old),
  );
  await until(() => started === 1);
  session = beginExploreRequestSession("search", "B");
  assert.deepEqual(await Promise.all([slow, queued]), [null, null]);
  assert.equal(started, 1);
  assert.equal(old.abortedRequests, 2, "running and queued stale work is accounted once");
  assert.equal(
    await runPlacesApiDeduped("current-B", "text", async () => true, owner(session)),
    true,
  );

  // 7, 8: primary commits independently of delayed/failed enrichment.
  const primary = { id: raw.id };
  const state = {
    primary,
    recommendations: [],
    primarySearchLoading: false,
    backgroundRecommendationLoading: true,
  };
  assert.deepEqual(exploreSearchPresentation(state).places, [primary]);
  assert.equal(exploreSearchPresentation(state).fullLoading, false);
  state.backgroundRecommendationLoading = false;
  assert.deepEqual(exploreSearchPresentation(state).places, [primary]);

  // 9, 10: browse resumes, all categories run serially with a shared provider cap.
  reset();
  session = beginExploreRequestSession("browse");
  let browseCalls = 0;
  active = 0;
  maxActive = 0;
  await searchExploreCategoryPlaces(EXPLORE_CATEGORIES[0], {
    ...ctx,
    requestSession: session,
    userLocation: { lat: 37.56, lng: 126.99 },
    searchPlacesFn: async ({ data }) => {
      const result = await runPlacesApiDeduped(
        "browse:" + data.mode + ":" + data.query + ":" + data.includedTypes?.join(","),
        "text",
        async () => {
          browseCalls++;
          active++;
          maxActive = Math.max(maxActive, active);
          await tick();
          active--;
          return [];
        },
        owner(session, data.categoryId),
      );
      return { places: result ?? [], error: null };
    },
  });
  assert.ok(browseCalls > 0);
  assert.ok(browseCalls <= EXPLORE_BROWSE_PROVIDER_BUDGET);
  assert.equal(maxActive, 1);

  // 11: real screen_v1 cache entry, canonical ID variants, cold concurrent miss.
  reset();
  session = beginExploreRequestSession("search", "detail");
  let detailCalls = 0;
  const detailResponse = deferred();
  globalThis.fetch = async () => {
    detailCalls++;
    await detailResponse.promise;
    return Response.json(raw);
  };
  const a = fetchPlaceDetailsForScreenWithKey(raw.id, "fixture-key", "zh-TW", undefined, {
    requestOwner: { ...owner(session), requestType: "details" },
  });
  const b = fetchPlaceDetailsForScreenWithKey(
    " places/" + raw.id + " ",
    "fixture-key",
    "zh-TW",
    undefined,
    { requestOwner: { ...owner(session), requestType: "details" } },
  );
  await until(() => detailCalls === 1);
  detailResponse.resolve();
  const details = await Promise.all([a, b]);
  assert.equal(details[0]?.id, raw.id);
  assert.equal(details[1]?.id, raw.id);
  assert.equal(detailCalls, 1);
  await fetchPlaceDetailsForScreenWithKey(raw.id, "fixture-key", "zh-TW");
  assert.equal(detailCalls, 1, "screen cache reuses same locale/capability");

  // Actual Places HTTP boundary: explicit Seoul Tower produces one Text Search, no hydration.
  reset();
  session = beginExploreRequestSession("search", "首爾塔");
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /places:searchText/);
    providerCalls++;
    return Response.json({ places: [raw] });
  };
  const response = await executeExploreSearch(searchData(session), { apiKey: "fixture-key" });
  assert.equal(response.places[0]?.id, raw.id);
  markExplorePrimaryResult(session);
  assert.deepEqual(
    {
      foreground: session.foregroundRequests,
      background: session.backgroundRequests,
      blocked: session.blockedRequests,
      total: session.totalRequestsBeforePrimary,
    },
    { foreground: 1, background: 0, blocked: 0, total: 1 },
  );
  assert.equal(providerCalls, 1);

  // 12, 13: route uses a cancellable typing debounce, explicit submit dispatches immediately.
  const route = fs.readFileSync("src/routes/_app.map.tsx", "utf8");
  const map = fs.readFileSync("src/components/GoogleMap.tsx", "utf8");
  assert.equal(EXPLORE_SEARCH_DEBOUNCE_MS, 320);
  assert.match(route, /window.clearTimeout\(handle\)/);
  assert.match(route, /\}, EXPLORE_SEARCH_DEBOUNCE_MS\)/);
  assert.doesNotMatch(route, /resolveExploreMapSuggestionsToCards/);
  assert.match(route, /pendingImmediateSearchRef.current = true/);
  assert.match(route, /pendingImmediateSearchRef.current \? 0/);
  assert.match(route, /canRunExploreBrowse\(query,/);
  assert.match(map, /addListener\("dragend"/);
  assert.doesNotMatch(map, /addListener\("(?:center_changed|idle)"/);
  assert.match(route, /placesExploreSessionId: session.id/);
  assert.ok(getPlacesCallLedger().some((e) => e.counted && e.surface === "explore"));
  console.log(
    "PASS: 14 Explore storm/authority scenarios; actual Seoul Tower provider fixture: foreground=1 background=0 duplicate=0 blocked=0 beforePrimary=1",
  );
} finally {
  globalThis.fetch = originalFetch;
}
