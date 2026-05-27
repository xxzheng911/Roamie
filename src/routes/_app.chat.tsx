import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  isCapacitorNativeShell,
  logChatInputLayoutRendered,
  logChatKeyboardHide,
  logChatKeyboardShow,
  logInputBarOffsetUpdated,
  logKeyboardHeight,
  resolveChatPageBottomInset,
} from "@/lib/chat-keyboard-layout";
import { useServerFn } from "@tanstack/react-start";
import { Send, Sparkles, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  loadChatHistory,
  clearChatHistory,
  type ChatMsg,
} from "@/lib/chat-history";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { enrichRoamieContext } from "@/lib/ai/enrich-context";
import { resolveEffectivePlanTierWithProfile } from "@/lib/access/resolve";
import { getWeather } from "@/lib/weather.functions";
import { streamRoamieAI, fetchRoamieAI } from "@/lib/ai/stream-client";
import { RoamieAssistantAvatar } from "@/components/RoamieAssistantAvatar";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { PreferenceQuizCta } from "@/components/PreferenceQuizCta";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromRecommendation } from "@/lib/trip/trip-place-input";
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
import { openRecommendationOnMap } from "@/lib/recommendation-place-handoff";
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
  buildClarifyingQuestion,
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
import {
  buildPlanTripHandoffOpening,
  markPlanHandoffComplete,
} from "@/lib/plan-trip-handoff";
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

type ChatSearch = {
  from?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
  mood?: string;
};

export const Route = createFileRoute("/_app/chat")({
  validateSearch: (s: Record<string, unknown>): ChatSearch => ({
    from: typeof s.from === "string" ? s.from : undefined,
    recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
    fromMoodFlow: typeof s.fromMoodFlow === "string" ? s.fromMoodFlow : undefined,
    mood: typeof s.mood === "string" ? s.mood : undefined,
  }),
  component: Chat,
});

function Chat() {
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
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [lastFailed, setLastFailed] = useState<ChatMsg[] | null>(null);
  const [partial, setPartial] = useState<Partial<RoamieResponse>>({});
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handoffStartedRef = useRef<string | null>(null);
  const planHandoffStartedRef = useRef(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardInsetPx, setKeyboardInsetPx] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fetchWeather = useServerFn(getWeather);
  const generate = useServerFn(generateItinerary);

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
    document.documentElement.classList.toggle("chat-keyboard-open", keyboardOpen);
    return () => {
      document.documentElement.classList.remove("chat-keyboard-open");
    };
  }, [keyboardOpen]);

  useEffect(() => {
    let removeCapKeyboard: (() => void) | undefined;
    const isNativeShell = isCapacitorNativeShell();

    const applyKeyboard = (height: number, open: boolean) => {
      const inset = resolveChatPageBottomInset(open, height);
      if (open) {
        logChatKeyboardShow(height);
        logKeyboardHeight(height);
      } else {
        logChatKeyboardHide();
      }
      logInputBarOffsetUpdated(inset, open);
      setKeyboardOpen(open);
      setKeyboardInsetPx(inset);
      if (open) {
        requestAnimationFrame(scrollMessagesToEnd);
      }
    };

    if (isNativeShell) {
      void import("@capacitor/keyboard").then(({ Keyboard }) => {
        const onShow = (info: { keyboardHeight?: number }) => {
          applyKeyboard(info.keyboardHeight ?? 0, true);
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

    const vv = window.visualViewport;
    const syncFromViewport = () => {
      if (isNativeShell) return;
      if (!vv) return;
      const rawInset = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
      const inset = Math.min(rawInset, Math.round(window.innerHeight * 0.55));
      const open = inset > 50;
      if (!open) {
        applyKeyboard(0, false);
        return;
      }
      applyKeyboard(inset, true);
    };

    if (!isNativeShell) {
      syncFromViewport();
      vv?.addEventListener("resize", syncFromViewport);
      vv?.addEventListener("scroll", syncFromViewport);
    }

    return () => {
      vv?.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("scroll", syncFromViewport);
      removeCapKeyboard?.();
    };
  }, [scrollMessagesToEnd]);

  const chatPageBottomInset = keyboardOpen ? keyboardInsetPx : 0;

  useEffect(() => {
    logChatInputLayoutRendered({
      keyboardOpen,
      keyboardInsetPx,
      chatPageBottomInset,
      native: isCapacitorNativeShell(),
    });
  }, [keyboardOpen, keyboardInsetPx, chatPageBottomInset]);

  useEffect(() => {
    if (!keyboardOpen) return;
    scrollMessagesToEnd();
  }, [keyboardOpen, msgs.length, scrollMessagesToEnd]);

  useEffect(() => {
    (async () => {
      try {
        let session = loadChatSession();
        const moodFromHome = search.mood?.trim() || readHomeMood();
        if (moodFromHome) {
          session = {
            ...session,
            mood: moodFromHome,
            selectedMood: moodFromHome,
            fromMoodCard: session.fromMoodCard ?? true,
          };
          writeHomeMood(moodFromHome);
          persistSession(session);
        }

        if (search.from === "plus-home" && hasPlusAccess && !session.fromPlusHome) {
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
            const handoffDone =
              session.moodHandoffDone ||
              isMoodHandoffDoneForRec(record.id);
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
        overrides?.chatPhase ??
        resolveChatApiPhase(synced, userText, undefined, tripIntent);
      const tripIntentBlock = formatTripIntentForAi(tripIntent, prefs);
      console.info("[Roamie AI] request context", {
        phase: apiPhase,
        destination: tripIntent.destinationCity ?? synced.location?.city ?? null,
        missing: tripIntent.missingKeys,
        planTier,
      });
      const initialCtx = [
        synced.initialChatContext ?? buildInitialChatContext(synced),
        buildPlanningMemoryContext(synced),
        tripIntentBlock,
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
        lateNightMode:
          synced.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
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
          conversationSummary: [
            tripIntentBlock,
            buildConversationSummary(synced, conversation),
          ]
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
          lateNightMode:
            syncedHandoff.lateNightMode ?? isLateNightMode(new Date(bundle.time)),
          focusedPlace: focused,
          selectedPlaces: syncedHandoff.selectedPlaces,
          selectedPlaceIds: syncedHandoff.selectedPlaceIds,
          selectedPlaceNames: syncedHandoff.selectedPlaceNames,
          plannedStops: syncedHandoff.plannedStops,
          recommendedPlaces: syncedHandoff.recommendedPlaces,
          recentRecommendationNames: recentNames,
          savedPlaceNames: (await listPlaces()).map((p) => p.name),
          planningHints: {
            conversationSummary: [
              initialCtx,
              syncedHandoff.conversationSummary,
            ]
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
        const opener: ChatMsg = {
          role: "assistant",
          content: summary,
          roamie: { ...roamiePayload, recommendations: filteredRecs },
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

        const full = await streamRoamieAI(req, {
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
        }, { token, signal: controller.signal });

        if (!full) throw new Error("AI 沒有回應，請再試一次。");

        if (full.recommendations?.length) {
          recordRecommendationNames([
            ...full.recommendations.map((r) => r.name),
            ...extractPlaceNames(session.selectedPlaces),
          ]);
        }

        const apiPhaseUsed =
          opts?.phase ?? resolveChatApiPhase(session, opts?.userText ?? "");
        let nextSession = mergeSessionFromRoamie(sessionOverride ?? session, full, (sessionOverride ?? session).phase);
        if (nextSession.recommendedPlaces.length) {
          nextSession = {
            ...nextSession,
            recommendedPlaces: recommendationsForChatDisplay(
              nextSession,
              opts?.userText ?? "",
              nextSession.recommendedPlaces,
            ) as ChatPlaceItem[],
          };
        }
        if (nextSession.phase === "discover" && isDiscoveryComplete(nextSession)) {
          nextSession = { ...nextSession, phase: "followup" };
        }
        nextSession = {
          ...nextSession,
          phase: resolveSessionPhaseAfterReply(
            nextSession,
            Boolean(full.recommendations?.length),
            apiPhaseUsed,
          ),
        };
        persistSession(nextSession);

        const activeSession = sessionOverride ?? session;
        const displayFull = {
          ...full,
          recommendations: recommendationsForChatDisplay(
            activeSession,
            opts?.userText ?? "",
            full.recommendations ?? [],
          ),
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
          const timeoutSummary =
            isDiscoveryComplete(activeForTimeout) ||
            parseTripIntentFromSession(activeForTimeout).readyForRecommendations
              ? "連線有點久，請再試一次，我馬上幫你推薦適合的地點。"
              : "連線有點久，請再試一次。";
          setMsgs((prev) => {
            const trimmedPrev = prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
            );
            return [
              ...trimmedPrev,
              { role: "assistant", content: timeoutSummary },
            ];
          });
          setPartial({});
          setLastFailed(conversation);
          return;
        }
        logAppError("[Roamie AI] chat failed", e, {
          userText: opts?.userText,
          phase: opts?.phase,
        });
        const activeForFallback = sessionOverride ?? session;
        const intent = parseTripIntentFromSession(activeForFallback);
        const fallbackSummary =
          isDiscoveryComplete(activeForFallback) || intent.readyForRecommendations
            ? "我這邊連線有點不順，請再試一次，我馬上幫你推薦適合的地點。"
            : buildClarifyingQuestion(intent, locale);
        const hint: ChatMsg = {
          role: "assistant",
          content: fallbackSummary,
          roamie: {
            title: "",
            summary: fallbackSummary,
            moodTag: activeForFallback.mood ?? "",
            recommendations: [],
            itinerary: [],
          },
        };
        setMsgs((prev) => {
          const trimmedPrev = prev.filter(
            (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
          );
          const next = [...trimmedPrev, hint];
          return next;
        });
        setPartial({});
        setLastFailed(conversation);
      } finally {
        window.clearTimeout(timeoutId);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [buildRequest, session, persistSession, locale],
  );

  const handleOpenPlaceDetail = (rec: RoamieRecommendationItem) => {
    if (rec.lat == null || rec.lng == null) {
      toast.message("此地點尚無座標，暫時無法開啟地圖詳情");
      return;
    }
    openRecommendationOnMap(rec);
    navigate({ to: "/map" });
  };

  const handleSelectPlace = async (rec: RoamieRecommendationItem) => {
    if (streaming || generating) return;
    const item = roamieRecToChatItem(rec);
    let nextSession = addSelectedPlace(session, item);
    nextSession = {
      ...nextSession,
      selectedPlaceFromMood: item,
      phase: "followup",
    };
    persistSession(nextSession);

    const userLine = `我選了「${placeDisplayName(item)}」，想多聊聊這附近還能怎麼安排。`;
    const conversation: ChatMsg[] = [...msgs, { role: "user", content: userLine }];
    setMsgs(conversation);

    await streamChat(conversation, { phase: "enrich", userText: userLine, focusedPlace: item }, nextSession);
  };

  const send = async (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || streaming || generating) return;

    let nextSession = applyTripIntentToSession(trimmed, session);
    nextSession = extractPlanningHintsFromText(trimmed, nextSession);
    nextSession = extractDiscoveryFromText(trimmed, nextSession);
    nextSession = extractChatPlanningContextFromText(trimmed, nextSession);

    const tripIntent = parseTripIntentFromText(trimmed, nextSession);
    if (
      nextSession.phase === "discover" &&
      (isDiscoveryComplete(nextSession) || tripIntent.readyForRecommendations)
    ) {
      nextSession = { ...nextSession, phase: "recommend" };
    }
    persistSession(nextSession);

    const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
    setMsgs(next);
    setText("");

    if (isUserConfirmingItinerary(trimmed)) {
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
      nextSession.phase === "discover" &&
      !isDiscoveryComplete(nextSession) &&
      !tripIntent.readyForRecommendations &&
      tripIntent.missingKeys.length > 0
    ) {
      const hint = buildClarifyingQuestion(tripIntent, locale);
      setMsgs([...next, { role: "assistant", content: hint }]);
      return;
    }

    const apiPhase = resolveChatApiPhase(nextSession, trimmed, undefined, tripIntent);

    await streamChat(next, { phase: apiPhase, userText: trimmed }, nextSession);
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
            : bundle.location.city ?? "",
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

      const draftPayload: RoamiePayloadV2 = {
        ...itinerary,
        userSaved: false,
      };
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

  const discoverChips = [
    "今天想放鬆走走",
    "想探索新地方",
    "主要是想拍照",
    "一個人",
    "跟朋友",
    "室內就好",
    "想去室外",
  ];

  const chatChips =
    session.phase === "discover"
      ? discoverChips
      : session.phase === "collect" && session.selectedPlaces.length > 0
        ? ["就這樣吧，可以開始安排", "想再加一個咖啡廳", "節奏慢一點"]
        : ["我今天有點累", "想找安靜的咖啡廳", "下雨天可以去哪"];

  return (
    <div
      className={cn(
        "chat-page relative flex h-full min-h-0 flex-1 flex-col overflow-hidden",
        !keyboardOpen && "pb-[var(--app-nav-total-height)]",
      )}
      style={chatPageBottomInset > 0 ? { paddingBottom: chatPageBottomInset } : undefined}
    >
      <header className="relative z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
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
                    showItinerary={
                      session.phase === "done" &&
                      (m.roamie?.itinerary?.length ?? 0) > 0
                    }
                    onSavePlace={handleSavePlace}
                    onAddToTrip={(rec) => openAddToTrip(tripPlaceFromRecommendation(rec))}
                    onOpenPlaceDetail={handleOpenPlaceDetail}
                    onDiscussPlace={handleSelectPlace}
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

      <footer
        className="chat-input-bar shrink-0 border-t border-border bg-background/95 px-4 pt-2 backdrop-blur"
        style={{
          paddingBottom: keyboardOpen ? "6px" : "max(6px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        {!keyboardOpen && (
        <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">
          {showGenerateBtn && (
            <button
              type="button"
              onClick={() => send("就這樣吧，可以開始安排")}
              disabled={generating || streaming}
              className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 inline h-3 w-3" />
              )}
              開始安排行程
            </button>
          )}
          {showSaveTripBtn && (
            <button
              type="button"
              onClick={() => void handleConfirmSaveTrip()}
              className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              儲存這趟行程
            </button>
          )}
          {hasDraftTrip && (
            <button
              type="button"
              onClick={() => navigate({ to: "/trip", search: { draft: "1" } })}
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            >
              查看行程草稿
            </button>
          )}
          {session.lastGeneratedTripId && (
            <button
              type="button"
              onClick={() =>
                navigate({ to: "/trip", search: { id: session.lastGeneratedTripId! } })
              }
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            >
              查看已儲存行程
            </button>
          )}
          <Link
            to="/plan"
            className="shrink-0 rounded-full border border-dashed border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground"
          >
            進階手動規劃
          </Link>
          {chatChips.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={streaming || generating}
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        )}
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => {
              requestAnimationFrame(scrollMessagesToEnd);
            }}
            rows={1}
            placeholder="告訴 Roamie 你的心情…"
            className="flex-1 resize-none bg-transparent px-3 py-2 text-[15px] placeholder:text-muted-foreground focus:outline-none"
            disabled={streaming || generating}
          />
          <button
            onClick={() => send()}
            disabled={streaming || generating || !text.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            aria-label="送出"
          >
            {streaming || generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
