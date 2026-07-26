import assert from "node:assert/strict";
import {
  isNearbyRecoverySignal,
  recoverNearbyExtensionCandidates,
} from "../src/lib/ai/nearby-extension-recovery.ts";
import { resolveRegionCandidate } from "../src/lib/ai/region-candidate-expand.ts";
import {
  activatePlacesRateProtection,
  clearPlacesRateProtection,
} from "../src/lib/ai/places-cost-cache/rate-protection.ts";

const place = (id, overrides = {}) => ({
  name: `Place ${id}`,
  placeName: `Place ${id}`,
  address: "Yokohama",
  googlePlaceId: id,
  placeId: id,
  lat: 35.45,
  lng: 139.64,
  businessStatus: "OPERATIONAL",
  destinationScope: "nearby_extension",
  extensionDestination: "橫濱",
  sourceRegionCandidate: "橫濱",
  type: "tourist_attraction",
  types: ["tourist_attraction"],
  ...overrides,
});

assert.equal(isNearbyRecoverySignal("global_rate_protection"), true);
assert.equal(isNearbyRecoverySignal("request_cooldown"), true);
assert.equal(isNearbyRecoverySignal("query_cooldown"), true);
assert.equal(isNearbyRecoverySignal("genuine_empty_result"), false);
assert.equal(isNearbyRecoverySignal("provider_failure"), false);

const recovered = recoverNearbyExtensionCandidates({
  extension: "橫濱",
  sources: [
    { name: "session", places: [place("ChIJ000000000001"), place("ChIJ000000000002")] },
    { name: "cache", places: [place("ChIJ000000000001"), place("ChIJ000000000003")] },
  ],
});
assert.equal(recovered.matchedBeforeDedupe, 4);
assert.deepEqual(
  recovered.candidates.map((candidate) => candidate.place.googlePlaceId),
  ["ChIJ000000000001", "ChIJ000000000002", "ChIJ000000000003"],
);
assert.ok(recovered.candidates.every((candidate) => candidate.evidence === "provenance"));

const isolated = recoverNearbyExtensionCandidates({
  extension: "橫濱",
  sources: [
    {
      name: "mixed",
      places: [
        place("ChIJ000000000004", {
          name: "Tokyo place near Yokohama",
          address: "橫濱 nearby wording",
          destinationScope: "primary",
          extensionDestination: undefined,
          sourceRegionCandidate: undefined,
        }),
        place("ChIJ000000000005", {
          destinationScope: undefined,
          extensionDestination: undefined,
          sourceRegionCandidate: undefined,
          address: "橫濱市中區",
        }),
      ],
    },
  ],
});
assert.equal(isolated.candidates.length, 1);
assert.equal(isolated.candidates[0].evidence, "text_fallback");
assert.equal(isolated.candidates[0].place.destinationScope, "nearby_extension");

const invalid = recoverNearbyExtensionCandidates({
  extension: "橫濱",
  sources: [
    { name: "invalid", places: [place("synthetic:1"), place("ChIJ000000000006", { lat: null })] },
  ],
});
assert.equal(invalid.candidates.length, 0);
assert.equal(invalid.rejected.length, 2);

const multiIds = [
  ["ChIJMultiYokohamaOne", "ChIJMultiYokohamaTwo"],
  ["ChIJMultiKawasakiOne", "ChIJMultiKawasakiTwo"],
];
const multiple = ["橫濱", "川崎"].map((extension, index) =>
  recoverNearbyExtensionCandidates({
    extension,
    sources: [
      {
        name: "cache",
        places: [
          place(multiIds[index][0], {
            extensionDestination: extension,
            sourceRegionCandidate: extension,
          }),
          place(multiIds[index][1], {
            extensionDestination: extension,
            sourceRegionCandidate: extension,
          }),
        ],
      },
    ],
  }),
);
assert.deepEqual(
  multiple.map((result) => result.candidates.length),
  [2, 2],
);

let providerCalls = 0;
activatePlacesRateProtection({ reason: "verification", ttlMs: 60_000 });
const suppressed = await resolveRegionCandidate({
  regionName: "橫濱",
  combinationId: 0,
  destination: "橫濱",
  lat: 35.45,
  lng: 139.64,
  locale: "zh-TW",
  searchPlaces: async () => {
    providerCalls += 1;
    return { places: [] };
  },
});
clearPlacesRateProtection();
assert.equal(providerCalls, 0);
assert.equal(suppressed.telemetry.fetchSignal, "global_rate_protection");

console.log("verify-nearby-extension-recovery: OK");
