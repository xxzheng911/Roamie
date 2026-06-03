import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { generateTripOutfitSuggestion } from "@/lib/outfit/outfit.functions";
import {
  buildOutfitInputKey,
  buildTripItemsFingerprint,
} from "@/lib/outfit/trip-outfit-context";
import type { TripOutfitSuggestionFields } from "@/lib/outfit/types";
import { EMPTY_TRIP_OUTFIT_FIELDS } from "@/lib/outfit/stable-outfit-fields";
import { logOutfitSuggestionSkipped } from "@/lib/trip/trip-detail-log";
import { WEATHER_CACHE_TTL_MS, ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";

type Params = {
  initialFields: TripOutfitSuggestionFields;
  items: RoamieItineraryItem[];
  settings: TripPlanSettings;
  destination: string;
  fallbackDestination?: string;
  destinationLocation?: TripLocation | null;
  dateRange: { start: string; end: string };
  dayCount: number;
  tripCenter?: { lat: number; lng: number };
  moodTag?: string;
  enabled?: boolean;
  /** 詳情頁勿定時刷新天氣 key，避免 inputKey 變動觸發重算與寫入 */
  refreshWeather?: boolean;
  tripId?: string;
};

export function useTripOutfitSuggestion({
  initialFields,
  items,
  settings,
  destination,
  fallbackDestination,
  destinationLocation,
  dateRange,
  dayCount,
  tripCenter,
  moodTag,
  enabled = true,
  refreshWeather = false,
  tripId,
}: Params) {
  const fetchSuggestion = useServerFn(generateTripOutfitSuggestion);
  const fetchSuggestionRef = useRef(fetchSuggestion);
  fetchSuggestionRef.current = fetchSuggestion;
  const generatingRef = useRef(false);
  const [weatherRefreshTick, setWeatherRefreshTick] = useState(0);

  const resolvedDestination =
    destination !== "尚未設定" ? destination : fallbackDestination ?? "";

  const itemsFingerprint = useMemo(() => buildTripItemsFingerprint(items), [items]);

  const [weatherSignature, setWeatherSignature] = useState("");

  const inputKey = useMemo(
    () =>
      buildOutfitInputKey({
        destination: resolvedDestination,
        startDate: dateRange.start,
        endDate: dateRange.end,
        dayCount,
        itemsFingerprint,
        weatherSignature,
        weatherRefreshTick,
      }),
    [
      resolvedDestination,
      dateRange.start,
      dateRange.end,
      dayCount,
      itemsFingerprint,
      weatherSignature,
      weatherRefreshTick,
    ],
  );

  const [outfitFields, setOutfitFields] = useState<TripOutfitSuggestionFields>(() => ({
    outfitSuggestion: initialFields.outfitSuggestion,
    weatherSummary: initialFields.weatherSummary,
    weatherSource: initialFields.weatherSource,
    outfitSuggestionUpdatedAt: initialFields.outfitSuggestionUpdatedAt,
    outfitSuggestionInputKey: initialFields.outfitSuggestionInputKey,
    outfitTags: initialFields.outfitTags,
    weatherTempC: initialFields.weatherTempC,
    weatherFeelsLikeC: initialFields.weatherFeelsLikeC,
    weatherCondition: initialFields.weatherCondition,
    weatherIconType: initialFields.weatherIconType,
    weatherIsDaytime: initialFields.weatherIsDaytime,
    weatherPrecipPercent: initialFields.weatherPrecipPercent,
    outfitTier: initialFields.outfitTier,
  }));

  const [loading, setLoading] = useState(false);
  const [outfitError, setOutfitError] = useState<string | null>(null);

  const isCached =
    Boolean(outfitFields.outfitSuggestion) &&
    outfitFields.outfitSuggestionInputKey === inputKey;

  const pendingRegeneration =
    enabled &&
    outfitFields.outfitSuggestionInputKey !== inputKey &&
    Boolean(dateRange.start);
  const showLoading = enabled && (loading || pendingRegeneration);
  const displayFields =
    !enabled || outfitFields.outfitSuggestionInputKey === inputKey
      ? outfitFields
      : EMPTY_TRIP_OUTFIT_FIELDS;

  useEffect(() => {
    if (!refreshWeather) return;
    const timer = window.setInterval(() => {
      setWeatherRefreshTick((t) => t + 1);
    }, WEATHER_CACHE_TTL_MS);
    return () => window.clearInterval(timer);
  }, [refreshWeather]);

  useEffect(() => {
    if (!enabled || !dateRange.start) return;
    if (isCached) {
      if (tripId) logOutfitSuggestionSkipped(tripId, "already_cached");
      return;
    }
    if (generatingRef.current) return;

    generatingRef.current = true;
    setLoading(true);
    setOutfitError(null);

    void fetchSuggestionRef.current({
      data: {
        destination: resolvedDestination || undefined,
        startDate: dateRange.start,
        endDate: dateRange.end || dateRange.start,
        dayCount,
        items,
        transport: settings.transport ?? null,
        lat: tripCenter?.lat ?? destinationLocation?.lat ?? null,
        lng: tripCenter?.lng ?? destinationLocation?.lng ?? null,
        mood: moodTag,
        destinationLocation: destinationLocation ?? null,
      },
    })
      .then((result) => {
        setWeatherSignature(result.weatherInputSignature);
        const savedKey = buildOutfitInputKey({
          destination: resolvedDestination,
          startDate: dateRange.start,
          endDate: dateRange.end,
          dayCount,
          itemsFingerprint,
          weatherSignature: result.weatherInputSignature,
          weatherRefreshTick,
        });
        setOutfitFields({
          outfitSuggestion: result.outfitSuggestion,
          weatherSummary: result.weatherSummary,
          weatherSource: result.weatherSource,
          outfitSuggestionUpdatedAt: result.outfitSuggestionUpdatedAt,
          outfitSuggestionInputKey: savedKey,
          outfitTags: result.outfitTags,
          weatherTempC: result.weatherTempC,
          weatherFeelsLikeC: result.weatherFeelsLikeC,
          weatherCondition: result.weatherCondition,
          weatherIconType: result.weatherIconType,
          weatherIsDaytime: result.weatherIsDaytime,
          weatherPrecipPercent: result.weatherPrecipPercent,
          outfitTier: result.outfitTier,
        });
      })
      .catch((e) => {
        console.warn("[useTripOutfitSuggestion] generation failed", e);
        const msg = e instanceof Error ? e.message : "穿搭建議暫時無法取得";
        setOutfitError(msg);
        setOutfitFields({
          outfitSuggestion: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
          weatherSummary: "",
          weatherSource: "unavailable",
          outfitSuggestionUpdatedAt: new Date().toISOString(),
          outfitSuggestionInputKey: inputKey,
          outfitTags: [],
          weatherTempC: null,
          weatherFeelsLikeC: null,
          weatherCondition: "",
          weatherIconType: "03",
          weatherIsDaytime: true,
          weatherPrecipPercent: null,
          outfitTier: "free",
        });
      })
      .finally(() => {
        generatingRef.current = false;
        setLoading(false);
      });
  }, [
    enabled,
    isCached,
    inputKey,
    dateRange.start,
    dateRange.end,
    dayCount,
    resolvedDestination,
    itemsFingerprint,
    items,
    settings.transport,
    tripCenter,
    destinationLocation?.lat,
    destinationLocation?.lng,
    moodTag,
    weatherRefreshTick,
  ]);

  return {
    loading: showLoading,
    outfitFields: displayFields,
    outfitError,
    isCached,
  };
}
