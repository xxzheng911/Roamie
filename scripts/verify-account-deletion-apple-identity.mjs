import assert from "node:assert/strict";
import { appleSubjectFor } from "../src/lib/account-deletion/account-deletion.server";
import { evaluateAppleIdentityToken } from "../src/lib/account-deletion/apple-revoke.server";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (claims) => `${encode({ alg: "none" })}.${encode(claims)}.test`;
const now = 2_000_000_000;
const subject = "apple-stable-subject";
const clientId = "com.shuode.roamie";

assert.equal(
  appleSubjectFor({
    identities: [
      {
        provider: "apple",
        identity_id: "supabase-identity-row-uuid",
        id: subject,
        identity_data: { sub: subject },
      },
    ],
  }),
  subject,
  "Apple subject must come from identity_data.sub, not Supabase identity_id",
);
assert.equal(
  evaluateAppleIdentityToken(
    token({ sub: subject, aud: clientId, exp: now + 60 }),
    subject,
    clientId,
    now,
  ).valid,
  true,
);
assert.equal(
  evaluateAppleIdentityToken(
    token({ sub: "different-subject", aud: clientId, exp: now + 60, email: "same@example.test" }),
    subject,
    clientId,
    now,
  ).valid,
  false,
  "matching email must never override a different Apple subject",
);
assert.equal(
  evaluateAppleIdentityToken(
    token({ sub: subject, aud: clientId, exp: now + 60 }),
    "",
    clientId,
    now,
  ).valid,
  false,
  "missing canonical Apple identity must fail closed",
);
assert.throws(() => evaluateAppleIdentityToken("malformed", subject, clientId, now));

console.log("Account deletion Apple identity regression: PASS");
