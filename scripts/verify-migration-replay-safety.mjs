import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationDirectory = "supabase/migrations";
const files = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

// 不寫死總數（每加一支 migration 就要改這裡容易漏）；改為下限＋必須存在的已知 migration 清單（見 requiredOrder）。
assert.ok(files.length >= 33, `expected at least 33 migrations in the release chain, got ${files.length}`);

const versions = files.map((file) => file.split("_", 1)[0]);
assert.equal(new Set(versions).size, versions.length, "migration versions must be unique");
for (const version of versions) {
  assert.match(version, /^\d{14}$/, `invalid migration version: ${version}`);
}
assert.deepEqual(versions, [...versions].sort(), "migration versions must be ordered");

const sql = Object.fromEntries(
  files.map((file) => [file, readFileSync(join(migrationDirectory, file), "utf8")]),
);

function position(file, pattern, description) {
  const offset = sql[file].search(pattern);
  assert.notEqual(offset, -1, `${file}: missing ${description}`);
  return offset;
}

const savedCollections = "20260523120000_saved_collections.sql";
for (const column of ["cover_image_url", "trip_data"]) {
  const ensureOffset = position(
    savedCollections,
    new RegExp(`ALTER TABLE public\\.saved_trips ADD COLUMN IF NOT EXISTS ${column}\\b`, "i"),
    `replay guard for saved_trips.${column}`,
  );
  const firstLegacyRead = position(
    savedCollections,
    new RegExp(`UPDATE public\\.saved_trips[\\s\\S]*?\\b${column}\\b`, "i"),
    `legacy read of saved_trips.${column}`,
  );
  assert.ok(
    ensureOffset < firstLegacyRead,
    `${savedCollections}: ${column} must be added before it is read`,
  );
}

const earliestSavedPlaces = "20260519210835_d992c893-6abe-4280-a756-cc0aa5b7be52.sql";
for (const column of [
  "category",
  "city",
  "notes",
  "mood_tag",
  "cover_image",
  "metadata",
  "updated_at",
]) {
  assert.match(
    sql[earliestSavedPlaces],
    new RegExp(`\\b${column}\\s+`, "i"),
    `${earliestSavedPlaces}: expected fresh saved_places.${column}`,
  );
  position(
    savedCollections,
    new RegExp(`ALTER TABLE public\\.saved_places ADD COLUMN IF NOT EXISTS ${column}\\b`, "i"),
    `final-schema guard for saved_places.${column}`,
  );
}

assert.doesNotMatch(
  sql[earliestSavedPlaces],
  /\bphoto_url\s+/i,
  `${earliestSavedPlaces}: photo_url must remain an optional legacy source`,
);
assert.doesNotMatch(
  sql[savedCollections],
  /ALTER TABLE public\.saved_places ADD COLUMN IF NOT EXISTS photo_url\b/i,
  `${savedCollections}: optional legacy photo_url must not be added permanently`,
);
const photoCatalogGuard = position(
  savedCollections,
  /information_schema\.columns[\s\S]*?column_name\s*=\s*'photo_url'/i,
  "catalog guard for optional saved_places.photo_url",
);
const photoBackfill = position(
  savedCollections,
  /EXECUTE\s+\$backfill\$[\s\S]*?SET cover_image = photo_url/i,
  "guarded saved_places.photo_url backfill",
);
assert.ok(
  photoCatalogGuard < photoBackfill,
  `${savedCollections}: photo_url must be catalog-guarded before its backfill`,
);

for (const file of files) {
  const statements = [...sql[file].matchAll(/CREATE POLICY\s+(?:"([^"]+)"|(\w+))/gi)];
  for (const statement of statements) {
    const policy = statement[1] ?? statement[2];
    const prefix = sql[file].slice(0, statement.index);
    assert.match(
      prefix,
      new RegExp(`DROP POLICY IF EXISTS\\s+"?${policy}"?\\s+ON`, "i"),
      `${file}: CREATE POLICY ${policy} needs a prior retry guard`,
    );
  }
}

const requiredOrder = [
  ["20260519192036", "CREATE TABLE IF NOT EXISTS public.profiles"],
  ["20260519192036", "CREATE TABLE IF NOT EXISTS public.saved_trips"],
  ["20260519210835", "CREATE TABLE IF NOT EXISTS public.saved_places"],
  ["20260703100000", "CREATE TABLE IF NOT EXISTS public.trip_members"],
  ["20260703100000", "CREATE TABLE IF NOT EXISTS public.trip_invites"],
  ["20260723120000", "CREATE TABLE IF NOT EXISTS public.credit_accounts"],
  ["20260723120000", "CREATE OR REPLACE FUNCTION public.credits_ensure_account"],
  ["20260816090000", "CREATE OR REPLACE FUNCTION public.admin_dashboard_phase1"],
  ["20260905090000", "CREATE OR REPLACE FUNCTION public.admin_analytics_v1"],
  ["20260909090000", "CREATE TABLE IF NOT EXISTS public.user_plus_entitlements"],
  ["20260909090000", "CREATE OR REPLACE FUNCTION public.resolve_user_plus_entitlement"],
  ["20260909100000", "CREATE OR REPLACE FUNCTION public.protect_saved_trip_owner"],
  ["20260909110000", "CREATE OR REPLACE FUNCTION public.resolve_user_plus_entitlement"],
  ["20260909120000", "CREATE OR REPLACE FUNCTION public.protect_profile_subscription_columns"],
  ["20260913120000", "CREATE TABLE IF NOT EXISTS public.account_deletion_requests"],
  ["20260913130000", "GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated"],
  ["20260913150000", "CREATE TABLE IF NOT EXISTS public.revenuecat_subscription_states"],
  ["20260913160000", "CREATE OR REPLACE FUNCTION public.resolve_user_plus_entitlement"],
  ["20261102100000", "CREATE OR REPLACE FUNCTION public.guard_trip_invite_client_write"],
];

let previousIndex = -1;
for (const [version, marker] of requiredOrder) {
  const fileIndex = files.findIndex((file) => file.startsWith(`${version}_`));
  assert.ok(fileIndex >= 0, `missing migration ${version}`);
  assert.ok(fileIndex >= previousIndex, `${marker} is out of dependency order`);
  assert.ok(sql[files[fileIndex]].includes(marker), `${files[fileIndex]}: missing ${marker}`);
  previousIndex = fileIndex;
}

const securitySql = sql["20260909100000_security_remediation.sql"];
for (const dependency of [
  "public.trip_members",
  "public.trip_invites",
  "public.credit_ledger",
  "public.credit_debug_overrides",
  "public.credits_release_stale_reservations",
]) {
  const createdEarlier = files
    .slice(0, files.indexOf("20260909100000_security_remediation.sql"))
    .some((file) => sql[file].includes(dependency));
  assert.ok(createdEarlier, `security remediation dependency missing: ${dependency}`);
  assert.ok(
    securitySql.includes(dependency),
    `security remediation no longer exercises ${dependency}`,
  );
}

// ---------------------------------------------------------------------------
// Trip Workspace V1 第 3 階段：20261102100000_trip_invite_hardening.sql 重放安全
// ---------------------------------------------------------------------------
const inviteHardening = "20261102100000_trip_invite_hardening.sql";
assert.ok(files.includes(inviteHardening), `missing ${inviteHardening}`);
{
  const text = sql[inviteHardening];
  const body = text.replace(/^\s*--.*$/gm, "");

  for (const m of body.matchAll(/\bADD COLUMN\b(?!\s+IF NOT EXISTS)/gi)) {
    assert.fail(`${inviteHardening}: ADD COLUMN without IF NOT EXISTS at offset ${m.index}`);
  }
  for (const m of body.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+IF NOT EXISTS)/gi)) {
    assert.fail(`${inviteHardening}: CREATE INDEX without IF NOT EXISTS at offset ${m.index}`);
  }
  for (const m of body.matchAll(/\bCREATE EXTENSION\b(?!\s+IF NOT EXISTS)/gi)) {
    assert.fail(`${inviteHardening}: CREATE EXTENSION without IF NOT EXISTS at offset ${m.index}`);
  }
  // 自我檢查：下列迴圈確實掃到本檔的 trigger／CREATE FUNCTION（避免 regex 失效而空轉通過）
  assert.equal([...body.matchAll(/\bCREATE TRIGGER\s+\w+/gi)].length, 1, `${inviteHardening}: expected 1 CREATE TRIGGER`);
  assert.equal([...body.matchAll(/\bCREATE FUNCTION\s+[\w.]+\(/gi)].length, 3, `${inviteHardening}: expected 3 CREATE FUNCTION`);
  for (const m of body.matchAll(/\bCREATE TRIGGER\s+(\w+)\s+[\s\S]*?\bON\s+([\w.]+)/gi)) {
    const prefix = body.slice(0, m.index);
    assert.match(
      prefix,
      new RegExp(`DROP TRIGGER IF EXISTS\\s+${m[1]}\\s+ON\\s+${m[2].replace(".", "\\.")}`, "i"),
      `${inviteHardening}: CREATE TRIGGER ${m[1]} needs a prior DROP TRIGGER IF EXISTS`,
    );
  }
  // CREATE FUNCTION（非 OR REPLACE）重放時會撞名，必須先 DROP FUNCTION IF EXISTS 同簽章
  for (const m of body.matchAll(/\bCREATE FUNCTION\s+([\w.]+)\(([^)]*)\)/gi)) {
    const argTypes = m[2]
      .split(",")
      .map((a) => a.trim().split(/\s+/).slice(1).join(" "))
      .filter(Boolean)
      .join(",\\s*");
    const prefix = body.slice(0, m.index);
    assert.match(
      prefix,
      new RegExp(`DROP FUNCTION IF EXISTS\\s+${m[1].replace(".", "\\.")}\\(\\s*${argTypes}\\s*\\)`, "i"),
      `${inviteHardening}: CREATE FUNCTION ${m[1]}(${m[2]}) needs a prior DROP FUNCTION IF EXISTS with the same signature`,
    );
  }
  // 撤銷舊 RPC 時該函式可能不存在（全新資料庫）：必須以 to_regprocedure 守門
  assert.match(
    body,
    /to_regprocedure\('public\.get_trip_invite_by_token\(text\)'\) IS NOT NULL THEN\s*REVOKE ALL ON FUNCTION public\.get_trip_invite_by_token\(text\) FROM PUBLIC, anon, authenticated/,
    `${inviteHardening}: get_trip_invite_by_token revoke must be guarded by to_regprocedure`,
  );
  // 不加入 realtime publication
  assert.doesNotMatch(body, /supabase_realtime/i, `${inviteHardening}: must not touch supabase_realtime`);
  // 每個 SECURITY DEFINER 都要固定 search_path
  const definers = (body.match(/SECURITY DEFINER/g) ?? []).length;
  const pinned = (body.match(/SECURITY DEFINER[\s\S]{0,120}?SET search_path/g) ?? []).length;
  assert.ok(definers >= 4, `${inviteHardening}: expected >= 4 SECURITY DEFINER functions, got ${definers}`);
  assert.equal(pinned, definers, `${inviteHardening}: every SECURITY DEFINER needs search_path`);
  // gen_random_bytes 位於 extensions schema：用到的函式 search_path 必須包含 extensions
  for (const m of body.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+([\w.]+)\([\s\S]*?\$\$([\s\S]*?)\$\$/gi)) {
    if (!/gen_random_bytes/.test(m[2])) continue;
    const header = body.slice(m.index, m.index + m[0].indexOf("$$"));
    assert.match(header, /SET search_path = [^\n]*\bextensions\b/, `${m[1]}: search_path must include extensions for gen_random_bytes`);
  }
  // 依賴的資料表／函式必須在更早的 migration 建立
  const earlier = files.slice(0, files.indexOf(inviteHardening));
  for (const dependency of [
    "CREATE TABLE IF NOT EXISTS public.trip_invites",
    "CREATE TABLE IF NOT EXISTS public.trip_members",
    "FUNCTION public.is_trip_owner",
    "CREATE TABLE IF NOT EXISTS public.profiles",
  ]) {
    assert.ok(
      earlier.some((file) => sql[file].includes(dependency)),
      `${inviteHardening}: dependency not created earlier: ${dependency}`,
    );
  }
  // saved_trips 欄位：preview 讀取的欄位要在更早的 migration 存在
  for (const column of ["custom_title", "is_title_customized", "custom_cover_image_url", "is_cover_customized", "cover_image_url", "cover_image", "payload", "trip_data"]) {
    assert.ok(
      earlier.some((file) => new RegExp(`\\b${column}\\b`).test(sql[file])),
      `${inviteHardening}: saved_trips.${column} not defined by an earlier migration`,
    );
  }
}

console.log(`Migration replay safety static regression passed (${files.length} migrations).`);
