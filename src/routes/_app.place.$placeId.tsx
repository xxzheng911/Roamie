import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { PlaceDetailSheet, ExploreSubpageHeader } from "@/components/map/PlaceDetailSheet";
import { PlaceDetailErrorBoundary } from "@/components/PlaceDetailErrorBoundary";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { useI18n } from "@/hooks/use-i18n";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { usePlaceNavigation } from "@/hooks/use-place-navigation";
import { consumePlaceDetailHandoff, peekPlaceDetailHandoff } from "@/lib/place-detail-handoff";
import {
  logPlaceDetailFetchFailed,
  logPlaceDetailFetchStarted,
  logPlaceDetailFetchSuccess,
  logPlaceDetailFallbackUsed,
  logPlaceDetailParamsReceived,
  logPlaceDetailScreenMounted,
} from "@/lib/place-detail-log";
import {
  buildPlaceImageUrlsWithSource,
  handoffToPlaceDetailData,
  resolvePlaceDetailHandoff,
  type PlaceDetailViewModel,
} from "@/lib/place-detail-resolve";
import { fetchPlaceDetailsForScreen, getPlaceDetails } from "@/lib/places.functions";
import { hydratePlaceDetailFromTrip } from "@/lib/place/place-detail-hydration";
import {
  logPlaceDetailOpened,
  logPlaceDetailPhotoSource,
  logPlaceDetailRouteContext,
} from "@/lib/place/place-detail-logs";
import { isGooglePlaceId, shouldFetchRemotePlaceDetails } from "@/lib/place-detail-handoff";
import { createUnifiedPlaceDetailsFn } from "@/lib/place-details-unified";
import { getCachedPlaceDetailsForScreen } from "@/lib/place-details-request-cache";
import { readGoogleMapsKeyFromClientEnv } from "@/lib/google-maps-key-resolve";
import { canReachBundledAppApiOrigin } from "@/lib/api-base-url";
import { getPlaceIntro } from "@/lib/recommendation.functions";
import type { PlaceIntroItineraryContext } from "@/lib/place/generate-place-intro";
import {
  enrichPlaceDetailWithAiContent,
  type EnrichPlaceDetailAiOptions,
} from "@/lib/place/place-detail-ai-content";
import { loadPlaceIntroItineraryContext } from "@/lib/place/place-intro-itinerary-context";
import { isGenericPlaceReason } from "@/lib/place/place-intro-constants";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import { requestDeviceLocation } from "@/lib/device-location";
import { TAIPEI_CENTER } from "@/lib/geo";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import {
  addSelectedPlace,
  loadChatSession,
  mapPlaceResultToChatItem,
  saveChatSession,
} from "@/lib/chat-session";
import { userProfileForReasonFrom, EMPTY_USER_PROFILE_FOR_REASON } from "@/lib/build-place-recommendation-reason";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { getWeather } from "@/lib/weather.functions";
import type { WeatherSummary } from "@/lib/weather-types";

const searchSchema = z.object({
  from: z.string().optional(),
  tripId: z.string().optional(),
});

export const Route = createFileRoute("/_app/place/$placeId")({
  validateSearch: (search) => searchSchema.parse(search),
  component: PlaceDetailRoute,
});

function PlaceDetailRoute() {
  const { t } = useI18n();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const search = Route.useSearch();

  const handleBackFallback = useCallback(() => {
    if (search.from === "trip_detail" && search.tripId) {
      void navigate({
        to: "/saved/$tripId",
        params: { tripId: search.tripId },
        replace: false,
      });
      return;
    }
    if (search.from === "home") {
      void navigate({ to: "/", replace: false });
      return;
    }
    if (window.history.length > 1) router.history.back();
    else void navigate({ to: "/" });
  }, [navigate, router.history, search.from, search.tripId]);

  return (
    <PlaceDetailErrorBoundary title={t("map.placeDetail")} onBack={handleBackFallback}>
      <PlaceDetailPage />
    </PlaceDetailErrorBoundary>
  );
}

function PlaceDetailPage() {
  useIosInteractiveRoute("place-detail");
  const { placeId: placeIdParam } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { t, locale } = useI18n();
  const fetchPlaceDetailsServerFn = useServerFn(getPlaceDetails);
  const fetchPlaceDetailsFn = useMemo(
    () => createUnifiedPlaceDetailsFn(fetchPlaceDetailsServerFn),
    [fetchPlaceDetailsServerFn],
  );
  const fetchPlaceIntroFn = useServerFn(getPlaceIntro);
  const fetchWeatherFn = useServerFn(getWeather);
  const { openAddToTrip } = useAddToTrip();

  const routePlaceId = useMemo(() => {
    try {
      return decodeURIComponent(placeIdParam).trim();
    } catch {
      return placeIdParam.trim();
    }
  }, [placeIdParam]);

  const handoffRef = useRef<ReturnType<typeof peekPlaceDetailHandoff>>(peekPlaceDetailHandoff());
  const [tripItineraryContext, setTripItineraryContext] =
    useState<PlaceIntroItineraryContext | null>(null);
  const [place, setPlace] = useState<PlaceDetailViewModel | null>(() => {
    const handoff = resolvePlaceDetailHandoff(routePlaceId, {}, handoffRef.current);
    if (!handoff) return null;
    return enrichPlaceDetailWithAiContent(handoffToPlaceDetailData(handoff), {
      locale: "zh-TW",
      itineraryContext: handoff.itineraryContext ?? null,
    });
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [userLocation, setUserLocation] = useState(TAIPEI_CENTER);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [reasonProfile, setReasonProfile] = useState(EMPTY_USER_PROFILE_FOR_REASON);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editorialSummary, setEditorialSummary] = useState<string | null>(null);
  const [photoBundle, setPhotoBundle] = useState<{
    urls: string[];
    source: "google_places" | "itinerary" | "unsplash" | "fallback";
  }>({ urls: [], source: "fallback" });
  const [routeOrigin, setRouteOrigin] = useState(TAIPEI_CENTER);

  const affiliateCityForIntro = useMemo(() => {
    if (!place?.address?.trim()) return null;
    const parts = place.address.split(/[,，]/).map((p) => p.trim()).filter(Boolean);
    return parts[0] ?? null;
  }, [place?.address]);

  const enrichOptions = useMemo((): EnrichPlaceDetailAiOptions => {
    const handoffCtx = handoffRef.current?.itineraryContext;
    return {
      locale,
      weather,
      userProfile: reasonProfile,
      itineraryContext: {
        ...handoffCtx,
        ...tripItineraryContext,
        city:
          tripItineraryContext?.city ??
          handoffCtx?.city ??
          affiliateCityForIntro ??
          null,
        destination:
          tripItineraryContext?.destination ?? handoffCtx?.destination ?? null,
      },
      editorialSummary,
      city: affiliateCityForIntro,
    };
  }, [
    locale,
    weather,
    reasonProfile,
    tripItineraryContext,
    editorialSummary,
    affiliateCityForIntro,
  ]);

  const enrichOptionsRef = useRef(enrichOptions);
  enrichOptionsRef.current = enrichOptions;

  useEffect(() => {
    logPlaceDetailScreenMounted();
    console.info("[PLACE_DETAIL] mounted");
    console.info("[PLACE_DETAIL] mounted placeId=", routePlaceId);
    const source = search.from ?? "explore";
    console.info("[PLACE_DETAIL] source=", source, "placeId=", routePlaceId);

    const peeked = peekPlaceDetailHandoff();
    if (peeked) handoffRef.current = peeked;
    const consumed = consumePlaceDetailHandoff();
    if (consumed) handoffRef.current = consumed;

    const handoff = resolvePlaceDetailHandoff(routePlaceId, {}, handoffRef.current);
    logPlaceDetailParamsReceived({ routePlaceId, search, handoff });
    if (!handoff) {
      setPlace(null);
      setLoading(false);
      setFetchError("missing_params");
      logPlaceDetailFallbackUsed("missing_handoff");
      console.info("[PLACE_DETAIL] fallback used=", "missing_handoff");
      return;
    }

    const base = enrichPlaceDetailWithAiContent(handoffToPlaceDetailData(handoff), {
      locale,
      itineraryContext: handoff.itineraryContext ?? null,
    });
    setPlace(base);
    setLoading(true);
    setFetchError(null);
    setUsedFallback(false);

    if (source === "saved" && !isGooglePlaceId(handoff.placeId)) {
      logPlaceDetailFallbackUsed("saved_handoff_only");
      setUsedFallback(true);
      setFetchError(null);
      setLoading(false);
      return;
    }

    const routeCtx = handoff.routeContext;
    if (routeCtx) {
      logPlaceDetailRouteContext({
        source: routeCtx.source,
        fromPlace: routeCtx.fromPlace,
        toPlace: routeCtx.toPlace,
      });
      if (
        routeCtx.source === "trip_sequence" &&
        routeCtx.originLat != null &&
        routeCtx.originLng != null
      ) {
        setRouteOrigin({ lat: routeCtx.originLat, lng: routeCtx.originLng });
      }
    }

    logPlaceDetailOpened({
      source,
      placeName: handoff.name,
      tripId: search.tripId,
      dayIndex: handoff.itineraryContext?.dayIndex ?? null,
      placeId: handoff.placeId,
    });

    let cancelled = false;

    const fetchDetails = async (placeId: string) => {
      logPlaceDetailFetchStarted(placeId);
      const server = await fetchPlaceDetailsFn({ data: { placeId, locale } });
      if (server.place) return server;
      if (!canReachBundledAppApiOrigin()) {
        const clientKey = readGoogleMapsKeyFromClientEnv();
        if (clientKey) {
          const clientFetched = await getCachedPlaceDetailsForScreen(placeId, locale, () =>
            fetchPlaceDetailsForScreen(placeId, locale, { apiKey: clientKey }),
          );
          if (clientFetched) return { place: clientFetched, error: null };
        }
      }
      return server;
    };

    void (async () => {
      const isTripFlow = source === "trip_detail" || Boolean(handoff.itineraryItem);

      if (isTripFlow) {
        const hydrated = await hydratePlaceDetailFromTrip({
          handoff,
          source,
          tripId: search.tripId,
          destination:
            handoff.itineraryContext?.destination ??
            handoff.city ??
            undefined,
          city: handoff.city ?? handoff.itineraryContext?.city,
          locale,
          fetchDetails,
        });
        if (cancelled) return;

        handoffRef.current = hydrated.handoff;
        const viewBase = hydrated.merged ?? hydrated.itineraryBase;
        const enriched = enrichPlaceDetailWithAiContent(viewBase, {
          ...enrichOptionsRef.current,
          itineraryContext: hydrated.handoff.itineraryContext ?? handoff.itineraryContext ?? null,
        });
        setPlace(enriched);
        const photos = buildPlaceImageUrlsWithSource(enriched, hydrated.handoff);
        setPhotoBundle({ urls: photos.urls, source: photos.source });
        logPlaceDetailPhotoSource({
          placeName: enriched.name,
          source: photos.source,
          hasGooglePhoto: photos.hasGooglePhoto,
        });
        setFetchError(hydrated.error);
        setUsedFallback(!hydrated.merged && Boolean(hydrated.error));
        if (hydrated.merged) {
          logPlaceDetailFetchSuccess(hydrated.googlePlaceId ?? enriched.id);
        }
        return;
      }

      if (shouldFetchRemotePlaceDetails(handoff.placeId, source)) {
        const hydrated = await hydratePlaceDetailFromTrip({
          handoff,
          source,
          locale,
          fetchDetails,
        });
        if (cancelled) return;
        if (hydrated.merged) {
          const enriched = enrichPlaceDetailWithAiContent(hydrated.merged, enrichOptionsRef.current);
          setPlace(enriched);
          const photos = buildPlaceImageUrlsWithSource(enriched, handoff);
          setPhotoBundle({ urls: photos.urls, source: photos.source });
          logPlaceDetailPhotoSource({
            placeName: enriched.name,
            source: photos.source,
            hasGooglePhoto: photos.hasGooglePhoto,
          });
          logPlaceDetailFetchSuccess(hydrated.googlePlaceId ?? enriched.id);
          setFetchError(null);
          setUsedFallback(false);
          return;
        }
      }

      logPlaceDetailFallbackUsed("no_google_place_id");
      setUsedFallback(true);
      setFetchError(null);
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [routePlaceId, search.from, search.tripId, locale, fetchPlaceDetailsFn]);

  useEffect(() => {
    let cancelled = false;
    void requestDeviceLocation()
      .then((loc) => {
        if (cancelled || !loc) return;
        setUserLocation({ lat: loc.lat, lng: loc.lng });
      })
      .catch(() => {});
    void Promise.all([getUserProfile().catch(() => null), getPreferences(), listPlaces().catch(() => [])])
      .then(([profile, prefs, saved]) => {
        if (cancelled) return;
        setReasonProfile(
          userProfileForReasonFrom(profile?.prefs ?? prefs, {
            travelStyle: profile?.travelStyle,
            personalityType: profile?.personalityType,
            personalitySummary: profile?.personalitySummary,
            aiPreferences: profile?.aiPreferences,
          }),
        );
        setSavedNames(new Set(saved.map((s) => s.name)));
        const lat = place?.lat ?? userLocation.lat;
        const lng = place?.lng ?? userLocation.lng;
        return fetchWeatherFn({ data: { lat, lng, locale } });
      })
      .then((w) => {
        if (cancelled || !w?.weather) return;
        setWeather(w.weather);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locale, place?.lat, place?.lng, userLocation.lat, userLocation.lng, fetchWeatherFn]);

  useEffect(() => {
    if (!place?.name?.trim()) return;
    let cancelled = false;
    const handoffCtx = handoffRef.current?.itineraryContext;
    if (!search.tripId) {
      setTripItineraryContext(handoffCtx ?? null);
      return;
    }
    void loadPlaceIntroItineraryContext(search.tripId, place.name, {
      travelStyle: reasonProfile.travelStyle,
      pace: reasonProfile.pace,
      mood: reasonProfile.mood,
    }).then((ctx) => {
      if (!cancelled) setTripItineraryContext(ctx ?? handoffCtx ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    search.tripId,
    place?.name,
    reasonProfile.travelStyle,
    reasonProfile.pace,
    reasonProfile.mood,
  ]);

  useEffect(() => {
    if (!place?.name?.trim()) return;
    setPlace((prev) =>
      prev ? enrichPlaceDetailWithAiContent(prev, enrichOptions) : prev,
    );
  }, [enrichOptions, place?.id, place?.name]);

  useEffect(() => {
    if (!place?.id || !shouldFetchRemotePlaceDetails(place.id, search.from)) {
      setEditorialSummary(null);
      return;
    }
    let cancelled = false;
    void fetchPlaceIntroFn({
      data: {
        placeId: place.id,
        reason: isGenericPlaceReason(place.reason) ? undefined : place.reason,
        locale,
        lat: place.lat ?? undefined,
        lng: place.lng ?? undefined,
      },
    })
      .then(({ editorialSummary: summary }) => {
        if (cancelled) return;
        if (summary?.trim()) setEditorialSummary(summary.trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [place?.id, place?.reason, locale, fetchPlaceIntroFn, place?.lat, place?.lng, search.from]);

  const destination =
    place?.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;

  const navOrigin =
    search.from === "trip_detail" &&
    handoffRef.current?.routeContext?.source === "trip_sequence" &&
    handoffRef.current.routeContext.originLat != null &&
    handoffRef.current.routeContext.originLng != null
      ? routeOrigin
      : userLocation;

  const navigation = usePlaceNavigation({
    origin: navOrigin,
    destination,
    weather,
    profile: reasonProfile,
    enabled: !!destination && !loading,
  });

  const imageUrls = photoBundle.urls.length > 0 ? photoBundle.urls : place ? buildPlaceImageUrlsWithSource(place, handoffRef.current ?? undefined).urls : [];

  const distanceLabel = useMemo(() => {
    if (!place || place.lat == null || place.lng == null) return null;
    if (search.from === "trip_detail") {
      return formatDistanceLabel(distanceMeters(navOrigin, { lat: place.lat, lng: place.lng }));
    }
    return formatDistanceLabel(distanceMeters(userLocation, { lat: place.lat, lng: place.lng }));
  }, [place, navOrigin, userLocation, search.from]);

  const handleBack = useCallback(() => {
    if (search.from === "trip_detail" && search.tripId) {
      void navigate({
        to: "/saved/$tripId",
        params: { tripId: search.tripId },
        replace: false,
      });
      return;
    }
    if (search.from === "chat") {
      console.info("[CHAT_RETURN] preserved=true");
      if (window.history.length > 1) {
        router.history.back();
        return;
      }
      void navigate({ to: "/chat", replace: false });
      return;
    }
    if (search.from === "saved") {
      void navigate({ to: "/saved", search: { tab: "places" }, replace: false });
      return;
    }
    if (search.from === "home") {
      void navigate({ to: "/", replace: false });
      return;
    }
    if (search.from === "recommendations") {
      if (window.history.length > 1) {
        router.history.back();
        return;
      }
      void navigate({ to: "/", replace: false });
      return;
    }
    if (window.history.length > 1) {
      router.history.back();
      return;
    }
    void navigate({ to: "/map", replace: false });
  }, [navigate, router.history, search.from, search.tripId]);

  const handleToggleSave = async () => {
    if (!place) return;
    setBusy(true);
    try {
      const { saved: didSave } = await toggleSavePlace({
        name: place.name,
        category: place.primaryType,
        address: place.address,
        city: null,
        lat: place.lat,
        lng: place.lng,
        notes: place.reason,
        mood_tag: null,
        cover_image: imageUrls[0] ?? null,
      });
      toast.success(didSave ? "已加入收藏" : "已取消收藏");
      setSavedNames((prev) => {
        const next = new Set(prev);
        if (didSave) next.add(place.name);
        else next.delete(place.name);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenChat = () => {
    if (!place) return;
    const distM =
      place.lat != null && place.lng != null
        ? distanceMeters(userLocation, { lat: place.lat, lng: place.lng })
        : undefined;
    const item = mapPlaceResultToChatItem(place, {
      weather,
      userProfile: reasonProfile,
      distanceMeters: distM,
      locale,
    });
    saveChatSession(addSelectedPlace({ ...loadChatSession(), phase: "followup" }, item));
    navigate({ to: "/chat", search: { from: "map" } });
    toast.message(`已帶入「${place.name}」，到聊聊繼續問 Roamie`);
  };

  const handleNavigate = () => {
    if (!destination) {
      toast.message(t("map.noCoordsRoute"));
      return;
    }
    navigation.startNavigation();
  };

  if (!place) {
    return (
      <div className="flex flex-1 flex-col px-5 pb-8 pt-3">
        <ExploreSubpageHeader title={t("map.placeDetail")} onBack={handleBack} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">暫時讀不到這個地點，稍後再試一次</p>
          <button
            type="button"
            onClick={handleBack}
            className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
      <ExploreSubpageHeader title={t("map.placeDetail")} onBack={handleBack} />

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-7 w-7 animate-spin text-clay" aria-hidden />
            <p className="text-sm text-muted-foreground">載入地點資訊…</p>
          </div>
        ) : fetchError && usedFallback && !place.address && place.lat == null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
            <p className="text-sm text-muted-foreground">暫時讀不到這個地點，稍後再試一次</p>
            <button
              type="button"
              onClick={handleBack}
              className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              返回
            </button>
          </div>
        ) : (
          <>
            {usedFallback && fetchError ? (
              <p className="mx-5 mb-1 rounded-2xl bg-secondary/80 px-3 py-2 text-xs text-muted-foreground">
                部分資訊暫時無法更新，先顯示已知內容
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
              <PlaceDetailSheet
                place={place}
                imageUrls={imageUrls}
                distanceLabel={distanceLabel}
                isSaved={savedNames.has(place.name)}
                isBusy={busy}
                transportModes={navigation.modes}
                transportLoading={navigation.loading}
                transportTip={navigation.aiTip}
                selectedTransportMode={navigation.selectedMode}
                onSelectTransportMode={navigation.setSelectedMode}
                onNavigate={handleNavigate}
                onToggleSave={() => void handleToggleSave()}
                onAddToTrip={() => openAddToTrip(tripPlaceFromPlaceResult(place))}
                addToTripLabel={t("chat.addToTrip")}
                saveLabel="收藏"
                onOpenChat={handleOpenChat}
                showAffiliateLinks={search.from === "trip_detail" || search.from === "saved"}
                affiliateCity={
                  place.address?.split(/[,，]/)[0]?.trim() ??
                  place.address?.trim() ??
                  null
                }
              />
            </div>
          </>
        )}
    </div>
  );
}
