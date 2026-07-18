/**
 * After bare tripDays, must show combination options for curated cities,
 * and never render theme-category labels as places.
 * Non-curated cities without Places cache may ask to refresh — not fake places.
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import {
  applyAdviceResultToSession,
  resolveDestinationAdvice,
} from "../src/lib/ai/destination-advice.ts";
import { pendingQuestionForAskDays } from "../src/lib/ai/city-days-planning.ts";
import {
  buildThemeFallbackCombinations,
  buildDestinationCombinationSuggestionsReply,
  getDestinationCombinations,
  isThemeCategoryLabel,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  clearDiscoveredCombinationsCache,
  setCachedDiscoveredCombinations,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { parseAskDaysFromText } from "../src/lib/ai/destination-pending-question.ts";
import { buildThemeSearchDirections } from "../src/lib/ai/destination-discovery-queries.ts";

let failed = 0;
const logs = [];
const originalInfo = console.info;
console.info = (...args) => {
  logs.push(args.join(" "));
  originalInfo(...args);
};

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function runAdvice(text, sess) {
  const merged = mergeTravelContext(sess, text);
  const intent = detectChatIntent(text);
  const nextSession = {
    ...merged.session,
    activeChatIntent:
      intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
  };
  const advice = resolveDestinationAdvice(merged.context, nextSession, text);
  return { advice, merged, nextSession };
}

function mockCombo(title, names, id) {
  return {
    combinationId: `mock:${id}`,
    title,
    theme: "attraction",
    placeCandidates: names.map((name, i) => ({
      name,
      googlePlaceId: `ChIJ_${id}_${i}`,
      types: ["tourist_attraction"],
      coordinates: { lat: 10 + i * 0.01, lng: 120 + i * 0.01 },
    })),
    primaryCandidates: names.map((name, i) => ({
      name,
      googlePlaceId: `ChIJ_${id}_${i}`,
      types: ["tourist_attraction"],
    })),
  };
}

// Theme fallback is search-only (empty places)
{
  const cebu = buildThemeFallbackCombinations("宿霧", "菲律賓");
  assert(cebu.length >= 3, "宿霧 theme directions >= 3");
  assert(cebu.every((c) => c.places.length === 0), "theme places empty");
  assert(cebu.some((c) => /海島|放鬆/.test(c.title)), "宿霧 has island theme title");
  const directions = buildThemeSearchDirections("宿霧", "菲律賓");
  assert(directions.every((d) => d.queries.length >= 2), "each theme has queries");
  const reply = buildDestinationCombinationSuggestionsReply("宿霧", 6, {
    forceCombinations: cebu,
  });
  assert(reply == null, "empty-place theme forceCombinations → null (no fake places)");
}

clearDiscoveredCombinationsCache("宿霧");
assert(
  getDestinationCombinations("宿霧").length === 0,
  "宿霧 without cache/discovery → no fake combos",
);
assert(parseAskDaysFromText("6") === 6, "bare 6 → tripDays");

// Seed Places-backed cache for non-curated / sparse cities so duration→combo routing is testable
const SEED = {
  宿霧: [
    mockCombo("市區文化組合", ["Basilica del Santo Niño", "Magellan's Cross", "Fort San Pedro"], 1),
    mockCombo("海島放鬆組合", ["Mactan Island", "Nalusuan Island", "Hilutungan Island"], 2),
    mockCombo("近郊自然組合", ["Kawasan Falls", "Osmeña Peak", "Moalboal"], 3),
  ],
  花蓮: [
    mockCombo("經典地標組合", ["松園別館", "東大門夜市", "七星潭"], 1),
    mockCombo("自然風景組合", ["太魯閣國家公園", "清水斷崖", "鯉魚潭"], 2),
    mockCombo("海岸放鬆組合", ["七星潭", "北濱公園", "花蓮港"], 3),
  ],
  倫敦: [
    mockCombo("經典地標組合", ["Big Ben", "Tower Bridge", "Buckingham Palace"], 1),
    mockCombo("博物館藝文組合", ["British Museum", "Tate Modern", "National Gallery"], 2),
    mockCombo("在地美食組合", ["Borough Market", "Covent Garden", "Camden Market"], 3),
  ],
};

for (const [city, combos] of Object.entries(SEED)) {
  clearDiscoveredCombinationsCache(city);
  setCachedDiscoveredCombinations(city, combos);
}

const CITIES = [
  ["花蓮", "3", "台灣"],
  ["東京", "6", "日本"],
  ["宿霧", "6", "菲律賓"],
  ["巴黎", "7", "法國"],
  ["首爾", "5", "韓國"],
  ["曼谷", "4", "泰國"],
  ["倫敦", "5", "英國"],
  ["台中", "4", "台灣"],
];

const BANNED = ["海灘", "跳島", "老城", "教堂", "市集", "海鮮", "瀑布", "山林", "湖畔"];

for (const [city, days, country] of CITIES) {
  logs.length = 0;
  let session = createEmptySession();
  const t1 = runAdvice(`我2月要去${city}`, session);
  session = applyAdviceResultToSession(
    {
      ...t1.nextSession,
      activeChatIntent: "destination_advice",
      conversationMode: "destination_planning",
      pendingQuestion: t1.advice.pendingQuestion ?? pendingQuestionForAskDays(city, country),
      travelContext: {
        ...t1.merged.context,
        destination: t1.merged.context.destination ?? city,
        destinationCountry: t1.merged.context.destinationCountry ?? country,
        travelMonth: t1.merged.context.travelMonth ?? "2月",
      },
    },
    {
      reply: t1.advice.reply,
      pendingQuestion: t1.advice.pendingQuestion ?? pendingQuestionForAskDays(city, country),
      contextPatch: t1.advice.contextPatch,
    },
  );
  assert(session.pendingQuestion?.type === "ask_days", `${city} pending ask_days`);

  const t2 = runAdvice(days, session);
  const reply = t2.advice.reply ?? "";
  assert(Boolean(reply), `${city} turn2 has reply`);
  assert(!/你這趟大概幾天|有預計的旅行日期或天數嗎/.test(reply), `${city} no re-ask days`);
  assert(
    /建議組合|組合搭配/.test(reply) ||
      t2.advice.pendingQuestion?.type === "combination_choice",
    `${city} shows combinations`,
  );
  assert(
    t2.advice.triggerItineraryGeneration !== true,
    `${city} does not trigger itinerary`,
  );
  assert(
    !(t2.advice.contextPatch?.selectedCombinationIds?.length > 0),
    `${city} selectedCombinationIds empty`,
  );
  for (const banned of BANNED) {
    assert(
      !isThemeCategoryLabel(banned) || !new RegExp(`[：、]${banned}([、\\n]|$)`).test(reply),
      `${city} reply must not list category label ${banned}`,
    );
  }
  assert(
    logs.some((l) => l.includes("resolvedNextStep=show_combination_options")) ||
      /建議組合/.test(reply),
    `${city} nextStep combination options`,
  );
  assert(
    !logs.some((l) => l.includes("[ITINERARY_CREATE_TRIGGERED_FROM_CHAT]")),
    `${city} no itinerary create log`,
  );
  assert(
    !logs.some((l) => l.includes("[TRIP_PIPELINE_STARTED]")),
    `${city} no trip pipeline started`,
  );

  const combos = getDestinationCombinations(city);
  console.log(
    `  ${city} placesPerCombo=[${combos.map((c) => c.places.length).join(",")}]`,
  );
}

console.info = originalInfo;
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll duration→combination routing checks passed.");
