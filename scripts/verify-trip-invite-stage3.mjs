// verify-trip-invite-stage3.mjs — Trip Workspace V1 第 3 階段：邀請強化與邀請成員面板（任務單 #TW3-T）
//
// Part N（Node；esbuild 打包「真實」模組，外部邊界 mock 並計數）：
//   N1 buildTripInviteUrl：https://roamie.tw/trip-invite/{token}；trip-collab 不再用 Math.random／直接 INSERT trip_invites
//   N2 分享網址組裝：LINE（https://line.me/R/share?text=）、sms（iOS `sms:&body=`／其他 `sms:?body=`）、mailto
//      （subject＋body）；標題含中文、&、#、換行、%、+、? 時解碼後逐字還原，且編碼後不含原始 &／#／換行／空白
//   N3 deep link：https（含 www、尾斜線、query、hash、大寫網域）與 roamie:// 可解析；拒絕其他網域、http、
//      其他路徑、多段路徑、空 token
//   N4 四語系 key 齊全且一致、非空；zh-TW 指定文案；ja「リンクをコピー」；{title}／{count} 佔位符
//   N5 AASA：以 module 層級呼叫 Route.options.server.handlers.GET（不啟 server）：200、Content-Type
//      application/json、appID K88UK4PZ43.com.shuode.roamie、只涵蓋 /trip-invite/*；entitlements 有 applinks:roamie.tw
//   N6 public-routes 允許／拒絕表格（含尾斜線、多段、大小寫、編碼、前綴相似路徑）
//   N7 「更多」分享：iOS 未安裝 @capacitor/share（PluginHeaders 無 Share）→ 不 crash、退回複製恰 1 次；
//      已安裝 → 呼叫原生 Share 恰 1 次、不複製；取消 → cancelled、不複製；Web share／canShare=false／無 share
//   N8 create_trip_invite／preview RPC 呼叫與錯誤碼對應；同一行程只呼叫一次 create（數字證明）；
//      preview 物件不含 trip_id／email 類欄位
// Part R（headless Chrome，React development build＋<StrictMode> 真實 render）：
//   R1 已登入、有效邀請：先顯示行程卡；掛載後（含 StrictMode 雙重 effect）accept 呼叫 0 次；
//      按「加入行程」後恰 1 次，導向 /saved/{tripId}?view=overview（replace）並清除 stash
//   R2 連點兩次「加入行程」：accept 恰 1 次
//   R3 未登入：按鈕「登入後加入」；按下 → requireAuthForAction("collaboration")、stash token、accept 0 次
//   R4 revoked／expired／full／invalid：顯示失效文案、無加入鈕、accept 0 次
//   R5 accept 回 trip_full／invite_revoked：切換為失效狀態；not_authenticated → 要求登入
//   R6 真實 App.tsx 外殼（public-routes 讓 /trip-invite/{token} 繞過 onboarding）：已登入使用者的
//      「加入行程」必須可按且可送出；未登入顯示「登入後加入」（對照：非繞過路徑同一頁面可加入）
//   R7 無外部請求、無瀏覽器例外
//
// 不讀 .env、不連網（瀏覽器只連 127.0.0.1 fixture server）。
// 執行：node scripts/verify-trip-invite-stage3.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-tw3-"));

function mockPlugin(mocks) {
  return {
    name: "mocks",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
    },
  };
}

// ───────────────────────── Part N：Node ─────────────────────────
const G = "globalThis.__tw3";
const nodeMocks = {
  // auth：以 getter 讀 globalThis.__tw3Auth（未設定＝undefined，模擬沒有 auth 的測試 mock；N11e～N11i 注入可觸發的 onAuthStateChange）
  "@/integrations/supabase/client": `export const supabase={
    get auth(){return globalThis.__tw3Auth;},
    channel:(...a)=>{(globalThis.__tw3Channels||(globalThis.__tw3Channels=[])).push(a);const c={on:()=>c,subscribe:()=>c};return c;},
    rpc:(name,args)=>{${G}.rpc.push([name,args]);return Promise.resolve(${G}.rpcImpl(name,args));},
    from:(t)=>{${G}.from.push(t);const q={select:()=>q,insert:(v)=>{${G}.insert.push([t,v]);return q;},eq:()=>q,order:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:null}),single:()=>Promise.resolve({data:null,error:null}),then:(r)=>r({data:[],error:null})};return q;},
  };export const isSupabaseConfigured=()=>true;`,
  "@/lib/auth-session": `export const getAuthenticatedUserId=async()=>${G}.uid;export const readCachedAuthenticatedUserIdSync=()=>${G}.uid;`,
  "@/services/platform": `export const detectPlatform=()=>${G}.platform;`,
  "@/lib/copy-to-clipboard": `export const COPY_MANUAL_HINT='manual';export async function copyTextToClipboard(t){${G}.copies.push(t);return ${G}.copyResult;}`,
  "@/lib/i18n/effective-app-locale": `export const effectiveAppLocale=()=>${G}.locale;`,
  "@/lib/log-error": `export const logAppError=()=>{};export const logAppErrorDetail=()=>{};export const formatErrorDetail=()=>'';`,
  "@/lib/capacitor-bridge-ready": `export const waitForCapacitorBridge=async()=>{};`,
  "@capacitor/app": `export const App={getLaunchUrl:async()=>null,addListener:async()=>({remove(){}})};`,
};
const nodeEntry = `
export * as collab from '@/lib/trip/trip-collab';
export * as deepLink from '@/lib/trip/trip-invite-deep-link';
export * as copy from '@/lib/i18n/trip-workspace-copy';
export { Route as AasaRoute } from '@/routes/[.]well-known/apple-app-site-association';
`;
const nodeBundle = path.join(tmp, "node-bundle.mjs");
await build({
  stdin: { contents: nodeEntry, resolveDir: root, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  outfile: nodeBundle,
  jsx: "automatic",
  alias: { "@": path.join(root, "src") },
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
  plugins: [mockPlugin(nodeMocks)],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function resetState(over = {}) {
  globalThis.__tw3 = {
    rpc: [],
    from: [],
    insert: [],
    copies: [],
    copyResult: "copied",
    uid: "user-1",
    locale: "zh-TW",
    platform: { isCapacitor: false, isIOS: false, isNative: false, kind: "web" },
    rpcImpl: () => ({ data: null, error: null }),
    ...over,
  };
}
let importSeq = 0;
/** 每次重新評估 bundle（新的 @capacitor/core 實例，讀取當下的 globalThis.Capacitor／webkit） */
async function freshModules({ capacitor, webkit } = {}) {
  delete globalThis.Capacitor;
  delete globalThis.webkit;
  delete globalThis.androidBridge;
  if (capacitor) globalThis.Capacitor = capacitor;
  if (webkit) globalThis.webkit = webkit;
  return import(pathToFileURL(nodeBundle).href + "?n=" + ++importSeq);
}
function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}
function restoreNavigator() {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
}

resetState();
const M = await freshModules();
const TOKEN = "Ab3_-xY9" + "k".repeat(35); // 43 字元 base64url（與 create_trip_invite 產生格式相同）
const URL_PREFIX = "https://roamie.tw/trip-invite/";
const TRICKY_TITLE = "東京 & 大阪 #1\n第二行 100% a+b?c=d";

await check("N1 buildTripInviteUrl＝https://roamie.tw/trip-invite/{token}；trip-collab 無 Math.random／直接 INSERT trip_invites", () => {
  assert.equal(M.collab.buildTripInviteUrl(TOKEN), URL_PREFIX + TOKEN);
  assert.equal(M.collab.TRIP_INVITE_WEB_ORIGIN, "https://roamie.tw");
  const src = read("src/lib/trip/trip-collab.ts");
  assert.doesNotMatch(src, /Math\.random/, "trip-collab.ts 仍使用 Math.random");
  assert.doesNotMatch(src, /from\("trip_invites"\)\s*\.insert/, "trip-collab.ts 仍直接 INSERT trip_invites");
  assert.doesNotMatch(src, /APP_SCHEME/, "邀請連結不得再用 roamie:// scheme");
});

function messageFor(title) {
  return `${M.collab.buildTripInviteShareText(title)}\n${URL_PREFIX}${TOKEN}`;
}
await check("N2a LINE：https://line.me/R/share?text=＋完整編碼（中文、&、#、換行、%、+、?）", () => {
  resetState();
  const url = M.collab.buildLineShareUrl(TOKEN, TRICKY_TITLE);
  assert.ok(url.startsWith("https://line.me/R/share?text="), url);
  const raw = url.slice("https://line.me/R/share?text=".length);
  assert.doesNotMatch(raw, /[&#\n ?]/, "text 參數含未編碼的 & # 換行 空白 ?：" + raw);
  assert.equal(decodeURIComponent(raw), messageFor(TRICKY_TITLE));
  assert.equal(new URL(url).searchParams.get("text"), messageFor(TRICKY_TITLE), "URLSearchParams 解析（+ 不得變空白）");
  assert.ok(decodeURIComponent(raw).includes("「東京 & 大阪 #1\n第二行 100% a+b?c=d」"), decodeURIComponent(raw));
  assert.ok(decodeURIComponent(raw).endsWith("\n" + URL_PREFIX + TOKEN));
  assert.ok(decodeURIComponent(M.collab.buildLineShareUrl(TOKEN, "   ").slice(29)).includes("「Roamie」"), "空白標題退回 Roamie");
});
await check("N2b 訊息：iOS sms:&body=、其他 sms:?body=；body 編碼正確", () => {
  for (const [isIOS, prefix] of [[true, "sms:&body="], [false, "sms:?body="]]) {
    const url = M.collab.buildSmsShareUrl(TOKEN, TRICKY_TITLE, isIOS);
    assert.ok(url.startsWith(prefix), url);
    const raw = url.slice(prefix.length);
    assert.doesNotMatch(raw, /[&#\n ?]/, "body 含未編碼字元：" + raw);
    assert.equal(decodeURIComponent(raw), messageFor(TRICKY_TITLE));
  }
});
await check("N2c Email：mailto:?subject=…&body=…；只有一個分隔用 &，subject／body 逐字還原", () => {
  const url = M.collab.buildMailtoShareUrl(TOKEN, TRICKY_TITLE);
  const m = url.match(/^mailto:\?subject=([^&]*)&body=([^&]*)$/);
  assert.ok(m, "格式不符：" + url);
  assert.doesNotMatch(m[1] + m[2], /[#\n ?]/, "subject/body 含未編碼字元");
  const copy = M.copy.getTripWorkspaceCopy("zh-TW");
  assert.equal(decodeURIComponent(m[1]), M.copy.formatTripWorkspaceTemplate(copy.inviteEmailSubject, { title: TRICKY_TITLE.trim() }));
  assert.equal(decodeURIComponent(m[2]), messageFor(TRICKY_TITLE));
});
await check("N2d 分享文案走 i18n（en 不出現中文模板）", () => {
  resetState({ locale: "en" });
  const line = decodeURIComponent(M.collab.buildLineShareUrl(TOKEN, "Kyoto").slice(29));
  assert.ok(line.startsWith(M.copy.getTripWorkspaceCopy("en").inviteShareText.replace("{title}", "Kyoto")), line);
  assert.doesNotMatch(line, /邀請/);
  resetState();
});

const ACCEPT = [
  ["https://roamie.tw/trip-invite/" + TOKEN, TOKEN],
  ["https://www.roamie.tw/trip-invite/" + TOKEN, TOKEN],
  ["https://roamie.tw/trip-invite/" + TOKEN + "/", TOKEN],
  ["https://roamie.tw/trip-invite/" + TOKEN + "?utm_source=line&x=1", TOKEN],
  ["https://roamie.tw/trip-invite/" + TOKEN + "#join", TOKEN],
  ["https://ROAMIE.TW/trip-invite/" + TOKEN, TOKEN],
  ["roamie://trip-invite/" + TOKEN, TOKEN],
  ["roamie://trip-invite/" + TOKEN + "/", TOKEN],
  ["roamie://trip-invite/" + TOKEN + "?from=old", TOKEN],
];
const REJECT = [
  "http://roamie.tw/trip-invite/" + TOKEN,
  "https://evil.com/trip-invite/" + TOKEN,
  "https://roamie.tw.evil.com/trip-invite/" + TOKEN,
  "https://evilroamie.tw/trip-invite/" + TOKEN,
  "https://roamie.tw@evil.com/trip-invite/" + TOKEN,
  "https://app.roamie.tw/trip-invite/" + TOKEN,
  "https://roamie.tw/trip-invites/" + TOKEN,
  "https://roamie.tw/trip-invite/",
  "https://roamie.tw/trip-invite",
  "https://roamie.tw/trip-invite/" + TOKEN + "/extra",
  "https://roamie.tw/x/trip-invite/" + TOKEN,
  "https://roamie.tw/saved/" + TOKEN,
  "roamie://other/" + TOKEN,
  "roamie://trip-invite/",
  "javascript:alert(1)//roamie.tw/trip-invite/x",
  "not a url",
];
await check("N3a deep link 可解析：https（含 www、尾斜線、query、hash、大寫網域）與 roamie://", () => {
  const bad = ACCEPT.map(([u, want]) => [u, M.deepLink.parseTripInviteTokenFromUrl(u), want]).filter(([, got, want]) => got !== want);
  assert.deepEqual(bad, []);
});
await check("N3b deep link 拒絕其他網域／http／其他路徑／多段／空 token", () => {
  const bad = REJECT.map((u) => [u, M.deepLink.parseTripInviteTokenFromUrl(u)]).filter(([, got]) => got !== null);
  assert.deepEqual(bad, []);
});
await check("N3c roamie:// 多段路徑也要拒絕（與 https 規則一致）", () => {
  assert.equal(M.deepLink.parseTripInviteTokenFromUrl("roamie://trip-invite/" + TOKEN + "/extra"), null);
  assert.equal(M.deepLink.parseTripInviteTokenFromUrl("roamie://trip-invite/a/b"), null);
});
await check("N3d tripInvitePathFromToken 會編碼 token", () => {
  assert.equal(M.deepLink.tripInvitePathFromToken(TOKEN), "/trip-invite/" + TOKEN);
  assert.equal(M.deepLink.tripInvitePathFromToken("a/b?c"), "/trip-invite/a%2Fb%3Fc");
  info("https://roamie.tw/trip-invite/a%2Fb → " + JSON.stringify(M.deepLink.parseTripInviteTokenFromUrl("https://roamie.tw/trip-invite/a%2Fb")) + "（解碼後含 /，導覽時會再編碼；伺服端以 token 字元集擋下）");
  info("https://roamie.tw:8443/trip-invite/x… → " + JSON.stringify(M.deepLink.parseTripInviteTokenFromUrl("https://roamie.tw:8443/trip-invite/" + TOKEN)) + "（非預設埠也會被接受）");
});

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const REQUIRED_KEYS = [
  "inviteMembers", "inviteLinkTitle", "inviteLinkLoading", "inviteOptionCopy", "inviteOptionLine", "inviteOptionMessages",
  "inviteOptionEmail", "inviteOptionMore", "inviteCopied", "inviteCopyManual", "inviteShareText", "inviteEmailSubject",
  "inviteJoin", "inviteNotNow", "inviteLoginToJoin", "inviteBackHome", "inviteRetry", "inviteMemberCount",
  "inviteMemberCountOne", "inviteStateRevoked", "inviteStateExpired", "inviteStateFull", "inviteStateInvalid",
  "inviteLoadFailed", "inviteJoinFailed", "inviteCreateFailed", "inviteRateLimited", "inviteNotOwner",
  "inviteNotAuthenticated", "inviteNetworkError", "removedFromTrip",
];
await check("N4a 四語系 key 集合一致、規格 key 齊全且非空", () => {
  const zhKeys = Object.keys(M.copy.getTripWorkspaceCopy("zh-TW")).sort();
  for (const loc of LOCALES) {
    const c = M.copy.getTripWorkspaceCopy(loc);
    assert.ok(c, "缺少語系 " + loc);
    assert.deepEqual(Object.keys(c).sort(), zhKeys, loc + " key 集合與 zh-TW 不同");
    for (const k of REQUIRED_KEYS) assert.ok(typeof c[k] === "string" && c[k].trim(), `${loc}.${k} 缺少或空白`);
    assert.ok(c.inviteShareText.includes("{title}") && c.inviteEmailSubject.includes("{title}"), loc + " {title} 佔位符");
    assert.ok(c.inviteMemberCount.includes("{count}") && c.inviteMemberCountOne.includes("{count}"), loc + " {count} 佔位符");
  }
  for (const loc of ["en", "ja", "ko"]) {
    const c = M.copy.getTripWorkspaceCopy(loc);
    // LINE、Email 為通用詞（zh-TW 亦用英文），允許相同
    const same = REQUIRED_KEYS.filter((k) => k !== "inviteOptionLine" && k !== "inviteOptionEmail" && c[k] === M.copy.getTripWorkspaceCopy("zh-TW")[k]);
    assert.deepEqual(same, [], loc + " 與 zh-TW 相同（未翻譯）");
  }
});
await check("N4b 指定文案：zh-TW 邀請連結／邀請成員／已複製邀請連結／加入行程／登入後加入／你已不在此行程中；ja リンクをコピー", () => {
  const zh = M.copy.getTripWorkspaceCopy("zh-TW");
  assert.equal(zh.inviteLinkTitle, "邀請連結");
  assert.equal(zh.inviteMembers, "邀請成員");
  assert.equal(zh.inviteCopied, "已複製邀請連結");
  assert.equal(zh.inviteJoin, "加入行程");
  assert.equal(zh.inviteLoginToJoin, "登入後加入");
  assert.equal(zh.removedFromTrip, "你已不在此行程中");
  assert.equal(M.copy.getTripWorkspaceCopy("ja").inviteOptionCopy, "リンクをコピー");
});
await check("N4c 面板：五個選項、無 Threads/X；標籤寬 72px＋最多兩行", () => {
  const sheet = read("src/components/trip/TripInviteSheet.tsx");
  for (const k of ["inviteOptionCopy", "inviteOptionLine", "inviteOptionMessages", "inviteOptionEmail", "inviteOptionMore"]) {
    assert.ok(sheet.includes("copy." + k), "缺少選項 " + k);
  }
  assert.doesNotMatch(sheet, /threads|twitter|x\.com|intent\/tweet/i);
  assert.match(sheet, /w-\[72px\]/);
  assert.match(sheet, /line-clamp-2/);
  const collab = read("src/lib/trip/trip-collab.ts");
  assert.doesNotMatch(collab, /threads|twitter|x\.com/i);
});

await check("N5a AASA handler（module 層級呼叫）：200、application/json、只涵蓋 /trip-invite/*", async () => {
  const route = M.AasaRoute;
  const GET = route?.options?.server?.handlers?.GET;
  assert.equal(typeof GET, "function", "取不到 Route.options.server.handlers.GET");
  const res = await GET({ request: new Request("https://roamie.tw/.well-known/apple-app-site-association") });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("location"), null, "不得重新導向");
  const body = JSON.parse(await res.text());
  const details = body?.applinks?.details;
  assert.ok(Array.isArray(details) && details.length === 1, JSON.stringify(body));
  const d = details[0];
  assert.deepEqual(d.appIDs, ["K88UK4PZ43.com.shuode.roamie"]);
  if ("appID" in d) assert.equal(d.appID, "K88UK4PZ43.com.shuode.roamie");
  assert.deepEqual(d.components, [{ "/": "/trip-invite/*" }]);
  if ("paths" in d) assert.deepEqual(d.paths, ["/trip-invite/*"]);
  assert.ok(!("webcredentials" in body) && !("appclips" in body), "AASA 不應包含其他服務");
});
await check("N5b AASA 路由註冊於 /.well-known/apple-app-site-association；App.entitlements 有 applinks:roamie.tw", () => {
  const tree = read("src/routeTree.gen.ts");
  assert.match(tree, /path: '\/\.well-known\/apple-app-site-association'/);
  const ent = read("ios/App/App/App.entitlements");
  assert.match(ent, /<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>[\s\S]*<string>applinks:roamie\.tw<\/string>/);
  if (!/applinks:www\.roamie\.tw/.test(ent)) info("App.entitlements 沒有 applinks:www.roamie.tw：www 連結會以網頁開啟（App 內 parser 仍可解析）");
});

const pub = await import(pathToFileURL(path.join(root, "src/lib/public-routes.ts")).href);
const PUBLIC_ALLOW = ["/trip-invite/" + TOKEN, "/trip-invite/" + TOKEN + "/", "/trip-invite/abc", "/support", "/privacy", "/terms", "/login/legal", "/support/"];
const PUBLIC_DENY = [
  "/", "/trip-invite", "/trip-invite/", "/trip-invite//", "/trip-invite/a/b", "/trip-invite/" + TOKEN + "/edit",
  "/trip-invite-evil/abc", "/trip-inviteabc", "/x/trip-invite/abc", "//trip-invite/abc", "/saved/abc", "/saved",
  "/chat", "/profile", "/login", "/support/x", "/privacy/../saved",
];
await check("N6a public-routes 允許表格", () => {
  const bad = PUBLIC_ALLOW.filter((p) => pub.isPublicOnboardingBypassPath(p) !== true);
  assert.deepEqual(bad, []);
});
await check("N6b public-routes 拒絕表格（其他受保護路由不被繞過）", () => {
  const bad = PUBLIC_DENY.filter((p) => pub.isPublicOnboardingBypassPath(p) !== false);
  assert.deepEqual(bad, []);
});
await check("N6c 大小寫／編碼：大寫路徑不繞過（較嚴格、安全）；編碼過的 token 只落在邀請頁本身", () => {
  assert.equal(pub.isPublicOnboardingBypassPath("/TRIP-INVITE/abc"), false);
  assert.equal(pub.isPublicOnboardingBypassPath("/Trip-Invite/abc"), false);
  // %2F 不是路徑分隔：路由器仍比對到 /trip-invite/$token（token 解碼為 "a/../saved"），不會渲染其他頁
  info("/trip-invite/a%2F..%2Fsaved → bypass=" + pub.isPublicOnboardingBypassPath("/trip-invite/a%2F..%2Fsaved") + "（仍為邀請頁 token，非其他路由）");
});
await check("N6d 拆分：isPublicLegalPath 只含法務頁；isTripInvitePublicPath 只含邀請頁；聯集＝兩者", () => {
  const legal = ["/support", "/privacy", "/terms", "/login/legal", "/support/", "/login/legal/"];
  const invite = ["/trip-invite/" + TOKEN, "/trip-invite/" + TOKEN + "/", "/trip-invite/abc"];
  for (const p of legal) {
    assert.equal(pub.isPublicLegalPath(p), true, p);
    assert.equal(pub.isTripInvitePublicPath(p), false, p);
  }
  for (const p of invite) {
    assert.equal(pub.isPublicLegalPath(p), false, p + " 邀請頁不得被當成法務頁（法務頁只包 I18nProvider）");
    assert.equal(pub.isTripInvitePublicPath(p), true, p);
  }
  for (const p of [...legal, ...invite, ...PUBLIC_DENY]) {
    assert.equal(pub.isPublicOnboardingBypassPath(p), pub.isPublicLegalPath(p) || pub.isTripInvitePublicPath(p), p);
  }
  for (const p of PUBLIC_DENY) assert.equal(pub.isTripInvitePublicPath(p), false, p);
});

// ── N9：login.tsx（真實 Route.options.beforeLoad）不受邀請頁聯集影響（#TW3-T2 e） ──
const LG = "globalThis.__tw3login";
const loginMocks = {
  "@/integrations/supabase/client": `export const supabase={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async()=>({data:null,error:null}),from:()=>{throw new Error('no db in verify');},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:async()=>{}};export const isSupabaseConfigured=()=>false;`,
  "@tanstack/react-router": `export const createFileRoute=(p)=>(o)=>({path:p,options:o});
export const redirect=(o)=>{const e=new Error('redirect');e.__redirect=o;return e;};
export const Outlet=()=>null;export const Link=()=>null;export const useNavigate=()=>()=>{};
export const useRouterState=()=>'/login';export const useRouter=()=>({});`,
  "@/main": `export const removeStaticBootPlaceholder=()=>{};`,
  // 其餘 export 沿用真實模組；只覆寫 beforeLoad 讀的三個（本地 export 優先於 export *）
  "@/lib/onboarding-storage": `export * from ${JSON.stringify(path.join(root, "src/lib/onboarding-storage.ts"))};
export const loadOnboardingState=async()=>{${LG}.loads++;return ${LG}.onboarded;};
export const isOnboardingCompletedSync=()=>${LG}.onboarded;export const isOnboardingHydrated=()=>true;`,
  "@/lib/admin/admin-route-boundary": `export * from ${JSON.stringify(path.join(root, "src/lib/admin/admin-route-boundary.ts"))};
export const hasPendingAdminReturn=()=>${LG}.adminReturn;`,
  "@/lib/supabase": `export const supabase={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};`,
  // server function 建構器（login 圖譜間接引用；beforeLoad 不會呼叫）
  "@tanstack/react-start": `const chain=()=>{const f=async()=>{throw new Error('server fn not available in verify');};
for(const m of ['inputValidator','validator','middleware','handler','server','client'])f[m]=()=>f;return f;};
export const createServerFn=()=>chain();export const createMiddleware=()=>chain();export const createStart=()=>({});
export const useServerFn=(f)=>f;`,
  "@tanstack/react-start/server": `export const getRequest=()=>null;`,
};
let LoginRoute = null;
let loginBuildError = null;
try {
  const loginBundle = path.join(tmp, "login-bundle.mjs");
  await build({
    stdin: { contents: "export { Route } from '@/routes/login';", resolveDir: root, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    outfile: loginBundle,
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    loader: { ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl", ".css": "empty" },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
    plugins: [mockPlugin(loginMocks)],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  LoginRoute = (await import(pathToFileURL(loginBundle).href)).Route;
} catch (e) {
  loginBuildError = e;
}
async function loginBeforeLoad(pathname, { onboarded = false, adminReturn = false } = {}) {
  globalThis.__tw3login = { loads: 0, onboarded, adminReturn };
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prevWindow = globalThis.window;
  if (!hadWindow) globalThis.window = {};
  try {
    await LoginRoute.options.beforeLoad({ location: { pathname } });
    return { redirect: null, loads: globalThis.__tw3login.loads };
  } catch (e) {
    if (e?.__redirect) return { redirect: e.__redirect.to, loads: globalThis.__tw3login.loads };
    throw e;
  } finally {
    if (!hadWindow) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
}
await check("N9a login.tsx beforeLoad（真實模組）：/login 未完成 onboarding→/welcome、完成→放行；/login/legal 不讀 onboarding 直接放行；admin return 放行", async () => {
  assert.ok(LoginRoute, "無法打包 login.tsx：" + String(loginBuildError?.message ?? loginBuildError).slice(0, 400));
  assert.deepEqual(await loginBeforeLoad("/login"), { redirect: "/welcome", loads: 1 });
  assert.deepEqual(await loginBeforeLoad("/login/"), { redirect: "/welcome", loads: 1 });
  assert.deepEqual(await loginBeforeLoad("/login", { onboarded: true }), { redirect: null, loads: 1 });
  assert.deepEqual(await loginBeforeLoad("/login/legal"), { redirect: null, loads: 0 });
  assert.deepEqual(await loginBeforeLoad("/login/legal/"), { redirect: null, loads: 0 });
  assert.deepEqual(await loginBeforeLoad("/login", { adminReturn: true }), { redirect: null, loads: 0 });
});
await check("N9b login 子路徑：聯集對 /login* 的判斷與原本（＝isPublicLegalPath）完全相同；邀請頁不是 /login 的子路由", async () => {
  const LOGIN_PATHS = ["/login", "/login/", "/login/legal", "/login/legal/", "/login/x", "/login/trip-invite/" + TOKEN, "/login/legal/x", "/LOGIN/legal"];
  const diff = LOGIN_PATHS.filter((p) => pub.isPublicOnboardingBypassPath(p) !== pub.isPublicLegalPath(p));
  assert.deepEqual(diff, [], "邀請頁聯集改變了 login beforeLoad 的判斷");
  // 真實 beforeLoad：類邀請頁的 /login 子路徑仍需 onboarding
  assert.deepEqual(await loginBeforeLoad("/login/trip-invite/" + TOKEN), { redirect: "/welcome", loads: 1 });
  const tree = read("src/routeTree.gen.ts");
  assert.match(tree, /const TripInviteTokenRoute = TripInviteTokenRouteImport\.update\(\{\s*id: '\/trip-invite\/\$token',\s*path: '\/trip-invite\/\$token',\s*getParentRoute: \(\) => rootRouteImport,/);
  assert.match(tree, /const LoginLegalRoute = LoginLegalRouteImport\.update\(\{[\s\S]*?getParentRoute: \(\) => LoginRoute,/);
});
await check("N9c 登入後導回：login.tsx 有 stash 時導向 /trip-invite/$token；該路徑走 App 的邀請分支（非法務頁）", () => {
  const src = read("src/routes/login.tsx");
  assert.match(src, /const pendingInvite = readStashedTripInviteToken\(\);\s*if \(pendingInvite\) \{\s*navigate\(\{ to: "\/trip-invite\/\$token", params: \{ token: pendingInvite \}, replace: true \}\);/);
  const p = M.deepLink.tripInvitePathFromToken(TOKEN);
  assert.equal(pub.isTripInvitePublicPath(p), true);
  assert.equal(pub.isPublicLegalPath(p), false);
  const app = read("src/App.tsx");
  assert.match(app, /useIosInteractiveRoute\(isPublicLegalPath\(currentPath\) \? "public-legal" : "__skip__"\)/, "邀請頁不得被標成 public-legal 互動路由");
  assert.doesNotMatch(app, /isPublicOnboardingBypassPath/, "App.tsx 不得再用聯集（會把邀請頁當成只包 I18nProvider 的法務頁）");
  const providers = read("src/providers/AppProviders.tsx");
  assert.match(providers, /<AuthProvider>[\s\S]*<PurchaseShellProviders>[\s\S]*<\/AuthProvider>/);
  assert.match(providers, /function PurchaseShellProviders[\s\S]*?<AuthActionRuntime \/>/, "真實 AppProviders 必須掛 AuthActionRuntime（登入提示／登入後回復）");
});

await check("N7a iOS 未安裝 @capacitor/share：不 crash、退回複製恰 1 次、回傳 copied、不呼叫 navigator.share", async () => {
  let navShare = 0;
  setNavigator({ share: async () => void navShare++, canShare: () => true });
  let native = 0;
  try {
    resetState({ platform: { isCapacitor: true, isIOS: true, isNative: true, kind: "ios" } });
    const X = await freshModules({
      webkit: { messageHandlers: { bridge: { postMessage() {} } } },
      capacitor: { PluginHeaders: [{ name: "Clipboard", methods: [{ name: "write", rtype: "promise" }] }], nativePromise: async () => void native++ },
    });
    const warn = console.warn;
    console.warn = () => {};
    let result;
    try {
      result = await X.collab.shareTripInvite(TOKEN, "東京");
    } finally {
      console.warn = warn;
    }
    assert.equal(result, "copied");
    assert.deepEqual(globalThis.__tw3.copies, [URL_PREFIX + TOKEN]);
    assert.equal(native, 0);
    assert.equal(navShare, 0);
    // 複製失敗 → manual（面板顯示手動複製提示），仍不丟例外
    resetState({ platform: { isCapacitor: true, isIOS: true, isNative: true, kind: "ios" }, copyResult: "manual" });
    console.warn = () => {};
    try {
      assert.equal(await X.collab.shareTripInvite(TOKEN, "東京"), "manual");
    } finally {
      console.warn = warn;
    }
  } finally {
    restoreNavigator();
  }
});
await check("N7b iOS 已安裝 Share：原生 share 恰 1 次（title/text/url）、不複製；使用者取消 → cancelled、不複製", async () => {
  const calls = [];
  let reject = false;
  resetState({ platform: { isCapacitor: true, isIOS: true, isNative: true, kind: "ios" } });
  const X = await freshModules({
    webkit: { messageHandlers: { bridge: { postMessage() {} } } },
    capacitor: {
      PluginHeaders: [{ name: "Share", methods: [{ name: "share", rtype: "promise" }, { name: "canShare", rtype: "promise" }] }],
      nativePromise: async (plugin, method, opts) => {
        calls.push([plugin, method, opts]);
        if (reject) throw new Error("Share canceled");
        return { activityType: "x" };
      },
    },
  });
  assert.equal(await X.collab.shareTripInvite(TOKEN, "東京"), "shared");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "Share");
  assert.equal(calls[0][1], "share");
  assert.equal(calls[0][2].url, URL_PREFIX + TOKEN);
  assert.equal(calls[0][2].title, "東京");
  assert.equal(calls[0][2].text, X.collab.buildTripInviteShareText("東京"));
  assert.deepEqual(globalThis.__tw3.copies, []);
  reject = true;
  assert.equal(await X.collab.shareTripInvite(TOKEN, "東京"), "cancelled");
  assert.equal(calls.length, 2);
  assert.deepEqual(globalThis.__tw3.copies, []);
});
await check("N7c Web：navigator.share 可用→shared；AbortError→cancelled；canShare=false 或無 share→複製", async () => {
  try {
    resetState();
    const X = await freshModules();
    const shares = [];
    setNavigator({ share: async (d) => void shares.push(d), canShare: () => true });
    assert.equal(await X.collab.shareTripInvite(TOKEN, "T"), "shared");
    assert.deepEqual(shares, [{ title: "T", text: X.collab.buildTripInviteShareText("T"), url: URL_PREFIX + TOKEN }]);
    assert.deepEqual(globalThis.__tw3.copies, []);
    setNavigator({ share: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; }, canShare: () => true });
    assert.equal(await X.collab.shareTripInvite(TOKEN, "T"), "cancelled");
    assert.deepEqual(globalThis.__tw3.copies, []);
    setNavigator({ share: async () => assert.fail("canShare=false 時不得呼叫 share"), canShare: () => false });
    assert.equal(await X.collab.shareTripInvite(TOKEN, "T"), "copied");
    setNavigator({});
    assert.equal(await X.collab.shareTripInvite(TOKEN, "T"), "copied");
    assert.equal(globalThis.__tw3.copies.length, 2);
  } finally {
    restoreNavigator();
  }
});

await check("N8a create_trip_invite：RPC 一次、不 INSERT trip_invites；getOrCreateTripInviteToken 快取命中後不再呼叫", async () => {
  resetState({ rpcImpl: (name) => (name === "create_trip_invite" ? { data: [{ invite_id: "i1", invite_token: TOKEN }], error: null } : { data: null, error: null }) });
  const X = await freshModules();
  const link = await X.collab.createTripInvite("trip-1");
  assert.deepEqual(link, { id: "i1", token: TOKEN });
  assert.deepEqual(globalThis.__tw3.rpc, [["create_trip_invite", { p_trip_id: "trip-1" }]]);
  assert.deepEqual(globalThis.__tw3.insert, []);
  globalThis.__tw3.rpc = [];
  assert.equal(X.collab.peekTripInviteToken("trip-2"), null);
  const [a, b] = await Promise.all([X.collab.getOrCreateTripInviteToken("trip-2"), X.collab.getOrCreateTripInviteToken("trip-2")]);
  const c = await X.collab.getOrCreateTripInviteToken("trip-2");
  assert.equal(a, TOKEN);
  assert.equal(b, TOKEN);
  assert.equal(c, TOKEN);
  const n = globalThis.__tw3.rpc.filter(([r]) => r === "create_trip_invite").length;
  info("並發兩次 getOrCreateTripInviteToken（快取未命中）→ create_trip_invite 呼叫 " + n + " 次（伺服端回傳同一連結，無資料影響）");
  assert.ok(n <= 2, "create 呼叫次數 " + n);
  globalThis.__tw3.rpc = [];
  await X.collab.getOrCreateTripInviteToken("trip-2");
  assert.equal(globalThis.__tw3.rpc.length, 0, "快取命中後不得再呼叫");
});
await check("N8b 錯誤碼對應：not_trip_owner／invite_rate_limited／trip_full／invite_revoked／未知錯誤", async () => {
  const X = await freshModules();
  for (const [code, key] of [["not_trip_owner", "inviteNotOwner"], ["invite_rate_limited", "inviteRateLimited"]]) {
    resetState({ rpcImpl: () => ({ data: null, error: { message: code, code: "42501" } }) });
    await assert.rejects(X.collab.createTripInvite("t"), (e) => e.code === code && e.message === X.copy.getTripWorkspaceCopy("zh-TW")[key]);
  }
  for (const [code, state] of [["trip_full", "full"], ["invite_revoked", "revoked"], ["invite_expired", "expired"], ["invite_not_found", "invalid"], ["invite_malformed", "invalid"], ["invite_invalid", "invalid"]]) {
    resetState({ rpcImpl: () => ({ data: null, error: { message: code } }) });
    const err = await X.collab.acceptTripInvite(TOKEN).then(() => null, (e) => e);
    assert.ok(err, code + " 應丟錯");
    assert.equal(X.collab.tripInviteErrorCode(err), code);
    assert.equal(X.collab.tripInviteStateFromErrorCode(X.collab.tripInviteErrorCode(err)), state);
  }
  resetState({ uid: null });
  await assert.rejects(X.collab.createTripInvite("t"), (e) => e.code === "not_authenticated");
  assert.equal(globalThis.__tw3.rpc.length, 0, "未登入不得呼叫 create RPC");
});
await check("N8c preview：只映射 7 個顯示欄位；伺服端多給的 trip_id／email 不會流到前端物件", async () => {
  resetState({
    rpcImpl: () => ({
      data: [{ state: "valid", trip_title: "T", date_start: "2026-11-01", date_end: "2026-11-03", cover_url: "https://x/c.jpg", inviter_display_name: "Amy", member_count: 3, trip_id: "LEAK", invitee_email: "a@b.c" }],
      error: null,
    }),
  });
  const X = await freshModules();
  const p = await X.collab.getTripInvitePreview(TOKEN);
  assert.deepEqual(Object.keys(p).sort(), ["coverUrl", "dateEnd", "dateStart", "inviterDisplayName", "memberCount", "state", "tripTitle"]);
  assert.ok(!JSON.stringify(p).includes("LEAK") && !JSON.stringify(p).includes("a@b.c"));
  assert.deepEqual(globalThis.__tw3.rpc, [["get_trip_invite_preview", { invite_token: TOKEN }]]);
  resetState({ rpcImpl: () => ({ data: [], error: null }) });
  assert.equal((await X.collab.getTripInvitePreview(TOKEN)).state, "invalid");
});
await check("N8d migration：preview 回傳欄位不含 trip_id／email；get_trip_invite_by_token 全部撤銷；create/set/accept 只給 authenticated", () => {
  const sql = read("supabase/migrations/20261102100000_trip_invite_hardening.sql");
  const ret = sql.match(/FUNCTION public\.get_trip_invite_preview\(invite_token text\)\s*RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/);
  assert.ok(ret, "找不到 preview RETURNS TABLE");
  const cols = ret[1].split(",").map((s) => s.trim().split(/\s+/)[0]).sort();
  assert.deepEqual(cols, ["cover_url", "date_end", "date_start", "inviter_display_name", "member_count", "state", "trip_title"]);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_trip_invite_preview\(text\) TO anon, authenticated;/);
  for (const fn of ["create_trip_invite\\(uuid\\)", "set_trip_invite_link_enabled\\(uuid, boolean\\)", "accept_trip_invite\\(text\\)"]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM PUBLIC, anon, authenticated;\\s*GRANT EXECUTE ON FUNCTION public\\.${fn} TO authenticated;`));
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_trip_invite_by_token\(text\) FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT[^;]*get_trip_invite_by_token/);
  const code = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(code, /REVOKE[^;]*INSERT[^;]*trip_invites/i, "不得撤銷舊 App 的 trip_invites INSERT");
  assert.doesNotMatch(code, /DROP POLICY[^;]*trip_invites_insert/i, "不得移除舊 App 的 trip_invites INSERT policy");
  assert.doesNotMatch(code, /supabase_realtime/, "不得加入 realtime publication");
});
await check("N8e trigger 不影響舊 App 一次性邀請：INSERT（is_link 預設 false、revoked_at NULL）／UPDATE status 允許；RPC 以 definer 身分不受限", () => {
  const sql = read("supabase/migrations/20261102100000_trip_invite_hardening.sql");
  const fn = sql.match(/FUNCTION public\.guard_trip_invite_client_write\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)[1];
  assert.match(fn, /IF current_user NOT IN \('anon', 'authenticated'\) THEN\s*RETURN NEW;/);
  assert.match(fn, /IF NEW\.is_link OR NEW\.revoked_at IS NOT NULL THEN/);
  // UPDATE 只擋 is_link／token／trip_id 變更與「已撤銷後再改 revoked_at」；status／expires_at／invitee_* 不擋
  const upd = fn.slice(fn.indexOf("-- UPDATE"));
  assert.doesNotMatch(upd, /\bstatus\b|expires_at|invitee/, "UPDATE 規則不得擋舊 App 會改的欄位");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_link boolean NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE FUNCTION public\.create_trip_invite[\s\S]*?SECURITY DEFINER/);
  // 舊 App 會 SELECT 新插入列（.select(...).single()）：trigger 為 BEFORE、不改 NEW
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.trip_invites/);
});

// ── N10（#TW3-T3）：network 錯誤碼判斷與共用文案函式 ──
await check("N10a network 判斷：postgrest 一般物件 Failed to fetch／Load failed（code:\"\"）、TypeError 實例、Firefox NetworkError、離線 → network", async () => {
  const X = await freshModules();
  const net = [
    { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" },
    { message: "TypeError: Load failed", details: "", hint: "", code: "" },
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    { message: "TypeError: NetworkError when attempting to fetch resource.", code: "" },
    { message: "TypeError: Network request failed", code: "" },
  ];
  for (const e of net) assert.equal(X.collab.tripInviteErrorCode(e), "network", JSON.stringify(e?.message ?? e));
  assert.equal(X.collab.tripInviteErrorCode({ message: "something odd", code: "P0001" }), null);
  assert.equal(X.collab.tripInviteErrorCode(null), null);
  assert.equal(X.collab.tripInviteErrorCode(undefined), null);
  try {
    setNavigator({ onLine: false });
    assert.equal(X.collab.tripInviteErrorCode({ message: "something odd", code: "P0001" }), "network", "離線時一律視為 network");
  } finally {
    restoreNavigator();
  }
});
await check("N10b 伺服端錯誤碼優先：訊息同時含 network 關鍵字或離線時，not_trip_owner／invite_rate_limited／not_authenticated 仍照舊", async () => {
  const X = await freshModules();
  const cases = [
    [{ message: "not_trip_owner (network error)", code: "42501" }, "not_trip_owner"],
    [{ message: "invite_rate_limited: failed to fetch quota", code: "P0001" }, "invite_rate_limited"],
    [{ message: "not_authenticated", code: "28000" }, "not_authenticated"],
  ];
  for (const [e, code] of cases) assert.equal(X.collab.tripInviteErrorCode(e), code, e.message);
  try {
    setNavigator({ onLine: false });
    for (const [e, code] of cases) assert.equal(X.collab.tripInviteErrorCode(e), code, "離線：" + e.message);
  } finally {
    restoreNavigator();
  }
});
await check("N10c tripInviteCreateErrorKey 窮舉：每個 TripInviteErrorCode＋null 都有對應 key，且 key 在四語系皆存在", async () => {
  const X = await freshModules();
  const src = read("src/lib/trip/trip-collab.ts");
  const union = src.match(/export type TripInviteErrorCode =([\s\S]*?);/)[1];
  const codes = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(codes.includes("network") && codes.length >= 10, "錯誤碼集合：" + codes.join(","));
  const expected = { not_trip_owner: "inviteNotOwner", invite_rate_limited: "inviteRateLimited", not_authenticated: "inviteNotAuthenticated", network: "inviteNetworkError" };
  const got = {};
  for (const code of codes) {
    const key = X.collab.tripInviteCreateErrorKey(new X.collab.TripInviteError(code, "x"));
    got[code] = key;
    assert.equal(key, expected[code] ?? "inviteCreateFailed", code);
  }
  assert.equal(X.collab.tripInviteCreateErrorKey(new X.collab.TripInviteError(null, "x")), "inviteCreateFailed");
  assert.equal(X.collab.tripInviteCreateErrorKey(new Error("boom")), "inviteCreateFailed");
  for (const loc of LOCALES) for (const k of new Set(Object.values(got))) assert.ok(X.copy.getTripWorkspaceCopy(loc)[k]?.trim(), loc + "." + k);
  info("create 錯誤碼 → key：" + JSON.stringify(got));
});
// N10d（#TW3-T4 改寫）：失敗狀態改存 trip-collab.ts 模組層。要保護的性質：
//   (1) 模組寫入失敗狀態時一律經由 tripInviteCreateErrorKey（行為＋原始碼：每個 failure 寫入點都用共用函式）
//   (2) 兩個元件沒有自己的錯誤碼→文案對應、不自行呼叫 create／不自行寫入失敗（只讀 peekTripInviteError）
//   (3) 建立失敗不跳 toast（模組不依賴 toast；元件的 toast 只在複製／分享結果）
await check("N10d createTripInvite 端到端 network；模組層失敗狀態一律經 tripInviteCreateErrorKey；元件無自有對應表、不自行建立／寫入失敗；建立失敗無 toast", async () => {
  const X = await freshModules();
  for (const msg of ["TypeError: Failed to fetch", "TypeError: Load failed"]) {
    resetState({ rpcImpl: () => ({ data: null, error: { message: msg, details: "", hint: "", code: "" } }) });
    const err = await X.collab.createTripInvite("t").then(() => null, (e) => e);
    assert.ok(err instanceof X.collab.TripInviteError, "應丟 TripInviteError");
    assert.equal(err.code, "network");
    assert.equal(X.collab.tripInviteCreateErrorKey(err), "inviteNetworkError");
  }
  // (1) 行為：經由 ensure／getOrCreate 失敗後，模組層失敗狀態＝tripInviteCreateErrorKey(實際丟出的錯誤)
  const cases = [
    ["not_trip_owner", { rpcImpl: () => ({ data: null, error: { message: "not_trip_owner", code: "42501" } }) }, "inviteNotOwner"],
    ["invite_rate_limited", { rpcImpl: () => ({ data: null, error: { message: "invite_rate_limited", code: "P0001" } }) }, "inviteRateLimited"],
    ["未登入（uid=null，不呼叫 RPC）", { uid: null, rpcImpl: () => ({ data: null, error: null }) }, "inviteNotAuthenticated"],
    ["network（postgrest 物件）", { rpcImpl: () => ({ data: null, error: { message: "TypeError: Load failed", details: "", hint: "", code: "" } }) }, "inviteNetworkError"],
    ["其他錯誤", { rpcImpl: () => ({ data: null, error: { message: "something odd", code: "P0001" } }) }, "inviteCreateFailed"],
    ["RPC 成功但無 token", { rpcImpl: () => ({ data: [], error: null }) }, "inviteCreateFailed"],
  ];
  for (const [i, [label, state, key]] of cases.entries()) {
    const Y = await freshModules();
    resetState(state);
    const id = "n10d-" + i;
    const err = await Y.collab.getOrCreateTripInviteToken(id).then(() => null, (e) => e);
    assert.ok(err, label + "：應失敗");
    assert.equal(Y.collab.peekTripInviteError(id), Y.collab.tripInviteCreateErrorKey(err), label + "：失敗狀態≠tripInviteCreateErrorKey(err)");
    assert.equal(Y.collab.peekTripInviteError(id), key, label);
    assert.equal(Y.collab.peekTripInviteToken(id), null, label);
    assert.equal(Y.collab.isTripInviteCreating(id), false, label);
  }
  // (1) 原始碼：失敗快取的每個寫入點都經由 tripInviteCreateErrorKey；模組不依賴 toast
  const collabSrc = read("src/lib/trip/trip-collab.ts");
  const failureMap = collabSrc.match(/const (\w+) = new Map<string, TripInviteCreateErrorKey>\(\)/);
  assert.ok(failureMap, "trip-collab.ts 找不到模組層失敗狀態 Map<string, TripInviteCreateErrorKey>");
  const writes = [...collabSrc.matchAll(new RegExp(failureMap[1] + "\\.set\\(([^;]*)\\);", "g"))].map((m) => m[1]);
  assert.ok(writes.length >= 1, "找不到失敗狀態寫入點");
  for (const w of writes) assert.match(w, /^\s*\w+\s*,\s*tripInviteCreateErrorKey\(/, "失敗狀態寫入未經共用函式：" + w);
  assert.doesNotMatch(collabSrc, /from "sonner"|\btoast\b/, "trip-collab.ts 不得跳 toast");
  // (2)(3) 元件
  for (const f of ["src/components/trip/TripSharePanel.tsx", "src/components/trip/TripInviteSheet.tsx"]) {
    const s = read(f);
    assert.doesNotMatch(s, /inviteNotOwner|inviteRateLimited|inviteNetworkError|inviteNotAuthenticated|inviteCreateFailed|not_trip_owner|invite_rate_limited|not_authenticated|"network"/, f + " 有自有的錯誤碼對應");
    assert.doesNotMatch(s, /tripInviteErrorCode|\bTripInviteError\b|\.code\b/, f + " 自行判讀錯誤碼");
    assert.match(s, /peekTripInviteError\(tripId\)/, f + " 未讀取模組層失敗狀態");
    assert.match(s, /retryTripInviteToken\(tripId\)/, f + " 重試未走模組層");
    assert.doesNotMatch(s, /\bcreateTripInvite\b|getOrCreateTripInviteToken/, f + " 自行呼叫 create（失敗處理應只在模組層）");
    assert.doesNotMatch(s, /setInviteError|useState<[^>]*TripInviteCreateErrorKey/, f + " 仍有元件層失敗狀態");
    // 建立失敗不得 toast：toast 呼叫不得引用邀請建立的失敗狀態／錯誤 key／create（行為面見 R10／R11 toasts=[]）
    for (const m of s.matchAll(/toast\.\w+\([^\n]*/g)) {
      assert.doesNotMatch(m[0], /inviteError|invite(NotOwner|RateLimited|NetworkError|NotAuthenticated|CreateFailed)|tripInvite|create/i, f + " 建立失敗不得 toast：" + m[0]);
    }
  }
});

// ── N11（#TW3-T4）：模組層邀請連結狀態（合併進行中、失敗共用不自動重試、重試清除並重建、依 tripId 隔離）──
function deferredN() {
  let r, j;
  const p = new Promise((a, b) => { r = a; j = b; });
  return { p, r, j };
}
const OK_ROW = { data: [{ invite_id: "i", invite_token: TOKEN }], error: null };
const FAIL_OWNER = { data: null, error: { message: "not_trip_owner", code: "42501" } };
const createCount = () => globalThis.__tw3.rpc.filter(([r]) => r === "create_trip_invite").length;
const flush = () => new Promise((r) => setTimeout(r, 0));

await check("N11a 同一 tripId 同時多次要連結（ensure×3＋getOrCreate×2）→ create 恰 1 次；建立中狀態＝true；完成後全部拿到同一連結並通知訂閱者", async () => {
  const X = await freshModules();
  const queue = [];
  resetState({ rpcImpl: (name) => { if (name !== "create_trip_invite") return { data: null, error: null }; const d = deferredN(); queue.push(d); return d.p; } });
  let notified = 0;
  const unsub = X.collab.subscribeTripInviteState(() => { notified += 1; });
  X.collab.ensureTripInviteToken("m1");
  X.collab.ensureTripInviteToken("m1");
  const g1 = X.collab.getOrCreateTripInviteToken("m1");
  X.collab.ensureTripInviteToken("m1");
  const g2 = X.collab.getOrCreateTripInviteToken("m1");
  await flush();
  assert.equal(createCount(), 1, "create 呼叫次數：" + createCount());
  assert.equal(X.collab.isTripInviteCreating("m1"), true);
  assert.equal(X.collab.peekTripInviteToken("m1"), null);
  assert.equal(X.collab.peekTripInviteError("m1"), null);
  const before = notified;
  queue[0].r(OK_ROW);
  assert.deepEqual(await Promise.all([g1, g2]), [TOKEN, TOKEN]);
  assert.equal(createCount(), 1);
  assert.equal(X.collab.isTripInviteCreating("m1"), false);
  assert.equal(X.collab.peekTripInviteToken("m1"), TOKEN);
  assert.ok(notified > before, "完成時未通知訂閱者（關閉後重開的面板會卡在載入）");
  X.collab.ensureTripInviteToken("m1");
  assert.equal(await X.collab.getOrCreateTripInviteToken("m1"), TOKEN);
  assert.equal(createCount(), 1, "已有連結仍呼叫 create");
  unsub();
});

await check("N11b 進行中失敗：所有合併呼叫者收到同一錯誤、失敗狀態寫入一次；之後 ensure 不自動重試（create 不增加）", async () => {
  const X = await freshModules();
  const queue = [];
  resetState({ rpcImpl: () => { const d = deferredN(); queue.push(d); return d.p; } });
  const g1 = X.collab.getOrCreateTripInviteToken("m2").then(() => null, (e) => e);
  const g2 = X.collab.getOrCreateTripInviteToken("m2").then(() => null, (e) => e);
  X.collab.ensureTripInviteToken("m2");
  await flush();
  assert.equal(createCount(), 1);
  queue[0].r(FAIL_OWNER);
  const [e1, e2] = await Promise.all([g1, g2]);
  assert.ok(e1 && e1 === e2, "合併呼叫者應收到同一錯誤");
  assert.equal(X.collab.peekTripInviteError("m2"), "inviteNotOwner");
  assert.equal(X.collab.isTripInviteCreating("m2"), false);
  for (let i = 0; i < 3; i++) X.collab.ensureTripInviteToken("m2");
  await flush();
  assert.equal(createCount(), 1, "已失敗卻自動重試：create=" + createCount());
  assert.equal(X.collab.peekTripInviteError("m2"), "inviteNotOwner", "失敗狀態被清除");
});

await check("N11c 重試：同步清除失敗並進入建立中（兩入口同時看到）、create 恰再 1 次；建立中重複按重試不再呼叫；成功後連結共用", async () => {
  const X = await freshModules();
  const queue = [];
  resetState({ rpcImpl: () => { const d = deferredN(); queue.push(d); return d.p; } });
  X.collab.ensureTripInviteToken("m3");
  await flush();
  queue[0].r(FAIL_OWNER);
  await flush();
  await flush();
  assert.equal(X.collab.peekTripInviteError("m3"), "inviteNotOwner");
  // 兩個入口各自的訂閱（模擬 TripInviteSheet 與 TripSharePanel 的 useSyncExternalStore）
  const snaps = { sheet: [], panel: [] };
  const read3 = () => ({ err: X.collab.peekTripInviteError("m3"), creating: X.collab.isTripInviteCreating("m3"), token: X.collab.peekTripInviteToken("m3") });
  const u1 = X.collab.subscribeTripInviteState(() => snaps.sheet.push(read3()));
  const u2 = X.collab.subscribeTripInviteState(() => snaps.panel.push(read3()));
  X.collab.retryTripInviteToken("m3");
  assert.deepEqual(read3(), { err: null, creating: true, token: null }, "重試後應立即為建立中、無錯誤");
  X.collab.retryTripInviteToken("m3");
  X.collab.ensureTripInviteToken("m3");
  await flush();
  assert.equal(createCount(), 2, "重試應恰再呼叫 1 次（建立中重複重試不得再呼叫）：" + createCount());
  // 重試期間不得出現「錯誤＋建立中」或錯誤殘留的快照
  for (const s of [...snaps.sheet, ...snaps.panel].slice(0)) assert.ok(!(s.err && s.creating), "出現錯誤與建立中並存：" + JSON.stringify(s));
  queue[1].r(OK_ROW);
  await flush();
  await flush();
  assert.deepEqual(read3(), { err: null, creating: false, token: TOKEN });
  assert.deepEqual(snaps.sheet.at(-1), snaps.panel.at(-1), "兩個訂閱者最後看到的狀態不同");
  assert.deepEqual(snaps.sheet.at(-1), { err: null, creating: false, token: TOKEN });
  X.collab.retryTripInviteToken("m3");
  await flush();
  assert.equal(createCount(), 2, "已有連結時按重試不得再呼叫");
  u1();
  u2();
});

await check("N11d 依 tripId 隔離：A 失敗不影響 B 建立；B 成功不清除 A 的失敗", async () => {
  const X = await freshModules();
  resetState({ rpcImpl: (_n, args) => (args.p_trip_id === "mA" ? FAIL_OWNER : OK_ROW) });
  X.collab.ensureTripInviteToken("mA");
  X.collab.ensureTripInviteToken("mB");
  await flush();
  await flush();
  assert.equal(X.collab.peekTripInviteError("mA"), "inviteNotOwner");
  assert.equal(X.collab.peekTripInviteToken("mA"), null);
  assert.equal(X.collab.peekTripInviteError("mB"), null);
  assert.equal(X.collab.peekTripInviteToken("mB"), TOKEN);
  assert.equal(createCount(), 2);
});

// ── N11e～N11i（#TW3-T5）：installTripInviteResetWatchers（登入狀態改變清快取；online 只清網路失敗）──
// 可觸發的 auth mock（onAuthStateChange 記錄註冊次數）＋ EventTarget 當 window（計數 online listener）。
function installWatcherEnv({ auth = "mock" } = {}) {
  const env = { registrations: 0, cbs: [], onlineAdds: 0 };
  if (auth === "mock") {
    globalThis.__tw3Auth = {
      onAuthStateChange(cb) {
        env.registrations += 1;
        env.cbs.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    };
  } else if (auth === "throws") {
    globalThis.__tw3Auth = { onAuthStateChange() { env.registrations += 1; throw new Error("auth boom"); } };
  } else if (auth === "empty") {
    globalThis.__tw3Auth = {};
  } else {
    delete globalThis.__tw3Auth;
  }
  const win = new EventTarget();
  const add = win.addEventListener.bind(win);
  win.addEventListener = (type, ...rest) => {
    if (type === "online") env.onlineAdds += 1;
    return add(type, ...rest);
  };
  globalThis.window = win;
  globalThis.__tw3Channels = [];
  env.emit = (event, uid) => {
    for (const cb of env.cbs) cb(event, uid ? { user: { id: uid } } : null);
  };
  env.online = () => win.dispatchEvent(new Event("online"));
  return env;
}
function teardownWatcherEnv() {
  delete globalThis.__tw3Auth;
  delete globalThis.window;
}
const NET_FAIL = { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
/** 依 tripId 前綴決定 create 結果：ok* 成功、own* not_trip_owner、net* 連線失敗 */
const byPrefix = (_n, args) => {
  const id = String(args?.p_trip_id ?? "");
  if (id.startsWith("own")) return FAIL_OWNER;
  if (id.startsWith("net")) return NET_FAIL;
  return OK_ROW;
};
async function settleN() {
  for (let i = 0; i < 4; i++) await flush();
}
const snapN = (X, ids) => Object.fromEntries(ids.map((id) => [id, { token: X.collab.peekTripInviteToken(id), err: X.collab.peekTripInviteError(id), creating: X.collab.isTripInviteCreating(id) }]));

await check("N11e 未登入失敗後登入（null→user）、離線失敗後恢復網路（online）→ 失敗被清除並通知；開著的面板 ensure 恰重建 1 次即成功", async () => {
  const env = installWatcherEnv();
  try {
    const X = await freshModules();
    resetState({ uid: null, rpcImpl: () => OK_ROW });
    let notified = 0;
    const unsub = X.collab.subscribeTripInviteState(() => { notified += 1; });
    env.emit("INITIAL_SESSION", null); // 首次事件：只記錄
    X.collab.ensureTripInviteToken("r1");
    await settleN();
    assert.equal(X.collab.peekTripInviteError("r1"), "inviteNotAuthenticated");
    assert.equal(createCount(), 0, "未登入不應打 RPC");
    globalThis.__tw3.uid = "user-1";
    const n0 = notified;
    env.emit("SIGNED_IN", "user-1");
    assert.equal(X.collab.peekTripInviteError("r1"), null, "登入後未清除未登入失敗");
    assert.equal(notified, n0 + 1, "登入清除後應通知訂閱者恰 1 次：" + (notified - n0));
    // 模擬面板 effect：無連結、未失敗、未建立中 → ensure；重複 render 也只建立一次
    for (let i = 0; i < 3; i++) X.collab.ensureTripInviteToken("r1");
    await settleN();
    for (let i = 0; i < 3; i++) X.collab.ensureTripInviteToken("r1");
    await settleN();
    assert.equal(createCount(), 1, "登入後自動建立應恰 1 次：" + createCount());
    assert.equal(X.collab.peekTripInviteToken("r1"), TOKEN);

    try {
      setNavigator({ onLine: false });
      globalThis.__tw3.rpcImpl = () => NET_FAIL;
      X.collab.ensureTripInviteToken("r2");
      await settleN();
    } finally {
      restoreNavigator();
    }
    assert.equal(X.collab.peekTripInviteError("r2"), "inviteNetworkError");
    assert.equal(createCount(), 2);
    globalThis.__tw3.rpcImpl = () => OK_ROW;
    X.collab.ensureTripInviteToken("r2"); // online 前：不自動重試
    await settleN();
    assert.equal(createCount(), 2, "online 前不得自動重試");
    const n1 = notified;
    env.online();
    assert.equal(X.collab.peekTripInviteError("r2"), null, "online 後未清除網路失敗");
    assert.equal(notified, n1 + 1, "online 清除後應通知恰 1 次");
    for (let i = 0; i < 3; i++) X.collab.ensureTripInviteToken("r2");
    await settleN();
    X.collab.ensureTripInviteToken("r2");
    await settleN();
    assert.equal(createCount(), 3, "恢復網路後自動建立應恰 1 次：" + createCount());
    assert.equal(X.collab.peekTripInviteToken("r2"), TOKEN);
    unsub();
  } finally {
    teardownWatcherEnv();
  }
});

await check("N11f 監聽只註冊一次：多個元件訂閱／退訂再訂閱 → onAuthStateChange 1 次、online listener 1 個；無 Realtime channel", async () => {
  const env = installWatcherEnv();
  try {
    const X = await freshModules();
    resetState({ rpcImpl: byPrefix });
    const unsubs = [];
    for (let i = 0; i < 5; i++) unsubs.push(X.collab.subscribeTripInviteState(() => {}));
    unsubs.splice(0).forEach((u) => u());
    for (let i = 0; i < 3; i++) unsubs.push(X.collab.subscribeTripInviteState(() => {}));
    assert.equal(env.registrations, 1, "onAuthStateChange 註冊次數：" + env.registrations);
    assert.equal(env.onlineAdds, 1, "online listener 數：" + env.onlineAdds);
    assert.equal(globalThis.__tw3Channels.length, 0, "訂閱邀請狀態不得建立 Realtime channel：" + JSON.stringify(globalThis.__tw3Channels));
    // 未訂閱前不安裝（純函式呼叫不註冊）
    const env2 = installWatcherEnv();
    const Y = await freshModules();
    Y.collab.peekTripInviteToken("x");
    Y.collab.ensureTripInviteToken("okX");
    await settleN();
    assert.equal(env2.registrations, 0, "未訂閱即註冊 auth 監聽");
    Y.collab.subscribeTripInviteState(() => {})();
    Y.collab.subscribeTripInviteState(() => {})();
    assert.equal(env2.registrations, 1);
    assert.equal(env2.onlineAdds, 1);
    unsubs.forEach((u) => u());
    const src = read("src/lib/trip/trip-collab.ts");
    const body = src.slice(src.indexOf("function installTripInviteResetWatchers"), src.indexOf("export function subscribeTripInviteState"));
    assert.ok(body.length > 50, "找不到 installTripInviteResetWatchers");
    assert.doesNotMatch(body, /\.channel\(|removeChannel|postgres_changes/, "watcher 不得使用 Realtime channel");
  } finally {
    teardownWatcherEnv();
  }
});

await check("N11g auth mock 缺 onAuthStateChange／auth 不存在／onAuthStateChange 丟例外 → 訂閱不 crash；online 監聽照常安裝且只清網路失敗", async () => {
  const origWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.map(String).join(" "));
  try {
    for (const mode of ["none", "empty", "throws"]) {
      const env = installWatcherEnv({ auth: mode });
      try {
        const X = await freshModules();
        resetState({ rpcImpl: byPrefix });
        let unsub;
        assert.doesNotThrow(() => { unsub = X.collab.subscribeTripInviteState(() => {}); }, mode);
        assert.doesNotThrow(() => X.collab.subscribeTripInviteState(() => {})(), mode + "（第二次）");
        assert.equal(env.onlineAdds, 1, mode + "：online listener 數＝" + env.onlineAdds);
        if (mode === "throws") assert.equal(env.registrations, 1, "丟例外後不得重試註冊：" + env.registrations);
        X.collab.ensureTripInviteToken("netG");
        await settleN();
        assert.equal(X.collab.peekTripInviteError("netG"), "inviteNetworkError", mode);
        env.online();
        assert.equal(X.collab.peekTripInviteError("netG"), null, mode + "：online 未清除網路失敗");
        unsub();
      } finally {
        teardownWatcherEnv();
      }
    }
    assert.ok(warns.some((w) => w.includes("invite auth watcher unavailable")), "onAuthStateChange 丟例外時應 warn：" + JSON.stringify(warns));
  } finally {
    console.warn = origWarn;
  }
});

await check("N11h 登入狀態轉換表：首次事件只記錄；同使用者 TOKEN_REFRESHED／USER_UPDATED／SIGNED_IN 不清；A→B、B→null、null→A 各清除連結＋失敗並通知恰 1 次；null→null 不清；online 只清網路失敗", async () => {
  const env = installWatcherEnv();
  try {
    const X = await freshModules();
    resetState({ uid: "user-A", rpcImpl: byPrefix });
    let notified = 0;
    const unsub = X.collab.subscribeTripInviteState(() => { notified += 1; });
    const IDS = ["okH", "ownH", "netH"];
    const populate = async () => {
      for (const id of IDS) X.collab.retryTripInviteToken(id); // 清掉失敗並重建（已有連結者不重建）
      await settleN();
      assert.deepEqual(snapN(X, IDS), {
        okH: { token: TOKEN, err: null, creating: false },
        ownH: { token: null, err: "inviteNotOwner", creating: false },
        netH: { token: null, err: "inviteNetworkError", creating: false },
      });
    };
    const CLEARED = Object.fromEntries(IDS.map((id) => [id, { token: null, err: null, creating: false }]));
    await populate();
    const step = (label, event, uid, expectClear) => {
      const before = snapN(X, IDS);
      const n = notified;
      env.emit(event, uid);
      if (expectClear) {
        assert.deepEqual(snapN(X, IDS), CLEARED, label + "：應清除連結與失敗");
        assert.equal(notified, n + 1, label + "：應通知恰 1 次，實際 " + (notified - n));
      } else {
        assert.deepEqual(snapN(X, IDS), before, label + "：不得清除");
        assert.equal(notified, n, label + "：不得通知");
      }
    };
    step("首次事件 INITIAL_SESSION(A)", "INITIAL_SESSION", "user-A", false);
    step("同使用者 TOKEN_REFRESHED", "TOKEN_REFRESHED", "user-A", false);
    step("同使用者 USER_UPDATED", "USER_UPDATED", "user-A", false);
    step("同使用者 SIGNED_IN（回前景重新觸發）", "SIGNED_IN", "user-A", false);
    // online：只清網路失敗、連結與其他失敗保留；無網路失敗時不通知
    {
      const n = notified;
      env.online();
      assert.deepEqual(snapN(X, IDS), {
        okH: { token: TOKEN, err: null, creating: false },
        ownH: { token: null, err: "inviteNotOwner", creating: false },
        netH: { token: null, err: null, creating: false },
      }, "online 清除範圍錯誤");
      assert.equal(notified, n + 1, "online 應通知恰 1 次");
      env.online();
      assert.equal(notified, n + 1, "沒有網路失敗時 online 不得通知");
      X.collab.ensureTripInviteToken("netH");
      await settleN();
      assert.equal(X.collab.peekTripInviteError("netH"), "inviteNetworkError");
    }
    globalThis.__tw3.uid = "user-B";
    step("A→B（換帳號）", "SIGNED_IN", "user-B", true);
    const c0 = createCount();
    for (let r = 0; r < 3; r++) for (const id of IDS) X.collab.ensureTripInviteToken(id);
    await settleN();
    for (const id of IDS) X.collab.ensureTripInviteToken(id);
    await settleN();
    assert.equal(createCount() - c0, 3, "清除後每個行程應恰自動建立 1 次（共 3），實際 " + (createCount() - c0));
    step("B→null（登出）", "SIGNED_OUT", null, true);
    step("null→null（再次登出事件）", "SIGNED_OUT", null, false);
    await populate();
    step("null→A（登入）", "SIGNED_IN", "user-A", true);
    unsub();
  } finally {
    teardownWatcherEnv();
  }
});

await check("N11i 競態：清除快取時有進行中的 create（舊帳號）→ 完成後不得把舊帳號的連結／失敗寫回新帳號的快取；新帳號應另行建立", async () => {
  const env = installWatcherEnv();
  try {
    const X = await freshModules();
    const queue = [];
    resetState({ uid: "user-A", rpcImpl: (name) => { if (name !== "create_trip_invite") return { data: null, error: null }; const d = deferredN(); queue.push(d); return d.p; } });
    const unsub = X.collab.subscribeTripInviteState(() => {});
    env.emit("INITIAL_SESSION", "user-A");
    // (1) 成功回寫
    X.collab.ensureTripInviteToken("raceOk");
    await flush();
    assert.equal(createCount(), 1);
    globalThis.__tw3.uid = "user-B";
    env.emit("SIGNED_IN", "user-B");
    const creatingAfterSwitch = X.collab.isTripInviteCreating("raceOk");
    X.collab.ensureTripInviteToken("raceOk"); // B 的面板 effect
    await flush();
    const createsForB = createCount() - 1;
    queue[0].r({ data: [{ invite_id: "iA", invite_token: "TOKEN_OF_USER_A" }], error: null });
    await settleN();
    const okAfter = snapN(X, ["raceOk"]).raceOk;
    // (2) 失敗回寫：A 的請求在登出後失敗（not_authenticated），B 登入後仍看到該失敗、不會自動重建
    globalThis.__tw3.uid = "user-A";
    env.emit("SIGNED_IN", "user-A");
    X.collab.ensureTripInviteToken("raceFail");
    await flush();
    const failIdx = queue.length - 1;
    globalThis.__tw3.uid = null;
    env.emit("SIGNED_OUT", null);
    globalThis.__tw3.uid = "user-B";
    env.emit("SIGNED_IN", "user-B");
    queue[failIdx].r({ data: null, error: { message: "not_authenticated", code: "28000" } });
    await settleN();
    const failAfter = snapN(X, ["raceFail"]).raceFail;
    info("N11i 換帳號時進行中：isCreating=" + creatingAfterSwitch + "、B 的 ensure 新建 create 次數=" + createsForB +
      "；A 完成後 raceOk=" + JSON.stringify(okAfter) + "；A 失敗後 raceFail=" + JSON.stringify(failAfter));
    assert.notEqual(okAfter.token, "TOKEN_OF_USER_A", "換帳號後，舊帳號進行中的 create 完成時把 A 的邀請連結寫回快取，B 開面板會看到並分享 A 建立的連結");
    assert.notEqual(failAfter.err, "inviteNotAuthenticated", "換帳號後，舊帳號進行中的 create 失敗被寫回失敗快取，B 的面板顯示「請先登入」且不自動重建");
    unsub();
  } finally {
    teardownWatcherEnv();
  }
});
await check("N10e 加入邀請頁：accept／preview 的 network 錯誤訊息＝未知錯誤的 fallback（與新增 network 前相同）、不對應任何失效狀態", async () => {
  const X = await freshModules();
  const c = X.copy.getTripWorkspaceCopy("zh-TW");
  for (const [fn, fallback] of [["acceptTripInvite", c.inviteJoinFailed], ["getTripInvitePreview", c.inviteLoadFailed]]) {
    resetState({ rpcImpl: () => ({ data: null, error: { message: "something odd", code: "P0001" } }) });
    const base = await X.collab[fn](TOKEN).then(() => null, (e) => e);
    resetState({ rpcImpl: () => ({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } }) });
    const net = await X.collab[fn](TOKEN).then(() => null, (e) => e);
    assert.equal(base.message, fallback, fn + " 基準");
    assert.equal(net.message, base.message, fn + " network 訊息改變");
    assert.equal(X.collab.tripInviteStateFromErrorCode(X.collab.tripInviteErrorCode(net)), null, fn + " network 不得對應失效狀態");
  }
  // 行為差異（資訊）：離線且伺服端回中文訊息時，舊版會顯示該中文訊息，新版改為 fallback
  resetState({ rpcImpl: () => ({ data: null, error: { message: "自訂中文錯誤", code: "P0001" } }) });
  const online = await X.collab.acceptTripInvite(TOKEN).then(() => null, (e) => e);
  let offline;
  try {
    setNavigator({ onLine: false });
    offline = await X.collab.acceptTripInvite(TOKEN).then(() => null, (e) => e);
  } finally {
    restoreNavigator();
  }
  info(`accept 回中文訊息：線上 → 「${online.message}」；navigator.onLine=false → 「${offline.message}」（code=${offline.code}）`);
});

// ───────────────────────── Part R：瀏覽器真實 render ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

const W = "window.__tw";
const webMocks = {
  "@tanstack/react-router": `const NAV=(o)=>{${W}.nav.push(o);return Promise.resolve();};
const ROUTER={history:{canGoBack:()=>false,back(){}},subscribe:()=>()=>{}};
export const useNavigate=()=>NAV;export const useRouter=()=>ROUTER;
export const useRouterState=({select})=>select({location:{pathname:${W}.path}});
export const createFileRoute=(p)=>(o)=>({path:p,options:o,useParams:()=>({token:${W}.token})});`,
  "@/hooks/use-i18n": `export const useI18n=()=>({locale:${W}.locale,t:(k)=>k});export const I18nProvider=({children})=>children;`,
  sonner: `export const toast={success:(m)=>${W}.toasts.push('success:'+m),error:(m)=>${W}.toasts.push('error:'+m)};`,
  "@/components/MobileFrame": `export const MobileFrame=({children})=><div data-frame="">{children}</div>;`,
  "@/lib/auth-action": `export const requireAuthForAction=(a)=>{${W}.authRequired.push(a);return false;};`,
  "@/integrations/supabase/client": `export const supabase={
  rpc:(name,args)=>{${W}.rpc.push([name,args]);return ${W}.rpcImpl(name,args);},
  from:(t)=>{${W}.from.push(t);const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:null})};return q;},
};export const isSupabaseConfigured=()=>true;`,
  // 記下 AuthProvider 訂閱的 callback，R6c 以 SIGNED_IN 模擬登入完成（StrictMode 下保留最後一個有效訂閱）
  "@/lib/supabase": `export const supabase={auth:{onAuthStateChange:(cb)=>{const sub={active:true,unsubscribe(){sub.active=false;}};(${W}.authSubs||(${W}.authSubs=[])).push({cb,sub});return {data:{subscription:sub}};}}};`,
  "@/lib/auth-session": `export const getAuthenticatedUserId=async()=>${W}.session?.user?.id??null;
export const readCachedAuthenticatedUserIdSync=()=>${W}.session?.user?.id??null;
export const getClientAuthSession=async()=>${W}.session;
export const updateClientAuthSessionCache=()=>{};export const markClientAuthSessionSettledUnauthenticated=()=>{};`,
  "@/lib/auth-oauth": `export const hasOAuthCallbackParams=()=>false;`,
  "@/lib/auth-debug": `export const logAuthDebug=()=>{};`,
  "@/lib/auth-boot-log": `export const logAuthBoot=()=>{};`,
  "@/lib/auth-restore": `export const AUTH_RESTORE_TIMEOUT={nativeMs:5000};`,
  "@/lib/clear-auth-state": `export const clearAuthState=async()=>{};`,
  "@/lib/supabase-auth-storage": `export const warmSupabaseAuthStorage=async()=>{};export const resetWarmSupabaseAuthStorage=()=>{};`,
  "@/services/platform": `export const detectPlatform=()=>({isCapacitor:false,isIOS:false,isNative:false,kind:'web'});`,
  "@/lib/startup-path": `export const isLoginColdStartPath=()=>false;export const readBrowserPathname=()=>${W}.path;`,
  "@/lib/onboarding-storage": `export const isOnboardingCompletedSync=()=>false;export const isOnboardingHydrated=()=>true;`,
  "@/lib/copy-to-clipboard": `export async function copyTextToClipboard(){return 'copied';}`,
  "@/lib/i18n/effective-app-locale": `export const effectiveAppLocale=()=>${W}.locale;`,
  "@/lib/itinerary-storage": `export const SAVED_TRIPS_CHANGED_EVENT='roamie:saved-trips-changed';`,
  "@/services/placeImageService": `export const getRoamieDefaultImage=()=>'data:image/gif;base64,R0lGODlhAQABAAAAACw=';`,
  "@/lib/log-error": `export const logAppError=()=>{};export const logAppErrorDetail=()=>{};export const formatErrorDetail=()=>'';`,
  "@/components/RoamieAppErrorFallback": `export const RoamieAppErrorFallback=(p)=><div data-crash="">{String(p?.error?.message??'crash')}</div>;`,
  // App.tsx 外殼：OnboardingGate／AppProviders 以最小替身表示（AppProviders 真實版本以 AuthProvider 包住子樹）
  "@/components/OnboardingGate": `export const OnboardingGate=({children})=><div data-gate="">{children}</div>;`,
  "@/providers/AppProviders": `import {AuthProvider} from '@/hooks/use-auth';export const AppProviders=({children})=><div data-app-providers=""><AuthProvider>{children}</AuthProvider></div>;`,
  "@/hooks/use-ios-interactive-route": `export const useIosInteractiveRoute=()=>{};`,
  "@/lib/app-boot-log": `export const logAppBoot=()=>{};export const logAppBootSnapshot=async()=>{};`,
  "@/lib/startup-boot-state": `export const logAppRemountSource=()=>{};export const shouldLogAppMounted=()=>false;`,
};

const webEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {App} from '@/App';
import {AuthProvider} from '@/hooks/use-auth';
import {Route} from '@/routes/trip-invite.$token';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};
Object.defineProperty(Navigator.prototype,'onLine',{configurable:true,get:()=>!(window.__tw&&window.__tw.offline)});
const Page=Route.options.component;
let rootEl=null;
function deferred(){let r,j;const p=new Promise((a,b)=>{r=a;j=b;});return {p,r,j};}
window.mount=(o)=>{
  if(rootEl){flushSync(()=>rootEl.render(null));rootEl.unmount();rootEl=null;}
  sessionStorage.clear();
  const accept=[];
  ${W}={nav:[],toasts:[],authRequired:[],rpc:[],from:[],offline:!!o.offline,locale:o.locale||'zh-TW',token:o.token,path:o.path||('/trip-invite/'+o.token),
    session:o.loggedIn?{access_token:'t',user:{id:'user-1'}}:null,accept,
    rpcImpl:(name,args)=>{
      if(name==='get_trip_invite_preview'){const pe=(o.previewErrors||[]).shift();return Promise.resolve(pe?{data:null,error:pe}:{data:[o.preview],error:null});}
      if(name==='accept_trip_invite'){const d=deferred();accept.push(d);return d.p;}
      return Promise.resolve({data:null,error:null});
    }};
  document.getElementById('root').innerHTML='';
  rootEl=createRoot(document.getElementById('root'));
  const tree=o.shell==='app'?<App><Page/></App>:<AuthProvider><Page/></AuthProvider>;
  flushSync(()=>rootEl.render(<StrictMode>{tree}</StrictMode>));
  return true;
};
window.resolveAccept=(i,v)=>{${W}.accept[i].r(v);return true;};
// 模擬登入完成：session 寫入（getAuthenticatedUserId 讀它）並對有效訂閱發出 SIGNED_IN
window.signIn=()=>{${W}.session={access_token:'t-login',user:{id:'user-1'}};const live=(${W}.authSubs||[]).filter(s=>s.sub.active);live.forEach(s=>s.cb('SIGNED_IN',${W}.session));return live.length;};
const q=s=>document.querySelector(s);const qa=s=>[...document.querySelectorAll(s)];
window.buttons=()=>qa('button').map(b=>({text:b.textContent.trim(),disabled:b.disabled}));
window.click=(text)=>{const b=qa('button').find(x=>x.textContent.trim()===text);if(!b)return 'missing';if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
// 使用者連點：兩次點擊是兩個獨立事件（中間有 task 邊界）
window.clickTwice=(text)=>new Promise((res)=>{const b=qa('button').find(x=>x.textContent.trim()===text);if(!b)return res('missing');b.click();setTimeout(()=>{b.click();res('ok');},0);});
// 同一 task 內同步派送兩次 click（極端情況，僅資訊）
window.clickTwiceSync=(text)=>{const b=qa('button').find(x=>x.textContent.trim()===text);if(!b)return 'missing';b.click();b.click();return 'ok';};
window.state=()=>({
  text:q('#root').textContent,
  h1:q('h1')?.textContent??null,
  buttons:window.buttons(),
  gate:!!q('[data-gate]'),providers:!!q('[data-app-providers]'),crash:!!q('[data-crash]'),
  rpc:${W}.rpc.map(r=>r[0]),acceptCalls:${W}.rpc.filter(r=>r[0]==='accept_trip_invite').map(r=>r[1]),
  previewCalls:${W}.rpc.filter(r=>r[0]==='get_trip_invite_preview').length,
  nav:${W}.nav,toasts:${W}.toasts,authRequired:${W}.authRequired,
  stash:sessionStorage.getItem('roamie:pending-trip-invite-token'),
});
window.__ready=true;`;

const VALID = { state: "valid", trip_title: "京都楓葉之旅", date_start: "2026-11-20", date_end: "2026-11-23", cover_url: null, inviter_display_name: "Amy", member_count: 3 };
const TRIP_ID = "11111111-2222-4333-8444-555555555555";

// ── 行程詳情 fixture（#TW3-T2 a／b／c）：真實 TripDetailScreen＋TripWorkspaceOverview＋TripSharePanel＋
//    TripInviteSheet＋trip-collab＋saved-list-snapshot；只 mock 外部邊界（supabase client、auth-session、
//    itinerary-storage、router、toast）與無關的重元件（行程編輯器、地圖、頭像）。
const TD = "window.__td";
const detailMocks = {
  "@/hooks/use-duo-layout": `const L={navPlacement:'bottom',tripLayout:'single',usableWidth:390};export const useDuoLayout=()=>L;`,
  "@/hooks/use-duo-laptop": `const L={laptop:false};export const useDuoLaptop=()=>L;`,
  // t 必須是穩定參照（真實 useI18n 以 useCallback 回傳）；每次 render 回新函式會讓 TripSharePanel 的
  // refreshMembers／channel effect 每次 render 重跑（#TW3-T5 量到 2476 次 channel 建立，屬 fixture 假象）
  "@/hooks/use-i18n": `const T=(k)=>k;export const useI18n=()=>({locale:${TD}.locale,t:T});export const I18nProvider=({children})=>children;`,
  "@tanstack/react-router": `const NAV=(o)=>{${TD}.nav.push(o);return Promise.resolve();};
const ROUTER={subscribe:()=>()=>{},history:{canGoBack:()=>false,back(){}}};
export const useNavigate=()=>NAV;export const useRouter=()=>ROUTER;
export const useRouterState=({select})=>select({location:{pathname:'/saved/x',searchStr:''}});`,
  sonner: `export const toast={success:(m)=>${TD}.toasts.push('success:'+m),error:(m)=>${TD}.toasts.push('error:'+m)};`,
  "@/lib/itinerary-storage": `export const SAVED_TRIPS_CHANGED_EVENT='roamie:saved-trips-changed';
export const getItinerary=(id)=>{${TD}.getItinerary.push(id);return ${TD}.itinImpl(id);};export const listItineraries=async()=>[];`,
  "@/lib/trip/use-trip-realtime": `export const useTripRealtimeSync=()=>{};`,
  "@/lib/saved-trip/delete-trip": `export const deleteTrip=async()=>{};`,
  "@/components/trip/TripWorkspaceMap": `export const TripWorkspaceMap=()=>null;`,
  "@/components/profile/ProfileAvatar": `export const ProfileAvatar=()=> <span data-avatar=""/>;`,
  // useLayoutEffect（無 deps）：每次 commit 都記一幀（在 passive effect 之前，抓得到 effect 修正前的中間 commit）
  "@/components/saved/SavedTripItineraryEditor": `import {useLayoutEffect} from 'react';
export function SavedTripItineraryEditor(p){useLayoutEffect(()=>{if(window.__td&&window.__td.frames)window.recordFrame('commit');});const ctx={dayGroups:[],openPlaceDetail(){},selectDay(){}};
 return <div data-editor-root="" data-trip-id={p.stored?.id}><div data-header-right="">{p.headerRight}</div>{p.workspaceBar}{typeof p.workspaceContent==='function'?p.workspaceContent(ctx):p.workspaceContent}</div>;}`,
  "@/integrations/supabase/client": `function chain(t){const q={};for(const m of ['select','eq','neq','in','order','limit','is','match','filter'])q[m]=()=>q;
 q.maybeSingle=()=>Promise.resolve(${TD}.fromImpl(t,'single'));q.single=q.maybeSingle;
 q.then=(a,b)=>Promise.resolve(${TD}.fromImpl(t,'list')).then(a,b);return q;}
export const supabase={rpc:(n,a)=>{${TD}.rpc.push([n,a]);return Promise.resolve(${TD}.rpcImpl(n,a));},
 from:(t)=>{${TD}.from.push(t);return chain(t);},
 auth:{onAuthStateChange:(cb)=>{(window.__authCbs||(window.__authCbs=[])).push(cb);return {data:{subscription:{unsubscribe(){}}}};}},
 channel:(...a)=>{(window.__channels||(window.__channels=[])).push(a);const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{}};
export const isSupabaseConfigured=()=>true;`,
  // 以下：其餘 export 沿用真實模組，只覆寫邊界函式（本地 export 優先於 export *）
  "@/lib/auth-session": `export * from ${JSON.stringify(path.join(root, "src/lib/auth-session.ts"))};
export const getAuthenticatedUserId=async()=>${TD}.uid;export const readCachedAuthenticatedUserIdSync=()=>${TD}.uid;`,
  "@/services/platform": `export * from ${JSON.stringify(path.join(root, "src/services/platform/index.ts"))};
export const detectPlatform=()=>({isCapacitor:false,isIOS:false,isNative:false,kind:'web'});`,
  "@/lib/copy-to-clipboard": `export * from ${JSON.stringify(path.join(root, "src/lib/copy-to-clipboard.ts"))};
export async function copyTextToClipboard(t){if(window.__td)(window.__td.copies||(window.__td.copies=[])).push(String(t));return 'copied';}`,
  "@/lib/open-external-url": `export * from ${JSON.stringify(path.join(root, "src/lib/open-external-url.ts"))};export const openExternalUrl=async()=>true;`,
  "@/lib/i18n/effective-app-locale": `export * from ${JSON.stringify(path.join(root, "src/lib/i18n/effective-app-locale.ts"))};export const effectiveAppLocale=()=>${TD}.locale;`,
  "@/lib/log-error": `export * from ${JSON.stringify(path.join(root, "src/lib/log-error.ts"))};
export const logAppError=()=>{};export const logAppErrorDetail=()=>{};`,
  "@/hooks/use-workspace-swipe": `export const useWorkspaceSwipe=()=>{};export const WORKSPACE_PANE_STYLE={};`,
  "@tanstack/react-start": `const chain=()=>{const f=async()=>{throw new Error('server fn not available in verify');};
for(const m of ['inputValidator','validator','middleware','handler','server','client'])f[m]=()=>f;return f;};
export const createServerFn=()=>chain();export const createMiddleware=()=>chain();export const createStart=()=>({});
export const useServerFn=(f)=>f;`,
  "@tanstack/react-start/server": `export const getRequest=()=>null;`,
};
const detailEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TripDetailScreen} from '@/components/trip/TripDetailScreen';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
Object.defineProperty(Navigator.prototype,'onLine',{configurable:true,get:()=>!(window.__td&&window.__td.offline)});
let rootEl=null;
function deferred(){let r,j;const p=new Promise((a,b)=>{r=a;j=b;});return {p,r,j};}
const PAYLOAD={itinerary:[],tripSettings:{startDate:'2026-11-20',endDate:'2026-11-22'},destination:'京都'};
window.mountDetail=(o)=>{
  if(rootEl){flushSync(()=>rootEl.render(null));rootEl.unmount();rootEl=null;}
  localStorage.clear();sessionStorage.clear();
  const td={nav:[],toasts:[],rpc:[],from:[],getItinerary:[],gates:[],locale:o.locale||'zh-TW',uid:'user-1',
    offline:!!o.offline,access:o.access||'owner',createQueue:(o.createQueue||[]).slice()};
  const accessRes=(t,kind)=>{
    if(t==='saved_trips'&&kind==='single')return {data:td.access==='owner'?{user_id:'user-1'}:td.access==='gone'?null:{user_id:'owner-x'},error:null};
    if(t==='trip_members'&&kind==='single')return {data:td.access==='member'?{is_owner:false,status:'accepted'}:null,error:null};
    return {data:kind==='single'?null:[],error:null};
  };
  td.fromImpl=(t,kind)=>{
    if(td.opts.gateAccess&&t==='saved_trips'&&kind==='single'){const d=deferred();td.gates.push(d);return d.p.then(()=>accessRes(t,kind));}
    // 旅伴列表（listTripMembers 的 join 查詢）：依當下 tripId 回傳 membersFor[tripId] 位成員
    if(t==='trip_members'&&kind==='list'){const id=td.opts.tripId;const n=(td.opts.membersFor||{})[id]||0;
      return {data:Array.from({length:n},(_,i)=>({id:'m'+i+'-'+id,trip_id:id,user_id:'u'+i,is_owner:i===0,status:'accepted',invited_by:null,created_at:'2026-10-01T00:00:00Z',
        profiles:{id:'u'+i,display_name:'Mem'+i,avatar_url:null,updated_at:null}})),error:null};}
    return accessRes(t,kind);
  };
  td.opts=o;td.watch=o.watch||[];
  td.itinImpl=(id)=>{const o=td.opts;return o.itinError?Promise.reject(new Error(o.itinError)):Promise.resolve(o.row===false?null:
    {id,user_id:'user-1',title:'京都三日',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',payload:PAYLOAD});};
  td.createDefers=[];
  td.rpcImpl=(n)=>{
    if(n==='create_trip_invite'){const next=td.createQueue.shift();
      if(next==='defer'){const d=deferred();td.createDefers.push(d);return d.p;}
      return next??{data:[{invite_id:'i-'+o.tripId,invite_token:'TK'+o.tripId.slice(-6)}],error:null};}
    return {data:[],error:null};
  };
  window.__td=td;
  if(o.snapshot)localStorage.setItem('roamie:saved-list-snapshot:'+(o.snapshot.user||'user-1'),JSON.stringify({version:1,ownerUserId:o.snapshot.user||'user-1',updatedAt:'2026-10-01T00:00:00Z',places:[],trips:o.snapshot.trips}));
  document.getElementById('root').innerHTML='';
  // 逐次 commit 記錄畫面（MutationObserver：每次 React commit 後的 DOM 狀態）
  td.frames=[];
  if(window.__frameObs)window.__frameObs.disconnect();
  window.__frameObs=new MutationObserver(()=>window.recordFrame('mut'));
  window.__frameObs.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true,attributes:true});
  rootEl=createRoot(document.getElementById('root'));
  flushSync(()=>rootEl.render(<StrictMode><TripDetailScreen tripId={o.tripId} navSource="verify" initialView={o.view}/></StrictMode>));
  window.recordFrame('mount');
  return true;
};
window.recordFrame=(tag)=>{const td=window.__td;const root=document.getElementById('root');const text=root.textContent;
  const editorIds=qa('#root [data-editor-root]').map(e=>e.getAttribute('data-trip-id'));
  td.frames.push({tag,tripId:td.opts.tripId,notFound:text.includes('找不到這個行程')||text.includes('productionUi.p3b14a9fe8c'),
    editorIds,spin:!!root.querySelector('.animate-spin'),blank:!editorIds.length&&!root.querySelector('.animate-spin'),toasts:td.toasts.length,
    watch:(td.watch||[]).filter(s=>text.includes(s))});return true;};
// 不卸載、改變 tripId（同一個 TripDetailScreen 實例；路由未以 tripId 當 key）
window.rerenderDetail=(o)=>{const td=window.__td;td.opts={...td.opts,...o};if(o.access)td.access=o.access;
  flushSync(()=>rootEl.render(<StrictMode><TripDetailScreen tripId={td.opts.tripId} navSource="verify" initialView={td.opts.view}/></StrictMode>));
  window.recordFrame('rerender');return true;};
window.resolveCreate=(i,v)=>{window.__td.createDefers[i].r(v);return true;};
window.emitAuth=(event,uid)=>{const cbs=window.__authCbs||[];for(const cb of cbs)cb(event,uid?{user:{id:uid}}:null);return cbs.length;};
window.emitOnline=()=>{window.dispatchEvent(new Event('online'));return true;};
window.resolveGates=(access)=>{const td=window.__td;if(access)td.access=access;const g=td.gates.splice(0);g.forEach(d=>d.r());return g.length;};
const q=s=>document.querySelector(s);const qa=s=>[...document.querySelectorAll(s)];
const findBtn=(t)=>qa('button').find(b=>b.textContent.trim()===t||b.getAttribute('aria-label')===t);
window.dclick=(t)=>{const b=findBtn(t);if(!b)return 'missing';if(b.disabled)return 'disabled';flushSync(()=>b.click());return 'clicked';};
window.descape=()=>{const el=document.activeElement||document.body;el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));return true;};
window.dstate=()=>{const td=window.__td;return {
  text:document.body.textContent,
  editor:!!q('[data-editor-root]'),
  settled:!!q('[data-editor-root]')||td.nav.length>0||!q('#root .animate-spin'),
  buttons:qa('button').map(b=>({text:b.textContent.trim(),label:b.getAttribute('aria-label'),disabled:b.disabled})),
  alerts:qa('[role=alert]').map(e=>e.textContent.trim()),
  dialogs:qa('[role=dialog]').map(e=>e.textContent.trim().slice(0,300)),
  nav:td.nav,toasts:td.toasts,from:td.from,rpc:td.rpc.map(r=>r[0]),
  create:td.rpc.filter(r=>r[0]==='create_trip_invite').length,getItinerary:td.getItinerary.length,
  dialogSpin:qa('[role=dialog] .animate-spin').length,frames:td.frames,copies:td.copies||[],
  sharePanel:(()=>{const d=qa('[role=dialog]').find(e=>e.textContent.includes('productionUi.peb328f809b'));if(!d)return null;
    return {text:d.textContent,spin:d.querySelectorAll('.animate-spin').length,
      buttons:[...d.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),label:b.getAttribute('aria-label'),disabled:b.disabled})),
      alerts:[...d.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim())};})(),
}};
window.__dready=true;`;

async function runDetailChecks({ evaluate, sleep, port, call }) {
  await call("Page.navigate", { url: `http://127.0.0.1:${port}/detail.html` });
  for (let i = 0; i < 100 && !(await evaluate("!!window.__dready").catch(() => false)); i++) await sleep(100);
  const ready = await evaluate("!!window.__dready").catch(() => false);
  await check("R8-0 行程詳情 fixture 載入（真實 TripDetailScreen）", () => assert.ok(ready, "detail fixture 未載入"));
  if (!ready) return;
  const ZH = M.copy.getTripWorkspaceCopy("zh-TW");
  const EN = M.copy.getTripWorkspaceCopy("en");
  const NOT_FOUND = "找不到這個行程";
  const SHARE = "productionUi.pd50e0839b9";
  const TRASH = "productionUi.p045efb886f";
  const LEAVE_NAV = [{ to: "/saved", search: { tab: "trips" }, replace: true }];
  const U = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const dst = () => evaluate("window.dstate()");
  const dclick = (t) => evaluate(`window.dclick(${JSON.stringify(t)})`);
  const mountD = async (o) => {
    await evaluate(`window.mountDetail(${JSON.stringify(o)})`);
    for (let i = 0; i < 80; i++) {
      if ((await dst()).settled) break;
      await sleep(25);
    }
    await sleep(200);
    return dst();
  };
  const b = (s, t) => s.buttons.find((x) => x.text === t || x.label === t) ?? null;
  // 分享面板（「邀請共編」Sheet）範圍內的按鈕；總覽分頁本身也有「邀請成員」，必須限定在面板內
  const sb = (s, t) => (s.sharePanel ? b(s.sharePanel, t) : null);
  // 使用者要求：分享面板不顯示「邀請連結」標題與邀請網址（任何狀態）
  const OWNER_PANEL_SNAPS = [];
  const noInviteUrl = (s, where) => {
    assert.ok(s.sharePanel, where + "：分享面板未開啟");
    assert.ok(!s.sharePanel.text.includes(URL_PREFIX), where + "：分享面板顯示了邀請網址：" + s.sharePanel.text.slice(0, 300));
    // 準備中文案「建立邀請連結中…」與錯誤文案（如「建立邀請連結太頻繁…」）本身含「邀請連結」四字：
    // 先移除這些合法文案，剩餘文字不得再出現「邀請連結」（即標題已移除）
    const residual = [ZH.inviteLinkLoading, ...s.sharePanel.alerts].reduce((t, x) => t.split(x).join(""), s.sharePanel.text);
    assert.ok(!residual.includes(ZH.inviteLinkTitle), where + "：分享面板顯示了「" + ZH.inviteLinkTitle + "」標題");
    assert.ok(!s.text.includes(URL_PREFIX), where + "：畫面上出現邀請網址");
  };
  // 「連結已就緒」等價訊號：面板內「邀請成員」可按、無載入圖示、無錯誤、無準備中文案、且不含網址
  const shareReady = (s, where) => {
    noInviteUrl(s, where);
    assert.deepEqual(sb(s, ZH.inviteMembers)?.disabled, false, where + "：分享面板「邀請成員」應可按：" + JSON.stringify(s.sharePanel.buttons));
    assert.equal(sb(s, ZH.inviteLinkLoading), null, where + "：連結已就緒卻仍顯示準備中");
    assert.equal(s.sharePanel.spin, 0, where + "：連結已就緒卻仍有載入圖示");
    assert.deepEqual(s.sharePanel.alerts, [], where + "：連結已就緒卻仍顯示錯誤");
  };
  const ownerSnap = (label, s) => {
    OWNER_PANEL_SNAPS.push([label, s]);
    return s;
  };
  const shared = (id) => ({ trips: [{ id, title: "京都", isOwner: false }] });
  const owned = (id) => ({ trips: [{ id, title: "京都", isOwner: true }] });

  // ── (a) 被移除成員提示 ──
  const base = await mountD({ tripId: U(3), row: false, access: "gone" });
  const a1 = await mountD({ tripId: U(1), row: false, access: "gone", snapshot: shared(U(1)) });
  await check("R8a 冷啟動：快照標示非擁有＋讀不到＋非成員 → toast「你已不在此行程中」恰 1 次、replace 回 /saved?tab=trips、不顯示找不到", () => {
    assert.deepEqual(a1.toasts, ["error:" + ZH.removedFromTrip]);
    assert.deepEqual(a1.nav, LEAVE_NAV);
    assert.ok(!a1.text.includes(NOT_FOUND), a1.text.slice(0, 200));
  });
  await check("R8a' 被移除判定不新增網路呼叫：supabase 呼叫序列與「無快照、找不到」對照組完全相同、rpc 0", () => {
    assert.deepEqual(a1.from, base.from, "from 呼叫不同：" + JSON.stringify({ removed: a1.from, baseline: base.from }));
    assert.deepEqual(a1.rpc, []);
    assert.equal(a1.getItinerary, base.getItinerary);
    info("冷啟動 StrictMode 載入：getItinerary " + a1.getItinerary + " 次、supabase.from " + JSON.stringify(a1.from));
  });
  await check("R8b 對照：無快照＋讀不到 → 「找不到這個行程」、不導向、無 toast", () => {
    assert.ok(base.text.includes(NOT_FOUND), base.text.slice(0, 200));
    assert.deepEqual(base.nav, []);
    assert.deepEqual(base.toasts, []);
  });
  const a2 = await mountD({ tripId: U(2), row: false, access: "gone", snapshot: owned(U(2)) });
  await check("R8c 快照標示擁有（自己刪掉的行程）＋讀不到 → 「找不到這個行程」、不導向", () => {
    assert.ok(a2.text.includes(NOT_FOUND), a2.text.slice(0, 200));
    assert.deepEqual(a2.nav, []);
    assert.deepEqual(a2.toasts, []);
  });
  const a4 = await mountD({ tripId: U(4), row: false, access: "member", snapshot: shared(U(4)) });
  await check("R8d 邊界：快照非擁有＋讀不到但仍是成員 → 「找不到這個行程」（不誤判被移除）", () => {
    assert.ok(a4.text.includes(NOT_FOUND), a4.text.slice(0, 200));
    assert.deepEqual(a4.nav, []);
  });
  const a5 = await mountD({ tripId: U(5), row: false, access: "gone", snapshot: { user: "user-2", ...shared(U(5)) } });
  await check("R8e 邊界：快照屬於其他帳號 → 不採用，「找不到這個行程」", () => {
    assert.ok(a5.text.includes(NOT_FOUND), a5.text.slice(0, 200));
    assert.deepEqual(a5.nav, []);
  });
  for (const [n, msg] of [[6, "permission denied for table saved_trips"], [7, "new row violates row-level security policy for table \"saved_trips\""], [8, "code 42501"]]) {
    const s = await mountD({ tripId: U(n), itinError: msg, access: "gone" });
    await check(`R8f 權限拒絕錯誤（無快取、無快照）「${msg.slice(0, 30)}」→ 一律提示被移除並回列表`, () => {
      assert.deepEqual(s.toasts, ["error:" + ZH.removedFromTrip]);
      assert.deepEqual(s.nav, LEAVE_NAV);
    });
  }
  const a9 = await mountD({ tripId: U(9), itinError: "boom", access: "gone", snapshot: shared(U(9)) });
  await check("R8g 其他讀取錯誤（非權限）→ 顯示錯誤、不導向、不提示被移除", () => {
    assert.ok(a9.text.includes("boom"), a9.text.slice(0, 200));
    assert.deepEqual(a9.nav, []);
    assert.deepEqual(a9.toasts, []);
  });
  // 熱快取：先成功載入（成員），再讀不到且已非成員 → 被移除；之後（快取已清）無快照再讀不到 → 找不到
  await mountD({ tripId: U(10), access: "member" });
  const h1 = await mountD({ tripId: U(10), row: false, access: "gone" });
  const h2 = await mountD({ tripId: U(10), row: false, access: "gone" });
  await check("R8h 熱快取被移除 → 提示並回列表；快取已清除，下次讀不到為「找不到這個行程」", () => {
    assert.deepEqual(h1.toasts, ["error:" + ZH.removedFromTrip]);
    assert.deepEqual(h1.nav, LEAVE_NAV);
    assert.ok(h2.text.includes(NOT_FOUND), h2.text.slice(0, 200));
    assert.deepEqual(h2.nav, []);
  });
  const a11 = await mountD({ tripId: U(11), row: false, access: "gone", snapshot: shared(U(11)), locale: "en" });
  await check("R8i 被移除提示走 i18n（en）", () => {
    assert.deepEqual(a11.toasts, ["error:" + EN.removedFromTrip]);
  });

  // ── (c) isOwner 未知／false／true ──
  const o1 = await mountD({ tripId: U(20), access: "owner", view: "overview" });
  const o1click = await dclick(ZH.inviteMembers);
  await sleep(200);
  const o1b = await dst();
  await check("R9a 擁有者：總覽顯示「邀請成員」、刪除鈕顯示；未點擊 create 0 次；點擊後開啟邀請面板、create 恰 1 次", () => {
    assert.ok(o1.editor, "未載入：" + o1.text.slice(0, 200));
    assert.deepEqual(b(o1, ZH.inviteMembers)?.disabled, false, JSON.stringify(o1.buttons));
    assert.ok(b(o1, TRASH), "擁有者應顯示刪除鈕");
    assert.equal(o1.create, 0, "未點擊就呼叫了 create_trip_invite");
    assert.equal(o1click, "clicked");
    assert.ok(o1b.dialogs.some((d) => d.includes(ZH.inviteOptionCopy)), "邀請面板未開啟：" + JSON.stringify(o1b.dialogs));
    assert.equal(o1b.create, 1);
  });
  // 記憶體快取命中：行程先顯示、權限查詢中（未知）
  const u0 = await mountD({ tripId: U(20), access: "member", view: "overview", gateAccess: true });
  const shareWhileUnknown = await dclick(SHARE);
  await sleep(150);
  const u1 = await dst();
  await evaluate("window.resolveGates()");
  await sleep(250);
  const u2 = await dst();
  await check("R9b isOwner 未知（快取命中、權限查詢中）：不顯示「邀請成員」與刪除鈕、create 0；連分享面板開著也不建立連結", () => {
    assert.ok(u0.editor, "快取命中應立即顯示行程");
    assert.equal(b(u0, ZH.inviteMembers), null, "未知時顯示了邀請成員：" + JSON.stringify(u0.buttons));
    assert.equal(b(u0, TRASH), null, "未知時顯示了刪除鈕");
    assert.equal(shareWhileUnknown, "clicked");
    assert.equal(u1.create, 0, "權限未知時呼叫了 create");
    // 分享面板確實開著（否則以下「看不到」沒有鑑別力），且面板內沒有邀請成員按鈕／準備中狀態／錯誤／網址
    assert.ok(u1.sharePanel, "分享面板未開啟：" + JSON.stringify(u1.dialogs));
    assert.equal(sb(u1, ZH.inviteMembers), null, "權限未知時分享面板顯示了「邀請成員」：" + JSON.stringify(u1.sharePanel.buttons));
    assert.equal(sb(u1, ZH.inviteLinkLoading), null, "權限未知時分享面板顯示了準備中按鈕");
    assert.deepEqual(u1.sharePanel.alerts, []);
    assert.ok(!u1.text.includes(URL_PREFIX), "權限未知時出現邀請網址");
  });
  await check("R9c 權限查回為非擁有者：仍不顯示「邀請成員」與刪除鈕、create 0", () => {
    assert.equal(b(u2, ZH.inviteMembers), null, JSON.stringify(u2.buttons));
    assert.equal(b(u2, TRASH), null);
    assert.equal(u2.create, 0);
  });
  const w0 = await mountD({ tripId: U(20), access: "owner", view: "overview", gateAccess: true });
  await evaluate("window.resolveGates()");
  await sleep(250);
  const w1 = await dst();
  await check("R9d 未知 → 查回擁有者：查回前不顯示，查回後顯示「邀請成員」與刪除鈕；全程未點擊 create 0", () => {
    assert.equal(b(w0, ZH.inviteMembers), null);
    assert.equal(b(w0, TRASH), null);
    assert.deepEqual(b(w1, ZH.inviteMembers)?.disabled, false, JSON.stringify(w1.buttons));
    assert.ok(b(w1, TRASH));
    assert.equal(w1.create, 0);
  });
  const n0 = await mountD({ tripId: U(21), access: "member", view: "overview" });
  await dclick(SHARE);
  await sleep(250);
  const n1 = await dst();
  await check("R9e 冷啟動非擁有者：無「邀請成員」、無刪除鈕；開分享面板也不呼叫 create", () => {
    assert.ok(n0.editor);
    assert.equal(b(n0, ZH.inviteMembers), null);
    assert.equal(b(n0, TRASH), null);
    assert.equal(n1.create, 0);
    assert.ok(n1.sharePanel, "分享面板未開啟：" + JSON.stringify(n1.dialogs));
    assert.equal(sb(n1, ZH.inviteMembers), null, "非擁有者分享面板顯示了「邀請成員」：" + JSON.stringify(n1.sharePanel.buttons));
    assert.equal(sb(n1, ZH.inviteLinkLoading), null, "非擁有者分享面板顯示了準備中按鈕");
    assert.deepEqual(n1.sharePanel.alerts, []);
    assert.ok(!n1.text.includes(URL_PREFIX), "非擁有者畫面出現邀請網址");
  });

  // ── (b) create 失敗：錯誤文案＋重試（只在點擊時）＋「邀請成員」disabled ──
  const OK = (id) => ({ data: [{ invite_id: "i", invite_token: "TOK" + id }], error: null });
  const CASES = [
    [30, "not_trip_owner", { data: null, error: { message: "not_trip_owner", code: "42501" } }, "inviteNotOwner"],
    [31, "invite_rate_limited", { data: null, error: { message: "invite_rate_limited", code: "P0001" } }, "inviteRateLimited"],
    [32, "not_authenticated", { data: null, error: { message: "not_authenticated", code: "28000" } }, "inviteNotAuthenticated"],
    [33, "離線（navigator.onLine=false）", { data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" } }, "inviteNetworkError", { offline: true }],
    // supabase-js（postgrest）fetch 失敗時不丟例外，而是回 { error: { message: "TypeError: Load failed"／"Failed to fetch", code: "" } }
    [34, "連線失敗（onLine=true，postgrest 回 TypeError: Load failed）", { data: null, error: { message: "TypeError: Load failed", details: "", hint: "", code: "" } }, "inviteNetworkError"],
    [35, "連線失敗（onLine=true，TypeError: Failed to fetch）", { data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" } }, "inviteNetworkError"],
    [36, "其他錯誤", { data: null, error: { message: "something odd", code: "P0001" } }, "inviteCreateFailed"],
  ];
  for (const [n, label, err, key, extra = {}] of CASES) {
    const id = U(n);
    await mountD({ tripId: id, access: "owner", createQueue: [err, OK(n)], ...extra });
    await dclick(SHARE);
    await sleep(250);
    const s0 = await dst();
    await sleep(400);
    const s1 = await dst();
    let reopen = null;
    if (n === 30) {
      await evaluate("window.descape()");
      await sleep(300);
      await dclick(SHARE);
      await sleep(300);
      reopen = await dst();
    }
    const r = await dclick(ZH.inviteRetry);
    await sleep(300);
    const s2 = await dst();
    ownerSnap(`R10(${n}) 失敗`, s0);
    if (reopen) ownerSnap(`R10(${n}) 重開`, reopen);
    ownerSnap(`R10(${n}) 重試成功`, s2);
    // 只在第一個 case：從分享面板按「邀請成員」→ TripInviteSheet 開啟、選項可用，複製出來的正是重試取得的連結
    let sheet = null;
    let copied = null;
    if (n === 30) {
      sheet = { click: await dclick(ZH.inviteMembers) };
      await sleep(300);
      sheet.state = await dst();
      sheet.copyClick = await dclick(ZH.inviteOptionCopy);
      await sleep(200);
      copied = await dst();
    }
    await check(`R10 create 失敗（${label}）：錯誤文案＋「重試」、邀請成員 disabled、不自動重試；按重試才再呼叫一次並顯示連結`, () => {
      assert.equal(s0.create, 1, "開啟面板應呼叫 create 一次：" + s0.create);
      assert.deepEqual(s0.alerts, [ZH[key] + ZH.inviteRetry], "錯誤文案：" + JSON.stringify(s0.alerts) + " 期望 key=" + key);
      assert.deepEqual(b(s0, ZH.inviteRetry)?.disabled, false);
      assert.deepEqual(sb(s0, ZH.inviteMembers)?.disabled, true, "沒有連結時「邀請成員」應 disabled：" + JSON.stringify(sb(s0, ZH.inviteMembers)));
      assert.equal(sb(s0, ZH.inviteLinkLoading), null, "失敗時不應仍顯示準備中");
      assert.equal(s0.sharePanel.spin, 0, "失敗時不應仍顯示載入圖示");
      noInviteUrl(s0, "失敗狀態");
      assert.deepEqual(s1.toasts, [], "分享面板建立失敗不得跳 toast：" + JSON.stringify(s1.toasts));
      assert.equal(s1.create, 1, "未按重試卻再次呼叫 create");
      if (reopen) {
        assert.equal(reopen.create, 1, "關閉再開面板不得自動重試");
        assert.deepEqual(reopen.alerts, [ZH[key] + ZH.inviteRetry], "重開後仍顯示錯誤與重試");
      }
      assert.equal(r, "clicked");
      assert.equal(s2.create, 2, "按重試後應恰好再呼叫一次");
      assert.deepEqual(s2.alerts, []);
      assert.deepEqual(s2.toasts, [], "重試流程不得跳 toast");
      // 使用者要求移除網址顯示：改以「連結已就緒」等價訊號判定（按鈕可按、無載入／錯誤、不含網址）
      shareReady(s2, "重試成功");
      if (sheet) {
        assert.equal(sheet.click, "clicked", "分享面板「邀請成員」無法點擊：" + sheet.click);
        assert.ok(sheet.state.dialogs.some((d) => d.includes(ZH.inviteOptionCopy)), "按「邀請成員」未開啟 TripInviteSheet：" + JSON.stringify(sheet.state.dialogs));
        const opts = [ZH.inviteOptionCopy, ZH.inviteOptionLine, ZH.inviteOptionMessages, ZH.inviteOptionEmail, ZH.inviteOptionMore];
        assert.deepEqual(opts.map((t) => b(sheet.state, t)?.disabled ?? "missing"), opts.map(() => false), "TripInviteSheet 選項應可用");
        assert.equal(sheet.state.create, 2, "開啟 TripInviteSheet 又呼叫 create：" + sheet.state.create);
        assert.equal(sheet.copyClick, "clicked");
        assert.deepEqual(copied.copies, [URL_PREFIX + "TOK" + n], "複製出的連結應為重試取得的連結：" + JSON.stringify(copied.copies));
        assert.deepEqual(copied.toasts, ["success:" + ZH.inviteCopied]);
        assert.equal(copied.create, 2);
      }
    });
  }
  await mountD({ tripId: U(37), access: "owner", locale: "en", createQueue: [CASES[1][2], OK(37)] });
  await dclick(SHARE);
  await sleep(250);
  const e0 = await dst();
  await check("R10-en 錯誤文案與重試走 i18n（en）", () => {
    assert.deepEqual(e0.alerts, [EN.inviteRateLimited + EN.inviteRetry]);
    assert.ok(b(e0, EN.inviteRetry));
    assert.deepEqual(b(e0, EN.inviteMembers)?.disabled, true);
  });
  for (const loc of LOCALES) {
    const c = M.copy.getTripWorkspaceCopy(loc);
    for (const k of ["inviteNotOwner", "inviteRateLimited", "inviteNotAuthenticated", "inviteNetworkError", "inviteCreateFailed", "inviteRetry"]) {
      if (!(typeof c[k] === "string" && c[k].trim())) failures.push(`R10-i18n ${loc}.${k} 缺少`);
    }
  }

  // ── R11（#TW3-T3）：從總覽開啟的 TripInviteSheet ──
  const OPTIONS = [ZH.inviteOptionCopy, ZH.inviteOptionLine, ZH.inviteOptionMessages, ZH.inviteOptionEmail, ZH.inviteOptionMore];
  const optState = (s) => OPTIONS.map((t) => b(s, t)?.disabled ?? "missing");
  const ALL_DISABLED = OPTIONS.map(() => true);
  const ALL_ENABLED = OPTIONS.map(() => false);
  for (const [i, [, label, err, key, extra = {}]] of CASES.entries()) {
    const n = 40 + i;
    await mountD({ tripId: U(n), access: "owner", view: "overview", createQueue: [err, OK(n)], ...extra });
    const pre = await dst();
    const c0 = await dclick(ZH.inviteMembers);
    await sleep(250);
    const s0 = await dst();
    await sleep(400);
    const s1 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    const closed = await dst();
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const reopen = await dst();
    const r = await dclick(ZH.inviteRetry);
    await sleep(300);
    const s2 = await dst();
    const cp = await dclick(ZH.inviteOptionCopy);
    await sleep(150);
    const s3 = await dst();
    await check(`R11 總覽 TripInviteSheet create 失敗（${label}）：面板內錯誤＋重試、五選項 disabled、無 toast；重開不重試；按重試才再呼叫、成功後選項可用`, () => {
      assert.equal(pre.create, 0, "未開面板就呼叫 create");
      assert.equal(c0, "clicked");
      assert.equal(s0.create, 1, "開啟面板應呼叫 create 一次：" + s0.create);
      assert.ok(s0.dialogs.length === 1 && s0.dialogs[0].includes(ZH.inviteOptionCopy), "邀請面板未開啟：" + JSON.stringify(s0.dialogs));
      assert.deepEqual(s0.alerts, [ZH[key] + ZH.inviteRetry], "錯誤文案：" + JSON.stringify(s0.alerts) + " 期望 key=" + key);
      assert.deepEqual(optState(s0), ALL_DISABLED, "失敗時五個選項應 disabled");
      assert.deepEqual(s0.toasts, [], "建立失敗不得跳 toast：" + JSON.stringify(s0.toasts));
      assert.equal(s0.dialogSpin, 0, "失敗後不應仍顯示載入");
      assert.equal(s1.create, 1, "未按重試卻再次呼叫 create");
      assert.deepEqual(closed.dialogs, [], "Escape 未關閉面板");
      assert.equal(reopen.create, 1, "關閉再開不得自動重試");
      assert.deepEqual(reopen.alerts, [ZH[key] + ZH.inviteRetry], "重開後應顯示同一錯誤：" + JSON.stringify(reopen.alerts));
      assert.deepEqual(optState(reopen), ALL_DISABLED);
      assert.equal(r, "clicked");
      assert.equal(s2.create, 2, "按重試後應恰好再呼叫一次：" + s2.create);
      assert.deepEqual(s2.alerts, []);
      assert.deepEqual(optState(s2), ALL_ENABLED, "重試成功後選項應可用：" + JSON.stringify(optState(s2)));
      assert.deepEqual(s2.toasts, []);
      assert.equal(cp, "clicked");
      assert.deepEqual(s3.toasts, ["success:" + ZH.inviteCopied], "複製結果 toast 照舊");
      assert.equal(s3.create, 2);
    });
  }
  {
    // 分享面板已取得連結（模組快取）→ 總覽面板直接使用、不再呼叫 create、無載入
    const id = U(50);
    await mountD({ tripId: id, access: "owner", view: "overview" });
    await dclick(SHARE);
    await sleep(300);
    const p0 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(ZH.inviteMembers);
    await sleep(30);
    const s0 = await dst();
    await sleep(300);
    const s1 = await dst();
    await check("R11-cache 分享面板已取得連結 → 總覽邀請面板直接使用：create 不增加、選項立即可用、無錯誤／載入", () => {
      assert.equal(p0.create, 1, "分享面板應建立一次：" + p0.create);
      shareReady(ownerSnap("R11-cache 分享面板就緒", p0), "R11-cache 分享面板");
      assert.equal(s0.create, 1, "已有快取卻再呼叫 create");
      assert.deepEqual(optState(s0), ALL_ENABLED, "快取連結應立即可用：" + JSON.stringify(optState(s0)));
      assert.deepEqual(s0.alerts, []);
      assert.equal(s0.dialogSpin, 0);
      assert.equal(s1.create, 1);
    });
  }
  {
    // 總覽面板先失敗、分享面板之後成功取得 → 重開總覽面板時改用連結（錯誤清除、不再呼叫）
    const id = U(51);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: [CASES[0][2], OK(51)] });
    await dclick(ZH.inviteMembers);
    await sleep(250);
    const f0 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(SHARE);
    await sleep(300);
    const p0 = await dst();
    const pr = p0.alerts.length ? await dclick(ZH.inviteRetry) : "not-needed";
    await sleep(300);
    const p1 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(ZH.inviteMembers);
    await sleep(100);
    const s0 = await dst();
    await check("R11-cache2 總覽失敗後，分享面板重試成功 → 重開總覽面板直接使用該連結（錯誤清除、create 不增加）", () => {
      assert.equal(f0.create, 1);
      assert.deepEqual(f0.alerts, [ZH.inviteNotOwner + ZH.inviteRetry]);
      // #TW3-T4：失敗狀態兩入口共用 → 分享面板直接顯示同一錯誤＋重試、不自動重試
      assert.equal(p0.create, 1, "總覽已失敗，開分享面板卻自動重試：create=" + p0.create);
      assert.deepEqual(p0.alerts, [ZH.inviteNotOwner + ZH.inviteRetry], "分享面板未顯示同一錯誤：" + JSON.stringify(p0.alerts));
      assert.deepEqual(p0.toasts, []);
      assert.equal(pr, "clicked");
      assert.equal(p1.create, 2, "分享面板按重試應恰再呼叫 1 次：" + p1.create);
      ownerSnap("R11-cache2 分享面板失敗", p0);
      shareReady(ownerSnap("R11-cache2 分享面板重試成功", p1), "R11-cache2 分享面板重試成功");
      assert.equal(s0.create, 2, "已有快取卻再呼叫 create");
      assert.deepEqual(s0.alerts, [], "取得連結後總覽面板不應再顯示錯誤：" + JSON.stringify(s0.alerts));
      assert.deepEqual(optState(s0), ALL_ENABLED);
    });
  }
  {
    // 建立中關閉面板 → 背景完成後重開：不應卡在載入、不重複呼叫
    const id = U(52);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: ["defer"] });
    await dclick(ZH.inviteMembers);
    await sleep(100);
    const l0 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await evaluate(`window.resolveCreate(0, ${JSON.stringify(OK(52))})`);
    await sleep(100);
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const s0 = await dst();
    await check("R11-inflight 建立中關閉面板、背景成功後重開：直接使用連結、create 不增加、標題不殘留載入圖示", () => {
      assert.equal(l0.create, 1);
      assert.equal(l0.dialogSpin, 1, "建立中應顯示載入");
      assert.equal(s0.create, 1, "重開時又呼叫 create：" + s0.create);
      assert.deepEqual(optState(s0), ALL_ENABLED);
      assert.equal(s0.dialogSpin, 0, "連結已可用但標題仍顯示載入（loading 未重設）");
    });
  }
  {
    // 建立中關閉面板 → 背景失敗後重開：應顯示錯誤、不自動重試
    const id = U(53);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: ["defer", OK(53)] });
    await dclick(ZH.inviteMembers);
    await sleep(100);
    await evaluate("window.descape()");
    await sleep(300);
    await evaluate(`window.resolveCreate(0, ${JSON.stringify(CASES[4][2])})`);
    await sleep(100);
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const s0 = await dst();
    await check("R11-inflight-fail 建立中關閉面板、背景失敗後重開：顯示網路錯誤＋重試、不自動重試", () => {
      assert.equal(s0.create, 1, "已失敗卻在重開時自動重試：create=" + s0.create);
      assert.deepEqual(s0.alerts, [ZH.inviteNetworkError + ZH.inviteRetry], JSON.stringify(s0.alerts));
    });
  }
  {
    // 失敗後切到「行程」分頁再回「總覽」（總覽卸載重掛）→ 重開面板
    const id = U(54);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: [CASES[0][2], OK(54)] });
    await dclick(ZH.inviteMembers);
    await sleep(250);
    await evaluate("window.descape()");
    await sleep(300);
    const t1 = await dclick(ZH.tabTrip);
    await sleep(100);
    const t2 = await dclick(ZH.tabOverview);
    await sleep(200);
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const s0 = await dst();
    await check("R11-tab 失敗後切換分頁再回總覽、重開面板：顯示同一錯誤、不自動重試", () => {
      assert.equal(t1, "clicked");
      assert.equal(t2, "clicked");
      assert.equal(s0.create, 1, "切換分頁後重開面板自動重試：create=" + s0.create + " alerts=" + JSON.stringify(s0.alerts));
      assert.deepEqual(s0.alerts, [ZH.inviteNotOwner + ZH.inviteRetry]);
    });
  }

  // ── R14（#TW3-T4）：兩入口共用模組層狀態 ──
  {
    // 反向：分享面板先失敗 → 總覽邀請面板顯示同一錯誤、不自動重試；總覽按重試 → 分享面板也拿到連結
    const id = U(55);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: [CASES[1][2], OK(55)] });
    await dclick(SHARE);
    await sleep(300);
    const p0 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const s0 = await dst();
    const r = await dclick(ZH.inviteRetry);
    await sleep(300);
    const s1 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(SHARE);
    await sleep(300);
    const p1 = await dst();
    await check("R14a 分享面板失敗 → 總覽邀請面板同一錯誤＋重試、不自動重試；總覽重試成功 → 分享面板直接顯示連結（create 共 2 次、無 toast）", () => {
      assert.equal(p0.create, 1);
      assert.deepEqual(p0.alerts, [ZH.inviteRateLimited + ZH.inviteRetry], JSON.stringify(p0.alerts));
      assert.equal(s0.create, 1, "總覽面板自動重試：create=" + s0.create);
      assert.deepEqual(s0.alerts, [ZH.inviteRateLimited + ZH.inviteRetry], "總覽面板未顯示同一錯誤：" + JSON.stringify(s0.alerts));
      assert.deepEqual(optState(s0), ALL_DISABLED);
      assert.equal(r, "clicked");
      assert.equal(s1.create, 2);
      assert.deepEqual(s1.alerts, []);
      assert.deepEqual(optState(s1), ALL_ENABLED);
      assert.equal(p1.create, 2, "分享面板又呼叫 create：" + p1.create);
      assert.deepEqual(p1.alerts, []);
      ownerSnap("R14a 分享面板失敗", p0);
      shareReady(ownerSnap("R14a 分享面板重開（總覽已重試成功）", p1), "R14a 分享面板直接就緒");
      assert.deepEqual(p1.toasts, []);
    });
  }
  {
    // 合併進行中：分享面板建立中關閉 → 開總覽邀請面板：顯示載入、create 不增加；背景完成 → 選項可用、載入停止
    const id = U(56);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: ["defer"] });
    await dclick(SHARE);
    await sleep(150);
    const p0 = await dst();
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(ZH.inviteMembers);
    await sleep(200);
    const s0 = await dst();
    await evaluate(`window.resolveCreate(0, ${JSON.stringify(OK(56))})`);
    await sleep(200);
    const s1 = await dst();
    await check("R14b 分享面板建立中 → 總覽邀請面板合併同一請求：create 恰 1 次、載入中；完成後選項可用、載入圖示停止", () => {
      assert.equal(p0.create, 1);
      assert.ok(p0.text.includes(ZH.inviteLinkLoading), "分享面板應顯示建立中");
      assert.deepEqual(sb(ownerSnap("R14b 分享面板建立中", p0), ZH.inviteLinkLoading)?.disabled, true, "建立中按鈕應停用並顯示準備中：" + JSON.stringify(p0.sharePanel?.buttons));
      assert.equal(sb(p0, ZH.inviteMembers), null, "建立中不應顯示「邀請成員」文案");
      assert.equal(s0.create, 1, "合併失敗，create=" + s0.create);
      assert.equal(s0.dialogSpin, 1, "總覽面板應顯示載入");
      assert.deepEqual(optState(s0), ALL_DISABLED);
      assert.equal(s1.create, 1);
      assert.equal(s1.dialogSpin, 0, "完成後仍顯示載入");
      assert.deepEqual(optState(s1), ALL_ENABLED);
    });
  }
  {
    // 合併進行中（反向）：總覽建立中關閉 → 開分享面板：建立中、create 不增加；背景失敗 → 分享面板顯示錯誤＋重試、不自動重試
    const id = U(57);
    await mountD({ tripId: id, access: "owner", view: "overview", createQueue: ["defer", OK(57)] });
    await dclick(ZH.inviteMembers);
    await sleep(150);
    await evaluate("window.descape()");
    await sleep(300);
    await dclick(SHARE);
    await sleep(200);
    const p0 = await dst();
    await evaluate(`window.resolveCreate(0, ${JSON.stringify(CASES[0][2])})`);
    await sleep(300);
    const p1 = await dst();
    await check("R14c 總覽建立中 → 分享面板合併同一請求（create 1）；背景失敗 → 分享面板即時顯示錯誤＋重試、不自動重試、無 toast", () => {
      assert.equal(p0.create, 1, "合併失敗，create=" + p0.create);
      assert.ok(p0.text.includes(ZH.inviteLinkLoading), "分享面板應顯示建立中");
      assert.deepEqual(sb(ownerSnap("R14c 分享面板合併建立中", p0), ZH.inviteLinkLoading)?.disabled, true, "建立中按鈕應停用並顯示準備中");
      assert.deepEqual(p0.alerts, []);
      ownerSnap("R14c 分享面板背景失敗", p1);
      assert.deepEqual(sb(p1, ZH.inviteMembers)?.disabled, true, "失敗後「邀請成員」應停用");
      assert.equal(p1.create, 1, "失敗後自動重試：create=" + p1.create);
      assert.deepEqual(p1.alerts, [ZH.inviteNotOwner + ZH.inviteRetry], JSON.stringify(p1.alerts));
      assert.deepEqual(p1.toasts, []);
    });
  }

  // ── R13（#TW3-T4）：切換 tripId（同一實例）逐 commit 檢查：不得有任何 commit 顯示前一個 tripId 的旅伴 ──
  {
    const A = U(70);
    const B = U(71);
    const A_COUNT = "7 人"; // A 的旅伴數（zh-TW companionsCount）
    await mountD({ tripId: B, access: "owner", view: "overview", membersFor: { [B]: 2 } }); // B 進記憶體快取
    await mountD({ tripId: A, access: "owner", view: "overview", membersFor: { [A]: 7, [B]: 2 }, watch: [A_COUNT, "2 人"] });
    const a0 = await dst();
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: B })})`);
    await sleep(400);
    const s = await dst();
    await check("R13 總覽分頁切換到已快取的 tripId：任何 commit 都不顯示前一個行程的旅伴（A=7 人）；最後顯示 B 的 2 人", () => {
      assert.ok(a0.text.includes(A_COUNT), "前置：A 應顯示 7 人：" + a0.text.slice(0, 300));
      assert.ok(s.frames.some((f) => f.editorIds.includes(B)), "切換後沒有 B 的 commit：" + JSON.stringify(s.frames.slice(-5)));
      assert.ok(s.text.includes("2 人") && !s.text.includes(A_COUNT), "B 的旅伴未載入：" + JSON.stringify(s.frames.at(-1)));
      const leaked = s.frames.filter((f) => f.editorIds.includes(B) && f.watch.includes(A_COUNT));
      info("R13 切換後含 A 旅伴的 B commit 標籤：" + JSON.stringify(leaked.map((f) => f.tag)));
      assert.deepEqual(leaked.map((f) => f.tag), [], "切換到 B 後仍有 commit／flushSync 返回後的 DOM 顯示 A 的旅伴數 7 人（members state 未隨 tripId 在 render 階段重設）");
    });
  }
  // ── R13b（#TW3-T5）：render 階段清空 members 與旅伴 effect（membersRequestedForRef 守門）的互動 ──
  {
    const A = U(72);
    const B = U(73);
    const MF = { [A]: 7, [B]: 2 };
    await mountD({ tripId: B, access: "owner", view: "overview", membersFor: { [B]: 2 } }); // B 進記憶體快取
    await mountD({ tripId: A, access: "owner", view: "overview", membersFor: MF, watch: ["7 人", "2 人"] });
    const a0 = await dst();
    const listCalls = (s) => s.from.filter((t) => t === "trip_members").length;
    // (1) 總覽 A → 總覽 B → 總覽 A：每次切換都重新載入、最後顯示 A 的 7 人
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: B })})`);
    await sleep(400);
    const s1 = await dst();
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: A })})`);
    await sleep(400);
    const s2 = await dst();
    await check("R13b-1 總覽 A→B→A：每次切換恰重新載入、最後顯示 A 的 7 人；無 render 迴圈（commit 數有限）", () => {
      assert.ok(a0.text.includes("7 人"), "前置：A 應顯示 7 人");
      assert.ok(s1.text.includes("2 人") && !s1.text.includes("7 人"), "B 未顯示 2 人");
      assert.ok(s2.text.includes("7 人") && !s2.text.includes("2 人"), "回到 A 未顯示 7 人：" + JSON.stringify(s2.frames.at(-1)));
      assert.ok(s2.frames.length < 200, "commit 數異常（疑似 render 迴圈）：" + s2.frames.length);
    });
    // (2) 總覽 A（ref=A）→ 點「行程」分頁 → 在行程分頁切到 B（effect 因 view≠overview 不更新 ref）→ 切回 A → 點「總覽」
    //     render 階段把 members 清成 null，但 ref 仍是 A → effect 直接 return → A 的旅伴不會重新載入
    await mountD({ tripId: B, access: "owner", view: "overview", membersFor: { [B]: 2 } });
    await mountD({ tripId: A, access: "owner", view: "overview", membersFor: MF, watch: ["7 人", "2 人"] });
    const b0 = await dst();
    const t1 = await dclick(ZH.tabTrip);
    await sleep(200);
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: B })})`);
    await sleep(400);
    const b1 = await dst();
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: A })})`);
    await sleep(300);
    const t2 = await dclick(ZH.tabOverview);
    await sleep(600);
    const b2 = await dst();
    info("R13b-2 trip_members 查詢次數：A 總覽=" + listCalls(b0) + "、行程分頁切到 B 後=" + listCalls(b1) + "、回 A 總覽後=" + listCalls(b2) +
      "；最後一幀 watch=" + JSON.stringify(b2.frames.at(-1)?.watch) + "；tab 點擊=" + t1 + "/" + t2);
    await check("R13b-2 總覽 A →「行程」分頁 → 切到 B → 切回 A →「總覽」：A 的旅伴（7 人）應重新顯示", () => {
      assert.ok(b0.text.includes("7 人"), "前置：A 應顯示 7 人");
      assert.equal(t1, "clicked");
      assert.equal(t2, "clicked");
      assert.ok(b2.text.includes("7 人"),
        "回到 A 總覽後旅伴不見（members 在 render 階段被清成 null，但 membersRequestedForRef 仍是 A → effect 直接 return、不重新載入；B 在非總覽分頁時從未更新 ref）。trip_members 查詢：" +
        listCalls(b0) + "→" + listCalls(b2));
    });
  }

  // ── R15（#TW3-T5）：登入狀態改變／網路恢復 → 開著的面板自動重建恰 1 次 ──
  {
    // 既有 channel：TripSharePanel 的 trip-members:{id}、useTripRealtimeSync 的 trip-collab:{id}；其他名稱＝新增的 channel
    const OTHER_CH = "(window.__channels||[]).filter(a=>!/^trip-(members|collab):/.test(String(a[0]))).length";
    const ch0 = (await evaluate(OTHER_CH)) ?? 0;
    // 先把 watcher 安裝起來並送出首次事件（只記錄）
    const id0 = U(80);
    await mountD({ tripId: id0, access: "owner", view: "overview", createQueue: [CASES[2][2], OK(80)] });
    await evaluate("window.emitAuth('INITIAL_SESSION','user-1')");
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const s0 = await dst();
    await evaluate("window.emitAuth('TOKEN_REFRESHED','user-1')");
    await sleep(300);
    const s1 = await dst();
    await evaluate("window.emitAuth('SIGNED_IN','user-2')");
    await sleep(400);
    const s2 = await dst();
    await sleep(500);
    const s3 = await dst();
    await check("R15a 總覽邀請面板「請先登入」失敗開著 → 同使用者 TOKEN_REFRESHED 不動；換成其他使用者 → 錯誤清除、自動建立恰 1 次、選項可用、不再重試", () => {
      assert.equal(s0.create, 1);
      assert.deepEqual(s0.alerts, [ZH.inviteNotAuthenticated + ZH.inviteRetry], JSON.stringify(s0.alerts));
      assert.equal(s1.create, 1, "同使用者 TOKEN_REFRESHED 觸發重建");
      assert.deepEqual(s1.alerts, s0.alerts, "同使用者 TOKEN_REFRESHED 清除了錯誤");
      assert.equal(s2.create, 2, "換使用者後應自動建立恰 1 次：create=" + s2.create);
      assert.deepEqual(s2.alerts, []);
      assert.deepEqual(optState(s2), ALL_ENABLED);
      assert.equal(s3.create, 2, "自動建立後又重試：create=" + s3.create);
      assert.deepEqual(s3.toasts, []);
    });
    const id1 = U(81);
    await mountD({ tripId: id1, access: "owner", view: "overview", createQueue: [CASES[4][2], OK(81), OK(81)] });
    await dclick(ZH.inviteMembers);
    await sleep(300);
    const o0 = await dst();
    await evaluate("window.emitOnline()");
    await sleep(400);
    const o1 = await dst();
    await evaluate("window.emitOnline()");
    await sleep(400);
    const o2 = await dst();
    await check("R15b 總覽邀請面板網路失敗開著 → online：錯誤清除、自動建立恰 1 次、選項可用；再次 online 不再呼叫", () => {
      assert.equal(o0.create, 1);
      assert.deepEqual(o0.alerts, [ZH.inviteNetworkError + ZH.inviteRetry], JSON.stringify(o0.alerts));
      assert.equal(o1.create, 2, "online 後應自動建立恰 1 次：create=" + o1.create);
      assert.deepEqual(o1.alerts, []);
      assert.deepEqual(optState(o1), ALL_ENABLED);
      assert.equal(o2.create, 2, "再次 online 又呼叫 create");
    });
    const id2 = U(82);
    await mountD({ tripId: id2, access: "owner", view: "overview", createQueue: [CASES[0][2], OK(82)] });
    await dclick(ZH.inviteMembers);
    await sleep(300);
    await evaluate("window.emitOnline()");
    await sleep(400);
    const n1 = await dst();
    await check("R15c 非網路失敗（not_trip_owner）開著 → online：錯誤保留、不自動重試", () => {
      assert.equal(n1.create, 1, "非網路失敗在 online 後自動重試：create=" + n1.create);
      assert.deepEqual(n1.alerts, [ZH.inviteNotOwner + ZH.inviteRetry], JSON.stringify(n1.alerts));
    });
    const id3 = U(83);
    await mountD({ tripId: id3, access: "owner", createQueue: [CASES[2][2], OK(83), OK(83)] });
    await dclick(SHARE);
    await sleep(300);
    const p0 = await dst();
    await evaluate("window.emitAuth('SIGNED_OUT',null)");
    await sleep(400);
    const p1 = await dst();
    await sleep(400);
    const p2 = await dst();
    const regs = await evaluate("(window.__authCbs||[]).length");
    const ch1 = (await evaluate(OTHER_CH)) ?? 0;
    await check("R15d 分享面板失敗開著 → 登出（user-2→null）：清除、自動建立恰 1 次；跨多次掛載 onAuthStateChange 只註冊 1 次、無新 channel", () => {
      assert.equal(p0.create, 1);
      assert.deepEqual(p0.alerts, [ZH.inviteNotAuthenticated + ZH.inviteRetry], JSON.stringify(p0.alerts));
      assert.equal(p1.create, 2, "登出事件後應自動建立恰 1 次：create=" + p1.create);
      assert.equal(p2.create, 2, "自動建立後又重試：create=" + p2.create);
      ownerSnap("R15d 分享面板失敗", p0);
      ownerSnap("R15d 登出後自動建立", p1);
      shareReady(ownerSnap("R15d 自動建立完成", p2), "R15d 分享面板新連結就緒");
      assert.equal(regs, 1, "onAuthStateChange 註冊次數：" + regs);
      assert.equal(ch1 - ch0, 0, "邀請 watcher 建立了 Realtime channel：" + (ch1 - ch0));
    });
  }

  // ── R16：擁有者分享面板任何狀態（建立中／失敗／重開／就緒）都不顯示邀請網址與「邀請連結」標題 ──
  await check("R16 擁有者分享面板（建立中／失敗／就緒共 " + OWNER_PANEL_SNAPS.length + " 個快照）皆不顯示邀請網址、不顯示「邀請連結」標題", () => {
    const kinds = { loading: 0, error: 0, ready: 0 };
    for (const [label, s] of OWNER_PANEL_SNAPS) {
      noInviteUrl(s, label);
      if (sb(s, ZH.inviteLinkLoading)) kinds.loading += 1;
      else if (s.sharePanel.alerts.length) kinds.error += 1;
      else if (sb(s, ZH.inviteMembers)?.disabled === false) kinds.ready += 1;
    }
    info("R16 快照狀態分布：" + JSON.stringify(kinds));
    assert.ok(kinds.loading >= 1 && kinds.error >= 1 && kinds.ready >= 1, "快照未涵蓋三種狀態：" + JSON.stringify(kinds));
  });

  // ── R12（#TW3-T3）：被移除流程逐幀檢查 ──
  const framesAfterToast = (frames) => frames.slice(frames.findIndex((f) => f.toasts > 0));
  const settle = async (ms = 400) => {
    await sleep(ms);
    return dst();
  };
  {
    await evaluate(`window.mountDetail(${JSON.stringify({ tripId: U(60), row: false, access: "gone", snapshot: shared(U(60)), gateAccess: true })})`);
    await sleep(150);
    await evaluate("window.resolveGates()");
    const s = await settle();
    await check("R12a 冷啟動被移除（權限查詢延遲）：每一幀都不是「找不到」空狀態、不含行程內容；判定後維持載入", () => {
      assert.deepEqual(s.toasts, ["error:" + ZH.removedFromTrip]);
      assert.deepEqual(s.nav, LEAVE_NAV);
      assert.ok(s.frames.length >= 2, "幀數不足：" + s.frames.length);
      assert.deepEqual(s.frames.filter((f) => f.notFound || f.blank), [], "出現空狀態幀：" + JSON.stringify(s.frames));
      assert.deepEqual(s.frames.filter((f) => f.editorIds.length), [], "冷啟動不得顯示行程內容");
      assert.ok(s.frames.at(-1).spin, "最後應為載入");
    });
  }
  for (const [tag, o] of [
    ["讀不到＋非成員", { row: false, access: "gone", gateAccess: true }],
    ["權限拒絕錯誤", { itinError: "permission denied for table saved_trips", access: "gone" }],
  ]) {
    const id = tag === "讀不到＋非成員" ? U(61) : U(62);
    await mountD({ tripId: id, access: "member" });
    await evaluate(`window.mountDetail(${JSON.stringify({ tripId: id, ...o })})`);
    await sleep(150);
    const mid = await dst();
    if (o.gateAccess) await evaluate("window.resolveGates()");
    const s = await settle();
    await check(`R12b 熱快取被移除（${tag}）：判定前顯示快取（正常），判定後每一幀都不含快取行程內容、不出現「找不到」`, () => {
      assert.deepEqual(s.toasts, ["error:" + ZH.removedFromTrip]);
      assert.deepEqual(s.nav, LEAVE_NAV);
      if (o.gateAccess) assert.deepEqual(mid.toasts, [], "判定前不應已提示");
      assert.deepEqual(s.frames.filter((f) => f.notFound || f.blank), [], "出現空狀態幀：" + JSON.stringify(s.frames));
      const after = framesAfterToast(s.frames);
      assert.ok(after.length >= 1, "判定後沒有任何 commit：" + JSON.stringify(s.frames));
      assert.deepEqual(after.filter((f) => f.editorIds.length), [], "判定後仍渲染快取行程：" + JSON.stringify(after));
      assert.ok(s.frames.at(-1).spin && !s.editor, "最後應為載入、無編輯器");
    });
  }
  {
    // 切換 tripId（同一實例）：被移除狀態重設，新行程正常載入；切換過程不出現「找不到」、不顯示舊行程內容
    const A = U(63);
    const B = U(64);
    const C = U(65);
    await mountD({ tripId: B, access: "member" }); // B 進記憶體快取
    await mountD({ tripId: A, access: "member" }); // A 進記憶體快取
    await evaluate(`window.mountDetail(${JSON.stringify({ tripId: A, row: false, access: "gone" })})`);
    const r0 = await settle();
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: C, row: true, access: "member", gateAccess: true })})`);
    await sleep(200);
    await evaluate("window.resolveGates()");
    const r1 = await settle();
    await check("R12c 被移除後切換到未快取的 tripId：removed 重設、載入新行程；切換期間不出現「找不到」、不顯示舊行程", () => {
      assert.deepEqual(r0.toasts, ["error:" + ZH.removedFromTrip]);
      const sw = r1.frames.slice(r1.frames.findIndex((f) => f.tag === "rerender"));
      assert.deepEqual(sw.filter((f) => f.notFound || f.blank), [], JSON.stringify(sw));
      assert.deepEqual(sw.filter((f) => f.editorIds.includes(A)), [], "切換後仍顯示被移除行程：" + JSON.stringify(sw));
      assert.ok(r1.editor && sw.at(-1).editorIds.includes(C), "新行程未載入：" + JSON.stringify(sw.at(-1)));
      assert.deepEqual(r1.toasts, ["error:" + ZH.removedFromTrip], "切換後不得再提示被移除");
    });
    await evaluate(`window.mountDetail(${JSON.stringify({ tripId: A, access: "member" })})`); // A 重新進快取
    await settle(200);
    await evaluate(`window.mountDetail(${JSON.stringify({ tripId: A, row: false, access: "gone" })})`);
    const q0 = await settle();
    // 讓 B 的權限查詢延遲（模擬真實網路延遲），觀察切換後到 B 載入完成之間的畫面
    await evaluate(`window.rerenderDetail(${JSON.stringify({ tripId: B, row: true, access: "member", gateAccess: true })})`);
    await sleep(200);
    await evaluate("window.resolveGates()");
    const q1 = await settle();
    await check("R12d 被移除後切換到已快取的 tripId：不出現「找不到」、不顯示被移除行程的快取內容", () => {
      assert.deepEqual(q0.toasts, ["error:" + ZH.removedFromTrip]);
      const sw = q1.frames.slice(q1.frames.findIndex((f) => f.tag === "rerender"));
      assert.deepEqual(sw.filter((f) => f.notFound || f.blank), [], JSON.stringify(sw));
      assert.deepEqual(sw.filter((f) => f.editorIds.includes(A)), [], "切換到 B 後仍渲染被移除行程 A 的內容：" + JSON.stringify(sw));
      assert.ok(sw.at(-1).editorIds.includes(B), "B 未顯示：" + JSON.stringify(sw.at(-1)));
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
  await build({
    stdin: { contents: webEntry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(tmp, "app.js"),
    format: "iife",
    jsx: "automatic",
    jsxDev: true,
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
    plugins: [mockPlugin(webMocks)],
  });
  await build({
    stdin: { contents: detailEntry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(tmp, "detail.js"),
    format: "iife",
    jsx: "automatic",
    jsxDev: true,
    alias: { "@": path.join(root, "src") },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' },
    plugins: [mockPlugin(detailMocks)],
  });
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js" || req.url === "/detail.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(tmp, req.url.slice(1))));
      return;
    }
    if (req.url === "/detail.html") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/detail.js"></script></body></html>');
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
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
    await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await evaluate("!!window.__ready"), "fixture 未載入：" + browserErrors.join("\n"));

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const mount = async (o) => {
      await evaluate(`window.mount(${JSON.stringify(o)})`);
      for (let i = 0; i < 60; i++) {
        const s = await evaluate("window.state()");
        if (s.buttons.length > 0) break;
        await sleep(25);
      }
      await sleep(150); // 讓 StrictMode 雙重 effect 與 auth 還原完成
      return evaluate("window.state()");
    };
    const st = () => evaluate("window.state()");
    const click = (t) => evaluate(`window.click(${JSON.stringify(t)})`);
    const btn = (s, text) => s.buttons.find((b) => b.text === text) ?? null;

    // R1
    {
      const s0 = await mount({ token: TOKEN, loggedIn: true, preview: VALID });
      const clicked = await click("加入行程");
      await sleep(30);
      const s1 = await st();
      await evaluate(`window.resolveAccept(0, {data:${JSON.stringify(TRIP_ID)},error:null})`);
      await sleep(60);
      const s2 = await st();
      await check("R1 已登入有效邀請：先顯示行程卡、掛載後 accept 0 次；按「加入行程」恰 1 次並導向 /saved/{id}?view=overview", () => {
        assert.equal(s0.h1, "京都楓葉之旅", "行程卡標題：" + s0.text);
        assert.ok(s0.text.includes("3 位成員"), s0.text);
        assert.ok(s0.previewCalls >= 1, "未呼叫 preview");
        assert.deepEqual(s0.acceptCalls, [], "未按加入就呼叫了 accept");
        assert.deepEqual(btn(s0, "加入行程"), { text: "加入行程", disabled: false }, JSON.stringify(s0.buttons));
        assert.equal(s0.stash, TOKEN, "進入頁面時 stash token");
        assert.equal(clicked, "clicked");
        assert.deepEqual(s1.acceptCalls, [{ invite_token: TOKEN }]);
        assert.deepEqual(s2.acceptCalls.length, 1);
        assert.deepEqual(s2.nav, [{ to: "/saved/$tripId", params: { tripId: TRIP_ID }, search: { view: "overview" }, replace: true }]);
        assert.equal(s2.stash, null, "成功後清除 stash");
        assert.equal(s2.toasts.filter((t) => t.startsWith("success:")).length, 1);
        info("preview 呼叫次數（StrictMode）：" + s0.previewCalls);
      });
    }
    // R2
    {
      await mount({ token: TOKEN, loggedIn: true, preview: VALID });
      await evaluate(`window.clickTwice("加入行程")`);
      await sleep(30);
      const s = await st();
      await click("加入行程");
      await sleep(30);
      const s2 = await st();
      await check("R2 連點「加入行程」：accept 恰 1 次（處理中按鈕停用）", () => {
        assert.equal(s.acceptCalls.length, 1, "accept 次數：" + s.acceptCalls.length);
        assert.equal(s2.acceptCalls.length, 1, "處理中再按又送出：" + s2.acceptCalls.length);
      });
      await mount({ token: TOKEN, loggedIn: true, preview: VALID });
      await evaluate(`window.clickTwiceSync("加入行程")`);
      await sleep(30);
      info("同一 task 內同步派送兩次 click → accept " + (await st()).acceptCalls.length + " 次（handleJoin 以 state 守門；實機兩次點擊為獨立 task，見 R2）");
    }
    // R3
    {
      const s0 = await mount({ token: TOKEN, loggedIn: false, preview: VALID });
      await click("登入後加入");
      await sleep(30);
      const s1 = await st();
      await check("R3 未登入：「登入後加入」→ requireAuthForAction(collaboration)、stash token、accept 0 次", () => {
        assert.deepEqual(btn(s0, "登入後加入"), { text: "登入後加入", disabled: false }, JSON.stringify(s0.buttons));
        assert.deepEqual(s1.authRequired, ["collaboration"]);
        assert.equal(s1.stash, TOKEN);
        assert.deepEqual(s1.acceptCalls, []);
      });
    }
    // R4
    for (const [state, msg] of [["revoked", "這個邀請連結已停用"], ["expired", "這個邀請連結已過期"], ["full", "這個行程的成員已滿"], ["invalid", "這個邀請連結無效"]]) {
      const preview = state === "full" ? { ...VALID, state, member_count: 20 } : { state, trip_title: null, date_start: null, date_end: null, cover_url: null, inviter_display_name: null, member_count: null };
      const s = await mount({ token: TOKEN, loggedIn: true, preview });
      await check(`R4 ${state}：顯示「${msg}」、無加入鈕、accept 0 次`, () => {
        assert.ok(s.text.includes(msg), s.text);
        assert.equal(btn(s, "加入行程"), null);
        assert.equal(btn(s, "登入後加入"), null);
        assert.ok(btn(s, "回到首頁"), JSON.stringify(s.buttons));
        assert.deepEqual(s.acceptCalls, []);
        if (state !== "full") assert.equal(s.h1, null, "失效邀請不得顯示行程卡");
      });
    }
    // R5
    for (const [code, msg] of [["trip_full", "這個行程的成員已滿"], ["invite_revoked", "這個邀請連結已停用"]]) {
      await mount({ token: TOKEN, loggedIn: true, preview: VALID });
      await click("加入行程");
      await sleep(20);
      await evaluate(`window.resolveAccept(0, {data:null,error:{message:${JSON.stringify(code)}}})`);
      await sleep(60);
      const s = await st();
      await check(`R5 accept 回 ${code}：切換為失效狀態、不導向`, () => {
        assert.ok(s.text.includes(msg), s.text);
        assert.equal(btn(s, "加入行程"), null);
        assert.deepEqual(s.nav, []);
        assert.equal(s.acceptCalls.length, 1);
      });
    }
    {
      await mount({ token: TOKEN, loggedIn: true, preview: VALID });
      await click("加入行程");
      await sleep(20);
      await evaluate(`window.resolveAccept(0, {data:null,error:{message:"not_authenticated"}})`);
      await sleep(60);
      const s = await st();
      await check("R5c accept 回 not_authenticated：要求登入並保留 stash", () => {
        assert.deepEqual(s.authRequired, ["collaboration"]);
        assert.equal(s.stash, TOKEN);
        assert.deepEqual(s.nav, []);
      });
    }
    // R6：真實 App.tsx 外殼
    {
      const ctl = await mount({ token: TOKEN, loggedIn: true, preview: VALID, shell: "app", path: "/saved/" + TRIP_ID });
      await check("R6-對照 非繞過路徑（同一頁面包在 OnboardingGate＋AppProviders 內）：已登入可按「加入行程」", () => {
        assert.equal(ctl.gate, true);
        assert.equal(ctl.providers, true);
        assert.deepEqual(btn(ctl, "加入行程"), { text: "加入行程", disabled: false }, JSON.stringify(ctl.buttons));
      });
      const s = await mount({ token: TOKEN, loggedIn: true, preview: VALID, shell: "app" });
      await sleep(400);
      const s1 = await st();
      const r = await click("加入行程");
      await sleep(30);
      const s2 = await st();
      await check("R6a 真實 App 外殼 /trip-invite/{token}（onboarding 繞過）：已登入使用者「加入行程」可按且會送出 accept", () => {
        assert.equal(s.gate, false, "邀請頁應繞過 OnboardingGate");
        assert.ok(s1.h1, "行程卡未顯示：" + s1.text);
        assert.deepEqual(btn(s1, "加入行程"), { text: "加入行程", disabled: false }, "按鈕狀態：" + JSON.stringify(s1.buttons) + "（AppProviders 包含 AuthProvider：" + s1.providers + "）");
        assert.equal(r, "clicked");
        assert.equal(s2.acceptCalls.length, 1);
      });
      const g = await mount({ token: TOKEN, loggedIn: false, preview: VALID, shell: "app" });
      await sleep(400);
      const g1 = await st();
      await check("R6b 真實 App 外殼 /trip-invite/{token}：未登入顯示可按的「登入後加入」", () => {
        assert.deepEqual(btn(g1, "登入後加入"), { text: "登入後加入", disabled: false }, "按鈕狀態：" + JSON.stringify(g1.buttons));
      });
      void g;
    }
    // R6c：真實 App 外殼，未登入 → 按「登入後加入」→ 登入完成（SIGNED_IN）→ 回到邀請頁可按「加入行程」並送出
    {
      await mount({ token: TOKEN, loggedIn: false, preview: VALID, shell: "app" });
      await sleep(300);
      const g0 = await st();
      const r0 = await click("登入後加入");
      await sleep(30);
      const g1 = await st();
      const subs = await evaluate("window.signIn()");
      await sleep(200);
      const g2 = await st();
      const r2 = await click("加入行程");
      await sleep(30);
      const g3 = await st();
      await evaluate(`window.resolveAccept(0, {data:${JSON.stringify(TRIP_ID)},error:null})`);
      await sleep(60);
      const g4 = await st();
      await check("R6c 真實 App 外殼：未登入「登入後加入」→ 要求登入、accept 0；登入完成後同頁「加入行程」可按、accept 恰 1 次（stash 的 token）並導向行程", () => {
        assert.equal(g0.gate, false, "邀請頁應繞過 OnboardingGate");
        assert.equal(g0.providers, true, "邀請頁應有 AppProviders（AuthProvider）");
        assert.equal(r0, "clicked");
        assert.deepEqual(g1.authRequired, ["collaboration"]);
        assert.equal(g1.stash, TOKEN, "登入前 stash token（login.tsx 登入後據此導回邀請頁）");
        assert.deepEqual(g1.acceptCalls, []);
        assert.ok(subs >= 1, "AuthProvider 未訂閱 onAuthStateChange");
        assert.deepEqual(btn(g2, "加入行程"), { text: "加入行程", disabled: false }, "登入後按鈕：" + JSON.stringify(g2.buttons));
        assert.equal(btn(g2, "登入後加入"), null);
        assert.equal(r2, "clicked");
        assert.deepEqual(g3.acceptCalls, [{ invite_token: TOKEN }]);
        assert.deepEqual(g3.authRequired, ["collaboration"], "登入後不得再要求登入");
        assert.deepEqual(g4.nav, [{ to: "/saved/$tripId", params: { tripId: TRIP_ID }, search: { view: "overview" }, replace: true }]);
        assert.equal(g4.stash, null);
      });
    }
    // R13（#TW3-T3）：加入邀請頁在 network 錯誤時文案與行為不變（與「未知錯誤」輸出完全相同，且不顯示建立邀請用的網路文案）
    {
      const ZHc = M.copy.getTripWorkspaceCopy("zh-TW");
      const NET = [
        ["Failed to fetch", { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" }, false],
        ["Load failed", { message: "TypeError: Load failed", details: "", hint: "", code: "" }, false],
        ["離線＋Load failed", { message: "TypeError: Load failed", details: "", hint: "", code: "" }, true],
      ];
      const UNKNOWN = { message: "something odd", code: "P0001" };
      const previewRun = async (err, offline) => {
        const s0 = await mount({ token: TOKEN, loggedIn: true, preview: VALID, previewErrors: [err, err], offline });
        const r = await click(ZHc.inviteRetry);
        await sleep(100);
        const s1 = await st();
        return { s0, r, s1 };
      };
      const acceptRun = async (err, offline) => {
        await mount({ token: TOKEN, loggedIn: true, preview: VALID, offline });
        await click("加入行程");
        await sleep(20);
        await evaluate(`window.resolveAccept(0, {data:null,error:${JSON.stringify(err)}})`);
        await sleep(80);
        return st();
      };
      const pBase = await previewRun(UNKNOWN, false);
      const aBase = await acceptRun(UNKNOWN, false);
      await check("R13-基準 未知錯誤：preview → 「無法載入邀請」＋重試；accept → toast 加入失敗、留在頁面", () => {
        assert.ok(pBase.s0.text.includes(ZHc.inviteLoadFailed), pBase.s0.text);
        assert.equal(pBase.r, "clicked");
        assert.equal(pBase.s1.h1, "京都楓葉之旅", "重試後應顯示行程卡");
        assert.deepEqual(aBase.toasts.filter((t) => t.startsWith("error:")), ["error:" + ZHc.inviteJoinFailed]);
        assert.deepEqual(aBase.nav, []);
        assert.deepEqual(btn(aBase, "加入行程"), { text: "加入行程", disabled: false });
      });
      for (const [label, err, offline] of NET) {
        const p = await previewRun(err, offline);
        const a = await acceptRun(err, offline);
        await check(`R13 加入邀請頁 network（${label}）：preview 與 accept 的文案／按鈕／導向與未知錯誤相同；不出現建立邀請的網路文案`, () => {
          assert.equal(p.s0.text, pBase.s0.text, "preview 錯誤畫面與基準不同");
          assert.deepEqual(p.s0.buttons, pBase.s0.buttons);
          assert.equal(p.r, "clicked");
          assert.equal(p.s1.h1, "京都楓葉之旅");
          assert.ok(!p.s0.text.includes(ZHc.inviteNetworkError), "邀請頁不得改用建立邀請的網路文案");
          assert.deepEqual(a.toasts, aBase.toasts, "accept 錯誤 toast 與基準不同");
          assert.deepEqual(a.nav, []);
          assert.deepEqual(a.authRequired, []);
          assert.equal(a.text, aBase.text);
          assert.deepEqual(a.buttons, aBase.buttons);
        });
      }
    }
    await runDetailChecks({ evaluate, sleep, port: server.address().port, call });
    await check("R7 無外部請求、無瀏覽器例外／console.error", () => {
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
console.log(failures.length ? "verify-trip-invite-stage3: FAIL" : "verify-trip-invite-stage3: PASS");
process.exit(failures.length ? 1 : 0);
