import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260909100000_security_remediation.sql");
const entitlement = read("supabase/migrations/20260909090000_plus_entitlement_authority.sql");
const staging = read("scripts/staging-security-verification.sql");

assert.match(migration, /REVOKE INSERT ON public\.trip_members FROM anon, authenticated/);
assert.doesNotMatch(migration, /user_id = auth\.uid\(\) AND is_owner = false/);
assert.match(migration, /inv\.status <> 'pending'/);
assert.match(migration, /CREATE TRIGGER saved_trips_protect_owner/);
assert.match(migration, /NEW\.user_id IS DISTINCT FROM OLD\.user_id/);
assert.match(migration, /DROP POLICY IF EXISTS "profiles trip co-member select"/);
assert.match(migration, /RETURNS TABLE \(user_id uuid, display_name text, avatar_url text\)/);
for (const name of ["set", "reset", "deduct", "clear_override"]) {
  assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.credits_debug_${name}`));
}
assert.match(migration, /credits_release_my_stale_reservations/);
assert.match(migration, /p_max_age < interval '1 minute'/);
assert.match(entitlement, /ROAMIE_PLUS_ENTITLEMENT_DASHBOARD_WRAPPER_V1/);
assert.match(entitlement, /pg_get_functiondef/);
for (const sql of [entitlement, migration]) {
  const withoutComments = sql.replace(/^\s*--.*$/gm, "");
  const securityDefinerCount = (withoutComments.match(/SECURITY DEFINER/g) ?? []).length;
  const fixedSearchPathCount = (
    withoutComments.match(/SECURITY DEFINER[\s\S]{0,120}?SET search_path/g) ?? []
  ).length;
  assert.equal(
    fixedSearchPathCount,
    securityDefinerCount,
    "every SECURITY DEFINER needs search_path",
  );
}
for (const requiredCase of [
  "A resolves B",
  "A grants Plus",
  "expired invite",
  "cancelled invite",
  "owner immutable",
  "public profile fields only",
  "debug credit RPC",
  "B cleans A credits",
  "active reservation retained",
]) {
  assert.match(staging, new RegExp(requiredCase));
}

const protectedFiles = [
  "src/lib/location.functions.ts",
  "src/lib/places.functions.ts",
  "src/lib/routes.functions.ts",
  "src/lib/transit.functions.ts",
  "src/lib/trip-stop-search.functions.ts",
  "src/lib/weather.functions.ts",
  "src/lib/place-navigation.functions.ts",
  "src/lib/recommendation.functions.ts",
];
for (const file of protectedFiles) {
  const source = read(file);
  const count = (source.match(/createServerFn\(/g) ?? []).length;
  const guards = (source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length;
  assert.equal(guards, count, `${file}: every server function must be authenticated`);
}
assert.match(read("src/lib/itinerary.functions.ts"), /\.middleware\(\[requireItineraryCredits\]\)/);
assert.match(read("src/integrations/supabase/security-middleware.ts"), /credits_reserve/);
assert.doesNotMatch(
  read("src/integrations/supabase/security-middleware.ts"),
  /result\.result/,
  "TanStack function middleware cannot inspect the handler result",
);
assert.match(
  read("src/lib/itinerary.functions.ts"),
  /result\.success \? "credits_commit" : "credits_rollback"/,
  "the handler result must settle credits through server-only context",
);
assert.doesNotMatch(
  read("src/routes/_app.chat.tsx"),
  /beginItineraryGenerationCredits/,
  "the client must not reserve itinerary credits before the server boundary",
);
assert.doesNotMatch(read("src/routes/api/generate-itinerary.ts"), /reserveServerCredits/);
assert.match(read("src/lib/outfit/outfit.functions.ts"), /requireSupabasePlus/);
assert.match(read("src/routes/api/place-photo.ts"), /PHOTO_RESOURCE/);
assert.doesNotMatch(read("src/lib/trip/trip-invite-deep-link.ts"), /source, path \}/);
assert.match(read("src/server.ts"), /X-Content-Type-Options/);

console.log("verify-security-remediation: ok");
