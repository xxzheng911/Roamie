import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { PlaceDetailSheet, ExploreSubpageHeader } from "@/components/map/PlaceDetailSheet";
import { useAppMainScroll } from "@/hooks/use-app-main-scroll";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { useI18n } from "@/hooks/use-i18n";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { useAccess } from "@/hooks/use-access";
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
import { placeOpeningStatusLabel } from "@/lib/normalized-opening-status";
import {
  buildPlaceImageUrls,
  canFetchGooglePlaceDetails,
  handoffToPlaceDetailData,
  mergeFetchedPlace,
  resolveGooglePlaceIdForDetail,
  resolvePlaceDetailHandoff,
  type PlaceDetailViewModel,
} from "@/lib/place-detail-resolve";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import {
  fetchGooglePlaceDetailsForHandoffViaGateway,
  fetchPlaceDetailsForScreenWithKeyViaGateway,
  getPlaceDetailsServerFnViaGateway,
} from "@/lib/pie/places-gateway";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { detectPlatform } from "@/services/platform";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import { requestDeviceLocation } from "@/lib/device-location";
import { TAIPEI_CENTER } from "@/lib/geo";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import { tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import { readTripDetailSelectedDay } from "@/lib/trip/trip-detail-selected-day";
import {
  addSelectedPlace,
  loadChatSession,
  mapPlaceResultToChatItem,
  saveChatSession,
} from "@/lib/chat-session";
import {
  buildPlaceRecommendationReason,
  userProfileForReasonFrom,
} from "@/lib/build-place-recommendation-reason";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import {
  resolvePlaceDisplayAddress,
  sanitizeGooglePlaceAddress,
} from "@/lib/place-display-address";
import { getWeather } from "@/lib/weather.functions";
import type { WeatherSummary } from "@/lib/weather-types";
import { inferExploreCityLabel } from "@/lib/explore-recommend-mode";
import { requestExploreMapClearSelection } from "@/lib/explore-map-selection";
import { buildNewSavedPlaceInput } from "@/lib/saved-place-utils";
import { resolveTabelogPlaceExternalUrl } from "@/lib/tabelog-reference";
import { buildPlaceDetailTicketOffers } from "@/lib/affiliate/affiliate-links";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";

const searchSchema = z.object({
  placeId: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  /** 返回來源：chat 從聊聊回來；map 從探索回來；trip 從行程內頁回來 */
  returnTo: z.enum(["chat", "map", "home", "trip", "saved"]).optional(),
  tripId: z.string().optional(),
  day: z.coerce.number().optional(),
  /** Trip planning mode: previous stop / day origin (not device GPS) */
  originLat: z.coerce.number().optional(),
  originLng: z.coerce.number().optional(),
});

export const Route = createFileRoute("/_app/place")({
  validateSearch: (search) => searchSchema.parse(search),
  component: PlaceDetailPage,
});

function PlaceDetailPage() {
  useIosInteractiveRoute("place-detail");
  useAppMainScroll();

  useLayoutEffect(() => {
    document.documentElement.classList.add("place-route-active");
    const main = document.querySelector("main.app-scroll");
    if (main instanceof HTMLElement) {
      main.style.overflow = "hidden";
    }
    return () => {
      document.documentElement.classList.remove("place-route-active");
      if (main instanceof HTMLElement) {
        main.style.removeProperty("overflow");
      }
    };
  }, []);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t, locale } = useI18n();
  const { hasPlusAccess } = useAccess();
  const fetchPlaceDetailsFn = useServerFn(getPlaceDetailsServerFnViaGateway);
  const fetchWeatherFn = useServerFn(getWeather);
  const { openAddToTrip } = useAddToTrip();
  useAvatar();

  const handoffRef = useRef(consumePlaceDetailHandoff());
  const [place, setPlace] = useState<PlaceDetailViewModel | null>(() => {
    const handoff = resolvePlaceDetailHandoff(search, handoffRef.current);
    return handoff ? handoffToPlaceDetailData(handoff, locale) : null;
  });
  // Stale-while-revalidate: if a snapshot is already available, never block the first paint.
  const [loading, setLoading] = useState(() => {
    const handoff = resolvePlaceDetailHandoff(search, handoffRef.current);
    if (!handoff) return true;
    const hasSnapshot = Boolean(
      handoff.name &&
      (handoff.address ||
        handoff.lat != null ||
        handoff.googlePlaceId ||
        handoff.rating != null ||
        handoff.snapshot),
    );
    return !hasSnapshot;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [userLocation, setUserLocation] = useState(TAIPEI_CENTER);
  const tripPlanningOrigin = useMemo(() => {
    if (
      search.returnTo === "trip" &&
      search.originLat != null &&
      search.originLng != null &&
      Number.isFinite(search.originLat) &&
      Number.isFinite(search.originLng)
    ) {
      return { lat: search.originLat, lng: search.originLng };
    }
    return null;
  }, [search.returnTo, search.originLat, search.originLng]);
  const navigationOrigin = tripPlanningOrigin ?? userLocation;
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [reasonProfile, setReasonProfile] = useState(() => userProfileForReasonFrom({}));
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    logPlaceDetailScreenMounted();
    const handoff = resolvePlaceDetailHandoff(search, handoffRef.current);
    logPlaceDetailParamsReceived({ search, handoff });
    if (search.returnTo === "trip" && search.tripId) {
      const dayIndex =
        search.day != null && search.day > 0
          ? search.day - 1
          : (readTripDetailSelectedDay(search.tripId) ?? 0);
      console.info(
        `[PLACE_DETAIL_OPEN_FROM_TRIP] tripId=${search.tripId} dayIndex=${dayIndex} placeId=${search.placeId ?? handoff?.placeId ?? ""}`,
      );
    }
    if (!handoff) {
      setPlace(null);
      setLoading(false);
      setFetchError("missing_params");
      return;
    }

    const base = handoffToPlaceDetailData(handoff, locale);
    setPlace(base);
    const hasSnapshot = Boolean(
      handoff.name &&
      (handoff.address ||
        handoff.lat != null ||
        handoff.googlePlaceId ||
        handoff.rating != null ||
        handoff.snapshot),
    );
    // Snapshot-first: show immediately; remote refresh runs in background.
    setLoading(!hasSnapshot);
    setRefreshing(hasSnapshot);
    setFetchError(null);
    setUsedFallback(false);

    let cancelled = false;
    const openedAt = performance.now();
    console.info(
      `[PLACE_DETAIL_OPEN] placeId=${handoff.placeId ?? ""} snapshotAvailable=${hasSnapshot}`,
    );
    if (hasSnapshot) {
      console.info(
        `[PLACE_DETAIL_FIRST_RENDER] source=saved_snapshot elapsedMs=${Math.round(performance.now() - openedAt)}`,
      );
    }

    const finishLoading = () => {
      if (!cancelled) {
        setLoading(false);
        setRefreshing(false);
      }
    };

    const applyFetched = (fetched: PlaceDetailsScreenResult, resolvedPlaceId: string) => {
      logPlaceDetailFetchSuccess(resolvedPlaceId);
      setPlace(mergeFetchedPlace(base, fetched, locale));
      setFetchError(null);
      setUsedFallback(false);
    };

    void (async () => {
      const refreshStarted = performance.now();
      let placeId = handoff.placeId?.trim() || "";
      if (!canFetchGooglePlaceDetails(placeId)) {
        const resolved = await resolveGooglePlaceIdForDetail(handoff, locale);
        if (cancelled) return;
        if (resolved) placeId = resolved;
      }

      if (!canFetchGooglePlaceDetails(placeId)) {
        logPlaceDetailFallbackUsed("no_google_place_id");
        setUsedFallback(true);
        if (!hasSnapshot) {
          console.info(
            `[PLACE_DETAIL_FIRST_RENDER] source=cache elapsedMs=${Math.round(performance.now() - openedAt)}`,
          );
        }
        finishLoading();
        return;
      }

      if (placeId !== base.id) {
        setPlace((prev) => (prev ? { ...prev, id: placeId } : prev));
      }

      logPlaceDetailFetchStarted(placeId);

      const DETAIL_REFRESH_TIMEOUT_MS = 8_000;
      try {
        const fetchPromise = fetchGooglePlaceDetailsForHandoffViaGateway(
          placeId,
          locale,
          fetchPlaceDetailsFn,
          detectPlatform().isCapacitor
            ? async (id, loc) => {
                const mapsKey = getGoogleMapsBrowserKey();
                if (!mapsKey) return null;
                return fetchPlaceDetailsForScreenWithKeyViaGateway(id, mapsKey, loc);
              }
            : undefined,
        );
        const timeoutPromise = new Promise<{ place: null; error: string }>((resolve) => {
          setTimeout(
            () => resolve({ place: null, error: "detail_refresh_timeout" }),
            DETAIL_REFRESH_TIMEOUT_MS,
          );
        });
        const { place: fetched, error } = await Promise.race([fetchPromise, timeoutPromise]);
        if (cancelled) return;
        if (fetched) {
          applyFetched(fetched, placeId);
          if (!hasSnapshot) {
            console.info(
              `[PLACE_DETAIL_FIRST_RENDER] source=remote elapsedMs=${Math.round(performance.now() - openedAt)}`,
            );
          }
          console.info(
            `[PLACE_DETAIL_REMOTE_REFRESH] elapsedMs=${Math.round(performance.now() - refreshStarted)} success=true`,
          );
          return;
        }
        logPlaceDetailFetchFailed(placeId, error ?? "unknown");
        logPlaceDetailFallbackUsed(error ?? "fetch_failed");
        setUsedFallback(true);
        setFetchError(error);
        console.info(
          `[PLACE_DETAIL_REMOTE_REFRESH] elapsedMs=${Math.round(performance.now() - refreshStarted)} success=false`,
        );
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "fetch_failed";
        logPlaceDetailFetchFailed(placeId, msg);
        logPlaceDetailFallbackUsed(msg);
        setUsedFallback(true);
        setFetchError(msg);
        console.info(
          `[PLACE_DETAIL_REMOTE_REFRESH] elapsedMs=${Math.round(performance.now() - refreshStarted)} success=false`,
        );
      } finally {
        finishLoading();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [search.placeId, search.lat, search.lng, search.returnTo, locale, fetchPlaceDetailsFn]);

  useEffect(() => {
    let cancelled = false;
    if (tripPlanningOrigin) {
      setUserLocation(tripPlanningOrigin);
    } else {
      void import("@/lib/location-app-gate")
        .then(({ waitForAppActiveForLocation }) =>
          waitForAppActiveForLocation().then((active) => {
            if (!active || cancelled) return;
            return requestDeviceLocation().then((loc) => {
              if (cancelled || !loc) return;
              setUserLocation({ lat: loc.lat, lng: loc.lng });
            });
          }),
        )
        .catch(() => {});
    }
    void Promise.all([
      getUserProfile(locale).catch(() => null),
      getPreferences().catch(() => ({}) as Awaited<ReturnType<typeof getPreferences>>),
      listPlaces().catch(() => []),
    ])
      .then(([profile, prefs, saved]) => {
        if (cancelled) return;
        setReasonProfile(
          userProfileForReasonFrom(profile?.prefs ?? prefs, {
            travelStyle: profile?.travelStyle,
            personalityType: profile?.personalityType,
            personalitySummary: profile?.personalitySummary,
            aiPreferences: profile?.aiPreferences,
            hasPlusAccess,
          }),
        );
        setSavedNames(new Set(saved.map((s) => s.name)));
        const lat = place?.lat ?? navigationOrigin.lat;
        const lng = place?.lng ?? navigationOrigin.lng;
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
  }, [
    locale,
    place?.lat,
    place?.lng,
    navigationOrigin.lat,
    navigationOrigin.lng,
    tripPlanningOrigin,
    fetchWeatherFn,
    hasPlusAccess,
  ]);

  useEffect(() => {
    setPlace((prev) => {
      if (!prev) return prev;
      const distM =
        prev.lat != null && prev.lng != null
          ? distanceMeters(navigationOrigin, { lat: prev.lat, lng: prev.lng })
          : undefined;
      const nextReason = buildPlaceRecommendationReason(
        prev,
        reasonProfile,
        weather,
        undefined,
        { distanceMeters: distM },
        locale,
      );
      return prev.reason !== nextReason ? { ...prev, reason: nextReason } : prev;
    });
  }, [place?.id, weather, reasonProfile, locale, navigationOrigin.lat, navigationOrigin.lng]);

  const destination =
    place?.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;

  const navigation = usePlaceNavigation({
    origin: navigationOrigin,
    destination,
    weather,
    profile: reasonProfile,
    enabled: !!destination && !loading,
  });

  const imageUrls = useMemo(() => (place ? buildPlaceImageUrls(place) : []), [place]);

  const placeForSheet = useMemo(() => {
    if (!place) return null;
    const google = place as PlaceDetailsScreenResult;
    const address =
      resolvePlaceDisplayAddress(
        {
          formattedAddress: google.googleFormattedAddress,
          shortFormattedAddress: google.googleShortFormattedAddress,
          vicinity: google.googleVicinity,
          address: place.address,
        },
        {
          hasCoords: place.lat != null && place.lng != null,
          locale,
          googleFieldsOnly: Boolean(google.googleFormattedAddress),
        },
      ) ?? (place.address ? sanitizeGooglePlaceAddress(place.address, locale) : null);
    return {
      ...place,
      address,
      openStatusLabel: placeOpeningStatusLabel(place) ?? place.openStatusLabel,
      normalizedOpeningLabel:
        place.normalizedOpeningLabel ?? placeOpeningStatusLabel(place) ?? place.openStatusLabel,
    };
  }, [place, locale]);

  const distanceLabel = useMemo(() => {
    if (!place || place.lat == null || place.lng == null) return null;
    return formatDistanceLabel(
      distanceMeters(navigationOrigin, { lat: place.lat, lng: place.lng }),
    );
  }, [place, navigationOrigin]);

  const placeTabelogUrl = useMemo(() => {
    if (!place) return null;
    const cityLabel =
      place.lat != null && place.lng != null
        ? inferExploreCityLabel(place.lat, place.lng, place.address)
        : inferExploreCityLabel(userLocation.lat, userLocation.lng, place.address);
    return resolveTabelogPlaceExternalUrl({
      cityLabel,
      address: place.address,
      place,
    });
  }, [place, userLocation.lat, userLocation.lng]);

  const placeTicketOffers = useMemo(() => {
    if (!place) return [];
    const cityLabel =
      place.lat != null && place.lng != null
        ? inferExploreCityLabel(place.lat, place.lng, place.address)
        : inferExploreCityLabel(userLocation.lat, userLocation.lng, place.address);
    return buildPlaceDetailTicketOffers(
      {
        name: place.name,
        primaryType: place.primaryType,
        types: place.types,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
      },
      { destinationLabel: cityLabel, locale },
    );
  }, [place, userLocation.lat, userLocation.lng, locale]);

  const handleBack = useCallback(() => {
    if (search.returnTo === "chat") {
      navigate({ to: "/chat" });
      return;
    }
    if (search.returnTo === "map") {
      requestExploreMapClearSelection();
      navigate({ to: "/map" });
      return;
    }
    if (search.returnTo === "home") {
      navigate({ to: "/" });
      return;
    }
    if (search.returnTo === "saved") {
      navigate({ to: "/saved", search: { tab: "places" } });
      return;
    }
    if (search.returnTo === "trip" && search.tripId) {
      const restoreDayIndex =
        search.day != null && search.day > 0
          ? search.day - 1
          : (readTripDetailSelectedDay(search.tripId) ?? 0);
      const restoreDay = search.day != null && search.day > 0 ? search.day : restoreDayIndex + 1;
      console.info(
        `[PLACE_DETAIL_BACK_TO_TRIP] tripId=${search.tripId} restoreDayIndex=${restoreDayIndex}`,
      );
      navigate(tripDetailNavigateOptions(search.tripId, { day: restoreDay }));
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate({ to: "/" });
  }, [navigate, search.returnTo, search.tripId, search.day]);

  const handleToggleSave = async () => {
    if (!place) return;
    setBusy(true);
    try {
      const { saved: didSave } = await toggleSavePlace(
        buildNewSavedPlaceInput({
          name: place.name,
          category: place.primaryType,
          primaryType: place.primaryType,
          types: place.types ?? undefined,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          notes: place.reason,
          placeId: place.id,
          googlePlaceId: place.id,
          photoName: place.photoName,
          rating: place.rating,
          userRatingCount: place.userRatingCount,
          coverImageUrl: imageUrls[0] ?? null,
        }),
      );
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
        ? distanceMeters(navigationOrigin, { lat: place.lat, lng: place.lng })
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
    if (loading) {
      return (
        <div className="place-detail-route flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain">
          <ExploreSubpageHeader title={t("map.placeDetail")} onBack={handleBack} />
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-7 w-7 animate-spin text-clay" aria-hidden />
            <p className="text-sm text-muted-foreground">載入地點資訊…</p>
          </div>
        </div>
      );
    }
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
    <div className="place-detail-route flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain">
      <ExploreSubpageHeader title={t("map.placeDetail")} onBack={handleBack} />

      {fetchError && usedFallback && !place.address && place.lat == null ? (
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
          ) : refreshing ? (
            <p className="mx-5 mb-1 text-xs text-muted-foreground/80">正在更新最新資訊…</p>
          ) : null}
          <PlaceDetailSheet
            place={placeForSheet ?? place}
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
            tabelogExternalUrl={placeTabelogUrl}
            ticketOffers={placeTicketOffers}
          />
        </>
      )}
    </div>
  );
}
