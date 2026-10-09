# Visual Crossing climate integration

Local implementation only. Do not deploy or switch traffic without release approval.

## Verified provider contract

One authorized Timeline request used `include=stats`, `unitGroup=metric`, Tokyo
35.6762,139.6503, 2026-11-25 through 2026-11-30. HTTP 200, Asia/Tokyo,
queryCost 6. The sanitized fixture contains only dates, coordinates, temperature
statistics and billing metadata, never credentials or a keyed URL.

`normal.tempmin` and `normal.tempmax` are `[minimum, mean, maximum]`.
Only index 1 is used. Average the six daily means separately: 8.9167 / 13.6167 °C,
displayed as 9–14 °C. This is not an extreme range or a future forecast.
The provider's baseline years/sample sizes were not returned; do not label this
as a five-year or thirty-year average. Statistical precipitation is not displayed.

## Configuration still required at an approved release

- Add `VISUAL_CROSSING_API_KEY` as a **Worker Secret** using secure interactive
  entry. Never copy `.env` into a bundle, VITE variable, wrangler vars or Git.
- Provision the `VISUAL_CROSSING_CLIMATE` binding and the additive
  `v2-visual-crossing-climate` SQLite DO migration from wrangler.jsonc.
- Set `VISUAL_CROSSING_ENABLED=true` only after verifying the new binding,
  secret and release. Missing/false defaults to local seasonal fallback.
- Preserve every existing production variable, secret and binding, including
  `ABUSE_GUARD_ENFORCEMENT=true` and `GOOGLE_GLOBAL_DAILY_UNITS=100000`.
- No Supabase schema migration. Existing Google guard is not modified.

## Release preparation caveats

The separate uploader safety commit makes `--keep-vars=true` mandatory;
`--preserve-vars` remains a compatibility alias. Local vars/secret overrides and
the old `--enforcement` override are rejected. `--verify-only` checks artifacts
without network access. `--preflight-only` additionally reads production metadata
without uploading. Real uploads always run this preflight first. The latest
uploaded version must be the sole active version at 100%; required vars must
match, the Visual Crossing Secret must exist, and existing resource bindings must
match. Unknown resource types fail closed. Keep `VISUAL_CROSSING_ENABLED=false`
explicitly in production before the first release (absence disables runtime but
does not satisfy the release preflight).

Cloudflare's deployment-management documentation requires `wrangler deploy` for
Durable Object class lifecycle migrations, including creating a new class.
Consequently, the first migration needs an explicitly reviewed rollout plan;
the normal `versions upload` followed by a later traffic switch must not be
assumed to support it. Installed Wrangler 4.130.0 still prepares migration
metadata in its versions-upload path before the control-plane request; do not
use a real upload to probe whether a migration is accepted. The uploader now
rejects unprovisioned DO bindings/classes before invoking upload. This preparation
performs neither operation. Keep the
feature disabled during provisioning and define a rollback compatible with the
new namespace before release. Rebuild release metadata for the feature commit.

The explicit first-migration mode described below validates the live version and
complete bindings, preserves vars/secrets, requires the feature to remain false,
and allows only the additive climate class. It applies migration and code
together, never as an automatic fallback from normal upload.
Afterward, rollback should disable the feature or deploy compatible code retaining
both DO classes/bindings and migration history; do not assume pre-migration Worker
versions can be restored, and never delete namespaces to simulate rollback.

The `global-v1` DO name is a billing authority, not a cache version: do not rename
it on routine releases, since that would reset usage accounting. Budget is 900
reserved records per rolling 24 hours across this application's guarded calls.
Other uses of the same provider account, including the six-record probe, are not
visible to this ledger. This is an application limit, not a vendor account cap.

One active request, four queued distinct queries, 12-second end-to-end deadline,
6-second upstream timeout. Persist reservations before dispatch; no refunds on
uncertain failures, no automatic provider retries. Cache success for 6 hours and
failure for 15 minutes. Persistent admission lease also covers object restarts.
Missing storage fails closed. Unexpected/missing billing metadata opens a
persistent circuit breaker requiring investigation before re-enabling.

Forecast completeness and the existing OpenWeather/AI path remain unchanged.
Far/partially-out-of-range trips request only statistical climate, never blend
forecast values into the historical summary. Non-statistical/missing dates fail
to local seasonal guidance. Entering OpenWeather's horizon changes the input key
and invalidates a saved historical summary. No AI calls on the climate branch.
The existing Plus-protected server function remains protected; no entitlements
or Credits rules are changed.

## Local validation (no paid calls)

```
./node_modules/.bin/vite-node --config scripts/vite.verify.config.mjs scripts/verify-visual-crossing.mjs
node scripts/verify-visual-crossing-workerd.mjs
./node_modules/.bin/vite-node --config scripts/vite.verify.config.mjs scripts/verify-trip-outfit-weather.mjs
./node_modules/.bin/vite-node --config scripts/vite.verify.config.mjs scripts/verify-plan-optional-and-outfit.mjs
```

The workerd test intercepts all upstream traffic and uses a synthetic key.
Melbourne, cross-month/year and leap-date tests are synthetic contract fixtures,
not additional live provider queries. Production rollout/binding verification and
authenticated device smoke tests remain release-time checks.

## First migration entry (local preparation; not executed)

The uploader now supports `--first-climate-migration --expected-active <UUID>`.
It pins the production account `cb1835ce26e88097148685b0b1569bc3`, Worker
`roamie`, and checks the exact live version before any write. Add
`--preflight-only` for read-only checks, or `--dry-run` for Wrangler's local
validation **after** those same production checks pass. Neither option is a
substitute for approval to execute the real release. No automatic fallback exists.

Only the exact v1 AbuseGuard + v2 VisualCrossingClimate SQLite migration history
is permitted. Production must still be on `v1-abuse-guard`, have no climate
binding, and explicitly expose `VISUAL_CROSSING_ENABLED` as plaintext `false`.
The existing artifact, binding, secret and budget checks remain mandatory.
Only the climate binding may be new. `wrangler deploy --keep-vars=true` applies
migration and code deployment together; it is not a zero-traffic version upload.
Installed Wrangler preserves secrets on deploy when keep-vars is true. Raw deploy
output is captured and suppressed. After success, the script verifies the active
version, v2 migration tag and exact preservation of all previous binding metadata,
including namespace IDs. Failure stops without a retry or automatic rollback.
This mode does not implement or claim a distributed lock against concurrent
Dashboard changes: freeze manual releases/settings changes during the operation.

### Dashboard diagnosis and correction (user-operated)

Read-only checks found the production service and `roamie.tw/*` route in the
expected account. Version `77b8401e-9dc7-493c-bf45-ecdc0d15a193` is active at
100%. Its `VISUAL_CROSSING_ENABLED` binding is `secret_text`, not `plain_text`.
It is therefore deployed, not merely pending; the secret value cannot be read
back to prove OFF. The API key remains correctly typed as a secret. Previous
32 binding records are preserved. Unsubmitted browser-only edits are not visible
through the API.

In Cloudflare, select this account → Workers & Pages → roamie → Production →
Settings → Variables and Secrets. Change only VISUAL_CROSSING_ENABLED to Text
with the literal value false (no quotes). If its type cannot be edited, remove
only this incorrectly typed flag and recreate it as Text; never remove the API
key. Review the settings-only diff and use the Dashboard's Deploy / Save and
deploy action as applicable. Saving a draft alone is insufficient. Do not deploy
local migration code as part of correcting the setting. Re-read the active
version after this user action; the old UUID must not be reused blindly.

### Compatible recovery runbook

Before the approved migration, retain the canonical release receipt/assets and
code containing both class exports, both bindings and the full v1/v2 history.
Keep Visual Crossing OFF. The current feature bundle with the flag OFF is the
baseline compatible recovery candidate; do not use a pre-v2 bundle or delete the
new namespace. A runtime regression needs a forward fix of this compatible
baseline through the normal guarded release flow, retaining `global-v1`, the
900-record ledger, existing namespace IDs and Google settings. The offline recovery artifact and SQLite restart are now verified as described
below; actual production recovery remains unexecuted. If deployment fails, first
inspect the live migration tag, namespaces, version and traffic: an error does
not establish that no lifecycle change occurred. If v2 is present, never rerun
the first-migration mode. Do not reset any storage to recover.

### Binding-only read-only health check

VisualCrossingClimate now handles GET `/__health` on its INTERNAL DO fetch
handler. No public Worker route forwards it. Authorization is the server-side
namespace binding capability, not a URL/header supplied by an end user. Only an
operator-authorized internal caller may obtain the production binding; never
add a public proxy for this operation. With that binding, call:

```js
const stub = env.VISUAL_CROSSING_CLIMATE.get(
  env.VISUAL_CROSSING_CLIMATE.idFromName("global-v1"));
const response = await stub.fetch("https://climate.internal/__health");
```

The response identifies `visual-crossing-health-v1`. It runs SELECT 1 and reads
`state` through SQLite-backed KV, validates ledger fields and returns aggregate
rolling usage only. Missing state is `budget: uninitialized`, usedRecords null,
not persisted zero. It never invokes the guard/provider, initializes/prunes the
ledger, changes the lease, or writes any storage. Exceptions/malformed state
return sanitized 503. General users have no access to DO bindings; no new public
or user-authenticated management API was introduced. Production health is still
a POST-MIGRATION check, not something local tests can claim already happened.

Unit tests use throwing write/upstream stubs. Real workerd tests cover absent,
populated, exhausted and malformed SQLite state and compare state before/after.
`verify-climate-recovery.mjs` imports the actual compiled recovery class and
restarts workerd with a shared persistent root, verifying existing usage survives
without external calls. Fixture seed operations exist only inside local tests.

### Prepared compatible recovery artifact

`node scripts/prepare-climate-recovery.mjs` verifies the canonical receipt and
creates an external snapshot with dist, pinned package metadata, the safe
uploader/verifier, and a hashed recovery manifest. It refuses overwrite. It
contains no env files; node_modules is a local dependency symlink outside dist.
If moved, recreate dependencies with the pinned package-lock. The manifest
records the base commit plus the uncommitted source patch hash so that a dirty
application build is not misrepresented as a clean committed release.

Run `node scripts/verify-climate-recovery.mjs <snapshot>` for actual built-class
SQLite restart verification. Run the snapshot's copied uploader with
`--verify-only` for its offline artifact/secret gate. This is a deployable
compatible forward-repair baseline with OFF enforced by the existing live-var
preflight, not a promise that every future application defect is fixed by
redeploying identical code. After v2 migration, use its normal guarded upload
flow and a separately authorized traffic switch; never rerun first migration.
Preserve namespace IDs, global-v1, all data and migrations. The preflight requires
OFF and unchanged Google settings and preserves live secrets rather than copying
credentials into the snapshot.

Validation in this preparation: mocked CLI regression covers normal uploads,
first migration dry-run command selection, exact migrations, account/version
pinning, secret-safe output, and post-deploy failure handling. Wrangler's local
config parser accepts the canonical generated config. After the user corrected the flag to Text false, the guarded migration dry-run
passed against c26d2177-1c32-4dc9-b32b-f104725c8f81. Following the health change,
canonical production build and secret scan passed; typecheck remained 327 with
no added/removed diagnostics. Actual migration/production recovery were not run.
