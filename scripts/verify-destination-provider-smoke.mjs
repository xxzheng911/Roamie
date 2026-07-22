/**
 * Low-cost live smoke for Destination Provider (Kumamoto + 1 control city).
 * Cap: Geocode 1–2 queries per destination; Autocomplete only if Geocode fails.
 *
 * Run: npm run verify:destination-provider-smoke
 * Requires GOOGLE_MAPS_API_KEY (or EXPO_PUBLIC / VITE variant).
 */
import assert from "node:assert/strict";
import { geocodeForwardUrl, placesAutocompleteUrl, placeDetailsUrl } from "../src/lib/google-maps-api.ts";
import { buildDestinationGeocodeQueries } from "../src/lib/ai/destination-geocode.ts";
import { extractCoordinatesFromProviderResponse } from "../src/lib/ai/destination-provider-coords.ts";
import {
  isValidAnchorCoordinate,
  normalizeDestinationProviderResult,
} from "../src/lib/ai/destination-provider-result.ts";
import { resolveServerEnv } from "../src/lib/load-env.server.ts";

function readKey() {
  for (const name of [
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
    "GOOGLE_MAPS_API_KEY",
    "VITE_GOOGLE_MAPS_API_KEY",
  ]) {
    const v = resolveServerEnv(name)?.value?.trim();
    if (v) return v;
  }
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

const apiKey = readKey();
if (!apiKey) {
  console.error("SKIP: no Google Maps API key in env");
  process.exit(0);
}

async function geocodeOnce(query) {
  const url = geocodeForwardUrl(query, apiKey, { language: "en", region: "jp" });
  const res = await fetch(url);
  const json = await res.json();
  const extracted = extractCoordinatesFromProviderResponse(json);
  const normalized = normalizeDestinationProviderResult(json, {
    provider: "geocode",
    query,
    httpStatus: res.status,
    apiStatus: json.status,
  });
  return { res, json, extracted, normalized };
}

async function autocompleteThenDetails(query) {
  const autoRes = await fetch(placesAutocompleteUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.types",
    },
    body: JSON.stringify({
      input: query,
      languageCode: "en",
      includedRegionCodes: ["JP"],
    }),
  });
  const autoJson = await autoRes.json();
  const placeId = autoJson.suggestions?.[0]?.placePrediction?.placeId;
  if (!placeId) {
    return { ok: false, reason: "places_autocomplete_empty", autoStatus: autoRes.status };
  }
  const detailRes = await fetch(placeDetailsUrl(placeId, "en"), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents,types",
    },
  });
  const detailJson = await detailRes.json();
  const normalized = normalizeDestinationProviderResult(detailJson, {
    provider: "places_details",
    query,
    httpStatus: detailRes.status,
  });
  return { ok: normalized.ok, normalized, placeId };
}

async function resolveDestinationSmoke(destination) {
  const plan = buildDestinationGeocodeQueries(destination, "zh-TW", "日本").slice(0, 1);
  console.info("[SMOKE_GEOCODE_PLAN]", destination, plan.join(" | "));
  for (const query of plan) {
    const { json, normalized } = await geocodeOnce(query);
    console.info(
      "[SMOKE_GEOCODE]",
      `destination=${destination}`,
      `query=${query}`,
      `apiStatus=${json.status}`,
      `ok=${normalized.ok}`,
      `lat=${normalized.latitude ?? ""}`,
      `lng=${normalized.longitude ?? ""}`,
    );
    if (normalized.ok && isValidAnchorCoordinate(normalized.latitude, normalized.longitude)) {
      return { source: "geocode", normalized, query };
    }
  }
  const autoQuery =
    destination === "熊本"
      ? "Kumamoto, Japan"
      : destination === "奈良"
        ? "Nara, Japan"
        : `${destination} Japan`;
  const auto = await autocompleteThenDetails(autoQuery);
  console.info(
    "[SMOKE_AUTOCOMPLETE]",
    `destination=${destination}`,
    `query=${autoQuery}`,
    `ok=${auto.ok}`,
    `lat=${auto.normalized?.latitude ?? ""}`,
    `lng=${auto.normalized?.longitude ?? ""}`,
  );
  if (auto.ok) return { source: "places_autocomplete", normalized: auto.normalized, query: autoQuery };
  return { source: "failed", normalized: null, query: plan[0] };
}

console.log("=== verify-destination-provider-smoke ===\n");

const targets = ["熊本", "奈良"];
let failed = 0;
for (const dest of targets) {
  try {
    const result = await resolveDestinationSmoke(dest);
    assert.ok(result.normalized?.ok, `${dest} failed to resolve`);
    assert.ok(
      isValidAnchorCoordinate(result.normalized.latitude, result.normalized.longitude),
      `${dest} invalid coords`,
    );
    console.log(
      `OK ${dest} source=${result.source} lat=${result.normalized.latitude} lng=${result.normalized.longitude}`,
    );
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${dest}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n[verify:destination-provider-smoke] ${failed === 0 ? "PASS" : "FAIL"} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
