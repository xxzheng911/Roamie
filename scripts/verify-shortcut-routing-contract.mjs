import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beginHomeMoodShortcutSession } from "../src/lib/home-mood-shortcut-session.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import {
  applyQuickChipContext,
  resolveNearbyShortcutScene,
  resolveNormalizedShortcutRequestFromText,
} from "../src/lib/ai/chat-intent.ts";
import { resolveChatIntentArbitration } from "../src/lib/ai/recommendation-refinement/arbitrate.ts";
import {
  collectExcludePlaceIds,
  resolveRefreshNearbyIntent,
  shouldRefetchPlaces,
} from "../src/lib/ai/chat-recommendation-refresh.ts";
import { syncSessionPlaceMemory } from "../src/lib/place-planning-memory.ts";
import {
  exactCanonicalIdentityMatch,
  filterExactExcludedPlaceIdentities,
  filterExactPreviouslyRecommendedPlaces,
} from "../src/lib/place-planning-memory.ts";
import { ensureActiveRecommendationContext } from "../src/lib/ai/recommendation-refinement/session.ts";
import { resolveNearbyRecommendationScope } from "../src/lib/ai/resolve-chat-location.ts";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";
import { filterRecommendationItemsForDisplay } from "../src/lib/recommend-place-ranking.ts";

function withNearbyLocation(session) {
  return {
    ...session,
    location: { lat: 25.03, lng: 121.56, city: "台北" },
    travelContext: { ...(session.travelContext ?? { interests: [] }), interests: [] },
  };
}

// Relax/Rainy structured continuations are provider-backed nearby cards. Their
// display pass uses chat_nearby identity/category safety, not GENERAL AI's
// review threshold a second time. Coffee remains on its existing category path.
{
  const lowReviewIndoor = Array.from({ length: 5 }, (_, index) => ({
    name: `Museum ${index}`,
    placeName: `Museum ${index}`,
    type: "museum",
    primaryType: "museum",
    types: ["museum", "tourist_attraction"],
    description: "Nearby",
    reason: "Nearby",
    estimatedTime: "1 hour",
    address: "Kaohsiung",
    lat: 22.63 + index / 1000,
    lng: 120.3 + index / 1000,
    googleMapsUrl: "",
    googlePlaceId: `ChIJDisplay${index}`,
    rating: 4.1,
    userRatingCount: 3,
    placeName: `Museum ${index}`,
    reasonSource: "template",
  }));
  assert.equal(
    filterRecommendationItemsForDisplay(lowReviewIndoor).length,
    0,
    "ai_recommend policy reproduces the former second quality rejection",
  );
  for (const scene of ["relax_walk", "rainy_indoor"]) {
    const session = withNearbyLocation({
      ...createEmptySession(),
      activeChatIntent: "attraction",
      normalizedShortcutRequest: {
        source: "chat_shortcut",
        intent: "nearby_recommendation",
        mode: scene === "rainy_indoor" ? "rainy" : "relax",
        structured: true,
      },
      activeRecommendationContext: {
        ...ensureActiveRecommendationContext(createEmptySession(), {
          destination: "附近",
          intent: "attraction",
          places: [{ placeId: "ChIJPrevious", name: "Previous" }],
          searchScope: "current_location",
          shortcutScene: scene,
        }),
      },
    });
    assert.equal(
      recommendationsForChatDisplay(session, "還有嗎", lowReviewIndoor).length,
      5,
      `${scene} continuation must preserve five scene-approved nearby cards`,
    );
  }
}

// Structured continuation keeps one canonical exact-ID exclusion boundary.
// A namespaced key must match directly (never become `id:google:...`), while
// unrelated Relax/Coffee/Rainy candidates survive for ranking and display.
{
  const previous = Array.from({ length: 5 }, (_, index) => ({
    id: `ChIJPrevious${index}`,
    name: `Previous ${index}`,
  }));
  const previousKeys = previous.map((place) => `google:${place.id}`);
  for (const candidateCount of [27, 33, 23]) {
    const newCandidates = Array.from({ length: candidateCount }, (_, index) => ({
      id: `ChIJNew${candidateCount}_${index}`,
      name: `New ${candidateCount}-${index}`,
    }));
    const filtered = filterExactExcludedPlaceIdentities(
      [...previous, ...newCandidates],
      previousKeys,
    );
    assert.equal(filtered.length, candidateCount);
    assert(filtered.every((place) => !previous.some((old) => old.id === place.id)));
  }
}

// Structured continuation dedupe is exact identity only: five previous IDs cannot
// erase unrelated candidates through generic/missing or fuzzy-name identities.
{
  const previous = [
    { id: "ChIJPreviousOne", name: "市立美術館" },
    { id: "ChIJPreviousTwo", name: "中央博物館" },
  ];
  const candidates = [
    { id: "ChIJPreviousOne", name: "市立美術館" },
    { id: "ChIJNewMuseumOne", name: "臻融美術館" },
    { id: "ChIJNewMuseumTwo", name: "兒童美術館" },
  ];
  const filtered = filterExactPreviouslyRecommendedPlaces(candidates, previous);
  assert.deepEqual(filtered.map((place) => place.id), ["ChIJNewMuseumOne", "ChIJNewMuseumTwo"]);
  assert.equal(exactCanonicalIdentityMatch({ name: "" }, { name: "" }), null);
}

// 1-5 Home shortcut normalization
{
  const cases = [
    ["想放空", "relax", "attraction"],
    ["深夜散步", "late_night", "attraction"],
    ["看海", "sea", "attraction"],
    ["找咖啡", "coffee", "cafe"],
    ["下雨天", "rainy", "attraction"],
  ];
  for (const [label, mode, intent] of cases) {
    const home = beginHomeMoodShortcutSession(createEmptySession(), label, {
      想放空: "relax",
      深夜散步: "lateNight",
      看海: "sea",
      找咖啡: "coffee",
      下雨天: "rainy",
    }[label]);
    assert.equal(home.normalizedShortcutRequest?.mode, mode);
    assert.equal(home.activeChatIntent, intent);
  }
}

// 6-8 Chat shortcut normalization + arbitration precedence
{
  const chatCases = [
    ["今天想放鬆走走", "relax", "NEW_RECOMMENDATION"],
    ["想找安靜的咖啡廳", "coffee", "NEW_RECOMMENDATION"],
    ["下雨天可以去哪", "rainy", "NEW_RECOMMENDATION"],
  ];
  for (const [text, mode, expectedRoute] of chatCases) {
    const normalized = resolveNormalizedShortcutRequestFromText(text, "chat_shortcut");
    assert.equal(normalized?.mode, mode);
    const session = withNearbyLocation({
      ...applyQuickChipContext(text, createEmptySession()),
      normalizedShortcutRequest: normalized,
    });
    const route = resolveChatIntentArbitration(text, session);
    assert.equal(route.route, expectedRoute);
    assert.notEqual(route.route, "NEW_TRIP_PLANNING");
  }
}

// 9 continuation supports multi-round exclusion accumulation
{
  let session = withNearbyLocation({
    ...createEmptySession(),
    activeChatIntent: "attraction",
    normalizedShortcutRequest: {
      source: "chat_shortcut",
      intent: "nearby_recommendation",
      mode: "relax",
      structured: true,
    },
  });

  session = {
    ...session,
    activeRecommendationContext: ensureActiveRecommendationContext(session, {
      destination: "附近",
      intent: "attraction",
      places: [{ placeId: "a", name: "A" }, { placeId: "b", name: "B" }],
      searchScope: "current_location",
      shortcutScene: "relax_walk",
    }),
  };
  session = syncSessionPlaceMemory({
    ...session,
    recommendedPlaces: [
      { placeId: "a", name: "A" },
      { placeId: "b", name: "B" },
    ],
  });
  session = syncSessionPlaceMemory({
    ...session,
    recommendedPlaces: [
      { placeId: "d", name: "D" },
      { placeId: "e", name: "E" },
    ],
  });
  const excludeIds = collectExcludePlaceIds(session);
  assert.equal(resolveChatIntentArbitration("還有嗎", session).route, "MORE_RECOMMENDATIONS");
  assert.equal(session.activeRecommendationContext?.intent, "attraction");
  assert.equal(session.activeRecommendationContext?.shortcutScene, "relax_walk");
  assert.equal(session.activeRecommendationContext?.searchScope, "current_location");
  assert.equal(resolveNearbyShortcutScene("還有嗎", session), "relax_walk");
  assert.equal(resolveRefreshNearbyIntent(session, session.travelContext), "attraction");
  assert(excludeIds.some((id) => id.includes("a")), "exclusions keep batch-1");
  assert(excludeIds.some((id) => id.includes("d")), "exclusions append batch-2");
}

// 10 generic nearby continuation still refetches (not shortcut-only)
{
  const session = withNearbyLocation({
    ...createEmptySession(),
    activeChatIntent: "restaurant",
    recommendedPlaces: [{ placeId: "r1", name: "R1" }],
  });
  assert(shouldRefetchPlaces("有其他的嗎", session, session.travelContext));
  assert.equal(resolveRefreshNearbyIntent(session, session.travelContext), "restaurant");
}

// Guard: chat chips must pass shortcut source metadata.
{
  const chatSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
  assert.match(chatSource, /onChipSend=\{\(s\) => void send\(s, \{ source: "chat_shortcut" \}\)\}/);
}

// First-turn structured nearby must wait for effective location at send.refinement.route
// then re-resolve scope before pushNearbyPlaceRecommendation — never no_more.
{
  const empty = createEmptySession();
  const none = resolveNearbyRecommendationScope(empty);
  assert.equal(none.scope, "none");
  assert.equal(none.deviceLocationAvailable, false);

  const current = resolveNearbyRecommendationScope(withNearbyLocation(empty));
  assert.equal(current.scope, "current_location");
  assert.equal(current.deviceLocationAvailable, true);
  assert.equal(current.deviceLocationUsed, true);

  const dest = resolveNearbyRecommendationScope(withNearbyLocation(empty), "台北");
  assert.equal(dest.scope, "destination");
  assert.equal(dest.deviceLocationUsed, false);

  const rainyWithLeftoverDest = resolveNearbyRecommendationScope(
    {
      ...withNearbyLocation(empty),
      normalizedShortcutRequest: {
        source: "chat_shortcut",
        intent: "nearby_recommendation",
        mode: "rainy",
        structured: true,
      },
      travelContext: { interests: [], destination: "東京" },
    },
    "東京",
  );
  assert.equal(rainyWithLeftoverDest.scope, "current_location");
  assert.equal(rainyWithLeftoverDest.hasExplicitDestination, false);

  const chatSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
  assert.match(
    chatSource,
    /structuredNearbyShortcut[\s\S]*resolveChatLocation[\s\S]*resolveNearbyRecommendationScope[\s\S]*RT_NEARBY_PUSH_CALL[\s\S]*pushNearbyPlaceRecommendation/,
    "send.refinement.route must await location, re-resolve scope, then call nearby push",
  );
  assert.match(
    chatSource,
    /firstTurnNewRecommendation[\s\S]*destination_clarification[\s\S]*home\.nearbySlowEmpty/,
    "first-turn NEW_RECOMMENDATION must not fall through to no_more",
  );
  const refinementIdx = chatSource.indexOf('caller: "send.refinement.route"');
  const firstTurnIdx = chatSource.indexOf("firstTurnNewRecommendation");
  assert.ok(
    firstTurnIdx >= 0 && firstTurnIdx < refinementIdx,
    "first-turn guard must precede nearby_push_failed no_more",
  );
  assert.match(
    chatSource,
    /isCurrentLocationShortcutSession[\s\S]*pushNearbyPlaceRecommendation[\s\S]*send\.refetch\.structured_nearby_continuation/,
    "structured shortcut continuation must fetch nearby before exhausted/no-more",
  );
  for (const tag of [
    "RT_CONTINUATION_INPUT",
    "RT_CONTINUATION_CONTEXT",
    "RT_CONTINUATION_FETCH",
    "RT_CONTINUATION_RESULT",
    "RT_CONTINUATION_BRANCH",
    "RT_REFINEMENT_COPY",
    "RT_CONTINUATION_SEARCH_ATTEMPT",
    "RT_CONTINUATION_SEARCH_SUMMARY",
    "RT_CONTINUATION_EXCLUSIONS",
    "RT_CONTINUATION_CANDIDATE_IDENTITY",
    "RT_CONTINUATION_HANDOFF",
    "RT_CONTINUATION_STAGE",
    "RT_CONTINUATION_DROP",
    "RT_PLACE_ENRICHMENT",
  ]) {
    const diagnosticSources =
      chatSource +
      readFileSync(new URL("../src/lib/ai/recommendation-exclusion.ts", import.meta.url), "utf8") +
      readFileSync(new URL("../src/lib/ai/shortcut-runtime-diag.ts", import.meta.url), "utf8") +
      readFileSync(new URL("../src/lib/ai/chat-place-recommendation.ts", import.meta.url), "utf8") +
      readFileSync(new URL("../src/lib/place-planning-memory.ts", import.meta.url), "utf8");
    assert.match(diagnosticSources, new RegExp(tag));
  }
  const displayStage = chatSource.indexOf('stage: "before_display_policy"');
  const memoryCommit = chatSource.indexOf("const sessionWithCommittedNearbyContext");
  assert.ok(displayStage >= 0 && memoryCommit > displayStage, "current IDs commit only after display");
}

console.log("verify-shortcut-routing-contract: ok");
