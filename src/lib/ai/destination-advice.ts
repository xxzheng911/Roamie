import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isCountryCityInquiryText,
  isDestinationAdviceText,
  isDestinationSelectionText,
  isFutureTripPlanningStatement,
  isKnownCountryLabel,
  isKnownDestinationLabel,
  isKnownScenicLabel,
  isKnownTouristCityLabel,
  isValidParsedDestinationLabel,
  coerceTravelDestination,
  normalizeDestinationLabel,
  parseDestinationFromText,
  parseDestinationSelectionFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";
import {
  inferPendingQuestionFromAdviceReply,
  isAskDaysPending,
  isFlexiblePreferenceReply,
  parseAskDaysFromText,
  parseAskDaysClarification,
  parsePendingOptionSelection,
  resolveFreeFormRegionChoice,
  pendingQuestionForTripPreference,
  pendingQuestionForDestinationStyleChoice,
  pendingQuestionForItineraryAction,
  pendingQuestionForPlanningNextStep,
  pendingQuestionForCombinationChoice,
  pendingQuestionForCountryRegionChoice,
  USE_DEFAULT_ROUTES,
  isItineraryNextStepPending,
  parseItineraryNextStepSelection,
  type PendingQuestion,
} from "@/lib/ai/destination-pending-question";
import { advanceAfterPendingSelection } from "@/lib/ai/chat-turn-engine";
import { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";
import {
  contextPatchForPreferenceSelection,
  shouldSkipAskingDays,
} from "@/lib/ai/chat-conversation-state";
import { buildCityDaysConfirmedReply, buildDateAndDurationQuestionReply, pendingQuestionForAskDays } from "@/lib/ai/city-days-planning";
import { buildWeatherConstraintAcknowledgement } from "@/lib/ai/weather-planning-reply";
import { buildScenicMonthPlanningReply, buildScenicMonthPlanningResult } from "@/lib/ai/scenic-month-reply";
import {
  buildCountryCityOptions,
  validateCountryCityOptions,
  type CountryCityOption,
} from "@/lib/ai/country-city-options";
import { buildDestinationOptionsFromCityList } from "@/lib/ai/destination-anchor";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import {
  canDiscoverDestinationPlaces,
  evaluateDestinationScopeGate,
  isCountryLevelDestination,
  logCombinationFlowTriggered,
  logConversationStageTransition,
  logCountryLevelPlacesBlocked,
  logDestinationCityRequired,
  logTripIntentScopeSummary,
} from "@/lib/ai/destination-scope";
import { resolveSuggestedTripDates } from "@/lib/ai/resolve-suggested-trip-dates";
import {
  hasUserSpecifiedTravelMonth,
  isBestSeasonQuestion,
} from "@/lib/ai/season-response-guardrail";
import {
  isBestTravelTimeIntent,
  logChatBestTravelTimeTriggered,
  logChatDestinationContext,
  logChatIntentPriority,
  logChatTimeIntent,
  logChatTravelDateExists,
} from "@/lib/ai/best-travel-time-intent";
import {
  buildBestTravelTimeReply,
  buildTravelDateAssessmentReply,
} from "@/lib/ai/destination-season-reply";
import {
  buildCreateItineraryAckReply,
  isCreateItineraryIntent,
  logChatCreateItineraryTriggered,
  parseActivityPreferencesFromText,
} from "@/lib/ai/chat-context-intent";
import {
  extractItineraryEntitiesFromText,
  extractItineraryDestinationFromText,
  logItineraryDaysParsed,
  logItineraryDateParsed,
  logItineraryDestinationParsed,
} from "@/lib/ai/itinerary-entity-extraction";
import {
  buildDailyRhythmReply,
  buildMustVisitPlacesReply,
  detectMustVisitIntent,
  detectPlaceRecommendationIntent,
  parseMustVisitPlacesIntent,
  parsePlanningFollowUpIntent,
  resolveMustVisitAdvice,
  resolveMustVisitDestination,
} from "@/lib/ai/must-visit-places";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { isComboItineraryQuery } from "@/lib/ai/chat-category-place-guard";
import { logChatWrongFallbackBlocked } from "@/lib/ai/chat-place-flow-log";
import {
  hasExplicitPlaceRecommendationIntent,
  isCombinationSelectionGrammar,
  logCombinationPendingBypassed,
  parsePlaceRecommendationIntent,
  shouldBypassCombinationPending,
} from "@/lib/ai/place-recommendation-intent";
import {
  buildItineraryPlanningReply,
  buildDailyRecommendationsReply,
  isReadyForItineraryPlanning,
  parseItineraryPlanModeIntent,
  itineraryGenerationStatusReply,
} from "@/lib/ai/itinerary-planning";
import { parseTripPreferences, type TripInterest } from "@/lib/ai/trip-preference";
import { roamieRecToChatItem } from "@/lib/chat-session";
import {
  buildCombinationAllowlistFromTitles,
  buildCombinationSelectionAllowlist,
  buildDestinationCombinationSuggestionsReply,
  buildOfferedCombinationsForSession,
  buildSafeCombinationRecommendations,
  filterSuggestionsByDestinationScope,
  flattenDestinationCombinationPlaces,
  hasDestinationCombinations,
  hasDestinationPlanningBasics,
  isSoftAcceptAllCombinationsReply,
  logChatDestinationScopeLock,
  resolveSelectedCombinations,
  type CombinationSelectionAllowlist,
} from "@/lib/ai/destination-combination-suggestions";
import { parseNearbyExtensionsFromText } from "@/lib/ai/combination-selection-reply";
import {
  buildDestinationRecommendationFailedMessage,
  REFRESH_DESTINATION_RECOMMENDATIONS_OPTION,
  getLastCombinationDiscoveryFailure,
  getLastFinalizedDestinationScopePatch,
} from "@/lib/ai/destination-combination-discovery";
import {
  isAcceptPreviousSuggestionsIntent,
  logChatAcceptPreviousSuggestions,
  logChatPreviousSuggestionsUsed,
  logItineraryCreateFromAcceptedSuggestions,
} from "@/lib/ai/accept-previous-suggestions-intent";
import {
  shouldAskTripDuration,
  shouldAskTripStyle,
  buildAskTripDurationAdviceResult,
  buildAskTripStyleAdviceResult,
  buildTripStyleSelectionAdviceResult,
  mergeDateRangeIntoContext,
  resolveInferredTripDays,
  parseAskTripStyleSelection,
  parseTripStyleKey,
} from "@/lib/ai/ai-trip-style";
import {
  buildDestinationDirectionAck,
  evaluateCombinationDiscoveryGuard,
  hasValidTripDuration,
  logCombinationDiscoveryGuard,
  logConversationStateTransition,
  logTripDurationGuard,
  resolveValidTripDays,
  tripDurationFieldsFromContext,
} from "@/lib/ai/trip-duration-guard";

export type DestinationAdvicePurpose =
  | "create_itinerary"
  | "best_time_to_visit"
  | "seasonal_destination"
  | "itinerary_planning"
  | "region_selected"
  | "destination_selection"
  | "route_combination_selected"
  | "trip_style_selected"
  | "duration_selected"
  | "option_selected"
  | "must_visit_places"
  | "daily_rhythm"
  | "ready_for_itinerary"
  | "destination_style_default"
  | "combination_suggestions_offered"
  | "create_itinerary_from_accepted";

export type DestinationAdviceResult = {
  reply: string | null;
  pendingQuestion?: PendingQuestion;
  contextPatch?: Partial<CanonicalTravelContext>;
  recommendations?: RoamieRecommendationItem[];
  recommendationsTitle?: string;
  /** 觸發 Places API + generateItinerary，不可只回文字草稿 */
  triggerItineraryGeneration?: boolean;
  /** 觸發依行程風格生成地點卡／分天推薦 */
  triggerPlaceRecommendations?: boolean;
};

export function adviceToAssistantChatMsg(advice: DestinationAdviceResult): ChatMsg {
  const content = advice.reply ?? "";
  // Destination itinerary planning: text / choice / loading only — never place cards.
  const tripPurpose = advice.contextPatch?.tripPurpose;
  const suppressPlaceCards =
    !advice.recommendations?.length ||
    tripPurpose === "combination_suggestions_offered" ||
    tripPurpose === "route_combination_selected" ||
    tripPurpose === "direct_itinerary_generation" ||
    tripPurpose === "create_itinerary" ||
    tripPurpose === "create_itinerary_from_accepted" ||
    advice.triggerItineraryGeneration === true ||
    advice.pendingQuestion?.type === "combination_choice";

  if (suppressPlaceCards) {
    return { role: "assistant", content };
  }
  return {
    role: "assistant",
    content,
    roamie: {
      title: advice.recommendationsTitle ?? "必去推薦",
      summary: content,
      moodTag: "",
      recommendations: advice.recommendations!,
      itinerary: [],
    },
  };
}

export function applyAdviceResultToSession(
  session: ChatPlanningSession,
  advice: DestinationAdviceResult,
): ChatPlanningSession {
  const recs = advice.recommendations?.map(roamieRecToChatItem) ?? [];

  const withContext = advice.contextPatch
    ? {
        ...session,
        travelContext: {
          ...(session.travelContext ?? { interests: [] }),
          ...advice.contextPatch,
        },
      }
    : session;

  if (!recs.length) return withContext;

  return {
    ...withContext,
    recommendedPlaces: recs,
  };
}

export { isFlexiblePreferenceReply } from "@/lib/ai/destination-pending-question";

function buildItineraryGenerationAdvice(
  ctx: CanonicalTravelContext,
  extra?: Partial<CanonicalTravelContext>,
): DestinationAdviceResult | null {
  const reply = itineraryGenerationStatusReply(ctx);
  if (!reply) return null;
  const label = ctx.destination ? normalizeDestinationLabel(ctx.destination) : undefined;
  return {
    reply,
    triggerItineraryGeneration: true,
    contextPatch: {
      destination: label ?? ctx.destination,
      days: ctx.days,
      selectedPlanMode: "full_itinerary",
      conversationState: "ready_for_itinerary",
      tripPurpose: "direct_itinerary_generation",
      ...extra,
    },
  };
}

function allowlistContextPatch(
  allowlist: CombinationSelectionAllowlist,
  dest: string,
  days: number,
  labelList: string,
): Partial<CanonicalTravelContext> {
  const offered = buildOfferedCombinationsForSession(dest).map((combo) => {
    const isSelected = allowlist.selectedCombinationIds.includes(combo.id);
    return {
      ...combo,
      places: combo.places.map((p) => ({
        ...p,
        isRequiredBySelection: isSelected,
        destination: p.destination ?? dest,
      })),
    };
  });
  const requiredPlaces = offered
    .filter((c) => allowlist.selectedCombinationIds.includes(c.id))
    .flatMap((c) => c.places.map((p) => p.originalName ?? p.name));
  logAiPipeline(
    "[SELECTED_COMBINATIONS_CONFIRMED]",
    `ids=[${allowlist.selectedCombinationIds.join(",")}]`,
  );
  logAiPipeline(
    "[SELECTED_PLACE_POOL_BUILT]",
    `count=${requiredPlaces.length}`,
    `places=[${requiredPlaces.join(",")}]`,
  );
  return {
    destination: dest,
    days,
    selectedTripStyle: labelList,
    travelStyle: labelList,
    selectedCombinationIds: allowlist.selectedCombinationIds,
    selectedCombinationPlaceNames: allowlist.allowedPlaceNames,
    excludedCombinationPlaceNames: allowlist.exclusiveExcludedPlaceNames,
    selectionSource: allowlist.selectionSource,
    offeredCombinations: offered,
    tripPurpose: "route_combination_selected",
    conversationState: "ready_for_itinerary",
  };
}

function buildAllowlistFromLockedContext(
  dest: string,
  ctx: CanonicalTravelContext,
): CombinationSelectionAllowlist | null {
  const ids = ctx.selectedCombinationIds ?? [];
  if (!ids.length) return null;
  if (ctx.selectedCombinationPlaceNames?.length) {
    return {
      selectedCombinationIds: ids,
      selectedCombinationIndexes: ids.map((id) => id - 1),
      allowedTitles: ctx.selectedTripStyle
        ? ctx.selectedTripStyle.split("、").map((s) => s.trim()).filter(Boolean)
        : [],
      allowedPlaceNames: ctx.selectedCombinationPlaceNames,
      excludedTitles: [],
      exclusiveExcludedPlaceNames: ctx.excludedCombinationPlaceNames ?? [],
      selectionSource: ctx.selectionSource,
    };
  }
  return (
    buildCombinationAllowlistFromTitles(
      dest,
      ctx.selectedTripStyle?.split("、").map((s) => s.trim()).filter(Boolean) ?? [],
    ) ?? buildCombinationSelectionAllowlist(dest, "全部")
  );
}

/**
 * Combination selection → GENERATING_ITINERARY.
 * Lock allowlist on context; do NOT attach place cards to the chat reply.
 */
function buildCombinationSelectionGenerationAdvice(params: {
  ctx: CanonicalTravelContext;
  dest: string;
  days: number;
  userText: string;
  titleFallback?: string[];
}): DestinationAdviceResult | null {
  const { ctx, dest, days, userText, titleFallback } = params;
  const allowlist =
    buildCombinationSelectionAllowlist(dest, userText) ??
    (titleFallback?.length
      ? buildCombinationAllowlistFromTitles(dest, titleFallback)
      : null);
  if (!allowlist?.allowedPlaceNames.length) return null;

  const labelList = allowlist.allowedTitles.join("、") || "建議組合";
  const nearbyExtensions = parseNearbyExtensionsFromText(userText, dest);
  const patch: Partial<CanonicalTravelContext> = {
    ...allowlistContextPatch(allowlist, dest, days, labelList),
    ...(nearbyExtensions.length
      ? {
          nearbyExtensions,
          unresolvedNearbyExtensions: nearbyExtensions,
        }
      : {}),
  };
  const gen = buildItineraryGenerationAdvice(
    {
      ...ctx,
      destination: dest,
      days,
      selectedTripStyle: labelList,
      travelStyle: labelList,
      ...(nearbyExtensions.length ? { nearbyExtensions } : {}),
    },
    patch,
  );
  if (!gen) return null;

  logAiPipeline(
    "[COMBINATION_SELECTION_LOCKED]",
    `destination=${dest}`,
    `selectedIds=${allowlist.selectedCombinationIds.join(",")}`,
    `selectionSource=${allowlist.selectionSource ?? "unknown"}`,
    `allowedPlaces=${allowlist.allowedPlaceNames.length}`,
    `excludedExclusive=${allowlist.exclusiveExcludedPlaceNames.join("|")}`,
  );
  logAiPipeline(
    "[COMBINATION_SELECTION_PARSED]",
    `rawInput=${userText.trim()}`,
    `selectedCombinationIds=[${allowlist.selectedCombinationIds.join(",")}]`,
  );

  return {
    ...gen,
    reply: [
      `好，我會以${labelList}為主，幫你安排 ${dest} ${days} 天行程。`,
      "正在整理並規劃中…",
    ].join("\n"),
    // Never render candidate place cards during GENERATING_ITINERARY.
    recommendations: undefined,
    recommendationsTitle: undefined,
    pendingQuestion: undefined,
  };
}

function resolveContextDestination(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): string | undefined {
  const raw =
    coerceTravelDestination(ctx.destination) ??
    coerceTravelDestination(session.tripPlanningContext?.destination) ??
    coerceTravelDestination(session.tripDestination?.city);
  return raw ? normalizeDestinationLabel(raw) : undefined;
}

function resolveItineraryAbSelectionAdvice(
  selected: "full_itinerary" | "daily_recommendations",
  ctx: CanonicalTravelContext,
  userText: string,
  pending: PendingQuestion,
): DestinationAdviceResult | null {
  const dest = coerceTravelDestination(pending.baseDestination ?? ctx.destination);

  if (selected === "full_itinerary") {
    if (!dest) {
      return {
        reply: null,
        pendingQuestion: undefined,
        contextPatch: {
          selectedPlanMode: "full_itinerary",
          destination: undefined,
          tripPurpose: "create_itinerary",
        },
      };
    }
    const gen = buildItineraryGenerationAdvice(
      {
        ...ctx,
        destination: dest,
        days: ctx.days ?? parseDayCountFromText(userText),
      },
      {
        destination: dest,
        destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
        days: ctx.days,
      },
    );
    if (gen) {
      return { ...gen, pendingQuestion: undefined };
    }
  }

  if (selected === "daily_recommendations") {
    if (!dest) {
      return {
        reply: null,
        pendingQuestion: undefined,
        contextPatch: {
          selectedPlanMode: "daily_recommendations",
          destination: undefined,
          tripPurpose: "recommend_places",
        },
      };
    }
    const mustVisit = resolveMustVisitAdvice({ ...ctx, destination: dest }, userText);
    if (mustVisit) {
      return {
        reply: mustVisit.reply,
        recommendations: mustVisit.recommendations,
        recommendationsTitle: `${normalizeDestinationLabel(dest)}推薦`,
        pendingQuestion: undefined,
        contextPatch: {
          ...mustVisit.contextPatch,
          selectedPlanMode: "daily_recommendations",
          destination: dest,
          conversationState: "itinerary_draft",
          tripPurpose: "itinerary_draft",
          mustVisitGenerated: true,
          planningStage: "recommendations_generated",
        },
      };
    }
  }

  return null;
}

function resolveContextDays(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText?: string,
): number | undefined {
  return resolveInferredTripDays(ctx, session, userText);
}

function resolvePreviousSuggestionPlaces(
  destination: string,
  session: ChatPlanningSession,
): RoamieRecommendationItem[] {
  const fromSession = filterSuggestionsByDestinationScope(
    session.recommendedPlaces.map((p) => ({
      name: p.name,
      placeName: p.placeName ?? p.name,
    })),
    destination,
  ).map((p) =>
    normalizeRecommendationItem({
      name: p.name,
      placeName: p.placeName ?? p.name,
      type: "景點",
      description: "上一輪推薦",
      reason: "上一輪推薦",
      reasonSource: "template",
      address: destination,
    }),
  );

  if (fromSession.length >= 3) {
    logChatPreviousSuggestionsUsed(fromSession.length, "session_recommended");
    return fromSession;
  }

  const fromSelected = filterSuggestionsByDestinationScope(
    session.selectedPlaces.map((p) => ({
      name: p.name,
      placeName: p.placeName ?? p.name,
    })),
    destination,
  );
  if (fromSelected.length >= 3) {
    logChatPreviousSuggestionsUsed(fromSelected.length, "session_selected");
    return fromSelected.map((p) =>
      normalizeRecommendationItem({
        name: p.name,
        placeName: p.placeName ?? p.name,
        type: "景點",
        description: "已選地點",
        reason: "已選地點",
        reasonSource: "template",
        address: destination,
      }),
    );
  }

  const comboPlaces = flattenDestinationCombinationPlaces(destination);
  logChatPreviousSuggestionsUsed(comboPlaces.length, "destination_combinations");
  return buildSafeCombinationRecommendations(destination);
}

function resolveAcceptPreviousSuggestionsAdvice(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): DestinationAdviceResult | null {
  if (!isAcceptPreviousSuggestionsIntent(userText, ctx, session)) return null;

  const destination = resolveContextDestination(ctx, session);
  const days = resolveContextDays(ctx, session, userText);
  if (!destination || !days) return null;

  if (session.pendingQuestion?.type === "ask_days") {
    const parsedDays = parseAskDaysFromText(userText, session.pendingQuestion);
    if (!parsedDays) return null;
  }

  logChatAcceptPreviousSuggestions(destination, days, userText);

  const awaitingCombinations =
    ctx.tripPurpose === "combination_suggestions_offered" ||
    session.pendingQuestion?.type === "combination_choice" ||
    Boolean(ctx.offeredCombinations?.length);

  // 「都不錯」= lock all combinations; do NOT start generation until「幫我生成」.
  if (
    awaitingCombinations &&
    isSoftAcceptAllCombinationsReply(userText) &&
    hasDestinationCombinations(destination)
  ) {
    const allowlist = buildCombinationSelectionAllowlist(destination, userText);
    if (!allowlist?.allowedPlaceNames.length) return null;
    const labelList = allowlist.allowedTitles.join("、") || "建議組合";
    const patch = allowlistContextPatch(allowlist, destination, days, labelList);
    logAiPipeline(
      "[COMBINATION_SELECTION_PARSED]",
      `rawInput=${userText.trim()}`,
      `selectedCombinationIds=[${allowlist.selectedCombinationIds.join(",")}]`,
      `selectionSource=${allowlist.selectionSource ?? "all_selected_by_user"}`,
    );
    logAiPipeline(
      "[COMBINATION_SELECTION_LOCKED]",
      `destination=${destination}`,
      `selectedIds=${allowlist.selectedCombinationIds.join(",")}`,
      `selectionSource=${allowlist.selectionSource ?? "all_selected_by_user"}`,
      `deferredGeneration=true`,
    );
    return {
      reply: [
        `好，我先記下全部組合：${labelList}。`,
        `回覆「幫我生成」就可以開始排 ${destination} ${days} 天行程。`,
      ].join("\n"),
      triggerItineraryGeneration: false,
      recommendations: undefined,
      recommendationsTitle: undefined,
      pendingQuestion: {
        type: "activity_choice",
        options: ["幫我生成", "重新選擇組合"],
        baseDestination: destination,
        destinationCountry:
          ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      },
      contextPatch: {
        ...patch,
        tripPurpose: "route_combination_selected",
        conversationState: "ready_for_itinerary",
      },
    };
  }

  logItineraryCreateFromAcceptedSuggestions(destination, days);

  if (hasDestinationCombinations(destination)) {
    const comboGen = buildCombinationSelectionGenerationAdvice({
      ctx,
      dest: destination,
      days,
      userText,
    });
    if (comboGen) {
      return {
        ...comboGen,
        contextPatch: {
          ...comboGen.contextPatch,
          tripPurpose: "create_itinerary_from_accepted",
        },
      };
    }
  }

  const recommendations = resolvePreviousSuggestionPlaces(destination, session);
  const gen = buildItineraryGenerationAdvice(
    { ...ctx, destination, days },
    {
      destination,
      days,
      destinationCountry: ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      tripPurpose: "create_itinerary_from_accepted",
      conversationState: "ready_for_itinerary",
    },
  );
  if (!gen) return null;

  return {
    ...gen,
    recommendations,
    recommendationsTitle: `${destination}行程地點`,
  };
}

function resolveDestinationCombinationsAdvice(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): DestinationAdviceResult | null {
  const destination = resolveContextDestination(ctx, session);
  const days = resolveValidTripDays({
    ...tripDurationFieldsFromContext(ctx, session),
    days: resolveContextDays(ctx, session),
  });
  const guard = evaluateCombinationDiscoveryGuard({
    destination,
    destinationType: ctx.destinationType,
    destinationCountry: ctx.destinationCountry,
    destinationCity: ctx.destinationCity,
    destinationCountryCode: ctx.destinationCountryCode,
    destinationCoordinates: ctx.destinationCoordinates,
    destinationScopeId: ctx.destinationScopeId,
    days,
    tripDays: session.tripDays,
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    pendingQuestion: session.pendingQuestion,
    session,
  });
  logCombinationDiscoveryGuard(guard, destination);
  if (!guard.allowed || !destination || days == null) {
    if (guard.reason === "missing_trip_duration") {
      logTripDurationGuard({
        tripDays: days ?? ctx.days ?? null,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
        valid: false,
        nextState: "waitingTripDays",
      });
    }
    return null;
  }

  if (!canDiscoverDestinationPlaces(destination) || isCountryLevelDestination(destination)) {
    logCountryLevelPlacesBlocked(destination, "city_required");
    return null;
  }

  if (!hasDestinationCombinations(destination)) return null;

  logChatDestinationScopeLock(destination);

  const suggestedDates = resolveSuggestedTripDates({
    days,
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    suggestedStartDate: ctx.suggestedStartDate,
    travelMonth: ctx.travelMonth,
  });
  const startDate = suggestedDates?.startDate ?? ctx.startDate;
  const endDate = suggestedDates?.endDate ?? ctx.endDate;

  const hasExactDate =
    Boolean(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate!.trim()) &&
    Boolean(endDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate!.trim());

  if (hasExactDate) {
    logAiPipeline(
      "[TRIP_DATE_RANGE_PARSED]",
      `startDate=${startDate}`,
      `endDate=${endDate}`,
      `tripDays=${days}`,
    );
    logConversationStageTransition(
      "COLLECTING_DATE_AND_DURATION",
      "AWAITING_COMBINATION_SELECTION",
    );
  }

  logCombinationFlowTriggered({
    city: destination,
    tripDays: days,
    startDate,
    endDate,
  });

  const reply = buildDestinationCombinationSuggestionsReply(destination, days, {
    startDate: hasExactDate ? startDate : undefined,
    endDate: hasExactDate ? endDate : undefined,
    weatherLine: buildDestinationDirectionAck({
      destination,
      tripDays: days,
      startDate: hasExactDate ? startDate : undefined,
      endDate: hasExactDate ? endDate : undefined,
    }),
    tentativeDates: Boolean(hasExactDate && startDate && endDate),
  });
  if (!reply) {
    const failure = getLastCombinationDiscoveryFailure();
    logAiPipeline(
      "[LEGACY_TRIP_REPLY_BLOCKED]",
      "template=trip_summary_or_direct_choice",
      `destination=${destination}`,
    );
    logAiPipeline(
      "[TRIP_REPLY_PIPELINE_SUMMARY]",
      `destination=${destination}`,
      `tripDays=${days}`,
      "combinationDiscoverySuccess=false",
      "localizationRepairResult=n/a",
      "combinationCount=0",
      "legacyReplyBlocked=true",
      "newReplyBuilt=false",
      "finalReplyStatus=failure",
      `finalFailureReason=${failure?.reason ?? failure?.detail ?? "combination_reply_empty"}`,
    );
    // Theme directions are search-only — never render category labels as places.
    // Preserve destination / dates so refresh only re-runs discovery.
    // Legacy blocker only suppresses old templates — failure reason must reflect
    // real place/combination shortage, not localization English fallback.
    const scopePatch = getLastFinalizedDestinationScopePatch();
    return {
      reply: buildDestinationRecommendationFailedMessage(
        destination,
        failure?.reason ?? failure?.detail,
      ),
      recommendations: undefined,
      recommendationsTitle: undefined,
      pendingQuestion: {
        type: "ask_preference",
        options: [REFRESH_DESTINATION_RECOMMENDATIONS_OPTION],
      },
      contextPatch: {
        destination,
        destinationCountry:
          scopePatch?.destinationCountry ??
          ctx.destinationCountry ??
          session.travelContext?.destinationCountry,
        destinationType:
          (scopePatch?.destinationType as CanonicalTravelContext["destinationType"]) ??
          ctx.destinationType,
        destinationCity: scopePatch?.destinationCity ?? ctx.destinationCity,
        destinationRegion: scopePatch?.destinationRegion ?? ctx.destinationRegion,
        days,
        startDate,
        endDate,
        tripPurpose: "combination_discovery_failed",
        conversationState: "awaiting_preference",
        lastItineraryFailure: failure
          ? {
              code: failure.reason,
              stage: "combination_discovery",
              detailRetryCount: 0,
              generationRequestId: ctx.generationRequestId,
            }
          : undefined,
      },
    };
  }

  logAiPipeline(
    "[TRIP_REPLY_PIPELINE_SUMMARY]",
    `destination=${destination}`,
    `tripDays=${days}`,
    "combinationDiscoverySuccess=true",
    "localizationRepairResult=delivered",
    `combinationCount=${(reply.match(/^\d+\./gm) ?? []).length}`,
    "legacyReplyBlocked=false",
    "newReplyBuilt=true",
    "finalReplyStatus=success",
    "finalFailureReason=",
  );

  logAiPipeline(
    "[NEXT_STEP_RESOLUTION]",
    `destination=${destination}`,
    `tripDays=${days}`,
    "selectedCombinationIds=[]",
    "resolvedNextStep=show_combination_options",
  );
  logAiPipeline(
    "[DIRECT_ITINERARY_GENERATION_BLOCKED]",
    "reason=no_combination_selected",
  );

  const successScope = getLastFinalizedDestinationScopePatch();
  const resolvedCountry =
    successScope?.destinationCountry ??
    ctx.destinationCountry ??
    session.travelContext?.destinationCountry;
  const resolvedType =
    (successScope?.destinationType as CanonicalTravelContext["destinationType"]) ??
    ctx.destinationType ??
    "city";
  const isRegionLike =
    resolvedType === "region" ||
    resolvedType === "island" ||
    resolvedType === "state";

  // Text-only: never attach candidate place cards during combination selection.
  return {
    reply,
    recommendations: undefined,
    recommendationsTitle: undefined,
    pendingQuestion: pendingQuestionForCombinationChoice(destination, resolvedCountry),
    contextPatch: {
      destination,
      destinationType: resolvedType,
      destinationCity: isRegionLike
        ? undefined
        : (successScope?.destinationCity ?? ctx.destinationCity ?? destination),
      destinationRegion: isRegionLike
        ? (successScope?.destinationRegion ?? destination)
        : ctx.destinationRegion,
      destinationCountry: resolvedCountry,
      days,
      startDate,
      endDate,
      tripPurpose: "combination_suggestions_offered",
      conversationState: "awaiting_preference",
      planningStage: "recommendations_generated",
      offeredCombinations: buildOfferedCombinationsForSession(destination),
      // Do NOT set mustVisitGenerated — that unlocks place-card display paths.
    },
  };
}

function resolveCreateItineraryAdvice(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): DestinationAdviceResult | null {
  const planMode = parseItineraryPlanModeIntent(userText);
  const hasCreateIntent =
    isCreateItineraryIntent(userText) || planMode === "full_itinerary";
  if (!hasCreateIntent) return null;

  const contextDestination =
    ctx.destination?.trim() &&
    isValidParsedDestinationLabel(normalizeDestinationLabel(ctx.destination))
      ? normalizeDestinationLabel(ctx.destination)
      : session.tripPlanningContext?.destination?.trim() ||
        session.tripDestination?.city?.trim();
  const contextDays = ctx.days ?? session.tripDays ?? parseDayCountFromText(userText);
  if (!contextDestination || !contextDays) return null;

  // Soft accept-all phrases are handled by accept-previous — never race-generate here.
  if (isSoftAcceptAllCombinationsReply(userText)) return null;

  // No combination selected → never start formal itinerary from chat.
  const selectedIds =
    ctx.selectedCombinationIds ?? session.travelContext?.selectedCombinationIds ?? [];
  if (!selectedIds.length) {
    logAiPipeline(
      "[DIRECT_ITINERARY_GENERATION_BLOCKED]",
      "reason=no_combination_selected",
      `destination=${contextDestination}`,
      `tripDays=${contextDays}`,
    );
    return null;
  }

  logAiPipeline("[ITINERARY_CREATE_TRIGGERED_FROM_CHAT]", {
    destination: contextDestination,
    days: contextDays,
    text: userText.slice(0, 80),
  });
  logAiPipeline("[ITINERARY_CONTEXT_PLACES]", {
    selectedPlaces: session.selectedPlaces.length,
    recommendedPlaces: session.recommendedPlaces?.length ?? 0,
    plannedStops: session.plannedStops?.length ?? 0,
  });

  const needsCombinationLock =
    hasDestinationCombinations(contextDestination) &&
    (ctx.tripPurpose === "combination_suggestions_offered" ||
      ctx.tripPurpose === "route_combination_selected" ||
      session.pendingQuestion?.type === "combination_choice" ||
      Boolean(ctx.selectedCombinationIds?.length) ||
      Boolean(ctx.offeredCombinations?.length));

  if (needsCombinationLock) {
    const locked = buildAllowlistFromLockedContext(contextDestination, ctx);
    if (locked?.selectedCombinationIds.length) {
      logAiPipeline(
        "[ITINERARY_GENERATION_SELECTION]",
        `selectedCombinationIds=[${locked.selectedCombinationIds.join(",")}]`,
      );
      const labelList = locked.allowedTitles.join("、") || "建議組合";
      const gen = buildItineraryGenerationAdvice(
        { ...ctx, destination: contextDestination, days: contextDays },
        {
          ...allowlistContextPatch(locked, contextDestination, contextDays, labelList),
          destinationCountry:
            ctx.destinationCountry ?? session.travelContext?.destinationCountry,
        },
      );
      if (gen) return gen;
    }
    const comboGen = buildCombinationSelectionGenerationAdvice({
      ctx,
      dest: contextDestination,
      days: contextDays,
      userText,
    });
    if (comboGen) {
      logAiPipeline(
        "[ITINERARY_GENERATION_SELECTION]",
        `selectedCombinationIds=[${comboGen.contextPatch?.selectedCombinationIds?.join(",") ?? ""}]`,
      );
      return comboGen;
    }
    logAiPipeline(
      "[ITINERARY_INPUT_VALIDATION_FAILED]",
      "field=selectedCombinationIds",
      "value=[]",
      `destination=${contextDestination}`,
    );
    return {
      reply: "我還需要你確認想用哪些組合，才能幫你生成行程。回覆組合編號，或回「都不錯」全選。",
      triggerItineraryGeneration: false,
      pendingQuestion: pendingQuestionForCombinationChoice(
        contextDestination,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      ),
      contextPatch: {
        destination: contextDestination,
        days: contextDays,
        tripPurpose: "combination_suggestions_offered",
        conversationState: "awaiting_preference",
        offeredCombinations:
          ctx.offeredCombinations ?? buildOfferedCombinationsForSession(contextDestination),
      },
    };
  }

  return buildItineraryGenerationAdvice(
    { ...ctx, destination: contextDestination, days: contextDays },
    {
      destination: contextDestination,
      days: contextDays,
      destinationCountry: ctx.destinationCountry ?? session.travelContext?.destinationCountry,
    },
  );
}

/** Structured city/region option for country-level selection replies. */
export type { CountryCityOption };

type CountryAdvice = {
  bestTime: string[];
  /** Legacy fragment used by older templates. */
  cities: string;
  /** Concrete city / region / island destinations only (never travel styles). */
  cityOptions: Array<Omit<CountryCityOption, "country"> | CountryCityOption>;
};

const COUNTRY_ADVICE: Record<string, CountryAdvice> = {
  韓國: {
    bestTime: [
      "韓國我會比較推薦 4～5 月或 10～11 月。",
      "4～5 月天氣舒服、櫻花和春季散步感很好；10～11 月有楓葉，拍照和城市散策都很適合。",
      "如果你怕冷，不太建議 12～2 月；如果想省預算，可以看 3 月或 11 月底。",
    ],
    cities: "首爾、釜山，還是濟州島",
    cityOptions: [
      { name: "首爾", type: "city", summary: "購物、咖啡廳、美食與夜生活" },
      { name: "釜山", type: "city", summary: "海景、海鮮與較慢步調" },
      { name: "濟州島", type: "island", summary: "自然風景、自駕與放鬆" },
    ],
  },
  日本: {
    bestTime: [
      "日本我會比較推薦 3～5 月或 10～11 月。",
      "春天有櫻花、天氣舒服；秋天楓葉很美，城市散策和溫泉都很適合。",
      "夏天適合祭典和海邊，但較悶熱；冬天北海道雪景很棒，關西則偏冷乾。",
    ],
    cities: "東京、大阪、京都，還是北海道",
    cityOptions: [
      { name: "東京", type: "city", summary: "購物、美食、展覽與城市散策" },
      { name: "大阪", type: "city", summary: "美食、商圈與熱鬧夜生活" },
      { name: "京都", type: "city", summary: "寺院、傳統街區與季節景色" },
      { name: "北海道", type: "region", summary: "自然、花季、雪景與較慢步調" },
    ],
  },
  泰國: {
    bestTime: [
      "泰國通常 11 月到隔年 2 月比較舒服，天氣較乾、海邊活動也比較穩定。",
      "如果想避開人潮，可以看 5～6 月或 9～10 月，但要注意午後雷陣雨。",
    ],
    cities: "曼谷、清邁、普吉島，還是蘇梅島",
    cityOptions: [
      { name: "曼谷", type: "city", summary: "美食、按摩、購物和城市行程" },
      { name: "清邁", type: "city", summary: "寺廟、市集與較慢步調的旅行" },
      { name: "普吉島", type: "island", summary: "海灘、度假與海島活動" },
      { name: "蘇梅島", type: "island", summary: "放鬆、海景與較悠閒的行程" },
    ],
  },
  越南: {
    bestTime: [
      "越南南北氣候差異大，整體來說 11～4 月較乾爽、適合旅行。",
      "河內、峴港這段時間舒服；胡志明則 12～3 月較不悶熱。",
    ],
    cities: "河內、峴港，還是胡志明",
    cityOptions: [
      { name: "河內", type: "city", summary: "古城、咖啡與人文散步" },
      { name: "峴港", type: "city", summary: "海灘、中部風景與度假感" },
      { name: "胡志明", type: "city", summary: "都會節奏、美食與夜生活" },
    ],
  },
  新加坡: {
    bestTime: [
      "新加坡全年溫暖，6～8 月較多雨，12～2 月相對舒服一點。",
      "若想避開雨季，可以優先看 2～4 月或 9～11 月。",
    ],
    cities: "濱海灣、牛車水，還是聖淘沙",
    cityOptions: [
      { name: "濱海灣", type: "region", summary: "城市天際線與園區散步" },
      { name: "牛車水", type: "region", summary: "文化巷弄與美食" },
      { name: "聖淘沙", type: "island", summary: "海島放鬆與休閒" },
    ],
  },
  台灣: {
    bestTime: [
      "台灣 3～5 月與 10～11 月通常最舒服，適合環島或城市散策。",
      "夏天較熱多雨，冬天北部偏濕冷，但南部仍算溫暖。",
    ],
    cities: "台北、台中，還是花蓮",
    cityOptions: [
      { name: "台北", type: "city", summary: "都會、夜市與近郊自然" },
      { name: "台中", type: "city", summary: "文創、商圈與輕旅行" },
      { name: "花蓮", type: "city", summary: "海岸、縱谷與較慢步調" },
    ],
  },
  義大利: {
    bestTime: [
      "義大利我會推薦 4～6 月或 9～10 月，天氣舒服、人潮也相對好排。",
      "7～8 月很熱、景點人多；冬天北部偏冷，但米蘭佛羅倫斯仍有城市魅力。",
    ],
    cities: "羅馬、佛羅倫斯、米蘭，還是威尼斯",
    cityOptions: [
      { name: "羅馬", type: "city", summary: "古蹟、博物館與城市散策" },
      { name: "佛羅倫斯", type: "city", summary: "藝術、巷弄與文藝氣氛" },
      { name: "米蘭", type: "city", summary: "時尚、購物與都會節奏" },
      { name: "威尼斯", type: "city", summary: "水道、橋樑與慢旅行" },
    ],
  },
  法國: {
    bestTime: [
      "法國 4～6 月與 9～10 月最舒服，適合巴黎散策和南法小鎮。",
      "夏天南部海邊很熱門但人潮多；冬天適合滑雪或城市博物館行程。",
    ],
    cities: "巴黎、普羅旺斯，還是蔚藍海岸",
    cityOptions: [
      { name: "巴黎", type: "city", summary: "博物館、經典地標與城市散策" },
      { name: "普羅旺斯", type: "region", summary: "小鎮、花季與田園氣氛" },
      { name: "蔚藍海岸", type: "region", summary: "海岸、度假與陽光節奏" },
    ],
  },
  蒙古: {
    bestTime: [
      "蒙古 6～9 月最適合旅行，草原綠意足、氣溫舒服，也比較適合露營和長途移動。",
      "冬季極寒但雪景壯觀，適合想體驗極地風光的人；春秋則較冷，移動要預留彈性。",
    ],
    cities: "烏蘭巴托、特勒吉，還是戈壁",
    cityOptions: [
      { name: "烏蘭巴托", type: "city", summary: "城市起點與文化體驗" },
      { name: "特勒吉", type: "region", summary: "近郊草原與自然風景" },
      { name: "戈壁", type: "region", summary: "沙漠景觀與深度旅程" },
    ],
  },
  美國: {
    bestTime: [
      "美國各地氣候差異很大，春秋通常較舒服，但東西岸與內陸差異明顯。",
      "選定城市或地區後，我再依當地季節幫你看比較適合的日期。",
    ],
    cities: "紐約、洛杉磯、舊金山，還是拉斯維加斯",
    cityOptions: [
      { name: "紐約", type: "city", summary: "城市景點、百老匯、購物與博物館" },
      { name: "洛杉磯", type: "city", summary: "影視景點、海灘與城市公路旅行" },
      { name: "舊金山", type: "city", summary: "城市散策、海灣景色與近郊自然" },
      { name: "拉斯維加斯", type: "city", summary: "娛樂、夜生活與沙漠近郊" },
    ],
  },
  英國: {
    bestTime: [
      "英國 5～9 月通常較舒適，但各地天氣多變，城市與蘇格蘭差異也大。",
      "選定城市或地區後，我再依當地月份幫你看比較適合的日期。",
    ],
    cities: "倫敦、愛丁堡、曼徹斯特，還是湖區",
    cityOptions: [
      { name: "倫敦", type: "city", summary: "博物館、經典地標、購物與城市散策" },
      { name: "愛丁堡", type: "city", summary: "古城、歷史建築與文化景色" },
      { name: "曼徹斯特", type: "city", summary: "音樂、足球與城市文化" },
      { name: "湖區", type: "region", summary: "自然風景、步道與較慢旅行" },
    ],
  },
  荷蘭: {
    bestTime: [
      "荷蘭 4～5 月與 9～10 月通常較舒服；4 月前後部分地區有鬱金香花季。",
      "選定城市後，我再依當地季節幫你看比較適合的日期。",
    ],
    cities: "阿姆斯特丹、鹿特丹、海牙，還是烏得勒支",
    cityOptions: [
      { name: "阿姆斯特丹", type: "city", summary: "運河、博物館與城市散策" },
      { name: "鹿特丹", type: "city", summary: "現代建築、港口與都會節奏" },
      { name: "海牙", type: "city", summary: "海岸、博物館與政治都會" },
      { name: "烏得勒支", type: "city", summary: "運河小鎮與較慢步調" },
    ],
  },
  德國: {
    bestTime: [
      "德國 5～9 月通常較舒服，秋冬偏冷，聖誕市集也很有氣氛。",
      "選定城市後，我再依當地季節幫你看比較適合的日期。",
    ],
    cities: "柏林、慕尼黑、漢堡，還是科隆",
    cityOptions: [
      { name: "柏林", type: "city", summary: "歷史、文創與城市散策" },
      { name: "慕尼黑", type: "city", summary: "啤酒文化、公園與近郊阿爾卑斯" },
      { name: "漢堡", type: "city", summary: "港口、運河與都會節奏" },
      { name: "科隆", type: "city", summary: "大教堂、萊茵河與城市散步" },
    ],
  },
  西班牙: {
    bestTime: [
      "西班牙 4～6 月與 9～10 月通常較舒服；夏季南部偏熱，海邊人潮也多。",
      "選定城市後，我再依當地季節幫你看比較適合的日期。",
    ],
    cities: "巴塞隆納、馬德里、塞維亞，還是瓦倫西亞",
    cityOptions: [
      { name: "巴塞隆納", type: "city", summary: "高第建築、海灘與城市散策" },
      { name: "馬德里", type: "city", summary: "博物館、廣場與都會節奏" },
      { name: "塞維亞", type: "city", summary: "古城、佛朗明哥與南國氣氛" },
      { name: "瓦倫西亞", type: "city", summary: "海岸、市集與輕鬆步調" },
    ],
  },
  澳洲: {
    bestTime: [
      "澳洲南北半球季節相反，東西岸氣候差異也大。",
      "選定城市後，我再依當地季節幫你看比較適合的日期。",
    ],
    cities: "雪梨、墨爾本、布里斯本，還是黃金海岸",
    cityOptions: [
      { name: "雪梨", type: "city", summary: "海港地標、海灘與城市散策" },
      { name: "墨爾本", type: "city", summary: "咖啡文化、巷弄與近郊景觀" },
      { name: "布里斯本", type: "city", summary: "陽光城市與近郊海岸" },
      { name: "黃金海岸", type: "city", summary: "海灘、度假與主題樂園" },
    ],
  },
  加拿大: {
    bestTime: [
      "加拿大各地氣候差異很大，夏季較舒適，冬季部分地區適合看雪與極光。",
      "選定城市後，我再依當地季節幫你看比較適合的日期。",
    ],
    cities: "溫哥華、多倫多、蒙特婁，還是班夫",
    cityOptions: [
      { name: "溫哥華", type: "city", summary: "海岸、山景與城市散策" },
      { name: "多倫多", type: "city", summary: "大都會、博物館與湖岸" },
      { name: "蒙特婁", type: "city", summary: "法文文化、老城與美食" },
      { name: "班夫", type: "region", summary: "國家公園、湖泊與自然風景" },
    ],
  },
};

/** 使用者這輪是否在更新/選定目的地（如「我想去芭達雅」「芭達雅」） */
export function isDestinationUpdateText(
  text: string,
  session?: ChatPlanningSession,
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isFlexiblePreferenceReply(t)) return false;
  if (isDestinationAdviceText(t)) return false;
  if (isDestinationSelectionText(t)) return false;
  if (parseDestinationSelectionFromText(t)) return true;
  if (session && isDestinationAdviceActive(session) && isKnownTouristCityLabel(t)) {
    return true;
  }
  return false;
}

export function parseDestinationAdvicePurpose(text: string): DestinationAdvicePurpose | undefined {
  const t = text.trim();
  if (!t) return undefined;

  if (isCreateItineraryIntent(t)) return "create_itinerary";

  if (isBestTravelTimeIntent(t)) return "best_time_to_visit";

  // Country city inquiry → destination selection (city/region list, not place cards)
  if (isCountryCityInquiryText(t)) {
    return "destination_selection";
  }

  // Future trip narrative (month + country/city + go) → region_selected / planning
  if (isFutureTripPlanningStatement(t)) {
    return "region_selected";
  }

  // Place recommendation must not be treated as destination / region selection
  if (hasCategoryPlaceQuery(t) && !isComboItineraryQuery(t) && !isCreateItineraryIntent(t)) {
    return undefined;
  }

  if (
    /[\u4e00-\u9fff]{2,8}\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天.*(怎麼排|行程|規劃|规划|安排)/.test(
      t,
    )
  ) {
    return "itinerary_planning";
  }

  if (/\d{1,2}\s*月/.test(t) && /(適合|适合).*(去哪|哪裡|哪里|推薦|推荐)/.test(t)) {
    return "seasonal_destination";
  }

  if (
    /(幾月|几月|哪個月|什么時候|什麼時候|何时|何時|幾號|几号|哪一天|哪天|哪日|下個月|下个月|這個月|这个月|花季|最佳.{0,4}季|最佳.{0,4}(?:時間|时间|日期))/.test(
      t,
    )
  ) {
    if (isBestSeasonQuestion(t)) return "best_time_to_visit";
    if (
      resolveDestinationFromText(t) &&
      /(?:想)?去/.test(t) &&
      !/(比較好|比较好|你覺得|觉得)/.test(t)
    ) {
      return "region_selected";
    }
    return "best_time_to_visit";
  }

  if (isDestinationSelectionText(t)) {
    return "destination_selection";
  }

  if ((parseDestinationSelectionFromText(t) || parseDestinationFromText(t)) && !isBestTravelTimeIntent(t)) {
    return "region_selected";
  }

  return undefined;
}

export function isDestinationAdviceActive(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  const purpose = ctx?.tripPurpose ?? session.travelContext?.tripPurpose;
  return (
    session.activeChatIntent === "destination_advice" ||
    purpose === "best_time_to_visit" ||
    purpose === "seasonal_destination" ||
    purpose === "itinerary_planning" ||
    purpose === "region_selected" ||
    purpose === "destination_selection" ||
    purpose === "route_combination_selected" ||
    purpose === "trip_style_selected" ||
    purpose === "duration_selected" ||
    purpose === "option_selected" ||
    purpose === "city_style_selected" ||
    purpose === "must_visit_places" ||
    purpose === "daily_rhythm" ||
    purpose === "ready_for_itinerary" ||
    purpose === "destination_style_default" ||
    purpose === "itinerary_draft"
  );
}

/**
 * Legacy city intro / travel-style templates (Busan style Q, landmark lists, etc.).
 * Always blocked — city confirmation must go to date/duration collection.
 */
function buildLegacyCityStyleFollowupBlocked(
  city: string,
  template: string,
): null {
  logAiPipeline(
    "[LEGACY_CITY_FOLLOWUP_BLOCKED]",
    `destination=${normalizeDestinationLabel(city)}`,
    "stage=COLLECTING_DATE_AND_DURATION",
    `template=${template}`,
    "reason=date_and_duration_required",
  );
  return null;
}

function buildThailandCityReply(city: string): string | null {
  const label = normalizeDestinationLabel(city);
  if (label === "芭達雅" || label === "曼谷" || label === "清邁" || label === "普吉島" || label === "蘇梅島") {
    return buildLegacyCityStyleFollowupBlocked(label, "thailand_city_style_followup");
  }
  return null;
}

function buildKoreaCityReply(city: string): string | null {
  const label = normalizeDestinationLabel(city);
  if (label === "首爾" || label === "釜山" || label === "濟州") {
    return buildLegacyCityStyleFollowupBlocked(label, "korea_city_style_followup");
  }
  return null;
}

function buildJapanCityReply(city: string, userText?: string): string | null {
  if (userText?.trim() && hasCategoryPlaceQuery(userText)) return null;
  const label = normalizeDestinationLabel(city);
  if (label === "東京" || label === "大阪" || label === "京都" || label === "北海道") {
    return buildLegacyCityStyleFollowupBlocked(label, "japan_city_style_followup");
  }
  return null;
}

function buildCountryBestTimeReply(country: string): string | null {
  const advice = COUNTRY_ADVICE[country];
  if (!advice?.cityOptions?.length) return null;
  const built = buildCountryCitySelectionReply({
    country,
    cityOptions: resolveCountryCityOptions(country),
    introLines: advice.bestTime,
  });
  return built?.reply ?? null;
}

const STYLE_ONLY_ENDING_RE =
  /想偏(?:城市|美食|海島)|城市、美食按摩，還是海島放鬆|還是海島放鬆？$/;

const COUNTRY_DATE_QUESTION_BLOCK_RE =
  /你目前有預計的旅行日期或天數嗎|若還沒定日期，可以優先考慮|這幾天很適合|可以直接安排完整行程|你想先看必去景點嗎/;

const COUNTRY_GENERIC_MONTH_WINDOW_RE =
  /可以優先考慮\s*\d+\s*月(?:中旬|上旬|下旬|月初|月底)|優先考慮\s*\d+\s*月中旬/;

const COUNTRY_CITY_SELECTION_ENDING = "你比較想去哪個城市或地區？";
const COUNTRY_CITY_SELECTION_LAST_FALLBACK_ENDING = "你有已經想去的城市或地區嗎？";

/** Country-level seasonal highlight (flower/festival) — never a mid-month travel window. */
function buildCountrySeasonalHighlight(
  country: string,
  monthNum: number,
): string | null {
  const explicit: Record<string, Partial<Record<number, string>>> = {
    韓國: {
      10: "部分地區會逐漸進入楓葉季，但實際時間依城市而不同。",
      11: "部分地區楓葉季氣氛較濃，但實際時間依城市而不同。",
      4: "部分地區進入櫻花季，但實際時間依城市而不同。",
    },
    日本: {
      10: "部分地區開始進入秋色，但實際時間依城市而不同。",
      11: "許多地區會進入賞楓期，但東京、京都與北部地區的時間不同。",
      3: "部分地區進入櫻花季，但北部與南部時間不同。",
      4: "許多地區正值櫻花或花季，實際時間依城市而不同。",
    },
    荷蘭: {
      4: "部分地區正值鬱金香花季，實際盛開時間依城市與當年氣候略有差異。",
    },
    菲律賓: {
      2: "多數海島地區此時偏乾季，較適合跳島、潛水與戶外活動，但各地雨象仍可能不同。",
      1: "多數海島地區此時偏乾季，海邊與戶外活動通常較穩定。",
      11: "開始進入相對乾爽的季節，海島行程通常較好安排。",
      12: "多數海島地區偏乾季，適合海邊與跳島活動。",
    },
  };
  const hit = explicit[country]?.[monthNum];
  if (hit) return hit;

  try {
    const entity = resolveDestinationEntity(country);
    const events = (entity.seasonality.events ?? []).filter((e) =>
      (e.months ?? []).includes(monthNum),
    );
    if (events.length) {
      return `部分地區也可能碰上${events.map((e) => e.label).join("、")}，但實際時間依城市而不同。`;
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveCountryCityOptions(
  country: string,
  month?: number | string | null,
): CountryCityOption[] {
  const label = normalizeDestinationLabel(country);
  const advice = COUNTRY_ADVICE[label];
  const built = buildCountryCityOptions({
    country: label,
    month,
    curatedOptions: advice?.cityOptions,
  });
  return built.options;
}

function sanitizeCountryCitySelectionReply(
  reply: string,
  country: string,
): string {
  let next = reply;
  if (COUNTRY_DATE_QUESTION_BLOCK_RE.test(next)) {
    logAiPipeline("[COUNTRY_REPLY_DATE_QUESTION_BLOCKED]", `country=${country}`);
    next = next
      .split("\n")
      .filter((line) => !COUNTRY_DATE_QUESTION_BLOCK_RE.test(line))
      .join("\n");
  }
  if (COUNTRY_GENERIC_MONTH_WINDOW_RE.test(next)) {
    logAiPipeline(
      "[COUNTRY_REPLY_GENERIC_MONTH_TEMPLATE_BLOCKED]",
      `country=${country}`,
    );
    next = next
      .split("\n")
      .filter((line) => !COUNTRY_GENERIC_MONTH_WINDOW_RE.test(line))
      .join("\n");
  }
  const trimmed = next.replace(/\n{3,}/g, "\n\n").trim();
  if (
    !trimmed.endsWith(COUNTRY_CITY_SELECTION_ENDING) &&
    !trimmed.endsWith(COUNTRY_CITY_SELECTION_LAST_FALLBACK_ENDING)
  ) {
    return `${trimmed}\n\n${COUNTRY_CITY_SELECTION_ENDING}`.trim();
  }
  return trimmed;
}

/**
 * Unified country → city/region selection reply.
 * Ending is always city_selection — never a travel-style-only or date question.
 * City options are always rendered one-per-line from structured cityOptions.
 */
export function buildCountryCitySelectionReply(params: {
  country: string;
  month?: number | string | null;
  seasonalSummary?: string;
  seasonalHighlight?: string | null;
  cityOptions: Array<CountryCityOption | Omit<CountryCityOption, "country"> | string>;
  /** Optional prepend lines (e.g. best-time advice) before city options. */
  introLines?: string[];
}): { reply: string; cityOptions: CountryCityOption[]; endingType: "city_selection" } | null {
  const country = normalizeDestinationLabel(params.country);
  const advice = COUNTRY_ADVICE[country];

  const discovered = buildCountryCityOptions({
    country,
    month: params.month,
    curatedOptions: params.cityOptions.length
      ? params.cityOptions
      : advice?.cityOptions,
  });

  let cityOptions = discovered.options;
  const validation = validateCountryCityOptions(cityOptions, country);
  if (!validation.ok) {
    logAiPipeline(
      "[COUNTRY_CITY_OPTIONS_VALIDATION_FAILED]",
      `country=${country}`,
      `reason=${validation.reason ?? "invalid"}`,
      `count=${cityOptions.length}`,
    );
    // Re-run discovery without relying on the invalid slice.
    const retry = buildCountryCityOptions({
      country,
      month: params.month,
      curatedOptions: advice?.cityOptions,
    });
    cityOptions = retry.options;
  } else {
    cityOptions = validation.options;
  }

  // Known country without options still asks for a city — never fall through.
  if (
    !cityOptions.length &&
    !isKnownCountryLabel(country) &&
    !advice &&
    !isCountryLevelDestination(country)
  ) {
    return null;
  }

  const monthRaw = params.month;
  const monthNum =
    monthRaw == null || monthRaw === ""
      ? null
      : Number(String(monthRaw).replace(/\D/g, "")) || null;

  const lines: string[] = [];

  if (params.introLines?.length) {
    for (const line of params.introLines) {
      if (line.trim()) lines.push(line.trim());
    }
    lines.push("");
  }

  if (monthNum) {
    // Seasonal copy is independent of cityOptions — never drop cities if season data is missing.
    const seasonalSummary =
      params.seasonalSummary?.trim() ||
      `${country} ${monthNum} 月通常體感較舒適，不同地區的天氣與季節特色可能會有差異。`;
    lines.push(seasonalSummary);
    lines.push("");

    const highlight =
      params.seasonalHighlight !== undefined
        ? params.seasonalHighlight
        : buildCountrySeasonalHighlight(country, monthNum);
    if (highlight?.trim()) {
      lines.push(highlight.trim());
      lines.push("");
    }
  } else if (!params.introLines?.length) {
    lines.push(`好，${country}可以玩的城市和地區不少。`);
    lines.push("");
  }

  if (cityOptions.length >= 3) {
    lines.push("可以先從這幾個城市／地區考慮：");
    lines.push("");
    for (const opt of cityOptions) {
      lines.push(`・${opt.name}：${opt.summary}`);
    }
    lines.push("");
    lines.push(COUNTRY_CITY_SELECTION_ENDING);
  } else {
    logAiPipeline("[COUNTRY_CITY_OPTIONS_EMPTY_BLOCKED]", `country=${country}`);
    // Last-resort only — must not be the normal path for known countries.
    lines.push(COUNTRY_CITY_SELECTION_LAST_FALLBACK_ENDING);
  }

  const reply = sanitizeCountryCitySelectionReply(lines.join("\n"), country);

  if (STYLE_ONLY_ENDING_RE.test(reply.split("\n").at(-1) ?? "")) {
    logAiPipeline(
      "[COUNTRY_STYLE_ONLY_QUESTION_BLOCKED]",
      `country=${country}`,
    );
  }

  logAiPipeline(
    "[COUNTRY_CITY_OPTIONS_BUILT]",
    `country=${country}`,
    `month=${monthNum == null ? "none" : String(monthNum)}`,
    `count=${cityOptions.length}`,
    `options=[${cityOptions.map((c) => c.name).join(",")}]`,
  );
  logAiPipeline(
    "[COUNTRY_REPLY_BUILDER_USED]",
    "builder=buildCountryCitySelectionReply",
    `cityOptionCount=${cityOptions.length}`,
  );
  logAiPipeline("[COUNTRY_REPLY_ENDING]", "type=city_selection");
  logAiPipeline("[COUNTRY_REPLY_FORMAT]", "layout=multiline_city_options");
  logAiPipeline(
    "[COUNTRY_DESTINATION_REPLY]",
    `country=${country}`,
    `month=${monthNum == null ? "none" : String(monthNum)}`,
    `cityOptions=[${cityOptions.map((c) => c.name).join(",")}]`,
  );

  return { reply, cityOptions, endingType: "city_selection" };
}

function buildCountrySelectionReply(country: string): string | null {
  const options = resolveCountryCityOptions(country);
  if (!options.length && !isKnownCountryLabel(country)) return null;
  return (
    buildCountryCitySelectionReply({
      country,
      cityOptions: options,
    })?.reply ?? null
  );
}

function countryRegionOptions(country: string): string[] {
  return resolveCountryCityOptions(country).map((o) => o.name);
}

function buildCountryCityCollectAdvice(
  country: string,
  ctx: CanonicalTravelContext,
  _userText: string,
  opts?: { withMonth?: boolean },
): DestinationAdviceResult | null {
  const label = normalizeDestinationLabel(country);
  const monthNum = ctx.travelMonth
    ? Number(String(ctx.travelMonth).replace(/\D/g, "")) || null
    : null;
  const withMonth = Boolean(opts?.withMonth && monthNum);
  const options = resolveCountryCityOptions(label, withMonth ? monthNum : null);
  const optionNames = options.map((o) => o.name);

  // Always use the single country reply builder — never fall through to scenic month.
  // City options and seasonal copy are merged independently.
  const built = buildCountryCitySelectionReply({
    country: label,
    month: withMonth ? monthNum : null,
    cityOptions: options,
  });
  if (!built) {
    if (!isKnownCountryLabel(label) && !isCountryLevelDestination(label)) {
      return null;
    }
    const fallbackReply = sanitizeCountryCitySelectionReply(
      [
        withMonth && monthNum
          ? `${label} ${monthNum} 月通常體感較舒適，不同地區的天氣與季節特色可能會有差異。`
          : `好，${label}可以玩的城市和地區不少。`,
        "",
        COUNTRY_CITY_SELECTION_LAST_FALLBACK_ENDING,
      ].join("\n"),
      label,
    );
    logAiPipeline("[COUNTRY_CITY_OPTIONS_EMPTY_BLOCKED]", `country=${label}`);
    logAiPipeline(
      "[COUNTRY_REPLY_BUILDER_USED]",
      "builder=buildCountryCitySelectionReply",
      "cityOptionCount=0",
    );
    logAiPipeline("[COUNTRY_REPLY_ENDING]", "type=city_selection");
    logDestinationCityRequired({ country: label, month: withMonth ? monthNum : null });
    logConversationStageTransition(
      "COLLECTING_DESTINATION",
      "AWAITING_CITY_SELECTION",
    );
    return {
      reply: fallbackReply,
      pendingQuestion: pendingQuestionForCountryRegionChoice(label, optionNames),
      contextPatch: {
        destination: label,
        destinationCountry: label,
        destinationType: "country",
        destinationCity: undefined,
        ...(withMonth && monthNum ? { travelMonth: ctx.travelMonth } : {}),
        ...(ctx.travelYear != null ? { travelYear: ctx.travelYear } : {}),
        tripPurpose: "destination_selection",
        conversationState: "discover",
        planningDaysConfirmed: false,
      },
    };
  }

  logDestinationCityRequired({ country: label, month: withMonth ? monthNum : null });
  logConversationStageTransition(
    "COLLECTING_DESTINATION",
    "AWAITING_CITY_SELECTION",
  );
  const scopeGate = evaluateDestinationScopeGate({
    destination: label,
    destinationType: "country",
    countryCode: label,
    requestedIntent: "trip_planning",
  });
  logTripIntentScopeSummary({
    userTextSummary: _userText,
    intent: "trip_planning",
    destination: label,
    destinationType: "country",
    countryCode: label,
    travelMonth: withMonth ? monthNum : ctx.travelMonth,
    travelDates: ctx.startDate && ctx.endDate ? `${ctx.startDate}~${ctx.endDate}` : null,
    scopePrecision: scopeGate.scopePrecision,
    requiresDestinationRefinement: true,
    placesCallAllowed: false,
    nextState: "COLLECTING_DESTINATION_REGION",
    responseType: "clarifying_question",
  });

  return {
    reply: built.reply,
    pendingQuestion: pendingQuestionForCountryRegionChoice(label, optionNames),
    contextPatch: {
      destination: label,
      destinationCountry: label,
      destinationType: "country",
      destinationCity: undefined,
      offeredDestinationOptions: buildDestinationOptionsFromCityList(
        options.map((o) => ({ name: o.name, type: o.type, country: o.country })),
        label,
      ),
      ...(withMonth && monthNum ? { travelMonth: ctx.travelMonth } : {}),
      ...(ctx.travelYear != null ? { travelYear: ctx.travelYear } : {}),
      tripPurpose: "destination_selection",
      conversationState: "discover",
      planningDaysConfirmed: false,
    },
  };
}

function buildScenicAdviceReply(
  spot: string,
  userText: string,
  ctx?: CanonicalTravelContext,
  weather?: CanonicalTravelContext["weather"],
): string | null {
  if (detectMustVisitIntent(userText) || detectPlaceRecommendationIntent(userText)) {
    return null;
  }

  const label = normalizeDestinationLabel(spot);

  if (
    ctx &&
    hasUserSpecifiedTravelMonth(ctx, userText) &&
    !isBestSeasonQuestion(userText)
  ) {
    return buildScenicMonthPlanningReply({
      destination: label,
      context: { ...ctx, destination: label },
      userText,
      weather: weather ?? ctx.weather ?? null,
    });
  }

  if (label === "阿里山") {
    const lines = [
      "阿里山以日出、雲海、森林鐵道與神木步道聞名，海拔高、早晚溫差大。",
      "3～4 月櫻花季、10～11 月楓紅期是熱門時段；若想看日出，建議前一晚住阿里山或搭下午上山火車，避開週末與連假人潮。",
      "你預計去幾天？會開車還是搭大眾運輸？比較想看日出、森林步道，還是順便排奋起湖？",
    ];
    return lines.join("\n");
  }

  if (label === "日月潭") {
    return [
      "日月潭全年皆可，9～12 月秋景與騎行較舒適；春節與連假人潮較多。",
      "建議避開週六中午入湖時段，平日或住一晚看晨霧更愜意。",
      "你預計去幾天？會環湖騎車還是以纜車＋步道為主？",
    ].join("\n");
  }

  if (label === "太魯閣") {
    return [
      "太魯閣 10～4 月較乾爽適合步道；梅雨季（5～6 月）需注意落石與部分步道管制。",
      "平日較少人潮，建議一早入山。你預計停留幾天？會自駕還是搭公車？",
    ].join("\n");
  }

  if (label === "富士山") {
    return [
      "富士山登山季約 7～9 月；若只是河口湖周邊，4～5 月與 10～11 月天氣與景色都很穩。",
      "週末與日本連假人潮多，平日較從容。你想登山還是湖區散策？",
    ].join("\n");
  }

  return null;
}

function buildCityAdviceReply(city: string, country?: string, userText?: string): string | null {
  const label = normalizeDestinationLabel(city);

  if (userText?.trim() && hasCategoryPlaceQuery(userText)) return null;

  if (country === "泰國" || (!country && buildThailandCityReply(label))) {
    const thai = buildThailandCityReply(label);
    if (thai) return thai;
  }

  if (country === "韓國" || (!country && buildKoreaCityReply(label))) {
    const korea = buildKoreaCityReply(label);
    if (korea) return korea;
  }

  if (country === "日本" || (!country && buildJapanCityReply(label, userText))) {
    const japan = buildJapanCityReply(label, userText);
    if (japan) return japan;
  }

  return null;
}

function resolvePlanningFollowUpReply(
  ctx: CanonicalTravelContext,
  userText: string,
): DestinationAdviceResult | null {
  const followUp = parsePlanningFollowUpIntent(userText);
  if (!followUp) return null;

  const destination = resolveMustVisitDestination(ctx, userText);
  if (!destination) return null;

  if (followUp === "full_itinerary") {
    const gen = buildItineraryGenerationAdvice({ ...ctx, destination });
    if (gen) return gen;
  }

  if (followUp === "must_visit_places") {
    const mustVisit = resolveMustVisitAdvice({ ...ctx, destination }, userText);
    if (!mustVisit) return null;
    return {
      reply: mustVisit.reply,
      recommendations: mustVisit.recommendations,
      recommendationsTitle: `${normalizeDestinationLabel(destination)}必去推薦`,
      contextPatch: mustVisit.contextPatch,
    };
  }

  return {
    reply: buildDailyRhythmReply({ ...ctx, destination }) ?? null,
  };
}

function resolveTripPreferenceReply(
  ctx: CanonicalTravelContext,
  userText: string,
  preferencePending = false,
): DestinationAdviceResult | null {
  const preferences = parseTripPreferences(userText);
  if (preferences.length === 0) return null;
  if (!isReadyForItineraryPlanning(ctx, { preferencePending })) return null;

  const destination = coerceTravelDestination(
    ctx.destination ?? (ctx.destinationCities?.length ? ctx.destinationCities[0] : undefined),
  );
  if (!destination || !ctx.days) return null;

  const reply = buildItineraryPlanningReply(
    { ...ctx, destination },
    preferences as TripInterest[],
  );
  if (!reply) return null;

  return {
    reply,
    pendingQuestion: pendingQuestionForItineraryAction(destination, ctx.destinationCountry),
    contextPatch: {
      selectedInterests: preferences,
      interests: preferences.map((interest) =>
        interest === "attractions"
          ? "景點"
          : interest === "shopping"
            ? "購物"
            : interest === "food"
              ? "美食"
              : interest === "night_market"
                ? "夜市"
                : interest,
      ),
      conversationState: "ready_for_itinerary",
      tripPurpose: "ready_for_itinerary",
    },
  };
}

function resolveBestTravelTimeAdvice(
  ctx: CanonicalTravelContext,
  userText: string,
): DestinationAdviceResult | null {
  if (!isBestTravelTimeIntent(userText) || isCreateItineraryIntent(userText)) return null;

  logChatTimeIntent(userText);
  logChatIntentPriority(
    "BEST_TRAVEL_TIME",
    "GENERAL_TRIP_PLANNING,ASK_DAYS,ASK_PREFERENCE,PLACE_RECOMMENDATION",
  );

  const resolvedDest =
    ctx.destination?.trim() ||
    resolveDestinationFromText(userText) ||
    parseDestinationFromText(userText);
  const travelDateExists = Boolean(
    ctx.travelMonth?.trim() ||
      ctx.startDate?.trim() ||
      hasUserSpecifiedTravelMonth(ctx, userText),
  );

  logChatTravelDateExists(travelDateExists);
  logChatDestinationContext(resolvedDest);

  if (!resolvedDest) {
    return {
      reply: "你想問哪個目的地的最佳旅行時間？例如東京、曼谷或墨爾本。",
      contextPatch: { tripPurpose: "best_time_to_visit" },
    };
  }

  const label = normalizeDestinationLabel(resolvedDest);
  logChatBestTravelTimeTriggered(label);

  // Country-level best-time still must collect a city/region next.
  if (isCountryLevelDestination(label) || isKnownCountryLabel(label)) {
    const options = resolveCountryCityOptions(label);
    const curatedBestTime = COUNTRY_ADVICE[label]?.bestTime;
    const seasonalIntro = travelDateExists
      ? buildTravelDateAssessmentReply(label, ctx, userText)
      : buildBestTravelTimeReply(label, { skipFollowUpQuestion: true });
    const introLines = (curatedBestTime?.length
      ? curatedBestTime
      : seasonalIntro.split("\n")
    )
      .map((l) => l.trim())
      .filter(Boolean);
    const built = buildCountryCitySelectionReply({
      country: label,
      cityOptions: options,
      introLines,
    });
    if (built) {
      logDestinationCityRequired({ country: label, month: null });
      logConversationStageTransition(
        "COLLECTING_DESTINATION",
        "AWAITING_CITY_SELECTION",
      );
      return {
        reply: built.reply,
        pendingQuestion: pendingQuestionForCountryRegionChoice(
          label,
          options.map((o) => o.name),
        ),
        contextPatch: {
          destination: label,
          destinationCountry: label,
          destinationType: "country",
          destinationCity: undefined,
          tripPurpose: "best_time_to_visit",
          conversationState: "discover",
          planningDaysConfirmed: false,
        },
      };
    }
  }

  const reply = travelDateExists
    ? buildTravelDateAssessmentReply(label, ctx, userText)
    : buildBestTravelTimeReply(label, { skipFollowUpQuestion: true });

  return {
    reply,
    contextPatch: {
      destination: label,
      tripPurpose: "best_time_to_visit",
    },
  };
}

export function resolveDestinationAdvice(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): DestinationAdviceResult {
  if (isTripAddPlaceSession(session)) return { reply: null };

  if (
    hasCategoryPlaceQuery(userText) &&
    !coerceTravelDestination(
      ctx.destination ??
        session.travelContext?.destination ??
        session.tripPlanningContext?.destination,
    )
  ) {
    return { reply: null };
  }

  // Category / place recommendation with known destination — never answer via combination lock
  if (
    (hasCategoryPlaceQuery(userText) || hasExplicitPlaceRecommendationIntent(userText)) &&
    coerceTravelDestination(
      ctx.destination ??
        session.travelContext?.destination ??
        session.tripPlanningContext?.destination ??
        session.pendingQuestion?.baseDestination,
    )
  ) {
    logChatWrongFallbackBlocked("category_place_advice_blocked");
    return { reply: null };
  }

  if (hasCategoryPlaceQuery(userText) && coerceTravelDestination(resolveDestinationFromText(userText))) {
    logChatWrongFallbackBlocked("category_place_advice_blocked");
    return { reply: null };
  }

  const createAdvice = resolveCreateItineraryAdvice(ctx, session, userText);
  if (createAdvice) return createAdvice;

  const bestTimeAdvice = resolveBestTravelTimeAdvice(ctx, userText);
  if (bestTimeAdvice) return bestTimeAdvice;

  const acceptAdvice = resolveAcceptPreviousSuggestionsAdvice(ctx, session, userText);
  if (acceptAdvice) return acceptAdvice;

  // Pending lost but combinations were offered — still accept "1、2、3" / title replies.
  if (
    !session.pendingQuestion &&
    ctx.tripPurpose === "combination_suggestions_offered"
  ) {
    const dest = resolveContextDestination(ctx, session);
    const days = resolveContextDays(ctx, session);
    if (dest && days && hasDestinationCombinations(dest)) {
      const resolved = resolveSelectedCombinations(dest, userText);
      if (resolved?.titles.length) {
        const comboGen = buildCombinationSelectionGenerationAdvice({
          ctx,
          dest,
          days,
          userText,
          titleFallback: resolved.titles,
        });
        if (comboGen) return comboGen;
      }
    }
  }

  const datePatch = mergeDateRangeIntoContext(userText, ctx, session);
  const workingCtx: CanonicalTravelContext = {
    ...ctx,
    ...datePatch,
    interests: ctx.interests ?? [],
  };

  // Flow B: user already gave destination + exact dates (and thus days) → combinations directly.
  if (
    !session.pendingQuestion &&
    !session.adviceSelectionThisTurn &&
    !session.lastResolvedPendingQuestion
  ) {
    const readyDest =
      resolveContextDestination(workingCtx, session) ??
      (resolveDestinationFromText(userText)
        ? normalizeDestinationLabel(resolveDestinationFromText(userText)!)
        : undefined);
    const readyDays = resolveContextDays(workingCtx, session, userText);
    const hasExactDates =
      Boolean(workingCtx.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(workingCtx.startDate!.trim()) &&
      Boolean(workingCtx.endDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(workingCtx.endDate!.trim());

    if (
      readyDest &&
      readyDays &&
      hasExactDates &&
      canDiscoverDestinationPlaces(readyDest) &&
      hasDestinationCombinations(readyDest) &&
      workingCtx.tripPurpose !== "combination_suggestions_offered" &&
      workingCtx.tripPurpose !== "route_combination_selected" &&
      workingCtx.planningDaysConfirmed
    ) {
      const comboAdvice = resolveDestinationCombinationsAdvice(
        {
          ...workingCtx,
          destination: readyDest,
          days: readyDays,
          planningDaysConfirmed: true,
        },
        session,
      );
      if (comboAdvice) return comboAdvice;
    }
  }

  // Destination + month: country → ask city; city → climate then ask days.
  if (
    !session.pendingQuestion &&
    !session.adviceSelectionThisTurn &&
    !session.lastResolvedPendingQuestion
  ) {
    const windowDest =
      resolveContextDestination(workingCtx, session) ??
      (resolveDestinationFromText(userText)
        ? normalizeDestinationLabel(resolveDestinationFromText(userText)!)
        : undefined);
    const alreadySuggestedWindow =
      workingCtx.tripPurpose === "travel_window_suggested" ||
      workingCtx.tripPurpose === "awaiting_trip_duration" ||
      workingCtx.tripPurpose === "duration_selected" ||
      workingCtx.tripPurpose === "combination_suggestions_offered" ||
      workingCtx.tripPurpose === "route_combination_selected" ||
      workingCtx.tripPurpose === "destination_selection" ||
      workingCtx.planningDaysConfirmed === true ||
      Boolean(workingCtx.days);

    if (
      windowDest &&
      isKnownDestinationLabel(windowDest) &&
      hasUserSpecifiedTravelMonth(workingCtx, userText) &&
      !isBestSeasonQuestion(userText) &&
      !alreadySuggestedWindow
    ) {
      if (isCountryLevelDestination(windowDest)) {
        const countryAdvice = buildCountryCityCollectAdvice(
          windowDest,
          { ...workingCtx, destination: windowDest, destinationCountry: windowDest },
          userText,
          { withMonth: true },
        );
        if (countryAdvice) return countryAdvice;
        // Hard block: never fall through to generic month / date collection.
        logAiPipeline(
          "[COUNTRY_REPLY_GENERIC_MONTH_TEMPLATE_BLOCKED]",
          `country=${normalizeDestinationLabel(windowDest)}`,
        );
        logAiPipeline(
          "[COUNTRY_DATE_QUESTION_BLOCKED]",
          `country=${normalizeDestinationLabel(windowDest)}`,
        );
        const blockedLabel = normalizeDestinationLabel(windowDest);
        const blockedBuilt = buildCountryCitySelectionReply({
          country: blockedLabel,
          month: workingCtx.travelMonth,
          cityOptions: resolveCountryCityOptions(blockedLabel, workingCtx.travelMonth),
        });
        return {
          reply:
            blockedBuilt?.reply ??
            sanitizeCountryCitySelectionReply(
              [
                `${blockedLabel} 這個月份不同地區的天氣與季節特色可能會有差異。`,
                "",
                COUNTRY_CITY_SELECTION_LAST_FALLBACK_ENDING,
              ].join("\n"),
              blockedLabel,
            ),
          pendingQuestion: pendingQuestionForCountryRegionChoice(
            blockedLabel,
            blockedBuilt?.cityOptions.map((o) => o.name) ?? [],
          ),
          contextPatch: {
            destination: blockedLabel,
            destinationCountry: blockedLabel,
            destinationType: "country",
            destinationCity: undefined,
            travelMonth: workingCtx.travelMonth,
            ...(workingCtx.travelYear != null
              ? { travelYear: workingCtx.travelYear }
              : {}),
            tripPurpose: "destination_selection",
            conversationState: "discover",
            planningDaysConfirmed: false,
          },
        };
      }

      const monthResult = buildScenicMonthPlanningResult({
        destination: windowDest,
        context: { ...workingCtx, destination: windowDest },
        userText,
        weather: workingCtx.weather ?? session.weather ?? null,
      });
      return {
        reply: monthResult.reply,
        pendingQuestion: pendingQuestionForAskDays(
          windowDest,
          workingCtx.destinationCountry ?? session.travelContext?.destinationCountry,
        ),
        contextPatch: {
          destination: windowDest,
          travelMonth: workingCtx.travelMonth,
          suggestedStartDate: monthResult.suggestedStartDate,
          tripPurpose: "travel_window_suggested",
          conversationState: "awaiting_days",
          planningDaysConfirmed: false,
        },
      };
    }

    if (shouldAskTripDuration(workingCtx, session, userText)) {
      return buildAskTripDurationAdviceResult(workingCtx, session);
    }

    // Destination + days ready with known combination templates → skip style A/B/C/D
    // and go straight to combination selection (Flows A/B).
    {
      const comboDest =
        resolveContextDestination(workingCtx, session) ??
        (resolveDestinationFromText(userText)
          ? normalizeDestinationLabel(resolveDestinationFromText(userText)!)
          : undefined);
      const comboDays = resolveContextDays(workingCtx, session, userText);
      if (
        comboDest &&
        comboDays &&
        canDiscoverDestinationPlaces(comboDest) &&
        hasDestinationCombinations(comboDest) &&
        workingCtx.tripPurpose !== "combination_suggestions_offered" &&
        workingCtx.tripPurpose !== "route_combination_selected"
      ) {
        const comboAdvice = resolveDestinationCombinationsAdvice(
          {
            ...workingCtx,
            destination: comboDest,
            days: comboDays,
            planningDaysConfirmed: true,
          },
          session,
        );
        if (comboAdvice) return comboAdvice;
      }
    }

    if (shouldAskTripStyle(workingCtx, session, userText)) {
      return buildAskTripStyleAdviceResult(workingCtx, session, userText);
    }
  }

  if (
    ctx.destination?.trim() &&
    /(不要太熱|怕熱|不要曬|不想曬|太熱|不要太冷|怕雨|不要下雨)/.test(userText.trim())
  ) {
    const ack = buildWeatherConstraintAcknowledgement(
      ctx,
      ctx.weather ?? session.weather ?? null,
    );
    if (ack) {
      return {
        reply: ack,
        pendingQuestion: pendingQuestionForPlanningNextStep(
          ctx.destination,
          ctx.destinationCountry,
        ),
        contextPatch: {
          tripPurpose: "ready_for_itinerary",
          conversationState: "ready_for_itinerary",
        },
      };
    }
  }

  if (detectMustVisitIntent(userText) || detectPlaceRecommendationIntent(userText)) {
    const mustVisit = resolveMustVisitAdvice(ctx, userText);
    if (mustVisit) {
      const dest = resolveMustVisitDestination(ctx, userText) ?? ctx.destination;
      return {
        reply: mustVisit.reply,
        recommendations: mustVisit.recommendations,
        recommendationsTitle: dest ? `${normalizeDestinationLabel(dest)}必去推薦` : "必去推薦",
        contextPatch: mustVisit.contextPatch,
      };
    }
  }

  if (session.adviceSelectionThisTurn && session.lastResolvedPendingQuestion) {
    if (session.adviceSelectionThisTurn === "full_itinerary") {
      const abAdvice = resolveItineraryAbSelectionAdvice(
        "full_itinerary",
        ctx,
        userText,
        session.lastResolvedPendingQuestion,
      );
      if (abAdvice) return abAdvice;
    }

    if (session.adviceSelectionThisTurn === "daily_recommendations") {
      const abAdvice = resolveItineraryAbSelectionAdvice(
        "daily_recommendations",
        ctx,
        userText,
        session.lastResolvedPendingQuestion,
      );
      if (abAdvice) return abAdvice;
    }

    if (session.lastResolvedPendingQuestion.type === "combination_choice") {
      const pending = session.lastResolvedPendingQuestion;
      const dest = normalizeDestinationLabel(
        pending.baseDestination ?? workingCtx.destination ?? "",
      );
      const days = resolveContextDays(workingCtx, session);
      const selected = session.adviceSelectionThisTurn;
      const titles = selected
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      if (dest && days) {
        const comboGen = buildCombinationSelectionGenerationAdvice({
          ctx: workingCtx,
          dest,
          days,
          userText,
          titleFallback: titles,
        });
        if (comboGen) return comboGen;
      }
    }

    if (session.lastResolvedPendingQuestion.type === "ask_trip_style") {
      const style = parseTripStyleKey(session.adviceSelectionThisTurn);
      if (style) {
        return buildTripStyleSelectionAdviceResult(style, workingCtx, session);
      }
    }

    const next = advanceAfterPendingSelection(
      session.adviceSelectionThisTurn,
      session.lastResolvedPendingQuestion,
      workingCtx,
    );
    const dest =
      session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination;
    const mustVisit =
      session.adviceSelectionThisTurn === "must_visit_places" && dest
        ? resolveMustVisitAdvice({ ...ctx, destination: dest }, userText)
        : null;

    if (session.lastResolvedPendingQuestion.type === "ask_days") {
      const parsedDays =
        Number(session.adviceSelectionThisTurn) ||
        parseDayCountFromText(session.adviceSelectionThisTurn);
      const destLabel = dest ? normalizeDestinationLabel(dest) : undefined;
      const datedCtx: CanonicalTravelContext = {
        ...workingCtx,
        destination: destLabel,
        days: parsedDays,
        planningDaysConfirmed: true,
      };
      const comboAdvice =
        destLabel && parsedDays && hasDestinationCombinations(destLabel)
          ? resolveDestinationCombinationsAdvice(datedCtx, session)
          : null;
      if (
        comboAdvice?.reply &&
        comboAdvice.contextPatch?.tripPurpose !== "combination_discovery_failed"
      ) {
        logAiPipeline(
          "[CONVERSATION_STAGE_TRANSITION]",
          "from=COLLECTING_DATE_AND_DURATION",
          "to=AWAITING_COMBINATION_SELECTION",
        );
        logAiPipeline(
          "[NEXT_STEP_RESOLUTION]",
          `destination=${destLabel}`,
          `tripDays=${parsedDays}`,
          "selectedCombinationIds=[]",
          "resolvedNextStep=show_combination_options",
        );
        logAiPipeline(
          "[DIRECT_ITINERARY_GENERATION_BLOCKED]",
          "reason=duration_reply_requires_combination_selection",
        );
        return {
          reply: comboAdvice.reply,
          pendingQuestion: comboAdvice.pendingQuestion,
          recommendations: undefined,
          recommendationsTitle: undefined,
          triggerItineraryGeneration: false,
          contextPatch: {
            ...datePatch,
            ...comboAdvice.contextPatch,
            days: parsedDays,
            destination: dest,
            destinationCountry:
              session.lastResolvedPendingQuestion.destinationCountry ??
              workingCtx.destinationCountry,
            planningDaysConfirmed: true,
            selectedCombinationIds: [],
          },
        };
      }
      // No Places-backed combinations yet — do not pad with category labels.
      return {
        reply: next.reply,
        pendingQuestion: next.pendingQuestion,
        recommendations: mustVisit?.recommendations,
        recommendationsTitle: mustVisit && dest ? `${normalizeDestinationLabel(dest)}必去推薦` : undefined,
        triggerItineraryGeneration: false,
        contextPatch: {
          ...datePatch,
          days: parsedDays,
          destination: dest,
          destinationCountry:
            session.lastResolvedPendingQuestion.destinationCountry ??
            workingCtx.destinationCountry,
          planningDaysConfirmed: true,
          selectedCombinationIds: [],
          tripPurpose:
            next.pendingQuestion?.type === "combination_choice"
              ? "combination_suggestions_offered"
              : next.pendingQuestion?.type === "ask_trip_style"
                ? "awaiting_trip_style"
                : "duration_selected",
          conversationState:
            next.pendingQuestion?.type === "ask_trip_style"
              ? "awaiting_preference"
              : workingCtx.conversationState,
        },
      };
    }

    return {
      reply: next.reply,
      pendingQuestion: next.pendingQuestion,
      recommendations: mustVisit?.recommendations,
      recommendationsTitle: mustVisit && dest ? `${normalizeDestinationLabel(dest)}必去推薦` : undefined,
      contextPatch:
        session.lastResolvedPendingQuestion.type === "preference_choice"
          ? {
              selectedInterests: session.adviceSelectionThisTurn.split(",") as TripInterest[],
              conversationState: "ready_for_itinerary",
              tripPurpose: "ready_for_itinerary",
            }
          : session.lastResolvedPendingQuestion.type === "activity_choice" &&
              session.adviceSelectionThisTurn === "must_visit_places"
            ? {
                mustVisitGenerated: true,
                tripPurpose: "must_visit_places",
                planningStage: "recommendations_generated",
              }
            : session.adviceSelectionThisTurn === "full_itinerary"
              ? {
                  selectedPlanMode: "full_itinerary",
                  conversationState: "itinerary_draft",
                  tripPurpose: "itinerary_draft",
                  destination:
                    session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination,
                  destinationCountry:
                    session.lastResolvedPendingQuestion.destinationCountry ??
                    ctx.destinationCountry,
                  days: ctx.days ?? parseDayCountFromText(userText),
                }
            : session.lastResolvedPendingQuestion.type === "ask_preference"
              ? contextPatchForPreferenceSelection(
                  session.adviceSelectionThisTurn,
                  session.lastResolvedPendingQuestion,
                )
            : session.lastResolvedPendingQuestion.type === "region_choice"
              ? {
                  destination:
                    session.adviceSelectionThisTurn === "__flexible_city_mix__"
                      ? session.lastResolvedPendingQuestion.options[0]
                      : session.adviceSelectionThisTurn,
                  destinationCountry:
                    session.lastResolvedPendingQuestion.destinationCountry ??
                    workingCtx.destinationCountry,
                  destinationType: "city" as const,
                  destinationCity:
                    session.adviceSelectionThisTurn === "__flexible_city_mix__"
                      ? session.lastResolvedPendingQuestion.options[0]
                      : session.adviceSelectionThisTurn,
                  tripPurpose: hasValidTripDuration(workingCtx)
                    ? "duration_selected"
                    : "region_selected",
                  conversationState: hasValidTripDuration(workingCtx)
                    ? "awaiting_preference"
                    : "awaiting_days",
                  planningDaysConfirmed: hasValidTripDuration(workingCtx),
                  ...(hasValidTripDuration(workingCtx)
                    ? { days: resolveValidTripDays(workingCtx) }
                    : {}),
                }
            : session.adviceSelectionThisTurn === "daily_recommendations"
                ? {
                    selectedPlanMode: "daily_recommendations",
                    conversationState: "itinerary_draft",
                    tripPurpose: "itinerary_draft",
                    destination:
                      session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination,
                    destinationCountry:
                      session.lastResolvedPendingQuestion.destinationCountry ??
                      ctx.destinationCountry,
                  }
                : undefined,
    };
  }

  const pending = session.pendingQuestion;
  if (pending) {
    // Recover: combo list was shown but pending was wrongly left as activity_choice.
    if (
      pending.type === "activity_choice" &&
      workingCtx.tripPurpose === "combination_suggestions_offered"
    ) {
      const dest = normalizeDestinationLabel(
        pending.baseDestination ?? workingCtx.destination ?? "",
      );
      if (dest && hasDestinationCombinations(dest)) {
        const synthetic: PendingQuestion = pendingQuestionForCombinationChoice(
          dest,
          pending.destinationCountry ?? workingCtx.destinationCountry,
        );
        const comboSelected = parsePendingOptionSelection(userText, synthetic);
        if (comboSelected) {
          const days = resolveContextDays(workingCtx, session);
          const titles =
            resolveSelectedCombinations(dest, userText)?.titles ??
            comboSelected.split("|").map((s) => s.trim()).filter(Boolean);
          if (days) {
            const comboGen = buildCombinationSelectionGenerationAdvice({
              ctx: workingCtx,
              dest,
              days,
              userText,
              titleFallback: titles,
            });
            if (comboGen) return comboGen;
          }
        }
      }
    }

    const selected = parsePendingOptionSelection(userText, pending);
    if (!selected && pending.type === "combination_choice") {
      const dest = normalizeDestinationLabel(
        pending.baseDestination ?? workingCtx.destination ?? "",
      );
      const bypass = shouldBypassCombinationPending(userText, {
        hasActiveRecommendationContext: Boolean(
          session.activeRecommendationContext ||
            session.recommendationSession ||
            session.activeCategoryIntent,
        ),
      });
      if (bypass.bypass && bypass.intent) {
        logCombinationPendingBypassed(userText, bypass.intent, bypass.reason);
        // Preserve pending combination + trip context; let place-recommendation route handle.
        return { reply: null, pendingQuestion: pending };
      }
      // Only lock when message is not place intent and not other free-form chat.
      // Non-grammar messages fall through so other intents can run.
      if (
        !hasExplicitPlaceRecommendationIntent(userText) &&
        isCombinationSelectionGrammar(userText, { destination: dest || undefined })
      ) {
        // Grammar matched but parsePendingOptionSelection failed — nudge again
        return {
          reply: dest
            ? `我還不確定你想用哪幾組。請回覆組合編號（例如 1、3），或說「可以幫我生成」讓我混搭全部組合。`
            : `我還不確定你想用哪幾組。請回覆組合編號，或說「可以幫我生成」。`,
          pendingQuestion: pending,
        };
      }
      if (
        !hasExplicitPlaceRecommendationIntent(userText) &&
        !isCombinationSelectionGrammar(userText, { destination: dest || undefined }) &&
        !hasCategoryPlaceQuery(userText)
      ) {
        // Ambiguous non-place reply while waiting — keep pending, soft nudge
        return {
          reply: dest
            ? `我還不確定你想用哪幾組。請回覆組合編號（例如 1、3），或說「可以幫我生成」讓我混搭全部組合。`
            : `我還不確定你想用哪幾組。請回覆組合編號，或說「可以幫我生成」。`,
          pendingQuestion: pending,
        };
      }
      // Place / category query: release advice so chat can fetch places
      if (hasCategoryPlaceQuery(userText) || hasExplicitPlaceRecommendationIntent(userText)) {
        const intent = bypass.intent ?? parsePlaceRecommendationIntent(userText);
        if (intent) logCombinationPendingBypassed(userText, intent);
        return { reply: null, pendingQuestion: pending };
      }
    }
    if (selected) {
      if (selected === "full_itinerary" || selected === "daily_recommendations") {
        const abAdvice = resolveItineraryAbSelectionAdvice(
          selected,
          ctx,
          userText,
          pending,
        );
        if (abAdvice) return abAdvice;
      }

      if (
        selected === "must_visit_places" ||
        parsePlanningFollowUpIntent(userText) === "must_visit_places"
      ) {
        const dest = pending.baseDestination ?? ctx.destination;
        const mustVisit = resolveMustVisitAdvice({ ...ctx, destination: dest }, userText);
        if (mustVisit) {
          return {
            reply: mustVisit.reply,
            recommendations: mustVisit.recommendations,
            recommendationsTitle: dest ? `${normalizeDestinationLabel(dest)}必去推薦` : "必去推薦",
            contextPatch: {
              ...mustVisit.contextPatch,
              ...(pending.type === "preference_choice"
                ? {
                    selectedInterests: selected.split(",") as TripInterest[],
                    conversationState: "ready_for_itinerary" as const,
                    tripPurpose: "ready_for_itinerary",
                  }
                : {}),
            },
          };
        }
      }

      if (pending.type === "ask_trip_style") {
        const style =
          parseAskTripStyleSelection(userText) ?? parseTripStyleKey(selected);
        if (style) {
          return buildTripStyleSelectionAdviceResult(
            style,
            {
              ...workingCtx,
              destination: pending.baseDestination ?? workingCtx.destination,
            },
            session,
          );
        }
      }

      if (pending.type === "combination_choice") {
        const dest = normalizeDestinationLabel(
          pending.baseDestination ?? workingCtx.destination ?? "",
        );
        const days = resolveContextDays(workingCtx, session);
        const titles = selected
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);

        if (dest && days) {
          const comboGen = buildCombinationSelectionGenerationAdvice({
            ctx: {
              ...workingCtx,
              destinationCountry:
                pending.destinationCountry ?? workingCtx.destinationCountry,
            },
            dest,
            days,
            userText,
            titleFallback: titles,
          });
          if (comboGen) {
            return {
              ...comboGen,
              contextPatch: {
                ...comboGen.contextPatch,
                destinationCountry:
                  pending.destinationCountry ?? workingCtx.destinationCountry,
              },
            };
          }
        }

        const labelList = titles.join("、") || "建議組合";
        const next = advanceAfterPendingSelection(selected, pending, workingCtx);
        return {
          reply: next.reply,
          pendingQuestion: next.pendingQuestion,
          contextPatch: {
            destination: dest || pending.baseDestination,
            destinationCountry:
              pending.destinationCountry ?? workingCtx.destinationCountry,
            selectedTripStyle: labelList,
            travelStyle: labelList,
            tripPurpose: "route_combination_selected",
            conversationState: "ready_for_itinerary",
            mustVisitGenerated: true,
          },
        };
      }

      const next = advanceAfterPendingSelection(selected, pending, workingCtx);
      return {
        reply: next.reply,
        pendingQuestion: next.pendingQuestion,
        contextPatch:
          pending.type === "preference_choice"
            ? {
                selectedInterests: selected.split(",") as TripInterest[],
                conversationState: "ready_for_itinerary",
                tripPurpose: "ready_for_itinerary",
              }
            : selected === USE_DEFAULT_ROUTES
              ? {
                  useDefaultRecommendation: true,
                  vibe: "混合",
                  travelStyle: "熱門路線",
                  tripPurpose: "destination_style_default",
                  destination: pending.baseDestination ?? ctx.destination,
                  destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                }
              : selected === "must_visit_places"
              ? {
                  mustVisitGenerated: true,
                  tripPurpose: "must_visit_places",
                  planningStage: "recommendations_generated",
                }
              : pending.type === "destination_style_choice"
                ? {
                    vibe: selected,
                    travelStyle: selected,
                    tripPurpose: "trip_style_selected",
                    destination: pending.baseDestination ?? ctx.destination,
                    destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                  }
                : selected === "full_itinerary"
                  ? {
                      selectedPlanMode: "full_itinerary",
                      conversationState: "itinerary_draft",
                      tripPurpose: "itinerary_draft",
                      destination: pending.baseDestination ?? ctx.destination,
                      destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                      days: ctx.days ?? parseDayCountFromText(userText),
                    }
              : pending.type === "ask_preference"
                ? contextPatchForPreferenceSelection(selected, pending)
              : pending.type === "ask_days"
                ? {
                    days: Number(selected) || parseDayCountFromText(selected),
                    destination: pending.baseDestination ?? ctx.destination,
                    destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                    planningDaysConfirmed: true,
                    tripPurpose: "duration_selected",
                    conversationState: "awaiting_preference",
                  }
                : selected === "daily_recommendations"
                    ? {
                        selectedPlanMode: "daily_recommendations",
                        conversationState: "itinerary_draft",
                        tripPurpose: "itinerary_draft",
                        destination: pending.baseDestination ?? ctx.destination,
                        destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                      }
                    : undefined,
      };
    }
    if (isAskDaysPending(pending)) {
      // Guard: never re-ask days once tripDays is already on context.
      const alreadyResolvedDays =
        workingCtx.days ??
        session.tripDays ??
        session.travelContext?.days ??
        null;
      const parsedDays = parseAskDaysFromText(userText, pending);
      if (
        alreadyResolvedDays != null &&
        alreadyResolvedDays > 0 &&
        !parsedDays
      ) {
        logAiPipeline(
          "[ASK_DAYS_TEMPLATE_BLOCKED]",
          "reason=trip_days_already_resolved",
          `tripDays=${alreadyResolvedDays}`,
        );
        const destLabel = normalizeDestinationLabel(
          pending.baseDestination ?? ctx.destination ?? "",
        );
        const datedCtx: CanonicalTravelContext = {
          ...workingCtx,
          destination: destLabel,
          days: alreadyResolvedDays,
          planningDaysConfirmed: true,
        };
        const comboAdvice =
          destLabel && hasDestinationCombinations(destLabel)
            ? resolveDestinationCombinationsAdvice(datedCtx, session)
            : null;
        if (comboAdvice?.reply) {
          return {
            reply: comboAdvice.reply,
            pendingQuestion: comboAdvice.pendingQuestion,
            recommendations: undefined,
            recommendationsTitle: undefined,
            contextPatch: {
              ...datePatch,
              ...comboAdvice.contextPatch,
              days: alreadyResolvedDays,
              destination: destLabel || pending.baseDestination || ctx.destination,
              destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
              planningDaysConfirmed: true,
            },
          };
        }
      }

      if (parsedDays) {
        const destLabel = normalizeDestinationLabel(
          pending.baseDestination ?? ctx.destination ?? "",
        );
        const suggested = resolveSuggestedTripDates({
          days: parsedDays,
          userText,
          startDate: workingCtx.startDate,
          endDate: workingCtx.endDate,
          suggestedStartDate: workingCtx.suggestedStartDate,
          travelMonth: workingCtx.travelMonth,
        });
        const datedCtx: CanonicalTravelContext = {
          ...workingCtx,
          destination: destLabel,
          days: parsedDays,
          planningDaysConfirmed: true,
          ...(suggested && !workingCtx.startDate
            ? {
                startDate: suggested.startDate,
                endDate: suggested.endDate,
                suggestedStartDate: suggested.startDate,
              }
            : {}),
        };

        logAiPipeline(
          "[PENDING_QUESTION_CLEARED]",
          `previous=${pending.type === "ask_days" ? "ask_date_or_duration" : pending.type}`,
        );

        if (datedCtx.startDate || datedCtx.endDate) {
          logAiPipeline(
            "[TRIP_DATE_RANGE_PARSED]",
            `startDate=${datedCtx.startDate ?? "none"}`,
            `endDate=${datedCtx.endDate ?? "none"}`,
            `tripDays=${parsedDays}`,
            suggested && !workingCtx.startDate
              ? `dateSource=suggested_from_month`
              : "",
          );
        }

        const comboAdvice =
          destLabel && hasDestinationCombinations(destLabel)
            ? resolveDestinationCombinationsAdvice(datedCtx, session)
            : null;
        // Duration reply must never open itinerary / place-failure paths.
        if (
          comboAdvice?.reply &&
          comboAdvice.contextPatch?.tripPurpose !== "combination_discovery_failed"
        ) {
          logAiPipeline(
            "[CONVERSATION_STAGE_TRANSITION]",
            "from=COLLECTING_DATE_AND_DURATION",
            "to=AWAITING_COMBINATION_SELECTION",
          );
          logAiPipeline(
            "[NEXT_STEP_RESOLUTION]",
            `destination=${destLabel}`,
            `tripDays=${parsedDays}`,
            "selectedCombinationIds=[]",
            "resolvedNextStep=show_combination_options",
          );
          logAiPipeline(
            "[DIRECT_ITINERARY_GENERATION_BLOCKED]",
            "reason=duration_reply_requires_combination_selection",
          );
          return {
            reply: comboAdvice.reply,
            pendingQuestion: comboAdvice.pendingQuestion,
            recommendations: undefined,
            recommendationsTitle: undefined,
            triggerItineraryGeneration: false,
            contextPatch: {
              ...datePatch,
              ...comboAdvice.contextPatch,
              days: parsedDays,
              destination: destLabel || pending.baseDestination || ctx.destination,
              destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
              planningDaysConfirmed: true,
              selectedCombinationIds: [],
              ...(suggested && !workingCtx.startDate
                ? {
                    startDate: suggested.startDate,
                    endDate: suggested.endDate,
                    suggestedStartDate: suggested.startDate,
                  }
                : {}),
            },
          };
        }

        // Combinations unavailable — never pad with theme-category labels.
        logAiPipeline(
          "[LEGACY_TRIP_REPLY_BLOCKED]",
          "template=trip_summary_or_direct_choice",
          `destination=${destLabel}`,
        );
        logAiPipeline(
          "[DIRECT_ITINERARY_GENERATION_BLOCKED]",
          "reason=duration_reply_requires_combination_selection",
        );
        const next = advanceAfterPendingSelection(String(parsedDays), pending, datedCtx);
        if (
          /你想直接排完整行程|先推薦必去景點|這幾天.*適合散步|可以安排：|好，我先記下：|無法取得.*景點資料/.test(
            next.reply,
          )
        ) {
          logAiPipeline(
            "[LEGACY_TRIP_REPLY_BLOCKED]",
            "template=trip_summary_or_direct_choice",
            "source=advanceAfterPendingSelection",
          );
          // Soft acknowledge + re-ask combinations, never place-failure copy.
          return {
            reply: [
              `好，我先記下 ${destLabel || "這趟"} ${parsedDays} 天的行程方向。`,
              "",
              "目前還在整理實際地點組合，請稍後再試或回「重新整理推薦」。",
            ].join("\n"),
            pendingQuestion: {
              type: "ask_preference",
              options: [REFRESH_DESTINATION_RECOMMENDATIONS_OPTION],
              baseDestination: destLabel,
              destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
            },
            recommendations: undefined,
            recommendationsTitle: undefined,
            triggerItineraryGeneration: false,
            contextPatch: {
              ...datePatch,
              days: parsedDays,
              destination: destLabel || pending.baseDestination || ctx.destination,
              destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
              planningDaysConfirmed: true,
              tripPurpose: "combination_suggestions_offered",
              conversationState: "awaiting_preference",
              selectedCombinationIds: [],
              ...(suggested && !workingCtx.startDate
                ? {
                    startDate: suggested.startDate,
                    endDate: suggested.endDate,
                    suggestedStartDate: suggested.startDate,
                  }
                : {}),
            },
          };
        }
        return {
          reply: next.reply,
          pendingQuestion: next.pendingQuestion,
          recommendations: undefined,
          recommendationsTitle: undefined,
          triggerItineraryGeneration: false,
          contextPatch: {
            ...datePatch,
            days: parsedDays,
            destination: destLabel || pending.baseDestination || ctx.destination,
            destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
            planningDaysConfirmed: true,
            tripPurpose:
              next.pendingQuestion?.type === "combination_choice"
                ? "combination_suggestions_offered"
                : "duration_selected",
            conversationState: "awaiting_preference",
            selectedCombinationIds: [],
            ...(next.pendingQuestion?.type === "combination_choice"
              ? { planningStage: "recommendations_generated" as const }
              : {}),
            ...(suggested && !workingCtx.startDate
              ? {
                  startDate: suggested.startDate,
                  endDate: suggested.endDate,
                  suggestedStartDate: suggested.startDate,
                }
              : {}),
          },
        };
      }

      const clarification = parseAskDaysClarification(userText, pending);
      if (clarification) {
        return {
          reply: clarification,
          pendingQuestion: pending,
        };
      }

      const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
      if (alreadyResolvedDays != null && alreadyResolvedDays > 0) {
        logAiPipeline(
          "[ASK_DAYS_TEMPLATE_BLOCKED]",
          "reason=trip_days_already_resolved",
          `tripDays=${alreadyResolvedDays}`,
        );
      }
      return {
        reply: `好，${dest}是很好的選擇。你這趟大概幾天？例如 5天、6天 都可以。`,
        pendingQuestion: pending,
      };
    }
    if (isItineraryNextStepPending(pending)) {
      const planMode =
        parseItineraryNextStepSelection(userText) ??
        parseItineraryPlanModeIntent(userText);
      if (planMode === "full_itinerary" || planMode === "daily_recommendations") {
        const abAdvice = resolveItineraryAbSelectionAdvice(planMode, ctx, userText, pending);
        if (abAdvice) return abAdvice;
      }
      return { reply: null };
    }
    // Safety net: region_choice still pending but free-form city resolved in context
    // (e.g. 福岡 not in previous option list). Ask duration — never Places / combinations.
    if (pending.type === "region_choice") {
      const freeCity =
        resolveFreeFormRegionChoice(userText, pending) ??
        (workingCtx.destination &&
        !isCountryLevelDestination(workingCtx.destination) &&
        normalizeDestinationLabel(workingCtx.destination) !==
          normalizeDestinationLabel(
            pending.destinationCountry ?? pending.baseDestination ?? "",
          )
          ? normalizeDestinationLabel(workingCtx.destination)
          : null);
      if (freeCity) {
        const country =
          pending.destinationCountry ??
          workingCtx.destinationCountry ??
          pending.baseDestination;
        const cityCtx: CanonicalTravelContext = {
          ...workingCtx,
          destination: freeCity,
          destinationCountry: country,
          destinationType: "city",
        };
        const validDays = resolveValidTripDays(cityCtx);
        logTripDurationGuard({
          tripDays: validDays ?? null,
          startDate: cityCtx.startDate,
          endDate: cityCtx.endDate,
          valid: validDays != null,
          nextState:
            validDays != null ? "awaiting_combination_selection" : "waitingTripDays",
        });
        logConversationStateTransition({
          from: "region_choice",
          to: validDays != null ? "awaiting_combination_selection" : "waitingTripDays",
          reason:
            validDays != null
              ? "destination_selected_duration_present"
              : "destination_selected_duration_missing",
        });
        if (validDays != null) {
          const comboAdvice = resolveDestinationCombinationsAdvice(
            { ...cityCtx, days: validDays, planningDaysConfirmed: true },
            { ...session, pendingQuestion: undefined },
          );
          if (comboAdvice) return comboAdvice;
          return {
            ...buildCityDaysConfirmedReply(freeCity, validDays, country, {
              weather: cityCtx.weather,
              context: { ...cityCtx, days: validDays, planningDaysConfirmed: true },
            }),
            contextPatch: {
              destination: freeCity,
              destinationCountry: country,
              destinationType: "city",
              destinationCity: freeCity,
              days: validDays,
              planningDaysConfirmed: true,
              tripPurpose: "duration_selected",
              conversationState: "awaiting_preference",
            },
          };
        }
        const dateAsk = buildDateAndDurationQuestionReply(freeCity, country, {
          context: cityCtx,
          userText,
          previousPendingType: "region_choice",
          blockedLegacyTemplate: "free_form_city_without_days",
        });
        return {
          reply: dateAsk.reply,
          pendingQuestion: dateAsk.pendingQuestion,
          contextPatch: {
            destination: freeCity,
            destinationCountry: country,
            destinationType: "city",
            destinationCity: freeCity,
            tripPurpose: "region_selected",
            conversationState: "awaiting_days",
            planningDaysConfirmed: false,
          },
        };
      }
    }
    const followUpReply = resolvePlanningFollowUpReply(ctx, userText);
    if (followUpReply?.reply) {
      return followUpReply;
    }
    if (pending.type === "preference_choice") {
      const preferenceReply = resolveTripPreferenceReply(ctx, userText, true);
      if (preferenceReply?.reply) {
        return preferenceReply;
      }
    }
    return { reply: null };
  }

  const planMode = parseItineraryPlanModeIntent(userText);
  const hasCreateIntent =
    isCreateItineraryIntent(userText) || planMode === "full_itinerary";

  if (hasCreateIntent && !session.pendingQuestion) {
    const extracted = extractItineraryEntitiesFromText(userText);
    const dest =
      extracted.destination ??
      extractItineraryDestinationFromText(userText) ??
      (ctx.destination?.trim() && isValidParsedDestinationLabel(normalizeDestinationLabel(ctx.destination))
        ? normalizeDestinationLabel(ctx.destination)
        : undefined) ??
      extractItineraryDestinationFromText(ctx.destination ?? "") ??
      session.tripPlanningContext?.destination?.trim() ??
      session.tripDestination?.city?.trim();
    const days = extracted.days ?? ctx.days ?? session.tripDays ?? parseDayCountFromText(userText);
    if (dest) {
      logItineraryDestinationParsed(dest);
    }
    if (extracted.travelMonth) {
      logItineraryDateParsed(extracted.travelMonth);
    }
    if (days) {
      logItineraryDaysParsed(days, extracted.nights);
    }
    if (dest && days) {
      const prefs = parseActivityPreferencesFromText(userText);
      const label = normalizeDestinationLabel(dest);
      logChatCreateItineraryTriggered(label, days);
      const reply = buildCreateItineraryAckReply({
        destination: label,
        days,
        preferences: prefs.length ? prefs : ctx.interests,
      });
      return {
        reply,
        triggerItineraryGeneration: true,
        contextPatch: {
          destination: label,
          days,
          interests: [...new Set([...ctx.interests, ...prefs])],
          selectedPlanMode: "full_itinerary",
          conversationState: "ready_for_itinerary",
          tripPurpose: "create_itinerary",
          lastIntent: "create_itinerary",
        },
      };
    }
  }

  if (
    planMode === "full_itinerary" &&
    ctx.destination?.trim() &&
    ctx.days &&
    !session.pendingQuestion
  ) {
    const gen = buildItineraryGenerationAdvice(ctx);
    if (gen) return gen;
  }
  if (
    planMode === "daily_recommendations" &&
    ctx.destination?.trim() &&
    ctx.days &&
    !session.pendingQuestion
  ) {
    const reply = buildDailyRecommendationsReply(ctx, ctx.selectedInterests as TripInterest[] | undefined);
    if (reply) {
      return {
        reply,
        contextPatch: {
          selectedPlanMode: "daily_recommendations",
          conversationState: "itinerary_draft",
          tripPurpose: "itinerary_draft",
        },
      };
    }
  }

  const planningDestination =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city;
  const isDestinationPlanning =
    session.conversationMode === "destination_planning" ||
    session.tripPlanningContext?.intent === "destination_planning";

  if (
    isFlexiblePreferenceReply(userText) &&
    isDestinationPlanning &&
    planningDestination?.trim()
  ) {
    const days = ctx.days ?? session.tripDays;
    const destLabel = normalizeDestinationLabel(planningDestination);

    if (days) {
      const comboAdvice = resolveDestinationCombinationsAdvice(ctx, session);
      if (comboAdvice) return comboAdvice;
      return {
        reply: `好，我會依${destLabel} ${days} 天的方向繼續幫你安排。`,
        contextPatch: {
          destination: destLabel,
          days,
          conversationState: "ready_for_itinerary",
          tripPurpose: "ready_for_itinerary",
        },
      };
    }

    if (
      isKnownCountryLabel(destLabel) &&
      !isKnownTouristCityLabel(destLabel) &&
      !hasDestinationCombinations(destLabel)
    ) {
      const syntheticPending = pendingQuestionForDestinationStyleChoice(
        planningDestination,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      );
      const selected = USE_DEFAULT_ROUTES;
      const next = advanceAfterPendingSelection(selected, syntheticPending, ctx);
      return {
        reply: next.reply,
        pendingQuestion: next.pendingQuestion,
        contextPatch: {
          useDefaultRecommendation: true,
          vibe: "混合",
          travelStyle: "熱門路線",
          tripPurpose: "destination_style_default",
          destination: planningDestination,
          destinationCountry:
            ctx.destinationCountry ?? session.travelContext?.destinationCountry,
        },
      };
    }

    return null;
  }

  if (
    hasDestinationPlanningBasics(ctx) &&
    !session.pendingQuestion &&
    (ctx.tripPurpose === "duration_selected" || ctx.tripPurpose === "region_selected") &&
    ctx.tripPurpose !== "combination_suggestions_offered" &&
    ctx.tripPurpose !== "create_itinerary_from_accepted" &&
    ctx.tripPurpose !== "direct_itinerary_generation" &&
    !isAcceptPreviousSuggestionsIntent(userText, ctx, session) &&
    !isCreateItineraryIntent(userText) &&
    !isBestTravelTimeIntent(userText) &&
    !detectMustVisitIntent(userText) &&
    !detectPlaceRecommendationIntent(userText)
  ) {
    const comboAdvice = resolveDestinationCombinationsAdvice(ctx, session);
    if (comboAdvice) return comboAdvice;
  }

  const followUpReply = resolvePlanningFollowUpReply(ctx, userText);
  if (followUpReply?.reply) {
    return followUpReply;
  }

  const preferenceReply = resolveTripPreferenceReply(ctx, userText, false);
  if (preferenceReply?.reply) {
    return preferenceReply;
  }

  // Country without city: collect city before dates / Places (with or without month).
  {
    const countryDest =
      resolveContextDestination(workingCtx, session) ??
      (resolveDestinationFromText(userText)
        ? normalizeDestinationLabel(resolveDestinationFromText(userText)!)
        : undefined);
    if (
      countryDest &&
      isCountryLevelDestination(countryDest) &&
      !workingCtx.destinationCity &&
      !session.pendingQuestion &&
      !session.adviceSelectionThisTurn &&
      workingCtx.tripPurpose !== "duration_selected" &&
      workingCtx.tripPurpose !== "combination_suggestions_offered" &&
      workingCtx.tripPurpose !== "route_combination_selected" &&
      !workingCtx.days
    ) {
      // Even when tripPurpose was set to region_selected by intent parse,
      // country-level destination still needs an explicit city first.
      const withMonth = hasUserSpecifiedTravelMonth(workingCtx, userText);
      const countryAdvice = buildCountryCityCollectAdvice(
        countryDest,
        { ...workingCtx, destination: countryDest, destinationCountry: countryDest },
        userText,
        { withMonth },
      );
      if (countryAdvice) return countryAdvice;
      logAiPipeline(
        "[COUNTRY_REPLY_GENERIC_MONTH_TEMPLATE_BLOCKED]",
        `country=${normalizeDestinationLabel(countryDest)}`,
      );
      logAiPipeline(
        "[COUNTRY_DATE_QUESTION_BLOCKED]",
        `country=${normalizeDestinationLabel(countryDest)}`,
      );
    }
  }

  const scenicDest =
    ctx.destination ??
    resolveDestinationFromText(userText) ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city;
  const scenicLabel = scenicDest ? normalizeDestinationLabel(scenicDest) : undefined;

  if (
    scenicLabel &&
    isKnownDestinationLabel(scenicLabel) &&
    hasUserSpecifiedTravelMonth(ctx, userText) &&
    !isBestSeasonQuestion(userText) &&
    !session.adviceSelectionThisTurn &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    ctx.tripPurpose !== "travel_window_suggested" &&
    ctx.tripPurpose !== "awaiting_trip_duration" &&
    ctx.tripPurpose !== "combination_suggestions_offered" &&
    ctx.tripPurpose !== "destination_selection" &&
    !ctx.days
  ) {
    if (isCountryLevelDestination(scenicLabel)) {
      const countryAdvice = buildCountryCityCollectAdvice(
        scenicLabel,
        { ...ctx, destination: scenicLabel, destinationCountry: scenicLabel },
        userText,
        { withMonth: true },
      );
      if (countryAdvice) return countryAdvice;
      logAiPipeline(
        "[COUNTRY_REPLY_GENERIC_MONTH_TEMPLATE_BLOCKED]",
        `country=${scenicLabel}`,
      );
      logAiPipeline("[COUNTRY_DATE_QUESTION_BLOCKED]", `country=${scenicLabel}`);
      const scenicBuilt = buildCountryCitySelectionReply({
        country: scenicLabel,
        month: ctx.travelMonth,
        cityOptions: resolveCountryCityOptions(scenicLabel, ctx.travelMonth),
      });
      return {
        reply:
          scenicBuilt?.reply ??
          sanitizeCountryCitySelectionReply(
            [
              `${scenicLabel} 這個月份不同地區的天氣與季節特色可能會有差異。`,
              "",
              COUNTRY_CITY_SELECTION_LAST_FALLBACK_ENDING,
            ].join("\n"),
            scenicLabel,
          ),
        pendingQuestion: pendingQuestionForCountryRegionChoice(
          scenicLabel,
          scenicBuilt?.cityOptions.map((o) => o.name) ?? [],
        ),
        contextPatch: {
          destination: scenicLabel,
          destinationCountry: scenicLabel,
          destinationType: "country",
          destinationCity: undefined,
          travelMonth: ctx.travelMonth,
          ...(ctx.travelYear != null ? { travelYear: ctx.travelYear } : {}),
          tripPurpose: "destination_selection",
          conversationState: "discover",
          planningDaysConfirmed: false,
        },
      };
    }

    const monthResult = buildScenicMonthPlanningResult({
      destination: scenicLabel,
      context: { ...ctx, destination: scenicLabel },
      userText,
      weather: ctx.weather ?? session.weather ?? null,
    });
    return {
      reply: monthResult.reply,
      pendingQuestion: pendingQuestionForAskDays(
        scenicLabel,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      ),
      contextPatch: {
        destination: scenicLabel,
        suggestedStartDate: monthResult.suggestedStartDate,
        tripPurpose: "travel_window_suggested",
        conversationState: "awaiting_days",
        planningDaysConfirmed: false,
      },
    };
  }

  const reply = buildDestinationAdviceReplyBody(ctx, session, userText);
  if (!reply) return { reply: null };

  return {
    reply,
    pendingQuestion: inferPendingQuestionFromAdviceReply(reply, ctx, session),
    contextPatch: reply.includes("我幫你整理幾個") || reply.includes("我會先抓這些必去點")
      ? {
          mustVisitGenerated: true,
          tripPurpose: "must_visit_places",
          planningStage: "recommendations_generated",
        }
      : undefined,
  };
}

export function buildDestinationAdviceReply(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): string | null {
  return resolveDestinationAdvice(ctx, session, userText).reply;
}

function buildDestinationAdviceReplyBody(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): string | null {
  if (isTripAddPlaceSession(session)) return null;

  if (hasCategoryPlaceQuery(userText) && resolveDestinationFromText(userText)) {
    logChatWrongFallbackBlocked("category_place_advice_body_blocked");
    return null;
  }

  if (
    ctx.conversationState === "ready_for_itinerary" ||
    ctx.tripPurpose === "ready_for_itinerary" ||
    ctx.tripPurpose === "combination_suggestions_offered" ||
    ctx.tripPurpose === "create_itinerary_from_accepted"
  ) {
    return null;
  }

  if (parseMustVisitPlacesIntent(userText)) {
    const mustVisit = resolveMustVisitAdvice(ctx, userText);
    if (mustVisit) return mustVisit.reply;
  }

  const dest =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city ??
    session.preferredArea;
  const destLabel = dest ? normalizeDestinationLabel(dest) : undefined;
  const country = ctx.destinationCountry
    ? normalizeDestinationLabel(ctx.destinationCountry)
    : undefined;

  const purpose =
    (isCreateItineraryIntent(userText) ? "create_itinerary" : undefined) ??
    (isBestTravelTimeIntent(userText) ? "best_time_to_visit" : undefined) ??
    (isDestinationUpdateText(userText, session) ? "region_selected" : undefined) ??
    parseDestinationAdvicePurpose(userText) ??
    (ctx.tripPurpose as DestinationAdvicePurpose | undefined) ??
    (session.travelContext?.tripPurpose as DestinationAdvicePurpose | undefined);

  const resolvedDest =
    destLabel ??
    resolveDestinationFromText(userText) ??
    parseDestinationFromText(userText);

  if (purpose === "best_time_to_visit" && resolvedDest && !isCreateItineraryIntent(userText)) {
    const travelDateExists = Boolean(
      ctx.travelMonth?.trim() ||
        ctx.startDate?.trim() ||
        hasUserSpecifiedTravelMonth(ctx, userText),
    );
    logChatTravelDateExists(travelDateExists);
    logChatDestinationContext(resolvedDest);
    logChatBestTravelTimeTriggered(normalizeDestinationLabel(resolvedDest));
    return travelDateExists
      ? buildTravelDateAssessmentReply(normalizeDestinationLabel(resolvedDest), ctx, userText)
      : buildBestTravelTimeReply(normalizeDestinationLabel(resolvedDest), {
          skipFollowUpQuestion: true,
        });
  }

  if (isFlexiblePreferenceReply(userText) && isDestinationAdviceActive(session, ctx) && dest) {
    if (session.pendingQuestion) return null;
    if (
      ctx.tripPurpose === "city_style_selected" ||
      ctx.tripPurpose === "duration_selected" ||
      ctx.tripPurpose === "ready_for_itinerary" ||
      ctx.tripPurpose === "must_visit_places"
    ) {
      return null;
    }
    if (purpose === "best_time_to_visit" || purpose === "region_selected") {
      if (destLabel && isKnownTouristCityLabel(destLabel)) {
        return null;
      }
      // Country-level: never ask abstract style — city selection owns next step.
      return null;
    }
    if (purpose === "seasonal_destination") {
      return null;
    }
    if (purpose === "destination_selection") {
      return null;
    }
    return `好的，我會依你剛才說的 ${dest} 方向繼續幫你規劃。`;
  }

  const month = ctx.travelMonth;
  const days = resolveInferredTripDays(ctx, session, userText);

  // 景點／風景區（阿里山、日月潭等）
  if (
    destLabel &&
    isKnownScenicLabel(destLabel) &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    !session.adviceSelectionThisTurn
  ) {
    const scenicReply = buildScenicAdviceReply(
      destLabel,
      userText,
      ctx,
      ctx.weather ?? session.weather ?? null,
    );
    if (scenicReply) return scenicReply;
  }

  // 城市層級回覆（優先於國家通用模板）
  // 若使用者已選定路線組合或行程風格，不再重複城市開場模板
  if (
    destLabel &&
    isKnownTouristCityLabel(destLabel) &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    ctx.tripPurpose !== "city_style_selected" &&
    !session.adviceSelectionThisTurn
  ) {
    const cityReply = buildCityAdviceReply(destLabel, country, userText);
    if (cityReply) return cityReply;

    if (isBestTravelTimeIntent(userText)) {
      const timeDest =
        resolvedDest ?? destLabel ?? resolveDestinationFromText(userText) ?? parseDestinationFromText(userText);
      if (timeDest) {
        return buildBestTravelTimeReply(normalizeDestinationLabel(timeDest), {
          skipFollowUpQuestion: true,
        });
      }
    }

    if (purpose === "destination_selection" || purpose === "region_selected") {
      const resolvedDays = days ?? ctx.days;
      if (resolvedDays && shouldSkipAskingDays({ ...ctx, days: resolvedDays })) {
        logChatContextUpdate({ destination: destLabel, days: resolvedDays });
        logChatNextStep("trip_style");
        if (shouldAskTripStyle(
          { ...ctx, destination: destLabel, days: resolvedDays, planningDaysConfirmed: true },
          session,
          userText,
        )) {
          return buildAskTripStyleAdviceResult(
            { ...ctx, destination: destLabel, days: resolvedDays, planningDaysConfirmed: true },
            session,
            userText,
          ).reply;
        }
        logChatNextStep("combination_suggestions");
        if (hasDestinationCombinations(destLabel)) {
          return (
            buildDestinationCombinationSuggestionsReply(destLabel, resolvedDays, {
              startDate: ctx.startDate,
            }) ?? null
          );
        }
        return buildCityDaysConfirmedReply(destLabel, resolvedDays, country, {
          weather: ctx.weather,
          context: { ...ctx, destination: destLabel, days: resolvedDays },
        }).reply;
      }
      if (!resolvedDays) {
        const dateAsk = buildDateAndDurationQuestionReply(destLabel, country, {
          context: { ...ctx, destination: destLabel },
          userText,
          previousPendingType: session.pendingQuestion?.type,
          blockedLegacyTemplate: "city_advice_without_days",
        });
        return dateAsk.reply;
      }
      if (shouldAskTripStyle({ ...ctx, destination: destLabel, days: resolvedDays }, session, userText)) {
        return buildAskTripStyleAdviceResult(
          { ...ctx, destination: destLabel, days: resolvedDays, planningDaysConfirmed: true },
          session,
          userText,
        ).reply;
      }
    }
  }

  // 國家層級：最佳月份（legacy — 已由通用 entity 回覆覆蓋，保留為後備）
  if (
    destLabel &&
    isKnownCountryLabel(destLabel) &&
    purpose === "best_time_to_visit"
  ) {
    const reply = buildCountryBestTimeReply(destLabel);
    if (reply) return reply;
  }

  // 國家層級：我想去 + 國家
  if (
    destLabel &&
    isKnownCountryLabel(destLabel) &&
    (purpose === "destination_selection" || purpose === "region_selected") &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    ctx.tripPurpose !== "must_visit_places" &&
    ctx.tripPurpose !== "ready_for_itinerary" &&
    !session.pendingQuestion
  ) {
    const countryAdvice = buildCountryCityCollectAdvice(destLabel, ctx, userText);
    if (countryAdvice?.reply) return countryAdvice.reply;
  }

  if (destLabel === "日本" && purpose === "seasonal_destination") {
    // Country-level seasonal: city selection is handled above; never ask style here.
    return null;
  }

  if (
    (destLabel === "東京" || destLabel === "大阪" || destLabel === "京都") &&
    purpose === "itinerary_planning" &&
    days
  ) {
    // Days known → combination flow owns travel direction (not free-form style Q).
    return null;
  }

  if (destLabel && purpose === "seasonal_destination") {
    if (!days && isKnownTouristCityLabel(destLabel)) {
      return buildDateAndDurationQuestionReply(destLabel, country, {
        context: { ...ctx, destination: destLabel },
        userText,
        previousPendingType: session.pendingQuestion?.type,
        blockedLegacyTemplate: "seasonal_destination_style_question",
      }).reply;
    }
    return null;
  }

  if (destLabel && purpose === "region_selected" && isKnownTouristCityLabel(destLabel)) {
    if (
      ctx.tripPurpose === "route_combination_selected" ||
      ctx.tripPurpose === "trip_style_selected"
    ) {
      return null;
    }
    // City confirmed without days → date/duration only (never style / landmark intro).
    if (!days) {
      return buildDateAndDurationQuestionReply(destLabel, country, {
        context: { ...ctx, destination: destLabel },
        userText,
        previousPendingType: session.pendingQuestion?.type,
        blockedLegacyTemplate: "region_selected_style_fallback",
      }).reply;
    }
    return null;
  }

  return null;
}
