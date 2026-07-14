/**
 * Full planner → validation → dayPlan → cards → summary pipeline.
 * Matrix: 台中 / 台南 / 東京 × 4 天 × 4 style options.
 */
import assert from "node:assert/strict";
import {
  buildComposedDayPlans,
  classifyPlanPlaceKind,
  composedPlansToAiDayPlan,
  dayPlanToRecommendations,
  ensureAllDayPlansExist,
  isItineraryRenderable,
  plannerTotalPlaces,
  preferBetterComposedPlans,
} from "../src/lib/ai/ai-day-plan-source.ts";
import {
  buildPlanningDaySummary,
  rankPlacesForTripPlanning,
} from "../src/lib/ai/destination-trip-planning.ts";
import {
  ensureRenderableStyleDayPlans,
  rebuildDayPlansFromCandidatePool,
} from "../src/lib/ai/planning-candidate-pool.ts";
import { minCandidatePoolSize, minRenderableItemsPerDay } from "../src/lib/ai/ai-multi-day-planner.ts";
import { dedupePlaceCardsForRender, resolveTripPlaceId } from "../src/lib/ai/ai-trip-place-allocator.ts";
import {
  entryLabelMatchesPlace,
  filterRealPlanningPlaces,
  isRealGooglePlanningPlace,
} from "../src/lib/ai/planning-real-place.ts";
import { validateItinerary } from "../src/lib/ai/ai-day-plan-slot-rules.ts";
import { normalizeGooglePlaces } from "../src/lib/ai/normalize-google-place.ts";
import {
  assertAllowedLabels,
  assertNoPlaceholderNames,
  buildRealCityPool,
  finishVerifyScript,
  INTEGRATION_CITIES,
  STYLE_OPTIONS,
} from "./lib/itinerary-verify-helpers.mjs";

const DAYS = 4;
let failures = 0;
const results = [];

function ok(message) {
  console.log(`OK ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function record(okResult, row) {
  results.push({ ok: okResult, ...row });
  if (!okResult) failures += 1;
}

function assertNoDuplicatePlaces(plans, label) {
  const seen = new Set();
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const key = resolveTripPlaceId(entry.place) || entry.name;
      assert.ok(!seen.has(key), `${label}: duplicate ${key} on day ${plan.day}`);
      seen.add(key);
    }
  }
}

function assertDayPlanCardsMatch(plans, dayPlan, label) {
  const cardNames = dayPlanToRecommendations(dayPlan).map((r) => r.name);
  const planNames = plans.flatMap((p) => p.entries.map((e) => e.name));
  assert.equal(cardNames.length, planNames.length, `${label}: card count mismatch`);
  assert.deepEqual([...cardNames].sort(), [...planNames].sort(), `${label}: card/plan names mismatch`);
}

function assertMealLabelsMatchTypes(plans, label) {
  for (const plan of plans) {
    for (const entry of plan.entries) {
      assert.ok(
        entryLabelMatchesPlace(entry.label, entry.place, entry.time),
        `${label}: ${entry.name} label=${entry.label} time=${entry.time} kind=${classifyPlanPlaceKind(entry.place)}`,
      );
      const kind = classifyPlanPlaceKind(entry.place);
      if (kind === "attraction" && ["早餐", "午餐", "晚餐"].includes(entry.label)) {
        assert.fail(`${label}: attraction ${entry.name} labeled as ${entry.label}`);
      }
    }
  }
}

console.log("=== verify-itinerary-integration ===\n");

assert.equal(minCandidatePoolSize(DAYS), 24);
console.log("OK pool gate constants\n");

for (const city of INTEGRATION_CITIES) {
  for (const { key: style, label: styleLabel, option } of STYLE_OPTIONS) {
    const testId = `${city.name} 4天 選項${option} ${styleLabel}`;
    try {
      const pool = normalizeGooglePlaces(buildRealCityPool(city, DAYS));
      assert.equal(filterRealPlanningPlaces(pool).length, pool.length, `${testId}: non-ChIJ in pool`);

      const ranked = rankPlacesForTripPlanning({
        places: pool,
        style,
        days: DAYS,
        context: { interests: [], destination: city.name, days: DAYS },
        weather: null,
        lat: city.lat,
        lng: city.lng,
        profile: null,
        label: city.name,
      });

      let normalized = ensureAllDayPlansExist(ranked.composedPlans, DAYS);

      if (!isItineraryRenderable(normalized, DAYS, style)) {
        const ensured = ensureRenderableStyleDayPlans({
          composedPlans: ranked.composedPlans,
          places: pool,
          style,
          label: city.name,
          days: DAYS,
          lat: city.lat,
          lng: city.lng,
        });

        const rebuilt = rebuildDayPlansFromCandidatePool({
          composedPlans: ranked.composedPlans,
          candidatePool: ensured.candidatePool,
          style,
          label: city.name,
          days: DAYS,
          lat: city.lat,
          lng: city.lng,
        });

        normalized = preferBetterComposedPlans(
          ensureAllDayPlansExist(rebuilt, DAYS),
          normalized,
          DAYS,
        );
      }
      const total = plannerTotalPlaces(normalized);
      const renderable = isItineraryRenderable(normalized, DAYS, style);
      const minPerDay = minRenderableItemsPerDay(DAYS);

      assert.equal(normalized.length, DAYS, `${testId}: day count`);
      assert.ok(total > 0, `${testId}: totalPlaces=0`);
      assert.notEqual(total, 0, `${testId}: dayPlan would be empty`);
      assert.equal(renderable, true, `${testId}: itinerary_plan_incomplete / not renderable`);

      for (const plan of normalized) {
        assert.ok(plan.entries.length >= minPerDay, `${testId}: day ${plan.day} has ${plan.entries.length} < ${minPerDay}`);
      }

      const allEntries = normalized.flatMap((p) => p.entries);
      for (const entry of allEntries) {
        assert.equal(isRealGooglePlanningPlace(entry.place), true, `${testId}: fake place ${entry.name}`);
      }

      assertNoDuplicatePlaces(normalized, testId);
      assertNoPlaceholderNames(allEntries, testId);
      assertAllowedLabels(allEntries, testId);
      assertMealLabelsMatchTypes(normalized, testId);

      const itineraryValidation = validateItinerary(
        normalized,
        classifyPlanPlaceKind,
        style,
        undefined,
        DAYS,
      );
      assert.equal(itineraryValidation.ok, true, `${testId}: slot validation ${itineraryValidation.issues?.join(";")}`);

      const dayPlan = composedPlansToAiDayPlan({
        composedPlans: normalized,
        destination: city.name,
        days: DAYS,
        planningSessionId: "verify-integration",
      });
      assert.ok(dayPlan.items.length > 0, `${testId}: dayPlan=0`);

      assertDayPlanCardsMatch(normalized, dayPlan, testId);
      const cards = dedupePlaceCardsForRender(dayPlanToRecommendations(dayPlan));
      assert.equal(cards.length, dayPlan.items.length, `${testId}: duplicate cards`);

      const summary = buildPlanningDaySummary(city.name, DAYS, style, [], normalized);
      assert.ok(!/行程生成中|行程還在整理中|暫時沒連上/.test(summary), `${testId}: blocked/partial summary`);
      for (const entry of allEntries) {
        assert.ok(summary.includes(entry.name), `${testId}: summary missing ${entry.name}`);
      }

      const dayCounts = normalized.map((p) => p.entries.length).join("/");
      record(true, { city: city.name, style: styleLabel, option, dayCounts, total });
      ok(`${testId} places=${total} days=${dayCounts}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record(false, { city: city.name, style: styleLabel, option, error: message });
      fail(`${testId}: ${message}`);
    }
  }
}

console.log("\n=== Summary ===");
console.log(`Total: ${results.length}, Passed: ${results.filter((r) => r.ok).length}, Failed: ${failures}`);
for (const row of results) {
  if (row.ok) {
    console.log(`  ✓ ${row.city} 選項${row.option} ${row.style} → ${row.dayCounts} (${row.total} places)`);
  } else {
    console.log(`  ✗ ${row.city} 選項${row.option} ${row.style} → ${row.error}`);
  }
}

finishVerifyScript(failures, "verify-itinerary-integration");
