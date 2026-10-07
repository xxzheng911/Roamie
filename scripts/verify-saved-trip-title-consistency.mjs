import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const context=vm.createContext({effectiveAppLocale:()=> 'zh-TW',translate:(_locale,_key,{destination,days})=>`${destination} · ${days} 天旅行`,safeImage:value=>value,fetch:()=>{throw new Error('No API calls allowed');}});
function load(path,name){
 const source=fs.readFileSync(path,'utf8');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(fn);
 vm.runInContext(ts.transpileModule(fn.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return context[name];
}
const title=load('src/lib/trip/core-trip.ts','resolveCoreTripTitle');
const snapshot=load('src/lib/saved-list-snapshot.ts','safeTrips');
const trip={id:'fixture',title:'Saved destination 5 days',customTitle:null,isTitleCustomized:false,generatedLocale:'zh-TW',destinationPlace:{name:'Destination'},days:5};
const before=JSON.stringify(trip);
const cached=JSON.parse(JSON.stringify(snapshot([trip])))[0];
assert.equal(cached.generatedLocale,undefined,'actual snapshot omits locale');
for(const state of [cached,trip,cached,trip,JSON.parse(JSON.stringify(cached))]){
 assert.equal(title(state),trip.title,'load/hydrate/tab/return/reopen keep saved title');
 assert.equal(title(state,'en'),trip.title,'locale metadata cannot replace persisted title');
}
const custom={...trip,isTitleCustomized:true,customTitle:'My custom holiday'};
assert.equal(title(custom),'My custom holiday');
assert.equal(title(JSON.parse(JSON.stringify(snapshot([custom])))[0]),'My custom holiday');
assert.equal(title({...trip,isTitleCustomized:true,customTitle:'  '}),trip.title);
for(const empty of ['', '   ',null,undefined]){
 const input={...trip,title:empty};
 assert.equal(title(input),'Destination · 5 天旅行');
 assert.equal(title(JSON.parse(JSON.stringify(snapshot([input])))[0]),title(input));
}
assert.equal(JSON.stringify(trip),before,'display must not mutate persisted data');
const card=fs.readFileSync('src/components/saved/SavedTripCard.tsx','utf8');
assert.match(card,/\{resolveCoreTripTitle\(trip\)\}/);
console.log('PASS A-H: persisted/custom title authority, actual snapshot hydration/tab/reopen, deterministic empty fallback; no network or persistence writes');
