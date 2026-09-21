> Historical phase 1 report. Current status and counts: [phase 2 audit](phase2-production-localization.md).

# Four-language UI coverage audit — source batch 1

Verdict: **FIX BEFORE RETEST** for full-App four-language completeness.

This batch fixes the five reported display paths and adds 126 canonical keys per locale (504 translations). It does not claim every reachable screen is translated.

## Evidence and scope

- Home weather: `weather-scene.ts` produced local Chinese templates from numerical weather/scene. It is not an AI response. The persisted weather snapshot was shared across locales. `use-home-weather.ts` now derives current-locale recommendation text from scene on every snapshot/locale change, preserving factual weather data. No server prompt is involved in this headline.
- Home Plus: actual `HomePersonalizationCard` static copy bypassed i18n. Its local insight templates also contained Chinese, and the session cache used only account identity. Templates now use canonical translation; cache and render ownership include account and locale.
- Chat: fixed initial chips and four continuation actions displayed their Chinese canonical payloads directly. `chatShortcutLabel` translates display only; click payload, routing tokens and analytics remain unchanged. Unknown custom text is preserved. Other generated chat replies remain in the inventory.
- Transport: `estimate-travel-mode` supplied Chinese labels/hints and the detail/preview components supplied Chinese metadata and CTAs. Locale now travels through the hook, estimates and recommendation copy. walk/motorcycle/drive/transit/taxi identifiers, durations, Google modes and ranking are unchanged. motorcycle means motorbike, not bicycle.
- Explore: category sheet title helper was Chinese-only; saved count was inline Chinese. Sheet/card aria, empty search copy, unavailable map fallback and saved-result hours fallback now use canonical translation. Remaining place metadata/error sources are listed below.

## Dynamic content / cache boundary

- Weather primary copy: fixed at display boundary, including old Chinese cached snapshots.
- Plus insight: account + locale cache; prior-locale insight cannot render during the next locale's state update. User-authored titles/preferences are preserved, not translated.
- Home outfit (`recommendation/daily-prep-advice.ts`): existing four-language local template selection; caller memo depends on locale. Not AI.
- Home nearby (`home-nearby-search.ts`, `home-nearby-picks-policy.ts`): requests carry locale, cache identity includes locale.
- Home mood generation (`_app.index.tsx`, handleRecommend): client sends locale through `toRoamieRequest`. AI prompt builder (`ai/prompts.ts`) uses `ctx.locale` and `aiLanguageInstruction`. This proves explicit language instructions, not guaranteed model-output compliance.
- **Remaining risk:** `recommendation-storage.ts` stores/replays complete generated recommendation payloads by owner/id, without explicit locale identity or locale-change invalidation. Existing saved generated prose can remain in its original language. This batch does not rewrite saved results, user text or place names.
- `recommendation/ai-places-cache.ts` category cache omits locale, but caches verified place candidates/hours, not this weather headline. Locale sensitivity of all downstream candidate fields still needs review; omission alone does not prove AI prose leakage.

## Inventory interpretation

The AST scan covers every src .ts/.tsx literal, including helpers, server templates and routes. It excludes comments and regex literals. Japanese Han characters are not automatically errors. Counts are literal occurrences, not screens or user-visible incidents.

`ui-chinese-leakage-remaining.json` contains every unallowlisted occurrence with file, line, literal text, stable ID and classification. `remaining-ui` means directly rendered JSX/attributes/toasts detected by the scanner; reachability still needs review (admin/debug/unused components are included conservatively). `needs-review` includes data, prompts, dynamic UI and semantic payloads; it is NOT a list of confirmed UI defects. This is a syntactic inventory, not a completed data-flow proof for every value.

`ui-chinese-leakage-allowlist.json` records explicit reasons: locale dictionaries, multilingual branches, diagnostics, lookup keys, input matching and the explicitly verified legacy Chat routing payloads. Untranslated UI is not allowed merely because it is preexisting. Proper names, database/user/API content and internal prompt examples remain review candidates until their use is established.

The verification default checks four-language behavior and prevents silent inventory changes. `--strict` additionally requires the entire backlog to be empty and currently FAILS. Updating the inventory must not be interpreted as resolving its entries.

## Remaining work by file

All requested screen families are included: Home, Chat, Explore, Place Detail, Favorites, Itinerary/planning, Profile, Login, Welcome, Plus, Legal, Settings and shared error/loading/empty UI. A zero direct count does not establish complete coverage of dynamic helpers. See JSON for exact strings/line references.

| Source file | Direct UI candidates | Needs classification |
|---|---:|---:|
| `src/components/AddToTripSheet.tsx` | 0 | 5 |
| `src/components/AppErrorBoundary.tsx` | 2 | 0 |
| `src/components/BackButton.tsx` | 0 | 1 |
| `src/components/CropEditActions.tsx` | 1 | 2 |
| `src/components/DayOutfitCard.tsx` | 3 | 0 |
| `src/components/GoogleMap.tsx` | 1 | 4 |
| `src/components/ImageCropErrorFallback.tsx` | 1 | 1 |
| `src/components/ImageSourceSheet.tsx` | 3 | 7 |
| `src/components/InlineImageCropViewport.tsx` | 1 | 1 |
| `src/components/LegalDocumentOverlay.tsx` | 3 | 0 |
| `src/components/LegalDocumentPage.tsx` | 3 | 2 |
| `src/components/LegalDocumentSheet.tsx` | 0 | 1 |
| `src/components/LocationSearchField.tsx` | 0 | 2 |
| `src/components/MapErrorBoundary.tsx` | 3 | 1 |
| `src/components/MapPlacePreview.tsx` | 5 | 0 |
| `src/components/PlaceActionRow.tsx` | 1 | 2 |
| `src/components/PlaceHoursBadge.tsx` | 0 | 1 |
| `src/components/PlaceNavButtons.tsx` | 3 | 1 |
| `src/components/PlaceSearchPanel.tsx` | 1 | 0 |
| `src/components/ProfileCover.tsx` | 2 | 0 |
| `src/components/RoamieAppErrorFallback.tsx` | 0 | 4 |
| `src/components/RoamieResponseView.tsx` | 5 | 5 |
| `src/components/RoamieRoutePending.tsx` | 1 | 0 |
| `src/components/RoamieSplashScreen.tsx` | 1 | 0 |
| `src/components/TabelogExternalLink.tsx` | 0 | 1 |
| `src/components/TransitLegCard.tsx` | 1 | 2 |
| `src/components/TripPlanEditor.tsx` | 9 | 12 |
| `src/components/auth/AuthSignInError.tsx` | 0 | 3 |
| `src/components/chat/ChatComposer.tsx` | 0 | 2 |
| `src/components/chat/ChatKeyboardDebugOverlay.tsx` | 1 | 0 |
| `src/components/home/HomeNearbyPlaceCards.tsx` | 3 | 1 |
| `src/components/home/HomePlusPersonalization.tsx` | 5 | 12 |
| `src/components/home/HomeTripCard.tsx` | 3 | 0 |
| `src/components/map/MapExplorePlaceCards.tsx` | 0 | 2 |
| `src/components/map/MapExploreSearchResults.tsx` | 1 | 1 |
| `src/components/map/MapSearchBarOverlay.tsx` | 2 | 0 |
| `src/components/map/RoamieUserLocationOverlay.ts` | 0 | 1 |
| `src/components/media/SharedImageCropEditor.tsx` | 4 | 3 |
| `src/components/pickers/RoamieCalendar.tsx` | 5 | 2 |
| `src/components/pickers/RoamieDatePicker.tsx` | 0 | 2 |
| `src/components/pickers/RoamieDurationPicker.tsx` | 2 | 5 |
| `src/components/pickers/RoamiePickerSheet.tsx` | 0 | 2 |
| `src/components/pickers/RoamieTimePicker.tsx` | 0 | 5 |
| `src/components/saved/CrossDayMoveSheet.tsx` | 17 | 0 |
| `src/components/saved/SavedPlaceRemoveConfirmDialog.tsx` | 5 | 0 |
| `src/components/saved/SavedPlacesPickSheet.tsx` | 2 | 0 |
| `src/components/saved/SavedTripCard.tsx` | 2 | 0 |
| `src/components/saved/SavedTripDetailView.tsx` | 6 | 0 |
| `src/components/saved/SavedTripItineraryEditor.tsx` | 41 | 10 |
| `src/components/saved/SavedTripStopCard.tsx` | 6 | 3 |
| `src/components/saved/TripLocationCard.tsx` | 4 | 1 |
| `src/components/saved/TripOutfitCard.tsx` | 3 | 0 |
| `src/components/saved/TripPlaceCard.tsx` | 4 | 0 |
| `src/components/saved/TripRemoveDayConfirmDialog.tsx` | 3 | 5 |
| `src/components/saved/TripTransportPicker.tsx` | 5 | 1 |
| `src/components/travel-preference/TravelPreferenceQuizPage.tsx` | 5 | 20 |
| `src/components/trip/TripAffiliateSection.tsx` | 1 | 7 |
| `src/components/trip/TripDetailScreen.tsx` | 4 | 3 |
| `src/components/trip/TripSharePanel.tsx` | 13 | 3 |
| `src/constants/ai-planning.ts` | 0 | 5 |
| `src/content/legal.ts` | 0 | 2 |
| `src/hooks/use-add-to-trip.tsx` | 2 | 1 |
| `src/hooks/use-trip-outfit-suggestion.ts` | 0 | 1 |
| `src/lib/affiliate/affiliate-links.ts` | 0 | 8 |
| `src/lib/affiliate/kkday-affiliate-url.ts` | 0 | 1 |
| `src/lib/affiliate/place-type-category-map.ts` | 0 | 16 |
| `src/lib/affiliate/ticket-affiliate-eligibility.ts` | 0 | 92 |
| `src/lib/affiliate/trip-com-flight-url.ts` | 0 | 1 |
| `src/lib/affiliate/trip-com-hotel-url.ts` | 0 | 46 |
| `src/lib/ai/accept-previous-suggestions-intent.ts` | 0 | 1 |
| `src/lib/ai/activity-camping.ts` | 0 | 18 |
| `src/lib/ai/administrative-locality.ts` | 0 | 1 |
| `src/lib/ai/ai-chat-conversation-state.ts` | 0 | 1 |
| `src/lib/ai/ai-classic-landmark-rules.ts` | 0 | 55 |
| `src/lib/ai/ai-day-plan-place-cards.ts` | 0 | 4 |
| `src/lib/ai/ai-day-plan-slot-rules.ts` | 0 | 38 |
| `src/lib/ai/ai-day-plan-source.ts` | 0 | 41 |
| `src/lib/ai/ai-itinerary-state-machine.ts` | 0 | 16 |
| `src/lib/ai/ai-local-life-rules.ts` | 0 | 97 |
| `src/lib/ai/ai-local-life-scheduler.ts` | 0 | 8 |
| `src/lib/ai/ai-multi-day-planner.ts` | 0 | 30 |
| `src/lib/ai/ai-trip-style.ts` | 0 | 57 |
| `src/lib/ai/bare-number-reply.ts` | 0 | 8 |
| `src/lib/ai/budget-refinement.ts` | 0 | 13 |
| `src/lib/ai/chat-cafe-search.ts` | 0 | 2 |
| `src/lib/ai/chat-category-place-guard.ts` | 0 | 1 |
| `src/lib/ai/chat-context-intent.ts` | 0 | 13 |
| `src/lib/ai/chat-conversation-state.ts` | 0 | 14 |
| `src/lib/ai/chat-destination-category-recommendation.ts` | 0 | 18 |
| `src/lib/ai/chat-dining-flow.ts` | 0 | 19 |
| `src/lib/ai/chat-food-filter.ts` | 0 | 8 |
| `src/lib/ai/chat-intent.ts` | 0 | 15 |
| `src/lib/ai/chat-place-intent.ts` | 0 | 14 |
| `src/lib/ai/chat-place-recommendation.ts` | 0 | 56 |
| `src/lib/ai/chat-place-search-context.ts` | 0 | 25 |
| `src/lib/ai/chat-recommendation-refresh.ts` | 0 | 13 |
| `src/lib/ai/chat-router.ts` | 0 | 12 |
| `src/lib/ai/chat-turn-engine.ts` | 0 | 10 |
| `src/lib/ai/city-days-planning.ts` | 0 | 13 |
| `src/lib/ai/combination-candidate-quality.ts` | 0 | 54 |
| `src/lib/ai/combination-category-contract.ts` | 0 | 38 |
| `src/lib/ai/combination-itinerary-integrity.ts` | 0 | 1 |
| `src/lib/ai/combination-selection-reply.ts` | 0 | 47 |
| `src/lib/ai/combination-theme-titles.ts` | 0 | 2 |
| `src/lib/ai/context.ts` | 0 | 91 |
| `src/lib/ai/conversation-recommendation-session.ts` | 0 | 8 |
| `src/lib/ai/conversation-stage.ts` | 0 | 6 |
| `src/lib/ai/country-city-options.ts` | 0 | 528 |
| `src/lib/ai/destination-advice.ts` | 0 | 279 |
| `src/lib/ai/destination-alias-resolver.ts` | 0 | 457 |
| `src/lib/ai/destination-area-aliases.ts` | 0 | 89 |
| `src/lib/ai/destination-combination-discovery.ts` | 0 | 114 |
| `src/lib/ai/destination-combination-suggestions.ts` | 0 | 125 |
| `src/lib/ai/destination-country-normalize.ts` | 0 | 129 |
| `src/lib/ai/destination-discovery-queries.ts` | 0 | 119 |
| `src/lib/ai/destination-entity.ts` | 0 | 405 |
| `src/lib/ai/destination-geocode.ts` | 0 | 124 |
| `src/lib/ai/destination-geographic-clarification.ts` | 0 | 7 |
| `src/lib/ai/destination-locale-aliases.ts` | 0 | 109 |
| `src/lib/ai/destination-pending-question.ts` | 0 | 370 |
| `src/lib/ai/destination-place-recommendation.ts` | 0 | 31 |
| `src/lib/ai/destination-season-reply.ts` | 0 | 6 |
| `src/lib/ai/destination-style-guide.ts` | 0 | 100 |
| `src/lib/ai/destination-travel-profile.ts` | 0 | 521 |
| `src/lib/ai/destination-trip-planning.ts` | 0 | 15 |
| `src/lib/ai/emotion-inference.ts` | 0 | 19 |
| `src/lib/ai/errors.ts` | 0 | 7 |
| `src/lib/ai/generic-place-label.ts` | 0 | 27 |
| `src/lib/ai/geographic-clustering.ts` | 0 | 1 |
| `src/lib/ai/itinerary-entity-extraction.ts` | 0 | 52 |
| `src/lib/ai/itinerary-google-identity.ts` | 0 | 1 |
| `src/lib/ai/itinerary-place-fetch.ts` | 0 | 29 |
| `src/lib/ai/itinerary-planning.ts` | 0 | 112 |
| `src/lib/ai/itinerary-validator/diversity-degradation.ts` | 0 | 1 |
| `src/lib/ai/itinerary-validator/from-payload.ts` | 0 | 8 |
| `src/lib/ai/itinerary-validator/replan.ts` | 0 | 3 |
| `src/lib/ai/itinerary-validator/types.ts` | 0 | 1 |
| `src/lib/ai/itinerary-validator/validate.ts` | 0 | 3 |
| `src/lib/ai/landmark-place-strategy.ts` | 0 | 75 |
| `src/lib/ai/local-recommendation-fallback.ts` | 0 | 41 |
| `src/lib/ai/map-named-places-to-google.ts` | 0 | 1 |
| `src/lib/ai/meal-intent-parser.ts` | 0 | 25 |
| `src/lib/ai/memory/long-term-memory.ts` | 0 | 26 |
| `src/lib/ai/memory/session-memory.ts` | 0 | 14 |
| `src/lib/ai/mood-presentation.ts` | 0 | 13 |
| `src/lib/ai/must-visit-places.ts` | 0 | 193 |
| `src/lib/ai/nearby-location-clarification.ts` | 0 | 12 |
| `src/lib/ai/nearby-shortcut-ranking.ts` | 0 | 8 |
| `src/lib/ai/place-detail-chat.ts` | 0 | 23 |
| `src/lib/ai/place-pool-expansion.ts` | 0 | 29 |
| `src/lib/ai/place-recommendation-intent/parse.ts` | 0 | 1 |
| `src/lib/ai/place-recommendation-intent/queries.ts` | 0 | 13 |
| `src/lib/ai/place-recommendation-rules.ts` | 0 | 2 |
| `src/lib/ai/places-cost-cache/filter-from-pool.ts` | 0 | 30 |
| `src/lib/ai/plan-prompts.ts` | 0 | 3 |
| `src/lib/ai/planner-day-route-assembly.ts` | 0 | 14 |
| `src/lib/ai/planning-conversation-constraints.ts` | 0 | 21 |
| `src/lib/ai/planning-real-place.ts` | 0 | 35 |
| `src/lib/ai/planning-required-anchor-handoff.ts` | 0 | 1 |
| `src/lib/ai/prompts.ts` | 0 | 77 |
| `src/lib/ai/real-place-supplement.ts` | 0 | 5 |
| `src/lib/ai/recommendation-exclusion.ts` | 0 | 100 |
| `src/lib/ai/recommendation-refinement/execute.ts` | 0 | 8 |
| `src/lib/ai/recommendation-refinement/parser.ts` | 0 | 101 |
| `src/lib/ai/recommendation-refinement/search.ts` | 0 | 13 |
| `src/lib/ai/region-adjacency/graph.ts` | 0 | 193 |
| `src/lib/ai/region-adjacency/index.ts` | 0 | 1 |
| `src/lib/ai/region-candidate-expand.ts` | 0 | 3 |
| `src/lib/ai/required-anchor-runtime.ts` | 0 | 3 |
| `src/lib/ai/resolved-destination-scope.ts` | 0 | 5 |
| `src/lib/ai/scenic-month-reply.ts` | 0 | 96 |
| `src/lib/ai/season-response-guardrail.ts` | 0 | 3 |
| `src/lib/ai/service.server.ts` | 0 | 7 |
| `src/lib/ai/shopping-query-queue.ts` | 0 | 34 |
| `src/lib/ai/shopping-search-scope.ts` | 0 | 40 |
| `src/lib/ai/stream-client.ts` | 0 | 12 |
| `src/lib/ai/style-candidate-diversity.ts` | 0 | 2 |
| `src/lib/ai/style-geo-diversity.ts` | 0 | 11 |
| `src/lib/ai/transit-station-filter.ts` | 0 | 15 |
| `src/lib/ai/travel-context.ts` | 0 | 74 |
| `src/lib/ai/trip-duration-guard.ts` | 0 | 7 |
| `src/lib/ai/trip-planning-context.ts` | 0 | 249 |
| `src/lib/ai/trip-planning-follow-up.ts` | 0 | 8 |
| `src/lib/ai/trip-planning-session-reset.ts` | 0 | 3 |
| `src/lib/ai/trip-preference.ts` | 0 | 30 |
| `src/lib/ai/types.ts` | 0 | 11 |
| `src/lib/ai/weather-place-search.ts` | 0 | 61 |
| `src/lib/ai/weather-planning-reply.ts` | 0 | 9 |
| `src/lib/api/constants.ts` | 0 | 6 |
| `src/lib/app-error-html.ts` | 0 | 2 |
| `src/lib/app-init-handlers.ts` | 0 | 2 |
| `src/lib/auth-apple-native.ts` | 0 | 10 |
| `src/lib/auth-oauth-deep-link.ts` | 0 | 1 |
| `src/lib/auth-oauth.ts` | 0 | 12 |
| `src/lib/auth-session-from-url.ts` | 0 | 2 |
| `src/lib/auth-session.ts` | 0 | 2 |
| `src/lib/auth-user-message.ts` | 0 | 3 |
| `src/lib/build-place-recommendation-reason.ts` | 0 | 74 |
| `src/lib/capacitor-image-picker.ts` | 0 | 4 |
| `src/lib/chat-display-recommendations.ts` | 0 | 3 |
| `src/lib/chat-place-context.ts` | 0 | 15 |
| `src/lib/chat-planning-flow.ts` | 0 | 14 |
| `src/lib/chat-session.ts` | 0 | 35 |
| `src/lib/complete-sign-in.ts` | 0 | 1 |
| `src/lib/conversation-workspace/title.ts` | 0 | 11 |
| `src/lib/copy-to-clipboard.ts` | 0 | 1 |
| `src/lib/credits/operations.ts` | 0 | 2 |
| `src/lib/destination-administrative-scope.ts` | 0 | 1 |
| `src/lib/device-location.ts` | 0 | 1 |
| `src/lib/effective-location.ts` | 0 | 1 |
| `src/lib/ensure-user-profile.ts` | 0 | 1 |
| `src/lib/env.server.ts` | 0 | 3 |
| `src/lib/estimate-travel-mode.ts` | 0 | 7 |
| `src/lib/explore-category-search.ts` | 0 | 24 |
| `src/lib/explore-city-category-queries.ts` | 0 | 14 |
| `src/lib/explore-city-popular-places.ts` | 0 | 80 |
| `src/lib/explore-places-eligibility.ts` | 0 | 3 |
| `src/lib/explore-recommend-mode.ts` | 0 | 50 |
| `src/lib/explore-selected-place.ts` | 0 | 2 |
| `src/lib/filter-available-places.ts` | 0 | 22 |
| `src/lib/google-directions-fetch.ts` | 0 | 1 |
| `src/lib/google-maps-client.ts` | 0 | 1 |
| `src/lib/google-maps-key-resolve.server.ts` | 0 | 1 |
| `src/lib/google-maps-key-resolve.ts` | 0 | 1 |
| `src/lib/google-maps-loader.ts` | 0 | 6 |
| `src/lib/google-routes-client.ts` | 0 | 1 |
| `src/lib/google-routes-fetch.ts` | 0 | 6 |
| `src/lib/home-nearby-search.ts` | 0 | 13 |
| `src/lib/home-sea-ranking.ts` | 0 | 2 |
| `src/lib/home-weather-bootstrap.ts` | 0 | 3 |
| `src/lib/image-crop-variants.ts` | 0 | 6 |
| `src/lib/image-crop.ts` | 0 | 11 |
| `src/lib/immediate-boot-shell.ts` | 0 | 1 |
| `src/lib/itinerary-source.ts` | 0 | 4 |
| `src/lib/itinerary-storage.ts` | 0 | 6 |
| `src/lib/itinerary.functions.ts` | 0 | 10 |
| `src/lib/late-night-scene-recommendations.ts` | 0 | 133 |
| `src/lib/location-search-unified.ts` | 0 | 9 |
| `src/lib/location.functions.ts` | 0 | 3 |
| `src/lib/map-explore.ts` | 0 | 24 |
| `src/lib/map-mock-places.ts` | 0 | 56 |
| `src/lib/mood-chat-handoff.ts` | 0 | 51 |
| `src/lib/normalized-opening-status.ts` | 0 | 43 |
| `src/lib/openweather-key-resolve.server.ts` | 0 | 1 |
| `src/lib/outfit/build-advice.ts` | 0 | 3 |
| `src/lib/outfit/fallback-outfit.ts` | 0 | 18 |
| `src/lib/outfit/generate-trip-outfit.server.ts` | 0 | 27 |
| `src/lib/outfit/group-by-date.ts` | 0 | 1 |
| `src/lib/outfit/local-trip-outfit-fallback.ts` | 0 | 6 |
| `src/lib/outfit/outfit-ai.server.ts` | 0 | 23 |
| `src/lib/outfit/resolve-style.ts` | 0 | 10 |
| `src/lib/outfit/trip-outfit-context.ts` | 0 | 7 |
| `src/lib/outfit/types.ts` | 0 | 9 |
| `src/lib/personality.ts` | 0 | 46 |
| `src/lib/personalization/resolve-effective-preference.ts` | 0 | 1 |
| `src/lib/picker-utils.ts` | 0 | 16 |
| `src/lib/place-category.ts` | 0 | 10 |
| `src/lib/place-detail-resolve.ts` | 0 | 8 |
| `src/lib/place-display-address.ts` | 0 | 25 |
| `src/lib/place-identity.ts` | 0 | 20 |
| `src/lib/place-localization/canonical-place-translations.ts` | 0 | 81 |
| `src/lib/place-localization/latin-zh-transliteration.ts` | 0 | 193 |
| `src/lib/place-localization/place-name-translation-policy.ts` | 0 | 10 |
| `src/lib/place-localization/verified-place-translations.ts` | 0 | 31 |
| `src/lib/place-navigation.functions.ts` | 0 | 1 |
| `src/lib/place-planning-memory.ts` | 0 | 13 |
| `src/lib/place-reason-diversity.ts` | 0 | 57 |
| `src/lib/place-reason.ts` | 0 | 34 |
| `src/lib/places-classic-landmark-cache.ts` | 0 | 20 |
| `src/lib/places-search-config.ts` | 0 | 40 |
| `src/lib/places-search-unified.ts` | 0 | 1 |
| `src/lib/places-storage.ts` | 0 | 1 |
| `src/lib/places.functions.ts` | 0 | 2 |
| `src/lib/plan-form-trip-payload.ts` | 0 | 8 |
| `src/lib/plan-travel-style.ts` | 0 | 70 |
| `src/lib/plan-trip-handoff.ts` | 0 | 19 |
| `src/lib/planning-selection.ts` | 0 | 21 |
| `src/lib/plus-chat-handoff.ts` | 0 | 10 |
| `src/lib/plus-preference-ranking.ts` | 0 | 55 |
| `src/lib/preferences-storage.ts` | 0 | 5 |
| `src/lib/profile-media-storage.ts` | 0 | 7 |
| `src/lib/profile-storage.ts` | 0 | 11 |
| `src/lib/recommend-place-ranking.ts` | 0 | 14 |
| `src/lib/recommendation-history.ts` | 0 | 1 |
| `src/lib/recommendation-storage.ts` | 0 | 1 |
| `src/lib/recommendation/categories.ts` | 0 | 20 |
| `src/lib/recommendation/festival-context.ts` | 0 | 1 |
| `src/lib/recommendation/fetch-candidates.server.ts` | 0 | 5 |
| `src/lib/recommendation/pipeline.server.ts` | 0 | 4 |
| `src/lib/recommendation/place-intro.ts` | 0 | 13 |
| `src/lib/recommendation/place-mapping.ts` | 0 | 2 |
| `src/lib/recommendation/trip-intent.ts` | 0 | 60 |
| `src/lib/saved-place-utils.ts` | 0 | 1 |
| `src/lib/saved-trip/apply-trip-date-range.ts` | 0 | 2 |
| `src/lib/saved-trip/delete-trip.ts` | 0 | 4 |
| `src/lib/saved-trip/display.ts` | 0 | 2 |
| `src/lib/saved-trip/editor-constants.ts` | 0 | 15 |
| `src/lib/saved-trip/japan-transit-maps.ts` | 0 | 1 |
| `src/lib/saved-trip/leg-transport-sot.ts` | 0 | 15 |
| `src/lib/saved-trip/normalize.ts` | 0 | 34 |
| `src/lib/saved-trip/route-duration-fallback.ts` | 0 | 2 |
| `src/lib/saved-trip/sync-route-legs.ts` | 0 | 11 |
| `src/lib/saved-trip/transport-options.ts` | 0 | 9 |
| `src/lib/saved-trip/travel-time.ts` | 0 | 12 |
| `src/lib/saved-trip/use-debounced-trip-save.ts` | 0 | 1 |
| `src/lib/search-radius.ts` | 0 | 4 |
| `src/lib/search-timeout.ts` | 0 | 1 |
| `src/lib/supabase-errors.ts` | 0 | 1 |
| `src/lib/supabase-project-url.ts` | 0 | 1 |
| `src/lib/tabelog-reference.ts` | 0 | 40 |
| `src/lib/transit/build-legs.server.ts` | 0 | 4 |
| `src/lib/transit/recommend-leg.ts` | 0 | 42 |
| `src/lib/transit/region-profiles.ts` | 0 | 18 |
| `src/lib/transit/transit-ai.server.ts` | 0 | 1 |
| `src/lib/travel-pref-result-cache.ts` | 0 | 5 |
| `src/lib/travel-pref-sync.ts` | 1 | 0 |
| `src/lib/trip-cover-upload.ts` | 0 | 4 |
| `src/lib/trip-media-storage.ts` | 0 | 5 |
| `src/lib/trip-stop-coords.ts` | 0 | 2 |
| `src/lib/trip-stop-search-unified.ts` | 0 | 3 |
| `src/lib/trip-stop-search.functions.ts` | 0 | 2 |
| `src/lib/trip/append-place-to-trip.ts` | 0 | 6 |
| `src/lib/trip/collab-member-display.ts` | 0 | 1 |
| `src/lib/trip/core-trip.ts` | 0 | 12 |
| `src/lib/trip/itinerary-guards.ts` | 0 | 18 |
| `src/lib/trip/mixed-itinerary-schedule.ts` | 0 | 3 |
| `src/lib/trip/trip-add-place-dedup.ts` | 0 | 30 |
| `src/lib/trip/trip-add-place-handoff.ts` | 0 | 32 |
| `src/lib/trip/trip-add-place-mode.ts` | 0 | 1 |
| `src/lib/trip/trip-add-place-recommendation-engine.ts` | 0 | 9 |
| `src/lib/trip/trip-add-place-recommendation-session.ts` | 0 | 5 |
| `src/lib/trip/trip-add-place-render.ts` | 0 | 10 |
| `src/lib/trip/trip-add-place-search.ts` | 0 | 1 |
| `src/lib/trip/trip-add-place-session.ts` | 0 | 14 |
| `src/lib/trip/trip-collab.ts` | 0 | 6 |
| `src/lib/trip/trip-place-input.ts` | 0 | 3 |
| `src/lib/trip/trip-stop-mutations.ts` | 0 | 3 |
| `src/lib/trip/trip-title.ts` | 0 | 38 |
| `src/lib/user-facing-error.ts` | 0 | 2 |
| `src/lib/weather-context.ts` | 0 | 34 |
| `src/lib/weather-open-meteo-client.ts` | 0 | 11 |
| `src/lib/weather-scene.ts` | 0 | 1 |
| `src/lib/weather.functions.ts` | 0 | 13 |
| `src/lib/weather/openweather-client.ts` | 0 | 1 |
| `src/lib/weather/parse-openweather.ts` | 0 | 4 |
| `src/routes/__root.tsx` | 4 | 4 |
| `src/routes/_app.chat.tsx` | 28 | 158 |
| `src/routes/_app.developer.tsx` | 33 | 3 |
| `src/routes/_app.index.tsx` | 4 | 0 |
| `src/routes/_app.place.tsx` | 13 | 0 |
| `src/routes/_app.plan.tsx` | 1 | 0 |
| `src/routes/_app.profile.tsx` | 9 | 11 |
| `src/routes/_app.recommendations.tsx` | 15 | 3 |
| `src/routes/_app.saved.index.tsx` | 2 | 0 |
| `src/routes/_app.settings.tsx` | 20 | 2 |
| `src/routes/admin.tsx` | 64 | 29 |
| `src/routes/api/roamie.ts` | 0 | 2 |
| `src/routes/auth.callback.tsx` | 2 | 4 |
| `src/routes/login.tsx` | 18 | 11 |
| `src/routes/privacy.tsx` | 3 | 2 |
| `src/routes/support.tsx` | 17 | 12 |
| `src/routes/trip-invite.$token.tsx` | 2 | 4 |
| `src/routes/trip.tsx` | 21 | 17 |
| `src/services/aiTravelContextService.ts` | 0 | 1 |
| `src/services/apiDevTools.ts` | 0 | 4 |
| `src/services/placeImageService.ts` | 0 | 32 |
| `src/services/placesService.ts` | 0 | 3 |
| `src/services/weatherService.ts` | 0 | 29 |

## Verification status

- Required eight subscription/Plus checks: PASS after updating Home source assertions to canonical translation keys; Chinese title/body expectations remain checked in the dictionary.
- Provider/Auth browser regression: PASS, 8 cases, one subscription and paywall instance.
- New UI language coverage: PASS (126 keys × 4, interpolation parity, scene/locale switching, insight account/locale isolation, canonical chip payloads, transport identity/ranking, category titles, inventory guard).
- Existing combination localization and itinerary localization runtime: PASS.
- Transport copy consistency, Plus personalization, Home entitlement UI: PASS.
- Additional Plus entitlement authority check: FAIL also reproduced on unchanged HEAD; expects obsolete zero-argument sync call.
- Existing localization diversity hard gate: FAIL also reproduced on unchanged HEAD; English fallback delivery assertion (actual 1, expected 0). Not suppressed or changed.
- Full-App strict leakage completeness: FAIL while remaining inventory is nonempty.
- Production web build: PASS. No Capacitor sync or native build.
- TypeScript and non-formatting lint compared with HEAD; final results reported in response.

Next batch: prioritize Chat generated/fallback replies, saved trip/itinerary editing, Login/Settings/Profile, shared place metadata and generated recommendation locale persistence. Preserve internal enums and saved user content while moving display templates to canonical i18n.

## Files changed in this batch

- `docs/audits/ui-chinese-leakage-allowlist.json`
- `docs/audits/ui-chinese-leakage-remaining.json`
- `docs/audits/ui-language-coverage.md`
- `scripts/audit-ui-chinese-leakage.mjs`
- `scripts/verify-home-personalization-entitlement-ui.mjs`
- `scripts/verify-plus-purchase-ui.mjs`
- `scripts/verify-ui-language-coverage.mjs`
- `src/components/MapExploreSheet.tsx`
- `src/components/chat/ChatComposer.tsx`
- `src/components/home/HomePersonalizationCard.tsx`
- `src/components/map/MapExplorePlaceCards.tsx`
- `src/components/map/NavigationPreviewSheet.tsx`
- `src/components/map/PlaceDetailSheet.tsx`
- `src/hooks/use-home-weather.ts`
- `src/hooks/use-place-navigation.ts`
- `src/lib/chat-shortcut-chips.ts`
- `src/lib/estimate-travel-mode.ts`
- `src/lib/explore-search-radius.ts`
- `src/lib/home-personalization-insight.ts`
- `src/lib/i18n/messages.ts`
- `src/lib/i18n/ui-coverage.ts`
- `src/lib/place-category.ts`
- `src/lib/weather-scene.ts`
- `src/routes/_app.map.tsx`

Preexisting Provider/Auth changes, its browser regression, app-bundle-meta and config 2.xml were preserved. verify-plus-purchase-ui.mjs already had pending Provider/Auth work; this batch only updated its Home localization expectations.

Final diagnostics: HEAD/current TypeScript 334/334, new diagnostics 0 by file/code/message multiset; new formatting lint 0 and new non-formatting lint 0. git diff --check PASS. HEAD unchanged at 62fb6901c59ae16d7d01ec85a5571548fbeba4c9.
