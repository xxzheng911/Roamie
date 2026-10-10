import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveServerFunctionUrl } from '../src/lib/server-function-transport.ts';
import { isTrustedNativeApiRequest, withNativeApiCors } from '../src/lib/native-api-cors.ts';
import * as policy from '../src/lib/native-rpc-policy.ts';
import { validatePublicApiOrigin } from '../src/lib/api-url.ts';
const context={native:true,pageUrl:'capacitor://localhost/plan',appOrigin:'https://roamie.tw'};
const path='/_serverFn/test_id';
assert.equal(resolveServerFunctionUrl(path,{...context,native:false}),path);
assert.equal(resolveServerFunctionUrl(path,context),'https://roamie.tw'+path);
assert.equal(resolveServerFunctionUrl('capacitor://localhost'+path+'?payload=encoded',context),'https://roamie.tw'+path+'?payload=encoded');
for(const url of ['/api/google','/plan','/_serverFn/','/_serverFn/a/b']) assert.equal(resolveServerFunctionUrl(url,context),url);
assert.equal(resolveServerFunctionUrl(path,{...context,pageUrl:'https://untrusted.example/'}),path);
assert.throws(()=>resolveServerFunctionUrl('https://untrusted.example'+path,context));
for(const appOrigin of [undefined,'http://roamie.tw','https://user:pass@roamie.tw','https://roamie.tw/path','https://roamie.tw?key=x']) assert.throws(()=>resolveServerFunctionUrl(path,{...context,appOrigin}));
function load(file,deps,globals={}) {
 const exports={}; const source=fs.readFileSync(file,'utf8').replaceAll('import.meta.env.VITE_APP_ORIGIN','"https://roamie.tw"');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>{assert.ok(id in deps,id);return deps[id]},URL,Request,Response,Headers,console:{info(){throw Error('unexpected log')},warn(){throw Error('unexpected log')},error(){throw Error('unexpected log')}},...globals});return exports;
}
let native=true,calls=[];
const transport=load('src/lib/server-function-transport.ts',{'@/lib/api-url':{validatePublicApiOrigin},'@/lib/capacitor-native-shell':{isCapacitorNativeShell:()=>native},'@/lib/native-rpc-policy':policy},{window:{location:{href:context.pageUrl}},fetch:async(input,init)=>{calls.push({input,init});return Response.json({ok:true})}});
for(const [name,method] of [['autocomplete','POST'],['details','POST'],['capability','GET'],['generation','POST']]) {
 const headers=new Headers({Authorization:'Bearer fixture-token','x-tsr-serverFn':'true','Content-Type':'application/json'});
 const signal=new AbortController().signal;const init={method,headers,signal,...(method==='POST'?{body:'{"fixture":true}'}:{})};
 await transport.serverFunctionFetch('/_serverFn/'+name,init);const c=calls.at(-1);
 assert.equal(c.input,'https://roamie.tw/_serverFn/'+name);assert.equal(c.init.method,method);assert.equal(c.init.body,init.body);assert.equal(c.init.signal,signal);assert.equal(c.init.headers,headers);assert.equal(c.init.credentials,'omit');
 assert.equal(c.init.headers.get('authorization'),'Bearer fixture-token');assert.equal(c.init.headers.get('x-tsr-serverFn'),'true');
}
const req=new Request('https://example.com/test');native=false;
const init={credentials:'same-origin'};await transport.serverFunctionFetch(req,init);assert.equal(calls.at(-1).input,req);assert.equal(calls.at(-1).init,init);
native=true;
const post=new Request('capacitor://localhost'+path,{method:'POST',body:'payload',headers:{Authorization:'Bearer fixture-token'}});
await transport.serverFunctionFetch(post);assert.equal(await calls.at(-1).input.text(),'payload');assert.equal(calls.at(-1).input.headers.get('authorization'),'Bearer fixture-token');assert.equal(calls.at(-1).input.method,'POST');
const request=(url,origin='capacitor://localhost',method='OPTIONS')=>new Request('https://roamie.tw'+url,{method,headers:{Origin:origin}});
const rpc=request(path);assert.ok(isTrustedNativeApiRequest(rpc));
const preflight=withNativeApiCors(rpc,new Response(null,{status:204}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'capacitor://localhost');assert.match(preflight.headers.get('access-control-allow-headers'),/X-Tsr-ServerFn/);
for(const status of [200,401,403,500]){
 const response=withNativeApiCors(request(path,undefined,'POST'),new Response('fixture',{status,headers:{'x-tss-serialized':'true','x-tss-raw':'true',Vary:'Accept-Encoding'}}));
 assert.equal(response.status,status);assert.match(response.headers.get('access-control-expose-headers'),/X-Tss-Serialized, X-Tss-Raw/);assert.equal(response.headers.get('vary'),'Accept-Encoding, Origin');
}
for(const r of [request(path,'https://evil.example'),request(path,'null'),request('/saved'),request('/_serverFn/')]){assert.equal(isTrustedNativeApiRequest(r),false);assert.equal(withNativeApiCors(r,new Response()).headers.get('access-control-allow-origin'),null)}
const api=withNativeApiCors(request('/api/google'),new Response());assert.match(api.headers.get('access-control-allow-headers'),/X-Roamie-Cancel/);assert.equal(api.headers.get('access-control-allow-origin'),'capacitor://localhost');
// Execute real auth middleware with no header: transport/CORS must not grant access.
const auth=load('src/integrations/supabase/auth-middleware.ts',{'@tanstack/react-start':{createMiddleware:()=>({server:fn=>fn})},'@tanstack/react-start/server':{getRequest:()=>new Request('https://roamie.tw'+path)},'@supabase/supabase-js':{createClient:()=>{throw Error('unexpected auth network')}},'@/lib/abuse-guard.server':{admitAuthenticatedServerFunction:()=>{}},'@/lib/worker-request-scope':{bindVerifiedUserId:()=>{}}},{process:{env:{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture'}}});
await assert.rejects(()=>auth.requireSupabaseAuth({next:()=>{throw Error('protected handler entered')}}),/Unauthorized/);
assert.match(fs.readFileSync('src/start.ts','utf8'),/serverFns: \{ fetch: serverFunctionFetch \}/);
assert.match(fs.readFileSync('src/lib/outfit/outfit.functions.ts','utf8'),/middleware\(\[requireSupabasePlus\]\)/);
console.log('PASS RPC A–N: Web/native routing, four method fixtures, bearer/RPC/body/signal preserved, strict CORS, existing API, guest denied, no diagnostic logs or network.');
