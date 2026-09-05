import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MapErrorBoundary } from "@/components/MapErrorBoundary";
import { MapExploreSheetSafe, type MapExploreSheetHandle } from "@/components/MapExploreSheetSafe";
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
import {
  MapSearchBarOverlay,
  type MapSearchBarOverlayHandle,
} from "@/components/map/MapSearchBarOverlay";
import {
  MapExploreSearchResults,
  type MapExploreSearchResultItem,
} from "@/components/map/MapExploreSearchResults";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import {
  exploreSuggestionDistanceLabel,
  resolveExploreMapSuggestion,
  resolveExploreMapSuggestionsToCards,
  runExploreMapPlaceSearch,
} from "@/lib/explore-map-search";
import {
  logExploreFinalRecommendations,
  logExplorePrimaryPlace,
  logExplorePrimaryPlacePinned,
  mergeExploreRecommendations,
  resolveExplorePrimaryPlace,
  stripPrimaryFromNearby,
} from "@/lib/explore-primary-place";
import { pickExploreCitySuggestion } from "@/lib/explore-city-popular-places";
import { listPlaces, toggleSavePlace, type SavedPlace } from "@/lib/places-storage";
import { searchPlaces } from "@/lib/places.functions";
import { recordAnalyticsEvent } from "@/lib/analytics/record";
import { getPlaceDetailsServerFnViaGateway as fetchExplorePlaceDetails } from "@/lib/pie/places-gateway";
import { createUnifiedSearchPlacesFn } from "@/lib/places-search-unified";
import { beginPlacesFlow, endPlacesFlow, placesStatsPayload } from "@/lib/places-api-stats";
import type { PlaceResult } from "@/lib/place-result";
import { buildNewSavedPlaceInput } from "@/lib/saved-place-utils";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import { buildPlaceImageUrls } from "@/lib/place-detail-resolve";
import { getWeather } from "@/lib/weather.functions";
import type { WeatherSummary } from "@/lib/weather-types";
import {
  generatePlaceReason,
  userProfileForReasonFrom,
  type UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import { usePlaceNavigation } from "@/hooks/use-place-navigation";
import { isMapDetailOpen, type MapExploreSheetMode } from "@/lib/map-explore-sheet-mode";
import {
  mapPlaceResultToChatItem,
  addSelectedPlace,
  saveChatSession,
  loadChatSession,
} from "@/lib/chat-session";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { useAccess } from "@/hooks/use-access";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import { getUserProfile } from "@/lib/profile-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { useAvatar } from "@/hooks/use-avatar";
import {
  buildExploreQuery,
  distanceMeters,
  formatDistanceLabel,
  savedPlacesNear,
} from "@/lib/map-explore";
import { sortExplorePlacesViaRecEngine } from "@/lib/recommendation/engine";
import type { ExplorePlacesSortContext } from "@/lib/sort-explore-places";
import { resolveExploreMapFoodSortContext } from "@/lib/tabelog-reference";
import { consumeExploreMapClearSelection } from "@/lib/explore-map-selection";
import { filterExplorePlaces, isTravelFriendlyPlace } from "@/lib/filter-explore-places";
import { filterAndSelectExploreMapPlaces } from "@/lib/explore-map-places-filter";
import { simplifyExploreOpeningLabel } from "@/lib/explore-places-eligibility";
import { localizePlaceDisplayName } from "@/lib/place-display-name";
import { exploreCategorySheetTitle } from "@/lib/explore-search-radius";
import { getExploreCategoryDisplayLabel, matchesCategory } from "@/lib/place-category";
import { getMockMapPlaces, getMockPlacesForCategory } from "@/lib/map-mock-places";
import { allowDemoPlaceFallback, searchRadiusMeters } from "@/lib/search-radius";
import { rememberLastSearchLocation } from "@/lib/last-search-location";
import { withSearchTimeout } from "@/lib/search-timeout";
import {
  DEFAULT_SEARCH_RADIUS_M,
  EXPLORE_CATEGORIES,
  type ExploreCategory,
} from "@/lib/places-search-config";
import {
  searchExploreCategoryPlaces,
  buildExploreCardsFromRawPlaces,
  ensureExploreRawPool,
  type ExplorePlaceCard,
  type HomeNearbyPick,
} from "@/lib/explore-category-search";
import { homeNearbyLoadPeriodKey } from "@/lib/home-nearby-search";
import { homeNearbyLoadKey } from "@/lib/home-nearby-picks-policy";
import { readSharedNearbyPlaces } from "@/lib/home-nearby-repository";
import { buildExploreRawPoolKey, readExploreRawPool } from "@/lib/explore-raw-places-pool";
import { TAIPEI_CENTER } from "@/lib/geo";
import { requestDeviceLocation } from "@/lib/device-location";
import { subscribeNavigationLocationWatch } from "@/lib/navigation-location-watch";
import {
  enterNavigationLocationMode,
  leaveNavigationLocationMode,
} from "@/lib/location-coordinator";
import { useEffectiveLocation } from "@/hooks/use-effective-location";
import {
  inferExploreCityLabel,
  logExploreRecommendMode,
  resolveExploreRecommendMode,
  type ExploreRecommendMode,
} from "@/lib/explore-recommend-mode";
import { buildPlaceDetailTicketOffers } from "@/lib/affiliate/affiliate-links";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import { isGooglePlaceId } from "@/lib/place-detail-handoff";
import {
  isPinnableSearchSelection,
  logExploreSearchSelect,
  logExploreSelectedPlaceDetails,
  normalizeExplorePlaceId,
} from "@/lib/explore-selected-place";
import { logMapNearbyReady } from "@/lib/places-diagnostics";
import { resolveExploreSearchUserMessage } from "@/lib/user-facing-error";
import { resolveUserMarkerAvatarSrc } from "@/lib/map-user-location-marker";
import { useI18n } from "@/hooks/use-i18n";
import type { Locale } from "@/lib/i18n/types";
import { type MapExploreHandoff, consumeMapExploreHandoff } from "@/lib/map-explore-handoff";
import { captureMapLayoutHeight, resetMapSearchKeyboardMode } from "@/lib/map-search-keyboard";
import { normalizedLocationKey } from "@/lib/location-key";
import { isPlaceOperationalForRecommendation } from "@/lib/place-operational-eligibility";
import {
  buildExploreSessionKey,
  buildMapPlacesCacheKey,
  exploreTimeBucket,
  getMapPlacesCachedOrRun,
  readMapPlacesCache,
  readExploreMapSearchSession,
  writeExploreMapSearchSession,
  clearExploreMapSearchSession,
  setExploreMapForceRefreshNext,
  consumeExploreMapForceRefresh,
  normalizeExploreCityCacheKey,
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
  distanceLabel?: string;
  isSelectedExplorePin?: boolean;
  isPrimaryExplorePlace?: boolean;
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
  sortContext?: ExplorePlacesSortContext,
): MapPlaceCard[] {
  // R0：經 Recommendation Engine Explore Adapter（Flag OFF = 直呼舊 sortExplorePlaces）
  return sortExplorePlacesViaRecEngine(cards, origin, profile, weather, categoryId, sortContext);
}

function finalizeMapResults(
  cards: MapPlaceCard[],
  origin: { lat: number; lng: number },
  profile: UserProfileForReason | null,
  categoryId: string,
  weather: WeatherSummary | null,
  primary: MapPlaceCard | null,
  locationKey: string,
  cityLabel?: string | null,
): MapPlaceCard[] {
  const eligiblePrimary = primary && isPlaceOperationalForRecommendation(primary) ? primary : null;
  const nearbyOnly = stripPrimaryFromNearby(eligiblePrimary, cards).filter(
    isPlaceOperationalForRecommendation,
  );
  const sortContext = resolveExploreMapFoodSortContext(categoryId, origin, cityLabel);
  const sorted = sortMapCards(nearbyOnly, origin, profile, categoryId, weather, sortContext);
  const merged = mergeExploreRecommendations(eligiblePrimary, sorted);
  if (eligiblePrimary) {
    logExplorePrimaryPlacePinned(eligiblePrimary.name, 0);
  }
  logExploreFinalRecommendations(
    merged.map((c) => c.name),
    categoryId,
    locationKey,
  );
  return merged;
}

function normalizeExploreMapCard(card: ExplorePlaceCard, locale: Locale): MapPlaceCard {
  const hoursLabel = simplifyExploreOpeningLabel(card);
  const name = localizePlaceDisplayName(card.name, locale);
  const rawCategory = card.displayCategory?.trim();
  const authoritativeCategory =
    rawCategory && rawCategory.toLowerCase() !== "unknown"
      ? rawCategory
      : identityDisplayLabel(resolvePlaceIdentity(card), card);
  const displayCategory = localizePlaceDisplayName(authoritativeCategory, locale);
  return {
    ...card,
    name,
    displayCategory: displayCategory || authoritativeCategory,
    openStatusLabel: hoursLabel,
    normalizedOpeningLabel: hoursLabel,
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
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
    const recommendation = buildUnifiedPlaceCard({
      place: p,
      reason: p.reason,
      categoryId: (p as HomeNearbyPick).categoryId,
      isSavedFavorite: p.isSavedFavorite,
      weather: opts.weather,
      userProfile: opts.reasonProfile,
      locale: opts.locale,
    });
    const item = mapPlaceResultToChatItem(p, opts);
    const cover = (p as HomeNearbyPick).coverImageUrl;
    const normalized = normalizeExploreMapCard(recommendation, opts.locale);
    return {
      ...normalized,
      coverImageUrl: cover
        ? (resolvePlaceImageUrl(cover, { maxWidth: 600 }) ?? undefined)
        : undefined,
      googleMapsUrl: item.googleMapsUrl,
    } satisfies MapPlaceCard;
  });
}

function syncExploreMapSheetFeedback(setters: { setError: (value: string | null) => void }): void {
  setters.setError(null);
}

function buildMapExploreCacheKeys(parts: {
  center: { lat: number; lng: number };
  categoryId: string;
  locale: Locale;
  mode: ExploreRecommendMode;
  cityPlaceId?: string | null;
  cityLabel?: string | null;
  freeTextQuery?: string | null;
  nearbyLocationKey?: string;
}) {
  const cacheKey = buildMapPlacesCacheKey({
    lat: parts.center.lat,
    lng: parts.center.lng,
    categoryId: parts.categoryId,
    locale: parts.locale,
    mode: parts.mode === "city" ? "city" : "nearby",
    cityPlaceId: parts.cityPlaceId,
    cityLabel: parts.cityLabel,
  });
  const locationKey =
    parts.mode === "city"
      ? normalizeExploreCityCacheKey(
          parts.cityPlaceId,
          parts.cityLabel,
          parts.center.lat,
          parts.center.lng,
        )
      : (parts.nearbyLocationKey ?? normalizedLocationKey(parts.center.lat, parts.center.lng));
  const sessionKey = buildExploreSessionKey({
    locationKey,
    categoryId: parts.categoryId,
    locale: parts.locale,
    mode: parts.mode === "city" ? "city" : "nearby",
    timeBucket: exploreTimeBucket(),
    freeTextQuery: parts.freeTextQuery,
  });
  return { cacheKey, sessionKey, locationKey };
}

function MapView() {
  const { t, locale } = useI18n();
  const { hasPlusAccess } = useAccess();
  const tt = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const { openAddToTrip } = useAddToTrip();
  const [cat, setCat] = useState<ExploreCategory>(EXPLORE_CATEGORIES[0]);
  const navSig = useRouterState({ select: (s) => JSON.stringify(s.location) });

  useEffect(() => {
    document.documentElement.classList.add("map-route-active");
    captureMapLayoutHeight();
    return () => {
      document.documentElement.classList.remove("map-route-active");
      resetMapSearchKeyboardMode();
    };
  }, []);

  const lastMapSearchSessionRef = useRef<string | null>(null);
  const lastWeatherFetchCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const searchRequestIdRef = useRef(0);
  const prevQueryRef = useRef("");
  const prevCatIdRef = useRef(cat.id);
  const pendingImmediateSearchRef = useRef(false);
  const [searchTrigger, setSearchTrigger] = useState(0);

  const navigate = useNavigate();
  const { avatarDisplaySrc, avatarPending } = useAvatar();
  const safeAvatarSrc = useMemo(
    () => resolveUserMarkerAvatarSrc(avatarDisplaySrc ?? undefined),
    [avatarDisplaySrc],
  );
  const searchPlacesServerFn = useServerFn(searchPlaces);
  const searchPlacesFn = useMemo(
    () => createUnifiedSearchPlacesFn(searchPlacesServerFn),
    [searchPlacesServerFn],
  );
  const searchTripStopsFn = useServerFn(searchTripStops);
  const resolveTripStopFn = useServerFn(resolveTripStop);
  const fetchWeather = useServerFn(getWeather);
  const fetchExplorePlaceDetailsFn = useServerFn(fetchExplorePlaceDetails);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<MapExploreSearchResultItem[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [resolvingSearchId, setResolvingSearchId] = useState<string | null>(null);
  const exploreSearchRequestRef = useRef(0);
  const [exploreSearchRevision, setExploreSearchRevision] = useState(0);
  const searchBarRef = useRef<MapSearchBarOverlayHandle>(null);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [searchSelectedCenter, setSearchSelectedCenter] = useState<{
    lat: number;
    lng: number;
    label: string;
    types?: string[];
    primaryType?: string | null;
    placeId?: string;
  } | null>(null);
  const [primaryPlace, setPrimaryPlace] = useState<MapPlaceCard | null>(null);
  const primaryPlaceRef = useRef<MapPlaceCard | null>(null);
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
  const weatherRef = useRef<WeatherSummary | null>(null);
  const reasonProfileRef = useRef<UserProfileForReason | null>(null);
  weatherRef.current = weather;
  reasonProfileRef.current = reasonProfile;
  const exploreHandoffRef = useRef<MapExploreHandoff | null>(null);
  const restoredExploreSearchRef = useRef(false);
  const effectiveLocation = useEffectiveLocation();

  const clearExploreSelectionState = useCallback(() => {
    setSelectedPlace(null);
    setSelectedPlaceIndex(null);
    setMapZoom(MAP_ZOOM_EXPLORE);
  }, []);

  useEffect(() => {
    if (restoredExploreSearchRef.current) return;
    restoredExploreSearchRef.current = true;
    const session = readExploreMapSearchSession();
    if (!session) return;

    setSearchSelectedCenter(session.center);
    setQuery(session.query);
    setLocationLabel(session.center.label);
    setMapCenter({ lat: session.center.lat, lng: session.center.lng });
    const matchedCat = EXPLORE_CATEGORIES.find((c) => c.id === session.categoryId);
    if (matchedCat) setCat(matchedCat);

    const { cacheKey, sessionKey, locationKey } = buildMapExploreCacheKeys({
      center: { lat: session.center.lat, lng: session.center.lng },
      categoryId: session.categoryId,
      locale,
      mode: "city",
      cityPlaceId: session.center.placeId,
      cityLabel: session.center.label,
    });
    const cached = readMapPlacesCache(cacheKey);
    if (!cached?.places.length) return;

    lastMapSearchSessionRef.current = sessionKey;
    prevQueryRef.current = session.query;
    prevCatIdRef.current = session.categoryId;
    const cardOpts = {
      weather: weatherRef.current,
      reasonProfile: reasonProfileRef.current,
      locale,
    };
    const enriched = exploreCardsToMapCards(cached.places as ExplorePlaceCard[], cardOpts);
    const finalResults = finalizeMapResults(
      enriched,
      { lat: session.center.lat, lng: session.center.lng },
      reasonProfileRef.current,
      session.categoryId,
      weatherRef.current,
      null,
      locationKey,
      session.center.label,
    );
    setResults(finalResults);
    setLoading(false);
    setError(null);
  }, []);

  const recommendCenter = useMemo(() => {
    if (searchSelectedCenter) {
      return {
        lat: searchSelectedCenter.lat,
        lng: searchSelectedCenter.lng,
        label: searchSelectedCenter.label,
        source: "searchSelection" as const,
      };
    }
    if (effectiveLocation?.isReadyForPlaces) {
      return {
        lat: effectiveLocation.lat,
        lng: effectiveLocation.lng,
        label: locationLabel,
        source: "userLocation" as const,
      };
    }
    return {
      lat: userLocation.lat,
      lng: userLocation.lng,
      label: locationLabel,
      source: "userLocation" as const,
    };
  }, [
    searchSelectedCenter,
    effectiveLocation?.isReadyForPlaces,
    effectiveLocation?.lat,
    effectiveLocation?.lng,
    locationLabel,
    userLocation.lat,
    userLocation.lng,
  ]);

  const cityRecommendMode = useMemo((): ExploreRecommendMode => {
    if (!searchSelectedCenter) return "nearby";
    return resolveExploreRecommendMode({
      label: searchSelectedCenter.label,
      types: searchSelectedCenter.types,
      primaryType: searchSelectedCenter.primaryType,
    });
  }, [searchSelectedCenter]);

  const selectedPlaceTypeLabel = useMemo(() => {
    if (!searchSelectedCenter) return null;
    const types = searchSelectedCenter.types ?? [];
    return searchSelectedCenter.primaryType ?? types[0] ?? null;
  }, [searchSelectedCenter]);

  useEffect(() => {
    primaryPlaceRef.current = primaryPlace;
  }, [primaryPlace]);

  const handleSearchQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setSearchSelectedCenter(null);
      setPrimaryPlace(null);
      primaryPlaceRef.current = null;
      setSearchDropdownOpen(false);
      setSearchSuggestions([]);
      lastMapSearchSessionRef.current = null;
      clearExploreMapSearchSession();
      return;
    }
    setSearchDropdownOpen(true);
    setSearchSelectedCenter((prev) => (prev && value.trim() !== prev.label ? null : prev));
    if (value.trim()) {
      setPrimaryPlace((prev) => {
        if (prev && value.trim() !== prev.name) {
          primaryPlaceRef.current = null;
          return null;
        }
        return prev;
      });
    }
  }, []);

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
    if (searchSelectedCenter) return;
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
    searchSelectedCenter,
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
        const prefs = await getPreferences();
        const profile = await getUserProfile().catch(() => null);
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
      } catch {
        if (!cancelled) {
          getPreferences()
            .then((prefs) => setReasonProfile(userProfileForReasonFrom(prefs, { hasPlusAccess })))
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
  }, [hasPlusAccess]);

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
    if (searchDropdownOpen) return;

    const center = { lat: recommendCenter.lat, lng: recommendCenter.lng };
    const isFreeText = !!query.trim() && !searchSelectedCenter;
    const categoryId = isFreeText ? "search" : cat.id;
    const cityMeta = {
      cityPlaceId: searchSelectedCenter?.placeId,
      cityLabel: searchSelectedCenter?.label,
    };
    const { cacheKey, sessionKey, locationKey } = buildMapExploreCacheKeys({
      center,
      categoryId,
      locale,
      mode: cityRecommendMode,
      cityPlaceId: cityMeta.cityPlaceId,
      cityLabel: cityMeta.cityLabel,
      freeTextQuery: isFreeText ? query : null,
      nearbyLocationKey: effectiveLocation?.locationKey,
    });
    const forceRefresh = consumeExploreMapForceRefresh();

    const queryDirty = prevQueryRef.current !== query;
    const catDirty = prevCatIdRef.current !== cat.id;
    prevQueryRef.current = query;
    prevCatIdRef.current = cat.id;

    if (
      lastMapSearchSessionRef.current === sessionKey &&
      !queryDirty &&
      !catDirty &&
      !forceRefresh
    ) {
      return;
    }

    const syncExploreSheetFeedback = () => {
      syncExploreMapSheetFeedback({ setError });
    };

    const applyCachedResults = (cachedPlaces: MapPlaceCard[], _emptyError: string | null) => {
      const cardOpts = {
        weather: weatherRef.current,
        reasonProfile: reasonProfileRef.current,
        locale,
      };
      const enriched = exploreCardsToMapCards(cachedPlaces as ExplorePlaceCard[], cardOpts);
      const finalResults = finalizeMapResults(
        enriched,
        center,
        reasonProfileRef.current,
        cat.id,
        weatherRef.current,
        primaryPlaceRef.current,
        locationKey,
        searchSelectedCenter?.label,
      );
      syncExploreSheetFeedback();
      setResults(finalResults);
      if (sheetMode === "list") {
        setSelectedPlace(null);
        setSelectedPlaceIndex(null);
      }
      if (searchRequestIdRef.current >= 0) setLoading(false);
    };

    if (!isFreeText) {
      const skipCacheForPrimarySearch =
        !!searchSelectedCenter?.placeId && !!primaryPlaceRef.current;
      const cachedHit = skipCacheForPrimarySearch
        ? null
        : readMapPlacesCache(cacheKey, { ignoreCache: forceRefresh });
      if (cachedHit?.places.length) {
        lastMapSearchSessionRef.current = sessionKey;
        applyCachedResults(cachedHit.places as MapPlaceCard[], cachedHit.error);
        return;
      }

      if (cat.id !== "all") {
        const rawPoolKey = buildExploreRawPoolKey(
          center.lat,
          center.lng,
          cityRecommendMode,
          locale,
          cat.id,
          cityMeta.cityPlaceId,
          cityMeta.cityLabel,
        );
        const rawPool = skipCacheForPrimarySearch
          ? null
          : readExploreRawPool(rawPoolKey, { ignoreCache: forceRefresh });
        if (rawPool?.length) {
          const localCards = buildExploreCardsFromRawPlaces(rawPool, cat, {
            userLocation: center,
            weather: weatherRef.current,
            locale,
            reasonProfile: reasonProfileRef.current,
            saved: savedRef.current,
            forHome: false,
            recommendMode: cityRecommendMode,
          });
          if (localCards.length > 0) {
            lastMapSearchSessionRef.current = sessionKey;
            applyCachedResults(
              exploreCardsToMapCards(localCards, {
                weather: weatherRef.current,
                reasonProfile: reasonProfileRef.current,
                locale,
              }),
              null,
            );
            return;
          }
        }
      } else if (!skipCacheForPrimarySearch && !forceRefresh && cityRecommendMode !== "city") {
        // 與首頁共用附近快取，避免同定位再刷一輪 Places
        const shared = readSharedNearbyPlaces({
          loadKey: homeNearbyLoadKey(center.lat, center.lng, homeNearbyLoadPeriodKey(), locale),
        });
        if (shared && shared.length > 0) {
          lastMapSearchSessionRef.current = sessionKey;
          applyCachedResults(
            exploreCardsToMapCards(shared as ExplorePlaceCard[], {
              weather: weatherRef.current,
              reasonProfile: reasonProfileRef.current,
              locale,
            }),
            null,
          );
          console.info("[EXPLORE_SHARED_NEARBY_HIT]", { count: shared.length });
          return;
        }
      }
    }

    console.info(
      `[EXPLORE_RECOMMEND_CENTER] source=${recommendCenter.source} lat=${center.lat} lng=${center.lng}`,
    );
    console.info(
      `[EXPLORE_RECOMMEND_REQUEST] category=${cat.id} lat=${center.lat} lng=${center.lng}`,
    );
    logExploreRecommendMode(cityRecommendMode, selectedPlaceTypeLabel);

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
            weather: weatherRef.current,
            timeIso: new Date().toISOString(),
            userLocation: center,
            userLocale: locale,
          });
      const filterCat = isFreeText ? EXPLORE_CATEGORIES[0] : cat;
      const cardOpts = {
        weather: weatherRef.current,
        reasonProfile: reasonProfileRef.current,
        locale,
      };

      const runSearch = async () => {
        const flowName =
          isFreeText || queryDirty
            ? "explore_open"
            : catDirty
              ? "explore_category"
              : "explore_open";
        const flow = beginPlacesFlow(flowName);
        try {
          let enriched: MapPlaceCard[] = [];
          let fromCache = false;
          let emptyError: string | null = null;

          if (!isFreeText) {
            if (cat.id !== "all") {
              await ensureExploreRawPool(
                center,
                cityRecommendMode,
                searchPlacesFn,
                locale,
                undefined,
                "explore",
                cityMeta,
              );
            }
            const cachedBefore = readMapPlacesCache(cacheKey, { ignoreCache: forceRefresh });
            fromCache = cachedBefore !== null;
            const entry = await withSearchTimeout(
              getMapPlacesCachedOrRun(
                cacheKey,
                async () => {
                  const cards = await searchExploreCategoryPlaces(cat, {
                    userLocation: center,
                    weather: weatherRef.current,
                    locale,
                    reasonProfile: reasonProfileRef.current,
                    saved: savedRef.current,
                    searchPlacesFn,
                    forHome: false,
                    recommendMode: cityRecommendMode,
                    cityLabel: inferExploreCityLabel(
                      center.lat,
                      center.lng,
                      searchSelectedCenter?.label,
                    ),
                    cityPlaceId: searchSelectedCenter?.placeId,
                  });
                  const mapped = exploreCardsToMapCards(cards, cardOpts);
                  return { places: mapped, error: null };
                },
                { silent: true, forceRefresh },
              ),
              cityRecommendMode === "city" ? 45_000 : 20_000,
            );
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
                  ...placesStatsPayload({
                    placesCaller: "map.freeTextSearch",
                    placesScreen: "explore",
                    categoryId: "search",
                  }),
                },
              }),
            );

            const apiPlaces = Array.isArray(primary.places) ? primary.places : [];
            emptyError = primary.error ?? null;

            if (requestId !== searchRequestIdRef.current) return;

            const selection = filterAndSelectExploreMapPlaces(apiPlaces, {
              cat: filterCat,
              origin: center,
              locale,
            });
            const filtered = selection.places;

            const nearbySaved = savedPlacesNear(center, savedRef.current, 5000);
            const apiNames = new Set(apiPlaces.map((p) => p.name));
            const savedCards: MapPlaceCard[] = nearbySaved
              .filter((s) => !apiNames.has(s.name))
              .filter((s) =>
                matchesCategory(
                  {
                    primaryType: s.category,
                    name: s.name,
                    types: s.category ? [s.category] : null,
                  },
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
                  weather: weatherRef.current,
                  userProfile: reasonProfileRef.current,
                  locale,
                });
                const item = mapPlaceResultToChatItem(base, {
                  weather: weatherRef.current,
                  userProfile: reasonProfileRef.current,
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
                  weather: weatherRef.current,
                  userProfile: reasonProfileRef.current,
                  locale,
                });
                const item = mapPlaceResultToChatItem(p, {
                  weather: weatherRef.current,
                  userProfile: reasonProfileRef.current,
                  locale,
                });
                return { ...card, googleMapsUrl: item.googleMapsUrl };
              }),
            ];
          }

          if (requestId !== searchRequestIdRef.current) return;

          if (enriched.length > 0) {
            /* feedback set after finalize */
          } else if (allowDemoPlaceFallback() && !isFreeText) {
            enriched = mockMapCards(center, cat);
            setError(t("map.demoPlacesNote"));
          } else {
            setError(null);
            if (!isFreeText) {
              console.info("[explore] map places empty", { category: cat.id, emptyError });
            }
          }

          const finalResults = finalizeMapResults(
            enriched,
            center,
            reasonProfileRef.current,
            isFreeText ? "all" : cat.id,
            weatherRef.current,
            primaryPlaceRef.current,
            locationKey,
            searchSelectedCenter?.label,
          );
          if (enriched.length > 0) {
            syncExploreSheetFeedback();
          }
          setResults(finalResults);
          if (
            cityRecommendMode === "city" &&
            searchSelectedCenter &&
            finalResults.length > 0 &&
            !isFreeText
          ) {
            writeExploreMapSearchSession({
              center: {
                lat: searchSelectedCenter.lat,
                lng: searchSelectedCenter.lng,
                label: searchSelectedCenter.label,
                types: searchSelectedCenter.types,
                primaryType: searchSelectedCenter.primaryType,
                placeId: searchSelectedCenter.placeId,
              },
              query: searchSelectedCenter.label,
              categoryId: cat.id,
              locale,
              savedAt: Date.now(),
            });
          }
          if (!fromCache) {
            logMapNearbyReady({
              count: finalResults.length,
              locationKey,
              categoryId: isFreeText ? "search" : cat.id,
              query: isFreeText ? text : cat.query,
            });
          }
          if (sheetMode === "list") {
            setSelectedPlace(null);
            setSelectedPlaceIndex(null);
          }
        } finally {
          endPlacesFlow(flow);
        }
      };

      void runSearch()
        .catch((e) => {
          const msg = resolveExploreSearchUserMessage(e, t("map.searchFailed"));
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
    searchPlacesFn,
    geoReady,
    effectiveLocation?.locationKey,
    effectiveLocation?.isReadyForPlaces,
    locale,
    searchTrigger,
    searchDropdownOpen,
    recommendCenter.lat,
    recommendCenter.lng,
    recommendCenter.source,
    searchSelectedCenter?.label,
    searchSelectedCenter?.placeId,
    cityRecommendMode,
  ]);

  useEffect(() => {
    if (!geoReady || !effectiveLocation?.isReadyForPlaces) return;
    if (!searchDropdownOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchSuggestions([]);
      setSearchingPlaces(false);
      return;
    }

    const requestId = ++exploreSearchRequestRef.current;
    setSearchingPlaces(true);
    setError(null);

    const handle = window.setTimeout(() => {
      void (async () => {
        const center = { lat: userLocation.lat, lng: userLocation.lng };
        const { suggestions, error } = await runExploreMapPlaceSearch(trimmed, {
          locale,
          center,
          searchFn: searchTripStopsFn,
        });
        if (requestId !== exploreSearchRequestRef.current) return;

        setSearchSuggestions(
          suggestions.map((s) => ({
            ...s,
            typeLabel: s.types?.[0],
          })),
        );
        if (error && suggestions.length === 0) {
          setError(error);
          setSearchingPlaces(false);
          return;
        }

        const cards = await resolveExploreMapSuggestionsToCards(suggestions, {
          locale,
          resolveFn: resolveTripStopFn,
          userLocation: center,
          weather,
          reasonProfile,
          limit: 10,
        });
        if (requestId !== exploreSearchRequestRef.current) return;

        setSearchSuggestions((prev) =>
          prev.map((item) => {
            const card = cards.find((c) => c.id === item.placeId);
            return {
              ...item,
              distanceLabel: exploreSuggestionDistanceLabel(item, center, card),
            };
          }),
        );
        setSearchingPlaces(false);
        if (error && suggestions.length === 0) {
          setError(error ?? "找不到符合的地點");
        }
      })().catch((e) => {
        if (requestId !== exploreSearchRequestRef.current) return;
        const msg = e instanceof Error ? e.message : t("map.searchFailed");
        console.warn(`[EXPLORE_SEARCH_ERROR] status=exception message=${msg}`);
        setSearchingPlaces(false);
      });
    }, 320);

    return () => window.clearTimeout(handle);
  }, [
    query,
    geoReady,
    effectiveLocation?.isReadyForPlaces,
    userLocation.lat,
    userLocation.lng,
    locale,
    searchTripStopsFn,
    resolveTripStopFn,
    weather,
    reasonProfile,
    t,
    exploreSearchRevision,
    searchDropdownOpen,
  ]);

  const displayResults = useMemo(() => {
    const filterCat = cat;
    const sortCenter = { lat: recommendCenter.lat, lng: recommendCenter.lng };
    const primary = primaryPlace;

    if (loading && !searchDropdownOpen) {
      if (primary) return [primary];
      return [];
    }

    const base =
      results.length > 0
        ? results
        : !loading && !searchDropdownOpen && allowDemoPlaceFallback()
          ? mockMapCards(sortCenter, cat)
          : [];
    const nearbyOnly = stripPrimaryFromNearby(primary, base);
    const sorted = sortMapCards(nearbyOnly, sortCenter, reasonProfile, filterCat.id, weather);
    return mergeExploreRecommendations(primary, sorted);
  }, [
    results,
    cat,
    loading,
    searchDropdownOpen,
    recommendCenter.lat,
    recommendCenter.lng,
    reasonProfile,
    weather,
    primaryPlace,
  ]);

  const handleCategorySelect = useCallback(
    (c: ExploreCategory) => {
      if (c.id === cat.id) return;
      setCat(c);
      const center = { lat: recommendCenter.lat, lng: recommendCenter.lng };
      setMapCenter(center);
      clearExploreSelectionState();
      setSheetMode("list");
      setError(null);

      const cityMeta = {
        cityPlaceId: searchSelectedCenter?.placeId,
        cityLabel: searchSelectedCenter?.label,
      };
      const { cacheKey, sessionKey, locationKey } = buildMapExploreCacheKeys({
        center,
        categoryId: c.id,
        locale,
        mode: cityRecommendMode,
        cityPlaceId: cityMeta.cityPlaceId,
        cityLabel: cityMeta.cityLabel,
        nearbyLocationKey: effectiveLocation?.locationKey,
      });
      const cachedHit = readMapPlacesCache(cacheKey);
      if (cachedHit?.places.length) {
        const cards = exploreCardsToMapCards(cachedHit.places as ExplorePlaceCard[], {
          weather: weatherRef.current,
          reasonProfile: reasonProfileRef.current,
          locale,
        });
        const finalResults = finalizeMapResults(
          cards,
          center,
          reasonProfileRef.current,
          c.id,
          weatherRef.current,
          primaryPlaceRef.current,
          locationKey,
          searchSelectedCenter?.label,
        );
        syncExploreMapSheetFeedback({ setError });
        setResults(finalResults);
        setLoading(false);
        lastMapSearchSessionRef.current = sessionKey;
        prevCatIdRef.current = c.id;
        return;
      }

      if (c.id !== "all") {
        const rawPool = readExploreRawPool(
          buildExploreRawPoolKey(
            center.lat,
            center.lng,
            cityRecommendMode,
            locale,
            c.id,
            cityMeta.cityPlaceId,
            cityMeta.cityLabel,
          ),
        );
        if (rawPool?.length) {
          const localCards = buildExploreCardsFromRawPlaces(rawPool, c, {
            userLocation: center,
            weather: weatherRef.current,
            locale,
            reasonProfile: reasonProfileRef.current,
            saved: savedRef.current,
            forHome: false,
            recommendMode: cityRecommendMode,
          });
          if (localCards.length > 0) {
            const cards = exploreCardsToMapCards(localCards, {
              weather: weatherRef.current,
              reasonProfile: reasonProfileRef.current,
              locale,
            });
            const finalResults = finalizeMapResults(
              cards,
              center,
              reasonProfileRef.current,
              c.id,
              weatherRef.current,
              primaryPlaceRef.current,
              locationKey,
              searchSelectedCenter?.label,
            );
            syncExploreMapSheetFeedback({ setError });
            setResults(finalResults);
            setLoading(false);
            lastMapSearchSessionRef.current = sessionKey;
            prevCatIdRef.current = c.id;
            return;
          }
        }
      }

      lastMapSearchSessionRef.current = null;
      setLoading(true);
      setResults([]);
    },
    [
      cat.id,
      recommendCenter.lat,
      recommendCenter.lng,
      recommendCenter.source,
      effectiveLocation?.locationKey,
      locale,
      cityRecommendMode,
      searchSelectedCenter?.label,
      clearExploreSelectionState,
    ],
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
    origin: hasDeviceLocation || effectiveLocation?.source === "remembered" ? userLocation : null,
    destination: selectedDestination,
    weather,
    profile: reasonProfile,
    enabled: !!selectedPlace && isMapDetailOpen(sheetMode),
  });

  const reliableUserLocation =
    hasDeviceLocation || effectiveLocation?.source === "remembered" ? userLocation : null;

  const userLocationPin = useMemo(() => {
    if (!hasDeviceLocation) return null;
    return {
      lat: userLocation.lat,
      lng: userLocation.lng,
      avatarSrc: safeAvatarSrc,
    };
  }, [hasDeviceLocation, userLocation.lat, userLocation.lng, safeAvatarSrc]);

  const savedByName = useMemo(() => new Map(saved.map((s) => [s.name, s])), [saved]);

  const refocusSelectedPlace = useCallback((lat: number, lng: number) => {
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
  }, []);

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
    if (consumeExploreMapClearSelection()) {
      clearExploreSelectionState();
      setSheetMode("list");
    }
  }, [navSig, clearExploreSelectionState]);

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

  const handlePlaceSelect = useCallback(
    (index: number, analyticsSurface: "explore" | "map" = "explore") => {
      const place = displayResults[index];
      if (!place) return;

      if (place.lat == null || place.lng == null) {
        toast.message(t("map.noCoordsDetail"));
        return;
      }

      const isSameAsSelected =
        selectedPlaceIndex === index && selectedPlace != null && selectedPlace.id === place.id;

      if (isSameAsSelected && sheetMode === "list") {
        clearExploreSelectionState();
        return;
      }
      recordAnalyticsEvent({
        eventId: crypto.randomUUID(),
        eventName: "place_card_opened",
        placeId: place.id,
        surface: analyticsSurface,
      });

      const distM = reliableUserLocation
        ? distanceMeters(reliableUserLocation, { lat: place.lat, lng: place.lng })
        : undefined;
      const reason =
        place.reason?.trim() ||
        generatePlaceReason(place, reasonProfile, {
          weather,
          locale,
          context: {
            categoryLabel: place.displayCategory,
            distanceMeters: distM,
            distanceSource: distM != null ? "USER_LOCATION" : undefined,
          },
        });

      setSelectedPlace({ ...place, reason });
      setSelectedPlaceIndex(index);
      setSheetMode("detail");
      sheetRef.current?.expand();
      focusMapOnPlace(place.lat, place.lng);
    },
    [
      displayResults,
      reliableUserLocation,
      reasonProfile,
      weather,
      focusMapOnPlace,
      locale,
      t,
      selectedPlaceIndex,
      selectedPlace,
      sheetMode,
      clearExploreSelectionState,
    ],
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
    clearExploreSelectionState();
    setSheetMode("list");
    sheetRef.current?.expand();
  }, [clearExploreSelectionState]);

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
      reliableUserLocation && p.lat != null && p.lng != null
        ? distanceMeters(reliableUserLocation, { lat: p.lat, lng: p.lng })
        : undefined;
    const item = mapPlaceResultToChatItem(p, {
      weather,
      userProfile: reasonProfile,
      categoryLabel: getExploreCategoryDisplayLabel(p),
      distanceMeters: distM,
      distanceSource: distM != null ? "USER_LOCATION" : undefined,
      reason: p.reason,
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
      const { saved: didSave } = await toggleSavePlace(
        buildNewSavedPlaceInput({
          name: p.name,
          category: p.primaryType,
          primaryType: p.primaryType,
          types: p.types ?? undefined,
          address: p.address,
          city: locationLabel,
          lat: p.lat,
          lng: p.lng,
          notes: p.reason,
          placeId: p.id,
          googlePlaceId: p.id,
          photoName: p.photoName,
          rating: p.rating,
          userRatingCount: p.userRatingCount,
        }),
      );
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
        clearExploreMapSearchSession();
        setExploreMapForceRefreshNext();
        setSearchSelectedCenter(null);
        setPrimaryPlace(null);
        primaryPlaceRef.current = null;
        setQuery("");
        setSearchDropdownOpen(false);
        setSearchSuggestions([]);
        lastMapSearchSessionRef.current = null;
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

  const applyExploreSearchTarget = useCallback(
    async (item: MapExploreSearchResultItem) => {
      const types = item.types ?? undefined;
      const primaryType = item.types?.[0] ?? null;
      const shouldHavePrimary = isPinnableSearchSelection({
        label: item.label,
        types,
        primaryType,
        placeId: item.placeId,
      });

      const primaryCard = shouldHavePrimary
        ? await resolveExplorePrimaryPlace(item, {
            locale,
            resolveFn: resolveTripStopFn,
            userLocation: reliableUserLocation,
            weather,
            reasonProfile,
            fetchPlaceDetailsFn: fetchExplorePlaceDetailsFn,
          })
        : null;

      const resolved =
        primaryCard ??
        (
          await resolveExploreMapSuggestion(item, {
            locale,
            resolveFn: resolveTripStopFn,
            userLocation: reliableUserLocation,
            weather,
            reasonProfile,
          })
        ).card;

      if (!resolved || resolved.lat == null || resolved.lng == null) {
        toast.error(t("location.resolveFailed"));
        return false;
      }

      const selectedLabel = item.label?.trim() || resolved.name;
      const selectedPlaceId = normalizeExplorePlaceId(item.placeId);
      const detailSource = primaryCard ?? resolved;

      logExploreSearchSelect({
        name: selectedLabel,
        placeId: selectedPlaceId,
        types: types ?? resolved.types,
      });
      logExploreSelectedPlaceDetails({
        name: detailSource.name,
        rating: detailSource.rating,
        address: detailSource.address,
        photo: detailSource.photoName,
      });

      const chosenPhoto = detailSource.photoName;
      const mapCard: MapPlaceCard = {
        ...detailSource,
        id: shouldHavePrimary ? selectedPlaceId : detailSource.id || selectedPlaceId,
        name: shouldHavePrimary ? selectedLabel : detailSource.name,
        googleMapsUrl:
          detailSource.googleMapsUrl ??
          mapPlaceResultToChatItem(detailSource, {
            weather,
            userProfile: reasonProfile,
            locale,
          }).googleMapsUrl,
        coverImageUrl:
          resolvePlaceImageUrl(
            detailSource.coverImageUrl ??
              (chosenPhoto ? (buildPlacePhotoUrl(chosenPhoto, 600) ?? null) : null),
            { maxWidth: 600 },
          ) || undefined,
        ...(shouldHavePrimary
          ? {
              isPrimaryExplorePlace: true,
              isSelectedExplorePin: true,
            }
          : {}),
      };

      if (shouldHavePrimary) {
        primaryPlaceRef.current = mapCard;
        setPrimaryPlace(mapCard);
        logExplorePrimaryPlace(mapCard.name, mapCard.id);
        logExplorePrimaryPlacePinned(mapCard.name, 0);
      } else {
        primaryPlaceRef.current = null;
        setPrimaryPlace(null);
      }

      setSearchSelectedCenter({
        lat: resolved.lat,
        lng: resolved.lng,
        label: selectedLabel,
        types: types ?? resolved.types ?? undefined,
        primaryType: resolved.primaryType ?? primaryType,
        placeId: selectedPlaceId,
      });
      setSearchDropdownOpen(false);
      setSearchSuggestions([]);
      setSearchFocused(false);
      searchBarRef.current?.dismiss();

      setQuery(selectedLabel);
      setLocationLabel(selectedLabel);

      setMapCenter({ lat: resolved.lat, lng: resolved.lng });
      setMapZoom(MAP_ZOOM_EXPLORE);
      focusMapOnPlace(resolved.lat, resolved.lng);

      void fetchWeather({ data: { lat: resolved.lat, lng: resolved.lng } })
        .then((r) => setWeather(r.weather))
        .catch(() => {});

      setSelectedPlace(null);
      setSelectedPlaceIndex(null);
      setSheetMode("list");
      sheetRef.current?.expand();

      const recommendMode = resolveExploreRecommendMode({
        label: selectedLabel,
        types: types ?? resolved.types ?? undefined,
        primaryType: resolved.primaryType ?? primaryType,
      });
      const { cacheKey, sessionKey, locationKey } = buildMapExploreCacheKeys({
        center: { lat: resolved.lat, lng: resolved.lng },
        categoryId: cat.id,
        locale,
        mode: recommendMode,
        cityPlaceId: selectedPlaceId,
        cityLabel: selectedLabel,
      });
      const forceRefresh = consumeExploreMapForceRefresh();
      const skipCacheForPrimary = shouldHavePrimary && !!mapCard;
      const cachedHit =
        !forceRefresh && recommendMode === "city" && !skipCacheForPrimary
          ? readMapPlacesCache(cacheKey)
          : null;

      if (recommendMode === "city") {
        writeExploreMapSearchSession({
          center: {
            lat: resolved.lat,
            lng: resolved.lng,
            label: selectedLabel,
            types: types ?? resolved.types ?? undefined,
            primaryType: resolved.primaryType ?? primaryType,
            placeId: selectedPlaceId,
          },
          query: selectedLabel,
          categoryId: cat.id,
          locale,
          savedAt: Date.now(),
        });
      }

      if (cachedHit?.places.length) {
        lastMapSearchSessionRef.current = sessionKey;
        prevQueryRef.current = selectedLabel;
        prevCatIdRef.current = cat.id;
        pendingImmediateSearchRef.current = false;
        const cardOpts = {
          weather: weatherRef.current,
          reasonProfile: reasonProfileRef.current,
          locale,
        };
        const enriched = exploreCardsToMapCards(cachedHit.places as ExplorePlaceCard[], cardOpts);
        const finalResults = finalizeMapResults(
          enriched,
          { lat: resolved.lat, lng: resolved.lng },
          reasonProfileRef.current,
          cat.id,
          weatherRef.current,
          shouldHavePrimary ? mapCard : null,
          locationKey,
          searchSelectedCenter?.label ?? resolved.label,
        );
        syncExploreMapSheetFeedback({ setError });
        setResults(finalResults);
        setLoading(false);
        setError(null);
        return true;
      }

      lastMapSearchSessionRef.current = null;
      prevQueryRef.current = "";
      prevCatIdRef.current = "";
      pendingImmediateSearchRef.current = true;
      setSearchTrigger((n) => n + 1);
      setLoading(true);
      setResults([]);
      setError(null);
      return true;
    },
    [
      locale,
      cat.id,
      resolveTripStopFn,
      reliableUserLocation,
      weather,
      reasonProfile,
      focusMapOnPlace,
      fetchWeather,
      fetchExplorePlaceDetailsFn,
      t,
    ],
  );

  const handleExploreSearchSelect = useCallback(
    async (item: MapExploreSearchResultItem) => {
      setResolvingSearchId(item.placeId);
      try {
        await applyExploreSearchTarget(item);
      } finally {
        setResolvingSearchId(null);
      }
    },
    [applyExploreSearchTarget],
  );

  const handleExploreSearchSubmit = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const existingPrimary = primaryPlaceRef.current;
    if (
      existingPrimary &&
      searchSelectedCenter?.label === trimmed &&
      normalizeExplorePlaceId(searchSelectedCenter.placeId) ===
        normalizeExplorePlaceId(existingPrimary.id)
    ) {
      setExploreMapForceRefreshNext();
      lastMapSearchSessionRef.current = null;
      pendingImmediateSearchRef.current = true;
      setSearchTrigger((n) => n + 1);
      return;
    }

    setResolvingSearchId("submit");
    try {
      const center = effectiveLocation?.isReadyForPlaces
        ? { lat: effectiveLocation.lat, lng: effectiveLocation.lng }
        : userLocation;
      const { suggestions, error } = await runExploreMapPlaceSearch(trimmed, {
        locale,
        center,
        searchFn: searchTripStopsFn,
      });
      const item = pickExploreCitySuggestion(trimmed, suggestions);
      if (!item) {
        toast.error(error ?? t("location.resolveFailed"));
        return;
      }
      await applyExploreSearchTarget(item);
    } finally {
      setResolvingSearchId(null);
    }
  }, [
    query,
    searchSelectedCenter,
    effectiveLocation?.isReadyForPlaces,
    effectiveLocation?.lat,
    effectiveLocation?.lng,
    userLocation,
    locale,
    searchTripStopsFn,
    applyExploreSearchTarget,
    t,
  ]);

  const savedNames = useMemo(() => new Set(saved.map((s) => s.name)), [saved]);

  const selectedPlaceTicketOffers = useMemo(() => {
    if (!selectedPlace) return [];
    return buildPlaceDetailTicketOffers(selectedPlace, {
      destinationLabel: searchSelectedCenter?.label ?? locationLabel,
      locale,
    });
  }, [selectedPlace, searchSelectedCenter?.label, locationLabel, locale]);

  const onMarkerClick = useCallback(
    (markerIdx: number) => {
      const withCoords = displayResults.filter((p) => p.lat != null && p.lng != null);
      const p = withCoords[markerIdx];
      if (!p) return;
      handlePlaceSelect(displayResults.indexOf(p), "map");
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
            ref={searchBarRef}
            query={query}
            onQueryChange={handleSearchQueryChange}
            onFocusChange={(focused) => {
              setSearchFocused(focused);
              if (focused && query.trim()) setSearchDropdownOpen(true);
            }}
            onSubmit={() => {
              void handleExploreSearchSubmit();
            }}
            onLocate={locateMe}
            locating={locating}
            placeholder={t("map.searchPlaceholder")}
            resultsPanel={
              searchDropdownOpen &&
              query.trim() &&
              (searchFocused || searchingPlaces || searchSuggestions.length > 0) ? (
                <MapExploreSearchResults
                  open
                  results={searchSuggestions}
                  searching={searchingPlaces}
                  resolvingId={resolvingSearchId}
                  onSelect={(item) => void handleExploreSearchSelect(item)}
                  emptyMessage="找不到符合的地點"
                />
              ) : null
            }
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
                  <p className="font-display text-lg leading-tight">
                    {exploreCategorySheetTitle(cat.id)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {searchSelectedCenter
                      ? `「${searchSelectedCenter.label}」· ${loading ? t("common.search") : tt("map.placesCount", { count: displayResults.length })}`
                      : `${loading ? t("common.search") : tt("map.placesCount", { count: displayResults.length })}`}
                    {saved.length > 0 ? ` · 已收藏 ${saved.length}` : ""}
                  </p>
                  {locationHint && (
                    <p className="mt-1 text-xs text-muted-foreground/90">{locationHint}</p>
                  )}
                </div>

                {!searchDropdownOpen ? (
                  <MapExploreCategoryChips selected={cat} onSelect={handleCategorySelect} />
                ) : null}

                {error && (
                  <p className="mx-5 mb-2 rounded-2xl bg-clay/15 px-3 py-2 text-xs text-clay">
                    {error}
                  </p>
                )}
              </>
            )
          }
        >
          <>
            <div
              className={sheetMode !== "list" ? "hidden" : undefined}
              aria-hidden={sheetMode !== "list"}
            >
              <MapExplorePlaceCards
                ref={cardsRef}
                places={displayResults}
                loading={loading}
                categoryKey={cat.id}
                emptyMessage={null}
                highlightIndex={selectedPlaceIndex}
                busyId={busy}
                savedNames={savedNames}
                userLocation={reliableUserLocation}
                formatDistance={formatDistanceLabel}
                distanceMeters={distanceMeters}
                imageUrl={(photoName) =>
                  photoName
                    ? resolvePlaceImageUrl(buildPlacePhotoUrl(photoName, 600), { maxWidth: 600 })
                    : null
                }
                onSelect={handlePlaceSelect}
                onToggleSave={(p) => void handleToggleSave(p)}
                onAddToTrip={(p) => openAddToTrip(tripPlaceFromPlaceResult(p), "explore")}
                addToTripLabel={t("chat.addToTrip")}
              />
            </div>
            {sheetMode === "detail" && selectedPlace && (
              <PlaceDetailSheet
                place={selectedPlace}
                imageUrls={buildPlaceImageUrls(selectedPlace)}
                distanceLabel={
                  (hasDeviceLocation || effectiveLocation?.source === "remembered") &&
                  selectedPlace.lat != null &&
                  selectedPlace.lng != null
                    ? formatDistanceLabel(
                        distanceMeters(
                          reliableUserLocation!,
                          {
                            lat: selectedPlace.lat,
                            lng: selectedPlace.lng,
                          },
                        ),
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
                onAddToTrip={() => openAddToTrip(tripPlaceFromPlaceResult(selectedPlace), "map")}
                addToTripLabel={t("chat.addToTrip")}
                saveLabel="收藏"
                onOpenChat={() => openInChat(selectedPlace)}
                googleMapsExternalUrl={
                  selectedPlace.lat != null && selectedPlace.lng != null
                    ? buildPlaceMapsUrl(
                        selectedPlace.lat,
                        selectedPlace.lng,
                        selectedPlace.name,
                        isGooglePlaceId(selectedPlace.id) ? selectedPlace.id : null,
                      )
                    : null
                }
                ticketOffers={selectedPlaceTicketOffers}
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
