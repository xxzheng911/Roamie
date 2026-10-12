import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Chat save → tripSettings.transitLegs → JSON restore → renderer, without providers.
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw Error("NETWORK_DISABLED"); };
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const tt = await import("../src/lib/saved-trip/travel-time.ts");
const sot = await import("../src/lib/saved-trip/leg-transport-sot.ts");
const { isJapanTransitMapsLeg } = await import("../src/lib/saved-trip/japan-transit-maps.ts");
const { buildSavedTripTransitLegs } = await import("../src/lib/saved-trip/saved-trip-transit-legs.ts");
const { normalizeStoredItinerary } = await import("../src/lib/itinerary-storage.ts");

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const stops = [{ placeName: "清水寺" }, { placeName: "八坂神社" }, { placeName: "祇園" }];
const restore = (transitLegs) => {
  const row = normalizeStoredItinerary(JSON.parse(JSON.stringify({
    id: "trip-fixture", title: "京都", created_at: "2026-10-12T00:00:00Z",
    payload: { version: 2, itinerary: stops, tripSettings: { transport: "walk", transitLegs } },
  })));
  return row?.payload?.tripSettings?.transitLegs ?? transitLegs;
};
const label = (leg, transport, locale) => tt.formatLegTravelTimeLabel(leg, transport, { locale });
const minutes = (leg, transport) => tt.travelMinutesForMode(leg, transport);

// T1 walk 15 minutes: saved with full contract and only the walk estimate.
const walk = restore(buildSavedTripTransitLegs(stops, [{ durationMinutes: 15, distanceMeters: 1000 }, { durationMinutes: 20, distanceMeters: 1500 }], "WALK"));
const w = walk["清水寺→八坂神社"];
assert.deepEqual(Object.keys(walk), ["清水寺→八坂神社", "八坂神社→祇園"]);
assert.equal(w.transportMode, "WALK"); assert.equal(w.resolvedMode, "WALK"); assert.equal(w.routeStatus, "ok");
assert.deepEqual(w.estimates, { walk: 15 }, "walk duration only under walk");
assert.equal(minutes(w, "步行"), 15);
for (const l of LOCALES) assert.match(label(w, "步行", l) ?? "", /15/, `T1 ${l}`);
out("PASS T1 walk 15 min saved + restored + rendered in 4 locales");

// T2 drive 8 minutes; T6 a walk label never receives the drive estimate.
const drive = restore(buildSavedTripTransitLegs(stops.slice(0, 2), [{ durationMinutes: 8, distanceMeters: 3000 }], "DRIVE"))["清水寺→八坂神社"];
assert.deepEqual(drive.estimates, { drive: 8 });
assert.equal(minutes(drive, "租車自駕"), 8);
assert.equal(drive.estimates.walk, undefined, "T6 drive minutes never stored as walk");
assert.equal(drive.estimates.transit, undefined, "T6 drive minutes never stored as transit");
// A walk preference on a drive-resolved leg shows the drive label with drive minutes (resolved SoT).
assert.notEqual(sot.displayTransportLabelForLeg(drive, "步行"), "步行", "T6 label follows resolved mode");
assert.equal(minutes(drive, "步行"), 8, "T6 minutes belong to the displayed drive label");
out("PASS T2 drive 8 min; T6 mode switch never mixes durations");

// T3 transit without a usable duration; T8 empty/null; T9 invalid/negative.
for (const [name, raw] of [["T3 transit 0", 0], ["T8 null", null], ["T8 undefined", undefined], ["T9 negative", -5], ["T9 NaN", NaN], ["T9 Infinity", Infinity]]) {
  const leg = restore(buildSavedTripTransitLegs(stops.slice(0, 2), [{ durationMinutes: raw, distanceMeters: 500 }], name.startsWith("T3") ? "TRANSIT" : "WALK"))["清水寺→八坂神社"];
  assert.equal(leg.routeStatus, "failed", name);
  assert.deepEqual(leg.estimates, {}, `${name}: no invented estimate`);
  assert.equal(leg.durationMinutes, 0, name);
  for (const t of ["步行", "大眾運輸", "租車自駕"]) assert.equal(minutes(leg, t), null, `${name} ${t}`);
  for (const l of LOCALES) assert.doesNotMatch(label(leg, "大眾運輸", l) ?? "", /\d+\s*(分|min|분)/, `${name} ${l}`);
}
out("PASS T3 transit missing, T8 empty/null, T9 invalid/negative → safe missing state");

// T4/T5 legacy rows (pre-fix save shape): no TypeError, no guessed mode, no foreign minutes.
const legacy = { headline: "996m", durationMinutes: 14, distanceMeters: 996 };
const restoredLegacy = restore({ "清水寺→八坂神社": legacy })["清水寺→八坂神社"];
for (const t of ["步行", "大眾運輸", "租車自駕", "機車", ""]) {
  assert.doesNotThrow(() => minutes(restoredLegacy, t), `T4 ${t}`);
  assert.equal(minutes(restoredLegacy, t), null, `T5 legacy ${t}: unconfirmed source`);
  for (const l of LOCALES) {
    assert.doesNotThrow(() => label(restoredLegacy, t, l), `T4 ${t} ${l}`);
    assert.doesNotMatch(label(restoredLegacy, t, l) ?? "", /14/, `T5 ${t} ${l}`);
  }
}
out("PASS T4 legacy without estimates, T5 legacy without transportMode → no throw, safe missing");

// T11 Japan transit deeplink stays a button, never a duration.
const japan = { legKey: "a→b", fromName: "a", toName: "b", recommendedMode: "transit", headline: "", durationMinutes: 0, distanceMeters: 0,
  reason: "transit_unavailable", complexity: "low", estimates: {}, source: "rules", routeStatus: "transit_unavailable",
  transportStatus: "transit_unavailable", transportMode: "TRANSIT", transitUnavailableProvider: "google_maps_deeplink" };
assert.equal(isJapanTransitMapsLeg(japan, "大眾運輸"), true);
assert.equal(minutes(japan, "大眾運輸"), null);
for (const l of LOCALES) assert.equal(label(japan, "大眾運輸", l), undefined, `T11 ${l}`);
out("PASS T11 Japan transit deeplink unchanged");

// T7/T12: the real chat save uses the builder at both writes; one Routes request, no extra calls.
const chat = readFileSync("src/routes/_app.chat.tsx", "utf8");
assert.equal((chat.match(/buildSavedTripTransitLegs\(/g) ?? []).length, 2, "both transitLegs writes use the builder");
assert.doesNotMatch(chat, /headline: `\$\{leg\.distanceMeters\}m`/, "partial leg shape removed");
assert.equal((chat.match(/getTripLegsWithDurations\(/g) ?? []).length, 1, "T12 single Routes request unchanged");
assert.equal(fetchCalls, 0, "T12 no provider calls");
out("PASS T7 save/restore boundary + T12 no provider calls");
