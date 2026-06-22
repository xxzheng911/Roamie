import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { TripCoverImage } from "@/components/media/TripCoverImage";
import { SavedPlacesPickSheet } from "@/components/saved/SavedPlacesPickSheet";
import { SavedTripEditableStopCard } from "@/components/saved/SavedTripEditableStopCard";
import { TripLegTransportConnector } from "@/components/saved/TripLegTransportConnector";
import { TripTransportPicker } from "@/components/saved/TripTransportPicker";
import { TripOutfitCard } from "@/components/saved/TripOutfitCard";
import { ImageSourceSheet } from "@/components/ImageSourceSheet";
import { SharedImageCropEditor } from "@/components/media/SharedImageCropEditor";
import { readBlobImageSize, readFileImageSize, type CropTransform } from "@/lib/image-crop";
import { IMAGE_CROP_VARIANTS } from "@/lib/image-crop-variants";
import { withCacheBust } from "@/lib/media-display-url";
import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import {
  normalizeStoredTrip,
} from "@/lib/saved-trip/normalize";
import { RoamieDatePicker } from "@/components/pickers";
import {
  applyTripDateRange,
  countTripDateRangeOverflow,
  inferTripDatesForRange,
  resolveTripDateRangeChange,
  scheduledDateKeysFromSettings,
  syncSettingsAfterRemoveDay,
  TRIP_UNASSIGNED_DATE,
  updateSingleDayDate,
} from "@/lib/saved-trip/apply-trip-date-range";
import { useDebouncedTripSave } from "@/lib/saved-trip/use-debounced-trip-save";
import { cn } from "@/lib/utils";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import type { TripOutfitSuggestionFields } from "@/lib/outfit/types";
import { updateItinerary, updateTripMeta } from "@/lib/itinerary-storage";
import { buildCustomCoverPatch, buildCustomTitlePatch } from "@/lib/saved-trip/display";
import { formatLegTravelTimeLabel, formatLegWalkFallbackHint } from "@/lib/saved-trip/travel-time";
import {
  isJapanTransitMapsLeg,
  openJapanTransitLegInGoogleMaps,
} from "@/lib/saved-trip/japan-transit-maps";
import {
  applyGlobalTransportLabel,
  resolveDayTransportLabel,
  resolveLegTransportLabel,
  logLegEffectiveTransport,
  legDestKeysForDay,
  type TripTransportOptionLabel,
} from "@/lib/saved-trip/transport-options";
import {
  syncTripLegsFromGoogleRoutes,
  syncSingleTripLegFromGoogleRoutes,
  transitLegsCoverCurrentItems,
} from "@/lib/saved-trip/sync-route-legs";
import { invalidateScopedRouteCacheForLeg, clearScopedRouteCache } from "@/lib/saved-trip/route-duration-service";
import { clearRouteDurationCache } from "@/lib/route-duration-cache";
import { logDirectionsDebug, resetDirectionsDebugLog } from "@/lib/directions-debug-log";
import { resolveDirectionsRegion } from "@/lib/directions-endpoint";
import { travelLabelToRoutesMode } from "@/services/routesService";
import {
  recalculateAllArrivalTimes,
  recalculateDayArrivalTimesInItems,
} from "@/lib/saved-trip/recalculate-arrival-times";
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
  updateStop,
} from "@/lib/trip/trip-stop-mutations";
import { tripPlaceToItineraryItem } from "@/lib/trip/trip-place-input";
import { resolveTripTitle } from "@/lib/trip/trip-title";
import { daysBetweenDates } from "@/lib/fetch-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";
import { useTripOutfitSuggestion } from "@/hooks/use-trip-outfit-suggestion";
import {
  buildFlightAffiliateOffers,
  buildHotelAffiliateOffers,
  buildPlaceTicketOffers,
  logTripAffiliateRuleCheck,
} from "@/lib/affiliate/affiliate-links";
import { buildTripAffiliateContext, parseTripTravelers, type AffiliateLinkOffer } from "@/lib/affiliate/affiliate-types";
import { resolveAffiliatePlanDates } from "@/lib/affiliate/trip-affiliate-dates";
import { TripAffiliateSection } from "@/components/trip/TripAffiliateSection";
import { useI18n } from "@/hooks/use-i18n";
import { geocodeTripLocationFromText } from "@/lib/location.functions";
import { resolveTripStop } from "@/lib/trip-stop-search.functions";
import { resolveTripStopCoords } from "@/lib/trip-stop-coords";
import {
  buildTripAddPlaceContext,
  writeTripAddPlaceHandoff,
} from "@/lib/trip/trip-add-place-handoff";

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

function placeAffiliateKey(item: RoamieItineraryItem): string {
  return `${item.placeType ?? ""}|${item.title}|${item.placeName ?? ""}|${item.description ?? ""}`;
}

/** 僅在路線相關輸入變更時重算；不含 lat/lng/time 避免 geocode / 抵達時間重算觸發迴圈 */
function buildRouteSyncSignature(items: RoamieItineraryItem[], settings: TripPlanSettings): string {
  const placeKeys = items
    .map(
      (i) =>
        `${i.date ?? ""}|${i.placeName || i.title}|${i.googlePlaceId ?? ""}`,
    )
    .join("|");
  return [
    placeKeys,
    settings.transport ?? "",
    settings.defaultTransportLabel ?? "",
    settings.tripStartDate ?? "",
    JSON.stringify(settings.dayTransportLabels ?? {}),
    JSON.stringify(settings.legTransport ?? {}),
  ].join("::");
}

function itemCoordKey(item: RoamieItineraryItem): string {
  return `${item.date ?? ""}|${item.placeName || item.title}`;
}

function routeModeLogLabel(label: string): string {
  const mode = travelLabelToRoutesMode(label);
  if (mode === "TRANSIT") return "TRANSIT";
  if (mode === "DRIVE") return "DRIVING";
  return "WALKING";
}

type RouteRefreshOverride = {
  items?: RoamieItineraryItem[];
  settings?: TripPlanSettings;
  onlyDateKey?: string;
};

type TripScheduleCommitMeta = {
  logDateChange?: boolean;
  oldStartDate?: string;
  newStartDate?: string;
};

function formatDaysDatesLog(
  nextItems: RoamieItineraryItem[],
  nextSettings: TripPlanSettings,
): string {
  const keys = scheduledDateKeysFromSettings(nextSettings);
  if (keys.length > 0) return keys.join(",");
  return [
    ...new Set(
      nextItems
        .map((i) => i.date?.trim())
        .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ]
    .sort()
    .join(",");
}

function initialOutfitFields(payload: RoamiePayloadV2): TripOutfitSuggestionFields {
  return {
    outfitSuggestion: payload.outfitSuggestion,
    outfitSuggestionUpdatedAt: payload.outfitSuggestionUpdatedAt,
    weatherSummary: payload.weatherSummary,
    weatherSource: payload.weatherSource,
    outfitSuggestionInputKey: payload.outfitSuggestionInputKey,
  };
}

type DayGroup = {
  dateKey: string;
  dayNumber: number;
  items: RoamieItineraryItem[];
  isUnassigned?: boolean;
};

function buildDayGroups(items: RoamieItineraryItem[], settings: TripPlanSettings): DayGroup[] {
  const { start } = inferTripDates(items, settings);
  const settingsDateKeys = scheduledDateKeysFromSettings(settings);
  const dayCount = Math.max(
    1,
    settingsDateKeys.length ||
      daysBetweenDates(settings.tripStartDate ?? start, settings.tripEndDate ?? start),
    listTripDateKeys(items, start).filter((k) => k !== TRIP_UNASSIGNED_DATE).length,
  );
  const dateKeys =
    settingsDateKeys.length > 0 ? settingsDateKeys : listTripDates(items, start, dayCount);
  const groups = groupStopsByDate(items);
  const scheduled: DayGroup[] = dateKeys.map((dateKey, i) => ({
    dateKey,
    dayNumber: i + 1,
    items: groups.get(dateKey) ?? [],
  }));
  const unassigned = groups.get(TRIP_UNASSIGNED_DATE) ?? [];
  if (unassigned.length > 0) {
    scheduled.push({
      dateKey: TRIP_UNASSIGNED_DATE,
      dayNumber: 0,
      items: unassigned,
      isUnassigned: true,
    });
  }
  return scheduled;
}

type Props = {
  stored: StoredItinerary;
  headerRight?: React.ReactNode;
  onStoredChange?: (stored: StoredItinerary) => void;
  /** 1-based day number from route search */
  initialDay?: number;
};

export function SavedTripItineraryEditor({ stored, headerRight, onStoredChange, initialDay }: Props) {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const geocodeLocationFn = useServerFn(geocodeTripLocationFromText);
  const resolveTripStopFn = useServerFn(resolveTripStop);
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [coverSheetOpen, setCoverSheetOpen] = useState(false);
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null);
  const [coverDisplayRevision, setCoverDisplayRevision] = useState(0);
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
  const [activeDayIndex, setActiveDayIndex] = useState(() =>
    initialDay != null && initialDay > 0 ? initialDay - 1 : 0,
  );
  const [savedPlacesOpen, setSavedPlacesOpen] = useState(false);
  const [addMenuDayIndex, setAddMenuDayIndex] = useState<number | null>(null);
  const [transitLoading, setTransitLoading] = useState(false);
  const [transitSettled, setTransitSettled] = useState(false);
  const itemsRef = useRef(items);
  const settingsRef = useRef(settings);
  const tripDetailRootRef = useRef<HTMLDivElement>(null);
  const tripCoverRef = useRef<HTMLDivElement>(null);
  const routeSyncInFlightRef = useRef(false);
  const lastRouteSyncSignatureRef = useRef("");
  const routeSyncMountedRef = useRef(true);
  itemsRef.current = items;
  settingsRef.current = settings;

  const [savedOutfitFields, setSavedOutfitFields] = useState<TripOutfitSuggestionFields>(() =>
    initialOutfitFields(initial),
  );

  const handleOutfitGenerated = useCallback((fields: TripOutfitSuggestionFields) => {
    setSavedOutfitFields(fields);
  }, []);

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

  const { loading: outfitLoading, outfitFields } = useTripOutfitSuggestion({
    initialFields: initialOutfitFields(initial),
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
    onGenerated: handleOutfitGenerated,
  });

  const payload = useMemo<RoamiePayloadV2>(() => {
    const dates = inferTripDates(items, settings);
    const dayCount = daysBetweenDates(
      settings.tripStartDate ?? dates.start,
      settings.tripEndDate ?? dates.end,
    );
    return {
      ...initial,
      title: tripTitle,
      itinerary: items,
      tripSettings: settings,
      days: dayCount,
      recommendations: [],
      ...savedOutfitFields,
    };
  }, [initial, tripTitle, items, settings, savedOutfitFields]);

  const buildPayload = useCallback(
    (nextItems: RoamieItineraryItem[], nextSettings: TripPlanSettings): RoamiePayloadV2 => {
      const dates = inferTripDates(nextItems, nextSettings);
      const dayCount = daysBetweenDates(
        nextSettings.tripStartDate ?? dates.start,
        nextSettings.tripEndDate ?? dates.end,
      );
      return {
        ...initial,
        title: tripTitle,
        itinerary: nextItems,
        tripSettings: nextSettings,
        days: dayCount,
        recommendations: [],
        ...savedOutfitFields,
      };
    },
    [initial, tripTitle, savedOutfitFields],
  );

  const { cancelPending, markSynced } = useDebouncedTripSave(stored.id, payload, true, {
    onSaved: onStoredChange,
  });
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

  const affiliateDayCount = dayGroups.filter((d) => !d.isUnassigned).length;
  const affiliateDestinationLabel =
    payload.destination?.trim() ||
    (tripView.destination !== "尚未設定" ? tripView.destination : outfitDestination);
  const affiliatePlanDates = resolveAffiliatePlanDates({
    tripStartDate: settings.tripStartDate,
    tripEndDate: settings.tripEndDate,
    dayCount: affiliateDayCount,
    itemDates: items.map((item) => item.date),
    viewStartDate: tripView.dateRange.start,
    viewEndDate: tripView.dateRange.end,
  });
  const affiliateStartDate = affiliatePlanDates.startDate;
  const affiliateEndDate = affiliatePlanDates.endDate;
  const affiliateTravelers = parseTripTravelers(payload);
  const affiliatePlacesSignature = useMemo(
    () => items.map((item) => placeAffiliateKey(item)).join("\n"),
    [items],
  );

  const affiliateTripCtx = useMemo(
    () =>
      buildTripAffiliateContext({
        tripId: stored.id,
        payload,
        items,
        dayCount: affiliateDayCount,
        destinationLabel: affiliateDestinationLabel,
        startDate: affiliateStartDate,
        endDate: affiliateEndDate,
        travelers: affiliateTravelers,
        locale,
      }),
    [
      stored.id,
      payload,
      items,
      affiliateDayCount,
      affiliateDestinationLabel,
      affiliateStartDate,
      affiliateEndDate,
      affiliateTravelers,
      locale,
    ],
  );

  const hotelAffiliateOffers = useMemo(
    () => buildHotelAffiliateOffers(affiliateTripCtx),
    [affiliateTripCtx],
  );

  const flightAffiliateOffers = useMemo(
    () => buildFlightAffiliateOffers(affiliateTripCtx),
    [affiliateTripCtx],
  );

  const directionsLocationContext = useMemo(() => {
    const loc = payload.destinationLocation ?? initial.destinationLocation;
    if (loc?.formattedName?.trim()) return loc.formattedName.trim();
    if (loc?.displayLabel?.trim()) return loc.displayLabel.trim();
    if (loc?.city?.trim() && loc?.country?.trim()) return `${loc.city.trim()}, ${loc.country.trim()}`;
    return affiliateDestinationLabel?.trim() || undefined;
  }, [payload.destinationLocation, initial.destinationLocation, affiliateDestinationLabel]);

  const directionsRegion = useMemo(
    () =>
      resolveDirectionsRegion(
        payload.destinationLocation?.country ??
          initial.destinationLocation?.country ??
          directionsLocationContext,
      ),
    [payload.destinationLocation, initial.destinationLocation, directionsLocationContext],
  );

  const placeTicketOffersByKey = useMemo(() => {
    const map = new Map<string, AffiliateLinkOffer[]>();
    const ticketCtx = {
      destinationLabel: affiliateDestinationLabel,
      destinationLocation: payload.destinationLocation ?? initial.destinationLocation ?? null,
      locale,
      tripCtx: affiliateTripCtx,
    };
    for (const item of items) {
      map.set(placeAffiliateKey(item), buildPlaceTicketOffers(item, ticketCtx));
    }
    return map;
  }, [
    affiliatePlacesSignature,
    affiliateDestinationLabel,
    affiliateTripCtx,
    payload.destinationLocation,
    initial.destinationLocation,
    locale,
    items,
  ]);

  useEffect(() => {
    logTripAffiliateRuleCheck(affiliateTripCtx, {
      showAgodaHotel: hotelAffiliateOffers.some((o) => o.provider === "agoda" && o.enabled),
      showTripHotel: hotelAffiliateOffers.some((o) => o.provider === "trip" && o.enabled),
      showTripFlight: flightAffiliateOffers.some((o) => o.provider === "trip" && o.enabled),
    });
  }, [affiliateTripCtx, hotelAffiliateOffers, flightAffiliateOffers]);

  const safeDayIndex = Math.min(activeDayIndex, Math.max(0, dayGroups.length - 1));
  const activeDay = dayGroups[safeDayIndex];

  const scrollToDay = (index: number) => {
    setActiveDayIndex(index);
  };

  const applyDayArrivalRecalc = useCallback(
    (
      nextItems: RoamieItineraryItem[],
      dateKey: string,
      anchorIndex = 0,
      nextSettings?: TripPlanSettings,
    ) =>
      recalculateDayArrivalTimesInItems(
        nextItems,
        dateKey,
        nextSettings ?? settingsRef.current,
        anchorIndex,
      ),
    [],
  );

  const persistItems = useCallback((next: RoamieItineraryItem[]) => {
    setItems(next);
  }, []);

  const commitTripSchedule = useCallback(
    (
      nextItems: RoamieItineraryItem[],
      nextSettings: TripPlanSettings,
      meta?: TripScheduleCommitMeta,
    ) => {
      const nextPayload = buildPayload(nextItems, nextSettings);
      cancelPending();

      if (meta?.logDateChange) {
        console.info(
          `[TRIP_DATE_CHANGE_REQUEST] oldStartDate=${meta.oldStartDate ?? ""} newStartDate=${meta.newStartDate ?? nextSettings.tripStartDate ?? ""} tripId=${stored.id}`,
        );
      }

      setItems(nextItems);
      setSettings(nextSettings);
      itemsRef.current = nextItems;
      settingsRef.current = nextSettings;

      void updateItinerary(stored.id, nextPayload)
        .then((updated) => {
          markSynced(nextPayload);
          if (updated) onStoredChange?.(updated);
          if (meta?.logDateChange) {
            console.info(
              `[TRIP_DATE_CHANGE_SAVED] tripId=${stored.id} startDate=${nextSettings.tripStartDate ?? ""} endDate=${nextSettings.tripEndDate ?? ""} daysDates=${formatDaysDatesLog(nextItems, nextSettings)}`,
            );
          }
        })
        .catch((e) => {
          console.error("[TRIP_DATE_SAVE] failed", e);
          toast.error(e instanceof Error ? e.message : "行程日期儲存失敗");
        });
    },
    [stored.id, buildPayload, onStoredChange, cancelPending, markSynced],
  );

  const handleAddDay = () => {
    const { start } = inferTripDates(items, settings);
    const nextIso = nextDayIsoAfter(items, start);
    const scheduledDayCount = dayGroups.filter((d) => !d.isUnassigned).length;
    const nextSettings: TripPlanSettings = {
      ...settings,
      tripEndDate: nextIso,
      tripStartDate: settings.tripStartDate ?? start,
    };
    const nextItems = addEmptyDay(items, nextIso);
    commitTripSchedule(nextItems, nextSettings, {
      logDateChange: true,
      oldStartDate: settings.tripStartDate ?? start,
      newStartDate: nextSettings.tripStartDate ?? start,
    });
    scrollToDay(scheduledDayCount);
    toast.message(`已新增第 ${scheduledDayCount + 1} 天`);
  };

  const handleRemoveDay = (dateKey: string, dayNumber: number) => {
    const group = dayGroups.find((d) => d.dateKey === dateKey);
    const hasStops = (group?.items.length ?? 0) > 0;
    const scheduledDayCount = dayGroups.filter((d) => !d.isUnassigned).length;
    if (scheduledDayCount <= 1) {
      toast.message("至少需要保留一天");
      return;
    }
    if (hasStops) {
      const ok = confirm(
        `第 ${dayNumber} 天還有 ${group!.items.length} 個地點，確定要刪除這一天嗎？`,
      );
      if (!ok) return;
    }
    const nextItems = removeDay(items, dateKey);
    const nextSettings: TripPlanSettings = {
      ...settings,
      ...syncSettingsAfterRemoveDay(settings, scheduledDayCount),
    };
    commitTripSchedule(nextItems, nextSettings, {
      logDateChange: true,
      oldStartDate: settings.tripStartDate,
      newStartDate: nextSettings.tripStartDate,
    });
    scrollToDay(Math.max(0, safeDayIndex - 1));
    toast.message(`已刪除第 ${dayNumber} 天`);
  };

  const handleAddStop = (
    dateKey: string,
    place: Parameters<typeof tripPlaceToItineraryItem>[0],
  ) => {
    const stop = tripPlaceToItineraryItem(place, {
      date: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : inferTripDates(items, settings).start,
      time: settings.startTime ?? "10:00",
    });
    persistItems(
      applyDayArrivalRecalc(
        insertStopOnDate(items, stop, { date: stop.date, position: "end" }),
        stop.date,
        0,
      ),
    );
    setAddMenuDayIndex(null);
    toast.success("已新增地點");
  };

  const patchSettings = (patch: Partial<TripPlanSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  };

  const setLegMinutes = (key: string, minutes: number) => {
    setSettings((s) => {
      const nextSettings: TripPlanSettings = {
        ...s,
        legMinutes: { ...s.legMinutes, [key]: minutes },
      };
      setItems((prev) => {
        const groups = groupStopsByDate(prev);
        let nextItems = prev;
        for (const [dateKey, dayItems] of groups) {
          const anchorIndex = dayItems.findIndex((i) => legKeyForItem(i) === key);
          if (anchorIndex >= 0) {
            nextItems = recalculateDayArrivalTimesInItems(
              nextItems,
              dateKey,
              nextSettings,
              anchorIndex,
            );
          }
        }
        return nextItems;
      });
      return nextSettings;
    });
  };

  const resolveStopCoords = useCallback(
    async (item: RoamieItineraryItem) =>
      resolveTripStopCoords(item, {
        locale,
        resolveStopFn: resolveTripStopFn,
        geocodeFn: geocodeLocationFn,
      }),
    [geocodeLocationFn, resolveTripStopFn, locale],
  );

  const refreshTransit = useCallback(
    async (force = false, override?: RouteRefreshOverride) => {
      if (!routeSyncMountedRef.current) return;

      const currentItems = override?.items ?? itemsRef.current;
      const currentSettings = override?.settings ?? settingsRef.current;
      if (currentItems.length < 2) {
        logDirectionsDebug("skipped", {
          skippedReason: "fewer_than_two_stops",
        });
        setTransitSettled(true);
        return;
      }

      const signature = buildRouteSyncSignature(currentItems, currentSettings);
      if (!force) {
        if (routeSyncInFlightRef.current) {
          logDirectionsDebug("skipped", { skippedReason: "sync_in_flight" });
          return;
        }
        if (
          signature === lastRouteSyncSignatureRef.current &&
          transitLegsCoverCurrentItems(currentItems, currentSettings, { directionsRegion })
        ) {
          logDirectionsDebug("skipped", { skippedReason: "legs_already_covered" });
          setTransitSettled(true);
          return;
        }
      }

      if (force) {
        resetDirectionsDebugLog();
      }

      logDirectionsDebug("sync start", {
        force,
        mode: currentSettings.transport ?? "walk",
        provider: "refreshTransit",
      });

      routeSyncInFlightRef.current = true;
      setTransitLoading(true);
      const resolvedCoords = new Map<string, { lat: number; lng: number }>();

      try {
        const transitLegs = await syncTripLegsFromGoogleRoutes(currentItems, currentSettings, {
          tripId: stored.id,
          resolveCoords: resolveStopCoords,
          onCoordsResolved: (item, coords) => {
            resolvedCoords.set(itemCoordKey(item), coords);
          },
          force,
          onlyDateKey: override?.onlyDateKey,
          locationContext: directionsLocationContext,
          directionsRegion,
        });

        if (!routeSyncMountedRef.current) return;

        let nextItems = currentItems;
        if (resolvedCoords.size > 0) {
          nextItems = currentItems.map((i) => {
            const coords = resolvedCoords.get(itemCoordKey(i));
            return coords ? { ...i, lat: coords.lat, lng: coords.lng } : i;
          });
        }

        const mergedTransitLegs = { ...transitLegs };
        const mergedSettings: TripPlanSettings = {
          ...currentSettings,
          transitLegs: mergedTransitLegs,
        };
        const itemsWithTimes = recalculateAllArrivalTimes(nextItems, mergedSettings);

        setItems(itemsWithTimes);
        setSettings(mergedSettings);
        itemsRef.current = itemsWithTimes;
        settingsRef.current = mergedSettings;
        lastRouteSyncSignatureRef.current = buildRouteSyncSignature(itemsWithTimes, mergedSettings);
      } catch (e) {
        console.warn("[SavedTripItineraryEditor] Google Routes leg sync failed", e);
      } finally {
        routeSyncInFlightRef.current = false;
        if (routeSyncMountedRef.current) {
          setTransitLoading(false);
          setTransitSettled(true);
        }
      }
    },
    [resolveStopCoords, directionsLocationContext, directionsRegion, stored.id],
  );

  const refreshSingleLeg = useCallback(
    async (legKey: string, override?: RouteRefreshOverride) => {
      if (!routeSyncMountedRef.current) return;

      const currentItems = override?.items ?? itemsRef.current;
      const currentSettings = override?.settings ?? settingsRef.current;

      routeSyncInFlightRef.current = true;
      setTransitLoading(true);
      const resolvedCoords = new Map<string, { lat: number; lng: number }>();

      try {
        const leg = await syncSingleTripLegFromGoogleRoutes(
          currentItems,
          currentSettings,
          legKey,
          {
            tripId: stored.id,
            resolveCoords: resolveStopCoords,
            onCoordsResolved: (item, coords) => {
              resolvedCoords.set(itemCoordKey(item), coords);
            },
            force: true,
            locationContext: directionsLocationContext,
            directionsRegion,
          },
        );

        if (!routeSyncMountedRef.current || !leg) return;

        let nextItems = currentItems;
        if (resolvedCoords.size > 0) {
          nextItems = currentItems.map((i) => {
            const coords = resolvedCoords.get(itemCoordKey(i));
            return coords ? { ...i, lat: coords.lat, lng: coords.lng } : i;
          });
        }

        const mergedSettings: TripPlanSettings = {
          ...currentSettings,
          transitLegs: { ...currentSettings.transitLegs, [legKey]: leg },
        };
        const itemsWithTimes = recalculateAllArrivalTimes(nextItems, mergedSettings);

        setItems(itemsWithTimes);
        setSettings(mergedSettings);
        itemsRef.current = itemsWithTimes;
        settingsRef.current = mergedSettings;
      } catch (e) {
        console.warn("[SavedTripItineraryEditor] single leg sync failed", e);
      } finally {
        routeSyncInFlightRef.current = false;
        if (routeSyncMountedRef.current) {
          setTransitLoading(false);
          setTransitSettled(true);
        }
      }
    },
    [resolveStopCoords, directionsLocationContext, directionsRegion, stored.id],
  );

  const applyTransportModeChange = useCallback(
    (
      label: TripTransportOptionLabel,
      scope: "day" | "leg",
      opts?: {
        dateKey?: string;
        dayIndex?: number;
        legDestKey?: string;
        transitSegKey?: string;
        legIndex?: number;
      },
    ) => {
      const prevSettings = settingsRef.current;
      const prevItems = itemsRef.current;

      if (scope === "day") {
        const dateKey = opts?.dateKey;
        const dayIndex = opts?.dayIndex ?? 0;
        if (!dateKey) return;

        const dayItems = groupStopsByDate(prevItems).get(dateKey) ?? [];
        const legDestKeys = legDestKeysForDay(dayItems);
        const nextLegTransport = { ...(prevSettings.legTransport ?? {}) };
        for (const key of legDestKeys) {
          delete nextLegTransport[key];
        }

        const nextTransitLegs = { ...(prevSettings.transitLegs ?? {}) };
        for (let i = 1; i < dayItems.length; i++) {
          const prev = dayItems[i - 1]!;
          const curr = dayItems[i]!;
          delete nextTransitLegs[buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title)];
        }

        const nextSettings: TripPlanSettings = {
          ...prevSettings,
          ...applyGlobalTransportLabel(label),
          dayTransportLabels: {
            ...(prevSettings.dayTransportLabels ?? {}),
            [dateKey]: label,
          },
          legTransport: nextLegTransport,
          transitLegs: nextTransitLegs,
        };

        clearRouteDurationCache();
        clearScopedRouteCache();
        lastRouteSyncSignatureRef.current = "";

        const nextItems = recalculateDayArrivalTimesInItems(prevItems, dateKey, nextSettings, 0);
        itemsRef.current = nextItems;
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        setItems(nextItems);
        setTransitSettled(false);
        setTransitLoading(true);

        const affectedLegCount = Math.max(0, dayItems.length - 1);
        console.info(
          `[TRIP_TRANSPORT_DEFAULT_CHANGED] dayIndex=${dayIndex} mode=${routeModeLogLabel(label)} affectedLegCount=${affectedLegCount}`,
        );

        void refreshTransit(true, {
          items: nextItems,
          settings: nextSettings,
          onlyDateKey: dateKey,
        });
        return;
      }

      const legDestKey = opts?.legDestKey;
      const transitSegKey = opts?.transitSegKey;
      const dayIndex = opts?.dayIndex ?? 0;
      const legIndex = opts?.legIndex ?? 0;
      const dateKey = opts?.dateKey;
      if (!legDestKey || !transitSegKey || !dateKey) return;

      invalidateScopedRouteCacheForLeg(stored.id, transitSegKey);

      const nextTransitLegs = { ...(prevSettings.transitLegs ?? {}) };
      delete nextTransitLegs[transitSegKey];
      const nextSettings: TripPlanSettings = {
        ...prevSettings,
        legTransport: { ...prevSettings.legTransport, [legDestKey]: label },
        transitLegs: nextTransitLegs,
      };

      const nextItems = recalculateDayArrivalTimesInItems(prevItems, dateKey, nextSettings, 0);
      itemsRef.current = nextItems;
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setItems(nextItems);
      setTransitSettled(false);
      setTransitLoading(true);

      console.info(
        `[TRIP_LEG_TRANSPORT_CHANGED] dayIndex=${dayIndex} legIndex=${legIndex} mode=${routeModeLogLabel(label)}`,
      );
      logLegEffectiveTransport(dateKey, dayIndex, legIndex, nextSettings, legDestKey);

      void refreshSingleLeg(transitSegKey, { items: nextItems, settings: nextSettings });
    },
    [refreshTransit, refreshSingleLeg, stored.id],
  );

  const routeSyncSignature = useMemo(
    () => buildRouteSyncSignature(items, settings),
    [
      items,
      settings.transport,
      settings.defaultTransportLabel,
      settings.tripStartDate,
      settings.legTransport,
      settings.dayTransportLabels,
    ],
  );

  useEffect(() => {
    routeSyncMountedRef.current = true;
    return () => {
      routeSyncMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (items.length < 2) {
      setTransitSettled(true);
      return;
    }
    const currentSettings = settingsRef.current;
    if (
      routeSyncSignature === lastRouteSyncSignatureRef.current &&
      transitLegsCoverCurrentItems(itemsRef.current, currentSettings, { directionsRegion })
    ) {
      setTransitSettled(true);
      return;
    }
    if (routeSyncInFlightRef.current) return;

    setTransitSettled(false);
    const timer = window.setTimeout(() => {
      if (routeSyncMountedRef.current && !routeSyncInFlightRef.current) {
        void refreshTransit();
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [items.length, routeSyncSignature, refreshTransit, directionsRegion]);

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

  const openTripCoverEditor = useCallback((file: File) => {
    setCoverCropFile(file);
  }, []);

  const closeTripCoverEditor = useCallback(() => {
    setCoverCropFile(null);
  }, []);

  const handleCoverPick = (file: File) => {
    console.info(`[TRIP_COVER_EDITOR] open image=${file.name}`);
    void readFileImageSize(file)
      .then(({ width, height }) => {
        console.info(`[TRIP_COVER_UPLOAD] originalWidth=${width}`);
        console.info(`[TRIP_COVER_UPLOAD] originalHeight=${height}`);
      })
      .catch(() => {
        console.info("[TRIP_COVER_UPLOAD] originalWidth=unknown");
        console.info("[TRIP_COVER_UPLOAD] originalHeight=unknown");
      });
    openTripCoverEditor(file);
  };

  const handleCoverCropApply = async (blob: Blob, transform?: CropTransform) => {
    const exportQuality = IMAGE_CROP_VARIANTS.tripCover.exportQuality;
    try {
      const { width, height } = await readBlobImageSize(blob);
      console.info(`[TRIP_COVER_UPLOAD] finalWidth=${width}`);
      console.info(`[TRIP_COVER_UPLOAD] finalHeight=${height}`);
    } catch {
      console.info("[TRIP_COVER_UPLOAD] finalWidth=unknown");
      console.info("[TRIP_COVER_UPLOAD] finalHeight=unknown");
    }
    console.info(`[TRIP_COVER_UPLOAD] quality=${exportQuality}`);
    console.info(`[TRIP_COVER_UPLOAD] fileSize=${blob.size}`);
    console.info("[TRIP_COVER_EDITOR] save");
    setCoverBusy(true);
    try {
      const url = await uploadTripCover(stored.id, blob);
      const nextSettings: TripPlanSettings = {
        ...settings,
        ...(transform
          ? {
              coverImageScale: transform.scale,
              coverImagePositionX: transform.offsetX,
              coverImagePositionY: transform.offsetY,
            }
          : {}),
      };
      if (transform) {
        console.info(
          `[TRIP_COVER_EDITOR] scale=${transform.scale} x=${transform.offsetX} y=${transform.offsetY}`,
        );
      }
      setSettings(nextSettings);
      setCustomCoverImageUrl(url);
      setIsCoverCustomized(true);
      setCoverSource("upload");
      setCoverDisplayRevision(Date.now());
      const updated = await updateTripMeta(
        stored.id,
        {
          ...buildCustomCoverPatch(url),
          cover_source: "upload",
          cover_query: null,
        },
        {
          ...payload,
          tripSettings: nextSettings,
        },
      );
      if (updated) onStoredChange?.(updated);
      closeTripCoverEditor();
      console.info("[TRIP_COVER_UPLOAD] success url=", url);
      console.info("[TRIP_COVER_UPDATE] saved tripId=", stored.id);
      toast.success("封面已更新");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "封面上傳失敗";
      console.error("[TRIP_COVER_UPLOAD] error=", msg);
      toast.error(`封面上傳失敗，請稍後再試（${msg}）`);
    } finally {
      setCoverBusy(false);
    }
  };

  const tripCoverDisplayUrl = useMemo(() => {
    const raw =
      customCoverImageUrl?.trim() ||
      tripView.customCoverImageUrl?.trim() ||
      (isCoverCustomized ? tripView.displayCoverImage : null);
    return raw ? withCacheBust(raw, coverDisplayRevision) : null;
  }, [
    customCoverImageUrl,
    tripView.customCoverImageUrl,
    tripView.displayCoverImage,
    isCoverCustomized,
    coverDisplayRevision,
  ]);

  useLayoutEffect(() => {
    if (!editingTitle) return;
    document.documentElement.classList.add("trip-keyboard-open");
    return () => {
      document.documentElement.classList.remove("trip-keyboard-open");
    };
  }, [editingTitle]);

  useLayoutEffect(() => {
    const editingCover = coverSheetOpen || !!coverCropFile;
    document.documentElement.classList.toggle("trip-cover-editing", editingCover);
    return () => {
      document.documentElement.classList.remove("trip-cover-editing");
    };
  }, [coverSheetOpen, coverCropFile]);

  const handleTripDateRangeChange = useCallback(
    (start: string, end: string) => {
      const currentItems = itemsRef.current;
      const currentSettings = settingsRef.current;
      const oldRange = inferTripDatesForRange(currentItems, currentSettings);
      const resolved = resolveTripDateRangeChange(oldRange, start, end || start);
      const oldDays = daysBetweenDates(oldRange.start, oldRange.end);
      const newDays = daysBetweenDates(resolved.start, resolved.end);

      if (resolved.start === oldRange.start && resolved.end === oldRange.end) return;

      const overflow = countTripDateRangeOverflow(
        currentItems,
        currentSettings,
        resolved.start,
        resolved.end,
      );
      if (overflow > 0) {
        const ok = confirm(
          `縮短行程後，將有 ${overflow} 個地點移到「未安排」。地點不會被刪除，是否繼續？`,
        );
        if (!ok) return;
      }

      const applied = applyTripDateRange(
        currentItems,
        currentSettings,
        resolved.start,
        resolved.end,
      );
      const nextSettings: TripPlanSettings = {
        ...currentSettings,
        tripStartDate: applied.tripStartDate,
        tripEndDate: applied.tripEndDate,
      };
      commitTripSchedule(applied.items, nextSettings, {
        logDateChange: true,
        oldStartDate: oldRange.start,
        newStartDate: applied.tripStartDate,
      });
      setActiveDayIndex(0);

      console.info(
        `[TRIP_DATE_UPDATE] oldStart=${oldRange.start} oldEnd=${oldRange.end} newStart=${resolved.start} newEnd=${resolved.end} oldDays=${oldDays} newDays=${newDays}`,
      );

      if (applied.overflowCount > 0) {
        toast.message(`已將 ${applied.overflowCount} 個地點移到「未安排」`);
      }
    },
    [commitTripSchedule],
  );

  const handleSingleDayDateChange = useCallback(
    (oldDateKey: string, newIso: string) => {
      const currentItems = itemsRef.current;
      const currentSettings = settingsRef.current;
      const applied = updateSingleDayDate(currentItems, currentSettings, oldDateKey, newIso);
      const nextSettings: TripPlanSettings = {
        ...currentSettings,
        tripStartDate: applied.tripStartDate,
        tripEndDate: applied.tripEndDate,
      };
      commitTripSchedule(applied.items, nextSettings, {
        logDateChange: true,
        oldStartDate: currentSettings.tripStartDate ?? oldDateKey,
        newStartDate: applied.tripStartDate,
      });
      console.info(
        `[TRIP_DAY_DATE_UPDATE] oldDate=${oldDateKey} newDate=${newIso} start=${applied.tripStartDate} end=${applied.tripEndDate}`,
      );
    },
    [commitTripSchedule],
  );

  const tripDateRange = inferTripDates(items, settings);

  return (
    <>
    <div ref={tripDetailRootRef} className="trip-detail-root w-full">
      <div ref={tripCoverRef} className="trip-detail-cover">
        <div className="relative aspect-[3/2] w-full overflow-hidden">
          <TripCoverImage
            key={tripCoverDisplayUrl ?? "trip-cover-default"}
            displayCoverImage={
              tripCoverDisplayUrl ??
              tripView.displayCoverImage
            }
            coverImageUrl={tripView.coverImageUrl}
            customCoverImageUrl={customCoverImageUrl}
            aiGeneratedCoverImageUrl={aiCoverImageUrl}
            isCoverCustomized={isCoverCustomized}
            coverSource={coverSource}
            mood={payload.moodTag}
            loading={coverBusy}
            className="pointer-events-none aspect-[3/2] w-full select-none"
            imgClassName="pointer-events-none select-none object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          <div className="pointer-events-auto absolute left-3 top-3">
            <BackButton
              fallback={{ to: "/saved", search: { tab: "trips" } }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 backdrop-blur"
            />
          </div>
          <div className="pointer-events-auto absolute right-3 top-3">
            {headerRight}
          </div>
          <button
            type="button"
            onClick={() => setCoverSheetOpen(true)}
            disabled={coverBusy || !!coverCropFile}
            className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs backdrop-blur transition active:scale-[0.98] disabled:opacity-60"
          >
            {coverBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            更換封面
          </button>
        </div>
      </div>

      <header className="border-b border-border px-5 pb-3 pt-3">
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

        {tripDateRange.start ? (
          <RoamieDatePicker
            mode="range"
            variant="inline"
            title="編輯行程日期"
            rangeDisplay="slash"
            value={{ start: tripDateRange.start, end: tripDateRange.end }}
            onChange={(range) => handleTripDateRangeChange(range.start, range.end)}
            onOpenChange={(open) => {
              if (open) console.info("[TRIP_DATE_EDIT_OPEN]");
            }}
            className="mt-1 !text-sm font-normal text-muted-foreground"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              console.info("[TRIP_DATE_EDIT_OPEN]");
              const today = new Date().toISOString().slice(0, 10);
              handleTripDateRangeChange(today, today);
            }}
            className="mt-1 text-sm text-muted-foreground underline decoration-dashed underline-offset-4"
          >
            設定行程日期
          </button>
        )}

        {tripView.summary ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{tripView.summary}</p>
        ) : null}
      </header>

      <div className="px-5 pt-3">
        <TripOutfitCard
          destination={
            tripView.destination !== "尚未設定" ? tripView.destination : outfitDestination
          }
          dateRange={tripView.dateRange}
          weatherSummary={outfitFields.weatherSummary}
          weatherSource={outfitFields.weatherSource}
          suggestion={outfitFields.outfitSuggestion}
          loading={outfitLoading}
        />
      </div>

      <div className="border-b border-border px-5 py-3">
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
                {d.isUnassigned ? "未安排" : `第 ${d.dayNumber} 天`}
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

      <div className="px-5 py-5 pb-6">
        {activeDay ? (
          <>
            <div className="flex items-start justify-between gap-2">
              {activeDay.isUnassigned ? (
                <h2 className="text-sm font-medium text-foreground/90">未安排</h2>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm font-medium text-foreground/90">
                  <span>{`第 ${activeDay.dayNumber} 天 ·`}</span>
                  <RoamieDatePicker
                    mode="single"
                    variant="inline"
                    title={`第 ${activeDay.dayNumber} 天日期`}
                    value={
                      /^\d{4}-\d{2}-\d{2}$/.test(activeDay.dateKey)
                        ? activeDay.dateKey
                        : inferTripDates(items, settings).start
                    }
                    onChange={(iso) => handleSingleDayDateChange(activeDay.dateKey, iso)}
                    className="!text-sm font-medium !text-foreground/90"
                  />
                </div>
              )}
              {activeDay.isUnassigned ? (
                <p className="shrink-0 text-xs text-muted-foreground">可移回各天或刪除</p>
              ) : dayGroups.filter((d) => !d.isUnassigned).length > 1 ? (
                <button
                  type="button"
                  onClick={() => handleRemoveDay(activeDay.dateKey, activeDay.dayNumber)}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  刪除此天
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <TripTransportPicker
                variant="global"
                value={resolveDayTransportLabel(settings, activeDay.dateKey)}
                onChange={(label) => {
                  applyTransportModeChange(label, "day", {
                    dateKey: activeDay.dateKey,
                    dayIndex: safeDayIndex,
                  });
                }}
              />
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
                  const transport = resolveLegTransportLabel(settings, legKey, activeDay.dateKey);
                  const transitKey =
                    prev != null
                      ? buildLegKey(prev.placeName || prev.title, item.placeName || item.title)
                      : null;
                  const transit = transitKey ? settings.transitLegs?.[transitKey] : undefined;
                  const showJapanTransitMaps =
                    prev != null &&
                    prev.lat != null &&
                    prev.lng != null &&
                    item.lat != null &&
                    item.lng != null &&
                    isJapanTransitMapsLeg(transit, transport);

                  return (
                    <div key={`${activeDay.dateKey}-${legKey}-${i}`}>
                      {i > 0 && transitKey ? (
                        <TripLegTransportConnector
                          transport={transport}
                          travelTimeLabel={formatLegTravelTimeLabel(transit, transport, {
                            loading:
                              transitLoading &&
                              !transit?.transportStatus &&
                              !showJapanTransitMaps,
                          })}
                          walkFallbackHint={formatLegWalkFallbackHint(transit, transport)}
                          onOpenTransitMaps={
                            showJapanTransitMaps
                              ? () =>
                                  openJapanTransitLegInGoogleMaps(
                                    { lat: prev!.lat!, lng: prev!.lng! },
                                    { lat: item.lat!, lng: item.lng! },
                                  )
                              : null
                          }
                          onTransportChange={(label) => {
                            applyTransportModeChange(label, "leg", {
                              dateKey: activeDay.dateKey,
                              dayIndex: safeDayIndex,
                              legIndex: i - 1,
                              legDestKey: legKey,
                              transitSegKey: transitKey ?? undefined,
                            });
                          }}
                        />
                      ) : null}
                      <SavedTripEditableStopCard
                        item={item}
                        indexInDay={i}
                        dayCount={activeDay.items.length}
                        settings={settings}
                        onSetArrivalTime={(t) => {
                          persistItems(
                            applyDayArrivalRecalc(
                              updateStop(items, activeDay.dateKey, i, { time: t }),
                              activeDay.dateKey,
                              i,
                            ),
                          );
                        }}
                        onSetDurationMinutes={(m) => setLegMinutes(legKeyForItem(item), m)}
                        onMoveUp={() =>
                          persistItems(
                            applyDayArrivalRecalc(
                              moveStopInDay(items, activeDay.dateKey, i, -1),
                              activeDay.dateKey,
                              0,
                            ),
                          )
                        }
                        onMoveDown={() =>
                          persistItems(
                            applyDayArrivalRecalc(
                              moveStopInDay(items, activeDay.dateKey, i, 1),
                              activeDay.dateKey,
                              0,
                            ),
                          )
                        }
                        onDelete={() =>
                          persistItems(
                            applyDayArrivalRecalc(
                              removeStopAt(items, activeDay.dateKey, i),
                              activeDay.dateKey,
                              0,
                            ),
                          )
                        }
                      />
                      <TripAffiliateSection
                        kind="ticket"
                        offers={placeTicketOffersByKey.get(placeAffiliateKey(item)) ?? []}
                        compact
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
              {addMenuDayIndex === activeDay.dayNumber - 1 ? (
                <div className="space-y-2 rounded-2xl border border-border bg-card/80 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSavedPlacesOpen(true)}
                      className="rounded-full border border-border bg-background px-3 py-2.5 text-xs font-medium"
                    >
                      從收藏新增
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeDay) return;
                        const handoff = buildTripAddPlaceContext({
                          stored,
                          payload,
                          settings,
                          dayIndex: safeDayIndex,
                          selectedDay: activeDay.dayNumber,
                          dateKey: activeDay.dateKey,
                          dayItems: activeDay.items,
                          dayCount: dayGroups.filter((d) => !d.isUnassigned).length,
                        });
                        writeTripAddPlaceHandoff(handoff);
                        setAddMenuDayIndex(null);
                        void navigate({
                          to: "/chat",
                          search: {
                            from: "trip_add_place",
                            tripId: stored.id,
                            day: activeDay.dayNumber,
                          },
                        });
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded-full border border-border bg-background px-3 py-2.5 text-xs font-medium"
                    >
                      <Sparkles className="h-3 w-3" />
                      請 Roamie 推薦
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddMenuDayIndex(null)}
                    className="w-full py-1 text-center text-xs text-muted-foreground"
                  >
                    收合
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    scrollToDay(activeDay.dayNumber - 1);
                    setAddMenuDayIndex(activeDay.dayNumber - 1);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-border bg-card/60 py-3 text-sm text-foreground/80"
                >
                  <Plus className="h-4 w-4" />
                  新增地點
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">尚無每日行程內容</p>
        )}

        {hotelAffiliateOffers.length > 0 || flightAffiliateOffers.length > 0 ? (
          <div className="mt-6 space-y-3 border-t border-border pt-4">
            <TripAffiliateSection kind="flight" offers={flightAffiliateOffers} />
            <TripAffiliateSection kind="hotel" offers={hotelAffiliateOffers} />
          </div>
        ) : null}
      </div>
    </div>

      <SavedPlacesPickSheet
        open={savedPlacesOpen}
        onOpenChange={setSavedPlacesOpen}
        onPick={(place) => {
          const dk = activeDay?.dateKey;
          if (dk) handleAddStop(dk, place);
        }}
      />

      <ImageSourceSheet
        open={coverSheetOpen}
        onOpenChange={setCoverSheetOpen}
        title="更換封面"
        albumLabel="從相簿選擇"
        cameraLabel="拍照"
        sheetLogPrefix="[TRIP_COVER_SHEET]"
        pickLogPrefix="[TRIP_COVER_PICK]"
        sheetClassName="z-[70] rounded-t-[1.75rem] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
        overlayClassName="z-[70]"
        onPickFile={handleCoverPick}
        cameraFacing="environment"
      />

      <SharedImageCropEditor
        open={!!coverCropFile}
        file={coverCropFile}
        variant="tripCover"
        gestureLogPrefix="[TRIP_COVER_EDITOR]"
        onOpenChange={(open) => {
          if (!open && !coverBusy) closeTripCoverEditor();
        }}
        onConfirm={(blob, transform) => void handleCoverCropApply(blob, transform)}
        applying={coverBusy}
        doneLabel="儲存封面"
        sheetClassName="z-[90]"
        overlayClassName="z-[90]"
      />
    </>
  );
}
