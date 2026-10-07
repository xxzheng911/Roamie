import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const path = 'src/lib/place-detail-resolve.ts';
const source = fs.readFileSync(path, 'utf8');
const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
let calls = 0;
let candidates = [];
const searchPlaces = async () => { calls++; return { suggestions: candidates }; };
const context = vm.createContext({ searchPlaces, isGooglePlaceId: value => value.startsWith('ChIJ'), console: { info() {}, warn() {} } });
for (const name of ['isAdministrativeDetailCandidate', 'resolveGooglePlaceIdForDetail']) {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(node);
  vm.runInContext(ts.transpileModule(node.getText(tree).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const admin = { placeId: 'ChIJ_admin', label: 'Heritage Site', types: ['sublocality_level_2', 'sublocality', 'political'] };
const venue = { placeId: 'ChIJ_venue', label: 'Heritage Site Gardens', types: ['tourist_attraction', 'park', 'point_of_interest'] };
const handoff = { name: 'Heritage Site', address: 'District' };
candidates = [admin, venue];
assert.equal(await context.resolveGooglePlaceIdForDetail(handoff), venue.placeId, 'A/D exact administrative name cannot beat venue');
assert.equal(calls, 1);
for (const types of [['political'], ['political', 'establishment', 'point_of_interest'], ['country'], ['locality'], ['sublocality_level_2'], ['administrative_area_level_1'], ['postal_code']]) {
  candidates = [{ ...admin, types }];
  const before = calls;
  assert.equal(await context.resolveGooglePlaceIdForDetail(handoff), null, `B rejected: ${types}`);
  assert.equal(calls, before + 1, 'no second search for geography-only result');
}
// The existing search provider output is neither filtered globally nor mutated.
candidates = [admin];
assert.equal((await searchPlaces()).suggestions[0], admin, 'C district results remain available to city/district consumers');
candidates = [venue];
assert.equal(await context.resolveGooglePlaceIdForDetail(handoff), venue.placeId, 'E valid venue unchanged');
const before = calls;
assert.equal(await context.resolveGooglePlaceIdForDetail({ ...handoff, googlePlaceId: 'ChIJ_existing' }), 'ChIJ_existing');
assert.equal(calls, before, 'existing identity needs no request');
assert.equal(context.isAdministrativeDetailCandidate(['political', 'tourist_attraction']), false);
assert.equal(context.isAdministrativeDetailCandidate(['museum']), false);
console.log('PASS A-E: scoped venue selection, administrative-only stop, unmodified provider output, valid identity; mocked requests only');
