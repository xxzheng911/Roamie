import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldIgnoreLoginFailure } from "../src/lib/auth-login-attempt.ts";

assert.equal(
  shouldIgnoreLoginFailure({ attempt: 1, currentAttempt: 2, succeeded: false, hasSession: false }),
  true,
  "a late failure from the previous account must be ignored",
);
assert.equal(
  shouldIgnoreLoginFailure({ attempt: 2, currentAttempt: 2, succeeded: true, hasSession: true }),
  true,
  "success makes later failure callbacks stale",
);
assert.equal(
  shouldIgnoreLoginFailure({ attempt: 2, currentAttempt: 2, succeeded: false, hasSession: true }),
  true,
  "an established Supabase session suppresses a late OAuth failure",
);
assert.equal(
  shouldIgnoreLoginFailure({ attempt: 2, currentAttempt: 2, succeeded: false, hasSession: false }),
  false,
  "a real failure for the active attempt remains visible",
);

const login = await readFile("src/routes/login.tsx", "utf8");
assert.match(login, /authAttemptRef\.current \+= 1/);
assert.match(login, /setAuthError\(null\)/);
assert.match(login, /shouldIgnoreLoginFailure/);

console.log("auth attempt isolation regression: PASS");
