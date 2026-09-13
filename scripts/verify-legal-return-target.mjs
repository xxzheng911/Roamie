import assert from "node:assert/strict";
import { resolveLegalReturnTarget } from "../src/lib/legal-return-target.ts";

// support -> privacy -> back -> support
assert.equal(resolveLegalReturnTarget("/support"), "/support");

// login -> privacy -> back -> login
assert.equal(resolveLegalReturnTarget("/login"), "/login");

// missing from -> fallback login
assert.equal(resolveLegalReturnTarget(undefined), "/login");
assert.equal(resolveLegalReturnTarget(null), "/login");

// invalid from -> no open redirect
assert.equal(resolveLegalReturnTarget("https://evil.com"), "/login");
assert.equal(resolveLegalReturnTarget("//evil.com"), "/login");
assert.equal(resolveLegalReturnTarget("/../support"), "/login");
assert.equal(resolveLegalReturnTarget("/support?x=1"), "/login");
assert.equal(resolveLegalReturnTarget("/auth/callback"), "/login");

console.info("[verify-legal-return-target] PASS");
