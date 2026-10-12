import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {ensureDestinationCombinationsReady,setCachedDiscoveredCombinations,clearDiscoveredCombinationsCache,getCachedDiscoveredCombinations} from '../src/lib/ai/destination-combination-discovery.ts';
import {clearLocalizedPlaceNameCache} from '../src/lib/place-localization/localized-place-name-cache.ts';
import {hasForeignLocalScript,resolvePlaceDisplayName,isCompleteLocalizationForLocale,isDeliverablePlaceNameForLocale} from '../src/lib/place-display-name.ts';
import {normalizeGooglePlace} from '../src/lib/ai/normalize-google-place.ts';
import {buildDestinationCombinationSuggestionPayload,getDestinationCombinations,buildOfferedCombinationsForSession} from '../src/lib/ai/destination-combination-suggestions.ts';
let network=0;globalThis.fetch=async()=>{network++;throw Error('NO_NETWORK')};
const labels={en:['Clerigos Tower','Porto Cathedral','Bolsa Palace','Sao Francisco Church','Fernandina Walls','Dom Luis Bridge','Serralves Museum','Soares dos Reis Museum','Porto Photography Museum','Romantic Museum','Tram Museum','World of Discoveries Museum','Crystal Palace Gardens','City Park','Virtudes Garden','Passeio Alegre Garden','Botanical Garden','Covelo Park'],ja:['クレリゴスの塔','ポルト大聖堂','ボルサ宮殿','サンフランシスコ教会','フェルナンディナ城壁','ドンルイス橋','セラルヴェス美術館','ソアレスドスレイス美術館','写真博物館','ロマンティック博物館','路面電車博物館','世界探検博物館','クリスタルパレス庭園','都市公園','ヴィルトゥデス庭園','パセイオアレグレ庭園','植物園','コヴェロ公園'],'zh-TW':['教士塔','波爾圖主教座堂','證券交易所宮','聖方濟各教堂','費爾南迪納城牆','路易一世大橋','塞拉維斯美術館','蘇亞雷斯博物館','攝影博物館','浪漫博物館','電車博物館','世界探索博物館','水晶宮花園','城市公園','美德花園','歡樂花園','植物園','科韋洛公園']};

labels.ko=['클레리구스 탑','포르투 대성당','볼사 궁전','상프란시스쿠 성당','페르난디나 성벽','동 루이스 다리','세랄베스 미술관','소아레스 박물관','사진 박물관','낭만 박물관','전차 박물관','세계 탐험 박물관','수정궁 정원','도시 공원','비르투드 정원','파세이우 정원','식물원','코벨루 공원'];
// Synthetic provider fixtures: labels do not assert these attractions exist in either test city.
const locales=['ja','en','zh-TW','ko'];
if(!process.env.NAME_CASE){
 for(const name of ['清水寺','金閣寺','京都国立博物館','ハットルグリムス教会','きよみずでら','ブルーラグーン']){
  assert.equal(hasForeignLocalScript(name,'ja'),false);
  const original=resolvePlaceDisplayName({name},'ja');assert.equal(original.languageCode,'und');assert.equal(isCompleteLocalizationForLocale(original,'ja').ok,false);assert.equal(isDeliverablePlaceNameForLocale(original,'ja').ok,true);
  const provider=normalizeGooglePlace({id:'ChIJJapanese'+name,displayName:{text:name,languageCode:'ja'},location:{latitude:35,longitude:135},types:['tourist_attraction']},{locale:'ja'});
  assert.equal(provider.sourceLocale,'ja');assert.equal(provider.localizedDisplayName,name);assert.equal(provider.languageCode,'ja');
 }
 for(const locale of locales)for(const name of ['清水寺','きよみずでら','ブルーラグーン','教会カフェ','Old Cathedral','경복궁','國立博物館','国立博物馆','Ακρόπολη']){
  const r=resolvePlaceDisplayName({name},locale);assert.ok(isDeliverablePlaceNameForLocale(r,locale).ok);
 }
 for(const name of ['', '++++', '849VCWC8+R9']){const r=resolvePlaceDisplayName({name,originalName:name},'ja');if(name)assert.equal(isDeliverablePlaceNameForLocale(r,'ja').ok,false)}
 clearLocalizedPlaceNameCache();
 const id='ChIJMetadataUpdate';const unknown=resolvePlaceDisplayName({name:'清水寺',placeId:id},'ja');assert.equal(unknown.languageCode,'und');
 const updated=resolvePlaceDisplayName({name:'清水寺',placeId:id,sourceLocale:'ja'},'ja');assert.equal(updated.languageCode,'ja');assert.equal(updated.localizationSource,'google_locale');
 assert.deepEqual(resolvePlaceDisplayName({name:'清水寺',placeId:id,sourceLocale:'ja'},'ja').localizedDisplayName,updated.localizedDisplayName);
 const other=resolvePlaceDisplayName({name:'金閣寺',placeId:'ChIJOtherMetadata',sourceLocale:'ja'},'ja');assert.equal(other.localizedDisplayName,'金閣寺');
 const english=resolvePlaceDisplayName({name:'清水寺',sourceLocale:'ja',englishName:'Kiyomizu Temple'},'ko');assert.equal(english.localizedDisplayName,'Kiyomizu Temple');assert.equal(english.languageCode,'en');
 // Same identity, four explicitly supplied names: switching locale cannot change identity.
 for(const locale of locales){const r=resolvePlaceDisplayName({name:'清水寺',sourceLocale:'ja',placeId:id,localizedNames:{ja:'清水寺',en:'Kiyomizu Temple','zh-TW':'清水寺',ko:'기요미즈데라'}},locale);assert.equal(r.placeId,id);assert.equal(r.localizedDisplayName,({ja:'清水寺',en:'Kiyomizu Temple','zh-TW':'清水寺',ko:'기요미즈데라'})[locale]);}
 const failures=[];
 const cases=[...['Kyoto','Reykjavík'].flatMap(city=>locales.map(locale=>({city,locale}))),...['missing_id','missing_coordinates','invalid_coordinates','nonfinite_coordinates','duplicate_id','out_of_scope','transit'].flatMap(defect=>['ja','en'].map(locale=>({city:'Kyoto',locale,defect})))];
 for(const {city,locale,defect} of cases){
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['node_modules/vite-node/dist/cli.mjs','--config','scripts/vite.verify.config.mjs','scripts/verify-japanese-place-eligibility.mjs'],{env:{...process.env,NAME_CASE:city,NAME_LOCALE:locale,NAME_DEFECT:defect??'',VITE_VERBOSE_LOG:'1'},stdio:['ignore','pipe','pipe']});let log='';p.on('error',reject);p.stdout.on('data',d=>{log+=d});p.stderr.on('data',d=>{log+=d});p.on('close',c=>{if(c){console.error(log.slice(-4000));failures.push(city+' '+locale+(defect?' '+defect:''));resolve()}else{console.log(log.split('\n').filter(l=>l.startsWith('FUNNEL')||l.startsWith('NEGATIVE')).join('\n'));resolve()}})});
 }
 assert.deepEqual(failures,[], 'Independent discovery/renderer failures must remain visible');
 assert.equal(network,0);console.log('PASS 8 independent cold processes; actual discovery; renderer outcomes reported separately; warm and locale switch; metadata, fallback, identity and invalid candidates; no live providers.');
}else{
 const city=process.env.NAME_CASE,locale=process.env.NAME_LOCALE;const [code,lat,lng]=city==='Kyoto'?['JP',35.01,135.76]:['IS',64.146,-21.94];
 let logs=[];const output=console.log;for(const k of ['log','info','warn'])console[k]=(...args)=>logs.push(args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));
 const pool=labels[locale].map((name,i)=>({id:`ChIJTest${code}Place${i}`,name,sourceLocale:locale,localizedNames:{[locale]:name},lat:lat+i*.0003,lng,types:[i<6?'tourist_attraction':i<12?'museum':'park'],primaryType:i<6?'tourist_attraction':i<12?'museum':'park',rating:4.6,userRatingCount:10000,address:`${city} ${code}`,businessStatus:'OPERATIONAL'}));
 const defect=process.env.NAME_DEFECT;
 if(defect) for(const p of pool){if(defect==='missing_id')p.id='';else if(defect==='invalid_coordinates'){p.lat=91;p.lng=181}else if(defect==='nonfinite_coordinates'){p.lat=NaN;p.lng=Infinity}else if(defect==='duplicate_id')p.id='ChIJRepeatedProviderIdentity';else if(defect==='missing_coordinates'){delete p.lat;delete p.lng}else if(defect==='out_of_scope'){p.lat=-40;p.lng=-70}else{p.primaryType='airport';p.types=['airport']}}
 const original=JSON.stringify(pool);let calls=0;
 const assertIdentity=(result)=>{for(const combo of result.combinations??[])for(const p of combo.placeCandidates??[]){const expected=pool.find(x=>x.id===p.googlePlaceId);assert.ok(expected,'returned identity belongs to provider pool');assert.deepEqual(p.coordinates,{lat:expected.lat,lng:expected.lng});}};
 const params={destination:city,destinationCountry:code,locale,days:4,generationRequestId:'cold-'+code+locale,resolvedDestination:{label:city,city,country:code,countryCode:code,type:'city',latitude:lat,longitude:lng,placeId:'ChIJTestCity'+code,source:'trip_destination',scopeLocked:false},searchPlaces:async()=>{calls++;return {places:pool,error:null}}};
 const ready=await ensureDestinationCombinationsReady(params);assert.equal(JSON.stringify(pool),original);assert.ok(calls<=12);
 if(defect){output('NEGATIVE',JSON.stringify({city,locale,defect,success:ready.ok,reason:ready.failureReason??null,calls}));assert.equal(ready.ok,false,defect+' must remain rejected');output('NEGATIVE',defect,city,locale,'PASS');assert.equal(network,0)}else{
 const candidate=JSON.parse(logs.findLast(l=>l.includes('candidate_summary ')).split('candidate_summary ')[1]);assert.equal(candidate.uniqueCount,18);assert.equal(candidate.eligibleCount,18);
 const payload=buildDestinationCombinationSuggestionPayload(city,4,{locale});
 if(ready.ok&&!payload) output('RENDER_MISMATCH',JSON.stringify({city,locale,display:getDestinationCombinations(city,{locale,tripDays:4}),offered:buildOfferedCombinationsForSession(city,locale).map(g=>({title:g.title,places:g.places.map(p=>p.name)}))}));
 if(ready.ok){assertIdentity(ready);assert.ok(ready.combinations.length>=2);assert.ok(payload);
  const delivered=payload.offeredCombinations.flatMap(c=>c.places);
  for(const p of delivered){const originalPlace=pool.find(x=>x.id===p.googlePlaceId);assert.ok(originalPlace);assert.equal(p.localizedDisplayName,originalPlace.name);assert.equal(p.latitude,originalPlace.lat);assert.equal(p.longitude,originalPlace.lng)}
  // Restore actual discovery output, not a prebuilt successful selection fixture.
  const restored=JSON.parse(JSON.stringify(ready.combinations));clearDiscoveredCombinationsCache();setCachedDiscoveredCombinations(city,restored);
  assert.ok(buildDestinationCombinationSuggestionPayload(city,4,{locale}));
  const broken=JSON.parse(JSON.stringify(restored));delete broken[0].primaryCandidates[0].coordinates;
  clearDiscoveredCombinationsCache();setCachedDiscoveredCombinations(city,broken);
  assert.equal(getCachedDiscoveredCombinations(city,undefined,undefined,{locale}),null,'restored invalid primary identity cannot be delivered');
  clearDiscoveredCombinationsCache();setCachedDiscoveredCombinations(city,restored);
  assert.equal(buildDestinationCombinationSuggestionPayload(city,4,{locale,forceCombinations:[{title:'one',places:['Unverified Replacement A','Unverified Replacement B']},{title:'two',places:['Unverified Replacement C','Unverified Replacement D']}]}),null,'theme-only replacement cannot borrow verified identity');
  const count=calls;const warm=await ensureDestinationCombinationsReady(params);assert.ok(warm.ok);assertIdentity(warm);assert.equal(calls,count);
  for(const l of locales){const switched=await ensureDestinationCombinationsReady({...params,locale:l});assertIdentity(switched);assert.equal(calls,count,'locale switch must reuse identity pool')}
 }else{assert.equal(ready.failureReason,'insufficient_combinations');assert.equal(payload,null)}
 output('FUNNEL',JSON.stringify({city,locale,calls,raw:candidate.rawCount,unique:candidate.uniqueCount,eligible:candidate.eligibleCount,final:candidate.combinationCount,success:ready.ok,renderer:!!payload,reason:ready.failureReason??null,topup:logs.find(l=>l.includes('[COMBINATION_PREFERRED_TOP_UP]'))}));
 if(ready.ok) assert.ok(payload,'Discovery success must render identity-backed combinations');
 }
 assert.equal(network,0);
}
