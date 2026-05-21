import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Send, Sparkles, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  loadChatHistory,
  writeGuestChat,
  clearChatHistory,
  type ChatMsg,
} from "@/lib/chat-history";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { getWeather } from "@/lib/weather.functions";
import { streamRoamieAI, fetchRoamieAI } from "@/lib/ai/stream-client";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { getPreferences } from "@/lib/preferences-storage";
import { generateItinerary } from "@/lib/itinerary.functions";
import { saveItinerary } from "@/lib/itinerary-storage";
import { getRecommendation } from "@/lib/recommendation-storage";
import { inferDestinationFromPlaces } from "@/lib/itinerary-source";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import {
  loadChatSession,
  saveChatSession,
  clearChatSession,
  createEmptySession,
  mergeSessionFromRoamie,
  addSelectedPlace,
  extractPlanningHintsFromText,
  canGenerateItinerary,
  buildConversationSummary,
  initSessionFromRecommendation,
  roamieRecToChatItem,
  placeDisplayName,
  buildHandoffOpeningFallback,
  buildHandoffRoamiePayload,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";

type ChatSearch = { from?: string; recommendationId?: string };

export const Route = createFileRoute("/_app/chat")({
  validateSearch: (s: Record<string, unknown>): ChatSearch => ({
    from: typeof s.from === "string" ? s.from : undefined,
    recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
  }),
  component: Chat,
});

const GREETING: ChatMsg = {
  role: "assistant",
  content: "嘿，今天過得怎麼樣？想找個地方放空，還是有想去的方向了？慢慢說，我聽。",
};

function Chat() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [msgs, setMsgs] = useState<ChatMsg[]>([GREETING]);
  const [session, setSession] = useState<ChatPlanningSession>(() => loadChatSession());
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [lastFailed, setLastFailed] = useState<ChatMsg[] | null>(null);
  const [partial, setPartial] = useState<Partial<RoamieResponse>>({});
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handoffStartedRef = useRef(false);
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
    (async () => {
      try {
        let session = loadChatSession();

        if (search.from === "recommendations" && search.recommendationId) {
          const record = await getRecommendation(search.recommendationId);
          if (record?.payload?.recommendations?.length) {
            const bundle = await buildClientContextBundle(fetchWeather);
            const prefs = await getPreferences();
            const payload = record.payload;
            const alreadyFromRecPage =
              session.recommendationId === record.id && session.recommendedPlaces.length > 0;

            if (alreadyFromRecPage) {
              session = {
                ...session,
                location: bundle.location,
                weather: bundle.weather,
                preferences: prefs,
                pendingHandoff: session.pendingHandoff ?? true,
              };
            } else {
              session = initSessionFromRecommendation({
                moodTag: payload.moodTag ?? record.mood ?? undefined,
                summary: payload.summary,
                title: payload.title || record.title,
                recommendations: payload.recommendations,
                selectedPlaces: session.selectedPlaces,
                recommendationId: record.id,
                location: bundle.location,
                weather: bundle.weather,
                preferences: prefs,
              });
            }
            persistSession(session);
          }
        } else {
          persistSession(session);
        }

        const places = await listPlaces();
        setSavedNames(new Set(places.map((p) => p.name)));

        const current = loadChatSession();
        if (current.pendingHandoff && !handoffStartedRef.current) {
          handoffStartedRef.current = true;
          await runRecommendationHandoff(current);
        } else {
          const history = await loadChatHistory();
          if (history.length) setMsgs(history);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setHydrating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.recommendationId, search.from]);

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
        focusedPlace: ChatPlaceItem;
      }>,
    ) => {
      const bundle = await buildClientContextBundle(fetchWeather);
      const prefs = await getPreferences();
      const apiMessages = conversation
        .filter((m) => m.content.trim() && m !== GREETING)
        .map((m) => ({
          role: m.role,
          content: m.role === "assistant" && m.roamie ? JSON.stringify(m.roamie) : m.content,
        }));
      const lastUser = [...apiMessages].reverse().find((m) => m.role === "user");
      const phase =
        overrides?.chatPhase ??
        (session.phase === "done" ? "collect" : session.phase === "generating" ? "collect" : session.phase);

      const apiPhase: import("@/lib/ai/context").ChatPhase =
        overrides?.chatPhase ??
        (phase === "generating" || phase === "done" ? "collect" : phase);

      const savedList = await listPlaces();
      return toRoamieRequest("chat", bundle, {
        mood: session.mood,
        preferences: prefs,
        chatInput: overrides?.chatInput ?? lastUser?.content,
        messages: apiMessages,
        chatPhase: apiPhase === "generating" ? "collect" : apiPhase,
        focusedPlace: overrides?.focusedPlace,
        selectedPlaces: session.selectedPlaces,
        recommendedPlaces: session.recommendedPlaces,
        recentRecommendationNames: loadRecentRecommendationNames(),
        savedPlaceNames: savedList.map((p) => p.name),
        planningHints: {
          transportation: session.transportation,
          budget: session.budget,
          pace: session.pace,
          travelDate: session.travelDate,
          startTime: session.startTime,
          endTime: session.endTime,
          conversationSummary: buildConversationSummary(session, conversation),
        },
      });
    },
    [fetchWeather, session],
  );

  const runRecommendationHandoff = useCallback(
    async (handoffSession: ChatPlanningSession) => {
      setStreaming(true);
      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;
        const bundle = await buildClientContextBundle(fetchWeather);
        const prefs = await getPreferences();

        const req = toRoamieRequest("chat", bundle, {
          mood: handoffSession.mood,
          preferences: prefs,
          chatPhase: "handoff",
          selectedPlaces: handoffSession.selectedPlaces,
          recommendedPlaces: handoffSession.recommendedPlaces,
          recentRecommendationNames: loadRecentRecommendationNames(),
          savedPlaceNames: (await listPlaces()).map((p) => p.name),
          planningHints: {
            conversationSummary: handoffSession.conversationSummary,
          },
        });

        let summary = buildHandoffOpeningFallback(handoffSession);
        let roamiePayload = buildHandoffRoamiePayload(handoffSession, summary);

        try {
          const full = await fetchRoamieAI(req, { token });
          if (full.summary?.trim()) {
            summary = full.summary;
            roamiePayload = {
              ...buildHandoffRoamiePayload(handoffSession, summary),
              recommendations:
                full.recommendations?.length > 0
                  ? full.recommendations.map(roamieRecToChatItem)
                  : handoffSession.recommendedPlaces,
            };
          }
        } catch (e) {
          console.warn("[Roamie] handoff AI failed, using fallback", e);
        }

        const opener: ChatMsg = {
          role: "assistant",
          content: summary,
          roamie: roamiePayload,
        };
        setMsgs([opener]);
        if (!authSession.session) writeGuestChat([opener]);

        const recs = (roamiePayload.recommendations ?? []) as ChatPlaceItem[];

        const nextSession: ChatPlanningSession = {
          ...handoffSession,
          pendingHandoff: false,
          phase: handoffSession.selectedPlaces.length ? "followup" : "collect",
          recommendedPlaces: recs.length ? recs : handoffSession.recommendedPlaces,
        };
        persistSession(nextSession);
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
    ) => {
      setStreaming(true);
      setLastFailed(null);
      setPartial({});
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token;

        setMsgs((prev) => [...prev, { role: "assistant", content: "" }]);

        const req = await buildRequest(conversation, {
          chatPhase: opts?.phase,
          chatInput: opts?.userText,
          focusedPlace: opts?.focusedPlace,
        });

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
          recordRecommendationNames(full.recommendations.map((r) => r.name));
        }

        let nextSession = mergeSessionFromRoamie(
          session,
          full,
          opts?.phase === "followup" ? "collect" : session.phase === "recommend" ? "collect" : session.phase,
        );
        if (
          /整理成一趟|幫你整理|舒服的行程|完整行程|要幫你整理/.test(full.summary) ||
          nextSession.phase === "ready"
        ) {
          nextSession = { ...nextSession, phase: "ready" };
        }
        persistSession(nextSession);

        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: full.summary,
            roamie: full,
          };
          if (!authSession.session) writeGuestChat(next);
          return next;
        });
        setPartial({});
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "聊天失敗";
        console.error("[Roamie AI] chat failed", e);
        toast.error(msg);
        setMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
          return prev;
        });
        setPartial({});
        setLastFailed(conversation);
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [buildRequest, session, persistSession],
  );

  const handleSelectPlace = async (rec: RoamieRecommendationItem) => {
    if (streaming || generating) return;
    const item = roamieRecToChatItem(rec);
    let nextSession = addSelectedPlace(session, item);
    nextSession = { ...nextSession, phase: "followup" };
    persistSession(nextSession);

    const userLine = `我很喜歡「${placeDisplayName(item)}」這種感覺（${item.type}），請當成偏好參考，不一定要第一站，幫我延伸附近適合的點與動線。`;
    const conversation: ChatMsg[] = [...msgs, { role: "user", content: userLine }];
    setMsgs(conversation);

    await streamChat(conversation, { phase: "followup", userText: userLine, focusedPlace: item });
  };

  const send = async (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || streaming || generating) return;

    let nextSession = extractPlanningHintsFromText(trimmed, session);
    if (nextSession.phase === "recommend" && nextSession.selectedPlaces.length) {
      nextSession = { ...nextSession, phase: "collect" };
    } else if (nextSession.phase === "followup") {
      nextSession = { ...nextSession, phase: "collect" };
    }
    persistSession(nextSession);

    const next: ChatMsg[] = [...msgs, { role: "user", content: trimmed }];
    setMsgs(next);
    setText("");

    const apiPhase =
      nextSession.phase === "ready"
        ? "confirm"
        : nextSession.phase === "generating"
          ? "collect"
          : nextSession.phase;

    await streamChat(next, {
      phase: apiPhase as import("@/lib/ai/context").ChatPhase,
      userText: trimmed,
    });
  };

  const handleGenerateItinerary = async () => {
    if (!canGenerateItinerary(session) || generating) return;
    setGenerating(true);
    persistSession({ ...session, phase: "generating" });

    try {
      const bundle = await buildClientContextBundle(fetchWeather);
      const prefs = await getPreferences();
      const places = session.selectedPlaces;
      const destination =
        inferDestinationFromPlaces(places, bundle.location) ||
        bundle.location.city ||
        "目前位置";
      const today = new Date().toISOString().slice(0, 10);
      const budget = budgetModeToItineraryTier(resolveBudgetMode(prefs));

      const { itinerary } = await generate({
        data: {
          destination,
          days: 1,
          budget,
          style: session.pace === "排滿" ? "緊湊" : "慢旅行",
          mood: session.mood ?? "",
          interests: buildConversationSummary(session, msgs),
          conversationSummary: buildConversationSummary(session, msgs),
          startDate: session.travelDate || today,
          endDate: session.travelDate || today,
          origin: bundle.location.city ?? "",
          travelers: 1,
          transport: session.transportation ?? "",
          selectedPlaces: places,
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: bundle.time,
        },
      });

      const saved = await saveItinerary(itinerary);
      const doneSession: ChatPlanningSession = {
        ...session,
        phase: "done",
        lastGeneratedTripId: saved.id,
      };
      persistSession(doneSession);

      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: itinerary.summary,
        roamie: { ...itinerary, itinerary: itinerary.itinerary },
      };
      setMsgs((prev) => [...prev, assistantMsg]);
      toast.success("行程已生成！");
    } catch (e) {
      persistSession({ ...session, phase: "collect" });
      toast.error(e instanceof Error ? e.message : "生成行程失敗");
    } finally {
      setGenerating(false);
    }
  };

  const retry = async () => {
    if (!lastFailed || streaming) return;
    await streamChat(lastFailed);
  };

  const handleClear = async () => {
    if (streaming || generating) return;
    try {
      await clearChatHistory();
      clearChatSession();
      setMsgs([GREETING]);
      persistSession(createEmptySession());
      setLastFailed(null);
      toast.success("已清空對話");
    } catch {
      toast.error("清空失敗");
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const showGenerateBtn =
    canGenerateItinerary(session) && session.phase !== "done" && !streaming && !generating;

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <BackButton
          preferFallback={
            search.from === "recommendations" &&
            !!(search.recommendationId || session.recommendationId)
          }
          fallback={{
            to: "/recommendations",
            search: {
              id: (search.recommendationId || session.recommendationId)!,
            },
          }}
        />
        <div className="flex flex-1 items-center gap-2.5">
          <div className="relative h-9 w-9 rounded-full bg-accent">
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-sage" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-medium leading-tight">Roamie</p>
            <p className="text-[11px] text-muted-foreground">
              {generating
                ? "正在整理你的行程…"
                : streaming
                  ? "Roamie 正在幫你想…"
                  : session.selectedPlaces.length
                    ? `已選 ${session.selectedPlaces.length} 個地方`
                    : "陪你聊聊今天"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={streaming || generating || msgs.length <= 1}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted disabled:opacity-30"
            aria-label="清空對話"
            title="清空對話"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 px-5 py-5">
        {hydrating && (
          <div className="flex justify-center pt-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!hydrating &&
          msgs.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-rise`}
            >
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
                    showItinerary={(m.roamie?.itinerary?.length ?? partial.itinerary?.length ?? 0) > 0}
                    onSavePlace={handleSavePlace}
                    onSelectPlace={handleSelectPlace}
                    selectedPlaceNames={selectedNames}
                    savingPlaceName={savingName}
                    savedPlaceNames={savedNames}
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

      <div className="sticky bottom-0 border-t border-border bg-background/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur">
        <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">
          {session.selectedPlaces.length > 0 && session.phase !== "done" && (
            <button
              type="button"
              onClick={handleGenerateItinerary}
              disabled={generating || streaming || !canGenerateItinerary(session)}
              className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 inline h-3 w-3" />
              )}
              立即生成行程
            </button>
          )}
          {showGenerateBtn && session.selectedPlaces.length === 0 && (
            <button
              type="button"
              onClick={handleGenerateItinerary}
              disabled={generating}
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs disabled:opacity-50"
            >
              幫我整理成舒服行程
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
              查看完整行程
            </button>
          )}
          <Link
            to="/plan"
            className="shrink-0 rounded-full border border-dashed border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground"
          >
            進階手動規劃
          </Link>
          {session.phase === "ready" && (
            <button
              type="button"
              onClick={() => send("完成了，幫我排行程")}
              disabled={streaming || generating}
              className="shrink-0 rounded-full border border-foreground bg-card px-3 py-1.5 text-xs font-medium"
            >
              完成了，幫我排行程
            </button>
          )}
          {["我今天有點累", "想找安靜的咖啡廳", "下雨天可以去哪", "推薦在地小店"].map((s) => (
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
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
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
      </div>
    </div>
  );
}
