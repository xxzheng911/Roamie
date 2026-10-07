import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { recommendLegFromEstimates, getTransitModeLabel } from '../src/lib/transit/recommend-leg.ts';
import { resolveRegionProfile } from '../src/lib/transit/region-profiles.ts';
import { distanceMeters } from '../src/lib/geo-distance.ts';
import { travelMinutesForMode, durationSourceForLeg } from '../src/lib/saved-trip/travel-time.ts';
import { legRouteIsCovered } from '../src/lib/saved-trip/sync-route-legs.ts';

function loadFunctions(path, names, context) {
  const source = fs.readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  for (const name of names) {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert(node, name);
    const js = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(js, context);
  }
  return source;
}
globalThis.fetch = async () => { throw new Error('Live network forbidden'); };
let calls = [];
let failure = false;
const context = vm.createContext({
  console, Number, Date, recommendLegFromEstimates, getTransitModeLabel, resolveRegionProfile, distanceMeters,
  getRouteDuration: async (_origin, _destination, mode) => {
    calls.push(mode);
    return failure ? { ok: false, statusCode: 429, message: 'rate_limited' }
      : { ok: true, data: { durationMinutes: 37, distanceMeters: 2345, travelMode: mode } };
  },
  enrichTransitLegsWithAI: async legs => legs.map(l => ({ ...l, requestedMode: 'WRONG', durationMinutes: 999, headline: 'WRONG', reason: 'Refined', source: 'ai' })),
});
const source = loadFunctions('src/lib/transit/build-legs.server.ts', ['buildTransportTips', 'buildTransitLegsForItinerary'], context);
const point = (index, lng, date = '2026-11-01') => ({ title: `Place ${index}`, placeName: `Place ${index}`, lat: 0, lng, date });
const build = (items, extra = {}) => context.buildTransitLegsForItinerary({ items, destination: 'France', useAiReasons: false, ...extra });
for (const [delta, mode, key] of [[0.001, 'WALK', 'walk'], [0.4, 'DRIVE', 'drive'], [0.02, 'TRANSIT', 'transit']]) {
  calls = [];
  const { legs: [leg] } = await build([point(0, 0), point(1, delta)]);
  assert.deepEqual(calls, [mode], `${mode}: exactly one provider invocation`);
  assert.equal(leg.resolvedMode, mode);
  assert.equal(leg.requestedMode, mode);
  assert.equal(leg.durationMinutes, 37, 'actual provider duration, no local estimate');
  assert.equal(leg.durationSource, 'directions');
  assert.equal(leg.routeStatus, 'ok');
  assert.deepEqual(Object.keys(leg.estimates), [key]);
  assert.equal(leg.alternatives.length, 0);
  const restored = JSON.parse(JSON.stringify(leg));
  assert.equal(travelMinutesForMode(restored, getTransitModeLabel(restored.recommendedMode)), 37);
  assert.equal(durationSourceForLeg(restored, ''), mode);
  // Unqueried modes never acquire coverage from the generated record.
  assert(!legRouteIsCovered(restored, mode === 'WALK' ? 'DRIVE' : 'WALK', 'different-mode'));
}
const thirty = Array.from({ length: 30 }, (_, i) => point(i, i * 0.001, `2026-11-0${1 + Math.floor(i / 6)}`));
calls = [];
const trip = await build(thirty);
assert.equal(trip.legs.length, 25);
assert.equal(calls.length, 25);
// Execute the prior three-mode helper against the same 25-leg count, with no network.
let before = 0;
const legacyContext = vm.createContext({ computeRouteRaw: async () => { before++; return { ok: true, data: { durationMinutes: 10, distanceMeters: 1000 } }; } });
const routesSource = loadFunctions('src/lib/google-routes.server.ts', ['fetchLegDurationsFromRoutes'], legacyContext);
for (let i = 0; i < 25; i++) await legacyContext.fetchLegDurationsFromRoutes({}, {});
assert.equal(before, 75);
failure = true; calls = [];
const { legs: [failed] } = await build([point(0, 0), point(1, 0.02)]);
assert.deepEqual(calls, ['TRANSIT']);
assert.equal(failed.resolvedMode, undefined);
assert.equal(failed.durationSource, 'none');
assert.equal(failed.routeStatus, 'mode_unavailable');
assert.equal(Object.keys(failed.estimates).length, 0);
assert.equal(travelMinutesForMode(JSON.parse(JSON.stringify(failed)), '大眾運輸'), null);
failure = false;
const { legs: [enriched] } = await build([point(0, 0), point(1, 0.001)], { useAiReasons: true });
assert.equal(enriched.resolvedMode, 'WALK');
assert.equal(enriched.durationMinutes, 37);
assert.notEqual(enriched.headline, 'WRONG');
// Direct generation gate: execute its existing guard, not the generation pipeline.
const generation = fs.readFileSync('src/lib/itinerary.functions.ts', 'utf8');
const gate = generation.slice(generation.indexOf('setGenerationPhase("transit")'));
const guard = gate.match(/if \(data.placeAuthority === "selected_only"\) \{\s*throw new Error\("selection_optional_transit_deferred"\);\s*\}/)?.[0];
assert(guard);
let enrichment = 0;
vm.runInNewContext(`try { ${guard}; enrich(); } catch {}`, { data: { placeAuthority: 'selected_only' }, enrich: () => enrichment++ });
assert.equal(enrichment, 0);
assert.match(gate, /transitLegs: Object.fromEntries\(transit.legs.map/);
assert(!source.includes('fetchLegDurations('));
assert.match(routesSource, /return fetchGoogleRoute\(/);
const provider = fs.readFileSync('src/lib/google-routes-fetch.ts', 'utf8');
assert.match(provider, /travelMode === "TRANSIT"/);
assert.match(provider, /fetchGoogleDirectionsForRoutesMode\(/);
assert.match(provider, /googleRestFetch\(ROUTES_URL/);
assert.match(fs.readFileSync('src/lib/google-directions-fetch.ts', 'utf8'), /googleRestFetch\(requestUrl/);
assert.match(fs.readFileSync('src/lib/google-rest-provider.server.ts', 'utf8'), /await runGoogleUpstreamAttempt\(/);
console.log('PASS generation single-mode A-F/H-I: before=75 after=25, -66.7%; unchanged provider/guard wiring, saved roundtrip, no network');
