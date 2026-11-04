// verify-trip-expenses-ui-stage4.mjs — Trip Workspace V1 第 4 階段：共同記帳畫面與資料存取獨立審查（任務單 #TW4-T2）
//
// Part S（Node 靜態）：
//   S1 路由 /_app/saved_/$tripId/expenses；_app.saved.$tripId.tsx 未改成 layout route（無 <Outlet>）
//   S2 新檔不建立 Realtime channel、不呼叫 Google／OpenAI／fetch
//   S3 金額解析不經浮點（ExpenseSheet 無 parseFloat／Number(amountText)）；currency_exponent 取 ISO 表
// Part R（headless Chrome，React development build＋<StrictMode> 真實 render；mock supabase client＝假後端）：
//   R1  進入頁面：trip_expenses 一次巢狀 select（payers＋shares、deleted_at is null）、StrictMode 下只查 1 次、
//       無 channel；依日期分組（新到舊）；頂部依幣別分開總額＋我的淨額
//   R2  非成員（已離開／已刪除帳號）：不補查 profiles（0 次）；一律顯示「已不在行程中的成員」（四語系）
//   R3  新增（平均）：實際送出 payload 與後端契約欄位完全一致，並以 SQL 規則 JS 重寫版驗證不被拒絕
//   R4  百分比（預設平均 bp、自訂 bp、總和不符時不送出）
//   R5  自訂金額（還差／超出／相符即時顯示）、幣別選擇器（此行程用過／常用／全部 A–Z、搜尋）、JPY 小數拒絕、BHD 3 位
//   R6  寫入失敗保留輸入、重試沿用 client_request_id；新的編輯產生新 id；回應遺失後重試不重複建立
//   R7  送出中停用、連點只送 1 次
//   R8  version 衝突：提示並載入最新版本；下一次送出用新版本
//   R9  修改時已被刪除：提示並關閉
//   R10 刪除 → 6 秒「復原」→ restore_trip_expense；刪除衝突
//   R11 結算：建議轉帳、「標記已還」settlement 形狀（付款人＝還錢的人、分攤＝收錢的人、exact）；
//       復原呼叫 delete_trip_expense；連點 1 次；失敗重試沿用 id；與已離開成員的轉帳
//       R11i–R11l（第 3 輪）成員名單讀取失敗：從未成功／讀過後重讀失敗／重試恢復／未載入時編輯
//   R8b–R8d（第 3 輪）衝突判斷只看 message（P0001／40001 皆可），不依賴 SQLSTATE
//   R12 回前景 30 秒節流；R13 下拉更新
//   R14 競態：讀取進行中時儲存／刪除，最後畫面是否為最新
//   R15 總覽「共同記帳」卡；R16 返回；R17 路由 tripId 驗證；R18 四語系／錯誤碼
//   R20 TripDetailScreen 從記帳頁返回總覽還原捲動；沒有標記時行為不變
//   R19 無外部請求、無瀏覽器例外／console.error
//
// 不讀 .env、不連網（瀏覽器只連 127.0.0.1 fixture server）。執行：node scripts/verify-trip-expenses-ui-stage4.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const failures = [];
let passCount = 0;
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 24).join("\n     "));
  }
}
const info = (s) => console.log("INFO " + s);

const iso = await import("../src/lib/money/iso4217.ts");

// ───────────────────────── SQL 規則 JS 重寫版（supabase/migrations/20261102120000_trip_expenses.sql 181–392 行）─────────────────────────
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const INT_RE = /^[0-9]{1,14}$/;
const MAX = 10_000_000_000_000n;
function uuidBytes(u) {
  return Uint8Array.from(u.replace(/-/g, "").toLowerCase().match(/../g).map((x) => Number.parseInt(x, 16)));
}
function cmpUuid(a, b) {
  const x = uuidBytes(a);
  const y = uuidBytes(b);
  for (let i = 0; i < 16; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
const jsonText = (v) => (v == null ? null : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
/** 回傳 SQL 會 RAISE 的錯誤碼；接受回 null。members＝目前 accepted 成員（建立時檢查）。 */
function sqlUpsert(args, { members, create = true } = {}) {
  const p = args.p_expense;
  if (!p || typeof p !== "object" || Array.isArray(p)) return "expense_malformed";
  const id = p.id == null || p.id === "" ? null : jsonText(p.id);
  if (id != null && !UUID_RE.test(id)) return "expense_malformed";
  const req = p.client_request_id == null || p.client_request_id === "" ? null : jsonText(p.client_request_id);
  if (req != null && !UUID_RE.test(req)) return "expense_malformed";
  if (id == null && req == null) return "expense_malformed";
  if (!["expense", "settlement"].includes(p.kind)) return "expense_invalid_kind";
  const title = p.title == null ? null : jsonText(p.title).replace(/^ +| +$/g, "");
  if (title == null || [...title].length < 1 || [...title].length > 80) return "expense_invalid_title";
  const amtTxt = jsonText(p.amount_minor);
  if (amtTxt == null || !INT_RE.test(amtTxt)) return "expense_invalid_amount";
  const A = BigInt(amtTxt);
  if (A < 1n || A > MAX) return "expense_invalid_amount";
  const expTxt = jsonText(p.currency_exponent);
  if (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency) || expTxt == null || !/^[0-4]$/.test(expTxt)) return "expense_invalid_currency";
  const d = jsonText(p.spent_on);
  if (d == null || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d) || Number.isNaN(Date.parse(d + "T00:00:00Z")) || new Date(d + "T00:00:00Z").toISOString().slice(0, 10) !== d) return "expense_invalid_date";
  if (!["equal", "exact", "percent"].includes(p.split_method)) return "expense_invalid_split_method";
  if ("note" in p && !(p.note === null || typeof p.note === "string")) return "expense_invalid_note";
  const note = (p.note ?? "").trim();
  if (note && [...note].length > 500) return "expense_invalid_note";
  if (!Array.isArray(p.payers) || p.payers.length > 50) return "expense_malformed";
  const payers = [];
  for (const e of p.payers) {
    if (!e || typeof e !== "object" || !UUID_RE.test(String(e.user_id ?? ""))) return "expense_malformed";
    const t = jsonText(e.amount_minor);
    if (t == null || !INT_RE.test(t)) return "expense_payers_mismatch";
    if (BigInt(t) < 1n || BigInt(t) > MAX) return "expense_payers_mismatch";
    payers.push({ u: e.user_id, a: BigInt(t) });
  }
  if (!Array.isArray(p.shares) || p.shares.length > 50) return "expense_malformed";
  const shares = [];
  for (const e of p.shares) {
    if (!e || typeof e !== "object" || !UUID_RE.test(String(e.user_id ?? ""))) return "expense_malformed";
    const t = jsonText(e.share_minor);
    if (t == null || !INT_RE.test(t)) return "expense_shares_mismatch";
    if (BigInt(t) > MAX) return "expense_shares_mismatch";
    let b = null;
    if (p.split_method === "percent") {
      const bt = jsonText(e.percent_bp);
      if (bt == null || !/^[0-9]{1,5}$/.test(bt)) return "expense_percent_mismatch";
      if (Number(bt) > 10000) return "expense_percent_mismatch";
      b = Number(bt);
    }
    shares.push({ u: e.user_id, a: BigInt(t), b });
  }
  if (payers.length < 1 || payers.reduce((s, x) => s + x.a, 0n) !== A) return "expense_payers_mismatch";
  if (shares.length < 1 || shares.reduce((s, x) => s + x.a, 0n) !== A) return "expense_shares_mismatch";
  const distinct = (xs) => new Set(xs.map((x) => x.u.toLowerCase())).size === xs.length;
  if (!distinct(payers) || !distinct(shares)) return "expense_duplicate_participant";
  if (p.kind === "settlement" && (payers.length !== 1 || shares.length !== 1 || payers[0].u.toLowerCase() === shares[0].u.toLowerCase() || p.split_method !== "exact")) return "expense_invalid_settlement";
  if (p.split_method === "equal") {
    const n = BigInt(shares.length);
    const q = A / n;
    const r = A - q * n;
    const z = [...shares].sort((x, y) => cmpUuid(x.u, y.u));
    for (let i = 0; i < z.length; i++) if (z[i].a !== q + (BigInt(i + 1) <= r ? 1n : 0n)) return "expense_split_mismatch";
  } else if (p.split_method === "percent") {
    if (shares.reduce((s, x) => s + x.b, 0) !== 10000) return "expense_percent_mismatch";
    const leftover = A - shares.reduce((s, x) => s + (A * BigInt(x.b)) / 10000n, 0n);
    const z = shares
      .map((x) => ({ ...x, base: (A * BigInt(x.b)) / 10000n, rem: (A * BigInt(x.b)) % 10000n }))
      .sort((x, y) => (x.rem !== y.rem ? (x.rem > y.rem ? -1 : 1) : cmpUuid(x.u, y.u)));
    for (let i = 0; i < z.length; i++) if (z[i].a !== z[i].base + (BigInt(i + 1) <= leftover ? 1n : 0n)) return "expense_split_mismatch";
  }
  if (create && members) {
    const set = new Set(members.map((m) => m.toLowerCase()));
    if ([...payers, ...shares].some((x) => !set.has(x.u.toLowerCase()))) return "expense_participant_not_member";
  }
  return null;
}
/** 契約形狀：參數名稱與 p_expense／payers／shares 欄位完全一致（不多不少）。 */
function assertContractShape(args) {
  assert.deepEqual(Object.keys(args).sort(), ["p_expected_version", "p_expense", "p_trip_id"], "RPC 參數名稱");
  assert.deepEqual(
    Object.keys(args.p_expense).sort(),
    ["amount_minor", "client_request_id", "currency", "currency_exponent", "id", "kind", "note", "payers", "shares", "spent_on", "split_method", "title"],
    "p_expense 欄位",
  );
  for (const x of args.p_expense.payers) assert.deepEqual(Object.keys(x).sort(), ["amount_minor", "user_id"], "payer 欄位");
  for (const x of args.p_expense.shares) assert.deepEqual(Object.keys(x).sort(), ["percent_bp", "share_minor", "user_id"], "share 欄位");
  assert.equal(args.p_expense.currency_exponent, iso.getIsoCurrencyExponent(args.p_expense.currency), "currency_exponent 不是 ISO 表");
  assert.equal(typeof args.p_expense.amount_minor, "number");
  assert.ok(Number.isSafeInteger(args.p_expense.amount_minor));
}
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ───────────────────────── Part S：Node 靜態 ─────────────────────────
const NEW_FILES = [
  "src/routes/_app.saved_.$tripId.expenses.tsx",
  "src/lib/trip/trip-expenses.ts",
  ...fs.readdirSync(path.join(root, "src/components/trip/expenses")).map((f) => "src/components/trip/expenses/" + f),
];
await check("S1 路由 /_app/saved_/$tripId/expenses；行程頁 _app.saved.$tripId.tsx 未改成 layout route", () => {
  const r = read("src/routes/_app.saved_.$tripId.expenses.tsx");
  assert.match(r, /createFileRoute\("\/_app\/saved_\/\$tripId\/expenses"\)/);
  const t = read("src/routes/_app.saved.$tripId.tsx");
  assert.doesNotMatch(t, /<Outlet/, "行程頁出現 <Outlet>（變成 layout route）");
  const tree = read("src/routeTree.gen.ts");
  assert.match(tree, /path: '\/saved\/\$tripId\/expenses'/);
});
await check("S2 記帳新檔：無 Realtime channel、無 Google／OpenAI、無直接 fetch", () => {
  for (const f of NEW_FILES) {
    const s = read(f);
    assert.doesNotMatch(s, /\.channel\(|removeChannel|postgres_changes/, f + " 建立 channel");
    assert.doesNotMatch(s, /googleapis|maps\.google|openai|\bfetch\(/i, f + " 外部呼叫");
  }
});
await check("S3 金額解析不經浮點；currency_exponent 由 ISO 表決定", () => {
  const s = read("src/components/trip/expenses/ExpenseSheet.tsx");
  assert.doesNotMatch(s, /parseFloat|Number\(form\.amountText|Number\(text|\* ?100\b/, "ExpenseSheet 以浮點處理金額");
  assert.match(s, /getIsoCurrencyExponent/);
  assert.match(s, /currency_exponent: exponent/);
});

// ───────────────────────── Part R：瀏覽器 ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-tw4ui-"));
function mockPlugin(mocks) {
  return {
    name: "mocks",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
    },
  };
}
const real = (p) => JSON.stringify(path.join(root, p));
const commonMocks = (G) => ({
  "@/hooks/use-i18n": `const T=(k)=>k;export const useI18n=()=>({locale:${G}.locale,t:T});export const I18nProvider=({children})=>children;`,
  sonner: `const rec=(kind)=>(m,o)=>{${G}.toasts.push({kind,m:String(m),o:o||null});return ${G}.toasts.length;};
export const toast=Object.assign(rec('default'),{success:rec('success'),error:rec('error'),info:rec('info'),warning:rec('warning'),dismiss(){}});export const Toaster=()=>null;`,
  "@/components/profile/ProfileAvatar": `export const ProfileAvatar=()=> <span data-avatar=""/>;`,
  "@/lib/auth-session": `export * from ${real("src/lib/auth-session.ts")};
export const getAuthenticatedUserId=async()=>${G}.uid;export const readCachedAuthenticatedUserIdSync=()=>${G}.uid;`,
  "@/services/platform": `export * from ${real("src/services/platform/index.ts")};
export const detectPlatform=()=>({isCapacitor:false,isIOS:false,isNative:false,kind:'web'});`,
  "@/lib/copy-to-clipboard": `export * from ${real("src/lib/copy-to-clipboard.ts")};export async function copyTextToClipboard(){return 'copied';}`,
  "@/lib/open-external-url": `export * from ${real("src/lib/open-external-url.ts")};export const openExternalUrl=async()=>true;`,
  "@/lib/i18n/effective-app-locale": `export * from ${real("src/lib/i18n/effective-app-locale.ts")};export const effectiveAppLocale=()=>${G}.locale;`,
  "@/lib/log-error": `export * from ${real("src/lib/log-error.ts")};export const logAppError=()=>{};export const logAppErrorDetail=()=>{};`,
  "@tanstack/react-start": `const chain=()=>{const f=async()=>{throw new Error('server fn not available in verify');};
for(const m of ['inputValidator','validator','middleware','handler','server','client'])f[m]=()=>f;return f;};
export const createServerFn=()=>chain();export const createMiddleware=()=>chain();export const createStart=()=>({});export const useServerFn=(f)=>f;`,
  "@tanstack/react-start/server": `export const getRequest=()=>null;`,
});

const EX = "window.__ex";
const exMocks = {
  ...commonMocks(EX),
  "@tanstack/react-router": `const NAV=(o)=>{${EX}.nav.push(o);return Promise.resolve();};
const ROUTER={history:{canGoBack:()=>!!${EX}.canGoBack,back(){${EX}.backs+=1;}},subscribe:()=>()=>{}};
export const useNavigate=()=>NAV;export const useRouter=()=>ROUTER;
export const useRouterState=({select})=>select({location:{pathname:'/saved/x/expenses',searchStr:''}});
export const createFileRoute=(p)=>(o)=>({path:p,options:o,useParams:()=>({tripId:${EX}.tripId}),useNavigate:()=>NAV});`,
  "@/integrations/supabase/client": `function chain(t){const calls=[];const q={};
 for(const m of ['select','eq','neq','in','order','limit','is','match','filter','range'])q[m]=(...a)=>{calls.push([m,...a]);return q;};
 const run=()=>{${EX}.from.push({t,calls});return window.__fromImpl(t,calls);};
 q.maybeSingle=()=>Promise.resolve().then(run);q.single=q.maybeSingle;
 q.then=(a,b)=>Promise.resolve().then(run).then(a,b);return q;}
export const supabase={rpc:(n,a)=>{${EX}.rpc.push([n,JSON.parse(JSON.stringify(a))]);return window.__rpcImpl(n,a);},
 from:(t)=>chain(t),
 auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 channel:(...a)=>{${EX}.channels.push(a);const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{}};
export const isSupabaseConfigured=()=>true;`,
};

// 注意：以下 fixture 原始碼不使用反引號與 $-大括號插值
const exEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TripExpensesScreen} from '@/components/trip/expenses/TripExpensesScreen';
import {ExpensesOverviewCard} from '@/components/trip/expenses/ExpensesOverviewCard';
import {Route as ExpRoute} from '@/routes/_app.saved_.$tripId.expenses';
import {getTripExpensesCopy} from '@/lib/i18n/trip-workspace-copy';
import {TRIP_EXPENSE_ERROR_CODES} from '@/lib/trip/trip-expenses';
import {expenseErrorMessage,safeFormatMoney} from '@/components/trip/expenses/expense-model';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
const realNow=Date.now.bind(Date);Date.now=()=>realNow()+(window.__clock||0);
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__vis||'visible'});
window.COPY={'zh-TW':getTripExpensesCopy('zh-TW'),en:getTripExpensesCopy('en'),ja:getTripExpensesCopy('ja'),ko:getTripExpensesCopy('ko')};
window.ERROR_CODES=[...TRIP_EXPENSE_ERROR_CODES];
window.errMsg=(code,loc)=>expenseErrorMessage(code,getTripExpensesCopy(loc||'zh-TW'));
window.fmt=(m,c,e,code,loc)=>safeFormatMoney(m,c,e,loc||'zh-TW',!!code);
function deferred(){let r,j;const p=new Promise((a,b)=>{r=a;j=b;});return {p,r,j};}
let rootEl=null;let tripSeq=0;
function nextTripId(){tripSeq+=1;return '7e000000-0000-4000-8000-'+tripSeq.toString(16).padStart(12,'0');}
function nowIso(){return new Date(realNow()+(window.__clock||0)).toISOString();}
function newId(){const ex=window.__ex;ex.srv.idSeq+=1;return 'e0000000-0000-4000-8000-'+ex.srv.idSeq.toString(16).padStart(12,'0');}
function outRow(r){return {id:r.id,trip_id:r.trip_id,kind:r.kind,title:r.title,amount_minor:r.amount_minor,currency:r.currency,currency_exponent:r.currency_exponent,spent_on:r.spent_on,split_method:r.split_method,note:r.note,created_by:r.created_by,updated_by:r.updated_by,created_at:r.created_at,updated_at:r.updated_at,version:r.version,deleted_at:r.deleted_at,
  trip_expense_payers:r.payers.map(function(p){return {user_id:p.user_id,amount_minor:p.amount_minor};}),
  trip_expense_shares:r.shares.map(function(s){return {user_id:s.user_id,share_minor:s.share_minor,percent_bp:s.percent_bp};})};}
function listRows(){return window.__ex.srv.rows.filter(function(r){return !r.deleted_at;}).slice().sort(function(a,b){
  if(a.spent_on!==b.spent_on)return a.spent_on<b.spent_on?1:-1;return a.created_at<b.created_at?1:a.created_at>b.created_at?-1:0;}).map(outRow);}
function err(code){return {data:null,error:{message:code,code:'P0001',details:null,hint:null}};}
function isMember(u){return window.__ex.members.some(function(m){return m.user_id.toLowerCase()===String(u).toLowerCase();});}
function applyRpc(n,a){const ex=window.__ex;const rows=ex.srv.rows;
  if(n==='upsert_trip_expense'){const p=a.p_expense;
    const payers=p.payers.map(function(x){return {user_id:x.user_id,amount_minor:x.amount_minor};});
    const shares=p.shares.map(function(x){return {user_id:x.user_id,share_minor:x.share_minor,percent_bp:p.split_method==='percent'?x.percent_bp:null};});
    if(p.id==null){const old=rows.find(function(r){return r.client_request_id===p.client_request_id;});
      if(old)return {data:[{expense_id:old.id,expense_version:old.version,replayed:true}],error:null};
      if(payers.concat(shares).some(function(x){return !isMember(x.user_id);}))return err('expense_participant_not_member');
      const r={id:newId(),trip_id:a.p_trip_id,kind:p.kind,title:String(p.title).trim(),amount_minor:p.amount_minor,currency:p.currency,currency_exponent:p.currency_exponent,spent_on:p.spent_on,split_method:p.split_method,note:p.note,created_by:ex.uid,updated_by:ex.uid,created_at:nowIso(),updated_at:nowIso(),version:1,deleted_at:null,client_request_id:p.client_request_id,payers:payers,shares:shares};
      rows.push(r);return {data:[{expense_id:r.id,expense_version:1,replayed:false}],error:null};}
    const r=rows.find(function(x){return x.id===p.id;});
    if(!r)return err('expense_not_found');if(r.deleted_at)return err('expense_deleted');
    if(a.p_expected_version==null||a.p_expected_version!==r.version)return err('expense_conflict');
    Object.assign(r,{kind:p.kind,title:String(p.title).trim(),amount_minor:p.amount_minor,currency:p.currency,currency_exponent:p.currency_exponent,spent_on:p.spent_on,split_method:p.split_method,note:p.note,version:r.version+1,updated_at:nowIso(),payers:payers,shares:shares});
    return {data:[{expense_id:r.id,expense_version:r.version,replayed:false}],error:null};}
  if(n==='delete_trip_expense'){const r=rows.find(function(x){return x.id===a.p_expense_id;});if(!r)return err('expense_not_found');
    if(r.deleted_at)return {data:[{expense_id:r.id,expense_version:r.version}],error:null};
    if(a.p_expected_version==null||a.p_expected_version!==r.version)return err('expense_conflict');
    r.deleted_at=nowIso();r.version+=1;return {data:[{expense_id:r.id,expense_version:r.version}],error:null};}
  if(n==='restore_trip_expense'){const r=rows.find(function(x){return x.id===a.p_expense_id;});if(!r)return err('expense_not_found');
    if(!r.deleted_at)return {data:[{expense_id:r.id,expense_version:r.version}],error:null};
    r.deleted_at=null;r.version+=1;return {data:[{expense_id:r.id,expense_version:r.version}],error:null};}
  if(n==='get_trip_member_public_profiles')return {data:[],error:null};
  return {data:null,error:{message:'unknown rpc '+n}};}
const NET={data:null,error:{message:'TypeError: Failed to fetch',details:'',hint:'',code:''}};
window.__rpcImpl=function(n,a){const ex=window.__ex;const q=ex.plan[n];const plan=q&&q.length?q.shift():null;
  if(plan==='network')return Promise.resolve(NET);
  if(plan==='apply-then-network'){applyRpc(n,a);return Promise.resolve(NET);}
  if(plan==='defer'){const d=deferred();ex.defers.push({n:n,a:a,d:d});return d.p;}
  if(plan&&plan.raw)return Promise.resolve({data:null,error:plan.raw});
  if(plan&&plan.error)return Promise.resolve(plan.sqlstate?{data:null,error:{message:plan.error,code:plan.sqlstate,details:null,hint:null}}:err(plan.error));
  return Promise.resolve(applyRpc(n,a));};
window.release=function(i){const x=window.__ex.defers[i];x.d.r(applyRpc(x.n,x.a));return true;};
window.__fromImpl=function(t,calls){const ex=window.__ex;
  if(t==='trip_expenses'){const pl=ex.listPlan.length?ex.listPlan.shift():null;
    if(pl==='error')return NET;
    if(pl==='defer'){const d=deferred();ex.listDefers.push({d:d,snap:listRows()});return d.p;}
    return {data:listRows(),error:null};}
  if(t==='trip_members'&&ex.membersError)return {data:null,error:{message:'permission denied for table trip_members',code:'42501',details:null,hint:null}};
  if(t==='trip_members')return {data:ex.members.map(function(m){return {id:'m-'+m.user_id,trip_id:ex.tripId,user_id:m.user_id,is_owner:!!m.is_owner,status:'accepted',invited_by:null,created_at:'2026-10-01T00:00:00Z',profiles:{id:m.user_id,display_name:m.name,avatar_url:null,updated_at:null}};}),error:null};
  if(t==='profiles'){const c=calls.find(function(x){return x[0]==='in';});const ids=c?c[2]:[];return {data:(ex.extraProfiles||[]).filter(function(p){return ids.indexOf(p.id)>=0;}),error:null};}
  return {data:[],error:null};};
window.releaseList=function(i){const x=window.__ex.listDefers[i];x.d.r({data:x.snap,error:null});return true;};
window.rejectList=function(i){const x=window.__ex.listDefers[i];x.d.r(NET);return true;};
window.unmountAll=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}return true;};
window.ss=function(){const o={};for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);o[k]=sessionStorage.getItem(k);}return o;};
window.serverPatch=function(id,patch){const r=window.__ex.srv.rows.find(function(x){return x.id===id;});Object.assign(r,patch);return true;};
window.mount=function(o){
  if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}
  sessionStorage.clear();window.__clock=o.clock||0;window.__vis='visible';
  const tripId=o.tripId||nextTripId();
  window.__ex={tripId:tripId,locale:o.locale||'zh-TW',uid:o.uid===undefined?o.me:o.uid,nav:[],backs:0,canGoBack:!!o.canGoBack,toasts:[],rpc:[],from:[],channels:[],
    plan:o.plan||{},defers:[],listPlan:o.listPlan||[],listDefers:[],members:o.members,extraProfiles:o.extraProfiles||[],membersError:!!o.membersError,
    srv:{idSeq:256,rows:(o.rows||[]).map(function(r){return Object.assign({},r,{trip_id:tripId});})}};
  if(o.mark)sessionStorage.setItem('roamie:trip-expenses-return',o.mark===true?tripId:o.mark);
  if(o.markAge!=null)sessionStorage.setItem('roamie:trip-expenses-return-at',o.markAge==='nan'?'abc':String(Date.now()-o.markAge));
  document.getElementById('root').innerHTML='';
  rootEl=createRoot(document.getElementById('root'));
  const Page=ExpRoute.options.component;
  const tree=o.what==='card'?React.createElement(ExpensesOverviewCard,{tripId:tripId,locale:window.__ex.locale}):o.what==='card2'?React.createElement('div',null,React.createElement(ExpensesOverviewCard,{tripId:tripId,locale:window.__ex.locale}),React.createElement(ExpensesOverviewCard,{tripId:tripId,locale:window.__ex.locale})):o.what==='route'?React.createElement(Page):React.createElement(TripExpensesScreen,{tripId:tripId});
  flushSync(function(){rootEl.render(React.createElement(StrictMode,null,tree));});
  return tripId;};
const qa=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
const dlg=function(){return document.querySelector('[role=dialog]');};
const scopeEl=function(scope){return scope==='dialog'?dlg():scope==='page'?document.getElementById('root'):document;};
const bInfo=function(b){return {text:b.textContent.trim(),label:b.getAttribute('aria-label'),disabled:b.disabled,role:b.getAttribute('role'),checked:b.getAttribute('aria-checked'),pressed:b.getAttribute('aria-pressed'),selected:b.getAttribute('aria-selected')};};
const findBtn=function(t,scope,role){const r=scopeEl(scope);if(!r)return null;return qa('button',r).find(function(b){return (!role||b.getAttribute('role')===role)&&(b.textContent.trim()===t||b.getAttribute('aria-label')===t);})||null;};
window.click=function(t,scope,role){const b=findBtn(t,scope,role);if(!b)return 'missing';if(b.disabled)return 'disabled';flushSync(function(){b.click();});return 'clicked';};
window.clickNth=function(t,n,scope){const r=scopeEl(scope);const bs=qa('button',r).filter(function(b){return b.textContent.trim()===t;});const b=bs[n];if(!b)return 'missing';if(b.disabled)return 'disabled';flushSync(function(){b.click();});return 'clicked';};
window.clickTwice=function(t,scope){return new Promise(function(res){const b=findBtn(t,scope);if(!b)return res('missing');b.click();setTimeout(function(){b.click();res('ok');},0);});};
window.clickNthTwice=function(t,n){return new Promise(function(res){const b=qa('button',document.getElementById('root')).filter(function(x){return x.textContent.trim()===t;})[n];if(!b)return res('missing');b.click();setTimeout(function(){b.click();res('ok');},0);});};
window.clickContains=function(s){const b=qa('#root ul li button').find(function(x){return x.textContent.indexOf(s)>=0;});if(!b)return 'missing';flushSync(function(){b.click();});return 'clicked';};
window.clickLabelPrefix=function(p){const d=dlg();const b=qa('button',d).find(function(x){return (x.getAttribute('aria-label')||'').indexOf(p)===0;});if(!b)return 'missing';flushSync(function(){b.click();});return 'clicked';};
window.pickCurrency=function(code){const d=dlg();const b=qa('button',d).find(function(x){const s=x.querySelector('span');return s&&s.textContent===code;});if(!b)return 'missing';flushSync(function(){b.click();});return 'clicked';};
window.currencySections=function(){const d=dlg();return qa('section',d).map(function(s){return {title:(s.querySelector('h4')||{}).textContent,codes:qa('li button',s).map(function(b){return b.querySelector('span').textContent;})};});};
function setVal(el,v){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}
window.setField=function(kind,v,label){const d=dlg();if(!d)return 'no-dialog';const C=window.COPY[window.__ex.locale];let el=null;
  if(kind==='amount')el=d.querySelector('input[inputmode=decimal]');
  else if(kind==='title')el=qa('input',d).find(function(i){return i.placeholder===C.titlePlaceholder;});
  else if(kind==='date')el=d.querySelector('input[type=date]');
  else if(kind==='note')el=d.querySelector('textarea');
  else if(kind==='search')el=d.querySelector('input[type=search]');
  else if(kind==='aria')el=qa('input',d).find(function(i){return i.getAttribute('aria-label')===label;});
  if(!el)return 'missing';flushSync(function(){setVal(el,v);});return 'set';};
window.touchPull=function(dy){const el=document.querySelector('main.app-scroll');const mk=function(type,y){const e=new Event(type,{bubbles:true});Object.defineProperty(e,'touches',{value:y==null?[]:[{clientY:y}]});return e;};
  el.dispatchEvent(mk('touchstart',10));el.dispatchEvent(mk('touchmove',10+dy/2));el.dispatchEvent(mk('touchmove',10+dy));el.dispatchEvent(mk('touchend',null));return true;};
window.visible=function(v){window.__vis=v||'visible';document.dispatchEvent(new Event('visibilitychange'));return true;};
window.toastAction=function(i){const t=window.__ex.toasts[i];t.o.action.onClick();return true;};
window.st=function(){const ex=window.__ex;const d=dlg();const C=window.COPY[ex.locale];return {
  text:document.getElementById('root').textContent,dialog:d?d.textContent:null,
  headings:qa('#root h2').map(function(h){return h.textContent;}),
  listRows:qa('#root ul li > button').map(function(b){return b.textContent;}),
  buttons:qa('#root button').map(bInfo),dbuttons:d?qa('button',d).map(bInfo):[],
  alerts:qa('[role=alert]').map(function(e){return e.textContent;}),status:qa('[role=status]').map(function(e){return e.textContent;}),
  rpc:ex.rpc,from:ex.from,channels:ex.channels.length,
  toasts:ex.toasts.map(function(t){return {kind:t.kind,m:t.m,duration:t.o&&t.o.duration,action:t.o&&t.o.action?t.o.action.label:null};}),
  nav:ex.nav,backs:ex.backs,
  srv:ex.srv.rows.map(function(r){return {id:r.id,title:r.title,version:r.version,deleted:!!r.deleted_at,kind:r.kind,crid:r.client_request_id};}),
  mark:sessionStorage.getItem('roamie:trip-expenses-return'),
  inputs:d?qa('input,textarea',d).map(function(i){return {type:i.type,value:i.value,label:i.getAttribute('aria-label'),ph:i.placeholder,inputmode:i.getAttribute('inputmode')};}):[],
  addBtn:(qa('#root button').find(function(b){return b.textContent.trim()===C.add;})||{disabled:null}).disabled};};
window.__ready=true;`;

// ── TripDetailScreen fixture（R20）──
const TD = "window.__td";
const detailMocks = {
  ...commonMocks(TD),
  "@/hooks/use-duo-layout": `const L={navPlacement:'bottom',tripLayout:'single',usableWidth:390};export const useDuoLayout=()=>L;`,
  "@/hooks/use-duo-laptop": `const L={laptop:false};export const useDuoLaptop=()=>L;`,
  "@tanstack/react-router": `const NAV=(o)=>{${TD}.nav.push(o);return Promise.resolve();};
const ROUTER={subscribe:()=>()=>{},history:{canGoBack:()=>false,back(){}}};
export const useNavigate=()=>NAV;export const useRouter=()=>ROUTER;
export const useRouterState=({select})=>select({location:{pathname:'/saved/x',searchStr:''}});`,
  "@/lib/itinerary-storage": `export const SAVED_TRIPS_CHANGED_EVENT='roamie:saved-trips-changed';
export const getItinerary=(id)=>Promise.resolve({id,user_id:'aaaaaaaa-0000-4000-8000-000000000001',title:'京都三日',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',payload:{itinerary:[],tripSettings:{startDate:'2026-11-20',endDate:'2026-11-22'},destination:'京都'}});export const listItineraries=async()=>[];`,
  "@/lib/trip/use-trip-realtime": `export const useTripRealtimeSync=()=>{};`,
  "@/lib/saved-trip/delete-trip": `export const deleteTrip=async()=>{};`,
  "@/components/trip/TripWorkspaceMap": `export const TripWorkspaceMap=()=>null;`,
  "@/hooks/use-workspace-swipe": `export const useWorkspaceSwipe=()=>{};export const WORKSPACE_PANE_STYLE={};`,
  "@/components/saved/SavedTripItineraryEditor": `export function SavedTripItineraryEditor(p){const ctx={dayGroups:[],openPlaceDetail(){},selectDay(){}};
 return <div data-editor-root=""><div style={{height:'400px'}} data-header=""/>{p.workspaceBar}{typeof p.workspaceContent==='function'?p.workspaceContent(ctx):p.workspaceContent}<div style={{height:'3000px'}} data-spacer=""/></div>;}`,
  "@/integrations/supabase/client": `function chain(t){const q={};for(const m of ['select','eq','neq','in','order','limit','is','match','filter'])q[m]=()=>q;
 const run=(kind)=>{${TD}.from.push(t);if(t==='saved_trips'&&kind==='single')return {data:{user_id:'aaaaaaaa-0000-4000-8000-000000000001'},error:null};
  if(t==='trip_members'&&kind==='single')return {data:{is_owner:true,status:'accepted'},error:null};return {data:kind==='single'?null:[],error:null};};
 q.maybeSingle=()=>Promise.resolve(run('single'));q.single=q.maybeSingle;
 q.then=(a,b)=>Promise.resolve(run('list')).then(a,b);return q;}
export const supabase={rpc:(n,a)=>{${TD}.rpc.push(n);return Promise.resolve({data:[],error:null});},from:(t)=>chain(t),
 auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 channel:(...a)=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{}};
export const isSupabaseConfigured=()=>true;`,
};
const detailEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TripDetailScreen} from '@/components/trip/TripDetailScreen';
import {saveTripWorkspaceScrollTops,readTripWorkspaceScrollTops} from '@/lib/trip/trip-detail-view-state';
import {getTripExpensesCopy} from '@/lib/i18n/trip-workspace-copy';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
let rootEl=null;
window.dmount=function(o){
  if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}
  if(!o.keepStorage){sessionStorage.clear();localStorage.clear();}
  window.__td={nav:[],toasts:[],rpc:[],from:[],locale:'zh-TW',uid:'aaaaaaaa-0000-4000-8000-000000000001'};
  if(o.tops)saveTripWorkspaceScrollTops(o.tripId,o.tops);
  if(o.mark)sessionStorage.setItem('roamie:trip-expenses-return',o.mark);
  if(o.back)sessionStorage.setItem('roamie:trip-expenses-back',JSON.stringify({tripId:o.back.tripId,at:Date.now()-o.back.age}));
  rootEl=createRoot(document.getElementById('droot'));
  flushSync(function(){rootEl.render(React.createElement(StrictMode,null,React.createElement(TripDetailScreen,{tripId:o.tripId,navSource:'verify',initialView:o.view})));});
  return true;};
window.dunmount=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}return true;};
window.dscroll=function(v){const el=document.querySelector('.trip-detail-route');if(!el)return null;if(v!=null){el.scrollTop=v;el.dispatchEvent(new Event('scroll'));}return el.scrollTop;};
window.dclickCard=function(){const C=getTripExpensesCopy('zh-TW');const b=Array.prototype.slice.call(document.querySelectorAll('#droot button')).find(function(x){return x.textContent.indexOf(C.title)>=0&&x.textContent.indexOf(C.overviewCta)>=0;});if(!b)return 'missing';flushSync(function(){b.click();});return 'clicked';};
window.dstate=function(){return {editor:!!document.querySelector('[data-editor-root]'),scrollTop:window.dscroll(),mark:sessionStorage.getItem('roamie:trip-expenses-return'),nav:window.__td.nav,
  tops:null,text:document.getElementById('droot').textContent,
  storedTops:sessionStorage.getItem('roamie:trip-workspace-scroll')};};
window.readTops=function(id){return readTripWorkspaceScrollTops(id);};
window.__dready=true;`;

// ── 測試資料 ──
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const X = "dddddddd-0000-4000-8000-000000000004"; // 已離開／已刪除帳號
const MEMBERS = [
  { user_id: A, name: "Amy", is_owner: true },
  { user_id: B, name: "Ben" },
  { user_id: C, name: "Cat" },
];
let rowSeq = 0;
function row({ title, amount, currency = "TWD", exp = 2, date = "2026-11-21", method = "equal", payers, shares, kind = "expense", created, version = 1, id }) {
  rowSeq += 1;
  return {
    id: id ?? "f0000000-0000-4000-8000-" + rowSeq.toString(16).padStart(12, "0"),
    kind, title, amount_minor: amount, currency, currency_exponent: exp, spent_on: date, split_method: method, note: null,
    created_by: A, updated_by: A, created_at: created ?? `2026-10-${String(rowSeq).padStart(2, "0")}T00:00:00.000Z`, updated_at: "2026-10-01T00:00:00Z",
    version, deleted_at: null, client_request_id: "c0000000-0000-4000-8000-" + rowSeq.toString(16).padStart(12, "0"),
    payers: payers.map(([user_id, amount_minor]) => ({ user_id, amount_minor })),
    shares: shares.map(([user_id, share_minor, percent_bp = null]) => ({ user_id, share_minor, percent_bp })),
  };
}

// ── R21 標題列吸頂蓋住狀態列（#TS-UX3）：與 verify-trip-packing-stage5.mjs R14 同一份量測 ──
// 套用真實 Tailwind 產出（dist/client/assets/styles-*.css，含 html.duo-rail 規則），main 加上 _app.tsx 的
// pt-[var(--safe-area-top)]，以 --safe-area-top／html.duo-rail 模擬 iPhone 狀態列與 Duo；同一個 header 換回舊 className
// （sticky top-0 … bg-background/95 backdrop-blur、無 inline style）量測，比對幾何。
const HEADER_OLD_CLASS = "sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur";
const HEADER_CASES = [{ safe: "0px" }, { safe: "47px" }, { safe: "59px" }, { safe: "0px", duo: true }, { safe: "47px", duo: true }];
const HEADER_EXPECT_PAD = [0, 47, 59, 14, 47];
function headerGeoCss() {
  const cssDir = path.join(root, "dist/client/assets");
  const f = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).find((x) => /^styles-.*\.css$/.test(x)) : null;
  const css = f ? fs.readFileSync(path.join(cssDir, f), "utf8").replace(/@import\s*(?:url\()?\s*(?:"[^"]*"|'[^']*'|[^)"';]*)\s*\)?[^;]*;/g, "") : "";
  const need = [".sticky{", ".top-0{", ".z-20{", ".py-2\\.5{", ".border-b{", ".backdrop-blur{", ".pt-\\[var\\(--safe-area-top\\)\\]", "html.duo-rail main.app-scroll", "--duo-app-top:"];
  return { css, source: f ? "dist/client/assets/" + f : null, missing: need.filter((n) => !css.includes(n)) };
}
const HEADER_GEO_FN = String.raw`async function(css,oldCls,cases){
  const st=document.createElement('style');st.id='hdr-geo-css';st.textContent=css;document.head.appendChild(st);
  const html=document.documentElement;const main=document.querySelector('main.app-scroll');const PT='pt-[var(--safe-area-top)]';main.classList.add(PT);
  const h=document.querySelector('#root header');const t=h.querySelector('h1');
  const frame=function(){return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});};
  const alpha=function(c){c=String(c);if(c==='transparent')return 0;let m=c.match(/\/\s*([\d.]+)(%?)\s*\)$/);if(m)return m[2]?parseFloat(m[1])/100:parseFloat(m[1]);m=c.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/);return m?parseFloat(m[1]):1;};
  const measure=async function(){const out={};for(const s of [0,400]){main.scrollTop=s;await frame();
    const mr=main.getBoundingClientRect();const hr=h.getBoundingClientRect();const tr=t.getBoundingClientRect();const pad=parseFloat(getComputedStyle(main).paddingTop);const nx=h.nextElementSibling;
    const ys=pad>0?[1,Math.floor(pad/2),Math.max(1,Math.ceil(pad)-1)]:[];const cs=getComputedStyle(h);
    out[s]={scrollTop:main.scrollTop,pad:pad,hTop:hr.top-mr.top,hBottom:hr.bottom-mr.top,titleTop:tr.top-mr.top,nextTop:nx?nx.getBoundingClientRect().top-mr.top+main.scrollTop:null,
      covered:ys.map(function(y){const e=document.elementFromPoint(mr.left+mr.width/2,mr.top+y);return !!e&&h.contains(e);}),bg:cs.backgroundColor,bgAlpha:alpha(cs.backgroundColor),position:cs.position};}
    main.scrollTop=0;await frame();return out;};
  const res=[];
  for(const c of cases){html.style.setProperty('--safe-area-top',c.safe);html.classList.toggle('duo-rail',!!c.duo);await frame();
    const now=await measure();const oc=h.className;const os=h.getAttribute('style');h.className=oldCls;h.removeAttribute('style');const old=await measure();h.className=oc;if(os!=null)h.setAttribute('style',os);
    res.push({c:c,now:now,old:old,scrollMax:main.scrollHeight-main.clientHeight,style:os});}
  html.style.removeProperty('--safe-area-top');html.classList.remove('duo-rail');main.classList.remove(PT);st.remove();return res;}`;
async function headerGeoChecks(tag, page, res, cssInfo) {
  const r1 = (x) => Math.round(x * 10) / 10;
  info(`${tag} CSS：${cssInfo.source ?? "（無 dist CSS）"}${cssInfo.missing.length ? "；缺少 " + cssInfo.missing.join(" ") : ""}`);
  for (const x of res) {
    const pick = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { hTop: r1(v.hTop), hBottom: r1(v.hBottom), title: r1(v.titleTop), next: v.nextTop == null ? null : r1(v.nextTop), covered: v.covered, bg: v.bg }]));
    info(`${tag} ${JSON.stringify(x.c)} pad=${x.now[0].pad} scrollMax=${x.scrollMax} 新：${JSON.stringify(pick(x.now))} 舊：${JSON.stringify(pick(x.old))}`);
  }
  await check(`${tag} ${page}標題列：量測前提（真實 CSS 可用、position sticky、可捲動 ≥ 400px、main 上內距＝0／47／59／Duo 14／Duo 47）`, () => {
    assert.deepEqual(cssInfo.missing, [], "缺少真實 CSS");
    res.forEach((x, i) => {
      assert.equal(x.now[0].position, "sticky");
      assert.ok(x.scrollMax >= 400, "內容不足以捲動 400px：" + x.scrollMax);
      assert.equal(x.now[400].scrollTop, 400);
      assert.equal(x.now[0].pad, HEADER_EXPECT_PAD[i], JSON.stringify(x.c));
    });
  });
  const web = res[0];
  await check(`${tag} ${page}網頁版（safe-area 0、非 Duo）：捲動前後 header 上下緣、標題文字、下一個區塊位置與修改前完全相同`, () => {
    for (const s of [0, 400]) {
      for (const k of ["hTop", "hBottom", "titleTop", "nextTop"]) assert.ok(Math.abs(web.now[s][k] - web.old[s][k]) < 0.5, `scroll ${s} ${k}：新 ${web.now[s][k]} 舊 ${web.old[s][k]}`);
    }
  });
  for (let i = 1; i < res.length; i++) {
    const x = res[i];
    const pad = HEADER_EXPECT_PAD[i];
    const label = (x.c.duo ? "Duo（--duo-app-top）" : "iPhone") + " safe-area-top " + x.c.safe;
    await check(`${tag} ${page}${label}：未捲動時標題文字／header 下緣／下一個區塊位置與修改前相同、header 背景延伸到頂端；捲動 400px 後 header 貼齊捲動容器頂端、標題文字不動、狀態列區（0～${pad}px）全被不透明 header 蓋住（修改前會露出內容）`, () => {
      const n0 = x.now[0], n4 = x.now[400], o0 = x.old[0], o4 = x.old[400];
      assert.ok(Math.abs(n0.titleTop - o0.titleTop) < 0.5, `標題位置改變：新 ${n0.titleTop} 舊 ${o0.titleTop}`);
      assert.ok(Math.abs(n0.hBottom - o0.hBottom) < 0.5, `header 下緣改變：新 ${n0.hBottom} 舊 ${o0.hBottom}`);
      assert.ok(Math.abs(n0.nextTop - o0.nextTop) < 0.5, `下一個區塊位置改變：新 ${n0.nextTop} 舊 ${o0.nextTop}`);
      assert.ok(Math.abs(n0.hTop) < 0.5, "未捲動時 header 未延伸到頂端：" + n0.hTop);
      assert.ok(Math.abs(n4.hTop) < 0.5, "捲動後 header 未貼齊捲動容器頂端：" + n4.hTop);
      assert.ok(Math.abs(n4.titleTop - n0.titleTop) < 0.5, `捲動後標題文字移動：${n0.titleTop} → ${n4.titleTop}`);
      assert.ok(n4.covered.length > 0 && n4.covered.every(Boolean), "狀態列區有點未被 header 蓋住：" + JSON.stringify(n4.covered));
      assert.equal(n4.bgAlpha, 1, "header 背景非不透明：" + n4.bg);
      assert.ok(o4.covered.some((c) => !c), "敏感度：舊 className 捲動後應會露出狀態列區內容，實得 " + JSON.stringify(o4.covered));
    });
  }
}

if (!chromeBin) {
  failures.push("R 無可用 Chrome");
  console.log("FAIL R 無可用 Chrome，未執行瀏覽器 render");
} else {
  await runBrowser();
}

async function runBrowser() {
  const common = {
    bundle: true, logLevel: "error", format: "iife", jsx: "automatic", jsxDev: true,
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
  };
  await build({ ...common, stdin: { contents: exEntry, resolveDir: root, loader: "tsx" }, outfile: path.join(tmp, "app.js"), plugins: [mockPlugin(exMocks)] });
  await build({ ...common, stdin: { contents: detailEntry, resolveDir: root, loader: "tsx" }, outfile: path.join(tmp, "detail.js"), plugins: [mockPlugin(detailMocks)] });
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js" || req.url === "/detail.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(tmp, req.url.slice(1))));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/detail.html") {
      res.end('<!doctype html><html><head><meta charset="utf-8"><style>.trip-detail-route{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column}.hidden{display:none}</style></head><body style="margin:0"><div id="droot" style="height:600px;display:flex;flex-direction:column;overflow:hidden"></div><script src="/detail.js"></script></body></html>');
      return;
    }
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main class="app-scroll" style="height:700px;overflow-y:auto"><div id="root"></div></main><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(tmp, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const externalRequests = [];
  const browserErrors = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let out = "";
      chrome.stderr.on("data", (b) => {
        out += b;
        const m = out.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      chrome.on("error", reject);
      setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
    });
    ws = new WebSocket(endpoint);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const r = JSON.parse(e.data);
      if (r.method === "Runtime.exceptionThrown") browserErrors.push(r.params.exceptionDetails.exception?.description);
      if (r.method === "Runtime.consoleAPICalled" && r.params.type === "error")
        browserErrors.push("console.error: " + r.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
      if (r.method === "Network.requestWillBeSent") {
        const u = r.params.request.url;
        if (!/^(data:|blob:|about:|http:\/\/127\.0\.0\.1:)/.test(u)) externalRequests.push(u);
      }
      if (r.id && pending.has(r.id)) {
        const p = pending.get(r.id);
        pending.delete(r.id);
        r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const next = ++id;
        pending.set(next, { resolve, reject });
        ws.send(JSON.stringify({ id: next, method, params, sessionId }));
      });
    const { targetInfos } = await send("Target.getTargets");
    const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.join("\n"));

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ev = (fn, ...args) => evaluate(`window.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    const st = () => evaluate("window.st()");
    const COPY = await evaluate("window.COPY");
    const Z = COPY["zh-TW"];
    const mount = async (o) => {
      const tripId = await ev("mount", { me: A, members: MEMBERS, ...o });
      for (let i = 0; i < 80; i++) {
        const s = await st();
        if (o.what === "card" ? !s.text.includes(Z.overviewLoading) || i > 20 : s.addBtn === false || s.text.includes(Z.loadFailed) || o.what === "route") break;
        await sleep(25);
      }
      await sleep(120);
      return tripId;
    };
    const lists = (s) => s.from.filter((f) => f.t === "trip_expenses");
    const upserts = (s) => s.rpc.filter((r) => r[0] === "upsert_trip_expense").map((r) => r[1]);
    const openAdd = async () => {
      assert.equal(await ev("click", Z.add, "page"), "clicked", "新增花費按鈕");
      await sleep(60);
    };
    const save = async (label = Z.save) => {
      const r = await ev("click", label, "dialog");
      await sleep(120);
      return r;
    };
    const today = await evaluate("(function(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})()");

    // ═══ R1 ═══
    {
      const rows = [
        row({ title: "晚餐", amount: 90000, date: "2026-11-21", payers: [[A, 90000]], shares: [[A, 30000], [B, 30000], [C, 30000]] }),
        row({ title: "拉麵", amount: 3000, currency: "JPY", exp: 0, date: "2026-11-20", payers: [[B, 3000]], shares: [[A, 1000], [B, 1000], [C, 1000]] }),
        row({ title: "計程車", amount: 60000, date: "2026-11-21", payers: [[B, 60000]], shares: [[A, 30000], [B, 30000]], method: "equal" }),
      ];
      const tripId = await mount({ rows });
      const s = await st();
      const l = lists(s);
      const twdTotal = await ev("fmt", 150000, "TWD", 2, true);
      const myTwd = await ev("fmt", 30000, "TWD", 2, true); // A：付 90000、應付 60000 → +30000
      const myJpy = await ev("fmt", 1000, "JPY", 0, true); // A：應付 1000 → -1000
      await check("R1 進入頁面：一次巢狀 select（payers＋shares、deleted_at is null）、StrictMode 只查 1 次、無 channel；日期分組新到舊；依幣別總額與我的淨額", () => {
        assert.equal(l.length, 1, "trip_expenses 查詢次數：" + l.length);
        const sel = l[0].calls.find((c) => c[0] === "select")[1].replace(/\s+/g, " ");
        assert.match(sel, /trip_expense_payers \( user_id, amount_minor \)/);
        assert.match(sel, /trip_expense_shares \( user_id, share_minor, percent_bp \)/);
        assert.match(sel, /\bversion\b/);
        assert.deepEqual(l[0].calls.find((c) => c[0] === "eq"), ["eq", "trip_id", tripId]);
        assert.deepEqual(l[0].calls.find((c) => c[0] === "is"), ["is", "deleted_at", null]);
        assert.equal(s.from.filter((f) => f.t === "trip_expense_payers" || f.t === "trip_expense_shares").length, 0, "另外查 payers／shares 表");
        assert.equal(s.channels, 0);
        assert.equal(s.headings.length, 2, JSON.stringify(s.headings));
        assert.ok(s.headings[0].includes("21") && s.headings[1].includes("20"), "日期應新到舊：" + JSON.stringify(s.headings));
        assert.ok(s.text.includes(Z.totalLabel + " · TWD") && s.text.includes(Z.totalLabel + " · JPY"), s.text);
        assert.ok(s.text.includes(twdTotal), "TWD 總額 " + twdTotal + "：" + s.text);
        assert.ok(s.text.includes(Z.netOwed.replace("{amount}", myTwd)), "TWD 我的淨額：" + s.text);
        assert.ok(s.text.includes(Z.netOwe.replace("{amount}", myJpy)), "JPY 我的淨額：" + s.text);
        assert.ok(s.text.includes(Z.paidBy.replace("{name}", Z.you)) && s.text.includes(Z.paidBy.replace("{name}", "Ben")), "付款人顯示");
      });
      info("StrictMode 進入頁面 trip_members 查詢次數：" + s.from.filter((f) => f.t === "trip_members").length + "（reloadMembers 無去重；僅 dev 雙重 effect）");
    }

    // ═══ R2 ═══
    {
      const rows = [
        row({ title: "門票", amount: 2000, date: "2026-11-21", payers: [[X, 2000]], shares: [[X, 1000], [A, 1000]] }),
        row({ title: "咖啡", amount: 600, date: "2026-11-21", payers: [[A, 600]], shares: [[A, 300], [B, 300]] }),
      ];
      await mount({ rows });
      const s0 = await st();
      await ev("click", Z.tabSettle, "page");
      await sleep(40);
      await ev("click", Z.tabExpenses, "page");
      await ev("touchPull", 200);
      await sleep(120);
      await evaluate("window.__clock=31000");
      await ev("visible", "visible");
      await sleep(120);
      await openAdd();
      await ev("click", Z.close, "dialog");
      await sleep(80);
      const s1 = await st();
      const prof = s1.from.filter((f) => f.t === "profiles");
      await check("R2 非成員（已離開／已刪除帳號）：整段 profiles 查詢 0 次（含切分頁、下拉、回前景、開新增）；顯示「已不在行程中的成員」", () => {
        assert.equal(prof.length, 0, "profiles 查詢次數：" + prof.length + " " + JSON.stringify(prof.map((p) => p.calls)));
        assert.equal(s1.rpc.filter((r) => r[0] === "get_trip_member_public_profiles").length, 0, "改用 RPC 補查 profile");
        assert.equal(Z.deletedUser, "已不在行程中的成員");
        assert.ok(s0.text.includes(Z.paidBy.replace("{name}", Z.deletedUser)), s0.text);
        assert.ok(lists(s1).length >= 3, "下拉／回前景未重讀：" + lists(s1).length);
      });
      await mount({ rows, extraProfiles: [{ id: X, display_name: "Xena", avatar_url: null, updated_at: null }] });
      await ev("click", Z.tabSettle, "page");
      await sleep(40);
      const s2 = await st();
      await check("R2b 即使 profiles 有該使用者資料也不補查：仍顯示「已不在行程中的成員」（列表與結算表），不顯示名字", () => {
        assert.equal(s2.from.filter((f) => f.t === "profiles").length, 0);
        assert.ok(!s2.text.includes("Xena"), s2.text);
        assert.ok(s2.text.includes(Z.deletedUser), s2.text);
      });
      for (const loc of ["en", "ja", "ko"]) {
        await mount({ rows, locale: loc });
        const sl = await st();
        const L = COPY[loc];
        await check(`R2c ${loc}：非成員顯示「${L.deletedUser}」、profiles 0 次`, () => {
          assert.equal(L.deletedUser, { en: "Former member", ja: "退出したメンバー", ko: "나간 멤버" }[loc]);
          assert.ok(sl.text.includes(L.paidBy.replace("{name}", L.deletedUser)), sl.text);
          assert.equal(sl.from.filter((f) => f.t === "profiles").length, 0);
        });
      }
    }

    // ═══ R3 新增（平均）═══
    let lastCrid = null;
    {
      const rows = [row({ title: "晚餐", amount: 90000, payers: [[A, 90000]], shares: [[A, 30000], [B, 30000], [C, 30000]] })];
      const tripId = await mount({ rows });
      await openAdd();
      const s0 = await st();
      await ev("setField", "amount", "10.01");
      await ev("setField", "title", "  早餐  ");
      const r = await save();
      const s1 = await st();
      const u = upserts(s1);
      await check("R3 新增（平均）：payload 欄位與後端契約完全一致、SQL 規則不拒絕；金額 inputmode=decimal；預設幣別＝此行程最近一筆；送出後關閉並重讀", () => {
        const amountInput = s0.inputs.find((i) => i.inputmode === "decimal");
        assert.equal(amountInput.type, "text");
        assert.ok(s0.dbuttons.some((b) => b.label === Z.currencyChange + ": TWD"), "預設幣別應為 TWD");
        assert.equal(r, "clicked");
        assert.equal(u.length, 1);
        const a = u[0];
        assertContractShape(a);
        assert.equal(a.p_trip_id, tripId);
        assert.equal(a.p_expected_version, null);
        assert.equal(a.p_expense.id, null);
        assert.match(a.p_expense.client_request_id, UUID_V4);
        assert.deepEqual(
          { ...a.p_expense, client_request_id: "-" },
          {
            id: null, client_request_id: "-", kind: "expense", title: "早餐", amount_minor: 1001, currency: "TWD", currency_exponent: 2,
            spent_on: today, split_method: "equal", note: null,
            payers: [{ user_id: A, amount_minor: 1001 }],
            shares: [{ user_id: A, share_minor: 334, percent_bp: null }, { user_id: B, share_minor: 334, percent_bp: null }, { user_id: C, share_minor: 333, percent_bp: null }],
          },
        );
        assert.equal(sqlUpsert(a, { members: [A, B, C] }), null);
        assert.equal(s1.dialog, null, "送出成功後 Sheet 應關閉");
        assert.ok(lists(s1).length >= 2, "儲存後未重讀");
        assert.ok(s1.text.includes("早餐"), "新花費未出現");
      });
      lastCrid = u[0]?.p_expense.client_request_id;
      // 第二次新增：新的 client_request_id
      await openAdd();
      await ev("setField", "amount", "5");
      await ev("setField", "title", "水");
      await save();
      const s2 = await st();
      await check("R3b 新的一次新增產生新的 client_request_id", () => {
        const u2 = upserts(s2);
        assert.equal(u2.length, 2);
        assert.match(u2[1].p_expense.client_request_id, UUID_V4);
        assert.notEqual(u2[1].p_expense.client_request_id, lastCrid);
      });
    }

    // ═══ R3p 「誰先付款」頭像：選中外框（ring-2）不被 overflow 裁切；間距不變（#TS-PACK）═══
    // 套用真實 Tailwind 產出（dist/client/assets/styles-*.css；沒有時用等值的最小規則），量測 render 後的幾何。
    {
      const cssDir = path.join(root, "dist/client/assets");
      const distCss = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).find((f) => /^styles-.*\.css$/.test(f)) : null;
      // 去掉 @import（Google Fonts），避免外部請求（R19）
      let css = distCss ? fs.readFileSync(path.join(cssDir, distCss), "utf8").replace(/@import\s*(?:url\()?\s*(?:"[^"]*"|'[^']*'|[^)"';]*)\s*\)?[^;]*;/g, "") : "";
      const needed = [".py-1{", ".mt-1{", ".mt-2{", ".pb-1{", ".px-1{", ".-mx-1{", ".ring-2{", ".overflow-x-auto{"];
      const cssSource = distCss && needed.every((n) => css.includes(n)) ? "dist/client/assets/" + distCss : "fallback";
      if (cssSource === "fallback") {
        css = ".flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.shrink-0{flex-shrink:0}.gap-1{gap:.25rem}.gap-2{gap:.5rem}" +
          ".overflow-x-auto{overflow-x:auto}.-mx-1{margin-inline:-.25rem}.mt-1{margin-top:.25rem}.mt-2{margin-top:.5rem}.mt-5{margin-top:1.25rem}" +
          ".px-1{padding-inline:.25rem}.py-1{padding-block:.25rem}.pb-1{padding-bottom:.25rem}.p-0\\.5{padding:.125rem}.w-16{width:4rem}.h-10{height:2.5rem}.w-10{width:2.5rem}" +
          ".ring-2{box-shadow:0 0 0 2px var(--rc,currentcolor)}.ring-transparent{--rc:transparent}";
      }
      info("R3p 使用 CSS：" + cssSource);
      await mount({ rows: [] });
      await openAdd();
      const geo = await evaluate(`(function(css,label){
        const st=document.createElement('style');st.id='r3p-css';st.textContent=css;document.head.appendChild(st);
        const g=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] [role=radiogroup]')).find(function(x){return x.getAttribute('aria-label')===label;});
        if(!g){st.remove();return {missing:true};}
        const fs=g.closest('fieldset');const lg=fs&&fs.querySelector('legend');
        const measure=function(){const gr=g.getBoundingClientRect();const cs=getComputedStyle(g);
          const act=g.querySelector('button[aria-checked=true] > span');const ar=act?act.getBoundingClientRect():null;
          const first=g.querySelector('button[role=radio] > span').getBoundingClientRect();
          const next=fs.nextElementSibling;
          return {cls:g.className,overflowX:cs.overflowX,overflowY:cs.overflowY,padTop:cs.paddingTop,padBottom:cs.paddingBottom,
            activeRing:act?/\\bring-2\\b/.test(act.className):null,activeCount:g.querySelectorAll('button[aria-checked=true]').length,
            ringTopGap:ar?(ar.top-2)-gr.top:null,ringBottomGap:ar?gr.bottom-(ar.bottom+2):null,ringLeftGap:(first.left-2)-gr.left,
            legendToAvatar:ar&&lg?ar.top-lg.getBoundingClientRect().bottom:null,fieldsetH:fs.getBoundingClientRect().height,
            groupH:gr.height,nextTop:next?next.getBoundingClientRect().top-fs.getBoundingClientRect().top:null};};
        const now=measure();
        const orig=g.className;g.className=orig.replace(/\\bmt-1\\b/,'mt-2').replace(/\\bpy-1\\b/,'pb-1');const old=measure();g.className=orig;
        st.remove();return {now:now,old:old};})(${JSON.stringify(css)},${JSON.stringify(Z.payerLabel)})`);
      info("R3p 量測：" + JSON.stringify(geo));
      await check("R3p 誰先付款頭像列：選中頭像 ring-2 外框上下左右都在捲動容器 padding 內（不被裁切）；與舊 className（mt-2 pb-1）相比標題到頭像距離與整體高度不變", () => {
        assert.ok(!geo.missing, "找不到「誰先付款」radiogroup");
        const { now, old } = geo;
        assert.match(now.cls, /\boverflow-x-auto\b/);
        assert.equal(now.overflowX, "auto");
        assert.notEqual(now.overflowY, "visible", "overflow-x:auto 會讓 y 方向也裁切（前提）");
        assert.equal(now.activeCount, 1, "新增時應預設選中一位付款人");
        assert.equal(now.activeRing, true, "選中頭像應有 ring-2");
        assert.equal(now.padTop, "4px");
        assert.equal(now.padBottom, "4px");
        assert.ok(now.ringTopGap >= 0, "ring 頂端被裁切 " + now.ringTopGap + "px");
        assert.ok(now.ringBottomGap >= 0, "ring 底端被裁切 " + now.ringBottomGap + "px");
        assert.ok(now.ringLeftGap >= 0, "第一個頭像 ring 左側被裁切 " + now.ringLeftGap + "px");
        // 敏感度：舊 className 下確實會裁切（證明本斷言能抓到原 bug）
        assert.ok(old.ringTopGap < 0, "舊 className 應會裁切頂端，實得 " + old.ringTopGap);
        assert.equal(Math.round(now.legendToAvatar), Math.round(old.legendToAvatar), "標題到頭像距離改變");
        assert.equal(Math.round(now.fieldsetH), Math.round(old.fieldsetH), "fieldset 高度改變");
        assert.equal(Math.round(now.nextTop ?? 0), Math.round(old.nextTop ?? 0), "下方元素位置改變");
      });
    }

    // ═══ R4 百分比 ═══
    {
      await mount({ rows: [] });
      await openAdd();
      await ev("setField", "amount", "100");
      await ev("setField", "title", "住宿");
      await ev("click", Z.splitPercent, "dialog", "radio");
      await sleep(30);
      const s0 = await st();
      const pct = (n) => s0.inputs.find((i) => i.label === `${n} ${Z.splitPercent}`)?.value;
      await check("R4a 百分比預設：依 equal 規則平均 bp（33.34／33.33／33.33），顯示相符", () => {
        assert.deepEqual([pct(Z.you), pct("Ben"), pct("Cat")], ["33.34", "33.33", "33.33"]);
        assert.ok(s0.dialog.includes(Z.percentMatched), s0.dialog);
      });
      await ev("setField", "aria", "50", `${Z.you} ${Z.splitPercent}`);
      await ev("setField", "aria", "20", `Ben ${Z.splitPercent}`);
      await ev("setField", "aria", "20", `Cat ${Z.splitPercent}`);
      const s1 = await st();
      await save();
      const s2 = await st();
      await check("R4b 百分比總和不符（90%）：即時顯示「還差 10%」、不送出", () => {
        assert.ok(s1.dialog.includes(Z.percentRemaining.replace("{value}", "10")), s1.dialog);
        assert.equal(upserts(s2).length, 0);
        assert.ok(s2.dialog, "Sheet 應保留");
      });
      await ev("setField", "amount", "1.01");
      await ev("setField", "aria", "25", `Ben ${Z.splitPercent}`);
      await ev("setField", "aria", "25", `Cat ${Z.splitPercent}`);
      await save();
      const s3 = await st();
      await check("R4c 百分比 50/25/25 × 1.01：payload 與 SQL 演算法一致（零頭依餘數）", () => {
        const u = upserts(s3);
        assert.equal(u.length, 1);
        assertContractShape(u[0]);
        assert.equal(u[0].p_expense.split_method, "percent");
        assert.deepEqual(u[0].p_expense.shares, [
          { user_id: A, share_minor: 51, percent_bp: 5000 },
          { user_id: B, share_minor: 25, percent_bp: 2500 },
          { user_id: C, share_minor: 25, percent_bp: 2500 },
        ]);
        assert.equal(sqlUpsert(u[0], { members: [A, B, C] }), null);
      });
      // 0% 的參與者
      await openAdd();
      await ev("setField", "amount", "7");
      await ev("setField", "title", "小費");
      await ev("click", Z.splitPercent, "dialog", "radio");
      await ev("setField", "aria", "100", `${Z.you} ${Z.splitPercent}`);
      await ev("setField", "aria", "0", `Ben ${Z.splitPercent}`);
      await ev("setField", "aria", "", `Cat ${Z.splitPercent}`);
      await save();
      const s4 = await st();
      await check("R4d 百分比含 0%／空白參與者：SQL 不拒絕（share 0、bp 0）", () => {
        const u = upserts(s4);
        assert.equal(u.length, 2);
        assert.equal(sqlUpsert(u[1], { members: [A, B, C] }), null, JSON.stringify(u[1].p_expense.shares));
      });
    }

    // ═══ R5 自訂金額＋幣別選擇器 ═══
    {
      const rows = [
        row({ title: "A", amount: 1000, currency: "TWD", created: "2026-10-01T00:00:00Z", payers: [[A, 1000]], shares: [[A, 1000]] }),
        row({ title: "B", amount: 500, currency: "KRW", exp: 0, created: "2026-10-05T00:00:00Z", payers: [[A, 500]], shares: [[A, 500]] }),
      ];
      await mount({ rows });
      await openAdd();
      const s0 = await st();
      await ev("clickLabelPrefix", Z.currencyChange);
      await sleep(40);
      const secs = await evaluate("window.currencySections()");
      await ev("setField", "search", "jpy");
      await sleep(30);
      const secsQ = await evaluate("window.currencySections()");
      await check("R5a 預設幣別＝最近一筆（KRW）；選擇器分「此行程用過／常用／全部 A–Z」，常用為指定 11 種，全部依字母；搜尋可篩選", () => {
        assert.ok(s0.dbuttons.some((b) => b.label === Z.currencyChange + ": KRW"), JSON.stringify(s0.dbuttons.map((b) => b.label)));
        assert.deepEqual(secs.map((x) => x.title), [Z.currencyUsed, Z.currencyCommon, Z.currencyAll]);
        assert.deepEqual(secs[0].codes, ["KRW", "TWD"]);
        assert.deepEqual(secs[1].codes, ["TWD", "JPY", "USD", "KRW", "EUR", "GBP", "AUD", "HKD", "CNY", "SGD", "THB"]);
        assert.deepEqual(secs[2].codes, [...secs[2].codes].sort());
        assert.ok(secs[2].codes.length > 100);
        assert.deepEqual(secsQ.map((x) => x.codes), [["JPY"], ["JPY"]]);
      });
      await ev("pickCurrency", "JPY");
      await sleep(30);
      await ev("setField", "amount", "12.5");
      await ev("setField", "title", "便當");
      await save();
      const s1 = await st();
      await check("R5b JPY 輸入 12.5：顯示「最多 0 位小數」、不送出", () => {
        assert.ok(s1.dialog.includes(Z.validationAmountDecimals.replace("{n}", "0")), s1.dialog);
        assert.equal(upserts(s1).length, 0);
      });
      await ev("setField", "amount", "1,000");
      await ev("click", Z.splitExact, "dialog", "radio");
      await sleep(20);
      const sPre = await st();
      const ex = (n) => sPre.inputs.find((i) => i.label === `${n} ${Z.amountLabel}`)?.value;
      await ev("setField", "aria", "300", `${Z.you} ${Z.amountLabel}`);
      const sUnder = await st();
      await ev("setField", "aria", "500", `${Z.you} ${Z.amountLabel}`);
      const sOver = await st();
      await save();
      const sOverSave = await st();
      await ev("setField", "aria", "334", `${Z.you} ${Z.amountLabel}`);
      const sOk = await st();
      const fUnder = await ev("fmt", 34, "JPY", 0, false);
      const fOver = await ev("fmt", 166, "JPY", 0, false);
      await check("R5c 自訂金額：以目前平均結果預填；即時顯示還差／超出／相符；不符時不送出", () => {
        assert.deepEqual([ex(Z.you), ex("Ben"), ex("Cat")], ["334", "333", "333"]);
        assert.ok(sPre.dialog.includes(Z.exactMatched));
        assert.ok(sUnder.dialog.includes(Z.exactRemaining.replace("{amount}", fUnder)), sUnder.dialog);
        assert.ok(sOver.dialog.includes(Z.exactOver.replace("{amount}", fOver)), sOver.dialog);
        assert.equal(upserts(sOverSave).length, 0, "超出時送出了");
        assert.ok(sOk.dialog.includes(Z.exactMatched));
      });
      await save();
      const s2 = await st();
      await check("R5d 自訂金額 JPY 1,000：amount_minor 1000、exponent 0、exact、percent_bp null；SQL 不拒絕", () => {
        const u = upserts(s2);
        assert.equal(u.length, 1);
        assertContractShape(u[0]);
        assert.equal(u[0].p_expense.amount_minor, 1000);
        assert.equal(u[0].p_expense.currency, "JPY");
        assert.equal(u[0].p_expense.currency_exponent, 0);
        assert.equal(u[0].p_expense.split_method, "exact");
        assert.deepEqual(u[0].p_expense.shares.map((x) => [x.share_minor, x.percent_bp]), [[334, null], [333, null], [333, null]]);
        assert.equal(sqlUpsert(u[0], { members: [A, B, C] }), null);
      });
      // BHD 3 位、只勾自己
      await openAdd();
      await ev("clickLabelPrefix", Z.currencyChange);
      await ev("setField", "search", "BHD");
      await ev("pickCurrency", "BHD");
      await ev("setField", "amount", "1.234");
      await ev("setField", "title", "果汁");
      await ev("click", "Ben", "dialog", "checkbox");
      await ev("click", "Cat", "dialog", "checkbox");
      await save();
      const s3 = await st();
      await check("R5e BHD 1.234 → amount_minor 1234、exponent 3；只勾自己（平均 1 人）SQL 不拒絕", () => {
        const u = upserts(s3);
        assert.equal(u.length, 2);
        assert.equal(u[1].p_expense.amount_minor, 1234);
        assert.equal(u[1].p_expense.currency_exponent, 3);
        assert.deepEqual(u[1].p_expense.shares, [{ user_id: A, share_minor: 1234, percent_bp: null }]);
        assert.equal(sqlUpsert(u[1], { members: [A, B, C] }), null);
      });
    }

    // ═══ R6 失敗重試 ═══
    {
      await mount({ rows: [], plan: { upsert_trip_expense: ["network"] } });
      await openAdd();
      await ev("setField", "amount", "88");
      await ev("setField", "title", "伴手禮");
      await ev("setField", "note", "給同事");
      await save();
      const s1 = await st();
      await save(Z.retry);
      const s2 = await st();
      await check("R6a 寫入失敗：保留輸入、顯示網路錯誤、按鈕變「重試」；重試沿用同一 client_request_id，成功後關閉", () => {
        assert.ok(s1.dialog, "失敗後 Sheet 應保留");
        assert.ok(s1.alerts.includes(Z.errorNetwork), JSON.stringify(s1.alerts));
        assert.equal(s1.inputs.find((i) => i.inputmode === "decimal").value, "88");
        assert.ok(s1.inputs.some((i) => i.value === "伴手禮"));
        assert.ok(s1.inputs.some((i) => i.type === "textarea" && i.value === "給同事"));
        assert.ok(s1.dbuttons.some((b) => b.text === Z.retry && !b.disabled), JSON.stringify(s1.dbuttons));
        const u = upserts(s2);
        assert.equal(u.length, 2);
        assert.equal(u[0].p_expense.client_request_id, u[1].p_expense.client_request_id);
        assert.equal(u[1].p_expense.note, "給同事");
        assert.equal(s2.dialog, null);
      });
      await mount({ rows: [], plan: { upsert_trip_expense: ["apply-then-network"] } });
      await openAdd();
      await ev("setField", "amount", "88");
      await ev("setField", "title", "伴手禮");
      await save();
      await save(Z.retry);
      const s3 = await st();
      await check("R6b 回應遺失（後端已寫入）後重試：沿用 id → 後端 replay，不重複建立", () => {
        assert.equal(s3.srv.length, 1, JSON.stringify(s3.srv));
        assert.equal(s3.dialog, null);
        assert.equal(s3.listRows.filter((t) => t.includes("伴手禮")).length, 1);
      });
      // 失敗後修改內容再送：換新 id；之後再以相同內容重試：沿用新 id
      await mount({ rows: [], plan: { upsert_trip_expense: ["network", "network"] } });
      await openAdd();
      await ev("setField", "amount", "88");
      await ev("setField", "title", "伴手禮");
      await save();
      await ev("setField", "title", "伴手禮（改）");
      await save(Z.save); // 修改後錯誤清除、按鈕回到「儲存」
      await save(Z.retry);
      const s4 = await st();
      await check("R6c 失敗後修改內容再送 → 新 client_request_id；之後內容不變再重試 → 沿用該新 id；最後成功只建立 1 筆且為修改後內容", () => {
        const u = upserts(s4);
        assert.equal(u.length, 3, JSON.stringify(u.map((x) => x.p_expense.title)));
        assert.notEqual(u[1].p_expense.client_request_id, u[0].p_expense.client_request_id, "內容不同卻沿用舊 id");
        assert.match(u[1].p_expense.client_request_id, UUID_V4);
        assert.equal(u[2].p_expense.client_request_id, u[1].p_expense.client_request_id, "內容相同卻換新 id");
        assert.equal(u[2].p_expense.title, "伴手禮（改）");
        assert.deepEqual(s4.srv.map((r) => r.title), ["伴手禮（改）"]);
        assert.equal(s4.dialog, null);
      });
      // 只改備註（空白差異 trim 後相同 → 視為相同內容）
      await mount({ rows: [], plan: { upsert_trip_expense: ["network"] } });
      await openAdd();
      await ev("setField", "amount", "88");
      await ev("setField", "title", "伴手禮");
      await save();
      await ev("setField", "title", "伴手禮  ");
      await save(Z.save);
      const s5 = await st();
      await check("R6d 失敗後只改了會被 trim 掉的空白：送出內容相同 → 沿用同一 client_request_id", () => {
        const u = upserts(s5);
        assert.equal(u.length, 2);
        assert.equal(u[1].p_expense.client_request_id, u[0].p_expense.client_request_id);
      });
      // 回應遺失（後端已寫入 A）後改成 B 再送：依裁定換新 id → 後端會多建立一筆（記錄行為供指派者判斷）
      await mount({ rows: [], plan: { upsert_trip_expense: ["apply-then-network"] } });
      await openAdd();
      await ev("setField", "amount", "88");
      await ev("setField", "title", "伴手禮");
      await save();
      await ev("setField", "title", "伴手禮B");
      await save(Z.save);
      const s6 = await st();
      info("回應遺失後修改再送：後端列數＝" + s6.srv.length + " " + JSON.stringify(s6.srv.map((r) => r.title)) + "；toasts＝" + JSON.stringify(s6.toasts.map((t) => t.m)));
      // 第 3 輪裁定：savedReplayed 保險分支與文案已移除；replayed=true 照常視為成功並重新讀取
      await check("R6e0 savedReplayed 分支與文案已移除（ExpenseSheet／四語系 copy 皆無；不再讀取 res.replayed 分流）", () => {
        const sheet = read("src/components/trip/expenses/ExpenseSheet.tsx");
        const copySrc = read("src/lib/i18n/trip-workspace-copy.ts");
        assert.doesNotMatch(sheet, /savedReplayed/, "ExpenseSheet 仍有 savedReplayed");
        assert.doesNotMatch(sheet, /firstSentContent|\.replayed\b/, "ExpenseSheet 仍依 replayed 分流");
        assert.doesNotMatch(copySrc, /savedReplayed/, "copy 仍有 savedReplayed");
        for (const loc of ["zh-TW", "en", "ja", "ko"]) assert.equal(COPY[loc].savedReplayed, undefined, loc);
      });
      // replayed=true 且內容相同（回應遺失後原樣重試）：視為成功
      await check("R6e 回應遺失後原樣重試（replayed=true、內容相同）：視為成功——不顯示錯誤／提示、關閉 Sheet 並重讀；後端只有 1 筆", () => {
        // 取自 R6b 的 s3（同一 crid、後端 replay）
        assert.deepEqual(s3.toasts, [], JSON.stringify(s3.toasts));
        assert.equal(s3.dialog, null);
        assert.equal(s3.srv.length, 1);
        assert.ok(lists(s3).length >= 2, "儲存後未重讀");
      });
    }

    // ═══ R7 送出中停用 ═══
    {
      await mount({ rows: [], plan: { upsert_trip_expense: ["defer"] } });
      await openAdd();
      await ev("setField", "amount", "10");
      await ev("setField", "title", "茶");
      await ev("clickTwice", Z.save, "dialog");
      await sleep(40);
      const s1 = await st();
      const again = await ev("click", Z.saving, "dialog");
      await ev("release", 0);
      await sleep(120);
      const s2 = await st();
      await check("R7 送出中：按鈕停用（儲存中…）、連點只送 1 次；完成後關閉", () => {
        assert.equal(upserts(s1).length, 1, "連點送出次數：" + upserts(s1).length);
        assert.ok(s1.dbuttons.some((b) => b.text === Z.saving && b.disabled), JSON.stringify(s1.dbuttons));
        assert.equal(again, "disabled");
        assert.equal(upserts(s2).length, 1);
        assert.equal(s2.dialog, null);
      });
    }

    // ═══ R8 version 衝突 ═══
    {
      const e1 = row({ title: "晚餐", amount: 90000, payers: [[A, 90000]], shares: [[A, 30000], [B, 30000], [C, 30000]] });
      await mount({ rows: [e1] });
      await ev("clickContains", "晚餐");
      await sleep(60);
      const s0 = await st();
      await ev("setField", "title", "我改的晚餐");
      await ev("serverPatch", e1.id, { title: "別人改的晚餐", version: 2, amount_minor: 60000, payers: [{ user_id: A, amount_minor: 60000 }], shares: [{ user_id: A, share_minor: 30000, percent_bp: null }, { user_id: B, share_minor: 30000, percent_bp: null }] });
      await save();
      await sleep(80);
      const s1 = await st();
      await save();
      const s2 = await st();
      await check("R8 version 衝突：提示並載入最新版本（標題／金額／參與者），下一次送出 p_expected_version＝最新", () => {
        assert.ok(s0.dialog.includes(Z.sheetEditTitle));
        const u = upserts(s2);
        assert.equal(u[0].p_expense.id, e1.id);
        assert.equal(u[0].p_expected_version, 1);
        assert.ok(s1.dialog, "衝突後 Sheet 應保留");
        assert.ok(s1.status.includes(Z.conflictReloaded), JSON.stringify(s1.status));
        assert.ok(s1.inputs.some((i) => i.value === "別人改的晚餐"), "未載入最新標題：" + JSON.stringify(s1.inputs));
        assert.equal(s1.inputs.find((i) => i.inputmode === "decimal").value, "600");
        assert.equal(u.length, 2);
        assert.equal(u[1].p_expected_version, 2);
        assertContractShape(u[1]);
        assert.equal(sqlUpsert(u[1], { members: [A, B, C], create: false }), null);
        assert.equal(s2.dialog, null);
      });
      info("衝突後 client_request_id：" + (upserts(s2)[0]?.p_expense.client_request_id === upserts(s2)[1]?.p_expense.client_request_id ? "沿用" : "換新") + "（修改時後端忽略 client_request_id）");
    }

    // ═══ R8b 衝突判斷只看 message、不依賴 SQLSTATE（staging 已由 40001 改為 P0001）═══
    {
      const cases = [
        { name: "P0001（staging 現況）", plan: { error: "expense_conflict", sqlstate: "P0001" }, conflict: true },
        { name: "40001（舊 ERRCODE）", plan: { error: "expense_conflict", sqlstate: "40001" }, conflict: true },
        { name: "無 code", plan: { raw: { message: "expense_conflict" } }, conflict: true },
        { name: "40001 但 message 非 expense_conflict（例如序列化失敗）", plan: { raw: { message: "could not serialize access due to concurrent update", code: "40001", details: null, hint: null } }, conflict: false },
      ];
      for (const c of cases) {
        const e1 = row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 300], [B, 300], [C, 300]] });
        await mount({ rows: [e1], plan: { upsert_trip_expense: [c.plan] } });
        await ev("clickContains", "晚餐");
        await sleep(60);
        await ev("setField", "title", "改");
        await save();
        await sleep(80);
        const s1 = await st();
        await check(`R8b 修改送出遇到 ${c.name}：${c.conflict ? "視為版本衝突（重讀並顯示「已載入最新版本」）" : "不視為衝突（顯示一般錯誤、保留輸入）"}`, () => {
          assert.ok(s1.dialog, "Sheet 應保留");
          if (c.conflict) {
            assert.ok(s1.status.includes(Z.conflictReloaded), JSON.stringify(s1.status));
            assert.ok(lists(s1).length >= 2, "衝突後未重讀");
          } else {
            assert.ok(!s1.status.includes(Z.conflictReloaded), JSON.stringify(s1.status));
            assert.ok(s1.alerts.includes(Z.errorUnknown), JSON.stringify(s1.alerts));
            assert.ok(s1.inputs.some((i) => i.value === "改"));
          }
        });
      }
      // 刪除衝突（P0001）
      const e2 = row({ title: "早餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
      await mount({ rows: [e2], plan: { delete_trip_expense: [{ error: "expense_conflict", sqlstate: "P0001" }] } });
      await ev("clickContains", "早餐");
      await sleep(60);
      await ev("click", Z.delete, "dialog");
      await sleep(150);
      const sd = await st();
      await check("R8c 刪除遇到 expense_conflict（SQLSTATE P0001）：不刪除、提示已載入最新版本", () => {
        assert.ok(sd.dialog, "Sheet 應保留");
        assert.ok(sd.status.includes(Z.conflictReloaded), JSON.stringify(sd.status));
        assert.equal(sd.srv[0].deleted, false);
      });
      const src = read("src/lib/trip/trip-expenses.ts");
      await check("R8d trip-expenses.ts 錯誤碼判斷不比對 SQLSTATE（無 40001／P0001 字面值）", () => {
        assert.doesNotMatch(src, /["'](40001|P0001)["']/);
      });
    }

    // ═══ R9 修改時已被刪除 ═══
    {
      const e1 = row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 300], [B, 300], [C, 300]] });
      await mount({ rows: [e1] });
      await ev("clickContains", "晚餐");
      await sleep(40);
      await ev("setField", "title", "x");
      await ev("serverPatch", e1.id, { deleted_at: "2026-11-02T00:00:00Z", version: 2 });
      await save();
      await sleep(80);
      const s1 = await st();
      await check("R9 修改時已被刪除：toast「這筆花費已被刪除」、關閉 Sheet、重讀後消失", () => {
        assert.ok(s1.toasts.some((t) => t.kind === "error" && t.m === Z.errorDeleted), JSON.stringify(s1.toasts));
        assert.equal(s1.dialog, null);
        assert.ok(!s1.listRows.some((t) => t.includes("晚餐")));
      });
    }

    // ═══ R10 刪除＋復原 ═══
    {
      const e1 = row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 300], [B, 300], [C, 300]] });
      await mount({ rows: [e1] });
      await ev("clickContains", "晚餐");
      await sleep(40);
      await ev("click", Z.delete, "dialog");
      await sleep(120);
      const s1 = await st();
      const ti = s1.toasts.findIndex((t) => t.action === Z.undo);
      if (ti >= 0) await ev("toastAction", ti);
      await sleep(120);
      const s2 = await st();
      await check("R10a 刪除：delete_trip_expense(p_expense_id, p_expected_version)；6 秒「復原」→ restore_trip_expense(p_expense_id)；列表隱藏後恢復", () => {
        const del = s1.rpc.filter((r) => r[0] === "delete_trip_expense");
        assert.deepEqual(del.map((r) => r[1]), [{ p_expense_id: e1.id, p_expected_version: 1 }]);
        assert.equal(s1.dialog, null);
        assert.ok(!s1.listRows.some((t) => t.includes("晚餐")), "刪除後仍顯示");
        const t = s1.toasts[ti];
        assert.ok(t, JSON.stringify(s1.toasts));
        assert.equal(t.duration, 6000);
        assert.equal(t.m, Z.deleted.replace("{title}", "晚餐"));
        assert.deepEqual(s2.rpc.filter((r) => r[0] === "restore_trip_expense").map((r) => r[1]), [{ p_expense_id: e1.id }]);
        assert.ok(s2.toasts.some((x) => x.kind === "success" && x.m === Z.restored));
        assert.ok(s2.listRows.some((x) => x.includes("晚餐")), "復原後未出現");
      });
      const e2 = row({ title: "午餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
      await mount({ rows: [e2] });
      await ev("clickContains", "午餐");
      await sleep(40);
      await ev("serverPatch", e2.id, { version: 5, title: "午餐（新）" });
      await ev("click", Z.delete, "dialog");
      await sleep(150);
      const s3 = await st();
      await check("R10b 刪除時 version 衝突：不刪除、提示已載入最新版本", () => {
        assert.equal(s3.srv[0].deleted, false);
        assert.ok(s3.status.includes(Z.conflictReloaded), JSON.stringify(s3.status));
        assert.ok(s3.inputs.some((i) => i.value === "午餐（新）"));
      });
    }

    // ═══ R11 結算 ═══
    {
      const e1 = row({ title: "晚餐", amount: 3000, payers: [[A, 3000]], shares: [[A, 1000], [B, 1000], [C, 1000]] });
      const tripId = await mount({ rows: [e1] });
      await ev("click", Z.tabSettle, "page");
      await sleep(40);
      const s0 = await st();
      await ev("clickNth", Z.settleMarkPaid, 0, "page");
      await sleep(150);
      const s1 = await st();
      const u = upserts(s1);
      await check("R11a 結算：說明不換匯、已付／應付／淨額表；「標記已還」建立 settlement（付款人＝還錢的人、分攤＝收錢的人、exact），SQL 不拒絕", () => {
        assert.ok(s0.text.includes(Z.settleIntro));
        for (const k of ["settleMember", "settlePaid", "settleOwed", "settleNet"]) assert.ok(s0.text.includes(Z[k]), k);
        assert.equal(s0.buttons.filter((b) => b.text === Z.settleMarkPaid).length, 2);
        assert.equal(u.length, 1);
        assertContractShape(u[0]);
        const p = u[0].p_expense;
        assert.equal(u[0].p_trip_id, tripId);
        assert.equal(u[0].p_expected_version, null);
        assert.equal(p.kind, "settlement");
        assert.equal(p.split_method, "exact");
        assert.equal(p.amount_minor, 1000);
        assert.deepEqual(p.payers, [{ user_id: B, amount_minor: 1000 }]);
        assert.deepEqual(p.shares, [{ user_id: A, share_minor: 1000, percent_bp: null }]);
        assert.equal(p.title, Z.settlementTitle.replace("{from}", "Ben").replace("{to}", "Amy"));
        assert.match(p.client_request_id, UUID_V4);
        assert.equal(sqlUpsert(u[0], { members: [A, B, C] }), null);
        assert.equal(s1.buttons.filter((b) => b.text === Z.settleMarkPaid).length, 1, "標記後應剩 1 筆建議轉帳");
      });
      const ti = s1.toasts.findIndex((t) => t.action === Z.undo);
      if (ti >= 0) await ev("toastAction", ti);
      await sleep(150);
      const s2 = await st();
      await check("R11b 標記已還的「復原」：6 秒、呼叫 delete_trip_expense(新 settlement id, 其版本)", () => {
        assert.equal(s1.toasts[ti]?.duration, 6000);
        assert.equal(s1.toasts[ti]?.m, Z.settleMarked);
        const sid = s1.srv.find((r) => r.kind === "settlement").id;
        assert.deepEqual(s2.rpc.filter((r) => r[0] === "delete_trip_expense").map((r) => r[1]), [{ p_expense_id: sid, p_expected_version: 1 }]);
        assert.equal(s2.buttons.filter((b) => b.text === Z.settleMarkPaid).length, 2, "復原後應恢復 2 筆建議轉帳");
      });
      await mount({ rows: [e1], plan: { upsert_trip_expense: ["defer"] } });
      await ev("click", Z.tabSettle, "page");
      await ev("clickNthTwice", Z.settleMarkPaid, 0);
      await sleep(40);
      const s3 = await st();
      await ev("release", 0);
      await sleep(120);
      await check("R11c 標記已還連點：只送 1 次、處理中停用", () => {
        assert.equal(upserts(s3).length, 1);
        assert.ok(s3.buttons.some((b) => b.text === Z.settleMarking && b.disabled), JSON.stringify(s3.buttons));
      });
      await mount({ rows: [e1], plan: { upsert_trip_expense: ["network"] } });
      await ev("click", Z.tabSettle, "page");
      await ev("clickNth", Z.settleMarkPaid, 0, "page");
      await sleep(100);
      await ev("clickNth", Z.settleMarkPaid, 0, "page");
      await sleep(150);
      const s4 = await st();
      await check("R11d 標記已還失敗後重試：沿用同一 client_request_id", () => {
        const u4 = upserts(s4);
        assert.equal(u4.length, 2);
        assert.equal(u4[0].p_expense.client_request_id, u4[1].p_expense.client_request_id);
        assert.ok(s4.toasts.some((t) => t.kind === "error" && t.m === Z.errorNetwork));
      });
      // 與已離開成員的轉帳
      const e9 = row({ title: "租車", amount: 2000, payers: [[X, 2000]], shares: [[X, 1000], [A, 1000]] });
      await mount({ rows: [e9] });
      await ev("click", Z.tabSettle, "page");
      await sleep(40);
      const s5 = await st();
      await ev("clickNth", Z.settleMarkPaid, 0, "page");
      await sleep(150);
      const s6 = await st();
      const u6 = upserts(s6);
      const xAmt = await ev("fmt", 1000, "TWD", 2, false);
      await check("R11e 收款方已不在行程中（A→X）：「標記已還」停用＋顯示「此成員已不在行程中，無法標記」、不送出；淨額與建議轉帳照常顯示", () => {
        assert.ok(s5.text.includes(Z.deletedUser), "已不在行程中的成員顯示：" + s5.text);
        const btns = s5.buttons.filter((b) => b.text === Z.settleMarkPaid);
        assert.equal(btns.length, 1, JSON.stringify(btns));
        assert.equal(btns[0].disabled, true, "按鈕未停用");
        assert.equal(Z.settleFormerMember, "此成員已不在行程中，無法標記");
        assert.ok(s5.text.includes(Z.settleFormerMember), s5.text);
        assert.equal(u6.length, 0, "送出了 upsert");
        assert.deepEqual(s6.toasts, []);
        assert.ok(s5.text.includes(Z.settleNet) && s5.text.includes("+" + xAmt), "淨額未顯示：" + s5.text);
        assert.ok(s5.text.includes(Z.settleTransfers + Z.you + Z.deletedUser + xAmt), "建議轉帳未顯示：" + s5.text);
      });
      // 付款方已不在行程中（X→A），四語系
      const e10 = row({ title: "門票", amount: 2000, payers: [[A, 2000]], shares: [[X, 1000], [A, 1000]] });
      for (const loc of ["zh-TW", "en", "ja", "ko"]) {
        await mount({ rows: [e10], locale: loc });
        const L = COPY[loc];
        await ev("click", L.tabSettle, "page");
        await sleep(40);
        const sa = await st();
        const r = await ev("clickNth", L.settleMarkPaid, 0, "page");
        await sleep(80);
        const sb = await st();
        await check(`R11f ${loc} 付款方已不在行程中（X→A）：按鈕停用、顯示「${L.settleFormerMember}」、點擊不送出`, () => {
          assert.equal(L.settleFormerMember, {
            "zh-TW": "此成員已不在行程中，無法標記",
            en: "This member has left the trip, so it can't be marked",
            ja: "このメンバーは退出しているため、記録できません",
            ko: "이 멤버는 여행에서 나가서 표시할 수 없어요",
          }[loc]);
          assert.ok(sa.text.includes(L.settleFormerMember), sa.text);
          assert.ok(sa.text.includes(L.deletedUser), sa.text);
          assert.ok(sa.text.includes(L.settleTransfers), sa.text);
          assert.equal(r, "disabled");
          assert.equal(upserts(sb).length, 0);
        });
      }
      // 一般成員間的轉帳不受影響（同一畫面同時有可標記與不可標記）
      const e11 = row({ title: "混合", amount: 3000, payers: [[A, 3000]], shares: [[A, 1000], [B, 1000], [X, 1000]] });
      await mount({ rows: [e11] });
      await ev("click", Z.tabSettle, "page");
      await sleep(40);
      const sm = await st();
      await check("R11g 同時有成員 B→A 與非成員 X→A：只有 X→A 停用並顯示說明 1 次", () => {
        const btns = sm.buttons.filter((b) => b.text === Z.settleMarkPaid);
        assert.equal(btns.length, 2);
        assert.equal(btns.filter((b) => b.disabled).length, 1, JSON.stringify(btns));
        assert.equal(sm.text.split(Z.settleFormerMember).length - 1, 1);
      });
      // 成員名單讀取失敗：不應把所有人當成「已不在行程中」
      await mount({ rows: [e1], membersError: true });
      await ev("click", Z.tabSettle, "page");
      await sleep(60);
      const se = await st();
      await check("R11h 成員名單讀取失敗：不應把目前成員全部顯示為「已不在行程中的成員」並停用所有「標記已還」", () => {
        info("成員讀取失敗時畫面：" + se.text.slice(0, 300));
        assert.ok(!se.text.includes(Z.settleFormerMember), "成員讀取失敗 → 所有轉帳顯示「" + Z.settleFormerMember + "」");
        assert.ok(!se.text.includes(Z.deletedUser), "成員讀取失敗 → 所有人顯示「" + Z.deletedUser + "」");
      });

      // ── 第 3 輪：成員名單讀取失敗 ──
      const memQ = (s) => s.from.filter((f) => f.t === "trip_members").length;
      const eB = row({ title: "咖啡", amount: 3000, payers: [[B, 3000]], shares: [[A, 1000], [B, 1000], [C, 1000]] });
      // R11i 從未成功（四語系）：錯誤列＋重試、占位名稱、新增花費／標記已還停用且不送出
      for (const loc of ["zh-TW", "en", "ja", "ko"]) {
        const L = COPY[loc];
        await mount({ rows: [eB], membersError: true, locale: loc });
        const sl = await st();
        const addClick = await ev("click", L.add, "page");
        await ev("click", L.tabSettle, "page");
        await sleep(60);
        const ss = await st();
        const markClick = await ev("clickNth", L.settleMarkPaid, 0, "page");
        await sleep(80);
        const sm = await st();
        await check(`R11i ${loc} 成員名單從未成功：顯示「${L.membersLoadFailed}」＋「${L.retry}」；人名為「${L.memberPlaceholder}」；不出現已離開文案；新增花費／標記已還停用、不送出`, () => {
          assert.equal(L.membersLoadFailed, { "zh-TW": "無法載入成員名單", en: "Couldn't load trip members", ja: "メンバーを読み込めませんでした", ko: "멤버 목록을 불러오지 못했어요" }[loc]);
          assert.equal(L.memberPlaceholder, { "zh-TW": "成員", en: "Member", ja: "メンバー", ko: "멤버" }[loc]);
          assert.ok(sl.alerts.some((a) => a.includes(L.membersLoadFailed) && a.includes(L.retry)), JSON.stringify(sl.alerts));
          assert.ok(sl.buttons.some((b) => b.text === L.retry && !b.disabled), "缺少可按的重試");
          assert.ok(sl.text.includes(L.paidBy.replace("{name}", L.memberPlaceholder)), "列表付款人未顯示占位：" + sl.text);
          for (const s of [sl, ss]) {
            assert.ok(!s.text.includes(L.deletedUser), "出現「" + L.deletedUser + "」");
            assert.ok(!s.text.includes(L.settleFormerMember), "出現「" + L.settleFormerMember + "」");
            assert.ok(!/Ben|Cat|Amy/.test(s.text), "名單未載入卻顯示真名");
          }
          assert.equal(sl.addBtn, true, "新增花費未停用");
          assert.equal(addClick, "disabled");
          assert.equal(sm.dialog, null);
          // 建議轉帳 C→B 兩端皆為占位名稱（settleMember 表頭與占位同字，故以相連的兩個占位判斷）
          assert.ok(ss.text.includes(L.memberPlaceholder + L.memberPlaceholder), "建議轉帳未顯示占位：" + ss.text);
          const mb = ss.buttons.filter((b) => b.text === L.settleMarkPaid);
          assert.ok(mb.length >= 1 && mb.every((b) => b.disabled), JSON.stringify(mb));
          assert.equal(markClick, "disabled");
          assert.equal(upserts(sm).length, 0, "送出了 upsert");
          assert.equal(sm.rpc.length, 0, "送出了 rpc：" + JSON.stringify(sm.rpc));
        });
      }
      // R11j 從未成功 → 按重試（成功）→ 恢復正常
      {
        await mount({ rows: [eB], membersError: true });
        const s0 = await st();
        await evaluate("window.__ex.membersError=false");
        const r = await ev("click", Z.retry, "page");
        await sleep(150);
        const s1 = await st();
        await ev("click", Z.tabSettle, "page");
        await sleep(40);
        const s2 = await st();
        await ev("clickNth", Z.settleMarkPaid, 0, "page");
        await sleep(150);
        const s3 = await st();
        await ev("click", Z.tabExpenses, "page");
        await sleep(40);
        const addClick = await ev("click", Z.add, "page");
        await sleep(60);
        const s4 = await st();
        await check("R11j 名單從未成功 → 按重試成功：錯誤列消失、人名正確、新增花費可用（候選成員齊全）、標記已還可送出且標題用真名", () => {
          assert.equal(r, "clicked");
          assert.equal(memQ(s1), memQ(s0) + 1, "重試未重讀成員");
          assert.ok(!s1.alerts.some((a) => a.includes(Z.membersLoadFailed)), JSON.stringify(s1.alerts));
          assert.ok(s1.text.includes(Z.paidBy.replace("{name}", "Ben")), s1.text);
          assert.ok(!s1.text.includes(Z.paidBy.replace("{name}", Z.memberPlaceholder)), s1.text);
          assert.equal(s1.addBtn, false, "新增花費仍停用");
          const mb = s2.buttons.filter((b) => b.text === Z.settleMarkPaid);
          assert.ok(mb.length >= 1 && mb.every((b) => !b.disabled), JSON.stringify(mb));
          const u = upserts(s3);
          assert.equal(u.length, 1);
          assert.ok(/Amy|Cat/.test(u[0].p_expense.title) && u[0].p_expense.title.includes("Ben"), u[0].p_expense.title);
          assert.ok(!u[0].p_expense.title.includes(Z.memberPlaceholder), "標題含占位名稱：" + u[0].p_expense.title);
          assert.equal(sqlUpsert(u[0], { members: [A, B, C] }), null);
          assert.equal(addClick, "clicked");
          const boxes = s4.dbuttons.filter((b) => b.role === "checkbox");
          assert.deepEqual(boxes.map((b) => b.label).sort(), ["Ben", "Cat", Z.you].sort(), JSON.stringify(boxes));
        });
      }
      // R11j2 重試仍失敗：錯誤列保留、仍停用
      {
        await mount({ rows: [eB], membersError: true });
        const s0 = await st();
        await ev("click", Z.retry, "page");
        await sleep(150);
        const s1 = await st();
        await check("R11j2 重試仍失敗：再次顯示錯誤列與重試、新增花費仍停用、人名仍為占位", () => {
          assert.ok(memQ(s1) > memQ(s0), "重試未重讀成員（失敗時 listTripMembers 會 join→raw 各查 1 次）");
          assert.ok(s1.alerts.some((a) => a.includes(Z.membersLoadFailed)), JSON.stringify(s1.alerts));
          assert.equal(s1.addBtn, true);
          assert.ok(s1.text.includes(Z.paidBy.replace("{name}", Z.memberPlaceholder)), s1.text);
        });
      }
      // R11k 讀過後重讀失敗（下拉更新）：沿用舊名單
      {
        await mount({ rows: [eB] });
        await ev("click", Z.tabSettle, "page");
        await sleep(40);
        const s0 = await st();
        await evaluate("window.__ex.membersError=true");
        await ev("touchPull", 200);
        await sleep(200);
        const s1 = await st();
        await ev("clickNth", Z.settleMarkPaid, 0, "page");
        await sleep(150);
        const s2 = await st();
        await ev("click", Z.tabExpenses, "page");
        await sleep(40);
        const s3 = await st();
        await check("R11k 名單讀過後重讀失敗：沿用舊名單（人名不變、無錯誤列）、標記已還可用性不變且送出真名、新增花費仍可用", () => {
          assert.ok(memQ(s1) > memQ(s0), "下拉未重讀成員（失敗路徑未觸發）");
          assert.ok(!s1.alerts.some((a) => a.includes(Z.membersLoadFailed)), JSON.stringify(s1.alerts));
          const before = s0.buttons.filter((b) => b.text === Z.settleMarkPaid).map((b) => b.disabled);
          const after = s1.buttons.filter((b) => b.text === Z.settleMarkPaid).map((b) => b.disabled);
          assert.deepEqual(after, before);
          assert.ok(after.length >= 1 && after.every((d) => d === false), JSON.stringify(after));
          assert.ok(s1.text.includes("Ben") && s1.text.includes("Cat"), s1.text);
          assert.ok(!s1.text.includes(Z.memberPlaceholder + Z.memberPlaceholder) && !s1.text.includes(Z.deletedUser), s1.text);
          assert.ok(s1.text.includes("Cat" ) && s1.text.includes(Z.you + "Ben"), "建議轉帳人名：" + s1.text);
          const u = upserts(s2);
          assert.equal(u.length, 1);
          assert.ok(u[0].p_expense.title.includes("Ben"), u[0].p_expense.title);
          assert.ok(s3.text.includes(Z.paidBy.replace("{name}", "Ben")), s3.text);
          assert.equal(s3.addBtn, false);
        });
      }
      // R11l 評估：名單未載入時點既有花費進入編輯
      {
        await mount({ rows: [eB], membersError: true });
        const opened = await ev("clickContains", "咖啡");
        await sleep(80);
        const s0 = await st();
        const box0 = s0.dbuttons.filter((b) => b.role === "checkbox");
        const payer0 = s0.dbuttons.filter((b) => b.role === "radio" && ![Z.splitEqual, Z.splitExact, Z.splitPercent].includes(b.text));
        // 只改標題送出
        await ev("setField", "title", "咖啡（改）");
        await save();
        const s1 = await st();
        const u1 = upserts(s1);
        await check("R11l 名單未載入時編輯既有花費（只改標題）：Sheet 可開、參與者沿用原本 3 人、付款人不變；payload 參與者不被清空、SQL 不拒絕", () => {
          assert.equal(opened, "clicked");
          assert.ok(s0.dialog && s0.dialog.includes(Z.sheetEditTitle));
          assert.equal(box0.length, 3, JSON.stringify(box0));
          assert.ok(box0.every((b) => b.checked === "true"));
          assert.equal(u1.length, 1);
          assert.deepEqual(u1[0].p_expense.payers, [{ user_id: B, amount_minor: 3000 }]);
          assert.deepEqual(u1[0].p_expense.shares.map((x) => x.user_id).sort(), [A, B, C].sort());
          assert.equal(sqlUpsert(u1[0], { members: [A, B, C], create: false }), null);
        });
        info("名單未載入時編輯：參與者 checkbox 標籤＝" + JSON.stringify(box0.map((b) => b.label)) + "；付款人選項數＝" + payer0.length);
        // 取消勾選一人：該人是否仍可重新勾選
        await mount({ rows: [eB], membersError: true });
        await ev("clickContains", "咖啡");
        await sleep(80);
        const clicked = await evaluate(`(function(){const d=document.querySelector('[role=dialog]');const b=Array.prototype.slice.call(d.querySelectorAll('button[role=checkbox]')).find(function(x){return x.getAttribute('aria-label')!==window.COPY['zh-TW'].you;});if(!b)return 'missing';b.click();return b.getAttribute('aria-label');})()`);
        await sleep(60);
        const s2 = await st();
        const box2 = s2.dbuttons.filter((b) => b.role === "checkbox");
        await save();
        const s3 = await st();
        const u3 = upserts(s3);
        info("名單未載入時取消勾選「" + clicked + "」後：checkbox 數 " + box0.length + " → " + box2.length + "（" + JSON.stringify(box2.map((b) => b.label + ":" + b.checked)) + "）；送出 shares＝" + JSON.stringify(u3[0]?.p_expense.shares.map((x) => x.user_id)));
        // 對照：名單已載入時取消勾選，該成員仍在清單可重新勾選
        await mount({ rows: [eB] });
        await ev("clickContains", "咖啡");
        await sleep(80);
        await ev("click", "Cat", "dialog", "checkbox");
        await sleep(40);
        const s4 = await st();
        await check("R11l2 名單未載入時取消勾選參與者：該人應仍留在清單可重新勾選（與名單已載入時一致），避免看不出是誰且無法復原", () => {
          const ref = s4.dbuttons.filter((b) => b.role === "checkbox");
          assert.equal(ref.length, 3, "對照組（名單已載入）：" + JSON.stringify(ref));
          assert.equal(box2.length, 3, "名單未載入時取消勾選後 checkbox 由 3 變 " + box2.length + "（被取消的人從清單消失，無法重新勾選；所有人都顯示「" + Z.memberPlaceholder + "」，看不出取消了誰）");
        });
      }
    }

    // ═══ R12 回前景節流 ═══
    {
      await mount({ rows: [row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] })] });
      const n = async () => lists(await st()).length;
      const base = await n();
      await ev("visible", "visible");
      await sleep(60);
      const t0 = await n();
      await evaluate("window.__clock=31000");
      await ev("visible", "hidden");
      await sleep(30);
      const tHidden = await n();
      await ev("visible", "visible");
      await sleep(80);
      const t1 = await n();
      await evaluate("window.__clock=45000");
      await ev("visible", "visible");
      await sleep(60);
      const t2 = await n();
      await evaluate("window.__clock=62000");
      await ev("visible", "visible");
      await sleep(80);
      const t3 = await n();
      const s = await st();
      await check("R12 回到前景：進入後 30 秒內不重讀；超過 30 秒重讀 1 次；之後 30 秒內再回前景不重讀；hidden 不觸發；無 channel", () => {
        assert.equal(base, 1);
        assert.deepEqual([t0, tHidden, t1, t2, t3], [1, 1, 2, 2, 3]);
        assert.equal(s.channels, 0);
      });
    }

    // ═══ R13 下拉更新 ═══
    {
      await mount({ rows: [] });
      const s0 = await st();
      await ev("touchPull", 40);
      await sleep(80);
      const s1 = await st();
      await ev("touchPull", 200);
      await sleep(120);
      const s2 = await st();
      const mem = (s) => s.from.filter((f) => f.t === "trip_members").length;
      await check("R13 下拉更新：短拉不觸發；超過門檻重讀記帳與成員", () => {
        assert.equal(lists(s1).length, lists(s0).length);
        assert.equal(lists(s2).length, lists(s0).length + 1);
        assert.ok(mem(s2) > mem(s1), "下拉未重讀成員");
      });
    }

    // ═══ R14 競態 ═══
    {
      await mount({ rows: [row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] })] });
      await evaluate("window.__ex.listPlan=['defer']");
      await ev("touchPull", 200); // 讀取進行中（回應為當下快照）
      await sleep(40);
      await openAdd();
      await ev("setField", "amount", "50");
      await ev("setField", "title", "宵夜");
      await save();
      await ev("releaseList", 0);
      await sleep(150);
      const s1 = await st();
      await check("R14a 讀取進行中時新增：所有請求完成後列表應包含新花費（reload 不應沿用儲存前發出的讀取）", () => {
        assert.ok(s1.srv.some((r) => r.title === "宵夜"), "後端未寫入");
        assert.ok(s1.listRows.some((t) => t.includes("宵夜")), "畫面停在舊資料，新花費未顯示；trip_expenses 讀取次數＝" + lists(s1).length);
      });
      const e1 = row({ title: "早午餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
      await mount({ rows: [e1] });
      await evaluate("window.__ex.listPlan=['defer']");
      await ev("touchPull", 200);
      await sleep(40);
      await ev("clickContains", "早午餐");
      await sleep(40);
      await ev("click", Z.delete, "dialog");
      await sleep(80);
      await ev("releaseList", 0);
      await sleep(150);
      const s2 = await st();
      await check("R14b 讀取進行中時刪除：所有請求完成後已刪除的花費不應重新出現", () => {
        assert.ok(s2.srv[0].deleted, "後端未刪除");
        assert.ok(!s2.listRows.some((t) => t.includes("早午餐")), "已刪除的花費又出現在列表（舊讀取覆蓋並清除 hiddenIds）");
      });

      const has = (s, t) => s.listRows.some((x) => x.includes(t));
      // R14c 修改：舊讀取（修改前發出）晚回來不得覆蓋
      {
        const e = row({ title: "早餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
        await mount({ rows: [e] });
        const n0 = lists(await st()).length;
        await evaluate("window.__ex.listPlan=['defer']");
        await ev("touchPull", 200);
        await sleep(40);
        await ev("clickContains", "早餐");
        await sleep(40);
        await ev("setField", "title", "早餐（改）");
        await save();
        const sA = await st();
        await ev("releaseList", 0);
        await sleep(120);
        const sB = await st();
        await check("R14c 讀取進行中時修改：寫入後發出新讀取（不沿用進行中讀取）；修改前的讀取晚回來不覆蓋新結果", () => {
          assert.equal(lists(sA).length, n0 + 2, "寫入後未發出新的讀取：" + lists(sA).length);
          assert.ok(has(sA, "早餐（改）"), "新讀取回來後未顯示修改：" + JSON.stringify(sA.listRows));
          assert.ok(has(sB, "早餐（改）") && !sB.listRows.some((x) => x.includes("早餐") && !x.includes("早餐（改）")), "舊讀取覆蓋了新結果：" + JSON.stringify(sB.listRows));
        });
      }
      // R14d 刪除→復原，三個讀取依各種順序回來
      for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
        const e = row({ title: "午茶", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
        await mount({ rows: [e] });
        await evaluate("window.__ex.listPlan=['defer','defer','defer']");
        await ev("touchPull", 200); // 讀取 0：刪除前發出
        await sleep(40);
        await ev("clickContains", "午茶");
        await sleep(40);
        await ev("click", Z.delete, "dialog"); // 刪除 → 讀取 1（刪除後發出，快照不含此筆）
        await sleep(80);
        const sDel = await st();
        const ti = sDel.toasts.findIndex((t) => t.action === Z.undo);
        await ev("toastAction", ti); // 復原 → 讀取 2（快照含此筆）
        await sleep(80);
        const sUndo = await st();
        const seen = [];
        for (const i of order) {
          await ev("releaseList", i);
          await sleep(60);
          seen.push(has(await st(), "午茶"));
        }
        const final = await st();
        // 期望：只要「刪除之後發出的讀取」(1 或 2) 尚未回來，此筆維持隱藏；最後以最新的讀取 2 為準 → 顯示
        const expectSeen = [];
        let back1 = false, back2 = false;
        for (const i of order) {
          if (i === 1) back1 = true;
          if (i === 2) back2 = true;
          // 讀取 2 已回來 → 快照含此筆（最新）；只有讀取 1 回來 → 快照不含；都沒回來 → 隱藏
          expectSeen.push(back2 ? true : false);
        }
        await check(`R14d 刪除→復原，讀取回來順序 ${order.join("→")}：刪除後隱藏直到刪除後發出的讀取回來；舊讀取不覆蓋；最終顯示`, () => {
          assert.equal(lists(sDel).length, 3, "刪除後未發出新讀取：" + lists(sDel).length);
          assert.equal(lists(sUndo).length, 4, "復原後未發出新讀取：" + lists(sUndo).length);
          assert.ok(!has(sDel, "午茶") && !has(sUndo, "午茶"), "讀取回來前即顯示");
          assert.deepEqual(seen, expectSeen, "各步驟是否顯示：" + JSON.stringify(seen));
          assert.ok(has(final, "午茶"), "最終未顯示");
          assert.equal(final.srv[0].deleted, false);
        });
      }
      // R14e 標記已還：讀取進行中時標記，舊讀取晚回來不覆蓋；之後「復原」也發出新讀取
      {
        const e = row({ title: "晚餐", amount: 3000, payers: [[A, 3000]], shares: [[A, 1000], [B, 1000], [C, 1000]] });
        await mount({ rows: [e] });
        await ev("click", Z.tabSettle, "page");
        await sleep(40);
        await evaluate("window.__ex.listPlan=['defer']");
        await ev("touchPull", 200);
        await sleep(40);
        const n0 = lists(await st()).length;
        await ev("clickNth", Z.settleMarkPaid, 0, "page");
        await sleep(120);
        const sA = await st();
        await ev("releaseList", 0);
        await sleep(100);
        const sB = await st();
        const ti = sB.toasts.findIndex((t) => t.action === Z.undo);
        await evaluate("window.__ex.listPlan=['defer']");
        await ev("touchPull", 200); // 復原前發出（快照仍有 settlement）
        await sleep(40);
        await ev("toastAction", ti);
        await sleep(120);
        const sC = await st();
        await ev("releaseList", 1);
        await sleep(100);
        const sD = await st();
        const mk = (s) => s.buttons.filter((b) => b.text === Z.settleMarkPaid).length;
        await check("R14e 標記已還與其復原：寫入後各發出新讀取；較早的讀取晚回來不覆蓋（建議轉帳數 1 → 復原後 2）", () => {
          assert.equal(lists(sA).length, n0 + 1, "標記後未發出新讀取");
          assert.equal(mk(sA), 1);
          assert.equal(mk(sB), 1, "舊讀取覆蓋：標記已還被還原");
          assert.equal(sC.rpc.filter((r) => r[0] === "delete_trip_expense").length, 1);
          assert.equal(lists(sC).length, lists(sB).length + 2, "復原後未發出新讀取（只沿用進行中讀取）");
          assert.equal(mk(sC), 2, "復原後新讀取結果未顯示");
          assert.equal(mk(sD), 2, "復原前的讀取晚回來覆蓋了復原後結果");
        });
      }
      // R14f 衝突：讀取進行中時儲存遇到 version 衝突 → 不等待進行中讀取，立即以新讀取載入最新版本
      {
        const e = row({ title: "宵夜", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
        await mount({ rows: [e] });
        await ev("clickContains", "宵夜");
        await sleep(40);
        await evaluate("window.__ex.listPlan=['defer']");
        await ev("touchPull", 200); // Sheet 開著時下拉不觸發 → 改以回前景觸發
        await evaluate("window.__clock=31000");
        await ev("visible", "visible");
        await sleep(40);
        const n0 = lists(await st()).length;
        await ev("serverPatch", e.id, { title: "宵夜（別人改）", version: 2 });
        await ev("setField", "title", "宵夜（我改）");
        await save();
        await sleep(80);
        const sA = await st();
        await ev("releaseList", 0);
        await sleep(100);
        const sB = await st();
        await check("R14f 讀取進行中遇到版本衝突：立即發出新讀取並載入最新版本；舊讀取晚回來不改動表單／列表", () => {
          assert.equal(lists(sA).length, n0 + 1, "衝突後未發出新讀取：" + lists(sA).length);
          assert.ok(sA.status.includes(Z.conflictReloaded), JSON.stringify(sA.status));
          assert.ok(sA.inputs.some((i) => i.value === "宵夜（別人改）"), JSON.stringify(sA.inputs));
          assert.ok(has(sB, "宵夜（別人改）"), JSON.stringify(sB.listRows));
        });
      }
      // R14g 較早發出的讀取晚回來失敗：不顯示錯誤（已有更新的成功結果）
      {
        await mount({ rows: [] });
        await evaluate("window.__ex.listPlan=['defer']");
        await ev("touchPull", 200);
        await sleep(40);
        await openAdd();
        await ev("setField", "amount", "50");
        await ev("setField", "title", "飲料");
        await save();
        await ev("rejectList", 0);
        await sleep(100);
        const s = await st();
        await check("R14g 寫入前發出的讀取晚回來失敗：不顯示讀取錯誤、不影響新結果", () => {
          assert.ok(has(s, "飲料"));
          assert.deepEqual(s.alerts, [], JSON.stringify(s.alerts));
        });
      }
      // R14h 新增失敗（未寫入）也不會讓隱藏殘留；刪除後的讀取失敗時保持隱藏，下一次成功讀取才解除
      {
        const e = row({ title: "點心", amount: 900, payers: [[A, 900]], shares: [[A, 900]] });
        await mount({ rows: [e], listPlan: [] });
        await ev("clickContains", "點心");
        await sleep(40);
        await evaluate("window.__ex.listPlan=['error']");
        await ev("click", Z.delete, "dialog");
        await sleep(100);
        const sA = await st();
        await ev("serverPatch", e.id, { deleted_at: null, version: 3 }); // 其他人已復原
        await ev("touchPull", 200);
        await sleep(100);
        const sB = await st();
        await check("R14h 刪除後的讀取失敗：維持隱藏；下一次（刪除後發出的）成功讀取回來才解除並反映伺服器狀態", () => {
          assert.ok(!has(sA, "點心"), "讀取失敗後已刪除的花費重新出現");
          assert.ok(has(sB, "點心"), "下一次成功讀取後未解除隱藏");
        });
      }
    }

    // ═══ R15 總覽卡 ═══
    {
      const rows = [
        row({ title: "晚餐", amount: 90000, created: "2026-10-01T00:00:00Z", payers: [[A, 90000]], shares: [[A, 90000]] }),
        row({ title: "拉麵", amount: 3000, currency: "JPY", exp: 0, created: "2026-10-02T00:00:00Z", payers: [[A, 3000]], shares: [[A, 3000]] }),
        row({ title: "計程車", amount: 50000, created: "2026-10-03T00:00:00Z", payers: [[A, 50000]], shares: [[A, 50000]] }),
        row({ title: "還錢", kind: "settlement", method: "exact", amount: 100, currency: "USD", created: "2026-10-04T00:00:00Z", payers: [[B, 100]], shares: [[A, 100]] }),
      ];
      const tripId = await mount({ what: "card", rows });
      const s0 = await st();
      const first = await ev("fmt", 140000, "TWD", 2, true);
      await evaluate(`(function(){const b=document.querySelector('#root button');b.click();return true;})()`);
      await sleep(30);
      const s1 = await st();
      await check("R15a 總覽卡：第一個幣別總額（最近使用、不含還款幣別）＋「另 N 種幣別 · M 筆」（M 不含還款）；點擊留下標記並進入記帳頁", () => {
        assert.ok(s0.text.includes(first), first + "：" + s0.text);
        assert.ok(s0.text.includes(Z.overviewMore.replace("{n}", "1").replace("{m}", "3")), s0.text);
        assert.equal(s1.mark, tripId);
        assert.deepEqual(s1.nav, [{ to: "/saved/$tripId/expenses", params: { tripId } }]);
      });
      info("總覽卡 StrictMode 掛載 trip_expenses 查詢次數：" + lists(s0).length);
      await mount({ what: "card", rows: [rows[0]] });
      const s2 = await st();
      await mount({ what: "card", rows: [rows[3]] });
      const s3 = await st();
      await mount({ what: "card", rows: [] });
      const s4 = await st();
      await check("R15b 單一幣別顯示筆數；只有還款／沒有花費顯示空狀態", () => {
        assert.ok(s2.text.includes(Z.overviewCountOne.replace("{count}", "1")) || s2.text.includes(Z.overviewCount.replace("{count}", "1")), s2.text);
        assert.ok(s3.text.includes(Z.overviewEmpty), s3.text);
        assert.ok(s4.text.includes(Z.overviewEmpty), s4.text);
      });
      await mount({ what: "card", rows: [], listPlan: ["error", "error"] });
      await sleep(200);
      const s5 = await st();
      await check("R15c 總覽卡讀取失敗：不應永遠停在「載入中」", () => {
        assert.ok(!s5.text.includes(Z.overviewLoading), "讀取失敗後仍顯示「" + Z.overviewLoading + "」：" + s5.text);
      });
      // R15d 失敗文案、仍可點進、不自動重試
      {
        const t = await mount({ what: "card", rows: [], listPlan: ["error", "error", "error"] });
        await sleep(300);
        const sA = await st();
        await evaluate(`(function(){const b=document.querySelector('#root button');b.click();return true;})()`);
        await sleep(30);
        const sB = await st();
        await check("R15d 總覽卡讀取失敗：顯示「無法載入記帳」、StrictMode 下只讀 1 次且不自動重試、仍可點進記帳頁（留下標記）", () => {
          assert.equal(Z.overviewLoadFailed, "無法載入記帳");
          assert.ok(sA.text.includes(Z.overviewLoadFailed), sA.text);
          assert.equal(lists(sA).length, 1, "失敗後自動重試或 StrictMode 重複讀取：" + lists(sA).length);
          assert.deepEqual(sB.nav, [{ to: "/saved/$tripId/expenses", params: { tripId: t } }]);
          assert.equal(sB.mark, t);
        });
        const ssB = await evaluate("window.ss()");
        await check("R15d2 點總覽卡留下的「從總覽進入」標記帶 tripId 與時間戳", () => {
          assert.equal(ssB["roamie:trip-expenses-return"], t);
          const at = Number(ssB["roamie:trip-expenses-return-at"]);
          assert.ok(Number.isFinite(at) && Math.abs(at - Date.now()) < 60_000, "時間戳：" + ssB["roamie:trip-expenses-return-at"]);
        });
        for (const loc of ["en", "ja", "ko"]) {
          await mount({ what: "card", rows: [], locale: loc, listPlan: ["error"] });
          await sleep(150);
          const sl = await st();
          await check(`R15d3 ${loc} 總覽卡失敗文案「${COPY[loc].overviewLoadFailed}」`, () => {
            assert.ok(sl.text.includes(COPY[loc].overviewLoadFailed), sl.text);
          });
        }
      }
      // R15e 節流：記帳頁 30 秒內讀過 → 總覽卡不重讀；超過 30 秒 → 重讀 1 次
      {
        const r0 = [row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] })];
        const t = await mount({ rows: r0 });
        await mount({ what: "card", tripId: t, rows: r0, clock: 27000 });
        const sA = await st();
        await mount({ what: "card", tripId: t, rows: r0, clock: 31000 });
        const sB = await st();
        await mount({ what: "card", tripId: t, rows: r0, clock: 31000 + 10000 });
        const sC = await st();
        await check("R15e 同一行程 30 秒內已成功讀取（含記帳頁）總覽卡不重讀、直接顯示快取；超過 30 秒重讀 1 次；之後 30 秒內再掛載不重讀", () => {
          assert.equal(lists(sA).length, 0, "約 27 秒時重讀：" + lists(sA).length);
          assert.ok(sA.text.includes(Z.overviewCountOne.replace("{count}", "1")) || sA.text.includes(Z.overviewCount.replace("{count}", "1")), sA.text);
          assert.equal(lists(sB).length, 1, "31 秒時讀取次數：" + lists(sB).length);
          assert.equal(lists(sC).length, 0, "上次讀取 10 秒後重讀：" + lists(sC).length);
        });
      }
      // R15f 進行中讀取共用：同時掛載兩張卡（StrictMode）只讀 1 次；回來後兩張都顯示
      {
        await mount({ what: "card2", rows: [row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] })], listPlan: ["defer"] });
        await sleep(60);
        const sA = await st();
        await ev("releaseList", 0);
        await sleep(100);
        const sB = await st();
        await check("R15f 兩張總覽卡同時掛載（StrictMode）：進行中讀取共用只查 1 次；回來後兩張都顯示結果", () => {
          assert.equal(lists(sA).length, 1, "讀取次數：" + lists(sA).length);
          assert.equal(sA.text.split(Z.overviewLoading).length - 1, 2);
          assert.equal(lists(sB).length, 1);
          assert.equal(sB.text.split(Z.overviewLoading).length - 1, 0, sB.text);
        });
      }
      // R15g 失敗也計入 30 秒節流：重新掛載（例如切換分頁回來）不自動重讀；點卡片進記帳頁照常讀取
      {
        const t = await mount({ what: "card", rows: [], listPlan: ["error"] });
        await sleep(100);
        const s0 = await st();
        await mount({ what: "card", tripId: t, rows: [], clock: 1000 });
        await sleep(100);
        const s1 = await st();
        await mount({ what: "card", tripId: t, rows: [], clock: 29000 });
        await sleep(100);
        const s2 = await st();
        await check("R15g 總覽卡讀取失敗計入 30 秒節流：1 秒／29 秒後重新掛載不重讀，且直接顯示「無法載入記帳」（不閃「載入中」）", () => {
          assert.equal(lists(s0).length, 1);
          assert.ok(s0.text.includes(Z.overviewLoadFailed), s0.text);
          assert.equal(lists(s1).length, 0, "失敗 1 秒後重新掛載重讀：" + lists(s1).length);
          assert.equal(lists(s2).length, 0, "失敗 29 秒後重新掛載重讀：" + lists(s2).length);
          assert.ok(s1.text.includes(Z.overviewLoadFailed) && !s1.text.includes(Z.overviewLoading), s1.text);
        });
        // 同一行程失敗後 2 秒點進記帳頁：照常讀取並顯示
        const rE = [row({ title: "晚餐", amount: 900, payers: [[A, 900]], shares: [[A, 900]] })];
        await mount({ tripId: t, rows: rE, clock: 2000 });
        const s3 = await st();
        await mount({ what: "card", tripId: t, rows: rE, clock: 5000 });
        await sleep(100);
        const s4 = await st();
        await check("R15g2 總覽卡失敗後進記帳頁：記帳頁照常讀取 1 次並顯示；回總覽（30 秒內）卡片顯示記帳頁的結果、不重讀、不顯示失敗", () => {
          assert.equal(lists(s3).length, 1, "記帳頁讀取次數：" + lists(s3).length);
          assert.ok(s3.listRows.some((x) => x.includes("晚餐")), JSON.stringify(s3.listRows));
          assert.equal(lists(s4).length, 0);
          assert.ok(!s4.text.includes(Z.overviewLoadFailed), s4.text);
          assert.ok(s4.text.includes(Z.overviewCountOne.replace("{count}", "1")) || s4.text.includes(Z.overviewCount.replace("{count}", "1")), s4.text);
        });
        // 另一行程：失敗 31 秒後重新掛載 → 重讀 1 次（成功）；之後 30 秒內不重讀
        const t2 = await mount({ what: "card", rows: [], listPlan: ["error"] });
        await sleep(100);
        await mount({ what: "card", tripId: t2, rows: rE, clock: 31000 });
        await sleep(100);
        const s5 = await st();
        await mount({ what: "card", tripId: t2, rows: rE, clock: 40000 });
        await sleep(100);
        const s6 = await st();
        await check("R15g3 失敗超過 30 秒後重新掛載：重讀 1 次並顯示結果（清除失敗狀態）；之後 30 秒內不重讀", () => {
          assert.equal(lists(s5).length, 1, "31 秒後讀取次數：" + lists(s5).length);
          assert.ok(!s5.text.includes(Z.overviewLoadFailed), s5.text);
          assert.ok(s5.text.includes(Z.overviewCountOne.replace("{count}", "1")) || s5.text.includes(Z.overviewCount.replace("{count}", "1")), s5.text);
          assert.equal(lists(s6).length, 0);
        });
      }
    }

    // ═══ R16 返回 ═══
    {
      await mount({ rows: [], mark: true, canGoBack: true });
      await ev("click", Z.back, "page");
      const s1 = await st();
      const tripId = await mount({ rows: [] });
      await ev("click", Z.back, "page");
      const s2 = await st();
      const t3 = await mount({ rows: [], mark: true, canGoBack: false });
      await ev("click", Z.back, "page");
      const s3 = await st();
      await check("R16 返回：有總覽標記→history.back；沒有標記或無上一頁→replace 導到 ?view=overview", () => {
        assert.equal(s1.backs, 1);
        assert.deepEqual(s1.nav, []);
        assert.equal(s2.backs, 0);
        assert.deepEqual(s2.nav, [{ to: "/saved/$tripId", params: { tripId }, search: { view: "overview" }, replace: true }]);
        assert.deepEqual(s3.nav, [{ to: "/saved/$tripId", params: { tripId: t3 }, search: { view: "overview" }, replace: true }]);
      });
      const replaceTo = (t) => [{ to: "/saved/$tripId", params: { tripId: t }, search: { view: "overview" }, replace: true }];
      const cases = [
        { name: "新格式、同 tripId、5 秒內、可回上一頁 → history.back", o: { mark: true, markAge: 5000, canGoBack: true }, back: true },
        { name: "新格式、同 tripId、29 秒、可回上一頁 → history.back", o: { mark: true, markAge: 29000, canGoBack: true }, back: true },
        { name: "標記過期（31 秒）→ replace", o: { mark: true, markAge: 31000, canGoBack: true }, back: false },
        { name: "標記過期（10 分鐘）→ replace", o: { mark: true, markAge: 600000, canGoBack: true }, back: false },
        { name: "標記時間在未來（時鐘倒退）→ replace", o: { mark: true, markAge: -60000, canGoBack: true }, back: false },
        { name: "標記時間戳損毀 → replace", o: { mark: true, markAge: "nan", canGoBack: true }, back: false },
        { name: "不同 tripId 的新鮮標記 → replace", o: { mark: "7e000000-0000-4000-8000-0000000000ff", markAge: 1000, canGoBack: true }, back: false },
        { name: "不同 tripId 的舊格式標記 → replace", o: { mark: "7e000000-0000-4000-8000-0000000000ff", canGoBack: true }, back: false },
        { name: "新鮮標記但無上一頁 → replace", o: { mark: true, markAge: 1000, canGoBack: false }, back: false },
        { name: "從其他入口進入（無標記）、可回上一頁 → replace", o: { canGoBack: true }, back: false },
        { name: "舊格式（無時間戳）同 tripId、可回上一頁 → history.back（相容）", o: { mark: true, canGoBack: true }, back: true },
      ];
      for (const c of cases) {
        const t = await mount({ rows: [], ...c.o });
        const ss0 = await evaluate("window.ss()");
        await ev("click", Z.back, "page");
        const s = await st();
        await check("R16b 返回：" + c.name, () => {
          assert.equal(ss0["roamie:trip-expenses-return"], undefined, "掛載後未消費「從總覽進入」標記");
          assert.equal(ss0["roamie:trip-expenses-return-at"], undefined, "掛載後未消費時間戳");
          if (c.back) {
            assert.equal(s.backs, 1);
            assert.deepEqual(s.nav, []);
          } else {
            assert.equal(s.backs, 0, "不應 history.back");
            assert.deepEqual(s.nav, replaceTo(t));
          }
        });
      }
      // 標記被消費：同一頁掛載後再重新掛載（例如重新整理）不再視為從總覽進入
      {
        const t = await mount({ rows: [], mark: true, markAge: 1000, canGoBack: true });
        await ev("unmountAll");
        const ssA = await evaluate("window.ss()");
        const back = ssA["roamie:trip-expenses-back"] ? JSON.parse(ssA["roamie:trip-expenses-back"]) : null;
        await check("R16c 從總覽進入的記帳頁離開時寫「返回總覽」標記（tripId＋時間戳）；「從總覽進入」標記已消費", () => {
          assert.ok(back, "未寫入返回總覽標記：" + JSON.stringify(ssA));
          assert.equal(back.tripId, t);
          assert.ok(Math.abs(back.at - Date.now()) < 60_000, "時間戳：" + back.at);
          assert.equal(ssA["roamie:trip-expenses-return"], undefined);
        });
        const t2 = await mount({ rows: [], canGoBack: true });
        await ev("unmountAll");
        const ssB = await evaluate("window.ss()");
        await check("R16d 非從總覽進入的記帳頁離開時不寫「返回總覽」標記", () => {
          assert.equal(ssB["roamie:trip-expenses-back"], undefined, JSON.stringify(ssB) + " " + t2);
        });
      }
    }

    // ═══ R17 路由 ═══
    {
      await ev("mount", { me: A, members: MEMBERS, what: "route", tripId: "not-a-uuid" });
      await sleep(80);
      const s1 = await st();
      await mount({ what: "route" });
      const s2 = await st();
      await check("R17 路由：無效 tripId 導回 /saved?tab=trips（replace）、不查詢；有效 tripId 顯示記帳頁", () => {
        assert.ok(s1.nav.length >= 1, "未導回");
        for (const n of s1.nav) assert.deepEqual(n, { to: "/saved", search: { tab: "trips" }, replace: true });
        info("無效 tripId 導覽次數（StrictMode dev 雙重 effect）：" + s1.nav.length);
        assert.equal(lists(s1).length, 0);
        assert.ok(s2.text.includes(Z.title) && s2.text.includes(Z.tabSettle));
      });
    }

    // ═══ R18 四語系 ═══
    {
      const codes = await evaluate("window.ERROR_CODES");
      const msgs = {};
      for (const loc of ["zh-TW", "en", "ja", "ko"]) {
        msgs[loc] = {};
        for (const c of [...codes, "network"]) msgs[loc][c] = await ev("errMsg", c, loc);
      }
      await mount({ rows: [row({ title: "Dinner", amount: 900, payers: [[X, 900]], shares: [[X, 900]] })], locale: "en" });
      const s = await st();
      await check("R18 四語系 key 齊全且非空；分攤方式／「已不在行程中的成員」有翻譯；每個伺服器錯誤碼都有專屬文案（非 unknown）；en 畫面", () => {
        const keys = Object.keys(COPY["zh-TW"]).sort();
        for (const loc of ["en", "ja", "ko"]) assert.deepEqual(Object.keys(COPY[loc]).sort(), keys, loc);
        for (const loc of Object.keys(COPY)) for (const k of keys) assert.ok(String(COPY[loc][k]).trim(), `${loc}.${k} 空白`);
        for (const k of ["splitEqual", "splitExact", "splitPercent", "deletedUser"]) {
          assert.equal(new Set(["zh-TW", "en", "ja", "ko"].map((l) => COPY[l][k])).size, 4, k + " 四語系相同");
        }
        for (const loc of Object.keys(msgs)) {
          const unknown = COPY[loc].errorUnknown;
          for (const c of codes) assert.notEqual(msgs[loc][c], unknown, `${loc} ${c} 落到 errorUnknown`);
        }
        assert.ok(s.text.includes(COPY.en.tabExpenses) && s.text.includes(COPY.en.deletedUser), s.text);
      });
    }

    // ═══ R21 標題列吸頂蓋住狀態列（#TS-UX3）═══
    {
      const rows = Array.from({ length: 24 }, (_, i) =>
        row({ title: "項目" + i, amount: 1000 + i, date: `2026-11-${String(1 + (i % 20)).padStart(2, "0")}`, payers: [[A, 1000 + i]], shares: [[A, 1000 + i]] }),
      );
      await mount({ rows });
      const cssInfo = headerGeoCss();
      const res = await evaluate(`(${HEADER_GEO_FN})(${JSON.stringify(cssInfo.css)},${JSON.stringify(HEADER_OLD_CLASS)},${JSON.stringify(HEADER_CASES)})`);
      await headerGeoChecks("R21", "共同記帳", res, cssInfo);
      await ev("unmountAll");
    }

    // ═══ R20 TripDetailScreen 捲動還原 ═══
    {
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/detail.html` });
      for (let i = 0; i < 100 && !(await evaluate("!!window.__dready").catch(() => false)); i++) await sleep(100);
      const TRIP = "7e000000-0000-4000-8000-0000000000aa";
      const dmount = async (o) => {
        await ev("dmount", { tripId: TRIP, ...o });
        for (let i = 0; i < 60 && !(await evaluate("window.dstate().editor")); i++) await sleep(25);
        await sleep(150);
        return evaluate("window.dstate()");
      };
      const withMark = await dmount({ view: "overview", tops: { overview: 700, trip: 50 }, mark: TRIP });
      const noMark = await dmount({ view: "overview", tops: { overview: 700, trip: 50 } });
      const otherMark = await dmount({ view: "overview", tops: { overview: 700 }, mark: "7e000000-0000-4000-8000-0000000000bb" });
      const tripView = await dmount({ view: undefined, tops: { overview: 700, trip: 50 }, mark: TRIP });
      await check("R20a 從記帳頁返回（有標記、總覽分頁）：還原總覽捲動並清除標記；沒有標記／他行程標記：行為不變（不捲動、不清他人標記）；行程分頁：清除標記不捲動", () => {
        assert.ok(withMark.editor && withMark.text.includes(Z.title), "總覽卡未顯示");
        assert.equal(withMark.scrollTop, 700);
        assert.equal(withMark.mark, null, "標記未清除");
        assert.equal(noMark.scrollTop, 0);
        assert.equal(otherMark.scrollTop, 0);
        assert.equal(otherMark.mark, "7e000000-0000-4000-8000-0000000000bb");
        assert.equal(tripView.scrollTop, 0);
        assert.equal(tripView.mark, null);
      });
      // 完整往返：總覽捲到 640 → 點卡（標記＋導覽）→ 卸載（寫入捲動）→ 以總覽重新掛載 → 還原 640
      await dmount({ view: "overview" });
      await ev("dscroll", 640);
      await sleep(30);
      const clicked = await ev("dclickCard");
      const afterClick = await evaluate("window.dstate()");
      await ev("dunmount");
      const back = await dmount({ view: "overview", keepStorage: true });
      await check("R20b 往返：總覽捲動 640 → 點「共同記帳」卡 → 返回後還原 640", () => {
        assert.equal(clicked, "clicked");
        assert.deepEqual(afterClick.nav.at(-1), { to: "/saved/$tripId/expenses", params: { tripId: TRIP } });
        assert.equal(afterClick.mark, TRIP);
        assert.equal(back.scrollTop, 640);
        assert.equal(back.mark, null);
      });
      const backFresh = await dmount({ view: "overview", tops: { overview: 700 }, back: { tripId: TRIP, age: 2000 } });
      const backFreshSS = await evaluate("sessionStorage.getItem('roamie:trip-expenses-back')");
      const backOld = await dmount({ view: "overview", tops: { overview: 700 }, back: { tripId: TRIP, age: 31000 } });
      const backOther = await dmount({ view: "overview", tops: { overview: 700 }, back: { tripId: "7e000000-0000-4000-8000-0000000000bb", age: 1000 } });
      await check("R20c 「返回總覽」標記（新格式）：同行程 30 秒內 → 還原總覽捲動並清除；過期（31 秒）或他行程 → 不捲動", () => {
        assert.equal(backFresh.scrollTop, 700);
        assert.equal(backFreshSS, null, "返回總覽標記未清除");
        assert.equal(backOld.scrollTop, 0, "過期標記仍還原捲動");
        assert.equal(backOther.scrollTop, 0, "他行程標記仍還原捲動");
      });
    }

    await check("R19 無外部請求、無瀏覽器例外／console.error", () => {
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(browserErrors, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
  }
}

try {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {}
console.log(`\n總結：${passCount} PASS / ${failures.length} FAIL`);
if (failures.length) console.log("FAIL 清單：\n  " + failures.join("\n  "));
console.log(failures.length ? "verify-trip-expenses-ui-stage4: FAIL" : "verify-trip-expenses-ui-stage4: PASS");
process.exit(failures.length ? 1 : 0);
