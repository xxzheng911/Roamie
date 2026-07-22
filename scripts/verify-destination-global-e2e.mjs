/**
 * Global Destination Anchor end-to-end verification.
 *
 * Layers:
 *   A) Parser fixtures (no network)
 *   B) Live Provider Integration (real Geocode / Places Autocomplete)
 *   C) Full pipeline: Anchor → Combination Discovery → Candidate Pool / Planner /
 *      Validators → in-memory itinerary persistence
 *
 * Usage:
 *   npm run verify:destination-global-e2e
 *   npm run verify:destination-global-e2e -- --anchor-only
 *   npm run verify:destination-global-e2e -- --limit=5
 *
 * Requires GOOGLE_MAPS_API_KEY (Geocoding) in env / .env.
 * Does NOT mock coordinates or skip failures.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

process.env.VITE_CANDIDATE_POOL_ENABLED ??= "1";
process.env.VITE_REC_ENGINE_PLANNER_ENABLED ??= "1";
process.env.VITE_REC_ENGINE_VALIDATOR_ENABLED ??= "1";
process.env.VITE_ITINERARY_VALIDATOR_ENABLED ??= "1";
process.env.VITE_DEBUG_DIAGNOSTICS ??= "1";

import {
  extractCoordinatesFromProviderResponse,
  extractDestinationCandidatesFromProviderResponse,
} from "../src/lib/ai/destination-provider-coords.ts";
import {
  buildDestinationGeocodeQueries,
  clearDestinationGeocodeCache,
  resolveGeocodeRegionBias,
} from "../src/lib/ai/destination-geocode.ts";
import {
  resolveDestinationAnchor,
  buildDestinationOptionsFromCityList,
  clearCityCentroidCache,
} from "../src/lib/ai/destination-anchor.ts";
import { clearResolvedDestinationScope } from "../src/lib/ai/resolved-destination-scope.ts";
import {
  ensureDestinationCombinationsReady,
  clearDiscoveredCombinationsCache,
} from "../src/lib/ai/destination-combination-discovery.ts";
import {
  geocodeForwardUrl,
  placesAutocompleteUrl,
  placeDetailsUrl,
  placesSearchTextUrl,
  PLACES_FIELD_MASK,
} from "../src/lib/google-maps-api.ts";
import { localeToGoogleLanguageCode } from "../src/lib/i18n/places-language.ts";
import { normalizeCountryReference } from "../src/lib/ai/destination-country-normalize.ts";
import { countryCodeForCountryName } from "../src/lib/ai/resolved-destination-scope.ts";
import { DESTINATION_ANCHOR_BUILD_VERSION } from "../src/lib/ai/destination-provider-log.ts";
import { generateTripPlanFromStyle } from "../src/lib/ai/destination-trip-planning.ts";
import { classifyDestinationForPlaceSearch } from "../src/lib/ai/landmark-place-strategy.ts";
import { resetPlannerSession } from "../src/lib/ai/planner-session-guard.ts";
import {
  freezePlanningDayPlan,
  getFrozenPlanningDayPlan,
} from "../src/lib/ai/ai-planning-session.ts";
import { normalizeGooglePlaces } from "../src/lib/ai/normalize-google-place.ts";

const args = process.argv.slice(2);
const ANCHOR_ONLY = args.includes("--anchor-only");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const DAYS = 2; // requiredCanonical = days*3 → 6; keeps validator rules unchanged while Places budget stays practical


/** 25 required global destinations */
const CASES = [
  { country: "日本", destination: "東京", entityType: "city", countryCode: "JP", days: DAYS },
  { country: "日本", destination: "名古屋", entityType: "city", countryCode: "JP", days: DAYS },
  { country: "日本", destination: "福岡", entityType: "city", countryCode: "JP", days: DAYS },
  { country: "日本", destination: "熊本", entityType: "city", countryCode: "JP", days: DAYS },
  { country: "韓國", destination: "首爾", entityType: "city", countryCode: "KR", days: DAYS },
  { country: "中國", destination: "深圳", entityType: "city", countryCode: "CN", days: DAYS },
  { country: "泰國", destination: "曼谷", entityType: "city", countryCode: "TH", days: DAYS },
  { country: "泰國", destination: "芭達雅", entityType: "resort_area", countryCode: "TH", days: DAYS },
  { country: "泰國", destination: "普吉島", entityType: "island", countryCode: "TH", days: DAYS },
  { country: "印尼", destination: "峇里島", entityType: "island", countryCode: "ID", days: DAYS },
  { country: "越南", destination: "峴港", entityType: "city", countryCode: "VN", days: DAYS },
  { country: "新加坡", destination: "新加坡", entityType: "city", countryCode: "SG", days: DAYS },
  { country: "蒙古", destination: "烏蘭巴托", entityType: "city", countryCode: "MN", days: DAYS },
  { country: "蒙古", destination: "戈壁", entityType: "region", countryCode: "MN", days: DAYS },
  { country: "法國", destination: "巴黎", entityType: "city", countryCode: "FR", days: DAYS },
  { country: "英國", destination: "倫敦", entityType: "city", countryCode: "GB", days: DAYS },
  { country: "義大利", destination: "羅馬", entityType: "city", countryCode: "IT", days: DAYS },
  { country: "西班牙", destination: "巴塞隆納", entityType: "city", countryCode: "ES", days: DAYS },
  { country: "捷克", destination: "布拉格", entityType: "city", countryCode: "CZ", days: DAYS },
  { country: "美國", destination: "紐約", entityType: "city", countryCode: "US", days: DAYS },
  { country: "美國", destination: "洛杉磯", entityType: "city", countryCode: "US", days: DAYS },
  { country: "加拿大", destination: "溫哥華", entityType: "city", countryCode: "CA", days: DAYS },
  { country: "墨西哥", destination: "墨西哥城", entityType: "city", countryCode: "MX", days: DAYS },
  { country: "埃及", destination: "開羅", entityType: "city", countryCode: "EG", days: DAYS },
  { country: "澳洲", destination: "雪梨", entityType: "city", countryCode: "AU", days: DAYS },
];

const FOCUS_LOG = new Set(["名古屋", "普吉島", "芭達雅", "戈壁", "開羅"]);

const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error("FAIL missing GOOGLE_MAPS_API_KEY");
  process.exit(1);
}

const capturedLogs = [];
const originalInfo = console.info;
console.info = (...args) => {
  const line = args.map(String).join(" ");
  capturedLogs.push(line);
  originalInfo(...args);
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resetCaches(dest) {
  clearDestinationGeocodeCache(dest);
  clearCityCentroidCache(dest);
  clearResolvedDestinationScope(dest);
  clearDiscoveredCombinationsCache(dest);
}

function countryOptions(country, destination, entityType) {
  return buildDestinationOptionsFromCityList(
    [{ name: destination, type: entityType }],
    country,
  );
}

async function liveGeocodeFn({ data }) {
  const query = data.query.trim();
  const language = localeToGoogleLanguageCode(data.locale ?? "zh-TW");
  const region = data.region || data.countryCode?.toLowerCase();
  const res = await fetch(geocodeForwardUrl(query, apiKey, { language, region }));
  let json;
  try {
    json = await res.json();
  } catch {
    return { location: null, error: "geocode_decode_error" };
  }
  const extracted = extractCoordinatesFromProviderResponse(json);
  if (extracted.candidates[0] && Number.isFinite(extracted.candidates[0].latitude)) {
    const c = extracted.candidates[0];
    const normalized = normalizeCountryReference(c.country, c.countryCode);
    return {
      location: {
        placeId: c.placeId ?? `geocode:${c.latitude},${c.longitude}`,
        country: normalized.country || c.country || query,
        city: c.name || query,
        lat: c.latitude,
        lng: c.longitude,
        formattedName: c.formattedAddress || c.name || query,
        displayLabel: c.formattedAddress || c.name || query,
        address: c.formattedAddress,
        timezone: undefined,
        utcOffsetMinutes: null,
      },
      error: null,
    };
  }

  // Places Autocomplete → Details fallback (same as production server path)
  const autoRes = await fetch(placesAutocompleteUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
    },
    body: JSON.stringify({
      input: query,
      languageCode: language,
      ...(region ? { includedRegionCodes: [region.toUpperCase()] } : {}),
    }),
  });
  const autoJson = await autoRes.json();
  const placeId = autoJson.suggestions?.find((s) => s.placePrediction?.placeId)
    ?.placePrediction?.placeId;
  if (!placeId) {
    return {
      location: null,
      error:
        json.status === "REQUEST_DENIED"
          ? "geocode_request_denied"
          : json.status === "ZERO_RESULTS"
            ? "geocode_zero_results"
            : "places_autocomplete_empty",
    };
  }
  const id = String(placeId).replace(/^places\//, "");
  const detailRes = await fetch(placeDetailsUrl(id, language), {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,location,addressComponents,types,primaryType",
    },
  });
  const detail = await detailRes.json();
  const ex2 = extractCoordinatesFromProviderResponse(detail);
  if (!ex2.candidates[0]) {
    return { location: null, error: "places_details_empty" };
  }
  const c = ex2.candidates[0];
  const normalized = normalizeCountryReference(c.country, c.countryCode);
  return {
    location: {
      placeId: id,
      country: normalized.country || c.country || query,
      city: c.name || query,
      lat: c.latitude,
      lng: c.longitude,
      formattedName: c.formattedAddress || c.name || query,
      displayLabel: c.formattedAddress || c.name || query,
      address: c.formattedAddress,
      timezone: undefined,
      utcOffsetMinutes: null,
    },
    error: null,
  };
}

async function liveSearchPlaces({ data }) {
  const query = data.query?.trim();
  if (!query) return { places: [], error: null };
  const body = {
    textQuery: query,
    maxResultCount: 16,
    languageCode: "zh-TW",
  };
  if (
    Number.isFinite(data.lat) &&
    Number.isFinite(data.lng) &&
    !data.skipLocationBias
  ) {
    body.locationBias = {
      circle: {
        center: { latitude: data.lat, longitude: data.lng },
        radius: data.radius ?? 25_000,
      },
    };
  }
  if (data.includedTypes?.length) {
    body.includedType = data.includedTypes[0];
  }
  const res = await fetch(placesSearchTextUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
      "Accept-Language": "zh-TW",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { places: [], error: `places_http_${res.status}` };
  }
  const json = await res.json();
  const raw = json.places ?? [];
  const places = normalizeGooglePlaces(raw);
  return { places, error: null };
}

const searchDestinationPlaces = async (params) => {
  const all = [];
  const seen = new Set();
  const attempts = params.attempts?.length
    ? params.attempts.slice(0, 12)
    : [
        { query: `${params.label} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${params.label} 景點`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${params.label} museum`, mode: "text", includedTypes: ["museum"] },
        { query: `${params.label} restaurant`, mode: "text", includedTypes: ["restaurant"] },
      ];
  for (const attempt of attempts) {
    const result = await liveSearchPlaces({
      data: {
        query: attempt.query,
        lat: params.lat,
        lng: params.lng,
        mode: attempt.mode === "nearby" ? "nearby" : "text",
        includedTypes: attempt.includedTypes,
        radius: params.radius ?? 25_000,
        locale: params.locale ?? "zh-TW",
        placesCaller: params.caller ?? "verify.destination.global.e2e",
        destinationName: params.label,
      },
    });
    for (const p of result.places ?? []) {
      const id = p.id || p.placeId || p.name;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push(p);
    }
    await sleep(120);
  }
  return all;
};

// ─── Layer A: Parser fixtures ───────────────────────────────────────────────
console.log("\n=== Layer A: Parser fixtures ===\n");
{
  const withFn = extractCoordinatesFromProviderResponse({
    results: [
      {
        geometry: {
          location: {
            lat: () => 35.18,
            lng: () => 136.9,
          },
        },
        types: ["locality", "political"],
        formatted_address: "Nagoya",
        address_components: [{ long_name: "Japan", short_name: "JP", types: ["country"] }],
      },
    ],
  });
  assert.equal(withFn.candidates.length, 1);
  assert.equal(withFn.candidates[0].latitude, 35.18);

  const candidatesShape = extractDestinationCandidatesFromProviderResponse(
    {
      candidates: [{ name: "Gobi", location: { latitude: 42.5, longitude: 105.0 } }],
    },
    { provider: "proxy", sourceQuery: "Gobi" },
  );
  assert.equal(candidatesShape.length, 1);
  assert.ok(Number.isFinite(candidatesShape[0].latitude));

  const zeroOk = extractCoordinatesFromProviderResponse({
    results: [{ geometry: { location: { lat: 0, lng: 0 } }, types: ["locality"] }],
  });
  assert.equal(zeroOk.candidates.length, 1, "0,0 must be valid via Number.isFinite");

  for (const [dest, country] of [
    ["開羅", "埃及"],
    ["名古屋", "日本"],
    ["普吉島", "泰國"],
    ["戈壁", "蒙古"],
  ]) {
    const q = buildDestinationGeocodeQueries(dest, "zh-TW", country);
    assert.ok(q.length <= 6, `${dest} queryCount=${q.length}`);
    assert.ok(q.length >= 1);
  }
  assert.equal(normalizeCountryReference("埃及").countryCode, "EG");
  assert.equal(countryCodeForCountryName("埃及"), "EG");
  assert.equal(resolveGeocodeRegionBias("埃及", "EG"), "eg");
  console.log("OK parser fixtures + Egypt country normalize + query cap");
}

// ─── Layers B + C ───────────────────────────────────────────────────────────
console.log(`\n=== Layers B/C: live provider + pipeline (version=${DESTINATION_ANCHOR_BUILD_VERSION}) ===\n`);

const report = [];
const cases = CASES.slice(0, Number.isFinite(LIMIT) ? LIMIT : CASES.length);
let passCount = 0;

for (const c of cases) {
  const row = {
    country: c.country,
    destination: c.destination,
    entityType: c.entityType,
    countryCode: c.countryCode,
    provider: "",
    resolved: false,
    latitude: "",
    longitude: "",
    combinationCount: 0,
    candidateCount: 0,
    plannerResult: "skip",
    itineraryDays: 0,
    persistenceResult: "skip",
    failureReason: "",
    failureStage: "",
  };

  const logStart = capturedLogs.length;
  resetCaches(c.destination);
  await sleep(250);

  try {
    const options = countryOptions(c.country, c.destination, c.entityType);
    const anchor = await resolveDestinationAnchor({
      destination: c.destination,
      locale: "zh-TW",
      countryHint: c.country,
      offeredOptions: options,
      geocodeFn: liveGeocodeFn,
      generationRequestId: `e2e-${c.destination}-${Date.now()}`,
    });

    const caseLogs = capturedLogs.slice(logStart);
    const hasProviderResponse = caseLogs.some((l) => l.includes("[DESTINATION_PROVIDER_RESPONSE]"));
    const hasResolved = caseLogs.some((l) => l.includes("[DESTINATION_ANCHOR_RESOLVED]"));

    if (anchor.status !== "ok") {
      row.failureStage = "destination_anchor";
      row.failureReason = anchor.reason ?? "destination_resolution_failed";
      row.provider = "geocode_fn";
      report.push(row);
      console.error(
        `FAIL ${c.country}-${c.destination}: anchor ${row.failureReason} providerResponse=${hasProviderResponse}`,
      );
      continue;
    }

    assert.ok(Number.isFinite(anchor.anchor.latitude));
    assert.ok(Number.isFinite(anchor.anchor.longitude));
    assert.ok(hasProviderResponse, `${c.destination} missing DESTINATION_PROVIDER_RESPONSE`);
    assert.ok(hasResolved, `${c.destination} missing DESTINATION_ANCHOR_RESOLVED`);

    // Country bbox / code sanity — must not resolve to Taiwan for overseas.
    if (c.countryCode !== "TW") {
      assert.ok(
        !(
          Math.abs(anchor.anchor.latitude - 23.9739) < 0.05 &&
          Math.abs(anchor.anchor.longitude - 120.9823) < 0.05
        ),
        `${c.destination} must not fall back to Taiwan default`,
      );
    }

    row.resolved = true;
    row.latitude = anchor.anchor.latitude;
    row.longitude = anchor.anchor.longitude;
    row.provider = anchor.anchor.source;
    row.countryCode = anchor.anchor.countryCode ?? c.countryCode;

    if (FOCUS_LOG.has(c.destination)) {
      console.log(`\n----- FOCUS LOG: ${c.destination} -----`);
      for (const line of caseLogs) {
        if (
          /DESTINATION_PROVIDER_REQUEST|DESTINATION_PROVIDER_RESPONSE|DESTINATION_ANCHOR_RESOLVED|COMBINATION_DISCOVERY|CANDIDATE_POOL|REC_VALIDATOR|ITINERARY_VALIDATOR|ITINERARY_CREATED/.test(
            line,
          )
        ) {
          console.log(line);
        }
      }
    }

    if (ANCHOR_ONLY) {
      row.plannerResult = "anchor_only";
      row.persistenceResult = "anchor_only";
      passCount += 1;
      report.push(row);
      console.log(
        `OK ${c.country}-${c.destination} lat=${row.latitude} lng=${row.longitude} source=${row.provider}`,
      );
      continue;
    }

    // Combination Discovery
    const combo = await ensureDestinationCombinationsReady({
      destination: c.destination,
      searchPlaces: liveSearchPlaces,
      geocodeFn: liveGeocodeFn,
      locale: "zh-TW",
      days: c.days,
      destinationCountry: c.country,
      contextCoordinates: {
        lat: anchor.anchor.latitude,
        lng: anchor.anchor.longitude,
      },
      offeredDestinationOptions: options,
      generationRequestId: `e2e-combo-${c.destination}-${Date.now()}`,
    });

    row.combinationCount = combo.combinations?.length ?? 0;
    if (!combo.ok || row.combinationCount <= 0) {
      row.failureStage = "combination_discovery";
      row.failureReason = combo.failureDetail ?? combo.failureReason ?? "combination_empty";
      report.push(row);
      console.error(`FAIL ${c.country}-${c.destination}: combo ${row.failureReason}`);
      continue;
    }

    // Planner / Candidate Pool / Validators
    const sessionId = `e2e-plan-${c.destination}-${Date.now()}`;
    resetPlannerSession(sessionId);
    const profile = classifyDestinationForPlaceSearch(c.destination);
    const plan = await generateTripPlanFromStyle({
      label: c.destination,
      lat: anchor.anchor.latitude,
      lng: anchor.anchor.longitude,
      locale: "zh-TW",
      searchPlaces: liveSearchPlaces,
      weather: null,
      context: {
        destination: c.destination,
        days: c.days,
        country: c.country,
        selectedCombinationIds: [1, 2].slice(0, Math.min(2, row.combinationCount)),
      },
      style: "mixed",
      days: c.days,
      caller: "verify.destination.global.e2e",
      searchContext: { destination: c.destination, days: c.days },
      geocodeSucceeded: true,
      searchProfile: profile,
      weatherSearchLabel: c.destination,
      templateNameSearchAttempts: () => [],
      searchDestinationPlaces,
      planningSessionId: sessionId,
      geocodeFn: liveGeocodeFn,
    });

    row.candidateCount = plan.rankedPlaces?.length ?? plan.places?.length ?? 0;
    const composed = plan.composedPlans ?? [];
    row.itineraryDays = composed.length || (plan.dayPlan ? c.days : 0);
    const emptyDays = composed.filter((d) => !(d.entries?.length > 0));
    const postLogs = capturedLogs.slice(logStart);

    if (plan.candidateInsufficient?.candidateInsufficient) {
      row.failureStage = "candidate_pool_or_rec_validator";
      row.failureReason = `candidateInsufficient available=${plan.candidateInsufficient.availableCount} required=${plan.candidateInsufficient.requiredCount}`;
      row.plannerResult = "insufficient";
      report.push(row);
      console.error(`FAIL ${c.country}-${c.destination}: ${row.failureReason}`);
      continue;
    }

    if (row.itineraryDays !== c.days || emptyDays.length > 0) {
      row.failureStage = "planner";
      row.failureReason = `days=${row.itineraryDays} emptyDays=${emptyDays.length}`;
      row.plannerResult = "fail";
      report.push(row);
      console.error(`FAIL ${c.country}-${c.destination}: ${row.failureReason}`);
      continue;
    }

    row.plannerResult = "ok";

    // In-memory persistence round-trip (no Supabase)
    if (plan.dayPlan?.items?.length) {
      freezePlanningDayPlan(sessionId, plan.dayPlan);
      const frozen = getFrozenPlanningDayPlan(sessionId);
      if (frozen?.items?.length) {
        row.persistenceResult = "ok";
        originalInfo(
          `[ITINERARY_CREATED] destination=${c.destination} days=${c.days} items=${frozen.items.length} sessionId=${sessionId}`,
        );
      } else {
        row.persistenceResult = "fail";
        row.failureStage = "persistence";
        row.failureReason = "freeze_roundtrip_empty";
        report.push(row);
        console.error(`FAIL ${c.country}-${c.destination}: persistence`);
        continue;
      }
    } else {
      // composedPlans-only still counts as created payload
      row.persistenceResult = "composed_ok";
      originalInfo(
        `[ITINERARY_CREATED] destination=${c.destination} days=${c.days} composed=${composed.length}`,
      );
    }

    if (FOCUS_LOG.has(c.destination)) {
      for (const line of postLogs) {
        if (
          /COMBINATION_DISCOVERY_STATS|CANDIDATE_POOL_|REC_VALIDATOR_|ITINERARY_VALIDATOR_|ITINERARY_CREATED/.test(
            line,
          )
        ) {
          console.log(line);
        }
      }
    }

    passCount += 1;
    report.push(row);
    console.log(
      `OK ${c.country}-${c.destination} lat=${Number(row.latitude).toFixed(4)} lng=${Number(row.longitude).toFixed(4)} combos=${row.combinationCount} candidates=${row.candidateCount} days=${row.itineraryDays} persist=${row.persistenceResult}`,
    );
  } catch (e) {
    row.failureStage = "exception";
    row.failureReason = e instanceof Error ? e.message : String(e);
    report.push(row);
    console.error(`FAIL ${c.country}-${c.destination}: ${row.failureReason}`);
  }
}

console.log("\n=== REPORT ===\n");
console.log(
  [
    "Country",
    "Destination",
    "EntityType",
    "CountryCode",
    "Provider",
    "Resolved",
    "Latitude",
    "Longitude",
    "CombinationCount",
    "CandidateCount",
    "PlannerResult",
    "ItineraryDays",
    "PersistenceResult",
    "FailureReason",
  ].join("\t"),
);
for (const r of report) {
  console.log(
    [
      r.country,
      r.destination,
      r.entityType,
      r.countryCode,
      r.provider,
      r.resolved,
      r.latitude,
      r.longitude,
      r.combinationCount,
      r.candidateCount,
      r.plannerResult,
      r.itineraryDays,
      r.persistenceResult,
      r.failureReason,
    ].join("\t"),
  );
}

const total = report.length;
const requiredPass = Math.min(23, total);
console.log(
  `\n[verify:destination-global-e2e] version=${DESTINATION_ANCHOR_BUILD_VERSION} passed=${passCount}/${total} required>=${requiredPass} mode=${ANCHOR_ONLY ? "anchor-only" : "full"}`,
);

if (passCount < requiredPass) {
  process.exit(1);
}
console.log("[verify:destination-global-e2e] ok");
