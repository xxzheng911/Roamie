// Mock provider + fake timers. No real Google calls.
import assert from "node:assert/strict";
import { loadHomeNearbyPicks } from "../src/lib/home-nearby-search.ts";

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${label}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

const GUARD_503 = 'places_http_503:{"error":"google_unavailable"}';
const homeCtx = (searchPlacesFn) => ({
  userLocation: { lat: 25.033, lng: 121.565 }, weather: null, locale: "zh-TW", reasonProfile: null,
  saved: [], searchPlacesFn, locationKey: "25.03,121.57", at: new Date("2026-10-13T03:00:00Z"), timeZone: "Asia/Taipei",
});

// Loader: the first provider failure must survive later cooldown skips.
await check("L1 loader keeps the original 503 after later cooldown_skipped waves", async () => {
  let calls = 0;
  const search = async () => ({ places: [], error: ++calls === 1 ? GUARD_503 : "cooldown_skipped" });
  await assert.rejects(loadHomeNearbyPicks(homeCtx(search)), (error) => {
    assert.equal(error.message, GUARD_503);
    return true;
  });
  assert.ok(calls > 1, "fallback waves still ran (call policy unchanged)");
});
await check("L2 loader reports cooldown_skipped when that is the only failure", async () => {
  const search = async () => ({ places: [], error: "cooldown_skipped" });
  await assert.rejects(loadHomeNearbyPicks(homeCtx(search)), (error) => error.message === "cooldown_skipped");
});

let retry;
try {
  retry = await import("../src/lib/home-nearby-transient-retry.ts");
} catch {
  retry = null;
}

function harness() {
  const timers = [];
  const state = { now: 0, guardUntil: 30_000, visible: true, picks: false, inFlight: false, location: "loc-A", providerCalls: 0, outcomes: [] };
  const controller = retry.createHomeNearbyAutoRetry({
    setTimer: (fn, ms) => { const t = { fn, at: state.now + ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    now: () => state.now,
    isGuardActive: () => state.now < state.guardUntil,
    guardUntil: () => (state.now < state.guardUntil ? state.guardUntil : 0),
    isVisible: () => state.visible,
    onOutcome: (o) => state.outcomes.push(o),
  });
  const advance = (ms) => {
    state.now += ms;
    for (const t of timers) if (!t.cleared && !t.fired && t.at <= state.now) { t.fired = true; t.fn(); }
  };
  // Each provider-backed Home load = one Nearby provider attempt (mocked).
  let nextResult = "ok";
  const failWith = (message, cycleKey = "cycle-A") =>
    controller.onFailure({
      cycleKey, message, hasPicks: state.picks,
      isCurrentCycle: () => state.location === "loc-A",
      hasPicksNow: () => state.picks,
      inFlight: () => state.inFlight,
      run: () => {
        state.providerCalls++;
        if (nextResult === "ok") { state.picks = true; retry.completeHomeNearbyRetryCycle(cycleKey); }
        else failWith(nextResult, cycleKey);
      },
    });
  return { state, controller, advance, failWith, setNext: (r) => { nextResult = r; }, timers };
}

const needModule = () => assert.ok(retry, "home-nearby-transient-retry module missing (no recovery contract)");
const fresh = () => { needModule(); retry.resetHomeNearbyRetryCyclesForTest(); return harness(); };

await check("T1 successful Nearby schedules nothing", () => {
  const h = fresh();
  assert.equal(h.controller.hasPending(), false);
  h.advance(60_000);
  assert.equal(h.state.providerCalls, 0);
});
await check("T2 503 guard_unavailable schedules one retry after cooldown", () => {
  const h = fresh();
  const r = h.failWith(GUARD_503);
  assert.deepEqual([r.originalHttpStatus, r.originalErrorCode, r.retryEligible, r.retryScheduled], [503, "google_unavailable", true, true]);
  assert.equal(r.cooldownRemainingMs, 30_000);
});
await check("T3 retry succeeds and cards appear", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.advance(31_000);
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.state.picks, true);
  assert.deepEqual(h.state.outcomes, ["attempted"]);
});
await check("T4 second 503 does not retry again", () => {
  const h = fresh();
  h.setNext(GUARD_503);
  h.failWith(GUARD_503);
  h.advance(31_000);
  h.state.guardUntil = h.state.now + 30_000;
  h.advance(120_000);
  assert.equal(h.state.providerCalls, 1);
});
for (const [id, message] of [
  ["T5 429 user budget", "places_http_429:user_rate_limited"],
  ["T6 429 IP budget", "places_http_429:ip_rate_limited"],
  ["T7 429 global budget", "places_http_429:global_budget_limited"],
  ["T9 missing key", 'places_http_503:{"error":"google_credential_unavailable"}'],
  ["T9b timeout", "places_search_attempt_timeout"],
  ["T9c local cooldown only", "cooldown_skipped"],
]) {
  await check(`${id} is not retried`, () => {
    const h = fresh();
    const r = h.failWith(message);
    assert.equal(r.retryScheduled, false);
    h.advance(120_000);
    assert.equal(h.state.providerCalls, 0);
  });
}
await check("T8 Google upstream 502 is not classified as guard failure", () => {
  needModule();
  const r = retry.classifyHomeNearbyFailure("Google Places API 502: UPSTREAM_UNAVAILABLE: google_upstream_unavailable");
  assert.deepEqual([r.originalHttpStatus, r.retryEligible], [502, false]);
});
await check("T10 unmount cancels the pending retry", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.controller.cancel();
  h.advance(60_000);
  assert.equal(h.state.providerCalls, 0);
  assert.deepEqual(h.state.outcomes, ["cancelled"]);
});
await check("T11 location change invalidates the old retry", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.state.location = "loc-B";
  h.advance(31_000);
  assert.equal(h.state.providerCalls, 0);
  assert.deepEqual(h.state.outcomes, ["skipped_stale"]);
});
await check("T12 manual retry in flight blocks the automatic retry", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.state.inFlight = true;
  h.advance(31_000);
  assert.equal(h.state.providerCalls, 0);
  assert.deepEqual(h.state.outcomes, ["skipped_in_flight"]);
});
await check("T13 effect rerun / remount does not schedule twice in one cycle", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  const again = h.failWith(GUARD_503); // effect rerun while pending
  assert.equal(again.retryScheduled, false);
  h.controller.cancel(); // unmount
  const remount = harness(); // new component instance, same cycle
  assert.equal(remount.failWith(GUARD_503).retryScheduled, false);
});
await check("T14 no provider calls during cooldown", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.advance(29_000);
  assert.equal(h.state.providerCalls, 0);
});
await check("T15 at most one provider attempt after cooldown", () => {
  const h = fresh();
  h.setNext(GUARD_503);
  h.failWith(GUARD_503);
  h.advance(10 * 60_000);
  assert.equal(h.state.providerCalls, 1);
});
await check("T16 background app does not retry", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.state.visible = false;
  h.advance(31_000);
  assert.equal(h.state.providerCalls, 0);
  assert.deepEqual(h.state.outcomes, ["skipped_background"]);
});
await check("T17 guard still active at fire time skips instead of calling", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.state.guardUntil = 120_000; // protection extended by another failure
  h.advance(31_000);
  assert.equal(h.state.providerCalls, 0);
  assert.deepEqual(h.state.outcomes, ["skipped_guard_active"]);
});
await check("T18 success closes the cycle; a later failure may recover once", () => {
  const h = fresh();
  h.failWith(GUARD_503);
  h.advance(31_000); // retry succeeds → cycle complete
  h.state.picks = false;
  h.state.guardUntil = h.state.now + 30_000;
  assert.equal(h.failWith(GUARD_503).retryScheduled, true);
});

console.log(failures ? `FAIL home nearby transient retry (${failures} failing)` : "PASS home nearby transient retry");
process.exitCode = failures ? 1 : 0;
