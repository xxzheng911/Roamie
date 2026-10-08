import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const noop=()=>{};
const quiet={info:noop,warn:noop,error:noop,log:noop};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
function compile(text){return ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
function module(path, deps={}, globals={}) {
  const exports={};
  const context={exports,require:id=>{assert.ok(id in deps,`mock required: ${id}`);return deps[id];},
    console:quiet,Error,DOMException,AbortController,Promise,Date,Set,Map,setTimeout,clearTimeout,...globals};
  vm.runInNewContext(compile(read(path).replaceAll('import.meta.env.SSR','false').replaceAll('import.meta.env.DEV','false')),context,{filename:path});return exports;
}
function fn(path,name,env) {
  const ast=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let text;
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)text=n.getText(ast).replace(/^export /,'');ts.forEachChild(n,visit);}
  visit(ast);assert.ok(text,name);
  return vm.runInNewContext(compile(`${text};globalThis.result=${name};`)+ '\nresult',
    {console:quiet,Error,DOMException,AbortController,Promise,Date,Set,Map,setTimeout,clearTimeout,...env});
}
function clock(){const timers=new Map();let id=0;return {setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:id=>timers.delete(id),fire:()=>{const pending=[...timers.values()];timers.clear();pending.forEach(f=>f());},size:()=>timers.size};}
let checks=0;
async function test(name,work){await work();checks++;console.log(`PASS ${name}`);}

await test('read-only permission prefetch cannot consume foreground permission request',async()=>{
  const checked=deferred();let checks=0,requests=0;
  const permission=module('src/lib/location-permission-manager.ts',{
    '@/lib/capacitor-native-shell':{isCapacitorNativeShell:()=>true},
    '@/lib/capacitor-geolocation':{getCapacitorGeolocation:()=>({
      checkPermissions:()=>{checks++;return checks===1?checked.promise:Promise.resolve({location:'prompt'});},
      requestPermissions:async()=>{requests++;return {location:'granted'};},
    })},
  });
  const prefetch=permission.ensureLocationPermission({request:false});
  const user=permission.ensureLocationPermission({request:true});
  const concurrent=permission.ensureLocationPermission({request:true});
  checked.resolve({location:'prompt'});await prefetch;
  assert.equal(await user,'granted');assert.equal(await concurrent,'granted');assert.equal(requests,1);
});

await test('late initial App state cannot overwrite a newer foreground event',async()=>{
  const initial=deferred();let event;
  const gate=module('src/lib/location-app-gate.ts',{
    '@capacitor/app':{App:{getState:()=>initial.promise}},
    '@/lib/capacitor-app-listener':{registerAppStateChangeListener:async cb=>{event=cb;}},
    '@/lib/capacitor-native-shell':{isCapacitorNativeShell:()=>true},
  },{window:{setTimeout},document:{hidden:false,addEventListener:noop}});
  gate.registerLocationAppGate();event(true);
  initial.resolve({isActive:false});await tick();
  assert.equal(gate.isAppActiveForLocation(),true);
});

await test('cold location pending -> ready notifies mounted consumers once; Chat waits for same bootstrap',async()=>{
  const gps=deferred();let calls=0,notifications=0;
  const location=module('src/lib/effective-location.ts',{
    '@/lib/api/constants':{KAOHSIUNG_COORDS:{lat:22,lng:120}},
    '@/lib/geo-distance':{distanceMeters:()=>1000},
    '@/lib/places-api-guard':{logPlacesSkipSmallLocationChange:noop},
    '@/lib/device-location':{requestDeviceLocation:()=>{calls++;return gps.promise;},getSessionDeviceLocation:()=>null,
      getLastKnownDeviceCoords:()=>null,shouldDeferUntilGpsFix:()=>false,shouldUseRememberedLocationFallback:()=>false},
    '@/lib/device-location-resolve':{pickFallbackCoordinates:()=>({lat:22,lng:120})},
    '@/lib/last-search-location':{readLastSearchLocation:()=>null},
    '@/lib/home-session-cache':{writeHomeSessionUserLocation:noop},
    '@/lib/home-persistent-cache':{readPersistedHomeLocation:()=>null,writePersistedHomeLocation:noop},
    '@/lib/location-key':{normalizedLocationKey:(a,b)=>`${a}:${b}`},
    '@/lib/location-app-gate':{registerLocationAppGate:noop,onAppForegroundForLocation:noop},
  });
  location.subscribeEffectiveLocation(()=>notifications++);
  assert.equal(location.getEffectiveLocationSnapshot(),null);
  const home=location.ensureEffectiveLocationBootstrap();const explore=location.ensureEffectiveLocationBootstrap();
  const chat=module('src/lib/ai/resolve-chat-location.ts',{
    '@/lib/dev-verbose-log':{devVerboseInfo:noop},'@/lib/effective-location':location,
    '@/lib/device-location':{requestDeviceLocation:()=>{throw Error('no extra GPS request');}},
    '@/lib/location-app-gate':{isAppActiveForLocation:()=>true},
  });
  const pendingChat=chat.resolveChatLocation({});await tick();assert.equal(notifications,0);
  gps.resolve({lat:22.6,lng:120.3,city:'高雄市',source:'capacitor',usedFallback:false,permission:'granted'});
  await home;await explore;const session=await pendingChat;
  assert.equal(session.location.city,'高雄市');assert.equal(calls,1);assert.equal(notifications,1);
  assert.equal(location.getEffectiveLocationSnapshot().isReadyForPlaces,true);
  assert.equal((await chat.resolveChatLocation(session)).location,session.location);
});

await test('Places single-flight queue deadline cleans up; late result cannot cache; cache hit does not dispatch',async()=>{
  const timer=clock();const timeouts=module('src/lib/search-timeout.ts',{},timer);
  const cache=new Map();let runs=0;
  const dedupe=module('src/lib/places-search-dedupe.ts',{
    '@/lib/location-key':{normalizedLocationKey:()=>''},
    '@/lib/places-search-normalize':{normalizePlacesSearchResult:r=>r},
    '@/lib/places-api-guard':{PLACES_FAILED_CACHE_TTL_MS:1000,logPlacesCacheHit:noop,logPlacesCacheMiss:noop,logPlacesDedupePending:noop},
    '@/lib/places-diagnostics':{logPlacesApiSkipDuplicate:noop},
    '@/lib/search-radius':{homeNearbySearchRadiusMeters:()=>1000},
    '@/lib/search-timeout':timeouts,
    '@/lib/unified-place-cache':{consumeUnifiedPlaceCacheForceRefresh:()=>false,readUnifiedPlaceSearchCache:k=>cache.get(k),
      writeUnifiedPlaceSearchCache:(k,places,error)=>cache.set(k,{places,error}),buildUnifiedPlaceCacheKey:()=> 'detail'},
  });
  const provider=deferred();const runner=()=>{runs++;return provider.promise;};
  const first=dedupe.getPlacesSearchCachedOrRun('queue',runner,{timeoutMs:10});const second=dedupe.getPlacesSearchCachedOrRun('queue',runner,{timeoutMs:10});
  let result;first.then(value=>{result=value;});
  await tick();assert.equal(runs,1);timer.fire();await tick();
  assert.ok(result,'queue timeout must settle');assert.match(result.error,/timeout/);await second;
  provider.resolve({places:[{id:'late'}],error:null});await tick();assert.equal(cache.size,0);
  await dedupe.getPlacesSearchCachedOrRun('queue',async()=>({places:[{id:'fresh'}],error:null}));
  assert.equal(cache.get('queue').places[0].id,'fresh');
  await dedupe.getPlacesSearchCachedOrRun('queue',()=>{throw Error('cache must not dispatch');});
  const abort=new AbortController();abort.abort();
  await assert.rejects(dedupe.getPlacesSearchCachedOrRun('aborted',runner,{signal:abort.signal}),{name:'AbortError'});
});

await test('provider deadline aborts transport and clears timer, including stalled body; cancellation is distinct',async()=>{
  const timer=clock();const timeouts=module('src/lib/search-timeout.ts',{},timer);let received;
  assert.equal(typeof timeouts.withAbortableSearchTimeout,'function');
  const pending=timeouts.withAbortableSearchTimeout(async signal=>{received=signal;return new Promise(noop);},10);
  timer.fire();await assert.rejects(pending,{name:'TimeoutError'});assert.equal(received.aborted,true);assert.equal(timer.size(),0);
  const synchronousAbort=timeouts.withAbortableSearchTimeout(signal=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  }),10);
  timer.fire();await assert.rejects(synchronousAbort,{name:'TimeoutError'});
  const abort=new AbortController();const cancelled=timeouts.withAbortableSearchTimeout(()=>new Promise(noop),10,abort.signal);
  abort.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(timer.size(),0);
});

await test('Explore category failure survives card aggregation; genuine empty and recovered cards are unchanged',async()=>{
  for(const kind of ['error','empty','recovery']) {
    const pending=new Map();let calls=0;
    const env={canRunExploreBrowse:()=>true,normalizedLocationKey:()=> 'loc',exploreTimeBucket:()=> 'day',
      categorySearchFlightKey:()=> 'flight',categorySearchInFlight:pending,
      buildExploreRequestKey:()=> 'request',buildCategoryMapCacheKey:()=> 'cache',readMapPlacesCache:()=>null,
      getExploreRequestInFlight:()=>null,registerExploreRequestInFlight:(_,p)=>p,
      searchExploreCategoryPlacesInner:async(_,ctx)=>{const result=await ctx.searchPlacesFn({});return kind==='recovery'?[{id:'saved'}]:result.places;},
    };
    const search=fn('src/lib/explore-category-search.ts','searchExploreCategoryPlaces',env);
    const result=search({id:'cafe'},{userLocation:{lat:22,lng:120},locale:'zh-TW',saved:[],searchPlacesFn:async()=>{calls++;return {places:[],error:kind==='empty'?null:'places_provider_unavailable'};}});
    if(kind==='error')await assert.rejects(result,/provider_unavailable/);else assert.equal((await result).length,kind==='empty'?0:1);
    assert.equal(calls,1);assert.equal(pending.size,0);
  }
});
await test('provider deadline includes queue age; no dispatch after expiry and no retry on timeout',async()=>{
  const timer=clock();const timeouts=module('src/lib/search-timeout.ts',{},timer);
  let now=0,googleCalls=0,transportSignal;
  const env={...timeouts, Date:{now:()=>now},PLACES_FIELD_MASK:'mock',
    buildPlacesHttpKey:()=> 'key',bucketPlacesCoordinate:x=>x,getExploreRequestSession:()=>null,placesQueryFamily:()=> 'test',
    recordPlacesHttpCall:noop,devVerboseInfo:noop,
    googleRestFetch:async(_,init)=>{googleCalls++;transportSignal=init.signal;return {ok:true,status:200,json:()=>new Promise(noop)};},
    runPlacesApiDeduped:async(_,__,runner)=>runner(),
  };
  let post=fn('src/lib/places.functions.ts','postPlaces',env);
  const waiting=post('https://example.invalid',{},'mock','text',{screen:'chat'});
  await tick();timer.fire();const result=await waiting;
  assert.equal(result.error,'places_search_attempt_timeout');assert.equal(googleCalls,1);assert.equal(transportSignal.aborted,true);
  now=0;googleCalls=0;
  post=fn('src/lib/places.functions.ts','postPlaces',{...env,runPlacesApiDeduped:async(_,__,runner)=>{now=20_000;return runner();}});
  assert.equal((await post('https://example.invalid',{},'mock','text',{screen:'home'})).error,'places_search_attempt_timeout');
  assert.equal(googleCalls,0,'expired queue item must not reach Google');
});

await test('Auth hydration delayed: provider starts once after ready; timeout blocks late authenticated dispatch',async()=>{
  let auth=deferred(),calls=0;
  const transport=module('src/lib/google-rest-transport.ts',{
    '@/lib/auth-session':{getClientAuthSession:()=>auth.promise},
    '@/lib/api-url':{resolveApiUrl:()=> 'https://example.invalid/api/google'},
  },{URL,Headers,fetch:async(_,init)=>{if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');calls++;return {ok:true};}});
  const ready=transport.googleRestFetch('https://places.googleapis.com/v1/places:searchText');
  await tick();assert.equal(calls,0);auth.resolve(null);await ready;assert.equal(calls,1);
  auth=deferred();const timer=clock();const deadline=module('src/lib/search-timeout.ts',{},timer);
  const stopped=deadline.withAbortableSearchTimeout(signal=>transport.googleRestFetch('https://places.googleapis.com/v1/places:searchText',{signal}),10);
  await tick();timer.fire();await assert.rejects(stopped,{name:'TimeoutError'});
  auth.resolve(null);await tick();assert.equal(calls,1,'no extra Google dispatch after timeout');
});

await test('Chat timeout terminates fallback attempts; provider failure is not a genuine empty result',async()=>{
  let calls=0;
  const search=fn('src/lib/ai/chat-place-recommendation.ts','fetchPlacesWithSearchAttempts',{
    logChatPlacesRequest:noop,logChatTextSearchRequest:noop,logChatPlacesError:noop,
    runPlaceSearch:async()=>{calls++;throw new Error('places_search_attempt_timeout');},
  });
  await assert.rejects(search(noop,22,120,'zh-TW',[{mode:'text',query:'first'},{mode:'text',query:'second'}]),/timeout/);
  assert.equal(calls,1,'no fallback Google call after timeout');
  const timer=clock();const timeouts=module('src/lib/search-timeout.ts',{},timer);
  const run=fn('src/lib/ai/chat-place-recommendation.ts','runPlaceSearchUncached',{
    ...timeouts,logAiPipeline:noop,placesStatsPayload:x=>x,buildPlacesSearchKey:()=> 'key',
  });
  const stalled=run(()=>new Promise(noop),22,120,'zh-TW',{mode:'text',query:'coffee'},'shortcut',undefined,'key');
  timer.fire();await assert.rejects(stalled,/places_search_attempt_timeout/);
  await assert.rejects(run(async()=>({places:[],error:'places_search_attempt_timeout'}),22,120,'zh-TW',{mode:'text',query:'coffee'},'shortcut',undefined,'key'),/timeout/);
});

await test('Unified timeout cannot enter a server-to-client fallback; existing cancellation contract retained',async()=>{
  let fallbackCalls=0;
  const env={CHAT_PLACES_SEARCH_TIMEOUT_MS:10000,isCapacitorNativeShell:()=>false,getExploreRequestSession:()=>null,
    buildPlacesSearchKey:()=> 'key',logPlacesApiCall:noop,devVerboseInfo:noop,
    normalizePlacesSearchResult:r=>r??{places:[],error:null},isPlacesRateLimited:()=>false,
    getPlacesSearchCachedOrRun:(_,run)=>run(),runClientSearch:async()=>{fallbackCalls++;return {places:[],error:null};},
  };
  const create=fn('src/lib/places-search-unified.ts','createUnifiedSearchPlacesFn',env);
  await assert.rejects(create(async()=>({places:[],error:'places_timeout'}))({data:{}}),/places_search_attempt_timeout/);
  assert.equal(fallbackCalls,0);
});

for (const path of [
  'src/lib/location-app-gate.ts','src/lib/location-permission-manager.ts',
  'src/lib/search-timeout.ts','src/lib/places-search-dedupe.ts','src/lib/places-search-unified.ts',
  'src/lib/places.functions.ts','src/lib/explore-category-search.ts','src/lib/ai/chat-place-recommendation.ts',
]) {
  const result=ts.transpileModule(read(path),{fileName:path,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  assert.equal((result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,path);
}
console.log(`first-load-stability: ${checks} fixtures PASS; provider mocks only`);
