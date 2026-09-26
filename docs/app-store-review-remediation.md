# App Store Review remediation — 2026-09-26

Baseline: `92b2086c130b3080637cc479231826f6b947be8a`.
No commit, push, Archive, deployment, build-number, pricing, entitlement, Product ID, subscription sync, or metadata changes.

## Confirmed root causes

### Login legal / public Support

`App` deliberately skipped `AppProviders` on `/support`, `/privacy`, and `/login/legal`. All three document renderers still called `useI18n`, which throws without `I18nProvider`. Rendering the original Support and Privacy components under the original public-provider boundary reproduced `useI18n must be used within I18nProvider`.

Native iOS Login used TanStack navigation to `/login/legal?doc=...` (with a WebView location fallback); web Login used the existing in-tree localized legal overlay. The old URL exists in the router: it was not merely a missing-route 404. It also unnecessarily shared the Login parent. Current production was inspected anonymously: `/support`, `/privacy`, and both old legal URLs eventually showed the app initialization error despite HTTP 200 for Support. `/terms` was not an existing public document route.

Public routes now receive only the existing localization provider and native live-interaction hook, not auth/subscription providers. `/privacy` and `/terms` are canonical URLs in `LEGAL_PATHS`. Native Login uses them; old legal URLs use an explicit document redirect with a sanitized return target. This avoids a reproduced Start redirect/hydration case where the URL changed but the response body contained only an entry script. Web Login and subscription sheets continue using the same localized document content. Support retains its UI/contact information and adds the missing Terms entry. Root/Login guards use the router's destination location, and public access is checked before onboarding hydration.

Production Worker verification additionally reproduced an SSR redirect loop on Terms: the module-level router singleton reused request history/search state. Routers and QueryClients are now isolated per SSR request; client router reuse is unchanged. The same direct URLs and sequential requests pass after this change.

### Recommended places clipped / cannot swipe up

The Explore map sheet is the strongest match to Apple's description; no reviewer screenshot or interaction recording was supplied, so the exact reviewed screen cannot be proven. Chat has a vertical message scroller; Home has vertical page scrolling and its carousel already allows both axes; planning and modal regressions were also checked.

The actual Explore list starts at 28% of page height (minimum 200 px). Its collapsed body used `shrink-0` / `overflow-y-hidden`, inside an `overflow-hidden` sheet; cards are 364 px tall. The carousel used `touch-action: pan-x` and a custom pointer handler could capture touch movement. The detail height calculation allowed 88% but the outer sheet was always capped at 70dvh.

A controlled browser replay of the original components at 820×1180 reproduced a 330 px sheet, a 432 px body reaching below the viewport, and `scrollTop=0` after a vertical touch gesture. The original component fails the new regression.

The body now remains a bounded `flex-1 min-h-0 overflow-y-auto` scroller in collapsed and expanded modes. Cards permit both touch axes; custom horizontal pointer capture is retained for mouse input while touch uses native scrolling. Only the handle owns sheet dragging. The outer maximum height follows the existing mode-specific calculated bound.

## Verification

- `verify-app-review-browser.mjs`: real MapExploreSheet / MapExplorePlaceCards / PlaceDetailSheet components; only network/media/affiliate and provider dependencies are mocked in the isolated component harness. Checks horizontal touch swipe, vertical touch swipe, end-of-content reachability, and touch handle expansion at 820×1180, 1180×820, 414×736, and 390×844. Real paywall buttons open the existing Privacy and Terms sheets under controlled subscription-provider fixtures; no purchase/restore is performed.
- With `REVIEW_URL=http://localhost:8791`, the browser test uses the actual production Worker and app, without component mocks, for HTTP 200, anonymous direct navigation, reload, old URL redirects, and Login legal buttons. Login testing seeds only the completed-onboarding flag; there is no authenticated user.
- 14 related existing suites pass: support/privacy public, legal return target, legal/subscription disclosures, saved scroll, planning responsive, Recommendation Review runtime, Recommendation Authority, Place Details device regressions, Explore request storm, Explore native search, production diagnostics boundary, release authority boundaries, auth bootstrap settle, and Plus provider/auth continuation (8 browser cases).
- Existing opening-hours/localized layout browser regression: 48 cases PASS.
- Production build and release artifacts verification PASS. Generated build metadata is restored; the generated route tree change is intentional for `/terms`.
- TypeScript: baseline/current 321 diagnostics, matched by source/code/message context; no new diagnostics. Absolute import paths cause expanded-message differences with identical underlying errors.
- ESLint (`src scripts`): baseline/current 7945 errors and 70 warnings; all 8015 source/rule/message diagnostics matched, no new diagnostics. New/updated verification scripts additionally pass targeted lint.
- `git diff --check`: PASS.

## Remaining acceptance / deployment boundary

The fixed Worker has only been run locally. The live site remains on the previous deployment and was not changed. Public production URLs require deployment and a repeat external check before resubmission.

Chrome touch/viewport simulation is not Safari, WKWebView, iPadOS 27, or physical iPhone compatibility-mode acceptance. Recheck those on device, including opening Login Privacy/Terms, returning to Login, full legal-document scrolling, and sliding/expanding Explore cards. Existing iOS live-interaction authority is reused, not replaced.

The two pre-existing user changes in `ios/App/App.xcodeproj/project.pbxproj` and `ios/App/App/Info.plist` are byte-for-byte preserved and excluded from this task's changes.
