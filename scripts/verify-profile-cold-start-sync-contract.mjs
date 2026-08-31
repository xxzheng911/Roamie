import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const profile = read("src/routes/_app.profile.tsx");
const sync = read("src/lib/travel-pref-sync.ts");
const canonical = read("src/lib/access/subscription-canonical.ts");

// 1-4, 8: cached/default shell renders without auth, subscription, or remote profile gates.
assert.doesNotMatch(profile, /if \(authLoading\) \{\s*return \(/);
assert.doesNotMatch(profile, /if \(userId && loading && !profileSnapshotRef\.current\) \{/);
assert.match(profile, /source: initialProfile \? "local_snapshot" : "default_shell"/);
assert.match(profile, /\[PROFILE_REMOTE_HYDRATION_SETTLED\]/);
assert.match(profile, /finally \{\s*setLoading\(false\)/);

// 5-7: only an explicit save may surface deferred-sync feedback.
assert.match(sync, /source === "travel-quiz-save"\) return "user_initiated_save"/);
assert.match(sync, /source === "boot-pending-sync"\) return "boot_pending_sync"/);
assert.match(sync, /=== "user_initiated_save" && isTimeoutError\(error\)/);
assert.match(sync, /scheduleRetry\(kind, source, run\)/);

// 9-10: remote hydration remains authoritative; unresolved entitlement remains non-Plus.
assert.match(canonical, /if \(!state\.hydrated\) return false/);
assert.match(profile, /const \{ hasPlusAccess, subscriptionHydrated \} = useAccess\(\)/);
assert.match(profile, /showPlusPersona = hasPlusAccess && onboarded/);

for (const marker of [
  "PROFILE_COLD_START_MOUNT",
  "PROFILE_RENDER_GATE",
  "PROFILE_FIRST_MEANINGFUL_RENDER",
  "PROFILE_REMOTE_HYDRATION_SETTLED",
]) {
  assert.match(profile, new RegExp(`\\[${marker}\\]`));
}

console.log("verify:profile-cold-start-sync-contract passed");
