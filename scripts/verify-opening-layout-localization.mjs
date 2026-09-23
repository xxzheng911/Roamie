import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-opening-layout-"));
const read = (file) => fs.readFileSync(file, "utf8");
for (const [file, object] of [["src/components/RoamieResponseView.tsx","r"],["src/components/MapPlacePreview.tsx","place"],["src/components/map/MapExplorePlaceCards.tsx","p"]]) assert.ok(read(file).includes(`place={${object}}`));
assert.match(read("src/lib/home-nearby-display.ts"), /placeOpeningStatusLabel\(place, locale\)/);
assert.match(read("src/components/PlaceHoursBadge.tsx"), /placeOpeningStatusLabel\(place, locale\)/);
assert.match(read("src/components/map/PlaceDetailSheet.tsx"), /resolvePlaceDetailOpeningLine\(place, locale\)/);
for (const file of ["src/components/saved/SavedTripItineraryEditor.tsx","src/components/trip/TripAffiliateSection.tsx"]) {
 assert.match(read(file), /LOCALIZED_ACTION_GRID/); assert.match(read(file), /LOCALIZED_ACTION_BUTTON/);
}
assert.match(read("src/components/saved/SavedTripItineraryEditor.tsx"), /onClick=\{\(\) => setAddMenuDayIndex\(null\)\}/);
assert.doesNotMatch(read("src/lib/localized-action-layout.ts"), /\bif\s*\(|truncate|ellipsis|nowrap|text-\[/);
const entry = `
import {translate} from '${root}/src/lib/i18n/translate';
import {LOCALIZED_ACTION_GRID as grid,LOCALIZED_ACTION_BUTTON as button} from '${root}/src/lib/localized-action-layout';
import {openingStateForDisplay,placeOpeningStatusLabel,resolvePlaceDetailOpeningLine} from '${root}/src/lib/normalized-opening-status';
import {normalizeRecommendationItem} from '${root}/src/lib/ai/types';
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const locales=['zh-TW','en','ja','ko'];const checks=[];
const cached={normalizedOpeningLabel:'營業中',openStatusLabel:'營業中',name:'營業中咖啡館'};
for(const locale of locales){
 for(const [state,key] of [['open','place.open'],['closed','place.closed'],['closingSoon','nativeQa.closingSoon'],['unknown','place.hoursUnknown']]){
  const p={...cached,normalizedOpeningStatus:state};
  assert(openingStateForDisplay(p)===state,'canonical state '+state);
  assert(placeOpeningStatusLabel(p,locale)===translate(locale,key),'state display '+locale+state);
  assert(resolvePlaceDetailOpeningLine(p,locale)===translate(locale,key),'detail '+locale+state);
 }
 for(const [label,key] of [['營業中','place.open'],['已打烊','place.closed'],['休息中','place.closed'],['即將打烊','nativeQa.closingSoon'],['營業時間未知','place.hoursUnknown']]) assert(placeOpeningStatusLabel({normalizedOpeningLabel:label},locale)===translate(locale,key),'legacy '+label+locale);
 assert(openingStateForDisplay({normalizedOpeningLabel:'營業中咖啡館'})==='unknown','external name not sentinel');
 const restored=normalizeRecommendationItem({name:'Official Place',normalizedOpeningStatus:'closed',openStatus:'closed_now',openNow:false,openStatusLabel:'營業中'});
 assert(placeOpeningStatusLabel(JSON.parse(JSON.stringify(restored)),locale)===translate(locale,'place.closed'),'Chat model must preserve canonical state');
 for(const width of [320,375,390,430,768,820]) for(const scale of [1,1.5]){
  document.documentElement.style.fontSize=(16*scale)+'px';
  const panel=document.createElement('main');panel.style.cssText='width:'+width+'px;box-sizing:border-box;padding:16px';document.body.replaceChildren(panel);
  const families=[['productionUi.p36ee0a19b0','productionUi.pc4dc89e225','productionUi.pb9e3a78c0a'],['nativeQa.ticketSearch','nativeQa.ticketSearch'],['nativeQa.flightProduct'],['nativeQa.hotelProduct','nativeQa.hotelProduct'],['nativeQa.route']];
  for(const [family,keys] of families.entries()){
   const list=document.createElement('div');list.className=grid;panel.append(list);
   for(const [i,key] of keys.entries()){
    const b=document.createElement('button');b.className=button;
    const icon=document.createElement('span');icon.style.cssText='display:block;width:16px;height:16px;flex-shrink:0';icon.textContent='↗';
    const label=document.createElement('span');label.style.minWidth='0';label.textContent=translate(locale,key,{brand:family===1?(i===0?'Klook':'KKday'):family===3&&i===0?'Agoda':'Trip.com'});
    b.append(icon,label);list.append(b);
   }
   const bounds=list.getBoundingClientRect();const buttons=[...list.children];
   for(const b of buttons){const r=b.getBoundingClientRect();const label=b.lastElementChild;const style=getComputedStyle(label);
    assert(r.left>=bounds.left-.5&&r.right<=bounds.right+.5,'container overflow '+locale+width+scale);
    assert(b.scrollWidth<=b.clientWidth+1&&label.scrollWidth<=label.clientWidth+1,'text overflow '+locale+width+scale);
    assert(r.height>=44&&r.width>=44,'touch target');
    assert(style.textOverflow!=='ellipsis'&&style.whiteSpace!=='nowrap'&&style.webkitLineClamp==='none','truncation');
    assert(b.firstElementChild.getBoundingClientRect().right<=label.getBoundingClientRect().left+.5,'icon overlap');
   }
   for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){const a=buttons[i].getBoundingClientRect(),b=buttons[j].getBoundingClientRect();assert(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'button overlap')}
   if(family===0&&width===820&&scale===1)assert(buttons.every(b=>b.offsetTop===buttons[0].offsetTop),'wide three-column layout');
  }
  checks.push({locale,width,scale});
 }
}
const result=document.createElement('pre');result.id='result';result.textContent=btoa(JSON.stringify({result:'PASS',cases:checks.length,checks}));document.body.replaceChildren(result);
`;
// Keep imports at module scope and report browser assertion errors deterministically.
const imports=entry.split('\n').filter(l=>l.startsWith('import ')).join('\n');
const body=entry.split('\n').filter(l=>!l.startsWith('import ')).join('\n');
await build({
  stdin: {
    contents:
      imports +
      "\ntry {" +
      body +
      '}catch(e){document.body.innerHTML="<pre id=error></pre>";document.getElementById("error").textContent=e.message}',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  define: { "import.meta.env": "{}" },
  outfile: path.join(dir, "test.js"),
  alias: { "@": path.join(root, "src") },
  logLevel: "silent",
});
const assets=path.join(root,"dist/client/assets");const css=fs.readdirSync(assets).filter(f=>/^styles-.*\.css$/.test(f)).map(f=>read(path.join(assets,f))).join('\n');
fs.writeFileSync(path.join(dir,"index.html"),'<meta charset="utf-8"><style>'+css+'</style><body><script src="test.js"></script>');
const result=spawnSync(process.env.CHROME_BIN||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",["--headless","--disable-gpu","--disable-background-networking","--no-first-run","--user-data-dir="+path.join(dir,"profile"),"--dump-dom","--virtual-time-budget=5000","file://"+path.join(dir,"index.html")],{encoding:"utf8",timeout:60000,maxBuffer:10*1024*1024});
assert.equal(result.status,0,result.stderr);
const match=result.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
assert.ok(match,result.stdout.match(/<pre id="error">([^<]+)/)?.[1]??result.stdout.slice(-1000));
console.log('Opening + localized CTA browser layout:',Buffer.from(match[1],'base64').toString());
