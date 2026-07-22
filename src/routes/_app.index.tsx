import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Sparkles, ChevronRight, Search, Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, startTransition } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { HomeTripCard } from "@/components/home/HomeTripCard";
import { HomeNearbyPlaceCards } from "@/components/home/HomeNearbyPlaceCards";
import { HomeWeatherCard } from "@/components/home/HomeWeatherCard";
import { HomePersonalizationCard } from "@/components/home/HomePersonalizationCard";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { sanitizeHomeNearbyPicksForDisplay } from "@/lib/home-nearby-display";
import { useHomeWeather } from "@/hooks/use-home-weather";
import { useEffectiveLocation } from "@/hooks/use-effective-location";
import type { EffectiveLocationSnapshot } from "@/lib/effective-location";
import { getWeather } from "@/lib/weather.functions";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { fetchRoamieAI } from "@/lib/ai/stream-client";
import { shouldActivateLateNightSceneFlow } from "@/lib/late-night-scene-recommendations";
import { saveRecommendation } from "@/lib/recommendation-storage";
import { listPlaces, peekListPlacesCache, toggleSavePlace, SAVED_PLACES_CHANGED_EVENT } from "@/lib/places-storage";
import { buildNewSavedPlaceInput } from "@/lib/saved-place-utils";
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
  homeNearbyLoadPeriodKey,
  type HomeNearbyPick,
} from "@/lib/home-nearby-search";
import {
  readHomeSessionNearbyLoadKey,
  readHomeSessionNearbyMeta,
  writeHomeSessionNearbyPicks,
} from "@/lib/home-session-cache";
import { logHomeRefreshBackground, logHomeRenderFromCache } from "@/lib/home-persistent-cache";
import {
  getHomeNearbyLoadInFlight,
  homeNearbyLoadKey,
  invalidateHomeNearbyLoadKey,
  markHomeNearbyLoad,
  markHomeNearbyLoadComplete,
  readHomeNearbyResultsCacheMeta,
  shouldSkipHomeNearbyLoadWithData,
  writeHomeNearbyResultsCache,
} from "@/lib/home-nearby-picks-policy";
import {
  beginHomeNearbyPerfLoad,
  logHomeNearbyAllEnriched,
  logHomeNearbyCacheRendered,
  logHomeNearbyFirstCardRendered,
  logHomeNearbyLocationReady,
  logHomeNearbyRefreshFailed,
  logHomeNearbyRequestSkipped,
  logHomeNearbySearchReady,
  type HomeNearbyLocationSource,
} from "@/lib/home-nearby-perf";
import {
  markHomeNearbyEmpty,
  markHomeNearbyLoadingInitial,
  markHomeNearbyRefreshDone,
  markHomeNearbyRefreshFailed,
  markHomeNearbyRefreshing,
  publishHomeNearbyCache,
  publishHomeNearbyFresh,
} from "@/lib/home-nearby-repository";
import { prefetchPlaceCoverUrls } from "@/services/image-cache";
import { logHomeNearbyLoadOnce, logPlacesApiSkipDuplicate } from "@/lib/places-diagnostics";
import {
  logHomeNearbyCacheHit,
  logHomeNearbyCacheMiss,
  logHomeNearbyRender,
  logHomeNearbyRequestError,
  logHomeNearbyRequestStart,
  type HomeNearbyRenderState,
} from "@/lib/home-nearby-log";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { useAccess } from "@/hooks/use-access";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences, readCachedPreferencesSync, isPreferencesRemoteHydrated } from "@/lib/preferences-storage";
import { getTravelPrefStatusSync, mergePreferencesWithTravelPrefStatus } from "@/lib/travel-pref-status";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { isHomeRouteVisible } from "@/lib/home-route-active";
import { logPerfEffectRun } from "@/lib/app-perf";
import { buildDailyPrepAdvice } from "@/lib/recommendation/daily-prep-advice";
import { HomeOutfitCard } from "@/components/home/HomeOutfitCard";
import { pickToPlaceDetailHandoff, setPlaceDetailHandoff } from "@/lib/place-detail-handoff";
import {
  mergePlaceRuntimeCache,
  PLACE_RUNTIME_CACHE_UPDATED,
} from "@/lib/place-runtime-cache";
import {
  logNearbyPlaceCardPressed,
  logNearbyPlaceId,
  logNearbyPlaceNavigateParams,
  logNearbyPlaceNavigateToDetail,
} from "@/lib/place-detail-log";
import { openAppSettings } from "@/lib/open-app-settings";
import { clearHomeMoodUiSelection } from "@/lib/home-mood";
import { beginHomeMoodShortcutSession } from "@/lib/home-mood-shortcut-session";
import {
  HOME_MOOD_EMOJI,
  HOME_MOOD_SHORTCUT_IDS,
  type HomeMoodId,
} from "@/lib/home-mood-options";
import { saveChatSession, createEmptySession, loadChatSession } from "@/lib/chat-session";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const { t, locale } = useI18n();
  const { hasPlusAccess } = useAccess();
  const { openAddToTrip } = useAddToTrip();
  const navigate = useNavigate();
  const router = useRouter();
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
  const effectiveLocation = useEffectiveLocation();
  const sessionNearbyBoot = useMemo(() => readHomeSessionNearbyMeta(), []);
  const [nearbyPicks, setNearbyPicks] = useState<HomeNearbyPick[]>(() => sessionNearbyBoot.picks);
  const [nearbyRenderState, setNearbyRenderState] = useState<HomeNearbyRenderState>(() =>
    sessionNearbyBoot.picks.length > 0 ? "cached" : "loading",
  );
  const [nearbyLoading, setNearbyLoading] = useState(() => sessionNearbyBoot.picks.length === 0);
  const [nearbySlowLoad, setNearbySlowLoad] = useState(false);
  const [selectedMood, setSelectedMood] = useState<HomeMoodId | null>(null);
  const homeMoods = useMemo(
    () =>
      HOME_MOOD_SHORTCUT_IDS.map((id) => ({
        id,
        label: t(`home.moods.${id}`),
        emoji: HOME_MOOD_EMOJI[id],
      })),
    [t],
  );
  const selectedMoodLabel = selectedMood ? t(`home.moods.${selectedMood}`) : null;
  const homeChatSession = useMemo(() => loadChatSession(), []);
  const [aiLoading, setAiLoading] = useState(false);
  const [latestTrip, setLatestTrip] = useState<CoreTrip | null>(null);
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof getPreferences>> | null>(() => {
    const status = mergePreferencesWithTravelPrefStatus(readCachedPreferencesSync());
    if (status.onboarded) return status;
    const cached = readCachedPreferencesSync();
    return Object.keys(cached).length > 0 ? cached : null;
  });
  const [savedPlaces, setSavedPlaces] = useState<Awaited<ReturnType<typeof listPlaces>>>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [saveBusyId, setSaveBusyId] = useState<string | null>(null);
  const [navigatingPlaceId, setNavigatingPlaceId] = useState<string | null>(null);

  const dailyPrepAdvice = useMemo(
    () => buildDailyPrepAdvice(weather, locale, weather?.city),
    [
      weather?.tempC,
      weather?.precipProbability,
      weather?.condition,
      weather?.isDaytime,
      weather?.available,
      weather?.city,
      weather?.source,
      locale,
    ],
  );

  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const effectiveLocationRef = useRef(effectiveLocation);
  effectiveLocationRef.current = effectiveLocation;
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const selectedMoodRef = useRef(selectedMood);
  selectedMoodRef.current = selectedMood;

  const resetHomeMoodUi = useCallback(() => {
    clearHomeMoodUiSelection();
    setSelectedMood(null);
  }, []);

  const prefsHydratedRef = useRef(Boolean(prefs));

  useEffect(() => {
    if (prefsHydratedRef.current && prefs?.onboarded) {
      return;
    }
    if (isPreferencesRemoteHydrated()) {
      const cached = mergePreferencesWithTravelPrefStatus(readCachedPreferencesSync());
      if (Object.keys(cached).length > 0) {
        setPrefs((prev) => prev ?? cached);
        prefsHydratedRef.current = true;
      }
      return;
    }
    const applyPrefs = (next: Awaited<ReturnType<typeof getPreferences>>) => {
      const merged = mergePreferencesWithTravelPrefStatus(next);
      setPrefs((prev) => {
        if (
          prev &&
          prev.onboarded === merged.onboarded &&
          prev.personalityType === merged.personalityType &&
          prev.pace === merged.pace &&
          prev.vibe === merged.vibe &&
          prev.budgetMode === merged.budgetMode
        ) {
          return prev;
        }
        return merged;
      });
    };
    const onPrefs = (event: Event) => {
      const detail = (event as CustomEvent<Awaited<ReturnType<typeof getPreferences>>>).detail;
      if (detail && typeof detail === "object") {
        applyPrefs(detail);
        return;
      }
      void getPreferences()
        .then((p) => applyPrefs(p))
        .catch(() => {});
    };
    void getPreferences()
      .then((p) => {
        applyPrefs(p);
        prefsHydratedRef.current = true;
      })
      .catch(() => {});
    window.addEventListener(PREFS_UPDATED_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, onPrefs);
  }, []);

  const applyNearbyPicksIfChanged = useCallback((next: HomeNearbyPick[]) => {
    setNearbyPicks((prev) => {
      if (
        prev.length === next.length &&
        prev.every((pick, index) => pick.id === next[index]?.id)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const syncHomeMoodUi = () => {
      if (!isHomeRouteVisible()) return;
      resetHomeMoodUi();
    };
    syncHomeMoodUi();
    const unsub = router.subscribe("onResolved", syncHomeMoodUi);
    return () => unsub();
  }, [router, resetHomeMoodUi]);

  const hasNearbyPicksRef = useRef(sessionNearbyBoot.picks.length > 0);
  const prevNearbyEffectDepsRef = useRef<{ loadKey: string | null; ready: boolean }>({
    loadKey: null,
    ready: false,
  });
  const nearbyRenderStateRef = useRef(nearbyRenderState);
  nearbyRenderStateRef.current = nearbyRenderState;

  const setNearbyRenderStateLogged = useCallback((next: HomeNearbyRenderState) => {
    if (nearbyRenderStateRef.current === next) return;
    setNearbyRenderState(next);
    logHomeNearbyRender(next);
  }, []);

  useLayoutEffect(() => {
    if (sessionNearbyBoot.picks.length > 0) {
      if (sessionNearbyBoot.loadKey) {
        writeHomeNearbyResultsCache(sessionNearbyBoot.loadKey, sessionNearbyBoot.picks);
      }
      publishHomeNearbyCache(
        sessionNearbyBoot.picks,
        sessionNearbyBoot.loadKey,
        sessionNearbyBoot.lat != null && sessionNearbyBoot.lng != null
          ? { lat: sessionNearbyBoot.lat, lng: sessionNearbyBoot.lng }
          : null,
      );
      beginHomeNearbyPerfLoad({ hasCache: true, locationSource: "disk" });
      logHomeNearbyCacheHit(sessionNearbyBoot.picks.length, sessionNearbyBoot.ageMs ?? 0);
      logHomeNearbyCacheRendered(sessionNearbyBoot.picks.length);
      logHomeNearbyFirstCardRendered(sessionNearbyBoot.picks.length);
      logHomeRenderFromCache("places");
      logHomeNearbyRender("cached");
    } else {
      beginHomeNearbyPerfLoad({ hasCache: false, locationSource: "unknown" });
      logHomeNearbyRender("loading");
    }
  }, [sessionNearbyBoot.ageMs, sessionNearbyBoot.loadKey, sessionNearbyBoot.picks, sessionNearbyBoot.lat, sessionNearbyBoot.lng]);

  useEffect(() => {
    if (nearbyPicks.length > 0 || nearbyRenderState === "empty" || nearbyRenderState === "error") {
      setNearbySlowLoad(false);
      return;
    }
    if (nearbyRenderState !== "loading") return;
    const id = window.setTimeout(() => setNearbySlowLoad(true), 5000);
    return () => window.clearTimeout(id);
  }, [nearbyPicks.length, nearbyRenderState]);

  const nearbyLocationForCards = useMemo(() => {
    if (effectiveLocation?.isReadyForPlaces) {
      return { lat: effectiveLocation.lat, lng: effectiveLocation.lng };
    }
    if (sessionNearbyBoot.lat != null && sessionNearbyBoot.lng != null) {
      return { lat: sessionNearbyBoot.lat, lng: sessionNearbyBoot.lng };
    }
    return null;
  }, [
    effectiveLocation?.isReadyForPlaces,
    effectiveLocation?.lat,
    effectiveLocation?.lng,
    sessionNearbyBoot.lat,
    sessionNearbyBoot.lng,
  ]);

  const nearbyRetryInflightRef = useRef(false);
  const firstCardLoggedRef = useRef(false);

  const locationSourceForPerf = useCallback(
    (eff: EffectiveLocationSnapshot | null | undefined): HomeNearbyLocationSource => {
      if (!eff) return "unknown";
      if (eff.source === "gps") return "fresh";
      if (eff.source === "remembered") return "memory";
      if (eff.source === "last_search") return "disk";
      return "native";
    },
    [],
  );

  const restoreNearbyFromCache = useCallback(
    (loadKey: string): boolean => {
      const loc = effectiveLocationRef.current;
      const coords =
        loc?.isReadyForPlaces ? { lat: loc.lat, lng: loc.lng } : null;
      const moduleMeta = readHomeNearbyResultsCacheMeta<HomeNearbyPick>(loadKey);
      if (moduleMeta && moduleMeta.picks.length > 0) {
        applyNearbyPicksIfChanged(moduleMeta.picks);
        hasNearbyPicksRef.current = true;
        publishHomeNearbyCache(moduleMeta.picks, loadKey, coords);
        setNearbyLoading(false);
        setNearbyRenderStateLogged("cached");
        logHomeNearbyCacheHit(moduleMeta.picks.length, moduleMeta.ageMs);
        logHomeNearbyCacheRendered(moduleMeta.picks.length);
        logHomeNearbyFirstCardRendered(moduleMeta.picks.length);
        return true;
      }

      // 過期仍顯示上一批（SWR）；背景再刷新
      const sessionMeta = readHomeSessionNearbyMeta(undefined, coords);
      if (sessionMeta.picks.length > 0) {
        applyNearbyPicksIfChanged(sessionMeta.picks);
        hasNearbyPicksRef.current = true;
        publishHomeNearbyCache(sessionMeta.picks, sessionMeta.loadKey ?? loadKey, coords);
        setNearbyLoading(false);
        setNearbyRenderStateLogged("cached");
        logHomeNearbyCacheHit(sessionMeta.picks.length, sessionMeta.ageMs ?? 0);
        logHomeNearbyCacheRendered(sessionMeta.picks.length);
        logHomeNearbyFirstCardRendered(sessionMeta.picks.length);
        return true;
      }

      logHomeNearbyCacheMiss("no_session_or_module_cache");
      return false;
    },
    [applyNearbyPicksIfChanged, setNearbyRenderStateLogged],
  );

  const loadNearbyPicks = useCallback(async (
    caller?: string,
    locationOverride?: EffectiveLocationSnapshot | null,
    options?: { forceRefresh?: boolean; background?: boolean },
  ) => {
    const forceRefresh = options?.forceRefresh === true;
    const background =
      options?.background === true ||
      (options?.background !== false && hasNearbyPicksRef.current && !forceRefresh);
    const eff = locationOverride ?? effectiveLocationRef.current;
    console.info("[HOME_NEARBY_ENTER]", {
      caller: caller ?? null,
      ready: !!eff?.isReadyForPlaces,
      locationKey: eff?.locationKey ?? null,
      forceRefresh,
      background,
    });
    if (!eff?.isReadyForPlaces) {
      console.info("[HOME_NEARBY_ABORT]", { reason: "not_ready", caller: caller ?? null });
      return;
    }

    if (forceRefresh && nearbyRetryInflightRef.current) {
      logHomeNearbyRequestSkipped("in_flight");
      return;
    }

    const loc = { lat: eff.lat, lng: eff.lng };
    const periodKey = homeNearbyLoadPeriodKey();
    const loadKey = homeNearbyLoadKey(loc.lat, loc.lng, periodKey, locale);
    const sessionLoadKey = readHomeSessionNearbyLoadKey();
    const hadPicksBeforeFetch = hasNearbyPicksRef.current;

    beginHomeNearbyPerfLoad({
      hasCache: hadPicksBeforeFetch,
      locationSource: locationSourceForPerf(eff),
    });
    logHomeNearbyLocationReady();

    if (forceRefresh) {
      invalidateHomeNearbyLoadKey(loadKey);
    }

    if (
      !forceRefresh &&
      shouldSkipHomeNearbyLoadWithData(loadKey, hasNearbyPicksRef.current, sessionLoadKey)
    ) {
      console.info("[HOME_NEARBY_SKIP]", { loadKey, caller: caller ?? null, reason: "policy_skip" });
      logPlacesApiSkipDuplicate("nearby_ttl", {
        key: loadKey,
        caller: caller ?? null,
        reason: "existing_or_completed",
      });
      logHomeNearbyRequestSkipped("fresh_cache");
      restoreNearbyFromCache(loadKey);
      return;
    }

    if (!forceRefresh) {
      const inflight = getHomeNearbyLoadInFlight<HomeNearbyPick[]>(loadKey);
      if (inflight) {
        logPlacesApiSkipDuplicate("nearby_in_flight", { key: loadKey, caller: caller ?? null });
        logHomeNearbyRequestSkipped("in_flight");
        try {
          const inflightPicks = sanitizeHomeNearbyPicksForDisplay(await inflight, { logDrop: false });
          if (inflightPicks.length > 0) {
            applyNearbyPicksIfChanged(inflightPicks);
            hasNearbyPicksRef.current = true;
            publishHomeNearbyFresh(inflightPicks, loadKey, loc);
            setNearbyRenderStateLogged(hadPicksBeforeFetch ? "cached" : "fresh");
            logHomeNearbyFirstCardRendered(inflightPicks.length);
          }
        } catch (e) {
          logHomeNearbyRequestError(
            "inflight_failed",
            e instanceof Error ? e.message : String(e),
          );
          logHomeNearbyRefreshFailed(
            e instanceof Error ? e.message : String(e),
            hasNearbyPicksRef.current,
          );
        } finally {
          setNearbyLoading(false);
          markHomeNearbyRefreshDone();
        }
        return;
      }
    }

    if (!hadPicksBeforeFetch && !background) {
      setNearbyLoading(true);
      setNearbyRenderStateLogged("loading");
      markHomeNearbyLoadingInitial();
    } else {
      markHomeNearbyRefreshing();
    }

    const applyPicks = (
      picks: HomeNearbyPick[],
      phase: "first_batch" | "enriched" | "final",
    ) => {
      const apply = () => {
        if (picks.length === 0) {
          if (!hasNearbyPicksRef.current && !background) {
            setNearbyRenderStateLogged("empty");
            markHomeNearbyEmpty();
          }
          return;
        }
        // 無感替換：有舊卡時用 transition；首批立即上畫面
        setNearbyPicks(picks);
        hasNearbyPicksRef.current = true;
        setNearbyLoading(false);
        setNearbyRenderStateLogged(phase === "first_batch" && hadPicksBeforeFetch ? "cached" : "fresh");
        if (phase === "first_batch") {
          publishHomeNearbyCache(picks, loadKey, loc);
          logHomeNearbySearchReady(picks.length);
          logHomeNearbyFirstCardRendered(picks.length);
          firstCardLoggedRef.current = true;
          prefetchPlaceCoverUrls(
            picks.slice(0, 5).map((p) => ({
              placeId: p.id,
              url: p.coverImageUrl,
              photoName: p.photoName,
            })),
          );
        } else {
          publishHomeNearbyFresh(picks, loadKey, loc);
          logHomeNearbyAllEnriched(picks.length);
          if (!firstCardLoggedRef.current) {
            logHomeNearbyFirstCardRendered(picks.length);
            firstCardLoggedRef.current = true;
          }
          prefetchPlaceCoverUrls(
            picks.slice(0, 5).map((p) => ({
              placeId: p.id,
              url: p.coverImageUrl,
              photoName: p.photoName,
            })),
          );
        }
      };
      if (background && phase !== "first_batch") {
        startTransition(apply);
      } else {
        apply();
      }
    };

    const runFetch = async () => {
      if (forceRefresh) nearbyRetryInflightRef.current = true;
      firstCardLoggedRef.current = false;
      logHomeNearbyRequestStart({
        location: eff.locationKey,
        bucket: periodKey,
        source: caller ?? "unknown",
        forceRefresh,
      });
      markHomeNearbyLoad(loadKey);
      logHomeNearbyLoadOnce({
        locationKey: eff.locationKey,
        loadKey,
        caller,
        categories: [periodKey],
      });

      let resultCount = 0;
      try {
        // 同步快取先開搜尋，不要等 profile / prefs / listPlaces
        const cachedPrefs = mergePreferencesWithTravelPrefStatus(readCachedPreferencesSync());
        const travelPrefStatus = getTravelPrefStatusSync();
        const savedSync = peekListPlacesCache();
        const reasonProfile = userProfileForReasonFrom(cachedPrefs, {
          travelStyle: travelPrefStatus.travelStyleName || undefined,
          personalityType: travelPrefStatus.travelStyleName || undefined,
          personalitySummary: travelPrefStatus.personalitySummary || undefined,
          hasPlusAccess,
        });

        // 背景補齊 prefs／收藏／profile，不阻擋第一批卡片
        void Promise.all([
          getUserProfile(locale).catch(() => null),
          getPreferences(),
          listPlaces().catch((e) => {
            console.warn("[Roamie Home] listPlaces failed, using empty", e);
            return [] as Awaited<ReturnType<typeof listPlaces>>;
          }),
        ]).then(([, prefs, saved]) => {
          if (background) return;
          const mergedPrefs = mergePreferencesWithTravelPrefStatus(prefs);
          setPrefs(mergedPrefs);
          setSavedPlaces(saved);
          setSavedNames(new Set(saved.map((s) => s.name)));
        });

        const picks = sanitizeHomeNearbyPicksForDisplay(
          await loadHomeNearbyPicks(
            {
              userLocation: { lat: loc.lat, lng: loc.lng },
              weather: weatherRef.current,
              locale,
              reasonProfile,
              saved: savedSync,
              searchPlacesFn,
              locationKey: eff.locationKey,
            },
            {
              forceRefresh,
              onPartialPicks: (partial, phase) => {
                const clean = sanitizeHomeNearbyPicksForDisplay(partial, { logDrop: false });
                if (clean.length === 0) return;
                applyPicks(clean, phase);
              },
            },
          ),
          { logDrop: false },
        );
        resultCount = picks.length;
        if (picks.length > 0) {
          applyPicks(picks, "final");
        } else if (!hasNearbyPicksRef.current && !background) {
          setNearbyRenderStateLogged("empty");
          markHomeNearbyEmpty();
        } else if (picks.length === 0 && hasNearbyPicksRef.current) {
          // 刷新得到空／rate limit：保留舊卡
          logHomeNearbyRefreshFailed("empty_or_rate_limited", true);
          markHomeNearbyRefreshFailed();
        }
      } catch (e) {
        console.warn("[Roamie Home] nearby picks failed", e);
        const reason = e instanceof Error ? e.message : String(e);
        logHomeNearbyRequestError("home_load_failed", reason);
        logHomeNearbyRefreshFailed(reason, hasNearbyPicksRef.current);
        markHomeNearbyRefreshFailed();
        // 有舊資料絕不清空；僅從未成功過才進 error
        if (!hasNearbyPicksRef.current && !background) {
          setNearbyRenderStateLogged("error");
        }
      } finally {
        markHomeNearbyLoadComplete(loadKey, resultCount);
        markHomeNearbyRefreshDone();
        nearbyRetryInflightRef.current = false;
        if (!background || hasNearbyPicksRef.current) {
          setNearbyLoading(false);
        }
      }
    };

    if (background) {
      logHomeRefreshBackground("places");
      const schedule =
        typeof requestIdleCallback !== "undefined"
          ? (fn: () => void) => requestIdleCallback(fn, { timeout: 2500 })
          : (fn: () => void) => window.setTimeout(fn, 120);
      schedule(() => {
        void runFetch();
      });
      return;
    }

    await runFetch();
  }, [
    locale,
    searchPlacesFn,
    hasPlusAccess,
    restoreNearbyFromCache,
    setNearbyRenderStateLogged,
    applyNearbyPicksIfChanged,
    locationSourceForPerf,
  ]);

  const handleMoodSelect = (moodId: HomeMoodId) => {
    const next = selectedMood === moodId ? null : moodId;
    setSelectedMood(next);
    if (!next) {
      resetHomeMoodUi();
      return;
    }
    clearHomeMoodUiSelection();
    const moodLabel = t(`home.moods.${next}`);
    const prompt = t(`home.moodPrompts.${next}`);
    console.info("[MOOD_CHAT_START]", `mood=${next}`);
    console.info("[MOOD_CHAT_ROUTE]", "target=/chat");
    try {
      void navigate({
        to: "/chat",
        search: {
          mood: next,
          from: "mood",
          prompt,
        },
      });
      saveChatSession(
        beginHomeMoodShortcutSession(createEmptySession(), moodLabel),
      );
    } catch (error) {
      console.error(
        "[MOOD_CHAT_ERROR]",
        error instanceof Error ? error.message : String(error),
      );
      toast.error(t("home.moodChatOpenFailed"));
    }
  };

  const [nearbyPeriodTick, setNearbyPeriodTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNearbyPeriodTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nearbyPeriodKey = useMemo(
    () => homeNearbyLoadPeriodKey(),
    [nearbyPeriodTick],
  );

  const nearbyLoadKey =
    effectiveLocation?.isReadyForPlaces
      ? homeNearbyLoadKey(
          effectiveLocation.lat,
          effectiveLocation.lng,
          nearbyPeriodKey,
          locale,
        )
      : null;

  useLayoutEffect(() => {
    if (!isHomeRouteVisible()) return;

    const prev = prevNearbyEffectDepsRef.current;
    const loadKeyChanged = prev.loadKey !== nearbyLoadKey;
    const becameReady = !!effectiveLocation?.isReadyForPlaces && !prev.ready;
    prevNearbyEffectDepsRef.current = {
      loadKey: nearbyLoadKey,
      ready: !!effectiveLocation?.isReadyForPlaces,
    };

    if (!effectiveLocation?.isReadyForPlaces || !nearbyLoadKey) return;

    if (!loadKeyChanged && !becameReady) {
      return;
    }

    logPerfEffectRun("homeNearbyEffect", {
      route: "/",
      reason: loadKeyChanged ? "load_key_changed" : "became_ready",
      loadKey: nearbyLoadKey,
    });

    const sessionLoadKey = readHomeSessionNearbyLoadKey();
    if (
      shouldSkipHomeNearbyLoadWithData(
        nearbyLoadKey,
        hasNearbyPicksRef.current,
        sessionLoadKey,
      )
    ) {
      console.info("[HOME_NEARBY_SKIP]", {
        loadKey: nearbyLoadKey,
        caller: "nearby_effect",
        reason: "policy_skip",
      });
      logHomeNearbyRequestSkipped("same_key");
      restoreNearbyFromCache(nearbyLoadKey);
      void loadNearbyPicks("nearby_effect_bg", effectiveLocation, { background: true });
      return;
    }

    console.info("[HOME_NEARBY_EFFECT_FETCH]", { loadKey: nearbyLoadKey, becameReady, loadKeyChanged });
    void loadNearbyPicks("nearby_effect", effectiveLocation, {
      background: hasNearbyPicksRef.current,
    });
  }, [
    nearbyLoadKey,
    effectiveLocation?.isReadyForPlaces,
    effectiveLocation?.locationKey,
    loadNearbyPicks,
    restoreNearbyFromCache,
  ]);

  const handleNearbyPick = (pick: HomeNearbyPick) => {
    logNearbyPlaceCardPressed(pick.id, pick.name);
    logNearbyPlaceId(pick.id);
    const handoff = pickToPlaceDetailHandoff(pick);
    logNearbyPlaceNavigateParams(handoff);
    setPlaceDetailHandoff(handoff);
    logNearbyPlaceNavigateToDetail();
    setNavigatingPlaceId(pick.id);
    void navigate({
      to: "/place",
      search: {
        placeId: handoff.placeId || undefined,
        lat: pick.lat ?? undefined,
        lng: pick.lng ?? undefined,
      },
    }).finally(() => setNavigatingPlaceId(null));
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
      const { saved: didSave } = await toggleSavePlace(
        buildNewSavedPlaceInput({
          name: pick.name,
          category: pick.displayCategory ?? pick.primaryType,
          primaryType: pick.primaryType,
          types: pick.types ?? undefined,
          address: pick.address,
          lat: pick.lat,
          lng: pick.lng,
          notes: pick.reason,
          mood_tag: selectedMood,
          placeId: pick.id,
          googlePlaceId: pick.id,
          photoName: pick.photoName,
          rating: pick.rating,
          userRatingCount: pick.userRatingCount,
          coverImageUrl: pick.coverImageUrl,
        }),
      );
      toast.success(didSave ? "已加入收藏" : "已取消收藏");
      await refreshSavedNames();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setSaveBusyId(null);
    }
  };

  const latestTripIdRef = useRef<string | null>(null);

  const refreshLatestTrip = useCallback(() => {
    void getLatestCoreTrip()
      .then((view) => {
        const nextId = view?.id ?? null;
        if (nextId === latestTripIdRef.current) return;
        latestTripIdRef.current = nextId;
        setLatestTrip(view);
      })
      .catch(() => {
        if (latestTripIdRef.current === null) return;
        latestTripIdRef.current = null;
        setLatestTrip(null);
      });
  }, []);

  useEffect(() => {
    refreshLatestTrip();
    const onRefresh = () => refreshLatestTrip();
    window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
    return () => window.removeEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
  }, [refreshLatestTrip]);

  useEffect(() => {
    const onRuntimeCache = (event: Event) => {
      const placeId = (event as CustomEvent<{ placeId?: string }>).detail?.placeId;
      if (!placeId) return;
      setNearbyPicks((prev) => {
        let changed = false;
        const next = prev.map((pick) => {
          if (pick.id !== placeId) return pick;
          changed = true;
          return mergePlaceRuntimeCache(placeId, pick) as HomeNearbyPick;
        });
        if (!changed) return prev;
        const loadKey = readHomeSessionNearbyLoadKey();
        const loc = effectiveLocationRef.current;
        if (loadKey) {
          writeHomeSessionNearbyPicks(
            next,
            loadKey,
            loc?.isReadyForPlaces ? { lat: loc.lat, lng: loc.lng } : null,
          );
        }
        return next;
      });
    };
    window.addEventListener(PLACE_RUNTIME_CACHE_UPDATED, onRuntimeCache);
    return () => window.removeEventListener(PLACE_RUNTIME_CACHE_UPDATED, onRuntimeCache);
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
          mood: selectedMoodLabel,
          selectedCategory: selectedMoodLabel,
          selectedMood: selectedMoodLabel,
          locale,
          lateNightMode: shouldActivateLateNightSceneFlow(selectedMood, at),
          recentRecommendationNames: loadRecentRecommendationNames(),
          savedPlaceNames: savedPlaces.map((p) => p.name),
        }),
        { token },
      );

      recordRecommendationNames(data.recommendations.map((r) => r.name));
      const saved = await saveRecommendation(data, { mood: selectedMoodLabel ?? undefined });
      resetHomeMoodUi();
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
          <h1 className="text-2xl leading-tight">{t("home.greeting")}</h1>
        </div>
        <Link
          to="/profile"
          className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-border bg-secondary"
          aria-label={t("home.profileLinkAria")}
        >
          <ProfileAvatar self priority className="h-11 w-11" />
        </Link>
      </div>

      <Link
        to="/chat"
        search={selectedMood ? { mood: selectedMood } : undefined}
        className="mt-5 block rounded-3xl border border-border bg-card p-5 shadow-soft transition active:scale-[0.99]"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-clay" />
          {t("home.chatCardBadge")}
        </div>
        <p className="mt-3 font-display text-[19px] leading-snug">{t("home.chatCardQuote")}</p>
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          {selectedMoodLabel
            ? t("home.chatSearchWithMood", { mood: selectedMoodLabel })
            : t("home.chatSearchDefault")}
        </div>
      </Link>

      <div className="mt-6 min-w-0">
        <SectionTitle title={t("home.moodSectionTitle")} />
        <div className="app-h-scroll app-bleed-x mt-3">
          <div className="app-h-scroll-track">
            {homeMoods.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleMoodSelect(m.id)}
                disabled={aiLoading}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm shadow-soft transition ${
                  selectedMood === m.id
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
              {t("home.moodRecommendLoading")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {selectedMoodLabel
                ? t("home.moodRecommendWith", { mood: selectedMoodLabel })
                : t("home.moodRecommendDefault")}
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
            renderState={nearbyRenderState}
            loading={nearbyLoading}
            showSlowEmpty={nearbySlowLoad}
            userLocation={nearbyLocationForCards}
            emptyMessage={t("home.nearbyEmpty")}
            slowEmptyMessage={t("home.nearbySlowEmpty")}
            retryLabel={t("home.nearbyRetry")}
            onRetry={() => void loadNearbyPicks("retry", effectiveLocation, { forceRefresh: true })}
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
        <span>{t("home.advancedPlan")}</span>
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
              ? t("home.weatherErrorPlaceholder")
              : t("home.weatherPlaceholderHint"),
          fallbackLocationHint: t("home.weatherFallbackLocation"),
          openLocationSettings: t("home.weatherOpenLocationSettings"),
          todayLabel: t("home.weatherToday"),
          moodHint: t("home.weatherMoodHint"),
        }}
      />

      <HomeOutfitCard
        advice={dailyPrepAdvice}
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
        selectedMood={selectedMoodLabel}
        latestTripTitle={latestTrip?.displayTitle ?? null}
        chatSession={homeChatSession}
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
