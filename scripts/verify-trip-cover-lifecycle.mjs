import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  publishTripCover,
  getTripCoverUpdate,
  applyTripCover,
  readTripCoverEvent,
  SAVED_TRIPS_CHANGED_EVENT,
} from "../src/lib/saved-trip/cover-live-state.ts";
import { resolveDisplayCoverImage, coverFieldsFromStored } from "../src/lib/saved-trip/display.ts";
import {
  applyCoreTripCover,
  toCoreTrip,
  resolveCoreTripCoverImage,
} from "../src/lib/trip/core-trip.ts";

globalThis.fetch = () => {
  throw Error("Unexpected network");
};
globalThis.window = new EventTarget();
const at = (n) => `2026-10-01T00:00:0${n}.000Z`;
const row = (id, n = 0, url = "/default.png", extra = {}) => ({
  id,
  updated_at: at(n),
  created_at: at(0),
  title: "original",
  mood: null,
  custom_title: null,
  is_title_customized: false,
  cover_image: url,
  cover_image_url: null,
  custom_cover_image_url: null,
  is_cover_customized: false,
  cover_source: "roamie",
  cover_query: null,
  payload: { version: 2, title: "original", itinerary: [], tripSettings: { transport: "walk" } },
  ...extra,
});
let events = [];
window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, (e) => events.push(e));
const base = row("A");
publishTripCover(base, "pending");
assert.equal(getTripCoverUpdate("A").resolution, "pending");
// A/B/C/J: retained state works on both sides of listener mount, including remount.
const resolved = row("A", 2, "/resolved.jpg", { cover_source: "unsplash" });
publishTripCover(resolved);
assert.equal(applyTripCover(base).cover_image, "/resolved.jpg");
assert.equal(getTripCoverUpdate("A").resolution, "resolved");
assert.equal(readTripCoverEvent(events.at(-1)).tripId, "A");
assert.equal(readTripCoverEvent(events[0]), null, "stale event cannot be applied");
// D/E: list/detail snapshots converge without reading DB; edits remain untouched.
const edited = {
  ...base,
  title: "local title",
  payload: { itinerary: ["edited"], tripSettings: { transport: "drive" } },
};
const detail = applyTripCover(edited);
assert.equal(detail.payload, edited.payload);
assert.equal(detail.title, "local title");
assert.equal(
  detail.updated_at,
  edited.updated_at,
  "cover event does not trigger generic row hydration",
);
const core = toCoreTrip(base);
const nextCore = applyCoreTripCover(core);
assert.equal(nextCore.places, core.places);
assert.equal(nextCore.title, core.title);
assert.equal(
  resolveCoreTripCoverImage(nextCore),
  resolveDisplayCoverImage(coverFieldsFromStored(detail)),
);
// F/G: stale Realtime stays behind local mutation, newer external covers are authoritative.
assert.equal(applyTripCover(base).cover_image, "/resolved.jpg");
assert.equal(applyTripCover(row("A", 3, "/remote.jpg")).cover_image, "/remote.jpg");
publishTripCover(row("A", 1, "/old.jpg"));
assert.equal(getTripCoverUpdate("A").fields.cover_image, "/resolved.jpg");
// H: custom beats automatic; updates preserve actual mutation result custom fields.
const custom = row("custom", 2, "/auto.jpg", {
  custom_cover_image_url: "/custom.jpg",
  is_cover_customized: true,
  cover_source: "upload",
});
publishTripCover(custom, "pending");
assert.equal(resolveDisplayCoverImage(coverFieldsFromStored(custom)), "/custom.jpg");
assert.equal(resolveCoreTripCoverImage(toCoreTrip(custom)), "/custom.jpg");
publishTripCover({
  ...custom,
  updated_at: at(3),
  cover_image: "/new-auto.jpg",
  cover_source: "unsplash",
});
assert.equal(
  resolveDisplayCoverImage(coverFieldsFromStored(applyTripCover(custom))),
  "/custom.jpg",
);
// I: failure settles pending into confirmed fallback, no retry/generation.
const failed = row("failed");
publishTripCover(failed, "pending");
publishTripCover(failed, "fallback");
assert.equal(getTripCoverUpdate("failed").resolution, "fallback");
// K: concurrent unrelated trip does not affect A.
publishTripCover(row("B"), "pending");
publishTripCover(row("B", 4, "/B.jpg"), "resolved");
assert.equal(applyTripCover(base).cover_image, "/resolved.jpg");
assert.equal(applyTripCover(row("B")).cover_image, "/B.jpg");
publishTripCover({ ...row("micro", 2, "/latest.jpg"), updated_at: "2026-10-01T00:00:02.123456Z" });
publishTripCover({ ...row("micro", 2, "/stale.jpg"), updated_at: "2026-10-01T00:00:02.123123Z" });
assert.equal(getTripCoverUpdate("micro").fields.cover_image, "/latest.jpg");
const metadata = JSON.stringify(getTripCoverUpdate("A"));
for (const field of ["payload", "title", "user_id", "operation_id", "request_id"])
  assert(!metadata.includes(`"${field}"`));
const read = (p) => readFileSync(p, "utf8");
const chat = read("src/routes/_app.chat.tsx");
assert.equal((chat.match(/getTripCoverImage\(\{/g) || []).length, 1);
assert(
  chat.indexOf('publishTripCover(saved, "pending")') <
    chat.indexOf("navigate(tripDetailNavigateOptions(saved.id))"),
);
assert(chat.includes('if (!updatedCoverRow) publishTripCover(saved, "fallback")'));
assert(chat.includes("abandonPendingCover?.();"), "navigation/settlement abort must not leave a pending cover");
const storage = read("src/lib/itinerary-storage.ts");
assert(storage.includes("publishTripCover(stored);\n    return stored;"));
const screen = read("src/components/trip/TripDetailScreen.tsx");
assert(screen.includes("applyTripCover(remote)"));
assert(screen.includes("readTripCoverEvent(event)?.tripId === tripId"));
const editor = read("src/components/saved/SavedTripItineraryEditor.tsx");
assert(editor.includes("resolutionPending={automaticCoverPending}"));
const favorites = read("src/routes/_app.saved.index.tsx");
assert(favorites.includes("current.map(applyCoreTripCover)"));
assert(
  read("src/lib/trip-reminder-notifications.ts").includes(
    "if (event && isTripCoverEvent(event)) return",
  ),
);
assert(read("src/routes/_app.index.tsx").includes("if (isTripCoverEvent(event))"));
const service = read("src/lib/saved-trip/cover-live-state.ts");
assert(!/fetch\(|setInterval\(|setTimeout\(/.test(service));
console.log(
  "PASS trip cover lifecycle A–K: replay, live narrow patch, list/detail parity, stale Realtime, custom, failure, remount, concurrent trips, privacy, no network",
);
