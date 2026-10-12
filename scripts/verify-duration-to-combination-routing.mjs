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
  ensureDestinationCombinationsReady,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { parseAskDaysFromText } from "../src/lib/ai/destination-pending-question.ts";
import { buildThemeSearchDirections } from "../src/lib/ai/destination-discovery-queries.ts";

import { clearCandidatePoolCache } from "../src/lib/ai/places-cost-cache/candidate-pool-cache.ts";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";
const locale = "en";
Object.defineProperty(globalThis, "navigator", {value:{language:locale,languages:[locale]}, configurable:true});
globalThis.fetch = async () => { throw new Error("Real provider calls forbidden"); };
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
  const advice = resolveDestinationAdvice(merged.context, nextSession, text, locale);
  return { advice, merged, nextSession };
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

  // Supply raw provider fixtures to the actual discovery/validation/assembly path.
  // No preassembled combinations or curated-name promotion.
  clearDiscoveredCombinationsCache(city);
  const center = resolveDestinationApproxCenter(city, country);
  assert(Boolean(center), `${city} fixture center exists`);
  const fixtureNames = ["Amber Castle", "Royal Cathedral", "Heritage Palace", "Old Fortress", "Historic Abbey", "Marble Tower",
    "Fine Arts Museum", "Maritime Museum", "Natural History Museum", "Archaeology Museum", "Design Museum", "Science Museum",
    "Botanical Gardens", "Riverside Park", "Woodland Trail", "Rose Gardens", "Lakeside Mountain", "Sculpture Gardens"];
  const places = fixtureNames.map((name, i) => ({
    id:`ChIJFixture${Buffer.from(city).toString("hex")}${i}`, name,
    lat:center.lat+i*.003, lng:center.lng,
    types:[i<6 ? "tourist_attraction" : i<12 ? "museum" : (i===14 || i===16) ? "hiking_area" : "park"],
    primaryType:i<6 ? "tourist_attraction" : i<12 ? "museum" : (i===14 || i===16) ? "hiking_area" : "park",
    rating:4.6,userRatingCount:10000,address:`${city} ${country}`,businessStatus:"OPERATIONAL",
  }));
  let searches=0;
  const ready=await ensureDestinationCombinationsReady({destination:city,destinationCountry:country,
    days:Number(days),locale,generationRequestId:`duration-fixture-${city}`,
    geocodeFn:async()=>center,
    searchPlaces:async()=>{searches++;return {places,error:null}},
  });
  assert(ready.ok, `${city} actual mock discovery succeeds (${ready.failureReason ?? "ok"})`);
  assert(searches>0 && searches<=12, `${city} bounded provider search executed`);
  const t2 = runAdvice(days, session);
  const reply = t2.advice.reply ?? "";
  assert(Boolean(reply), `${city} turn2 has reply`);
  assert(!/你這趟大概幾天|有預計的旅行日期或天數嗎/.test(reply), `${city} no re-ask days`);
  assert(
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
    t2.advice.pendingQuestion?.type === "combination_choice" &&
      (t2.advice.contextPatch?.offeredCombinations?.length ?? 0) >= 2,
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
  // Retain the original dense, homogeneous supply as a negative quality case.
  clearDiscoveredCombinationsCache(city);
  clearCandidatePoolCache();
  const denseNames = ["Amber Castle", "Royal Cathedral", "Heritage Palace", "Old Fortress", "Historic Abbey", "Marble Tower",
    "Fine Arts Museum", "Maritime Museum", "Natural History Museum", "Archaeology Museum", "Design Museum", "Science Museum",
    "Botanical Gardens", "Riverside Park", "Woodland Park", "Rose Gardens", "Lakeside Park", "Sculpture Gardens"];
  const dense = places.map((p,i)=>({...p,id:`ChIJDense${Buffer.from(city).toString("hex")}${i}`,name:denseNames[i],
    lat:center.lat+i*.0003,types:[i<6?"tourist_attraction":i<12?"museum":"park"],primaryType:i<6?"tourist_attraction":i<12?"museum":"park"}));
  const excludedSupply=dense.map((p,i)=>({...p,id:`ChIJTransit${Buffer.from(city).toString("hex")}${i}`,name:`Bus Terminal ${i}`,types:["bus_station"],primaryType:"bus_station"}));
  let recoveryCalls=0;
  const insufficient=await ensureDestinationCombinationsReady({destination:city,destinationCountry:country,
    days:Number(days),locale,generationRequestId:`duration-negative-${city}`,geocodeFn:async()=>center,
    searchPlaces:async(args)=>{
      const recovery=/theme/.test(args.data.placesCaller??"");
      if(recovery) recoveryCalls++;
      return {places:recovery?excludedSupply:dense,error:null};
    }});
  assert(recoveryCalls>0, `${city} post-validation recovery evaluated`);
  assert(!insufficient.ok && insufficient.failureReason==="insufficient_combinations", `${city} dense supply remains insufficient after recovery`);

}

console.info = originalInfo;
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll duration→combination routing checks passed.");
