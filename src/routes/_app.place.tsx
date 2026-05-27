import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { PlaceDetailSheet, ExploreSubpageHeader } from "@/components/map/PlaceDetailSheet";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { useI18n } from "@/hooks/use-i18n";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { usePlaceNavigation } from "@/hooks/use-place-navigation";
import { useAvatar } from "@/hooks/use-avatar";
import { consumePlaceDetailHandoff } from "@/lib/place-detail-handoff";
import {
  logPlaceDetailFetchFailed,
  logPlaceDetailFetchStarted,
  logPlaceDetailFetchSuccess,
  logPlaceDetailFallbackUsed,
  logPlaceDetailParamsReceived,
  logPlaceDetailScreenMounted,
} from "@/lib/place-detail-log";
import {
  buildPlaceImageUrls,
  canFetchGooglePlaceDetails,
  handoffToPlaceDetailData,
  mergeFetchedPlace,
  resolvePlaceDetailHandoff,
  type PlaceDetailViewModel,
} from "@/lib/place-detail-resolve";
import { getPlaceDetails } from "@/lib/places.functions";
import { getPlaceIntro } from "@/lib/recommendation.functions";
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
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { getWeather } from "@/lib/weather.functions";
import type { WeatherSummary } from "@/lib/weather-types";

const searchSchema = z.object({
  placeId: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

export const Route = createFileRoute("/_app/place")({
  validateSearch: (search) => searchSchema.parse(search),
  component: PlaceDetailPage,
});

function PlaceDetailPage() {
  useIosInteractiveRoute("place-detail");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = Route.useRouter();
  const { t, locale } = useI18n();
  const fetchPlaceDetailsFn = useServerFn(getPlaceDetails);
  const fetchPlaceIntroFn = useServerFn(getPlaceIntro);
  const fetchWeatherFn = useServerFn(getWeather);
  const { openAddToTrip } = useAddToTrip();
  useAvatar();

  const handoffRef = useRef(consumePlaceDetailHandoff());
  const [place, setPlace] = useState<PlaceDetailViewModel | null>(() => {
    const handoff = resolvePlaceDetailHandoff(search, handoffRef.current);
    return handoff ? handoffToPlaceDetailData(handoff) : null;
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [userLocation, setUserLocation] = useState(TAIPEI_CENTER);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [reasonProfile, setReasonProfile] = useState(
    userProfileForReasonFrom(null, null),
  );
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [introExtra, setIntroExtra] = useState<{
    intro?: string;
    suitableFor?: string;
    weatherFit?: string;
    goNowAdvice?: string;
    introLoading?: boolean;
  }>({});

  useEffect(() => {
    logPlaceDetailScreenMounted();
    const handoff = resolvePlaceDetailHandoff(search, handoffRef.current);
    logPlaceDetailParamsReceived({ search, handoff });
    if (!handoff) {
      setPlace(null);
      setLoading(false);
      setFetchError("missing_params");
      return;
    }

    const base = handoffToPlaceDetailData(handoff);
    setPlace(base);
    setLoading(true);
    setFetchError(null);
    setUsedFallback(false);

    if (!canFetchGooglePlaceDetails(handoff.placeId)) {
      logPlaceDetailFallbackUsed("no_google_place_id");
      setUsedFallback(true);
      setLoading(false);
      return;
    }

    logPlaceDetailFetchStarted(handoff.placeId);
    let cancelled = false;
    void fetchPlaceDetailsFn({ data: { placeId: handoff.placeId, locale } })
      .then(({ place: fetched, error }) => {
        if (cancelled) return;
        if (fetched) {
          logPlaceDetailFetchSuccess(handoff.placeId);
          setPlace(mergeFetchedPlace(base, fetched));
          setFetchError(null);
          return;
        }
        logPlaceDetailFetchFailed(handoff.placeId, error ?? "unknown");
        logPlaceDetailFallbackUsed(error ?? "fetch_failed");
        setUsedFallback(true);
        setFetchError(error);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "fetch_failed";
        logPlaceDetailFetchFailed(handoff.placeId, msg);
        logPlaceDetailFallbackUsed(msg);
        setUsedFallback(true);
        setFetchError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search.placeId, search.lat, search.lng, locale, fetchPlaceDetailsFn]);

  useEffect(() => {
    let cancelled = false;
    void requestDeviceLocation()
      .then((loc) => {
        if (cancelled || !loc) return;
        setUserLocation({ lat: loc.lat, lng: loc.lng });
      })
      .catch(() => {});
    void Promise.all([getUserProfile(), getPreferences(), listPlaces().catch(() => [])])
      .then(([profile, prefs, saved]) => {
        if (cancelled) return;
        setReasonProfile(userProfileForReasonFrom(profile, prefs));
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
    if (!place?.id || !canFetchGooglePlaceDetails(place.id)) {
      setIntroExtra({});
      return;
    }
    let cancelled = false;
    setIntroExtra({ introLoading: true });
    void fetchPlaceIntroFn({
      data: {
        placeId: place.id,
        reason: place.reason,
        locale,
        lat: place.lat ?? undefined,
        lng: place.lng ?? undefined,
      },
    })
      .then(({ intro }) => {
        if (cancelled) return;
        if (!intro) {
          setIntroExtra({});
          return;
        }
        setIntroExtra({
          intro: intro.intro,
          suitableFor: intro.suitableFor,
          weatherFit: intro.weatherFit,
          goNowAdvice: intro.goNowAdvice,
          introLoading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setIntroExtra({});
      });
    return () => {
      cancelled = true;
    };
  }, [place?.id, place?.reason, locale, fetchPlaceIntroFn, place?.lat, place?.lng]);

  const destination =
    place?.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;

  const navigation = usePlaceNavigation({
    origin: userLocation,
    destination,
    weather,
    profile: reasonProfile,
    enabled: !!destination && !loading,
  });

  const imageUrls = useMemo(() => (place ? buildPlaceImageUrls(place) : []), [place]);

  const distanceLabel = useMemo(() => {
    if (!place || place.lat == null || place.lng == null) return null;
    return formatDistanceLabel(distanceMeters(userLocation, { lat: place.lat, lng: place.lng }));
  }, [place, userLocation]);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.history.back();
      return;
    }
    navigate({ to: "/" });
  }, [navigate, router.history]);

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
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-20 text-center">
        <p className="text-sm text-muted-foreground">暫時讀不到這個地點，稍後再試一次</p>
        <button
          type="button"
          onClick={handleBack}
          className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
        >
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-4">
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
          <PlaceDetailSheet
            place={{ ...place, ...introExtra }}
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
          />
        </>
      )}
    </div>
  );
}
