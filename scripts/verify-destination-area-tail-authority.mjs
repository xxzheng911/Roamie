import assert from 'node:assert/strict';
import {resolveDestinationAreaScope,extractGenericDestinationAreaCandidate} from '../src/lib/ai/destination-travel-profile.ts';
import {resolveDestinationFromText} from '../src/lib/ai/trip-planning-context.ts';
import {parseTravelContextFromText,mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {buildDestinationDirectionAck} from '../src/lib/ai/trip-duration-guard.ts';
// Network is forbidden in this pure authority regression.
globalThis.fetch=()=>{throw new Error('Unexpected network in authority regression');};
const fixtures=[['香港天氣怎麼樣','香港'],['11月香港天氣怎麼樣','香港'],['香港11月天氣如何','香港'],['香港最近會下雨嗎','香港'],['東京新宿天氣怎麼樣','東京新宿'],['首爾弘大11月天氣','首爾弘大'],['大阪梅田適合住嗎','大阪梅田'],['京都祇園想找安靜咖啡廳','京都祇園'],['台北信義區今天想逛街','台北信義區']];
const destination=t=>resolveDestinationAreaScope(t)?.displayLabel??resolveDestinationFromText(t);
for(const [text,expected] of fixtures) assert.equal(destination(text),expected,text);
for(const suffix of ['怎麼樣','如何','好玩嗎','適合嗎','值得去嗎','有什麼推薦','想去哪裡','想吃什麼','天氣','會下雨嗎','冷不冷','熱不熱']) {
 assert.equal(destination('香港'+suffix),'香港',suffix);
 assert.equal(extractGenericDestinationAreaCandidate('香港'+suffix),null,suffix+' cannot promote');
 assert.equal(destination('大阪梅田'+suffix),'大阪梅田',suffix+' preserves uncurated area');
}
for(const [text,expected] of [['香港天气怎么样','香港'],['香港会下雨吗','香港'],['大阪梅田天气如何','大阪梅田'],['屏東恆春天氣如何','屏東恆春']])assert.equal(destination(text),expected,text);
for(const text of ['香港','東京','首爾'])assert.equal(destination(text),text);
for(const text of fixtures.slice(0,4).map(x=>x[0]))assert.equal(parseTravelContextFromText(text,createEmptySession()).destination,'香港');
const first=mergeTravelContext(createEmptySession(),'11月香港天氣怎麼樣');
assert.equal(first.context.destination,'香港');
const advice=processAdviceTurn('11月香港天氣怎麼樣',first.session,first.context,undefined,'zh-TW');
assert.equal(advice.advice.pendingQuestion.baseDestination,'香港');
const session={...first.session,travelContext:first.context,pendingQuestion:advice.advice.pendingQuestion};
const second=mergeTravelContext(session,'3天');
assert.equal(second.context.destination,'香港');assert.equal(second.context.days,3);
assert.equal(session.pendingQuestion.baseDestination,'香港');
assert.match(buildDestinationDirectionAck({destination:second.context.destination,days:second.context.days,locale:'zh-TW'}),/香港 3 天/);
console.log('PASS area-tail authority: weather, conversational predicates, real areas, city-only, actual pending-days handoff; no network');
