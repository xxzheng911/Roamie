import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260913120000_account_deletion_authority.sql");
const collaborationGrantMigration = read(
  "supabase/migrations/20260913140000_account_deletion_collaboration_grants.sql",
);
const endpoint = read("src/routes/api/account/delete.ts");
const server = read("src/lib/account-deletion/account-deletion.server.ts");
const revenueCatDelete = read("src/lib/account-deletion/revenuecat-customer-delete.server.ts");
const apple = read("src/lib/account-deletion/apple-revoke.server.ts");
const client = read("src/lib/account-deletion/account-deletion.ts");
const settings = read("src/routes/_app.settings.tsx");
const cleanup = read("src/lib/clear-auth-state.ts");
const adapter = read("src/services/subscription/index.ts");
const apiUrl = read("src/lib/api-url.ts");
const appDelegate = read("ios/App/App/AppDelegate.swift");
const appleNative = read("src/lib/auth-apple-native.ts");

assert.match(migration, /REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT ALL[\s\S]*TO service_role/);
assert.match(migration, /public\.account_deletion_receipts/);
assert.match(migration, /user_id_hash text NOT NULL/);
assert.match(migration, /interval '24 hours'/);
assert.doesNotMatch(migration, /identity_token|authorization_code|refresh_token/);
assert.match(
  collaborationGrantMigration,
  /GRANT SELECT, DELETE ON TABLE public\.trip_invites TO service_role/,
);
assert.doesNotMatch(
  collaborationGrantMigration,
  /(?:GRANT|REVOKE)[^;]*(?:authenticated|anon)|DISABLE ROW LEVEL SECURITY/i,
);

assert.match(endpoint, /POST/);
assert.match(endpoint, /GET:[\s\S]*account_deletion_method_not_allowed[\s\S]*status: 405/);
assert.doesNotMatch(endpoint, /targetUserId|userId:\s*z\./);
assert.match(server, /auth\.getUser\(\)/);
assert.match(server, /ACCOUNT_DELETION_RECENT_AUTH/);
assert.match(server, /source: recentAuth\.source/);
assert.match(server, /ACCOUNT_DELETION_STATE/);
for (const stage of [
  "legacy_preflight_detected",
  "legacy_preflight_released",
  "request_created",
  "external_cleanup_started",
  "resumed_existing_request",
  "completed",
]) {
  assert.match(server, new RegExp(`stage: "${stage}"`));
}
assert.doesNotMatch(server, /value\.auth_time \?\? value\.iat/);
assert.match(server, /value\.amr/);
assert.ok(
  server.indexOf("evaluateRecentAuthentication(params.request)") <
    server.indexOf('.from("account_deletion_requests").insert'),
  "recent-auth preflight must happen before durable request creation",
);
assert.match(server, /isPreflightOnlyState\(existing\)/);
assert.match(server, /canResumeFailedExternalRequest\(existing\)/);
assert.match(server, /account_deletion_receipts/);
assert.match(server, /SHA-256/);
assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(server, /SUPABASE_ANON_KEY/);
assert.match(server, /ACCOUNT_DELETION_ALLOWED_SUPABASE_REF/);
assert.match(server, /ACCOUNT_DELETION_ENV_GUARD/);
assert.match(server, /actualRef === allowedRef/);
assert.doesNotMatch(server, /PRODUCTION_SUPABASE_REF/);
assert.match(server, /admin\.auth\.admin\.deleteUser\(user\.id\)/);
assert.ok(
  server.indexOf("account_storage_delete_failed") < server.indexOf("deleteUser(user.id)"),
  "storage cleanup must precede auth.users deletion",
);
assert.ok(
  server.indexOf("deleteRevenueCatCustomerV2") < server.indexOf("deleteUser(user.id)"),
  "external cleanup must precede auth.users deletion",
);
assert.match(server, /\.eq\("invitee_user_id", user\.id\)/);
assert.match(server, /delete_invitee_user_invites/);
assert.match(server, /delete_invitee_email_invites/);
assert.match(server, /ACCOUNT_DELETION_COLLABORATION_CLEANUP/);
assert.match(server, /\.update\(\{ user_id: null, session_id: null, metadata: \{\} \}\)/);
assert.doesNotMatch(server, /body\.(?:targetUserId|userId)/);
assert.match(revenueCatDelete, /REVENUECAT_PROJECT_ID/);
assert.match(revenueCatDelete, /REVENUECAT_V2_SECRET_API_KEY/);
assert.doesNotMatch(revenueCatDelete, /readServerEnv\(env, "REVENUECAT_SECRET_API_KEY"\)/);
assert.match(revenueCatDelete, /api\.revenuecat\.com\/v2/);
assert.match(revenueCatDelete, /searchParams\.set\("search", authenticatedUserId\)/);
assert.match(revenueCatDelete, /customers\/\$\{encodeURIComponent\(verified\[0\]\.id\)\}/);
assert.doesNotMatch(revenueCatDelete, /\/v1\/subscribers/);

assert.match(apple, /appleid\.apple\.com\/auth\/token/);
assert.match(apple, /appleid\.apple\.com\/auth\/revoke/);
assert.match(apple, /presented\.sub === expectedAppleSubject/);
assert.match(apple, /exchangedClaims\?\.sub !== params\.expectedAppleSubject/);
assert.match(apple, /ACCOUNT_DELETION_APPLE_IDENTITY/);
assert.match(apple, /hasSupabaseAppleIdentity/);
assert.match(apple, /hasFreshAppleSubject/);
assert.match(apple, /subjectMatch/);
assert.doesNotMatch(
  apple,
  /console\.(?:log|info|warn|error)\([^\n]*(?:identityToken|authorizationCode|tokenPayload)/,
);
assert.match(server, /identityData\.sub/);
assert.doesNotMatch(server, /return identity\?\.identity_id/);
assert.match(appleNative, /registerPlugin<SecureAppleSignInPlugin>/);
assert.match(appleNative, /"SecureAppleSignIn"/);
assert.doesNotMatch(
  appleNative,
  /console\.(?:log|info|warn|error)\([^\n]*(?:identityToken|authorizationCode)/,
);
assert.match(appDelegate, /final class SecureAppleSignInPlugin/);
assert.match(appDelegate, /CAPLog\.enableLogging = false/);
assert.match(appDelegate, /bridge\?\.registerPluginInstance\(SecureAppleSignInPlugin\(\)\)/);
assert.doesNotMatch(`${client}\n${settings}`, /APPLE_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY/);

assert.match(apiUrl, /"\/api\/account\/delete"/);
assert.match(client, /Authorization: `Bearer \$\{session\.access_token\}`/);
assert.doesNotMatch(client, /targetUserId|userId:/);
assert.match(settings, /確定要刪除帳號嗎？/);
assert.match(settings, /此操作無法復原/);
assert.match(settings, /不會自動取消你的 App Store 訂閱/);
assert.match(settings, /保留我的帳號/);
assert.match(settings, /永久刪除帳號/);
assert.match(settings, /canManageAppleSubscription/);
assert.match(settings, /ACCOUNT_DELETION_UI_ACTION/);
assert.match(settings, /stage: "clicked"/);
assert.match(settings, /reason: "authenticated_session_missing"/);
assert.match(settings, /reason: "deletion_in_progress"/);
assert.match(settings, /const deletionProvider = user \? resolveAuthProvider\(user\) : null/);
assert.doesNotMatch(settings, /if \([^\n]*!authProvider[^\n]*\) return/);
assert.ok(
  settings.indexOf('stage: "clicked"') < settings.indexOf("setDeletingAccount(true)"),
  "destructive action must be observable before loading starts",
);
assert.ok(
  settings.indexOf("setDeletingAccount(true)") <
    settings.indexOf("deleteCurrentAccount(deletionProvider, requestId)"),
  "the destructive action must enter loading before the request",
);
assert.match(settings, /disabled=\{deletingAccount\}/);
assert.match(settings, /finally \{\s*setDeletingAccount\(false\)/);
assert.match(settings, /clearRevenueCatIdentityAfterAccountDeletion/);
assert.match(settings, /clearDeletedAccountLocalData\(user\.id\)/);
assert.ok(
  settings.indexOf("if (!result.ok)") < settings.indexOf("clearDeletedAccountLocalData(user.id)"),
  "local cleanup must only occur after server-confirmed success",
);
assert.match(cleanup, /clearDeletedAccountLocalData/);
assert.match(
  cleanup,
  /clearAuthStateSync\(\{ reason: "account-deleted", clearCompanionMode: false \}\)/,
  "account deletion must preserve the device-level onboarding completion flag",
);
assert.doesNotMatch(
  cleanup,
  /clearDeletedAccountLocalData[\s\S]*?clearOnboardingCompleted\(\)/,
  "account deletion must not route a previously onboarded device back to Welcome",
);
assert.match(
  settings,
  /clearDeletedAccountLocalData\(user\.id\)[\s\S]*?navigate\(\{ to: "\/login", replace: true \}\)/,
  "successful Google and Apple deletion must share the canonical /login navigation",
);
assert.match(adapter, /clearRevenueCatIdentityAfterAccountDeletion/);

console.log("Account deletion authority regression: PASS");
