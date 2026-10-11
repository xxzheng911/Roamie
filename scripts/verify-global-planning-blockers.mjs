import assert from 'node:assert/strict';
import {createEmptySession} from '../src/lib/chat-session.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {buildCountryCitySelectionReply} from '../src/lib/ai/destination-advice.ts';
import {buildItineraryPlanningReply} from '../src/lib/ai/itinerary-planning.ts';
import {buildNextStepAfterAdviceSelection,pendingQuestionForDestinationStyleChoice,USE_DEFAULT_ROUTES} from '../src/lib/ai/destination-pending-question.ts';
import {clearCountryCityOptionsCache} from '../src/lib/ai/country-city-options.ts';

globalThis.fetch = async () => { throw Error('OFFLINE_ONLY'); };
const foreignChineseCopy=/最佳旅行時間|特色時段|你比較想|前段排|我會建議|幫你|幾天|大致落在/;
const questions={'zh-TW':'什麼時候去日本最好？',en:'When is the best time to visit Japan?',ja:'日本に旅行する時期はいつがいいですか？',ko:'일본 여행은 언제 가면 좋아요?'};
for(const locale of ['zh-TW','en','ja','ko']) {
 const ctx={interests:[],destination:'日本',destinationCountry:'日本',destinationType:'country'};
 const session={...createEmptySession(),travelContext:ctx,conversationMode:'destination_planning',activeChatIntent:'destination_advice'};
 for(const query of [questions[locale], '什麼時候去日本最好？']) {
  const result=processAdviceTurn(query,session,ctx,undefined,locale);
  assert.ok(result.advice.reply,`${locale} real advice dispatch`);
  if(locale !== 'zh-TW') assert.doesNotMatch(result.advice.reply,foreignChineseCopy);
  else assert.match(result.advice.reply,/推薦|旅行|時間/);
  assert.equal(result.session.travelContext.destinationCountry,'日本');
 }
 const summary=buildItineraryPlanningReply({...ctx,destination:'東京',days:4},['food'],locale);
 assert.ok(summary.includes('4'));
 if(locale !== 'zh-TW') assert.doesNotMatch(summary,foreignChineseCopy);
 const selected=buildNextStepAfterAdviceSelection('food',{type:'preference_choice',options:[],baseDestination:'東京'}, {...ctx,destination:'東京',days:4},locale);
 assert.ok(selected.reply);
 if(locale !== 'zh-TW') assert.doesNotMatch(selected.reply,foreignChineseCopy);
}
// Place labels come from trusted metadata, never a new production city table.
clearCountryCityOptionsCache();
const options=[
 {name:'雷克雅未克',originalName:'Reykjavik',type:'city',summary:'fixture',localizedNames:{en:'Reykjavik',ja:'レイキャビク',ko:'레이캬비크'}},
 {name:'藍湖',originalName:'Blue Lagoon',type:'region',summary:'fixture'},
 {name:'南部海岸',originalName:'South Coast',type:'region',summary:'fixture'},
];
for(const locale of ['en','ja','ko']) {
 const reply=buildCountryCitySelectionReply({country:'冰島',cityOptions:options,locale}).reply;
 assert.ok(reply.includes(options[0].localizedNames[locale]));
 assert.ok(reply.includes('Blue Lagoon'));
 assert.doesNotMatch(reply,/雷克雅未克|藍湖|南部海岸|你比較想/);
}
// Unknown labels without trusted translation must stay identifiable, not invented.
clearCountryCityOptionsCache();
const raw=buildCountryCitySelectionReply({country:'冰島',locale:'en',cityOptions:options.map(o=>({...o,localizedNames:undefined,originalName:undefined}))});
assert.ok(raw.reply.includes('雷克雅未克'));
for(const destination of ['蒙古','Portugal','Iceland','Japan','Uncharted Valley','Tokyo + Osaka']) {
 const pending=pendingQuestionForDestinationStyleChoice(destination);
 assert.doesNotThrow(()=>buildNextStepAfterAdviceSelection(USE_DEFAULT_ROUTES,pending,{interests:[],destination},'zh-TW'),destination);
}
console.log('PASS blocker regression: actual locale advice dispatch, summary/pending, trusted/original name display, generic pending paths. No real API.');
