import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const {Module}=require('node:module');
const result=await build({entryPoints:['src/components/saved/TripOutfitCard.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],plugins:[{
 name:'fixture-i18n',setup(b){b.onResolve({filter:/^@\/hooks\/use-i18n$/},()=>({path:'i18n',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useI18n=()=>({locale:globalThis.__outfitLocale,t:key=>key});',loader:'js'}));}
}]});
const module=new Module(resolve('scripts/outfit-card-fixture.cjs'));module.filename=resolve('scripts/outfit-card-fixture.cjs');module.paths=require.resolve.paths('react');module._compile(result.outputFiles[0].text,module.filename);
const {TripOutfitCard}=module.exports;
const copies={
 'zh-TW':['歷史氣候參考','同期日低溫／高溫平均','歷史同期氣候參考，非實際天氣預報。','天氣資料來源：Visual Crossing'],
 en:['Historical climate reference','Period mean daily lows / highs','Historical climate for this time of year, not an actual weather forecast.','Weather data provided by Visual Crossing'],
 ja:['過去の気候の参考','同時期の日最低・最高気温の平均','同時期の過去の気候に基づく参考情報であり、実際の天気予報ではありません。','気象データ提供：Visual Crossing'],
 ko:['과거 기후 참고','동기간 일 최저 / 최고 기온 평균','같은 시기의 과거 기후 참고이며 실제 일기 예보가 아닙니다.','날씨 데이터 제공: Visual Crossing'],
};
const base={destination:'日本・東京都',dateRange:{start:'2026-11-25',end:'2026-11-30'}};
const render=p=>renderToStaticMarkup(createElement(TripOutfitCard,{...base,...p}));
for(const [locale,[label,meaning,disclaimer,source]] of Object.entries(copies)){
 globalThis.__outfitLocale=locale;
 const html=render({weatherSource:'visual-crossing-stats',weatherSummary:`${label} · 9–14°C · ${meaning}`,suggestion:`Seasonal advice\n\n${disclaimer}`});
 assert.ok(html.includes(`${label} · 9–14°C`));assert.ok(!html.includes(meaning));
 assert.equal(html.split(disclaimer).length-1,1);assert.ok(html.includes('Seasonal advice'));
 assert.ok(html.indexOf('Seasonal advice')<html.indexOf(disclaimer));assert.ok(html.indexOf(disclaimer)<html.indexOf(source));
 assert.ok(html.includes('text-[11px]'));assert.ok(html.includes('href="https://www.visualcrossing.com/"'));assert.ok(html.includes('rel="noopener noreferrer"'));
 const forecast=render({weatherSource:'openweather',weatherSummary:'Forecast 12–20°C · rain 30%',suggestion:'Forecast advice'});
 assert.ok(forecast.includes('Forecast 12–20°C · rain 30%'));assert.ok(forecast.includes('Forecast advice'));assert.ok(!forecast.includes(disclaimer));assert.ok(!forecast.includes('visualcrossing.com'));
 const pending=render({loading:true,weatherSource:'unavailable',suggestion:'Seasonal fallback hidden',weatherSummary:'Old weather hidden'});
 assert.ok(pending.includes('role="status"'));assert.ok(pending.includes('aria-busy="true"'));assert.ok(pending.includes('min-h-36'));
 assert.ok(!pending.includes('Seasonal fallback hidden'));assert.ok(!pending.includes('Old weather hidden'));
 const fallback=render({weatherSource:'unavailable',weatherSummary:'',suggestion:'Seasonal fallback unchanged'});
 assert.ok(fallback.includes('Seasonal fallback unchanged'));assert.ok(!fallback.includes(disclaimer));assert.ok(!fallback.includes('visualcrossing.com'));
}
delete globalThis.__outfitLocale;
console.log('PASS rendered card: four locales, saved historical summary simplified, one secondary disclaimer, bottom attribution/link preserved, forecast/fallback unchanged. No provider/AI calls.');
