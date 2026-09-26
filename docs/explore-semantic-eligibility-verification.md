# Explore semantic eligibility — 2026-09-27

## A–B. Live provider evidence

Read-only Google Places v1 Place Details calls, languageCode=en, using the repository-configured key in request headers only. Raw responses: `scripts/fixtures/explore-provider-evidence.json`. No key or environment file contents were printed. Missing fields below mean **not returned**, not verified nonexistence. The initial request for `entrance` was rejected as an unsupported field; the successful request omitted it and retained `accessibilityOptions`.

| Field | Playacolores | Chiyoda Building II |
| --- | --- | --- |
| placeId | "ChIJJxdtWymPGGAR-pxIzxoR4m4" | "ChIJmVTkbkOPGGARf4Y6vd2yJ78" |
| displayName | {"text": "Playacolores", "languageCode": "ja"} | {"text": "Chiyoda Building II", "languageCode": "en"} |
| primaryType | "art_gallery" | "shopping_mall" |
| types | ["art_gallery", "point_of_interest", "establishment"] | ["shopping_mall", "point_of_interest", "establishment"] |
| businessStatus | "OPERATIONAL" | "OPERATIONAL" |
| pureServiceAreaBusiness | false | false |
| rating | 5 | 5 |
| userRatingCount | 1 | 1 |
| regularOpeningHours | Not returned | Not returned |
| currentOpeningHours | Not returned | Not returned |
| websiteUri | "https://www.playacolores.jp/" | Not returned |
| nationalPhoneNumber | "080-5195-4911" | "03-5818-3858" |
| internationalPhoneNumber | "+81 80-5195-4911" | "+81 3-5818-3858" |
| formattedAddress | "Japan, 〒110-0016 Tokyo, Taito City, Taitō, 1-chōme−33−１２ 船山ビル 201" | "5-chōme-16-17 Ueno, Taito City, Tokyo 110-0005, Japan" |
| location | {"latitude": 35.702112299999996, "longitude": 139.7783993} | {"latitude": 35.704944499999996, "longitude": 139.7753526} |
| Google Maps URI | "https://maps.google.com/?cid=7989967495753145594&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAIYBCAA" | "https://maps.google.com/?cid=13774174650768197247&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAIYBCAA" |
| accessibilityOptions | {"wheelchairAccessibleParking": false, "wheelchairAccessibleEntrance": false} | {"wheelchairAccessibleParking": false} |
| editorialSummary | Not returned | Not returned |
| photos count | 0 (photos omitted) | 0 (photos omitted) |

## C–D. Diagnosis before production source edits

The provider contradicts the initial assumption that these are both generic-only POIs:

- **Playacolores is explicitly art_gallery, OPERATIONAL, with website and phone.** Per P5, this was reported before the fix and it is retained, not forced into a negative fixture.
- **Chiyoda Building II is explicitly shopping_mall.** The change treats the combination of a building identity, an uncorroborated mall tag, no hours and one review as ambiguous structural identity. It does not assert Google returned a building type.

The actual iPad's historical request log, GPS, selected category, query and candidate list are unavailable. Exact historical candidate source, distance and final ordinal rank cannot be recovered from a current details fetch. The following is source tracing plus deterministic replay of the actual fresh provider metadata, not fabricated device telemetry.

Path:

1. `places.functions.ts`: Nearby/Text requests use `PLACES_FIELD_MASK` (types, primaryType, ratings, photos, hours, status, coordinates). `mapRawPlaces` → `normalizeGooglePlace` preserves explicit provider primary identity and raw types, normalizes display name/address and opening state. For `screen === "explore"`, its final provider filter returns true and delegates selection to Explore.
2. `places-search-config.ts`: sight Nearby includes `art_gallery`; district multi-Nearby includes `shopping_mall`. These are compatible source lanes for these records, **not proof of the iPad's historical lane**. Sight query is `觀光景點 展望台 博物館 美術館 地標`; district query is `百貨 商場 市集 購物街區`.
3. `searchExploreCategoryPlaces` / `filterPlacesForExploreCategory` → `filterAndSelectExploreMapPlaces` → category filter → `passesExploreHardExclusions` → distance → `classifyExploreMapQualityTier` → `exploreMapQualityScore` → selection and quality fallback.
4. `mergeExploreAllCategoryResults` unions the subcategory results; `sortExploreCategoryPlaces` / `sortExplorePlacesViaRecEngine` applies the final ordering; `buildUnifiedPlaceCards` and the map adapter feed `MapExplorePlaceCards`.

Baseline replay (`scripts/trace-explore-provider-eligibility.mjs`):

| Place | Category / family | Accepted categories | Hard gate | Tier | Score at zero-distance control |
| --- | --- | --- | --- | --- | --- |
| Playacolores | attraction / museum_family | all, sight | true | 3 | 661 |
| Chiyoda Building II | district / shopping | all, district | true | 3 | 661 |

Baseline `isRecommendablePlace(..., "explore_map", { exploreMapTier: "display" })` was true for both. Their specific gallery/mall types already passed category rules; generic tags were not the reason these two passed. Nearby tier-3 score is `40 + rating*100 + min(reviews,500) + distanceBonus` (no photo bonus here), hence `541 + distanceBonus`, up to **661**. Actual distanceBonus is unknown without device GPS. Non-food final sorting prioritizes opening state then distance; All merge favors raw rating before review count. These can elevate a 5-star/one-review nearby result, but this task does not change ranking weights or ban low-review venues.

Additional authority gaps found:

- `passesExploreHardExclusions` had only negative checks, not proof of visitor purpose.
- `classifyExploreMapQualityTier` ended with `return 3`, so sparse metadata did not prevent admission.
- Insufficiency fallback selected from the same base pool regardless of tier; without a semantic base gate, quality relaxation could not fix bad identity.
- City relaxed sight/district filters accepted `point_of_interest`; display/fallback in `isRecommendablePlace` skipped the travel-friendly gate.
- Map recommendation cache reads bypassed current eligibility altogether.
- Existing category exclusions wrongly blocked churches/temples and ordinary parks; these conflicted with the requested positive controls.

Authority review: `place-category.ts` already owns Explore category/type rules; `home-nearby-eligibility.ts` owns Home surface/period policy; `is-recommendable-place.ts` owns cross-surface recommendation checks. `ai/place-category-family.ts` owns diversity grouping, and `ai/recommendation-exclusion.ts` represents user-requested exclusions, not visitor eligibility. The fix extends the existing category authority rather than introducing another family/type classifier. Family and user-exclusion authorities are unchanged.

## E–F. Change scope and rule

Production files changed in this task:

- `src/lib/place-category.ts`: `resolveExploreSemanticEligibility`, reusing its existing category type lists; positive park/cultural/religious admission.
- `src/lib/explore-places-eligibility.ts`: the canonical semantic gate precedes all quality tiers and hard exclusions; remove ordinary-park deny entries.
- `src/lib/is-recommendable-place.ts`: require the same gate for Explore strict/display/fallback, including saved recommendation candidates; preserve supporting metadata through conversion.
- `src/lib/filter-explore-places.ts`: preserve factual fields through that converter.
- `src/lib/home-nearby-eligibility.ts`: Home hard exclusions share the semantic gate; retain existing Home operational/time/quality policies.
- `src/lib/map-places-cache.ts`: invalidate memory/persisted recommendation entries containing ineligible candidates so existing search expansion can refill.
- `src/lib/ai/normalize-google-place.ts`, `src/lib/place-result.ts`: retain `pureServiceAreaBusiness` if supplied. Search field masks and provider requests are unchanged; this optional signal is only applied when available.
- `src/generated/app-bundle-meta.ts`: automatic build metadata refresh.

Rules:

1. Structural/residential/address/geographic/admin types and existing non-visitor exclusions do not enter recommendations.
2. Explicit visitor types pass without requiring photos, hours, phone, rating or review count. Includes food/cafe, museum/gallery, attractions, parks, shopping, worship/cultural landmarks, recreation and wellness types.
3. A building-style **venue name**, only a mall aggregate tag (or no visitor tag), no explicit shopping-name evidence, no hours, and fewer than five reviews yields `structural_identity_conflict`. This is a conservative ambiguity rule, not a factual claim that every such listing is an office. A cafe tenant, historical attraction, explicit shopping destination or corroborated mall remains eligible. The address is not treated as the venue name.
4. Unrecognized/generic types are not blanket denied. A recognized destination identity in the venue's own name plus OPERATIONAL status and hours/review evidence can pass as `supported_visitor_identity`. High rating, many reviews or generic establishment tags alone cannot establish purpose.
5. Quality relaxation and radius/text expansion cannot relax this gate. No sample name/ID occurs in production `src`.

Tests added: live provider JSON, `trace-explore-provider-eligibility.mjs`, `verify-explore-semantic-eligibility.mjs`.

Existing test maintenance: `verify-explore-map-cache.mjs` now expects the already-existing capability-versioned detail cache key; `verify-nearby-runtime-contract.mjs` now checks the already-existing gated verbose logging function. Both old expectations were verified against HEAD before updating. Browser harnesses add a mock for the fallback resolver's service import (images were already mocked) and wait for horizontal scroll-snap settlement before starting the vertical gesture. No carousel, sheet, gesture, router or legal production code changed in this task.

## G–K. Focused results

Run `NODE_ENV=production npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-explore-semantic-eligibility.mjs` (production mode disables the repository's existing development demo-place fallback).

- Chiyoda live fixture: **excluded** across all seven category IDs, both nearby/city modes, quality fallback and relaxed selection; Home also excludes it. Reason `structural_identity_conflict`.
- Playacolores live fixture: **retained**, with explicit `art_gallery` authority. A forced negative would contradict P5 and the fetched evidence.
- Generic buildings, apartments, premises, addresses, streets, intersections, locality/admin, office, bare POI/establishment and unsupported unknown fixtures: excluded even with high rating/review metadata.
- 16 positive controls: cafe, restaurant, bakery, museum, art gallery, tourist attraction, park, mall, church, Buddhist temple, Shinto shrine, mosque, synagogue, historical landmark, spa, hiking area. All pass with no photo, zero reviews and missing hours. Cultural/park sight-category checks pass.
- Unknown type with explicit cafe identity plus operational/hours evidence passes; the same record without supporting evidence does not. No name/address/ID blacklist.
- Home shared gate preserves gallery, cafe, restaurant, museum, park and mall controls. Home's other existing period/type restrictions remain unchanged.
- Actual asynchronous category-search pipeline: insufficient building-only initial response triggered **6 bounded calls**; eligible replacement mall produced one result; all-building responses ended with zero results. No junk reintroduced. Existing empty-state presentation resolves to `showEmpty=true`, not perpetual loading.
- Explicit user-selected search primary remains accessible; autonomous recommendation admission does not hide an explicitly searched building.
- Old recommendation cache entry is invalidated; diverse cafe/food/museum/park/shopping results survive All merging.

## L–N. Regression results

PASS: focused semantic eligibility, Explore city logic, map cache, progressive search, 14 request-storm/authority scenarios, native search, offline recovery, Nearby runtime contract, Home loading, Home weather/photo/locale, shortcut category fidelity, required diversity, place identity runtime, Place Detail device regressions, Place Detail photo renderer.

PASS: support/privacy public contract, legal subscription disclosures, legal return target, router pending lifecycle, actual production anonymous support/privacy/terms navigation and reload, legacy legal redirects and Login legal buttons.

PASS: Chrome Explore sheet geometry/gesture regression **81 states**, widths 375/390/430/410; App Review sheet browser checks cover **820×1180, 1180×820, 414×736, 390×844**, horizontal cards, vertical content reachability, handle expansion, and subscription legal dialogs. These are Chrome touch emulation checks, not a new iPad WKWebView acceptance claim.

PASS: actual local production protected-login browser test **104 checks**, **20 race rounds**, **80 repeated document navigations**, **0 blank logins**, **0 uncaught errors**. Initial attempt without a running local server failed; it was rerun successfully after starting the local production Worker.

Extra check: repository-wide TypeScript is **not clean** (existing project errors). Comparing the changed source files against a temporary copy with their HEAD versions produced the same seven normalized diagnostics and **zero new diagnostics in changed files**. This is not claimed as a full typecheck pass.

## O–S. Build, bundle and working tree

- `npm run cap:sync:ios` (includes production build and release-artifact validation): **exit 0**.
- `git diff --check`: **PASS**.
- Production client and `ios/App/App/public`: **127 files byte-identical**; bundled config has no `server.url`.
- Semantic gate appears in both `assets/index-Ba_4uax5.js`, SHA-256 `eb5d32abbbd0e995c3922c4f1edaa1b0127fd1ce65bc436a0b7c21f2e55f6965`.
- Existing Place Detail fallback implementation remains in source and build; renderer regression passes.
- Working tree remains dirty/uncommitted, with earlier App Store/router/carousel/detail changes preserved. The task's file scope is listed above; no prior edits were reverted. Generated production/iOS assets were refreshed. No deploy, commit, push, Archive or build-number bump.
- **Ready for another final iPad manual acceptance: YES.** Expected outcome: Chiyoda no longer autonomously recommended; Playacolores may still appear because the provider explicitly identifies an operational gallery. Real-device acceptance remains pending.
