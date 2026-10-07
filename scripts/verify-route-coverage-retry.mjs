import assert from 'node:assert/strict';
import { legRouteIsCovered, legRouteRetryDeferred } from '../src/lib/saved-trip/sync-route-legs.ts';
import { fetchScopedLegDuration, clearScopedRouteCache } from '../src/lib/saved-trip/route-duration-service.ts';
import { clearRouteDurationCache } from '../src/lib/route-duration-cache.ts';
import { bindRoutesServerFns } from '../src/services/routesService.ts';

let now = 1_800_000_000_000;
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
Date.now = () => now;
const leg = { routeCacheFingerprint: 'same', requestedMode: 'WALK', resolvedMode: 'WALK', estimates: {}, durationMinutes: 12, routeStatus: 'ok' };
assert(legRouteIsCovered(leg, 'WALK', 'same'));
assert(!legRouteIsCovered(leg, 'WALK', 'different'));
for (const durationMinutes of [null, undefined, 0, NaN, Infinity]) {
  assert(!legRouteIsCovered({ ...leg, durationMinutes }, 'WALK', 'same'));
}
for (const routeStatus of ['failed', 'mode_unavailable', 'transit_unavailable']) {
  assert(!legRouteIsCovered({ ...leg, routeStatus }, 'WALK', 'same'));
}
assert(!legRouteIsCovered({ ...leg, durationMinutes: null, estimates: { drive: 20 } }, 'WALK', 'same'));
assert(!legRouteRetryDeferred({ ...leg, routeStatus: 'failed' }, 'same'), 'legacy failures can retry');

let calls = 0;
let success = false;
let pending = null;
const unused = async () => { throw new Error('unexpected live fetch'); };
globalThis.fetch = unused;
bindRoutesServerFns({
  computeDuration: async ({ data }) => {
    calls++;
    if (pending) return new Promise(resolve => pending.push(resolve));
    return success ? { ok: true, data: { durationMinutes: 12, distanceMeters: 800, travelMode: data.travelMode } }
      : { ok: false, statusCode: 429, message: 'rate_limited' };
  },
  computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused,
});
const input = {
  scope: { tripId: 'retry-fixture', dateKey: '2026-10-07', dayIndex: 0, legIndex: 0, legKey: 'a-b' },
  origin: { lat: 25, lng: 121 }, destination: { lat: 25.001, lng: 121 },
  preferredMode: 'WALK', query: {}, allowModeFallback: false,
};
try {
  clearRouteDurationCache(); clearScopedRouteCache();
  const failure = await fetchScopedLegDuration(input);
  assert.equal(calls, 1);
  assert.equal(failure.retryAfter, now + 60 * 60 * 1000);
  const saved = JSON.parse(JSON.stringify({ ...leg, routeStatus: 'failed', routeRetryAfter: failure.retryAfter }));
  assert(legRouteRetryDeferred(saved, 'same'));
  assert(!legRouteRetryDeferred(saved, 'different'));
  assert(!legRouteRetryDeferred({ ...saved, routeStatus: 'ok' }, 'same'));
  now += 30 * 60 * 1000;
  assert.equal((await fetchScopedLegDuration({ ...input, force: true })).retryAfter, failure.retryAfter);
  assert.equal(calls, 1, 'force/reopen must not reset or bypass cooldown');
  now = failure.retryAfter + 1;
  assert(!legRouteRetryDeferred(saved, 'same'));
  success = true;
  const recovered = await fetchScopedLegDuration(input);
  assert(recovered.ok);
  assert.equal(recovered.retryAfter, undefined);
  assert.equal(calls, 2);
  assert((await fetchScopedLegDuration(input)).ok);
  assert.equal(calls, 2, 'success must remain cached');
  const switched = await fetchScopedLegDuration({ ...input, preferredMode: 'DRIVE' });
  assert.equal(switched.mode, 'DRIVE');
  assert.equal(calls, 3, 'new mode fetched lazily');
  clearRouteDurationCache(); clearScopedRouteCache();
  pending = [];
  const older = fetchScopedLegDuration(input);
  clearRouteDurationCache();
  const newer = fetchScopedLegDuration({ ...input, force: true });
  assert.equal(pending.length, 2);
  pending[1]({ ok: true, data: { durationMinutes: 15, distanceMeters: 800, travelMode: 'WALK' } });
  assert((await newer).ok);
  pending[0]({ ok: false, statusCode: 429, message: 'rate_limited' });
  assert(!(await older).ok);
  assert((await fetchScopedLegDuration(input)).ok, 'old failure cannot replace scoped success');
  clearScopedRouteCache();
  assert((await fetchScopedLegDuration(input)).ok, 'old failure cannot replace shared success');
  console.log('PASS route coverage, persisted cooldown, 429 expiry/recovery, success cache, lazy mode');
} finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
