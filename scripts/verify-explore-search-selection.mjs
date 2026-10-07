import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const source = fs.readFileSync('src/routes/_app.map.tsx', 'utf8');
const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  let fn;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) fn = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(fn, name);
  const js = ts.transpileModule(`globalThis.handler = ${fn.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(js, context);
  return context.handler;
}
const oldPlace = { id: 'old', name: 'Old', lat: 25, lng: 121 };
const state = { selectedPlace: oldPlace, selectedPlaceIndex: 1, primaryPlace: oldPlace, sheetMode: 'detail', query: 'query', searchFocused: false, searchDropdownOpen: true, searchSuggestions: [{}], searchingPlaces: true };
const order = [];
let dismisses = 0;
let collapsed = 0;
let expanded = 0;
let resolved = { id: 'new', name: 'New', lat: 25.1, lng: 121.1, types: ['museum'], primaryType: 'museum', googleMapsUrl: 'https://example.test' };
const context = vm.createContext({
  crypto: { randomUUID }, recordAnalyticsEvent() {}, generatePlaceReason: () => 'Reason',
  selectedPlace: null, selectedPlaceIndex: null, sheetMode: 'list', displayResults: [],
  clearExploreSelectionState: () => { state.selectedPlace = null; state.selectedPlaceIndex = null; },
  query: state.query, locale: 'zh-TW', reliableUserLocation: null, weather: null, reasonProfile: {},
  exploreSearchRequestRef: { current: 1 }, searchTargetRequestRef: { current: 1 },
  exploreSessionRef: { current: { id: 'search', mode: 'search' } },
  lastMapSearchSessionRef: { current: 'old-search' }, primaryPlaceRef: { current: oldPlace },
  beginExploreRequestSession: (mode, query) => ({ mode, query }),
  clearExploreMapSearchSession: () => { state.persistedSearch = null; },
  sheetRef: { current: { collapse: () => collapsed++, expand: () => expanded++ } },
  searchBarRef: { current: { dismiss: () => { dismisses++; context.focus(false); } } },
  resolveExplorePrimaryPlace: async () => resolved, resolveTripStopFn() {}, fetchExplorePlaceDetailsFn() {},
  normalizeExplorePlaceId: value => value, logExploreSearchSelect() {}, logExploreSelectedPlaceDetails() {},
  logExplorePrimaryPlace() {}, logExplorePrimaryPlacePinned() {}, resolvePlaceImageUrl: () => '',
  focusMapOnPlace() {}, fetchWeather: async () => ({ weather: null }),
  publishExploreResults: places => { state.results = places; }, MAP_ZOOM_EXPLORE: 14,
  toast: { error() {} }, t: key => key,
});
for (const key of ['Query', 'SearchDropdownOpen', 'SearchSuggestions', 'SearchingPlaces', 'SearchFocused', 'SelectedPlace', 'SelectedPlaceIndex', 'SheetMode', 'PrimaryPlace', 'PrimarySearchLoading', 'SearchSelectedCenter', 'LocationLabel', 'MapCenter', 'MapZoom', 'Weather', 'Loading', 'Error']) {
  const field = key[0].toLowerCase() + key.slice(1);
  context[`set${key}`] = value => { state[field] = value; if (field === 'query') context.query = value; order.push(field); };
}
context.focus = callback('handleExploreSearchFocus', context);
context.finishExploreSearchSelection = callback('finishExploreSearchSelection', context);
const apply = callback('applyExploreSearchTarget', context);
context.focus(true);
assert.equal(state.sheetMode, 'list');
assert.equal(state.selectedPlace, null);
assert.equal(state.primaryPlace, oldPlace, 'map primary selection remains');
assert.equal(state.searchFocused, true);
assert.equal(collapsed, 1);
assert(order.indexOf('sheetMode') < order.indexOf('searchFocused'));
assert.equal(await apply({ placeId: 'new', label: 'New', types: ['museum'] }, 1), true);
assert.equal(state.selectedPlace.id, 'new');
assert.equal(state.sheetMode, 'detail');
assert.equal(state.query, '');
assert.equal(state.searchFocused, false);
assert.equal(state.searchDropdownOpen, false);
assert.equal(state.searchSuggestions.length, 0);
assert.equal(context.exploreSessionRef.current.mode, 'browse');
assert.equal(state.primaryPlace.id, 'new');
assert.equal(dismisses, 1);
assert.equal(expanded, 1);
context.focus(true);
assert.equal(state.sheetMode, 'list');
assert.equal(state.searchFocused, true);
resolved = null;
assert.equal(await apply({ placeId: 'bad', label: 'Bad' }, 1), false);
assert.equal(state.searchFocused, true, 'failed selection must not close search');
resolved = { id: 'stale', name: 'Stale', lat: 25, lng: 121 };
assert.equal(await apply({ placeId: 'stale', label: 'Stale' }, 0), false);
assert.equal(state.selectedPlace, null, 'stale selection must not reopen detail');
// Submitted-search result cards use the same cleanup, preserving their own index.
context.query = 'museum';
context.exploreSessionRef.current = { mode: 'search' };
context.displayResults = [oldPlace, { id: 'card-result', name: 'Card', lat: 25.2, lng: 121.2, reason: 'Known' }];
const selectCard = callback('handlePlaceSelect', context);
selectCard(1);
assert.equal(state.query, '');
assert.equal(state.selectedPlace.id, 'card-result');
assert.equal(state.selectedPlaceIndex, 1);
assert.equal(state.sheetMode, 'detail');
assert.equal(context.exploreSessionRef.current.mode, 'browse');
const dismissBeforeBrowse = dismisses;
selectCard(0, 'map');
assert.equal(state.selectedPlace.id, 'old');
assert.equal(state.sheetMode, 'detail');
assert.equal(dismisses, dismissBeforeBrowse, 'ordinary map selection does not reset search');
const back = callback('handleBackToList', context);
back();
assert.equal(state.sheetMode, 'list');
assert.equal(state.selectedPlace, null);
assert.match(source, /onFocusChange=\{handleExploreSearchFocus\}/);
assert.match(source, /searchDropdownOpen \|\| searchFocused \|\| isMapDetailOpen\(sheetMode\)/);
console.log('PASS actual Explore owner callbacks: detail→search→selection→cleanup/detail; invalid/stale selection guarded');
