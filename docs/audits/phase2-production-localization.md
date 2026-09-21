# Production localization — phase 2

**Verdict: FIX BEFORE RETEST. This is incomplete work, not a full production-coverage certification.**

HEAD remains `62fb6901c59ae16d7d01ec85a5571548fbeba4c9`. No commit, push, deploy, archive, build-number change, Capacitor sync, RevenueCat or App Store Connect change.

## Reachability evidence and limits

`phase2-reachability.json` classifies every original inventory occurrence with original file/line/text/ID, reason and router import chain. Original line numbers are historical; the current `ui-chinese-leakage-remaining.json` has current line numbers. The import graph resolves TypeScript paths, ordinary router entries and client entry, excluding type-only imports. Import reachability is an upper bound, not proof that every imported export is executed. Conditional UI is treated conservatively as reachable.

Verified unused components: CropEditActions, MapPlacePreview, RoamieSplashScreen, TransitLegCard, HomePlusPersonalization, SavedTripDetailView and its SavedTripStopCard. No production router/client import path; repository symbol search found only their own declarations or references from the same unused subtree. No translations were added for these components.

Admin/developer route, keyboard diagnostics and explicit dev-only Login/Settings controls are separate from ordinary UI. Internal sentinels retain canonical values. Proper-name exemptions are scoped to actual literal nodes in verified geographic tables or place-identity records, not entire files. Summaries and theme titles are NOT exempted as place data.

Original **456 direct candidates**: A=0, B=328, C=25, D=102, E=1, F=0, G=0.

Original **9,417 other strings**: A=0, B=280, C=19, D=32, E=317, F=871, G=7898.

A=production UI; B=conditional production UI; C=verified unused; D=admin/debug; E=internal; F=external/factual identity; G=manual review. This pass does not assert a reliable unconditional A subset, so reachable copy is conservatively B. No separately proven test/diagnostic rows were extracted from the original 9,417; zero here means unestablished, not proof that no such rows exist. Diagnostics already classified in phase 1 remain separately allowlisted.

**355 confirmed reachable baseline literal occurrences were localized/restructured. 253 confirmed reachable occurrences remain. 7898 original entries retain G; 7813 are still present.** Repeated template fragments count as separate original occurrences, not distinct screens or translation keys.

## Changes

327 new canonical `productionUi` keys × 4 locales (1,308 translation values), alongside phase 1's 126 keys. Components use useI18n/translate; early startup/error surfaces use the existing effectiveAppLocale/translate boundary so they do not require a provider that may not have mounted. No new locale preference or independent locale state was added.

Localized reachable text in Login/Auth, Profile, Settings/account deletion, trip collaboration, itinerary editing, media upload errors, calendar/time/duration pickers, Legal viewers, shared errors and Chat loading/failure/selection copy. Multi-part destructive confirmations were converted into whole translated messages with parameters. Legal viewers now read existing four-language full legal documents from plusPurchase dictionary rather than loading zh-TW legal.ts directly.

Chat display messages changed while canonical shortcut payloads and intent IDs remain unchanged. The legacy loading-bubble stripping prefix and the legacy destination sentinel are intentionally NOT translated; explicit regression assertions cover them. New locale-dependent callbacks include the translation dependency.

## Dynamic/persisted locale flow

Home request sends locale → API/AI context → language instruction → response/normalization → saveRecommendation → owner-bound localStorage + sessionStorage + memory cache → getRecommendation → RecommendationsPage or Chat handoff.

This recommendation store is local. It does NOT itself write saved_trips to Supabase. Later planning uses mood-chat-handoff/chat-session and itinerary-source; generated trips flow through itinerary-storage.ts into saved_trips.payload. chat-history.ts separately reloads Supabase chat_messages.content and reparses assistant JSON. These are distinct persistence boundaries.

Factual fields: IDs, coordinates, official names/addresses, dates, ordering, category IDs and selection provenance. Generated display fields: title, summary, mood display text, recommendation reason/description/estimatedTime, itinerary description/AI notes and opening-status labels.

Implemented: saveRecommendation records the request's generatedLocale. RecommendationsPage derives a display projection from the raw stored record on each locale render; initial Chat handoff uses the same projection. Same-language content is preserved. Mismatched/unknown legacy locale displays an explicit current-language notice and factual place/category information, omitting stale generated prose. The original record is not mutated or written back; switching back restores its original generated prose. Place names and user data are not machine-translated.

**Not completed:** language provenance and locale-change rendering for already-loaded Chat history, chat/session cache, itinerary-source, editable saved_trips payloads and outfit narrative caches. User-customized titles/notes cannot safely be rewritten without provenance. This batch did not pretend the local recommendation projection solves those separate stores. No travel data was deleted.

Weather remains scene → current-locale display; Plus insight remains account + locale. Home nearby cache already includes locale. Country/city options cache includes language, but its curated summary text is still Chinese: cache identity alone is not localization.

## Screen status

| Screen | Status | Remaining evidence |
|---|---|---|
| Home | REMAINING | Downstream/generated recommendation helpers and shared data-flow review |
| Chat | REMAINING | Country/city summaries, theme titles, persisted messages, further reply builders |
| Explore / Map | REMAINING | Shared place metadata and error sources need complete data-flow classification |
| Place Detail | REMAINING | Generated reasons and shared opening/category metadata |
| Favorites | REMAINING | Saved-trip generated prose/metadata provenance |
| Itinerary | REMAINING | Persisted reasons, outfit text, generated labels and helper fallbacks |
| Planning / selection | REMAINING | Curated combination titles and downstream reply builders |
| Profile | REMAINING | Preference/sync/error helper paths beyond translated surface copy |
| Auth | REMAINING | Provider/server-origin error mapping not fully classified |
| Welcome / Onboarding | COMPLETE | Canonical plusPurchase keys, existing four-language and Provider/Auth regressions |
| Plus / Subscription | COMPLETE | Existing canonical paywall/restore/error mappings and eight required regressions |
| Settings / account deletion | REMAINING | Main confirmations localized; all server/error paths not yet certified |
| Legal | REMAINING | Full documents fixed; support FAQ and route metadata still need coverage |
| Collaboration | REMAINING | Visible controls fixed; role/server error helpers still need coverage |
| Error / Empty / Loading / Offline | REMAINING | Main shared boundaries fixed; dynamic errors and remaining shared helpers |

## Known remaining generated UI

- `src/lib/ai/country-city-options.ts`: 175 original occurrences.
- `src/lib/ai/destination-travel-profile.ts`: 78 original occurrences.

The country/city `STRUCTURED_COUNTRY_DESTINATIONS.summary` and `CURATED_PROFILES.title` fields are Roamie-controlled rendered copy. They are explicitly category B, not external data. The 253 entries are listed individually in the classification JSON. Additional unresolved strings are not implicitly allowed.

## Verification

- Required eight Plus/subscription checks: PASS. Settings copy assertions now verify the same original disclosure via the canonical key and four-language dictionary.
- Provider/Auth browser regression: PASS, eight cases, one SubscriptionProvider and one paywall instance.
- verify-production-ui-locales: PASS — 327 keys × four languages, interpolation parity, all static key references, English/Korean Han leakage in controlled copy, immutable locale projection, legacy records, factual identity preservation, picker formatting and internal sentinel protection.
- Phase 1 Home/weather/insight/shortcut/transport/Explore verification: PASS.
- Itinerary localization runtime, combination localization, transport copy, Plus personalization and Home entitlement UI: PASS.
- Canonical strict gate (`vite-node --config scripts/vite.verify.config.mjs scripts/verify-ui-language-coverage.mjs --strict`): FAIL. Delegates to reachability-based completeness; valid C/D/E/F exemptions do not hide B or unresolved G.
- verify-plus-entitlement-authority: HEAD and working tree FAIL with the same obsolete zero-argument sync assertion.
- verify-localization-diversity-hard-gates: HEAD and working tree FAIL with the same English-fallback assertion (actual 1, expected 0).
- Production web build: PASS; no postbuild Capacitor preparation/sync.
- TypeScript: HEAD/current both 334; new diagnostic sites (file + code + source span) = 0. Printed structural-type property ordering is not treated as a new diagnostic.
- New non-formatting lint = 0 after normalizing embedded line numbers in preexisting hook warnings. Existing warnings were not repaired as unrelated work.
- git diff --check: PASS.

## Working-tree file inventory

Includes phase 1 and the previously pending Provider/Auth fix. app-bundle-meta and config 2.xml were present before this task and preserved. No dependency/lockfile change.

```text
 M scripts/verify-home-personalization-entitlement-ui.mjs
 M scripts/verify-plus-purchase-ui.mjs
 M src/components/AppErrorBoundary.tsx
 M src/components/DayOutfitCard.tsx
 M src/components/GoogleMap.tsx
 M src/components/ImageCropErrorFallback.tsx
 M src/components/ImageSourceSheet.tsx
 M src/components/InlineImageCropViewport.tsx
 M src/components/LegalDocumentOverlay.tsx
 M src/components/LegalDocumentPage.tsx
 M src/components/MapErrorBoundary.tsx
 M src/components/MapExploreSheet.tsx
 M src/components/PlaceActionRow.tsx
 M src/components/PlaceNavButtons.tsx
 M src/components/PlaceSearchPanel.tsx
 M src/components/ProfileCover.tsx
 M src/components/RoamieAppErrorFallback.tsx
 M src/components/RoamieResponseView.tsx
 M src/components/RoamieRoutePending.tsx
 M src/components/TripPlanEditor.tsx
 M src/components/chat/ChatComposer.tsx
 M src/components/home/HomeNearbyPlaceCards.tsx
 M src/components/home/HomePersonalizationCard.tsx
 M src/components/home/HomeTripCard.tsx
 M src/components/map/MapExplorePlaceCards.tsx
 M src/components/map/MapExploreSearchResults.tsx
 M src/components/map/MapSearchBarOverlay.tsx
 M src/components/map/NavigationPreviewSheet.tsx
 M src/components/map/PlaceDetailSheet.tsx
 M src/components/media/SharedImageCropEditor.tsx
 M src/components/pickers/RoamieCalendar.tsx
 M src/components/pickers/RoamieDatePicker.tsx
 M src/components/pickers/RoamieDurationPicker.tsx
 M src/components/pickers/RoamiePickerSheet.tsx
 M src/components/pickers/RoamieTimePicker.tsx
 M src/components/saved/CrossDayMoveSheet.tsx
 M src/components/saved/SavedPlaceRemoveConfirmDialog.tsx
 M src/components/saved/SavedPlacesPickSheet.tsx
 M src/components/saved/SavedTripCard.tsx
 M src/components/saved/SavedTripItineraryEditor.tsx
 M src/components/saved/TripLocationCard.tsx
 M src/components/saved/TripOutfitCard.tsx
 M src/components/saved/TripPlaceCard.tsx
 M src/components/saved/TripRemoveDayConfirmDialog.tsx
 M src/components/saved/TripTransportPicker.tsx
 M src/components/travel-preference/TravelPreferenceQuizPage.tsx
 M src/components/trip/TripAffiliateSection.tsx
 M src/components/trip/TripDetailScreen.tsx
 M src/components/trip/TripSharePanel.tsx
 M src/generated/app-bundle-meta.ts
 M src/hooks/use-add-to-trip.tsx
 M src/hooks/use-home-weather.ts
 M src/hooks/use-place-navigation.ts
 M src/lib/chat-shortcut-chips.ts
 M src/lib/estimate-travel-mode.ts
 M src/lib/explore-search-radius.ts
 M src/lib/home-personalization-insight.ts
 M src/lib/i18n/messages.ts
 M src/lib/picker-utils.ts
 M src/lib/place-category.ts
 M src/lib/recommendation-storage.ts
 M src/lib/travel-pref-sync.ts
 M src/lib/weather-scene.ts
 M src/providers/AppProviders.tsx
 M src/providers/PlusPurchaseProvider.tsx
 M src/routes/__root.tsx
 M src/routes/_app.chat.tsx
 M src/routes/_app.index.tsx
 M src/routes/_app.map.tsx
 M src/routes/_app.place.tsx
 M src/routes/_app.plan.tsx
 M src/routes/_app.profile.tsx
 M src/routes/_app.recommendations.tsx
 M src/routes/_app.saved.index.tsx
 M src/routes/_app.settings.tsx
 M src/routes/auth.callback.tsx
 M src/routes/login.tsx
 M src/routes/privacy.tsx
 M src/routes/support.tsx
 M src/routes/trip-invite.$token.tsx
 M src/routes/trip.tsx
?? docs/audits/phase2-production-localization.md
?? docs/audits/phase2-reachability.json
?? docs/audits/phase2-verification-results.json
?? docs/audits/ui-chinese-leakage-allowlist.json
?? docs/audits/ui-chinese-leakage-remaining.json
?? docs/audits/ui-language-coverage.md
?? "ios/App/App/config 2.xml"
?? scripts/audit-ui-chinese-leakage.mjs
?? scripts/classify-ui-reachability.mjs
?? scripts/verify-plus-provider-auth.mjs
?? scripts/verify-production-ui-locales.mjs
?? scripts/verify-production-ui-reachability.mjs
?? scripts/verify-ui-language-coverage.mjs
?? src/lib/i18n/production-ui.ts
?? src/lib/i18n/ui-coverage.ts
?? src/lib/recommendation-display-locale.ts
```

Total working-tree paths: 97.
