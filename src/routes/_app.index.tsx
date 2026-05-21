import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sparkles, ChevronRight, Search, Cloud, Coffee, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import onsen from "@/assets/scene-onsen.jpg";
import { useAvatar } from "@/hooks/use-avatar";
import { getWeather, type WeatherSummary } from "@/lib/weather.functions";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { fetchRoamieAI } from "@/lib/ai/stream-client";
import { saveRecommendation } from "@/lib/recommendation-storage";
import { listPlaces } from "@/lib/places-storage";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { listItineraries } from "@/lib/itinerary-storage";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

const moods = [
  { label: "想放空", emoji: "🍃" },
  { label: "一個人", emoji: "🚶" },
  { label: "下雨天", emoji: "☔" },
  { label: "深夜散步", emoji: "🌙" },
  { label: "找咖啡", emoji: "☕" },
  { label: "看海", emoji: "🌊" },
];

const TAIPEI = { lat: 25.0478, lng: 121.5319, city: "台北" };

function Home() {
  const { avatarSrc } = useAvatar();
  const navigate = useNavigate();
  const fetchWeather = useServerFn(getWeather);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [wLoading, setWLoading] = useState(true);
  const [locating, setLocating] = useState(true);
  const [usedFallbackLocation, setUsedFallbackLocation] = useState(false);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [latestTripId, setLatestTripId] = useState<string | null>(null);
  const [latestTripTitle, setLatestTripTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (lat: number, lng: number, isFallback: boolean) => {
      setUsedFallbackLocation(isFallback);
      fetchWeather({ data: { lat, lng } })
        .then((r) => {
          if (cancelled) return;
          if (r.error) {
            console.warn("[Roamie Weather] home:", r.error);
          }
          if (r.weather) {
            setWeather(r.weather);
            console.info("[Roamie Weather] home ok", r.weather.city, r.weather.condition);
          } else {
            setWeather(null);
          }
        })
        .catch((e) => console.error("[Roamie Weather] home exception", e))
        .finally(() => !cancelled && setWLoading(false));
    };

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setLocating(false);
          console.info("[Roamie Location] home GPS", pos.coords.latitude, pos.coords.longitude);
          load(pos.coords.latitude, pos.coords.longitude, false);
        },
        (err) => {
          if (cancelled) return;
          setLocating(false);
          console.warn("[Roamie Location] home fallback Taipei", err.code);
          load(TAIPEI.lat, TAIPEI.lng, true);
        },
        { timeout: 12000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: true },
      );
    } else {
      setLocating(false);
      load(TAIPEI.lat, TAIPEI.lng, true);
    }
    return () => {
      cancelled = true;
    };
  }, [fetchWeather]);

  useEffect(() => {
    listItineraries()
      .then((trips) => {
        const latest = trips[0];
        if (latest) {
          setLatestTripId(latest.id);
          setLatestTripTitle(latest.title);
        }
      })
      .catch(() => {});
  }, []);

  const tempText =
    weather?.tempC !== null && weather?.tempC !== undefined ? `${Math.round(weather.tempC)}°` : "";
  const condText = weather?.condition ?? "多雲";
  const cityText = usedFallbackLocation
    ? TAIPEI.city
    : weather?.city && weather.city !== "目前位置"
      ? weather.city
      : wLoading || locating
        ? "定位中…"
        : "目前位置";
  const headerStatus = locating
    ? "取得位置中…"
    : wLoading
      ? "讀取天氣中…"
      : `${cityText} · ${condText}${tempText ? ` · ${tempText}` : ""}`;

  const handleRecommend = async () => {
    if (!selectedMood) {
      toast.message("先選一個心情吧");
      return;
    }
    setAiLoading(true);
    try {
      const [bundle, savedPlaces] = await Promise.all([
        buildClientContextBundle(fetchWeather),
        listPlaces(),
      ]);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const data = await fetchRoamieAI(
        toRoamieRequest("recommend", bundle, {
          mood: selectedMood,
          recentRecommendationNames: loadRecentRecommendationNames(),
          savedPlaceNames: savedPlaces.map((p) => p.name),
        }),
        { token },
      );

      recordRecommendationNames(data.recommendations.map((r) => r.name));
      const saved = await saveRecommendation(data, { mood: selectedMood });
      navigate({ to: "/recommendations", search: { id: saved.id } });
    } catch (e) {
      console.error("[Roamie AI] home recommend failed", e);
      toast.error(e instanceof Error ? e.message : "推薦失敗，請稍後再試");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="px-5 pt-3 pb-6 animate-rise">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{headerStatus}</p>
          <h1 className="mt-1 text-2xl">嘿，今天想去哪裡走走？</h1>
        </div>
        <Link
          to="/profile"
          className="h-11 w-11 overflow-hidden rounded-full border border-border bg-secondary"
          aria-label="個人頁"
        >
          <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
        </Link>
      </div>

      <Link
        to="/chat"
        className="mt-5 block rounded-3xl border border-border bg-card p-5 shadow-soft transition active:scale-[0.99]"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-clay" />
          和 Roamie 聊聊
        </div>
        <p className="mt-3 font-display text-[19px] leading-snug">
          「先說說心情，我幫你挑幾個地方，再一起把行程定下來。」
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          開始 AI 對話規劃
        </div>
      </Link>

      <Link
        to="/map"
        className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-sm"
      >
        <span className="text-muted-foreground">看看附近有哪些角落</span>
        <span className="font-medium">附近探索 →</span>
      </Link>

      <Link
        to="/plan"
        className="mt-3 flex items-center justify-between rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground"
      >
        <span>進階：我想手動規劃行程</span>
        <ChevronRight className="h-4 w-4" />
      </Link>

      <div className="mt-6">
        <SectionTitle title="現在的心情" />
        <div className="mt-3 -mx-5 overflow-x-auto no-scrollbar">
          <div className="flex gap-2.5 px-5">
            {moods.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setSelectedMood(selectedMood === m.label ? null : m.label)}
                disabled={aiLoading}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm shadow-soft transition ${
                  selectedMood === m.label
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card"
                }`}
              >
                <span>{m.emoji}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleRecommend}
          disabled={aiLoading || !selectedMood}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-[15px] font-medium text-primary-foreground shadow-lift disabled:opacity-50"
        >
          {aiLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Roamie 正在幫你想…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {selectedMood ? `依「${selectedMood}」幫我想附近` : "選擇心情後，讓 Roamie 幫你想"}
            </>
          )}
        </button>
      </div>

      {latestTripId && latestTripTitle && (
        <Link
          to="/trip"
          search={{ id: latestTripId }}
          className="mt-7 block overflow-hidden rounded-3xl border border-border bg-card shadow-soft"
        >
          <div className="relative aspect-[16/10] overflow-hidden">
            <img src={onsen} alt="" loading="lazy" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4 text-cream">
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">繼續你的行程</p>
              <h3 className="mt-1 font-display text-xl">{latestTripTitle}</h3>
            </div>
          </div>
          <div className="flex items-center justify-between px-5 py-3.5 text-sm">
            <span className="text-muted-foreground">Roamie 幫你安排的旅程</span>
            <span className="inline-flex items-center gap-1 text-foreground">
              繼續 <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        </Link>
      )}

      <div className="mt-8 rounded-3xl bg-secondary p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {wLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
          {weather ? `${condText}${tempText ? ` · ${tempText}` : ""}` : "讀取天氣中…"}
        </div>
        <h3 className="mt-2 font-display text-xl leading-snug">
          {weather?.recommendationText ?? "等天氣資料更新…"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          選好心情後，點上方按鈕讓 Roamie 依天氣與位置推薦。
        </p>
      </div>

      <Link
        to="/onboarding"
        className="mt-8 flex items-center justify-between rounded-3xl border border-dashed border-border bg-card/60 px-5 py-4 text-sm"
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          <Coffee className="h-4 w-4" /> 重新調整旅行偏好
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <h2 className="font-display text-[19px] leading-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      <Link to="/saved" className="text-xs text-muted-foreground">
        看更多
      </Link>
    </div>
  );
}
