import assert from "node:assert/strict";
import { assertAllowedSupabaseTarget } from "../src/lib/account-deletion/account-deletion.server";

const stagingRef = "piuuauapiodwhbkhcjdw";
const productionRef = "rkzohhstdfxeqxajslrt";
const env = (allowedRef) => ({ ACCOUNT_DELETION_ALLOWED_SUPABASE_REF: allowedRef });
const url = (ref) => `https://${ref}.supabase.co`;

assert.doesNotThrow(() => assertAllowedSupabaseTarget(env(stagingRef), url(stagingRef)));
assert.doesNotThrow(() => assertAllowedSupabaseTarget(env(productionRef), url(productionRef)));
assert.throws(
  () => assertAllowedSupabaseTarget(env(stagingRef), url(productionRef)),
  /account_deletion_target_not_allowed/,
);
assert.throws(
  () => assertAllowedSupabaseTarget(env(productionRef), url(stagingRef)),
  /account_deletion_target_not_allowed/,
);
assert.throws(
  () => assertAllowedSupabaseTarget({}, url(stagingRef)),
  /account_deletion_target_not_allowed/,
);
assert.throws(
  () => assertAllowedSupabaseTarget(env("not-a-project-ref"), url(stagingRef)),
  /account_deletion_target_not_allowed/,
);
for (const malformed of [
  "not-a-url",
  `http://${stagingRef}.supabase.co`,
  `https://${stagingRef}.supabase.co.evil.example`,
  `https://user:password@${stagingRef}.supabase.co`,
]) {
  assert.throws(
    () => assertAllowedSupabaseTarget(env(stagingRef), malformed),
    /account_deletion_target_invalid/,
  );
}

console.log("Account deletion environment guard matrix: PASS");
