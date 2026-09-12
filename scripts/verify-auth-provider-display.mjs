import assert from "node:assert/strict";
import { resolveAuthProviderForDisplay } from "../src/lib/auth-provider.ts";

const user = (provider, providers = undefined, identities = []) => ({
  app_metadata: { provider, ...(providers ? { providers } : {}) },
  identities,
});

assert.equal(resolveAuthProviderForDisplay(user("apple")), "apple");
assert.equal(resolveAuthProviderForDisplay(user("google")), "google");
assert.equal(resolveAuthProviderForDisplay(user("email")), "email");
assert.equal(resolveAuthProviderForDisplay(user("github")), null);
assert.equal(
  resolveAuthProviderForDisplay(user(undefined, ["google"], [{ provider: "google" }])),
  "google",
);
assert.equal(
  resolveAuthProviderForDisplay(
    user(undefined, ["google", "apple"], [{ provider: "google" }, { provider: "apple" }]),
  ),
  null,
  "multiple identities without a primary provider must not pick an unstable array entry",
);

console.log("Auth provider display regression: PASS");
