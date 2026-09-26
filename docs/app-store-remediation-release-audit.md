# App Store remediation release audit — 2026-09-27

Baseline: `92b2086c130b3080637cc479231826f6b947be8a`, branch `stable`.
User reports final iPhone and iPad Air 11-inch / iPadOS 27 acceptance PASS,
including public legal documents, Login legal links, Explore, carousel/sheet,
Place Detail fallback and semantic eligibility. This report supersedes the
pending device-acceptance status in the historical remediation reports.

## Scope decision

55 initial changed/untracked files. 52 included, 3 excluded; this report is one
additional maintained audit file. No unrelated production refactor.
A (App Store remediation) is the umbrella for B–L. B: legal/public routing;
C: SSR isolation; D: scoped router patch; E: Explore touch layout; F: fallback;
G: semantic gate; H: provider normalization; I: regression scripts;
J: reports/fixtures; K: iOS settings; L: generated metadata; M: exclusions.

| File | Group | Decision |
| --- | --- | --- |
| `docs/akihabara-candidate-admission-audit.json` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `docs/app-store-review-remediation.md` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `docs/explore-semantic-eligibility-verification.md` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `docs/maletas-generalization-verification.md` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `docs/place-detail-fallback-verification.md` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `docs/router-pending-lifecycle-fix.md` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `ios/App/App/config 2.xml` | M | Exclude; byte-identical generated config copy, preserved with local Git exclude. |
| `ios/App/App/config 3.xml` | M | Exclude; byte-identical generated config copy, preserved with local Git exclude. |
| `scripts/audit-akihabara-candidates.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/fixtures/akihabara-candidate-audit.json` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `scripts/fixtures/explore-provider-evidence.json` | J | Include; reproducible provider evidence, decision audit or historical verification/provenance. |
| `scripts/patch-tanstack-router.mjs` | D | Include; reproducible guarded router patch and automatic install hook. |
| `scripts/trace-explore-provider-eligibility.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-akihabara-candidate-set.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-app-review-browser.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-explore-semantic-eligibility.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-explore-sheet-geometry.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-place-detail-photo-renderer.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-protected-login-bootstrap.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-router-pending-lifecycle.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `src/lib/legal-navigation.ts` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/routes/terms.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `ios/App/App.xcodeproj/project.pbxproj` | K | Include; preserve accepted Build 81 project settings / plist serialization. |
| `ios/App/App/Info.plist` | K | Include; preserve accepted Build 81 project settings / plist serialization. |
| `package-lock.json` | D | Include; reproducible guarded router patch and automatic install hook. |
| `package.json` | D | Include; reproducible guarded router patch and automatic install hook. |
| `scripts/verify-explore-city-logic.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-explore-map-cache.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-nearby-runtime-contract.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `scripts/verify-support-privacy-public.mjs` | I | Include; directly related regression or repeatable diagnostic. |
| `src/App.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/components/MapExploreSheet.tsx` | E | Include; bounded vertical scrolling and native touch/snap behavior. |
| `src/components/map/MapExplorePlaceCards.tsx` | E | Include; bounded vertical scrolling and native touch/snap behavior. |
| `src/components/map/PlaceDetailSheet.tsx` | F | Include; shared no-photo fallback renderer and category propagation. |
| `src/generated/app-bundle-meta.ts` | L | Exclude; restored HEAD after build, following existing release audit convention. |
| `src/lib/ai/normalize-google-place.ts` | H | Include; preserve provider evidence through normalization and search field mask. |
| `src/lib/explore-places-eligibility.ts` | G | Include; shared semantic admission, cache revalidation and relaxed-path protection. |
| `src/lib/filter-explore-places.ts` | G | Include; shared semantic admission, cache revalidation and relaxed-path protection. |
| `src/lib/google-maps-api.ts` | H | Include; preserve provider evidence through normalization and search field mask. |
| `src/lib/home-nearby-eligibility.ts` | G | Include; shared semantic admission, cache revalidation and relaxed-path protection. |
| `src/lib/is-recommendable-place.ts` | G | Include; shared semantic admission, cache revalidation and relaxed-path protection. |
| `src/lib/map-places-cache.ts` | G | Include; shared semantic admission, cache revalidation and relaxed-path protection. |
| `src/lib/place-category.ts` | G | Include; shared semantic admission, cache revalidation and relaxed-path protection. |
| `src/lib/place-detail-resolve.ts` | F | Include; shared no-photo fallback renderer and category propagation. |
| `src/lib/place-result.ts` | H | Include; preserve provider evidence through normalization and search field mask. |
| `src/lib/public-routes.ts` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/routeTree.gen.ts` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/router.tsx` | C | Include; isolate SSR Router and QueryClient. |
| `src/routes/__root.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/routes/_app.map.tsx` | F | Include; shared no-photo fallback renderer and category propagation. |
| `src/routes/login.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/routes/login/legal.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/routes/privacy.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/routes/support.tsx` | B | Include; public legal route/provider boundary, canonical links or generated Terms route. |
| `src/styles.css` | E | Include; bounded vertical scrolling and native touch/snap behavior. |

## Safety and release authority

- Commit candidates contain no configured private secret value (14 private values
  checked without logging), private-key blocks, local user absolute paths, secret
  files, screenshots, simulator/DerivedData/recovery output or temporary servers.
  Fixture place/photo resource IDs are provider evidence, not credentials.
- No sample place ID/name/address blacklist in production. Existing generic
  business/type/name classification remains; structural address words are context,
  not an unconditional tenant ban. Explicit visitor types pass with no photos,
  hours or reviews. Ambiguous commerce requires corroboration. Rejected candidates
  cannot return through cache, relaxed filtering or candidate replenishment.
- Both config copies exactly match canonical config.xml. They remain on disk,
  excluded by local `.git/info/exclude`; no shared ignore change or file deletion.
- Info.plist parses identically to baseline. Existing Xcode migration and Build 81
  changes are preserved. Marketing version 1.0, build 81, device family 1,
  bundle ID com.shuode.roamie. No settings changed during this audit.
- Product IDs remain roamie_premium_monthly / roamie_premium_yearly; entitlement
  remains premium. Production public-env billingEnabled is true. No billing code
  or RevenueCat configuration changed.
- Generated metadata restored to baseline after build/sync, following the existing
  `docs/final-release-audit.md` and remediation convention. Build-time metadata in
  ignored client/iOS artifacts describes this pre-commit build; it is not a claim
  that those artifacts were built from the future commit. Both artifact trees are
  identical. The next authorized release build regenerates its own metadata.
- Historical reports/fixtures are retained for provenance and replay; they are not
  a new live-device trace. This release audit is the current acceptance authority.

## Verification

Isolated clean npm ci automatically applies router-core 1.171.2 patch. Source,
ESM and CJS match workspace checksums; second application is idempotent. Deliberate
CJS tampering fails SHA guard without partial writes. Lockfile is unchanged by
installation; its only baseline difference is root hasInstallScript. Actual router
pending-snapshot, redirect, invalidation and background revalidation tests pass in
that isolated install. Patch uses paths relative to its module, not local paths.

23 directly related suites pass: semantic eligibility, 137-candidate set, Explore
city/cache/progressive-search/request-storm/native-search/offline-recovery,
Nearby runtime, Home Nearby loading/weather/photo locale, category fidelity,
Place Detail device/renderer, required diversity, place identity, support/privacy,
legal subscription disclosures/return targets, router pending lifecycle, production
logging, release authority boundaries and auth bootstrap. Actual candidate audit
replays 137 records: 96 accepted / 41 rejected; five thin ambiguous candidates all
rejected. Maletas and Chiyoda are rejected; Playacolores remains eligible. All 16
positive-control categories pass. Provider photo fixtures render fallback for
Playacolores/Chiyoda and provider-photo for UDX; no old empty hero in fallback cases.

Production build and cap:sync:ios pass. All 127 client files match iOS copies
byte-for-byte. Bundle contains semantic gate, Place Detail fallback and scroll-snap
CSS. Shipped router code references loadPromise with neither completed-load clearing
assignment. Bundled config has no development server URL.

Browser harness cleanup explicitly closes HTTP connections; the review harness also
stops esbuild after assertions. No app behavior or assertions were weakened.

Final browser gates PASS with exit code 0: actual production public routes and Login
legal buttons; protected Login 104 checks / 20 race rounds / 80 document loads,
zero blank Login or uncaught errors; component review at four iPhone/iPad viewports;
Explore geometry/gesture suite at four widths with 81 states. Horizontal touch,
vertical scrolling, mandatory snap, expansion, collapse and resize are covered.
The initial review-harness run passed assertions but retained resources and was
interrupted; its cleanup was fixed and the final full rerun exited normally.

Final whitespace gate PASS. Remote stable was fetched and matched baseline before
commit. Release gate PASS; authorized single commit and normal stable push only.
No deploy, Archive, upload, App Store Connect changes or Build 82 bump.
