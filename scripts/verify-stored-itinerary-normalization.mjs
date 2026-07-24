import assert from "node:assert/strict";
import {
  normalizeStoredItinerary,
  normalizeStoredItineraryList,
} from "../src/lib/itinerary-storage.ts";

const payload = {
  version: 2,
  title: "測試行程",
  summary: "測試摘要",
  moodTag: "悠閒",
  recommendations: [],
  itinerary: [
    {
      date: "2026-08-10",
      time: "10:00",
      title: "測試地點",
      description: "",
      placeName: "測試地點",
      lat: 25.033,
      lng: 121.5654,
      transport: "walk",
      arrivalTime: "10:00",
      stayDuration: 90,
      dayIndex: 2,
      sortIndex: 7,
      order: 4,
      routeCustomization: { locked: true },
    },
  ],
};

const base = {
  id: "trip-1",
  title: "預設標題",
  mood: "悠閒",
  cover_image: "system-cover.jpg",
  cover_image_url: null,
  cover_source: "unsplash",
  cover_query: "Taipei",
  created_at: "2026-07-25T00:00:00.000Z",
  updated_at: "2026-07-25T01:00:00.000Z",
  payload,
};

const complete = normalizeStoredItinerary({
  ...base,
  custom_title: "我的行程",
  is_title_customized: true,
  custom_cover_image_url: "custom-cover.jpg",
  is_cover_customized: true,
});
assert.ok(complete);
assert.equal(complete.custom_title, "我的行程");
assert.equal(complete.is_title_customized, true);
assert.equal(complete.custom_cover_image_url, "custom-cover.jpg");
assert.equal(complete.is_cover_customized, true);

const legacy = normalizeStoredItinerary({
  ...base,
  cover_image_url: "legacy-cover.jpg",
});
assert.ok(legacy);
assert.equal(legacy.custom_title, null);
assert.equal(legacy.is_title_customized, false);
assert.equal(legacy.custom_cover_image_url, "legacy-cover.jpg");
assert.equal(legacy.is_cover_customized, false);

const explicitNull = normalizeStoredItinerary({
  ...base,
  cover_image_url: "legacy-cover.jpg",
  custom_cover_image_url: null,
});
assert.ok(explicitNull);
assert.equal(explicitNull.custom_cover_image_url, null);

const draft = normalizeStoredItinerary({
  id: "draft",
  title: payload.title,
  mood: payload.moodTag,
  cover_image: null,
  cover_image_url: null,
  cover_source: null,
  cover_query: null,
  created_at: "2026-07-25T00:00:00.000Z",
  payload,
});
assert.ok(draft);
assert.equal(draft.updated_at, draft.created_at);
assert.equal(draft.custom_title, null);
assert.equal(draft.is_title_customized, false);

assert.equal(legacy.payload, payload);
assert.equal(legacy.payload.itinerary, payload.itinerary);
assert.equal(legacy.payload.itinerary[0], payload.itinerary[0]);
assert.equal(legacy.payload.itinerary[0].transport, "walk");
assert.equal(legacy.payload.itinerary[0].arrivalTime, "10:00");
assert.equal(legacy.payload.itinerary[0].stayDuration, 90);
assert.equal(legacy.payload.itinerary[0].dayIndex, 2);
assert.equal(legacy.payload.itinerary[0].sortIndex, 7);
assert.equal(legacy.payload.itinerary[0].order, 4);
assert.deepEqual(legacy.payload.itinerary[0].routeCustomization, { locked: true });

const realtimeEquivalent = normalizeStoredItinerary({ ...base, cover_image_url: "legacy.jpg" });
const primaryEquivalent = normalizeStoredItinerary({ ...base, cover_image_url: "legacy.jpg" });
assert.deepEqual(realtimeEquivalent, primaryEquivalent);

const guestRows = normalizeStoredItineraryList([
  { ...base, id: "guest-1" },
  { id: "broken", title: "缺少 payload" },
]);
assert.equal(guestRows.length, 1);
assert.equal(guestRows[0].id, "guest-1");
assert.deepEqual(normalizeStoredItineraryList({ invalid: true }), []);

const reloaded = normalizeStoredItinerary(JSON.parse(JSON.stringify(complete)));
assert.ok(reloaded);
assert.equal(reloaded.custom_title, complete.custom_title);
assert.equal(reloaded.is_title_customized, true);
assert.equal(reloaded.custom_cover_image_url, complete.custom_cover_image_url);
assert.equal(reloaded.is_cover_customized, true);
assert.equal(reloaded.payload.itinerary[0].transport, "walk");
assert.equal(reloaded.payload.itinerary[0].dayIndex, 2);
assert.equal(reloaded.payload.itinerary[0].sortIndex, 7);

console.info("[VERIFY_STORED_ITINERARY_NORMALIZATION] PASS", {
  cases: 10,
  payloadReferencePreserved: true,
  legacyCoverFallback: true,
});
