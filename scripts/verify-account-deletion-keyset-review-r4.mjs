// verify-account-deletion-keyset-review-r4.mjs — 任務單 #R4-3（刪帳號封面第 4 輪，獨立複審）
//
// 補現有腳本未涵蓋的 keyset 分頁情境（saved_trips 封面查詢、trip_members 成員資格查詢）：
//   K1 max-rows（300）< 頁大小（1000），saved_trips：所有列都要讀到（攻擊者列全部清成 null、成員行程 S 搬移）
//   K2 max-rows（300）< 頁大小，trip_members：排在最後的 S 成員資格仍要讀到（S 走成員路徑）
//   K3 trip_members 讀取途中前面的成員資格被刪 → S 不漏讀
//   K4 saved_trips 讀取途中前面的攻擊者列被刪（max-rows 300）→ S 不漏讀
//   K5 空結果：兩個查詢都只打 1 次（第一頁即空）、刪帳號完成
//   K6 trip_id 為 null／同一 trip_id 重複的成員資格 → 不出錯，S 仍走成員路徑
//   K7 saved_trips 第 2 頁錯誤 → account_collaboration_cover_lookup_failed、log 名稱不變、未清 storage／未 deleteUser；續跑完成
//   K8 trip_members 第 2 頁錯誤 → account_collaboration_membership_lookup_failed、未呼叫 transfer RPC；續跑完成
//   K9 列數剛好等於一頁（max-rows = 頁大小 = 1000）→ 不因整頁就停或少讀，再讀到空頁才結束
//
// 判別方式：S 的封面指向 <V>/avatar.jpg（非本行程路徑）。成員路徑 → 清成 null；
// 若 S 被漏讀成「非成員」→ 完全不動；若 saved_trips 漏讀 S → 也不動。兩者都判 FAIL。
//
// 只 mock 外部邊界（@supabase/supabase-js、apple／revenuecat helper）；真實模組以 esbuild 打包。
// 全域 fetch／http(s)／net／tls／WebSocket 攔截，任何非 mock 請求 → NET 檢查 FAIL。不讀 .env。
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-account-deletion-keyset-review-r4.mjs

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

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-acct-keyset-r4-"));
const outFile = path.join(tmp, "acct.mjs");
const mocks = {
  "@supabase/supabase-js": `export const createClient = (...a) => globalThis.__m.createClient(...a); export class SupabaseClient {}`,
  "./apple-revoke.server": `export const revokeAppleAuthorization = async () => {};`,
  "./revenuecat-customer-delete.server": `export const deleteRevenueCatCustomerV2 = async () => {};`,
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
const INFO_LOGS = [];
console.info = (tag, payload) => INFO_LOGS.push({ tag, payload });
console.warn = () => {};
console.error = () => {};
const acct = await import(pathToFileURL(outFile).href);

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = {
  SUPABASE_URL: SUPA,
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-placeholder",
  ACCOUNT_DELETION_ALLOWED_SUPABASE_REF: "abcdefghijklmnopqrst",
};
const U = "11111111-1111-4111-8111-111111111111"; // 被刪者 V
const MEM = "22222222-2222-4222-8222-222222222222";
const ATK = "33333333-3333-4333-8333-333333333333";
const REQ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_SIZE = 1000; // DELETION_PAGE_SIZE
let MAX_ROWS = 1000;
const FIELDS = ["custom_cover_image_url", "cover_image_url", "cover_image"];
const pub = (p) => `${SUPA}/storage/v1/object/public/profile-media/${p}`;
const uuid = (prefix, i) => `${prefix}-0000-4000-8000-${String(i).padStart(12, "0")}`;
const reCache = new Map();
const likeMatch = (v, pat) => {
  if (typeof v !== "string") return false;
  let re = reCache.get(pat);
  if (!re) {
    re = new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    reCache.set(pat, re);
  }
  return re.test(v);
};
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
    .map(([name, id]) => ({ name, id }));
}

/**
 * hooks.afterSelect(table, pageIndex, db)：select 回傳後執行（模擬並行寫入）。
 * hooks.selectError(table, pageIndex)：回傳 error 物件時，該頁 select 失敗。
 */
function makeWorld(db, hooks = {}) {
  const ops = [];
  const sub = { postgrest: 0, rpc: 0, list: 0, exists: 0, copy: 0, remove: 0, auth: 0, deleteUser: 0 };
  const selectPages = {};
  const selectSizes = {};
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
        gt: (c, v) => (q.filters.push((r) => r[c] != null && r[c] > v), api),
        gte: (c, v) => (q.filters.push((r) => r[c] != null && r[c] >= v), api),
        in: (c, vs) => {
          assert.ok(Array.isArray(vs), "in() expects an array");
          const set = new Set(vs);
          q.filters.unshift((r) => set.has(r[c]));
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
                const pageIndex = (selectPages[table] = (selectPages[table] ?? 0) + 1) - 1;
                const err = hooks.selectError?.(table, pageIndex);
                if (err) {
                  (selectSizes[table] ??= []).push("ERR");
                  return { data: null, error: err };
                }
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
                // PostgREST max-rows：伺服器端硬上限，可能小於 limit。
                out = out.slice(0, MAX_ROWS);
                const data = q.single ? (out[0] ?? null) : out.map((r) => ({ ...r }));
                if (!q.single) (selectSizes[table] ??= []).push(out.length);
                hooks.afterSelect?.(table, pageIndex, db);
                return { data, error: null };
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
            return { data: storageList(db.files, prefix, opts), error: null };
          },
          async exists(p) {
            sub.exists += 1;
            return { data: db.files.has(p), error: null };
          },
          async copy(from, to) {
            sub.copy += 1;
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
          sub.deleteUser += 1;
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
  return { ops, sub, selectPages, selectSizes };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mkRequest = () => {
  const jwt = `${b64({ alg: "none" })}.${b64({ sub: U, amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 30 }] })}.sig`;
  return new Request("https://roamie.tw/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
};
const runDeletion = () => acct.deleteAuthenticatedAccount({ request: mkRequest(), runtimeEnv: ENV, body: { requestId: REQ_ID } });
const runExpectFail = async () => {
  try {
    await runDeletion();
  } catch (e) {
    return e;
  }
  throw new Error("deletion was expected to fail but completed");
};
const baseDb = () => ({
  account_deletion_requests: [],
  account_deletion_receipts: [],
  trip_invites: [],
  analytics_events: [],
  saved_trips: [],
  trip_members: [],
  files: new Set(),
});
function attackerRows(n, idPrefix = "a0000000") {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const id = uuid(idPrefix, i);
    const row = { id, user_id: ATK, custom_cover_image_url: null, cover_image_url: null, cover_image: null };
    row[FIELDS[i % 3]] = pub(`${U}/trips/${id}/x.jpg`);
    rows.push(row);
  }
  return rows;
}

// S：MEM 擁有、V 是成員；saved_trips 與 trip_members 的 id 都排在最後。
// 封面指向 V 頭像：成員路徑 → 清成 null；被當成非成員或漏讀 → 不動。
const S = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const S_AVATAR_URL = pub(`${U}/avatar.jpg`);
const S_MEMBERSHIP_ID = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const sTrip = () => ({ id: S, user_id: MEM, custom_cover_image_url: S_AVATAR_URL, cover_image_url: null, cover_image: null });
const sMemberships = () => [
  { id: "ffffffff-ffff-4fff-8fff-fffffffffff1", trip_id: S, user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-01-01" },
  { id: S_MEMBERSHIP_ID, trip_id: S, user_id: U, is_owner: false, status: "accepted", created_at: "2026-02-01" },
];
// V 在 n 個（不存在於 saved_trips 的）行程的成員資格，id 排在 S 之前。
function fillerMemberships(n, idPrefix = "b0000000") {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ id: uuid(idPrefix, i), trip_id: uuid("c0000000", i), user_id: U, is_owner: false, status: "accepted", created_at: "2026-03-01" });
  }
  return out;
}
function sProblems(db) {
  const s = db.saved_trips.find((t) => t.id === S);
  if (!s) return ["S row missing"];
  if (s.custom_cover_image_url !== null)
    return [`S cover not cleared via member path (got ${String(s.custom_cover_image_url).replace(SUPA, "")}) → S 被漏讀或被當成非成員`];
  return [];
}
const lastErrorCode = (db) => db.account_deletion_requests[0]?.last_error_code ?? null;

const failures = [];
let passCount = 0;
async function check(name, fn) {
  MAX_ROWS = 1000;
  INFO_LOGS.length = 0;
  try {
    await fn();
    passCount += 1;
    say("PASS " + name);
  } catch (e) {
    failures.push(name);
    say("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 14).join("\n     "));
  }
}

await check("K1 max-rows=300 < 頁大小 1000，saved_trips 1500 筆攻擊者列＋S → 每一列都被讀到（攻擊者列全清 null、S 走成員路徑）", async () => {
  MAX_ROWS = 300;
  const db = baseDb();
  db.saved_trips = [...attackerRows(1500), sTrip()];
  db.trip_members = sMemberships();
  db.files = new Set([`${U}/avatar.jpg`]);
  const { selectSizes } = makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  assert.deepEqual(sProblems(db), []);
  const untouched = db.saved_trips.filter((t) => t.user_id === ATK && FIELDS.some((f) => t[f] != null));
  assert.equal(untouched.length, 0, `${untouched.length} 筆攻擊者列未被讀到（仍指向 V prefix）`);
  const coverPages = selectSizes.saved_trips;
  say(`     observe: saved_trips pages=${JSON.stringify(coverPages)}`);
  assert.deepEqual(coverPages.slice(0, 7), [300, 300, 300, 300, 300, 1, 0]);
});

await check("K2 max-rows=300 < 頁大小，trip_members 1200 筆成員資格排在 S 之前 → S 仍被讀成成員", async () => {
  MAX_ROWS = 300;
  const db = baseDb();
  db.saved_trips = [sTrip()];
  db.trip_members = [...fillerMemberships(1200), ...sMemberships()];
  db.files = new Set([`${U}/avatar.jpg`]);
  const { selectSizes } = makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  say(`     observe: trip_members pages=${JSON.stringify(selectSizes.trip_members)}`);
  assert.deepEqual(selectSizes.trip_members, [300, 300, 300, 300, 1, 0]);
  assert.deepEqual(sProblems(db), []);
});

await check("K3 trip_members 第 1 頁讀完後，排在前面的 250 筆成員資格被刪（max-rows=300）→ S 不漏讀", async () => {
  MAX_ROWS = 300;
  const db = baseDb();
  db.saved_trips = [sTrip()];
  db.trip_members = [...fillerMemberships(700), ...sMemberships()];
  db.files = new Set([`${U}/avatar.jpg`]);
  let dropped = 0;
  makeWorld(db, {
    afterSelect(table, pageIndex, d) {
      if (table !== "trip_members" || pageIndex !== 0) return;
      const drop = new Set(d.trip_members.filter((m) => m.id.startsWith("b0000000")).slice(0, 250).map((m) => m.id));
      dropped = drop.size;
      d.trip_members = d.trip_members.filter((m) => !drop.has(m.id));
    },
  });
  const result = await runDeletion();
  assert.equal(dropped, 250);
  assert.equal(result?.completed, true);
  assert.deepEqual(sProblems(db), []);
});

await check("K4 saved_trips 第 1 頁讀完後，攻擊者刪掉排在前面的 250 筆（max-rows=300）→ S 不漏讀、剩餘攻擊者列全部處理", async () => {
  MAX_ROWS = 300;
  const db = baseDb();
  db.saved_trips = [...attackerRows(900), sTrip()];
  db.trip_members = sMemberships();
  db.files = new Set([`${U}/avatar.jpg`]);
  let dropped = 0;
  makeWorld(db, {
    afterSelect(table, pageIndex, d) {
      if (table !== "saved_trips" || pageIndex !== 0) return;
      const drop = new Set(d.saved_trips.filter((t) => t.user_id === ATK).slice(0, 250).map((t) => t.id));
      dropped = drop.size;
      d.saved_trips = d.saved_trips.filter((t) => !drop.has(t.id));
    },
  });
  const result = await runDeletion();
  assert.equal(dropped, 250);
  assert.equal(result?.completed, true);
  assert.deepEqual(sProblems(db), []);
  const untouched = db.saved_trips.filter((t) => t.user_id === ATK && FIELDS.some((f) => t[f] != null));
  assert.equal(untouched.length, 0, `${untouched.length} 筆仍存在的攻擊者列被漏讀`);
});

await check("K5 空結果：saved_trips／trip_members 各只查 1 次（第一頁即空），刪帳號完成", async () => {
  const db = baseDb();
  const { selectSizes } = makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  assert.deepEqual(selectSizes.trip_members, [0]);
  assert.deepEqual(selectSizes.saved_trips, [0]);
});

await check("K6 trip_id 為 null、同一 trip_id 重複的成員資格 → 不出錯，S 仍走成員路徑", async () => {
  MAX_ROWS = 2;
  const db = baseDb();
  db.saved_trips = [sTrip()];
  db.trip_members = [
    { id: "00000000-0000-4000-8000-000000000001", trip_id: null, user_id: U, is_owner: false, status: "accepted", created_at: "2026-03-01" },
    { id: "00000000-0000-4000-8000-000000000002", trip_id: S, user_id: U, is_owner: false, status: "pending", created_at: "2026-03-01" },
    { id: "00000000-0000-4000-8000-000000000003", trip_id: null, user_id: U, is_owner: false, status: "accepted", created_at: "2026-03-01" },
    ...sMemberships(),
  ];
  db.files = new Set([`${U}/avatar.jpg`]);
  const { selectSizes } = makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  say(`     observe: trip_members pages=${JSON.stringify(selectSizes.trip_members)}`);
  // V 自己的 4 筆（2 筆 null、1 筆 pending 重複 S、1 筆 accepted S）；MEM 那筆被 eq(user_id) 濾掉。
  assert.deepEqual(selectSizes.trip_members, [2, 2, 0]);
  assert.deepEqual(sProblems(db), []);
});

await check("K7 saved_trips 第 2 頁錯誤 → cover_lookup_failed、log 名稱不變、未清 storage／未 deleteUser；續跑完成", async () => {
  MAX_ROWS = 300;
  const db = baseDb();
  db.saved_trips = [...attackerRows(600), sTrip()];
  db.trip_members = sMemberships();
  db.files = new Set([`${U}/avatar.jpg`]);
  const w1 = makeWorld(db, {
    selectError: (t, i) => (t === "saved_trips" && i === 1 ? { code: "57014", message: "canceling statement due to statement timeout" } : null),
  });
  const err = await runExpectFail();
  assert.equal(err?.message, "account_collaboration_cover_lookup_failed");
  assert.equal(lastErrorCode(db), "account_collaboration_cover_lookup_failed");
  const log = INFO_LOGS.find((l) => l.tag === "ACCOUNT_DELETION_COLLABORATION_CLEANUP");
  assert.equal(log?.payload?.operation, "lookup_surviving_trip_covers");
  assert.equal(log?.payload?.table, "saved_trips");
  assert.equal(w1.sub.remove, 0, "storage 不得被清");
  assert.equal(w1.sub.deleteUser, 0, "不得 deleteUser");
  assert.equal(w1.sub.copy, 0);
  assert.ok(db.files.has(`${U}/avatar.jpg`));
  // 第 1 頁讀到的列不得被提前處理（先全部讀完再處理）。
  const touched = db.saved_trips.filter((t) => t.user_id === ATK && FIELDS.every((f) => t[f] == null));
  assert.equal(touched.length, 0, `讀取失敗前已改動 ${touched.length} 列`);
  makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  assert.deepEqual(sProblems(db), []);
});

await check("K8 trip_members 第 2 頁錯誤 → membership_lookup_failed、log 名稱不變、未呼叫 transfer RPC；續跑完成", async () => {
  MAX_ROWS = 300;
  const db = baseDb();
  db.saved_trips = [sTrip()];
  db.trip_members = [...fillerMemberships(450), ...sMemberships()];
  db.files = new Set([`${U}/avatar.jpg`]);
  const w1 = makeWorld(db, {
    selectError: (t, i) => (t === "trip_members" && i === 1 ? { code: "57014", message: "canceling statement due to statement timeout" } : null),
  });
  const err = await runExpectFail();
  assert.equal(err?.message, "account_collaboration_membership_lookup_failed");
  assert.equal(lastErrorCode(db), "account_collaboration_membership_lookup_failed");
  const log = INFO_LOGS.find((l) => l.tag === "ACCOUNT_DELETION_COLLABORATION_CLEANUP");
  assert.equal(log?.payload?.operation, "lookup_memberships");
  assert.equal(log?.payload?.table, "trip_members");
  assert.equal(w1.sub.rpc, 0, "不得呼叫 transfer RPC");
  assert.equal(w1.sub.remove, 0);
  assert.equal(w1.sub.deleteUser, 0);
  makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  assert.deepEqual(sProblems(db), []);
});

await check("K9 列數剛好一頁（999 攻擊者列＋S＝1000，max-rows＝頁大小）→ 再讀到空頁才結束，S 不漏", async () => {
  const db = baseDb();
  db.saved_trips = [...attackerRows(PAGE_SIZE - 1), sTrip()];
  db.trip_members = sMemberships();
  db.files = new Set([`${U}/avatar.jpg`]);
  const { selectSizes } = makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  assert.deepEqual(selectSizes.saved_trips.slice(0, 2), [1000, 0]);
  assert.deepEqual(sProblems(db), []);
});

await check("NET 全程沒有任何非 mock 的網路請求（fetch／http(s)／net／tls／WebSocket）", () => assert.deepEqual(NET_BLOCKED, []));

fs.rmSync(tmp, { recursive: true, force: true });
say(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) say("  FAILED: " + f);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
