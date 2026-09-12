import assert from "node:assert/strict";
import { evaluateRecentAuthentication } from "../src/lib/account-deletion/account-deletion.server.ts";

const NOW = 2_000_000_000;

function requestWithClaims(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return new Request("https://staging.example.invalid/api/account/delete", {
    headers: { Authorization: `Bearer ${encode({ alg: "none" })}.${encode(claims)}.signature` },
  });
}

const freshGoogle = evaluateRecentAuthentication(
  requestWithClaims({
    iat: NOW,
    amr: [{ method: "oauth", timestamp: NOW - 30 }],
  }),
  NOW,
);
assert.equal(freshGoogle.pass, true);
assert.equal(freshGoogle.source, "jwt_amr");
assert.equal(freshGoogle.sessionAgeSeconds, 30);

const oldGoogleWithFreshAccessToken = evaluateRecentAuthentication(
  requestWithClaims({
    iat: NOW,
    amr: [{ method: "oauth", timestamp: NOW - 3_600 }],
  }),
  NOW,
);
assert.equal(
  oldGoogleWithFreshAccessToken.pass,
  false,
  "refresh-only access-token iat must not satisfy recent authentication",
);

assert.equal(
  evaluateRecentAuthentication(requestWithClaims({ iat: NOW }), NOW).pass,
  false,
  "iat alone is token issuance, not authentication evidence",
);
assert.equal(
  evaluateRecentAuthentication(
    requestWithClaims({ amr: [{ method: "password", timestamp: NOW - 601 }] }),
    NOW,
  ).pass,
  false,
);
assert.equal(
  evaluateRecentAuthentication(
    requestWithClaims({ amr: [{ method: "password", timestamp: NOW + 60 }] }),
    NOW,
  ).pass,
  false,
  "materially future authentication timestamps fail closed",
);

console.log("Account deletion recent-auth regression: PASS");
