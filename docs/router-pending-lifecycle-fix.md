# Protected-route Login bootstrap stability

## Decision and upstream review (2026-09-27)

Keep the existing dependency versions and apply a small, reproducible router-core
patch. No auth, Login, provider, SSR policy, redirect, subscription or native
project source is changed by this fix.

| Package                 | Installed / package-lock | Official latest inspected |
| ----------------------- | ------------------------ | ------------------------- |
| @tanstack/react-router  | 1.170.4                  | 1.170.39                  |
| @tanstack/router-core   | 1.171.2                  | 1.171.32                  |
| @tanstack/react-start   | 1.168.6                  | 1.168.58                  |
| @tanstack/router-plugin | 1.168.6                  | 1.168.40                  |

Start 1.168.6 pins react-router 1.170.4, which pins router-core 1.171.2; the
installed plugin also pins core 1.171.2. No resolved versions, tarballs, integrity
values or dependency edges change. The lockfile only records the root install hook.

Official registry tarballs and GitHub history were inspected, not just issue titles:

- https://github.com/TanStack/router/issues/7910 describes the matching pending
  snapshot / cleared loadPromise / throw undefined mechanism. It was closed for
  lack of a reproducer, **not** as a confirmed fix.
- https://github.com/TanStack/router/pull/7805 replaces the loader architecture
  (279 files, +28,223/-8,503). Current releases use transaction/lane promises;
  the old load-matches implementation is gone.
- https://github.com/TanStack/router/pull/8055 changes root-document Suspense.
- https://github.com/TanStack/router/pull/8209 handles unknown error values.
- The latest react-router also changes react-store from ^0.9.3 to ^0.11.0.

No narrow, officially confirmed release for this exact Roamie trace was identified.
The new architecture may avoid it, but that is not proof of a minimal compatible
fix. No public route API break is asserted; rather, upgrading would require a
coordinated Start/router/plugin/store and SSR/bootstrap qualification. This release
uses a two-site lifecycle patch instead of that larger migration. Existing route
APIs, route generation, beforeLoad/redirect semantics, defaultSsr:false, Vite
integration and peer dependency versions remain unchanged.

## Root cause and patch

The initial `/_app.beforeLoad` legitimately redirects a signed-out session to
`/login`. During client bootstrap, a React render can retain an older root match
with status `pending`, while router-core has resolved and cleared its shared
`_nonReactive.loadPromise`. MatchInner then throws undefined instead of a thenable.
React's root uncaught handler runs and the root is cleared, even though the router
subsequently has successful root/Login matches and location `/login`.

The patch removes only the two completed-load assignments that clear loadPromise,
covering blocking and background completion. Resolution still happens at the
original point. `executeBeforeLoad` already installs a fresh promise on each next
load, resolves its predecessor and releases the predecessor reference. Thus an
older pending render has a settled thenable until the next cycle replaces it;
there is no added wait, timer, hard reload, auth bypass, render-null fallback or
error swallowing. Each match retains a settled promise, not an unbounded chain.

`scripts/patch-tanstack-router.mjs` follows the repository's existing versioned
patch-script convention. It validates version 1.171.2 and exact before/after SHA-256
for source, ESM and CJS, preflights all three before writing, and is idempotent.
Unexpected versions/content fail install. `postinstall` applies it automatically;
there is no new patch-package dependency and no unrecorded node_modules edit.
If installing with --ignore-scripts, explicitly run the patch script before build.

Removal: qualify an official coordinated upgrade against these regressions, then
remove the patch and install hook together. Do not make checksum failure permissive.

## Verification

- `node scripts/verify-router-pending-lifecycle.mjs`: actual pending snapshots retain
  a resolved thenable after redirect; synchronous invalidation replaces it; background
  revalidation remains usable and settles. PASS.
- `REVIEW_URL=http://localhost:8793 npm run verify:protected-login-bootstrap`:
  real production bundle, no router/auth mocks. 104 checks, 20 race rounds / 80
  repeated document navigations. PASS.
- Independent temporary copy: `npm ci --no-audit --no-fund`, automatic patch,
  production build, and the same browser gate on port 8795: another 104 checks /
  20 rounds / 80 document navigations. PASS. Patched files match byte-for-byte;
  package-lock unchanged by installation.
- Negative control: same browser test against the previously built unpatched
  92b2086 artifact fails at /saved with REACT_UNCAUGHT. The test detects the actual
  defect, not merely URL changes.
- Every protected case checks browser and router location, resolved state, successful
  matches, no pending matches, visible Login DOM and app frame, runtime errors,
  root error callback, and excessive redirect count. Cold contexts, direct Login,
  saved/map/profile, public-to-protected, legacy legal redirects, SPA transitions,
  refresh and repeated document loads are covered.
- 19 existing suites pass: public/privacy/legal-return/disclosures, saved-scroll,
  responsive planning, review/reason authority, Place Details, Explore storm/native
  search, production diagnostics boundary, release authority boundary, auth bootstrap,
  auth-attempt isolation, entitlement authority, search commit, provider display,
  Apple deletion identity and recent-auth contracts.
- Real provider browser transition suite: 8 cases PASS, one subscription instance.
- Actual auth guard: signed-in fixture accepted and signed-out state redirected on
  four protected paths; onboarding-incomplete routes go to welcome. This is a
  controlled cached-session test, not a real Apple/Supabase login.
- Actual getRouter: six concurrent SSR routers and QueryClients remain isolated.
- Remediation browser: public/legacy legal URLs, Login Privacy/Terms, subscription
  Privacy/Terms, four touch viewports, horizontal cards, vertical content reachability,
  drag expansion. PASS. Supplemental reserved-safe-area/collapse checks also run.

Production build and diff whitespace gates pass. New verification scripts are
Prettier-formatted and ESLint-clean. Historical project technical debt is not changed.
The original 17 remediation files and the two preexisting iOS settings are preserved.

## Remaining device acceptance

Actual Apple account authorization/Face ID, callback/deep-link delivery, logout and
session restore on iPhone/iPad remain physical-device acceptance items. Static
review preserves Apple nonce -> token exchange and existing navigation contracts;
no RevenueCat, subscription, deep-link or native project logic was edited.
Browser touch simulation is not physical Safari/WKWebView validation. This gate
allows deployment + device acceptance, not automatic App Store approval. No deploy,
commit, push, Archive or build-number bump is performed here.
