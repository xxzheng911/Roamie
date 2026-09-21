import { localizedAvailabilityCopy } from "../src/lib/generated-display-projection.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import { destinationEditorialMessages } from "../src/lib/i18n/destination-editorial.ts";
import { translate } from "../src/lib/i18n/translate.ts";
import { structuredDestinationOptions, buildCountryCityOptions, clearCountryCityOptionsCache } from "../src/lib/ai/country-city-options.ts";
import { localizeCombinationThemeTitle } from "../src/lib/ai/combination-theme-titles.ts";
import { encodeGeneratedChatContent, decodeGeneratedChatContent, isCurrentGeneratedCopy } from "../src/lib/generated-locale.ts";
import { restoreAssistantChatMessage } from "../src/lib/chat-history.ts";
import { extractPlacesFromChat, itinerarySourceForLocale } from "../src/lib/itinerary-source.ts";
import { normalizeStoredItinerary } from "../src/lib/itinerary-storage.ts";
import { toCoreTrip, resolveCoreTripTitle } from "../src/lib/trip/core-trip.ts";
import { chatSessionForLocale, createEmptySession } from "../src/lib/chat-session.ts";
import { dailyOutfitDisplay } from "../src/lib/outfit/localized-outfit-copy.ts";
import { buildLocalTripOutfitFallback } from "../src/lib/outfit/local-trip-outfit-fallback.ts";

const locales = ["zh-TW", "en", "ja", "ko"];
const baseline = JSON.parse(fs.readFileSync("docs/audits/phase2-reachability.json", "utf8"));
const oldSummaries = baseline.items.filter((r) => r.file.endsWith("country-city-options.ts") && r.category === "B");
const oldThemes = baseline.items.filter((r) => r.file.endsWith("destination-travel-profile.ts") && r.category === "B");
assert.equal(oldSummaries.length, 175);
assert.equal(oldThemes.length, 78);
const original = structuredDestinationOptions("zh-TW");
assert.deepEqual(original.map((x) => x.summary), oldSummaries.map((x) => x.text));
const identities = (rows) => rows.map(({ name, country, type }) => ({ name, country, type }));
for (const locale of locales) {
  const options = structuredDestinationOptions(locale);
  assert.equal(options.length, 175);
  assert.deepEqual(identities(options), identities(original));
  assert.deepEqual(Object.keys(destinationEditorialMessages[locale]), Object.keys(destinationEditorialMessages["zh-TW"]));
  for (const [key, value] of Object.entries(destinationEditorialMessages[locale])) {
    assert.ok(value.trim());
    assert.equal(translate(locale, `destinationEditorial.${key}`), value);
    assert.deepEqual([...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), [...destinationEditorialMessages["zh-TW"][key].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    if (["en", "ko"].includes(locale)) assert.doesNotMatch(value, /\p{Script=Han}/u);
  }
  for (const [i, option] of options.entries()) {
    if (locale !== "zh-TW") assert.notEqual(option.summary, original[i].summary);
  }
  for (const row of oldThemes) {
    const title = localizeCombinationThemeTitle(row.text, locale);
    assert.ok(title.trim());
    if (locale === "zh-TW") assert.equal(title, row.text);
    else assert.notEqual(title, row.text, `${locale}: ${row.text}`);
  }
}
clearCountryCityOptionsCache();
const zh = buildCountryCityOptions({ country: "日本", language: "zh-TW" });
const ja = buildCountryCityOptions({ country: "日本", language: "ja" });
assert.equal(ja.valid, true);
assert.deepEqual(identities(zh.options), identities(ja.options));
assert.notDeepEqual(zh.options.map((x) => x.summary), ja.options.map((x) => x.summary));
assert.deepEqual(buildCountryCityOptions({ country: "日本", language: "ja" }).options, ja.options);
const place = { name: "使用者原本選的地點", placeName: "Official Name", googlePlaceId: "keep-id", type: "cafe", description: "舊中文描述", reason: "舊中文推薦理由", estimatedTime: "一小時", address: "External address", lat: 25, lng: 121, googleMapsUrl: "https://maps.example/", notes: "使用者的 note" };
const response = { title: "舊生成標題", summary: "舊繁中回覆", moodTag: "散步", recommendations: [place], itinerary: [], generatedLocale: "zh-TW" };
for (const locale of locales) {
  const encoded = encodeGeneratedChatContent(JSON.stringify({ ...response, generatedLocale: locale }), locale);
  const restored = restoreAssistantChatMessage(encoded);
  assert.equal(restored.generatedLocale, locale);
  assert.equal(restored.roamie.generatedLocale, locale);
  assert.equal(restored.content, response.summary);
  assert.deepEqual(JSON.parse(decodeGeneratedChatContent(encoded).content), { ...response, generatedLocale: locale });
}
const legacyPlain = restoreAssistantChatMessage("舊的歷史對話");
assert.equal(legacyPlain.content, "舊的歷史對話");
assert.equal(legacyPlain.generatedLocale, undefined);
const { generatedLocale: _legacyLocale, ...legacyResponse } = response;
const legacyJson = restoreAssistantChatMessage(JSON.stringify(legacyResponse));
assert.equal(legacyJson.generatedLocale, undefined, "Do not infer provenance from old unversioned records");
assert.equal(legacyJson.content, response.summary);
const historical = restoreAssistantChatMessage(encodeGeneratedChatContent(JSON.stringify(response), "zh-TW"));
const projected = extractPlacesFromChat([historical], "ja");
assert.notEqual(projected[0].reason, place.reason);
assert.equal(projected[0].name, historical.roamie.recommendations[0].name);
assert.equal(projected[0].googlePlaceId, place.googlePlaceId);
assert.equal(projected[0].notes, historical.roamie.recommendations[0].notes);
assert.equal(historical.content, response.summary);
const source = { source: "chat", selectedPlaces: [place], summary: response.summary, generatedLocale: "zh-TW", savedAt: "2026-01-01" };
assert.equal(itinerarySourceForLocale(source, "ja").summary, undefined);
assert.equal(itinerarySourceForLocale(source, "zh-TW"), source);
const session = { ...createEmptySession(), generatedLocale: "zh-TW", lastAssistantReply: response.summary, conversationSummary: response.summary, recommendedPlaces: [place], selectedPlaces: [place] };
const sessionView = chatSessionForLocale(session, "ja");
assert.equal(sessionView.lastAssistantReply, undefined);
assert.equal(sessionView.selectedPlaces[0].googlePlaceId, place.googlePlaceId);
assert.equal(session.lastAssistantReply, response.summary);
const payload = { ...response, version: 2, destination: "Tokyo", days: 3, itinerary: [{ date: "2026-10-01", time: "09:00", placeName: "Official Name", title: "Official Name", description: "舊行程描述", notes: "使用者自己的筆記", lat: 25, lng: 121, googlePlaceId: "keep-id", order: 2 }] };
const row = { id: "trip-1", title: response.title, created_at: "2026-01-01", payload };
for (const generatedLocale of ["zh-TW", undefined]) {
  const saved = normalizeStoredItinerary({ ...row, payload: { ...payload, generatedLocale } });
  assert.ok(saved);
  const roundTrip = normalizeStoredItinerary(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(roundTrip.payload.itinerary, payload.itinerary);
  assert.equal(roundTrip.payload.generatedLocale, generatedLocale);
  const core = toCoreTrip(roundTrip);
  assert.equal(resolveCoreTripTitle(core, "ja"), "Tokyo · 3日間の旅");
  assert.equal(resolveCoreTripTitle({ ...core, isTitleCustomized: true, customTitle: "我的自訂旅行" }, "ja"), "我的自訂旅行");
}
const day = { date: "2026-10-01", dayIndex: 1, weather: { tempHighC: 30, tempLowC: 23, precipProbability: 80, diurnalRangeC: 7, condition: "舊中文天氣" }, activityTypes: ["city"], outfitSummary: "舊中文穿搭", narrative: "舊中文說明", packingReminders: ["舊提醒"], generatedLocale: "zh-TW" };
for (const locale of locales) {
  const view = dailyOutfitDisplay(day, locale);
  assert.equal(view.weather.tempHighC, day.weather.tempHighC);
  if (locale !== "zh-TW") assert.notEqual(view.narrative, day.narrative);
  const fallback = buildLocalTripOutfitFallback({ locale, destination: "Tokyo", startDate: "2026-10-01", endDate: "2026-10-02", items: [], inputKey: `${locale}|trip` });
  assert.ok(isCurrentGeneratedCopy(fallback.outfitCopy, locale));
}
assert.equal(dailyOutfitDisplay({ ...day, generatedLocale: undefined }, "ja").weather.condition, "");
for (const file of ["src/routes/api/chat.ts", "src/routes/api/roamie.ts"]) {
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /encodeGeneratedChatContent\(raw.trim\(\), ctx.locale \?\? "zh-TW"\)/);
}
const hook = fs.readFileSync("src/hooks/use-trip-outfit-suggestion.ts", "utf8");
assert.match(hook, /`\$\{locale\}\|\$\{buildOutfitInputKey/);
assert.match(hook, /if \(cancelled\) return;/);
assert.match(hook, /isCurrentGeneratedCopy\(outfitFields.outfitCopy/);
console.log("PASS: 175 summaries × 4, 78 titles × 4, Chat persistence/legacy/history vs reuse, saved trip identity/user notes/legacy, locale-switch cache and outfit projection");

for (const locale of ["en", "ja", "ko"]) {
  const enriched = localizedAvailabilityCopy({ ...place, reason: "AI", closingSoonNote: "舊中文打烊提醒", todayHoursLabel: "舊中文營業時間" }, locale, "closing_soon");
  assert.ok(enriched.reason.startsWith("AI"));
  assert.ok(!enriched.reason.includes("舊中文"));
  assert.equal(enriched.name, place.name);
  assert.equal(enriched.todayHoursLabel, "");
}
