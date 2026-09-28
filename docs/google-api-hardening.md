# Google API hardening — pre-change inventory

Baseline d5698dadd271d7bed26c45377dfd42cf8619e8ef. Branch security/google-api-hardening.
This inventory was captured before production source changes. No credentials are included.

| API / call-site family | Class | Before authority | Auth / limit before |
| --- | --- | --- | --- |
| google-maps-loader / loadGoogleMapsApi, injectMapsScript | A Client-only | EXPO_PUBLIC then VITE Google Maps key | Google Maps JavaScript application/API restrictions; no Roamie REST auth |
| places.functions / postPlaces, executeExploreSearch, Details | C → D | Explicit client key or shared server resolver | ServerFn Supabase middleware; client direct calls bypass server auth/limits; local concurrency/cache only |
| trip-stop-search.functions / searchTripStops, resolveTripStop | B | shared server resolver | Supabase middleware, per-isolate limiter |
| trip-stop-search-unified / trip-stop-coords / Explore selected details | C → D | Browser key REST fallback | Local cache/dedupe; direct provider has no server limiter |
| location.functions / searchTripLocations, geocodeTripLocationFromText, resolveTripLocation | B | shared server resolver (Places + Geocoding) | Supabase middleware, per-isolate limiter |
| location-search-unified / destination-geocode-client | C → D | Browser key for Places/Geocoding | Local bounds/cache; direct provider bypasses server auth |
| weather.functions / reverseGeocode | B | shared server resolver | Existing server function boundary |
| google-routes-client / google-routes.server / google-routes-fetch | C → D | Browser key or shared server resolver | ServerFn middleware; client direct bypass |
| google-directions-fetch / fetchGoogleDirectionsRoute | C → D | caller key; native or transit selects Directions | Client CapacitorHttp, server fetch; client direct bypass |
| /api/place-photo | B | shared server resolver with runtimeEnv | Existing signed resource / auth contract, per-isolate limit; bounded photo and width |
| /api/place-photo/sign | B | photo signing secret (not Google key) | Supabase auth; bounded photo and width |

Shared server priority before: GOOGLE_PLACES_SERVER_API_KEY → GOOGLE_MAPS_API_KEY → EXPO_PUBLIC_GOOGLE_MAPS_API_KEY → VITE_GOOGLE_MAPS_API_KEY; runtimeEnv → process.env → import.meta.env for each name. It accepts client credentials and incorrectly groups API families.

## Source/function index

| Source | Functions (including helpers) |
| --- | --- |
| `src/lib/places.functions.ts` | rawPlaceToHoursData, mapRawPlaces, parseGoogleError, getServerMapsKey, placesQueryFamily, locationCircle, filterWithinDistance, postPlaces, exploreLocale, buildSearchStats, searchText, searchNearby, searchMultiNearby, lookupPlaceHoursFromRaw, buildHoursLookupRequestKey, lookupPlacesHoursBatch, resolveItemHours, runExploreSearch, executeExploreSearch, searchPlaces, fetchPlaceDetailsForIntro, mapPlaceDetailsScreenRaw, fetchPlaceDetailsForScreenWithKey, fetchScreenDetailsNetwork, fetchPlaceDetailsForScreen, getPlaceDetails |
| `src/lib/trip-stop-search.functions.ts` | normalizeGooglePlaceId, parseGoogleError, searchTripStops, resolveTripStop |
| `src/lib/location.functions.ts` | coerceIsoRegionCode, parseGoogleError, componentText, resolveCity, resolveRegion, looksLikeAdminDistrictLabel, resolveDistrict, resolveSublocality, rawToTripLocation, legacyComponentText, legacyResolveCity, legacyGeocodeToTripLocation, compactGeocodeHint, pickBestGeocodeResult, legacyGeocodeToSuggestion, geocodeQueryToSuggestions, prefersGeocodeFirst, searchTripLocations, mapGeocodeApiStatus, logProviderResponse, resolveViaPlacesAutocompleteDetails, geocodeTripLocationFromText, resolveTripLocation |
| `src/lib/weather.functions.ts` | reverseGeocodeBigDataCloud, reverseGeocodeGoogle, reverseGeocodeCity, fetchOpenMeteoCurrentFallback, openMeteoCodeToCondition, fetchOpenMeteoDailyForecast, getWeatherForecast, getWeather, weatherTestConnection |
| `src/lib/google-routes.server.ts` | routeCacheKey, computeRouteRaw, getRouteDuration, getRouteDistance, getTripLegsWithDurations, testRoutesApiConnection, mapTravelModeToRoutes, fetchLegDurationsFromRoutes, haversineMeters |
| `src/lib/google-routes-client.ts` | computeRouteFromClient |
| `src/lib/google-directions-fetch.ts` | debugDirectionsVerbose, directionsFailureTelemetry, directionsModeForRoutesMode, sanitizeDirectionsUrl, buildLocationInput, resolveDirectionsDepartureUnixSeconds, sumLegDurations, fetchGoogleDirectionsRoute, fetchGoogleDirectionsForRoutesMode, fetchGoogleDirectionsTransit |
| `src/lib/google-routes-fetch.ts` | parseDurationSeconds, routesDeniedHint, routesFailureTelemetry, extractGoogleRouteStatus, formatDistanceText, logRouteResponse, fetchGoogleRoute |
| `src/lib/trip-stop-coords.ts` | normalizePlaceId, geocodeRegionForQuery, geocodeQueriesForItem, fetchPlaceCoordsClient, geocodeTextToCoordsClient, autocompleteTextToCoordsClient, geocodeItemToCoords, resolveTripStopCoords |
| `src/lib/location-search-unified.ts` | normalizeTripLocationQuery, tripLocationQueryVariants, componentText, resolveCity, geocodeUrl, clientGeocodeSuggestions, clientResolveTripLocation, unifiedSearchTripLocations, unifiedResolveTripLocation |
| `src/lib/trip-stop-search-unified.ts` | normalizeGooglePlaceId, unifiedSearchTripStops, unifiedResolveTripStop |
| `src/lib/ai/destination-geocode-client.ts` | candidateToTripLocation, geocodeOnceClient, placesAutocompleteDetailsClient, geocodeDestinationViaClient, isEmptyGeocodeEnvelope |
| `src/lib/google-maps-loader.ts` | isGoogleMapsNetworkError, waitForImportLibrary, injectMapsScript, loadGoogleMapsApi, triggerMapResize |
| `src/routes/api/place-photo.ts` | safeErrorName, photoFailureResponse, buildPlacePhotoUpstreamPath, buildPlacePhotoUpstreamUrl, validatePhotoResource, handlePlacePhotoRequest |
| `src/routes/api/place-photo/sign.ts` | Route.server.handlers.POST (anonymous handler) |


## Final authority and transport

| API | After authority | Transport / authentication |
| --- | --- | --- |
| Maps JavaScript | Existing client resolver: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY → VITE_GOOGLE_MAPS_API_KEY | Existing Maps JS renderer/loader; client-visible by design |
| Places New searchText/searchNearby/autocomplete/details | GOOGLE_PLACES_SERVER_API_KEY | Browser/native → Bearer-authenticated POST /api/google → allowlisted provider; existing ServerFn → provider |
| Place Photos | GOOGLE_PLACES_SERVER_API_KEY | Authenticated sign endpoint → short-lived signed photo URL → server fetch; never client Google media URL |
| Routes computeRoutes + Directions (legacy) | GOOGLE_ROUTES_SERVER_API_KEY | Same protected transport; native and TRANSIT retain existing Directions selection |
| Geocoding forward/reverse/place_id | GOOGLE_GEOCODING_SERVER_API_KEY | Same protected transport |

Each server family resolves only its own runtimeEnv binding, then the same-name process.env binding. Invalid explicit runtime bindings fail closed. No shared-key, public-env, other-family or import.meta.env fallback. Worker compatibility settings populate process.env from runtime bindings. `roamie-server-proxy` is a non-secret compatibility marker for existing helper signatures; it is discarded along with any supplied API-key header/query before the request crosses the client boundary. The authoritative Google credential is injected only by the server provider adapter.

No Maps renderer, carousel, sheet, Google photo image decoding, RevenueCat, RLS, signing, project build number or package dependencies were changed. Photo endpoints receive rate-limit checks and signing request size protection.

Additional delegated call sites checked in the complete graph:

| Source/function | Class/API | Auth and limits |
| --- | --- | --- |
| src/lib/place-navigation.functions.ts / fetchPlaceTravelDurations → google-directions.server / fetchLegDurations | B Routes/Directions | Supabase + Google binding middleware added |
| src/lib/transit.functions.ts / recommendTransitLegs → transit/build-legs.server / buildTransitLegsForItinerary | B Routes/Directions | Supabase + Google binding middleware added; max 30 itinerary items |
| src/lib/recommendation.functions.ts / getPlaceIntro → pie gateway → Details | B Places Details | Supabase + Google binding middleware added |
| src/lib/recommendation/fetch-candidates.server.ts / fetchVerifiedCandidates → executeExploreSearch | B Places | Called by authenticated AI service; existing AI rate/credits gates remain |
| src/lib/itinerary.functions.ts / generateItinerary → AI service and buildTransitLegsForItinerary | B Places/Routes/Directions | Existing requireItineraryCredits → Supabase auth, request limits and credits; no subscription contract change |
| src/routes/api/chat.ts, api/roamie.ts → ai/service.server.ts / preparePlacesFirstContext | B delegated Places | Existing verified Supabase auth, per-isolate AI rate limits and credit reservations; these are not the new raw Google proxy |
| src/lib/pie/places-gateway.ts and delegates | C internal wrappers | Delegate to the above transport; no independent Google credential |
| src/lib/env.server.ts / resolveGoogleMapsKey; google-maps.server.ts re-export | B compatibility helpers | Places-only resolver after hardening; not an additional API endpoint |
| src/lib/google-maps-api.ts / URL builders | C pure builders | No network or env authority; photo media builder used on server |
| src/lib/explore-map-search.ts / resolveExploreMapPlaceDetail; explore-primary-place.ts / detail fetch; routes/_app.place.tsx / detail effect | D → protected client transport | Details via PIE; Bearer session, no browser Google key |

## Endpoint security contract

- POST `/api/google`: Supabase `getUser(token)` verifies the bearer credential. Any authenticated Roamie user may query public place/route data; no paid entitlement or arbitrary user-id claim is trusted. Missing/invalid identity: 401. Auth configuration failure: sanitized 503.
- Google rate binding must exist: absent/error → 503, quota rejected → 429 + Retry-After. New proxy limits IP before auth and verified user after auth. Added ServerFn middleware limits verified user before provider work. Existing AI endpoints retain their separate auth/credit/request gates.
- Configured local binding: `GOOGLE_API_RATE_LIMITER`, namespace `1001`, 120 requests / 60 seconds per key. Sign and photo use separate key namespaces (`google:sign:user`, `google:photo:ip`). Confirm account namespace ownership; use a separate namespace for staging.
- Signed photo GET is intentionally usable without a JWT header because an img request cannot supply the session header. Access requires a valid resource/width/expiry signature minted for an authenticated user. Possession permits replay until expiry (10 minutes); cached image TTL is shorter and IP limits remain. This is a short-lived bearer capability, not public arbitrary proxy access.
- JSON proxy body max 16 KiB by actual streamed bytes; photo signing max 8 KiB. URL/path/domain/method allowlist; no redirects, arbitrary headers, arbitrary fields or Google key parameter. Queries <=512 chars, coordinates bounded, radius <=50 km, results <=20, autocomplete primary types <=5, bounded place ID and tokens. Existing `(regions)` destination lookup is explicitly supported.
- Field masks preserve existing narrow requests (including addressComponents); only allowlisted fields can be selected. No wildcard mask.
- Provider failures return fixed error codes; Google body, raw error/URL/key never forwarded or logged by adapter. Success JSON also strips credential-shaped values. Existing photo logs expose only an allowlisted error name/status, not URLs/keys.
- CORS: existing Worker handler allows `capacitor://localhost` on API routes; new Google proxy also checks same-origin/native Origin. No arbitrary reflected origin or `*`. CORS is not authentication; Bearer verification is mandatory.
- Rate Limiting binding is per Cloudflare location and eventually consistent, **not** a global spend cap. Multiple accounts/IPs and AI request fan-out remain considerations. Set Google API quotas, alerts and operational monitoring before rollout; budget alerts alone do not stop spend. Do not describe this change as eliminating all quota-abuse risk.

## Cloudflare setup plan — NOT executed

Configure the exact Worker/environment selected for staging first. Do not paste secrets into source, wrangler vars, VITE_ values or command-line arguments. Cloudflare Dashboard → Workers & Pages → target Worker → Settings → Variables and Secrets → Add → Secret:

| Secret | Google Cloud credential to use |
| --- | --- |
| GOOGLE_PLACES_SERVER_API_KEY | Dedicated Places New-only server key. Existing “API 金鑰 2” is a candidate only after privately matching its fingerprint; repository cannot establish the console display-name mapping. |
| GOOGLE_ROUTES_SERVER_API_KEY | Separate server key with Routes API + Directions API, because both are used. Neither the Places-only key nor the exposed Maps client key. |
| GOOGLE_GEOCODING_SERVER_API_KEY | Separate server key restricted to Geocoding API. |

Existing endpoint prerequisites must also be present: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PLACE_PHOTO_SIGNING_SECRET` (>=32 bytes, kept server-side). Do not rotate the signing secret as part of this task. The local wrangler change declares the rate-limit binding; production resources/settings have not been changed.

Read-only prior production audit did not confirm deployed Google secret bindings. Local .env values are not proof of production deployment. No attempt was made to set secrets, rotate keys or change restrictions in this stage.

Rollout sequence for a separately authorized stage:
1. Match credential fingerprints privately; create/assign the dedicated server API authorities and independent staging rate namespace. Confirm Google billing/API enablement and quotas.
2. Configure runtime secrets and existing auth/photo prerequisites in staging; deploy this reviewed branch to staging only when authorized.
3. Verify authenticated Places/photos, driving/walking/transit, geocoding and Chat/itinerary; deliberately remove each server key/binding and confirm fail-closed behavior. Verify rate-limit and signed-photo replay/expiry contracts on the real Worker.
4. Test iPhone/iPad WKWebView against staging, including CORS, session refresh and Maps JS. Then production deploy and build a new iOS release only after separate authorization.
5. Do not remove old client-key REST API permissions while Build 82 users still use direct REST. A deployment alone does not replace the installed iOS JavaScript. Coordinate new binary rollout/support window before restricting the old exposed key.

## Google Cloud restrictions — recommendations only

| Credential | Application restriction | API restrictions |
| --- | --- | --- |
| A: client Maps key | HTTPS browser: Websites, exact production/staging referrers. Capacitor bundled `capacitor://localhost` needs separate device validation; do NOT apply iOS Bundle restriction to Maps JS. | Maps JavaScript API only for the new architecture, after old-client migration |
| B: server Places | Fixed server egress IPs if an actual fixed-egress architecture exists. Ordinary Workers egress is not a dedicated fixed IP; do not whitelist all Cloudflare ranges. If no fixed egress, None is a documented interim limitation, with secret isolation + API restriction + quotas. | Places API (New) only |
| C: server Routes | Same fixed-egress consideration | Routes API + Directions API |
| D: server Geocoding | Same fixed-egress consideration | Geocoding API only |

A bundled WKWebView often omits Referer. There is no claim that adding `capacitor://localhost` to Website restrictions will work. A fully referrer-restricted solution needs controlled HTTPS-delivered content or a future native Maps SDK migration; both are outside this renderer-preserving task. Keeping Application=None for the bundled Maps client is a residual extraction/replay risk even when limited to Maps JavaScript. Never reuse that exposed key for the three server authorities.

Official references: [Google security guidance](https://developers.google.com/maps/api-security-best-practices), [Cloudflare rate-limit semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Verification and limits

Deterministic scripts added:
- `scripts/verify-google-api-hardening.mjs`: resolver rejects public/legacy keys, missing/invalid secrets, API-family separation, 9 provider operation fixtures, rate/auth/origin/body/parameter/field bounds, provider errors/log redaction, ServerFn rate middleware and photo-body bounds.
- `scripts/verify-google-client-transport.mjs`: actual client transport + route parser, 12 browser/native operations, all network calls target authenticated Roamie proxy, no Google key in payload, `(regions)` and narrow Details fields preserved, absent session blocks network.
- `scripts/verify-google-client-bundle.mjs`: known local/runtime fingerprints, unknown Google key detection, forbidden server authority/value detection, negative controls, exact JS/CSS parity in dist/client and iOS public assets. Build uses synthetic Routes/Geocoding canaries because real dedicated keys are not configured locally.
- `scripts/verify-google-map-renderer.mjs`: actual GoogleMap and actual cached Maps JS loader, controlled external SDK, render/ready/marker coordinates/selection/click/replacement. No live Google billing call.

Existing suites cover directions fallback/place IDs, route failure telemetry and CTA contract, photo proxy/signatures, native Explore search, semantic eligibility and Akihabara candidates, Home Nearby/weather/photos, Place Detail photos/no-photo fallback, itinerary/Chat destination flow, legal/support and router pending lifecycle. Existing stale route-label fixture was corrected from 開車 to 租車自駕, matching unchanged production behavior; no UI label was changed.

Local fixtures and Chrome regression do not establish Google production restrictions, real Supabase sessions, production Worker bindings or iPad WKWebView PASS. Those are explicit next-stage acceptance items. Build 82 already uploaded remains unchanged; a new iOS build is required to distribute these bundled-client changes.


## Final observed results (2026-09-28 Asia/Taipei)

- Preflight was stable, HEAD/origin stable `d5698dadd271d7bed26c45377dfd42cf8619e8ef`, clean/staged=0. Isolated branch created before source edits.
- Final 30-suite regression run: 30 PASS / 0 FAIL. Run regressions after build completes: the release build temporarily sanitizes build env; running env-dependent diagnostic/feature-flag fixtures concurrently with it can produce misleading failures. Both affected fixtures passed isolated and the complete final run passed after build.
- Additional client transport (12 operations), actual Maps renderer and bundle scan: PASS.
- Chrome sheet interaction: 4 viewports PASS; expanded geometry/gesture suite: 81 states PASS. The existing geometry harness can leave the esbuild process alive after printing PASS; test assertions completed.
- Built Worker router/login: 104 checks, 20 race rounds, 80 repeated document navigations, zero blank login/uncaught errors. Public support/privacy/terms and Login legal navigation/reload: PASS.
- Built Worker `/api/google`: GET 405, anonymous POST 401, native anonymous POST 401 with exact CORS origin, hostile Origin 403, native OPTIONS 204. No authenticated live Google request was made.
- Production build: PASS. Final client entry `index-DRVl4Sx0.js`. Capacitor bundled sync: PASS, no server.url. 116 JS/CSS assets exactly match between production and iOS public bundle; 126 total web files / 128 total iOS files (native additions).
- Client Maps SHA-256 prefix `6f6e276de97c…` present in both. Dedicated local Places prefix `1e58bc5ac1bf…` absent in both. Synthetic Routes canary prefix `b129113c2560…` and Geocoding canary prefix `41e22fbc7608…` absent in both. These last two are test canaries, not configured production credentials. Server authority names absent; no unrecognized Google key found.
- 64 task logs scanned against known local server credential values: no match. Scanner negative controls passed.
- TypeScript: baseline 321 errors, current 321, same per-source/error-code multiset; not a clean typecheck. Long diagnostic messages differ in temporary baseline checkout paths/truncation, not new error locations/types.
- Generated build timestamp source restored to HEAD after building/syncing; built artifacts retain the current security branch metadata. No source credential or asset changes were reverted.
- `git diff --check`: PASS. Staged=0. Working tree intentionally contains this uncommitted security implementation. HEAD, stable and origin/stable remain `d5698dadd271d7bed26c45377dfd42cf8619e8ef`.
- iOS Debug/Release still Marketing 1.0 / Build 82 / Device family 1. No Archive, build bump, submission, commit, merge, push, deploy or remote secret/restriction change.

### Changed files

- `docs/google-api-hardening.md`
- `scripts/public-client-env.mjs`
- `scripts/verify-directions-fallback.mjs`
- `scripts/verify-explore-native-search.mjs`
- `scripts/verify-google-api-hardening.mjs`
- `scripts/verify-google-client-bundle.mjs`
- `scripts/verify-google-client-transport.mjs`
- `scripts/verify-google-map-renderer.mjs`
- `scripts/verify-google-maps-server-key.mjs`
- `scripts/verify-place-photo-proxy.mjs`
- `src/lib/ai/destination-geocode-client.ts`
- `src/lib/api-url.ts`
- `src/lib/explore-map-search.ts`
- `src/lib/explore-primary-place.ts`
- `src/lib/google-directions-fetch.ts`
- `src/lib/google-maps-key-resolve.server.ts`
- `src/lib/google-proxy.server.ts`
- `src/lib/google-rate-limit.server.ts`
- `src/lib/google-request-body.server.ts`
- `src/lib/google-rest-contract.ts`
- `src/lib/google-rest-provider.server.ts`
- `src/lib/google-rest-transport.ts`
- `src/lib/google-routes-client.ts`
- `src/lib/google-routes-fetch.ts`
- `src/lib/google-routes.server.ts`
- `src/lib/location-search-unified.ts`
- `src/lib/location.functions.ts`
- `src/lib/place-navigation.functions.ts`
- `src/lib/places-search-unified.ts`
- `src/lib/places.functions.ts`
- `src/lib/recommendation.functions.ts`
- `src/lib/routes.functions.ts`
- `src/lib/transit.functions.ts`
- `src/lib/trip-stop-coords.ts`
- `src/lib/trip-stop-search-unified.ts`
- `src/lib/trip-stop-search.functions.ts`
- `src/lib/weather.functions.ts`
- `src/routeTree.gen.ts`
- `src/routes/_app.place.tsx`
- `src/routes/api/google.ts`
- `src/routes/api/place-photo.ts`
- `src/routes/api/place-photo/sign.ts`
- `wrangler.jsonc`
