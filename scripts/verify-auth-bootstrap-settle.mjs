#!/usr/bin/env node
/**
 * Auth cold-start bootstrap settle — no Places / Planner / UI.
 * Covers restore timeout, persisted-hint must not defer forever, native clear, warm in-flight.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_RESTORE_TIMEOUT,
  authRestoreTimeoutMs,
  authShellGateTimeoutMs,
  decideAppShellAfterAuthRestore,
} from "../src/lib/auth-restore.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function test(name, fn) {
  const result = fn();
  if (result && typeof result.then === "function") {
    return result.then(() => {
      console.log(`  ✓ ${name}`);
    });
  }
  console.log(`  ✓ ${name}`);
  return undefined;
}

console.log("[verify-auth-bootstrap-settle]");

await test("timeout constants are centralized", () => {
  assert.equal(AUTH_RESTORE_TIMEOUT.webMs, 4_000);
  assert.equal(AUTH_RESTORE_TIMEOUT.nativeMs, 12_000);
  assert.equal(AUTH_RESTORE_TIMEOUT.webShellGateMs, 5_000);
  assert.equal(AUTH_RESTORE_TIMEOUT.nativeClearMs, 3_000);
  assert.equal(authRestoreTimeoutMs(true), 12_000);
  assert.equal(authRestoreTimeoutMs(false), 4_000);
  assert.equal(authShellGateTimeoutMs(true), 12_000);
  assert.equal(authShellGateTimeoutMs(false), 5_000);
});

await test("1. no persisted auth → unauthenticated → login", () => {
  assert.deepEqual(
    decideAppShellAfterAuthRestore({ onboardingCompleted: true, hasSessionUser: false }),
    { kind: "login", reason: "restore-unauthenticated" },
  );
});

await test("1b. onboarding incomplete → welcome even without session", () => {
  assert.deepEqual(
    decideAppShellAfterAuthRestore({ onboardingCompleted: false, hasSessionUser: false }),
    { kind: "welcome" },
  );
});

await test("2. valid session → authenticated → app", () => {
  assert.deepEqual(
    decideAppShellAfterAuthRestore({ onboardingCompleted: true, hasSessionUser: true }),
    { kind: "allow-app" },
  );
});

await test("3/4/5. stale / timeout / refresh fail → login, hint is not an input", () => {
  const decision = decideAppShellAfterAuthRestore({
    onboardingCompleted: true,
    hasSessionUser: false,
  });
  assert.equal(decision.kind, "login");
  const src = readSrc("src/lib/auth-restore.ts");
  assert.doesNotMatch(src, /hasLikelyPersistedSession|hadPersistedHint/);
});

await test("gate no longer defers login forever on persisted hint", () => {
  const requireAuth = readSrc("src/lib/require-auth.ts");
  assert.doesNotMatch(requireAuth, /shouldDeferLoginRedirect/);
  assert.doesNotMatch(requireAuth, /session initializing — defer login redirect/);
  assert.doesNotMatch(requireAuth, /persisted session — allow in-app navigation/);
  assert.doesNotMatch(requireAuth, /gate error with persisted session — allow navigation/);
  assert.match(requireAuth, /decideAppShellAfterAuthRestore/);
  assert.match(requireAuth, /authShellGateTimeoutMs/);
  assert.match(requireAuth, /blockGuestAccess/);
});

await test("missing session must not markStartupResolved as authenticated shell", () => {
  const requireAuth = readSrc("src/lib/require-auth.ts");
  assert.doesNotMatch(
    requireAuth,
    /defer login redirect[\s\S]{0,80}markStartupResolved\("\/"\)/,
  );
  assert.match(requireAuth, /requireAppShellAccess:no-session/);
});

await test("getSession settle caches unauthenticated and clears stale blob", () => {
  const authSession = readSrc("src/lib/auth-session.ts");
  assert.match(authSession, /authRestoreTimeoutMs/);
  assert.match(authSession, /clearPersistedAuthSession/);
  assert.match(authSession, /markClientAuthSessionSettledUnauthenticated/);
  assert.match(authSession, /restore-failed-or-timeout/);
  assert.match(authSession, /restoreInFlight/);
  assert.doesNotMatch(authSession, /cachedClientSession = undefined;\s*\n\s*\} else \{/);
});

await test("5. native Preferences remove is awaited on session key and clearPersistedAuthSession", () => {
  const storage = readSrc("src/lib/supabase-auth-storage.ts");
  assert.match(storage, /export async function clearPersistedAuthSession/);
  assert.match(storage, /await Promise\.all\(/);
  assert.match(storage, /Preferences\.remove/);
  assert.match(storage, /if \(key === SUPABASE_STORAGE_KEY\) \{[\s\S]*await persistToPreferences\(key, null\)/);
  const clearState = readSrc("src/lib/clear-auth-state.ts");
  assert.match(clearState, /await clearPersistedAuthSession\(\)/);
  assert.match(clearState, /AUTH_RESTORE_TIMEOUT\.nativeClearMs/);
});

await test("6. warm/hydrate shares in-flight promise; done only after hydrate", () => {
  const storage = readSrc("src/lib/supabase-auth-storage.ts");
  assert.match(storage, /warmSupabaseAuthStorageInFlight/);
  assert.match(storage, /if \(warmSupabaseAuthStorageInFlight\) return warmSupabaseAuthStorageInFlight/);
  assert.match(storage, /warmSupabaseAuthStorageDone = true/);
  const doneBeforeAwait = /warmSupabaseAuthStorageDone = true;\s*const hydrated = await/;
  assert.doesNotMatch(storage, doneBeforeAwait);
  assert.match(
    storage,
    /await hydrateSessionFromPreferences[\s\S]*warmSupabaseAuthStorageDone = true/,
  );
});

await test("AuthProvider applySession(null) settles loading", () => {
  const authHook = readSrc("src/hooks/use-auth.tsx");
  assert.match(authHook, /markClientAuthSessionSettledUnauthenticated/);
  assert.match(authHook, /applySession\(s\)/);
  assert.match(authHook, /applySession\(null\)/);
  assert.match(authHook, /finishLoading/);
  assert.match(authHook, /AUTH_RESTORE_TIMEOUT\.nativeMs/);
});

await test("7. valid session path still restores without forced logout", () => {
  const authSession = readSrc("src/lib/auth-session.ts");
  assert.match(authSession, /outcome: "authenticated"/);
  assert.match(authSession, /if \(session\?\.user\)/);
  const requireAuth = readSrc("src/lib/require-auth.ts");
  assert.match(requireAuth, /hasSessionUser: Boolean\(session\?\.user\)/);
  assert.match(requireAuth, /markStartupResolved\("\/"\)/);
});

console.info("[verify-auth-bootstrap-settle] all checks passed");
