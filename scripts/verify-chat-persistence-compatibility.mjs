import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAssistantContent as oldReader, normalizeRoamieResponse as oldNormalize, isRoamiePayloadV2 as oldTripGuard } from "./fixtures/legacy-chat-reader-62fb690.mjs";
import { encodeGeneratedChatContent, decodeGeneratedChatContent } from "../src/lib/generated-locale.ts";
import { restoreAssistantChatMessage as newReader } from "../src/lib/chat-history.ts";
import { extractPlacesFromChat } from "../src/lib/itinerary-source.ts";

const place = { name: "Official Cafe", placeName: "Official Cafe", type: "cafe", description: "既有描述", reason: "既有理由", estimatedTime: "45 min", address: "Official address", lat: 25.03, lng: 121.56, googleMapsUrl: "https://maps.example/place", googlePlaceId: "id-a", reasonSource: "ai", sourceCombinationIds: [2, 1] };
const stop = { date: "2026-10-02", time: "09:30", title: "Official Cafe", placeName: "Official Cafe", description: "行程說明", notes: "使用者筆記", lat: 25.03, lng: 121.56, googlePlaceId: "id-a", dayIndex: 1, sortIndex: 0, order: 3 };
const payload = { title: "原始標題", summary: "原始歷史回覆", moodTag: "relax", recommendations: [place, { ...place, name: "Second", placeName: "Second", googlePlaceId: "id-b" }], itinerary: [stop], actions: [{ id: "plan", intent: "create_itinerary" }], places: [{ id: "extension-place", lat: 1, lng: 2 }], handoff: { itineraryId: "trip-1", selectedIds: ["id-b", "id-a"] } };
const oldWire = JSON.stringify(payload);
const newWire = encodeGeneratedChatContent(oldWire, "zh-TW");
const expected = oldReader(oldWire);
for (const [name, reader, wire] of [
  ["OLD→OLD", oldReader, oldWire], ["OLD→NEW", newReader, oldWire],
  ["NEW→NEW", newReader, newWire], ["NEW→OLD", oldReader, newWire],
]) {
  const restored = reader(wire);
  assert.equal(restored.content, payload.summary);
  const { generatedLocale: _locale, ...business } = restored.roamie;
  assert.deepEqual(business, expected.roamie, `${name}: every legacy-normalized display field`);
  assert.deepEqual(restored.roamie.recommendations.map((p) => p.googlePlaceId), ["id-a", "id-b"]);
  console.log(`PASS ${name}`);
}
const persisted = JSON.parse(JSON.stringify({ content: newWire })).content;
const decoded = JSON.parse(decodeGeneratedChatContent(persisted).content);
const { generatedLocale, ...business } = decoded;
assert.equal(generatedLocale, "zh-TW");
assert.deepEqual(business, payload, "All business fields, including extensions, stay semantic-equivalent");
assert.equal(Object.hasOwn(decoded, "content"), false, "No duplicated response envelope");
assert.equal(newReader(newWire).generatedLocale, "zh-TW");
for (const locale of ["zh-TW", "en", "ja", "ko"]) {
  const wire = encodeGeneratedChatContent(oldWire, locale);
  assert.equal(newReader(wire).generatedLocale, locale);
  assert.equal(oldReader(wire).content, payload.summary);
  for (const content of [oldWire, payload]) {
    const envelope = JSON.stringify({ kind: "roamie.assistant.v1", generatedLocale: locale, content });
    assert.equal(newReader(envelope).content, payload.summary);
    assert.equal(newReader(envelope).generatedLocale, locale);
  }
}
for (const generatedLocale of [undefined, null, "invalid", {}, 42]) {
  const wire = JSON.stringify({ ...payload, generatedLocale });
  assert.equal(newReader(wire).generatedLocale, undefined);
  assert.equal(newReader(wire).content, payload.summary);
}
// Existing top-level fields are not overwritten, including provenance or envelope-like business data.
for (const generatedLocale of ["en", null, "invalid", { business: true }]) {
  const collision = { ...payload, generatedLocale, kind: "roamie.assistant.v1", content: "business extension" };
  const wire = encodeGeneratedChatContent(JSON.stringify(collision), "ja");
  assert.deepEqual(JSON.parse(wire), collision);
  assert.equal(newReader(wire).content, payload.summary, "Flat response wins over marker collision");
  assert.equal(oldReader(wire).content, payload.summary);
}
const invalidEnvelope = JSON.stringify({ kind: "roamie.assistant.v1", generatedLocale: "invalid", content: { ...payload, generatedLocale: "ja" } });
assert.equal(newReader(invalidEnvelope).generatedLocale, undefined, "Do not borrow nested provenance");
for (const plain of ["Plain historical text", "{malformed", "[1,2]"]) {
  const wire = encodeGeneratedChatContent(plain, "en");
  assert.equal(oldReader(wire).content, plain);
  assert.equal(newReader(wire).content, plain);
}
const historical = newReader(newWire);
const currentPlaces = extractPlacesFromChat([historical], "ja");
assert.equal(historical.content, payload.summary);
assert.notEqual(currentPlaces[0].reason, place.reason);
assert.equal(currentPlaces[0].googlePlaceId, place.googlePlaceId);
// Trip metadata is additive. Old guard and normalizer still read the same core fields.
const trip = { ...payload, version: 2, destination: "Tokyo", days: 2, generatedLocale: "ja", outfitCopy: { generatedLocale: "ja" }, tripSettings: { generatedLocale: "zh-TW", tripStartDate: "2026-10-01" } };
const tripWire = JSON.parse(JSON.stringify(trip));
assert.ok(oldTripGuard(tripWire));
assert.deepEqual(oldNormalize(tripWire), oldNormalize(payload));
assert.deepEqual(tripWire.itinerary, payload.itinerary);
assert.equal(tripWire.days, 2);
assert.equal(tripWire.title, payload.title);
// All three production assistant writes still use the canonical serializer.
let count = 0;
for (const file of ["src/routes/api/chat.ts", "src/routes/api/roamie.ts"]) {
  const source = fs.readFileSync(file, "utf8");
  const writes = [...source.matchAll(/\.from\("chat_messages"\)\.insert\(\{([\s\S]*?)\}\)/g)];
  for (const [, body] of writes) if (/role: "assistant"/.test(body)) {
    assert.match(body, /content: encodeGeneratedChatContent\(/);
    count++;
  }
}
assert.equal(count, 3);
console.log("PASS envelope compatibility, collisions, missing/invalid locale, exact business round-trip, historical/current UI separation, additive trip metadata and all 3 writers");
