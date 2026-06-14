import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
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
import { allowDemoPlaceFallback, searchRadiusMeters } from "@/lib/search-radius";
import { rememberLastSearchLocation } from "@/lib/last-search-location";
import { withSearchTimeout } from "@/lib/search-timeout";
import {
  DEFAULT_SEARCH_RADIUS_M,
  EXPLORE_ALL_SUBCATEGORY_IDS,
  EXPLORE_CATEGORIES,
  type ExploreCategory,
} from "@/lib/places-search-config";
import {
  searchExploreAllPlaces,
  searchExploreCategoryPlaces,
  type ExplorePlaceCard,
  type HomeNearbyPick,
} from "@/lib/explore-category-search";
import { TAIPEI_CENTER } from "@/lib/geo";
import { requestDeviceLocation } from "@/lib/device-location";
import { subscribeNavigationLocationWatch } from "@/lib/navigation-location-watch";
import {
  enterNavigationLocationMode,
  leaveNavigationLocationMode,
} from "@/lib/location-coordinator";
import { useEffectiveLocation } from "@/hooks/use-effective-location";
import { normalizedLocationKey } from "@/lib/location-key";
import { logMapNearbyReady } from "@/lib/places-diagnostics";
import { filterHomeNearbyPlaceResults } from "@/lib/home-nearby-places-filter";
import { resolveUserMarkerAvatarSrc } from "@/lib/map-user-location-marker";
import { useI18n } from "@/hooks/use-i18n";
import type { Locale } from "@/lib/i18n/types";
import { type MapExploreHandoff, consumeMapExploreHandoff } from "@/lib/map-explore-handoff";
import {
  buildMapPlacesCacheKey,
  getMapPlacesCachedOrRun,
  readMapPlacesCache,
} from "@/lib/map-places-cache";
import { locationMovedEnough } from "@/lib/map-location-throttle";

export const Route = createFileRoute("/_app/map")({
  component: MapPage,
});

function MapPage() {
  return (
    <MapErrorBoundary>
      <MapView />
    </MapErrorBoundary>
  );
}

const MAP_ZOOM_EXPLORE = 15;
const MAP_ZOOM_PLACE = 17;

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
  categoryId: string,
  weather: WeatherSummary | null,
): MapPlaceCard[] {
  return sortExplorePlaces(cards, origin, profile, weather, categoryId);
}

function exploreCardsToMapCards(
  cards: ExplorePlaceCard[],
  opts: {
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    locale: Locale;
  },
): MapPlaceCard[] {
  return cards.map((p) => {
    const item = mapPlaceResultToChatItem(p, opts);
    const cover = (p as HomeNearbyPick).coverImageUrl;
    return {
      ...p,
      coverImageUrl: cover ?? undefined,
      googleMapsUrl: item.googleMapsUrl,
    } satisfies MapPlaceCard;
  });
}

function MapView() {
  const { t, locale } = useI18n();
  const tt = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const { openAddToTrip } = useAddToTrip();
  const [cat, setCat] = useState<ExploreCategory>(EXPLORE_CATEGORIES[0]);
  const navSig = useRouterState({ select: (s) => JSON.stringify(s.location) });

  useEffect(() => {
    document.documentElement.classList.add("map-route-active");
    return () => document.documentElement.classList.remove("map-route-active");
  }, []);

  const lastMapSearchSessionRef = useRef<string | null>(null);
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
  const [userLocation, setUserLocation] = useState(TAIPEI_CENTER);
  const [mapCenter, setMapCenter] = useState(TAIPEI_CENTER);
  const [mapZoom, setMapZoom] = useState(MAP_ZOOM_EXPLORE);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const sheetRef = useRef<MapExploreSheetHandle>(null);
  const cardsRef = useRef<MapExploreCardsHandle>(null);
  const [geoReady, setGeoReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hasDeviceLocation, setHasDeviceLocation] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const mapErrorToastedRef = useRef(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [reasonProfile, setReasonProfile] = useState<UserProfileForReason | null>(null);
  const exploreHandoffRef = useRef<MapExploreHandoff | null>(null);
  const effectiveLocation = useEffectiveLocation();

  const applyEffectiveLocationToMap = useCallback(
    (lat: number, lng: number, isFallback: boolean) => {
      const next = { lat, lng };
      setUserLocation(next);
      setMapCenter(next);
      setHasDeviceLocation(!isFallback);
      setLocationHint(isFallback ? t("map.locationFallbackHint") : null);
      setLocationLabel(t("common.nearby"));
      setGeoReady(true);
    },
    [t],
  );

  useEffect(() => {
    if (!effectiveLocation?.isReadyForPlaces) return;
    applyEffectiveLocationToMap(
      effectiveLocation.lat,
      effectiveLocation.lng,
      effectiveLocation.isFallback,
    );
    if (lastWeatherFetchCenterRef.current == null) {
      const next = { lat: effectiveLocation.lat, lng: effectiveLocation.lng };
      lastWeatherFetchCenterRef.current = next;
      fetchWeather({ data: next })
        .then((r) => {
          if (r.weather?.city?.trim()) {
            const city = r.weather.city.trim();
            setLocationLabel(city);
            rememberLastSearchLocation({ ...next, city });
          }
          setWeather(r.weather);
        })
        .catch(() => {});
    }
  }, [
    effectiveLocation?.locationKey,
    effectiveLocation?.isReadyForPlaces,
    effectiveLocation?.isFallback,
    applyEffectiveLocationToMap,
    fetchWeather,
  ]);

  const handleMapLoadError = useCallback((message: string) => {
    setMapUnavailable(true);
    if (!mapErrorToastedRef.current) {
      mapErrorToastedRef.current = true;
      toast.message(t("map.mapLoadFallback"), { duration: 5000 });
      console.warn("[Roamie Map]", message);
    }
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
    if (!effectiveLocation?.isReadyForPlaces) return;

    const center = { lat: effectiveLocation.lat, lng: effectiveLocation.lng };
    const locationKey = effectiveLocation.locationKey;
    const queryDirty = prevQueryRef.current !== query;
    const catDirty = prevCatIdRef.current !== cat.id;
    prevQueryRef.current = query;
    prevCatIdRef.current = cat.id;

    const isFreeText = !!query.trim();
    const sessionKey = `${locationKey}:${isFreeText ? `search:${query.trim().toLowerCase()}` : cat.id}:${locale}`;
    if (lastMapSearchSessionRef.current === sessionKey && !queryDirty && !catDirty) {
      return;
    }

    const debounceMs = pendingImmediateSearchRef.current ? 0 : isFreeText ? 450 : 0;
    pendingImmediateSearchRef.current = false;
    const handle = setTimeout(() => {
      lastMapSearchSessionRef.current = sessionKey;
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
      const allSubQuery = EXPLORE_ALL_SUBCATEGORY_IDS.join("+");
      const cacheKey = buildMapPlacesCacheKey({
        lat: center.lat,
        lng: center.lng,
        categoryId: isFreeText ? "search" : cat.id,
        locale,
      });
      const cardOpts = { weather, reasonProfile, locale };

      const runSearch = async () => {
        let enriched: MapPlaceCard[] = [];
        let fromCache = false;
        let emptyError: string | null = null;

        if (!isFreeText) {
          const cachedHit = readMapPlacesCache(cacheKey);
          if (cachedHit) {
            fromCache = true;
            enriched = exploreCardsToMapCards(cachedHit.places as ExplorePlaceCard[], cardOpts);
            emptyError = cachedHit.error;
            if (requestId !== searchRequestIdRef.current) return;
            if (enriched.length > 0) {
              setError(null);
            } else {
              setError(emptyError ?? getExploreCategoryEmptyMessage(cat.id, locale));
            }
            const sorted = sortMapCards(
              enriched,
              center,
              reasonProfile,
              cat.id,
              weather,
            );
            setResults(sorted);
            logMapNearbyReady({
              count: sorted.length,
              locationKey,
              categoryId: cat.id,
              query: cat.id === "all" ? allSubQuery : cat.query,
              fromCache: true,
            });
            if (sheetMode === "list") {
              setSelectedPlace(null);
              setSelectedPlaceIndex(null);
            }
            return;
          }
        }

        if (!isFreeText && cat.id === "all") {
          const cachedBefore = readMapPlacesCache(cacheKey);
          fromCache = cachedBefore !== null;
          const entry = await getMapPlacesCachedOrRun(cacheKey, async () => {
            const subCards = await searchExploreAllPlaces({
              userLocation: center,
              weather,
              locale,
              reasonProfile,
              saved: savedRef.current,
              searchPlacesFn,
              locationKey,
            });
            const cards = exploreCardsToMapCards(subCards, cardOpts);
            return { places: cards, error: null };
          });
          enriched = exploreCardsToMapCards(entry.places as ExplorePlaceCard[], cardOpts);
          emptyError = entry.error;
        } else if (!isFreeText) {
          const cachedBefore = readMapPlacesCache(cacheKey);
          fromCache = cachedBefore !== null;
          const entry = await getMapPlacesCachedOrRun(cacheKey, async () => {
            const cards = await searchExploreCategoryPlaces(cat, {
              userLocation: center,
              weather,
              locale,
              reasonProfile,
              saved: savedRef.current,
              searchPlacesFn,
              forHome: false,
            });
            const mapped = exploreCardsToMapCards(cards, cardOpts);
            return { places: mapped, error: null };
          });
          enriched = exploreCardsToMapCards(entry.places as ExplorePlaceCard[], cardOpts);
          emptyError = entry.error;
        } else {
          const basePayload = {
            lat: center.lat,
            lng: center.lng,
            radius: searchRadiusMeters(),
          };

          const primary = await withSearchTimeout(
            searchPlacesFn({
              data: {
                ...basePayload,
                query: searchQuery,
                mode: "text",
                locale,
              },
            }),
          );

          const apiPlaces = Array.isArray(primary.places) ? primary.places : [];
          emptyError = primary.error ?? null;

          if (requestId !== searchRequestIdRef.current) return;

          const applyFilters = (list: PlaceResult[]) =>
            filterByExploreCategory(filterExplorePlaces(list, { logDrop: false }), filterCat);

          let filtered = applyFilters(apiPlaces);

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

          enriched = [
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

          enriched = filterHomeNearbyPlaceResults(enriched, {
            categoryId: filterCat.id,
            caller: `mapSearch:${filterCat.id}`,
            context: "explore_map",
            logDrop: false,
          });
        }

        if (requestId !== searchRequestIdRef.current) return;

        if (enriched.length > 0) {
          setError(null);
        } else if (allowDemoPlaceFallback() && !isFreeText) {
          enriched = mockMapCards(center, cat);
          setError(t("map.demoPlacesNote"));
        } else {
          setError(emptyError ?? getExploreCategoryEmptyMessage(cat.id, locale));
          if (!isFreeText) {
            console.info("[explore] map places empty", { category: cat.id, emptyError });
          }
        }

        const sorted = sortMapCards(
          enriched,
          center,
          reasonProfile,
          isFreeText ? "all" : cat.id,
          weather,
        );
        setResults(sorted);
        logMapNearbyReady({
          count: sorted.length,
          locationKey,
          categoryId: isFreeText ? "search" : cat.id,
          query: isFreeText ? text : cat.id === "all" ? allSubQuery : cat.query,
          fromCache,
        });
        if (sheetMode === "list") {
          setSelectedPlace(null);
          setSelectedPlaceIndex(null);
        }
      };

      void runSearch().catch((e) => {
          const msg = e instanceof Error ? e.message : t("map.searchFailed");
          const note = t("map.demoPlacesNote");
          if (query.trim()) {
            setError(msg);
            setResults([]);
          } else if (allowDemoPlaceFallback()) {
            setError(`${msg} · ${note}`);
            setResults(mockMapCards(center, cat));
          } else {
            setError(msg);
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
    effectiveLocation?.locationKey,
    effectiveLocation?.isReadyForPlaces,
    locale,
    searchTrigger,
  ]);

  const displayResults = useMemo(() => {
    if (loading && !query.trim()) return [];
    const filterCat = query.trim() ? EXPLORE_CATEGORIES[0] : cat;
    const base =
      results.length > 0
        ? results
        : !loading && !query.trim() && allowDemoPlaceFallback()
          ? mockMapCards(userLocation, cat)
          : [];
    const filtered = filterByExploreCategory(filterExplorePlaces(base), filterCat);
    return sortMapCards(filtered, userLocation, reasonProfile, filterCat.id, weather);
  }, [results, cat, loading, query, userLocation, reasonProfile, weather]);

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
    if (!hasDeviceLocation) return null;
    return {
      lat: userLocation.lat,
      lng: userLocation.lng,
      avatarSrc: safeAvatarSrc,
    };
  }, [hasDeviceLocation, userLocation.lat, userLocation.lng, safeAvatarSrc]);

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
    if (sheetMode !== "navigation") {
      leaveNavigationLocationMode();
      return;
    }
    enterNavigationLocationMode();
    return subscribeNavigationLocationWatch((loc) => {
      applyEffectiveLocationToMap(loc.lat, loc.lng, loc.usedFallback);
    });
  }, [sheetMode, applyEffectiveLocationToMap]);

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
      const { saved: didSave } = await toggleSavePlace({
        name: p.name,
        category: p.primaryType,
        address: p.address,
        city: locationLabel,
        lat: p.lat,
        lng: p.lng,
        notes: p.reason,
        mood_tag: null,
        cover_image: p.photoName ? (buildPlacePhotoUrl(p.photoName, 600) ?? null) : null,
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
        applyEffectiveLocationToMap(loc.lat, loc.lng, loc.usedFallback);
        lastSearchLocationKeyRef.current = null;
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
        {geoReady && !mapUnavailable ? (
          <GoogleMapBackground
            center={mapCenter}
            zoom={mapZoom}
            placeMarkers={placeMarkers}
            userLocation={userLocationPin}
            onPlaceMarkerClick={onMarkerClick}
            onLoadError={handleMapLoadError}
            onMapClick={handleMapClick}
            onMapReady={(map) => {
              mapInstanceRef.current = map;
            }}
          />
        ) : geoReady ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cream px-8 text-center">
            <p className="font-display text-base text-foreground">地圖暫時無法顯示</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              仍可透過下方推薦列表探索附近地點
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-cream">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 z-10">
          <MapSearchBarOverlay
            query={query}
            onQueryChange={setQuery}
            onSubmit={() => {
              if (!query.trim()) return;
              pendingImmediateSearchRef.current = true;
              lastSearchLocationKeyRef.current = null;
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
              imageUrl={(photoName) => (photoName ? buildPlacePhotoUrl(photoName, 600) : null)}
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
