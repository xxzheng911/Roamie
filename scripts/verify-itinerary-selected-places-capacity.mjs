/**
 * generate-itinerary selectedPlaces schema capacity vs long-trip oversample.
 * Guards 18–30 day resolvedTarget payloads from Zod too_big → generation_unavailable.
 */
import assert from "node:assert/strict";
import {
  MAX_ITINERARY_DAYS,
  MAX_ITINERARY_SELECTED_PLACES,
  MIN_ITINERARY_DAYS,
  isItineraryDurationValidationError,
} from "../src/lib/ai/itinerary-days.ts";
import { InputSchema } from "../src/lib/itinerary.functions.ts";
import { computeItineraryResolvedTarget } from "../src/lib/ai/place-map-queue.ts";
import { generateItineraryViaNativeApi } from "../src/lib/ai/itinerary-transport.ts";
import {
  ITINERARY_GENERATION_FAILED_MESSAGE,
  classifyItineraryGenerationFailure,
} from "../src/lib/trip/itinerary-guards.ts";

const tokyoPlace = (index) => ({
  name: `東京景點${index}`,
  placeName: `東京景點${index}`,
  googlePlaceId: `ChIJSelectedCap${String(index).padStart(3, "0")}P25`,
  address: "東京都",
  lat: 35.68 + index * 0.0001,
  lng: 139.76 + index * 0.0001,
  type: "景點",
});

function places(count) {
  return Array.from({ length: count }, (_, i) => tokyoPlace(i + 1));
}

function parseSelectedPlaces(count, days = MAX_ITINERARY_DAYS) {
  return InputSchema.safeParse({
    destination: "東京",
    days,
    selectedPlaces: places(count),
  });
}

function selectedPlacesTooBig(parsed) {
  if (parsed.success) return false;
  return parsed.error.issues.some((issue) => {
    const path = Array.isArray(issue.path) ? issue.path : [];
    return path[0] === "selectedPlaces" && issue.code === "too_big";
  });
}

let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("=== itinerary selectedPlaces schema capacity ===\n");

await check("authority MAX_ITINERARY_SELECTED_PLACES = MAX_ITINERARY_DAYS × 4", () => {
  assert.equal(MAX_ITINERARY_DAYS, 30);
  assert.equal(MAX_ITINERARY_SELECTED_PLACES, MAX_ITINERARY_DAYS * 4);
  assert.equal(MAX_ITINERARY_SELECTED_PLACES, 120);
});

const parseCases = [
  [64, true],
  [68, true],
  [70, true],
  [71, true],
  [72, true],
  [80, true],
  [96, true],
  [120, true],
  [121, false],
];

for (const [count, expectPass] of parseCases) {
  await check(`selectedPlaces length ${count} → ${expectPass ? "PASS" : "REJECT"}`, () => {
    const parsed = parseSelectedPlaces(count);
    assert.equal(
      parsed.success,
      expectPass,
      parsed.success
        ? `unexpected pass at ${count}`
        : JSON.stringify(parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code }))),
    );
    if (!expectPass) {
      assert.equal(selectedPlacesTooBig(parsed), true, "121 must be selectedPlaces too_big");
    } else {
      assert.equal(selectedPlacesTooBig(parsed), false);
      assert.equal(parsed.data.selectedPlaces.length, count);
    }
  });
}

const resolvedDays = [16, 17, 18, 20, 24, 30];
const expectedResolved = { 16: 64, 17: 68, 18: 72, 20: 80, 24: 96, 30: 120 };

for (const days of resolvedDays) {
  await check(`${days}-day resolvedTarget=${expectedResolved[days]} InputSchema PASS`, () => {
    const resolved = computeItineraryResolvedTarget(days);
    assert.equal(resolved, expectedResolved[days]);
    const parsed = parseSelectedPlaces(resolved, days);
    assert.equal(
      parsed.success,
      true,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    );
    assert.equal(selectedPlacesTooBig(parsed), false);
  });
}

await check("18–30 day resolvedTarget is never selectedPlaces too_big", () => {
  for (let days = 18; days <= MAX_ITINERARY_DAYS; days += 1) {
    const resolved = computeItineraryResolvedTarget(days);
    const parsed = parseSelectedPlaces(resolved, days);
    assert.equal(
      parsed.success,
      true,
      `${days}d resolvedTarget=${resolved} rejected: ${
        parsed.success ? "" : JSON.stringify(parsed.error.issues)
      }`,
    );
    assert.equal(
      selectedPlacesTooBig(parsed),
      false,
      `${days}d resolvedTarget=${resolved} still classified as selectedPlaces too_big`,
    );
  }
});

await check("1–MAX_ITINERARY_DAYS resolvedTarget <= MAX_ITINERARY_SELECTED_PLACES", () => {
  for (let days = MIN_ITINERARY_DAYS; days <= MAX_ITINERARY_DAYS; days += 1) {
    const resolved = computeItineraryResolvedTarget(days);
    assert.ok(
      resolved <= MAX_ITINERARY_SELECTED_PLACES,
      `days=${days} resolvedTarget=${resolved} exceeds schema max ${MAX_ITINERARY_SELECTED_PLACES}`,
    );
  }
});

await check("native transport does not truncate 72 selectedPlaces", async () => {
  let sentCount = -1;
  const payload = places(72);
  const result = await generateItineraryViaNativeApi(
    {
      destination: "東京",
      days: 18,
      generationId: "selected-places-cap-72",
      selectedPlaces: payload,
    },
    {
      token: "test-token",
      origin: "https://roamie.example",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        sentCount = Array.isArray(body.selectedPlaces) ? body.selectedPlaces.length : -1;
        assert.equal(sentCount, 72);
        assert.equal(body.days, 18);
        return new Response(
          JSON.stringify({ success: true, trip: { destination: "東京", days: 18 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );
  assert.equal(sentCount, 72);
  assert.equal(result.success, true);
  assert.notEqual(result.errorCode, "generation_unavailable");
});

await check("121 selectedPlaces too_big remains explicit reject (not duration)", () => {
  const parsed = parseSelectedPlaces(121, 30);
  assert.equal(parsed.success, false);
  assert.equal(selectedPlacesTooBig(parsed), true);
  assert.equal(isItineraryDurationValidationError(parsed.error), false);
});

await check("generation_unavailable still maps to generic copy (error architecture unchanged)", () => {
  assert.equal(
    classifyItineraryGenerationFailure({ errorCode: "generation_unavailable" }).userMessage,
    ITINERARY_GENERATION_FAILED_MESSAGE,
  );
});

if (failed) {
  console.error(`\nselectedPlaces schema capacity: FAIL (${failed})`);
  process.exit(1);
}
console.log("\nselectedPlaces schema capacity: PASS");
