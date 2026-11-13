// verify-account-deletion-cover-probe-review21.mjs — 任務單 #21（資安稽核 run-2 修補獨立複審）探測
//
// 針對 relocateSurvivingTripCovers／trip_members 分頁補兩個 run2 腳本沒有覆蓋的情境：
//   P1 讀取期間資料變動：saved_trips 以 order("id")＋range(offset) 分頁「先全部讀完再處理」。
//      攻擊者在第 1 頁讀完後刪掉自己排在前面的列 → offset 往後跳，排在後面的成員行程被漏讀，
//      封面未搬移，之後 storage 清除 → 存活行程封面壞掉。（keyset 分頁 .gt("id", lastId) 不會漏）
//   P1b 對照組：讀取期間沒有變動 → 成員行程照常搬移（證明 P1 的失敗只來自漂移）。
//   P2 subrequest 成長：攻擊者列數 N1 → N2（10 倍）時，總 subrequest 不應隨列數線性成長
//      （任務單需求：「subrequest 要有上限，不能隨列數線性成長」）；並推算超過 Cloudflare 1000 的列數。
//
// 只 mock 外部邊界（@supabase/supabase-js、apple／revenuecat helper）；真實模組以 esbuild 打包。
// 全域 fetch／http(s)／net／tls／WebSocket 攔截，非 mock 請求 → NET 檢查 FAIL。不讀 .env。
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-account-deletion-cover-probe-review21.mjs

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-acct-probe21-"));
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
const U = "11111111-1111-4111-8111-111111111111"; // V
const MEM = "22222222-2222-4222-8222-222222222222";
const ATK = "33333333-3333-4333-8333-333333333333";
const REQ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAX_ROWS = 1000;
const SUBREQUEST_BUDGET = 1000;
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

/** hooks.afterSelect(table, pageIndex, db): runs after a select page is returned (concurrent writers). */
function makeWorld(db, hooks = {}) {
  const ops = [];
  const sub = { postgrest: 0, rpc: 0, list: 0, exists: 0, copy: 0, remove: 0, auth: 0, tripUpdateCalls: 0 };
  const selectPages = {};
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
        // gt／gte：讓 keyset 分頁的修法也能在此 mock 下正確執行。
        gt: (c, v) => (q.filters.push((r) => r[c] > v), api),
        gte: (c, v) => (q.filters.push((r) => r[c] >= v), api),
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
                out = out.slice(0, MAX_ROWS);
                const data = q.single ? (out[0] ?? null) : out.map((r) => ({ ...r }));
                const pageIndex = (selectPages[table] = (selectPages[table] ?? 0) + 1) - 1;
                hooks.afterSelect?.(table, pageIndex, db);
                return { data, error: null };
              }
              if (q.op === "insert" || q.op === "upsert") rows.push({ ...q.payload });
              if (q.op === "update") {
                if (table === "saved_trips") sub.tripUpdateCalls += 1;
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
            return { data: storageList(db.files, prefix, opts), error: null };
          },
          async exists(p) {
            sub.exists += 1;
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

// S：MEM 擁有、V 是成員的共享行程；id 排在所有攻擊者列之後。
const S = "ffffffff-ffff-4fff-8fff-ffffffffffff";
function memberTripWorld(nAttacker) {
  const db = baseDb();
  db.saved_trips = [
    ...attackerRows(nAttacker),
    { id: S, user_id: MEM, custom_cover_image_url: pub(`${U}/trips/${S}/s.jpg`), cover_image_url: null, cover_image: null },
  ];
  db.trip_members = [
    { id: "s1", trip_id: S, user_id: MEM, is_owner: true, status: "accepted", created_at: "2026-01-01" },
    { id: "s2", trip_id: S, user_id: U, is_owner: false, status: "accepted", created_at: "2026-02-01" },
  ];
  db.files = new Set([`${U}/trips/${S}/s.jpg`, `${U}/avatar.jpg`]);
  return db;
}
function memberTripProblems(db) {
  const s = db.saved_trips.find((t) => t.id === S);
  const out = [];
  if (s?.custom_cover_image_url !== pub(`${MEM}/trips/${S}/s.jpg`))
    out.push(`member trip S cover not relocated (got ${String(s?.custom_cover_image_url).replace(SUPA, "")})`);
  if (!db.files.has(`${MEM}/trips/${S}/s.jpg`)) out.push("member trip S file not copied to owner prefix (file purged with V's prefix)");
  return out;
}

await check("P1b 對照組：1500 筆攻擊者列＋成員行程 S，讀取期間無變動 → S 封面照常搬移", async () => {
  const db = memberTripWorld(1500);
  makeWorld(db);
  const result = await runDeletion();
  assert.equal(result?.completed, true);
  assert.deepEqual(memberTripProblems(db), []);
});

await check("P1 讀取期間資料變動：saved_trips 第 1 頁讀完後攻擊者刪掉自己前 600 筆 → 成員行程 S 不得被漏讀（封面要搬移）", async () => {
  const db = memberTripWorld(1500);
  let deleted = 0;
  makeWorld(db, {
    afterSelect(table, pageIndex, d) {
      // 攻擊者（RLS 允許刪自己的行程）在 V 讀完第 1 頁的瞬間刪掉排在最前面的 600 筆。
      if (table !== "saved_trips" || pageIndex !== 0) return;
      const drop = new Set(d.saved_trips.filter((t) => t.user_id === ATK).slice(0, 600).map((t) => t.id));
      deleted = drop.size;
      d.saved_trips = d.saved_trips.filter((t) => !drop.has(t.id));
    },
  });
  const result = await runDeletion();
  assert.equal(deleted, 600);
  assert.equal(result?.completed, true);
  const problems = memberTripProblems(db);
  assert.deepEqual(problems, [], "offset 分頁在讀取期間被刪列時往後跳，S 被漏讀:\n" + problems.join("\n"));
});

await check(`P2 subrequest 不隨攻擊者列數線性成長（N 放大 10 倍，總數成長 < 2 倍）；且 ≤ ${SUBREQUEST_BUDGET}`, async () => {
  const measure = async (n) => {
    const db = baseDb();
    db.saved_trips = attackerRows(n);
    db.files = new Set([`${U}/avatar.jpg`]);
    const { sub } = makeWorld(db);
    const result = await runDeletion();
    assert.equal(result?.completed, true, "deletion did not complete at N=" + n);
    return { total: totalSub(sub), updates: sub.tripUpdateCalls, postgrest: sub.postgrest };
  };
  const n1 = 3000;
  const n2 = 30000;
  const a = await measure(n1);
  const b = await measure(n2);
  const perRow = (b.total - a.total) / (n2 - n1);
  const fixed = a.total - perRow * n1;
  const breakEven = Math.ceil((SUBREQUEST_BUDGET - fixed) / perRow);
  say(
    `     observe: N=${n1} → total=${a.total}（saved_trips UPDATE ${a.updates}, postgrest ${a.postgrest}）；` +
      `N=${n2} → total=${b.total}（UPDATE ${b.updates}, postgrest ${b.postgrest}）；` +
      `每列約 ${perRow.toFixed(4)} 次 → 約 N≈${breakEven} 列時超過 ${SUBREQUEST_BUDGET}`,
  );
  assert.ok(b.total <= SUBREQUEST_BUDGET, `N=${n2} total ${b.total} > ${SUBREQUEST_BUDGET}`);
  assert.ok(
    b.total < a.total * 2,
    `subrequest 隨列數線性成長：N ${n1}→${n2} 時 ${a.total}→${b.total}（約 N≈${breakEven} 列超過 ${SUBREQUEST_BUDGET}）`,
  );
});

await check("NET 全程沒有任何網路請求（fetch／http(s)／net／tls／WebSocket）", () => assert.deepEqual(NET_BLOCKED, []));

fs.rmSync(tmp, { recursive: true, force: true });
say(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) say("  FAILED: " + f);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
