// verify-trip-workspace-rls.mjs — Trip Workspace V1 第 3 階段：staging RLS／RPC 權限實測（任務單 #TW3-T）
//
// 以 staging 三個測試帳號（擁有者／成員／陌生人）＋ anon 實際呼叫 Supabase，驗證：
//   S1  陌生人無法 INSERT trip_members（含 is_owner=true）
//   S2  擁有者 create_trip_invite：43 字元 base64url；再呼叫回傳同一個開啟中的連結
//   S3  陌生人／成員／anon 呼叫 create_trip_invite 被拒
//   S4  preview（anon 與陌生人）只回傳 7 個顯示欄位；不含 trip_id／email／token；無效 token → invalid
//   S5  get_trip_invite_by_token：anon、陌生人、擁有者皆被拒
//   S6  client 無法 INSERT is_link=true／revoked_at；無法改 token；舊 App 一次性邀請 INSERT／UPDATE status 仍可
//   S7  陌生人／成員讀不到 trip_invites（token）與 saved_trips
//   S8  成員加入：回傳 trip_id；重複加入不重複新增（trip_members 恰 1 列）；長期連結不因使用失效
//   S9  關閉連結：preview revoked；陌生人加入 → invite_revoked；已是成員再加入仍回 trip_id；
//       重開 → 新 token、舊 token 仍 revoked（不復活）
//   S10 被移除成員：讀 saved_trips 得 0 列且無錯誤（前端 leaveRemovedTrip 的前提）
//   S11 滿 20 人 → trip_full：需要額外 17 個帳號（ROAMIE_STAGING_EXTRA_ACCOUNTS，JSON 陣列
//       [{"email":"…","password":"…"}]）；不足時明確標示「未驗證」並以 exit 2 結束
//   S12 每行程每天最多 20 條新連結 → invite_rate_limited（只對本測試自建的行程）
//   ── 第 4 階段記帳（任務單 #TW4-T1；需先套用 20261102120000_trip_expenses.sql）──
//   S13 成員經 RPC 新增可讀；陌生人／anon 讀不到 trip_expenses／payers／shares，也不能呼叫 RPC
//   S14 成員／擁有者無法直接 INSERT（及 UPDATE／DELETE）三張記帳表
//   S15 payers／shares 加總不符、equal／percent 分攤不符、bp≠10000、非成員 → RPC 被拒且未寫入
//   S16 version 衝突（舊版本更新、未帶版本更新、舊版本刪除）→ expense_conflict
//   S17 同一 client_request_id 重送 → 同一 expense_id、replayed=true、不重複新增
//   （記帳資料隨測試行程 CASCADE 刪除）
//   ── 第 5 階段我的行李（任務單 #TW5-T；需先套用 20261103110000_trip_packing.sql，未套用時標示「未驗證」）──
//   S18 同一人兩個 client＋擁有者同時 ensure_my_packing_categories → 各自恰 6 個、不重複
//   S19 擁有者讀不到成員清單、成員讀不到擁有者清單；陌生人／anon 讀不到、不能 ensure／寫入
//   S20 無法以他人 user_id 寫入；user_id／default_key 不可改；icon 白名單；改他人分類 0 列
//   S21 跨行程 category、他人 category → packing_category_not_found（另建第二個測試行程，結束時刪除）
//   S22 client 無法 DELETE 兩表
//   S23 version 自動 +1、checked_at 伺服器設定、舊版本更新 0 列；軟刪除分類連帶物品、復原一起恢復
//   S24 刪除的預設分類 ensure 後不復活；ensure other 只復原「其他」且舊物品維持刪除
//   S25 被移除成員讀不到自己的清單、ensure 被拒；重新加入後恢復原清單
//   所有錯誤碼不得為 40 類 SQLSTATE。行李資料隨測試行程 CASCADE 刪除。
//
// 環境變數（不得寫死、不得連 production；URL 必須包含 piuuauapiodwhbkhcjdw）：
//   ROAMIE_STAGING_SUPABASE_URL、ROAMIE_STAGING_SUPABASE_ANON_KEY、
//   ROAMIE_STAGING_OWNER_EMAIL/PASSWORD、ROAMIE_STAGING_MEMBER_EMAIL/PASSWORD、ROAMIE_STAGING_STRANGER_EMAIL/PASSWORD
//   （選用）ROAMIE_STAGING_EXTRA_ACCOUNTS
// 缺少變數 → 印出「未驗證：缺少 staging 憑證」並 exit 1（不連線、不跳過斷言假裝通過）。
// 資料：測試自建一個 saved_trips 行程，結束時（含失敗）只刪除自己建立的這一列（CASCADE 清掉其成員與邀請）。
//
// 執行（由使用者執行）：
//   set -a; source ~/.roamie-staging-test.env; set +a; node scripts/verify-trip-workspace-rls.mjs
// 結束碼：0 全部驗證通過；1 有失敗或缺憑證／URL 不符；2 無失敗但有「未驗證」項目。

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const STAGING_REF = "piuuauapiodwhbkhcjdw";
const REQUIRED_ENV = [
  "ROAMIE_STAGING_SUPABASE_URL",
  "ROAMIE_STAGING_SUPABASE_ANON_KEY",
  "ROAMIE_STAGING_OWNER_EMAIL",
  "ROAMIE_STAGING_OWNER_PASSWORD",
  "ROAMIE_STAGING_MEMBER_EMAIL",
  "ROAMIE_STAGING_MEMBER_PASSWORD",
  "ROAMIE_STAGING_STRANGER_EMAIL",
  "ROAMIE_STAGING_STRANGER_PASSWORD",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.log("未驗證：缺少 staging 憑證");
  console.log("缺少環境變數：" + missing.join(", "));
  console.log("執行方式：set -a; source ~/.roamie-staging-test.env; set +a; node scripts/verify-trip-workspace-rls.mjs");
  process.exit(1);
}
const SUPABASE_URL = process.env.ROAMIE_STAGING_SUPABASE_URL.trim().replace(/\/+$/, "");
let parsedHost = "";
try {
  parsedHost = new URL(SUPABASE_URL).hostname;
} catch {
  parsedHost = "";
}
if (!SUPABASE_URL.includes(STAGING_REF) || parsedHost !== `${STAGING_REF}.supabase.co`) {
  console.log(`拒絕執行：ROAMIE_STAGING_SUPABASE_URL 不是 staging（必須為 https://${STAGING_REF}.supabase.co）`);
  process.exit(1);
}
const ANON_KEY = process.env.ROAMIE_STAGING_SUPABASE_ANON_KEY.trim();
let extraAccounts = [];
if (process.env.ROAMIE_STAGING_EXTRA_ACCOUNTS?.trim()) {
  try {
    extraAccounts = JSON.parse(process.env.ROAMIE_STAGING_EXTRA_ACCOUNTS);
    assert.ok(Array.isArray(extraAccounts) && extraAccounts.every((a) => a?.email && a?.password));
  } catch {
    console.log("拒絕執行：ROAMIE_STAGING_EXTRA_ACCOUNTS 必須是 [{\"email\":…,\"password\":…}] JSON 陣列");
    process.exit(1);
  }
}

const { createClient } = await import("@supabase/supabase-js");
const newClient = () =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const failures = [];
const unverified = [];
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 12).join("\n     "));
  }
}
function markUnverified(name, why) {
  unverified.push(name);
  console.log("未驗證 " + name + "：" + why);
}
/** 只印出錯誤碼／訊息，不印 token 或密鑰 */
const errText = (e) => (e ? `${e.code ?? ""} ${e.message ?? ""}`.trim() : "(no error)");
function expectError(result, pattern, label) {
  assert.ok(result.error, `${label}：預期被拒，實際成功 data=${JSON.stringify(result.data)?.slice(0, 120)}`);
  if (pattern) assert.match(errText(result.error), pattern, `${label}：錯誤不符 → ${errText(result.error)}`);
}
const DENIED = /42501|permission denied|row-level security|not_trip_owner|PGRST202|PGRST301|Could not find the function/i;

async function signIn(label, email, password) {
  const c = newClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data?.user) throw new Error(`${label} 登入失敗：${errText(error)}`);
  return { c, id: data.user.id, email, label };
}

let owner;
let member;
let stranger;
const anon = newClient();
let tripId = null;
let token = null;
const KEYS = ["cover_url", "date_end", "date_start", "inviter_display_name", "member_count", "state", "trip_title"];

try {
  owner = await signIn("owner", process.env.ROAMIE_STAGING_OWNER_EMAIL, process.env.ROAMIE_STAGING_OWNER_PASSWORD);
  member = await signIn("member", process.env.ROAMIE_STAGING_MEMBER_EMAIL, process.env.ROAMIE_STAGING_MEMBER_PASSWORD);
  stranger = await signIn("stranger", process.env.ROAMIE_STAGING_STRANGER_EMAIL, process.env.ROAMIE_STAGING_STRANGER_PASSWORD);
  assert.equal(new Set([owner.id, member.id, stranger.id]).size, 3, "三個測試帳號必須是不同使用者");

  // ── 自建行程 ──
  const title = `RLS verify ${new Date().toISOString()}`;
  const ins = await owner.c
    .from("saved_trips")
    .insert({
      user_id: owner.id,
      title,
      payload: { verifyTripWorkspaceRls: true, tripSettings: { tripStartDate: "2026-12-01", tripEndDate: "2026-12-03" } },
    })
    .select("id")
    .single();
  if (ins.error || !ins.data?.id) throw new Error("建立測試行程失敗：" + errText(ins.error));
  tripId = ins.data.id;
  console.log("INFO 已建立測試行程（結束時刪除）");

  await check("S1 陌生人無法 INSERT trip_members（is_owner=false／true）", async () => {
    for (const isOwner of [false, true]) {
      const r = await stranger.c.from("trip_members").insert({ trip_id: tripId, user_id: stranger.id, is_owner: isOwner, status: "accepted" });
      expectError(r, /42501|permission denied|row-level security/i, `stranger insert is_owner=${isOwner}`);
    }
    const rows = await owner.c.from("trip_members").select("user_id").eq("trip_id", tripId);
    assert.ifError(rows.error);
    assert.deepEqual(rows.data.map((r) => r.user_id), [owner.id], "成員只應有擁有者");
  });

  await check("S2 擁有者 create_trip_invite：43 字元 base64url，再呼叫回傳同一個", async () => {
    const a = await owner.c.rpc("create_trip_invite", { p_trip_id: tripId });
    assert.ifError(a.error);
    const rowA = Array.isArray(a.data) ? a.data[0] : a.data;
    assert.match(rowA?.invite_token ?? "", /^[A-Za-z0-9_-]{43}$/);
    token = rowA.invite_token;
    const b = await owner.c.rpc("create_trip_invite", { p_trip_id: tripId });
    assert.ifError(b.error);
    const rowB = Array.isArray(b.data) ? b.data[0] : b.data;
    assert.equal(rowB.invite_token, token, "已有開啟中的連結應回傳同一個");
    assert.equal(rowB.invite_id, rowA.invite_id);
    const links = await owner.c.from("trip_invites").select("id, is_link, revoked_at, expires_at, status").eq("trip_id", tripId);
    assert.ifError(links.error);
    assert.equal(links.data.length, 1);
    assert.equal(links.data[0].is_link, true);
    assert.equal(links.data[0].expires_at, null);
    assert.equal(links.data[0].revoked_at, null);
  });
  assert.ok(token, "沒有邀請 token，後續無法驗證");

  await check("S3 陌生人／anon 呼叫 create_trip_invite 被拒", async () => {
    expectError(await stranger.c.rpc("create_trip_invite", { p_trip_id: tripId }), /not_trip_owner/, "stranger create");
    expectError(await anon.rpc("create_trip_invite", { p_trip_id: tripId }), DENIED, "anon create");
    expectError(await stranger.c.rpc("set_trip_invite_link_enabled", { p_trip_id: tripId, p_enabled: false }), /not_trip_owner/, "stranger disable");
    expectError(await anon.rpc("set_trip_invite_link_enabled", { p_trip_id: tripId, p_enabled: false }), DENIED, "anon disable");
  });

  await check("S4 preview（anon／陌生人）只回傳 7 個顯示欄位、不洩漏 trip_id／email／token；無效 token → invalid", async () => {
    for (const [who, c] of [["anon", anon], ["stranger", stranger.c]]) {
      const r = await c.rpc("get_trip_invite_preview", { invite_token: token });
      assert.ifError(r.error);
      assert.ok(Array.isArray(r.data) && r.data.length === 1, `${who} 應回傳 1 列`);
      const row = r.data[0];
      assert.deepEqual(Object.keys(row).sort(), KEYS, `${who} 欄位`);
      assert.equal(row.state, "valid");
      assert.equal(row.trip_title, title);
      assert.equal(row.member_count, 1);
      const json = JSON.stringify(row);
      for (const secret of [tripId, owner.id, owner.email, member.email, stranger.email, token]) {
        assert.ok(!json.includes(secret), `${who} preview 洩漏敏感值`);
      }
      assert.doesNotMatch(json, /@[A-Za-z0-9-]+\./, `${who} preview 含 email 樣式字串`);
    }
    const bad = await anon.rpc("get_trip_invite_preview", { invite_token: "x".repeat(43) });
    assert.ifError(bad.error);
    assert.equal(bad.data[0].state, "invalid");
    assert.equal(bad.data[0].trip_title, null);
  });

  await check("S5 get_trip_invite_by_token：anon、陌生人、擁有者皆被拒", async () => {
    for (const [who, c] of [["anon", anon], ["stranger", stranger.c], ["owner", owner.c]]) {
      expectError(await c.rpc("get_trip_invite_by_token", { invite_token: token }), DENIED, `${who} get_trip_invite_by_token`);
    }
  });

  await check("S6 client 無法 INSERT is_link=true／revoked_at、無法改 token；舊 App 一次性邀請 INSERT／UPDATE status 仍可", async () => {
    const t = () => "legacy" + Math.random().toString(36).slice(2) + Date.now().toString(36) + "abcdefghij";
    expectError(
      await owner.c.from("trip_invites").insert({ trip_id: tripId, inviter_id: owner.id, token: t(), status: "pending", is_link: true }),
      /invite_link_server_only|42501/,
      "owner insert is_link=true",
    );
    expectError(
      await owner.c.from("trip_invites").insert({ trip_id: tripId, inviter_id: owner.id, token: t(), status: "pending", revoked_at: new Date().toISOString() }),
      /invite_link_server_only|42501/,
      "owner insert revoked_at",
    );
    expectError(
      await stranger.c.from("trip_invites").insert({ trip_id: tripId, inviter_id: stranger.id, token: t(), status: "pending" }),
      /42501|row-level security/,
      "stranger insert legacy invite",
    );
    // 舊 App：直接 INSERT 一次性邀請（舊 createTripInvite 的寫法）＋ select().single()
    const legacyToken = t();
    const legacy = await owner.c
      .from("trip_invites")
      .insert({ trip_id: tripId, inviter_id: owner.id, token: legacyToken, status: "pending", expires_at: new Date(Date.now() + 7 * 864e5).toISOString() })
      .select("id, trip_id, inviter_id, token, status, expires_at, created_at")
      .single();
    assert.ifError(legacy.error);
    const upd = await owner.c.from("trip_invites").update({ status: "cancelled" }).eq("id", legacy.data.id).select("status").single();
    assert.ifError(upd.error);
    assert.equal(upd.data.status, "cancelled");
    // 改 token／is_link 被擋
    const linkRow = await owner.c.from("trip_invites").select("id").eq("trip_id", tripId).eq("is_link", true).is("revoked_at", null).single();
    assert.ifError(linkRow.error);
    expectError(await owner.c.from("trip_invites").update({ token: t() }).eq("id", linkRow.data.id), /invite_field_immutable|42501/, "owner update link token");
    expectError(await owner.c.from("trip_invites").update({ is_link: true }).eq("id", legacy.data.id), /invite_field_immutable|42501/, "owner flip is_link");
    const still = await anon.rpc("get_trip_invite_preview", { invite_token: token });
    assert.equal(still.data[0].state, "valid", "長期連結 token 不應被改動");
  });

  await check("S7 陌生人／成員（尚未加入）讀不到 trip_invites 與 saved_trips", async () => {
    for (const u of [stranger, member]) {
      const inv = await u.c.from("trip_invites").select("token").eq("trip_id", tripId);
      assert.ifError(inv.error);
      assert.equal(inv.data.length, 0, `${u.label} 讀到邀請 token`);
      const trip = await u.c.from("saved_trips").select("id").eq("id", tripId);
      assert.ifError(trip.error);
      assert.equal(trip.data.length, 0, `${u.label} 讀到行程`);
    }
  });

  await check("S8 成員加入回傳 trip_id；重複加入不重複新增；長期連結不因使用失效；成員讀不到 token", async () => {
    const a = await member.c.rpc("accept_trip_invite", { invite_token: token });
    assert.ifError(a.error);
    assert.equal(a.data, tripId);
    const b = await member.c.rpc("accept_trip_invite", { invite_token: token });
    assert.ifError(b.error);
    assert.equal(b.data, tripId);
    const rows = await owner.c.from("trip_members").select("user_id, status, is_owner").eq("trip_id", tripId).eq("user_id", member.id);
    assert.ifError(rows.error);
    assert.equal(rows.data.length, 1, "重複加入新增了多列");
    assert.equal(rows.data[0].status, "accepted");
    assert.equal(rows.data[0].is_owner, false);
    const link = await owner.c.from("trip_invites").select("status, invitee_user_id, revoked_at").eq("token", token).single();
    assert.ifError(link.error);
    assert.equal(link.data.status, "pending", "長期連結被消耗");
    assert.equal(link.data.invitee_user_id, null);
    const p = await anon.rpc("get_trip_invite_preview", { invite_token: token });
    assert.equal(p.data[0].state, "valid");
    assert.equal(p.data[0].member_count, 2);
    const inv = await member.c.from("trip_invites").select("token").eq("trip_id", tripId);
    assert.ifError(inv.error);
    assert.equal(inv.data.length, 0, "非擁有者成員讀到邀請 token");
    expectError(await member.c.rpc("create_trip_invite", { p_trip_id: tripId }), /not_trip_owner/, "member create");
  });

  await check("S9 關閉連結：revoked、陌生人無法加入；已是成員仍回 trip_id；重開為新 token、舊的不復活", async () => {
    const off = await owner.c.rpc("set_trip_invite_link_enabled", { p_trip_id: tripId, p_enabled: false });
    assert.ifError(off.error);
    const offRow = Array.isArray(off.data) ? off.data[0] : off.data;
    assert.equal(offRow.enabled, false);
    assert.equal((await anon.rpc("get_trip_invite_preview", { invite_token: token })).data[0].state, "revoked");
    expectError(await stranger.c.rpc("accept_trip_invite", { invite_token: token }), /invite_revoked/, "stranger accept revoked");
    const sm = await owner.c.from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", stranger.id);
    assert.equal(sm.data.length, 0, "陌生人經由已關閉連結加入了");
    const again = await member.c.rpc("accept_trip_invite", { invite_token: token });
    assert.ifError(again.error);
    assert.equal(again.data, tripId);
    const on = await owner.c.rpc("set_trip_invite_link_enabled", { p_trip_id: tripId, p_enabled: true });
    assert.ifError(on.error);
    const onRow = Array.isArray(on.data) ? on.data[0] : on.data;
    assert.equal(onRow.enabled, true);
    assert.match(onRow.invite_token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(onRow.invite_token, token, "重開必須是新 token");
    assert.equal((await anon.rpc("get_trip_invite_preview", { invite_token: token })).data[0].state, "revoked", "舊 token 復活");
    expectError(await stranger.c.rpc("accept_trip_invite", { invite_token: token }), /invite_revoked/, "stranger accept old token");
    const c = await owner.c.rpc("create_trip_invite", { p_trip_id: tripId });
    assert.equal((Array.isArray(c.data) ? c.data[0] : c.data).invite_token, onRow.invite_token, "create 應回傳重開後的同一連結");
    token = onRow.invite_token;
  });

  await check("S10 被移除成員：讀 saved_trips 得 0 列且無錯誤；可經開啟中連結重新加入", async () => {
    const del = await owner.c.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", member.id);
    assert.ifError(del.error);
    const r = await member.c.from("saved_trips").select("id").eq("id", tripId).maybeSingle();
    assert.ifError(r.error);
    assert.equal(r.data, null);
    const m = await member.c.from("trip_members").select("status").eq("trip_id", tripId).eq("user_id", member.id).maybeSingle();
    assert.ifError(m.error);
    assert.equal(m.data, null);
    const back = await member.c.rpc("accept_trip_invite", { invite_token: token });
    assert.ifError(back.error);
    assert.equal(back.data, tripId);
    console.log("     （資訊）被移除的成員可用仍開啟的長期連結重新加入；若產品要求移除後不可回來，需另外設計");
  });

  // ── 第 4 階段：記帳（任務單 #TW4-T1）。此時 owner 與 member 皆為 accepted 成員。──
  const sortedIds = () => [owner.id, member.id].sort();
  const expensePayload = (over = {}) => {
    const [u1, u2] = sortedIds();
    return {
      client_request_id: randomUUID(),
      kind: "expense",
      title: "RLS verify 晚餐",
      amount_minor: 1001,
      currency: "TWD",
      currency_exponent: 2,
      spent_on: "2026-12-01",
      split_method: "equal",
      note: null,
      payers: [{ user_id: owner.id, amount_minor: 1001 }],
      // equal：依 user_id 排序，第一位拿零頭 → 501／500
      shares: [
        { user_id: u1, share_minor: 501, percent_bp: null },
        { user_id: u2, share_minor: 500, percent_bp: null },
      ],
      ...over,
    };
  };
  const rpcRow = (r) => (Array.isArray(r.data) ? r.data[0] : r.data);
  let expenseId = null;
  let expenseVersion = null;

  await check("S13 記帳：成員可經 RPC 新增並讀取；陌生人讀不到 trip_expenses／payers／shares、也無法呼叫 RPC", async () => {
    const created = await member.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: expensePayload(), p_expected_version: null });
    assert.ifError(created.error);
    const row = rpcRow(created);
    assert.ok(row?.expense_id, "未回傳 expense_id");
    assert.equal(row.expense_version, 1);
    assert.equal(row.replayed, false);
    expenseId = row.expense_id;
    expenseVersion = row.expense_version;
    for (const u of [owner, member]) {
      const e = await u.c.from("trip_expenses").select("id, amount_minor, currency_exponent").eq("trip_id", tripId);
      assert.ifError(e.error);
      assert.equal(e.data.length, 1, `${u.label} 應讀到 1 筆記帳`);
      assert.equal(Number(e.data[0].amount_minor), 1001);
      const p = await u.c.from("trip_expense_payers").select("user_id").eq("expense_id", expenseId);
      assert.ifError(p.error);
      assert.equal(p.data.length, 1);
      const s = await u.c.from("trip_expense_shares").select("user_id, share_minor").eq("expense_id", expenseId);
      assert.ifError(s.error);
      assert.equal(s.data.length, 2);
    }
    for (const [who, c] of [["stranger", stranger.c], ["anon", anon]]) {
      for (const [table, col] of [["trip_expenses", "id"], ["trip_expense_payers", "expense_id"], ["trip_expense_shares", "expense_id"]]) {
        const q = table === "trip_expenses" ? c.from(table).select("id").eq("trip_id", tripId) : c.from(table).select(col).eq("expense_id", expenseId);
        const r = await q;
        if (r.error) assert.match(errText(r.error), /42501|permission denied/i, `${who} ${table}`);
        else assert.equal(r.data.length, 0, `${who} 讀到 ${table}`);
      }
    }
    expectError(
      await stranger.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: expensePayload(), p_expected_version: null }),
      /not_trip_member|42501/,
      "stranger upsert",
    );
    expectError(await stranger.c.rpc("delete_trip_expense", { p_expense_id: expenseId, p_expected_version: expenseVersion }), /expense_not_found/, "stranger delete");
    expectError(await anon.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: expensePayload(), p_expected_version: null }), DENIED, "anon upsert");
  });

  await check("S14 記帳：成員／擁有者無法直接 INSERT／UPDATE／DELETE 三張表", async () => {
    assert.ok(expenseId, "S13 未建立記帳");
    const DIRECT = /42501|permission denied|row-level security/i;
    for (const u of [member, owner]) {
      expectError(
        await u.c.from("trip_expenses").insert({
          trip_id: tripId, kind: "expense", title: "direct", amount_minor: 100, currency: "TWD", currency_exponent: 2,
          spent_on: "2026-12-01", split_method: "exact", created_by: u.id, updated_by: u.id, client_request_id: randomUUID(),
        }),
        DIRECT,
        `${u.label} insert trip_expenses`,
      );
      expectError(await u.c.from("trip_expense_payers").insert({ expense_id: expenseId, user_id: stranger.id, amount_minor: 1 }), DIRECT, `${u.label} insert payers`);
      expectError(await u.c.from("trip_expense_shares").insert({ expense_id: expenseId, user_id: stranger.id, share_minor: 1 }), DIRECT, `${u.label} insert shares`);
      expectError(await u.c.from("trip_expenses").update({ amount_minor: 1 }).eq("id", expenseId), DIRECT, `${u.label} update trip_expenses`);
      expectError(await u.c.from("trip_expense_shares").delete().eq("expense_id", expenseId), DIRECT, `${u.label} delete shares`);
    }
    const s = await owner.c.from("trip_expense_shares").select("user_id").eq("expense_id", expenseId);
    assert.ifError(s.error);
    assert.equal(s.data.length, 2, "分攤列被直接寫入或刪除");
  });

  await check("S15 記帳：加總不符／分攤不符的 RPC 被拒", async () => {
    const [u1, u2] = sortedIds();
    const bad = [
      ["payers 總和≠金額", { payers: [{ user_id: owner.id, amount_minor: 1000 }] }, /expense_payers_mismatch/],
      ["shares 總和≠金額", { shares: [{ user_id: u1, share_minor: 501 }, { user_id: u2, share_minor: 499 }] }, /expense_shares_mismatch/],
      ["equal 零頭給錯人", { shares: [{ user_id: u1, share_minor: 500 }, { user_id: u2, share_minor: 501 }] }, /expense_split_mismatch/],
      [
        "percent bp 總和≠10000",
        { split_method: "percent", shares: [{ user_id: u1, share_minor: 501, percent_bp: 5000 }, { user_id: u2, share_minor: 500, percent_bp: 4999 }] },
        /expense_percent_mismatch/,
      ],
      [
        "percent 零頭分配錯誤",
        { split_method: "percent", shares: [{ user_id: u1, share_minor: 500, percent_bp: 5000 }, { user_id: u2, share_minor: 501, percent_bp: 5000 }] },
        /expense_split_mismatch/,
      ],
      ["分攤對象非成員", { split_method: "exact", shares: [{ user_id: owner.id, share_minor: 1000 }, { user_id: stranger.id, share_minor: 1 }] }, /expense_participant_not_member/],
    ];
    for (const [label, over, pattern] of bad) {
      expectError(await member.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: expensePayload(over), p_expected_version: null }), pattern, label);
    }
    const all = await owner.c.from("trip_expenses").select("id").eq("trip_id", tripId);
    assert.ifError(all.error);
    assert.equal(all.data.length, 1, "被拒的 RPC 仍寫入了資料");
  });

  await check("S16 記帳：version 衝突被拒（更新與刪除）", async () => {
    assert.ok(expenseId, "S13 未建立記帳");
    const upd = await owner.c.rpc("upsert_trip_expense", {
      p_trip_id: tripId,
      p_expense: expensePayload({ id: expenseId, title: "RLS verify 改名" }),
      p_expected_version: expenseVersion,
    });
    assert.ifError(upd.error);
    assert.equal(rpcRow(upd).expense_version, expenseVersion + 1);
    const stale = expenseVersion;
    expenseVersion = rpcRow(upd).expense_version;
    expectError(
      await member.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: expensePayload({ id: expenseId, title: "舊版本" }), p_expected_version: stale }),
      /expense_conflict|40001/,
      "stale update",
    );
    expectError(
      await member.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: expensePayload({ id: expenseId }), p_expected_version: null }),
      /expense_conflict|40001/,
      "update without version",
    );
    expectError(await member.c.rpc("delete_trip_expense", { p_expense_id: expenseId, p_expected_version: stale }), /expense_conflict|40001/, "stale delete");
    const row = await owner.c.from("trip_expenses").select("title, version, deleted_at").eq("id", expenseId).single();
    assert.ifError(row.error);
    assert.equal(row.data.title, "RLS verify 改名");
    assert.equal(row.data.version, expenseVersion);
    assert.equal(row.data.deleted_at, null);
  });

  await check("S17 記帳：client_request_id 重送冪等（同一筆、replayed=true、不重複新增）", async () => {
    const payload = expensePayload({ title: "RLS verify 重送" });
    const first = await member.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: payload, p_expected_version: null });
    assert.ifError(first.error);
    const a = rpcRow(first);
    assert.equal(a.replayed, false);
    const second = await member.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: payload, p_expected_version: null });
    assert.ifError(second.error);
    const b = rpcRow(second);
    assert.equal(b.expense_id, a.expense_id, "重送產生了不同的 expense_id");
    assert.equal(b.replayed, true);
    // 別的成員以同一 client_request_id 重送亦不新增
    const third = await owner.c.rpc("upsert_trip_expense", { p_trip_id: tripId, p_expense: payload, p_expected_version: null });
    assert.ifError(third.error);
    assert.equal(rpcRow(third).expense_id, a.expense_id);
    const rows = await owner.c.from("trip_expenses").select("id").eq("trip_id", tripId).eq("client_request_id", payload.client_request_id);
    assert.ifError(rows.error);
    assert.equal(rows.data.length, 1, "重送新增了多筆");
    const shares = await owner.c.from("trip_expense_shares").select("user_id").eq("expense_id", a.expense_id);
    assert.ifError(shares.error);
    assert.equal(shares.data.length, 2, "重送重複寫入分攤列");
  });

  // ── 第 5 階段：我的行李（任務單 #TW5-T；需先套用 20261103110000_trip_packing.sql）──
  // 此時 owner 與 member 皆為 accepted 成員；token 為開啟中的長期連結。資料隨測試行程 CASCADE 刪除。
  {
    const probe = await owner.c.from("packing_categories").select("id").limit(1);
    if (probe.error && /PGRST205|42P01|does not exist|Could not find the table/i.test(errText(probe.error))) {
      for (const n of ["S18", "S19", "S20", "S21", "S22", "S23", "S24", "S25"]) {
        markUnverified(n + " 我的行李", "staging 尚未套用 20261103110000_trip_packing.sql（" + errText(probe.error) + "）");
      }
    } else {
      await runPackingChecks();
    }
  }

  async function runPackingChecks() {
    const NOT_40 = (e) => assert.ok(!String(e?.code ?? "").startsWith("40"), "錯誤碼不得為 40 類 SQLSTATE：" + errText(e));
    const DIRECT_DENIED = /42501|permission denied|row-level security/i;
    const rows = (r) => (Array.isArray(r.data) ? r.data : r.data ? [r.data] : []);
    let member2 = null;
    let trip2 = null;
    try {
      member2 = await signIn("member#2", process.env.ROAMIE_STAGING_MEMBER_EMAIL, process.env.ROAMIE_STAGING_MEMBER_PASSWORD);

      await check("S18 行李：同一人兩個 client＋擁有者同時 ensure → 各自恰 6 個預設分類、不重複建立", async () => {
        const [a, b, c] = await Promise.all([
          member.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId }),
          member2.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId }),
          owner.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId }),
        ]);
        for (const r of [a, b, c]) assert.ifError(r.error);
        for (const r of [a, b]) {
          assert.equal(rows(r).length, 6, "ensure 回傳數量");
          assert.ok(rows(r).every((x) => x.user_id === member.id), "成員 ensure 回傳了別人的分類");
        }
        assert.ok(rows(c).every((x) => x.user_id === owner.id), "擁有者 ensure 回傳了別人的分類");
        for (const u of [member, owner]) {
          const all = await u.c.from("packing_categories").select("id, user_id, default_key, name, deleted_at").eq("trip_id", tripId);
          assert.ifError(all.error);
          assert.equal(all.data.length, 6, `${u.label} 分類列數（含已刪除）應為 6，實際 ${all.data.length}`);
          assert.deepEqual(all.data.map((x) => x.default_key).sort(), ["clothing", "documents", "electronics", "medicine", "other", "toiletries"]);
          assert.ok(all.data.every((x) => x.name === null && x.deleted_at === null), "預設分類 name 應為 NULL");
        }
        const again = await member.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId });
        assert.ifError(again.error);
        assert.deepEqual(rows(again).map((x) => x.id).sort(), rows(a).map((x) => x.id).sort(), "再次 ensure 回傳不同的分類");
      });

      await check("S19 行李：擁有者讀不到成員清單、成員讀不到擁有者清單；陌生人／anon 讀不到也不能 ensure", async () => {
        const mineItem = await member.c.from("packing_categories").select("id").eq("trip_id", tripId).eq("default_key", "other").single();
        assert.ifError(mineItem.error);
        const ins = await member.c
          .from("packing_items")
          .insert({ trip_id: tripId, category_id: mineItem.data.id, name: "RLS verify 護照", client_request_id: randomUUID() })
          .select("id, user_id, version, is_checked, checked_at")
          .single();
        assert.ifError(ins.error);
        assert.equal(ins.data.user_id, member.id);
        assert.equal(ins.data.version, 1);
        for (const [viewer, other] of [[owner, member], [member, owner]]) {
          for (const table of ["packing_categories", "packing_items"]) {
            const r = await viewer.c.from(table).select("user_id").eq("trip_id", tripId);
            assert.ifError(r.error);
            assert.ok(r.data.every((x) => x.user_id === viewer.id), `${viewer.label} 讀到 ${other.label} 的 ${table}`);
          }
          const direct = await viewer.c.from("packing_items").select("id").eq("trip_id", tripId).eq("user_id", other.id);
          assert.ifError(direct.error);
          assert.equal(direct.data.length, 0, `${viewer.label} 以 user_id 篩選仍讀到 ${other.label} 的物品`);
        }
        for (const [who, c] of [["stranger", stranger.c], ["anon", anon]]) {
          for (const table of ["packing_categories", "packing_items"]) {
            const r = await c.from(table).select("id").eq("trip_id", tripId);
            if (r.error) assert.match(errText(r.error), DIRECT_DENIED, `${who} ${table}`);
            else assert.equal(r.data.length, 0, `${who} 讀到 ${table}`);
          }
        }
        const se = await stranger.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId });
        expectError(se, /not_trip_member/, "stranger ensure");
        NOT_40(se.error);
        expectError(await anon.rpc("ensure_my_packing_categories", { p_trip_id: tripId }), DENIED, "anon ensure");
        expectError(await stranger.c.rpc("ensure_my_packing_other_category", { p_trip_id: tripId }), /not_trip_member/, "stranger ensure other");
        const sneak = await stranger.c.from("packing_categories").insert({ trip_id: tripId, name: "RLS verify sneak" });
        expectError(sneak, DIRECT_DENIED, "stranger insert category");
      });

      await check("S20 行李：無法以他人 user_id 寫入（INSERT 被改寫為本人或被拒、UPDATE user_id／trip_id 被拒）", async () => {
        const r = await member.c.from("packing_categories").insert({ trip_id: tripId, user_id: owner.id, name: "RLS verify 偽造" }).select("id, user_id").maybeSingle();
        if (r.error) {
          NOT_40(r.error);
        } else {
          assert.equal(r.data.user_id, member.id, "以他人 user_id 寫入成功且未改寫為本人");
        }
        const ownerView = await owner.c.from("packing_categories").select("id").eq("trip_id", tripId).eq("name", "RLS verify 偽造");
        assert.ifError(ownerView.error);
        assert.equal(ownerView.data.length, 0, "成員寫入的分類出現在擁有者清單");
        const mine = await member.c.from("packing_items").select("id").eq("trip_id", tripId).limit(1).single();
        assert.ifError(mine.error);
        const u1 = await member.c.from("packing_items").update({ user_id: owner.id }).eq("id", mine.data.id);
        expectError(u1, /packing_immutable_field|42501|row-level security/, "update user_id");
        NOT_40(u1.error);
        const u2 = await member.c.from("packing_categories").update({ default_key: "clothing" }).eq("trip_id", tripId).eq("default_key", "other");
        expectError(u2, /packing_immutable_field|23505/, "update default_key");
        const u3 = await member.c.from("packing_categories").update({ icon_key: "NotAnIcon" }).eq("trip_id", tripId).eq("default_key", "other");
        expectError(u3, /packing_invalid_icon|packing_categories_icon_key_check/, "invalid icon");
        NOT_40(u3.error);
        // 修改他人資料：RLS 讓 0 列受影響（不報錯也不改到）
        const ownerCat = await owner.c.from("packing_categories").select("id, name").eq("trip_id", tripId).eq("default_key", "other").single();
        assert.ifError(ownerCat.error);
        const hijack = await member.c.from("packing_categories").update({ name: "RLS verify 竄改" }).eq("id", ownerCat.data.id).select("id");
        if (!hijack.error) assert.equal(hijack.data.length, 0, "成員改到擁有者的分類");
        const after = await owner.c.from("packing_categories").select("name").eq("id", ownerCat.data.id).single();
        assert.equal(after.data.name, ownerCat.data.name, "擁有者分類被竄改");
      });

      await check("S21 行李：跨行程／他人 category 被拒（packing_category_not_found）", async () => {
        const t2 = await owner.c
          .from("saved_trips")
          .insert({ user_id: owner.id, title: `RLS verify packing ${new Date().toISOString()}`, payload: { verifyTripWorkspaceRls: true } })
          .select("id")
          .single();
        assert.ifError(t2.error);
        trip2 = t2.data.id;
        const cats2 = await owner.c.rpc("ensure_my_packing_categories", { p_trip_id: trip2 });
        assert.ifError(cats2.error);
        const foreignCat = rows(cats2)[0].id;
        const x = await owner.c.from("packing_items").insert({ trip_id: tripId, category_id: foreignCat, name: "RLS verify 跨行程", client_request_id: randomUUID() });
        expectError(x, /packing_category_not_found/, "cross-trip category");
        NOT_40(x.error);
        const ownerCat = await owner.c.from("packing_categories").select("id").eq("trip_id", tripId).eq("default_key", "other").single();
        assert.ifError(ownerCat.error);
        const y = await member.c.from("packing_items").insert({ trip_id: tripId, category_id: ownerCat.data.id, name: "RLS verify 他人分類", client_request_id: randomUUID() });
        expectError(y, /packing_category_not_found/, "other user's category");
        const mine = await member.c.from("packing_items").select("id").eq("trip_id", tripId).limit(1).single();
        const z = await member.c.from("packing_items").update({ category_id: ownerCat.data.id }).eq("id", mine.data.id);
        expectError(z, /packing_category_not_found/, "move item to other user's category");
      });

      await check("S22 行李：client 無法 DELETE（兩表），資料仍在", async () => {
        const item = await member.c.from("packing_items").select("id").eq("trip_id", tripId).limit(1).single();
        assert.ifError(item.error);
        const cat = await member.c.from("packing_categories").select("id").eq("trip_id", tripId).eq("default_key", "documents").single();
        assert.ifError(cat.error);
        const d1 = await member.c.from("packing_items").delete().eq("id", item.data.id).select("id");
        const d2 = await member.c.from("packing_categories").delete().eq("id", cat.data.id).select("id");
        for (const [label, d] of [["items", d1], ["categories", d2]]) {
          if (d.error) assert.match(errText(d.error), DIRECT_DENIED, label);
          else assert.equal(d.data.length, 0, `client DELETE packing_${label} 成功`);
        }
        const still = await member.c.from("packing_items").select("id").eq("id", item.data.id);
        assert.equal(still.data.length, 1, "物品被硬刪除");
        const still2 = await member.c.from("packing_categories").select("id").eq("id", cat.data.id);
        assert.equal(still2.data.length, 1, "分類被硬刪除");
      });

      await check("S23 行李：version 自動 +1、checked_at 自動；軟刪除分類連帶物品，復原一起恢復", async () => {
        const cat = await member.c.from("packing_categories").select("id").eq("trip_id", tripId).eq("default_key", "other").single();
        const item = await member.c.from("packing_items").select("id, version").eq("trip_id", tripId).eq("category_id", cat.data.id).is("deleted_at", null).limit(1).single();
        assert.ifError(item.error);
        const u = await member.c
          .from("packing_items")
          .update({ is_checked: true, version: 999, checked_at: "2000-01-01T00:00:00Z" })
          .eq("id", item.data.id)
          .eq("version", item.data.version)
          .select("version, checked_at, is_checked")
          .single();
        assert.ifError(u.error);
        assert.equal(u.data.version, item.data.version + 1, "version 未自動 +1（或被 client 改寫）");
        assert.ok(u.data.checked_at && !u.data.checked_at.startsWith("2000"), "checked_at 應由伺服器設定");
        const stale = await member.c.from("packing_items").update({ is_checked: false }).eq("id", item.data.id).eq("version", item.data.version).select("id");
        assert.ifError(stale.error);
        assert.equal(stale.data.length, 0, "舊版本更新仍成功");
        const del = await member.c.from("packing_categories").update({ deleted_at: new Date().toISOString() }).eq("id", cat.data.id).select("deleted_at").single();
        assert.ifError(del.error);
        const gone = await member.c.from("packing_items").select("deleted_at").eq("id", item.data.id).single();
        assert.ok(gone.data.deleted_at, "軟刪除分類未連帶物品");
        const restore = await member.c.from("packing_categories").update({ deleted_at: null }).eq("id", cat.data.id).select("deleted_at").single();
        assert.ifError(restore.error);
        const back = await member.c.from("packing_items").select("deleted_at").eq("id", item.data.id).single();
        assert.equal(back.data.deleted_at, null, "復原分類未恢復物品");
      });

      await check("S24 行李：刪除的預設分類 ensure 後不復活；ensure_my_packing_other_category 只復原「其他」", async () => {
        const del = await member.c
          .from("packing_categories")
          .update({ deleted_at: new Date().toISOString() })
          .eq("trip_id", tripId)
          .in("default_key", ["clothing", "other"])
          .select("id");
        assert.ifError(del.error);
        assert.equal(del.data.length, 2);
        const e = await member.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId });
        assert.ifError(e.error);
        const keys = rows(e).map((x) => x.default_key);
        assert.ok(!keys.includes("clothing") && !keys.includes("other"), "刪除的預設分類被 ensure 復活：" + keys.join(","));
        const all = await member.c.from("packing_categories").select("default_key").eq("trip_id", tripId).not("default_key", "is", null);
        assert.equal(all.data.length, 6, "ensure 新建了重複的預設分類");
        const o = await member.c.rpc("ensure_my_packing_other_category", { p_trip_id: tripId });
        assert.ifError(o.error);
        const other = rows(o)[0];
        assert.equal(other.default_key, "other");
        assert.equal(other.deleted_at, null);
        const o2 = await member.c.rpc("ensure_my_packing_other_category", { p_trip_id: tripId });
        assert.equal(rows(o2)[0].id, other.id, "第二次 ensure other 回傳不同列");
        const clothing = await member.c.from("packing_categories").select("deleted_at").eq("trip_id", tripId).eq("default_key", "clothing").single();
        assert.ok(clothing.data.deleted_at, "ensure other 連帶復原了其他預設分類");
        const oldItems = await member.c.from("packing_items").select("deleted_at").eq("category_id", other.id);
        assert.ok(oldItems.data.every((x) => x.deleted_at), "ensure other 復原了舊物品（應維持刪除）");
      });

      await check("S25 行李：被移除的成員讀不到自己的清單（ensure 被拒），重新加入後恢復原清單", async () => {
        const before = await member.c.from("packing_categories").select("id").eq("trip_id", tripId);
        assert.ifError(before.error);
        assert.ok(before.data.length > 0);
        const rm = await owner.c.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", member.id);
        assert.ifError(rm.error);
        for (const table of ["packing_categories", "packing_items"]) {
          const r = await member.c.from(table).select("id").eq("trip_id", tripId);
          if (r.error) assert.match(errText(r.error), DIRECT_DENIED);
          else assert.equal(r.data.length, 0, `被移除後仍讀到 ${table}`);
        }
        const e = await member.c.rpc("ensure_my_packing_categories", { p_trip_id: tripId });
        expectError(e, /not_trip_member/, "removed member ensure");
        NOT_40(e.error);
        const w = await member.c.from("packing_categories").insert({ trip_id: tripId, name: "RLS verify removed" });
        expectError(w, DIRECT_DENIED, "removed member insert");
        const ownerSees = await owner.c.from("packing_categories").select("user_id").eq("trip_id", tripId);
        assert.ok(ownerSees.data.every((x) => x.user_id === owner.id), "成員被移除後擁有者讀到其清單");
        const back = await member.c.rpc("accept_trip_invite", { invite_token: token });
        assert.ifError(back.error);
        const after = await member.c.from("packing_categories").select("id").eq("trip_id", tripId);
        assert.ifError(after.error);
        assert.deepEqual(after.data.map((x) => x.id).sort(), before.data.map((x) => x.id).sort(), "重新加入後清單未恢復");
      });

      // 未加入 supabase_realtime：pg_publication_tables 無法經 PostgREST 讀取，由 verify-trip-packing-stage5 的 migration 靜態檢查保證。
    } finally {
      if (trip2) {
        const d = await owner.c.from("saved_trips").delete().eq("id", trip2).eq("user_id", owner.id).select("id");
        if (d.error || d.data?.length !== 1) {
          failures.push("cleanup trip2");
          console.log("FAIL cleanup：第二個測試行程刪除失敗（標題以「RLS verify packing」開頭）→ " + errText(d.error));
        }
      }
      try {
        await member2?.c.auth.signOut({ scope: "local" });
      } catch {}
    }
  }

  // S11 trip_full
  {
    const need = 20 - 2; // 目前 accepted：擁有者＋成員
    if (extraAccounts.length < need) {
      markUnverified(
        "S11 滿 20 人回 trip_full",
        `需要 ${need} 個額外帳號（湊滿 20 人後再由陌生人加入），目前 ROAMIE_STAGING_EXTRA_ACCOUNTS=${extraAccounts.length}；` +
          "client 無法直接 INSERT trip_members（S1），故無法以其他方式在 staging 湊滿；靜態檢查見 verify-trip-invite-stage3 N8d",
      );
    } else {
      await check("S11 滿 20 人回 trip_full（陌生人加入被拒；已是成員仍可）", async () => {
        for (const acc of extraAccounts.slice(0, need)) {
          const u = await signIn("extra", acc.email, acc.password);
          assert.ok(![owner.id, member.id, stranger.id].includes(u.id), "額外帳號不得與主要帳號重複");
          const r = await u.c.rpc("accept_trip_invite", { invite_token: token });
          assert.ifError(r.error);
          await u.c.auth.signOut();
        }
        const p = await anon.rpc("get_trip_invite_preview", { invite_token: token });
        assert.equal(p.data[0].member_count, 20);
        assert.equal(p.data[0].state, "full");
        expectError(await stranger.c.rpc("accept_trip_invite", { invite_token: token }), /trip_full/, "stranger accept full trip");
        const again = await member.c.rpc("accept_trip_invite", { invite_token: token });
        assert.ifError(again.error);
        assert.equal(again.data, tripId);
      });
    }
  }

  await check("S12 每行程每天最多 20 條新連結 → invite_rate_limited（只對自建行程）", async () => {
    let created = 2; // S2 一條、S9 重開一條
    let limited = null;
    for (let i = 0; i < 25 && !limited; i++) {
      const off = await owner.c.rpc("set_trip_invite_link_enabled", { p_trip_id: tripId, p_enabled: false });
      assert.ifError(off.error);
      const on = await owner.c.rpc("set_trip_invite_link_enabled", { p_trip_id: tripId, p_enabled: true });
      if (on.error) limited = on.error;
      else created += 1;
    }
    assert.ok(limited, "建立 25 次以上仍未被限流");
    assert.match(errText(limited), /invite_rate_limited/);
    assert.equal(created, 20, "限流門檻應為 20，實際在第 " + (created + 1) + " 條被擋");
  });
} catch (e) {
  failures.push("setup");
  console.log("FAIL setup／未預期錯誤：" + String(e?.message ?? e).split("\n")[0]);
} finally {
  if (tripId && owner) {
    const del = await owner.c.from("saved_trips").delete().eq("id", tripId).eq("user_id", owner.id).select("id");
    if (del.error || del.data?.length !== 1) {
      failures.push("cleanup");
      console.log("FAIL cleanup：測試行程刪除失敗，請手動刪除 saved_trips 中標題以「RLS verify」開頭、payload.verifyTripWorkspaceRls=true 的列 → " + errText(del.error));
    } else {
      console.log("INFO 已刪除測試行程（CASCADE 清除其成員與邀請）");
    }
  }
  for (const u of [owner, member, stranger]) {
    try {
      await u?.c.auth.signOut();
    } catch {}
  }
}

console.log(`\n總結：${passed} PASS / ${failures.length} FAIL / ${unverified.length} 未驗證`);
if (failures.length) console.log("FAIL：" + failures.join("；"));
if (unverified.length) console.log("未驗證：" + unverified.join("；"));
process.exit(failures.length ? 1 : unverified.length ? 2 : 0);
