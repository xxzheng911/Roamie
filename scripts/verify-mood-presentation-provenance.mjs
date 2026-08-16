#!/usr/bin/env node
/**
 * Mood badge / 「依 XX 心情」copy is only for homepage mood entry.
 * CATEGORY_DERIVED routing labels such as 美食咖啡 must stay internal.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveMoodPresentationProvenance,
  resolvePresentableMoodTag,
  shouldDisplayMoodPresentation,
} from "../src/lib/ai/mood-presentation.ts";
import { resolveMoodEvidenceSource } from "../src/lib/ai/travel-context.ts";
import { resolveRecommendationStyleTag } from "../src/lib/ai/resolve-recommendation-style-tag.ts";
import { generateLocalRecommendationFallback } from "../src/lib/ai/local-recommendation-fallback.ts";
import { buildSummaryForRecommendations } from "../src/lib/ai/chat-place-recommendation.ts";

function baseSession(overrides = {}) {
  return {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
    travelContext: { interests: [] },
    ...overrides,
  };
}

{
  const ctx = {
    interests: [],
    mood: "美食咖啡",
    moodEvidenceSource: "CATEGORY_DERIVED",
  };
  const session = baseSession({ travelContext: ctx });
  assert.equal(resolveMoodEvidenceSource("東京澀谷有什麼咖啡廳推薦嗎", "美食咖啡"), "CATEGORY_DERIVED");
  assert.equal(resolveMoodPresentationProvenance(session, ctx), "CATEGORY_DERIVED");
  assert.equal(shouldDisplayMoodPresentation(session, ctx), false);
  assert.equal(resolvePresentableMoodTag(session, ctx), "");
  assert.equal(resolveRecommendationStyleTag(session, ctx), "");
  const fallback = generateLocalRecommendationFallback({
    context: ctx,
    session,
    places: [
      {
        id: "cafe-1",
        name: "Test Cafe",
        address: "東京都渋谷区",
        lat: 35.66,
        lng: 139.7,
        rating: 4.5,
        userRatingCount: 100,
        photoName: null,
        primaryType: "cafe",
        types: ["cafe"],
        businessStatus: "OPERATIONAL",
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
      },
    ],
  });
  assert.equal(fallback.payload.moodTag, "");
  assert.doesNotMatch(fallback.summary, /依「美食咖啡」的心情|依你的心情|美食咖啡/);
  console.log("  ✓ general cafe query does not present CATEGORY_DERIVED mood");
}

{
  const ctx = {
    interests: [],
    mood: "美食咖啡",
    moodEvidenceSource: "CATEGORY_DERIVED",
  };
  const session = baseSession({
    activeCategoryIntent: "restaurant",
    travelContext: ctx,
  });
  assert.equal(shouldDisplayMoodPresentation(session, ctx), false);
  assert.equal(resolvePresentableMoodTag(session, ctx), "");
  console.log("  ✓ general restaurant query does not present mood badge");
}

{
  const ctx = { interests: [], mood: "想放空", moodEvidenceSource: "HOME_MOOD_ENTRY" };
  const session = baseSession({
    homeMoodShortcutEntry: true,
    fromMoodFlow: true,
    fromMoodCard: true,
    selectedMood: "想放空",
    mood: "想放空",
    travelContext: ctx,
  });
  assert.equal(resolveMoodPresentationProvenance(session, ctx), "HOME_MOOD_ENTRY");
  assert.equal(shouldDisplayMoodPresentation(session, ctx), true);
  assert.equal(resolvePresentableMoodTag(session, ctx), "想放空");
  assert.equal(resolveRecommendationStyleTag(session, ctx), "想放空");
  const fallback = generateLocalRecommendationFallback({
    context: ctx,
    session,
    places: [
      {
        id: "park-1",
        name: "Park",
        address: "台北市大安區",
        lat: 25.03,
        lng: 121.56,
        rating: 4.4,
        userRatingCount: 80,
        photoName: null,
        primaryType: "park",
        types: ["park"],
        businessStatus: "OPERATIONAL",
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
      },
    ],
  });
  assert.equal(fallback.payload.moodTag, "想放空");
  assert.match(fallback.summary, /依「想放空」的心情/);
  console.log("  ✓ home 想放空 keeps mood badge and mood copy");
}

{
  const ctx = { interests: [], mood: "下雨天", moodEvidenceSource: "HOME_MOOD_ENTRY" };
  const session = baseSession({
    homeMoodShortcutEntry: true,
    fromMoodFlow: true,
    selectedMood: "下雨天",
    mood: "下雨天",
    travelContext: ctx,
  });
  assert.equal(shouldDisplayMoodPresentation(session, ctx), true);
  assert.equal(resolvePresentableMoodTag(session, ctx), "下雨天");
  console.log("  ✓ home 下雨天 keeps mood UI");
}

{
  const nearby = buildSummaryForRecommendations("attraction", [{ name: "Cafe A" }], {
    interests: [],
    mood: "美食咖啡",
    moodEvidenceSource: "CATEGORY_DERIVED",
  });
  assert.doesNotMatch(nearby, /依「美食咖啡」的心情|依你的心情/);
  console.log("  ✓ nearby summary does not use category-derived mood copy");
}

{
  const chatSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
  assert.match(
    chatSource,
    /pendingClarification/,
    "chat route still owns geographic clarification separately from mood presentation",
  );
  const moodSource = readFileSync(
    new URL("../src/lib/ai/mood-presentation.ts", import.meta.url),
    "utf8",
  );
  assert.match(moodSource, /HOME_MOOD_ENTRY/);
  assert.match(moodSource, /CATEGORY_DERIVED/);
  console.log("  ✓ mood provenance contract is explicit");
}

console.info("verify-mood-presentation-provenance: ok");
