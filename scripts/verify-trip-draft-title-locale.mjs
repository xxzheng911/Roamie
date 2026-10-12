import assert from 'node:assert/strict';
import {workspaceTitleDisplay,tripTitleDisplay} from '../src/lib/trip/title-display.ts';
import {itineraryDestinationDisplay} from '../src/lib/native-qa-display.ts';
import {resolveCoreTripTitle} from '../src/lib/trip/core-trip.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const workspace={workspaceId:'fixture',conversationId:'fixture-conversation',title:'Porto 4 天旅行規劃',titleCustom:false,destination:'Porto',tripDays:4,planningSession:{travelContext:{destinationCountry:'葡萄牙',destinationCity:'Porto',days:4,travelMonth:'12月',interests:[]}}};
const before=JSON.stringify(workspace);
const expected={en:'Portugal · Porto · 4-day trip','zh-TW':'葡萄牙 · 波爾圖 · 4 天旅行',ja:'ポルトガル · ポルト · 4日間の旅',ko:'포르투갈 · 포르투 · 4일 여행'};
for(const [locale,title] of Object.entries(expected)) {
 const restored=JSON.parse(before);
 assert.equal(workspaceTitleDisplay(restored,'fallback',locale),title);
 assert.equal(resolveCoreTripTitle({title:workspace.title,isTitleCustomized:false,customTitle:null,destinationPlace:{country:'葡萄牙',name:'Porto'},days:4},locale),title);
 assert.equal(tripTitleDisplay({title:workspace.title,custom:false,destination:'葡萄牙 · Porto',days:4},locale),title);
 assert.equal(workspaceTitleDisplay({...restored,title:'我的私人名稱 🌸',titleCustom:true},'',locale),'我的私人名稱 🌸');
 assert.equal(workspaceTitleDisplay({title:'舊中文名稱'},'',locale),'舊中文名稱');
 assert.equal(workspaceTitleDisplay({title:'舊中文名稱',titleCustom:false},'',locale),'舊中文名稱');
 assert.equal(workspaceTitleDisplay(null,'原標題',locale),'原標題');
 assert.equal(JSON.stringify(workspace),before);
}
console.log('PASS T1–T7/T9/T10 offline title, restore, custom and incomplete legacy fallback; no providers or mutation');
