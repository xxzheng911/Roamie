import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";
import {
  describeItineraryClientPayloadShape,
  normalizeGenerateItineraryResult,
  unwrapGeneratedTripPayload,
  validateCompleteItineraryPayload,
} from "../src/lib/trip/itinerary-guards.ts";

const recommendation = (id, name, address) => ({
  name,
  placeName: name,
  googlePlaceId: id,
  address,
  lat: 25.04,
  lng: 121.53,
  type: "tourist_attraction",
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
  description: "",
  reason: "",
  estimatedTime: "1 小時",
  googleMapsUrl: "",
  reasonSource: "template",
});
const required = [
  recommendation("ChIJP34Required0", "龍山寺", "台北市萬華區廣州街"),
  recommendation("ChIJP34Required1", "饒河街觀光夜市", "台北市松山區饒河街"),
  recommendation("ChIJP34Required2", "台北當代藝術館", "台北市大同區長安西路"),
];
const supplemental = [
  recommendation("ChIJP34Supplement0", "國立臺灣博物館", "台北市中正區襄陽路"),
  recommendation("ChIJP34Supplement1", "二二八和平公園", "台北市中正區凱達格蘭大道"),
  recommendation("ChIJP34Supplement2", "松山文創園區", "台北市信義區光復南路"),
  recommendation("ChIJP34Supplement3", "華山文化園區", "台北市中正區八德路"),
];
const itinerary = buildFallbackItineraryFromPlaces(
  [...required, ...supplemental],
  2,
  "2026-09-07",
  "台北",
);
// Production P33 emits a compact 3/4 plan; extend the formal builder output
// with one more stop using the exact same emitted stop contract.
itinerary.push({
  ...itinerary[itinerary.length - 1],
  googlePlaceId: supplemental[3].googlePlaceId,
  placeName: supplemental[3].placeName,
  title: supplemental[3].placeName,
  address: supplemental[3].address,
  date: "2026-09-08",
  dayIndex: 1,
  time: "18:00",
});
const payload = {
  version: 2,
  title: "台北 2 天",
  summary: "production builder fixture",
  moodTag: "",
  recommendations: [...required, ...supplemental],
  destination: "台北",
  days: 2,
  itinerary,
};
const response = {
  success: true,
  trip: {
    id: "trip-p34",
    title: payload.title,
    destination: "台北",
    days: 2,
    itinerary: [],
    payload,
  },
};

const normalizedResult = normalizeGenerateItineraryResult(response);
const unwrapped = unwrapGeneratedTripPayload(normalizedResult);
assert(unwrapped);
const shape = describeItineraryClientPayloadShape(unwrapped, 2, "2026-09-07", "2026-09-08");
assert.equal(shape.dayContainerShape, "flat_stops");
assert.equal(shape.itineraryArrayLength, itinerary.length);
assert.deepEqual(shape.perDayEntryCounts, [3, 4]);

const validation = validateCompleteItineraryPayload(unwrapped, 2, "2026-09-07");
assert.equal(validation.valid, true);
assert.deepEqual(validation.missingFieldCodes, []);
assert.deepEqual(validation.perDayEntryCounts, [3, 4]);
const ids = new Set(validation.normalizedPayload.itinerary.map((stop) => stop.googlePlaceId));
assert.equal(required.filter((place) => ids.has(place.googlePlaceId)).length, 3);
assert.equal(ids.has("ChIJExcluded101"), false);

const p33TransportPayload = structuredClone(payload);
p33TransportPayload.itinerary = p33TransportPayload.itinerary.map((stop, index) => ({
  ...stop,
  googlePlaceId:
    index === 0
      ? `saved:${stop.googlePlaceId}`
      : index === 1
        ? `google:${stop.googlePlaceId}`
        : index === 2
          ? `canonical:${stop.googlePlaceId}`
          : stop.googlePlaceId,
  lat: index === 3 ? String(stop.lat) : stop.lat,
  lng: index === 3 ? String(stop.lng) : stop.lng,
  types: index === 4 ? stop.placeType : stop.types,
  localizedDisplayName: index === 5 ? stop.placeName : stop.localizedDisplayName,
}));
const p33Normalized = validateCompleteItineraryPayload(p33TransportPayload, 2, "2026-09-07");
assert.equal(p33Normalized.valid, true);
assert.deepEqual(p33Normalized.perDayEntryCounts, [3, 4]);
assert(p33Normalized.normalizedPayload.itinerary.every((stop) => /^(?!saved:|google:|canonical:)/.test(stop.googlePlaceId)));

const invalidIdentity = structuredClone(payload);
invalidIdentity.itinerary[0].googlePlaceId = "synthetic:not-google";
const invalidIdentityResult = validateCompleteItineraryPayload(invalidIdentity, 2, "2026-09-07");
assert.equal(invalidIdentityResult.valid, false);
assert(invalidIdentityResult.missingFieldCodes.includes("itinerary.entry.non_google_identity"));

assert.deepEqual(
  validateCompleteItineraryPayload({ ...payload, itinerary: {} }, 2, "2026-09-07").missingFieldCodes,
  ["itinerary.not_array"],
);
const malformed = structuredClone(payload);
delete malformed.itinerary[0].googlePlaceId;
malformed.itinerary[0].lat = null;
malformed.itinerary[0].lng = null;
assert.equal(validateCompleteItineraryPayload(malformed, 2, "2026-09-07").valid, false);

const legacy = unwrapGeneratedTripPayload(payload);
assert(legacy);
assert.equal(validateCompleteItineraryPayload(legacy, 2, "2026-09-07").valid, true);

const stateMachineSource = readFileSync(
  new URL("../src/lib/ai/ai-itinerary-state-machine.ts", import.meta.url),
  "utf8",
);
assert.match(stateMachineSource, /"itinerary_payload_invalid"/);
assert.doesNotMatch(
  stateMachineSource.slice(stateMachineSource.indexOf("const reason = !payload"), stateMachineSource.indexOf("logItineraryFailureChain", stateMachineSource.indexOf("const reason = !payload"))),
  /insufficient_real_places/,
);

console.log("verify-p34-client-payload-normalization: ok");
