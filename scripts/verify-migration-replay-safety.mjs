import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationDirectory = "supabase/migrations";
const files = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

assert.equal(files.length, 25, "expected the complete 25-migration release chain");

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

console.log(`Migration replay safety static regression passed (${files.length} migrations).`);
