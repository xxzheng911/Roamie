import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual boundary functions with isolated dependencies; never load providers.
const noop = () => {};
const quietConsole = { info: noop, warn: noop, error: noop };
function source(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
function extract(path, name, callback = false) {
  const text = source(path);
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (callback && ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      found = node.initializer.arguments[0].getText(ast);
    if (!callback && ts.isFunctionDeclaration(node) && node.name?.text === name)
      found = node.getText(ast).replace(/^export /, '');
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, name);
  return callback ? found : `(${found})`;
}
function execute(code, dependencies) {
  const js = ts.transpileModule(`const target = ${code};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('env', `with (env) { ${js} return target; }`)(dependencies);
}
function timeout(promise, ms = 5) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('places_timeout')), ms);
  })]).finally(() => clearTimeout(timer));
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const homeCode = extract('src/routes/_app.index.tsx', 'loadNearbyPicks', true);
const homeAst = ts.createSourceFile('home.ts', `const f = ${homeCode}`, ts.ScriptTarget.Latest, true);
const identifiers = new Set();
(function walk(n) { if(ts.isIdentifier(n)) identifiers.add(n.text); ts.forEachChild(n, walk); })(homeAst);
function home(inflight, loader = async () => []) {
  const state = { loading: true, render: 'loading', cards: [], published: [] };
  const env = Object.fromEntries([...identifiers].map(name => [name, noop]));
  Object.assign(env, {
    Date, Promise, Set, Error, console: quietConsole, locale: 'zh-TW', hasPlusAccess: false,
    nearbyRequestVersionRef: {current: 0}, nearbyRetryInflightRef: {current: false},
    effectiveLocationRef: {current: {isReadyForPlaces:true, locationKey:'A', lat:22, lng:120}},
    hasNearbyPicksRef: {current:false}, nearbyPicksRef: {current:[]}, coldStartAtRef: {current:0},
    firstCardLoggedRef: {current:false}, weatherRef: {current:null},
    beginHomeNearbyPerfLoad: () => ({requestId:'test', startedAt:Date.now()}),
    homeNearbyLoadKey: (lat,lng) => `${lat}:${lng}`, homeNearbyLoadPeriodKey: () => 'day',
    getHomeNearbyLoadInFlight: () => inflight, shouldSkipHomeNearbyLoadWithData: () => false,
    sanitizeHomeNearbyPicksForDisplay: x => x, withSearchTimeout: timeout,
    setNearbyLoading: x => {state.loading=x;}, setNearbyRenderStateLogged: x => {state.render=x;},
    setNearbyPicks: x => {state.cards=x;}, applyNearbyPicksIfChanged: x => {state.cards=x;},
    publishHomeNearbyFresh: x => state.published.push(x), publishHomeNearbyCache: x => state.published.push(x),
    getTravelPrefStatusSync: () => ({}), peekListPlacesCache: () => [],
    getPreferences: async () => ({}), getUserProfile: async () => null, listPlaces: async () => [],
    loadHomeNearbyPicks: loader, startTransition: fn => fn(),
  });
  return { state, env, run: execute(homeCode, env) };
}
for (const joined of [true, false]) {
  for (const [kind, expected] of [['success','fresh'],['empty','empty'],['provider','error'],['timeout','error']]) {
    const operation = async () => {
      if(kind==='provider') throw new Error('guard_unavailable');
      if(kind==='timeout') return timeout(new Promise(noop));
      return kind==='success' ? [{id:'one'}] : [];
    };
    const h = home(joined ? operation() : null, operation);
    await h.run();
    assert.equal(h.state.loading, false, `${joined}/${kind} settled`);
    assert.equal(h.state.render, expected, `${joined}/${kind} state`);
  }
}
// A stuck shared promise is bounded too.
const stuck = home(new Promise(noop)); await stuck.run(); assert.equal(stuck.state.render,'error');
for (const joined of [true,false]) {
  const old = deferred();
  const h = home(joined ? old.promise : null, () => old.promise);
  const pending = h.run();
  h.env.getHomeNearbyLoadInFlight = () => null;
  h.env.loadHomeNearbyPicks = async () => [{id:'new'}];
  await h.run();
  old.resolve([{id:'old'}]); await pending;
  assert.equal(h.state.cards[0].id, 'new');
  assert.ok(h.state.published.every(cards => cards[0].id !== 'old'));
}
const cached = home(Promise.resolve([]));
cached.env.hasNearbyPicksRef.current=true; cached.state.cards=[{id:'cached'}]; cached.state.render='cached';
await cached.run(); assert.equal(cached.state.cards[0].id,'cached'); assert.equal(cached.state.render,'cached');

// Exercise the shared loader's failure retention, recovery, and cache publication authority.
const innerCode = extract('src/lib/home-nearby-search.ts','loadHomeNearbyPicksInner');
const innerAst = ts.createSourceFile('inner.ts', `const f = ${innerCode}`, ts.ScriptTarget.Latest, true);
const names = new Set();
(function walk(n) { if(ts.isIdentifier(n)) names.add(n.text); ts.forEachChild(n,walk); })(innerAst);
for (const kind of ['empty','provider','timeout','recovery','stale']) {
  const writes=[];
  const env=Object.fromEntries([...names].map(n=>[n,noop]));
  Object.assign(env,{Error, withSearchTimeout:timeout, wavesForPeriod:()=>[],
    fetchHomeNearbyWaves:async (_,ctx)=>{try{return (await ctx.searchPlacesFn({})).places;}catch{return [];}},
    runHomePopularFallback:async()=>kind==='recovery'?[{id:'recovered'}]:[],
    runHomeGenericTypeFallback:async()=>[], finalizeHomeNearbyPicks:x=>x,
    writeHomeNearbyResultsCache:(_,x)=>writes.push(x),
  });
  const run=execute(innerCode,env);
  const ctx={userLocation:{lat:22,lng:120}, searchPlacesFn:async()=> {
    if(kind==='timeout') return new Promise(noop);
    return {places:kind==='stale'?[{id:'old'}]:[],error:['provider','recovery'].includes(kind)?'guard_unavailable':null};
  }};
  const result=run(ctx,'day','key',new Date(),'Asia/Taipei',{isCurrent:()=>kind!=='stale'});
  if(['provider','timeout'].includes(kind)) { await assert.rejects(result); assert.equal(writes.length,0); }
  else { const picks=await result; assert.equal(picks.length,kind==='empty'?0:1); if(kind==='stale') assert.equal(writes.length,0); }
}

const placesPath='src/lib/places.functions.ts';
const classify=execute(extract(placesPath,'classifyExplorePlacesError'),{});
let outcome, aborted=false, logged=0;
const selected={places:[{id:'selected',lat:22,lng:120}],error:null};
const env={buildSearchStats:()=>({}), pushPlacesCallContext:noop,popPlacesCallContext:noop,
  getExploreRequestSession:()=>aborted?{controller:{signal:{aborted:true}}}:null,
  classifyExplorePlacesError:classify, DOMException, Error,
  console:{error:()=>{logged++;}},
  runExploreSearch:async()=>{if(outcome instanceof Error)throw outcome;return outcome;},
};
const explore=execute(extract(placesPath,'executeExploreSearch'),env);
for(const [input,error] of [[{places:[],error:null},null],[{places:[],error:'guard_unavailable'},'places_provider_unavailable'],[new Error('provider_timeout'),'places_timeout']]) {
  outcome=input; assert.equal((await explore({placesScreen:'explore'},{apiKey:'mock'})).error,error);
}
outcome=new DOMException('Search superseded','AbortError');
const previousLogs=logged; await assert.rejects(explore({placesScreen:'explore'},{apiKey:'mock'}),{name:'AbortError'}); assert.equal(logged,previousLogs);
outcome=selected; aborted=true; await assert.rejects(explore({placesScreen:'explore'},{apiKey:'mock'}),{name:'AbortError'}); aborted=false;
assert.equal(await explore({placesScreen:'explore'},{apiKey:'mock'}),selected);
outcome={places:[],error:'guard_unavailable'};
assert.equal(await explore({placesScreen:'chat'},{apiKey:'mock'}),outcome,'Chat contract unchanged');
const boundary=execute(extract(placesPath,'runExploreSearch'),{
  DEFAULT_SEARCH_RADIUS_M:5000, coerceLocale:x=>x,buildSearchStats:()=>({}),
  searchText:async()=>selected, filterWithinDistance:()=>{throw Error('selection must bypass filters');},
});
assert.equal(await boundary({mode:'text',query:'selected',placesCaller:'map.freeTextSearch',placesScreen:'explore'},'mock'),selected);

// Mixed empty/error groups must not become genuine empty; successful groups remain usable.
let groupResults;
const multi=execute(extract(placesPath,'searchMultiNearby'), {
  Promise, Set, devVerboseInfo:noop,
  searchNearby:async()=>groupResults.shift(),
});
for(const [results,expected] of [
  [[{places:[],error:null},{places:[],error:'guard_unavailable'}],'guard_unavailable'],
  [[{places:[],error:null},{places:[],error:null}],null],
  [[{places:[{id:'one'}],error:null},{places:[],error:'guard_unavailable'}],null],
]) {
  groupResults=results;
  const result=await multi('mock',22,120,1000,[['cafe'],['park']],'zh-TW',{screen:'explore',caller:'map'});
  assert.equal(result.error,expected);
}
// An older rejection must not settle a newer pending request.
const oldFailure=deferred(), newer=deferred();
const race=home(oldFailure.promise);
const first=race.run(); race.env.getHomeNearbyLoadInFlight=()=>newer.promise;
const second=race.run(); oldFailure.reject(new Error('provider unavailable'));
await first; assert.equal(race.state.loading,true);
newer.resolve([{id:'newer'}]); await second; assert.equal(race.state.cards[0].id,'newer');

// Load only the pure display formatter (no provider or runtime imports).
const addressJs=ts.transpileModule(source('src/lib/place-display-address.ts'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
const addressExports={}; new Function('exports',addressJs)(addressExports);
const {resolvePlaceDisplayAddress:address,sanitizeGooglePlaceAddress:sanitize}=addressExports;
for(const text of ['804高雄市鼓山區美術東二路123號','高雄市鼓山區','台北市中山區中山北路2段123之4號5樓','1234+56號','123 Main Street','M75X+JC號'])
  assert.equal(address({formattedAddress:text}),text);
for(const [input,expected] of [['804高雄市鼓山區M75X+JC','高雄市鼓山區'],['M75X+JC 高雄市鼓山區','高雄市鼓山區'],['M75X+JC',null],['849VCWC8+R9',null],['高雄市鼓山區美術東二路123號 M75X+JC','高雄市鼓山區美術東二路123號']])
  assert.equal(address({formattedAddress:input}),expected,input);
const fields={formattedAddress:'804高雄市鼓山區M75X+JC',shortFormattedAddress:'美術東二路123號'};
assert.equal(address(fields),'美術東二路123號'); assert.equal(fields.formattedAddress,'804高雄市鼓山區M75X+JC');
assert.equal(sanitize('M75X+JC'),'');


for (const path of ['src/routes/_app.index.tsx',placesPath,'src/lib/home-nearby-search.ts','src/lib/place-display-address.ts']) {
  const result=ts.transpileModule(source(path),{fileName:path, reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
  assert.equal((result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,path);
}

console.log('verify-build92-stability: PASS (Home settlement/stale/cache, Explore outcomes/cancellation/selection, address formatting; mocked providers only)');
