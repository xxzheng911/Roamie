// verify-account-deletion-unexpected-resume-review5.mjs — 任務單 #12（第 5 次獨立複審）
//
// 刪帳號續跑：不認得的錯誤寫成固定碼 account_deletion_unexpected_failed，App 重開換新 request id 也能續跑；
// storage exists／copy 丟例外的處理；續跑時各步驟冪等（Apple revoke、RevenueCat、analytics、storage、
// transfer、deleteUser）；Apple 撤銷途中網路錯誤再續跑。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-account-deletion-unexpected-resume-review5.mjs
// 不連網（全域 fetch 攔截、supabase-js 以 in-memory fake 取代、Apple／RevenueCat helper 以 mock 取代）、不讀 .env。

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const NET_BLOCKED = [];
globalThis.fetch = async (input) => {
  NET_BLOCKED.push(String(input?.url ?? input).slice(0, 120));
  throw new TypeError("NETWORK_BLOCKED");
};
globalThis.__m = {};
const M = globalThis.__m;
const say = (s) => fs.writeSync(1, s + "\n");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quiet = { info: console.info, error: console.error };
console.info = () => {};
console.error = () => {};

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-acct-unexp-"));
const outFile = path.join(tmp, "acct.mjs");
const mocks = {
  "@supabase/supabase-js": `export const createClient = (...a) => globalThis.__m.createClient(...a);`,
  "./apple-revoke.server": `export const revokeAppleAuthorization = async (p) => {
    const m = globalThis.__m; m.ops.push("apple:revoke:" + p.authorizationCode);
    const f = m.appleFail.shift(); if (f) throw f;
  };`,
  "./revenuecat-customer-delete.server": `export const deleteRevenueCatCustomerV2 = async () => {
    const m = globalThis.__m; m.ops.push("revenuecat");
    const f = m.revenueCatFail.shift(); if (f) throw f;
  };`,
};
await build({
  entryPoints: [path.join(root, "src/lib/account-deletion/account-deletion.server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  logLevel: "silent",
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [
    {
      name: "m",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : null));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "ts", resolveDir: root }));
      },
    },
  ],
});
// Socket-level traps (installed after the esbuild build, before importing application code).
{
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
  const net = require("net");
  net.connect = trap("net.connect");
  net.createConnection = trap("net.createConnection");
  require("tls").connect = trap("tls.connect");
  globalThis.WebSocket = class {
    constructor(u) {
      NET_BLOCKED.push("ws:" + String(u).slice(0, 80));
      throw new Error("NETWORK_BLOCKED ws");
    }
  };
}
const acct = await import(pathToFileURL(outFile).href);

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = {
  SUPABASE_URL: SUPA,
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-placeholder",
  ACCOUNT_DELETION_ALLOWED_SUPABASE_REF: "abcdefghijklmnopqrst",
};
const U = "11111111-1111-4111-8111-111111111111";
const MEM = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const REQ1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQ2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQ3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const pub = (p) => `${SUPA}/storage/v1/object/public/profile-media/${p}`;

let db;
function freshDb() {
  return {
    account_deletion_requests: [],
    account_deletion_receipts: [],
    trip_invites: [],
    analytics_events: [{ id: "e1", user_id: U, session_id: "s", metadata: { a: 1 } }],
    saved_trips: [
      // Shared trip owned by U → transferred to MEM; its cover must be relocated.
      { id: "T1", user_id: U, custom_cover_image_url: pub(`${U}/trips/T1/a.jpg`), cover_image_url: null, cover_image: null },
      // Someone else's trip U is NOT a member of, pointing into U's trip prefix (crafted / stale).
      { id: "T9", user_id: OTHER, custom_cover_image_url: pub(`${U}/trips/T9/z.jpg`), cover_image_url: null, cover_image: null },
    ],
    trip_members: [
      { id: "m1", trip_id: "T1", user_id: U, is_owner: true, status: "accepted", created_at: "2026-01-01" },
      { id: "m2", trip_id: "T1", user_id: MEM, is_owner: false, status: "accepted", created_at: "2026-02-01" },
    ],
    files: new Set([`${U}/trips/T1/a.jpg`, `${U}/trips/T9/z.jpg`, `${U}/avatar.jpg`]),
    userDeleted: false,
  };
}
const ops = [];
M.ops = ops;
const likeMatch = (v, pat) =>
  typeof v === "string" &&
  new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(v);
const fault = { exists: [], copy: [], list: [], deleteUser: [], transfer: [] };
// 任務單 #20：in／is／order／range／limit；list 比照 storage-js（直接子項、資料夾 id=null、名稱排序、limit/offset）。
function storageList(files, prefix, opts = {}) {
  const base = String(prefix ?? "").replace(/\/+$/, "");
  const lead = base ? base + "/" : "";
  const entries = new Map();
  for (const f of files) {
    if (!f.startsWith(lead)) continue;
    const [head, ...tail] = f.slice(lead.length).split("/");
    if (!head) continue;
    if (tail.length) {
      if (!entries.has(head)) entries.set(head, null);
    } else entries.set(head, "file-id:" + f);
  }
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(offset, offset + limit)
    .map(([name, id]) => ({ name, id }));
}
const admin = {
  from(table) {
    const q = { op: "select", filters: [], payload: null, order: [], range: null, limit: null, returning: false };
    const api = {
      select: () => (q.op !== "select" && (q.returning = true), api),
      insert: (p) => ((q.op = "insert"), (q.payload = p), api),
      update: (p) => ((q.op = "update"), (q.payload = p), api),
      upsert: (p) => ((q.op = "upsert"), (q.payload = p), api),
      delete: () => ((q.op = "delete"), api),
      eq: (c, v) => (q.filters.push((r) => r[c] === v), api),
      neq: (c, v) => (q.filters.push((r) => r[c] !== v), api),
      // 任務單 #R4-1：keyset 分頁 .gt("id", lastId)。與下方 order 同用 JS 字串比較（= Postgres uuid 排序）；
      // NULL 比較在 Postgres 為 NULL → 不入選。篩選在 exec 時先套用，再 order，最後 range／limit。
      gt: (c, v) => (q.filters.push((r) => r[c] != null && r[c] > v), api),
      in: (c, vs) => {
        const set = new Set(vs);
        q.filters.push((r) => set.has(r[c]));
        return api;
      },
      is: (c, v) => (q.filters.push((r) => (v === null ? r[c] == null : r[c] === v)), api),
      or: (expr) => {
        const parts = expr.split(",").map((p) => {
          const [col, , ...rest] = p.split(".");
          return { col, pat: rest.join(".") };
        });
        q.filters.push((r) => parts.some(({ col, pat }) => likeMatch(r[col], pat)));
        return api;
      },
      order: (c, o = {}) => (q.order.push({ c, asc: o.ascending !== false }), api),
      range: (from, to) => ((q.range = [from, to]), api),
      limit: (n) => ((q.limit = n), api),
      maybeSingle: () => ((q.single = true), api),
      then(res, rej) {
        return Promise.resolve()
          .then(() => {
            ops.push(`from:${table}:${q.op}`);
            const rows = (db[table] ??= []);
            const hit = rows.filter((r) => q.filters.every((f) => f(r)));
            if (q.op === "select") {
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
              return { data: q.single ? (out[0] ? { ...out[0] } : null) : out.map((r) => ({ ...r })), error: null };
            }
            if (q.op === "insert") rows.push({ attempt_count: 0, last_error_code: null, apple_revoke_completed_at: null, storage_completed_at: null, analytics_completed_at: null, external_cleanup_completed_at: null, ...q.payload });
            if (q.op === "upsert") {
              const ex = rows.find((r) => r.request_id === q.payload.request_id);
              if (ex) Object.assign(ex, q.payload);
              else rows.push({ ...q.payload });
            }
            if (q.op === "update") for (const r of hit) Object.assign(r, q.payload);
            if (q.op === "delete") db[table] = rows.filter((r) => !hit.includes(r));
            return { data: q.returning ? hit.map((r) => ({ ...r })) : null, error: null };
          })
          .then(res, rej);
      },
    };
    return api;
  },
  async rpc(fn, args) {
    ops.push("rpc:" + fn);
    const f = fault.transfer.shift();
    if (f) throw f;
    let count = 0;
    for (const trip of db.saved_trips.filter((t) => t.user_id === args.p_user_id)) {
      const next = db.trip_members
        .filter((m) => m.trip_id === trip.id && m.user_id !== args.p_user_id && m.status === "accepted")
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!next) continue;
      next.is_owner = true;
      trip.user_id = next.user_id;
      db.trip_members = db.trip_members.filter((m) => !(m.trip_id === trip.id && m.user_id === args.p_user_id));
      count++;
    }
    return { data: count, error: null };
  },
  storage: {
    from() {
      return {
        async list(prefix, opts) {
          ops.push("storage:list:" + prefix);
          const f = fault.list.shift();
          if (f) throw f;
          return { data: storageList(db.files, prefix, opts), error: null };
        },
        async exists(p) {
          ops.push("storage:exists:" + p);
          const f = fault.exists.shift();
          if (f && (f.path === undefined || f.path === p)) throw f.error;
          if (f) fault.exists.unshift(f);
          return { data: db.files.has(p), error: null };
        },
        async copy(from, to) {
          ops.push(`storage:copy:${from}`);
          const f = fault.copy.shift();
          if (f) throw f;
          if (!db.files.has(from)) return { data: null, error: { message: "Object not found" } };
          db.files.add(to);
          return { data: { path: to }, error: null };
        },
        async remove(paths) {
          ops.push("storage:remove");
          for (const p of paths) db.files.delete(p);
          return { data: [], error: null };
        },
        getPublicUrl: (p) => ({ data: { publicUrl: pub(p) } }),
      };
    },
  },
  auth: {
    admin: {
      async deleteUser(id) {
        ops.push("auth:deleteUser");
        const f = fault.deleteUser.shift();
        if (f) throw f;
        if (db.userDeleted) return { data: null, error: { message: "User not found" } };
        db.userDeleted = true;
        db.saved_trips = db.saved_trips.filter((t) => t.user_id !== id);
        return { data: {}, error: null };
      },
    },
  },
};
let provider = "google";
const userFor = () =>
  provider === "apple"
    ? { id: U, email: "x@privaterelay.appleid.com", app_metadata: { provider: "apple" }, identities: [{ provider: "apple", id: "apple-sub-1", identity_data: { sub: "apple-sub-1" } }] }
    : { id: U, email: "deleted-user@example.test", app_metadata: { provider: "google" }, identities: [] };
M.createClient = (_url, key) =>
  key === ENV.SUPABASE_SERVICE_ROLE_KEY
    ? admin
    : { auth: { getUser: async () => (db.userDeleted ? { data: { user: null }, error: { message: "User not found", code: "user_not_found" } } : { data: { user: userFor() }, error: null }) } };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = `${b64({ alg: "none" })}.${b64({ sub: U, amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 30 }] })}.sig`;
const request = () => new Request("https://roamie.tw/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
const run = (requestId, apple) =>
  acct.deleteAuthenticatedAccount({ request: request(), runtimeEnv: ENV, body: { requestId, ...(apple ? { apple } : {}) } });
const row = () => db.account_deletion_requests[0];
const count = (prefix) => ops.filter((o) => o.startsWith(prefix)).length;
function resetAll() {
  db = freshDb();
  ops.length = 0;
  M.appleFail = [];
  M.revenueCatFail = [];
  for (const k of Object.keys(fault)) fault[k] = [];
  provider = "google";
}

// 任務單 #R4-1：mock 自我檢查（不計入 PASS 數，失敗即中止腳本）— 證明 gt 真的篩選，且 mock 的執行順序是
// 篩選 → order → limit／range；keyset 逐頁讀完不漏不重。gt 若是 no-op 或 limit 先於篩選，這裡會丟錯。
// 本腳本的 admin 綁全域 db（此時尚未初始化）：自我檢查用暫時的空 db，結束後還原 db 與 ops。
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
{
  const dbBefore = db;
  const opsBefore = ops.length;
  db = {};
  try {
    await gtMockSelfCheck(admin, db);
    say("SELFCHECK gt mock：篩選→order→limit／range、keyset 逐頁 OK（不計入 PASS 數）");
  } catch (e) {
    say("FAIL SELFCHECK gt mock\n     " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n     "));
    process.exit(1);
  }
  db = dbBefore;
  ops.length = opsBefore;
}

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    say("PASS " + name);
  } catch (e) {
    failed += 1;
    say("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 10).join("\n     ") + "\n     ops=" + ops.filter((o) => /rpc|storage:(copy|remove)|auth|apple|revenuecat/.test(o)).join(", "));
  }
}

await check("U1 canResumeFailedExternalRequest：unexpected_failed（未完成任何外部步驟）可續跑；already_in_progress／null／preflight 不可", () => {
  const base = { request_id: REQ1, status: "authenticated", attempt_count: 1, apple_revoke_completed_at: null, storage_completed_at: null, analytics_completed_at: null, external_cleanup_completed_at: null };
  assert.equal(acct.canResumeFailedExternalRequest({ ...base, last_error_code: "account_deletion_unexpected_failed" }), true);
  assert.equal(acct.canResumeFailedExternalRequest({ ...base, last_error_code: "account_deletion_already_in_progress" }), false);
  assert.equal(acct.canResumeFailedExternalRequest({ ...base, last_error_code: null }), false, "in-flight request must not be taken over");
  assert.equal(acct.canResumeFailedExternalRequest({ ...base, last_error_code: "recent_auth_required" }), false);
});

await check("U2 storage list 丟原始網路錯誤 → last_error_code 寫固定碼 account_deletion_unexpected_failed（不存原始訊息）；換新 request id 續跑完成", async () => {
  resetAll();
  fault.list.push(new TypeError("Network connection lost. raw-secret-ish detail"));
  await assert.rejects(run(REQ1));
  assert.equal(row().last_error_code, "account_deletion_unexpected_failed");
  assert.equal(JSON.stringify(db.account_deletion_requests).includes("Network connection lost"), false, "raw message stored");
  const result = await run(REQ2);
  assert.deepEqual(result, { completed: true });
  assert.equal(row().request_id, REQ1, "canonical request id kept");
  assert.equal(db.userDeleted, true);
  assert.equal([...db.files].some((f) => f.startsWith(U + "/")), false, "deleted user's prefix emptied");
  assert.equal(db.saved_trips.find((t) => t.id === "T1")?.user_id, MEM);
  assert.equal(db.saved_trips.find((t) => t.id === "T1")?.custom_cover_image_url, pub(`${MEM}/trips/T1/a.jpg`));
});

await check("U3 成員行程 exists 丟例外 → account_collaboration_cover_copy_failed（可續跑、尚未刪 storage）；換新 request id 續跑完成", async () => {
  resetAll();
  fault.exists.push({ path: `${MEM}/trips/T1/a.jpg`, error: new TypeError("fetch failed") });
  await assert.rejects(run(REQ1), /account_collaboration_cover_copy_failed/);
  assert.equal(row().last_error_code, "account_collaboration_cover_copy_failed");
  assert.equal(count("storage:remove"), 0, "storage purged before relocation succeeded");
  assert.ok(db.files.has(`${U}/trips/T1/a.jpg`));
  assert.deepEqual(await run(REQ2), { completed: true });
  assert.equal(db.saved_trips.find((t) => t.id === "T1")?.custom_cover_image_url, pub(`${MEM}/trips/T1/a.jpg`));
  assert.ok(db.files.has(`${MEM}/trips/T1/a.jpg`));
});

await check("U4 成員行程 copy 丟例外 → account_collaboration_cover_copy_failed；續跑完成", async () => {
  resetAll();
  fault.copy.push(new Error("upstream 503"));
  await assert.rejects(run(REQ1), /account_collaboration_cover_copy_failed/);
  assert.equal(count("storage:remove"), 0);
  assert.deepEqual(await run(REQ2), { completed: true });
  assert.ok(db.files.has(`${MEM}/trips/T1/a.jpg`));
});

await check("U5 非成員行程 exists 丟例外 → 不明確：不動該列、刪帳號照常完成", async () => {
  resetAll();
  fault.exists.push({ path: `${U}/trips/T9/z.jpg`, error: new TypeError("fetch failed") });
  assert.deepEqual(await run(REQ1), { completed: true });
  assert.equal(db.saved_trips.find((t) => t.id === "T9")?.custom_cover_image_url, pub(`${U}/trips/T9/z.jpg`), "non-member row must stay untouched");
  assert.equal(ops.some((o) => o === `storage:copy:${U}/trips/T9/z.jpg`), false, "never copies a non-member cover on an unknown exists()");
});

await check("U6 deleteUser 丟原始例外 → unexpected_failed；換新 id 續跑：外部步驟不重做（storage remove／analytics／RevenueCat 各 1 次）、transfer 冪等、deleteUser 再跑一次", async () => {
  resetAll();
  fault.deleteUser.push(new TypeError("socket hang up"));
  await assert.rejects(run(REQ1));
  assert.equal(row().last_error_code, "account_deletion_unexpected_failed");
  assert.equal(row().status, "external_cleanup_complete");
  const before = { remove: count("storage:remove"), analytics: count("from:analytics_events:update"), rc: count("revenuecat") };
  assert.deepEqual(await run(REQ2), { completed: true });
  assert.equal(count("storage:remove"), before.remove, "storage remove re-run");
  assert.equal(count("from:analytics_events:update"), before.analytics, "analytics re-run");
  assert.equal(count("revenuecat"), before.rc, "RevenueCat re-run");
  assert.equal(count("rpc:transfer_owned_shared_trips_for_deletion"), 2, "transfer runs every attempt");
  assert.equal(count("auth:deleteUser"), 2);
  assert.equal(db.saved_trips.find((t) => t.id === "T1")?.user_id, MEM, "transfer stays idempotent");
  assert.equal(db.account_deletion_receipts.length, 1, "receipt upsert idempotent");
});

await check("U7 RevenueCat 逾時（原始 TimeoutError）→ unexpected_failed；續跑時 RevenueCat 重跑（helper 對已刪客戶冪等），其他已完成步驟不重做", async () => {
  resetAll();
  M.revenueCatFail.push(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
  await assert.rejects(run(REQ1));
  assert.equal(row().last_error_code, "account_deletion_unexpected_failed");
  assert.equal(row().status, "analytics_complete");
  assert.deepEqual(await run(REQ3), { completed: true });
  assert.equal(count("revenuecat"), 2);
  assert.equal(count("storage:remove"), 1);
  assert.equal(count("from:analytics_events:update"), 1);
});

await check("U8 Apple 撤銷途中網路錯誤（原始 TypeError）→ unexpected_failed、status 仍 authenticated、未刪 storage；換新 id＋新授權碼續跑：Apple 重新撤銷一次後完成", async () => {
  resetAll();
  provider = "apple";
  M.appleFail.push(new TypeError("Network connection lost."));
  await assert.rejects(run(REQ1, { identityToken: "id-1", authorizationCode: "code-1" }));
  assert.equal(row().last_error_code, "account_deletion_unexpected_failed");
  assert.equal(row().status, "authenticated");
  assert.equal(row().apple_revoke_completed_at, null);
  assert.equal(count("storage:remove"), 0);
  assert.equal(count("rpc:"), 0, "no transfer before Apple revoke succeeded");
  assert.deepEqual(await run(REQ2, { identityToken: "id-2", authorizationCode: "code-2" }), { completed: true });
  assert.deepEqual(ops.filter((o) => o.startsWith("apple:")), ["apple:revoke:code-1", "apple:revoke:code-2"]);
  assert.ok(row().apple_revoke_completed_at);
});

await check("U9 Apple 續跑沿用已用過的授權碼 → apple_authorization_replayed（apple_ 前綴、可續跑），再以新授權碼續跑完成", async () => {
  resetAll();
  provider = "apple";
  M.appleFail.push(new TypeError("Network connection lost."), new Error("apple_authorization_replayed"));
  await assert.rejects(run(REQ1, { identityToken: "id-1", authorizationCode: "code-1" }));
  await assert.rejects(run(REQ2, { identityToken: "id-1", authorizationCode: "code-1" }), /apple_authorization_replayed/);
  assert.equal(row().last_error_code, "apple_authorization_replayed");
  assert.equal(acct.canResumeFailedExternalRequest(row()), true);
  assert.deepEqual(await run(REQ3, { identityToken: "id-3", authorizationCode: "code-3" }), { completed: true });
});

await check("U10 Apple 撤銷完成後才失敗（status=apple_revoke_complete）→ 續跑不再呼叫 Apple", async () => {
  resetAll();
  provider = "apple";
  fault.list.push(new TypeError("fetch failed"));
  await assert.rejects(run(REQ1, { identityToken: "id-1", authorizationCode: "code-1" }));
  assert.equal(row().status, "apple_revoke_complete");
  assert.equal(row().last_error_code, "account_deletion_unexpected_failed");
  assert.deepEqual(await run(REQ2, { identityToken: "id-2", authorizationCode: "code-2" }), { completed: true });
  assert.deepEqual(ops.filter((o) => o.startsWith("apple:")), ["apple:revoke:code-1"]);
});

await check("U11 進行中（last_error_code=null）的請求：另一個新 request id 仍被擋 account_deletion_already_in_progress（續跑碼不會讓並行請求插隊）", async () => {
  resetAll();
  db.account_deletion_requests.push({ user_id: U, request_id: REQ1, provider: "google", status: "storage_complete", attempt_count: 1, last_error_code: null, apple_revoke_completed_at: null, storage_completed_at: "x", analytics_completed_at: null, external_cleanup_completed_at: null });
  await assert.rejects(run(REQ2), /account_deletion_already_in_progress/);
  assert.equal(row().last_error_code, null, "in-flight row must not be marked");
  assert.equal(count("auth:deleteUser"), 0);
});

if (NET_BLOCKED.length) {
  failed += 1;
  say("FAIL NET unmocked network: " + NET_BLOCKED.join(", "));
} else say("PASS NET 沒有任何網路請求");
Object.assign(console, quiet);
fs.rmSync(tmp, { recursive: true, force: true });
say(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
