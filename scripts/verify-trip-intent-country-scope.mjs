/**
 * Acceptance: future trip narrative + country scope gate
 * (Vietnam / Japan / Korea / Italy / US — not Vietnam-hardcoded)
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { resolveChatIntent } from "../src/lib/ai/chat-dining-flow.ts";
import { shouldFetchDestinationPlaces } from "../src/lib/ai/must-visit-places.ts";
import { shouldFetchDestinationCategoryPlaces } from "../src/lib/ai/chat-place-intent.ts";
import {
  evaluateDestinationScopeGate,
  isCountryLevelDestination,
} from "../src/lib/ai/destination-scope.ts";
import { resolveChatContextIntent } from "../src/lib/ai/chat-context-intent.ts";
import { isTravelPlanningText } from "../src/lib/ai/chat-intent-router.ts";
import {
  isFutureTripPlanningStatement as isFutureTrip,
  isCountryCityInquiryText as isCityInquiry,
} from "../src/lib/ai/trip-planning-context.ts";
import { parsePlaceRecommendationIntent } from "../src/lib/ai/place-recommendation-intent/parse.ts";
import { hasCategoryPlaceQuery } from "../src/lib/ai/chat-place-category-types.ts";
import { isAcceptableRestaurantPlace } from "../src/lib/ai/recommendation-refinement/search.ts";
import { generateLocalRecommendationFallback } from "../src/lib/ai/local-recommendation-fallback.ts";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  } else {
    console.log(`OK ${msg}`);
  }
}

{
  const text = "我 1 月要去越南";
  assert(isFutureTrip(text), "VN future trip statement");
  assert(!hasCategoryPlaceQuery(text), "VN not category place query");
  assert(parsePlaceRecommendationIntent(text) == null, "VN not place recommendation intent");
  assert(detectChatIntent(text) === "trip_planning", "VN detectChatIntent=trip_planning");
  assert(resolveChatContextIntent(text) === "trip_planning", "VN contextIntent=trip_planning");
  assert(isTravelPlanningText(text), "VN isTravelPlanningText");

  const session = createEmptySession();
  const merged = mergeTravelContext(session, text);
  assert(merged.context.destination === "越南", "VN destination=越南");
  assert(
    merged.context.destinationType === "country" || isCountryLevelDestination(merged.context.destination),
    "VN destinationType=country",
  );
  assert(String(merged.context.travelMonth).includes("1"), "VN travelMonth=1");
  assert(!shouldFetchDestinationPlaces(text, merged.context), "VN no destination places fetch");
  assert(
    !shouldFetchDestinationCategoryPlaces(text, merged.context, merged.session),
    "VN no category places fetch",
  );

  const gate = evaluateDestinationScopeGate({
    destination: merged.context.destination,
    destinationType: merged.context.destinationType,
  });
  assert(gate.placesCallBlocked === true, "VN placesCallBlocked");
  assert(gate.requiresDestinationRefinement === true, "VN requires refinement");
  assert(gate.placesCallAllowed === false, "VN placesCallAllowed=false");
  assert(gate.reason === "country_scope_requires_refinement", "VN block reason");

  const route = resolveChatRoute(text, merged.context, merged.session, "zh-TW", "trip_planning");
  assert(route.mode === "advice" || route.mode === "clarify", `VN route not recommend (got ${route.mode})`);

  const advice = resolveDestinationAdvice(merged.context, merged.session, text);
  const turn = processAdviceTurn(text, merged.session, merged.context);
  const reply = advice.reply ?? turn.advice.reply ?? "";
  assert(Boolean(reply), "VN has clarifying reply");
  assert(/河內|峴港|胡志明|會安|富國/.test(reply), "VN asks city/region");
  assert(
    (advice.pendingQuestion ?? turn.advice.pendingQuestion)?.type === "region_choice",
    "VN pending=region_choice",
  );
  assert(!/選一個後我可以幫你安排路線/.test(reply), "VN no place-card CTA copy");
}

{
  const text = "我 1 月要去峴港";
  const session = createEmptySession();
  const merged = mergeTravelContext(session, text);
  assert(detectChatIntent(text) === "trip_planning", "Da Nang trip_planning");
  assert(!shouldFetchDestinationCategoryPlaces(text, merged.context, merged.session), "Da Nang no restaurant cards");
  const advice = resolveDestinationAdvice(merged.context, merged.session, text);
  const turn = processAdviceTurn(text, merged.session, merged.context);
  const reply = advice.reply ?? turn.advice.reply ?? "";
  assert(Boolean(reply), "Da Nang has planning reply");
  assert(!/餐廳|選一個後我可以幫你安排路線/.test(reply), "Da Nang not restaurant card path");
}

{
  const text = "推薦峴港景點";
  const session = createEmptySession();
  const merged = mergeTravelContext(session, text);
  assert(hasCategoryPlaceQuery(text) || detectChatIntent(text) === "attraction", "attractions place ask");
  assert(
    shouldFetchDestinationCategoryPlaces(text, merged.context, merged.session) ||
      detectChatIntent(text) === "attraction",
    "attractions can enter place recommendation",
  );
  const gate = evaluateDestinationScopeGate({
    destination: "峴港",
    destinationType: merged.context.destinationType ?? "city",
  });
  assert(gate.placesCallAllowed === true, "Da Nang places allowed");
}

{
  const text = "越南有哪些城市適合第一次去";
  assert(isCityInquiry(text), "city inquiry detected");
  assert(detectChatIntent(text) === "trip_planning", "city inquiry → trip_planning");
  assert(parsePlaceRecommendationIntent(text) == null, "city inquiry not restaurant");
  const session = createEmptySession();
  const merged = mergeTravelContext(session, text);
  assert(
    !shouldFetchDestinationCategoryPlaces(text, merged.context, merged.session),
    "city inquiry no place cards",
  );
  const advice = resolveDestinationAdvice(merged.context, merged.session, text);
  assert(Boolean(advice.reply), "city inquiry has city list reply");
  assert(/河內|峴港|胡志明|會安/.test(advice.reply ?? ""), "city inquiry lists cities");
  assert(advice.pendingQuestion?.type === "region_choice", "city inquiry pending region_choice");
}

{
  const text = "推薦河內安靜咖啡廳";
  const session = createEmptySession();
  const merged = mergeTravelContext(session, text);
  assert(detectChatIntent(text) === "cafe", "Hanoi cafe intent");
  assert(
    shouldFetchDestinationCategoryPlaces(text, merged.context, merged.session),
    "Hanoi cafe places allowed",
  );
  const gate = evaluateDestinationScopeGate({
    destination: "河內",
    destinationType: "city",
  });
  assert(gate.placesCallAllowed === true, "Hanoi scope allows places");
}

for (const country of ["日本", "韓國", "義大利", "美國", "泰國"]) {
  const text = `我 1 月要去${country}`;
  assert(isFutureTrip(text), `${country} future trip`);
  assert(detectChatIntent(text) === "trip_planning", `${country} trip_planning`);
  assert(parsePlaceRecommendationIntent(text) == null, `${country} not cuisine place intent`);
  const gate = evaluateDestinationScopeGate({ destination: country, destinationType: "country" });
  assert(gate.placesCallBlocked === true, `${country} places blocked`);
  assert(isCountryLevelDestination(country), `${country} is country-level`);
}

{
  // Quality gate: catering + low rating + plus-code address rejected
  assert(
    !isAcceptableRestaurantPlace({
      name: "Dịch Vụ Nấu Ăn Nghĩa Yến",
      address: "375G+8VG, Mang Yang, Gia Lai, 越南",
      primaryType: "restaurant",
      types: ["restaurant", "meal_delivery"],
      rating: 3.8,
      userRatingCount: 5,
    }),
    "reject low-quality catering restaurant",
  );
  assert(
    isAcceptableRestaurantPlace({
      name: "Pho Thin",
      address: "13 Lo Duc, Hai Ba Trung, Hanoi",
      primaryType: "restaurant",
      types: ["restaurant"],
      rating: 4.4,
      userRatingCount: 1200,
    }),
    "accept quality restaurant",
  );
}

{
  const summary1 = generateLocalRecommendationFallback({
    context: { interests: [], destination: "河內" },
    session: createEmptySession(),
    places: [
      {
        id: "p1",
        name: "Cafe A",
        address: "Hanoi",
        lat: 21.0,
        lng: 105.8,
        rating: 4.5,
        userRatingCount: 100,
        photoName: null,
        primaryType: "cafe",
        businessStatus: null,
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
      },
    ],
  }).summary;
  assert(/一個符合條件/.test(summary1), "copy sync for 1 place");
  assert(!/選一個後我可以幫你安排路線/.test(summary1), "no plural CTA for 1 place");
}

{
  // Sticky place_recommendation must not pollute new trip narrative
  const session = {
    ...createEmptySession(),
    pendingQuestion: { type: "preference", prompt: "x", options: [] },
    travelContext: {
      interests: [],
      lastIntent: "place_recommendation",
      tripPurpose: "recommend_places",
      destination: "台北",
    },
  };
  const merged = mergeTravelContext(session, "我 1 月要去越南");
  assert(merged.context.lastIntent === "trip_planning", "no sticky place_recommendation leak");
  assert(merged.context.destination === "越南", "destination switched to Vietnam");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll trip-intent country-scope checks passed.");
