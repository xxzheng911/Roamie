// verify-trip-packing-stage5.mjs — Trip Workspace V1 第 5 階段「我的行李」獨立審查（任務單 #TW5-T）
//
// Part P（Node 純邏輯，直接 import packing-model.ts）：進度（不乘 quantity）、預設分類名稱、icon 白名單、
//   移動目標預設規則、排序變更、數量／名稱驗證、錯誤碼解析
// Part M（migration 20261103110000_trip_packing.sql 靜態檢查＋SQL 規則 JS 重寫版情境）：
//   RLS 只有本人條件、無 DELETE grant、觸發器規則、ensure 不復活、錯誤碼 SQLSTATE 無 40 類、未加入 realtime
// Part S（前端靜態）：路由、無 .delete()／channel／外部請求、總覽卡位置、記帳返回 key 不變、RLS 腳本可解析
// Part R（headless Chrome，React development build＋<StrictMode> 真實 render；mock supabase＝依 SQL 規則的假後端）：
//   R1 進入頁面／StrictMode 只讀一次／畫面元素  R2 勾選樂觀更新、回滾、防重送、版本衝突重讀
//   R3 行內連續新增（Enter、輸入法組字、client_request_id 重試沿用）  R4 物品編輯 Sheet（衝突重讀、刪除＋復原）
//   R5 刪除分類（空分類／移到其他分類／連同物品刪除；送出順序；6 秒復原）  R6 全刪後新增重建「其他」
//   R7 編輯分類（改名、圖示、排序）  R8 回前景 30 秒節流  R9 總覽卡  R10 返回（history.back／replace）
//   R11 TripDetailScreen 返回總覽還原捲動（行李標記；記帳標記行為不變）  R12 四語系  R13 無 delete／channel／外部請求
//
// 不讀 .env、不連網（瀏覽器只連 127.0.0.1 fixture server）。執行：node scripts/verify-trip-packing-stage5.mjs

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

const M = await import("../src/components/trip/packing/packing-model.ts");

// ───────────────────────── Part P：純邏輯 ─────────────────────────
const DEFAULTS_ZH = { clothing: "衣物", toiletries: "盥洗用品", electronics: "電子用品", documents: "證件", medicine: "藥品", other: "其他" };
await check("P1 進度以物品件數計（不乘 quantity）；百分比四捨五入；沒有物品為 0；只計入仍存在分類的物品", () => {
  const items = [
    { id: "a", category_id: "c1", is_checked: true, quantity: 5, sort_index: 0 },
    { id: "b", category_id: "c1", is_checked: false, quantity: 2, sort_index: 1 },
    { id: "c", category_id: "c2", is_checked: true, quantity: 1, sort_index: 0 },
    { id: "d", category_id: "gone", is_checked: true, quantity: 9, sort_index: 0 },
  ];
  assert.deepEqual(M.computePackingProgress(items.slice(0, 3)), { checked: 2, total: 3 });
  assert.equal(M.packingProgressPercent({ checked: 2, total: 3 }), 67);
  assert.equal(M.packingProgressPercent({ checked: 1, total: 3 }), 33);
  assert.equal(M.packingProgressPercent({ checked: 0, total: 0 }), 0);
  const vis = M.visiblePackingItems(items, [{ id: "c1" }, { id: "c2" }]);
  assert.deepEqual(vis.map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(M.computePackingProgress(vis), { checked: 2, total: 3 });
});
await check("P2 預設分類名稱：name＝null 依 default_key 顯示語系；改名後顯示 name；空白 name 視同未改名", () => {
  assert.equal(M.packingCategoryLabel({ default_key: "clothing", name: null }, DEFAULTS_ZH), "衣物");
  assert.equal(M.packingCategoryLabel({ default_key: "other", name: null }, { ...DEFAULTS_ZH, other: "Other" }), "Other");
  assert.equal(M.packingCategoryLabel({ default_key: "clothing", name: "冬衣" }, DEFAULTS_ZH), "冬衣");
  assert.equal(M.packingCategoryLabel({ default_key: null, name: "相機" }, DEFAULTS_ZH), "相機");
  assert.equal(M.packingCategoryLabel({ default_key: "medicine", name: "  " }, DEFAULTS_ZH), "藥品");
  assert.deepEqual([...M.PACKING_DEFAULT_KEYS], ["clothing", "toiletries", "electronics", "documents", "medicine", "other"]);
});
const ICON16 = ["Shirt", "Footprints", "ShowerHead", "Sparkles", "Smartphone", "Plug", "Camera", "IdCard", "Wallet", "Pill", "HeartPulse", "Umbrella", "Sun", "Baby", "Gift", "Package"];
await check("P3 icon 白名單 16 個；白名單外 normalize 為 Package；PackingIcon 對應表與白名單一致", () => {
  assert.deepEqual([...M.PACKING_ICON_KEYS], ICON16);
  assert.equal(new Set(M.PACKING_ICON_KEYS).size, 16);
  for (const k of ICON16) assert.ok(M.isPackingIconKey(k));
  for (const bad of ["shirt", "Luggage", "", null, undefined, 3, "Package "]) {
    assert.equal(M.isPackingIconKey(bad), false, String(bad));
    assert.equal(M.normalizePackingIconKey(bad), "Package");
  }
  const src = read("src/components/trip/packing/PackingIcon.tsx");
  const map = src.match(/const ICONS[^{]*\{([^}]*)\}/)[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(map.sort(), [...ICON16].sort());
});
await check("P4 刪除分類移動目標：預設「其他」；刪除的是「其他」→ 排序第一個；沒有「其他」→ 排序第一個；沒有其他分類 → null", () => {
  const cats = [
    { id: "x", default_key: null, sort_index: 3 },
    { id: "o", default_key: "other", sort_index: 5 },
    { id: "c", default_key: "clothing", sort_index: 1 },
    { id: "t", default_key: "toiletries", sort_index: 0 },
  ];
  assert.equal(M.defaultPackingMoveTarget(cats, "c").id, "o");
  assert.equal(M.defaultPackingMoveTarget(cats, "o").id, "t", "刪除「其他」應預設排序第一個（sort_index 0），不是陣列第一個");
  assert.equal(M.defaultPackingMoveTarget(cats.filter((c) => c.id !== "o"), "x").id, "t");
  assert.equal(M.defaultPackingMoveTarget(cats, "t").id, "o");
  assert.equal(M.defaultPackingMoveTarget([{ id: "o", default_key: "other", sort_index: 0 }], "o"), null);
});
await check("P5 排序：movePackingEntry／packingSortChanges 只回傳變更列；nextPackingSortIndex", () => {
  const list = [{ id: "a", sort_index: 0 }, { id: "b", sort_index: 1 }, { id: "c", sort_index: 2 }];
  const moved = M.movePackingEntry(list, 2, 1);
  assert.deepEqual(moved.map((x) => x.id), ["a", "c", "b"]);
  assert.deepEqual(M.packingSortChanges(moved), [{ id: "c", sort_index: 1 }, { id: "b", sort_index: 2 }]);
  assert.deepEqual(M.movePackingEntry(list, 0, -1).map((x) => x.id), ["a", "b", "c"]);
  assert.equal(M.nextPackingSortIndex([]), 0);
  assert.equal(M.nextPackingSortIndex([{ sort_index: 4 }, { sort_index: 2 }]), 5);
});
await check("P6 數量 1–99 整數；名稱以 code point 計 1..max、去頭尾空白", () => {
  assert.equal(M.parsePackingQuantity("1"), 1);
  assert.equal(M.parsePackingQuantity(" 99 "), 99);
  for (const bad of ["0", "100", "1.5", "-1", "", "abc", "1e1"]) assert.equal(M.parsePackingQuantity(bad), null, bad);
  assert.ok(M.isValidPackingName("襪子", 80));
  assert.ok(!M.isValidPackingName("   ", 80));
  assert.ok(M.isValidPackingName("😀".repeat(80), 80), "emoji 應以 code point 計");
  assert.ok(!M.isValidPackingName("a".repeat(81), 80));
});
await check("P7 錯誤碼解析：伺服器碼、CHECK constraint、23505、網路、離線、未知；不依賴 SQLSTATE 類別", () => {
  const p = (t, off) => M.packingErrorCodeFromText(t, off);
  for (const c of M.PACKING_SERVER_ERROR_CODES) assert.equal(p(c), c);
  assert.equal(p("packing_category_deleted 22023"), "packing_category_deleted");
  assert.equal(p('new row violates check constraint "packing_items_quantity_check" 23514'), "packing_item_quantity_invalid");
  assert.equal(p('violates check constraint "packing_items_name_check"'), "packing_item_name_invalid");
  assert.equal(p('violates check constraint "packing_items_note_check"'), "packing_item_note_invalid");
  assert.equal(p('violates check constraint "packing_categories_name_check"'), "packing_category_name_invalid");
  assert.equal(p('violates check constraint "packing_categories_icon_key_check"'), "packing_invalid_icon");
  assert.equal(p('duplicate key value violates unique constraint "packing_items_user_client_request_key" 23505'), "packing_duplicate");
  assert.equal(p("TypeError: Failed to fetch"), "network");
  assert.equal(p("Load failed"), "network");
  assert.equal(p("something odd", true), "network");
  assert.equal(p("something odd"), "unknown");
  assert.equal(p("40001 could not serialize"), "unknown", "40001 不應被特別解讀");
  assert.equal(M.packingErrorText({ message: "packing_item_limit_reached", code: "54000" }), "packing_item_limit_reached 54000");
});

// ───────────────────────── Part M：migration ─────────────────────────
const MIG = "supabase/migrations/20261103110000_trip_packing.sql";
const sqlRaw = read(MIG);
const sql = sqlRaw.replace(/--[^\n]*/g, "");
const fnBody = (name) => {
  const m = sql.match(new RegExp("FUNCTION public\\." + name + "\\([^)]*\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;"));
  assert.ok(m, "找不到函式 " + name);
  return m[1];
};
await check("M1 RLS：兩表 ENABLE RLS；各只有一條 FOR ALL TO authenticated 政策，USING＝WITH CHECK＝本人且為成員／擁有者；其他 migration 未另加政策", () => {
  for (const t of ["packing_categories", "packing_items"]) {
    assert.match(sql, new RegExp("ALTER TABLE public\\." + t + " ENABLE ROW LEVEL SECURITY"));
    const pols = [...sql.matchAll(new RegExp("CREATE POLICY (\\w+) ON public\\." + t + "\\b([\\s\\S]*?);", "g"))];
    assert.equal(pols.length, 1, t + " 政策數 " + pols.length);
    const body = pols[0][2].replace(/\s+/g, " ");
    assert.match(body, /FOR ALL TO authenticated/);
    const m = body.match(/USING \((.*)\) WITH CHECK \((.*)\)\s*$/);
    assert.ok(m, body);
    const expected = "user_id = auth.uid() AND (public.is_trip_accepted_member(trip_id) OR public.is_trip_owner(trip_id))";
    assert.equal(m[1].trim(), expected, t + " USING");
    assert.equal(m[2].trim(), expected, t + " WITH CHECK");
  }
  for (const f of fs.readdirSync(path.join(root, "supabase/migrations"))) {
    if (f === path.basename(MIG)) continue;
    assert.doesNotMatch(read("supabase/migrations/" + f), /packing_(categories|items)/, f + " 也動到行李表");
  }
});
await check("M2 權限：REVOKE ALL FROM PUBLIC, anon, authenticated；authenticated 只有 SELECT, INSERT, UPDATE（無 DELETE、無 anon grant）", () => {
  assert.match(sql, /REVOKE ALL ON TABLE public\.packing_categories, public\.packing_items\s+FROM PUBLIC, anon, authenticated;/);
  const grants = [...sql.matchAll(/GRANT ([^;]*?) ON TABLE ([^;]*?) TO ([^;]*?);/g)];
  assert.equal(grants.length, 1, "表 grant 數");
  assert.equal(grants[0][1].trim(), "SELECT, INSERT, UPDATE");
  assert.equal(grants[0][3].trim(), "authenticated");
  assert.doesNotMatch(sql, /GRANT[^;]*\bDELETE\b/i);
  assert.doesNotMatch(sql, /GRANT[^;]*\bTO\s+anon\b/i);
  assert.doesNotMatch(sql, /GRANT ALL/i);
  for (const fn of ["ensure_my_packing_categories", "ensure_my_packing_other_category"]) {
    assert.match(sql, new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "\\(uuid\\) FROM PUBLIC, anon, authenticated;"));
    assert.match(sql, new RegExp("GRANT EXECUTE ON FUNCTION public\\." + fn + "\\(uuid\\) TO authenticated;"));
  }
  for (const fn of ["packing_categories_before_write", "packing_categories_after_soft_delete", "packing_items_before_write"]) {
    assert.match(sql, new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "\\(\\) FROM PUBLIC, anon, authenticated;"));
    assert.doesNotMatch(fnBody(fn) + sql.match(new RegExp("FUNCTION public\\." + fn + "\\(\\)[\\s\\S]*?AS \\$\\$"))[0], /SECURITY DEFINER/, fn + " 不應是 SECURITY DEFINER（需受 RLS 限制查分類）");
  }
});
await check("M3 觸發器：user_id 強制為 auth.uid()；trip_id／user_id（＋default_key／client_request_id）不可改；version 自動 +1、checked_at 自動；icon 白名單 16 個；上限 30／500 含 advisory lock", () => {
  const c = fnBody("packing_categories_before_write").replace(/\s+/g, " ");
  const i = fnBody("packing_items_before_write").replace(/\s+/g, " ");
  for (const b of [c, i]) {
    assert.match(b, /IF TG_OP = 'INSERT' THEN IF v_validate THEN NEW\.user_id := v_uid;/);
    assert.match(b, /NEW\.trip_id IS DISTINCT FROM OLD\.trip_id OR NEW\.user_id IS DISTINCT FROM OLD\.user_id/);
    assert.match(b, /current_user IN \('anon', 'authenticated'\)/, "未登入的 client 角色必須被拒，不可跳過驗證");
    assert.match(b, /pg_advisory_xact_lock/);
  }
  assert.match(c, /NEW\.default_key IS DISTINCT FROM OLD\.default_key/);
  assert.match(i, /NEW\.client_request_id IS DISTINCT FROM OLD\.client_request_id/);
  assert.match(i, /NEW\.version := 1;/);
  assert.match(i, /NEW\.version := OLD\.version \+ 1;/);
  assert.match(i, /NEW\.checked_at := CASE WHEN NEW\.is_checked THEN now\(\) ELSE NULL END;/);
  assert.match(i, /IF NEW\.is_checked AND NOT OLD\.is_checked THEN NEW\.checked_at := now\(\); ELSIF NOT NEW\.is_checked THEN NEW\.checked_at := NULL; ELSE NEW\.checked_at := OLD\.checked_at;/);
  assert.match(c, /IF v_count >= 30 THEN RAISE EXCEPTION 'packing_category_limit_reached'/);
  assert.match(i, /IF v_count >= 500 THEN RAISE EXCEPTION 'packing_item_limit_reached'/);
  assert.match(i, /IF NOT FOUND OR v_cat_trip <> NEW\.trip_id OR v_cat_user <> NEW\.user_id THEN RAISE EXCEPTION 'packing_category_not_found'/);
  assert.match(i, /IF v_cat_deleted IS NOT NULL THEN RAISE EXCEPTION 'packing_category_deleted'/);
  const lists = [...sql.matchAll(/icon_key (?:NOT )?IN \(([^)]*)\)/g)].map((m) => m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)));
  assert.equal(lists.length, 2, "icon 白名單應出現於 CHECK 與觸發器");
  for (const l of lists) assert.deepEqual(l, ICON16);
  for (const t of ["packing_categories", "packing_items"]) {
    assert.match(sql, new RegExp("CREATE TRIGGER " + t + "_before_write\\s+BEFORE INSERT OR UPDATE ON public\\." + t));
  }
  assert.match(sql, /CONSTRAINT packing_items_user_client_request_key UNIQUE \(user_id, client_request_id\)/);
  assert.match(sql, /quantity BETWEEN 1 AND 99/);
  assert.match(sql, /trip_id uuid NOT NULL REFERENCES public\.saved_trips\(id\) ON DELETE CASCADE,\s+user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
});
await check("M4 ensure：只在此人此行程「完全沒有」分類紀錄（不分是否刪除）時建立 6 個；advisory lock＋ON CONFLICT；預設分類唯一索引含已刪除列；other 復原不帶回舊物品", () => {
  const e = fnBody("ensure_my_packing_categories").replace(/\s+/g, " ");
  assert.match(e, /PERFORM pg_advisory_xact_lock[\s\S]*IF NOT EXISTS \( SELECT 1 FROM public\.packing_categories c WHERE c\.trip_id = p_trip_id AND c\.user_id = v_uid \) THEN INSERT/);
  assert.doesNotMatch(e.match(/IF NOT EXISTS \([^)]*\)/)[0], /deleted_at/, "NOT EXISTS 不可排除已刪除列（否則刪光會復活）");
  assert.match(e, /ON CONFLICT \(trip_id, user_id, default_key\) WHERE default_key IS NOT NULL DO NOTHING/);
  assert.match(e, /not_trip_member/);
  const idx = sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS packing_categories_trip_user_default_key_idx\s+ON public\.packing_categories \(trip_id, user_id, default_key\)\s+WHERE default_key IS NOT NULL;/);
  assert.ok(idx, "預設分類唯一索引必須只以 default_key IS NOT NULL 為條件");
  const o = fnBody("ensure_my_packing_other_category").replace(/\s+/g, " ");
  assert.match(o, /set_config\('roamie\.packing_skip_item_restore', 'on', true\)/);
  assert.match(o, /AND c\.default_key = 'other' FOR UPDATE/);
  for (const d of ["clothing", "toiletries", "electronics", "documents", "medicine"]) assert.doesNotMatch(o, new RegExp("'" + d + "'"), "ensure other 不得動到其他預設分類");
  const a = fnBody("packing_categories_after_soft_delete").replace(/\s+/g, " ");
  assert.match(a, /SET deleted_at = NEW\.deleted_at WHERE i\.category_id = NEW\.id AND i\.deleted_at IS NULL/);
  assert.match(a, /SET deleted_at = NULL WHERE i\.category_id = NEW\.id AND i\.deleted_at = OLD\.deleted_at/);
});
await check("M5 錯誤碼：所有 RAISE 的 SQLSTATE 皆非 40 類；伺服器碼與前端 PACKING_SERVER_ERROR_CODES 一一對應", () => {
  const raises = [...sql.matchAll(/RAISE EXCEPTION '([a-z_]+)' USING ERRCODE = '([0-9A-Z]{5})'/g)];
  assert.ok(raises.length >= 12, "RAISE 數 " + raises.length);
  for (const [, code, state] of raises) assert.ok(!state.startsWith("40"), code + " 使用 40 類 SQLSTATE " + state);
  assert.doesNotMatch(sql, /ERRCODE\s*=\s*'40/);
  assert.doesNotMatch(sql, /serialization_failure|deadlock_detected/);
  const codes = [...new Set(raises.map((m) => m[1]))].sort();
  assert.deepEqual(codes, [...M.PACKING_SERVER_ERROR_CODES].sort());
});
await check("M6 未加入 supabase_realtime（去除註解後無 ALTER PUBLICATION／supabase_realtime）；無 DELETE 型 RPC", () => {
  assert.doesNotMatch(sql, /ALTER PUBLICATION|supabase_realtime/i);
  assert.doesNotMatch(sql, /DELETE FROM public\.packing/i);
});

// SQL 規則 JS 重寫版（與瀏覽器假後端同一套語意）：在 Node 跑情境
function makeSim(uid) {
  let seq = 0;
  let clock = 0;
  const db = { cats: [], items: [], member: true };
  const id = (p) => p + "-" + ++seq;
  const tick = () => ++clock;
  const ICON = new Set(ICON16);
  const DEF = [["clothing", "Shirt"], ["toiletries", "ShowerHead"], ["electronics", "Smartphone"], ["documents", "IdCard"], ["medicine", "Pill"], ["other", "Package"]];
  const err = (m) => {
    const e = new Error(m);
    throw e;
  };
  const live = (trip) => db.cats.filter((c) => c.trip_id === trip && c.user_id === uid && !c.deleted_at).sort((a, b) => a.sort_index - b.sort_index);
  function ensure(trip) {
    if (!db.member) err("not_trip_member");
    if (!db.cats.some((c) => c.trip_id === trip && c.user_id === uid)) {
      DEF.forEach(([k, icon], i) => db.cats.push({ id: id("c"), trip_id: trip, user_id: uid, default_key: k, name: null, icon_key: icon, sort_index: i, deleted_at: null }));
    }
    return live(trip);
  }
  function insertCat(trip, p) {
    if (!ICON.has(p.icon_key ?? "Package")) err("packing_invalid_icon");
    if (live(trip).length >= 30) err("packing_category_limit_reached");
    const c = { id: id("c"), trip_id: trip, user_id: uid, default_key: null, name: p.name, icon_key: p.icon_key ?? "Package", sort_index: p.sort_index ?? 0, deleted_at: null };
    db.cats.push(c);
    return c;
  }
  function insertItem(trip, p) {
    const c = db.cats.find((x) => x.id === p.category_id);
    if (!c || c.trip_id !== trip || c.user_id !== uid) err("packing_category_not_found");
    if (c.deleted_at) err("packing_category_deleted");
    if (db.items.some((i) => i.user_id === uid && i.client_request_id === p.client_request_id)) err("23505");
    if (db.items.filter((i) => i.trip_id === trip && i.user_id === uid && !i.deleted_at).length >= 500) err("packing_item_limit_reached");
    const it = { id: id("i"), trip_id: trip, user_id: uid, category_id: p.category_id, name: p.name, version: 1, is_checked: false, deleted_at: null, client_request_id: p.client_request_id };
    db.items.push(it);
    return it;
  }
  function setCatDeleted(catId, del, { skipRestore = false } = {}) {
    const c = db.cats.find((x) => x.id === catId);
    const old = c.deleted_at;
    const ts = tick();
    if (!old && del) {
      c.deleted_at = ts;
      for (const i of db.items) if (i.category_id === c.id && !i.deleted_at) Object.assign(i, { deleted_at: ts, version: i.version + 1 });
    } else if (old && !del) {
      if (live(c.trip_id).length >= 30) err("packing_category_limit_reached");
      c.deleted_at = null;
      if (!skipRestore) for (const i of db.items) if (i.category_id === c.id && i.deleted_at === old) Object.assign(i, { deleted_at: null, version: i.version + 1 });
    }
    return c;
  }
  function setItemDeleted(itemId, del) {
    const i = db.items.find((x) => x.id === itemId);
    if (!del && i.deleted_at) {
      const c = db.cats.find((x) => x.id === i.category_id);
      if (c.deleted_at) err("packing_category_deleted");
    }
    i.deleted_at = del ? tick() : null;
    i.version += 1;
    return i;
  }
  function ensureOther(trip) {
    if (!db.member) err("not_trip_member");
    const o = db.cats.find((c) => c.trip_id === trip && c.user_id === uid && c.default_key === "other");
    if (o && !o.deleted_at) return o;
    const sort = Math.max(-1, ...live(trip).map((c) => c.sort_index)) + 1;
    if (o) {
      setCatDeleted(o.id, false, { skipRestore: true });
      Object.assign(o, { name: null, icon_key: "Package", sort_index: sort });
      return o;
    }
    const c = { id: id("c"), trip_id: trip, user_id: uid, default_key: "other", name: null, icon_key: "Package", sort_index: sort, deleted_at: null };
    db.cats.push(c);
    return c;
  }
  return { db, ensure, insertCat, insertItem, setCatDeleted, setItemDeleted, ensureOther, live };
}
await check("M7 規則情境（JS 重寫版）：ensure 冪等；刪除預設分類不復活；全刪後 ensure 不重建；ensure other 只復原「其他」且舊物品維持刪除", () => {
  const s = makeSim("u1");
  const a = s.ensure("t1");
  const b = s.ensure("t1");
  assert.equal(a.length, 6);
  assert.deepEqual(b.map((c) => c.id), a.map((c) => c.id));
  assert.equal(s.db.cats.length, 6);
  s.setCatDeleted(a[0].id, true);
  assert.equal(s.ensure("t1").length, 5, "刪除的預設分類被 ensure 復活");
  const other = a[5];
  const it = s.insertItem("t1", { category_id: other.id, name: "牙刷", client_request_id: "r1" });
  for (const c of s.live("t1")) s.setCatDeleted(c.id, true);
  assert.equal(s.ensure("t1").length, 0, "全刪後 ensure 重建了預設分類");
  assert.equal(s.db.cats.length, 6);
  const o = s.ensureOther("t1");
  assert.equal(o.id, other.id, "ensure other 應復原原本那列");
  assert.equal(s.live("t1").length, 1);
  assert.ok(s.db.items.find((x) => x.id === it.id).deleted_at, "ensure other 帶回了舊物品");
  assert.equal(s.ensureOther("t1").id, o.id);
});
await check("M8 規則情境：軟刪除分類連帶物品（同一時間戳），復原只恢復同時刪除的物品；先前單獨刪除的不回來；刪除分類後物品無法單獨復原", () => {
  const s = makeSim("u1");
  const [c] = s.ensure("t1");
  const i1 = s.insertItem("t1", { category_id: c.id, name: "A", client_request_id: "r1" });
  const i2 = s.insertItem("t1", { category_id: c.id, name: "B", client_request_id: "r2" });
  s.setItemDeleted(i1.id, true);
  s.setCatDeleted(c.id, true);
  assert.ok(i2.deleted_at && i2.deleted_at === c.deleted_at);
  assert.throws(() => s.setItemDeleted(i2.id, false), /packing_category_deleted/);
  s.setCatDeleted(c.id, false);
  assert.equal(i2.deleted_at, null, "同時刪除的物品未恢復");
  assert.ok(i1.deleted_at, "先前單獨刪除的物品被一起恢復");
});
await check("M9 規則情境：跨行程／他人分類被拒；已刪除分類不可新增；client_request_id 重複 23505；上限 30 分類", () => {
  const s = makeSim("u1");
  const c1 = s.ensure("t1")[0];
  const c2 = s.ensure("t2")[0];
  assert.throws(() => s.insertItem("t1", { category_id: c2.id, name: "x", client_request_id: "r1" }), /packing_category_not_found/);
  s.db.cats.push({ id: "foreign", trip_id: "t1", user_id: "u2", default_key: null, name: "他人", icon_key: "Package", sort_index: 0, deleted_at: null });
  assert.throws(() => s.insertItem("t1", { category_id: "foreign", name: "x", client_request_id: "r2" }), /packing_category_not_found/);
  s.insertItem("t1", { category_id: c1.id, name: "x", client_request_id: "r3" });
  assert.throws(() => s.insertItem("t1", { category_id: c1.id, name: "x", client_request_id: "r3" }), /23505/);
  s.setCatDeleted(c1.id, true);
  assert.throws(() => s.insertItem("t1", { category_id: c1.id, name: "y", client_request_id: "r4" }), /packing_category_deleted/);
  for (let n = s.live("t1").length; n < 30; n++) s.insertCat("t1", { name: "c" + n });
  assert.throws(() => s.insertCat("t1", { name: "31" }), /packing_category_limit_reached/);
  assert.throws(() => s.setCatDeleted(c1.id, false), /packing_category_limit_reached/);
  s.db.member = false;
  assert.throws(() => s.ensure("t1"), /not_trip_member/);
});

// ───────────────────────── Part S：前端靜態 ─────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const NEW_FILES = [
  "src/routes/_app.saved_.$tripId.packing.tsx",
  "src/lib/trip/trip-packing.ts",
  ...fs.readdirSync(path.join(root, "src/components/trip/packing")).map((f) => "src/components/trip/packing/" + f),
];
await check("S1 路由 /_app/saved_/$tripId/packing；routeTree 有 /saved/$tripId/packing；行程頁未改成 layout route", () => {
  assert.match(read("src/routes/_app.saved_.$tripId.packing.tsx"), /createFileRoute\("\/_app\/saved_\/\$tripId\/packing"\)/);
  assert.match(read("src/routeTree.gen.ts"), /path: '\/saved\/\$tripId\/packing'/);
  assert.doesNotMatch(read("src/routes/_app.saved.$tripId.tsx"), /<Outlet/);
});
await check("S2 行李新檔：無 .delete()、無 Realtime channel、無 Google／OpenAI／直接 fetch；資料層不傳 user_id", () => {
  for (const f of NEW_FILES) {
    const s = stripComments(read(f));
    assert.doesNotMatch(s, /\.delete\(\s*\)/, f + " 呼叫 .delete()");
    assert.doesNotMatch(s, /\.channel\(|removeChannel|postgres_changes/, f + " 建立 channel");
    assert.doesNotMatch(s, /googleapis|maps\.google|openai|\bfetch\(/i, f + " 外部呼叫");
  }
  const d = stripComments(read("src/lib/trip/trip-packing.ts"));
  assert.doesNotMatch(d, /user_id/, "trip-packing.ts 傳入或篩選 user_id");
  assert.doesNotMatch(d, /\b(checked_at|updated_at)\b|\bversion: (?!number\b)\w/, "trip-packing.ts 寫入伺服器管理欄位");
});
await check("S3 總覽「我的行李」卡緊接在「共同記帳」卡之後；TripDetailScreen 讀／清任一子頁返回標記", () => {
  const o = read("src/components/trip/TripWorkspaceOverview.tsx");
  assert.match(o, /<ExpensesOverviewCard tripId=\{stored\.id\} locale=\{locale\} \/>\s*<PackingOverviewCard tripId=\{stored\.id\} locale=\{locale\} \/>/);
  assert.equal((o.match(/<PackingOverviewCard/g) || []).length, 1);
  const t = read("src/components/trip/TripDetailScreen.tsx");
  assert.match(t, /readTripOverviewSubpageReturn\(tripId\)/);
  assert.match(t, /clearTripOverviewSubpageReturn\(\)/);
});
await check("S4 記帳返回標記 key 與 export 名稱不變；行李使用獨立 key", () => {
  const r = read("src/components/trip/expenses/expenses-return.ts");
  assert.match(r, /from: "roamie:trip-expenses-return",\s+fromAt: "roamie:trip-expenses-return-at",\s+back: "roamie:trip-expenses-back"/);
  assert.match(r, /from: "roamie:trip-packing-return",\s+fromAt: "roamie:trip-packing-return-at",\s+back: "roamie:trip-packing-back"/);
  for (const n of ["markTripExpensesFromOverview", "readTripExpensesFromOverview", "clearTripExpensesFromOverview", "markTripExpensesBackToOverview", "readTripExpensesReturn", "clearTripExpensesReturn"]) {
    assert.match(r, new RegExp("export function " + n + "\\("), n);
  }
  const ex = read("src/components/trip/expenses/TripExpensesScreen.tsx") + read("src/components/trip/expenses/ExpensesOverviewCard.tsx");
  assert.doesNotMatch(ex, /Packing|SubpageReturn/, "記帳頁改用了行李／共用 API");
});
const { build, transform } = await import("esbuild");
await check("S5 verify-trip-workspace-rls.mjs 可被解析，且含行李 S18–S25（只寫不跑：需 staging 憑證）", async () => {
  const src = read("scripts/verify-trip-workspace-rls.mjs");
  await transform(src, { loader: "js", format: "esm", target: "es2022" });
  for (const n of ["S18", "S19", "S20", "S21", "S22", "S23", "S24", "S25"]) assert.match(src, new RegExp('check\\("' + n + " 行李"), n);
  assert.match(src, /ensure_my_packing_categories/);
  assert.match(src, /\.from\("packing_items"\)\.delete\(\)/, "RLS 腳本需實測 client DELETE 被拒");
});

// ───────────────────────── Part R：瀏覽器 ─────────────────────────
const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-tw5-"));
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

const PK = "window.__pk";
const pkMocks = {
  ...commonMocks(PK),
  "@tanstack/react-router": `const NAV=(o)=>{${PK}.nav.push(o);return Promise.resolve();};
const ROUTER={history:{canGoBack:()=>!!${PK}.canGoBack,back(){${PK}.backs+=1;}},subscribe:()=>()=>{}};
export const useNavigate=()=>NAV;export const useRouter=()=>ROUTER;
export const useRouterState=({select})=>select({location:{pathname:'/saved/x/packing',searchStr:''}});
export const createFileRoute=(p)=>(o)=>({path:p,options:o,useParams:()=>({tripId:${PK}.tripId}),useNavigate:()=>NAV});`,
  "@/integrations/supabase/client": `export const supabase={
 rpc:(n,a)=>{${PK}.calls.push({kind:'rpc',n:n,a:JSON.parse(JSON.stringify(a))});return window.__pkRpc(n,a);},
 from:(t)=>window.__pkFrom(t),
 auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 channel:(...a)=>{${PK}.channels.push(a);const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{}};
export const isSupabaseConfigured=()=>true;`,
};

// 注意：以下 fixture 原始碼不使用反引號與 $-大括號插值
const pkEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TripPackingScreen} from '@/components/trip/packing/TripPackingScreen';
import {PackingOverviewCard} from '@/components/trip/packing/PackingOverviewCard';
import {Route as PkRoute} from '@/routes/_app.saved_.$tripId.packing';
import {getTripPackingCopy} from '@/lib/i18n/trip-workspace-copy';
import {packingErrorMessage} from '@/components/trip/packing/packing-text';
import {PACKING_SERVER_ERROR_CODES} from '@/components/trip/packing/packing-model';
import * as RET from '@/components/trip/expenses/expenses-return';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
const realNow=Date.now.bind(Date);Date.now=()=>realNow()+(window.__clock||0);
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__vis||'visible'});
window.COPY={'zh-TW':getTripPackingCopy('zh-TW'),en:getTripPackingCopy('en'),ja:getTripPackingCopy('ja'),ko:getTripPackingCopy('ko')};
window.ERRMSG={};['zh-TW','en','ja','ko'].forEach(function(l){const o={};PACKING_SERVER_ERROR_CODES.concat(['packing_item_name_invalid','packing_item_quantity_invalid','packing_item_note_invalid','packing_category_name_invalid','packing_conflict','network','unknown']).forEach(function(c){o[c]=packingErrorMessage(c,getTripPackingCopy(l));});window.ERRMSG[l]=o;});
window.RET=RET;
function deferred(){let r;const p=new Promise(function(a){r=a;});return {p:p,r:r};}
let rootEl=null;let tripSeq=0;
function nextTripId(){tripSeq+=1;return '7f000000-0000-4000-8000-'+tripSeq.toString(16).padStart(12,'0');}
let tsSeq=0;function txTs(){tsSeq+=1;return new Date(realNow()+(window.__clock||0)+tsSeq).toISOString();}
function S(){return window.__pk.srv;}
function uid(){return window.__pk.uid;}
function newId(p){S().idSeq+=1;return p+'-0000-4000-8000-'+S().idSeq.toString(16).padStart(12,'0');}
function clone(x){return JSON.parse(JSON.stringify(x));}
function E(message,code){return {message:message,code:code||'P0001',details:null,hint:null};}
const NET={data:null,error:{message:'TypeError: Failed to fetch',details:'',hint:'',code:''}};
const ICONS=['Shirt','Footprints','ShowerHead','Sparkles','Smartphone','Plug','Camera','IdCard','Wallet','Pill','HeartPulse','Umbrella','Sun','Baby','Gift','Package'];
const DKEYS=['clothing','toiletries','electronics','documents','medicine','other'];
const DEF=[['clothing','Shirt'],['toiletries','ShowerHead'],['electronics','Smartphone'],['documents','IdCard'],['medicine','Pill'],['other','Package']];
window.__allViol=[];function violate(msg){window.__pk.violations.push(msg);window.__allViol.push(msg);}
function forbid(p,keys,label){keys.forEach(function(k){if(Object.prototype.hasOwnProperty.call(p,k))violate(label+' 送出 '+k);});}
function liveCats(trip){return S().cats.filter(function(c){return c.trip_id===trip&&c.user_id===uid()&&!c.deleted_at;}).sort(function(a,b){return a.sort_index-b.sort_index||(a.created_at<b.created_at?-1:a.created_at>b.created_at?1:0);});}
function catRow(trip,o){const t=txTs();return {id:newId('cc000000'),trip_id:trip,user_id:uid(),default_key:o.default_key==null?null:o.default_key,name:o.name==null?null:o.name,icon_key:o.icon_key||'Package',sort_index:o.sort_index||0,created_at:t,updated_at:t,deleted_at:null};}
function chkCat(r){if(ICONS.indexOf(r.icon_key)<0)return E('packing_invalid_icon','22023');
  if(r.default_key!=null&&DKEYS.indexOf(r.default_key)<0)return E('packing_invalid_default_key','22023');
  if(r.name!=null&&(String(r.name).trim().length<1||Array.from(r.name).length>40))return E('new row for relation "packing_categories" violates check constraint "packing_categories_name_check"','23514');
  if(r.default_key==null&&r.name==null)return E('new row for relation "packing_categories" violates check constraint "packing_categories_custom_name_check"','23514');return null;}
function chkItem(r){if(String(r.name).trim().length<1||Array.from(r.name).length>80)return E('violates check constraint "packing_items_name_check"','23514');
  if(!(Number.isInteger(r.quantity)&&r.quantity>=1&&r.quantity<=99))return E('violates check constraint "packing_items_quantity_check"','23514');
  if(r.note!=null&&Array.from(r.note).length>200)return E('violates check constraint "packing_items_note_check"','23514');return null;}
function catCheck(r){const c=S().cats.find(function(x){return x.id===r.category_id&&x.user_id===uid();});
  if(!c||c.trip_id!==r.trip_id)return E('packing_category_not_found','P0002');if(c.deleted_at)return E('packing_category_deleted','22023');return null;}
function liveItemCount(trip){return S().items.filter(function(i){return i.trip_id===trip&&i.user_id===uid()&&!i.deleted_at;}).length;}
function rpcEnsure(a){const s=S();if(!s.member)return {data:null,error:E('not_trip_member','42501')};
  if(!s.cats.some(function(c){return c.trip_id===a.p_trip_id&&c.user_id===uid();}))DEF.forEach(function(d,i){s.cats.push(catRow(a.p_trip_id,{default_key:d[0],icon_key:d[1],sort_index:i}));});
  return {data:clone(liveCats(a.p_trip_id)),error:null};}
function rpcEnsureOther(a){const s=S();if(!s.member)return {data:null,error:E('not_trip_member','42501')};
  const o=s.cats.find(function(c){return c.trip_id===a.p_trip_id&&c.user_id===uid()&&c.default_key==='other';});
  if(o&&!o.deleted_at)return {data:clone(o),error:null};
  const live=liveCats(a.p_trip_id);if(live.length>=30)return {data:null,error:E('packing_category_limit_reached','54000')};
  const sort=live.reduce(function(m,c){return Math.max(m,c.sort_index+1);},0);
  if(o){Object.assign(o,{deleted_at:null,name:null,icon_key:'Package',sort_index:sort,updated_at:txTs()});return {data:clone(o),error:null};}
  const c=catRow(a.p_trip_id,{default_key:'other',icon_key:'Package',sort_index:sort});s.cats.push(c);return {data:clone(c),error:null};}
function applyRpc(n,a){if(n==='ensure_my_packing_categories')return rpcEnsure(a);if(n==='ensure_my_packing_other_category')return rpcEnsureOther(a);return {data:null,error:E('unknown rpc '+n)};}
function match(row,filters){return filters.every(function(f){const m=f[0];
  if(m==='eq')return row[f[1]]===f[2];if(m==='is')return f[2]===null?row[f[1]]==null:row[f[1]]===f[2];if(m==='in')return f[2].indexOf(row[f[1]])>=0;if(m==='neq')return row[f[1]]!==f[2];return true;});}
function updItemRow(row,p,internal){const old=clone(row);const nw=Object.assign(clone(row),p);
  if(nw.trip_id!==old.trip_id||nw.user_id!==old.user_id||nw.client_request_id!==old.client_request_id)return E('packing_immutable_field','22023');
  nw.version=old.version+1;nw.updated_at=txTs();
  if(nw.is_checked&&!old.is_checked)nw.checked_at=txTs();else if(!nw.is_checked)nw.checked_at=null;else nw.checked_at=old.checked_at;
  if(!old.deleted_at&&nw.deleted_at)nw.deleted_at=internal&&internal.ts?internal.ts:txTs();else if(old.deleted_at&&nw.deleted_at)nw.deleted_at=old.deleted_at;
  if(!nw.deleted_at&&(nw.category_id!==old.category_id||old.deleted_at)){const e=catCheck(nw);if(e)return e;}
  if(old.deleted_at&&!nw.deleted_at&&liveItemCount(nw.trip_id)>=500)return E('packing_item_limit_reached','54000');
  const e2=chkItem(nw);if(e2)return e2;Object.assign(row,nw);return null;}
function updCatRow(row,p){const old=clone(row);const nw=Object.assign(clone(row),p);
  if(nw.trip_id!==old.trip_id||nw.user_id!==old.user_id||nw.default_key!==old.default_key)return E('packing_immutable_field','22023');
  nw.updated_at=txTs();
  if(!old.deleted_at&&nw.deleted_at)nw.deleted_at=txTs();else if(old.deleted_at&&nw.deleted_at)nw.deleted_at=old.deleted_at;
  const e=chkCat(nw);if(e)return e;
  if(old.deleted_at&&!nw.deleted_at&&liveCats(nw.trip_id).length>=30)return E('packing_category_limit_reached','54000');
  Object.assign(row,nw);
  if(!old.deleted_at&&nw.deleted_at){S().items.forEach(function(i){if(i.category_id===row.id&&!i.deleted_at)updItemRow(i,{deleted_at:nw.deleted_at},{ts:nw.deleted_at});});}
  else if(old.deleted_at&&!nw.deleted_at){S().items.forEach(function(i){if(i.category_id===row.id&&i.deleted_at===old.deleted_at)updItemRow(i,{deleted_at:null},{});});}
  return null;}
const ITEM_INSERT_KEYS=['category_id','client_request_id','name','note','quantity','sort_index','trip_id'];
function runFrom(st){const s=S();const t=st.t;const rlsRows=function(list){return s.member?list.filter(function(r){return r.user_id===uid();}):[];};
  const table=t==='packing_categories'?s.cats:t==='packing_items'?s.items:null;
  if(!table)return {data:null,error:E('relation does not exist','42P01')};
  if(st.op==='delete'){return {data:null,error:E('permission denied for table '+t,'42501')};}
  if(st.op==='select'){return {data:clone(rlsRows(table).filter(function(r){return match(r,st.filters);})),error:null};}
  if(st.op==='insert'){const p=st.payload;if(Array.isArray(p))return {data:null,error:E('bulk insert not expected')};
    if(!s.member)return {data:null,error:E('new row violates row-level security policy for table "'+t+'"','42501')};
    if(t==='packing_items'){forbid(p,['id','user_id','version','checked_at','created_at','updated_at','deleted_at','is_checked'],'insert packing_items');
      const keys=Object.keys(p).sort();if(JSON.stringify(keys)!==JSON.stringify(ITEM_INSERT_KEYS))violate('insert packing_items 欄位 '+keys.join(','));
      if(s.items.some(function(i){return i.user_id===uid()&&i.client_request_id===p.client_request_id;}))return {data:null,error:E('duplicate key value violates unique constraint "packing_items_user_client_request_key"','23505')};
      const t0=txTs();const r={id:newId('ee000000'),trip_id:p.trip_id,user_id:uid(),category_id:p.category_id,name:p.name,quantity:p.quantity==null?1:p.quantity,note:p.note==null?null:p.note,is_checked:false,checked_at:null,sort_index:p.sort_index||0,version:1,client_request_id:p.client_request_id,created_at:t0,updated_at:t0,deleted_at:null};
      const e=catCheck(r)||chkItem(r);if(e)return {data:null,error:e};
      if(liveItemCount(p.trip_id)>=500)return {data:null,error:E('packing_item_limit_reached','54000')};
      s.items.push(r);return {data:[clone(r)],error:null};}
    forbid(p,['id','user_id','created_at','updated_at','deleted_at','default_key'],'insert packing_categories');
    const c=catRow(p.trip_id,{name:p.name,icon_key:p.icon_key,sort_index:p.sort_index});const e=chkCat(c);if(e)return {data:null,error:e};
    if(liveCats(p.trip_id).length>=30)return {data:null,error:E('packing_category_limit_reached','54000')};
    s.cats.push(c);return {data:[clone(c)],error:null};}
  if(st.op==='update'){const p=st.payload;
    forbid(p,t==='packing_items'?['id','user_id','trip_id','version','checked_at','created_at','updated_at','client_request_id']:['id','user_id','trip_id','default_key','created_at','updated_at'],'update '+t);
    if(!st.filters.some(function(f){return f[0]==='eq'&&f[1]==='id';}))violate('update '+t+' 未以 id 篩選');
    const rows=rlsRows(table).filter(function(r){return match(r,st.filters);});
    for(let i=0;i<rows.length;i++){const e=t==='packing_items'?updItemRow(rows[i],p):updCatRow(rows[i],p);if(e)return {data:null,error:e};}
    return {data:clone(rows),error:null};}
  return {data:null,error:E('unsupported op '+st.op)};}
function shape(res,mode){if(res.error||mode==='list'||mode==='raw')return res;const rows=res.data||[];
  if(mode==='single'){if(rows.length!==1)return {data:null,error:{message:'JSON object requested, multiple (or no) rows returned',details:'The result contains '+rows.length+' rows',hint:null,code:'PGRST116'}};return {data:rows[0],error:null};}
  if(rows.length>1)return {data:null,error:{message:'multiple rows',code:'PGRST116',details:null,hint:null}};return {data:rows[0]||null,error:null};}
function planFor(key){const q=window.__pk.plan[key];return q&&q.length?q.shift():null;}
function runPlanned(key,apply,mode){const plan=planFor(key);
  if(plan==='network')return Promise.resolve(NET);
  if(plan==='apply-then-network'){apply();return Promise.resolve(NET);}
  if(plan==='defer'){const d=deferred();window.__pk.defers.push({key:key,apply:apply,mode:mode,d:d});return d.p;}
  if(plan&&plan.error)return Promise.resolve({data:null,error:E(plan.error,plan.code)});
  return Promise.resolve().then(function(){return shape(apply(),mode);});}
window.release=function(i,how){const x=window.__pk.defers[i];if(!x||x.done)return 'missing';x.done=true;
  if(how==='network')x.d.r(NET);else if(how==='apply-then-network'){x.apply();x.d.r(NET);}else if(how&&how.error)x.d.r({data:null,error:E(how.error,how.code)});else x.d.r(shape(x.apply(),x.mode));return true;};
window.__pkRpc=function(n,a){return runPlanned('rpc:'+n,function(){return applyRpc(n,a);},n==='ensure_my_packing_other_category'?'raw':'raw');};
window.__pkFrom=function(t){const st={t:t,op:null,payload:null,filters:[],ret:false};const q={};
  q.select=function(c){if(st.op)st.ret=true;else{st.op='select';st.cols=c;}return q;};
  q.insert=function(p){st.op='insert';st.payload=clone(p);return q;};
  q.update=function(p){st.op='update';st.payload=clone(p);return q;};
  q.delete=function(){st.op='delete';return q;};
  q.upsert=function(p){st.op='upsert';st.payload=clone(p);return q;};
  ['eq','neq','is','in','order','limit','not','match','filter','range'].forEach(function(m){q[m]=function(){st.filters.push([m].concat(Array.prototype.slice.call(arguments)));return q;};});
  const exec=function(mode){window.__pk.calls.push({kind:'from',t:t,op:st.op,payload:st.payload,filters:clone(st.filters),mode:mode});
    return runPlanned(st.op+':'+t,function(){return runFrom(st);},mode);};
  q.single=function(){return exec('single');};q.maybeSingle=function(){return exec('maybe');};
  q.then=function(a,b){return exec('list').then(a,b);};return q;};
window.serverPatchItem=function(name,patch){const r=S().items.find(function(x){return x.name===name&&!x.deleted_at;});Object.assign(r,patch);return true;};
window.unmountAll=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}return true;};
window.ss=function(){const o={};for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);o[k]=sessionStorage.getItem(k);}return o;};
function seed(trip,o){const s=S();if(!o)return;
  if(o.defaults)DEF.forEach(function(d,i){s.cats.push(catRow(trip,{default_key:d[0],icon_key:d[1],sort_index:i}));});
  (o.cats||[]).forEach(function(c){const r=catRow(trip,{name:c.name,default_key:c.key,icon_key:c.icon,sort_index:c.sort});if(c.deleted)r.deleted_at=txTs();s.cats.push(r);});
  (o.deleteKeys||[]).forEach(function(k){const c=s.cats.find(function(x){return x.trip_id===trip&&x.default_key===k;});c.deleted_at=txTs();});
  (o.items||[]).forEach(function(it,n){const c=s.cats.find(function(x){return x.trip_id===trip&&(x.default_key===it.cat||x.name===it.cat);});const t0=txTs();
    s.items.push({id:newId('ee000000'),trip_id:trip,user_id:it.user||uid(),category_id:c.id,name:it.name,quantity:it.quantity||1,note:it.note||null,is_checked:!!it.checked,checked_at:it.checked?t0:null,sort_index:it.sort==null?n:it.sort,version:it.version||1,client_request_id:newId('aa000000'),created_at:t0,updated_at:t0,deleted_at:it.deleted?t0:null});});}
window.mount=function(o){
  if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}
  if(!o.keepStorage)sessionStorage.clear();window.__clock=o.clock||0;window.__vis='visible';
  const tripId=o.tripId||nextTripId();
  if(!o.keepServer||!window.__pk){window.__pk={srv:{idSeq:256,cats:[],items:[],member:o.member!==false}};}
  const srv=window.__pk.srv;
  window.__pk={tripId:tripId,locale:o.locale||'zh-TW',uid:o.uid||'aaaaaaaa-0000-4000-8000-000000000001',nav:[],backs:0,canGoBack:!!o.canGoBack,toasts:[],calls:[],channels:[],violations:[],plan:o.plan||{},defers:[],srv:srv};
  if(!o.keepServer)seed(tripId,o.seed);
  if(o.mark)window.RET.markTripPackingFromOverview(o.mark===true?tripId:o.mark);
  if(o.markAge!=null)sessionStorage.setItem('roamie:trip-packing-return-at',String(Date.now()-o.markAge));
  document.getElementById('root').innerHTML='';
  rootEl=createRoot(document.getElementById('root'));
  const Page=PkRoute.options.component;
  const card=function(){return React.createElement(PackingOverviewCard,{tripId:tripId,locale:window.__pk.locale});};
  const tree=o.what==='card'?card():o.what==='card2'?React.createElement('div',null,card(),card()):o.what==='route'?React.createElement(Page):React.createElement(TripPackingScreen,{tripId:tripId});
  flushSync(function(){rootEl.render(React.createElement(StrictMode,null,tree));});
  return tripId;};
const qa=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
function C(){return window.COPY[window.__pk.locale];}
function fmt(t,o){return t.replace(/\\{(\\w+)\\}/g,function(_,k){return String(o[k]);});}
function catSections(){return qa('#root section').filter(function(s){return !!s.querySelector(':scope > button[aria-expanded]');});}
function sectionOf(label){return catSections().find(function(s){const h=s.querySelector(':scope > button[aria-expanded]');return h.getAttribute('aria-label')===fmt(C().collapse,{name:label})||h.getAttribute('aria-label')===fmt(C().expand,{name:label});})||null;}
function rowOf(name){return qa('#root li').find(function(li){const cb=li.querySelector('[role=checkbox]');return cb&&cb.getAttribute('aria-label')===name;})||null;}
function dlgs(){return qa('[role=dialog],[role=alertdialog]');}
function sheetWith(text){return qa('[role=dialog]').find(function(d){return d.textContent.indexOf(text)>=0;})||null;}
function alertDlg(){return document.querySelector('[role=alertdialog]');}
function setVal(el,v){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}
function clickEl(b){if(!b)return 'missing';if(b.disabled)return 'disabled';flushSync(function(){b.click();});return 'clicked';}
window.toggle=function(name){const li=rowOf(name);return clickEl(li&&li.querySelector('[role=checkbox]'));};
window.toggleTwice=function(name){return new Promise(function(res){const li=rowOf(name);const b=li&&li.querySelector('[role=checkbox]');if(!b)return res('missing');b.click();setTimeout(function(){b.click();res('ok');},0);});};
window.openItem=function(name){const li=rowOf(name);return clickEl(li&&li.querySelector('[role=checkbox]').nextElementSibling);};
window.toggleSection=function(label){const s=sectionOf(label);return clickEl(s&&s.querySelector(':scope > button[aria-expanded]'));};
window.openAdder=function(label){const s=label==null?qa('#root .rounded-2xl').find(function(x){return !x.querySelector('[aria-expanded]')&&x.textContent.trim()===C().addItem;}):sectionOf(label);if(!s)return 'no-section';
  const b=qa('button',s).find(function(x){return x.textContent.trim()===C().addItem;});return clickEl(b);};
function adderInput(label){return qa('#root input').find(function(i){return i.getAttribute('aria-label')===fmt(C().addItemLabel,{name:label});})||null;}
window.typeAdd=function(label,text){const el=adderInput(label);if(!el)return 'missing';flushSync(function(){setVal(el,text);});return 'set';};
window.adderValue=function(label){const el=adderInput(label);return el?el.value:null;};
window.pressEnter=function(label,o){const el=adderInput(label);if(!el)return 'missing';o=o||{};const ev=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:!!o.composing});
  if(o.keyCode)Object.defineProperty(ev,'keyCode',{get:function(){return o.keyCode;}});flushSync(function(){el.dispatchEvent(ev);});return ev.defaultPrevented?'prevented':'dispatched';};
window.clickIn=function(scope,text,label){const r=scope==='alert'?alertDlg():scope==='header'?document.querySelector('#root header'):scope==='root'?document.getElementById('root'):sheetWith(scope);if(!r)return 'no-scope';
  const b=qa('button',r).find(function(x){return label?x.getAttribute('aria-label')===label:x.textContent.trim()===text;});return clickEl(b);};
window.catSheetRow=function(label,action,n){const d=sheetWith(C().categoriesSheetHint);if(!d)return 'no-sheet';const li=qa('li',d).find(function(l){const i=l.querySelector('input');return i&&i.value===label;});if(!li)return 'no-row';
  if(action==='delete')return clickEl(li.querySelector('button[aria-label="'+C().deleteCategory+'"]'));
  if(action==='up')return clickEl(li.querySelector('button[aria-label="'+C().moveUp+'"]'));
  if(action==='down')return clickEl(li.querySelector('button[aria-label="'+C().moveDown+'"]'));
  if(action==='icon'){clickEl(qa('button',li).find(function(b){return b.getAttribute('aria-label')===C().iconLabel;}));const b=qa('button[role=radio]',li).find(function(x){return x.getAttribute('aria-label')===fmt(C().iconOption,{n:n});});return clickEl(b);}
  if(action==='rename'){const i=li.querySelector('input');flushSync(function(){i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));});flushSync(function(){setVal(i,n);});flushSync(function(){i.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));});return 'renamed';}
  return 'bad-action';};
window.catSheetLabels=function(){const d=sheetWith(C().categoriesSheetHint);return d?qa('li input',d).map(function(i){return i.value;}):null;};
window.alertState=function(){const d=alertDlg();if(!d)return null;const sel=d.querySelector('select');return {text:d.textContent,radios:qa('input[type=radio]',d).map(function(r){return r.checked;}),
  select:sel?{value:sel.value,options:qa('option',sel).map(function(o){return {value:o.value,text:o.textContent};})}:null};};
window.alertPick=function(i){const d=alertDlg();const r=qa('input[type=radio]',d)[i];if(!r)return 'missing';flushSync(function(){r.click();});return 'picked';};
window.alertSelect=function(v){const d=alertDlg();const s=d&&d.querySelector('select');if(!s)return 'missing';flushSync(function(){setVal(s,v);});return 'set';};
window.itemSheet=function(){const d=sheetWith(C().itemSheetTitle);if(!d)return null;return {text:d.textContent,name:(d.querySelector('input')||{}).value,status:qa('[role=status]',d).map(function(e){return e.textContent;}),
  cats:qa('[role=radiogroup] [role=radio]',d).map(function(b){return {text:b.textContent,checked:b.getAttribute('aria-checked')};})};};
window.itemSheetPickCat=function(label){const d=sheetWith(C().itemSheetTitle);const b=qa('[role=radio]',d).find(function(x){return x.textContent===label;});return clickEl(b);};
window.visible=function(v){window.__vis=v||'visible';document.dispatchEvent(new Event('visibilitychange'));return true;};
window.toastAction=function(i){const t=window.__pk.toasts[i];t.o.action.onClick();return true;};
window.st=function(){const pk=window.__pk;const root=document.getElementById('root');const sections=qa('#root section');const prog=sections.find(function(s){return !s.querySelector('[aria-expanded]');});
  const bar=root.querySelector('[role=progressbar]');
  return {text:root.textContent,
  header:(function(){const h=root.querySelector('header');return h?{title:(h.querySelector('h1')||{}).textContent,sub:(h.querySelector('p')||{}).textContent,lock:!!(h.querySelector('p svg')),buttons:qa('button',h).map(function(b){return b.textContent.trim()||b.getAttribute('aria-label');})}:null;})(),
  progress:prog?prog.querySelector('p').textContent:null,
  bar:bar?{now:bar.getAttribute('aria-valuenow'),max:bar.getAttribute('aria-valuemax'),width:bar.firstElementChild.style.width}:null,
  cats:catSections().map(function(s){const h=s.querySelector(':scope > button[aria-expanded]');const sp=h.querySelectorAll(':scope > span');
    return {label:sp[1].textContent,progress:sp[2].textContent,expanded:h.getAttribute('aria-expanded'),iconRound:sp[0].className.indexOf('rounded-full')>=0,
      items:qa('li',s).map(function(li){const cb=li.querySelector('[role=checkbox]');const ob=cb.nextElementSibling;const nameEl=ob.querySelector('span span');
        return {name:cb.getAttribute('aria-label'),checked:cb.getAttribute('aria-checked'),busy:cb.getAttribute('aria-busy'),faded:/opacity-50/.test(ob.className),dur150:/duration-150/.test(ob.className),strike:/line-through/.test(nameEl.className),badge:ob.children[1]?ob.children[1].textContent:null,round:!!cb.querySelector('.rounded-full')};})};}),
  alerts:qa('#root [role=alert]').map(function(e){return e.textContent;}),
  calls:pk.calls,channels:pk.channels.length,violations:pk.violations,
  toasts:pk.toasts.map(function(t){return {kind:t.kind,m:t.m,duration:t.o&&t.o.duration,action:t.o&&t.o.action?t.o.action.label:null};}),
  nav:pk.nav,backs:pk.backs,defers:pk.defers.length,
  srvCats:pk.srv.cats.filter(function(c){return c.trip_id===pk.tripId;}).map(function(c){return {id:c.id,key:c.default_key,name:c.name,icon:c.icon_key,sort:c.sort_index,deleted:c.deleted_at};}),
  srvItems:pk.srv.items.filter(function(i){return i.trip_id===pk.tripId;}).map(function(i){return {id:i.id,name:i.name,cat:i.category_id,qty:i.quantity,checked:i.is_checked,version:i.version,deleted:i.deleted_at,sort:i.sort_index,crid:i.client_request_id,note:i.note};}),
  ss:window.ss(),dialogs:dlgs().length};};
window.__ready=true;`;

// ── TripDetailScreen fixture（R11）──
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
 q.delete=()=>{${TD}.deletes.push(t);return q;};
 const run=(kind)=>{${TD}.from.push(t);if(t==='saved_trips'&&kind==='single')return {data:{user_id:'aaaaaaaa-0000-4000-8000-000000000001'},error:null};
  if(t==='trip_members'&&kind==='single')return {data:{is_owner:true,status:'accepted'},error:null};
  if(t==='packing_items')return {data:${TD}.pkItems||[],error:null};
  return {data:kind==='single'?null:[],error:null};};
 q.maybeSingle=()=>Promise.resolve(run('single'));q.single=q.maybeSingle;
 q.then=(a,b)=>Promise.resolve(run('list')).then(a,b);return q;}
export const supabase={rpc:(n,a)=>{${TD}.rpc.push(n);if(n==='ensure_my_packing_categories')return Promise.resolve({data:${TD}.pkCats||[],error:null});return Promise.resolve({data:[],error:null});},from:(t)=>chain(t),
 auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 channel:(...a)=>{${TD}.channels+=1;const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{}};
export const isSupabaseConfigured=()=>true;`,
};
const detailEntry = `import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TripDetailScreen} from '@/components/trip/TripDetailScreen';
import {saveTripWorkspaceScrollTops} from '@/lib/trip/trip-detail-view-state';
import {getTripPackingCopy,getTripExpensesCopy} from '@/lib/i18n/trip-workspace-copy';
console.info=()=>{};console.debug=()=>{};console.log=()=>{};console.warn=()=>{};
let rootEl=null;
window.dmount=function(o){
  if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}
  if(!o.keepStorage){sessionStorage.clear();localStorage.clear();}
  window.__td={nav:[],toasts:[],rpc:[],from:[],deletes:[],channels:0,locale:'zh-TW',uid:'aaaaaaaa-0000-4000-8000-000000000001',
    pkCats:[{id:'cc000000-0000-4000-8000-000000000001',trip_id:o.tripId,user_id:'aaaaaaaa-0000-4000-8000-000000000001',default_key:'other',name:null,icon_key:'Package',sort_index:0,created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',deleted_at:null}],
    pkItems:[{id:'ee000000-0000-4000-8000-000000000001',trip_id:o.tripId,user_id:'aaaaaaaa-0000-4000-8000-000000000001',category_id:'cc000000-0000-4000-8000-000000000001',name:'x',quantity:3,note:null,is_checked:true,checked_at:null,sort_index:0,version:1,client_request_id:'aa000000-0000-4000-8000-000000000001',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',deleted_at:null},
      {id:'ee000000-0000-4000-8000-000000000002',trip_id:o.tripId,user_id:'aaaaaaaa-0000-4000-8000-000000000001',category_id:'cc000000-0000-4000-8000-000000000001',name:'y',quantity:1,note:null,is_checked:false,checked_at:null,sort_index:1,version:1,client_request_id:'aa000000-0000-4000-8000-000000000002',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',deleted_at:null}]};
  if(o.tops)saveTripWorkspaceScrollTops(o.tripId,o.tops);
  if(o.exMark)sessionStorage.setItem('roamie:trip-expenses-return',o.exMark);
  if(o.pkBack)sessionStorage.setItem('roamie:trip-packing-back',JSON.stringify({tripId:o.pkBack.tripId,at:Date.now()-o.pkBack.age}));
  if(o.pkMark){sessionStorage.setItem('roamie:trip-packing-return',o.pkMark);sessionStorage.setItem('roamie:trip-packing-return-at',String(Date.now()));}
  rootEl=createRoot(document.getElementById('droot'));
  flushSync(function(){rootEl.render(React.createElement(StrictMode,null,React.createElement(TripDetailScreen,{tripId:o.tripId,navSource:'verify',initialView:o.view})));});
  return true;};
window.dunmount=function(){if(rootEl){flushSync(function(){rootEl.render(null);});rootEl.unmount();rootEl=null;}return true;};
window.dscroll=function(v){const el=document.querySelector('.trip-detail-route');if(!el)return null;if(v!=null){el.scrollTop=v;el.dispatchEvent(new Event('scroll'));}return el.scrollTop;};
function cardBtn(C){return Array.prototype.slice.call(document.querySelectorAll('#droot button')).find(function(x){return x.textContent.indexOf(C.title)>=0&&x.textContent.indexOf(C.overviewCta)>=0;});}
window.dclickPacking=function(){const b=cardBtn(getTripPackingCopy('zh-TW'));if(!b)return 'missing';flushSync(function(){b.click();});return 'clicked';};
window.dstate=function(){const P=getTripPackingCopy('zh-TW');const X=getTripExpensesCopy('zh-TW');const all=Array.prototype.slice.call(document.querySelectorAll('#droot button'));const pb=cardBtn(P);const xb=cardBtn(X);
  return {editor:!!document.querySelector('[data-editor-root]'),scrollTop:window.dscroll(),nav:window.__td.nav,text:document.getElementById('droot').textContent,
  packingIdx:pb?all.indexOf(pb):-1,expensesIdx:xb?all.indexOf(xb):-1,packingText:pb?pb.textContent:null,nextSiblingIsPacking:!!(xb&&xb.nextElementSibling===pb),
  ss:(function(){const o={};for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);o[k]=sessionStorage.getItem(k);}return o;})(),
  deletes:window.__td.deletes,channels:window.__td.channels,rpc:window.__td.rpc};};
window.__dready=true;`;

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
  await build({ ...common, stdin: { contents: pkEntry, resolveDir: root, loader: "tsx" }, outfile: path.join(tmp, "app.js"), plugins: [mockPlugin(pkMocks)] });
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
    const fmt = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => String(o[k]));
    const mount = async (o = {}) => {
      const tripId = await ev("mount", o);
      for (let i = 0; i < 80; i++) {
        const s = await st();
        if (o.what === "card" || o.what === "card2" ? !s.text.includes(COPY[o.locale ?? "zh-TW"].overviewLoading) : s.progress != null || s.text.includes(Z.loadFailed) || s.text.includes(Z.errorNetwork) || o.what === "route") break;
        await sleep(25);
      }
      await sleep(100);
      return tripId;
    };
    const ensures = (s) => s.calls.filter((c) => c.kind === "rpc" && c.n === "ensure_my_packing_categories");
    const itemSelects = (s) => s.calls.filter((c) => c.kind === "from" && c.t === "packing_items" && c.op === "select");
    const writes = (s) => s.calls.filter((c) => c.kind === "from" && (c.op === "update" || c.op === "insert" || c.op === "delete"));
    const STD = { defaults: true, items: [
      { cat: "clothing", name: "T恤", quantity: 3, checked: true },
      { cat: "clothing", name: "襪子", quantity: 1 },
      { cat: "toiletries", name: "牙刷", quantity: 1 },
      { cat: "electronics", name: "充電器", quantity: 2, checked: true },
      { cat: "other", name: "雨傘", quantity: 1 },
    ] };

    // ═══ R1 進入頁面 ═══
    {
      await mount({ seed: STD });
      const s = await st();
      await check("R1a 進入頁面：StrictMode 下 ensure_my_packing_categories 1 次、packing_items 讀取 1 次（不篩 user_id、deleted_at is null）；無 channel", () => {
        assert.equal(ensures(s).length, 1, "ensure 次數 " + ensures(s).length);
        assert.equal(itemSelects(s).length, 1, "items 讀取次數 " + itemSelects(s).length);
        const f = itemSelects(s)[0].filters;
        assert.ok(f.some((x) => x[0] === "eq" && x[1] === "trip_id"));
        assert.ok(f.some((x) => x[0] === "is" && x[1] === "deleted_at" && x[2] === null));
        assert.ok(!f.some((x) => x[1] === "user_id"), "以 user_id 篩選");
        assert.equal(s.channels, 0);
      });
      await check("R1b 標題「我的行李」、副標「只有你看得到這份清單」＋鎖頭、右上「編輯分類」；整體「已打包 2 / 5」（不乘 quantity）與進度條 40%", () => {
        assert.equal(s.header.title, "我的行李");
        assert.equal(s.header.sub, "只有你看得到這份清單");
        assert.ok(s.header.lock, "缺鎖頭");
        assert.equal(s.header.buttons.at(-1), "編輯分類");
        assert.equal(s.progress, "已打包 2 / 5");
        assert.deepEqual(s.bar, { now: "2", max: "5", width: "40%" });
      });
      await check("R1c 分類卡：圓底 icon＋語系名稱＋x / y，依 sort 排序；物品列：圓形勾選、已勾淡化＋刪除線（150ms）、數量 >1 顯示 ×N", () => {
        assert.deepEqual(s.cats.map((c) => c.label), ["衣物", "盥洗用品", "電子用品", "證件", "藥品", "其他"]);
        assert.deepEqual(s.cats.map((c) => c.progress), ["1 / 2", "0 / 1", "1 / 1", "0 / 0", "0 / 0", "0 / 1"]);
        assert.ok(s.cats.every((c) => c.iconRound && c.expanded === "true"));
        const [tee, sock] = s.cats[0].items;
        assert.deepEqual([tee.name, tee.checked, tee.faded, tee.strike, tee.badge, tee.dur150, tee.round], ["T恤", "true", true, true, "×3", true, true]);
        assert.deepEqual([sock.name, sock.checked, sock.faded, sock.strike, sock.badge], ["襪子", "false", false, false, null]);
      });
      await ev("toggleSection", "衣物");
      await sleep(30);
      const s2 = await st();
      await ev("toggleSection", "衣物");
      await sleep(30);
      const s3 = await st();
      await check("R1d 分類可摺疊／展開", () => {
        assert.equal(s2.cats[0].expanded, "false");
        assert.equal(s2.cats[0].items.length, 0);
        assert.equal(s3.cats[0].items.length, 2);
      });
    }

    // ═══ R2 勾選 ═══
    {
      await mount({ seed: STD, plan: { "update:packing_items": ["defer"] } });
      assert.equal(await ev("toggle", "襪子"), "clicked");
      await sleep(30);
      const mid = await st();
      await ev("toggleTwice", "襪子");
      await sleep(30);
      const mid2 = await st();
      await ev("release", 0);
      await sleep(80);
      const done = await st();
      await check("R2a 勾選樂觀更新：送出前即顯示已勾與進度 3 / 5；送出中連點不重送（只 1 個 update）；成功後保持、server version +1", () => {
        const sock = mid.cats[0].items.find((i) => i.name === "襪子");
        assert.equal(sock.checked, "true");
        assert.equal(sock.busy, "true");
        assert.equal(mid.progress, "已打包 3 / 5");
        assert.equal(writes(mid2).length, 1, "送出中連點重送：" + writes(mid2).length);
        assert.equal(writes(done).length, 1);
        const w = writes(done)[0];
        assert.deepEqual(w.payload, { is_checked: true }, "勾選只送 is_checked");
        assert.ok(w.filters.some((f) => f[0] === "eq" && f[1] === "version" && f[2] === 1), "未帶版本條件");
        assert.equal(done.cats[0].items.find((i) => i.name === "襪子").checked, "true");
        assert.equal(done.srvItems.find((i) => i.name === "襪子").version, 2);
        assert.deepEqual(done.violations, []);
      });
      // 成功後再勾一次應帶新版本
      await ev("toggle", "襪子");
      await sleep(80);
      const again = await st();
      await check("R2b 成功後再次勾選使用伺服器回傳的新版本（version 2）", () => {
        const w = writes(again).at(-1);
        assert.ok(w.filters.some((f) => f[0] === "eq" && f[1] === "version" && f[2] === 2), JSON.stringify(w.filters));
        assert.equal(again.srvItems.find((i) => i.name === "襪子").checked, false);
      });
    }
    {
      await mount({ seed: STD, plan: { "update:packing_items": ["network"] } });
      await ev("toggle", "牙刷");
      await sleep(80);
      const s = await st();
      await check("R2c 勾選失敗：回滾為未勾、進度回 2 / 5、提示「無法更新打包狀態」", () => {
        assert.equal(s.cats[1].items[0].checked, "false");
        assert.equal(s.progress, "已打包 2 / 5");
        assert.ok(s.toasts.some((t) => t.kind === "error" && t.m === Z.errorToggle), JSON.stringify(s.toasts));
        assert.equal(s.srvItems.find((i) => i.name === "牙刷").checked, false);
      });
    }
    {
      await mount({ seed: STD });
      await ev("serverPatchItem", "牙刷", { version: 5, is_checked: false, name: "牙刷" });
      const before = await st();
      await ev("toggle", "牙刷");
      await sleep(150);
      const s = await st();
      await ev("toggle", "牙刷");
      await sleep(100);
      const s2 = await st();
      await check("R2d 版本衝突：提示衝突、回滾並重新讀取；之後勾選使用最新版本（5）成功", () => {
        assert.ok(s.toasts.some((t) => t.kind === "error" && t.m === Z.errorConflict), JSON.stringify(s.toasts));
        assert.equal(ensures(s).length, ensures(before).length + 1, "衝突後未重新讀取");
        assert.equal(itemSelects(s).length, itemSelects(before).length + 1);
        const w = writes(s2).at(-1);
        assert.ok(w.filters.some((f) => f[1] === "version" && f[2] === 5), JSON.stringify(w.filters));
        assert.equal(s2.srvItems.find((i) => i.name === "牙刷").checked, true);
        assert.equal(s2.cats[1].items[0].checked, "true");
      });
    }

    // ═══ R3 行內新增 ═══
    {
      await mount({ seed: STD });
      assert.equal(await ev("openAdder", "證件"), "clicked");
      await ev("typeAdd", "證件", "護照");
      const ime1 = await ev("pressEnter", "證件", { composing: true });
      const ime2 = await ev("pressEnter", "證件", { keyCode: 229 });
      await sleep(60);
      const sIme = await st();
      await ev("pressEnter", "證件");
      await sleep(100);
      const s1 = await st();
      const v1 = await ev("adderValue", "證件");
      await ev("typeAdd", "證件", "簽證影本");
      await ev("pressEnter", "證件");
      await sleep(100);
      const s2 = await st();
      await check("R3a 輸入法組字中的 Enter（isComposing／keyCode 229）不送出", () => {
        assert.equal(writes(sIme).length, 0, "組字 Enter 送出了：" + JSON.stringify(writes(sIme)));
        assert.equal(ime1, "dispatched");
        assert.equal(ime2, "dispatched");
      });
      await check("R3b Enter 新增：payload 只有 trip_id/category_id/name/quantity 1/note null/sort_index/client_request_id（uuid v4），清空並保留輸入框可連續新增", () => {
        const ins = writes(s2).filter((w) => w.op === "insert");
        assert.equal(ins.length, 2);
        assert.deepEqual(Object.keys(ins[0].payload).sort(), ["category_id", "client_request_id", "name", "note", "quantity", "sort_index", "trip_id"]);
        assert.equal(ins[0].payload.quantity, 1);
        assert.equal(ins[0].payload.note, null);
        assert.equal(ins[0].payload.name, "護照");
        assert.match(ins[0].payload.client_request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.notEqual(ins[0].payload.client_request_id, ins[1].payload.client_request_id);
        assert.equal(ins[1].payload.sort_index, ins[0].payload.sort_index + 1);
        assert.equal(v1, "", "新增後未清空");
        assert.deepEqual(s2.cats[3].items.map((i) => i.name), ["護照", "簽證影本"]);
        assert.equal(s2.cats[3].progress, "0 / 2");
        assert.equal(s2.progress, "已打包 2 / 7");
        assert.deepEqual(s2.violations, []);
      });
    }
    {
      await mount({ seed: STD, plan: { "insert:packing_items": ["apply-then-network"] } });
      await ev("openAdder", "藥品");
      await ev("typeAdd", "藥品", "暈車藥");
      await ev("pressEnter", "藥品");
      await sleep(100);
      const sFail = await st();
      const kept = await ev("adderValue", "藥品");
      await ev("pressEnter", "藥品");
      await sleep(120);
      const sRetry = await st();
      await check("R3c 回應遺失後重試：保留輸入、沿用同一 client_request_id；23505 查回原列，不重複建立", () => {
        assert.ok(sFail.toasts.some((t) => t.kind === "error" && t.m === Z.errorNetwork), JSON.stringify(sFail.toasts));
        assert.equal(kept, "暈車藥");
        const ins = writes(sRetry).filter((w) => w.op === "insert");
        assert.equal(ins.length, 2);
        assert.equal(ins[1].payload.client_request_id, ins[0].payload.client_request_id, "重試未沿用 client_request_id");
        assert.equal(sRetry.srvItems.filter((i) => i.name === "暈車藥").length, 1, "重複建立");
        const lookup = sRetry.calls.filter((c) => c.kind === "from" && c.op === "select" && c.filters.some((f) => f[1] === "client_request_id"));
        assert.equal(lookup.length, 1, "未以 client_request_id 查回");
        assert.deepEqual(sRetry.cats[4].items.map((i) => i.name), ["暈車藥"]);
        assert.equal(sRetry.toasts.filter((t) => t.kind === "error").length, 1);
      });
      await ev("typeAdd", "藥品", "暈車藥 x");
      await ev("pressEnter", "藥品");
      await sleep(100);
      const sNew = await st();
      await check("R3d 改了文字後是新的請求（新的 client_request_id）", () => {
        const ins = writes(sNew).filter((w) => w.op === "insert");
        assert.notEqual(ins.at(-1).payload.client_request_id, ins[0].payload.client_request_id);
      });
    }
    {
      await mount({ seed: STD, plan: { "insert:packing_items": ["defer"] } });
      await ev("openAdder", "藥品");
      await ev("typeAdd", "藥品", "OK繃");
      await ev("pressEnter", "藥品");
      await sleep(30);
      await ev("pressEnter", "藥品");
      await sleep(30);
      const sDup = await st();
      await ev("typeAdd", "藥品", "口罩");
      await ev("release", 0);
      await sleep(100);
      const after = await ev("adderValue", "藥品");
      const sAfter = await st();
      await check("R3e 送出中再按 Enter 不重送", () => {
        assert.equal(writes(sDup).filter((w) => w.op === "insert").length, 1);
        assert.equal(sAfter.srvItems.filter((i) => i.name === "OK繃").length, 1);
      });
      await check("R3f 連續新增：送出中已輸入的下一個物品名稱，在前一筆成功後不得被清掉", () => {
        assert.equal(after, "口罩", "前一筆成功後把正在輸入的「口罩」清空為 " + JSON.stringify(after));
      });
    }

    // ═══ R4 物品編輯 Sheet ═══
    {
      await mount({ seed: STD });
      await ev("openItem", "襪子");
      await sleep(60);
      const sh = await ev("itemSheet");
      await ev("clickIn", Z.itemSheetTitle, null, Z.quantityIncrease);
      await ev("itemSheetPickCat", "其他");
      await ev("clickIn", Z.itemSheetTitle, Z.save);
      await sleep(120);
      const s = await st();
      await check("R4a 點物品開編輯 Sheet（名稱、數量、分類、備註、刪除）；儲存只送變更欄位＋版本條件；換分類時 sort_index 接在目標分類最後", () => {
        assert.ok(sh && sh.name === "襪子", JSON.stringify(sh));
        for (const t of [Z.nameLabel, Z.quantityLabel, Z.categoryLabel, Z.noteLabel, Z.delete]) assert.ok(sh.text.includes(t), t);
        assert.deepEqual(sh.cats.map((c) => c.text), ["衣物", "盥洗用品", "電子用品", "證件", "藥品", "其他"]);
        const w = writes(s).at(-1);
        assert.deepEqual(Object.keys(w.payload).sort(), ["category_id", "quantity", "sort_index"]);
        assert.equal(w.payload.quantity, 2);
        assert.ok(w.filters.some((f) => f[1] === "version" && f[2] === 1));
        assert.deepEqual(s.cats[5].items.map((i) => [i.name, i.badge]), [["雨傘", null], ["襪子", "×2"]]);
        assert.equal(s.dialogs, 0, "儲存後未關閉");
      });
    }
    {
      await mount({ seed: STD });
      await ev("openItem", "牙刷");
      await sleep(60);
      await ev("serverPatchItem", "牙刷", { version: 3, note: "旅行用" });
      await ev("clickIn", Z.itemSheetTitle, null, Z.quantityIncrease);
      await ev("clickIn", Z.itemSheetTitle, Z.save);
      await sleep(200);
      const sh = await ev("itemSheet");
      const s = await st();
      await ev("clickIn", Z.itemSheetTitle, null, Z.quantityIncrease);
      await ev("clickIn", Z.itemSheetTitle, Z.save);
      await sleep(150);
      const s2 = await st();
      await check("R4b 編輯時版本衝突：重新讀取、Sheet 以最新資料重建並提示；下一次儲存使用最新版本", () => {
        assert.ok(sh, "衝突後 Sheet 被關閉");
        assert.deepEqual(sh.status, [Z.conflictReloaded]);
        assert.ok(sh.text.includes("旅行用"), "未載入最新備註");
        assert.equal(ensures(s).length, 2);
        const w = writes(s2).at(-1);
        assert.ok(w.filters.some((f) => f[1] === "version" && f[2] === 3), JSON.stringify(w.filters));
        assert.equal(s2.srvItems.find((i) => i.name === "牙刷").qty, 2);
        assert.equal(s2.srvItems.find((i) => i.name === "牙刷").note, "旅行用");
      });
    }
    {
      await mount({ seed: STD });
      await ev("openItem", "雨傘");
      await sleep(60);
      await ev("clickIn", Z.itemSheetTitle, Z.delete);
      await sleep(120);
      const s = await st();
      await ev("toastAction", s.toasts.length - 1);
      await sleep(150);
      const s2 = await st();
      await check("R4c 刪除物品：軟刪除（update deleted_at）、6 秒「復原」→ 恢復", () => {
        const w = writes(s).at(-1);
        assert.equal(w.op, "update");
        assert.deepEqual(Object.keys(w.payload), ["deleted_at"]);
        assert.ok(w.payload.deleted_at);
        assert.ok(s.srvItems.find((i) => i.name === "雨傘").deleted);
        assert.equal(s.cats[5].items.length, 0);
        const t = s.toasts.at(-1);
        assert.deepEqual([t.m, t.duration, t.action], [fmt(Z.itemDeleted, { name: "雨傘" }), 6000, Z.undo]);
        assert.equal(writes(s2).at(-1).payload.deleted_at, null);
        assert.equal(s2.srvItems.find((i) => i.name === "雨傘").deleted, null);
        assert.deepEqual(s2.cats[5].items.map((i) => i.name), ["雨傘"]);
      });
    }

    // ═══ R5 刪除分類 ═══
    const openCats = async () => {
      assert.equal(await ev("clickIn", "header", Z.editCategories), "clicked");
      await sleep(80);
    };
    {
      await mount({ seed: STD });
      await openCats();
      await ev("catSheetRow", "證件", "delete");
      await sleep(80);
      const a = await ev("alertState");
      await ev("clickIn", "alert", Z.confirmDelete);
      await sleep(120);
      const s = await st();
      await ev("toastAction", s.toasts.length - 1);
      await sleep(150);
      const s2 = await st();
      await check("R5a 空分類：確認後軟刪除（一個 update deleted_at）、6 秒復原 → 分類回來", () => {
        assert.ok(a && a.text.includes(Z.deleteCategoryEmptyBody), JSON.stringify(a));
        const w = writes(s).filter((x) => x.op === "update");
        assert.equal(w.length, 1);
        assert.equal(w[0].t, "packing_categories");
        assert.deepEqual(Object.keys(w[0].payload), ["deleted_at"]);
        assert.ok(!s.cats.some((c) => c.label === "證件"));
        const t = s.toasts.at(-1);
        assert.deepEqual([t.m, t.duration, t.action], [fmt(Z.categoryDeleted, { name: "證件" }), 6000, Z.undo]);
        assert.ok(s2.cats.some((c) => c.label === "證件"), "復原後分類未出現");
        assert.equal(s2.srvCats.find((c) => c.key === "documents").deleted, null);
      });
    }
    {
      await mount({ seed: { ...STD, items: [...STD.items, { cat: "clothing", name: "外套", quantity: 1 }] } });
      await openCats();
      await ev("catSheetRow", "衣物", "delete");
      await sleep(80);
      const a = await ev("alertState");
      await ev("clickIn", "alert", Z.confirmDelete);
      await sleep(200);
      const s = await st();
      const before = s.srvItems.filter((i) => ["T恤", "襪子", "外套"].includes(i.name));
      await ev("toastAction", s.toasts.length - 1);
      await sleep(250);
      const s2 = await st();
      await check("R5b 有物品：寫出物品數；預設「移到其他分類」、目標預設「其他」", () => {
        assert.ok(a.text.includes(fmt(Z.deleteCategoryItemsBody, { count: 3 })), a.text);
        assert.deepEqual(a.radios, [true, false]);
        assert.equal(a.select.options.find((o) => o.value === a.select.value).text, "其他");
        assert.deepEqual(a.select.options.map((o) => o.text), ["盥洗用品", "電子用品", "證件", "藥品", "其他"]);
      });
      await check("R5c 移到其他分類：先逐件 update 物品（category_id＋sort_index 接在目標後面），最後才軟刪除分類；物品未被刪除", () => {
        const w = writes(s).filter((x) => x.op === "update");
        assert.deepEqual(w.map((x) => x.t), ["packing_items", "packing_items", "packing_items", "packing_categories"], "送出順序");
        const otherId = s.srvCats.find((c) => c.key === "other").id;
        assert.ok(w.slice(0, 3).every((x) => x.payload.category_id === otherId));
        assert.deepEqual(w.slice(0, 3).map((x) => x.payload.sort_index), [5, 6, 7]);
        assert.ok(before.every((i) => i.cat === otherId && !i.deleted), JSON.stringify(before));
        assert.ok(s.srvCats.find((c) => c.key === "clothing").deleted);
        assert.deepEqual(s.cats.find((c) => c.label === "其他").items.map((i) => i.name), ["雨傘", "T恤", "襪子", "外套"]);
        assert.equal(s.progress, "已打包 2 / 6");
        const t = s.toasts.at(-1);
        assert.deepEqual([t.m, t.duration, t.action], [fmt(Z.categoryDeletedMoved, { name: "衣物", target: "其他" }), 6000, Z.undo]);
      });
      await check("R5d 移動後 6 秒復原：分類恢復、物品移回原分類與原順序", () => {
        const clothingId = s2.srvCats.find((c) => c.key === "clothing").id;
        assert.equal(s2.srvCats.find((c) => c.key === "clothing").deleted, null);
        const back = s2.srvItems.filter((i) => ["T恤", "襪子", "外套"].includes(i.name));
        assert.ok(back.every((i) => i.cat === clothingId && !i.deleted), JSON.stringify(back));
        assert.deepEqual(s2.cats[0].items.map((i) => i.name), ["T恤", "襪子", "外套"]);
        assert.deepEqual(s2.cats.find((c) => c.label === "其他").items.map((i) => i.name), ["雨傘"]);
      });
    }
    {
      await mount({ seed: STD });
      await openCats();
      await ev("catSheetRow", "其他", "delete");
      await sleep(80);
      const a = await ev("alertState");
      await check("R5e 刪除的就是「其他」：目標預設排序第一個分類（衣物）", () => {
        assert.equal(a.select.options.find((o) => o.value === a.select.value).text, "衣物");
      });
      await ev("alertPick", 1);
      await sleep(30);
      const a2 = await ev("alertState");
      await ev("clickIn", "alert", Z.confirmDelete);
      await sleep(60);
      const a3 = await ev("alertState");
      const sMid = await st();
      await ev("clickIn", "alert", Z.confirmDelete);
      await sleep(200);
      const s = await st();
      await ev("toastAction", s.toasts.length - 1);
      await sleep(200);
      const s2 = await st();
      await check("R5f 連同物品一起刪除：需再確認一次；送出只有 1 個分類 update（伺服器連帶軟刪除物品，同一時間戳）", () => {
        assert.deepEqual(a2.radios, [false, true]);
        assert.ok(a3 && a3.text.includes(fmt(Z.deleteWithItemsConfirmTitleOne, { count: 1 })), JSON.stringify(a3));
        assert.equal(writes(sMid).length, 0, "第一次確認就送出");
        const w = writes(s);
        assert.equal(w.length, 1);
        assert.equal(w[0].t, "packing_categories");
        const cat = s.srvCats.find((c) => c.key === "other");
        assert.ok(cat.deleted);
        assert.equal(s.srvItems.find((i) => i.name === "雨傘").deleted, cat.deleted);
        assert.ok(!s.cats.some((c) => c.label === "其他"));
        assert.equal(s.progress, "已打包 2 / 4");
        assert.deepEqual([s.toasts.at(-1).duration, s.toasts.at(-1).action], [6000, Z.undo]);
      });
      await check("R5g 連同物品刪除後復原：分類與物品一起恢復", () => {
        assert.equal(s2.srvCats.find((c) => c.key === "other").deleted, null);
        assert.equal(s2.srvItems.find((i) => i.name === "雨傘").deleted, null);
        assert.deepEqual(s2.cats.find((c) => c.label === "其他").items.map((i) => i.name), ["雨傘"]);
      });
    }
    {
      await mount({ seed: { cats: [{ name: "相機", icon: "Camera", sort: 0 }], items: [{ cat: "相機", name: "鏡頭" }] } });
      await openCats();
      await ev("catSheetRow", "相機", "delete");
      await sleep(80);
      const a = await ev("alertState");
      await check("R5h 只剩一個分類：沒有「移到」選項，直接預設「連同物品一起刪除」", () => {
        assert.deepEqual(a.radios, [true]);
        assert.equal(a.select, null);
        assert.ok(a.text.includes(Z.deleteWithItemsOption));
      });
    }
    {
      await mount({ seed: STD, plan: { "update:packing_items": ["ok", { error: "TypeError: Failed to fetch", code: "" }] } });
      await openCats();
      await ev("catSheetRow", "衣物", "delete");
      await sleep(80);
      await ev("clickIn", "alert", Z.confirmDelete);
      await sleep(250);
      const s = await st();
      await check("R5i 移動中途失敗：不刪除分類（未移走的物品不會被連帶刪除）、提示錯誤並重讀", () => {
        assert.equal(s.srvCats.find((c) => c.key === "clothing").deleted, null, "中途失敗仍刪除了分類");
        assert.ok(!writes(s).some((w) => w.t === "packing_categories"));
        assert.ok(s.srvItems.every((i) => !i.deleted));
        assert.ok(s.toasts.some((t) => t.kind === "error"));
        assert.ok(ensures(s).length >= 2, "失敗後未重讀");
        assert.ok(s.dialogs >= 1, "失敗後對話框應保留");
      });
      const moved = s.srvItems.filter((i) => i.cat !== s.srvCats.find((c) => c.key === "clothing").id && ["T恤", "襪子"].includes(i.name)).map((i) => i.name);
      info("R5i 中途失敗時已移走、未自動移回的物品：" + JSON.stringify(moved) + "；提示文字：" + JSON.stringify(s.toasts.filter((t) => t.kind === "error").map((t) => t.m)));
    }

    // ═══ R6 全刪後新增重建「其他」 ═══
    {
      await mount({ seed: { defaults: true, deleteKeys: ["clothing", "toiletries", "electronics", "documents", "medicine", "other"] } });
      const s0 = await st();
      assert.equal(await ev("openAdder", null), "clicked");
      await ev("typeAdd", "其他", "行動電源");
      await ev("pressEnter", "其他");
      await sleep(200);
      const s = await st();
      const reopened = await ev("adderValue", "其他");
      await check("R6a 全部分類刪除後：ensure 不重建（空狀態）；新增物品先呼叫 ensure_my_packing_other_category 復原「其他」再新增；輸入框留在「其他」", () => {
        assert.equal(s0.cats.length, 0);
        assert.ok(s0.text.includes(Z.emptyTitle));
        const rpcs = s.calls.filter((c) => c.kind === "rpc").map((c) => c.n);
        assert.ok(rpcs.includes("ensure_my_packing_other_category"));
        const order = s.calls.filter((c) => (c.kind === "rpc" && c.n === "ensure_my_packing_other_category") || (c.kind === "from" && c.op === "insert")).map((c) => c.n ?? c.op);
        assert.deepEqual(order, ["ensure_my_packing_other_category", "insert"]);
        assert.deepEqual(s.cats.map((c) => c.label), ["其他"]);
        assert.deepEqual(s.cats[0].items.map((i) => i.name), ["行動電源"]);
        assert.equal(s.srvCats.filter((c) => !c.deleted).length, 1);
        assert.equal(s.srvCats.length, 6, "新建了重複的「其他」");
        assert.equal(reopened, "", "新增後輸入框未留在「其他」");
      });
    }
    {
      await mount({ seed: { defaults: true, deleteKeys: ["clothing", "toiletries", "electronics", "documents", "medicine", "other"] }, plan: { "insert:packing_items": ["apply-then-network"] } });
      await ev("openAdder", null);
      await ev("typeAdd", "其他", "行動電源");
      await ev("pressEnter", "其他");
      await sleep(200);
      const s1 = await st();
      const draftAfterFail = await ev("adderValue", "其他");
      // 使用者看到「其他」分類出現、原輸入框消失 → 在「其他」重新輸入同一名稱再送出
      if (draftAfterFail == null) {
        await ev("openAdder", "其他");
        await ev("typeAdd", "其他", "行動電源");
      }
      await ev("pressEnter", "其他");
      await sleep(200);
      const s2 = await st();
      await check("R6b 空狀態新增時回應遺失：重試不得重複建立（client_request_id 應沿用）", () => {
        assert.ok(s1.toasts.some((t) => t.kind === "error"));
        const ins = writes(s2).filter((w) => w.op === "insert");
        assert.equal(s2.srvItems.filter((i) => i.name === "行動電源" && !i.deleted).length, 1,
          "重試建立了重複物品（失敗後空狀態輸入框消失、草稿＝" + JSON.stringify(draftAfterFail) + "；兩次 client_request_id " + (ins[0]?.payload.client_request_id === ins[1]?.payload.client_request_id ? "相同" : "不同") + "）");
      });
    }

    // ═══ 第 2 輪補測（#TW5-T2）═══
    const EMPTY_ALL = { defaults: true, deleteKeys: ["clothing", "toiletries", "electronics", "documents", "medicine", "other"] };
    const inserts = (s) => writes(s).filter((w) => w.op === "insert");
    const crLookups = (s) => s.calls.filter((c) => c.kind === "from" && c.op === "select" && c.filters.some((f) => f[1] === "client_request_id"));
    const ensureOthers = (s) => s.calls.filter((c) => c.kind === "rpc" && c.n === "ensure_my_packing_other_category");
    const errToasts = (s) => s.toasts.filter((t) => t.kind === "error").map((t) => t.m);
    const targetName = (s, w) => {
      const f = w.filters.find((x) => x[0] === "eq" && x[1] === "id");
      const it = s.srvItems.find((i) => i.id === f?.[2]);
      if (it) return it.name;
      const c = s.srvCats.find((x) => x.id === f?.[2]);
      return c ? "cat:" + (c.key ?? c.name) : "?";
    };
    const step = async (r, label) => assert.ok(r === "clicked" || r === "set" || r === "picked" || r === "dispatched" || r === "prevented" || r === true, label + " → " + JSON.stringify(r));

    // T2-1a：ensure 成功、insert 尚未回應 → 立即轉到「其他」；insert 回應遺失（伺服器已寫入）→ 在「其他」重試，沿用同一 id，伺服器只有 1 筆
    await check("T2-1a 空狀態：ensure 成功即把草稿轉到「其他」並開啟輸入框（不等 insert）；insert 回應遺失後在「其他」直接重試，同一 client_request_id、伺服器 1 筆、成功後清空", async () => {
      await mount({ seed: EMPTY_ALL, plan: { "insert:packing_items": ["defer"] } });
      await step(await ev("openAdder", null), "openAdder(empty)");
      await step(await ev("typeAdd", "其他", "行動電源"), "type");
      await step(await ev("pressEnter", "其他"), "enter");
      await sleep(150);
      const sMid = await st();
      const midDraft = await ev("adderValue", "其他");
      assert.equal(inserts(sMid).length, 1, "insert 應已送出並等待中");
      assert.equal(sMid.srvItems.length, 0);
      assert.ok(!sMid.text.includes(Z.emptyTitle), "ensure 成功後仍顯示空狀態");
      assert.deepEqual(sMid.cats.map((c) => c.label), ["其他"]);
      assert.equal(midDraft, "行動電源", "insert 進行中「其他」輸入框未帶入草稿：" + JSON.stringify(midDraft));
      assert.equal(await ev("release", 0, "apply-then-network"), true);
      await sleep(150);
      const sFail = await st();
      const failDraft = await ev("adderValue", "其他");
      assert.ok(errToasts(sFail).includes(Z.errorNetwork), JSON.stringify(sFail.toasts));
      assert.equal(failDraft, "行動電源", "失敗後「其他」輸入框草稿＝" + JSON.stringify(failDraft) + "（應不需重新開啟／重打）");
      await step(await ev("pressEnter", "其他"), "retry enter");
      await sleep(200);
      const s = await st();
      const ins = inserts(s);
      assert.equal(ins.length, 2);
      assert.equal(ins[1].payload.client_request_id, ins[0].payload.client_request_id, "重試未沿用 client_request_id");
      assert.equal(ins[1].payload.name, "行動電源");
      assert.equal(s.srvItems.filter((i) => i.name === "行動電源" && !i.deleted).length, 1, "伺服器重複建立");
      assert.equal(crLookups(s).length, 1, "23505 後未以 client_request_id 查回");
      assert.equal(ensureOthers(s).length, 1, "重試不應再呼叫 ensure_other（已有「其他」）");
      assert.deepEqual(s.cats.map((c) => [c.label, c.items.map((i) => i.name)]), [["其他", ["行動電源"]]]);
      assert.equal(await ev("adderValue", "其他"), "", "成功後未清空");
      assert.equal(s.srvCats.length, 6, "新建了重複的「其他」");
      assert.deepEqual(s.violations, []);
    });

    await check("T2-1b 空狀態：ensure_other 網路失敗 → 仍在空狀態、保留草稿、未送 insert；重試 → ensure＋insert 各成功 1 次、伺服器 1 筆", async () => {
      await mount({ seed: EMPTY_ALL, plan: { "rpc:ensure_my_packing_other_category": ["network"] } });
      await step(await ev("openAdder", null), "openAdder(empty)");
      await ev("typeAdd", "其他", "轉接頭");
      await ev("pressEnter", "其他");
      await sleep(150);
      const s1 = await st();
      assert.equal(s1.cats.length, 0);
      assert.ok(s1.text.includes(Z.emptyTitle));
      assert.equal(inserts(s1).length, 0, "ensure 失敗仍送 insert");
      assert.ok(errToasts(s1).includes(Z.errorNetwork), JSON.stringify(s1.toasts));
      assert.equal(await ev("adderValue", "其他"), "轉接頭", "ensure 失敗後草稿遺失");
      await ev("pressEnter", "其他");
      await sleep(200);
      const s2 = await st();
      assert.equal(ensureOthers(s2).length, 2);
      assert.equal(inserts(s2).length, 1);
      assert.equal(s2.srvItems.filter((i) => i.name === "轉接頭").length, 1);
      assert.equal(s2.srvCats.filter((c) => !c.deleted).length, 1);
      assert.equal(s2.srvCats.length, 6);
      assert.deepEqual(s2.cats.map((c) => [c.label, c.items.map((i) => i.name)]), [["其他", ["轉接頭"]]]);
      assert.equal(await ev("adderValue", "其他"), "");
    });

    await check("T2-1c 空狀態：ensure_other 伺服器已復原「其他」但回應遺失 → 重試不重複建立分類，物品 1 筆", async () => {
      await mount({ seed: EMPTY_ALL, plan: { "rpc:ensure_my_packing_other_category": ["apply-then-network"] } });
      await step(await ev("openAdder", null), "openAdder(empty)");
      await ev("typeAdd", "其他", "耳塞");
      await ev("pressEnter", "其他");
      await sleep(150);
      const s1 = await st();
      assert.equal(inserts(s1).length, 0);
      const d1 = await ev("adderValue", "其他");
      assert.equal(d1, "耳塞", "草稿遺失");
      await ev("pressEnter", "其他");
      await sleep(200);
      const s2 = await st();
      assert.equal(s2.srvCats.length, 6, "建立了重複的「其他」");
      assert.equal(s2.srvCats.filter((c) => !c.deleted).length, 1);
      assert.equal(s2.srvItems.filter((i) => i.name === "耳塞").length, 1);
      assert.deepEqual(s2.cats.map((c) => [c.label, c.items.map((i) => i.name)]), [["其他", ["耳塞"]]]);
    });

    await check("T2-1d 空狀態：insert 被拒（23514）→ 提示對應錯誤、草稿留在「其他」輸入框；文字不變重試沿用同一 id、伺服器 1 筆", async () => {
      await mount({ seed: EMPTY_ALL, plan: { "insert:packing_items": [{ error: 'new row for relation "packing_items" violates check constraint "packing_items_name_check"', code: "23514" }] } });
      await step(await ev("openAdder", null), "openAdder(empty)");
      await ev("typeAdd", "其他", "牙線");
      await ev("pressEnter", "其他");
      await sleep(150);
      const s1 = await st();
      const ERR = await evaluate("window.ERRMSG['zh-TW']");
      assert.ok(errToasts(s1).includes(ERR.packing_item_name_invalid), JSON.stringify(s1.toasts));
      assert.deepEqual(s1.cats.map((c) => c.label), ["其他"]);
      assert.equal(s1.srvItems.length, 0);
      assert.equal(await ev("adderValue", "其他"), "牙線", "23514 後「其他」輸入框無草稿");
      await ev("pressEnter", "其他");
      await sleep(200);
      const s2 = await st();
      const ins = inserts(s2);
      assert.equal(ins.length, 2);
      assert.equal(ins[1].payload.client_request_id, ins[0].payload.client_request_id);
      assert.equal(s2.srvItems.filter((i) => i.name === "牙線").length, 1);
      assert.equal(ensureOthers(s2).length, 1);
    });

    await check("T2-1e 空狀態：「其他」刪除前被摺疊 → 空狀態新增失敗後，草稿所在的「其他」輸入框仍可見（不被摺疊藏起）", async () => {
      await mount({ seed: { defaults: true, deleteKeys: ["clothing", "toiletries", "electronics", "documents", "medicine"] }, plan: { "insert:packing_items": ["network"] } });
      await step(await ev("toggleSection", "其他"), "collapse 其他");
      await openCats();
      await step(await ev("catSheetRow", "其他", "delete"), "delete 其他");
      await sleep(80);
      await step(await ev("clickIn", "alert", Z.confirmDelete), "confirm");
      await sleep(200);
      const s0 = await st();
      assert.ok(s0.text.includes(Z.emptyTitle), "未進入空狀態");
      await step(await ev("openAdder", null), "openAdder(empty)");
      await ev("typeAdd", "其他", "頸枕");
      await ev("pressEnter", "其他");
      await sleep(200);
      const s1 = await st();
      assert.equal(inserts(s1).length, 1);
      const draft = await ev("adderValue", "其他");
      assert.equal(draft, "頸枕", "復原的「其他」沿用先前摺疊狀態，草稿輸入框不可見（adderValue＝" + JSON.stringify(draft) + "，expanded＝" + JSON.stringify(s1.cats.map((c) => c.expanded)) + "）");
    });

    // T2-2：連續新增
    await check("T2-2a 連續新增：送出中輸入下一筆 → 前一筆成功不清空、下一筆取得新 id；之後再打回同名（新物品）也取得新 id，不被 23505 吞掉", async () => {
      await mount({ seed: STD, plan: { "insert:packing_items": ["defer"] } });
      await step(await ev("openAdder", "藥品"), "openAdder");
      await ev("typeAdd", "藥品", "口罩");
      await ev("pressEnter", "藥品");
      await sleep(40);
      await ev("typeAdd", "藥品", "酒精棉");
      assert.equal(await ev("release", 0), true);
      await sleep(120);
      const vB = await ev("adderValue", "藥品");
      assert.equal(vB, "酒精棉", "送出中輸入的下一筆被清掉");
      await ev("pressEnter", "藥品");
      await sleep(120);
      assert.equal(await ev("adderValue", "藥品"), "");
      await ev("typeAdd", "藥品", "口罩");
      await ev("pressEnter", "藥品");
      await sleep(150);
      await ev("typeAdd", "藥品", "  口罩 ");
      await ev("pressEnter", "藥品");
      await sleep(150);
      const s = await st();
      const ins = inserts(s);
      assert.deepEqual(ins.map((w) => w.payload.name), ["口罩", "酒精棉", "口罩", "口罩"]);
      assert.equal(new Set(ins.map((w) => w.payload.client_request_id)).size, 4, "client_request_id 重複：" + JSON.stringify(ins.map((w) => w.payload.client_request_id)));
      assert.equal(crLookups(s).length, 0, "出現 23505 查回（被當成重複吞掉）");
      assert.equal(s.srvItems.filter((i) => i.name === "口罩").length, 3);
      assert.deepEqual(s.cats.find((c) => c.label === "藥品").items.map((i) => i.name), ["口罩", "酒精棉", "口罩", "口罩"]);
      assert.equal(await ev("adderValue", "藥品"), "");
    });

    await check("T2-2b 前一筆失敗時：送出中輸入的下一筆保留、下一筆取得新 id；原名稱重試仍沿用原 id（不重複）", async () => {
      await mount({ seed: STD, plan: { "insert:packing_items": ["defer"] } });
      await ev("openAdder", "藥品");
      await ev("typeAdd", "藥品", "眼藥水");
      await ev("pressEnter", "藥品");
      await sleep(40);
      await ev("typeAdd", "藥品", "眼藥水");
      await ev("release", 0, "apply-then-network");
      await sleep(120);
      assert.equal(await ev("adderValue", "藥品"), "眼藥水");
      await ev("pressEnter", "藥品");
      await sleep(150);
      const s = await st();
      const ins = inserts(s);
      assert.equal(ins.length, 2);
      assert.equal(ins[1].payload.client_request_id, ins[0].payload.client_request_id);
      assert.equal(s.srvItems.filter((i) => i.name === "眼藥水").length, 1);
    });

    // T2-3：「移到其他分類」中途失敗
    const SEED3 = { defaults: true, items: [
      { cat: "clothing", name: "T恤", sort: 0 },
      { cat: "clothing", name: "襪子", sort: 1 },
      { cat: "clothing", name: "外套", sort: 2 },
      { cat: "other", name: "雨傘", sort: 0 },
      { cat: "medicine", name: "暈車藥", sort: 0 },
    ] };
    const CLOTHES = ["T恤", "襪子", "外套"];
    const startDeleteMove = async (l = "zh-TW") => {
      await step(await ev("clickIn", "header", COPY[l].editCategories), "open categories");
      await sleep(80);
      await step(await ev("catSheetRow", COPY[l].defaultClothing, "delete"), "delete clothing");
      await sleep(80);
      await step(await ev("clickIn", "alert", COPY[l].confirmDelete), "confirm");
    };
    const catId = (s, key) => s.srvCats.find((c) => c.key === key).id;
    const assertAllBack = (s, label) => {
      const cid = catId(s, "clothing");
      assert.equal(s.srvCats.find((c) => c.key === "clothing").deleted, null, label + "：分類未復原");
      const back = CLOTHES.map((n) => s.srvItems.find((i) => i.name === n));
      assert.deepEqual(back.map((i) => [i.name, i.cat === cid ? "clothing" : (s.srvCats.find((c) => c.id === i.cat) || {}).key, i.sort, !!i.deleted]),
        [["T恤", "clothing", 0, false], ["襪子", "clothing", 1, false], ["外套", "clothing", 2, false]], label + "：伺服器物品未全部回到原分類原排序");
      assert.deepEqual(s.cats[0].items.map((i) => i.name), CLOTHES, label + "：畫面順序");
      assert.deepEqual(s.cats.find((c) => c.label === "其他").items.map((i) => i.name), ["雨傘"], label + "：其他");
      assert.deepEqual(s.cats.find((c) => c.label === "藥品").items.map((i) => i.name), ["暈車藥"], label + "：藥品");
    };

    await check("T2-3a 中途網路失敗（已移 1 件）→ 提示「已移動 1 件到〈其他〉」、分類未刪、不自動移回；重試只移剩下 2 件並刪除分類；復原後 3 件全部回原分類原排序", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network"] } });
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      assert.equal(errToasts(s1).at(-1), fmt(Z.errorMovePartialNetwork, { count: 1, target: "其他" }), JSON.stringify(errToasts(s1)));
      assert.equal(s1.srvCats.find((c) => c.key === "clothing").deleted, null);
      assert.equal(s1.srvItems.find((i) => i.name === "T恤").cat, catId(s1, "other"), "已移走的 T恤 被自動移回");
      assert.ok(["襪子", "外套"].every((n) => s1.srvItems.find((i) => i.name === n).cat === catId(s1, "clothing")));
      const a1 = await ev("alertState");
      assert.ok(a1 && a1.text.includes(fmt(Z.deleteCategoryItemsBody, { count: 2 })), "對話框未保留或件數未更新：" + JSON.stringify(a1 && a1.text));
      const n1 = writes(s1).length;
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry confirm");
      await sleep(300);
      const s2 = await st();
      const retry = writes(s2).slice(n1);
      assert.deepEqual(retry.map((w) => targetName(s2, w)), ["襪子", "外套", "cat:clothing"], "重試送出的寫入");
      assert.deepEqual(retry.slice(0, 2).map((w) => w.payload.sort_index), [2, 3], "重試 sort_index 應接在目標（雨傘 0、T恤 1）之後");
      assert.ok(s2.srvCats.find((c) => c.key === "clothing").deleted);
      assert.deepEqual(s2.cats.find((c) => c.label === "其他").items.map((i) => i.name), ["雨傘", "T恤", "襪子", "外套"]);
      const t = s2.toasts.at(-1);
      assert.deepEqual([t.m, t.action], [fmt(Z.categoryDeletedMoved, { name: "衣物", target: "其他" }), Z.undo]);
      const nErr = errToasts(s2).length;
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      const s3 = await st();
      assertAllBack(s3, "復原");
      assert.equal(errToasts(s3).length, nErr, "復原出現錯誤：" + JSON.stringify(errToasts(s3)));
      assert.deepEqual(s3.violations, []);
    });

    await check("T2-3b 中途版本衝突（已移 2 件）→「物品剛被修改，已移動 2 件」；重試只移 1 件（使用最新版本）；復原全部回原位", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "ok", "defer"] } });
      await startDeleteMove();
      await sleep(150);
      await ev("serverPatchItem", "外套", { version: 7 });
      assert.equal(await ev("release", 0), true);
      await sleep(300);
      const s1 = await st();
      assert.equal(errToasts(s1).at(-1), fmt(Z.errorMovePartialConflict, { count: 2, target: "其他" }), JSON.stringify(errToasts(s1)));
      assert.equal(s1.srvCats.find((c) => c.key === "clothing").deleted, null);
      const n1 = writes(s1).length;
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry confirm");
      await sleep(300);
      const s2 = await st();
      const retry = writes(s2).slice(n1);
      assert.deepEqual(retry.map((w) => targetName(s2, w)), ["外套", "cat:clothing"]);
      assert.ok(retry[0].filters.some((f) => f[1] === "version" && f[2] === 7), "重試未使用最新版本");
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      assertAllBack(await st(), "復原");
    });

    await check("T2-3c 中途其他錯誤（已移 1 件）→「移動中斷，已移動 1 件」；一件都沒移走時維持原提示（網路→errorNetwork、衝突→errorMoveFailed）", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", { error: "boom", code: "XX000" }] } });
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      assert.equal(errToasts(s1).at(-1), fmt(Z.errorMovePartial, { count: 1, target: "其他" }), JSON.stringify(errToasts(s1)));

      await mount({ seed: SEED3, plan: { "update:packing_items": ["network"] } });
      await startDeleteMove();
      await sleep(300);
      const s2 = await st();
      assert.equal(errToasts(s2).at(-1), Z.errorNetwork, JSON.stringify(errToasts(s2)));
      assert.ok(CLOTHES.every((n) => s2.srvItems.find((i) => i.name === n).cat === catId(s2, "clothing")));

      await mount({ seed: SEED3, plan: { "update:packing_items": ["defer"] } });
      await startDeleteMove();
      await sleep(150);
      await ev("serverPatchItem", "T恤", { version: 4 });
      await ev("release", 0);
      await sleep(300);
      const s3 = await st();
      assert.equal(errToasts(s3).at(-1), Z.errorMoveFailed, JSON.stringify(errToasts(s3)));
    });

    await check("T2-3d 重試失敗再失敗：N 為累計已移到同一目標的件數（1 → 2）；最後成功後復原全部回原位", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network", "ok", "network"] } });
      await startDeleteMove();
      await sleep(300);
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry1");
      await sleep(300);
      const s2 = await st();
      assert.deepEqual(errToasts(s2).slice(-2), [fmt(Z.errorMovePartialNetwork, { count: 1, target: "其他" }), fmt(Z.errorMovePartialNetwork, { count: 2, target: "其他" })]);
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry2");
      await sleep(300);
      const s3 = await st();
      assert.ok(s3.srvCats.find((c) => c.key === "clothing").deleted);
      await ev("toastAction", s3.toasts.length - 1);
      await sleep(300);
      assertAllBack(await st(), "復原");
    });

    await check("T2-3e 重試改選不同目標（第一次移到「其他」、重試移到「藥品」）→ 提示件數只算該目標；復原時兩邊移走的物品都回原分類原排序", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network"] } });
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      await step(await ev("alertSelect", catId(s1, "medicine")), "select 藥品");
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry");
      await sleep(300);
      const s2 = await st();
      assert.ok(s2.srvCats.find((c) => c.key === "clothing").deleted);
      assert.deepEqual(s2.cats.find((c) => c.label === "藥品").items.map((i) => i.name), ["暈車藥", "襪子", "外套"]);
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      assertAllBack(await st(), "復原");
    });

    await check("T2-3f 失敗那一件其實已寫入（回應遺失）→ 重試後刪除、復原：所有物品（含回應遺失那件）都回原分類原排序", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "apply-then-network"] } });
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      info("T2-3f 回應遺失時提示：" + JSON.stringify(errToasts(s1).at(-1)) + "；伺服器實際已移到「其他」：" + JSON.stringify(s1.srvItems.filter((i) => i.cat === catId(s1, "other")).map((i) => i.name)));
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry");
      await sleep(300);
      const s2 = await st();
      assert.ok(s2.srvCats.find((c) => c.key === "clothing").deleted);
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      assertAllBack(await st(), "復原");
    });

    await check("T2-3g 部分移動失敗後取消對話框、使用者再手動把已移走的 T恤 改到「藥品」；之後刪除＋復原不得把 T恤 從「藥品」拉回", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network"] } });
      await startDeleteMove();
      await sleep(300);
      await step(await ev("clickIn", "alert", Z.cancel), "cancel");
      await sleep(100);
      await step(await ev("openItem", "T恤"), "open T恤");
      await sleep(80);
      await step(await ev("itemSheetPickCat", "藥品"), "pick 藥品");
      await step(await ev("clickIn", Z.itemSheetTitle, Z.save), "save");
      await sleep(200);
      const sMan = await st();
      assert.equal(sMan.srvItems.find((i) => i.name === "T恤").cat, catId(sMan, "medicine"), "手動移動未成功");
      await step(await ev("catSheetRow", "衣物", "delete"), "delete again");
      await sleep(80);
      await step(await ev("clickIn", "alert", Z.confirmDelete), "confirm again");
      await sleep(300);
      const s2 = await st();
      assert.ok(s2.srvCats.find((c) => c.key === "clothing").deleted);
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      const s3 = await st();
      const t = s3.srvItems.find((i) => i.name === "T恤");
      assert.equal((s3.srvCats.find((c) => c.id === t.cat) || {}).key, "medicine", "復原把使用者手動放到「藥品」的 T恤 拉回「衣物」");
    });

    await check("T2-3h 四語系：部分移動三種提示（衝突／網路／其他）文案含件數與目標分類名稱，皆為該語系專屬文案", async () => {
      const kinds = [
        ["errorMovePartialNetwork", { plan: ["ok", "network"], count: 1 }],
        ["errorMovePartial", { plan: ["ok", { error: "boom", code: "XX000" }], count: 1 }],
        ["errorMovePartialConflict", { plan: ["ok", "ok", "defer"], count: 2, conflict: true }],
      ];
      for (const l of ["zh-TW", "en", "ja", "ko"]) {
        const Lc = COPY[l];
        for (const key of ["errorMovePartialConflict", "errorMovePartialNetwork", "errorMovePartial"]) {
          assert.ok(Lc[key] && Lc[key].includes("{count}") && Lc[key].includes("{target}"), l + " " + key + " 缺 {count}/{target}");
          for (const other of ["zh-TW", "en", "ja", "ko"]) if (other !== l) assert.notEqual(Lc[key], COPY[other][key], l + " 與 " + other + " " + key + " 相同（未翻譯）");
        }
        assert.equal(new Set([Lc.errorMovePartialConflict, Lc.errorMovePartialNetwork, Lc.errorMovePartial]).size, 3, l + " 三種文案重複");
        for (const [key, k] of kinds) {
          await mount({ seed: SEED3, locale: l, plan: { "update:packing_items": k.plan } });
          await startDeleteMove(l);
          await sleep(150);
          if (k.conflict) {
            await ev("serverPatchItem", "外套", { version: 9 });
            await ev("release", 0);
          }
          await sleep(250);
          const s = await st();
          assert.equal(errToasts(s).at(-1), fmt(Lc[key], { count: k.count, target: Lc.defaultOther }), l + " " + key + "：" + JSON.stringify(errToasts(s)));
        }
      }
    });

    // ═══ T3（第 3 輪）═══
    const alertBusy = () => evaluate("(function(){const d=document.querySelector('[role=alertdialog]');if(!d)return null;const bs=Array.prototype.slice.call(d.querySelectorAll('button'));return {disabled:bs.filter(function(b){return b.disabled;}).map(function(b){return b.textContent.trim();}),enabled:bs.filter(function(b){return !b.disabled;}).map(function(b){return b.textContent.trim();}),spinner:!!d.querySelector('.animate-spin')};})()");
    const setPlan = (key, list) => evaluate(`(window.__pk.plan[${JSON.stringify(key)}]=${JSON.stringify(list)},true)`);
    const okToasts = (s) => s.toasts.filter((t) => t.kind !== "error");
    const RPC_LOAD = "rpc:ensure_my_packing_categories";

    // T3-4：成功提示說明分散情況（單一／兩個／三個目標，四語系）
    const SEED5 = { defaults: true, items: [
      { cat: "clothing", name: "T恤", sort: 0 },
      { cat: "clothing", name: "襪子", sort: 1 },
      { cat: "clothing", name: "外套", sort: 2 },
      { cat: "clothing", name: "帽子", sort: 3 },
      { cat: "clothing", name: "圍巾", sort: 4 },
    ] };
    const splitActual = {};
    await check("T3-4a 四語系：單一目標（含中途失敗後重試同一目標）維持原文案 categoryDeletedMoved，不出現分散說明", async () => {
      for (const l of ["zh-TW", "en", "ja", "ko"]) {
        const Lc = COPY[l];
        await mount({ seed: SEED3, locale: l, plan: { "update:packing_items": ["ok", "network"] } });
        await startDeleteMove(l);
        await sleep(300);
        await step(await ev("clickIn", "alert", Lc.confirmDelete), l + " retry");
        await sleep(300);
        const s = await st();
        const t = s.toasts.at(-1);
        const want = fmt(Lc.categoryDeletedMoved, { name: Lc.defaultClothing, target: Lc.defaultOther });
        assert.deepEqual([t.m, t.duration, t.action], [want, 6000, Lc.undo], l + "：" + JSON.stringify(t));
        (splitActual[l] ||= {}).single = t.m;
      }
    });

    await check("T3-4b 四語系：兩個目標（1 件先到「其他」、重試改「藥品」）→ categoryDeletedMovedSplit「另有 1 件在『其他』」；復原全部回原位", async () => {
      for (const l of ["zh-TW", "en", "ja", "ko"]) {
        const Lc = COPY[l];
        await mount({ seed: SEED3, locale: l, plan: { "update:packing_items": ["ok", "network"] } });
        await startDeleteMove(l);
        await sleep(300);
        const s1 = await st();
        await step(await ev("alertSelect", catId(s1, "medicine")), l + " select medicine");
        await step(await ev("clickIn", "alert", Lc.confirmDelete), l + " retry");
        await sleep(300);
        const s2 = await st();
        const t = s2.toasts.at(-1);
        const want = fmt(Lc.categoryDeletedMovedSplit, {
          name: Lc.defaultClothing, target: Lc.defaultMedicine,
          others: fmt(Lc.categoryMovedElsewherePart, { count: 1, target: Lc.defaultOther }),
        });
        assert.deepEqual([t.m, t.action], [want, Lc.undo], l + "：" + JSON.stringify(t));
        (splitActual[l] ||= {}).two = t.m;
        if (l === "zh-TW") {
          assert.equal(t.m, "已刪除「衣物」，物品已移到「藥品」，另有 1 件在「其他」", "zh-TW 實際字串與任務單範例不符");
          await ev("toastAction", s2.toasts.length - 1);
          await sleep(300);
          assertAllBack(await st(), "兩個目標復原");
        }
      }
    });

    await check("T3-4c 四語系：三個目標（2 件到「其他」、1 件到「藥品」、其餘到「證件」）→ 依目標分組計件、依移動先後排列、用該語系分隔符連接；復原 5 件全部回原位", async () => {
      for (const l of ["zh-TW", "en", "ja", "ko"]) {
        const Lc = COPY[l];
        assert.ok(typeof Lc.categoryMovedElsewhereSeparator === "string" && Lc.categoryMovedElsewhereSeparator.length > 0, l + " 缺分隔符");
        for (const k of ["categoryDeletedMovedSplit", "categoryMovedElsewherePart"]) {
          for (const other of ["zh-TW", "en", "ja", "ko"]) if (other !== l) assert.notEqual(Lc[k], COPY[other][k], l + " 與 " + other + " " + k + " 相同（未翻譯）");
        }
        await mount({ seed: SEED5, locale: l, plan: { "update:packing_items": ["ok", "ok", "network", "ok", "network", "ok", "ok"] } });
        await startDeleteMove(l);
        await sleep(300);
        const s1 = await st();
        assert.equal(errToasts(s1).at(-1), fmt(Lc.errorMovePartialNetwork, { count: 2, target: Lc.defaultOther }), l + " 第一次：" + JSON.stringify(errToasts(s1)));
        await step(await ev("alertSelect", catId(s1, "medicine")), l + " select medicine");
        await step(await ev("clickIn", "alert", Lc.confirmDelete), l + " retry1");
        await sleep(300);
        const s2 = await st();
        assert.equal(errToasts(s2).at(-1), fmt(Lc.errorMovePartialNetwork, { count: 1, target: Lc.defaultMedicine }), l + " 第二次：" + JSON.stringify(errToasts(s2)));
        await step(await ev("alertSelect", catId(s2, "documents")), l + " select documents");
        await step(await ev("clickIn", "alert", Lc.confirmDelete), l + " retry2");
        await sleep(300);
        const s3 = await st();
        assert.ok(s3.srvCats.find((c) => c.key === "clothing").deleted, l + " 分類未刪除");
        const t = s3.toasts.at(-1);
        const others = [
          fmt(Lc.categoryMovedElsewherePart, { count: 2, target: Lc.defaultOther }),
          fmt(Lc.categoryMovedElsewherePart, { count: 1, target: Lc.defaultMedicine }),
        ].join(Lc.categoryMovedElsewhereSeparator);
        const want = fmt(Lc.categoryDeletedMovedSplit, { name: Lc.defaultClothing, target: Lc.defaultDocuments, others });
        assert.deepEqual([t.m, t.action], [want, Lc.undo], l + "：" + JSON.stringify(t));
        (splitActual[l] ||= {}).three = t.m;
        if (l === "zh-TW") {
          assert.equal(t.m, "已刪除「衣物」，物品已移到「證件」，另有 2 件在「其他」、1 件在「藥品」");
          await ev("toastAction", s3.toasts.length - 1);
          await sleep(400);
          const s4 = await st();
          const cid = catId(s4, "clothing");
          assert.equal(s4.srvCats.find((c) => c.key === "clothing").deleted, null);
          assert.deepEqual(s4.srvItems.map((i) => [i.name, i.cat === cid, i.sort]),
            [["T恤", true, 0], ["襪子", true, 1], ["外套", true, 2], ["帽子", true, 3], ["圍巾", true, 4]], "三個目標復原未全部回原位");
        }
      }
      for (const l of ["zh-TW", "en", "ja", "ko"]) info("T3-4 實際提示 " + l + "：" + JSON.stringify(splitActual[l]));
    });

    // T3-1：失敗後重讀的卡住風險
    await check("T3-1a 部分移動失敗後重讀回傳 null（網路失敗）→「移動中」解除、按鈕可再按、提示以已記錄件數計算；重試成功、復原全部回原位", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network"] } });
      await sleep(150);
      await setPlan(RPC_LOAD, ["network"]);
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      assert.equal(errToasts(s1).at(-1), fmt(Z.errorMovePartialNetwork, { count: 1, target: "其他" }), JSON.stringify(errToasts(s1)));
      const b = await alertBusy();
      assert.ok(b, "對話框被關閉");
      assert.deepEqual([b.disabled, b.spinner], [[], false], "重讀失敗後仍停在移動中：" + JSON.stringify(b));
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry");
      await sleep(300);
      const s2 = await st();
      assert.ok(s2.srvCats.find((c) => c.key === "clothing").deleted);
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      assertAllBack(await st(), "重讀失敗後復原");
    });

    await check("T3-1b 部分移動失敗後重讀被伺服器拒絕（select 錯誤）→「移動中」解除、取消鍵可用（可關閉對話框）", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network"] } });
      await sleep(150);
      await setPlan("select:packing_items", [{ error: "boom", code: "XX000" }]);
      await startDeleteMove();
      await sleep(300);
      const b = await alertBusy();
      assert.deepEqual([b.disabled, b.spinner], [[], false], JSON.stringify(b));
      await step(await ev("clickIn", "alert", Z.cancel), "cancel");
      await sleep(150);
      assert.equal(await ev("alertState"), null, "取消後對話框未關閉");
    });

    await check("T3-1c 回應遺失＋重讀失敗（無法補記）→ N 只算已確認的 1 件；重試時該件版本衝突會再重讀補記，最後復原仍全部回原位", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "apply-then-network"] } });
      await sleep(150);
      await setPlan(RPC_LOAD, ["network"]);
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      assert.equal(errToasts(s1).at(-1), fmt(Z.errorMovePartialNetwork, { count: 1, target: "其他" }), JSON.stringify(errToasts(s1)));
      for (let i = 0; i < 3 && !(await st()).srvCats.find((c) => c.key === "clothing").deleted; i++) {
        await step(await ev("clickIn", "alert", Z.confirmDelete), "retry " + i);
        await sleep(300);
      }
      const s2 = await st();
      assert.ok(s2.srvCats.find((c) => c.key === "clothing").deleted, "多次重試仍未刪除：" + JSON.stringify(errToasts(s2)));
      info("T3-1c 提示序列：" + JSON.stringify(s2.toasts.map((t) => t.m)));
      await ev("toastAction", s2.toasts.length - 1);
      await sleep(300);
      assertAllBack(await st(), "回應遺失＋重讀失敗後復原");
    });

    await check("T3-1d 部分移動失敗後重讀遲遲不回 → 期間維持「移動中」（按鈕與取消皆停用、尚無錯誤提示）；重讀回來後立即解除並補記回應遺失那件", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "apply-then-network"] } });
      await sleep(150);
      await setPlan(RPC_LOAD, ["defer"]);
      await startDeleteMove();
      await sleep(1500);
      const s1 = await st();
      const b1 = await alertBusy();
      assert.ok(b1 && b1.enabled.length === 0 && b1.spinner, "重讀未回時應維持移動中：" + JSON.stringify(b1));
      assert.equal(errToasts(s1).length, 0, "重讀未回已先出提示");
      const di = s1.defers - 1;
      info("T3-1d 重讀延遲 1.5 秒期間：按鈕停用 " + JSON.stringify(b1.disabled) + "，無錯誤提示（使用者看不到失敗原因；client 無逾時，請求永不回應時會一直停在移動中）");
      assert.equal(await ev("release", di), true);
      await sleep(300);
      const s2 = await st();
      const b2 = await alertBusy();
      assert.deepEqual([b2.disabled, b2.spinner], [[], false], "重讀回來後未解除：" + JSON.stringify(b2));
      assert.equal(errToasts(s2).at(-1), fmt(Z.errorMovePartialNetwork, { count: 2, target: "其他" }), JSON.stringify(errToasts(s2)));
    });

    await check("T3-1e 先前移到「其他」的物品後來被其他裝置移回「衣物」，重試改到「藥品」全數成功 → 成功提示不得再宣稱「另有 1 件在『其他』」", async () => {
      await mount({ seed: SEED3, plan: { "update:packing_items": ["ok", "network"] } });
      await startDeleteMove();
      await sleep(300);
      const s1 = await st();
      await ev("serverPatchItem", "T恤", { category_id: catId(s1, "clothing"), sort_index: 0, version: 5 });
      await evaluate("(window.__clock=31000,true)");
      await ev("visible", "visible");
      await sleep(300);
      const s2 = await st();
      assert.ok(s2.cats[0].items.some((i) => i.name === "T恤"), "前景重讀未看到 T恤 回到衣物");
      await step(await ev("alertSelect", catId(s2, "medicine")), "select 藥品");
      await step(await ev("clickIn", "alert", Z.confirmDelete), "retry");
      await sleep(300);
      const s3 = await st();
      assert.ok(s3.srvCats.find((c) => c.key === "clothing").deleted);
      assert.ok(CLOTHES.every((n) => s3.srvItems.find((i) => i.name === n).cat === catId(s3, "medicine")), "3 件應都在藥品");
      assert.equal(okToasts(s3).at(-1).m, fmt(Z.categoryDeletedMoved, { name: "衣物", target: "藥品" }), "成功提示與實際分布不符");
    });

    // ═══ R7 編輯分類 ═══
    {
      await mount({ seed: STD });
      await openCats();
      const labels0 = await ev("catSheetLabels");
      await ev("catSheetRow", "衣物", "rename", "衣物");
      await sleep(60);
      const sSame = await st();
      await ev("catSheetRow", "衣物", "rename", "冬季衣物");
      await sleep(120);
      const s1 = await st();
      await ev("catSheetRow", "盥洗用品", "icon", 7);
      await sleep(120);
      const s2 = await st();
      await ev("catSheetRow", "電子用品", "up");
      await sleep(200);
      const s3 = await st();
      await check("R7a 改名：與目前語系名稱相同不寫入；改名後寫入 name（default_key 不變）並顯示", () => {
        assert.deepEqual(labels0, ["衣物", "盥洗用品", "電子用品", "證件", "藥品", "其他"]);
        assert.equal(writes(sSame).length, 0, "未改名卻寫入");
        const w = writes(s1).at(-1);
        assert.deepEqual(w.payload, { name: "冬季衣物" });
        assert.equal(s1.srvCats.find((c) => c.key === "clothing").name, "冬季衣物");
        assert.equal(s1.cats[0].label, "冬季衣物");
      });
      await check("R7b 換圖示：只送白名單 icon_key；排序：上移只送 sort_index 有變的分類", () => {
        assert.deepEqual(writes(s2).at(-1).payload, { icon_key: "Camera" });
        const w = writes(s3).slice(writes(s2).length);
        assert.deepEqual(w.map((x) => x.payload), [{ sort_index: 1 }, { sort_index: 2 }]);
        assert.deepEqual(s3.cats.map((c) => c.label), ["冬季衣物", "電子用品", "盥洗用品", "證件", "藥品", "其他"]);
        assert.deepEqual(s3.violations, []);
      });
    }

    // ═══ R8 回前景 30 秒節流 ═══
    {
      await mount({ seed: STD });
      const s0 = await st();
      await evaluate("window.__clock=10000");
      await ev("visible", "visible");
      await sleep(80);
      const s1 = await st();
      await evaluate("window.__clock=31000");
      await ev("visible", "hidden");
      await sleep(40);
      const sh = await st();
      await ev("visible", "visible");
      await sleep(120);
      const s2 = await st();
      await ev("visible", "visible");
      await sleep(80);
      const s3 = await st();
      await check("R8 回前景重讀：30 秒內不重讀；超過 30 秒重讀 1 次（hidden 不讀）；緊接著再回前景不重讀", () => {
        assert.equal(ensures(s1).length, ensures(s0).length);
        assert.equal(ensures(sh).length, ensures(s0).length);
        assert.equal(ensures(s2).length, ensures(s0).length + 1);
        assert.equal(itemSelects(s2).length, itemSelects(s0).length + 1);
        assert.equal(ensures(s3).length, ensures(s2).length);
        assert.equal(s2.channels, 0);
      });
    }
    {
      await mount({ seed: STD, plan: { "rpc:ensure_my_packing_categories": ["network"] } });
      const s = await st();
      await ev("clickIn", "root", Z.retry);
      await sleep(150);
      const s2 = await st();
      await check("R8b 首次讀取失敗：顯示錯誤與重試；重試成功後顯示清單", () => {
        assert.ok(s.text.includes(Z.errorNetwork), s.text);
        assert.equal(s2.cats.length, 6);
      });
    }

    // ═══ R9 總覽卡 ═══
    {
      const tripId = await mount({ what: "card2", seed: STD });
      const s = await st();
      await check("R9a 總覽卡（兩張同時掛載＋StrictMode）：ensure 與物品讀取各 1 次；顯示進度條與「2 / 5 已打包」", () => {
        assert.equal(ensures(s).length, 1, "ensure 次數 " + ensures(s).length);
        assert.equal(itemSelects(s).length, 1);
        assert.ok(s.text.includes(fmt(Z.overviewProgress, { checked: 2, total: 5 })), s.text);
        assert.ok(s.text.includes(Z.title));
        assert.deepEqual(s.bar, { now: "2", max: "5", width: "40%" });
      });
      await ev("mount", { what: "card", tripId, keepServer: true, clock: 20000 });
      await sleep(120);
      const s2 = await st();
      await ev("mount", { what: "card", tripId, keepServer: true, clock: 31000 });
      await sleep(150);
      const s3 = await st();
      await check("R9b 總覽卡 30 秒節流：20 秒後重新掛載不重讀（沿用快取）；31 秒後重讀", () => {
        assert.equal(ensures(s2).length, 0);
        assert.ok(s2.text.includes(fmt(Z.overviewProgress, { checked: 2, total: 5 })));
        assert.equal(ensures(s3).length, 1);
      });
      const btn = await evaluate("(function(){const b=document.querySelector('#root button');if(!b)return false;b.click();return true;})()");
      await sleep(40);
      const s4 = await st();
      await check("R9c 點總覽卡：留下「從總覽進入」標記並導到 /saved/$tripId/packing；記帳標記不受影響", () => {
        assert.ok(btn);
        assert.deepEqual(s4.nav.at(-1), { to: "/saved/$tripId/packing", params: { tripId } });
        assert.equal(s4.ss["roamie:trip-packing-return"], tripId);
        assert.ok(s4.ss["roamie:trip-packing-return-at"]);
        assert.equal(s4.ss["roamie:trip-expenses-return"], undefined);
      });
    }
    {
      const tripId = await mount({ what: "card", seed: STD, plan: { "rpc:ensure_my_packing_categories": ["network"] } });
      const s = await st();
      await ev("mount", { what: "card", tripId, keepServer: true, clock: 10000 });
      await sleep(120);
      const s2 = await st();
      await ev("mount", { what: "card", tripId, keepServer: true, clock: 31000 });
      await sleep(150);
      const s3 = await st();
      await check("R9d 總覽卡讀取失敗：顯示錯誤；30 秒內重新掛載不重試且仍顯示錯誤；超過 30 秒重試並恢復", () => {
        assert.ok(s.text.includes(Z.overviewLoadFailed), s.text);
        assert.equal(ensures(s2).length, 0);
        assert.ok(s2.text.includes(Z.overviewLoadFailed), s2.text);
        assert.equal(ensures(s3).length, 1);
        assert.ok(s3.text.includes(fmt(Z.overviewProgress, { checked: 2, total: 5 })), s3.text);
      });
    }
    {
      const tripId = await mount({ seed: STD });
      await ev("mount", { what: "card", tripId, keepServer: true, clock: 5000 });
      await sleep(120);
      const s = await st();
      await check("R9e 行李頁讀過後 30 秒內回總覽：總覽卡不重讀，直接顯示快取進度", () => {
        assert.equal(ensures(s).length, 0);
        assert.ok(s.text.includes(fmt(Z.overviewProgress, { checked: 2, total: 5 })));
      });
    }
    {
      await mount({ what: "card", seed: { defaults: true } });
      const s = await st();
      await check("R9f 總覽卡沒有物品：顯示空狀態文案（看總覽即建立預設分類＝ensure 1 次）", () => {
        assert.ok(s.text.includes(Z.overviewEmpty), s.text);
        assert.equal(ensures(s).length, 1);
      });
    }

    // ═══ R10 返回 ═══
    {
      const tripId = await mount({ seed: STD, mark: true, canGoBack: true });
      const ssMounted = (await st()).ss;
      await ev("clickIn", "header", null, Z.back);
      await sleep(30);
      const s = await st();
      await ev("unmountAll");
      const ssAfter = await evaluate("window.ss()");
      await check("R10a 從總覽進入：掛載即消費「從總覽進入」標記；返回用 history.back；離開時留下行李「返回總覽」標記（記帳 key 不動）", () => {
        assert.equal(ssMounted["roamie:trip-packing-return"], undefined, "未消費標記");
        assert.equal(s.backs, 1);
        assert.equal(s.nav.length, 0);
        const back = JSON.parse(ssAfter["roamie:trip-packing-back"] ?? "null");
        assert.equal(back?.tripId, tripId);
        assert.equal(ssAfter["roamie:trip-expenses-back"], undefined);
      });
      const t2 = await mount({ seed: STD, canGoBack: true });
      await ev("clickIn", "header", null, Z.back);
      await sleep(30);
      const s2 = await st();
      await ev("unmountAll");
      const ss2 = await evaluate("window.ss()");
      const t3 = await mount({ seed: STD, mark: "7f000000-0000-4000-8000-0000000000ff", canGoBack: true });
      await ev("clickIn", "header", null, Z.back);
      await sleep(30);
      const s3 = await st();
      const t4 = await mount({ seed: STD, mark: true, markAge: 31000, canGoBack: true });
      await ev("clickIn", "header", null, Z.back);
      await sleep(30);
      const s4 = await st();
      await check("R10b 非從總覽進入（無標記／他行程標記／過期 31 秒）：replace 導到總覽分頁，不 history.back，不留返回標記", () => {
        for (const [x, t] of [[s2, t2], [s3, t3], [s4, t4]]) {
          assert.equal(x.backs, 0);
          assert.deepEqual(x.nav.at(-1), { to: "/saved/$tripId", params: { tripId: t }, search: { view: "overview" }, replace: true });
        }
        assert.equal(ss2["roamie:trip-packing-back"], undefined);
      });
      await ev("mount", { what: "route", tripId: "not-a-uuid" });
      await sleep(80);
      const s5 = await st();
      await check("R10c 路由 tripId 不是 uuid：replace 導回 /saved?tab=trips，不讀取", () => {
        assert.deepEqual(s5.nav.at(-1), { to: "/saved", search: { tab: "trips" }, replace: true });
        assert.equal(ensures(s5).length, 0);
      });
      const rs = await evaluate(`(function(){const R=window.RET;sessionStorage.clear();const T='7f000000-0000-4000-8000-0000000000aa';
        R.markTripExpensesFromOverview(T);const a=[R.readTripExpensesFromOverview(T),R.readTripPackingFromOverview(T),R.readTripPackingReturn(T),R.readTripExpensesReturn(T),R.readTripOverviewSubpageReturn(T)];
        R.clearTripPackingFromOverview();const b=R.readTripExpensesFromOverview(T);
        sessionStorage.clear();R.markTripPackingBackToOverview(T);const c=[R.readTripExpensesReturn(T),R.readTripPackingReturn(T),R.readTripOverviewSubpageReturn(T),R.readTripOverviewSubpageReturn('7f000000-0000-4000-8000-0000000000bb')];
        R.clearTripOverviewSubpageReturn();const d=Object.keys(window.ss()).length;return {a:a,b:b,c:c,d:d};})()`);
      await check("R10d 返回標記互不干擾：記帳標記不影響行李讀取、清行李不清記帳；任一子頁標記都讓總覽還原；clear 全清", () => {
        assert.deepEqual(rs.a, [true, false, false, true, true]);
        assert.equal(rs.b, true);
        assert.deepEqual(rs.c, [false, true, true, false]);
        assert.equal(rs.d, 0);
      });
    }

    // ═══ R12 四語系 ═══
    {
      const expect = {
        en: ["Clothing", "Toiletries", "Electronics", "Documents", "Medicine", "Other"],
        ja: ["衣類", "洗面用具", "電子機器", "書類・身分証", "薬", "その他"],
        ko: ["의류", "세면도구", "전자기기", "서류", "의약품", "기타"],
        "zh-TW": ["衣物", "盥洗用品", "電子用品", "證件", "藥品", "其他"],
      };
      const got = {};
      for (const loc of Object.keys(expect)) {
        await mount({ locale: loc, seed: { ...STD, cats: [{ name: "相機包", icon: "Camera", sort: 9 }] } });
        got[loc] = await st();
      }
      const ERRMSG = await evaluate("window.ERRMSG");
      await check("R12 四語系：預設分類依 default_key 顯示目前語系、自訂名稱不翻譯；標題／副標／編輯分類／進度文案；錯誤碼皆有專屬訊息", () => {
        for (const [loc, names] of Object.entries(expect)) {
          const s = got[loc];
          const C = COPY[loc];
          assert.deepEqual(s.cats.map((c) => c.label), [...names, "相機包"], loc);
          assert.equal(s.header.title, C.title);
          assert.equal(s.header.sub, C.privateNote);
          assert.equal(s.header.buttons.at(-1), C.editCategories);
          assert.equal(s.progress, fmt(C.progress, { checked: 2, total: 5 }));
          for (const k of Object.keys(C)) assert.ok(typeof C[k] === "string" && C[k].length > 0, loc + " " + k);
          const msgs = ERRMSG[loc];
          for (const [code, m] of Object.entries(msgs)) {
            if (code === "unknown" || code === "packing_immutable_field" || code === "packing_invalid_default_key") continue;
            assert.notEqual(m, C.errorUnknown, loc + " " + code + " 落到 errorUnknown");
          }
        }
        assert.equal(COPY["zh-TW"].title, "我的行李");
        assert.equal(COPY["zh-TW"].privateNote, "只有你看得到這份清單");
      });
    }

    // ═══ R13（行李頁部分）═══
    {
      const all = await evaluate("window.__allViol");
      await check("R13a 行李頁全程：假後端未記錄任何違規欄位（user_id／version／checked_at 等）", () => {
        assert.deepEqual(all, []);
      });
    }

    // ═══ R11 TripDetailScreen 捲動還原 ═══
    {
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/detail.html` });
      for (let i = 0; i < 100 && !(await evaluate("!!window.__dready").catch(() => false)); i++) await sleep(100);
      const TRIP = "7f000000-0000-4000-8000-0000000000aa";
      const OTHER = "7f000000-0000-4000-8000-0000000000bb";
      const dmount = async (o) => {
        await ev("dmount", { tripId: TRIP, ...o });
        for (let i = 0; i < 60 && !(await evaluate("window.dstate().editor")); i++) await sleep(25);
        await sleep(200);
        return evaluate("window.dstate()");
      };
      const fresh = await dmount({ view: "overview", tops: { overview: 700, trip: 50 }, pkBack: { tripId: TRIP, age: 2000 } });
      const old = await dmount({ view: "overview", tops: { overview: 700 }, pkBack: { tripId: TRIP, age: 31000 } });
      const other = await dmount({ view: "overview", tops: { overview: 700 }, pkBack: { tripId: OTHER, age: 1000 } });
      const none = await dmount({ view: "overview", tops: { overview: 700 } });
      const tripView = await dmount({ view: undefined, tops: { overview: 700, trip: 50 }, pkBack: { tripId: TRIP, age: 1000 } });
      await check("R11a 行李頁「返回總覽」標記：同行程 30 秒內 → 還原總覽捲動並清除；過期／他行程／無標記 → 不捲動；行程分頁 → 清除不捲動", () => {
        assert.equal(fresh.scrollTop, 700);
        assert.equal(fresh.ss["roamie:trip-packing-back"], undefined);
        assert.equal(old.scrollTop, 0);
        assert.equal(other.scrollTop, 0);
        assert.equal(none.scrollTop, 0);
        assert.equal(tripView.scrollTop, 0);
        assert.equal(tripView.ss["roamie:trip-packing-back"], undefined);
      });
      await check("R11b 總覽：「我的行李」卡緊接在「共同記帳」卡之後，顯示「1 / 2 已打包」", () => {
        assert.ok(fresh.expensesIdx >= 0 && fresh.packingIdx === fresh.expensesIdx + 1, JSON.stringify([fresh.expensesIdx, fresh.packingIdx]));
        assert.ok(fresh.nextSiblingIsPacking, "DOM 上不是緊鄰");
        assert.ok(fresh.packingText.includes(fmt(Z.overviewProgress, { checked: 1, total: 2 })), fresh.packingText);
      });
      await dmount({ view: "overview" });
      await ev("dscroll", 640);
      await sleep(30);
      const clicked = await ev("dclickPacking");
      const afterClick = await evaluate("window.dstate()");
      await ev("dunmount");
      const back = await dmount({ view: "overview", keepStorage: true });
      const exMark = await dmount({ view: "overview", tops: { overview: 500 }, exMark: TRIP });
      await check("R11c 往返：總覽捲到 640 → 點「我的行李」卡 → 返回後還原 640；記帳標記行為不變（仍還原並清除）", () => {
        assert.equal(clicked, "clicked");
        assert.deepEqual(afterClick.nav.at(-1), { to: "/saved/$tripId/packing", params: { tripId: TRIP } });
        assert.equal(afterClick.ss["roamie:trip-packing-return"], TRIP);
        assert.equal(back.scrollTop, 640);
        assert.equal(back.ss["roamie:trip-packing-return"], undefined);
        assert.equal(exMark.scrollTop, 500);
        assert.equal(exMark.ss["roamie:trip-expenses-return"], undefined);
      });
      await check("R11d 行程頁含行李卡：無 .delete()、總覽卡呼叫 ensure", () => {
        for (const x of [fresh, old, other, none, tripView, back, exMark]) assert.deepEqual(x.deletes, []);
        assert.ok(fresh.rpc.includes("ensure_my_packing_categories"), "首次顯示總覽未讀取行李");
      });
    }

    await check("R13 無外部請求、無瀏覽器例外／console.error", () => {
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
console.log(failures.length ? "verify-trip-packing-stage5: FAIL" : "verify-trip-packing-stage5: PASS");
process.exit(failures.length ? 1 : 0);
