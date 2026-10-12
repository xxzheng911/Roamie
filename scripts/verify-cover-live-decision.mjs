import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDevVerboseLog } from "../src/lib/dev-verbose-log.ts";
import { coverLiveDecision, coverRuntimeRecord, traceCoverLiveDecision } from "../src/lib/saved-trip/cover-runtime-diagnostics.ts";

// Surface tagging + live-cover decision records: enumerated fields only, debug-gated.
const remote = "https://images.unsplash.com/photo-SECRET?token=SECRET";
const bundled = "/assets/roamie-default-cover.png";
const ctx = { correlationId: "fixture", sourceType: "remote" };
assert.equal(coverRuntimeRecord(ctx, remote, "loaded").surface, "other", "untagged callers are other");
assert.equal(coverRuntimeRecord({ ...ctx, surface: "trip_detail" }, remote, "loaded").surface, "trip_detail");

const decide = (o) => coverLiveDecision({ surface: "trip_detail", live: { resolution: "resolved", updatedAt: "t" },
  storedRevision: 1, liveRevision: 2, currentUrl: bundled, incomingUrl: remote, incomingCustomized: false, ...o });
const cases = [
  [{ live: null }, false, "no_live_update", "no_live"],
  [{ storedRevision: 3, liveRevision: 2 }, true, "adopted_newer_row_cover", "stored_newer"],
  [{ currentUrl: remote }, true, "same_as_current", "live_newer"],
  [{}, true, "applied", "live_newer"],
  [{ incomingUrl: null }, true, "no_image_in_update", "live_newer"],
  [{ live: { resolution: "pending", updatedAt: "t" }, storedRevision: 2 }, true, "pending_resolution", "same"],
];
for (const [over, accepted, reason, version] of cases) {
  const d = decide(over);
  assert.equal(d.updateAccepted, accepted, reason); assert.equal(d.decisionReason, reason); assert.equal(d.versionComparison, version, reason);
  assert.deepEqual(Object.keys(d).sort(), ["currentSourceType", "decisionReason", "incomingSourceType", "liveCoverStatus", "surface", "updateAccepted", "versionComparison"]);
  assert.ok(!/SECRET|token|unsplash|roamie-default|photo-/.test(JSON.stringify(d)), "no URLs in the record");
}
assert.equal(decide({}).currentSourceType, "bundled"); assert.equal(decide({}).incomingSourceType, "remote");
assert.equal(decide({ incomingCustomized: true }).incomingSourceType, "custom");

// Gate mirrors the editor's own live-cover condition exactly (no behavior drift).
const editor = readFileSync("src/components/saved/SavedTripItineraryEditor.tsx", "utf8");
assert.ok(editor.includes("coverStateForLiveUpdate(stored, liveCover)"), "editor applies the guarded live cover row");
assert.ok(editor.includes('coverSurface="trip_detail"'));
assert.ok(readFileSync("src/components/saved/SavedTripCard.tsx", "utf8").includes('coverSurface="saved_card"'));
assert.ok(readFileSync("src/components/home/HomeTripCard.tsx", "utf8").includes('coverSurface="home_card"'));

// Debug-only: no output unless VITE_DEBUG_DIAGNOSTICS / VITE_VERBOSE_LOG.
const logs = []; const old = console.info; console.info = (...a) => logs.push(a);
traceCoverLiveDecision(decide({}));
console.info = old;
assert.equal(logs.length, isDevVerboseLog() ? 1 : 0, "release builds emit nothing");
console.log("PASS cover surface tagging + COVER_LIVE_STATE_DECISION: 6 decisions, enumerated fields, no URLs/IDs, debug-gated");
