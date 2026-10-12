import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publishTripRouteEnrichment, getTripRouteEnrichment, mergeTripRouteEnrichment, TRIP_ROUTE_ENRICHMENT_EVENT } from "../src/lib/saved-trip/cover-live-state.ts";
import { buildSavedTripTransitLegs, selectDisplayTransitLeg } from "../src/lib/saved-trip/saved-trip-transit-legs.ts";
import { travelMinutesForMode, formatLegTravelTimeLabel } from "../src/lib/saved-trip/travel-time.ts";

// T0 saved (no legs) → editor opens with T0 settings → T1 background Routes enrichment →
// T2 editor autosave persists *its* settings. Enriched legs must survive T2; user edits must
// survive T1; order swaps and duplicates are safe; nothing unverified or foreign is merged.
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e) };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const DATE = "2026-12-08";
const A = { placeName: "清水寺", lat: 34.9948, lng: 135.785, googlePlaceId: "ChIJ_A" };
const B = { placeName: "石塀小路", lat: 35.0001, lng: 135.7795, googlePlaceId: "ChIJ_B" };
const C = { placeName: "八坂神社", lat: 35.0036, lng: 135.7785, googlePlaceId: "ChIJ_C" };
const scopedKey = `${DATE}§清水寺→石塀小路`;
const failed = { routeStatus: "failed", requestedMode: "WALK", transportMode: "WALK", fallbackReason: "rate_limited",
  estimates: {}, durationMinutes: 0, routeCacheFingerprint: "fp", routeRetryAfter: 1_900_000_000_000 };
const enriched = buildSavedTripTransitLegs([A, B, C], [{ durationMinutes: 15, distanceMeters: 766 }, { durationMinutes: 6, distanceMeters: 400 }], "WALK");
const results = [];
const check = (name, fn) => { try { fn(); results.push([name, "PASS"]); } catch (e) { results.push([name, `FAIL ${String(e.message).slice(0, 110)}`]); } };
// Editor settings model: T0 + the user's own edit + failed day-scoped sync result.
const editorT0 = () => ({ transport: "walk", legMinutes: { userEdit: 45 }, transitLegs: { [scopedKey]: { ...failed } } });
const apply = (settings, tripId) => {
  const merged = mergeTripRouteEnrichment(settings.transitLegs, getTripRouteEnrichment(tripId));
  return merged === settings.transitLegs ? settings : { ...settings, transitLegs: merged };
};

check("T1 after T0 → T2 autosave keeps enriched legs and the user's edit", () => {
  publishTripRouteEnrichment("trip-1", enriched);
  const t2 = apply(editorT0(), "trip-1"); // what autosave persists
  assert.equal(t2.legMinutes.userEdit, 45, "user edit kept");
  assert.ok(t2.transitLegs["清水寺→石塀小路"]?.savedRouteEndpoints, "enriched leg merged");
  assert.deepEqual(t2.transitLegs[scopedKey], failed, "day-scoped sync result and its cooldown untouched");
  assert.equal(travelMinutesForMode(selectDisplayTransitLeg(t2.transitLegs, DATE, A, B), "步行"), 15, "429 → saved WALK 15 shown");
  for (const l of ["zh-TW", "en", "ja", "ko"]) assert.match(formatLegTravelTimeLabel(selectDisplayTransitLeg(t2.transitLegs, DATE, A, B), "步行", { locale: l }) ?? "", /15/);
});
check("order swap: editor mounts after T1 → replay gives the same result", () => {
  const late = apply(editorT0(), "trip-1");
  assert.ok(late.transitLegs["清水寺→石塀小路"]);
});
check("duplicate events are idempotent (same reference, no save loop)", () => {
  const once = apply(editorT0(), "trip-1");
  publishTripRouteEnrichment("trip-1", enriched);
  assert.equal(apply(once, "trip-1"), once);
});
check("other trips never receive the legs", () => {
  const other = editorT0();
  assert.equal(apply(other, "trip-2"), other);
});
check("existing legs are never overwritten", () => {
  const userLeg = { ...enriched["清水寺→石塀小路"], durationMinutes: 99, estimates: { walk: 99 } };
  const s = { ...editorT0(), transitLegs: { [scopedKey]: { ...failed }, "清水寺→石塀小路": userLeg } };
  assert.equal(apply(s, "trip-1").transitLegs["清水寺→石塀小路"].durationMinutes, 99);
});
check("successful Directions result stays authoritative", () => {
  const ok = { ...failed, routeStatus: "ok", durationMinutes: 20, estimates: { walk: 20 }, routeRetryAfter: undefined };
  const s = apply({ ...editorT0(), transitLegs: { [scopedKey]: ok } }, "trip-1");
  assert.equal(travelMinutesForMode(selectDisplayTransitLeg(s.transitLegs, DATE, A, B), "步行"), 20);
});
check("unverified legs are rejected at publish (invalid minutes / no identity / failed / day-scoped key)", () => {
  const bad = {
    ...buildSavedTripTransitLegs([A, B], [{ durationMinutes: 0, distanceMeters: 1 }], "WALK"),
    "八坂神社→石塀小路": { ...enriched["八坂神社→石塀小路"], savedRouteEndpoints: undefined },
    [`${DATE}§清水寺→八坂神社`]: { ...enriched["清水寺→石塀小路"] },
  };
  publishTripRouteEnrichment("trip-3", bad);
  assert.equal(getTripRouteEnrichment("trip-3"), undefined, "nothing trusted → nothing stored");
});
check("mode isolation: saved WALK never fills a DRIVE request", () => {
  const s = apply({ ...editorT0(), transitLegs: { [scopedKey]: { ...failed, requestedMode: "DRIVE", transportMode: "DRIVE" } } }, "trip-1");
  assert.equal(travelMinutesForMode(selectDisplayTransitLeg(s.transitLegs, DATE, A, B), "租車自駕"), null);
});
check("events use a dedicated channel (no saved-list reloads)", () => {
  assert.ok(events.length > 0 && events.every((e) => e.type === TRIP_ROUTE_ENRICHMENT_EVENT));
  assert.notEqual(TRIP_ROUTE_ENRICHMENT_EVENT, "roamie:saved-trips-changed");
});
check("persistence contract: enrichment no longer rewrites the payload; editor merges", () => {
  const chat = readFileSync("src/routes/_app.chat.tsx", "utf8");
  assert.doesNotMatch(chat, /enrichedPayload/, "background enrichment must not send a stale whole payload");
  assert.match(chat, /publishTripRouteEnrichment\(\s*saved\.id,/);
  const editor = readFileSync("src/components/saved/SavedTripItineraryEditor.tsx", "utf8");
  assert.match(editor, /mergeTripRouteEnrichment\(/);
});

for (const [name, status] of results) out(`${status === "PASS" ? "PASS" : "FAIL"} ${name}${status === "PASS" ? "" : " — " + status}`);
const failedCount = results.filter(([, s]) => s !== "PASS").length;
out(`${results.length - failedCount}/${results.length} PASS`);
process.exitCode = failedCount ? 1 : 0;
