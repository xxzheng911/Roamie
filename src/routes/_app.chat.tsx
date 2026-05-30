import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import {
  estimateNativeKeyboardHeight,
  isCapacitorNativeShell,
  logComposerLayoutSnapshot,
  measureVisualViewportKeyboardInset,
  parseKeyboardEventHeight,
  resolveComposerBottomInset,
} from "@/lib/chat-keyboard-layout";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { setIosSnapshotLiveInteractionForced, requestIosSnapshotRefresh, ensureIosLoginLiveInteraction } from "@/lib/ios-snapshot-bridge";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadChatHistory, clearChatHistory, type ChatMsg } from "@/lib/chat-history";
import { readBootstrapDeviceLocation } from "@/lib/device-location";
import { resolveEffectiveDeviceCoords } from "@/lib/effective-device-location";
import { isValidDeviceCoordinate } from "@/lib/geo";
import { getFreshDeviceLocationSnapshot } from "@/lib/location-store";
import { buildClientContextBundle, toRoamieRequest, type ClientContextBundle } from "@/lib/fetch-context";
import { enrichRoamieContext } from "@/lib/ai/enrich-context";
import { resolveAiUserIntent, responseModeForIntent } from "@/lib/ai/user-intent";
import { resolveEffectivePlanTierWithProfile } from "@/lib/access/resolve";
import { getWeather, getWeatherForecast } from "@/lib/weather.functions";
import { bindWeatherServerFns } from "@/services/weatherService";
import { searchPlaces } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { streamRoamieAI, fetchRoamieAI } from "@/lib/ai/stream-client";
import {
  chatApiMisconfigUserMessage,
  chatApiResolvedUrl,
  isChatApiUnreachableOnNative,
} from "@/lib/chat-api-ready";
import { RoamieAssistantAvatar } from "@/components/RoamieAssistantAvatar";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { RecommendationDiagnosticsToolbar } from "@/components/debug/RecommendationDiagnosticsToolbar";
import { isDiagnosticsModeEnabled } from "@/lib/debug/recommendation-diagnostics";
import { PreferenceQuizCta } from "@/components/PreferenceQuizCta";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromRecommendation } from "@/lib/trip/trip-place-input";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";
import { buildOutfitInputKey, buildTripItemsFingerprint } from "@/lib/outfit/trip-outfit-context";
import { generateItinerary, type ItineraryInput } from "@/lib/itinerary.functions";
import {
  generateItineraryViaBundledApi,
  shouldUseBundledGenerateItineraryApi,
} from "@/lib/generate-itinerary-api";
import { confirmSaveTrip } from "@/lib/itinerary-storage";
import { clearDraftTrip, loadDraftTrip } from "@/lib/trip-draft-storage";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { getRecommendation } from "@/lib/recommendation-storage";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import { recommendationsForChatDisplay } from "@/lib/chat-display-recommendations";
import {
  appendAssistantToConversation,
  buildAssistantChatMsg,
  CHAT_PIPELINE_FALLBACK,
  conversationMissingAssistantReply,
  resolveInstantChatReply,
} from "@/lib/chat/chat-pipeline";
import {
  loadMoodChatMessages,
  moodChatThreadKey,
  persistMoodChatMessages,
  clearMoodChatMessages,
} from "@/lib/mood-chat-ui-persist";
import { openPlaceNavigation } from "@/lib/maps-navigation";
import {
  filterPlaceDiscussionRecommendations,
  PLACE_DISCUSSION_USER_INTENT,
} from "@/lib/chat-place-discussion";
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
import { buildPlanTripHandoffOpening, markPlanHandoffComplete } from "@/lib/plan-trip-handoff";
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
import {
  mergeTravelContext,
  EMPTY_TRAVEL_CONTEXT,
  parseTravelContextFromText,
  formatTravelContextForAi,
  isReadyForRecommendation,
} from "@/lib/ai/travel-context";
import { buildTravelAdviceFallbackReply } from "@/lib/ai/travel-advice-fallback";
import {
  buildChatFallbackReply,
  isAiChatServiceUnavailableError,
} from "@/lib/ai/local-chat-fallback";
import { markAskedClarifyKey, resolveChatRoute } from "@/lib/ai/chat-router";
import {
  formatConversationIntentForAi,
  parseConversationIntent,
  shouldUseCompanionAiReply,
} from "@/lib/ai/conversation-intent";
import {
  fallbackSearchQuery,
  generateLocalRecommendationFallback,
} from "@/lib/ai/local-recommendation-fallback";
import {
  buildLocalItineraryFallback,
  isAiItineraryServiceUnavailableError,
} from "@/lib/ai/local-itinerary-fallback";
import {
  isMoodGroundedChatSession,
  resolveMoodGroundedRecommendations,
  shouldReplaceAiWithMoodGrounded,
} from "@/lib/mood-chat-recommendations";
import { searchPlacesWithMoodFallback } from "@/lib/places-mood-search";
import { dedupeRoamieRecommendations } from "@/lib/recommendation-dedupe";
import { filterVerifiedRecommendations } from "@/lib/place-verification";
import { withSearchTimeout } from "@/lib/search-timeout";
import { getTripLegsWithDurations, travelLabelToRoutesMode } from "@/services/routesService";
import { getTripCoverImage } from "@/services/placeImageService";
import {
  ensureSelectedPlacesInItinerary,
  inferPlaceSelectionSource,
  isPlaceAlreadySelected,
  normalizePlacesForItinerary,
  recordItineraryDiagnostics,
  selectedPlacesDiagnosticsSnapshot,
  type PlaceSelectionSource,
} from "@/lib/trip-planning-state";
import {
  homeMoodPrompt,
  resolveChatEntry,
  sessionForDefaultTab,
  sessionForHomeMoodEntry,
} from "@/lib/chat-entry";

type ChatSearch = {
  from?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
  mood?: string;
  prompt?: string;
};

export const Route = createFileRoute("/_app/chat")({
  validateSearch: (s: Record<string, unknown>): ChatSearch => ({
    from: typeof s.from === "string" ? s.from : undefined,
    recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
    fromMoodFlow: typeof s.fromMoodFlow === "string" ? s.fromMoodFlow : undefined,
    mood: typeof s.mood === "string" ? s.mood : undefined,
    prompt: typeof s.prompt === "string" ? s.prompt : undefined,
  }),
  component: Chat,
});

/** 固定快捷選項（不依 session.phase 切換） */
const CHAT_SHORTCUT_CHIPS = ["我今天有點累", "想找安靜的咖啡廳", "下雨天可以去哪"] as const;

/** 快捷 chip 顯示文字 → 實際送出的使用者訊息 */
const CHIP_OUTBOUND_TEXT: Record<string, string> = {
  今天想放鬆走走: "我今天想放鬆走走，請推薦適合放鬆、步調輕鬆的地點。",
  想探索新地方: "我想探索新地方，請推薦我還沒去過、值得逛逛的地點。",
  主要是想拍照: "我主要是想拍照，請推薦景色好看、適合拍照的地點。",
  一個人: "我一個人出門，請推薦適合獨自走走的地點。",
  跟朋友: "我跟朋友一起，請推薦適合小團體、好聊天的地點。",
  室內就好: "我想待在室內，請推薦室內景點或可以躲雨的地方。",
  想去室外: "我想去室外走走，請推薦戶外、空氣好的地點。",
  "就這樣吧，可以開始安排": "就這樣吧，可以開始安排行程。",
  想再加一個咖啡廳: "我想再加一個咖啡廳到行程裡。",
  節奏慢一點: "希望行程節奏慢一點，不要太趕。",
  我今天有點累: "我今天有點累，請推薦輕鬆、不用走太多的地點。",
  想找安靜的咖啡廳: "我想找安靜的咖啡廳，適合休息或看書。",
  下雨天可以去哪: "下雨天可以去哪？請推薦室內或適合雨天的地點。",
};

const ADVANCED_PLANNING_CHIP_ID = "手動規劃";
const ADVANCED_PLANNING_USER_TEXT = "我想進階手動規劃行程";
const ADVANCED_PLANNING_ASSISTANT_TEXT =
  "好呀，那這次你想從哪裡開始規劃？目的地、日期，還是想去的地方？";

function hasMeaningfulRoamiePayload(data: Partial<RoamieResponse> | undefined): boolean {
  if (!data) return false;
  if (data.summary?.trim()) return true;
  if ((data.recommendations?.length ?? 0) > 0) return true;
  if ((data.itinerary?.length ?? 0) > 0) return true;
  return false;
}

function withChatSummaryFallback(full: RoamieResponse, userText: string): RoamieResponse {
  if (full.summary?.trim()) return full;
  const snippet = userText.trim().slice(0, 40);
  return {
    ...full,
    summary: snippet ? `收到，我會依「${snippet}」幫你想下一步。` : "好的，我來幫你整理一下。",
  };
}

/** 後續訊息優先沿用 session 定位，避免每次 send 都重新等 GPS */
async function resolveContextBundleForSession(
  synced: ChatPlanningSession,
  fetchWeatherFn: (args: {
    data: { lat: number; lng: number; locale?: import("@/lib/i18n/types").Locale };
  }) => Promise<{ weather: import("@/lib/weather-types").WeatherSummary | null; error: string | null }>,
): Promise<ClientContextBundle> {
  if (synced.tripDestination) {
    return buildContextBundleForTrip(synced.tripDestination, fetchWeatherFn);
  }
  const hasSessionCoords =
    synced.location?.lat != null &&
    synced.location?.lng != null &&
    isValidDeviceCoordinate(synced.location.lat, synced.location.lng);
  if (hasSessionCoords) {
    const preferences = await getPreferences();
    return {
      preferences,
      location: synced.location!,
      weather: synced.weather ?? null,
      time: new Date().toISOString(),
      usedFallbackLocation: false,
    };
  }
  return buildClientContextBundle(fetchWeatherFn);
}

function replaceTrailingAssistantMessage(
  prev: ChatMsg[],
  content: string,
  roamie?: Partial<RoamieResponse>,
): ChatMsg[] {
  const trimmedPrev = prev.filter(
    (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content?.trim()),
  );
  return [
    ...trimmedPrev,
    {
      role: "assistant",
      content,
      ...(roamie ? { roamie } : {}),
    },
  ];
}

function applyTravelAdviceFallbackToMsgs(
  prev: ChatMsg[],
  userText: string,
  activeSession: ChatPlanningSession,
): ChatMsg[] {
  const tripIntent = parseTripIntentFromText(userText, activeSession);
  const aiIntent = resolveAiUserIntent(activeSession, userText, tripIntent);
  const summary = buildTravelAdviceFallbackReply(userText, activeSession, aiIntent);
  return replaceTrailingAssistantMessage(prev, summary, {
    title: "",
    summary,
    moodTag: activeSession.mood ?? "",
    recommendations: [],
    itinerary: [],
  });
}

function withChatTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(onAbort, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function Chat() {
  useIosInteractiveRoute("chat");
  useEffect(() => {
    ensureIosLoginLiveInteraction();
    setIosSnapshotLiveInteractionForced(true);
    requestIosSnapshotRefresh("chat-mount", { force: true });
  }, []);

  const { t, locale } = useI18n();
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
  msgsRef.current = msgs;
  const [session, setSession] = useState<ChatPlanningSession>(() => loadChatSession());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  /** 心情／推薦開場載入中（不鎖輸入框，與 AI streaming 分離） */
  const [openerLoading, setOpenerLoading] = useState(false);
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
  const homeMoodOpenerStartedRef = useRef<string | null>(null);
  const planHandoffStartedRef = useRef(false);
  const chatInitKeyRef = useRef<string | null>(null);
  const busySinceRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  const generatingRef = useRef(false);
  streamingRef.current = streaming;
  generatingRef.current = generating;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [reportedKeyboardHeightPx, setReportedKeyboardHeightPx] = useState(0);
  /** 鍵盤動畫結束後強制重算 composer inset（native resize 後 clearance 才準） */
  const [composerLayoutRev, setComposerLayoutRev] = useState(0);
  const [composerPadPx, setComposerPadPx] = useState(140);
  const autoPromptHandledRef = useRef(false);
  const preservedChatRestoredRef = useRef(false);
  const keyboardLayoutRef = useRef({ visible: false, height: 0 });
  const composerPadRef = useRef(140);
  const scrollEndScheduledRef = useRef(false);

  // 快捷列固定顯示，避免鍵盤開啟/輸入時整條消失。
  const showShortcutChips = true;

  const composerBottomInset = useMemo(
    () =>
      resolveComposerBottomInset({
        keyboardVisible,
        reportedKeyboardHeightPx,
        composerShellEl: composerShellRef.current,
      }),
    [keyboardVisible, reportedKeyboardHeightPx, composerLayoutRev],
  );

  useEffect(() => {
    const el = composerShellRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      const nextPad = h + 10;
      if (nextPad === composerPadRef.current) return;
      composerPadRef.current = nextPad;
      setComposerPadPx(nextPad);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [keyboardVisible, showShortcutChips]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fetchWeather = useServerFn(getWeather);
  const fetchForecastFn = useServerFn(getWeatherForecast);
  const searchPlacesServerFn = useServerFn(searchPlaces);
  const searchNearbyPlaces = useMemo(
    () => createUnifiedSearchPlacesFn(searchPlacesServerFn),
    [searchPlacesServerFn],
  );
  const generate = useServerFn(generateItinerary);

  useEffect(() => {
    bindWeatherServerFns({
      fetchWeather: fetchWeather,
      fetchForecast: fetchForecastFn,
    });
  }, [fetchWeather, fetchForecastFn]);

  const selectedNames = useMemo(
    () => new Set(session.selectedPlaces.map((p) => p.name)),
    [session.selectedPlaces],
  );

  const moodThreadKey = useMemo(
    () => moodChatThreadKey(search),
    [search.from, search.mood, search.recommendationId, search.fromMoodFlow],
  );
  const chatInitKey = useMemo(
    () =>
      `${search.from ?? ""}|${search.mood ?? ""}|${search.recommendationId ?? ""}|${search.fromMoodFlow ?? ""}`,
    [search.from, search.mood, search.recommendationId, search.fromMoodFlow],
  );

  useEffect(() => {
    if (!moodThreadKey || hydrating || msgs.length === 0) return;
    persistMoodChatMessages(moodThreadKey, msgs);
  }, [moodThreadKey, msgs, hydrating]);

  const persistSession = useCallback((next: ChatPlanningSession) => {
    setSession(next);
    sessionRef.current = next;
    saveChatSession(next);
  }, []);

  const commitAssistantReply = useCallback(
    (
      conversation: ChatMsg[],
      summary: string,
      activeSession: ChatPlanningSession,
      source: string,
    ) => {
      const next = appendAssistantToConversation(conversation, summary, activeSession);
      setMsgs(next);
      msgsRef.current = next;
      console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", { source, excerpt: summary.slice(0, 80) });
      console.info("[CHAT_RENDER_COMPLETE]");
      return next;
    },
    [],
  );

  const ensurePipelineFallbackReply = useCallback(
    (conversation: ChatMsg[], activeSession: ChatPlanningSession, userText: string) => {
      if (!conversationMissingAssistantReply(conversation)) return conversation;
      const tripIntent = parseTripIntentFromText(userText, activeSession);
      const aiIntent = resolveAiUserIntent(activeSession, userText, tripIntent);
      const instant = resolveInstantChatReply(userText, activeSession);
      const summary =
        instant?.summary ??
        buildChatFallbackReply(userText, activeSession, aiIntent) ??
        CHAT_PIPELINE_FALLBACK;
      return commitAssistantReply(conversation, summary, activeSession, "pipeline_fallback");
    },
    [commitAssistantReply],
  );

  const resetChatBusyState = useCallback(() => {
    setStreaming(false);
    setOpenerLoading(false);
    setGenerating(false);
    abortRef.current?.abort();
    abortRef.current = null;
    busySinceRef.current = null;
  }, []);

  useEffect(() => {
    if (streaming || generating || openerLoading) {
      if (busySinceRef.current == null) busySinceRef.current = Date.now();
    } else {
      busySinceRef.current = null;
    }
  }, [streaming, generating, openerLoading]);

  useEffect(() => {
    if (!hydrating) resetChatBusyState();
  }, [hydrating, resetChatBusyState]);

  useEffect(() => {
    if (!hydrating) return;
    const t = window.setTimeout(() => {
      console.warn("[CHAT_INIT] force end hydrating (timeout)");
      setHydrating(false);
      resetChatBusyState();
    }, 8000);
    return () => window.clearTimeout(t);
  }, [hydrating, chatInitKey, resetChatBusyState]);

  useEffect(() => {
    if (hydrating) return;
    if (session.chatEntry && session.chatEntry !== "tab") return;
    if (session.fromMoodFlow || session.fromMoodCard || session.fromPlusHome) return;
    setMsgs((prev) => {
      if (prev.length === 0) return [greetingMsg];
      if (prev.length === 1 && prev[0].role === "assistant" && !prev[0].roamie) {
        return [greetingMsg];
      }
      return prev;
    });
  }, [greetingMsg, hydrating, session.chatEntry, session.fromMoodFlow, session.fromMoodCard, session.fromPlusHome]);

  const scrollMessagesToEnd = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scheduleScrollMessagesToEnd = useCallback(() => {
    if (scrollEndScheduledRef.current) return;
    scrollEndScheduledRef.current = true;
    requestAnimationFrame(() => {
      scrollEndScheduledRef.current = false;
      scrollMessagesToEnd();
    });
  }, [scrollMessagesToEnd]);

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
      const roundedHeight = Math.max(0, Math.round(reportedHeight));
      const prev = keyboardLayoutRef.current;
      if (prev.visible === open && prev.height === roundedHeight) return;

      keyboardLayoutRef.current = { visible: open, height: roundedHeight };
      keyboardOpenRef.current = open;

      const headerHeightPx = headerRef.current
        ? Math.round(headerRef.current.getBoundingClientRect().height)
        : 0;

      const inset = resolveComposerBottomInset({
        keyboardVisible: open,
        reportedKeyboardHeightPx: roundedHeight,
        composerShellEl: composerShellRef.current,
      });

      if (import.meta.env.DEV) {
        logComposerLayoutSnapshot({
          keyboardVisible: open,
          reportedKeyboardHeightPx: roundedHeight,
          composerBottomInsetPx: inset,
          headerHeightPx,
        });
      }

      setKeyboardVisible(open);
      setReportedKeyboardHeightPx(roundedHeight);

      if (open) {
        setComposerLayoutRev((n) => n + 1);
        scheduleScrollMessagesToEnd();
      }
    };

    const reconcileNativeKeyboard = (info: unknown) => {
      const reported = parseKeyboardEventHeight(info);
      if (reported > 50) {
        applyKeyboard(reported, true);
        return;
      }
      requestAnimationFrame(() => {
        const vv = measureVisualViewportKeyboardInset();
        const capped = Math.min(vv, Math.round(window.innerHeight * 0.55));
        if (capped > 50) {
          applyKeyboard(capped, true);
          return;
        }
        applyKeyboard(estimateNativeKeyboardHeight(), true);
      });
    };

    const vv = window.visualViewport;
    let viewportSyncFrame = 0;
    const syncFromViewport = () => {
      if (!vv) return;
      if (viewportSyncFrame) cancelAnimationFrame(viewportSyncFrame);
      viewportSyncFrame = requestAnimationFrame(() => {
        viewportSyncFrame = 0;
        const shrink = measureVisualViewportKeyboardInset();
        const capped = Math.min(shrink, Math.round(window.innerHeight * 0.55));
        if (capped > 50) {
          applyKeyboard(capped, true);
          return;
        }
        if (!isNativeShell && keyboardOpenRef.current) {
          applyKeyboard(0, false);
        }
      });
    };

    if (!isNativeShell) {
      syncFromViewport();
      vv?.addEventListener("resize", syncFromViewport);
    }

    let keyboardListenersCancelled = false;
    if (isNativeShell) {
      void runWhenCapacitorBridgeReady("chat.keyboardListeners", async () => {
        if (keyboardListenersCancelled) return;
        const { Keyboard } = await import("@capacitor/keyboard");
        if (keyboardListenersCancelled) return;
        const onShow = (info: unknown) => {
          reconcileNativeKeyboard(info);
        };
        const onHide = () => applyKeyboard(0, false);
        const showWill = Keyboard.addListener("keyboardWillShow", onShow);
        const showDid = Keyboard.addListener("keyboardDidShow", onShow);
        const hideWill = Keyboard.addListener("keyboardWillHide", onHide);
        const hideDid = Keyboard.addListener("keyboardDidHide", onHide);
        removeCapKeyboard = () => {
          void showWill.then((s) => s.remove());
          void showDid.then((s) => s.remove());
          void hideWill.then((s) => s.remove());
          void hideDid.then((s) => s.remove());
        };
      });
    }

    return () => {
      keyboardListenersCancelled = true;
      if (viewportSyncFrame) cancelAnimationFrame(viewportSyncFrame);
      vv?.removeEventListener("resize", syncFromViewport);
      removeCapKeyboard?.();
    };
  }, [scheduleScrollMessagesToEnd]);

  useEffect(() => {
    if (!keyboardVisible) return;
    scheduleScrollMessagesToEnd();
  }, [keyboardVisible, msgs.length, scheduleScrollMessagesToEnd]);

  useEffect(() => {
    if (streaming) return;
    scheduleScrollMessagesToEnd();
  }, [streaming, msgs.length, scheduleScrollMessagesToEnd]);

  useEffect(() => {
    (async () => {
      try {
        if (preservedChatRestoredRef.current) {
          setHydrating(false);
          return;
        }

        const preserved = consumePreservedChatUiMessages();
        if (preserved?.length) {
          preservedChatRestoredRef.current = true;
          setMsgs(preserved);
          console.info("[CHAT_RETURN] preserved=true");
          setHydrating(false);
          return;
        }

        if (chatInitKeyRef.current === chatInitKey) {
          const cached = moodThreadKey ? loadMoodChatMessages(moodThreadKey) : null;
          if (cached?.length) {
            setSession(loadChatSession());
            setMsgs(cached);
          }
          setHydrating(false);
          resetChatBusyState();
          return;
        }
        chatInitKeyRef.current = chatInitKey;

        const entry = resolveChatEntry(search);
        console.info("[CHAT_INIT] entry=", entry, search);

        let session = loadChatSession();
        const places = await listPlaces();
        setSavedNames(new Set(places.map((p) => p.name)));
        setHydrating(false);

        const cachedMoodMsgs = moodThreadKey ? loadMoodChatMessages(moodThreadKey) : null;
        if (cachedMoodMsgs?.length && (entry === "home_mood" || entry === "mood_recommendation")) {
          setSession(loadChatSession());
          setMsgs(cachedMoodMsgs);
          setHydrating(false);
          resetChatBusyState();
          return;
        }

        if (entry === "tab") {
          const forceDefault = search.from === "tab";
          const preserveMoodThread =
            !forceDefault &&
            (session.chatEntry === "home_mood" || session.chatEntry === "mood_recommendation");

          if (preserveMoodThread) {
            const history = await loadChatHistory();
            if (history.length) setMsgs(history);
            else if (session.moodHandoffDone) {
              const summary = buildContextualMoodHandoffOpening(session);
              setMsgs([
                {
                  role: "assistant",
                  content: summary,
                  roamie: buildHandoffRoamiePayload(session, summary),
                },
              ]);
            }
          } else {
            session = sessionForDefaultTab(session);
            persistSession(session);
            homeMoodOpenerStartedRef.current = null;
            handoffStartedRef.current = null;
            const history = await loadChatHistory();
            setMsgs(history.length ? history : [greetingMsg]);
          }
        } else if (entry === "home_mood") {
          const mood = search.mood?.trim() ?? "";
          const prompt = homeMoodPrompt(mood, search.prompt);
          const openerKey = `home-mood:${mood}:${search.prompt?.trim() ?? ""}`;
          const bundle = await buildClientContextBundle(fetchWeather);
          session = sessionForHomeMoodEntry(mood, session, bundle);
          persistSession(session);

          const restoreHomeMoodThread = async () => {
            const history = await loadChatHistory();
            if (history.length) {
              setMsgs(history);
              return true;
            }
            if (
              session.chatEntry === "home_mood" &&
              session.selectedMood === mood &&
              session.recommendedPlaces.length > 0
            ) {
              const summary = buildContextualMoodHandoffOpening(session);
              setMsgs([
                {
                  role: "user",
                  content: mood ? `我想${mood}，幫我看看附近適合去哪裡。` : prompt,
                },
                {
                  role: "assistant",
                  content: summary,
                  roamie: buildHandoffRoamiePayload(session, summary, session.recommendedPlaces),
                },
              ]);
              return true;
            }
            return false;
          };

          if (homeMoodOpenerStartedRef.current !== openerKey) {
            homeMoodOpenerStartedRef.current = openerKey;
            await runHomeMoodOpener(session, prompt);
          } else {
            const restored = await restoreHomeMoodThread();
            if (!restored) {
              await runHomeMoodOpener(session, prompt);
            }
          }
        } else if (entry === "mood_recommendation") {
          if (search.recommendationId) {
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
                  chatEntry: "mood_recommendation",
                },
              });
              persistSession(session);
            }
          }

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
          } else if (current.moodHandoffDone) {
            const history = await loadChatHistory();
            if (history.length) setMsgs(history);
            else {
              const summary = buildContextualMoodHandoffOpening(current);
              setMsgs([
                {
                  role: "assistant",
                  content: summary,
                  roamie: buildHandoffRoamiePayload(current, summary),
                },
              ]);
            }
          }
        } else if (entry === "plan") {
          const current = loadChatSession();
          if (
            current.fromPlanForm &&
            current.pendingHandoff &&
            !current.planHandoffDone &&
            !planHandoffStartedRef.current
          ) {
            planHandoffStartedRef.current = true;
            setMsgs([]);
            await runPlanFormHandoff(current);
          }
        } else if (entry === "plus_home") {
          // plus_home handoff 在 hasPlusAccess 就緒後另跑（見下方 effect）
          const history = await loadChatHistory();
          setMsgs(history.length ? history : [greetingMsg]);
        } else {
          session = sessionForDefaultTab(session);
          persistSession(session);
          const history = await loadChatHistory();
          setMsgs(history.length ? history : [greetingMsg]);
        }
      } catch (e) {
        console.error("[CHAT_INIT] failed", e);
      } finally {
        setHydrating(false);
        resetChatBusyState();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatInitKey, moodThreadKey, resetChatBusyState]);

  useEffect(() => {
    if (hydrating) return;
    if (resolveChatEntry(search) !== "plus_home") return;
    if (!hasPlusAccess) return;
    void (async () => {
      let session = loadChatSession();
      if (!session.fromPlusHome) {
        const prefs = await getPreferences();
        session = preparePlusHomeChatSession({
          mood: session.selectedMood,
          prefs,
        });
        persistSession(session);
      }
      const current = loadChatSession();
      if (
        current.fromPlusHome &&
        current.pendingHandoff &&
        !current.plusHomeHandoffDone
      ) {
        const summary = buildPlusHomeHandoffOpening(current, current.plusHomeInsight);
        setMsgs([
          {
            role: "assistant",
            content: summary,
            roamie: buildHandoffRoamiePayload(current, summary),
          },
        ]);
        persistSession(markPlusHomeHandoffComplete(current));
      }
    })();
  }, [hydrating, hasPlusAccess, search.from, persistSession]);

  useEffect(() => {
    if (hydrating) return;
    const entry = resolveChatEntry(search);
    if (entry === "home_mood" || entry === "tab") return;
    const prompt = search.prompt?.trim();
    if (!prompt || autoPromptHandledRef.current) return;
    autoPromptHandledRef.current = true;
    void send(prompt);
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
  }, [hydrating, search.prompt, search.from]);

  const handleSavePlace = async (rec: RoamieRecommendationItem) => {
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
      const bundle = await resolveContextBundleForSession(syncedForBundle, fetchWeather);
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
      const intentBlock = formatConversationIntentForAi(parseConversationIntent(userText));
      const travelCtxForAi = formatTravelContextForAi({
        ...EMPTY_TRAVEL_CONTEXT,
        ...parseTravelContextFromText(userText, synced),
        ...(synced.travelContext ?? {}),
      });
      const initialCtx = [
        intentBlock,
        travelCtxForAi,
        synced.initialChatContext ?? buildInitialChatContext(synced),
        buildPlanningMemoryContext(synced),
        tripIntentBlock,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000);
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
        selectedMood: synced.selectedMood ?? synced.mood,
        selectedCategory: synced.selectedCategory ?? synced.mood,
        initialChatContext: initialCtx,
        lateNightMode: synced.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
        avoidTypes: synced.avoidTypes,
        preferredArea: synced.preferredArea,
        rejectedPlaceNames: synced.rejectedPlaceNames,
        focusedPlace: overrides?.focusedPlace,
        userIntent:
          overrides?.chatPhase === "place_discussion" ? PLACE_DISCUSSION_USER_INTENT : undefined,
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
      setOpenerLoading(true);
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
        const moodText = syncedHandoff.selectedMood ?? syncedHandoff.mood ?? "";
        const moodUserText = homeMoodPrompt(moodText);

        try {
          const full = await Promise.race([
            fetchRoamieAI(req, { token }),
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error("handoff_timeout")), 20_000);
            }),
          ]);
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

        const filteredRecs = recommendationsForChatDisplay(
          syncedHandoff,
          moodUserText,
          (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
        );
        if (filteredRecs.length === 0) {
          const { context } = mergeTravelContext(syncedHandoff, moodUserText);
          let placeResults: Awaited<ReturnType<typeof searchNearbyPlaces>>["places"] = [];
          const effective = resolveEffectiveDeviceCoords({ sessionLocation: syncedHandoff.location });
          const lat = effective?.lat ?? syncedHandoff.location?.lat ?? bundle.location?.lat;
          const lng = effective?.lng ?? syncedHandoff.location?.lng ?? bundle.location?.lng;
          if (lat != null && lng != null) {
            try {
              const moodSearch = await searchPlacesWithMoodFallback(searchNearbyPlaces, {
                mood: moodText || context.mood || "附近",
                lat,
                lng,
                minCount: 3,
                maxCount: 6,
                userText: moodUserText,
              });
              placeResults = moodSearch.places;
              console.info("[MOOD_CHAT_PLACES] candidates=", placeResults.length);
            } catch (fallbackErr) {
              console.warn("[AI_FALLBACK] handoff places search failed", fallbackErr);
            }
          }
          const local = generateLocalRecommendationFallback({
            context,
            session: syncedHandoff,
            locale,
            places: placeResults,
          });
          summary = local.summary;
          roamiePayload = local.payload;
        }
        const displayRecs = recommendationsForChatDisplay(
          syncedHandoff,
          moodUserText,
          (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
        );
        const opener: ChatMsg = {
          role: "assistant",
          content: summary,
          roamie: { ...roamiePayload, recommendations: displayRecs },
        };
        setMsgs([opener]);

        const recs = displayRecs as ChatPlaceItem[];

        const nextSession = syncSessionPlaceMemory(
          markMoodHandoffComplete({
            ...syncedHandoff,
            phase: syncedHandoff.selectedPlaces.length ? "followup" : "collect",
            recommendedPlaces: recs.length ? recs : syncedHandoff.recommendedPlaces,
            initialChatContext: initialCtx,
          }),
        );
        persistSession(nextSession);
      } finally {
        setOpenerLoading(false);
      }
    },
    [fetchWeather, persistSession, locale, searchNearbyPlaces],
  );

  /** 首頁心情入口：Places 真實地點 + 對齊摘要（AI 僅輔助，卡片以 Places 為準） */
  const runHomeMoodOpener = useCallback(
    async (moodSession: ChatPlanningSession, userPrompt: string) => {
      setOpenerLoading(true);
      const mood = moodSession.selectedMood ?? moodSession.mood ?? "";
      const userVisible = mood ? `我想${mood}，幫我看看附近適合去哪裡。` : userPrompt;
      try {
        const bundle = await buildClientContextBundle(fetchWeather);
        const synced = syncSessionPlaceMemory({
          ...moodSession,
          location: bundle.location,
          weather: bundle.weather,
          chatEntry: "home_mood",
        });
        const { context } = mergeTravelContext(synced, userPrompt);

        const effective = resolveEffectiveDeviceCoords({ sessionLocation: synced.location });
        const lat = effective?.lat ?? synced.location?.lat ?? bundle.location?.lat;
        const lng = effective?.lng ?? synced.location?.lng ?? bundle.location?.lng;

        let summary = buildContextualMoodHandoffOpening(synced);
        let recs: RoamieRecommendationItem[] = [];
        let roamiePayload = buildHandoffRoamiePayload(synced, summary);

        if (lat != null && lng != null) {
          const grounded = await resolveMoodGroundedRecommendations({
            session: synced,
            context,
            locale,
            searchNearbyPlaces,
            lat,
            lng,
            userText: userPrompt,
          });
          recs = grounded.recommendations;
          summary = grounded.summary;
          roamiePayload = buildHandoffRoamiePayload(
            synced,
            summary,
            recs.map(roamieRecToChatItem),
          );
        }

        const displayRecs = recommendationsForChatDisplay(synced, userPrompt, recs);
        if (displayRecs.length > 0) {
          roamiePayload = buildHandoffRoamiePayload(
            synced,
            summary,
            displayRecs.map(roamieRecToChatItem),
          );
        }

        const userMsg: ChatMsg = { role: "user", content: userVisible };
        const assistantMsg: ChatMsg = {
          role: "assistant",
          content: summary,
          roamie: { ...roamiePayload, recommendations: displayRecs },
        };
        setMsgs([userMsg, assistantMsg]);

        persistSession(
          syncSessionPlaceMemory({
            ...synced,
            phase: "recommend",
            recommendedPlaces: displayRecs as ChatPlaceItem[],
            chatEntry: "home_mood",
            selectionSource: "mood",
            pendingHandoff: false,
            moodHandoffDone: false,
            fromMoodFlow: false,
          }),
        );
        if (displayRecs.length) {
          recordRecommendationNames(displayRecs.map((r) => r.name));
        }
      } catch (e) {
        console.error("[CHAT_HOME_MOOD] opener failed", e);
        setMsgs([
          { role: "user", content: userVisible },
          {
            role: "assistant",
            content: "我收到你的心情了，跟我說說你現在比較想走走、喝咖啡，還是找個安靜角落？",
          },
        ]);
        persistSession({
          ...moodSession,
          chatEntry: "home_mood",
          pendingHandoff: false,
          moodHandoffDone: false,
          fromMoodFlow: false,
          phase: "discover",
        });
      } finally {
        setOpenerLoading(false);
      }
    },
    [fetchWeather, persistSession, locale, searchNearbyPlaces],
  );

  const runPlanFormHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      setOpenerLoading(true);
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

        const summary = buildPlanTripHandoffOpening(
          {
            destination: dest,
            origin: syncedHandoff.tripOrigin,
            days: syncedHandoff.tripDays ?? 2,
            mood: syncedHandoff.mood ?? "",
            styles: syncedHandoff.tripStyles?.split(/[、,]/).filter(Boolean) ?? [],
            interests: "",
            startDate: syncedHandoff.tripStartDate ?? "",
            endDate: syncedHandoff.tripEndDate ?? "",
            departureTime: syncedHandoff.startTime ?? "",
            travelers: syncedHandoff.tripCompanionCount ?? 1,
            transport: syncedHandoff.transportation ?? "",
            budgetMode: syncedHandoff.budget ?? "",
          },
          bundle,
          locale,
        );
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

        const filteredRecs = recommendationsForChatDisplay(
          syncedHandoff,
          "",
          (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
        );
        const opener: ChatMsg = {
          role: "assistant",
          content: summaryText,
          roamie: { ...roamiePayload, recommendations: filteredRecs },
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
        setOpenerLoading(false);
      }
    },
    [fetchWeather, persistSession],
  );

  const applyLocalFallback = useCallback(
    async (
      activeSession: ChatPlanningSession,
      activeUserText: string,
      conversation: ChatMsg[],
    ): Promise<boolean> => {
      const { context } = mergeTravelContext(activeSession, activeUserText);
      const effective = resolveEffectiveDeviceCoords({ sessionLocation: activeSession.location });
      const lat = effective?.lat;
      const lng = effective?.lng;

      let summary = "";
      let filteredRecs: RoamieRecommendationItem[] = [];

      if (lat != null && lng != null) {
        try {
          const grounded = await resolveMoodGroundedRecommendations({
            session: activeSession,
            context,
            locale,
            searchNearbyPlaces,
            lat,
            lng,
            userText: activeUserText,
          });
          summary = grounded.summary;
          filteredRecs = recommendationsForChatDisplay(
            activeSession,
            activeUserText,
            grounded.recommendations,
          );
          console.info("[MOOD_CHAT_PLACES] grounded=", filteredRecs.length);
        } catch (fallbackErr) {
          console.warn("[AI_FALLBACK] mood grounded search failed", fallbackErr);
        }
      }

      if (!filteredRecs.length) {
        const { summary: localSummary, payload } = generateLocalRecommendationFallback({
          context,
          session: activeSession,
          locale,
          places: [],
        });
        summary = localSummary;
        filteredRecs = recommendationsForChatDisplay(
          activeSession,
          activeUserText,
          payload.recommendations ?? [],
        );
      }

      const moodTag = context.mood ?? activeSession.selectedMood ?? "";
      const roamiePayload = {
        title: moodTag ? `${moodTag} 推薦` : "Roamie 推薦",
        summary,
        moodTag,
        recommendations: filteredRecs,
        itinerary: [] as [],
      };

      setMsgs((prev) => {
        const next = replaceTrailingAssistantMessage(prev, summary, roamiePayload);
        msgsRef.current = next;
        console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
          source: "local_recommendation",
          excerpt: summary.slice(0, 80),
        });
        console.info("[CHAT_RENDER_COMPLETE]");
        return next;
      });
      const nextSession = syncSessionPlaceMemory({
        ...activeSession,
        travelContext: context,
        phase: "recommend",
        recommendedPlaces: filteredRecs as ChatPlaceItem[],
      });
      persistSession(nextSession);
      setPartial({});
      return true;
    },
    [locale, persistSession, searchNearbyPlaces],
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
      const timeoutMs = 28_000;
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      let submitOk = false;

      try {
        if (isChatApiUnreachableOnNative()) {
          console.warn("[CHAT_API] unreachable on native", {
            url: chatApiResolvedUrl(),
            origin: import.meta.env.VITE_APP_ORIGIN,
          });
          toast.message(chatApiMisconfigUserMessage());
          setMsgs((prev) => [...prev, { role: "assistant", content: "" }]);
          const applied = await applyLocalFallback(
            sessionOverride ?? session,
            opts?.userText ?? "",
            conversation,
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
                  content: chatApiMisconfigUserMessage(),
                },
              ];
            });
          }
          setPartial({});
          return;
        }

        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;

        const pendingMsgs: ChatMsg[] = [...conversation, { role: "assistant", content: "" }];
        setMsgs(pendingMsgs);
        msgsRef.current = pendingMsgs;

        let req: Awaited<ReturnType<typeof buildRequest>>;
        try {
          req = await buildRequest(
            conversation,
            {
              chatPhase: opts?.phase,
              chatInput: opts?.userText,
              focusedPlace: opts?.focusedPlace,
            },
            sessionOverride,
          );
        } catch (buildErr) {
          console.error("[CHAT_API] buildRequest failed", buildErr);
          const activeSession = sessionOverride ?? session;
          const activeUserText = opts?.userText ?? "";
          const tripIntent = parseTripIntentFromText(activeUserText, activeSession);
          const aiIntent = resolveAiUserIntent(activeSession, activeUserText, tripIntent, {
            chatPhaseOverride: opts?.phase,
          });
          if (aiIntent.type === "travel_time_advice" && activeUserText) {
            setMsgs((prev) => applyTravelAdviceFallbackToMsgs(prev, activeUserText, activeSession));
            setLastFailed(null);
            setPartial({});
            return;
          }
          if (opts?.phase === "recommend" || activeUserText) {
            const applied = await applyLocalFallback(activeSession, activeUserText, conversation);
            if (applied) {
              setLastFailed(null);
              return;
            }
          }
          throw buildErr;
        }
        console.info("[AI_REPLY_REQUEST]", `phase=${req.chatPhase ?? "unknown"}`);

        let full: RoamieResponse | null = null;
        if (isCapacitorNativeShell()) {
          console.info("[CHAT_API] native shell → fetch JSON (skip SSE)");
          full = await withChatTimeout(fetchRoamieAI(req, { token }), timeoutMs - 500, controller.signal);
        } else {
          full = await streamRoamieAI(
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
                  msgsRef.current = next;
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
            full = await fetchRoamieAI(req, { token });
            console.info("[CHAT_API] fetch fallback ok");
          }
        }
        const fullWithSummary = withChatSummaryFallback(full, opts?.userText ?? "");
        console.info(
          "[AI_REPLY_SUCCESS]",
          `recommendations=${fullWithSummary.recommendations?.length ?? 0}`,
        );

        const userText = opts?.userText ?? "";
        const activeSession = sessionOverride ?? session;
        const intentForGuard = parseTripIntentFromText(userText, activeSession);
        const aiIntent = resolveAiUserIntent(activeSession, userText, intentForGuard, {
          chatPhaseOverride: opts?.phase ?? req.chatPhase,
        });
        responseModeForIntent(aiIntent);
        let resolvedFull = fullWithSummary;
        if (aiIntent.type === "travel_time_advice") {
          resolvedFull = { ...fullWithSummary, recommendations: [], itinerary: [] };
          if (!resolvedFull.summary?.trim()) {
            resolvedFull = {
              ...resolvedFull,
              summary: buildTravelAdviceFallbackReply(userText, activeSession, aiIntent),
            };
          }
        }
        const verifiedRecommendations = filterVerifiedRecommendations(
          resolvedFull.recommendations ?? [],
        );
        const { recommendations: dedupedRecommendations, meta: dedupeMeta } =
          dedupeRoamieRecommendations(verifiedRecommendations, { minCount: 3, maxCount: 4 });
        console.info("[REC_DEDUPE] chat_stream", dedupeMeta);
        if (dedupedRecommendations.length > 0) {
          resolvedFull = {
            ...resolvedFull,
            recommendations: dedupedRecommendations,
          };
        }

        const summary = resolvedFull.summary?.trim() ?? "";
        const looksRepeatedClarify =
          /這趟比較想放鬆、拍照，還是吃美食/.test(summary) && /(都有|都可以|都行)/.test(userText);
        const shouldUseLocalFallback =
          aiIntent.type !== "travel_time_advice" &&
          ((resolvedFull.recommendations?.length ?? 0) === 0 &&
            (intentForGuard.readyForRecommendations ||
              looksRepeatedClarify ||
              activeSession.fromMoodFlow ||
              activeSession.fromMoodCard ||
              Boolean(activeSession.mood ?? activeSession.selectedMood) ||
              (opts?.phase === "recommend" && aiIntent.type === "place_recommendation") ||
              (req.chatPhase === "recommend" && aiIntent.type === "place_recommendation"))) ||
          shouldReplaceAiWithMoodGrounded({
            session: activeSession,
            aiSummary: summary,
            aiRecs: dedupedRecommendations,
            userText,
          });
        if (shouldUseLocalFallback) {
          const applied = await applyLocalFallback(activeSession, userText, conversation);
          if (applied) return;
        }

        if (resolvedFull.recommendations?.length) {
          recordRecommendationNames([
            ...resolvedFull.recommendations.map((r) => r.name),
            ...extractPlaceNames(session.selectedPlaces),
          ]);
        }

        const apiPhaseUsed = opts?.phase ?? resolveChatApiPhase(session, opts?.userText ?? "");
        let nextSession = mergeSessionFromRoamie(
          sessionOverride ?? session,
          resolvedFull,
          (sessionOverride ?? session).phase,
        );
        if (nextSession.recommendedPlaces.length) {
          let recs = recommendationsForChatDisplay(
            nextSession,
            opts?.userText ?? "",
            nextSession.recommendedPlaces,
          ) as ChatPlaceItem[];
          if (opts?.phase === "place_discussion" && opts.focusedPlace) {
            recs = filterPlaceDiscussionRecommendations(recs, opts.focusedPlace) as ChatPlaceItem[];
          }
          nextSession = {
            ...nextSession,
            recommendedPlaces: recs,
          };
        }
        if (nextSession.phase === "discover" && isDiscoveryComplete(nextSession)) {
          nextSession = { ...nextSession, phase: "followup" };
        }
        nextSession = {
          ...nextSession,
          phase: resolveSessionPhaseAfterReply(
            nextSession,
            Boolean(resolvedFull.recommendations?.length),
            apiPhaseUsed,
          ),
        };
        persistSession(nextSession);

        let displayRecs = recommendationsForChatDisplay(
          activeSession,
          opts?.userText ?? "",
          resolvedFull.recommendations ?? [],
        );
        if (opts?.phase === "place_discussion" && opts.focusedPlace) {
          displayRecs = filterPlaceDiscussionRecommendations(displayRecs, opts.focusedPlace);
        }
        const displayFull = withChatSummaryFallback(
          {
            ...resolvedFull,
            recommendations: displayRecs,
          },
          userText,
        );
        if (opts?.phase === "place_discussion") {
          console.info("[CHAT_ABOUT_PLACE] replyGenerated=true");
        }
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: displayFull.summary,
            roamie: displayFull,
          };
          msgsRef.current = next;
          return next;
        });
        console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
          source: "ai_stream",
          excerpt: displayFull.summary.slice(0, 80),
        });
        console.info("[CHAT_RENDER_COMPLETE]");
        setPartial({});
        submitOk = true;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          const activeForTimeout = sessionOverride ?? session;
          const activeUserText = opts?.userText ?? "";
          const tripIntent = parseTripIntentFromText(activeUserText, activeForTimeout);
          const aiIntent = resolveAiUserIntent(activeForTimeout, activeUserText, tripIntent, {
            chatPhaseOverride: opts?.phase,
          });
          if (aiIntent.type === "travel_time_advice" && activeUserText.trim()) {
            setMsgs((prev) =>
              applyTravelAdviceFallbackToMsgs(prev, activeUserText, activeForTimeout),
            );
          } else {
            const applied = await applyLocalFallback(activeForTimeout, activeUserText, conversation);
            if (!applied) {
              setMsgs((prev) => {
                const trimmedPrev = prev.filter(
                  (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
                );
                const summary = buildChatFallbackReply(activeUserText, activeForTimeout, aiIntent);
                return [
                  ...trimmedPrev,
                  {
                    role: "assistant",
                    content: summary,
                  },
                ];
              });
            }
          }
          setPartial({});
          setLastFailed(conversation);
          return;
        }
        console.log("[CHAT_SUBMIT_ERROR]", e);
        console.error("[CHAT_SEND] submit error=", e instanceof Error ? e.message : String(e));
        console.error("[AI_REPLY_ERROR]", e instanceof Error ? e.message : String(e));
        logAppError("[Roamie AI] chat failed", e, {
          userText: opts?.userText,
          phase: opts?.phase,
        });
        const activeForFallback = sessionOverride ?? session;
        const activeUserText = opts?.userText ?? "";
        const errMsg = e instanceof Error ? e.message : String(e);
        let applied = false;
        const tripIntent = parseTripIntentFromText(activeUserText, activeForFallback);
        const aiIntent = resolveAiUserIntent(activeForFallback, activeUserText, tripIntent, {
          chatPhaseOverride: opts?.phase,
        });
        try {
          if (aiIntent.type === "travel_time_advice" && activeUserText.trim()) {
            setMsgs((prev) =>
              applyTravelAdviceFallbackToMsgs(prev, activeUserText, activeForFallback),
            );
            applied = true;
          } else if (isAiChatServiceUnavailableError(errMsg)) {
            const summary = buildChatFallbackReply(activeUserText, activeForFallback, aiIntent);
            setMsgs((prev) =>
              replaceTrailingAssistantMessage(prev, summary, {
                title: "",
                summary,
                moodTag: activeForFallback.mood ?? "",
                recommendations: [],
                itinerary: [],
              }),
            );
            applied = true;
          } else {
            applied = await applyLocalFallback(activeForFallback, activeUserText, conversation);
          }
        } catch (fallbackErr) {
          console.error("[AI_FALLBACK] applyLocalFallback failed", fallbackErr);
        }
        if (!applied) {
          if (errMsg.trim()) toast.error(errMsg);
          const hint: ChatMsg = buildAssistantChatMsg(CHAT_PIPELINE_FALLBACK, activeForFallback);
          setMsgs((prev) => {
            const trimmedPrev = prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
            );
            const next = [...trimmedPrev, hint];
            msgsRef.current = next;
            return next;
          });
          console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
            source: "error_fallback",
            excerpt: CHAT_PIPELINE_FALLBACK,
          });
          console.info("[CHAT_RENDER_COMPLETE]");
          setLastFailed(conversation);
        } else {
          setLastFailed(null);
        }
        setPartial({});
      } finally {
        window.clearTimeout(timeoutId);
        setStreaming(false);
        abortRef.current = null;
        if (submitOk) {
          console.log("[CHAT_SUBMIT_SUCCESS]");
        }
      }
    },
    [buildRequest, session, persistSession, locale, applyLocalFallback],
  );

  const handleSelectPlaceForPlanning = useCallback(
    (rec: RoamieRecommendationItem) => {
      if (streaming || generating || openerLoading) return;
      const item = roamieRecToChatItem(rec);
      const source = inferPlaceSelectionSource(session);
      const alreadySelected = isPlaceAlreadySelected(session, item);
      const nextSession = addSelectedPlace(session, item, { source });
      persistSession(nextSession);

      if (alreadySelected) {
        toast.message(`「${placeDisplayName(item)}」已在你的選擇清單中`);
        return;
      }

      const ack: ChatMsg = {
        role: "assistant",
        content: `已選擇「${placeDisplayName(item)}」，我可以幫你接著安排路線。\n想再加其他點，或按卡片下方的「生成行程」開始排。`,
      };
      setMsgs((prev) => [...prev, ack]);
    },
    [generating, openerLoading, persistSession, session, streaming],
  );

  const handleGenerateItineraryFromPlaceRef = useRef<
    (rec: RoamieRecommendationItem) => Promise<void>
  >(async () => {});

  const handleNavigatePlace = (rec: RoamieRecommendationItem) => {
    openPlaceNavigation({
      lat: rec.lat,
      lng: rec.lng,
      address: rec.address,
      placeName: rec.placeName ?? rec.name,
    });
  };

  const handleGenerateItinerary = async (
    sessionOverride?: ChatPlanningSession,
    msgsOverride?: ChatMsg[],
    generationSource?: PlaceSelectionSource | string,
  ) => {
    const activeSession = sessionOverride ?? session;
    const activeMsgs = msgsOverride ?? msgs;
    const source =
      generationSource ??
      activeSession.lastItineraryGenerationSource ??
      inferPlaceSelectionSource(activeSession);

    const rawPlaces = buildTripFromSelectedPlaces(activeSession);
    const places = normalizePlacesForItinerary(rawPlaces);

    if (places.length < 1) {
      toast.message("請先選擇至少一個想去的地方，再生成行程。");
      recordItineraryDiagnostics({
        selectedPlaces: selectedPlacesDiagnosticsSnapshot(rawPlaces),
        generationSource: source,
        errorMessage: "selectedPlaces_empty",
        itineraryPayload: null,
      });
      return;
    }

    if (!canGenerateItinerary({ ...activeSession, selectedPlaces: rawPlaces }) || generating) {
      return;
    }

    setGenerating(true);
    persistSession({ ...activeSession, phase: "generating", lastItineraryGenerationSource: source });

    const payloadPreview = {
      destination: activeSession.tripDestination
        ? formatTripLocationLabel(activeSession.tripDestination)
        : inferDestinationFromPlaces(places, activeSession.location ?? undefined) || "目前位置",
      days: activeSession.tripDays ?? 1,
      selectedPlaces: selectedPlacesDiagnosticsSnapshot(rawPlaces),
      generationSource: source,
    };

    recordItineraryDiagnostics({
      selectedPlaces: selectedPlacesDiagnosticsSnapshot(rawPlaces),
      generationSource: source,
      errorMessage: null,
      itineraryPayload: payloadPreview,
    });

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

      const generatePayload = {
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
        selectedPlaces: places,
        preferences: prefs,
        location: bundle.location,
        weather: bundle.weather,
        time: activeSession.startTime || bundle.time,
        fashionStyle: fashionStyle ?? "",
        locale,
        destinationLocation: activeSession.tripDestination ?? undefined,
      };

      recordItineraryDiagnostics({
        selectedPlaces: selectedPlacesDiagnosticsSnapshot(rawPlaces),
        generationSource: source,
        errorMessage: null,
        itineraryPayload: generatePayload as unknown as Record<string, unknown>,
      });

      let itinerary: RoamiePayloadV2;
      let usedLocalItineraryFallback = false;
      const localFallbackInput = {
        destination,
        days: tripDays,
        startDate,
        endDate,
        mood: activeSession.mood ?? "",
        style: activeSession.tripStyles || (activeSession.pace === "排滿" ? "緊湊" : "慢旅行"),
        transport: activeSession.transportation ?? "",
        selectedPlaces: places,
        weather: bundle.weather,
        destinationLocation: activeSession.tripDestination ?? undefined,
        origin: activeSession.tripOrigin
          ? formatTripLocationLabel(activeSession.tripOrigin)
          : (bundle.location.city ?? ""),
        travelers: activeSession.tripCompanionCount ?? 1,
      };

      if (shouldUseBundledGenerateItineraryApi()) {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;
        const apiResult = await generateItineraryViaBundledApi(
          generatePayload as ItineraryInput,
          { token: token ?? undefined },
        );
        if (apiResult.itinerary) {
          itinerary = apiResult.itinerary;
        } else if (isAiItineraryServiceUnavailableError(apiResult.error ?? "")) {
          console.warn("[ITINERARY] AI unavailable, using local fallback", apiResult.error);
          itinerary = buildLocalItineraryFallback(localFallbackInput);
          usedLocalItineraryFallback = true;
        } else {
          throw new Error(apiResult.error ?? "生成行程失敗");
        }
      } else {
        try {
          const response = await generate({ data: generatePayload });
          if (!response?.itinerary) {
            throw new Error("生成行程失敗（伺服器無回應）");
          }
          itinerary = response.itinerary;
        } catch (genErr) {
          const genMsg = genErr instanceof Error ? genErr.message : "生成行程失敗";
          if (isAiItineraryServiceUnavailableError(genMsg)) {
            console.warn("[ITINERARY] AI unavailable, using local fallback", genMsg);
            itinerary = buildLocalItineraryFallback(localFallbackInput);
            usedLocalItineraryFallback = true;
          } else {
            throw genErr;
          }
        }
      }

      const mergedItinerary = ensureSelectedPlacesInItinerary(
        itinerary.itinerary ?? [],
        rawPlaces,
        startDate,
      );
      itinerary.itinerary = mergedItinerary;

      const legPlaces = mergedItinerary
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
      let routeLegs: Array<{ durationMinutes: number; distanceMeters: number }> = [];
      try {
        routeLegs = await getTripLegsWithDurations(
          legPlaces,
          travelLabelToRoutesMode(activeSession.transportation ?? "步行"),
        );
      } catch (routeErr) {
        console.warn("[ITINERARY] route legs skipped", routeErr);
      }
      const weatherSummary = bundle.weather
        ? `${bundle.weather.city} ${bundle.weather.condition} ${bundle.weather.tempC ?? ""}C`
        : "天氣資料暫不可用";
      let coverUrl = "";
      try {
        const cover = await getTripCoverImage({
          destination,
          mood: activeSession.mood ?? "",
          moodTag: activeSession.mood ?? "",
          title: itinerary.title,
        });
        coverUrl = cover.url;
      } catch (coverErr) {
        console.warn("[ITINERARY] cover image skipped", coverErr);
      }

      let tripPayload: RoamiePayloadV2 = {
        ...itinerary,
        destination,
        destinationLocation: activeSession.tripDestination ?? undefined,
        userSaved: true,
        weatherSummary,
        outfitAdvice: itinerary.outfitAdvice,
        outfitAdviceInputKey: buildOutfitInputKey({
          destination,
          startDate,
          endDate,
          dayCount: tripDays,
          itemsFingerprint: buildTripItemsFingerprint(mergedItinerary),
        }),
        aiGeneratedCoverImageUrl: coverUrl || undefined,
        tripSettings: {
          ...itinerary.tripSettings,
          tripStartDate: startDate,
          tripEndDate: endDate,
          transport:
            activeSession.transportation === "開車"
              ? "drive"
              : activeSession.transportation === "大眾運輸"
                ? "transit"
                : activeSession.transportation === "機車"
                  ? "scooter"
                  : "walk",
          transitLegs: Object.fromEntries(
            routeLegs.map((leg, idx) => [
              `${itinerary.itinerary[idx]?.placeName ?? idx}→${itinerary.itinerary[idx + 1]?.placeName ?? idx + 1}`,
              {
                headline: `${leg.distanceMeters}m`,
                durationMinutes: leg.durationMinutes,
                distanceMeters: leg.distanceMeters,
              },
            ]),
          ),
        },
      };
      const saved = await confirmSaveTrip(tripPayload, "chat");
      clearDraftTrip();

      const doneSession: ChatPlanningSession = {
        ...activeSession,
        phase: "done",
        draftTrip: undefined,
        lastGeneratedTripId: saved.id,
      };
      persistSession(doneSession);

      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: usedLocalItineraryFallback
          ? `${itinerary.summary}\n\n行程已建立並加入收藏，你可以調整時間、交通與細節。`
          : `${itinerary.summary}\n\n行程已建立並加入收藏，你可以查看每日穿搭建議與調整細節。`,
        roamie: {
          ...tripPayload,
          itinerary: itinerary.itinerary,
          outfitAdvice: itinerary.outfitAdvice,
        },
      };
        setMsgs((prev) => [...prev, assistantMsg]);
      recordItineraryDiagnostics({
        selectedPlaces: selectedPlacesDiagnosticsSnapshot(rawPlaces),
        generationSource: source,
        errorMessage: usedLocalItineraryFallback ? "local_itinerary_fallback" : null,
        itineraryPayload: {
          title: tripPayload.title,
          itinerary_count: mergedItinerary.length,
          selected_count: rawPlaces.length,
          usedLocalItineraryFallback,
        },
      });
      toast.success(
        usedLocalItineraryFallback ? "已建立基本行程（AI 暫不可用）" : "行程已建立並加入收藏",
      );
      logTripNav("ChatGeneratedTrip", saved.id);
      navigate(tripDetailNavigateOptions(saved.id, { back: "saved", replace: true }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "生成行程失敗";
      persistSession({
        ...activeSession,
        phase: "followup",
        lastItineraryError: msg,
      });
      recordItineraryDiagnostics({
        selectedPlaces: selectedPlacesDiagnosticsSnapshot(rawPlaces),
        generationSource: source,
        errorMessage: msg,
        itineraryPayload: payloadPreview,
      });
      setMsgs((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `行程生成失敗：${msg}\n\n請確認網路連線後再試一次，或稍後重按「開始安排行程」。`,
        },
      ]);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  handleGenerateItineraryFromPlaceRef.current = async (rec: RoamieRecommendationItem) => {
    if (streaming || generating || openerLoading) return;
    const item = roamieRecToChatItem(rec);
    const source = inferPlaceSelectionSource(session);
    let nextSession = addSelectedPlace(session, item, { source });
    nextSession = {
      ...nextSession,
      phase: "ready",
      lastItineraryGenerationSource: source,
    };
    persistSession(nextSession);
    await handleGenerateItinerary(nextSession, msgs, source);
  };

  const handleGenerateItineraryFromPlace = useCallback(
    (rec: RoamieRecommendationItem) => handleGenerateItineraryFromPlaceRef.current(rec),
    [],
  );

  const clearComposerInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const lastUserSendRef = useRef(0);
  const send = async (
    overrideText?: string,
    options?: {
      forcePhase?: import("@/lib/ai/context").ChatPhase;
      /** 畫面上顯示的使用者訊息（快捷 chip 用 chip 原文） */
      displayText?: string;
    },
  ) => {
    const trimmed = (overrideText ?? inputRef.current?.value ?? draftTextRef.current ?? "").trim();
    const userVisible = (options?.displayText ?? trimmed).trim();
    console.info("[CHAT_SEND_START]", trimmed.slice(0, 80));
    if (!trimmed || !userVisible) {
      console.info("[CHAT_SEND] blocked=empty");
      return;
    }
    if (generatingRef.current) {
      console.info("[CHAT_SEND] blocked=generating");
      return;
    }
    const now = Date.now();
    if (!overrideText && now - lastUserSendRef.current < 200) {
      console.info("[CHAT_SEND] blocked=debounce");
      return;
    }
    lastUserSendRef.current = now;
    if (streamingRef.current) {
      console.warn("[CHAT_SEND] abort stale streaming");
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setPartial({});
    }

    let nextWithUser: ChatMsg[] = [];
    let activeSession = sessionRef.current;
    let gotAssistantReply = false;

    try {
      const userMsg: ChatMsg = { role: "user", content: userVisible };
      nextWithUser = [...msgsRef.current, userMsg];
      setMsgs(nextWithUser);
      msgsRef.current = nextWithUser;
      console.info("[CHAT_USER_MESSAGE_ADDED]", userVisible.slice(0, 80));
      if (!overrideText) {
        clearComposerInput();
      }

      activeSession = applyTripIntentToSession(trimmed, sessionRef.current);
      const merged = mergeTravelContext(activeSession, trimmed);
      activeSession = merged.session;
      activeSession = extractPlanningHintsFromText(trimmed, activeSession);
      activeSession = extractDiscoveryFromText(trimmed, activeSession);
      activeSession = extractChatPlanningContextFromText(trimmed, activeSession);

      const route = resolveChatRoute(trimmed, merged.context, activeSession, locale);
      const tripIntent = parseTripIntentFromText(trimmed, activeSession);

      if (route.mode === "recommend" || tripIntent.readyForRecommendations) {
        activeSession = { ...activeSession, phase: "recommend" };
      }

      const sessionCoordsValid =
        activeSession.location != null &&
        isValidDeviceCoordinate(activeSession.location.lat, activeSession.location.lng);
      if (!sessionCoordsValid) {
        const effective = resolveEffectiveDeviceCoords({ sessionLocation: activeSession.location });
        if (effective) {
          activeSession = {
            ...activeSession,
            location: {
              lat: effective.lat,
              lng: effective.lng,
              city: effective.city ?? activeSession.location?.city ?? "目前位置",
            },
          };
        }
      }

      persistSession(activeSession);

      const instant = resolveInstantChatReply(trimmed, activeSession);
      if (instant?.summary) {
        commitAssistantReply(nextWithUser, instant.summary, activeSession, instant.source);
        persistSession({ ...activeSession, phase: "followup" });
        gotAssistantReply = true;
        return;
      }

      if (route.mode === "itinerary" || isUserConfirmingItinerary(trimmed)) {
        if (activeSession.selectedPlaces.length < 1) {
          toast.message("你可以先選幾個想去的地方，我再幫你把它們排成舒服的路線。");
          commitAssistantReply(
            nextWithUser,
            "你可以先選幾個想去的地方，我再幫你把它們排成舒服的路線 ☺️",
            activeSession,
            "itinerary_hint",
          );
          gotAssistantReply = true;
          return;
        }
        const readySession: ChatPlanningSession = { ...activeSession, phase: "ready" };
        persistSession(readySession);
        await handleGenerateItinerary(readySession, nextWithUser);
        gotAssistantReply = true;
        return;
      }

      if (route.mode === "clarify" && route.question && route.missingKey && !options?.forcePhase) {
        if (shouldUseCompanionAiReply(trimmed, activeSession)) {
          console.info("[AI_ROUTE] companion_ai_over_clarify", trimmed.slice(0, 40));
          await streamChat(nextWithUser, { phase: "discover", userText: trimmed }, activeSession);
          gotAssistantReply = !conversationMissingAssistantReply(msgsRef.current);
          return;
        }
        const lastAssistant = [...msgsRef.current].reverse().find((m) => m.role === "assistant");
        if (lastAssistant?.content.trim() === route.question.trim()) {
          if (isReadyForRecommendation(merged.context, activeSession)) {
            await streamChat(nextWithUser, { phase: "recommend", userText: trimmed }, activeSession);
            gotAssistantReply = !conversationMissingAssistantReply(msgsRef.current);
            return;
          }
        }
        activeSession = markAskedClarifyKey(activeSession, route.missingKey);
        persistSession(activeSession);
        commitAssistantReply(nextWithUser, route.question, activeSession, "clarify");
        gotAssistantReply = true;
        return;
      }

      if (options?.forcePhase === "recommend" && isMoodGroundedChatSession(activeSession)) {
        setStreaming(true);
        setLastFailed(null);
        try {
          const applied = await applyLocalFallback(activeSession, trimmed, nextWithUser);
          gotAssistantReply = applied && !conversationMissingAssistantReply(msgsRef.current);
          if (gotAssistantReply) return;
        } finally {
          setStreaming(false);
        }
      }

      const moodGrounded = isMoodGroundedChatSession(activeSession);
      const wantsPlacesReply =
        route.mode === "recommend" || parseConversationIntent(trimmed).wantsRecommendations;
      if (moodGrounded && (wantsPlacesReply || isChatApiUnreachableOnNative())) {
        setStreaming(true);
        setLastFailed(null);
        try {
          const applied = await applyLocalFallback(activeSession, trimmed, nextWithUser);
          gotAssistantReply = applied && !conversationMissingAssistantReply(msgsRef.current);
          if (gotAssistantReply) return;
        } finally {
          setStreaming(false);
        }
      }

      await streamChat(
        nextWithUser,
        { phase: options?.forcePhase ?? route.chatPhase, userText: trimmed },
        activeSession,
      );
      gotAssistantReply = !conversationMissingAssistantReply(msgsRef.current);
      console.log("[CHAT_SUBMIT_SUCCESS]");
    } catch (e) {
      console.error("[CHAT_API_ERROR]", e);
      console.log("[CHAT_SUBMIT_ERROR]", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.trim()) toast.error(msg);
      ensurePipelineFallbackReply(
        msgsRef.current.length ? msgsRef.current : nextWithUser,
        activeSession,
        trimmed,
      );
      gotAssistantReply = true;
    } finally {
      if (!gotAssistantReply) {
        ensurePipelineFallbackReply(
          msgsRef.current.length ? msgsRef.current : nextWithUser,
          activeSession,
          trimmed,
        );
      }
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;

  const handleComposerSend = useCallback((trimmed: string) => {
    void sendRef.current(trimmed);
  }, []);

  const draftTextRef = useRef("");

  const handleAdvancedPlanning = useCallback(() => {
    console.info("[CHAT_CHIP_CLICK] chipId=", ADVANCED_PLANNING_CHIP_ID, "→ /plan");
    void navigate({ to: "/plan", search: { from: "chat" } });
  }, [navigate]);

  const handleChipSend = useCallback(
    (chipId: string) => {
      console.info("[CHAT_CHIP_CLICK] chipId=", chipId);
      if (generatingRef.current) return;
      if (streamingRef.current) {
        abortRef.current?.abort();
        abortRef.current = null;
        setStreaming(false);
        setPartial({});
      }
      if (chipId === ADVANCED_PLANNING_CHIP_ID) {
        handleAdvancedPlanning();
        return;
      }
      const outbound = CHIP_OUTBOUND_TEXT[chipId] ?? chipId;
      const forceRecommend =
        chipId.includes("下雨") || chipId.includes("咖啡") || chipId.includes("累");
      void sendRef.current(outbound, {
        forcePhase: forceRecommend ? "recommend" : undefined,
        displayText: chipId,
      });
    },
    [handleAdvancedPlanning, generating, streaming],
  );

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
      clearDraftTrip();
      clearMoodHandoffStorage(recId);
      if (moodThreadKey) clearMoodChatMessages(moodThreadKey);
      handoffStartedRef.current = null;
      homeMoodOpenerStartedRef.current = null;
      chatInitKeyRef.current = null;

      navigate({
        to: "/chat",
        search: { from: "tab" },
        replace: true,
      });

      const fresh = sessionForDefaultTab(createEmptySession());
      persistSession(fresh);
      setMsgs([greetingMsg]);
      setLastFailed(null);
      setPartial({});
      clearComposerInput();
      setClearDialogOpen(false);
    } catch {
      toast.error("清空失敗");
    } finally {
      setClearing(false);
    }
  };

  const hasDraftTrip = Boolean(session.draftTrip ?? loadDraftTrip());
  const showGenerateBtn =
    session.selectedPlaces.length > 0 &&
    !streaming &&
    !generating &&
    !hasDraftTrip &&
    session.phase !== "done";
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
      toast.success("已儲存到收藏");
      logTripNav("ChatSavedTrip", saved.id);
      navigate(tripDetailNavigateOptions(saved.id, { back: "saved", replace: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const chatChips = CHAT_SHORTCUT_CHIPS;

  const handleComposerFocus = useCallback(() => {
    ensureIosLoginLiveInteraction();
    setIosSnapshotLiveInteractionForced(true);
    requestIosSnapshotRefresh("chat-composer-focus", { force: true });
    if (inputRef.current) {
      const v = inputRef.current.value;
      if (v.trim()) console.info("[CHAT_COMPOSER] focus value len=", v.length);
    }
    const stuckMs = busySinceRef.current ? Date.now() - busySinceRef.current : 0;
    if (stuckMs > 25_000) {
      console.warn("[CHAT_COMPOSER] reset stale busy", stuckMs);
      resetChatBusyState();
    }
    requestAnimationFrame(scrollMessagesToEnd);
  }, [resetChatBusyState, scrollMessagesToEnd]);

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
          fallback={{ to: "/" }}
          label="回首頁"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <RoamieAssistantAvatar className="h-9 w-9" showOnlineIndicator />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium leading-tight">Roamie</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {generating
                ? "正在整理你的行程…"
                : streaming
                  ? "Roamie 正在幫你想…"
                  : openerLoading
                    ? "正在準備推薦…"
                    : session.selectedPlaces.length
                    ? `已選 ${session.selectedPlaces.length} 個地方`
                    : "陪你聊聊今天"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setClearDialogOpen(true)}
          disabled={streaming || generating || clearing}
          className="relative z-20 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="清除對話"
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
          style={{ paddingBottom: composerPadPx }}
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
                  ) : (m.roamie?.recommendations?.length ?? 0) > 0 ||
                    (m.roamie?.itinerary?.length ?? 0) > 0 ? (
                    <RoamieResponseView
                      data={m.roamie!}
                      compact
                      showItinerary={
                        session.phase === "done" && (m.roamie?.itinerary?.length ?? 0) > 0
                      }
                      onSavePlace={handleSavePlace}
                      onAddToTrip={(rec) => openAddToTrip(tripPlaceFromRecommendation(rec))}
                      onSelectPlace={handleSelectPlaceForPlanning}
                      onGenerateItinerary={(rec) => void handleGenerateItineraryFromPlace(rec)}
                      generatingItinerary={generating}
                      onNavigatePlace={handleNavigatePlace}
                      planningMode
                      simplifiedPlaceActions
                      outfitAdvice={m.roamie?.outfitAdvice}
                      selectedPlaceNames={selectedNames}
                      savingPlaceName={savingName}
                      savedPlaceNames={savedNames}
                      addToTripLabel={t("chat.addToTrip")}
                      discussPlaceLabel={t("trip.discussPlace")}
                    />
                  ) : m.content?.trim() ? (
                    <>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
                      {isDiagnosticsModeEnabled() ? (
                        <RecommendationDiagnosticsToolbar
                          scope="聊聊（純文字）"
                          items={[]}
                          downloadPayload={{ chat_recommendation_cards: [] }}
                          exportMeta={{
                            scope: "聊聊（純文字）",
                            note: "助理以純文字回覆，未產生地點卡（常見於附近無營業中結果）",
                            summary_excerpt: m.content.slice(0, 800),
                            response_kind: "text_only",
                            chat_phase: session.phase,
                            last_error: lastFailed ? "previous_stream_failed" : null,
                            user_location: (() => {
                              const effective = resolveEffectiveDeviceCoords({
                                sessionLocation: session.location,
                              });
                              return effective
                                ? { lat: effective.lat, lng: effective.lng, source: effective.source }
                                : null;
                            })(),
                            location_invalid:
                              session.location != null &&
                              !isValidDeviceCoordinate(
                                session.location.lat,
                                session.location.lng,
                              ),
                          }}
                        />
                      ) : null}
                    </>
                  ) : hasMeaningfulRoamiePayload(m.roamie) ? (
                    <RoamieResponseView
                      data={m.roamie!}
                      compact
                      showItinerary={
                        session.phase === "done" && (m.roamie?.itinerary?.length ?? 0) > 0
                      }
                      onSavePlace={handleSavePlace}
                      onAddToTrip={(rec) => openAddToTrip(tripPlaceFromRecommendation(rec))}
                      onSelectPlace={handleSelectPlaceForPlanning}
                      onGenerateItinerary={(rec) => void handleGenerateItineraryFromPlace(rec)}
                      generatingItinerary={generating}
                      onNavigatePlace={handleNavigatePlace}
                      planningMode
                      simplifiedPlaceActions
                      outfitAdvice={m.roamie?.outfitAdvice}
                      selectedPlaceNames={selectedNames}
                      savingPlaceName={savingName}
                      savedPlaceNames={savedNames}
                      addToTripLabel={t("chat.addToTrip")}
                      discussPlaceLabel={t("trip.discussPlace")}
                    />
                  ) : streaming && i === msgs.length - 1 ? (
                    hasMeaningfulRoamiePayload(partial) || partial.summary?.trim() ? (
                      <RoamieResponseView
                        data={{ ...partial, summary: partial.summary ?? "" }}
                        compact
                        showItinerary={false}
                        onSavePlace={handleSavePlace}
                        onAddToTrip={(rec) => openAddToTrip(tripPlaceFromRecommendation(rec))}
                        onSelectPlace={handleSelectPlaceForPlanning}
                        onGenerateItinerary={(rec) => void handleGenerateItineraryFromPlace(rec)}
                        generatingItinerary={generating}
                        onNavigatePlace={handleNavigatePlace}
                        planningMode
                        simplifiedPlaceActions
                        outfitAdvice={partial.outfitAdvice}
                        selectedPlaceNames={selectedNames}
                        savingPlaceName={savingName}
                        savedPlaceNames={savedNames}
                        addToTripLabel={t("chat.addToTrip")}
                        discussPlaceLabel={t("trip.discussPlace")}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
                        </span>
                      </p>
                    )
                  ) : (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      回覆未完成，請再試一次或點下方重試。
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
          className="chat-composer-shell pointer-events-auto relative z-[200] shrink-0 transition-[padding-bottom] duration-200 ease-out"
          style={{
            paddingBottom: keyboardVisible
              ? `${composerBottomInset}px`
              : "max(6px, env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div className="chat-keyboard-follow-group">
            <ChatComposer
              onSend={handleComposerSend}
              onFocus={handleComposerFocus}
              onDraftChange={(value) => {
                draftTextRef.current = value;
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
              onChipSend={handleChipSend}
              onAdvancedPlanning={handleAdvancedPlanning}
              onGenerateClick={() => void sendRef.current("就這樣吧，可以開始安排")}
              onSaveTrip={() => void handleConfirmSaveTrip()}
              onViewDraft={() => navigate({ to: "/trip", search: { draft: "1" } })}
              onViewSavedTrip={(tripId) => {
                logTripNav("ChatGeneratedTrip", tripId);
                navigate(tripDetailNavigateOptions(tripId, { back: "saved", replace: true }));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
