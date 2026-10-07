import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function ast(path) { return ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function loadFunction(path, name, context) {
  const tree = ast(path);
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(node, name);
  const code = node.getText(tree).replace(/^export /, '');
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context[name];
}
const warnings = [];
let providerCalls = 0;
let respond = async () => ({ suggestions: [{ placeId: 'current' }], error: null });
const context = vm.createContext({ console: { warn: (...args) => warnings.push(args.join(' ')) }, devVerboseInfo() {},
  searchPlaces: async (...args) => { providerCalls++; return respond(...args); },
});
loadFunction('src/lib/explore-request-session.ts', 'isExploreSearchCancellation', context);
const search = loadFunction('src/lib/explore-map-search.ts', 'runExploreMapPlaceSearch', context);
const options = () => ({ locale: 'zh-TW', searchFn() {}, requestSession: { controller: new AbortController() } });
assert.equal((await search('museum', options())).suggestions[0].placeId, 'current');
respond = async () => ({ suggestions: [], error: 'autocomplete_cancelled' });
assert.equal((await search('old', options())).cancelled, true);
respond = async () => { throw new DOMException('superseded', 'AbortError'); };
assert.equal((await search('old', options())).cancelled, true);
assert.equal(warnings.length, 0);
respond = async () => ({ suggestions: [], error: 'HTTP 503' });
assert.equal((await search('bad', options())).error, 'HTTP 503');
assert.match(warnings.pop(), /EXPLORE_SEARCH_ERROR.*HTTP 503/);
let finish;
respond = () => new Promise(resolve => { finish = resolve; });
const oldOptions = options();
const stale = search('old', oldOptions);
oldOptions.requestSession.controller.abort();
finish({ suggestions: [{ placeId: 'stale' }], error: null });
assert.equal((await stale).cancelled, true);
const before = providerCalls;
assert.equal((await search('aborted', oldOptions)).cancelled, true);
assert.equal(providerCalls, before, 'already cancelled session never dispatches');
assert.equal(warnings.length, 0);

// Execute the real autocomplete effect with a controlled timer and response.
const tree = ast('src/routes/_app.map.tsx');
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('await runExploreMapPlaceSearch(trimmed')) effect = node;
  ts.forEachChild(node, visit);
}
visit(tree);
assert(effect);
const dependencies = effect.arguments[1].getText(tree);
for (const state of ['searchSuggestions', 'searchingPlaces', 'error', 'sheetMode', 'searchFocused'])
  assert(!new RegExp(`\\b${state}\\b`).test(dependencies), `${state} must not restart autocomplete`);
let timer;
const state = { suggestions: [], error: null };
const pending = [];
let starts = 0;
Object.assign(context, {
  geoReady: true, effectiveLocation: { isReadyForPlaces: true }, searchDropdownOpen: true,
  networkOnline: true, query: 'first', userLocation: { lat: 1, lng: 2 }, locale: 'zh-TW',
  exploreSessionRef: { current: null }, exploreSearchRequestRef: { current: 0 },
  beginExploreRequestSession: () => ({ mode: 'search', controller: new AbortController() }),
  setSearchingPlaces: value => { state.loading = value; }, setSearchSuggestions: value => { state.suggestions = value; },
  setError: value => { state.error = value; }, setNetworkOnline() {}, t: x => x,
  searchTripStopsFn() {}, EXPLORE_SEARCH_DEBOUNCE_MS: 320,
  isNetworkFailureError: () => false,
  window: { setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; } },
  runExploreMapPlaceSearch: () => { starts++; return new Promise(resolve => pending.push(resolve)); },
});
vm.runInContext(ts.transpileModule(`globalThis.effect = ${effect.arguments[0].getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const flush = () => new Promise(resolve => setImmediate(resolve));
let cleanup = context.effect();
cleanup(); // Rapid typing before debounce: no dispatch.
assert.equal(starts, 0);
context.query = 'second';
cleanup = context.effect(); timer();
cleanup();
context.query = 'third';
cleanup = context.effect(); timer();
pending[1]({ suggestions: [{ placeId: 'latest' }], error: null }); await flush();
pending[0]({ suggestions: [{ placeId: 'stale' }], error: null }); await flush();
assert.equal(state.suggestions[0].placeId, 'latest');
assert.equal(starts, 2, 'one dispatch per elapsed debounce; no response-driven restart');
cleanup();
cleanup = context.effect(); timer();
pending[2]({ suggestions: [], error: null, cancelled: true }); await flush();
assert.equal(state.suggestions[0].placeId, 'latest', 'cancellation preserves current results');
assert.equal(state.error, null);
assert.equal(warnings.length, 0);
cleanup();

// Real unified helper: blocked admission is not falsely labelled cancellation.
Object.assign(context, {
  getGoogleRestTransportToken: () => 'fixture', placesAutocompleteUrl: () => 'unused',
  localeToGoogleLanguageCode: () => 'en', runPlacesApiDeduped: async () => null,
});
const unified = loadFunction('src/lib/trip-stop-search-unified.ts', 'unifiedSearchTripStops', context);
const session = { controller: new AbortController() };
assert.equal((await unified(() => {}, 'q', 'en', undefined, undefined, { exploreSession: session })).error, 'autocomplete_unavailable');
session.controller.abort();
assert.equal((await unified(() => {}, 'q', 'en', undefined, undefined, { exploreSession: session })).error, 'autocomplete_cancelled');
console.log('PASS A-D/G-H: debounce, silent cancellation, genuine failure, stale isolation, no response-driven loop; mocked dispatch only');
