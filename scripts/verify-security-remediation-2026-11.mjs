// verify-security-remediation-2026-11.mjs — 任務單 #3（資安稽核 run-1 修補）獨立複審；任務單 #6 第 2 次複審更新
//
// 任務單 #6 更新：S2f（結算走 service role＋p_user_id）、SQL-a（6 個函式／5 個 DEFINER）、S5a（先擷取 token、
// 清本機，再並行 admin.signOut 與本機 signOut）、S6f（封面複製失敗改為中止可續跑）、S7（新文案）；
// 新增 SQL-i〜m、S5a2、S5g〜i（快過期換 token）、S5R1〜3（真實 auth-js＋離線 fetch）、S6g〜h、NET。
// 伺服器扣點狀態機的執行驗證在 scripts/verify-security-credits-runtime-2026-11.mjs。
//
// 不連任何 Supabase、不套 migration、不讀 .env、不呼叫 Google／OpenAI；全域 fetch／http(s)／net／tls 攔截，
// 非 mock 請求 → NET 檢查 FAIL。
// 執行（以 esbuild 打包「真實」模組，只 mock 外部邊界：Supabase client、Capacitor、平台、router、AI service）：
//   node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-security-remediation-2026-11.mjs
//
// 覆蓋：
//   1. /auth/callback 不再把 URL hash 的 access_token／refresh_token 設成 session（執行）
//   2. /api/roamie：X-Roamie-Cancel 只回 204、不退點、不生成；非串流 commit 失敗不交付結果；
//      settleServerCredits 把 ok:false 視為失敗；串流路徑 commit 先於交付（目前未達成，見 S2-stream）
//   3. removeTripMember 改走 remove_trip_member RPC 並清掉本地舊連結快取（執行）；SQL 撤銷連結（靜態）
//   4. trip_members 客戶端 INSERT/UPDATE/DELETE 權限與 policy 皆移除；src 無直接寫入（靜態）
//   5. 登出：signOut 先於本機清除；signOut 卡住／離線仍清乾淨；resetToLoginScreen 導向不被阻塞，
//      背景用清除前擷取的使用者 access token 撤銷（執行）
//   6. 刪帳號：轉移先於 storage 清除與 deleteUser；轉移後 cascade 不刪共享行程／花費／封面；
//      只有自己一人的行程被刪；轉移失敗中止且可續跑；被刪者 storage prefix 清空（執行，in-memory fake）
//   7. 刪帳號確認視窗四語系說明（靜態）；刪行程提醒由 verify-delete-trip-dialog-i18n 覆蓋
//   SQL：SECURITY DEFINER 皆設 search_path、GRANT 對象、可重複執行、未加入 realtime publication（靜態）

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

fs.writeSync(1, "verify-security-remediation-2026-11 start\n");
// ---------------------------------------------------------------------------
// Network guard (任務單 #6)：全域 fetch／http(s)／net／tls 一律攔截；只有 __m.fetchHandler 明確處理的請求
// 才算 mock，其餘記入 NET_BLOCKED 並在最後一條檢查 FAIL。清除金鑰類環境變數（不讀 .env）。
// ---------------------------------------------------------------------------
for (const k of Object.keys(process.env)) {
  if (/SUPABASE|OPENAI|GOOGLE_|SERVICE_ROLE|REVENUECAT|STRIPE|UNSPLASH|SECRET/i.test(k)) delete process.env[k];
}
const NET_BLOCKED = [];
globalThis.__m = {};
const trappedFetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  const handler = globalThis.__m.fetchHandler;
  if (typeof handler === "function") {
    const r = await handler(url, init ?? {}, input);
    if (r !== undefined) return r;
  }
  NET_BLOCKED.push(String(url).slice(0, 120));
  throw new TypeError("NETWORK_BLOCKED " + url);
};
globalThis.fetch = trappedFetch;
{
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const trap = (kind) => () => {
    NET_BLOCKED.push(kind);
    throw new Error("NETWORK_BLOCKED " + kind);
  };
  for (const m of ["http", "https"]) {
    const mod = require(m);
    mod.request = trap(m + ".request");
    mod.get = trap(m + ".get");
  }
  // 任務單 #21：net 也攔截（esbuild 走子程序 stdio pipe，不經 net.connect）。
  const net = require("net");
  net.connect = trap("net.connect");
  net.createConnection = trap("net.createConnection");
  require("tls").connect = trap("tls.connect");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const failures = [];
let passCount = 0;
// Synchronous stdout: results survive a watchdog SIGKILL.
const say = (s) => fs.writeSync(1, s + "\n");
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    say("PASS " + name);
  } catch (e) {
    failures.push(name);
    say("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 20).join("\n     "));
  }
}

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-sec-remediation-"));
let bundleSeq = 0;
async function bundle(entry, mocks) {
  const out = path.join(tmp, `b${(bundleSeq += 1)}.mjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
    tsconfig: path.join(root, "tsconfig.json"),
    plugins: [
      {
        name: "sec-mocks",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            a.path in mocks ? { path: a.path, namespace: "mock" } : null,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "ts",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  return import(pathToFileURL(out).href);
}

// ---------------------------------------------------------------------------
// Minimal browser globals (node)
// ---------------------------------------------------------------------------
function makeStorage() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
globalThis.window = globalThis;
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
globalThis.location = {
  pathname: "/settings",
  origin: "https://roamie.tw",
  search: "",
  hash: "",
  replace() {},
};
globalThis.history = {
  state: null,
  replaceState(_s, _t, url) {
    globalThis.location.pathname = url;
  },
};
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.PopStateEvent = class PopStateEvent {
  constructor(type) {
    this.type = type;
  }
};
const M = globalThis.__m;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});

// ===========================================================================
// 1. OAuth callback: hash tokens are ignored
// ===========================================================================
const authUrl = await bundle("src/lib/auth-session-from-url.ts", {
  "@/lib/supabase": `export const supabase = { auth: {
      setSession: (...a) => globalThis.__m.setSession(...a),
      exchangeCodeForSession: (...a) => globalThis.__m.exchange(...a),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } };`,
  "@/lib/auth-session": `export const getClientAuthSession = async () => globalThis.__m.existing ?? null;`,
  "@/lib/clear-auth-state": `export const clearAuthState = async (o) => { globalThis.__m.cleared.push(o); };`,
  "@/lib/auth-debug": `export const logAuthDebug = () => {}; export const logAuthError = () => {}; export const logGoogleOAuthMarker = () => {};`,
  "@/lib/oauth-callback-guard": `export const markOAuthCodeConsumed = () => {};`,
  "@/lib/supabase-auth-storage": `export const restoreOAuthPkceVerifier = async () => true;`,
});

function resetAuthUrlMocks() {
  M.setSessionCalls = [];
  M.exchangeCalls = [];
  M.cleared = [];
  M.existing = null;
  M.setSession = async (arg) => {
    M.setSessionCalls.push(arg);
    return { data: { session: { user: { id: "attacker" } } }, error: null };
  };
  M.exchange = async (code) => {
    M.exchangeCalls.push(code);
    M.existing = { user: { id: "code-user" }, access_token: "x" };
    return { error: null };
  };
}

await check("S1a hash access_token/refresh_token（無 code、無既有 session）→ 拒絕，不呼叫 setSession", async () => {
  resetAuthUrlMocks();
  location.search = "";
  location.hash = "#access_token=attacker-at&refresh_token=attacker-rt&token_type=bearer";
  await assert.rejects(() => authUrl.resolveSessionFromCallbackUrl(), /登入連結不完整/);
  assert.equal(M.setSessionCalls.length, 0);
  assert.equal(M.exchangeCalls.length, 0);
});

await check("S1b hash tokens + 受害者既有 session → 維持受害者 session（method=existing），不換成攻擊者", async () => {
  resetAuthUrlMocks();
  M.existing = { user: { id: "victim" }, access_token: "victim-at" };
  location.search = "";
  location.hash = "#access_token=attacker-at&refresh_token=attacker-rt";
  const r = await authUrl.resolveSessionFromCallbackUrl();
  assert.equal(r.method, "existing");
  assert.equal(r.session.user.id, "victim");
  assert.equal(M.setSessionCalls.length, 0);
});

await check("S1c PKCE ?code= 仍正常兌換（method=code）", async () => {
  resetAuthUrlMocks();
  location.search = "?code=pkce-code-123";
  location.hash = "";
  const r = await authUrl.resolveSessionFromCallbackUrl();
  assert.equal(r.method, "code");
  assert.deepEqual(M.exchangeCalls, ["pkce-code-123"]);
  assert.equal(M.setSessionCalls.length, 0);
  location.search = "";
});

await check("S1d 模組不再匯出 setSessionFromUrlHash；src 非測試檔無 auth.setSession 呼叫；client 不偵測 URL session", () => {
  assert.equal("setSessionFromUrlHash" in authUrl, false);
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
        if (/auth\.setSession\s*\(/.test(read(rel))) offenders.push(rel);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
  const client = read("src/integrations/supabase/client.ts");
  assert.equal((client.match(/detectSessionInUrl: false/g) || []).length >= 1, true);
  assert.doesNotMatch(client, /detectSessionInUrl: true/);
  assert.match(client, /flowType: "pkce"/);
});

// ===========================================================================
// 2. /api/roamie credits
// ===========================================================================
const roamie = await bundle("src/routes/api/roamie.ts", {
  "@/lib/generated-locale": `export const encodeGeneratedChatContent = (s) => s;`,
  "@tanstack/react-router": `export const createFileRoute = () => (opts) => opts;`,
  "@/lib/ai/service.server": `
    export const parseRoamieRequest = (b) => b;
    export const callRoamieAI = (...a) => globalThis.__m.callAI(...a);
    export const streamRoamieAI = (...a) => globalThis.__m.streamAI(...a);`,
  "@/lib/access/context": `export const applyTierToAiContext = (ctx) => ctx;`,
  "@/lib/abuse-guard-enforcement.server": `export const isAbuseGuardEnforcementOn = () => false;`,
  "@/lib/abuse-guard-policy": `export const aiSurfaceForMode = () => "chat";`,
  "@/lib/ai/endpoint-guard.server": `
    export const requireAuthenticatedAiRequest = async () => globalThis.__m.auth;
    export const beginAiRequest = async (...a) => { globalThis.__m.count.begin++; return globalThis.__m.reserve(...a); };
    export const reserveServerCredits = async (...a) => { globalThis.__m.count.reserve++; return globalThis.__m.reserve(...a); };
    export const settleServerCredits = async (auth, reservation, success) => {
      globalThis.__m.settles.push(success);
      return globalThis.__m.settleResult(success);
    };
    export const rollbackServerCreditsByRequest = async () => { globalThis.__m.count.rollbackByRequest++; return true; };`,
  "@/lib/rate-limit.server": `export const AI_RATE_LIMITS = { chatPerMinute: 1000 }; export const checkRateLimit = () => ({ allowed: true });`,
  "@/lib/analytics/events": `export const analyticsOperationEventId = (a, b) => a + ":" + b;`,
  "@/lib/analytics/record.server": `export const recordAnalyticsEventServer = async () => {};`,
});

function resetRoamieMocks() {
  M.count = { begin: 0, reserve: 0, callAI: 0, streamAI: 0, rollbackByRequest: 0 };
  M.settles = [];
  M.inserts = [];
  M.auth = {
    userId: "free-user",
    hasPlusAccess: false,
    client: {
      from: () => ({
        insert: async (row) => {
          M.inserts.push(row);
          return { error: null };
        },
      }),
    },
  };
  M.reserve = async () => ({ reservation: { skipped: false, ledgerId: "ledger-1" }, response: null });
  M.settleResult = () => ({ ok: true });
  M.callAI = async () => {
    M.count.callAI++;
    return { summary: "AI result" };
  };
  M.streamAI = () => {
    M.count.streamAI++;
    return { stream: new ReadableStream({ start: (c) => c.close() }) };
  };
}
function roamieRequest(headers = {}) {
  return new Request("https://roamie.tw/api/roamie", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://roamie.tw", ...headers },
    body: JSON.stringify({ mode: "recommend", chatInput: "推薦咖啡廳" }),
  });
}
const POST = roamie.Route.server.handlers.POST;

await check("S2a X-Roamie-Cancel → 204；預扣／退點／生成呼叫次數皆 0", async () => {
  resetRoamieMocks();
  const res = await POST({ request: roamieRequest({ "x-roamie-cancel": "true" }) });
  assert.equal(res.status, 204);
  assert.deepEqual(M.count, { begin: 0, reserve: 0, callAI: 0, streamAI: 0, rollbackByRequest: 0 });
  assert.deepEqual(M.settles, []);
});

await check("S2b X-Roamie-Cancel + X-Roamie-Stream:false 仍不觸發完整生成", async () => {
  resetRoamieMocks();
  const res = await POST({
    request: roamieRequest({ "x-roamie-cancel": "true", "X-Roamie-Stream": "false" }),
  });
  assert.equal(res.status, 204);
  assert.equal(M.count.callAI + M.count.streamAI, 0);
});

await check("S2c 非串流正常生成：commit 一次、回 200 與結果（流程不變）", async () => {
  resetRoamieMocks();
  const res = await POST({ request: roamieRequest({ "X-Roamie-Stream": "false" }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: { summary: "AI result" } });
  assert.deepEqual(M.settles, [true]);
  assert.equal(M.count.reserve, 1);
  assert.equal(M.count.callAI, 1);
});

await check("S2d 非串流 commit 被拒（ok:false）→ 不交付結果、不寫聊天紀錄", async () => {
  resetRoamieMocks();
  M.settleResult = (success) => (success ? { ok: false, reason: "not_found" } : { ok: true });
  const res = await POST({ request: roamieRequest({ "X-Roamie-Stream": "false" }) });
  assert.notEqual(res.status, 200);
  const body = await res.json();
  assert.equal(JSON.stringify(body).includes("AI result"), false);
  assert.equal(M.inserts.length, 0);
  assert.deepEqual(M.settles, [true]);
});

await check("S2e 非串流伺服器失敗 → rollback 一次（退點流程不變）", async () => {
  resetRoamieMocks();
  M.callAI = async () => {
    M.count.callAI++;
    throw new Error("provider down");
  };
  const res = await POST({ request: roamieRequest({ "X-Roamie-Stream": "false" }) });
  assert.equal(res.status, 500);
  assert.deepEqual(M.settles, [false]);
});

const guard = await bundle("src/lib/ai/endpoint-guard.server.ts", {
  "@/lib/abuse-guard-telemetry.server": `export const aiObservation = () => ({}); export const observeCredit = () => {}; export const observeCreditReserveAttempt = () => () => {};`,
  "@supabase/supabase-js": `export const createClient = () => { throw new Error("no network client in test"); };`,
  "@/lib/abuse-guard.server": `export const authorizeAiUse = async () => ({ ok: true });`,
  "@/lib/abuse-guard-enforcement.server": `export const isAbuseGuardEnforcementOn = () => false;`,
  "@/lib/plan-tier/entitlement": `export const parsePlusEntitlementSnapshot = () => null;`,
  "@/lib/worker-request-scope": `export const bindVerifiedUserId = () => {};`,
});

await check("S2f settleServerCredits：走 service role（auth.creditsClient）並帶 p_user_id；ok:false／RPC error／空回應皆回 ok:false；skipped 不打 RPC；使用者 client 零呼叫", async () => {
  const calls = [];
  const userCalls = [];
  const authWith = (result) => ({
    userId: "verified-user",
    client: {
      rpc: async (fn) => {
        userCalls.push(fn);
        return { data: { ok: true }, error: null };
      },
    },
    creditsClient: {
      rpc: async (fn, args) => {
        calls.push([fn, args]);
        return result;
      },
    },
  });
  const reservation = { skipped: false, ledgerId: "L1", idempotencyKey: "K1" };
  assert.deepEqual(
    await guard.settleServerCredits(authWith({ data: { ok: true }, error: null }), reservation, true),
    { ok: true },
  );
  assert.deepEqual(
    await guard.settleServerCredits(
      authWith({ data: { ok: false, reason: "not_found" }, error: null }),
      reservation,
      true,
    ),
    { ok: false, reason: "not_found" },
  );
  assert.deepEqual(
    await guard.settleServerCredits(authWith({ data: null, error: { message: "jwt expired" } }), reservation, true),
    { ok: false, reason: "rpc_error" },
  );
  assert.equal(
    (await guard.settleServerCredits(authWith({ data: null, error: null }), reservation, true)).ok,
    false,
  );
  assert.deepEqual(calls[0], [
    "credits_commit",
    { p_ledger_id: "L1", p_idempotency_key: null, p_user_id: "verified-user" },
  ]);
  const before = calls.length;
  assert.deepEqual(
    await guard.settleServerCredits(authWith({ data: null, error: null }), { skipped: true }, true),
    { ok: true },
  );
  assert.equal(calls.length, before);
  await guard.settleServerCredits(authWith({ data: { ok: true }, error: null }), reservation, false);
  assert.equal(calls.at(-1)[0], "credits_rollback");
  assert.equal(calls.at(-1)[1].p_user_id, "verified-user");
  // creditsClient 缺失 → fail closed（rpc_error），不退回使用者 JWT client
  const noCredits = authWith({ data: { ok: true }, error: null });
  delete noCredits.creditsClient;
  assert.deepEqual(await guard.settleServerCredits(noCredits, reservation, true), { ok: false, reason: "rpc_error" });
  assert.deepEqual(userCalls, [], "user JWT client never settles credits");
});

await check("S2-stream 串流路徑：commit 必須先於交付 final/done（commit 失敗要視為失敗）", () => {
  // service.server.ts 目前先 enqueue final/done，再 await complete() → onComplete → settleCredits(true)。
  // commit 被拒（例如使用者 JWT 在串流期間過期 → rpc_error）時，結果早已送達客戶端，ok:false 被忽略。
  const service = read("src/lib/ai/service.server.ts");
  const doneAt = service.indexOf("enqueue(`event: done");
  const finalAt = service.indexOf("enqueue(`event: final");
  const completeAt = service.indexOf("await complete({\n          assembled: finalPayload");
  assert.ok(doneAt > 0 && finalAt > 0 && completeAt > 0, "anchors present");
  assert.ok(
    completeAt < finalAt && completeAt < doneAt,
    "串流在 commit 結果出來前就送出 final/done；commit 失敗仍交付結果（roamie.ts onComplete 也忽略 settleCredits(true) 的回傳值）",
  );
});

// ===========================================================================
// 3. removeTripMember → RPC + invite token cache cleared
// ===========================================================================
const collab = await bundle("src/lib/trip/trip-collab.ts", {
  "@capacitor/core": `export const registerPlugin = () => ({});`,
  "@/integrations/supabase/client": `export const supabase = {
      rpc: (...a) => globalThis.__m.rpc(...a),
      from: (t) => globalThis.__m.from(t),
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    };`,
  "@/lib/auth-session": `export const getAuthenticatedUserId = async () => "owner-1";`,
  "@/services/platform": `export const detectPlatform = () => ({ isCapacitor: false, isIOS: false });`,
  "@/lib/copy-to-clipboard": `export const copyTextToClipboard = async () => ({ ok: true });`,
  "@/lib/i18n/trip-workspace-copy": `export const getTripWorkspaceCopy = () => new Proxy({}, { get: (_t, k) => String(k) });
    export const formatTripWorkspaceTemplate = (s) => s;`,
});

await check("S3a removeTripMember 呼叫 remove_trip_member RPC，不直接刪 trip_members；舊連結快取清掉，下次分享取新 token", async () => {
  const rpcCalls = [];
  const fromCalls = [];
  let token = "OLD-TOKEN-aaaaaaaaaaaaaaaaaaaaaaa";
  M.rpc = async (fn, args) => {
    rpcCalls.push([fn, args]);
    if (fn === "create_trip_invite") return { data: [{ invite_id: "i", invite_token: token }], error: null };
    if (fn === "remove_trip_member") {
      token = "NEW-TOKEN-bbbbbbbbbbbbbbbbbbbbbbb";
      return { data: true, error: null };
    }
    return { data: null, error: { message: "unexpected rpc " + fn } };
  };
  M.from = (t) => {
    fromCalls.push(t);
    throw new Error("unexpected table access " + t);
  };
  let notified = 0;
  const unsub = collab.subscribeTripInviteState(() => notified++);
  assert.equal(await collab.getOrCreateTripInviteToken("trip-1"), "OLD-TOKEN-aaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(collab.peekTripInviteToken("trip-1"), "OLD-TOKEN-aaaaaaaaaaaaaaaaaaaaaaa");
  const n0 = notified;
  await collab.removeTripMember("trip-1", "member-9");
  assert.deepEqual(rpcCalls.at(-1), [
    "remove_trip_member",
    { p_trip_id: "trip-1", p_member_user_id: "member-9" },
  ]);
  assert.deepEqual(fromCalls, []);
  assert.equal(collab.peekTripInviteToken("trip-1"), null);
  assert.ok(notified > n0, "listeners notified so the open share panel refetches");
  assert.equal(await collab.getOrCreateTripInviteToken("trip-1"), "NEW-TOKEN-bbbbbbbbbbbbbbbbbbbbbbb");
  unsub();
});

await check("S3b remove_trip_member RPC 失敗 → 丟錯，快取不動", async () => {
  M.rpc = async (fn) =>
    fn === "remove_trip_member"
      ? { data: null, error: { message: "not_trip_owner", code: "42501" } }
      : { data: null, error: { message: "x" } };
  const before = collab.peekTripInviteToken("trip-1");
  await assert.rejects(() => collab.removeTripMember("trip-1", "member-9"), /not_trip_owner/);
  assert.equal(collab.peekTripInviteToken("trip-1"), before);
});

// ===========================================================================
// 4 + SQL static review
// ===========================================================================
const sql = read("supabase/migrations/20261109100000_security_audit_remediation.sql");
const fnBody = (name) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `function ${name} present`);
  const end = sql.indexOf("$$;", sql.indexOf("AS $$", start));
  return sql.slice(start, end);
};

await check("SQL-a 每個 SECURITY DEFINER 函式都有 SET search_path；全部 CREATE OR REPLACE；未加入 realtime publication", () => {
  const blocks = sql.split(/CREATE OR REPLACE FUNCTION /).slice(1);
  // credits_reserve／commit／rollback（Section A）＋ remove_trip_member ＋ protect_saved_trip_owner
  // ＋ transfer_owned_shared_trips_for_deletion
  assert.deepEqual(
    blocks.map((b) => b.slice(0, b.indexOf("(")).replace(/^public\./, "")),
    [
      "credits_reserve",
      "credits_commit",
      "credits_rollback",
      "remove_trip_member",
      "protect_saved_trip_owner",
      "transfer_owned_shared_trips_for_deletion",
    ],
  );
  assert.equal(blocks.filter((b) => /SECURITY DEFINER/.test(b.slice(0, b.indexOf("AS $$")))).length, 5);
  for (const b of blocks) {
    const header = b.slice(0, b.indexOf("AS $$"));
    if (/SECURITY DEFINER/.test(header)) assert.match(header, /SET search_path = public/, header.split("(")[0]);
  }
  assert.doesNotMatch(sql, /^\s*CREATE FUNCTION/m);
  assert.doesNotMatch(sql, /^\s*CREATE (TABLE|INDEX|POLICY|TRIGGER)\b/m);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /supabase_realtime/);
});

await check("SQL-b remove_trip_member：只給 authenticated；先驗 is_trip_owner；不能移除擁有者；同交易撤銷分享連結", () => {
  const body = fnBody("remove_trip_member");
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.remove_trip_member\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.remove_trip_member\(uuid, uuid\) TO authenticated;/);
  assert.ok(body.indexOf("is_trip_owner(p_trip_id)") < body.indexOf("DELETE FROM public.trip_members"));
  assert.match(body, /cannot_remove_owner/);
  assert.match(body, /AND NOT tm\.is_owner/);
  assert.match(body, /UPDATE public\.trip_invites ti\s+SET revoked_at = now\(\)/);
  assert.match(body, /ti\.is_link AND ti\.revoked_at IS NULL/);
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\('trip_invite:' \|\| p_trip_id::text, 0\)\)/);
});

await check("SQL-c trip_members：客戶端 DELETE/UPDATE 撤銷且 policy 移除（INSERT 已於 20260909100000 撤銷）", () => {
  assert.match(sql, /DROP POLICY IF EXISTS "trip_members_delete_owner" ON public\.trip_members;/);
  assert.match(sql, /REVOKE DELETE ON public\.trip_members FROM anon, authenticated;/);
  assert.match(sql, /DROP POLICY IF EXISTS "trip_members_update_owner" ON public\.trip_members;/);
  assert.match(sql, /REVOKE UPDATE ON public\.trip_members FROM anon, authenticated;/);
  const prior = read("supabase/migrations/20260909100000_security_remediation.sql");
  assert.match(prior, /REVOKE INSERT ON public\.trip_members FROM anon, authenticated;/);
  // No later migration re-creates trip_members write policies / grants.
  for (const f of fs.readdirSync(path.join(root, "supabase/migrations"))) {
    if (f <= "20260909100000") continue;
    const text = read("supabase/migrations/" + f);
    assert.doesNotMatch(text, /CREATE POLICY "trip_members_(insert|update|delete)/, f);
    assert.doesNotMatch(text, /GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]* ON (TABLE )?public\.trip_members TO [^;]*authenticated/, f);
  }
});

await check("S4 src 非測試檔沒有對 trip_members 做 insert/update/delete/upsert", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
        const text = read(rel);
        const re = /\.from\(\s*["'`]trip_members["'`]\s*\)([\s\S]{0,200})/g;
        let m;
        while ((m = re.exec(text))) {
          const chain = m[1].split(/;\s*\n/)[0];
          if (/\.(insert|update|delete|upsert)\s*\(/.test(chain)) offenders.push(rel);
        }
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

await check("SQL-d transfer_owned_shared_trips_for_deletion 只給 service_role；選最早 accepted 成員；solo 不動", () => {
  const body = fnBody("transfer_owned_shared_trips_for_deletion");
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.transfer_owned_shared_trips_for_deletion\(uuid\)\s+FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.transfer_owned_shared_trips_for_deletion\(uuid\) TO service_role;/);
  assert.doesNotMatch(sql, /transfer_owned_shared_trips_for_deletion\(uuid\) TO (authenticated|anon|PUBLIC)/);
  assert.match(body, /tm\.status = 'accepted'/);
  assert.match(body, /ORDER BY tm\.created_at ASC, tm\.id ASC/);
  assert.match(body, /IF v_new_owner IS NULL THEN CONTINUE; END IF;/);
});

await check("SQL-e protect_saved_trip_owner：anon/authenticated 仍不能改 user_id", () => {
  const body = fnBody("protect_saved_trip_owner");
  assert.match(body, /NEW\.user_id IS DISTINCT FROM OLD\.user_id\s+AND current_user IN \('anon', 'authenticated'\)/);
  assert.match(body, /RAISE EXCEPTION 'saved trip owner is immutable'/);
  assert.match(body, /SECURITY INVOKER/);
});

await check("SQL-f credits_commit：rolled_back 改為扣點且不碰 reserved、不變負數；正常路徑運算與舊版相同", () => {
  const body = fnBody("credits_commit");
  assert.doesNotMatch(body, /already_rolled_back/);
  assert.match(body, /v_after_rollback := v_ledger\.status = 'rolled_back';/);
  const accountsAfter = body.slice(body.indexOf("IF v_after_rollback THEN", body.indexOf("ELSE\n    IF v_after_rollback")));
  assert.match(accountsAfter, /available_credits = GREATEST\(0, available_credits - v_ledger\.amount\)/);
  // Normal path statements unchanged vs 20260723130000.
  const prior = read("supabase/migrations/20260723130000_credits_debug_override_stale_env.sql");
  const normal =
    "available_credits = available_credits - v_ledger.amount,\n        reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),";
  assert.ok(body.split(normal).length - 1 === 2, "normal debug + production update present");
  assert.ok(prior.includes(normal.replace(/\n        /g, "\n      ")));
  assert.match(body, /IF v_ledger\.status = 'committed' THEN/);
  assert.match(body, /FOR UPDATE;/);
});

await check("SQL-h 客戶端自行 credits_rollback 伺服器預扣後，並行請求不能全部以 0 成本 commit", () => {
  // 伺服器預扣的 idempotency key 可由客戶端推得：server:<uid>:<feature>:<X-Roamie-Request-Id>，
  // 且 credits_rollback 仍授權給 authenticated。rolled_back 分支用 GREATEST(0, …) 夾住且不 RAISE，
  // 1 點的免費用戶可「預扣→立刻自行 rollback→再預扣」讓 N 個請求同時在途，全部 commit 成功、總共只扣到 0。
  const guardSrc = read("src/lib/ai/endpoint-guard.server.ts");
  assert.match(guardSrc, /server:\$\{auth\.userId\}:\$\{featureType\}:\$\{requestId\}/);
  const commit = fnBody("credits_commit");
  const clampsAfterRollback = /IF v_after_rollback THEN[\s\S]*?GREATEST\(0, available_credits - v_ledger\.amount\)/.test(commit);
  const clientRollbackClosed =
    /REVOKE[^;]*credits_rollback\(uuid, text\)[^;]*authenticated/.test(sql) ||
    /FUNCTION public\.credits_rollback\([\s\S]*?server:%/.test(sql);
  assert.ok(
    !clampsAfterRollback || clientRollbackClosed,
    "rolled_back 後 commit 夾到 0 且客戶端仍可 rollback 伺服器預扣 → 1 點可換 N 次生成",
  );
});

await check("SQL-i credits_reserve／commit／rollback：service_role 必須帶 p_user_id；authenticated 只能 NULL 或等於 auth.uid()（不能冒用）；列查詢一律綁 v_uid", () => {
  for (const name of ["credits_reserve", "credits_commit", "credits_rollback"]) {
    const body = fnBody(name);
    assert.match(body, /p_user_id uuid DEFAULT NULL/, name);
    assert.match(body, /v_service boolean := COALESCE\(auth\.role\(\), ''\) = 'service_role';/, name);
    assert.match(body, /IF v_service THEN\s+v_uid := p_user_id;\s+IF v_uid IS NULL THEN\s+RAISE EXCEPTION 'user_id required'/, name);
    assert.match(
      body,
      /ELSE\s+v_uid := auth\.uid\(\);[\s\S]*?IF p_user_id IS NOT NULL AND p_user_id <> v_uid THEN\s+RAISE EXCEPTION 'user_id mismatch'/,
      name,
    );
    // Every ledger lookup / account update is scoped to v_uid (never p_user_id directly).
    assert.doesNotMatch(body.replace(/v_uid := p_user_id;/, ""), new RegExp("[=] p_user_id\\b"), name);
    for (const m of body.matchAll(/FROM public\.credit_ledger\s+WHERE ([^;]+);/g)) assert.match(m[1], /user_id = v_uid/, name);
  }
  // Grants: anon/PUBLIC revoked; only authenticated + service_role.
  for (const sig of ["credits_reserve(text, text, text, integer, jsonb, uuid)", "credits_commit(uuid, text, uuid)", "credits_rollback(uuid, text, uuid)"]) {
    const esc = sig.replace(/[()]/g, "\\$&");
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc}\\s+FROM PUBLIC, anon;`), sig);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc}\\s+TO authenticated, service_role;`), sig);
  }
});

await check("SQL-j service_managed：只有 service_role 預扣才寫入、呼叫端傳入的值被剝除；server: 且 service_managed 的列，客戶端 commit／rollback 一律 42501", () => {
  const reserve = fnBody("credits_reserve");
  assert.match(reserve, /\(COALESCE\(p_metadata, '\{\}'::jsonb\) - 'service_managed'\)/);
  assert.match(reserve, /CASE WHEN v_service THEN jsonb_build_object\('service_managed', true\)\s+ELSE '\{\}'::jsonb END/);
  // The override flag is merged *before* the service flag, so p_metadata cannot win the merge.
  assert.ok(reserve.indexOf("- 'service_managed'") < reserve.indexOf("jsonb_build_object('service_managed', true)"));
  for (const name of ["credits_commit", "credits_rollback"]) {
    const body = fnBody(name);
    const guardAt = body.indexOf("server_managed_ledger");
    assert.ok(guardAt > 0, name);
    assert.match(
      body,
      /IF NOT v_service\s+AND v_ledger\.idempotency_key LIKE 'server:%'\s+AND COALESCE\(v_ledger\.metadata ->> 'service_managed', ''\) = 'true'\s+THEN\s+RAISE EXCEPTION 'server_managed_ledger' USING ERRCODE = '42501';/,
      name,
    );
    // Guard runs right after the row lookup, before any status branch / balance update.
    assert.ok(guardAt < body.indexOf("IF v_ledger.status = 'committed'") || name === "credits_rollback", name);
    assert.ok(guardAt < body.indexOf("UPDATE public.credit_accounts"), name);
    assert.ok(guardAt < body.indexOf("UPDATE public.credit_debug_overrides"), name);
  }
});

await check("SQL-k credit_ledger／credit_accounts：所有 migration 都沒有客戶端寫入 policy 或 INSERT/UPDATE/DELETE grant（metadata 無法被客戶端改寫）", () => {
  for (const f of fs.readdirSync(path.join(root, "supabase/migrations"))) {
    const text = read("supabase/migrations/" + f).replace(/^--.*$/gm, "");
    for (const t of ["credit_ledger", "credit_accounts", "credit_debug_overrides"]) {
      assert.doesNotMatch(text, new RegExp(`CREATE POLICY[^;]*ON public\\.${t}\\s+FOR (INSERT|UPDATE|DELETE|ALL)`, "i"), `${f} ${t}`);
      assert.doesNotMatch(
        text,
        new RegExp(`GRANT [^;]*(INSERT|UPDATE|DELETE|ALL)[^;]* ON (TABLE )?public\\.${t} TO [^;]*(authenticated|anon|PUBLIC)`, "i"),
        `${f} ${t}`,
      );
    }
    // Helper functions that move balances stay service_role-only after 20260909100000.
    if (f > "20260909100000")
      assert.doesNotMatch(text, /GRANT EXECUTE ON FUNCTION public\.credits_(release_stale_reservations|ensure_account|effective_balance)\([^)]*\) TO [^;]*authenticated/, f);
  }
});

await check("SQL-l remove_trip_member：撤銷連結後，同交易取消發給被移除者的 pending 一次性邀請（user_id 或 email），不動其他人的邀請", () => {
  const body = fnBody("remove_trip_member");
  const linkAt = body.indexOf("ti.is_link AND ti.revoked_at IS NULL");
  const oneTimeAt = body.indexOf("AND NOT ti.is_link");
  assert.ok(linkAt > 0 && oneTimeAt > linkAt);
  const oneTime = body.slice(oneTimeAt);
  assert.match(oneTime, /AND ti\.status = 'pending'/);
  assert.match(oneTime, /ti\.invitee_user_id = p_member_user_id/);
  assert.match(oneTime, /lower\(ti\.invitee_email\) = \(\s+SELECT lower\(u\.email\) FROM auth\.users u WHERE u\.id = p_member_user_id/);
  // Only when a membership row was actually removed.
  assert.ok(body.indexOf("IF v_removed > 0 THEN") < linkAt);
});

await check("SQL-m 相容性：舊 2／5 參數簽章先 DROP 再建立（PostgREST 不會有兩個候選）；新參數皆有 DEFAULT，舊 Worker 的具名參數呼叫仍可解析", () => {
  const order = [
    ["DROP FUNCTION IF EXISTS public.credits_reserve(text, text, text, integer, jsonb);", "CREATE OR REPLACE FUNCTION public.credits_reserve("],
    ["DROP FUNCTION IF EXISTS public.credits_commit(uuid, text);", "CREATE OR REPLACE FUNCTION public.credits_commit("],
    ["DROP FUNCTION IF EXISTS public.credits_rollback(uuid, text);", "CREATE OR REPLACE FUNCTION public.credits_rollback("],
  ];
  for (const [drop, create] of order) {
    assert.ok(sql.indexOf(drop) >= 0 && sql.indexOf(drop) < sql.indexOf(create), drop);
  }
  assert.match(fnBody("credits_reserve"), /p_amount integer DEFAULT NULL,\s+p_metadata jsonb DEFAULT '\{\}'::jsonb,\s+p_user_id uuid DEFAULT NULL/);
  assert.match(fnBody("credits_commit"), /p_ledger_id uuid DEFAULT NULL,\s+p_idempotency_key text DEFAULT NULL,\s+p_user_id uuid DEFAULT NULL/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
});

await check("SQL-g service_role 欄位權限涵蓋刪帳號封面搬移實際讀寫的欄位", () => {
  const acct = read("src/lib/account-deletion/account-deletion.server.ts");
  assert.match(acct, /\.select\("id,user_id,custom_cover_image_url,cover_image_url,cover_image"\)/);
  assert.match(
    sql,
    /GRANT SELECT \(id, user_id, custom_cover_image_url, cover_image_url, cover_image\)\s+ON public\.saved_trips TO service_role;/,
  );
  assert.match(sql, /GRANT UPDATE \(custom_cover_image_url, cover_image_url, cover_image\)\s+ON public\.saved_trips TO service_role;/);
});

// ===========================================================================
// 5. Logout
// ===========================================================================
const clearAuth = await bundle("src/lib/clear-auth-state.ts", {
  "@capacitor/preferences": `export const Preferences = { keys: async () => ({ keys: [] }), remove: async () => {} };`,
  "@/lib/auth-post-redirect": `export const resetPostAuthRedirect = () => {};`,
  "@/lib/login-navigation": `export const resetPostLoginNavigation = () => {};`,
  "@/lib/auth-pending-action": `export const clearPendingAuthAction = () => {};`,
  "@/lib/auth-oauth-deep-link": `export const clearPendingCallbackPath = () => {}; export const OAUTH_PENDING_CALLBACK_KEY = "roamie:oauth-pending-callback";`,
  "@/lib/oauth-callback-guard": `export const clearOAuthCodeConsumedMarker = () => {};`,
  "@/lib/supabase-auth-storage": `
    export const readHydratedAuthSessionRaw = () => globalThis.localStorage.getItem("roamie-auth");
    export const clearAuthMemoryCache = () => { globalThis.__m.events.push("sync-clear"); };
    export const clearPersistedAuthSession = async () => { globalThis.__m.events.push("persisted-clear"); globalThis.localStorage.removeItem("roamie-auth"); };`,
  "@/lib/companion-mode-storage": `export const clearCompanionModeSelection = () => {};`,
  "@/lib/supabase": `export const supabase = { auth: {
      signOut: (...a) => globalThis.__m.signOut(...a),
      admin: {
        get url() { return globalThis.__m.adminUrl; },
        get headers() { return globalThis.__m.adminHeaders; },
        signOut: (...a) => globalThis.__m.adminSignOut(...a),
      },
    } };`,
  "@/services/platform": `export const detectPlatform = () => ({ isCapacitor: false, isIOS: false });`,
  "@/lib/profile-session-cache": `export const clearProfileSessionCache = () => {};`,
  "@/lib/app-boot-cache": `export const resetAppBootCachesForUserChange = () => {};`,
  "@/lib/travel-pref-result-cache": `export const clearTravelPrefResultCache = () => {};`,
  "@/lib/home-trip-snapshot": `export const isHomeTripSummarySnapshotKey = () => false;`,
  "@/lib/saved-list-snapshot": `export const isSavedListSnapshotKey = () => false;`,
  "@/lib/oauth-app-navigate": `export const navigateOAuthAppPath = async (p) => { globalThis.__m.events.push("navigate:" + p); };`,
  "@/lib/onboarding-storage": `export const clearOnboardingCompleted = () => {};`,
  "@/lib/ios-snapshot-bridge": `export const ensureIosLoginLiveInteraction = () => {}; export const notifyIosOAuthReturn = () => {}; export const scheduleIosSnapshotRefreshBurst = () => {};`,
});
const SESSION_RAW = JSON.stringify({ access_token: "user-access-jwt", refresh_token: "user-refresh" });
function resetLogoutMocks(sessionRaw = SESSION_RAW) {
  M.events = [];
  M.signOutArgs = [];
  M.adminArgs = [];
  M.fetchCalls = [];
  M.fetchHandler = undefined;
  M.adminUrl = "https://offline-mock.supabase.invalid/auth/v1";
  M.adminHeaders = { apikey: "anon-placeholder", Authorization: "Bearer anon-placeholder" };
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("roamie-auth", sessionRaw);
  localStorage.setItem("roamie:user-profile", "{}");
  location.pathname = "/settings";
  M.signOut = async (...a) => {
    M.signOutArgs.push(a);
    M.events.push("signOut(storage=" + (localStorage.getItem("roamie-auth") ? "present" : "empty") + ")");
    return { error: null };
  };
  M.adminSignOut = async (...a) => {
    M.adminArgs.push(a);
    M.events.push("adminSignOut");
    return { data: null, error: null };
  };
}

await check("S5a clearAuthState：先擷取 token → 同步清本機 → 並行 admin.signOut(擷取的 JWT, local) 與本機 signOut（此時 storage 已空，auth-js 不會再打 /logout）", async () => {
  resetLogoutMocks();
  await clearAuth.clearAuthState({ reason: "user-sign-out" });
  assert.equal(M.events[0], "sync-clear", M.events.join(","));
  assert.ok(M.events.indexOf("sync-clear") < M.events.indexOf("adminSignOut"));
  assert.deepEqual(M.adminArgs, [["user-access-jwt", "local"]], "server revoke uses the token captured before clearing");
  assert.ok(M.events.indexOf("persisted-clear") < M.events.indexOf("signOut(storage=empty)"), M.events.join(","));
  assert.deepEqual(M.signOutArgs, [[{ scope: "local" }]]);
  assert.equal(localStorage.getItem("roamie-auth"), null);
  assert.equal(localStorage.getItem("roamie:user-profile"), null);
  assert.deepEqual(M.fetchCalls, [], "valid token: no extra token exchange request");
});

await check("S5a2 撤銷永不回應（離線卡住）→ 3 秒內回來、本機 signOut 仍執行（發 SIGNED_OUT 的路徑）且 storage 清空", async () => {
  resetLogoutMocks();
  M.adminSignOut = (...a) => {
    M.adminArgs.push(a);
    return never();
  };
  const t0 = Date.now();
  await clearAuth.clearAuthState({ reason: "user-sign-out" });
  const ms = Date.now() - t0;
  assert.ok(ms < 3_500, `took ${ms}ms`);
  assert.deepEqual(M.signOutArgs, [[{ scope: "local" }]]);
  assert.equal(localStorage.getItem("roamie-auth"), null);
});

await check("S5b clearAuthState：signOut 永不回應（離線卡住）→ 逾時後仍清乾淨（≤ 3.5s）", async () => {
  resetLogoutMocks();
  M.signOut = () => never();
  const t0 = Date.now();
  await clearAuth.clearAuthState({ reason: "user-sign-out" });
  const ms = Date.now() - t0;
  assert.ok(ms < 3_500, `took ${ms}ms`);
  assert.equal(localStorage.getItem("roamie-auth"), null);
  assert.ok(M.events.includes("persisted-clear"));
});

await check("S5c clearAuthState：signOut reject（網路錯誤）／回傳 error → 不丟錯且仍清乾淨", async () => {
  resetLogoutMocks();
  M.signOut = async () => {
    throw new TypeError("Failed to fetch");
  };
  await clearAuth.clearAuthState({ reason: "x" });
  assert.equal(localStorage.getItem("roamie-auth"), null);
  resetLogoutMocks();
  M.signOut = async () => ({ error: { name: "AuthRetryableFetchError", status: 0 } });
  await clearAuth.clearAuthState({ reason: "x" });
  assert.equal(localStorage.getItem("roamie-auth"), null);
});

await check("S5d resetToLoginScreen：導向不等撤銷；背景以清除前擷取的使用者 access token 撤銷（只帶 JWT＋scope）", async () => {
  resetLogoutMocks();
  M.adminSignOut = (...a) => {
    M.adminArgs.push(a);
    M.events.push("adminSignOut");
    return never();
  };
  const t0 = Date.now();
  await clearAuth.resetToLoginScreen("settings-sign-out");
  assert.ok(Date.now() - t0 < 500, "navigation not blocked by revocation");
  assert.ok(M.events.includes("navigate:/login"));
  assert.equal(localStorage.getItem("roamie-auth"), null, "local session cleared synchronously");
  await sleep(10);
  assert.deepEqual(M.adminArgs, [["user-access-jwt", "local"]]);
  await sleep(3_100); // let the background race time out before the next case
  assert.ok(M.events.includes("persisted-clear"), "local persisted clear still runs after revoke timeout");
});

await check("S5e clearDeletedAccountLocalData：用清除前擷取的 token 呼叫撤銷，本機清空", async () => {
  resetLogoutMocks();
  await clearAuth.clearDeletedAccountLocalData("user-123");
  assert.deepEqual(M.adminArgs, [["user-access-jwt", "local"]]);
  assert.equal(localStorage.getItem("roamie-auth"), null);
});

await check("S5f 客戶端 supabase 不含 service role key；clear-auth-state 不讀任何 key", () => {
  for (const f of ["src/integrations/supabase/client.ts", "src/lib/supabase.ts", "src/lib/clear-auth-state.ts"]) {
    if (!fs.existsSync(path.join(root, f))) continue;
    assert.doesNotMatch(read(f), /SERVICE_ROLE|service_role|serviceKey/i, f);
  }
});

const nowSec = () => Math.floor(Date.now() / 1000);
const fakeJwt = (claims) => `${b64urlLocal({ alg: "HS256" })}.${b64urlLocal(claims)}.sig`;
function b64urlLocal(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function captureWarn() {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(" "));
  return { warns, restore: () => (console.warn = orig) };
}

await check("S5g access token 快過期（expires_at）→ 先以 refresh token POST /token 換新，再用新 token 撤銷；新 session 不寫回本機", async () => {
  resetLogoutMocks(
    JSON.stringify({ access_token: "old-jwt", refresh_token: "user-refresh", expires_at: nowSec() + 10 }),
  );
  M.fetchHandler = async (url, init) => {
    M.fetchCalls.push({ url, method: init.method, body: init.body, headers: init.headers });
    if (url === M.adminUrl + "/token?grant_type=refresh_token")
      return new Response(JSON.stringify({ access_token: "fresh-jwt", refresh_token: "rotated" }), { status: 200 });
    return undefined;
  };
  await clearAuth.clearAuthState({ reason: "user-sign-out" });
  assert.equal(M.fetchCalls.length, 1);
  assert.equal(M.fetchCalls[0].method, "POST");
  assert.deepEqual(JSON.parse(M.fetchCalls[0].body), { refresh_token: "user-refresh" });
  assert.equal(M.fetchCalls[0].headers.apikey, "anon-placeholder");
  assert.deepEqual(M.adminArgs, [["fresh-jwt", "local"]]);
  assert.equal(localStorage.getItem("roamie-auth"), null, "exchanged session never persisted");
  assert.deepEqual(M.signOutArgs, [[{ scope: "local" }]]);
});

await check("S5h 快過期判斷可退回 JWT exp（無 expires_at）；換 token 失敗（400／離線 TypeError）→ 只記 warn、不撤銷、本機照清", async () => {
  for (const failure of ["http400", "offline"]) {
    resetLogoutMocks(JSON.stringify({ access_token: fakeJwt({ exp: nowSec() - 60 }), refresh_token: "user-refresh" }));
    M.fetchHandler = async (url) => {
      M.fetchCalls.push({ url });
      if (failure === "offline") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    };
    const cap = captureWarn();
    try {
      await clearAuth.clearAuthState({ reason: "user-sign-out" });
    } finally {
      cap.restore();
    }
    assert.equal(M.fetchCalls.length, 1, failure);
    assert.deepEqual(M.adminArgs, [], failure + ": no revoke with an expired token");
    assert.ok(cap.warns.some((w) => /token exchange for revoke failed/.test(w)), failure + " warn: " + cap.warns.join(" | "));
    assert.equal(localStorage.getItem("roamie-auth"), null, failure);
    assert.deepEqual(M.signOutArgs, [[{ scope: "local" }]], failure);
  }
});

await check("S5i 快過期但沒有 refresh token → 不送任何請求、warn、本機照清", async () => {
  resetLogoutMocks(JSON.stringify({ access_token: "old-jwt", expires_at: nowSec() - 5 }));
  M.fetchHandler = async (url) => {
    M.fetchCalls.push({ url });
    return undefined;
  };
  const cap = captureWarn();
  try {
    await clearAuth.clearAuthState({ reason: "x" });
  } finally {
    cap.restore();
  }
  assert.deepEqual(M.fetchCalls, []);
  assert.deepEqual(M.adminArgs, []);
  assert.ok(cap.warns.some((w) => /token exchange for revoke failed/.test(w)));
  assert.equal(localStorage.getItem("roamie-auth"), null);
});

// ---------------------------------------------------------------------------
// 5R. 真實 auth-js（@supabase/supabase-js 2.106.1）＋ mock 離線 fetch
// ---------------------------------------------------------------------------
const AUTH_MEM = new Map();
M.authMem = AUTH_MEM;
const realAuthMocks = {
  "@capacitor/preferences": `export const Preferences = { keys: async () => ({ keys: [] }), remove: async () => {} };`,
  "@/lib/auth-post-redirect": `export const resetPostAuthRedirect = () => {};`,
  "@/lib/login-navigation": `export const resetPostLoginNavigation = () => {};`,
  "@/lib/auth-pending-action": `export const clearPendingAuthAction = () => {};`,
  "@/lib/auth-oauth-deep-link": `export const clearPendingCallbackPath = () => {}; export const OAUTH_PENDING_CALLBACK_KEY = "roamie:oauth-pending-callback";`,
  "@/lib/oauth-callback-guard": `export const clearOAuthCodeConsumedMarker = () => {};`,
  "@/lib/supabase-auth-storage": `
    export const readHydratedAuthSessionRaw = () => globalThis.__m.authMem.get("roamie-auth") ?? null;
    export const clearAuthMemoryCache = () => {};
    export const clearPersistedAuthSession = async () => { globalThis.__m.authMem.delete("roamie-auth"); };`,
  "@/lib/companion-mode-storage": `export const clearCompanionModeSelection = () => {};`,
  // Real supabase-js / auth-js client; only the network (global fetch) and storage are fakes.
  "@/lib/supabase":
    "imp" + `ort { createClient } from "@supabase/supabase-js";
    const mem = globalThis.__m.authMem;
    export const supabase = createClient("https://offline-mock.supabase.invalid", "anon-placeholder", {
      auth: {
        storage: {
          getItem: (k) => (mem.has(k) ? mem.get(k) : null),
          setItem: (k, v) => { mem.set(k, v); },
          removeItem: (k) => { mem.delete(k); },
        },
        storageKey: "roamie-auth",
        persistSession: true,
        autoRefreshToken: Boolean(globalThis.__m.realAutoRefresh),
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
    globalThis.__m.realSupabase = supabase;`,
  "@/services/platform": `export const detectPlatform = () => ({ isCapacitor: false, isIOS: false });`,
  "@/lib/profile-session-cache": `export const clearProfileSessionCache = () => {};`,
  "@/lib/app-boot-cache": `export const resetAppBootCachesForUserChange = () => {};`,
  "@/lib/travel-pref-result-cache": `export const clearTravelPrefResultCache = () => {};`,
  "@/lib/home-trip-snapshot": `export const isHomeTripSummarySnapshotKey = () => false;`,
  "@/lib/saved-list-snapshot": `export const isSavedListSnapshotKey = () => false;`,
  "@/lib/oauth-app-navigate": `export const navigateOAuthAppPath = async () => {};`,
  "@/lib/onboarding-storage": `export const clearOnboardingCompleted = () => {};`,
  "@/lib/ios-snapshot-bridge": `export const ensureIosLoginLiveInteraction = () => {}; export const notifyIosOAuthReturn = () => {}; export const scheduleIosSnapshotRefreshBurst = () => {};`,
};
const realAuthBundle = path.join(tmp, "real-auth.mjs");
// --probe-root=<dir>: build clear-auth-state from another checkout (only used with --probe-autorefresh
// to compare against a HEAD snapshot).
const probeRoot = process.argv.find((a) => a.startsWith("--probe-root="))?.slice(13);
const realAuthRoot = probeRoot ? path.resolve(probeRoot) : root;
await build({
  entryPoints: [path.join(realAuthRoot, "src/lib/clear-auth-state.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: realAuthBundle,
  logLevel: "silent",
  tsconfig: path.join(realAuthRoot, "tsconfig.json"),
  plugins: [
    {
      name: "real-auth-mocks",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (Object.hasOwn(realAuthMocks, a.path) ? { path: a.path, namespace: "mock" } : null));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: realAuthMocks[a.path], loader: "ts", resolveDir: root }));
      },
    },
  ],
});
let realAuthSeq = 0;
async function realAuthCase(session, { holdLogout = false, online = null } = {}) {
  AUTH_MEM.clear();
  AUTH_MEM.set("roamie-auth", JSON.stringify(session));
  const offline = [];
  M.fetchHandler = async (url, init) => {
    if (!String(url).startsWith("https://offline-mock.supabase.invalid/")) return undefined;
    offline.push(String(url).replace("https://offline-mock.supabase.invalid", ""));
    if (online) {
      const r = await online(String(url).replace("https://offline-mock.supabase.invalid", ""), init);
      if (r) return r;
    }
    if (holdLogout && /\/logout/.test(url)) return never();
    throw new TypeError("Failed to fetch");
  };
  // A fresh copy per case = a fresh GoTrueClient (createClient runs at module load).
  const caseFile = path.join(tmp, `real-auth-${(realAuthSeq += 1)}.mjs`);
  fs.copyFileSync(realAuthBundle, caseFile);
  const caseUrl = pathToFileURL(caseFile).href;
  const mod = await import(caseUrl);
  const events = [];
  const signedOutAt = { t: null };
  const t0 = Date.now();
  M.realSupabase.auth.onAuthStateChange((event) => {
    events.push(event);
    if (event === "SIGNED_OUT" && signedOutAt.t == null) signedOutAt.t = Date.now() - t0;
  });
  return { mod, events, offline, signedOutAt, t0 };
}
const realSession = (expiresInSec) => {
  const exp = nowSec() + expiresInSec;
  return {
    access_token: fakeJwt({ sub: "u-1", exp, role: "authenticated", aud: "authenticated" }),
    refresh_token: "real-refresh",
    token_type: "bearer",
    expires_in: Math.max(0, expiresInSec),
    expires_at: exp,
    user: { id: "u-1", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
};

await check("S5R1 真實 auth-js＋離線 fetch（token 有效）：clearAuthState 3 秒內完成、發出 SIGNED_OUT、storage 清空；撤銷請求打 /logout?scope=local", async () => {
  const c = await realAuthCase(realSession(3600));
  await sleep(20);
  await c.mod.clearAuthState({ reason: "user-sign-out" });
  const ms = Date.now() - c.t0;
  await sleep(50);
  assert.ok(ms < 3_500, `took ${ms}ms`);
  assert.ok(c.events.includes("SIGNED_OUT"), "events=" + c.events.join(","));
  assert.equal(AUTH_MEM.has("roamie-auth"), false);
  assert.ok(c.offline.some((u) => u.startsWith("/auth/v1/logout?scope=local")), c.offline.join(","));
  assert.equal(c.offline.filter((u) => u.includes("/logout")).length, 1, "local signOut must not issue a second /logout");
});

await check("S5R2 真實 auth-js＋/logout 永不回應：3 秒內完成、SIGNED_OUT 已發出、storage 清空", async () => {
  const c = await realAuthCase(realSession(3600), { holdLogout: true });
  await sleep(20);
  const t1 = Date.now();
  await c.mod.clearAuthState({ reason: "user-sign-out" });
  const ms = Date.now() - t1;
  assert.ok(ms < 3_500, `took ${ms}ms`);
  assert.ok(c.events.includes("SIGNED_OUT"), "events=" + c.events.join(","));
  assert.equal(AUTH_MEM.has("roamie-auth"), false);
});

await check("S5R3 真實 auth-js＋離線、access token 已過期（App 離線啟動後立即登出）：3 秒內發出 SIGNED_OUT", async () => {
  const c = await realAuthCase(realSession(-120));
  await sleep(20);
  const t1 = Date.now();
  await c.mod.clearAuthState({ reason: "user-sign-out" });
  const ms = Date.now() - t1;
  assert.ok(ms < 3_500, `clearAuthState took ${ms}ms`);
  assert.equal(AUTH_MEM.has("roamie-auth"), false, "local session cleared");
  // SIGNED_OUT may arrive after clearAuthState returned; allow up to 3 s total from the click.
  while (!c.events.includes("SIGNED_OUT") && Date.now() - t1 < 3_000) await sleep(20);
  assert.ok(
    c.events.includes("SIGNED_OUT"),
    `no SIGNED_OUT within 3s of sign-out (events=${c.events.join(",")}; offline requests=${c.offline.length})`,
  );
});
await check("S5R4 真實 auth-js：token 快過期（線上）→ 用 auth.admin 的 url／apikey 打 /token 換新，再以新 token 打 /logout；新 session 不寫回 storage；SIGNED_OUT", async () => {
  const seen = [];
  const freshToken = fakeJwt({ sub: "u-1", exp: nowSec() + 3600, role: "authenticated" });
  const c = await realAuthCase(realSession(10), {
    online: async (p, init) => {
      const h = new Headers(init?.headers ?? {});
      seen.push({ p, method: init?.method, auth: h.get("authorization"), apikey: h.get("apikey"), body: init?.body ?? null });
      if (p === "/auth/v1/token?grant_type=refresh_token")
        return new Response(JSON.stringify({ access_token: freshToken, refresh_token: "rotated", token_type: "bearer", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (p.startsWith("/auth/v1/logout")) return new Response(null, { status: 204 });
      return null;
    },
  });
  await sleep(20);
  await c.mod.clearAuthState({ reason: "user-sign-out" });
  await sleep(50);
  const token = seen.find((s) => s.p === "/auth/v1/token?grant_type=refresh_token");
  const logout = seen.find((s) => s.p.startsWith("/auth/v1/logout"));
  assert.ok(token, "token exchange sent: " + JSON.stringify(seen.map((s) => s.p)));
  assert.equal(token.method, "POST");
  assert.equal(token.apikey, "anon-placeholder");
  assert.deepEqual(JSON.parse(token.body), { refresh_token: "real-refresh" });
  assert.ok(logout, "logout sent");
  assert.equal(logout.p, "/auth/v1/logout?scope=local");
  assert.equal(logout.auth, "Bearer " + freshToken, "revoke uses the exchanged token");
  assert.equal(seen.filter((s) => s.p.startsWith("/auth/v1/logout")).length, 1);
  assert.equal(AUTH_MEM.has("roamie-auth"), false, "exchanged session never persisted");
  assert.ok(c.events.includes("SIGNED_OUT"));
});

if (process.argv.includes("--probe-autorefresh")) {
  // Probe (not part of the pass/fail contract): App config autoRefreshToken:true, expired session,
  // offline, sign-out right after launch. Reports how long until SIGNED_OUT.
  M.realAutoRefresh = true;
  const c = await realAuthCase(realSession(-120));
  await sleep(20);
  const t1 = Date.now();
  await c.mod.clearAuthState({ reason: "user-sign-out" });
  const returnedMs = Date.now() - t1;
  while (!c.events.includes("SIGNED_OUT") && Date.now() - t1 < 40_000) await sleep(50);
  say(
    `PROBE autoRefreshToken:true expired+offline: clearAuthState returned in ${returnedMs}ms; ` +
      `storage cleared=${!AUTH_MEM.has("roamie-auth")}; SIGNED_OUT after ${c.events.includes("SIGNED_OUT") ? Date.now() - t1 + "ms" : "none within 40s"}; ` +
      `offline requests=${c.offline.length}`,
  );
  M.realAutoRefresh = false;
}

// Background auth-js retries from the cases above keep hitting the fake offline host: still mocked.
M.fetchHandler = async (url) => {
  if (String(url).startsWith("https://offline-mock.supabase.invalid/")) throw new TypeError("Failed to fetch");
  return undefined;
};

// ===========================================================================
// 6. Account deletion (in-memory fake Supabase)
// ===========================================================================
const acct = await bundle("src/lib/account-deletion/account-deletion.server.ts", {
  "@supabase/supabase-js": `export const createClient = (...a) => globalThis.__m.createClient(...a);`,
  "./apple-revoke.server": `export const revokeAppleAuthorization = async () => {};`,
  "./revenuecat-customer-delete.server": `export const deleteRevenueCatCustomerV2 = async () => { globalThis.__m.ops.push("revenuecat"); };`,
});

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = {
  SUPABASE_URL: SUPA,
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-placeholder",
  ACCOUNT_DELETION_ALLOWED_SUPABASE_REF: "abcdefghijklmnopqrst",
};
const U = "11111111-1111-4111-8111-111111111111";
const MEM = "22222222-2222-4222-8222-222222222222";
const LATE = "44444444-4444-4444-8444-444444444444";
const PEND = "55555555-5555-4555-8555-555555555555";
const OTHER = "33333333-3333-4333-8333-333333333333";
const pub = (p) => `${SUPA}/storage/v1/object/public/profile-media/${p}`;

function seedDb() {
  return {
    account_deletion_requests: [],
    account_deletion_receipts: [],
    trip_invites: [],
    analytics_events: [],
    saved_trips: [
      { id: "T1-solo", user_id: U, custom_cover_image_url: pub(`${U}/trips/T1-solo/a.jpg`), cover_image_url: null, cover_image: null },
      {
        id: "T2-shared",
        user_id: U,
        custom_cover_image_url: pub(`${U}/trips/T2-shared/b.jpg`),
        cover_image_url: pub(`${U}/trips/T2-shared/b.jpg`),
        cover_image: "https://images.example.test/google-photo.jpg",
      },
      { id: "T3-others", user_id: OTHER, custom_cover_image_url: pub(`${U}/trips/T3-others/c.jpg`), cover_image_url: null, cover_image: null },
    ],
    trip_members: [
      { id: "m1", trip_id: "T1-solo", user_id: U, is_owner: true, status: "accepted", created_at: "2026-01-01" },
      { id: "m2", trip_id: "T2-shared", user_id: U, is_owner: true, status: "accepted", created_at: "2026-01-01" },
      { id: "m3", trip_id: "T2-shared", user_id: PEND, is_owner: false, status: "pending", created_at: "2026-01-02" },
      { id: "m4", trip_id: "T2-shared", user_id: MEM, is_owner: false, status: "accepted", created_at: "2026-01-03" },
      { id: "m5", trip_id: "T2-shared", user_id: LATE, is_owner: false, status: "accepted", created_at: "2026-01-04" },
      { id: "m6", trip_id: "T3-others", user_id: OTHER, is_owner: true, status: "accepted", created_at: "2026-01-01" },
      { id: "m7", trip_id: "T3-others", user_id: U, is_owner: false, status: "accepted", created_at: "2026-01-02" },
    ],
    trip_expenses: [
      { id: "e-solo", trip_id: "T1-solo", paid_by: U },
      { id: "e-shared", trip_id: "T2-shared", paid_by: U },
    ],
    files: new Set([
      `${U}/avatar.jpg`,
      `${U}/trips/T1-solo/a.jpg`,
      `${U}/trips/T2-shared/b.jpg`,
      `${U}/trips/T3-others/c.jpg`,
      `${MEM}/avatar.jpg`,
    ]),
    transferError: null,
    copyFail: new Set(),
    coverLookupError: null,
  };
}

function likeMatch(value, pattern) {
  if (typeof value !== "string") return false;
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(value);
}

const OR_OPS = {
  like: (v, a) => likeMatch(v, a),
  eq: (v, a) => v != null && String(v) === a,
  neq: (v, a) => v == null || String(v) !== a,
  is: (v, a) => (a === "null" ? v == null : String(v) === a),
};

function makeFakeClients(db, user) {
  M.ops = [];
  M.keysUsed = [];
  const ops = M.ops;
  const admin = {
    from(table) {
      const q = { op: "select", filters: [], payload: null, cols: null, single: false, order: [], range: null, limit: null };
      const api = {
        select(cols) {
          if (q.op === "select") q.cols = cols;
          return api;
        },
        insert(p) {
          q.op = "insert";
          q.payload = p;
          return api;
        },
        update(p) {
          q.op = "update";
          q.payload = p;
          return api;
        },
        upsert(p) {
          q.op = "upsert";
          q.payload = p;
          return api;
        },
        delete() {
          q.op = "delete";
          return api;
        },
        eq(c, v) {
          q.filters.push((r) => r[c] === v);
          return api;
        },
        neq(c, v) {
          q.filters.push((r) => r[c] !== v);
          return api;
        },
        // 任務單 #R4-1：keyset 分頁 .gt("id", lastId)。與下方 order 同用 JS 字串比較（= Postgres uuid 排序）；
        // NULL 比較在 Postgres 為 NULL → 不入選。篩選在 exec 時先套用，再 order，最後 range／limit。
        gt(c, v) {
          q.filters.push((r) => r[c] != null && r[c] > v);
          return api;
        },
        // 任務單 #21：run-2 改用 .in()／.order()／.range() 分頁與批次清除；比照
        // verify-account-deletion-cover-batch-run2 的 mock 補上，語意與 PostgREST 相同。
        in(c, vs) {
          assert.ok(Array.isArray(vs), "in() expects an array");
          const set = new Set(vs);
          q.filters.push((r) => set.has(r[c]));
          return api;
        },
        is(c, v) {
          q.filters.push((r) => (v === null ? r[c] == null : r[c] === v));
          return api;
        },
        or(expr) {
          const parts = expr.split(",").map((p) => {
            const [col, op, ...rest] = p.split(".");
            assert.ok(Object.hasOwn(OR_OPS, op), "unsupported or() operator: " + op);
            return { col, op, arg: rest.join(".") };
          });
          q.filters.push((r) => parts.some(({ col, op, arg }) => OR_OPS[op](r[col], arg)));
          return api;
        },
        order(c, o = {}) {
          q.order.push({ c, asc: o.ascending !== false });
          return api;
        },
        range(from, to) {
          q.range = [from, to];
          return api;
        },
        limit(n) {
          q.limit = n;
          return api;
        },
        maybeSingle() {
          q.single = true;
          return api;
        },
        then(res, rej) {
          return Promise.resolve().then(exec).then(res, rej);
        },
      };
      const exec = () => {
        ops.push(`from:${table}:${q.op}`);
        const rows = (db[table] ??= []);
        const hit = rows.filter((r) => q.filters.every((f) => f(r)));
        if (table === "saved_trips" && q.op === "select" && db.coverLookupError)
          return { data: null, error: db.coverLookupError };
        if (q.op === "select") {
          if (q.cols) q.colsSeen = q.cols;
          if (table === "saved_trips") M.savedTripsSelectCols = q.cols;
          let out = hit;
          if (q.order.length)
            out = [...out].sort((a, b) => {
              for (const { c, asc } of q.order) {
                if (a[c] === b[c]) continue;
                return (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1);
              }
              return 0;
            });
          if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
          else if (q.limit != null) out = out.slice(0, q.limit);
          return { data: q.single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null };
        }
        if (q.op === "insert") {
          rows.push({ attempt_count: 1, ...q.payload });
          return { data: null, error: null };
        }
        if (q.op === "upsert") {
          rows.push({ ...q.payload });
          return { data: null, error: null };
        }
        if (q.op === "update") {
          if (table === "saved_trips") M.savedTripsPatches.push({ ...q.payload });
          for (const r of hit) Object.assign(r, q.payload);
          return { data: null, error: null };
        }
        if (q.op === "delete") {
          db[table] = rows.filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        throw new Error("op " + q.op);
      };
      return api;
    },
    async rpc(fn, args) {
      ops.push(`rpc:${fn}`);
      assert.equal(fn, "transfer_owned_shared_trips_for_deletion");
      if (db.transferError) return { data: null, error: db.transferError };
      let count = 0;
      for (const trip of db.saved_trips.filter((t) => t.user_id === args.p_user_id)) {
        const next = db.trip_members
          .filter((m) => m.trip_id === trip.id && m.user_id !== args.p_user_id && m.status === "accepted")
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
        if (!next) continue;
        for (const m of db.trip_members) if (m.trip_id === trip.id && m.user_id !== next.user_id) m.is_owner = false;
        next.is_owner = true;
        trip.user_id = next.user_id;
        db.trip_members = db.trip_members.filter((m) => !(m.trip_id === trip.id && m.user_id === args.p_user_id));
        count++;
      }
      return { data: count, error: null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "profile-media");
        return {
          async list(prefix, { limit, offset }) {
            ops.push(`storage:list:${prefix}`);
            const names = new Map();
            for (const f of db.files) {
              if (!f.startsWith(prefix + "/")) continue;
              const rest = f.slice(prefix.length + 1);
              const [head, ...tail] = rest.split("/");
              names.set(head, tail.length ? null : "file-id");
            }
            const items = [...names].map(([name, id]) => ({ name, id }));
            return { data: items.slice(offset, offset + limit), error: null };
          },
          async exists(p) {
            return { data: db.files.has(p), error: null };
          },
          async copy(from, to) {
            ops.push(`storage:copy:${from}->${to}`);
            if (db.copyFail.has(from) || !db.files.has(from)) return { data: null, error: { message: "copy failed" } };
            db.files.add(to);
            return { data: { path: to }, error: null };
          },
          async remove(paths) {
            ops.push(`storage:remove`);
            M.removed.push(...paths);
            for (const p of paths) db.files.delete(p);
            return { data: [], error: null };
          },
          getPublicUrl(p) {
            return { data: { publicUrl: pub(p) } };
          },
        };
      },
    },
    auth: {
      admin: {
        async deleteUser(id) {
          ops.push("auth:deleteUser");
          // FK cascade (auth.users ON DELETE CASCADE): saved_trips.user_id, trip_members.user_id,
          // trip_invites.inviter_id; saved_trips → trip_members / trip_expenses cascade.
          const gone = new Set(db.saved_trips.filter((t) => t.user_id === id).map((t) => t.id));
          db.saved_trips = db.saved_trips.filter((t) => !gone.has(t.id));
          db.trip_members = db.trip_members.filter((m) => m.user_id !== id && !gone.has(m.trip_id));
          db.trip_expenses = db.trip_expenses.filter((e) => !gone.has(e.trip_id));
          return { data: {}, error: null };
        },
      },
    },
  };
  const userClient = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  };
  M.createClient = (url, key) => {
    M.keysUsed.push(key);
    return key === ENV.SUPABASE_SERVICE_ROLE_KEY ? admin : userClient;
  };
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deletionRequest() {
  const jwt = `${b64url({ alg: "none" })}.${b64url({ sub: U, amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 30 }] })}.sig`;
  return new Request("https://roamie.tw/api/account/delete", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
}
const USER = { id: U, email: "deleted-user@example.test", app_metadata: { provider: "google" }, identities: [] };
const REQ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function runDeletion(db) {
  makeFakeClients(db, USER);
  M.removed = [];
  M.savedTripsPatches = [];
  return acct.deleteAuthenticatedAccount({ request: deletionRequest(), runtimeEnv: ENV, body: { requestId: REQ_ID } });
}

// 任務單 #R4-1：mock 自我檢查（不計入 PASS 數，失敗即中止腳本）— 證明 gt 真的篩選，且 mock 的執行順序是
// 篩選 → order → limit／range；keyset 逐頁讀完不漏不重。gt 若是 no-op 或 limit 先於篩選，這裡會丟錯。
// 之後每個 S6 測試都會重新 makeFakeClients()，自我檢查用的 client／ops 不會殘留。
async function gtMockSelfCheck(admin, db) {
  const T = "__gt_selfcheck";
  const id = (h) => "00000000-0000-4000-8000-00000000000" + h;
  db[T] = [id("5"), id("1"), null, id("a"), id("3"), id("2"), id("4")].map((v, i) => ({ id: v, g: i === 2 || i === 4 ? "x" : "u" }));
  const tail = (r) => r.data.map((x) => x.id.slice(-1)).join("");
  try {
    let r = await admin.from(T).select("id").eq("g", "u").gt("id", id("1")).order("id").limit(2);
    assert.equal(tail(r), "24", "gt+eq+order+limit: filter must run before limit");
    r = await admin.from(T).select("id").gt("id", id("4")).order("id").range(0, 0);
    assert.equal(tail(r), "5", "gt+order+range");
    r = await admin.from(T).select("id").gt("id", id("a")).order("id").limit(5);
    assert.equal(tail(r), "", "gt is strict and excludes NULL");
    const seen = [];
    let last = null;
    for (let page = 0; page < 10; page += 1) {
      let b = admin.from(T).select("id").eq("g", "u");
      if (last !== null) b = b.gt("id", last);
      const { data } = await b.order("id").limit(2);
      if (!data.length) break;
      seen.push(...data.map((x) => x.id.slice(-1)));
      last = data[data.length - 1].id;
    }
    assert.equal(seen.join(""), "1245a", "keyset walk returns every row once, in id order");
  } finally {
    delete db[T];
  }
}
try {
  const selfDb = {};
  makeFakeClients(selfDb, USER);
  await gtMockSelfCheck(M.createClient(SUPA, ENV.SUPABASE_SERVICE_ROLE_KEY), selfDb);
  say("SELFCHECK gt mock：篩選→order→limit／range、keyset 逐頁 OK（不計入 PASS 數）");
} catch (e) {
  say("FAIL SELFCHECK gt mock\n     " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n     "));
  process.exit(1);
}

await check("S6a 刪帳號順序：轉移 RPC → 封面搬移 → storage 清除 → deleteUser", async () => {
  const db = seedDb();
  await runDeletion(db);
  const ops = M.ops;
  const iTransfer = ops.indexOf("rpc:transfer_owned_shared_trips_for_deletion");
  const iFirstList = ops.findIndex((o) => o.startsWith("storage:list:"));
  const iRemove = ops.indexOf("storage:remove");
  const iDelete = ops.indexOf("auth:deleteUser");
  assert.ok(iTransfer >= 0 && iTransfer < iFirstList && iFirstList < iRemove && iRemove < iDelete, ops.join("\n"));
  assert.equal(ops.filter((o) => o === "rpc:transfer_owned_shared_trips_for_deletion").length, 1);
  assert.ok(M.keysUsed.includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
});

await check("S6b 共享行程轉給最早 accepted 成員（略過 pending）；行程／花費／封面在 cascade 後保留；solo 行程刪除", async () => {
  const db = seedDb();
  await runDeletion(db);
  const ids = db.saved_trips.map((t) => t.id).sort();
  assert.deepEqual(ids, ["T2-shared", "T3-others"]);
  const t2 = db.saved_trips.find((t) => t.id === "T2-shared");
  assert.equal(t2.user_id, MEM);
  const owner = db.trip_members.find((m) => m.trip_id === "T2-shared" && m.is_owner);
  assert.equal(owner.user_id, MEM);
  assert.equal(db.trip_members.some((m) => m.user_id === U), false);
  assert.deepEqual(db.trip_expenses.map((e) => e.id), ["e-shared"]);
  // Covers repointed to the (new) owner's prefix and the file exists there.
  assert.equal(t2.custom_cover_image_url, pub(`${MEM}/trips/T2-shared/b.jpg`));
  assert.equal(t2.cover_image_url, pub(`${MEM}/trips/T2-shared/b.jpg`));
  assert.equal(t2.cover_image, "https://images.example.test/google-photo.jpg");
  assert.ok(db.files.has(`${MEM}/trips/T2-shared/b.jpg`));
  const t3 = db.saved_trips.find((t) => t.id === "T3-others");
  assert.equal(t3.custom_cover_image_url, pub(`${OTHER}/trips/T3-others/c.jpg`));
  assert.ok(db.files.has(`${OTHER}/trips/T3-others/c.jpg`));
  // Same source path is copied once even when referenced by two columns.
  assert.equal(M.ops.filter((o) => o.startsWith(`storage:copy:${U}/trips/T2-shared/b.jpg`)).length, 1);
  // Account deletion never writes saved_trips.user_id itself (only the definer RPC does).
  for (const patch of M.savedTripsPatches) {
    for (const k of Object.keys(patch)) assert.ok(["custom_cover_image_url", "cover_image_url", "cover_image"].includes(k), k);
  }
});

await check("S6c 被刪使用者的 storage prefix 完全清空（封面已複製出去，不因保護而留下私人檔）", async () => {
  const db = seedDb();
  await runDeletion(db);
  assert.deepEqual([...db.files].filter((f) => f.startsWith(U + "/")), []);
  assert.ok(M.removed.includes(`${U}/avatar.jpg`));
  assert.ok(db.files.has(`${MEM}/avatar.jpg`), "other users' files untouched");
});

await check("S6d 轉移 RPC 失敗 → 中止（不清 storage、不 deleteUser），記錄錯誤碼且可續跑；續跑後完成且共享行程保留", async () => {
  const db = seedDb();
  db.transferError = { message: "deadlock detected", code: "40P01" };
  await assert.rejects(() => runDeletion(db), /account_collaboration_transfer_failed/);
  assert.equal(M.ops.some((o) => o.startsWith("storage:")), false);
  assert.equal(M.ops.includes("auth:deleteUser"), false);
  const state = db.account_deletion_requests.find((r) => r.user_id === U);
  assert.equal(state.last_error_code, "account_collaboration_transfer_failed");
  assert.equal(acct.canResumeFailedExternalRequest({
    request_id: state.request_id,
    status: state.status,
    attempt_count: state.attempt_count,
    last_error_code: state.last_error_code,
    apple_revoke_completed_at: null,
    storage_completed_at: null,
    analytics_completed_at: null,
    external_cleanup_completed_at: null,
  }), true);
  assert.ok(db.files.has(`${U}/trips/T2-shared/b.jpg`));
  db.transferError = null;
  await runDeletion(db);
  assert.ok(M.ops.includes("auth:deleteUser"));
  assert.deepEqual(db.saved_trips.map((t) => t.id).sort(), ["T2-shared", "T3-others"]);
});

await check("S6e 封面查詢失敗 → 中止（不清 storage、不 deleteUser）", async () => {
  const db = seedDb();
  db.coverLookupError = { message: "permission denied for table saved_trips", code: "42501" };
  await assert.rejects(() => runDeletion(db), /account_collaboration_cover_lookup_failed/);
  assert.equal(M.ops.includes("storage:remove"), false);
  assert.equal(M.ops.includes("auth:deleteUser"), false);
});

await check("S6f 封面複製失敗 → 中止（不清 storage、不 deleteUser），記錄 account_collaboration_ 錯誤碼且可續跑；續跑後完成、prefix 清空", async () => {
  const db = seedDb();
  db.copyFail.add(`${U}/trips/T2-shared/b.jpg`);
  await assert.rejects(() => runDeletion(db), /account_collaboration_cover_copy_failed/);
  assert.equal(M.ops.includes("storage:remove"), false);
  assert.equal(M.ops.includes("auth:deleteUser"), false);
  assert.ok(db.files.has(`${U}/trips/T2-shared/b.jpg`), "nothing deleted before the abort");
  const state = db.account_deletion_requests.find((r) => r.user_id === U);
  assert.equal(state.last_error_code, "account_collaboration_cover_copy_failed");
  assert.equal(
    acct.canResumeFailedExternalRequest({
      request_id: state.request_id,
      status: state.status,
      attempt_count: state.attempt_count,
      last_error_code: state.last_error_code,
      apple_revoke_completed_at: null,
      storage_completed_at: null,
      analytics_completed_at: null,
      external_cleanup_completed_at: null,
    }),
    true,
  );
  db.copyFail.clear();
  await runDeletion(db);
  assert.ok(M.ops.includes("auth:deleteUser"));
  assert.deepEqual([...db.files].filter((f) => f.startsWith(U + "/")), []);
  const t2 = db.saved_trips.find((t) => t.id === "T2-shared");
  assert.equal(t2.custom_cover_image_url, pub(`${MEM}/trips/T2-shared/b.jpg`));
  assert.ok(db.files.has(`${MEM}/trips/T2-shared/b.jpg`));
});

await check("S6g 存活行程的封面欄位指向被刪者其他檔案（頭像／別的行程）→ 清空為 null、不複製；只搬 <被刪者>/trips/<tripId>/", async () => {
  const db = seedDb();
  const t2 = db.saved_trips.find((t) => t.id === "T2-shared");
  t2.cover_image_url = pub(`${U}/avatar.jpg`);
  t2.cover_image = pub(`${U}/trips/T1-solo/a.jpg`);
  const t3 = db.saved_trips.find((t) => t.id === "T3-others");
  t3.cover_image_url = pub(`${U}/trips/T3-others/../../avatar.jpg`);
  await runDeletion(db);
  const t2After = db.saved_trips.find((t) => t.id === "T2-shared");
  assert.equal(t2After.custom_cover_image_url, pub(`${MEM}/trips/T2-shared/b.jpg`));
  assert.equal(t2After.cover_image_url, null);
  assert.equal(t2After.cover_image, null);
  assert.equal(db.saved_trips.find((t) => t.id === "T3-others").cover_image_url, null);
  const copies = M.ops.filter((o) => o.startsWith("storage:copy:"));
  const copyShape = new RegExp("storage:copy:[^/]+/trips/(T2-shared|T3-others)/[^/]+->");
  assert.ok(copies.every((o) => copyShape.test(o)), copies.join("\n"));
  assert.equal(copies.some((o) => o.includes("avatar")), false);
  assert.equal([...db.files].some((f) => f.startsWith(MEM + "/") && f.includes("avatar") && f !== `${MEM}/avatar.jpg`), false);
  assert.deepEqual([...db.files].filter((f) => f.startsWith(U + "/")), []);
});

await check("S6h 封面改指向後寫回失敗 → 中止於刪 storage 之前（account_collaboration_cover_repoint_failed）", async () => {
  const db = seedDb();
  makeFakeClients(db, USER);
  const realFrom = M.createClient(SUPA, ENV.SUPABASE_SERVICE_ROLE_KEY).from;
  M.removed = [];
  M.savedTripsPatches = [];
  const baseCreate = M.createClient;
  M.createClient = (url, key) => {
    const c = baseCreate(url, key);
    if (key !== ENV.SUPABASE_SERVICE_ROLE_KEY) return c;
    return {
      ...c,
      from(table) {
        const api = realFrom.call(c, table);
        if (table !== "saved_trips") return api;
        const origUpdate = api.update;
        // 任務單 #21：逐列（.eq().neq()）與批次（.in().neq().or()）寫回都回錯誤。
        api.update = (p) => {
          origUpdate(p);
          M.savedTripsUpdateAttempts = (M.savedTripsUpdateAttempts ?? 0) + 1;
          const failed = { data: null, error: { message: "permission denied for column", code: "42501" } };
          const chain = {
            eq: () => chain,
            neq: () => chain,
            in: () => chain,
            or: () => chain,
            then: (res, rej) => Promise.resolve(failed).then(res, rej),
          };
          return chain;
        };
        return api;
      },
    };
  };
  await assert.rejects(
    () => acct.deleteAuthenticatedAccount({ request: deletionRequest(), runtimeEnv: ENV, body: { requestId: REQ_ID } }),
    /account_collaboration_cover_repoint_failed/,
  );
  assert.equal(M.ops.includes("storage:remove"), false);
  assert.equal(M.ops.includes("auth:deleteUser"), false);
});

// ===========================================================================
// 7. Account deletion dialog copy (4 locales)
// ===========================================================================
await check("S7 刪帳號確認視窗：deleteAccountSharedTrips 四語系存在並顯示於設定頁確認視窗", async () => {
  const { translate } = await import("../src/lib/i18n/translate.ts");
  // 共享行程：不刪、轉給最早加入的成員（deleteAccountSharedTrips）
  const shared = {
    "zh-TW": /共享的行程不會被刪除[\s\S]*最早加入的成員/,
    en: /won't be deleted[\s\S]*joined earliest/,
    ja: /削除されず[\s\S]*最も早く参加したメンバー/,
    ko: /삭제되지 않고[\s\S]*가장 먼저 참여한 멤버/,
  };
  // 只有自己一人的行程：照舊刪除（pe4327fa225），且不再寫「已儲存行程全部刪除」
  const solo = {
    "zh-TW": { must: /只屬於你自己的行程也會一起刪除/, mustNot: /已儲存行程/ },
    en: { must: /trips that are only yours/, mustNot: /saved trips/i },
    ja: { must: /あなただけの旅程も一緒に削除/, mustNot: /保存した旅程/ },
    ko: { must: /나 혼자만 참여한 여행도 함께 삭제/, mustNot: /저장한 여행과/ },
  };
  for (const locale of Object.keys(shared)) {
    const text = translate(locale, "productionUi.deleteAccountSharedTrips");
    assert.notEqual(text, "productionUi.deleteAccountSharedTrips", locale);
    assert.match(text, shared[locale], locale);
    const base = translate(locale, "productionUi.pe4327fa225");
    assert.match(base, solo[locale].must, locale + " pe4327fa225");
    assert.doesNotMatch(base, solo[locale].mustNot, locale + " pe4327fa225 still says all saved trips are deleted");
    if (locale !== "zh-TW") {
      assert.doesNotMatch(text, /[行程成員刪除]{2}/u, locale + " zh leak");
      assert.doesNotMatch(base, /[行程成員刪除]{2}/u, locale + " zh leak");
    }
  }
  const settings = read("src/routes/_app.settings.tsx");
  const dialogStart = settings.indexOf('uiT("productionUi.p1c72526e0a")');
  const sharedAt = settings.indexOf('uiT("productionUi.deleteAccountSharedTrips")');
  assert.ok(dialogStart > 0 && sharedAt > dialogStart && sharedAt - dialogStart < 600);
});

await check("NET 全程沒有任何非 mock 的網路請求（fetch／http(s)／net／tls）", () => {
  assert.deepEqual(NET_BLOCKED, []);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  FAILED: " + f);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
