# Maletas / Akihabara admission generalization audit

## A. Provider evidence

Captured: 2026-09-26T19:01:37.894221+00:00. Read-only Google Places v1 query; key stayed in request headers and was never printed. The text search returned seven results; this exact name and Ohtori Parking Tower address match the user's observed listing. This is not a claim of access to the iPad's local candidate cache or session logs.

| Field | Provider result |
| --- | --- |
| placeId | "ChIJ5d75LgCPGGARUd9ISdVgyT8" |
| displayName | {"text": "Maletas", "languageCode": "es"} |
| primaryType | "shopping_mall" |
| types | ["shopping_mall", "point_of_interest", "establishment"] |
| businessStatus | "OPERATIONAL" |
| pureServiceAreaBusiness | false |
| rating | **Not returned** |
| userRatingCount | **Not returned** |
| regularOpeningHours | **Not returned** |
| currentOpeningHours | **Not returned** |
| websiteUri | **Not returned** |
| nationalPhoneNumber | **Not returned** |
| internationalPhoneNumber | **Not returned** |
| formattedAddress | "Ohtori Parking Tower, 3-5, 3-5 Akihabara, Taito City, Tokyo 110-0006, Japan" |
| location | {"latitude": 35.7022518, "longitude": 139.7746099} |
| Google Maps URI | "https://maps.google.com/?cid=4596311363882114897&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAIYBCAA" |
| accessibilityOptions | **Not returned** |
| editorialSummary | **Not returned** |
| photos | Not returned; 0 returned photo records |

Missing provider fields are not proof that the venue does not exist. No additional visitor/business evidence was returned in the requested fields. Source snapshot: `scripts/fixtures/akihabara-candidate-audit.json`; exact photo counts are retained, with only the first photo resource stored for normalization tests.

## B–C. Root cause and generalization audit, reported before production edits

The previous gate removed only a narrow conflict: the **venue name** looked like a building and its mall identity lacked corroboration. `Maletas` does not match that name pattern, so `shopping_mall` immediately returned `{ eligible: true, reason: "visitor_type" }`. The structural address never participated. The last fix therefore still trusted an ambiguous provider type as sufficient destination evidence.

Actual code path:

1. Google Places Nearby/Text candidate → `places.functions.ts:mapRawPlaces` → `normalizeGooglePlace`; Explore provider results are passed onward for client eligibility.
2. `searchExploreCategoryPlaces` → `filterPlacesForExploreCategory` → `filterAndSelectExploreMapPlaces`; category/type checks, canonical semantic gate, hard exclusions, distance, tier selection and quality fallback.
3. `classifyExploreMapQualityTier` returned tier 3 for this sparse listing. `exploreMapQualityScore` gave **149.11097252572654** using the audit's Akihabara station center (35.69835, 139.77314); this is a controlled replay, not the device's historical score.
4. `buildUnifiedPlaceCards` / All-category merge → sort → map results → `MapExplorePlaceCards`. The `all` and `district` lanes could admit the old record; recommendation-cache hits could retain it until the shared gate revalidated them.
5. After the fix, the gate rejects it before tier/ranking; the tier is null. The scoring function itself is unchanged and should not be called as admission authority.

The original iPad query, GPS, request source and exact candidate ordering are unavailable. The place ID is identified by matching the provider's exact name/address; current provider replay proves the admission hole but does not reconstruct unavailable historical telemetry.

Sampling: seven Nearby requests (20 results each) around Akihabara/Taito, including shopping/store, mall-only, culture, gallery, food and a deliberately separate structural/office/parking control lane, plus seven text-search disambiguation results. Nearby radius is 1,500 m; the text search uses a location bias and can return results outside that radius. **147 returned records, 137 unique IDs**. This is a fresh reproducible provider sample, not an export of the iPad's actual pool.

| Measure | Before | After |
| --- | ---: | ---: |
| Semantic gate accepted | 88 | 96 |
| Semantic gate rejected | 49 | 41 |
| Passed additional Explore hard exclusions | 84 | 92 |
| Ambiguous commercial primary types / missing primary | 29 | 29 |
| Ambiguous candidates without hours, website or phone | 5 | 5 |
| Those five accepted | 4 | 0 |

The five are Maletas, TX秋葉原駅A1, ヨドバシAKIBAビル, メトロピア秋葉原 and HOP ON. The building-named one was already blocked; the other four passed. Thus there are **four additional questionable candidates beyond Maletas**, three of which the old gate admitted. These are insufficient-evidence cases, not verified invalid businesses. In particular, the audit does not claim that a mall-like listing with sparse metadata is factually nonexistent.

The new gate withholds four previously accepted records and admits twelve previously missed, supported stores or specific retail/event venues. These counts concern semantic admission, not final displayed cards or independently verified precision/recall. All 137 records, request provenance and before/after decisions are in `docs/akihabara-candidate-admission-audit.json`.

Real sparse positive witnesses include `Shiloh`, `M＆H gallery`, `gallery&space Artmarche KANDA` and `CARD GALLERY`. Their art_gallery/museum semantics survive missing photos, low/zero reviews and missing hours, including galleries inside buildings.

## D–E. Minimal production change and final rule

Only four production source files changed during this task (previous working-tree changes remain):

- `src/lib/place-category.ts`: refine the existing canonical gate, with no new parallel classifier.
- `src/lib/google-maps-api.ts`: add website/phone/pureServiceAreaBusiness to the existing search field mask; no new endpoint, per-place enrichment request, image API or ranking change.
- `src/lib/ai/normalize-google-place.ts`: retain those contact fields and `currentOpeningHours`. Regular hours were already retained; current hours previously affected display status but were not retained on this normalized result.
- `src/lib/place-result.ts`: optional factual contact fields.

The build also refreshed `src/generated/app-bundle-meta.ts` and generated assets.

Admission order:

1. **Structured non-destination exclusions first.** Buildings/residential/admin/street/parking/office/ATM/storage and existing excluded types cannot gain admission merely by also carrying establishment/POI tags or contact metadata. A pure service-area business is not a visitable destination.
2. **Specific visitor semantics.** Explicit restaurant/cafe, museum/gallery, attraction, park, cultural/religious, entertainment/event and specific visitor retail types retain admission even with sparse metadata. Existing canonical type lists are reused; specific jewelry/toy/sporting-goods/event-venue variants were added so well-defined venues are not confused with generic store tags.
3. **Ambiguous commerce.** Primary shopping_mall/department_store/store/general_store/shopping_center/establishment/POI, or missing primary with such types, requires independent corroboration. Evidence combinations are meaningful hours plus a contact channel; website plus phone; or at least one business-presence signal (hours/website/phone) plus public-use evidence (photo or any positive review count) or independently inferred purpose in the venue name. The type is not reused as its own name evidence.
4. **Structural context raises the bar, not a tenant ban.** A generic building name or parking/office host address requires meaningful hours or both contact channels in addition to corroboration. Specific gallery/cafe/etc. tenants already passed step 2. Changing Maletas's address to an ordinary address still leaves it rejected for unsupported commercial identity, so the address is not a blacklist.
5. **Unknown types.** Existing conservative named-purpose fallback remains available with OPERATIONAL status and supporting evidence. Mere photos/ratings cannot turn an opaque unknown entity into a destination. A concrete unsupported primary type is not overwritten by its generic POI suffix.

Meaningful hours means nonempty periods/descriptions or an explicit openNow boolean; `{}` or `{ periods: [] }` is not evidence. Website uses an HTTP(S) URI; phone requires a plausible digit count. These are provider-supplied contact signals, not independently validated website content or phone reachability. The rule does not impose a minimum review threshold and does not individually require any photo/hour/phone/website field.

The contact-field projection matters: the previous Nearby/Text mask did not request contacts. The new rule must not treat **unrequested** fields as known absence. Existing requests now retrieve these fields and normalization carries them through; no extra enrichment calls were introduced.

## F–L. Fixtures, sampled candidates and replenishment

Commands:

```sh
NODE_ENV=production npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-explore-semantic-eligibility.mjs
NODE_ENV=production npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-akihabara-candidate-set.mjs
npx vite-node --config scripts/vite.verify.config.mjs scripts/audit-akihabara-candidates.mjs
```

Production mode in asynchronous tests disables the repository's existing development demo-place fallback.

- **Maletas: rejected**, structural_identity_conflict. Tested in every category, nearby/city, regular and relaxed selection, Home and old recommendation-cache reads.
- **Chiyoda Building II: rejected**, existing provider fixture and cross-category tests pass.
- **Playacolores: retained**, explicit operational art_gallery with provider website/phone; no forced negative.
- **Previous 16 positive categories retained.** The mall positive now explicitly includes website+phone, still with zero photos/reviews and missing hours. Keeping a type-only mall fixture positive would recreate the defect. Specific visitor types continue to pass without those metadata fields.
- **137-candidate regression PASS:** five thin commercial negatives; nine explicit real venue positives; twenty structural controls. All candidates additionally undergo a metamorphic check: changing them to opaque mall-only records without business-purpose corroboration cannot be rescued by their existing photos/review counts.
- Tests also cover an Arabic opaque name with independent contacts, a one-review mall with meaningful hours, a gallery in a parking structure, empty-hours rejection, and infrastructure carrying generic POI tags plus contact metadata.
- Production field-mask projection is applied to actual positive records before normalization/admission, catching evidence dropped between provider and gate. Current-opening-hours preservation is asserted.
- **Expansion PASS:** actual asynchronous district pipeline makes six bounded calls, admits a real replacement mall when supplied, or returns zero after exhaustion. Neither Maletas nor Chiyoda is reintroduced to meet minimum count. Existing completed-empty presentation and progressive-search tests pass.
- **Home:** already uses the shared gate, so ambiguous commercial candidates receive the same stricter check. Its existing time/type/operational policies are unchanged; Home loading and weather/photo/locale suites pass.
- Diversity and category tests pass. Explicit user search selection remains accessible; autonomous recommendation filtering is not a ban on finding a place by name.

Test files changed/added: `scripts/verify-explore-semantic-eligibility.mjs` (retain 16 controls with genuine mall evidence), `scripts/verify-explore-city-logic.mjs` (assert type-only mall fails while corroborated mall keeps relaxed tier), `scripts/verify-akihabara-candidate-set.mjs`, `scripts/audit-akihabara-candidates.mjs`, and the provider snapshot. No sample names, IDs or Ohtori-specific strings were added to production source.

## M–S. Final verification

PASS: focused semantic eligibility, sampled candidate-set, Explore city/cache/progressive-search/request-storm/native-search/offline recovery, Nearby runtime contract, Home loading/weather/photo/locale, shortcut category fidelity, required diversity, place identity, Place Detail device and photo-renderer regressions.

PASS: support/privacy contract, legal subscription disclosures, legal return target and router pending lifecycle; production anonymous support/privacy/terms routes, reloads, old legal redirects and Login legal buttons.

PASS: local production login/router browser **104 checks, 20 race rounds, 80 repeated document navigations, zero blank login and zero uncaught errors**.

PASS: App Store remediation browser sheet checks at 820×1180, 1180×820, 414×736 and 390×844, horizontal scrolling, vertical reachability, handle drag and subscription legal dialogs. These and the separate geometry checks use Chrome touch emulation, not a new iPad WKWebView acceptance claim.

PASS: separate Explore geometry/gesture suite, **81 states**, widths 375/390/430/410, covering snap alignment, clipping, repeated sheet transitions, horizontal and vertical gestures and reachable card CTAs.

The geometry harness printed its final PASS and wrote the 81-state trace, but retained a process handle after cleanup; it was interrupted only after all assertions completed. This is an assertion pass, not a claimed clean exit of that harness. The other browser checks exited normally.

Production build, release-artifact verification and `npm run cap:sync:ios`: **exit 0**. `git diff --check`: **PASS**. Production client and `ios/App/App/public`: **127 files byte-identical**; no remote `server.url`. New gate in both `assets/index-ClADROAJ.js`, SHA-256 `fb092f7f99903da18896672e2f7fac754ef4b8206d00afbeb3cb74e4d48d266c`.

Working tree remains dirty/uncommitted with prior changes preserved. No deploy, commit, push, Archive or build-number bump. The local production server is for testing only and is stopped after verification.

**S. Worth another final iPad manual acceptance: YES.** Maletas and Chiyoda should be absent from autonomous recommendations; Playacolores may remain. This is a materially broader regression than the previous two-fixture fix, but the sample is not a proof that all provider misclassification or sparse legitimate-mall tradeoffs have been eliminated. Device acceptance remains pending.
