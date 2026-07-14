/**
 * Live Google Places API pipeline diagnostic.
 * Requires GOOGLE_MAPS_SERVER_KEY in environment.
 *
 * Usage:
 *   node scripts/verify-itinerary-live-api.mjs [city] [style] [days]
 *   node scripts/verify-itinerary-live-api.mjs --all
 * Example: node scripts/verify-itinerary-live-api.mjs 台中 local_life 4
 */
import assert from "node:assert/strict";
import {
  INTEGRATION_CITIES,
  STYLE_OPTIONS,
  finishVerifyScript,
} from "./lib/itinerary-verify-helpers.mjs";
import { normalizeGooglePlaces } from "../src/lib/ai/normalize-google-place.ts";
import { normalizePlanningPlaces } from "../src/lib/ai/normalize-planning-places.ts";
import {
  computeSlotDeficitFromPools,
  filterRealPlanningPlacesWithDiagnostics,
  logItineraryPipelineSummary,
  logItinerarySlotDeficit,
  logPlaceNormalizeDropSummary,
} from "../src/lib/ai/itinerary-postprocess-diagnostics.ts";
import { buildLocalLifeCandidatePools } from "../src/lib/ai/ai-local-life-rules.ts";
import {
  buildComposedDayPlans,
  expectedItineraryItemCount,
  isExactSlotDayPlans,
  isItineraryRenderable,
  plannerTotalPlaces,
} from "../src/lib/ai/ai-day-plan-source.ts";
import { PLACES_FIELD_MASK, placesSearchTextUrl } from "../src/lib/google-maps-api.ts";

const runAll = process.argv[2] === "--all";
const cityName = runAll ? undefined : (process.argv[2] ?? "台中");
const styleKey = runAll ? undefined : (process.argv[3] ?? "local_life");
const daysArg = runAll ? 4 : Number(process.argv[4] ?? 4);

function buildQueries(city) {
  return {
    breakfast: [`${city.name} 早餐 餐廳`, `${city.name} breakfast restaurant`],
    attraction: [`${city.name} 景點`, `${city.name} tourist attraction`],
    lunch: [`${city.name} 午餐 餐廳`, `${city.name} local restaurant`],
    cafe: [`${city.name} 咖啡廳`, `${city.name} cafe`],
    dinner: [`${city.name} 晚餐 餐廳`, `${city.name} dinner restaurant`],
    evening: [`${city.name} 酒吧`, `${city.name} night market`],
  };
}

async function textSearch(apiKey, city, query) {
  const res = await fetch(placesSearchTextUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
      "Accept-Language": "zh-TW",
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 10,
      locationBias: {
        circle: {
          center: { latitude: city.lat, longitude: city.lng },
          radius: 15_000,
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places text search failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.places ?? [];
}

async function runCase(apiKey, city, styleOpt, days) {
  console.log(`\n=== Live API pipeline: ${city.name} ${days}天 ${styleOpt.label} ===`);

  const queries = buildQueries(city);
  let searchRaw = [];
  for (const [pool, queriesList] of Object.entries(queries)) {
    for (const query of queriesList) {
      const batch = await textSearch(apiKey, city, query);
      console.log(`Search [${pool}] "${query}" → ${batch.length}`);
      searchRaw = searchRaw.concat(batch);
    }
  }

  const searchCount = searchRaw.length;
  const normalized = normalizeGooglePlaces(searchRaw);
  const planningNormalized = normalizePlanningPlaces(normalized, { logSummary: true });
  const { places: realPlaces, counters } = filterRealPlanningPlacesWithDiagnostics(planningNormalized, {
    stage: "live_api_real",
  });

  logPlaceNormalizeDropSummary({
    input: searchCount,
    output: realPlaces.length,
    realFilterCounters: counters,
    unsupportedPayload: Math.max(0, searchCount - planningNormalized.length),
  });

  const pools = buildLocalLifeCandidatePools(realPlaces);
  const poolCounts = {
    breakfast: pools.breakfastPool.length,
    attraction: pools.attractionPool.length,
    lunch: pools.lunchPool.length,
    cafe: pools.cafePool.length,
    dinner: pools.dinnerPool.length,
    evening: pools.eveningPool.length,
    total: pools.all.length,
  };
  logItinerarySlotDeficit(computeSlotDeficitFromPools(days, poolCounts));

  const composed = buildComposedDayPlans({
    places: realPlaces,
    days,
    style: styleOpt.key,
    destination: city.name,
    lat: city.lat,
    lng: city.lng,
    plannedDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  });

  const itemCount = plannerTotalPlaces(composed);
  const renderable = isItineraryRenderable(composed, days, styleOpt.key);
  const expectedItems = expectedItineraryItemCount(days);
  const dayCounts = Object.fromEntries(composed.map((p) => [p.day, p.entries.length]));

  logItineraryPipelineSummary({
    searchCount,
    normalizedCount: planningNormalized.length,
    detailsEnrichedCount: normalized.length,
    postprocessCount: realPlaces.length,
    poolCounts,
    plannerItemCount: itemCount,
    validationOk: renderable,
    renderedCardsCount: renderable ? itemCount : 0,
  });

  console.log(`dayCounts=${Object.values(dayCounts).join("/")} expected=${expectedItems}`);

  assert.ok(realPlaces.length > 0, `${city.name}/${styleOpt.key}: postprocess cleared all places`);
  assert.equal(itemCount, expectedItems, `${city.name}/${styleOpt.key}: plannerItems=${itemCount} expected=${expectedItems}`);
  assert.equal(renderable, true, `${city.name}/${styleOpt.key}: validation failed`);
  assert.equal(isExactSlotDayPlans(composed, days), true, `${city.name}/${styleOpt.key}: not 7/7/7/7 slots`);

  console.log(`OK ${city.name} ${styleOpt.label} items=${itemCount} renderable=${renderable}`);
  return { city: city.name, style: styleOpt.key, itemCount, renderable };
}

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("SKIP live API test: GOOGLE_MAPS_SERVER_KEY not set");
    process.exit(0);
  }

  const cases = runAll
    ? ["台東", "花蓮", "台中", "東京"].flatMap((cityName) => {
        const city = INTEGRATION_CITIES.find((c) => c.name === cityName);
        if (!city) return [];
        return STYLE_OPTIONS.map((style) => ({ city, style, days: daysArg }));
      })
    : [
        {
          city: INTEGRATION_CITIES.find((c) => c.name === cityName) ?? INTEGRATION_CITIES[0],
          style: STYLE_OPTIONS.find((s) => s.key === styleKey) ?? STYLE_OPTIONS[1],
          days: daysArg,
        },
      ];

  const results = [];
  for (const { city, style, days } of cases) {
    try {
      results.push(await runCase(apiKey, city, style, days));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${city.name}/${style.key}: ${message}`);
      results.push({
        city: city.name,
        style: style.key,
        itemCount: 0,
        renderable: false,
        error: message,
      });
    }
  }

  const passed = results.filter(
    (r) => r.renderable && r.itemCount === expectedItineraryItemCount(daysArg),
  );
  const failed = results.filter(
    (r) => !r.renderable || r.itemCount !== expectedItineraryItemCount(daysArg),
  );

  console.log(`\nSummary: ${passed.length}/${results.length} passed (28 items, renderable)`);
  for (const row of results) {
    const mark = row.renderable && row.itemCount === expectedItineraryItemCount(daysArg) ? "OK" : "FAIL";
    console.log(`${mark} ${row.city}/${row.style} items=${row.itemCount} renderable=${row.renderable}`);
  }

  if (failed.length) {
    console.error(`\nFAIL ${failed.length}/${results.length} cases did not meet 7-slot requirements`);
    process.exit(1);
  }

  console.log(`\nOK Live API pipeline passed ${results.length} case(s)`);
  finishVerifyScript(0, "verify-itinerary-live-api");
}

main().catch((err) => {
  console.error("FAIL", err.message ?? err);
  process.exit(1);
});
