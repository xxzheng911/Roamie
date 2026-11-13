// verify-account-deletion-cover-batch-run2.mjs — 任務單 #20：資安稽核 run-2 問題 2（低）刪帳號封面處理耗盡 subrequest
//
// 以 esbuild 打包「真實」 account-deletion.server.ts，只 mock 邊界：@supabase/supabase-js（in-memory fake admin／user
// client，含 storage）、Apple revoke、RevenueCat。全域 fetch／http(s)／net／tls／WebSocket 一律攔截，出現任何非 mock 的
// 網路請求 → FAIL。清除金鑰類環境變數、不讀 .env。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-account-deletion-cover-batch-run2.mjs
//
// fake 的行為（比照 PostgREST／storage-js）：
//   - from().select() 支援 eq／neq／in／is／or(like|eq|neq|is)／order／range／limit；每次回應最多 MAX_ROWS（1000，
//     模擬 Supabase db-max-rows），不管 range 要多少。
//   - update(patch) 搭配任意 filter（含 .in("id", ids)）；每次 await 算 1 次 PostgREST subrequest。
//   - storage.list(prefix, {limit, offset})：只列直接子項、資料夾 id=null、依名稱排序、預設 limit 100。
//   - subrequest = PostgREST（含 rpc）＋ storage（list/exists/copy/remove）＋ auth（getUser/deleteUser）。
//
// 驗收（核准設計：saved_trips 查詢 .order("id")＋.range() 分頁；非成員行程只在 `<V>/trips` 清單內有該 tripId
// 時才 exists → copy，否則以 .in("id", ids) 分批清成 null；storageAlreadyPurged 不列清單直接批次清 null）：
//   B1 攻擊者 N=3000 筆自己的行程，封面指向 `<V>/trips/<自己的tripId>/x`，V storage 無這些資料夾 →
//      完成；exists 0 次；這些欄位清成 null（其他欄位不動）；saved_trips UPDATE 次數是批次數不是 N；
//      subrequest 總數 ≤ 1000。
//   B2 同時存在 3000 筆惡意列（排在前面）與成員行程 → 成員行程封面照常搬移（不被 max-rows 擠出）。
//   B3 續跑：已轉移、成員資格已移除，V storage 有 `<V>/trips/<tripId>/`（清單第 2 頁）→ 仍走 exists → copy。
//   B4 封面指向 V 頭像／別的行程封面／含 .. 的路徑 → 完全不動（一般與已清 storage 兩種狀態）。
//   B5 storageAlreadyPurged（status=storage_complete）＋3000 筆 → 批次清 null；list 0 次、exists 0 次。
// 修改前預期：B1、B2、B5 FAIL；B3、B4 PASS。

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-acct-batch-"));
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
const U = "11111111-1111-4111-8111-111111111111"; // V: the user being deleted
const MEM = "22222222-2222-4222-8222-222222222222";
const ATK = "33333333-3333-4333-8333-333333333333"; // attacker (unrelated owner)
const REQ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAX_ROWS = 1000; // Supabase default db-max-rows
const SUBREQUEST_BUDGET = 1000; // Cloudflare Workers (paid) default subrequests per invocation
const FIELDS = ["custom_cover_image_url", "cover_image_url", "cover_image"];
const MIN_BATCH = 50; // UPDATE count bound: FIELDS.length × ceil(N / MIN_BATCH)
const N = 3000;
const EXTERNAL = "https://images.example.test/cover.jpg";
const pub = (p) => `${SUPA}/storage/v1/object/public/profile-media/${p}`;
const uuid = (prefix, i) => `${prefix}-0000-4000-8000-${String(i).padStart(12, "0")}`;
const likeMatch = (v, pat) =>
  typeof v === "string" &&
  new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(v);
const OR_OPS = {
  like: (v, a) => likeMatch(v, a),
  eq: (v, a) => v != null && String(v) === a,
  neq: (v, a) => v == null || String(v) !== a,
  is: (v, a) => (a === "null" ? v == null : String(v) === a),
};
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

function makeWorld(db, { maxRows = MAX_ROWS } = {}) {
  const ops = [];
  const sub = { postgrest: 0, rpc: 0, list: 0, exists: 0, copy: 0, remove: 0, auth: 0, tripUpdateCalls: 0, inSizes: [], selectSizes: [] };
  M.ops = ops;
  M.sub = sub;
  const admin = {
    from(table) {
      const q = { op: "select", filters: [], payload: null, order: [], range: null, limit: null, returning: false, inSize: null };
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
          q.inSize = vs.length;
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
              sub.postgrest += 1;
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
                out = out.slice(0, maxRows);
                if (table === "saved_trips") sub.selectSizes.push(out.length);
                return { data: q.single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null };
              }
              if (q.op === "insert" || q.op === "upsert") rows.push({ ...q.payload });
              if (q.op === "update") {
                if (table === "saved_trips") {
                  sub.tripUpdateCalls += 1;
                  if (q.inSize != null) sub.inSizes.push(q.inSize);
                  for (const r of hit) ops.push(`update:saved_trips:${r.id}`);
                }
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
      sub.rpc += 1;
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
            sub.list += 1;
            ops.push(`storage:list:${prefix}:${opts?.limit ?? "-"}:${opts?.offset ?? "-"}`);
            return { data: storageList(db.files, prefix, opts), error: null };
          },
          async exists(p) {
            sub.exists += 1;
            ops.push(`storage:exists:${p}`);
            return { data: db.files.has(p), error: null };
          },
          async copy(from, to) {
            sub.copy += 1;
            ops.push(`storage:copy:${from}->${to}`);
            if (!db.files.has(from)) return { data: null, error: { message: "Object not found" } };
            db.files.add(to);
            return { data: { path: to }, error: null };
          },
          async remove(paths) {
            sub.remove += 1;
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
          sub.auth += 1;
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
    key === ENV.SUPABASE_SERVICE_ROLE_KEY
      ? admin
      : { auth: { getUser: async () => ((sub.auth += 1), { data: { user }, error: null }) } };
  return { ops, sub };
}
const totalSub = (s) => s.postgrest + s.rpc + s.list + s.exists + s.copy + s.remove + s.auth;
const fmtSub = (s) =>
  `total=${totalSub(s)} postgrest=${s.postgrest} rpc=${s.rpc} list=${s.list} exists=${s.exists} copy=${s.copy} remove=${s.remove} auth=${s.auth} ` +
  `saved_trips.update=${s.tripUpdateCalls} maxIn=${s.inSizes.length ? Math.max(...s.inSizes) : "-"} selectPages=[${s.selectSizes.join(",")}]`;
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
const purgedState = (lastError = "revenuecat_delete_failed") => ({
  user_id: U,
  request_id: REQ_ID,
  provider: "google",
  status: "storage_complete",
  attempt_count: 1,
  last_error_code: lastError,
  apple_revoke_completed_at: null,
  storage_completed_at: "2026-11-10T00:00:00.000Z",
  analytics_completed_at: null,
  external_cleanup_completed_at: null,
});

/** N attacker-owned trips; each has one cover column pointing to `<V>/trips/<its own id>/x.jpg` (rotating column). */
function attackerRows(n, idPrefix = "a0000000") {
  const rows = [];
  const members = [];
  for (let i = 0; i < n; i += 1) {
    const id = uuid(idPrefix, i);
    const target = FIELDS[i % 3];
    const row = { id, user_id: ATK, custom_cover_image_url: null, cover_image_url: null, cover_image: null };
    row[target] = pub(`${U}/trips/${id}/x.jpg`);
    // One other column carries an unrelated external cover that must survive.
    row[FIELDS[(i + 1) % 3]] = EXTERNAL;
    rows.push(row);
    members.push({ id: "am" + i, trip_id: id, user_id: ATK, is_owner: true, status: "accepted", created_at: "2026-01-01" });
  }
  return { rows, members };
}
/** Problems with the attacker rows after deletion (empty = all cleared correctly). */
function attackerRowProblems(db, n, idPrefix = "a0000000") {
  const byId = new Map(db.saved_trips.map((t) => [t.id, t]));
  let notCleared = 0;
  let collateral = 0;
  let missing = 0;
  for (let i = 0; i < n; i += 1) {
    const t = byId.get(uuid(idPrefix, i));
    if (!t) {
      missing += 1;
      continue;
    }
    if (t[FIELDS[i % 3]] !== null) notCleared += 1;
    if (t[FIELDS[(i + 1) % 3]] !== EXTERNAL || t[FIELDS[(i + 2) % 3]] !== null || t.user_id !== ATK) collateral += 1;
  }
  const out = [];
  if (missing) out.push(`${missing} attacker rows disappeared`);
  if (notCleared) out.push(`${notCleared}/${n} attacker own-trip cover columns NOT cleared to null`);
  if (collateral) out.push(`${collateral} attacker rows had other columns changed`);
  return out;
}

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
    say("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 14).join("\n     "));
  }
}
/** Collects every violated expectation so one run shows all of them. */
function expectAll(problems, sub) {
  assert.ok(problems.length === 0, problems.map((p) => "- " + p).join("\n") + "\nsubrequests: " + fmtSub(sub));
}

await check(`B1 攻擊者 ${N} 筆自己的行程、封面指向 <V>/trips/<自己的tripId>/x、V storage 無這些資料夾 → 完成；exists 0；清成 null；UPDATE 為批次數；subrequest ≤ ${SUBREQUEST_BUDGET}`, async () => {
  const db = baseDb();
  const atk = attackerRows(N);
  db.saved_trips = atk.rows;
  db.trip_members = atk.members;
  db.files = new Set([`${U}/avatar.jpg`, `${ATK}/avatar.jpg`]);
  const { ops, sub } = makeWorld(db);
  const problems = [];
  let result;
  try {
    result = await runDeletion();
  } catch (e) {
    problems.push("deletion threw: " + (e?.message ?? e));
  }
  if (result?.completed !== true) problems.push("deletion did not complete");
  if (!ops.includes("auth:deleteUser")) problems.push("deleteUser not reached");
  if (sub.exists !== 0) problems.push(`exists() called ${sub.exists} times (expected 0)`);
  if (sub.copy !== 0) problems.push(`copy() called ${sub.copy} times (expected 0)`);
  problems.push(...attackerRowProblems(db, N));
  const bound = FIELDS.length * Math.ceil(N / MIN_BATCH);
  if (sub.tripUpdateCalls > bound) problems.push(`saved_trips UPDATE called ${sub.tripUpdateCalls} times (expected batched, ≤ ${bound})`);
  if (totalSub(sub) > SUBREQUEST_BUDGET) problems.push(`subrequests ${totalSub(sub)} > budget ${SUBREQUEST_BUDGET}`);
  if (prefixFiles(db).length) problems.push("deleted user's prefix not purged");
  if (!db.files.has(`${ATK}/avatar.jpg`)) problems.push("other user's file removed");
  expectAll(problems, sub);
  say("     observe: " + fmtSub(sub));
});

await check(`B2 ${N} 筆惡意列排在前面（max-rows=${MAX_ROWS}）＋成員行程／已轉移行程 → 成員封面照常搬移、不被擠出結果`, async () => {
  const db = baseDb();
  const atk = attackerRows(N);
  const S = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // U is a member (MEM owns); sorts after every attacker id
  const T = "fffffffe-ffff-4fff-8fff-ffffffffffff"; // U owns, shared with MEM → transferred
  db.saved_trips = [
    ...atk.rows,
    { id: T, user_id: U, custom_cover_image_url: pub(`${U}/trips/${T}/t.jpg`), cover_image_url: null, cover_image: null },
    { id: S, user_id: MEM, custom_cover_image_url: null, cover_image_url: pub(`${U}/trips/${S}/s.jpg`), cover_image: null },
  ];
  db.trip_members = [
    ...atk.members,
    { id: "t1", trip_id: T, user_id: U, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "t2", trip_id: T, user_id: MEM, is_owner: false, status: "accepted", created_at: "2026-02-01" },
    { id: "s1", trip_id: S, user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "s2", trip_id: S, user_id: U, is_owner: false, status: "accepted", created_at: "2026-02-01" },
  ];
  db.files = new Set([`${U}/trips/${T}/t.jpg`, `${U}/trips/${S}/s.jpg`, `${U}/avatar.jpg`]);
  const { ops, sub } = makeWorld(db);
  const problems = [];
  let result;
  try {
    result = await runDeletion();
  } catch (e) {
    problems.push("deletion threw: " + (e?.message ?? e));
  }
  if (result?.completed !== true) problems.push("deletion did not complete");
  const s = db.saved_trips.find((t) => t.id === S);
  const t = db.saved_trips.find((x) => x.id === T);
  if (s?.cover_image_url !== pub(`${MEM}/trips/${S}/s.jpg`))
    problems.push(`member trip S cover not relocated (got ${String(s?.cover_image_url).replace(SUPA, "")})`);
  if (!db.files.has(`${MEM}/trips/${S}/s.jpg`)) problems.push("member trip S file not copied to owner prefix");
  if (t?.user_id !== MEM) problems.push("transferred trip T not owned by MEM");
  if (t?.custom_cover_image_url !== pub(`${MEM}/trips/${T}/t.jpg`))
    problems.push(`transferred trip T cover not relocated (got ${String(t?.custom_cover_image_url).replace(SUPA, "")})`);
  if (!db.files.has(`${MEM}/trips/${T}/t.jpg`)) problems.push("transferred trip T file not copied to owner prefix");
  const copies = ops.filter((o) => o.startsWith("storage:copy:"));
  if (copies.length !== 2) problems.push(`expected exactly 2 copies (S, T), got ${copies.length}`);
  problems.push(...attackerRowProblems(db, N));
  if (totalSub(sub) > SUBREQUEST_BUDGET) problems.push(`subrequests ${totalSub(sub)} > budget ${SUBREQUEST_BUDGET}`);
  if (prefixFiles(db).length) problems.push("deleted user's prefix not purged");
  expectAll(problems, sub);
  say("     observe: " + fmtSub(sub));
});

await check("B3 續跑：已轉移、成員資格已移除、V storage 有 <V>/trips/<tripId>/（storage 清單第 2 頁）→ 仍走 exists → copy、改指向、完成", async () => {
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
  const T = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const atk = attackerRows(300);
  // 150 of V's own solo trips with covers → `<V>/trips` has 151 folders; T sorts last (page 2 at limit 100).
  const solo = Array.from({ length: 150 }, (_, i) => uuid("0000aaaa", i));
  db.saved_trips = [
    ...atk.rows,
    ...solo.map((id) => ({ id, user_id: U, custom_cover_image_url: pub(`${U}/trips/${id}/c.jpg`), cover_image_url: null, cover_image: null })),
    { id: T, user_id: MEM, custom_cover_image_url: pub(`${U}/trips/${T}/c.jpg`), cover_image_url: null, cover_image: pub(`${U}/trips/${T}/c.jpg`) },
  ];
  db.trip_members = [...atk.members, { id: "m2", trip_id: T, user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-03-01" }];
  db.files = new Set([`${U}/trips/${T}/c.jpg`, `${U}/avatar.jpg`, ...solo.map((id) => `${U}/trips/${id}/c.jpg`)]);
  const { ops, sub } = makeWorld(db);
  assert.deepEqual(await runDeletion(), { completed: true });
  const copyIdx = ops.indexOf(`storage:copy:${U}/trips/${T}/c.jpg->${MEM}/trips/${T}/c.jpg`);
  assert.ok(copyIdx >= 0, "resumed trip cover not copied:\n" + ops.filter((o) => o.startsWith("storage:")).slice(0, 20).join("\n"));
  const existsIdx = ops.findIndex((o) => o.startsWith("storage:exists:") && o.includes(`/trips/${T}/`));
  assert.ok(existsIdx >= 0 && existsIdx < copyIdx, "exists() must be probed before copy");
  const t = db.saved_trips.find((x) => x.id === T);
  assert.equal(t.custom_cover_image_url, pub(`${MEM}/trips/${T}/c.jpg`));
  assert.equal(t.cover_image, pub(`${MEM}/trips/${T}/c.jpg`));
  assert.ok(db.files.has(`${MEM}/trips/${T}/c.jpg`));
  assert.equal(ops.filter((o) => o.startsWith("storage:copy:")).length, 1, "only the resumed trip cover is copied");
  assert.ok(ops.includes("auth:deleteUser"));
  assert.deepEqual(prefixFiles(db), [], "deleted user's prefix purged");
  say("     observe: " + fmtSub(sub));
});

for (const purged of [false, true]) {
  await check(`B4${purged ? "b（storage 已清）" : "a"} 非成員行程封面指向 V 頭像／別的行程封面／含 .. 的路徑 → 完全不動（不 exists、不 update、不 copy）；同列的本行程封面欄位仍清成 null`, async () => {
    const db = baseDb();
    if (purged) db.account_deletion_requests = [purgedState()];
    const S = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // U is a member; its cover folder exists in V's storage
    const X2 = "b0000000-0000-4000-8000-000000000002";
    const X3 = "b0000000-0000-4000-8000-000000000003";
    const X4 = "b0000000-0000-4000-8000-000000000004";
    const X5 = "b0000000-0000-4000-8000-000000000005";
    db.saved_trips = [
      { id: X2, user_id: ATK, custom_cover_image_url: null, cover_image_url: pub(`${U}/avatar.jpg`), cover_image: null },
      { id: X3, user_id: ATK, custom_cover_image_url: null, cover_image_url: null, cover_image: pub(`${U}/trips/${S}/s.jpg`) },
      { id: X4, user_id: ATK, custom_cover_image_url: pub(`${U}/trips/${X4}/../${S}/s.jpg`), cover_image_url: null, cover_image: null },
      // Mixed row: own-trip path (no such folder) in one column, V's avatar in another.
      { id: X5, user_id: ATK, custom_cover_image_url: pub(`${U}/trips/${X5}/x.jpg`), cover_image_url: pub(`${U}/avatar.jpg`), cover_image: EXTERNAL },
      { id: S, user_id: MEM, custom_cover_image_url: pub(`${U}/trips/${S}/s.jpg`), cover_image_url: null, cover_image: null },
    ];
    db.trip_members = [
      { id: "s1", trip_id: S, user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-01-01" },
      { id: "s2", trip_id: S, user_id: U, is_owner: false, status: "accepted", created_at: "2026-02-01" },
      ...[X2, X3, X4, X5].map((id, i) => ({ id: "x" + i, trip_id: id, user_id: ATK, is_owner: true, status: "accepted", created_at: "2026-01-01" })),
    ];
    db.files = purged ? new Set() : new Set([`${U}/avatar.jpg`, `${U}/trips/${S}/s.jpg`]);
    if (purged) db.files.add(`${MEM}/trips/${S}/s.jpg`); // attempt 1 already copied S before purging
    const untouched = JSON.parse(JSON.stringify(db.saved_trips.filter((t) => [X2, X3, X4].includes(t.id))));
    const { ops, sub } = makeWorld(db);
    assert.deepEqual(await runDeletion(), { completed: true });
    assert.deepEqual(
      db.saved_trips.filter((t) => [X2, X3, X4].includes(t.id)),
      untouched,
      "avatar / other-trip / traversal rows must stay untouched",
    );
    for (const id of [X2, X3, X4]) assert.equal(ops.includes(`update:saved_trips:${id}`), false, "UPDATE issued for " + id);
    assert.equal(ops.includes(`storage:exists:${U}/avatar.jpg`), false, "avatar path must not be probed");
    assert.equal(
      ops.some((o) => o.startsWith("storage:exists:") && o.includes("..")),
      false,
      "traversal path must not be probed",
    );
    const x5 = db.saved_trips.find((t) => t.id === X5);
    assert.deepEqual(
      { c: x5.custom_cover_image_url, u: x5.cover_image_url, i: x5.cover_image },
      { c: null, u: pub(`${U}/avatar.jpg`), i: EXTERNAL },
      "mixed row: own-trip column cleared, avatar/external columns untouched",
    );
    const copies = ops.filter((o) => o.startsWith("storage:copy:"));
    assert.ok(copies.every((o) => o.includes(`/trips/${S}/s.jpg->${MEM}/`)), "only the member trip S may be copied: " + copies.join(", "));
    const s = db.saved_trips.find((t) => t.id === S);
    assert.equal(s.custom_cover_image_url, pub(`${MEM}/trips/${S}/s.jpg`), "member trip S relocated");
    assert.ok(ops.includes("auth:deleteUser"));
    say("     observe: " + fmtSub(sub));
  });
}

await check(`B5 storageAlreadyPurged（status=storage_complete）＋${N} 筆 → 批次清成 null；list 0、exists 0；UPDATE 為批次數；subrequest ≤ ${SUBREQUEST_BUDGET}`, async () => {
  const db = baseDb();
  db.account_deletion_requests = [purgedState()];
  const atk = attackerRows(N);
  db.saved_trips = atk.rows;
  db.trip_members = atk.members;
  db.files = new Set([`${ATK}/avatar.jpg`]);
  const { ops, sub } = makeWorld(db);
  const problems = [];
  let result;
  try {
    result = await runDeletion();
  } catch (e) {
    problems.push("deletion threw: " + (e?.message ?? e));
  }
  if (result?.completed !== true) problems.push("deletion did not complete");
  if (!ops.includes("auth:deleteUser")) problems.push("deleteUser not reached");
  if (sub.list !== 0) problems.push(`list() called ${sub.list} times (expected 0)`);
  if (sub.exists !== 0) problems.push(`exists() called ${sub.exists} times (expected 0)`);
  if (sub.copy !== 0 || sub.remove !== 0) problems.push(`copy/remove called (${sub.copy}/${sub.remove})`);
  problems.push(...attackerRowProblems(db, N));
  const bound = FIELDS.length * Math.ceil(N / MIN_BATCH);
  if (sub.tripUpdateCalls > bound) problems.push(`saved_trips UPDATE called ${sub.tripUpdateCalls} times (expected batched, ≤ ${bound})`);
  if (totalSub(sub) > SUBREQUEST_BUDGET) problems.push(`subrequests ${totalSub(sub)} > budget ${SUBREQUEST_BUDGET}`);
  expectAll(problems, sub);
  say("     observe: " + fmtSub(sub));
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
