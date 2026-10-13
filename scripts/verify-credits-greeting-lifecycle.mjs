/** Executes the actual Chat greeting effects/state callbacks with a deterministic async
 * scheduler. No React DOM/device claim; no account RPC, AI, or credit settlement. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { translate } from "../src/lib/i18n/translate.ts";
import { resolveCreditsGreetingStage } from "../src/lib/credits/constants.ts";
const source = fs.readFileSync(process.env.CHAT_SOURCE_FILE ?? new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = []; const declarations = new Map();
function visit(n) {
  if (ts.isCallExpression(n) && n.expression.getText(tree)==="useEffect") effects.push(n.arguments[0]);
  if (ts.isVariableDeclaration(n)) declarations.set(n.name.getText(tree), n.initializer);
  ts.forEachChild(n,visit);
} visit(tree);
const asyncEffect = effects.find(n=>n.getText(tree).includes("resolveCreditsGreeting("));
const syncEffect = effects.find(n=>n.getText(tree).includes("if (prev.length === 0)"));
const callback = name => declarations.get(name).arguments[0];
function evaluate(node, scope) {
  const js = ts.transpileModule(`(${node.getText(tree)})();`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return vm.runInNewContext(js, scope);
}
function harness({locale="zh-TW",plus=false,ready=true,guest=false}={}) {
  const s = {t:key=>translate(locale,key),hasPlusAccess:plus,subscriptionHydrated:ready,
    greetingReady:ready,authLoading:!ready,greetingUser:guest?null:{id:"mock"},greetingRevision:0,
    greetingId:"default:test:0",greetingScope:"mock:0",greetingContent:translate(locale,"chat.greeting"),
    resolvedGreeting:null,defaultGreetingTouchedRef:{current:false},
    hydrating:false,initialRestoreSettledRef:{current:true},session:{},logAiPipeline:()=>{},
    isCreditsFeatureEnabled:()=>true};
  let cached=null,release,settled=false;let calls=0;
  s.fetchCreditAccount=()=>{calls++;return settled?Promise.resolve(cached):new Promise(r=>{release=r})};
  // Real greeting resolver/body; only the account boundary is mocked.
  const greetingSource=fs.readFileSync(new URL("../src/lib/credits/greeting.ts",import.meta.url),"utf8");
  const greetingTree=ts.createSourceFile("greeting.ts",greetingSource,ts.ScriptTarget.Latest,true);
  const code=greetingTree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(greetingTree)).join("\n");
  const exports={};
  vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,resolveCreditsGreetingStage,isCreditsFeatureEnabled:s.isCreditsFeatureEnabled,
      fetchCreditAccount:s.fetchCreditAccount,getCachedCreditAccount:()=>cached,
      usableCredits:a=>Math.max(0,a.available_credits-a.reserved_credits)});
  s.resolveCreditsGreeting=exports.resolveCreditsGreeting;
  s.setGreetingContent=value=>{s.greetingContent=value};
  s.setResolvedGreeting=value=>{s.resolvedGreeting=value};
  s.setMsgs=fn=>{s.msgs=typeof fn==="function"?fn(s.msgs):fn};
  const render=()=>{s.greetingMsg=evaluate(callback("greetingMsg"),s)};
  render(); s.msgs=evaluate(callback("[msgs, setMsgs]"),s);
  return {s,render,start:()=>evaluate(asyncEffect,s),sync:()=>evaluate(syncEffect,s),calls:()=>calls,
    async settle(n){cached=n==null?null:{available_credits:n,reserved_credits:0};settled=true;release?.(cached);await new Promise(r=>setImmediate(r));render();evaluate(syncEffect,s)}};
}
const results=[];async function test(name,fn){try{await fn();results.push([name,null])}catch(e){results.push([name,e.message.slice(0,180)])}}
for(const [n,stage] of [[20,1],[15,1],[14,2],[8,2],[7,3],[1,3],[0,4]])await test(`G1-G5 async balance ${n} -> stage ${stage}`,async()=>{
  const h=harness();h.start();assert.equal(h.s.msgs[0].content,translate("zh-TW","chat.greeting"));await h.settle(n);
  assert.equal(h.s.msgs[0].content,translate("zh-TW",stage===1?"chat.greeting":`chat.creditsGreetingStage${stage}`));
});
for(const kind of ["restored","handoff","ai","sent"])await test(`G6-G8 preserve ${kind}`,async()=>{
  const h=harness();h.start();h.s.msgs=kind==="sent"?[...h.s.msgs,{role:"user",content:"mock"}]:[{role:"assistant",id:kind,content:"mock"}];
  const before=JSON.stringify(h.s.msgs);await h.settle(0);assert.equal(JSON.stringify(h.s.msgs),before);
});
await test("G9 late Plus hydration never renders Free warning",async()=>{
  const h=harness({ready:false});h.start();assert.equal(h.calls(),0);h.s.hasPlusAccess=true;h.s.subscriptionHydrated=h.s.greetingReady=true;h.s.authLoading=false;
  h.start();await h.settle(0);assert.equal(h.s.msgs[0].content,translate("zh-TW","chat.greeting"));
});
await test("G9 stale async Free response cannot overwrite Plus",async()=>{
  const h=harness();const cancel=h.start();cancel();h.s.hasPlusAccess=true;h.s.greetingScope="plus";await h.settle(0);
  assert.equal(h.s.msgs[0].content,translate("zh-TW","chat.greeting"));
});
await test("G10 Guest does not load another account's greeting",async()=>{
  const h=harness({guest:true});h.start();await h.settle(0);assert.equal(h.calls(),0);assert.equal(h.s.msgs[0].content,translate("zh-TW","chat.greeting"));
  assert.match(source,/requireAuthForAction\(action,/);
});
await test("G6 cached/restored default ids are retired by the actual restore branches",async()=>{
  for(const target of ["uiCache.msgs","workspace.messages"]){
    const h=harness();h.start();const old=[{...h.s.msgs[0],content:"restored"}];
    h.s.uiCache={msgs:old};h.s.workspace={messages:old};
    const pattern=new RegExp(`defaultGreetingTouchedRef\\.current = true;\\s*setMsgs\\(${target.replace(".","\\.")}\\);`);
    const match=source.match(pattern);assert.ok(match,`restore ${target} retires identity`);
    vm.runInNewContext(match[0],h.s);await h.settle(0);assert.equal(h.s.msgs[0].content,"restored");
  }
});
await test("G10 actual Guest Auth Guard requests login without allowing AI",()=>{
  const text=fs.readFileSync(new URL("../src/lib/auth-action.ts",import.meta.url),"utf8");
  const tree=ts.createSourceFile("auth.ts",text,ts.ScriptTarget.Latest,true);
  const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="requireAuthForAction");
  let prompt=null;
  const js=ts.transpileModule(`(${fn.getText(tree).replace("export ","")})("ai_chat");`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const allowed=vm.runInNewContext(js,{readCachedAuthenticatedUserIdSync:()=>null,promptListener:r=>{prompt=r},commitAuthRequirementLogin:()=>{throw Error("unexpected navigation")}});
  assert.equal(allowed,false);assert.equal(prompt.action,"ai_chat");
});
await test("G11 unknown credits preserve full-allotment fallback",async()=>{
  const h=harness();h.start();await h.settle(null);assert.equal(h.s.msgs[0].content,translate("zh-TW","chat.greeting"));
  assert.match(fs.readFileSync(new URL("../src/lib/credits/greeting.ts",import.meta.url),"utf8"),/const FREE_HINT = 20/);
});
for(const locale of ["zh-TW","en","ja","ko"])await test(`G12 ${locale}`,async()=>{
  for(const [n,stage] of [[20,1],[10,2],[3,3],[0,4]]){const h=harness({locale});h.start();await h.settle(n);const key=stage===1?"chat.greeting":`chat.creditsGreetingStage${stage}`;assert.notEqual(translate(locale,key),key);assert.equal(h.s.msgs[0].content,translate(locale,key))}
});
await test("G13 reset receives a fresh identity and asynchronously refreshes",async()=>{
  const start=source.indexOf("      const nextRevision = greetingRevision + 1;");
  assert.ok(start>=0,"actual reset block exists");
  const end=source.indexOf("      resetScrollToInitial();",start)+"      resetScrollToInitial();".length;
  const h=harness();let resets=0;h.s.defaultGreetingId="default:test";
  h.s.setGreetingRevision=n=>{h.s.greetingRevision=n};h.s.resetScrollToInitial=()=>{resets++};
  h.s.defaultGreetingTouchedRef.current=true;
  vm.runInNewContext(ts.transpileModule(`{${source.slice(start,end)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,h.s);
  h.s.greetingId=`default:test:${h.s.greetingRevision}`;h.render();h.start();await h.settle(0);
  assert.equal(h.s.msgs[0].id,"default:test:1");assert.equal(h.s.msgs[0].content,translate("zh-TW","chat.creditsGreetingStage4"));
  assert.equal(resets,1,"only explicit reset scrolls; async greeting update does not");

});
await test("G8 retired greeting remains immutable even with one message",async()=>{
  const h=harness();h.start();h.s.defaultGreetingTouchedRef.current=true;const before=h.s.msgs[0];await h.settle(0);assert.equal(h.s.msgs[0],before);
});
await test("G14/G15 stable message identity, no scroll or platform side effects",async()=>{
  const h=harness();const id=h.s.msgs[0].id;assert.ok(id);h.start();await h.settle(0);assert.equal(h.s.msgs.length,1);assert.equal(h.s.msgs[0].id,id);
  assert.doesNotMatch(syncEffect.getText(tree),/scrollTo|scrollTop|Capacitor|isNative/);
});
for(const [name,error] of results)console.log(`${error?"FAIL":"PASS"} ${name}${error?": "+error:""}`);
console.log(`credits-greeting-lifecycle: ${results.filter(r=>!r[1]).length}/${results.length} PASS`);
if(results.some(r=>r[1]))process.exitCode=1;
