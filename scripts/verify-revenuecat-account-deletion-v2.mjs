import assert from "node:assert/strict";
import { deleteRevenueCatCustomerV2 } from "../src/lib/account-deletion/revenuecat-customer-delete.server.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "proj_test";
const SECRET = "test_secret_never_log";
const env = {
  REVENUECAT_V2_SECRET_API_KEY: SECRET,
  REVENUECAT_PROJECT_ID: PROJECT_ID,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function run(responses) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, "unexpected RevenueCat request");
    return response;
  };
  await deleteRevenueCatCustomerV2(env, USER_ID, { fetcher });
  return calls;
}

const deleteCalls = await run([
  json({ items: [{ object: "customer", id: "rc_customer_1", project_id: PROJECT_ID }] }),
  json({ items: [{ object: "customer.alias", id: USER_ID }], next_page: null }),
  json({ object: "customer", id: "rc_customer_1", deleted_at: Date.now() }),
]);
assert.equal(deleteCalls.length, 3);
assert.match(deleteCalls[0].url, /\/v2\/projects\/proj_test\/customers\?search=/);
assert.equal(new URL(deleteCalls[0].url).searchParams.get("search"), USER_ID);
assert.match(deleteCalls[1].url, /\/customers\/rc_customer_1\/aliases/);
assert.match(deleteCalls[2].url, /\/customers\/rc_customer_1$/);
assert.equal(deleteCalls[2].init.method, "DELETE");
assert.equal(deleteCalls[2].init.headers.Authorization, `Bearer ${SECRET}`);

// The authenticated Supabase UUID can directly be the canonical customer ID.
const directCalls = await run([
  json({ items: [{ object: "customer", id: USER_ID, project_id: PROJECT_ID }] }),
  json({ object: "customer", id: USER_ID, deleted_at: Date.now() }),
]);
assert.equal(directCalls.length, 2);
assert.equal(directCalls[1].init.method, "DELETE");

// Missing/already-deleted customers are idempotent success.
assert.equal((await run([json({ items: [] })])).length, 1);
assert.equal((await run([json({ items: [], next_page: null }, 404)])).length, 1);
assert.equal(
  (await run([json({ items: [{ id: USER_ID, project_id: PROJECT_ID }] }), json({}, 404)])).length,
  2,
);

await assert.rejects(
  () => run([json({ items: [{ id: "other", project_id: PROJECT_ID }] }), json({ items: [] })]),
  /account_revenuecat_customer_mismatch/,
);
await assert.rejects(
  () => run([json({ items: [{ id: USER_ID, project_id: "wrong_project" }] })]),
  /account_revenuecat_project_mismatch/,
);
for (const status of [401, 403]) {
  await assert.rejects(() => run([json({}, status)]), /account_revenuecat_lookup_unauthorized/);
  await assert.rejects(
    () => run([json({ items: [{ id: USER_ID, project_id: PROJECT_ID }] }), json({}, status)]),
    /account_revenuecat_delete_unauthorized/,
  );
}
await assert.rejects(() => run([json({}, 503)]), /account_revenuecat_lookup_retryable/);
await assert.rejects(
  () => run([json({ items: [{ id: USER_ID, project_id: PROJECT_ID }] }), json({}, 500)]),
  /account_revenuecat_delete_retryable/,
);

const source = await import("node:fs").then(({ readFileSync }) =>
  readFileSync("src/lib/account-deletion/revenuecat-customer-delete.server.ts", "utf8"),
);
assert.doesNotMatch(source, /cancel|refund|expire|revoke.*subscription/i);
assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
assert.doesNotMatch(source, /targetUserId|customerId.*body|clientCustomer/);
assert.match(source, /readServerEnv\(env, "REVENUECAT_V2_SECRET_API_KEY"\)/);
assert.doesNotMatch(source, /readServerEnv\(env, "REVENUECAT_SECRET_API_KEY"\)/);

await assert.rejects(
  () =>
    deleteRevenueCatCustomerV2(
      { REVENUECAT_SECRET_API_KEY: SECRET, REVENUECAT_PROJECT_ID: PROJECT_ID },
      USER_ID,
      { fetcher: async () => json({ items: [] }) },
    ),
  /account_revenuecat_configuration_missing/,
);
await assert.rejects(
  () =>
    deleteRevenueCatCustomerV2({ REVENUECAT_PROJECT_ID: PROJECT_ID }, USER_ID, {
      fetcher: async () => json({ items: [] }),
    }),
  /account_revenuecat_configuration_missing/,
);

console.log("RevenueCat V2 account deletion contract: PASS");
