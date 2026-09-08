# Staging Plus entitlement PostgREST verification

Run this only against the `staging-security-test` Preview Branch after migration
`20260909110000_plus_entitlement_resolver_authority` has succeeded. Do not use
production credentials or endpoints.

Use two disposable staging Auth users, A and B. Obtain their staging access tokens
through the normal staging sign-in flow. Call PostgREST RPC
`resolve_user_plus_entitlement` with these cases:

| Authorization | `p_user_id` | Expected result |
| --- | --- | --- |
| User A bearer token | User A UUID | HTTP 200 and an entitlement snapshot |
| User A bearer token | User B UUID | RPC error with SQLSTATE `42501` |
| Staging anon key only | Either UUID | execute permission denied |
| Staging service-role key | User A or User B UUID | HTTP 200 |

For authenticated calls, send both the staging anon/publishable key in `apikey`
and the user's access token in `Authorization: Bearer …`. For the service-role
case, keep the staging service-role key server-side and use it for both headers.
Never put a service-role key in client code, shell history, screenshots, logs, or
committed files.

The SQL Editor transaction test remains complementary: it verifies role/JWT guard
behavior and rolls back its fixtures. These PostgREST calls verify the real
`authenticator` → JWT role path that SQL Editor cannot reproduce exactly.
