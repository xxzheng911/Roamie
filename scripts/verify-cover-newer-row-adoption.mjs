import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publishTripCover, coverStateForLiveUpdate } from "../src/lib/saved-trip/cover-live-state.ts";
import { normalizeStoredTrip } from "../src/lib/saved-trip/normalize.ts";
import { coverLiveDecision } from "../src/lib/saved-trip/cover-runtime-diagnostics.ts";

// Device order: save(T0 default) → enrichment updateTripMeta(T1 remote, published live)
// → the open editor's own debounced save echoes a newer row (T2) that still carries the
// persisted remote cover columns. The editor must show T2's cover, never the older patch.
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
globalThis.window = { dispatchEvent: () => {} };
const REMOTE = "https://images.unsplash.com/photo-kyoto";
const row = (updated_at, cover_image, cover_source) => ({
  id: "trip-cover-fixture", title: "京都", created_at: "2026-10-12T00:00:00Z", updated_at,
  cover_image, cover_image_url: null, custom_cover_image_url: null, is_cover_customized: false,
  cover_source, cover_query: null, mood: null, payload: { version: 2, itinerary: [], tripSettings: {} },
});
const T0 = row("2026-10-12T09:00:00.000000+00:00", null, "roamie");
const T1 = row("2026-10-12T09:00:03.000000+00:00", REMOTE, "unsplash");
const T2 = row("2026-10-12T09:00:05.000000+00:00", REMOTE, "unsplash");
publishTripCover(T0, "pending");
publishTripCover(T1);
const shown = (stored) => normalizeStoredTrip(coverStateForLiveUpdate(stored)).aiGeneratedCoverImageUrl;

assert.equal(shown(T0), REMOTE, "older row receives the resolved live cover");
assert.equal(shown(T2), REMOTE, "newer own-save echo shows its persisted remote cover");
const staleNewer = row("2026-10-12T09:00:07.000000+00:00", null, "roamie");
assert.equal(shown(staleNewer), null, "a newer row's own (default) cover wins over the older live patch: version guard kept");
assert.equal(coverStateForLiveUpdate(T2, null), null, "no live update → nothing to apply");

const d = coverLiveDecision({ surface: "trip_detail", live: { resolution: "resolved", updatedAt: T1.updated_at },
  storedRevision: 2, liveRevision: 1, currentUrl: "/assets/default.png", incomingUrl: REMOTE, incomingCustomized: false });
assert.equal(d.versionComparison, "stored_newer");
assert.equal(d.decisionReason, "adopted_newer_row_cover");
assert.equal(d.updateAccepted, true);

const editor = readFileSync("src/components/saved/SavedTripItineraryEditor.tsx", "utf8");
assert.ok(!editor.includes("if (!liveCover || coverRevision(stored.updated_at) > coverRevision(liveCover.updatedAt)) return;"),
  "editor no longer drops a newer row's cover");
assert.ok(editor.includes("coverStateForLiveUpdate(stored, liveCover)"));
process.stdout.write("PASS newer-row cover adoption: T0←live, T2 keeps persisted remote, newer default wins, guard kept" + "\n");
