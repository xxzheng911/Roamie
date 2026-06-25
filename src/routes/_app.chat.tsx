import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";
import {
  isCapacitorNativeShell,
  logChatKeyboardHide,
  logChatKeyboardShow,
  logComposerLayoutSnapshot,
  measureVisualViewportKeyboardInset,
  resolveComposerBottomInset,
} from "@/lib/chat-keyboard-layout";
import { ChatComposer } from "@/components/chat/ChatComposer";
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
import { searchPlaces } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { streamRoamieAI, fetchRoamieAI } from "@/lib/ai/stream-client";
import { RoamieAssistantAvatar } from "@/components/RoamieAssistantAvatar";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { PreferenceQuizCta } from "@/components/PreferenceQuizCta";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromRecommendation } from "@/lib/trip/trip-place-input";
import { logTripNav, tripDetailNavigateOptions, TRIP_DETAIL_ROUTE } from "@/lib/trip/trip-detail-nav";
import {
  consumeTripAddPlaceHandoff,
  fetchTripAddPlaceFollowUpRecommendations,
  fetchTripAddPlaceRecommendations,
  isTripAddPlaceSession,
  markTripAddPlaceHandoffComplete,
  parseTripAddPlaceFollowUpIntent,
  prepareTripAddPlaceSession,
  reinforceTripAddPlaceSession,
  tripAddPlaceRecommendationsToSession,
} from "@/lib/trip/trip-add-place-handoff";
import { appendPlaceToTrip } from "@/lib/trip/append-place-to-trip";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
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
  formatItineraryUserError,
  hasValidItineraryStops,
  isGenerateItineraryFailure,
  ITINERARY_PARTIAL_FAILURE_MESSAGE,
  unwrapGeneratedTripPayload,
} from "@/lib/trip/itinerary-guards";
import { getRecommendation } from "@/lib/recommendation-storage";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import { finalizeChatRecommendationDisplay } from "@/lib/chat-display-recommendations";
import { openRecommendationPlaceDetail } from "@/lib/recommendation-place-handoff";
import {
  buildPlaceDetailFollowUpReply,
  buildPlaceDetailReply,
  enterPlaceDetailChat,
  isPlaceDetailChatActive,
  parsePlaceDetailFollowUp,
  sessionWithPlaceDetailSearchCenter,
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
import { useAccess } from "@/hooks/use-access";
import { usePreferenceQuizCompleted } from "@/hooks/use-preference-quiz-status";
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
import { buildNearbyPlaceRecommendation, restaurantSearchFallbackQueries } from "@/lib/ai/chat-place-recommendation";
import { buildDestinationMustVisitRecommendation, buildAlternativeDestinationRecommendations } from "@/lib/ai/destination-place-recommendation";
import {
  applyRefreshRecommendationSession,
  CHAT_STATE_MACHINE_RECOVERY_MESSAGE,
  collectBlockedCoreNames,
  collectExcludePlaceIds,
  extractRecommendedFromMsgs,
  resolveRefreshNearbyIntent,
  shouldAcceptAlternativeRecommendations,
  shouldRefetchPlaces,
} from "@/lib/ai/chat-recommendation-refresh";
import { NO_MORE_RECOMMENDATIONS_MESSAGE } from "@/lib/ai/place-recommendation-rules";
import { shouldFetchDestinationPlaces, resolveMustVisitDestination, mergeContextForPlaceFetch, buildNamedFallbackRecommendations } from "@/lib/ai/must-visit-places";
import { buildWeatherAwarePlaceIntro, resolveWeatherScene } from "@/lib/ai/weather-place-search";
import { placesStatsPayload } from "@/lib/places-api-stats";
import { resolveChatLocation } from "@/lib/ai/resolve-chat-location";
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
import { prepareDirectItinerarySession } from "@/lib/ai/itinerary-place-fetch";
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

function Chat() {
  const { t, tList, locale } = useI18n();
  const quizCompleted = usePreferenceQuizCompleted();
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
  const messagesRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const keyboardOpenRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const handoffStartedRef = useRef<string | null>(null);
  const planHandoffStartedRef = useRef(false);
  const tripAddPlaceHandoffStartedRef = useRef(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [reportedKeyboardHeightPx, setReportedKeyboardHeightPx] = useState(0);
  const autoPromptHandledRef = useRef(false);
  const homeMoodShortcutEngagedRef = useRef(false);
  const pendingScrollTopRef = useRef<number | null>(null);

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  // 快捷列固定顯示，避免鍵盤開啟/輸入時整條消失。
  const showShortcutChips = true;

  const composerBottomInset = useMemo(
    () =>
      resolveComposerBottomInset({
        keyboardVisible,
        reportedKeyboardHeightPx,
      }),
    [keyboardVisible, reportedKeyboardHeightPx],
  );

  useEffect(() => {
    const el = composerShellRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      console.info("[Chat Composer Shell Height]", h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [keyboardVisible, showShortcutChips]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fetchWeather = useServerFn(getWeather);
  const geocodeLocationFn = useServerFn(geocodeTripLocationFromText);
  const searchNearbyPlacesServerFn = useServerFn(searchPlaces);
  const searchNearbyPlaces = useMemo(
    () => createUnifiedSearchPlacesFn(searchNearbyPlacesServerFn),
    [searchNearbyPlacesServerFn],
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
      const nextSession = applyAdviceResultToSession(
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

  const completeAdviceTurn = useCallback(
    async (
      turn: ChatTurnResult,
      baseSession: ChatPlanningSession,
      context: CanonicalTravelContext,
      conversation: ChatMsg[],
    ) => {
      const updated = persistPlanningAdviceTurn(turn, baseSession);
      const withReply: ChatMsg[] = [...conversation, adviceToAssistantChatMsg(turn.advice)];
      setMsgs(withReply);
      if (turn.advice.triggerItineraryGeneration) {
        await runDirectItineraryRef.current(
          updated,
          { ...context, ...turn.advice.contextPatch },
          withReply,
        );
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
    if (hydrating || session.fromMoodFlow || session.fromMoodCard || session.fromPlusHome) return;
    setMsgs((prev) => {
      if (prev.length === 0) return [greetingMsg];
      if (prev.length === 1 && prev[0].role === "assistant" && !prev[0].roamie) {
        return [greetingMsg];
      }
      return prev;
    });
  }, [greetingMsg, hydrating, session.fromMoodFlow, session.fromMoodCard, session.fromPlusHome]);

  const scrollMessagesToEnd = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);
  const scrollMessagesToEndRef = useRef(scrollMessagesToEnd);
  scrollMessagesToEndRef.current = scrollMessagesToEnd;

  useEffect(() => {
    document.documentElement.classList.toggle("chat-keyboard-open", keyboardVisible);
    return () => {
      document.documentElement.classList.remove("chat-keyboard-open");
    };
  }, [keyboardVisible]);

  useEffect(() => {
    let removeCapKeyboard: (() => void) | undefined;
    const isNativeShell = isCapacitorNativeShell();

    const applyKeyboard = (reportedHeight: number, open: boolean) => {
      keyboardOpenRef.current = open;

      if (open) {
        logChatKeyboardShow(reportedHeight);
      } else {
        logChatKeyboardHide();
      }

      const headerHeightPx = headerRef.current
        ? Math.round(headerRef.current.getBoundingClientRect().height)
        : 0;

      const inset = resolveComposerBottomInset({
        keyboardVisible: open,
        reportedKeyboardHeightPx: reportedHeight,
      });

      logComposerLayoutSnapshot({
        keyboardVisible: open,
        reportedKeyboardHeightPx: reportedHeight,
        composerBottomInsetPx: inset,
        headerHeightPx,
      });

      setKeyboardVisible(open);
      setReportedKeyboardHeightPx(reportedHeight);

      if (open) {
        requestAnimationFrame(() => scrollMessagesToEndRef.current());
      }
    };

    const vv = window.visualViewport;
    const syncFromViewport = () => {
      if (!vv) return;
      const shrink = measureVisualViewportKeyboardInset();
      const capped = Math.min(shrink, Math.round(window.innerHeight * 0.55));
      if (capped > 50) {
        applyKeyboard(capped, true);
        return;
      }
      if (!isNativeShell && keyboardOpenRef.current) {
        applyKeyboard(0, false);
      }
    };

    syncFromViewport();
    vv?.addEventListener("resize", syncFromViewport);
    vv?.addEventListener("scroll", syncFromViewport);

    if (isNativeShell) {
      removeCapKeyboard = subscribeCapacitorKeyboard({
        onShow: (height) => applyKeyboard(height, true),
        onHide: () => applyKeyboard(0, false),
      });
    }

    return () => {
      vv?.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("scroll", syncFromViewport);
      removeCapKeyboard?.();
    };
  }, []);

  useEffect(() => {
    if (!keyboardVisible) return;
    scrollMessagesToEnd();
  }, [keyboardVisible, msgs.length, scrollMessagesToEnd]);

  useEffect(() => {
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
            homeMoodShortcutEngagedRef.current = true;
          }
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
            };
          }
          const mergedMood = mergeTravelContext(moodSession, moodPrompt);
          session = mergedMood.session;
          clearHomeMoodUiSelection();
          persistSession(session);
        } else if (search.from === "plus-home" && hasPlusAccess && !session.fromPlusHome) {
          const prefs = await getPreferences();
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
            const prefs = await getPreferences();
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
        } else if (
          search.from === "trip_add_place" &&
          current.fromTripAddPlace &&
          current.tripAddPlaceContext &&
          current.pendingHandoff &&
          !current.tripAddPlaceHandoffDone &&
          !tripAddPlaceHandoffStartedRef.current
        ) {
          tripAddPlaceHandoffStartedRef.current = true;
          setMsgs([]);
          await runTripAddPlaceHandoff(current);
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
      } catch (e) {
        console.error(e);
      } finally {
        setHydrating(false);
      }
    })();
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
        try {
          await appendPlaceToTrip(
            { kind: "trip", tripId: ctx.tripId },
            tripPlaceFromRecommendation(rec),
            { date: ctx.dateKey, position: "end" },
          );
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
    [session.fromTripAddPlace, session.tripAddPlaceContext, navigate, openAddToTrip],
  );

  const handleSavePlace = async (rec: RoamieRecommendationItem) => {
    markShortcutEngaged();
    setSavingName(rec.name);
    try {
      const { saved } = await toggleSavePlace({
        name: rec.name,
        category: rec.type,
        address: rec.address || null,
        city: session.location?.city ?? null,
        lat: rec.lat ?? null,
        lng: rec.lng ?? null,
        notes: rec.reason,
        mood_tag: session.mood ?? partial.moodTag ?? null,
        cover_image: null,
      });
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
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
      const prefs = await getPreferences();
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
      console.info("[Roamie AI] request context", {
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
      console.info("[Roamie AI] dialogue stage", {
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
        const prefs = await getPreferences();

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
        const prefs = await getPreferences();
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
        console.info("[Roamie] plan handoff ok", formatTripLocationLabel(dest));
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
        const { summary, recommendations } = await fetchTripAddPlaceRecommendations({
          ctx,
          searchPlaces: searchNearbyPlaces,
          locale,
        });
        const sessionWithRecs = tripAddPlaceRecommendationsToSession(handoffSession, recommendations);
        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(sessionWithRecs, "", summary, recommendations);
        const opener: ChatMsg = {
          role: "assistant",
          content: displaySummary,
          roamie: {
            title: "Roamie 推薦",
            summary: displaySummary,
            moodTag: handoffSession.mood ?? ctx.travelStyle ?? "",
            recommendations: filteredRecs,
            itinerary: [],
          },
        };
        setMsgs([opener]);
        persistSession(
          markTripAddPlaceHandoffComplete({
            ...sessionWithRecs,
            recommendedPlaces: filteredRecs as ChatPlaceItem[],
          }),
        );
        console.info("[Roamie] trip add place handoff ok", ctx.tripId, `day=${ctx.selectedDay}`);
      } finally {
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces],
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
      let workingSession = await resolveChatLocation(activeSession);
      const lat = workingSession.location?.lat;
      const lng = workingSession.location?.lng;
      if (lat == null || lng == null) {
        console.warn("[CHAT_PLACES_REQUEST] skipped reason=no_location");
        return false;
      }

      const merged = mergeTravelContext(workingSession, userText);
      workingSession = merged.session;
      const excludePlaceIds =
        opts?.excludePlaceIds ?? collectExcludePlaceIds(workingSession);
      const blockedCoreNames =
        opts?.blockedCoreNames ?? collectBlockedCoreNames(workingSession);

      try {
        const { summary, payload } = await buildNearbyPlaceRecommendation({
          intent,
          lat,
          lng,
          locale,
          context: merged.context,
          searchPlaces: searchNearbyPlaces,
          foodPreference: workingSession.foodPreference,
          excludedCategories:
            workingSession.excludedCategories ?? merged.context.excludedCategories,
          excludePlaceIds,
          rejectedPlaceNames:
            opts?.rejectedPlaceNames ?? workingSession.rejectedPlaceNames,
          priorRecommended: [
            ...workingSession.recommendedPlaces,
            ...extractRecommendedFromMsgs(conversation),
          ],
          blockedCoreNames,
          userText: userText,
          cityLabel:
            opts?.cityLabel ??
            workingSession.location?.city ??
            merged.context.destination,
        });
        const sessionWithIntent: ChatPlanningSession = {
          ...workingSession,
          activeChatIntent: intent,
          phase: "recommend",
          travelContext: {
            ...merged.context,
            excludedCategories:
              workingSession.excludedCategories ?? merged.context.excludedCategories,
          },
        };
        const { summary: displaySummary, recommendations: filteredRecs } =
          finalizeChatRecommendationDisplay(
            sessionWithIntent,
            userText,
            summary,
            payload.recommendations ?? [],
          );
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
              content: displaySummary,
              roamie: {
                ...payload,
                summary: displaySummary,
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
        console.info(
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
    [locale, persistSession, searchNearbyPlaces],
  );

  const pushDestinationPlaceRecommendation = useCallback(
    async (
      activeSession: ChatPlanningSession,
      userText: string,
      conversation: ChatMsg[],
      opts?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[] },
    ): Promise<boolean> => {
      const merged = mergeTravelContext(activeSession, userText);
      const placeCtx = mergeContextForPlaceFetch(merged.context, activeSession);
      const destination = shouldFetchDestinationPlaces(userText, placeCtx)
        ? resolveMustVisitDestination(placeCtx, userText)
        : undefined;
      if (!destination) return false;

      const excludePlaceIds =
        opts?.excludePlaceIds ?? collectExcludePlaceIds(activeSession);
      const rejectedPlaceNames =
        opts?.rejectedPlaceNames ?? activeSession.rejectedPlaceNames;

      const renderDestinationReply = (
        summary: string,
        recommendations: RoamieRecommendationItem[],
        payload: RoamiePayloadV2,
        contextPatch: Partial<CanonicalTravelContext>,
      ) => {
        const sessionWithRecs: ChatPlanningSession = {
          ...merged.session,
          activeChatIntent: "destination_advice",
          conversationMode: "destination_planning",
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
        if (!recs.length && !displaySummary.trim()) {
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
                recommendations: recs,
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
      };

      setStreaming(true);
      try {
        const { summary, recommendations, payload, contextPatch } =
          await buildDestinationMustVisitRecommendation({
            destination,
            userText,
            context: { ...placeCtx, destination },
            locale,
            searchPlaces: searchNearbyPlaces,
            geocodeFn: geocodeLocationFn,
            fetchWeatherFn: fetchWeather,
            excludePlaceIds,
            rejectedPlaceNames,
          });

        return renderDestinationReply(summary, recommendations, payload, contextPatch);
      } catch (error) {
        console.warn(
          "[CHAT_PLACES_ERROR]",
          error instanceof Error ? error.message : String(error),
        );
        const label = destination;
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
          moodTag: placeCtx.mood ?? "",
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
        setStreaming(false);
      }
    },
    [locale, persistSession, searchNearbyPlaces, geocodeLocationFn, fetchWeather],
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
      console.info(`[CHAT_FALLBACK_USED] reason=${reason}`);

      if (isPlaceDetailChatActive(activeSession)) {
        return false;
      }

      if (isTripAddPlaceSession(activeSession) && activeSession.tripAddPlaceContext) {
        const followUp = parseTripAddPlaceFollowUpIntent(activeUserText);
        if (followUp) {
          const reinforced = reinforceTripAddPlaceSession(activeSession, activeUserText);
          const { summary, recommendations } = await fetchTripAddPlaceFollowUpRecommendations({
            ctx: reinforced.tripAddPlaceContext!,
            intent: followUp,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
          const sessionWithRecs = tripAddPlaceRecommendationsToSession(reinforced, recommendations);
          const { summary: displaySummary, recommendations: filteredRecs } =
            finalizeChatRecommendationDisplay(sessionWithRecs, activeUserText, summary, recommendations);
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
                  title: "Roamie 推薦",
                  summary: displaySummary,
                  moodTag: sessionWithRecs.mood ?? "",
                  recommendations: filteredRecs,
                  itinerary: [],
                },
              },
            ];
          });
          persistSession({
            ...sessionWithRecs,
            recommendedPlaces: filteredRecs as ChatPlaceItem[],
            activeChatIntent: followUp,
          });
          setPartial({});
          return true;
        }
        return false;
      }

      const mergedForAdvice = mergeTravelContext(activeSession, activeUserText);

      if (shouldFetchDestinationPlaces(activeUserText, mergedForAdvice.context)) {
        const applied = await pushDestinationPlaceRecommendation(
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
      if (planningTurn.advice.reply) {
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

      const advice = resolveDestinationAdvice(
        mergedForAdvice.context,
        mergedForAdvice.session,
        activeUserText,
      );
      if (advice.reply) {
        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          return [...trimmedPrev, adviceToAssistantChatMsg(advice)];
        });
        persistSession(
          applyAdviceResultToSession(
            {
              ...mergedForAdvice.session,
              pendingQuestion: advice.pendingQuestion,
              lastResolvedPendingQuestion: undefined,
              adviceSelectionThisTurn: undefined,
              phase:
                advice.contextPatch?.conversationState === "ready_for_itinerary"
                  ? "ready"
                  : mergedForAdvice.session.phase,
            },
            advice,
          ),
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
      const lat = activeSession.location?.lat;
      const lng = activeSession.location?.lng;
      const resolvedIntent = resolveChatIntent(activeUserText, activeSession);
      const isRestaurantFlow =
        activeSession.activeChatIntent === "restaurant" || resolvedIntent === "restaurant";
      const isCampingFlow =
        activeSession.activeChatIntent === "camping" ||
        resolvedIntent === "camping" ||
        context.activity === "camping";

      if (lat != null && lng != null) {
        const attempts = isRestaurantFlow
          ? restaurantSearchFallbackQueries(activeSession.foodPreference)
          : isCampingFlow
            ? campingSearchAttempts()
            : [{ query: fallbackSearchQuery(context), mode: "text" as const }];
        for (const attempt of attempts) {
          try {
            console.info(
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
              },
            });
            placeResults = fallback.places ?? [];
            if (isCampingFlow) {
              placeResults = filterCampingPlaces(placeResults);
            }
            console.info(`[CHAT_PLACES_SUCCESS] count=${placeResults.length}`);
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
      if (!filteredRecs.length) {
        return false;
      }
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
              recommendations: filteredRecs,
            },
          },
        ];
      });
      const nextSession = syncSessionPlaceMemory({
        ...sessionForDisplay,
        recommendedPlaces: filteredRecs as ChatPlaceItem[],
      });
      persistSession(nextSession);
      setPartial({});
      return filteredRecs.length > 0;
    },
    [locale, persistSession, searchNearbyPlaces, pushNearbyPlaceRecommendation, pushDestinationPlaceRecommendation, persistPlanningAdviceTurn, completeAdviceTurn],
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
        console.info("[AI_REPLY_REQUEST]", `phase=${req.chatPhase ?? "unknown"}`);

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
        console.info("[AI_REPLY_SUCCESS]", `recommendations=${full.recommendations?.length ?? 0}`);

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
          const advice = resolveDestinationAdvice(
            fallbackMerged.context,
            fallbackMerged.session,
            activeUserText,
          );
          if (advice.reply) {
            setMsgs((prev) => {
              const trimmedPrev = prev.filter(
                (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
              );
              return [...trimmedPrev, adviceToAssistantChatMsg(advice)];
            });
            persistSession(
              applyAdviceResultToSession(
                {
                  ...fallbackMerged.session,
                  pendingQuestion: advice.pendingQuestion,
                  lastResolvedPendingQuestion: undefined,
                  adviceSelectionThisTurn: undefined,
                  phase:
                    advice.contextPatch?.conversationState === "ready_for_itinerary"
                      ? "ready"
                      : fallbackMerged.session.phase,
                },
                advice,
              ),
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
              ) ?? "我這邊連線有點不穩，但我還記得你的行程需求，可以再說一次想調整什麼。",
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
    [buildRequest, session, persistSession, locale, applyLocalFallback],
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

  const handleDiscussPlace = (rec: RoamieRecommendationItem) => {
    if (streaming || generating) return;
    markShortcutEngaged();
    const item = roamieRecToChatItem(rec);
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
  };

  const send = async (
    overrideText?: string,
    opts?: { source?: "user" | "auto" },
  ) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || streaming || generating) return;

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

      if (followUp === "nearby_cafe" || followUp === "nearby_late_snack") {
        const centered = sessionWithPlaceDetailSearchCenter(session);
        const nearbyIntent = followUp === "nearby_cafe" ? "cafe" : "restaurant";
        const nextSession = {
          ...centered,
          activeChatIntent: nearbyIntent,
          phase: "recommend" as const,
        };
        persistSession(nextSession);
        const preface = buildPlaceDetailFollowUpReply(followUp, nextSession);
        const conversationWithPreface = preface
          ? [...baseConversation, { role: "assistant", content: preface }]
          : baseConversation;
        if (preface) setMsgs(conversationWithPreface);
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

    if (isTripAddPlaceSession(session) && session.tripAddPlaceContext) {
      markShortcutEngaged();
      const userMsg: ChatMsg = { role: "user", content: trimmed };
      const baseConversation = [...msgs, userMsg];
      setMsgs(baseConversation);
      setText("");

      let nextSession = reinforceTripAddPlaceSession(session, trimmed);
      const followUp = parseTripAddPlaceFollowUpIntent(trimmed);
      if (followUp) {
        nextSession = { ...nextSession, activeChatIntent: followUp, phase: "recommend" };
      }
      persistSession(nextSession);

      if (followUp) {
        setStreaming(true);
        try {
          const { summary, recommendations } = await fetchTripAddPlaceFollowUpRecommendations({
            ctx: nextSession.tripAddPlaceContext!,
            intent: followUp,
            searchPlaces: searchNearbyPlaces,
            locale,
          });
          const sessionWithRecs = tripAddPlaceRecommendationsToSession(nextSession, recommendations);
          const { summary: displaySummary, recommendations: filteredRecs } =
            finalizeChatRecommendationDisplay(
              sessionWithRecs,
              trimmed,
              summary,
              recommendations,
            );
          persistSession({
            ...sessionWithRecs,
            recommendedPlaces: filteredRecs as ChatPlaceItem[],
            activeChatIntent: followUp,
          });
          setMsgs([
            ...baseConversation,
            {
              role: "assistant",
              content: displaySummary,
              roamie: {
                title: "Roamie 推薦",
                summary: displaySummary,
                moodTag: sessionWithRecs.mood ?? "",
                recommendations: filteredRecs,
                itinerary: [],
              },
            },
          ]);
        } finally {
          setStreaming(false);
        }
        return;
      }

      await streamChat(baseConversation, { phase: "followup", userText: trimmed }, nextSession);
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

    nextSession = extractPlanningHintsFromText(trimmed, nextSession);
    nextSession = extractDiscoveryFromText(trimmed, nextSession);
    nextSession = extractChatPlanningContextFromText(trimmed, nextSession);

    try {
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
      const priorFromMsgs = extractRecommendedFromMsgs(msgs);
      if (priorFromMsgs.length && !nextSession.recommendedPlaces.length) {
        nextSession = syncSessionPlaceMemory({
          ...nextSession,
          recommendedPlaces: priorFromMsgs,
        });
      }
      const refreshCtx = {
        ...(nextSession.travelContext ?? merged.context),
        tripPurpose: "refresh_recommendations" as const,
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
          const applied = await pushDestinationPlaceRecommendation(
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

    if (shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx)) {
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

    if (
      isPlanningTurnActive(nextSession, merged.context) ||
      isDestinationPlanningSession(nextSession, merged.context)
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

    if (intent === "destination_advice" || intent === "trip_planning") {
      nextSession = {
        ...nextSession,
        activeChatIntent: intent === "destination_advice" ? "destination_advice" : nextSession.activeChatIntent,
        conversationMode: "destination_planning",
      };
    }

    if (isFoodPreferenceReply(trimmed) && nextSession.activeChatIntent === "restaurant") {
      const food = parseFoodPreference(trimmed);
      if (food) nextSession = { ...nextSession, foodPreference: food };
    }

    const effectiveConversationMode =
      nextSession.conversationMode ?? conversationMode;

    const inferredNearbyIntent =
      effectiveConversationMode === "destination_planning" ||
      effectiveConversationMode === "place_focus" ||
      intent === "destination_advice" ||
      intent === "trip_planning"
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
      shouldAskRestaurantCuisine(nextSession) &&
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
      conversationMode === "destination_planning"
        ? null
        : (isNearbyPlaceIntent(intent) ? intent : null) ??
          (nextSession.activeChatIntent && isNearbyPlaceIntent(nextSession.activeChatIntent)
            ? nextSession.activeChatIntent
            : null) ??
          inferredNearbyIntent;

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
    persistSession({ ...activeSession, phase: "generating" });

    try {
      const bundle = activeSession.tripDestination
        ? await buildContextBundleForTrip(activeSession.tripDestination, fetchWeather)
        : await buildClientContextBundle(fetchWeather);
      const [prefs, profile] = await Promise.all([getPreferences(), getUserProfile()]);
      const fashionStyle = resolveFashionStyle({
        travelStyle: profile.travelStyle,
        interests: prefs.interests,
        style: activeSession.tripStyles || (activeSession.pace === "排滿" ? "緊湊" : "慢旅行"),
      });
      const places = buildTripFromSelectedPlaces(activeSession);
      const destination =
        (activeSession.tripDestination
          ? formatTripLocationLabel(activeSession.tripDestination)
          : null) ||
        inferDestinationFromPlaces(places, bundle.location) ||
        bundle.location.city ||
        "目前位置";
      const today = new Date().toISOString().slice(0, 10);
      const startDate = activeSession.tripStartDate || today;
      const endDate = activeSession.tripEndDate || activeSession.tripStartDate || today;
      const tripDays = activeSession.tripDays ?? 1;
      const budget = budgetModeToItineraryTier(resolveBudgetMode(prefs));

      const generateResult = await generate({
        data: {
          destination,
          days: tripDays,
          budget,
          style: activeSession.tripStyles || (activeSession.pace === "排滿" ? "緊湊" : "慢旅行"),
          mood: activeSession.mood ?? "",
          interests: buildConversationSummary(activeSession, activeMsgs),
          conversationSummary: buildConversationSummary(activeSession, activeMsgs),
          startDate,
          endDate,
          origin: activeSession.tripOrigin
            ? formatTripLocationLabel(activeSession.tripOrigin)
            : (bundle.location.city ?? ""),
          travelers: activeSession.tripCompanionCount ?? 1,
          transport: activeSession.transportation ?? "",
          selectedPlaces: places.map((p) => ({
            ...p,
            googlePlaceId: p.googlePlaceId ?? p.placeId,
          })),
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: activeSession.startTime || bundle.time,
          fashionStyle: fashionStyle ?? "",
          locale,
        },
      });

      if (isGenerateItineraryFailure(generateResult)) {
        setMsgs((prev) => [
          ...prev,
          { role: "assistant", content: generateResult.message },
        ]);
        toast.error(generateResult.message);
        persistSession({ ...activeSession, phase: "collect" });
        return;
      }

      const itinerary = unwrapGeneratedTripPayload(generateResult);
      if (!itinerary || !hasValidItineraryStops(itinerary, 1)) {
        setMsgs((prev) => [
          ...prev,
          { role: "assistant", content: ITINERARY_PARTIAL_FAILURE_MESSAGE },
        ]);
        toast.error(ITINERARY_PARTIAL_FAILURE_MESSAGE);
        persistSession({ ...activeSession, phase: "collect" });
        return;
      }

      const itineraryStops = coalesceItineraryItems(itinerary.itinerary);
      const legPlaces = itineraryStops
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
      const routeLegs = await getTripLegsWithDurations(
        legPlaces,
        travelLabelToRoutesMode(activeSession.transportation ?? "步行"),
      );
      const weatherSummary = bundle.weather
        ? `${bundle.weather.city} ${bundle.weather.condition} ${bundle.weather.tempC ?? ""}C`
        : "天氣資料暫不可用";
      const outfitSuggestion = generateOutfitSuggestion(
        {
          destinationPlace: { name: destination },
          startDate,
          endDate,
          transportMode: activeSession.transportation ?? "walk",
        },
        normalizeWeather(bundle.weather),
      );
      const cover = await getTripCoverImage({
        destination,
        mood: activeSession.mood ?? "",
        moodTag: activeSession.mood ?? "",
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
          tripStartDate: startDate,
          tripEndDate: endDate,
          transport: activeSession.transportation === "開車"
            ? "drive"
            : activeSession.transportation === "大眾運輸"
              ? "transit"
              : activeSession.transportation === "機車"
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
      console.info("[CORE_TRIP] created", "draft");
      saveDraftTrip(draftPayload);

      const isPlanAi = activeSession.fromPlanAi || activeSession.planAiMode;

      if (isPlanAi) {
        const saved = await confirmSaveTrip(draftPayload, "chat");
        clearDraftTrip();
        clearPlanFormDraft();
        persistSession({
          ...activeSession,
          phase: "done",
          draftTrip: undefined,
          lastGeneratedTripId: saved.id,
        });
        toast.success("行程已建立");
        logTripNav("PlanAiGenerated", saved.id);
        navigate(tripDetailNavigateOptions(saved.id));
        return;
      }

      const doneSession: ChatPlanningSession = {
        ...activeSession,
        phase: "done",
        draftTrip: draftPayload,
        lastGeneratedTripId: undefined,
      };
      persistSession(doneSession);

      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: `${itinerary.summary}\n\n這是一趟行程草稿，還沒存進收藏。滿意的話可以按「儲存這趟行程」。`,
        roamie: {
          ...draftPayload,
          itinerary: itineraryStops,
          outfitAdvice: itinerary.outfitAdvice,
        },
      };
      setMsgs((prev) => [...prev, assistantMsg]);
      toast.message("行程草稿已產生，確認後可儲存到收藏");
    } catch (e) {
      console.warn("[ITINERARY_GENERATE]", e);
      persistSession({ ...activeSession, phase: "collect" });
      const userMessage = formatItineraryUserError(e);
      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: userMessage },
      ]);
      toast.error(userMessage);
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
      const prepared = await prepareDirectItinerarySession({
        session: activeSession,
        context,
        locale,
        searchPlaces: searchNearbyPlaces,
        geocodeFn: geocodeLocationFn,
        fetchWeatherFn: fetchWeather,
        excludePlaceIds: collectExcludePlaceIds(activeSession),
      });
      if (!prepared.ok) {
        setMsgs([
          ...conversation,
          { role: "assistant", content: prepared.message },
        ]);
        persistSession({
          ...activeSession,
          phase: "collect",
          pendingQuestion: undefined,
        });
        return;
      }
      persistSession(prepared.session);
      await handleGenerateItinerary(prepared.session, conversation);
    } catch (e) {
      console.warn("[ITINERARY_DIRECT_GEN]", e);
      const userMessage = formatItineraryUserError(e);
      setMsgs([
        ...conversation,
        { role: "assistant", content: userMessage },
      ]);
      toast.error(userMessage);
      persistSession({ ...activeSession, phase: "collect" });
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

      const fresh = createEmptySession();
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

  const hasDraftTrip = Boolean(session.draftTrip ?? loadDraftTrip());
  const isPlanAiMode = Boolean(session.fromPlanAi || session.planAiMode);
  const showGenerateBtn =
    (isPlanAiMode
      ? canGenerateItinerary(session)
      : session.phase === "ready" &&
        session.selectedPlaces.length > 0) &&
    !streaming &&
    !generating &&
    !hasDraftTrip;
  const showSaveTripBtn = hasDraftTrip && !streaming && !generating;

  const handleConfirmSaveTrip = async () => {
    const draft = session.draftTrip ?? loadDraftTrip();
    if (!draft) return;
    try {
      const saved = await confirmSaveTrip(draft, "chat");
      clearDraftTrip();
      persistSession({
        ...session,
        draftTrip: undefined,
        lastGeneratedTripId: saved.id,
      });
      toast.success(t("chat.savedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("chat.saveFailed"));
    }
  };

  const discoverChips = useMemo(() => tList("chat.chipsDiscover"), [tList]);

  const chatChips = useMemo(() => {
    if (isPlanAiMode) return tList("chat.chipsPlan");
    if (session.phase === "discover") return discoverChips;
    if (session.phase === "collect" && session.selectedPlaces.length > 0) {
      return tList("chat.chipsCollectReady");
    }
    return tList("chat.chipsCollectDefault");
  }, [isPlanAiMode, session.phase, session.selectedPlaces.length, discoverChips, tList]);

  return (
    <div
      className={cn(
        "chat-page relative flex h-full min-h-0 flex-1 flex-col overflow-hidden",
        !keyboardVisible && "pb-[var(--app-nav-total-height)]",
      )}
    >
      <header
        ref={headerRef}
        className="relative z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur"
      >
        <BackButton
          preferFallback
          fallback={
            session.fromTripAddPlace && session.tripAddPlaceContext
              ? {
                  to: TRIP_DETAIL_ROUTE,
                  params: { tripId: session.tripAddPlaceContext.tripId },
                  search: { day: session.tripAddPlaceContext.selectedDay },
                }
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

      <div className="chat-keyboard-column flex min-h-0 flex-1 flex-col">
        <div
          ref={messagesRef}
          className="chat-messages min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5"
        >
          {hasPlusAccess && quizCompleted === false && (
            <PreferenceQuizCta origin="chat" variant="banner" className="animate-rise" />
          )}
          {hydrating && (
            <div className="flex justify-center pt-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!hydrating &&
            msgs.map((m, i) => (
              <div
                key={i}
                className={`flex animate-rise ${m.role === "user" ? "justify-end" : "justify-start gap-2.5"}`}
              >
                {m.role === "assistant" ? (
                  <RoamieAssistantAvatar className="h-8 w-8 self-end" />
                ) : null}
                <div
                  className={`max-w-[88%] rounded-3xl px-4 py-3 ${
                    m.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md border border-border bg-card"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
                  ) : m.roamie || (streaming && i === msgs.length - 1 && partial.summary) ? (
                    <RoamieResponseView
                      data={m.roamie ?? partial}
                      compact
                      recommendationsPreFiltered
                      onRecommendationEngage={markShortcutEngaged}
                      showItinerary={
                        session.phase === "done" && (m.roamie?.itinerary?.length ?? 0) > 0
                      }
                      onSavePlace={handleSavePlace}
                      onAddToTrip={(rec) => {
                        void handleAddToTripFromChat(rec);
                      }}
                      onOpenPlaceDetail={handleOpenPlaceDetail}
                      onDiscussPlace={handleDiscussPlace}
                      outfitAdvice={m.roamie?.outfitAdvice}
                      selectedPlaceNames={selectedNames}
                      savingPlaceName={savingName}
                      savedPlaceNames={savedNames}
                      addToTripLabel={t("chat.addToTrip")}
                      discussPlaceLabel={t("trip.discussPlace")}
                      viewMapLabel={t("chat.viewMap")}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                      {m.content || (
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
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
          <div ref={bottomRef} />
        </div>

        <div
          ref={composerShellRef}
          className="chat-composer-shell shrink-0 transition-[padding-bottom] duration-200 ease-out"
          style={{
            paddingBottom: `calc(max(6px, env(safe-area-inset-bottom, 0px)) + ${
              keyboardVisible ? composerBottomInset : 0
            }px)`,
          }}
        >
          <div className="chat-keyboard-follow-group">
            <ChatComposer
              text={text}
              onTextChange={setText}
              onSend={() => void send()}
              onKeyDown={handleKey}
              onFocus={() => {
                requestAnimationFrame(scrollMessagesToEnd);
              }}
              disabled={streaming || generating}
              showShortcutChips={showShortcutChips}
              keyboardOpen={keyboardVisible}
              inputRef={inputRef}
              showGenerateBtn={showGenerateBtn}
              generating={generating}
              streaming={streaming}
              showSaveTripBtn={showSaveTripBtn}
              hasDraftTrip={hasDraftTrip}
              lastGeneratedTripId={session.lastGeneratedTripId}
              chatChips={chatChips}
              generateBtnLabel={
                isPlanAiMode ? t("chat.generateFullItinerary") : undefined
              }
              onChipSend={(s) => void send(s)}
              onGenerateClick={() =>
                void (isPlanAiMode
                  ? handleGenerateItinerary()
                  : send("就這樣吧，可以開始安排"))
              }
              onSaveTrip={() => void handleConfirmSaveTrip()}
              onViewDraft={() => navigate({ to: "/trip", search: { draft: "1" } })}
              onViewSavedTrip={(tripId) => {
                logTripNav("ChatGeneratedTrip", tripId);
                navigate(tripDetailNavigateOptions(tripId));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
