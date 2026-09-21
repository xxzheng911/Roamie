/**
 * Recommendation badge semantic selection.
 * Badge answers what the batch is. Quiet stays a ranking/reason modifier.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatMoodDisplay } from "../src/lib/chat-runtime-copy.ts";
import { chatRuntimeMessages } from "../src/lib/i18n/chat-runtime.ts";
import {
  classifyRecommendationBadgeToken,
  projectRecommendationBadge,
  recommendationBadgeInventory,
  resolveDisplayedRecommendationBadge,
  resolveRecommendationDisplayBadge,
} from "../src/lib/ai/recommendation-badge-display.ts";
import {
  applyQuickChipContext,
  moodLabelForShortcutMode,
  resolveChatShortcutContext,
  resolveNormalizedShortcutRequestFromText,
} from "../src/lib/ai/chat-intent.ts";
import { chatShortcutContract } from "../src/lib/chat-shortcut-chips.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { resolvePresentableMoodTag } from "../src/lib/ai/mood-presentation.ts";
import { resolveRecommendationStyleTag } from "../src/lib/ai/resolve-recommendation-style-tag.ts";
import {
  nearbySearchAttemptsForShortcutScene,
  rankPlacesForShortcutScene,
} from "../src/lib/ai/nearby-shortcut-ranking.ts";
import { SHORTCUT_PROVIDER_CALL_BUDGET } from "../src/lib/ai/chat-place-recommendation.ts";
import { tripStyleDisplayTag, TRIP_STYLE_OPTIONS } from "../src/lib/ai/ai-trip-style.ts";
import { assignDiversePlaceReasons } from "../src/lib/place-reason-diversity.ts";
import { buildTripAddPlaceChatMessage } from "../src/lib/trip/trip-add-place-render.ts";
import { buildHandoffRoamiePayload } from "../src/lib/mood-chat-handoff.ts";

const locales = ["zh-TW", "en", "ja", "ko"];
const quietCafeRouting = "想找安靜的咖啡廳";

const contract = chatShortcutContract(quietCafeRouting, "en");
assert.equal(contract.canonicalIntent, "quiet_cafe");
assert.equal(contract.routingPayload, quietCafeRouting);
assert.equal(contract.displayMessage, "Find a quiet café");

const normalized = resolveNormalizedShortcutRequestFromText(quietCafeRouting, "chat_shortcut");
assert.equal(normalized.mode, "coffee");
assert.equal(normalized.intent, "nearby_recommendation");
assert.equal(normalized.modifiers.quiet, true);
assert.equal(normalized.structured, true);

const shortcut = resolveChatShortcutContext(quietCafeRouting);
assert.equal(shortcut.scene, "quiet_cafe");
assert.equal(shortcut.categoryIntent, "cafe");
assert.equal(shortcut.mood, "quiet");

const session = applyQuickChipContext(quietCafeRouting, createEmptySession());
assert.equal(session.mood, "安靜");
assert.equal(session.selectedMood, "安靜");
assert.equal(session.activeChatIntent, "cafe");
assert.equal(session.normalizedShortcutRequest.modifiers.quiet, true);
const homeHandoff = buildHandoffRoamiePayload(session, "summary");
assert.equal(homeHandoff.moodTag, "咖啡");
assert.equal(session.mood, "安靜");
assert.equal(session.normalizedShortcutRequest.modifiers.quiet, true);

const quietContext = {
  interests: ["咖啡", "安靜"],
  mood: "安靜",
  moodEvidenceSource: "HOME_MOOD_ENTRY",
  tripPurpose: "cafe",
  setting: "室內",
};
assert.equal(resolvePresentableMoodTag(undefined, quietContext), "安靜");
assert.equal(
  resolveRecommendationDisplayBadge({
    primaryCategory: "cafe",
    intent: "cafe",
    recommendationFamily: "quiet_cafe",
    mood: "安靜",
    contextModifier: "quiet",
  }),
  "cafe",
);
assert.equal(
  resolveDisplayedRecommendationBadge({
    session,
    context: quietContext,
    intent: "cafe",
    shortcutScene: "quiet_cafe",
    moodTag: "安靜",
  }),
  "咖啡",
);
assert.equal(chatMoodDisplay("安靜", "en"), "Quiet");
assert.notEqual(chatMoodDisplay("安靜", "en"), chatMoodDisplay("咖啡", "en"));

const expected = { "zh-TW": "咖啡", en: "Café", ja: "カフェ", ko: "카페" };
for (const locale of locales) {
  assert.equal(chatMoodDisplay("咖啡", locale), expected[locale], locale);
  assert.equal(projectRecommendationBadge("cafe", locale), expected[locale], locale);
  assert.equal(chatMoodDisplay("安靜", locale) !== expected[locale], true);
}

const attempts = nearbySearchAttemptsForShortcutScene("quiet_cafe");
assert.equal(attempts[0].query, "安靜 咖啡廳 specialty coffee");
assert.deepEqual(attempts[0].includedTypes, ["cafe", "coffee_shop"]);
assert.equal(SHORTCUT_PROVIDER_CALL_BUDGET, 4);
const placesGuard = readFileSync("src/lib/places-api-guard.ts", "utf8");
assert.match(placesGuard, /const RATE_MAX_CALLS = 20;/);
assert.match(placesGuard, /const MAX_CONCURRENT = 2;/);

const ranked = rankPlacesForShortcutScene(
  [
    {
      id: "park",
      name: "Park",
      primaryType: "park",
      types: ["park"],
      rating: 5,
      userRatingCount: 500,
    },
    {
      id: "cafe",
      name: "Cafe",
      primaryType: "cafe",
      types: ["cafe"],
      rating: 4.2,
      userRatingCount: 40,
    },
  ],
  "quiet_cafe",
);
assert.equal(ranked[0].id, "cafe");

const reasonPlace = {
  id: "cafe-1",
  name: "Cafe",
  address: "台北市",
  lat: 25.03,
  lng: 121.54,
  rating: 4.4,
  userRatingCount: 80,
  primaryType: "cafe",
  types: ["cafe"],
  businessStatus: "OPERATIONAL",
};
const reasonContext = {
  mood: "安靜",
  preferenceEvidenceSource: "HOME_MOOD_ENTRY",
  categoryIntent: "cafe",
};
const [withoutQuietEvidence] = assignDiversePlaceReasons(
  [{ place: reasonPlace, context: reasonContext }],
  { locale: "en" },
);
assert.notEqual(withoutQuietEvidence.evidenceCode, "coffee_quiet_ambience");
assert.doesNotMatch(withoutQuietEvidence.reason, /quieter|安靜/);
const [withQuietEvidence] = assignDiversePlaceReasons(
  [{ place: { ...reasonPlace, reasonClaimEvidence: ["quiet_ambience"] }, context: reasonContext }],
  { locale: "en" },
);
assert.equal(withQuietEvidence.evidenceCode, "coffee_quiet_ambience");
assert.match(withQuietEvidence.reason, /quieter/);
const recommendationSource = readFileSync("src/lib/ai/chat-place-recommendation.ts", "utf8");
assert.match(recommendationSource, /mood: context\.mood/);
assert.match(recommendationSource, /resolveDisplayedRecommendationBadge/);

const compounds = [
  {
    name: "quiet café",
    input: {
      primaryCategory: "cafe",
      mood: "安靜",
      contextModifier: "quiet",
      recommendationFamily: "quiet_cafe",
      intent: "cafe",
    },
    key: "cafe",
  },
  {
    name: "relaxing walk",
    input: {
      primaryCategory: "attraction",
      mood: "放鬆",
      recommendationFamily: "relax_walk",
      intent: "attraction",
    },
    key: "relax",
  },
  {
    name: "rainy day",
    input: {
      primaryCategory: "attraction",
      mood: "下雨天",
      recommendationFamily: "rainy_indoor",
      intent: "attraction",
    },
    key: "rainy",
  },
  {
    name: "late night walk",
    input: {
      primaryCategory: "attraction",
      mood: "深夜散步",
      recommendationFamily: "late_night",
      intent: "attraction",
    },
    key: "night_walk",
  },
  {
    name: "sea",
    input: {
      primaryCategory: "attraction",
      mood: "看海",
      recommendationFamily: "home_sea",
      intent: "attraction",
    },
    key: "sea",
  },
  {
    name: "solo",
    input: { primaryCategory: "place", mood: "一個人", intent: "attraction" },
    key: "solo",
  },
  {
    name: "food",
    input: { primaryCategory: "restaurant", intent: "restaurant", mood: "放鬆" },
    key: "food",
  },
  {
    name: "plain café",
    input: { primaryCategory: "cafe", intent: "cafe", mood: "咖啡" },
    key: "cafe",
  },
  {
    name: "home find coffee",
    input: {
      primaryCategory: "cafe",
      intent: "cafe",
      mood: "找咖啡",
      recommendationFamily: "quiet_cafe",
    },
    key: "coffee_stop",
  },
  {
    name: "night view",
    input: { primaryCategory: "night", mood: "夜景" },
    key: "night",
  },
  {
    name: "shopping",
    input: { primaryCategory: "shopping", mood: "探索" },
    key: "shopping",
  },
  {
    name: "family",
    input: { mood: "親子" },
    key: "family",
  },
  {
    name: "outdoor",
    input: { mood: "戶外" },
    key: "outdoor",
  },
  {
    name: "culture",
    input: { mood: "文化" },
    key: "culture",
  },
  {
    name: "classic landmark",
    input: {
      recommendationFamily: "classic_landmarks",
      mood: "放鬆",
      primaryCategory: "attraction",
    },
    key: "classic",
  },
  {
    name: "local life",
    input: { recommendationFamily: "local_life", primaryCategory: "attraction" },
    key: "local",
  },
  {
    name: "slow wandering",
    input: { mood: "慢步調散策", primaryCategory: "attraction" },
    key: "slow",
  },
  {
    name: "slow travel",
    input: { mood: "慢旅行", primaryCategory: "cafe", contextModifier: "quiet" },
    key: "slow_travel",
  },
  {
    name: "roamie mix",
    input: { mood: "Roamie混搭", primaryCategory: "attraction" },
    key: "mixed",
  },
];
for (const compound of compounds) {
  assert.equal(resolveRecommendationDisplayBadge(compound.input), compound.key, compound.name);
}

assert.equal(chatMoodDisplay("夜景", "en"), "Night views");
assert.equal(chatMoodDisplay("美食", "en"), "Food");
assert.equal(chatMoodDisplay("慢旅行", "en"), "Slow travel");
assert.equal(chatMoodDisplay("Roamie混搭", "en"), "Roamie mix");
assert.equal(chatMoodDisplay("放鬆", "en"), "Relax");
assert.equal(chatMoodDisplay("下雨天", "en"), "Rainy day");

const homeUnwind = {
  interests: [],
  mood: "想放空",
  moodEvidenceSource: "HOME_MOOD_ENTRY",
};
const unwindSession = {
  ...createEmptySession(),
  homeMoodShortcutEntry: true,
  fromMoodFlow: true,
  selectedMood: "想放空",
  mood: "想放空",
  travelContext: homeUnwind,
};
assert.equal(resolveRecommendationStyleTag(unwindSession, homeUnwind), "想放空");
assert.equal(
  resolveDisplayedRecommendationBadge({
    session: {
      ...createEmptySession(),
      mood: "找咖啡",
      selectedMood: "找咖啡",
      activeChatIntent: "cafe",
      shortcutContext: shortcut,
    },
    moodTag: "找咖啡",
  }),
  "找咖啡",
);

const handoff = buildTripAddPlaceChatMessage({
  summary: "opening",
  recommendations: [],
  moodTag: "慢旅行",
  session: createEmptySession(),
});
assert.equal(handoff.roamie.moodTag, "慢旅行");
assert.equal(chatMoodDisplay(handoff.roamie.moodTag, "en"), "Slow travel");

assert.equal(chatMoodDisplay("Official custom label", "en"), "Official custom label");
assert.equal(chatMoodDisplay("美食咖啡", "en"), "");
assert.equal(chatMoodDisplay("quiet_cafe", "en"), "");
assert.equal(chatMoodDisplay("attraction", "ja"), "");

const inventory = recommendationBadgeInventory();
const displayable = inventory.filter((item) => item.displayable);
assert.ok(displayable.length >= 22);
for (const semantic of displayable) {
  for (const locale of locales) {
    const label = projectRecommendationBadge(semantic.key, locale);
    assert.ok(label.trim(), `${semantic.key} ${locale}`);
    assert.equal(chatRuntimeMessages[locale][`badge_${semantic.key}`], label);
  }
  for (const alias of semantic.aliases) {
    assert.equal(classifyRecommendationBadgeToken(alias)?.key, semantic.key, alias);
  }
}
for (const semantic of inventory.filter((item) => !item.displayable)) {
  for (const alias of semantic.aliases) {
    assert.equal(chatMoodDisplay(alias, "en"), "", alias);
    const resolved = resolveRecommendationDisplayBadge({ mood: alias });
    if (resolved) {
      assert.ok(
        displayable.some((item) => item.key === resolved),
        `${alias} resolved to non-display ${resolved}`,
      );
    }
  }
}

const productionTokens = [
  "放鬆",
  "安靜",
  "探索",
  "拍照",
  "美食",
  "咖啡",
  "夜景",
  "購物",
  "親子",
  "戶外",
  "文化",
  "想放空",
  "一個人",
  "下雨天",
  "深夜散步",
  "找咖啡",
  "看海",
  "經典地標",
  "在地生活",
  "慢步調散策",
  "慢旅行",
  "Roamie混搭",
  "Roamie 混搭",
  ...["coffee", "rainy", "relax", "late_night", "sea"].map((mode) =>
    moodLabelForShortcutMode(mode),
  ),
  ...TRIP_STYLE_OPTIONS.map((option) => tripStyleDisplayTag(option.key)),
];
for (const token of productionTokens) {
  const classified = classifyRecommendationBadgeToken(token);
  assert.ok(classified, `unclassified production token ${token}`);
  if (classified.displayable) {
    for (const locale of locales) assert.ok(projectRecommendationBadge(classified.key, locale));
  }
}

const surfaces = [
  "src/lib/ai/chat-place-recommendation.ts",
  "src/lib/ai/resolve-recommendation-style-tag.ts",
  "src/lib/ai/local-recommendation-fallback.ts",
  "src/lib/ai/chat-destination-category-recommendation.ts",
  "src/lib/ai/destination-place-recommendation.ts",
  "src/lib/trip/trip-add-place-render.ts",
  "src/routes/_app.chat.tsx",
  "src/components/RoamieResponseView.tsx",
];
for (const surface of surfaces) {
  const source = readFileSync(surface, "utf8");
  if (surface.endsWith("RoamieResponseView.tsx")) {
    assert.match(source, /chatMoodDisplay\(data\.moodTag, locale\)/);
  } else {
    assert.match(source, /resolveDisplayedRecommendationBadge/);
  }
}

console.log(
  `PASS recommendation badge display: ${displayable.length} displayable semantics, quiet café badge is café`,
);
