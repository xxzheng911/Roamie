import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MapErrorBoundary } from "@/components/MapErrorBoundary";
import {
  MapExploreSheetSafe,
  type MapExploreSheetHandle,
} from "@/components/MapExploreSheetSafe";
import { focusPlaceInVisibleMapArea } from "@/lib/map-focus-place";
import { PlaceDetailSheet, ExploreSubpageHeader } from "@/components/map/PlaceDetailSheet";
import {
  NavigationPreviewSheet,
  NavigationPreviewSheetHeader,
} from "@/components/map/NavigationPreviewSheet";
import { GoogleMapBackground } from "@/components/map/GoogleMapBackground";
import { MapExploreMapSkeleton } from "@/components/map/MapExploreMapSkeleton";
import { MapExploreMapStatusBanner } from "@/components/map/MapExploreMapStatusBanner";
import {
  MapExplorePlaceCards,
  type MapExploreCardsHandle,
} from "@/components/map/MapExplorePlaceCards";
import { MapExploreCategoryChips } from "@/components/map/MapExploreCategoryChips";
import { MapSearchBarOverlay } from "@/components/map/MapSearchBarOverlay";
import { listPlaces, toggleSavePlace, type SavedPlace } from "@/lib/places-storage";
import { searchPlaces } from "@/lib/places.functions";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import type { PlaceResult } from "@/lib/place-result";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { isRoutableGooglePlaceId } from "@/lib/place-detail-handoff";
import { getWeather } from "@/lib/weather.functions";
import { getPlaceIntro } from "@/lib/recommendation.functions";
import type { WeatherSummary } from "@/lib/weather-types";
import {
  generatePlaceReason,
  userProfileForReasonFrom,
  type UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import { usePlaceNavigation } from "@/hooks/use-place-navigation";
import { isMapDetailOpen, type MapExploreSheetMode } from "@/lib/map-explore-sheet-mode";
import { mapPlaceResultToChatItem, addSelectedPlace, saveChatSession, loadChatSession } from "@/lib/chat-session";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { useAvatar } from "@/hooks/use-avatar";
import { buildExploreQuery, distanceMeters, formatDistanceLabel, savedPlacesNear } from "@/lib/map-explore";
import { sortExplorePlaces } from "@/lib/sort-explore-places";
import { filterExplorePlaces, isTravelFriendlyPlace } from "@/lib/filter-explore-places";
import {
  filterByExploreCategory,
  getExploreCategoryDisplayLabel,
  getExploreCategoryEmptyMessage,
  matchesCategory,
} from "@/lib/place-category";
import { getMockMapPlaces, getMockPlacesForCategory } from "@/lib/map-mock-places";
import { searchRadiusMeters } from "@/lib/search-radius";
import {
  isGooglePlacesQuotaError,
  logPlacesFallbackUsed,
  shouldSkipPlacesClientRetry,
  isGoogleBillingDisabledError,
  shouldUseCuratedPlacesFallback,
} from "@/lib/places-api-errors";
import { rememberLastSearchLocation } from "@/lib/last-search-location";
import { withSearchTimeout } from "@/lib/search-timeout";
import {
  COFFEE_MIN_FILTERED_RESULTS,
  DISTRICT_MIN_FILTERED_RESULTS,
  getExploreTextFallbackQueries,
  DEFAULT_SEARCH_RADIUS_M,
  EXPLORE_CATEGORIES,
  type ExploreCategory,
} from "@/lib/places-search-config";
import { TAIPEI_CENTER } from "@/lib/geo";
import {
  readBootstrapDeviceLocation,
  requestDeviceLocation,
  watchDeviceLocation,
} from "@/lib/device-location";
import { resolveUserMarkerAvatarSrc } from "@/lib/map-user-location-marker";
import {
  logExploreMapBoot,
  logMapComponentKeyDiagnostics,
  logMapFallback,
} from "@/lib/map-boot-log";
import {
  googleMapsFailureUserMessage,
  installGoogleMapsWindowErrorListener,
  logMapRuntimeDiagnostics,
} from "@/lib/maps-runtime-diagnostics";
import { useI18n } from "@/hooks/use-i18n";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { type MapExploreHandoff, consumeMapExploreHandoff } from "@/lib/map-explore-handoff";
import {
  buildMapPlacesCacheKey,
  readMapPlacesCache,
  writeMapPlacesCache,
} from "@/lib/map-places-cache";
import {
  locationMovedEnough,
  weatherCacheKey,
} from "@/lib/map-location-throttle";

export const Route = createFileRoute("/_app/map")({
  component: MapPage,
});

function MapPage() {
  useEffect(() => {
    logExploreMapBoot();
    return () => {
      console.info("[EXPLORE_SCREEN] unmounted");
    };
  }, []);

  return (
    <MapErrorBoundary>
      <MapView />
    </MapErrorBoundary>
  );
}

const MAP_ZOOM_EXPLORE = 15;
const MAP_ZOOM_PLACE = 17;

function readInitialMapCoords(): { lat: number; lng: number } {
  if (typeof window === "undefined") return TAIPEI_CENTER;
  const boot = readBootstrapDeviceLocation();
  return { lat: boot.lat, lng: boot.lng };
}

type MapPlaceCard = PlaceResult & {
  reason: string;
  googleMapsUrl?: string;
  isSavedFavorite?: boolean;
  displayCategory?: string;
  coverImageUrl?: string;
};

function mockMapCards(center: { lat: number; lng: number }, cat: ExploreCategory): MapPlaceCard[] {
  const pool = cat.id === "all" ? getMockMapPlaces(center) : getMockPlacesForCategory(center, cat);
  return pool.map((p) => ({ ...p, googleMapsUrl: undefined }));
}

function savedToPlaceResult(s: SavedPlace): PlaceResult {
  return {
    id: `saved-${s.id}`,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: s.category,
    types: s.category ? [s.category] : null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "營業時間待確認",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

function sortMapCards(
  cards: MapPlaceCard[],
  origin: { lat: number; lng: number },
  profile: UserProfileForReason | null,
): MapPlaceCard[] {
  return sortExplorePlaces(cards, origin, profile);
}

function mergePlacesById(base: PlaceResult[], extra: PlaceResult[]): PlaceResult[] {
  const seen = new Set(base.map((p) => p.id));
  const merged = [...base];
  for (const p of extra) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  return merged;
}

function MapView() {
  useIosInteractiveRoute("map-explore");
  const { t, locale } = useI18n();
  const tt = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const { openAddToTrip } = useAddToTrip();
  const [cat, setCat] = useState<ExploreCategory>(EXPLORE_CATEGORIES[0]);
  const navSig = useRouterState({ select: (s) => JSON.stringify(s.location) });

  useEffect(() => {
    console.info("[EXPLORE_SCREEN] mapView mounted");
    logMapComponentKeyDiagnostics("MAP_COMPONENT");
    logMapRuntimeDiagnostics();
    document.documentElement.classList.add("map-route-active");
    return () => {
      document.documentElement.classList.remove("map-route-active");
      console.info("[EXPLORE_SCREEN] mapView unmounted");
    };
  }, []);

  const lastSearchCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastWeatherFetchCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const searchRequestIdRef = useRef(0);
  const prevQueryRef = useRef("");
  const prevCatIdRef = useRef(cat.id);
  const pendingImmediateSearchRef = useRef(false);
  const [searchTrigger, setSearchTrigger] = useState(0);

  const navigate = useNavigate();
  const { avatarSrc: rawAvatarSrc } = useAvatar();
  const safeAvatarSrc = useMemo(
    () => resolveUserMarkerAvatarSrc(rawAvatarSrc),
    [rawAvatarSrc],
  );
  const searchPlacesServerFn = useServerFn(searchPlaces);
  const searchPlacesFn = useMemo(
    () => createUnifiedSearchPlacesFn(searchPlacesServerFn),
    [searchPlacesServerFn],
  );
  const fetchWeather = useServerFn(getWeather);
  const fetchPlaceIntroFn = useServerFn(getPlaceIntro);
  const [placeIntroExtra, setPlaceIntroExtra] = useState<{
    intro?: string;
    suitableFor?: string;
    weatherFit?: string;
    goNowAdvice?: string;
    introLoading?: boolean;
  }>({});
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [query, setQuery] = useState("");
  const [locationLabel, setLocationLabel] = useState("附近");
  const [results, setResults] = useState<MapPlaceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<MapExploreSheetMode>("list");
  const [selectedPlace, setSelectedPlace] = useState<MapPlaceCard | null>(null);
  const [selectedPlaceIndex, setSelectedPlaceIndex] = useState<number | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const savedRef = useRef<SavedPlace[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState(readInitialMapCoords);
  const [mapCenter, setMapCenter] = useState(readInitialMapCoords);
  const [mapZoom, setMapZoom] = useState(MAP_ZOOM_EXPLORE);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const sheetRef = useRef<MapExploreSheetHandle>(null);
  const cardsRef = useRef<MapExploreCardsHandle>(null);
  const [geoReady, setGeoReady] = useState(() => typeof window !== "undefined");
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const mapErrorToastedRef = useRef(false);
  const mapLoadAttemptedRef = useRef(false);
  const mapAutoRetryRef = useRef(0);
  const mapAutoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAP_AUTO_RETRY_MAX = 3;
  /** 一律先嘗試掛載 GoogleMap，失敗後才 fallback（確保 [MAP_LOAD] log 會執行） */
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapFallbackBilling, setMapFallbackBilling] = useState(false);
  const [mapRemountKey, setMapRemountKey] = useState(0);
  const [mapRetrying, setMapRetrying] = useState(false);

  const showGoogleMap = geoReady && !mapUnavailable;
  useEffect(() => {
    console.info("[EXPLORE_SCREEN] render map=", showGoogleMap);
    if (!showGoogleMap && geoReady) {
      logMapFallback(mapUnavailable ? "map_unavailable" : "geo_not_ready");
    }
  }, [showGoogleMap, geoReady, mapUnavailable]);
  const [reasonProfile, setReasonProfile] = useState<UserProfileForReason | null>(null);
  const exploreHandoffRef = useRef<MapExploreHandoff | null>(null);

  const applyDeviceLocation = useCallback(
    (loc: Awaited<ReturnType<typeof requestDeviceLocation>>) => {
      const next = { lat: loc.lat, lng: loc.lng };
      setUserLocation(next);
      setMapCenter(next);
      setLocationHint(loc.usedFallback ? t("map.locationFallbackHint") : null);
      setLocationLabel(t("common.nearby"));
      setGeoReady(true);
      console.info("[MAP_LOCATION] using store lat/lng", {
        lat: loc.lat,
        lng: loc.lng,
        usedFallback: loc.usedFallback,
        source: loc.source,
        permission: loc.permission,
      });
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo(next);
      }
      fetchWeather({ data: { lat: loc.lat, lng: loc.lng } })
        .then((r) => {
          if (r.weather?.city?.trim()) {
            const city = r.weather.city.trim();
            setLocationLabel(city);
            rememberLastSearchLocation({ lat: loc.lat, lng: loc.lng, city });
          }
        })
        .catch(() => {});
    },
    [fetchWeather, t],
  );

  useEffect(() => {
    const boot = readBootstrapDeviceLocation();
    console.info("[MAP_LOCATION] using store lat/lng", {
      phase: "bootstrap",
      lat: boot.lat,
      lng: boot.lng,
      permission: boot.permission,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loc = await requestDeviceLocation();
      if (cancelled) return;
      applyDeviceLocation(loc);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyDeviceLocation]);

  useEffect(() => {
    const stopWatch = watchDeviceLocation((loc) => {
      if (loc.usedFallback) return;
      setLocationHint(null);
      const next = { lat: loc.lat, lng: loc.lng };
      setUserLocation(next);
      setMapCenter(next);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo(next);
      }
      console.info("[MAP_LOCATION] using store lat/lng", {
        phase: "watch",
        lat: loc.lat,
        lng: loc.lng,
      });
    });
    return stopWatch;
  }, []);

  const handleMapLoadError = useCallback(
    (message: string, reason = "load_error") => {
      if (!mapLoadAttemptedRef.current && reason === "window_error") return;

      const billingLikely =
        isGoogleBillingDisabledError(message) ||
        /For development purposes only|ApiNotActivated|InvalidKeyMapError/i.test(message);

      if (mapAutoRetryRef.current < MAP_AUTO_RETRY_MAX && !billingLikely) {
        mapAutoRetryRef.current += 1;
        const attempt = mapAutoRetryRef.current;
        const delayMs = 700 * attempt;
        console.info("[MAP_LOAD] auto retry", attempt, "in", delayMs, "ms reason=", reason);
        setMapRetrying(true);
        if (mapAutoRetryTimerRef.current) clearTimeout(mapAutoRetryTimerRef.current);
        mapAutoRetryTimerRef.current = setTimeout(() => {
          mapErrorToastedRef.current = false;
          if (typeof window !== "undefined") {
            window.__roamieMapsAuthFailure = undefined;
          }
          setMapFallbackBilling(false);
          setMapUnavailable(false);
          setMapRemountKey((k) => k + 1);
        }, delayMs);
        return;
      }

      setMapRetrying(false);
      setMapUnavailable(true);
      setMapFallbackBilling(billingLikely);
      logMapFallback(reason);
      mapInstanceRef.current = null;
      if (!mapErrorToastedRef.current) {
        mapErrorToastedRef.current = true;
        console.warn("[MAP_LOAD] error=", message);
        console.info("[MAP_FALLBACK] reason=", reason);
        toast.message(t("map.mapBannerToast"), {
          description: t("map.mapBannerToastDesc"),
        });
      }
    },
    [],
  );

  useEffect(() => {
    return installGoogleMapsWindowErrorListener((msg) => {
      handleMapLoadError(msg, "window_error");
    });
  }, [handleMapLoadError]);

  const retryMapLoad = useCallback(() => {
    mapAutoRetryRef.current = 0;
    setMapRetrying(true);
    if (mapAutoRetryTimerRef.current) {
      clearTimeout(mapAutoRetryTimerRef.current);
      mapAutoRetryTimerRef.current = null;
    }
    mapErrorToastedRef.current = false;
    if (typeof window !== "undefined") {
      window.__roamieMapsAuthFailure = undefined;
    }
    setMapFallbackBilling(false);
    setMapUnavailable(false);
    setMapRemountKey((k) => k + 1);
    console.info("[MAP_LOAD] retry");
  }, []);

  useEffect(() => {
    return () => {
      if (mapAutoRetryTimerRef.current) clearTimeout(mapAutoRetryTimerRef.current);
    };
  }, []);

  const refreshSaved = () => {
    listPlaces()
      .then((list) => {
        savedRef.current = list;
        setSaved(list);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refreshSaved();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadReasonProfile = async () => {
      try {
        const [profile, prefs] = await Promise.all([
          getUserProfile().catch(() => null),
          getPreferences(),
        ]);
        if (cancelled) return;
        setReasonProfile(
          userProfileForReasonFrom(profile?.prefs ?? prefs, {
            travelStyle: profile?.travelStyle,
            personalityType: profile?.personalityType,
            personalitySummary: profile?.personalitySummary,
            aiPreferences: profile?.aiPreferences,
          }),
        );
      } catch {
        if (!cancelled) {
          getPreferences()
            .then((prefs) => setReasonProfile(userProfileForReasonFrom(prefs)))
            .catch(() => {});
        }
      }
    };
    void loadReasonProfile();
    const onPrefs = () => {
      void loadReasonProfile();
    };
    window.addEventListener(PREFS_UPDATED_EVENT, onPrefs);
    return () => {
      cancelled = true;
      window.removeEventListener(PREFS_UPDATED_EVENT, onPrefs);
    };
  }, []);

  useEffect(() => {
    if (!geoReady) return;
    if (!locationMovedEnough(lastWeatherFetchCenterRef.current, userLocation, 250)) return;
    lastWeatherFetchCenterRef.current = { ...userLocation };
    fetchWeather({ data: { lat: userLocation.lat, lng: userLocation.lng } })
      .then((r) => setWeather(r.weather))
      .catch(() => {});
  }, [geoReady, userLocation.lat, userLocation.lng, fetchWeather]);

  useEffect(() => {
    if (!geoReady) return;

    const center = { lat: userLocation.lat, lng: userLocation.lng };
    const queryDirty = prevQueryRef.current !== query;
    const catDirty = prevCatIdRef.current !== cat.id;
    prevQueryRef.current = query;
    prevCatIdRef.current = cat.id;

    const moved = locationMovedEnough(lastSearchCenterRef.current, center);
    if (!moved && !queryDirty && !catDirty && lastSearchCenterRef.current) {
      return;
    }

    const isFreeText = !!query.trim();
    const debounceMs = pendingImmediateSearchRef.current ? 0 : isFreeText ? 450 : 0;
    pendingImmediateSearchRef.current = false;
    const handle = setTimeout(() => {
      lastSearchCenterRef.current = { ...center };
      const requestId = ++searchRequestIdRef.current;
      const text = query.trim() || cat.query;
      setLoading(true);
      setError(null);
      const searchQuery = isFreeText
        ? text
        : buildExploreQuery(text, {
            weather,
            timeIso: new Date().toISOString(),
            userLocation: center,
            userLocale: locale,
          });
      const filterCat = isFreeText ? EXPLORE_CATEGORIES[0] : cat;
      const cacheKey = buildMapPlacesCacheKey({
        lat: center.lat,
        lng: center.lng,
        query: isFreeText ? text : cat.query,
        categoryId: isFreeText ? "search" : cat.id,
        locale,
      });

      const runSearch = async () => {
        const basePayload = {
          lat: center.lat,
          lng: center.lng,
          radius: searchRadiusMeters(),
        };

        const cached = readMapPlacesCache(cacheKey);
        let apiPlaces = cached?.places ?? [];
        let apiError = cached?.error ?? null;

        if (!cached) {
          const primary = await withSearchTimeout(
            searchPlacesFn({
              data: {
                ...basePayload,
                query: isFreeText ? searchQuery : cat.query,
                mode: (isFreeText ? "text" : cat.mode) as "text" | "nearby" | "multi",
                includedTypes: isFreeText ? undefined : cat.includedTypes,
                nearbyGroups: isFreeText ? undefined : cat.nearbyGroups,
                locale,
              },
            }),
          );

          apiPlaces = Array.isArray(primary.places) ? primary.places : [];
          apiError = primary.error;
          writeMapPlacesCache(cacheKey, apiPlaces, apiError);
        }

        if (requestId !== searchRequestIdRef.current) return;
        const applyFilters = (list: PlaceResult[]) =>
          filterByExploreCategory(filterExplorePlaces(list), filterCat);

        let filtered = applyFilters(apiPlaces);

        const quotaExhausted = isGooglePlacesQuotaError(apiError);
        const skipExtraPlacesApi = Boolean(apiError && shouldSkipPlacesClientRetry(apiError));

        if (
          !skipExtraPlacesApi &&
          !quotaExhausted &&
          !isFreeText &&
          cat.id === "coffee" &&
          filtered.length < COFFEE_MIN_FILTERED_RESULTS
        ) {
          for (const textQuery of getExploreTextFallbackQueries("coffee", center)) {
            const fallback = await withSearchTimeout(
              searchPlacesFn({
                data: {
                  ...basePayload,
                  query: textQuery,
                  mode: "text",
                  locale,
                },
              }),
            );
            if (fallback.error && !apiError) apiError = fallback.error;
            if (fallback.places.length > 0) {
              apiPlaces = mergePlacesById(apiPlaces, fallback.places);
              filtered = applyFilters(apiPlaces);
              if (filtered.length >= COFFEE_MIN_FILTERED_RESULTS) break;
            }
          }
        }

        if (
          !skipExtraPlacesApi &&
          !quotaExhausted &&
          !isFreeText &&
          cat.id === "district" &&
          filtered.length < DISTRICT_MIN_FILTERED_RESULTS
        ) {
          for (const textQuery of getExploreTextFallbackQueries("district", center)) {
            const fallback = await withSearchTimeout(
              searchPlacesFn({
                data: {
                  ...basePayload,
                  query: textQuery,
                  mode: "text",
                  locale,
                },
              }),
            );
            if (fallback.error && !apiError) apiError = fallback.error;
            if (fallback.places.length > 0) {
              apiPlaces = mergePlacesById(apiPlaces, fallback.places);
              filtered = applyFilters(apiPlaces);
              if (filtered.length >= DISTRICT_MIN_FILTERED_RESULTS) break;
            }
          }
        }

        if (apiError) {
          console.info("[PLACES_API] error=", apiError);
        }

        const nearbySaved = savedPlacesNear(center, savedRef.current, 5000);
        const apiNames = new Set(apiPlaces.map((p) => p.name));
        const savedCards: MapPlaceCard[] = nearbySaved
          .filter((s) => !apiNames.has(s.name))
          .filter((s) =>
            matchesCategory(
              { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
              filterCat,
            ),
          )
          .map((s) => {
            const base = savedToPlaceResult(s);
            const card = buildUnifiedPlaceCard({
              place: base,
              categoryId: filterCat.id,
              isSavedFavorite: true,
              userLocation: center,
              weather,
              userProfile: reasonProfile,
              locale,
            });
            const item = mapPlaceResultToChatItem(base, {
              weather,
              userProfile: reasonProfile,
              locale,
            });
            return {
              ...card,
              googleMapsUrl: item.googleMapsUrl,
            };
          });

        let enriched: MapPlaceCard[] = [
          ...savedCards,
          ...filtered.map((p) => {
            const card = buildUnifiedPlaceCard({
              place: p,
              categoryId: filterCat.id,
              userLocation: center,
              weather,
              userProfile: reasonProfile,
              locale,
            });
            const item = mapPlaceResultToChatItem(p, {
              weather,
              userProfile: reasonProfile,
              locale,
            });
            return { ...card, googleMapsUrl: item.googleMapsUrl };
          }),
        ];

        if (enriched.length === 0) {
          if (isFreeText) {
            setError(getExploreCategoryEmptyMessage(cat.id, locale));
          } else if (shouldUseCuratedPlacesFallback(apiError)) {
            logPlacesFallbackUsed(`map-explore:${cat.id}`);
            enriched = mockMapCards(center, cat);
            setError(null);
          } else {
            setError(getExploreCategoryEmptyMessage(cat.id, locale));
            console.info("[explore] map places empty", { category: cat.id, apiError });
          }
        }

        if (requestId !== searchRequestIdRef.current) return;
        setResults(sortMapCards(enriched, center, reasonProfile));
        if (sheetMode === "list") {
          setSelectedPlace(null);
          setSelectedPlaceIndex(null);
        }
      };

      void runSearch().catch((e) => {
          const msg = e instanceof Error ? e.message : t("map.searchFailed");
          if (query.trim()) {
            setError(t("map.searchBusy"));
            setResults([]);
          } else if (shouldUseCuratedPlacesFallback(msg)) {
            logPlacesFallbackUsed("map-search-catch");
            setError(null);
            setResults(mockMapCards(center, cat));
          } else {
            setError(t("map.searchBusy"));
            setResults([]);
          }
          if (sheetMode === "list") {
            setSelectedPlace(null);
            setSelectedPlaceIndex(null);
          }
        })
        .finally(() => {
          if (searchRequestIdRef.current === requestId) setLoading(false);
        });
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [
    query,
    cat.id,
    cat.query,
    cat.mode,
    searchPlacesFn,
    geoReady,
    userLocation.lat,
    userLocation.lng,
    weatherCacheKey(weather),
    locale,
    searchTrigger,
    t,
  ]);

  const displayResults = useMemo(() => {
    if (loading && !query.trim()) return [];
    const filterCat = query.trim() ? EXPLORE_CATEGORIES[0] : cat;
    const base =
      results.length > 0
        ? results
        : !loading && !query.trim() && shouldUseCuratedPlacesFallback(error)
          ? mockMapCards(userLocation, cat)
          : [];
    const filtered = filterByExploreCategory(filterExplorePlaces(base), filterCat);
    return sortMapCards(filtered, userLocation, reasonProfile);
  }, [results, cat, loading, query, userLocation, reasonProfile]);

  const handleCategorySelect = useCallback(
    (c: ExploreCategory) => {
      if (c.id === cat.id) return;
      setCat(c);
      setMapCenter(userLocation);
      setSheetMode("list");
      setSelectedPlace(null);
      setSelectedPlaceIndex(null);
      setMapZoom(MAP_ZOOM_EXPLORE);
      setMapCenter(userLocation);
      setError(null);
      if (!query.trim()) {
        setLoading(true);
        setResults([]);
      }
    },
    [cat.id, query, userLocation],
  );

  const placeMarkers = useMemo(
    () =>
      displayResults
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          lat: p.lat!,
          lng: p.lng!,
          title: p.name,
          selected: selectedPlace?.id === p.id,
        })),
    [displayResults, selectedPlace?.id],
  );

  const selectedDestination =
    selectedPlace?.lat != null && selectedPlace?.lng != null
      ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
      : null;

  const navigation = usePlaceNavigation({
    origin: userLocation,
    destination: selectedDestination,
    weather,
    profile: reasonProfile,
    enabled: !!selectedPlace && isMapDetailOpen(sheetMode),
  });

  const userLocationPin = useMemo(() => {
    if (!geoReady) return null;
    return {
      lat: userLocation.lat,
      lng: userLocation.lng,
      avatarSrc: safeAvatarSrc,
    };
  }, [geoReady, userLocation.lat, userLocation.lng, safeAvatarSrc]);

  const savedByName = useMemo(() => new Map(saved.map((s) => [s.name, s])), [saved]);

  const refocusSelectedPlace = useCallback(
    (lat: number, lng: number) => {
      const pos = { lat, lng };
      setMapCenter(pos);
      setMapZoom(MAP_ZOOM_PLACE);
      const run = () => {
        const map = mapInstanceRef.current;
        if (!map) return;
        const sheet = document.querySelector<HTMLElement>("[data-map-explore-sheet]");
        focusPlaceInVisibleMapArea(map, pos, MAP_ZOOM_PLACE, sheet);
      };
      requestAnimationFrame(() => requestAnimationFrame(run));
    },
    [],
  );

  const focusMapOnPlace = useCallback(
    (lat: number, lng: number) => {
      refocusSelectedPlace(lat, lng);
    },
    [refocusSelectedPlace],
  );

  useEffect(() => {
    if (selectedPlace?.lat == null || selectedPlace.lng == null) return;
    const sheet = document.querySelector("[data-map-explore-sheet]");
    if (!sheet) return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        refocusSelectedPlace(selectedPlace.lat!, selectedPlace.lng!);
      }, 100);
    });
    ro.observe(sheet);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [selectedPlace?.id, selectedPlace?.lat, selectedPlace?.lng, refocusSelectedPlace]);

  // 地圖頁在 tab 切換時可能不會 unmount；改為每次 navigation 都重新 consume handoff。
  useEffect(() => {
    const handoff = consumeMapExploreHandoff();
    if (handoff) exploreHandoffRef.current = handoff;
  }, [navSig]);

  const handleMapClick = useCallback(() => {
    if (sheetMode === "detail" || sheetMode === "navigation") {
      sheetRef.current?.collapse("peek");
    } else {
      sheetRef.current?.collapse("min");
    }
    if (selectedPlace?.lat != null && selectedPlace.lng != null) {
      refocusSelectedPlace(selectedPlace.lat, selectedPlace.lng);
    }
  }, [sheetMode, selectedPlace, refocusSelectedPlace]);

  useEffect(() => {
    if (sheetMode !== "detail" || !selectedPlace?.id || selectedPlace.id.startsWith("saved-")) {
      setPlaceIntroExtra({});
      return;
    }
    let cancelled = false;
    setPlaceIntroExtra({ introLoading: true });
    void fetchPlaceIntroFn({
      data: {
        placeId: selectedPlace.id,
        reason: selectedPlace.reason,
        locale,
      },
    })
      .then(({ intro, error }) => {
        if (cancelled) return;
        if (!intro) {
          setPlaceIntroExtra({});
          if (error) console.warn("[Roamie Map] place intro failed", error);
          return;
        }
        setPlaceIntroExtra({
          intro: intro.intro,
          suitableFor: intro.suitableFor,
          weatherFit: intro.weatherFit,
          goNowAdvice: intro.goNowAdvice,
          introLoading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setPlaceIntroExtra({});
      });
    return () => {
      cancelled = true;
    };
  }, [sheetMode, selectedPlace?.id, selectedPlace?.reason, locale, fetchPlaceIntroFn]);

  const handlePlaceSelect = useCallback(
    (index: number) => {
      const place = displayResults[index];
      if (!place) return;

      if (place.lat == null || place.lng == null) {
        toast.message(t("map.noCoordsDetail"));
        return;
      }

      const distM = distanceMeters(userLocation, { lat: place.lat, lng: place.lng });
      const reason =
        place.reason?.trim() ||
        generatePlaceReason(place, reasonProfile, {
          weather,
          locale,
          context: {
            categoryLabel: place.displayCategory,
            distanceMeters: distM,
          },
        });

      setSelectedPlace({ ...place, reason });
      setSelectedPlaceIndex(index);
      setSheetMode("detail");
      sheetRef.current?.expand();
      focusMapOnPlace(place.lat, place.lng);
    },
    [displayResults, userLocation, reasonProfile, weather, focusMapOnPlace, locale, t],
  );

  const openHandoffSnapshot = useCallback(
    (snapshot: MapPlaceCard) => {
      if (snapshot.lat == null || snapshot.lng == null) {
        toast.message(t("map.noCoordsDetail"));
        return;
      }
      setSelectedPlace(snapshot);
      setSelectedPlaceIndex(null);
      setSheetMode("detail");
      sheetRef.current?.expand();
      focusMapOnPlace(snapshot.lat, snapshot.lng);
    },
    [focusMapOnPlace, t],
  );

  useEffect(() => {
    const handoff = exploreHandoffRef.current;
    if (!handoff || !geoReady) return;

    if (cat.id !== handoff.categoryId) {
      const next = EXPLORE_CATEGORIES.find((c) => c.id === handoff.categoryId);
      if (next) setCat(next);
      return;
    }

    if (handoff.placeSnapshot) {
      exploreHandoffRef.current = null;
      openHandoffSnapshot(handoff.placeSnapshot);
      return;
    }

    if (loading) return;
    const idx = displayResults.findIndex((p) => p.id === handoff.placeId);
    if (idx >= 0) {
      exploreHandoffRef.current = null;
      handlePlaceSelect(idx);
    }
  }, [geoReady, loading, cat.id, displayResults, handlePlaceSelect, openHandoffSnapshot]);

  const handleBackToList = useCallback(() => {
    const scrollIdx = selectedPlaceIndex;
    setSheetMode("list");
    sheetRef.current?.expand();
    if (scrollIdx != null) {
      requestAnimationFrame(() => {
        cardsRef.current?.scrollToIndex(scrollIdx);
      });
    }
    if (selectedPlace?.lat != null && selectedPlace.lng != null) {
      refocusSelectedPlace(selectedPlace.lat, selectedPlace.lng);
    }
  }, [selectedPlaceIndex, selectedPlace, refocusSelectedPlace]);

  const handleNavigateFromDetail = useCallback(() => {
    if (!selectedPlace?.lat || !selectedPlace?.lng) {
      toast.message(t("map.noCoordsRoute"));
      return;
    }
    navigation.startNavigation();
  }, [selectedPlace, navigation]);

  const handleBackToDetail = useCallback(() => {
    setSheetMode("detail");
  }, []);

  const openInChat = (p: MapPlaceCard) => {
    const distM =
      p.lat != null && p.lng != null
        ? distanceMeters(userLocation, { lat: p.lat, lng: p.lng })
        : undefined;
    const item = mapPlaceResultToChatItem(p, {
      weather,
      userProfile: reasonProfile,
      categoryLabel: getExploreCategoryDisplayLabel(p),
      distanceMeters: distM,
      locale,
    });
    const base = loadChatSession();
    saveChatSession(addSelectedPlace({ ...base, phase: "followup" }, item));
    navigate({ to: "/chat", search: { from: "map" } });
    toast.message(tt("map.chatAboutPlace", { name: p.name }));
  };

  const handleToggleSave = async (p: MapPlaceCard) => {
    setBusy(p.id);
    try {
      const nearbyLabel = t("common.nearby");
      const { saved: didSave } = await toggleSavePlace({
        name: p.name,
        category: p.primaryType,
        address: p.address,
        city: locationLabel === nearbyLabel ? null : locationLabel,
        lat: p.lat,
        lng: p.lng,
        notes: p.reason,
        mood_tag: null,
        cover_image: p.photoName ? (buildPlacePhotoUrl(p.photoName, 600) ?? null) : null,
        metadata: isRoutableGooglePlaceId(p.id) ? { placeId: p.id } : {},
      });
      toast.success(didSave ? t("map.saved") : t("map.unsaved"));
      refreshSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("map.actionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const locateMe = () => {
    setLocating(true);
    void requestDeviceLocation()
      .then((loc) => {
        console.info("[explore] relocate", {
          lat: loc.lat,
          lng: loc.lng,
          usedFallback: loc.usedFallback,
        });
        applyDeviceLocation(loc);
        lastSearchCenterRef.current = null;
        lastWeatherFetchCenterRef.current = null;
        setMapZoom(MAP_ZOOM_EXPLORE);
        setSheetMode("list");
        setSelectedPlace(null);
        setSelectedPlaceIndex(null);
        if (loc.usedFallback) {
          toast.message(t("map.locationFallbackHint"));
        } else {
          toast.success(t("map.located"));
        }
      })
      .finally(() => setLocating(false));
  };

  const savedNames = useMemo(() => new Set(saved.map((s) => s.name)), [saved]);

  const onMarkerClick = useCallback(
    (markerIdx: number) => {
      const withCoords = displayResults.filter((p) => p.lat != null && p.lng != null);
      const p = withCoords[markerIdx];
      if (!p) return;
      handlePlaceSelect(displayResults.indexOf(p));
    },
    [displayResults, handlePlaceSelect],
  );

  return (
    <div className="map-page relative -mt-[var(--safe-area-top)] h-[calc(100%+var(--safe-area-top))] min-h-0 w-full overflow-hidden bg-cream">
      {/* 地圖層：全屏背景，GoogleMap 僅在此 render 一次 */}
      <div className="map-stage absolute inset-0 z-0 overflow-hidden">
        {(!showGoogleMap || mapRetrying) && (
          <MapExploreMapSkeleton
            variant={mapRetrying ? "retrying" : geoReady ? "idle" : "loading"}
          />
        )}
        {showGoogleMap ? (
          <GoogleMapBackground
            key={mapRemountKey}
            center={mapCenter}
            zoom={mapZoom}
            placeMarkers={placeMarkers}
            userLocation={userLocationPin}
            onPlaceMarkerClick={onMarkerClick}
            onMapAttempt={() => {
              mapLoadAttemptedRef.current = true;
            }}
            onLoadError={handleMapLoadError}
            onMapClick={handleMapClick}
            onMapReady={(map) => {
              mapLoadAttemptedRef.current = true;
              mapAutoRetryRef.current = 0;
              setMapRetrying(false);
              if (mapAutoRetryTimerRef.current) {
                clearTimeout(mapAutoRetryTimerRef.current);
                mapAutoRetryTimerRef.current = null;
              }
              mapInstanceRef.current = map;
              setMapUnavailable(false);
              console.info("[MAP_LOAD] success");
              logMapFallback("none");
              const auth = window.__roamieMapsAuthFailure;
              if (auth?.message) {
                logMapFallback("gm_auth_on_ready");
                handleMapLoadError(auth.message, "gm_auth_on_ready");
              }
            }}
          />
        ) : null}
        {geoReady && mapUnavailable ? (
          <MapExploreMapStatusBanner
            message={t("map.mapBannerTitle")}
            detail={
              mapFallbackBilling
                ? t("map.billingFallbackSubtitle")
                : t("map.mapBannerSubtitle")
            }
            onRetry={retryMapLoad}
            retryLabel={t("map.mapRetry")}
            retrying={mapRetrying}
          />
        ) : null}

        <div className="pointer-events-none absolute inset-0 z-10">
          <MapSearchBarOverlay
            query={query}
            onQueryChange={setQuery}
            onSubmit={() => {
              if (!query.trim()) return;
              pendingImmediateSearchRef.current = true;
              lastSearchCenterRef.current = null;
              prevQueryRef.current = "";
              setSearchTrigger((n) => n + 1);
            }}
            onLocate={locateMe}
            locating={locating}
            placeholder={t("map.searchPlaceholder")}
          />
        </div>

        {isMapDetailOpen(sheetMode) && (
          <div
            className="pointer-events-none absolute inset-0 z-[5] bg-ink/25 transition-opacity duration-300"
            aria-hidden
          />
        )}
      </div>

      {/* Sheet：疊在地圖上方，不透明 cream、z-index 高於 map canvas */}
      <div className="map-sheet-layer pointer-events-none absolute inset-x-0 bottom-0 z-40">
      <MapExploreSheetSafe
        ref={sheetRef}
        sheetMode={sheetMode}
        header={
          sheetMode === "navigation" && selectedPlace ? (
            <NavigationPreviewSheetHeader onBack={handleBackToDetail} />
          ) : sheetMode === "detail" && selectedPlace ? (
            <ExploreSubpageHeader title={t("map.placeDetail")} onBack={handleBackToList} />
          ) : (
            <>
              <div className="px-5 pb-2">
                <p className="font-display text-lg leading-tight">推薦地點</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {locationLabel} ·{" "}
                  {loading
                    ? t("common.search")
                    : tt("map.placesCount", { count: displayResults.length })}
                  {cat.id ? ` · ${t(`explore.category.${cat.id}`)}` : ""}
                  {saved.length > 0 ? ` · 已收藏 ${saved.length}` : ""}
                </p>
                {locationHint && (
                  <p className="mt-1 text-xs text-muted-foreground/90">{locationHint}</p>
                )}
              </div>

              <MapExploreCategoryChips selected={cat} onSelect={handleCategorySelect} />

              {error && (
                <p className="mx-5 mb-2 rounded-2xl bg-clay/15 px-3 py-2 text-xs text-clay">{error}</p>
              )}
            </>
          )
        }
      >
        <>
          <div className={sheetMode !== "list" ? "hidden" : undefined} aria-hidden={sheetMode !== "list"}>
            <MapExplorePlaceCards
              ref={cardsRef}
              places={displayResults}
              loading={loading}
              categoryKey={cat.id}
              emptyMessage={
                !loading && displayResults.length === 0
                  ? error ?? getExploreCategoryEmptyMessage(cat.id, locale)
                  : null
              }
              highlightIndex={selectedPlaceIndex}
              busyId={busy}
              savedNames={savedNames}
              userLocation={userLocation}
              formatDistance={formatDistanceLabel}
              distanceMeters={distanceMeters}
              imageUrl={(photoName) =>
                photoName ? buildPlacePhotoUrl(photoName, 400) : null
              }
              onSelect={handlePlaceSelect}
              onToggleSave={(p) => void handleToggleSave(p)}
              onAddToTrip={(p) => openAddToTrip(tripPlaceFromPlaceResult(p))}
              addToTripLabel={t("chat.addToTrip")}
            />
          </div>
          {sheetMode === "detail" && selectedPlace && (
            <PlaceDetailSheet
              place={{ ...selectedPlace, ...placeIntroExtra }}
              imageUrls={
                selectedPlace.photoName
                  ? [buildPlacePhotoUrl(selectedPlace.photoName, 800)!].filter(Boolean)
                  : selectedPlace.coverImageUrl
                    ? [selectedPlace.coverImageUrl]
                    : []
              }
              distanceLabel={
                selectedPlace.lat != null && selectedPlace.lng != null
                  ? formatDistanceLabel(
                      distanceMeters(userLocation, {
                        lat: selectedPlace.lat,
                        lng: selectedPlace.lng,
                      }),
                    )
                  : null
              }
              isSaved={savedByName.has(selectedPlace.name)}
              isBusy={busy === selectedPlace.id}
              transportModes={navigation.modes}
              transportLoading={navigation.loading}
              transportTip={navigation.aiTip}
              selectedTransportMode={navigation.selectedMode}
              onSelectTransportMode={navigation.setSelectedMode}
              onNavigate={handleNavigateFromDetail}
              onToggleSave={() => void handleToggleSave(selectedPlace)}
              onAddToTrip={() => openAddToTrip(tripPlaceFromPlaceResult(selectedPlace))}
              addToTripLabel={t("chat.addToTrip")}
              saveLabel="收藏"
              onOpenChat={() => openInChat(selectedPlace)}
            />
          )}
          {sheetMode === "navigation" && selectedPlace && (
            <NavigationPreviewSheet
              placeName={selectedPlace.name}
              modes={navigation.modes}
              selectedMode={navigation.selectedMode}
              onSelectMode={navigation.setSelectedMode}
              loading={navigation.loading}
              aiTip={navigation.aiTip}
              onBack={handleBackToDetail}
              onStartNavigation={navigation.startNavigation}
            />
          )}
        </>
      </MapExploreSheetSafe>
      </div>
    </div>
  );
}
