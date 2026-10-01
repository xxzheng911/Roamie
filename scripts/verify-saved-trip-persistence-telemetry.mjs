/**
 * Saved-trip persistence observability is a sanitized stage trace.
 * It must not change insert/navigation/cover control flow or leak secrets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAVED_TRIP_PERSISTENCE_EVENTS,
  buildSavedTripPersistenceRecord,
  emitSavedTripPersistenceEvent,
  formatSavedTripPersistenceLine,
  sanitizeSavedTripPersistenceFailure,
} from "../src/lib/analytics/saved-trip-persistence-telemetry.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const generationId = "550e8400-e29b-41d4-a716-446655440000";
const savedTripId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const secret = "SECRET_PAYLOAD_SHOULD_NOT_LEAK";

const forbidden = [
  secret,
  "Bearer",
  "access_token",
  "authorization",
  "eyJhbGci",
  "payload",
  "請先登入",
  "行程收藏尚未就緒",
];

function assertSafe(line) {
  for (const value of forbidden) assert.equal(line.includes(value), false, value);
}

const leaked = new Error(`Bearer ${secret} eyJhbGci ${secret}`);
leaked.payload = { itinerary: secret, access_token: secret };
const rls = sanitizeSavedTripPersistenceFailure(
  Object.assign(leaked, { code: "42501", details: secret, hint: secret }),
);
assert.equal(rls.errorCategory, "rls");
assert.equal(rls.errorCode, "42501");
assert.equal(rls.supabaseCode, "42501");
assert.deepEqual(sanitizeSavedTripPersistenceFailure(new Error("請先登入")), {
  errorCategory: "unauthenticated",
  errorCode: "unauthenticated",
});
assert.equal(
  sanitizeSavedTripPersistenceFailure(new Error("invalid_saved_trip_row")).errorCategory,
  "invalid_row",
);
const quota = new Error("quota");
quota.name = "QuotaExceededError";
assert.equal(sanitizeSavedTripPersistenceFailure(quota).errorCategory, "storage_quota");
assert.equal(
  sanitizeSavedTripPersistenceFailure({ code: "42501; drop table saved_trips" }).errorCategory,
  "unknown",
);
assert.equal(sanitizeSavedTripPersistenceFailure({ code: "not a code" }).supabaseCode, undefined);

const failed = buildSavedTripPersistenceRecord({
  event: "saved_trip_insert_failed",
  generationId: `Bearer ${secret}`,
  source: "chat",
  error: Object.assign(leaked, { code: "42501" }),
  stage: "insert",
  insertAttempted: true,
});
const failedLine = formatSavedTripPersistenceLine(failed);
assert.match(failedLine, /event=saved_trip_insert_failed/);
assert.match(failedLine, /stage=insert/);
assert.match(failedLine, /insertAttempted=true/);
assert.match(failedLine, /errorCategory=rls/);
assert.match(failedLine, /supabaseCode=42501/);
assert.equal(failed.generationId, undefined);
assertSafe(failedLine);

const clientId = buildSavedTripPersistenceRecord({
  event: "itinerary_client_received",
  generationId,
  source: "chat",
});
assert.equal(clientId.generationId, generationId);
assert.equal(clientId.savedTripId, undefined);
assertSafe(formatSavedTripPersistenceLine(clientId));

const succeeded = buildSavedTripPersistenceRecord({
  event: "saved_trip_insert_succeeded",
  generationId,
  savedTripId: `trip-${Date.now()}`,
  source: "chat",
});
assert.equal(succeeded.savedTripId, undefined);
const withUuid = buildSavedTripPersistenceRecord({
  event: "saved_trip_insert_succeeded",
  generationId,
  savedTripId,
  source: "chat",
});
assert.equal(withUuid.savedTripId, savedTripId);
assert.match(formatSavedTripPersistenceLine(withUuid), new RegExp(`savedTripId=${savedTripId}`));

const started = buildSavedTripPersistenceRecord({
  event: "saved_trip_insert_started",
  generationId,
  source: "chat",
});
assert.equal(started.insertAttempted, false);
assert.equal(started.stage, "confirm_save_started");
const attempted = buildSavedTripPersistenceRecord({
  event: "saved_trip_insert_attempted",
  generationId,
  source: "chat",
});
assert.equal(attempted.insertAttempted, true);
assert.equal(attempted.stage, "insert");

const warnings = [];
const originalWarn = console.warn;
console.warn = (line) => warnings.push(String(line));
try {
  emitSavedTripPersistenceEvent({
    event: "draft_trip_save_failed",
    generationId,
    source: "chat",
    error: Object.assign(new Error(secret), { authorization: secret, payload: secret }),
  });
} finally {
  console.warn = originalWarn;
}
assert.equal(warnings.length, 1);
assert.match(warnings[0], /event=draft_trip_save_failed/);
assert.match(warnings[0], new RegExp(`generationId=${generationId}`));
assertSafe(warnings[0]);

const telemetry = read("src/lib/analytics/saved-trip-persistence-telemetry.ts");
assert.match(telemetry, /console\.warn\(formatSavedTripPersistenceLine\(record\)\)/);
assert.doesNotMatch(telemetry, /console\.info/);
assert.doesNotMatch(telemetry, /JSON\.stringify\(input\)/);
assert.equal(telemetry.includes("recordAnalyticsEvent"), false);

const analyticsEvents = read("src/lib/analytics/events.ts");
for (const eventName of SAVED_TRIP_PERSISTENCE_EVENTS) {
  assert.equal(analyticsEvents.includes(`"${eventName}"`), false);
}

const storage = read("src/lib/itinerary-storage.ts");
const insertAt = storage.indexOf(".insert({");
const selectAt = storage.indexOf(".select(TRIP_SELECT)", insertAt);
const insertBlock = storage.slice(insertAt, selectAt);
assert.equal(insertBlock.includes("generationId"), false);
assert.doesNotMatch(insertBlock, /\bsource\b/);
assert.match(storage, /\.single\(\)/);
assert.match(storage, /throw new Error\(error\.message\)/);
assert.equal(storage.includes(".upsert("), false);
assert.match(storage, /event: "saved_trip_insert_started"/);
assert.match(storage, /event: "saved_trip_insert_attempted"/);
assert.match(storage, /event: "saved_trip_insert_succeeded"/);
assert.match(storage, /event: "saved_trip_insert_failed"/);
assert.ok(
  storage.indexOf('event: "saved_trip_insert_succeeded"') >
    storage.indexOf("requireStoredItinerary(data, withTitle)"),
);
const confirmFn = storage.slice(storage.indexOf("export async function confirmSaveTrip"));
assert.ok(confirmFn.indexOf("await persistItinerary(") < confirmFn.indexOf("broadcastTripsChanged()"));

const chat = read("src/routes/_app.chat.tsx");
assert.equal((chat.match(/getTripCoverImage\(\{/g) || []).length, 1);
const draftAt = chat.indexOf("saveDraftTrip(draftPayload)");
const confirmAt = chat.indexOf("confirmSaveTrip(draftPayload");
const navigationEventAt = chat.indexOf('event: "saved_trip_navigation_started"');
const navigateAt = chat.indexOf("navigate(tripDetailNavigateOptions(saved.id))");
const coverStartedAt = chat.indexOf('event: "cover_enrichment_started"');
const coverAt = chat.indexOf("getTripCoverImage({");
assert.ok(chat.indexOf('event: "itinerary_client_received"') < draftAt);
assert.ok(chat.indexOf('event: "draft_trip_save_started"') < draftAt);
assert.ok(draftAt < chat.indexOf('event: "draft_trip_save_succeeded"'));
assert.ok(draftAt < confirmAt);
assert.ok(confirmAt < navigationEventAt);
assert.ok(navigationEventAt < navigateAt);
assert.ok(navigateAt < coverStartedAt);
assert.ok(coverStartedAt < coverAt);
assert.match(chat, /void Promise\.allSettled\(\[legEnrichment, coverEnrichment\]\)/);
assert.equal(chat.includes("await getTripCoverImage"), false);
assert.equal(chat.includes("await coverEnrichment"), false);
assert.match(chat, /generationId,/);

const productionLogging = read("src/lib/production-logging.ts");
assert.match(productionLogging, /console\.info = noop/);
assert.equal(productionLogging.includes("console.warn = noop"), false);

console.log("PASS saved trip persistence telemetry: stages, correlation, sanitization, invariants");
