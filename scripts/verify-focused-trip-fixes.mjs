import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindRoutesServerFns, fetchRouteResult } from '../src/services/routesService.ts';
import { fetchScopedLegDuration } from '../src/lib/saved-trip/route-duration-service.ts';
import { shouldShowTicketAffiliate } from '../src/lib/affiliate/ticket-affiliate-eligibility.ts';

let calls = 0;
let middlewareDenied = false;
const unused = async () => { throw new Error('unexpected provider'); };
bindRoutesServerFns({
  computeDuration: async () => { calls++; if (middlewareDenied) throw new Error('Too Many Requests'); return { ok: false, statusCode: 429, message: 'rate_limited' }; },
  computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused,
});
const originalFetch = globalThis.fetch;
globalThis.fetch = unused;
try {
  const result = await fetchRouteResult({ lat: 25, lng: 121 }, { lat: 25.001, lng: 121 }, 'WALK');
  assert.equal(result.statusCode, 429);
  assert.equal(calls, 1, '429 must not retry via client proxy');
  calls = 0;
  const leg = await fetchScopedLegDuration({
    scope: { tripId: 'rate-fixture', dateKey: '2026-10-07', dayIndex: 0, legIndex: 0, legKey: 'a-b' },
    origin: { lat: 25.01, lng: 121 }, destination: { lat: 25.011, lng: 121 },
    preferredMode: 'WALK', allowModeFallback: true, query: {},
  });
  assert.equal(leg.ok, false);
  assert.equal(calls, 1, '429 must not fan out into fallback modes');
  middlewareDenied = true;
  const denied = await fetchRouteResult({ lat: 26, lng: 121 }, { lat: 26.001, lng: 121 }, 'WALK');
  assert.equal(denied.statusCode, 429);
} finally { globalThis.fetch = originalFetch; }

const bridge = { placeName: 'Fixture Bridge', types: ['historical_landmark', 'tourist_attraction'], rating: 4.5, userRatingCount: 2000 };
assert.equal(shouldShowTicketAffiliate(bridge).show, false);
for (const field of ['ticketingAvailable', 'guidedTourAvailable', 'activityAvailable']) {
  assert.equal(shouldShowTicketAffiliate({ ...bridge, [field]: true }).show, true);
}
const park = { placeName: 'Fixture Park', types: ['park', 'tourist_attraction'] };
assert.equal(shouldShowTicketAffiliate(park).show, false);
assert.equal(shouldShowTicketAffiliate({ ...park, guidedTourAvailable: true }).show, true);
assert.equal(shouldShowTicketAffiliate({ ...bridge, placeName: 'Fixture Castle' }).show, true);

const form = readFileSync('src/routes/_app.plan.tsx', 'utf8');
assert.match(form, /useState<BudgetMode \| "">\(""\)/);
assert.match(form, /\[travelers, setTravelers\] = useState\(0\)/);
assert.match(form, /if \(!budgetMode\) \{[\s\S]*?return null/);
assert.match(form, /if \(!isValidTravelers\(travelers\)\)/);
assert.match(form, /setBudgetMode\(draft.budgetMode\)/);
assert.match(form, /setTravelers\(draft.travelers\)/);
assert.doesNotMatch(form, /setBudgetMode\(resolveBudgetMode/);
const renderer = readFileSync('src/components/trip/TripAffiliateSection.tsx', 'utf8');
assert.match(renderer, /kind === "ticket" \? "grid min-w-0 grid-cols-2 gap-2"/);
assert.match(renderer, /min-w-0 text-center whitespace-normal/);
assert.match(renderer, /shrink-0 opacity-60/);
console.log('PASS focused route 429, affiliate evidence, planning defaults, CTA static contracts');
