import assert from "node:assert/strict";
import {
  itineraryIdentityCounts,
  recoverItineraryGoogleIdentities,
} from "../src/lib/ai/itinerary-google-identity.ts";
import { validateCompleteItineraryPayload } from "../src/lib/trip/itinerary-guards.ts";
import { normalizeStoredItinerary } from "../src/lib/itinerary-storage.ts";
import { tripDetailNavigateOptions } from "../src/lib/trip/trip-detail-nav.ts";
import { applyComposedPlansToItineraryItems } from "../src/lib/ai/itinerary-validator/from-payload.ts";
import { inspectItineraryIdentityLookup } from "../src/lib/ai/itinerary-google-identity.ts";

const candidate = (index, required = false) => ({
  name: `P35 place ${index}`,
  placeName: `P35 place ${index}`,
  googlePlaceId: `ChIJP35Identity${index}`,
  address: `Taipei address ${index}`,
  lat: 25.04 + index / 1000,
  lng: 121.53 + index / 1000,
  type: "tourist_attraction",
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
  description: "",
  reason: "",
  estimatedTime: "1 hour",
  googleMapsUrl: "",
  reasonSource: "template",
  isRequiredBySelection: required,
});
const candidates = Array.from({ length: 7 }, (_, index) => candidate(index, index < 3));
const stops = candidates.map((place, index) => ({
  date: index < 3 ? "2026-09-07" : "2026-09-08",
  dayIndex: index < 3 ? 0 : 1,
  time: `${String(9 + (index % 4) * 2).padStart(2, "0")}:00`,
  title: place.name,
  placeName: place.name,
  description: "",
  address: place.address,
  lat: place.lat,
  lng: place.lng,
  googlePlaceId: [2, 3, 6].includes(index) ? `canonical:internal-${index}` : place.googlePlaceId,
  placeType: place.type,
  types: place.types,
}));

const before = itineraryIdentityCounts(stops, candidates);
assert.equal(before.googleIdentityCount, 4);
assert.equal(before.internalOnlyIdentityCount, 3);
assert.equal(before.lostGoogleIdCount, 3);

// P36 Case A: initial AI shape omits every Google ID and slightly rounds coordinates.
const initialFive = stops.slice(0, 5).map((stop, index) => ({
  ...stop,
  googlePlaceId: undefined,
  title: index === 0 ? stop.title.replace("P35", "Ｐ３５") : stop.title,
  address: undefined,
  lat: stop.lat + 0.00008,
  lng: stop.lng - 0.00008,
}));
const normalizedInitial = recoverItineraryGoogleIdentities({ stops: initialFive, candidates });
assert.equal(normalizedInitial.restoredFromCandidatePoolCount, 5);
assert.equal(normalizedInitial.unrecoverableCount, 0);
assert.equal(itineraryIdentityCounts(normalizedInitial.items, candidates).googleIdentityCount, 5);

// P36 Case B: required repair carries Google identity independently from planner id.
const requiredRepair = applyComposedPlansToItineraryItems([], [{
  day: 1,
  entries: [{
    time: "10:00",
    label: "景點",
    name: candidates[0].name,
    place: {
      id: "canonical:required-repair-0",
      googlePlaceId: candidates[0].googlePlaceId,
      plannerProvenanceKey: `google:${candidates[0].googlePlaceId}`,
      sourceCandidateIndex: 0,
      name: candidates[0].name,
      address: candidates[0].address,
      lat: candidates[0].lat,
      lng: candidates[0].lng,
      rating: null,
      userRatingCount: null,
      photoName: null,
      primaryType: candidates[0].type,
      businessStatus: null,
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
    },
  }],
}], "2026-09-07");
assert.equal(requiredRepair[0].googlePlaceId, candidates[0].googlePlaceId);

const recovered = recoverItineraryGoogleIdentities({
  stops,
  candidates,
  supplementalCandidates: candidates.slice(3),
});
assert.equal(recovered.restoredFromCandidatePoolCount, 3);
assert.equal(recovered.replacedFromSupplementalPoolCount, 0);
assert.equal(recovered.unrecoverableCount, 0);
assert.deepEqual(recovered.items.map((item) => item.googlePlaceId), candidates.map((place) => place.googlePlaceId));
assert.deepEqual(
  recovered.items.reduce((counts, item) => {
    counts[item.dayIndex] += 1;
    return counts;
  }, [0, 0]),
  [3, 4],
);

const payload = {
  version: 2,
  title: "P35",
  summary: "identity preservation fixture",
  moodTag: "",
  recommendations: candidates,
  destination: "台北",
  days: 2,
  itinerary: recovered.items,
};
const clientValidation = validateCompleteItineraryPayload(payload, 2, "2026-09-07");
assert.equal(clientValidation.valid, true);
assert.deepEqual(clientValidation.missingFieldCodes, []);
assert.deepEqual(clientValidation.perDayEntryCounts, [3, 4]);
const stored = normalizeStoredItinerary({
  id: "trip-p35",
  title: payload.title,
  created_at: "2026-09-07T00:00:00.000Z",
  payload: clientValidation.normalizedPayload,
});
assert(stored);
assert.equal(stored.payload.itinerary.length, 7);
assert.deepEqual(tripDetailNavigateOptions(stored.id), {
  to: "/saved/$tripId",
  params: { tripId: "trip-p35" },
  search: undefined,
});

const unknownStop = {
  ...stops[0],
  title: "Unknown internal stop",
  placeName: "Unknown internal stop",
  address: "Unknown address",
  lat: 24,
  lng: 120,
  googlePlaceId: "internal-only:unknown",
};
const blocked = recoverItineraryGoogleIdentities({
  stops: [unknownStop],
  candidates: candidates.slice(0, 3),
  supplementalCandidates: [],
});
assert.equal(blocked.unrecoverableCount, 1);

// P36 Case D: ambiguous same-name provenance must never be guessed.
const ambiguousCandidates = [candidate(20), candidate(21)].map((place) => ({
  ...place,
  name: "Ambiguous place",
  placeName: "Ambiguous place",
  address: "Same address",
  lat: 25,
  lng: 121,
}));
const ambiguousStop = {
  ...unknownStop,
  title: "Ambiguous place",
  placeName: "Ambiguous place",
  address: "Same address",
  lat: 25,
  lng: 121,
};
assert.equal(inspectItineraryIdentityLookup(ambiguousStop, ambiguousCandidates).reason, "ambiguous");
assert.equal(recoverItineraryGoogleIdentities({ stops: [ambiguousStop], candidates: ambiguousCandidates }).unrecoverableCount, 1);

// P36 Case E: a source candidate without Google ID remains non-deliverable.
const noGoogleCandidate = { ...candidate(30), googlePlaceId: undefined };
const noGoogleStop = { ...unknownStop, title: noGoogleCandidate.name, placeName: noGoogleCandidate.name };
assert.equal(inspectItineraryIdentityLookup(noGoogleStop, [noGoogleCandidate]).reason, "source_candidate_missing_google_id");

const replaced = recoverItineraryGoogleIdentities({
  stops: [unknownStop],
  candidates,
  supplementalCandidates: candidates.slice(3),
});
assert.equal(replaced.replacedFromSupplementalPoolCount, 1);
assert.equal(replaced.unrecoverableCount, 0);
assert.equal(replaced.items[0].googlePlaceId, candidates[3].googlePlaceId);

console.log("verify-p35-server-google-identity: ok");
