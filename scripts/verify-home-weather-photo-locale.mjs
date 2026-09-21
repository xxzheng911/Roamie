import assert from 'node:assert/strict';
import { homeWeatherMetadata, homeWeatherCondition } from '../src/lib/home-weather-metadata.ts';
import { localizeWeatherSummary } from '../src/lib/weather-scene.ts';
import { generatedPlacesForLocale } from '../src/lib/generated-display-projection.ts';
import { buildUnifiedPlaceCard } from '../src/lib/unified-place-card.ts';
import { homeNearbyImageUrl } from '../src/lib/home-nearby-image.ts';
import { settlePlacePhotoRequest } from '../src/lib/place-photo-request.ts';
import { writeHomeNearbyResultsCache, readHomeNearbyResultsCache } from '../src/lib/home-nearby-picks-policy.ts';

const weather={city:'目前位置',tempC:27,condition:'少雲',iconType:'1',source:'open-meteo-fallback',available:true,scene:'night',recommendationText:'舊中文'};
const expected={ 'zh-TW':['目前位置','少雲'],en:['Current location','Few clouds'],ja:['現在地','晴れ'],ko:['현재 위치','구름 조금']};
const photo='places/ChIJ_fixture/photos/photo-a';
const place={id:'ChIJ_fixture',googlePlaceId:'ChIJ_fixture',name:'Official Cafe',placeName:'Official Cafe',type:'cafe',primaryType:'cafe',types:['cafe'],lat:25,lng:121,photoName:photo,photoUrl:'https://images.example/photo.jpg',generatedImageUrl:'https://images.example/generated.jpg',fallbackImageUrl:'https://images.example/fallback.jpg',reason:'舊理由',description:'舊描述'};
const originals=JSON.stringify({weather,place});
for(const locale of Object.keys(expected)){
 const projected=localizeWeatherSummary(weather,locale);
 assert.deepEqual(Object.values(homeWeatherMetadata(projected,locale)),expected[locale]);
 assert.equal(homeWeatherMetadata({...weather,city:'Seoul'},locale).city,'Seoul');
 const recommendation=generatedPlacesForLocale([place],{generatedLocale:'zh-TW'},locale)[0];
 const card=buildUnifiedPlaceCard({place:recommendation,locale});
 for(const key of ['id','googlePlaceId','photoName','photoUrl','generatedImageUrl','fallbackImageUrl'])assert.equal(card[key],place[key]);
 writeHomeNearbyResultsCache('fixture:'+locale,[card]);
 const cached=readHomeNearbyResultsCache('fixture:'+locale)[0];
 assert.ok(homeNearbyImageUrl(cached)?.includes('photo='));
 assert.equal(homeNearbyImageUrl({photoUrl:place.photoUrl}),place.photoUrl);
 console.log('PASS weather metadata, projection, Home cache and photo identity:',locale);
}
assert.equal(JSON.stringify({weather,place}),originals,'Projection never mutates persisted canonical facts');
for(const [source,cases] of Object.entries({'openweather':[[800,'Clear'],[801,'FewClouds'],[802,'PartlyCloudy'],[804,'Overcast'],[500,'Rain'],[600,'Snow'],[201,'Thunderstorm'],[701,'Fog']],'open-meteo-fallback':[[0,'Clear'],[2,'PartlyCloudy'],[3,'Overcast'],[61,'Rain'],[71,'Snow'],[95,'Thunderstorm'],[45,'Fog']]})){
 for(const [code,condition] of cases)assert.equal(homeWeatherCondition({...weather,source,iconType:String(code)}),condition);
}
assert.equal(homeWeatherMetadata({...weather,iconType:'bad'},'ko').condition,'날씨 정보 없음');
assert.equal(homeWeatherMetadata({...weather,iconType:undefined},'ko').condition,'날씨 정보 없음');
assert.equal(homeNearbyImageUrl({}),null,'Only absent sources use async/no-photo fallback');
assert.equal(homeNearbyImageUrl({coverImageUrl:'',photoUrl:place.photoUrl}),place.photoUrl);
assert.equal(homeNearbyImageUrl({generatedImageUrl:place.generatedImageUrl}),place.generatedImageUrl);
assert.equal(homeNearbyImageUrl({fallbackImageUrl:place.fallbackImageUrl}),place.fallbackImageUrl);
let calls=0;
assert.equal(await settlePlacePhotoRequest(async()=>{if(++calls===1)throw Error('network');return 'signed';},10,0),'signed');
assert.equal(calls,2);
assert.equal(await settlePlacePhotoRequest(async()=>{throw Error('offline');},10,0),null);
let aborted=0;
assert.equal(await settlePlacePhotoRequest(signal=>new Promise(()=>signal.addEventListener('abort',()=>aborted++)),5,0),null);
assert.equal(aborted,2);
assert.equal(await settlePlacePhotoRequest(async()=>null,10,0),null);
console.log('PASS weather code projection / legacy cache switching / photo retry, rejection, timeout and no-photo fallback');
