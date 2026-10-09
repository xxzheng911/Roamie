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

The local `release-worker-upload.mjs --preserve-vars` change is deliberately NOT
part of this feature commit. A clean checkout of this commit must not assume
that option exists. Preserve and separately review/version the safe uploader
before any release; never fall back to its default `--keep-vars=false` behavior.

Cloudflare's deployment-management documentation requires `wrangler deploy` for
Durable Object class lifecycle migrations, including creating a new class.
Consequently, the first migration needs an explicitly reviewed rollout plan;
the normal `versions upload` followed by a later traffic switch must not be
assumed to support it. This preparation performs neither operation. Keep the
feature disabled during provisioning and define a rollback compatible with the
new namespace before release. Rebuild release metadata for the feature commit.

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
