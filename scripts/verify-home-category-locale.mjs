import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {placeCategoryDisplay} from '../src/lib/native-qa-display.ts';
import {resolvePlaceIdentity} from '../src/lib/place-identity.ts';
import {translate} from '../src/lib/i18n/translate.ts';
const source=readFileSync('src/components/home/HomeNearbyPlaceCards.tsx','utf8');
const fn=source.slice(source.indexOf('function buildCardDisplay('),source.indexOf('const HomeNearbyCardItem'));
const js=ts.transpile(source.match(/const HOME_NEARBY_IMAGE_PRIORITY_COUNT = \d+;/)[0]+'\n'+fn,{target:ts.ScriptTarget.ES2022});
const build=new Function('placeCategoryDisplay','homeNearbyImageUrl','homeNearbyOpeningBadgeLabel',js+';return buildCardDisplay;')(placeCategoryDisplay,()=>null,()=>'');
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
for(const type of ['bar','cafe','restaurant','park','museum']) {
 const p={id:'ChIJOfflineCategory',name:'Fixture',primaryType:type,types:[type],displayCategory:'酒吧',lat:1,lng:2};
 const before=JSON.stringify(p),identity=resolvePlaceIdentity(p);
 for(const locale of ['en','zh-TW','ja','ko']) {
  const card=build(p,0,1,{lat:0,lng:0},false,locale,new Set(),'fallback',null,null);
  assert.equal(card.typeName,translate(locale,`nativeQa.category_${identity}`));
  assert.ok(!card.typeName.startsWith('nativeQa.'));
  if(type==='bar'&&locale==='en') assert.equal(card.typeName,'Bar');
  assert.equal(JSON.stringify(p),before);
 }
}
assert.match(source,/\[places, anchor, canShowDistance, locale,/);
console.log('PASS actual Home card display: 5 categories × 4 locales, stale Chinese cache, locale dependency, immutable identity');
