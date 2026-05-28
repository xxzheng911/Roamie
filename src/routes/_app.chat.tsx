import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import {
  estimateNativeKeyboardHeight,
  isCapacitorNativeShell,
  logChatKeyboardHide,
  logChatKeyboardShow,
  logComposerLayoutSnapshot,
  measureVisualViewportKeyboardInset,
  parseKeyboardEventHeight,
  resolveComposerBottomInset,
} from "@/lib/chat-keyboard-layout";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { setIosSnapshotLiveInteraction } from "@/lib/ios-snapshot-bridge";
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
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
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
import { generateItinerary } from "@/lib/itinerary.functions";
import { confirmSaveTrip } from "@/lib/itinerary-storage";
import { clearDraftTrip, loadDraftTrip, saveDraftTrip } from "@/lib/trip-draft-storage";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { getRecommendation } from "@/lib/recommendation-storage";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import { recommendationsForChatDisplay } from "@/lib/chat-display-recommendations";
import { persistChatUiMessages, consumePreservedChatUiMessages } from "@/lib/chat-ui-store";
import { openPlaceNavigation } from "@/lib/maps-navigation";
import { navigateToPlaceDetailFromRecommendation } from "@/lib/ai-place-detail-nav";
import {
  buildPlaceDiscussionUserLine,
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
import { readHomeMood, writeHomeMood } from "@/lib/home-mood";
import {
  buildTravelContext,
  extractTravelIntent,
  updateTripDraftFromConversation,
} from "@/services/aiTravelContextService";
import {
  mergeTravelContext,
  formatTravelContextForAi,
  isReadyForRecommendation,
} from "@/lib/ai/travel-context";
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
import { filterVerifiedRecommendations } from "@/lib/place-verification";
import { withSearchTimeout } from "@/lib/search-timeout";
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

function Chat() {
  useIosInteractiveRoute("chat");
  useEffect(() => {
    setIosSnapshotLiveInteraction(true);
    return () => {
      setIosSnapshotLiveInteraction(false);
    };
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
  const [session, setSession] = useState<ChatPlanningSession>(() => loadChatSession());
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
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [reportedKeyboardHeightPx, setReportedKeyboardHeightPx] = useState(0);
  /** 鍵盤動畫結束後強制重算 composer inset（native resize 後 clearance 才準） */
  const [composerLayoutRev, setComposerLayoutRev] = useState(0);
  const autoPromptHandledRef = useRef(false);
  const preservedChatRestoredRef = useRef(false);

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
      console.info("[Chat Composer Shell Height]", h);
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

  const persistSession = useCallback((next: ChatPlanningSession) => {
    setSession(next);
    saveChatSession(next);
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
        composerShellEl: composerShellRef.current,
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
        requestAnimationFrame(() => {
          setComposerLayoutRev((n) => n + 1);
          scrollMessagesToEnd();
        });
      }
    };

    const reconcileNativeKeyboard = (info: unknown) => {
      const reported = parseKeyboardEventHeight(info);
      applyKeyboard(reported, true);
      if (reported > 50) return;
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
      vv?.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("scroll", syncFromViewport);
      removeCapKeyboard?.();
    };
  }, [scrollMessagesToEnd]);

  useEffect(() => {
    if (!keyboardVisible) return;
    scrollMessagesToEnd();
  }, [keyboardVisible, msgs.length, scrollMessagesToEnd]);

  useEffect(() => {
    if (streaming) return;
    requestAnimationFrame(scrollMessagesToEnd);
  }, [streaming, msgs, scrollMessagesToEnd]);

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

        let session = loadChatSession();
        const moodFromHome = search.mood?.trim() || readHomeMood();
        if (moodFromHome) {
          const moodPrompt =
            search.prompt?.trim() || `我想${moodFromHome}，幫我看看附近適合去哪裡。`;
          let moodSession: ChatPlanningSession = {
            ...session,
            mood: moodFromHome,
            selectedMood: moodFromHome,
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
          writeHomeMood(moodFromHome);
          persistSession(session);
        } else if (search.from === "plus-home" && hasPlusAccess && !session.fromPlusHome) {
          const prefs = await getPreferences();
          session = preparePlusHomeChatSession({
            mood: moodFromHome ?? session.selectedMood,
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
          search.from === "plan" &&
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
          else if (!current.fromMoodFlow && !current.fromMoodCard && !current.fromPlusHome) {
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
  }, [search.recommendationId, search.from, search.mood, hasPlusAccess]);

  useEffect(() => {
    if (hydrating) return;
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
  }, [hydrating, search.prompt]);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, streaming, partial, generating]);

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
      const intentBlock = formatConversationIntentForAi(parseConversationIntent(userText));
      const initialCtx = [
        intentBlock,
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

        const filteredRecs = recommendationsForChatDisplay(
          syncedHandoff,
          "",
          (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
        );
        if (filteredRecs.length === 0) {
          const moodText = syncedHandoff.selectedMood ?? syncedHandoff.mood ?? "";
          const { context } = mergeTravelContext(
            syncedHandoff,
            moodText ? `我想${moodText}，幫我看看附近適合去哪裡。` : "",
          );
          let placeResults: Awaited<ReturnType<typeof searchNearbyPlaces>>["places"] = [];
          const lat = syncedHandoff.location?.lat ?? bundle.location?.lat;
          const lng = syncedHandoff.location?.lng ?? bundle.location?.lng;
          if (lat != null && lng != null) {
            try {
              const q = fallbackSearchQuery(context);
              const fallback = await withSearchTimeout(
                searchNearbyPlaces({ data: { query: q, lat, lng, mode: "text" } }),
                20_000,
              );
              placeResults = fallback.places ?? [];
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
          "",
          (roamiePayload.recommendations ?? []) as RoamieRecommendationItem[],
        );
        const opener: ChatMsg = {
          role: "assistant",
          content: summary,
          roamie: { ...roamiePayload, recommendations: displayRecs },
        };
        setMsgs([opener]);

        const recs = (roamiePayload.recommendations ?? []) as ChatPlaceItem[];

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
        setStreaming(false);
      }
    },
    [fetchWeather, persistSession, locale, searchNearbyPlaces],
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
        setStreaming(false);
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
      let placeResults: Awaited<ReturnType<typeof searchNearbyPlaces>>["places"] = [];
      const effective = resolveEffectiveDeviceCoords({ sessionLocation: activeSession.location });
      const lat = effective?.lat;
      const lng = effective?.lng;
      if (lat != null && lng != null) {
        try {
          const q = fallbackSearchQuery(context);
          const fallback = await withSearchTimeout(
            searchNearbyPlaces({
              data: { query: q, lat, lng, mode: "text" },
            }),
            20_000,
            "搜尋逾時，改用離線推薦",
          );
          placeResults = fallback.places ?? [];
          console.info("[MOOD_CHAT_PLACES] candidates=", placeResults.length);
        } catch (fallbackErr) {
          console.warn("[AI_FALLBACK] places search failed", fallbackErr);
        }
      }
      const { summary, payload } = generateLocalRecommendationFallback({
        context,
        session: activeSession,
        locale,
        places: placeResults ?? [],
      });
      const filteredRecs = recommendationsForChatDisplay(
        activeSession,
        activeUserText,
        payload.recommendations ?? [],
      );
      setMsgs((prev) => {
        const withoutTrailingAssistant =
          prev.length > 0 && prev[prev.length - 1]?.role === "assistant"
            ? prev.slice(0, -1)
            : prev;
        return [
          ...withoutTrailingAssistant,
          {
            role: "assistant",
            content: summary,
            roamie: { ...payload, recommendations: filteredRecs },
          },
        ];
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

        let full = await streamRoamieAI(
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
          try {
            full = await fetchRoamieAI(req, { token });
            console.info("[CHAT_API] fetch fallback ok");
          } catch (fetchErr) {
            console.warn("[CHAT_API] fetch fallback failed", fetchErr);
            throw new Error("AI 沒有回應，請再試一次。");
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
        }
        const verifiedRecommendations = filterVerifiedRecommendations(
          resolvedFull.recommendations ?? [],
        );
        if (verifiedRecommendations.length !== (resolvedFull.recommendations?.length ?? 0)) {
          resolvedFull = {
            ...resolvedFull,
            recommendations: verifiedRecommendations,
          };
        }

        const summary = resolvedFull.summary?.trim() ?? "";
        const looksRepeatedClarify =
          /這趟比較想放鬆、拍照，還是吃美食/.test(summary) && /(都有|都可以|都行)/.test(userText);
        const shouldUseLocalFallback =
          aiIntent.type !== "travel_time_advice" &&
          (resolvedFull.recommendations?.length ?? 0) === 0 &&
          (intentForGuard.readyForRecommendations ||
            looksRepeatedClarify ||
            activeSession.fromMoodFlow ||
            activeSession.fromMoodCard ||
            Boolean(activeSession.mood ?? activeSession.selectedMood) ||
            (opts?.phase === "recommend" && aiIntent.type === "place_recommendation") ||
            (req.chatPhase === "recommend" && aiIntent.type === "place_recommendation"));
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
          return next;
        });
        setPartial({});
        submitOk = true;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          const activeForTimeout = sessionOverride ?? session;
          const activeUserText = opts?.userText ?? "";
          const applied = await applyLocalFallback(activeForTimeout, activeUserText, conversation);
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
        const applied = await applyLocalFallback(activeForFallback, activeUserText, conversation);
        if (!applied) {
          if (errMsg.trim()) toast.error(errMsg);
          const hint: ChatMsg = {
            role: "assistant",
            content: "我先用目前掌握的需求幫你整理方向，你可以再跟我說想調整什麼。",
            roamie: {
              title: "",
              summary: "我先用目前掌握的需求幫你整理方向，你可以再跟我說想調整什麼。",
              moodTag: activeForFallback.mood ?? "",
              recommendations: [],
              itinerary: [],
            },
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
        if (submitOk) {
          console.log("[CHAT_SUBMIT_SUCCESS]");
        }
      }
    },
    [buildRequest, session, persistSession, locale, applyLocalFallback],
  );

  const handleOpenPlaceDetail = (rec: RoamieRecommendationItem) => {
    void (async () => {
      const ok = await navigateToPlaceDetailFromRecommendation({
        rec,
        locale,
        navigate: async (opts) => {
          await navigate({ ...opts, replace: false });
        },
        onBeforeNavigate: () => {
          persistChatUiMessages(msgs);
          saveChatSession(session);
        },
      });
      if (!ok) {
        toast.message("此地點暫時無法開啟詳情，請稍後再試");
      }
    })();
  };

  const handleNavigatePlace = (rec: RoamieRecommendationItem) => {
    openPlaceNavigation({
      lat: rec.lat,
      lng: rec.lng,
      address: rec.address,
      placeName: rec.placeName ?? rec.name,
    });
  };

  const handleDiscussPlace = async (rec: RoamieRecommendationItem) => {
    if (streaming || generating) return;
    const item = roamieRecToChatItem(rec);
    const placeId = item.placeId?.trim() || rec.googlePlaceId?.trim() || "";
    console.info("[CHAT_ABOUT_PLACE] placeId=", placeId || "(none)");
    console.info("[CHAT_ABOUT_PLACE] context=", {
      mode: "place_discussion",
      selectedPlace: placeDisplayName(item),
      userIntent: PLACE_DISCUSSION_USER_INTENT,
    });

    let nextSession = addSelectedPlace(session, item);
    nextSession = {
      ...nextSession,
      selectedPlaceFromMood: item,
      phase: "followup",
    };
    persistSession(nextSession);

    const userLine = buildPlaceDiscussionUserLine(placeDisplayName(item));
    const conversation: ChatMsg[] = [...msgs, { role: "user", content: userLine }];
    setMsgs(conversation);

    await streamChat(
      conversation,
      {
        phase: "place_discussion",
        userText: userLine,
        focusedPlace: item,
      },
      nextSession,
    );
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

      const { itinerary } = await generate({
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
          selectedPlaces: places,
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: activeSession.startTime || bundle.time,
          fashionStyle: fashionStyle ?? "",
          locale,
        },
      });

      const legPlaces = (itinerary.itinerary ?? [])
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
        userSaved: false,
        weatherSummary,
        outfitSuggestion,
        aiGeneratedCoverImageUrl: cover.url,
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
          itinerary: itinerary.itinerary,
          outfitAdvice: itinerary.outfitAdvice,
        },
      };
      setMsgs((prev) => [...prev, assistantMsg]);
      toast.message("行程草稿已產生，確認後可儲存到收藏");
    } catch (e) {
      persistSession({ ...activeSession, phase: "collect" });
      toast.error(e instanceof Error ? e.message : "生成行程失敗");
    } finally {
      setGenerating(false);
    }
  };

  const clearComposerInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const send = async (
    overrideText?: string,
    options?: { forcePhase?: import("@/lib/ai/context").ChatPhase },
  ) => {
    const trimmed = (overrideText ?? inputRef.current?.value ?? "").trim();
    console.log("[CHAT_SEND]", trimmed);
    if (!trimmed) {
      console.info("[CHAT_SEND] disabled=empty");
      return;
    }
    if (generating) {
      console.info("[CHAT_SEND] disabled=generating");
      return;
    }
    if (streaming) {
      console.warn("[CHAT_SEND] abort stale streaming");
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setPartial({});
    }

    console.log("[CHAT_SUBMIT_START]");
    console.info("[CHAT_SEND] submit start", trimmed.slice(0, 48));

    let nextSession = applyTripIntentToSession(trimmed, session);
    const merged = mergeTravelContext(nextSession, trimmed);
    nextSession = merged.session;
    nextSession = extractPlanningHintsFromText(trimmed, nextSession);
    nextSession = extractDiscoveryFromText(trimmed, nextSession);
    nextSession = extractChatPlanningContextFromText(trimmed, nextSession);

    const route = resolveChatRoute(trimmed, merged.context, nextSession, locale);
    const tripIntent = parseTripIntentFromText(trimmed, nextSession);

    if (route.mode === "recommend" || tripIntent.readyForRecommendations) {
      nextSession = { ...nextSession, phase: "recommend" };
    }

    const sessionCoordsValid =
      nextSession.location != null &&
      isValidDeviceCoordinate(nextSession.location.lat, nextSession.location.lng);
    if (!sessionCoordsValid) {
      const effective = resolveEffectiveDeviceCoords({ sessionLocation: nextSession.location });
      if (effective) {
        nextSession = {
          ...nextSession,
          location: {
            lat: effective.lat,
            lng: effective.lng,
            city: effective.city ?? nextSession.location?.city ?? "目前位置",
          },
        };
        persistSession(nextSession);
      }
    }

    persistSession(nextSession);

    const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
    setMsgs(next);
    if (!overrideText) {
      clearComposerInput();
    }

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

    if (route.mode === "clarify" && route.question && route.missingKey) {
      if (shouldUseCompanionAiReply(trimmed, nextSession)) {
        console.info("[AI_ROUTE] companion_ai_over_clarify", trimmed.slice(0, 40));
        try {
          await streamChat(next, { phase: "discover", userText: trimmed }, nextSession);
          console.log("[CHAT_SUBMIT_SUCCESS]");
        } catch (e) {
          console.log("[CHAT_SUBMIT_ERROR]", e);
          throw e;
        }
        return;
      }
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      if (lastAssistant?.content.trim() === route.question.trim()) {
        if (isReadyForRecommendation(merged.context, nextSession)) {
          await streamChat(next, { phase: "recommend", userText: trimmed }, nextSession);
          return;
        }
      }
      nextSession = markAskedClarifyKey(nextSession, route.missingKey);
      persistSession(nextSession);
      setMsgs([...next, { role: "assistant", content: route.question }]);
      return;
    }

    try {
      await streamChat(
        next,
        { phase: options?.forcePhase ?? route.chatPhase, userText: trimmed },
        nextSession,
      );
      console.log("[CHAT_SUBMIT_SUCCESS]");
    } catch (e) {
      console.log("[CHAT_SUBMIT_ERROR]", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.trim()) toast.error(msg);
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;

  const handleComposerSend = useCallback((trimmed: string) => {
    void sendRef.current(trimmed);
  }, []);

  const handleAdvancedPlanning = useCallback(() => {
    console.info("[CHAT_CHIP_CLICK] chipId=", ADVANCED_PLANNING_CHIP_ID, "→ /plan");
    void navigate({ to: "/plan", search: { from: "chat" } });
  }, [navigate]);

  const handleChipSend = useCallback(
    (chipId: string) => {
      console.info("[CHAT_CHIP_CLICK] chipId=", chipId);
      if (hydrating || generating) return;
      if (streaming) {
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
      void sendRef.current(outbound, { forcePhase: forceRecommend ? "recommend" : undefined });
    },
    [handleAdvancedPlanning, hydrating],
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
    session.phase === "ready" &&
    session.selectedPlaces.length > 0 &&
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
      toast.success("已儲存到收藏");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const chatChips = CHAT_SHORTCUT_CHIPS;

  const handleComposerFocus = useCallback(() => {
    requestAnimationFrame(scrollMessagesToEnd);
  }, [scrollMessagesToEnd]);

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
                      onOpenPlaceDetail={handleOpenPlaceDetail}
                      onDiscussPlace={handleDiscussPlace}
                      onNavigatePlace={handleNavigatePlace}
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
                  ) : hasMeaningfulRoamiePayload(m.roamie) ||
                    (streaming && i === msgs.length - 1) ? (
                    <RoamieResponseView
                      data={
                        hasMeaningfulRoamiePayload(m.roamie)
                          ? m.roamie!
                          : { ...partial, summary: partial.summary ?? "" }
                      }
                      compact
                      showItinerary={
                        session.phase === "done" && (m.roamie?.itinerary?.length ?? 0) > 0
                      }
                      onSavePlace={handleSavePlace}
                      onAddToTrip={(rec) => openAddToTrip(tripPlaceFromRecommendation(rec))}
                      onOpenPlaceDetail={handleOpenPlaceDetail}
                      onDiscussPlace={handleDiscussPlace}
                      onNavigatePlace={handleNavigatePlace}
                      simplifiedPlaceActions
                      outfitAdvice={m.roamie?.outfitAdvice}
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
          className="chat-composer-shell relative z-50 shrink-0 transition-[padding-bottom] duration-200 ease-out"
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
                navigate(tripDetailNavigateOptions(tripId));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
