// verify-account-deletion-cover-scope-review3.mjs — 任務單 #8（第 3 次獨立複審）刪帳號封面搬移範圍
//
// 以 esbuild 打包「真實」 account-deletion.server.ts，只 mock 邊界：@supabase/supabase-js（in-memory fake
// admin／user client，含 storage）、Apple revoke、RevenueCat。全域 fetch／http(s)／net／tls／WebSocket 一律攔截，
// 出現任何網路請求 → FAIL。清除金鑰類環境變數、不讀 .env。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-account-deletion-cover-scope-review3.mjs
//
// 覆蓋：
//   A1 非成員的行程（別人擁有、被刪者從未是成員）封面欄位指向被刪者 prefix：本行程路徑但檔案不存在 → 清成 null
//      （發出 UPDATE）；被刪者頭像／別的行程封面且檔案存在 → 完全不被改動；沒有任何 copy；
//      對照組：被刪者是成員的共享行程封面照常搬到擁有者 prefix。
//   A2 續跑：第 1 次 transfer 已把行程轉出並移除被刪者成員資格，但封面 copy 失敗（中止）；
//      第 2 次（成員清單已不含該行程）封面檔仍在 → 照樣搬到新擁有者 prefix、改指向、deleteUser、prefix 清空。
//   A3 同 A2，但第 2 次續跑時來源檔不在且目的檔也不在（非成員、無檔）→ 不卡住：完成刪帳號，壞掉的封面清成 null。
//   A4 非成員、本行程路徑，exists 回不明確結果 → 該列不動、不 copy、刪帳號照常完成。
//
// 任務單 #20：fake query builder 另支援 in／is／order／range／limit（＋可選的 db-max-rows 上限），or() 支援
// like／eq／neq／is；storage list(prefix, {limit, offset}) 比照 storage-js（只列直接子項、資料夾 id=null、依名稱排序、
// 預設 limit 100）。擴充不改變 A1–A6 的既有斷言。分頁／批次的驗收在 verify-account-deletion-cover-batch-run2.mjs。

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const k of Object.keys(process.env)) {
  if (/SUPABASE|OPENAI|GOOGLE_|SERVICE_ROLE|REVENUECAT|STRIPE|UNSPLASH|SECRET|APPLE/i.test(k)) delete process.env[k];
}
const NET_BLOCKED = [];
function installNetTraps() {
  globalThis.fetch = async (input) => {
    NET_BLOCKED.push(String(input?.url ?? input).slice(0, 120));
    throw new TypeError("NETWORK_BLOCKED");
  };
  globalThis.WebSocket = class {
    constructor(u) {
      NET_BLOCKED.push("ws:" + String(u).slice(0, 80));
      throw new Error("NETWORK_BLOCKED ws");
    }
  };
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
}

globalThis.__m = {};
const M = globalThis.__m;
const say = (s) => fs.writeSync(1, s + "\n");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quiet = { info: console.info, warn: console.warn, error: console.error };

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-acct-scope-"));
const outFile = path.join(tmp, "acct.mjs");
const mocks = {
  "@supabase/supabase-js": `export const createClient = (...a) => globalThis.__m.createClient(...a); export class SupabaseClient {}`,
  "./apple-revoke.server": `export const revokeAppleAuthorization = async () => {};`,
  "./revenuecat-customer-delete.server": `export const deleteRevenueCatCustomerV2 = async () => { globalThis.__m.ops.push("revenuecat"); };`,
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
installNetTraps();
console.info = () => {};
console.warn = () => {};
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
const REQ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pub = (p) => `${SUPA}/storage/v1/object/public/profile-media/${p}`;
const likeMatch = (v, pat) =>
  typeof v === "string" &&
  new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(v);
// PostgREST or() operators supported by the fake (unknown operator → test error, never silently true).
const OR_OPS = {
  like: (v, a) => likeMatch(v, a),
  eq: (v, a) => v != null && String(v) === a,
  neq: (v, a) => v == null || String(v) !== a,
  is: (v, a) => (a === "null" ? v == null : String(v) === a),
};
/** storage-js list(): direct children of `prefix`, folders id=null, sorted by name, limit/offset (default 100/0). */
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
    .map(([name, id]) => ({ name, id, updated_at: null, created_at: null, last_accessed_at: null, metadata: id ? {} : null }));
}

function makeWorld(db, { copyFailOnce = new Set(), existsOverride = new Map(), maxRows = Infinity } = {}) {
  const ops = [];
  M.ops = ops;
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
        // NULL 比較在 Postgres 為 NULL → 不入選。篩選在 exec 時先套用，再 order，最後 range／limit／max-rows。
        gt: (c, v) => (q.filters.push((r) => r[c] != null && r[c] > v), api),
        in: (c, vs) => {
          assert.ok(Array.isArray(vs), "in() expects an array");
          const set = new Set(vs);
          q.filters.push((r) => set.has(r[c]));
          return api;
        },
        is: (c, v) => (q.filters.push((r) => (v === null ? r[c] == null : r[c] === v)), api),
        or: (expr) => {
          const parts = expr.split(",").map((p) => {
            const [col, op, ...rest] = p.split(".");
            assert.ok(Object.hasOwn(OR_OPS, op), "unsupported or() operator: " + op);
            return { col, op, arg: rest.join(".") };
          });
          q.filters.push((r) => parts.some(({ col, op, arg }) => OR_OPS[op](r[col], arg)));
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
                // PostgREST db-max-rows caps every response, whatever range was requested.
                out = out.slice(0, maxRows);
                return { data: q.single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null };
              }
              if (q.op === "insert" || q.op === "upsert") rows.push({ ...q.payload });
              if (q.op === "update") {
                if (table === "saved_trips") for (const r of hit) ops.push(`update:saved_trips:${r.id}`);
                for (const r of hit) Object.assign(r, q.payload);
              }
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
      assert.equal(fn, "transfer_owned_shared_trips_for_deletion");
      let count = 0;
      for (const trip of db.saved_trips.filter((t) => t.user_id === args.p_user_id)) {
        const next = db.trip_members
          .filter((m) => m.trip_id === trip.id && m.user_id !== args.p_user_id && m.status === "accepted")
          .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
        if (!next) continue;
        for (const m of db.trip_members) if (m.trip_id === trip.id) m.is_owner = m === next;
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
          async list(prefix, opts) {
            ops.push(`storage:list:${prefix}`);
            return { data: storageList(db.files, prefix, opts), error: null };
          },
          async exists(p) {
            ops.push(`storage:exists:${p}`);
            if (existsOverride.has(p)) {
              const v = existsOverride.get(p);
              if (v instanceof Error) throw v;
              return v;
            }
            return { data: db.files.has(p), error: null };
          },
          async copy(from, to) {
            ops.push(`storage:copy:${from}->${to}`);
            if (copyFailOnce.has(from)) {
              copyFailOnce.delete(from);
              return { data: null, error: { message: "fixture copy failure" } };
            }
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
          db.saved_trips = db.saved_trips.filter((t) => t.user_id !== id);
          db.trip_members = db.trip_members.filter((m) => m.user_id !== id);
          return { data: {}, error: null };
        },
      },
    },
  };
  const user = { id: U, email: "deleted-user@example.test", app_metadata: { provider: "google" }, identities: [] };
  M.createClient = (_url, key) =>
    key === ENV.SUPABASE_SERVICE_ROLE_KEY ? admin : { auth: { getUser: async () => ({ data: { user }, error: null }) } };
  return ops;
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mkRequest = () => {
  const jwt = `${b64({ alg: "none" })}.${b64({ sub: U, amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 30 }] })}.sig`;
  return new Request("https://roamie.tw/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
};
const runDeletion = () => acct.deleteAuthenticatedAccount({ request: mkRequest(), runtimeEnv: ENV, body: { requestId: REQ_ID } });
const baseDb = () => ({
  account_deletion_requests: [],
  account_deletion_receipts: [],
  trip_invites: [],
  analytics_events: [],
  saved_trips: [],
  trip_members: [],
  files: new Set(),
});
const prefixFiles = (db) => [...db.files].filter((f) => f.startsWith(U + "/"));

// 任務單 #R4-1：mock 自我檢查（不計入 PASS 數，失敗即中止腳本）— 證明 gt 真的篩選，且 mock 的執行順序是
// 篩選 → order → limit／range；keyset 逐頁讀完不漏不重。gt 若是 no-op 或 limit 先於篩選，這裡會丟錯。
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
  const selfDb = baseDb();
  makeWorld(selfDb);
  await gtMockSelfCheck(M.createClient(SUPA, ENV.SUPABASE_SERVICE_ROLE_KEY), selfDb);
  say("SELFCHECK gt mock：篩選→order→limit／range、keyset 逐頁 OK（不計入 PASS 數）");
} catch (e) {
  say("FAIL SELFCHECK gt mock\n     " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n     "));
  process.exit(1);
}

const failures = [];
let passCount = 0;
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    say("PASS " + name);
  } catch (e) {
    failures.push(name);
    say("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 12).join("\n     "));
  }
}

await check("A1 非成員行程封面指向被刪者 prefix → 刪帳號完成；X1（本行程路徑、無檔）清成 null；X2 頭像／X3 別行程完全不動、不 copy；成員行程照常搬移（對照）", async () => {
  const db = baseDb();
  db.saved_trips = [
    // Not a member, own-trip path under U's prefix, file does not exist (crafted URL).
    { id: "X1-crafted", user_id: OTHER, custom_cover_image_url: pub(`${U}/trips/X1-crafted/fake.jpg`), cover_image_url: null, cover_image: null },
    // Not a member, points to U's avatar (file exists).
    { id: "X2-avatar", user_id: OTHER, custom_cover_image_url: null, cover_image_url: pub(`${U}/avatar.jpg`), cover_image: null },
    // Not a member, points to another trip's real cover under U's prefix (file exists).
    { id: "X3-other-trip", user_id: OTHER, custom_cover_image_url: null, cover_image_url: null, cover_image: pub(`${U}/trips/S-shared/s.jpg`) },
    // Control: U is an accepted (non-owner) member; cover uploaded by U.
    { id: "S-shared", user_id: MEM, custom_cover_image_url: pub(`${U}/trips/S-shared/s.jpg`), cover_image_url: null, cover_image: null },
  ];
  db.trip_members = [
    { id: "m1", trip_id: "S-shared", user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "m2", trip_id: "S-shared", user_id: U, is_owner: false, status: "accepted", created_at: "2026-02-01" },
    { id: "m3", trip_id: "X1-crafted", user_id: OTHER, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "m4", trip_id: "X2-avatar", user_id: OTHER, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "m5", trip_id: "X3-other-trip", user_id: OTHER, is_owner: true, status: "accepted", created_at: "2026-01-01" },
  ];
  db.files = new Set([`${U}/avatar.jpg`, `${U}/trips/S-shared/s.jpg`, `${OTHER}/avatar.jpg`]);
  const before = JSON.parse(JSON.stringify(db.saved_trips.filter((t) => t.id.startsWith("X"))));
  const ops = makeWorld(db);
  assert.deepEqual(await runDeletion(), { completed: true });
  assert.ok(ops.includes("auth:deleteUser"), "deleteUser not reached");
  // X1: own-trip path under U's prefix, file missing → broken cover cleared to null (UPDATE issued).
  const x1 = db.saved_trips.find((t) => t.id === "X1-crafted");
  assert.deepEqual(
    { ...x1 },
    { ...before.find((t) => t.id === "X1-crafted"), custom_cover_image_url: null },
    "X1 broken own-trip cover must be cleared to null and nothing else changed",
  );
  assert.equal(ops.filter((o) => o === "update:saved_trips:X1-crafted").length, 1, "X1 must get exactly one UPDATE");
  // X2 / X3: other paths under U's prefix → completely untouched.
  const after = db.saved_trips.filter((t) => t.id === "X2-avatar" || t.id === "X3-other-trip");
  assert.deepEqual(after, before.filter((t) => t.id !== "X1-crafted"), "X2/X3 rows must stay untouched");
  for (const id of ["X2-avatar", "X3-other-trip"])
    assert.equal(ops.includes(`update:saved_trips:${id}`), false, "UPDATE issued for non-member row " + id);
  assert.equal(ops.includes(`storage:exists:${U}/avatar.jpg`), false, "avatar path must not even be probed");
  const copies = ops.filter((o) => o.startsWith("storage:copy:"));
  assert.deepEqual(copies, [`storage:copy:${U}/trips/S-shared/s.jpg->${MEM}/trips/S-shared/s.jpg`], "only the member trip cover is copied");
  const s = db.saved_trips.find((t) => t.id === "S-shared");
  assert.equal(s.custom_cover_image_url, pub(`${MEM}/trips/S-shared/s.jpg`));
  assert.ok(db.files.has(`${MEM}/trips/S-shared/s.jpg`));
  assert.deepEqual(prefixFiles(db), [], "deleted user's prefix purged");
  assert.ok(db.files.has(`${OTHER}/avatar.jpg`), "other users' files untouched");
});

await check("A2 續跑：transfer 已移除成員資格、第 1 次 copy 失敗中止；第 2 次封面檔仍在 → 照樣搬移並完成刪帳號", async () => {
  const db = baseDb();
  db.saved_trips = [
    { id: "T-shared-own", user_id: U, custom_cover_image_url: pub(`${U}/trips/T-shared-own/c.jpg`), cover_image_url: pub(`${U}/trips/T-shared-own/c.jpg`), cover_image: null },
  ];
  db.trip_members = [
    { id: "m1", trip_id: "T-shared-own", user_id: U, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "m2", trip_id: "T-shared-own", user_id: MEM, is_owner: false, status: "accepted", created_at: "2026-03-01" },
  ];
  db.files = new Set([`${U}/trips/T-shared-own/c.jpg`, `${U}/avatar.jpg`]);
  const src = `${U}/trips/T-shared-own/c.jpg`;
  let ops = makeWorld(db, { copyFailOnce: new Set([src]) });
  await assert.rejects(runDeletion(), /account_collaboration_cover_copy_failed/);
  assert.equal(ops.includes("storage:remove"), false, "storage must not be purged after a failed copy");
  assert.equal(ops.includes("auth:deleteUser"), false);
  const t = db.saved_trips.find((x) => x.id === "T-shared-own");
  assert.equal(t.user_id, MEM, "attempt 1 already transferred the trip");
  assert.equal(db.trip_members.some((m) => m.user_id === U), false, "membership already removed by the transfer");
  assert.equal(db.account_deletion_requests[0]?.last_error_code, "account_collaboration_cover_copy_failed");
  assert.equal(acct.canResumeFailedExternalRequest(db.account_deletion_requests[0]), true, "state must be resumable");

  ops = makeWorld(db);
  assert.deepEqual(await runDeletion(), { completed: true });
  assert.ok(ops.includes(`storage:copy:${src}->${MEM}/trips/T-shared-own/c.jpg`), "cover not copied on resume:\n" + ops.join("\n"));
  const t2 = db.saved_trips.find((x) => x.id === "T-shared-own");
  assert.equal(t2?.user_id, MEM, "trip survives");
  assert.equal(t2.custom_cover_image_url, pub(`${MEM}/trips/T-shared-own/c.jpg`));
  assert.equal(t2.cover_image_url, pub(`${MEM}/trips/T-shared-own/c.jpg`));
  assert.ok(db.files.has(`${MEM}/trips/T-shared-own/c.jpg`));
  assert.ok(ops.includes("auth:deleteUser"));
  assert.deepEqual(prefixFiles(db), [], "deleted user's prefix purged");
});

await check("A3 續跑：transfer 已移除成員資格、來源檔已不存在（非成員路徑）→ 不卡住，完成刪帳號", async () => {
  const db = baseDb();
  db.account_deletion_requests = [
    {
      user_id: U,
      request_id: REQ_ID,
      provider: "google",
      status: "authenticated",
      attempt_count: 1,
      last_error_code: "account_collaboration_cover_copy_failed",
      apple_revoke_completed_at: null,
      storage_completed_at: null,
      analytics_completed_at: null,
      external_cleanup_completed_at: null,
    },
  ];
  db.saved_trips = [
    { id: "T-gone", user_id: MEM, custom_cover_image_url: pub(`${U}/trips/T-gone/g.jpg`), cover_image_url: null, cover_image: null },
  ];
  db.trip_members = [{ id: "m2", trip_id: "T-gone", user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-03-01" }];
  db.files = new Set();
  const ops = makeWorld(db);
  assert.deepEqual(await runDeletion(), { completed: true });
  assert.ok(ops.includes("auth:deleteUser"));
  assert.equal(ops.some((o) => o.startsWith("storage:copy:")), false);
  assert.equal(db.saved_trips.find((x) => x.id === "T-gone")?.custom_cover_image_url, null, "broken own-trip cover must be cleared to null");
});

await check("A4 非成員、本行程路徑，exists 回不明確（data:null＋error）→ 不動、不 copy、不卡住", async () => {
  const db = baseDb();
  const p = `${U}/trips/T-unknown/u.jpg`;
  db.saved_trips = [
    { id: "T-unknown", user_id: MEM, custom_cover_image_url: pub(p), cover_image_url: null, cover_image: null },
  ];
  db.trip_members = [{ id: "m2", trip_id: "T-unknown", user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-03-01" }];
  db.files = new Set([p]);
  const before = JSON.parse(JSON.stringify(db.saved_trips));
  const ops = makeWorld(db, { existsOverride: new Map([[p, { data: null, error: { message: "fixture 500" } }]]) });
  assert.deepEqual(await runDeletion(), { completed: true });
  assert.ok(ops.includes(`storage:exists:${p}`), "exists must be probed");
  assert.deepEqual(db.saved_trips, before, "row must stay untouched");
  assert.equal(ops.includes("update:saved_trips:T-unknown"), false, "no UPDATE");
  assert.equal(ops.some((o) => o.startsWith("storage:copy:")), false, "no copy");
  assert.ok(ops.includes("auth:deleteUser"));
});

await check("A5 非成員、本行程路徑，exists 丟例外（storage-js 對非 400/404 會 throw）→ 該列不動；若中止則必須可續跑且未清 storage／未 deleteUser", async () => {
  const db = baseDb();
  const p = `${U}/trips/T-throw/t.jpg`;
  db.saved_trips = [
    { id: "T-throw", user_id: MEM, custom_cover_image_url: pub(p), cover_image_url: null, cover_image: null },
  ];
  db.trip_members = [{ id: "m2", trip_id: "T-throw", user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-03-01" }];
  db.files = new Set([p]);
  const before = JSON.parse(JSON.stringify(db.saved_trips));
  const ops = makeWorld(db, { existsOverride: new Map([[p, new Error("fixture storage 503")]]) });
  let outcome;
  try {
    outcome = await runDeletion();
  } catch (e) {
    outcome = e;
  }
  assert.deepEqual(db.saved_trips, before, "row must stay untouched");
  assert.equal(ops.some((o) => o.startsWith("storage:copy:")), false, "no copy");
  if (outcome instanceof Error) {
    assert.equal(ops.includes("storage:remove"), false, "aborted: storage must not be purged");
    assert.equal(ops.includes("auth:deleteUser"), false, "aborted: user must not be deleted");
    assert.equal(acct.canResumeFailedExternalRequest(db.account_deletion_requests[0]), true, "aborted state must be resumable");
    say("     observe: exists throw → deletion aborted (resumable), code=" + db.account_deletion_requests[0]?.last_error_code);
  } else {
    assert.deepEqual(outcome, { completed: true });
    say("     observe: exists throw → deletion completed, row untouched");
  }
});

await check("A6 成員行程（共享）封面 exists 丟例外 → 中止於清 storage 之前，錯誤碼可續跑（App 重開後換新 request id 仍能續跑）", async () => {
  const db = baseDb();
  const p = `${U}/trips/S2/s.jpg`;
  db.saved_trips = [
    { id: "S2", user_id: MEM, custom_cover_image_url: pub(p), cover_image_url: null, cover_image: null },
  ];
  db.trip_members = [
    { id: "m1", trip_id: "S2", user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "m2", trip_id: "S2", user_id: U, is_owner: false, status: "accepted", created_at: "2026-02-01" },
  ];
  db.files = new Set([p]);
  const ops = makeWorld(db, { existsOverride: new Map([[p, new Error("fixture storage 503")]]) });
  let outcome;
  try {
    outcome = await runDeletion();
  } catch (e) {
    outcome = e;
  }
  assert.ok(outcome instanceof Error, "deletion must not complete without relocating the member cover");
  assert.equal(ops.includes("storage:remove"), false, "storage must not be purged");
  assert.equal(ops.includes("auth:deleteUser"), false);
  const code = db.account_deletion_requests[0]?.last_error_code;
  assert.equal(
    acct.canResumeFailedExternalRequest(db.account_deletion_requests[0]),
    true,
    "aborted state must be resumable; last_error_code=" + JSON.stringify(code),
  );
});

await check("NET 全程沒有任何網路請求（fetch／http(s)／net／tls／WebSocket）", () => assert.deepEqual(NET_BLOCKED, []));

Object.assign(console, quiet);
fs.rmSync(tmp, { recursive: true, force: true });
say(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) say("  FAILED: " + f);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
