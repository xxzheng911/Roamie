import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sparkles, ChevronRight, Search, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { HomeTripCard } from "@/components/home/HomeTripCard";
import { HomeNearbyPlaceCards } from "@/components/home/HomeNearbyPlaceCards";
import { HomeWeatherCard } from "@/components/home/HomeWeatherCard";
import { HomePersonalizationCard } from "@/components/home/HomePersonalizationCard";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import { useAvatar } from "@/hooks/use-avatar";
import { useHomeWeather } from "@/hooks/use-home-weather";
import { getWeather } from "@/lib/weather.functions";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { fetchRoamieAI } from "@/lib/ai/stream-client";
import {
  fallbackSearchQuery,
  generateLocalRecommendationFallback,
} from "@/lib/ai/local-recommendation-fallback";
import { mergeTravelContext } from "@/lib/ai/travel-context";
import { withSearchTimeout } from "@/lib/search-timeout";
import { shouldActivateLateNightSceneFlow } from "@/lib/late-night-scene-recommendations";
import { saveRecommendation } from "@/lib/recommendation-storage";
import { listPlaces, toggleSavePlace, SAVED_PLACES_CHANGED_EVENT } from "@/lib/places-storage";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { isMissingTableError } from "@/lib/supabase-errors";
import {
  loadRecentRecommendationNames,
  recordRecommendationNames,
} from "@/lib/recommendation-history";
import { SAVED_TRIPS_CHANGED_EVENT } from "@/lib/itinerary-storage";
import { getLatestCoreTrip, type CoreTrip } from "@/lib/trip/core-trip";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/hooks/use-i18n";
import { searchPlaces } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import {
  loadHomeNearbyPicks,
  type HomeNearbyPick,
} from "@/lib/explore-category-search";
import { EXPLORE_CATEGORIES } from "@/lib/places-search-config";
import { getMockHomeNearbyPicks } from "@/lib/map-mock-places";
import { logPlacesFallbackUsed, shouldUseCuratedPlacesFallback } from "@/lib/places-api-errors";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { pickCategoriesForHome } from "@/lib/recommendation/categories";
import { buildDailyPrepAdvice } from "@/lib/recommendation/daily-prep-advice";
import { HomeOutfitCard } from "@/components/home/HomeOutfitCard";
import { pickToPlaceDetailHandoff, setPlaceDetailHandoff } from "@/lib/place-detail-handoff";
import {
  logNearbyPlaceCardPressed,
  logNearbyPlaceId,
  logNearbyPlaceNavigateParams,
  logNearbyPlaceNavigateToDetail,
} from "@/lib/place-detail-log";
import { openAppSettings } from "@/lib/open-app-settings";
import { readBootstrapDeviceLocation } from "@/lib/device-location";
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

const MOOD_CHAT_PROMPTS: Record<string, string> = {
  深夜散步: "我想深夜散步，幫我看看附近適合去哪裡。",
  下雨天: "今天下雨天，幫我推薦幾個適合放鬆的地方。",
  找咖啡: "我想找咖啡廳坐坐，幫我挑幾個順路的選項。",
  想放空: "我今天想放空，幫我安排一段輕鬆行程。",
  一個人: "我想一個人慢慢走走，推薦適合獨處的地方。",
  看海: "我想去看海放鬆一下，幫我規劃方向。",
};

function Home() {
  const { t, locale } = useI18n();
  const { openAddToTrip } = useAddToTrip();
  const { avatarSrc } = useAvatar();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
  const [nearbyCuratedFallback, setNearbyCuratedFallback] = useState(false);
  const [nearbyApiError, setNearbyApiError] = useState<string | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [lastMood, setLastMood] = useState<string | null>(() => readHomeMood());
  const moodRequestRef = useRef<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [latestTrip, setLatestTrip] = useState<CoreTrip | null>(null);
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof getPreferences>> | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<Awaited<ReturnType<typeof listPlaces>>>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [saveBusyId, setSaveBusyId] = useState<string | null>(null);
  const [navigatingPlaceId, setNavigatingPlaceId] = useState<string | null>(null);

  const loadNearbyPicks = useCallback(async () => {
    const boot = readBootstrapDeviceLocation();
    const anchor = userLocation ?? {
      lat: boot.lat,
      lng: boot.lng,
      city: boot.city,
      source: "fallback" as const,
    };
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
        aiPreferences: profile?.aiPreferences,
      });
      const categories = pickCategoriesForHome(weather, selectedMood);
      const { picks, usedCuratedFallback, apiError } = await loadHomeNearbyPicks({
        userLocation: { lat: anchor.lat, lng: anchor.lng },
        weather,
        locale,
        reasonProfile,
        saved,
        searchPlacesFn,
        categories,
      });
      console.info("[Roamie Home] nearby places", {
        count: picks.length,
        usedCuratedFallback,
        apiError: apiError ?? null,
        sample: picks.slice(0, 3).map((p) => ({
          name: p.name,
          photoName: p.photoName ?? null,
        })),
      });
      setNearbyPicks(picks);
      setNearbyCuratedFallback(usedCuratedFallback);
      setNearbyApiError(apiError);
      setPrefs(prefs);
      setSavedPlaces(saved);
      setSavedNames(new Set(saved.map((s) => s.name)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[Roamie Home] nearby picks failed", msg);
      if (shouldUseCuratedPlacesFallback(msg)) {
        logPlacesFallbackUsed("home-load-catch");
        const fallbackCategories = pickCategoriesForHome(weather, selectedMood);
        const loc = userLocation ?? { lat: anchor.lat, lng: anchor.lng };
        setNearbyPicks(
          getMockHomeNearbyPicks(
            { lat: loc.lat, lng: loc.lng },
            fallbackCategories.length ? fallbackCategories : EXPLORE_CATEGORIES.slice(0, 4),
            2,
          ),
        );
        setNearbyCuratedFallback(true);
        setNearbyApiError(msg);
      } else {
        setNearbyPicks([]);
        setNearbyCuratedFallback(false);
        setNearbyApiError(msg);
      }
    } finally {
      setNearbyLoading(false);
    }
  }, [userLocation, weather, locale, searchPlacesFn, selectedMood]);

  const handleMoodSelect = (label: string) => {
    const next = selectedMood === label ? null : label;
    console.info("[MOOD_SELECT] mood=", next ?? "cleared");
    setSelectedMood(next);
    if (!next) {
      writeHomeMood(null);
      return;
    }
    if (moodRequestRef.current === next) return;
    moodRequestRef.current = next;
    console.info("[MOOD_REQUEST] start");
    setLastMood(next);
    const base = loadChatSession();
    saveChatSession({
      ...base,
      mood: next,
      selectedMood: next,
      fromMoodCard: true,
      fromMoodFlow: true,
    });
    const prompt = MOOD_CHAT_PROMPTS[next] ?? `我現在想要「${next}」的行程，請給我建議。`;
    void navigate({
      to: "/chat",
      search: {
        mood: next,
        from: "mood",
        prompt,
      },
    }).finally(() => {
      console.info("[MOOD_REQUEST] completed");
      writeHomeMood(null);
      setSelectedMood(null);
      moodRequestRef.current = null;
    });
  };

  useEffect(() => {
    const resetMoodUi = () => {
      if (document.visibilityState !== "visible") return;
      setSelectedMood(null);
      moodRequestRef.current = null;
      console.info("[MOOD_STATE] reset_on_home_focus");
    };
    window.addEventListener("focus", resetMoodUi);
    document.addEventListener("visibilitychange", resetMoodUi);
    return () => {
      window.removeEventListener("focus", resetMoodUi);
      document.removeEventListener("visibilitychange", resetMoodUi);
    };
  }, []);

  useEffect(() => {
    if (pathname !== "/") return;
    setSelectedMood(null);
    moodRequestRef.current = null;
    console.info("[MOOD_STATE] reset_on_home_focus");
  }, [pathname]);

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
    logNearbyPlaceCardPressed(pick.id, pick.name);
    logNearbyPlaceId(pick.id);
    const handoff = pickToPlaceDetailHandoff(pick);
    logNearbyPlaceNavigateParams(handoff);
    setPlaceDetailHandoff(handoff);
    logNearbyPlaceNavigateToDetail();
    setNavigatingPlaceId(pick.id);
    const pid = handoff.placeId?.trim();
    if (!pid) {
      setNavigatingPlaceId(null);
      return;
    }
    void navigate({
      to: "/place/$placeId",
      params: { placeId: pid },
    }).finally(() => setNavigatingPlaceId(null));
  };

  const refreshSaved = useCallback(async () => {
    try {
      const saved = await listPlaces().catch((e) =>
        isMissingTableError(e) ? [] : Promise.reject(e),
      );
      setSavedNames(new Set(saved.map((s) => s.name)));
      setSavedPlaces(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onSaved = () => void refreshSaved();
    window.addEventListener(SAVED_PLACES_CHANGED_EVENT, onSaved);
    return () => window.removeEventListener(SAVED_PLACES_CHANGED_EVENT, onSaved);
  }, [refreshSaved]);

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
        cover_image: pick.photoName
          ? (buildPlacePhotoUrl(pick.photoName, 600) ?? null)
          : pick.coverImageUrl,
      });
      toast.success(didSave ? "已加入收藏" : "已取消收藏");
      await refreshSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setSaveBusyId(null);
    }
  };

  const refreshLatestTrip = useCallback(() => {
    void getLatestCoreTrip()
      .then((view) => setLatestTrip(view))
      .catch(() => setLatestTrip(null));
  }, []);

  useEffect(() => {
    refreshLatestTrip();
    const onRefresh = () => refreshLatestTrip();
    window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.removeEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [refreshLatestTrip]);

  const handleRecommend = async () => {
    if (!selectedMood) {
      toast.message(t("home.pickMood"));
      return;
    }
    setAiLoading(true);

    const saveLocalMoodFallback = async (
      bundle: Awaited<ReturnType<typeof buildClientContextBundle>>,
    ): Promise<boolean> => {
      const moodSession = {
        ...loadChatSession(),
        mood: selectedMood,
        selectedMood,
        fromMoodFlow: true,
        fromMoodCard: true,
        location: bundle.location,
        weather: bundle.weather,
      };
      const userText =
        MOOD_CHAT_PROMPTS[selectedMood] ?? `我現在想要「${selectedMood}」的行程，請給我建議。`;
      const { context } = mergeTravelContext(moodSession, userText);
      let placeResults: Awaited<ReturnType<typeof searchNearbyPlaces>>["places"] = [];
      const lat = bundle.location?.lat;
      const lng = bundle.location?.lng;
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
          console.warn("[AI_FALLBACK] home places search failed", fallbackErr);
        }
      }
      const { summary, payload } = generateLocalRecommendationFallback({
        context,
        session: moodSession,
        locale,
        places: placeResults,
      });
      if (!(payload.recommendations?.length ?? 0) && !summary.trim()) return false;
      recordRecommendationNames((payload.recommendations ?? []).map((r) => r.name));
      const saved = await saveRecommendation({ ...payload, summary }, { mood: selectedMood });
      navigate({ to: "/recommendations", search: { id: saved.id } });
      return true;
    };

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

      if ((data.recommendations?.length ?? 0) === 0) {
        const usedFallback = await saveLocalMoodFallback(bundle);
        if (usedFallback) return;
      }

      recordRecommendationNames(data.recommendations.map((r) => r.name));
      const saved = await saveRecommendation(data, { mood: selectedMood });
      navigate({ to: "/recommendations", search: { id: saved.id } });
    } catch (e) {
      console.error("[Roamie AI] home recommend failed", e);
      try {
        const bundle = await buildClientContextBundle(fetchWeather);
        const usedFallback = await saveLocalMoodFallback(bundle);
        if (usedFallback) return;
      } catch (fallbackErr) {
        console.warn("[AI_FALLBACK] home recommend fallback failed", fallbackErr);
      }
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
          <Sparkles className="h-3.5 w-3.5 text-clay" />和 Roamie 聊聊
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
        {lastMood && !selectedMood ? (
          <p className="mt-2 text-xs text-muted-foreground">最近選擇：{lastMood}</p>
        ) : null}
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
          {nearbyCuratedFallback && nearbyPicks.length > 0
            ? t("home.nearbyCuratedPicksHint")
            : nearbyCuratedFallback
              ? t("home.nearbyFallbackHint")
              : t("home.nearbyExploreDesc")}
        </p>
        {nearbyApiError && nearbyPicks.length > 0 ? (
          <p className="mt-2 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] leading-relaxed text-amber-950/90">
            {nearbyApiError.includes("VITE_APP_ORIGIN") || nearbyApiError.includes("localhost")
              ? "部分資料為離線推薦。請在 .env 設定 HTTPS 的 VITE_APP_ORIGIN 後重新 build，以取得完整附近與營業時間。"
              : nearbyApiError}
          </p>
        ) : null}
        <div className="app-bleed-x mt-3 min-w-0">
          <HomeNearbyPlaceCards
            places={nearbyPicks}
            loading={nearbyLoading || !userLocation}
            userLocation={userLocation}
            emptyMessage={
              nearbyCuratedFallback && nearbyPicks.length === 0
                ? t("home.nearbyFallbackHint")
                : t("home.nearbyEmpty")
            }
            savedNames={savedNames}
            busyId={saveBusyId}
            navigatingPlaceId={navigatingPlaceId}
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

      {latestTrip ? <HomeTripCard trip={latestTrip} /> : null}

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
        latestTripTitle={latestTrip?.displayTitle ?? null}
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
