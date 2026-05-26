import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sparkles, ChevronRight, Search, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import onsen from "@/assets/scene-onsen.jpg";
import { HomeNearbyPlaceCards } from "@/components/home/HomeNearbyPlaceCards";
import { HomeWeatherCard } from "@/components/home/HomeWeatherCard";
import { HomePersonalizationCard } from "@/components/home/HomePersonalizationCard";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import { useAvatar } from "@/hooks/use-avatar";
import { useHomeWeather } from "@/hooks/use-home-weather";
import { getWeather } from "@/lib/weather.functions";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { fetchRoamieAI } from "@/lib/ai/stream-client";
import { shouldActivateLateNightSceneFlow } from "@/lib/late-night-scene-recommendations";
import { saveRecommendation } from "@/lib/recommendation-storage";
import { listPlaces, toggleSavePlace, SAVED_PLACES_CHANGED_EVENT } from "@/lib/places-storage";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { isMissingTableError } from "@/lib/supabase-errors";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { listItineraries } from "@/lib/itinerary-storage";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/hooks/use-i18n";
import { searchPlaces } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { loadHomeNearbyPicks, type HomeNearbyPick } from "@/lib/explore-category-search";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { pickCategoriesForHome } from "@/lib/recommendation/categories";
import { buildDailyPrepAdvice } from "@/lib/recommendation/daily-prep-advice";
import { HomeOutfitCard } from "@/components/home/HomeOutfitCard";
import { setMapExploreHandoff } from "@/lib/map-explore-handoff";
import { openAppSettings } from "@/lib/open-app-settings";
import { readHomeMood, writeHomeMood } from "@/lib/home-mood";
import { saveChatSession, loadChatSession } from "@/lib/chat-session";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

const HOME_MOODS = [
  { label: "想放空", emoji: "🍃" },
  { label: "一個人", emoji: "🚶" },
  { label: "下雨天", emoji: "☔" },
  { label: "深夜散步", emoji: "🌙" },
  { label: "找咖啡", emoji: "☕" },
  { label: "看海", emoji: "🌊" },
] as const;

function Home() {
  const { t, locale } = useI18n();
  const { openAddToTrip } = useAddToTrip();
  const { avatarSrc } = useAvatar();
  const navigate = useNavigate();
  const fetchWeather = useServerFn(getWeather);
  const searchPlacesServerFn = useServerFn(searchPlaces);
  const searchPlacesFn = useMemo(
    () => createUnifiedSearchPlacesFn(searchPlacesServerFn),
    [searchPlacesServerFn],
  );
  const {
    weather,
    status: weatherStatus,
    error: weatherError,
    userLocation,
    usedFallbackLocation,
    locationPermission,
    reload: reloadWeather,
  } = useHomeWeather(locale);
  const [nearbyPicks, setNearbyPicks] = useState<HomeNearbyPick[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [selectedMood, setSelectedMood] = useState<string | null>(() => readHomeMood());
  const [aiLoading, setAiLoading] = useState(false);
  const [latestTripId, setLatestTripId] = useState<string | null>(null);
  const [latestTripTitle, setLatestTripTitle] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof getPreferences>> | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<Awaited<ReturnType<typeof listPlaces>>>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [saveBusyId, setSaveBusyId] = useState<string | null>(null);

  const loadNearbyPicks = useCallback(async () => {
    if (!userLocation) {
      setNearbyLoading(true);
      return;
    }
    setNearbyLoading(true);
    try {
      const [profile, prefs, saved] = await Promise.all([
        getUserProfile(locale).catch(() => null),
        getPreferences(),
        listPlaces().catch((e) => (isMissingTableError(e) ? [] : Promise.reject(e))),
      ]);
      const reasonProfile = userProfileForReasonFrom(profile?.prefs ?? prefs, {
        travelStyle: profile?.travelStyle,
        personalityType: profile?.personalityType,
        personalitySummary: profile?.personalitySummary,
      });
      const picks = await loadHomeNearbyPicks({
        userLocation: { lat: userLocation.lat, lng: userLocation.lng },
        weather,
        locale,
        reasonProfile,
        saved,
        searchPlacesFn,
        categories: pickCategoriesForHome(weather, selectedMood),
      });
      console.info("[Roamie Home] nearby places", {
        count: picks.length,
        sample: picks.slice(0, 3).map((p) => ({
          name: p.name,
          photoName: p.photoName ?? null,
        })),
      });
      setNearbyPicks(picks);
      setPrefs(prefs);
      setSavedPlaces(saved);
      setSavedNames(new Set(saved.map((s) => s.name)));
    } catch (e) {
      console.warn("[Roamie Home] nearby picks failed", e);
      setNearbyPicks([]);
    } finally {
      setNearbyLoading(false);
    }
  }, [userLocation, weather, locale, searchPlacesFn, selectedMood]);

  const handleMoodSelect = (label: string) => {
    const next = selectedMood === label ? null : label;
    setSelectedMood(next);
    writeHomeMood(next);
    const base = loadChatSession();
    saveChatSession({
      ...base,
      mood: next ?? base.mood,
      selectedMood: next ?? base.selectedMood,
    });
  };

  useEffect(() => {
    void loadNearbyPicks();
  }, [loadNearbyPicks]);

  useEffect(() => {
    if (!userLocation) return;
    void loadNearbyPicks();
  }, [selectedMood, userLocation, loadNearbyPicks]);

  useEffect(() => {
    const onPrefs = () => {
      if (weatherStatus !== "loading") void loadNearbyPicks();
    };
    window.addEventListener(PREFS_UPDATED_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, onPrefs);
  }, [weatherStatus, loadNearbyPicks]);

  useEffect(() => {
    const onAccess = () => {
      if (weatherStatus !== "loading") void loadNearbyPicks();
    };
    window.addEventListener(ACCESS_CHANGED_EVENT, onAccess);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, onAccess);
  }, [weatherStatus, loadNearbyPicks]);

  const handleNearbyPick = (pick: HomeNearbyPick) => {
    setMapExploreHandoff({
      categoryId: pick.categoryId,
      placeId: pick.id,
      placeSnapshot: pick,
    });
    navigate({ to: "/map" });
  };

  const refreshSavedNames = useCallback(async () => {
    try {
      const saved = await listPlaces().catch((e) =>
        isMissingTableError(e) ? [] : Promise.reject(e),
      );
      setSavedNames(new Set(saved.map((s) => s.name)));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onSaved = () => void refreshSavedNames();
    window.addEventListener(SAVED_PLACES_CHANGED_EVENT, onSaved);
    return () => window.removeEventListener(SAVED_PLACES_CHANGED_EVENT, onSaved);
  }, [refreshSavedNames]);

  const handleToggleSaveNearby = async (pick: HomeNearbyPick) => {
    setSaveBusyId(pick.id);
    try {
      const { saved: didSave } = await toggleSavePlace({
        name: pick.name,
        category: pick.displayCategory ?? pick.primaryType,
        address: pick.address,
        city: null,
        lat: pick.lat,
        lng: pick.lng,
        notes: pick.reason,
        mood_tag: selectedMood,
        cover_image: pick.photoName ? (buildPlacePhotoUrl(pick.photoName, 600) ?? null) : pick.coverImageUrl,
      });
      toast.success(didSave ? "已加入收藏" : "已取消收藏");
      await refreshSavedNames();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setSaveBusyId(null);
    }
  };

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

  const handleRecommend = async () => {
    if (!selectedMood) {
      toast.message(t("home.pickMood"));
      return;
    }
    setAiLoading(true);
    try {
      const [bundle, savedPlaces] = await Promise.all([
        buildClientContextBundle(fetchWeather),
        listPlaces().catch((e) => {
          if (isMissingTableError(e)) return [];
          throw e;
        }),
      ]);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const at = new Date(bundle.time);
      const data = await fetchRoamieAI(
        toRoamieRequest("recommend", bundle, {
          mood: selectedMood,
          selectedCategory: selectedMood,
          selectedMood,
          locale,
          lateNightMode: shouldActivateLateNightSceneFlow(selectedMood, at),
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
      toast.error(e instanceof Error ? e.message : t("home.recommendFailed"));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="animate-rise w-full min-w-0 max-w-full overflow-x-hidden pb-6 pl-[max(1.25rem,var(--safe-area-left))] pr-[max(1.25rem,var(--safe-area-right))] pt-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-tight">嘿，今天想去哪裡走走？</h1>
        </div>
        <Link
          to="/profile"
          className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-border bg-secondary"
          aria-label="個人頁"
        >
          <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
        </Link>
      </div>

      <Link
        to="/chat"
        search={selectedMood ? { mood: selectedMood } : undefined}
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
          {selectedMood ? `帶著「${selectedMood}」開始對話` : "開始 AI 對話規劃"}
        </div>
      </Link>

      <div className="mt-6 min-w-0">
        <SectionTitle title="現在的心情" />
        <div className="app-h-scroll app-bleed-x mt-3">
          <div className="app-h-scroll-track">
            {HOME_MOODS.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => handleMoodSelect(m.label)}
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

      <section className="mt-6 min-w-0">
        <h2 className="font-display text-[17px] leading-snug">{t("home.nearbySection")}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("home.nearbyExploreDesc")}
        </p>
        <div className="app-bleed-x mt-3 min-w-0">
          <HomeNearbyPlaceCards
            places={nearbyPicks}
            loading={nearbyLoading || !userLocation}
            userLocation={userLocation}
            emptyMessage={t("home.nearbyEmpty")}
            savedNames={savedNames}
            busyId={saveBusyId}
            onSelect={handleNearbyPick}
            onAddToTrip={(p) => openAddToTrip(tripPlaceFromPlaceResult(p))}
            onToggleSave={(p) => void handleToggleSaveNearby(p)}
            addToTripLabel={t("chat.addToTrip")}
          />
        </div>
      </section>

      <Link
        to="/plan"
        className="mt-3 flex items-center justify-between rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground"
      >
        <span>進階：我想手動規劃行程</span>
        <ChevronRight className="h-4 w-4" />
      </Link>

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

      <HomeWeatherCard
        weather={weather}
        status={weatherStatus}
        error={weatherError}
        usedFallbackLocation={usedFallbackLocation}
        showOpenLocationSettings={
          usedFallbackLocation &&
          (locationPermission === "denied" || locationPermission === "restricted")
        }
        onRetry={() => void reloadWeather()}
        onOpenLocationSettings={() => void openAppSettings()}
        labels={{
          title: t("home.weatherTitle"),
          loading: t("home.weatherLoading"),
          errorTitle: t("home.weatherErrorTitle"),
          errorHint: t("home.weatherErrorHint"),
          retry: t("home.weatherRetry"),
          placeholderTitle: t("home.weatherPlaceholderTitle"),
          placeholderHint:
            weatherStatus === "error" || weatherError
              ? "暫時讀不到天氣，先用附近地點陪你走走"
              : t("home.weatherPlaceholderHint"),
          fallbackLocationHint: t("home.weatherFallbackLocation"),
          openLocationSettings: t("home.weatherOpenLocationSettings"),
          todayLabel: t("home.weatherToday"),
          moodHint: t("home.weatherMoodHint"),
        }}
      />

      <HomeOutfitCard
        advice={buildDailyPrepAdvice(weather, locale, weather?.city)}
        labels={{
          title: t("home.prepTitle"),
          empty: t("home.prepEmpty"),
        }}
      />

      <HomePersonalizationCard
        className="mt-8"
        prefs={prefs}
        savedPlaces={savedPlaces}
        weather={weather}
        nearbyPicks={nearbyPicks}
        selectedMood={selectedMood}
        latestTripTitle={latestTripTitle}
      />
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
