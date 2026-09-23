# Multi-specific Place Identity audit

## Scope and evidence status

This round changes the existing canonical classifier, regression scripts and this report only. No commit, push, Archive, Google Places request, review extraction change, opening-hours authority change, or recommendation engine redesign.

**Stellar Garden and karaksa raw runtime capture is not available in the workspace.** Searches of source/docs/fixtures and existing `/tmp/roamie-*` captures found only an unrelated synthetic Stellar Garden itinerary test. No API call was made to fill this gap. The user-reported labels/names are observations, not a captured Google response. New fixtures are explicitly synthetic and must not be cited as actual device evidence.

## A / C — Raw evidence and controlled trace

| Runtime field | Stellar Garden | karaksa hotel premier 東京銀座 |
|---|---|---|
| placeId | unavailable | unavailable |
| rawTypes / normalizedTypes | unavailable | unavailable |
| primaryType / primaryTypeDisplayName | unavailable | unavailable |
| existingCategory / sourceCategory | unavailable | unavailable |
| Device output reported by user | 早餐店 | 地點 |
| User-reported provider display | Google Maps: 酒吧 | Actual business: hotel |

Consequently the exact per-device selection path cannot yet be claimed. `buildPlaceIdentityTrace` now exposes name/subtitle, provider display, source category, candidates (semantic type, sources, specificity, role, ordinal confidence, compatibility evidence), selection source/reason, fallback reason and final label. Existing scoped diagnostics use localStorage `roamie:identity-trace-place-id`; no unconditional production logging or extra fetch was added. Confidence is an authority tier, not a statistical probability.

The script `scripts/verify-place-identity-multispecific.mjs` prints complete `PLACE_IDENTITY_TRACE` JSON with provenance `synthetic_user_report_scenario_NOT_runtime_capture` for both scenarios. In those fixtures:

- Stellar: types `[bar, restaurant, breakfast_restaurant]`; primary/display/category absent; subtitle `Sky Bar & Dining Stellar Garden`; bar has provider + compatible name evidence; breakfast is meal attribute; selected bar through compatible name; final 酒吧.
- karaksa: types `[hotel, lodging, point_of_interest, establishment]`; primary/display/category absent; hotel has structured lodging compatibility and name support; selected hotel; final 飯店. This fixture does **not** establish which types the real device received.

## B — Prior failure mechanism

The previous classifier sorted all recognized types by fixed rank before considering Google primary type. `breakfast_restaurant` had rank 90 and `bar` rank 80, so even a primary bar could lose. That is a reproducible code defect, but the missing raw capture prevents asserting that it is the exact device data path. Lodging types had no canonical mappings, so hotel/lodging evidence could fall through to generic 地點.

## D / E — Roles and authority

- `bar`: business identity; breakfast/brunch: meal-service attributes unless independently selected by explicit primary/display/category evidence or the only effective specific evidence.
- Structured primary → localized primary display → compatible source/semantic category → provider-compatible name/subtitle → recognized types → generic fallback.
- A specific explicit primary (bar, cafe, bakery, etc.) cannot lose to another type's enum rank or name hint.
- Broad types can be refined within compatible families: restaurant to cuisine; lodging to hotel/hostel/etc.; hotel to resort/extended-stay hotel. Generic retail/gift identity can be refined to a provider-supported product specialty, including cake shop. This preserves the captured Sugar & Spice case, whose primary is gift_shop. It is a taxonomy refinement rule, not a shop-name exception.
- Cake shop refines broad bakery/confectionery/candy/dessert evidence when no stronger explicit primary decides; explicit primary bakery still wins.
- Meal attributes cannot refine a primary restaurant/bar/cafe. Breakfast alone still means 早餐店; explicit primary breakfast remains respected.
- Specificity removes broad evidence, not competing specific identities. Unresolved peers use stable lexical order, with `ambiguous_specific_candidates` in trace; array order does not affect output.
- Hours never participate in identity selection.

## F — Name compatibility

Bar/pub/lounge word boundaries (or 酒吧) require bar-compatible provider evidence. Hotel requires lodging evidence, and cannot invent hotel from a park or displace specific hostel/resort evidence through generic lodging. Other existing name refinements remain provider-constrained. No store-name conditions, brand list, AI inference, review-derived identity or hour-derived identity was added. Subtitle is optional; if absent, only available name and structured fields participate.

## G — Existing captured cases

The pre-existing provider capture fixture is replayed without network requests:

| Case | Captured primary | Result |
|---|---|---|
| 85°C 高雄富國店 | cafe | 咖啡廳 |
| 阿默高雄立文店 | cake_shop | 蛋糕店 |
| 糖村高雄立文店 | gift_shop, with cake_shop in types | 蛋糕店 |

All pass, including adapter replay in the existing identity suite.

## H — Resulting reasons in controlled scenarios

Stellar synthetic scenario:

> 這是一間酒吧。今天 07:00–10:30、12:00–16:30、17:00–01:00 營業。

Browser hotel enrichment scenario (independent test review evidence):

> 這是一間飯店，可取得的評論中，有一則提到環境安靜；有一則提到服務親切。今天 07:00–23:00 營業。

The browser test verifies generic → hotel recomputation in four mounted renderer instances, preserving review and hour evidence with zero provider fetches. These results are controlled verification, not a new physical-device acceptance result. No view/romance/date-night claims are generated from the name.

## I — Requests and taxonomy

Zero additional Places/API calls. Existing masks/adapters/caches are unchanged in this round. Tests replay local responses or fail immediately on unexpected fetch.

Verified lodging types against [Google Places type documentation](https://developers.google.com/maps/documentation/places/web-service/place-types): hotel, lodging, resort_hotel, hostel, motel, bed_and_breakfast, guest_house, extended_stay_hotel. The documentation lookup was not a Places API request. Breakfast and brunch exist; lunch_restaurant was absent from the published list and was not added.

## J — Files changed this round

1. `src/lib/place-identity.ts`: canonical authority, lodging mappings, candidate trace.
2. `scripts/verify-place-identity-multispecific.mjs`: 45 new scenarios, including reverse-array checks and three existing captures.
3. `scripts/verify-recommendation-review-browser.mjs`: additional mounted generic → hotel scenario retaining reviews/hours.
4. `docs/place-identity-multispecific-audit.md`: this report.

Existing changes from previous rounds remain in the working tree. Build-generated metadata was restored to its pre-round content, rather than discarding unrelated existing changes.

## K — Verification

PASS:

- New multi-specific/lodging suite: 45 scenarios; zero network requests.
- Existing Place Identity runtime suite: 28 named scenarios including three captured adapter replays.
- Recommendation Review runtime: 23 scenarios.
- Recommendation Reason Authority: 30 scenarios.
- Explore request storm: 14 scenarios.
- Places request orchestration; native adapter; Places cost/cache capability.
- Favorites refresh race; recommendation persistence.
- Place Details device regressions and opening; canonical identity; recommendation authority; Plus personalization.
- Itinerary core; server Google identity; deliverable rebuild.
- Reason diversity; recommendation template pipeline.
- Chrome browser review/identity lifecycle: PASS, including new hotel upgrade across four mounted renderers, zero provider fetches.
- Production build; git diff --check.
- Scoped lint: zero errors/warnings in all three code/test files.
- TypeScript: 321 pre-existing diagnostics; zero added versus pre-round baseline (compare diagnostic text ignoring line movement). No unrelated TS cleanup.

Browser test needed sandbox escalation solely for localhost/Chrome. No Google network requests were performed.

Previously documented unrelated limitations remain: itinerary real-pool gate/source-regex tests, malformed place-detail-chat .mjs, old map-cache-key expectation, and the previously identified cancelled-search cache race. These are not fixed or represented as newly passing by this identity work. This round does not assert that the entire existing working tree is release-ready.

## L — Diff / acceptance boundary

Four files changed by this round; cumulative working-tree diff includes earlier uncommitted work. No commit, push or Archive. Await device acceptance and actual scoped traces for the two new cases. If a device still receives only generic types without display/category evidence, the classifier deliberately remains generic instead of guessing from a name alone.
