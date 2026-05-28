import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Calendar,
  Camera,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Route as RouteIcon,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { TripCoverImage } from "@/components/media/TripCoverImage";
import { SavedPlacesPickSheet } from "@/components/saved/SavedPlacesPickSheet";
import { TripAddPlacePanel, type TripAddPlaceMode } from "@/components/saved/TripAddPlacePanel";
import { TripRoamiePlanSheet } from "@/components/saved/TripRoamiePlanSheet";
import { SavedTripEditableStopCard } from "@/components/saved/SavedTripEditableStopCard";
import { TripOutfitCard } from "@/components/saved/TripOutfitCard";
import { TripCoverSheet } from "@/components/saved/TripCoverSheet";
import { ProfileImageCropSheet } from "@/components/profile/ProfileImageCropSheet";
import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import {
  formatSavedTripDateRange,
  formatSavedTripDayLabel,
  normalizeStoredTrip,
} from "@/lib/saved-trip/normalize";
import { useDebouncedTripSave } from "@/lib/saved-trip/use-debounced-trip-save";
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
import { daysBetweenDates } from "@/lib/fetch-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";
import { useTripOutfitSuggestion } from "@/hooks/use-trip-outfit-suggestion";
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
  const today = new Date().toISOString().slice(0, 10);
  return { start: today, end: today };
}

type DayGroup = { dateKey: string; dayNumber: number; items: RoamieItineraryItem[] };

function buildDayGroups(items: RoamieItineraryItem[], settings: TripPlanSettings): DayGroup[] {
  const { start } = inferTripDates(items, settings);
  const explicit = (settings.tripDayDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const dayCount = Math.max(
    1,
    daysBetweenDates(settings.tripStartDate ?? start, settings.tripEndDate ?? start),
    listTripDateKeys(items, start).length,
    explicit.length,
  );
  const dateKeys =
    explicit.length > 0 ? explicit : listTripDates(items, start, dayCount);
  const groups = groupStopsByDate(items);
  return dateKeys.map((dateKey, i) => ({
    dateKey,
    dayNumber: i + 1,
    items: groups.get(dateKey) ?? [],
  }));
}

type Props = {
  stored: StoredItinerary;
  headerRight?: React.ReactNode;
  onStoredChange?: (stored: StoredItinerary) => void;
};

export function SavedTripItineraryEditor({ stored, headerRight, onStoredChange }: Props) {
  const initial = stored.payload as RoamiePayloadV2;
  const initialView = useMemo(() => normalizeStoredTrip(stored), [stored]);
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
  const [settings, setSettings] = useState<TripPlanSettings>(
    () =>
      initial.tripSettings ?? {
        startTime: initial.itinerary[0]?.time?.slice(0, 5) ?? "10:00",
        transport: "walk",
        legMinutes: {},
        legTransport: {},
      },
  );
  const [items, setItems] = useState<RoamieItineraryItem[]>(() => [...initial.itinerary]);
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
  const tripDatesForOutfit = useMemo(() => inferTripDates(items, settings), [items, settings]);
  const outfitDestination = useMemo(
    () =>
      resolveTripDestination({
        destination: initial.destination,
        destinationLocation: initial.destinationLocation,
        itinerary: items,
      }),
    [initial.destination, initial.destinationLocation, items],
  );

  const firstWithCoords = items.find((i) => i.lat != null && i.lng != null);
  const tripCenter = firstWithCoords
    ? { lat: firstWithCoords.lat!, lng: firstWithCoords.lng! }
    : undefined;

  const { loading: outfitLoading, outfitFields, outfitError } = useTripOutfitSuggestion({
    initialFields: {
      outfitSuggestion: initial.outfitSuggestion,
      outfitSuggestionUpdatedAt: initial.outfitSuggestionUpdatedAt,
      weatherSummary: initial.weatherSummary,
      weatherSource: initial.weatherSource,
      outfitSuggestionInputKey: initial.outfitSuggestionInputKey,
    },
    items,
    settings,
    destination: outfitDestination,
    fallbackDestination: initial.destination,
    destinationLocation: initial.destinationLocation,
    dateRange: {
      start: settings.tripStartDate ?? tripDatesForOutfit.start,
      end: settings.tripEndDate ?? tripDatesForOutfit.end,
    },
    dayCount: dayGroups.length,
    tripCenter,
    moodTag: initial.moodTag,
  });

  const payload = useMemo<RoamiePayloadV2>(
    () => ({
      ...initial,
      title: tripTitle,
      itinerary: items,
      tripSettings: settings,
      recommendations: [],
      ...outfitFields,
    }),
    [initial, tripTitle, items, settings, outfitFields],
  );

  const { saving, saveError } = useDebouncedTripSave(stored.id, payload, true);
  const tripView = useMemo(() => {
    const autoTitle = resolveTripTitle(payload);
    const view = normalizeStoredTrip({
      ...stored,
      title: isTitleCustomized ? stored.title : autoTitle,
      custom_title: isTitleCustomized ? tripTitle : stored.custom_title,
      is_title_customized: isTitleCustomized,
      cover_image: aiCoverImageUrl,
      custom_cover_image_url: customCoverImageUrl,
      is_cover_customized: isCoverCustomized,
      cover_image_url: customCoverImageUrl,
      cover_source: coverSource as StoredItinerary["cover_source"],
      payload,
    });
    if (!isTitleCustomized) {
      return { ...view, title: autoTitle, displayTitle: autoTitle };
    }
    return { ...view, displayTitle: tripTitle };
  }, [
    stored,
    tripTitle,
    isTitleCustomized,
    customCoverImageUrl,
    aiCoverImageUrl,
    isCoverCustomized,
    coverSource,
    payload,
  ]);

  useEffect(() => {
    if (!isTitleCustomized) {
      setTripTitle(tripView.displayTitle);
    }
  }, [tripView.displayTitle, isTitleCustomized]);

  useEffect(() => {
    const stamp = stored.updated_at ?? stored.created_at;
    if (stamp === coverSyncRef.current) return;
    coverSyncRef.current = stamp;
    const view = normalizeStoredTrip(stored);
    setCustomCoverImageUrl(view.customCoverImageUrl);
    setAiCoverImageUrl(view.aiGeneratedCoverImageUrl);
    setIsCoverCustomized(view.isCoverCustomized);
    setCoverSource(stored.cover_source);
  }, [stored]);

  const safeDayIndex = Math.min(activeDayIndex, Math.max(0, dayGroups.length - 1));
  const activeDay = dayGroups[safeDayIndex];

  useEffect(() => {
    if (safeDayIndex !== activeDayIndex) {
      setActiveDayIndex(safeDayIndex);
    }
  }, [safeDayIndex, activeDayIndex]);

  const tripDatesInitRef = useRef(false);
  useEffect(() => {
    if (tripDatesInitRef.current || settings.tripDayDates?.length) return;
    const dates = dayGroups.map((d) => d.dateKey);
    if (dates.length === 0) return;
    tripDatesInitRef.current = true;
    setSettings((s) => ({
      ...s,
      tripDayDates: dates,
      tripStartDate: s.tripStartDate ?? dates[0],
      tripEndDate: s.tripEndDate ?? dates[dates.length - 1],
    }));
  }, [settings.tripDayDates, dayGroups]);

  const scrollToDay = (index: number) => {
    setActiveDayIndex(index);
  };

  const persistItems = useCallback((next: RoamieItineraryItem[]) => {
    setItems(next);
  }, []);

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

  const handleAddStop = (
    dateKey: string,
    place: Parameters<typeof tripPlaceToItineraryItem>[0],
  ) => {
    const stop = tripPlaceToItineraryItem(place, {
      date: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : inferTripDates(items, settings).start,
      time: settings.startTime ?? "10:00",
    });
    persistItems(insertStopOnDate(items, stop, { date: stop.date, position: "end" }));
    closeAddPlace();
    console.log("[TRIP_ADD_PLACE_SUCCESS]");
    toast.success("已新增地點");
  };

  const handleAddStopsFromFavorites = useCallback(
    (places: Parameters<typeof tripPlaceToItineraryItem>[0][]) => {
      const dateKey = addPlaceDateKeyRef.current;
      if (!dateKey || places.length === 0) return;
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
      closeAddPlace();
      console.log("[TRIP_ADD_PLACE_SUCCESS]");
      toast.success(`已加入 ${places.length} 個地點`);
    },
    [items, settings, persistItems, closeAddPlace],
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

  useEffect(() => {
    if (skipInitialTransitFetch.current) {
      skipInitialTransitFetch.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshTransit();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [refreshTransit]);

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
            fallback={{ to: "/saved", search: { tab: "trips" } }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 backdrop-blur"
          />
        </div>
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {saving ? (
            <span className="flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
              <Loader2 className="h-3 w-3 animate-spin" />
              儲存中
            </span>
          ) : saveError ? (
            <span className="rounded-full bg-background/80 px-2 py-1 text-[11px] text-destructive backdrop-blur">
              儲存失敗
            </span>
          ) : (
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

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <Calendar className="h-3 w-3" />
            {formatSavedTripDateRange(tripView)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <MapPin className="h-3 w-3" />
            {tripView.destination}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <Users className="h-3 w-3" />
            {tripView.companionCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <RouteIcon className="h-3 w-3" />
            {tripView.transportMode}
          </span>
          {tripView.isSaved ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2.5 py-1 text-clay">
              <Bookmark className="h-3 w-3 fill-current" />
              已收藏
            </span>
          ) : null}
        </div>

        {tripView.summary ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{tripView.summary}</p>
        ) : null}
      </header>

      <div className="shrink-0 px-5 pt-3">
        <TripOutfitCard
          destination={
            tripView.destination !== "尚未設定" ? tripView.destination : outfitDestination
          }
          dateRange={tripView.dateRange}
          weatherSummary={outfitFields.weatherSummary}
          weatherSource={outfitFields.weatherSource}
          suggestion={outfitFields.outfitSuggestion}
          loading={outfitLoading}
          errorMessage={outfitError}
          outfitTags={outfitFields.outfitTags}
          weatherTempC={outfitFields.weatherTempC}
          weatherFeelsLikeC={outfitFields.weatherFeelsLikeC}
          weatherCondition={outfitFields.weatherCondition}
          weatherIconType={outfitFields.weatherIconType}
          weatherIsDaytime={outfitFields.weatherIsDaytime}
          weatherPrecipPercent={outfitFields.weatherPrecipPercent}
          outfitTier={outfitFields.outfitTier}
        />
      </div>

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
            <h2 className="text-sm font-medium text-foreground/90">
              {formatSavedTripDayLabel({
                dayNumber: activeDay.dayNumber,
                date: activeDay.dateKey,
                items: [] as never[],
              })}
            </h2>
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
                      travelTimeLoading={transitLoading}
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
                      onDelete={() => persistItems(removeStopAt(items, activeDay.dateKey, i))}
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
                onPick={(place) => handleAddStop(activeDay.dateKey, place)}
                onCollapse={closeAddPlace}
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
          if (dk) handleAddStop(dk, place);
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
