import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles, MessageCircle } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { getRecommendation, type StoredRecommendation } from "@/lib/recommendation-storage";
import { isRoamiePayloadV2, type RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import { buildClientContextBundle } from "@/lib/fetch-context";
import { getWeather } from "@/lib/weather.functions";
import { getPreferences } from "@/lib/preferences-storage";
import {
  initSessionFromRecommendation,
  loadRecPagePicks,
  roamieRecToChatItem,
  saveChatSession,
  saveRecPagePicks,
  toggleSelectedPlace,
  loadChatSession,
} from "@/lib/chat-session";

type RecSearch = { id?: string };

export const Route = createFileRoute("/_app/recommendations")({
  validateSearch: (s: Record<string, unknown>): RecSearch => ({
    id: typeof s.id === "string" ? s.id : undefined,
  }),
  component: RecommendationsPage,
});

function RecommendationsPage() {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const fetchWeather = useServerFn(getWeather);
  const [record, setRecord] = useState<StoredRecommendation | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const [pickedNames, setPickedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    listPlaces()
      .then((p) => setSavedNames(new Set(p.map((x) => x.name))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getRecommendation(id)
      .then((data) => {
        if (!cancelled) {
          setRecord(data);
          const stored = loadRecPagePicks(id);
          if (stored.length) setPickedNames(new Set(stored));
        }
      })
      .catch(() => toast.error("讀取推薦失敗"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const data = record?.payload && isRoamiePayloadV2(record.payload) ? record.payload : null;

  const handleTogglePick = useCallback(
    (rec: RoamieRecommendationItem) => {
      if (!id) return;
      setPickedNames((prev) => {
        const next = new Set(prev);
        if (next.has(rec.name)) next.delete(rec.name);
        else next.add(rec.name);
        saveRecPagePicks(id, [...next]);
        return next;
      });
    },
    [id],
  );

  const handleContinueInChat = async () => {
    if (!record || !data) return;
    if (!data.recommendations?.length) {
      toast.message("沒有推薦地點，請先和 Roamie 聊聊");
      navigate({ to: "/chat" });
      return;
    }
    try {
      const [bundle, prefs] = await Promise.all([
        buildClientContextBundle(fetchWeather),
        getPreferences(),
      ]);
      const selected = data.recommendations
        .filter((r) => pickedNames.has(r.name))
        .map(roamieRecToChatItem);

      const session = initSessionFromRecommendation({
        moodTag: data.moodTag ?? record.mood ?? undefined,
        summary: data.summary,
        title: data.title || record.title,
        recommendations: data.recommendations,
        selectedPlaces: selected,
        recommendationId: record.id,
        location: bundle.location,
        weather: bundle.weather,
        preferences: prefs,
      });
      saveChatSession(session);
      navigate({
        to: "/chat",
        search: { from: "recommendations", recommendationId: record.id },
      });
    } catch (e) {
      console.error("[recommendations] chat handoff failed", e);
      toast.error("無法進入聊天");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 px-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="font-display text-lg">Roamie 正在幫你想…</p>
        <p className="text-sm text-muted-foreground">根據你的心情與天氣挑選中</p>
      </div>
    );
  }

  if (!record || !data) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm text-muted-foreground">找不到推薦結果</p>
        <Link to="/" className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground">
          回首頁
        </Link>
      </div>
    );
  }

  const handleSavePlace = async (rec: RoamieRecommendationItem) => {
    setSavingName(rec.name);
    try {
      const { saved } = await toggleSavePlace({
        name: rec.name,
        category: rec.type,
        address: rec.address || null,
        city: null,
        lat: rec.lat ?? null,
        lng: rec.lng ?? null,
        notes: rec.reason,
        mood_tag: data.moodTag,
        cover_image: null,
      });
      setSavedNames((prev) => {
        const next = new Set(prev);
        if (saved) next.add(rec.name);
        else next.delete(rec.name);
        return next;
      });
      toast.success(saved ? "已收藏" : "已取消收藏");
      if (saved && id) {
        const base = loadChatSession();
        saveChatSession(toggleSelectedPlace(base, roamieRecToChatItem(rec)));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setSavingName(null);
    }
  };

  const pickCount = pickedNames.size;

  return (
    <div className="pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <BackButton preferFallback fallback={{ to: "/" }} />
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-clay" />
          <h1 className="font-display text-lg leading-tight">{data.title || record.title}</h1>
        </div>
      </header>

      <div className="px-5 pt-5">
        <p className="mb-3 text-xs text-muted-foreground">
          點一下卡片即可選取想去的地點，再進入聊天；沒選也可以，Roamie 會請你從候選中挑一個開始。
        </p>
        <RoamieResponseView
          data={data}
          showItinerary={data.itinerary.length > 0}
          pickMode
          pickedPlaceNames={pickedNames}
          onTogglePick={handleTogglePick}
          onSavePlace={handleSavePlace}
          savingPlaceName={savingName}
          savedPlaceNames={savedNames}
        />

        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleContinueInChat}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-center text-sm font-medium text-primary-foreground shadow-lift"
          >
            <MessageCircle className="h-4 w-4" />
            {pickCount > 0
              ? `進入聊天繼續規劃（已選 ${pickCount} 處）`
              : "進入聊天繼續規劃"}
          </button>
          <Link
            to="/plan"
            className="block rounded-full border border-dashed border-border py-2.5 text-center text-xs text-muted-foreground"
          >
            進階：手動填寫行程表單
          </Link>
        </div>
      </div>
    </div>
  );
}
