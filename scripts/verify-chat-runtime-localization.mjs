import assert from "node:assert/strict";
import fs from "node:fs";
import { chatRuntimeMessages } from "../src/lib/i18n/chat-runtime.ts";
import { chatRuntimeCopy, chatMoodDisplay, chatLoadingCopy } from "../src/lib/chat-runtime-copy.ts";
import { buildDateAndDurationQuestionReply } from "../src/lib/ai/city-days-planning.ts";
import { buildAskTripDurationReply } from "../src/lib/ai/ai-trip-style.ts";
import { isAlternativeRecommendationOffer } from "../src/lib/ai/chat-recommendation-refresh.ts";
import { chatShortcutContract } from "../src/lib/chat-shortcut-chips.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { normalizeDestinationLabel } from "../src/lib/ai/trip-planning-context.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import { encodeGeneratedChatContent } from "../src/lib/generated-locale.ts";
import { restoreAssistantChatMessage } from "../src/lib/chat-history.ts";
import { extractKnownAliasDestination } from "../src/lib/ai/destination-locale-aliases.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
const locales = ["zh-TW", "en", "ja", "ko"];
const historical = restoreAssistantChatMessage(encodeGeneratedChatContent("既有歷史訊息", "zh-TW"));
const input = "I’d like to go to Kyoto";
assert.equal(extractKnownAliasDestination("凹子底森林公園"), undefined);
assert.equal(extractKnownAliasDestination("Heti Park"), undefined);
assert.equal(extractKnownAliasDestination("凹子底森林公園生態池"), undefined);
assert.equal(extractKnownAliasDestination(input)?.canonical, "京都");
assert.equal(extractKnownAliasDestination(input)?.surface, "Kyoto");
// Deterministic builder boundary after destination resolution; not a live AI parsing assertion.
const entity = resolveDestinationEntity("Kyoto");
const merged = { context: { interests: [], destination: entity.name } };
assert.match(entity.name, /京都|Kyoto/i);
const historyBefore = JSON.stringify(historical);
for (const locale of locales) {
  assert.deepEqual(
    Object.keys(chatRuntimeMessages[locale]),
    Object.keys(chatRuntimeMessages["zh-TW"]),
  );
  for (const [key, value] of Object.entries(chatRuntimeMessages[locale])) {
    assert.equal(chatRuntimeCopy(key, locale), value);
    assert.deepEqual(
      [...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
      [...chatRuntimeMessages["zh-TW"][key].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
    );
    if (locale === "en" || locale === "ko") assert.doesNotMatch(value, /\p{Script=Han}/u);
  }
  const shortcut = chatShortcutContract("今天想放鬆走走", locale);
  assert.equal(shortcut.canonicalIntent, "relax_walk");
  assert.equal(detectChatIntent(shortcut.routingPayload), detectChatIntent("今天想放鬆走走"));
  assert.equal(chatMoodDisplay("放鬆", locale), chatRuntimeCopy("badge_relax", locale));
  assert.equal(chatMoodDisplay("relax", locale), chatMoodDisplay("放鬆", locale));
  assert.equal(chatMoodDisplay("Official custom label", locale), "Official custom label");
  for (const badge of [
    "explore",
    "photo",
    "food",
    "cafe",
    "night",
    "shopping",
    "family",
    "outdoor",
    "culture",
  ])
    assert.equal(chatMoodDisplay(badge, locale), chatRuntimeCopy(`badge_${badge}`, locale));
  const recommendationBadges = {
    放鬆: "badge_relax",
    探索: "badge_explore",
    拍照: "badge_photo",
    美食: "badge_food",
    咖啡: "badge_cafe",
    夜景: "badge_night",
    購物: "badge_shopping",
    親子: "badge_family",
    戶外: "badge_outdoor",
    文化: "badge_culture",
    經典地標: "badge_classic",
    在地生活: "badge_local",
    慢步調散策: "badge_slow",
    慢旅行: "badge_slow_travel",
    Roamie混搭: "badge_mixed",
    "Roamie 混搭": "badge_mixed",
  };
  for (const [label, key] of Object.entries(recommendationBadges)) {
    assert.equal(
      chatMoodDisplay(label, locale),
      chatRuntimeCopy(key, locale),
      `${locale} ${label}`,
    );
  }
  assert.equal(chatMoodDisplay("slow_travel", locale), chatMoodDisplay("慢旅行", locale));
  assert.notEqual(chatMoodDisplay("慢旅行", locale), chatMoodDisplay("慢步調散策", locale));
  if (locale !== "zh-TW") assert.doesNotMatch(chatMoodDisplay("慢旅行", locale), /慢旅行/);
  const shownDestination = locale === "zh-TW" ? merged.context.destination : "Kyoto";
  const next = buildDateAndDurationQuestionReply(merged.context.destination, undefined, {
    locale,
    context: merged.context,
    userText: input,
  });
  assert.equal(next.pendingQuestion.type, "ask_days");
  assert.equal(next.pendingQuestion.baseDestination, merged.context.destination);
  assert.equal(
    next.reply,
    chatRuntimeCopy("dateQuestion", locale, { destination: shownDestination }),
  );
  const kyotoTrip = mergeTravelContext(createEmptySession(), input);
  assert.equal(kyotoTrip.context.destination, "京都");
  const kyotoAdvice = resolveDestinationAdvice(kyotoTrip.context, kyotoTrip.session, input, locale);
  assert.equal(kyotoAdvice.pendingQuestion?.baseDestination, "京都");
  assert.equal(
    kyotoAdvice.reply,
    chatRuntimeCopy("durationQuestion", locale, { destination: shownDestination }),
  );
  if (locale !== "zh-TW")
    assert.doesNotMatch(
      kyotoAdvice.reply,
      /好的，我們以|你目前有預計|你預計去|3天2夜|5天4夜|7天以上|一日遊/,
    );
  assert.equal(chatMoodDisplay("想放空", locale), chatRuntimeCopy("badge_unwind", locale));
  assert.equal(chatMoodDisplay("經典地標", locale), chatRuntimeCopy("badge_classic", locale));
  assert.equal(chatMoodDisplay("夜晚散策", locale), chatRuntimeCopy("badge_night_walk", locale));
  assert.equal(chatRuntimeCopy("nearbyWhere", locale), chatRuntimeMessages[locale].nearbyWhere);
  assert.equal(
    chatRuntimeCopy("cuisineQuestion", locale),
    chatRuntimeMessages[locale].cuisineQuestion,
  );
  assert.equal(
    buildAskTripDurationReply({ interests: [], destination: "Kyoto" }, undefined, locale),
    chatRuntimeCopy("durationQuestion", locale, {
      destination: normalizeDestinationLabel("Kyoto"),
    }),
  );
  assert.ok(
    isAlternativeRecommendationOffer(chatRuntimeCopy("noMore", locale)),
    "localized no-more offer remains recognizable after locale switch",
  );
  for (const phase of ["recommendations", "planning", "itinerary_route_recommendation"])
    assert.equal(chatLoadingCopy(phase, locale), chatRuntimeCopy(`loading_${phase}`, locale));
  if (locale === "en")
    assert.doesNotMatch(
      chatLoadingCopy("itinerary_route_recommendation", locale),
      /正在依照你的行程|慢旅行/,
    );
  for (const key of ["noResults", "placeFetchFailed", "whichRegion"])
    assert.ok(
      chatRuntimeCopy(key, locale, { destination: "Official place" }).includes("Official place"),
    );
  for (const key of ["recovery", "generationFailed", "capacity", "quotaPlaces"])
    assert.ok(chatRuntimeCopy(key, locale).trim());
  if (locale !== "zh-TW")
    assert.doesNotMatch(next.reply, /好的，我們以|你目前有預計|例如|3天2夜|5天4夜|7天以上/);
  assert.equal(JSON.stringify(historical), historyBefore, "new copy does not mutate history");
  console.log(
    `PASS ${locale}: known badge semantics, resolved destination/date builder, duration, no-more recognition, loading phases, failure/quota dictionary and historical isolation`,
  );
}
const source = fs.readFileSync("src/routes/_app.chat.tsx", "utf8");
assert.match(source, /phase: ChatLoadingPhase/);
assert.match(source, /chatLoadingCopy\(chatLoading.phase, locale\)/);
assert.match(source, /commitUserMessageWithDiscoveringLoading\(displayMessage, msgs\)/);
assert.match(
  fs.readFileSync("src/components/RoamieResponseView.tsx", "utf8"),
  /chatMoodDisplay\(data.moodTag, locale\)/,
);
assert.match(
  fs.readFileSync("src/components/chat/ChatMessageList.tsx", "utf8"),
  /tripAddPlaceLoadingBubbleText\(m, locale\)/,
);
assert.match(source, /buildTripAddPlaceLoadingMessage\(locale\)/);
assert.doesNotMatch(source, /正在依照你的行程找順路地點/);
console.log(
  "PASS production wiring. This targeted suite does not certify every legacy planning builder or native screenshot.",
);
