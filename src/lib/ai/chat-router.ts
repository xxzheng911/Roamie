import type { ChatPlanningSession } from "@/lib/chat-session";
import { isUserConfirmingItinerary } from "@/lib/chat-session";
import type { ChatPhase } from "@/lib/ai/context";
import type { Locale } from "@/lib/i18n/types";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";
import {
  detectChatIntent,
  isNearbyPlaceIntent,
  sessionHasLocation,
  type ChatIntent,
} from "@/lib/ai/chat-intent";
import {
  buildCampingIntroReply,
  isCampingRequestText,
} from "@/lib/ai/activity-camping";
import {
  buildDestinationPlanningClarify,
  isDestinationAdviceActive,
} from "@/lib/ai/trip-planning-context";
import { parseDestinationAdvicePurpose, resolveDestinationAdvice } from "@/lib/ai/destination-advice";
import { processAdviceTurn, isPlanningTurnActive } from "@/lib/ai/chat-state-machine";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import {
  isFlexiblePreferenceReply,
  pendingQuestionForDestinationStyleChoice,
  parseItineraryNextStepSelection,
} from "@/lib/ai/destination-pending-question";
import { parseItineraryPlanModeIntent } from "@/lib/ai/itinerary-planning";
import {
  detectPlaceRecommendationIntent,
  shouldFetchDestinationPlaces,
} from "@/lib/ai/must-visit-places";
import { shouldFetchDestinationCategoryPlaces } from "@/lib/ai/chat-place-intent";
import {
  isTripAddPlaceSession,
  parseTripAddPlaceFollowUpIntent,
} from "@/lib/trip/trip-add-place-session";
import {
  type CanonicalTravelContext,
  isReadyForRecommendation,
  logTravelContext,
  missingContextKeys,
} from "@/lib/ai/travel-context";

export type AiChatRouteMode = "clarify" | "recommend" | "itinerary" | "advice";

export type AiChatRoute = {
  mode: AiChatRouteMode;
  chatPhase: ChatPhase;
  missingKey?: TripIntentMissingKey;
  question?: string;
  pendingQuestion?: PendingQuestion;
  contextPatch?: Partial<CanonicalTravelContext>;
};

const CLARIFY_ZH: Record<TripIntentMissingKey, (ctx: CanonicalTravelContext) => string> = {
  destination: (ctx) =>
    ctx.destination
      ? `好的，我們從${ctx.destination}出發。這趟比較想放鬆、拍照，還是吃美食？`
      : "你想從哪個地區開始逛呢？",
  vibe: () => "這趟比較想放鬆、拍照，還是吃美食？",
  setting: () => "今天比較想待在室內，還是戶外走走？",
  companionship: () => "這次是一個人，還是跟朋友／家人一起？",
  date: () => "大概哪一天出門呢？",
};

function buildClarifyQuestion(
  key: TripIntentMissingKey,
  ctx: CanonicalTravelContext,
  locale: Locale,
  intent: ChatIntent,
  session: ChatPlanningSession,
): string {
  const isDestinationPlanning =
    session.conversationMode === "destination_planning" ||
    session.tripPlanningContext?.intent === "destination_planning" ||
    intent === "trip_planning";

  if (locale === "zh-TW" && isDestinationPlanning) {
    return buildDestinationPlanningClarify(ctx, session, key);
  }

  if (locale !== "zh-TW") {
    const en: Record<TripIntentMissingKey, string> = {
      destination: "Which city are you in? I can find places nearby.",
      vibe: "More into relaxing, photos, or food?",
      setting: "Prefer indoors or outdoors?",
      companionship: "Solo or with friends/family?",
      date: "Which day are you heading out?",
    };
    return en[key];
  }

  if (key === "destination" && isNearbyPlaceIntent(intent)) {
    if (intent === "restaurant") return "你在哪個城市呢？我幫你找附近適合聚餐的餐廳。";
    if (intent === "cafe") return "你在哪個城市呢？我幫你找附近的咖啡廳。";
    if (intent === "camping") return buildCampingIntroReply(ctx, session);
    return "你在哪個城市呢？我幫你找附近的景點。";
  }

  return CLARIFY_ZH[key](ctx);
}

function nextUnaskedKey(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  intent: ChatIntent,
): TripIntentMissingKey | null {
  const asked = new Set(session.askedClarifyKeys ?? []);
  for (const key of missingContextKeys(ctx, session, intent)) {
    if (!asked.has(key)) return key;
  }
  return null;
}

export function resolveChatRoute(
  userText: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  locale: Locale = "zh-TW",
  intent: ChatIntent = detectChatIntent(userText),
): AiChatRoute {
  if (
    (session.fromMoodFlow || session.fromMoodCard || session.homeMoodShortcutEntry) &&
    (intent === "create_itinerary" || intent === "trip_planning")
  ) {
    intent = "attraction";
  }

  console.info(`[CHAT_INTENT] intent=${intent}`);

  if (isUserConfirmingItinerary(userText)) {
    console.info("[AI_ROUTE] itinerary_mode", logTravelContext(ctx));
    return { mode: "itinerary", chatPhase: "handoff" };
  }

  if (isTripAddPlaceSession(session)) {
    const followUp = parseTripAddPlaceFollowUpIntent(userText);
    if (followUp || isNearbyPlaceIntent(intent)) {
      console.info("[AI_ROUTE] trip_add_place_recommend", logTravelContext(ctx), `intent=${intent}`);
      return { mode: "recommend", chatPhase: "recommend" };
    }
    console.info("[AI_ROUTE] trip_add_place_followup", logTravelContext(ctx));
    return { mode: "recommend", chatPhase: "followup" };
  }

  const advicePurpose = parseDestinationAdvicePurpose(userText);
  const planningDestination =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city;
  const isDestinationPlanning =
    session.conversationMode === "destination_planning" ||
    session.tripPlanningContext?.intent === "destination_planning" ||
    intent === "trip_planning" ||
    intent === "create_itinerary" ||
    intent === "best_travel_time";
  const planningActive = isPlanningTurnActive(session, ctx);
  const shouldTryAdvice =
    planningActive ||
    intent === "destination_advice" ||
    (intent === "create_itinerary" &&
      !session.fromMoodFlow &&
      !session.fromMoodCard &&
      !session.homeMoodShortcutEntry) ||
    intent === "best_travel_time" ||
    intent === "trip_planning" ||
    (isFlexiblePreferenceReply(userText) &&
      isDestinationPlanning &&
      Boolean(planningDestination?.trim())) ||
    (Boolean(parseItineraryPlanModeIntent(userText) || parseItineraryNextStepSelection(userText)) &&
      Boolean(ctx.destination?.trim() || planningDestination?.trim()) &&
      Boolean(ctx.days)) ||
    advicePurpose === "destination_selection" ||
    advicePurpose === "best_time_to_visit" ||
    advicePurpose === "region_selected" ||
    advicePurpose === "seasonal_destination";

  if (shouldTryAdvice && !shouldFetchDestinationCategoryPlaces(userText, ctx, session)) {
    const turn = processAdviceTurn(userText, session, ctx);
    if (turn.advice.reply) {
      console.info("[AI_ROUTE] destination_advice_mode", logTravelContext(ctx));
      return turn.route!;
    }
  }

  const campingActive =
    intent === "camping" ||
    session.activeChatIntent === "camping" ||
    ctx.activity === "camping" ||
    isCampingRequestText(userText);

  if (campingActive && !sessionHasLocation(session) && !ctx.destination?.trim()) {
    console.info("[AI_ROUTE] camping_intro_mode", logTravelContext(ctx));
    return {
      mode: "advice",
      chatPhase: "discover",
      question: buildCampingIntroReply(ctx, session),
      contextPatch: {
        activity: "camping",
        tripPurpose: "recommend_places",
        interests: [...new Set([...ctx.interests, "露營"])],
      },
    };
  }

  if (isReadyForRecommendation(ctx, session, intent)) {
    console.info("[AI_ROUTE] recommendation_mode", logTravelContext(ctx), `intent=${intent}`);
    return { mode: "recommend", chatPhase: "recommend" };
  }

  if (
    shouldFetchDestinationPlaces(userText, ctx) ||
    shouldFetchDestinationCategoryPlaces(userText, ctx, session) ||
    (detectPlaceRecommendationIntent(userText) && ctx.destination?.trim())
  ) {
    console.info("[AI_ROUTE] destination_place_recommend", logTravelContext(ctx));
    return { mode: "recommend", chatPhase: "recommend" };
  }

  const nextKey = nextUnaskedKey(ctx, session, intent);
  if (nextKey) {
    const question = buildClarifyQuestion(nextKey, ctx, locale, intent, session);
    const dest =
      ctx.destination ??
      session.tripPlanningContext?.destination ??
      session.tripDestination?.city ??
      "這趟";
    const pendingQuestion: PendingQuestion | undefined =
      nextKey === "vibe" && isDestinationPlanning
        ? pendingQuestionForDestinationStyleChoice(
            dest,
            ctx.destinationCountry ?? session.travelContext?.destinationCountry,
          )
        : undefined;
    console.info("[AI_ROUTE] next_question", nextKey, logTravelContext(ctx), `intent=${intent}`);
    return {
      mode: "clarify",
      chatPhase: "discover",
      missingKey: nextKey,
      question,
      pendingQuestion,
    };
  }

  console.info("[AI_ROUTE] recommendation_mode", "fallback-ready", logTravelContext(ctx));
  return { mode: "recommend", chatPhase: "recommend" };
}

export function markAskedClarifyKey(
  session: ChatPlanningSession,
  key: TripIntentMissingKey,
): ChatPlanningSession {
  const prev = session.askedClarifyKeys ?? [];
  if (prev.includes(key)) return session;
  return { ...session, askedClarifyKeys: [...prev, key] };
}
