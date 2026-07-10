import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useMessengerChatLayout } from "@/hooks/use-messenger-chat-layout";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageList, RoamieAssistantAvatar } from "@/components/chat/ChatMessageList";
import { ChatKeyboardDebugOverlay } from "@/components/chat/ChatKeyboardDebugOverlay";
import { useScrollPerfMonitor } from "@/hooks/use-scroll-perf-monitor";
import { isChatKeyboardDebugEnabled } from "@/lib/chat-keyboard-visual-debug";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadChatHistory, clearChatHistory, type ChatMsg } from "@/lib/chat-history";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { enrichRoamieContext } from "@/lib/ai/enrich-context";
import { resolveEffectivePlanTierWithProfile } from "@/lib/access/resolve";
import { getWeather } from "@/lib/weather.functions";
import { geocodeTripLocationFromText } from "@/lib/location.functions";
import { searchPlaces, getPlaceDetails } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { streamRoamieAI, fetchRoamieAI } from "@/lib/ai/stream-client";
import { PreferenceQuizCta } from "@/components/PreferenceQuizCta";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromRecommendation } from "@/lib/trip/trip-place-input";
import { logTripNav, tripDetailNavigateOptions, TRIP_DETAIL_ROUTE } from "@/lib/trip/trip-detail-nav";
import { isValidUuid } from "@/lib/uuid";
import {
  consumeTripAddPlaceHandoff,
  enrichTripAddPlaceRecommendationsFromSummary,
  fetchTripAddPlaceCandidatePool,
  fetchTripAddPlaceFollowUpRecommendations,
  fetchTripAddPlaceRecommendations,
  ensureHandoffRecommendationSession,
  buildTripAddPlaceAssistantMessage,
  isTripAddPlaceSession,
  markTripAddPlaceHandoffComplete,
  mergeTripAddPlaceHistoryWithRecommendations,
  parseTripAddPlaceFollowUpIntent,
  prepareTripAddPlaceSession,
  reinforceTripAddPlaceSession,
  tripAddPlaceRecommendationsToSession,
} from "@/lib/trip/trip-add-place-handoff";
import {
  isTripAddPlaceMoreRecommendationsRequest,
  markTripAddPlaceAdded,
  rebuildTripAddPlaceRecommendationSession,
  resolveTripAddPlaceChatSession,
  resolveTripAddPlaceMoreTurn,
  shouldHandleTripAddPlaceMoreTurn,
} from "@/lib/trip/trip-add-place-recommendation-session";
import {
  logTripAddPlaceFailure,
  processTripAddPlaceUserMessage,
} from "@/lib/trip/trip-add-place-recommendation-engine";
import {
  logTripAddPlaceMode,
  shouldShowTripAddPlacePlusUpsell,
  TRIP_ADD_PLACE_EMPTY_HINT,
} from "@/lib/trip/trip-add-place-mode";
import {
  buildTripAddPlaceChatMessage,
  buildTripAddPlaceLoadingMessage,
  buildTripAddPlaceRenderFallbackMessage,
  logTripAddPlaceRenderEmpty,
} from "@/lib/trip/trip-add-place-render";
import { appendPlaceToTrip } from "@/lib/trip/append-place-to-trip";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import { buildNewSavedPlaceInput } from "@/lib/saved-place-utils";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";
import { generateItinerary } from "@/lib/itinerary.functions";
import { confirmSaveTrip } from "@/lib/itinerary-storage";
import { clearDraftTrip, loadDraftTrip, saveDraftTrip } from "@/lib/trip-draft-storage";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  coalesceItineraryItems,
  hasValidItineraryStops,
  ITINERARY_GENERATION_FAILED_MESSAGE,
} from "@/lib/trip/itinerary-guards";
import { getRecommendation } from "@/lib/recommendation-storage";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import { finalizeChatRecommendationDisplay, mergeAssistantRecommendationMessage } from "@/lib/chat-display-recommendations";
import {
  enrichChatPlaceItemFromDetails,
  hasValidPlaceCoordinates,
} from "@/lib/chat-place-context";
import { logChatUiReceivedCards } from "@/lib/ai/chat-place-flow-log";
import { openRecommendationPlaceDetail } from "@/lib/recommendation-place-handoff";
import {
  buildPlaceDetailFollowUpReply,
  buildPlaceDetailReply,
  ensurePlaceDetailFocusCoordinates,
  enterPlaceDetailChat,
  isPlaceDetailChatActive,
  parsePlaceDetailFollowUp,
  resolvePlaceDetailNearbyIntent,
  sessionWithPlaceDetailSearchCenter,
  type FetchPlaceDetailsForFocusFn,
} from "@/lib/ai/place-detail-chat";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import {
  clearChatUiCache,
  consumeChatUiCache,
  peekChatUiCache,
  preserveChatUiForPlaceDetail,
} from "@/lib/chat-ui-cache";
import { logAppError } from "@/lib/log-error";
import { isLateNightMode } from "@/lib/recommend-place-ranking";
import {
  buildApiMessagesFromConversation,
  extractChatPlanningContextFromText,
  resolveChatApiPhase,
  resolveSessionPhaseAfterReply,
} from "@/lib/chat-planning-flow";
import {
  applyTripIntentToSession,
  formatTripIntentForAi,
  parseTripIntentFromSession,
  parseTripIntentFromText,
} from "@/lib/recommendation/trip-intent";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import {
  loadChatSession,
  saveChatSession,
  clearChatSession,
  createEmptySession,
  mergeSessionFromRoamie,
  addSelectedPlace,
  extractPlanningHintsFromText,
  extractDiscoveryFromText,
  isDiscoveryComplete,
  isUserConfirmingItinerary,
  canGenerateItinerary,
  buildConversationSummary,
  roamieRecToChatItem,
  placeDisplayName,
  mapPlaceResultToChatItem,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";
import {
  buildPlusHomeHandoffOpening,
  markPlusHomeHandoffComplete,
  preparePlusHomeChatSession,
} from "@/lib/plus-chat-handoff";
import {
  buildContextualMoodHandoffOpening,
  buildHandoffRoamiePayload,
  buildInitialChatContext,
  prepareMoodFlowSession,
  markMoodHandoffComplete,
  isMoodHandoffDoneForRec,
  clearMoodHandoffStorage,
} from "@/lib/mood-chat-handoff";
import { buildPlanTripHandoffOpening, buildPlanAiHandoffOpening, markPlanHandoffComplete } from "@/lib/plan-trip-handoff";
import { clearPlanFormDraft } from "@/lib/plan-form-draft-storage";
import { buildContextBundleForTrip } from "@/lib/fetch-context";
import { formatTripLocationLabel } from "@/lib/location/format";
import { useI18n } from "@/hooks/use-i18n";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { resolveChatConnectionFallbackMessage } from "@/lib/user-facing-error";
import { useAccess } from "@/hooks/use-access";
import { useTravelPrefStatus } from "@/hooks/use-preference-quiz-status";
import { mergePreferencesWithTravelPrefStatus } from "@/lib/travel-pref-status";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildPlanningMemoryContext,
  buildTripFromSelectedPlaces,
  extractPlaceNames,
  syncSessionPlaceMemory,
} from "@/lib/place-planning-memory";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { readHomeMood, clearHomeMoodUiSelection } from "@/lib/home-mood";
import { normalizeHomeMoodId } from "@/lib/home-mood-options";
import {
  beginHomeMoodShortcutSession,
  discardHomeMoodShortcutSession,
  isHomeMoodShortcutSearch,
  markHomeMoodShortcutEngaged,
  shouldDiscardHomeMoodShortcutSession,
} from "@/lib/home-mood-shortcut-session";
import {
  mergeTripPlanningContext,
  resolveConversationMode,
  formatTripPlanningContextForAi,
} from "@/lib/ai/trip-planning-context";
import {
  buildTravelContext,
  extractTravelIntent,
  updateTripDraftFromConversation,
} from "@/services/aiTravelContextService";
import { mergeTravelContext, formatTravelContextForAi, type CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  applyQuickChipContext,
  detectChatIntent,
  inferNearbyIntentFromContext,
  isNearbyPlaceIntent,
  sessionHasLocation,
} from "@/lib/ai/chat-intent";
import {
  buildCampingIntroReply,
  campingSearchAttempts,
  filterCampingPlaces,
} from "@/lib/ai/activity-camping";
import {
  applyDiningContextFromText,
  isFoodPreferenceReply,
  parseFoodPreference,
  resolveChatIntent,
  restaurantCuisineQuestion,
  shouldAskRestaurantCuisine,
  shouldFetchNearbyPlaces,
} from "@/lib/ai/chat-dining-flow";
import {
  buildNearbyPlaceRecommendation,
  buildSummaryForRecommendations,
  restaurantSearchFallbackQueries,
} from "@/lib/ai/chat-place-recommendation";
import { filterPlacesForFoodIntent, isFoodIntentText } from "@/lib/ai/chat-food-filter";
import { resolveNearbySearchCenter } from "@/lib/ai/chat-nearby-search";
import { buildDestinationMustVisitRecommendation, buildAlternativeDestinationRecommendations, buildMoreDestinationRecommendations } from "@/lib/ai/destination-place-recommendation";
import { buildDestinationCategoryRecommendations } from "@/lib/ai/chat-destination-category-recommendation";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { coerceTravelDestination } from "@/lib/ai/trip-planning-context";
import {
  mapCategoryIntentToNearbyIntent,
  parseChatPlaceIntents,
  resolveDestinationForCategorySearch,
  shouldBlockPlanningFallbackForCategoryQuery,
  shouldFetchDestinationCategoryPlaces,
} from "@/lib/ai/chat-place-intent";
import {
  applyRefreshRecommendationSession,
  CHAT_STATE_MACHINE_RECOVERY_MESSAGE,
  collectBlockedCoreNames,
  collectExcludePlaceIds,
  collectHardDuplicatePlaceIds,
  extractRecommendedFromMsgs,
  isMorePlaceRecommendationsIntent,
  logChatMorePlacesExcludeIds,
  logChatMorePlacesIntent,
  logChatMorePlacesNoResultAllowed,
  resolveRefreshNearbyIntent,
  shouldAcceptAlternativeRecommendations,
  shouldRefetchPlaces,
} from "@/lib/ai/chat-recommendation-refresh";
import {
  isFallbackPlanningPlaceId,
  logPlaceDetailsHttp400Ignored,
  logPlaceDetailsSkipFallbackId,
} from "@/lib/ai/planning-place-id";
import {
  logAiStyleReselectGenerateFail,
  logAiStyleReselectGenerateStart,
  logAiStyleReselectGenerateSuccess,
} from "@/lib/ai/planning-style-reselect-log";
import {
  collectUsedPlaces,
  logAiFollowupMoreDetected,
  logAiFollowupSessionUsedUpdated,
  mergeTripSessionUsedPlacesFromMessages,
} from "@/lib/ai/trip-planning-follow-up";
import { resolveRecommendationStyleTag } from "@/lib/ai/resolve-recommendation-style-tag";
import { isAddAllToTripIntent } from "@/lib/ai/parse-add-all-to-trip-intent";
import {
  logAiCreateTripError,
  logAiCreateTripStart,
  logAiCreateTripSuccess,
  prepareSessionForCreateTripFromRecommendations,
} from "@/lib/ai/create-trip-from-recommendations";
import {
  buildItineraryDaysFromDayPlan,
  buildItineraryFromDayPlan,
  dayPlanToChatPlaces,
  dayPlanToRecommendations,
  verifyDayPlanItineraryOrder,
  type AiDayPlan,
} from "@/lib/ai/ai-day-plan-source";
import { dedupePlaceCardsForRender } from "@/lib/ai/ai-trip-place-allocator";
import {
  logAiCreateItineraryDay,
  logAiCreateTripDates,
  logTripCardRenderDates,
  resolveTripCreateDates,
} from "@/lib/ai/resolve-trip-create-dates";
import {
  alignDayPlanToSession,
  clearPlanningSessionState,
  getFrozenPlanningDayPlan,
  getOrCreatePlanningSessionId,
  isStalePlanningSession,
  isPlanningRenderInProgress,
  logAiPlaceCardsSkipStale,
  logAiPushPlaceCardsSession,
  logAiStaleRecommendationsBlocked,
  setPlanningRenderInProgress,
  shouldStartNewPlanningSession,
  startNewPlanningSession,
} from "@/lib/ai/ai-planning-session";
import {
  isReplanIntent,
  resetChatPlanningForReplan,
  withChatPlanningState,
  isStyleReselectTurn,
  shouldTriggerTripStylePlanning,
  applyStyleReselectToSession,
  logChatRegeneratePlaceCardsStart,
  logChatRegeneratePlaceCardsDone,
  stripPreviousPlaceCardMessages,
} from "@/lib/ai/chat-planning-state";
import {
  enrichContextForItineraryMode,
  logChatRenderItinerary,
  logChatRenderPlaceList,
  shouldUseItineraryMode,
} from "@/lib/ai/chat-itinerary-mode";
import { parseAskTripStyleSelection, type TripStyleKey } from "@/lib/ai/ai-trip-style";
import {
  logAiRenderBlocked,
  logAiRenderItineraryStart,
  logAiRenderItinerarySuccess,
} from "@/lib/ai/normalize-planning-places";
import { shouldFetchDestinationPlaces, resolveMustVisitDestination, mergeContextForPlaceFetch, buildNamedFallbackRecommendations } from "@/lib/ai/must-visit-places";
import { resolveConversationDestination } from "@/lib/ai/ai-chat-conversation-state";
import { buildWeatherAwarePlaceIntro, resolveWeatherScene } from "@/lib/ai/weather-place-search";
import { placesStatsPayload } from "@/lib/places-api-stats";
import { resolveChatLocation } from "@/lib/ai/resolve-chat-location";
import {
  filterPlacesByDestinationGuard,
  placesSearchContextPayload,
  resolveChatPlaceSearchContext,
} from "@/lib/ai/chat-place-search-context";
import {
  markAskedClarifyKey,
  resolveChatRoute,
} from "@/lib/ai/chat-router";
import { applyAdviceResultToSession, resolveDestinationAdvice, adviceToAssistantChatMsg } from "@/lib/ai/destination-advice";
import {
  isPlanningTurnActive,
  processAdviceTurn,
  resolvePlanningFallbackTurn,
  type ChatTurnResult,
} from "@/lib/ai/chat-state-machine";
import {
  AI_ITINERARY_SUCCESS_REDIRECT_MESSAGE,
  createItineraryFromSession,
  logAiItinerarySuccess,
  logAiState,
  prepareDirectItineraryFlow,
} from "@/lib/ai/ai-itinerary-state-machine";
import { prepareDirectItinerarySession } from "@/lib/ai/itinerary-place-fetch";
import {
  logItineraryFailureReason,
  logItineraryItemsCoalesced,
  logItinerarySaveFailed,
  logItinerarySavePayloadReady,
  logItinerarySaveStart,
  logItinerarySaveSuccess,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import { prefetchDestinationWeather } from "@/lib/ai/destination-weather-prefetch";
import { buildPlanningOfflineReply } from "@/lib/ai/chat-turn-engine";
import {
  isDestinationPlanningSession,
  isGenericFallbackReply,
  prepareSessionForUserTurn,
} from "@/lib/ai/chat-conversation-state";
import {
  applyBudgetRefinementToSession,
  buildBudgetRefinementSummary,
  isBudgetRefinementText,
  refineRecommendationItemsForBudget,
} from "@/lib/ai/budget-refinement";
import {
  fallbackSearchQuery,
  generateLocalRecommendationFallback,
} from "@/lib/ai/local-recommendation-fallback";
import { getTripLegsWithDurations, travelLabelToRoutesMode } from "@/services/routesService";
import { generateOutfitSuggestion, normalizeWeather } from "@/services/weatherService";
import { attachCoreTripToPayload, toCoreTrip, type CoreTrip } from "@/lib/trip/core-trip";
import { getTripCoverImage } from "@/services/placeImageService";

type ChatSearch = {
  from?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
  mood?: string;
  prompt?: string;
  tripId?: string;
  day?: number;
};

export const Route = createFileRoute("/_app/chat")({
  validateSearch: (s: Record<string, unknown>): ChatSearch => {
    const dayRaw = s.day;
    const day =
      typeof dayRaw === "number"
        ? dayRaw
        : typeof dayRaw === "string" && dayRaw.trim()
          ? Number.parseInt(dayRaw, 10)
          : undefined;
    return {
      from: typeof s.from === "string" ? s.from : undefined,
      recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
      fromMoodFlow: typeof s.fromMoodFlow === "string" ? s.fromMoodFlow : undefined,
      mood: typeof s.mood === "string" ? s.mood : undefined,
      prompt: typeof s.prompt === "string" ? s.prompt : undefined,
      tripId: typeof s.tripId === "string" ? s.tripId : undefined,
      day: day != null && Number.isFinite(day) && day > 0 ? day : undefined,
    };
  },
  component: Chat,
});

async function getAiPreferences() {
  return mergePreferencesWithTravelPrefStatus(
    await getPreferences(),
    readCachedAuthenticatedUserIdSync(),
  );
}

function Chat() {
  const { t, locale } = useI18n();
  const travelPrefStatus = useTravelPrefStatus();
  const { hasPlusAccess } = useAccess();
  const { openAddToTrip } = useAddToTrip();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const greetingMsg = useMemo(
    (): ChatMsg => ({ role: "assistant", content: t("chat.greeting") }),
    [t],
  );
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const msgsRef = useRef<ChatMsg[]>([]);
  const [session, setSession] = useState<ChatPlanningSession>(() => loadChatSession());
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [lastFailed, setLastFailed] = useState<ChatMsg[] | null>(null);
  const [partial, setPartial] = useState<Partial<RoamieResponse>>({});
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef(false);
  const prevMsgsLengthRef = useRef(0);
  const pendingScrollTopRef = useRef<number | null>(null);
  const {
    metrics: messengerLayout,
    scrollToBottom,
    scrollToUserMessage,
    scrollToAiMessageStart,
    scrollToPlaceCardsStart,
  } = useMessengerChatLayout({
    headerRef,
    composerRef,
    messagesRef,
    bottomAnchorRef,
  });
  const keyboardVisible = messengerLayout.keyboardOpen;
  const showShortcutChips = true;
  const abortRef = useRef<AbortController | null>(null);
  const handoffStartedRef = useRef<string | null>(null);
  const planHandoffStartedRef = useRef(false);
  const tripAddPlaceHandoffStartedRef = useRef(false);
  const autoPromptHandledRef = useRef(false);
  const homeMoodShortcutEngagedRef = useRef(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const partialScrollKey = `${partial.summary?.length ?? 0}:${partial.recommendations?.length ?? 0}`;

  useScrollPerfMonitor("chat", messagesRef);

  useEffect(() => {
    if (hydrating || !streaming) return;
    const lastIndex = msgs.length - 1;
    if (lastIndex >= 0 && msgs[lastIndex]?.role === "assistant") {
      scrollToAiMessageStart(lastIndex, msgs[lastIndex]?.id);
    }
  }, [hydrating, streaming, partialScrollKey, msgs, scrollToAiMessageStart]);

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  useEffect(() => {
    if (hydrating) return;
    if (pendingScrollTopRef.current != null) return;
    if (msgs.length > prevMsgsLengthRef.current) {
      const lastIndex = msgs.length - 1;
      const last = msgs[lastIndex];
      if (last?.role === "user") {
        scrollToUserMessage(lastIndex, last.id);
      } else if (last?.role === "assistant") {
        scrollToAiMessageStart(lastIndex, last.id);
        if ((last.roamie?.recommendations?.length ?? 0) > 0 || (last.structuredPlaces?.length ?? 0) > 0) {
          requestAnimationFrame(() => {
            scrollToPlaceCardsStart(lastIndex, last.id);
          });
        }
      }
    }
    prevMsgsLengthRef.current = msgs.length;
  }, [hydrating, msgs, msgs.length, scrollToUserMessage, scrollToAiMessageStart, scrollToPlaceCardsStart]);

  useEffect(() => {
    if (hydrating) return;
    if (pendingScrollTopRef.current != null) return;
    if (prevStreamingRef.current && !streaming) {
      const lastIndex = msgs.length - 1;
      const last = msgs[lastIndex];
      if (last?.role === "assistant") {
        scrollToAiMessageStart(lastIndex, last.id);
        if ((last.roamie?.recommendations?.length ?? 0) > 0 || (last.structuredPlaces?.length ?? 0) > 0) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollToPlaceCardsStart(lastIndex, last.id);
            });
          });
        }
      }
    }
    prevStreamingRef.current = streaming;
  }, [hydrating, streaming, msgs, scrollToAiMessageStart, scrollToPlaceCardsStart]);
  const [clearing, setClearing] = useState(false);
  const fetchWeather = useServerFn(getWeather);
  const geocodeLocationFn = useServerFn(geocodeTripLocationFromText);
  const fetchPlaceDetailsFn = useServerFn(getPlaceDetails);
  const searchNearbyPlacesServerFn = useServerFn(searchPlaces);
  const searchNearbyPlaces = useMemo(
    () => createUnifiedSearchPlacesFn(searchNearbyPlacesServerFn),
    [searchNearbyPlacesServerFn],
  );
  const fetchPlaceDetailsForFocus = useCallback<FetchPlaceDetailsForFocusFn>(
    async (placeId, opts) => {
      const trimmedId = placeId.trim();
      if (isFallbackPlanningPlaceId(trimmedId)) {
        logPlaceDetailsSkipFallbackId(trimmedId);
        const placeName = opts?.placeName?.trim();
        const city = opts?.city?.trim();
        if (placeName && city) {
          try {
            const search = await searchNearbyPlaces({
              data: {
                query: `${city} ${placeName}`,
                mode: "text",
                locale,
                placesCaller: "style_reselect_place_resolve",
                placesScreen: "chat",
                destinationName: city,
                searchMode: "destination",
              },
            });
            const realId = search.places?.find(
              (p) => (p.name ?? "").trim() === placeName,
            )?.id ?? search.places?.[0]?.id;
            if (realId && !isFallbackPlanningPlaceId(realId)) {
              const result = await fetchPlaceDetailsFn({ data: { placeId: realId, locale } });
              const place = result.place;
              if (place?.lat != null && place?.lng != null) {
                return {
                  lat: place.lat,
                  lng: place.lng,
                  name: place.name,
                  address: place.address,
                  placeId: place.id,
                };
              }
            }
          } catch {
            /* keep fallback basic data */
          }
        }
        return null;
      }

      const result = await fetchPlaceDetailsFn({ data: { placeId: trimmedId, locale } });
      if (result.error === "synthetic_id") return null;
      const place = result.place;
      if (!place || place.lat == null || place.lng == null) {
        if (result.error) {
          logPlaceDetailsHttp400Ignored(trimmedId);
        }
        return null;
      }
      return {
        lat: place.lat,
        lng: place.lng,
        name: place.name,
        address: place.address,
        placeId: place.id,
      };
    },
    [fetchPlaceDetailsFn, locale, searchNearbyPlaces],
  );
  const generate = useServerFn(generateItinerary);

  const selectedNames = useMemo(
    () => new Set(session.selectedPlaces.map((p) => p.name)),
    [session.selectedPlaces],
  );

  const persistSession = useCallback((next: ChatPlanningSession) => {
    setSession(next);
    saveChatSession(next);
    if (next.homeMoodShortcutEngaged) {
      homeMoodShortcutEngagedRef.current = true;
    }
  }, []);

  const persistPlanningAdviceTurn = useCallback(
    (turn: ChatTurnResult, baseSession: ChatPlanningSession) => {
      const recs = turn.advice.recommendations?.map(roamieRecToChatItem) ?? [];
      let nextSession = applyAdviceResultToSession(
        {
          ...turn.session,
          pendingQuestion: turn.route?.pendingQuestion,
          lastResolvedPendingQuestion: undefined,
          adviceSelectionThisTurn: undefined,
          lastAssistantReply: turn.advice.reply ?? baseSession.lastAssistantReply,
          recommendedPlaces: recs.length ? recs : turn.session.recommendedPlaces,
          phase:
            turn.advice.contextPatch?.conversationState === "ready_for_itinerary" ||
            turn.advice.triggerItineraryGeneration
              ? "ready"
              : recs.length
                ? "recommend"
                : turn.session.phase,
        },
        turn.advice,
      );
      if (turn.route?.pendingQuestion?.type === "ask_trip_style") {
        nextSession = withChatPlanningState(nextSession, "waitingStyleSelection", "ask_trip_style");
      } else if (turn.route?.pendingQuestion?.type === "ask_days") {
        nextSession = withChatPlanningState(nextSession, "waitingTripDays", "ask_days");
      } else if (turn.advice.triggerPlaceRecommendations) {
        nextSession = withChatPlanningState(nextSession, "generatingPlan", "trip_style_selected");
      }
      persistSession(nextSession);
      return nextSession;
    },
    [persistSession],
  );

  const runDirectItineraryRef = useRef<
    (
      session: ChatPlanningSession,
      context: CanonicalTravelContext,
      conversation: ChatMsg[],
    ) => Promise<void>
  >(async () => {});

  const pushDestinationPlaceRecommendationRef = useRef<
    (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: {
        excludePlaceIds?: string[];
        rejectedPlaceNames?: string[];
        forceRegenerate?: boolean;
        replacePreviousCards?: boolean;
      },
    ) => Promise<boolean>
  >(async () => false);

  const completeAdviceTurn = useCallback(
    async (
      turn: ChatTurnResult,
      baseSession: ChatPlanningSession,
      context: CanonicalTravelContext,
      conversation: ChatMsg[],
    ) => {
      const updated = persistPlanningAdviceTurn(turn, baseSession);
      const userText = [...conversation].reverse().find((m) => m.role === "user")?.content ?? "";
      const withReply: ChatMsg[] = turn.advice.triggerPlaceRecommendations
        ? conversation
        : [...conversation, adviceToAssistantChatMsg(turn.advice)];
      if (!turn.advice.triggerPlaceRecommendations) {
        setMsgs(withReply);
      }
      if (turn.advice.triggerItineraryGeneration) {
        await runDirectItineraryRef.current(
          updated,
          { ...context, ...turn.advice.contextPatch },
          withReply,
        );
      }
      const planningHandle = turn.advice.triggerPlaceRecommendations
        ? getOrCreatePlanningSessionId(
            withChatPlanningState(updated, "generatingPlan", "trigger_place_recommendations"),
            "trigger_place_recommendations",
          )
        : null;
      if (planningHandle) {
        persistSession(planningHandle.session);
      }

      if (turn.advice.triggerPlaceRecommendations && planningHandle) {
        setStreaming(true);
        try {
          logAiRenderItineraryStart();
          const styleReselect = isStyleReselectTurn(userText, planningHandle.session, {
            ...context,
            ...turn.advice.contextPatch,
          });
          const advicePlaceCtx = {
            ...(planningHandle.session.travelContext ?? context),
            ...turn.advice.contextPatch,
            planningDaysConfirmed:
              turn.advice.contextPatch?.planningDaysConfirmed ??
              planningHandle.session.travelContext?.planningDaysConfirmed ??
              context.planningDaysConfirmed ??
              Boolean(planningHandle.session.travelContext?.days ?? context.days),
          };
          const sessionForAdvice = styleReselect
            ? applyStyleReselectToSession(planningHandle.session, advicePlaceCtx, styleReselect)
            : {
                ...planningHandle.session,
                travelContext: advicePlaceCtx,
              };
          if (styleReselect) {
            persistSession(sessionForAdvice);
          }
          const applied = await pushDestinationPlaceRecommendationRef.current(
            sessionForAdvice,
            userText,
            conversation,
            {
              forceRegenerate: true,
              replacePreviousCards: Boolean(styleReselect),
            },
          );
          if (applied) {
            const live = loadChatSession();
            const count =
              live.recommendedPlaces?.length ?? live.currentDayPlan?.items.length ?? 0;
            logAiRenderItinerarySuccess(count);
            if (styleReselect) {
              logChatRegeneratePlaceCardsDone(count);
            }
          } else {
            const live = loadChatSession();
            const placeCtx = {
              ...(live.travelContext ?? context),
              ...turn.advice.contextPatch,
            };
            const label =
              resolveConversationDestination(placeCtx, live) ??
              placeCtx.destination?.trim();
            const namedRecs = label ? buildNamedFallbackRecommendations(label) : [];
            if (namedRecs.length && label) {
              const intro = buildWeatherAwarePlaceIntro(
                label,
                resolveWeatherScene(live.weather ?? null, label),
                false,
              );
              const summary = [
                intro,
                "",
                ...namedRecs.map(
                  (rec, index) =>
                    `${index + 1}. ${rec.name}${rec.reason ? ` — ${rec.reason}` : ""}`,
                ),
                "",
                "想加進行程的話，跟我說你最想先排哪幾個。",
              ].join("\n");
              setMsgs([
                ...conversation,
                {
                  role: "assistant",
                  content: summary,
                  roamie: {
                    version: 2,
                    title: "必去推薦",
                    summary,
                    moodTag: placeCtx.mood ?? "",
                    recommendations: namedRecs,
                    itinerary: [],
                    generatedAt: new Date().toISOString(),
                  },
                },
              ]);
              persistSession(
                withChatPlanningState(
                  {
                    ...live,
                    recommendedPlaces: namedRecs as ChatPlaceItem[],
                    phase: "recommend",
                    pendingQuestion: undefined,
                  },
                  "planGenerated",
                  "style_plan_named_fallback",
                ),
              );
            } else if (turn.advice.reply?.trim()) {
              setMsgs([...conversation, adviceToAssistantChatMsg(turn.advice)]);
            }
          }
        } finally {
          setStreaming(false);
        }
      }
    },
    [persistPlanningAdviceTurn],
  );

  const markShortcutEngaged = useCallback(() => {
    homeMoodShortcutEngagedRef.current = true;
    setSession((prev) => {
      const next = markHomeMoodShortcutEngaged(prev);
      if (next === prev) return prev;
      saveChatSession(next);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (peekChatUiCache()) return;
      const pending = loadChatSession();
      if (pending.homeMoodShortcutEngaged || homeMoodShortcutEngagedRef.current) return;
      if (!shouldDiscardHomeMoodShortcutSession(pending)) return;
      abortRef.current?.abort();
      clearChatSession();
      void clearChatHistory();
    };
  }, []);

  useEffect(() => {
    if (
      hydrating ||
      session.fromMoodFlow ||
      session.fromMoodCard ||
      session.fromPlusHome ||
      session.fromTripAddPlace
    ) {
      return;
    }
    setMsgs((prev) => {
      if (prev.length === 0) return [greetingMsg];
      if (prev.length === 1 && prev[0].role === "assistant" && !prev[0].roamie) {
        return [greetingMsg];
      }
      return prev;
    });
  }, [greetingMsg, hydrating, session.fromMoodFlow, session.fromMoodCard, session.fromPlusHome, session.fromTripAddPlace]);

  useEffect(() => {
    if (hydrating || streaming) return;
    if (!session.fromTripAddPlace || !session.tripAddPlaceContext) return;
    if (msgs.length > 0) return;

    logTripAddPlaceRenderEmpty({
      reason: "blank_after_ready",
      messagesCount: 0,
      candidatesCount: session.recommendedPlaces?.length ?? 0,
      structuredPlacesCount: 0,
      loading: false,
    });

    const recs = (session.recommendedPlaces ?? []) as RoamieRecommendationItem[];
    if (recs.length) {
      setMsgs([
        buildTripAddPlaceAssistantMessage(
          session.lastAssistantReply ?? "",
          recs,
          session.mood ?? undefined,
          session,
        ),
      ]);
      return;
    }

    setMsgs([
      session.tripAddPlaceHandoffDone
        ? { role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }
        : buildTripAddPlaceRenderFallbackMessage(session),
    ]);
  }, [
    hydrating,
    streaming,
    msgs.length,
    session,
    session.fromTripAddPlace,
    session.tripAddPlaceContext,
    session.tripAddPlaceHandoffDone,
    session.recommendedPlaces,
    session.lastAssistantReply,
    session.mood,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uiCache = consumeChatUiCache();
        if (uiCache?.msgs?.length) {
          let session = loadChatSession();
          homeMoodShortcutEngagedRef.current = true;
          if (session.homeMoodShortcutEntry && !session.homeMoodShortcutEngaged) {
            session = markHomeMoodShortcutEngaged(session);
            saveChatSession(session);
          }
          setSession(session);
          setMsgs(uiCache.msgs);
          pendingScrollTopRef.current = uiCache.scrollTop;
          const places = await listPlaces();
          setSavedNames(new Set(places.map((p) => p.name)));
          return;
        }

        let session = loadChatSession();
        homeMoodShortcutEngagedRef.current = Boolean(session.homeMoodShortcutEngaged);

        if (search.from === "trip_add_place") {
          const handoff = consumeTripAddPlaceHandoff();
          if (handoff && (!search.tripId || handoff.tripId === search.tripId)) {
            const bundle = handoff.destinationLocation
              ? await buildContextBundleForTrip(handoff.destinationLocation, fetchWeather)
              : await buildClientContextBundle(fetchWeather);
            const enrichedHandoff = {
              ...handoff,
              weather: handoff.weather ?? bundle.weather,
            };
            session = prepareTripAddPlaceSession(enrichedHandoff, bundle);
            await clearChatHistory();
            persistSession(session);
            setSession(session);
            homeMoodShortcutEngagedRef.current = true;
          }
        }

        if (session.fromTripAddPlace && session.tripAddPlaceContext) {
          session = reinforceTripAddPlaceSession(session);
          setSession(session);
          logTripAddPlaceMode(
            session,
            search.from === "trip_add_place" ? "trip_add_place" : "chat_restore",
          );
        }

        const homeShortcutEntry = isHomeMoodShortcutSearch(search);
        if (!homeShortcutEntry && shouldDiscardHomeMoodShortcutSession(session)) {
          await discardHomeMoodShortcutSession();
          session = createEmptySession();
          homeMoodShortcutEngagedRef.current = false;
        }

        const moodId = normalizeHomeMoodId(search.mood?.trim() || readHomeMood());
        if (search.from !== "trip_add_place" && moodId && homeShortcutEntry) {
          const moodLabel = t(`home.moods.${moodId}`);
          const moodPrompt =
            search.prompt?.trim() || t(`home.moodPrompts.${moodId}`);
          let moodSession = beginHomeMoodShortcutSession(session, moodLabel);
          const bundle = await buildClientContextBundle(fetchWeather);
          moodSession = {
            ...moodSession,
            location: bundle.location,
            weather: bundle.weather,
            activeChatIntent: "attraction",
            phase: "recommend",
          };
          const mergedMood = mergeTravelContext(moodSession, moodPrompt);
          session = mergedMood.session;
          homeMoodShortcutEngagedRef.current = false;
          clearHomeMoodUiSelection();
          persistSession(session);
        } else if (moodId && !session.homeMoodShortcutEngaged && search.from !== "trip_add_place") {
          const moodLabel = t(`home.moods.${moodId}`);
          const moodPrompt =
            search.prompt?.trim() || t(`home.moodPrompts.${moodId}`);
          let moodSession: ChatPlanningSession = {
            ...session,
            mood: moodLabel,
            selectedMood: moodLabel,
            fromMoodCard: true,
            fromMoodFlow: search.from === "mood" ? true : session.fromMoodFlow,
          };
          if (search.from === "mood") {
            const bundle = await buildClientContextBundle(fetchWeather);
            moodSession = {
              ...moodSession,
              location: bundle.location,
              weather: bundle.weather,
              fromMoodFlow: true,
              activeChatIntent: "attraction",
              phase: "recommend",
            };
          }
          const mergedMood = mergeTravelContext(moodSession, moodPrompt);
          session = mergedMood.session;
          clearHomeMoodUiSelection();
          persistSession(session);
        } else if (search.from === "plus-home" && hasPlusAccess && !session.fromPlusHome) {
          const prefs = await getAiPreferences();
          session = preparePlusHomeChatSession({
            mood: session.selectedMood,
            prefs,
          });
          persistSession(session);
        }

        const isMoodFlow =
          search.fromMoodFlow === "1" ||
          search.from === "mood" ||
          (search.from === "recommendations" && !!search.recommendationId);

        if (isMoodFlow && search.recommendationId) {
          const record = await getRecommendation(search.recommendationId);
          const payload =
            record?.payload && isRoamiePayloadV2(record.payload) ? record.payload : null;
          if (record && payload?.recommendations?.length) {
            const bundle = await buildClientContextBundle(fetchWeather);
            const prefs = await getAiPreferences();
            const handoffDone = session.moodHandoffDone || isMoodHandoffDoneForRec(record.id);
            session = prepareMoodFlowSession({
              record,
              payload,
              bundle,
              preferences: prefs,
              existing: {
                ...session,
                moodHandoffDone: handoffDone,
                pendingHandoff: handoffDone ? false : true,
              },
            });
            persistSession(session);
          }
        } else {
          persistSession(session);
        }

        const places = await listPlaces();
        setSavedNames(new Set(places.map((p) => p.name)));

        const current = loadChatSession();
        const handoffKey = current.recommendationId ?? search.recommendationId ?? "";
        const shouldRunHandoff =
          current.fromMoodFlow &&
          current.pendingHandoff &&
          !current.moodHandoffDone &&
          handoffStartedRef.current !== handoffKey;

        if (shouldRunHandoff && handoffKey) {
          handoffStartedRef.current = handoffKey;
          setMsgs([]);
          await runRecommendationHandoff(current);
        } else {
          const shouldRunTripAddPlaceHandoff =
            current.fromTripAddPlace &&
            current.tripAddPlaceContext &&
            current.pendingHandoff &&
            !current.tripAddPlaceHandoffDone;

          if (shouldRunTripAddPlaceHandoff) {
            tripAddPlaceHandoffStartedRef.current = true;
            setMsgs([buildTripAddPlaceLoadingMessage()]);
            setSession(reinforceTripAddPlaceSession(current));
            try {
              await runTripAddPlaceHandoff(current);
            } catch (handoffError) {
              console.error("[TRIP_ADD_PLACE_HANDOFF_FAILED]", handoffError);
              if (!cancelled) {
                const fallback = buildTripAddPlaceRenderFallbackMessage(current, {
                  error: handoffError instanceof Error ? handoffError.message : String(handoffError),
                });
                setMsgs([fallback]);
                persistSession(
                  markTripAddPlaceHandoffComplete({
                    ...current,
                    lastAssistantReply: fallback.content,
                  }),
                );
              }
            }
          } else if (
            (search.from === "plan" || search.from === "plan-ai") &&
            current.fromPlanForm &&
            current.pendingHandoff &&
            !current.planHandoffDone &&
            !planHandoffStartedRef.current
          ) {
            planHandoffStartedRef.current = true;
            setMsgs([]);
            await runPlanFormHandoff(current);
          } else if (
            current.fromPlusHome &&
            current.pendingHandoff &&
            !current.plusHomeHandoffDone &&
            hasPlusAccess
          ) {
            const summary = buildPlusHomeHandoffOpening(current, current.plusHomeInsight);
            const opener: ChatMsg = {
              role: "assistant",
              content: summary,
              roamie: buildHandoffRoamiePayload(current, summary),
            };
            setMsgs([opener]);
            persistSession(markPlusHomeHandoffComplete(current));
          } else if (current.fromMoodFlow && current.moodHandoffDone) {
            const history = await loadChatHistory();
            if (history.length) {
              setMsgs(history);
            } else {
              const summary = buildContextualMoodHandoffOpening(current);
              const opener: ChatMsg = {
                role: "assistant",
                content: summary,
                roamie: buildHandoffRoamiePayload(current, summary),
              };
              setMsgs([opener]);
            }
          } else if (current.fromTripAddPlace && current.tripAddPlaceHandoffDone) {
            const restored = reinforceTripAddPlaceSession(current);
            persistSession(restored);
            setSession(restored);
            logTripAddPlaceMode(
              restored,
              search.from === "trip_add_place" ? "trip_add_place" : "chat_restore",
            );
            const history = await loadChatHistory();
            const recs = (restored.recommendedPlaces ?? []) as RoamieRecommendationItem[];
            if (history.length) {
              setMsgs(mergeTripAddPlaceHistoryWithRecommendations(history, restored));
            } else if (recs.length) {
              const summary =
                restored.lastAssistantReply?.trim() ||
                recs.map((r, i) => `${i + 1}. ${r.name}`).join("\n");
              setMsgs([
                buildTripAddPlaceAssistantMessage(summary, recs, restored.mood ?? undefined, restored),
              ]);
            } else {
              setMsgs([{ role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }]);
            }
          } else if (current.fromTripAddPlace && current.tripAddPlaceContext) {
            const restored = reinforceTripAddPlaceSession(current);
            persistSession(restored);
            setSession(restored);
            logTripAddPlaceMode(
              restored,
              search.from === "trip_add_place" ? "trip_add_place" : "chat_restore",
            );
            const history = await loadChatHistory();
            if (history.length) {
              setMsgs(mergeTripAddPlaceHistoryWithRecommendations(history, restored));
            } else {
              setMsgs([{ role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }]);
            }
          } else {
            const history = await loadChatHistory();
            if (history.length) setMsgs(history);
            else if (
              !current.fromMoodFlow &&
              !current.fromMoodCard &&
              !current.fromPlusHome &&
              !current.homeMoodShortcutEntry &&
              !current.fromTripAddPlace
            ) {
              setMsgs([greetingMsg]);
            }
          }
        }
      } catch (e) {
        console.error(e);
        const current = loadChatSession();
        if (current.fromTripAddPlace && current.tripAddPlaceContext && !cancelled) {
          logTripAddPlaceRenderEmpty({
            reason: "hydrate_error",
            messagesCount: 0,
            candidatesCount: current.recommendedPlaces?.length ?? 0,
            structuredPlacesCount: 0,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
          setMsgs([
            current.tripAddPlaceHandoffDone
              ? { role: "assistant", content: TRIP_ADD_PLACE_EMPTY_HINT }
              : buildTripAddPlaceRenderFallbackMessage(current, {
                  error: e instanceof Error ? e.message : String(e),
                }),
          ]);
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.recommendationId, search.from, search.mood, search.tripId, hasPlusAccess, t]);

  useEffect(() => {
    if (hydrating) return;
    const prompt = search.prompt?.trim();
    if (!prompt || autoPromptHandledRef.current) return;
    autoPromptHandledRef.current = true;
    void send(prompt, { source: "auto" });
    void navigate({
      to: "/chat",
      search: {
        from: search.from,
        recommendationId: search.recommendationId,
        fromMoodFlow: search.fromMoodFlow,
        mood: search.mood,
      },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrating, search.prompt]);

  const handleAddToTripFromChat = useCallback(
    async (rec: RoamieRecommendationItem) => {
      markShortcutEngaged();
      const ctx = session.tripAddPlaceContext;
      if (session.fromTripAddPlace && ctx) {
        if (!isValidUuid(ctx.tripId)) {
          toast.error("行程 ID 無效，請從行程頁重新進入");
          navigate({ to: "/saved", search: { tab: "trips" } });
          return;
        }
        try {
          await appendPlaceToTrip(
            { kind: "trip", tripId: ctx.tripId },
            tripPlaceFromRecommendation(rec),
            { date: ctx.dateKey, position: "end" },
          );
          persistSession(markTripAddPlaceAdded(session, rec));
          toast.success("已加入行程");
          logTripNav("ChatTripAddPlace", ctx.tripId);
          navigate(tripDetailNavigateOptions(ctx.tripId, { day: ctx.selectedDay }));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "加入行程失敗");
        }
        return;
      }
      openAddToTrip(tripPlaceFromRecommendation(rec));
    },
    [session.fromTripAddPlace, session.tripAddPlaceContext, navigate, openAddToTrip, persistSession],
  );

  const handleSavePlace = async (rec: RoamieRecommendationItem) => {
    markShortcutEngaged();
    setSavingName(rec.name);
    try {
      const { saved } = await toggleSavePlace(
        buildNewSavedPlaceInput({
          name: rec.name,
          category: rec.type,
          address: rec.address || null,
          city: session.location?.city ?? null,
          lat: rec.lat ?? null,
          lng: rec.lng ?? null,
          notes: rec.reason,
          mood_tag: session.mood ?? partial.moodTag ?? null,
          placeId: rec.googlePlaceId,
          googlePlaceId: rec.googlePlaceId,
          photoName: rec.photoName,
          rating: rec.rating,
          userRatingCount: rec.userRatingCount,
        }),
      );
      setSavedNames((prev) => {
        const next = new Set(prev);
        if (saved) next.add(rec.name);
        else next.delete(rec.name);
        return next;
      });
      toast.success(saved ? "已收藏" : "已取消收藏");
      if (saved) {
        persistSession(addSelectedPlace(session, roamieRecToChatItem(rec)));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setSavingName(null);
    }
  };

  useEffect(() => {
    if (hydrating) return;
    if (pendingScrollTopRef.current != null && messagesRef.current) {
      const top = pendingScrollTopRef.current;
      pendingScrollTopRef.current = null;
      requestAnimationFrame(() => {
        if (messagesRef.current) messagesRef.current.scrollTop = top;
      });
    }
  }, [msgs, streaming, partial, generating, hydrating]);

  const buildRequest = useCallback(
    async (
      conversation: ChatMsg[],
      overrides?: Partial<{
        chatPhase: import("@/lib/ai/context").ChatPhase;
        chatInput: string;
        userText: string;
        focusedPlace: ChatPlaceItem;
      }>,
      sessionOverride?: ChatPlanningSession,
    ) => {
      const activeSession = sessionOverride ?? session;
      const syncedForBundle = syncSessionPlaceMemory(activeSession);
      const bundle = syncedForBundle.tripDestination
        ? await buildContextBundleForTrip(syncedForBundle.tripDestination, fetchWeather)
        : await buildClientContextBundle(fetchWeather);
      const prefs = await getAiPreferences();
      const apiMessages = buildApiMessagesFromConversation(
        conversation.filter((m) => m.content !== t("chat.greeting")),
      );
      const lastUser = [...apiMessages].reverse().find((m) => m.role === "user");
      const userText = overrides?.userText ?? lastUser?.content ?? "";

      const savedList = await listPlaces();
      const planTier = await resolveEffectivePlanTierWithProfile();
      const synced = syncSessionPlaceMemory(activeSession);
      const tripIntent = parseTripIntentFromSession(synced);
      const apiPhase: import("@/lib/ai/context").ChatPhase =
        overrides?.chatPhase ?? resolveChatApiPhase(synced, userText, undefined, tripIntent);
      const tripIntentBlock = formatTripIntentForAi(tripIntent, prefs);
      devVerboseInfo("[Roamie AI] request context", {
        phase: apiPhase,
        destination: tripIntent.destinationCity ?? synced.location?.city ?? null,
        missing: tripIntent.missingKeys,
        planTier,
      });
      const initialCtx = [
        buildTravelContext(
          userText,
          updateTripDraftFromConversation(
            {
              destination: tripIntent.destinationCity,
              startDate: synced.tripStartDate,
              endDate: synced.tripEndDate,
              days: synced.tripDays,
              origin: synced.tripOrigin ? formatTripLocationLabel(synced.tripOrigin) : undefined,
              transportMode: synced.transportation,
              mood: synced.selectedMood ?? synced.mood,
            },
            extractTravelIntent(userText),
          ),
          {
            mood: synced.selectedMood ?? synced.mood,
            preferences: synced.discovery,
            savedPlaceNames: synced.selectedPlaceNames,
          },
          {
            ...bundle,
            mode: "chat",
            chatInput: userText,
            location: bundle.location,
            weather: bundle.weather,
            selectedPlaces: synced.selectedPlaces,
            plannedStops: synced.plannedStops,
            savedPlaceNames: savedList.map((p) => p.name),
            planTier,
          },
        ),
        synced.initialChatContext ?? buildInitialChatContext(synced),
        buildPlanningMemoryContext(synced),
        tripIntentBlock,
        synced.travelContext ? formatTravelContextForAi(synced.travelContext) : "",
        synced.tripPlanningContext
          ? formatTripPlanningContextForAi(synced.tripPlanningContext)
          : "",
        synced.placeDetailFocus
          ? [
              "【Place Detail Context】",
              `mode: place_detail`,
              `previousMode: ${synced.previousConversationMode ?? "mood_recommend"}`,
              `selectedPlace: ${placeDisplayName(synced.placeDetailFocus)}`,
              synced.placeDetailFocus.placeId
                ? `placeId: ${synced.placeDetailFocus.placeId}`
                : "",
              synced.placeDetailFocus.address
                ? `address: ${synced.placeDetailFocus.address}`
                : "",
              synced.placeDetailFocus.type ? `type: ${synced.placeDetailFocus.type}` : "",
              synced.placeDetailFocus.reason
                ? `recommendationReason: ${synced.placeDetailFocus.reason}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const recentNames = [
        ...new Set([
          ...loadRecentRecommendationNames(),
          ...extractPlaceNames(synced.selectedPlaces),
          ...(synced.plannedStops ? extractPlaceNames(synced.plannedStops) : []),
        ]),
      ];

      const base = toRoamieRequest("chat", bundle, {
        mood: synced.selectedMood ?? synced.mood,
        locale,
        preferences: prefs,
        planTier,
        chatInput: overrides?.chatInput ?? userText,
        lastUserIntent: userText || synced.lastUserIntent,
        messages: apiMessages,
        chatPhase: apiPhase,
        time: bundle.time,
        fromMoodCard: synced.fromMoodCard,
        fromMoodFlow: synced.fromMoodFlow,
        fromPlanForm: synced.fromPlanForm,
        fromPlanAi: synced.fromPlanAi,
        planAiMode: synced.planAiMode,
        selectedMood: synced.selectedMood ?? synced.mood,
        selectedCategory: synced.selectedCategory ?? synced.mood,
        initialChatContext: initialCtx,
        lateNightMode: synced.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
        avoidTypes: synced.avoidTypes,
        preferredArea: synced.preferredArea,
        rejectedPlaceNames: synced.rejectedPlaceNames,
        focusedPlace: overrides?.focusedPlace,
        selectedPlaces: synced.selectedPlaces,
        selectedPlaceIds: synced.selectedPlaceIds,
        selectedPlaceNames: synced.selectedPlaceNames,
        plannedStops: synced.plannedStops,
        recommendedPlaces: synced.recommendedPlaces,
        recentRecommendationNames: recentNames,
        savedPlaceNames: savedList.map((p) => p.name),
        planningHints: {
          vibe: synced.discovery?.vibe,
          companionship: synced.discovery?.companionship,
          setting: synced.discovery?.setting,
          mustVisit: synced.discovery?.mustVisit,
          transportation: synced.transportation,
          budget: synced.budget,
          pace: synced.pace,
          travelDate: synced.travelDate,
          startTime: synced.startTime,
          endTime: synced.endTime,
          conversationSummary: [tripIntentBlock, buildConversationSummary(synced, conversation)]
            .filter(Boolean)
            .join("\n\n"),
          fromMoodCard: synced.fromMoodCard,
          fromMoodFlow: synced.fromMoodFlow,
          selectedMood: synced.selectedMood ?? synced.mood,
          selectedCategory: synced.selectedCategory,
          lateNightMode: synced.lateNightMode,
          initialChatContext: initialCtx,
          avoidTypes: synced.avoidTypes,
          preferredArea: synced.preferredArea,
          rejectedPlaceNames: synced.rejectedPlaceNames,
          lastUserIntent: userText || synced.lastUserIntent,
        },
      });

      const enriched = await enrichRoamieContext(base, {
        session: synced,
        userText,
        conversation,
        tripIntent,
        planTier,
        weather: bundle.weather,
      });
      devVerboseInfo("[Roamie AI] dialogue stage", {
        stage: enriched.conversationStage,
        chatPhase: enriched.chatPhase,
      });
      return enriched;
    },
    [fetchWeather, session, locale, t],
  );

  const runRecommendationHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      setStreaming(true);
      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;
        const bundle = await buildClientContextBundle(fetchWeather);
        const prefs = await getAiPreferences();

        const focused =
          handoffSession.selectedPlaceFromMood ??
          (handoffSession.selectedPlaces.length === 1
            ? handoffSession.selectedPlaces[0]
            : undefined);

        const syncedHandoff = syncSessionPlaceMemory(handoffSession);
        const initialCtx = [
          syncedHandoff.initialChatContext ?? buildInitialChatContext(syncedHandoff),
          buildPlanningMemoryContext(syncedHandoff),
        ]
          .filter(Boolean)
          .join("\n\n");
        const recentNames = [
          ...new Set([
            ...loadRecentRecommendationNames(),
            ...extractPlaceNames(syncedHandoff.selectedPlaces),
          ]),
        ];

        const req = toRoamieRequest("chat", bundle, {
          mood: syncedHandoff.selectedMood ?? syncedHandoff.mood,
          locale,
          preferences: prefs,
          chatPhase: "handoff",
          time: bundle.time,
          fromMoodCard: true,
          fromMoodFlow: true,
          selectedMood: syncedHandoff.selectedMood ?? syncedHandoff.mood,
          selectedCategory: syncedHandoff.selectedCategory ?? syncedHandoff.mood,
          initialChatContext: initialCtx,
          lateNightMode: syncedHandoff.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
          focusedPlace: focused,
          selectedPlaces: syncedHandoff.selectedPlaces,
          selectedPlaceIds: syncedHandoff.selectedPlaceIds,
          selectedPlaceNames: syncedHandoff.selectedPlaceNames,
          plannedStops: syncedHandoff.plannedStops,
          recommendedPlaces: syncedHandoff.recommendedPlaces,
          recentRecommendationNames: recentNames,
          savedPlaceNames: (await listPlaces()).map((p) => p.name),
          planningHints: {
            conversationSummary: [initialCtx, syncedHandoff.conversationSummary]
              .filter(Boolean)
              .join("\n\n"),
            fromMoodCard: true,
            fromMoodFlow: true,
            selectedMood: syncedHandoff.selectedMood ?? syncedHandoff.mood,
            selectedCategory: syncedHandoff.selectedCategory,
            lateNightMode: syncedHandoff.lateNightMode,
            initialChatContext: initialCtx,
          },
        });

        let summary = buildContextualMoodHandoffOpening(syncedHandoff);
        let roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summary);

        try {
          const full = await fetchRoamieAI(req, { token });
          if (full.summary?.trim()) {
            summary = full.summary;
            const aiRecs =
              full.recommendations?.length > 0
                ? full.recommendations.map(roamieRecToChatItem)
                : undefined;
            roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summary, aiRecs);
          }
        } catch (e) {
          console.warn("[Roamie] handoff AI failed, using fallback", e);
        }

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            syncedHandoff,
            "",
            summary,
            (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
          );
        const opener: ChatMsg = {
          role: "assistant",
          content: displaySummary,
          roamie: {
            ...roamiePayload,
            summary: displaySummary,
            recommendations: filteredRecs,
          },
        };
        setMsgs([opener]);

        const nextSession = syncSessionPlaceMemory(
          markMoodHandoffComplete({
            ...syncedHandoff,
            phase: syncedHandoff.selectedPlaces.length ? "followup" : "collect",
            recommendedPlaces: filteredRecs.length
              ? (filteredRecs as ChatPlaceItem[])
              : syncedHandoff.recommendedPlaces,
            initialChatContext: initialCtx,
          }),
        );
        persistSession(nextSession);
      } finally {
        setStreaming(false);
      }
    },
    [fetchWeather, persistSession],
  );

  const runPlanFormHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      setStreaming(true);
      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;
        const dest = handoffSession.tripDestination;
        if (!dest) {
          toast.error("缺少目的地資訊，請回到規劃頁重新選擇");
          return;
        }

        const bundle = await buildContextBundleForTrip(dest, fetchWeather);
        const prefs = await getAiPreferences();
        const syncedHandoff = syncSessionPlaceMemory({
          ...handoffSession,
          location: bundle.location,
          weather: bundle.weather,
        });
        const initialCtx = [
          syncedHandoff.initialChatContext ?? "",
          buildPlanningMemoryContext(syncedHandoff),
        ]
          .filter(Boolean)
          .join("\n\n");

        const req = toRoamieRequest("chat", bundle, {
          mood: syncedHandoff.mood,
          locale,
          preferences: prefs,
          chatPhase: "expand",
          time: bundle.time,
          fromPlanForm: true,
          fromPlanAi: syncedHandoff.fromPlanAi,
          planAiMode: syncedHandoff.planAiMode,
          initialChatContext: initialCtx,
          selectedPlaces: syncedHandoff.selectedPlaces,
          selectedPlaceIds: syncedHandoff.selectedPlaceIds,
          selectedPlaceNames: syncedHandoff.selectedPlaceNames,
          plannedStops: syncedHandoff.plannedStops,
          recommendedPlaces: syncedHandoff.recommendedPlaces,
          recentRecommendationNames: loadRecentRecommendationNames(),
          savedPlaceNames: (await listPlaces()).map((p) => p.name),
          planningHints: {
            conversationSummary: initialCtx,
            travelDate: syncedHandoff.travelDate,
            transportation: syncedHandoff.transportation,
            budget: syncedHandoff.budget,
            startTime: syncedHandoff.startTime,
            initialChatContext: initialCtx,
          },
        });

        const formInput = {
          destination: dest,
          origin: syncedHandoff.tripOrigin,
          days: syncedHandoff.tripDays ?? 2,
          mood: syncedHandoff.mood ?? "",
          styles: syncedHandoff.tripStyles?.split(/[、,]/).filter(Boolean) ?? [],
          startDate: syncedHandoff.tripStartDate ?? "",
          endDate: syncedHandoff.tripEndDate ?? "",
          departureTime: syncedHandoff.startTime ?? "",
          travelers: syncedHandoff.tripCompanionCount ?? 1,
          transport: syncedHandoff.transportation ?? "",
          budgetMode: syncedHandoff.budget ?? "",
        };
        const summary = syncedHandoff.planAiMode
          ? buildPlanAiHandoffOpening(formInput, bundle, locale)
          : buildPlanTripHandoffOpening(formInput, bundle, locale);
        let summaryText = summary;

        let roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summaryText);

        try {
          const full = await fetchRoamieAI(req, { token });
          if (full.summary?.trim()) {
            summaryText = full.summary;
            const aiRecs =
              full.recommendations?.length > 0
                ? full.recommendations.map(roamieRecToChatItem)
                : undefined;
            roamiePayload = buildHandoffRoamiePayload(syncedHandoff, summaryText, aiRecs);
          }
        } catch (e) {
          console.warn("[Roamie] plan handoff AI failed, using fallback", e);
        }

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            syncedHandoff,
            "",
            summaryText,
            (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
          );
        const opener: ChatMsg = {
          role: "assistant",
          content: displaySummary,
          roamie: {
            ...roamiePayload,
            summary: displaySummary,
            recommendations: filteredRecs,
          },
        };
        setMsgs([opener]);

        const recs = filteredRecs as ChatPlaceItem[];
        const nextSession = syncSessionPlaceMemory(
          markPlanHandoffComplete({
            ...syncedHandoff,
            recommendedPlaces: recs.length ? recs : syncedHandoff.recommendedPlaces,
            initialChatContext: initialCtx,
          }),
        );
        persistSession(nextSession);
        devVerboseInfo("[Roamie] plan handoff ok", formatTripLocationLabel(dest));
      } finally {
        setStreaming(false);
      }
    },
    [fetchWeather, persistSession, locale],
  );

  const runTripAddPlaceHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      const ctx = handoffSession.tripAddPlaceContext;
      if (!ctx) return;
      setStreaming(true);
      try {
        let { summary, recommendations, recommendationSession } =
          await fetchTripAddPlaceRecommendations({
            ctx,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
        if (!recommendations.length) {
          recommendations = await enrichTripAddPlaceRecommendationsFromSummary({
            summary,
            ctx,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
        }
        const sessionWithRecs = tripAddPlaceRecommendationsToSession(
          handoffSession,
          recommendations,
          recommendationSession,
        );
        let { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRecs, "", summary, recommendations);
        if (!filteredRecs.length && recommendations.length) {
          filteredRecs = recommendations.slice(0, 5);
        }
        if (!filteredRecs.length) {
          filteredRecs = await enrichTripAddPlaceRecommendationsFromSummary({
            summary: displaySummary,
            ctx,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
        }
        recommendationSession = await ensureHandoffRecommendationSession({
          ctx,
          recommendations: filteredRecs,
          recommendationSession,
          searchPlaces: searchNearbyPlaces,
          locale,
        });

        const assistantMessage = buildTripAddPlaceChatMessage({
          summary: displaySummary,
          recommendations: filteredRecs,
          moodTag: handoffSession.mood ?? ctx.travelStyle ?? "",
          session: sessionWithRecs,
        });

        if (!assistantMessage.structuredPlaces?.length && filteredRecs.length) {
          logTripAddPlaceRenderEmpty({
            reason: "handoff_structured_empty",
            messagesCount: 0,
            candidatesCount: filteredRecs.length,
            structuredPlacesCount: 0,
            loading: false,
          });
        }

        if (!assistantMessage.content.trim() && !assistantMessage.structuredPlaces?.length) {
          const fallback = buildTripAddPlaceRenderFallbackMessage(sessionWithRecs, {
            candidatesCount: recommendationSession?.allCandidates.length ?? filteredRecs.length,
          });
          setMsgs([fallback]);
          persistSession(
            markTripAddPlaceHandoffComplete({
              ...sessionWithRecs,
              lastAssistantReply: fallback.content,
            }),
          );
          setSession(reinforceTripAddPlaceSession(loadChatSession()));
          return;
        }

        setMsgs([assistantMessage]);
        const nextSession = markTripAddPlaceHandoffComplete({
          ...sessionWithRecs,
          recommendedPlaces: (assistantMessage.roamie?.recommendations ?? filteredRecs) as ChatPlaceItem[],
          tripAddPlaceRecommendationSession:
            recommendationSession ?? sessionWithRecs.tripAddPlaceRecommendationSession,
          lastAssistantReply: assistantMessage.content,
        });
        persistSession(nextSession);
        setSession(reinforceTripAddPlaceSession(nextSession));
        devVerboseInfo(
          "[Roamie] trip add place handoff ok",
          ctx.tripId,
          `day=${ctx.selectedDay}`,
          `cards=${assistantMessage.structuredPlaces?.length ?? filteredRecs.length}`,
          `pool=${recommendationSession?.allCandidates.length ?? 0}`,
        );
      } catch (error) {
        console.error("[TRIP_ADD_PLACE_HANDOFF_FAILED]", error);
        const fallback = buildTripAddPlaceRenderFallbackMessage(handoffSession, {
          error: error instanceof Error ? error.message : String(error),
        });
        setMsgs([fallback]);
        persistSession(
          markTripAddPlaceHandoffComplete({
            ...handoffSession,
            lastAssistantReply: fallback.content,
          }),
        );
        setSession(reinforceTripAddPlaceSession(loadChatSession()));
        throw error;
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces],
  );

  const commitTripAddPlaceLocalTurn = useCallback(
    async (
      tripSession: ChatPlanningSession,
      userText: string,
      baseConversation: ChatMsg[],
    ): Promise<void> => {
      const turn = await processTripAddPlaceUserMessage({
        session: tripSession,
        userText,
        msgs: baseConversation,
        searchPlaces: searchNearbyPlaces,
        locale,
      });
      const { summary: displaySummary, recommendations: filteredRecs } =
        finalizeChatRecommendationDisplay(
          turn.nextSession,
          userText,
          turn.summary,
          turn.recommendations,
        );
      const finalRecs = filteredRecs.length ? filteredRecs : turn.recommendations;
      const nextSession = {
        ...turn.nextSession,
        fromTripAddPlace: true,
        conversationMode: "trip_add_place" as const,
        recommendedPlaces: finalRecs as ChatPlaceItem[],
        lastAssistantReply: displaySummary,
      };
      persistSession(nextSession);
      setSession(reinforceTripAddPlaceSession(nextSession));
      const assistantMessage = buildTripAddPlaceChatMessage({
        summary: displaySummary,
        recommendations: finalRecs,
        moodTag: turn.nextSession.mood ?? tripSession.tripAddPlaceContext?.travelStyle,
        session: nextSession,
      });
      if (!assistantMessage.structuredPlaces?.length && finalRecs.length) {
        logTripAddPlaceRenderEmpty({
          reason: "local_turn_structured_empty",
          messagesCount: baseConversation.length + 1,
          candidatesCount: finalRecs.length,
          structuredPlacesCount: 0,
          loading: false,
        });
      }
      setMsgs([...baseConversation, assistantMessage]);
      setPartial({});
    },
    [locale, persistSession, searchNearbyPlaces],
  );

  const pushTripAddPlaceMoreRecommendations = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
    ): Promise<boolean> => {
      const tripSession = resolveTripAddPlaceChatSession(activeSession, loadChatSession());
      if (!tripSession) return false;
      if (
        !shouldHandleTripAddPlaceMoreTurn(userText, tripSession) &&
        !isTripAddPlaceMoreRecommendationsRequest(userText)
      ) {
        return false;
      }
      try {
        await commitTripAddPlaceLocalTurn(tripSession, userText, conversation);
        return true;
      } catch (e) {
        logTripAddPlaceFailure(e, tripSession, userText, "push_more");
        try {
          await commitTripAddPlaceLocalTurn(
            tripSession,
            isTripAddPlaceMoreRecommendationsRequest(userText) ? userText : "還有嗎",
            conversation,
          );
        } catch (retryError) {
          logTripAddPlaceFailure(retryError, tripSession, userText, "push_more_retry");
        }
        return true;
      }
    },
    [commitTripAddPlaceLocalTurn],
  );

  const pushNearbyPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      intent: import("@/lib/ai/chat-intent").NearbyPlaceIntent,
      opts?: {
        excludePlaceIds?: string[];
        rejectedPlaceNames?: string[];
        blockedCoreNames?: string[];
        userText?: string;
        cityLabel?: string;
      },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      let workingSession = merged.session;
      const placeDetailActive = isPlaceDetailChatActive(workingSession);
      if (placeDetailActive) {
        workingSession = await ensurePlaceDetailFocusCoordinates(
          workingSession,
          geocodeLocationFn,
          locale,
          fetchPlaceDetailsForFocus,
        );
        workingSession = sessionWithPlaceDetailSearchCenter(workingSession);
      }

      let searchCtx: Awaited<ReturnType<typeof resolveChatPlaceSearchContext>>;
      let lat: number | undefined;
      let lng: number | undefined;
      let nearbyCenterLabel: string | undefined;

      if (placeDetailActive) {
        const nearbyCenter = resolveNearbySearchCenter(workingSession, userText);
        if (!nearbyCenter) {
          console.warn("[CHAT_PLACES_REQUEST] skipped reason=place_detail_missing_coords");
          return false;
        }
        lat = nearbyCenter.lat;
        lng = nearbyCenter.lng;
        nearbyCenterLabel = nearbyCenter.basePlaceName;
        searchCtx = {
          searchMode: "nearby",
          deviceLatLng: { lat, lng },
        };
      } else {
        const deviceSession = await resolveChatLocation(workingSession);
        searchCtx = await resolveChatPlaceSearchContext({
          context: merged.context,
          session: deviceSession,
          userText,
          locale,
          geocodeFn: geocodeLocationFn,
          deviceLatLng:
            deviceSession.location?.lat != null && deviceSession.location?.lng != null
              ? { lat: deviceSession.location.lat, lng: deviceSession.location.lng }
              : null,
        });

        const nearbyCenter = resolveNearbySearchCenter(deviceSession, userText);
        if (nearbyCenter) {
          lat = nearbyCenter.lat;
          lng = nearbyCenter.lng;
          nearbyCenterLabel = nearbyCenter.basePlaceName;
          searchCtx.searchMode = "nearby";
          delete searchCtx.destinationLatLng;
          delete searchCtx.destinationName;
          delete searchCtx.textOnlyDestinationSearch;
        } else if (searchCtx.searchMode === "destination") {
          if (searchCtx.destinationLatLng) {
            lat = searchCtx.destinationLatLng.lat;
            lng = searchCtx.destinationLatLng.lng;
          } else if (searchCtx.textOnlyDestinationSearch) {
            lat = 0;
            lng = 0;
          }
        } else {
          lat = deviceSession.location?.lat;
          lng = deviceSession.location?.lng;
        }
      }

      if (lat == null || lng == null) {
        console.warn("[CHAT_PLACES_REQUEST] skipped reason=no_location");
        return false;
      }

      let sessionForSave = merged.session;
      const excludePlaceIds =
        opts?.excludePlaceIds ?? collectExcludePlaceIds(sessionForSave);
      const blockedCoreNames =
        opts?.blockedCoreNames ?? collectBlockedCoreNames(sessionForSave);

      try {
        const { summary, payload } = await buildNearbyPlaceRecommendation({
          intent,
          lat,
          lng,
          locale,
          context: merged.context,
          searchPlaces: searchNearbyPlaces,
          foodPreference: sessionForSave.foodPreference,
          excludedCategories:
            sessionForSave.excludedCategories ?? merged.context.excludedCategories,
          excludePlaceIds,
          rejectedPlaceNames:
            opts?.rejectedPlaceNames ?? sessionForSave.rejectedPlaceNames,
          priorRecommended: [
            ...sessionForSave.recommendedPlaces,
            ...extractRecommendedFromMsgs(conversation),
          ],
          blockedCoreNames,
          userText: userText,
          cityLabel: placeDetailActive
            ? workingSession.placeDetailFocus?.city ||
              workingSession.placeDetailFocus?.country ||
              undefined
            : nearbyCenterLabel ??
              opts?.cityLabel ??
              (searchCtx.searchMode === "destination"
                ? searchCtx.destinationName
                : sessionForSave.location?.city ?? merged.context.destination),
          searchContext: searchCtx,
          hasPlusAccess,
          placeDetailNearby: placeDetailActive,
          focusPlaceId:
            workingSession.placeDetailFocus?.placeId ??
            workingSession.placeDetailFocus?.googlePlaceId,
        });
        const sessionWithIntent: ChatPlanningSession = {
          ...sessionForSave,
          activeChatIntent: intent,
          phase: "recommend",
          travelContext: {
            ...merged.context,
            excludedCategories:
              sessionForSave.excludedCategories ?? merged.context.excludedCategories,
          },
        };
        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            sessionWithIntent,
            userText,
            summary,
            payload.recommendations ?? [],
          );
        const syncedSummary =
          filteredRecs.length > 0
            ? buildSummaryForRecommendations(
                intent,
                filteredRecs,
                merged.context,
                sessionForSave.excludedCategories ?? merged.context.excludedCategories,
              )
            : displaySummary;
        devVerboseInfo("[CHAT_PLACE_CARDS_RENDER_COUNT]", { count: filteredRecs.length });
        devVerboseInfo("[CHAT_PLACE_CARD_LIMIT]", { limit: intent === "cafe" ? 6 : 5 });
        if (!filteredRecs.length) {
          if ((payload.recommendations ?? []).length === 0 && summary.trim()) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
              return [...base, { role: "assistant", content: summary }];
            });
            persistSession(sessionWithIntent);
            setPartial({});
            return true;
          }
          console.warn("[CHAT_PLACE_CARD_RENDER] count=0 after_filter");
          return false;
        }

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: syncedSummary,
              roamie: {
                ...payload,
                summary: syncedSummary,
                recommendations: filteredRecs,
              },
            },
          ];
        });

        const recs = filteredRecs as ChatPlaceItem[];
        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithIntent,
            recommendedPlaces: recs,
          }),
        );
        devVerboseInfo(
          "[CHAT_REFRESH_RECOMMEND]",
          `count=${recs.length}`,
          `excluded=${excludePlaceIds.length}`,
        );
        setPartial({});
        return true;
      } catch (e) {
        console.warn(
          "[CHAT_PLACES_REQUEST] failed",
          e instanceof Error ? e.message : String(e),
        );
        return false;
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, fetchPlaceDetailsForFocus, hasPlusAccess],
  );

  const pushDestinationPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: {
        excludePlaceIds?: string[];
        rejectedPlaceNames?: string[];
        forceRegenerate?: boolean;
        replacePreviousCards?: boolean;
      },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const styleReselect = isStyleReselectTurn(userText, activeSession, placeCtx);
      const stylePlanTurn = shouldTriggerTripStylePlanning(userText, activeSession, placeCtx);
      const forceRegenerate =
        opts?.forceRegenerate === true || Boolean(styleReselect) || stylePlanTurn;
      const replacePreviousCards = opts?.replacePreviousCards ?? forceRegenerate;

      const canFetch =
        forceRegenerate ||
        stylePlanTurn ||
        shouldFetchDestinationPlaces(userText, placeCtx);
      const destination = canFetch
        ? resolveMustVisitDestination(placeCtx, userText) ??
          resolveConversationDestination(placeCtx, activeSession) ??
          placeCtx.destination?.trim() ??
          activeSession.tripPlanningContext?.destination?.trim()
        : undefined;
      if (!destination) return false;

      let sessionForPlan: ChatPlanningSession;
      if (styleReselect) {
        sessionForPlan = activeSession.planningSessionId
          ? activeSession
          : applyStyleReselectToSession(
              {
                ...merged.session,
                activeChatIntent: "destination_advice",
                conversationMode: "destination_planning",
                travelContext: {
                  ...placeCtx,
                  destination,
                  planningTripStyle: styleReselect,
                  planningDaysConfirmed: true,
                  mustVisitGenerated: false,
                },
              },
              { ...placeCtx, destination, planningTripStyle: styleReselect },
              styleReselect,
            );
      } else {
        sessionForPlan = getOrCreatePlanningSessionId(
          {
            ...merged.session,
            activeChatIntent: "destination_advice",
            conversationMode: "destination_planning",
            travelContext: {
              ...placeCtx,
              destination,
            },
          },
          "generate_places",
        ).session;
      }

      const flowSessionId =
        sessionForPlan.planningSessionId ??
        getOrCreatePlanningSessionId(sessionForPlan, "ensure").sessionId;

      if (isPlanningRenderInProgress(flowSessionId)) {
        devVerboseInfo("[AI_PLANNING_SKIP]", "reason=duplicate_in_flight");
        return false;
      }
      if (isPlanningRenderInProgress() && !isPlanningRenderInProgress(flowSessionId)) {
        devVerboseInfo("[AI_PLANNING_SKIP]", "reason=render_in_progress_other_session");
        return false;
      }
      setPlanningRenderInProgress(true, flowSessionId);

      if (styleReselect) {
        const days = placeCtx.days ?? activeSession.tripDays ?? 1;
        logAiStyleReselectGenerateStart(
          destination,
          styleReselect,
          days,
          sessionForPlan.planVersion ?? 1,
        );
        logChatRegeneratePlaceCardsStart(destination, styleReselect, days);
      } else if (forceRegenerate) {
        const days = placeCtx.days ?? activeSession.tripDays;
        if (days && placeCtx.planningTripStyle) {
          logChatRegeneratePlaceCardsStart(destination, placeCtx.planningTripStyle as TripStyleKey, days);
        }
      }

      persistSession({ ...sessionForPlan, planningSessionId: flowSessionId });

      const excludePlaceIds = styleReselect
        ? collectHardDuplicatePlaceIds(activeSession, conversation)
        : stylePlanTurn
          ? []
          : opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession);
      const rejectedPlaceNames =
        opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      const renderDestinationReply = (
        summary: string,
        recommendations: RoamieRecommendationItem[],
        payload: RoamiePayloadV2,
        contextPatch: Partial<CanonicalTravelContext>,
        dayPlan?: AiDayPlan,
      ) => {
        const alignedDayPlan = (() => {
          const incoming = dayPlan
            ? alignDayPlanToSession(dayPlan, flowSessionId)
            : undefined;
          if (incoming?.items.length) return incoming;
          const frozen = getFrozenPlanningDayPlan(flowSessionId);
          return frozen ? alignDayPlanToSession(frozen, flowSessionId) : undefined;
        })();

        logAiPushPlaceCardsSession(
          alignedDayPlan?.planningSessionId ?? flowSessionId,
          flowSessionId,
        );

        if (
          alignedDayPlan &&
          alignedDayPlan.planningSessionId !== flowSessionId &&
          isStalePlanningSession(sessionForPlan, alignedDayPlan.planningSessionId, flowSessionId)
        ) {
          logAiPlaceCardsSkipStale(alignedDayPlan.planningSessionId, flowSessionId);
          logAiStaleRecommendationsBlocked();
          return false;
        }

        const sessionWithRecs: ChatPlanningSession = {
          ...sessionForPlan,
          phase: "recommend",
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination,
          },
        };

        const orderedRecs = alignedDayPlan
          ? dayPlanToChatPlaces(alignedDayPlan)
          : ((recommendations ?? []) as ChatPlaceItem[]);

        const { summary: displaySummary, recommendations: filteredRecs } =
          alignedDayPlan
            ? { summary, recommendations: orderedRecs }
            : finalizeChatRecommendationDisplay(
                sessionWithRecs,
                userText,
                summary,
                recommendations,
              );

        let recs = alignedDayPlan
          ? orderedRecs
          : ((filteredRecs.length ? filteredRecs : recommendations) as ChatPlaceItem[]);

        recs = dedupePlaceCardsForRender(recs) as ChatPlaceItem[];
        const itineraryRender = Boolean(alignedDayPlan || stylePlanTurn);
        if (!recs.length && !itineraryRender) {
          const namedFallback = buildNamedFallbackRecommendations(destination);
          if (namedFallback.length) {
            recs = namedFallback as ChatPlaceItem[];
          }
        }
        if (!recs.length && !displaySummary.trim()) {
          logAiRenderBlocked(
            "empty_recommendations",
            recs.length,
            alignedDayPlan?.items.length ?? 0,
            flowSessionId,
            flowSessionId,
          );
          if (styleReselect) {
            logAiStyleReselectGenerateFail(
              "empty_recommendations",
              sessionForPlan.planVersion ?? 1,
            );
          }
          persistSession(
            withChatPlanningState(sessionForPlan, "idle", "render_empty_recommendations"),
          );
          return false;
        }

        if (
          itineraryRender &&
          !alignedDayPlan?.items.length &&
          /行程還在整理中/.test(displaySummary) &&
          recs.length === 0
        ) {
          logAiRenderBlocked(
            "itinerary_plan_incomplete",
            recs.length,
            0,
            flowSessionId,
            flowSessionId,
          );
          persistSession(
            withChatPlanningState(sessionForPlan, "idle", "itinerary_plan_incomplete"),
          );
          // 仍顯示錯誤訊息在聊天頁，避免無回應或 crash 後跳回首頁
        }

        if (alignedDayPlan) {
          logChatRenderItinerary(alignedDayPlan.days, alignedDayPlan.items.length);
        } else if (stylePlanTurn) {
          logChatRenderItinerary(0, recs.length);
        } else {
          logChatRenderPlaceList(recs.length, "destination_reply");
        }

        if (alignedDayPlan || stylePlanTurn) {
          logAiRenderItineraryStart();
        }

        const storedDayPlan = alignedDayPlan
          ? { ...alignedDayPlan, planningSessionId: flowSessionId }
          : undefined;

        const baseConversation = replacePreviousCards
          ? stripPreviousPlaceCardMessages(conversation)
          : conversation;

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base =
            trimmedPrev.length === baseConversation.length ? baseConversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
                recommendations: recs,
                dayPlan: storedDayPlan,
                moodTag:
                  resolveRecommendationStyleTag(sessionWithRecs, sessionWithRecs.travelContext) ||
                  payload.moodTag,
              },
            },
          ];
        });

        persistSession(
          syncSessionPlaceMemory(
            mergeTripSessionUsedPlacesFromMessages(
              withChatPlanningState(
                {
                  ...sessionWithRecs,
                  currentDayPlan: storedDayPlan,
                  recommendedPlaces: recs,
                  selectedPlaces: [],
                  pendingQuestion: undefined,
                },
                "planGenerated",
                "render_itinerary_success",
              ),
              baseConversation,
            ),
          ),
        );
        setPartial({});
        requestAnimationFrame(() => {
          const lastIndex = baseConversation.length;
          scrollToPlaceCardsStart(lastIndex);
        });
        logAiRenderItinerarySuccess(recs.length);
        if (styleReselect) {
          logAiStyleReselectGenerateSuccess(
            recs.length || alignedDayPlan?.items.length || 0,
            sessionForPlan.planVersion ?? 1,
          );
        }
        if (forceRegenerate) {
          logChatRegeneratePlaceCardsDone(recs.length);
        }
        return true;
      };

      setStreaming(true);
      try {
        const regenCtx = forceRegenerate
          ? enrichContextForItineraryMode(
              userText,
              {
                ...placeCtx,
                destination,
                mustVisitGenerated: false,
                ...(styleReselect || stylePlanTurn
                  ? {
                      planningTripStyle:
                        styleReselect ??
                        parseAskTripStyleSelection(userText) ??
                        placeCtx.planningTripStyle,
                      planningDaysConfirmed: true,
                    }
                  : {}),
              },
              sessionForPlan,
            )
          : enrichContextForItineraryMode(
              userText,
              { ...placeCtx, destination },
              sessionForPlan,
            );

        const { summary, recommendations, payload, contextPatch, dayPlan } =
          await buildDestinationMustVisitRecommendation({
            destination,
            userText,
            context: regenCtx,
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            fetchPlaceDetailsFn: fetchPlaceDetailsForFocus,
            excludePlaceIds,
            rejectedPlaceNames,
            planningSessionId: flowSessionId,
            session: sessionForPlan,
          });

        return renderDestinationReply(summary, recommendations, payload, contextPatch, dayPlan);
      } catch (error) {
        console.warn(
          "[CHAT_PLACES_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        if (styleReselect) {
          logAiStyleReselectGenerateFail(
            error instanceof Error ? error.message : String(error),
            sessionForPlan.planVersion ?? 1,
          );
        }
        const label = destination;
        const itineraryRequested = shouldUseItineraryMode(userText, placeCtx, sessionForPlan);
        if (itineraryRequested) {
          logChatRenderPlaceList(0, "itinerary_planner_error");
          const intro = buildWeatherAwarePlaceIntro(label, resolveWeatherScene(null, label), false);
          const summary = [
            intro,
            "",
            `${label} 的行程還在整理中，稍後再試一次。`,
          ].join("\n");
          return renderDestinationReply(summary, [], {
            version: 2,
            title: "必去推薦",
            summary,
            moodTag:
              resolveRecommendationStyleTag(sessionForPlan, placeCtx) || placeCtx.mood || "",
            recommendations: [],
            itinerary: [],
            generatedAt: new Date().toISOString(),
          }, {
            destination: label,
            mustVisitGenerated: false,
            tripPurpose: "must_visit_places",
            planningStage: undefined,
          });
        }
        const namedRecs = buildNamedFallbackRecommendations(label);
        const intro = buildWeatherAwarePlaceIntro(label, resolveWeatherScene(null, label), false);
        const summary = namedRecs.length
          ? [
              intro,
              "",
              ...namedRecs.map(
                (rec, index) => `${index + 1}. ${rec.name}${rec.reason ? ` — ${rec.reason}` : ""}`,
              ),
              "",
              "想加進行程的話，跟我說你最想先排哪幾個。",
            ].join("\n")
          : [
              intro,
              "",
              `我暫時沒連上${label}的即時地點資料，你可以稍後再試或換個說法。`,
            ].join("\n");
        const payload: RoamiePayloadV2 = {
          version: 2,
          title: "必去推薦",
          summary,
          moodTag:
            resolveRecommendationStyleTag(sessionForPlan, placeCtx) || placeCtx.mood || "",
          recommendations: namedRecs,
          itinerary: [],
          generatedAt: new Date().toISOString(),
        };
        if (!namedRecs.length) {
          console.warn("[CHAT_RENDER_BLOCKED]", "reason=no_real_places");
        }
        return renderDestinationReply(summary, namedRecs, payload, {
          destination: label,
          mustVisitGenerated: true,
          tripPurpose: "must_visit_places",
          planningStage: "recommendations_generated",
        });
      } finally {
        setPlanningRenderInProgress(false, flowSessionId);
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, fetchWeather, scrollToPlaceCardsStart],
  );
  pushDestinationPlaceRecommendationRef.current = pushDestinationPlaceRecommendation;

  const pushMorePlaceRecommendations = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const destination =
        placeCtx.destination?.trim() ||
        activeSession.tripPlanningContext?.destination?.trim() ||
        activeSession.tripDestination?.city?.trim();
      if (!destination) return false;

      if (isMorePlaceRecommendationsIntent(userText)) {
        logAiFollowupMoreDetected(userText);
        logChatMorePlacesIntent(userText);
      }

      const sessionWithUsed = mergeTripSessionUsedPlacesFromMessages(activeSession, conversation);
      const usedPlaces = collectUsedPlaces(sessionWithUsed, conversation);

      const excludePlaceIds =
        opts?.excludePlaceIds ?? usedPlaces.usedPlaceIds;
      const rejectedPlaceNames =
        opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      logChatMorePlacesExcludeIds(excludePlaceIds.length);

      const renderMorePlacesReply = (
        summary: string,
        recommendations: RoamieRecommendationItem[],
        payload: RoamiePayloadV2,
        contextPatch: Partial<CanonicalTravelContext>,
      ) => {
        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          ...sessionWithUsed,
          activeChatIntent: activeSession.activeChatIntent ?? "destination_advice",
          conversationMode: "destination_planning",
          phase: "recommend",
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination,
            tripPurpose: "more_place_recommendations",
          },
        };

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            sessionWithRecs,
            userText,
            summary,
            recommendations,
          );

        const recs = (filteredRecs.length ? filteredRecs : recommendations) as ChatPlaceItem[];
        if (!recs.length) {
          logChatMorePlacesNoResultAllowed(true);
          return false;
        }

        logChatMorePlacesNoResultAllowed(false);

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
          const styleTag =
            resolveRecommendationStyleTag(sessionWithRecs, sessionWithRecs.travelContext) ||
            payload.moodTag;
          return [
            ...base,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
                recommendations: recs,
                moodTag: styleTag,
              },
            },
          ];
        });

        const priorRecs = activeSession.recommendedPlaces ?? [];
        const mergedRecs = [...priorRecs];
        const seenIds = new Set(collectExcludePlaceIds(activeSession, conversation));
        for (const rec of recs) {
          const id = rec.googlePlaceId ?? rec.placeId;
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);
          mergedRecs.push(rec);
        }

        const sessionAfterRecs: ChatPlanningSession = {
          ...sessionWithRecs,
          recommendedPlaces: mergedRecs,
        };
        const updatedUsed = collectUsedPlaces(sessionAfterRecs, conversation);

        persistSession(
          syncSessionPlaceMemory({
            ...sessionAfterRecs,
            usedPlaceIds: updatedUsed.usedPlaceIds,
            usedPlaceNames: updatedUsed.usedPlaceNames,
            usedAreaKeys: updatedUsed.usedAreaKeys,
            recommendedPlaceIds: updatedUsed.usedPlaceIds,
            recommendedNormalizedNames: updatedUsed.usedPlaceNames,
            pendingQuestion: undefined,
          }),
        );
        logAiFollowupSessionUsedUpdated(updatedUsed);
        setPartial({});
        return true;
      };

      setStreaming(true);
      try {
        const { summary, recommendations, payload, contextPatch } =
          await buildMoreDestinationRecommendations({
            destination,
            userText,
            context: { ...placeCtx, destination, tripPurpose: "more_place_recommendations" },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            excludePlaceIds,
            rejectedPlaceNames,
            activeChatIntent: activeSession.activeChatIntent,
            session: sessionWithUsed,
            usedPlaces,
          });

        return renderMorePlacesReply(summary, recommendations, payload, contextPatch);
      } catch (error) {
        console.warn(
          "[CHAT_PLACES_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        logChatMorePlacesNoResultAllowed(true);
        return false;
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, fetchWeather],
  );

  const pushDestinationCategoryPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const destination = resolveDestinationForCategorySearch(placeCtx, merged.session, userText);
      const intents = parseChatPlaceIntents(userText);
      if (!destination || !intents.length) return false;

      const excludePlaceIds =
        opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession);
      const rejectedPlaceNames =
        opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      setStreaming(true);
      try {
        const { summary, recommendations, payload, contextPatch } =
          await buildDestinationCategoryRecommendations({
            destination,
            intents,
            userText,
            context: { ...placeCtx, destination },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            excludePlaceIds,
            rejectedPlaceNames,
            session: activeSession,
          });

        if (!recommendations.length) {
          return false;
        }

        const activeIntent = mapCategoryIntentToNearbyIntent(intents[0]!);
        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          activeChatIntent: activeIntent,
          conversationMode: activeSession.conversationMode ?? "destination_planning",
          phase: "recommend",
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination,
          },
        };

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            sessionWithRecs,
            userText,
            summary,
            recommendations,
          );

        const recs = (filteredRecs.length ? filteredRecs : recommendations) as ChatPlaceItem[];
        if (!recs.length) {
          console.warn("[CHAT_PLACE_CARD_RENDER] count=0 after_finalize");
          return false;
        }

        logChatUiReceivedCards(recs.length);

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
                recommendations: recs,
                moodTag:
                  resolveRecommendationStyleTag(sessionWithRecs, sessionWithRecs.travelContext) ||
                  payload.moodTag,
              },
            },
          ];
        });

        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithRecs,
            recommendedPlaces: recs,
            pendingQuestion: undefined,
          }),
        );
        setPartial({});
        return true;
      } catch (error) {
        console.warn(
          "[CHAT_PLACES_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn],
  );

  const pushAlternativeDestinationPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      destination: string,
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const label = destination.trim();
      if (!label) return false;

      const excludePlaceIds =
        opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession);
      const rejectedPlaceNames =
        opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      setStreaming(true);
      try {
        const { summary, recommendations, payload, contextPatch } =
          await buildAlternativeDestinationRecommendations({
            destination: label,
            userText,
            context: {
              ...placeCtx,
              destination: label,
              tripPurpose: "alternative_recommendations",
            },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            excludePlaceIds,
            rejectedPlaceNames,
          });

        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          activeChatIntent: "restaurant",
          conversationMode: activeSession.conversationMode ?? "destination_planning",
          phase: "recommend",
          travelContext: {
            ...placeCtx,
            ...contextPatch,
            destination: label,
          },
        };

        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            sessionWithRecs,
            userText,
            summary,
            recommendations,
          );

        if (!filteredRecs.length && !displaySummary.trim()) {
          return false;
        }

        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const base = trimmedPrev.length === conversation.length ? conversation : trimmedPrev;
          return [
            ...base,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
                recommendations: filteredRecs.length ? filteredRecs : recommendations,
              },
            },
          ];
        });

        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithRecs,
            recommendedPlaces: (filteredRecs.length ? filteredRecs : recommendations) as ChatPlaceItem[],
            pendingQuestion: undefined,
          }),
        );
        setPartial({});
        return true;
      } catch (error) {
        console.warn(
          "[CHAT_ALTERNATIVE_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, fetchWeather],
  );

  const applyLocalFallback = useCallback(
    async (
      activeSession: ChatPlanningSession,
      activeUserText: string,
      conversation: ChatMsg[],
      reason: string,
    ): Promise<boolean> => {
      devVerboseInfo(`[CHAT_FALLBACK_USED] reason=${reason}`);

      if (isPlaceDetailChatActive(activeSession)) {
        return false;
      }

      const tripSession = resolveTripAddPlaceChatSession(activeSession, loadChatSession());
      if (tripSession) {
          try {
            await commitTripAddPlaceLocalTurn(tripSession, activeUserText, conversation);
            return true;
          } catch (e) {
            logTripAddPlaceFailure(e, tripSession, activeUserText, "local_fallback");
            try {
              await commitTripAddPlaceLocalTurn(
                tripSession,
                isTripAddPlaceMoreRecommendationsRequest(activeUserText)
                  ? activeUserText
                  : "還有嗎",
                conversation,
              );
            } catch (retryError) {
              logTripAddPlaceFailure(retryError, tripSession, activeUserText, "local_fallback_retry");
            }
            return true;
          }
      }

      const mergedForAdvice = mergeTravelContext(activeSession, activeUserText);

      if (shouldFetchDestinationPlaces(activeUserText, mergedForAdvice.context, activeSession)) {
        const applied = await pushDestinationPlaceRecommendation(
          activeSession,
          activeUserText,
          conversation,
        );
        if (applied) return true;
      }

      if (
        shouldFetchDestinationCategoryPlaces(
          activeUserText,
          mergedForAdvice.context,
          activeSession,
        )
      ) {
        const applied = await pushDestinationCategoryPlaceRecommendation(
          activeSession,
          activeUserText,
          conversation,
        );
        if (applied) return true;
      }

      const planningTurn = resolvePlanningFallbackTurn(
        activeUserText,
        activeSession,
        activeSession.travelContext ?? { interests: [] },
      );
      if (
        planningTurn.advice.reply &&
        !shouldBlockPlanningFallbackForCategoryQuery(
          activeUserText,
          mergedForAdvice.context,
          activeSession,
        )
      ) {
        const trimmedConversation = conversation.filter(
          (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
        );
        await completeAdviceTurn(
          planningTurn,
          planningTurn.session,
          mergedForAdvice.context,
          trimmedConversation,
        );
        setPartial({});
        return true;
      }

      if (isPlanningTurnActive(mergedForAdvice.session, mergedForAdvice.context)) {
        const offline = buildPlanningOfflineReply(
          mergedForAdvice.context,
          mergedForAdvice.session,
        );
        if (offline) {
          setMsgs((prev) => {
            const trimmedPrev = prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
            );
            return [...trimmedPrev, { role: "assistant", content: offline }];
          });
          persistSession(mergedForAdvice.session);
          setPartial({});
          return true;
        }
      }

      const adviceTurn = processAdviceTurn(
        activeUserText,
        mergedForAdvice.session,
        mergedForAdvice.context,
      );
      if (adviceTurn.advice.reply) {
        const trimmedConversation = conversation.filter(
          (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
        );
        await completeAdviceTurn(
          adviceTurn,
          mergedForAdvice.session,
          mergedForAdvice.context,
          trimmedConversation,
        );
        setPartial({});
        return true;
      }

      const intent = resolveChatIntent(activeUserText, activeSession);
      if (
        isNearbyPlaceIntent(intent) &&
        shouldFetchNearbyPlaces(intent, activeSession, activeUserText)
      ) {
        const applied = await pushNearbyPlaceRecommendation(
          activeSession,
          activeUserText,
          conversation,
          intent,
        );
        if (applied) return true;
      }

      if (
        activeSession.activeChatIntent &&
        isNearbyPlaceIntent(activeSession.activeChatIntent) &&
        (activeSession.foodPreference || isFoodPreferenceReply(activeUserText))
      ) {
        const applied = await pushNearbyPlaceRecommendation(
          activeSession,
          activeUserText,
          conversation,
          activeSession.activeChatIntent,
        );
        if (applied) return true;
      }

      const { context } = mergeTravelContext(activeSession, activeUserText);
      let placeResults: Awaited<ReturnType<typeof searchNearbyPlaces>>["places"] = [];
      const deviceSession = await resolveChatLocation(activeSession);
      const deviceLat = deviceSession.location?.lat;
      const deviceLng = deviceSession.location?.lng;
      const searchCtx = await resolveChatPlaceSearchContext({
        context,
        session: activeSession,
        userText: activeUserText,
        locale,
        geocodeFn: geocodeLocationFn,
        deviceLatLng:
          deviceLat != null && deviceLng != null ? { lat: deviceLat, lng: deviceLng } : null,
      });

      let lat: number | undefined;
      let lng: number | undefined;
      if (searchCtx.searchMode === "destination") {
        if (searchCtx.destinationLatLng) {
          lat = searchCtx.destinationLatLng.lat;
          lng = searchCtx.destinationLatLng.lng;
        } else if (searchCtx.textOnlyDestinationSearch) {
          lat = 0;
          lng = 0;
        }
      } else {
        lat = deviceLat;
        lng = deviceLng;
      }

      const resolvedIntent = resolveChatIntent(activeUserText, activeSession);
      const isRestaurantFlow =
        activeSession.activeChatIntent === "restaurant" ||
        resolvedIntent === "restaurant" ||
        isFoodIntentText(activeUserText);
      const isCampingFlow =
        activeSession.activeChatIntent === "camping" ||
        resolvedIntent === "camping" ||
        context.activity === "camping";
      const searchPayload = placesSearchContextPayload(searchCtx);

      if (lat != null && lng != null) {
        const attempts = isRestaurantFlow
          ? restaurantSearchFallbackQueries(activeSession.foodPreference, activeUserText)
          : isCampingFlow
            ? campingSearchAttempts()
            : [{ query: fallbackSearchQuery(context), mode: "text" as const }];
        for (const attempt of attempts) {
          try {
            devVerboseInfo(
              `[CHAT_PLACES_REQUEST] type=fallback mode=${attempt.mode} query=${attempt.query || "(nearby)"}`,
            );
            const fallback = await searchNearbyPlaces({
              data: {
                query: attempt.query,
                lat,
                lng,
                mode: attempt.mode,
                includedTypes: attempt.includedTypes,
                locale,
                ...placesStatsPayload({
                  placesCaller: "chat.fallbackSearch",
                  placesScreen: "chat",
                }),
                ...searchPayload,
              },
            });
            placeResults = fallback.places ?? [];
            if (
              searchCtx.searchMode === "destination" &&
              searchCtx.destinationName &&
              placeResults.length > 0
            ) {
              placeResults = filterPlacesByDestinationGuard(
                placeResults,
                searchCtx.destinationName,
                activeUserText,
              );
            }
            if (isCampingFlow) {
              placeResults = filterCampingPlaces(placeResults);
            }
            if (isRestaurantFlow) {
              const split = filterPlacesForFoodIntent(placeResults, activeUserText);
              placeResults = [...split.restaurants, ...split.districts];
            }
            devVerboseInfo(`[CHAT_PLACES_SUCCESS] count=${placeResults.length}`);
            if (placeResults.length > 0) break;
          } catch (fallbackErr) {
            console.warn("[CHAT_PLACES_REQUEST] failed", fallbackErr);
          }
        }
      }

      if (isCampingFlow && !placeResults.length) {
        const intro = buildCampingIntroReply(context, activeSession);
        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          return [...trimmedPrev, { role: "assistant", content: intro }];
        });
        persistSession({
          ...activeSession,
          activeChatIntent: "camping",
          phase: "discover",
          travelContext: {
            ...context,
            activity: "camping",
            tripPurpose: "recommend_places",
          },
        });
        setPartial({});
        return true;
      }

      if (isRestaurantFlow && !placeResults.length) {
        if (
          hasCategoryPlaceQuery(activeUserText) &&
          resolveDestinationForCategorySearch(context, activeSession, activeUserText)
        ) {
          return false;
        }
        const area = context.destination ?? context.currentLocation ?? "附近";
        const emptySummary = `目前在${area}暫時找不到符合的餐廳，可以換個菜系或稍後再試。`;
        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          return [
            ...trimmedPrev,
            {
              role: "assistant",
              content: emptySummary,
              roamie: {
                title: "Roamie 推薦",
                summary: emptySummary,
                moodTag: activeSession.mood ?? "",
                recommendations: [],
                itinerary: [],
              },
            },
          ];
        });
        return false;
      }

      const { summary, payload } = generateLocalRecommendationFallback({
        context,
        session: activeSession,
        locale,
        places: placeResults ?? [],
      });
      const sessionForDisplay: ChatPlanningSession = {
        ...activeSession,
        activeChatIntent: isCampingFlow
          ? "camping"
          : (activeSession.activeChatIntent ?? "restaurant"),
        phase: "recommend",
        travelContext: context,
      };
      const { summary: displaySummary, recommendations: filteredRecs } =
        finalizeChatRecommendationDisplay(
          sessionForDisplay,
          activeUserText,
          summary,
          payload.recommendations ?? [],
        );
      const recs = (
        filteredRecs.length
          ? filteredRecs
          : hasCategoryPlaceQuery(activeUserText)
            ? (payload.recommendations ?? [])
            : filteredRecs
      ) as ChatPlaceItem[];
      if (!recs.length) {
        if (
          hasCategoryPlaceQuery(activeUserText) &&
          resolveDestinationForCategorySearch(context, activeSession, activeUserText)
        ) {
          return false;
        }
        return false;
      }
      logChatUiReceivedCards(recs.length);
      setMsgs((prev) => {
        const trimmedPrev = prev.filter(
          (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
        );
        return [
          ...trimmedPrev,
          {
            role: "assistant",
            content: displaySummary,
            roamie: {
              ...payload,
              summary: displaySummary,
              recommendations: recs,
            },
          },
        ];
      });
      const nextSession = syncSessionPlaceMemory({
        ...sessionForDisplay,
        recommendedPlaces: recs,
      });
      persistSession(nextSession);
      setPartial({});
      return recs.length > 0;
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, pushNearbyPlaceRecommendation, pushDestinationPlaceRecommendation, pushMorePlaceRecommendations, pushDestinationCategoryPlaceRecommendation, pushTripAddPlaceMoreRecommendations, commitTripAddPlaceLocalTurn, persistPlanningAdviceTurn, completeAdviceTurn],
  );

  const streamChat = useCallback(
    async (
      conversation: ChatMsg[],
      opts?: {
        phase?: import("@/lib/ai/context").ChatPhase;
        userText?: string;
        focusedPlace?: ChatPlaceItem;
      },
      sessionOverride?: ChatPlanningSession,
    ) => {
      const activeSession = sessionOverride ?? session;
      const tripSession = resolveTripAddPlaceChatSession(activeSession, loadChatSession());
      if (tripSession) {
        console.warn("[TRIP_ADD_PLACE] blocked streamChat — local recommendation only");
        const userText = opts?.userText ?? "";
        const baseConversation = conversation.filter((m) => m.content?.trim());
        try {
          await commitTripAddPlaceLocalTurn(tripSession, userText, baseConversation);
        } catch (e) {
          logTripAddPlaceFailure(e, tripSession, userText, "stream_chat_blocked");
          try {
            await commitTripAddPlaceLocalTurn(
              tripSession,
              isTripAddPlaceMoreRecommendationsRequest(userText) ? userText : "還有嗎",
              baseConversation,
            );
          } catch (retryError) {
            logTripAddPlaceFailure(retryError, tripSession, userText, "stream_chat_blocked_retry");
          }
        }
        return;
      }

      setStreaming(true);
      setLastFailed(null);
      setPartial({});
      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutMs = 60_000;
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;

        setMsgs((prev) => [...prev, { role: "assistant", content: "" }]);

        const req = await buildRequest(
          conversation,
          {
            chatPhase: opts?.phase,
            chatInput: opts?.userText,
            focusedPlace: opts?.focusedPlace,
          },
          sessionOverride,
        );
        devVerboseInfo("[AI_REPLY_REQUEST]", `phase=${req.chatPhase ?? "unknown"}`);

        const full = await streamRoamieAI(
          req,
          {
            onPartial: (p) => {
              setPartial(p);
              setMsgs((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = {
                    role: "assistant",
                    content: p.summary ?? "",
                    roamie: p,
                  };
                }
                return next;
              });
            },
            onError: (msg) => {
              throw new Error(msg);
            },
          },
          { token, signal: controller.signal },
        );

        if (!full) {
          console.error("[AI_REPLY_RESPONSE] stream_returned_null");
          throw new Error("AI 沒有回應，請再試一次。");
        }
        devVerboseInfo("[AI_REPLY_SUCCESS]", `recommendations=${full.recommendations?.length ?? 0}`);

        const userText = opts?.userText ?? "";
        const intentForGuard = parseTripIntentFromText(userText, sessionOverride ?? session);
        const summary = full.summary?.trim() ?? "";
        if (isGenericFallbackReply(summary)) {
          console.warn("[CHAT_FALLBACK_BLOCKED] generic_ai_reply");
          throw new Error("AI 沒有回應，請再試一次。");
        }
        const looksRepeatedClarify =
          /這趟比較想放鬆、拍照，還是吃美食/.test(summary) &&
          /(都有|都可以|都行)/.test(userText);
        if (
          (full.recommendations?.length ?? 0) === 0 &&
          intentForGuard.readyForRecommendations &&
          looksRepeatedClarify
        ) {
          const destination =
            intentForGuard.destinationCity ??
            (sessionOverride ?? session).tripDestination?.city ??
            "釜山";
          const fallbackSummary = [
            `${destination} 11 月通常約 9-17°C，早晚偏涼，海風明顯，建議薄羽絨或防風外套。`,
            "你剛說想要放鬆、拍照、美食都有，我先幫你抓 3 個方向：",
            `1) 海景放鬆：廣安里海邊散步 + The Bay 101 夜景`,
            "2) 情侶拍照：海東龍宮寺 + 白淺灘文化村",
            "3) 在地美食：札嘎其市場海鮮 + 南浦洞街區小吃",
            "要不要我接著幫你排成 5 天的輕鬆情侶行程？",
          ].join("\n");
          setMsgs((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: fallbackSummary,
              roamie: {
                title: `${destination} 情侶慢旅行方向`,
                summary: fallbackSummary,
                moodTag: (sessionOverride ?? session).mood ?? "",
                recommendations: [],
                itinerary: [],
              },
            };
            return next;
          });
          return;
        }

        if (full.recommendations?.length) {
          recordRecommendationNames([
            ...full.recommendations.map((r) => r.name),
            ...extractPlaceNames(session.selectedPlaces),
          ]);
        }

        const apiPhaseUsed = opts?.phase ?? resolveChatApiPhase(session, opts?.userText ?? "");
        let nextSession = mergeSessionFromRoamie(
          sessionOverride ?? session,
          full,
          (sessionOverride ?? session).phase,
        );
        const activeSession = sessionOverride ?? session;
        const followUpIntent = parsePlaceDetailFollowUp(opts?.userText ?? "");
        let { summary: displaySummary, recommendations: displayRecs } =
          finalizeChatRecommendationDisplay(
            activeSession,
            opts?.userText ?? "",
            full.summary ?? "",
            full.recommendations ?? [],
          );
        if (
          isPlaceDetailChatActive(activeSession) &&
          followUpIntent !== "nearby_cafe" &&
          followUpIntent !== "nearby_late_snack"
        ) {
          displayRecs = [];
        }
        if (displayRecs.length) {
          nextSession = {
            ...nextSession,
            recommendedPlaces: displayRecs as ChatPlaceItem[],
          };
        }
        if (nextSession.phase === "discover" && isDiscoveryComplete(nextSession)) {
          nextSession = { ...nextSession, phase: "followup" };
        }
        nextSession = {
          ...nextSession,
          phase: resolveSessionPhaseAfterReply(
            nextSession,
            Boolean(displayRecs.length),
            apiPhaseUsed,
          ),
        };
        persistSession(nextSession);

        const displayFull = {
          ...full,
          summary: displaySummary,
          recommendations: displayRecs,
        };
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: displayFull.summary,
            roamie: displayFull,
          };
          return next;
        });
        setPartial({});
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          const activeForTimeout = sessionOverride ?? session;
          const activeUserText = opts?.userText ?? "";
          const applied = await applyLocalFallback(
            activeForTimeout,
            activeUserText,
            conversation,
            "ai_timeout",
          );
          if (!applied) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              return [
                ...trimmedPrev,
                {
                  role: "assistant",
                  content: "連線有點久，但我仍會依你的需求幫你找適合的地點。",
                },
              ];
            });
          }
          setPartial({});
          setLastFailed(conversation);
          return;
        }
        console.error(
          "[CHAT_AI_REPLY_ERROR]",
          e instanceof Error ? e.message : String(e),
        );
        logAppError("[Roamie AI] chat failed", e, {
          userText: opts?.userText,
          phase: opts?.phase,
        });
        const activeForFallback = sessionOverride ?? session;
        const activeUserText = opts?.userText ?? "";
        const applied = await applyLocalFallback(
          activeForFallback,
          activeUserText,
          conversation,
          "ai_reply_failed",
        );
        if (!applied) {
          const fallbackMerged = mergeTravelContext(activeForFallback, activeUserText);
          const planningTurn = resolvePlanningFallbackTurn(
            activeUserText,
            activeForFallback,
            fallbackMerged.context,
          );
          if (planningTurn.advice.reply) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              void completeAdviceTurn(
                planningTurn,
                planningTurn.session,
                fallbackMerged.context,
                trimmedPrev,
              );
              return trimmedPrev;
            });
            setPartial({});
            return;
          }
          if (isPlanningTurnActive(fallbackMerged.session, fallbackMerged.context)) {
            const offline = buildPlanningOfflineReply(
              fallbackMerged.context,
              fallbackMerged.session,
            );
            if (offline) {
              setMsgs((prev) => {
                const trimmedPrev = prev.filter(
                  (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
                );
                return [...trimmedPrev, { role: "assistant", content: offline }];
              });
              persistSession(fallbackMerged.session);
              setPartial({});
              return;
            }
          }
          const fallbackAdviceTurn = processAdviceTurn(
            activeUserText,
            fallbackMerged.session,
            fallbackMerged.context,
          );
          if (fallbackAdviceTurn.advice.reply) {
            const trimmedPrev = conversation.filter(
              (m, i) => !(i === conversation.length - 1 && m.role === "assistant" && !m.content),
            );
            await completeAdviceTurn(
              fallbackAdviceTurn,
              fallbackMerged.session,
              fallbackMerged.context,
              trimmedPrev,
            );
            setPartial({});
            return;
          }
          const hint: ChatMsg = {
            role: "assistant",
            content:
              buildPlanningOfflineReply(
                fallbackMerged.context,
                fallbackMerged.session,
              ) ?? resolveChatConnectionFallbackMessage(e),
          };
          setMsgs((prev) => {
            const trimmedPrev = prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
            );
            return [...trimmedPrev, hint];
          });
        }
        setPartial({});
        setLastFailed(conversation);
      } finally {
        window.clearTimeout(timeoutId);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [buildRequest, session, persistSession, locale, applyLocalFallback, completeAdviceTurn, commitTripAddPlaceLocalTurn],
  );

  const handleOpenPlaceDetail = (rec: RoamieRecommendationItem) => {
    markShortcutEngaged();
    if (rec.lat == null || rec.lng == null) {
      toast.message("此地點尚無座標，暫時無法開啟地點詳情");
      return;
    }
    preserveChatUiForPlaceDetail(
      msgsRef.current,
      messagesRef.current?.scrollTop ?? 0,
    );
    const handoff = openRecommendationPlaceDetail(rec);
    void navigate({
      to: "/place",
      search: {
        placeId: handoff.placeId || undefined,
        lat: handoff.lat ?? undefined,
        lng: handoff.lng ?? undefined,
        returnTo: "chat",
      },
    });
  };

  const handleDiscussPlace = async (rec: RoamieRecommendationItem) => {
    if (streaming || generating) return;
    markShortcutEngaged();
    let item = roamieRecToChatItem(rec);
    const placeId = (item.placeId ?? item.googlePlaceId ?? "").trim();
    if (placeId && !hasValidPlaceCoordinates(item)) {
      const details = await fetchPlaceDetailsForFocus(placeId, {
        placeName: item.placeName ?? item.name,
        city: item.city,
      });
      if (details) {
        item = enrichChatPlaceItemFromDetails(item, details);
      }
    }
    const nextSession = enterPlaceDetailChat(session, item);
    persistSession(nextSession);

    const userLine = `想聊聊 ${placeDisplayName(item)}`;
    const assistantLine = buildPlaceDetailReply(item, nextSession);
    setMsgs((prev) => [
      ...prev,
      { role: "user", content: userLine },
      {
        role: "assistant",
        content: assistantLine,
        roamie: {
          title: placeDisplayName(item),
          summary: assistantLine,
          moodTag: nextSession.mood ?? nextSession.selectedMood ?? "",
          recommendations: [],
          itinerary: [],
        },
      },
    ]);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom("new_message", { force: true });
      });
    });
  };

  const send = async (
    overrideText?: string,
    opts?: { source?: "user" | "auto" },
  ) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || streaming || generating) return;

    const tripSession = resolveTripAddPlaceChatSession(session, loadChatSession());
    if (tripSession && opts?.source !== "auto") {
      markShortcutEngaged();
      const userMsg: ChatMsg = { role: "user", content: trimmed };
      const baseConversation = [...msgs, userMsg];
      setMsgs(baseConversation);
      setText("");
      setStreaming(true);
      try {
        await commitTripAddPlaceLocalTurn(tripSession, trimmed, baseConversation);
      } catch (e) {
        logTripAddPlaceFailure(e, tripSession, trimmed, "send");
        try {
          await commitTripAddPlaceLocalTurn(
            tripSession,
            isTripAddPlaceMoreRecommendationsRequest(trimmed) ? trimmed : "還有嗎",
            baseConversation,
          );
        } catch (retryError) {
          logTripAddPlaceFailure(retryError, tripSession, trimmed, "send_retry");
        }
      } finally {
        setStreaming(false);
      }
      return;
    }

    if (isPlaceDetailChatActive(session)) {
      markShortcutEngaged();
      const followUp = parsePlaceDetailFollowUp(trimmed);
      const userMsg: ChatMsg = { role: "user", content: trimmed };
      const baseConversation = [...msgs, userMsg];
      setMsgs(baseConversation);
      setText("");

      if (followUp === "add_to_trip" && session.placeDetailFocus) {
        const focus = session.placeDetailFocus;
        let nextSession = addSelectedPlace(session, focus);
        nextSession = enterPlaceDetailChat(nextSession, focus);
        persistSession(nextSession);
        const reply =
          buildPlaceDetailFollowUpReply("add_to_trip", nextSession) ??
          `好的，已把「${placeDisplayName(focus)}」記下來。`;
        setMsgs([...baseConversation, { role: "assistant", content: reply }]);
        return;
      }

      if (followUp === "view_route" && session.placeDetailFocus) {
        const focus = session.placeDetailFocus;
        if (focus.lat != null && focus.lng != null) {
          window.open(buildPlaceMapsUrl(focus.lat, focus.lng, focus.name), "_blank", "noopener");
        }
        const reply =
          buildPlaceDetailFollowUpReply("view_route", session) ??
          "已為你開啟路線，也可以直接點卡片上的查看路線。";
        setMsgs([...baseConversation, { role: "assistant", content: reply }]);
        return;
      }

      const nearbyIntent = resolvePlaceDetailNearbyIntent(trimmed);
      if (nearbyIntent) {
        let centered = await ensurePlaceDetailFocusCoordinates(
          session,
          geocodeLocationFn,
          locale,
          fetchPlaceDetailsForFocus,
        );
        centered = sessionWithPlaceDetailSearchCenter(centered);
        const nextSession = {
          ...centered,
          activeChatIntent: nearbyIntent,
          phase: "recommend" as const,
        };
        persistSession(nextSession);
        const followUpKind = parsePlaceDetailFollowUp(trimmed);
        const preface =
          buildPlaceDetailFollowUpReply(followUpKind, nextSession) ??
          `好，我以「${placeDisplayName(nextSession.placeDetailFocus!)}」為中心幫你找附近地點。`;
        const conversationWithPreface = [
          ...baseConversation,
          { role: "assistant", content: preface },
        ];
        setMsgs(conversationWithPreface);
        setStreaming(true);
        try {
          const applied = await pushNearbyPlaceRecommendation(
            nextSession,
            trimmed,
            conversationWithPreface,
            nearbyIntent,
          );
          if (!applied) {
            toast.message("暫時找不到附近地點，可以換個描述再試。");
          }
        } finally {
          setStreaming(false);
        }
        return;
      }

      let nextSession = enterPlaceDetailChat(session, session.placeDetailFocus!);
      const merged = mergeTravelContext(nextSession, trimmed);
      nextSession = merged.session;
      persistSession(nextSession);
      await streamChat(
        baseConversation,
        {
          phase: "followup",
          userText: trimmed,
          focusedPlace: session.placeDetailFocus,
        },
        nextSession,
      );
      return;
    }

    let nextSession = applyTripIntentToSession(trimmed, session);
    if (opts?.source !== "auto") {
      markShortcutEngaged();
      nextSession = markHomeMoodShortcutEngaged(nextSession);
    }
    nextSession = applyQuickChipContext(trimmed, nextSession);
    nextSession = applyDiningContextFromText(trimmed, nextSession);

    const lastAssistantReply = [...msgs]
      .reverse()
      .find((m) => m.role === "assistant" && m.content?.trim())?.content;
    nextSession = prepareSessionForUserTurn(nextSession, lastAssistantReply);

    if (isReplanIntent(trimmed)) {
      nextSession = resetChatPlanningForReplan(nextSession, "user_replan_intent");
    }

    const merged = mergeTravelContext(nextSession, trimmed, lastAssistantReply);
    nextSession = merged.session;
    if (isBudgetRefinementText(trimmed)) {
      nextSession = applyBudgetRefinementToSession(trimmed, {
        ...nextSession,
        travelContext: merged.context,
      });
    }
    const planningMerge = mergeTripPlanningContext(trimmed, nextSession, merged.context);
    nextSession = planningMerge.session;
    const conversationMode = resolveConversationMode(trimmed, nextSession);

    const destCandidate =
      merged.context.destination?.trim() ||
      nextSession.tripDestination?.displayLabel?.trim() ||
      nextSession.tripDestination?.city?.trim();
    const isTripStyleSelection =
      nextSession.pendingQuestion?.type === "ask_trip_style" ||
      parseAskTripStyleSelection(trimmed) != null;
    if (!isTripStyleSelection) {
      if (nextSession.phase === "done") {
        nextSession = startNewPlanningSession(nextSession, "phase_done");
      } else if (shouldStartNewPlanningSession(nextSession, destCandidate)) {
        nextSession = startNewPlanningSession(nextSession, "destination_change");
      }
    }

    nextSession = extractPlanningHintsFromText(trimmed, nextSession);
    nextSession = extractDiscoveryFromText(trimmed, nextSession);
    nextSession = extractChatPlanningContextFromText(trimmed, nextSession);

    const styleReselect = isStyleReselectTurn(trimmed, nextSession, merged.context);
    if (styleReselect) {
      markShortcutEngaged();
      const regenSession = applyStyleReselectToSession(nextSession, merged.context, styleReselect);
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      scrollToUserMessage(next.length - 1);
      persistSession(regenSession);

      setStreaming(true);
      try {
        const applied = await pushDestinationPlaceRecommendationRef.current(
          regenSession,
          trimmed,
          next,
          { forceRegenerate: true, replacePreviousCards: true },
        );
        if (!applied) {
          toast.message("暫時無法重新生成行程，請稍後再試。");
        }
      } finally {
        setStreaming(false);
      }
      return;
    }

    const stylePlanTurn = shouldTriggerTripStylePlanning(trimmed, nextSession, merged.context);
    if (
      stylePlanTurn &&
      (nextSession.pendingQuestion?.type === "ask_trip_style" ||
        nextSession.chatPlanningState === "waitingStyleSelection")
    ) {
      markShortcutEngaged();
      const planningTurn = processAdviceTurn(trimmed, nextSession, merged.context);
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      scrollToUserMessage(next.length - 1);
      await completeAdviceTurn(planningTurn, nextSession, merged.context, next);
      return;
    }

    try {
    if (isAddAllToTripIntent(trimmed)) {
      markShortcutEngaged();
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      scrollToUserMessage(next.length - 1);

      logAiCreateTripStart();
      const prepared = prepareSessionForCreateTripFromRecommendations(
        nextSession,
        merged.context,
        msgs,
      );
      if (!prepared) {
        logAiCreateTripError("prepare_failed");
        toast.message("目前沒有可加入的推薦地點，請先讓我幫你整理推薦。");
        setMsgs([
          ...next,
          {
            role: "assistant",
            content: "我還沒整理好可加入的地點，要不要我先幫你生成分天推薦？",
          },
        ]);
        return;
      }

      persistSession(prepared.session);
      try {
        await runDirectItineraryRef.current(
          prepared.session,
          prepared.session.travelContext ?? merged.context,
          next,
        );
      } catch (e) {
        logAiCreateTripError(e instanceof Error ? e.message : String(e));
        toast.error("行程建立失敗，請稍後再試。");
      }
      return;
    }

    if (shouldAcceptAlternativeRecommendations(msgs, trimmed)) {
      const altCtx = {
        ...(nextSession.travelContext ?? merged.context),
        tripPurpose: "alternative_recommendations" as const,
        setting: "混合" as const,
      };
      nextSession = { ...nextSession, travelContext: altCtx };
      const excludePlaceIds = collectExcludePlaceIds(nextSession, msgs);
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");

      const dest =
        altCtx.destination?.trim() ??
        nextSession.tripPlanningContext?.destination?.trim() ??
        nextSession.tripDestination?.city?.trim();

      if (dest) {
        const applied = await pushAlternativeDestinationPlaceRecommendation(
          { ...nextSession, travelContext: { ...altCtx, destination: dest } },
          trimmed,
          next,
          dest,
          { excludePlaceIds, rejectedPlaceNames: nextSession.rejectedPlaceNames },
        );
        if (applied) return;
      }

      nextSession = await resolveChatLocation(nextSession);
      if (sessionHasLocation(nextSession)) {
        for (const nearbyIntent of ["restaurant", "cafe", "attraction"] as const) {
          setStreaming(true);
          try {
            const applied = await pushNearbyPlaceRecommendation(
              { ...nextSession, travelContext: altCtx },
              trimmed,
              next,
              nearbyIntent,
              {
                excludePlaceIds,
                rejectedPlaceNames: nextSession.rejectedPlaceNames,
                blockedCoreNames: collectBlockedCoreNames(nextSession, msgs),
                userText: trimmed,
                cityLabel:
                  nextSession.location?.city ??
                  altCtx.destination ??
                  nextSession.tripDestination?.city,
              },
            );
            if (applied) return;
          } finally {
            setStreaming(false);
          }
        }
      }

      setMsgs([
        ...next,
        { role: "assistant", content: CHAT_STATE_MACHINE_RECOVERY_MESSAGE },
      ]);
      return;
    }

    if (shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)) {
      nextSession = applyRefreshRecommendationSession(trimmed, nextSession);
      nextSession = mergeTripSessionUsedPlacesFromMessages(nextSession, msgs);
      const priorFromMsgs = extractRecommendedFromMsgs(msgs);
      if (priorFromMsgs.length && !nextSession.recommendedPlaces.length) {
        nextSession = syncSessionPlaceMemory({
          ...nextSession,
          recommendedPlaces: priorFromMsgs,
        });
      }
      const refreshCtx = {
        ...(nextSession.travelContext ?? merged.context),
        tripPurpose: "more_place_recommendations" as const,
        excludedCategories:
          nextSession.excludedCategories ?? merged.context.excludedCategories,
        setting:
          nextSession.discovery?.setting ??
          nextSession.travelContext?.setting ??
          merged.context.setting,
      };
      nextSession = { ...nextSession, travelContext: refreshCtx };
      const excludePlaceIds = collectExcludePlaceIds(nextSession, msgs);
      const blockedCoreNames = collectBlockedCoreNames(nextSession, msgs);

      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");

      const dest =
        refreshCtx.destination ??
        nextSession.tripPlanningContext?.destination ??
        nextSession.tripDestination?.city;

      if (dest?.trim()) {
        setStreaming(true);
        try {
          const applied = await pushMorePlaceRecommendations(
            { ...nextSession, travelContext: { ...refreshCtx, destination: dest } },
            trimmed,
            next,
            { excludePlaceIds, rejectedPlaceNames: nextSession.rejectedPlaceNames },
          );
          if (applied) return;
        } finally {
          setStreaming(false);
        }
      }

      const refreshIntent = resolveRefreshNearbyIntent(nextSession, refreshCtx);
      if (sessionHasLocation(nextSession)) {
        setStreaming(true);
        try {
          const applied = await pushNearbyPlaceRecommendation(
            { ...nextSession, travelContext: refreshCtx },
            trimmed,
            next,
            refreshIntent,
            {
              excludePlaceIds,
              rejectedPlaceNames: nextSession.rejectedPlaceNames,
              blockedCoreNames,
              userText: trimmed,
              cityLabel:
                nextSession.location?.city ??
                refreshCtx.destination ??
                nextSession.tripDestination?.city,
            },
          );
          if (applied) return;
        } finally {
          setStreaming(false);
        }
      }

      logChatMorePlacesNoResultAllowed(true);
      setMsgs([
        ...next,
        { role: "assistant", content: NO_MORE_RECOMMENDATIONS_MESSAGE },
      ]);
      return;
    }

    const placeFetchContext = mergeContextForPlaceFetch(merged.context, nextSession);

    if (placeFetchContext.destination?.trim() && !placeFetchContext.weather) {
      const weather = await prefetchDestinationWeather({
        destination: placeFetchContext.destination,
        locale,
        geocodeFn: geocodeLocationFn,
        fetchWeatherFn: fetchWeather,
      });
      if (weather) {
        nextSession = {
          ...nextSession,
          weather,
          travelContext: {
            ...(nextSession.travelContext ?? placeFetchContext),
            weather,
          },
        };
      }
    }

    const refreshedPlaceCtx = mergeContextForPlaceFetch(
      nextSession.travelContext ?? merged.context,
      nextSession,
    );

    if (shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      const applied = await pushDestinationPlaceRecommendation(
        { ...nextSession, travelContext: refreshedPlaceCtx },
        trimmed,
        next,
      );
      if (applied) return;
      const fallbackApplied = await applyLocalFallback(
        nextSession,
        trimmed,
        next,
        "destination_places_failed",
      );
      if (fallbackApplied) return;
      return;
    }

    if (shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
      const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      setMsgs(next);
      setText("");
      const applied = await pushDestinationCategoryPlaceRecommendation(
        { ...nextSession, travelContext: refreshedPlaceCtx },
        trimmed,
        next,
      );
      if (applied) return;
      const fallbackApplied = await applyLocalFallback(
        nextSession,
        trimmed,
        next,
        "destination_category_places_failed",
      );
      if (fallbackApplied) return;

      const hasCardsInConversation = next.some(
        (m) => m.role === "assistant" && (m.roamie?.recommendations?.length ?? 0) > 0,
      );
      if (hasCardsInConversation) return;

      setMsgs((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `目前在${resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? "這個目的地"}暫時找不到符合的地點，可以換個描述或稍後再試。`,
        },
      ]);
      return;
    }

    if (
      (isPlanningTurnActive(nextSession, merged.context) ||
        isDestinationPlanningSession(nextSession, merged.context)) &&
      !shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
      !shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
      !(
        hasCategoryPlaceQuery(trimmed) &&
        !coerceTravelDestination(
          resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed),
        )
      )
    ) {
      const planningCtx = nextSession.travelContext ?? merged.context;
      const earlyPlanningTurn = processAdviceTurn(trimmed, nextSession, planningCtx);
      if (earlyPlanningTurn.advice.reply) {
        const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
        setMsgs(next);
        setText("");
        await completeAdviceTurn(earlyPlanningTurn, nextSession, merged.context, next);
        return;
      }
    }

    const intent = resolveChatIntent(trimmed, nextSession);

    if (intent === "destination_advice" || intent === "best_travel_time" || intent === "trip_planning") {
      nextSession = {
        ...nextSession,
        activeChatIntent:
          intent === "destination_advice" || intent === "best_travel_time"
            ? "destination_advice"
            : nextSession.activeChatIntent,
        conversationMode: "destination_planning",
      };
    } else if (
      intent === "create_itinerary" &&
      !nextSession.fromMoodFlow &&
      !nextSession.fromMoodCard &&
      !nextSession.homeMoodShortcutEntry
    ) {
      nextSession = {
        ...nextSession,
        conversationMode: "destination_planning",
      };
    }

    if (isFoodPreferenceReply(trimmed) && nextSession.activeChatIntent === "restaurant") {
      const food = parseFoodPreference(trimmed);
      if (food) nextSession = { ...nextSession, foodPreference: food };
    }

    const effectiveConversationMode =
      nextSession.conversationMode ?? conversationMode;

    const categoryPlaceQuery = shouldFetchDestinationCategoryPlaces(
      trimmed,
      refreshedPlaceCtx,
      nextSession,
    );

    const inferredNearbyIntent = categoryPlaceQuery
      ? inferNearbyIntentFromContext(merged.context, trimmed, nextSession)
      : (effectiveConversationMode === "destination_planning" ||
            effectiveConversationMode === "place_focus" ||
            intent === "destination_advice" ||
            intent === "create_itinerary" ||
            intent === "best_travel_time" ||
            intent === "trip_planning") &&
          !nextSession.fromMoodFlow &&
          !nextSession.fromMoodCard &&
          !nextSession.homeMoodShortcutEntry
        ? null
        : inferNearbyIntentFromContext(merged.context, trimmed, nextSession);

    if (
      isNearbyPlaceIntent(intent) ||
      nextSession.activeChatIntent === "restaurant" ||
      (nextSession.fromMoodFlow &&
        effectiveConversationMode !== "destination_planning" &&
        intent !== "destination_advice" &&
        intent !== "trip_planning") ||
      inferredNearbyIntent
    ) {
      nextSession = await resolveChatLocation(nextSession);
    }

    if (inferredNearbyIntent && !nextSession.activeChatIntent) {
      nextSession = { ...nextSession, activeChatIntent: inferredNearbyIntent };
    }

    const route = resolveChatRoute(trimmed, merged.context, nextSession, locale, intent);
    const tripIntent = parseTripIntentFromText(trimmed, nextSession);

    if (
      (route.mode === "recommend" ||
        tripIntent.readyForRecommendations ||
        isNearbyPlaceIntent(intent) ||
        intent === "refine_recommendations" ||
        nextSession.activeChatIntent === "restaurant" ||
        inferredNearbyIntent) &&
      intent !== "destination_advice" &&
      intent !== "trip_planning" &&
      route.mode !== "advice" &&
      !isDestinationPlanningSession(nextSession, merged.context)
    ) {
      nextSession = { ...nextSession, phase: "recommend" };
    }

    persistSession(nextSession);

    const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
    setMsgs(next);
    setText("");

    const tryNearbyRecommendation = async (
      nearbyIntent: import("@/lib/ai/chat-intent").NearbyPlaceIntent,
    ): Promise<boolean> => {
      if (
        !shouldFetchNearbyPlaces(nearbyIntent, nextSession, trimmed) ||
        !sessionHasLocation(nextSession)
      ) {
        return false;
      }
      setStreaming(true);
      try {
        const applied = await pushNearbyPlaceRecommendation(
          nextSession,
          trimmed,
          next,
          nearbyIntent,
        );
        if (applied) return true;
        return await applyLocalFallback(nextSession, trimmed, next, "places_empty");
      } finally {
        setStreaming(false);
      }
    };

    if (route.mode === "itinerary" || isUserConfirmingItinerary(trimmed)) {
      const itineraryDestination =
        merged.context.destination?.trim() ||
        nextSession.tripDestination?.displayLabel?.trim() ||
        nextSession.tripDestination?.city?.trim();
      const itineraryDays = merged.context.days ?? nextSession.tripDays;
      if (itineraryDestination && itineraryDays) {
        await runDirectItineraryRef.current(
          { ...nextSession, phase: "ready" },
          merged.context,
          next,
        );
        return;
      }
      if (nextSession.selectedPlaces.length < 1) {
        toast.message("你可以先選幾個想去的地方，我再幫你把它們排成舒服的路線。");
        const hint: ChatMsg = {
          role: "assistant",
          content: "你可以先選幾個想去的地方，我再幫你把它們排成舒服的路線 ☺️",
        };
        setMsgs([...next, hint]);
        return;
      }
      const readySession: ChatPlanningSession = { ...nextSession, phase: "ready" };
      persistSession(readySession);
      await handleGenerateItinerary(readySession, next);
      return;
    }

    if (
      nextSession.activeChatIntent === "restaurant" &&
      shouldAskRestaurantCuisine(nextSession, trimmed) &&
      !shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
      !isFoodPreferenceReply(trimmed)
    ) {
      const question = restaurantCuisineQuestion();
      persistSession({ ...nextSession, phase: "recommend" });
      setMsgs([...next, { role: "assistant", content: question }]);
      return;
    }

    if (route.mode === "advice" && route.question) {
      const turn = processAdviceTurn(trimmed, nextSession, merged.context);
      if (turn.advice.reply) {
        await completeAdviceTurn(turn, nextSession, merged.context, next);
        return;
      }
    }

    if (route.mode === "clarify" && route.question && route.missingKey) {
      if (nextSession.activeChatIntent === "restaurant") {
        const question = restaurantCuisineQuestion();
        persistSession({ ...nextSession, phase: "recommend" });
        setMsgs([...next, { role: "assistant", content: question }]);
        return;
      }
      if (inferredNearbyIntent && conversationMode !== "destination_planning") {
        const applied = await tryNearbyRecommendation(inferredNearbyIntent);
        if (applied) return;
      }
      nextSession = markAskedClarifyKey(nextSession, route.missingKey);
      persistSession({
        ...nextSession,
        pendingQuestion: route.pendingQuestion,
      });
      setMsgs([...next, { role: "assistant", content: route.question }]);
      return;
    }

    const nearbyIntent =
      categoryPlaceQuery
        ? inferNearbyIntentFromContext(merged.context, trimmed, nextSession)
        : conversationMode === "destination_planning"
          ? null
          : (isNearbyPlaceIntent(intent) ? intent : null) ??
            (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
              ? nextSession.activeChatIntent
              : null) ??
            inferredNearbyIntent;

    if (categoryPlaceQuery) {
      const applied = await pushDestinationCategoryPlaceRecommendation(
        nextSession,
        trimmed,
        next,
      );
      if (applied) return;
    }

    if (nearbyIntent) {
      const applied = await tryNearbyRecommendation(nearbyIntent);
      if (applied) return;
      if (nearbyIntent === "restaurant") {
        toast.message("暫時找不到附近餐廳，請稍後再試。");
        return;
      }
      if (nearbyIntent === "camping") {
        const intro = buildCampingIntroReply(merged.context, nextSession);
        persistSession({
          ...nextSession,
          activeChatIntent: "camping",
          phase: "discover",
          travelContext: {
            ...merged.context,
            activity: "camping",
            tripPurpose: "recommend_places",
          },
        });
        setMsgs([...next, { role: "assistant", content: intro }]);
        return;
      }
    }

    if (intent === "refine_recommendations" || isBudgetRefinementText(trimmed)) {
      const refineIntent =
        (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
          ? nextSession.activeChatIntent
          : null) ??
        inferNearbyIntentFromContext(
          nextSession.travelContext ?? merged.context,
          trimmed,
          nextSession,
        ) ??
        "attraction";

      if (sessionHasLocation(nextSession)) {
        setStreaming(true);
        try {
          const applied = await pushNearbyPlaceRecommendation(
            nextSession,
            trimmed,
            next,
            refineIntent,
            {
              excludePlaceIds: collectExcludePlaceIds(nextSession, msgs),
              rejectedPlaceNames: nextSession.rejectedPlaceNames,
              blockedCoreNames: collectBlockedCoreNames(nextSession, msgs),
              userText: trimmed,
              cityLabel: nextSession.location?.city ?? merged.context.destination,
            },
          );
          if (applied) return;
        } finally {
          setStreaming(false);
        }
      }

      if (!isBudgetRefinementText(trimmed)) {
        setMsgs([
          ...next,
          { role: "assistant", content: NO_MORE_RECOMMENDATIONS_MESSAGE },
        ]);
        return;
      }

      const existingRecs =
        nextSession.recommendedPlaces.length > 0
          ? nextSession.recommendedPlaces
          : [...msgs]
              .reverse()
              .find((m) => m.role === "assistant" && m.roamie?.recommendations?.length)
              ?.roamie?.recommendations ?? [];

      const refinedItems = refineRecommendationItemsForBudget(existingRecs, "low").slice(0, 5);
      if (refinedItems.length > 0) {
        const summary = buildBudgetRefinementSummary(
          nextSession.travelContext ?? merged.context,
          refinedItems,
        );
        const sessionWithRefine: ChatPlanningSession = {
          ...nextSession,
          activeChatIntent: refineIntent,
          phase: "followup",
        };
        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRefine, trimmed, summary, refinedItems);
        persistSession(
          syncSessionPlaceMemory({
            ...sessionWithRefine,
            recommendedPlaces: filteredRecs as ChatPlaceItem[],
          }),
        );
        setMsgs([
          ...next,
          {
            role: "assistant",
            content: displaySummary,
            roamie: {
              title: "Roamie 推薦",
              summary: displaySummary,
              moodTag: sessionWithRefine.mood ?? merged.context.mood ?? "",
              recommendations: filteredRecs,
              itinerary: [],
            },
          },
        ]);
        return;
      }
    }

    if (isPlanningTurnActive(nextSession, merged.context)) {
      if (
        shouldBlockPlanningFallbackForCategoryQuery(trimmed, merged.context, nextSession)
      ) {
        const applied = await pushDestinationCategoryPlaceRecommendation(
          nextSession,
          trimmed,
          next,
        );
        if (applied) return;
      }
      const planningTurn = processAdviceTurn(trimmed, nextSession, merged.context);
      if (planningTurn.advice.reply) {
        await completeAdviceTurn(planningTurn, nextSession, merged.context, next);
        return;
      }
      const applied = await applyLocalFallback(nextSession, trimmed, next, "planning_no_reply");
      if (applied) return;
      const offline = buildPlanningOfflineReply(merged.context, nextSession);
      if (offline) {
        persistSession(nextSession);
        setMsgs([...next, { role: "assistant", content: offline }]);
        return;
      }
      return;
    }

    await streamChat(next, { phase: route.chatPhase, userText: trimmed }, nextSession);
    } catch (error) {
      logAppError("CHAT_STATE_MACHINE_ERROR", error);
      console.warn(
        "[CHAT_STATE_MACHINE_ERROR]",
        error instanceof Error ? error.message : String(error),
      );
      setStreaming(false);

      const errorConversation: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
      try {
        const fallbackApplied = await applyLocalFallback(
          session,
          trimmed,
          errorConversation,
          "state_machine_error",
        );
        if (fallbackApplied) {
          setText("");
          return;
        }
      } catch (fallbackError) {
        console.warn(
          "[CHAT_STATE_MACHINE_FALLBACK_FAILED]",
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
      }

      setMsgs((prev) => {
        const hasUserTurn = prev.some(
          (m, i) => i === prev.length - 1 && m.role === "user" && m.content === trimmed,
        );
        const base = hasUserTurn ? prev : [...prev, { role: "user" as const, content: trimmed }];
        const last = base[base.length - 1];
        if (last?.role === "assistant" && last.content === CHAT_STATE_MACHINE_RECOVERY_MESSAGE) {
          return base;
        }
        return [...base, { role: "assistant" as const, content: CHAT_STATE_MACHINE_RECOVERY_MESSAGE }];
      });
      setText("");
    }
  };

  const handleGenerateItinerary = async (
    sessionOverride?: ChatPlanningSession,
    msgsOverride?: ChatMsg[],
  ) => {
    const activeSession = sessionOverride ?? session;
    const activeMsgs = msgsOverride ?? msgs;
    if (!canGenerateItinerary(activeSession) || generating) return;
    setGenerating(true);
    logAiState("CREATING_TRIP");
    persistSession({ ...activeSession, phase: "generating", aiItineraryState: "CREATING_TRIP" });

    try {
      const bundle = activeSession.tripDestination
        ? await buildContextBundleForTrip(activeSession.tripDestination, fetchWeather)
        : await buildClientContextBundle(fetchWeather);
      const [prefs, profile] = await Promise.all([getAiPreferences(), getUserProfile()]);
      const fashionStyle = resolveFashionStyle({
        travelStyle: profile.travelStyle,
        interests: prefs.interests,
        style: activeSession.tripStyles || (activeSession.pace === "排滿" ? "緊湊" : "慢旅行"),
      });
      let workingSession = activeSession;
      let places = buildTripFromSelectedPlaces(workingSession);
      const today = new Date().toISOString().slice(0, 10);
      const tripDays = workingSession.tripDays ?? 1;
      const rawDestination =
        (workingSession.tripDestination
          ? formatTripLocationLabel(workingSession.tripDestination)
          : null) ||
        workingSession.travelContext?.destination?.trim() ||
        inferDestinationFromPlaces(places, bundle.location) ||
        bundle.location.city ||
        "目前位置";
      const destination = sanitizeDestinationForGeocode(rawDestination);
      const dayPlan = workingSession.currentDayPlan;
      const lastUserText =
        [...activeMsgs].reverse().find((m) => m.role === "user")?.content ?? "";
      const tripDates = resolveTripCreateDates({
        context: workingSession.travelContext ?? { interests: [] },
        session: workingSession,
        days: tripDays,
        userText: lastUserText,
      });
      logAiCreateTripDates(tripDates);

      if (places.length < 1 && !dayPlan?.items.length && tripDays > 0 && destination !== "目前位置") {
        const prepared = await prepareDirectItinerarySession({
          session: workingSession,
          context: {
            ...(workingSession.travelContext ?? { interests: [] }),
            destination,
            days: tripDays,
          },
          locale,
          searchPlaces: searchNearbyPlaces,
          geocodeFn: geocodeLocationFn,
          fetchWeatherFn: fetchWeather,
          excludePlaceIds: collectExcludePlaceIds(workingSession),
          msgs: activeMsgs,
        });
        if (!prepared.ok) {
          logItineraryFailureReason(prepared.message);
          setMsgs((prev) => [
            ...prev,
            { role: "assistant", content: prepared.message },
          ]);
          if (prepared.apiEmpty) {
            toast.error(prepared.message);
          }
          persistSession({
            ...workingSession,
            phase: "ready",
            aiItineraryState: "FAILED",
            pendingQuestion: prepared.apiEmpty
              ? {
                  type: "activity_choice",
                  options: ["must_visit_places", "daily_recommendations"],
                  baseDestination: destination,
                }
              : undefined,
          });
          return;
        }
        workingSession = prepared.session;
        places = buildTripFromSelectedPlaces(workingSession);
        persistSession(workingSession);
      }

      const startDate = tripDates.startDate ?? "";
      const endDate = tripDates.endDate ?? "";
      const budget = budgetModeToItineraryTier(resolveBudgetMode(prefs));

      let createResult: Awaited<ReturnType<typeof createItineraryFromSession>>;

      if (dayPlan?.items.length) {
        const itineraryItems = buildItineraryFromDayPlan(dayPlan, tripDates);
        verifyDayPlanItineraryOrder(dayPlan, itineraryItems);
        const itineraryDays = buildItineraryDaysFromDayPlan(dayPlan, tripDates, itineraryItems);
        for (const day of itineraryDays) {
          logAiCreateItineraryDay(day.dayIndex, day.date, day.items.length);
        }
        const recommendations = dayPlanToRecommendations(dayPlan);
        createResult = {
          ok: true,
          state: "SUCCESS",
          session: { ...workingSession, aiItineraryState: "SUCCESS", phase: "generating" },
          payload: {
            version: 2,
            title: `${destination} ${tripDays} 天`,
            summary: `依你選的 ${dayPlan.items.length} 個地點排成 ${tripDays} 天行程。`,
            moodTag: workingSession.mood ?? "",
            recommendations,
            itinerary: itineraryItems,
            destination,
            days: tripDays,
            dayPlan,
            itineraryDays,
            tripSettings: {
              tripStartDate: startDate || undefined,
              tripEndDate: endDate || undefined,
            },
            generatedAt: new Date().toISOString(),
          },
          generateResult: { success: true },
        };
      } else {
        const generateInput = {
          destination,
          days: tripDays,
          budget,
          style: workingSession.tripStyles || (workingSession.pace === "排滿" ? "緊湊" : "慢旅行"),
          mood: workingSession.mood ?? "",
          interests: buildConversationSummary(workingSession, activeMsgs),
          conversationSummary: buildConversationSummary(workingSession, activeMsgs),
          startDate: startDate || today,
          endDate: endDate || startDate || today,
          origin: workingSession.tripOrigin
            ? formatTripLocationLabel(workingSession.tripOrigin)
            : (bundle.location.city ?? ""),
          travelers: workingSession.tripCompanionCount ?? 1,
          transport: workingSession.transportation ?? "",
          selectedPlaces: places.map((p) => ({
            ...p,
            googlePlaceId: p.googlePlaceId ?? p.placeId,
          })),
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: workingSession.startTime || bundle.time,
          fashionStyle: fashionStyle ?? "",
          locale,
        };

        logAiState("BUILDING_ITINERARY", `places=${places.length}`);
        createResult = await createItineraryFromSession({
          session: workingSession,
          generateInput,
          generateItineraryFn: generate,
        });
      }

      if (!createResult.ok) {
        logItineraryFailureReason(createResult.message);
        setMsgs((prev) => [
          ...prev,
          { role: "assistant", content: createResult.message },
        ]);
        if (createResult.offerMustVisit) {
          toast.error(createResult.message);
        }
        persistSession(createResult.session);
        return;
      }

      const itinerary = createResult.payload;

      const itineraryStops = coalesceItineraryItems(itinerary.itinerary);
      logItineraryItemsCoalesced(itineraryStops.length);
      const legPlaces = itineraryStops
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
      const routeLegs = await getTripLegsWithDurations(
        legPlaces,
        travelLabelToRoutesMode(workingSession.transportation ?? "步行"),
      );
      const weatherSummary = bundle.weather
        ? `${bundle.weather.city} ${bundle.weather.condition} ${bundle.weather.tempC ?? ""}C`
        : "天氣資料暫不可用";
      const outfitSuggestion = tripDates.hasExplicitDates
        ? generateOutfitSuggestion(
            {
              destinationPlace: { name: destination },
              startDate,
              endDate,
              transportMode: workingSession.transportation ?? "walk",
            },
            normalizeWeather(bundle.weather),
          )
        : "";
      const cover = await getTripCoverImage({
        destination,
        mood: workingSession.mood ?? "",
        moodTag: workingSession.mood ?? "",
        title: itinerary.title,
      });

      let draftPayload: RoamiePayloadV2 = {
        ...itinerary,
        itinerary: itineraryStops,
        userSaved: false,
        weatherSummary,
        outfitSuggestion,
        aiGeneratedCoverImageUrl: cover.url,
        tripSettings: {
          ...itinerary.tripSettings,
          tripStartDate: tripDates.hasExplicitDates ? startDate : undefined,
          tripEndDate: tripDates.hasExplicitDates ? endDate : undefined,
          transport: workingSession.transportation === "開車"
            ? "drive"
            : workingSession.transportation === "大眾運輸"
              ? "transit"
              : workingSession.transportation === "機車"
                ? "scooter"
                : "walk",
          transitLegs: Object.fromEntries(
            routeLegs.map((leg, idx) => [
              `${itineraryStops[idx]?.placeName ?? idx}→${itineraryStops[idx + 1]?.placeName ?? idx + 1}`,
              {
                headline: `${leg.distanceMeters}m`,
                durationMinutes: leg.durationMinutes,
                distanceMeters: leg.distanceMeters,
              },
            ]),
          ),
        },
      };
      const coreDraft: CoreTrip = toCoreTrip({
        id: "draft",
        title: draftPayload.title,
        custom_title: null,
        is_title_customized: false,
        mood: draftPayload.moodTag ?? null,
        cover_image: cover.url,
        cover_image_url: null,
        custom_cover_image_url: null,
        is_cover_customized: false,
        cover_source: "unsplash",
        cover_query: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        payload: draftPayload,
      });
      draftPayload = attachCoreTripToPayload(draftPayload, coreDraft);
      devVerboseInfo("[CORE_TRIP] created", "draft");
      logItinerarySavePayloadReady(destination, tripDays, itineraryStops.length);
      logItinerarySaveStart();
      try {
        saveDraftTrip(draftPayload);
        logItinerarySaveSuccess("draft");
      } catch (saveError) {
        const reason = saveError instanceof Error ? saveError.message : String(saveError);
        logItinerarySaveFailed(reason);
        devVerboseInfo("[ITINERARY_SAVE_FAILED_REASON]", reason);
        logItineraryFailureReason(`draft_save:${reason}`);
        throw saveError;
      }

      const saved = await confirmSaveTrip(draftPayload, "chat");
      clearDraftTrip();
      if (workingSession.fromPlanAi || workingSession.planAiMode) {
        clearPlanFormDraft();
      }
      logItinerarySaveSuccess(saved.id);
      logAiItinerarySuccess(saved.id);
      logAiCreateTripSuccess(saved.id);

      persistSession(
        clearPlanningSessionState(
          {
            ...workingSession,
            phase: "done",
            aiItineraryState: "SUCCESS",
            draftTrip: undefined,
            lastGeneratedTripId: saved.id,
          },
          "trip_created",
        ),
      );

      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: AI_ITINERARY_SUCCESS_REDIRECT_MESSAGE },
      ]);

      logTripNav("ChatGeneratedItinerary", saved.id);
      navigate(tripDetailNavigateOptions(saved.id));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn("[ITINERARY_GENERATE]", e);
      logItinerarySaveFailed(reason);
      logItineraryFailureReason(`generate_exception:${reason}`);
      persistSession({
        ...activeSession,
        phase: "ready",
        aiItineraryState: "FAILED",
        pendingQuestion: {
          type: "activity_choice",
          options: ["must_visit_places", "daily_recommendations"],
          baseDestination:
            activeSession.tripDestination?.city ??
            activeSession.travelContext?.destination,
        },
      });
      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: ITINERARY_GENERATION_FAILED_MESSAGE },
      ]);
      toast.error(ITINERARY_GENERATION_FAILED_MESSAGE);
    } finally {
      setGenerating(false);
    }
  };

  runDirectItineraryRef.current = async (
    activeSession: ChatPlanningSession,
    context: CanonicalTravelContext,
    conversation: ChatMsg[],
  ) => {
    setStreaming(true);
    try {
      const prepared = await prepareDirectItineraryFlow({
        session: activeSession,
        context,
        locale,
        searchPlaces: searchNearbyPlaces,
        geocodeFn: geocodeLocationFn,
        fetchWeatherFn: fetchWeather,
        excludePlaceIds: collectExcludePlaceIds(activeSession),
        msgs: conversation,
      });
      if (!prepared.ok) {
        logItineraryFailureReason(prepared.message);
        setMsgs([
          ...conversation,
          { role: "assistant", content: prepared.message },
        ]);
        persistSession(prepared.session);
        if (prepared.offerMustVisit) {
          toast.error(prepared.message);
        }
        return;
      }
      persistSession(prepared.session);
      await handleGenerateItinerary(prepared.session, conversation);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn("[ITINERARY_DIRECT_GEN]", e);
      logItineraryFailureReason(`direct_gen:${reason}`);
      setMsgs([
        ...conversation,
        { role: "assistant", content: ITINERARY_GENERATION_FAILED_MESSAGE },
      ]);
      toast.error(ITINERARY_GENERATION_FAILED_MESSAGE);
      persistSession({
        ...activeSession,
        phase: "ready",
        aiItineraryState: "FAILED",
        pendingQuestion: {
          type: "activity_choice",
          options: ["must_visit_places", "daily_recommendations"],
          baseDestination: context.destination,
        },
      });
    } finally {
      setStreaming(false);
    }
  };

  const retry = async () => {
    if (!lastFailed || streaming) return;
    await streamChat(lastFailed);
  };

  const confirmClearChat = async () => {
    if (streaming || generating || clearing) return;
    setClearing(true);
    try {
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setGenerating(false);

      const recId = session.recommendationId;
      await clearChatHistory();
      clearChatSession();
      clearChatUiCache();
      clearDraftTrip();
      clearMoodHandoffStorage(recId);
      handoffStartedRef.current = null;

      navigate({
        to: "/chat",
        search: { from: undefined, recommendationId: undefined, fromMoodFlow: undefined },
        replace: true,
      });

      const fresh = clearPlanningSessionState(createEmptySession(), "chat_reset");
      persistSession(fresh);
      setMsgs([greetingMsg]);
      setLastFailed(null);
      setPartial({});
      setText("");
      setClearDialogOpen(false);
    } catch {
      toast.error("清空失敗");
    } finally {
      setClearing(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      ref={pageRef}
      className="messenger-chat-root chat-page relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <header
        ref={headerRef}
        className="messenger-chat-header relative z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur"
      >
        <BackButton
          preferFallback
          fallback={
            session.fromTripAddPlace &&
            session.tripAddPlaceContext &&
            isValidUuid(session.tripAddPlaceContext.tripId)
              ? tripDetailNavigateOptions(session.tripAddPlaceContext.tripId, {
                  day: session.tripAddPlaceContext.selectedDay,
                })
              : session.fromPlanForm || session.fromPlanAi
                ? { to: "/plan" }
                : { to: "/" }
          }
          label={
            session.fromTripAddPlace
              ? "返回行程"
              : session.fromPlanForm || session.fromPlanAi
                ? t("chat.backToPlan")
                : t("chat.backToHome")
          }
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <RoamieAssistantAvatar className="h-9 w-9" showOnlineIndicator />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium leading-tight">Roamie</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {generating
                ? t("chat.statusGenerating")
                : streaming
                  ? t("chat.statusStreaming")
                  : session.selectedPlaces.length
                    ? t("chat.statusSelectedPlaces", { count: session.selectedPlaces.length })
                    : t("chat.statusDefault")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setClearDialogOpen(true)}
          disabled={streaming || generating || clearing}
          className="relative z-20 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t("chat.clearAria")}
          title="清除對話"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </header>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent className="mx-auto max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>要清除這段聊天嗎？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left text-sm text-muted-foreground">
                <p>清除後目前對話內容會被移除，但不會影響已儲存的行程。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:justify-end">
            <AlertDialogCancel disabled={clearing} className="mt-0 flex-1 sm:flex-none">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none"
              onClick={(e) => {
                e.preventDefault();
                void confirmClearChat();
              }}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : "清除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="messenger-chat-body flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={messagesRef}
          data-keyboard-scroll-root
          className="messenger-chat-messages chat-messages min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5"
          style={{
            flex: "1 1 0%",
            paddingBottom: `${Math.max(messengerLayout.messagesPaddingBottomPx, 0)}px`,
            transition: messengerLayout.keyboardOpen
              ? "padding-bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)"
              : undefined,
          }}
        >
          {hasPlusAccess &&
            travelPrefStatus !== null &&
            !travelPrefStatus.preferenceQuizCompleted &&
            shouldShowTripAddPlacePlusUpsell(session) && (
            <PreferenceQuizCta origin="chat" variant="banner" className="animate-rise" />
          )}
          <ChatMessageList
            msgs={msgs}
            hydrating={hydrating}
            streaming={streaming}
            partial={partial}
            selectedNames={selectedNames}
            savedNames={savedNames}
            savingName={savingName}
            addToTripLabel={
              session.fromTripAddPlace ? "加入此行程" : t("chat.addToTrip")
            }
            discussPlaceLabel={t("trip.discussPlace")}
            viewMapLabel={t("chat.viewMap")}
            onRecommendationEngage={markShortcutEngaged}
            onSavePlace={(rec) => {
              void handleSavePlace(rec);
            }}
            onAddToTrip={(rec) => {
              void handleAddToTripFromChat(rec);
            }}
            onOpenPlaceDetail={handleOpenPlaceDetail}
            onDiscussPlace={(rec) => {
              void handleDiscussPlace(rec);
            }}
          />
          {lastFailed && !streaming && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80"
              >
                <RotateCcw className="h-3 w-3" /> 重新嘗試
              </button>
            </div>
          )}
          <div ref={bottomAnchorRef} aria-hidden className="h-px w-full shrink-0" />
        </div>

        <div
          ref={composerRef}
          className={cn(
            "messenger-chat-composer",
            messengerLayout.keyboardOpen && "messenger-chat-composer--keyboard-open",
          )}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            marginInline: "auto",
            maxWidth: "440px",
            bottom: `${messengerLayout.composerBottomPx}px`,
            zIndex: 45,
            transition: messengerLayout.keyboardOpen
              ? "bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)"
              : undefined,
          }}
        >
          <ChatComposer
            text={text}
            onTextChange={setText}
            onSend={() => void send()}
            onKeyDown={handleKey}
            onFocus={() => {
              scrollToBottom("keyboard_did_show");
            }}
            disabled={streaming || generating}
            showShortcutChips={showShortcutChips}
            keyboardOpen={keyboardVisible}
            inputRef={inputRef}
            generating={generating}
            streaming={streaming}
            onChipSend={(s) => void send(s)}
          />
        </div>
      </div>
      {isChatKeyboardDebugEnabled() ? (
        <ChatKeyboardDebugOverlay
          active={keyboardVisible}
          composerShellRef={composerRef}
          nativeKeyboardHeightPx={messengerLayout.nativeKeyboardHeightPx}
        />
      ) : null}
    </div>
  );
}
