import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveRestoreOutcome } from '../src/services/subscription/purchase-outcome.ts';
import { defaultFreeStatus } from '../src/services/subscription/tiers.ts';
const source = fs.readFileSync('src/components/RoamiePlusIntroDialog.tsx', 'utf8');
const tree = ts.createSourceFile('dialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) { let found; function visit(n) { if (predicate(n)) found=n; ts.forEachChild(n,visit); } visit(tree); assert(found); return found; }
function evaluate(node, context) {
  const js=ts.transpileModule(`globalThis.value = (${node.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInContext(js,context); return context.value;
}
const message=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==='offeringMessage').initializer;
const ctx=vm.createContext({purchasesSupported:true,offeringsLoading:true,offeringsState:'empty',offeringsError:null,initializationError:null});
assert.equal(evaluate(message,ctx),null,'A loading never reports empty');
Object.assign(ctx,{offeringsLoading:false,offeringsState:'success'});
assert.equal(evaluate(message,ctx),null);
ctx.offeringsState='empty';assert.equal(evaluate(message,ctx),'empty','C true empty');
ctx.purchasesSupported=false;assert.equal(evaluate(message,ctx),'purchaseUnsupported');
const cards=find(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='packages.map');
Object.assign(ctx,{React,AlertDialogAction:props=>React.createElement('button',props,props.children),buttonClass:'',busyPackage:null,recovery:null,offeringsLoading:false,t:key=>key,packages:[{identifier:'monthly-fixture',period:'monthly',priceString:'Provider monthly price'},{identifier:'annual-fixture',period:'yearly',priceString:'Provider annual price'}]});
const html=renderToStaticMarkup(React.createElement(React.Fragment,null,evaluate(cards,ctx)));
assert.match(html,/plusPurchase.monthly.*Provider monthly price/);
assert.match(html,/plusPurchase.yearly.*Provider annual price/);
const active={...defaultFreeStatus(),tier:'plus',isActive:true,source:'revenuecat'};
const free=defaultFreeStatus();
assert.equal(free.isActive,true,'regression fixture: Free itself is active');
assert.equal(resolveRestoreOutcome({outcome:'success',status:free,canonicalSynced:true}),'nothingToRestore');
assert.equal(resolveRestoreOutcome({outcome:'success',status:active,canonicalSynced:true}),'restored');
assert.equal(resolveRestoreOutcome({outcome:'success',status:active,canonicalSynced:false}),'restoreSyncPending');
const handler=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==='handleRestore').initializer;
for(const [result,expected] of [
 [{outcome:'success',status:active,canonicalSynced:true},'success'],
 [{outcome:'success',status:free,canonicalSynced:true},'message'],
 [new Error('provider unavailable'),'error'],
 [{outcome:'success',status:active,canonicalSynced:false},'message'],
]) {
 const toasts=[];let upgrades=0;
 const context=vm.createContext({busy:{current:false},beginOperation:()=>()=>true,setBusyPackage(){},setRecovery(){},restore:async()=>{if(result instanceof Error)throw result;return result;},resolveRestoreOutcome,t:x=>x,toast:Object.fromEntries(['success','message','error'].map(kind=>[kind,message=>toasts.push({kind,message})])),onUpgraded:()=>upgrades++,onOpenChange(){}});
 await evaluate(handler,context)();
 assert.equal(toasts[0].kind,expected);
 assert.equal(upgrades,expected==='success'?1:0);
 if(result.status===free)assert.equal(toasts[0].message,'plusPurchase.nothingToRestore');
 if(expected==='error')assert.equal(toasts[0].message,'plusPurchase.restoreFailed');
}
assert.match(source,/purchasesSupported\) void loadOfferings\(\)/);
assert.match(source,/onClick=\{\(\) => void loadOfferings\(\)\}/);
const provider=fs.readFileSync('src/providers/SubscriptionProvider.tsx','utf8');
assert.match(provider,/purchasesSupported: adapter.id === "revenuecat"/);
assert.match(provider,/await adapter.getPackages\(userId, request.signal\)/);
assert.match(provider,/await syncCanonical\(userId, result.status.isActive, true\)/);
const adapter=fs.readFileSync('src/services/subscription/index.ts','utf8');
assert.match(adapter,/await Purchases.restorePurchases\(\)/);
assert.match(adapter,/await Purchases.purchasePackage\(/);
console.log('PASS A-H focused: loading/cards/empty/unsupported; canonical Plus-only restore toast; Free/no purchase/error; existing native calls unchanged');
