import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Calendar,
  Camera,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { RoamieDatePicker } from "@/components/pickers";
import { DayOutfitCard } from "@/components/DayOutfitCard";
import { DailyOutfitAlertCard } from "@/components/DailyOutfitAlertCard";
import { TripOutfitCard } from "@/components/saved/TripOutfitCard";
import { TripCoverImage } from "@/components/media/TripCoverImage";
import { SavedPlacesPickSheet } from "@/components/saved/SavedPlacesPickSheet";
import { TripAddPlacePanel, type TripAddPlaceMode } from "@/components/saved/TripAddPlacePanel";
import { TripRoamiePlanSheet } from "@/components/saved/TripRoamiePlanSheet";
import { SavedTripEditableStopCard } from "@/components/saved/SavedTripEditableStopCard";
import { TripCoverSheet } from "@/components/saved/TripCoverSheet";
import { ProfileImageCropSheet } from "@/components/profile/ProfileImageCropSheet";
import {
  isRoamiePayloadV2,
  type RoamieItineraryItem,
  type RoamiePayloadV2,
  type TripPlanSettings,
} from "@/lib/ai/types";
import {
  formatSavedTripDateRange,
  formatSavedTripDayLabel,
  normalizeStoredTrip,
} from "@/lib/saved-trip/normalize";
import {
  buildEditorPayloadFingerprint,
  buildStableEditorPayload,
  hashItineraryItems,
  hashOutfitSlice,
  hashTripSettings,
  TRIP_EDITOR_AUTO_SAVE_DISABLED,
} from "@/lib/saved-trip/trip-editor-stable-payload";
import {
  hashStableOutfitExtrasFromPayload,
  pickStableOutfitExtrasForPayload,
  TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED,
} from "@/lib/saved-trip/trip-editor-outfit-extras";
import { useStableContentFingerprint } from "@/lib/saved-trip/use-stable-content-fingerprint";
import { useTripEditorAutoSave } from "@/lib/saved-trip/use-trip-editor-auto-save";
import { useTripDetailRenderLog } from "@/lib/saved-trip/use-trip-detail-render-log";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import { regenerateTripCover, updateTripMeta } from "@/lib/itinerary-storage";
import { buildCustomCoverPatch, buildCustomTitlePatch } from "@/lib/saved-trip/display";
import { formatLegTravelTimeLabel } from "@/lib/saved-trip/travel-time";
import { syncTripLegsFromGoogleRoutes } from "@/lib/saved-trip/sync-route-legs";
import { buildLegKey } from "@/lib/transit/types";
import { uploadTripCover } from "@/lib/trip-media-storage";
import {
  addEmptyDay,
  groupStopsByDate,
  insertStopOnDate,
  legKeyForItem,
  listTripDateKeys,
  moveStopInDay,
  nextDayIsoAfter,
  removeDay,
  removeStopAt,
  sortStopsInDayByTime,
} from "@/lib/trip/trip-stop-mutations";
import { tripPlaceToItineraryItem } from "@/lib/trip/trip-place-input";
import { resolveTripTitle } from "@/lib/trip/trip-title";
import {
  logTripDetailBack,
  resolveTripDetailBackTarget,
  tripDetailBackNavigateOptions,
  type TripDetailFromSource,
} from "@/lib/trip/trip-detail-back";
import {
  applyTripDateRangeChange,
  applyTripDayOneDateChange,
  applyTripDatesToPayload,
  extractTripDateUiState,
  logTripDateEdited,
  logTripDateHydrateSource,
  logTripDatePickerFromRange,
  logTripDatePickerFromSingle,
  logTripDateRendered,
  logTripDateCacheInvalidated,
  logTripDateUiStateUpdated,
  logTripDatesRecalculated,
  remapItemsToDateMap,
} from "@/lib/trip/trip-date-edit";
import { saveTripDatesToStorage } from "@/lib/trip/save-trip-dates";
import {
  logTripAddPlaceAppendStart,
  logTripAddPlaceAppendSuccess,
  logTripAddPlaceDetailsReady,
  logTripAddPlaceRenderConfirmed,
  logTripAddPlaceSaveFailed,
  logTripAddPlaceSelected,
  saveTripItineraryAfterAddPlace,
} from "@/lib/trip/trip-add-place-persist";
import {
  logTripDeletePlaceClicked,
  logTripDeletePlaceMutation,
  logTripDeletePlaceSaveFailed,
  saveTripItineraryAfterDeletePlace,
} from "@/lib/trip/trip-delete-place-persist";
import { buildSeasonOutfitAdvicePayload } from "@/lib/outfit/trip-season-outfit-suggestion";
import {
  logDailyOutfitAlertRendered,
  resolveOutfitSuggestionDisplay,
} from "@/lib/outfit/compare-daily-outfit-suggestions";
import { outfitAdviceDays } from "@/lib/outfit/types";
import { daysBetweenDates } from "@/lib/fetch-context";
import { todayISO } from "@/lib/picker-utils";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";
import { useTripOutfitAdvice } from "@/hooks/use-trip-outfit-advice";
import { useTripOutfitSuggestion } from "@/hooks/use-trip-outfit-suggestion";
import { logOutfitSuggestionRendered } from "@/lib/trip-place-card-log";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";
import { cn } from "@/lib/utils";

function inferTripDates(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): { start: string; end: string } {
  const fromSettings = settings.tripStartDate;
  const toSettings = settings.tripEndDate;
  if (fromSettings) {
    return { start: fromSettings, end: toSettings || fromSettings };
  }
  const isoDates = [
    ...new Set(items.map((i) => i.date?.trim()).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d!))),
  ].sort();
  if (isoDates.length > 0) {
    return { start: isoDates[0]!, end: isoDates[isoDates.length - 1]! };
  }
  const today = todayISO();
  return { start: today, end: today };
}

type DayGroup = { dateKey: string; dayNumber: number; items: RoamieItineraryItem[] };

function buildDayGroups(items: RoamieItineraryItem[], settings: TripPlanSettings): DayGroup[] {
  const explicit = (settings.tripDayDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const groups = groupStopsByDate(items);
  const dateKeys =
    explicit.length > 0
      ? explicit
      : (() => {
          const { start, end } = inferTripDates(items, settings);
          const dayCount = Math.max(
            1,
            daysBetweenDates(settings.tripStartDate ?? start, settings.tripEndDate ?? end),
            listTripDateKeys(items, start).length,
          );
          return listTripDates(items, start, dayCount);
        })();
  return dateKeys.map((dateKey, i) => ({
    dateKey,
    dayNumber: i + 1,
    items: groups.get(dateKey) ?? [],
  }));
}

type Props = {
  stored: StoredItinerary;
  navSource?: string;
  fromSource?: TripDetailFromSource;
  headerRight?: React.ReactNode;
  onStoredChange?: (stored: StoredItinerary) => void;
};

export function SavedTripItineraryEditor({
  stored,
  navSource = "SavedTripCard",
  fromSource = "saved",
  headerRight,
  onStoredChange,
}: Props) {
  const navigate = useNavigate();
  const initialPayloadRef = useRef(stored.payload as RoamiePayloadV2);
  const destinationRef = useRef({
    destination: (stored.payload as RoamiePayloadV2).destination,
    destinationLocation: (stored.payload as RoamiePayloadV2).destinationLocation,
  });

  useEffect(() => {
    initialPayloadRef.current = stored.payload as RoamiePayloadV2;
    destinationRef.current = {
      destination: (stored.payload as RoamiePayloadV2).destination,
      destinationLocation: (stored.payload as RoamiePayloadV2).destinationLocation,
    };
    seedCoreTripPersistedFingerprint(stored.id, stored.payload, stored.mood);
  }, [stored.id]);

  const initial = initialPayloadRef.current;
  const initialView = useMemo(() => normalizeStoredTrip(stored), [stored.id, stored.updated_at]);
  const [tripTitle, setTripTitle] = useState(() => initialView.displayTitle);
  const [isTitleCustomized, setIsTitleCustomized] = useState(initialView.isTitleCustomized);
  const [customCoverImageUrl, setCustomCoverImageUrl] = useState<string | null>(
    initialView.customCoverImageUrl,
  );
  const [aiCoverImageUrl, setAiCoverImageUrl] = useState<string | null>(
    initialView.aiGeneratedCoverImageUrl,
  );
  const [isCoverCustomized, setIsCoverCustomized] = useState(initialView.isCoverCustomized);
  const [coverSource, setCoverSource] = useState<string | null>(stored.cover_source);
  const coverSyncRef = useRef(stored.updated_at ?? stored.created_at);
  const [editingTitle, setEditingTitle] = useState(false);
  const [coverSheetOpen, setCoverSheetOpen] = useState(false);
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const initialDateState = extractTripDateUiState(initial, initial.tripSettings);
  logTripDateHydrateSource({
    source: "editor_mount",
    startDate: initialDateState.startDate,
    dayDates: initialDateState.dayDates,
  });

  const [settings, setSettings] = useState<TripPlanSettings>(() => initialDateState.settings);
  const [items, setItems] = useState<RoamieItineraryItem[]>(() => [...initialDateState.items]);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [savedPlacesOpen, setSavedPlacesOpen] = useState(false);
  const [roamiePlanOpen, setRoamiePlanOpen] = useState(false);
  const [addMenuDayIndex, setAddMenuDayIndex] = useState<number | null>(null);
  const [addPlaceMode, setAddPlaceMode] = useState<TripAddPlaceMode | null>(null);
  const addPlaceDateKeyRef = useRef<string | null>(null);
  const [transitLoading, setTransitLoading] = useState(false);
  const skipInitialTransitFetch = useRef(
    Boolean(
      initial.tripSettings?.transitLegs && Object.keys(initial.tripSettings.transitLegs).length > 0,
    ),
  );

  const dayGroups = useMemo(() => buildDayGroups(items, settings), [items, settings]);

  const displayedSummaryDate = useMemo(() => {
    const start = settings.tripStartDate ?? "";
    const end = settings.tripEndDate ?? start;
    if (start && end && start !== end) {
      return `${start} – ${end}`;
    }
    return start || end;
  }, [settings.tripStartDate, settings.tripEndDate]);

  useEffect(() => {
    const displayedDayDates = dayGroups.map((d) => d.dateKey);
    logTripDateRendered({
      tripId: stored.id,
      displayedSummaryDate,
      displayedDayDates,
    });
  }, [stored.id, displayedSummaryDate, dayGroups]);

  const tripDatesForOutfit = useMemo(() => inferTripDates(items, settings), [items, settings]);
  const outfitDestination = useMemo(
    () =>
      resolveTripDestination({
        destination: destinationRef.current.destination,
        destinationLocation: destinationRef.current.destinationLocation,
        itinerary: items,
      }),
    [items],
  );

  const outfitCoords = useMemo(() => {
    const loc = destinationRef.current.destinationLocation;
    if (loc?.lat != null && loc?.lng != null) {
      return { lat: loc.lat, lng: loc.lng };
    }
    const fromItem = items.find((i) => i.lat != null && i.lng != null);
    if (fromItem?.lat != null && fromItem?.lng != null) {
      return { lat: fromItem.lat, lng: fromItem.lng };
    }
    return { lat: null as number | null, lng: null as number | null };
  }, [items]);

  const hasInitialOutfitAdviceDays = useMemo(
    () => outfitAdviceDays(initialPayloadRef.current.outfitAdvice).length > 0,
    [stored.id],
  );

  const {
    outfitAdvice: outfitAdviceFromHook,
    outfitAdviceInputKey,
    adviceByDate,
    loading: outfitLoading,
    error: outfitError,
    weatherUnavailable,
    unavailableMessage,
  } = useTripOutfitAdvice({
    initialAdvice: initialPayloadRef.current.outfitAdvice,
    initialInputKey: initialPayloadRef.current.outfitAdviceInputKey,
    items,
    settings,
    destination: outfitDestination,
    destinationLocation: destinationRef.current.destinationLocation,
    dateRange: {
      start: settings.tripStartDate ?? tripDatesForOutfit.start,
      end: settings.tripEndDate ?? tripDatesForOutfit.end,
    },
    dayCount: dayGroups.length,
    lat: outfitCoords.lat,
    lng: outfitCoords.lng,
    moodTag: initialPayloadRef.current.moodTag,
    enabled: !hasInitialOutfitAdviceDays,
  });

  const seasonFallbackAdvice = useMemo(
    () =>
      buildSeasonOutfitAdvicePayload({
        destination: outfitDestination,
        startDate: settings.tripStartDate ?? tripDatesForOutfit.start,
        endDate: settings.tripEndDate ?? tripDatesForOutfit.end,
        dayCount: dayGroups.length,
        itinerary: items,
        mood: initialPayloadRef.current.moodTag,
      }),
    [
      stored.id,
      outfitDestination,
      settings.tripStartDate,
      settings.tripEndDate,
      tripDatesForOutfit.start,
      tripDatesForOutfit.end,
      dayGroups.length,
      items,
    ],
  );

  const outfitAdvice = useMemo(() => {
    if (outfitAdviceDays(outfitAdviceFromHook).length > 0) return outfitAdviceFromHook;
    return seasonFallbackAdvice;
  }, [outfitAdviceFromHook, seasonFallbackAdvice]);

  const tripOutfitInitial = useMemo(() => {
    const p = initialPayloadRef.current;
    return {
      outfitSuggestion: p.outfitSuggestion ?? p.clothingAdvice,
      weatherSummary: p.weatherSummary,
      weatherSource: p.weatherSource,
      outfitSuggestionUpdatedAt: p.outfitSuggestionUpdatedAt,
      outfitSuggestionInputKey: p.outfitSuggestionInputKey,
      outfitTags: p.outfitTags,
      weatherTempC: p.weatherTempC,
      weatherFeelsLikeC: p.weatherFeelsLikeC,
      weatherCondition: p.weatherCondition,
      weatherIconType: p.weatherIconType,
      weatherIsDaytime: p.weatherIsDaytime,
      weatherPrecipPercent: p.weatherPrecipPercent,
      outfitTier: p.outfitTier,
    };
  }, [stored.id]);

  const frozenOutfitSuggestionTextRef = useRef(
    (
      tripOutfitInitial.outfitSuggestion ??
      initialPayloadRef.current.outfitSuggestion ??
      initialPayloadRef.current.clothingAdvice ??
      ""
    ).trim(),
  );

  useEffect(() => {
    const text = (
      tripOutfitInitial.outfitSuggestion ??
      initialPayloadRef.current.outfitSuggestion ??
      initialPayloadRef.current.clothingAdvice ??
      ""
    ).trim();
    if (text) frozenOutfitSuggestionTextRef.current = text;
  }, [stored.id, tripOutfitInitial.outfitSuggestion]);

  const outfitSuggestionLiveEnabled =
    !TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED &&
    !frozenOutfitSuggestionTextRef.current;

  const {
    loading: tripOutfitLoading,
    outfitFields: tripOutfitFields,
    outfitError: tripOutfitError,
  } = useTripOutfitSuggestion({
    initialFields: tripOutfitInitial,
    items,
    settings,
    destination: outfitDestination,
    fallbackDestination: destinationRef.current.destination,
    destinationLocation: destinationRef.current.destinationLocation,
    dateRange: {
      start: settings.tripStartDate ?? tripDatesForOutfit.start,
      end: settings.tripEndDate ?? tripDatesForOutfit.end,
    },
    dayCount: dayGroups.length,
    tripCenter:
      outfitCoords.lat != null && outfitCoords.lng != null
        ? { lat: outfitCoords.lat, lng: outfitCoords.lng }
        : undefined,
    moodTag: initialPayloadRef.current.moodTag,
    refreshWeather: false,
    enabled: outfitSuggestionLiveEnabled,
    tripId: stored.id,
  });

  const tripOutfitSuggestion =
    frozenOutfitSuggestionTextRef.current ||
    tripOutfitFields.outfitSuggestion?.trim() ||
    "";

  const outfitRenderedLoggedRef = useRef(false);
  useEffect(() => {
    outfitRenderedLoggedRef.current = false;
  }, [stored.id]);

  useEffect(() => {
    if (!tripOutfitSuggestion.trim()) return;
    if (outfitRenderedLoggedRef.current) return;
    outfitRenderedLoggedRef.current = true;
    logOutfitSuggestionRendered(stored.id, true);
  }, [stored.id, tripOutfitSuggestion]);

  const outfitExtrasForPayload = useMemo(() => {
    if (TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED || frozenOutfitSuggestionTextRef.current) {
      return pickStableOutfitExtrasForPayload(
        initialPayloadRef.current,
        frozenOutfitSuggestionTextRef.current || tripOutfitSuggestion,
      );
    }
    if (tripOutfitLoading && !tripOutfitSuggestion.trim()) {
      return null;
    }
    const text = tripOutfitSuggestion.trim();
    if (!text) return null;
    return pickStableOutfitExtrasForPayload(initialPayloadRef.current, text);
  }, [
    stored.id,
    outfitDestination,
    tripOutfitSuggestion,
    tripOutfitLoading,
    outfitSuggestionLiveEnabled,
  ]);

  const itemsHash = useMemo(() => hashItineraryItems(items), [items]);
  const settingsHash = useMemo(() => hashTripSettings(settings), [settings]);
  const outfitAdviceHash = useMemo(
    () => hashOutfitSlice(outfitAdvice, undefined, null),
    [outfitAdvice],
  );
  const outfitExtrasHash = useStableContentFingerprint(
    () =>
      hashStableOutfitExtrasFromPayload(initialPayloadRef.current, outfitDestination),
    [
      stored.id,
      outfitDestination,
      frozenOutfitSuggestionTextRef.current,
      (initialPayloadRef.current.weatherSummary ?? "").trim(),
      (initialPayloadRef.current.moodTag ?? "").trim(),
    ],
  );

  const effectiveTitle = useMemo(() => {
    if (isTitleCustomized) return tripTitle;
    const draft: RoamiePayloadV2 = {
      ...initialPayloadRef.current,
      title: tripTitle,
      itinerary: items,
      tripSettings: settings,
      recommendations: [],
    };
    return resolveTripTitle(draft);
  }, [isTitleCustomized, tripTitle, itemsHash, settingsHash]);

  const payloadFingerprint = useStableContentFingerprint(
    () =>
      buildEditorPayloadFingerprint({
        tripTitle: effectiveTitle,
        items,
        settings,
        outfitAdvice,
        outfitExtras: outfitExtrasForPayload,
        moodTag: initialPayloadRef.current.moodTag,
      }),
    [effectiveTitle, itemsHash, settingsHash, outfitAdviceHash, outfitExtrasHash],
  );

  const payload = useMemo(
    () =>
      buildStableEditorPayload(initialPayloadRef.current, {
        tripTitle: effectiveTitle,
        items,
        settings,
        outfitAdvice,
        outfitAdviceInputKey,
        outfitExtras: outfitExtrasForPayload,
      }),
    [payloadFingerprint],
  );

  const [saveEnabled, setSaveEnabled] = useState(false);
  useEffect(() => {
    setSaveEnabled(false);
    const timer = window.setTimeout(() => setSaveEnabled(true), 1_500);
    return () => window.clearTimeout(timer);
  }, [stored.id]);

  const { saving, saveError } = useTripEditorAutoSave({
    tripId: stored.id,
    payload,
    payloadFingerprint,
    enabled: saveEnabled,
  });

  useTripDetailRenderLog(stored.id, {
    itemsHash: itemsHash.slice(0, 24),
    settingsHash: settingsHash.slice(0, 24),
    payloadFingerprint: payloadFingerprint.slice(0, 24),
    effectiveTitle,
    outfitAdviceHash: outfitAdviceHash.slice(0, 24),
    outfitExtrasHash: outfitExtrasHash.slice(0, 24),
    saveEnabled,
    autoSaveDisabled: TRIP_EDITOR_AUTO_SAVE_DISABLED,
  });

  const tripView = useMemo(() => {
    const displayTitle = isTitleCustomized ? tripTitle : effectiveTitle;
    const view = normalizeStoredTrip({
      ...stored,
      title: isTitleCustomized ? stored.title : effectiveTitle,
      custom_title: isTitleCustomized ? tripTitle : stored.custom_title,
      is_title_customized: isTitleCustomized,
      cover_image: aiCoverImageUrl,
      custom_cover_image_url: customCoverImageUrl,
      is_cover_customized: isCoverCustomized,
      cover_image_url: customCoverImageUrl,
      cover_source: coverSource as StoredItinerary["cover_source"],
      payload,
    });
    return { ...view, displayTitle };
  }, [
    stored.id,
    stored.title,
    stored.custom_title,
    stored.updated_at,
    tripTitle,
    effectiveTitle,
    isTitleCustomized,
    customCoverImageUrl,
    aiCoverImageUrl,
    isCoverCustomized,
    coverSource,
    payloadFingerprint,
  ]);

  useEffect(() => {
    const stamp = stored.updated_at ?? stored.created_at;
    if (stamp === coverSyncRef.current) return;
    coverSyncRef.current = stamp;
    const view = normalizeStoredTrip(stored);
    setCustomCoverImageUrl(view.customCoverImageUrl);
    setAiCoverImageUrl(view.aiGeneratedCoverImageUrl);
    setIsCoverCustomized(view.isCoverCustomized);
    setCoverSource(stored.cover_source);
  }, [stored.id, stored.updated_at, stored.cover_source]);

  const safeDayIndex = Math.min(activeDayIndex, Math.max(0, dayGroups.length - 1));
  const activeDay = dayGroups[safeDayIndex];

  const outfitDestinationLabel =
    tripView.destination !== "尚未設定" ? tripView.destination : outfitDestination;

  const outfitDisplay = useMemo(
    () =>
      resolveOutfitSuggestionDisplay(
        outfitAdviceDays(outfitAdvice),
        dayGroups,
        outfitDestinationLabel,
      ),
    [outfitAdvice, dayGroups, outfitDestinationLabel],
  );

  const adviceForActiveDay = useMemo(() => {
    if (!activeDay || outfitDisplay.mode !== "daily_specific") return undefined;
    const days = outfitAdviceDays(outfitAdvice);
    return (
      days.find((d) => d.date === activeDay.dateKey) ?? days[activeDay.dayNumber - 1]
    );
  }, [activeDay, outfitAdvice, outfitDisplay.mode]);

  const activeDayAlert = useMemo(() => {
    if (!activeDay || outfitDisplay.mode !== "trip_level") return null;
    return (
      outfitDisplay.dailyAlerts.find((a) => a.dayNumber === activeDay.dayNumber) ?? null
    );
  }, [activeDay, outfitDisplay]);

  const dailyAlertLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeDayAlert) return;
    const key = `${stored.id}:${activeDayAlert.dayNumber}:${activeDayAlert.reason}`;
    if (dailyAlertLoggedRef.current === key) return;
    dailyAlertLoggedRef.current = key;
    logDailyOutfitAlertRendered({
      day: activeDayAlert.dayNumber,
      reason: activeDayAlert.reason,
    });
  }, [stored.id, activeDayAlert]);

  const handleTripBack = useCallback(() => {
    const target = resolveTripDetailBackTarget(navSource, fromSource);
    logTripDetailBack({
      tripId: stored.id,
      navSource,
      from: fromSource,
      returnTo: target.to + (target.search?.tab ? `?tab=${target.search.tab}` : ""),
    });
    void navigate(tripDetailBackNavigateOptions(navSource, fromSource));
  }, [navigate, navSource, fromSource, stored.id]);

  const effectiveTitleRef = useRef(effectiveTitle);
  effectiveTitleRef.current = effectiveTitle;

  const [dateSaving, setDateSaving] = useState(false);

  const applyTripDateUiState = useCallback(
    (ui: ReturnType<typeof extractTripDateUiState>, source: string) => {
      setSettings(ui.settings);
      setItems(ui.items);
      logTripDateUiStateUpdated({
        startDate: ui.startDate,
        endDate: ui.endDate,
        dayDates: ui.dayDates,
      });
      logTripDateHydrateSource({
        source,
        startDate: ui.startDate,
        dayDates: ui.dayDates,
      });
    },
    [],
  );

  const persistTripDateChange = useCallback(
    async (nextSettings: TripPlanSettings, nextItems: RoamieItineraryItem[]) => {
      const optimistic = extractTripDateUiState(
        applyTripDatesToPayload(
          buildStableEditorPayload(initialPayloadRef.current, {
            tripTitle: effectiveTitleRef.current,
            items: nextItems,
            settings: nextSettings,
            outfitAdvice,
            outfitAdviceInputKey,
            outfitExtras: outfitExtrasForPayload,
          }),
          nextSettings,
          nextItems,
        ),
        nextSettings,
      );
      applyTripDateUiState(optimistic, "date_save_optimistic");

      const nextPayload = applyTripDatesToPayload(
        buildStableEditorPayload(initialPayloadRef.current, {
          tripTitle: effectiveTitleRef.current,
          items: optimistic.items,
          settings: optimistic.settings,
          outfitAdvice,
          outfitAdviceInputKey,
          outfitExtras: outfitExtrasForPayload,
        }),
        optimistic.settings,
        optimistic.items,
      );

      setDateSaving(true);
      try {
        const updated = await saveTripDatesToStorage(stored.id, nextPayload);
        if (updated?.payload && isRoamiePayloadV2(updated.payload)) {
          const synced = extractTripDateUiState(updated.payload, optimistic.settings);
          applyTripDateUiState(synced, "date_save_success");
          initialPayloadRef.current = applyTripDatesToPayload(
            updated.payload,
            synced.settings,
            synced.items,
          );
          seedCoreTripPersistedFingerprint(stored.id, initialPayloadRef.current, updated.mood);
          logTripDateCacheInvalidated({ tripId: stored.id });
          onStoredChange?.({
            ...updated,
            payload: initialPayloadRef.current,
            updated_at: updated.updated_at ?? new Date().toISOString(),
          });
        }
        toast.success("行程日期已儲存");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "日期儲存失敗");
      } finally {
        setDateSaving(false);
      }
    },
    [
      stored.id,
      outfitAdvice,
      outfitAdviceInputKey,
      outfitExtrasForPayload,
      onStoredChange,
      applyTripDateUiState,
    ],
  );

  const handleTripStartDateChange = useCallback(
    (range: { start: string; end: string }) => {
      logTripDatePickerFromRange(range);
      const { settings: nextSettings, items: nextItems } = applyTripDateRangeChange(
        stored.id,
        settings,
        items,
        range,
      );
      void persistTripDateChange(nextSettings, nextItems);
    },
    [stored.id, settings, items, persistTripDateChange],
  );

  const handleActiveDayDateChange = useCallback(
    (newDate: string) => {
      if (!activeDay) return;
      logTripDatePickerFromSingle(newDate);

      let nextSettings = settings;
      let nextItems = items;

      if (activeDay.dayNumber === 1) {
        const applied = applyTripDayOneDateChange(
          stored.id,
          settings,
          items,
          dayGroups,
          newDate,
        );
        nextSettings = applied.settings;
        nextItems = applied.items;
      } else {
        const oldDates = dayGroups.map((d) => d.dateKey);
        const newDates = [...oldDates];
        newDates[activeDay.dayNumber - 1] = newDate;
        logTripDateEdited({
          tripId: stored.id,
          field: "day",
          oldDate: activeDay.dateKey,
          newDate,
          dayNumber: activeDay.dayNumber,
        });
        logTripDatesRecalculated({
          tripId: stored.id,
          oldDates,
          newDates,
          startDate: newDates[0],
          dayDates: newDates,
        });
        nextSettings = {
          ...settings,
          tripDayDates: newDates,
          tripStartDate: newDates[0],
          tripEndDate: newDates[newDates.length - 1],
        };
        nextItems = remapItemsToDateMap(items, oldDates, newDates);
      }

      void persistTripDateChange(nextSettings, nextItems);
    },
    [activeDay, stored.id, settings, items, dayGroups, persistTripDateChange],
  );

  useEffect(() => {
    setActiveDayIndex((prev) => (prev === safeDayIndex ? prev : safeDayIndex));
  }, [safeDayIndex]);

  const tripDatesInitRef = useRef(false);
  useEffect(() => {
    if (tripDatesInitRef.current || settings.tripDayDates?.length) return;
    const dates = dayGroups.map((d) => d.dateKey);
    if (dates.length === 0) return;
    tripDatesInitRef.current = true;
    setSettings((s) => {
      if (s.tripDayDates?.length) return s;
      return {
        ...s,
        tripDayDates: dates,
        tripStartDate: s.tripStartDate ?? dates[0],
        tripEndDate: s.tripEndDate ?? dates[dates.length - 1],
      };
    });
  }, [settings.tripDayDates, dayGroups]);

  const scrollToDay = (index: number) => {
    setActiveDayIndex(index);
  };

  const persistItems = useCallback((next: RoamieItineraryItem[]) => {
    setItems(next);
  }, []);

  const buildPayloadFromItems = useCallback(
    (nextItems: RoamieItineraryItem[], nextSettings: TripPlanSettings = settings) =>
      buildStableEditorPayload(initialPayloadRef.current, {
        tripTitle: effectiveTitleRef.current,
        items: nextItems,
        settings: nextSettings,
        outfitAdvice,
        outfitAdviceInputKey,
        outfitExtras: outfitExtrasForPayload,
      }),
    [settings, outfitAdvice, outfitAdviceInputKey, outfitExtrasForPayload],
  );

  const [placeSaveBusy, setPlaceSaveBusy] = useState(false);

  const persistItineraryItemsToStorage = useCallback(
    async (
      nextItems: RoamieItineraryItem[],
      meta: { savedPlaceName: string; dayIndex: number; nextSettings?: TripPlanSettings },
    ): Promise<boolean> => {
      const nextSettings = meta.nextSettings ?? settings;
      const nextPayload = buildPayloadFromItems(nextItems, nextSettings);
      setPlaceSaveBusy(true);
      try {
        const updated = await saveTripItineraryAfterAddPlace(
          stored.id,
          nextPayload,
          meta.savedPlaceName,
        );
        if (!updated?.payload || !isRoamiePayloadV2(updated.payload)) {
          logTripAddPlaceSaveFailed({ error: "invalid_updated_payload" });
          return false;
        }
        initialPayloadRef.current = {
          ...updated.payload,
          title: effectiveTitleRef.current,
        };
        setItems([...(updated.payload.itinerary ?? [])]);
        seedCoreTripPersistedFingerprint(stored.id, initialPayloadRef.current, updated.mood);
        onStoredChange?.({
          ...updated,
          payload: initialPayloadRef.current,
          updated_at: updated.updated_at ?? new Date().toISOString(),
        });
        logTripAddPlaceRenderConfirmed({
          tripId: stored.id,
          placeName: meta.savedPlaceName,
          dayIndex: meta.dayIndex,
        });
        return true;
      } catch (e) {
        logTripAddPlaceSaveFailed({
          error: e instanceof Error ? e.message : "persist_failed",
        });
        return false;
      } finally {
        setPlaceSaveBusy(false);
      }
    },
    [stored.id, settings, buildPayloadFromItems, onStoredChange],
  );

  const handleAddDay = () => {
    if (dayGroups.length >= 14) {
      toast.error("行程最多 14 天");
      return;
    }
    try {
      const { start } = inferTripDates(items, settings);
      const currentDates = settings.tripDayDates?.length
        ? settings.tripDayDates
        : dayGroups.map((d) => d.dateKey);
      const nextIso = nextDayIsoAfter(items, currentDates[currentDates.length - 1] ?? start);
      const nextDates = [...currentDates, nextIso];
      const nextItems = addEmptyDay(items, nextIso);
      setSettings((s) => ({
        ...s,
        tripDayDates: nextDates,
        tripEndDate: nextIso,
        tripStartDate: s.tripStartDate ?? start,
      }));
      persistItems(nextItems);
      scrollToDay(nextDates.length - 1);
      toast.message(`已新增第 ${nextDates.length} 天`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新增天數失敗");
    }
  };

  const handleRemoveDay = (dateKey: string, dayNumber: number) => {
    const group = dayGroups.find((d) => d.dateKey === dateKey);
    const hasStops = (group?.items.length ?? 0) > 0;
    if (dayGroups.length <= 1) {
      toast.message("至少需要保留一天");
      return;
    }
    if (hasStops) {
      const ok = confirm(
        `第 ${dayNumber} 天還有 ${group!.items.length} 個地點，確定要刪除這一天嗎？`,
      );
      if (!ok) return;
    }
    try {
      const nextDates = dayGroups.filter((d) => d.dateKey !== dateKey).map((d) => d.dateKey);
      const nextItems = removeDay(items, dateKey);
      setSettings((s) => ({
        ...s,
        tripDayDates: nextDates,
        tripStartDate: nextDates[0],
        tripEndDate: nextDates[nextDates.length - 1],
      }));
      persistItems(nextItems);
      scrollToDay(Math.min(safeDayIndex, nextDates.length - 1));
      toast.message(`已刪除第 ${dayNumber} 天`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "刪除天數失敗");
    }
  };

  const closeAddPlace = useCallback(() => {
    setAddMenuDayIndex(null);
    setAddPlaceMode(null);
    addPlaceDateKeyRef.current = null;
  }, []);

  const handleDeleteStop = useCallback(
    async (dateKey: string, indexInDay: number, dayIndex: number, deletedPlaceName: string) => {
      if (placeSaveBusy) return;

      logTripDeletePlaceClicked({
        tripId: stored.id,
        dayIndex,
        deletedPlaceName,
      });

      const beforeCount = items.filter((i) => (i.date?.trim() || "") === dateKey).length;
      const nextItems = removeStopAt(items, dateKey, indexInDay);
      const afterCount = nextItems.filter((i) => (i.date?.trim() || "") === dateKey).length;

      logTripDeletePlaceMutation({
        tripId: stored.id,
        dayIndex,
        deletedPlaceName,
        beforeCount,
        afterCount,
      });

      persistItems(nextItems);

      const nextPayload = buildPayloadFromItems(nextItems);
      setPlaceSaveBusy(true);
      try {
        const { updated, stillExists } = await saveTripItineraryAfterDeletePlace(
          stored.id,
          nextPayload,
          deletedPlaceName,
        );
        if (!updated?.payload || !isRoamiePayloadV2(updated.payload) || stillExists) {
          logTripAddPlaceSaveFailed({ error: stillExists ? "delete_still_on_disk" : "invalid_payload" });
          persistItems(items);
          toast.error("刪除儲存失敗，請再試一次");
          return;
        }
        initialPayloadRef.current = {
          ...updated.payload,
          title: effectiveTitleRef.current,
        };
        setItems([...(updated.payload.itinerary ?? [])]);
        seedCoreTripPersistedFingerprint(stored.id, initialPayloadRef.current, updated.mood);
        onStoredChange?.({
          ...updated,
          payload: initialPayloadRef.current,
          updated_at: updated.updated_at ?? new Date().toISOString(),
        });
        toast.message("已刪除地點");
      } catch (e) {
        logTripDeletePlaceSaveFailed({
          error: e instanceof Error ? e.message : "delete_failed",
        });
        persistItems(items);
        toast.error("刪除儲存失敗，請再試一次");
      } finally {
        setPlaceSaveBusy(false);
      }
    },
    [
      placeSaveBusy,
      items,
      stored.id,
      persistItems,
      buildPayloadFromItems,
      onStoredChange,
    ],
  );

  const handleAddStop = useCallback(
    async (
      dateKey: string,
      place: Parameters<typeof tripPlaceToItineraryItem>[0],
      dayIndex: number,
    ) => {
      if (placeSaveBusy) return;

      logTripAddPlaceSelected({
        placeName: place.name,
        placeId: place.googlePlaceId ?? "",
        activeDayIndex: dayIndex,
      });
      logTripAddPlaceDetailsReady({
        placeName: place.name,
        hasPlaceId: Boolean(place.googlePlaceId?.trim()),
        hasLatLng: place.lat != null && place.lng != null,
        hasAddress: Boolean(place.address?.trim()),
      });

      const resolvedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
        ? dateKey
        : inferTripDates(items, settings).start;
      const stop = tripPlaceToItineraryItem(place, {
        date: resolvedDate,
        time: settings.startTime ?? "10:00",
      });

      const beforeCount = items.filter((i) => (i.date?.trim() || "") === resolvedDate).length;
      logTripAddPlaceAppendStart({
        tripId: stored.id,
        dayIndex,
        beforeCount,
      });

      const nextItems = insertStopOnDate(items, stop, {
        date: stop.date,
        position: "end",
      });
      const afterCount = nextItems.filter((i) => (i.date?.trim() || "") === resolvedDate).length;

      persistItems(nextItems);
      logTripAddPlaceAppendSuccess({
        tripId: stored.id,
        dayIndex,
        afterCount,
      });

      const ok = await persistItineraryItemsToStorage(nextItems, {
        savedPlaceName: place.name,
        dayIndex,
      });
      if (!ok) {
        persistItems(items);
        toast.error("地點儲存失敗，請再試一次");
        return;
      }

      closeAddPlace();
      toast.success("已新增地點");
    },
    [
      placeSaveBusy,
      items,
      settings,
      stored.id,
      persistItems,
      persistItineraryItemsToStorage,
      closeAddPlace,
    ],
  );

  const handleAddStopsFromFavorites = useCallback(
    async (places: Parameters<typeof tripPlaceToItineraryItem>[0][]) => {
      const dateKey = addPlaceDateKeyRef.current;
      if (!dateKey || places.length === 0 || placeSaveBusy) return;
      const dayIndex = addMenuDayIndex ?? safeDayIndex;
      let nextItems = items;
      for (const place of places) {
        const stop = tripPlaceToItineraryItem(place, {
          date: /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
            ? dateKey
            : inferTripDates(items, settings).start,
          time: settings.startTime ?? "10:00",
        });
        nextItems = insertStopOnDate(nextItems, stop, { date: stop.date, position: "end" });
      }
      persistItems(nextItems);
      const label = places.length === 1 ? places[0]!.name : `${places.length} 個地點`;
      const ok = await persistItineraryItemsToStorage(nextItems, {
        savedPlaceName: label,
        dayIndex,
      });
      if (!ok) {
        persistItems(items);
        toast.error("地點儲存失敗，請再試一次");
        return;
      }
      closeAddPlace();
      toast.success(`已加入 ${places.length} 個地點`);
    },
    [
      items,
      settings,
      placeSaveBusy,
      addMenuDayIndex,
      safeDayIndex,
      persistItems,
      persistItineraryItemsToStorage,
      closeAddPlace,
    ],
  );

  const openAddPlaceMenu = useCallback(
    (dayIndex: number, dateKey: string) => {
      console.log("[TRIP_ADD_PLACE] open");
      addPlaceDateKeyRef.current = dateKey;
      setAddMenuDayIndex(dayIndex);
      setAddPlaceMode("menu");
    },
    [],
  );

  const handleAddPlaceModeSelect = useCallback(
    (mode: "favorites" | "manual" | "roamie") => {
      console.log("[TRIP_ADD_PLACE] mode=", mode);
      if (mode === "favorites") {
        setSavedPlacesOpen(true);
        setAddPlaceMode(null);
        return;
      }
      if (mode === "roamie") {
        setRoamiePlanOpen(true);
        setAddPlaceMode(null);
        return;
      }
      setAddPlaceMode("manual");
    },
    [],
  );

  const patchSettings = (patch: Partial<TripPlanSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  };

  const setLegMinutes = (key: string, minutes: number) => {
    patchSettings({ legMinutes: { ...settings.legMinutes, [key]: minutes } });
  };

  const setLegTransport = (key: string, label: string) => {
    patchSettings({ legTransport: { ...settings.legTransport, [key]: label } });
  };

  const refreshTransit = useCallback(async () => {
    const withCoords = items.filter((i) => i.lat != null && i.lng != null);
    if (withCoords.length < 2) return;

    setTransitLoading(true);
    try {
      const transitLegs = await syncTripLegsFromGoogleRoutes(items, settings);
      patchSettings({ transitLegs });
    } catch (e) {
      console.warn("[SavedTripItineraryEditor] Google Routes leg sync failed", e);
    } finally {
      setTransitLoading(false);
    }
  }, [items, settings]);

  const transitSyncedRef = useRef(false);
  useEffect(() => {
    transitSyncedRef.current = false;
  }, [stored.id]);

  useEffect(() => {
    if (transitSyncedRef.current) return;
    if (skipInitialTransitFetch.current) {
      skipInitialTransitFetch.current = false;
      transitSyncedRef.current = true;
      return;
    }
    const withCoords = items.filter((i) => i.lat != null && i.lng != null);
    if (withCoords.length < 2) {
      transitSyncedRef.current = true;
      return;
    }
    transitSyncedRef.current = true;
    const timer = window.setTimeout(() => {
      void refreshTransit();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [stored.id, items, refreshTransit]);

  const commitTitle = useCallback(
    async (nextTitle: string) => {
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === tripTitle) {
        setEditingTitle(false);
        return;
      }
      setTripTitle(trimmed);
      setIsTitleCustomized(true);
      setEditingTitle(false);
      try {
        const updated = await updateTripMeta(stored.id, buildCustomTitlePatch(trimmed), {
          ...payload,
          title: trimmed,
        });
        if (updated) onStoredChange?.(updated);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "名稱更新失敗");
      }
    },
    [tripTitle, stored.id, payload, onStoredChange],
  );

  const handleCoverPick = (file: File) => {
    setCoverSheetOpen(false);
    setCoverCropFile(file);
  };

  const handleCoverUpload = async (blob: Blob) => {
    setCoverBusy(true);
    console.info("[IMAGE_UPLOAD] start");
    try {
      const url = await uploadTripCover(stored.id, blob);
      setCustomCoverImageUrl(url);
      setIsCoverCustomized(true);
      setCoverSource("upload");
      const updated = await updateTripMeta(stored.id, {
        ...buildCustomCoverPatch(url),
        cover_source: "custom",
        cover_query: null,
      });
      if (updated) onStoredChange?.(updated);
      setCoverCropFile(null);
      console.info("[IMAGE_UPLOAD] success url=", url);
      toast.success("封面已更新");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "封面上傳失敗";
      console.error("[IMAGE_UPLOAD] error=", msg);
      toast.error(`封面上傳失敗，請稍後再試（${msg}）`);
    } finally {
      setCoverBusy(false);
    }
  };

  const handleRegenerateCover = async () => {
    setCoverBusy(true);
    try {
      const updated = await regenerateTripCover(stored.id, payload);
      if (updated) {
        setAiCoverImageUrl(updated.cover_image);
        setCoverSource(updated.cover_source);
        onStoredChange?.(updated);
        toast.success("已重新生成推薦封面");
      }
      setCoverSheetOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "封面生成失敗");
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      <div className="relative shrink-0">
        <TripCoverImage
          displayCoverImage={tripView.displayCoverImage}
          coverImageUrl={tripView.coverImageUrl}
          customCoverImageUrl={customCoverImageUrl}
          aiGeneratedCoverImageUrl={aiCoverImageUrl}
          isCoverCustomized={isCoverCustomized}
          coverSource={coverSource}
          mood={payload.moodTag}
          loading={coverBusy}
          className="aspect-[16/9] w-full"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
        <div className="absolute left-3 top-3">
          <BackButton
            preferFallback
            onBack={handleTripBack}
            fallback={{ to: "/saved", search: { tab: "trips" } }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 backdrop-blur"
          />
        </div>
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {dateSaving || saving ? (
            <span className="flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
              <Loader2 className="h-3 w-3 animate-spin" />
              儲存中
            </span>
          ) : saveError ? (
            <span className="rounded-full bg-background/80 px-2 py-1 text-[11px] text-destructive backdrop-blur">
              儲存失敗
            </span>
          ) : TRIP_EDITOR_AUTO_SAVE_DISABLED ? null : (
            <span className="rounded-full bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
              已自動儲存
            </span>
          )}
          {headerRight}
        </div>
        <button
          type="button"
          onClick={() => setCoverSheetOpen(true)}
          disabled={coverBusy}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs backdrop-blur transition active:scale-[0.98] disabled:opacity-60"
        >
          {coverBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          更換封面
        </button>
      </div>

      <header className="shrink-0 border-b border-border bg-background/95 px-5 pb-3 pt-3 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">收藏行程</p>
        {editingTitle ? (
          <input
            autoFocus
            defaultValue={tripTitle}
            onBlur={(e) => void commitTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitTitle(e.currentTarget.value);
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-display text-[22px] leading-snug outline-none ring-clay/30 focus:ring-2"
          />
        ) : (
          <div className="mt-1 flex items-start gap-2">
            <h1 className="min-w-0 flex-1 font-display text-[22px] leading-snug">
              {tripView.displayTitle}
            </h1>
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
              aria-label="編輯行程名稱"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="mt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <Calendar className="h-3 w-3" />
            <RoamieDatePicker
              mode="range"
              variant="inline"
              value={{
                start: settings.tripStartDate ?? tripDatesForOutfit.start,
                end: settings.tripEndDate ?? tripDatesForOutfit.end,
              }}
              onChange={handleTripStartDateChange}
              title="調整行程日期"
            />
          </span>
        </div>

        {tripView.summary ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{tripView.summary}</p>
        ) : null}

        {outfitDisplay.mode === "trip_level" ? (
          <TripOutfitCard
            className="mt-4"
            destination={outfitDestinationLabel}
            dateRange={{
              start: settings.tripStartDate ?? tripDatesForOutfit.start,
              end: settings.tripEndDate ?? tripDatesForOutfit.end,
            }}
            weatherSummary={tripOutfitFields.weatherSummary ?? initial.weatherSummary}
            weatherSource={tripOutfitFields.weatherSource ?? initial.weatherSource}
            suggestion={
              tripOutfitSuggestion ||
              outfitDisplay.tripLevelAdvice?.narrative ||
              ""
            }
            loading={tripOutfitLoading && !tripOutfitSuggestion}
            errorMessage={tripOutfitError}
            outfitTags={tripOutfitFields.outfitTags ?? initial.outfitTags}
            weatherTempC={tripOutfitFields.weatherTempC ?? initial.weatherTempC}
            weatherFeelsLikeC={tripOutfitFields.weatherFeelsLikeC ?? initial.weatherFeelsLikeC}
            weatherCondition={tripOutfitFields.weatherCondition ?? initial.weatherCondition}
            weatherIconType={tripOutfitFields.weatherIconType ?? initial.weatherIconType}
            weatherIsDaytime={tripOutfitFields.weatherIsDaytime ?? initial.weatherIsDaytime}
            weatherPrecipPercent={
              tripOutfitFields.weatherPrecipPercent ?? initial.weatherPrecipPercent
            }
            outfitTier={tripOutfitFields.outfitTier ?? initial.outfitTier}
          />
        ) : null}

      </header>

      <div className="shrink-0 border-b border-border bg-background/90 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto no-scrollbar">
            {dayGroups.map((d, i) => (
              <button
                key={d.dateKey}
                type="button"
                onClick={() => scrollToDay(i)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-sm transition",
                  safeDayIndex === i
                    ? "bg-foreground text-background"
                    : "border border-border bg-card text-muted-foreground",
                )}
              >
                第 {d.dayNumber} 天
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleAddDay}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            新增一天
          </button>
        </div>
      </div>

      {activeDay ? (
        <div className="px-5 py-5 pb-10">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">第 {activeDay.dayNumber} 天</p>
              <RoamieDatePicker
                mode="single"
                variant="inline"
                value={activeDay.dateKey}
                onChange={handleActiveDayDateChange}
                title={`第 ${activeDay.dayNumber} 天日期`}
                className="mt-0.5 text-sm font-medium text-foreground/90"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatSavedTripDayLabel({
                  dayNumber: activeDay.dayNumber,
                  date: activeDay.dateKey,
                  items: [] as never[],
                })}
              </p>
            </div>
            {dayGroups.length > 1 ? (
              <button
                type="button"
                onClick={() => handleRemoveDay(activeDay.dateKey, activeDay.dayNumber)}
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                刪除此天
              </button>
            ) : null}
          </div>

          {outfitDisplay.mode === "daily_specific" ? (
            <DayOutfitCard
              className="mt-5"
              destination={outfitDestinationLabel}
              advice={adviceForActiveDay}
              loading={outfitLoading && !adviceForActiveDay}
              unavailable={!adviceForActiveDay && weatherUnavailable && !outfitLoading}
              unavailableMessage={outfitError ?? unavailableMessage}
            />
          ) : null}

          {activeDayAlert ? (
            <DailyOutfitAlertCard
              className="mt-5"
              dayNumber={activeDayAlert.dayNumber}
              message={activeDayAlert.message}
            />
          ) : null}

          {activeDay.items.length === 0 ? (
            <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
              這一天還沒有地點，點下方按鈕新增。
            </p>
          ) : (
            <div className="relative mt-4 space-y-0">
              {activeDay.items.map((item, i) => {
                const prev = i > 0 ? activeDay.items[i - 1] : null;
                const legKey = legKeyForItem(item);
                const transport =
                  settings.legTransport?.[legKey] ??
                  (settings.transport === "walk"
                    ? "步行"
                    : settings.transport === "drive"
                      ? "開車"
                      : settings.transport === "transit"
                        ? "大眾運輸"
                        : settings.transport === "scooter"
                          ? "機車"
                          : "步行");
                const transitKey =
                  prev != null
                    ? buildLegKey(prev.placeName || prev.title, item.placeName || item.title)
                    : null;
                const transit = transitKey ? settings.transitLegs?.[transitKey] : undefined;

                return (
                  <div key={`${activeDay.dateKey}-${legKey}-${i}`}>
                    <SavedTripEditableStopCard
                      tripId={stored.id}
                      tripDestination={
                        tripView.destination !== "尚未設定"
                          ? tripView.destination
                          : outfitDestination
                      }
                      dayNumber={activeDay.dayNumber}
                      sameDayStopNames={activeDay.items
                        .map((s) => (s.placeName || s.title || "").trim())
                        .filter((n) => n && n !== (item.placeName || item.title || "").trim())}
                      item={item}
                      indexInDay={i}
                      dayCount={activeDay.items.length}
                      settings={settings}
                      travelTimeLabel={
                        transitKey
                          ? formatLegTravelTimeLabel(transit, transport, {
                              loading: transitLoading,
                            })
                          : undefined
                      }
                      prevStopItem={prev ?? null}
                      onSetArrivalTime={(t) => {
                        const idx = items.indexOf(item);
                        if (idx < 0) return;
                        const next = [...items];
                        next[idx] = { ...item, time: t };
                        persistItems(next);
                      }}
                      onSetDurationMinutes={(m) => setLegMinutes(legKeyForItem(item), m)}
                      onSetTransport={(label) => {
                        setLegTransport(legKeyForItem(item), label);
                        void refreshTransit();
                      }}
                      onMoveUp={() =>
                        persistItems(moveStopInDay(items, activeDay.dateKey, i, -1))
                      }
                      onMoveDown={() =>
                        persistItems(moveStopInDay(items, activeDay.dateKey, i, 1))
                      }
                      onDelete={() =>
                        void handleDeleteStop(
                          activeDay.dateKey,
                          i,
                          safeDayIndex,
                          item.placeName || item.title || "地點",
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}

          {activeDay.items.length > 1 ? (
            <button
              type="button"
              onClick={() => persistItems(sortStopsInDayByTime(items, activeDay.dateKey))}
              className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              依時間重新排序
            </button>
          ) : null}

          <div className="mt-6 space-y-3">
            {addMenuDayIndex === activeDay.dayNumber - 1 && addPlaceMode ? (
              <TripAddPlacePanel
                mode={addPlaceMode}
                onSelectMode={handleAddPlaceModeSelect}
                onPickPlace={(place) => {
                  void handleAddStop(activeDay.dateKey, place, safeDayIndex);
                }}
                onCollapse={closeAddPlace}
                destination={outfitDestinationLabel}
                searchCenter={
                  outfitCoords.lat != null && outfitCoords.lng != null
                    ? { lat: outfitCoords.lat, lng: outfitCoords.lng }
                    : null
                }
              />
            ) : (
              <button
                type="button"
                onClick={() => openAddPlaceMenu(activeDay.dayNumber - 1, activeDay.dateKey)}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-border bg-card/60 py-3 text-sm text-foreground/80"
              >
                <Plus className="h-4 w-4" />
                新增地點
              </button>
            )}
          </div>
        </div>
      ) : null}

      <SavedPlacesPickSheet
        open={savedPlacesOpen}
        onOpenChange={setSavedPlacesOpen}
        multiSelect
        onConfirm={handleAddStopsFromFavorites}
      />

      <TripRoamiePlanSheet
        open={roamiePlanOpen}
        onOpenChange={setRoamiePlanOpen}
        tripTitle={tripTitle}
        dayLabel={activeDay ? `第 ${activeDay.dayNumber} 天` : "行程"}
        existingStopNames={activeDay?.items.map((i) => i.placeName || i.title) ?? []}
        onAddPlace={(place) => {
          const dk = addPlaceDateKeyRef.current ?? activeDay?.dateKey;
          if (dk) void handleAddStop(dk, place, safeDayIndex);
        }}
      />

      <TripCoverSheet
        open={coverSheetOpen}
        onOpenChange={setCoverSheetOpen}
        onPickFile={handleCoverPick}
        onRegenerate={() => void handleRegenerateCover()}
        regenerating={coverBusy}
      />

      <ProfileImageCropSheet
        open={coverCropFile != null}
        file={coverCropFile}
        variant="cover"
        applying={coverBusy}
        onOpenChange={(open) => {
          if (!open && !coverBusy) setCoverCropFile(null);
        }}
        onConfirm={(blob) => handleCoverUpload(blob)}
        doneLabel="套用"
      />
    </div>
  );
}
