/**
 * TS-CHAT-L10N-A — four-locale sample run of every chat reply touched by A1–A5.
 *
 * Every sample below is produced by calling the real builder (no copy is restated here),
 * with fetch stubbed (must stay at 0 calls) and Places search mocked.
 *
 * Assertions:
 *  - en / ko: no Han, no kana, no 「：、～，」.
 *  - ja: no Traditional-only characters, no `～`, no `\d 天`.
 *  - en / ja: no Hangul. en / ko date ranges are `YYYY/MM/DD–YYYY/MM/DD` (no spaces).
 *  - ko: every particle right after a destination / place name follows its final consonant
 *    (independent implementation, not koParticle).
 *  - zh-TW: byte-equal to the HEAD build of the same call. HEAD is a read-only snapshot
 *    (scripts/verify-rel1-head-snapshot.mjs); this script re-runs itself there with
 *    `--zh-only` and compares JSON. Pass `--head-dir=<snapshot>` to reuse an existing one.
 *
 * Run:
 *   npx vite-node scripts/verify-chat-l10n-full-flow.mjs --config scripts/vite.verify.config.mjs
 *   (add `-- --head-dir=/path/to/snapshot` to reuse a snapshot)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const ZH_ONLY = argv.includes("--zh-only");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};

// Root-relative specifiers resolve against the Vite root (cwd), so the same file runs on the
// working tree and on the HEAD snapshot.
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const has = (mod, name) => typeof mod?.[name] === "function";

const M = {
  aliases: await load("src/lib/ai/destination-locale-aliases.ts"),
  guard: await load("src/lib/ai/trip-duration-guard.ts"),
  discovery: await load("src/lib/ai/destination-combination-discovery.ts"),
  combos: await load("src/lib/ai/destination-combination-suggestions.ts"),
  styleGuide: await load("src/lib/ai/destination-style-guide.ts"),
  pending: await load("src/lib/ai/destination-pending-question.ts"),
  tripStyle: await load("src/lib/ai/ai-trip-style.ts"),
  planning: await load("src/lib/ai/itinerary-planning.ts"),
  daySource: await load("src/lib/ai/ai-day-plan-source.ts"),
  nativeQa: await load("src/lib/native-qa-display.ts"),
  season: await load("src/lib/ai/destination-season-reply.ts"),
  mustVisit: await load("src/lib/ai/must-visit-places.ts"),
  camping: await load("src/lib/ai/activity-camping.ts"),
  weatherSearch: await load("src/lib/ai/weather-place-search.ts"),
  weatherReply: await load("src/lib/ai/weather-planning-reply.ts"),
  placeDetail: await load("src/lib/ai/place-detail-chat.ts"),
  shopping: await load("src/lib/ai/shopping-query-queue.ts"),
  budget: await load("src/lib/ai/budget-refinement.ts"),
  stateMachine: await load("src/lib/ai/ai-itinerary-state-machine.ts"),
  placeFetch: await load("src/lib/ai/itinerary-place-fetch.ts"),
  itineraryApi: await load("src/lib/ai/generate-itinerary-api.ts").catch(() => ({})),
  streamClient: await load("src/lib/ai/stream-client.ts"),
  userError: await load("src/lib/user-facing-error.ts"),
  bare: await load("src/lib/ai/bare-number-reply.ts"),
  turnEngine: await load("src/lib/ai/chat-turn-engine.ts"),
  session: await load("src/lib/chat-session.ts"),
  conversationState: await load("src/lib/ai/ai-chat-conversation-state.ts"),
  contextIntent: await load("src/lib/ai/chat-context-intent.ts"),
  localFallback: await load("src/lib/ai/local-recommendation-fallback.ts"),
  refresh: await load("src/lib/ai/chat-recommendation-refresh.ts"),
  landmark: await load("src/lib/ai/landmark-place-strategy.ts"),
};

const LOCALES = ["zh-TW", "en", "ja", "ko"];

// ------------------------------------------------------------------ fixtures
const mk = (i, name, type, extra = {}) => ({
  id: `ChIJL10nFlow${String(i).padStart(3, "0")}`,
  placeId: `ChIJL10nFlow${String(i).padStart(3, "0")}`,
  name,
  lat: 35.0 + i * 0.001,
  lng: 135.76 + i * 0.001,
  types: [type],
  primaryType: type,
  rating: 4.6,
  userRatingCount: 4000 + i,
  address: "Kyoto, Japan",
  businessStatus: "OPERATIONAL",
  ...extra,
});
const SYDNEY_POOL = [
  ["St Mary's Cathedral, Sydney", "tourist_attraction"],
  ["Sydney Opera House, Bennelong Point", "tourist_attraction"],
  ["Sydney Harbour Bridge", "tourist_attraction"],
  ["Royal Botanic Garden Sydney", "park"],
  ["Art Gallery of New South Wales", "museum"],
  ["Australian Museum", "museum"],
  ["Hyde Park", "park"],
  ["Bondi Beach", "tourist_attraction"],
  ["Taronga Zoo Sydney", "zoo"],
  ["Museum of Contemporary Art Australia", "museum"],
  ["The Rocks", "tourist_attraction"],
  ["Darling Harbour", "tourist_attraction"],
  ["Queen Victoria Building", "shopping_mall"],
  ["Centennial Park", "park"],
  ["Sea Life Sydney Aquarium", "aquarium"],
].map(([n, t], i) => mk(i + 1, n, t, { lat: -33.86 + i * 0.001, lng: 151.2 + i * 0.001, address: "Sydney NSW, Australia" }));

const SLOT_SHAPES = [
  [["08:00", "早餐", "cafe"], ["09:30", "景點", "tourist_attraction"], ["11:00", "景點", "museum"], ["12:30", "午餐", "restaurant"], ["14:30", "景點", "park"], ["16:00", "咖啡", "cafe"], ["18:30", "晚餐", "restaurant"]],
  [["08:00", "早餐", "cafe"], ["09:30", "景點", "tourist_attraction"], ["11:00", "景點", "museum"], ["12:30", "午餐", "restaurant"], ["14:30", "景點", "park"], ["16:00", "景點", "tourist_attraction"], ["18:30", "晚餐", "restaurant"]],
  [["09:00", "景點", "tourist_attraction"], ["12:00", "午餐", "restaurant"], ["14:00", "景點", "museum"]],
  [["09:00", "景點", "tourist_attraction"], ["12:00", "午餐", "restaurant"], ["14:00", "景點", "museum"], ["18:30", "晚餐", "restaurant"]],
  [["08:00", "早餐", "cafe"], ["10:00", "景點", "tourist_attraction"], ["12:30", "午餐", "restaurant"], ["14:30", "景點", "museum"], ["16:00", "咖啡", "cafe"], ["18:30", "晚餐", "restaurant"]],
  [["10:00", "景點", "tourist_attraction"], ["12:30", "午餐", "restaurant"], ["14:30", "景點", "museum"], ["16:00", "咖啡", "cafe"], ["18:30", "晚餐", "restaurant"]],
];
const SPOT_NAMES = ["Kinkaku-ji", "Fushimi Inari Taisha", "Kiyomizu-dera", "Nijo Castle", "Ginkaku-ji", "Heian Shrine", "Tofuku-ji", "Sanjusangen-do", "Nanzen-ji", "Kyoto Imperial Palace", "Toji", "Ryoan-ji", "Nishiki Market", "Pontocho Alley", "Gion Tsujiri", "Ippudo Nishikikoji", "Kyoto Ramen Koji", "Honke Owariya", "% Arabica Kyoto", "Weekenders Coffee"];
/** First slot shape the real validator accepts as renderable (so the summary is not the "in progress" copy). */
function composedPlans(days) {
  for (const shape of SLOT_SHAPES) {
    let n = 0;
    const plans = [];
    for (let d = 1; d <= days; d++) {
      plans.push({
        day: d,
        entries: shape.map(([time, label, type]) => {
          const name = SPOT_NAMES[n % SPOT_NAMES.length];
          return { time, label, name, place: mk(100 + n++, name, type, { lat: 35.0 + n * 0.003, lng: 135.76 + n * 0.003 }) };
        }),
      });
    }
    if (M.daySource.isItineraryRenderable(plans, days, "classic_landmarks")) return plans;
    if (argv.includes("--debug") && M.daySource.validateGeneratedDays) {
      out("composed fixture rejected:", JSON.stringify(M.daySource.validateGeneratedDays(plans, days, "classic_landmarks")));
    }
  }
  return null;
}

async function combinationPayload(locale) {
  M.discovery.clearDiscoveredCombinationsCache?.();
  let searchCalls = 0;
  await M.discovery.discoverDestinationCombinations({
    destination: "雪梨",
    locale,
    searchPlaces: async () => {
      searchCalls++;
      return { places: SYDNEY_POOL, error: null };
    },
  });
  const ack = M.guard.buildDestinationDirectionAck({
    destination: "雪梨",
    tripDays: 3,
    startDate: "2026-12-10",
    endDate: "2026-12-12",
    locale,
  });
  const payload = M.combos.buildDestinationCombinationSuggestionPayload("雪梨", 3, {
    locale,
    weatherLine: ack,
    startDate: "2026-12-10",
    endDate: "2026-12-12",
    tentativeDates: false,
  });
  return { payload, searchCalls };
}

// ------------------------------------------------------------------ samples
/** Each value is the real builder output for `locale`. */
async function buildSamples(locale) {
  const S = {};
  const L = locale;

  // directionAck
  S["directionAck.range"] = M.guard.buildDestinationDirectionAck({ destination: "雪梨", tripDays: 3, startDate: "2026-12-10", endDate: "2026-12-12", locale: L });
  S["directionAck.days.Kyoto"] = M.guard.buildDestinationDirectionAck({ destination: "京都", tripDays: 3, locale: L, userText: "I'd like to go to Kyoto" });
  S["directionAck.days.Chiayi"] = M.guard.buildDestinationDirectionAck({ destination: "嘉義", tripDays: 2, locale: L });
  S["directionAck.open.Seoul"] = M.guard.buildDestinationDirectionAck({ destination: "首爾", locale: L });
  S["directionAck.open.Sydney"] = M.guard.buildDestinationDirectionAck({ destination: "雪梨", locale: L });
  S["directionAck.open.Busan"] = M.guard.buildDestinationDirectionAck({ destination: "釜山", locale: L });

  // combination rows + date line (real discovery, mocked Places search)
  const { payload } = await combinationPayload(L);
  S["combination.displayText"] = payload?.displayText ?? "<no payload>";

  // style question + style replies
  S["style.question.Kyoto"] = M.styleGuide.buildDestinationStyleChoiceQuestion("京都", { days: 3, month: "12月", locale: L });
  S["style.question.Seoul"] = M.styleGuide.buildDestinationStyleChoiceQuestion("首爾", { locale: L });
  S["style.reply.styleChoice.Seoul"] = M.pending.buildNextStepAfterAdviceSelection(
    "美食咖啡",
    { type: "destination_style_choice", options: [], baseDestination: "首爾" },
    { interests: [] },
    L,
  ).reply;
  S["style.reply.askPreference.Kyoto5"] = M.pending.buildNextStepAfterAdviceSelection(
    "美食咖啡",
    { type: "ask_preference", options: [], baseDestination: "京都" },
    { interests: [], days: 5 },
    L,
  ).reply;
  S["style.reply.tripStyle.Busan"] = M.tripStyle.buildTripStyleSelectionAdviceResult(
    "local_life",
    { interests: [], destination: "釜山", days: 3 },
    undefined,
    L,
  ).reply;

  // A / B options
  S["ab.options.Kyoto"] = M.planning.buildItineraryPlanningReply({ interests: [], destination: "京都", days: 4 }, [], L);

  // generation status
  S["generation.status.Sydney"] = M.planning.itineraryGenerationStatusReply({ interests: [], destination: "雪梨", days: 3 }, L);
  S["generation.status.nearby.Tokyo"] = M.planning.itineraryGenerationStatusReply({ interests: [], destination: "東京", days: 5, nearbyExtensions: ["鎌倉"] }, L);
  S["generation.status.unresolved.Seoul"] = M.planning.itineraryGenerationStatusReply({ interests: [], destination: "首爾", days: 4, unresolvedNearbyExtensions: ["仁川"] }, L);

  // daily recommendations
  S["daily.recommendations.Kyoto"] = M.planning.buildDailyRecommendationsReply({ interests: [], destination: "京都", days: 3 }, [], L);

  // generation success summary
  const plans = composedPlans(2);
  S["success.composedSummary.Kyoto"] = plans
    ? M.daySource.buildComposedDayPlanSummary("京都", 2, "classic_landmarks", plans, undefined, L)
    : "<no renderable fixture>";
  S["success.composedSummary.notRenderable"] = M.daySource.buildComposedDayPlanSummary("京都", 2, "classic_landmarks", [{ day: 1, entries: [] }], undefined, L);
  S["success.bucketSummary.Seoul"] = M.tripStyle.buildDayPlanSummaryFromBuckets(
    "首爾",
    2,
    "mixed",
    [
      { day: 1, names: ["Gyeongbokgung Palace", "Bukchon Hanok Village"] },
      { day: 2, names: ["N Seoul Tower", "Myeongdong"] },
    ],
    L,
  );
  const tripCopy = M.nativeQa.generatedTripCopy("京都", 3, 9, L);
  S["success.generatedTripCopy"] = `${tripCopy.title}\n${tripCopy.summary}`;

  // country best season (A-series: country best-time builder) + entity season
  S["season.country.Japan"] = M.season.buildBestTravelTimeReply("日本", { skipFollowUpQuestion: true, locale: L });
  S["season.entity.Chiayi"] = M.season.buildBestTravelTimeReply("嘉義", { locale: L });

  // must-visit + daily rhythm
  S["mustVisit.Kyoto"] = M.mustVisit.buildMustVisitPlacesReply({ interests: [], destination: "京都", days: 3 }, L);
  S["mustVisit.Alishan"] = M.mustVisit.buildMustVisitPlacesReply({ interests: [], destination: "阿里山" }, L);
  S["dailyRhythm.Bangkok"] = M.mustVisit.buildDailyRhythmReply({ interests: [], destination: "曼谷", days: 5 }, L);
  S["dailyRhythm.Seoul"] = M.mustVisit.buildDailyRhythmReply({ interests: [], destination: "首爾", days: 4 }, L);

  // camping
  S["camping.intro.Taichung"] = M.camping.buildCampingIntroReply({ interests: [], currentLocation: "台中" }, undefined, L);
  S["camping.intro.nearby"] = M.camping.buildCampingIntroReply({ interests: [] }, undefined, L);
  S["camping.summary.Taichung"] = M.camping.buildCampingRecommendationSummary(
    [{ name: "Dakeng Campground" }, { name: "Wuling Farm Campsite" }],
    { interests: [], currentLocation: "台中" },
    L,
  );

  // weather opening
  S["weather.intro.rainy.Busan"] = M.weatherSearch.buildWeatherAwarePlaceIntro("釜山", "rainy", true, L);
  S["weather.intro.hot.Seoul"] = M.weatherSearch.buildWeatherAwarePlaceIntro("首爾", "hot", true, L);
  S["weather.intro.cold.Kyoto"] = M.weatherSearch.buildWeatherAwarePlaceIntro("京都", "cold", true, L);
  S["weather.intro.default.Sydney"] = M.weatherSearch.buildWeatherAwarePlaceIntro("雪梨", "default", true, L);
  S["weather.constraintAck.Bangkok"] = M.weatherReply.buildWeatherConstraintAcknowledgement(
    { interests: [], destination: "曼谷", excludedCategories: ["戶外曝曬"] },
    { available: true, temperatureMax: 34, temperatureMin: 27, temp: 33, condition: "sunny", description: "sunny" },
    L,
  );

  // place detail
  const detailSession = { ...M.session.createEmptySession(), selectedMood: "深夜散步" };
  const place = { id: "p-ntower", name: "N Seoul Tower", placeName: "N Seoul Tower", lat: 37.55, lng: 126.99, reason: "", estimatedTime: "" };
  S["placeDetail.reply"] = M.placeDetail.buildPlaceDetailReply(place, detailSession, L);
  S["placeDetail.followUp.addToTrip"] = M.placeDetail.buildPlaceDetailFollowUpReply("add_to_trip", { ...detailSession, placeDetailFocus: place }, L);
  S["placeDetail.followUp.nearbyCafe"] = M.placeDetail.buildPlaceDetailFollowUpReply("nearby_cafe", { ...detailSession, placeDetailFocus: place }, L);

  // shopping exhausted
  S["shopping.exhausted.Osaka"] = M.shopping.buildShoppingExhaustedFollowupMessage("大阪", L);

  // budget summary
  S["budget.summary.picks"] = M.budget.buildBudgetRefinementSummary(
    { interests: [], destination: "京都", mood: "慢旅行" },
    [{ name: "Nishiki Market" }, { name: "Kamo River Walk" }],
    L,
  );
  S["budget.summary.none"] = M.budget.buildBudgetRefinementSummary({ interests: [], destination: "京都" }, [], L);

  // itinerary failure messages
  const failures = [
    ["needDestinationDays", "我還需要知道目的地和天數，才能幫你排完整行程。"],
    ["selectionRequired", "我還需要你確認想用哪些組合，才能幫你生成行程。回覆組合編號，或回「都不錯」全選。"],
    ["identity", "部分已選地點目前無法確認地圖身分，請重新整理候選後再選一次。"],
    ["placesLoading", "目前正在取得景點資訊，請稍後重新生成。"],
    ["comboShortage", M.placeFetch.COMBINATION_MAPPING_FAILED_MESSAGE],
    ["singleComboShortage", M.placeFetch.SINGLE_COMBINATION_MAPPING_FAILED_MESSAGE],
    ["offerMustVisit", M.stateMachine.AI_ITINERARY_FAILED_OFFER_MESSAGE],
    ["retrySuffix", "目前正在取得景點資訊，請稍後重新生成。\n\n點選「重新生成」可沿用目前目的地與日期再試一次。"],
    ["unknownZh", "發生未知錯誤：伺服器回應異常"],
  ];
  for (const [name, message] of failures) {
    if (typeof message !== "string") continue;
    S[`failure.${name}`] = has(M.stateMachine, "localizeItineraryFailureMessage")
      ? M.stateMachine.localizeItineraryFailureMessage(message, L)
      : message; // HEAD formula: zh shows the internal message unchanged.
  }

  // connection fallback
  const connErrors = [
    ["network", new TypeError("Failed to fetch")],
    ["noResponse", new Error("AI 沒有回應")],
    ["format", new Error("AI 回應格式錯誤")],
    ["unavailable", new Error("AI 服務暫時無法使用")],
    ["other", new Error("boom")],
  ];
  for (const [name, err] of connErrors) {
    S[`connection.${name}`] = has(M.streamClient, "localizedChatConnectionFallbackMessage")
      ? M.streamClient.localizedChatConnectionFallbackMessage(err, L)
      : M.userError.resolveChatConnectionFallbackMessage(err); // HEAD formula
  }

  // bare-number clarification
  S["bare.dateOrDays"] =
    M.bare.resolveBareNumberByPendingQuestion(5, { pendingQuestion: { type: "ask_date", options: [] }, locale: L }).clarificationReply ?? "<none>";
  S["bare.calendarOrDays"] =
    M.bare.parseTripDaysFromPendingReply("8/3", { pendingQuestion: { type: "ask_days", options: [] }, locale: L }).clarificationReply ?? "<none>";
  S["bare.tooLarge"] =
    M.bare.parseTripDaysFromPendingReply("45", { pendingQuestion: { type: "ask_days", options: [] }, locale: L }).clarificationReply ?? "<none>";

  // planning summary: budget / companion / excluded
  S["summary.full"] = M.turnEngine.buildPlanningContextSummary(
    {
      interests: [],
      destination: "京都",
      days: 3,
      vibe: "美食咖啡",
      budgetLevel: "budget",
      companion: "朋友",
      excludedCategories: ["戶外曝曬", "長距離步行"],
    },
    L,
  );

  // create-itinerary ack (chat-context-intent) + alternative summary + landmark intro + local fallback
  S["createAck.Hokkaido"] = M.contextIntent.buildCreateItineraryAckReply({ destination: "北海道", days: 5, preferences: ["滑雪", "美食"], locale: L });
  S["alternative.summary"] = M.refresh.buildAlternativeRecommendationSummary([{ name: "Blue Bottle Kyoto" }], L);
  S["landmark.intro"] = M.landmark.buildLandmarkCompanionIntro({ label: "阿里山", nearestCity: "嘉義", kind: "landmark" }, "sunny", true, L);

  return S;
}

// ------------------------------------------------------------------ zh-only child mode
if (ZH_ONLY) {
  const zh = await buildSamples("zh-TW");
  out("@@ZH_JSON@@" + JSON.stringify({ samples: zh, fetchCalls }) + "@@END@@");
  process.exit(0);
}

// ------------------------------------------------------------------ checks
const HAN = /\p{Script=Han}/u;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힣]/;
const EN_KO_BAD_PUNCT = /[：、～，]/;
// Traditional-only forms (Japanese uses 這→この, 經→経, 區→区, 點→点, 體驗→体験 …).
const ZH_ONLY_CHARS = /[這們來說對經區邊點體驗讓麼裡從關當與發覺灣臺濟廣戶繩橫綠縣幫鐵覽樂圖舊藝寶實處應營劃畫歡氣鬆擇單雙傳滿澀廳啡你您嗎呢吧喔囉號趟]/u;

/** Independent ko particle rule (not koParticle): returns the expected particle. */
function expectedKoParticle(word, particle) {
  const pairs = { 을: ["을", "를"], 를: ["을", "를"], 이: ["이", "가"], 가: ["이", "가"], 은: ["은", "는"], 는: ["은", "는"], 과: ["과", "와"], 와: ["과", "와"], 으로: ["으로", "로"], 로: ["으로", "로"] };
  const [withB, without] = pairs[particle];
  const ch = word.trim().slice(-1);
  const code = ch.codePointAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (particle === "으로" || particle === "로") return jong === 0 || jong === 8 ? "로" : "으로";
    return jong === 0 ? without : withB;
  }
  return null; // non-Hangul ending: pronunciation-dependent; not asserted
}

const KO_WORDS = ["서울", "부산", "교토", "시드니", "도쿄", "오사카", "방콕", "인천", "가마쿠라", "타이중", "아리산", "N Seoul Tower", "Chiayi", "홋카이도"];
function koParticleIssues(text) {
  const issues = [];
  for (const w of KO_WORDS) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}['’”]?(으로|을|를|이|가|은|는|과|와|로)(?=[\\s.,!?)]|$)`, "gu");
    for (const m of text.matchAll(re)) {
      const exp = expectedKoParticle(w, m[1]);
      if (exp && exp !== m[1]) issues.push(`${m[0]} → expected ${w}…${exp}`);
    }
  }
  return issues;
}

const failures = [];
function check(name, fn) {
  try {
    fn();
    out(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

const samples = {};
for (const locale of LOCALES) samples[locale] = await buildSamples(locale);

// Print the four-locale samples.
out("\n================ FOUR-LOCALE SAMPLES ================");
for (const key of Object.keys(samples["zh-TW"])) {
  out(`\n### ${key}`);
  for (const locale of LOCALES) {
    out(`[${locale}]\n${String(samples[locale][key]).split("\n").map((l) => "  " + l).join("\n")}`);
  }
}
out("\n=====================================================\n");

for (const locale of ["en", "ja", "ko"]) {
  check(`${locale}: every sample is non-empty and differs from zh-TW`, () => {
    const bad = [];
    for (const [k, v] of Object.entries(samples[locale])) {
      if (!v || typeof v !== "string") bad.push(`${k}: empty`);
      else if (v === samples["zh-TW"][k]) bad.push(`${k}: identical to zh-TW`);
    }
    assert.deepEqual(bad, []);
  });
}

for (const locale of ["en", "ko"]) {
  check(`${locale}: no Han / kana, no ：、～，`, () => {
    const bad = [];
    for (const [k, v] of Object.entries(samples[locale])) {
      if (HAN.test(v)) bad.push(`${k} Han: ${JSON.stringify(v.match(/\p{Script=Han}+/gu))}`);
      if (KANA.test(v)) bad.push(`${k} kana`);
      if (EN_KO_BAD_PUNCT.test(v)) bad.push(`${k} punct: ${JSON.stringify(v.match(/[：、～，]/g))}`);
      if (locale === "en" && HANGUL.test(v)) bad.push(`${k} Hangul`);
      for (const m of v.matchAll(/\d{4}\/\d{2}\/\d{2}\s*[–~〜～-]\s*\d{4}\/\d{2}\/\d{2}/g)) {
        if (!/^\d{4}\/\d{2}\/\d{2}–\d{4}\/\d{2}\/\d{2}$/.test(m[0])) bad.push(`${k} date range ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}

check("ja: no Traditional-only characters, no ～, no `N 天`, no Hangul; ranges use 〜", () => {
  const bad = [];
  for (const [k, v] of Object.entries(samples.ja)) {
    const m = v.match(new RegExp(ZH_ONLY_CHARS.source, "gu"));
    if (m) bad.push(`${k} zh-only: ${[...new Set(m)].join("")}`);
    if (/～/.test(v)) bad.push(`${k} ～`);
    if (/\d\s*天/.test(v)) bad.push(`${k} 天`);
    if (HANGUL.test(v)) bad.push(`${k} Hangul`);
    // Spec: ja ranges use 〜 (month / day / minute ranges included).
    for (const r of v.matchAll(/\d+[月日分]?\s*[–—]\s*\d+/g)) bad.push(`${k} range uses dash: ${r[0]}`);
    for (const r of v.matchAll(/\d{4}\/\d{2}\/\d{2}\s*[–~〜～-]\s*\d{4}\/\d{2}\/\d{2}/g)) {
      if (!/^\d{4}\/\d{2}\/\d{2}〜\d{4}\/\d{2}\/\d{2}$/.test(r[0])) bad.push(`${k} date range ${r[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

check("ko: particles after destination / place names follow the final consonant", () => {
  const bad = [];
  for (const [k, v] of Object.entries(samples.ko)) {
    for (const issue of koParticleIssues(v)) bad.push(`${k}: ${issue}`);
  }
  assert.deepEqual(bad, []);
});

check("place names per spec (Kyoto / Sydney / Chiayi)", () => {
  const expect = {
    "directionAck.days.Kyoto": { en: "Kyoto", ja: "京都", ko: "교토" },
    "directionAck.open.Sydney": { en: "Sydney", ja: "シドニー", ko: "시드니" },
    "directionAck.days.Chiayi": { en: "Chiayi", ja: "嘉義", ko: "Chiayi" },
  };
  for (const [k, per] of Object.entries(expect)) {
    for (const [locale, name] of Object.entries(per)) {
      assert.ok(samples[locale][k].includes(name), `${locale} ${k}: ${samples[locale][k]}`);
    }
  }
});

check("en/ko combination rows: names containing a comma are separated with '; '", () => {
  for (const locale of ["en", "ko"]) {
    const rows = samples[locale]["combination.displayText"].split("\n").filter((l) => /^\d+\. /.test(l));
    assert.ok(rows.length >= 2, `${locale} rows`);
    for (const row of rows) {
      if (row.includes("St Mary's Cathedral, Sydney") || row.includes("Sydney Opera House, Bennelong Point")) {
        assert.ok(row.includes("; "), `${locale} comma row must use '; ': ${row}`);
      }
    }
  }
});

// ------------------------------------------------------------------ sweeps beyond the fixed samples
// Nearby-extension labels the product actually parses (combination-selection-reply fallback list).
const NEARBY_LABELS = ["橫濱", "鎌倉", "箱根", "輕井澤", "河口湖", "富士山", "日光", "千葉", "熱海", "伊豆", "九份", "淡水", "北投", "基隆", "宜蘭", "花蓮", "台中", "台南", "高雄", "濟州", "釜山", "仁川", "水原", "大阪", "京都", "奈良", "神戶", "伊勢"];
check("en/ko generation status with nearby / unresolved extensions: no Han", () => {
  const bad = [];
  for (const locale of ["en", "ko"]) {
    for (const ext of NEARBY_LABELS) {
      const a = M.planning.itineraryGenerationStatusReply({ interests: [], destination: "東京", days: 5, nearbyExtensions: [ext] }, locale);
      const b = M.planning.itineraryGenerationStatusReply({ interests: [], destination: "東京", days: 5, unresolvedNearbyExtensions: [ext] }, locale);
      for (const v of [a, b]) if (HAN.test(v)) bad.push(`${locale} ${ext}: ${v.match(/\p{Script=Han}+/gu).join(",")}`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});

// Every canonical from the alias table through the destination-bearing builders.
const aliasSrc = readFileSync("src/lib/ai/destination-locale-aliases.ts", "utf8");
const aliasBlock = aliasSrc.slice(aliasSrc.indexOf("const CITY_LOCALE_ALIASES"), aliasSrc.indexOf("};", aliasSrc.indexOf("const CITY_LOCALE_ALIASES")));
const displayBlockStart = aliasSrc.indexOf("const CITY_DISPLAY_NAMES");
const displayBlock = aliasSrc.slice(displayBlockStart, aliasSrc.indexOf("\n};", displayBlockStart));
const DISPLAY_KEYS = [...displayBlock.matchAll(/^\s*([^\s:/]+):\s*\{\s*ja:/gm)].map((m) => JSON.parse(`"${m[1]}"`));
const geocode = await load("src/lib/ai/destination-geocode.ts");
const CANONICALS = [
  ...new Set([
    ...[...aliasBlock.matchAll(/^\s*(?:"[^"]+"|[^\s:"]+):\s*"([^"]+)"/gm)].map((m) => m[1]),
    ...DISPLAY_KEYS,
    ...Object.keys(geocode.EN_CITY_NAMES ?? {}),
  ]),
].filter((c) => /\p{Script=Han}/u.test(c));
function destinationBuilders(dest, locale) {
  return {
    ackOpen: M.guard.buildDestinationDirectionAck({ destination: dest, locale }),
    ackDays: M.guard.buildDestinationDirectionAck({ destination: dest, tripDays: 3, locale }),
    weatherHot: M.weatherSearch.buildWeatherAwarePlaceIntro(dest, "hot", true, locale),
    weatherCold: M.weatherSearch.buildWeatherAwarePlaceIntro(dest, "cold", true, locale),
    generation: M.planning.itineraryGenerationStatusReply({ interests: [], destination: dest, days: 3 }, locale),
    styleOpen: M.pending.buildNextStepAfterAdviceSelection("美食咖啡", { type: "destination_style_choice", options: [], baseDestination: dest }, { interests: [] }, locale).reply,
    styleAsk: M.pending.buildNextStepAfterAdviceSelection("美食咖啡", { type: "ask_preference", options: [], baseDestination: dest }, { interests: [] }, locale).reply,
    defaultRoutes: M.styleGuide.buildDefaultRoutesReply(dest, undefined, locale).reply,
    shopping: M.shopping.buildShoppingExhaustedFollowupMessage(dest, locale),
    summary: M.turnEngine.buildPlanningContextSummary({ interests: [], destination: dest }, locale),
  };
}
check(`alias canonicals (${CANONICALS.length}) through 10 destination builders: en/ko no Han, ko particles`, () => {
  const bad = [];
  for (const c of CANONICALS) {
    for (const locale of ["en", "ko"]) {
      const shown = M.aliases.displayDestinationForCopy(c, undefined, locale);
      for (const [name, v] of Object.entries(destinationBuilders(c, locale))) {
        if (HAN.test(v)) bad.push(`${locale} ${c} ${name}: Han`);
        if (locale === "ko") {
          const esc = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          for (const m of v.matchAll(new RegExp(`${esc}(으로|을|를|이|가|은|는|과|와|로)(?=[\\s.,!?)]|$)`, "gu"))) {
            const exp = expectedKoParticle(shown, m[1]);
            if (exp && exp !== m[1]) bad.push(`ko ${c} ${name}: ${m[0]} (expected ${exp})`);
          }
        }
      }
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});
check(`alias canonicals (${CANONICALS.length}) through 10 destination builders: ja no Traditional-only characters`, () => {
  const bad = [];
  for (const c of CANONICALS) {
    for (const [name, v] of Object.entries(destinationBuilders(c, "ja"))) {
      const m = v.match(new RegExp(ZH_ONLY_CHARS.source, "gu"));
      if (m) bad.push(`ja ${c} ${name}: ${[...new Set(m)].join("")}`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});

// Named fallback cards (_app.chat.tsx uses them when live places are unavailable): visible fields.
check("en/ko named fallback recommendation cards: visible fields have no Han", () => {
  const bad = [];
  for (const locale of ["en", "ko"]) {
    for (const dest of ["京都", "東京", "首爾", "曼谷", "阿里山", "嘉義"]) {
      for (const rec of M.mustVisit.buildNamedFallbackRecommendations(dest, locale)) {
        // estimatedTime is not rendered on cards and buildPlaceDetailReply re-renders Chinese durations,
        // so only the fields RoamieResponseView shows are asserted (address: RoamieResponseView.tsx ~L342).
        for (const field of ["name", "placeName", "reason", "description", "address"]) {
          const v = rec[field];
          if (typeof v === "string" && HAN.test(v)) bad.push(`${locale} ${dest} ${field}=${JSON.stringify(v)}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

// ko templates rendered by _app.chat.tsx WITHOUT applyKoParticles (same call expression as the route):
//   placeFocusNearby (_app.chat.tsx ~10754), whichRegion (~6600).
const { chatRuntimeCopy } = await load("src/lib/chat-runtime-copy.ts");
check("ko: un-wrapped route templates placeFocusNearby / whichRegion follow the final consonant", () => {
  const bad = [];
  for (const place of ["N서울타워", "경복궁", "부산", "교토"]) {
    const v = chatRuntimeCopy("placeFocusNearby", "ko", { place });
    const m = v.match(new RegExp(`'${place}'(을|를)`));
    const exp = expectedKoParticle(place, "을");
    if (m && m[1] !== exp) bad.push(`placeFocusNearby: ${v}`);
  }
  for (const destination of ["교토", "시드니", "서울"]) {
    const v = chatRuntimeCopy("whichRegion", "ko", { destination });
    const m = v.match(new RegExp(`${destination}(을|를)`));
    const exp = expectedKoParticle(destination, "을");
    if (m && m[1] !== exp) bad.push(`whichRegion: ${v}`);
  }
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ zh-TW vs HEAD
function ensureHeadDir() {
  let dir = headDirArg;
  if (!dir) {
    dir = join(mkdtempSync(join(tmpdir(), "roamie-head-")), "head");
    const r = spawnSync(process.execPath, ["scripts/verify-rel1-head-snapshot.mjs", `--dest=${dir}`], { encoding: "utf8", timeout: 240_000 });
    if (r.status !== 0) throw new Error(`snapshot failed: ${r.stderr || r.stdout}`);
  }
  // The snapshot is HEAD source + this working-tree script (so the same calls run on HEAD).
  const self = "scripts/verify-chat-l10n-full-flow.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) {
    copyFileSync(self, join(dir, self));
  }
  return dir;
}

// D4 (指派者裁定): D2 r4/r5 keeps Google Latin names instead of HEAD's phonetic transliteration
// (西德納艾哈爾波爾橋 / 波納迪海灘), which re-classifies them and changes the Sydney combination
// members. Accepted: only these two exact list rows of combination.displayText may differ.
const ALLOWED_ZH_DIFFS = {
  "combination.displayText": [
    ["1. 經典景點組合：The Rocks、西德納艾哈爾波爾橋、Sydney Opera House, Bennelong Point\n",
      "1. 經典景點組合：The Rocks、Sydney Opera House, Bennelong Point、St Mary's Cathedral, Sydney\n"],
    ["2. 海岸夕陽組合：Darling Harbour、波納迪海灘\n",
      "2. 海岸夕陽組合：Darling Harbour、Bondi Beach、Sydney Harbour Bridge\n"],
  ],
};
check("zh-TW: byte-equal to the HEAD build of the same calls (except the listed Sydney combination rows)", () => {
  const headDir = ensureHeadDir();
  assert.ok(existsSync(join(headDir, "scripts/verify-chat-l10n-full-flow.mjs")), `script missing in snapshot ${headDir}`);
  assert.ok(!existsSync(join(headDir, "src/lib/ai/parse-add-all-to-trip-intent.ts")) ||
    !readFileSync(join(headDir, "src/lib/ai/parse-add-all-to-trip-intent.ts"), "utf8").includes("ADD_ALL_TO_TRIP_EN_RE"),
    "snapshot must be HEAD source, not the working tree");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(
    npx,
    ["vite-node", "scripts/verify-chat-l10n-full-flow.mjs", "--config", "scripts/vite.verify.config.mjs", "--", "--zh-only"],
    { cwd: headDir, encoding: "utf8", timeout: 300_000, maxBuffer: 64 << 20 },
  );
  const m = (r.stdout ?? "").match(/@@ZH_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stderr ?? "").slice(-2000)}`);
  const head = JSON.parse(m[1]);
  assert.equal(head.fetchCalls, 0, "HEAD child fetch calls");
  const diffs = [];
  const allowedSeen = [];
  for (const [k, v] of Object.entries(samples["zh-TW"])) {
    if (head.samples[k] === v) continue;
    const allowed = ALLOWED_ZH_DIFFS[k];
    if (allowed && typeof head.samples[k] === "string" && allowed.every(([a]) => head.samples[k].split(a).length === 2)
      && allowed.reduce((t, [a, b]) => t.split(a).join(b), head.samples[k]) === v) { allowedSeen.push(k); continue; }
    diffs.push(`${k}\n    HEAD: ${JSON.stringify(head.samples[k])}\n    NOW : ${JSON.stringify(v)}`);
  }
  out(`  compared ${Object.keys(samples["zh-TW"]).length} zh-TW samples against HEAD (${headDir}); allowed: ${JSON.stringify(allowedSeen)}`);
  assert.deepEqual(diffs, []);
  assert.deepEqual(allowedSeen, Object.keys(ALLOWED_ZH_DIFFS), "every allowed difference must occur (exact allow-list)");
});

check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS chat l10n full flow: four-locale samples, punctuation, names, ko particles, zh-TW = HEAD");
process.exit(0);
