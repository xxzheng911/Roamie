// verify-account-deletion-resume-cover-edge.mjs — 任務單 #6 複審發現（預期目前 FAIL）
//
// 情境：第 1 次刪帳號已完成 storage 清除（status=storage_complete），之後在 RevenueCat／analytics／deleteUser
// 失敗。重試之前，有成員透過仍有效的分享連結加入被刪者原本「只有自己一人」的行程 T4（其封面檔已在第 1 次被刪）。
// 續跑時 transfer RPC 把 T4 轉給新成員 → relocateSurvivingTripCovers 嘗試從已不存在的來源複製封面 →
// account_collaboration_cover_copy_failed → 每次續跑都在同一處失敗，帳號永遠刪不掉。
// 期望：續跑可完成（來源檔已不存在時清空封面欄位或改用預設封面），deleteUser 執行，被刪者 prefix 為空。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-account-deletion-resume-cover-edge.mjs
// 不連網（全域 fetch 攔截、supabase-js 以 in-memory fake 取代）、不讀 .env。

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
const quietInfo = console.info;
console.info = () => {};

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-acct-edge-"));
const out = path.join(tmp, "acct.mjs");
const mocks = {
  "@supabase/supabase-js": `export const createClient = (...a) => globalThis.__m.createClient(...a);`,
  "./apple-revoke.server": `export const revokeAppleAuthorization = async () => {};`,
  "./revenuecat-customer-delete.server": `export const deleteRevenueCatCustomerV2 = async () => { globalThis.__m.ops.push("revenuecat"); };`,
};
await build({
  entryPoints: [path.join(root, "src/lib/account-deletion/account-deletion.server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
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
const acct = await import(pathToFileURL(out).href);

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = {
  SUPABASE_URL: SUPA,
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-placeholder",
  ACCOUNT_DELETION_ALLOWED_SUPABASE_REF: "abcdefghijklmnopqrst",
};
const U = "11111111-1111-4111-8111-111111111111";
const MEM = "22222222-2222-4222-8222-222222222222";
const REQ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pub = (p) => `${SUPA}/storage/v1/object/public/profile-media/${p}`;

// State after attempt 1: storage already purged; T4 became shared afterwards.
const db = {
  account_deletion_requests: [
    {
      user_id: U,
      request_id: REQ_ID,
      provider: "google",
      status: "storage_complete",
      attempt_count: 1,
      last_error_code: "revenuecat_delete_failed",
      apple_revoke_completed_at: null,
      storage_completed_at: "2026-11-09T00:00:00.000Z",
      analytics_completed_at: null,
      external_cleanup_completed_at: null,
    },
  ],
  account_deletion_receipts: [],
  trip_invites: [],
  analytics_events: [],
  saved_trips: [
    { id: "T4-late-shared", user_id: U, custom_cover_image_url: pub(`${U}/trips/T4-late-shared/d.jpg`), cover_image_url: null, cover_image: null },
  ],
  trip_members: [
    { id: "m1", trip_id: "T4-late-shared", user_id: U, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "m2", trip_id: "T4-late-shared", user_id: MEM, is_owner: false, status: "accepted", created_at: "2026-11-10" },
  ],
  files: new Set([`${MEM}/avatar.jpg`]), // U's prefix was emptied by attempt 1
};
const ops = [];
M.ops = ops;
const likeMatch = (v, pat) =>
  typeof v === "string" &&
  new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(v);
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
              return { data: q.single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null };
            }
            if (q.op === "insert" || q.op === "upsert") rows.push({ ...q.payload });
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
          ops.push(`storage:list:${prefix}`);
          return { data: storageList(db.files, prefix, opts), error: null };
        },
        async exists(p) {
          return { data: db.files.has(p), error: null };
        },
        async copy(from, to) {
          ops.push(`storage:copy:${from}`);
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
        return { data: {}, error: null };
      },
    },
  },
};
const user = { id: U, email: "deleted-user@example.test", app_metadata: { provider: "google" }, identities: [] };
M.createClient = (_url, key) =>
  key === ENV.SUPABASE_SERVICE_ROLE_KEY ? admin : { auth: { getUser: async () => ({ data: { user }, error: null }) } };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = `${b64({ alg: "none" })}.${b64({ sub: U, amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 30 }] })}.sig`;
const request = new Request("https://roamie.tw/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${jwt}` } });

// 任務單 #R4-1：mock 自我檢查（不計入 PASS 數，失敗即中止腳本）— 證明 gt 真的篩選，且 mock 的執行順序是
// 篩選 → order → limit／range；keyset 逐頁讀完不漏不重。gt 若是 no-op 或 limit 先於篩選，這裡會丟錯。
// 本腳本的 admin 綁全域 db／ops：暫存表用完即刪，ops 還原為自我檢查前的長度。
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
  const opsBefore = ops.length;
  try {
    await gtMockSelfCheck(admin, db);
    say("SELFCHECK gt mock：篩選→order→limit／range、keyset 逐頁 OK（不計入 PASS 數）");
  } catch (e) {
    say("FAIL SELFCHECK gt mock\n     " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n     "));
    process.exit(1);
  }
  ops.length = opsBefore;
}

let failed = 0;
try {
  const result = await acct.deleteAuthenticatedAccount({ request, runtimeEnv: ENV, body: { requestId: REQ_ID } });
  assert.deepEqual(result, { completed: true });
  assert.ok(ops.includes("auth:deleteUser"), ops.join("\n"));
  const t4 = db.saved_trips.find((t) => t.id === "T4-late-shared");
  assert.equal(t4?.user_id, MEM, "late-shared trip survives with the member as owner");
  assert.equal(
    t4.custom_cover_image_url === null || !t4.custom_cover_image_url.includes(`/${U}/`),
    true,
    "cover no longer points into the deleted user's prefix",
  );
  say("PASS E1 storage_complete 後才變成共享的行程：續跑仍能完成刪帳號");
} catch (e) {
  failed = 1;
  say(
    "FAIL E1 storage_complete 後才變成共享的行程：續跑仍能完成刪帳號\n     " +
      String(e?.message ?? e).split("\n").slice(0, 6).join("\n     ") +
      "\n     last_error_code=" + db.account_deletion_requests[0].last_error_code +
      "\n     ops=" + ops.filter((o) => /rpc|storage|auth/.test(o)).join(", "),
  );
}
if (NET_BLOCKED.length) {
  failed = 1;
  say("FAIL NET unmocked network: " + NET_BLOCKED.join(", "));
} else say("PASS NET 沒有任何網路請求");
console.info = quietInfo;
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed);
